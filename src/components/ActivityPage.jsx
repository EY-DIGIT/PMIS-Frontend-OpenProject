// ============================================================
// pages/ActivityPage.jsx
// Route: /projects/:projectId/config/milestone/:milestoneUid/activity/:activityUid
// ============================================================
import { useState } from "react";
import { useParams, useNavigate } from "react-router-dom";

import {
  useProjects, safeArr, deepClone, uid,
  renumber, addAudit, findByUid,
} from "../store/Projectstore";

import Btn           from "./Btn";
import Field         from "./Field";
import NodePopup     from "./NodePopup";
import CommentsPanel from "./CommentsPanel";
import MessageModal  from "./MessageModal";

const TYPES = ["Standard Type", "Resource Type", "Transactional Type"];

export default function ActivityPage() {
  const { projectId, milestoneUid, activityUid } = useParams();
  const navigate = useNavigate();
  const { getById, mutate } = useProjects();

  const project   = getById(projectId);
  const milestone = project ? findByUid(project.milestones, milestoneUid) : null;
  const activity  = project ? findByUid(project.milestones, activityUid)  : null;

  // Hooks must run before any conditional return
  const [msg,          setMsg]          = useState(null);
  const [nodePopup,    setNodePopup]    = useState(null);
  const [form,         setForm]         = useState({
    name:            activity?.name            || "",
    description:     activity?.description     || "",
    type:            activity?.type            || "Standard Type",
    startDate:       activity?.startDate       || "",
    endDate:         activity?.endDate         || "",
    actualStartDate: activity?.actualStartDate || "",
    actualEndDate:   activity?.actualEndDate   || "",
    resourceDetails: activity?.resourceDetails || null,
  });
  const [expandedTasks, setExpandedTasks] = useState(
    () => new Set(safeArr(activity?.tasks).map((t) => t.uid))
  );

  // ── Guard ───────────────────────────────────────────────
  if (!project || !milestone || !activity) {
    return (
      <div className="card" style={{ padding: 24 }}>
        <p>Activity not found.</p>
        <Btn onClick={() => navigate(`/projects/${projectId}/config`)}>Back</Btn>
      </div>
    );
  }

  const editable = !(project.status === "PUBLISHED" && !project.isVersion);
  const u = (k, v) => setForm((f) => ({ ...f, [k]: v }));
  const showRes = form.type === "Resource Type";

  // ── Save activity ───────────────────────────────────────
  const save = () => {
    if (!form.name || !form.startDate || !form.endDate) {
      setMsg({ text: "Fill required fields.", onOk: () => setMsg(null) });
      return;
    }
    const p = deepClone(project);
    const a = findByUid(p.milestones, activityUid);
    if (!a) return;

    const before = deepClone(a);
    a.name            = form.name;
    a.description     = form.description;
    a.type            = form.type;
    a.startDate       = form.startDate;
    a.endDate         = form.endDate;
    a.actualStartDate = form.actualStartDate;
    a.actualEndDate   = form.actualEndDate;
    a.resourceDetails = showRes ? form.resourceDetails : null;

    addAudit(p, "Update Activity", before, deepClone(a));
    mutate(p);
    setMsg({ text: "Activity saved", onOk: () => setMsg(null) });
  };

  // ── Task add ────────────────────────────────────────────
  const addTask = (data) => {
    const p = deepClone(project);
    const a = findByUid(p.milestones, activityUid);
    if (!a) return;

    const task = {
      uid: uid("t"),
      name: data.name, description: data.desc,
      startDate: data.start, endDate: data.end, type: data.nType,
      actualStartDate: data.actStart, actualEndDate: data.actEnd,
      expanded: false, comments: [], subtasks: [],
    };
    a.tasks = safeArr(a.tasks);
    a.tasks.push(task);

    renumber(p);
    addAudit(p, "Add Task", "-", deepClone(task));
    mutate(p);
    setNodePopup(null);
    setMsg({ text: "Task added", onOk: () => setMsg(null) });
  };

  // ── Task remove ─────────────────────────────────────────
  const removeTask = (tUid) => {
    const p = deepClone(project);
    const a = findByUid(p.milestones, activityUid);
    if (!a) return;

    const idx = safeArr(a.tasks).findIndex((t) => t.uid === tUid);
    if (idx < 0) return;

    const removed = a.tasks.splice(idx, 1)[0];
    addAudit(p, "Delete Task", deepClone(removed), "-");
    renumber(p);
    mutate(p);
    setMsg({ text: "Task removed", onOk: () => setMsg(null) });
  };

  // ── Task expand/collapse ────────────────────────────────
  const toggleTask = (tUid) => {
    const n = new Set(expandedTasks);
    n.has(tUid) ? n.delete(tUid) : n.add(tUid);
    setExpandedTasks(n);
  };
  const allExp = safeArr(activity.tasks).length > 0 &&
    safeArr(activity.tasks).every((t) => expandedTasks.has(t.uid));
  const toggleAll = () =>
    setExpandedTasks(allExp ? new Set() : new Set(safeArr(activity.tasks).map((t) => t.uid)));

  // ── Comment ─────────────────────────────────────────────
  const addComment = (c) => {
    const p = deepClone(project);
    const a = findByUid(p.milestones, activityUid);
    if (!a) return;
    a.comments = safeArr(a.comments);
    a.comments.unshift(c);
    mutate(p);
  };

  const resKeys = [
    ["resourceName",          "Resource Name",          "text"],
    ["onboardingDate",        "Onboarding Date",        "date"],
    ["offboardingDate",       "Offboarding Date",       "date"],
    ["actualOnboardingDate",  "Actual Onboarding Date", "date"],
    ["actualOffboardingDate", "Actual Offboarding Date","date"],
    ["position",              "Position",               "text"],
    ["designation",           "Designation",            "text"],
    ["jobRole",               "Job Role",               "text"],
    ["qualification",         "Qualification",          "text"],
    ["experience",            "Experience (Years)",     "number"],
  ];

  return (
    <div>
      <div className="pm-title">Activity</div>
      <div className="card activity-page-shell">
        <div className="card-actions">
          <Btn onClick={save} disabled={!editable}>Save</Btn>
          <Btn
            onClick={() => setNodePopup({ type: "task", mode: "add", nodeUid: null, parentUid: activity.uid })}
            disabled={!editable}
          >
            + Add Task
          </Btn>
          <Btn variant="cancel" onClick={() => navigate(`/projects/${projectId}/config`)}>
            Back
          </Btn>
        </div>

        <h3 style={{ margin: 0 }}>{activity.name}</h3>

        <div className="activity-meta-grid">
          <Field label="Activity ID"><input value={activity.id} disabled /></Field>
          <Field label="Activity Type" required>
            <select value={form.type} onChange={(e) => u("type", e.target.value)} disabled={!editable}>
              {TYPES.map((t) => <option key={t}>{t}</option>)}
            </select>
          </Field>
          <Field label="Activity Name" required>
            <input value={form.name} onChange={(e) => u("name", e.target.value)} disabled={!editable} />
          </Field>
          <Field label="Milestone"><input value={milestone.name} disabled /></Field>
          <Field label="Description" full>
            <textarea value={form.description} onChange={(e) => u("description", e.target.value)} disabled={!editable} />
          </Field>
          <Field label="Start Date" required>
            <input type="date" value={form.startDate} onChange={(e) => u("startDate", e.target.value)} disabled={!editable} />
          </Field>
          <Field label="End Date" required>
            <input type="date" value={form.endDate} onChange={(e) => u("endDate", e.target.value)} disabled={!editable} />
          </Field>
          <Field label="Actual Start Date">
            <input type="date" value={form.actualStartDate} onChange={(e) => u("actualStartDate", e.target.value)} disabled={!editable} />
          </Field>
          <Field label="Actual End Date">
            <input type="date" value={form.actualEndDate} onChange={(e) => u("actualEndDate", e.target.value)} disabled={!editable} />
          </Field>
        </div>

        {showRes && (
          <div className="activity-resource-grid">
            {resKeys.map(([k, lbl, t]) => (
              <Field key={k} label={lbl}>
                <input
                  type={t}
                  value={form.resourceDetails?.[k] || ""}
                  onChange={(e) => u("resourceDetails", { ...(form.resourceDetails || {}), [k]: e.target.value })}
                  disabled={!editable}
                />
              </Field>
            ))}
          </div>
        )}

        <div>
          <div className="subtask-header-row" style={{ marginTop: 18, marginBottom: 10 }}>
            <h4>Tasks</h4>
            <Btn variant="small" onClick={toggleAll} disabled={!safeArr(activity.tasks).length}>
              {allExp ? "Collapse All" : "Expand All"}
            </Btn>
          </div>
          <div className="task-card-list">
            {safeArr(activity.tasks).length === 0 ? (
              <div className="hint">No tasks added yet</div>
            ) : (
              safeArr(activity.tasks).map((task) => (
                <div className="node-card" key={task.uid} id={`task-card-${task.uid}`}>
                  <div className="node-head">
                    <div className="node-summary" onClick={() => toggleTask(task.uid)}>
                      <div className="node-summary-left">
                        <div className="node-title">{task.name}</div>
                        <div className="node-subtitle">
                          {safeArr(task.subtasks).length} sub tasks · {task.type || ""}
                        </div>
                      </div>
                      <div className="node-arrow">{expandedTasks.has(task.uid) ? "▼" : "▶"}</div>
                    </div>
                    <div className="node-actions">
                      <Btn
                        variant="small"
                        onClick={() =>
                          navigate(
                            `/projects/${projectId}/config/milestone/${milestoneUid}/activity/${activityUid}/task/${task.uid}`
                          )
                        }
                      >
                        View/Update
                      </Btn>
                      <Btn
                        variant="delete small-btn"
                        onClick={() => removeTask(task.uid)}
                        disabled={!editable}
                      >
                        Remove
                      </Btn>
                    </div>
                  </div>
                  {expandedTasks.has(task.uid) && (
                    <div className="node-body">
                      <div className="grid">
                        <Field label="Description" full>
                          <textarea value={task.description || ""} disabled readOnly />
                        </Field>
                        <Field label="Task Type"><input value={task.type || ""} disabled /></Field>
                        <Field label="Actual Start Date">
                          <input type="date" value={task.actualStartDate || ""} disabled />
                        </Field>
                        <Field label="Actual End Date">
                          <input type="date" value={task.actualEndDate || ""} disabled />
                        </Field>
                      </div>
                    </div>
                  )}
                </div>
              ))
            )}
          </div>
        </div>

        <CommentsPanel comments={activity.comments} onAdd={addComment} />
      </div>

      {nodePopup && (
        <NodePopup
          ctx={nodePopup}
          project={project}
          onboardDraft={null}
          editingConfig={true}
          currentView="activity"
          onClose={() => setNodePopup(null)}
          onSaved={addTask}
        />
      )}
      {msg && <MessageModal msg={msg.text} onOk={msg.onOk} />}
    </div>
  );
}