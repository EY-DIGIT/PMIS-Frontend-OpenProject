import React from "react";

export default function CreateVersionModal({ open, project, newId, onCancel, onConfirm }) {
  if (!open || !project) return null;

  return (
    <div className="uidai-modal">
      <div className="uidai-modal__box">
        <h3 className="uidai-modal__title">Create Version</h3>
        <div className="uidai-hint" style={{ marginTop: 10 }}>
          A new editable version ({newId}) will be created from {project.projectId}. Do you want to
          continue?
        </div>
        <div className="uidai-modal__actions">
          <button type="button" className="uidai-btn" onClick={onConfirm}>
            OK
          </button>
          <button type="button" className="uidai-btn uidai-btn--cancel" onClick={onCancel}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
