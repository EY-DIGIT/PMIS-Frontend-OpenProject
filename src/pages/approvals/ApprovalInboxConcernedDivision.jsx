/* ══════════════════════════════════════════════════════════════════
   ApprovalInboxConcernedDivision.jsx — inbox for a Concerned Division
   reviewer. Lists activity approval requests routed to the user's
   division; the user reviews each and either approves or rejects with
   a reason.

   Ported from the reference HTML prototype "Approval Inbox Concerned
   Division TMD1.html". Uses CSS classes from approvalInbox.css with
   the `pmis-apinbox-` prefix.

   NOTE: currently driven by mock data because the backend doesn't
   expose an inbox-listing endpoint yet. Approve / Reject use the
   existing transitionActivity() API when an apiId is available,
   otherwise update local state only.
   ══════════════════════════════════════════════════════════════════ */

import React, { useMemo, useState } from "react";
import { formatDateTime } from "../../utils/project/helpers";
import { transitionActivity, WORKFLOW_ACTIONS } from "../../api/activityWorkflow";
import "../../styles/project/approvalInbox.css";

const CURRENT_USER = {
  name: "Rajesh Kumar",
  division: "TMD1",
  divisionLong: "TMD1 — Technology & Modules Division 1",
  role: "concerned_division"
};

const SEED_ITEMS = [
  {
    requestId: "AP-2026-118",
    projectId: "PRJ-2026-018",
    projectName: "Aadhaar Authentication API v3.0 Upgrade",
    activity: {
      id: "A2.1",
      name: "API Implementation Documentation",
      owner: "TMD2",
      vendor: "TechSolutions India Pvt Ltd",
      consentDivisions: ["TMD1", "PMO"],
      plannedDates: "2026-06-01 to 2026-06-20",
      description:
        "Implementation documentation covering the new authentication endpoints — request/response schemas, error codes and migration notes for downstream consumers."
    },
    submittedAt: "2026-05-21T14:30:00",
    divisionDecisions: [
      { division: "TMD1", status: "pending" },
      { division: "PMO", status: "pending" }
    ],
    comments: [
      {
        kind: "user",
        who: "TechSolutions India Pvt Ltd",
        when: "2026-05-21T14:30:00",
        text:
          "API implementation documentation submitted for review. All four authentication endpoints documented with schema, error codes and migration notes. Requesting consent-division approval.",
        attachments: [
          { name: "API_Implementation_v1.0.pdf", size: "2.1 MB" },
          { name: "Migration_Guide.pdf", size: "480 KB" }
        ]
      }
    ]
  },
  {
    requestId: "AP-2026-121",
    projectId: "PRJ-2026-018",
    projectName: "Aadhaar Authentication API v3.0 Upgrade",
    activity: {
      id: "A1.2",
      name: "Security Audit Plan",
      owner: "TMD2",
      vendor: "Infosys Limited",
      consentDivisions: ["TMD1", "PMO"],
      plannedDates: "2026-04-10 to 2026-04-30",
      description:
        "Security audit plan for the API v3.0 upgrade — scope, methodology, test environments and the responsible parties for each audit phase."
    },
    submittedAt: "2026-05-22T09:15:00",
    divisionDecisions: [
      { division: "TMD1", status: "pending" },
      { division: "PMO", status: "pending" }
    ],
    comments: [
      {
        kind: "user",
        who: "Infosys Limited",
        when: "2026-05-22T09:15:00",
        text:
          "Latest submission. Addressed PMO feedback — added penetration-test scope, updated audit timelines and clarified the rollback procedure for security findings.",
        attachments: [
          { name: "Security_Audit_Plan_v2.pdf", size: "1.4 MB" },
          { name: "Pentest_Scope.pdf", size: "320 KB" }
        ]
      }
    ]
  },
  {
    requestId: "AP-2026-122",
    projectId: "PRJ-2026-018",
    projectName: "Aadhaar Authentication API v3.0 Upgrade",
    activity: {
      id: "A2.2",
      name: "Test Plan Documentation",
      owner: "TMD1",
      vendor: "Digi Verify Services",
      consentDivisions: ["TMD2", "PMO", "TMD1"],
      plannedDates: "2026-06-10 to 2026-06-25",
      description:
        "Test plan documenting unit, integration, performance and security test coverage for the API v3.0 endpoints, with pass/fail criteria and defect-handling workflow."
    },
    submittedAt: "2026-05-20T11:00:00",
    divisionDecisions: [
      { division: "TMD2", status: "approved" },
      { division: "PMO", status: "pending" },
      { division: "TMD1", status: "pending" }
    ],
    comments: [
      {
        kind: "user",
        who: "Digi Verify Services",
        when: "2026-05-20T11:00:00",
        text:
          "Test plan submitted covering unit, integration, performance and security testing. Pass/fail criteria documented for each layer.",
        attachments: [{ name: "Test_Plan_v1.0.pdf", size: "1.8 MB" }]
      }
    ]
  }
];

function cap(s) {
  return s ? s[0].toUpperCase() + s.slice(1) : s;
}

/* For a Concerned Division reviewer, the row's status is THIS division's
   decision — other divisions' decisions are private. */
function getMyStatus(item, decisions) {
  const local = decisions[item.requestId];
  if (local) return local.status;
  const me = item.divisionDecisions.find((d) => d.division === CURRENT_USER.division);
  return (me && me.status) || "pending";
}

