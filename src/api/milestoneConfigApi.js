/* ══════════════════════════════════════════════════════════════════
   src/api/milestoneConfigApi.js

   Direct fetch wrappers for every endpoint MilestoneConfigPage touches.
   Each function:
   - Reads the JWT from getToken()
   - On 401 → calls logout() and throws Error with isAuth=true
   - On !ok → throws Error with server's friendly message
   - Returns the unwrapped `data` payload (server wraps as {data, error, status})
   ══════════════════════════════════════════════════════════════════ */

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

const API_BASE = "http://10.1.131.199:8000";

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

/* ════════════════ Project APIs ════════════════ */

export async function loadProjectById(projectId) {
  const token = requireToken();
  const res = await fetch(
    `${API_BASE}/api/v3/projects/${encodeURIComponent(projectId)}`,
    { method: "GET", headers: getHeaders(token) }
  );
  if (res.status === 401) throwAuth();
  if (!res.ok) await throwHttp(res);
  const raw = await res.json().catch(() => ({}));
  return mapApiProject(raw?.data ?? raw);
}

export async function saveProjectApi(projectServerId) {
  const token = requireToken();
  const res = await fetch(
    `${API_BASE}/api/v3/projects/${encodeURIComponent(projectServerId)}/save`,
    { method: "POST", headers: jsonHeaders(token), body: JSON.stringify({}) }
  );
  if (res.status === 401) throwAuth();
  if (!res.ok && res.status !== 204) await throwHttp(res);
  return parseData(res);
}

/* ════════════════ Milestone APIs ════════════════ */

export async function loadMilestonesForProject(projectId) {
  const token = requireToken();
  const res = await fetch(
    `${API_BASE}/api/v3/projects/${encodeURIComponent(projectId)}/milestones`,
    { method: "GET", headers: getHeaders(token) }
  );
  if (res.status === 401) throwAuth();
  if (!res.ok) await throwHttp(res);
  const raw = await res.json().catch(() => ({}));
  return extractListElements(raw)
    .slice()
    .sort((a, b) => (a?.position ?? 0) - (b?.position ?? 0))
    .map(mapApiMilestoneToNode);
}

export async function createMilestoneApi(project, formData) {
  const token = requireToken();

  const payload = {
    name: formData.name.trim(),
    description: (formData.description || "").trim(),
    startDate: toMilestoneIsoStart(formData.startDate),
    endDate: toMilestoneIsoEnd(formData.endDate),
    status: mapStatusForApi(formData.status || "Not Completed"),
    vendorIds: resolveVendorIds(project, formData.vendor)
  };

  const res = await fetch(
    `${API_BASE}/api/v3/projects/${encodeURIComponent(project.projectId)}/milestones/create`,
    { method: "POST", headers: jsonHeaders(token), body: JSON.stringify(payload) }
  );
  if (res.status === 401) throwAuth();
  if (!res.ok) await throwHttp(res);
  return parseData(res);
}

export async function updateMilestoneApi(milestoneServerId, formData, project) {
  const token = requireToken();

  const payload = {
    name: formData.name.trim(),
    description: (formData.description || "").trim(),
    startDate: toMilestoneIsoStart(formData.startDate),
    endDate: toMilestoneIsoEnd(formData.endDate),
    status: mapStatusForApi(formData.status || "Not Completed"),
    vendorIds: resolveVendorIds(project, formData.vendor)
  };

  const res = await fetch(
    `${API_BASE}/api/v3/milestones/${encodeURIComponent(milestoneServerId)}`,
    { method: "PATCH", headers: jsonHeaders(token), body: JSON.stringify(payload) }
  );
  if (res.status === 401) throwAuth();
  if (!res.ok) await throwHttp(res);
  return parseData(res);
}

export async function deleteMilestoneApi(milestoneServerId) {
  const token = requireToken();
  const res = await fetch(
    `${API_BASE}/api/v3/milestones/${encodeURIComponent(milestoneServerId)}`,
    { method: "DELETE", headers: getHeaders(token) }
  );
  if (res.status === 401) throwAuth();
  if (!res.ok && res.status !== 204) await throwHttp(res);
  return true;
}

