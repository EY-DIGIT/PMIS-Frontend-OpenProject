/* ══════════════════════════════════════════════════════════════════
   src/api/dashboardExtras.js

   Client-side aggregation for dashboard domains that the BE does NOT yet
   expose as a single aggregate endpoint:

     • Finance  — one `payment-page` call per project, rolled up by
                  project / organization / cost-type. Concurrency-capped
                  and cached so a Summary/Org view doesn't hammer the BE
                  and repeat views are instant.
     • Workflow — the approval-inbox list grouped by state into a funnel.

   NOTE (honesty about the data): payment-page has NO "released vs
   pending" amount fields. It exposes `totals.totalContractCost` (the
   authoritative contract value) plus a cost-type split, and per-phase
   `paymentTerms[].value` (the SCHEDULED payout amounts). So we surface
   "Contract Value" and "Scheduled Payments" — never a fabricated
   released/pending figure. Swap this whole module for a BE
   `/dashboard/finance` aggregate when it ships.
   ══════════════════════════════════════════════════════════════════ */

import { api } from "./client";
import { ENDPOINTS } from "./endpoint";
import { listApprovalInbox } from "./approvalInbox";
import { listTickets } from "./tickets";
import { listMeetings } from "./meetings";

/* Coerce the possibly-string, possibly-null rupee amounts to a number. */
export function num(v) {
  if (v == null) return 0;
  const n = typeof v === "number" ? v : parseFloat(String(v).replace(/[^0-9.-]/g, ""));
  return Number.isFinite(n) ? n : 0;
}

function unwrap(res) {
  if (res && typeof res === "object" && "data" in res && res.data !== null && res.data !== undefined) {
    return res.data;
  }
  return res;
}

/* ─── Per-project finance cache ─────────────────────────────────────
   Keyed by project UUID. Lives for the page session; the Refresh button
   on each view clears it via clearFinanceCache(). */
const financeCache = new Map();

export function clearFinanceCache() { financeCache.clear(); }

/* Normalize a raw payment-page payload into the compact finance shape
   the dashboard consumes. Returns zeros (never throws) for a project
   that has no finance configured yet. */
export function normalizeFinance(page) {
  const totals = page?.totals || {};
  const phases = Array.isArray(page?.phases) ? page.phases : [];
  const costItems = Array.isArray(page?.costItems) ? page.costItems : [];

  const contractValue = num(totals.totalContractCost);
  const fixedCost = num(totals.fixedCost);
  const oneTimeCost = num(totals.oneTimeCost);
  const recurringCost = num(totals.recurringCost);

  // Scheduled payout = sum of every payment-term value across phases.
  let scheduled = 0;
  const byPhase = phases.map((p) => {
    const terms = Array.isArray(p?.paymentTerms) ? p.paymentTerms : [];
    const phaseScheduled = terms.reduce((s, t) => s + num(t?.value), 0);
    scheduled += phaseScheduled;
    return {
      label: String(p?.phase ?? "Phase"),
      scheduled: phaseScheduled,
      fixed: num(p?.effectivePhaseTotal ?? p?.phaseFixedTotal),
      oneTime: num(p?.oneTimeAllocated),
      carriedOut: num(p?.carryForward?.carriedOut),
    };
  });

  return {
    hasData: contractValue > 0 || scheduled > 0 || costItems.length > 0,
    contractValue,
    fixedCost,
    oneTimeCost,
    recurringCost,
    scheduled,
    byPhase,
    costItemCount: costItems.length,
  };
}

/* Fetch + normalize one project's finance. Cached by UUID. Never
   rejects — a project with no finance page resolves to a zeroed record
   so the aggregate roll-up stays robust. */
export async function fetchProjectFinance(uuid) {
  if (!uuid) return normalizeFinance(null);
  if (financeCache.has(uuid)) return financeCache.get(uuid);
  const promise = api
    .get(ENDPOINTS.projects.paymentPage(uuid))
    .then((res) => normalizeFinance(unwrap(res)))
    .catch(() => normalizeFinance(null));
  financeCache.set(uuid, promise);
  return promise;
}

/* Run `tasks` (array of () => Promise) with a bounded concurrency so we
   don't fire 200 requests at once. Calls onSettle after each resolves so
   callers can render progress. */
async function pool(tasks, { concurrency = 5, onSettle } = {}) {
  const results = new Array(tasks.length);
  let next = 0;
  let done = 0;
  async function worker() {
    while (next < tasks.length) {
      const i = next++;
      try { results[i] = await tasks[i](); }
      catch { results[i] = null; }
      done++;
      if (onSettle) onSettle(done, tasks.length);
    }
  }
  const workers = Array.from({ length: Math.min(concurrency, tasks.length) }, worker);
  await Promise.all(workers);
  return results;
}

