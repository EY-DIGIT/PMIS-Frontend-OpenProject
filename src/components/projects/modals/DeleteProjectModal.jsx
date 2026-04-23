import React, { useEffect, useMemo, useState } from "react";

const PHRASES = [
  "quiet blue river bends",
  "silver dawn warms hills",
  "steady hands build trust",
  "gentle winds move forward",
  "bright paths stay clear",
  "calm lights guide work"
];

export default function DeleteProjectModal({ open, project, onCancel, onConfirm }) {
  const phrase = useMemo(() => PHRASES[Math.floor(Math.random() * PHRASES.length)], [open]);
  const [typed, setTyped] = useState("");

  useEffect(() => {
    if (open) setTyped("");
  }, [open]);

  if (!open || !project) return null;

  return (
    <div className="uidai-modal">
      <div className="uidai-modal__box">
        <h3 className="uidai-modal__title">Delete Project</h3>
        <div className="uidai-delete-warning">This action cannot be undone</div>
        <div className="uidai-hint" style={{ marginTop: 8 }}>
          Type the phrase below to confirm deletion of {project.projectName}.
        </div>
        <div className="uidai-phrase-box">{phrase}</div>
        <div className="uidai-field">
          <label className="uidai-field__label">Type the phrase above</label>
          <input
            className="uidai-input"
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            onPaste={(e) => e.preventDefault()}
            autoComplete="off"
            spellCheck="false"
          />
        </div>
        <div className="uidai-modal__actions">
          <button
            type="button"
            className="uidai-btn uidai-btn--delete"
            disabled={typed !== phrase}
            onClick={onConfirm}
          >
            Delete Project
          </button>
          <button type="button" className="uidai-btn uidai-btn--cancel" onClick={onCancel}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
