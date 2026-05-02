import React from "react";
import { useUiState, uiStore } from "../../../store/project/uiStore";

/* Match the HTML reference's success/error popup:
   - Navy→cyan top stripe via .uidai-app-modal::before
   - 62×62 circular SVG icon (warn-triangle for errors, check for success)
   - Bold navy title + softer body line
   - Centered single OK button. The message body uses `pre-line` whitespace
     so caller-supplied "\n• ..." bullet lists render correctly. */
const ICON_WARN = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
       strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M10.3 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0Z" />
    <path d="M12 9v4" />
    <path d="M12 17h.01" />
  </svg>
);

const ICON_CHECK = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3"
       strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M5 12.5 10 18l9-11" />
  </svg>
);

export default function MessageModal() {
  const state = useUiState();
  if (!state.messageOpen) return null;

  const raw = String(state.messageText || "");
  // If the caller sent "Title\nBody" split on the first newline, otherwise
  // pick a sensible default title based on whether this is an error.
  let title;
  let body;
  if (raw.includes("\n")) {
    const idx = raw.indexOf("\n");
    title = raw.slice(0, idx).replace(/[:!?]+$/, "").trim();
    body = raw.slice(idx + 1).trim();
  } else {
    title = state.messageIsError ? "Please review the form" : "Success";
    body = raw;
  }

  return (
    <div className="uidai-app-modal-overlay uidai-app-modal-overlay--show">
      <div className="uidai-app-modal" role="dialog" aria-modal="true">
        <button
          type="button"
          className="uidai-app-modal__close"
          aria-label="Close"
          onClick={() => uiStore.closeMessage()}
        >
          ×
        </button>
        <div className="uidai-app-modal__body">
          <div
            className={`uidai-app-modal__icon uidai-app-modal__icon--${state.messageIsError ? "danger" : "success"}`}
            aria-hidden="true"
          >
            {state.messageIsError ? ICON_WARN : ICON_CHECK}
          </div>
          {title && <div className="uidai-app-modal__title">{title}</div>}
          {body && <div className="uidai-app-modal__message">{body}</div>}
          <div className="uidai-app-modal__actions">
            <button
              type="button"
              className="uidai-pmis-btn"
              style={{ minWidth: 120, marginTop: 0 }}
              onClick={() => uiStore.closeMessage()}
            >
              OK
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
