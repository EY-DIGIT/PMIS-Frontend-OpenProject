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

import React, { useState } from "react";
import { safeArray, formatDateTime } from "../../../utils/project/helpers";

/* ─── Workflow graph ───
   Ordered stages of the activity approval workflow. The current stage
   (derived from form.approvalState) is highlighted with a red indicator;
   earlier stages render as done (green), later ones as pending (grey). */
const FLOW_STEPS = [
  { key: "start", label: "Start", states: ["idle"] },
  { key: "ready", label: "Ready for Approval", states: ["ready_for_approval"] },
  { key: "division", label: "Concerned Division Review", states: ["pending_division"] },
  { key: "divApproved", label: "Divisions Approved", states: ["division_approved"] },
  { key: "owner", label: "Owner Review", states: ["pending_owner"] },
  { key: "completed", label: "Completed", states: ["completed"] },
];

function WorkflowGraph({ form }) {
  const state = String((form && form.approvalState) || "idle");
  const isRejected = state === "rejected_to_vendor";
  // On a rejection the activity is back with the vendor to resend, so the
  // indicator sits on the first stage; otherwise find the matching stage.
  const activeIdx = isRejected
    ? 0
    : FLOW_STEPS.findIndex((s) => s.states.includes(state));

  return (
    <div className="pmis-awf-graph">
      {isRejected && (
        <div className="pmis-awf-graph__banner">
          ✕ Rejected — returned to vendor for resubmission
        </div>
      )}
      <div className="pmis-awf-graph__row">
        {FLOW_STEPS.map((s, i) => {
          const done = activeIdx >= 0 && i < activeIdx && !isRejected;
          const active = i === activeIdx;
          const variant = active
            ? "pmis-awf-graph__node--active"
            : done
            ? "pmis-awf-graph__node--done"
            : "pmis-awf-graph__node--todo";
          return (
            <React.Fragment key={s.key}>
              <div className={`pmis-awf-graph__node ${variant}`}>
                {active && <span className="pmis-awf-graph__dot" aria-hidden="true" />}
                <span className="pmis-awf-graph__icon" aria-hidden="true">
                  {done ? "✓" : active ? "●" : "○"}
                </span>
                <span className="pmis-awf-graph__label">{s.label}</span>
              </div>
              {i < FLOW_STEPS.length - 1 && (
                <span className="pmis-awf-graph__arrow" aria-hidden="true">→</span>
              )}
            </React.Fragment>
          );
        })}
      </div>
      <div className="pmis-awf-graph__legend">
        <span><i className="pmis-awf-graph__sw pmis-awf-graph__sw--done" /> Completed</span>
        <span><i className="pmis-awf-graph__sw pmis-awf-graph__sw--active" /> Current</span>
        <span><i className="pmis-awf-graph__sw pmis-awf-graph__sw--todo" /> Pending</span>
      </div>
    </div>
  );
}

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

/* Map backend ACTION / VOTE name → a short, human-readable label shown
   in the audit headline. Unknown actions fall back to Title Case of the
   snake_case key (see prettyAction). */
const ACTION_LABEL = {
  SUBMIT: "Submitted for Approval",
  UPDATE: "Updated",
  REQUEST_DIVISION_APPROVAL: "Division Approval Requested",
  REQUEST_OWNER_APPROVAL: "Owner Approval Requested",
  VOTE_APPROVED: "Division Approved",
  VOTE_REJECTED: "Division Rejected",
  GATE_READY: "All Divisions Approved",
  ALL_APPROVED: "Forwarded to Owner",
  ANY_REJECTED: "Rejected",
  APPROVE: "Approved",
  REJECT: "Rejected",
  RETURN_TO_VENDOR: "Returned to Vendor",
  COMPLETE: "Completed"
};

/* Convert a raw backend action to a readable label: use ACTION_LABEL when
   known, else Title-Case the snake_case key (FOO_BAR → "Foo Bar"). */
function prettyAction(action) {
  const key = String(action || "").toUpperCase();
  if (!key) return "";
  if (ACTION_LABEL[key]) return ACTION_LABEL[key];
  return key
    .toLowerCase()
    .split(/[_\s]+/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

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
/* Pick the styling variant from a backend action / vote name when it
   isn't in ACTION_TO_TYPE (e.g. the timeline's VOTE_APPROVED /
   VOTE_REJECTED). */
function variantForAction(action, kind) {
  if (ACTION_TO_TYPE[action]) return ACTION_TO_TYPE[action];
  if (action.includes("APPROV")) return "approval";
  if (action.includes("REJECT")) return "rejection";
  if (action.includes("SUBMIT") || action.includes("REQUEST")) return "request";
  if (action.includes("COMPLETE")) return "completion";
  return kind === "VOTE" ? "approval" : "request";
}

function fromProcessInstance(pi) {
  /* New timeline-feed shape from /inbox/{id}/timeline:
       { kind, title, detail, timestamp, actorUsername, previousState,
         resultantState, actionName, eventId } */
  const isTimeline = pi && typeof pi === "object"
    && pi.kind !== undefined && pi.timestamp !== undefined && pi.title !== undefined;
  if (isTimeline) {
    const action = String(pi.actionName || "").toUpperCase();
    return {
      type: variantForAction(action, pi.kind),
      headline: pi.title || "",
      comment: pi.detail || "",
      who: pi.actorUsername || pi.actorUuid || "System",
      when: fmtAuditTime(pi.timestamp),
      escalated: false,
      id: pi.eventId || pi.id
    };
  }

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
  if (action) lines.push(prettyAction(action));
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
  // "timeline" shows the chronological event list; "graph" shows the
  // workflow stage diagram with the current step marked in red.
  const [view, setView] = useState("timeline");
  const apiEntries = safeArray(processInstances).map(fromProcessInstance);
  const localEntries = safeArray(form && form.comments)
    .filter((c) => c && c.kind === "system")
    .map(fromSystemComment);
  /* Prefer the API entries when present — they're the source of truth.
     Only show local system comments when we have no API data at all. */
  const entries = apiEntries.length ? apiEntries : localEntries;

  return (
    <div className="pmis-awf-audit pmis-awf-scope">
      <div className="pmis-awf-audit__head">
        <h4>{view === "graph" ? "🔀 Workflow Graph" : "📜 Activity Audit Trail"}</h4>
        <div className="pmis-awf-audit__summary">
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
        </div>
      </div>

      {view === "graph" ? (
        <WorkflowGraph form={form} />
      ) : (
      <>
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
      </>
      )}
    </div>
  );
}
