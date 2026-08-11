// ============================================================
// Layout.jsx  –  Shell: Header, Navbar, Sidebar, Footer
//                Routes ke liye children prop use hoga
// ============================================================
import { useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { FiMenu, FiHome } from "react-icons/fi";
import { usePageContext } from "../utils/pageContext";
import { tokenStore } from "../api/client";
import Aadhar from "../assets/Aadhaar.png";
import HeaderProjectPicker from "../pages/dashboard/HeaderProjectPicker";

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
    label: "Ticket Management",
    tooltip: "Raise and track project tickets — categories drive escalation and approval workflows."
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

  /* Profile page heading now lives in the global navbar (the in-page
     header block was removed). */
  if (first === "profile") {
    return {
      label: "My Profile",
      tooltip: "View and manage your account information, role-based access, and administrative actions."
    };
  }

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
    // /projects/:id/sla-system         → the SLA section's landing page.
    // Renders its own header block, so suppress the navbar title.
    if (segments[2] === "sla-system") {
      return null;
    }
    // /projects/:id/severity           → severity levels + LD bands
    if (segments[2] === "severity") {
      return {
        label: "Severity & LD Configuration",
        tooltip: "Severity levels with their points, and the LD band lookup table."
      };
    }
    // /projects/:id/sla-settlement     → project-level quarterly LD settlement
    if (segments[2] === "sla-settlement") {
      return {
        label: "Settlement & LD",
        tooltip: "Quarterly aggregate, NPQP, capped LD and the invoice lock."
      };
    }
    // /projects/:id/penalty-report     → milestone delay → LD → net payable
    if (segments[2] === "penalty-report") {
      return {
        label: "Penalty Report",
        tooltip: "Milestone delay converted to LD% and applied to the milestone's payment."
      };
    }
    // /projects/:id/leave-config       → leave & attendance policy.
    // The page renders its own in-page header block, so suppress the
    // navbar title to avoid a duplicate heading.
    if (segments[2] === "leave-config") {
      return null;
    }

    // /projects/:id/attendance/leave/:attendanceId → single-employee leave detail
    if (segments[2] === "attendance" && segments[3] === "leave") {
      return {
        label: "Leave Detail",
        tooltip: "Quarterly leave detail for one employee."
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

  /* Tickets sub-routes. The list page falls through to NAV_TITLES
     ("Ticket Management"); the Create flow gets its own title so the
     in-page heading can be dropped. */
  if (first === "tickets") {
    if (segments[1] === "new") {
      return {
        label: "Create Ticket",
        tooltip: "Raise a new operational or contractual ticket against a project, task or activity."
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
    if (segments[1] === "resources") {
      return { label: "Resource Data", tooltip: "Reference data — resources, their rates and employment history." };
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


const ICON_SIZE = 18;

const FONT_SIZES = { decrease: "14px", reset: "", increase: "18px" };

export default function Layout({ children }) {
  const navigate = useNavigate();
  const location = useLocation();
  const { loader, msg, clearMsg } = useProjects();

  /* Dashboard view switcher lives in the global header now (moved out of
     the in-page ViewBar). Shown only on /dashboard/* routes. */
  const onDashboard = location.pathname.startsWith("/dashboard");
  const dashView = location.pathname.startsWith("/dashboard/project")
    ? "/dashboard/project"
    : location.pathname.startsWith("/dashboard/org")
      ? "/dashboard/org"
      : "/dashboard/summary";
  const switchDashView = (to) => navigate(to, { state: { tick: Date.now() } });
  const refreshDashboard = () => {
    if (typeof window !== "undefined") {
      window.dispatchEvent(new CustomEvent("pmis:dashboard-refresh"));
    }
  };
  const [collapsed, setCollapsed] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const [fontMode, setFontMode] = useState("reset");
  const [signingOut, setSigningOut] = useState(false);

  /* Director Admin is a dashboard-only role — they get the global
     chrome (header, navbar, footer) but no left nav. Toggle is also
     suppressed so the now-empty menu icon doesn't sit there idle. */
  const currentRole = useCurrentRole();
  const isDashboardOnly = currentRole === "director_admin";

  /* Header user chip (visual) — real name/role from the stored user. */
  const currentUser = tokenStore.getUser() || {};
  const displayName =
    currentUser.userName || currentUser.name || currentUser.fullName ||
    currentUser.email || "User";
  const roleLabel = (currentRole || "")
    .replace(/[_-]+/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()) || "UIDAI";
  const initials = displayName
    .split(/[\s@.]+/).filter(Boolean).slice(0, 2)
    .map((s) => s[0]?.toUpperCase()).join("") || "U";

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

  return (
    <div className="pmis-wrap" onClick={() => setProfileOpen(false)}>

      {/* ── Government banner — full width across the very top (touches the
           left edge, sits above both the sidebar and the right column) ── */}
      <header className="site-header" role="banner">
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

      {/* ── Shell row: sidebar + right column, below the banner ── */}
      <div className="pmis-shell-row">

      {/* ── Sidebar — sits below the banner, on the left ── */}
      {!isDashboardOnly && (
        <Sidebar
          collapsed={collapsed}
          onAddProject={(type) => navigate(`/onboard/${encodeURIComponent(type)}`)}
          onSearchProject={() => navigate("/projects")}
        />
      )}

      {/* ── Right column: app-controls header + content + footer ── */}
      <div className="pmis-main">

        {/* ── App-controls header ── */}
        <header className="pmis-header" role="banner">
          <div className="pmis-header-left">
            {!isDashboardOnly && (
              <button type="button" className="pmis-header-menu" aria-label="Toggle menu"
                onClick={() => setCollapsed((c) => !c)}>
                <FiMenu size={ICON_SIZE} aria-hidden="true" />
              </button>
            )}
            <span className="pmis-header-home" title="Home" onClick={() => navigate("/")}>
              <FiHome size={ICON_SIZE} aria-hidden="true" />
            </span>
            {!onDashboard && (
              <div className="pmis-header-titles">
                <NavCenterTitle />
              </div>
            )}
            {onDashboard && (
              <span className="pmis-viewswitch">
                <select value={dashView} onChange={(e) => switchDashView(e.target.value)} aria-label="Dashboard view">
                  <option value="/dashboard/summary">Summary View</option>
                  <option value="/dashboard/project">Project View</option>
                  <option value="/dashboard/org">Organization View</option>
                </select>
              </span>
            )}
            {dashView === "/dashboard/project" && onDashboard && <HeaderProjectPicker />}
            <NavProjectName />
          </div>

          <div className="pmis-header-right">
            {onDashboard && (
              <button type="button" className="pmis-header-refresh" title="Refresh dashboard"
                onClick={refreshDashboard}>↻ Refresh</button>
            )}
            <div className="font-resizer" role="group" aria-label="Adjust text size">
              <button type="button" className="fr-plus" aria-label="Increase text size"
                aria-pressed={fontMode === "increase"} onClick={() => setFont("increase")}>+A</button>
              <button type="button" className="fr-reset" aria-label="Reset text size"
                aria-pressed={fontMode === "reset"} onClick={() => setFont("reset")}>A</button>
              <button type="button" className="fr-minus" aria-label="Decrease text size"
                aria-pressed={fontMode === "decrease"} onClick={() => setFont("decrease")}>-A</button>
            </div>
            <div className="pmis-nav-user"
              onClick={(e) => { e.stopPropagation(); setProfileOpen((o) => !o); }}>
              <span className="pmis-nav-user-av">{initials}</span>
              {/* Top line (bold) is the ROLE, bottom line (plain) is the EMAIL —
                  the class names read the other way round for historical reasons. */}
              <span className="pmis-nav-user-meta">
                <span className="pmis-nav-user-name">{roleLabel}</span>
                <span className="pmis-nav-user-role">{currentUser.email || displayName}</span>
              </span>
              <div className={`pmis-profile-menu${profileOpen ? " open" : ""}`}>
                <div onClick={() => { setProfileOpen(false); navigate("/profile"); }}>Profile</div>
                <div onClick={handleSignOut} style={{ pointerEvents: signingOut ? "none" : "auto", opacity: signingOut ? 0.6 : 1 }}>
                  {signingOut ? "Signing Out…" : "Sign Out"}
                </div>
              </div>
            </div>
          </div>
        </header>

        {/* ── Content ── */}
        <div className="pmis-content">
          {children}
        </div>

        {/* ── Footer — right side only, not fixed ── */}
        <div className="pmis-footer">
          © 2026 UIDAI · PMIS Automation Tool · Internal Use Only
        </div>
      </div>
      </div>

      {/* ── Global modals ── */}
      {/* {loader && <LoaderModal text={loader} />}
      {msg && <MessageModal msg={msg.text} onOk={clearMsg} />} */}

    </div>
  );
}