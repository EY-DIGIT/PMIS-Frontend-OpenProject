import { useEffect, useMemo, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useData } from '../../data/DataContext';
import CharTextarea from '../../components/CharTextarea';
import { DIVISION_OPTIONS, PROJECT_OPTIONS } from '../../data/demoData';
import * as usersApi from '../../api/users';
import { API_BASE, authorizedFetch, tokenStore } from '../../api/client';
import { ENDPOINTS } from '../../api/endpoint';
import { getRoleMeta } from '../../auth/permissions';

function splitName(n) {
  const parts = (n || '').trim().split(/\s+/);
  return { firstName: parts[0] || '', lastName: parts.slice(1).join(' ') };
}

export default function UserDetails() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { vendors, users, refresh } = useData();
  const fallback = users.find((x) => x.userId === id) || null;

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
  // Project assignments — one row per project. No per-project role,
  // no per-project user picks; just the project the user is mapped to.
  // Shape: [{ projectId }]
  const [assignments, setAssignments] = useState([]);

  const [projectList, setProjectList] = useState([]);
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
    // Seed assignments — accept legacy shapes (with roles[]/userIds) and
    // collapse to just { projectId }. Per-project role and per-project
    // user picks have both been removed from this page.
    const normalize = (a) => ({ projectId: a?.projectId || '' });
    if (Array.isArray(u?.projectAssignments) && u.projectAssignments.length) {
      setAssignments(u.projectAssignments.map(normalize));
    } else if (Array.isArray(u?.projectIds) && u.projectIds.length) {
      setAssignments(u.projectIds.map((pid) => normalize({ projectId: pid })));
    } else {
      setAssignments([]);
    }
  };

  function updateAssignment(idx, patch) {
    setAssignments((prev) => prev.map((a, i) => (i === idx ? { ...a, ...patch } : a)));
  }
  function addAssignmentRow() {
    setAssignments((prev) => [...prev, { projectId: '' }]);
  }
  function deleteAssignmentRow(idx) {
    if (!window.confirm('Delete this project mapping?')) return;
    setAssignments((prev) => prev.filter((_, i) => i !== idx));
  }

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
          `${API_BASE}${ENDPOINTS.projects.list}?offset=1&pageSize=100`,
          { method: 'GET', headers: { accept: 'application/json' } }
        );
        if (!res.ok) return;
        const raw = await res.json().catch(() => ({}));
        const elements =
          raw?.data?._embedded?.elements ??
          raw?._embedded?.elements ??
          raw?.data ??
          [];
        if (!cancelled && Array.isArray(elements)) setProjectList(elements);
      } catch {
        if (!cancelled) setProjectList([]);
      }
    })();
    return () => { cancelled = true; };
  }, []);

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

  const projectOptions = useMemo(() => {
    if (!tokenStore.get()) {
      return PROJECT_OPTIONS.map((name) => ({ label: name, value: name }));
    }
    return projectList.map((p) => ({
      label: p.name || p.projectCode || p.id,
      value: p.id || p.uuid,
    }));
  }, [projectList]);

  const projectNameById = useMemo(() => {
    const map = {};
    projectList.forEach((p) => {
      const id = p.id || p.uuid;
      if (id) map[id] = p.name || p.projectCode || id;
    });
    return map;
  }, [projectList]);

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
        const { firstName, lastName } = splitName(fullName);
        const projectIds = assignments.map((a) => a.projectId).filter(Boolean);
        const updated = await usersApi.update(id, {
          email: email.trim(),
          firstName,
          lastName,
          status: status === 'Inactive' ? 'inactive' : 'active',
          vendor_id: vendorId,
          division,
          division_other: divisionRequiresOther ? divisionOther.trim() : null,
          phone_number: phone.trim(),
          project_ids: projectIds,
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
      <div className="uidai-pmis-card">
        <div className="uidai-pmis-card-actions">
          <button className="uidai-pmis-btn" onClick={handleEditToggle} disabled={saving}>
            <span className="uidai-pmis-btn-icon">{editing ? '💾' : '✏️'}</span>{' '}
            <span className="uidai-pmis-btn-text">
              {editing ? (saving ? 'Saving…' : 'Save') : 'Edit'}
            </span>
          </button>
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
              {vendors.map((v) => (
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
                  <th style={{ width: 140 }}>Action</th>
                </tr>
              </thead>
              <tbody>
                {assignments.length === 0 && (
                  <tr className="uidai-pmis-no-results">
                    <td colSpan={2}>
                      No projects mapped yet{editing ? '. Click Add to add one.' : '.'}
                    </td>
                  </tr>
                )}
                {assignments.map((a, pIdx) => {
                  const projectLabel =
                    projectNameById[a.projectId] ||
                    (a.projectId ? a.projectId : '');
                  return (
                    <tr key={pIdx} className="uidai-pm-project-start">
                      <td className="uidai-pm-project-cell">
                        {editing ? (
                          <select
                            className="uidai-pmis-filter-select"
                            value={a.projectId}
                            onChange={(e) =>
                              updateAssignment(pIdx, { projectId: e.target.value })
                            }
                          >
                            <option value="">— Select Project —</option>
                            {projectOptions
                              .filter(
                                (p) =>
                                  p.value === a.projectId ||
                                  !assignments.some(
                                    (other, i) =>
                                      i !== pIdx && other.projectId === p.value
                                  )
                              )
                              .map((p) => (
                                <option key={p.value} value={p.value}>
                                  {p.label}
                                </option>
                              ))}
                          </select>
                        ) : (
                          <span>
                            {projectLabel || <span className="uidai-pm-empty-cell">—</span>}
                          </span>
                        )}
                      </td>
                      <td className="uidai-pm-actions">
                        {editing ? (
                          <button
                            type="button"
                            className="uidai-pm-action-link uidai-pm-action-link--danger"
                            onClick={() => deleteAssignmentRow(pIdx)}
                          >
                            Delete
                          </button>
                        ) : (
                          <span className="uidai-pm-empty-cell">—</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
                {editing && (
                  <tr className="uidai-pm-add-row">
                    <td colSpan={2}>
                      <button
                        type="button"
                        className="uidai-pmis-btn uidai-pmis-btn-small"
                        onClick={addAssignmentRow}
                      >
                        + Add
                      </button>
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

        {saveError && <div className="uidai-error-msg" style={{ marginTop: 8 }}>{saveError}</div>}
        {loadError && !saveError && <div className="uidai-error-msg" style={{ marginTop: 8 }}>{loadError}</div>}
      </div>

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
