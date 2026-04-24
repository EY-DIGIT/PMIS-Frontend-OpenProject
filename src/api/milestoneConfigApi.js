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
  mapApiProject,
  mapApiMilestoneToNode,
  mapApiActivityToNode,
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

/* Throws an auth-tagged error that callers can catch to redirect to /login. */
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

/* ════════════════ Project APIs ════════════════ */

/* GET /api/v3/projects/{id} — returns a mapped local project object. */
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

/* POST /api/v3/projects/{id}/save */
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

/* GET /api/v3/projects/{id}/milestones — returns mapped local nodes, sorted by position. */
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

/* POST /api/v3/projects/{id}/milestones/create */
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

/* PATCH /api/v3/milestones/{id} */
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

/* DELETE /api/v3/milestones/{id} */
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

/* GET /api/v3/milestones/{id}/activities — returns mapped nodes, sorted by position.
   Silent failure: loading activities is non-critical; return [] on any error. */
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

/* POST /api/v3/milestones/{id}/activities/{endpoint}/create
   Endpoint path is one of: standard, transactional, resource/count, resource/details */
export async function createActivityApi(milestoneApiId, formData) {
  const token = requireToken();

  const endpoint = activityEndpointFor(formData);

  const base = {
    name: formData.name.trim(),
    description: (formData.description || "").trim(),
    startDate: toMilestoneIsoStart(formData.startDate),
    endDate: toMilestoneIsoEnd(formData.endDate),
    actualStartDate: formData.actualStartDate ? toMilestoneIsoStart(formData.actualStartDate) : null,
    actualEndDate: formData.actualEndDate ? toMilestoneIsoEnd(formData.actualEndDate) : null,
    position: 0,
    dependsOn: []
  };

  let payload;
  if (endpoint === "standard") {
    payload = { ...base, status: mapStatusForApi(formData.status || "Not Completed") };
  } else if (endpoint === "transactional") {
    payload = { ...base };
  } else if (endpoint === "resource/count") {
    const rc = formData.resourceCount || {};
    payload = { ...base, resourceCount: parseInt(rc.count, 10) || 1 };
  } else {
    const rd = formData.resourceDetails || {};
    payload = {
      ...base,
      resource: {
        resourceName: rd.resourceName || "",
        onboardDate: rd.onboardingDate ? toMilestoneIsoStart(rd.onboardingDate) : null,
        actualOnboardDate: rd.actualOnboardingDate ? toMilestoneIsoStart(rd.actualOnboardingDate) : null,
        offboardDate: rd.offboardingDate ? toMilestoneIsoEnd(rd.offboardingDate) : null,
        actualOffboardDate: rd.actualOffboardingDate ? toMilestoneIsoEnd(rd.actualOffboardingDate) : null,
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

/* PATCH /api/v3/activities/{id}
   Single endpoint, takes type + resourceMode + full payload. */
export async function updateActivityApi(activityServerId, formData) {
  const token = requireToken();

  const { type, resourceMode } = activityServerTypePair(formData);

  const payload = {
    name: formData.name.trim(),
    description: (formData.description || "").trim(),
    type,
    startDate: toMilestoneIsoStart(formData.startDate),
    endDate: toMilestoneIsoEnd(formData.endDate),
    actualStartDate: formData.actualStartDate ? toMilestoneIsoStart(formData.actualStartDate) : null,
    actualEndDate: formData.actualEndDate ? toMilestoneIsoEnd(formData.actualEndDate) : null,
    position: 0,
    status: mapStatusForApi(formData.status || "Not Completed"),
    dependsOn: []
  };

  if (type === "resource") {
    payload.resourceMode = resourceMode;
    if (resourceMode === "count") {
      const rc = formData.resourceCount || {};
      payload.resourceCount = parseInt(rc.count, 10) || 1;
    } else {
      const rd = formData.resourceDetails || {};
      payload.resource = {
        resourceName: rd.resourceName || "",
        onboardDate: rd.onboardingDate ? toMilestoneIsoStart(rd.onboardingDate) : null,
        actualOnboardDate: rd.actualOnboardingDate ? toMilestoneIsoStart(rd.actualOnboardingDate) : null,
        offboardDate: rd.offboardingDate ? toMilestoneIsoEnd(rd.offboardingDate) : null,
        actualOffboardDate: rd.actualOffboardingDate ? toMilestoneIsoEnd(rd.actualOffboardingDate) : null,
        position: rd.position || "",
        designation: rd.designation || "",
        jobRole: rd.jobRole || "",
        qualification: rd.qualification || "",
        experienceYears: parseFloat(rd.experience) || 0,
        typeOfResourceId: rd.resType || "",
        division: rd.division || "",
        divisionOther: ""
      };
    }
  }

  const res = await fetch(
    `${API_BASE}/api/v3/activities/${encodeURIComponent(activityServerId)}`,
    { method: "PATCH", headers: jsonHeaders(token), body: JSON.stringify(payload) }
  );
  if (res.status === 401) throwAuth();
  if (!res.ok) await throwHttp(res);
  return parseData(res);
}

/* DELETE /api/v3/activities/{id} */
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
