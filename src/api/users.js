import { api } from './client';
import { ENDPOINTS } from './endpoint';

function unwrap(res) {
  if (Array.isArray(res)) return res;
  if (Array.isArray(res?.items)) return res.items;
  if (Array.isArray(res?.data)) return res.data;
  return [];
}

function fromApi(u) {
  return {
    userId: u.id || u.uuid,
    fullName: [u.firstName, u.lastName].filter(Boolean).join(' ') || u.login || '',
    employeeId: u.employeeId || u.login || '',
    email: u.email || '',
    role: u.admin ? 'Admin' : (u.role || 'Viewer'),
    vendorName: u.vendorName || '',
    division: u.division || '',
    projectMapping: u.projectMapping || [],
    status: u.status === 'inactive' ? 'Inactive' : 'Active',
  };
}

export async function list({ offset = 1, pageSize = 50, status } = {}) {
  const res = await api.get(ENDPOINTS.users.list, { query: { offset, pageSize, status } });
  return unwrap(res).map(fromApi);
}

export async function get(id) {
  const res = await api.get(ENDPOINTS.users.get(id));
  return fromApi(res);
}

export async function create(body) {
  const res = await api.post(ENDPOINTS.users.create, body);
  return fromApi(res);
}

export async function update(id, patch) {
  const res = await api.patch(ENDPOINTS.users.update(id), patch);
  return fromApi(res);
}

export async function updatePassword(id, password) {
  return api.patch(ENDPOINTS.users.updatePassword(id), { password });
}

export async function remove(id) {
  return api.del(ENDPOINTS.users.remove(id));
}
