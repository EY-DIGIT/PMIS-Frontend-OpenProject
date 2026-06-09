/* ══════════════════════════════════════════════════════════════════
   ApprovalInboxActivityOwner.jsx — inbox for the Activity Owner.

   Driven by the activity-workflow service:
     GET  /activity-workflow/activities/inbox?userUuid=...
     GET  /activity-workflow/activities/inbox/{activityId}?userUuid=...
     POST /activity-workflow/activities/process/_transition  (APPROVE / REJECT)

   The list endpoint returns rows for any stage the user participates
   in; this page filters down to PENDINGATOWNERDIVISION so only the
   owner-stage items show up. Approve / Reject fires the workflow
   transition with action=APPROVE / REJECT — the backend records the
   outcome and (on APPROVE) flips the activity to ACTIVITYCOMPLETED.
   ══════════════════════════════════════════════════════════════════ */

import React, { useEffect, useMemo, useState } from "react";
import { formatDateTime } from "../../utils/project/helpers";
import { tokenStore } from "../../api/client";
import {
  getActivityWorkflowInbox,
  getActivityWorkflowInboxDetail,
  transitionActivity,
  WORKFLOW_ACTIONS,
  WORKFLOW_STATES
} from "../../api/activityWorkflow";
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

function normalizeVote(v) {
  const s = String(v || "").toLowerCase();
  if (s === "approved") return "approved";
  if (s === "rejected") return "rejected";
  if (s === "completed") return "approved";
  return "pending";
}

function formatBytes(n) {
  const x = Number(n) || 0;
  if (x >= 1024 * 1024) return (x / 1024 / 1024).toFixed(1) + " MB";
  if (x >= 1024) return (x / 1024).toFixed(0) + " KB";
  return x + " B";
}

