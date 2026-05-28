/* ══════════════════════════════════════════════════════════════════
   ApprovalInboxConcernedDivision.jsx — inbox for a Concerned Division
   reviewer. Driven by the /api/v3/approval-inbox endpoints (list +
   detail + transition).

   List query is filtered server-side by role + status + search; clicks
   on Review fetch the detail; Approve / Reject post the transition.
   ══════════════════════════════════════════════════════════════════ */

import React, { useEffect, useMemo, useState } from "react";
import { formatDateTime } from "../../utils/project/helpers";
import { tokenStore } from "../../api/client";
import {
  listApprovalInbox,
  getApprovalInboxItem,
  transitionApprovalInbox,
  INBOX_ROLES,
  INBOX_ACTIONS
} from "../../api/approvalInbox";
import "../../styles/project/approvalInbox.css";

const CURRENT_ROLE = INBOX_ROLES.CONCERNED_DIVISION;

function cap(s) {
  return s ? s[0].toUpperCase() + s.slice(1) : s;
}

function safeArr(v) {
  return Array.isArray(v) ? v : [];
}

/* Pull a friendly division label from the stored user. */
function pickUserDivision(user) {
  if (!user) return "";
  return user.division_label || user.divisionLabel || user.division || "";
}

function pickUserName(user) {
  if (!user) return "";
  const first = (user.first_name || user.firstName || "").trim();
  const last = (user.last_name || user.lastName || "").trim();
  const full = `${first} ${last}`.trim();
  return full || user.full_name || user.fullName || user.login || user.email || "";
}

/* Convert an InboxDetail (or a list element) into the flat object the
   detail view renders. Both shapes share most fields; we tolerate
   list-only payloads gracefully. */
function mapDetail(raw) {
  if (!raw || typeof raw !== "object") return null;
  const a = raw.activity || {};
  const p = raw.project || {};
  const start = a.plannedStartDate ? String(a.plannedStartDate).slice(0, 10) : "";
  const end = a.plannedEndDate ? String(a.plannedEndDate).slice(0, 10) : "";
  return {
    requestId: raw.businessId,
    businessId: raw.businessId,
    processInstanceId: raw.processInstanceId,
    projectId: p.code || p.id || "",
    projectName: p.name || "",
    activity: {
      id: a.displayCode || a.id || "",
      apiId: a.id || "",
      name: a.name || "",
      owner: a.ownerDivision || "",
      ownerOther: a.ownerDivisionOther || "",
      vendor: raw.organization || "",
      consentDivisions: safeArr(a.consentDivisions),
      consentDivisionOther: a.consentDivisionOther || "",
      plannedDates: start && end ? `${start} to ${end}` : "",
      description: a.description || ""
    },
    submittedAt: raw.submittedAt || "",
    status: raw.status || "pending",
    divisionDecisions: safeArr(raw.divisionDecisions).map((d) => ({
      division: d.division,
      status: d.status || "pending",
      decidedBy: d.decidedBy || "",
      decidedAt: d.decidedAt || "",
      reason: d.comment || ""
    })),
    ownerDecision: raw.ownerDecision || null,
    comments: safeArr(raw.submission && raw.submission.comments).map((c) => ({
      kind: "user",
      who: c.who || "",
      when: c.when || "",
      text: c.text || "",
      attachments: safeArr(c.attachments)
    })),
    myView: raw.myView || null
  };
}

