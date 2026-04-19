// ─── Subtask Card ─────────────────────────────────────────────
import Btn from "./Btn";
import Field from "./Field";

const fmtDate = (d) => {
  if (!d || d === "-") return "-";
  const p = String(d).split("-");
  return p.length === 3 ? `${p[2]}-${p[1]}-${p[0]}` : d;
};

export default function SubtaskCard({
  projectId, taskUid, subtask, editable,
  expanded, onToggle, onEdit, onRemove,
}) {
  return (
    <div className="node-card" id={`subtask-card-${subtask.uid}`}>
      <div className="node-head">
        <div className="node-summary" onClick={onToggle}>
          <div className="node-summary-left">
            <div className="node-title">{subtask.name}</div>
            <div className="node-subtitle">
              {fmtDate(subtask.startDate)} to {fmtDate(subtask.endDate)}
            </div>
          </div>
          <div className="node-arrow">{expanded ? "▼" : "▶"}</div>
        </div>
        <div className="node-actions">
          <Btn variant="small" onClick={onEdit} disabled={!editable}>View/Update</Btn>
          <Btn variant="delete small-btn" onClick={onRemove} disabled={!editable}>Remove</Btn>
        </div>
      </div>
      {expanded && (
        <div className="node-body">
          <div className="grid">
            <Field label="Sub Task Name" required><input value={subtask.name} disabled /></Field>
            <Field label="Sub Task ID"><input value={subtask.id} disabled /></Field>
            <Field label="Description" full>
              <textarea value={subtask.description || ""} disabled readOnly />
            </Field>
            <Field label="Start Date" required><input type="date" value={subtask.startDate || ""} disabled /></Field>
            <Field label="End Date" required><input type="date" value={subtask.endDate || ""} disabled /></Field>
            <Field label="Actual Start Date"><input type="date" value={subtask.actualStartDate || ""} disabled /></Field>
            <Field label="Actual End Date"><input type="date" value={subtask.actualEndDate || ""} disabled /></Field>
          </div>
        </div>
      )}
    </div>
  );
}