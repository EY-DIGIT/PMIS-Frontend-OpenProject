/* ══════════════════════════════════════════════════════════════════
   src/components/projects/MilestoneGridRow.jsx

   One row in the milestones/activities/tasks/subtasks grid.
   Shown as <tr> inside a table rendered by MilestoneConfigPage.
   ══════════════════════════════════════════════════════════════════ */

import React from "react";
import { safeArray, formatDateDisplay } from "../../utils/project/helpers";
import {
  effectiveStatus,
  isNodeBaselineLocked
} from "../../utils/project/nodeUtils";

export default function MilestoneGridRow({
  r,
  project,
  depMap,
  canMod,
  showStatusCol,
  isOnboarding,
  isVersion,
  onToggle,
  onAddChild,
  onEdit,
  onDelete,
  onTrack
}) {
  const { node, kind, depth, hasKids, isExpanded } = r;
  const indent = 10 + depth * 28;

  const eff = effectiveStatus(node);
  const rolled = eff === "Completed" && node.status !== "Completed";
  const pillClass =
    eff === "Completed"
      ? rolled
        ? "uidai-status-pill--rolledup"
        : "uidai-status-pill--done"
      : "uidai-status-pill--todo";
  const pillLabel =
    eff === "Completed"
      ? (rolled ? "All children completed" : "Completed")
      : "Not Completed";

  const deps = safeArray(node.dependsOn)
    .map((uid) => depMap[uid])
    .filter(Boolean);

  const typeLabel = kind === "milestone" ? "Milestone" : node.type || "";
  // Version projects: milestones and activities are view-only. Tasks and
  // sub-tasks remain editable so users can adjust their progress fields
  // and add new ones beneath baseline-inherited activities/tasks.
  const locked = isVersion
    ? (kind === "milestone" || kind === "activity")
    : isNodeBaselineLocked(project, node);

  let addChildBtn = null;
  if (canMod) {
    if (kind === "milestone" && !isVersion) {
      addChildBtn = (
        <button
          type="button"
          className="uidai-msgrid__add-inline"
          onClick={(e) => {
            e.stopPropagation();
            onAddChild("activity", "add", node.uid, null);
          }}
        >
          + Activity
        </button>
      );
    } else if (kind === "activity" && !isOnboarding && isVersion) {
      addChildBtn = (
        <button
          type="button"
          className="uidai-msgrid__add-inline"
          onClick={(e) => {
            e.stopPropagation();
            onAddChild("task", "add", node.uid, null);
          }}
        >
          + Task
        </button>
      );
    } else if ((kind === "task" || kind === "subtask") && !isOnboarding && isVersion) {
      addChildBtn = (
        <button
          type="button"
          className="uidai-msgrid__add-inline"
          onClick={(e) => {
            e.stopPropagation();
            onAddChild("subtask", "add", node.uid, null);
          }}
        >
          + Sub Task
        </button>
      );
    }
  }

  const rowClass =
    `uidai-msgrid__row--${kind}` + (locked ? " uidai-msgrid__row--locked" : "");

  const parentUidForEdit =
    r.milestoneUid || r.activityUid || r.parentTaskUid || "";

  return (
    <tr className={rowClass}>
      <td className="uidai-msgrid__cell uidai-msgrid__cell--wbs">{node.id || ""}</td>
      <td className="uidai-msgrid__cell uidai-msgrid__cell--name">
        <div className="uidai-msgrid__name-inner" style={{ paddingLeft: indent }}>
          {hasKids ? (
            <button
              type="button"
              className="uidai-msgrid__expand-btn"
              onClick={(e) => {
                e.stopPropagation();
                onToggle(node.uid);
              }}
              aria-label="Toggle"
            >
              {isExpanded ? "−" : "+"}
            </button>
          ) : (
            <span className="uidai-msgrid__expand-spacer" />
          )}
          <span className="uidai-msgrid__row-label" title={node.name}>
            {node.name}
          </span>
          {locked && (
            <span
              className="uidai-baseline-lock-icon"
              title={
                isVersion
                  ? "Version project — view-only"
                  : "Baseline item — locked in this version"
              }
            >
              🔒
            </span>
          )}
          {addChildBtn}
        </div>
      </td>
      <td className="uidai-msgrid__cell">
        {typeLabel ? <span className="uidai-type-tag">{typeLabel}</span> : null}
      </td>
      {showStatusCol && (
        <td className="uidai-msgrid__cell">
          <span className={`uidai-status-pill ${pillClass}`}>{pillLabel}</span>
        </td>
      )}
      <td className="uidai-msgrid__cell uidai-msgrid__cell--date">
        {formatDateDisplay(node.startDate)}
      </td>
      <td className="uidai-msgrid__cell uidai-msgrid__cell--date">
        {formatDateDisplay(node.endDate)}
      </td>
      <td className="uidai-msgrid__cell" style={{textAlign:"center"}}>
        {kind === "milestone" && node.vendor ? (
          <span className="uidai-vendor-tag">{node.vendor}</span>
        ) : (
          // <span className="uidai-dep-empty">—</span>
          <>
          
          </>
        )}
      </td>
      <td className="uidai-msgrid__cell" style={{textAlign:"center"}}>
        {deps.length === 0 ? (
          <>
          
          </>
          // <span className="uidai-dep-empty">—</span>
        ) : (
          deps.map((d, i) => (
            <span key={i} className="uidai-dep-tag">
              {d.id || d.name}
            </span>
          ))
        )}
      </td>
      <td className="uidai-msgrid__cell uidai-msgrid__cell--actions">
        {!isOnboarding && (
          <button
            type="button"
            className="uidai-msgrid__btn-text"
            onClick={() => onTrack(node.uid)}
          >
            Track
          </button>
        )}
        <button
          type="button"
          className="uidai-msgrid__btn-text"
          onClick={() => onEdit(kind, "edit", parentUidForEdit, node.uid)}
        >
          {locked ? "View" : "Edit"}
        </button>
        <button
          type="button"
          className="uidai-msgrid__btn-text uidai-msgrid__btn-text--danger"
          disabled={!canMod || locked}
          title={locked ? "Baseline items cannot be deleted from a version" : ""}
          onClick={() => onDelete(kind, node.uid)}
        >
          Delete
        </button>
      </td>
    </tr>
  );
}
