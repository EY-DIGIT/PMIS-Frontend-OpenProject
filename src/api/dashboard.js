/* ══════════════════════════════════════════════════════════════════
   src/api/dashboard.js

   Wraps the six admin-only `/api/v3/dashboard/*` endpoints the BE
   shipped on 2026-05-09. Canonical schemas live in the backend at
   app/api/v3/dashboard/schemas.py — keep this file in step with that.

   Two layers:
   - thin endpoint wrappers (summary, projectsList, projectDetail, …)
   - adapters that map the wire payload into the legacy shape the
     Dashboard component already consumes, so the existing UI helpers
     (flattenRows, kpisForProject, nodeStatus, …) keep working.
   ══════════════════════════════════════════════════════════════════ */

import { api } from './client';
import { ENDPOINTS } from './endpoint';
import { fromApiDate } from './adapters';

/* Fetches the raw `/api/v3/projects/{uuid}/tree` payload, unwrapped from
   the standard envelope. We intentionally bypass the legacy
   `fromApiProject` adapter (api/projects.js) because that mapper drops
   the actualStart/End date fields the dashboard helpers depend on. */
export async function getRawProjectTree(uuid) {
  const res = await withTimeout(
    api.get(ENDPOINTS.projects.tree(uuid)),
    DASHBOARD_TIMEOUT_MS, "project tree",
  );
  return unwrap(res);
}

// BE wraps successful payloads in `{ data, message, error, status }`
// for most endpoints. A few return the payload at the root. Accept both.
function unwrap(res) {
  if (res && typeof res === 'object' && 'data' in res && res.data !== null && res.data !== undefined) {
    return res.data;
  }
  return res;
}

/* ─── Endpoint wrappers ────────────────────────────────────────── */

// Hard ceiling on every dashboard request. The BE has shipped slow /
// hung responses in the past; without a timeout the UI sits on
// "Loading…" indefinitely. 60s accommodates the slowest aggregate
// queries (200-project roll-up) we've actually seen in prod.
const DASHBOARD_TIMEOUT_MS = 60000;

