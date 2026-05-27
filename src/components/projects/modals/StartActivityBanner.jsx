/* ══════════════════════════════════════════════════════════════════
   StartActivityBanner.jsx — sits at the top of the LEFT column of the
   activity edit modal.

   Two states (mirroring the HTML reference's `.activity-start-banner`):
     • Not started — amber banner with a "▶ Start Activity" button.
       Click fires SUBMIT to the workflow service AND stamps
       `actualStartDate = today` locally. Errors surface inline.
     • Started — green banner showing the actual start date.

   The approval workflow itself (Mark Ready / Request Division /
   Approve / Reject / Request Owner) is driven separately by the
   ApprovalPanel on the right column.
   ══════════════════════════════════════════════════════════════════ */

import React, { useState } from "react";
import { formatDateDisplay } from "../../../utils/project/helpers";
import { startActivity } from "../../../utils/project/approvalWorkflow";
import { transitionActivity, WORKFLOW_ACTIONS } from "../../../api/activityWorkflow";

export default function StartActivityBanner({ activity, form, editable, onChange }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const startedDate = form.actualStartDate || activity.actualStartDate || "";
  const isStarted = !!startedDate;
  const businessId = activity.apiId || activity.uid || "";

  async function handleStart() {
    if (!businessId) {
      setError("Save the activity first, then start it.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      await transitionActivity({
        businessId,
        action: WORKFLOW_ACTIONS.SUBMIT,
        comment: "Activity started."
      });
      onChange(startActivity(form));
    } catch (err) {
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
            {editable && (
              <button
                type="button"
                className="pmis-awf-start-banner__btn"
                onClick={handleStart}
                disabled={busy}
              >
                {busy ? "Submitting…" : "▶ Start Activity"}
              </button>
            )}
          </>
        )}
      </div>
      {error && (
        <div className="pmis-awf-error" style={{ marginTop: 8 }}>
          {error}
        </div>
      )}
    </div>
  );
}
