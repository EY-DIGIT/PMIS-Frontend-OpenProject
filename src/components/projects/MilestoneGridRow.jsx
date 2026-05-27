/* ══════════════════════════════════════════════════════════════════
   src/components/projects/MilestoneGridRow.jsx

   One row in the milestones/activities/tasks/subtasks grid.
   Shown as <tr> inside a table rendered by MilestoneConfigPage.
   ══════════════════════════════════════════════════════════════════ */

import React from "react";
import { safeArray, formatDateDisplay, formatINR } from "../../utils/project/helpers";
import { effectiveStatus } from "../../utils/project/nodeUtils";
import { APPROVAL_STATE_LABELS } from "../../utils/project/constants";

function CategoryPill({ node }) {
  const cat = node && node.category;
  if (!cat || cat === "original") return null;
  if (cat === "asg") {
    return (
      <span
        title="Annual Strategic Goal"
        style={{
          marginLeft: 6,
          padding: "1px 7px",
          fontSize: 10,
          fontWeight: 700,
          borderRadius: 999,
          background: "#dbeafe",
          color: "#1e40af",
          letterSpacing: 0.2
        }}
      >
        ASG
      </span>
    );
  }
  if (cat === "ccn") {
    const v = Number(node.ccnValue) || 0;
    return (
      <span
        title={`Change Control Note — ${formatINR(v)}`}
        style={{
          marginLeft: 6,
          padding: "1px 7px",
          fontSize: 10,
          fontWeight: 700,
          borderRadius: 999,
          background: "#fee2e2",
          color: "#9b1c1c",
          letterSpacing: 0.2
        }}
      >
        CCN · {formatINR(v)}
      </span>
    );
  }
  return null;
}

const APPROVAL_BADGE_COLOR = {
  idle: { bg: "#eef1f6", fg: "#66788f" },
  ready_for_approval: { bg: "#fff3cd", fg: "#8a6d10" },
  pending_division: { bg: "#fff3cd", fg: "#8a6d10" },
  division_approved: { bg: "#e0f2fe", fg: "#075985" },
  pending_owner: { bg: "#fff3cd", fg: "#8a6d10" },
  completed: { bg: "#dff5e1", fg: "#1d6b3a" },
  rejected_to_vendor: { bg: "#fde2e2", fg: "#9b1c1c" }
};

function ApprovalStateBadge({ node, kind }) {
  if (kind !== "activity") return null;
  const state = node && node.approvalState;
  if (!state || state === "idle") return null;
  const c = APPROVAL_BADGE_COLOR[state] || APPROVAL_BADGE_COLOR.idle;
  return (
    <span
      title={`Approval: ${APPROVAL_STATE_LABELS[state] || state}`}
      style={{
        marginLeft: 6,
        padding: "1px 7px",
        fontSize: 10,
        fontWeight: 600,
        borderRadius: 999,
        background: c.bg,
        color: c.fg
      }}
    >
      {APPROVAL_STATE_LABELS[state] || state}
    </span>
  );
}

