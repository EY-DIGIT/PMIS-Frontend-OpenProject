import React from "react";
import { useUiState } from "../../../store/project/uiStore";

export default function LoaderModal() {
  const state = useUiState();
  if (!state.loaderOpen) return null;

  return (
    <div className="uidai-modal uidai-loader-modal" style={{ zIndex: 2100 }}>
      <div className="uidai-modal__box" style={{ textAlign: "center" }}>
        <div className="uidai-loader-spinner" />
        <h3 style={{ margin: 0 }}>{state.loaderText}</h3>
        <div className="uidai-hint" style={{ marginTop: 8 }}>
          Please wait…
        </div>
      </div>
    </div>
  );
}
