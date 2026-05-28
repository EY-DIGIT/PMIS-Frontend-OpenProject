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
  approveDivision,
  rejectDivision,
  approveOwner,
  rejectOwner,
  resetWorkflow,
  classifyStep
} from "../../../utils/project/approvalWorkflow";
import { transitionActivity, WORKFLOW_ACTIONS } from "../../../api/activityWorkflow";
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
      {reason && (
        <div className="pmis-awf-target__reason">
          <b>Reason:</b> {reason}
        </div>
      )}
    </div>
  );
}

function RejectInline({ label, reasonText, onReasonChange, onCancel, onCommit, busy, embedded }) {
  return (
    <div className="pmis-awf-reject" style={embedded ? { border: "none", background: "transparent", padding: 0 } : undefined}>
      <label className="pmis-awf-reject__label">
        {label} <span style={{ color: "#9b1c1c" }}>*</span>
      </label>
      <textarea
        className="pmis-awf-reject__textarea"
        placeholder="Why is this being rejected?"
        value={reasonText}
        onChange={(e) => onReasonChange(e.target.value)}
        disabled={busy}
      />
      <div className="pmis-awf-reject__actions">
        <button
          type="button"
          className="pmis-awf-btn"
          disabled={!reasonText.trim() || busy}
          onClick={onCommit}
        >
          {busy ? "Submitting…" : "Confirm Rejection"}
        </button>
        <button
          type="button"
          className="pmis-awf-btn pmis-awf-btn--ghost"
          onClick={onCancel}
          disabled={busy}
        >
          Cancel
        </button>
      </div>
    </div>
  );
}

