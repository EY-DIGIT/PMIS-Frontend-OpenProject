/* Shared helpers + small UI components used by the three dashboard
   view pages (SummaryView / ProjectView / OrganizationView).
   Lifted out of the old src/pages/Dashboard.jsx so each view file
   stays focused on layout. */

import { useState } from "react";
import { fromApiDate } from "../../api/adapters";

/* Pull the items array out of a /dashboard/projects/{uuid}/items
   response. The BE response shape can be:
     { data: { items: [...] } }       (unwrapped → { items: [...] })
     { data: { rows: [...] } }        (unwrapped → { rows: [...] })
     { data: [...] }                  (unwrapped → [...])
     [...]                            (already a bare array)
   This helper tolerates all of them so a backend rename can't quietly
   blank the UI. */
export function extractItemsPayload(payload) {
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload?.items)) return payload.items;
  if (Array.isArray(payload?.rows)) return payload.rows;
  if (Array.isArray(payload?.data?.items)) return payload.data.items;
  if (Array.isArray(payload?.data?.rows)) return payload.data.rows;
  if (Array.isArray(payload?.data)) return payload.data;
  return [];
}

/* Convert an ItemRow (milestone | activity) from /dashboard/projects/{id}/items
   into the row shape the dashboard tables/lists consume. WBS, bucket,
   progressPct and daysDelayed come straight from the server. The BE
   may use camelCase or snake_case field names — accept both. */
export function itemRowToTrackRow(raw, project) {
  const row = raw || {};
  const pick = (a, b) => (row[a] !== undefined ? row[a] : row[b]);
  const id = pick("id", "id");
  const kind = pick("kind", "kind");
  const milestoneId = pick("milestoneId", "milestone_id");
  const milestoneName = pick("milestoneName", "milestone_name");
  const wbs = pick("wbs", "wbs");
  const name = pick("name", "name");
  const bucket = pick("bucket", "bucket");
  const progressPct = pick("progressPct", "progress_pct");
  const plannedStart = pick("plannedStart", "planned_start") ?? pick("startDate", "start_date");
  const plannedEnd = pick("plannedEnd", "planned_end") ?? pick("endDate", "end_date");
  const actualStart = pick("actualStart", "actual_start") ?? pick("actualStartDate", "actual_start_date");
  const actualEnd = pick("actualEnd", "actual_end") ?? pick("actualEndDate", "actual_end_date");
  const daysDelayed = pick("daysDelayed", "days_delayed");
  return {
    project,
    key: `${kind}:${id}`,
    parentKey: kind === "activity" && milestoneId ? `milestone:${milestoneId}` : null,
    kind,
    wbs,
    name,
    context: milestoneName || project?.name || "",
    status: bucket || "active",
    progress: progressPct ?? 0,
    plannedStart: fromApiDate(plannedStart),
    plannedEnd: fromApiDate(plannedEnd),
    actualStart: fromApiDate(actualStart),
    actualEnd: fromApiDate(actualEnd),
    delay: daysDelayed ?? 0,
    approvalState: kind === "activity" ? (pick("approvalState", "approval_state") || "idle") : null,
  };
}

/* ─── Constants ────────────────────────────────────────────── */

export const DAY = 86400000;

export const LABELS = {
  active: "Active", not_started: "Not Started",
  completed: "Completed", ontrack: "In Progress", delayed: "Delayed",
  milestone: "Milestones", activity: "Activities", task: "Tasks", subtask: "Sub Tasks",
  // Approval workflow states (dashboard donuts / pills)
  idle: "Idle", pending_division: "Pending Division", pending_owner: "Pending Owner",
  division_approved: "Division Approved", rejected: "Rejected",
  // Finance cost types
  fixed: "Fixed", one_time: "One-time", recurring: "Recurring",
  Scheduled: "Scheduled", Remaining: "Remaining",
};

