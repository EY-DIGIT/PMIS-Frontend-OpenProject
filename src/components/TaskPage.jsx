// ============================================================
// pages/TaskPage.jsx
// Route: /projects/:projectId/config/milestone/:milestoneUid/activity/:activityUid/task/:taskUid
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
import SubtaskCard   from "./SubtaskCard";
import CommentsPanel from "./CommentsPanel";
import MessageModal  from "./MessageModal";

const TYPES = ["Standard Type", "Resource Type", "Transactional Type"];

function findTaskOwner(project, taskUid) {
  for (const m of safeArr(project?.milestones)) {
    for (const a of safeArr(m.activities)) {
      const t = safeArr(a.tasks).find((x) => x.uid === taskUid);
      if (t) return { milestone: m, activity: a, task: t };
    }
  }
  return null;
}

export default function TaskPage() {
  const { projectId, milestoneUid, activityUid, taskUid } = useParams();
  const navigate = useNavigate();
  const { getById, mutate } = useProjects();

  const project = getById(projectId);
  const owner   = project ? findTaskOwner(project, taskUid) : null;
  const task    = owner?.task;

  // Hooks must run before conditional return
  const [msg,          setMsg]          = useState(null);
  const [nodePopup,    setNodePopup]    = useState(null);
  const [form,         setForm]         = useState({
    name:            task?.name            || "",
    description:     task?.description     || "",
    type:            task?.type            || "Standard Type",
    startDate:       task?.startDate       || "",
    endDate:         task?.endDate         || "",
    actualStartDate: task?.actualStartDate || "",
    actualEndDate:   task?.actualEndDate   || "",
  });
  const [expandedSubs, setExpandedSubs] = useState(
    () => new Set(safeArr(task?.subtasks).map((s) => s.uid))
  );

  // ── Guard ───────────────────────────────────────────────
  if (!project || !owner) {
    return (
      <div className="card" style={{ padding: 24 }}>
        <p>Task not found.</p>
        <Btn onClick={() => navigate(`/projects/${projectId}/config`)}>Back</Btn>
      </div>
    );
  }

  const editable = !(project.status === "PUBLISHED" && !project.isVersion);
  const u = (k, v) => setForm((f) => ({ ...f, [k]: v }));

  // ── Save task ───────────────────────────────────────────
  const save = () => {
    if (!form.name || !form.startDate || !form.endDate) {
      setMsg({ text: "Fill required fields.", onOk: () => setMsg(null) });
      return;
    }
    const p = deepClone(project);
    const o = findTaskOwner(p, taskUid);
    if (!o) return;

    const before = deepClone(o.task);
    o.task.name            = form.name;
    o.task.description     = form.description;
    o.task.type            = form.type;
    o.task.startDate       = form.startDate;
    o.task.endDate         = form.endDate;
    o.task.actualStartDate = form.actualStartDate;
    o.task.actualEndDate   = form.actualEndDate;

    addAudit(p, "Update Task", before, deepClone(o.task));
    mutate(p);
    setMsg({ text: "Task saved", onOk: () => setMsg(null) });
  };

  // ── Subtask add ─────────────────────────────────────────
  const addSubtask = (data) => {
    const p = deepClone(project);
    const o = findTaskOwner(p, taskUid);
    if (!o) return;

    const sub = {
      uid: uid("s"),
      name: data.name, description: data.desc,
      startDate: data.start, endDate: data.end,
      actualStartDate: data.actStart, actualEndDate: data.actEnd,
      expanded: false, comments: [],
    };
    o.task.subtasks = safeArr(o.task.subtasks);
    o.task.subtasks.push(sub);

    renumber(p);
    addAudit(p, "Add Sub Task", "-", deepClone(sub));
    mutate(p);
    setExpandedSubs((prev) => new Set([...prev, sub.uid]));
    setNodePopup(null);
    setMsg({ text: "New Sub-Task Added", onOk: () => setMsg(null) });
  };

  // ── Subtask edit ────────────────────────────────────────
  const editSubtask = (data) => {
    const p = deepClone(project);
    const o = findTaskOwner(p, taskUid);
    if (!o) return;
    const s = findByUid(o.task.subtasks || [], nodePopup.nodeUid);
    if (!s) return;

    const before = deepClone(s);
    s.name            = data.name;
    s.description     = data.desc;
    s.startDate       = data.start;
    s.endDate         = data.end;
    s.actualStartDate = data.actStart;
    s.actualEndDate   = data.actEnd;

    addAudit(p, "Update Sub Task", before, deepClone(s));
    mutate(p);
    setNodePopup(null);
    setMsg({ text: "Sub Task updated", onOk: () => setMsg(null) });
  };

  // ── Subtask remove ──────────────────────────────────────
  const removeSub = (sUid) => {
    const p = deepClone(project);
    const o = findTaskOwner(p, taskUid);
    if (!o) return;

    const idx = safeArr(o.task.subtasks).findIndex((s) => s.uid === sUid);
    if (idx < 0) return;

    const removed = o.task.subtasks.splice(idx, 1)[0];
    addAudit(p, "Delete Sub Task", deepClone(removed), "-");
    renumber(p);
    mutate(p);
    setMsg({ text: "Sub Task removed", onOk: () => setMsg(null) });
  };

  // ── Subtask expand/collapse ─────────────────────────────
  const toggleSub = (sUid) => {
    const n = new Set(expandedSubs);
    n.has(sUid) ? n.delete(sUid) : n.add(sUid);
    setExpandedSubs(n);
  };
  const allExp = safeArr(task.subtasks).length > 0 &&
    safeArr(task.subtasks).every((s) => expandedSubs.has(s.uid));
  const toggleAll = () =>
    setExpandedSubs(allExp ? new Set() : new Set(safeArr(task.subtasks).map((s) => s.uid)));

  // ── Comment ─────────────────────────────────────────────
  const addComment = (c) => {
    const p = deepClone(project);
    const o = findTaskOwner(p, taskUid);
    if (!o) return;
    o.task.comments = safeArr(o.task.comments);
    o.task.comments.unshift(c);
    mutate(p);
  };

  return (
    <div>
      <div className="pm-title">Task</div>
      <div className="card activity-page-shell">
        <div className="card-actions">
          <Btn onClick={save} disabled={!editable}>Save</Btn>
          <Btn
            onClick={() => setNodePopup({ type: "subtask", mode: "add", nodeUid: null, parentUid: task.uid })}
            disabled={!editable}
          >
            + Add Sub Task
          </Btn>
          <Btn
            variant="cancel"
            onClick={() =>
              navigate(`/projects/${projectId}/config/milestone/${milestoneUid}/activity/${activityUid}`)
            }
          >
            Back
          </Btn>
        </div>

        <h3 style={{ margin: 0 }}>{task.name} · Task</h3>

        <div className="grid">
          <Field label="Task ID"><input value={task.id} disabled /></Field>
          <Field label="Task Name" required>
            <input value={form.name} onChange={(e) => u("name", e.target.value)} disabled={!editable} />
          </Field>
          <Field label="Description" full>
            <textarea value={form.description} onChange={(e) => u("description", e.target.value)} disabled={!editable} />
          </Field>
          <Field label="Task Type" required>
            <select value={form.type} onChange={(e) => u("type", e.target.value)} disabled={!editable}>
              {TYPES.map((t) => <option key={t}>{t}</option>)}
            </select>
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

        <div style={{ marginTop: 14 }}>
          <div className="subtask-header-row">
            <h4>Sub Tasks</h4>
            <Btn variant="small" onClick={toggleAll} disabled={!safeArr(task.subtasks).length}>
              {allExp ? "Collapse All" : "Expand All"}
            </Btn>
          </div>
          <div className="task-card-list">
            {safeArr(task.subtasks).length === 0 ? (
              <div className="hint">No sub tasks added yet</div>
            ) : (
              safeArr(task.subtasks).map((s) => (
                <SubtaskCard
                  key={s.uid}
                  projectId={projectId}
                  taskUid={task.uid}
                  subtask={s}
                  editable={editable}
                  expanded={expandedSubs.has(s.uid)}
                  onToggle={() => toggleSub(s.uid)}
                  onEdit={() => setNodePopup({ type: "subtask", mode: "edit", nodeUid: s.uid, parentUid: task.uid })}
                  onRemove={() => removeSub(s.uid)}
                />
              ))
            )}
          </div>
        </div>

        <CommentsPanel comments={task.comments} onAdd={addComment} />
      </div>

      {nodePopup && (
        <NodePopup
          ctx={nodePopup}
          project={project}
          onboardDraft={null}
          editingConfig={true}
          currentView="task"
          onClose={() => setNodePopup(null)}
          onSaved={nodePopup.mode === "add" ? addSubtask : editSubtask}
        />
      )}
      {msg && <MessageModal msg={msg.text} onOk={msg.onOk} />}
    </div>
  );
}