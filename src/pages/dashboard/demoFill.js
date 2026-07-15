/* ══════════════════════════════════════════════════════════════════
   src/pages/dashboard/demoFill.js

   Sample/demo data for dashboard panels whose backend endpoint doesn't
   exist yet (SLA compliance, month-on-month trend + deltas, amount
   released, per-project approvals). This mirrors the project's existing
   convention (ticketsMock.js / dashboardMockData.js / demoData.js:
   "placeholder data so the UI can be designed and demoed before the
   backend exists").

   Everything here is DETERMINISTIC (seeded from a string) so a given
   project/org always renders the same sample — no flicker, no
   Math.random. Swap each generator for the real aggregate the moment
   BE ships /dashboard/finance + /dashboard/sla.

   Toggle DEMO_FILL to false to hide every sample panel and fall back to
   honest empty states.
   ══════════════════════════════════════════════════════════════════ */

export const DEMO_FILL = false;

/* Small deterministic hash → 0..1, so samples vary per entity but stay
   stable across renders. */
function seed(str) {
  let h = 2166136261;
  const s = String(str || "x");
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return ((h >>> 0) % 1000) / 1000;
}
function pick(seedStr, min, max) { return Math.round(min + seed(seedStr) * (max - min)); }

const MONTHS = ["Dec 24", "Jan 25", "Feb 25", "Mar 25", "Apr 25", "May 25"];

/* ─── Portfolio (Summary) samples ──────────────────────────────── */

export const SUMMARY_DELTAS = {
  projects: "↑ 12% vs last month",
  ontrack: "↑ 8% vs last month",
  delayed: "↑ 5 vs last month",
  contract: "↑ 18% vs last month",
  released: "↑ 14% vs last month",
  sla: "↑ 6% vs last month",
};

export const SUMMARY_SPARKS = {
  projects: [104, 108, 112, 116, 120, 128],
  ontrack: [61, 64, 66, 68, 70, 72],
  delayed: [40, 38, 41, 36, 35, 34],
  contract: [180, 198, 210, 228, 244, 256],
  released: [95, 108, 118, 128, 136, 143],
  sla: [78, 80, 82, 83, 84, 86],
};

/* SLA compliance headline for the portfolio. */
export function summarySla() {
  return { compliance: 86, met: 1248, breached: 203 };
}

/* Amount released proxy — a share of the (real) contract value so the
   card reads sensibly next to the real number. */
export function releasedFromContract(contractValue) {
  const pct = 0.559; // sample release ratio, matches mockup 55.9%
  return { amount: Math.round((contractValue || 0) * pct), pct: 55.9 };
}

/* Month-on-month trend — projects completed + amount released (₹ Cr). */
export function monthlyTrend() {
  return MONTHS.map((label, i) => ({
    label,
    Projects: [8, 12, 10, 16, 14, 22][i],
    "Released (Cr)": [12, 15, 18, 22, 28, 34][i],
  }));
}

/* Per-organization SLA compliance (met% / breached%). */
export function slaByOrg(names) {
  return (names || []).slice(0, 6).map((name) => {
    const met = pick("sla" + name, 61, 95);
    return { name, met, breached: 100 - met };
  });
}

/* ─── Project-level samples ────────────────────────────────────── */

export function projectSla(projectId) {
  const compliance = pick("psla" + projectId, 70, 95);
  const total = pick("pslaT" + projectId, 90, 140);
  const breached = Math.round(total * (100 - compliance) / 100);
  return { compliance, met: total - breached, breached };
}

/* Top-5 SLA breaches for a project. */
export function slaBreaches(projectId) {
  const base = [
    { activity: "Security Audit", sla: 5 },
    { activity: "Integration Test", sla: 7 },
    { activity: "UAT Execution", sla: 5 },
    { activity: "API Testing", sla: 3 },
    { activity: "Infra Setup", sla: 4 },
  ];
  return base.map((b, i) => {
    const actual = b.sla + pick(projectId + b.activity, 2, 14);
    return { ...b, actual, delay: actual - b.sla, wbs: `A${i + 1}.${i + 1}.${i + 2}` };
  }).sort((a, b) => b.delay - a.delay);
}

/* Approval status split by items for a project (donut). */
export function approvalStatusByItems(projectId) {
  const total = pick("as" + projectId, 180, 260);
  return {
    idle: Math.round(total * 0.40),
    pending_division: Math.round(total * 0.28),
    pending_owner: Math.round(total * 0.15),
    division_approved: Math.round(total * 0.12),
    rejected: Math.round(total * 0.05),
  };
}

/* Per-project approval workflow funnel (counts). */
export function projectWorkflow(projectId) {
  const s = pick("wf" + projectId, 200, 340);
  return [
    { label: "Draft", value: s },
    { label: "Submitted", value: Math.round(s * 0.8) },
    { label: "Pending Division", value: Math.round(s * 0.41) },
    { label: "Pending Owner", value: Math.round(s * 0.28) },
    { label: "Approved", value: Math.round(s * 3.6) },
    { label: "Rejected", value: Math.round(s * 0.13) },
  ];
}

export function projectPendingApprovals(projectId) { return pick("pa" + projectId, 4, 24); }

/* Payment release timeline (planned vs actual, ₹ Cr). */
export function paymentTimeline(projectId) {
  const pts = ["Jan 24", "Apr 24", "Jul 24", "Oct 24", "Jan 25", "Apr 25", "Jul 25", "Dec 25"];
  let planned = pick("pt" + projectId, 3, 6);
  let actual = planned - 1;
  return pts.map((label, i) => {
    planned += pick(projectId + i, 3, 7);
    actual += pick(projectId + i + "a", 2, 6);
    return { label, "Planned (Cr)": planned, "Actual (Cr)": Math.min(actual, planned) };
  });
}

/* ─── Org drill-down samples ───────────────────────────────────── */

export function orgSla(name) { return pick("osla" + name, 68, 95); }
export function orgOpenTickets(name) { return pick("otk" + name, 4, 18); }
export function orgHighTickets(name) { return pick("oth" + name, 1, 6); }
export function orgUpcomingMeetings(name) { return pick("omt" + name, 2, 9); }