function withTimeout(promise, ms = DASHBOARD_TIMEOUT_MS, label = "request") {
  let timer;
  const t = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} timed out`)), ms);
  });
  return Promise.race([promise, t]).finally(() => clearTimeout(timer));
}

export async function summary({ delayMinDays = 5 } = {}) {
  const res = await withTimeout(
    api.get(ENDPOINTS.dashboard.summary, { query: { delayMinDays } }),
    DASHBOARD_TIMEOUT_MS, "dashboard summary",
  );
  return unwrap(res);
}

/* Tries `/dashboard/summary` first; if that endpoint is missing, slow,
   or returns an unexpected shape, derives the same view-model from
   `/dashboard/projects` (or its raw-list fallback). View files only
   ever need to call this one helper — they don't have to know which
   path delivered the data. */
export async function summaryWithFallback({ delayMinDays = 1 } = {}) {
  console.info("[dashboard] summaryWithFallback start", { delayMinDays });
  try {
    const t0 = performance.now();
    const data = await summary({ delayMinDays });
    console.info("[dashboard] summary() ok in", Math.round(performance.now() - t0), "ms", { raw: data });
    const normalized = normalizeSummaryResponse(data);
    if (normalized) {
      console.info("[dashboard] summary normalized →", normalized);
      return normalized;
    }
    console.warn("[dashboard] summary returned unusable shape, falling back to projectsList");
  } catch (e) {
    console.warn("[dashboard] summary() failed:", e?.message || e);
  }

  let cards;
  try {
    const t0 = performance.now();
    const payload = await withTimeout(
      projectsList({ pageSize: 200 }), DASHBOARD_TIMEOUT_MS, "projects list",
    );
    console.info("[dashboard] projectsList() ok in", Math.round(performance.now() - t0), "ms");
    cards = Array.isArray(payload?.projects) ? payload.projects : [];
  } catch (e) {
    console.warn("[dashboard] projectsList() failed:", e?.message || e, "→ trying raw fallback");
    const t0 = performance.now();
    const list = await withTimeout(
      projectsListFallback(), DASHBOARD_TIMEOUT_MS, "raw projects list",
    );
    console.info("[dashboard] projectsListFallback() ok in", Math.round(performance.now() - t0), "ms");
    cards = list.map(legacyToProjectCard);
  }
  const result = aggregateProjectsIntoSummary(cards, delayMinDays);
  console.info("[dashboard] fallback aggregate →", result);
  return result;
}

/* The BE summary response uses different field names than the
   doc-spec frontend was written against (counts/delayedTrack/
   topOrganisations/topDivisions instead of totals/delayedProjects/
   byOrganisation/byDivision). This adapter maps it to the canonical
   internal shape the views consume — so both the live endpoint and
   the client-side fallback aggregator emit the same view-model. */
export function normalizeSummaryResponse(data) {
  if (!data || typeof data !== "object") return null;
  const counts = data.totals || data.counts;
  if (!counts || typeof counts !== "object") return null;

  const totalProjects = counts.projects ?? counts.total ?? 0;
  const completed = counts.completed ?? 0;
  const totals = {
    projects: totalProjects,
    completed,
    ontrack: counts.ontrack ?? 0,
    delayed: counts.delayed ?? 0,
    active: counts.active ?? Math.max(totalProjects - completed, 0),
  };

  const orgSource = data.byOrganisation || data.topOrganisations || [];
  const byOrganisation = (Array.isArray(orgSource) ? orgSource : []).map((o) => {
    const c = o.counts || o;
    return {
      name: o.name,
      vendorId: o.id || o.vendorId || null,
      total: c.total ?? o.projectCount ?? o.total ?? 0,
      completed: c.completed ?? 0,
      ontrack: c.ontrack ?? 0,
      delayed: c.delayed ?? 0,
    };
  });

  const divSource = data.byDivision || data.topDivisions || [];
  const byDivision = (Array.isArray(divSource) ? divSource : []).map((dv) => {
    const c = dv.counts || dv;
    return {
      name: dv.label || dv.name || dv.code || "—",
      code: dv.code || null,
      total: c.total ?? dv.projectCount ?? dv.total ?? 0,
      completed: c.completed ?? 0,
      ontrack: c.ontrack ?? 0,
      delayed: c.delayed ?? 0,
    };
  });

  const delayedSource = data.delayedProjects || data.delayedTrack || [];
  const delayedProjects = (Array.isArray(delayedSource) ? delayedSource : []).map((dp) => {
    const orgs = Array.isArray(dp.organisations) ? dp.organisations : [];
    const orgName = orgs[0]?.name || dp.organisation || "—";
    return {
      projectId: dp.projectId || dp.id || "",
      projectCode: dp.projectCode || dp.id || "",
      name: dp.name || "",
      organisation: orgName,
      division: dp.divisionLabel || dp.division || "—",
      delayedItems: dp.delayedItems ?? dp.delayedItemCount ?? 0,
      maxDelayDays: dp.maxDelayDays ?? 0,
    };
  });

  return { totals, byOrganisation, byDivision, delayedProjects };
}

/* Same shape /dashboard/summary returns, but built client-side from
   the per-project list. Each ProjectCard carries the BE-computed
   bucket and _be aggregates already, so this is a pure transform. */
function aggregateProjectsIntoSummary(cards, delayMinDays = 0) {
  const totals = { projects: cards.length, active: 0, completed: 0, ontrack: 0, delayed: 0 };
  const byOrg = new Map();
  const byDiv = new Map();
  const delayedProjects = [];

  for (const card of cards) {
    const bucket = card?.bucket || "active";
    if (totals[bucket] != null) totals[bucket]++;

    const orgName = pickOrgName(card);
    bumpGroup(byOrg, orgName, bucket);

    const divName = card?.division || card?.divisionOther || "—";
    bumpGroup(byDiv, divName, bucket);

    const delayCount = card?.delayedItemCount || 0;
    const maxDelay = card?.maxDelayDays || 0;
    if (bucket === "delayed" && delayCount > 0 && maxDelay >= delayMinDays) {
      delayedProjects.push({
        projectId: card.id,
        projectCode: card.projectCode || card.id,
        name: card.name || "",
        organisation: orgName,
        division: divName,
        delayedItems: delayCount,
        maxDelayDays: maxDelay,
      });
    }
  }

  delayedProjects.sort((a, b) => b.delayedItems - a.delayedItems || b.maxDelayDays - a.maxDelayDays);

  return {
    totals,
    byOrganisation: Array.from(byOrg.values()).sort((a, b) => b.total - a.total || a.name.localeCompare(b.name)),
    byDivision: Array.from(byDiv.values()).sort((a, b) => b.total - a.total || a.name.localeCompare(b.name)),
    delayedProjects,
  };
}

function pickOrgName(card) {
  const orgs = Array.isArray(card?.organisations) ? card.organisations : [];
  return orgs[0]?.name || "—";
}

function bumpGroup(map, name, bucket) {
  const key = name || "—";
  const g = map.get(key) || { name: key, total: 0, active: 0, completed: 0, ontrack: 0, delayed: 0 };
  g.total++;
  if (g[bucket] != null) g[bucket]++;
  map.set(key, g);
}

/* Reshape a legacy `/api/v3/projects` row back into the ProjectCard
   shape so the aggregator above can consume both data paths. The raw
   list lacks the BE aggregates, so we default bucket/counts to zero — the
   summary still renders, just with empty delayed/active rollups. */
function legacyToProjectCard(p) {
  const status = String(p?.status || "NEW").toUpperCase();
  return {
    id: p?.uuid || p?.id || "",
    projectCode: p?.projectCode || p?.id || "",
    name: p?.name || "",
    organisations: Array.isArray(p?.organisations) ? p.organisations.map((o) => (typeof o === "object" ? o : { name: o })) : [],
    division: p?.division || p?.owner || "—",
    bucket: status === "COMPLETED" ? "completed" : "active",
    delayedItemCount: 0,
    maxDelayDays: 0,
    progressPct: 0,
  };
}

export async function projectsList({ bucket, q, vendorId, division, page, pageSize } = {}) {
  // page/pageSize intentionally not defaulted — caller decides, and when
  // omitted the BE applies its own defaults (no pagination params in URL).
  const res = await withTimeout(
    api.get(ENDPOINTS.dashboard.projects, {
      query: { bucket, q, vendorId, division, page, pageSize },
    }),
    DASHBOARD_TIMEOUT_MS, "projects list",
  );
  return unwrap(res);
}

/* Fallback when /dashboard/projects is slow/hung on the BE: pull the raw
   /api/v3/projects list and reshape each row into the same legacy form
   the dashboard helpers expect. No `_be` aggregates are available here, so
   KPI counts / progress / delayed buckets degrade to 0 — the user still
   sees the project list and can navigate. */
export async function projectsListFallback({ offset, pageSize } = {}) {
  // offset/pageSize intentionally not defaulted; BE picks sensible defaults
  // when the params are absent from the URL.
  const res = await api.get(ENDPOINTS.projects.list, {
    query: { offset, pageSize },
  });
  const elements =
    res?.data?._embedded?.elements ??
    res?._embedded?.elements ??
    res?.data?.items ??
    res?.items ??
    (Array.isArray(res?.data) ? res.data : null) ??
    (Array.isArray(res) ? res : []);
  const list = Array.isArray(elements) ? elements : [];
  return list.map(rawProjectToLegacy).filter(Boolean);
}

/* Accept the response envelopes used by the dashboard list endpoints. */
export function extractProjectsPayload(payload) {
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload?.projects)) return payload.projects;
  if (Array.isArray(payload?.items)) return payload.items;
  if (Array.isArray(payload?.rows)) return payload.rows;
  if (Array.isArray(payload?.data?.projects)) return payload.data.projects;
  if (Array.isArray(payload?.data?.items)) return payload.data.items;
  if (Array.isArray(payload?.data?.rows)) return payload.data.rows;
  if (Array.isArray(payload?.data)) return payload.data;
  return [];
}

function rawProjectToLegacy(p) {
  if (!p) return null;
  const orgList = Array.isArray(p.vendors) ? p.vendors : [];
  const primaryOrg = orgList[0] || null;
  let orgName = '—';
  if (primaryOrg && typeof primaryOrg === 'object') {
    orgName = primaryOrg.name || '—';
  } else if (primaryOrg) {
    orgName = String(primaryOrg);
  }
  return {
    id: p.projectCode || p.id || p.uuid,
    uuid: p.id || p.uuid,
    projectCode: p.projectCode || '',
    name: p.name || '',
    description: p.description || '',
    organisation: orgName,
    organisations: orgList,
    vendorId: primaryOrg && typeof primaryOrg === 'object' ? primaryOrg.id : null,
    division: p.owner || '—',
    divisionCode: p.owner || null,
    owner: p.owner || '—',
    status: String(p.status || 'NEW').toUpperCase(),
    plannedStart: fromApiDate(p.startDate),
    plannedEnd: fromApiDate(p.endDate),
    actualStart: fromApiDate(p.actualStartDate),
    actualEnd: fromApiDate(p.actualEndDate),
    milestones: [],
  };
}

export async function projectDetail(uuid, { delayMinDays = 5 } = {}) {
  const res = await api.get(ENDPOINTS.dashboard.project(uuid), {
    query: { delayMinDays },
  });
  return unwrap(res);
}

export async function projectItems(uuid, { kind, bucket, milestoneId, minDelay } = {}) {
  // Only forward params the caller explicitly set — sending an
  // unsolicited `minDelay=0` once made some BE deploys blank the
  // response, so we let the server apply its own default.
  const res = await withTimeout(
    api.get(ENDPOINTS.dashboard.projectItems(uuid), {
      query: { kind, bucket, milestoneId, minDelay },
    }),
    DASHBOARD_TIMEOUT_MS, "project items",
  );
  return unwrap(res);
}

export async function organisations() {
  const res = await api.get(ENDPOINTS.dashboard.organisations);
  return unwrap(res);
}

export async function organisation(vendorId) {
  const res = await api.get(ENDPOINTS.dashboard.organisation(vendorId));
  return unwrap(res);
}

/* ─── Shape adapters: API → legacy Dashboard shape ─────────────── */

// Convert a BE ProjectCard into the shape the existing Dashboard helpers
// consume. Empty milestones[] is intentional — list view never needs the
// tree. Counts that the existing UI helpers would derive are attached
// under `_be` so the helpers can short-circuit and use BE-computed values
// (which are the source of truth per the locked spec).
export function projectCardToLegacy(card) {
  if (!card) return null;
  const orgList = Array.isArray(card.organisations) ? card.organisations : [];
  const primaryOrg = orgList[0] || null;
  return {
    id: card.projectCode || card.id,
    uuid: card.id,
    projectCode: card.projectCode || '',
    name: card.name || '',
    description: card.description || '',
    organisation: primaryOrg ? primaryOrg.name : '—',
    organisations: orgList,
    vendorId: primaryOrg ? primaryOrg.id : null,
    division: card.division || (card.divisionOther ? `${card.division || ''} (${card.divisionOther})` : '—'),
    divisionCode: card.division || null,
    owner: '—',
    status: String(card.lifecycleStatus || 'NEW').toUpperCase(),
    plannedStart: fromApiDate(card.plannedStart),
    plannedEnd: fromApiDate(card.plannedEnd),
    actualStart: fromApiDate(card.actualStart),
    actualEnd: fromApiDate(card.actualEnd),
    milestones: [],
    _be: {
      bucket: card.bucket,
      progressPct: card.progressPct,
      milestonesTotal: card.milestonesTotal,
      milestonesCompleted: card.milestonesCompleted,
      activitiesTotal: card.activitiesTotal,
      activitiesCompleted: card.activitiesCompleted,
      delayedItemCount: card.delayedItemCount,
      maxDelayDays: card.maxDelayDays,
    },
  };
}

// Convert an ItemRow (milestone | activity) returned by /dashboard/projects/{id}/items
// into a track-row shape compatible with the Dashboard's row table. WBS comes
// straight from BE so the FE doesn't have to compute it.
export function itemRowToTrackRow(row, project) {
  const pick = (camel, snake) => row[camel] !== undefined ? row[camel] : row[snake];
  return {
    project,
    key: `${row.kind}:${row.id}`,
    parentKey: row.kind === 'activity' && row.milestoneId ? `milestone:${row.milestoneId}` : null,
    kind: row.kind,
    wbs: row.wbs,
    name: row.name,
    context: row.milestoneName || project.name,
    node: row,
    status: row.bucket || 'active',
    progress: row.progressPct ?? 0,
    plannedStart: fromApiDate(row.plannedStart),
    plannedEnd: fromApiDate(row.plannedEnd),
    actualStart: fromApiDate(row.actualStart),
    actualEnd: fromApiDate(row.actualEnd),
    delay: row.daysDelayed ?? 0,
    approvalState: row.kind === 'activity' ? (pick('approvalState', 'approval_state') || 'idle') : null,
  };
}

// Convert the legacy `/api/v3/projects/{uuid}/tree` payload (returned by
// the existing projects.getTree call) into the project shape the
// dashboard helpers (flattenRows, etc.) expect — preserving M → A → T → ST.
// The dashboard uses this for the Track Progress 4-level drill-down.
export function treeToLegacyProject(tree, base) {
  if (!tree) return base;
  const project = tree.project || tree;
  const milestones = Array.isArray(tree.milestones) ? tree.milestones.map(mapMilestone) : [];
  return {
    ...base,
    milestones,
    plannedStart: fromApiDate(project.startDate) || base.plannedStart,
    plannedEnd: fromApiDate(project.endDate) || base.plannedEnd,
    actualStart: fromApiDate(project.actualStartDate) || base.actualStart,
    actualEnd: fromApiDate(project.actualEndDate) || base.actualEnd,
    owner: project.owner || base.owner,
  };
}

function mapMilestone(m) {
  const pick = (camel, snake) => m[camel] !== undefined ? m[camel] : m[snake];
  return {
    uid: pick('uuid', 'uuid') || pick('id', 'id'),
    displayCode: pick('displayCode', 'display_code'),
    name: m.name || '',
    plannedStart: fromApiDate(pick('startDate', 'start_date')),
    plannedEnd: fromApiDate(pick('endDate', 'end_date')),
    actualStart: fromApiDate(pick('actualStartDate', 'actual_start_date')),
    actualEnd: fromApiDate(pick('actualEndDate', 'actual_end_date')),
    status: m.status,
    scheduleStatus: pick('scheduleStatus', 'schedule_status'),
    daysDelayed: pick('daysDelayed', 'days_delayed') || 0,
    activities: Array.isArray(m.activities) ? m.activities.map(mapActivity) : [],
  };
}

function mapActivity(a) {
  const pick = (camel, snake) => a[camel] !== undefined ? a[camel] : a[snake];
  return {
    uid: pick('uuid', 'uuid') || pick('id', 'id'),
    displayCode: pick('displayCode', 'display_code'),
    name: a.name || '',
    plannedStart: fromApiDate(pick('startDate', 'start_date')),
    plannedEnd: fromApiDate(pick('endDate', 'end_date')),
    actualStart: fromApiDate(pick('actualStartDate', 'actual_start_date')),
    actualEnd: fromApiDate(pick('actualEndDate', 'actual_end_date')),
    status: a.status,
    scheduleStatus: pick('scheduleStatus', 'schedule_status'),
    daysDelayed: pick('daysDelayed', 'days_delayed') || 0,
    approvalState: pick('approvalState', 'approval_state') || 'idle',
    tasks: Array.isArray(a.tasks) ? a.tasks.map(mapTask) : [],
  };
}

function mapTask(t) {
  const pick = (camel, snake) => t[camel] !== undefined ? t[camel] : t[snake];
  return {
    uid: pick('uuid', 'uuid') || pick('id', 'id'),
    displayCode: pick('displayCode', 'display_code'),
    name: t.name || '',
    plannedStart: fromApiDate(pick('startDate', 'start_date')),
    plannedEnd: fromApiDate(pick('endDate', 'end_date')),
    actualStart: fromApiDate(pick('actualStartDate', 'actual_start_date')),
    actualEnd: fromApiDate(pick('actualEndDate', 'actual_end_date')),
    status: t.status,
    subtasks: (Array.isArray(t.subtasks) ? t.subtasks : t.sub_tasks || []).map(mapSubtask),
  };
}

function mapSubtask(s) {
  const pick = (camel, snake) => s[camel] !== undefined ? s[camel] : s[snake];
  return {
    uid: pick('uuid', 'uuid') || pick('id', 'id'),
    displayCode: pick('displayCode', 'display_code'),
    name: s.name || '',
    plannedStart: fromApiDate(pick('startDate', 'start_date')),
    plannedEnd: fromApiDate(pick('endDate', 'end_date')),
    actualStart: fromApiDate(pick('actualStartDate', 'actual_start_date')),
    actualEnd: fromApiDate(pick('actualEndDate', 'actual_end_date')),
    status: s.status,
    subtasks: (Array.isArray(s.subtasks) ? s.subtasks : s.sub_tasks || []).map(mapSubtask),
  };
}
