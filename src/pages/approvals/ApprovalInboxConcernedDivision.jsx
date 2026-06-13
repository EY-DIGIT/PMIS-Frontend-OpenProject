/* ══════════════════════════════════════════════════════════════════
   ApprovalInboxConcernedDivision.jsx — inbox for a Concerned Division
   reviewer. Driven by the activity-workflow service:

     GET  /activity-workflow/activities/inbox?userUuid=...
     GET  /activity-workflow/activities/inbox/{activityId}?userUuid=...
     POST /activity-workflow/activities/parallel/vote

   The list endpoint returns one row per (activity × this user). Clicks
   on Review fetch the detail (including organization submissions /
   attachments and the per-division status breakdown); Approve / Reject
   post a parallel-vote with the activityId + projectId + stateName the
   detail surfaced.
   ══════════════════════════════════════════════════════════════════ */

import React, { useEffect, useMemo, useState } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { formatDateTime } from "../../utils/project/helpers";
import { tokenStore } from "../../api/client";
import ActivityWorkflowViewer from "../../components/projects/ActivityWorkflowViewer";
import {
  getActivityWorkflowInbox,
  getActivityWorkflowInboxDetail,
  voteOnActivityParallel,
  PARALLEL_VOTE,
  WORKFLOW_STATES
} from "../../api/activityWorkflow";
import { setPageContext } from "../../utils/pageContext";
import "../../styles/project/approvalInbox.css";

function cap(s) {
  return s ? s[0].toUpperCase() + s.slice(1) : s;
}

function safeArr(v) {
  return Array.isArray(v) ? v : [];
}

function pickUserUuid(user) {
  if (!user) return "";
  return user.uuid || user.id || user.userId || user.user_id || "";
}

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

/* The list endpoint surfaces `voteStatus` (PENDING / APPROVED / REJECTED
   in upper case). Normalize to the lowercase status pill the UI uses. */
function normalizeVote(v) {
  const s = String(v || "").toLowerCase();
  if (s === "approved") return "approved";
  if (s === "rejected") return "rejected";
  return "pending";
}

/* Convert a list-row payload into the flat shape the table renders. */
function mapListRow(raw) {
  if (!raw || typeof raw !== "object") return null;
  const status = normalizeVote(raw.voteStatus);
  return {
    rowKey: raw.participantUuid || raw.activityId,
    activityId: raw.activityId,
    projectId: raw.projectId,
    stateName: raw.stateName || WORKFLOW_STATES.PENDING_AT_CONCERNED_DIVISION,
    activityDisplayCode: raw.activityDisplayCode || "",
    activityName: raw.activityName || "",
    projectName: raw.projectName || "",
    projectCode: raw.projectCode || "",
    organizationName: raw.organizationName || "",
    divisionCode: raw.divisionCode || "",
    divisionName: raw.divisionName || "",
    submittedAt: raw.submittedAt || "",
    status
  };
}

/* Convert the detail payload into the shape the review panel renders. */
function mapDetail(raw) {
  if (!raw || typeof raw !== "object") return null;
  const status = normalizeVote(raw.yourStatus);
  const plannedDates =
    raw.startDate && raw.endDate
      ? `${String(raw.startDate).slice(0, 10)} to ${String(raw.endDate).slice(0, 10)}`
      : "";
  return {
    activityId: raw.activityId,
    projectId: raw.projectId,
    activityDisplayCode: raw.activityDisplayCode || "",
    activityName: raw.activityName || "",
    projectName: raw.projectName || "",
    projectCode: raw.projectCode || "",
    organizationName: raw.organizationName || "",
    activityOwnerDivision: raw.activityOwnerDivision || "",
    yourDivisionCode: raw.yourDivisionCode || "",
    yourDivisionName: raw.yourDivisionName || "",
    plannedDates,
    description: raw.description || "",
    submittedAt: raw.submittedAt || "",
    status,
    submissions: safeArr(raw.organizationSubmissions).map((c) => ({
      who:
        (c.author && (c.author.displayName || c.author.login || c.author.email)) ||
        "Organization",
      when: c.createdAt || "",
      text: c.body || "",
      attachments: safeArr(c.attachments).map((a) => ({
        name: a.fileName || "attachment",
        size: typeof a.sizeBytes === "number" ? formatBytes(a.sizeBytes) : "",
        url: a.url || ""
      }))
    })),
    statusBreakdown: safeArr(raw.yourStatusBreakdown).map((b) => ({
      divisionCode: b.divisionCode || "",
      divisionName: b.divisionName || "",
      approverName: b.approverName || "",
      status: normalizeVote(b.voteStatus),
      isYou: !!b.isYou
    })),
    /* Surface a reasonable default state for the vote call. The backend
       expects the same stateName the row was seeded in. */
    stateName: WORKFLOW_STATES.PENDING_AT_CONCERNED_DIVISION
  };
}

