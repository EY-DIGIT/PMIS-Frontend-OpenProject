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
import { listMeetings } from "../../api/meetings";
import { useToast } from "./_shared";
import "../../styles/meetings.css";

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

export default function ProjectMeetingsPage() {
  const { projectId } = useParams();
  const navigate = useNavigate();
  const { show, node: toastNode } = useToast();

  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(false);
  const [q, setQ] = useState("");
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
    listMeetings({ projectId, status: "ALL", page, size: pageInfo.size })
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
    loadPage(0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId]);

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
            onClick={() => navigate("/meetings/new")}
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
                    onClick={() => navigate(`/meetings/${m.id}`)}
                  >
                    <td><span className="link">#{m.meetingCode}</span></td>
                    <td>{m.title}</td>
                    <td>{fmtDate(m.meetingDate)}</td>
                    <td>
                      {trimTime(m.startTime)}–{trimTime(m.endTime)}
                    </td>
                    <td>
                      <StatusPill status={m.status} />
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
