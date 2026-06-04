/* ══════════════════════════════════════════════════════════════════
   ActivityAuditTrail.jsx — chronological record of every workflow
   event on an activity.

   Source priority:
     1. `processInstances` prop (from the workflow-service
        /_search/ACTIVITY/{id} endpoint) — preferred, this is the
        backend's authoritative audit log.
     2. Falls back to system-tagged comments on the local form when
        the API hasn't returned anything (e.g. activity not yet
        persisted, network error, or no events).

   CSS classes live in src/styles/project/activityWorkflow.css with
   the unique `pmis-awf-` prefix.
   ══════════════════════════════════════════════════════════════════ */

import React from "react";
import { safeArray, formatDateTime } from "../../../utils/project/helpers";

/* ─── Glyph + variant per event type ─── */
const SYSTEM_GLYPH = {
  ready: "⏳",
  request: "📤",
  approval: "✓",
  rejection: "✕",
  completion: "★",
  start: "▶",
  update: "✎"
};

/* Map backend ACTION → the variant used for styling + glyph. */
const ACTION_TO_TYPE = {
  SUBMIT: "request",
  APPROVE: "approval",
  ALL_APPROVED: "approval",
  REJECT: "rejection",
  ANY_REJECTED: "rejection",
  UPDATE: "update",
  COMPLETE: "completion"
};

/* Map backend previousStatus → a short, human-readable label. */
const STATUS_LABEL = {
  READYFORAPPROVAL: "Ready for Approval",
  PENDINGATCONCERNEDDIVISION: "Pending Concerned Division",
  PENDINGATOWNERDIVISION: "Pending Owner Division",
  COMPLETED: "Completed",
  ACTIVITYCOMPLETED: "Activity Completed",
  REJECTED: "Rejected",
  RETURNEDTOVENDOR: "Returned to Vendor"
};

function fmtAuditTime(ms) {
  const n = Number(ms);
  if (!isFinite(n) || n <= 0) return "";
  return formatDateTime(new Date(n).toISOString());
}

/* Normalize a backend audit entry into the shape the audit list
   renders. Accepts both shapes:

   1. Legacy ProcessInstance from /process/_search/...:
        { action, previousStatus, comment, auditDetails: { createdBy, createdTime } }

   2. New AuditLog from /activities/audit/ACTIVITY/{id}:
        { actionName, previousState, resultantState, outcome, errorMessage,
          performedByUuid, performedByUsername, performedByRoles[],
          comment, createdTime }
   */
function fromProcessInstance(pi) {
  const isNewAudit = pi && typeof pi === "object"
    && (pi.actionName !== undefined || pi.outcome !== undefined);

  const action = String(
    isNewAudit ? pi.actionName : pi.action || ""
  ).toUpperCase();
  const outcome = String(pi.outcome || "").toUpperCase();
  /* On a failed transition the entry stays a rejection-style row so it
     visually flags. Successful ones use the action's variant. */
  const type = outcome === "FAILED" ? "rejection" : (ACTION_TO_TYPE[action] || "request");

  const prevRaw = isNewAudit ? pi.previousState : pi.previousStatus;
  const nextRaw = isNewAudit ? pi.resultantState : "";
  const prevLabel = STATUS_LABEL[String(prevRaw || "").toUpperCase()] || prevRaw || "";
  const nextLabel = STATUS_LABEL[String(nextRaw || "").toUpperCase()] || nextRaw || "";

  const lines = [];
  if (action) lines.push(action);
  if (prevLabel && nextLabel) lines.push(`${prevLabel} → ${nextLabel}`);
  else if (prevLabel) lines.push(`from ${prevLabel}`);
  if (outcome === "FAILED") lines.push("FAILED");
  const headline = lines.join(" · ");

  const comment = pi.comment || pi.errorMessage || "";
  const who = isNewAudit
    ? (pi.performedByUsername || pi.performedByUuid || "System")
    : ((pi.auditDetails && pi.auditDetails.createdBy) || pi.createdBy || "System");
  const whenMs = isNewAudit
    ? pi.createdTime
    : (pi.auditDetails && pi.auditDetails.createdTime);

  return {
    type,
    headline,
    comment,
    who,
    when: fmtAuditTime(whenMs),
    escalated: !!pi.escalated,
    id: pi.uuid || pi.id
  };
}

