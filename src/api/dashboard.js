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
  const res = await api.get(ENDPOINTS.projects.tree(uuid));
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

export async function summary({ delayMinDays = 5 } = {}) {
  const res = await api.get(ENDPOINTS.dashboard.summary, {
    query: { delayMinDays },
  });
  return unwrap(res);
}

export async function projectsList({
  bucket,
  q,
  vendorId,
  division,
  page = 1,
  pageSize = 200,
} = {}) {
  const res = await api.get(ENDPOINTS.dashboard.projects, {
    query: { bucket, q, vendorId, division, page, pageSize },
  });
  return unwrap(res);
}

export async function projectDetail(uuid, { delayMinDays = 5 } = {}) {
  const res = await api.get(ENDPOINTS.dashboard.project(uuid), {
    query: { delayMinDays },
  });
  return unwrap(res);
}

export async function projectItems(uuid, { kind, bucket, milestoneId, minDelay = 0 } = {}) {
  const res = await api.get(ENDPOINTS.dashboard.projectItems(uuid), {
    query: { kind, bucket, milestoneId, minDelay },
  });
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
  };
}

// Convert the legacy `/api/v3/projects/{uuid}/tree` payload (returned by
// the existing projects.getTree call) into the project shape the
// dashboard helpers (flattenRows, etc.) expect — preserving M → A → T → ST.
// The dashboard uses this for the Track Progress 4-level drill-down.
export function treeToLegacyProject(tree, base) {
  if (!tree) return base;
  const milestones = Array.isArray(tree.milestones) ? tree.milestones.map(mapMilestone) : [];
  return {
    ...base,
    milestones,
    plannedStart: fromApiDate(tree.startDate) || base.plannedStart,
    plannedEnd: fromApiDate(tree.endDate) || base.plannedEnd,
    actualStart: fromApiDate(tree.actualStartDate) || base.actualStart,
    actualEnd: fromApiDate(tree.actualEndDate) || base.actualEnd,
    owner: tree.owner || base.owner,
  };
}

function mapMilestone(m) {
  return {
    uid: m.uuid || m.id,
    name: m.name || '',
    plannedStart: fromApiDate(m.startDate),
    plannedEnd: fromApiDate(m.endDate),
    actualStart: fromApiDate(m.actualStartDate),
    actualEnd: fromApiDate(m.actualEndDate),
    status: m.status,
    activities: Array.isArray(m.activities) ? m.activities.map(mapActivity) : [],
  };
}

function mapActivity(a) {
  return {
    uid: a.uuid || a.id,
    name: a.name || '',
    plannedStart: fromApiDate(a.startDate),
    plannedEnd: fromApiDate(a.endDate),
    actualStart: fromApiDate(a.actualStartDate),
    actualEnd: fromApiDate(a.actualEndDate),
    status: a.status,
    approvalState: a.approvalState || 'idle',
    tasks: Array.isArray(a.tasks) ? a.tasks.map(mapTask) : [],
  };
}

function mapTask(t) {
  return {
    uid: t.uuid || t.id,
    name: t.name || '',
    plannedStart: fromApiDate(t.startDate),
    plannedEnd: fromApiDate(t.endDate),
    actualStart: fromApiDate(t.actualStartDate),
    actualEnd: fromApiDate(t.actualEndDate),
    status: t.status,
    subtasks: Array.isArray(t.subtasks) ? t.subtasks.map(mapSubtask) : [],
  };
}

function mapSubtask(s) {
  return {
    uid: s.uuid || s.id,
    name: s.name || '',
    plannedStart: fromApiDate(s.startDate),
    plannedEnd: fromApiDate(s.endDate),
    actualStart: fromApiDate(s.actualStartDate),
    actualEnd: fromApiDate(s.actualEndDate),
    status: s.status,
    subtasks: Array.isArray(s.subtasks) ? s.subtasks.map(mapSubtask) : [],
  };
}
