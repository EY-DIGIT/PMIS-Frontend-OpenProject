// ─── Loader Modal ─────────────────────────────────────────────
import { useState, useEffect, useRef, useCallback } from "react";
import Btn from "./Btn";
export default function LoaderModal({ text }) {
  return (
    <div className="modal-overlay" style={{ zIndex: 1750 }}>
      <div className="modal-box" style={{ textAlign: "center", width: "min(420px,100%)" }}>
        <div className="loader-spinner" />
        <h3 style={{ margin: 0 }}>{text || "Loading"}</h3>
        <div className="hint" style={{ marginTop: 10 }}>Please wait…</div>
      </div>
    </div>
  );
}
