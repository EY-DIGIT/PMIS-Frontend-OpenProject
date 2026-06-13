// ============================================================
// MainApp.jsx  –  Providers + Router + Routes only
// ============================================================
import { Suspense, lazy, useEffect, useState } from "react";
import { BrowserRouter, Routes, Route, Link, useLocation, Navigate } from "react-router-dom";

import { ProjectProvider } from "./store/Projectstore";
import { OnboardProvider } from "./store/Onboardstore";

import Layout from "./layout/Layout";

// ── Page components ────────────────────────────────────────
import HomePage from "./pages/Homepage";
import Profile from "./pages/Profile";

import "./App.css";
import UIDAILogin from "./pages/Uidailogin";
import ResetPassword from "./pages/ResetPassword";
import ForgotPassword from "./pages/ForgotPassword";


import { useSessionManager } from "./api/sessionManager";
import { useCan, useCurrentRole } from "./auth/permissions";

import VendorList from './pages/vendors/VendorList';
import VendorForm from './pages/vendors/VendorForm';
import VendorDetails from './pages/vendors/VendorDetails';
import UserList from './pages/users/UserList';
import UserForm from './pages/users/UserForm';
import UserDetails from './pages/users/UserDetails';
import MasterOverview from './pages/master/MasterOverview';
import MasterVendors from './pages/master/MasterVendors';
import MasterUsers from './pages/master/MasterUsers';
import MasterDivisions from './pages/master/MasterDivisions';
import MasterDivisionForm from './pages/master/MasterDivisionForm';
import ApprovalInboxConcernedDivision from './pages/approvals/ApprovalInboxConcernedDivision';
import ApprovalInboxActivityOwner from './pages/approvals/ApprovalInboxActivityOwner';
import MeetingsListPage from './pages/meetings/MeetingsListPage';
import CreateMeetingPage from './pages/meetings/CreateMeetingPage';
import MeetingDetailPage from './pages/meetings/MeetingDetailPage';
import { DataProvider, useData } from './data/DataContext';
import "./styles/global.css";

// Dashboard pages are lazy-loaded so the heavy charts library only
// ships when the user actually navigates there. The three sidebar
// entries (Summary / Project / Organization) each have their own
// route + component file under src/pages/dashboard/.
const DashboardSummary = lazy(() => import("./pages/dashboard/SummaryView"));
const DashboardProject = lazy(() => import("./pages/dashboard/ProjectView"));
const DashboardOrganization = lazy(() => import("./pages/dashboard/OrganizationView"));


import ProjectsListPage from "./pages/projects/ProjectsListPage";
import AddProjectPage from "./pages/projects/AddProjectPage";
import ProjectDetailsPage from "./pages/projects/ProjectDetailsPage";
import MilestoneConfigPage from "./pages/projects/MilestoneConfigPage";
import TrackProgressPage from "./pages/projects/TrackProgressPage";
import AuditLogsPage from "./pages/projects/AuditLogsPage";
import SeverityPage from "./pages/severity/severity";
import ActivitySlasPage from "./pages/projects/ActivitySlasPage";
import SlaMastersPage from "./pages/sla/SlaMastersPage";
import ProjectFinancePage from "./pages/projects/ProjectFinancePage";
import ActivityStartedListPage from "./pages/projects/ActivityStartedListPage";
import { useProjects as useProjectsList, useProject } from "./store/project/projectsStore";
import * as usersApi from './api/users';
import * as vendorsApi from './api/vendors';
import { tokenStore } from './api/client';

import "./styles/Project.css"
import "./styles/project/global.css"
import "./styles/project/modals.css"
import "./styles/project/activityWorkflow.css"
import "./styles/project/pages.css"
import MessageModal from "./components/projects/modals/MessageModal";
import LoaderModal from "./components/projects/modals/LoaderModal";
import "./styles/project/layout.css"
import ManageTeam from "./pages/users/ManageUsers";
import CriticalPathAnalysis from "./pages/CriticlePath/CriticalPathAnalysis";
import AssistantPage from "./pages/AssistantPage";
import { usePageContext } from "./utils/pageContext";
/* ─────────────────────────────────────────────────────────────
   PageTitle — kept as a no-op stub. All route-driven page headings
   now live in the global navbar (see resolveNavTitle in Layout.jsx)
   so they appear once, in the top bar, instead of above the
   breadcrumb. Left in place so existing render trees that mount
   <PageTitle /> don't need to be touched.
   ───────────────────────────────────────────────────────────── */
