/* ══════════════════════════════════════════════════════════════════
   src/api/approvalInbox.js

   Thin wrapper around the approval-inbox endpoints (HAL-enveloped):
     GET  /api/v3/approval-inbox?role=...&status=...&search=...
     GET  /api/v3/approval-inbox/{businessId}
     POST /api/v3/approval-inbox/{businessId}/_transition
            body: { action, comment }

   The transition POST returns the refreshed InboxDetail in the same
   shape as the detail GET, so the caller can repaint without a
   follow-up fetch.
   ══════════════════════════════════════════════════════════════════ */

import { api } from "./client";
import { ENDPOINTS } from "./endpoint";

function unwrap(res) {
  if (res && typeof res === "object" && "data" in res && res.data !== null && res.data !== undefined) {
    return res.data;
  }
  return res;
}

export const INBOX_ROLES = {
  CONCERNED_DIVISION: "concerned_division",
  ACTIVITY_OWNER: "activity_owner",
  ADMIN: "admin"
};

export const INBOX_ACTIONS = {
  SUBMIT: "SUBMIT",
  APPROVE: "APPROVE",
  REJECT: "REJECT",
  UPDATE: "UPDATE"
};

/* GET the inbox list for a role. Returns the embedded element array
   (HAL collection) — never the envelope. Falls back to [] on a 4xx
   parse anomaly so the page never crashes on a malformed response. */
export async function listApprovalInbox({ role, status, search } = {}) {
  const query = {};
  if (role) query.role = role;
  if (status && status !== "all") query.status = status;
  if (search && String(search).trim()) query.search = String(search).trim();
  const res = await api.get(ENDPOINTS.approvalInbox.list, { query });
  const data = unwrap(res);
  const elements =
    (data && data._embedded && Array.isArray(data._embedded.elements) && data._embedded.elements) ||
    (Array.isArray(data && data.items) && data.items) ||
    (Array.isArray(data) && data) ||
    [];
  return elements;
}

/* GET the full review record for one item. */
export async function getApprovalInboxItem(businessId) {
  if (!businessId) throw new Error("Missing businessId");
  const res = await api.get(ENDPOINTS.approvalInbox.detail(businessId));
  return unwrap(res);
}

/* Fire a state transition. Returns the refreshed detail object. */
export async function transitionApprovalInbox(businessId, { action, comment } = {}) {
  if (!businessId) throw new Error("Missing businessId");
  if (!action) throw new Error("Missing action");
  const res = await api.post(ENDPOINTS.approvalInbox.transition(businessId), {
    action,
    comment: comment || ""
  });
  return unwrap(res);
}
