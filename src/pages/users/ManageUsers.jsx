import React, { useState, useEffect, useRef, useLayoutEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  getTeamPage,
  updateTeamPage,
  listUsersByProjectOrg,
  listUsersByDivision
} from '../../api/teamPage';
import { setPageContext, clearPageContext } from '../../utils/pageContext';
import './ManageTeam.css';

/* Build a {id, name} record the MultiSelect understands from a raw
   associated-user. Backend ships `firstName`/`lastName`/`login`/`email`
   in a mix; coalesce to the friendliest label we have. */
function normalizeAssociatedUser(u) {
  if (!u || !u.id) return null;
  const first = (u.firstName || '').trim();
  const last = (u.lastName || '').trim();
  const full = `${first} ${last}`.trim();
  const name = full || u.login || u.email || u.id;
  return { id: String(u.id), name: String(name) };
}

function normalizeUsersList(list) {
  if (!Array.isArray(list)) return [];
  const seen = new Set();
  const out = [];
  list.forEach((u) => {
    const norm = normalizeAssociatedUser(u);
    if (!norm) return;
    if (seen.has(norm.id)) return;
    seen.add(norm.id);
    out.push(norm);
  });
  return out;
}

/* ──────────────────────────────────────────────────────────
   STATIC ROLE DEFINITIONS — single source of truth for the UI.
   `roleLabel` is the canonical key sent to / received from the API.
   `displayLabel` (optional) is what we render in the UI.
   `single` is true for radio-like (one user) selectors.
   To add / rename / reorder roles, edit just these two arrays.
   ────────────────────────────────────────────────────────── */
// `roleLabel` is the canonical key the API uses (kept as-is from the GET
// response so PUT round-trips correctly). `displayLabel` is what we render
// in the UI — change these freely to match design without touching the
// server contract.
const ORG_USER_ROLES = [
  { roleLabel: 'project_admin',  displayLabel: 'Project Admin' },
  { roleLabel: 'project_member', displayLabel: 'Project User'  },
];

const PROJECT_OWNER_ROLES = [
  { roleLabel: 'Approver',      displayLabel: 'Approver',      single: true  },
  { roleLabel: 'project_owner', displayLabel: 'Project Owner', single: false },
];

/* Merge the server's users[] for each role into the static row list.
   Matching is purely positional — we ignore the API's `roleLabel` and
   `single` fields entirely. Whatever the server names its roles, the UI
   shows the static labels above and pulls users[] from the same array
   index. Static row 0 gets API row 0's users, row 1 gets row 1's, etc.
   Missing API rows render with an empty selection. */
function mergeRolesWithApi(staticRoles, apiRows) {
  const apiArr = Array.isArray(apiRows) ? apiRows : [];
  return staticRoles.map((cfg, i) => ({
    roleLabel: cfg.roleLabel,
    displayLabel: cfg.displayLabel || cfg.roleLabel,
    single: !!cfg.single,
    users: Array.isArray(apiArr[i]?.users) ? apiArr[i].users : [],
  }));
}

/* ──────────────────────────────────────────────────────────
   MULTI-SELECT — chip-style user picker.
   `users` prop is the directory loaded from the API.
   ────────────────────────────────────────────────────────── */
