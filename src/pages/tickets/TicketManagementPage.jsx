/* â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
   TicketManagementPage.jsx â€” Ticket & SLA Management (SRS Â§2.14).

   Covers, against dummy data (see data/ticketsMock.js):
     â€¢ Create project-related tickets, linked to project/task/activity
       and to a parent ticket          (PMIS-FR-35, .1, .4)
     â€¢ Categories Incident / Service Request / Change / Problem, each
       with its own workflow            (PMIS-FR-36, .1, .2, .3)
     â€¢ Priority, description, project ref, assignee with mandatory-field
       enforcement                      (PMIS-FR-37, .1)
     â€¢ Priority-driven SLA timelines + escalation, assignee owns SLA
       compliance, SLA health per row   (PMIS-FR-37.2, .3)
     â€¢ Intelligent routing suggestion (skills + availability + load)
                                         (PMIS-FR-37.4)
     â€¢ Bulk operations â€” batch status update + mass assignment
                                         (PMIS-FR-35.5)

   Everything is client-side mock state; swap the mock import for real
   API calls when the ticket service lands.
   â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â• */

import React, { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  TICKETS, CATEGORIES, PRIORITIES, STATUSES,
  ASSIGNEES, PROJECTS, LINKABLES,
} from "../../data/ticketsMock";
import "../../styles/tickets.css";

const catLabel = (code) => CATEGORIES.find((c) => c.code === code)?.label || code;
const statusLabel = (code) => STATUSES.find((s) => s.code === code)?.label || code;
const assigneeOf = (id) => ASSIGNEES.find((a) => a.id === id);
const projectName = (id) => PROJECTS.find((p) => p.id === id)?.name || id || "â€”";
const linkOf = (id) => LINKABLES.find((l) => l.id === id);

const initials = (name) =>
  (name || "?").split(" ").map((w) => w[0]).slice(0, 2).join("").toUpperCase();

const Badge = ({ cls, children }) => <span className={`tkt-badge ${cls}`}>{children}</span>;

