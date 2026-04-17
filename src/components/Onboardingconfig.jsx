// ============================================================
// pages/OnboardingConfig.jsx  –  Route: /onboard/:category/config
//   Step 2 of 2: add milestones then save project
// ============================================================
import { useState } from "react";
import { useParams, useNavigate } from "react-router-dom";

import { useOnboard }                     from "../store/Onboardstore";
import { useProjects, deepClone, safeArr, uid, renumber, normalizeProject } from "../store/Projectstore";

import NodePopup    from "./NodePopup";
import MessageModal from "./MessageModal";
import Btn          from "./Btn";

function findByUid(list, id) {
  for (const item of safeArr(list)) {
    if (item.uid === id) return item;
    const f = findByUid(item.activities || [], id) || findByUid(item.tasks || [], id) || findByUid(item.subtasks || [], id);
    if (f) return f;
  }
  return null;
}

export default function OnboardingConfig() {
  const { category }  = useParams();
  const navigate       = useNavigate();
  const { draft, setDraft, clearDraft } = useOnboard();
  const { getNextId, addProject, withLoader, showMsg } = useProjects();

  const [expandedMilestones, setExpandedMilestones] = useState(
    () => new Set(safeArr(draft?.milestones).map((m) => m.uid))
  );
  const [nodePopup, setNodePopup] = useState(null);
  const [msg,       setMsg       ] = useState(null);

  // ── Guard: if someone lands here without a draft, send them back ──
  if (!draft) {
    return (
      <div className="card" style={{ padding: 24 }}>
        <p>No project draft found. Please start from the form.</p>
        <Btn onClick={() => navigate(`/onboard/${encodeURIComponent(category)}`)}>Back to Form</Btn>
      </div>
    );
  }

  // ── Helpers ───────────────────────────────────────────────
  const allExp = safeArr(draft.milestones).every((m) => expandedMilestones.has(m.uid));
  const toggleAll = () =>
    setExpandedMilestones(allExp ? new Set() : new Set(safeArr(draft.milestones).map((m) => m.uid)));
  const toggleM = (mUid) => {
    const n = new Set(expandedMilestones);
    n.has(mUid) ? n.delete(mUid) : n.add(mUid);
    setExpandedMilestones(n);
  };

  // ── Save to draft helper ──────────────────────────────────
  const applyDraft = (mutatedDraft) => {
    renumber(mutatedDraft);
    setDraft(deepClone(mutatedDraft));
  };

  // ── Node saved (add / edit milestone or activity) ─────────
  const handleNodeSaved = (data) => {
    const { type, mode, nodeUid, parentUid } = nodePopup;
    const d = deepClone(draft);

    if (type === "milestone") {
      if (mode === "add") {
        const m = {
          uid: uid("m"), name: data.name, description: data.desc,
          startDate: data.start, endDate: data.end,
          expanded: true, comments: [], activities: [],
        };
        d.milestones.push(m);
        setExpandedMilestones((prev) => new Set([...prev, m.uid]));
      } else {
        const m = findByUid(d.milestones, nodeUid);
        m.name = data.name; m.description = data.desc; m.startDate = data.start; m.endDate = data.end;
      }
    } else if (type === "activity") {
      const milestone = findByUid(d.milestones, parentUid);
      if (!milestone) return;
      if (mode === "add") {
        milestone.activities.push({
          uid: uid("a"), name: data.name, description: data.desc,
          startDate: data.start, endDate: data.end, type: data.nType,
          expanded: true, comments: [], tasks: [],
          actualStartDate: "", actualEndDate: "", resourceDetails: data.res,
        });
      } else {
        const a = findByUid(d.milestones, nodeUid);
        a.name = data.name; a.description = data.desc; a.startDate = data.start;
        a.endDate = data.end; a.type = data.nType; a.resourceDetails = data.res;
      }
    }

    applyDraft(d);
    setNodePopup(null);
  };

  // ── Delete ────────────────────────────────────────────────
  const deleteMilestone = (mUid) => {
    const d   = deepClone(draft);
    const idx = d.milestones.findIndex((m) => m.uid === mUid);
    if (idx < 0) return;
    d.milestones.splice(idx, 1);
    applyDraft(d);
  };

  const deleteActivity = (aUid, mUid) => {
    const d         = deepClone(draft);
    const milestone = findByUid(d.milestones, mUid);
    if (!milestone) return;
    const idx = milestone.activities.findIndex((a) => a.uid === aUid);
    if (idx < 0) return;
    milestone.activities.splice(idx, 1);
    applyDraft(d);
  };

  // ── Finalize: save project ────────────────────────────────
  const handleFinalize = () => {
    if (!safeArr(draft.milestones).length) {
      showMsg("Add at least one milestone before saving.");
      return;
    }
    withLoader(
      "Saving project…",
      () => {
        const p       = deepClone(draft);
        p.projectId   = getNextId();
        p.status      = "NEW";
        p.baselineId  = "-";
        p.auditLogs   = [];
        normalizeProject(p);
        addProject(p);
        clearDraft();
      },
      "Project onboarded successfully",
      () => navigate("/projects")
    );
  };

  // ── Render ────────────────────────────────────────────────
  return (
    <div>
      <div className="pm-title">Milestone Configuration</div>
      <div className="card">
        <h3>{draft.projectName || ""}</h3>
        <div className="hint">
          Add milestones first. Then open each milestone to add activities.
          Tasks are not used in Onboard New Project.
        </div>

        {/* Action bar */}
        <div className="card-actions" style={{ marginTop: 10 }}>
          <Btn onClick={toggleAll}>{allExp ? "Collapse All" : "Expand All"}</Btn>
          <Btn onClick={() => setNodePopup({ type: "milestone", mode: "add", nodeUid: null, parentUid: null })}>
            + Add Milestone
          </Btn>
          <Btn onClick={handleFinalize}>Save Project</Btn>
          <Btn variant="cancel" onClick={() => navigate(`/onboard/${encodeURIComponent(category)}`)}>
            Back
          </Btn>
        </div>

        {/* Tree */}
        <div className="tree-wrap" style={{ marginTop: 18 }}>
          {safeArr(draft.milestones).length === 0 ? (
            <div className="hint">No milestones added yet</div>
          ) : (
            safeArr(draft.milestones).map((milestone) => {
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
                                  onClick={() => setNodePopup({ type: "activity", mode: "edit", nodeUid: activity.uid, parentUid: milestone.uid })}
                                >
                                  View/Update
                                </Btn>
                                <Btn
                                  variant="delete small-btn"
                                  onClick={() => deleteActivity(activity.uid, milestone.uid)}
                                >
                                  Remove
                                </Btn>
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>
                      <Btn
                        style={{ marginTop: 12 }}
                        onClick={() => setNodePopup({ type: "activity", mode: "add", nodeUid: null, parentUid: milestone.uid })}
                      >
                        + Add Activity
                      </Btn>
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
          project={{ projectId: "draft" }}
          onboardDraft={draft}
          editingConfig={true}
          currentView="onboarding"
          onClose={() => setNodePopup(null)}
          onSaved={handleNodeSaved}
        />
      )}
      {msg && <MessageModal msg={msg.text} onOk={msg.onOk} />}
    </div>
  );
}