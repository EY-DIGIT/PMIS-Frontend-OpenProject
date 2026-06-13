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

function fromApi(d) {
  return {
    id: d?.id || '',
    code: d?.code || '',
    label: d?.label || '',
    requiresOther: !!d?.requiresOther,
    active: d?.active !== false,
    isBuiltin: !!d?.isBuiltin,
    email: d?.email || '',
    phoneNumber: d?.phoneNumber || d?.phone_number || '',
  };
}

export async function list() {
  const res = await api.get(ENDPOINTS.master.divisions.list);
  return unwrap(res).map(fromApi);
}

export async function create({ label, code, requiresOther = false, email = '', phone_number = '' }) {
  // Code is server-generated — only forward it if a caller explicitly passes one.
  const body = { label, requiresOther, email, phone_number };
  if (code !== undefined && code !== null && code !== '') body.code = code;
  const res = await api.post(ENDPOINTS.master.divisions.create, body);
  return fromApi(unwrapOne(res));
}

export async function update(code, { label, requiresOther, email, phone_number }) {
  const body = {};
  if (label !== undefined) body.label = label;
  if (requiresOther !== undefined) body.requiresOther = requiresOther;
  if (email !== undefined) body.email = email;
  if (phone_number !== undefined) body.phone_number = phone_number;
  const res = await api.patch(ENDPOINTS.master.divisions.byCode(code), body);
  return fromApi(unwrapOne(res));
}

export async function remove(code) {
  return api.del(ENDPOINTS.master.divisions.byCode(code));
}

export async function restore(code) {
  return api.post(ENDPOINTS.master.divisions.restore(code), {});
}
