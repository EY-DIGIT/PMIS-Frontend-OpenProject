import { api } from './client';
import { toApiDate, toApiNodeStatus, mapTypeUiToApi } from './adapters';

function nodeBase(ui) {
  const body = {
    name: ui.name,
    description: ui.description || '',
    startDate: toApiDate(ui.startDate),
    endDate: toApiDate(ui.endDate),
    status: toApiNodeStatus(ui.status),
  };
  if (ui.dependsOn && ui.dependsOn.length) body.depends = ui.dependsOn;
  return body;
}

function resourcePayload(ui) {
  if (ui.type !== 'Resource Type') return null;
  if (ui.resourceEntryType === 'count') {
    const c = ui.resourceCount || {};
    return { resourceMode: 'count', resource: c };
  }
  const d = ui.resourceDetails || {};
  return { resourceMode: 'details', resource: d };
}

// ── Milestones ─────────────────────────────────────────────
export async function createMilestone(projectUuid, ui) {
  const body = nodeBase(ui);
  if (ui.vendor) body.vendor = ui.vendor;
  return api.post(`/api/v3/projects/${projectUuid}/milestones/create`, body);
}

export async function updateMilestone(id, ui) {
  const body = nodeBase(ui);
  if ('vendor' in ui) body.vendor = ui.vendor || '';
  return api.patch(`/api/v3/milestones/${id}`, body);
}

export async function removeMilestone(id) {
  return api.del(`/api/v3/milestones/${id}`);
}

// ── Activities ─────────────────────────────────────────────
export async function createActivity(milestoneId, ui) {
  const body = { ...nodeBase(ui), type: mapTypeUiToApi(ui.type) };
  const rp = resourcePayload(ui);
  if (rp) Object.assign(body, rp);
  return api.post(`/api/v3/milestones/${milestoneId}/activities/create`, body);
}

export async function updateActivity(id, ui) {
  const body = { ...nodeBase(ui), type: mapTypeUiToApi(ui.type) };
  const rp = resourcePayload(ui);
  if (rp) Object.assign(body, rp);
  return api.patch(`/api/v3/activities/${id}`, body);
}

export async function removeActivity(id) {
  return api.del(`/api/v3/activities/${id}`);
}

// ── Tasks ──────────────────────────────────────────────────
export async function createTask(activityId, ui) {
  const body = { ...nodeBase(ui), type: mapTypeUiToApi(ui.type) };
  const rp = resourcePayload(ui);
  if (rp) Object.assign(body, rp);
  return api.post(`/api/v3/activities/${activityId}/tasks/create`, body);
}

export async function updateTask(id, ui) {
  const body = { ...nodeBase(ui), type: mapTypeUiToApi(ui.type) };
  const rp = resourcePayload(ui);
  if (rp) Object.assign(body, rp);
  return api.patch(`/api/v3/tasks/${id}`, body);
}

export async function removeTask(id) {
  return api.del(`/api/v3/tasks/${id}`);
}

// ── Subtasks ───────────────────────────────────────────────
export async function createSubtask(taskId, ui) {
  const body = { ...nodeBase(ui), type: mapTypeUiToApi(ui.type) };
  const rp = resourcePayload(ui);
  if (rp) Object.assign(body, rp);
  return api.post(`/api/v3/tasks/${taskId}/subtasks/create`, body);
}

export async function updateSubtask(id, ui) {
  const body = { ...nodeBase(ui), type: mapTypeUiToApi(ui.type) };
  const rp = resourcePayload(ui);
  if (rp) Object.assign(body, rp);
  return api.patch(`/api/v3/subtasks/${id}`, body);
}

export async function removeSubtask(id) {
  return api.del(`/api/v3/subtasks/${id}`);
}

// ── Polymorphic helpers used by UI ─────────────────────────
export const createByKind = {
  milestone: createMilestone,
  activity: createActivity,
  task: createTask,
  subtask: createSubtask,
};

export const updateByKind = {
  milestone: updateMilestone,
  activity: updateActivity,
  task: updateTask,
  subtask: updateSubtask,
};

export const removeByKind = {
  milestone: removeMilestone,
  activity: removeActivity,
  task: removeTask,
  subtask: removeSubtask,
};
