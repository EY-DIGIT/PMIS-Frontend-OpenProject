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
  return {
    userId: u.id || u.uuid,
    fullName: [firstName, lastName].filter(Boolean).join(' ') || u.login || '',
    employeeId: u.employeeId || u.employee_id || u.login || '',
    email: u.email || '',
    role: u.admin ? 'Admin' : (u.role || 'Viewer'),
    vendorId,
    vendorName,
    division: u.division || '',
    divisionOther: u.division_other || u.divisionOther || '',
    projectMapping,
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

export async function update(id, patch) {
  const res = await api.patch(ENDPOINTS.users.update(id), patch);
  return fromApi(unwrapOne(res));
}

export async function updatePassword(id, password) {
  return api.patch(ENDPOINTS.users.updatePassword(id), { password });
}

export async function remove(id) {
  return api.del(ENDPOINTS.users.remove(id));
}
