/* Dashboard — port of PMIS_Screens / Dashboard.html (May 8 design).
   Six views: Summary, Project View, Organization View, Division View,
   Project List, Track Progress. KPIs are clickable and open the Track
   Progress hierarchy table scoped to the click. "Open in PM" rows
   navigate to the existing /projects/:projectId Project Details page. */

import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  projectsList as fetchDashboardProjects,
  projectCardToLegacy,
  treeToLegacyProject,
  getRawProjectTree,
} from "../api/dashboard";
import "../styles/Dashboard.css";

/* Data wiring (2026-05-11):
   - Top-level project list comes from GET /api/v3/dashboard/projects (BE
     ProjectCard[] with server-computed bucket / progress / counts).
   - Track Progress drill-down for a single project lazy-fetches the legacy
     /api/v3/projects/{uuid}/tree to get the 4-level M→A→T→ST hierarchy.
   - "Pending for Approval" KPI is rendered with a static placeholder until
     the approvalState field ships in the next backend phase.
   - Helpers below (kpisForProject / countsForProjects / projectBucket)
     prefer BE-computed values via `project._be` when present, falling back
     to client-side derivation when only legacy tree data is available. */

// Per-project deterministic placeholder for the "Pending for Approval"
// KPI until the BE ships `approvalState` on activities. Hashing the
// project id keeps the value stable across renders and varied per
// project so the tile doesn't look broken with a flat 0.
function staticPendingApprovals(p) {
  const id = String(p?.id || p?.uuid || "");
  if (!id) return 0;
  let h = 0;
  for (let i = 0; i < id.length; i++) h = ((h << 5) - h + id.charCodeAt(i)) | 0;
  return Math.abs(h) % 5;
}

/* ─── Pure helpers ─────────────────────────────────────────── */

const DAY = 86400000;
function d(v) { return v ? new Date(v) : null; }
function fmt(v) {
  const x = v instanceof Date ? v : d(v);
  if (!x || Number.isNaN(x.getTime())) return "-";
  return (
    String(x.getDate()).padStart(2, "0") + "-" +
    String(x.getMonth() + 1).padStart(2, "0") + "-" +
    x.getFullYear()
  );
}
function range(a, b) { return fmt(a) + " → " + fmt(b); }
function todayDate() { const t = new Date(); t.setHours(0, 0, 0, 0); return t; }

function taskLeaves(t) {
  const kids = t && Array.isArray(t.subtasks) ? t.subtasks : [];
  if (!kids.length) return [t];
  return kids.flatMap(taskLeaves);
}
function allTasks(node) {
  if (!node) return [];
  if (node.subtasks) return taskLeaves(node);
  if (node.tasks) return node.tasks.flatMap(taskLeaves);
  let out = [];
  if (node.activities) node.activities.forEach((a) => { out = out.concat(allTasks(a)); });
  if (node.milestones) node.milestones.forEach((m) => (m.activities || []).forEach((a) => { out = out.concat(allTasks(a)); }));
  return out;
}
function taskStatus(t, today = todayDate()) {
  if (t.subtasks && t.subtasks.length) {
    const child = t.subtasks.map((s) => taskStatus(s, today));
    if (child.every((x) => x === "completed")) return "completed";
    if (child.some((x) => x === "delayed")) return "delayed";
    if (child.some((x) => x === "ontrack" || x === "completed")) return "ontrack";
    return "active";
  }
  const pe = d(t.plannedEnd), as = d(t.actualStart), ae = d(t.actualEnd);
  if (ae) return "completed";
  if (pe && pe < today) return "delayed";
  return as ? "ontrack" : "active";
}
function nodeStatus(node, today = todayDate()) {
  const tasks = allTasks(node);
  if (!tasks.length) return "active";
  const st = tasks.map((t) => taskStatus(t, today));
  if (st.every((x) => x === "completed")) return "completed";
  if (st.some((x) => x === "delayed")) return "delayed";
  if (st.some((x) => x === "ontrack" || x === "completed")) return "ontrack";
  return "active";
}
function projectBucket(p, today) {
  // Prefer BE-computed bucket per the locked dashboard spec (closed →
  // completed; any live M/A past expected end → delayed; else ontrack).
  if (p?._be?.bucket) return p._be.bucket;
  return nodeStatus(p, today);
}
function progress(node, today = todayDate()) {
  const tasks = allTasks(node);
  if (!tasks.length) return 0;
  return Math.round(tasks.filter((t) => taskStatus(t, today) === "completed").length / tasks.length * 100);
}
function dates(node) {
  const tasks = allTasks(node);
  const ps = tasks.map((t) => d(t.plannedStart)).filter(Boolean);
  const pe = tasks.map((t) => d(t.plannedEnd)).filter(Boolean);
  const as = tasks.map((t) => d(t.actualStart)).filter(Boolean);
  const ae = tasks.map((t) => d(t.actualEnd)).filter(Boolean);
  return {
    plannedStart: ps.length ? new Date(Math.min(...ps)) : d(node.plannedStart),
    plannedEnd: pe.length ? new Date(Math.max(...pe)) : d(node.plannedEnd),
    actualStart: as.length ? new Date(Math.min(...as)) : d(node.actualStart),
    actualEnd: ae.length && ae.length === tasks.length ? new Date(Math.max(...ae)) : null,
  };
}
function delayDays(node, today = todayDate()) {
  const st = node.tasks ? taskStatus(node, today) : nodeStatus(node, today);
  const nd = dates(node);
  const pe = d(node.plannedEnd) || nd.plannedEnd;
  const ae = d(node.actualEnd) || nd.actualEnd;
  if (st === "completed" && ae && pe && ae > pe) return Math.round((ae - pe) / DAY);
  if (st !== "completed" && pe && pe < today) return Math.round((today - pe) / DAY);
  return 0;
}
function pendingApproval(a) {
  return ["pending_division", "pending_owner", "rejected", "division_approved"].includes(a.approvalState);
}
function kpisForProject(p, today) {
  const ms = p.milestones || [];
  const acts = ms.flatMap((m) => m.activities || []);
  const tasks = acts.flatMap((a) => a.tasks || []);
  const be = p?._be;
  // Light list rows (no tree yet) — read everything from BE counts.
  if (be && !ms.length) {
    return {
      progress: be.progressPct ?? 0,
      milestonesDone: be.milestonesCompleted ?? 0,
      milestonesTotal: be.milestonesTotal ?? 0,
      activitiesDone: be.activitiesCompleted ?? 0,
      activitiesTotal: be.activitiesTotal ?? 0,
      pendingApprovals: staticPendingApprovals(p),
      delayed: be.delayedItemCount ?? 0,
      tasksDone: 0,
      tasksTotal: 0,
    };
  }
  return {
    progress: be?.progressPct ?? progress(p, today),
    milestonesDone: be?.milestonesCompleted ?? ms.filter((m) => nodeStatus(m, today) === "completed").length,
    milestonesTotal: be?.milestonesTotal ?? ms.length,
    activitiesDone: be?.activitiesCompleted ?? acts.filter((a) => nodeStatus(a, today) === "completed" && a.approvalState === "completed").length,
    activitiesTotal: be?.activitiesTotal ?? acts.length,
    pendingApprovals: staticPendingApprovals(p),
    delayed: be?.delayedItemCount ?? flattenRows(p, { today }).filter((r) => r.status === "delayed").length,
    tasksDone: tasks.filter((t) => taskStatus(t, today) === "completed").length,
    tasksTotal: tasks.length,
  };
}
function countsForProjects(list, today) {
  const c = { active: 0, completed: 0, ontrack: 0, delayed: 0, total: list.length };
  list.forEach((p) => { c[projectBucket(p, today)]++; });
  return c;
}
function countsForRows(rows) {
  const c = { active: 0, completed: 0, ontrack: 0, delayed: 0, total: rows.length };
  rows.forEach((r) => { c[r.status]++; });
  return c;
}
const LABELS = {
  active: "Active", completed: "Completed", ontrack: "On Track", delayed: "Delayed",
  milestone: "Milestones", activity: "Activities", task: "Tasks", subtask: "Sub Tasks",
};
const COLORS = {
  active: "#0b3c88", completed: "#1a8a3d", ontrack: "#0aa1c0", delayed: "#d4440e",
  milestone: "#0b3c88", activity: "#0aa1c0", task: "#5e3fb1", subtask: "#b25900",
};

