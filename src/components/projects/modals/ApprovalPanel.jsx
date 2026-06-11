/* ══════════════════════════════════════════════════════════════════
   ApprovalPanel.jsx — Activity Approval Workflow UI wired to the
   activity-workflow service. Each action fires a transition call
   (SUBMIT / APPROVE / REJECT / UPDATE) before applying the local
   state change so the UI mirrors what the backend records.

   CSS classes live in src/styles/project/activityWorkflow.css with
   the unique `pmis-awf-` prefix so they cannot collide with any
   other module.
   ══════════════════════════════════════════════════════════════════ */

import React, { useState } from "react";
import { APPROVAL_STATE_LABELS } from "../../../utils/project/constants";
import {
  safeArray,
  activityTasksAllComplete,
  activityHasNoTasks,
  flattenActivityLeaves,
  formatDateTime
} from "../../../utils/project/helpers";
import { effectiveStatus } from "../../../utils/project/nodeUtils";
import {
  markReadyForApproval,
  requestDivisionApproval,
  requestOwnerApproval,
  resubmitAfterRejection,
  classifyStep
} from "../../../utils/project/approvalWorkflow";
import {
  transitionActivity,
  requestDivisionApprovalParallel,
  requestOwnerApprovalParallel,
  WORKFLOW_ACTIONS,
  WORKFLOW_STATES
} from "../../../api/activityWorkflow";
import { useCan } from "../../../auth/permissions";
import ApprovalRequestModal from "./ApprovalRequestModal";

function StepRow({ index, state, title, children }) {
  return (
    <div className={`pmis-awf-step pmis-awf-step--${state}`}>
      <div className="pmis-awf-step__marker">
        {state === "done" ? "✓" : state === "rejected" ? "!" : index}
      </div>
      <div className="pmis-awf-step__body">
        <div className="pmis-awf-step__title">
          {title}
          <span className={`pmis-awf-step__pill pmis-awf-step__pill--${state}`}>
            {state.replace("_", " ")}
          </span>
        </div>
        <div className="pmis-awf-step__sub">{children}</div>
      </div>
    </div>
  );
}

function TargetRow({ icon = "🏛️", name, status, decidedAt, reason, actions }) {
  const variant =
    status === "approved"
      ? "pmis-awf-target--approved"
      : status === "rejected"
      ? "pmis-awf-target--rejected"
      : "";
  return (
    <div className={`pmis-awf-target ${variant}`.trim()}>
      <span className="pmis-awf-target__name">
        {icon} {name}
        {decidedAt && (
          <span style={{ fontSize: 11, color: "#66788f", marginLeft: 6 }}>
            · {formatDateTime(decidedAt)}
          </span>
        )}
      </span>
      <span className="pmis-awf-target__status">
        <span className={`pmis-awf-status-pill pmis-awf-status-pill--${status}`}>
          {status}
        </span>
      </span>
      {actions && <span className="pmis-awf-target__actions">{actions}</span>}
      {/* Reason is only meaningful for a rejection — approvals don't carry
         (or display) a reason in the timeline. */}
      {status === "rejected" && reason && (
        <div className="pmis-awf-target__reason">
          <b>Reason:</b> {reason}
        </div>
      )}
    </div>
  );
}

/* ─── Workflow graph ───
   Ordered stages of the activity approval workflow. The current stage
   (from form.approvalState) gets a red indicator; earlier stages render
   done (green), later ones pending (grey). Shown in place of the stepper
   when the user toggles to the Graph view. */
const FLOW_STEPS = [
  { key: "start", lines: ["Start"], states: ["idle"] },
  { key: "ready", lines: ["Ready for", "Approval"], states: ["ready_for_approval"] },
  { key: "division", lines: ["Concerned", "Division"], states: ["pending_division"], reject: "division" },
  { key: "divApproved", lines: ["Divisions", "Approved"], states: ["division_approved"] },
  { key: "owner", lines: ["Owner", "Review"], states: ["pending_owner"], reject: "owner" },
  { key: "completed", lines: ["Completed"], states: ["completed"] },
];

const GRAPH_COLORS = {
  active: { fill: "#ffffff", stroke: "#d32f2f", text: "#b3261e" },
  done: { fill: "#ecf9f0", stroke: "#1a8a3d", text: "#1b6a3a" },
  todo: { fill: "#f7f9fc", stroke: "#cdd7e6", text: "#6b7890" },
};
const GREY = "#c7d0de";
const GREEN = "#1a8a3d";
const RED = "#d32f2f";

