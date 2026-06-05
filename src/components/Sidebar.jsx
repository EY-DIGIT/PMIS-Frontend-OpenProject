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
  FiChevronDown
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
  const canViewVendors = useCan("viewVendors");
  const canCreateVendor = useCan("createVendor");
  const canViewUsers = useCan("viewUsers");
  const canCreateUser = useCan("createUser");

  // Approval Inbox role gating. division_approver / division_owner are
  // workflow roles that live OUTSIDE rolesConfig, so we read them straight
  // off the user object rather than the normalized identity role.
  // Subscribing to useCurrentRole() keeps this re-rendering on login /
  // logout / role refresh.
  useCurrentRole();
  const currentUser = tokenStore.getUser();
  const isDivisionApprover = userHasRole(currentUser, "division_approver");
  const isActivityOwner = userHasRole(currentUser, "division_owner");
  // A division_approver sees only Concerned Division; a division_owner sees
  // only Activity Owner. Anyone who carries neither workflow role (admins,
  // etc.) keeps seeing both, as before.
  const hasInboxRole = isDivisionApprover || isActivityOwner;
  const showCdInbox = isDivisionApprover || !hasInboxRole;
  const showAoInbox = isActivityOwner || !hasInboxRole;

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
  const divisionDataActive = isUnder("/master/divisions");

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

  // Auto-expand the section that matches the current route so the active
  // child is visible without the user having to click the parent first.
  useEffect(() => {
    if (dashActive) setDashOpen(true);
    if (pmActive) setPmOpen(true);
    if (masterActive) setMdOpen(true);
    if (vmActive) setVmOpen(true);
    if (umActive) setUmOpen(true);
    if (mmActive) setMmOpen(true);
    if (inboxActive) setInboxOpen(true);
  }, [dashActive, pmActive, masterActive, vmActive, umActive, mmActive, inboxActive]);

  const Chevron = ({ open }) =>
    open ? <FiChevronDown size={14} /> : <FiChevronRight size={14} />;

  return (
    <div className={`pmis-sidebar${collapsed ? " collapsed" : ""}`}>
      <div className="pmis-menu">
        {/* Dashboard */}
        {canViewDashboard && (
          <>
            <a
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
                className={summaryActive ? "active" : ""}
                onClick={() => navigate("/dashboard/summary", { state: { tick: Date.now() } })}
              >
                <FiGrid size={ICON_SIZE} />
                <span className="pmis-text">Summary</span>
              </div>
              <div
                className={projectViewActive ? "active" : ""}
                onClick={() => navigate("/dashboard/project", { state: { tick: Date.now() } })}
              >
                <FiFolder size={ICON_SIZE} />
                <span className="pmis-text">Project View</span>
              </div>
              <div
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
                  className={addProjectActive ? "active" : ""}
                  onClick={() => navigate("/projects/add")}
                >
                  <FiPlus size={ICON_SIZE} />
                  <span className="pmis-text">Add Project</span>
                </div>
              )}
              {canViewProjects && (
                <div
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

        {/* Meeting Management — ported from the Meeting_Management.html
            reference. Sub-items: Create Meeting / All Meetings. Routes
            (/meetings/new, /meetings) will need pages wired up in App.jsx;
            until then the links resolve cleanly but render empty. */}
        <a
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
            className={createMeetingActive ? "active" : ""}
            onClick={() => navigate("/meetings/new")}
          >
            <FiPlus size={ICON_SIZE} />
            <span className="pmis-text">Create Meeting</span>
          </div>
          <div
            className={allMeetingsActive ? "active" : ""}
            onClick={() => navigate("/meetings")}
          >
            <FiSearch size={ICON_SIZE} />
            <span className="pmis-text">All Meetings</span>
          </div>
        </div>

        {/* Master Data */}
        {canViewMasterData && (
          <>
            <a
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
                className={vendorDataActive ? "active" : ""}
                onClick={() => navigate("/master/vendors")}
              >
                <FiBriefcase size={ICON_SIZE} />
                <span className="pmis-text">Organization Data</span>
              </div>
              <div
                className={userDataActive ? "active" : ""}
                onClick={() => navigate("/master/users")}
              >
                <FiUsers size={ICON_SIZE} />
                <span className="pmis-text">User Data</span>
              </div>
              {canViewDivisions && (
                <div
                  className={divisionDataActive ? "active" : ""}
                  onClick={() => navigate("/master/divisions")}
                >
                  <FiGrid size={ICON_SIZE} />
                  <span className="pmis-text">Divisions</span>
                </div>
              )}
            </div>
          </>
        )}

        {/* Vendor Management */}
        {showVendorMgmt && (
          <>
            <a
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
                  className={addVendorActive ? "active" : ""}
                  onClick={() => navigate("/vendors/new")}
                >
                  <FiPlus size={ICON_SIZE} />
                  <span className="pmis-text">Add Organization</span>
                </div>
              )}
              {canViewVendors && (
                <div
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
                  className={addUserActive ? "active" : ""}
                  onClick={() => navigate("/users/new")}
                >
                  <FiPlus size={ICON_SIZE} />
                  <span className="pmis-text">Add User</span>
                </div>
              )}
              {canViewUsers && (
                <div
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

        {/* Approval Inbox — role-gated sub-items. A division_approver sees
            only Concerned Division; a division_owner only Activity Owner.
            Users with neither workflow role (admins, etc.) see both. */}
        <a
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
              className={inboxCdActive ? "active" : ""}
              onClick={() => navigate("/approvals/concerned-division")}
            >
              <FiUsers size={ICON_SIZE} />
              <span className="pmis-text">Concerned Division</span>
            </div>
          )}
          {showAoInbox && (
            <div
              className={inboxAoActive ? "active" : ""}
              onClick={() => navigate("/approvals/activity-owner")}
            >
              <FiCheckCircle size={ICON_SIZE} />
              <span className="pmis-text">Activity Owner</span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
