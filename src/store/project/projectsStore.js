/* ═══════════════════════════════════════════════════════════════
   projectsStore.js
   A singleton data store that replaces the React Context Provider
   pattern. Components subscribe via useSyncExternalStore through a
   custom hook. No Provider is needed — the module itself holds state.
   ═══════════════════════════════════════════════════════════════ */

import { useSyncExternalStore } from "react";
import { deepClone } from "../../utils/project/nodeUtils";

/* ─────────────── Initial state (populated from API) ─────────────── */
let projects = [];

/* ─────────────── Pub/sub mechanism ─────────────── */
const listeners = new Set();

function emit() {
  listeners.forEach((fn) => fn());
}

function subscribe(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function getSnapshot() {
  return projects;
}

/* ─────────────── Public API ─────────────── */
export const projectsStore = {
  getAll: () => projects,
  find: (id) => projects.find((p) => p.projectId === id),

  addProject(project) {
    projects = [project, ...projects];
    emit();
  },

  removeProject(id) {
    projects = projects.filter((p) => p.projectId !== id);
    emit();
  },

  updateProject(id, updater) {
    const idx = projects.findIndex((p) => p.projectId === id);
    if (idx < 0) return;
    const copy = projects.slice();
    const updated = updater(deepClone(copy[idx])) || copy[idx];
    copy[idx] = updated;
    projects = copy;
    emit();
  },

  /* Replace the entire collection (used after in-place mutation cascades) */
  replaceAll(next) {
    projects = next;
    emit();
  },

  /* Force-refresh subscribers when an in-place mutation happened */
  refresh() {
    projects = projects.slice();
    emit();
  },

  /* Next-ID helpers */
  getNextProjectId() {
    const max = projects.reduce((acc, p) => {
      const m = String(p.projectId || "").match(/^PRJ(\d+)(?:-V\d+)?$/i);
      return m ? Math.max(acc, parseInt(m[1], 10)) : acc;
    }, 0);
    return `PRJ${String(max + 1).padStart(3, "0")}`;
  },

  subscribe
};

/* ─────────────── Hooks ─────────────── */
export function useProjects() {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

export function useProject(id) {
  useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  return projects.find((p) => p.projectId === id);
}