/* BPMN-style SVG diagram of the activity approval workflow. The happy
   path runs left→right; the Concerned Division and Owner stages each have
   a reject branch that converges into a "Rejected" node, which loops back
   (via "Returned to Vendor") to "Ready for Approval". The current stage and
   the path actually taken on a rejection are drawn in red. */
function WorkflowGraph({ form }) {
  const state = String((form && form.approvalState) || "idle");
  const rejection = (form && form.lastRejection) || {};
  const rejectedFrom = String(rejection.byKind || "").toLowerCase();
  /* A rejection shows in the graph as soon as ANY reviewer rejects — a
     Concerned Division voting Reject, or the Activity Owner rejecting —
     not only once the activity has fully returned to the vendor. */
  const divisionRejected = safeArray(form && form.divisionApprovals).some(
    (d) => d && String(d.status || "").toLowerCase() === "rejected"
  );
  const ownerRejected =
    String((form && form.ownerApproval && form.ownerApproval.status) || "").toLowerCase() ===
    "rejected";
  const stateRejected = state === "rejected_to_vendor";
  const isRejected = stateRejected || divisionRejected || ownerRejected;
  const rejIdx = ownerRejected || rejectedFrom === "owner" ? 4 : 2; // which stage rejected
  const activeIdx = FLOW_STEPS.findIndex((s) => s.states.includes(state));

  // ── geometry (vertical top → bottom flow) ──
  const NW = 188, NH = 46, VGAP = 30, PADX = 16, PADY = 14;
  const nx = PADX, ncx = nx + NW / 2, nRight = nx + NW;
  const ny = (i) => PADY + i * (NH + VGAP);
  const nmid = (i) => ny(i) + NH / 2;

  const isCompleted = state === "completed";
  /* When the activity is completed everything is green (success) — no red.
     Otherwise the current stage (the one it's sitting on, before completed)
     is red to indicate where it is. */
  const kindOf = (i) => {
    if (isCompleted) return "done";
    if (i === activeIdx) return "active";
    if (activeIdx >= 0 && i < activeIdx) return "done";
    return "todo";
  };

  // reject lane to the right
  const rjW = 140, rjX = nRight + 78, rjCX = rjX + rjW / 2;
  const rjY = ny(3), rjH = NH;          // Rejected node aligned with row 3
  const retY = ny(1);                    // Returned node aligned with Ready (row 1)
  const W = rjX + rjW + PADX;
  const H = ny(5) + NH + PADY;

  const Node = ({ i }) => {
    const c = GRAPH_COLORS[kindOf(i)];
    const x = nx, y = ny(i), lines = FLOW_STEPS[i].lines;
    return (
      <g>
        <rect x={x} y={y} width={NW} height={NH} rx={11} fill={c.fill} stroke={c.stroke} strokeWidth={2} />
        <text x={ncx} y={y + NH / 2} textAnchor="middle" fontSize="12.5" fontWeight="700" fill={c.text}>
          {lines.length === 1 ? (
            <tspan x={ncx} dy="0.35em">{lines[0]}</tspan>
          ) : (
            lines.map((ln, j) => (
              <tspan key={j} x={ncx} dy={j === 0 ? "-0.15em" : "1.15em"}>{ln}</tspan>
            ))
          )}
        </text>
        {i === activeIdx && !isCompleted && (
          <circle cx={x + NW - 3} cy={y + 3} r={6} fill={RED} stroke="#fff" strokeWidth={2} />
        )}
      </g>
    );
  };

  const branchOn = (i) =>
    (i === 2 && (divisionRejected || (stateRejected && rejIdx === 2))) ||
    (i === 4 && (ownerRejected || (stateRejected && rejIdx === 4)));

  const RejectBranch = ({ i }) => {
    const on = branchOn(i);
    const col = on ? RED : GREY;
    const dash = on ? "0" : "5 4";
    // elbow from stage right edge across to the reject lane, then into the
    // Rejected node (top from division, bottom from owner)
    const enterY = i === 2 ? rjY : rjY + rjH;
    const d = `M ${nRight} ${nmid(i)} H ${rjCX} V ${enterY}`;
    return (
      <g>
        <path d={d} fill="none" stroke={col} strokeWidth={2} strokeDasharray={dash}
          markerEnd={on ? "url(#awfR)" : "url(#awfG0)"} />
        <text x={nRight + 8} y={nmid(i) - 5} fontSize="10" fontWeight="700" fill={col}>Reject</text>
      </g>
    );
  };

  return (
    <div className="pmis-awf-graph">
      <div className="pmis-awf-graph__scroll">
        <svg className="pmis-awf-graph__svg" viewBox={`0 0 ${W} ${H}`} role="img"
          aria-label="Activity approval workflow diagram">
          <defs>
            {[["awfArr", GREY], ["awfArrGreen", GREEN], ["awfR", RED], ["awfG0", GREY]].map(([id, col]) => (
              <marker key={id} id={id} markerWidth="9" markerHeight="9" refX="7" refY="4.5"
                orient="auto" markerUnits="userSpaceOnUse">
                <path d="M0,0 L9,4.5 L0,9 Z" fill={col} />
              </marker>
            ))}
          </defs>

          {/* main flow connectors (vertical) */}
          {FLOW_STEPS.slice(0, -1).map((_, i) => {
            const passed = activeIdx >= 0 && i < activeIdx;
            const col = passed ? GREEN : GREY;
            return (
              <line key={`c${i}`} x1={ncx} y1={ny(i) + NH} x2={ncx} y2={ny(i + 1)}
                stroke={col} strokeWidth={2}
                markerEnd={passed ? "url(#awfArrGreen)" : "url(#awfArr)"} />
            );
          })}

          {/* reject branches (always shown; active one is red) */}
          <RejectBranch i={2} />
          <RejectBranch i={4} />

          {/* Rejected node */}
          <rect x={rjX} y={rjY} width={rjW} height={rjH} rx={rjH / 2}
            fill={isRejected ? "#fdecea" : "#fff"} stroke={isRejected ? RED : GREY}
            strokeWidth={isRejected ? 2 : 1.5} strokeDasharray={isRejected ? "0" : "5 4"} />
          <text x={rjCX} y={rjY + rjH / 2} textAnchor="middle" dominantBaseline="middle"
            fontSize="11.5" fontWeight="700" fill={isRejected ? RED : "#8a97ab"}>✕ Rejected</text>

          {isRejected && (
            <>
              {/* Rejected → Returned to Vendor (up the reject lane) */}
              <path d={`M ${rjX + 30} ${rjY} V ${retY + NH}`} fill="none" stroke={RED}
                strokeWidth={2} markerEnd="url(#awfR)" />
              {/* Returned to Vendor node */}
              <rect x={rjX} y={retY} width={rjW} height={NH} rx={10}
                fill="#fdecea" stroke={RED} strokeWidth={2} />
              <text x={rjCX} y={retY + NH / 2} textAnchor="middle" dominantBaseline="middle"
                fontSize="11" fontWeight="700" fill={RED}>
                <tspan x={rjCX} dy="-0.15em">Returned to Vendor</tspan>
                <tspan x={rjCX} dy="1.2em" fontWeight="500">Resubmit required</tspan>
              </text>
              {/* Returned to Vendor → loop back to Ready for Approval */}
              <line x1={rjX} y1={nmid(1)} x2={nRight} y2={nmid(1)} stroke={RED}
                strokeWidth={2} strokeDasharray="5 4" markerEnd="url(#awfR)" />
              <text x={(rjX + nRight) / 2} y={nmid(1) - 6} textAnchor="middle"
                fontSize="10" fontWeight="700" fill={RED}>Resubmit</text>
            </>
          )}

          {/* stage nodes on top */}
          {FLOW_STEPS.map((s, i) => <Node key={s.key} i={i} />)}
        </svg>
      </div>

      <div className="pmis-awf-graph__legend">
        <span><i className="pmis-awf-graph__sw pmis-awf-graph__sw--done" /> Completed</span>
        <span><i className="pmis-awf-graph__sw pmis-awf-graph__sw--active" /> Current</span>
        <span><i className="pmis-awf-graph__sw pmis-awf-graph__sw--todo" /> Pending</span>
        <span><i className="pmis-awf-graph__sw pmis-awf-graph__sw--reject" /> Rejection path</span>
      </div>
    </div>
  );
}

