/* ══════════════════════════════════════════════════════════════════
   WorkflowGraph.jsx — BPMN-style SVG diagram of the activity approval
   workflow. Vertical happy path (Start → Ready → Concerned Division →
   Divisions Approved → Owner Review → Completed) with a right-side reject
   lane that converges into a "Rejected" node and loops back (via
   "Returned to Vendor") to "Ready for Approval".

   Driven entirely by `form` (approvalState / divisionApprovals /
   ownerApproval / lastRejection) — purely presentational, so it's reused
   read-only in the Approval Inbox review pages.
   ══════════════════════════════════════════════════════════════════ */
import React from "react";
import { safeArray } from "../../../utils/project/helpers";

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

export default function WorkflowGraph({ form, divisions }) {
  const state = String((form && form.approvalState) || "idle");
  const divApprovals = safeArray(form && form.divisionApprovals);
  const divisionName = (code) => {
    const c = String(code || "").toLowerCase();
    const m = safeArray(divisions).find((d) => String(d.code || "").toLowerCase() === c);
    return (m && (m.label || m.name)) || code;
  };
  const rejection = (form && form.lastRejection) || {};
  const rejectedFrom = String(rejection.byKind || "").toLowerCase();
  const divisionRejected = safeArray(form && form.divisionApprovals).some(
    (d) => d && String(d.status || "").toLowerCase() === "rejected"
  );
  const ownerRejected =
    String((form && form.ownerApproval && form.ownerApproval.status) || "").toLowerCase() ===
    "rejected";
  const stateRejected = state === "rejected_to_vendor";
  const hasRejectionRecord = !!(rejection.revertTo || rejection.byName || rejection.reason);
  const isRejected =
    state !== "completed" &&
    (stateRejected || divisionRejected || ownerRejected || hasRejectionRecord);
  const rejIdx = ownerRejected || rejectedFrom === "owner" ? 4 : 2;
  const activeIdx = FLOW_STEPS.findIndex((s) => s.states.includes(state));

  /* Where a rejection routes to: the owner can send it back to the vendor
     (full restart) or to specific Concerned Divisions for re-examination;
     a division rejection goes back to the vendor to resubmit. */
  const revertTo = String(rejection.revertTo || "").toLowerCase();
  const revertDivisions = safeArray(rejection.revertDivisions).filter(Boolean);
  const toDivisions = revertTo === "divisions" && revertDivisions.length > 0;
  const returnTitle = toDivisions ? "Back to Division(s)" : "Returned to Vendor";
  const returnSub = toDivisions
    ? revertDivisions.join(", ")
    : "Resubmit required";
  const rejectedBy = rejection.byName || rejection.by || "";
  const rejectReason = rejection.reason || "";
  /* Where the workflow restarts after the rejection: a division revert
     re-enters at Concerned Division; otherwise the vendor resubmits from
     Ready for Approval. */
  const restartIdx = toDivisions ? 2 : 1;
  const restartLabel = toDivisions ? "Concerned Division" : "Ready for Approval";

  // ── geometry (vertical top → bottom flow) ──
  const NW = 188, NH = 46, VGAP = 30, PADX = 16, PADY = 14;
  // Concerned-division boxes get their own lane on the left, branching into
  // the "Concerned Division" stage; the main flow shifts right to make room.
  const DIVB_W = 132, DIVB_H = 32, DIVB_GAP = 8;
  const hasDivs = divApprovals.length > 0;
  const divLaneW = hasDivs ? DIVB_W + 52 : 0;
  const nx = PADX + divLaneW, ncx = nx + NW / 2, nRight = nx + NW;
  const ny = (i) => PADY + i * (NH + VGAP);
  const nmid = (i) => ny(i) + NH / 2;

  const isCompleted = state === "completed";
  const kindOf = (i) => {
    if (isCompleted) return "done";
    if (i === activeIdx) return "active";
    if (activeIdx >= 0 && i < activeIdx) return "done";
    return "todo";
  };

  // division-box lane (left)
  const divbX = PADX;
  const divCount = divApprovals.length;
  const divTotalH = divCount * DIVB_H + Math.max(0, divCount - 1) * DIVB_GAP;
  const divStartY = Math.max(PADY, nmid(2) - divTotalH / 2);
  const divBoxY = (i) => divStartY + i * (DIVB_H + DIVB_GAP);
  const divBoxColor = (st) =>
    st === "approved"
      ? { stroke: "#1a8a3d", fill: "#ecf9f0", text: "#1b6a3a" }
      : st === "rejected"
        ? { stroke: "#d32f2f", fill: "#fdecea", text: "#b3261e" }
        : { stroke: "#e0a93b", fill: "#fff7e8", text: "#8a5a00" };

  const rjW = 140, rjX = nRight + 78, rjCX = rjX + rjW / 2;
  const rjY = ny(3), rjH = NH;
  const retY = ny(restartIdx);
  const W = rjX + rjW + PADX;
  const H = Math.max(ny(5) + NH + PADY, divStartY + divTotalH + PADY);

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
            {[["awfArr", GREY], ["awfArrGreen", GREEN], ["awfR", RED], ["awfG0", GREY], ["awfAmber", "#e0a93b"]].map(([id, col]) => (
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

          <RejectBranch i={2} />
          <RejectBranch i={4} />

          {/* Reject routing — shown UP FRONT as a faint dashed path (where a
             rejection would go and where it restarts) and lit red once a
             rejection actually happens. */}
          {(() => {
            const col = isRejected ? RED : GREY;
            const dash = isRejected ? "0" : "5 4";
            const marker = isRejected ? "url(#awfR)" : "url(#awfG0)";
            const fill = isRejected ? "#fdecea" : "#fff";
            const textFill = isRejected ? RED : "#8a97ab";
            const sub = returnSub.length > 22 ? returnSub.slice(0, 21) + "…" : returnSub;
            return (
              <>
                {/* Rejected convergence node */}
                <rect x={rjX} y={rjY} width={rjW} height={rjH} rx={rjH / 2}
                  fill={fill} stroke={col} strokeWidth={isRejected ? 2 : 1.5} strokeDasharray={dash} />
                <text x={rjCX} y={rjY + rjH / 2} textAnchor="middle" dominantBaseline="middle"
                  fontSize="11.5" fontWeight="700" fill={textFill}>✕ Rejected</text>

                {/* Rejected → Returned */}
                <path d={`M ${rjX + 30} ${rjY} V ${retY + NH}`} fill="none" stroke={col}
                  strokeWidth={2} strokeDasharray={dash} markerEnd={marker} />
                {/* Returned-to node */}
                <rect x={rjX} y={retY} width={rjW} height={NH} rx={10}
                  fill={fill} stroke={col} strokeWidth={isRejected ? 2 : 1.5} strokeDasharray={dash} />
                <text x={rjCX} y={retY + NH / 2} textAnchor="middle" dominantBaseline="middle"
                  fontSize="11" fontWeight="700" fill={textFill}>
                  <tspan x={rjCX} dy="-0.15em">{returnTitle}</tspan>
                  <tspan x={rjCX} dy="1.2em" fontWeight="500">{sub}</tspan>
                </text>
                {/* loop back to the stage the workflow restarts from */}
                <line x1={rjX} y1={nmid(restartIdx)} x2={nRight} y2={nmid(restartIdx)} stroke={col}
                  strokeWidth={2} strokeDasharray="5 4" markerEnd={marker} />
                <text x={(rjX + nRight) / 2} y={nmid(restartIdx) - 6} textAnchor="middle"
                  fontSize="10" fontWeight="700" fill={textFill}>Restart</text>
              </>
            );
          })()}

          {/* Concerned-division boxes (left lane) with fan-in arrows into
             the Concerned Division stage. */}
          {hasDivs && (
            <>
              <text x={divbX} y={Math.max(PADY + 9, divStartY - 8)} fontSize="9.5"
                fontWeight="800" fill="#66788f" letterSpacing="0.4">DIVISIONS</text>
              {divApprovals.map((d, i) => {
                const st = String(d.status || "pending").toLowerCase();
                const c = divBoxColor(st);
                const y = divBoxY(i), my = y + DIVB_H / 2;
                const glyph = st === "approved" ? "✓" : st === "rejected" ? "✕" : "⏳";
                const busX = nx - 26;
                return (
                  <g key={`${d.division}-${i}`}>
                    {/* fan-in connector: box → vertical bus → Concerned Division */}
                    <path d={`M ${divbX + DIVB_W} ${my} H ${busX} V ${nmid(2)} H ${nx}`}
                      fill="none" stroke={c.stroke} strokeWidth={1.5}
                      markerEnd={st === "approved" ? "url(#awfArrGreen)" : st === "rejected" ? "url(#awfR)" : "url(#awfAmber)"}
                      opacity="0.85" />
                    <rect x={divbX} y={y} width={DIVB_W} height={DIVB_H} rx={7}
                      fill={c.fill} stroke={c.stroke} strokeWidth={1.5} />
                    <text x={divbX + 9} y={my} dominantBaseline="middle" fontSize="10.5"
                      fontWeight="700" fill={c.text}>
                      {glyph} {String(divisionName(d.division)).slice(0, 14)}
                    </text>
                  </g>
                );
              })}
            </>
          )}

          {FLOW_STEPS.map((s, i) => <Node key={s.key} i={i} />)}
        </svg>
      </div>

      {isRejected && (
        <div className="pmis-awf-graph__reject-info">
          <div className="pmis-awf-graph__reject-info-title">✕ Rejection details</div>
          <div>
            <b>Rejected by:</b> {rejectedBy || (ownerRejected ? "Activity Owner" : "Concerned Division")}
          </div>
          <div>
            <b>Returned to:</b>{" "}
            {toDivisions
              ? `Concerned Division(s) — ${revertDivisions.join(", ")}`
              : "Vendor (resubmit required)"}
          </div>
          <div>
            <b>Restarts from:</b> {restartLabel}
          </div>
          {rejectReason && (
            <div><b>Reason:</b> {rejectReason}</div>
          )}
        </div>
      )}

      <div className="pmis-awf-graph__legend">
        <span><i className="pmis-awf-graph__sw pmis-awf-graph__sw--done" /> Completed</span>
        <span><i className="pmis-awf-graph__sw pmis-awf-graph__sw--active" /> Current</span>
        <span><i className="pmis-awf-graph__sw pmis-awf-graph__sw--todo" /> Pending</span>
        <span><i className="pmis-awf-graph__sw pmis-awf-graph__sw--reject" /> Rejection path</span>
      </div>
    </div>
  );
}
