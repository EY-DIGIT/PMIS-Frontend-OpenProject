/* ══════════════════════════════════════════════════════════════════
   tickets.js — Ticket & SLA Management service wrapper.

   Reference contract (backend Postman collection):
     POST http://<host>:8017/ticket-service/tickets
       Header: Content-Type: application/json   ← the ONLY header
       {
         requestInfo: { userInfo: { uuid, userName, email,
                                    roles: [{ code }] } },
         ticket: { category, subCategory, priority, title, description,
                   projectId, projectName, activityId, activityName,
                   taskId, taskName, parentTicketUuid, assigneeUuid,
                   assigneeName, assigneeEmail, baselineRef, contractRef }
       }

   The :8017 service is hit DIRECTLY (not via the gateway) and its CORS
   policy allows ONLY Content-Type. We MUST use a plain `fetch` here, not
   the shared `api` client: the shared client force-adds Authorization /
   Cache-Control / Pragma, and the browser's CORS preflight is then
   rejected by the service — the call fails before any response arrives.
   (Postman has no CORS, so it succeeds there regardless — don't be fooled
   by that into re-adding the extra headers.)
   ══════════════════════════════════════════════════════════════════ */

import { tokenStore, API_BASE, ApiError } from './client';
import { ENDPOINTS } from './endpoint';
import { readAllRoleNames, readRoleFromUser } from '../auth/roleNormalize';

function authHeaders() {
  const token = tokenStore.get();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

/* Absolute base for the ticket-service. Prefer an explicit override; else
   take the host of API_BASE and force port 8017. */
const TICKET_BASE = (() => {
  const override = import.meta.env.VITE_TICKET_API_BASE_URL;
  if (override) return String(override).replace(/\/+$/, '');
  try {
    const u = new URL(API_BASE);
    u.port = '8017';
    return u.origin;
  } catch {
    return 'http://10.1.131.199:8017';
  }
})();

/* Build the RequestInfo wrapper from the currently stored user. The
   ticket service wants roles as a list of `{ code }` objects, so we pull
   every role name off the user and fall back to the single primary role
   when none are present. Missing identity fields default to "" so the
   call doesn't 400 on shape. */
function buildRequestInfo(roleOverride) {
  const user = tokenStore.getUser() || {};
  const names = readAllRoleNames(user);
  const primary = readRoleFromUser(user);
  // A workflow transition must act AS the role the action requires
  // (PMIS_ADMIN / PMIS_SUPPORT), so callers can override the stored user's
  // roles for that call.
  const codes = roleOverride
    ? [roleOverride]
    : names.length ? names : primary ? [primary] : [];
  return {
    userInfo: {
      uuid: user.uuid || user.id || user.userId || user.user_id || '',
      userName:
        user.userName || user.user_name || user.username || user.login || '',
      email: user.email || '',
      roles: codes.map((code) => ({ code })),
    },
  };
}

/* POST /ticket-service/tickets — `ticket` is the ticket body; the
   requestInfo wrapper is attached here so callers only deal with the
   ticket fields. Sends ONLY Content-Type (matches the backend Postman) so
   the browser's CORS preflight isn't rejected by extra headers. */
export async function createTicket(ticket) {
  const url = TICKET_BASE + ENDPOINTS.tickets.create;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ requestInfo: buildRequestInfo(), ticket }),
  });

  const text = await res.text();
  let payload = null;
  if (text) {
    try { payload = JSON.parse(text); } catch { payload = text; }
  }

  if (!res.ok) {
    const msg =
      (payload && typeof payload === 'object' &&
        (payload.error?.message || payload.message || payload.errorMessage)) ||
      (typeof payload === 'string' && payload) ||
      `Create ticket failed (${res.status})`;
    throw new ApiError(msg, { status: res.status, body: payload });
  }
  return payload;
}

/* Pull a human-readable message out of whatever error shape the
   ticket-service returns — a bare string, { error }, { message },
   { errorMessage }, { detail }, or an errors[] / Errors[] array (as with
   the "enter reason for send back" validation). */
function extractErrorMessage(payload, fallback) {
  if (!payload) return fallback;
  if (typeof payload === 'string') return payload || fallback;
  const err = payload.error;
  const fromArray = (arr) =>
    Array.isArray(arr)
      ? arr.map((x) => (typeof x === 'string' ? x : x?.message || x?.msg || x?.code)).filter(Boolean).join('; ')
      : '';
  const msg =
    (err && typeof err === 'object' && (err.message || err.msg)) ||
    (typeof err === 'string' && err) ||
    payload.message ||
    payload.errorMessage ||
    payload.detail ||
    fromArray(payload.errors) ||
    fromArray(payload.Errors);
  return (typeof msg === 'string' && msg) || fallback;
}

/* Parse a ticket-service response, throwing an ApiError with the backend
   message on a non-2xx. Shared by the GET/PATCH helpers below. */