function PageTitle() {
    return null;
}

/* ─────────────────────────────────────────────────────────────
   Breadcrumbs — auto-built from the current URL.
   Works for every route because it reads useLocation().
   ───────────────────────────────────────────────────────────── */
function Breadcrumbs() {
    const { pathname,search } = useLocation();
    const projects = useProjectsList();
    const { users, vendors } = useData();
    const pageCtx = usePageContext();
    const segments = pathname.split("/").filter(Boolean);

    /* Static segment → pretty label. Dynamic params (IDs, UIDs) fall
       through to their raw decoded value. */
    const LABELS = {
        projects: "Projects",
        add: "Add Project",
        config: "Milestone Configuration",
        track: "Track Progress",
        "audit-logs": "Audit Logs",
        finance: "Finance",
        "activities-started": "Activity Started List",
        vendors: "Organizations",
        users: "Users",
        divisions: "Divisions",
        master: "Master Data",
        new: "New",
        dashboard: "Dashboard",
        "manage-users": "Manage Team",
        meetings: "Meetings",
        assistant: "Aadhaar Genius"
    };

    /* Some "new" routes are conceptually a single step from the Dashboard,
       not a sub-page of a parent list. Render them as one breadcrumb item
       with a friendlier label so users see "Home › New User" instead of
       "Home › Users › New". */
    const NEW_ROUTE_OVERRIDES = {
        "/users/new": { to: "/users/new", label: "New User" },
        "/vendors/new": { to: "/vendors/new", label: "New Organization" }
    };
    const newRouteOverride = NEW_ROUTE_OVERRIDES[pathname];

    /* Under /projects/:projectId/... segments[1] is the project's id — swap
       to projectCode if we have it in the store. */
    const projectIdSeg =
        segments[0] === "projects" && segments[1] && segments[1] !== "add"
            ? decodeURIComponent(segments[1])
            : null;
    const projectCode = projectIdSeg
        ? (projects.find((p) => p.projectId === projectIdSeg)?.projectCode || "")
        : "";

    /* Under /users/:id segments[1] is the user's id — swap to userCode if
       we have it cached, so the breadcrumb reads "Users › E12345" instead
       of the raw UUID. */
    const userIdSeg =
        segments[0] === "users" && segments[1] && segments[1] !== "new"
            ? decodeURIComponent(segments[1])
            : null;
    const cachedUserCode = userIdSeg
        ? (users.find((u) => u.userId === userIdSeg)?.userCode || "")
        : "";

    // On a hard refresh the DataContext cache is still empty when this
    // renders, which would briefly flash the raw id. Fetch the single
    // user directly so the breadcrumb shows userCode either way.
    const [fetchedUserCode, setFetchedUserCode] = useState("");
    useEffect(() => {
        if (!userIdSeg || cachedUserCode || !tokenStore.get()) {
            setFetchedUserCode("");
            return;
        }
        let cancelled = false;
        (async () => {
            try {
                const u = await usersApi.get(userIdSeg);
                if (!cancelled) setFetchedUserCode(u?.userCode || "");
            } catch {
                if (!cancelled) setFetchedUserCode("");
            }
        })();
        return () => { cancelled = true; };
    }, [userIdSeg, cachedUserCode]);
    const userCode = cachedUserCode || fetchedUserCode;

    /* Under /vendors/:id segments[1] is the vendor's id — swap to
       vendorCode if we have it cached, so the breadcrumb reads
       "Organizations › ORG001" instead of the raw UUID. */
    const vendorIdSeg =
        segments[0] === "vendors" && segments[1] && segments[1] !== "new"
            ? decodeURIComponent(segments[1])
            : null;
    const cachedVendorCode = vendorIdSeg
        ? ((vendors || []).find((v) => v.vendorId === vendorIdSeg)?.vendorCode || "")
        : "";

    // Same hard-refresh fallback as users — fetch the single vendor
    // directly so the breadcrumb resolves vendorCode even when the
    // DataContext cache hasn't populated yet.
    const [fetchedVendorCode, setFetchedVendorCode] = useState("");
    useEffect(() => {
        if (!vendorIdSeg || cachedVendorCode || !tokenStore.get()) {
            setFetchedVendorCode("");
            return;
        }
        let cancelled = false;
        (async () => {
            try {
                const v = await vendorsApi.get(vendorIdSeg);
                if (!cancelled) setFetchedVendorCode(v?.vendorCode || "");
            } catch {
                if (!cancelled) setFetchedVendorCode("");
            }
        })();
        return () => { cancelled = true; };
    }, [vendorIdSeg, cachedVendorCode]);
    const vendorCode = cachedVendorCode || fetchedVendorCode;

    const criticalPathProjectIdSeg =
        segments[0] === "CriticalPathAnalysis" && segments[1]
            ? decodeURIComponent(segments[1])
            : null;
    const criticalPathProject = useProject(criticalPathProjectIdSeg);
    const criticalPathProjectCode = criticalPathProject?.projectCode || "";

    if (segments.length === 0) return null; // hide on Dashboard

    // Project Details (/projects/:projectId) has no sub-pages reachable
    // from the breadcrumb yet — the heading already lives in the navbar,
    // so the lone "Projects › <code>" trail is noise. Hide it for now.
    if (segments[0] === "projects" && segments.length === 2 && segments[1] !== "add") {
        return null;
    }

    if (criticalPathProjectIdSeg) {
        const projectUrl = `/projects/${encodeURIComponent(criticalPathProjectIdSeg)}`;
        return (
            <nav aria-label="breadcrumb" className="uidai-breadcrumbs" style={{
                paddingBottom: "10px",
                background: "#f5f7fa",
                fontSize: 14,
                display: "flex",
                alignItems: "center",
                gap: 6,
                flexWrap: "wrap"
            }}>
                <Link to="/" style={{ color: "#173e77", textDecoration: "none", fontWeight: 500 }}>
                    Home
                </Link>
                <span style={{ color: "#999" }}>›</span>
                <Link to={projectUrl} style={{ color: "#173e77", textDecoration: "none", fontWeight: 500 }}>
                    Project Details
                </Link>
                <span style={{ color: "#999" }}>›</span>
                <span style={{ color: "#333", fontWeight: 600 }}>
                    {criticalPathProjectCode || criticalPathProjectIdSeg}
                </span>
            </nav>
        );
    }

    /* /projects/:projectId/finance — flat trail per spec:
         Home › Project Detail › Finance
       (the leading "Projects" list segment + raw project code are
       intentionally collapsed into a single "Project Detail" link). */
    if (segments[0] === "projects" && segments[2] === "finance") {
        const pid = decodeURIComponent(segments[1]);
        const projectUrl = `/projects/${encodeURIComponent(pid)}`;
        return (
            <nav aria-label="breadcrumb" className="uidai-breadcrumbs" style={{
                paddingBottom: "10px",
                background: "#f5f7fa",
                fontSize: 14,
                display: "flex",
                alignItems: "center",
                gap: 6,
                flexWrap: "wrap"
            }}>
                <Link to="/" style={{ color: "#173e77", textDecoration: "none", fontWeight: 500 }}>
                    Home
                </Link>
                <span style={{ color: "#999" }}>›</span>
                <Link to={projectUrl} style={{ color: "#173e77", textDecoration: "none", fontWeight: 500 }}>
                    Project Detail
                </Link>
                <span style={{ color: "#999" }}>›</span>
                <span style={{ color: "#333", fontWeight: 600 }}>Finance</span>
            </nav>
        );
    }
    /* /projects/:projectId/activity-slas — Map SLA flow. Trail:
         Home › Project Detail › [Milestone] › [Activity] › Map SLA
       The milestone/activity names ride along as query params from the
       launching activity modal (absent on a direct visit, so those crumbs
       are dropped). Milestone/Activity link back to the config page. */
    if (segments[0] === "projects" && segments[2] === "activity-slas") {
        const pid = decodeURIComponent(segments[1]);
        const projectUrl = `/projects/${encodeURIComponent(pid)}`;
        const configUrl = `${projectUrl}/config`;
        const qp = new URLSearchParams(search);
        const msName = qp.get("milestoneName") || "";
        const actName = qp.get("activityName") || "";
        // The launching activity page passes its node uid + mode so we can link
        // the Activity crumb back to THAT activity page (the node edit/view
        // form), not just the milestone list.
        const nodeUid = qp.get("nodeUid") || "";
        const activityMode = qp.get("activityMode") || "edit";
        const activityUrl = nodeUid
            ? `${configUrl}/node?kind=activity&mode=${encodeURIComponent(activityMode)}&nodeUid=${encodeURIComponent(nodeUid)}`
            : configUrl;
        const sep = <span style={{ color: "#999" }}>›</span>;
        const linkStyle = { color: "#173e77", textDecoration: "none", fontWeight: 500 };
        return (
            <nav aria-label="breadcrumb" className="uidai-breadcrumbs" style={{
                paddingBottom: "10px",
                background: "#f5f7fa",
                fontSize: 14,
                display: "flex",
                alignItems: "center",
                gap: 6,
                flexWrap: "wrap"
            }}>
                <Link to="/" style={linkStyle}>Home</Link>
                {sep}
                <Link to={projectUrl} style={linkStyle}>Project Detail</Link>
                {msName && (<>{sep}<Link to={configUrl} style={linkStyle}>{msName}</Link></>)}
                {sep}
                <Link to={activityUrl} style={linkStyle}>{actName || "Activity"}</Link>
                {sep}
                <span style={{ color: "#333", fontWeight: 600 }}>Map SLA</span>
            </nav>
        );
    }

    /* /projects/:projectId/config/node — the milestone/activity/task add &
       edit form rendered full-page. Trail:
         Home › Projects › [code] › Milestone Configuration › Add/Edit <Kind>
       The kind + mode ride along as query params (?kind=&mode=). The
       "Milestone Configuration" crumb links back to the list so the user can
       step from the activity form back up to the milestone page. */
    if (segments[0] === "projects" && segments[2] === "config" && segments[3] === "node") {
        const pid = decodeURIComponent(segments[1]);
        const projectUrl = `/projects/${encodeURIComponent(pid)}`;
        const configUrl = `${projectUrl}/config`;
        const qp = new URLSearchParams(search);
        const kind = qp.get("kind") || "";
        const mode = qp.get("mode") || "add";
        const kindLabel = kind ? kind.charAt(0).toUpperCase() + kind.slice(1) : "Item";
        const modeLabel = mode === "edit" ? "Edit" : mode === "view" ? "View" : "Add";
        const sep = <span style={{ color: "#999" }}>›</span>;
        const linkStyle = { color: "#173e77", textDecoration: "none", fontWeight: 500 };
        return (
            <nav aria-label="breadcrumb" className="uidai-breadcrumbs" style={{
                paddingBottom: "10px",
                background: "#f5f7fa",
                fontSize: 14,
                display: "flex",
                alignItems: "center",
                gap: 6,
                flexWrap: "wrap"
            }}>
                <Link to="/" style={linkStyle}>Home</Link>
                {sep}
                <Link to="/projects" style={linkStyle}>Projects</Link>
                {sep}
                <Link to={projectUrl} style={linkStyle}>{projectCode || pid}</Link>
                {sep}
                <Link to={configUrl} style={linkStyle}>Milestone Configuration</Link>
                {sep}
                <span style={{ color: "#333", fontWeight: 600 }}>{`${modeLabel} ${kindLabel}`}</span>
            </nav>
        );
    }

    /* /manage-users/:projectId — Manage Team is a project sub-page, so the
       trail mirrors Finance: Home › Project Detail › Manage Team. The
       generic logic would otherwise link the "Manage Team" crumb to
       /manage-users (a 404) and never link back to the project. */
    if (segments[0] === "manage-users" && segments[1]) {
        const pid = decodeURIComponent(segments[1]);
        const projectUrl = `/projects/${encodeURIComponent(pid)}`;
        return (
            <nav aria-label="breadcrumb" className="uidai-breadcrumbs" style={{
                paddingBottom: "10px",
                background: "#f5f7fa",
                fontSize: 14,
                display: "flex",
                alignItems: "center",
                gap: 6,
                flexWrap: "wrap"
            }}>
                <Link to="/" style={{ color: "#173e77", textDecoration: "none", fontWeight: 500 }}>
                    Home
                </Link>
                <span style={{ color: "#999" }}>›</span>
                <Link to={projectUrl} style={{ color: "#173e77", textDecoration: "none", fontWeight: 500 }}>
                    Project Detail
                </Link>
                <span style={{ color: "#999" }}>›</span>
                <span style={{ color: "#333", fontWeight: 600 }}>Manage Team</span>
            </nav>
        );
    }

    /* /approvals/* — the Approval Inbox (Concerned Division / Activity
       Owner). The review screen is in-page state on the SAME url, so the
       single "Approval Inbox" crumb is rendered as a link that both
       returns to the list route and signals the page to close any open
       review (via location state — see the inbox pages' effect). */
    if (segments[0] === "approvals") {
        const inboxPath = "/" + segments.slice(0, 2).join("/");
        return (
            <nav aria-label="breadcrumb" className="uidai-breadcrumbs" style={{
                paddingBottom: "10px",
                background: "#f5f7fa",
                fontSize: 14,
                display: "flex",
                alignItems: "center",
                gap: 6,
                flexWrap: "wrap"
            }}>
                <Link to="/" style={{ color: "#173e77", textDecoration: "none", fontWeight: 500 }}>
                    Home
                </Link>
                <span style={{ color: "#999" }}>›</span>
                <Link
                    to={inboxPath}
                    state={{ inboxList: true }}
                    style={{ color: "#333", textDecoration: "none", fontWeight: 600 }}
                >
                    Approval Inbox
                </Link>
            </nav>
        );
    }

    /* The track-progress route ends with a raw node UID (m-..., a-..., t-...,
       s-...) which is meaningless to users. Strip that trailing segment so
       the breadcrumb stops at "Track Progress". */
    const visibleSegments = (() => {
        // Track view: hide deep params under /projects/{id}/track/...
        if (segments[0] === "projects" && segments[2] === "track" && segments.length > 3) {
            return segments.slice(0, 3);
        }
        // Node add/edit page lives at .../config/node — drop the trailing
        // "node" crumb so the trail ends at "Milestone Configuration"
        // (which links back to the list).
        if (segments[0] === "projects" && segments[2] === "config" &&
            segments[segments.length - 1] === "node") {
            return segments.slice(0, -1);
        }
        return segments;
    })();

    return (
        <nav aria-label="breadcrumb" className="uidai-breadcrumbs" style={{
            paddingBottom: "10px",
            background: "#f5f7fa",
            // borderBottom: "1px solid #e0e5ec",
            fontSize: 14,
            display: "flex",
            alignItems: "center",
            gap: 6,
            flexWrap: "wrap"
        }}>
            <Link to="/" style={{ color: "#173e77", textDecoration: "none", fontWeight: 500 }}>
                Home
            </Link>
            {newRouteOverride ? (
                <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                    <span style={{ color: "#999" }}>›</span>
                    <span style={{ color: "#333", fontWeight: 600 }}>{newRouteOverride.label}</span>
                </span>
            ) : visibleSegments.map((seg, i) => {
                const to = "/" + visibleSegments.slice(0, i + 1).join("/");
                const isLast = i === visibleSegments.length - 1;
                const isProjectIdSeg = projectIdSeg && i === 1 && visibleSegments[0] === "projects";
                const isUserIdSeg = userIdSeg && i === 1 && visibleSegments[0] === "users";
                const isVendorIdSeg = vendorIdSeg && i === 1 && visibleSegments[0] === "vendors";
                const isDashboardSub = visibleSegments[0] === "dashboard" && i === 1;
                const DASH_SUB_LABELS = { summary: "Summary", project: "Project View", org: "Organization View" };
                /* /manage-users/:projectId — second segment is the project
                   uuid; swap to projectCode published by ManageUsers into
                   pageContext. Falls back to the cached projects store,
                   then the raw segment. */
                const isMtProjectIdSeg = i === 1 && visibleSegments[0] === "manage-users";
                const mtProjectCode = isMtProjectIdSeg
                    ? (pageCtx && pageCtx.projectCode) ||
                      (projects.find((p) => p.projectId === decodeURIComponent(seg))?.projectCode) ||
                      ""
                    : "";
                    const isMeetingIdSeg=i===1 && visibleSegments[0]==="meetings" && seg!=="new";
                    const meetingName=isMeetingIdSeg?((pageCtx && pageCtx.meetingName) || ""):"";
                const label = isProjectIdSeg && projectCode
                    ? projectCode
                    : isUserIdSeg && userCode
                        ? userCode
                        : isVendorIdSeg && vendorCode
                            ? vendorCode
                            : isMtProjectIdSeg && mtProjectCode
                                ? mtProjectCode
                                :isMeetingIdSeg && meetingName
                                    ? meetingName
                                : isDashboardSub && DASH_SUB_LABELS[seg]
                                    ? DASH_SUB_LABELS[seg]
                                    : (LABELS[seg] || decodeURIComponent(seg));
                return (
                    <span key={to} style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                        <span style={{ color: "#999" }}>›</span>
                        {isLast ? (
                            <span style={{ color: "#333", fontWeight: 600 }}>{label}</span>
                        ) : (
                            <Link to={to} style={{ color: "#173e77", textDecoration: "none", fontWeight: 500 }}>
                                {label}
                            </Link>
                        )}
                    </span>
                );
            })}
        </nav>
    );
}

