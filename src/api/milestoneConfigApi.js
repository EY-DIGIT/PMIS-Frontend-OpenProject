/* ══════════════════════════════════════════════════════════════════
   src/api/milestoneConfigApi.js

   Direct fetch wrappers for every endpoint MilestoneConfigPage touches.
   Each function:
   - Reads the JWT from getToken()
   - On 401 → calls logout() and throws Error with isAuth=true
   - On !ok → throws Error with server's friendly message
   - Returns the unwrapped `data` payload (server wraps as {data, error, status})
   ══════════════════════════════════════════════════════════════════ */

import { API_BASE, authorizedFetch } from "./client";
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
  requireToken();
  const res = await authorizedFetch(url(path), {
    method: "GET",
    headers: { accept: "application/json" }
  });
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
    const res = await authorizedFetch(url(path), {
      method: "GET",
      headers: { accept: "application/json" }
    });
    if (!res.ok) return [];
    return await res.json().catch(() => ({}));
  } catch {
    return [];
  }
}

async function apiSend(method, path, body) {
  requireToken();
  const res = await authorizedFetch(url(path), {
    method,
    headers: {
      accept: "application/json",
      "Content-Type": "application/json"
    },
    body: JSON.stringify(body ?? {})
  });
  if (res.status === 401) throwAuth();
  if (!res.ok) await throwHttp(res);
  return parseData(res);
}

async function apiDelete(path) {
  requireToken();
  const res = await authorizedFetch(url(path), {
    method: "DELETE",
    headers: { accept: "application/json" }
  });
  if (res.status === 401) throwAuth();
  if (!res.ok && res.status !== 204) await throwHttp(res);
  return true;
}

function sortByPosition(list) {
  return list.slice().sort((a, b) => (a?.position ?? 0) - (b?.position ?? 0));
}

/* Resolve form dependsOn (local node UIDs) → display IDs (M1, M2, …) by
   walking the project tree. Unknown UIDs are dropped. */
function resolveDepDisplayIds(project, uids) {
  if (!project || !Array.isArray(uids) || uids.length === 0) return [];
  const map = {};
  function walk(list) {
    if (!Array.isArray(list)) return;
    for (const n of list) {
      if (!n) continue;
      if (n.uid && n.id) map[n.uid] = n.id;
      if (n.activities) walk(n.activities);
      if (n.tasks) walk(n.tasks);
      if (n.subtasks) walk(n.subtasks);
    }
  }
  walk(project.milestones);
  return uids.map((u) => map[u]).filter(Boolean);
}

/* Common base fields for activity/task create & update. Tasks and
   activities share the same contract for dates, dependsOn, position.
   The server now expects `dependsOn` consistently across every entity
   (milestone, activity, task, subtask). */
function buildActivityLikeBase(project, formData) {
  return {
    name: formData.name.trim(),
    description: (formData.description || "").trim(),
    startDate: toMilestoneIsoStart(formData.startDate),
    endDate: toMilestoneIsoEnd(formData.endDate),
    actualStartDate: formData.actualStartDate ? toMilestoneIsoStart(formData.actualStartDate) : null,
    actualEndDate: formData.actualEndDate ? toMilestoneIsoEnd(formData.actualEndDate) : null,
    position: 0,
    dependsOn: resolveDepDisplayIds(project, formData.dependsOn)
  };
}

function buildMilestonePayload(project, formData) {
  return {
    name: formData.name.trim(),
    description: (formData.description || "").trim(),
    startDate: toMilestoneIsoStart(formData.startDate),
    endDate: toMilestoneIsoEnd(formData.endDate),
    status: mapStatusForApi(formData.status || "Not Completed"),
    vendorIds: resolveVendorIds(project, formData.vendor),
    /* Standardized to `dependsOn` across every entity (milestone, activity,
       task, subtask) so the server contract is uniform. */
    dependsOn: resolveDepDisplayIds(project, formData.dependsOn)
  };
}

/* ════════════════ Resource Types ════════════════ */

export async function loadResourceTypes() {
  const raw = await apiGet(ENDPOINTS.resourceTypes.list);
  return extractListElements(raw)
    .filter((r) => r && r.active !== false)
    .map((r) => ({
      id: r.id || "",
      code: r.code || "",
      name: r.name || r.code || ""
    }));
}

/* ════════════════ Divisions ════════════════ */