export default function ApprovalPanel({ activity, form, editable, onChange }) {
  const [rejection, setRejection] = useState(null);
  const [revertTo, setRevertTo] = useState("vendor");
  const [revertDivisions, setRevertDivisions] = useState([]);
  const [reasonText, setReasonText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  /* Per-target Request popup state. `kind` is 'division' or 'owner'
     while the popup is open; null when closed. */
  const [requestPopup, setRequestPopup] = useState({ open: false, kind: null });

  const state = form.approvalState || "idle";
  const isStarted = !!form.actualStartDate || !!activity.actualStartDate;
  const allTasksDone = activityTasksAllComplete(activity);
  const hasTasks = !activityHasNoTasks(activity);
  /* Workflow toolbar buttons (Mark Ready, Request Division, etc.) only
     enable once the activity has been started — the Start Activity
     banner sits in the left column and stamping actualStartDate flips
     this flag. */
  const workflowEnabled = editable && !busy && isStarted;
  const ownerName = form.ownerDivision || activity.owner || "Owner";
  const consentDivisions = safeArray(form.concernedDivision).length
    ? safeArray(form.concernedDivision)
    : safeArray(activity.consentDivisions);
  const businessId = activity.apiId || activity.uid || "";

  function apply(nextForm) {
    if (nextForm && nextForm !== form) onChange(nextForm);
  }

  function startRejection(target) {
    setRejection(target);
    setReasonText("");
    setRevertTo("vendor");
    setRevertDivisions([]);
    setError("");
  }

  function cancelRejection() {
    setRejection(null);
    setReasonText("");
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
      await transitionActivity({ businessId, action, comment });
      const next = transform();
      if (next) apply(next);
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
      /* Local-only — no API call here per the workflow spec. */
      apply(requestDivisionApproval(form, consentDivisions, payloads));
      closeRequestPopup();
    } else if (requestPopup.kind === "owner") {
      const p = payloads[0] || {};
      apply(requestOwnerApproval(form, ownerName, p));
      closeRequestPopup();
    } else if (requestPopup.kind === "resubmit") {
      /* Resubmit after rejection — fires UPDATE and then applies the
         local resubmit transition. Concatenate per-target messages into
         the comment so the backend audit log captures every note. */
      const combined = payloads
        .map((p) =>
          p && p.text && p.text.trim() ? `[${p.label}] ${p.text.trim()}` : ""
        )
        .filter(Boolean)
        .join(" | ");
      const ok = await runTransition({
        action: WORKFLOW_ACTIONS.UPDATE,
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

  const requestPopupRows = (() => {
    if (!requestPopup.open) return [];
    if (requestPopup.kind === "division" || requestPopup.kind === "resubmit") {
      return consentDivisions.map((d) => ({
        id: `div::${d}`,
        kind: "division",
        label: d
      }));
    }
    if (requestPopup.kind === "owner") {
      return [{ id: `owner::${ownerName}`, kind: "owner", label: ownerName }];
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

  function handleResubmit() {
    /* Resend after a rejection — opens the same per-target popup as
       Request Division Approval. The popup submit handler dispatches
       UPDATE (not SUBMIT) and applies the resubmit transition. */
    if (!consentDivisions.length) {
      setError("No Concerned Divisions configured — cannot resubmit.");
      return;
    }
    setError("");
    setRequestPopup({ open: true, kind: "resubmit" });
  }

  async function handleApproveDivision(divisionName) {
    await runTransition({
      action: WORKFLOW_ACTIONS.APPROVE,
      comment: `${divisionName} approved.`,
      transform: () => approveDivision(form, divisionName)
    });
  }

  async function handleApproveOwner() {
    await runTransition({
      action: WORKFLOW_ACTIONS.APPROVE,
      comment: `${ownerName} (Activity Owner) approved.`,
      transform: () => approveOwner(form, ownerName)
    });
  }

  async function commitRejection() {
    const reason = reasonText.trim();
    if (!reason) return;
    if (rejection.kind === "division") {
      const ok = await runTransition({
        action: WORKFLOW_ACTIONS.REJECT,
        comment: reason,
        transform: () => rejectDivision(form, rejection.divisionName, reason)
      });
      if (ok) cancelRejection();
    } else if (rejection.kind === "owner") {
      if (revertTo === "divisions" && !revertDivisions.length) return;
      const ok = await runTransition({
        action: WORKFLOW_ACTIONS.REJECT,
        comment: reason,
        transform: () =>
          rejectOwner(
            form,
            ownerName,
            reason,
            revertTo,
            revertTo === "divisions" ? revertDivisions : []
          )
      });
      if (ok) cancelRejection();
    }
  }

  function handleResetWorkflow() {
    if (!window.confirm("Reset the approval workflow for this activity?")) return;
    apply(resetWorkflow(form));
  }

  /* ─── Toolbar (HTML reference parity) ─── */
  const toolbarBtns = [];
  if (workflowEnabled && !rejection) {
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
          disabled={busy || !consentDivisions.length}
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
          disabled={busy || !consentDivisions.length}
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
    if (state !== "idle") {
      toolbarBtns.push(
        <button
          key="reset"
          type="button"
          className="pmis-awf-toolbar__btn pmis-awf-toolbar__btn--ghost"
          disabled={busy}
          onClick={handleResetWorkflow}
        >
          Reset Workflow
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
  } else if (editable) {
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
      ? consentDivisions.join(", ")
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
      s3Body = (
        <div className="pmis-awf-targets">
          {rows.map((r) => {
            const isPending = r.status === "pending";
            const isRejectingThis =
              rejection &&
              rejection.kind === "division" &&
              rejection.divisionName === r.division;
            const showActions =
              workflowEnabled && s3 === "active" && isPending && !isRejectingThis;
            return (
              <React.Fragment key={r.division}>
                <TargetRow
                  name={r.division}
                  status={r.status}
                  decidedAt={r.decidedAt}
                  reason={r.reason}
                  actions={
                    showActions ? (
                      <>
                        <button
                          type="button"
                          className="pmis-awf-btn"
                          disabled={busy}
                          onClick={() => handleApproveDivision(r.division)}
                        >
                          {busy ? "…" : "Approve"}
                        </button>
                        <button
                          type="button"
                          className="pmis-awf-btn pmis-awf-btn--danger"
                          disabled={busy}
                          onClick={() =>
                            startRejection({
                              kind: "division",
                              divisionName: r.division
                            })
                          }
                        >
                          Reject
                        </button>
                      </>
                    ) : null
                  }
                />
                {isRejectingThis && (
                  <RejectInline
                    label={`Rejection reason for ${r.division}`}
                    reasonText={reasonText}
                    onReasonChange={setReasonText}
                    onCancel={cancelRejection}
                    onCommit={commitRejection}
                    busy={busy}
                  />
                )}
              </React.Fragment>
            );
          })}
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
            {rj.revertDivisions.join(", ")}
          </div>
        )}
      </>
    );
  } else if (s4 === "active" && state === "division_approved") {
    s4Body = (
      <>
        All Concerned Divisions approved. Click{" "}
        <b>Request Owner Approval</b> above to forward to <b>{ownerName}</b>.
      </>
    );
  } else if (s4 === "active" && state === "pending_owner") {
    const isRejectingOwner = rejection && rejection.kind === "owner";
    s4Body = (
      <>
        Awaiting decision from <b>{ownerName}</b>.
        <div className="pmis-awf-targets">
          <TargetRow
            icon="👤"
            name={ownerName}
            status={form.ownerApproval?.status || "pending"}
            decidedAt={form.ownerApproval?.decidedAt}
            actions={
              workflowEnabled && !isRejectingOwner ? (
                <>
                  <button
                    type="button"
                    className="pmis-awf-btn"
                    disabled={busy}
                    onClick={handleApproveOwner}
                  >
                    {busy ? "…" : "Approve"}
                  </button>
                  <button
                    type="button"
                    className="pmis-awf-btn pmis-awf-btn--danger"
                    disabled={busy}
                    onClick={() => startRejection({ kind: "owner" })}
                  >
                    Reject
                  </button>
                </>
              ) : null
            }
          />
        </div>
        {isRejectingOwner && (
          <div className="pmis-awf-reject">
            <div style={{ fontWeight: 600, marginBottom: 6 }}>
              Owner Rejection — Pick Revert Target
            </div>
            <label className="pmis-awf-reject__mode">
              <input
                type="radio"
                name="revertTo"
                value="vendor"
                checked={revertTo === "vendor"}
                onChange={() => setRevertTo("vendor")}
                disabled={busy}
              />
              Revert to Vendor (full resend)
            </label>
            <label className="pmis-awf-reject__mode">
              <input
                type="radio"
                name="revertTo"
                value="divisions"
                checked={revertTo === "divisions"}
                onChange={() => setRevertTo("divisions")}
                disabled={busy}
              />
              Revert to Concerned Division(s)
            </label>
            {revertTo === "divisions" && (
              <div className="pmis-awf-reject__divlist">
                {consentDivisions.length === 0 && (
                  <div style={{ fontSize: 12, color: "#66788f" }}>
                    No concerned divisions to revert to.
                  </div>
                )}
                {consentDivisions.map((d) => (
                  <label key={d}>
                    <input
                      type="checkbox"
                      checked={revertDivisions.includes(d)}
                      disabled={busy}
                      onChange={(e) => {
                        setRevertDivisions((cur) =>
                          e.target.checked
                            ? cur.concat(d)
                            : cur.filter((x) => x !== d)
                        );
                      }}
                    />
                    {d}
                  </label>
                ))}
              </div>
            )}
            <RejectInline
              label="Rejection reason"
              reasonText={reasonText}
              onReasonChange={setReasonText}
              onCancel={cancelRejection}
              onCommit={commitRejection}
              busy={busy}
              embedded
            />
          </div>
        )}
      </>
    );
  } else if (s4 === "done") {
    s4Body = (
      <>
        {ownerName} approved on{" "}
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
        <span className="pmis-awf-panel__state">
          State: <b>{APPROVAL_STATE_LABELS[state] || state}</b>
        </span>
      </div>
      {toolbarNode}
      {error && <div className="pmis-awf-error">{error}</div>}
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