function SessionManager() {
    useSessionManager();
    return null;
}

function RequireAuth({ children }) {
    const loggedIn = sessionStorage.getItem('uidai_loggedIn') === 'true';
    const location = useLocation();
    if (!loggedIn) {
        return <Navigate to="/login" replace state={{ from: location }} />;
    }
    return (
        <>
            <SessionManager />
            {children}
        </>
    );
}

/* Director Admin only has the Dashboard — bounce them off the home
   page (and any other landing path the navbar Home button might send
   them to) straight into /dashboard/summary so the bare home shell
   never flashes. */
function HomeOrDashboard() {
  const role = useCurrentRole();
  if (role === "director_admin") {
    return <Navigate to="/dashboard/summary" replace />;
  }
  return <HomePage />;
}

/* Gate a route by a single permission flag from src/config/roles.json.
   Renders the child when allowed; otherwise shows a small "no access"
   panel so users get an explanation instead of a silent redirect. */
function RequirePermission({ action, children }) {
    const allowed = useCan(action);
    if (allowed) return children;
    return (
        <div style={{ padding: 32, textAlign: 'center', color: '#5a6680' }}>
            <h2 style={{ marginBottom: 8, color: '#173e77' }}>Access denied</h2>
            <p>Your role does not have permission to view this page.</p>
            <Link to="/" style={{ color: '#173e77' }}>Go to Home</Link>
        </div>
    );
}

