import { useEffect, useMemo, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useData } from '../../data/DataContext';
import MultiSelect from '../../components/MultiSelect';
import CharTextarea from '../../components/CharTextarea';
import { VENDOR_TYPES, PROJECT_OPTIONS } from '../../data/demoData';
import * as vendorsApi from '../../api/vendors';
import * as usersApi from '../../api/users';
import { API_BASE, authorizedFetch, tokenStore } from '../../api/client';
import { ENDPOINTS } from '../../api/endpoint';

const ROLE_LABELS = ['Project Admin', 'Project Member'];

export default function VendorDetails() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { vendors, users, refresh } = useData();
  const fallback = vendors.find((x) => x.vendorId === id) || null;

  const [vendor, setVendor] = useState(fallback);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState('');
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');

  const [name, setName] = useState('');
  const [type, setType] = useState(VENDOR_TYPES[0]);
  const [status, setStatus] = useState('Active');
  const [contact, setContact] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [description, setDescription] = useState('');
  const [mapping, setMapping] = useState([]);
  // Per-project role/user assignments displayed in the Project Mapping table.
  // Shape: [{ projectId, roles: [{ role, userIds: [] }, ...] }]
  const [assignments, setAssignments] = useState([]);

  const [projectList, setProjectList] = useState([]);
  const [userList, setUserList] = useState([]);

  const seed = (v) => {
    setName(v?.vendorName || '');
    setType(v?.vendorType || VENDOR_TYPES[0]);
    setStatus(v?.status || 'Active');
    setContact(v?.contact || '');
    setEmail(v?.email || '');
    setPhone(v?.phone || '');
    setDescription(v?.description || v?.services || '');
    setMapping(Array.isArray(v?.projectIds) && v.projectIds.length
      ? v.projectIds
      : Array.isArray(v?.projectMapping) ? v.projectMapping : []);
    // Seed the assignment table — one project entry per row, each carrying
    // multiple role rows (Admin + Member by default). Backwards-compat:
    // legacy {admins, members} arrays and the older single-role shape are
    // both promoted into the {roles:[{role, userIds}]} structure.
    const normalize = (a) => {
      if (Array.isArray(a?.roles) && a.roles.length) {
        return {
          projectId: a.projectId || '',
          roles: a.roles.map((r) => ({
            role: r?.role || ROLE_LABELS[0],
            userIds: Array.isArray(r?.userIds) ? r.userIds : []
          }))
        };
      }
      // Legacy single-role shape: { projectId, role, userIds }
      if (a && typeof a === 'object' && (a.role || Array.isArray(a.userIds))) {
        return {
          projectId: a.projectId || '',
          roles: [
            { role: a.role || ROLE_LABELS[0], userIds: Array.isArray(a.userIds) ? a.userIds : [] }
          ]
        };
      }
      const admins = Array.isArray(a?.admins) ? a.admins : [];
      const members = Array.isArray(a?.members) ? a.members : [];
      return {
        projectId: a?.projectId || '',
        roles: [
          { role: ROLE_LABELS[0], userIds: admins },
          { role: ROLE_LABELS[1], userIds: members }
        ]
      };
    };
    if (Array.isArray(v?.projectAssignments) && v.projectAssignments.length) {
      setAssignments(v.projectAssignments.map(normalize));
    } else if (Array.isArray(v?.projectIds) && v.projectIds.length) {
      setAssignments(v.projectIds.map((pid) => normalize({ projectId: pid })));
    } else {
      setAssignments([]);
    }
  };

  useEffect(() => {
    if (!id) return;
    if (!tokenStore.get()) {
      setVendor(fallback);
      seed(fallback);
      return;
    }
    let cancelled = false;
    (async () => {
      setLoading(true);
      setLoadError('');
      try {
        const v = await vendorsApi.get(id);
        if (!cancelled) {
          setVendor(v);
          seed(v);
        }
      } catch (err) {
        if (!cancelled) {
          setLoadError(err?.message || 'Failed to load vendor');
          if (fallback) {
            setVendor(fallback);
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
    // Prefer the shared list already loaded by the User Search page so the
    // dropdown shows exactly the same data the user sees there.
    if (Array.isArray(users) && users.length) {
      setUserList(users);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const list = await usersApi.list({ pageSize: 200 });
        if (!cancelled) setUserList(Array.isArray(list) ? list : []);
      } catch {
        if (!cancelled) setUserList([]);
      }
    })();
    return () => { cancelled = true; };
  }, [users]);

  const projectOptions = useMemo(() => {
    if (!tokenStore.get()) {
      return PROJECT_OPTIONS.map((name) => ({ label: name, value: name }));
    }
    return projectList.map((p) => ({
      label: p.name || p.projectCode || p.id,
      value: p.id || p.uuid,
    }));
  }, [projectList]);

  // Quick lookup so the table can render a project's friendly name from its
  // stored UUID without a second pass through projectOptions.
  const projectNameById = useMemo(() => {
    const map = {};
    projectList.forEach((p) => {
      const id = p.id || p.uuid;
      if (id) map[id] = p.name || p.projectCode || id;
    });
    return map;
  }, [projectList]);

  const userOptions = useMemo(
    () =>
      userList.map((u) => {
        const username = u.employeeId || u.login || '';
        const fullName = u.fullName || '';
        const label = username
          ? (fullName ? `${username} (${fullName})` : username)
          : (fullName || u.email || u.userId);
        return { label, value: u.userId };
      }),
    [userList]
  );

  function updateAssignment(idx, patch) {
    setAssignments((prev) => prev.map((a, i) => (i === idx ? { ...a, ...patch } : a)));
  }
  function addAssignmentRow() {
    setAssignments((prev) => [
      ...prev,
      {
        projectId: '',
        roles: ROLE_LABELS.map((label) => ({ role: label, userIds: [] }))
      }
    ]);
  }
  function updateRole(projectIdx, roleIdx, patch) {
    setAssignments((prev) =>
      prev.map((a, i) => {
        if (i !== projectIdx) return a;
        const roles = (a.roles || []).map((r, j) =>
          j === roleIdx ? { ...r, ...patch } : r
        );
        return { ...a, roles };
      })
    );
  }
  function deleteRoleRow(projectIdx, roleIdx) {
    if (!window.confirm('Delete this role row?')) return;
    setAssignments((prev) => {
      const next = prev
        .map((a, i) => {
          if (i !== projectIdx) return a;
          const roles = (a.roles || []).filter((_, j) => j !== roleIdx);
          return { ...a, roles };
        })
        // Drop projects that have no role rows left.
        .filter((a) => Array.isArray(a.roles) && a.roles.length);
      return next;
    });
  }

  const handleEditToggle = async () => {
    if (!editing) {
      setSaveError('');
      setEditing(true);
      return;
    }
    if (saving) return;
    setSaveError('');
    setSaving(true);
    try {
      if (tokenStore.get()) {
        const projectIds = assignments
          .map((a) => a.projectId)
          .filter(Boolean);
        // Flatten the per-project roles tree into one entry per
        // {project, role, users} combination so the payload carries the
        // role label + user IDs alongside the project mapping.
        const flatAssignments = assignments.flatMap((a) =>
          (a.roles || []).map((r) => ({
            projectId: a.projectId || '',
            role: r.role || '',
            userIds: Array.isArray(r.userIds) ? r.userIds : []
          }))
        );
        const updated = await vendorsApi.update(id, {
          name: name.trim(),
          description: description.trim(),
          active: status === 'Active',
          email: email.trim(),
          contact_person: contact.trim(),
          phone_number: phone.trim(),
          projectMapping: projectIds,
          projectAssignments: assignments,
          assignments: flatAssignments
        });
        setVendor(updated);
        seed(updated);
        await refresh();
      }
      setEditing(false);
    } catch (err) {
      setSaveError(err?.message || 'Failed to update vendor');
    } finally {
      setSaving(false);
    }
  };

  const handleCancelEdit = () => {
    seed(vendor);
    setEditing(false);
    setSaveError('');
  };

  if (loading && !vendor) {
    return (
      <>
        <div className="uidai-pmis-title">Vendor Details</div>
        <div className="uidai-pmis-card">
          <p className="uidai-pmis-subtitle">Loading...</p>
        </div>
      </>
    );
  }

  if (!vendor) {
    return (
      <>
        <div className="uidai-pmis-title">Vendor Details</div>
        <div className="uidai-pmis-card">
          <p className="uidai-pmis-subtitle">{loadError || 'Vendor not found.'}</p>
          <button className="uidai-pmis-btn uidai-pmis-btn-cancel" onClick={() => navigate('/vendors')}>Back</button>
        </div>
      </>
    );
  }

  return (
    <>
      <div className="uidai-pmis-title">Vendor Details</div>
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
            <button className="uidai-pmis-btn uidai-pmis-btn-cancel" onClick={() => navigate('/vendors')}>Back</button>
          )}
        </div>
        <h3>Vendor Information</h3>
        <br />
        <div className="uidai-pmis-grid-4">
          <div className="uidai-pmis-field">
            <label>Vendor ID <span className="uidai-pmis-required">*</span></label>
            <input value={vendor.vendorCode || vendor.vendorId} disabled />
          </div>
          <div className="uidai-pmis-field">
            <label>Vendor Name <span className="uidai-pmis-required">*</span></label>
            <input value={name} onChange={(e) => setName(e.target.value)} disabled={!editing} />
          </div>
          <div className="uidai-pmis-field">
            <label>Status <span className="uidai-pmis-required">*</span></label>
            <select value={status} onChange={(e) => setStatus(e.target.value)} disabled={!editing}>
              <option>Active</option>
              <option>Inactive</option>
            </select>
          </div>
          <div className="uidai-pmis-field">
            <label>Contact Person <span className="uidai-pmis-required">*</span></label>
            <input value={contact} onChange={(e) => setContact(e.target.value)} disabled={!editing} />
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
          <div className="uidai-pmis-field uidai-pmis-full">
            <label>Description</label>
            <CharTextarea value={description} onChange={setDescription} disabled={!editing} />
          </div>
        </div>

        <div style={{ marginTop: 18 }}>
          <div className="uidai-project-mapping__header">
            <h4>
              Project Mapping <span className="uidai-pmis-required">*</span>
            </h4>
          </div>
          <div className="uidai-pmis-table-wrap uidai-project-mapping">
            <table className="uidai-pmis-table uidai-pmis-table-compact">
              <thead>
                <tr>
                  <th style={{ width: '30%' }}>Project Name</th>
                  <th style={{ width: '20%' }}>Roles</th>
                  <th>Users</th>
                  <th style={{ width: 140 }}>Action</th>
                </tr>
              </thead>
              <tbody>
                {assignments.length === 0 && (
                  <tr className="uidai-pmis-no-results">
                    <td colSpan={4}>No projects mapped yet. Click Add to add one.</td>
                  </tr>
                )}
                {assignments.map((a, pIdx) => {
                  const projectLabel =
                    projectNameById[a.projectId] ||
                    (a.projectId ? a.projectId : '');
                  const roles = Array.isArray(a.roles) && a.roles.length
                    ? a.roles
                    : [{ role: ROLE_LABELS[0], userIds: [] }];
                  return roles.map((r, rIdx) => {
                    return (
                      <tr
                        key={`${pIdx}-${rIdx}`}
                        className={rIdx === 0 ? 'uidai-pm-project-start' : ''}
                      >
                        {rIdx === 0 && (
                          <td
                            rowSpan={roles.length}
                            className="uidai-pm-project-cell"
                          >
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
                        )}
                        <td>
                          <span>{r.role || '—'}</span>
                        </td>
                        <td>
                          {editing ? (
                            <MultiSelect
                              name={`assign-${pIdx}-${rIdx}`}
                              placeholder="Select User"
                              searchPlaceholder="Search user..."
                              value={r.userIds || []}
                              options={userOptions}
                              onChange={(next) =>
                                updateRole(pIdx, rIdx, { userIds: next })
                              }
                            />
                          ) : (r.userIds || []).length === 0 ? (
                            <span className="uidai-pm-empty-cell">—</span>
                          ) : (
                            <ul className="uidai-pm-user-list">
                              {(r.userIds || []).map((uid) => (
                                <li key={uid}>
                                  {userOptions.find((u) => u.value === uid)?.label || uid}
                                </li>
                              ))}
                            </ul>
                          )}
                        </td>
                        <td className="uidai-pm-actions">
                          {editing ? (
                            <button
                              type="button"
                              className="uidai-pm-action-link uidai-pm-action-link--danger"
                              onClick={() => deleteRoleRow(pIdx, rIdx)}
                            >
                              Delete
                            </button>
                          ) : (
                            <span className="uidai-pm-empty-cell">—</span>
                          )}
                        </td>
                      </tr>
                    );
                  });
                })}
                {editing && (
                  <tr className="uidai-pm-add-row">
                    <td colSpan={4}>
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
    </>
  );
}
