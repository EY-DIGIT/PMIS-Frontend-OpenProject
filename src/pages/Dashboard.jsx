import { useEffect, useMemo, useState } from "react";
import {
  PieChart, Pie, Cell, BarChart, Bar, XAxis, YAxis,
  Tooltip, ResponsiveContainer
} from "recharts";
import { useProjects as useProjectsList } from "./../store/project/projectsStore";
import { useData } from "../data/DataContext";
import { hydrateProjects } from "../store/project/apiSync";
import "../styles/Dashboard.css";

const STATUS_COLORS = {
  completed:  "#1a8a3d",
  ontrack:    "#0aa1c0",
  delayed:    "#d4440e",
  notstarted: "#9aa6bd",
};
const STATUS_LABELS = {
  completed:  "Completed",
  ontrack:    "On Track",
  delayed:    "Delayed",
  notstarted: "Not Started",
};
const STATUS_ORDER = ["completed", "ontrack", "delayed", "notstarted"];

const VIEW_TABS = [
  { id: "project",  label: "Project View",        icon: "📁" },
  { id: "vendor",   label: "Vendor wise View",    icon: "🏢" },
  { id: "division", label: "Division/Owner wise View", icon: "👥" },
];

/* Treat anything past today's date as "delayed" only when the project
   isn't already CLOSED / COMPLETED. */
function statusOf(p) {
  const s = String(p?.status || "").toLowerCase();
  if (s === "closed" || s === "completed") return "completed";
  if (!p?.endDate) return "ontrack";
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const end = new Date(p.endDate);
  end.setHours(0, 0, 0, 0);
  if (end < today) return "delayed";
  if (s === "new" || s === "draft") return "notstarted";
  return "ontrack";
}

function aggregate(projects) {
  const counters = { total: projects.length, completed: 0, ontrack: 0, delayed: 0, notstarted: 0 };
  for (const p of projects) {
    counters[statusOf(p)] = (counters[statusOf(p)] || 0) + 1;
  }
  return counters;
}

function groupByVendor(projects) {
  const groups = new Map();
  for (const p of projects) {
    const vs = Array.isArray(p?.vendors) ? p.vendors : [];
    if (!vs.length) {
      const k = "(none)";
      groups.set(k, (groups.get(k) || []).concat(p));
      continue;
    }
    for (const v of vs) {
      const name = typeof v === "string" ? v : (v?.name || v?.id || "");
      if (!name) continue;
      groups.set(name, (groups.get(name) || []).concat(p));
    }
  }
  return groups;
}

function groupByDivision(projects) {
  const groups = new Map();
  for (const p of projects) {
    const key = (p?.owner || "").toString().toLowerCase() || "(unassigned)";
    groups.set(key, (groups.get(key) || []).concat(p));
  }
  return groups;
}

function divisionLabel(code) {
  if (!code) return "—";
  const c = String(code).toLowerCase();
  if (c === "tmd1") return "TMD1";
  if (c === "tmd2") return "TMD2";
  if (c === "others") return "Others";
  if (c === "(unassigned)") return "Unassigned";
  return code;
}

