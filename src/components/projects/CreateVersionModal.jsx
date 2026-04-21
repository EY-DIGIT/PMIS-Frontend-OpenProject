import React from 'react';

export default function CreateVersionModal({ open, onClose, onConfirm, project, nextId }) {
  if (!open || !project) return null;
  return (
    <div className="pmis-modal pmis-modal-open" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="pmis-modal-box">
        <h3>Create Version</h3>
        <div className="pmis-hint pmis-modal-body-hint">
          A new editable version ({nextId}) will be created from {project.projectId}. Do you want to continue?
        </div>
        <div className="pmis-modal-actions">
          <button className="pmis-btn" onClick={onConfirm}>OK</button>
          <button className="pmis-btn pmis-btn-cancel" onClick={onClose}>Cancel</button>
        </div>
      </div>
    </div>
  );
}
