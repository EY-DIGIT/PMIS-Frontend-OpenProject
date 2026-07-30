/* ══════════════════════════════════════════════════════════════════
   src/api/plannedResources.js  —  resource-type phase costing

   On a resource-type phase the resource cost is NOT a typed amount: it is
   built from planned-resource rows. One row = designation + deployment
   window + headcount, which the backend prices as

       monthlyRateSnapshot × durationMonths × quantity = computedCost

   `durationMonths` is fractional (days / 30.44 — Apr 1 → Jun 30 ≈ 2.99).
   Several rows may share a designation; they all accumulate, and the SUM of
   a cost item's rows IS the phase's resource cost.

   Rows attach to a `resource_cost` cost item via `costItemId`, so a phase
   must have one before any row can be added.

   ⚠ Two gateways, two casings — the reason this module exists:
     • designations live on /master and speak snake_case
       ({ vendor_id, monthly_rate })
     • planned resources live on /projects and speak camelCase
       ({ costItemId, designationId, deployStart })
   Both are normalized to camelCase here so the page never has to guess.
   ══════════════════════════════════════════════════════════════════ */

import { api } from './client';
import { ENDPOINTS } from './endpoint';

/* Payloads arrive as the bare object, { data: … }, or a HAL collection
   depending on the gateway — flatten all three shapes. */
function unwrapList(res) {
  if (Array.isArray(res)) return res;
  if (Array.isArray(res?._embedded?.elements)) return res._embedded.elements;
  if (Array.isArray(res?.data?._embedded?.elements)) return res.data._embedded.elements;
  if (Array.isArray(res?.items)) return res.items;
  if (Array.isArray(res?.data?.items)) return res.data.items;
  if (Array.isArray(res?.data)) return res.data;
  return [];
}

function unwrapOne(res) {
  if (res && typeof res === 'object' && res.data && typeof res.data === 'object' && !Array.isArray(res.data)) {
    return res.data;
  }
  return res;
}

const num = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

/* ISO datetime or YYYY-MM-DD → YYYY-MM-DD (what the API and <input
   type="date"> both want). */
const ymd = (v) => (typeof v === 'string' && v.length >= 10 ? v.slice(0, 10) : '');

/* ── designations (master, snake_case) ─────────────────────────────── */

function designationFromApi(d) {
  if (!d || typeof d !== 'object') return null;
  const id = d.id || d.uuid || '';
  if (!id) return null;
  return {
    id,
    code: d.code || '',
    name: d.name || d.code || '',
    vendorId: d.vendor_id || d.vendorId || '',
    // Per MONTH — the rate a planned-resource row is priced from.
    monthlyRate: num(d.monthly_rate ?? d.monthlyRate) ?? 0,
    active: d.active !== false,
  };
}

/* GET /master/designations?vendor_id={orgId} → a plain array.

   The server defaults to active-only (include_inactive=false), so anything
   returned here is live.

   `vendor_id` in the master is NULLABLE, so a designation may be global (no
   org) rather than org-specific — and the server-side vendor_id filter drops
   those. Callers that need "everything this org may use" therefore ask for
   both and merge; see listDesignationsForVendor. */
export async function listDesignations(vendorId) {
  const rows = unwrapList(await api.get(ENDPOINTS.master.designations(vendorId)));
  return rows.map(designationFromApi).filter(Boolean);
}

/* Everything the given org may be priced from: its own designations plus the
   global (vendor_id = null) ones, de-duplicated, org-specific first.

   Returns { rows, scope } where scope is
     'vendor' — at least one org-specific row was found
     'global' — only unscoped rows exist
     'all'    — nothing matched the org, so every designation is offered
                (the picker says so, rather than showing an empty list)
   With no vendorId there is nothing to scope by, so one unfiltered call. */
export async function listDesignationsForVendor(vendorId) {
  if (!vendorId) {
    return { rows: await listDesignations(''), scope: 'all' };
  }
  /* One request can fail while the other succeeds (a bad vendor_id 422s);
     surface a problem only when BOTH fail, so a partial answer still fills
     the picker. */
  const [mine, all] = await Promise.allSettled([
    listDesignations(vendorId),
    listDesignations(''),
  ]);
  if (mine.status === 'rejected' && all.status === 'rejected') throw mine.reason;

  const scoped = mine.status === 'fulfilled' ? mine.value : [];
  const everything = all.status === 'fulfilled' ? all.value : [];
  const global = everything.filter((d) => !d.vendorId);

  const seen = new Set();
  const merge = (list) => list.filter((d) => (seen.has(d.id) ? false : seen.add(d.id)));

  if (scoped.length) return { rows: [...merge(scoped), ...merge(global)], scope: 'vendor' };
  if (global.length) return { rows: merge(global), scope: 'global' };
  return { rows: merge(everything), scope: 'all' };
}