export default function ApprovalInboxConcernedDivision() {
  const [items, setItems] = useState(SEED_ITEMS);
  const [decisions, setDecisions] = useState({});
  const [filterText, setFilterText] = useState("");
  const [filterStatus, setFilterStatus] = useState("all");
  const [activeId, setActiveId] = useState(null);
  const [rejection, setRejection] = useState({ open: false, reason: "" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const filtered = useMemo(() => {
    const q = filterText.trim().toLowerCase();
    return items.filter((it) => {
      if (filterStatus !== "all" && getMyStatus(it, decisions) !== filterStatus) return false;
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
    setRejection({ open: false, reason: "" });
    setError("");
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function closeReview() {
    setActiveId(null);
    setRejection({ open: false, reason: "" });
    setError("");
  }

  async function fireTransition(item, action, comment) {
    const businessId = item.activity && (item.activity.apiId || item.activity.id);
    if (!businessId) return;
    try {
      await transitionActivity({ businessId, action, comment });
    } catch (e) {
      // Surface but don't block UI — backend may not have this activity yet.
      // eslint-disable-next-line no-console
      console.warn("[ApprovalInbox] transition call failed:", e);
    }
  }

  async function approve() {
    if (!active) return;
    if (!window.confirm(`Approve "${active.activity.name}" on behalf of ${CURRENT_USER.division}?`)) return;
    setBusy(true);
    setError("");
    try {
      await fireTransition(active, WORKFLOW_ACTIONS.APPROVE, `${CURRENT_USER.division} approved.`);
      const now = new Date().toISOString();
      setDecisions((d) => ({
        ...d,
        [active.requestId]: { status: "approved", at: now, reason: "" }
      }));
      setItems((arr) =>
        arr.map((it) =>
          it.requestId !== active.requestId
            ? it
            : {
                ...it,
                divisionDecisions: it.divisionDecisions.map((dd) =>
                  dd.division === CURRENT_USER.division ? { ...dd, status: "approved" } : dd
                )
              }
        )
      );
    } catch (e) {
      setError(e && e.message ? e.message : "Failed to approve.");
    } finally {
      setBusy(false);
    }
  }

  function beginRejection() {
    setRejection({ open: true, reason: "" });
  }
  function cancelRejection() {
    setRejection({ open: false, reason: "" });
  }

  async function confirmRejection() {
    if (!active) return;
    const reason = rejection.reason.trim();
    if (reason.length < 10) {
      setError("Please provide a reason of at least 10 characters.");
      return;
    }
    if (!window.confirm(`Reject "${active.activity.name}" on behalf of ${CURRENT_USER.division}?`)) return;
    setBusy(true);
    setError("");
    try {
      await fireTransition(active, WORKFLOW_ACTIONS.REJECT, reason);
      const now = new Date().toISOString();
      setDecisions((d) => ({
        ...d,
        [active.requestId]: { status: "rejected", at: now, reason }
      }));
      setItems((arr) =>
        arr.map((it) =>
          it.requestId !== active.requestId
            ? it
            : {
                ...it,
                divisionDecisions: it.divisionDecisions.map((dd) =>
                  dd.division === CURRENT_USER.division ? { ...dd, status: "rejected" } : dd
                )
              }
        )
      );
      setRejection({ open: false, reason: "" });
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
          Activity approval requests routed to your division. Click Review to inspect the
          submission and decide.
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
                    const st = getMyStatus(it, decisions);
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
            onSetRejectionReason={(r) => setRejection((s) => ({ ...s, reason: r }))}
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
  onSetRejectionReason,
  onBeginReject,
  onCancelReject,
  onApprove,
  onConfirmReject,
  onClose
}) {
  const a = item.activity;
  const myStatus = decision ? decision.status : "pending";

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
          <span className={`pmis-apinbox-pill pmis-apinbox-pill--${myStatus}`}>
            {cap(myStatus)}
          </span>
        </div>
      </div>

      {decision && (
        <div
          className={`pmis-apinbox-decided pmis-apinbox-decided--${decision.status}`}
        >
          <div>
            <b>You {decision.status === "approved" ? "approved" : "rejected"} this request</b>{" "}
            on {formatDateTime(decision.at)}.
          </div>
          {decision.reason && (
            <div>
              <b>Reason:</b> {decision.reason}
            </div>
          )}
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
            <div className="pmis-apinbox-k">Your Division</div>
            <div className="pmis-apinbox-v">{CURRENT_USER.division}</div>
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
          <h3>Your Status</h3>
        </div>
        <div className="pmis-apinbox-div-status">
          <div className="pmis-apinbox-ds pmis-apinbox-ds--me">
            <span className="pmis-apinbox-nm">
              {CURRENT_USER.division}{" "}
              <span className="pmis-apinbox-you">YOU</span>
            </span>
            <span className={`pmis-apinbox-pill pmis-apinbox-pill--${myStatus}`}>
              {cap(myStatus)}
            </span>
          </div>
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
              onChange={(e) => onSetRejectionReason(e.target.value)}
              disabled={busy}
            />
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
              disabled={busy || rejection.reason.trim().length < 10}
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
            {busy ? "Submitting…" : "Approve"}
          </button>
        </div>
      )}
    </div>
  );
}
