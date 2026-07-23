import { useEffect, useMemo, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useData } from '../../data/DataContext';
import CharTextarea from '../../components/CharTextarea';
import { DIVISION_OPTIONS } from '../../data/demoData';
import * as usersApi from '../../api/users';
import { API_BASE, authorizedFetch, tokenStore } from '../../api/client';
import { ENDPOINTS } from '../../api/endpoint';
import { getRoleMeta, useCurrentRole } from '../../auth/permissions';
import { userHasRole } from '../../auth/roleNormalize';
import * as sessionsApi from '../../api/sessions';
import rolesConfig from '../../config/roles.json';

// Edit is allowed only when the logged-in user's role is strictly higher
// in the hierarchy than the target user's role. super_admin → admin →
// org_admin → project_admin → project_member.
//
// Unknown target roles (workflow-only roles like `division_approver` /
// `division_owner` that aren't part of the user-management hierarchy)
// are treated as below every known role so any logged-in user with a
// known role can still manage them — server enforces the real check.
function canEditTargetRole(currentRole, targetRole) {
  const h = rolesConfig.hierarchy || [];
  const ci = h.indexOf(currentRole);
  if (ci < 0) return false;
  const ti = h.indexOf(targetRole);
  if (ti < 0) return true;
  return ci < ti;
}