/* POST /master/designations/create — snake_case on the way out. */
export async function createDesignation({ code, name, vendorId, monthlyRate }) {
  const res = await api.post(ENDPOINTS.master.designationCreate, {
    code,
    name,
    vendor_id: vendorId,
    monthly_rate: monthlyRate,
  });
  return designationFromApi(unwrapOne(res));
}

/* PATCH /master/designations/{id} — only the fields passed are sent, so a
   rate change can't accidentally rename the designation.

   `code` is deliberately absent: DesignationUpdateRequest rejects unknown
   keys (additionalProperties: false) and does not accept a code, so a code is
   fixed at creation time. Sending one 422s the whole PATCH. */
export async function updateDesignation(id, patch = {}) {
  const body = {};
  if (patch.name !== undefined) body.name = patch.name;
  if (patch.vendorId !== undefined) body.vendor_id = patch.vendorId;
  if (patch.monthlyRate !== undefined) body.monthly_rate = patch.monthlyRate;
  if (patch.active !== undefined) body.active = patch.active;
  const res = await api.patch(ENDPOINTS.master.designationUpdate(id), body);
  return designationFromApi(unwrapOne(res));
}

/* ── planned resources (project, camelCase) ────────────────────────── */

/* vendorId / monthlyRateSnapshot / durationMonths / computedCost are all
   BE-computed and read-only. monthlyRateSnapshot is a SNAPSHOT: a later
   change to the designation master does not retro-price existing rows. */
function rowFromApi(r) {
  if (!r || typeof r !== 'object') return null;
  const id = r.id || r.uuid || '';
  if (!id) return null;
  return {
    id,
    costItemId: r.costItemId || r.cost_item_id || '',
    designationId: r.designationId || r.designation_id || '',
    designationName: r.designationName || r.designation_name || '',
    quantity: num(r.quantity) ?? 0,
    deployStart: ymd(r.deployStart || r.deploy_start),
    deployEnd: ymd(r.deployEnd || r.deploy_end),
    vendorId: r.vendorId || r.vendor_id || '',
    monthlyRateSnapshot: num(r.monthlyRateSnapshot ?? r.monthly_rate_snapshot) ?? 0,
    durationMonths: num(r.durationMonths ?? r.duration_months) ?? 0,
    computedCost: num(r.computedCost ?? r.computed_cost) ?? 0,
  };
}

/* GET /projects/{projectUuid}/planned-resources — every row on the project,
   across all its cost items. Group by costItemId to get one phase's rows. */
export async function listPlannedResources(projectUuid) {
  if (!projectUuid) return [];
  const rows = unwrapList(await api.get(ENDPOINTS.projects.plannedResources(projectUuid)));
  return rows.map(rowFromApi).filter(Boolean);
}

/* POST /projects/{projectUuid}/planned-resources
   { costItemId, designationId, quantity, deployStart, deployEnd } */
export async function createPlannedResource(projectUuid, row) {
  const res = await api.post(ENDPOINTS.projects.plannedResources(projectUuid), {
    costItemId: row.costItemId,
    designationId: row.designationId,
    quantity: Number(row.quantity),
    deployStart: ymd(row.deployStart),
    deployEnd: ymd(row.deployEnd),
  });
  return rowFromApi(unwrapOne(res));
}

/* PATCH /planned-resources/{id} — designationId, quantity, deployStart,
   deployEnd. The cost item a row belongs to can't be changed. */
export async function updatePlannedResource(id, patch = {}) {
  const body = {};
  if (patch.designationId !== undefined) body.designationId = patch.designationId;
  if (patch.quantity !== undefined) body.quantity = Number(patch.quantity);
  if (patch.deployStart !== undefined) body.deployStart = ymd(patch.deployStart);
  if (patch.deployEnd !== undefined) body.deployEnd = ymd(patch.deployEnd);
  const res = await api.patch(ENDPOINTS.plannedResources.update(id), body);
  return rowFromApi(unwrapOne(res));
}

/* DELETE /planned-resources/{id} */
export async function removePlannedResource(id) {
  await api.del(ENDPOINTS.plannedResources.remove(id));
  return true;
}
