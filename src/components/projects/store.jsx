import { useReducer, useEffect } from 'react';
import { seedProjects, normalizeProject } from './utils';

/* ═══════════════════════════════════════════════════════════════
   Module-level store — NO Provider needed.
   Components get state via the useStore() hook.
   Components trigger actions by importing them directly.
   ═══════════════════════════════════════════════════════════════ */

const listeners = new Set();

let state = {
  projects: seedProjects(),
  onboardDraft: null,
  message: null,   /* { text, isError, onOk } | null */
  loader: null,    /* { text } | null */
};

function notify() {
  listeners.forEach((fn) => fn());
}

/* ─── Hook ─── */
export function useStore() {
  const [, forceUpdate] = useReducer((x) => x + 1, 0);
  useEffect(() => {
    listeners.add(forceUpdate);
    return () => listeners.delete(forceUpdate);
  }, []);
  return state;
}

/* ─── Direct state read (for actions that don't need re-rendering) ─── */
export const getState = () => state;

/* ─── Project actions ─── */
export function setProjects(next) {
  const nv = typeof next === 'function' ? next(state.projects) : next;
  state = { ...state, projects: nv };
  notify();
}

export function commitProjects() {
  state = { ...state, projects: [...state.projects] };
  notify();
}

export function findProject(id) {
  return state.projects.find((p) => p.projectId === id);
}

export function addProject(project) {
  normalizeProject(project);
  state = { ...state, projects: [project, ...state.projects] };
  notify();
}

export function removeProject(id) {
  state = { ...state, projects: state.projects.filter((p) => p.projectId !== id) };
  notify();
}

/* ─── Onboarding draft ─── */
export function setOnboardDraft(draft) {
  state = { ...state, onboardDraft: draft };
  notify();
}

/* ─── Message modal ─── */
export function showMessage(msg, onOk) {
  const clean = String(msg ?? '').trim().replace(/[.]+$/g, '');
  const errorPattern = /(not found|fill required fields|type the phrase above|invalid|warning|cannot|please specify|add at least one|please wait)/i;
  const isError = errorPattern.test(clean);
  state = { ...state, message: { text: clean, isError, onOk } };
  notify();
}

export function hideMessage() {
  const prev = state.message;
  state = { ...state, message: null };
  notify();
  if (prev && typeof prev.onOk === 'function') {
    setTimeout(prev.onOk, 0);
  }
}

/* ─── Loader modal ─── */
let loaderShownAt = 0;
let loaderHideTimer = null;

export function showLoader(text) {
  loaderShownAt = Date.now();
  if (loaderHideTimer) { clearTimeout(loaderHideTimer); loaderHideTimer = null; }
  state = { ...state, loader: { text: text || 'Loading' } };
  notify();
}

export function hideLoader() {
  const elapsed = Date.now() - loaderShownAt;
  const minVisible = 600;
  const finish = () => {
    state = { ...state, loader: null };
    notify();
  };
  if (elapsed < minVisible) {
    if (loaderHideTimer) clearTimeout(loaderHideTimer);
    loaderHideTimer = setTimeout(finish, minVisible - elapsed);
  } else {
    finish();
  }
}
