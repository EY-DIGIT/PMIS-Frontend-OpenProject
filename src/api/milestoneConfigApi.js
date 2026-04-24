/* ══════════════════════════════════════════════════════════════════
   src/api/milestoneConfigApi.js

   Direct fetch wrappers for every endpoint MilestoneConfigPage touches.
   Each function:
   - Reads the JWT from getToken()
   - On 401 → calls logout() and throws Error with isAuth=true
   - On !ok → throws Error with server's friendly message
   - Returns the unwrapped `data` payload (server wraps as {data, error, status})
   ══════════════════════════════════════════════════════════════════ */

import { API_BASE } from "./client";
import { ENDPOINTS } from "./endpoint";
import { getToken, logout } from "./auth";
import {
  readErrorBody,
  resolveVendorIds,
  toMilestoneIsoStart,
  toMilestoneIsoEnd,
  mapStatusForApi,
  activityEndpointFor,
  activityServerTypePair,
  buildResourcePayload,
  mapApiProject,
  mapApiMilestoneToNode,
  mapApiActivityToNode,
  mapApiTaskToNode,
  mapApiSubtaskToNode,
  extractListElements
} from "../utils/project/milestoneConfigHelpers";

const LIST_QS = "?offset=1&pageSize=20&includeDeleted=false";

function jsonHeaders(token) {
  return {
    accept: "application/json",
    "Content-Type": "application/json",
    Authorization: `Bearer ${token}`
  };
}

function getHeaders(token) {
  return {
    accept: "application/json",
    Authorization: `Bearer ${token}`
  };
}

function throwAuth() {
  logout();
  const err = new Error("Session expired. Please sign in again.");
  err.isAuth = true;
  throw err;
}

function requireToken() {
  const token = getToken();
  if (!token) throwAuth();
  return token;
}

async function parseData(res) {
  const raw = await res.json().catch(() => ({}));
  return raw?.data ?? raw ?? {};
}

async function throwHttp(res) {
  const msg = await readErrorBody(res);
  throw new Error(msg);
}

function url(path) {
  return `${API_BASE}${path}`;
}

/* GET with standard 401/error handling. Used for most reads. */
async function apiGet(path) {
  const token = requireToken();
  const res = await fetch(url(path), { method: "GET", headers: getHeaders(token) });
  if (res.status === 401) throwAuth();
  if (!res.ok) await throwHttp(res);
  return res.json().catch(() => ({}));
}

/* GET that returns [] on any failure — used for child lists where
   a missing parent shouldn't crash the UI. */
async function apiGetOrEmpty(path) {
  const token = getToken();
  if (!token) return [];
  try {
    const res = await fetch(url(path), { method: "GET", headers: getHeaders(token) });
    if (!res.ok) return [];
    return await res.json().catch(() => ({}));
  } catch {
    return [];
  }
}

async function apiSend(method, path, body) {
  const token = requireToken();
  const res = await fetch(url(path), {
    method,
    headers: jsonHeaders(token),
    body: JSON.stringify(body ?? {})
  });
  if (res.status === 401) throwAuth();
  if (!res.ok) await throwHttp(res);
  return parseData(res);
}

async function apiDelete(path) {
  const token = requireToken();
  const res = await fetch(url(path), { method: "DELETE", headers: getHeaders(token) });
  if (res.status === 401) throwAuth();
  if (!res.ok && res.status !== 204) await throwHttp(res);
  return true;
}

function sortByPosition(list) {
  return list.slice().sort((a, b) => (a?.position ?? 0) - (b?.position ?? 0));
}

/* Common base fields for activity/task create & update. Tasks and
   activities share the same contract for dates, dependsOn, position. */
function buildActivityLikeBase(formData) {
  return {
    name: formData.name.trim(),
    description: (formData.description || "").trim(),
    startDate: toMilestoneIsoStart(formData.startDate),
    endDate: toMilestoneIsoEnd(formData.endDate),
    actualStartDate: formData.actualStartDate ? toMilestoneIsoStart(formData.actualStartDate) : null,
    actualEndDate: formData.actualEndDate ? toMilestoneIsoEnd(formData.actualEndDate) : null,
    position: 0,
    dependsOn: []
  };
}

function buildMilestonePayload(project, formData) {
  return {
    name: formData.name.trim(),
    description: (formData.description || "").trim(),
    startDate: toMilestoneIsoStart(formData.startDate),
    endDate: toMilestoneIsoEnd(formData.endDate),
    status: mapStatusForApi(formData.status || "Not Completed"),
    vendorIds: resolveVendorIds(project, formData.vendor)
  };
}

/* ════════════════ Project APIs ════════════════ */

export async function loadProjectById(projectId) {
  const raw = await apiGet(ENDPOINTS.projects.get(projectId));
  return mapApiProject(raw?.data ?? raw);
}

export async function saveProjectApi(projectServerId) {
  return apiSend("POST", ENDPOINTS.projects.save(projectServerId), {});
}

/* ════════════════ Milestone APIs ════════════════ */

export async function loadMilestonesForProject(projectId) {
  const raw = await apiGet(ENDPOINTS.projects.milestones(projectId));
  return sortByPosition(extractListElements(raw)).map(mapApiMilestoneToNode);
}

export async function createMilestoneApi(project, formData) {
  return apiSend(
    "POST",
    ENDPOINTS.projects.milestoneCreate(project.projectId),
    buildMilestonePayload(project, formData)
  );
}

