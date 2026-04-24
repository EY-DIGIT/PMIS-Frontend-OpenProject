// ============================================================
// Layout.jsx  –  Shell: Header, Navbar, Sidebar, Footer
//                Routes ke liye children prop use hoga
// ============================================================
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { FiMenu, FiHome, FiUser } from "react-icons/fi";

import { useProjects } from "../store/Projectstore";
import Sidebar from "../components/Sidebar";
// import LoaderModal from "../components/LoaderModal";
// import MessageModal from "../components/MessageModal";

import Aadhar from "../assets/Aadhaar.png";

const ICON_SIZE = 18;

const FONT_SIZES = { decrease: "14px", reset: "", increase: "18px" };

export default function Layout({ children }) {
  const navigate = useNavigate();
  const { loader, msg, clearMsg } = useProjects();
  const [collapsed, setCollapsed] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const [fontMode, setFontMode] = useState("reset");

  const setFont = (mode) => {
    setFontMode(mode);
    document.documentElement.style.fontSize = FONT_SIZES[mode] || "";
  };

  return (
    <div className="pmis-wrap" onClick={() => setProfileOpen(false)}>

      {/* ── Header ── */}
      <header className="site-header" role="banner">
        <div className="header-accessibility-strip">
          <span className="a11y-label" aria-hidden="true">Text Size:</span>
          <div className="font-resizer" role="group" aria-label="Adjust text size">
            <button
              type="button"
              className="fr-plus"
              aria-label="Increase text size"
              aria-pressed={fontMode === "increase"}
              onClick={() => setFont("increase")}
            >+A</button>
            <button
              type="button"
              className="fr-reset"
              aria-label="Reset text size to default"
              aria-pressed={fontMode === "reset"}
              onClick={() => setFont("reset")}
            >A</button>
            <button
              type="button"
              className="fr-minus"
              aria-label="Decrease text size"
              aria-pressed={fontMode === "decrease"}
              onClick={() => setFont("decrease")}
            >-A</button>
          </div>
        </div>
        <div className="header-main">
          <div className="header-brand">
            <img src={Aadhar} alt="Aadhaar logo" />
            <div className="header-brand-text">
              <span className="header-brand-hi-1" lang="hi">मेरा आधार</span>
              <span className="header-brand-hi-2" lang="hi">मेरी पहचान</span>
            </div>
          </div>
          <h1 className="header-title">UIDAI Automation Governance Tool</h1>
          <div className="header-authority">
            Unique Identification<br />Authority of India
          </div>
        </div>
      </header>

      {/* ── Navbar ── */}
      <div className="pmis-navbar">
        <div className="pmis-menu-home-block">
          <span onClick={() => setCollapsed((c) => !c)}>
            <FiMenu size={ICON_SIZE} aria-hidden="true" /> Menu
          </span>
          <span onClick={() => navigate("/")}>
            <FiHome size={ICON_SIZE} aria-hidden="true" /> Home
          </span>
        </div>
        <div
          className="pmis-profile"
          onClick={(e) => { e.stopPropagation(); setProfileOpen((o) => !o); }}
        >
          <FiUser size={ICON_SIZE} aria-hidden="true" />
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
      {/* {loader && <LoaderModal text={loader} />}
      {msg && <MessageModal msg={msg.text} onOk={clearMsg} />} */}

    </div>
  );
}