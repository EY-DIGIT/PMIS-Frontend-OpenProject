import { api } from './client';
import { ENDPOINTS } from './endpoint';
import { toApiDate, toApiNodeStatus, mapTypeUiToApi } from './adapters';

function nodeBase(ui) {
  const body = {
    name: ui.name,
    description: ui.description || '',
    startDate: toApiDate(ui.startDate),
    endDate: toApiDate(ui.endDate),
    status: toApiNodeStatus(ui.status),
  };
  // Standardized to `dependsOn` across milestone/activity/task/subtask.
  if (ui.dependsOn && ui.dependsOn.length) body.dependsOn = ui.dependsOn;
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
  return api.post(ENDPOINTS.projects.milestoneCreate(projectUuid), body);
}

export async function updateMilestone(id, ui) {
  const body = nodeBase(ui);
  if ('vendor' in ui) body.vendor = ui.vendor || '';
  return api.patch(ENDPOINTS.milestones.update(id), body);
}

export async function removeMilestone(id) {
  return api.del(ENDPOINTS.milestones.remove(id));
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
    body = { ...base, type: "standard" };
  } else if (endpoint === "transactional") {
    // Server ignores status for transactional; strip it to avoid 422.
    const { status, ...rest } = base;
    body = { ...rest, type: "transactional" };
  } else if (endpoint === "resource/count") {
    const { status, ...rest } = base;
    const rc = ui.resourceCount || {};
    body = {
      ...rest,
      type: "resource",
      resourceMode: "count",
      resourceCount: parseInt(rc.count, 10) || 1,
    };
  } else {
    const { status, ...rest } = base;
    const rd = ui.resourceDetails || {};
    body = {
      ...rest,
      type: "resource",
      resourceMode: "details",
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
        divisionOther: rd.divisionOther || "",
      },
    };
  }
  return api.post(ENDPOINTS.milestones.activityCreate(milestoneId, endpoint), body);
}

export async function updateActivity(id, ui) {
  const body = { ...nodeBase(ui), type: mapTypeUiToApi(ui.type) };
  const rp = resourcePayload(ui);
  if (rp) Object.assign(body, rp);
  return api.patch(ENDPOINTS.activities.update(id), body);
}

export async function removeActivity(id) {
  return api.del(ENDPOINTS.activities.remove(id));
}

// ── Tasks ──────────────────────────────────────────────────
// Tasks/subtasks no longer accept `type` on create — server inherits
// it from the parent activity. Resource payload is only valid when
// the inherited type is `resource`.
export async function createTask(activityId, ui) {
  const body = nodeBase(ui);
  const rp = resourcePayload(ui);
  if (rp) Object.assign(body, rp);
  return api.post(ENDPOINTS.activities.taskCreate(activityId), body);
}

export async function updateTask(id, ui) {
  const body = { ...nodeBase(ui), type: mapTypeUiToApi(ui.type) };
  const rp = resourcePayload(ui);
  if (rp) Object.assign(body, rp);
  return api.patch(ENDPOINTS.tasks.update(id), body);
}

export async function removeTask(id) {
  return api.del(ENDPOINTS.tasks.remove(id));
}

// ── Subtasks ───────────────────────────────────────────────
export async function createSubtask(taskId, ui) {
  const body = nodeBase(ui);
  const rp = resourcePayload(ui);
  if (rp) Object.assign(body, rp);
  return api.post(ENDPOINTS.tasks.subtaskCreate(taskId), body);
}

export async function updateSubtask(id, ui) {
  const body = { ...nodeBase(ui), type: mapTypeUiToApi(ui.type) };
  const rp = resourcePayload(ui);
  if (rp) Object.assign(body, rp);
  return api.patch(ENDPOINTS.subtasks.update(id), body);
}

export async function removeSubtask(id) {
  return api.del(ENDPOINTS.subtasks.remove(id));
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
