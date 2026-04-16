// ─── Milestone Config ─────────────────────────────────────────
import { useState, useEffect, useRef, useCallback } from "react";
import ActivityPage from "./ActivityPage";
import NodePopup from "./NodePopup";
import Btn from "./Btn";
import Field from "./Field";
import MessageModal from "./MessageModal";

const deepClone = (o) => JSON.parse(JSON.stringify(o));
const uid = (p) => `${p}-${Math.random().toString(36).slice(2, 11)}-${Date.now().toString(36)}`;
const safeArr = (v) => Array.isArray(v) ? v : [];

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

export default function MilestoneConfig({ project, isOnboarding, onboardDraft, editingConfig, onBack, onFinalize, onToggleEdit, onSaveConfig, onProjectUpdated }) {
  const proj = isOnboarding ? onboardDraft : project;
  const [expandedMilestones, setExpandedMilestones] = useState(() => new Set(safeArr(proj?.milestones).map(m => m.uid)));
  const [nodePopup, setNodePopup] = useState(null);
  const [activityPage, setActivityPage] = useState(null);
  const [msg, setMsg] = useState(null);

  const editable = isOnboarding ? true : (editingConfig && !(proj?.status === "PUBLISHED" && !proj?.isVersion));
  const readOnly = proj?.status === "PUBLISHED" && !proj?.isVersion;

  const re = () => setExpandedMilestones(new Set(expandedMilestones)); // force re-render

  const allExp = safeArr(proj?.milestones).every(m => expandedMilestones.has(m.uid));
  const toggleAll = () => setExpandedMilestones(allExp ? new Set() : new Set(safeArr(proj?.milestones).map(m => m.uid)));
  const toggleM = (mUid) => { const n = new Set(expandedMilestones); n.has(mUid) ? n.delete(mUid) : n.add(mUid); setExpandedMilestones(n); };

  const handleNodeSaved = (data) => {
    const { type, mode, nodeUid, parentUid } = nodePopup;
    if (type === "milestone") {
      if (mode === "add") {
        const m = { uid: uid("m"), name: data.name, description: data.desc, startDate: data.start, endDate: data.end, expanded: true, comments: [], activities: [] };
        proj.milestones.push(m);
        setExpandedMilestones(new Set([...expandedMilestones, m.uid]));
        if (!isOnboarding) addAudit(proj, "Add Milestone", "-", deepClone(m));
      } else {
        const m = findByUid(proj.milestones, nodeUid);
        const before = deepClone(m);
        m.name = data.name; m.description = data.desc; m.startDate = data.start; m.endDate = data.end;
        if (!isOnboarding) addAudit(proj, "Update Milestone", before, deepClone(m));
      }
    } else if (type === "activity") {
      const milestone = findByUid(proj.milestones, parentUid);
      if (!milestone) return;
      if (mode === "add") {
        const a = { uid: uid("a"), name: data.name, description: data.desc, startDate: data.start, endDate: data.end, type: data.nType, expanded: true, comments: [], tasks: [], actualStartDate: "", actualEndDate: "", resourceDetails: data.res };
        milestone.activities.push(a);
        addAudit(proj, "Add Activity", "-", deepClone(a));
      } else {
        const a = findByUid(proj.milestones, nodeUid);
        const before = deepClone(a);
        a.name = data.name; a.description = data.desc; a.startDate = data.start; a.endDate = data.end; a.type = data.nType; a.resourceDetails = data.res;
        addAudit(proj, "Update Activity", before, deepClone(a));
      }
    }
    renumber(proj);
    setNodePopup(null);
    onProjectUpdated(proj, type === "milestone" && mode === "add" ? "Milestone added" : type === "milestone" ? "Milestone updated" : type === "activity" && mode === "add" ? "Activity added" : "Activity updated");
  };

  const deleteMilestone = (mUid) => {
    const idx = proj.milestones.findIndex(m => m.uid === mUid);
    if (idx < 0) return;
    const removed = proj.milestones.splice(idx, 1)[0];
    if (!isOnboarding) addAudit(proj, "Delete Milestone", deepClone(removed), "-");
    renumber(proj);
    onProjectUpdated(proj);
  };

  const deleteActivity = (aUid, mUid) => {
    const milestone = findByUid(proj.milestones, mUid);
    if (!milestone) return;
    const idx = milestone.activities.findIndex(a => a.uid === aUid);
    if (idx < 0) return;
    const removed = milestone.activities.splice(idx, 1)[0];
    if (!isOnboarding) addAudit(proj, "Delete Activity", deepClone(removed), "-");
    renumber(proj);
    onProjectUpdated(proj);
  };

  const onActivityUpdated = (activity, message) => {
    if (message) setMsg({ text: message, onOk: () => setMsg(null) });
    renumber(proj);
    onProjectUpdated(proj);
  };

  if (activityPage) {
    return (
      <>
        <ActivityPage {...activityPage} project={proj} onBack={() => setActivityPage(null)} onUpdated={onActivityUpdated} />
        {msg && <MessageModal msg={msg.text} onOk={msg.onOk} />}
      </>
    );
  }

  return (
    <div>
      <div className="pm-title">Milestone Configuration</div>
      <div className="card">
        <h3>{proj?.projectName || ""}</h3>
        <div className="hint">{isOnboarding ? "Add milestones first. Then open each milestone to add activities. Tasks are not used in Onboard New Project" : "Disclaimer: Every add, edit, delete, and version change is audited separately."}</div>
        <div className="card-actions" style={{ marginTop: 10 }}>
          <Btn onClick={toggleAll}>{allExp ? "Collapse All" : "Expand All"}</Btn>
          {!readOnly && !isOnboarding && <Btn onClick={onToggleEdit}>{editingConfig ? "Save" : "Edit"}</Btn>}
          {!readOnly && isOnboarding && <><Btn onClick={() => setNodePopup({ type: "milestone", mode: "add", nodeUid: null, parentUid: null })}>+ Add Milestone</Btn><Btn onClick={onFinalize}>Save Project</Btn></>}
          {!readOnly && !isOnboarding && editingConfig && <Btn onClick={() => setNodePopup({ type: "milestone", mode: "add", nodeUid: null, parentUid: null })}>+ Add Milestone</Btn>}
          <Btn variant="cancel" onClick={onBack}>Back</Btn>
        </div>
        <div className="tree-wrap" style={{ marginTop: 18 }}>
          {safeArr(proj?.milestones).length === 0 ? <div className="hint">No milestones added yet</div> :
            safeArr(proj?.milestones).map((milestone, mi) => {
              const acts = safeArr(milestone.activities);
              const taskCount = acts.reduce((s, a) => s + safeArr(a.tasks).length, 0);
              const subCount = acts.reduce((s, a) => s + safeArr(a.tasks).reduce((ss, t) => ss + safeArr(t.subtasks).length, 0), 0);
              const isExp = expandedMilestones.has(milestone.uid);
              return (
                <div className="node-card" key={milestone.uid}>
                  <div className="node-head">
                    <div className="node-summary" onClick={() => toggleM(milestone.uid)}>
                      <div className="node-summary-left">
                        <div className="node-title">{milestone.name}</div>
                        <div className="node-subtitle">{acts.length} activities{taskCount ? `, ${taskCount} tasks` + ((subCount ? `, ${subCount} sub tasks` : "")) : (subCount ? `, ${subCount} sub tasks` : "")}</div>
                      </div>
                      <div className="node-arrow">{isExp ? "▼" : "▶"}</div>
                    </div>
                    <div className="node-actions">
                      <Btn variant="small" onClick={() => setNodePopup({ type: "milestone", mode: "edit", nodeUid: milestone.uid, parentUid: null })}>View/Update</Btn>
                      <Btn variant="delete small-btn" onClick={() => deleteMilestone(milestone.uid)} disabled={readOnly || !editable}>Remove</Btn>
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
                                  <div className="node-subtitle">{safeArr(activity.tasks).length} tasks{safeArr(activity.tasks).reduce((s, t) => s + safeArr(t.subtasks).length, 0) ? `, ${safeArr(activity.tasks).reduce((s, t) => s + safeArr(t.subtasks).length, 0)} sub tasks` : ""}</div>
                                </div>
                              </div>
                              <div className="node-actions">
                                <Btn variant="small" onClick={() => setActivityPage({ projectId: proj.projectId, milestoneUid: milestone.uid, activityUid: activity.uid })}>View/Update</Btn>
                                <Btn variant="delete small-btn" onClick={() => deleteActivity(activity.uid, milestone.uid)} disabled={readOnly || !editable}>Remove</Btn>
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>
                      {editable && <Btn style={{ marginTop: 12 }} onClick={() => setNodePopup({ type: "activity", mode: "add", nodeUid: null, parentUid: milestone.uid })}>+ Add Activity</Btn>}
                    </div>
                  )}
                </div>
              );
            })
          }
        </div>
      </div>
      {nodePopup && <NodePopup ctx={nodePopup} project={isOnboarding ? { projectId: "draft" } : proj} onboardDraft={isOnboarding ? proj : null} editingConfig={editable} currentView={isOnboarding ? "onboarding" : "config"}
        onClose={() => setNodePopup(null)} onSaved={handleNodeSaved} />}
      {msg && <MessageModal msg={msg.text} onOk={msg.onOk} />}
    </div>
  );
}