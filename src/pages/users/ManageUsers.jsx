import React, { useState, useRef, useEffect, useCallback } from 'react';
import { useParams, useLocation } from 'react-router-dom';
import '../../styles/ManageUsers.css';
import { API_BASE, authorizedFetch, tokenStore } from '../../api/client';
import { ENDPOINTS } from '../../api/endpoint';

/* ═══════════════════════════════════════════════════════════
   UNIQUE CLASS PREFIX HELPER
   ═══════════════════════════════════════════════════════════ */
const C = (name) => 'qahftrxckafn-' + name;

/* ═══════════════════════════════════════════════════════════
   HELPERS
   ═══════════════════════════════════════════════════════════ */
function escapeAttr(s) {
  return String(s ?? '').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function userFullLabel(uid, userDirectory) {
  const u = userDirectory.find(x => x.id === uid);
  return u ? u.name : uid;
}

function normalizeUsers(rawList) {
  if (!Array.isArray(rawList)) return [];
  return rawList.map(u => {
    const id = u.userId || u.id || u.login || '';
    const username = u.employeeId || u.login || '';
    const fullName = u.fullName || '';
    const name = username
      ? (fullName ? `${username} (${fullName})` : username)
      : (fullName || u.email || id);
    return { id, name };
  }).filter(u => u.id);
}

/* ═══════════════════════════════════════════════════════════
   TOAST
   ═══════════════════════════════════════════════════════════ */
function Toast({ message, type, visible }) {
  return (
    <div
      className={[C('toast'), visible ? C('toast--visible') : '', type ? C('toast--' + type) : ''].filter(Boolean).join(' ')}
      role="status"
      aria-live="polite"
    >
      {message}
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════
   MULTI-SELECT
   ═══════════════════════════════════════════════════════════ */
function MultiSelect({ path, selectedIds, onToggle, userDirectory }) {
  const [isOpen, setIsOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const wrapRef = useRef(null);
  const searchRef = useRef(null);

  const selectedSet = new Set(selectedIds || []);

  useEffect(() => {
    function handleOutsideClick(e) {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) {
        setIsOpen(false);
      }
    }
    if (isOpen) {
      document.addEventListener('click', handleOutsideClick);
      setTimeout(() => searchRef.current?.focus(), 50);
    }
    return () => document.removeEventListener('click', handleOutsideClick);
  }, [isOpen]);

  const filteredUsers = userDirectory.filter(u =>
    !searchQuery || u.name.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const handleToggle = useCallback((uid, checked) => {
    onToggle(path, uid, checked);
    setTimeout(() => setIsOpen(true), 0);
  }, [onToggle, path]);

  return (
    <div
      ref={wrapRef}
      className={[C('ms-wrap'), isOpen ? C('ms-wrap--open') : ''].filter(Boolean).join(' ')}
      data-path={path}
    >
      <button
        type="button"
        className={C('ms-toggle')}
        onClick={() => setIsOpen(o => !o)}
        aria-expanded={isOpen}
        aria-haspopup="listbox"
      >
        <div className={C('ms-display')}>
          {(selectedIds || []).length === 0 ? (
            <span className={C('ms-placeholder')}>Search user...</span>
          ) : (
            (selectedIds || []).map(uid => {
              const label = userFullLabel(uid, userDirectory);
              return (
                <span key={uid} className={C('ms-tag')} title={label}>{label}</span>
              );
            })
          )}
        </div>
        <span className={C('ms-caret')} aria-hidden="true">▾</span>
      </button>

      {isOpen && (
        <div className={C('ms-panel')} onClick={e => e.stopPropagation()}>
          <input
            ref={searchRef}
            type="text"
            className={C('ms-search')}
            placeholder="Search user..."
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            aria-label="Search users"
          />
          <div className={C('ms-options')} role="listbox">
            {filteredUsers.length === 0 ? (
              <div className={C('ms-empty')}>No matching users</div>
            ) : (
              filteredUsers.map(u => {
                const isChecked = selectedSet.has(u.id);
                return (
                  <label
                    key={u.id}
                    className={[C('ms-option'), isChecked ? C('ms-option--checked') : ''].filter(Boolean).join(' ')}
                    data-uid={u.id}
                  >
                    <input
                      type="checkbox"
                      value={u.id}
                      checked={isChecked}
                      onChange={e => handleToggle(u.id, e.target.checked)}
                    />
                    <span>{u.name}</span>
                  </label>
                );
              })
            )}
          </div>
        </div>
      )}
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════
   SECTION TABLE (org user / project owner rows)
   ═══════════════════════════════════════════════════════════ */
function SectionCard({ sectionId, title, subtag, rows, onToggleUser, userDirectory }) {
  return (
    <div className={C('card')} data-section={sectionId}>
      <h2 className={C('card-title')}>
        {title}
        {subtag && <span className={C('card-title__subtag')}>{subtag}</span>}
      </h2>
      <div className={C('table-wrap')}>
        <table className={C('team-table')}>
          <thead>
            <tr>
              <th className={C('team-table__col-role')}>Role</th>
              <th>Users</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={2} className={C('team-table__empty')}>No role assignments.</td>
              </tr>
            ) : (
              rows.map((row, idx) => {
                const path = `section:${sectionId}:${idx}`;
                return (
                  <tr key={`${sectionId}-${idx}`} data-row-idx={idx}>
                    <td data-label="Role">
                      <span className={C('role-pill')} title="Role is fixed and cannot be edited">
                        {row.roleLabel}
                      </span>
                    </td>
                    <td data-label="Users">
                      <MultiSelect
                        path={path}
                        selectedIds={row.users}
                        onToggle={onToggleUser}
                        userDirectory={userDirectory}
                      />
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════
   ACTIVITY LIST — grouped by Milestone
   ═══════════════════════════════════════════════════════════ */
function ActivityList({ activities, onOpen }) {
  // Group by milestone, preserving insertion order
  const groups = [];
  const groupMap = new Map();
  (activities || []).forEach(a => {
    const m = a.milestone || '(Unassigned)';
    if (!groupMap.has(m)) {
      const g = { milestone: m, items: [] };
      groupMap.set(m, g);
      groups.push(g);
    }
    groupMap.get(m).items.push(a);
  });

  if (groups.length === 0) {
    return (
      <div className={C('activity-empty')}>
        No activities defined for this project.
      </div>
    );
  }

  return (
    <div className={C('activity-list')} role="list">
      {groups.map(group => (
        <MilestoneGroup key={group.milestone} group={group} onOpen={onOpen} />
      ))}
    </div>
  );
}

function MilestoneGroup({ group, onOpen }) {
  const count = group.items.length;
  return (
    <section className={C('milestone-group')}>
      <header className={C('milestone-head')}>
        <span className={C('milestone-icon')} aria-hidden="true">📍</span>
        <span className={C('milestone-label')}>Milestone</span>
        <span className={C('milestone-name')}>{group.milestone}</span>
        <span className={C('milestone-count')}>
          {count} {count === 1 ? 'activity' : 'activities'}
        </span>
      </header>
      <div className={C('milestone-items')}>
        {group.items.map(act => (
          <ActivityItem key={act.id} act={act} onOpen={onOpen} />
        ))}
      </div>
    </section>
  );
}

function ActivityItem({ act, onOpen }) {
  return (
    <div
      className={C('activity-item')}
      role="listitem"
      tabIndex={0}
      data-activity-id={act.id}
      onClick={() => onOpen(act.id)}
      onKeyDown={e => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onOpen(act.id);
        }
      }}
      aria-label={`Configure activity ${act.name}`}
    >
      <div className={C('activity-id-name')}>
        <span className={C('activity-id')}>{act.id}</span>
        <span className={C('activity-name')}>{act.name}</span>
      </div>
      <span className={C('activity-arrow')} aria-hidden="true">›</span>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════
   ACTIVITY MODAL
   ═══════════════════════════════════════════════════════════ */
function ActivityModal({ modalState, activities, userDirectory, onClose, onSave, onToggle }) {
  const overlayRef = useRef(null);
  const closeBtnRef = useRef(null);

  const act = modalState ? activities.find(a => a.id === modalState.activityId) : null;
  const divisions = modalState ? (modalState.concernedDivisionsSnapshot || []) : [];

  // Focus close button on open; close on Escape
  useEffect(() => {
    if (!modalState) return;
    const timer = setTimeout(() => closeBtnRef.current?.focus(), 50);
    return () => clearTimeout(timer);
  }, [modalState]);

  useEffect(() => {
    function handleKey(e) {
      if (e.key === 'Escape' && modalState) onClose();
    }
    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, [modalState, onClose]);

  if (!modalState || !act) return null;

  return (
    <div
      ref={overlayRef}
      className={C('modal-overlay')}
      role="dialog"
      aria-modal="true"
      aria-labelledby="actModalTitle"
      onClick={e => { if (e.target === overlayRef.current) onClose(); }}
    >
      <div className={C('modal')}>
        {/* Header */}
        <div className={C('modal-header')}>
          <div className={C('modal-title-block')}>
            <span className={C('modal-eyebrow')}>
              📍 Milestone · {act.milestone || '—'}
            </span>
            <div className={C('modal-title')} id="actModalTitle">
              {act.name}
              <span className={C('modal-title-id')}>{act.id}</span>
            </div>
          </div>
          <button
            ref={closeBtnRef}
            type="button"
            className={C('modal-close')}
            aria-label="Close"
            onClick={onClose}
          >
            ×
          </button>
        </div>

        {/* Body */}
        <div className={C('modal-body')}>
          {/* Activity Owner */}
          <div className={C('modal-field')}>
            <div className={C('modal-field-label')}>Activity Owner</div>
            <div className={C('modal-field-hint')}>
              Pick one or more users responsible for this activity.
            </div>
            <MultiSelect
              path="modal:owner"
              selectedIds={modalState.owner}
              onToggle={onToggle}
              userDirectory={userDirectory}
            />
          </div>

          {/* Concerned Divisions */}
          {divisions.length > 0 ? (
            <>
              <div className={C('modal-divisions-heading')}>Concerned Division Users</div>
              {divisions.map(div => (
                <div key={div} className={C('modal-field')}>
                  <div className={C('modal-field-label')}>
                    <span className={C('division-tag')}>{div}</span>
                    <span className={C('division-field-suffix')}>users</span>
                  </div>
                  <div className={C('modal-field-hint')}>
                    Pick users from <strong>{div}</strong> who will work on this activity.
                  </div>
                  <MultiSelect
                    path={`modal:div:${div}`}
                    selectedIds={modalState.divisionUsers[div] || []}
                    onToggle={onToggle}
                    userDirectory={userDirectory}
                  />
                </div>
              ))}
            </>
          ) : (
            <div className={C('modal-empty-divisions')}>
              <span aria-hidden="true">ℹ️</span>
              <span>
                No Concerned Divisions are set for this activity in{' '}
                <strong>Project Management</strong>. Add divisions there to assign
                division users here.
              </span>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className={C('modal-footer')}>
          <button type="button" className={`${C('btn')} ${C('btn--cancel')}`} onClick={onClose}>
            Cancel
          </button>
          <button type="button" className={C('btn')} onClick={onSave}>
            Save
          </button>
        </div>
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════
   MAIN COMPONENT
   ═══════════════════════════════════════════════════════════ */
export default function ManageTeam() {
  const { id } = useParams();
  const location = useLocation();
  const projectId   = location.state?.projectId   || '';
  const projectName = location.state?.projectName || '';

  /* ── User directory ── */
  const [userDirectory, setUserDirectory] = useState([]);
  const [usersLoading, setUsersLoading] = useState(false);

  useEffect(() => {
    let cancelled = false;
    let pollTimer = null;

    async function fetchUsers() {
      if (cancelled) return;
      const token = tokenStore.get();
      if (!token) { pollTimer = setTimeout(fetchUsers, 200); return; }
      setUsersLoading(true);
      try {
        const res = await authorizedFetch(
          `${API_BASE}${ENDPOINTS.users.list}`,
          { method: 'GET', headers: { accept: 'application/json' } }
        );
        if (!res.ok) return;
        const raw = await res.json().catch(() => ({}));
        const elements =
          raw?.data?._embedded?.elements ??
          raw?._embedded?.elements ??
          raw?.data ??
          (Array.isArray(raw) ? raw : []);
        if (!cancelled) setUserDirectory(normalizeUsers(elements));
      } catch {
        if (!cancelled) setUserDirectory([]);
      } finally {
        if (!cancelled) setUsersLoading(false);
      }
    }

    fetchUsers();
    return () => { cancelled = true; if (pollTimer) clearTimeout(pollTimer); };
  }, []);

  /* ── Page-level team state (orgUser, projectOwner) ── */
  const [teamState, setTeamState] = useState({
    orgUser: [
      { roleLabel: 'Project Admin', users: [] },
      { roleLabel: 'Project User',  users: [] }
    ],
    projectOwner: [{ roleLabel: 'Project Owner', users: [] }]
  });

  /* ── Activities state ── */
  const [activities, setActivities] = useState([
    { id: 'ACT001', name: 'Requirement Collection', milestone: 'Initiation',
      concernedDivisions: ['TMD2'], owner: [], divisionUsers: {} },
    { id: 'ACT002', name: 'Kickoff Preparation',    milestone: 'Initiation',
      concernedDivisions: ['TMD1'], owner: [], divisionUsers: {} },
    { id: 'ACT003', name: 'Configuration Setup',    milestone: 'Execution',
      concernedDivisions: ['TMD2', 'PMO'], owner: [], divisionUsers: {} },
    { id: 'ACT004', name: 'User Acceptance Testing',milestone: 'Execution',
      concernedDivisions: ['TMD1', 'TMD2'], owner: [], divisionUsers: {} },
    { id: 'ACT005', name: 'Go-Live Readiness',      milestone: 'Closure',
      concernedDivisions: ['TMD1'], owner: [], divisionUsers: {} },
    { id: 'ACT006', name: 'Documentation Handover', milestone: 'Closure',
      concernedDivisions: [], owner: [], divisionUsers: {} }
  ]);

  /* ── Modal state ── */
  const [modalState, setModalState] = useState(null);
  const lastFocusRef = useRef(null);

  /* ── Toast ── */
  const [toast, setToast] = useState({ message: '', type: '', visible: false });
  const toastTimerRef = useRef(null);

  const showToast = useCallback((message, type = '') => {
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    setToast({ message, type, visible: true });
    toastTimerRef.current = setTimeout(
      () => setToast(prev => ({ ...prev, visible: false })),
      2400
    );
  }, []);

  /* ── Toggle user (handles both section paths and modal paths) ── */
  const handleToggleUser = useCallback((path, userId, isChecked) => {
    const parts = path.split(':');

    if (parts[0] === 'section') {
      const sectionId = parts[1];
      const rowIdx = parseInt(parts[2], 10);
      setTeamState(prev => {
        const next = { ...prev };
        const sectionRows = [...next[sectionId]];
        const row = { ...sectionRows[rowIdx] };
        const userSet = new Set(row.users);
        isChecked ? userSet.add(userId) : userSet.delete(userId);
        row.users = Array.from(userSet);
        sectionRows[rowIdx] = row;
        next[sectionId] = sectionRows;
        return next;
      });
      return;
    }

    if (parts[0] === 'modal') {
      if (parts[1] === 'owner') {
        setModalState(prev => {
          if (!prev) return prev;
          const set = new Set(prev.owner);
          isChecked ? set.add(userId) : set.delete(userId);
          return { ...prev, owner: Array.from(set) };
        });
        return;
      }
      if (parts[1] === 'div') {
        const division = parts.slice(2).join(':');
        setModalState(prev => {
          if (!prev) return prev;
          const set = new Set(prev.divisionUsers[division] || []);
          isChecked ? set.add(userId) : set.delete(userId);
          return {
            ...prev,
            divisionUsers: { ...prev.divisionUsers, [division]: Array.from(set) }
          };
        });
        return;
      }
    }
  }, []);

  /* ── Open modal ── */
  const handleOpenModal = useCallback((activityId) => {
    const act = activities.find(a => a.id === activityId);
    if (!act) return;
    const concerned = Array.isArray(act.concernedDivisions) ? act.concernedDivisions : [];
    const seedDivUsers = {};
    concerned.forEach(d => {
      seedDivUsers[d] = [...((act.divisionUsers && act.divisionUsers[d]) || [])];
    });
    lastFocusRef.current = document.activeElement;
    document.body.classList.add(C('body--modal-open'));
    setModalState({
      activityId,
      owner: [...(act.owner || [])],
      divisionUsers: seedDivUsers,
      concernedDivisionsSnapshot: [...concerned]
    });
  }, [activities]);

  /* ── Close modal ── */
  const handleCloseModal = useCallback(() => {
    document.body.classList.remove(C('body--modal-open'));
    setModalState(null);
    try { lastFocusRef.current?.focus(); } catch (_) {}
  }, []);

  /* ── Save modal ── */
  const handleSaveModal = useCallback(() => {
    if (!modalState) return;
    const actName = activities.find(a => a.id === modalState.activityId)?.name || '';
    setActivities(prev => prev.map(a => {
      if (a.id !== modalState.activityId) return a;
      const newDivUsers = {};
      (a.concernedDivisions || []).forEach(d => {
        newDivUsers[d] = [...(modalState.divisionUsers[d] || [])];
      });
      return { ...a, owner: [...modalState.owner], divisionUsers: newDivUsers };
    }));
    document.body.classList.remove(C('body--modal-open'));
    setModalState(null);
    try { lastFocusRef.current?.focus(); } catch (_) {}
    showToast(`Saved assignments for "${actName}".`, 'success');
  }, [modalState, activities, showToast]);

  /* ── Go Back ── */
  const handleGoBack = () => {
    if (window.history.length > 1) window.history.back();
    else showToast('Back to project list.');
  };

  /* ── Submit ── */
  const [saving, setSaving] = useState(false);

  const handleSubmit = async () => {
    const missing = [];

    teamState.orgUser.forEach(r => {
      if (!r.users || r.users.length === 0)
        missing.push(`Organization User → ${r.roleLabel}`);
    });
    teamState.projectOwner.forEach(r => {
      if (!r.users || r.users.length === 0)
        missing.push(`Project Owner → ${r.roleLabel}`);
    });
    activities.forEach(a => {
      if (!a.owner || a.owner.length === 0)
        missing.push(`Activity "${a.name}" → Activity Owner`);
      (a.concernedDivisions || []).forEach(d => {
        const users = (a.divisionUsers || {})[d];
        if (!users || users.length === 0)
          missing.push(`Activity "${a.name}" → ${d} users`);
      });
    });

    if (missing.length) {
      const more = missing.length > 1 ? ` (+ ${missing.length - 1} more)` : '';
      showToast(`Please complete: ${missing[0]}${more}`, 'error');
      return;
    }

    if (!tokenStore.get()) {
      showToast('Team saved successfully.', 'success');
      return;
    }

    setSaving(true);
    try {
      const res = await authorizedFetch(
        `${API_BASE}/manage/user`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', accept: 'application/json' },
          body: JSON.stringify({ orgId: id, projectId, projectName, teamState, activities })
        }
      );
      if (!res.ok) {
        const errBody = await res.json().catch(() => ({}));
        throw new Error(errBody?.message || `Request failed (${res.status})`);
      }
      showToast('Team saved successfully.', 'success');
    } catch (err) {
      showToast(err?.message || 'Failed to save team.', 'error');
    } finally {
      setSaving(false);
    }
  };

  /* ── Total activity/milestone count tag ── */
  const milestoneSet = new Set((activities || []).map(a => a.milestone || '(Unassigned)'));
  const actCountTag = `${milestoneSet.size} ${milestoneSet.size === 1 ? 'milestone' : 'milestones'} · ${activities.length} ${activities.length === 1 ? 'activity' : 'activities'}`;

  return (
    <div className={C('manage-team')}>
      <main className={C('content')} id="mainContent" role="main" tabIndex={-1}>

        {/* ─── PAGE HEADER ─── */}
        <div className={C('page-header')}>
          <div className={C('page-header__text')}>
            <div className={C('pm-title')}>Manage Team</div>
            <div className={C('pm-subtitle')}>Roles set. People in.</div>
            <div className={C('pm-description')}>
              Assign users to project roles, then configure ownership for each activity.
              Click any activity below to set its Activity Owner and Concerned Divisions.
            </div>
          </div>
          <div className={C('page-header__actions')}>
            <button
              className={`${C('btn')} ${C('btn--cancel')}`}
              onClick={handleGoBack}
              disabled={saving}
            >
              ← Back
            </button>
            <button
              className={C('btn')}
              onClick={handleSubmit}
              disabled={saving || usersLoading}
            >
              {saving ? 'Saving…' : 'Submit'}
            </button>
          </div>
        </div>

        {/* ─── PROJECT CONTEXT BANNER ─── */}
        <div className={C('card')} aria-label="Project context">
          <div className={C('project-context')}>
            <div className={C('project-context__id-block')}>
              <span className={C('context-label')}>Project ID</span>
              <span className={C('context-id-value')}>{projectId || '—'}</span>
            </div>
            <div className={C('project-context__name-block')}>
              <span className={C('context-label')}>Project Name</span>
              <span className={C('context-name-value')}>{projectName || '—'}</span>
            </div>
          </div>
        </div>

        {usersLoading && (
          <div className={C('card')} style={{ textAlign: 'center', padding: '12px', color: '#888', fontSize: 14 }}>
            Loading users…
          </div>
        )}

        {/* ─── 1. ORGANIZATION USER ─── */}
        <SectionCard
          sectionId="orgUser"
          title="Organization User"
          subtag={null}
          rows={teamState.orgUser}
          onToggleUser={handleToggleUser}
          userDirectory={userDirectory}
        />

        {/* ─── 2. PROJECT OWNER ─── */}
        <SectionCard
          sectionId="projectOwner"
          title="Project Owner"
          subtag="TMD1"
          rows={teamState.projectOwner}
          onToggleUser={handleToggleUser}
          userDirectory={userDirectory}
        />

        {/* ─── 3. ACTIVITIES ─── */}
        <div className={C('card')} data-section="activities">
          <h2 className={C('card-title')}>
            Activities
            <span className={C('card-title__subtag')}>{actCountTag}</span>
          </h2>
          <p className={C('card-subtitle')}>
            Activities are grouped by milestone. Click any activity to assign its
            Activity Owner and the users for each Concerned Division
            (set in <strong>Project Management</strong>).
          </p>
          <ActivityList activities={activities} onOpen={handleOpenModal} />
        </div>

      </main>

      {/* ─── ACTIVITY MODAL ─── */}
      {modalState && (
        <ActivityModal
          modalState={modalState}
          activities={activities}
          userDirectory={userDirectory}
          onClose={handleCloseModal}
          onSave={handleSaveModal}
          onToggle={handleToggleUser}
        />
      )}

      <Toast message={toast.message} type={toast.type} visible={toast.visible} />
    </div>
  );
}