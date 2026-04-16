// ─── Activity Page ────────────────────────────────────────────
import { useState, useEffect, useRef, useCallback } from "react";
import Btn from "./Btn";
import Field from "./Field";
import NodePopup from "./NodePopup";
import CommentsPanel from "./CommentsPanel";
import TaskModal from "./TaskModal";
function renumber(p) {
  if (!p) return;
  p.milestones = safeArr(p.milestones);
  p.milestones.forEach((m, mi) => {
    m.id = `M${mi + 1}`;
    m.activities = safeArr(m.activities);
    m.activities.forEach((a, ai) => {
      a.id = `A${mi + 1}.${ai + 1}`;
      a.tasks = safeArr(a.tasks);
      a.tasks.forEach((t, ti) => {
        t.id = `T${mi + 1}.${ai + 1}.${ti + 1}`;
        t.subtasks = safeArr(t.subtasks);
        t.subtasks.forEach((s, si) => { s.id = `S${mi + 1}.${ai + 1}.${ti + 1}.${si + 1}`; });
      });
    });
  });
}
function findByUid(list, id) {
  for (const item of safeArr(list)) {
    if (item.uid === id) return item;
    const f = findByUid(item.activities || [], id) || findByUid(item.tasks || [], id) || findByUid(item.subtasks || [], id);
    if (f) return f;
  }
  return null;
}
function addAudit(p, action, before, after) { if (!p) return; p.auditLogs = p.auditLogs || []; p.auditLogs.unshift({ when: new Date().toISOString(), who: "Admin", action, before, after }); }