/* Convert a list-row payload into the flat shape the table renders. */
function mapListRow(raw) {
  if (!raw || typeof raw !== "object") return null;
  const status = normalizeVote(raw.voteStatus);
  return {
    rowKey: raw.participantUuid || raw.activityId,
    activityId: raw.activityId,
    projectId: raw.projectId,
    stateName: raw.stateName || WORKFLOW_STATES.PENDING_AT_OWNER_DIVISION,
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

function mapDetail(raw, currentUserUuid) {
  if (!raw || typeof raw !== "object") return null;
  const plannedDates =
    raw.startDate && raw.endDate
      ? `${String(raw.startDate).slice(0, 10)} to ${String(raw.endDate).slice(0, 10)}`
      : "";
  /* The owner detail payload carries the owner's own vote inside
     `yourStatusBreakdown` rather than a top-level `yourStatus`. Mark the
     owner's row (backend `isYou` can be unreliable, so also match the
     logged-in user's uuid against approverUserUuid) and derive the
     owner's decision from it — that's what hides the Approve/Reject
     buttons once a vote is recorded. */
  const statusBreakdown = safeArr(raw.yourStatusBreakdown).map((b) => {
    const approverUuid = b.approverUserUuid || b.approverUuid || "";
    const isYou =
      !!b.isYou || (!!currentUserUuid && approverUuid === currentUserUuid);
    return {
      divisionCode: b.divisionCode || "",
      divisionName: b.divisionName || "",
      approverName: b.approverName || "",
      approverUserUuid: approverUuid,
      status: normalizeVote(b.voteStatus),
      isYou
    };
  });
  const myRow = statusBreakdown.find((b) => b.isYou);
  const status =
    raw.yourStatus != null && String(raw.yourStatus) !== ""
      ? normalizeVote(raw.yourStatus)
      : myRow
      ? myRow.status
      : "pending";
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
    statusBreakdown,
    stateName: WORKFLOW_STATES.PENDING_AT_OWNER_DIVISION
  };
}

export default function ApprovalInboxActivityOwner() {
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
  const [activeKey, setActiveKey] = useState(null);
  const [activeDetail, setActiveDetail] = useState(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState("");
  const [rejection, setRejection] = useState({
    open: false,
    reason: "",
    revertKind: "",
    revertDivisions: []
  });
  const [busy, setBusy] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);

  /* The inbox endpoint surfaces rows for every stage the user touches;
     the Owner page filters down to PENDINGATOWNERDIVISION so the
     Activity Owner only sees items routed to them. */
  useEffect(() => {
    let cancelled = false;
    setListLoading(true);
    setListError("");
    getActivityWorkflowInbox(CURRENT_USER.uuid, WORKFLOW_STATES.PENDING_AT_OWNER_DIVISION)
      .then((rows) => {
        if (cancelled) return;
        const mapped = rows.map(mapListRow).filter(Boolean);
        const ownerOnly = mapped.filter((r) =>
          r.stateName === WORKFLOW_STATES.PENDING_AT_OWNER_DIVISION
        );
        setItems(ownerOnly);
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

  async function openReview(row) {
    setActiveKey(row.activityId);
    setRejection({ open: false, reason: "", revertKind: "", revertDivisions: [] });
    setDetailError("");
    setDetailLoading(true);
    try {
      const raw = await getActivityWorkflowInboxDetail(
        row.activityId,
        CURRENT_USER.uuid,
        WORKFLOW_STATES.PENDING_AT_OWNER_DIVISION
      );
      const mapped = mapDetail(raw, CURRENT_USER.uuid) || {};
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
    setRejection({ open: false, reason: "", revertKind: "", revertDivisions: [] });
    setDetailError("");
    setReloadKey((k) => k + 1);
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
    const reasonOk = rejection.reason.trim().length >= 1;
    let targetOk = false;
    if (rejection.revertKind === "vendor") targetOk = true;
    else if (rejection.revertKind === "divisions") targetOk = rejection.revertDivisions.length > 0;
    return reasonOk && targetOk;
  })();

  async function approve() {
    if (!activeDetail) return;
    if (!window.confirm(`Approve "${activeDetail.activityName}" and mark the activity Completed?`)) return;
    setBusy(true);
    setDetailError("");
    try {
      await transitionActivity({
        activityId: activeDetail.activityId,
        projectId: activeDetail.projectId,
        action: WORKFLOW_ACTIONS.APPROVE,
        comment: "Final approval granted by owner."
      });
      const refreshed = await getActivityWorkflowInboxDetail(
        activeDetail.activityId,
        CURRENT_USER.uuid,
        WORKFLOW_STATES.PENDING_AT_OWNER_DIVISION
      );
      const mapped = mapDetail(refreshed, CURRENT_USER.uuid) || {};
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
    if (!canConfirmReject) return;
    const reason = rejection.reason.trim();
    /* Encode the revert target as a comment header so downstream
       consumers can parse it — the transition payload itself only
       carries action + comment. */
    const targetLine =
      rejection.revertKind === "vendor"
        ? "Revert to Vendor (full restart)"
        : `Revert to Concerned Divisions: ${rejection.revertDivisions.join(", ")}`;
    const comment = `${targetLine} — ${reason}`;
    if (!window.confirm(`Reject "${activeDetail.activityName}"?`)) return;
    setBusy(true);
    setDetailError("");
    try {
      await transitionActivity({
        activityId: activeDetail.activityId,
        projectId: activeDetail.projectId,
        /* Revert to vendor sends RETURN_TO_VENDOR; the per-division
           revert keeps the generic REJECT transition. */
        action: rejection.revertKind === "vendor"
          ? WORKFLOW_ACTIONS.RETURN_TO_VENDOR
          : WORKFLOW_ACTIONS.REJECT,
        comment
      });
      const refreshed = await getActivityWorkflowInboxDetail(
        activeDetail.activityId,
        CURRENT_USER.uuid,
        WORKFLOW_STATES.PENDING_AT_OWNER_DIVISION
      );
      const mapped = mapDetail(refreshed, CURRENT_USER.uuid) || {};
      mapped.projectId = mapped.projectId || activeDetail.projectId;
      mapped.stateName = mapped.stateName || activeDetail.stateName;
      setActiveDetail(mapped);
      setRejection({ open: false, reason: "", revertKind: "", revertDivisions: [] });
    } catch (err) {
      setDetailError(err && err.message ? err.message : "Failed to reject.");
    } finally {
      setBusy(false);
    }
  }

  const totalCount = visibleItems.length;

  return (
    <div className="pmis-apinbox">
      <div className="pmis-apinbox-head">
        <h1>Approval Inbox</h1>
        <div className="pmis-apinbox-sub">
          Activity Owner{CURRENT_USER.division ? ` · ${CURRENT_USER.division}` : ""}
        </div>
        <div className="pmis-apinbox-desc">
          Activities awaiting your final decision. All consent divisions have
          already approved.
        </div>
      </div>

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
                          onClick={() => openReview(it)}
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
  loading,
  error,
  currentUser,
  item,
  rejection,
  busy,
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
  const consentDivisions = (item.statusBreakdown || [])
    .filter((b) => !b.isYou)
    .map((b) => b.divisionName || b.divisionCode);

  return (
    <div className="pmis-apinbox-detail">
      <div className="pmis-apinbox-detail-title-block">
        <div style={{ flex: "1 1 320px", minWidth: 0 }}>
          <div className="pmis-apinbox-detail-eyebrow">Approval Request</div>
          <div className="pmis-apinbox-detail-title">
            <span>{item.activityName}</span>
            <span className="pmis-apinbox-detail-title-id">{item.activityDisplayCode}</span>
          </div>
        </div>
        <div style={{ paddingTop: 24 }}>
          <span className={`pmis-apinbox-pill pmis-apinbox-pill--${status}`}>{cap(status)}</span>
        </div>
      </div>

      {isDecided && (
        <div className={`pmis-apinbox-decided pmis-apinbox-decided--${status}`}>
          <div>
            <b>You {status} this request.</b>
            {status === "approved" && <> Activity has been marked Completed.</>}
          </div>
        </div>
      )}

      <div className="pmis-apinbox-cols">
        <div className="pmis-apinbox-col">
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
          <h3>Division Status</h3>
        </div>
        <div className="pmis-apinbox-div-status">
          {item.statusBreakdown.filter((b) => !b.isYou).map((b, i) => (
            <div key={`${b.divisionCode}-${i}`} className="pmis-apinbox-ds">
              <span className="pmis-apinbox-nm">{b.divisionName || b.divisionCode}</span>
              <span className={`pmis-apinbox-pill pmis-apinbox-pill--${b.status}`}>{cap(b.status)}</span>
            </div>
          ))}
          <div className="pmis-apinbox-ds pmis-apinbox-ds--me">
            <span className="pmis-apinbox-nm">
              {currentUser.division || item.activityOwnerDivision || "Owner"}{" "}
              <span className="pmis-apinbox-you">YOU · OWNER</span>
            </span>
            <span className={`pmis-apinbox-pill pmis-apinbox-pill--${status}`}>{cap(status)}</span>
          </div>
        </div>
      </div>
        </div>{/* left column */}

        <div className="pmis-apinbox-col">
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
                      <a key={j} href={att.url} target="_blank" rel="noopener noreferrer"
                        className="pmis-apinbox-att" title={att.name}>
                        📎 {att.name} {att.size && <span className="pmis-apinbox-att-size">{att.size}</span>}
                      </a>
                    ) : (
                      <span key={j} className="pmis-apinbox-att" title={att.name}>
                        📎 {att.name} {att.size && <span className="pmis-apinbox-att-size">{att.size}</span>}
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
        <div style={{
          padding: 10, background: "#fdecec", border: "1px solid #f4b8b8",
          color: "#9b1c1c", borderRadius: 6, fontSize: 13
        }}>
          {error}
        </div>
      )}

      {isDecided ? (
        <div className="pmis-apinbox-actions">
          <button type="button" className="pmis-apinbox-btn pmis-apinbox-btn--cancel" onClick={onClose}>
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
              <label className={`pmis-apinbox-opt${rejection.revertKind === "vendor" ? " is-selected" : ""}`}>
                <input
                  type="radio" name="revertKind" value="vendor"
                  checked={rejection.revertKind === "vendor"}
                  onChange={() => onSetRevertKind("vendor")}
                  disabled={busy}
                />
                <span className="pmis-apinbox-opt-body">
                  <span className="pmis-apinbox-opt-title">Organization</span>
                  <span className="pmis-apinbox-opt-sub">
                    Full restart — all consent divisions will re-review after the organization resubmits.
                  </span>
                </span>
              </label>
              <label className={`pmis-apinbox-opt${rejection.revertKind === "divisions" ? " is-selected" : ""}`}>
                <input
                  type="radio" name="revertKind" value="divisions"
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
                  {consentDivisions.length === 0 ? (
                    <div className="pmis-apinbox-panel-hint">
                      No consent divisions are configured for this activity.
                    </div>
                  ) : (
                    <div className="pmis-apinbox-checklist">
                      {consentDivisions.map((d) => {
                        const checked = rejection.revertDivisions.includes(d);
                        return (
                          <label key={d} className={checked ? "is-checked" : ""}>
                            <input
                              type="checkbox" checked={checked}
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
            <button type="button" className="pmis-apinbox-btn pmis-apinbox-btn--cancel"
              onClick={onCancelReject} disabled={busy}>
              Cancel
            </button>
            <button type="button" className="pmis-apinbox-btn pmis-apinbox-btn--danger"
              disabled={busy || !canConfirmReject} onClick={onConfirmReject}>
              {busy ? "Submitting…" : "Confirm Rejection"}
            </button>
          </div>
        </div>
      ) : (
        <div className="pmis-apinbox-actions">
          <button type="button" className="pmis-apinbox-btn pmis-apinbox-btn--cancel"
            onClick={onClose} disabled={busy}>
            Back to Inbox
          </button>
          <button type="button" className="pmis-apinbox-btn pmis-apinbox-btn--danger"
            onClick={onBeginReject} disabled={busy}>
            Reject
          </button>
          <button type="button" className="pmis-apinbox-btn" onClick={onApprove} disabled={busy}>
            {busy ? "Submitting…" : "Approve & Complete"}
          </button>
        </div>
      )}
    </div>
  );
}
