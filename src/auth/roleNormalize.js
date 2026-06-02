/* ══════════════════════════════════════════════════════════════════
   roleNormalize.js — single source of truth for collapsing the
   wildly varied role payloads the backend hands us into one string
   role name.

   The role field can arrive as:
     • plain string                "director_admin"
     • array of strings            ["director_admin", ...]
     • array of objects            [{ role_name, scope, role_id, ... }]
     • single object               { role_name, ... }

   The login response, the users-list response, the /me response and
   the introspect response all use slightly different shapes. Routing
   every read through this module keeps that fan-out from leaking into
   every consumer.

   Precedence rules when the value is an array of objects:
     1. Prefer scope === "global" — that's the user's identity role,
        not a per-project assignment.
     2. Among the remaining (or all if there are no globals), pick the
        strongest by rolesConfig.hierarchy (strongest first).
     3. If nothing matches the hierarchy, fall back to the first name
        present so we never silently lose a brand-new role just
        because the config hasn't been updated.
   ══════════════════════════════════════════════════════════════════ */

import rolesConfig from "../config/roles.json";

/* Pick the highest-priority role name out of an array of candidates,
   using rolesConfig.hierarchy (strongest first). */
export function pickStrongest(names) {
  if (!names || !names.length) return null;
  for (const candidate of rolesConfig.hierarchy || []) {
    if (names.includes(candidate)) return candidate;
  }
  return names[0];
}

function extractRoleName(entry) {
  if (!entry) return null;
  if (typeof entry === "string") return entry;
  return entry.role_name || entry.roleName || entry.name || null;
}

/* Collapse any of the shapes above into a single role-name string,
   or null if nothing usable was found. */
export function normalizeRoleValue(raw) {
  if (!raw) return null;
  if (typeof raw === "string") return raw;
  if (Array.isArray(raw)) {
    if (!raw.length) return null;
    /* Prefer global-scope entries — they describe the user's primary
       identity. When the array carries only objects we can read
       `scope`; for arrays of plain strings we just pick the strongest. */
    const globalNames = raw
      .filter((e) => e && typeof e === "object" && (!e.scope || e.scope === "global"))
      .map(extractRoleName)
      .filter(Boolean);
    if (globalNames.length) return pickStrongest(globalNames);
    const allNames = raw.map(extractRoleName).filter(Boolean);
    return pickStrongest(allNames);
  }
  if (typeof raw === "object") {
    return extractRoleName(raw);
  }
  return null;
}

/* Convenience: pull a normalized role name out of an entire user
   object, checking every key the backend has been known to use. */
export function readRoleFromUser(user) {
  if (!user) return null;
  return (
    normalizeRoleValue(user.orgRole) ||
    normalizeRoleValue(user.org_role) ||
    normalizeRoleValue(user.role) ||
    normalizeRoleValue(user.roles) ||
    null
  );
}
