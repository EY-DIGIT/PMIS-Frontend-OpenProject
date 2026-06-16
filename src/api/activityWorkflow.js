/* ═══════════════════════════════════════════════════════════════
   activityWorkflow.js — wraps the activity-workflow service.

   Endpoints covered (all live under {API_BASE}/activity-workflow/*):

     POST  /activities/process/_transition
     POST  /activities/parallel/request-division-approval  (multipart)
     POST  /activities/parallel/request-owner-approval     (multipart)
     POST  /activities/parallel/vote
     GET   /activities/inbox?userUuid=...
     GET   /activities/inbox/{activityId}?userUuid=...
     GET   /activities/audit/ACTIVITY/{activityId}
     GET   /activities/process/_search/ACTIVITY/{activityId}

   The transition payload uses `activityId` + `projectId` (not
   `businessId`) — see the curl shared on 2026-06-03. The parallel
   endpoints are the second leg: the SUBMIT transition moves the
   activity to PENDINGATCONCERNEDDIVISION, and the multipart
   request-division-approval call seeds approver rows that show up in
   each division reviewer's inbox.
   ═══════════════════════════════════════════════════════════════ */

import { API_BASE, tokenStore, ApiError } from "./client";
import { getToken } from "./auth";
import { readRoleFromUser } from "../auth/roleNormalize";
import { ENDPOINTS } from "./endpoint";

const MODULE_NAME = "activity-workflow";
const BUSINESS_SERVICE = "ACTIVITY";

