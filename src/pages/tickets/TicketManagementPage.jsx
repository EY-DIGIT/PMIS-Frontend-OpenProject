/* ══════════════════════════════════════════════════════════════════
   TicketManagementPage.jsx — Ticket & SLA Management (SRS §2.14).

   Covers, against dummy data (see data/ticketsMock.js):
     • Create project-related tickets, linked to project/task/activity
       and to a parent ticket          (PMIS-FR-35, .1, .4)
     • Categories Incident / Service Request / Change / Problem, each
       with its own workflow            (PMIS-FR-36, .1, .2, .3)
     • Priority, description, project ref, assignee with mandatory-field
       enforcement                      (PMIS-FR-37, .1)
     • Priority-driven SLA timelines + escalation, assignee owns SLA
       compliance, SLA health per row   (PMIS-FR-37.2, .3)
     • Intelligent routing suggestion (skills + availability + load)
                                         (PMIS-FR-37.4)
     • Bulk operations — batch status update + mass assignment
                                         (PMIS-FR-35.5)

   Everything is client-side mock state; swap the mock import for real
   API calls when the ticket service lands.
   ══════════════════════════════════════════════════════════════════ */

import React, { useMemo, useState } from "react";
import {
  TICKETS, CATEGORIES, PRIORITIES, STATUSES, SLA_STATES,
  ASSIGNEES, PROJECTS, LINKABLES,
} from "../../data/ticketsMock";
import "../../styles/tickets.css";

const catLabel = (code) => CATEGORIES.find((c) => c.code === code)?.label || code;
const prioOf = (code) => PRIORITIES.find((p) => p.code === code);
const statusLabel = (code) => STATUSES.find((s) => s.code === code)?.label || code;
const assigneeOf = (id) => ASSIGNEES.find((a) => a.id === id);
const projectName = (id) => PROJECTS.find((p) => p.id === id)?.name || id || "—";
const linkOf = (id) => LINKABLES.find((l) => l.id === id);

const initials = (name) =>
  (name || "?").split(" ").map((w) => w[0]).slice(0, 2).join("").toUpperCase();

/* Render minutes as a compact "2h 15m" / "3d 4h" string. */
function fmtDuration(mins) {
  const m = Math.abs(Math.round(mins));
  if (m < 60) return `${m}m`;
  if (m < 1440) return `${Math.floor(m / 60)}h ${m % 60}m`;
  return `${Math.floor(m / 1440)}d ${Math.floor((m % 1440) / 60)}h`;
}

/* Derive an SLA health bucket + remaining-time label for a ticket
   (PMIS-FR-37.2). Resolved / closed tickets count as MET. */
function slaFor(t) {
  if (t.status === "RESOLVED" || t.status === "CLOSED") {
    return { state: SLA_STATES.MET, text: "SLA met" };
  }
  const window = prioOf(t.priority)?.resolveMins || 1440;
  if (t.dueInMins < 0) {
    return { state: SLA_STATES.BREACHED, text: `Overdue ${fmtDuration(t.dueInMins)}` };
  }
  const atRisk = t.dueInMins <= window * 0.25;
  return {
    state: atRisk ? SLA_STATES.AT_RISK : SLA_STATES.ON_TRACK,
    text: `${fmtDuration(t.dueInMins)} left`,
  };
}

/* Intelligent routing (PMIS-FR-37.4): pick the available assignee whose
   skills best match the ticket category, breaking ties by lowest open
   load. Returns the suggested assignee + a short rationale. */
function suggestAssignee(categoryCode) {
  const want = catLabel(categoryCode);
  const ranked = ASSIGNEES
    .filter((a) => a.available)
    .map((a) => ({
      a,
      skillHit: a.skills.some((s) => s.toLowerCase() === want.toLowerCase()) ? 1 : 0,
    }))
    .sort((x, y) => (y.skillHit - x.skillHit) || (x.a.load - y.a.load));
  const top = ranked[0];
  if (!top) return null;
  const why = top.skillHit
    ? `skilled in ${want}, ${top.a.load} open`
    : `most available, ${top.a.load} open`;
  return { id: top.a.id, name: top.a.name, why };
}

const Badge = ({ cls, children }) => <span className={`tkt-badge ${cls}`}>{children}</span>;

