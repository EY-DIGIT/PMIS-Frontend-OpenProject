/* ══════════════════════════════════════════════════════════════════
   ActivityAuditTrail.jsx — chronological record of every approval
   event on an activity (request / approval / rejection / completion /
   ready / start).

   Source: the activity's comments tagged with `kind: 'system'`. CSS
   classes live in src/styles/project/activityWorkflow.css with the
   unique `pmis-awf-` prefix.
   ══════════════════════════════════════════════════════════════════ */

import React from "react";
import { safeArray, formatDateTime } from "../../../utils/project/helpers";

const SYSTEM_GLYPH = {
  ready: "⏳",
  request: "📤",
  approval: "✓",
  rejection: "✕",
  completion: "★",
  start: "▶"
};

function typeOf(item) {
  return item && item.systemType ? item.systemType : "request";
}

export default function ActivityAuditTrail({ form }) {
  const events = safeArray(form && form.comments).filter(
    (c) => c && c.kind === "system"
  );

  const counts = events.reduce(
    (acc, e) => {
      const t = typeOf(e);
      if (t === "approval") acc.approvals += 1;
      else if (t === "rejection") acc.rejections += 1;
      else if (t === "request") acc.requests += 1;
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

      {events.length === 0 ? (
        <div className="pmis-awf-audit__empty">
          No workflow events yet — actions taken on the panel above will appear
          here.
        </div>
      ) : (
        <ol className="pmis-awf-audit__list">
          {events.map((e, idx) => {
            const t = typeOf(e);
            return (
              <li
                key={idx}
                className={`pmis-awf-audit__item pmis-awf-audit__item--${t}`}
              >
                <span className="pmis-awf-audit__dot">
                  {SYSTEM_GLYPH[t] || "•"}
                </span>
                <div className="pmis-awf-audit__body">
                  <div className="pmis-awf-audit__line">{e.text || ""}</div>
                  <div className="pmis-awf-audit__meta">
                    {e.who || "System"} · {formatDateTime(e.when)}
                    {e.approvalStage ? ` · Stage: ${e.approvalStage}` : ""}
                    {e.approvalTarget ? ` · ${e.approvalTarget}` : ""}
                  </div>
                </div>
              </li>
            );
          })}
        </ol>
      )}
    </div>
  );
}