export const COLORS = {
  active: "#0b3c88", not_started: "#9aa6bd",
  completed: "#1a8a3d", ontrack: "#0aa1c0", delayed: "#d4440e",
  milestone: "#0b3c88", activity: "#0aa1c0", task: "#5e3fb1", subtask: "#b25900",
  // Approval workflow states
  idle: "#9aa6bd", pending_division: "#b25900", pending_owner: "#5e3fb1",
  division_approved: "#0aa1c0", rejected: "#e11d48",
  // Finance cost types
  fixed: "#0b3c88", one_time: "#b25900", recurring: "#0f9d8f",
  Scheduled: "#1a8a3d", Remaining: "#dbe5f1",
};

// Buckets the BE supports on /api/v3/dashboard/projects?bucket=…
// "total" omits the bucket param so the BE returns all projects.
export const API_BUCKETS = {
  active: "active", ontrack: "ontrack", completed: "completed", delayed: "delayed",
};

/* BE returns `scheduleStatus` on each milestone/activity with one of four
   values; the dashboard pie/legend/KPI tiles operate on three buckets, so
   collapse `in_progress` → `ontrack` and `not_started` → `active`. */
const BUCKET_FROM_SCHEDULE = {
  completed: "completed",
  delayed: "delayed",
  in_progress: "ontrack",
  not_started: "ontrack",
};

/* ─── Date helpers ─────────────────────────────────────────── */

export function d(v) { return v ? new Date(v) : null; }
export function fmt(v) {
  const x = v instanceof Date ? v : d(v);
  if (!x || Number.isNaN(x.getTime())) return "-";
  return (
    String(x.getDate()).padStart(2, "0") + "-" +
    String(x.getMonth() + 1).padStart(2, "0") + "-" +
    x.getFullYear()
  );
}
export function range(a, b) { return fmt(a) + " → " + fmt(b); }
export function todayDate() { const t = new Date(); t.setHours(0, 0, 0, 0); return t; }

