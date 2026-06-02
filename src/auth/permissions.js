import { useSyncExternalStore } from 'react';
import rolesConfig from '../config/roles.json';
import { tokenStore } from '../api/client';

const listeners = new Set();

// Pick the highest-priority role name out of an array of candidates,
// using rolesConfig.hierarchy as the precedence order (strongest
// first). Falls back to the first present name when none of the
// candidates appear in the hierarchy, so we never silently drop a
// brand-new role just because the config wasn't updated.
function pickStrongest(names) {
  if (!names || !names.length) return null;
  for (const candidate of rolesConfig.hierarchy || []) {
    if (names.includes(candidate)) return candidate;
  }
  return names[0];
}

// Normalize whatever the backend put on a role field into a single
// string role name. Tolerates:
//   - plain string                   → "director_admin"
//   - array of strings               → ["director_admin", ...]
//   - array of objects (login API)   → [{ role_name: "director_admin", ... }]
//   - single object                  → { role_name: "director_admin", ... }
function normalizeRoleValue(raw) {
  if (!raw) return null;
  if (typeof raw === 'string') return raw;
  if (Array.isArray(raw)) {
    const names = raw
      .map((entry) => {
        if (!entry) return null;
        if (typeof entry === 'string') return entry;
        return entry.role_name || entry.roleName || entry.name || null;
      })
      .filter(Boolean);
    return pickStrongest(names);
  }
  if (typeof raw === 'object') {
    return raw.role_name || raw.roleName || raw.name || null;
  }
  return null;
}

// Read the active role from the user object the backend returned on
// login / verify-otp / refresh. Falls back to the configured default
// when nobody is logged in.
//
// The role lives on different keys depending on which endpoint produced
// the user object — login may emit `org_role` (snake_case) or `role`,
// while the users-list endpoint normalizes to `orgRole`. As of the
// new login response the role can also arrive as an *array* of role
// assignments (e.g. [{role_name: "director_admin", scope: "global"}]);
// normalizeRoleValue collapses all of these to a single string.
//
// Without this fallback, a director_admin logging in with the array
// shape was silently bucketed into `defaultRole` (super_admin) and
// saw the full sidebar instead of the dashboard-only chrome.
function readRoleFromStore() {
  const user = tokenStore.getUser();
  const role =
    normalizeRoleValue(user?.orgRole) ||
    normalizeRoleValue(user?.org_role) ||
    normalizeRoleValue(user?.role);
  if (role && rolesConfig.roles[role]) return role;
  return rolesConfig.defaultRole || 'project_member';
}

let currentRole = readRoleFromStore();

export function getCurrentRole() {
  return currentRole;
}

export function setCurrentRole(role) {
  const next =
    role && rolesConfig.roles[role]
      ? role
      : rolesConfig.defaultRole || 'project_member';
  if (currentRole === next) return;
  currentRole = next;
  listeners.forEach((cb) => cb());
}

// Re-read whichever role the user object in tokenStore currently exposes
// and broadcast the change. Wired up to the `pmis:user-changed` custom
// event below, so login / refresh / logout all flow through here without
// auth.js having to know about the permissions module.
export function syncRoleFromUser() {
  setCurrentRole(readRoleFromStore());
}

if (typeof window !== 'undefined') {
  window.addEventListener('pmis:user-changed', syncRoleFromUser);
  // Same-origin tabs sharing localStorage need the role to follow when
  // the user logs in/out in another tab.
  window.addEventListener('storage', (e) => {
    if (!e.key || /user|token/i.test(e.key)) syncRoleFromUser();
  });
}

export function getRoleMeta(role = currentRole) {
  return rolesConfig.roles[role] || null;
}

export function listRoles() {
  return rolesConfig.hierarchy
    .filter((r) => rolesConfig.roles[r])
    .map((r) => ({ key: r, label: rolesConfig.roles[r].label }));
}

export function getPermissions(role = currentRole) {
  return rolesConfig.roles[role]?.permissions || {};
}

export function can(action, role = currentRole) {
  const perms = getPermissions(role);
  return perms[action] === true;
}

function subscribe(cb) {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

function getSnapshot() {
  return currentRole;
}

export function useCurrentRole() {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

export function useCan(action) {
  const role = useCurrentRole();
  return can(action, role);
}

export function Can({ action, fallback = null, children }) {
  const allowed = useCan(action);
  if (!allowed) return fallback;
  return typeof children === 'function' ? children() : children;
}

if (typeof window !== 'undefined') {
  window.__pmisRole = {
    get: getCurrentRole,
    list: listRoles,
    can,
  };
}
