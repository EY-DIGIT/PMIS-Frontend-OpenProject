/* ══════════════════════════════════════════════════════════════════
   src/utils/project/milestoneConfigHelpers.js

   Pure helpers used by MilestoneConfigPage:
   - Date/ISO string conversions
   - API ↔ UI status and type mapping
   - Vendor ID resolution against a project
   - Error body extraction
   - API-response → local node/project shape mappers
   - Activity/task/subtask endpoint resolvers
   - LocalStorage draft persistence for onboarding
   - Tree helpers (findEnclosingTaskApiId)
   ══════════════════════════════════════════════════════════════════ */

import { generateNodeUid, safeArray } from "./helpers";

/* ─── Onboarding draft persistence ─── */
export const DRAFT_STORAGE_KEY = "uidai_onboarding_draft";

export function persistOnboardingDraft(p) {
  if (!p || !p.projectId) return;
  try {
    const snapshot = {
      projectId: p.projectId,
      projectName: p.projectName,
      description: p.description,
      owner: p.owner,
      startDate: p.startDate,
      endDate: p.endDate,
      vendors: safeArray(p.vendors),
      status: p.status || "DRAFT"
    };
    localStorage.setItem(DRAFT_STORAGE_KEY, JSON.stringify(snapshot));
  } catch (e) {}
}

