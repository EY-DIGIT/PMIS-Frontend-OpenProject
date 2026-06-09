import { api } from './client';
import { ENDPOINTS } from './endpoint';
import { readRoleFromUser } from '../auth/roleNormalize';

function unwrap(res) {
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

export function fromApi(u) {
  const fullName =
    u.fullName ||
    u.full_name ||
    u.name ||
    u.login ||
    '';
  const vendorObj = u.vendor && typeof u.vendor === 'object' ? u.vendor : null;
  const vendorName = vendorObj?.name || u.vendorName || u.vendor_name || '';
  const vendorId = vendorObj?.id || u.vendor_id || u.vendorId || '';
  const projects = Array.isArray(u.projects)
    ? u.projects
    : Array.isArray(u.project_ids)
      ? u.project_ids
      : Array.isArray(u.projectMapping)
        ? u.projectMapping
        : [];
  const projectMapping = projects
    .map((p) => (typeof p === 'string' ? p : p?.name || p?.id || ''))
    .filter(Boolean);
  const projectIds = projects
    .map((p) => (typeof p === 'string' ? p : p?.id || p?.uuid || ''))
    .filter(Boolean);
  return {
    userId: u.id || u.uuid,
    userCode: u.userCode || u.user_code || '',
    fullName,
    employeeId: u.employeeId || u.employee_id || u.login || '',
    email: u.email || '',
    role: u.admin ? 'Admin' : (u.role || 'Viewer'),
    /* The backend can hand back the role as a string OR an array of
       {role_name, scope, role_id, ...} objects, and the field name varies
       across endpoints: list/get uses `orgRole`/`org_role`, but
       login/me responses use `role`/`roles`. Route through readRoleFromUser
       so any of those shapes resolves to a single hierarchy slug — the
       UserDetails page's Edit-gate depends on this being populated. */
    orgRole: readRoleFromUser(u) || '',
    vendorId,
    vendorName,
    division: u.division || '',
    divisionLabel: u.division_label || u.divisionLabel || '',
    divisionOther: u.division_other || u.divisionOther || '',
    phone: u.phoneNumber || u.phone_number || u.phone || '',
    projectMapping,
    projectIds,
    projectAssignments: Array.isArray(u.projectAssignments) ? u.projectAssignments : [],
    status: u.active === false || u.status === 'inactive' ? 'Inactive' : 'Active',
  };
}

export async function list({ offset = 1, pageSize = 50, status } = {}) {
  const res = await api.get(ENDPOINTS.users.list, { query: { offset, pageSize, status } });
  return unwrap(res).map(fromApi);
}

/* Fetch EVERY user by walking the paginated collection until the
   server-reported `total` is reached. The list endpoint caps a single
   page (default 50), so callers that need the full directory (e.g. the
   Search User list) use this instead of list(). `offset` is a 1-based
   page index per the /api/v3 contract. */
export async function listAll({ status, pageSize = 100 } = {}) {
  const all = [];
  let offset = 1;
  let total = Infinity;
  // Hard cap on iterations as a runaway guard.
  for (let i = 0; i < 1000 && all.length < total; i++) {
    const res = await api.get(ENDPOINTS.users.list, { query: { offset, pageSize, status } });
    const elements = unwrap(res);
    const reported = Number(res?.data?.total ?? res?.total);
    if (Number.isFinite(reported)) total = reported;
    if (!elements.length) break;
    all.push(...elements);
    if (elements.length < pageSize) break;
    offset += 1;
  }
  return all.map(fromApi);
}

export async function get(id) {
  const res = await api.get(ENDPOINTS.users.get(id));
  return fromApi(unwrapOne(res));
}

export async function create(body) {
  const res = await api.post(ENDPOINTS.users.create, body);
  return fromApi(unwrapOne(res));
}

// PATCH /api/v3/users/{id} — backend contract:
//   { email, fullName, admin, status, vendor_id,
//     division, division_other, phone_number, project_ids: [uuid, ...] }
// Per-project roles + per-project user picks have been removed from the
// User Details page, so we emit a flat `project_ids` array.
export async function update(id, {
  email,
  fullName,
  admin,
  status,
  vendor_id,
  division,
  division_other,
  phone_number,
  project_ids,
}) {
  const body = {};
  if (email !== undefined) body.email = email;
  if (fullName !== undefined) body.fullName = fullName;
  if (admin !== undefined) body.admin = admin;
  if (status !== undefined) body.status = status;
  if (vendor_id !== undefined) body.vendor_id = vendor_id;
  if (division !== undefined) body.division = division;
  if (division_other !== undefined) body.division_other = division_other;
  if (phone_number !== undefined) body.phone_number = phone_number;
  if (project_ids !== undefined) {
    body.project_ids = Array.isArray(project_ids) ? project_ids : [];
  }
  const res = await api.patch(ENDPOINTS.users.update(id), body);
  return fromApi(unwrapOne(res));
}

export async function updatePassword(id, password) {
  return api.patch(ENDPOINTS.users.updatePassword(id), { password });
}

export async function remove(id) {
  return api.del(ENDPOINTS.users.remove(id));
}
