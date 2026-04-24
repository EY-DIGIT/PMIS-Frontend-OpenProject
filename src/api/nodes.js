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
// Backend split the single create endpoint into 4 type-specific ones.
// Sub-path and body shape are both driven by ui.type + resourceEntryType.
function activityEndpointFor(ui) {
  const t = String(ui?.type || "").toLowerCase();
  if (t.includes("resource")) {
    return ui.resourceEntryType === "count" ? "resource/count" : "resource/details";
  }
  if (t.includes("transactional")) return "transactional";
  return "standard";
}

export async function createActivity(milestoneId, ui) {
  const endpoint = activityEndpointFor(ui);
  const base = nodeBase(ui);
  let body;
  if (endpoint === "standard") {
    body = base;
  } else if (endpoint === "transactional") {
    // Server ignores status for transactional; strip it to avoid 422.
    const { status, ...rest } = base;
    body = rest;
  } else if (endpoint === "resource/count") {
    const { status, ...rest } = base;
    const rc = ui.resourceCount || {};
    body = { ...rest, resourceCount: parseInt(rc.count, 10) || 1 };
  } else {
    const { status, ...rest } = base;
    const rd = ui.resourceDetails || {};
    body = {
      ...rest,
      resource: {
        resourceName: rd.resourceName || "",
        onboardDate: toApiDate(rd.onboardingDate),
        actualOnboardDate: toApiDate(rd.actualOnboardingDate),
        offboardDate: toApiDate(rd.offboardingDate),
        actualOffboardDate: toApiDate(rd.actualOffboardingDate),
        position: rd.position || "",
        designation: rd.designation || "",
        jobRole: rd.jobRole || "",
        qualification: rd.qualification || "",
        experienceYears: parseFloat(rd.experience) || 0,
        typeOfResourceId: rd.resType || "",
        division: rd.division || "",
        divisionOther: ""
      }
    };
  }
  return api.post(`/api/v3/milestones/${milestoneId}/activities/${endpoint}/create`, body);
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
// Tasks/subtasks no longer accept `type` on create — server inherits
// it from the parent activity. Resource payload is only valid when
// the inherited type is `resource`.
export async function createTask(activityId, ui) {
  const body = nodeBase(ui);
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
  const body = nodeBase(ui);
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
