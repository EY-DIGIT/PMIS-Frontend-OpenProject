/* ══════════════════════════════════════════════════════════════════
   src/api/documentAccess.js  —  role-based document access (#323)

   Documents are PUBLIC by default. Superadmin/admin can restrict one
   to specific role(s) at an optional org/division scope. The moment a
   document has ANY rule it becomes a whitelist: only superadmin/admin,
   the uploader and holders of a granted role can see or download it —
   for everyone else the document simply disappears from every list
   (server-side filtering, no "locked" state to render).

   Responses are camelCase (project-management service) and arrive in
   the usual `{ data, message, error, status }` envelope, which we
   unwrap here so callers work with the payload directly.
   ══════════════════════════════════════════════════════════════════ */

import { api } from './client';
import { ENDPOINTS } from './endpoint';

/* The five attachment owners the access API understands. Anything not
   in this list is rejected by the backend, so the picker is built from
   it rather than from free text. */
export const TARGET_KINDS = [
  { value: 'project', label: 'Project' },
  { value: 'milestone', label: 'Milestone' },
  { value: 'activity', label: 'Activity' },
  { value: 'task', label: 'Task' },
  { value: 'subtask', label: 'Subtask' },
];

function unwrap(res) {
  if (res && typeof res === 'object' && 'data' in res && res.data !== null && res.data !== undefined) {
    return res.data;
  }
  return res;
}

/* The list shape isn't pinned across deployments — accept a bare array
   or any of the usual collection wrappers, and always resolve to an
   array so the table can render without shape checks. */
function asList(data) {
  if (Array.isArray(data)) return data;
  if (Array.isArray(data?.documents)) return data.documents;
  if (Array.isArray(data?.items)) return data.items;
  if (Array.isArray(data?.elements)) return data.elements;
  if (Array.isArray(data?._embedded?.elements)) return data._embedded.elements;
  return [];
}

/* A rule is { roleName, organizationId, division }. organizationId and
   division are optional scope narrowers — omit them (rather than send
   null) so the backend treats the rule as unscoped. */
function cleanRule(rule) {
  if (!rule || !rule.roleName) return null;
  const out = { roleName: String(rule.roleName) };
  if (rule.organizationId) out.organizationId = rule.organizationId;
  if (rule.division) out.division = rule.division;
  return out;
}

export function normalizeRules(rules) {
  return (Array.isArray(rules) ? rules : []).map(cleanRule).filter(Boolean);
}

/* GET /documents/access?targetKind=&targetId=
   → the target's documents, newest first. Each row carries
     { commentId, filename, url, createdAt, uploadedBy, isRestricted,
       rules: [{ roleName, organizationId, division }] } */
export async function listDocumentsForTarget(targetKind, targetId) {
  if (!targetKind || !targetId) return [];
  const res = await api.get(ENDPOINTS.documents.access, {
    query: { targetKind, targetId },
  });
  return asList(unwrap(res));
}

/* GET /documents/{commentId}/access — one document's current rules. */
export async function getDocumentAccess(commentId) {
  const res = await api.get(ENDPOINTS.documents.documentAccess(commentId));
  const data = unwrap(res);
  return {
    ...(data && typeof data === 'object' ? data : {}),
    rules: normalizeRules(data?.rules),
  };
}

/* PUT /documents/{commentId}/access — replace the document's rule set.
   Passing an EMPTY array makes the document public again. */
export async function setDocumentAccess(commentId, rules) {
  const res = await api.put(ENDPOINTS.documents.documentAccess(commentId), {
    rules: normalizeRules(rules),
  });
  return unwrap(res);
}