export default function Dashboard() {
  const projects = useProjectsList();
  const { vendors, users } = useData();
  const [view, setView] = useState("project");
  const [search, setSearch] = useState("");
  const [refreshing, setRefreshing] = useState(false);

  useEffect(() => { hydrateProjects(); }, []);

  async function handleRefresh() {
    if (refreshing) return;
    setRefreshing(true);
    try { await hydrateProjects({ force: true }); }
    catch { /* swallow */ }
    finally { setRefreshing(false); }
  }

  function handleReset() {
    setView("project");
    setSearch("");
  }

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return projects;
    return projects.filter((p) =>
      [p.projectName, p.projectCode, p.description, p.owner]
        .filter(Boolean)
        .some((s) => String(s).toLowerCase().includes(q))
    );
  }, [projects, search]);

  const totals = useMemo(() => aggregate(filtered), [filtered]);

  const kpis = useMemo(() => {
    if (view === "project") {
      return [
        { id: "total",      cls: "k-total",      label: "Total Projects", value: totals.total },
        { id: "completed",  cls: "k-completed",  label: "Completed",      value: totals.completed },
        { id: "ontrack",    cls: "k-ontrack",    label: "On Track",       value: totals.ontrack },
        { id: "delayed",    cls: "k-delayed",    label: "Delayed",        value: totals.delayed },
        { id: "notstarted", cls: "k-notstarted", label: "Not Started",    value: totals.notstarted },
      ];
    }
    if (view === "vendor") {
      const groups = groupByVendor(filtered);
      const vendorCount = groups.size - (groups.has("(none)") ? 1 : 0);
      const orphans = (groups.get("(none)") || []).length;
      return [
        { id: "vendors",  cls: "k-total",      label: "Vendors",        value: vendorCount, foot: "with assigned projects" },
        { id: "projects", cls: "k-extra",      label: "Total Projects", value: totals.total },
        { id: "orphans",  cls: "k-notstarted", label: "Unassigned",     value: orphans, foot: "no vendor mapped" },
        { id: "completed",cls: "k-completed",  label: "Completed",      value: totals.completed },
        { id: "delayed",  cls: "k-delayed",    label: "Delayed",        value: totals.delayed },
      ];
    }
    // division
    const groups = groupByDivision(filtered);
    const divs = Array.from(groups.keys()).filter((k) => k !== "(unassigned)");
    return [
      { id: "divisions", cls: "k-total",      label: "Divisions/Owners", value: divs.length },
      { id: "projects",  cls: "k-extra",      label: "Total Projects",   value: totals.total },
      { id: "completed", cls: "k-completed",  label: "Completed",        value: totals.completed },
      { id: "delayed",   cls: "k-delayed",    label: "Delayed",          value: totals.delayed },
      { id: "ontrack",   cls: "k-ontrack",    label: "On Track",         value: totals.ontrack },
    ];
  }, [view, totals, filtered]);

  const breadcrumb = useMemo(() => {
    const labels = {
      project: "All Projects",
      vendor: "All Vendors",
      division: "All Divisions/Owners",
    };
    return [labels[view] || "All"];
  }, [view]);

  return (
    <div className="dashboard-wrap">
      {/* Page header */}
      <div className="dash-page-header">
        <div>
          <div className="dash-page-title">Dashboard</div>
          <div className="dash-page-sub">Real-time analytics across projects, vendors and divisions</div>
        </div>
        <div className="dash-actions">
          <button type="button" className="dash-btn cancel" onClick={handleReset}>
            Reset View
          </button>
          <button type="button" className="dash-btn" onClick={handleRefresh} disabled={refreshing}>
            <span aria-hidden="true" style={{ display: "inline-block", marginRight: 6 }}>↻</span>
            {refreshing ? "Refreshing…" : "Refresh"}
          </button>
        </div>
      </div>

      {/* View tabs */}
      <div className="dash-view-tabs" role="tablist" aria-label="Dashboard view modes">
        {VIEW_TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            className={`dash-tab${view === t.id ? " active" : ""}`}
            data-view={t.id}
            role="tab"
            aria-selected={view === t.id}
            onClick={() => setView(t.id)}
          >
            <span className="tab-ico" aria-hidden="true">{t.icon}</span> {t.label}
          </button>
        ))}
      </div>

      {/* Toolbar: search + breadcrumb */}
      <div className="dash-toolbar">
        <div className="dash-search">
          <span className="dash-search-ico" aria-hidden="true">🔍</span>
          <input
            type="search"
            placeholder={`Search ${view === "vendor" ? "vendors" : view === "division" ? "owners" : "projects"}...`}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            aria-label="Search"
          />
          <button
            type="button"
            className={`dash-search-clear${search ? " visible" : ""}`}
            aria-label="Clear search"
            onClick={() => setSearch("")}
          >
            ✕
          </button>
        </div>
        <div className="dash-breadcrumb">
          {breadcrumb.map((label, i) => (
            <span key={i} className="dash-bc-current">{label}</span>
          ))}
        </div>
      </div>

      {/* KPI tiles */}
      <div className="dash-kpi-grid" role="group" aria-label="Key indicators">
        {kpis.map((k) => (
          <button key={k.id} type="button" className={`dash-kpi ${k.cls} no-drill`}>
            <div className="dash-kpi-label">{k.label}</div>
            <div className="dash-kpi-value">{k.value}</div>
            {k.foot && <div className="dash-kpi-foot">{k.foot}</div>}
          </button>
        ))}
      </div>

      {/* Charts row: Status Distribution donut + Status Mix stacked bar */}
      <div className="dash-chart-row">
        <div className="dash-card">
          <div className="dash-card-title">
            Status Distribution
            <span className="dash-card-sub">{totals.total} item{totals.total === 1 ? "" : "s"}</span>
          </div>
          <StatusDonut totals={totals} />
        </div>
        <div className="dash-card">
          <div className="dash-card-title">
            Status Mix
            <span className="dash-card-sub">
              by {view === "project" ? "owner" : view === "vendor" ? "vendor" : "division"}
            </span>
          </div>
          <StatusMixBar view={view} projects={filtered} />
        </div>
      </div>

      {/* Group breakdown — view-specific */}
      <div className="dash-card">
        <div className="dash-card-title">
          {view === "project" ? "Projects" : view === "vendor" ? "Vendors" : "Divisions / Owners"}
          <span className="dash-card-sub">{filtered.length} item{filtered.length === 1 ? "" : "s"}</span>
        </div>
        <DashboardGroupTable view={view} projects={filtered} />
      </div>
    </div>
  );
}

