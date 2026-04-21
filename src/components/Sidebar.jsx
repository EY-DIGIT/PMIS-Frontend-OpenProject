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

  // Helper: is the current URL inside a given section?
  const isActive = (prefix) =>
    location.pathname === prefix || location.pathname.startsWith(prefix + "/");

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
          {/* Add Project — direct click, no dropdown */}
          <div
            onClick={() => navigate("/project/new")}
          >
            ➕ <span className="pmis-text">Add Project</span>
          </div>

          {/* Search Project — direct click */}
          <div
            onClick={() =>  navigate("/search-project")}
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