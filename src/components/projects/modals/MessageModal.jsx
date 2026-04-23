import React from "react";
import { useUiState, uiStore } from "../../../store/project/uiStore";

export default function MessageModal() {
  const state = useUiState();
  if (!state.messageOpen) return null;

  return (
    <div className="uidai-modal uidai-alert-modal" style={{ zIndex: 1800 }}>
      <div className="uidai-modal__box">
        <div
          className={`uidai-message-icon${state.messageIsError ? " uidai-message-icon--error" : ""}`}
        >
          {state.messageIsError ? "!" : "✔"}
        </div>
        <div className="uidai-message-text">{state.messageText}</div>
        <div className="uidai-modal__actions">
          <button
            type="button"
            className="uidai-btn"
            style={{ minWidth: 120 }}
            onClick={() => uiStore.closeMessage()}
          >
            OK
          </button>
        </div>
      </div>
    </div>
  );
}
