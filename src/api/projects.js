import { api } from './client';
import { fromApiProject, toApiProject } from './adapters';

function unwrapList(res) {
  if (Array.isArray(res)) return res;
  if (Array.isArray(res?.items)) return res.items;
  if (Array.isArray(res?.data)) return res.data;
  if (Array.isArray(res?.results)) return res.results;
  return [];
}

export async function list({ offset = 1, pageSize = 50, active } = {}) {
  const res = await api.get('/api/v3/projects', {
    query: { offset, pageSize, active },
  });
  return unwrapList(res).map(fromApiProject);
}

export async function get(uuid) {
  const res = await api.get(`/api/v3/projects/${uuid}`);
  return fromApiProject(res);
}

export async function getTree(uuid) {
  const res = await api.get(`/api/v3/projects/${uuid}/tree`);
  return fromApiProject(res);
}

export async function create(ui) {
  const res = await api.post('/api/v3/projects/create', toApiProject(ui));
  return fromApiProject(res);
}

export async function update(uuid, ui) {
  const res = await api.patch(`/api/v3/projects/${uuid}`, toApiProject(ui));
  return fromApiProject(res);
}

export async function save(uuid) {
  return api.post(`/api/v3/projects/${uuid}/save`, {});
}

export async function publish(uuid) {
  return api.post(`/api/v3/projects/${uuid}/publish`, {});
}

export async function close(uuid) {
  return api.post(`/api/v3/projects/${uuid}/close`, {});
}

export async function suspend(uuid) {
  return api.post(`/api/v3/projects/${uuid}/suspend`, {});
}

export async function createVersion(uuid) {
  const res = await api.post(`/api/v3/projects/${uuid}/versions/create`, {});
  return fromApiProject(res);
}

export async function remove(uuid) {
  return api.del(`/api/v3/projects/${uuid}`);
}
