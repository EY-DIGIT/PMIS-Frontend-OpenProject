import { api } from './client';
import { ENDPOINTS } from './endpoint';

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

function fromApi(u) {
  const firstName = u.firstName || u.first_name || '';
  const lastName = u.lastName || u.last_name || '';
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
    fullName: [firstName, lastName].filter(Boolean).join(' ') || u.login || '',
    employeeId: u.employeeId || u.employee_id || u.login || '',
    email: u.email || '',
    role: u.admin ? 'Admin' : (u.role || 'Viewer'),
    orgRole: u.orgRole || u.org_role || '',
    vendorId,
    vendorName,
    division: u.division || '',
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

export async function get(id) {
  const res = await api.get(ENDPOINTS.users.get(id));
  return fromApi(unwrapOne(res));
}

export async function create(body) {
  const res = await api.post(ENDPOINTS.users.create, body);
  return fromApi(unwrapOne(res));
}

// PATCH /api/v3/users/{id} — backend contract:
//   { email, firstName, lastName, admin, status, vendor_id,
//     division, division_other, phone_number, project_ids: [uuid, ...] }
// Per-project roles + per-project user picks have been removed from the
// User Details page, so we emit a flat `project_ids` array.
export async function update(id, {
  email,
  firstName,
  lastName,
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
  if (firstName !== undefined) body.firstName = firstName;
  if (lastName !== undefined) body.lastName = lastName;
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
