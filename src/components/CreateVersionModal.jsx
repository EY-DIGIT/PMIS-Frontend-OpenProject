// ─── Create Version Modal ─────────────────────────────────────
import { useState, useEffect, useRef, useCallback } from "react";
import Btn from "./Btn";
export default function CreateVersionModal({ project, onConfirm, onClose }) {
  return (
    <div className="modal-overlay">
      <div className="modal-box">
        <h3>Create Version</h3>
        <div className="hint" style={{ marginTop: 10 }}>Create a new version of <strong>{project.projectName}</strong>? The new version will open directly in the project details page.</div>
        <div className="modal-actions">
          <Btn onClick={onConfirm}>OK</Btn>
          <Btn variant="cancel" onClick={onClose}>Cancel</Btn>
        </div>
      </div>
    </div>
  );
}