function formatBytes(n) {
  const x = Number(n) || 0;
  if (x >= 1024 * 1024) return (x / 1024 / 1024).toFixed(1) + " MB";
  if (x >= 1024) return (x / 1024).toFixed(0) + " KB";
  return x + " B";
}

export default function ApprovalInboxConcernedDivision() {
  const navigate = useNavigate();
  const location = useLocation();
  /* The breadcrumb's "Approval Inbox" crumb navigates here with
     state.inboxList — close any open review so the user lands back on the
     list (the review is in-page state on the same url). */
  useEffect(() => {
    if (location.state?.inboxList) closeReview();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.key]);
  const storedUser = tokenStore.getUser() || {};
  const CURRENT_USER = useMemo(
    () => ({
      uuid: pickUserUuid(storedUser),
      name: pickUserName(storedUser),
      division: pickUserDivision(storedUser)
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    []
  );

  const [items, setItems] = useState([]);
  const [listLoading, setListLoading] = useState(true);
  const [listError, setListError] = useState("");
  const [filterText, setFilterText] = useState("");
  const [filterStatus, setFilterStatus] = useState("all");
  const [activeKey, setActiveKey] = useState(null); // selected row.activityId
  const [activeDetail, setActiveDetail] = useState(null);
  /* Publish whether a review is open so the global breadcrumb can append
     the "Review" crumb (Home › Approval Inbox › Review). Cleared on close
     and unmount. */
  useEffect(() => {
    setPageContext({ approvalReview: !!activeKey });
    return () => setPageContext({ approvalReview: false });
  }, [activeKey]);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState("");
  const [rejection, setRejection] = useState({ open: false, reason: "" });
  const [busy, setBusy] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);

  /* Fetch list — the new endpoint takes only userUuid; we filter client-
     side by status + free-text search since the contract has no query
     params for those. */
  useEffect(() => {
    let cancelled = false;
    setListLoading(true);
    setListError("");
    getActivityWorkflowInbox(CURRENT_USER.uuid, WORKFLOW_STATES.PENDING_AT_CONCERNED_DIVISION)
      .then((rows) => {
        if (cancelled) return;
        setItems(rows.map(mapListRow).filter(Boolean));
      })
      .catch((err) => {
        if (cancelled) return;
        setListError(err && err.message ? err.message : "Failed to load inbox.");
        setItems([]);
      })
      .finally(() => {
        if (!cancelled) setListLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [CURRENT_USER.uuid, reloadKey]);

  const visibleItems = useMemo(() => {
    const q = filterText.trim().toLowerCase();
    return items.filter((it) => {
      if (filterStatus !== "all" && it.status !== filterStatus) return false;
      if (!q) return true;
      return (
        (it.activityName || "").toLowerCase().includes(q) ||
        (it.activityDisplayCode || "").toLowerCase().includes(q) ||
        (it.projectName || "").toLowerCase().includes(q) ||
        (it.projectCode || "").toLowerCase().includes(q) ||
        (it.organizationName || "").toLowerCase().includes(q)
      );
    });
  }, [items, filterText, filterStatus]);

  /* Clicking the activity name jumps to that activity's page in the
     project's milestone config (where its details + approval workflow
     live). */
  function goToActivity(row) {
    if (!row || !row.projectId || !row.activityId) return;
    const params = new URLSearchParams({
      kind: "activity",
      mode: "edit",
      nodeUid: row.activityId,
      // Opened from the inbox = view only; no workflow / edit actions.
      readonly: "1"
    });
    navigate(
      `/projects/${encodeURIComponent(row.projectId)}/config/node?${params.toString()}`
    );
  }

  async function openReview(row) {
    setActiveKey(row.activityId);
    setRejection({ open: false, reason: "" });
    setDetailError("");
    setDetailLoading(true);
    try {
      const raw = await getActivityWorkflowInboxDetail(
        row.activityId,
        CURRENT_USER.uuid,
        WORKFLOW_STATES.PENDING_AT_CONCERNED_DIVISION
      );
      /* The detail endpoint doesn't echo back projectId or stateName in
         every version of the contract — seed both from the list row so
         the vote call still has what it needs. */
      const mapped = mapDetail(raw) || {};
      mapped.projectId = mapped.projectId || row.projectId;
      mapped.stateName = mapped.stateName || row.stateName;
      setActiveDetail(mapped);
    } catch (err) {
      setDetailError(err && err.message ? err.message : "Failed to load review.");
      setActiveDetail(null);
    } finally {
      setDetailLoading(false);
    }
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function closeReview() {
    setActiveKey(null);
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
    if (!window.confirm(`Approve "${activeDetail.activityName}"?`)) return;
    setBusy(true);
    setDetailError("");
    try {
      await voteOnActivityParallel({
        activityId: activeDetail.activityId,
        projectId: activeDetail.projectId,
        stateName: activeDetail.stateName,
        vote: PARALLEL_VOTE.APPROVED,
        comment: `${CURRENT_USER.division || "Concerned Division"} approved.`
      });
      /* Refresh the detail so the status pill + breakdown reflect the
         new vote. */
      const refreshed = await getActivityWorkflowInboxDetail(
        activeDetail.activityId,
        CURRENT_USER.uuid,
        WORKFLOW_STATES.PENDING_AT_CONCERNED_DIVISION
      );
      const mapped = mapDetail(refreshed) || {};
      mapped.projectId = mapped.projectId || activeDetail.projectId;
      mapped.stateName = mapped.stateName || activeDetail.stateName;
      setActiveDetail(mapped);
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
    if (!window.confirm(`Reject "${activeDetail.activityName}"?`)) return;
    setBusy(true);
    setDetailError("");
    try {
      await voteOnActivityParallel({
        activityId: activeDetail.activityId,
        projectId: activeDetail.projectId,
        stateName: activeDetail.stateName,
        vote: PARALLEL_VOTE.REJECTED,
        comment: reason
      });
      const refreshed = await getActivityWorkflowInboxDetail(
        activeDetail.activityId,
        CURRENT_USER.uuid,
        WORKFLOW_STATES.PENDING_AT_CONCERNED_DIVISION
      );
      const mapped = mapDetail(refreshed) || {};
      mapped.projectId = mapped.projectId || activeDetail.projectId;
      mapped.stateName = mapped.stateName || activeDetail.stateName;
      setActiveDetail(mapped);
      setRejection({ open: false, reason: "" });
    } catch (err) {
      setDetailError(err && err.message ? err.message : "Failed to reject.");
    } finally {
      setBusy(false);
    }
  }

  const totalCount = visibleItems.length;

  return (
    <div className="pmis-apinbox">

      <div className="pmis-apinbox-card">
        {!activeKey && (
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

        {activeKey && (
          <div className="pmis-apinbox-card-head">
            <button type="button" className="pmis-apinbox-btn--back" onClick={closeReview}>
              <span aria-hidden="true">←</span> Back to Inbox
            </button>
          </div>
        )}

        {!activeKey && (
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
                  visibleItems.map((it) => (
                    <tr key={it.rowKey}>
                      <td>
                        <div className="pmis-apinbox-cell-id">{it.activityDisplayCode}</div>
                        <button
                          type="button"
                          className="pmis-apinbox-link pmis-apinbox-cell-name"
                          onClick={() => goToActivity(it)}
                        >
                          {it.activityName}
                        </button>
                      </td>
                      <td>
                        <div>{it.projectName}</div>
                        <div className="pmis-apinbox-cell-sub">{it.projectCode}</div>
                      </td>
                      <td>{it.organizationName}</td>
                      <td>{formatDateTime(it.submittedAt)}</td>
                      <td>
                        <span className={`pmis-apinbox-pill pmis-apinbox-pill--${it.status}`}>
                          {cap(it.status)}
                        </span>
                      </td>
                      <td className="pmis-apinbox-cell-actions">
                        <button
                          type="button"
                          className="pmis-apinbox-btn pmis-apinbox-btn--sm"
                          onClick={() => openReview(it)}
                        >
                          Review
                        </button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        )}

        {activeKey && (
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

  const status = item.status || "pending";
  const isDecided = status === "approved" || status === "rejected";
  const myBreakdownRow = item.statusBreakdown.find((b) => b.isYou);

  return (
    <div className="pmis-apinbox-detail">
      <div className="pmis-apinbox-cols">
        <div className="pmis-apinbox-col">
      <div className="pmis-apinbox-detail-title-block">
        <div style={{ flex: "1 1 320px", minWidth: 0 }}>
          <div className="pmis-apinbox-detail-eyebrow">Approval Request</div>
          <div className="pmis-apinbox-detail-title">
            <span>{item.activityName}</span>
            <span className="pmis-apinbox-detail-title-id">{item.activityDisplayCode}</span>
          </div>
        </div>
        <div style={{ paddingTop: 24 }}>
          <span className={`pmis-apinbox-pill pmis-apinbox-pill--${status}`}>
            {cap(status)}
          </span>
        </div>
      </div>

      {isDecided && (
        <div className={`pmis-apinbox-decided pmis-apinbox-decided--${status}`}>
          <div>
            <b>You {status} this request.</b>
          </div>
        </div>
      )}

      <div className="pmis-apinbox-section">
        <div className="pmis-apinbox-section-head">
          <h3>Project</h3>
        </div>
        <div className="pmis-apinbox-project-line">
          {item.projectName}
          <span className="pmis-apinbox-pid">{item.projectCode}</span>
        </div>
      </div>

      <div className="pmis-apinbox-section">
        <div className="pmis-apinbox-section-head">
          <h3>Activity Details</h3>
        </div>
        <div className="pmis-apinbox-kv">
          <div>
            <div className="pmis-apinbox-k">Organization</div>
            <div className="pmis-apinbox-v pmis-apinbox-v--strong">{item.organizationName || "—"}</div>
          </div>
          <div>
            <div className="pmis-apinbox-k">Activity Owner Division</div>
            <div className="pmis-apinbox-v">{item.activityOwnerDivision || "—"}</div>
          </div>
          <div>
            <div className="pmis-apinbox-k">Your Division</div>
            <div className="pmis-apinbox-v">{item.yourDivisionName || currentUser.division || "—"}</div>
          </div>
          <div>
            <div className="pmis-apinbox-k">Planned Dates</div>
            <div className="pmis-apinbox-v">{item.plannedDates || "—"}</div>
          </div>
          <div>
            <div className="pmis-apinbox-k">Submitted</div>
            <div className="pmis-apinbox-v">{formatDateTime(item.submittedAt)}</div>
          </div>
          <div className="pmis-apinbox-kv-full">
            <div className="pmis-apinbox-k">Description</div>
            <div className="pmis-apinbox-v pmis-apinbox-desc-text">{item.description || "—"}</div>
          </div>
        </div>
      </div>

      <div className="pmis-apinbox-section">
        <div className="pmis-apinbox-section-head">
          <h3>Your Status</h3>
        </div>
        <div className="pmis-apinbox-div-status">
          {item.statusBreakdown.length === 0 ? (
            <div className="pmis-apinbox-ds pmis-apinbox-ds--me">
              <span className="pmis-apinbox-nm">
                {item.yourDivisionName || currentUser.division || "You"}{" "}
                <span className="pmis-apinbox-you">YOU</span>
              </span>
              <span className={`pmis-apinbox-pill pmis-apinbox-pill--${status}`}>
                {cap(status)}
              </span>
            </div>
          ) : (
            item.statusBreakdown.map((b, i) => (
              <div
                key={`${b.divisionCode}-${i}`}
                className={`pmis-apinbox-ds${b.isYou ? " pmis-apinbox-ds--me" : ""}`}
              >
                <span className="pmis-apinbox-nm">
                  {b.divisionName || b.divisionCode}{" "}
                  {b.isYou && <span className="pmis-apinbox-you">YOU</span>}
                </span>
                <span className={`pmis-apinbox-pill pmis-apinbox-pill--${b.status}`}>
                  {cap(b.status)}
                </span>
              </div>
            ))
          )}
          {/* Fallback to top-level status if breakdown doesn't include us. */}
          {item.statusBreakdown.length > 0 && !myBreakdownRow && (
            <div className="pmis-apinbox-ds pmis-apinbox-ds--me">
              <span className="pmis-apinbox-nm">
                {currentUser.division || "You"}{" "}
                <span className="pmis-apinbox-you">YOU</span>
              </span>
              <span className={`pmis-apinbox-pill pmis-apinbox-pill--${status}`}>
                {cap(status)}
              </span>
            </div>
          )}
        </div>
      </div>
        </div>{/* left column */}

        <div className="pmis-apinbox-col">
      <div className="pmis-apinbox-section">
        <div className="pmis-apinbox-section-head">
          <h3>Activity Workflow</h3>
        </div>
        <ActivityWorkflowViewer activityId={item.activityId} />
      </div>
      {item.submissions.length > 0 ? (
        <div className="pmis-apinbox-section">
          <div className="pmis-apinbox-section-head">
            <h3>Organization Submission</h3>
          </div>
          {item.submissions.map((c, i) => (
            <div key={i} className="pmis-apinbox-cmt">
              <div className="pmis-apinbox-cmt-meta">
                <span className="pmis-apinbox-who">{c.who}</span>
                <span>{formatDateTime(c.when)}</span>
              </div>
              <div className="pmis-apinbox-cmt-text">{c.text}</div>
              {c.attachments.length > 0 && (
                <div className="pmis-apinbox-cmt-atts">
                  {c.attachments.map((att, j) =>
                    att.url ? (
                      <a
                        key={j}
                        href={att.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="pmis-apinbox-att"
                        title={att.name}
                      >
                        📎 {att.name}{" "}
                        {att.size && (
                          <span className="pmis-apinbox-att-size">{att.size}</span>
                        )}
                      </a>
                    ) : (
                      <span key={j} className="pmis-apinbox-att" title={att.name}>
                        📎 {att.name}{" "}
                        {att.size && (
                          <span className="pmis-apinbox-att-size">{att.size}</span>
                        )}
                      </span>
                    )
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      ) : (
        <div className="pmis-apinbox-section">
          <div className="pmis-apinbox-section-head">
            <h3>Organization Submission</h3>
          </div>
          <div className="pmis-apinbox-empty">No submission provided.</div>
        </div>
      )}
        </div>{/* right column */}
      </div>{/* cols */}

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
