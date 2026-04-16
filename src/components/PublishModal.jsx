import { useState, useEffect, useRef, useCallback } from "react";
import Btn from "./Btn";
export default function PublishModal({ project, onConfirm, onClose }) {
  return (
    <div className="modal-overlay">
      <div className="modal-box">
        <h3>Publish Project</h3>
        <div className="hint" style={{ marginTop: 10 }}>You are going to publish the baseline version of <strong>{project.projectName}</strong>. It cannot be edited after publish.</div>
        <div className="modal-actions">
          <Btn onClick={onConfirm}>Publish</Btn>
          <Btn variant="cancel" onClick={onClose}>Cancel</Btn>
        </div>
      </div>
    </div>
  );
}