/* Normalize a local system comment into the same shape. */
function fromSystemComment(c) {
  const type = c.systemType || "request";
  return {
    type,
    headline: "",
    comment: c.text || "",
    who: c.who || "System",
    when: formatDateTime(c.when),
    approvalStage: c.approvalStage || "",
    approvalTarget: c.approvalTarget || "",
    id: c.id || c.when
  };
}

export default function ActivityAuditTrail({ form, processInstances, loading, error }) {
  const apiEntries = safeArray(processInstances).map(fromProcessInstance);
  const localEntries = safeArray(form && form.comments)
    .filter((c) => c && c.kind === "system")
    .map(fromSystemComment);
  /* Prefer the API entries when present — they're the source of truth.
     Only show local system comments when we have no API data at all. */
  const entries = apiEntries.length ? apiEntries : localEntries;

  const counts = entries.reduce(
    (acc, e) => {
      if (e.type === "approval") acc.approvals += 1;
      else if (e.type === "rejection") acc.rejections += 1;
      else if (e.type === "request" || e.type === "update") acc.requests += 1;
      return acc;
    },
    { approvals: 0, rejections: 0, requests: 0 }
  );

  return (
    <div className="pmis-awf-audit pmis-awf-scope">
      <div className="pmis-awf-audit__head">
        <h4>📜 Activity Audit Trail</h4>
        <div className="pmis-awf-audit__summary">
          <span className="pmis-awf-audit__pill pmis-awf-audit__pill--req">
            <b>{counts.requests}</b> request{counts.requests === 1 ? "" : "s"}
          </span>
          <span className="pmis-awf-audit__pill pmis-awf-audit__pill--ok">
            <b>{counts.approvals}</b> approval{counts.approvals === 1 ? "" : "s"}
          </span>
          <span className="pmis-awf-audit__pill pmis-awf-audit__pill--bad">
            <b>{counts.rejections}</b> rejection{counts.rejections === 1 ? "" : "s"}
          </span>
        </div>
      </div>

      {loading && (
        <div className="pmis-awf-audit__empty">Loading workflow history…</div>
      )}
      {error && !loading && (
        <div className="pmis-awf-error" style={{ marginBottom: 8 }}>
          {error}
        </div>
      )}

      {!loading && entries.length === 0 ? (
        <div className="pmis-awf-audit__empty">
          No workflow events yet — actions taken on the panel above will appear
          here.
        </div>
      ) : !loading && entries.length > 0 ? (
        <ol className="pmis-awf-audit__list">
          {entries.map((e, idx) => (
            <li
              key={e.id || idx}
              className={`pmis-awf-audit__item pmis-awf-audit__item--${e.type}`}
            >
              <span className="pmis-awf-audit__dot">
                {SYSTEM_GLYPH[e.type] || "•"}
              </span>
              <div className="pmis-awf-audit__body">
                {e.headline && (
                  <div className="pmis-awf-audit__line" style={{ fontWeight: 700 }}>
                    {e.headline}
                    {e.escalated && (
                      <span
                        style={{
                          marginLeft: 6,
                          padding: "1px 6px",
                          background: "#fff3cd",
                          color: "#8a6d10",
                          borderRadius: 999,
                          fontSize: 10,
                          fontWeight: 700
                        }}
                      >
                        ESCALATED
                      </span>
                    )}
                  </div>
                )}
                {e.comment && (
                  <div className="pmis-awf-audit__line" style={{ marginTop: e.headline ? 2 : 0 }}>
                    {e.comment}
                  </div>
                )}
                <div className="pmis-awf-audit__meta">
                  {e.who}{e.when ? ` · ${e.when}` : ""}
                  {e.approvalStage ? ` · Stage: ${e.approvalStage}` : ""}
                  {e.approvalTarget ? ` · ${e.approvalTarget}` : ""}
                </div>
              </div>
            </li>
          ))}
        </ol>
      ) : null}
    </div>
  );
}