export default function UserDetails() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { vendors, users, refresh } = useData();
  const fallback = users.find((x) => x.userId === id) || null;

  // A user must not edit their own record from this screen — the Profile
  // page is the only place that allows self-edit.
  const me = tokenStore.getUser();
  const myId = me?.id || me?.uuid || me?.userId || '';
  const isSelf = !!(myId && id && String(myId) === String(id));
  const currentRole = useCurrentRole();
  /* Session management (#365) is super_admin-only server-side — anyone
     else gets a 403 — so the panel is hidden rather than shown broken. */
  const isSuperAdmin = userHasRole(me, 'super_admin');

  const [user, setUser] = useState(fallback);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState('');
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');

  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  // orgRole reflects whatever was chosen on the Add User page (e.g.
  // "org_admin", "project_admin"). Read-only on this page.
  const [orgRole, setOrgRole] = useState('');
  const [vendorId, setVendorId] = useState('');
  const [division, setDivision] = useState('');
  const [divisionOther, setDivisionOther] = useState('');
  const [status, setStatus] = useState('Active');

  const [divisionList, setDivisionList] = useState([]);

  const seed = (u) => {
    setFullName(u?.fullName || '');
    setEmail(u?.email || '');
    setPhone(u?.phone || '');
    setOrgRole(u?.orgRole || '');
    setVendorId(u?.vendorId || '');
    setDivision(u?.division || '');
    setDivisionOther(u?.divisionOther || '');
    setStatus(u?.status || 'Active');
  };

  useEffect(() => {
    if (!id) return;
    if (!tokenStore.get()) {
      setUser(fallback);
      seed(fallback);
      return;
    }
    let cancelled = false;
    (async () => {
      setLoading(true);
      setLoadError('');
      try {
        const u = await usersApi.get(id);
        if (!cancelled) {
          setUser(u);
          seed(u);
        }
      } catch (err) {
        if (!cancelled) {
          setLoadError(err?.message || 'Failed to load user');
          if (fallback) {
            setUser(fallback);
            seed(fallback);
          }
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  useEffect(() => {
    if (!tokenStore.get()) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await authorizedFetch(
          `${API_BASE}${ENDPOINTS.divisions.list}`,
          { method: 'GET', headers: { accept: 'application/json' } }
        );
        if (!res.ok) return;
        const raw = await res.json().catch(() => ({}));
        const elements =
          raw?.data?._embedded?.elements ??
          raw?._embedded?.elements ??
          raw?.data ??
          [];
        const divisions = (Array.isArray(elements) ? elements : [])
          .filter((d) => d?.code && d?.label)
          .map((d) => ({ code: d.code, label: d.label, requiresOther: !!d.requiresOther }));
        if (!cancelled) setDivisionList(divisions);
      } catch {
        if (!cancelled) setDivisionList([]);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const divisionOptions = useMemo(() => {
    if (!tokenStore.get() || divisionList.length === 0) {
      return DIVISION_OPTIONS.map((d) => ({ code: d, label: d, requiresOther: false }));
    }
    return divisionList;
  }, [divisionList]);

  const selectedDivision = divisionOptions.find((d) => d.code === division);
  const divisionRequiresOther =
    !!selectedDivision &&
    (selectedDivision.requiresOther ||
      String(selectedDivision.label || '').toLowerCase() === 'others' ||
      String(selectedDivision.code || '').toLowerCase() === 'others');

  // Project mapping is shown read-only on this page — names come straight
  // from the user-detail API response (user.projectMapping).
  const mappedProjects = useMemo(
    () => (Array.isArray(user?.projectMapping) ? user.projectMapping : []),
    [user]
  );

  // The global vendors list loads asynchronously via DataContext. Until it
  // arrives, the user's own vendor (returned inline on the user-detail
  // response) must still appear in the dropdown so the prefilled value
  // renders as a name instead of a blank.
  const vendorOptions = useMemo(() => {
    const list = Array.isArray(vendors) ? [...vendors] : [];
    if (user?.vendorId && !list.some((v) => v.vendorId === user.vendorId)) {
      list.unshift({ vendorId: user.vendorId, vendorName: user.vendorName || user.vendorId });
    }
    return list;
  }, [vendors, user]);

  const handleEditToggle = async () => {
    if (!editing) {
      setSaveError('');
      setEditing(true);
      return;
    }
    if (saving) return;
    if (divisionRequiresOther && !divisionOther.trim()) {
      setSaveError('Please specify the division');
      return;
    }
    setSaveError('');
    setSaving(true);
    try {
      if (tokenStore.get()) {
        const updated = await usersApi.update(id, {
          email: email.trim(),
          fullName: fullName.trim(),
          status: status === 'Inactive' ? 'inactive' : 'active',
          vendor_id: vendorId,
          division,
          division_other: divisionRequiresOther ? divisionOther.trim() : null,
          phone_number: phone.trim(),
        });
        setUser(updated);
        seed(updated);
        await refresh();
      }
      setEditing(false);
    } catch (err) {
      setSaveError(err?.message || 'Failed to update user');
    } finally {
      setSaving(false);
    }
  };

  const handleCancelEdit = () => {
    seed(user);
    setEditing(false);
    setSaveError('');
  };

  if (loading && !user) {
    return (
      <>
        <div className="uidai-pmis-title">User Details</div>
        <div className="uidai-pmis-card">
          <p className="uidai-pmis-subtitle">Loading...</p>
        </div>
      </>
    );
  }

  if (!user) {
    return (
      <>
        <div className="uidai-pmis-title">User Details</div>
        <div className="uidai-pmis-card">
          <p className="uidai-pmis-subtitle">{loadError || 'User not found.'}</p>
          <button className="uidai-pmis-btn uidai-pmis-btn-cancel" onClick={() => navigate('/users')}>Back</button>
        </div>
      </>
    );
  }

  return (
    <>
      <div className="uidai-pmis-title">User Details</div>
      <div className="uidai-pmis-card" style={{paddingTop:"50px"}}>
        <div className="uidai-pmis-card-actions">
          {!isSelf && canEditTargetRole(currentRole, orgRole) && (
            <button className="uidai-pmis-btn" onClick={handleEditToggle} disabled={saving}>
              <span className="uidai-pmis-btn-text">
                {editing ? (saving ? 'Saving…' : 'Save') : 'Edit'}
              </span>
            </button>
          )}
          {editing ? (
            <button className="uidai-pmis-btn uidai-pmis-btn-cancel" onClick={handleCancelEdit} disabled={saving}>Cancel</button>
          ) : (
            <button className="uidai-pmis-btn uidai-pmis-btn-cancel" onClick={() => navigate('/users')}>Back</button>
          )}
        </div>
        <h3>User Information</h3>
        <br />
        <div className="uidai-pmis-grid-4">
          <div className="uidai-pmis-field">
            <label>User ID <span className="uidai-pmis-required">*</span></label>
            <input value={user.userCode || user.userId} disabled />
          </div>
          <div className="uidai-pmis-field">
            <label>Full Name <span className="uidai-pmis-required">*</span></label>
            <input value={fullName} onChange={(e) => setFullName(e.target.value)} disabled={!editing} />
          </div>
          <div className="uidai-pmis-field">
            <label>Username <span className="uidai-pmis-required">*</span></label>
            <input value={user.employeeId} disabled />
          </div>
          <div className="uidai-pmis-field">
            <label>Email <span className="uidai-pmis-required">*</span></label>
            <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} disabled={!editing} />
          </div>
          <div className="uidai-pmis-field">
            <label>Mobile Number <span className="uidai-pmis-required">*</span></label>
            <div className="uidai-pmis-phone-input">
              <span className="uidai-pmis-phone-prefix" aria-hidden="true">+91</span>
              <input
                type="tel"
                inputMode="numeric"
                maxLength={10}
                placeholder="10-digit mobile number"
                value={phone}
                autoComplete="tel-national"
                disabled={!editing}
                onChange={(e) => {
                  const cleaned = e.target.value.replace(/\D/g, '').slice(0, 10);
                  setPhone(cleaned);
                }}
                onKeyPress={(e) => {
                  if (e.key.length === 1 && !/[0-9]/.test(e.key)) e.preventDefault();
                }}
              />
            </div>
          </div>
          <div className="uidai-pmis-field">
            <label>Role</label>
            <input
              value={getRoleMeta(orgRole)?.label || orgRole || '—'}
              disabled
            />
          </div>
          <div className="uidai-pmis-field">
            <label>Organization <span className="uidai-pmis-required">*</span></label>
            <select value={vendorId} onChange={(e) => setVendorId(e.target.value)} disabled={!editing}>
              <option value="" disabled>Select Organization</option>
              {vendorOptions.map((v) => (
                <option key={v.vendorId} value={v.vendorId}>{v.vendorName}</option>
              ))}
            </select>
          </div>
          <div className="uidai-pmis-field">
            <label>Division <span className="uidai-pmis-required">*</span></label>
            <select
              value={division}
              onChange={(e) => {
                const next = e.target.value;
                setDivision(next);
                const nextDiv = divisionOptions.find((d) => d.code === next);
                const stillNeedsOther =
                  !!nextDiv &&
                  (nextDiv.requiresOther ||
                    String(nextDiv.label || '').toLowerCase() === 'others' ||
                    String(nextDiv.code || '').toLowerCase() === 'others');
                if (!stillNeedsOther) setDivisionOther('');
              }}
              disabled={!editing}
            >
              <option value="" disabled>Select Division</option>
              {divisionOptions.map((d) => (
                <option key={d.code} value={d.code}>{d.label}</option>
              ))}
            </select>
          </div>
          {divisionRequiresOther && (
            <div className="uidai-pmis-field">
              <label>Specify Division <span className="uidai-pmis-required">*</span></label>
              <input value={divisionOther} onChange={(e) => setDivisionOther(e.target.value)} disabled={!editing} />
            </div>
          )}
          <div className="uidai-pmis-field">
            <label>Status <span className="uidai-pmis-required">*</span></label>
            <select value={status} onChange={(e) => setStatus(e.target.value)} disabled={!editing}>
              <option>Active</option>
              <option>Inactive</option>
            </select>
          </div>
        </div>

        <div style={{ marginTop: 18 }}>
          <div className="uidai-project-mapping__header">
            <h4>Project Mapping</h4>
          </div>
          <div className="uidai-pmis-table-wrap uidai-project-mapping">
            <table className="uidai-pmis-table uidai-pmis-table-compact">
              <thead>
                <tr>
                  <th>Project Name</th>
                </tr>
              </thead>
              <tbody>
                {mappedProjects.length === 0 ? (
                  <tr className="uidai-pmis-no-results">
                    <td>No projects mapped.</td>
                  </tr>
                ) : (
                  mappedProjects.map((name, pIdx) => (
                    <tr key={pIdx} className="uidai-pm-project-start">
                      <td className="uidai-pm-project-cell">
                        <span>{name || <span className="uidai-pm-empty-cell">—</span>}</span>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>

        {saveError && <div className="uidai-error-msg" style={{ marginTop: 8 }}>{saveError}</div>}
        {loadError && !saveError && <div className="uidai-error-msg" style={{ marginTop: 8 }}>{loadError}</div>}
      </div>

      {isSuperAdmin && <ActiveSessionsPanel userId={id} />}

      <div className="uidai-pmis-card">
        <h3>Remarks</h3>
        <br />
        <div className="uidai-pmis-grid">
          <div className="uidai-pmis-field uidai-pmis-full">
            <CharTextarea
              value="Access aligned to role-based permissions."
              disabled
            />
          </div>
        </div>
      </div>
    </>
  );
}

function fmtSessionTime(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return String(iso);
  return d.toLocaleString();
}

/* ─────────────────────────────────────────────────────────────────
   ActiveSessionsPanel — the target user's live sessions, with a
   per-session and an all-sessions revoke (#365).

   Revocation is an instant hard cut: the user's current access token
   stops working immediately, not at the next refresh — hence the
   confirmations. Rendered only for super_admin; every other role gets
   a 403 from all three routes.
   ───────────────────────────────────────────────────────────────── */
function ActiveSessionsPanel({ userId }) {
  const [sessions, setSessions] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [busyId, setBusyId] = useState('');
  const [revokingAll, setRevokingAll] = useState(false);

  async function load() {
    if (!userId) return;
    setLoading(true);
    setError('');
    try {
      setSessions(await sessionsApi.listSessions(userId));
    } catch (err) {
      setSessions([]);
      setError(err?.message || 'Failed to load sessions');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (tokenStore.get()) load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId]);

  async function handleRevoke(s) {
    if (!window.confirm('Revoke this session? The user is signed out immediately.')) return;
    setBusyId(s.sessionId);
    setError('');
    try {
      await sessionsApi.revokeSession(userId, s.sessionId);
      await load();
    } catch (err) {
      setError(err?.message || 'Failed to revoke session');
    } finally {
      setBusyId('');
    }
  }

  async function handleRevokeAll() {
    if (!window.confirm('Revoke ALL sessions for this user? They are signed out everywhere immediately.')) return;
    setRevokingAll(true);
    setError('');
    try {
      const revoked = await sessionsApi.revokeAllSessions(userId);
      await load();
      window.alert(`${revoked} session${revoked === 1 ? '' : 's'} revoked.`);
    } catch (err) {
      setError(err?.message || 'Failed to revoke sessions');
    } finally {
      setRevokingAll(false);
    }
  }

  return (
    <div className="uidai-pmis-card">
      <div className="uidai-pmis-card-actions">
        <button
          type="button"
          className="uidai-pmis-btn uidai-pmis-btn-cancel"
          onClick={load}
          disabled={loading || revokingAll}
        >
          {loading ? 'Refreshing…' : 'Refresh'}
        </button>
        <button
          type="button"
          className="uidai-pmis-btn"
          onClick={handleRevokeAll}
          disabled={revokingAll || loading || sessions.length === 0}
        >
          {revokingAll ? 'Revoking…' : 'Revoke All'}
        </button>
      </div>
      <h3>Active Sessions</h3>
      <p className="uidai-pmis-subtitle" style={{ marginTop: 4 }}>
        Revoking is immediate — the affected access token is rejected on the very
        next request.
      </p>

      {error && (
        <div className="uidai-error-msg" style={{ marginTop: 8 }}>{error}</div>
      )}

      <div className="uidai-pmis-table-wrap" style={{ marginTop: 12 }}>
        <table className="uidai-pmis-table uidai-pmis-table-compact">
          <thead>
            <tr>
              <th>Session</th>
              <th>Signed In</th>
              <th>Last Used</th>
              <th>Expires</th>
              <th>Action</th>
            </tr>
          </thead>
          <tbody>
            {loading && sessions.length === 0 ? (
              <tr className="uidai-pmis-no-results"><td colSpan={5}>Loading…</td></tr>
            ) : sessions.length === 0 ? (
              <tr className="uidai-pmis-no-results"><td colSpan={5}>No active sessions.</td></tr>
            ) : (
              sessions.map((s) => (
                <tr key={s.sessionId}>
                  <td title={s.sessionId} style={{ fontFamily: 'monospace', fontSize: 12 }}>
                    {s.sessionId.length > 12 ? `${s.sessionId.slice(0, 12)}…` : s.sessionId}
                  </td>
                  <td>{fmtSessionTime(s.issuedAt)}</td>
                  <td>{fmtSessionTime(s.lastUsedAt)}</td>
                  <td>{fmtSessionTime(s.expiresAt)}</td>
                  <td>
                    <button
                      type="button"
                      className="uidai-pmis-btn uidai-pmis-btn-small"
                      onClick={() => handleRevoke(s)}
                      disabled={busyId === s.sessionId || revokingAll}
                    >
                      {busyId === s.sessionId ? 'Revoking…' : 'Revoke'}
                    </button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