/* ════════════════ Activity APIs ════════════════ */

export async function loadActivitiesForMilestone(milestoneApiId) {
  if (!milestoneApiId) return [];
  const token = getToken();
  if (!token) return [];

  try {
    const res = await fetch(
      `${API_BASE}/api/v3/milestones/${encodeURIComponent(milestoneApiId)}/activities?offset=1&pageSize=20&includeDeleted=false`,
      { method: "GET", headers: getHeaders(token) }
    );
    if (!res.ok) return [];
    const raw = await res.json().catch(() => ({}));
    return extractListElements(raw)
      .slice()
      .sort((a, b) => (a?.position ?? 0) - (b?.position ?? 0))
      .map(mapApiActivityToNode);
  } catch (e) {
    return [];
  }
}

export async function createActivityApi(milestoneApiId, formData) {
  const token = requireToken();

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

  const url = `${API_BASE}/api/v3/milestones/${encodeURIComponent(milestoneApiId)}/activities/${endpoint}/create`;
  const res = await fetch(url, {
    method: "POST",
    headers: jsonHeaders(token),
    body: JSON.stringify(payload)
  });
  if (res.status === 401) throwAuth();
  if (!res.ok) await throwHttp(res);
  return parseData(res);
}

export async function updateActivityApi(activityServerId, formData) {
  const token = requireToken();

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

  const res = await fetch(
    `${API_BASE}/api/v3/activities/${encodeURIComponent(activityServerId)}`,
    { method: "PATCH", headers: jsonHeaders(token), body: JSON.stringify(payload) }
  );
  if (res.status === 401) throwAuth();
  if (!res.ok) await throwHttp(res);
  return parseData(res);
}

export async function deleteActivityApi(activityServerId) {
  const token = requireToken();
  const res = await fetch(
    `${API_BASE}/api/v3/activities/${encodeURIComponent(activityServerId)}`,
    { method: "DELETE", headers: getHeaders(token) }
  );
  if (res.status === 401) throwAuth();
  if (!res.ok && res.status !== 204) await throwHttp(res);
  return true;
}

/* ════════════════ Task APIs ════════════════ */

/* GET /api/v3/activities/{id}/tasks — returns mapped task nodes. */
export async function loadTasksForActivity(activityApiId) {
  if (!activityApiId) return [];
  const token = getToken();
  if (!token) return [];

  try {
    const res = await fetch(
      `${API_BASE}/api/v3/activities/${encodeURIComponent(activityApiId)}/tasks?offset=1&pageSize=20&includeDeleted=false`,
      { method: "GET", headers: getHeaders(token) }
    );
    if (!res.ok) return [];
    const raw = await res.json().catch(() => ({}));
    return extractListElements(raw)
      .slice()
      .sort((a, b) => (a?.position ?? 0) - (b?.position ?? 0))
      .map(mapApiTaskToNode);
  } catch (e) {
    return [];
  }
}

/* POST /api/v3/activities/{id}/tasks/create
   Single endpoint — type is auto-derived server-side from resourceMode.
   We send resourceMode + resourceCount/resource for Resource Type, else base. */
export async function createTaskApi(activityApiId, formData) {
  const token = requireToken();

  const { type, resourceMode } = activityServerTypePair(formData);
  const payload = buildActivityLikeBase(formData);

  if (type === "resource") {
    payload.resourceMode = resourceMode;
    Object.assign(payload, buildResourcePayload(formData));
  }

  const res = await fetch(
    `${API_BASE}/api/v3/activities/${encodeURIComponent(activityApiId)}/tasks/create`,
    { method: "POST", headers: jsonHeaders(token), body: JSON.stringify(payload) }
  );
  if (res.status === 401) throwAuth();
  if (!res.ok) await throwHttp(res);
  return parseData(res);
}

