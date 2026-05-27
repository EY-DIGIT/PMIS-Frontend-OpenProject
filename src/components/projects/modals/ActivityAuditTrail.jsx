/* ══════════════════════════════════════════════════════════════════
   ActivityAuditTrail.jsx — chronological record of every approval
   event on an activity (request / approval / rejection / reset).

   Source: the activity's comments tagged with `kind: 'system'`. These
   are emitted by every workflow transition in approvalWorkflow.js
   (startActivity, approveDivision, rejectDivision, approveOwner,
   rejectOwner, resubmitAfterRejection, resetWorkflow).

   Rendered to the right of the form in activity edit mode, beneath
   the ApprovalPanel timeline.
   ══════════════════════════════════════════════════════════════════ */

import React from "react";
import { safeArray, formatDateTime } from "../../../utils/project/helpers";

const SYSTEM_ICON = {
  ready: "🟡",
  request: "📤",
  approval: "✅",
  rejection: "❌",
  completion: "🏁"
};

const SYSTEM_BG = {
  ready: { bg: "#fff3cd", border: "#f3d472" },
  request: { bg: "#e0f2fe", border: "#7dd3fc" },
  approval: { bg: "#dff5e1", border: "#86d9a0" },
  rejection: { bg: "#fde2e2", border: "#fca5a5" },
  completion: { bg: "#dff5e1", border: "#86d9a0" }
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
    <div
      style={{
        marginTop: 16,
        padding: 12,
        border: "1px solid #e6ebf2",
        background: "#fff",
        borderRadius: 6
      }}
    >
      <div
        style={{
          fontSize: 14,
          fontWeight: 700,
          color: "#173e77",
          marginBottom: 8,
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          flexWrap: "wrap",
          gap: 6
        }}
      >
        <span>📜 Activity Audit Trail</span>
        <span style={{ fontSize: 11, fontWeight: 500, color: "#66788f" }}>
          {counts.requests} request{counts.requests === 1 ? "" : "s"} ·{" "}
          {counts.approvals} approval{counts.approvals === 1 ? "" : "s"} ·{" "}
          {counts.rejections} rejection{counts.rejections === 1 ? "" : "s"}
        </span>
      </div>

      {events.length === 0 ? (
        <div style={{ fontSize: 13, color: "#66788f", padding: "8px 0" }}>
          No workflow events yet — actions taken on the panel above will appear
          here.
        </div>
      ) : (
        <ol
          style={{
            listStyle: "none",
            padding: 0,
            margin: 0,
            display: "flex",
            flexDirection: "column",
            gap: 6
          }}
        >
          {events.map((e, idx) => {
            const t = typeOf(e);
            const palette = SYSTEM_BG[t] || SYSTEM_BG.request;
            return (
              <li
                key={idx}
                style={{
                  padding: "8px 10px",
                  background: palette.bg,
                  border: `1px solid ${palette.border}`,
                  borderRadius: 6
                }}
              >
                <div
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "baseline",
                    gap: 6,
                    fontSize: 12,
                    color: "#42526e"
                  }}
                >
                  <span style={{ fontWeight: 600 }}>
                    {SYSTEM_ICON[t] || "•"} {e.who || "System"}
                  </span>
                  <span>{formatDateTime(e.when)}</span>
                </div>
                <div style={{ fontSize: 13, color: "#1f2a44", marginTop: 4 }}>
                  {e.text || ""}
                </div>
                {e.approvalStage && (
                  <div
                    style={{
                      marginTop: 4,
                      fontSize: 11,
                      color: "#66788f",
                      textTransform: "capitalize"
                    }}
                  >
                    Stage: {e.approvalStage}
                    {e.approvalTarget ? ` · ${e.approvalTarget}` : ""}
                  </div>
                )}
              </li>
            );
          })}
        </ol>
      )}
    </div>
  );
}
