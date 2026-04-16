import { useState, useEffect, useRef, useCallback } from "react";
import Btn from "./Btn";
import Field from "./Field";
import NodePopup from "./NodePopup";
import SubtaskCard from "./SubtaskCard";
import CommentsPanel from "./CommentsPanel";
const TYPES = ["Standard Type", "Resource Type", "Transactional Type"];
const safeArr = (v) => Array.isArray(v) ? v : [];
function findByUid(list, id) {
  for (const item of safeArr(list)) {
    if (item.uid === id) return item;
    const f = findByUid(item.activities || [], id) || findByUid(item.tasks || [], id) || findByUid(item.subtasks || [], id);
    if (f) return f;
  }
  return null;
}
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
function findTaskOwner(project, taskUid) {
  for (const m of safeArr(project?.milestones)) {
    for (const a of safeArr(m.activities)) {
      const t = safeArr(a.tasks).find(x => x.uid === taskUid);
      if (t) return { milestone: m, activity: a, task: t };
    }
  }
  return null;
}
function addAudit(p, action, before, after) { if (!p) return; p.auditLogs = p.auditLogs || []; p.auditLogs.unshift({ when: new Date().toISOString(), who: "Admin", action, before, after }); }

export default function TaskModal({ projectId, milestoneUid, activityUid, taskUid, project, onClose, onUpdated }) {
  const owner = findTaskOwner(project, taskUid);
  if (!owner) return null;
  const { task } = owner;
  const editable = !(project.status === "PUBLISHED" && !project.isVersion);
  const [form, setForm] = useState({ name: task.name, description: task.description || "", type: task.type || "Standard Type", startDate: task.startDate || "", endDate: task.endDate || "", actualStartDate: task.actualStartDate || "", actualEndDate: task.actualEndDate || "" });
  const [expandedSubs, setExpandedSubs] = useState(new Set(safeArr(task.subtasks).map(s => s.uid)));
  const [nodePopup, setNodePopup] = useState(null);
  const u = (k, v) => setForm(f => ({ ...f, [k]: v }));

  const save = () => {
    if (!form.name || !form.startDate || !form.endDate) { onUpdated(null, "Fill required fields."); return; }
    const before = deepClone(task);
    task.name = form.name; task.description = form.description; task.type = form.type;
    task.startDate = form.startDate; task.endDate = form.endDate;
    task.actualStartDate = form.actualStartDate; task.actualEndDate = form.actualEndDate;
    addAudit(project, "Update Task", before, deepClone(task));
    onUpdated(task, "Task saved");
  };

  const addSubtask = (data) => {
    const sub = { uid: uid("s"), name: data.name, description: data.desc, startDate: data.start, endDate: data.end, actualStartDate: data.actStart, actualEndDate: data.actEnd, expanded: false, comments: [] };
    task.subtasks = safeArr(task.subtasks);
    task.subtasks.push(sub);
    renumber(project);
    addAudit(project, "Add Sub Task", "-", deepClone(sub));
    setExpandedSubs(new Set([...expandedSubs, sub.uid]));
    setNodePopup(null);
    onUpdated(task, "New Sub-Task Added");
  };

  const editSubtask = (data) => {
    const s = findByUid(task.subtasks || [], nodePopup.nodeUid);
    if (!s) return;
    const before = deepClone(s);
    s.name = data.name; s.description = data.desc; s.startDate = data.start; s.endDate = data.end;
    s.actualStartDate = data.actStart; s.actualEndDate = data.actEnd;
    addAudit(project, "Update Sub Task", before, deepClone(s));
    setNodePopup(null);
    onUpdated(task, "Sub Task updated");
  };

  const removeSub = (sUid) => {
    const idx = safeArr(task.subtasks).findIndex(s => s.uid === sUid);
    if (idx < 0) return;
    const removed = task.subtasks.splice(idx, 1)[0];
    addAudit(project, "Delete Sub Task", deepClone(removed), "-");
    renumber(project);
    onUpdated(task, "Sub Task removed");
  };

  const allExp = safeArr(task.subtasks).length > 0 && safeArr(task.subtasks).every(s => expandedSubs.has(s.uid));
  const toggleSub = (sUid) => { const n = new Set(expandedSubs); n.has(sUid) ? n.delete(sUid) : n.add(sUid); setExpandedSubs(n); };
  const toggleAll = () => setExpandedSubs(allExp ? new Set() : new Set(safeArr(task.subtasks).map(s => s.uid)));

  const addComment = (c) => { task.comments = safeArr(task.comments); task.comments.unshift(c); onUpdated(task); };

  return (
    <div className="modal-overlay" style={{ alignItems: "flex-start", overflowY: "auto", zIndex: 1200 }}>
      <div className="modal-box wide" style={{ marginTop: 20 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, marginBottom: 14, flexWrap: "wrap" }}>
          <h3 style={{ margin: 0 }}>{task.name} · Task</h3>
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
            <Btn onClick={save}>Save</Btn>
            <Btn variant="cancel" onClick={onClose}>Close</Btn>
          </div>
        </div>
        <div className="grid">
          <Field label="Task ID"><input value={task.id} disabled /></Field>
          <Field label="Task Name" required><input value={form.name} onChange={e => u("name", e.target.value)} disabled={!editable} /></Field>
          <Field label="Description" full><textarea value={form.description} onChange={e => u("description", e.target.value)} disabled={!editable} /></Field>
          <Field label="Task Type" required>
            <select value={form.type} onChange={e => u("type", e.target.value)} disabled={!editable}>
              {TYPES.map(t => <option key={t}>{t}</option>)}
            </select>
          </Field>
          <Field label="Start Date" required><input type="date" value={form.startDate} onChange={e => u("startDate", e.target.value)} disabled={!editable} /></Field>
          <Field label="End Date" required><input type="date" value={form.endDate} onChange={e => u("endDate", e.target.value)} disabled={!editable} /></Field>
          <Field label="Actual Start Date"><input type="date" value={form.actualStartDate} onChange={e => u("actualStartDate", e.target.value)} disabled={!editable} /></Field>
          <Field label="Actual End Date"><input type="date" value={form.actualEndDate} onChange={e => u("actualEndDate", e.target.value)} disabled={!editable} /></Field>
        </div>
        <div className="detail-bottom-actions">
          <Btn onClick={() => setNodePopup({ type: "subtask", mode: "add", nodeUid: null, parentUid: task.uid })} disabled={!editable}>+ Add Sub Task</Btn>
        </div>
        <div style={{ marginTop: 14 }}>
          <div className="subtask-header-row">
            <h4>Sub Tasks</h4>
            <Btn variant="small" onClick={toggleAll} disabled={!safeArr(task.subtasks).length}>{allExp ? "Collapse All" : "Expand All"}</Btn>
          </div>
          <div className="task-card-list">
            {safeArr(task.subtasks).length === 0 ? <div className="hint">No sub tasks added yet</div> :
              safeArr(task.subtasks).map(s => (
                <SubtaskCard key={s.uid} projectId={projectId} taskUid={task.uid} subtask={s} editable={editable}
                  expanded={expandedSubs.has(s.uid)} onToggle={() => toggleSub(s.uid)}
                  onEdit={() => setNodePopup({ type: "subtask", mode: "edit", nodeUid: s.uid, parentUid: task.uid })}
                  onRemove={() => removeSub(s.uid)} />
              ))
            }
          </div>
        </div>
        <CommentsPanel comments={task.comments} onAdd={addComment} />
      </div>
      {nodePopup && <NodePopup ctx={nodePopup} project={project} onboardDraft={null} editingConfig={true} currentView="task"
        onClose={() => setNodePopup(null)}
        onSaved={nodePopup.mode === "add" ? addSubtask : editSubtask} />}
    </div>
  );
}