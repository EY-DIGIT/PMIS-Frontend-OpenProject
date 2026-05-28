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

/* Coalesce whatever the login response stored on the user into the
   `[{code, name}]` array the workflow service expects. Tries several
   shapes in order:
     1. user.roles (already an array — clean it up)
     2. is_super_admin / is_admin booleans (per /api/v3/users response)
     3. org_role / orgRole single-role string
     4. role / roleCode single-role string
   Returns at least one entry whenever any of those resolve to a code. */
function deriveRoles(user) {
  const seen = new Set();
  const out = [];
  function push(code, name) {
    const c = String(code || "").trim();
    if (!c) return;
    if (seen.has(c)) return;
    seen.add(c);
    out.push({ code: c, name: String(name || roleLabel(c)) });
  }
  if (Array.isArray(user.roles)) {
    user.roles.forEach((r) => {
      if (!r) return;
      if (typeof r === "string") return push(r);
      push(r.code || r.roleCode || r.role || "", r.name || r.roleName);
    });
  }
  // Boolean elevation flags shipped by /api/v3/users — recognise them
  // even if `roles` wasn't supplied separately.
  if (user.is_super_admin || user.isSuperAdmin) push("super_admin", "Super Admin");
  if (user.is_admin || user.isAdmin) push("admin", "Admin");
  // Single-role string fields (org_role, orgRole, role, roleCode)
  const single =
    user.org_role || user.orgRole ||
    (typeof user.role === "string" ? user.role : "") ||
    user.roleCode || "";
  if (single) push(single);
  return out;
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
