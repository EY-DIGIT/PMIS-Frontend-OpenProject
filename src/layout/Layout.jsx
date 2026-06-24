// ============================================================
// Layout.jsx  –  Shell: Header, Navbar, Sidebar, Footer
//                Routes ke liye children prop use hoga
// ============================================================
import { useEffect, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { FiMenu, FiHome, FiUser } from "react-icons/fi";
import { usePageContext } from "../utils/pageContext";

/* Map of simple route prefix → { label, tooltip } for the navbar centre
   slot. Routes whose first segment is unambiguous (one page only) can
   live here; URLs with sub-routes that need different titles per depth
   are handled in resolveNavTitle below. */
const NAV_TITLES = {
  "manage-users": {
    label: "Manage Team",
    tooltip:
      "Roles set. People in. Assign users to project roles, then configure ownership for each activity. Click any activity below to set its Activity Owner and Concerned Divisions."
  },
  "vendors": {
    label: "Organization Management",
    tooltip: "Browse, add and edit the organizations that participate in projects."
  },
  "users": {
    label: "User Management",
    tooltip: "Browse, add and edit users across the system."
  },
  "meetings": {
    label: "Meeting Management",
    tooltip: "Schedule meetings, capture MoMs and convert decisions into tasks."
  },
  "tickets": {
    label: "Ticket & SLA Management",
    tooltip: "Raise and track project tickets — categories drive SLA timelines, escalation and approval workflows."
  }
};

/* Resolve a navbar centre entry for the current path. Pages whose first
   segment is shared by multiple routes (e.g. /projects which covers the
   list, detail, config, track, etc.) need finer-grained matching than a
   plain NAV_TITLES lookup. Single source of truth for body-level page
   headings — keep this in lock-step with PageTitle in App.jsx (which is
   now a no-op since the heading lives here). */
function resolveNavTitle(segments) {
  const first = segments[0];
  if (!first) return null;

  /* Profile page renders its own avatar/header block — opt out. */
  if (first === "profile") return null;

  /* Dashboard now uses the global navbar title instead of an in-page
     heading. Sub-routes (summary / project / org) get their own
     label so users always know which view they're on. */
  if (first === "dashboard") {
    if (segments[1] === "project") {
      return { label: "Project View", tooltip: "Per-project dashboard rollups." };
    }
    if (segments[1] === "org") {
      return { label: "Organization View", tooltip: "Per-organization dashboard rollups." };
    }
    return { label: "Dashboard", tooltip: "Cross-project KPIs, delays and rollups." };
  }

  if (first === "projects") {
    // /projects                        → list
    if (segments.length === 1) {
      return {
        label: "Project Management",
        tooltip: "Browse and manage all projects."
      };
    }
    // /projects/add                    → new project
    // /projects/add/config             → milestone config for a new project
    if (segments[1] === "add") {
      if (segments[2] === "config") {
        return {
          label: "Milestone Configuration",
          tooltip: "Configure milestones, activities and tasks for the project."
        };
      }
      return {
        label: "New Project",
        tooltip: "Create a new project — fill in details, vendors and dates."
      };
    }
    // /projects/:id/config             → milestone config for an existing project
    if (segments[2] === "config") {
      return {
        label: "Milestone Configuration",
        tooltip: "Configure milestones, activities and tasks for the project."
      };
    }
    // /projects/:id/track              → live progress
    if (segments[2] === "track") {
      return {
        label: "Track Progress",
        tooltip: "Track the project's milestones, activities and approvals in real time."
      };
    }
    // /projects/:id/audit-logs         → audit trail
    if (segments[2] === "audit-logs") {
      return {
        label: "Audit Logs",
        tooltip: "Chronological audit trail of every change made to this project."
      };
    }
    // /projects/:id/finance            → cost / payment-term / CCN config
    if (segments[2] === "finance") {
      return {
        label: "Project Finance",
        tooltip: "Configure project costs, payment terms by phase, QRG and CCN cap."
      };
    }// /projects/:id/activity-slas      → SLA → activity mapping & evaluation
    if (segments[2] === "activity-slas") {
      return {
        label: "Map SLA to Activity",
        tooltip: "Map SLA masters to an activity, edit mappings, and evaluate SLAs."
      };
    }

    // /projects/:id                    → detail
    return {
      label: "Project Details",
      tooltip: "Project overview — edit project info, manage documents and review the activity timeline."
    };
  }

  /* Meetings sub-routes. The list page falls through to NAV_TITLES
     ("Meeting Management"); the Create flow gets its own title so
     the in-page heading can be dropped. */
  if (first === "meetings") {
    if (segments[1] === "new") {
      return {
        label: "Create a New Meeting",
        tooltip: "Fill in details, attendees, and dates to schedule a new meeting."
      };
    }
  }

  /* Approval Inbox — both the Concerned Division and Activity Owner
     inboxes show "Approval Inbox" in the navbar (like Project Details),
     with a role-specific tooltip. */
  if (first === "approvals") {
    if (segments[1] === "activity-owner") {
      return {
        label: "Approval Inbox",
        tooltip: "Activities awaiting your final decision as Activity Owner."
      };
    }
    if (segments[1] === "concerned-division") {
      return {
        label: "Approval Inbox",
        tooltip: "Activity approval requests routed to your division."
      };
    }
    return { label: "Approval Inbox", tooltip: "Approval requests routed to you." };
  }

  if (first === "master") {
    if (segments[1] === "vendors") {
      return { label: "Organization Data", tooltip: "Reference data — organizations and their attributes." };
    }
    if (segments[1] === "users") {
      return { label: "User Data", tooltip: "Reference data — users and their attributes." };
    }
    if (segments[1] === "divisions") {
      return { label: "Division Data", tooltip: "Reference data — divisions and their attributes." };
    }
    return { label: "Master Data", tooltip: "Reference data used across the platform." };
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
import { useCurrentRole } from "../auth/permissions";
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

  /* Director Admin is a dashboard-only role — they get the global
     chrome (header, navbar, footer) but no left nav. Toggle is also
     suppressed so the now-empty menu icon doesn't sit there idle. */
  const currentRole = useCurrentRole();
  const isDashboardOnly = currentRole === "director_admin";

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
      // Collapsing the (sticky) strip shrinks the page by its height. If the
      // page only barely overflows, that shrink removes the very scroll
      // distance that triggered the collapse: the position snaps back toward
      // the top, the strip re-expands, the page grows again — a constant
      // collapse↔️expand shake. So only hide when there's MORE scrollable
      // distance than the strip would reclaim, leaving the user comfortably
      // past HIDE_AT afterwards. Revealing only depends on nearing the top.
      const strip = document.querySelector('.header-accessibility-strip');
      const reclaim = (strip && !hidden) ? strip.offsetHeight : 0;
      const maxScroll = Math.max(
        document.documentElement.scrollHeight - window.innerHeight,
        content ? content.scrollHeight - content.clientHeight : 0
      );
      if (!hidden && top > HIDE_AT && maxScroll > reclaim + HIDE_AT) {
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
        {!isDashboardOnly && (
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
        )}
        <NavCenterTitle />
        <NavProjectName />
        <div
          className="pmis-profile"
          onClick={(e) => { e.stopPropagation(); setProfileOpen((o) => !o); }}
          style={{
            display: "flex",
            alignItems: "center",
            gap: "10px",
            /* When the left menu/home block is hidden (director_admin)
               there's no flex sibling to push the profile to the
               far right via space-between — pin it explicitly. */
            marginLeft: isDashboardOnly ? "auto" : undefined
          }}
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
        {!isDashboardOnly && (
          <Sidebar
            collapsed={collapsed}
            onAddProject={(type) => navigate(`/onboard/${encodeURIComponent(type)}`)}
            onSearchProject={() => navigate("/projects")}
          />
        )}
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