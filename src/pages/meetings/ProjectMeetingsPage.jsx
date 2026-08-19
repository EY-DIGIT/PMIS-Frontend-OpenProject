/* ══════════════════════════════════════════════════════════════════
   ProjectMeetingsPage.jsx — meetings for a single project
   (route: /projects/:projectId/meetings).

   Reached from the Project Details ⋮ menu → "Meeting Details".
   Backed by GET /meetings/getAll?projectId={id}&page&size (the same
   listMeetings wrapper the All-Meetings dashboard uses, just pinned
   to one projectId). Rows link to the shared meeting detail page.
   ══════════════════════════════════════════════════════════════════ */

import React, { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { listMeetings, getMoM, updateMeetingStatus } from "../../api/meetings";
import { useToast } from "./_shared";
import "../../styles/meetings.css";

/* The meeting's own status values — the same set the All-Meetings list
   filters and edits (PUT /meetings/{id}/status). Not to be confused with
   the MoM's DRAFT/IN_REVIEW/FINALIZED on the meeting detail page. */
const STATUS_OPTIONS = ["DRAFT", "SCHEDULED", "COMPLETED", "CANCELLED"];

/* DRAFT → cls + label, falls back to a neutral badge for unknowns.
   Mirrors the badge mapping used on the All-Meetings list. */
const STATUS_CLASS = {
  DRAFT: "st-draft",
  SCHEDULED: "st-scheduled",
  COMPLETED: "st-completed",
  CANCELLED: "st-mom",
};

function StatusPill({ status }) {
  const s = String(status || "").toUpperCase();
  const cls = STATUS_CLASS[s] || "st-draft";
  return <span className={`badge ${cls}`}>{s || "—"}</span>;
}

function fmtDate(iso) {
  if (!iso) return "—";
  const d = new Date(iso + "T00:00:00");
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

function trimTime(hms) {
  if (!hms) return "";
  return String(hms).slice(0, 5);
}

/* Pull the action-item list out of whatever wrapper /meetings/mom/getByMeeting
   returns ({data:{mom}}, {mom}, {data}, or the record itself). Used only to
   decide whether a meeting already has created tasks. Returns []. */
function actionItemsOf(mom) {
  if (!mom) return [];
  const candidates = [mom?.data?.mom, mom?.mom, mom?.data, mom];
  const rec = candidates.find(
    (c) =>
      c &&
      typeof c === "object" &&
      (Array.isArray(c.actionItems) || Array.isArray(c.actions))
  );
  if (!rec) return [];
  return Array.isArray(rec.actionItems)
    ? rec.actionItems
    : Array.isArray(rec.actions)
    ? rec.actions
    : [];
}

export default function ProjectMeetingsPage() {
  const { projectId } = useParams();
  const navigate = useNavigate();
  const { show, node: toastNode } = useToast();

  /* Every meeting screen reached from here stays under the project, so the
     breadcrumb and the back buttons lead back to this list rather than the
     global All-Meetings page. */
  const meetingBase = `/projects/${encodeURIComponent(projectId)}/meetings`;

  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(false);
  /* Id of the meeting whose MoM we're checking on click (disables the row
     so a double-click can't fire two lookups). */
  const [routingId, setRoutingId] = useState(null);
  const [q, setQ] = useState("");
  /* Server-side status filter — passed straight to /meetings/getAll, so it
     spans every page of results rather than just the rows on screen. */
  const [fStatus, setFStatus] = useState("ALL");

  /* Inline per-row status editing, mirroring the All-Meetings list.
     `editingId` is the meeting being edited; `savingId` guards its Save. */
  const [editingId, setEditingId] = useState("");
  const [statusDraft, setStatusDraft] = useState("");
  const [savingId, setSavingId] = useState("");
  const [pageInfo, setPageInfo] = useState({
    page: 0,
    size: 20,
    totalElements: 0,
    totalPages: 0,
    last: true,
  });

  const loadPage = (page = 0) => {
    if (!projectId) return;
    setLoading(true);
    listMeetings({ projectId, status: fStatus || "ALL", page, size: pageInfo.size })
      .then((res) => {
        setRows(Array.isArray(res?.content) ? res.content : []);
        setPageInfo({
          page: res?.page ?? page,
          size: res?.size ?? pageInfo.size,
          totalElements: res?.totalElements ?? 0,
          totalPages: res?.totalPages ?? 0,
          last: res?.last ?? true,
        });
      })
      .catch((e) => show(e.message || "Failed to load meetings.", "warn"))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    /* Any filter change restarts at page 0 — the old page number may not
       exist in the narrowed result set. Also drops any half-finished row
       edit, since that row may no longer be on screen. */
    setEditingId("");
    setStatusDraft("");
    loadPage(0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId, fStatus]);

  /* Inline status editing — same endpoint the All-Meetings list uses
     (updateMeetingStatus → PUT /meetings/{id}/status). The row is patched
     locally on success so the table doesn't need a full reload. */
  const startStatusEdit = (m) => {
    setEditingId(m.id);
    setStatusDraft(String(m.status || "").toUpperCase() || STATUS_OPTIONS[0]);
  };
  const cancelStatusEdit = () => { setEditingId(""); setStatusDraft(""); };
  const saveStatus = async (m) => {
    if (savingId) return;
    try {
      setSavingId(m.id);
      await updateMeetingStatus(m.id, statusDraft);
      setRows((list) => list.map((r) => (r.id === m.id ? { ...r, status: statusDraft } : r)));
      setEditingId("");
      setStatusDraft("");
      show("Status updated.", "ok");
    } catch (e) {
      show(e.message || "Failed to update status.", "warn");
    } finally {
      setSavingId("");
    }
  };

  /* Decide where a meeting row should go: if the meeting already has a MoM
     with created tasks, open the editable Linked-Task view; otherwise fall
     back to the meeting detail page (where the MoM/tasks get created). A
     failed/absent MoM lookup is treated as "no tasks" → detail page. */
  const openMeeting = async (meetingId) => {
    if (!meetingId || routingId) return;
    setRoutingId(meetingId);
    try {
      const mom = await getMoM(meetingId);
      const hasTasks = actionItemsOf(mom).length > 0;
      navigate(hasTasks ? `${meetingBase}/${meetingId}/tasks` : `${meetingBase}/${meetingId}`);
    } catch {
      navigate(`${meetingBase}/${meetingId}`);
    } finally {
      setRoutingId(null);
    }
  };

  /* The getAll rows echo back projectName/projectCode — use the first
     row to label the header so we don't need a separate project fetch. */
  const projectLabel = useMemo(() => {
    const first = rows[0];
    if (!first) return projectId;
    return first.projectName || first.projectCode || projectId;
  }, [rows, projectId]);

  /* Client-side text search across code + title; the API has no q param. */
  const visible = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return rows;
    return rows.filter((m) =>
      `${m.meetingCode} ${m.title}`.toLowerCase().includes(needle)
    );
  }, [rows, q]);

  return (
    <div className="pmis-mtg">
      <div className="page-header">
        <div>
          <div className="pm-title">Meeting Details</div>
          <div className="pm-subtitle">{projectLabel}</div>
        </div>
        <div className="page-header-actions">
          <button
            type="button"
            className="btn cancel"
            onClick={() => navigate(`/projects/${encodeURIComponent(projectId)}`)}
          >
            ← Back to Project
          </button>
          <button
            type="button"
            className="btn"
            onClick={() => navigate(`${meetingBase}/new`)}
          >
            Create Meeting
          </button>
        </div>
      </div>

      <div className="card" style={{ margin: 0 }}>
        <div className="card-title">Meetings for this Project</div>

        <div className="toolbar">
          <div className="field grow">
            <label htmlFor="fSearch">Search</label>
            <input
              id="fSearch"
              type="search"
              placeholder="Search title or code…"
              value={q}
              onChange={(e) => setQ(e.target.value)}
            />
          </div>
          <div className="field">
            <label htmlFor="fStatus">Status</label>
            <select
              id="fStatus"
              value={fStatus}
              onChange={(e) => setFStatus(e.target.value)}
            >
              <option value="ALL">All statuses</option>
              {STATUS_OPTIONS.map((s) => (
                <option key={s} value={s}>{s}</option>
              ))}
            </select>
          </div>
        </div>

        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Meeting ID</th>
                <th>Title</th>
                <th>Date</th>
                <th>Time (IST)</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={5}>
                    <div className="empty-state">Loading…</div>
                  </td>
                </tr>
              ) : visible.length === 0 ? (
                <tr>
                  <td colSpan={5}>
                    <div className="empty-state">
                      No meetings found for this project.
                    </div>
                  </td>
                </tr>
              ) : (
                visible.map((m) => (
                  <tr
                    key={m.id}
                    className="clickable"
                    aria-busy={routingId === m.id}
                    style={routingId === m.id ? { opacity: 0.6 } : undefined}
                    onClick={() => openMeeting(m.id)}
                  >
                    <td><span className="link">{m.meetingCode}</span></td>
                    <td>{m.title}</td>
                    <td>{fmtDate(m.meetingDate)}</td>
                    <td>
                      {trimTime(m.startTime)}–{trimTime(m.endTime)}
                    </td>
                    {/* Row click opens the meeting, so this cell swallows its
                        own clicks — editing status must not navigate away. */}
                    <td onClick={(e) => e.stopPropagation()}>
                      {editingId === m.id ? (
                        <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                          <select
                            value={statusDraft}
                            onChange={(e) => setStatusDraft(e.target.value)}
                            disabled={savingId === m.id}
                            aria-label="Meeting status"
                            style={{ padding: "5px 8px", borderRadius: 6, border: "1px solid var(--border, #dbe5f1)", font: "inherit", fontSize: 12.5 }}
                          >
                            {STATUS_OPTIONS.map((s) => (
                              <option key={s} value={s}>{s}</option>
                            ))}
                          </select>
                          <button
                            type="button"
                            className="btn small-btn"
                            onClick={() => saveStatus(m)}
                            disabled={savingId === m.id}
                          >
                            {savingId === m.id ? "Saving…" : "Save"}
                          </button>
                          <button
                            type="button"
                            className="btn ghost small-btn"
                            onClick={cancelStatusEdit}
                            disabled={savingId === m.id}
                          >
                            Cancel
                          </button>
                        </span>
                      ) : (
                        <span style={{ display: "inline-flex", alignItems: "center", gap: 10 }}>
                          <StatusPill status={m.status} />
                          <button
                            type="button"
                            className="btn ghost small-btn"
                            title="Change this meeting's status"
                            onClick={() => startStatusEdit(m)}
                          >
                            Edit Status
                          </button>
                        </span>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {pageInfo.totalPages > 1 && (
          <div
            className="form-actions"
            style={{ justifyContent: "space-between", alignItems: "center" }}
          >
            <span className="muted" style={{ fontSize: 12.5 }}>
              Page {pageInfo.page + 1} of {pageInfo.totalPages} ·{" "}
              {pageInfo.totalElements} total
            </span>
            <div style={{ display: "flex", gap: 8 }}>
              <button
                type="button"
                className="btn ghost small-btn"
                disabled={pageInfo.page === 0 || loading}
                onClick={() => loadPage(pageInfo.page - 1)}
              >
                ← Prev
              </button>
              <button
                type="button"
                className="btn ghost small-btn"
                disabled={pageInfo.last || loading}
                onClick={() => loadPage(pageInfo.page + 1)}
              >
                Next →
              </button>
            </div>
          </div>
        )}
      </div>
      {toastNode}
    </div>
  );
}
