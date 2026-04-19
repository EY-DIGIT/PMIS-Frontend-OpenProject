// ============================================================
// pages/MilestoneConfig.jsx  –  Route: /projects/:projectId/config
// ============================================================
import { useState } from "react";
import { useParams, useNavigate } from "react-router-dom";

import {
  useProjects, deepClone, safeArr, uid,
  renumber, addAudit, findByUid,
} from "../store/Projectstore";

import NodePopup     from "./NodePopup";
import MessageModal  from "./MessageModal";
import Btn           from "./Btn";

export default function MilestoneConfig() {
  const { projectId } = useParams();
  const navigate      = useNavigate();
  const { getById, mutate, withLoader } = useProjects();

  const project = getById(projectId);

  // ── Local UI state ────────────────────────────────────────
  const [editingConfig, setEditingConfig] = useState(false);
  const [expandedMilestones, setExpandedMilestones] = useState(
    () => new Set(safeArr(project?.milestones).map((m) => m.uid))
  );
  const [nodePopup, setNodePopup] = useState(null);
  const [msg,       setMsg]       = useState(null);

  // ── Guard ─────────────────────────────────────────────────
  if (!project) {
    return (
      <div className="card" style={{ padding: 24 }}>
        <p>Project <strong>{projectId}</strong> not found.</p>
        <Btn onClick={() => navigate("/projects")}>Back to list</Btn>
      </div>
    );
  }

  const readOnly = project.status === "PUBLISHED" && !project.isVersion;
  const editable = editingConfig && !readOnly;

  // ── Expand / collapse helpers ─────────────────────────────
  const allExp = safeArr(project.milestones).every((m) => expandedMilestones.has(m.uid));
  const toggleAll = () =>
    setExpandedMilestones(allExp ? new Set() : new Set(safeArr(project.milestones).map((m) => m.uid)));
  const toggleM = (mUid) => {
    const n = new Set(expandedMilestones);
    n.has(mUid) ? n.delete(mUid) : n.add(mUid);
    setExpandedMilestones(n);
  };

  // ── Save / Edit toggle ────────────────────────────────────
  const handleToggleEdit = () => {
    if (!editingConfig) { setEditingConfig(true); return; }
    withLoader("Saving milestone configuration…", () => {
      const p = deepClone(project);
      renumber(p);
      addAudit(p, "Save Milestone Configuration", "-", deepClone(p.milestones));
      mutate(p);
      setEditingConfig(false);
    }, "Milestone configuration saved");
  };

  // ── Node save (milestone / activity add-edit) ─────────────
  const handleNodeSaved = (data) => {
    const { type, mode, nodeUid, parentUid } = nodePopup;
    const p = deepClone(project);

    if (type === "milestone") {
      if (mode === "add") {
        const m = {
          uid: uid("m"), name: data.name, description: data.desc,
          startDate: data.start, endDate: data.end,
          expanded: true, comments: [], activities: [],
        };
        p.milestones.push(m);
        setExpandedMilestones((prev) => new Set([...prev, m.uid]));
        addAudit(p, "Add Milestone", "-", deepClone(m));
      } else {
        const m   = findByUid(p.milestones, nodeUid);
        const bef = deepClone(m);
        m.name = data.name; m.description = data.desc;
        m.startDate = data.start; m.endDate = data.end;
        addAudit(p, "Update Milestone", bef, deepClone(m));
      }
    } else if (type === "activity") {
      const milestone = findByUid(p.milestones, parentUid);
      if (!milestone) return;
      if (mode === "add") {
        const a = {
          uid: uid("a"), name: data.name, description: data.desc,
          startDate: data.start, endDate: data.end, type: data.nType,
          expanded: true, comments: [], tasks: [],
          actualStartDate: "", actualEndDate: "", resourceDetails: data.res,
        };
        milestone.activities.push(a);
        addAudit(p, "Add Activity", "-", deepClone(a));
      } else {
        const a   = findByUid(p.milestones, nodeUid);
        const bef = deepClone(a);
        a.name = data.name; a.description = data.desc;
        a.startDate = data.start; a.endDate = data.end;
        a.type = data.nType; a.resourceDetails = data.res;
        addAudit(p, "Update Activity", bef, deepClone(a));
      }
    }

    renumber(p);
    mutate(p);
    setNodePopup(null);

    const successMsg =
      type === "milestone" && mode === "add" ? "Milestone added" :
      type === "milestone"                   ? "Milestone updated" :
      mode === "add"                         ? "Activity added"    : "Activity updated";
    setMsg({ text: successMsg, onOk: () => setMsg(null) });
  };

  // ── Delete helpers ────────────────────────────────────────
  const deleteMilestone = (mUid) => {
    const p   = deepClone(project);
    const idx = p.milestones.findIndex((m) => m.uid === mUid);
    if (idx < 0) return;
    const removed = p.milestones.splice(idx, 1)[0];
    addAudit(p, "Delete Milestone", deepClone(removed), "-");
    renumber(p);
    mutate(p);
  };

  const deleteActivity = (aUid, mUid) => {
    const p         = deepClone(project);
    const milestone = findByUid(p.milestones, mUid);
    if (!milestone) return;
    const idx = milestone.activities.findIndex((a) => a.uid === aUid);
    if (idx < 0) return;
    const removed = milestone.activities.splice(idx, 1)[0];
    addAudit(p, "Delete Activity", deepClone(removed), "-");
    renumber(p);
    mutate(p);
  };

  // ── Main render ───────────────────────────────────────────
  return (
    <div>
      <div className="pm-title">Milestone Configuration</div>
      <div className="card">
        <h3>{project.projectName}</h3>
        <div className="hint">
          Disclaimer: Every add, edit, delete, and version change is audited separately.
        </div>

        {/* Action bar */}
        <div className="card-actions" style={{ marginTop: 10 }}>
          <Btn onClick={toggleAll}>{allExp ? "Collapse All" : "Expand All"}</Btn>
          {!readOnly && (
            <Btn onClick={handleToggleEdit}>{editingConfig ? "Save" : "Edit"}</Btn>
          )}
          {!readOnly && editable && (
            <Btn onClick={() => setNodePopup({ type: "milestone", mode: "add", nodeUid: null, parentUid: null })}>
              + Add Milestone
            </Btn>
          )}
          <Btn variant="cancel" onClick={() => navigate(`/projects/${projectId}`)}>Back</Btn>
        </div>

        {/* Tree */}
        <div className="tree-wrap" style={{ marginTop: 18 }}>
          {safeArr(project.milestones).length === 0 ? (
            <div className="hint">No milestones added yet</div>
          ) : (
            safeArr(project.milestones).map((milestone) => {
              const acts      = safeArr(milestone.activities);
              const taskCount = acts.reduce((s, a) => s + safeArr(a.tasks).length, 0);
              const subCount  = acts.reduce((s, a) =>
                s + safeArr(a.tasks).reduce((ss, t) => ss + safeArr(t.subtasks).length, 0), 0
              );
              const isExp = expandedMilestones.has(milestone.uid);

              return (
                <div className="node-card" key={milestone.uid}>
                  <div className="node-head">
                    <div className="node-summary" onClick={() => toggleM(milestone.uid)}>
                      <div className="node-summary-left">
                        <div className="node-title">{milestone.name}</div>
                        <div className="node-subtitle">
                          {acts.length} activities
                          {taskCount ? `, ${taskCount} tasks` : ""}
                          {subCount  ? `, ${subCount} sub tasks` : ""}
                        </div>
                      </div>
                      <div className="node-arrow">{isExp ? "▼" : "▶"}</div>
                    </div>
                    <div className="node-actions">
                      <Btn
                        variant="small"
                        onClick={() => setNodePopup({ type: "milestone", mode: "edit", nodeUid: milestone.uid, parentUid: null })}
                      >
                        View/Update
                      </Btn>
                      <Btn
                        variant="delete small-btn"
                        onClick={() => deleteMilestone(milestone.uid)}
                        disabled={readOnly || !editable}
                      >
                        Remove
                      </Btn>
                    </div>
                  </div>

                  {isExp && (
                    <div className="node-body">
                      <div className="child-area">
                        {acts.map((activity) => (
                          <div className="node-card compact-activity-card" key={activity.uid}>
                            <div className="node-head">
                              <div className="node-summary" style={{ cursor: "default" }}>
                                <div className="node-summary-left">
                                  <div className="node-title">{activity.name}</div>
                                  <div className="node-subtitle">
                                    {safeArr(activity.tasks).length} tasks
                                    {safeArr(activity.tasks).reduce((s, t) => s + safeArr(t.subtasks).length, 0)
                                      ? `, ${safeArr(activity.tasks).reduce((s, t) => s + safeArr(t.subtasks).length, 0)} sub tasks`
                                      : ""}
                                  </div>
                                </div>
                              </div>
                              <div className="node-actions">
                                <Btn
                                  variant="small"
                                  onClick={() =>
                                    navigate(
                                      `/projects/${project.projectId}/config/milestone/${milestone.uid}/activity/${activity.uid}`
                                    )
                                  }
                                >
                                  View/Update
                                </Btn>
                                <Btn
                                  variant="delete small-btn"
                                  onClick={() => deleteActivity(activity.uid, milestone.uid)}
                                  disabled={readOnly || !editable}
                                >
                                  Remove
                                </Btn>
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>
                      {editable && (
                        <Btn
                          style={{ marginTop: 12 }}
                          onClick={() => setNodePopup({ type: "activity", mode: "add", nodeUid: null, parentUid: milestone.uid })}
                        >
                          + Add Activity
                        </Btn>
                      )}
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>
      </div>

      {nodePopup && (
        <NodePopup
          ctx={nodePopup}
          project={project}
          onboardDraft={null}
          editingConfig={editable}
          currentView="config"
          onClose={() => setNodePopup(null)}
          onSaved={handleNodeSaved}
        />
      )}
      {msg && <MessageModal msg={msg.text} onOk={msg.onOk} />}
    </div>
  );
}