export default function TicketManagementPage() {
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

  // Create modal
  const [showCreate, setShowCreate] = useState(false);

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
    let open = 0, inProgress = 0, breached = 0, resolved = 0;
    tickets.forEach((t) => {
      if (t.status === "OPEN") open += 1;
      if (t.status === "IN_PROGRESS") inProgress += 1;
      if (t.status === "RESOLVED" || t.status === "CLOSED") resolved += 1;
      if (slaFor(t).state.code === "BREACHED") breached += 1;
    });
    return { open, inProgress, breached, resolved };
  }, [tickets]);

  // ── selection helpers ──
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

  // ── bulk ops ──
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

  const addTicket = (t) => {
    setTickets((list) => [t, ...list]);
    setShowCreate(false);
  };

  return (
    <div className="uidai-pmis-content tkt-page">
      {/* Header */}
      <div className="tkt-header">
        <div>
          <h2>Ticket &amp; SLA Management</h2>
          <div className="tkt-lede">
            Raise and track operational and contractual issues against projects, tasks and
            activities. Categories drive SLA timelines, escalation and approval workflows.
          </div>
        </div>
        <button type="button" className="tkt-btn" onClick={() => setShowCreate(true)}>
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
        <div className="tkt-kpi danger">
          <div className="tkt-kpi-val">{kpis.breached}</div>
          <div className="tkt-kpi-lbl">SLA Breached</div>
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
            placeholder="Search ID, title or description…"
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
            {PRIORITIES.map((p) => <option key={p.code} value={p.code}>{p.code} · {p.label}</option>)}
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

      {/* Bulk action bar — PMIS-FR-35.5 */}
      {selected.size > 0 && (
        <div className="tkt-bulkbar">
          <span className="tkt-bulk-count">{selected.size} selected</span>

          <select value={bulkStatus} onChange={(e) => setBulkStatus(e.target.value)}>
            <option value="">Set status…</option>
            {STATUSES.map((s) => <option key={s.code} value={s.code}>{s.label}</option>)}
          </select>
          <button type="button" className="tkt-btn small" disabled={!bulkStatus} onClick={applyBulkStatus}>
            Apply
          </button>

          <select value={bulkAssignee} onChange={(e) => setBulkAssignee(e.target.value)}>
            <option value="">Assign to…</option>
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
              <th style={{ width: 150 }}>SLA</th>
              <th style={{ width: 170 }}>Assignee</th>
              <th style={{ width: 120 }}>Status</th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr>
                <td colSpan={8}><div className="tkt-empty">No tickets match your filters.</div></td>
              </tr>
            ) : (
              filtered.map((t) => {
                const sla = slaFor(t);
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
                        {link && <> · {link.kind}: {link.name}</>}
                      </div>
                      {t.parentId && <span className="tkt-parent">⛓ child of {t.parentId}</span>}
                    </td>
                    <td><Badge cls={`cat-${t.category}`}>{catLabel(t.category)}</Badge></td>
                    <td>
                      <Badge cls={`prio-${t.priority}`}>{t.priority}</Badge>
                    </td>
                    <td>
                      <Badge cls={`sla-${sla.state.code}`}>{sla.state.label}</Badge>
                      <div className="tkt-sla-time">{sla.text}</div>
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

      {showCreate && (
        <CreateTicketModal
          existing={tickets}
          onClose={() => setShowCreate(false)}
          onCreate={addTicket}
        />
      )}
    </div>
  );
}

/* ──────────────────────────────────────────────────────────────────
   Create Ticket modal — enforces mandatory fields (PMIS-FR-37.1) and
   offers an intelligent-routing suggestion for the assignee
   (PMIS-FR-37.4). Category change re-derives the SLA preview from the
   selected priority (PMIS-FR-37.2).
   ────────────────────────────────────────────────────────────────── */
function CreateTicketModal({ existing, onClose, onCreate }) {
  const [form, setForm] = useState({
    title: "",
    category: "INCIDENT",
    priority: "P3",
    projectId: "",
    linkId: "",
    assigneeId: "",
    parentId: "",
    description: "",
  });
  const [errors, setErrors] = useState({});

  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));

  // Link options are scoped to the chosen project (PMIS-FR-35.1).
  const linkOptions = LINKABLES.filter((l) => !form.projectId || l.projectId === form.projectId);
  const prio = prioOf(form.priority);
  const suggestion = suggestAssignee(form.category);

  const validate = () => {
    const e = {};
    if (!form.title.trim()) e.title = "Title is required.";
    if (!form.category) e.category = "Category is required.";
    if (!form.priority) e.priority = "Priority is required.";
    if (!form.projectId) e.projectId = "Project reference is required.";
    if (!form.assigneeId) e.assigneeId = "Assignee is required.";
    if (!form.description.trim()) e.description = "Description is required.";
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  const submit = () => {
    if (!validate()) return;
    const seq = 5000 + existing.length + 1;
    onCreate({
      id: `TKT-${seq}`,
      title: form.title.trim(),
      category: form.category,
      priority: form.priority,
      status: "OPEN",
      projectId: form.projectId,
      linkId: form.linkId || null,
      assigneeId: form.assigneeId,
      parentId: form.parentId || null,
      description: form.description.trim(),
      createdAgoMins: 0,
      dueInMins: prioOf(form.priority)?.resolveMins || 1440,
      requester: "You",
    });
  };

  return (
    <div className="tkt-modal-overlay" onClick={onClose}>
      <div className="tkt-modal" onClick={(e) => e.stopPropagation()}>
        <div className="tkt-modal-head">
          <h3>Create Ticket</h3>
          <button type="button" className="tkt-modal-x" aria-label="Close" onClick={onClose}>×</button>
        </div>

        <div className="tkt-modal-body">
          <div className="tkt-form-grid">
            <div className="full">
              <label className="req">Title</label>
              <input
                className={errors.title ? "err" : ""}
                value={form.title}
                placeholder="Short summary of the issue"
                onChange={(e) => set("title", e.target.value)}
              />
              {errors.title && <div className="tkt-err-msg">{errors.title}</div>}
            </div>

            <div>
              <label className="req">Category</label>
              <select className={errors.category ? "err" : ""} value={form.category} onChange={(e) => set("category", e.target.value)}>
                {CATEGORIES.map((c) => <option key={c.code} value={c.code}>{c.label}</option>)}
              </select>
            </div>

            <div>
              <label className="req">Priority</label>
              <select className={errors.priority ? "err" : ""} value={form.priority} onChange={(e) => set("priority", e.target.value)}>
                {PRIORITIES.map((p) => <option key={p.code} value={p.code}>{p.code} · {p.label}</option>)}
              </select>
            </div>

            <div>
              <label className="req">Project reference</label>
              <select className={errors.projectId ? "err" : ""} value={form.projectId} onChange={(e) => { set("projectId", e.target.value); set("linkId", ""); }}>
                <option value="">Select project…</option>
                {PROJECTS.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
              {errors.projectId && <div className="tkt-err-msg">{errors.projectId}</div>}
            </div>

            <div>
              <label>Link to task / activity</label>
              <select value={form.linkId} onChange={(e) => set("linkId", e.target.value)} disabled={!form.projectId}>
                <option value="">{form.projectId ? "None (project-level)" : "Pick a project first"}</option>
                {linkOptions.map((l) => <option key={l.id} value={l.id}>{l.kind}: {l.name}</option>)}
              </select>
            </div>

            <div>
              <label className="req">Assignee</label>
              <select className={errors.assigneeId ? "err" : ""} value={form.assigneeId} onChange={(e) => set("assigneeId", e.target.value)}>
                <option value="">Select assignee…</option>
                {ASSIGNEES.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}{a.available ? "" : " (busy)"} · {a.load} open
                  </option>
                ))}
              </select>
              {errors.assigneeId && <div className="tkt-err-msg">{errors.assigneeId}</div>}
            </div>

            <div>
              <label>Parent ticket</label>
              <select value={form.parentId} onChange={(e) => set("parentId", e.target.value)}>
                <option value="">None</option>
                {existing.map((t) => <option key={t.id} value={t.id}>{t.id} — {t.title.slice(0, 40)}</option>)}
              </select>
            </div>

            <div className="full">
              <label className="req">Description</label>
              <textarea
                className={errors.description ? "err" : ""}
                value={form.description}
                placeholder="Describe the operational or contractual issue…"
                onChange={(e) => set("description", e.target.value)}
              />
              {errors.description && <div className="tkt-err-msg">{errors.description}</div>}
            </div>

            {/* SLA preview + intelligent routing */}
            <div className="tkt-hint">
              <div>
                <b>SLA ({form.priority})</b>: respond in {fmtDuration(prio?.respondMins || 0)},
                resolve in {fmtDuration(prio?.resolveMins || 0)} · escalation: {prio?.escalation}
              </div>
              {suggestion && (
                <div style={{ marginTop: 6 }}>
                  <b>Suggested assignee</b>: {suggestion.name} ({suggestion.why})
                  <button
                    type="button"
                    className="tkt-route-btn"
                    onClick={() => set("assigneeId", suggestion.id)}
                  >
                    Use
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>

        <div className="tkt-modal-foot">
          <button type="button" className="tkt-btn ghost" onClick={onClose}>Cancel</button>
          <button type="button" className="tkt-btn" onClick={submit}>Create Ticket</button>
        </div>
      </div>
    </div>
  );
}
