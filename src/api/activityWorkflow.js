/* ═══════════════════════════════════════════════════════════════
   activityWorkflow.js — wraps the activity-workflow service's
   single-transition endpoint:

     POST {API_BASE}/activity-workflow/activities/process/_transition

   The endpoint takes a payload of the shape:
     {
       RequestInfo: { authToken, userInfo: { uuid, userName, name, type, roles[] } },
       ProcessInstances: [{ moduleName, businessService, businessId, action, comment }]
     }

   Supported actions: SUBMIT | APPROVE | REJECT | UPDATE.
     SUBMIT  — first time the activity is sent for approval (Start Activity)
     APPROVE — Concerned Division or Owner Division approves
     REJECT  — any reviewer rejects (rejection reason goes in `comment`)
     UPDATE  — Project Admin resubmits after a rejection
   ═══════════════════════════════════════════════════════════════ */

import { API_BASE, tokenStore, ApiError } from "./client";
import { getToken } from "./auth";

const PATH = "/activity-workflow/activities/process/_transition";

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
     1. First entry of `user.roles` (array, if login supplied one)
     2. user.role / org_role / orgRole / roleCode string field
     3. is_super_admin boolean → "super_admin"
     4. is_admin boolean → "admin"
   Returns a one-element array, or [] if nothing resolves. */
function deriveRoles(user) {
  if (Array.isArray(user.roles) && user.roles.length > 0) {
    const r = user.roles[0];
    if (typeof r === "string") {
      return [{ code: r, name: roleLabel(r) }];
    }
    if (r && typeof r === "object") {
      const code = r.code || r.roleCode || r.role || "";
      if (code) return [{ code, name: r.name || r.roleName || roleLabel(code) }];
    }
  }
  const single =
    (typeof user.role === "string" && user.role) ||
    user.org_role ||
    user.orgRole ||
    user.roleCode ||
    "";
  if (single) return [{ code: single, name: roleLabel(single) }];
  if (user.is_super_admin || user.isSuperAdmin) {
    return [{ code: "super_admin", name: "Super Admin" }];
  }
  if (user.is_admin || user.isAdmin) {
    return [{ code: "admin", name: "Admin" }];
  }
  return [];
}

/* Build the RequestInfo wrapper from the currently stored user + token.
   Returns the minimum shape the backend requires; any missing identity
   fields are filled with safe blanks so the call doesn't 400 on shape. */
function buildRequestInfo() {
  const user = tokenStore.getUser() || {};
  const token = getToken() || "";
  const roles = deriveRoles(user);
  return {
    authToken: token,
    userInfo: {
      uuid:
        user.uuid ||
        user.id ||
        user.userId ||
        user.user_id ||
        "",
      userName:
        user.userName ||
        user.user_name ||
        user.username ||
        user.login ||
        "",
      name:
        user.name ||
        user.full_name ||
        user.fullName ||
        user.displayName ||
        user.display_name ||
        "",
      type: user.type || "EMPLOYEE",
      roles
    }
  };
}

/* Fire a single workflow transition. Throws ApiError on non-2xx. */
export async function transitionActivity({ businessId, action, comment }) {
  if (!businessId) throw new ApiError("Missing activity id for workflow transition.");
  if (!action) throw new ApiError("Missing workflow action.");

  const body = {
    RequestInfo: buildRequestInfo(),
    ProcessInstances: [
      {
        moduleName: MODULE_NAME,
        businessService: BUSINESS_SERVICE,
        businessId,
        action,
        comment: comment || ""
      }
    ]
  };

  const token = getToken();
  const headers = {
    "Content-Type": "application/json",
    Accept: "application/json"
  };
  if (token) headers.Authorization = `Bearer ${token}`;

  const res = await fetch(`${API_BASE}${PATH}`, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
    cache: "no-store"
  });

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
      `Workflow transition failed (${res.status})`;
    throw new ApiError(msg, { status: res.status, body: payload });
  }
  return payload;
}

export const WORKFLOW_ACTIONS = {
  SUBMIT: "SUBMIT",
  APPROVE: "APPROVE",
  REJECT: "REJECT",
  UPDATE: "UPDATE"
};

/* GET the full audit / process-instance history for an activity:
     GET /activity-workflow/activities/process/_search/ACTIVITY/{businessId}
   Returns an array of ProcessInstance entries in the order the backend
   ships them (typically chronological). Falls back to [] on error so
   callers can simply render the result. */
export async function getProcessInstances(businessId) {
  if (!businessId) return [];
  const token = getToken();
  const headers = { Accept: "application/json" };
  if (token) headers.Authorization = `Bearer ${token}`;
  const url = `${API_BASE}/activity-workflow/activities/process/_search/ACTIVITY/${encodeURIComponent(
    businessId
  )}`;
  const res = await fetch(url, { method: "GET", headers, cache: "no-store" });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    let payload = null;
    if (text) {
      try { payload = JSON.parse(text); } catch { payload = text; }
    }
    const msg =
      (payload && typeof payload === "object" &&
        (payload.error?.message || payload.message || payload.errorMessage)) ||
      (typeof payload === "string" ? payload : "") ||
      `Workflow history fetch failed (${res.status})`;
    throw new ApiError(msg, { status: res.status, body: payload });
  }
  const body = await res.json().catch(() => null);
  return Array.isArray(body && body.ProcessInstances) ? body.ProcessInstances : [];
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
