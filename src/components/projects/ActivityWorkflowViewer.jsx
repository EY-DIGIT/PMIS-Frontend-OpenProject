/* ══════════════════════════════════════════════════════════════════
   ActivityWorkflowViewer.jsx — read-only Timeline + Graph of an
   activity's approval workflow. Used in the Approval Inbox review pages
   so a reviewer can SEE the workflow history/graph but cannot perform any
   action (no toolbar / stepper). Driven purely by fetched workflow data.
   ══════════════════════════════════════════════════════════════════ */
import React, { useEffect, useState } from "react";
import ActivityAuditTrail from "./modals/ActivityAuditTrail";
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
  const action = String((last.actionName || last.action) || "").toUpperCase();
  const comment = String(last.comment || last.detail || "");
  const byName =
    last.performedByUsername || last.actorUsername || last.performedByUuid || "";
  const byKind = action.includes("VOTE")
    ? "division"
    : action === "RETURN_TO_VENDOR" || /vendor/i.test(comment)
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

export default function ActivityWorkflowViewer({ activityId, concernedDivisions = [] }) {
  const [view, setView] = useState("timeline");
  const [processInstances, setProcessInstances] = useState([]);
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

        // Timeline list source: prefer the purpose-built timeline feed,
        // then audit logs, then legacy process instances.
        setProcessInstances(tl.length ? tl : auditLogs.length ? auditLogs : instances);

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

  return (
    <div className="pmis-awf-scope">
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, marginBottom: 10, flexWrap: "wrap" }}>
        <div className="pmis-awf-viewtoggle">
          <button
            type="button"
            className={`pmis-awf-viewtoggle__btn${view === "timeline" ? " is-active" : ""}`}
            onClick={() => setView("timeline")}
          >
            Timeline
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
        <WorkflowGraph form={form} />
      ) : (
        <ActivityAuditTrail form={form} processInstances={processInstances} loading={loading} error="" />
      )}
    </div>
  );
}
