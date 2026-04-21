import React, { useState, useEffect, useMemo } from 'react';
import { DELETE_PHRASES } from './utils';

export default function DeleteProjectModal({ open, onClose, onConfirm }) {
  const phrase = useMemo(
    () => DELETE_PHRASES[Math.floor(Math.random() * DELETE_PHRASES.length)],
    /* eslint-disable-next-line react-hooks/exhaustive-deps */
    [open]
  );
  const [value, setValue] = useState('');

  useEffect(() => { if (open) setValue(''); }, [open]);

  if (!open) return null;

  return (
    <div className="pmis-modal pmis-modal-open" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="pmis-modal-box">
        <h3>Delete Project</h3>
        <div className="pmis-delete-warning">This action cannot be undone</div>
        <div className="pmis-phrase-box">{phrase}</div>
        <div className="pmis-field">
          <label>Type the phrase above</label>
          <input
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onPaste={(e) => e.preventDefault()}
            autoComplete="off"
            spellCheck="false"
            autoFocus
          />
        </div>
        <div className="pmis-modal-actions">
          <button className="pmis-btn pmis-btn-delete" onClick={onConfirm} disabled={value !== phrase}>
            Delete Project
          </button>
          <button className="pmis-btn pmis-btn-cancel" onClick={onClose}>Cancel</button>
        </div>
      </div>
    </div>
  );
}
