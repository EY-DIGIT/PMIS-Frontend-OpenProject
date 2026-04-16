// ─── Message Modal ────────────────────────────────────────────
import { useState, useEffect, useRef, useCallback } from "react";
import Btn from "./Btn";
export default function MessageModal({ msg, onOk }) {
  const infoPattern = /(not found|fill required fields|type the phrase above|please wait|invalid|warning|cannot|no milestones|no tasks|no sub tasks|add at least one milestone)/i;
  const isSuccess = !infoPattern.test(msg || "");
  let display = (msg || "").trim().replace(/\.+$/g, "");
  if (isSuccess && !/successfully!?$/i.test(display)) display = display + "!";
  return (
    <div className="modal-overlay" style={{ zIndex: 1800 }}>
      <div className="modal-box" style={{ textAlign: "center", width: "min(420px,100%)" }}>
        {isSuccess && <div className="message-icon">✔</div>}
        <div className={isSuccess ? "message-text-success" : "message-text-info"}>{display}</div>
        <div className="modal-actions" style={{ justifyContent: "center" }}>
          <Btn onClick={onOk} style={{ minWidth: 120 }}>OK</Btn>
        </div>
      </div>
    </div>
  );
}