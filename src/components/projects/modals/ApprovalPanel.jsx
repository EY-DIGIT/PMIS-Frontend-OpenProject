/* ══════════════════════════════════════════════════════════════════
   ApprovalPanel.jsx — Activity Approval Workflow UI wired to the
   activity-workflow service. Each action fires a transition call
   (SUBMIT / APPROVE / REJECT / UPDATE) before applying the local
   state change so the UI mirrors what the backend records.

   Action → API mapping:
     • Start Activity     → SUBMIT  (stamps actualStartDate too)
     • Division Approve   → APPROVE
     • Division Reject    → REJECT  (rejection reason becomes the comment)
     • Owner Approve      → APPROVE
     • Owner Reject       → REJECT
     • Resubmit (vendor)  → UPDATE
     • Reset Workflow     → no API call (admin-only local nuke)
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
  startActivity,
  resubmitAfterRejection,
  approveDivision,
  rejectDivision,
  approveOwner,
  rejectOwner,
  resetWorkflow,
  classifyStep
} from "../../../utils/project/approvalWorkflow";
import { transitionActivity, WORKFLOW_ACTIONS } from "../../../api/activityWorkflow";

const STEP_PILL_STYLE = {
  display: "inline-block",
  fontSize: 11,
  fontWeight: 600,
  padding: "2px 8px",
  borderRadius: 999,
  marginLeft: 8,
  textTransform: "capitalize"
};

const STEP_PILL_COLOR = {
  future: { bg: "#eef1f6", fg: "#66788f" },
  active: { bg: "#fff3cd", fg: "#8a6d10" },
  done: { bg: "#dff5e1", fg: "#1d6b3a" },
  rejected: { bg: "#fde2e2", fg: "#9b1c1c" }
};

function stepPill(state) {
  const c = STEP_PILL_COLOR[state] || STEP_PILL_COLOR.future;
  return (
    <span style={{ ...STEP_PILL_STYLE, background: c.bg, color: c.fg }}>
      {state.replace("_", " ")}
    </span>
  );
}

function stepMarker(state, index) {
  const c = STEP_PILL_COLOR[state] || STEP_PILL_COLOR.future;
  return (
    <div
      style={{
        width: 28,
        height: 28,
        borderRadius: "50%",
        background: c.bg,
        color: c.fg,
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        fontWeight: 700,
        fontSize: 13,
        flex: "none",
        marginRight: 10
      }}
    >
      {state === "done" ? "✓" : state === "rejected" ? "!" : index}
    </div>
  );
}

function StepRow({ index, state, title, children }) {
  return (
    <div style={{ display: "flex", alignItems: "flex-start", padding: "10px 0" }}>
      {stepMarker(state, index)}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontWeight: 600, color: "#1f2a44" }}>
          {title}
          {stepPill(state)}
        </div>
        <div style={{ fontSize: 13, color: "#42526e", marginTop: 4 }}>
          {children}
        </div>
      </div>
    </div>
  );
}

function TargetRow({ name, status, decidedAt, reason, actions }) {
  const pillBg =
    status === "approved" ? "#dff5e1" :
    status === "rejected" ? "#fde2e2" : "#fff3cd";
  const pillFg =
    status === "approved" ? "#1d6b3a" :
    status === "rejected" ? "#9b1c1c" : "#8a6d10";
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        padding: "6px 10px",
        margin: "4px 0",
        background: "#f8fafc",
        border: "1px solid #e6ebf2",
        borderRadius: 6,
        gap: 8,
        flexWrap: "wrap"
      }}
    >
      <span style={{ fontWeight: 500 }}>
        🏛️ {name}
        {decidedAt && (
          <span style={{ fontSize: 11, color: "#66788f", marginLeft: 6 }}>
            · {formatDateTime(decidedAt)}
          </span>
        )}
      </span>
      <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
        <span style={{ ...STEP_PILL_STYLE, background: pillBg, color: pillFg, marginLeft: 0 }}>
          {status}
        </span>
        {actions}
      </span>
      {reason && (
        <div style={{ flexBasis: "100%", fontSize: 12, color: "#9b1c1c", marginTop: 4 }}>
          <b>Reason:</b> {reason}
        </div>
      )}
    </div>
  );
}

function RejectInline({ label, reasonText, onReasonChange, onCancel, onCommit, busy, embedded }) {
  const wrapStyle = embedded
    ? { marginTop: 6 }
    : {
        border: "1px solid #fcd6d6",
        background: "#fff5f5",
        padding: 10,
        borderRadius: 6,
        marginTop: 6
      };
  return (
    <div style={wrapStyle}>
      <label style={{ display: "block", fontSize: 13, fontWeight: 500, marginBottom: 4 }}>
        {label} <span style={{ color: "#9b1c1c" }}>*</span>
      </label>
      <textarea
        className="uidai-textarea"
        style={{ minHeight: 50, width: "100%" }}
        placeholder="Why is this being rejected?"
        value={reasonText}
        onChange={(e) => onReasonChange(e.target.value)}
        disabled={busy}
      />
      <div style={{ marginTop: 6, display: "flex", gap: 6 }}>
        <button
          type="button"
          className="uidai-btn"
          disabled={!reasonText.trim() || busy}
          onClick={onCommit}
        >
          {busy ? "Submitting…" : "Confirm Rejection"}
        </button>
        <button
          type="button"
          className="uidai-btn uidai-btn--cancel"
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
  /* Inline rejection composer state. `rejection.kind` is 'division' | 'owner'
     and (for division) `rejection.divisionName` identifies the row. */
  const [rejection, setRejection] = useState(null);
  const [revertTo, setRevertTo] = useState("vendor");
  const [revertDivisions, setRevertDivisions] = useState([]);
  const [reasonText, setReasonText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const state = form.approvalState || "idle";
  const isStarted = !!form.actualStartDate || !!activity.actualStartDate;
  const allTasksDone = activityTasksAllComplete(activity);
  const hasTasks = !activityHasNoTasks(activity);
  const workflowEnabled = editable && !busy;
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

  /* Generic API + local transition runner. Calls the workflow endpoint with
     the given action/comment; on success applies the supplied local transform
     to update form state. Surfaces backend errors inline so the user can
     correct and retry without losing context. */
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

  async function handleStartActivity() {
    if (!consentDivisions.length) {
      setError(
        "Add at least one Concerned Division to the activity before starting the workflow."
      );
      return;
    }
    await runTransition({
      action: WORKFLOW_ACTIONS.SUBMIT,
      comment: "Activity started — initial submission for approval.",
      transform: () => startActivity(form, consentDivisions)
    });
  }

  async function handleResubmit() {
    if (!consentDivisions.length) {
      setError("No Concerned Divisions configured — cannot resubmit.");
      return;
    }
    await runTransition({
      action: WORKFLOW_ACTIONS.UPDATE,
      comment: "Activity re-submitted after rejection.",
      transform: () => resubmitAfterRejection(form, consentDivisions)
    });
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
    /* Admin-only local reset — no API for this in the curl set, kept as a
       client-side escape hatch. */
    if (!window.confirm("Reset the approval workflow for this activity?")) return;
    apply(resetWorkflow(form));
  }

  /* ─── Toolbar ─── */
  const toolbarBtns = [];
  if (workflowEnabled && !rejection) {
    if (!isStarted) {
      toolbarBtns.push(
        <button
          key="start"
          type="button"
          className="uidai-btn"
          disabled={busy}
          onClick={handleStartActivity}
        >
          {busy ? "Submitting…" : "▶ Start Activity"}
        </button>
      );
    } else if (state === "rejected_to_vendor") {
      toolbarBtns.push(
        <button
          key="resubmit"
          type="button"
          className="uidai-btn"
          disabled={busy || !consentDivisions.length}
          onClick={handleResubmit}
        >
          {busy ? "Submitting…" : "Resubmit for Approval"}
        </button>
      );
    }
    if (state !== "idle") {
      toolbarBtns.push(
        <button
          key="reset"
          type="button"
          className="uidai-btn uidai-btn--cancel"
          disabled={busy}
          onClick={handleResetWorkflow}
        >
          Reset Workflow
        </button>
      );
    }
  }

  let toolbarContent;
  if (toolbarBtns.length) {
    toolbarContent = (
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
        {toolbarBtns}
      </div>
    );
  } else if (state === "completed") {
    toolbarContent = (
      <div style={{ padding: 8, fontSize: 13, color: "#1d6b3a" }}>
        Workflow complete.
      </div>
    );
  } else if (!editable) {
    toolbarContent = null;
  } else {
    toolbarContent = (
      <div style={{ padding: 8, fontSize: 13, color: "#66788f" }}>
        Awaiting reviewer action — approve or reject from the rows below.
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
        <div style={{ fontSize: 11, color: "#66788f", marginTop: 2 }}>
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
          <div
            style={{
              background: "#fde2e2",
              color: "#9b1c1c",
              padding: 6,
              borderRadius: 4,
              marginBottom: 6,
              fontSize: 12
            }}
          >
            <b>⟲ Returned to vendor</b> by{" "}
            <b>{form.lastRejection.byName || "reviewer"}</b>. Reason:{" "}
            <i>{form.lastRejection.reason || "—"}</i>
          </div>
        )}
        {isStarted
          ? <>Will route to: <b>{targets}</b>.</>
          : <>Click <b>▶ Start Activity</b> above to submit and route to: <b>{targets}</b>.</>}
      </>
    );
  } else {
    s2Body = "Pending — complete tasks and start the activity.";
  }

  let s3Body;
  if (s3 === "future") {
    s3Body = "Pending — will activate after the activity is submitted.";
  } else {
    const rows = safeArray(form.divisionApprovals);
    if (rows.length) {
      s3Body = (
        <div>
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
                          className="uidai-btn"
                          style={{ padding: "2px 8px", fontSize: 12 }}
                          disabled={busy}
                          onClick={() => handleApproveDivision(r.division)}
                        >
                          {busy ? "…" : "Approve"}
                        </button>
                        <button
                          type="button"
                          className="uidai-btn uidai-btn--cancel"
                          style={{ padding: "2px 8px", fontSize: 12 }}
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
          <div style={{ fontSize: 11, color: "#66788f", marginTop: 2 }}>
            <b>Reverted to:</b> Vendor (full resend required)
          </div>
        )}
        {rj.revertTo === "divisions" && safeArray(rj.revertDivisions).length > 0 && (
          <div style={{ fontSize: 11, color: "#66788f", marginTop: 2 }}>
            <b>Reverted to Concerned Division(s):</b>{" "}
            {rj.revertDivisions.join(", ")}
          </div>
        )}
      </>
    );
  } else if (s4 === "active" && state === "pending_owner") {
    const isRejectingOwner = rejection && rejection.kind === "owner";
    s4Body = (
      <>
        Awaiting decision from <b>{ownerName}</b>.
        <TargetRow
          name={`👤 ${ownerName}`}
          status={form.ownerApproval?.status || "pending"}
          decidedAt={form.ownerApproval?.decidedAt}
          actions={
            workflowEnabled && !isRejectingOwner ? (
              <>
                <button
                  type="button"
                  className="uidai-btn"
                  style={{ padding: "2px 8px", fontSize: 12 }}
                  disabled={busy}
                  onClick={handleApproveOwner}
                >
                  {busy ? "…" : "Approve"}
                </button>
                <button
                  type="button"
                  className="uidai-btn uidai-btn--cancel"
                  style={{ padding: "2px 8px", fontSize: 12 }}
                  disabled={busy}
                  onClick={() => startRejection({ kind: "owner" })}
                >
                  Reject
                </button>
              </>
            ) : null
          }
        />
        {isRejectingOwner && (
          <div
            style={{
              border: "1px solid #fcd6d6",
              background: "#fff5f5",
              padding: 10,
              borderRadius: 6,
              marginTop: 6
            }}
          >
            <div style={{ fontWeight: 600, marginBottom: 6 }}>
              Owner Rejection — Pick Revert Target
            </div>
            <label style={{ display: "block", marginBottom: 4, fontSize: 13 }}>
              <input
                type="radio"
                name="revertTo"
                value="vendor"
                checked={revertTo === "vendor"}
                onChange={() => setRevertTo("vendor")}
                disabled={busy}
              />{" "}
              Revert to Vendor (full resend)
            </label>
            <label style={{ display: "block", marginBottom: 4, fontSize: 13 }}>
              <input
                type="radio"
                name="revertTo"
                value="divisions"
                checked={revertTo === "divisions"}
                onChange={() => setRevertTo("divisions")}
                disabled={busy}
              />{" "}
              Revert to Concerned Division(s)
            </label>
            {revertTo === "divisions" && (
              <div style={{ marginLeft: 18, marginBottom: 6 }}>
                {consentDivisions.length === 0 && (
                  <div style={{ fontSize: 12, color: "#66788f" }}>
                    No concerned divisions to revert to.
                  </div>
                )}
                {consentDivisions.map((d) => (
                  <label key={d} style={{ display: "inline-block", marginRight: 10, fontSize: 13 }}>
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
                    />{" "}
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
    <div
      style={{
        marginTop: 16,
        padding: 12,
        border: "1px solid #e6ebf2",
        background: "#fbfcfe",
        borderRadius: 6
      }}
    >
      <div
        style={{
          fontSize: 14,
          fontWeight: 700,
          color: "#173e77",
          marginBottom: 10,
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center"
        }}
      >
        <span>Activity Approval Workflow</span>
        <span style={{ fontSize: 12, fontWeight: 500, color: "#42526e" }}>
          State: <b>{APPROVAL_STATE_LABELS[state] || state}</b>
        </span>
      </div>
      <div style={{ marginBottom: 10 }}>{toolbarContent}</div>
      {error && (
        <div
          style={{
            padding: 8,
            marginBottom: 10,
            background: "#fde2e2",
            color: "#9b1c1c",
            borderRadius: 6,
            fontSize: 13
          }}
        >
          {error}
        </div>
      )}
      <div>
        <StepRow index={1} state={s1} title={hasTasks ? "Tasks Completed" : "No Tasks Required"}>
          {s1Body}
        </StepRow>
        <StepRow index={2} state={s2} title="Activity Submitted">
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
    </div>
  );
}
