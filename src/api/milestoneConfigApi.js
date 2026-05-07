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
  toMilestoneIsoStart,
  toMilestoneIsoEnd,
  mapStatusForApi,
  mapApiProject,
  mapApiMilestoneToNode,
  mapApiActivityToNode,
  mapApiTaskToNode,
  mapApiSubtaskToNode,
  mapApiMilestoneTreeToNode,
  extractListElements
} from "../utils/project/milestoneConfigHelpers";

const LIST_QS = "?offset=1&pageSize=20&includeDeleted=false";

/* Concerned Division wire format: a single-element array whose element is
   the comma-joined list of division codes — e.g. ["TMD1, TMD2"]. The UI
   keeps an array of codes; we join + wrap on send. Empty → null. */
function serializeConcernedDivision(v) {
  if (Array.isArray(v)) {
    const cleaned = v.map((x) => String(x || "").trim()).filter(Boolean);
    return cleaned.length ? [cleaned.join(", ")] : null;
  }
  const s = (v == null ? "" : String(v)).trim();
  return s ? [s] : null;
}
function hasConcernedDivision(v) {
  return Array.isArray(v) ? v.some((x) => String(x || "").trim()) : Boolean(v);
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
   activities share the same contract for dates and dependsOn. The server
   now expects `dependsOn` consistently across every entity (milestone,
   activity, task, subtask). */
function buildActivityLikeBase(project, formData) {
  return {
    name: formData.name.trim(),
    description: (formData.description || "").trim(),
    startDate: toMilestoneIsoStart(formData.startDate),
    endDate: toMilestoneIsoEnd(formData.endDate),
    actualStartDate: formData.actualStartDate ? toMilestoneIsoStart(formData.actualStartDate) : null,
    actualEndDate: formData.actualEndDate ? toMilestoneIsoEnd(formData.actualEndDate) : null,
    dependsOn: resolveDepDisplayIds(project, formData.dependsOn)
  };
}

function buildMilestonePayload(project, formData) {
  // PMIS_Screens design: vendor lives on activities, not milestones.
  // The API still accepts vendors[] here but the FE no longer sends it.
  return {
    name: formData.name.trim(),
    description: (formData.description || "").trim(),
    startDate: toMilestoneIsoStart(formData.startDate),
    endDate: toMilestoneIsoEnd(formData.endDate),
    status: mapStatusForApi(formData.status || "Not Completed"),
    /* Standardized to `dependsOn` across every entity (milestone, activity,
       task, subtask) so the server contract is uniform. */
    dependsOn: resolveDepDisplayIds(project, formData.dependsOn)
  };
}

/* After a successful create, post the typed Comments-&-Attachments inputs
   (text + files) to the new entity's /comments endpoint as a single
   multipart record. The backend silently ignores a `body` field on the
   entity-create payload — comments must be POSTed separately. Best-effort:
   failures here don't fail the parent create. */
async function postCommentAndAttachmentsAfterCreate(
  buildCommentsPath,
  apiData,
  formData
) {
  const id = extractNewEntityId(apiData);
  if (!id) return apiData;
  const text =
    typeof formData?.body === "string" ? formData.body.trim() : "";
  const files = Array.isArray(formData?.files) ? formData.files : [];
  if (!text && files.length === 0) return apiData;
  try {
    await postCommentMultipart(buildCommentsPath(id), text, files);
  } catch (err) {
    // The parent entity is already created; the comment-post is a
    // separate request. Log the failure so it's visible in the
    // browser console — easier to diagnose than silently dropping.
    // eslint-disable-next-line no-console
    console.error("[postCommentAndAttachmentsAfterCreate]", buildCommentsPath(id), err);
  }
  return apiData;
}

/* Multipart POST a single File to {API_BASE}{path}. Used to push
   attachments to /api/v3/{entity}/{id}/attachments after the entity has
   been created. Auth is injected by authorizedFetch; we deliberately do
   NOT set Content-Type so the browser writes the correct multipart
   boundary. */
async function uploadFile(path, file) {
  requireToken();
  const fd = new FormData();
  fd.append("file", file, file.name);
  const res = await authorizedFetch(url(path), {
    method: "POST",
    headers: { accept: "application/json" },
    body: fd
  });
  if (res.status === 401) throwAuth();
  if (!res.ok) await throwHttp(res);
  return parseData(res);
}

/* Resolve the new entity's ID from a create response. Server wrappers
   sometimes nest the record under `data`; we look in both spots. */
function extractNewEntityId(apiData) {
  if (!apiData) return null;
  return apiData.id || apiData.uuid || apiData.data?.id || apiData.data?.uuid || null;
}

/* GET /api/v3/{entity}/{id}/comments → list comments on an entity.
   Returns an array of {id, who, when, text, attachments} objects ready
   for the CommentsPanel to render. Returns [] on any failure (best-
   effort load — comments are non-critical). */
export async function loadCommentsForEntity(kind, entityApiId) {
  if (!entityApiId) return [];
  const buildPath =
    kind === "milestone" ? ENDPOINTS.milestones.comments :
    kind === "activity" ? ENDPOINTS.activities.comments :
    kind === "task" ? ENDPOINTS.tasks.comments :
    kind === "subtask" ? ENDPOINTS.subtasks.comments :
    null;
  if (!buildPath) return [];
  try {
    const raw = await apiGetOrEmpty(buildPath(entityApiId));
    const items = extractListElements(raw);
    return items.map(mapApiCommentToLocal);
  } catch {
    return [];
  }
}

function mapApiCommentToLocal(c) {
  const a = c?.author || {};
  const fullName = [a.firstName, a.lastName].filter(Boolean).join(" ");
  return {
    id: c?.id || "",
    who: fullName || a.login || a.email || "User",
    when: c?.createdAt || c?.updatedAt || "",
    text: c?.body || "",
    attachments: (Array.isArray(c?.attachments) ? c.attachments : []).map((at) => ({
      name: at?.filename || at?.url || "attachment",
      url: at?.url || ""
    }))
  };
}

/* Authorized download of a comment attachment. The server returns
   {filename, url} per attachment in the comments payload (see
   mapApiCommentToLocal). The URL requires the bearer token, so a plain
   <a href download> won't work — we fetch via authorizedFetch, build a
   blob, and trigger a download client-side. */
export async function downloadAttachment(rawUrl, filename) {
  if (!rawUrl) throw new Error("Attachment URL missing.");
  requireToken();
  const res = await authorizedFetch(rawUrl, {
    method: "GET",
    headers: { accept: "*/*" }
  });
  if (res.status === 401) throwAuth();
  if (!res.ok) await throwHttp(res);
  const blob = await res.blob();
  const objectUrl = URL.createObjectURL(blob);
  try {
    const a = document.createElement("a");
    a.href = objectUrl;
    a.download = filename || "attachment";
    document.body.appendChild(a);
    a.click();
    a.remove();
  } finally {
    // Defer revoke so the browser has time to start the download.
    setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
  }
}

/* Standalone POST to {entity}/{id}/comments — used by the "Post Comment"
   button in the edit modal so the user can attach a comment without saving
   the parent entity. Throws if neither text nor files are present (the
   server requires at least one). */
export async function postCommentForEntity(kind, entityApiId, text, files) {
  const buildPath =
    kind === "milestone" ? ENDPOINTS.milestones.comments :
    kind === "activity" ? ENDPOINTS.activities.comments :
    kind === "task" ? ENDPOINTS.tasks.comments :
    kind === "subtask" ? ENDPOINTS.subtasks.comments :
    null;
  if (!buildPath) throw new Error("Unsupported entity kind for comments.");
  if (!entityApiId) throw new Error("Save the item before adding a comment.");
  const trimmed = typeof text === "string" ? text.trim() : "";
  const fileList = Array.isArray(files) ? files.filter(Boolean) : [];
  if (!trimmed && fileList.length === 0) {
    throw new Error("Type a comment or attach a file before posting.");
  }
  return postCommentMultipart(buildPath(entityApiId), trimmed, fileList);
}

/* Post a comment as multipart/form-data: optional text body + zero or more
   files under the same form field name "files". The backend accepts this
   shape on POST /api/v3/{entity}/{id}/comments — either body or at least
   one file must be present. */
async function postCommentMultipart(path, text, files) {
  requireToken();
  const fd = new FormData();
  if (text) fd.append("body", text);
  if (Array.isArray(files)) {
    for (const file of files) {
      if (!file) continue;
      fd.append("files", file, file.name);
    }
  }
  const res = await authorizedFetch(url(path), {
    method: "POST",
    headers: { accept: "application/json" },
    body: fd
  });
  if (res.status === 401) throwAuth();
  if (!res.ok) await throwHttp(res);
  return parseData(res);
}

/* After an update succeeds, fold the typed Comments-&-Attachments inputs
   (text + files) into a single comment via POST {commentsPath}, sent as
   multipart so attachments hang off the same comment record. Best-effort
   — failures here don't fail the parent save (the entity update has
   already succeeded). Used by the update*Api functions so edit mode
   persists what the user typed without a separate Post-Comment click. */
async function postCommentAndAttachmentsAfterUpdate(
  buildCommentsPath,
  entityId,
  formData
) {
  if (!entityId) return;
  const text =
    typeof formData?.body === "string" ? formData.body.trim() : "";
  const files = Array.isArray(formData?.files) ? formData.files : [];
  if (!text && files.length === 0) return;
  try {
    await postCommentMultipart(buildCommentsPath(entityId), text, files);
  } catch (err) {
    // The parent entity is already updated; the comment-post is a
    // separate request. Log so failures are visible in DevTools.
    // eslint-disable-next-line no-console
    console.error("[postCommentAndAttachmentsAfterUpdate]", buildCommentsPath(entityId), err);
  }
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

/* One-shot tree fetch — /api/v3/projects/{id}/tree returns the full
   nested document (project metadata + milestones → activities → tasks →
   subtasks recursively). Replaces the 4-phase per-resource loader: one
   round-trip, one tree, no client-side stitching. */
export async function loadProjectTree(projectId) {
  if (!projectId) return null;
  const raw = await apiGet(ENDPOINTS.projects.tree(projectId) + "?includeDeleted=false");
  const data = raw?.data ?? raw ?? {};
  const project = mapApiProject(data.project);
  if (!project) return null;
  const milestones = Array.isArray(data.milestones) ? data.milestones : [];
  project.milestones = milestones.map(mapApiMilestoneTreeToNode);

  /* Workaround: the tree endpoint omits `dependsOn` and `dependsOnDisplay`
     on the milestone level (activities have them, milestones don't). Fetch
     the per-milestone list separately and merge those two fields back in
     so the Depends On column has data to render. */
  try {
    const flatRaw = await apiGetOrEmpty(ENDPOINTS.projects.milestones(projectId));
    const flat = extractListElements(flatRaw);
    if (flat.length) {
      const byId = new Map();
      for (const m of flat) {
        if (m && m.id) byId.set(m.id, m);
      }
      for (const node of project.milestones) {
        const src = node && node.apiId ? byId.get(node.apiId) : null;
        if (!src) continue;
        if (Array.isArray(src.dependsOn)) node.dependsOn = src.dependsOn.slice();
        if (Array.isArray(src.dependsOnDisplay) && src.dependsOnDisplay.length) {
          node.dependsOnDisplay = src.dependsOnDisplay.slice();
        }
      }
    }
  } catch {
    /* swallow — best-effort augmentation */
  }
  return project;
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
      // Trust the server-provided dependsOnDisplay (already resolved to
      // WBS codes) when the local recomputation comes up empty — e.g.
      // during partial / progressive loads where the dependency target
      // isn't in the indexed tree yet. Avoids the table flashing empty.
      if (display.length) {
        n.dependsOnDisplay = display;
      } else if (!Array.isArray(n.dependsOnDisplay) || n.dependsOnDisplay.length === 0) {
        n.dependsOnDisplay = [];
      }
      n.dependsOn = n.dependsOn
        .map((v) => {
          if (uidSet.has(v)) return v;
          return apiIdToUid[v] || displayIdToUid[v] || null;
        })
        .filter(Boolean);
    } else {
      n.dependsOn = [];
      if (!Array.isArray(n.dependsOnDisplay)) n.dependsOnDisplay = [];
    }
    if (n.activities) n.activities.forEach(translate);
    if (n.tasks) n.tasks.forEach(translate);
    if (n.subtasks) n.subtasks.forEach(translate);
  }
  if (Array.isArray(project.milestones)) project.milestones.forEach(translate);
}

