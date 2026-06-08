import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import * as auth from "../api/auth";
import * as usersApi from "../api/users";
import { getRoleMeta } from "../auth/permissions";
import { readRoleFromUser } from "../auth/roleNormalize";
import "../styles/Profile.css";

const DIVISION_OPTIONS = [
  { code: "tmd1", label: "TMD1" },
  { code: "tmd2", label: "TMD2" },
  { code: "others", label: "Other" },
];

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
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState("");
  const [pwModalOpen, setPwModalOpen] = useState(false);

  const [form, setForm] = useState({
    fullName: "",
    email: "",
    phoneNumber: "",
    division: "tmd1",
    divisionOther: "",
  });

  function seedForm(u) {
    console.log("Seeding form with user", u);
    const fn = u?.fullName || u?.full_name || u?.name || u?.login || "";
    setForm({
      fullName: fn,
      email: u?.email || "",
      phoneNumber: u?.phone_number || "",
      division: (u?.division || "").toLowerCase() || "tmd1",
      divisionOther: u?.divisionOther || "",
    });
  }

  useEffect(() => {
    if (user) seedForm(user);
    let cancelled = false;
    auth
      .me()
      .then((res) => {
        if (cancelled) return;
        const u = res?.data || res;
        if (u && typeof u === "object") {
          setUser(u);
          seedForm(u);
        }
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Role shown on this page = whatever the backend returned on
  // login / verifyOtp / me. The shape varies (string / array of
  // role-assignment objects / single object) — readRoleFromUser
  // collapses all of them to a single role key.
  const orgRoleKey = readRoleFromUser(user) || "";
  const role = getRoleMeta(orgRoleKey)?.label || orgRoleKey || "—";
  const heroDivision = useMemo(() => {
    const d = (user?.division || "").toLowerCase();
    const m = DIVISION_OPTIONS.find((x) => x.code === d);
    return m ? m.label : (user?.division || "—");
  }, [user]);
  const status = user?.status === "active" ? "Active" : user?.status || "—";

  const divisionRequiresOther = (form.division || "").toLowerCase() === "others";

  function update(patch) {
    setForm((f) => ({ ...f, ...patch }));
  }

  async function handleSaveProfile() {
    if (!user?.id) return;
    setSaveError("");
    if (!form.fullName.trim()) { setSaveError("Full Name is required"); return; }
    if (!form.email.trim()) { setSaveError("Email is required"); return; }
    if (!/^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/.test(form.email.trim())) {
      setSaveError("Enter a valid email"); return;
    }
    if (form.phoneNumber && !/^\d{10}$/.test(form.phoneNumber)) {
      setSaveError("Mobile number must be 10 digits"); return;
    }
    if (divisionRequiresOther && !form.divisionOther.trim()) {
      setSaveError("Please specify the division"); return;
    }
    setSaving(true);
    try {
      await usersApi.update(user.id, {
        fullName: form.fullName.trim(),
        email: form.email.trim(),
        phone_number: form.phoneNumber || null,
        division: form.division,
        division_other: divisionRequiresOther ? form.divisionOther.trim() : "",
      });
      // Re-fetch /me to pick up canonical values
      try {
        const fresh = await auth.me();
        const u = fresh?.data || fresh;
        if (u && typeof u === "object") { setUser(u); seedForm(u); }
      } catch { /* fall through */ }
      setEditing(false);
    } catch (err) {
      setSaveError(err?.message || "Could not save profile");
    } finally {
      setSaving(false);
    }
  }

  function toggleEdit() {
    if (editing) {
      handleSaveProfile();
    } else {
      setEditing(true);
      setSaveError("");
    }
  }

  function cancelEdit() {
    seedForm(user);
    setSaveError("");
    setEditing(false);
  }

  const handleSignOut = async () => {
    if (signingOut) return;
    setSigningOut(true);
    try { await auth.logout(); } catch {}
    finally {
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
        <div style={{ display: "flex", gap: 8 }}>
          {editing && (
            <button className="uidai-prof-btn uidai-prof-btn-ghost" type="button" onClick={cancelEdit} disabled={saving}>
              Cancel
            </button>
          )}
          <button className="uidai-prof-btn" type="button" onClick={toggleEdit} disabled={saving}>
            {editing ? (saving ? "Saving…" : "Save") : "Edit Profile"}
          </button>
        </div>
      </div>

      {/* Hero */}
      <section className="uidai-prof-hero">
        <div className="uidai-prof-hero-banner" aria-hidden="true" />
        <div className="uidai-prof-hero-body">
          <div className="uidai-prof-name">{form.fullName || "—"}</div>
          <div className="uidai-prof-tagline">
            <span className="uidai-prof-role-chip">{role}</span>
            <span className="uidai-prof-dot">·</span>
            <span>{heroDivision}</span>
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
                <span className={`uidai-prof-badge ${status === "Active" ? "uidai-prof-badge-green" : "uidai-prof-badge-red"}`}>
                  {status}
                </span>
              </span>
            </div>
          </div>

          <div className="uidai-prof-summary-actions">
            <button
              className="uidai-prof-btn uidai-prof-btn-ghost"
              type="button"
              onClick={() => setPwModalOpen(true)}
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
                    value={form.fullName}
                    onChange={(e) => update({ fullName: e.target.value })}
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
                    value={form.email}
                    onChange={(e) => update({ email: e.target.value })}
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
                      value={form.phoneNumber || ""}
                      onChange={(e) => update({ phoneNumber: e.target.value.replace(/\D/g, "").slice(0, 10) })}
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
                    value={user?.userCode || ""}
                    disabled
                    readOnly
                  />
                </div>
              </div>
              <div className="uidai-prof-row">
                <div className="uidai-prof-row-lbl">Login</div>
                <div className="uidai-prof-row-val">
                  <input
                    className="uidai-prof-control uidai-prof-locked"
                    value={user?.login || ""}
                    disabled
                    readOnly
                  />
                </div>
              </div>
              <div className="uidai-prof-row">
                <div className="uidai-prof-row-lbl">Role</div>
                <div className="uidai-prof-row-val">
                  <input
                    className="uidai-prof-control uidai-prof-locked"
                    value={role}
                    disabled
                    readOnly
                    title="Role is set by an admin"
                  />
                </div>
              </div>
              <div className="uidai-prof-row">
                <div className="uidai-prof-row-lbl">Division</div>
                <div className="uidai-prof-row-val">
                  <select
                    className="uidai-prof-control"
                    value={form.division}
                    onChange={(e) => update({ division: e.target.value })}
                    disabled={!editing}
                  >
                    {DIVISION_OPTIONS.map((d) => (
                      <option key={d.code} value={d.code}>{d.label}</option>
                    ))}
                  </select>
                </div>
              </div>
              {divisionRequiresOther && (
                <div className="uidai-prof-row">
                  <div className="uidai-prof-row-lbl">Specify Division</div>
                  <div className="uidai-prof-row-val">
                    <input
                      className="uidai-prof-control"
                      value={form.divisionOther}
                      onChange={(e) => update({ divisionOther: e.target.value })}
                      disabled={!editing}
                    />
                  </div>
                </div>
              )}
            </div>
            {saveError && (
              <div style={{ color: "#b91c1c", fontSize: 13, marginTop: 8 }}>{saveError}</div>
            )}
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
                <button className="uidai-prof-btn uidai-prof-btn-ghost-small" type="button" onClick={() => navigate("/vendors")}>
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
                <button className="uidai-prof-btn uidai-prof-btn-ghost-small" type="button" onClick={() => navigate("/users")}>
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
                <button className="uidai-prof-btn uidai-prof-btn-ghost-small" type="button" onClick={() => navigate("/projects")}>
                  Open Project Management
                </button>
              </div>
            </section>
          )}
        </div>
      </div>

      {pwModalOpen && (
        <ChangePasswordModal
          userId={user?.id}
          onClose={() => setPwModalOpen(false)}
        />
      )}
    </>
  );
}

/* Inline change-password modal. Mirrors ResetPassword.jsx 4-rule UX but
   posts to PATCH /users/{id}/password with the authenticated session
   instead of a one-time reset token. */
function ChangePasswordModal({ userId, onClose }) {
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showNew, setShowNew] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  const rules = [
    { id: "r1", label: "Minimum 12 characters", test: (v) => v.length >= 12 },
    { id: "r2", label: "Uppercase & lowercase letters", test: (v) => /[a-z]/.test(v) && /[A-Z]/.test(v) },
    { id: "r3", label: "At least 1 number", test: (v) => /\d/.test(v) },
    { id: "r4", label: "At least 1 special character", test: (v) => /[^A-Za-z0-9]/.test(v) },
  ];
  const ruleStates = rules.map((r) => ({ ...r, valid: r.test(newPassword) }));
  const allValid = ruleStates.every((r) => r.valid);
  const matches = confirmPassword.length > 0 && newPassword === confirmPassword;
  const enabled = allValid && matches && !submitting;

  async function submit() {
    if (!enabled || !userId) return;
    setError("");
    setSubmitting(true);
    try {
      await usersApi.updatePassword(userId, newPassword);
      onClose();
    } catch (err) {
      setError(err?.message || "Could not change password");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="uidai-modal" onClick={onClose}>
      <div className="uidai-modal__box" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 480 }}>
        <h3 className="uidai-modal__title">Change Password</h3>
        <div className="uidai-hint" style={{ marginBottom: 12 }}>
          Set a new password for your account. The old session continues until you sign out.
        </div>

        <div className="uidai-prof-row" style={{ display: "block", marginBottom: 10 }}>
          <div className="uidai-prof-row-lbl">New Password</div>
          <div className="uidai-prof-row-val" style={{ position: "relative" }}>
            <input
              className="uidai-prof-control"
              type={showNew ? "text" : "password"}
              placeholder="Enter new password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              autoFocus
            />
            {newPassword && (
              <button
                type="button"
                onClick={() => setShowNew((v) => !v)}
                aria-label={showNew ? "Hide" : "Show"}
                style={{ position: "absolute", right: 8, top: 8, border: "none", background: "transparent", cursor: "pointer", color: "#666" }}
              >
                {showNew ? "🙈" : "👁"}
              </button>
            )}
          </div>
        </div>

        <ul style={{ listStyle: "none", padding: 0, margin: "0 0 12px 0", fontSize: 12.5 }}>
          {ruleStates.map((r) => (
            <li key={r.id} style={{ color: r.valid ? "#1a8a3d" : "#5a6680", marginBottom: 3 }}>
              <span aria-hidden="true">{r.valid ? "✓" : "•"}</span> {r.label}
            </li>
          ))}
        </ul>

        <div className="uidai-prof-row" style={{ display: "block", marginBottom: 10 }}>
          <div className="uidai-prof-row-lbl">Confirm Password</div>
          <div className="uidai-prof-row-val" style={{ position: "relative" }}>
            <input
              className="uidai-prof-control"
              type={showConfirm ? "text" : "password"}
              placeholder="Re-enter new password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
            />
            {confirmPassword && (
              <button
                type="button"
                onClick={() => setShowConfirm((v) => !v)}
                aria-label={showConfirm ? "Hide" : "Show"}
                style={{ position: "absolute", right: 8, top: 8, border: "none", background: "transparent", cursor: "pointer", color: "#666" }}
              >
                {showConfirm ? "🙈" : "👁"}
              </button>
            )}
            {confirmPassword && (
              <div style={{ fontSize: 12, color: matches ? "#1a8a3d" : "#b91c1c", marginTop: 4 }}>
                {matches ? "Passwords match" : "Passwords do not match"}
              </div>
            )}
          </div>
        </div>

        {error && <div style={{ color: "#b91c1c", fontSize: 13, marginBottom: 8 }}>{error}</div>}

        <div className="uidai-modal__actions">
          <button
            type="button"
            className="uidai-prof-btn"
            onClick={submit}
            disabled={!enabled}
          >
            {submitting ? "Saving…" : "Change Password"}
          </button>
          <button type="button" className="uidai-prof-btn uidai-prof-btn-ghost" onClick={onClose} disabled={submitting}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
