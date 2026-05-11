import { useEffect, useMemo, useState } from 'react';
import { useParams, useNavigate, useLocation } from 'react-router-dom';
import { useData } from '../../data/DataContext';
import MultiSelect from '../../components/MultiSelect';
import CharTextarea from '../../components/CharTextarea';
import { VENDOR_TYPES, PROJECT_OPTIONS } from '../../data/demoData';
import * as vendorsApi from '../../api/vendors';
import * as usersApi from '../../api/users';
import { API_BASE, authorizedFetch, tokenStore } from '../../api/client';
import { ENDPOINTS } from '../../api/endpoint';
import { useCan, useCurrentRole } from '../../auth/permissions';

const ROLE_LABELS = ['Project Admin', 'Project Member'];

// Backend stores role as a snake_case key (`project_admin`/`project_member`)
// while the table renders the human label. Convert at the boundary so the
// PATCH payload matches the API contract.
function roleLabelToKey(label) {
  const s = String(label || '').trim().toLowerCase();
  if (s === 'project admin' || s === 'project_admin') return 'project_admin';
  if (s === 'project member' || s === 'project_member') return 'project_member';
  return s.replace(/\s+/g, '_');
}

export default function VendorDetails() {
  const { id } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  // Page-to-page deep links (e.g. ProjectDetails → "Edit Organization") pass
  // their origin in `location.state.from`, so Back returns to the caller
  // instead of the generic vendor list.
  const backTarget = location.state?.from || '/vendors';
  const { vendors, users, refresh } = useData();
  // Edit gating — only super_admin / admin can mutate organization records
  // (per role spec). For everyone else this page is read-only.
  const canEditVendor = useCan('editVendor');
  const currentRole = useCurrentRole();
  // Org Admins can edit organization records — but only their own — and
  // even within their own org, Name / Status / Description / Type remain
  // read-only. They may only update Contact Person, Email, Mobile Number,
  // and the Project Mapping table.
  //
  // Project Admins reach this page (canEditVendor is true for them) but
  // are limited to managing Project Members on the Project Mapping table —
  // every organization-level field and the Project Admin role rows stay
  // read-only for them.
  const isOrgAdmin = currentRole === 'org_admin';
  const isProjectAdmin = currentRole === 'project_admin';
  // Name / Status / Description are organization-level fields neither role
  // is allowed to change.
  const orgFieldsLocked = isOrgAdmin || isProjectAdmin;
  // Contact / Email / Mobile are open to Org Admins but not Project Admins.
  const contactFieldsLocked = isProjectAdmin;
  // Project Mapping structural edits (project selection, adding new project
  // rows, editing the Project Admin role row, deleting role rows) are
  // off-limits to Project Admins — they only modify Project Member users.
  const mappingStructureLocked = isProjectAdmin;
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
    // Seed the assignment table — every project always renders exactly two
    // role rows in a fixed order: Project Admin then Project Member. Legacy
    // payloads (single-role shape, {admins, members}, or arbitrary `roles`
    // arrays from older saves) get folded into those two static rows by
    // matching role keys; unknown role labels are dropped.
    const normalize = (a) => {
      const userIdsByKey = { project_admin: [], project_member: [] };
      if (Array.isArray(a?.roles)) {
        a.roles.forEach((r) => {
          const key = roleLabelToKey(r?.role);
          if (key in userIdsByKey && Array.isArray(r?.userIds)) {
            userIdsByKey[key] = r.userIds;
          }
        });
      } else if (a && typeof a === 'object' && (a.role || Array.isArray(a.userIds))) {
        const key = roleLabelToKey(a.role);
        if (key in userIdsByKey && Array.isArray(a.userIds)) {
          userIdsByKey[key] = a.userIds;
        }
      }
      if (Array.isArray(a?.admins)) userIdsByKey.project_admin = a.admins;
      if (Array.isArray(a?.members)) userIdsByKey.project_member = a.members;
      return {
        projectId: a?.projectId || '',
        roles: [
          { role: ROLE_LABELS[0], userIds: userIdsByKey.project_admin },
          { role: ROLE_LABELS[1], userIds: userIdsByKey.project_member }
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
    let cancelled = false;
    (async () => {
      try {
        const list = await usersApi.list({ pageSize: 200 });
        // Only adopt a non-empty response — a transient empty payload
        // (auth blip, backend hiccup) shouldn't wipe a list the
        // context-sync effect below has already painted.
        if (!cancelled && Array.isArray(list) && list.length) setUserList(list);
      } catch {
        // Keep whatever was painted from context; failing here shouldn't
        // erase a usable list.
      }
    })();
    return () => { cancelled = true; };
  }, []);

  // Paint from the shared context whenever it updates and our own list
  // is still empty. Covers the race where this page mounts before
  // DataContext's first fetch resolves (first visit after login), and
  // the recovery case where the page-level fetch above failed or
  // returned empty.
  useEffect(() => {
    if (Array.isArray(users) && users.length && userList.length === 0) {
      setUserList(users);
    }
  }, [users, userList.length]);

  const projectOptions = useMemo(() => {
    if (!tokenStore.get()) {
      return PROJECT_OPTIONS.map((name) => ({ label: name, value: name }));
    }
    const seen = new Set();
    const out = [];
    projectList.forEach((p) => {
      const value = p.id || p.uuid;
      if (!value || seen.has(value)) return;
      seen.add(value);
      out.push({ label: p.name || p.projectCode || value, value });
    });
    // Include projects already on this vendor — covers Project Admins
    // whose global /projects list omits projects they aren't a member
    // of, so the current selection still renders by name in the dropdown.
    (Array.isArray(vendor?.projects) ? vendor.projects : []).forEach((p) => {
      const value = p?.id || p?.uuid;
      if (!value || seen.has(value)) return;
      seen.add(value);
      out.push({ label: p.name || p.projectCode || value, value });
    });
    return out;
  }, [projectList, vendor]);

  // Quick lookup so the table can render a project's friendly name from its
  // stored UUID without a second pass through projectOptions. Merge in the
  // vendor's own `projects` array — the global /projects list is filtered
  // by the caller's access (Project Admin only sees their assigned ones),
  // so projects on this vendor that the admin isn't a member of would
  // otherwise fall through to the raw UUID.
  const projectNameById = useMemo(() => {
    const map = {};
    projectList.forEach((p) => {
      const id = p.id || p.uuid;
      if (id) map[id] = p.name || p.projectCode || id;
    });
    (Array.isArray(vendor?.projects) ? vendor.projects : []).forEach((p) => {
      const id = p?.id || p?.uuid;
      if (id && !map[id]) map[id] = p.name || p.projectCode || id;
    });
    return map;
  }, [projectList, vendor]);

  // Merge the global users list with users embedded in the vendor's own
  // user_assignments[].users[]. The embedded set guarantees the Project
  // Mapping table can resolve "login (First Last)" for every currently
  // assigned user, even when the global /users list hasn't loaded yet
  // or doesn't include them (Project Admin role).
  const userOptions = useMemo(() => {
    const byId = new Map();
    const addUser = (u) => {
      if (!u?.userId || byId.has(u.userId)) return;
      const username = u.employeeId || u.login || '';
      const fullName = u.fullName || '';
      const label = username
        ? (fullName ? `${username} (${fullName})` : username)
        : (fullName || u.email || u.userId);
      byId.set(u.userId, { label, value: u.userId });
    };
    userList.forEach(addUser);
    (Array.isArray(vendor?.assignmentUsers) ? vendor.assignmentUsers : []).forEach(addUser);
    return Array.from(byId.values());
  }, [userList, vendor]);

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
  // Roles are static (Project Admin + Project Member) so per-role deletion
  // doesn't apply — Delete removes the entire project mapping.
  function deleteProjectMapping(projectIdx) {
    if (!window.confirm('Remove this project mapping?')) return;
    setAssignments((prev) => prev.filter((_, i) => i !== projectIdx));
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
            role: roleLabelToKey(r.role),
            userIds: Array.isArray(r.userIds) ? r.userIds : []
          }))
        );
        await vendorsApi.update(id, {
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
        // Re-fetch via GET /vendors/:id so the page reflects the
        // server's authoritative state after save (and so the GET
        // request shows up in the network log).
        const fresh = await vendorsApi.get(id);
        setVendor(fresh);
        seed(fresh);
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
        <div className="uidai-pmis-title">Organization Details</div>
        <div className="uidai-pmis-card">
          <p className="uidai-pmis-subtitle">Loading...</p>
        </div>
      </>
    );
  }

  if (!vendor) {
    return (
      <>
        <div className="uidai-pmis-title">Organization Details</div>
        <div className="uidai-pmis-card">
          <p className="uidai-pmis-subtitle">{loadError || 'Organization not found.'}</p>
          <button className="uidai-pmis-btn uidai-pmis-btn-cancel" onClick={() => navigate(backTarget)}>Back</button>
        </div>
      </>
    );
  }

  return (
    <>
      <div className="uidai-pmis-title">Organization Details</div>
      <div className="uidai-pmis-card" style={{paddingTop:"50px"}}>
        <div className="uidai-pmis-card-actions" >
          {canEditVendor && (
            <button className="uidai-pmis-btn"  onClick={handleEditToggle} disabled={saving}>
              <span className="uidai-pmis-btn-text">
                {editing ? (saving ? 'Saving…' : 'Save') : 'Edit'}
              </span>
            </button>
          )}
          {editing ? (
            <button className="uidai-pmis-btn uidai-pmis-btn-cancel" onClick={handleCancelEdit} disabled={saving}>Cancel</button>
          ) : (
            <button className="uidai-pmis-btn uidai-pmis-btn-cancel" onClick={() => navigate(backTarget)}>Back</button>
          )}
        </div>
        <h3>Organization Information</h3>
        <br />
        <div className="uidai-pmis-grid-4">
          <div className="uidai-pmis-field">
            <label>Organization ID <span className="uidai-pmis-required">*</span></label>
            <input value={vendor.vendorCode || vendor.vendorId} disabled />
          </div>
          <div className="uidai-pmis-field">
            <label>Organization Name <span className="uidai-pmis-required">*</span></label>
            <input value={name} onChange={(e) => setName(e.target.value)} disabled={!editing || orgFieldsLocked} />
          </div>
          <div className="uidai-pmis-field">
            <label>Status <span className="uidai-pmis-required">*</span></label>
            <select value={status} onChange={(e) => setStatus(e.target.value)} disabled={!editing || orgFieldsLocked}>
              <option>Active</option>
              <option>Inactive</option>
            </select>
          </div>
          <div className="uidai-pmis-field">
            <label>Contact Person <span className="uidai-pmis-required">*</span></label>
            <input value={contact} onChange={(e) => setContact(e.target.value)} disabled={!editing || contactFieldsLocked} />
          </div>
          <div className="uidai-pmis-field">
            <label>Email <span className="uidai-pmis-required">*</span></label>
            <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} disabled={!editing || contactFieldsLocked} />
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
                disabled={!editing || contactFieldsLocked}
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
            <CharTextarea value={description} onChange={setDescription} disabled={!editing || orgFieldsLocked} />
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
                            {editing && !mappingStructureLocked ? (
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
                          <span>{ROLE_LABELS[rIdx] || r.role || '—'}</span>
                        </td>
                        <td>
                          {editing && (!isProjectAdmin || roleLabelToKey(r.role) === 'project_member') ? (
                            (() => {
                              // A user mapped to this project under another
                              // role (e.g. picked as Project Admin) shouldn't
                              // be selectable again as Project Member for the
                              // same project.
                              const usedByOtherRoles = new Set();
                              (a.roles || []).forEach((other, i) => {
                                if (i === rIdx) return;
                                (other.userIds || []).forEach((uid) =>
                                  usedByOtherRoles.add(uid)
                                );
                              });
                              const availableOptions = userOptions.filter(
                                (u) => !usedByOtherRoles.has(u.value)
                              );
                              return (
                                <MultiSelect
                                  name={`assign-${pIdx}-${rIdx}`}
                                  placeholder="Select User"
                                  searchPlaceholder="Search user..."
                                  value={r.userIds || []}
                                  options={availableOptions}
                                  onChange={(next) =>
                                    updateRole(pIdx, rIdx, { userIds: next })
                                  }
                                />
                              );
                            })()
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
                        {rIdx === 0 && (
                          <td
                            rowSpan={roles.length}
                            className="uidai-pm-actions"
                          >
                            {editing && !mappingStructureLocked ? (
                              <button
                                type="button"
                                className="uidai-pm-action-link uidai-pm-action-link--danger"
                                onClick={() => deleteProjectMapping(pIdx)}
                              >
                                Delete
                              </button>
                            ) : (
                              <span className="uidai-pm-empty-cell">—</span>
                            )}
                          </td>
                        )}
                      </tr>
                    );
                  });
                })}
                {editing && !mappingStructureLocked && (
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
        <div style={{ paddingBottom: 32 }} />
      </div>
    </>
  );
}
