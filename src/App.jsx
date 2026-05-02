// ============================================================
// MainApp.jsx  –  Providers + Router + Routes only
// ============================================================
import { BrowserRouter, Routes, Route, Link, useLocation, Navigate } from "react-router-dom";

import { ProjectProvider } from "./store/Projectstore";
import { OnboardProvider } from "./store/Onboardstore";

import Layout from "./layout/Layout";

// ── Page components ────────────────────────────────────────
import HomePage from "./pages/Homepage";

import "./App.css";
import UIDAILogin from "./pages/Uidailogin";
import ResetPassword from "./pages/ResetPassword";


import { useSessionManager } from "./api/sessionManager";

import VendorList from './pages/vendors/VendorList';
import VendorForm from './pages/vendors/VendorForm';
import VendorDetails from './pages/vendors/VendorDetails';
import UserList from './pages/users/UserList';
import UserForm from './pages/users/UserForm';
import UserDetails from './pages/users/UserDetails';
import MasterOverview from './pages/master/MasterOverview';
import MasterVendors from './pages/master/MasterVendors';
import MasterUsers from './pages/master/MasterUsers';
import { DataProvider } from './data/DataContext';
import "./styles/global.css";

import Dashboard from "./pages/Dashboard";


import ProjectsListPage from "./pages/projects/ProjectsListPage";
import AddProjectPage from "./pages/projects/AddProjectPage";
import ProjectDetailsPage from "./pages/projects/ProjectDetailsPage";
import MilestoneConfigPage from "./pages/projects/MilestoneConfigPage";
import TrackProgressPage from "./pages/projects/TrackProgressPage";
import { useProjects as useProjectsList } from "./store/project/projectsStore";

import "./styles/Project.css"
import "./styles/project/global.css"
import "./styles/project/modals.css"
import "./styles/project/pages.css"
import MessageModal from "./components/projects/modals/MessageModal";
import LoaderModal from "./components/projects/modals/LoaderModal";
import "./styles/project/layout.css"

/* ─────────────────────────────────────────────────────────────
   PageTitle — route-driven page heading. Rendered above the
   breadcrumb so the heading sits at the very top of every page.
   ───────────────────────────────────────────────────────────── */
function PageTitle() {
    const { pathname } = useLocation();
    const segments = pathname.split("/").filter(Boolean);
    if (segments.length === 0) return null; // hide on Dashboard

    let title = "";
    if (segments[0] === "projects") {
        if (segments.length === 1) title = "Project Management";
        else if (segments[1] === "add" && segments[2] === "config") title = "Milestone Configuration";
        else if (segments[1] === "add") title = "Project Management";
        else if (segments[2] === "config") title = "Milestone Configuration";
        else if (segments[2] === "track") title = "Track Progress";
        else title = "Project Details";
    } else if (segments[0] === "vendors") {
        title = "Vendor Management";
    } else if (segments[0] === "users") {
        title = "User Management";
    } else if (segments[0] === "master") {
        if (segments[1] === "vendors") title = "Vendor Data";
        else if (segments[1] === "users") title = "User Data";
        else title = "Master Data";
    }

    if (!title) return null;
    return <div className="uidai-page-title">{title}</div>;
}

/* ─────────────────────────────────────────────────────────────
   Breadcrumbs — auto-built from the current URL.
   Works for every route because it reads useLocation().
   ───────────────────────────────────────────────────────────── */
function Breadcrumbs() {
    const { pathname } = useLocation();
    const projects = useProjectsList();
    const segments = pathname.split("/").filter(Boolean);
    if (segments.length === 0) return null; // hide on Dashboard

    /* Static segment → pretty label. Dynamic params (IDs, UIDs) fall
       through to their raw decoded value. */
    const LABELS = {
        projects: "Projects",
        add: "Add Project",
        config: "Milestone Configuration",
        track: "Track Progress",
        vendors: "Vendors",
        users: "Users",
        master: "Master Data",
        new: "New",
        dashboard: "Dashboard"
    };

    /* Some "new" routes are conceptually a single step from the Dashboard,
       not a sub-page of a parent list. Render them as one breadcrumb item
       with a friendlier label so users see "Home › New User" instead of
       "Home › Users › New". */
    const NEW_ROUTE_OVERRIDES = {
        "/users/new": { to: "/users/new", label: "New User" },
        "/vendors/new": { to: "/vendors/new", label: "New Vendor" }
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

    /* The track-progress route ends with a raw node UID (m-..., a-..., t-...,
       s-...) which is meaningless to users. Strip that trailing segment so
       the breadcrumb stops at "Track Progress". */
    const visibleSegments =
        segments[0] === "projects" && segments[2] === "track" && segments.length > 3
            ? segments.slice(0, 3)
            : segments;

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
                const label = isProjectIdSeg && projectCode
                    ? projectCode
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

export default function MainApp() {
    return (

        <ProjectProvider>
            <OnboardProvider>
                <DataProvider>
                    <BrowserRouter>
                        <Routes>
                            {/* Login route — OUTSIDE Layout */}
                            <Route path="/login" element={<UIDAILogin />} />
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
                                            <Route path="/" element={<Dashboard />} />

                                            <Route path="/projects" element={<ProjectsListPage />} />

                                            {/* Onboarding — step 1 = details, step 2 = milestone config (draft) */}
                                            <Route path="/projects/add" element={<AddProjectPage />} />
                                            <Route
                                                path="/projects/add/config"
                                                element={<MilestoneConfigPage mode="onboarding" />}
                                            />

                                            {/* Existing project — details / config / track */}
                                            <Route path="/projects/:projectId" element={<ProjectDetailsPage />} />
                                            <Route
                                                path="/projects/:projectId/config"
                                                element={<MilestoneConfigPage mode="update" />}
                                            />
                                            <Route path="/projects/:projectId/track" element={<TrackProgressPage />} />
                                            <Route
                                                path="/projects/:projectId/track/:nodeUid"
                                                element={<TrackProgressPage />}
                                            />


                                            {/* Vendors */}
                                            <Route path="vendors" element={<VendorList />} />
                                            <Route path="vendors/new" element={<VendorForm />} />
                                            <Route path="vendors/:id" element={<VendorDetails />} />

                                            {/* Users */}
                                            <Route path="users" element={<UserList />} />
                                            <Route path="users/new" element={<UserForm />} />
                                            <Route path="users/:id" element={<UserDetails />} />

                                            {/* Master Data */}
                                            <Route path="master" element={<MasterOverview />} />
                                            <Route path="master/vendors" element={<MasterVendors />} />
                                            <Route path="master/users" element={<MasterUsers />} />
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