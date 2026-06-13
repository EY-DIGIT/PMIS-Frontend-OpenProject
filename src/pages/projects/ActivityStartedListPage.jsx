/* ══════════════════════════════════════════════════════════════════
   ActivityStartedListPage.jsx — full-page, read-only table of every
   activity in a project that has been STARTED (activityStarted flag set,
   or an actual start date stamped).

   Reached from the Project Detail "⋮" menu → "Activity Started List"
   (route: /projects/:projectId/activities-started). It loads the
   project's milestones, then each milestone's activities, flattens them,
   and keeps only the started ones.
   ══════════════════════════════════════════════════════════════════ */

import React, { useEffect, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { useProject } from "../../store/project/projectsStore";
import { safeArray, formatDateDisplay } from "../../utils/project/helpers";
import {
  loadMilestonesForProject,
  loadActivitiesForMilestone,
} from "../../api/milestoneConfigApi";

/* An activity counts as "started" when the backend flag is set or an
   actual start date has been stamped (mirrors StartActivityBanner). */
function isStarted(a) {
  return !!(a && (a.activityStarted || a.actualStartDate));
}

export default function ActivityStartedListPage() {
  const { projectId } = useParams();
  const navigate = useNavigate();
  const project = useProject(projectId);
  const projectName = project?.projectName || "";

  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!projectId) return;
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
  }, [projectId]);

  const goBack = () => {
    if (window.history.length > 1) navigate(-1);
    else navigate(`/projects/${encodeURIComponent(projectId || "")}`);
  };

  /* Open the SAME full-page activity editor that Milestone Configuration
     uses — the config page loads the whole project tree, locates the
     activity by uid (uid === apiId for saved nodes), and renders NodeModal
     in edit mode with every action (workflow, start, comments, etc.).
     Cancelling / saving there navigates back here. */
  const editActivity = (a) => {
    const apiId = a.apiId || a.id;
    if (!apiId) return;
    const params = new URLSearchParams({
      kind: "activity",
      mode: "edit",
      nodeUid: apiId,
    });
    navigate(`/projects/${encodeURIComponent(projectId)}/config/node?${params.toString()}`);
  };

  return (
    <div className="uidai-card-project">
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 10,
          marginBottom: 8,
        }}
      >
        <h3 style={{ margin: 0 }}>Activity Started List</h3>
        <button type="button" className="uidai-btn uidai-btn--cancel" onClick={goBack}>
          ← Back
        </button>
      </div>
      <div className="uidai-hint" style={{ marginBottom: 12 }}>
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
                <th>Actions</th>
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
                  <td>
                    <button
                      type="button"
                      className="pmis-sal-edit-btn"
                      onClick={() => editActivity(a)}
                      disabled={!(a.apiId || a.id)}
                    >
                      ✎ Edit
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