const safeArr = (v) => Array.isArray(v) ? v : [];
const deepClone = (o) => JSON.parse(JSON.stringify(o));
const uid = (p) => `${p}-${Math.random().toString(36).slice(2, 11)}-${Date.now().toString(36)}`;
const TYPES = ["Standard Type", "Resource Type", "Transactional Type"];
export default function ActivityPage({ projectId, milestoneUid, activityUid, project, onBack, onUpdated }) {
  const milestone = findByUid(project.milestones, milestoneUid);
  const activity = findByUid(project.milestones, activityUid);
  if (!milestone || !activity) return null;
  const editable = !(project.status === "PUBLISHED" && !project.isVersion);
  const [form, setForm] = useState({ name: activity.name, description: activity.description || "", type: activity.type || "Standard Type", startDate: activity.startDate || "", endDate: activity.endDate || "", actualStartDate: activity.actualStartDate || "", actualEndDate: activity.actualEndDate || "", resourceDetails: activity.resourceDetails || null });
  const [taskModal, setTaskModal] = useState(null);
  const [nodePopup, setNodePopup] = useState(null);
  const [expandedTasks, setExpandedTasks] = useState(new Set(safeArr(activity.tasks).map(t => t.uid)));
  const u = (k, v) => setForm(f => ({ ...f, [k]: v }));
  const showRes = form.type === "Resource Type";

  const save = () => {
    if (!form.name || !form.startDate || !form.endDate) { onUpdated(null, "Fill required fields."); return; }
    const before = deepClone(activity);
    activity.name = form.name; activity.description = form.description; activity.type = form.type;
    activity.startDate = form.startDate; activity.endDate = form.endDate;
    activity.actualStartDate = form.actualStartDate; activity.actualEndDate = form.actualEndDate;
    activity.resourceDetails = showRes ? form.resourceDetails : null;
    addAudit(project, "Update Activity", before, deepClone(activity));
    onUpdated(activity, "Activity saved");
  };

  const addTask = (data) => {
    const task = { uid: uid("t"), name: data.name, description: data.desc, startDate: data.start, endDate: data.end, type: data.nType, actualStartDate: data.actStart, actualEndDate: data.actEnd, expanded: false, comments: [], subtasks: [] };
    activity.tasks = safeArr(activity.tasks);
    activity.tasks.push(task);
    renumber(project);
    addAudit(project, "Add Task", "-", deepClone(task));
    setNodePopup(null);
    onUpdated(activity, "Task added");
  };

  const removeTask = (tUid) => {
    const idx = safeArr(activity.tasks).findIndex(t => t.uid === tUid);
    if (idx < 0) return;
    const removed = activity.tasks.splice(idx, 1)[0];
    addAudit(project, "Delete Task", deepClone(removed), "-");
    renumber(project);
    onUpdated(activity, "Task removed");
  };

  const toggleTask = (tUid) => { const n = new Set(expandedTasks); n.has(tUid) ? n.delete(tUid) : n.add(tUid); setExpandedTasks(n); };
  const allExp = safeArr(activity.tasks).length > 0 && safeArr(activity.tasks).every(t => expandedTasks.has(t.uid));
  const toggleAll = () => setExpandedTasks(allExp ? new Set() : new Set(safeArr(activity.tasks).map(t => t.uid)));

  const addComment = (c) => { activity.comments = safeArr(activity.comments); activity.comments.unshift(c); onUpdated(activity); };

  const onTaskUpdated = (task, msg) => {
    if (msg) onUpdated(task, msg);
    else onUpdated(task);
    if (task && msg) setTaskModal(null);
  };

  const resKeys = [["resourceName", "Resource Name", "text"], ["onboardingDate", "Onboarding Date", "date"], ["offboardingDate", "Offboarding Date", "date"], ["actualOnboardingDate", "Actual Onboarding Date", "date"], ["actualOffboardingDate", "Actual Offboarding Date", "date"], ["position", "Position", "text"], ["designation", "Designation", "text"], ["jobRole", "Job Role", "text"], ["qualification", "Qualification", "text"], ["experience", "Experience (Years)", "number"]];

  return (
    <div>
      <div className="pm-title">Activity</div>
      <div className="card activity-page-shell">
        <div className="card-actions">
          <Btn onClick={save} disabled={!editable}>Save</Btn>
          <Btn onClick={() => setNodePopup({ type: "task", mode: "add", nodeUid: null, parentUid: activity.uid })} disabled={!editable}>+ Add Task</Btn>
          <Btn variant="cancel" onClick={onBack}>Back</Btn>
        </div>
        <h3 style={{ margin: 0 }}>{activity.name}</h3>
        <div className="activity-meta-grid">
          <Field label="Activity ID"><input value={activity.id} disabled /></Field>
          <Field label="Activity Type" required>
            <select value={form.type} onChange={e => u("type", e.target.value)} disabled={!editable}>
              {TYPES.map(t => <option key={t}>{t}</option>)}
            </select>
          </Field>
          <Field label="Activity Name" required><input value={form.name} onChange={e => u("name", e.target.value)} disabled={!editable} /></Field>
          <Field label="Milestone"><input value={milestone.name} disabled /></Field>
          <Field label="Description" full><textarea value={form.description} onChange={e => u("description", e.target.value)} disabled={!editable} /></Field>
          <Field label="Start Date" required><input type="date" value={form.startDate} onChange={e => u("startDate", e.target.value)} disabled={!editable} /></Field>
          <Field label="End Date" required><input type="date" value={form.endDate} onChange={e => u("endDate", e.target.value)} disabled={!editable} /></Field>
          <Field label="Actual Start Date"><input type="date" value={form.actualStartDate} onChange={e => u("actualStartDate", e.target.value)} disabled={!editable} /></Field>
          <Field label="Actual End Date"><input type="date" value={form.actualEndDate} onChange={e => u("actualEndDate", e.target.value)} disabled={!editable} /></Field>
        </div>
        {showRes && (
          <div className="activity-resource-grid">
            {resKeys.map(([k, lbl, t]) => (
              <Field key={k} label={lbl}>
                <input type={t} value={form.resourceDetails?.[k] || ""} onChange={e => u("resourceDetails", { ...(form.resourceDetails || {}), [k]: e.target.value })} disabled={!editable} />
              </Field>
            ))}
          </div>
        )}
        <div>
          <div className="subtask-header-row" style={{ marginTop: 18, marginBottom: 10 }}>
            <h4>Tasks</h4>
            <Btn variant="small" onClick={toggleAll} disabled={!safeArr(activity.tasks).length}>{allExp ? "Collapse All" : "Expand All"}</Btn>
          </div>
          <div className="task-card-list">
            {safeArr(activity.tasks).length === 0 ? <div className="hint">No tasks added yet</div> :
              safeArr(activity.tasks).map(task => (
                <div className="node-card" key={task.uid} id={`task-card-${task.uid}`}>
                  <div className="node-head">
                    <div className="node-summary" onClick={() => toggleTask(task.uid)}>
                      <div className="node-summary-left">
                        <div className="node-title">{task.name}</div>
                        <div className="node-subtitle">{safeArr(task.subtasks).length} sub tasks · {task.type || ""}</div>
                      </div>
                      <div className="node-arrow">{expandedTasks.has(task.uid) ? "▼" : "▶"}</div>
                    </div>
                    <div className="node-actions">
                      <Btn variant="small" onClick={() => setTaskModal({ projectId, milestoneUid, activityUid, taskUid: task.uid })}>View/Update</Btn>
                      <Btn variant="delete small-btn" onClick={() => removeTask(task.uid)} disabled={!editable}>Remove</Btn>
                    </div>
                  </div>
                  {expandedTasks.has(task.uid) && (
                    <div className="node-body">
                      <div className="grid">
                        <Field label="Description" full><textarea disabled>{task.description || ""}</textarea></Field>
                        <Field label="Task Type"><input value={task.type || ""} disabled /></Field>
                        <Field label="Actual Start Date"><input type="date" value={task.actualStartDate || ""} disabled /></Field>
                        <Field label="Actual End Date"><input type="date" value={task.actualEndDate || ""} disabled /></Field>
                      </div>
                    </div>
                  )}
                </div>
              ))
            }
          </div>
        </div>
        <CommentsPanel comments={activity.comments} onAdd={addComment} />
      </div>
      {nodePopup && <NodePopup ctx={nodePopup} project={project} onboardDraft={null} editingConfig={true} currentView="activity"
        onClose={() => setNodePopup(null)} onSaved={addTask} />}
      {taskModal && <TaskModal {...taskModal} project={project} onClose={() => setTaskModal(null)} onUpdated={onTaskUpdated} />}
    </div>
  );
}