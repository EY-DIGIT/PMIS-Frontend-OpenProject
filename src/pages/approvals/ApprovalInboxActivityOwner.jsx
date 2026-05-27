/* ══════════════════════════════════════════════════════════════════
   ApprovalInboxActivityOwner.jsx — inbox for an Activity Owner. The
   Owner is the final decision-maker after every Concerned Division has
   approved.

     • Approve → activity is marked Completed
     • Reject  → user picks a revert target:
                   - Organization (full restart)
                   - Concerned Divisions (multi-select, re-examination)

   Ported from "Approval Inbox Activity Owner.html". Mock data driven;
   wire to a real listing endpoint when backend ships one.
   ══════════════════════════════════════════════════════════════════ */

import React, { useMemo, useState } from "react";
import { formatDateTime } from "../../utils/project/helpers";
import { transitionActivity, WORKFLOW_ACTIONS } from "../../api/activityWorkflow";
import "../../styles/project/approvalInbox.css";

const CURRENT_USER = {
  name: "Vikram Singh",
  division: "TMD2",
  divisionLong: "Activity Owner · TMD2",
  role: "activity_owner"
};

const SEED_ITEMS = [
  {
    requestId: "AP-2026-201",
    projectId: "PRJ-2026-018",
    projectName: "Aadhaar Authentication API v3.0 Upgrade",
    activity: {
      id: "A1.1",
      name: "Project Charter & Scope Statement",
      owner: "TMD2",
      vendor: "Wipro Limited",
      consentDivisions: ["TMD1", "PMO"],
      plannedDates: "2026-03-01 to 2026-03-18",
      description:
        "Charter covering scope inclusions/exclusions, success criteria, stakeholder register and high-level milestones for the API v3.0 programme."
    },
    submittedAt: "2026-03-19T09:20:00",
    divisionDecisions: [
      { division: "TMD1", status: "approved" },
      { division: "PMO", status: "approved" }
    ],
    comments: [
      {
        kind: "user",
        who: "Wipro Limited",
        when: "2026-03-17T18:05:00",
        text:
          "Charter packet attached — scope, stakeholder register and milestone plan aligned with the BSP contract clauses. Out-of-scope items listed explicitly. Requesting sign-off.",
        attachments: [
          { name: "Charter_v1.0.pdf", size: "1.8 MB" },
          { name: "Stakeholder_Register.xlsx", size: "214 KB" }
        ]
      }
    ]
  },
  {
    requestId: "AP-2026-205",
    projectId: "PRJ-2026-018",
    projectName: "Aadhaar Authentication API v3.0 Upgrade",
    activity: {
      id: "A1.4",
      name: "Risk Assessment Matrix",
      owner: "TMD2",
      vendor: "Deloitte Touche Tohmatsu India LLP",
      consentDivisions: ["TMD1", "PMO"],
      plannedDates: "2026-04-05 to 2026-04-25",
      description:
        "Risk register covering technical, operational and compliance risks with mitigation plans and owners. Heat-mapped and prioritised."
    },
    submittedAt: "2026-05-12T11:05:00",
    divisionDecisions: [
      { division: "TMD1", status: "approved" },
      { division: "PMO", status: "approved" }
    ],
    comments: [
      {
        kind: "user",
        who: "Deloitte Touche Tohmatsu India LLP",
        when: "2026-05-10T18:32:00",
        text:
          "Latest submission. Addressed prior owner feedback — added rollout-window risk, re-scored crypto-migration risks from Medium to High and updated the heat-map.",
        attachments: [
          { name: "Risk_Matrix_v2.0.xlsx", size: "468 KB" },
          { name: "Risk_Heatmap_v2.pdf", size: "1.1 MB" }
        ]
      }
    ]
  },
  {
    requestId: "AP-2026-209",
    projectId: "PRJ-2026-018",
    projectName: "Aadhaar Authentication API v3.0 Upgrade",
    activity: {
      id: "A3.1",
      name: "Production Deployment Runbook",
      owner: "TMD2",
      vendor: "TechSolutions India Pvt Ltd",
      consentDivisions: ["TMD1", "PMO", "ECMD"],
      plannedDates: "2026-08-15 to 2026-08-30",
      description:
        "Deployment runbook — blue-green cut-over plan, canary gates, rollback triggers, error-budget thresholds and the war-room comms tree."
    },
    submittedAt: "2026-05-21T11:00:00",
    divisionDecisions: [
      { division: "TMD1", status: "approved" },
      { division: "PMO", status: "approved" },
      { division: "ECMD", status: "approved" }
    ],
    comments: [
      {
        kind: "user",
        who: "TechSolutions India Pvt Ltd",
        when: "2026-05-19T17:42:00",
        text:
          "Final runbook for the API v3.0 production deployment. Blue-green strategy with progressive canary gates (5/25/50/100%), rollback triggers and war-room comms tree. Validated against two dry-runs.",
        attachments: [
          { name: "Deployment_Runbook_v1.0.pdf", size: "2.4 MB" },
          { name: "Rollback_Triggers.xlsx", size: "182 KB" }
        ]
      }
    ]
  },
  {
    requestId: "AP-2026-214",
    projectId: "PRJ-2026-021",
    projectName: "Aadhaar PVC Card Issuance Modernization",
    activity: {
      id: "A2.3",
      name: "User Training Materials",
      owner: "TMD2",
      vendor: "Tata Elxsi Limited",
      consentDivisions: ["PMO", "TMD1"],
      plannedDates: "2026-05-25 to 2026-06-15",
      description:
        "Training kit for residents and operators — walkthrough videos, illustrated PDF guides, FAQs and quick-reference cards (English + Hindi)."
    },
    submittedAt: "2026-05-22T10:00:00",
    divisionDecisions: [
      { division: "PMO", status: "approved" },
      { division: "TMD1", status: "approved" }
    ],
    comments: [
      {
        kind: "user",
        who: "Tata Elxsi Limited",
        when: "2026-05-20T19:18:00",
        text:
          "Training kit submitted — illustrated walkthrough PDF (EN + HI), 90-second walkthrough video, operator training deck and the FAQ library (49 entries).",
        attachments: [
          { name: "Resident_Walkthrough_EN_HI.pdf", size: "3.2 MB" },
          { name: "Operator_Training_Deck.pptx", size: "4.1 MB" }
        ]
      }
    ]
  }
];

