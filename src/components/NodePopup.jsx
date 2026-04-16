import { useState, useEffect, useRef, useCallback } from "react";
import Btn from "./Btn";
import Field from "./Field";
function findByUid(list, id) {
  for (const item of safeArr(list)) {
    if (item.uid === id) return item;
    const f = findByUid(item.activities || [], id) || findByUid(item.tasks || [], id) || findByUid(item.subtasks || [], id);
    if (f) return f;
  }
  return null;
}

const TYPES = ["Standard Type", "Resource Type", "Transactional Type"];
const safeArr = (v) => Array.isArray(v) ? v : [];
export default function NodePopup({ ctx, project, onboardDraft, editingConfig, currentView, onClose, onSaved }) {
  const { type, mode, nodeUid, parentUid } = ctx;
  const proj = (project?.projectId === "draft" || !project) ? onboardDraft : project;
  const node = nodeUid ? findByUid(proj?.milestones || [], nodeUid) : null;
  const [name, setName] = useState(node?.name || "");
  const [desc, setDesc] = useState(node?.description || "");
  const [start, setStart] = useState(node?.startDate || "");
  const [end, setEnd] = useState(node?.endDate || "");
  const [nType, setNType] = useState(node?.type || "Standard Type");
  const [actStart, setActStart] = useState(node?.actualStartDate || "");
  const [actEnd, setActEnd] = useState(node?.actualEndDate || "");
  const [res, setRes] = useState(node?.resourceDetails || { resourceName: "", onboardingDate: "", offboardingDate: "", actualOnboardingDate: "", actualOffboardingDate: "", position: "", designation: "", jobRole: "", qualification: "", experience: "" });
  const [err, setErr] = useState("");
  const readOnly = currentView === "config" && !editingConfig && project?.projectId !== "draft";
  const showType = type !== "milestone" && type !== "subtask";
  const showActual = type === "task" || type === "subtask";
  const showResource = type === "activity" && nType === "Resource Type";
  const title = `${mode === "edit" ? "View/Update" : "Add"} ${type.charAt(0).toUpperCase() + type.slice(1)}`;

  const save = () => {
    if (!name.trim() || !start || !end) { setErr("Fill required fields."); return; }
    onSaved({ name: name.trim(), desc: desc.trim(), start, end, nType, actStart, actEnd, res: showResource ? res : null });
  };

  return (
    <div className="modal-overlay" style={{ zIndex: 1700 }}>
      <div className="modal-box" style={{ maxHeight: "90vh", overflowY: "auto" }}>
        <h3>{title}</h3>
        <div className="hint" style={{ margin: "8px 0 14px" }}>{
          type === "milestone" ? "Milestones drive the project structure." :
            type === "activity" ? "Activity Type is required for every activity." :
              type === "task" ? "Task Type is required for every task." :
                "Sub tasks keep only the required details and actual dates."
        }</div>
        {err && <div style={{ color: "var(--red)", marginBottom: 8, fontSize: 13 }}>{err}</div>}
        <div className="grid single" style={{ gap: 14 }}>
          <Field label="Name" required><input value={name} onChange={e => setName(e.target.value)} disabled={readOnly} /></Field>
          <Field label="Description" full>
            <textarea value={desc} onChange={e => setDesc(e.target.value)} disabled={readOnly} maxLength={5000} />
            <div className="char-count">{5000 - desc.length} characters remaining</div>
          </Field>
          {showType && <Field label={type === "activity" ? "Activity Type" : "Task Type"} required>
            <select value={nType} onChange={e => setNType(e.target.value)} disabled={readOnly}>
              {TYPES.map(t => <option key={t}>{t}</option>)}
            </select>
          </Field>}
          <Field label="Start Date" required><input type="date" value={start} onChange={e => setStart(e.target.value)} disabled={readOnly} /></Field>
          <Field label="End Date" required><input type="date" value={end} onChange={e => setEnd(e.target.value)} disabled={readOnly} /></Field>
          {showActual && <>
            <Field label="Actual Start Date"><input type="date" value={actStart} onChange={e => setActStart(e.target.value)} disabled={readOnly} /></Field>
            <Field label="Actual End Date"><input type="date" value={actEnd} onChange={e => setActEnd(e.target.value)} disabled={readOnly} /></Field>
          </>}
        </div>
        {showResource && (
          <div className="activity-resource-grid" style={{ marginTop: 14 }}>
            {[["resourceName", "Resource Name", "text"], ["onboardingDate", "Onboarding Date", "date"], ["offboardingDate", "Offboarding Date", "date"], ["actualOnboardingDate", "Actual Onboarding Date", "date"], ["actualOffboardingDate", "Actual Offboarding Date", "date"], ["position", "Position", "text"], ["designation", "Designation", "text"], ["jobRole", "Job Role", "text"], ["qualification", "Qualification", "text"], ["experience", "Experience (Years)", "number"]].map(([k, lbl, t]) => (
              <Field key={k} label={lbl}>
                <input type={t} value={res[k] || ""} onChange={e => setRes({ ...res, [k]: e.target.value })} disabled={readOnly} />
              </Field>
            ))}
          </div>
        )}
        <div className="modal-actions">
          {!readOnly && <Btn onClick={save}>Save</Btn>}
          <Btn variant="cancel" onClick={onClose}>Close</Btn>
        </div>
      </div>
    </div>
  );
}