/* ══════════════════════════════════════════════════════════════════
   LastTaskConfirmModal.jsx — popup that appears after the user marks
   the LAST incomplete task/sub-task under an activity as Completed
   while the activity's approval workflow is still in the `idle`
   state. Asks "Start approval workflow now?".

     • Yes → fires SUBMIT to the workflow service for the parent
             activity and transitions its local state to
             pending_division.
     • No  → leaves the activity untouched.

   Uses CSS classes from src/styles/project/activityWorkflow.css with
   the `pmis-awf-confirm` prefix.
   ══════════════════════════════════════════════════════════════════ */

import React, { useState } from "react";

export default function LastTaskConfirmModal({
  activity,
  busy,
  error,
  onYes,
  onNo
}) {
  if (!activity) return null;
  const name = activity.name || activity.id || "this activity";
  return (
    <div className="pmis-awf-confirm pmis-awf-scope" role="dialog" aria-modal="true">
      <div className="pmis-awf-confirm__box">
        <div className="pmis-awf-confirm__head">
          <h3>Start approval workflow now?</h3>
          <button
            type="button"
            className="pmis-awf-confirm__close"
            aria-label="Close"
            onClick={onNo}
            disabled={busy}
          >
            ✕
          </button>
        </div>
        <div className="pmis-awf-confirm__body">
          The last task under <b>{name}</b> is now complete. Submit the
          activity to the Concerned Division(s) for approval?
        </div>
        {error && <div className="pmis-awf-error">{error}</div>}
        <div className="pmis-awf-confirm__actions">
          <button
            type="button"
            className="pmis-awf-btn pmis-awf-btn--ghost"
            onClick={onNo}
            disabled={busy}
          >
            No
          </button>
          <button
            type="button"
            className="pmis-awf-btn"
            onClick={onYes}
            disabled={busy}
          >
            {busy ? "Submitting…" : "Yes, Start Workflow"}
          </button>
        </div>
      </div>
    </div>
  );
}

/* Tiny hook that owns the popup's UI state — keeps the parent page
   from littering its component with this boilerplate. Returns
   `{ pending, open, close, busy, setBusy, error, setError }`. */
export function useLastTaskConfirm() {
  const [pending, setPending] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  return {
    pending,
    busy,
    error,
    setBusy,
    setError,
    open(activity, onYes) {
      setPending({ activity, onYes });
      setBusy(false);
      setError("");
    },
    close() {
      setPending(null);
      setBusy(false);
      setError("");
    }
  };
}