export async function loadDivisions() {
  const raw = await apiGet(ENDPOINTS.divisions.list);
  return extractListElements(raw)
    .filter((d) => d && d.code && d.label)
    .map((d) => ({
      code: d.code,
      label: d.label,
      requiresOther: !!d.requiresOther
    }));
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

/* Walk the entire project tree and translate every node's `dependsOn`
   from raw server values (UUID apiIds OR display IDs like "M1", "A1.2",
   "T1.2.3") into the local UIDs the form-picker understands. The original
   server display IDs are preserved on `dependsOnDisplay` so the table can
   render them directly without depMap look-ups.
   Idempotent: values that are already known local UIDs are kept as-is,
   so it's safe to call repeatedly during the 4-phase progressive load. */
export function resolveProjectDependsOn(project) {
  if (!project) return;
  const apiIdToUid = {};
  const displayIdToUid = {};
  const uidToDisplayId = {};
  const uidSet = new Set();

  function indexNode(n) {
    if (!n || !n.uid) return;
    uidSet.add(n.uid);
    if (n.apiId) apiIdToUid[n.apiId] = n.uid;
    if (n.id) {
      displayIdToUid[n.id] = n.uid;
      uidToDisplayId[n.uid] = n.id;
    }
  }
  function walkIndex(list) {
    if (!Array.isArray(list)) return;
    for (const n of list) {
      indexNode(n);
      if (n) {
        if (n.activities) walkIndex(n.activities);
        if (n.tasks) walkIndex(n.tasks);
        if (n.subtasks) walkIndex(n.subtasks);
      }
    }
  }
  walkIndex(project.milestones);

  function translate(n) {
    if (!n) return;
    if (Array.isArray(n.dependsOn)) {
      // Capture display IDs BEFORE translating to UIDs so the table can
      // show "M1" / "A1.2" without going through depMap.
      const display = n.dependsOn
        .map((v) => {
          if (uidSet.has(v)) return uidToDisplayId[v] || null;
          return displayIdToUid[v] ? v : (apiIdToUid[v] ? uidToDisplayId[apiIdToUid[v]] : null);
        })
        .filter(Boolean);
      n.dependsOnDisplay = display;
      n.dependsOn = n.dependsOn
        .map((v) => {
          if (uidSet.has(v)) return v;
          return apiIdToUid[v] || displayIdToUid[v] || null;
        })
        .filter(Boolean);
    } else {
      n.dependsOn = [];
      n.dependsOnDisplay = [];
    }
    if (n.activities) n.activities.forEach(translate);
    if (n.tasks) n.tasks.forEach(translate);
    if (n.subtasks) n.subtasks.forEach(translate);
  }
  if (Array.isArray(project.milestones)) project.milestones.forEach(translate);
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

/* Single-record fetch — list endpoints return summaries that omit the
   nested `resource` object, so edit modals fetch the full record here. */
export async function loadActivityById(activityApiId) {
  if (!activityApiId) return null;
  const raw = await apiGet(ENDPOINTS.activities.get(activityApiId));
  const a = raw?.data ?? raw;
  return a && (a.id || a.uuid || a.name) ? mapApiActivityToNode(a) : null;
}

export async function createActivityApi(milestoneApiId, formData, project) {
  const endpoint = activityEndpointFor(formData);
  const base = buildActivityLikeBase(project, formData);

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

export async function updateActivityApi(activityServerId, formData, project) {
  const { type, resourceMode } = activityServerTypePair(formData);

  const payload = {
    ...buildActivityLikeBase(project, formData),
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

export async function loadTaskById(taskApiId) {
  if (!taskApiId) return null;
  const raw = await apiGet(ENDPOINTS.tasks.get(taskApiId));
  const t = raw?.data ?? raw;
  return t && (t.id || t.uuid || t.name) ? mapApiTaskToNode(t) : null;
}

/* Single create endpoint — type is auto-derived server-side from resourceMode.
   We send resourceMode + resourceCount/resource for Resource Type, else base. */
export async function createTaskApi(activityApiId, formData, project) {
  const { type, resourceMode } = activityServerTypePair(formData);
  const payload = buildActivityLikeBase(project, formData);

  if (type === "resource") {
    payload.resourceMode = resourceMode;
    Object.assign(payload, buildResourcePayload(formData));
  }

  return apiSend("POST", ENDPOINTS.activities.taskCreate(activityApiId), payload);
}

/* Full payload, same shape as activity PATCH. */
export async function updateTaskApi(taskServerId, formData, project) {
  const { type, resourceMode } = activityServerTypePair(formData);

  const payload = {
    ...buildActivityLikeBase(project, formData),
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

export async function loadSubtaskById(subtaskApiId) {
  if (!subtaskApiId) return null;
  const raw = await apiGet(ENDPOINTS.subtasks.get(subtaskApiId));
  const s = raw?.data ?? raw;
  return s && (s.id || s.uuid || s.name) ? mapApiSubtaskToNode(s) : null;
}

/* Create payload is deliberately minimal — only name, description, dates,
   and dependency list. Type/resource fields are NOT accepted by the
   create endpoint (only by PATCH). */
export async function createSubtaskApi(taskApiId, formData, project) {
  const payload = {
    name: formData.name.trim(),
    description: (formData.description || "").trim(),
    startDate: toMilestoneIsoStart(formData.startDate),
    endDate: toMilestoneIsoEnd(formData.endDate),
    actualStartDate: formData.actualStartDate ? toMilestoneIsoStart(formData.actualStartDate) : null,
    actualEndDate: formData.actualEndDate ? toMilestoneIsoEnd(formData.actualEndDate) : null,
    dependsOn: resolveDepDisplayIds(project, formData.dependsOn)
  };
  return apiSend("POST", ENDPOINTS.tasks.subtaskCreate(taskApiId), payload);
}

/* Full payload same as task/activity PATCH. */
export async function updateSubtaskApi(subtaskServerId, formData, project) {
  const { type, resourceMode } = activityServerTypePair(formData);

  const payload = {
    ...buildActivityLikeBase(project, formData),
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
