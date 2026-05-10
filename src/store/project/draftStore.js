/* ═══════════════════════════════════════════════════════════════
   draftStore.js — in-memory draft for new project onboarding.
   The user fills step 1 (AddProjectPage), then navigates to
   step 2 (MilestoneConfigPage in draft mode). Both pages read /
   write this module singleton — no Provider needed.
   ═══════════════════════════════════════════════════════════════ */

import { useSyncExternalStore } from "react";

let draft = null;
const listeners = new Set();

function emit() {
  listeners.forEach((fn) => fn());
}
function subscribe(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
function getSnapshot() {
  return draft;
}

export const draftStore = {
  get() {
    return draft;
  },
  set(next) {
    draft = next;
    emit();
  },
  clear() {
    draft = null;
    emit();
  },
  refresh() {
    /* Shallow-copy to force re-render when the same object was mutated in place */
    if (draft) draft = { ...draft, __tick: Math.random() };
    emit();
  },
  subscribe
};

/* Drop any in-progress onboarding draft on login/logout — a draft
   started by User A must not be visible to User B in the same tab. */
if (typeof window !== 'undefined') {
  window.addEventListener('pmis:session-reset', () => {
    draft = null;
    emit();
  });
}

export function useDraft() {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}
