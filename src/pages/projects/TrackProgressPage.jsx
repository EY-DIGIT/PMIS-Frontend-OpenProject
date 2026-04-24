import React, { useMemo } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useProject } from "../../store/project/projectsStore";
import {
  locateNode,
  classifyStatus,
  statusLabelFor,
  computeProgress,
  computeEffectiveActuals,
  recomputeActualDates
} from "../../utils/project/nodeUtils";
import { safeArray, formatDateDisplay } from "../../utils/project/helpers";

export default function TrackProgressPage() {
  const { projectId, nodeUid } = useParams();
  const navigate = useNavigate();

  /* ─────────────────────────────────────────────────────────────
     ALL HOOKS FIRST — nothing conditional before this block.
     Keeping hook order stable across renders is mandatory
     (Rules of Hooks; CRA's eslint blocks compile otherwise).
     ───────────────────────────────────────────────────────────── */
  const project = useProject(projectId);

  /* Locate the focus node — tolerates null project so we never
     skip the useMemo below. Plain computations, no hooks. */
  const focusLoc = project && nodeUid ? locateNode(project, nodeUid) : null;
  const focusNode = focusLoc ? focusLoc.node : null;
  const focusKind = focusLoc ? focusLoc.kind : "project";

  /* Memoized flat rows — null-tolerant so the hook is always called. */
  const flat = useMemo(() => {
    if (!project) return [];
    const out = [];
    function walk(list, kind, depth) {
      safeArray(list).forEach((n) => {
        out.push({ node: n, kind, depth });
        if (kind === "milestone") walk(n.activities, "activity", depth + 1);
        else if (kind === "activity") walk(n.tasks, "task", depth + 1);
        else walk(n.subtasks, "subtask", depth + 1);
      });
    }
    if (focusNode) {
      out.push({ node: focusNode, kind: focusKind, depth: 0 });
      if (focusKind === "milestone") walk(focusNode.activities, "activity", 1);
      else if (focusKind === "activity") walk(focusNode.tasks, "task", 1);
      else walk(focusNode.subtasks, "subtask", 1);
    } else {
      walk(project.milestones, "milestone", 0);
    }
    return out;
  }, [project, focusNode, focusKind]);

  /* ─────────────────────────────────────────────────────────────
     From here, conditional returns are safe — no more hooks.
     ───────────────────────────────────────────────────────────── */
  if (!project) {
    return (
      <div>
        <div className="uidai-card-project">
          <div className="uidai-hint">Project not found.</div>
          <div className="uidai-card-project-actions" style={{ justifyContent: "flex-start" }}>
            <button
              type="button"
              className="uidai-btn uidai-btn--cancel"
              onClick={() => navigate("/projects")}
            >
              Back
            </button>
          </div>
        </div>
      </div>
    );
  }

  /* Recompute actuals for latest values */
  try {
    recomputeActualDates(project);
  } catch (e) {}

  const totals = {
    total: flat.length,
    completed: 0,
    ontrack: 0,
    delayed: 0,
    notstarted: 0,
    notcompleted: 0,
    closed: 0
  };
  flat.forEach((r) => {
    totals[classifyStatus(r.node)]++;
  });

  const overall = focusNode
    ? computeProgress(focusNode)
    : safeArray(project.milestones).length
    ? Math.round(
        safeArray(project.milestones).reduce((a, m) => a + computeProgress(m), 0) /
          safeArray(project.milestones).length
      )
    : 0;

  const overallStatus = focusNode
    ? classifyStatus(focusNode)
    : overall === 100
    ? "completed"
    : overall === 0
    ? "notstarted"
    : "ontrack";

  const focusName =
    focusNode && focusNode.name && focusNode.name !== project.projectName
      ? ` — ${focusNode.name}`
      : "";

  return (
    <div>
      <div className="uidai-page-header" style={{ justifyContent: "flex-end" }}>
        <div className="uidai-page-header__actions">
          <button
            type="button"
            className="uidai-btn uidai-btn--cancel"
            onClick={() =>
              navigate(`/projects/${encodeURIComponent(project.projectId)}/config`)
            }
          >
            Back to Configuration
          </button>
        </div>
      </div>

      <div className="uidai-card-project">
        <h3 style={{ marginTop: 0 }}>
          {project.projectName}
          {focusName}
        </h3>
        <div className="uidai-hint" style={{ marginBottom: 14 }}>
          Progress is automatically calculated from the completion of items lower in the hierarchy.
          Actual Start / End dates are auto-derived for any item that has children.
        </div>

        <div className="uidai-track-kpis">
          <div className="uidai-track-kpi">
            <div className="uidai-track-kpi__label">Overall Progress</div>
            <div className="uidai-track-kpi__value">{overall}%</div>
            <div className="uidai-progress" style={{ marginTop: 8 }}>
              <div
                className={`uidai-progress__bar uidai-progress__bar--${overallStatus}`}
                style={{ width: `${overall}%` }}
              />
            </div>
            <div className="uidai-track-kpi__sub">
              <span className={`uidai-track-pill uidai-track-pill--${overallStatus}`}>
                {statusLabelFor(overallStatus)}
              </span>
            </div>
          </div>
          <div className="uidai-track-kpi">
            <div className="uidai-track-kpi__label">Total Items</div>
            <div className="uidai-track-kpi__value">{totals.total}</div>
            <div className="uidai-track-kpi__sub">In the selected scope</div>
          </div>
          <div className="uidai-track-kpi">
            <div className="uidai-track-kpi__label">Completed</div>
            <div className="uidai-track-kpi__value" style={{ color: "#1b7a42" }}>
              {totals.completed}
            </div>
            <div className="uidai-track-kpi__sub">
              {totals.total ? Math.round((totals.completed / totals.total) * 100) : 0}% of items
            </div>
          </div>
          <div className="uidai-track-kpi">
            <div className="uidai-track-kpi__label">Delayed</div>
            <div className="uidai-track-kpi__value" style={{ color: "#c33a1a" }}>
              {totals.delayed}
            </div>
            <div className="uidai-track-kpi__sub">Past expected end date</div>
          </div>
          <div className="uidai-track-kpi">
            <div className="uidai-track-kpi__label">On Track</div>
            <div className="uidai-track-kpi__value" style={{ color: "#1a56db" }}>
              {totals.ontrack}
            </div>
            <div className="uidai-track-kpi__sub">In progress &amp; within schedule</div>
          </div>
          <div className="uidai-track-kpi">
            <div className="uidai-track-kpi__label">Not Started</div>
            <div className="uidai-track-kpi__value" style={{ color: "#66788f" }}>
              {totals.notstarted}
            </div>
            <div className="uidai-track-kpi__sub">Awaiting kick-off</div>
          </div>
        </div>

        <div className="uidai-track-legend">
          <span className="uidai-track-legend__item">
            <span
              className="uidai-track-legend__swatch"
              style={{ background: "#e7f8ee", border: "1px solid #b6e7c7" }}
            />
            Completed
          </span>
          <span className="uidai-track-legend__item">
            <span
              className="uidai-track-legend__swatch"
              style={{ background: "#e3eefc", border: "1px solid #b9d0f1" }}
            />
            On Track
          </span>
          <span className="uidai-track-legend__item">
            <span
              className="uidai-track-legend__swatch"
              style={{ background: "#fde5d9", border: "1px solid #f5bfa5" }}
            />
            Delayed
          </span>
          <span className="uidai-track-legend__item">
            <span
              className="uidai-track-legend__swatch"
              style={{ background: "#f0f2f7", border: "1px solid #d7dde8" }}
            />
            Not Started
          </span>
          <span className="uidai-track-legend__item">
            <span
              className="uidai-track-legend__swatch"
              style={{ background: "#fff3e0", border: "1px solid #f2d8a9" }}
            />
            Not Completed
          </span>
          <span className="uidai-track-legend__item">
            <span
              className="uidai-track-legend__swatch"
              style={{ background: "#efeafc", border: "1px solid #d6cbf0" }}
            />
            Closed
          </span>
        </div>

        <div className="uidai-msgrid-wrap" style={{ marginTop: 14 }}>
          <table className="uidai-msgrid">
            <thead>
              <tr>
                <th style={{ width: 80 }}>WBS</th>
                <th>Name</th>
                <th style={{ width: 170 }}>Progress</th>
                <th style={{ width: 140 }}>Status</th>
                <th style={{ width: 160 }}>Expected Dates</th>
                <th style={{ width: 160 }}>Actual Dates</th>
                <th style={{ width: 120 }}>Type</th>
              </tr>
            </thead>
            <tbody>
              {flat.length === 0 ? (
                <tr>
                  <td
                    colSpan={7}
                    style={{ textAlign: "center", padding: 28, color: "#66788f" }}
                  >
                    No items to track yet.
                  </td>
                </tr>
              ) : (
                flat.map((r) => <TrackRow key={r.node.uid} r={r} />)
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function TrackRow({ r }) {
  const { node, kind, depth } = r;
  const indent = 10 + depth * 28;
  const progress = computeProgress(node);
  const statusKey = classifyStatus(node);
  const statusText = statusLabelFor(statusKey);
  const actuals = computeEffectiveActuals(node);
  const typeLabel = kind === "milestone" ? "Milestone" : node.type || "";
  const expected =
    node.startDate || node.endDate
      ? `${formatDateDisplay(node.startDate || "-")} → ${formatDateDisplay(node.endDate || "-")}`
      : "—";
  const actualText =
    actuals.start || actuals.end
      ? `${formatDateDisplay(actuals.start || "-")} → ${formatDateDisplay(actuals.end || "-")}`
      : "—";

  return (
    <tr className={`uidai-msgrid__row--${kind} uidai-track-row--${statusKey}`}>
      <td className="uidai-msgrid__cell uidai-msgrid__cell--wbs">{node.id || ""}</td>
      <td className="uidai-msgrid__cell uidai-msgrid__cell--name">
        <div className="uidai-msgrid__name-inner" style={{ paddingLeft: indent }}>
          <span className="uidai-msgrid__row-label" title={node.name}>
            {node.name}
          </span>
        </div>
      </td>
      <td className="uidai-msgrid__cell">
        <div className="uidai-progress">
          <div
            className={`uidai-progress__bar uidai-progress__bar--${statusKey}`}
            style={{ width: `${progress}%` }}
          />
        </div>
        <div className="uidai-progress__label">{progress}%</div>
      </td>
      <td className="uidai-msgrid__cell">
        <span className={`uidai-track-pill uidai-track-pill--${statusKey}`}>{statusText}</span>
      </td>
      <td className="uidai-msgrid__cell uidai-msgrid__cell--date">{expected}</td>
      <td className="uidai-msgrid__cell uidai-msgrid__cell--date">{actualText}</td>
      <td className="uidai-msgrid__cell">
        {typeLabel ? <span className="uidai-type-tag">{typeLabel}</span> : "—"}
      </td>
    </tr>
  );
}