/* Human-readable label for a role code, e.g. super_admin → "Super Admin". */
function roleLabel(code) {
  return String(code || "")
    .split(/[_\s-]+/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join(" ");
}

/* Pick the SINGLE current role of the logged-in user. Backend wants
   exactly one entry — the role they signed in with — not every elevation
   flag the user object happens to carry. Priority order:
     1. orgRole / org_role / role / roles fields via readRoleFromUser
        (tolerates string, array-of-strings, array-of-objects shapes).
     2. roleCode legacy string field.
     3. is_super_admin boolean → "super_admin".
     4. is_admin boolean → "admin".
   Returns a one-element array, or [] if nothing resolves. */
function deriveRoles(user) {
  const normalized = readRoleFromUser(user);
  if (normalized) return [{ code: normalized, name: roleLabel(normalized) }];
  const legacy = (typeof user.roleCode === "string" && user.roleCode) || "";
  if (legacy) return [{ code: legacy, name: roleLabel(legacy) }];
  if (user.is_super_admin || user.isSuperAdmin) {
    return [{ code: "super_admin", name: "Super Admin" }];
  }
  if (user.is_admin || user.isAdmin) {
    return [{ code: "admin", name: "Admin" }];
  }
  return [];
}

function pickUserUuid(user) {
  if (!user) return "";
  return (
    user.uuid ||
    user.id ||
    user.userId ||
    user.user_id ||
    ""
  );
}
function pickUserName(user) {
  if (!user) return "";
  return (
    user.userName ||
    user.user_name ||
    user.username ||
    user.login ||
    ""
  );
}
function pickDisplayName(user) {
  if (!user) return "";
  return (
    user.name ||
    user.full_name ||
    user.fullName ||
    user.displayName ||
    user.display_name ||
    ""
  );
}

/* Build the RequestInfo wrapper from the currently stored user + token.
   Returns the minimum shape the backend requires; any missing identity
   fields are filled with safe blanks so the call doesn't 400 on shape. */
function buildRequestInfo() {
  const user = tokenStore.getUser() || {};
  const token = getToken() || "";
  return {
    authToken: token,
    userInfo: {
      uuid: pickUserUuid(user),
      userName: pickUserName(user),
      name: pickDisplayName(user),
      type: user.type || "EMPLOYEE",
      roles: deriveRoles(user)
    }
  };
}

/* Resolve common HTTP plumbing into a single helper. Throws an ApiError
   on non-2xx with the backend's message when available. */
async function parseJsonOrThrow(res, fallbackLabel) {
  const text = await res.text();
  let payload = null;
  if (text) {
    try { payload = JSON.parse(text); } catch { payload = text; }
  }
  if (!res.ok) {
    const msg =
      (payload && typeof payload === "object" &&
        (payload.error?.message || payload.message || payload.errorMessage)) ||
      (typeof payload === "string" ? payload : "") ||
      `${fallbackLabel} failed (${res.status})`;
    throw new ApiError(msg, { status: res.status, body: payload });
  }
  return payload;
}

function authHeaders(extra = {}) {
  const token = getToken();
  const h = { Accept: "application/json", ...extra };
  if (token) h.Authorization = `Bearer ${token}`;
  return h;
}

/* ─────────────────────────────────────────────────────────────────
   Step 1 — POST /activities/process/_transition
   Fire a single workflow transition (SUBMIT / APPROVE / REJECT /
   UPDATE). Per the 2026-06-03 contract the ProcessInstance row uses
   `activityId` + `projectId` rather than the older `businessId`.
   For backward compatibility a caller that only passes `businessId`
   (legacy callers in NodeModal) still works — we treat it as
   activityId and skip the projectId field.
   ───────────────────────────────────────────────────────────────── */
export async function transitionActivity({
  activityId,
  projectId,
  businessId,
  action,
  comment
}) {
  const actId = activityId || businessId;
  if (!actId) throw new ApiError("Missing activity id for workflow transition.");
  if (!action) throw new ApiError("Missing workflow action.");

  const instance = {
    moduleName: MODULE_NAME,
    businessService: BUSINESS_SERVICE,
    activityId: actId,
    action,
    comment: comment || ""
  };
  if (projectId) instance.projectId = projectId;

  const body = {
    RequestInfo: buildRequestInfo(),
    ProcessInstances: [instance]
  };

  const res = await fetch(`${API_BASE}${ENDPOINTS.activityWorkflow.transition}`, {
    method: "POST",
    headers: authHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify(body),
    cache: "no-store"
  });
  return parseJsonOrThrow(res, "Workflow transition");
}

export const WORKFLOW_ACTIONS = {
  SUBMIT: "SUBMIT",
  APPROVE: "APPROVE",
  REJECT: "REJECT",
  RETURN_TO_VENDOR: "RETURN_TO_VENDOR",
  RETURN_TO_DIVISION: "RETURN_TO_DIVISION",
  UPDATE: "UPDATE"
};

export const WORKFLOW_STATES = {
  PENDING_AT_CONCERNED_DIVISION: "PENDINGATCONCERNEDDIVISION",
  PENDING_AT_OWNER_DIVISION: "PENDINGATOWNERDIVISION"
};

export const PARALLEL_VOTE = {
  APPROVED: "APPROVED",
  REJECTED: "REJECTED"
};

/* Normalise the attachment input into a flat list of raw File objects.
   Callers may pass `files` (array of File) and/or a single `file`; both
   are merged so the multipart body carries every attachment the user
   picked across all rows. */
function collectUploadFiles(files, file) {
  const out = [];
  if (Array.isArray(files)) {
    files.forEach((f) => { if (f) out.push(f); });
  }
  if (file) out.push(file);
  return out;
}

/* ─────────────────────────────────────────────────────────────────
   Step 2 — POST /activities/parallel/request-division-approval
   Multipart upload that seeds per-division approver rows after the
   SUBMIT transition. Attachments are optional (the backend accepts the
   form without any); every file the user picked across the popup rows
   is appended under the repeated `file` field.
   ───────────────────────────────────────────────────────────────── */
export async function requestDivisionApprovalParallel({
  activityId,
  projectId,
  stateName,
  comment,
  files,
  file
} = {}) {
  if (!activityId) throw new ApiError("Missing activity id for division approval request.");
  if (!projectId) throw new ApiError("Missing project id for division approval request.");

  const user = tokenStore.getUser() || {};
  const requestInfo = {
    userInfo: {
      uuid: pickUserUuid(user),
      userName: pickUserName(user),
      roles: deriveRoles(user)
    }
  };

  const fd = new FormData();
  fd.append("businessService", BUSINESS_SERVICE);
  fd.append("activityId", activityId);
  fd.append("projectId", projectId);
  fd.append("stateName", stateName || WORKFLOW_STATES.PENDING_AT_CONCERNED_DIVISION);
  fd.append("comment", comment || "");
  fd.append("requestInfo", JSON.stringify(requestInfo));
  collectUploadFiles(files, file).forEach((f) => fd.append("file", f));

  /* Multipart — DO NOT set Content-Type; the browser sets the
     boundary header automatically. */
  const res = await fetch(`${API_BASE}${ENDPOINTS.activityWorkflow.requestDivisionApproval}`, {
    method: "POST",
    headers: authHeaders(),
    body: fd,
    cache: "no-store"
  });
  return parseJsonOrThrow(res, "Request division approval");
}

/* ─────────────────────────────────────────────────────────────────
   Step 6 — POST /activities/parallel/request-owner-approval
   Multipart upload that hands the activity from the Concerned Division
   stage to the Activity Owner stage. Same payload shape as
   request-division-approval but with `stateName=PENDINGATOWNERDIVISION`.
   ───────────────────────────────────────────────────────────────── */
export async function requestOwnerApprovalParallel({
  activityId,
  projectId,
  stateName,
  comment,
  files,
  file
} = {}) {
  if (!activityId) throw new ApiError("Missing activity id for owner approval request.");
  if (!projectId) throw new ApiError("Missing project id for owner approval request.");

  const user = tokenStore.getUser() || {};
  const requestInfo = {
    userInfo: {
      uuid: pickUserUuid(user),
      userName: pickUserName(user),
      roles: deriveRoles(user)
    }
  };

  const fd = new FormData();
  fd.append("businessService", BUSINESS_SERVICE);
  fd.append("activityId", activityId);
  fd.append("projectId", projectId);
  fd.append("stateName", stateName || WORKFLOW_STATES.PENDING_AT_OWNER_DIVISION);
  fd.append("comment", comment || "");
  fd.append("requestInfo", JSON.stringify(requestInfo));
  collectUploadFiles(files, file).forEach((f) => fd.append("file", f));

  const res = await fetch(`${API_BASE}${ENDPOINTS.activityWorkflow.requestOwnerApproval}`, {
    method: "POST",
    headers: authHeaders(),
    body: fd,
    cache: "no-store"
  });
  return parseJsonOrThrow(res, "Request owner approval");
}

/* ─────────────────────────────────────────────────────────────────
   Step 3 — GET /activities/inbox?userUuid=...
   Pulls the queue of activities awaiting THIS user's vote. Falls
   back to [] on a malformed body so the list page can render empty.
   ───────────────────────────────────────────────────────────────── */
export async function getActivityWorkflowInbox(userUuid, stateName) {
  const uuid = userUuid || pickUserUuid(tokenStore.getUser() || {});
  if (!uuid) throw new ApiError("Missing userUuid for activity-workflow inbox.");

  let url = `${API_BASE}${ENDPOINTS.activityWorkflow.inbox}?userUuid=${encodeURIComponent(uuid)}`;
  if (stateName) url += `&stateName=${encodeURIComponent(stateName)}`;
  const res = await fetch(url, {
    method: "GET",
    headers: authHeaders(),
    cache: "no-store"
  });
  const payload = await parseJsonOrThrow(res, "Activity inbox fetch");
  if (Array.isArray(payload)) return payload;
  if (payload && Array.isArray(payload.items)) return payload.items;
  return [];
}

/* ─────────────────────────────────────────────────────────────────
   Step 4 — GET /activities/inbox/{activityId}?userUuid=...
   Hydrates the review page with submissions, status breakdown, etc.
   ───────────────────────────────────────────────────────────────── */
export async function getActivityWorkflowInboxDetail(activityId, userUuid, stateName) {
  if (!activityId) throw new ApiError("Missing activityId for inbox detail.");
  const uuid = userUuid || pickUserUuid(tokenStore.getUser() || {});
  if (!uuid) throw new ApiError("Missing userUuid for inbox detail.");

  let url = `${API_BASE}${ENDPOINTS.activityWorkflow.inboxDetail(activityId)}?userUuid=${encodeURIComponent(uuid)}`;
  if (stateName) url += `&stateName=${encodeURIComponent(stateName)}`;
  const res = await fetch(url, {
    method: "GET",
    headers: authHeaders(),
    cache: "no-store"
  });
  return parseJsonOrThrow(res, "Activity inbox detail fetch");
}

/* ─────────────────────────────────────────────────────────────────
   Step 5 — POST /activities/parallel/vote
   Approve / reject as a Concerned Division reviewer. `vote` is
   "APPROVED" or "REJECTED" per the backend contract.
   ───────────────────────────────────────────────────────────────── */
export async function voteOnActivityParallel({
  activityId,
  projectId,
  stateName,
  vote,
  comment
} = {}) {
  if (!activityId) throw new ApiError("Missing activity id for vote.");
  if (!projectId) throw new ApiError("Missing project id for vote.");
  if (!vote) throw new ApiError("Missing vote (APPROVED or REJECTED).");

  const user = tokenStore.getUser() || {};
  const body = {
    RequestInfo: {
      userInfo: {
        uuid: pickUserUuid(user),
        userName: pickUserName(user),
        name: pickDisplayName(user),
        roles: deriveRoles(user)
      }
    },
    businessService: BUSINESS_SERVICE,
    activityId,
    projectId,
    stateName: stateName || WORKFLOW_STATES.PENDING_AT_CONCERNED_DIVISION,
    vote,
    comment: comment || ""
  };

  const res = await fetch(`${API_BASE}${ENDPOINTS.activityWorkflow.parallelVote}`, {
    method: "POST",
    headers: authHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify(body),
    cache: "no-store"
  });
  return parseJsonOrThrow(res, "Activity vote");
}

/* GET the full audit / process-instance history for an activity:
     GET /activity-workflow/activities/process/_search/ACTIVITY/{activityId}
   Returns an array of ProcessInstance entries in the order the backend
   ships them (typically chronological). Falls back to [] on error so
   callers can simply render the result. */
export async function getProcessInstances(activityId) {
  if (!activityId) return [];
  const url = `${API_BASE}/activity-workflow/activities/process/_search/ACTIVITY/${encodeURIComponent(activityId)}`;
  const res = await fetch(url, {
    method: "GET",
    headers: authHeaders(),
    cache: "no-store"
  });
  const payload = await parseJsonOrThrow(res, "Workflow history fetch");
  return Array.isArray(payload && payload.ProcessInstances) ? payload.ProcessInstances : [];
}

/* GET the activity-workflow audit log used by the timeline:
     GET /activity-workflow/activities/audit/ACTIVITY/{activityId}
   Returns an array of audit entries with actionName, previousState,
   resultantState, outcome, performedByUsername, performedByRoles,
   comment, createdTime (epoch ms). Failed transitions are surfaced
   too (outcome=FAILED + errorMessage). Falls back to [] on error. */
export async function getActivityWorkflowAuditLogs(activityId) {
  if (!activityId) return [];
  const url = `${API_BASE}${ENDPOINTS.activityWorkflow.auditLogs(activityId)}`;
  const res = await fetch(url, {
    method: "GET",
    headers: authHeaders(),
    cache: "no-store"
  });
  const payload = await parseJsonOrThrow(res, "Workflow audit fetch");
  if (Array.isArray(payload)) return payload;
  if (payload && Array.isArray(payload.auditLogs)) return payload.auditLogs;
  return [];
}

/* GET the purpose-built activity timeline used by the audit-trail UI:
     GET /activity-workflow/activities/inbox/{activityId}/timeline
   Returns an ordered array of events shaped as
     { kind: "VOTE" | "STATE_TRANSITION", title, detail, timestamp (epoch ms),
       actorUuid, actorUsername, previousState, resultantState, actionName,
       activityId, projectId, businessService, eventId }
   Newest-first from the backend. Falls back to [] on error. */
export async function getActivityWorkflowTimeline(activityId) {
  if (!activityId) return [];
  const url = `${API_BASE}${ENDPOINTS.activityWorkflow.timeline(activityId)}`;
  try {
    const res = await fetch(url, {
      method: "GET",
      headers: authHeaders(),
      cache: "no-store"
    });
    const payload = await parseJsonOrThrow(res, "Activity timeline fetch");
    if (Array.isArray(payload)) return payload;
    if (payload && Array.isArray(payload.timeline)) return payload.timeline;
    return [];
  } catch {
    return [];
  }
}

/* GET the parallel gate status — the authoritative roll-up of the
   Concerned Division votes:
     GET /activity-workflow/activities/parallel/gate-status/ACTIVITY/{activityId}
   Returns the backend object as-is, e.g.
     { businessService, activityId, stateName, totalApprovers,
       approvedCount, pendingCount, rejectedCount, readyForOwner,
       hasRejection, divisions: [{ divisionCode, approverName,
       voteStatus, voteComment, votedAt, ... }] }
   `readyForOwner: true` means every Concerned Division approved and the
   activity is ready to be forwarded to the Activity Owner. Returns null
   on error so callers can simply fall back to audit-log derivation. */
export async function getParallelGateStatus(activityId) {
  if (!activityId) return null;
  const url = `${API_BASE}${ENDPOINTS.activityWorkflow.gateStatus(activityId)}`;
  try {
    const res = await fetch(url, {
      method: "GET",
      headers: authHeaders(),
      cache: "no-store"
    });
    const payload = await parseJsonOrThrow(res, "Gate status fetch");
    return payload && typeof payload === "object" ? payload : null;
  } catch {
    return null;
  }
}

/* Map a backend previousStatus string to one of our local approvalState
   codes. Used by the timeline + audit trail to render API-driven flow. */
export const STATUS_MAP = {
  READYFORAPPROVAL: "ready_for_approval",
  PENDINGATCONCERNEDDIVISION: "pending_division",
  PENDINGATOWNERDIVISION: "pending_owner",
  COMPLETED: "completed",
  REJECTED: "rejected_to_vendor",
  RETURNEDTOVENDOR: "rejected_to_vendor"
};
