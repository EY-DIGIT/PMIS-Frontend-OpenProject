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

   The :8017 service is hit DIRECTLY (not via the gateway) and accepts
   ONLY Content-Type. We therefore use a plain `fetch` instead of the
   shared `api` client — the shared client force-adds Authorization /
   Cache-Control / Pragma, which the service's CORS preflight rejects,
   failing the request before any response is returned.
   ══════════════════════════════════════════════════════════════════ */

import { tokenStore, API_BASE, ApiError } from './client';
import { ENDPOINTS } from './endpoint';
import { readAllRoleNames, readRoleFromUser } from '../auth/roleNormalize';

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
function buildRequestInfo() {
  const user = tokenStore.getUser() || {};
  const names = readAllRoleNames(user);
  const primary = readRoleFromUser(user);
  const codes = names.length ? names : primary ? [primary] : [];
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
   ticket fields. Sends ONLY Content-Type (matches the backend Postman)
   so the CORS preflight isn't tripped by extra headers. */
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