export default function MainApp() {
    return (

        <ProjectProvider>
            <OnboardProvider>
                <DataProvider>
                    <BrowserRouter>
                        <Routes>
                            {/* Login route — OUTSIDE Layout */}
                            <Route path="/login" element={<UIDAILogin />} />
                            <Route path="/forgot-password" element={<ForgotPassword />} />
                            <Route path="/reset-password" element={<ResetPassword />} />
                            {/* All other routes — INSIDE Layout */}
                            <Route
                                path="/*"
                                element={
                                    <RequireAuth>
                                        <Layout>
                                            <PageTitle />
                                            <Breadcrumbs />
                                            <Routes>
                                                <Route path="/" element={<HomeOrDashboard />} />
                                                <Route path="/dashboard" element={<Navigate to="/dashboard/summary" replace />} />
                                                <Route
                                                    path="/dashboard/summary"
                                                    element={
                                                        <RequirePermission action="viewDashboard">
                                                            <Suspense fallback={<div style={{ padding: 24, color: "#5a6680" }}>Loading dashboard…</div>}>
                                                                <DashboardSummary />
                                                            </Suspense>
                                                        </RequirePermission>
                                                    }
                                                />
                                                <Route
                                                    path="/dashboard/project"
                                                    element={
                                                        <RequirePermission action="viewDashboard">
                                                            <Suspense fallback={<div style={{ padding: 24, color: "#5a6680" }}>Loading dashboard…</div>}>
                                                                <DashboardProject />
                                                            </Suspense>
                                                        </RequirePermission>
                                                    }
                                                />
                                                <Route
                                                    path="/dashboard/org"
                                                    element={
                                                        <RequirePermission action="viewDashboard">
                                                            <Suspense fallback={<div style={{ padding: 24, color: "#5a6680" }}>Loading dashboard…</div>}>
                                                                <DashboardOrganization />
                                                            </Suspense>
                                                        </RequirePermission>
                                                    }
                                                />
                                                <Route path="/profile" element={<Profile />} />
                                                <Route path="/assistant" element={<AssistantPage />} />

                                                <Route path="/projects" element={<RequirePermission action="viewProjects"><ProjectsListPage /></RequirePermission>} />

                                                {/* Onboarding — step 1 = details, step 2 = milestone config (draft) */}
                                                <Route path="/projects/add" element={<RequirePermission action="createProject"><AddProjectPage /></RequirePermission>} />
                                                <Route
                                                    path="/projects/add/config/*"
                                                    element={<RequirePermission action="createProject"><MilestoneConfigPage mode="onboarding" /></RequirePermission>}
                                                />

                                                {/* Existing project — details / config / track */}
                                                <Route path="/projects/:projectId" element={<RequirePermission action="viewProjects"><ProjectDetailsPage /></RequirePermission>} />
                                                <Route
                                                    path="/projects/:projectId/config/*"
                                                    element={<RequirePermission action="viewProjects"><MilestoneConfigPage mode="update" /></RequirePermission>}
                                                />
                                                <Route path="/projects/:projectId/track" element={<RequirePermission action="viewProjects"><TrackProgressPage /></RequirePermission>} />
                                                <Route
                                                    path="/projects/:projectId/track/:nodeUid"
                                                    element={<RequirePermission action="viewProjects"><TrackProgressPage /></RequirePermission>}
                                                />
                                                <Route
                                                    path="/projects/:projectId/audit-logs"
                                                    element={<RequirePermission action="viewProjects"><AuditLogsPage /></RequirePermission>}
                                                />
                                                <Route path="/projects/:projectId/severity" element={<RequirePermission action="viewProjects"><SeverityPage /></RequirePermission>} />
                                                <Route path="/projects/:projectId/finance" element={<RequirePermission action="viewProjects"><ProjectFinancePage /></RequirePermission>} />
                                                <Route path="/projects/:projectId/activities-started" element={<RequirePermission action="viewProjects"><ActivityStartedListPage /></RequirePermission>} />
                                                <Route path="/projects/:projectId/activity-slas" element={<RequirePermission action="viewProjects"><ActivitySlasPage /></RequirePermission>} />


                                                {/* Vendors */}
                                                <Route path="vendors" element={<RequirePermission action="viewVendors"><VendorList /></RequirePermission>} />
                                                <Route path="vendors/new" element={<RequirePermission action="createVendor"><VendorForm /></RequirePermission>} />
                                                <Route path="vendors/:id" element={<RequirePermission action="viewVendors"><VendorDetails /></RequirePermission>} />

                                                {/* Users */}
                                                <Route path="users" element={<RequirePermission action="viewUsers"><UserList /></RequirePermission>} />
                                                <Route path="users/new" element={<RequirePermission action="createUser"><UserForm /></RequirePermission>} />
                                                <Route path="users/:id" element={<RequirePermission action="viewUsers"><UserDetails /></RequirePermission>} />
                                                <Route path="CriticalPathAnalysis/:id" element={<RequirePermission action="editUser"><CriticalPathAnalysis /></RequirePermission>} />
                                                {/* Master Data */}
                                                <Route path="master" element={<RequirePermission action="viewMasterData"><MasterOverview /></RequirePermission>} />
                                                <Route path="master/vendors" element={<RequirePermission action="viewMasterData"><MasterVendors /></RequirePermission>} />
                                                <Route path="master/users" element={<RequirePermission action="viewMasterData"><MasterUsers /></RequirePermission>} />
                                                <Route path="manage-users/:id" element={<RequirePermission action="createUser"><ManageTeam /></RequirePermission>} />
                                                <Route path="master/divisions" element={<RequirePermission action="viewDivisions"><MasterDivisions /></RequirePermission>} />
                                                <Route path="master/divisions/new" element={<RequirePermission action="createDivision"><MasterDivisionForm /></RequirePermission>} />
                                                <Route path="master/divisions/:code" element={<RequirePermission action="editDivision"><MasterDivisionForm /></RequirePermission>} />
                                                {/* Approval Inbox — gated by role at the data level for now; both sidebar links
                                                    are visible because the role gating isn't wired up yet. */}
                                                <Route path="approvals/concerned-division" element={<ApprovalInboxConcernedDivision />} />
                                                <Route path="approvals/activity-owner" element={<ApprovalInboxActivityOwner />} />

                                                {/* Meeting Management — ported from Meeting_Management.html.
                                                    No role gating yet; everyone with auth can access. */}
                                                <Route path="meetings" element={<MeetingsListPage />} />
                                                <Route path="meetings/new" element={<CreateMeetingPage />} />

                                                {/*SLA Masters*/}
                                                <Route path="sla-masters" element={<SlaMastersPage />} />
                                                <Route path="meetings/:id" element={<MeetingDetailPage />} />
                                            </Routes>
                                        </Layout>
                                    </RequireAuth>
                                }
                            />
                        </Routes>
                        <MessageModal />
                        <LoaderModal />
                    </BrowserRouter>
                </DataProvider>
            </OnboardProvider>
        </ProjectProvider>

    );
}