/* Aggregate finance across a set of project cards.
   `projects` = [{ uuid, id, name, organisation, organisations, division }].
   Returns totals + per-project + per-org + per-division roll-ups plus a
   cost-type split. `onProgress(done, total)` fires as calls settle so the
   caller can show "computing 34/120". Abortable via opts.shouldStop(). */
export async function aggregateFinance(projects, opts = {}) {
  const list = (projects || []).filter((p) => p && p.uuid);
  const byProject = [];
  const orgMap = new Map();
  const divMap = new Map();
  const phaseMap = new Map();
  let totalContractValue = 0;
  let totalScheduled = 0;
  let totalFixed = 0;
  let totalOneTime = 0;
  let totalRecurring = 0;
  let withFinance = 0;

  const tasks = list.map((p) => async () => {
    if (opts.shouldStop && opts.shouldStop()) return null;
    const fin = await fetchProjectFinance(p.uuid);
    const orgName = pickOrg(p);
    const divName = p.division || "—";

    if (fin.hasData) withFinance++;
    totalContractValue += fin.contractValue;
    totalScheduled += fin.scheduled;
    totalFixed += fin.fixedCost;
    totalOneTime += fin.oneTimeCost;
    totalRecurring += fin.recurringCost;

    byProject.push({
      id: p.id, uuid: p.uuid, name: p.name || p.id,
      organisation: orgName, division: divName,
      contractValue: fin.contractValue, scheduled: fin.scheduled,
    });

    bumpFin(orgMap, orgName, fin);
    bumpFin(divMap, divName, fin);
    for (const ph of fin.byPhase || []) {
      const g = phaseMap.get(ph.label) || { label: ph.label, scheduled: 0, oneTime: 0, carriedOut: 0 };
      g.scheduled += ph.scheduled; g.oneTime += ph.oneTime; g.carriedOut += ph.carriedOut;
      phaseMap.set(ph.label, g);
    }
    return fin;
  });

  await pool(tasks, { concurrency: opts.concurrency || 5, onSettle: opts.onProgress });

  byProject.sort((a, b) => b.contractValue - a.contractValue);
  const byOrg = Array.from(orgMap.values()).sort((a, b) => b.contractValue - a.contractValue);
  const byDivision = Array.from(divMap.values()).sort((a, b) => b.contractValue - a.contractValue);
  const byPhase = Array.from(phaseMap.values()).sort((a, b) => b.scheduled - a.scheduled);

  return {
    totalContractValue, totalScheduled,
    totalFixed, totalOneTime, totalRecurring,
    withFinance, projectCount: list.length,
    byProject, byOrg, byDivision, byPhase,
    costTypeSplit: { fixed: totalFixed, one_time: totalOneTime, recurring: totalRecurring },
  };
}

function pickOrg(p) {
  if (p.organisation && p.organisation !== "—") return p.organisation;
  const orgs = Array.isArray(p.organisations) ? p.organisations : [];
  return orgs[0]?.name || "—";
}

function bumpFin(map, name, fin) {
  const key = name || "—";
  const g = map.get(key) || { name: key, contractValue: 0, scheduled: 0, projects: 0 };
  g.contractValue += fin.contractValue;
  g.scheduled += fin.scheduled;
  g.projects += 1;
  map.set(key, g);
}

/* ─── Approval workflow funnel ──────────────────────────────────────
   Pulls the admin approval-inbox and groups items by their workflow
   state into an ordered funnel. Item state field name varies, so we
   read the first present of a few candidates. Returns [] gracefully if
   the inbox is empty or the endpoint is unavailable. */
const WORKFLOW_ORDER = [
  { match: ["draft", "not_started", "idle"], label: "Draft" },
  { match: ["submitted", "pending", "pendingatconcerneddivision", "pending_division"], label: "Pending Division" },
  { match: ["pendingatowner", "pending_owner", "division_approved", "readyforowner"], label: "Pending Owner" },
  { match: ["approved", "completed", "closed"], label: "Approved" },
  { match: ["rejected", "sent_back", "sentback"], label: "Rejected" },
];

function itemState(it) {
  const raw = it?.status || it?.state || it?.currentState || it?.workflowState || it?.approvalState || "";
  return String(raw).toLowerCase().replace(/[\s-]/g, "_");
}

