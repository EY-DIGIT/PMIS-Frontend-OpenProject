/* ══════════════════════════════════════════════════════════════════
   CreateTicketPage.jsx — full-page "Create Ticket" form (SRS §2.14).

   Reached from the sidebar (Ticket Management › Create Ticket) at
   /tickets/new. Enforces the mandatory fields (PMIS-FR-37.1) and POSTs
   to the ticket-service via src/api/tickets.js.

   Category / Priority stay static catalogs (ticketsMock), but the
   Project, Assignee and Link-to-task/activity pickers are now fed by the
   live project / user APIs so the IDs, names and email shipped in the
   payload are real.
   ══════════════════════════════════════════════════════════════════ */

import React, { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { CATEGORIES, TICKET_PRIORITIES } from "../../data/ticketsMock";
import * as projectsApi from "../../api/projects";
import * as usersApi from "../../api/users";
import { createTicket } from "../../api/tickets";
import "../../styles/tickets.css";

/* Flatten a project tree into the list of things a ticket can be linked
   to — every activity and every task under it (PMIS-FR-35.1). Each entry
   carries a `kind` so submit knows whether to populate activity* or
   task* fields. */
function flattenLinkables(project) {
  const out = [];
  (project?.milestones || []).forEach((m) => {
    (m.activities || []).forEach((a) => {
      if (a.uuid) out.push({ id: a.uuid, kind: "Activity", name: a.name });
      (a.tasks || []).forEach((t) => {
        if (t.uuid) out.push({ id: t.uuid, kind: "Task", name: t.name });
      });
    });
  });
  return out;
}

export default function CreateTicketPage() {
  const navigate = useNavigate();

  const [form, setForm] = useState({
    title: "",
    category: "PMIS Support",
    subCategory: "",
    priority: "",
    projectId: "",
    linkId: "",
    assigneeId: "",
    parentTicketUuid: "",
    description: "",
    baselineRef: "",
    contractRef: "",
  });
  const [errors, setErrors] = useState({});

  /* Live master data. */
  const [projects, setProjects] = useState([]);
  const [users, setUsers] = useState([]);
  const [linkOptions, setLinkOptions] = useState([]);
  const [loadingProjects, setLoadingProjects] = useState(false);
  const [loadingUsers, setLoadingUsers] = useState(false);
  const [loadingLinks, setLoadingLinks] = useState(false);

  const [submitting, setSubmitting] = useState(false);
  const [apiError, setApiError] = useState("");

  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));

  /* Initial load: projects + user roster in parallel. */
  useEffect(() => {
    let alive = true;
    setLoadingProjects(true);
    setLoadingUsers(true);
    projectsApi
      .list({ pageSize: 200 })
      .then((rows) => { if (alive) setProjects(rows); })
      .catch((e) => { if (alive) setApiError(`Couldn't load projects: ${e.message}`); })
      .finally(() => { if (alive) setLoadingProjects(false); });
    usersApi
      .listAll()
      .then((rows) => { if (alive) setUsers(rows); })
      .catch((e) => { if (alive) setApiError(`Couldn't load users: ${e.message}`); })
      .finally(() => { if (alive) setLoadingUsers(false); });
    return () => { alive = false; };
  }, []);

  /* When the project changes, pull its tree to fill the link picker. */
  useEffect(() => {
    let alive = true;
    if (!form.projectId) { setLinkOptions([]); return undefined; }
    setLoadingLinks(true);
    projectsApi
      .getTree(form.projectId)
      .then((proj) => { if (alive) setLinkOptions(flattenLinkables(proj)); })
      .catch(() => { if (alive) setLinkOptions([]); })
      .finally(() => { if (alive) setLoadingLinks(false); });
    return () => { alive = false; };
  }, [form.projectId]);

  const validate = () => {
    const e = {};
    if (!form.title.trim()) e.title = "Title is required.";
    if (!form.category) e.category = "Category is required.";
    if (!form.priority) e.priority = "Priority is required.";
    if (!form.projectId) e.projectId = "Project reference is required.";
    if (!form.description.trim()) e.description = "Description is required.";
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  const submit = async () => {
    setApiError("");
    if (!validate()) return;

    const proj = projects.find((p) => p.projectId === form.projectId);
    const user = users.find((u) => u.userId === form.assigneeId);
    const link = linkOptions.find((l) => l.id === form.linkId);
    const isActivity = link?.kind === "Activity";
    const isTask = link?.kind === "Task";

    const ticket = {
      category: form.category,
      subCategory: form.subCategory.trim(),
      priority: form.priority,
      title: form.title.trim(),
      description: form.description.trim(),
      projectId: form.projectId,
      projectName: proj?.projectName || "",
      activityId: isActivity ? link.id : "",
      activityName: isActivity ? link.name : "",
      taskId: isTask ? link.id : "",
      taskName: isTask ? link.name : "",
      parentTicketUuid: form.parentTicketUuid.trim(),
      assigneeUuid: form.assigneeId,
      assigneeName: user?.fullName || "",
      assigneeEmail: user?.email || "",
      baselineRef: form.baselineRef.trim() || null,
      contractRef: form.contractRef.trim() || null,
    };

    setSubmitting(true);
    try {
      await createTicket(ticket);
      navigate("/tickets");
    } catch (e) {
      setApiError(e.message || "Failed to create ticket.");
    } finally {
      setSubmitting(false);
    }
  };

  const userLabel = (u) =>
    `${u.fullName || u.email || u.userId}${u.email ? ` · ${u.email}` : ""}`;

  return (
    <div className="uidai-pmis-content tkt-page">
      {/* Action bar — heading now lives in the global navbar. */}
      <div className="tkt-header tkt-header-actions">
        <button type="button" className="tkt-btn ghost" onClick={() => navigate("/tickets")}>
          ← Back to tickets
        </button>
      </div>

      <div className="tkt-form-card">
        {apiError && <div className="tkt-err-msg" style={{ marginBottom: 12 }}>{apiError}</div>}

        <div className="tkt-form-grid">
          <div>
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
              <option value="">Select priority…</option>
              {TICKET_PRIORITIES.map((p) => <option key={p.code} value={p.code}>{p.label}</option>)}
            </select>
          </div>

          <div>
            <label className="req">Project reference</label>
            <select
              className={errors.projectId ? "err" : ""}
              value={form.projectId}
              disabled={loadingProjects}
              onChange={(e) => { set("projectId", e.target.value); set("linkId", ""); }}
            >
              <option value="">{loadingProjects ? "Loading projects…" : "Select project…"}</option>
              {projects.map((p) => (
                <option key={p.projectId} value={p.projectId}>
                  {p.projectCode ? `${p.projectCode} — ` : ""}{p.projectName}
                </option>
              ))}
            </select>
            {errors.projectId && <div className="tkt-err-msg">{errors.projectId}</div>}
          </div>

          {/* <div>
            <label>Link to task / activity</label>
            <select
              value={form.linkId}
              onChange={(e) => set("linkId", e.target.value)}
              disabled={!form.projectId || loadingLinks}
            >
              <option value="">
                {!form.projectId
                  ? "Pick a project first"
                  : loadingLinks
                    ? "Loading…"
                    : "None (project-level)"}
              </option>
              {linkOptions.map((l) => (
                <option key={l.id} value={l.id}>{l.kind}: {l.name}</option>
              ))}
            </select>
          </div> */}

          

          {/* <div>
            <label>Parent ticket UUID</label>
            <input
              value={form.parentTicketUuid}
              placeholder="Optional — link as a child of another ticket"
              onChange={(e) => set("parentTicketUuid", e.target.value)}
            />
          </div> */}

        

         

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
        </div>

        <div className="tkt-form-foot">
          <button type="button" className="tkt-btn ghost" onClick={() => navigate("/tickets")} disabled={submitting}>
            Cancel
          </button>
          <button type="button" className="tkt-btn" onClick={submit} disabled={submitting}>
            {submitting ? "Creating…" : "Create Ticket"}
          </button>
        </div>
      </div>
    </div>
  );
}
