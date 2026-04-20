// ============================================================
// MainApp.jsx  –  Providers + Router + Routes only
// ============================================================
import { BrowserRouter, Routes, Route } from "react-router-dom";

import { ProjectProvider } from "./store/Projectstore";
import { OnboardProvider } from "./store/Onboardstore";

import Layout from "./layout/Layout";

// ── Page components ────────────────────────────────────────
import HomePage from "./pages/Homepage";
import ProjectTablePage from "./components/ProjectTable";
import ProjectDetails from "./components/ProjectDetails";
import MilestoneConfig from "./components/MilestoneConfig";
import OnboardingForm from "./components/OnboardingForm";
import OnboardingConfig from "./components/Onboardingconfig";
import "./App.css";
import UIDAILogin from "./pages/Uidailogin";
import ResetPassword from "./pages/Resetpassword";
import ActivityPage from "./components/ActivityPage";
import TaskPage from "./components/TaskPage";

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
                  <Layout>
                    <Routes>
                      <Route path="/" element={<Dashboard />} />
                      <Route path="/projects" element={<ProjectTablePage />} />
                      <Route path="/projects/:projectId" element={<ProjectDetails />} />
                      <Route path="/projects/:projectId/config" element={<MilestoneConfig />} />
                      <Route path="/onboard/:category" element={<OnboardingForm />} />
                      <Route path="/onboard/:category/config" element={<OnboardingConfig />} />
                      <Route
                        path="/projects/:projectId/config/milestone/:milestoneUid/activity/:activityUid"
                        element={<ActivityPage />}
                      />

                      {/* NEW — Task page route */}
                      <Route
                        path="/projects/:projectId/config/milestone/:milestoneUid/activity/:activityUid/task/:taskUid"
                        element={<TaskPage />}
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
                }
              />
            </Routes>
          </BrowserRouter>
        </DataProvider>
      </OnboardProvider>
    </ProjectProvider>
  );
}