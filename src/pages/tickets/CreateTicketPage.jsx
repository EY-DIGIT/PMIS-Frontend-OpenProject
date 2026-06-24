/* ══════════════════════════════════════════════════════════════════
   CreateTicketPage.jsx — full-page "Create Ticket" form (SRS §2.14).

   This is the page-route version of what used to be the in-page modal
   on TicketManagementPage. Reached from the sidebar (Ticket Management ›
   Create Ticket) at /tickets/new.

   Enforces mandatory fields (PMIS-FR-37.1), previews the priority-driven
   SLA window (PMIS-FR-37.2) and offers an intelligent-routing suggestion
   for the assignee (PMIS-FR-37.4). On submit the new ticket is prepended
   to the shared mock list and the user is returned to /tickets.
   ══════════════════════════════════════════════════════════════════ */

import React, { useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  TICKETS, CATEGORIES, PRIORITIES, ASSIGNEES, PROJECTS, LINKABLES,
} from "../../data/ticketsMock";
import "../../styles/tickets.css";

const catLabel = (code) => CATEGORIES.find((c) => c.code === code)?.label || code;
const prioOf = (code) => PRIORITIES.find((p) => p.code === code);

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

export default function CreateTicketPage() {
  const navigate = useNavigate();

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
    const seq = 5000 + TICKETS.length + 1;
    // Mutate the shared mock list so the All-Tickets page picks it up on
    // its next mount. Swap for a real POST when the ticket service lands.
    TICKETS.unshift({
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
    navigate("/tickets");
  };

  return (
    <div className="uidai-pmis-content tkt-page">
      {/* Header */}
      <div className="tkt-header">
        <div>
          <h2>Create Ticket</h2>
          <div className="tkt-lede">
            Raise an operational or contractual issue against a project, task or activity.
            The category and priority drive the SLA timeline, escalation and approval workflow.
          </div>
        </div>
        <button type="button" className="tkt-btn ghost" onClick={() => navigate("/tickets")}>
          ← Back to tickets
        </button>
      </div>

      <div className="tkt-form-card">
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
              {TICKETS.map((t) => <option key={t.id} value={t.id}>{t.id} — {t.title.slice(0, 40)}</option>)}
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

          {/* Intelligent routing suggestion */}
          {suggestion && (
            <div className="tkt-hint full">
              <div>
                <b>Suggested assignee</b>: {suggestion.name} ({suggestion.why})
                <button
                  type="button"
                  className="tkt-route-btn"
                  onClick={() => set("assigneeId", suggestion.id)}
                >
                  Use
                </button>
              </div>
            </div>
          )}
        </div>

        <div className="tkt-form-foot">
          <button type="button" className="tkt-btn ghost" onClick={() => navigate("/tickets")}>Cancel</button>
          <button type="button" className="tkt-btn" onClick={submit}>Create Ticket</button>
        </div>
      </div>
    </div>
  );
}