function groupBy(projects, field) {
  const map = {};
  projects.forEach((p) => {
    const name = p[field] || "-";
    if (!map[name]) map[name] = [];
    map[name].push(p);
  });
  const today = todayDate();
  return Object.keys(map)
    .map((name) => ({ name, projects: map[name], counts: countsForProjects(map[name], today) }))
    .sort((a, b) => b.projects.length - a.projects.length || a.name.localeCompare(b.name));
}

function flattenRows(project, opts = {}) {
  const today = opts.today || todayDate();
  const rows = [];
  function includeTaskRows(taskList, prefix, parentName, mi, ai) {
    (taskList || []).forEach((t, ti) => {
      const key = `${prefix}:t:${ti}`;
      rows.push({
        project, key, parentKey: prefix, kind: "task",
        wbs: `T${mi + 1}.${ai + 1}.${ti + 1}`, name: t.name, context: parentName, node: t,
        status: taskStatus(t, today), progress: progress(t, today),
        plannedStart: t.plannedStart, plannedEnd: t.plannedEnd,
        actualStart: t.actualStart, actualEnd: t.actualEnd, delay: delayDays(t, today),
      });
      (t.subtasks || []).forEach((s, si) => {
        const subKey = `${key}:s:${si}`;
        rows.push({
          project, key: subKey, parentKey: key, kind: "subtask",
          wbs: `ST${mi + 1}.${ai + 1}.${ti + 1}.${si + 1}`, name: s.name, context: t.name, node: s,
          status: taskStatus(s, today), progress: taskStatus(s, today) === "completed" ? 100 : 0,
          plannedStart: s.plannedStart, plannedEnd: s.plannedEnd,
          actualStart: s.actualStart, actualEnd: s.actualEnd, delay: delayDays(s, today),
        });
      });
    });
  }
  (project.milestones || []).forEach((m, mi) => {
    const mKey = `m:${mi}`;
    const md = dates(m);
    rows.push({
      project, key: mKey, parentKey: null, kind: "milestone",
      wbs: `M${mi + 1}`, name: m.name, context: project.name, node: m,
      status: nodeStatus(m, today), progress: progress(m, today),
      plannedStart: m.plannedStart || md.plannedStart, plannedEnd: m.plannedEnd || md.plannedEnd,
      actualStart: md.actualStart, actualEnd: md.actualEnd, delay: delayDays(m, today),
    });
    (m.activities || []).forEach((a, ai) => {
      const aKey = `${mKey}:a:${ai}`;
      const ad = dates(a);
      rows.push({
        project, key: aKey, parentKey: mKey, kind: "activity",
        wbs: `A${mi + 1}.${ai + 1}`, name: a.name, context: m.name, node: a,
        status: nodeStatus(a, today), progress: progress(a, today),
        plannedStart: ad.plannedStart, plannedEnd: ad.plannedEnd,
        actualStart: ad.actualStart, actualEnd: ad.actualEnd, delay: delayDays(a, today),
        approvalState: a.approvalState,
      });
      includeTaskRows(a.tasks, aKey, a.name, mi, ai);
    });
  });
  const matchedKeys = new Set();
  rows.forEach((r) => {
    if (opts.kind && r.kind !== opts.kind) return;
    if (opts.status && r.status !== opts.status) return;
    if (opts.minDelay && r.delay < opts.minDelay) return;
    if (opts.approval && !(r.kind === "activity" && pendingApproval(r.node))) return;
    if (opts.key && !(r.key === opts.key || r.key.startsWith(opts.key + ":"))) return;
    matchedKeys.add(r.key);
  });
  if (!opts.withAncestors && !opts.key) return rows.filter((r) => matchedKeys.has(r.key));
  const includeKeys = new Set(matchedKeys);
  rows.forEach((r) => {
    if (!matchedKeys.has(r.key)) return;
    let parent = r.parentKey;
    while (parent) {
      includeKeys.add(parent);
      const parentRow = rows.find((x) => x.key === parent);
      parent = parentRow && parentRow.parentKey;
    }
  });
  return rows.filter((r) => includeKeys.has(r.key));
}

function trackRows(projects, scope = {}) {
  const today = todayDate();
  return projects.filter((p) => {
    if (scope.projectId && p.id !== scope.projectId) return false;
    if (scope.org && p.organisation !== scope.org) return false;
    if (scope.division && p.division !== scope.division) return false;
    if (scope.projectMode && projectBucket(p, today) !== scope.projectMode) return false;
    return true;
  }).flatMap((p) => flattenRows(p, { ...scope, withAncestors: true, today }));
}

