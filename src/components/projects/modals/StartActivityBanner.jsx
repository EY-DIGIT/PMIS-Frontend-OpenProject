/* ══════════════════════════════════════════════════════════════════
   StartActivityBanner.jsx — sits at the top of the LEFT column of the
   activity edit modal.

   Two states (mirroring the HTML reference's `.activity-start-banner`):
     • Not started — amber banner with a "▶ Start Activity" button.
       Click PATCHes /api/v3/activities/{id} with
       { activityStarted: true, actualStartDate: <now ISO> } and then
       stamps actualStartDate on the local form. Errors surface inline.
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

  async function handleStart() {
    if (!businessId) {
      setError("Save the activity first, then start it.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const nowIso = new Date().toISOString();
      await api.patch(ENDPOINTS.activities.update(businessId), {
        activityStarted: true,
        actualStartDate: nowIso
      });
      /* Apply the local start-activity transition AND flip the
         activityStarted flag so the banner immediately mirrors the
         backend state without waiting for a re-fetch. */
      const next = startActivity(form);
      onChange({ ...next, activityStarted: true });
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
            {canSubmit && projectPublished && !readOnly && (
              <button
                type="button"
                className="pmis-awf-start-banner__btn"
                onClick={handleStart}
                disabled={busy}
              >
                {busy ? "Starting…" : "▶ Start Activity"}
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
