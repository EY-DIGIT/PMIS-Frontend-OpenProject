/* ══════════════════════════════════════════════════════════════════
   src/api/plannedResources.js  —  resource-type phase costing

   On a resource-type phase the resource cost is NOT a typed amount: it is
   built from planned-resource rows. One row = role + deployment window +
   headcount, priced by the backend PER CONTRACT YEAR:

       for each Year-N the window spans:
         quantity × rateCardByYear["Year-N"] × months-in-that-year
       Σ  =  computedCost      (the per-year split comes back as costByYear)

   Contract years are anchored on the project start date, and a window
   running past the card's last year is clamped to that year's rate.
   `durationMonths` is the fractional total across the whole window.

   Rows attach to a `resource_cost` cost item via `costItemId`, and their SUM
   auto-populates that cost item — i.e. the phase's resource cost.

   ── Two services ──────────────────────────────────────────────────────
   ROLES + RATES come from leave-management (the resource service on
   :8019), the same source the Designation Rates page uploads to:
     GET /api/designation-rates?projectId=&organisationId=
       → [{ id, role, projectId, organisationId, rateCardByYear }]
   The payment backend does NOT call that service, so the FE passes the
   chosen `role` together with its `rateCardByYear` on every write.

   PLANNED RESOURCES live on the /projects gateway. Note the asymmetry:
   requests are camelCase (`costItemId`, `rateCardByYear`) but responses
   come back snake_case (`cost_item_id`, `rate_card_snapshot`,
   `cost_by_year`) with the money fields as STRINGS. Both are normalized to
   camelCase numbers here so the page never has to guess.

   The masters designation catalog (/master/…/designations) this module used
   to read is GONE — there is no designationId or monthlyRateSnapshot any
   more, and the create endpoint rejects unknown keys.
   ══════════════════════════════════════════════════════════════════ */

import { api } from './client';
import { ENDPOINTS } from './endpoint';
import { getToken } from './auth';
import { readErrorMessage, readJsonBody, requestErrorMessage } from '../utils/apiMessage';

/* Leave-management / resource service — NOT the gateway the rest of this
   module talks to. Same host:port the Resource, Attendance and Designation
   Rates pages use. */
const RESOURCE_API_BASE =
  import.meta.env.VITE_RESOURCE_API_BASE_URL || 'http://10.1.131.199:8019';

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

/* Year-keyed money maps arrive as { "Year-1": "198434.00" } — strings, and
   sometimes absent. Normalize to numbers, dropping anything unparseable so a
   partial map still renders. */
function yearMap(raw) {
  if (!raw || typeof raw !== 'object') return {};
  const out = {};
  Object.keys(raw).forEach((k) => {
    const v = num(raw[k]);
    if (v != null) out[k] = v;
  });
  return out;
}

/* "Year-1", "Year-2", … "Year-10" — sort by the trailing number so 10
   doesn't land between 1 and 2. Same rule as the Designation Rates page. */
export const yearKeyOrder = (a, b) =>
  (parseInt(String(a).replace(/\D+/g, ''), 10) || 0) -
  (parseInt(String(b).replace(/\D+/g, ''), 10) || 0);

export const sortedYearKeys = (map) => Object.keys(map || {}).sort(yearKeyOrder);

/* ── roles + rate cards (leave-management, :8019) ──────────────────── */

/* GET /api/designation-rates?projectId=&organisationId=
   → [{ id, role, projectId, organisationId, rateCardByYear }]

   BOTH ids are required by the service, so a missing organisation means
   there is nothing to ask for rather than an unfiltered list. Rates are
   monthly ₹ per contract year.

   This service sits outside the gateway's api client, so the call is a
   plain fetch with the bearer token — the same shape DesignationRatePage
   uses against it. */
export async function listDesignationRates(projectId, organisationId) {
  if (!projectId || !organisationId) return [];
  const token = getToken();
  const FALLBACK = "Couldn't load the rate card.";
  let res;
  try {
    res = await fetch(
      `${RESOURCE_API_BASE}${ENDPOINTS.designationRates.list(projectId, organisationId)}`,
      { headers: { accept: '*/*', ...(token ? { Authorization: `Bearer ${token}` } : {}) } }
    );
  } catch (err) {
    throw new Error(requestErrorMessage(err, FALLBACK));
  }
  if (!res.ok) throw new Error(await readErrorMessage(res, FALLBACK));
  // An empty 200 means no rates are on file yet, not a failure.
  const data = await readJsonBody(res, FALLBACK);
  const rows = Array.isArray(data) ? data : data ? [data] : [];
  return rows
    .map((r) => ({
      id: r?.id || r?.role || '',
      role: r?.role || '',
      organisationId: r?.organisationId || r?.organisation_id || '',
      rateCardByYear: yearMap(r?.rateCardByYear || r?.rate_card_by_year),
    }))
    .filter((r) => r.role);
}

/* ── planned resources (project gateway) ───────────────────────────── */

/* role / vendorId / rateCardSnapshot / costByYear / durationMonths /
   computedCost are all BE-computed and read-only. rateCardSnapshot is a
   SNAPSHOT: re-uploading the rate card does not retro-price existing rows —
   PATCH the row with the new rateCardByYear to re-price it. */
function rowFromApi(r) {
  if (!r || typeof r !== 'object') return null;
  const id = r.id || r.uuid || '';
  if (!id) return null;
  return {
    id,
    costItemId: r.costItemId || r.cost_item_id || '',
    role: r.role || '',
    quantity: num(r.quantity) ?? 0,
    deployStart: ymd(r.deployStart || r.deploy_start),
    deployEnd: ymd(r.deployEnd || r.deploy_end),
    vendorId: r.vendorId || r.vendor_id || '',
    rateCardSnapshot: yearMap(r.rateCardSnapshot || r.rate_card_snapshot),
    // The per-contract-year split of computedCost, { "Year-N": amount }.
    costByYear: yearMap(r.costByYear || r.cost_by_year),
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
   { costItemId, role, rateCardByYear, organisationId, quantity,
     deployStart, deployEnd }
   costItemId + role + rateCardByYear are required, and the endpoint rejects
   unknown keys — so only these are ever sent. */
export async function createPlannedResource(projectUuid, row) {
  const res = await api.post(ENDPOINTS.projects.plannedResources(projectUuid), {
    costItemId: row.costItemId,
    role: row.role,
    rateCardByYear: row.rateCardByYear || {},
    organisationId: row.organisationId || null,
    quantity: Number(row.quantity),
    deployStart: ymd(row.deployStart),
    deployEnd: ymd(row.deployEnd),
  });
  return rowFromApi(unwrapOne(res));
}

/* PATCH /planned-resources/{id} — role, rateCardByYear, organisationId,
   quantity, deployStart, deployEnd. Changing the role means changing the
   rate card with it, so callers pass both together. The cost item a row
   belongs to can't be changed. */
export async function updatePlannedResource(id, patch = {}) {
  const body = {};
  if (patch.role !== undefined) body.role = patch.role;
  if (patch.rateCardByYear !== undefined) body.rateCardByYear = patch.rateCardByYear;
  if (patch.organisationId !== undefined) body.organisationId = patch.organisationId;
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
