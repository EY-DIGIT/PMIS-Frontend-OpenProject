/* ═══════════════════════════════════════════════════════════════
   uiStore.js — singleton store for global UI state (message modal,
   loader modal). Works identically to projectsStore: subscribe-based,
   no React Context Provider needed.
   ═══════════════════════════════════════════════════════════════ */

import { useSyncExternalStore } from "react";

let state = {
  messageOpen: false,
  messageText: "",
  messageIsError: false,
  messageOnOk: null,

  loaderOpen: false,
  loaderText: "",
  loaderShownAt: 0,
  loaderHideTimer: null
};

const listeners = new Set();

function emit() {
  listeners.forEach((fn) => fn());
}

function subscribe(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function getSnapshot() {
  return state;
}

function setState(patch) {
  state = { ...state, ...patch };
  emit();
}

export const uiStore = {
  showMessage(msg, onOk) {
    const clean = String(msg ?? "")
      .trim()
      .replace(/[.]+$/g, "");
    /* Anything that LOOKS like an error → render with the danger icon /
       title. Covers required-field prompts, date-range bounds, parent-not-
       found, session-expired, server failures, and similar phrasings. */
    const errorPattern = new RegExp(
      [
        "not found",
        "fill required fields",
        "type the phrase above",
        "invalid",
        "warning",
        "cannot",
        "must be",
        "must contain",
        "should be",
        "is required",
        "are required",
        "please specify",
        "please select",
        "please sign in",
        "please assign",
        "please provide",
        "session expired",
        "add at least one",
        "at least one",
        "please wait",
        "failed",
        "no permissions",
        "unknown",
        "before saving"
      ].join("|"),
      "i"
    );
    const isError = errorPattern.test(clean);
    setState({
      messageOpen: true,
      messageText: clean,
      messageIsError: isError,
      messageOnOk: onOk || null
    });
  },

  showError(msg, onOk) {
    const clean = String(msg ?? "").trim().replace(/[.]+$/g, "");
    setState({
      messageOpen: true,
      messageText: clean,
      messageIsError: true,
      messageOnOk: onOk || null
    });
  },

  closeMessage() {
    const onOk = state.messageOnOk;
    setState({ messageOpen: false, messageText: "", messageOnOk: null });
    if (typeof onOk === "function") setTimeout(onOk, 0);
  },

  showLoader(text) {
    if (state.loaderHideTimer) {
      clearTimeout(state.loaderHideTimer);
      state.loaderHideTimer = null;
    }
    setState({
      loaderOpen: true,
      loaderText: text || "Loading",
      loaderShownAt: Date.now(),
      loaderHideTimer: null
    });
  },

  hideLoader() {
    const elapsed = Date.now() - state.loaderShownAt;
    const minVisible = 600;
    const finish = () => {
      setState({ loaderOpen: false });
    };
    if (elapsed < minVisible) {
      if (state.loaderHideTimer) clearTimeout(state.loaderHideTimer);
      const timer = setTimeout(finish, minVisible - elapsed);
      setState({ loaderHideTimer: timer });
      return;
    }
    finish();
  },

  subscribe
};

/* Close any open modal / hide any active loader on login/logout so
   User B doesn't land on a screen carrying a stale "Saving…" spinner
   or an error message from User A's last action. */
if (typeof window !== 'undefined') {
  window.addEventListener('pmis:session-reset', () => {
    if (state.loaderHideTimer) {
      clearTimeout(state.loaderHideTimer);
    }
    state = {
      messageOpen: false,
      messageText: '',
      messageIsError: false,
      messageOnOk: null,
      loaderOpen: false,
      loaderText: '',
      loaderShownAt: 0,
      loaderHideTimer: null,
    };
    emit();
  });
}

export function useUiState() {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}