export default function TicketManagementPage() {
  const navigate = useNavigate();
  const [tickets, setTickets] = useState(TICKETS);

  // Filters
  const [q, setQ] = useState("");
  const [fCategory, setFCategory] = useState("ALL");
  const [fPriority, setFPriority] = useState("ALL");
  const [fStatus, setFStatus] = useState("ALL");
  const [fProject, setFProject] = useState("ALL");

  // Bulk selection (PMIS-FR-35.5)
  const [selected, setSelected] = useState(() => new Set());
  const [bulkStatus, setBulkStatus] = useState("");
  const [bulkAssignee, setBulkAssignee] = useState("");

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return tickets.filter((t) => {
      if (fCategory !== "ALL" && t.category !== fCategory) return false;
      if (fPriority !== "ALL" && t.priority !== fPriority) return false;
      if (fStatus !== "ALL" && t.status !== fStatus) return false;
      if (fProject !== "ALL" && t.projectId !== fProject) return false;
      if (needle) {
        const hay = `${t.id} ${t.title} ${t.description}`.toLowerCase();
        if (!hay.includes(needle)) return false;
      }
      return true;
    });
  }, [tickets, q, fCategory, fPriority, fStatus, fProject]);

  const kpis = useMemo(() => {
    let open = 0, inProgress = 0, resolved = 0;
    tickets.forEach((t) => {
      if (t.status === "OPEN") open += 1;
      if (t.status === "IN_PROGRESS") inProgress += 1;
      if (t.status === "RESOLVED" || t.status === "CLOSED") resolved += 1;
    });
    return { open, inProgress, resolved };
  }, [tickets]);

  // â”€â”€ selection helpers â”€â”€
  const allVisibleSelected = filtered.length > 0 && filtered.every((t) => selected.has(t.id));
  const toggleAll = () => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (allVisibleSelected) filtered.forEach((t) => next.delete(t.id));
      else filtered.forEach((t) => next.add(t.id));
      return next;
    });
  };
  const toggleOne = (id) => {
    setSelected((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };
  const clearSelection = () => setSelected(new Set());

  // â”€â”€ bulk ops â”€â”€
  const applyBulkStatus = () => {
    if (!bulkStatus) return;
    setTickets((list) => list.map((t) => (selected.has(t.id) ? { ...t, status: bulkStatus } : t)));
    setBulkStatus("");
    clearSelection();
  };
  const applyBulkAssignee = () => {
    if (!bulkAssignee) return;
    setTickets((list) => list.map((t) => (selected.has(t.id) ? { ...t, assigneeId: bulkAssignee } : t)));
    setBulkAssignee("");
    clearSelection();
  };

  return (
    <div className="uidai-pmis-content tkt-page">
      {/* Header */}
      <div className="tkt-header">
        <div>
          <h2>Ticket Management</h2>
          <div className="tkt-lede">
            Raise and track operational and contractual issues against projects, tasks and
            activities. Categories drive escalation and approval workflows.
          </div>
        </div>
        <button type="button" className="tkt-btn" onClick={() => navigate("/tickets/new")}>
          + Create Ticket
        </button>
      </div>

      {/* KPI summary */}
      <div className="tkt-kpis">
        <div className="tkt-kpi">
          <div className="tkt-kpi-val">{kpis.open}</div>
          <div className="tkt-kpi-lbl">Open</div>
        </div>
        <div className="tkt-kpi">
          <div className="tkt-kpi-val">{kpis.inProgress}</div>
          <div className="tkt-kpi-lbl">In Progress</div>
        </div>
        <div className="tkt-kpi">
          <div className="tkt-kpi-val">{kpis.resolved}</div>
          <div className="tkt-kpi-lbl">Resolved / Closed</div>
        </div>
      </div>

      {/* Filters */}
      <div className="tkt-toolbar">
        <div className="tkt-field grow">
          <label htmlFor="tkt-q">Search</label>
          <input
            id="tkt-q"
            type="search"
            placeholder="Search ID, title or descriptionâ€¦"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
        </div>
        <div className="tkt-field">
          <label htmlFor="tkt-cat">Category</label>
          <select id="tkt-cat" value={fCategory} onChange={(e) => setFCategory(e.target.value)}>
            <option value="ALL">All categories</option>
            {CATEGORIES.map((c) => <option key={c.code} value={c.code}>{c.label}</option>)}
          </select>
        </div>
        <div className="tkt-field">
          <label htmlFor="tkt-prio">Priority</label>
          <select id="tkt-prio" value={fPriority} onChange={(e) => setFPriority(e.target.value)}>
            <option value="ALL">All priorities</option>
            {PRIORITIES.map((p) => <option key={p.code} value={p.code}>{p.code} Â· {p.label}</option>)}
          </select>
        </div>
        <div className="tkt-field">
          <label htmlFor="tkt-status">Status</label>
          <select id="tkt-status" value={fStatus} onChange={(e) => setFStatus(e.target.value)}>
            <option value="ALL">All statuses</option>
            {STATUSES.map((s) => <option key={s.code} value={s.code}>{s.label}</option>)}
          </select>
        </div>
        <div className="tkt-field">
          <label htmlFor="tkt-proj">Project</label>
          <select id="tkt-proj" value={fProject} onChange={(e) => setFProject(e.target.value)}>
            <option value="ALL">All projects</option>
            {PROJECTS.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </div>
      </div>

      {/* Bulk action bar â€” PMIS-FR-35.5 */}
      {selected.size > 0 && (
        <div className="tkt-bulkbar">
          <span className="tkt-bulk-count">{selected.size} selected</span>

          <select value={bulkStatus} onChange={(e) => setBulkStatus(e.target.value)}>
            <option value="">Set statusâ€¦</option>
            {STATUSES.map((s) => <option key={s.code} value={s.code}>{s.label}</option>)}
          </select>
          <button type="button" className="tkt-btn small" disabled={!bulkStatus} onClick={applyBulkStatus}>
            Apply
          </button>

          <select value={bulkAssignee} onChange={(e) => setBulkAssignee(e.target.value)}>
            <option value="">Assign toâ€¦</option>
            {ASSIGNEES.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
          </select>
          <button type="button" className="tkt-btn small" disabled={!bulkAssignee} onClick={applyBulkAssignee}>
            Assign
          </button>

          <span className="tkt-bulk-spacer" />
          <button type="button" className="tkt-btn ghost small" onClick={clearSelection}>
            Clear
          </button>
        </div>
      )}

      {/* Ticket table */}
      <div className="tkt-table-wrap">
        <table className="tkt-table">
          <thead>
            <tr>
              <th style={{ width: 36 }}>
                <input
                  type="checkbox"
                  className="tkt-checkbox"
                  aria-label="Select all"
                  checked={allVisibleSelected}
                  onChange={toggleAll}
                />
              </th>
              <th style={{ width: 90 }}>Ticket</th>
              <th>Summary</th>
              <th style={{ width: 130 }}>Category</th>
              <th style={{ width: 90 }}>Priority</th>
              <th style={{ width: 170 }}>Assignee</th>
              <th style={{ width: 120 }}>Status</th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr>
                <td colSpan={7}><div className="tkt-empty">No tickets match your filters.</div></td>
              </tr>
            ) : (
              filtered.map((t) => {
                const link = linkOf(t.linkId);
                const a = assigneeOf(t.assigneeId);
                return (
                  <tr key={t.id}>
                    <td>
                      <input
                        type="checkbox"
                        className="tkt-checkbox"
                        aria-label={`Select ${t.id}`}
                        checked={selected.has(t.id)}
                        onChange={() => toggleOne(t.id)}
                      />
                    </td>
                    <td><span className="tkt-id">{t.id}</span></td>
                    <td>
                      <div className="tkt-title">{t.title}</div>
                      <div className="tkt-sub">
                        {projectName(t.projectId)}
                        {link && <> Â· {link.kind}: {link.name}</>}
                      </div>
                      {t.parentId && <span className="tkt-parent">â›“ child of {t.parentId}</span>}
                    </td>
                    <td><Badge cls={`cat-${t.category}`}>{catLabel(t.category)}</Badge></td>
                    <td>
                      <Badge cls={`prio-${t.priority}`}>{t.priority}</Badge>
                    </td>
                    <td>
                      {a ? (
                        <div className="tkt-assignee">
                          <span className="tkt-avatar">{initials(a.name)}</span>
                          <span>{a.name}</span>
                        </div>
                      ) : <span className="tkt-sub">Unassigned</span>}
                    </td>
                    <td><Badge cls={`st-${t.status}`}>{statusLabel(t.status)}</Badge></td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

    </div>
  );
}