export async function updateMilestoneApi(milestoneServerId, formData, project) {
  return apiSend(
    "PATCH",
    ENDPOINTS.milestones.update(milestoneServerId),
    buildMilestonePayload(project, formData)
  );
}

export async function deleteMilestoneApi(milestoneServerId) {
  return apiDelete(ENDPOINTS.milestones.remove(milestoneServerId));
}

/* ════════════════ Activity APIs ════════════════ */

export async function loadActivitiesForMilestone(milestoneApiId) {
  if (!milestoneApiId) return [];
  const raw = await apiGetOrEmpty(ENDPOINTS.milestones.activities(milestoneApiId) + LIST_QS);
  return sortByPosition(extractListElements(raw)).map(mapApiActivityToNode);
}

export async function createActivityApi(milestoneApiId, formData) {
  const endpoint = activityEndpointFor(formData);
  const base = buildActivityLikeBase(formData);

  let payload;
  if (endpoint === "standard") {
    payload = { ...base, status: mapStatusForApi(formData.status || "Not Completed") };
  } else if (endpoint === "transactional") {
    payload = { ...base };
  } else {
    // resource/count or resource/details
    payload = { ...base, ...buildResourcePayload(formData) };
  }

  return apiSend(
    "POST",
    ENDPOINTS.milestones.activityCreate(milestoneApiId, endpoint),
    payload
  );
}

export async function updateActivityApi(activityServerId, formData) {
  const { type, resourceMode } = activityServerTypePair(formData);

  const payload = {
    ...buildActivityLikeBase(formData),
    type,
    status: mapStatusForApi(formData.status || "Not Completed")
  };

  if (type === "resource") {
    payload.resourceMode = resourceMode;
    Object.assign(payload, buildResourcePayload(formData));
  }

  return apiSend("PATCH", ENDPOINTS.activities.update(activityServerId), payload);
}

export async function deleteActivityApi(activityServerId) {
  return apiDelete(ENDPOINTS.activities.remove(activityServerId));
}

/* ════════════════ Task APIs ════════════════ */

export async function loadTasksForActivity(activityApiId) {
  if (!activityApiId) return [];
  const raw = await apiGetOrEmpty(ENDPOINTS.activities.tasks(activityApiId) + LIST_QS);
  return sortByPosition(extractListElements(raw)).map(mapApiTaskToNode);
}

/* Single create endpoint — type is auto-derived server-side from resourceMode.
   We send resourceMode + resourceCount/resource for Resource Type, else base. */
export async function createTaskApi(activityApiId, formData) {
  const { type, resourceMode } = activityServerTypePair(formData);
  const payload = buildActivityLikeBase(formData);

  if (type === "resource") {
    payload.resourceMode = resourceMode;
    Object.assign(payload, buildResourcePayload(formData));
  }

  return apiSend("POST", ENDPOINTS.activities.taskCreate(activityApiId), payload);
}

/* Full payload, same shape as activity PATCH. */
export async function updateTaskApi(taskServerId, formData) {
  const { type, resourceMode } = activityServerTypePair(formData);

  const payload = {
    ...buildActivityLikeBase(formData),
    type
  };

  if (type === "resource") {
    payload.resourceMode = resourceMode;
    Object.assign(payload, buildResourcePayload(formData));
  }

  return apiSend("PATCH", ENDPOINTS.tasks.update(taskServerId), payload);
}

export async function deleteTaskApi(taskServerId) {
  return apiDelete(ENDPOINTS.tasks.remove(taskServerId));
}

/* ════════════════ Subtask APIs ════════════════ */

export async function loadSubtasksForTask(taskApiId) {
  if (!taskApiId) return [];
  const raw = await apiGetOrEmpty(ENDPOINTS.tasks.subtasks(taskApiId) + LIST_QS);
  return sortByPosition(extractListElements(raw)).map(mapApiSubtaskToNode);
}

/* Create payload is deliberately minimal — only name, description, and dates.
   Type/resource fields are NOT accepted by the create endpoint (only by PATCH). */
export async function createSubtaskApi(taskApiId, formData) {
  const payload = {
    name: formData.name.trim(),
    description: (formData.description || "").trim(),
    startDate: toMilestoneIsoStart(formData.startDate),
    endDate: toMilestoneIsoEnd(formData.endDate),
    actualStartDate: formData.actualStartDate ? toMilestoneIsoStart(formData.actualStartDate) : null,
    actualEndDate: formData.actualEndDate ? toMilestoneIsoEnd(formData.actualEndDate) : null
  };
  return apiSend("POST", ENDPOINTS.tasks.subtaskCreate(taskApiId), payload);
}

/* Full payload same as task/activity PATCH. */
export async function updateSubtaskApi(subtaskServerId, formData) {
  const { type, resourceMode } = activityServerTypePair(formData);

  const payload = {
    ...buildActivityLikeBase(formData),
    type
  };

  if (type === "resource") {
    payload.resourceMode = resourceMode;
    Object.assign(payload, buildResourcePayload(formData));
  }

  return apiSend("PATCH", ENDPOINTS.subtasks.update(subtaskServerId), payload);
}

export async function deleteSubtaskApi(subtaskServerId) {
  return apiDelete(ENDPOINTS.subtasks.remove(subtaskServerId));
}
