/* ══════════════════════════════════════════════════════════════════
   MeetingsListPage.jsx — "All Meetings" dashboard (route /meetings).
   Backed by GET /api/meetings (paged response).
   ══════════════════════════════════════════════════════════════════ */

import React, { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { listMeetings, updateMeetingStatus } from "../../api/meetings";
import * as projectsApi from "../../api/projects";
import { useToast } from "./_shared";
import "../../styles/meetings.css";

const STATUS_OPTIONS = ["DRAFT", "SCHEDULED", "COMPLETED", "CANCELLED"];

/* DRAFT → cls + label, falls back to a neutral badge for unknowns. */
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

export default function MeetingsListPage() {
  const navigate = useNavigate();
  const { show, node: toastNode } = useToast();

  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(false);
  const [pageInfo, setPageInfo] = useState({
    page: 0,
    size: 20,
    totalElements: 0,
    totalPages: 0,
    last: true,
  });
  const [projects, setProjects] = useState([]);

  const [q, setQ] = useState("");
  const [fProject, setFProject] = useState("ALL");
  const [fStatus, setFStatus] = useState("ALL");

  /* Inline per-row status editing. `editingId` is the meeting being edited;
     `savingId` guards its row's Save button. */
  const [editingId, setEditingId] = useState("");
  const [statusDraft, setStatusDraft] = useState("");
  const [savingId, setSavingId] = useState("");

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

  /* Load projects for the filter dropdown + name lookup. */
  useEffect(() => {
    let alive = true;
    projectsApi
      .list({ pageSize: 200 })
      .then((list) => { if (alive) setProjects(list); })
      .catch(() => { /* dropdown will just show "All projects" */ });
    return () => { alive = false; };
  }, []);

  /* Project name lookup for the table column. Supports both UUID and
     legacy code (the API returns either depending on when the meeting
     was created). */
  const projectName = useMemo(() => {
    const m = new Map();
    projects.forEach((p) => {
      if (p.projectId) m.set(p.projectId, p.projectName);
      if (p.projectCode) m.set(p.projectCode, p.projectName);
    });
    return (id) => m.get(id) || id || "—";
  }, [projects]);

  const loadPage = (page = 0) => {
    setLoading(true);
    listMeetings({
      projectId: fProject || "ALL",
      status: fStatus || "ALL",
      page,
      size: pageInfo.size,
    })
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

  /* Reload whenever a server-side filter changes. */
  useEffect(() => {
    loadPage(0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fProject, fStatus]);

  /* Client-side text search across id + title; the API has no q param. */
  const visible = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return rows;
    return rows.filter((m) =>
      `${m.id} ${m.title}`.toLowerCase().includes(needle)
    );
  }, [rows, q]);

  return (
    <div className="pmis-mtg">
      <div className="page-header">
        <div />
        <div className="page-header-actions">
          <button
            type="button"
            className="btn"
            onClick={() => navigate("/meetings/new")}
          >
            Create Meeting
          </button>
        </div>
      </div>

      <div className="card">
        <div className="card-title">All Meetings</div>

        <div className="toolbar">
          <div className="field grow">
            <label htmlFor="fSearch">Search</label>
            <input
              id="fSearch"
              type="search"
              placeholder="Search title or ID…"
              value={q}
              onChange={(e) => setQ(e.target.value)}
            />
          </div>
          <div className="field">
            <label htmlFor="fProject">Project</label>
            <select
              id="fProject"
              value={fProject}
              onChange={(e) => setFProject(e.target.value)}
            >
              <option value="ALL">All projects</option>
              {projects.map((p) => (
                <option key={p.projectId} value={p.projectId}>
                  {p.projectCode ? `${p.projectCode} — ` : ""}
                  {p.projectName}
                </option>
              ))}
            </select>
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
                <th>Project</th>
                <th>Date</th>
                <th>Time (IST)</th>
                <th style={{width:250}}>Status</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={6}>
                    <div className="empty-state">Loading…</div>
                  </td>
                </tr>
              ) : visible.length === 0 ? (
                <tr>
                  <td colSpan={6}>
                    <div className="empty-state">
                      No meetings match your filters.
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
                    <td>
                      <span className="pill-link">
                        {projectName(m.projectName)}
                      </span>
                    </td>
                    <td>{fmtDate(m.meetingDate)}</td>
                    <td>
                      {trimTime(m.startTime)}–{trimTime(m.endTime)}
                    </td>
                    <td onClick={(e) => e.stopPropagation()}>
                      {editingId === m.id ? (
                        <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                          <select
                            value={statusDraft}
                            onChange={(e) => setStatusDraft(e.target.value)}
                            disabled={savingId === m.id}
                            style={{ padding: "5px 8px", borderRadius: 6, border: "1px solid var(--border, #dbe5f1)", font: "inherit", fontSize: 12.5 }}
                          >
                            {STATUS_OPTIONS.map((s) => (
                              <option key={s} value={s}>{s}</option>
                            ))}
                          </select>
                          <button
                            type="button"
                            className="btn small-btn"
                            onClick={() => saveStatus(m),cancelStatusEdit}
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
                            x
                          </button>
                        </span>
                      ) : (
                        <span style={{ display: "inline-flex", alignItems: "center", gap: 10 }}>
                          <StatusPill status={m.status} />
                          <button
                            type="button"
                            className="btn ghost small-btn"
                            title="Edit status"
                            onClick={() => startStatusEdit(m)}
                          >
                            Edit
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