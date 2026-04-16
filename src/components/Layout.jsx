import { useState } from "react";
import { Outlet, useNavigate } from "react-router-dom";
import Sidebar from "./Sidebar";
import Aadhar from "../assets/Aadhaar.png";
import Logo from "../assets/logo.avif";

export default function Layout() {
  const navigate = useNavigate();
  const [collapsed, setCollapsed] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);

  return (
    <div className="pmis-wrap" onClick={() => setProfileOpen(false)}>
      {/* Header */}
      <div className="pmis-header">
        <img src={Logo} alt="Logo" className="logo-left" />
        <strong>UIDAI Automation Governance Tool</strong>
        <img src={Aadhar} alt="Aadhar" className="logo-right" />
      </div>

      {/* Navbar */}
      <div className="pmis-navbar">
        <div className="pmis-menu-home-block">
          <span onClick={() => setCollapsed(!collapsed)}>☰ Menu</span>
          <span onClick={() => navigate("/")}>🏠 Home</span>
        </div>
        <div
          className="pmis-profile"
          onClick={e => { e.stopPropagation(); setProfileOpen(!profileOpen); }}
        >
          👤
          <div className={`pmis-profile-menu${profileOpen ? " open" : ""}`}>
            <div>Profile</div>
            <div>Sign Out</div>
          </div>
        </div>
      </div>

      {/* Body */}
      <div className="pmis-layout">
        <Sidebar collapsed={collapsed} />
        <div className="pmis-content">
          <Outlet /> {/* ← Yahan page render hoga */}
        </div>
      </div>

      <div className="pmis-footer">
        © 2026 UIDAI · PMIS Automation Tool · Internal Use Only
      </div>
    </div>
  );
}