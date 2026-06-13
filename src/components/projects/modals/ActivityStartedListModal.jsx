/* ══════════════════════════════════════════════════════════════════
   ActivityStartedListModal.jsx — read-only table of every activity in a
   project that has been STARTED (activityStarted flag set, or an actual
   start date stamped).

   Self-contained: fetches the project's milestones, then each milestone's
   activities, flattens them, and keeps only the started ones. Opened from
   the Project Detail "⋮" menu → "Activity Started List".
   ══════════════════════════════════════════════════════════════════ */

import React, { useEffect, useState } from "react";
import { safeArray, formatDateDisplay } from "../../../utils/project/helpers";
import {
  loadMilestonesForProject,
  loadActivitiesForMilestone,
} from "../../../api/milestoneConfigApi";

/* An activity counts as "started" when the backend flag is set or an
   actual start date has been stamped (mirrors StartActivityBanner). */
function isStarted(a) {
  return !!(a && (a.activityStarted || a.actualStartDate));
}

export default function ActivityStartedListModal({ open, projectId, projectName, onClose }) {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!open || !projectId) return;
    let cancelled = false;
    setLoading(true);
    setError("");
    setRows([]);

    (async () => {
      try {
        const milestones = safeArray(await loadMilestonesForProject(projectId));
        // Fetch every milestone's activities in parallel, tagging each with
        // its parent milestone so the table can show where it lives.
        const perMilestone = await Promise.all(
          milestones.map(async (m) => {
            const acts = safeArray(await loadActivitiesForMilestone(m.apiId));
            return acts.map((a) => ({
              ...a,
              milestoneName: m.name || "",
              milestoneCode: m.serverDisplayCode || m.id || "",
            }));
          })
        );
        if (cancelled) return;
        const started = perMilestone.flat().filter(isStarted);
        setRows(started);
      } catch (err) {
        if (!cancelled) setError(err?.message || "Failed to load activities.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => { cancelled = true; };
  }, [open, projectId]);

  if (!open) return null;

  return (
    <div className="uidai-modal" onClick={onClose}>
      <div
        className="uidai-modal__box uidai-modal__box--wide"
        style={{ position: "relative" }}
        onClick={(e) => e.stopPropagation()}
      >
        <button
          type="button"
          aria-label="Close"
          onClick={onClose}
          style={{
            position: "absolute",
            top: 8,
            right: 10,
            width: 28,
            height: 28,
            border: "none",
            background: "transparent",
            fontSize: 22,
            lineHeight: 1,
            cursor: "pointer",
            color: "#666",
            padding: 0,
          }}
        >
          ×
        </button>
        <h3 className="uidai-modal__title">Activity Started List</h3>
        <div className="uidai-hint" style={{ marginTop: 6 }}>
          Activities that have been started{projectName ? ` in ${projectName}` : ""}.
        </div>

        {loading && (
          <div className="pmis-sal-empty">Loading started activities…</div>
        )}
        {error && !loading && (
          <div className="pmis-awf-error" style={{ marginTop: 12 }}>{error}</div>
        )}
        {!loading && !error && rows.length === 0 && (
          <div className="pmis-sal-empty">No activities have been started yet.</div>
        )}

        {!loading && !error && rows.length > 0 && (
          <div className="pmis-sal-table-wrap">
            <table className="pmis-sal-table">
              <thead>
                <tr>
                  <th>#</th>
                  <th>Activity</th>
                  <th>Milestone</th>
                  <th>Actual Start Date</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((a, i) => (
                  <tr key={a.apiId || a.id || i}>
                    <td>{a.serverDisplayCode || a.id || i + 1}</td>
                    <td>{a.name || "—"}</td>
                    <td>{a.milestoneName || "—"}</td>
                    <td>{a.actualStartDate ? formatDateDisplay(a.actualStartDate) : "—"}</td>
                    <td>{a.status || "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <div className="uidai-modal__actions">
          <button type="button" className="uidai-btn uidai-btn--cancel" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
