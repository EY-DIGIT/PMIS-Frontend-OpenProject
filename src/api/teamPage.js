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