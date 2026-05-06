import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import * as auth from "../api/auth";
import "../styles/Profile.css";

const ROLE_OPTIONS = ["Admin", "Manager", "Viewer"];
const DIVISION_OPTIONS = ["TMD1", "TMD2", "Other"];

function formatDateTime(iso) {
  if (!iso) return "—";
  try {
    const d = new Date(iso);
    return d.toLocaleString("en-IN", {
      day: "2-digit",
      month: "short",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      hour12: true,
      timeZone: "Asia/Kolkata",
    });
  } catch {
    return "—";
  }
}

export default function Profile() {
  const navigate = useNavigate();
  const [user, setUser] = useState(auth.getStoredUser() || null);
  const [editing, setEditing] = useState(false);
  const [signingOut, setSigningOut] = useState(false);

  useEffect(() => {
    let cancelled = false;
    auth
      .me()
      .then((res) => {
        if (cancelled) return;
        const u = res?.data || res;
        if (u && typeof u === "object") setUser(u);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  const fullName =
    [user?.firstName, user?.lastName].filter(Boolean).join(" ") ||
    user?.login ||
    "—";
  const role = user?.admin ? "Administrator" : user?.role || "Viewer";
  const division = user?.division || "—";
  const status = user?.status === "active" ? "Active" : user?.status || "—";

  const handleSignOut = async () => {
    if (signingOut) return;
    setSigningOut(true);
    try {
      await auth.logout();
    } catch {
      /* token already cleared */
    } finally {
      setSigningOut(false);
      navigate("/login", { replace: true });
    }
  };

  return (
    <>
      <div className="uidai-prof-page-header">
        <div>
          <div className="uidai-prof-page-title">My Profile</div>
          <p className="uidai-prof-page-subtitle">
            View and manage your account information, role-based access, and
            administrative actions
          </p>
        </div>
        <div>
          <button
            className="uidai-prof-btn"
            type="button"
            onClick={() => setEditing((e) => !e)}
          >
            {editing ? "Done" : "Edit Profile"}
          </button>
        </div>
      </div>

      {/* Hero */}
      <section className="uidai-prof-hero">
        <div className="uidai-prof-hero-banner" aria-hidden="true" />
        <div className="uidai-prof-hero-body">
          <div className="uidai-prof-name">{fullName}</div>
          <div className="uidai-prof-tagline">
            <span className="uidai-prof-role-chip">{role}</span>
            <span className="uidai-prof-dot">·</span>
            <span>{division}</span>
          </div>
        </div>
      </section>

      <div className="uidai-prof-grid">
        {/* LEFT: Account Summary */}
        <aside className="uidai-prof-card uidai-prof-summary">
          <div className="uidai-prof-card-title">
            <span aria-hidden="true">🛡️</span> Account Summary
          </div>

          <div className="uidai-prof-summary-list">
            <div className="uidai-prof-summary-item">
              <span className="uidai-prof-lbl">Role</span>
              <span className="uidai-prof-val">{role}</span>
            </div>
            <div className="uidai-prof-summary-item">
              <span className="uidai-prof-lbl">Last Login</span>
              <span className="uidai-prof-val">
                {user?.updatedAt ? formatDateTime(user.updatedAt) : "—"}
              </span>
            </div>
            <div className="uidai-prof-summary-item">
              <span className="uidai-prof-lbl">Account Status</span>
              <span className="uidai-prof-val">
                <span
                  className={`uidai-prof-badge ${
                    status === "Active"
                      ? "uidai-prof-badge-green"
                      : "uidai-prof-badge-red"
                  }`}
                >
                  {status}
                </span>
              </span>
            </div>
          </div>

          <div className="uidai-prof-summary-actions">
            <button
              className="uidai-prof-btn uidai-prof-btn-ghost"
              type="button"
              onClick={() => navigate("/forgot-password")}
            >
              Change Password
            </button>
            <button
              className="uidai-prof-btn uidai-prof-btn-danger"
              type="button"
              onClick={handleSignOut}
              disabled={signingOut}
            >
              {signingOut ? "Signing Out…" : "Sign Out"}
            </button>
          </div>
        </aside>

        {/* RIGHT: Detail cards */}
        <div className="uidai-prof-detail">
          {/* Personal Information */}
          <section className="uidai-prof-card">
            <div className="uidai-prof-card-title">
              <span aria-hidden="true">👤</span> Personal Information
            </div>
            <div className="uidai-prof-detail-list">
              <div className="uidai-prof-row">
                <div className="uidai-prof-row-lbl">Full Name</div>
                <div className="uidai-prof-row-val">
                  <input
                    className="uidai-prof-control"
                    defaultValue={fullName}
                    disabled={!editing}
                  />
                </div>
              </div>
              <div className="uidai-prof-row">
                <div className="uidai-prof-row-lbl">Email Address</div>
                <div className="uidai-prof-row-val">
                  <input
                    className="uidai-prof-control"
                    type="email"
                    defaultValue={user?.email || ""}
                    disabled={!editing}
                  />
                </div>
              </div>
              <div className="uidai-prof-row">
                <div className="uidai-prof-row-lbl">Mobile Number</div>
                <div className="uidai-prof-row-val">
                  <div className="uidai-prof-phone">
                    <span className="uidai-prof-phone-prefix">+91</span>
                    <input
                      className="uidai-prof-control uidai-prof-phone-num"
                      type="tel"
                      inputMode="numeric"
                      maxLength={10}
                      defaultValue={user?.phoneNumber || ""}
                      disabled={!editing}
                    />
                  </div>
                </div>
              </div>
            </div>
          </section>

          {/* Account & Access */}
          <section className="uidai-prof-card">
            <div className="uidai-prof-card-title">
              <span aria-hidden="true">🔐</span> Account &amp; Access
            </div>
            <div className="uidai-prof-detail-list">
              <div className="uidai-prof-row">
                <div className="uidai-prof-row-lbl">
                  User Code <span title="System-assigned">🔒</span>
                </div>
                <div className="uidai-prof-row-val">
                  <input
                    className="uidai-prof-control uidai-prof-locked"
                    defaultValue={user?.userCode || ""}
                    disabled
                  />
                </div>
              </div>
              <div className="uidai-prof-row">
                <div className="uidai-prof-row-lbl">Login</div>
                <div className="uidai-prof-row-val">
                  <input
                    className="uidai-prof-control uidai-prof-locked"
                    defaultValue={user?.login || ""}
                    disabled
                  />
                </div>
              </div>
              <div className="uidai-prof-row">
                <div className="uidai-prof-row-lbl">Role</div>
                <div className="uidai-prof-row-val">
                  <select
                    className="uidai-prof-control"
                    defaultValue={user?.admin ? "Admin" : "Viewer"}
                    disabled={!editing}
                  >
                    {ROLE_OPTIONS.map((r) => (
                      <option key={r}>{r}</option>
                    ))}
                  </select>
                </div>
              </div>
              <div className="uidai-prof-row">
                <div className="uidai-prof-row-lbl">Division</div>
                <div className="uidai-prof-row-val">
                  <select
                    className="uidai-prof-control"
                    defaultValue={
                      user?.division
                        ? user.division.toUpperCase()
                        : "TMD1"
                    }
                    disabled={!editing}
                  >
                    {DIVISION_OPTIONS.map((d) => (
                      <option key={d}>{d}</option>
                    ))}
                  </select>
                </div>
              </div>
            </div>
          </section>

          {/* Admin Privileges */}
          {user?.admin && (
            <section className="uidai-prof-card">
              <div className="uidai-prof-card-title">
                <span aria-hidden="true">⚙️</span> Admin Privileges
              </div>

              <div className="uidai-prof-admin-row">
                <div className="uidai-prof-admin-left">
                  <div className="uidai-prof-ico-circle" aria-hidden="true">🏢</div>
                  <div>
                    <h4>Vendor Management</h4>
                    <p>Manage vendor records, onboarding details, and the master vendor list across the system.</p>
                  </div>
                </div>
                <button
                  className="uidai-prof-btn uidai-prof-btn-ghost-small"
                  type="button"
                  onClick={() => navigate("/vendors")}
                >
                  Open Vendor Management
                </button>
              </div>

              <div className="uidai-prof-admin-row">
                <div className="uidai-prof-admin-left">
                  <div className="uidai-prof-ico-circle" aria-hidden="true">👥</div>
                  <div>
                    <h4>User Management</h4>
                    <p>Add, edit, deactivate, and assign roles to users across all divisions and projects.</p>
                  </div>
                </div>
                <button
                  className="uidai-prof-btn uidai-prof-btn-ghost-small"
                  type="button"
                  onClick={() => navigate("/users")}
                >
                  Open User Management
                </button>
              </div>

              <div className="uidai-prof-admin-row">
                <div className="uidai-prof-admin-left">
                  <div className="uidai-prof-ico-circle" aria-hidden="true">📁</div>
                  <div>
                    <h4>Project Management</h4>
                    <p>Oversee active and completed projects, manage assignments, and track project-level governance.</p>
                  </div>
                </div>
                <button
                  className="uidai-prof-btn uidai-prof-btn-ghost-small"
                  type="button"
                  onClick={() => navigate("/projects")}
                >
                  Open Project Management
                </button>
              </div>
            </section>
          )}
        </div>
      </div>
    </>
  );
}
