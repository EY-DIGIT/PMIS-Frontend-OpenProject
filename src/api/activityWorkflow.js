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

/* Build the RequestInfo wrapper from the currently stored user + token.
   Returns the minimum shape the backend requires; any missing identity
   fields are filled with safe blanks so the call doesn't 400 on shape. */
function buildRequestInfo() {
  const user = tokenStore.getUser() || {};
  const token = getToken() || "";
  const roles = Array.isArray(user.roles)
    ? user.roles.map((r) => {
        if (!r) return null;
        if (typeof r === "string") return { code: r, name: r };
        const code = r.code || r.roleCode || r.role || "";
        return { code, name: r.name || r.roleName || code };
      }).filter((r) => r && r.code)
    : [];
  return {
    authToken: token,
    userInfo: {
      uuid: user.uuid || user.id || user.userId || "",
      userName: user.userName || user.username || user.login || "",
      name: user.name || user.fullName || user.displayName || "",
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