export default function ApprovalInboxConcernedDivision() {
  const storedUser = tokenStore.getUser() || {};
  const CURRENT_USER = useMemo(
    () => ({
      name: pickUserName(storedUser),
      division: pickUserDivision(storedUser),
      role: CURRENT_ROLE
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    []
  );

  const [items, setItems] = useState([]);
  const [listLoading, setListLoading] = useState(true);
  const [listError, setListError] = useState("");
  const [filterText, setFilterText] = useState("");
  const [filterStatus, setFilterStatus] = useState("all");
  const [activeId, setActiveId] = useState(null);
  const [activeDetail, setActiveDetail] = useState(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState("");
  const [rejection, setRejection] = useState({ open: false, reason: "" });
  const [busy, setBusy] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);

  /* Fetch list — refetches on role/status/search change so the backend
     does the filtering. Cancelled by a ref-guarded flag on unmount. */
  useEffect(() => {
    let cancelled = false;
    setListLoading(true);
    setListError("");
    const handle = setTimeout(() => {
      listApprovalInbox({
        role: CURRENT_ROLE,
        status: filterStatus,
        search: filterText
      })
        .then((rows) => {
          if (cancelled) return;
          setItems(rows.map(mapDetail));
        })
        .catch((err) => {
          if (cancelled) return;
          setListError(err && err.message ? err.message : "Failed to load inbox.");
          setItems([]);
        })
        .finally(() => {
          if (!cancelled) setListLoading(false);
        });
    }, filterText ? 220 : 0);
    return () => {
      cancelled = true;
      clearTimeout(handle);
    };
  }, [filterStatus, filterText, reloadKey]);

  async function openReview(businessId) {
    setActiveId(businessId);
    setRejection({ open: false, reason: "" });
    setDetailError("");
    setDetailLoading(true);
    try {
      const raw = await getApprovalInboxItem(businessId);
      setActiveDetail(mapDetail(raw));
    } catch (err) {
      setDetailError(err && err.message ? err.message : "Failed to load review.");
      setActiveDetail(null);
    } finally {
      setDetailLoading(false);
    }
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function closeReview() {
    setActiveId(null);
    setActiveDetail(null);
    setRejection({ open: false, reason: "" });
    setDetailError("");
    setReloadKey((k) => k + 1);
  }

  function beginRejection() {
    setRejection({ open: true, reason: "" });
  }
  function cancelRejection() {
    setRejection({ open: false, reason: "" });
  }

  async function approve() {
    if (!activeDetail) return;
    if (!window.confirm(`Approve "${activeDetail.activity.name}"?`)) return;
    setBusy(true);
    setDetailError("");
    try {
      const refreshed = await transitionApprovalInbox(activeDetail.businessId, {
        action: INBOX_ACTIONS.APPROVE,
        comment: `${CURRENT_USER.division || "Concerned Division"} approved.`
      });
      setActiveDetail(mapDetail(refreshed));
    } catch (err) {
      setDetailError(err && err.message ? err.message : "Failed to approve.");
    } finally {
      setBusy(false);
    }
  }

  async function confirmRejection() {
    if (!activeDetail) return;
    const reason = rejection.reason.trim();
    if (reason.length < 1) {
      setDetailError("Please provide a reason.");
      return;
    }
    if (!window.confirm(`Reject "${activeDetail.activity.name}"?`)) return;
    setBusy(true);
    setDetailError("");
    try {
      const refreshed = await transitionApprovalInbox(activeDetail.businessId, {
        action: INBOX_ACTIONS.REJECT,
        comment: reason
      });
      setActiveDetail(mapDetail(refreshed));
      setRejection({ open: false, reason: "" });
    } catch (err) {
      setDetailError(err && err.message ? err.message : "Failed to reject.");
    } finally {
      setBusy(false);
    }
  }

  /* For a Concerned Division reviewer the "status" we show on the row
     is THIS division's decision. Pulled from myView when available
     (detail), otherwise mirrors the top-level status. */
  const visibleItems = items;
  const totalCount = visibleItems.length;

  return (
    <div className="pmis-apinbox">
      <div className="pmis-apinbox-head">
        <h1>Approval Inbox</h1>
        <div className="pmis-apinbox-sub">
          {CURRENT_USER.division
            ? `${CURRENT_USER.division} — Concerned Division`
            : "Concerned Division Reviewer"}
        </div>
        <div className="pmis-apinbox-desc">
          Activity approval requests routed to your division. Click Review to
          inspect the submission and decide.
        </div>
      </div>

      <div className="pmis-apinbox-card">
        {!activeId && (
          <div className="pmis-apinbox-card-head">
            <h2 className="pmis-apinbox-card-title">
              All Approvals{" "}
              <span className="pmis-apinbox-meta">({totalCount})</span>
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

        {activeId && (
          <div className="pmis-apinbox-card-head">
            <button type="button" className="pmis-apinbox-btn--back" onClick={closeReview}>
              <span aria-hidden="true">←</span> Back to Inbox
            </button>
          </div>
        )}

        {!activeId && (
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
                {listLoading ? (
                  <tr>
                    <td colSpan={6} className="pmis-apinbox-empty">
                      Loading inbox…
                    </td>
                  </tr>
                ) : listError ? (
                  <tr>
                    <td colSpan={6} className="pmis-apinbox-empty" style={{ color: "#9b1c1c" }}>
                      {listError}
                    </td>
                  </tr>
                ) : visibleItems.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="pmis-apinbox-empty">
                      No items match the current filters.
                    </td>
                  </tr>
                ) : (
                  visibleItems.map((it) => {
                    if (!it) return null;
                    const st = it.status || "pending";
                    return (
                      <tr key={it.businessId}>
                        <td>
                          <div className="pmis-apinbox-cell-id">{it.activity.id}</div>
                          <button
                            type="button"
                            className="pmis-apinbox-link pmis-apinbox-cell-name"
                            onClick={() => openReview(it.businessId)}
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
                            onClick={() => openReview(it.businessId)}
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

        {activeId && (
          <DetailView
            loading={detailLoading}
            error={detailError}
            currentUser={CURRENT_USER}
            item={activeDetail}
            rejection={rejection}
            busy={busy}
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
  loading,
  error,
  currentUser,
  item,
  rejection,
  busy,
  onSetRejectionReason,
  onBeginReject,
  onCancelReject,
  onApprove,
  onConfirmReject,
  onClose
}) {
  if (loading) {
    return <div className="pmis-apinbox-empty">Loading review…</div>;
  }
  if (error && !item) {
    return (
      <div className="pmis-apinbox-empty" style={{ color: "#9b1c1c" }}>
        {error}
      </div>
    );
  }
  if (!item) return null;

  const a = item.activity;
  const myView = item.myView || {};
  const myStatus = myView.myStatus || item.status || "pending";
  const canApprove = myView.canApprove !== false;
  const canReject = myView.canReject !== false;
  const isDecided = myStatus === "approved" || myStatus === "rejected";
  const myDecisionRow = item.divisionDecisions.find(
    (d) =>
      d.division &&
      currentUser.division &&
      String(d.division).toLowerCase() === String(currentUser.division).toLowerCase()
  );

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

      {isDecided && myDecisionRow && (
        <div className={`pmis-apinbox-decided pmis-apinbox-decided--${myStatus}`}>
          <div>
            <b>You {myStatus} this request</b>
            {myDecisionRow.decidedAt ? ` on ${formatDateTime(myDecisionRow.decidedAt)}.` : "."}
          </div>
          {myDecisionRow.reason && (
            <div>
              <b>Reason:</b> {myDecisionRow.reason}
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
            <div className="pmis-apinbox-v pmis-apinbox-v--strong">{a.vendor || "—"}</div>
          </div>
          <div>
            <div className="pmis-apinbox-k">Activity Owner</div>
            <div className="pmis-apinbox-v">{a.owner || "—"}</div>
          </div>
          <div>
            <div className="pmis-apinbox-k">Your Division</div>
            <div className="pmis-apinbox-v">{currentUser.division || "—"}</div>
          </div>
          <div>
            <div className="pmis-apinbox-k">Planned Dates</div>
            <div className="pmis-apinbox-v">{a.plannedDates || "—"}</div>
          </div>
          <div>
            <div className="pmis-apinbox-k">Submitted</div>
            <div className="pmis-apinbox-v">{formatDateTime(item.submittedAt)}</div>
          </div>
          <div className="pmis-apinbox-kv-full">
            <div className="pmis-apinbox-k">Description</div>
            <div className="pmis-apinbox-v pmis-apinbox-desc-text">{a.description || "—"}</div>
          </div>
        </div>
      </div>

      {item.comments.length > 0 && (
        <div className="pmis-apinbox-section">
          <div className="pmis-apinbox-section-head">
            <h3>Organization Submission</h3>
          </div>
          {item.comments.map((c, i) => (
            <div key={i} className="pmis-apinbox-cmt">
              <div className="pmis-apinbox-cmt-meta">
                <span className="pmis-apinbox-who">{c.who || "Vendor"}</span>
                <span>{formatDateTime(c.when)}</span>
              </div>
              <div className="pmis-apinbox-cmt-text">{c.text}</div>
              {c.attachments.length > 0 && (
                <div className="pmis-apinbox-cmt-atts">
                  {c.attachments.map((att, j) => (
                    <span key={j} className="pmis-apinbox-att" title={att.name || ""}>
                      📎 {att.name || "attachment"}{" "}
                      {att.size && (
                        <span className="pmis-apinbox-att-size">{att.size}</span>
                      )}
                    </span>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      <div className="pmis-apinbox-section">
        <div className="pmis-apinbox-section-head">
          <h3>Your Status</h3>
        </div>
        <div className="pmis-apinbox-div-status">
          <div className="pmis-apinbox-ds pmis-apinbox-ds--me">
            <span className="pmis-apinbox-nm">
              {currentUser.division || "You"}{" "}
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

      {isDecided ? (
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
              disabled={busy || !rejection.reason.trim()}
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
            disabled={busy || !canReject}
          >
            Reject
          </button>
          <button
            type="button"
            className="pmis-apinbox-btn"
            onClick={onApprove}
            disabled={busy || !canApprove}
          >
            {busy ? "Submitting…" : "Approve"}
          </button>
        </div>
      )}
    </div>
  );
}
