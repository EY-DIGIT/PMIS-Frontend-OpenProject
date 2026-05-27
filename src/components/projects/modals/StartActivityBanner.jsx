/* ══════════════════════════════════════════════════════════════════
   StartActivityBanner.jsx — sits at the top of the LEFT column of the
   activity edit modal.

   Two states (mirroring the HTML reference's `.activity-start-banner`):
     • Not started — amber banner with a "▶ Start Activity" button.
       Click stamps `actualStartDate = today` locally. The approval
       workflow is independent of this — driven by the Mark Ready /
       Request Division buttons inside the ApprovalPanel.
     • Started — green banner showing the actual start date.
   ══════════════════════════════════════════════════════════════════ */

import React from "react";
import { formatDateDisplay } from "../../../utils/project/helpers";
import { startActivity } from "../../../utils/project/approvalWorkflow";

export default function StartActivityBanner({ activity, form, editable, onChange }) {
  const startedDate = form.actualStartDate || activity.actualStartDate || "";
  const isStarted = !!startedDate;

  function handleStart() {
    onChange(startActivity(form));
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
              >
                ▶ Start Activity
              </button>
            )}
          </>
        )}
      </div>
    </div>
  );
}