function delayedItemsFor(list, today, opts = {}) {
  return list.flatMap((p) => flattenRows(p, { ...opts, today, status: "delayed" })).sort((a, b) => b.delay - a.delay);
}
function delayedProjectsFor(list, minDelay, today) {
  return list.map((p) => {
    const be = p?._be;
    // Light list rows — no tree — fall back to BE aggregate counts.
    if (be && !(p.milestones || []).length) {
      const count = be.delayedItemCount || 0;
      const delay = be.maxDelayDays || 0;
      if (!count || delay < minDelay) return null;
      return { project: p, name: p.name, kind: "project", delay, count };
    }
    const delayed = flattenRows(p, { status: "delayed", minDelay, today });
    if (!delayed.length) return null;
    return {
      project: p, name: p.name, kind: "project",
      delay: Math.max(...delayed.map((x) => x.delay || 0)),
      count: delayed.length,
    };
  }).filter(Boolean).sort((a, b) => b.count - a.count || b.delay - a.delay);
}

/* ─── Donut SVG ────────────────────────────────────────────── */

function Donut({ counts, keys }) {
  keys = keys || Object.keys(counts).filter((k) => k !== "total");
  const total = keys.reduce((s, k) => s + (counts[k] || 0), 0);
  if (!total) {
    return (
      <svg className="dash-donut" viewBox="0 0 200 200">
        <circle cx="100" cy="100" r="70" fill="none" stroke="#eef3fa" strokeWidth="22" />
        <text x="100" y="104" textAnchor="middle" fill="#7a869a" fontSize="13">No data</text>
      </svg>
    );
  }
  const r = 70, circ = 2 * Math.PI * r;
  let used = 0;
  const rings = keys.map((k) => {
    const n = counts[k] || 0;
    if (!n) return null;
    const len = n / total * circ;
    const off = -used;
    used += len;
    return (
      <circle key={k} cx="100" cy="100" r="70" fill="none"
        stroke={COLORS[k] || "#9aa6bd"} strokeWidth="22"
        strokeDasharray={`${len.toFixed(2)} ${(circ - len).toFixed(2)}`}
        strokeDashoffset={off.toFixed(2)} transform="rotate(-90 100 100)" />
    );
  });
  return (
    <svg className="dash-donut" viewBox="0 0 200 200">
      <circle cx="100" cy="100" r="70" fill="none" stroke="#eef3fa" strokeWidth="22" />
      {rings}
      <text x="100" y="92" textAnchor="middle" fontSize="34" fontWeight="900" fill="#0b3c88">{total}</text>
      <text x="100" y="116" textAnchor="middle" fontSize="12" fill="#7a869a">items</text>
    </svg>
  );
}

function Legend({ counts, keys }) {
  keys = keys || Object.keys(counts).filter((k) => k !== "total");
  const total = keys.reduce((s, k) => s + (counts[k] || 0), 0) || 1;
  return (
    <div className="dash-legend">
      {keys.map((k) => (
        <div key={k} className="dash-legend-item">
          <span className="dash-swatch" style={{ background: COLORS[k] || "#9aa6bd" }} />
          <span className="dash-legend-name">{LABELS[k] || k}</span>
          <span className="dash-legend-value">
            {counts[k] || 0} ({Math.round((counts[k] || 0) / total * 100)}%)
          </span>
        </div>
      ))}
    </div>
  );
}

/* ─── KPI tile ─────────────────────────────────────────────── */

function Kpi({ cls, label, value, foot, onClick }) {
  const clickable = !!onClick;
  return (
    <button
      type="button"
      className={`dash-kpi ${cls}${clickable ? " clickable" : ""}`}
      onClick={onClick || undefined}
      disabled={!clickable}
      style={!clickable ? { cursor: "default" } : undefined}
    >
      <div className="dash-kpi-label">{label}</div>
      <div className="dash-kpi-value">{value}</div>
      {foot && <div className="dash-kpi-foot">{foot}</div>}
      {clickable && <div className="dash-click-note">Click to open details</div>}
    </button>
  );
}

/* ─── Delayed list ─────────────────────────────────────────── */

function DelayList({ rows, mode = "row", limit, onOpenItem, onOpenProject, delayFilter }) {
  const items = limit ? rows.slice(0, limit) : rows;
  if (!items.length) return <div className="dash-empty">No delayed track found.</div>;
  if (mode === "project") {
    const max = Math.max(...items.map((x) => x.count || 1), 1);
    return (
      <div className="dash-delay-list">
        {items.map((x, i) => {
          const p = x.project;
          const context = `${p.organisation} / ${p.division} / max ${x.delay}d delay`;
          return (
            <button key={p.id + i} className="dash-delay-row" type="button"
              onClick={() => onOpenProject && onOpenProject(p, delayFilter)}>
              <div className="dash-delay-name">
                {p.id} — {x.name}
                <span className="dash-delay-context">{context}</span>
              </div>
              <div className="dash-delay-meter">
                <span className="dash-delay-pill">{x.count} item{x.count === 1 ? "" : "s"}</span>
                <div className="dash-delay-track">
                  <div className="dash-delay-fill" style={{ width: `${Math.max(8, x.count / max * 100).toFixed(1)}%` }} />
                </div>
              </div>
            </button>
          );
        })}
      </div>
    );
  }
  const max = Math.max(...items.map((x) => x.delay || 1), 1);
  return (
    <div className="dash-delay-list">
      {items.map((x) => {
        const p = x.project;
        const context = `${p.organisation} / ${p.division} / ${x.kind}`;
        return (
          <button key={x.key} className="dash-delay-row" type="button"
            onClick={() => onOpenItem && onOpenItem(p, x.key)}>
            <div className="dash-delay-name">
              {p.id} — {x.name}
              <span className="dash-delay-context">{context}</span>
            </div>
            <div className="dash-delay-meter">
              <span className="dash-delay-pill">{x.delay}d</span>
              <div className="dash-delay-track">
                <div className="dash-delay-fill" style={{ width: `${Math.max(8, x.delay / max * 100).toFixed(1)}%` }} />
              </div>
            </div>
          </button>
        );
      })}
    </div>
  );
}

/* ─── Org / Division signal cards ──────────────────────────── */

