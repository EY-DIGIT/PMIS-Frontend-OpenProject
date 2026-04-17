// ============================================================
// Layout.jsx  –  Shell: Header, Navbar, Sidebar, Footer
//                Routes ke liye children prop use hoga
// ============================================================
import { useState } from "react";
import { useNavigate } from "react-router-dom";

import { useProjects } from "../store/Projectstore";
import Sidebar from "../components/Sidebar";
import LoaderModal from "../components/LoaderModal";
import MessageModal from "../components/MessageModal";

import Aadhar from "../assets/Aadhaar.png";
import Logo from "../assets/logo.avif";

export default function Layout({ children }) {
  const navigate = useNavigate();
  const { loader, msg, clearMsg } = useProjects();
  const [collapsed, setCollapsed] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);

  return (
    <div className="pmis-wrap" onClick={() => setProfileOpen(false)}>

      {/* ── Header ── */}
      <div className="pmis-header">
        <img src={Logo} alt="Logo" className="logo-left" />
        <strong>UIDAI Automation Governance Tool</strong>
        <img src={Aadhar} alt="Aadhar" className="logo-right" />
      </div>

      {/* ── Navbar ── */}
      <div className="pmis-navbar">
        <div className="pmis-menu-home-block">
          <span onClick={() => setCollapsed((c) => !c)}>☰ Menu</span>
          <span onClick={() => navigate("/")}>🏠 Home</span>
        </div>
        <div
          className="pmis-profile"
          onClick={(e) => { e.stopPropagation(); setProfileOpen((o) => !o); }}
        >
          👤
          <div className={`pmis-profile-menu${profileOpen ? " open" : ""}`}>
            <div>Profile</div>
            <div onClick={() => navigate("/login")}>Sign Out</div>
          </div>
        </div>
      </div>

      {/* ── Body ── */}
      <div className="pmis-layout">
        <Sidebar
          collapsed={collapsed}
          onAddProject={(type) => navigate(`/onboard/${encodeURIComponent(type)}`)}
          onSearchProject={() => navigate("/projects")}
        />
        <div className="pmis-content">
          {children}
        </div>
      </div>

      {/* ── Footer ── */}
      <div className="pmis-footer">
        © 2026 UIDAI · PMIS Automation Tool · Internal Use Only
      </div>

      {/* ── Global modals ── */}
      {loader && <LoaderModal text={loader} />}
      {msg && <MessageModal msg={msg.text} onOk={clearMsg} />}

    </div>
  );
}