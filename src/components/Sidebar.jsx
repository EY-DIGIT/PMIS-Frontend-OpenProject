// ─── Sidebar ──────────────────────────────────────────────────
import { useState } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import {
  FiGrid,
  FiFolder,
  FiPlus,
  FiSearch,
  FiDatabase,
  FiBriefcase,
  FiUser,
  FiUsers,
  FiChevronRight,
  FiChevronDown
} from "react-icons/fi";

const ICON_SIZE = 18;

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

  const Chevron = ({ open }) =>
    open ? <FiChevronDown size={14} /> : <FiChevronRight size={14} />;

  return (
    <div className={`pmis-sidebar${collapsed ? " collapsed" : ""}`}>
      <div className="pmis-menu">
        {/* Dashboard */}
        <a
          className={location.pathname === "/" ? "active" : ""}
          onClick={() => navigate("/")}
        >
          <FiGrid size={ICON_SIZE} />
          <span className="pmis-text">Dashboard</span>
        </a>

        {/* Project Management */}
        <a
          className={isActive("/projects") ? "active" : ""}
          onClick={() => setPmOpen(!pmOpen)}
        >
          <FiFolder size={ICON_SIZE} />
          <span className="pmis-text">Project Management</span>
          <span className="pmis-submenu-arrow">
            <Chevron open={pmOpen} />
          </span>
        </a>
        <div className={`pmis-submenu${pmOpen ? " open" : ""}`}>
          <div onClick={() => navigate("/projects/add")}>
            <FiPlus size={ICON_SIZE} />
            <span className="pmis-text">Add Project</span>
          </div>
          <div onClick={() => navigate("/projects")}>
            <FiSearch size={ICON_SIZE} />
            <span className="pmis-text">Search Project</span>
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
          <FiDatabase size={ICON_SIZE} />
          <span className="pmis-text">Master Data</span>
          <span className="pmis-submenu-arrow">
            <Chevron open={mdOpen} />
          </span>
        </a>
        <div className={`pmis-submenu${mdOpen ? " open" : ""}`}>
          <div onClick={() => navigate("/master/vendors")}>
            <FiBriefcase size={ICON_SIZE} />
            <span className="pmis-text">Vendor Data</span>
          </div>
          <div onClick={() => navigate("/master/users")}>
            <FiUsers size={ICON_SIZE} />
            <span className="pmis-text">User Data</span>
          </div>
        </div>

        {/* Vendor Management */}
        <a
          className={isActive("/vendors") ? "active" : ""}
          onClick={() => setVmOpen(!vmOpen)}
        >
          <FiBriefcase size={ICON_SIZE} />
          <span className="pmis-text">Vendor Management</span>
          <span className="pmis-submenu-arrow">
            <Chevron open={vmOpen} />
          </span>
        </a>
        <div className={`pmis-submenu${vmOpen ? " open" : ""}`}>
          <div onClick={() => navigate("/vendors/new")}>
            <FiPlus size={ICON_SIZE} />
            <span className="pmis-text">Add Vendor</span>
          </div>
          <div onClick={() => navigate("/vendors")}>
            <FiSearch size={ICON_SIZE} />
            <span className="pmis-text">Search Vendor</span>
          </div>
        </div>

        {/* User Management */}
        <a
          className={isActive("/users") ? "active" : ""}
          onClick={() => setUmOpen(!umOpen)}
        >
          <FiUser size={ICON_SIZE} />
          <span className="pmis-text">User Management</span>
          <span className="pmis-submenu-arrow">
            <Chevron open={umOpen} />
          </span>
        </a>
        <div className={`pmis-submenu${umOpen ? " open" : ""}`}>
          <div onClick={() => navigate("/users/new")}>
            <FiPlus size={ICON_SIZE} />
            <span className="pmis-text">Add User</span>
          </div>
          <div onClick={() => navigate("/users")}>
            <FiSearch size={ICON_SIZE} />
            <span className="pmis-text">Search User</span>
          </div>
        </div>
      </div>
    </div>
  );
}
