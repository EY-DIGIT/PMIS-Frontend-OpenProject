/* ══════════════════════════════════════════════════════════════════
   src/api/designationRates.js  —  roles + per-contract-year rate cards

   The source of truth for "what roles can be deployed, and at what monthly
   rate" is the leave-management (resource) service — the same data the
   Designation Rates page uploads:

     GET /api/designation-rates?projectId=&organisationId=
       → [{ id, role, projectId, organisationId, rateCardByYear }]

   `rateCardByYear` is monthly ₹ keyed by contract year ({ "Year-1": … }),
   the years being slices of the project window anchored on its start date.

   Where this is used: a resource-based activity carries allocation rows of
   { designation, quantity, duration }, where `designation` IS the `role`
   name from this list. The project backend resolves the rate itself when the
   activity is saved — the FE only needs this list to populate the picker and
   to preview a cost before saving.

   This service sits outside the gateway's api client (different host/port),
   so calls are a plain fetch with the bearer token, matching how
   DesignationRatePage talks to it.
   ══════════════════════════════════════════════════════════════════ */

import { ENDPOINTS } from './endpoint';
import { getToken } from './auth';
import { readErrorMessage, readJsonBody, requestErrorMessage } from '../utils/apiMessage';

/* Leave-management / resource service — NOT the gateway. Same host:port the
   Resource, Attendance and Designation Rates pages use. */
const RESOURCE_API_BASE =
  import.meta.env.VITE_RESOURCE_API_BASE_URL || 'http://10.1.131.199:8019';

const num = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

/* Rates arrive as numbers or strings depending on the row — normalize to
   numbers and drop anything unparseable so a partial card still renders. */
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

/* Which contract year a date falls in, as the "Year-N" key.

   Contract years are anchored on the project start date, so Year-1 runs from
   the start date to the day before its first anniversary. Returns "" when
   either date is missing or the date precedes the project.

   This is only ever used to PREVIEW a cost before saving — the backend
   resolves the real rate at save time, and its answer is what gets stored. */
export function contractYearKey(projectStartDate, onDate) {
  if (!projectStartDate || !onDate) return '';
  const start = new Date(`${String(projectStartDate).slice(0, 10)}T00:00:00`);
  const when = new Date(`${String(onDate).slice(0, 10)}T00:00:00`);
  if (Number.isNaN(start.getTime()) || Number.isNaN(when.getTime())) return '';
  if (when < start) return '';
  let years = when.getFullYear() - start.getFullYear();
  const anniversary = new Date(start);
  anniversary.setFullYear(start.getFullYear() + years);
  if (when < anniversary) years -= 1;
  return `Year-${years + 1}`;
}

/* The rate to price a row at: the year the activity falls in, clamped to the
   card's last year when the activity runs past the end of the card (the same
   clamp the backend applies). Falls back to the first year when the activity
   date is unknown. */
export function rateForDate(rateCardByYear, projectStartDate, onDate) {
  const keys = sortedYearKeys(rateCardByYear);
  if (keys.length === 0) return null;
  const wanted = contractYearKey(projectStartDate, onDate);
  if (wanted && rateCardByYear[wanted] != null) return rateCardByYear[wanted];
  if (wanted) {
    const n = parseInt(wanted.replace(/\D+/g, ''), 10) || 0;
    const lastN = parseInt(keys[keys.length - 1].replace(/\D+/g, ''), 10) || 0;
    if (n > lastN) return rateCardByYear[keys[keys.length - 1]];
  }
  return rateCardByYear[keys[0]];
}

/* GET /api/designation-rates?projectId=&organisationId=
   → [{ id, role, organisationId, rateCardByYear }]

   BOTH ids are required by the service, so a missing organisation means
   there is nothing to ask for rather than an unfiltered list. */
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
