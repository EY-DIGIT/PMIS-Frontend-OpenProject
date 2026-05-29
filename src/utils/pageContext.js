/* ══════════════════════════════════════════════════════════════════
   pageContext.js — module-level singleton that lets a page publish
   tiny pieces of "where I am" info (e.g. projectCode, projectName)
   so the global header / breadcrumb can render them without prop
   drilling or wrapping every route in a Provider.

   Subscribe via usePageContext() in any component; the page sets
   values with setPageContext({ ... }) on mount and clears them on
   unmount so other routes don't inherit stale data.
   ══════════════════════════════════════════════════════════════════ */

import { useEffect, useState } from "react";

let state = {
  projectId: "",
  projectCode: "",
  projectName: ""
};
const listeners = new Set();

export function getPageContext() {
  return state;
}

export function setPageContext(patch) {
  state = { ...state, ...(patch || {}) };
  listeners.forEach((fn) => {
    try { fn(); } catch { /* ignore */ }
  });
}

export function clearPageContext() {
  state = { projectId: "", projectCode: "", projectName: "" };
  listeners.forEach((fn) => {
    try { fn(); } catch { /* ignore */ }
  });
}

export function usePageContext() {
  const [snap, setSnap] = useState(state);
  useEffect(() => {
    const fn = () => setSnap(state);
    listeners.add(fn);
    fn();
    return () => listeners.delete(fn);
  }, []);
  return snap;
}