function cap(s) {
  return s ? s[0].toUpperCase() + s.slice(1) : s;
}

/* Activity Owner's decision IS the request's final status — they are the
   final decision-maker. Pending until they act. */
function getStatus(item, decisions) {
  const local = decisions[item.requestId];
  return local ? local.status : "pending";
}

export default function ApprovalInboxActivityOwner() {
  const [items] = useState(SEED_ITEMS);
  const [decisions, setDecisions] = useState({});
  const [filterText, setFilterText] = useState("");
  const [filterStatus, setFilterStatus] = useState("all");
  const [activeId, setActiveId] = useState(null);
  const [rejection, setRejection] = useState({
    open: false,
    reason: "",
    revertKind: "",
    revertDivisions: []
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const filtered = useMemo(() => {
    const q = filterText.trim().toLowerCase();
    return items.filter((it) => {
      if (filterStatus !== "all" && getStatus(it, decisions) !== filterStatus) return false;
      if (q) {
        const hay = (
          it.activity.id +
          " " +
          it.activity.name +
          " " +
          it.projectId +
          " " +
          it.projectName +
          " " +
          it.activity.vendor
        ).toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [items, decisions, filterText, filterStatus]);

  const active = useMemo(
    () => (activeId ? items.find((x) => x.requestId === activeId) || null : null),
    [activeId, items]
  );

  function openReview(id) {
    setActiveId(id);
    setRejection({ open: false, reason: "", revertKind: "", revertDivisions: [] });
    setError("");
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function closeReview() {
    setActiveId(null);
    setRejection({ open: false, reason: "", revertKind: "", revertDivisions: [] });
    setError("");
  }

  async function fireTransition(item, action, comment) {
    const businessId = item.activity && (item.activity.apiId || item.activity.id);
    if (!businessId) return;
    try {
      await transitionActivity({ businessId, action, comment });
    } catch (e) {
      // eslint-disable-next-line no-console
      console.warn("[ApprovalInbox] transition call failed:", e);
    }
  }

  async function approve() {
    if (!active) return;
    if (!window.confirm(`Approve "${active.activity.name}" and mark the activity Completed?`)) return;
    setBusy(true);
    setError("");
    try {
      await fireTransition(active, WORKFLOW_ACTIONS.APPROVE, "Activity Owner approved.");
      const now = new Date().toISOString();
      setDecisions((d) => ({
        ...d,
        [active.requestId]: { status: "approved", at: now, reason: "" }
      }));
    } catch (e) {
      setError(e && e.message ? e.message : "Failed to approve.");
    } finally {
      setBusy(false);
    }
  }

  function beginRejection() {
    setRejection({ open: true, reason: "", revertKind: "", revertDivisions: [] });
  }
  function cancelRejection() {
    setRejection({ open: false, reason: "", revertKind: "", revertDivisions: [] });
  }
  function setRevertKind(kind) {
    setRejection((s) => ({
      ...s,
      revertKind: kind,
      revertDivisions: kind === "divisions" ? s.revertDivisions : []
    }));
  }
  function toggleRevertDivision(d, checked) {
    setRejection((s) => {
      const set = new Set(s.revertDivisions);
      if (checked) set.add(d);
      else set.delete(d);
      return { ...s, revertDivisions: Array.from(set) };
    });
  }
  function setReason(text) {
    setRejection((s) => ({ ...s, reason: text }));
  }

  const canConfirmReject = (() => {
    const reasonOk = rejection.reason.trim().length >= 10;
    let targetOk = false;
    if (rejection.revertKind === "vendor") targetOk = true;
    else if (rejection.revertKind === "divisions") targetOk = rejection.revertDivisions.length > 0;
    return reasonOk && targetOk;
  })();

  async function confirmRejection() {
    if (!active) return;
    if (!canConfirmReject) return;
    const targetLabel =
      rejection.revertKind === "vendor"
        ? `organization (${active.activity.vendor})`
        : `${rejection.revertDivisions.join(", ")} for re-examination`;
    if (!window.confirm(`Reject "${active.activity.name}" and revert to ${targetLabel}?`)) return;
    setBusy(true);
    setError("");
    try {
      await fireTransition(active, WORKFLOW_ACTIONS.REJECT, rejection.reason.trim());
      const now = new Date().toISOString();
      setDecisions((d) => ({
        ...d,
        [active.requestId]: {
          status: "rejected",
          at: now,
          reason: rejection.reason.trim(),
          revertKind: rejection.revertKind,
          revertDivisions:
            rejection.revertKind === "divisions" ? [...rejection.revertDivisions] : []
        }
      }));
      setRejection({ open: false, reason: "", revertKind: "", revertDivisions: [] });
    } catch (e) {
      setError(e && e.message ? e.message : "Failed to reject.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="pmis-apinbox">
      <div className="pmis-apinbox-head">
        <h1>Approval Inbox</h1>
        <div className="pmis-apinbox-sub">{CURRENT_USER.divisionLong}</div>
        <div className="pmis-apinbox-desc">
          Activities awaiting your final decision as Activity Owner. All consent divisions have
          already approved.
        </div>
      </div>

      <div className="pmis-apinbox-card">
        {!active && (
          <div className="pmis-apinbox-card-head">
            <h2 className="pmis-apinbox-card-title">
              All Approvals{" "}
              <span className="pmis-apinbox-meta">
                {filtered.length === items.length
                  ? `(${items.length})`
                  : `(${filtered.length} of ${items.length})`}
              </span>
            </h2>
            <div className="pmis-apinbox-filters">
              <input
                type="search"
                className="pmis-apinbox-input"
                placeholder="Search activity, project or organization…"
                value={filterText}
                onChange={(e) => setFilterText(e.target.value)}
              />
              <select
                className="pmis-apinbox-select"
                value={filterStatus}
                onChange={(e) => setFilterStatus(e.target.value)}
              >
                <option value="all">All Statuses</option>
                <option value="pending">Pending</option>
                <option value="approved">Approved</option>
                <option value="rejected">Rejected</option>
              </select>
            </div>
          </div>
        )}

        {active && (
          <div className="pmis-apinbox-card-head">
            <button type="button" className="pmis-apinbox-btn--back" onClick={closeReview}>
              <span aria-hidden="true">←</span> Back to Inbox
            </button>
          </div>
        )}

        {!active && (
          <div className="pmis-apinbox-table-wrap">
            <table className="pmis-apinbox-table">
              <thead>
                <tr>
                  <th>Activity</th>
                  <th>Project</th>
                  <th>Organization</th>
                  <th>Submitted</th>
                  <th>Status</th>
                  <th style={{ textAlign: "right" }}>Action</th>
                </tr>
              </thead>
              <tbody>
                {filtered.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="pmis-apinbox-empty">
                      No items match the current filters.
                    </td>
                  </tr>
                ) : (
                  filtered.map((it) => {
                    const st = getStatus(it, decisions);
                    return (
                      <tr key={it.requestId}>
                        <td>
                          <div className="pmis-apinbox-cell-id">{it.activity.id}</div>
                          <button
                            type="button"
                            className="pmis-apinbox-link pmis-apinbox-cell-name"
                            onClick={() => openReview(it.requestId)}
                          >
                            {it.activity.name}
                          </button>
                        </td>
                        <td>
                          <div>{it.projectName}</div>
                          <div className="pmis-apinbox-cell-sub">{it.projectId}</div>
                        </td>
                        <td>{it.activity.vendor}</td>
                        <td>{formatDateTime(it.submittedAt)}</td>
                        <td>
                          <span className={`pmis-apinbox-pill pmis-apinbox-pill--${st}`}>
                            {cap(st)}
                          </span>
                        </td>
                        <td className="pmis-apinbox-cell-actions">
                          <button
                            type="button"
                            className="pmis-apinbox-btn pmis-apinbox-btn--sm"
                            onClick={() => openReview(it.requestId)}
                          >
                            Review
                          </button>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        )}

        {active && (
          <DetailView
            item={active}
            decision={decisions[active.requestId]}
            busy={busy}
            error={error}
            rejection={rejection}
            canConfirmReject={canConfirmReject}
            onSetReason={setReason}
            onSetRevertKind={setRevertKind}
            onToggleRevertDivision={toggleRevertDivision}
            onBeginReject={beginRejection}
            onCancelReject={cancelRejection}
            onApprove={approve}
            onConfirmReject={confirmRejection}
            onClose={closeReview}
          />
        )}
      </div>
    </div>
  );
}

function DetailView({
  item,
  decision,
  busy,
  error,
  rejection,
  canConfirmReject,
  onSetReason,
  onSetRevertKind,
  onToggleRevertDivision,
  onBeginReject,
  onCancelReject,
  onApprove,
  onConfirmReject,
  onClose
}) {
  const a = item.activity;
  const status = decision ? decision.status : "pending";

  return (
    <div className="pmis-apinbox-detail">
      <div className="pmis-apinbox-detail-title-block">
        <div style={{ flex: "1 1 320px", minWidth: 0 }}>
          <div className="pmis-apinbox-detail-eyebrow">Approval Request</div>
          <div className="pmis-apinbox-detail-title">
            <span>{a.name}</span>
            <span className="pmis-apinbox-detail-title-id">{a.id}</span>
          </div>
        </div>
        <div style={{ paddingTop: 24 }}>
          <span className={`pmis-apinbox-pill pmis-apinbox-pill--${status}`}>{cap(status)}</span>
        </div>
      </div>

      {decision && decision.status === "approved" && (
        <div className="pmis-apinbox-decided pmis-apinbox-decided--approved">
          <div>
            <b>You approved this request</b> on {formatDateTime(decision.at)}.
          </div>
          <div>Activity has been marked as Completed.</div>
        </div>
      )}
      {decision && decision.status === "rejected" && (
        <div className="pmis-apinbox-decided pmis-apinbox-decided--rejected">
          <div>
            <b>You rejected this request</b> on {formatDateTime(decision.at)}.
          </div>
          <div>
            <b>Reverted to:</b>{" "}
            {decision.revertKind === "vendor"
              ? `Organization (${a.vendor}) — full restart`
              : `${
                  (decision.revertDivisions || []).length > 1
                    ? "Concerned Divisions"
                    : "Concerned Division"
                } — ${(decision.revertDivisions || []).join(
                  ", "
                )} (re-examination only)`}
          </div>
          <div>
            <b>Reason:</b> {decision.reason}
          </div>
        </div>
      )}

      <div className="pmis-apinbox-section">
        <div className="pmis-apinbox-section-head">
          <h3>Project</h3>
        </div>
        <div className="pmis-apinbox-project-line">
          {item.projectName}
          <span className="pmis-apinbox-pid">{item.projectId}</span>
        </div>
      </div>

      <div className="pmis-apinbox-section">
        <div className="pmis-apinbox-section-head">
          <h3>Activity Details</h3>
        </div>
        <div className="pmis-apinbox-kv">
          <div>
            <div className="pmis-apinbox-k">Organization</div>
            <div className="pmis-apinbox-v pmis-apinbox-v--strong">{a.vendor}</div>
          </div>
          <div>
            <div className="pmis-apinbox-k">Activity Owner</div>
            <div className="pmis-apinbox-v">{a.owner}</div>
          </div>
          <div>
            <div className="pmis-apinbox-k">Planned Dates</div>
            <div className="pmis-apinbox-v">{a.plannedDates}</div>
          </div>
          <div>
            <div className="pmis-apinbox-k">Submitted</div>
            <div className="pmis-apinbox-v">{formatDateTime(item.submittedAt)}</div>
          </div>
          <div className="pmis-apinbox-kv-full">
            <div className="pmis-apinbox-k">Consent Divisions</div>
            <div className="pmis-apinbox-v">{a.consentDivisions.join(", ")}</div>
          </div>
          <div className="pmis-apinbox-kv-full">
            <div className="pmis-apinbox-k">Description</div>
            <div className="pmis-apinbox-v pmis-apinbox-desc-text">{a.description}</div>
          </div>
        </div>
      </div>

      <div className="pmis-apinbox-section">
        <div className="pmis-apinbox-section-head">
          <h3>Organization Submission</h3>
        </div>
        {item.comments.map((c, i) => (
          <div key={i} className="pmis-apinbox-cmt">
            <div className="pmis-apinbox-cmt-meta">
              <span className="pmis-apinbox-who">{c.who}</span>
              <span>{formatDateTime(c.when)}</span>
            </div>
            <div className="pmis-apinbox-cmt-text">{c.text}</div>
            {Array.isArray(c.attachments) && c.attachments.length > 0 && (
              <div className="pmis-apinbox-cmt-atts">
                {c.attachments.map((att, j) => (
                  <span key={j} className="pmis-apinbox-att" title={att.name}>
                    📎 {att.name}{" "}
                    <span className="pmis-apinbox-att-size">{att.size}</span>
                  </span>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>

      <div className="pmis-apinbox-section">
        <div className="pmis-apinbox-section-head">
          <h3>Division Status</h3>
        </div>
        <div className="pmis-apinbox-div-status">
          {item.divisionDecisions.map((d) => (
            <div key={d.division} className="pmis-apinbox-ds">
              <span className="pmis-apinbox-nm">{d.division}</span>
              <span className={`pmis-apinbox-pill pmis-apinbox-pill--${d.status}`}>
                {cap(d.status)}
              </span>
            </div>
          ))}
          {!item.divisionDecisions.some((d) => d.division === CURRENT_USER.division) && (
            <div className="pmis-apinbox-ds pmis-apinbox-ds--me">
              <span className="pmis-apinbox-nm">
                {CURRENT_USER.division}{" "}
                <span className="pmis-apinbox-you">YOU · OWNER</span>
              </span>
              <span className={`pmis-apinbox-pill pmis-apinbox-pill--${status}`}>
                {cap(status)}
              </span>
            </div>
          )}
        </div>
      </div>

      {error && (
        <div
          style={{
            padding: 10,
            background: "#fdecec",
            border: "1px solid #f4b8b8",
            color: "#9b1c1c",
            borderRadius: 6,
            fontSize: 13
          }}
        >
          {error}
        </div>
      )}

      {decision ? (
        <div className="pmis-apinbox-actions">
          <button
            type="button"
            className="pmis-apinbox-btn pmis-apinbox-btn--cancel"
            onClick={onClose}
          >
            Back to Inbox
          </button>
        </div>
      ) : rejection.open ? (
        <div className="pmis-apinbox-reject">
          <div>
            <label htmlFor="rejectReason">Reason for rejection</label>
            <textarea
              id="rejectReason"
              placeholder="Specific reason — what needs to be fixed?"
              value={rejection.reason}
              onChange={(e) => onSetReason(e.target.value)}
              disabled={busy}
            />
          </div>
          <div>
            <label>Revert workflow to</label>
            <div className="pmis-apinbox-revert-kind">
              <label
                className={`pmis-apinbox-opt${
                  rejection.revertKind === "vendor" ? " is-selected" : ""
                }`}
              >
                <input
                  type="radio"
                  name="revertKind"
                  value="vendor"
                  checked={rejection.revertKind === "vendor"}
                  onChange={() => onSetRevertKind("vendor")}
                  disabled={busy}
                />
                <span className="pmis-apinbox-opt-body">
                  <span className="pmis-apinbox-opt-title">Organization</span>
                  <span className="pmis-apinbox-opt-sub">
                    Full restart — all consent divisions will re-review after the organization
                    resubmits.
                  </span>
                </span>
              </label>
              <label
                className={`pmis-apinbox-opt${
                  rejection.revertKind === "divisions" ? " is-selected" : ""
                }`}
              >
                <input
                  type="radio"
                  name="revertKind"
                  value="divisions"
                  checked={rejection.revertKind === "divisions"}
                  onChange={() => onSetRevertKind("divisions")}
                  disabled={busy}
                />
                <span className="pmis-apinbox-opt-body">
                  <span className="pmis-apinbox-opt-title">Concerned Divisions</span>
                  <span className="pmis-apinbox-opt-sub">
                    Re-examination only — pick one or more divisions to review again.
                  </span>
                </span>
              </label>
            </div>
            <div className="pmis-apinbox-revert-panel">
              {rejection.revertKind === "vendor" && (
                <div className="pmis-apinbox-panel-hint">
                  The workflow will revert to the organization for resubmission.
                </div>
              )}
              {rejection.revertKind === "divisions" && (
                <>
                  <div className="pmis-apinbox-panel-hint">
                    Select one or more divisions for re-examination.
                  </div>
                  {a.consentDivisions.length === 0 ? (
                    <div className="pmis-apinbox-panel-hint">
                      No consent divisions are configured for this activity.
                    </div>
                  ) : (
                    <div className="pmis-apinbox-checklist">
                      {a.consentDivisions.map((d) => {
                        const checked = rejection.revertDivisions.includes(d);
                        return (
                          <label key={d} className={checked ? "is-checked" : ""}>
                            <input
                              type="checkbox"
                              checked={checked}
                              onChange={(e) => onToggleRevertDivision(d, e.target.checked)}
                              disabled={busy}
                            />
                            <span>{d}</span>
                          </label>
                        );
                      })}
                    </div>
                  )}
                </>
              )}
              {!rejection.revertKind && (
                <div className="pmis-apinbox-panel-hint">
                  Choose Organization or Concerned Divisions above to continue.
                </div>
              )}
            </div>
          </div>
          <div className="pmis-apinbox-reject-actions">
            <button
              type="button"
              className="pmis-apinbox-btn pmis-apinbox-btn--cancel"
              onClick={onCancelReject}
              disabled={busy}
            >
              Cancel
            </button>
            <button
              type="button"
              className="pmis-apinbox-btn pmis-apinbox-btn--danger"
              disabled={busy || !canConfirmReject}
              onClick={onConfirmReject}
            >
              {busy ? "Submitting…" : "Confirm Rejection"}
            </button>
          </div>
        </div>
      ) : (
        <div className="pmis-apinbox-actions">
          <button
            type="button"
            className="pmis-apinbox-btn pmis-apinbox-btn--cancel"
            onClick={onClose}
            disabled={busy}
          >
            Back to Inbox
          </button>
          <button
            type="button"
            className="pmis-apinbox-btn pmis-apinbox-btn--danger"
            onClick={onBeginReject}
            disabled={busy}
          >
            Reject
          </button>
          <button
            type="button"
            className="pmis-apinbox-btn"
            onClick={onApprove}
            disabled={busy}
          >
            {busy ? "Submitting…" : "Approve & Complete"}
          </button>
        </div>
      )}
    </div>
  );
}
