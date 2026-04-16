// ─── Project Details ──────────────────────────────────────────
import { useState, useEffect, useRef, useCallback } from "react";
import Field from "./Field";
import Btn from "./Btn";
export default function ProjectDetails({ project, editing, onEdit, onSave, onBack, onPublish, onDelete, onConfig, onCreateVersion }) {
  const isPublishedBaseline = project.status === "PUBLISHED" && !project.isVersion;
  const isVersion = project.isVersion;
  const editable = editing;
  const [form, setForm] = useState({ projectName: project.projectName, description: project.description || "", owner: project.owner, startDate: project.startDate, endDate: project.endDate, isPublic: project.isPublic, actualEndDate: project.actualEndDate || "" });
  useEffect(() => setForm({ projectName: project.projectName, description: project.description || "", owner: project.owner, startDate: project.startDate, endDate: project.endDate, isPublic: project.isPublic, actualEndDate: project.actualEndDate || "" }), [project, editing]);
  const u = (k, v) => setForm(f => ({ ...f, [k]: v }));

  const handleSave = () => {
    if (!form.owner || ((!isVersion) && (!form.projectName || !form.startDate || !form.endDate))) { onSave(null, "Fill required fields."); return; }
    onSave(form);
  };

  return (
    <div>
      <div className="pm-title">Project Details</div>
      <div className="card">
        <div className="detail-top-actions">
          {isPublishedBaseline ? (
            <><Btn onClick={onCreateVersion}>Create Version</Btn><Btn variant="cancel" onClick={onBack}>Back</Btn></>
          ) : (
            <><Btn onClick={editing ? handleSave : onEdit}>{editing ? "Save" : "Edit"}</Btn>
              {!isVersion && project.status !== "PUBLISHED" && <Btn onClick={onPublish} disabled={editing}>Publish</Btn>}
              <Btn variant="cancel" onClick={onBack}>Back</Btn></>
          )}
        </div>
        <h3>Project Information</h3>
        <div className="hint" style={{ marginBottom: 12 }}>Published baseline projects are read-only. Version projects can edit only Owner, Is Public, and Actual End Date.</div>
        <div className="grid">
          <Field label="Project ID" required><input value={project.projectId} disabled /></Field>
          <Field label="Project Name" required><input value={form.projectName} onChange={e => u("projectName", e.target.value)} disabled={isVersion || !editable} /></Field>
          <Field label="Baseline ID"><input value={project.baselineId || "-"} disabled /></Field>
          <Field label="Status" required><input value={project.status} disabled /></Field>
          <Field label="Description" full>
            <textarea value={form.description} onChange={e => u("description", e.target.value)} maxLength={5000} disabled={isVersion || !editable} />
            <div className="char-count">{5000 - form.description.length} characters remaining</div>
          </Field>
          <Field label="Owner" required><input value={form.owner} onChange={e => u("owner", e.target.value)} disabled={!editable} /></Field>
          <Field label="Start Date" required><input type="date" value={form.startDate} onChange={e => u("startDate", e.target.value)} disabled={isVersion || !editable} /></Field>
          <Field label="End Date" required><input type="date" value={form.endDate} onChange={e => u("endDate", e.target.value)} disabled={isVersion || !editable} /></Field>
          {isVersion && <Field label="Actual End Date"><input type="date" value={form.actualEndDate} onChange={e => u("actualEndDate", e.target.value)} disabled={!editable} /></Field>}
          <Field label="Is Public" required>
            <select value={form.isPublic} onChange={e => u("isPublic", e.target.value)} disabled={!editable}>
              <option>Yes</option><option>No</option>
            </select>
          </Field>
          <Field label="Category" required><input value={project.category} disabled /></Field>
        </div>
        <div className="detail-bottom-actions">
          <Btn variant="delete" onClick={onDelete} disabled={editing}>Remove Project</Btn>
          <Btn onClick={onConfig} disabled={editing}>Go to Milestones Configuration</Btn>
        </div>
      </div>
    </div>
  );
}