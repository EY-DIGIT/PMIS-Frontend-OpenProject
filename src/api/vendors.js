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

function fromApi(v) {
  const projects = Array.isArray(v.projects) ? v.projects : [];
  return {
    vendorId: v.id || v.uuid || '',
    vendorName: v.name || '',
    description: v.description || '',
    status: v.active === false ? 'Inactive' : 'Active',
    vendorType: v.type || v.vendorType || 'Standard Vendor',
    contact: v.contactPerson || v.contact_person || v.contact || '',
    email: v.email || '',
    phone: v.phoneNumber || v.phone_number || v.phone || '',
    projectMapping: projects.map((p) => p.name).filter(Boolean),
    projects,
    createdAt: v.createdAt || '',
    updatedAt: v.updatedAt || '',
    startDate: (v.startDate || '').slice(0, 10),
    endDate: (v.endDate || '').slice(0, 10),
    address: v.address || '',
    services: v.services || '',
  };
}

export async function list() {
  const res = await api.get(ENDPOINTS.vendors.list);
  return unwrap(res).map(fromApi);
}

export async function create({
  name,
  description,
  active = true,
  email,
  contact_person,
  phone_number,
  projectMapping,
}) {
  const res = await api.post(ENDPOINTS.vendors.create, {
    name,
    description,
    active,
    email,
    contact_person,
    phone_number,
    projectIds: Array.isArray(projectMapping) ? projectMapping : [],
  });
  return fromApi(unwrapOne(res));
}

export async function update(id, patch) {
  const res = await api.patch(ENDPOINTS.vendors.update(id), patch);
  return fromApi(unwrapOne(res));
}
