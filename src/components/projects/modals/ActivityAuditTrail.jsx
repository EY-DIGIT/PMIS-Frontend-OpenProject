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

/* Which entry `type`s each summary pill represents. The requests pill
   covers both plain requests and updates (mirrors the count logic below). */
const FILTER_TYPES = {
  requests: ["request", "update"],
  approvals: ["approval"],
  rejections: ["rejection"],
};

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

  /* Clicking a summary pill filters the trail to that category; clicking
     the active pill again clears the filter. `filter` is one of the
     FILTER_TYPES keys, or null for "show all". */
  const [filter, setFilter] = useState(null);
  const toggleFilter = (key) => setFilter((prev) => (prev === key ? null : key));
  const visibleEntries = filter
    ? entries.filter((e) => FILTER_TYPES[filter].includes(e.type))
    : entries;

  return (
    <div className="pmis-awf-audit pmis-awf-scope">
      <div className="pmis-awf-audit__head">
        <h4>📜 Activity Audit Trail</h4>
        <div className="pmis-awf-audit__summary">
          <button
            type="button"
            className={`pmis-awf-audit__pill pmis-awf-audit__pill--req${filter === "requests" ? " is-active" : ""}`}
            onClick={() => toggleFilter("requests")}
            disabled={counts.requests === 0}
            aria-pressed={filter === "requests"}
            title={filter === "requests" ? "Show all events" : "Show only requests"}
          >
            <b>{counts.requests}</b> request{counts.requests === 1 ? "" : "s"}
          </button>
          <button
            type="button"
            className={`pmis-awf-audit__pill pmis-awf-audit__pill--ok${filter === "approvals" ? " is-active" : ""}`}
            onClick={() => toggleFilter("approvals")}
            disabled={counts.approvals === 0}
            aria-pressed={filter === "approvals"}
            title={filter === "approvals" ? "Show all events" : "Show only approvals"}
          >
            <b>{counts.approvals}</b> approval{counts.approvals === 1 ? "" : "s"}
          </button>
          <button
            type="button"
            className={`pmis-awf-audit__pill pmis-awf-audit__pill--bad${filter === "rejections" ? " is-active" : ""}`}
            onClick={() => toggleFilter("rejections")}
            disabled={counts.rejections === 0}
            aria-pressed={filter === "rejections"}
            title={filter === "rejections" ? "Show all events" : "Show only rejections"}
          >
            <b>{counts.rejections}</b> rejection{counts.rejections === 1 ? "" : "s"}
          </button>
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
      ) : !loading && entries.length > 0 && visibleEntries.length === 0 ? (
        <div className="pmis-awf-audit__empty">
          No {filter} to show.{" "}
          <button
            type="button"
            className="pmis-awf-audit__clear"
            onClick={() => setFilter(null)}
          >
            Clear filter
          </button>
        </div>
      ) : !loading && entries.length > 0 ? (
        <ol className="pmis-awf-audit__list">
          {visibleEntries.map((e, idx) => (
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