function StatusDonut({ totals }) {
  const data = STATUS_ORDER
    .map((k) => ({ key: k, name: STATUS_LABELS[k], value: totals[k] || 0 }))
    .filter((d) => d.value > 0);
  if (!data.length) {
    return <div className="dash-empty" style={{ padding: 32 }}>No projects to chart.</div>;
  }
  return (
    <div className="dash-donut-wrap">
      <div style={{ width: "100%", height: 220 }}>
        <ResponsiveContainer>
          <PieChart>
            <Pie
              data={data}
              dataKey="value"
              nameKey="name"
              cx="50%"
              cy="50%"
              innerRadius={55}
              outerRadius={85}
              paddingAngle={2}
              stroke="none"
            >
              {data.map((d) => (
                <Cell key={d.key} fill={STATUS_COLORS[d.key]} />
              ))}
            </Pie>
            <Tooltip
              formatter={(v, name) => [`${v}`, name]}
              contentStyle={{ fontSize: 12, borderRadius: 6 }}
            />
          </PieChart>
        </ResponsiveContainer>
      </div>
      <ul className="dash-legend">
        {data.map((d) => {
          const pct = totals.total ? Math.round((d.value / totals.total) * 100) : 0;
          return (
            <li key={d.key} className="dash-legend-item">
              <span className="dash-legend-swatch" style={{ background: STATUS_COLORS[d.key] }} />
              <span className="dash-legend-label">{d.name}</span>
              <span className="dash-legend-value">{d.value} <small>({pct}%)</small></span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/* Stacked bar: one row per group (vendor / division / owner). Bars colored
   by status. For project-view, group by owner since "by project" would
   give one bar per project which the design shows as "Status Mix by owner". */
function StatusMixBar({ view, projects }) {
  const groups = useMemoGroups(view, projects);
  const data = Array.from(groups.entries()).map(([key, ps]) => {
    const counts = { completed: 0, ontrack: 0, delayed: 0, notstarted: 0 };
    for (const p of ps) counts[statusOf(p)] = (counts[statusOf(p)] || 0) + 1;
    return {
      name: prettyKey(view, key),
      ...counts,
    };
  });
  if (!data.length) {
    return <div className="dash-empty" style={{ padding: 32 }}>No data to chart.</div>;
  }
  return (
    <div style={{ width: "100%", height: 240 }}>
      <ResponsiveContainer>
        <BarChart data={data} layout="vertical" margin={{ top: 5, right: 16, bottom: 5, left: 8 }}>
          <XAxis type="number" tick={{ fontSize: 11, fill: "#5a6680" }} allowDecimals={false} />
          <YAxis
            type="category"
            dataKey="name"
            tick={{ fontSize: 11, fill: "#1e2a3a" }}
            width={100}
          />
          <Tooltip
            cursor={{ fill: "rgba(11,60,136,0.05)" }}
            contentStyle={{ fontSize: 12, borderRadius: 6 }}
          />
          {STATUS_ORDER.map((k) => (
            <Bar
              key={k}
              dataKey={k}
              stackId="status"
              name={STATUS_LABELS[k]}
              fill={STATUS_COLORS[k]}
            />
          ))}
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

function useMemoGroups(view, projects) {
  return useMemo(() => {
    if (view === "vendor") return groupByVendor(projects);
    if (view === "division") return groupByDivision(projects);
    // project view: group by owner (Division)
    const m = new Map();
    for (const p of projects) {
      const k = (p?.owner || "").toLowerCase() || "(unassigned)";
      m.set(k, (m.get(k) || []).concat(p));
    }
    return m;
  }, [view, projects]);
}

function prettyKey(view, key) {
  if (view === "vendor") return key === "(none)" ? "(unassigned)" : key;
  return divisionLabel(key);
}

function DashboardGroupTable({ view, projects }) {
  if (view === "project") {
    return (
      <table className="dash-table">
        <thead>
          <tr>
            <th>Project</th>
            <th>Owner</th>
            <th>Status</th>
            <th>End Date</th>
          </tr>
        </thead>
        <tbody>
          {projects.length === 0 ? (
            <tr><td colSpan={4} className="dash-empty">No projects.</td></tr>
          ) : projects.slice(0, 50).map((p) => (
            <tr key={p.projectId}>
              <td>{p.projectCode || p.projectName}</td>
              <td>{divisionLabel(p.owner)}</td>
              <td><StatusPill status={statusOf(p)} /></td>
              <td>{p.endDate ? new Date(p.endDate).toLocaleDateString("en-IN", { day:"2-digit", month:"short", year:"numeric" }) : "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    );
  }
  if (view === "vendor") {
    const groups = groupByVendor(projects);
    return (
      <table className="dash-table">
        <thead>
          <tr><th>Vendor</th><th>Projects</th><th>Completed</th><th>Delayed</th></tr>
        </thead>
        <tbody>
          {groups.size === 0 ? (
            <tr><td colSpan={4} className="dash-empty">No vendor mapping yet.</td></tr>
          ) : Array.from(groups.entries()).map(([name, ps]) => {
            const a = aggregate(ps);
            return (
              <tr key={name}>
                <td>{name === "(none)" ? <em style={{ color:"#9aa6bd" }}>(unassigned)</em> : name}</td>
                <td>{ps.length}</td>
                <td>{a.completed}</td>
                <td>{a.delayed}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    );
  }
  // division
  const groups = groupByDivision(projects);
  return (
    <table className="dash-table">
      <thead>
        <tr><th>Division / Owner</th><th>Projects</th><th>Completed</th><th>Delayed</th></tr>
      </thead>
      <tbody>
        {groups.size === 0 ? (
          <tr><td colSpan={4} className="dash-empty">No data.</td></tr>
        ) : Array.from(groups.entries()).map(([code, ps]) => {
          const a = aggregate(ps);
          return (
            <tr key={code}>
              <td>{divisionLabel(code)}</td>
              <td>{ps.length}</td>
              <td>{a.completed}</td>
              <td>{a.delayed}</td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

function StatusPill({ status }) {
  const map = {
    completed:  { label: "Completed",   cls: "dash-pill-green" },
    delayed:    { label: "Delayed",     cls: "dash-pill-orange" },
    ontrack:    { label: "On Track",    cls: "dash-pill-cyan" },
    notstarted: { label: "Not Started", cls: "dash-pill-grey" },
  };
  const { label, cls } = map[status] || map.ontrack;
  return <span className={`dash-pill ${cls}`}>{label}</span>;
}