async function parseTicketResponse(res, fallbackLabel) {
  const text = await res.text();
  let payload = null;
  if (text) {
    try { payload = JSON.parse(text); } catch { payload = text; }
  }
  if (!res.ok) {
    const msg = extractErrorMessage(payload, `${fallbackLabel} (${res.status})`);
    throw new ApiError(msg, { status: res.status, body: payload });
  }
  return payload;
}

/* GET /ticket-service/tickets?page=&size= — paged ticket list. Plain
   `fetch` (no Authorization / Cache-Control) so the GET stays a "simple"
   cross-origin request and isn't blocked by the service's CORS policy.
   Returns { totalCount, page, size, totalPages, tickets: [...] }. */
export async function listTickets({ page = 0, size = 20 } = {}) {
  const url = `${TICKET_BASE}${ENDPOINTS.tickets.list}?page=${page}&size=${size}`;
  const headers = { Accept: '*/*', ...authHeaders() };
  try {
    const token = headers.Authorization ? headers.Authorization.replace(/^Bearer\s+/, '') : null;
    // Mask token in logs (show only last 6 chars) to help debugging without leaking token.
    // eslint-disable-next-line no-console
    console.debug('[tickets] listTickets - attaching Authorization?', !!token, token ? `****${token.slice(-6)}` : 'no-token');
  } catch (e) { /* ignore logging errors */ }
  const res = await fetch(url, { method: 'GET', headers });
  return parseTicketResponse(res, 'Load tickets failed');
}

/* GET /ticket-service/tickets/{uuid} — a single ticket's full record. */
export async function getTicket(uuid) {
  const url = `${TICKET_BASE}${ENDPOINTS.tickets.get(uuid)}`;
  const res = await fetch(url, { method: 'GET', headers: { Accept: '*/*', ...authHeaders() } });
  return parseTicketResponse(res, 'Load ticket failed');
}

/* GET /ticket-service/workflow — the workflow definition:
   { businessService, states: [{ state, actions: [{ action, nextState,
     roles }], startState, terminateState }] }. */
export async function getWorkflow() {
  const url = `${TICKET_BASE}${ENDPOINTS.tickets.workflow}`;
  const res = await fetch(url, { method: 'GET', headers: { Accept: '*/*' ,...authHeaders() } });
  return parseTicketResponse(res, 'Load workflow failed');
}

/* GET /ticket-service/escalation/tickets/{uuid}/logs — escalation history
   for a ticket (may be empty). */
export async function getEscalationLogs(uuid) {
  const url = `${TICKET_BASE}${ENDPOINTS.tickets.escalationLogs(uuid)}`;
  const res = await fetch(url, { method: 'GET', headers: { Accept: '*/*', ...authHeaders() } });
  return parseTicketResponse(res, 'Load escalation logs failed');
}

/* GET /ticket-service/escalation/matrix — all matrix rows
   ({ uuid, priority, level, triggerHours, emails, isActive, updatedAt }). */
export async function getEscalationMatrix() {
  const url = `${TICKET_BASE}${ENDPOINTS.tickets.escalationMatrix}`;
  const res = await fetch(url, { method: 'GET', headers: { Accept: '*/*', ...authHeaders() } });
  return parseTicketResponse(res, 'Load escalation matrix failed');
}

/* PATCH /ticket-service/escalation/matrix/{uuid} — edit one row. Body is a
   bare { triggerHours, emails, isActive } (no requestInfo wrapper, per the
   backend curl). Returns the updated row. */
export async function updateEscalationMatrix(uuid, { triggerHours, emails, isActive } = {}) {
  const url = `${TICKET_BASE}${ENDPOINTS.tickets.escalationMatrixItem(uuid)}`;
  const res = await fetch(url, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ triggerHours, emails, isActive }),
  });
  return parseTicketResponse(res, 'Update escalation matrix failed');
}

/* PATCH /ticket-service/tickets/{uuid} — run a WORKFLOW ACTION on a ticket.
   Per the backend Postman: the body carries `ticket.action` (the workflow
   action code — ASSIGN / START_PROGRESS / RESOLVE / CLOSE / …), an optional
   comment, and (for ASSIGN / REASSIGN) the assignee fields. The acting
   role goes in requestInfo (PMIS_ADMIN / PMIS_SUPPORT). Only Content-Type
   is sent so the CORS preflight isn't tripped (same as createTicket).

     { requestInfo: { userInfo: { …, roles:[{code: role}] } },
       ticket: { action, comment, assigneeUuid, assigneeName, assigneeEmail } } */
export async function transitionTicket(uuid, { action, role, comment, assignee } = {}) {
  const ticket = { action };
  if (comment) ticket.comment = comment;
  if (assignee) {
    ticket.assigneeUuid = assignee.uuid || '';
    ticket.assigneeName = assignee.name || '';
    ticket.assigneeEmail = assignee.email || '';
  }
  const url = `${TICKET_BASE}${ENDPOINTS.tickets.update(uuid)}`;
  const res = await fetch(url, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ requestInfo: buildRequestInfo(role), ticket }),
  });
  return parseTicketResponse(res, 'Update ticket failed');
}