/* Doc 38: milestone-create body is minimal (name + description + dates).
   status and dependsOn flow via PATCH after the row exists. Fire a
   follow-up PATCH only when the user actually entered a non-default
   status or any dependencies on the form. */
export async function createMilestoneApi(project, formData) {
  const created = await apiSend(
    "POST",
    ENDPOINTS.projects.milestoneCreate(project.projectId),
    {
      name: formData.name.trim(),
      description: (formData.description || "").trim(),
      startDate: toMilestoneIsoStart(formData.startDate),
      endDate: toMilestoneIsoEnd(formData.endDate)
    }
  );
  const newId = extractNewEntityId(created);
  const status = mapStatusForApi(formData.status || "Not Completed");
  const deps = resolveDepDisplayIds(project, formData.dependsOn);
  if (newId && (status !== "not_completed" || deps.length)) {
    try {
      await apiSend(
        "PATCH",
        ENDPOINTS.milestones.update(newId),
        buildMilestonePayload(project, formData)
      );
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error("[createMilestoneApi: post-create PATCH]", err);
    }
  }
  return postCommentAndAttachmentsAfterCreate(ENDPOINTS.milestones.comments, created, formData);
}

export async function updateMilestoneApi(milestoneServerId, formData, project) {
  const updated = await apiSend(
    "PATCH",
    ENDPOINTS.milestones.update(milestoneServerId),
    buildMilestonePayload(project, formData)
  );
  await postCommentAndAttachmentsAfterUpdate(
    ENDPOINTS.milestones.comments,
    milestoneServerId,
    formData
  );
  return updated;
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

/* Doc 38: activity-create body is minimal (just name/description/dates).
   The richer fields (ownerDivision / vendorId / concernedDivision / status /
   dependsOn / actuals) are sent via a follow-up PATCH so the user's add-modal
   inputs persist on first save. */
export async function createActivityApi(milestoneApiId, formData, project) {
  const created = await apiSend(
    "POST",
    ENDPOINTS.milestones.activityCreate(milestoneApiId),
    {
      name: formData.name.trim(),
      description: (formData.description || "").trim(),
      startDate: toMilestoneIsoStart(formData.startDate),
      endDate: toMilestoneIsoEnd(formData.endDate)
    }
  );
  const newId = extractNewEntityId(created);
  if (newId && hasActivityRichFields(formData, project)) {
    try {
      await apiSend(
        "PATCH",
        ENDPOINTS.activities.update(newId),
        buildActivityPatchBody(project, formData)
      );
    } catch {
      /* swallow — entity is created; rich-field PATCH is best-effort */
    }
  }
  return postCommentAndAttachmentsAfterCreate(ENDPOINTS.activities.comments, created, formData);
}

/* Returns true if any of the design-level fields the activity-create
   endpoint doesn't accept are present on the form. Used to decide whether
   the follow-up PATCH after create is worth firing. */
function hasActivityRichFields(formData, project) {
  if (formData.ownerDivision) return true;
  if (formData.vendorId) return true;
  if (hasConcernedDivision(formData.concernedDivision)) return true;
  const deps = resolveDepDisplayIds(project, formData.dependsOn);
  if (Array.isArray(deps) && deps.length) return true;
  if (formData.actualStartDate) return true;
  if (formData.actualEndDate) return true;
  return false;
}

function buildActivityPatchBody(project, formData) {
  const body = {
    ...buildActivityLikeBase(project, formData),
    status: mapStatusForApi(formData.status || "Not Completed")
  };
  if (formData.ownerDivision !== undefined)
    body.ownerDivision = formData.ownerDivision || null;
  if (formData.vendorId !== undefined)
    body.vendorId = formData.vendorId || null;
  if (formData.concernedDivision !== undefined)
    body.concernedDivision = serializeConcernedDivision(formData.concernedDivision);
  return body;
}

/* Doc 38: PATCH body excludes type/resourceMode/resource (gone from the
   activity model). Owner/Vendor/Concerned Division are accepted. */
export async function updateActivityApi(activityServerId, formData, project) {
  const updated = await apiSend(
    "PATCH",
    ENDPOINTS.activities.update(activityServerId),
    buildActivityPatchBody(project, formData)
  );
  await postCommentAndAttachmentsAfterUpdate(
    ENDPOINTS.activities.comments,
    activityServerId,
    formData
  );
  return updated;
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

/* Doc 38: task create body is minimal. type/resource fields no longer
   exist on tasks at the API level. dependsOn / actuals flow via a
   follow-up PATCH so the add-modal Depends On selections persist on
   first save. */
export async function createTaskApi(activityApiId, formData, project) {
  const created = await apiSend(
    "POST",
    ENDPOINTS.activities.taskCreate(activityApiId),
    {
      name: formData.name.trim(),
      description: (formData.description || "").trim(),
      startDate: toMilestoneIsoStart(formData.startDate),
      endDate: toMilestoneIsoEnd(formData.endDate)
    }
  );
  const newId = extractNewEntityId(created);
  const deps = resolveDepDisplayIds(project, formData.dependsOn);
  if (newId && (deps.length || formData.actualStartDate || formData.actualEndDate)) {
    try {
      await apiSend(
        "PATCH",
        ENDPOINTS.tasks.update(newId),
        {
          ...buildActivityLikeBase(project, formData),
          status: mapStatusForApi(formData.status || "Not Completed")
        }
      );
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error("[createTaskApi: post-create PATCH]", err);
    }
  }
  return postCommentAndAttachmentsAfterCreate(ENDPOINTS.tasks.comments, created, formData);
}

/* Doc 38: PATCH body excludes type/resourceMode/resource. */
export async function updateTaskApi(taskServerId, formData, project) {
  const payload = {
    ...buildActivityLikeBase(project, formData),
    status: mapStatusForApi(formData.status || "Not Completed")
  };

  const updated = await apiSend(
    "PATCH",
    ENDPOINTS.tasks.update(taskServerId),
    payload
  );
  await postCommentAndAttachmentsAfterUpdate(
    ENDPOINTS.tasks.comments,
    taskServerId,
    formData
  );
  return updated;
}

export async function deleteTaskApi(taskServerId) {
  return apiDelete(ENDPOINTS.tasks.remove(taskServerId));
}

/* ════════════════ Subtask APIs ════════════════ */

/* Pull the embedded direct-child subtasks out of a response. The same
   helper handles four shapes:
     1. response is itself an array of subtask records
     2. response is a parent record with children under a known key
        (subtasks / children / descendants / items / _embedded.{...})
     3. response is wrapped under a `data` envelope (any of the above
        nested one level deeper)
     4. unknown key — last-resort scan of the response (and _embedded)
        for any array whose first element looks like a subtask record
        (has id / uuid / name).
   Returns the first array found, or [] if none. */
function extractEmbeddedSubtasks(raw) {
  if (!raw) return [];
  if (Array.isArray(raw)) return raw;

  const data = raw.data;
  if (Array.isArray(data)) return data;

  const node = data ?? raw;
  if (!node || typeof node !== "object") return [];
  if (Array.isArray(node)) return node;

  const candidates = [
    node.subtasks,
    node.children,
    node.descendants,
    node.items,
    node._embedded?.subtasks,
    node._embedded?.children,
    node._embedded?.descendants,
    node._embedded?.elements
  ];
  const known = candidates.find((c) => Array.isArray(c));
  if (known) return known;

  // Last-resort scan: walk every property of the node (and _embedded)
  // and return the first array whose entries look like subtask records.
  function looksLikeSubtaskList(val) {
    if (!Array.isArray(val) || val.length === 0) return false;
    const first = val[0];
    return !!(first && typeof first === "object"
      && (first.id || first.uuid || first.name));
  }
  for (const key of Object.keys(node)) {
    if (looksLikeSubtaskList(node[key])) return node[key];
  }
  const emb = node._embedded;
  if (emb && typeof emb === "object" && !Array.isArray(emb)) {
    for (const key of Object.keys(emb)) {
      if (looksLikeSubtaskList(emb[key])) return emb[key];
    }
  }
  return [];
}

/* Direct sub-task children of a task — fully nested.

   The list endpoint /api/v3/tasks/{id}/subtasks returns every descendant
   sub-task under the task in a single flat list, where each entry carries
   a `parentSubtaskId` that's null for direct children of the task and the
   parent sub-task's UUID for nested ones. We rebuild the tree client-side
   from those parent links — one HTTP call covers the whole sub-tree, no
   matter how deeply nested the user has gone. */
export async function loadSubtasksForTask(taskApiId) {
  if (!taskApiId) return [];
  const raw = await apiGetOrEmpty(ENDPOINTS.tasks.subtasks(taskApiId) + LIST_QS);
  const flat = sortByPosition(extractListElements(raw)).map(mapApiSubtaskToNode);
  return buildSubtaskTree(flat);
}

/* Group a flat sub-task list (each item carrying parentSubtaskApiId) into
   a nested tree. Items whose parent is missing from the list (or null) are
   treated as direct children of the task, so we never silently drop nodes
   if the server returns an out-of-order or partial chain. */
function buildSubtaskTree(flat) {
  if (!Array.isArray(flat) || flat.length === 0) return [];
  const byApiId = new Map();
  flat.forEach((s) => {
    if (s && s.apiId) byApiId.set(s.apiId, s);
  });
  const roots = [];
  flat.forEach((s) => {
    if (!s) return;
    s.subtasks = [];
    const parentId = s.parentSubtaskApiId;
    if (parentId && byApiId.has(parentId)) {
      const parent = byApiId.get(parentId);
      parent.subtasks = parent.subtasks || [];
      parent.subtasks.push(s);
    } else {
      roots.push(s);
    }
  });
  return roots;
}

/* Kept for callers that explicitly want children of one subtask. The main
   loader no longer needs this — loadSubtasksForTask returns the entire
   nested tree in one shot. */
export async function loadSubtasksForSubtask(subtaskApiId) {
  if (!subtaskApiId) return [];
  const raw = await apiGetOrEmpty(ENDPOINTS.subtasks.subtasks(subtaskApiId) + LIST_QS);
  const flat = sortByPosition(extractListElements(raw)).map(mapApiSubtaskToNode);
  return flat.filter((s) => !s.parentSubtaskApiId || s.parentSubtaskApiId === subtaskApiId);
}

export async function loadSubtaskById(subtaskApiId) {
  if (!subtaskApiId) return null;
  const raw = await apiGet(ENDPOINTS.subtasks.get(subtaskApiId));
  const s = raw?.data ?? raw;
  return s && (s.id || s.uuid || s.name) ? mapApiSubtaskToNode(s) : null;
}

/* Single-GET on /api/v3/subtasks/{id}. Returns the refreshed node AND any
   embedded child sub-tasks present in the response. Used to "pull on
   demand" when the user expands a sub-task row — every expand fires this
   endpoint (visible in the network tab) and any children the server
   returns become this row's local children. If the response carries no
   children, the caller keeps the existing local list, so initial-load
   data isn't lost. */
export async function loadSubtaskAndChildren(subtaskApiId) {
  if (!subtaskApiId) return null;
  const raw = await apiGetOrEmpty(ENDPOINTS.subtasks.get(subtaskApiId));
  const data = raw?.data ?? raw;
  if (!data || (!data.id && !data.uuid && !data.name)) return null;
  const node = mapApiSubtaskToNode(data);
  const children = extractEmbeddedSubtasks(raw).map(mapApiSubtaskToNode);
  return { node, children };
}

/* Create payload is deliberately minimal — only name, description, dates,
   and dependency list. Type/resource fields are NOT accepted by the
   create endpoint (only by PATCH).
   Mirrors the rest of the hierarchy (project→milestone, milestone→
   activity, activity→task, task→subtask). When `parentKind` is
   "subtask" we POST to /subtasks/{id}/subtasks/create so a subtask can
   contain another subtask, and so on, infinitely. */
export async function createSubtaskApi(parentApiId, formData, project, parentKind = "task") {
  // Doc 38: minimal create body — actuals/dependsOn flow via PATCH.
  const payload = {
    name: formData.name.trim(),
    description: (formData.description || "").trim(),
    startDate: toMilestoneIsoStart(formData.startDate),
    endDate: toMilestoneIsoEnd(formData.endDate)
  };
  const createPath =
    parentKind === "subtask"
      ? ENDPOINTS.subtasks.subtaskCreate(parentApiId)
      : ENDPOINTS.tasks.subtaskCreate(parentApiId);
  const created = await apiSend("POST", createPath, payload);
  const newId = extractNewEntityId(created);
  const deps = resolveDepDisplayIds(project, formData.dependsOn);
  if (newId && (deps.length || formData.actualStartDate || formData.actualEndDate)) {
    try {
      await apiSend(
        "PATCH",
        ENDPOINTS.subtasks.update(newId),
        {
          ...buildActivityLikeBase(project, formData),
          status: mapStatusForApi(formData.status || "Not Completed")
        }
      );
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error("[createSubtaskApi: post-create PATCH]", err);
    }
  }
  return postCommentAndAttachmentsAfterCreate(ENDPOINTS.subtasks.comments, created, formData);
}

/* Doc 38: PATCH body excludes type/resourceMode/resource. */
export async function updateSubtaskApi(subtaskServerId, formData, project) {
  const payload = {
    ...buildActivityLikeBase(project, formData),
    status: mapStatusForApi(formData.status || "Not Completed")
  };

  const updated = await apiSend(
    "PATCH",
    ENDPOINTS.subtasks.update(subtaskServerId),
    payload
  );
  await postCommentAndAttachmentsAfterUpdate(
    ENDPOINTS.subtasks.comments,
    subtaskServerId,
    formData
  );
  return updated;
}

export async function deleteSubtaskApi(subtaskServerId) {
  return apiDelete(ENDPOINTS.subtasks.remove(subtaskServerId));
}
