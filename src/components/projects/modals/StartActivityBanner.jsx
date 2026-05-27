/* ══════════════════════════════════════════════════════════════════
   StartActivityBanner.jsx — sits at the top of the LEFT column of the
   activity edit modal.

   Two states:
     • Not started — amber banner with a "▶ Start Activity" button.
       Click fires SUBMIT to the workflow service AND stamps
       actualStartDate=today on the form.
     • Started — green banner showing the actual start date.

   The banner mirrors the HTML reference's .activity-start-banner. All
   styles use the unique `pmis-awf-` prefix.
   ══════════════════════════════════════════════════════════════════ */

import React, { useState } from "react";
import { formatDateDisplay, safeArray } from "../../../utils/project/helpers";
import { startActivity } from "../../../utils/project/approvalWorkflow";
import { transitionActivity, WORKFLOW_ACTIONS } from "../../../api/activityWorkflow";

export default function StartActivityBanner({ activity, form, editable, onChange }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const startedDate = form.actualStartDate || activity.actualStartDate || "";
  const isStarted = !!startedDate;
  const businessId = activity.apiId || activity.uid || "";
  const consentDivisions = safeArray(form.concernedDivision).length
    ? safeArray(form.concernedDivision)
    : safeArray(activity.consentDivisions);

  async function handleStart() {
    if (!businessId) {
      setError("Save the activity first, then start the workflow.");
      return;
    }
    if (!consentDivisions.length) {
      setError(
        "Add at least one Concerned Division to the activity before starting the workflow."
      );
      return;
    }
    setBusy(true);
    setError("");
    try {
      await transitionActivity({
        businessId,
        action: WORKFLOW_ACTIONS.SUBMIT,
        comment: "Activity started — initial submission for approval."
      });
      onChange(startActivity(form, consentDivisions));
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
                Stamping the Actual Start Date submits the activity for
                Concerned Division approval. Make sure tasks are ready before
                you start.
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
