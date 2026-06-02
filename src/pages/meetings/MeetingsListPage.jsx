/* ══════════════════════════════════════════════════════════════════
   MeetingsListPage.jsx — "All Meetings" dashboard (route /meetings).
   Mirrors the HTML reference's `showDashboard()` view: stat row +
   filter toolbar + table. Click on a row → /meetings/:id.
   ══════════════════════════════════════════════════════════════════ */

import React, { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  listMeetings,
  PROJECTS,
  TYPE_META,
  STATUS_META,
  fmtDate,
  isOverdue
} from "../../data/meetingsMock";
import { TypeBadge, StatusBadge, LinkPill, useToast } from "./_shared";
import "../../styles/meetings.css";

export default function MeetingsListPage() {
  const navigate = useNavigate();
  const { node: toastNode } = useToast();
  const meetings = useMemo(() => listMeetings(), []);

  const [q, setQ] = useState("");
  const [fProject, setFProject] = useState("");
  const [fType, setFType] = useState("");
  const [fStatus, setFStatus] = useState("");

  /* Aggregate action-item stats across every meeting. */
  const stats = useMemo(() => {
    let total = 0;
    let prog = 0;
    let delayed = 0;
    let done = 0;
    meetings.forEach((m) =>
      m.actionItems.forEach((a) => {
        total++;
        if (a.status === "Completed") done++;
        else if (a.status === "In Progress") prog++;
        if (isOverdue(a) || a.status === "Delayed") delayed++;
      })
    );
    return { total, prog, delayed, done };
  }, [meetings]);

  const visible = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return meetings
      .filter((m) => {
        if (
          needle &&
          !`${m.id} ${m.title} ${m.location}`.toLowerCase().includes(needle)
        )
          return false;
        if (fProject === "__general" && m.link !== "general") return false;
        if (fProject && fProject !== "__general" && m.projectId !== fProject)
          return false;
        if (fType && m.type !== fType) return false;
        if (fStatus && m.status !== fStatus) return false;
        return true;
      })
      .sort((a, b) => (b.date || "").localeCompare(a.date || ""));
  }, [meetings, q, fProject, fType, fStatus]);

  return (
    <div className="pmis-mtg">
      <div className="page-header">
        <div>
          <div className="pm-title">Meeting Management</div>
        </div>
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

      <div className="stat-row">
        <div className="stat s-total">
          <div className="num">{stats.total}</div>
          <div className="lbl">Action items</div>
        </div>
        <div className="stat s-progress">
          <div className="num">{stats.prog}</div>
          <div className="lbl">In progress</div>
        </div>
        <div className="stat s-delayed">
          <div className="num">{stats.delayed}</div>
          <div className="lbl">Overdue</div>
        </div>
        <div className="stat s-done">
          <div className="num">{stats.done}</div>
          <div className="lbl">Completed</div>
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
              placeholder="Search title, ID or location…"
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
              <option value="">All projects</option>
              <option value="__general">General (no project)</option>
              {PROJECTS.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.id} — {p.name}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label htmlFor="fType">Type</label>
            <select
              id="fType"
              value={fType}
              onChange={(e) => setFType(e.target.value)}
            >
              <option value="">All types</option>
              {Object.keys(TYPE_META).map((t) => (
                <option key={t} value={t}>
                  {t}
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
              <option value="">All statuses</option>
              {Object.keys(STATUS_META).map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
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
                <th>Type</th>
                <th>Linked to</th>
                <th>Date</th>
                <th>Status</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {visible.length === 0 ? (
                <tr>
                  <td colSpan={7}>
                    <div className="empty-state">No meetings match your filters.</div>
                  </td>
                </tr>
              ) : (
                visible.map((m) => {
                  const ai = m.actionItems.length;
                  const od = m.actionItems.filter((a) => isOverdue(a)).length ||
                    m.actionItems.filter((a) => a.status === "Delayed").length;
                  return (
                    <tr
                      key={m.id}
                      className="clickable"
                      onClick={() => navigate(`/meetings/${m.id}`)}
                    >
                      <td>
                        <span className="link">{m.id}</span>
                      </td>
                      <td>{m.title}</td>
                      <td>
                        <TypeBadge type={m.type} />
                      </td>
                      <td>
                        <LinkPill meeting={m} />
                      </td>
                      <td>
                        {fmtDate(m.date)}
                        <div className="muted">
                          {m.start}–{m.end} IST
                        </div>
                      </td>
                      <td>
                        <StatusBadge status={m.status} />
                      </td>
                      <td>
                        {ai > 0 ? (
                          <>
                            {ai} item{ai > 1 ? "s" : ""}
                            {od > 0 && (
                              <span style={{ color: "var(--red)", fontWeight: 700 }}>
                                {" "}
                                · {od} overdue
                              </span>
                            )}
                          </>
                        ) : (
                          <span className="muted">—</span>
                        )}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>
      {toastNode}
    </div>
  );
}
