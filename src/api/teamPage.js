/* ══════════════════════════════════════════════════════════════════
   src/api/teamPage.js

   Thin wrapper around the Team Page endpoint:
     GET  /projects/api/v3/projects/{uuid}/team-page
     PUT  /projects/api/v3/projects/{uuid}/team-page

   Backend wraps responses in the standard envelope
   `{ data, message, error, status }` — we unwrap here so callers
   work with the inner payload directly (same pattern as dashboard.js).
   ══════════════════════════════════════════════════════════════════ */

import { api } from './client';
import { ENDPOINTS } from './endpoint';

// Standard envelope unwrap. Accepts both wrapped and bare payloads.
function unwrap(res) {
  if (res && typeof res === 'object' && 'data' in res && res.data !== null && res.data !== undefined) {
    return res.data;
  }
  return res;
}

/* GET — fetch the team page for a project.
   Returns: { projectId, projectName, userDirectory, orgUser, projectOwner, activities } */
export async function getTeamPage(projectId) {
  const res = await api.get(ENDPOINTS.projects.teamPage(projectId));
  return unwrap(res);
}

/* PUT — save the team page.
   `payload` must contain { orgUser, projectOwner, activities }.
   userDirectory and projectName are read-only on the server side. */
export async function updateTeamPage(projectId, payload) {
  const body = {
    orgUser: payload?.orgUser || [],
    projectOwner: payload?.projectOwner || [],
    activities: payload?.activities || [],
  };
  const res = await api.put(ENDPOINTS.projects.teamPage(projectId), body);
  return unwrap(res);
}

/* POST /api/v3/associated-users — returns users that are associated with
   either the project's organization (orgDetails=true) or a specific
   division (divisionId + divisionDetails=true).

   Response shape (envelope already unwrapped):
     { _type, users: [{ id, login, email, firstName, lastName,
                        matchedOrganizations[], matchedOwnerDivision[],
                        matchedDivision[] }] }
   Falls back to [] on error so callers can render an empty dropdown
   without crashing the page. */
export async function listAssociatedUsers(body) {
  try {
    const res = await api.post(ENDPOINTS.users.associated, body);
    const data = unwrap(res);
    return Array.isArray(data?.users) ? data.users : [];
  } catch (e) {
    // eslint-disable-next-line no-console
    console.warn('[listAssociatedUsers] failed for body:', body, e);
    return [];
  }
}

/* Convenience: users matching the project's organization(s). */
export function listUsersByProjectOrg(projectId) {
  return listAssociatedUsers({ projectId, orgDetails: true });
}

/* Convenience: users belonging to a specific division id. */
export function listUsersByDivision(divisionId) {
  if (divisionId === null || divisionId === undefined) {
    return Promise.resolve([]);
  }
  return listAssociatedUsers({ divisionId, divisionDetails: true });
}