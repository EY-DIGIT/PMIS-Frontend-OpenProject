// ─── Sidebar ──────────────────────────────────────────────────
import { useState, useEffect, useRef, useCallback } from "react";
import Btn from "./Btn";
export default function Sidebar({ collapsed, onAddProject, onSearchProject }) {
  const [pmOpen, setPmOpen] = useState(false);
  const [dropOpen, setDropOpen] = useState(false);
  return (
    <div className={`pmis-sidebar${collapsed ? " collapsed" : ""}`}>
      <div className="pmis-menu">
        <a>📊 <span className="pmis-text">Dashboard</span></a>
        <a className="active" onClick={() => setPmOpen(!pmOpen)}>
          📁 <span className="pmis-text">Project Management</span>
          <span className="pmis-submenu-arrow">{pmOpen ? "▼" : "▶"}</span>
        </a>
        <div className={`pmis-submenu${pmOpen ? " open" : ""}`}>
          <div className="pmis-onboard-item" onMouseEnter={() => setDropOpen(true)} onMouseLeave={() => setDropOpen(false)} style={{ position: "relative" }}>
            ➕ Add Project
            <div className={`pmis-onboard-dropdown${dropOpen ? " open" : ""}`}>
              {["MSAP", "MSIP", "BSP"].map(t => <button key={t} onClick={() => onAddProject(t)}>{t}</button>)}
            </div>
          </div>
          <div onClick={onSearchProject}>🔍 Search Project</div>
        </div>
        <a>🗂️ <span className="pmis-text">Master Data</span></a>
        <a>🏢 <span className="pmis-text">Vendor Management</span></a>
        <a>👤 <span className="pmis-text">User Management</span></a>
      </div>
    </div>
  );
}