export default function MilestoneGridRow({
  r,
  project,
  depMap,
  canMod,
  perms = {},
  showStatusCol,
  isOnboarding,
  priorityLabels = {},
  onToggle,
  onAddChild,
  onEdit,
  onDelete,
  onTrack
}) {
  // Per-action role gates. When `perms` isn't supplied (older callers)
  // every action is treated as allowed so existing behavior is preserved.
  const allowAdd = (k) =>
    perms[`create${k.charAt(0).toUpperCase()}${k.slice(1)}`] !== false;
  const allowEdit = (k) =>
    perms[`edit${k.charAt(0).toUpperCase()}${k.slice(1)}`] !== false;
  const allowDelete = (k) =>
    perms[`delete${k.charAt(0).toUpperCase()}${k.slice(1)}`] !== false;
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

  /* Render Depends On from the loaded tree's displayCode whenever
     possible. depMap is now keyed by uid / apiId / displayCode so any
     identifier the API or the picker happens to leave on dependsOn
     resolves to the target node's WBS code. Falls back to whatever
     dependsOnDisplay the API put on the row. */
  const fromDependsOn = safeArray(node.dependsOn)
    .map((v) => {
      const hit = depMap[v];
      if (hit && hit.id) return { id: hit.id, name: hit.name };
      // Last resort: if the value itself looks like a display code
      // ("M1" / "A1.2" / etc.) just render it.
      return typeof v === "string" && /^[MATS][\d.]*$/.test(v) ? { id: v, name: "" } : null;
    })
    .filter(Boolean);
  const fromDisplay = safeArray(node.dependsOnDisplay).map((id) => ({ id, name: "" }));
  const deps = fromDependsOn.length ? fromDependsOn : fromDisplay;

  const typeLabel =
    kind === "milestone" ? "Milestone" :
    kind === "activity" ? "Activity" :
    kind === "task" ? "Task" :
    kind === "subtask" ? "Sub Task" :
    "";

  // Tasks and Sub Tasks only appear once the project is published —
  // their + buttons are hidden entirely until then. Activities under a
  // milestone stay always-visible because they're added during onboarding.
  const isProjectPublished = project && project.status === "PUBLISHED";
  const showTaskAdds = isOnboarding || isProjectPublished;

  let addChildBtn = null;
  if (canMod) {
    if (kind === "milestone" && allowAdd("activity")) {
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
    } else if (kind === "activity" && !isOnboarding && showTaskAdds && allowAdd("task")) {
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
    } else if ((kind === "task" || kind === "subtask") && !isOnboarding && showTaskAdds && allowAdd("subtask")) {
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

  const rowClass = `uidai-msgrid__row--${kind}`;

  const parentUidForEdit =
    r.milestoneUid || r.activityUid || r.parentTaskUid || "";

  /* ─── Priority resolution ───
     The backend has shipped this field in a few different shapes over
     time. We accept all of them and fall through to the safest render
     we can produce:

       string  : "p1"                           → label map ("High") or "P1"
       object  : { code: "p1", name: "High" }   → name
       object  : { priorityCode, priorityName } → priorityName
       object  : { id, label }                  → label
       object  : { value, name }                → name

     Also: priorityLabels is now indexed by *lowercased* code, so case
     differences between the API and the master ("p1" vs "P1") no
     longer cause the label to vanish. */
  function resolvePriorityDisplay(raw) {
    if (raw == null || raw === "") return "";

    let code = "";
    let inlineName = "";

    if (typeof raw === "string") {
      code = raw;
    } else if (typeof raw === "object") {
      code =
        raw.code ||
        raw.priorityCode ||
        raw.id ||
        raw.value ||
        "";
      inlineName =
        raw.name ||
        raw.priorityName ||
        raw.label ||
        raw.displayName ||
        "";
    }

    if (inlineName) return inlineName;
    if (!code) return "";

    const key = String(code).toLowerCase();
    if (priorityLabels[key]) return priorityLabels[key];
    return String(code).toUpperCase();
  }
  const priorityDisplay = resolvePriorityDisplay(node.priority);

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
          <CategoryPill node={node} />
          <ApprovalStateBadge node={node} kind={kind} />
          {addChildBtn}
        </div>
      </td>
      <td className="uidai-msgrid__cell">
        {typeLabel ? <span className="uidai-type-tag">{typeLabel}</span> : null}
      </td>
      <td className="uidai-msgrid__cell" style={{ textAlign: "center" }}>
        {priorityDisplay}
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
        {(() => {
          if (kind === "milestone" && node.vendor) {
            return <span className="uidai-vendor-tag">{node.vendor}</span>;
          }
          if (kind === "activity" && node.vendorId) {
            const list = safeArray(project && project.vendors);
            const found = list.find(
              (v) =>
                v &&
                (v.id === node.vendorId ||
                  v.vendorId === node.vendorId ||
                  v.uuid === node.vendorId)
            );
            const name = found ? (found.vendorName || found.name || "") : "";
            if (name) return <span className="uidai-vendor-tag">{name}</span>;
          }
          return null;
        })()}
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
        {allowEdit(kind) ? (
          <button
            type="button"
            className="uidai-msgrid__btn-text"
            onClick={() => onEdit(kind, "edit", parentUidForEdit, node.uid)}
          >
            Edit
          </button>
        ) : (
          !isOnboarding && (
            <button
              type="button"
              className="uidai-msgrid__btn-text"
              onClick={() => onEdit(kind, "view", parentUidForEdit, node.uid)}
            >
              View
            </button>
          )
        )}
        {allowDelete(kind) && (
          <button
            type="button"
            className="uidai-msgrid__btn-text uidai-msgrid__btn-text--danger"
            disabled={!canMod}
            onClick={() => onDelete(kind, node.uid)}
          >
            Delete
          </button>
        )}
      </td>
    </tr>
  );
}