function SignalCards({ groups, limit, onClick }) {
  const visible = limit ? groups.slice(0, limit) : groups;
  if (!visible.length) return <div className="dash-empty">No groups.</div>;
  const max = Math.max(...visible.map((g) => g.projects.length || 1), 1);
  return (
    <div className="dash-signal-grid">
      {visible.map((g) => {
        const c = g.counts;
        const rows = [
          ["Total", g.projects.length, "var(--dash-navy)"],
          ["Completed", c.completed, "var(--dash-green)"],
          ["On Track", c.ontrack, "var(--dash-cyan)"],
          ["Delayed", c.delayed, "var(--dash-saffron)"],
        ];
        return (
          <button key={g.name} type="button" className="dash-signal-card"
            onClick={() => onClick && onClick(g.name)}>
            <div className="dash-signal-head">
              <span className="dash-signal-name">{g.name}</span>
              <span className="dash-signal-total">
                {g.projects.length} project{g.projects.length === 1 ? "" : "s"}
              </span>
            </div>
            {rows.map((r) => (
              <div key={r[0]} className="dash-signal-row">
                <span>{r[0]}</span>
                <span className="dash-signal-bar">
                  <div style={{ width: `${Math.max(5, r[1] / max * 100).toFixed(1)}%`, background: r[2] }} />
                </span>
                <span className="dash-signal-num">{r[1]}</span>
              </div>
            ))}
          </button>
        );
      })}
    </div>
  );
}

/* ─── Project picker combo ─────────────────────────────────── */

