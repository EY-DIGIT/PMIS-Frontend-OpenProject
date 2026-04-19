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

export default function MainApp() {
  return (
    <ProjectProvider>
      <OnboardProvider>
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
                    <Route path="/" element={<HomePage />} />
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
                  </Routes>
                </Layout>
              }
            />
          </Routes>
        </BrowserRouter>
      </OnboardProvider>
    </ProjectProvider>
  );
}