import { useSyncExternalStore } from 'react';
import rolesConfig from '../config/roles.json';
import { tokenStore } from '../api/client';
import { readRoleFromUser } from './roleNormalize';

const listeners = new Set();

// Read the active role from the user object the backend returned on
// login / verify-otp / refresh. Falls back to the configured default
// when nobody is logged in.
//
// All shape tolerance (array of role-assignment objects, plain string,
// scope precedence, etc.) lives in readRoleFromUser → see
// src/auth/roleNormalize.js for the rules.
function readRoleFromStore() {
  const user = tokenStore.getUser();
  const role = readRoleFromUser(user);
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
