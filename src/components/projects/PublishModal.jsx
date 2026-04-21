import React from 'react';

export default function PublishModal({ open, onClose, onConfirm, project }) {
  if (!open || !project) return null;
  return (
    <div className="pmis-modal pmis-modal-open" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="pmis-modal-box">
        <h3>Publish Project</h3>
        <div className="pmis-hint pmis-modal-body-hint">
          You are going to publish the baseline version of {project.projectName}. After publish, it cannot be edited.
        </div>
        <div className="pmis-modal-actions">
          <button className="pmis-btn" onClick={onConfirm}>Publish</button>
          <button className="pmis-btn pmis-btn-cancel" onClick={onClose}>Cancel</button>
        </div>
      </div>
    </div>
  );
}
