// ─── Sidebar ──────────────────────────────────────────────────
import { useEffect, useState } from "react";
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
  FiInbox,
  FiCheckCircle,
  FiCalendar,
  FiChevronRight,
  FiChevronDown,
  FiMessageSquare,
  FiFileText,
  FiLock,
  FiTag
} from "react-icons/fi";
import { useCan, useCurrentRole } from "../auth/permissions";
import { userHasRole } from "../auth/roleNormalize";
import { tokenStore } from "../api/client";

const ICON_SIZE = 18;

export default function Sidebar({ collapsed, onAddProject, onSearchProject }) {
  const navigate = useNavigate();
  const location = useLocation();

  // Role-based visibility flags
  const canViewDashboard = useCan("viewDashboard");
  const canViewProjects = useCan("viewProjects");
  const canCreateProject = useCan("createProject");
  const canViewMasterData = useCan("viewMasterData");
  const canViewDivisions = useCan("viewDivisions");
  // Role-based document access (#323) is a superadmin/admin menu —
  // manageProjectDocuments is true for exactly those two roles.
  const canManageDocumentAccess = useCan("manageProjectDocuments");
  const canViewVendors = useCan("viewVendors");
  const canCreateVendor = useCan("createVendor");
  const canViewUsers = useCan("viewUsers");
  const canCreateUser = useCan("createUser");
  // Meeting Management is hidden from project_admin, project_member and
  // org_admin (viewMeetings:false in roles.json); only the elevated
  // admin roles keep it.
  const canViewMeetings = useCan("viewMeetings");

  // Approval Inbox visibility. The whole Approval Inbox section is shown
  // ONLY to the division_approver workflow role — nobody else sees it.
  // division_approver lives outside rolesConfig, so read it straight off
  // the user object. Subscribing to useCurrentRole() keeps the sidebar
  // re-rendering on login / logout / role refresh.
  useCurrentRole();
const showApprovalInbox = userHasRole(tokenStore.getUser(), "division_approver");
const showCdInbox = true;
const showAoInbox = true;

// "All Tickets" is visible only to PMIS_support / super_admin; everyone
// else keeps Create Ticket but loses the All Tickets link.
const showAllTickets =
  userHasRole(tokenStore.getUser(), "PMIS_support") ||
  userHasRole(tokenStore.getUser(), "super_admin");

  // A whole "Management" section is visible only when the user can
  // either view the list or create an item under it. Otherwise the
  // parent header itself is hidden so we don't show empty submenus.
  const showProjectMgmt = canViewProjects || canCreateProject;
  const showVendorMgmt = canViewVendors || canCreateVendor;
  const showUserMgmt = canViewUsers || canCreateUser;

  // Submenu open/close state — mirrors original HTML (arrow ▶ / ▼)
  const [dashOpen, setDashOpen] = useState(false);
  const [pmOpen, setPmOpen] = useState(false);
  const [mdOpen, setMdOpen] = useState(false);
  const [vmOpen, setVmOpen] = useState(false);
  const [umOpen, setUmOpen] = useState(false);
  const [inboxOpen, setInboxOpen] = useState(false);
  const [mmOpen, setMmOpen] = useState(false);
  const [tmOpen, setTmOpen] = useState(false);

  // Helper: is the current URL inside a given section?
  const isUnder = (prefix) =>
    location.pathname === prefix || location.pathname.startsWith(prefix + "/");
  const isExact = (path) => location.pathname === path;

  // Active flags. "Search" rows share their prefix with the matching "Add"
  // page (e.g. /projects vs /projects/add) — so we explicitly exclude the
  // Add path from Search's match.
  const dashActive = isUnder("/dashboard");
  const summaryActive = isExact("/dashboard") || isExact("/dashboard/summary");
  const projectViewActive = isExact("/dashboard/project");
  const orgViewActive = isExact("/dashboard/org");
  const addProjectActive = isUnder("/projects/add");
  const searchProjectActive = isUnder("/projects") && !addProjectActive;
  const pmActive = addProjectActive || searchProjectActive;

  const masterActive = isUnder("/master");
  const vendorDataActive = isUnder("/master/vendors");
  const userDataActive = isUnder("/master/users");
  const slaDataActive = isUnder("/sla-masters");
  const divisionDataActive = isUnder("/master/divisions");
  const holidayDataActive = isUnder("/master/holidays");
  const resourceDataActive = isUnder("/master/resources");
  const documentAccessActive = isUnder("/master/document-access");

  const addVendorActive = isUnder("/vendors/new");
  const searchVendorActive = isUnder("/vendors") && !addVendorActive;
  const vmActive = addVendorActive || searchVendorActive;

  const addUserActive = isUnder("/users/new");
  const searchUserActive = isUnder("/users") && !addUserActive;
  const umActive = addUserActive || searchUserActive;

  // Meeting Management — Create / All. No role gating yet.
  const createMeetingActive = isUnder("/meetings/new");
  const allMeetingsActive = isUnder("/meetings") && !createMeetingActive;
  const mmActive = createMeetingActive || allMeetingsActive;

  // Approval Inbox routes. Two sub-items because role-based gating
  // isn't wired up yet — once the current user's role is known, hide
  // whichever doesn't apply.
  const inboxCdActive = isUnder("/approvals/concerned-division");
  const inboxAoActive = isUnder("/approvals/activity-owner");
  const inboxActive = inboxCdActive || inboxAoActive;

  // Ticket Management — Create / All, mirroring Meeting Management.
  const createTicketActive = isUnder("/tickets/new");
  const allTicketsActive = isUnder("/tickets") && !createTicketActive;
  const ticketsActive = createTicketActive || allTicketsActive;
  const assistantActive = isUnder("/assistant");

  // Auto-expand the section that matches the current route so the active
  // child is visible without the user having to click the parent first.
  useEffect(() => {
    if (dashActive) setDashOpen(true);
    if (pmActive) setPmOpen(true);
    if (masterActive || slaDataActive) setMdOpen(true);
    if (vmActive) setVmOpen(true);
    if (umActive) setUmOpen(true);
    if (mmActive) setMmOpen(true);
    if (inboxActive) setInboxOpen(true);
    if (ticketsActive) setTmOpen(true);
  }, [dashActive, pmActive, masterActive, slaDataActive, vmActive, umActive, mmActive, inboxActive, ticketsActive]);

  const Chevron = ({ open }) =>
    open ? <FiChevronDown size={14} /> : <FiChevronRight size={14} />;

  return (
    <div className={`pmis-sidebar${collapsed ? " collapsed" : ""}`}>
      <div className="pmis-menu">
        {/* Dashboard */}
        {canViewDashboard && (
          <>
            <a
              title="Dashboard"
              className={dashActive ? "active" : ""}
              onClick={() => {
                const next = !dashOpen;
                setDashOpen(next);
                if (next && !dashActive) {
                  navigate("/dashboard/summary", { state: { tick: Date.now() } });
                }
              }}
            >
              <FiGrid size={ICON_SIZE} />
              <span className="pmis-text">Dashboard</span>
              <span className="pmis-submenu-arrow">
                <Chevron open={dashOpen} />
              </span>
            </a>
            <div className={`pmis-submenu${dashOpen ? " open" : ""}`}>
              <div
                title="Summary"
                className={summaryActive ? "active" : ""}
                onClick={() => navigate("/dashboard/summary", { state: { tick: Date.now() } })}
              >
                <FiGrid size={ICON_SIZE} />
                <span className="pmis-text">Summary</span>
              </div>
              <div
                title="Project View"
                className={projectViewActive ? "active" : ""}
                onClick={() => navigate("/dashboard/project", { state: { tick: Date.now() } })}
              >
                <FiFolder size={ICON_SIZE} />
                <span className="pmis-text">Project View</span>
              </div>
              <div
                title="Organization View"
                className={orgViewActive ? "active" : ""}
                onClick={() => navigate("/dashboard/org", { state: { tick: Date.now() } })}
              >
                <FiBriefcase size={ICON_SIZE} />
                <span className="pmis-text">Organization View</span>
              </div>
            </div>
          </>
        )}

        {/* Project Management */}
        {showProjectMgmt && (
          <>
            <a
              title="Project Management"
              className={pmActive ? "active" : ""}
              onClick={() => setPmOpen(!pmOpen)}
            >
              <FiFolder size={ICON_SIZE} />
              <span className="pmis-text">Project Management</span>
              <span className="pmis-submenu-arrow">
                <Chevron open={pmOpen} />
              </span>
            </a>
            <div className={`pmis-submenu${pmOpen ? " open" : ""}`}>
              {canCreateProject && (
                <div
                  title="Add Project"
                  className={addProjectActive ? "active" : ""}
                  onClick={() => navigate("/projects/add")}
                >
                  <FiPlus size={ICON_SIZE} />
                  <span className="pmis-text">Add Project</span>
                </div>
              )}
              {canViewProjects && (
                <div
                  title="Search Project"
                  className={searchProjectActive ? "active" : ""}
                  onClick={() => navigate("/projects")}
                >
                  <FiSearch size={ICON_SIZE} />
                  <span className="pmis-text">Search Project</span>
                </div>
              )}
            </div>
          </>
        )}

        {/* Meeting Management — hidden from the sidebar per request. The
            routes/pages still exist; only the sidebar entry is commented out.
        {canViewMeetings && (
          <>
            <a
              title="Meeting Management"
              className={mmActive ? "active" : ""}
              onClick={() => setMmOpen(!mmOpen)}
            >
              <FiCalendar size={ICON_SIZE} />
              <span className="pmis-text">Meeting Management</span>
              <span className="pmis-submenu-arrow">
                <Chevron open={mmOpen} />
              </span>
            </a>
            <div className={`pmis-submenu${mmOpen ? " open" : ""}`}>
              <div
                title="Create Meeting"
                className={createMeetingActive ? "active" : ""}
                onClick={() => navigate("/meetings/new")}
              >
                <FiPlus size={ICON_SIZE} />
                <span className="pmis-text">Create Meeting</span>
              </div>
              <div
                title="All Meetings"
                className={allMeetingsActive ? "active" : ""}
                onClick={() => navigate("/meetings")}
              >
                <FiSearch size={ICON_SIZE} />
                <span className="pmis-text">All Meetings</span>
              </div>
            </div>
          </>
        )}
        */}

        {/* Master Data */}
        {canViewMasterData && (
          <>
            <a
              title="Master Data Management"
              className={masterActive ? "active" : ""}
              onClick={() => {
                const next = !mdOpen;
                setMdOpen(next);
                if (next) navigate("/master");
              }}
            >
              <FiDatabase size={ICON_SIZE} />
              <span className="pmis-text">Master Data Management</span>
              <span className="pmis-submenu-arrow">
                <Chevron open={mdOpen} />
              </span>
            </a>
            <div className={`pmis-submenu${mdOpen ? " open" : ""}`}>
              <div
                title="Organization Data"
                className={vendorDataActive ? "active" : ""}
                onClick={() => navigate("/master/vendors")}
              >
                <FiBriefcase size={ICON_SIZE} />
                <span className="pmis-text">Organization Data</span>
              </div>
              <div
                title="User Data"
                className={userDataActive ? "active" : ""}
                onClick={() => navigate("/master/users")}
              >
                <FiUsers size={ICON_SIZE} />
                <span className="pmis-text">User Data</span>
              </div>
              {canViewDivisions && (
                <div
                  title="Divisions"
                  className={divisionDataActive ? "active" : ""}
                  onClick={() => navigate("/master/divisions")}
                >
                  <FiGrid size={ICON_SIZE} />
                  <span className="pmis-text">Divisions</span>
                </div>
              )}
              <div
                title="Resource Data"
                className={resourceDataActive ? "active" : ""}
                onClick={() => navigate("/master/resources")}
              >
                <FiUsers size={ICON_SIZE} />
                <span className="pmis-text">Resource Data</span>
              </div>
              <div
                title="Holidays"
                className={holidayDataActive ? "active" : ""}
                onClick={() => navigate("/master/holidays")}
              >
                <FiCalendar size={ICON_SIZE} />
                <span className="pmis-text">Holidays</span>
              </div>
              <div
                title="SLA Masters"
                className={slaDataActive ? "active" : ""}
                onClick={() => navigate("/sla-masters")}
              >
                <FiFileText size={ICON_SIZE} />
                <span className="pmis-text">SLA Masters</span>
              </div>
              {canManageDocumentAccess && (
                <div
                  title="Document Access"
                  className={documentAccessActive ? "active" : ""}
                  onClick={() => navigate("/master/document-access")}
                >
                  <FiLock size={ICON_SIZE} />
                  <span className="pmis-text">Document Access</span>
                </div>
              )}
            </div>
          </>
        )}

        {/* Vendor Management */}
        {showVendorMgmt && (
          <>
            <a
              title="Organization Management"
              className={vmActive ? "active" : ""}
              onClick={() => setVmOpen(!vmOpen)}
            >
              <FiBriefcase size={ICON_SIZE} />
              <span className="pmis-text">Organization Management</span>
              <span className="pmis-submenu-arrow">
                <Chevron open={vmOpen} />
              </span>
            </a>
            <div className={`pmis-submenu${vmOpen ? " open" : ""}`}>
              {canCreateVendor && (
                <div
                  title="Add Organization"
                  className={addVendorActive ? "active" : ""}
                  onClick={() => navigate("/vendors/new")}
                >
                  <FiPlus size={ICON_SIZE} />
                  <span className="pmis-text">Add Organization</span>
                </div>
              )}
              {canViewVendors && (
                <div
                  title="Search Organization"
                  className={searchVendorActive ? "active" : ""}
                  onClick={() => navigate("/vendors")}
                >
                  <FiSearch size={ICON_SIZE} />
                  <span className="pmis-text">Search Organization</span>
                </div>
              )}
            </div>
          </>
        )}

        {/* User Management */}
        {showUserMgmt && (
          <>
            <a
              title="User Management"
              className={umActive ? "active" : ""}
              onClick={() => setUmOpen(!umOpen)}
            >
              <FiUser size={ICON_SIZE} />
              <span className="pmis-text">User Management</span>
              <span className="pmis-submenu-arrow">
                <Chevron open={umOpen} />
              </span>
            </a>
            <div className={`pmis-submenu${umOpen ? " open" : ""}`}>
              {canCreateUser && (
                <div
                  title="Add User"
                  className={addUserActive ? "active" : ""}
                  onClick={() => navigate("/users/new")}
                >
                  <FiPlus size={ICON_SIZE} />
                  <span className="pmis-text">Add User</span>
                </div>
              )}
              {canViewUsers && (
                <div
                  title="Search User"
                  className={searchUserActive ? "active" : ""}
                  onClick={() => navigate("/users")}
                >
                  <FiSearch size={ICON_SIZE} />
                  <span className="pmis-text">Search User</span>
                </div>
              )}
            </div>
          </>
        )}

        {/* Approval Inbox — visible ONLY to the division_approver role. */}
        {showApprovalInbox && (
          <>
            <a
              title="Approval Inbox"
              className={inboxActive ? "active" : ""}
              onClick={() => setInboxOpen(!inboxOpen)}
            >
              <FiInbox size={ICON_SIZE} />
              <span className="pmis-text">Approval Inbox</span>
              <span className="pmis-submenu-arrow">
                <Chevron open={inboxOpen} />
              </span>
            </a>
            <div className={`pmis-submenu${inboxOpen ? " open" : ""}`}>
              {showCdInbox && (
                <div
                  title="Concerned Division"
                  className={inboxCdActive ? "active" : ""}
                  onClick={() => navigate("/approvals/concerned-division")}
                >
                  <FiUsers size={ICON_SIZE} />
                  <span className="pmis-text">Concerned Division</span>
                </div>
              )}
              {showAoInbox && (
                <div
                  title="Activity Owner"
                  className={inboxAoActive ? "active" : ""}
                  onClick={() => navigate("/approvals/activity-owner")}
                >
                  <FiCheckCircle size={ICON_SIZE} />
                  <span className="pmis-text">Activity Owner</span>
                </div>
              )}
            </div>
          </>
        )}

        {/* Ticket & SLA Management — Create Ticket / All Tickets, mirroring
            Meeting Management. Create is its own page route, not a popup. */}
        <a
          title="Ticket Management"
          className={ticketsActive ? "active" : ""}
          onClick={() => setTmOpen(!tmOpen)}
        >
          <FiTag size={ICON_SIZE} />
          <span className="pmis-text">Ticket Management</span>
          <span className="pmis-submenu-arrow">
            <Chevron open={tmOpen} />
          </span>
        </a>
        <div className={`pmis-submenu${tmOpen ? " open" : ""}`}>
  <div
    title="Create Ticket"
    className={createTicketActive ? "active" : ""}
    onClick={() => navigate("/tickets/new")}
  >
    <FiPlus size={ICON_SIZE} />
    <span className="pmis-text">Create Ticket</span>
  </div>
  {showAllTickets && (
    <div
      title="All Tickets"
      className={allTicketsActive ? "active" : ""}
      onClick={() => navigate("/tickets")}
    >
      <FiSearch size={ICON_SIZE} />
      <span className="pmis-text">All Tickets</span>
    </div>
  )}
</div>

        {/* Assistant — full-page "Aadhaar Genius" chat (no submenu).
            Pinned at the bottom of the menu. */}
        <a
          title="Aadhaar Genius"
          className={assistantActive ? "active" : ""}
          onClick={() => navigate("/assistant")}
        >
          <FiMessageSquare size={ICON_SIZE} />
          <span className="pmis-text">Aadhaar Genius</span>
        </a>
      </div>

      {/* Quick Links — commented out per request.
      <div className="pmis-quicklinks">
        <div className="pmis-quicklinks-head">Quick Links</div>
        <div className="pmis-ql-item" onClick={() => navigate("/approvals/concerned-division")}>
          <FiInbox size={ICON_SIZE} /><span>Approval Inbox</span><span className="pmis-ql-badge">23</span>
        </div>
        <div className="pmis-ql-item" onClick={() => navigate("/tickets")}>
          <FiCheckCircle size={ICON_SIZE} /><span>My Tasks</span><span className="pmis-ql-badge blue">14</span>
        </div>
        <div className="pmis-ql-item" onClick={() => navigate("/tickets")}>
          <FiTag size={ICON_SIZE} /><span>Escalations</span><span className="pmis-ql-badge amber">07</span>
        </div>
        <div className="pmis-ql-item" onClick={() => navigate("/meetings")}>
          <FiCalendar size={ICON_SIZE} /><span>My Meetings</span><span className="pmis-ql-badge green">05</span>
        </div>
      </div>
      */}
    </div>
  );
}
