/* ══════════════════════════════════════════════════════════════════
   src/api/sessions.js  —  SuperAdmin session management (#365)

   super_admin ONLY; every other role gets a 403 from all three routes.
   Revocation is an instant hard cut — the target's current access token
   is rejected immediately, not at the next refresh.

   ⚠ These live on the USER-MANAGEMENT service, so the payloads are
   snake_case (`session_id`, `issued_at`, …) — unlike the camelCase
   project-management responses everywhere else in this app. We keep the
   wire names on the way out of the API layer and normalize once, here,
   so the panel never has to guess.
   ══════════════════════════════════════════════════════════════════ */

import { api } from './client';
import { ENDPOINTS } from './endpoint';

function unwrap(res) {
  if (res && typeof res === 'object' && 'data' in res && res.data !== null && res.data !== undefined) {
    return res.data;
  }
  return res;
}

/* snake_case in → camelCase out. `sessionId` is the id the DELETE route
   expects, so it is the one field we must not lose. */
function fromApi(s) {
  if (!s || typeof s !== 'object') return null;
  const sessionId = s.session_id || s.sessionId || s.id || '';
  if (!sessionId) return null;
  return {
    sessionId,
    issuedAt: s.issued_at || s.issuedAt || '',
    lastUsedAt: s.last_used_at || s.lastUsedAt || '',
    expiresAt: s.expires_at || s.expiresAt || '',
  };
}

/* GET /users/{userId}/sessions
   → { user_id, sessions: [{ session_id, issued_at, last_used_at,
                             expires_at }] } */
export async function listSessions(userId) {
  if (!userId) return [];
  const data = unwrap(await api.get(ENDPOINTS.users.sessions(userId)));
  const rows = Array.isArray(data?.sessions)
    ? data.sessions
    : Array.isArray(data)
      ? data
      : [];
  return rows.map(fromApi).filter(Boolean);
}

/* POST /users/{userId}/sessions/revoke-all → { revoked: n } */
export async function revokeAllSessions(userId) {
  const data = unwrap(await api.post(ENDPOINTS.users.revokeAllSessions(userId), {}));
  return Number(data?.revoked) || 0;
}

/* DELETE /users/{userId}/sessions/{sessionId} → { revoked: 1 } */
export async function revokeSession(userId, sessionId) {
  const data = unwrap(await api.del(ENDPOINTS.users.session(userId, sessionId)));
  return Number(data?.revoked) || 0;
}
