import React from 'react';
import { useStore, hideMessage } from './store';

export default function MessageModal() {
  const { message } = useStore();
  if (!message) return null;
  return (
    <div className="pmis-modal pmis-alert-modal pmis-modal-open">
      <div className="pmis-modal-box pmis-modal-box-compact">
        <div className={`pmis-message-icon ${message.isError ? 'pmis-message-icon-error' : ''}`}>
          {message.isError ? '!' : '✔'}
        </div>
        <div className="pmis-message-text">{message.text}</div>
        <div className="pmis-modal-actions pmis-modal-actions-center">
          <button className="pmis-btn pmis-btn-message-ok" onClick={hideMessage}>OK</button>
        </div>
      </div>
    </div>
  );
}
