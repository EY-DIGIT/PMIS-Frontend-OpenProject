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

export default function WorkflowGraph({ form }) {
  const state = String((form && form.approvalState) || "idle");
  const rejection = (form && form.lastRejection) || {};
  const rejectedFrom = String(rejection.byKind || "").toLowerCase();
  const divisionRejected = safeArray(form && form.divisionApprovals).some(
    (d) => d && String(d.status || "").toLowerCase() === "rejected"
  );
  const ownerRejected =
    String((form && form.ownerApproval && form.ownerApproval.status) || "").toLowerCase() ===
    "rejected";
  const stateRejected = state === "rejected_to_vendor";
  const isRejected = stateRejected || divisionRejected || ownerRejected;
  const rejIdx = ownerRejected || rejectedFrom === "owner" ? 4 : 2;
  const activeIdx = FLOW_STEPS.findIndex((s) => s.states.includes(state));

  // ── geometry (vertical top → bottom flow) ──
  const NW = 188, NH = 46, VGAP = 30, PADX = 16, PADY = 14;
  const nx = PADX, ncx = nx + NW / 2, nRight = nx + NW;
  const ny = (i) => PADY + i * (NH + VGAP);
  const nmid = (i) => ny(i) + NH / 2;

  const isCompleted = state === "completed";
  const kindOf = (i) => {
    if (isCompleted) return "done";
    if (i === activeIdx) return "active";
    if (activeIdx >= 0 && i < activeIdx) return "done";
    return "todo";
  };

  const rjW = 140, rjX = nRight + 78, rjCX = rjX + rjW / 2;
  const rjY = ny(3), rjH = NH;
  const retY = ny(1);
  const W = rjX + rjW + PADX;
  const H = ny(5) + NH + PADY;

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
            {[["awfArr", GREY], ["awfArrGreen", GREEN], ["awfR", RED], ["awfG0", GREY]].map(([id, col]) => (
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

          {/* Rejected node */}
          <rect x={rjX} y={rjY} width={rjW} height={rjH} rx={rjH / 2}
            fill={isRejected ? "#fdecea" : "#fff"} stroke={isRejected ? RED : GREY}
            strokeWidth={isRejected ? 2 : 1.5} strokeDasharray={isRejected ? "0" : "5 4"} />
          <text x={rjCX} y={rjY + rjH / 2} textAnchor="middle" dominantBaseline="middle"
            fontSize="11.5" fontWeight="700" fill={isRejected ? RED : "#8a97ab"}>✕ Rejected</text>

          {isRejected && (
            <>
              <path d={`M ${rjX + 30} ${rjY} V ${retY + NH}`} fill="none" stroke={RED}
                strokeWidth={2} markerEnd="url(#awfR)" />
              <rect x={rjX} y={retY} width={rjW} height={NH} rx={10}
                fill="#fdecea" stroke={RED} strokeWidth={2} />
              <text x={rjCX} y={retY + NH / 2} textAnchor="middle" dominantBaseline="middle"
                fontSize="11" fontWeight="700" fill={RED}>
                <tspan x={rjCX} dy="-0.15em">Returned to Vendor</tspan>
                <tspan x={rjCX} dy="1.2em" fontWeight="500">Resubmit required</tspan>
              </text>
              <line x1={rjX} y1={nmid(1)} x2={nRight} y2={nmid(1)} stroke={RED}
                strokeWidth={2} strokeDasharray="5 4" markerEnd="url(#awfR)" />
              <text x={(rjX + nRight) / 2} y={nmid(1) - 6} textAnchor="middle"
                fontSize="10" fontWeight="700" fill={RED}>Resubmit</text>
            </>
          )}

          {FLOW_STEPS.map((s, i) => <Node key={s.key} i={i} />)}
        </svg>
      </div>

      <div className="pmis-awf-graph__legend">
        <span><i className="pmis-awf-graph__sw pmis-awf-graph__sw--done" /> Completed</span>
        <span><i className="pmis-awf-graph__sw pmis-awf-graph__sw--active" /> Current</span>
        <span><i className="pmis-awf-graph__sw pmis-awf-graph__sw--todo" /> Pending</span>
        <span><i className="pmis-awf-graph__sw pmis-awf-graph__sw--reject" /> Rejection path</span>
      </div>
    </div>
  );
}
