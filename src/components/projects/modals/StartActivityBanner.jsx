/* ══════════════════════════════════════════════════════════════════
   StartActivityBanner.jsx — sits at the top of the LEFT column of the
   activity edit modal.

   Two states (mirroring the HTML reference's `.activity-start-banner`):
     • Not started — amber banner with a "▶ Start Activity" button. Click
       opens a small confirm popup with the Actual Start Date pre-filled to
       today; on OK it POSTs /api/v3/activities/{id}/start with
       { actualStartDate: <chosen date ISO> } and stamps that date on the
       local form.

       The backend rejects the start with a 422 when the activity is already
       started or completed, the project is closed, or a predecessor activity
       isn't finished yet — that message is surfaced inline verbatim.

       Starting is NOT submitting: the activity stays `not_completed` and the
       approval workflow (submit / approve) runs separately from the panel on
       the right.
     • Started — green banner showing the actual start date.
   ══════════════════════════════════════════════════════════════════ */

import React, { useState } from "react";
import { formatDateDisplay } from "../../../utils/project/helpers";
import { startActivity } from "../../../utils/project/approvalWorkflow";
import { api } from "../../../api/client";
import { ENDPOINTS } from "../../../api/endpoint";
import { useCan } from "../../../auth/permissions";

export default function StartActivityBanner({ activity, form, editable, projectPublished, readOnly, onChange }) {
  /* Start Activity is part of the approval-workflow pipeline (it gates
     Mark Ready), so it follows the same permission as the timeline
     buttons: super_admin / admin / org_admin / project_admin can start
     even though they may not have full activity-edit rights. */
  const canSubmit = useCan('submitActivityForApproval');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  /* Clicking "Start Activity" opens a small confirm popup with the Actual
     Start Date pre-filled to today; the user can adjust it, then OK. */
  const todayStr = new Date().toISOString().slice(0, 10);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [startDate, setStartDate] = useState(todayStr);

  /* Backend ships an explicit `activityStarted` boolean — trust it
     first so a refresh of an already-started activity lands on the
     green banner even if the local form lost its actualStartDate. */
  const isStarted =
    !!(form && form.activityStarted) ||
    !!(activity && activity.activityStarted) ||
    !!(form && form.actualStartDate) ||
    !!(activity && activity.actualStartDate);
  const startedDate =
    (form && form.actualStartDate) ||
    (activity && activity.actualStartDate) ||
    "";
  const businessId = activity.apiId || "";

  function openConfirm() {
    setStartDate(todayStr);
    setError("");
    setConfirmOpen(true);
  }

  async function handleStart() {
    if (!businessId) {
      setError("Save the activity first, then start it.");
      return;
    }
    if (!startDate) {
      setError("Pick an Actual Start Date.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      // Send the chosen date at local midnight as an ISO timestamp. The
      // body is optional — omitting it would default to "now" — but the
      // user picked a date, so it's always sent.
      const iso = new Date(`${startDate}T00:00:00`).toISOString();
      await api.post(ENDPOINTS.activities.start(businessId), {
        actualStartDate: iso
      });
      /* Apply the local start-activity transition (adds the system comment)
         AND flip the activityStarted flag so the banner immediately mirrors
         the backend state without waiting for a re-fetch. Override the
         stamped date with the one the user picked. */
      const next = startActivity({ ...form, actualStartDate: "" });
      onChange({ ...next, activityStarted: true, actualStartDate: startDate });
      setConfirmOpen(false);
    } catch (err) {
      /* A 422 carries the reason the start was refused (already started /
         completed, project closed, predecessor incomplete). ApiError already
         lifts `error.message` out of the envelope, so show it as-is rather
         than a generic failure line. */
      setError(err && err.message ? err.message : "Failed to start activity.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="pmis-awf-scope">
      <div
        className={`pmis-awf-start-banner${
          isStarted ? " pmis-awf-start-banner--started" : ""
        }`}
      >
        {isStarted ? (
          <div>
            <div className="pmis-awf-start-banner__label">Activity Started</div>
            <div className="pmis-awf-start-banner__value">
              {formatDateDisplay(startedDate)}
            </div>
          </div>
        ) : (
          <>
            <div style={{ minWidth: 0, flex: "1 1 auto" }}>
              <div className="pmis-awf-start-banner__label">Not Started</div>
              <div className="pmis-awf-start-banner__hint">
                Stamping the Actual Start Date is independent of the approval
                workflow — start when work begins, then drive approvals from
                the panel on the right.
              </div>
            </div>
            {canSubmit && projectPublished && !readOnly && (
              <button
                type="button"
                className="pmis-awf-start-banner__btn"
                onClick={openConfirm}
                disabled={busy}
              >
                ▶ Start Activity
              </button>
            )}
          </>
        )}
      </div>
      {error && !confirmOpen && (
        <div className="pmis-awf-error" style={{ marginTop: 8 }}>
          {error}
        </div>
      )}

      {confirmOpen && (
        <div
          className="pmis-awf-startpop__overlay"
          onClick={() => { if (!busy) setConfirmOpen(false); }}
        >
          <div
            className="pmis-awf-startpop"
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-label="Start Activity"
          >
            <div className="pmis-awf-startpop__title">Start Activity</div>
            <label className="pmis-awf-startpop__label" htmlFor="pmis-awf-start-date">
              Actual Start Date
            </label>
            <input
              id="pmis-awf-start-date"
              type="date"
              className="pmis-awf-startpop__input"
              value={startDate}
              max={todayStr}
              onChange={(e) => setStartDate(e.target.value)}
              autoFocus
            />
            {error && (
              <div className="pmis-awf-error" style={{ marginTop: 8 }}>{error}</div>
            )}
            <div className="pmis-awf-startpop__actions">
              <button
                type="button"
                className="pmis-awf-startpop__btn pmis-awf-startpop__btn--cancel"
                onClick={() => setConfirmOpen(false)}
                disabled={busy}
              >
                Cancel
              </button>
              <button
                type="button"
                className="pmis-awf-startpop__btn pmis-awf-startpop__btn--ok"
                onClick={handleStart}
                disabled={busy || !startDate}
              >
                {busy ? "Starting…" : "OK"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
