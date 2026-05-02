import React from "react";
import { useUiState, uiStore } from "../../../store/project/uiStore";

export default function MessageModal() {
  const state = useUiState();
  if (!state.messageOpen) return null;

  return (
    <div className="uidai-modal uidai-alert-modal" style={{ zIndex: 1800 }}>
      <div className="uidai-modal__box" style={{ position: "relative" }}>
        <button
          type="button"
          aria-label="Close"
          onClick={() => uiStore.closeMessage()}
          style={{
            position: "absolute",
            top: 8,
            right: 10,
            width: 28,
            height: 28,
            border: "none",
            background: "transparent",
            fontSize: 22,
            lineHeight: 1,
            cursor: "pointer",
            color: "#666",
            padding: 0
          }}
        >
          ×
        </button>
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
