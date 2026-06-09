import { api } from './client';
import { ENDPOINTS } from './endpoint';
import { fromApiProject, toApiProject } from './adapters';

function unwrapList(res) {
  if (Array.isArray(res)) return res;
  if (Array.isArray(res?._embedded?.elements)) return res._embedded.elements;
  if (Array.isArray(res?.data?._embedded?.elements)) return res.data._embedded.elements;
  if (Array.isArray(res?.items)) return res.items;
  if (Array.isArray(res?.data?.items)) return res.data.items;
  if (Array.isArray(res?.data)) return res.data;
  if (Array.isArray(res?.results)) return res.results;
  return [];
}

export async function list({ offset = 1, pageSize = 50, active } = {}) {
  const res = await api.get(ENDPOINTS.projects.list, {
    query: { offset, pageSize, active },
  });
  return unwrapList(res).map(fromApiProject);
}

// Same list endpoint but WITHOUT offset/pageSize query params — some
// callers (e.g. the user-search Project Mapping filter) need the full set
// and the paginated variant fails for them. Returns every project the
// caller is allowed to see.
export async function listAll() {
  const res = await api.get(ENDPOINTS.projects.list);
  return unwrapList(res).map(fromApiProject);
}

export async function get(uuid) {
  const res = await api.get(ENDPOINTS.projects.get(uuid));
  return fromApiProject(res);
}

export async function getTree(uuid) {
  const res = await api.get(ENDPOINTS.projects.tree(uuid));
  return fromApiProject(res);
}

export async function create(ui) {
  const res = await api.post(ENDPOINTS.projects.create, toApiProject(ui));
  return fromApiProject(res);
}

export async function update(uuid, ui) {
  const res = await api.patch(ENDPOINTS.projects.update(uuid), toApiProject(ui));
  return fromApiProject(res);
}

export async function save(uuid) {
  return api.post(ENDPOINTS.projects.save(uuid), {});
}

export async function publish(uuid) {
  return api.post(ENDPOINTS.projects.publish(uuid), {});
}

export async function close(uuid) {
  return api.post(ENDPOINTS.projects.close(uuid), {});
}

export async function remove(uuid) {
  return api.del(ENDPOINTS.projects.remove(uuid));
}