function Picker({ projects, selectedId, open, onToggle, onPick }) {
  const [query, setQuery] = useState("");
  const selected = projects.find((p) => p.id === selectedId);
  const filtered = projects.filter((p) => {
    if (!query) return true;
    const q = query.toLowerCase();
    return [p.id, p.name, p.organisation, p.division, p.owner]
      .some((s) => String(s || "").toLowerCase().includes(q));
  });
  return (
    <div className="dash-picker">
      <div className="dash-picker-row">
        <span className="dash-picker-label">Project</span>
        <div className={`dash-combo${open ? " open" : ""}`}>
          <button className="dash-combo-btn" type="button" onClick={onToggle}>
            <span className="dash-combo-title">
              {selected ? `${selected.id} — ${selected.name}` : "Select a project"}
            </span>
            <span>{open ? "▲" : "▼"}</span>
          </button>
          <div className="dash-combo-menu">
            <input
              className="dash-combo-search" type="search"
              placeholder="Search project from dropdown"
              value={query} onChange={(e) => setQuery(e.target.value)}
              autoFocus
            />
            <div className="dash-option-list">
              {filtered.length === 0
                ? <div className="dash-empty">No matching project.</div>
                : filtered.map((p) => (
                    <button key={p.id} type="button"
                      className={`dash-project-option${selectedId === p.id ? " active" : ""}`}
                      onClick={() => { onPick(p.id); setQuery(""); }}>
                      <span className="dash-project-option-id">{p.id} / {p.status}</span>
                      <span className="dash-project-option-name">{p.name}</span>
                      <span className="dash-project-option-meta">
                        {p.organisation} / {p.division} / {p.owner || "—"}
                      </span>
                    </button>
                  ))
              }
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ─── Delay filter dropdown ────────────────────────────────── */

function DelayFilter({ value, onChange }) {
  return (
    <span className="dash-card-tools">
      <label htmlFor="dashDelayFilter">Delayed by</label>
      <select id="dashDelayFilter" value={value} onChange={(e) => onChange(Number(e.target.value) || 5)}>
        {[5, 10, 15, 20, 30].map((n) => (
          <option key={n} value={n}>{n} days</option>
        ))}
      </select>
    </span>
  );
}

/* ─── Main Dashboard component ─────────────────────────────── */

const TITLE_BY_VIEW = {
  summary: "Dashboard",
  project: "Project View",
  org: "Organization View",
  division: "Division View",
  projects: "Search Project",
  track: "Track Progress",
};

export default function Dashboard() {
  const navigate = useNavigate();

  /* Live project list — populated from GET /api/v3/dashboard/projects.
     Each entry carries BE-computed bucket / progress / counters under
     `_be`, so the existing helpers short-circuit derivation. */
  const [projects, setProjects] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(null);
  const [reloadTick, setReloadTick] = useState(0);

  // Cache of full tree per project UUID — fetched lazily when a single
  // project drill-down view (Project View / Track Progress) is opened.
  const [trees, setTrees] = useState({});

  useEffect(() => {
    let cancelled = false;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLoading(true);
    setLoadError(null);
    fetchDashboardProjects({ pageSize: 200 })
      .then((payload) => {
        if (cancelled) return;
        const cards = Array.isArray(payload?.projects) ? payload.projects : [];
        setProjects(cards.map(projectCardToLegacy).filter(Boolean));
      })
      .catch((err) => {
        if (cancelled) return;
        setLoadError(err?.message || "Failed to load dashboard.");
        setProjects([]);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, [reloadTick]);

  const [view, setView] = useState("summary");
  const [selectedProject, setSelectedProject] = useState(null);
  const [comboOpen, setComboOpen] = useState(false);
  const [org, setOrg] = useState(null);
  const [division, setDivision] = useState(null);
  const [showAllOrg, setShowAllOrg] = useState(false);
  const [showAllDivision, setShowAllDivision] = useState(false);
  const [projectListMode, setProjectListMode] = useState(null);
  const [searchText, setSearchText] = useState("");
  const [delayFilter, setDelayFilter] = useState(5);
  const [track, setTrack] = useState(null);
  function handleRefresh() {
    setTrees({});
    setReloadTick((n) => n + 1);
  }

  // Lazy-fetch /tree the first time a single project is needed in depth
  // (Project View KPIs that come from /dashboard/projects/{id} OR Track
  // Progress drill-down that needs the full M→A→T→ST hierarchy).
  // Mutates `trees` cache; merges tree data into the project's milestones.
  const ensureTree = useMemo(() => async (projectId) => {
    const p = projects.find((x) => x.id === projectId);
    if (!p?.uuid || trees[p.uuid]) return;
    try {
      const tree = await getRawProjectTree(p.uuid);
      setTrees((prev) => ({ ...prev, [p.uuid]: tree }));
    } catch {
      // Network or 401 — silently keep the light data we already have.
    }
  }, [projects, trees]);

  // Hydrated array view used by per-project consumers that need
  // milestones; for list-only views, plain `projects` is sufficient.
  const projectsHydrated = useMemo(() => projects.map((p) => {
    const tree = trees[p.uuid];
    return tree ? treeToLegacyProject(tree, p) : p;
  }), [projects, trees]);

  function openTrack(scope) {
    setTrack({
      ...scope,
      minDelay: scope.minDelay
        ?? (scope.status === "delayed" ? delayFilter : null),
    });
    setView("track");
    if (scope.projectId) {
      ensureTree(scope.projectId);
    } else {
      // No projectId — TrackProgress walks every project in scope. Light
      // list rows don't carry M→A→T→ST yet, so fan out a tree fetch per
      // project that matches the scope. Filters narrow the set.
      projects.forEach((p) => {
        if (scope.org && p.organisation !== scope.org) return;
        if (scope.division && p.division !== scope.division) return;
        if (scope.status === "delayed" && !(p._be?.delayedItemCount > 0)) return;
        ensureTree(p.id);
      });
    }
  }

  function selectView(v) {
    setView(v);
    setComboOpen(false);
    setTrack(null);
    if (v !== "org") setOrg(null);
    if (v !== "division") setDivision(null);
  }

  function openProject(id) {
    setSelectedProject(id);
    setView("project");
    setComboOpen(false);
    ensureTree(id);
  }

  function navigateToPM(p /*, key */) {
    /* "Open in PM" — jump to our Project Details page. While the
       Dashboard is mocked, this lands on /projects/{designId}; once
       the backend ships real data, swap `p.id` for the real project
       UUID returned by the API. */
    if (!p?.id) return;
    navigate(`/projects/${encodeURIComponent(p.id)}`);
  }

  return (
    <div className="dashboard-wrap">
      <div className="dash-page-head">
        <div className="dash-page-title">{TITLE_BY_VIEW[view] || "Dashboard"}</div>
        <button type="button" className="dash-primary-btn" onClick={handleRefresh}>
          Refresh
        </button>
      </div>

      <div className="dash-view-tabs" role="tablist">
        {[
          { id: "summary", label: "Summary" },
          { id: "project", label: "Project View" },
          { id: "org", label: "Organization View" },
        ].map((t) => (
          <button key={t.id} type="button" role="tab"
            className={`dash-tab${view === t.id || (view === "track" && track?.projectId && t.id === "project") ? " active" : ""}`}
            onClick={() => selectView(t.id)}>
            {t.label}
          </button>
        ))}
      </div>

      {loading && <div className="dash-empty" style={{ padding: 24 }}>Loading dashboard…</div>}
      {!loading && loadError && (
        <div className="dash-empty" style={{ padding: 24, color: "#d4440e" }}>
          {loadError} <button type="button" className="dash-ghost-btn" onClick={handleRefresh}>Retry</button>
        </div>
      )}
      {!loading && !loadError && projects.length === 0 && (
        <div className="dash-empty" style={{ padding: 24 }}>No projects yet.</div>
      )}

      <section className="dash-view" hidden={loading || !!loadError || projects.length === 0}>
        {view === "summary" && (
          <SummaryView
            projects={projects} delayFilter={delayFilter} setDelayFilter={setDelayFilter}
            onOpenProjectList={(mode) => { setProjectListMode(mode); setSearchText(""); setView("projects"); }}
            onOpenTrack={openTrack}
            onOpenOrg={(name) => { setOrg(name); setShowAllOrg(false); setView("org"); }}
            onOpenDivision={(name) => { setDivision(name); setShowAllDivision(false); setView("division"); }}
            onShowAllOrg={() => { setShowAllOrg(true); setOrg(null); setView("org"); }}
            onShowAllDivision={() => { setShowAllDivision(true); setDivision(null); setView("division"); }}
          />
        )}
        {view === "project" && (
          <ProjectView
            projects={projectsHydrated} selectedId={selectedProject}
            comboOpen={comboOpen} setComboOpen={setComboOpen}
            onPick={(id) => { setSelectedProject(id); setComboOpen(false); ensureTree(id); }}
            delayFilter={delayFilter} setDelayFilter={setDelayFilter}
            onOpenTrack={openTrack}
          />
        )}
        {view === "org" && (
          <OrgOrDivisionView
            projects={projects} kind="org" name={org} showAll={showAllOrg}
            onOpenGroup={(name) => setOrg(name)}
            onShowAll={() => setShowAllOrg(true)}
            onBack={() => setOrg(null)}
            onOpenProject={openProject}
            onOpenTrack={openTrack}
          />
        )}
        {view === "division" && (
          <OrgOrDivisionView
            projects={projects} kind="division" name={division} showAll={showAllDivision}
            onOpenGroup={(name) => setDivision(name)}
            onShowAll={() => setShowAllDivision(true)}
            onBack={() => setDivision(null)}
            onOpenProject={openProject}
            onOpenTrack={openTrack}
          />
        )}
        {view === "projects" && (
          <ProjectListView
            projects={projects} mode={projectListMode || "total"}
            searchText={searchText} onSearch={setSearchText}
            onOpenProject={openProject}
          />
        )}
        {view === "track" && (
          <TrackProgressView
            projects={projectsHydrated} scope={track || {}}
            delayFilter={delayFilter} setDelayFilter={(v) => {
              setDelayFilter(v);
              if (track && track.status === "delayed") setTrack({ ...track, minDelay: v });
            }}
            onBack={() => {
              if (track?.projectId) {
                setSelectedProject(track.projectId);
                setView("project");
              } else {
                setView("summary");
              }
              setTrack(null);
            }}
            onOpenItem={(p, key) => openTrack({ projectId: p.id, key })}
            onOpenPM={navigateToPM}
          />
        )}
      </section>
    </div>
  );
}

/* ─── Summary view ─────────────────────────────────────────── */

function SummaryView({
  projects, delayFilter, setDelayFilter,
  onOpenProjectList, onOpenTrack, onOpenOrg, onOpenDivision,
  onShowAllOrg, onShowAllDivision,
}) {
  const today = todayDate();
  const c = countsForProjects(projects, today);
  const orgs = groupBy(projects, "organisation");
  const divs = groupBy(projects, "division");
  const delays = delayedProjectsFor(projects, delayFilter, today);
  const totalDelayedItems = delays.reduce((s, d) => s + d.count, 0);
  const VIS = 4, VIS_GROUPS = 3;
  const activeCount = projects.filter((p) => projectBucket(p, today) !== "completed").length;

  return (
    <>
      <div className="dash-kpi-grid">
        <Kpi cls="total" label="Total Projects" value={projects.length}
          foot={`${orgs.length} organizations / ${divs.length} divisions`}
          onClick={() => onOpenProjectList("total")} />
        <Kpi cls="total" label="Active Projects" value={activeCount}
          foot="open project list" onClick={() => onOpenProjectList("active")} />
        <Kpi cls="completed" label="Completed Projects" value={c.completed}
          foot="delivered projects" onClick={() => onOpenProjectList("completed")} />
        <Kpi cls="ontrack" label="On Track" value={c.ontrack}
          foot="within schedule" onClick={() => onOpenProjectList("ontrack")} />
        <Kpi cls="delayed" label="Delayed" value={c.delayed}
          foot="open delayed track" onClick={() => onOpenTrack({ status: "delayed" })} />
      </div>

      <div className="dash-grid-2">
        <div className="dash-card">
          <div className="dash-card-title">Pie Chart<span className="dash-card-sub">Project status</span></div>
          <div className="dash-donut-wrap">
            <Donut counts={c} keys={["active", "completed", "ontrack", "delayed"]} />
            <Legend counts={c} keys={["active", "completed", "ontrack", "delayed"]} />
          </div>
        </div>
        <div className="dash-card">
          <div className="dash-card-title">
            Delayed Track
            <DelayFilter value={delayFilter} onChange={setDelayFilter} />
            <span className="dash-card-sub">
              {delays.length} project{delays.length === 1 ? "" : "s"} / {totalDelayedItems} item{totalDelayedItems === 1 ? "" : "s"} delayed by {delayFilter}+ days
            </span>
          </div>
          <DelayList rows={delays} mode="project" limit={VIS}
            onOpenProject={(p, df) => onOpenTrack({ projectId: p.id, status: "delayed", minDelay: df })}
            delayFilter={delayFilter} />
          {delays.length > VIS && (
            <div className="dash-actions">
              <button type="button" className="dash-more-btn"
                onClick={() => onOpenTrack({ status: "delayed", minDelay: delayFilter })}>
                +{delays.length - VIS} More
              </button>
            </div>
          )}
        </div>
      </div>

      <div className="dash-grid-2">
        <div className="dash-card">
          <div className="dash-card-title">Organization View<span className="dash-card-sub">Total / Completed / On Track / Delayed</span></div>
          <SignalCards groups={orgs} limit={VIS_GROUPS} onClick={onOpenOrg} />
          {orgs.length > VIS_GROUPS && (
            <div className="dash-actions">
              <button type="button" className="dash-more-btn" onClick={onShowAllOrg}>
                +{orgs.length - VIS_GROUPS} More
              </button>
            </div>
          )}
        </div>
        <div className="dash-card">
          <div className="dash-card-title">Division View<span className="dash-card-sub">Total / Completed / On Track / Delayed</span></div>
          <SignalCards groups={divs} limit={VIS_GROUPS} onClick={onOpenDivision} />
          {divs.length > VIS_GROUPS && (
            <div className="dash-actions">
              <button type="button" className="dash-more-btn" onClick={onShowAllDivision}>
                +{divs.length - VIS_GROUPS} More
              </button>
            </div>
          )}
        </div>
      </div>
    </>
  );
}

/* ─── Project view ─────────────────────────────────────────── */

function ProjectView({
  projects, selectedId, comboOpen, setComboOpen, onPick,
  delayFilter, setDelayFilter, onOpenTrack,
}) {
  const today = todayDate();
  const p = projects.find((x) => x.id === selectedId);
  if (!p) {
    return (
      <>
        <Picker projects={projects} selectedId={selectedId}
          open={comboOpen} onToggle={() => setComboOpen(!comboOpen)} onPick={onPick} />
        <div className="dash-card">
          <div className="dash-empty">Select a project to see details, KPIs and pie chart.</div>
        </div>
      </>
    );
  }
  const pk = kpisForProject(p, today);
  const rows = flattenRows(p, { today });
  const chartRows = rows.filter((r) => r.kind === "milestone" || r.kind === "activity");
  const chartCounts = countsForRows(chartRows);
  const delays = flattenRows(p, { status: "delayed", minDelay: delayFilter, today });
  const VIS = 4;

  return (
    <>
      <Picker projects={projects} selectedId={selectedId}
        open={comboOpen} onToggle={() => setComboOpen(!comboOpen)} onPick={onPick} />

      <div className="dash-project-head">
        <div className="dash-project-id">{p.id} / {p.status}</div>
        <div className="dash-project-title">{p.name}</div>
        <div className="dash-project-desc">{p.description || "—"}</div>
        <div className="dash-project-meta">
          <div className="dash-meta-item"><span className="dash-meta-label">Organization</span><span className="dash-meta-value">{p.organisation}</span></div>
          <div className="dash-meta-item"><span className="dash-meta-label">Division</span><span className="dash-meta-value">{p.division}</span></div>
          <div className="dash-meta-item"><span className="dash-meta-label">Owner</span><span className="dash-meta-value">{p.owner || "—"}</span></div>
          <div className="dash-meta-item"><span className="dash-meta-label">Planned</span><span className="dash-meta-value">{range(p.plannedStart, p.plannedEnd)}</span></div>
        </div>
        <div className="dash-progress-line">
          <span className="dash-meta-label">Progress</span>
          <div className="dash-progress-track"><div className="dash-progress-fill" style={{ width: `${pk.progress}%` }} /></div>
          <span className="dash-progress-pct">{pk.progress}%</span>
        </div>
      </div>

      <div className="dash-kpi-grid">
        <Kpi cls="total" label="Overall Progress" value={pk.progress + "%"}
          foot={`${pk.tasksDone}/${pk.tasksTotal} tasks completed`}
          onClick={() => onOpenTrack({ projectId: p.id })} />
        <Kpi cls="completed" label="Milestones" value={`${pk.milestonesDone}/${pk.milestonesTotal}`}
          foot="open milestones" onClick={() => onOpenTrack({ projectId: p.id, kind: "milestone" })} />
        <Kpi cls="ontrack" label="Activities" value={`${pk.activitiesDone}/${pk.activitiesTotal}`}
          foot="open activities" onClick={() => onOpenTrack({ projectId: p.id, kind: "activity" })} />
        <Kpi cls="pending" label="Pending for Approval" value={pk.pendingApprovals}
          foot="activities only"
          onClick={() => onOpenTrack({ projectId: p.id, kind: "activity", approval: true })} />
        <Kpi cls="delayed" label="Delayed" value={pk.delayed}
          foot="open delayed items"
          onClick={() => onOpenTrack({ projectId: p.id, status: "delayed" })} />
      </div>

      <div className="dash-grid-2">
        <div className="dash-card">
          <div className="dash-card-title">Project Pie Chart<span className="dash-card-sub">Milestones and activities</span></div>
          <div className="dash-donut-wrap">
            <Donut counts={chartCounts} keys={["active", "completed", "ontrack", "delayed"]} />
            <Legend counts={chartCounts} keys={["active", "completed", "ontrack", "delayed"]} />
          </div>
        </div>
        <div className="dash-card">
          <div className="dash-card-title">
            Delayed Track
            <DelayFilter value={delayFilter} onChange={setDelayFilter} />
            <span className="dash-card-sub">{delays.length} item{delays.length === 1 ? "" : "s"} delayed by {delayFilter}+ days</span>
          </div>
          <DelayList rows={delays} limit={VIS}
            onOpenItem={(proj, key) => onOpenTrack({ projectId: proj.id, key })} />
          {delays.length > VIS && (
            <div className="dash-actions">
              <button type="button" className="dash-more-btn"
                onClick={() => onOpenTrack({ projectId: p.id, status: "delayed", minDelay: delayFilter })}>
                +{delays.length - VIS} More
              </button>
            </div>
          )}
        </div>
      </div>
    </>
  );
}

/* ─── Org / Division view ──────────────────────────────────── */

function OrgOrDivisionView({ projects, kind, name, showAll, onOpenGroup, onShowAll, onBack, onOpenProject, onOpenTrack }) {
  const today = todayDate();
  const field = kind === "org" ? "organisation" : "division";
  const groups = groupBy(projects, field);
  const VIS = 4;

  if (name) {
    const g = groups.find((x) => x.name === name);
    if (!g) return <div className="dash-empty">Group not found.</div>;
    const c = g.counts;
    return (
      <>
        <div className="dash-project-head">
          <div className="dash-project-title">{name}</div>
          <div className="dash-project-desc">{g.projects.length} projects with completed, on track and delayed project counts.</div>
          <div className="dash-track-actions">
            <button type="button" className="dash-ghost-btn" onClick={onBack}>Back</button>
          </div>
        </div>
        <div className="dash-kpi-grid">
          <Kpi cls="total" label="Total Projects" value={g.projects.length} foot="assigned projects" />
          <Kpi cls="completed" label="Completed" value={c.completed} foot="delivered"
            onClick={() => onOpenTrack({ [kind === "org" ? "org" : "division"]: name, projectMode: "completed" })} />
          <Kpi cls="ontrack" label="On Track" value={c.ontrack} foot="within schedule"
            onClick={() => onOpenTrack({ [kind === "org" ? "org" : "division"]: name, projectMode: "ontrack" })} />
          <Kpi cls="delayed" label="Delayed" value={c.delayed} foot="open delayed tracks"
            onClick={() => onOpenTrack({ [kind === "org" ? "org" : "division"]: name, status: "delayed" })} />
        </div>
        <div className="dash-card">
          <div className="dash-card-title">Pie Chart<span className="dash-card-sub">{name}</span></div>
          <div className="dash-donut-wrap">
            <Donut counts={c} keys={["active", "completed", "ontrack", "delayed"]} />
            <Legend counts={c} keys={["active", "completed", "ontrack", "delayed"]} />
          </div>
        </div>
        <div className="dash-card">
          <div className="dash-card-title">Projects<span className="dash-card-sub">Click project to open Project View</span></div>
          <ProjectCardGrid projects={g.projects} onOpenProject={onOpenProject} />
        </div>
      </>
    );
  }

  const c = countsForProjects(projects, today);
  const visible = showAll ? groups : groups.slice(0, VIS);
  return (
    <>
      <div className="dash-card">
        <div className="dash-card-title">
          Pie Chart<span className="dash-card-sub">All {kind === "org" ? "organizations" : "divisions"} / project status</span>
        </div>
        <div className="dash-donut-wrap">
          <Donut counts={c} keys={["active", "completed", "ontrack", "delayed"]} />
          <Legend counts={c} keys={["active", "completed", "ontrack", "delayed"]} />
        </div>
      </div>
      <div className="dash-card">
        <div className="dash-card-title">
          All {kind === "org" ? "Organizations" : "Divisions"}
          <span className="dash-card-sub">Click {kind === "org" ? "organization" : "division"} to see projects</span>
        </div>
        <SignalCards groups={visible} onClick={onOpenGroup} />
        {!showAll && groups.length > VIS && (
          <div className="dash-actions">
            <button type="button" className="dash-more-btn" onClick={onShowAll}>
              +{groups.length - VIS} More
            </button>
          </div>
        )}
      </div>
    </>
  );
}

function ProjectCardGrid({ projects, onOpenProject }) {
  const today = todayDate();
  if (!projects.length) return <div className="dash-empty">No projects found.</div>;
  return (
    <div className="dash-project-card-grid">
      {projects.map((p) => {
        const pk = kpisForProject(p, today);
        const st = projectBucket(p, today);
        return (
          <button key={p.id} type="button" className="dash-project-card"
            onClick={() => onOpenProject(p.id)}>
            <span className="dash-project-card-id">{p.id}</span>
            <div className="dash-project-card-title">{p.name}</div>
            <div className="dash-project-card-meta">{p.organisation} / {p.division} / {p.owner || "—"}</div>
            <div className="dash-project-card-meta">
              <span className={`dash-pill ${st}`}>{LABELS[st]}</span> {pk.progress}% complete
            </div>
          </button>
        );
      })}
    </div>
  );
}

/* ─── Project list view ────────────────────────────────────── */

function ProjectListView({ projects, mode, searchText, onSearch, onOpenProject }) {
  const today = todayDate();
  const q = searchText.trim().toLowerCase();
  const rows = projects.filter((p) => {
    if (mode !== "total") {
      if (mode === "active" && projectBucket(p, today) === "completed") return false;
      else if (mode !== "active" && projectBucket(p, today) !== mode) return false;
    }
    return !q || [p.id, p.name, p.organisation, p.division, p.owner]
      .join(" ").toLowerCase().includes(q);
  });
  const titleMap = {
    total: "All Projects", active: "Active Projects", completed: "Completed Projects",
    ontrack: "On Track Projects", delayed: "Delayed Projects",
  };
  const title = titleMap[mode] || "Projects";
  const c = countsForProjects(rows, today);
  return (
    <>
      <div className="dash-card">
        <div className="dash-card-title">Pie Chart<span className="dash-card-sub">{title} status distribution</span></div>
        <div className="dash-donut-wrap">
          <Donut counts={c} keys={["active", "completed", "ontrack", "delayed"]} />
          <Legend counts={c} keys={["active", "completed", "ontrack", "delayed"]} />
        </div>
      </div>
      <div className="dash-card">
        <div className="dash-card-title">{title}<span className="dash-card-sub">{rows.length} project{rows.length === 1 ? "" : "s"}</span></div>
        <input className="dash-list-search" type="search" value={searchText}
          placeholder="Search Project" onChange={(e) => onSearch(e.target.value)} />
        <ProjectCardGrid projects={rows} onOpenProject={onOpenProject} />
      </div>
    </>
  );
}

/* ─── Track Progress view ──────────────────────────────────── */

function TrackProgressView({ projects, scope, delayFilter, setDelayFilter, onBack, onOpenItem, onOpenPM }) {
  const rows = trackRows(projects, scope);
  const c = countsForRows(rows);
  const avg = rows.length ? Math.round(rows.reduce((s, r) => s + r.progress, 0) / rows.length) : 0;
  const pending = rows.filter((r) => r.kind === "activity" && pendingApproval(r.node)).length;
  const p = scope.projectId ? projects.find((x) => x.id === scope.projectId) : null;
  const isDelayed = scope.status === "delayed";
  const titleMap = { milestone: "Milestones", activity: "Activities", task: "Tasks", subtask: "Sub Tasks" };
  const title = scope.approval
    ? "Activities Pending for Approval"
    : isDelayed ? "Delayed Tracks"
    : (scope.kind && titleMap[scope.kind]) ? titleMap[scope.kind]
    : "Track Progress";

  const kindKeys = ["milestone", "activity", "task", "subtask"];
  const statusKeys = ["active", "completed", "ontrack", "delayed"];
  const byKind = { milestone: 0, activity: 0, task: 0, subtask: 0, total: rows.length };
  rows.forEach((r) => { if (byKind[r.kind] != null) byKind[r.kind]++; });
  const pieCounts = isDelayed ? byKind : c;
  const pieKeys = isDelayed ? kindKeys : statusKeys;
  const pieSubtitle = isDelayed
    ? "Delayed items by hierarchy level"
    : scope.kind ? `${titleMap[scope.kind] || scope.kind} status distribution`
    : "Status distribution";

  const subParts = [];
  if (p) subParts.push(`${p.id} — ${p.name}`); else subParts.push("All projects");
  if (scope.kind) subParts.push(scope.kind);
  if (scope.org) subParts.push(scope.org);
  if (scope.division) subParts.push(scope.division);
  if (isDelayed && scope.minDelay) subParts.push(`delayed by ${scope.minDelay}+ days`);

  return (
    <>
      <div className="dash-track-head">
        <div className="dash-track-head-title">{title}</div>
        <div className="dash-track-sub">{subParts.join(" / ")}</div>
        <div className="dash-track-actions">
          <button type="button" className="dash-ghost-btn" onClick={onBack}>Back</button>
        </div>
      </div>

      <div className="dash-kpi-grid">
        <Kpi cls="total" label="Overall Progress" value={avg + "%"} foot={`${rows.length} items in scope`} />
        <Kpi cls="total" label="Total Items" value={rows.length} foot="selected scope" />
        <Kpi cls="completed" label="Completed" value={c.completed} foot="finished" />
        {!(scope.kind === "milestone" || scope.kind === "activity") &&
          <Kpi cls="delayed" label="Delayed" value={c.delayed} foot="past expected end date" />}
        {!(scope.kind === "milestone" || scope.kind === "activity") &&
          <Kpi cls="ontrack" label="On Track" value={c.ontrack} foot="within schedule" />}
        {(scope.kind === "activity" || scope.approval) &&
          <Kpi cls="pending" label="Pending for Approval" value={pending} foot="activities only" />}
      </div>

      <div className="dash-card">
        <div className="dash-card-title">
          Pie Chart
          {isDelayed && <DelayFilter value={delayFilter} onChange={setDelayFilter} />}
          <span className="dash-card-sub">{pieSubtitle}</span>
        </div>
        <div className="dash-donut-wrap">
          <Donut counts={pieCounts} keys={pieKeys} />
          <Legend counts={pieCounts} keys={pieKeys} />
        </div>
      </div>

      <div className="dash-track-table-wrap">
        <table className="dash-track-table">
          <thead>
            <tr>
              <th>WBS</th><th>Name</th><th>Progress</th><th>Status</th>
              <th>Expected Dates</th><th>Actual Dates</th><th>Type</th><th>Project Management</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr><td colSpan={8}><div className="dash-empty">No track items found.</div></td></tr>
            ) : rows.map((r) => (
              <tr key={r.project.id + r.key} className={`dash-row-${r.kind}`}
                onClick={() => onOpenItem && onOpenItem(r.project, r.key)}>
                <td className="dash-wbs">{r.wbs}</td>
                <td>
                  <span className="dash-track-name">{r.name}</span>
                  <span className="dash-track-context">{r.project.id} / {r.context}</span>
                </td>
                <td>
                  <div className="dash-mini-progress">
                    <span className="dash-mini-bar"><div style={{ width: `${r.progress}%` }} /></span>
                    <span className="dash-mini-pct">{r.progress}%</span>
                  </div>
                </td>
                <td>
                  <span className={`dash-pill ${r.status}`}>{LABELS[r.status]}</span>
                  {r.kind === "activity" && (
                    <><br /><span className="dash-pill pending" style={{ marginTop: 4 }}>
                      {(r.approvalState || "idle").replace("_", " ")}
                    </span></>
                  )}
                </td>
                <td className="dash-date-cell">{range(r.plannedStart, r.plannedEnd)}</td>
                <td className="dash-date-cell">{r.actualStart ? range(r.actualStart, r.actualEnd) : "-"}</td>
                <td><span className="dash-type-pill">{r.kind}</span></td>
                <td onClick={(e) => e.stopPropagation()}>
                  <button type="button" className="dash-pm-btn"
                    onClick={() => onOpenPM(r.project, r.key)}>
                    Open in PM
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