function MultiSelect({ path, users, selectedIds, single, isOpen, onToggleOpen, onChange, disabled }) {
  const [search, setSearch] = useState('');
  const toggleRef = useRef(null);
  const panelRef = useRef(null);
  const searchRef = useRef(null);
  const [panelPos, setPanelPos] = useState({ top: 0, left: 0, width: 0, ready: false });

  const directory = Array.isArray(users) ? users : [];
  const userFullLabel = (uid) => {
    const u = directory.find((x) => x.id === uid);
    return u ? u.name : uid;
  };

  const displayIds = single ? (selectedIds || []).slice(0, 1) : (selectedIds || []);
  const selectedSet = new Set(selectedIds || []);

  useLayoutEffect(() => {
    if (!isOpen) {
      setPanelPos((p) => ({ ...p, ready: false }));
      setSearch('');
      return;
    }
    const positionPanel = () => {
      const toggle = toggleRef.current;
      const panel = panelRef.current;
      if (!toggle || !panel) return;

      const rect = toggle.getBoundingClientRect();
      const viewportW = window.innerWidth;
      const viewportH = window.innerHeight;
      const margin = 10;

      const panelMinWidth = 240;
      const panelMaxWidth = Math.min(viewportW - margin * 2, 480);
      let width = Math.max(panelMinWidth, Math.min(rect.width, panelMaxWidth));
      if (width > viewportW - margin * 2) width = viewportW - margin * 2;

      let left = rect.left;
      if (left + width > viewportW - margin) left = viewportW - margin - width;
      if (left < margin) left = margin;

      panel.style.width = width + 'px';
      const panelHeight = panel.offsetHeight;
      const spaceBelow = viewportH - rect.bottom - margin;
      const spaceAbove = rect.top - margin;
      const gap = 6;

      let top;
      if (spaceBelow >= panelHeight + gap || spaceBelow >= spaceAbove) {
        top = rect.bottom + gap;
        if (top + panelHeight > viewportH - margin) {
          top = Math.max(margin, viewportH - margin - panelHeight);
        }
      } else {
        top = rect.top - panelHeight - gap;
        if (top < margin) top = margin;
      }
      setPanelPos({ top, left, width, ready: true });
    };

    positionPanel();
    const handleReposition = () => positionPanel();
    window.addEventListener('scroll', handleReposition, true);
    window.addEventListener('resize', handleReposition);
    const focusTimer = setTimeout(() => searchRef.current?.focus(), 60);

    return () => {
      window.removeEventListener('scroll', handleReposition, true);
      window.removeEventListener('resize', handleReposition);
      clearTimeout(focusTimer);
    };
  }, [isOpen]);

  const filteredOptions = directory.filter(
    (u) => !search || u.name.toLowerCase().includes(search.toLowerCase())
  );

  const placeholder = single ? 'Select a user...' : 'Search user...';
  const wrapCls = `mt-ms-wrap${single ? ' mt-ms-single' : ''}${isOpen ? ' mt-ms-open' : ''}`;

  return (
    <div className={wrapCls} data-path={path}>
      <button
        type="button"
        className="mt-ms-toggle"
        ref={toggleRef}
        disabled={disabled}
        onClick={(e) => {
          e.stopPropagation();
          if (!disabled) onToggleOpen();
        }}
        aria-haspopup="listbox"
        aria-expanded={isOpen}
      >
        <div className="mt-ms-display">
          {displayIds.length > 0 ? (
            displayIds.map((uid) => (
              <span key={uid} className="mt-ms-tag" title={userFullLabel(uid)}>
                {userFullLabel(uid)}
              </span>
            ))
          ) : (
            <span className="mt-ms-placeholder">{placeholder}</span>
          )}
        </div>
        <span className="mt-ms-caret" aria-hidden="true">▾</span>
      </button>

      {isOpen && (
        <div
          className="mt-ms-panel"
          ref={panelRef}
          style={{
            position: 'fixed',
            top: panelPos.top + 'px',
            left: panelPos.left + 'px',
            width: panelPos.width + 'px',
            maxWidth: 'calc(100vw - 20px)',
            visibility: panelPos.ready ? 'visible' : 'hidden'
          }}
          onClick={(e) => e.stopPropagation()}
        >
          <input
            ref={searchRef}
            type="text"
            className="mt-ms-search"
            placeholder={placeholder}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            aria-label="Search users"
          />
          <div className="mt-ms-options" role="listbox">
            {filteredOptions.length > 0 ? (
              filteredOptions.map((u) => {
                const checked = selectedSet.has(u.id);
                return (
                  <label
                    key={u.id}
                    className={`mt-ms-option${checked ? ' mt-ms-checked' : ''}`}
                  >
                    <input
                      type="checkbox"
                      value={u.id}
                      checked={checked}
                      onChange={(e) => onChange(u.id, e.target.checked)}
                    />
                    <span>{u.name}</span>
                  </label>
                );
              })
            ) : (
              <div className="mt-ms-empty">No matching users</div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

/* ──────────────────────────────────────────────────────────
   MAIN PAGE COMPONENT
   ────────────────────────────────────────────────────────── */
const EMPTY_STATE = {
  orgUser: mergeRolesWithApi(ORG_USER_ROLES, []),
  projectOwner: mergeRolesWithApi(PROJECT_OWNER_ROLES, []),
  activities: [],
};

export default function ManageTeam() {
  const { id: projectId } = useParams();
  const navigate = useNavigate();

  /* ─── Data + UI state ─── */
  const [userDirectory, setUserDirectory] = useState([]);
  /* Users matched against the project's organization — drive the
     Organization User section dropdowns. */
  const [orgUsers, setOrgUsers] = useState([]);
  /* Users belonging to each division id we've fetched. Indexed by the
     numeric division id from the team-page response. */
  const [divisionUsersById, setDivisionUsersById] = useState({});
  /* Owner division shipped on the team-page response (id/code/name).
     Drives the Project Owner section + per-activity Owner / Approver. */
  const [ownerDivision, setOwnerDivision] = useState(null);
  /* All concerned divisions seen on the team page so we can look up
     {code → {id,name}} when an activity row only references the code. */
  const [divisionByCode, setDivisionByCode] = useState({});
  const [projectName, setProjectName] = useState('');
  const [projectCode, setProjectCode] = useState('');
  const [state, setState] = useState(EMPTY_STATE);

  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [saving, setSaving] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  /* The page is read-only by default — clicking Edit unlocks every
     MultiSelect and surfaces the Submit button. Cancel re-fetches
     team-page so any in-progress edits are dropped. */
  const [editMode, setEditMode] = useState(false);

  const [openMsPath, setOpenMsPath] = useState(null);
  const [expandedId, setExpandedId] = useState(null);
  /* Milestone groups default to OPEN — collapse a group by clicking
     its header. Tracked as a Set of milestone names that are CLOSED
     (absence ⇒ open). */
  const [collapsedMilestones, setCollapsedMilestones] = useState(() => new Set());
  /* Activity rows default to COLLAPSED so the table reads compactly.
     Click an activity to expand its Approver/Owner dropdowns. */
  const [expandedActivities, setExpandedActivities] = useState(() => new Set());

  const toggleMilestone = (m) => {
    setCollapsedMilestones((prev) => {
      const next = new Set(prev);
      if (next.has(m)) next.delete(m);
      else next.add(m);
      return next;
    });
  };
  const toggleActivity = (id) => {
    setExpandedActivities((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
    setOpenMsPath(null);
  };
  const [toast, setToast] = useState({ msg: '', type: '', show: false });
  const toastTimerRef = useRef(null);

  /* ─── Fetch team page on mount / projectId change ─── */
  useEffect(() => {
    if (!projectId) {
      setLoadError('No project selected.');
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setLoadError('');
    (async () => {
      try {
        const data = await getTeamPage(projectId);
        if (cancelled) return;
        setUserDirectory(Array.isArray(data?.userDirectory) ? data.userDirectory : []);
        setProjectName(data?.projectName || '');
        setProjectCode(data?.projectCode || '');
        /* Publish project identity to the global page context so the
           navbar (right-side project name) and the breadcrumb
           (project code as the :id segment) can render it without
           refetching team-page themselves. */
        setPageContext({
          projectId: data?.projectId || projectId || '',
          projectCode: data?.projectCode || '',
          projectName: data?.projectName || ''
        });
        const owner = data?.ownerDivision || null;
        setOwnerDivision(owner);
        /* Map code → { id, name } so activity rows that only carry the
           division code can resolve to a numeric id (needed to look up
           that division's user dropdown). */
        const codeMap = {};
        (Array.isArray(data?.concernedDivisions) ? data.concernedDivisions : []).forEach((d) => {
          if (d && d.code) codeMap[String(d.code).toLowerCase()] = d;
        });
        if (owner && owner.code) codeMap[String(owner.code).toLowerCase()] = owner;
        setDivisionByCode(codeMap);

        const activities = (data?.activities || []).map((a) => ({
          id: a?.id,
          /* Server-assigned WBS codes — shown next to the activity name
             and the milestone group header so users see the same labels
             they see in Project Management instead of opaque UUIDs. */
          displayCode: a?.displayCode || '',
          milestoneDisplayCode: a?.milestoneDisplayCode || '',
          milestoneId: a?.milestoneId || '',
          name: a?.name || '',
          milestone: a?.milestone || '(Unassigned)',
          concernedDivisions: Array.isArray(a?.concernedDivisions) ? a.concernedDivisions : [],
          owner: Array.isArray(a?.owner) ? a.owner : [],
          ownerApprover: Array.isArray(a?.ownerApprover) ? a.ownerApprover : [],
          divisionUsers: (a?.divisionUsers && typeof a.divisionUsers === 'object') ? a.divisionUsers : {},
          divisionApprovers: (a?.divisionApprovers && typeof a.divisionApprovers === 'object') ? a.divisionApprovers : {},
        }));
        setState({
          // Roles are static — only the user IDs come from the API.
          orgUser: mergeRolesWithApi(ORG_USER_ROLES, data?.orgUser),
          projectOwner: mergeRolesWithApi(PROJECT_OWNER_ROLES, data?.projectOwner),
          activities,
        });

        /* Render the page as soon as the team-page payload is in —
           the user-directory fetches (org + each division) below fire
           in the background and stream results into state as they
           resolve. Previously everything was awaited in one
           Promise.all, so the slowest dropdown blocked the whole
           page from rendering. */
        if (!cancelled) setLoading(false);

        /* Background fetch — org users for the Organization User
           section. Doesn't block render; dropdown shows whatever's
           there until this resolves. */
        listUsersByProjectOrg(projectId)
          .then(normalizeUsersList)
          .then((users) => {
            if (!cancelled) setOrgUsers(users);
          })
          .catch((e) => {
            // eslint-disable-next-line no-console
            console.warn('[ManageTeam] org-user fetch failed:', e);
          });

        /* Background fetch — owner division + every Concerned Division
           seen anywhere on the page. Each call resolves independently
           and writes its slice into divisionUsersById, so dropdowns
           light up as their division's data arrives. */
        const uniqueDivIds = new Set();
        if (owner && owner.id) uniqueDivIds.add(owner.id);
        activities.forEach((a) => {
          (a.concernedDivisions || []).forEach((code) => {
            const d = codeMap[String(code).toLowerCase()];
            if (d && d.id) uniqueDivIds.add(d.id);
          });
        });
        Object.values(codeMap).forEach((d) => {
          if (d && d.id) uniqueDivIds.add(d.id);
        });
        uniqueDivIds.forEach((id) => {
          listUsersByDivision(id)
            .then(normalizeUsersList)
            .then((users) => {
              if (cancelled) return;
              setDivisionUsersById((prev) => ({ ...prev, [id]: users }));
            })
            .catch((e) => {
              // eslint-disable-next-line no-console
              console.warn(`[ManageTeam] div-${id} fetch failed:`, e);
            });
        });
      } catch (err) {
        if (!cancelled) {
          setLoadError(err?.message || 'Failed to load team page.');
          setLoading(false);
        }
      }
    })();
    return () => { cancelled = true; };
  }, [projectId, reloadKey]);

  /* Drop the published project identity when leaving the page so the
     navbar / breadcrumb don't keep showing stale info on the next
     route. */
  useEffect(() => () => clearPageContext(), []);

  /* Close dropdowns on outside click */
  useEffect(() => {
    const handleClick = (e) => {
      if (!e.target.closest('.mt-ms-wrap') && !e.target.closest('.mt-ms-panel')) {
        setOpenMsPath(null);
      }
    };
    document.addEventListener('click', handleClick);
    return () => document.removeEventListener('click', handleClick);
  }, []);

  /* ESC collapses any open accordion panel */
  useEffect(() => {
    const handleKey = (e) => {
      if (e.key === 'Escape' && expandedId) {
        setOpenMsPath(null);
        setExpandedId(null);
      }
    };
    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, [expandedId]);

  const showToast = (msg, type = '') => {
    setToast({ msg, type, show: true });
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    toastTimerRef.current = setTimeout(() => {
      setToast((t) => ({ ...t, show: false }));
    }, 2800);
  };

  const toggleMsOpen = (path) => {
    setOpenMsPath((prev) => (prev === path ? null : path));
  };

  /* ─── Section row user toggle (Org User / Project Owner) ─── */
  const handleSectionChange = (sectionId, idx, row) => (uid, checked) => {
    setState((prev) => {
      const newRows = [...prev[sectionId]];
      const newRow = { ...newRows[idx] };
      if (newRow.single) {
        newRow.users = checked ? [uid] : [];
      } else {
        const set = new Set(newRow.users);
        if (checked) set.add(uid);
        else set.delete(uid);
        newRow.users = Array.from(set);
      }
      newRows[idx] = newRow;
      return { ...prev, [sectionId]: newRows };
    });
    if (row.single && checked) setOpenMsPath(null);
  };

  /* ─── Accordion expand / collapse ─── */
  const toggleExpand = (activityId) => {
    setOpenMsPath(null);
    setExpandedId((prev) => (prev === activityId ? null : activityId));
  };

  /* ─── Direct activity edits (no draft layer — write to state immediately) ─── */
  const updateActivity = (activityId, updater) => {
    setState((prev) => ({
      ...prev,
      activities: prev.activities.map((a) => (a.id === activityId ? updater(a) : a)),
    }));
  };

  const toggleActivityOwner = (activityId) => (uid, checked) => {
    updateActivity(activityId, (a) => {
      const set = new Set(a.owner || []);
      if (checked) set.add(uid);
      else set.delete(uid);
      return { ...a, owner: Array.from(set) };
    });
  };

  const toggleActivityOwnerApprover = (activityId) => (uid, checked) => {
    updateActivity(activityId, (a) => ({ ...a, ownerApprover: checked ? [uid] : [] }));
    if (checked) setOpenMsPath(null);
  };

  const toggleActivityDivUser = (activityId, division) => (uid, checked) => {
    updateActivity(activityId, (a) => {
      const current = (a.divisionUsers || {})[division] || [];
      const set = new Set(current);
      if (checked) set.add(uid);
      else set.delete(uid);
      return {
        ...a,
        divisionUsers: { ...(a.divisionUsers || {}), [division]: Array.from(set) },
      };
    });
  };

  const toggleActivityDivApprover = (activityId, division) => (uid, checked) => {
    updateActivity(activityId, (a) => ({
      ...a,
      divisionApprovers: {
        ...(a.divisionApprovers || {}),
        [division]: checked ? [uid] : [],
      },
    }));
    if (checked) setOpenMsPath(null);
  };

  /* ─── Submit (PUT) / Back ─── */
  const submitTeam = async () => {
    const missing = [];
    state.orgUser.forEach((r) => {
      if (!r.users || r.users.length === 0) missing.push(`Organization User → ${r.displayLabel}`);
    });
    state.projectOwner.forEach((r) => {
      if (!r.users || r.users.length === 0) missing.push(`Project Owner → ${r.displayLabel}`);
    });
    state.activities.forEach((a) => {
      if (!a.owner || a.owner.length === 0) missing.push(`Activity "${a.name}" → Activity Owner`);
      if (!a.ownerApprover || a.ownerApprover.length === 0)
        missing.push(`Activity "${a.name}" → Approver`);
      (a.concernedDivisions || []).forEach((d) => {
        const users = (a.divisionUsers || {})[d];
        if (!users || users.length === 0) missing.push(`Activity "${a.name}" → ${d} users`);
        const approvers = (a.divisionApprovers || {})[d];
        if (!approvers || approvers.length === 0) missing.push(`Activity "${a.name}" → ${d} Approver`);
      });
    });

    if (missing.length) {
      const first = missing[0];
      const more = missing.length > 1 ? ` (+ ${missing.length - 1} more)` : '';
      showToast(`Please complete: ${first}${more}`, 'error');
      return;
    }

    // PUT body must only carry { roleLabel, users, single? } — strip displayLabel
    // (UI-only field) before sending so the server contract stays clean.
    const stripDisplay = (rows) => rows.map((r) => {
      const out = { roleLabel: r.roleLabel, users: r.users };
      if (typeof r.single === 'boolean') out.single = r.single;
      return out;
    });

    setSaving(true);
    try {
      await updateTeamPage(projectId, {
        orgUser: stripDisplay(state.orgUser),
        projectOwner: stripDisplay(state.projectOwner),
        activities: state.activities,
      });
      showToast('Team saved successfully.', 'success');
      /* Drop edit mode on a successful save — the dropdowns lock and
         the Submit/Cancel toolbar collapses back to just Edit. */
      setEditMode(false);
    } catch (err) {
      showToast(err?.message || 'Failed to save team.', 'error');
    } finally {
      setSaving(false);
    }
  };

  const goBack = () => {
    if (window.history.length > 1) navigate(-1);
    else navigate('/');
  };

  /* ─── Group activities by milestone ─── */
  const activityGroups = (() => {
    const groups = [];
    const groupMap = new Map();
    state.activities.forEach((a) => {
      const m = a.milestone || '(Unassigned)';
      if (!groupMap.has(m)) {
        /* First activity in this milestone bucket — capture the WBS
           code (e.g. "M1") so the header can render it next to the
           name. Subsequent activities in the same milestone reuse it. */
        const g = { milestone: m, displayCode: a.milestoneDisplayCode || '', items: [] };
        groupMap.set(m, g);
        groups.push(g);
      }
      groupMap.get(m).items.push(a);
    });
    return groups;
  })();

  const totalAct = state.activities.length;
  const totalMs = activityGroups.length;

  /* ─── User-list resolvers ─── */
  /* Owner-division dropdown source: drives Project Owner section +
     activity Owner / Approver fields. Fallback to userDirectory so the
     legacy seed data still renders if the new API responds empty. */
  const ownerDivisionUsers = (() => {
    if (ownerDivision && ownerDivision.id && Array.isArray(divisionUsersById[ownerDivision.id])) {
      return divisionUsersById[ownerDivision.id];
    }
    return normalizeUsersList(userDirectory);
  })();
  /* Per-Concerned-Division dropdown source. Activity rows reference
     divisions by CODE — translate to the numeric id via the code map
     so we hit the right entry of divisionUsersById. */
  const usersForDivisionCode = (code) => {
    const d = divisionByCode[String(code || '').toLowerCase()];
    if (d && d.id && Array.isArray(divisionUsersById[d.id])) {
      return divisionUsersById[d.id];
    }
    return normalizeUsersList(userDirectory);
  };
  /* Friendly division label — keeps the original code as fallback for
     anything not in the code map. */
  const labelForDivisionCode = (code) => {
    const d = divisionByCode[String(code || '').toLowerCase()];
    return (d && (d.name || d.code)) || code;
  };

  /* Look up a user's friendly name in a directory; falls back to a
     short id slice so unknown ids still render something readable. */
  const findUserName = (uid, dirArr) => {
    const u = (Array.isArray(dirArr) ? dirArr : []).find((x) => x.id === uid);
    if (u) return u.name;
    return String(uid || '').slice(0, 8);
  };

  /* Build the per-division rows that go into an activity's Owner or
     Approver cell. Each entry is `{ division, names }` where division
     is the friendly label and names is a comma-joined list. Empty
     groups (no assigned users for that division) are skipped so the
     cell only shows divisions that actually have assignees. */
  const buildOwnerCellRows = (act) => {
    const rows = [];
    if (ownerDivision && Array.isArray(act.owner) && act.owner.length > 0) {
      rows.push({
        division: ownerDivision.name || ownerDivision.code || 'Owner',
        names: act.owner.map((uid) => findUserName(uid, ownerDivisionUsers)).join(', ')
      });
    }
    (act.concernedDivisions || []).forEach((code) => {
      const users = (act.divisionUsers || {})[code] || [];
      if (!users.length) return;
      const divUsers = usersForDivisionCode(code);
      rows.push({
        division: labelForDivisionCode(code),
        names: users.map((uid) => findUserName(uid, divUsers)).join(', ')
      });
    });
    return rows;
  };

  const buildApproverCellRows = (act) => {
    const rows = [];
    if (ownerDivision && Array.isArray(act.ownerApprover) && act.ownerApprover.length > 0) {
      rows.push({
        division: ownerDivision.name || ownerDivision.code || 'Owner',
        names: act.ownerApprover.map((uid) => findUserName(uid, ownerDivisionUsers)).join(', ')
      });
    }
    (act.concernedDivisions || []).forEach((code) => {
      const approvers = (act.divisionApprovers || {})[code] || [];
      if (!approvers.length) return;
      const divUsers = usersForDivisionCode(code);
      rows.push({
        division: labelForDivisionCode(code),
        names: approvers.map((uid) => findUserName(uid, divUsers)).join(', ')
      });
    });
    return rows;
  };

  /* Single-cell renderer used for both Owner and Approver columns —
     stacks one "name1, name2 (Division)" line per division. */
  const renderCellRows = (rows) => {
    if (!rows || rows.length === 0) {
      return <span className="mt-cell-empty">—</span>;
    }
    return (
      <div className="mt-cell-rows">
        {rows.map((r, i) => (
          <div key={i} className="mt-cell-row">
            <span>{r.names}</span>
            <span className="mt-cell-row-div">({r.division})</span>
          </div>
        ))}
      </div>
    );
  };

  /* ─── Inline editor for one activity (no Save/Cancel — persists immediately) ─── */
  const renderActivityPanel = (act) => {
    const concerned = Array.isArray(act.concernedDivisions) ? act.concernedDivisions : [];
    return (
      <div
        id={`mt-activity-panel-${act.id}`}
        className="mt-activity-panel"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mt-activity-panel-body">
          {/* Activity ownership */}
          <div className="mt-modal-role-group mt-division-group">
            <div className="mt-division-group-header">
              <span className="mt-division-tag">Activity</span>
              <span className="mt-division-group-sub">
                Pick the Approver and Activity Owner for this activity.
              </span>
            </div>
            <div className="mt-modal-field">
              <div className="mt-modal-field-label">Approver</div>
              <div className="mt-modal-field-hint">
                A single approver who will sign off on the Activity Owner's work.
              </div>
              <MultiSelect
                path={`exp:${act.id}:ownerApprover`}
                users={ownerDivisionUsers}
                selectedIds={act.ownerApprover}
                single
                isOpen={openMsPath === `exp:${act.id}:ownerApprover`}
                onToggleOpen={() => toggleMsOpen(`exp:${act.id}:ownerApprover`)}
                onChange={toggleActivityOwnerApprover(act.id)}
                disabled={saving}
              />
            </div>
            <div className="mt-modal-field">
              <div className="mt-modal-field-label">Activity Owner</div>
              <div className="mt-modal-field-hint">
                One or more users responsible for this activity.
              </div>
              <MultiSelect
                path={`exp:${act.id}:owner`}
                users={ownerDivisionUsers}
                selectedIds={act.owner}
                single={false}
                isOpen={openMsPath === `exp:${act.id}:owner`}
                onToggleOpen={() => toggleMsOpen(`exp:${act.id}:owner`)}
                onChange={toggleActivityOwner(act.id)}
                disabled={saving}
              />
            </div>
          </div>

          {/* Concerned Divisions */}
          {concerned.length > 0 ? (
            <>
              <div className="mt-modal-divisions-heading">Concerned Divisions</div>
              {concerned.map((d) => {
                const divLabel = labelForDivisionCode(d);
                const divUsers = usersForDivisionCode(d);
                return (
                <div key={d} className="mt-modal-role-group mt-division-group">
                  <div className="mt-division-group-header">
                    <span className="mt-division-tag">{divLabel}</span>
                    <span className="mt-division-group-sub">
                      Pick the Approver and Users from <strong>{divLabel}</strong>.
                    </span>
                  </div>
                  <div className="mt-modal-field">
                    <div className="mt-modal-field-label">Approver</div>
                    <div className="mt-modal-field-hint">
                      A single approver from <strong>{divLabel}</strong> for this activity.
                    </div>
                    <MultiSelect
                      path={`exp:${act.id}:divApprover:${d}`}
                      users={divUsers}
                      selectedIds={(act.divisionApprovers || {})[d] || []}
                      single
                      isOpen={openMsPath === `exp:${act.id}:divApprover:${d}`}
                      onToggleOpen={() => toggleMsOpen(`exp:${act.id}:divApprover:${d}`)}
                      onChange={toggleActivityDivApprover(act.id, d)}
                      disabled={saving}
                    />
                  </div>
                  <div className="mt-modal-field">
                    <div className="mt-modal-field-label">Users</div>
                    <div className="mt-modal-field-hint">
                      Users from <strong>{divLabel}</strong> who will work on this activity.
                    </div>
                    <MultiSelect
                      path={`exp:${act.id}:div:${d}`}
                      users={divUsers}
                      selectedIds={(act.divisionUsers || {})[d] || []}
                      single={false}
                      isOpen={openMsPath === `exp:${act.id}:div:${d}`}
                      onToggleOpen={() => toggleMsOpen(`exp:${act.id}:div:${d}`)}
                      onChange={toggleActivityDivUser(act.id, d)}
                      disabled={saving}
                    />
                  </div>
                </div>
                );
              })}
            </>
          ) : (
            <div className="mt-modal-empty-divisions">
              <span aria-hidden="true">ℹ️</span>
              <span>
                No Concerned Divisions are set for this activity in{' '}
                <strong>Project Management</strong>. Add divisions there to assign division
                users here.
              </span>
            </div>
          )}
        </div>
      </div>
    );
  };

  /* ─── Loading / error states ─── */
  if (loading) {
    return (
      <div className="mt-page">
        <div className="mt-card">
          <div className="mt-no-activities">Loading team data…</div>
        </div>
      </div>
    );
  }

  if (loadError) {
    return (
      <div className="mt-page">
        <div className="mt-card">
          <div className="mt-no-activities" style={{ color: 'var(--mt-red)' }}>
            Could not load team data — {loadError}
          </div>
        </div>
        <div className="mt-page-footer-actions">
          <button className="mt-btn mt-btn-cancel" onClick={goBack}>← Back</button>
          <button className="mt-btn" onClick={() => setReloadKey((k) => k + 1)}>Retry</button>
        </div>
      </div>
    );
  }

  return (
    <div className="mt-page">

      {/* ─── TOP TOOLBAR — Back + Edit/Cancel/Submit ─── */}
      <div className="mt-top-toolbar">
        <button
          type="button"
          className="mt-btn mt-btn-cancel"
          onClick={goBack}
          disabled={saving}
        >
          ← Back
        </button>
        <div style={{ flex: 1 }} />
        {!editMode ? (
          <button
            type="button"
            className="mt-btn"
            onClick={() => setEditMode(true)}
            disabled={saving}
          >
            ✎ Edit
          </button>
        ) : (
          <>
            <button
              type="button"
              className="mt-btn mt-btn-cancel"
              onClick={() => {
                setEditMode(false);
                /* Re-fetch team-page so any in-progress edits are
                   discarded — gives the user a clean revert. */
                setReloadKey((k) => k + 1);
              }}
              disabled={saving}
            >
              Cancel
            </button>
            <button
              type="button"
              className="mt-btn"
              onClick={submitTeam}
              disabled={saving}
            >
              {saving ? 'Saving…' : 'Submit'}
            </button>
          </>
        )}
      </div>

      {/* ─── ORGANIZATION USER + PROJECT OWNER side-by-side row ─── */}
      <div className="mt-two-col">
      <div className="mt-card">
        <h2 className="mt-card-title">Organization User</h2>
        <div className="mt-table-wrap">
          <table className="mt-team-table">
            <thead>
              <tr>
                <th className="mt-col-role">Role</th>
                <th>Users</th>
              </tr>
            </thead>
            <tbody>
              {state.orgUser.map((row, idx) => {
                const path = `section:orgUser:${idx}`;
                return (
                  <tr key={row.roleLabel}>
                    <td data-label="Role">
                      <span className="mt-role-pill" title="Role is fixed and cannot be edited">
                        {row.displayLabel}
                      </span>
                    </td>
                    <td data-label={row.single ? 'User' : 'Users'}>
                      <MultiSelect
                        path={path}
                        users={orgUsers}
                        selectedIds={row.users}
                        single={!!row.single}
                        isOpen={openMsPath === path}
                        onToggleOpen={() => toggleMsOpen(path)}
                        onChange={handleSectionChange('orgUser', idx, row)}
                        disabled={!editMode || saving}
                      />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* ─── PROJECT OWNER (static roles) ─── */}
      <div className="mt-card">
        <h2 className="mt-card-title">
          Project Owner
          {ownerDivision && (ownerDivision.name || ownerDivision.code) && (
            <span
              className="mt-division-tag"
              style={{ marginLeft: 10, fontSize: 12 }}
              title="Owner Division for this project"
            >
              {ownerDivision.name || ownerDivision.code}
            </span>
          )}
        </h2>
        <div className="mt-table-wrap">
          <table className="mt-team-table">
            <thead>
              <tr>
                <th className="mt-col-role">Role</th>
                <th>Users</th>
              </tr>
            </thead>
            <tbody>
              {state.projectOwner.map((row, idx) => {
                const path = `section:projectOwner:${idx}`;
                return (
                  <tr key={row.roleLabel}>
                    <td data-label="Role">
                      <span className="mt-role-pill" title="Role is fixed and cannot be edited">
                        {row.displayLabel}
                      </span>
                    </td>
                    <td data-label={row.single ? 'User' : 'Users'}>
                      <MultiSelect
                        path={path}
                        users={ownerDivisionUsers}
                        selectedIds={row.users}
                        single={!!row.single}
                        isOpen={openMsPath === path}
                        onToggleOpen={() => toggleMsOpen(path)}
                        onChange={handleSectionChange('projectOwner', idx, row)}
                        disabled={!editMode || saving}
                      />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
      </div>

      {/* ─── ACTIVITIES (inline expand/collapse — accordion) ─── */}
      <div className="mt-card">
        <h2 className="mt-card-title">
          Activities{' '}
          <span className="mt-subtag">
            {totalMs} {totalMs === 1 ? 'milestone' : 'milestones'} · {totalAct}{' '}
            {totalAct === 1 ? 'activity' : 'activities'}
          </span>
        </h2>
        <p className="mt-card-subtitle">
          Activities are grouped by milestone. Click any activity to expand it and assign its
          Activity Owner and the users for each Concerned Division (set in{' '}
          <strong>Project Management</strong>).
        </p>
        <div className="mt-activity-list">
          {activityGroups.length === 0 ? (
            <div className="mt-no-activities">No activities defined for this project.</div>
          ) : (
            activityGroups.map((group) => {
              const msCollapsed = collapsedMilestones.has(group.milestone);
              return (
              <section key={group.milestone} className="mt-milestone-group">
                <header
                  className="mt-milestone-head mt-milestone-head--clickable"
                  role="button"
                  tabIndex={0}
                  onClick={() => toggleMilestone(group.milestone)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      toggleMilestone(group.milestone);
                    }
                  }}
                  aria-expanded={!msCollapsed}
                >
                  <span
                    className={`mt-milestone-toggle${msCollapsed ? '' : ' mt-milestone-toggle-open'}`}
                    aria-hidden="true"
                  >
                    {msCollapsed ? '▸' : '▾'}
                  </span>
                  {/* <span className="mt-milestone-icon" aria-hidden="true">📍</span> */}
                  <span className="mt-milestone-label">Milestone</span>
                  {group.displayCode && (
                    <span className="mt-activity-id" style={{ marginRight: 6 }}>
                      {group.displayCode}
                    </span>
                  )}
                  <span className="mt-milestone-name">{group.milestone}</span>
                  <span className="mt-milestone-count">
                    {group.items.length} {group.items.length === 1 ? 'activity' : 'activities'}
                  </span>
                </header>
                {!msCollapsed && (
                <div className="mt-milestone-items">
                  <table className="mt-team-table mt-activity-table">
                    <thead>
                      <tr>
                        <th>Activity</th>
                        <th>Activity Owner</th>
                        <th>Activity Approver</th>
                      </tr>
                    </thead>
                    <tbody>
                      {group.items.map((act) => {
                        const concerned = Array.isArray(act.concernedDivisions)
                          ? act.concernedDivisions
                          : [];
                        const isExpanded = expandedActivities.has(act.id);
                        return (
                          <tr key={act.id} className="mt-activity-tr">
                            <td data-label="Activity">
                              <div
                                className="mt-activity-id-name mt-activity-id-name--toggle"
                                role="button"
                                tabIndex={0}
                                onClick={() => toggleActivity(act.id)}
                                onKeyDown={(e) => {
                                  if (e.key === 'Enter' || e.key === ' ') {
                                    e.preventDefault();
                                    toggleActivity(act.id);
                                  }
                                }}
                                aria-expanded={isExpanded}
                              >
                                <span
                                  className={`mt-act-toggle${isExpanded ? ' mt-act-toggle-open' : ''}`}
                                  aria-hidden="true"
                                >
                                  {isExpanded ? '▾' : '▸'}
                                </span>
                                <span className="mt-activity-id">
                                  {act.displayCode || (act.id?.slice(0, 8) || '')}
                                </span>
                                <span className="mt-activity-name">{act.name}</span>
                              </div>
                            </td>
                            {!isExpanded && (
                              <>
                                <td data-label="Activity Owner">
                                  {renderCellRows(buildOwnerCellRows(act))}
                                </td>
                                <td data-label="Activity Approver">
                                  {renderCellRows(buildApproverCellRows(act))}
                                </td>
                              </>
                            )}
                            {isExpanded && (
                            <>
                            <td data-label="Activity Owner">
                              <div className="mt-cell-edit">
                                {ownerDivision && (
                                  <div className="mt-cell-edit-row">
                                    <div className="mt-cell-edit-label">
                                      <span>{ownerDivision.name || ownerDivision.code}</span>
                                      <span className="mt-div-type mt-div-type--owner">
                                        Owner Division
                                      </span>
                                    </div>
                                    <MultiSelect
                                      path={`tbl:${act.id}:owner`}
                                      users={ownerDivisionUsers}
                                      selectedIds={act.owner}
                                      single={false}
                                      isOpen={openMsPath === `tbl:${act.id}:owner`}
                                      onToggleOpen={() => toggleMsOpen(`tbl:${act.id}:owner`)}
                                      onChange={toggleActivityOwner(act.id)}
                                      disabled={!editMode || saving}
                                    />
                                  </div>
                                )}
                                {concerned.map((code) => (
                                  <div key={code} className="mt-cell-edit-row">
                                    <div className="mt-cell-edit-label">
                                      <span>{labelForDivisionCode(code)}</span>
                                      <span className="mt-div-type mt-div-type--concerned">
                                        Concerned Division
                                      </span>
                                    </div>
                                    <MultiSelect
                                      path={`tbl:${act.id}:div:${code}`}
                                      users={usersForDivisionCode(code)}
                                      selectedIds={(act.divisionUsers || {})[code] || []}
                                      single={false}
                                      isOpen={openMsPath === `tbl:${act.id}:div:${code}`}
                                      onToggleOpen={() => toggleMsOpen(`tbl:${act.id}:div:${code}`)}
                                      onChange={toggleActivityDivUser(act.id, code)}
                                      disabled={!editMode || saving}
                                    />
                                  </div>
                                ))}
                              </div>
                            </td>
                            <td data-label="Activity Approver">
                              <div className="mt-cell-edit">
                                {ownerDivision && (
                                  <div className="mt-cell-edit-row">
                                    <div className="mt-cell-edit-label">
                                      <span>{ownerDivision.name || ownerDivision.code}</span>
                                      <span className="mt-div-type mt-div-type--owner">
                                        Owner Division
                                      </span>
                                    </div>
                                    <MultiSelect
                                      path={`tbl:${act.id}:ownerApprover`}
                                      users={ownerDivisionUsers}
                                      selectedIds={act.ownerApprover}
                                      single
                                      isOpen={openMsPath === `tbl:${act.id}:ownerApprover`}
                                      onToggleOpen={() => toggleMsOpen(`tbl:${act.id}:ownerApprover`)}
                                      onChange={toggleActivityOwnerApprover(act.id)}
                                      disabled={!editMode || saving}
                                    />
                                  </div>
                                )}
                                {concerned.map((code) => (
                                  <div key={code} className="mt-cell-edit-row">
                                    <div className="mt-cell-edit-label">
                                      <span>{labelForDivisionCode(code)}</span>
                                      <span className="mt-div-type mt-div-type--concerned">
                                        Concerned Division
                                      </span>
                                    </div>
                                    <MultiSelect
                                      path={`tbl:${act.id}:divApprover:${code}`}
                                      users={usersForDivisionCode(code)}
                                      selectedIds={(act.divisionApprovers || {})[code] || []}
                                      single
                                      isOpen={openMsPath === `tbl:${act.id}:divApprover:${code}`}
                                      onToggleOpen={() =>
                                        toggleMsOpen(`tbl:${act.id}:divApprover:${code}`)
                                      }
                                      onChange={toggleActivityDivApprover(act.id, code)}
                                      disabled={!editMode || saving}
                                    />
                                  </div>
                                ))}
                              </div>
                            </td>
                            </>
                            )}
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
                )}
              </section>
              );
            })
          )}
        </div>
      </div>

      {/* ─── PAGE FOOTER ACTIONS ─── Back lives in the top toolbar
           now; bottom keeps Submit only while editing so users on
           long pages don't have to scroll back up. */}
      <div style={{gap:"10px",display:"flex",justifyContent:"center"}}>
        {editMode && (
        <button
          className="mt-btn"
          onClick={submitTeam}
          disabled={saving}
        >
          {saving ? 'Saving…' : 'Submit'}
        </button>
        )}
      </div>

      {/* ─── TOAST ─── */}
      <div
        className={`mt-toast${toast.show ? ' mt-toast-show' : ''}${
          toast.type ? ` mt-toast-${toast.type}` : ''
        }`}
        role="status"
        aria-live="polite"
      >
        {toast.msg}
      </div>
    </div>
  );
}