export function readPersistedOnboardingDraft() {
  try {
    const raw = localStorage.getItem(DRAFT_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return parsed && parsed.projectId ? parsed : null;
  } catch (e) {
    return null;
  }
}

export function clearPersistedOnboardingDraft() {
  try { localStorage.removeItem(DRAFT_STORAGE_KEY); } catch (e) {}
}

/* ─── Date conversions ───
   The user picks YYYY-MM-DD in an IST-rendered <input type="date">. Send
   the same date with an explicit IST offset — keeping the offset visible
   in the payload (instead of rolling forward to a UTC `Z` instant) means
   what the user picked is exactly what shows up on the wire and what the
   backend stores. */
const IST_OFFSET = "+05:30";
export function toMilestoneIsoStart(d) {
  if (!d) return null;
  return `${d}T00:00:00${IST_OFFSET}`;
}

export function toMilestoneIsoEnd(d) {
  if (!d) return null;
  return `${d}T23:59:59${IST_OFFSET}`;
}

/* The backend stores IST midnight as a UTC timestamp ending +00:00 — e.g.
   `2026-05-06T18:30:00+00:00` is 7 May 00:00 IST. Naively chopping at "T"
   gives "2026-05-06" (the UTC date), one day off the IST date the user
   actually picked. Below: parse the ISO instant, project to IST by adding
   330 minutes, then format YYYY-MM-DD from the UTC components. Plain
   YYYY-MM-DD strings (no offset) round-trip unchanged. */
const IST_OFFSET_MINUTES = 330;
function _toIstDate(iso) {
  if (!iso) return "";
  const s = String(iso);
  if (!s.includes("T")) return s; // already YYYY-MM-DD
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return s.slice(0, s.indexOf("T"));
  const shifted = new Date(d.getTime() + IST_OFFSET_MINUTES * 60000);
  const y = shifted.getUTCFullYear();
  const m = String(shifted.getUTCMonth() + 1).padStart(2, "0");
  const day = String(shifted.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function toDateInputValue(iso) { return _toIstDate(iso); }
export function stripTime(iso) { return _toIstDate(iso); }

/* ─── Status mapping ─── */
export function mapStatusForApi(s) {
  return s === "Completed" ? "completed" : "not_completed";
}

export function mapStatusFromApi(s) {
  return s === "completed" ? "Completed" : "Not Completed";
}

/* ─── Vendor name → UUID resolution (uses project.vendors) ─── */
export function resolveVendorIds(project, vendorName) {
  if (!vendorName) return [];
  const vendors = safeArray(project && project.vendors);
  const match = vendors.find((v) => {
    if (v && typeof v === "object") return v.name === vendorName;
    return v === vendorName;
  });
  if (match && typeof match === "object" && match.id) return [match.id];
  return [];
}

/* ─── Pull a friendly message out of a server error body ─── */
export async function readErrorBody(res) {
  const body = await res.text().catch(() => "");
  if (!body) return `Request failed (${res.status})`;
  try {
    const parsed = JSON.parse(body);
    return parsed?.error?.message || parsed?.message || parsed?.detail || body;
  } catch (e) {
    return body;
  }
}

/* ─── API → local project shape ─── */
export function mapApiProject(p) {
  if (!p) return null;
  return {
    projectId: p.id || "",
    projectCode: p.projectCode || "",
    projectName: p.name || "",
    description: p.description || "",
    owner: p.owner || "",
    status: p.status ? String(p.status).toUpperCase() : "",
    startDate: stripTime(p.startDate),
    endDate: stripTime(p.endDate),
    actualEndDate: stripTime(p.actualEndDate),
    vendors: Array.isArray(p.vendors) ? p.vendors : [],
    parentId: p.parentId || null,
    milestones: [],
    auditLogs: [],
    resources: []
  };
}

/* ─── API → local milestone node ─── */
export function mapApiMilestoneToNode(m) {
  const vendors = Array.isArray(m.vendors) ? m.vendors : [];
  /* Server returns dependsOn as UUIDs and dependsOnDisplay as the
     human-readable WBS codes ("M1", "M2"). Older shapes used `depends`
     under just one key; fall back to that if dependsOnDisplay is missing. */
  const rawDeps = Array.isArray(m.dependsOn)
    ? m.dependsOn
    : Array.isArray(m.depends)
    ? m.depends
    : [];
  const rawDisplay = Array.isArray(m.dependsOnDisplay) && m.dependsOnDisplay.length
    ? m.dependsOnDisplay
    : rawDeps;
  return {
    uid: generateNodeUid("m"),
    apiId: m.id || "",
    id: m.id || "",
    /* Server-assigned WBS code (e.g. "M1"). Preferred over the
       client-side fallback when present — used as `node.id` after
       normalizeProject runs. */
    serverDisplayCode: m.displayCode || "",
    name: m.name || "",
    description: m.description || "",
    startDate: toDateInputValue(m.startDate),
    endDate: toDateInputValue(m.endDate),
    status: mapStatusFromApi(m.status),
    vendor: vendors.length ? vendors[0].name || "" : "",
    dependsOn: rawDeps.slice(),
    /* Snapshot of server display IDs (e.g. "M1", "M2"). The loader keeps
       this stable while it translates `dependsOn` into local UIDs. */
    dependsOnDisplay: rawDisplay.slice(),
    /* Backend may return priority as plain code or {code,name} object —
       normalize to a code string. Same convention as activity/task/subtask. */
    priority:
      (m.priority && typeof m.priority === "object")
        ? (m.priority.code || m.priority.name || "")
        : (m.priority || m.priorityCode || ""),
    activities: [],
    comments: [],
    attachments: [],
    position: typeof m.position === "number" ? m.position : undefined
  };
}

/* Shared builder for activity/task/subtask node shape (they share the same
   API schema). kindLetter is the one-char prefix for generated uids, and
   childrenKey decides whether the node holds `tasks` or `subtasks`. */
function buildActivityLikeNode(a, kindLetter, childrenKey) {
  const apiType = String(a?.type || "").toLowerCase();
  let uiType = "Standard Type";
  let resourceEntryType = "details";

  if (apiType === "resource") {
    uiType = "Resource Type";
    resourceEntryType = a.resourceMode === "count" ? "count" : "details";
  } else if (apiType === "transactional") {
    uiType = "Transactional";
  }

  /* Server returns dependsOn as UUIDs and dependsOnDisplay as the
     human-readable WBS codes ("M1", "A1.2"). Legacy shapes used a
     single `depends` / `dependency` key; fall back to that if
     dependsOnDisplay is missing. */
  const rawDeps = Array.isArray(a.dependsOn)
    ? a.dependsOn
    : Array.isArray(a.depends)
    ? a.depends
    : Array.isArray(a.dependency)
    ? a.dependency
    : [];
  const rawDisplay = Array.isArray(a.dependsOnDisplay) && a.dependsOnDisplay.length
    ? a.dependsOnDisplay
    : rawDeps;

  const node = {
    uid: generateNodeUid(kindLetter),
    apiId: a.id || "",
    id: a.id || "",
    /* Server-assigned WBS code (e.g. "S1.1.1.1.1.1" for sub-tasks,
       "T1.1.1" for tasks). Preferred over client-side numbering when
       present — survives the project's normalize pass via normalizeProject. */
    serverDisplayCode: a.displayCode || "",
    apiType: apiType || "standard",
    apiResourceMode: a.resourceMode || null,
    name: a.name || "",
    description: a.description || "",
    startDate: toDateInputValue(a.startDate),
    endDate: toDateInputValue(a.endDate),
    actualStartDate: toDateInputValue(a.actualStartDate),
    actualEndDate: toDateInputValue(a.actualEndDate),
    status: mapStatusFromApi(a.status),
    type: uiType,
    resourceEntryType,
    dependsOn: rawDeps.slice(),
    dependsOnDisplay: rawDisplay.slice(),
    ownerDivision: a.ownerDivision || "",
    ownerDivisionOther: a.ownerDivisionOther || a.owner_division_other || "",
    vendorId: a.vendorId || "",
    /* Server returns priority either as a plain code string ("p2") or
       sometimes as a {code, name} object — normalize to a code string. */
    priority:
      (a.priority && typeof a.priority === "object")
        ? (a.priority.code || a.priority.name || "")
        : (a.priority || a.priorityCode || ""),
    /* Task/Subtask only — assigned user id. Activity has its own vendor
       and doesn't carry assignedTo. */
    assignedTo: a.assignedTo || a.assigneeId || "",
    concernedDivision: Array.isArray(a.concernedDivision)
      ? a.concernedDivision.slice()
      : (a.concernedDivision ? [a.concernedDivision] : []),
    concernedDivisionOther: a.concernedDivisionOther || a.concerned_division_other || "",
    comments: [],
    attachments: [],
    position: typeof a.position === "number" ? a.position : 0
  };
  node[childrenKey] = [];

  if (apiType === "resource" && a.resourceMode === "count") {
    node.resourceCount = {
      resType: a.typeOfResourceId || "",
      count: a.resourceCount || 1,
      onboardingDate: "",
      division: a.division || "",
      divisionOther: a.divisionOther || ""
    };
  }

  if (apiType === "resource" && a.resourceMode === "details" && a.resource) {
    const r = a.resource || {};
    node.resourceDetails = {
      resourceName: r.resourceName || "",
      resType: r.typeOfResourceId || "",
      division: r.division || "",
      divisionOther: r.divisionOther || "",
      onboardingDate: toDateInputValue(r.onboardDate),
      offboardingDate: toDateInputValue(r.offboardDate),
      actualOnboardingDate: toDateInputValue(r.actualOnboardDate),
      actualOffboardingDate: toDateInputValue(r.actualOffboardDate),
      position: r.position || "",
      designation: r.designation || "",
      jobRole: r.jobRole || "",
      qualification: r.qualification || "",
      experience: r.experienceYears != null ? String(r.experienceYears) : ""
    };
  }

  return node;
}

export function mapApiActivityToNode(a) {
  return buildActivityLikeNode(a, "a", "tasks");
}

export function mapApiTaskToNode(t) {
  return buildActivityLikeNode(t, "t", "subtasks");
}

export function mapApiSubtaskToNode(s) {
  // Subtasks can technically contain other subtasks in the local UI; keep an
  // empty `subtasks` array on each so the tree walkers don't crash. We also
  // stash the server's parent linkage (parentSubtaskId / taskId) on the node
  // so the loader can rebuild the nested tree from the flat list endpoint.
  const node = buildActivityLikeNode(s, "s", "subtasks");
  node.parentSubtaskApiId = s?.parentSubtaskId || null;
  node.taskApiId = s?.taskId || null;
  return node;
}

/* ─── Tree mappers — used by /api/v3/projects/{id}/tree ──────────────
   The tree endpoint returns one fully nested document with children
   embedded under `activities` / `tasks` / `subtasks` (subtasks recursively).
   These wrappers reuse the flat mappers above and just walk into each
   embedded child list. */
export function mapApiSubtaskTreeToNode(s) {
  const node = mapApiSubtaskToNode(s);
  if (Array.isArray(s?.subtasks) && s.subtasks.length > 0) {
    node.subtasks = s.subtasks.map(mapApiSubtaskTreeToNode);
  }
  return node;
}

export function mapApiTaskTreeToNode(t) {
  const node = mapApiTaskToNode(t);
  if (Array.isArray(t?.subtasks)) {
    node.subtasks = t.subtasks.map(mapApiSubtaskTreeToNode);
  }
  return node;
}

export function mapApiActivityTreeToNode(a) {
  const node = mapApiActivityToNode(a);
  if (Array.isArray(a?.tasks)) {
    node.tasks = a.tasks.map(mapApiTaskTreeToNode);
  }
  return node;
}

export function mapApiMilestoneTreeToNode(m) {
  const node = mapApiMilestoneToNode(m);
  if (Array.isArray(m?.activities)) {
    node.activities = m.activities.map(mapApiActivityTreeToNode);
  }
  return node;
}

/* ─── Extract { data: { _embedded: { elements: [...] } } } safely. */
export function extractListElements(raw) {
  const elements =
    raw?.data?._embedded?.elements ??
    raw?._embedded?.elements ??
    raw?.data ??
    [];
  return Array.isArray(elements) ? elements : [];
}

/* ─── Walk the project tree to find the task that directly or transitively
   contains the node with the given uid. Returns the task's apiId or null.
   Used when creating a subtask under another subtask: the API only
   accepts subtask creation under a task, so we must walk up. */
export function findEnclosingTaskApiId(project, targetUid) {
  if (!project || !targetUid) return null;

  function containsUid(node, uid) {
    if (!node) return false;
    if (node.uid === uid) return true;
    const kids = Array.isArray(node.subtasks) ? node.subtasks : [];
    for (const k of kids) if (containsUid(k, uid)) return true;
    return false;
  }

  const milestones = Array.isArray(project.milestones) ? project.milestones : [];
  for (const m of milestones) {
    const acts = Array.isArray(m.activities) ? m.activities : [];
    for (const a of acts) {
      const tasks = Array.isArray(a.tasks) ? a.tasks : [];
      for (const t of tasks) {
        if (t.uid === targetUid) return t.apiId || null;
        if (containsUid(t, targetUid)) return t.apiId || null;
      }
    }
  }
  return null;
}