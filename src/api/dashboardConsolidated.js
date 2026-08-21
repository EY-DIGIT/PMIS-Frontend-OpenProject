/* ══════════════════════════════════════════════════════════════════
   src/api/dashboardConsolidated.js

   Thin wrappers for the four consolidated dashboard endpoints the BE
   shipped on 2026-07. Each returns the WHOLE view's data in a single
   response, replacing the old fan-out (per-project payment-page loop +
   tickets + meetings + approval-inbox):

     summaryView()            -> Summary view
     projectFull(uuid)         -> Project view (single-project deep dive)
     organisationViewAll()     -> Organization view, All-Orgs mode
     organisationViewById(id)  -> Organization view, Single-Org mode

   Response envelope is the standard { data, message, error, status };
   unwrap() returns the inner `data`. A hard timeout guards against the
   BE hanging (same 60s ceiling the legacy dashboard.js uses).
   ══════════════════════════════════════════════════════════════════ */

import { api } from './client';
import { ENDPOINTS } from './endpoint';
import { summaryWithFallback } from './dashboard';

const DASHBOARD_TIMEOUT_MS = 60000;

function withTimeout(promise, ms = DASHBOARD_TIMEOUT_MS, label = 'request') {
  let timer;
  const t = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} timed out`)), ms);
  });
  return Promise.race([promise, t]).finally(() => clearTimeout(timer));
}

// BE wraps successful payloads in `{ data, message, error, status }`.
// A few environments return the payload at the root — accept both.
function unwrap(res) {
  if (res && typeof res === 'object' && 'data' in res && res.data !== null && res.data !== undefined) {
    return res.data;
  }
  return res;
}

/* Summary view — one call for every KPI card / widget / table. */
export async function summaryView({ delayMinDays = 1, topN = 5 } = {}) {
  const res = await withTimeout(
    api.get(ENDPOINTS.dashboard.summaryView, { query: { delayMinDays, topN } }),
    DASHBOARD_TIMEOUT_MS, 'dashboard summary-view',
  );
  return unwrap(res);
}

/* Keep Summary usable while older deployments expose only /dashboard/summary. */
export async function summaryViewWithFallback(options = {}) {
  try {
    return await summaryView(options);
  } catch (consolidatedError) {
    const legacy = await summaryWithFallback(options);
    const totals = legacy?.totals || {};
    const total = totals.projects ?? 0;
    const ontrack = totals.ontrack ?? 0;
    return {
      kpis: {
        totalProjects: { value: total, active: totals.active ?? 0, completed: totals.completed ?? 0 },
        onTrackPct: { value: total ? Math.round(ontrack / total * 100) : 0 },
        delayedProjects: { value: totals.delayed ?? 0 },
        contractValue: { value: 0, projectCount: 0, withFinance: 0 },
        slaCompliance: { value: null },
      },
      projectStatus: totals,
      topOrganizations: (legacy.byOrganisation || []).map((row) => ({ ...row, value: 0 })),
      topDivisions: (legacy.byDivision || []).map((row) => ({ ...row, value: 0 })),
      delayedTrack: legacy.delayedProjects || [],
      paymentByPhase: [], paymentByOrganization: [], costComposition: {},
      slaHealth: { available: false }, approvalWorkflow: { available: false },
      tickets: { available: false }, escalationsTriggered: [],
      _fallbackReason: consolidatedError?.message || "summary-view unavailable",
    };
  }
}

/* Project view — one call for header, KPIs, finance, SLA, approvals,
   delayed track and the items table. `uuid` is the project UUID. */
export async function projectFull(uuid, { include } = {}) {
  const res = await withTimeout(
    api.get(ENDPOINTS.dashboard.projectFull(uuid), { query: { include } }),
    DASHBOARD_TIMEOUT_MS, 'dashboard project full',
  );
  return unwrap(res);
}

/* Organization view — All-Orgs mode (no id). Returns portfolio KPIs,
   leaderboard, payment-by-org, sla-by-org and the org signal table. */
export async function organisationViewAll({ topN = 8 } = {}) {
  const res = await withTimeout(
    api.get(ENDPOINTS.dashboard.organisationView, { query: { topN } }),
    DASHBOARD_TIMEOUT_MS, 'dashboard organisation-view',
  );
  return unwrap(res);
}

/* Organization view — Single-Org mode, keyed by organization id. Returns
   the org KPIs plus every drill-down tab (Overview / Projects / Payments /
   Delayed / SLA / Tickets / Meetings). */
export async function organisationViewById(organisationId) {
  const res = await withTimeout(
    api.get(ENDPOINTS.dashboard.organisationViewById(organisationId)),
    DASHBOARD_TIMEOUT_MS, 'dashboard organisation-view (by id)',
  );
  return unwrap(res);
}
