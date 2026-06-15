/* ══════════════════════════════════════════════════════════════════
   ActivityWorkflowViewer.jsx — read-only Timeline + Graph of an
   activity's approval workflow. Used in the Approval Inbox review pages
   so a reviewer can SEE the workflow history/graph but cannot perform any
   action (no toolbar / stepper). Driven purely by fetched workflow data.
   ══════════════════════════════════════════════════════════════════ */
import React, { useEffect, useState } from "react";
import WorkflowGraph from "./modals/WorkflowGraph";
import {
  getProcessInstances,
  getActivityWorkflowAuditLogs,
  getParallelGateStatus,
  getActivityWorkflowTimeline
} from "../../api/activityWorkflow";
import {
  deriveStateFromAuditLogs,
  deriveDivisionApprovalsFromAuditLogs,
  deriveOwnerApprovalFromAuditLogs,
  deriveDivisionApprovalsFromGate,
  deriveStateFromInstances,
  deriveDivisionApprovalsFromInstances,
  deriveOwnerApprovalFromInstances
} from "../../utils/project/approvalWorkflow";
import { safeArray } from "../../utils/project/helpers";
import "../../styles/project/activityWorkflow.css";

const EMPTY_FORM = {
  approvalState: "idle",
  divisionApprovals: [],
  ownerApproval: null,
  lastRejection: null
};

/* Pull the latest rejection out of the workflow events so the graph can
   show who rejected and where it was routed. Handles both audit-log rows
   ({ actionName, comment, performedByUsername }) and timeline events
   ({ actionName, detail, actorUsername }). The owner reject comment
   encodes the revert target, e.g.
     "Revert to Vendor (full restart) — <reason>"
     "Revert to Concerned Divisions: tmd1, tmd2 — <reason>" */
function deriveLastRejection(events) {
  const rejs = safeArray(events).filter((e) => {
    const a = String((e && (e.actionName || e.action)) || "").toUpperCase();
    return a.includes("REJECT") || a === "RETURN_TO_VENDOR" || a === "ANY_REJECTED";
  });
  if (!rejs.length) return null;
  const ts = (e) => Number((e && (e.createdTime || e.timestamp)) || 0);
  const last = rejs.reduce((a, b) => (ts(b) >= ts(a) ? b : a));
  /* If the activity was re-submitted / re-requested AFTER this rejection,
     the rejection is stale — the workflow has moved on. Drop it so the graph
     renders the reject path as the default dashed gray (matching the
     activity-edit graph, which clears lastRejection on resubmit) instead of
     a lingering red. */
  const lastTs = ts(last);
  const advancedAfter = safeArray(events).some((e) => {
    const a = String((e && (e.actionName || e.action)) || "").toUpperCase();
    const advancing =
      a === "SUBMIT" || a === "RESUBMIT" || a.includes("REQUEST") ||
      a === "APPROVE" || a === "ALL_APPROVED" || a === "COMPLETE";
    return advancing && ts(e) > lastTs;
  });
  if (advancedAfter) return null;
  const action = String((last.actionName || last.action) || "").toUpperCase();
  const comment = String(last.comment || last.detail || "");
  const prevState = String((last.previousState || last.previousStatus) || "").toUpperCase();
  const byName =
    last.performedByUsername || last.actorUsername || last.performedByUuid || "";
  /* Attribute the rejection to the stage it actually came from. A Concerned
     Division vote (VOTE_REJECTED) — and the gate's ANY_REJECTED roll-up of
     it — is a DIVISION rejection, NOT the owner's. Only an owner action
     (RETURN_TO_VENDOR / RETURN_TO_DIVISION, or a reject recorded while the
     activity was pending at the owner) is attributed to the owner.
     Previously ANY_REJECTED fell through to "owner", which made the graph
     light up the Owner stage as rejected on a concerned-division reject. */
  const byKind =
    action.includes("VOTE") || action === "ANY_REJECTED" || prevState.includes("CONCERNED")
      ? "division"
      : action === "RETURN_TO_VENDOR" || action === "RETURN_TO_DIVISION" || prevState.includes("OWNER")
        ? "owner"
        : "owner";

  let revertTo = "vendor";
  let revertDivisions = [];
  let reason = comment;
  const dm = comment.match(/concerned divisions?:?\s*([^—\-]+)/i);
  if (dm) {
    revertTo = "divisions";
    revertDivisions = dm[1].split(",").map((s) => s.trim()).filter(Boolean);
  }
  const sep = comment.split(/\s*—\s*|\s-\s/);
  if (sep.length > 1) reason = sep.slice(1).join(" ").trim();
  else if (/revert to/i.test(comment)) reason = "";

  return { byKind, byName, reason, revertTo, revertDivisions };
}

function cap(s) {
  const x = String(s || "");
  return x ? x[0].toUpperCase() + x.slice(1) : x;
}

/* Read-only vertical stepper of the approval stages, derived from the
   workflow state. Shown in place of the audit trail in the review pages. */
const STEPPER_STAGES = [
  { key: "ready", label: "Ready for Approval", states: ["ready_for_approval"] },
  { key: "division", label: "Concerned Division Review", states: ["pending_division"] },
  { key: "owner", label: "Activity Owner Review", states: ["pending_owner", "division_approved"] },
  { key: "completed", label: "Activity Completed", states: ["completed"] },
];

