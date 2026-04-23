import React from "react";

export default function PublishModal({ open, project, onCancel, onConfirm }) {
  if (!open || !project) return null;

  return (
    <div className="uidai-modal">
      <div className="uidai-modal__box">
        <h3 className="uidai-modal__title">Publish Project</h3>
        <div className="uidai-hint" style={{ marginTop: 10 }}>
          You are about to publish the baseline version of {project.projectName}. After publishing
          you can still edit the baseline, and any changes you make will automatically propagate to
          every version created from this baseline.
        </div>
        <div className="uidai-modal__actions">
          <button type="button" className="uidai-btn" onClick={onConfirm}>
            Publish
          </button>
          <button type="button" className="uidai-btn uidai-btn--cancel" onClick={onCancel}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