export async function fetchWorkflowFunnel() {
  let items = [];
  try {
    items = await listApprovalInbox({ role: "admin", status: "all" });
  } catch {
    return { stages: [], total: 0, available: false };
  }
  const buckets = WORKFLOW_ORDER.map((s) => ({ label: s.label, value: 0 }));
  let matched = 0;
  for (const it of items) {
    const st = itemState(it);
    const idx = WORKFLOW_ORDER.findIndex((s) => s.match.some((m) => st.includes(m)));
    if (idx >= 0) { buckets[idx].value++; matched++; }
  }
  // If nothing matched our known states but items exist, fall back to a
  // single "In Workflow" stage so the widget still conveys volume.
  if (!matched && items.length) {
    return {
      stages: [{ label: "In Workflow", value: items.length }],
      total: items.length, available: true,
    };
  }
  return { stages: buckets, total: items.length, available: true };
}

/* ─── Tickets by priority + escalations ─────────────────────────────
   Pulls a page of tickets and groups by priority (P1..P4) with an
   open/closed split. Escalations are derived honestly from the ticket
   set (open critical/high, and past-due), since there is no portfolio
   escalation aggregate endpoint. Returns available:false gracefully if
   the ticket service can't be reached. */
const PRIORITY_META = [
  { code: "P1", label: "Critical", color: "#e11d48" },
  { code: "P2", label: "High", color: "#f97316" },
  { code: "P3", label: "Medium", color: "#f59e0b" },
  { code: "P4", label: "Low", color: "#22c55e" },
];
const CLOSED_STATES = new Set(["RESOLVED", "CLOSED", "CANCELLED"]);

export async function fetchTicketStats() {
  let tickets = [];
  try {
    const res = await listTickets({ page: 0, size: 200 });
    tickets = Array.isArray(res?.tickets) ? res.tickets
      : Array.isArray(res?.data?.tickets) ? res.data.tickets
      : Array.isArray(res?.content) ? res.content : [];
  } catch {
    return { available: false, byPriority: [], total: 0, open: 0, escalations: [] };
  }

  const byPriority = PRIORITY_META.map((p) => ({ ...p, total: 0, open: 0, closed: 0 }));
  let total = 0, open = 0, pastDue = 0;
  for (const t of tickets) {
    const code = String(t?.priority || "").toUpperCase();
    const row = byPriority.find((p) => p.code === code) || byPriority[byPriority.length - 1];
    const status = String(t?.status || "").toUpperCase();
    const isOpen = !CLOSED_STATES.has(status);
    row.total++; total++;
    if (isOpen) { row.open++; open++; } else row.closed++;
    if (isOpen && Number(t?.dueInMins) < 0) pastDue++;
  }

  const critOpen = byPriority.find((p) => p.code === "P1")?.open || 0;
  const highOpen = byPriority.find((p) => p.code === "P2")?.open || 0;
  const escalations = [
    { issue: "Critical tickets open", count: critOpen, severity: critOpen ? "high" : "low" },
    { issue: "High-priority tickets open", count: highOpen, severity: highOpen ? "medium" : "low" },
    { issue: "Tickets breaching SLA", count: pastDue, severity: pastDue ? "high" : "low" },
  ].filter((e) => e.count > 0);

  return { available: true, byPriority, total, open, escalations };
}

/* ─── Meetings overview ─────────────────────────────────────────────
   Buckets meetings into Today / This Week / Upcoming from meetingDate.
   pendingMom = past meetings not yet closed (a proxy — there is no
   portfolio "MoM pending" count). Returns available:false on failure. */
export async function fetchMeetingStats(nowMs) {
  let meetings = [];
  try {
    const res = await listMeetings({ size: 200 });
    meetings = Array.isArray(res?.content) ? res.content
      : Array.isArray(res?.data?.content) ? res.data.content
      : Array.isArray(res?.data) ? res.data
      : Array.isArray(res) ? res : [];
  } catch {
    return { available: false, today: 0, thisWeek: 0, upcoming: 0, pendingMom: 0, total: 0 };
  }

  const now = nowMs ? new Date(nowMs) : new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const endOfToday = startOfToday + 86400000;
  const endOfWeek = startOfToday + 7 * 86400000;

  let today = 0, thisWeek = 0, upcoming = 0, pendingMom = 0;
  for (const m of meetings) {
    const raw = m?.meetingDate || m?.date || m?.startTime;
    const ts = raw ? Date.parse(raw) : NaN;
    const status = String(m?.status || "").toUpperCase();
    if (Number.isFinite(ts)) {
      if (ts >= startOfToday && ts < endOfToday) today++;
      else if (ts >= endOfToday && ts < endOfWeek) thisWeek++;
      else if (ts >= endOfWeek) upcoming++;
      if (ts < startOfToday && !["CLOSED", "COMPLETED", "CANCELLED"].includes(status)) pendingMom++;
    }
  }
  return { available: true, today, thisWeek, upcoming, pendingMom, total: meetings.length };
}