/* PATCH /api/v3/tasks/{id} — full payload, same shape as activity PATCH. */
export async function updateTaskApi(taskServerId, formData) {
  const token = requireToken();

  const { type, resourceMode } = activityServerTypePair(formData);

  const payload = {
    ...buildActivityLikeBase(formData),
    type
  };

  if (type === "resource") {
    payload.resourceMode = resourceMode;
    Object.assign(payload, buildResourcePayload(formData));
  }

  const res = await fetch(
    `${API_BASE}/api/v3/tasks/${encodeURIComponent(taskServerId)}`,
    { method: "PATCH", headers: jsonHeaders(token), body: JSON.stringify(payload) }
  );
  if (res.status === 401) throwAuth();
  if (!res.ok) await throwHttp(res);
  return parseData(res);
}

/* DELETE /api/v3/tasks/{id} */
export async function deleteTaskApi(taskServerId) {
  const token = requireToken();
  const res = await fetch(
    `${API_BASE}/api/v3/tasks/${encodeURIComponent(taskServerId)}`,
    { method: "DELETE", headers: getHeaders(token) }
  );
  if (res.status === 401) throwAuth();
  if (!res.ok && res.status !== 204) await throwHttp(res);
  return true;
}

/* ════════════════ Subtask APIs ════════════════ */

/* GET /api/v3/tasks/{id}/subtasks — returns mapped subtask nodes. */
export async function loadSubtasksForTask(taskApiId) {
  if (!taskApiId) return [];
  const token = getToken();
  if (!token) return [];

  try {
    const res = await fetch(
      `${API_BASE}/api/v3/tasks/${encodeURIComponent(taskApiId)}/subtasks?offset=1&pageSize=20&includeDeleted=false`,
      { method: "GET", headers: getHeaders(token) }
    );
    if (!res.ok) return [];
    const raw = await res.json().catch(() => ({}));
    return extractListElements(raw)
      .slice()
      .sort((a, b) => (a?.position ?? 0) - (b?.position ?? 0))
      .map(mapApiSubtaskToNode);
  } catch (e) {
    return [];
  }
}

/* POST /api/v3/tasks/{id}/subtasks/create
   Create payload is deliberately minimal — only name, description, and dates.
   Type/resource fields are NOT accepted by the create endpoint (only by PATCH). */
export async function createSubtaskApi(taskApiId, formData) {
  const token = requireToken();

  const payload = {
    name: formData.name.trim(),
    description: (formData.description || "").trim(),
    startDate: toMilestoneIsoStart(formData.startDate),
    endDate: toMilestoneIsoEnd(formData.endDate),
    actualStartDate: formData.actualStartDate ? toMilestoneIsoStart(formData.actualStartDate) : null,
    actualEndDate: formData.actualEndDate ? toMilestoneIsoEnd(formData.actualEndDate) : null
  };

  const res = await fetch(
    `${API_BASE}/api/v3/tasks/${encodeURIComponent(taskApiId)}/subtasks/create`,
    { method: "POST", headers: jsonHeaders(token), body: JSON.stringify(payload) }
  );
  if (res.status === 401) throwAuth();
  if (!res.ok) await throwHttp(res);
  return parseData(res);
}

/* PATCH /api/v3/subtasks/{id} — full payload same as task/activity PATCH. */
export async function updateSubtaskApi(subtaskServerId, formData) {
  const token = requireToken();

  const { type, resourceMode } = activityServerTypePair(formData);

  const payload = {
    ...buildActivityLikeBase(formData),
    type
  };

  if (type === "resource") {
    payload.resourceMode = resourceMode;
    Object.assign(payload, buildResourcePayload(formData));
  }

  const res = await fetch(
    `${API_BASE}/api/v3/subtasks/${encodeURIComponent(subtaskServerId)}`,
    { method: "PATCH", headers: jsonHeaders(token), body: JSON.stringify(payload) }
  );
  if (res.status === 401) throwAuth();
  if (!res.ok) await throwHttp(res);
  return parseData(res);
}

/* DELETE /api/v3/subtasks/{id} */
export async function deleteSubtaskApi(subtaskServerId) {
  const token = requireToken();
  const res = await fetch(
    `${API_BASE}/api/v3/subtasks/${encodeURIComponent(subtaskServerId)}`,
    { method: "DELETE", headers: getHeaders(token) }
  );
  if (res.status === 401) throwAuth();
  if (!res.ok && res.status !== 204) await throwHttp(res);
  return true;
}