export default function ApprovalPanel({ activity, form, editable, divisions, onChange, onTransition, projectId }) {
  const [busy, setBusy] = useState(false);
  const [view, setView] = useState("steps");
  const [error, setError] = useState("");
  /* Per-target Request popup state. `kind` is 'division' or 'owner'
     while the popup is open; null when closed. */
  const [requestPopup, setRequestPopup] = useState({ open: false, kind: null });

  const state = form.approvalState || "idle";
  const isStarted = !!form.actualStartDate || !!activity.actualStartDate;
  const allTasksDone = activityTasksAllComplete(activity);
  const hasTasks = !activityHasNoTasks(activity);
  /* Mark Ready / Request Division / Request Owner / Resend are gated on
     the submitActivityForApproval permission (granted to super_admin,
     org_admin, project_admin only) — NOT on the form's editable flag.
     This lets org_admin / project_admin drive the workflow even though
     they can't edit the activity's fields. The activity also has to be
     started (actualStartDate stamped) so the Start banner gates buttons
     until the work has actually begun. */
  const canSubmitForApproval = useCan('submitActivityForApproval');
  const workflowEnabled = canSubmitForApproval && !busy && isStarted;
  const ownerName = form.ownerDivision || activity.owner || "Owner";
  const consentDivisions = safeArray(form.concernedDivision).length
    ? safeArray(form.concernedDivision)
    : safeArray(activity.consentDivisions);
  const businessId = activity.apiId || activity.uid || "";

  /* Map a division code to its friendly name using the divisions master
     list; falls back to the code itself when no match is found. */
  const divisionName = (code) => {
    const c = String(code || "").toLowerCase();
    const match = safeArray(divisions).find(
      (d) => String(d.code || "").toLowerCase() === c
    );
    return (match && (match.label || match.name)) || code;
  };
  /* Display label for the Activity Owner division — ownerName is the
     owner division code, so resolve it to the friendly name for the UI
     (the raw code is still used for the workflow payload). */
  const ownerLabel = divisionName(ownerName);

  function apply(nextForm) {
    if (nextForm && nextForm !== form) onChange(nextForm);
  }

  async function runTransition({ action, comment, transform }) {
    if (!businessId) {
      setError(
        "Activity has no server id yet — save the activity first, then trigger the workflow."
      );
      return false;
    }
    setBusy(true);
    setError("");
    try {
      await transitionActivity({
        activityId: businessId,
        projectId,
        action,
        comment
      });
      const next = transform();
      if (next) apply(next);
      /* Tell the parent to re-fetch the process-instance audit so the
         trail + timeline reflect the new state. */
      if (typeof onTransition === "function") onTransition();
      return true;
    } catch (err) {
      setError(err && err.message ? err.message : `Workflow ${action} failed.`);
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function handleMarkReady() {
    /* Fires SUBMIT on the workflow service AND moves the local state to
       ready_for_approval. The backend gets a heads-up at this step; the
       subsequent Request Division Approval click will follow up with the
       per-division dispatch. */
    await runTransition({
      action: WORKFLOW_ACTIONS.SUBMIT,
      comment: "Activity marked Ready for Approval.",
      transform: () => markReadyForApproval(form, "manual")
    });
  }

  function handleRequestDivision() {
    /* Open per-target popup. Each Concerned Division gets its own
       comment + attachments row so the audit trail records exactly
       what each reviewer was sent. Backend isn't called here — Mark
       Ready already SUBMITted; the individual APPROVE / REJECT calls
       drive the next state changes. */
    if (!consentDivisions.length) {
      setError(
        "Add at least one Concerned Division to the activity before submitting."
      );
      return;
    }
    setError("");
    setRequestPopup({ open: true, kind: "division" });
  }

  function handleRequestOwner() {
    /* Same pattern as division — a single-row popup for the Activity
       Owner. Local only; backend auto-progresses on the last division's
       APPROVE call. */
    setError("");
    setRequestPopup({ open: true, kind: "owner" });
  }

  function closeRequestPopup() {
    setRequestPopup({ open: false, kind: null });
  }

  async function submitRequestPopup(payloads) {
    if (requestPopup.kind === "division") {
      /* Fire the parallel request-division-approval multipart call so
         the backend seeds an approver row for each Concerned Division.
         The endpoint accepts a single attachment + a single comment;
         we concatenate per-row notes and forward the first raw File
         the user attached on any row. */
      if (!businessId) {
        setError(
          "Activity has no server id yet — save the activity first, then trigger the workflow."
        );
        return;
      }
      if (!projectId) {
        setError("Missing project id — cannot dispatch division approval request.");
        return;
      }
      const combined = payloads
        .map((p) => (p && p.text && p.text.trim() ? p.text.trim() : ""))
        .filter(Boolean)
        .join(" | ");
      const firstFile = (() => {
        for (const p of payloads) {
          const files = (p && p.files) || [];
          for (const f of files) {
            if (f && f.raw) return f.raw;
          }
        }
        return null;
      })();
      setBusy(true);
      setError("");
      try {
        await requestDivisionApprovalParallel({
          activityId: businessId,
          projectId,
          stateName: WORKFLOW_STATES.PENDING_AT_CONCERNED_DIVISION,
          comment: combined || "Please review the activity submission.",
          file: firstFile
        });
        apply(requestDivisionApproval(form, consentDivisions, payloads));
        if (typeof onTransition === "function") onTransition();
        closeRequestPopup();
      } catch (err) {
        setError(err && err.message ? err.message : "Failed to dispatch division approval request.");
      } finally {
        setBusy(false);
      }
    } else if (requestPopup.kind === "owner") {
      /* Fire the parallel request-owner-approval multipart call so the
         backend hands the activity off to the Activity Owner stage. */
      if (!businessId) {
        setError(
          "Activity has no server id yet — save the activity first, then trigger the workflow."
        );
        return;
      }
      if (!projectId) {
        setError("Missing project id — cannot dispatch owner approval request.");
        return;
      }
      const p = payloads[0] || {};
      const note = (p && p.text && p.text.trim()) || "";
      const firstFile = (() => {
        const files = (p && p.files) || [];
        for (const f of files) {
          if (f && f.raw) return f.raw;
        }
        return null;
      })();
      setBusy(true);
      setError("");
      try {
        await requestOwnerApprovalParallel({
          activityId: businessId,
          projectId,
          stateName: WORKFLOW_STATES.PENDING_AT_OWNER_DIVISION,
          comment: note || "All divisions approved. Forwarding for owner review.",
          file: firstFile
        });
        apply(requestOwnerApproval(form, ownerName, p));
        if (typeof onTransition === "function") onTransition();
        closeRequestPopup();
      } catch (err) {
        setError(err && err.message ? err.message : "Failed to dispatch owner approval request.");
      } finally {
        setBusy(false);
      }
    } else if (requestPopup.kind === "resubmit") {
      /* Resubmit after rejection — fires SUBMIT and then applies the
         local resubmit transition. Concatenate per-target messages into
         the comment so the backend audit log captures every note. */
      const combined = payloads
        .map((p) =>
          p && p.text && p.text.trim() ? `[${p.label}] ${p.text.trim()}` : ""
        )
        .filter(Boolean)
        .join(" | ");
      const ok = await runTransition({
        action: WORKFLOW_ACTIONS.SUBMIT,
        comment: combined || "Activity re-submitted after rejection.",
        transform: () => {
          /* Reuse the per-target comment-emit path so each reviewer sees
             their own message + attachments after the resend. */
          const next = resubmitAfterRejection(form, consentDivisions);
          return requestDivisionApprovalPayloadOverlay(next, payloads);
        }
      });
      if (ok) closeRequestPopup();
    }
  }

  /* Helper: after resubmitAfterRejection has reset the state, replace the
     bulk system comment it emitted with per-target ones so the audit trail
     matches the rich popup data. Implemented inline to keep the workflow
     helper signatures backward-compatible. */
  function requestDivisionApprovalPayloadOverlay(nextForm, payloads) {
    if (!Array.isArray(payloads) || payloads.length === 0) return nextForm;
    const comments = (nextForm.comments || []).slice();
    /* Drop the single combined comment requestDivisionApproval/resubmit
       added so we can replace it with per-target rows. Identified by
       systemType='request' & approvalStage='division' and most recent. */
    const idx = comments.findIndex(
      (c) =>
        c &&
        c.kind === "system" &&
        c.systemType === "request" &&
        c.approvalStage === "division" &&
        !c.approvalTarget
    );
    if (idx >= 0) comments.splice(idx, 1);
    payloads.forEach((p) => {
      const text = String((p && p.text) || "").trim();
      comments.unshift({
        kind: "system",
        when: new Date().toISOString(),
        who: "System",
        text: `Approval request re-sent to Division: ${p.label}.${
          text ? " Message: " + text : ""
        }`,
        systemType: "request",
        approvalStage: "division",
        approvalTarget: p.label,
        approvalTargetKind: "division",
        attachments: Array.isArray(p.files) ? p.files : []
      });
    });
    return { ...nextForm, comments };
  }

  /* Divisions that have already approved — they don't need to re-review on
     a resend, so they're excluded from the request popup (only the
     pending / rejected divisions get a comment + attachment row). */
  const approvedDivisionCodes = new Set(
    safeArray(form.divisionApprovals)
      .filter((d) => d && String(d.status || "").toLowerCase() === "approved")
      .map((d) => String(d.division || "").toLowerCase())
  );

  const requestPopupRows = (() => {
    if (!requestPopup.open) return [];
    if (requestPopup.kind === "division" || requestPopup.kind === "resubmit") {
      const pending = consentDivisions.filter(
        (d) => !approvedDivisionCodes.has(String(d).toLowerCase())
      );
      // If every division somehow already approved, fall back to the full
      // list so the popup is never empty.
      return (pending.length ? pending : consentDivisions).map((d) => ({
        id: `div::${d}`,
        kind: "division",
        label: divisionName(d)
      }));
    }
    if (requestPopup.kind === "owner") {
      return [{ id: `owner::${ownerName}`, kind: "owner", label: ownerLabel }];
    }
    return [];
  })();
  const requestPopupTitle =
    requestPopup.kind === "owner"
      ? "Request Activity Owner Approval"
      : requestPopup.kind === "resubmit"
      ? "Resend for Approval"
      : "Request Concerned Division Approval";
  const requestPopupSubtitle = (() => {
    const actName = activity.name || activity.id || "";
    if (requestPopup.kind === "owner") {
      return `Activity: ${actName}. Add a comment and/or attachments for the activity owner, then click Send Request.`;
    }
    if (requestPopup.kind === "resubmit") {
      return `Activity: ${actName}. Update each reviewer's message and attachments, then click Send Request to re-dispatch.`;
    }
    return `Activity: ${actName}. Add a comment and/or attachments for each reviewer separately, then click Send Request.`;
  })();

  async function handleResubmit() {
    /* Resend after a rejection — fires SUBMIT directly (no popup), just
       like Mark Ready for Approval, and applies the local resubmit
       transition. */
    if (!consentDivisions.length) {
      setError("No Concerned Divisions configured — cannot resubmit.");
      return;
    }
    await runTransition({
      action: WORKFLOW_ACTIONS.SUBMIT,
      comment: "Activity re-submitted after rejection.",
      transform: () => resubmitAfterRejection(form, consentDivisions)
    });
  }

  /* Division Approve/Reject and Owner Approve/Reject are NOT issued from
     this panel anymore — those decisions live on the Concerned Division
     and Activity Owner inbox review pages. The timeline shows status
     only; resubmit after a rejection is still driven from here. */

  /* ─── Toolbar (HTML reference parity) ─── */
  const toolbarBtns = [];
  if (workflowEnabled) {
    if (state === "idle" && allTasksDone) {
      toolbarBtns.push(
        <button
          key="ready"
          type="button"
          className="pmis-awf-toolbar__btn"
          disabled={busy}
          onClick={handleMarkReady}
        >
          {busy ? "Submitting…" : "Mark Ready for Approval"}
        </button>
      );
    } else if (state === "ready_for_approval") {
      toolbarBtns.push(
        <button
          key="req-div"
          type="button"
          className="pmis-awf-toolbar__btn"
          disabled={busy}
          onClick={handleRequestDivision}
        >
          Request Division Approval
        </button>
      );
    } else if (state === "rejected_to_vendor") {
      toolbarBtns.push(
        <button
          key="resubmit"
          type="button"
          className="pmis-awf-toolbar__btn"
          disabled={busy}
          onClick={handleResubmit}
        >
          {busy ? "Submitting…" : "Resend for Approval"}
        </button>
      );
    } else if (state === "division_approved") {
      toolbarBtns.push(
        <button
          key="req-owner"
          type="button"
          className="pmis-awf-toolbar__btn"
          disabled={busy}
          onClick={handleRequestOwner}
        >
          Request Owner Approval
        </button>
      );
    }
  }

  let toolbarNode = null;
  if (toolbarBtns.length) {
    toolbarNode = <div className="pmis-awf-toolbar">{toolbarBtns}</div>;
  } else if (state === "completed") {
    toolbarNode = (
      <div className="pmis-awf-toolbar pmis-awf-toolbar--empty" style={{ color: "#1b7a42" }}>
        Workflow complete.
      </div>
    );
  } else if (!isStarted) {
    toolbarNode = (
      <div className="pmis-awf-toolbar pmis-awf-toolbar--empty">
        🔒 Click <b>▶ Start Activity</b> on the left to enable approval actions.
      </div>
    );
  } else if (state === "idle" && hasTasks && !allTasksDone) {
    toolbarNode = (
      <div className="pmis-awf-toolbar pmis-awf-toolbar--empty">
        Complete every task before submitting for approval.
      </div>
    );
  } else if (state === "pending_division") {
    toolbarNode = (
      <div className="pmis-awf-toolbar pmis-awf-toolbar--empty">
        Awaiting Concerned Division decisions — approve or reject from the rows below.
      </div>
    );
  } else if (state === "pending_owner") {
    toolbarNode = (
      <div className="pmis-awf-toolbar pmis-awf-toolbar--empty">
        Awaiting Activity Owner decision — approve or reject from the row below.
      </div>
    );
  } else if (canSubmitForApproval) {
    toolbarNode = (
      <div className="pmis-awf-toolbar pmis-awf-toolbar--empty">
        No actions available at this stage.
      </div>
    );
  }

  /* ─── Step bodies ─── */
  const s1 = classifyStep("tasks", form, allTasksDone, hasTasks);
  const s2 = classifyStep("ready", form, allTasksDone, hasTasks);
  const s3 = classifyStep("division", form, allTasksDone, hasTasks);
  const s4 = classifyStep("owner", form, allTasksDone, hasTasks);
  const s5 = classifyStep("done", form, allTasksDone, hasTasks);

  let s1Body;
  if (!hasTasks) {
    s1Body =
      s1 === "active"
        ? "No tasks under this activity — you can start the workflow directly."
        : "No tasks required.";
  } else if (s1 === "done") {
    s1Body = "All tasks under this activity are complete.";
  } else {
    const leaves = flattenActivityLeaves(activity);
    const done = leaves.filter((n) => effectiveStatus(n) === "Completed").length;
    s1Body = (
      <>
        Complete every task / sub-task before submitting.
        <div className="pmis-awf-step__meta">
          {done} of {leaves.length} tasks / sub-tasks completed.
        </div>
      </>
    );
  }

  let s2Body;
  if (s2 === "done") {
    s2Body = "Activity is in the approval workflow.";
  } else if (s2 === "active") {
    const targets = consentDivisions.length
      ? consentDivisions.map(divisionName).join(", ")
      : "(no targets — add Concerned Divisions on the activity)";
    s2Body = (
      <>
        {state === "rejected_to_vendor" && form.lastRejection && (
          <div className="pmis-awf-resend-banner">
            <b>⟲ Returned to vendor</b> by{" "}
            <b>{form.lastRejection.byName || "reviewer"}</b>. Reason:{" "}
            <i>{form.lastRejection.reason || "—"}</i>
          </div>
        )}
        {state === "idle" && (
          <>Click <b>Mark Ready for Approval</b> above to enter the workflow. Will route to: <b>{targets}</b>.</>
        )}
        {state === "ready_for_approval" && (
          <>Click <b>Request Division Approval</b> above to submit. Will route to: <b>{targets}</b>.</>
        )}
        {state === "rejected_to_vendor" && (
          <>Click <b>Resend for Approval</b> above to re-route to: <b>{targets}</b>.</>
        )}
      </>
    );
  } else {
    s2Body = "Pending — complete tasks first.";
  }

  let s3Body;
  if (s3 === "future") {
    s3Body = "Pending — will activate after the activity is submitted.";
  } else {
    const rows = safeArray(form.divisionApprovals);
    if (rows.length) {
      /* Division Approve/Reject is now driven from the Concerned-Division
         reviewer's inbox page — the timeline shows status only. */
      s3Body = (
        <div className="pmis-awf-targets">
          {rows.map((r) => (
            <TargetRow
              key={r.division}
              name={divisionName(r.division)}
              status={r.status}
              decidedAt={r.decidedAt}
              reason={r.reason}
            />
          ))}
        </div>
      );
    } else if (state === "rejected_to_vendor" && form.lastRejection?.byKind === "division") {
      s3Body = (
        <>
          <b>Rejected by {form.lastRejection.byName || "reviewer"}:</b>{" "}
          {form.lastRejection.reason || ""}
        </>
      );
    } else {
      s3Body = "No reviewers yet.";
    }
  }

  let s4Body;
  if (s4 === "future") {
    s4Body = "Pending — will activate after all Concerned Divisions approve.";
  } else if (s4 === "rejected") {
    const rj = form.lastRejection || {};
    s4Body = (
      <>
        <b>Rejected by {rj.byName || "Owner"}:</b> {rj.reason || ""}
        {rj.revertTo === "vendor" && (
          <div className="pmis-awf-step__meta">
            <b>Reverted to:</b> Vendor (full resend required)
          </div>
        )}
        {rj.revertTo === "divisions" && safeArray(rj.revertDivisions).length > 0 && (
          <div className="pmis-awf-step__meta">
            <b>Reverted to Concerned Division(s):</b>{" "}
            {rj.revertDivisions.map(divisionName).join(", ")}
          </div>
        )}
      </>
    );
  } else if (s4 === "active" && state === "division_approved") {
    s4Body = (
      <>
        All Concerned Divisions approved. Click{" "}
        <b>Request Owner Approval</b> above to forward to <b>{ownerLabel}</b>.
      </>
    );
  } else if (s4 === "active" && state === "pending_owner") {
    /* Owner Approve/Reject is now driven from the Activity Owner inbox
       page — the timeline shows the pending owner row, status only. */
    s4Body = (
      <>
        Awaiting decision from <b>{ownerLabel}</b>.
        <div className="pmis-awf-targets">
          <TargetRow
            icon="👤"
            name={ownerLabel}
            status={form.ownerApproval?.status || "pending"}
            decidedAt={form.ownerApproval?.decidedAt}
          />
        </div>
      </>
    );
  } else if (s4 === "done") {
    s4Body = (
      <>
        {ownerLabel} approved on{" "}
        <b>{formatDateTime(form.ownerApproval?.decidedAt || "")}</b>.
      </>
    );
  } else {
    s4Body = "Pending.";
  }

  const s5Body =
    s5 === "done" ? (
      <>
        Activity Completed on{" "}
        <b>{formatDateTime(form.ownerApproval?.decidedAt || "")}</b>.
      </>
    ) : (
      "Pending."
    );

  return (
    <div className="pmis-awf-panel pmis-awf-scope">
      <div className="pmis-awf-panel__head">
        <h4>Activity Approval Workflow</h4>
        <div className="pmis-awf-viewtoggle">
          <button
            type="button"
            className={`pmis-awf-viewtoggle__btn${view === "steps" ? " is-active" : ""}`}
            onClick={() => setView("steps")}
          >
            Steps
          </button>
          <button
            type="button"
            className={`pmis-awf-viewtoggle__btn${view === "graph" ? " is-active" : ""}`}
            onClick={() => setView("graph")}
          >
            Graph
          </button>
        </div>
        <button
          type="button"
          className="pmis-awf-refresh"
          title="Refresh workflow"
          disabled={busy}
          onClick={() => { if (typeof onTransition === "function") onTransition(); }}
        >
          ↻ Refresh
        </button>
        <span className="pmis-awf-panel__state">
          State: <b>{APPROVAL_STATE_LABELS[state] || state}</b>
        </span>
      </div>
      {toolbarNode}
      {error && <div className="pmis-awf-error">{error}</div>}
      {view === "graph" ? (
        <WorkflowGraph form={form} />
      ) : (
      <div className="pmis-awf-stepper">
        <StepRow index={1} state={s1} title={hasTasks ? "Tasks Completed" : "No Tasks Required"}>
          {s1Body}
        </StepRow>
        <StepRow index={2} state={s2} title="Ready for Approval">
          {s2Body}
        </StepRow>
        <StepRow index={3} state={s3} title="Concerned Division Review">
          {s3Body}
        </StepRow>
        <StepRow index={4} state={s4} title="Activity Owner Review">
          {s4Body}
        </StepRow>
        <StepRow index={5} state={s5} title="Activity Completed">
          {s5Body}
        </StepRow>
      </div>
      )}
      <ApprovalRequestModal
        open={requestPopup.open}
        title={requestPopupTitle}
        subtitle={requestPopupSubtitle}
        rows={requestPopupRows}
        submitting={busy}
        error={error}
        onSubmit={submitRequestPopup}
        onClose={closeRequestPopup}
      />
    </div>
  );
}