function WorkflowStepper({ form }) {
  const state = String((form && form.approvalState) || "idle");
  const divs = safeArray(form && form.divisionApprovals);
  const owner = form && form.ownerApproval;
  const divisionRejected = divs.some((d) => String(d.status || "").toLowerCase() === "rejected");
  const ownerRejected = String((owner && owner.status) || "").toLowerCase() === "rejected";
  const isCompleted = state === "completed";
  const activeIdx = STEPPER_STAGES.findIndex((s) => s.states.includes(state));

  const stageClass = (i, stage) => {
    const rejected =
      (stage.key === "division" && divisionRejected) ||
      (stage.key === "owner" && ownerRejected);
    if (rejected) return "pmis-awf-step--rejected";
    if (isCompleted) return "pmis-awf-step--done";
    if (i === activeIdx) return "pmis-awf-step--active";
    if (activeIdx >= 0 && i < activeIdx) return "pmis-awf-step--done";
    return "";
  };

  return (
    <div className="pmis-awf-stepper">
      {STEPPER_STAGES.map((stage, i) => {
        const cls = stageClass(i, stage);
        const done = cls.includes("done");
        const rejected = cls.includes("rejected");
        const active = cls.includes("active");
        const marker = rejected ? "✕" : done ? "✓" : i + 1;
        return (
          <div key={stage.key} className={`pmis-awf-step ${cls}`}>
            <span className="pmis-awf-step__marker">{marker}</span>
            <div className="pmis-awf-step__body">
              <div className="pmis-awf-step__title">{stage.label}</div>
              {stage.key === "division" && divs.length > 0 ? (
                <div className="pmis-awf-targets">
                  {divs.map((d, j) => (
                    <div key={`${d.division}-${j}`} className="pmis-awf-target">
                      <span>{d.division}</span>
                      <span className={`pmis-awf-status-pill pmis-awf-status-pill--${String(d.status || "pending").toLowerCase()}`}>
                        {cap(d.status || "pending")}
                      </span>
                    </div>
                  ))}
                </div>
              ) : stage.key === "owner" && owner && owner.status ? (
                <div className="pmis-awf-step__sub">Owner decision: {cap(owner.status)}</div>
              ) : (
                <div className="pmis-awf-step__sub">
                  {rejected ? "Rejected" : done ? "Done" : active ? "In progress" : "Pending"}
                </div>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

export default function ActivityWorkflowViewer({ activityId, concernedDivisions = [], onlyDivisions = [] }) {
  const [view, setView] = useState("stepper");
  const [form, setForm] = useState(EMPTY_FORM);
  const [loading, setLoading] = useState(true);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    if (!activityId) { setLoading(false); return; }
    let cancelled = false;
    setLoading(true);
    Promise.allSettled([
      getProcessInstances(activityId),
      getActivityWorkflowAuditLogs(activityId),
      getParallelGateStatus(activityId),
      getActivityWorkflowTimeline(activityId)
    ])
      .then(([piRes, auditRes, gateRes, tlRes]) => {
        if (cancelled) return;
        const instances = piRes.status === "fulfilled" && Array.isArray(piRes.value) ? piRes.value : [];
        const auditLogs = auditRes.status === "fulfilled" && Array.isArray(auditRes.value) ? auditRes.value : [];
        const gate = gateRes.status === "fulfilled" && gateRes.value && typeof gateRes.value === "object" ? gateRes.value : null;
        const tl = tlRes.status === "fulfilled" && Array.isArray(tlRes.value) ? tlRes.value : [];

        const cd = concernedDivisions || [];
        let st = null, divs = [], owner = null;
        if (auditLogs.length) {
          st = deriveStateFromAuditLogs(auditLogs, cd);
          divs = deriveDivisionApprovalsFromAuditLogs(auditLogs, cd);
          owner = deriveOwnerApprovalFromAuditLogs(auditLogs);
        }
        if (!st && instances.length) {
          st = deriveStateFromInstances(instances, cd);
          if (!divs.length) divs = deriveDivisionApprovalsFromInstances(instances, cd);
          if (!owner) owner = deriveOwnerApprovalFromInstances(instances);
        }
        const gateDivs = deriveDivisionApprovalsFromGate(gate);
        if (gateDivs.length) divs = gateDivs;
        if (gate && gate.readyForOwner === true && !gate.hasRejection &&
          (st === "pending_division" || st === null)) {
          st = "division_approved";
        }

        const rejSource = auditLogs.length ? auditLogs : instances.length ? instances : tl;
        setForm({
          approvalState: st || "idle",
          divisionApprovals: divs,
          ownerApproval: owner,
          lastRejection: deriveLastRejection(rejSource)
        });
      })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activityId, reloadKey]);

  /* When `onlyDivisions` is supplied (Concerned Division review), restrict
     the division breakdown shown in BOTH the stepper and the graph to just
     the reviewer's own division — matched case-insensitively against the
     division's name or code. Other divisions are hidden. */
  const onlyKeys = safeArray(onlyDivisions)
    .map((k) => String(k || "").trim().toLowerCase())
    .filter(Boolean);
  const displayForm = onlyKeys.length
    ? {
        ...form,
        divisionApprovals: safeArray(form.divisionApprovals).filter((d) =>
          onlyKeys.includes(String(d.division || "").trim().toLowerCase())
        ),
      }
    : form;

  return (
    <div className="pmis-awf-scope">
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, marginBottom: 10, flexWrap: "wrap" }}>
        <div className="pmis-awf-viewtoggle">
          <button
            type="button"
            className={`pmis-awf-viewtoggle__btn${view === "stepper" ? " is-active" : ""}`}
            onClick={() => setView("stepper")}
          >
            Stepper
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
          disabled={loading}
          onClick={() => setReloadKey((k) => k + 1)}
        >
          ↻ Refresh
        </button>
      </div>

      {view === "graph" ? (
        <WorkflowGraph form={displayForm} />
      ) : loading ? (
        <div className="pmis-awf-audit__empty">Loading workflow…</div>
      ) : (
        <WorkflowStepper form={displayForm} />
      )}
    </div>
  );
}
