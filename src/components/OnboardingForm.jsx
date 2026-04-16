// ─── Onboarding Form ──────────────────────────────────────────
import { useState, useEffect, useRef, useCallback } from "react";
import Btn from "./Btn";
import Field from "./Field";
export default function OnboardingForm({ category, draft, onNext, onCancel }) {
  const [form, setForm] = useState({ projectName: draft?.projectName || "", description: draft?.description || "", owner: draft?.owner || "", startDate: draft?.startDate || "", endDate: draft?.endDate || "", isPublic: draft?.isPublic || "Yes" });
  const [err, setErr] = useState("");
  const u = (k, v) => setForm(f => ({ ...f, [k]: v }));
  const go = () => {
    if (!form.projectName || !form.owner || !form.startDate || !form.endDate) { setErr("Fill required fields."); return; }
    onNext({ ...form, category, baselineId: "-", status: "NEW", isVersion: false, versionOf: "", versionNo: 0, auditLogs: [], milestones: draft?.milestones || [] });
  };
  return (
    <div>
      <div className="pm-title">Project Management</div>
      <div className="card">
        <h3>{category} Project</h3>
        <br />
        {err && <div style={{ color: "var(--red)", marginBottom: 8, fontSize: 13 }}>{err}</div>}
        <div className="grid">
          <Field label="Project Name" required><input value={form.projectName} onChange={e => u("projectName", e.target.value)} /></Field>
          <Field label="Description" full>
            <textarea value={form.description} onChange={e => u("description", e.target.value)} maxLength={5000} />
            <div className="char-count">{5000 - form.description.length} characters remaining</div>
          </Field>
          <Field label="Status" required><input value="NEW" disabled /></Field>
          <Field label="Owner" required><input value={form.owner} onChange={e => u("owner", e.target.value)} /></Field>
          <Field label="Start Date" required><input type="date" value={form.startDate} onChange={e => u("startDate", e.target.value)} /></Field>
          <Field label="End Date" required><input type="date" value={form.endDate} onChange={e => u("endDate", e.target.value)} /></Field>
          <Field label="Is Public" required>
            <select value={form.isPublic} onChange={e => u("isPublic", e.target.value)}>
              <option>Yes</option><option>No</option>
            </select>
          </Field>
          <Field label="Category" required><input value={category} disabled /></Field>
        </div>
        <div style={{ marginTop: 15, display: "flex", gap: 10, flexWrap: "wrap" }}>
          <Btn onClick={go}>Save &amp; Next</Btn>
          <Btn variant="cancel" onClick={onCancel}>Cancel</Btn>
        </div>
      </div>
    </div>
  );
}