/* ─── Status / progress helpers ────────────────────────────── */

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
export function taskStatus(t, today = todayDate()) {
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
export function nodeStatus(node, today = todayDate()) {
  const tasks = allTasks(node);
  if (!tasks.length) return "active";
  const st = tasks.map((t) => taskStatus(t, today));
  if (st.every((x) => x === "completed")) return "completed";
  if (st.some((x) => x === "delayed")) return "delayed";
  if (st.some((x) => x === "ontrack" || x === "completed")) return "ontrack";
  return "active";
}
export function projectBucket(p, today) {
  if (p?._be?.bucket) return p._be.bucket;
  return nodeStatus(p, today);
}
export function progress(node, today = todayDate()) {
  const tasks = allTasks(node);
  if (tasks.length) {
    return Math.round(tasks.filter((t) => taskStatus(t, today) === "completed").length / tasks.length * 100);
  }
  if (node && node.status === "completed") return 100;
  return 0;
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
export function pendingApproval(a) {
  return ["pending_division", "pending_owner", "rejected", "division_approved"].includes(a.approvalState);
}

/* All KPI values come from the server-computed `_be` aggregates
   attached to each ProjectCard by /api/v3/dashboard/projects. No
   client-side derivation, no static placeholders. */
export function kpisForProject(p) {
  const be = p?._be || {};
  return {
    progress: be.progressPct ?? 0,
    milestonesDone: be.milestonesCompleted ?? 0,
    milestonesTotal: be.milestonesTotal ?? 0,
    activitiesDone: be.activitiesCompleted ?? 0,
    activitiesTotal: be.activitiesTotal ?? 0,
    delayed: be.delayedItemCount ?? 0,
    maxDelayDays: be.maxDelayDays ?? 0,
  };
}
export function countsForProjects(list, today) {
  const c = { active: 0, completed: 0, ontrack: 0, delayed: 0, total: list.length };
  list.forEach((p) => { c[projectBucket(p, today)]++; });
  return c;
}
export function countsForRows(rows) {
  const c = { active: 0, not_started: 0, completed: 0, ontrack: 0, delayed: 0, total: rows.length };
  rows.forEach((r) => { if (c[r.status] != null) c[r.status]++; });
  return c;
}

export function groupBy(projects, field) {
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

function itemBucket(node, today) {
  if (node && node.status === "completed") return "completed";
  if (node && node.scheduleStatus) {
    return BUCKET_FROM_SCHEDULE[node.scheduleStatus] || "active";
  }
  return nodeStatus(node, today);
}

export function flattenRows(project, opts = {}) {
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
      status: itemBucket(m, today), progress: progress(m, today),
      plannedStart: m.plannedStart || md.plannedStart, plannedEnd: m.plannedEnd || md.plannedEnd,
      actualStart: md.actualStart, actualEnd: md.actualEnd,
      delay: m.daysDelayed != null ? m.daysDelayed : delayDays(m, today),
    });
    (m.activities || []).forEach((a, ai) => {
      const aKey = `${mKey}:a:${ai}`;
      const ad = dates(a);
      rows.push({
        project, key: aKey, parentKey: mKey, kind: "activity",
        wbs: `A${mi + 1}.${ai + 1}`, name: a.name, context: m.name, node: a,
        status: itemBucket(a, today), progress: progress(a, today),
        plannedStart: ad.plannedStart, plannedEnd: ad.plannedEnd,
        actualStart: ad.actualStart, actualEnd: ad.actualEnd,
        delay: a.daysDelayed != null ? a.daysDelayed : delayDays(a, today),
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

export function trackRows(projects, scope = {}) {
  const today = todayDate();
  return projects.filter((p) => {
    if (scope.projectId && p.id !== scope.projectId) return false;
    if (scope.org && p.organisation !== scope.org) return false;
    if (scope.division && p.division !== scope.division) return false;
    if (scope.projectMode && projectBucket(p, today) !== scope.projectMode) return false;
    return true;
  }).flatMap((p) => flattenRows(p, { ...scope, withAncestors: true, today }));
}

export function delayedProjectsFor(list, minDelay, today) {
  return list.map((p) => {
    const be = p?._be;
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

/* ─── Re-export adapter for the BE → legacy card shape ─────── */
/* We rebind it here so the view files don't reach into the API
   layer directly — anything they need lives in this module. */
export function projectCardToLegacy(card) {
  if (!card) return null;
  const orgList = Array.isArray(card.organisations) ? card.organisations : [];
  const primaryOrg = orgList[0] || null;
  return {
    id: card.projectCode || card.id,
    uuid: card.id,
    projectCode: card.projectCode || '',
    name: card.name || '',
    description: card.description || '',
    organisation: primaryOrg ? primaryOrg.name : '—',
    organisations: orgList,
    vendorId: primaryOrg ? primaryOrg.id : null,
    division: card.division || (card.divisionOther ? `${card.division || ''} (${card.divisionOther})` : '—'),
    divisionCode: card.division || null,
    owner: '—',
    status: String(card.lifecycleStatus || 'NEW').toUpperCase(),
    plannedStart: fromApiDate(card.plannedStart),
    plannedEnd: fromApiDate(card.plannedEnd),
    actualStart: fromApiDate(card.actualStart),
    actualEnd: fromApiDate(card.actualEnd),
    milestones: [],
    _be: {
      bucket: card.bucket,
      progressPct: card.progressPct,
      milestonesTotal: card.milestonesTotal,
      milestonesCompleted: card.milestonesCompleted,
      activitiesTotal: card.activitiesTotal,
      activitiesCompleted: card.activitiesCompleted,
      delayedItemCount: card.delayedItemCount,
      maxDelayDays: card.maxDelayDays,
    },
  };
}

/* ─── Donut + bar + Legend ───────────────────────────────────────── */

export function Donut({ counts, keys }) {
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

export function BarChart({ counts, keys }) {
  keys = keys || Object.keys(counts).filter((k) => k !== "total");
  const total = keys.reduce((s, k) => s + (counts[k] || 0), 0);

  if (!total) {
    return (
      <svg className="dash-donut" viewBox="0 0 200 200">
        <rect x="20" y="20" width="160" height="160" fill="none" stroke="#eef3fa" strokeWidth="2" rx="4" />
        <text x="100" y="104" textAnchor="middle" fill="#7a869a" fontSize="13">No data</text>
      </svg>
    );
  }

  const maxVal = Math.max(...keys.map((k) => counts[k] || 0));
  const svgW = 200, svgH = 200;
  const padL = 28, padR = 10, padT = 16, padB = 36;
  const chartW = svgW - padL - padR;
  const chartH = svgH - padT - padB;
  const barW = chartW / keys.length;
  const BAR_GAP = barW * 0.25;

  return (
    <svg className="dash-donut" viewBox={`0 0 ${svgW} ${svgH}`}>
      {/* Y-axis gridlines */}
      {[0, 0.25, 0.5, 0.75, 1].map((frac) => {
        const y = padT + chartH * (1 - frac);
        return (
          <g key={frac}>
            <line x1={padL} x2={padL + chartW} y1={y} y2={y}
              stroke="#eef3fa" strokeWidth="1" />
            <text x={padL - 4} y={y + 4} textAnchor="end"
              fontSize="8" fill="#7a869a">
              {Math.round(maxVal * frac)}
            </text>
          </g>
        );
      })}

      {/* Bars */}
      {keys.map((k, i) => {
        const val = counts[k] || 0;
        const barH = (val / maxVal) * chartH;
        const x = padL + i * barW + BAR_GAP / 2;
        const y = padT + chartH - barH;
        const w = barW - BAR_GAP;
        return (
          <g key={k}>
            <rect x={x} y={y} width={w} height={barH}
              fill={COLORS[k] || "#9aa6bd"} rx="2" />
            <text x={x + w / 2} y={y - 3} textAnchor="middle"
              fontSize="8" fontWeight="700" fill={COLORS[k] || "#9aa6bd"}>
              {val}
            </text>
            <text x={x + w / 2} y={padT + chartH + 10} textAnchor="middle"
              fontSize="7.5" fill="#7a869a">
              {(LABELS[k] || k).slice(0, 6)}
            </text>
          </g>
        );
      })}

      {/* X axis baseline */}
      <line x1={padL} x2={padL + chartW} y1={padT + chartH} y2={padT + chartH}
        stroke="#c8d3e8" strokeWidth="1.5" />
    </svg>
  );
}

export function Legend({ counts, keys }) {
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

export function Kpi({ cls, label, value, foot, onClick }) {
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

export function DelayList({ rows, mode = "row", limit, onOpenItem, onOpenProject, delayFilter }) {
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

/* ─── Signal cards (org/division summary tiles) ────────────── */

export function SignalCards({ groups, limit, onClick }) {
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
          ["In Progress", c.ontrack, "var(--dash-cyan)"],
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

export function Picker({ projects, selectedId, open, onToggle, onPick, loading, error }) {
  const [query, setQuery] = useState("");
  const selected = projects.find((p) => p.id === selectedId);
  const filtered = projects.filter((p) => {
    if (!query) return true;
    const q = query.toLowerCase();
    return [p.id, p.name, p.organisation, p.division, p.owner]
      .some((s) => String(s || "").toLowerCase().includes(q));
  });
  let body;
  if (loading) body = <div className="dash-empty">Loading projects…</div>;
  else if (error) body = <div className="dash-empty" style={{ color: "#d4440e" }}>{error}</div>;
  else if (filtered.length === 0) body = <div className="dash-empty">No matching project.</div>;
  else body = filtered.map((p) => (
    <button key={p.id} type="button"
      className={`dash-project-option${selectedId === p.id ? " active" : ""}`}
      onClick={() => { onPick(p.id); setQuery(""); }}>
      <span className="dash-project-option-id">{p.id} / {p.status}</span>
      <span className="dash-project-option-name">{p.name}</span>
      <span className="dash-project-option-meta">
        {p.organisation} / {p.division} / {p.owner || "—"}
      </span>
    </button>
  ));
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
              {body}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ─── Delay-by-N-days dropdown ─────────────────────────────── */

export function DelayFilter({ value, onChange }) {
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

/* ─── Project card grid ────────────────────────────────────── */

export function ProjectCardGrid({ projects, onOpenProject }) {
  const today = todayDate();
  if (!projects.length) return <div className="dash-empty">No projects found.</div>;
  return (
    <div className="dash-project-card-grid">
      {projects.map((p) => {
        const pk = kpisForProject(p);
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
