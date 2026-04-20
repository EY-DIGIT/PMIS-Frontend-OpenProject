// // ─── Sidebar ──────────────────────────────────────────────────
// import { useState, useEffect, useRef, useCallback } from "react";
// import Btn from "./Btn";
// export default function Sidebar({ collapsed, onAddProject, onSearchProject }) {
//   const [pmOpen, setPmOpen] = useState(false);
//   const [dropOpen, setDropOpen] = useState(false);
//   return (
//     <div className={`pmis-sidebar${collapsed ? " collapsed" : ""}`}>
//       <div className="pmis-menu">
//         <a>📊 <span className="pmis-text">Dashboard</span></a>
//         <a className="active" onClick={() => setPmOpen(!pmOpen)}>
//           📁 <span className="pmis-text">Project Management</span>
//           <span className="pmis-submenu-arrow">{pmOpen ? "▼" : "▶"}</span>
//         </a>
//         <div className={`pmis-submenu${pmOpen ? " open" : ""}`}>
//           <div className="pmis-onboard-item" onMouseEnter={() => setDropOpen(true)} onMouseLeave={() => setDropOpen(false)} style={{ position: "relative" }}>
//             ➕ Add Project
//             <div className={`pmis-onboard-dropdown${dropOpen ? " open" : ""}`}>
//               {["MSAP", "MSIP", "BSP"].map(t => <button key={t} onClick={() => onAddProject(t)}>{t}</button>)}
//             </div>
//           </div>
//           <div onClick={onSearchProject}>🔍 Search Project</div>
//         </div>
//         <a>🗂️ <span className="pmis-text">Master Data</span></a>
//         <a>🏢 <span className="pmis-text">Vendor Management</span></a>
//         <a>👤 <span className="pmis-text">User Management</span></a>
//       </div>
//     </div>
//   );
// }


// ─── Sidebar ──────────────────────────────────────────────────
import { useState } from "react";
import { useNavigate, useLocation } from "react-router-dom";

export default function Sidebar({ collapsed, onAddProject, onSearchProject }) {
  const navigate = useNavigate();
  const location = useLocation();

  // Submenu open/close state — mirrors original HTML (arrow ▶ / ▼)
  const [pmOpen, setPmOpen] = useState(false);
  const [mdOpen, setMdOpen] = useState(false);
  const [vmOpen, setVmOpen] = useState(false);
  const [umOpen, setUmOpen] = useState(false);

  // Hover-dropdown for "Add Project" (MSAP / MSIP / BSP)
  const [dropOpen, setDropOpen] = useState(false);

  // Helper: is the current URL inside a given section?
  const isActive = (prefix) => location.pathname === prefix || location.pathname.startsWith(prefix + "/");

  return (
    <div className={`pmis-sidebar${collapsed ? " collapsed" : ""}`}>
      <div className="pmis-menu">
        {/* Dashboard */}
        <a
          className={location.pathname === "/" ? "active" : ""}
          onClick={() => navigate("/")}
        >
          📊 <span className="pmis-text">Dashboard</span>
        </a>

        {/* Project Management */}
        <a
          className={isActive("/projects") ? "active" : ""}
          onClick={() => setPmOpen(!pmOpen)}
        >
          📁 <span className="pmis-text">Project Management</span>
          <span className="pmis-submenu-arrow">{pmOpen ? "▼" : "▶"}</span>
        </a>
        <div className={`pmis-submenu${pmOpen ? " open" : ""}`}>
          <div
            className="pmis-onboard-item"
            onMouseEnter={() => setDropOpen(true)}
            onMouseLeave={() => setDropOpen(false)}
            style={{ position: "relative" }}
          >
            ➕ <span className="pmis-text">Add Project</span>
            <div className={`pmis-onboard-dropdown${dropOpen ? " open" : ""}`}>
              {["MSAP", "MSIP", "BSP"].map((t) => (
                <button
                  key={t}
                  onClick={() => {
                    setDropOpen(false);
                    if (onAddProject) onAddProject(t);
                    else navigate(`/projects/new/${t}`);
                  }}
                >
                  {t}
                </button>
              ))}
            </div>
          </div>
          <div
            onClick={() => {
              if (onSearchProject) onSearchProject();
              else navigate("/projects");
            }}
          >
            🔍 <span className="pmis-text">Search Project</span>
          </div>
        </div>

        {/* Master Data */}
        <a
          className={isActive("/master") ? "active" : ""}
          onClick={() => {
            const next = !mdOpen;
            setMdOpen(next);
            if (next) navigate("/master");
          }}
        >
          🗂️ <span className="pmis-text">Master Data</span>
          <span className="pmis-submenu-arrow">{mdOpen ? "▼" : "▶"}</span>
        </a>
        <div className={`pmis-submenu${mdOpen ? " open" : ""}`}>
          <div onClick={() => navigate("/master/vendors")}>
            🏢 <span className="pmis-text">Vendor Data</span>
          </div>
          <div onClick={() => navigate("/master/users")}>
            👤 <span className="pmis-text">User Data</span>
          </div>
        </div>

        {/* Vendor Management */}
        <a
          className={isActive("/vendors") ? "active" : ""}
          onClick={() => setVmOpen(!vmOpen)}
        >
          🏢 <span className="pmis-text">Vendor Management</span>
          <span className="pmis-submenu-arrow">{vmOpen ? "▼" : "▶"}</span>
        </a>
        <div className={`pmis-submenu${vmOpen ? " open" : ""}`}>
          <div onClick={() => navigate("/vendors/new")}>
            ➕ <span className="pmis-text">Add Vendor</span>
          </div>
          <div onClick={() => navigate("/vendors")}>
            🔍 <span className="pmis-text">Search Vendor</span>
          </div>
        </div>

        {/* User Management */}
        <a
          className={isActive("/users") ? "active" : ""}
          onClick={() => setUmOpen(!umOpen)}
        >
          👤 <span className="pmis-text">User Management</span>
          <span className="pmis-submenu-arrow">{umOpen ? "▼" : "▶"}</span>
        </a>
        <div className={`pmis-submenu${umOpen ? " open" : ""}`}>
          <div onClick={() => navigate("/users/new")}>
            ➕ <span className="pmis-text">Add User</span>
          </div>
          <div onClick={() => navigate("/users")}>
            🔍 <span className="pmis-text">Search User</span>
          </div>
        </div>
      </div>
    </div>
  );
}