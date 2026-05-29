// ============================================================
// Layout.jsx  –  Shell: Header, Navbar, Sidebar, Footer
//                Routes ke liye children prop use hoga
// ============================================================
import { useEffect, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { FiMenu, FiHome, FiUser } from "react-icons/fi";
import { usePageContext } from "../utils/pageContext";

/* Map of route prefix → { label, tooltip } for the navbar centre slot.
   Keep small; pages that want a navbar title append their entry here
   instead of mutating the layout component. */
const NAV_TITLES = {
  "manage-users": {
    label: "Manage Team",
    tooltip:
      "Roles set. People in. Assign users to project roles, then configure ownership for each activity. Click any activity below to set its Activity Owner and Concerned Divisions."
  }
};

/* Resolve a navbar centre entry for the current path. Pages whose first
   segment is shared by multiple routes (e.g. /projects which covers the
   list, detail, config, track, etc.) need finer-grained matching than a
   plain NAV_TITLES lookup. Keep the routing logic local to the layout
   so individual pages don't have to know about each other. */
function resolveNavTitle(segments) {
  const first = segments[0];
  if (!first) return null;

  /* /projects/:projectId is the project-detail route; sub-routes like
     /config, /track, /audit-logs already have their own page-level
     headings, so only the bare detail page surfaces in the navbar. */
  if (first === "projects") {
    if (segments.length === 2 && segments[1] !== "add") {
      return {
        label: "Project Details",
        tooltip: "Project overview — edit project info, manage documents and review the activity timeline."
      };
    }
    return null;
  }

  return NAV_TITLES[first] || null;
}

function NavCenterTitle() {
  const { pathname } = useLocation();
  const segments = pathname.split("/").filter(Boolean);
  const entry = resolveNavTitle(segments);
  if (!entry) return null;
  return (
    <div
      className="pmis-navbar-title"
      title={entry.tooltip}
      role="heading"
      aria-level={1}
    >
      {entry.label}
    </div>
  );
}

/* Right-side project name pill — fed by the global page context so
   pages that hold project state (currently only ManageTeam) can
   surface the project name in the top header. Hidden when no
   project is published. */
function NavProjectName() {
  const ctx = usePageContext();
  const name = (ctx && ctx.projectName) || "";
  if (!name) return null;
  return (
    <div
      className="pmis-navbar-project"
      title={`Project: ${name}`}
    >
      {name}
    </div>
  );
}

import { useProjects } from "../store/Projectstore";
import * as auth from "../api/auth";
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
  const [signingOut, setSigningOut] = useState(false);

  const handleSignOut = async () => {
    if (signingOut) return;
    setSigningOut(true);
    try {
      await auth.logout();
    } catch {
      // token already cleared in auth.logout's finally block
    } finally {
      setSigningOut(false);
      navigate("/login", { replace: true });
    }
  };

  const setFont = (mode) => {
    setFontMode(mode);
    document.documentElement.style.fontSize = FONT_SIZES[mode] || "";
  };

  // Floating header: collapse the a11y (text-size) strip once the user
  // scrolls past a small threshold so only the brand bar stays pinned
  // at the top. Same hide-on-scroll pattern as the PMIS Project
  // Management reference. Hysteresis: hide above 28px, reveal below
  // 4px — avoids jitter when scroll oscillates near the boundary.
  const [a11yCollapsed, setA11yCollapsed] = useState(false);
  useEffect(() => {
    const HIDE_AT = 28;
    const SHOW_AT = 4;
    const content = document.querySelector('.pmis-content');
    let ticking = false;
    let hidden = false;
    const update = () => {
      const top = Math.max(content?.scrollTop || 0, window.scrollY || 0);
      if (!hidden && top > HIDE_AT) {
        hidden = true;
        setA11yCollapsed(true);
      } else if (hidden && top < SHOW_AT) {
        hidden = false;
        setA11yCollapsed(false);
      }
      ticking = false;
    };
    const onScroll = () => {
      if (!ticking) {
        window.requestAnimationFrame(update);
        ticking = true;
      }
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    if (content) content.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      window.removeEventListener('scroll', onScroll);
      if (content) content.removeEventListener('scroll', onScroll);
    };
  }, []);

  return (
    <div className="pmis-wrap" onClick={() => setProfileOpen(false)}>

      {/* ── Header ── */}
      <header className="site-header" role="banner">
        <div className={`header-accessibility-strip${a11yCollapsed ? ' collapsed' : ''}`}>
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
          <span
            onClick={() => setCollapsed((c) => !c)}
            style={{ display: "flex", alignItems: "center", gap: "10px" }}
          >
            <FiMenu size={ICON_SIZE} aria-hidden="true" /> Menu
          </span>
          <span
            onClick={() => navigate("/")}
            style={{ display: "flex", alignItems: "center", gap: "10px" }}
          >
            <FiHome size={ICON_SIZE} aria-hidden="true" /> Home
          </span>
        </div>
        <NavCenterTitle />
        <NavProjectName />
        <div
          className="pmis-profile"
          onClick={(e) => { e.stopPropagation(); setProfileOpen((o) => !o); }}
          style={{ display: "flex", alignItems: "center", gap: "10px" }}
        >
          <FiUser size={ICON_SIZE} aria-hidden="true" />
          <div className={`pmis-profile-menu${profileOpen ? " open" : ""}`}>
            <div onClick={() => { setProfileOpen(false); navigate("/profile"); }}>Profile</div>
            <div onClick={handleSignOut} style={{ pointerEvents: signingOut ? "none" : "auto", opacity: signingOut ? 0.6 : 1 }}>
              {signingOut ? "Signing Out…" : "Sign Out"}
            </div>
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