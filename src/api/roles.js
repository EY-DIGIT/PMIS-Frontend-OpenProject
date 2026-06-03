/* ══════════════════════════════════════════════════════════════════
   roles.js — wrapper around /users/api/v3/roles. Returns the
   role-catalog the backend exposes (admin, super_admin, project_*
   plus the newer director_admin / division_* tier roles).

   Response shape (unwrapped):
     {
       id: number,
       name: string,           // canonical key, e.g. "director_admin"
       description: string,
       builtin: boolean,
       created_at, updated_at
     }
   ══════════════════════════════════════════════════════════════════ */

import { api } from './client';
import { ENDPOINTS } from './endpoint';

function unwrapList(res) {
  if (Array.isArray(res)) return res;
  if (Array.isArray(res?._embedded?.elements)) return res._embedded.elements;
  if (Array.isArray(res?.data?._embedded?.elements)) return res.data._embedded.elements;
  if (Array.isArray(res?.items)) return res.items;
  if (Array.isArray(res?.data?.items)) return res.data.items;
  if (Array.isArray(res?.data)) return res.data;
  return [];
}

export async function list() {
  const res = await api.get(ENDPOINTS.roles.list);
  return unwrapList(res);
}
