/* Dashboard / Summary view — MOCKUP LAYOUT (2026-07).
   Executive overview: 6 gradient KPI cards + four widget rows (portfolio
   health, operations, roll-up tables). All data now comes from ONE call:
   GET /dashboard/summary-view (see src/api/dashboardConsolidated.js) — no
   more per-project finance loop, no tickets/meetings/approval fan-out.
   Drill-down sub-views (project list / division / project items) still
   use the per-resource dashboard endpoints for click-through. */

import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { FiCalendar, FiClock, FiClipboard, FiSun } from "react-icons/fi";
import {
  projectsList as fetchDashboardProjects,
  projectItems as fetchProjectItems,
  projectCardToLegacy,
  extractProjectsPayload,
} from "../../api/dashboard";
import { summaryViewWithFallback as fetchSummaryView } from "../../api/dashboardConsolidated";
import {
  API_BUCKETS, LABELS, COLORS,
  Kpi, ProjectCardGrid,
  itemRowToTrackRow, extractItemsPayload,
  countsForProjects,
  range, todayDate,
} from "./_shared";
import {
  DonutChart, StackedBar, TrendArea, FunnelBars, GaugeRing, formatINR, DOMAIN,
} from "./charts";
import { KpiCard, Widget, Stat4, PriorityBars, SplitBars } from "./kit";
import "../../styles/Dashboard.css";

function numberValue(...values) { return Number(values.find((value) => value !== undefined && value !== null && value !== "") ?? 0) || 0; }

const TICKET_PRIORITY_COLORS = {
  critical: "#e11d48",
  p1: "#e11d48",
  urgent: "#e11d48",
  high: "#d4440e",
  p2: "#d4440e",
  medium: "#b25900",
  p3: "#b25900",
  normal: "#0aa1c0",
  low: "#1a8a3d",
  p4: "#1a8a3d",
};

function priorityLabel(row = {}) {
  return row.label || row.name || row.priority || row.code || row.key || "Priority";
}

function priorityColor(row = {}) {
  const key = String(row.code || row.priority || row.label || row.name || "").toLowerCase().replace(/[\s-]+/g, "_");
  return row.color || TICKET_PRIORITY_COLORS[key] || "#0b3c88";
}

function normalizeTicketPriorityRows(rows = []) {
  return (Array.isArray(rows) ? rows : []).map((row) => {
    const total = numberValue(row.total, row.count, row.value, row.tickets, row.open);
    return {
      label: priorityLabel(row),
      total,
      open: numberValue(row.open, row.openCount, row.pending, total),
      closed: numberValue(row.closed, row.closedCount, row.resolved, Math.max(total - numberValue(row.open, row.openCount, row.pending, 0), 0)),
      color: priorityColor(row),
    };
  });
}

function normalizeProjectStatus(raw = {}, totalFallback = 0) {
  const completed = numberValue(raw.completed, raw.done);
  const ontrack = numberValue(raw.ontrack, raw.inProgress, raw.in_progress);
  const delayed = numberValue(raw.delayed, raw.delayedProjects);
  const total = numberValue(raw.total, raw.projects, raw.value, totalFallback, completed + ontrack + delayed);
  const activeRaw = raw.active ?? raw.notStarted ?? raw.not_started;
  const activeCandidate = numberValue(activeRaw);
  const active = activeRaw !== undefined && activeRaw !== null && activeRaw !== "" && activeCandidate + completed + ontrack + delayed <= total
    ? activeCandidate
    : Math.max(total - completed - ontrack - delayed, 0);
  return { total, active, completed, ontrack, delayed };
}

function pctOf(value, total) {
  const denominator = numberValue(total);
  if (!denominator) return 0;
  return Math.round((numberValue(value) / denominator) * 100);
}

export default function SummaryView() {
  const navigate = useNavigate();

  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(null);
  const [reloadTick, setReloadTick] = useState(0);
  const [subView, setSubView] = useState(null);

  useEffect(() => {
    let cancelled = false;
    Promise.resolve().then(async () => {
      if (cancelled) return;
      setLoading(true); setLoadError(null);
      try {
        const payload = await fetchSummaryView({ delayMinDays: 1, topN: 5 });
        if (cancelled) return;
        setData(payload || null);
        setLoading(false);
      } catch (e) {
        if (cancelled) return;
        console.error("[SummaryView] summary-view failed:", e?.message || e);
        setLoadError("Failed to load dashboard. Please retry.");
        setData(null); setLoading(false);
      }
    });

    return () => { cancelled = true; };
  }, [reloadTick]);

  function handleRefresh() { setReloadTick((n) => n + 1); }

  // Refresh trigger comes from the global header (moved out of the ViewBar).
  useEffect(() => {
    const h = () => setReloadTick((n) => n + 1);
    window.addEventListener("pmis:dashboard-refresh", h);
    return () => window.removeEventListener("pmis:dashboard-refresh", h);
  }, []);

  function openProjectList(mode) { setSubView({ kind: "projects", mode, searchText: "" }); }
  function openDivision(name) { setSubView({ kind: "division", name }); }
  function openProjectItems(project, opts = {}) { setSubView({ kind: "project-items", project, status: opts.status || null }); }
  function backToSummary() { setSubView(null); }
  function openProject(uuid) { navigate(`/dashboard/project?id=${encodeURIComponent(uuid)}`); }
  function openOrg(name) { navigate(`/dashboard/org?name=${encodeURIComponent(name)}`); }

  return (
    <div className="dashboard-wrap">
      {loading && <div className="dash-empty" style={{ padding: 24 }}>Loading dashboard…</div>}
      {!loading && loadError && (
        <div className="dash-empty" style={{ padding: 24, color: "#d4440e" }}>
          {loadError} <button type="button" className="dash-ghost-btn" onClick={handleRefresh}>Retry</button>
        </div>
      )}
      {!loading && !loadError && !data && (
        <div className="dash-empty" style={{ padding: 24 }}>No projects yet.</div>
      )}

      <section className="dash-view" hidden={loading || !!loadError || !data}>
        {subView === null && data && (
          <SummaryContent
            data={data}
            onOpenProjectList={openProjectList} onOpenProjectItems={openProjectItems}
            onOpenOrg={openOrg} onOpenDivision={openDivision} navigate={navigate}
          />
        )}
        {subView?.kind === "projects" && (
          <ProjectListView mode={subView.mode} searchText={subView.searchText}
            onSearch={(v) => setSubView((s) => ({ ...s, searchText: v }))}
            onBack={backToSummary} onOpenProject={openProject} />
        )}
        {subView?.kind === "division" && (
          <DivisionDetail name={subView.name} onBack={backToSummary} onOpenProject={openProject} />
        )}
        {subView?.kind === "project-items" && (
          <ProjectItemsInline project={subView.project} status={subView.status} onBack={backToSummary} navigate={navigate} />
        )}
      </section>
    </div>
  );
}

function SummaryContent({ data, onOpenProjectList, onOpenProjectItems, onOpenOrg, onOpenDivision, navigate }) {
  const kpis = data.kpis || {};
  const kProjects = kpis.totalProjects || {};
  const kOnTrack = kpis.onTrackPct || {};
  const kDelayed = kpis.delayedProjects || {};
  const kContract = kpis.contractValue || {};
  const kReleased = kpis.released || {};
  const kSla = kpis.slaCompliance || {};

  const status = data.projectStatus || {};
  const counts = normalizeProjectStatus(status, kProjects.value);

  const phaseData = (data.paymentByPhase || []).map((p) => ({
    label: p.label, Scheduled: p.scheduled, "One-time": p.oneTime, "Carry-fwd": p.carriedOut,
  }));
  const costTypeCounts = {
    fixed: data.costComposition?.fixed ?? 0,
    one_time: data.costComposition?.oneTime ?? 0,
    recurring: data.costComposition?.recurring ?? 0,
  };
  const payByOrg = data.paymentByOrganization || [];
  const monthlyTrend = (data.monthlyTrend || []).map((row) => ({
    label: row.month || row.label || "—",
    "Projects Completed": numberValue(row.projectsCompleted, row.completedProjects, row.completed),
    "Released (Cr)": numberValue(row.releasedCr, row.released, row.amountReleasedCr),
  }));

  const sla = data.slaHealth || {};
  const workflow = data.approvalWorkflow || {};
  const tickets = data.tickets || {};
  const ticketPriorityRows = normalizeTicketPriorityRows(tickets.byPriority || tickets.priority || tickets.priorities || tickets.by_priority);
  const meetings = data.meetings || {};


  const orgs = data.topOrganizations || [];
  const divs = data.topDivisions || [];
  const delayedList = Array.isArray(data.delayedTrack) ? data.delayedTrack : [];
  const escalations = data.escalationsTriggered || tickets.escalations || [];

  return (
    <>
      {/* ── 6 gradient KPI cards ── */}
      <div className="dp-kpi-grid">
        <KpiCard tone="blue" icon=" " label="Total Projects" value={kProjects.value ?? 0}
          split={[{ k: "Active", v: kProjects.active ?? 0 }, { k: "Completed", v: kProjects.completed ?? 0 }]}
          delta={kProjects.delta} spark={kProjects.spark}
          onClick={() => onOpenProjectList("total")} />
        <KpiCard tone="cyan" icon=" " label="In Progress" value={counts.ontrack ?? 0} gauge={kOnTrack.value ?? 0}
          delta={kOnTrack.delta}
          onClick={() => onOpenProjectList("ontrack")} />
        <KpiCard tone="orange" icon=" " label="Delayed Projects" value={kDelayed.value ?? 0}
          foot={kDelayed.maxDelayDays ? `Max Delay ${kDelayed.maxDelayDays} Days` : "no delays"}
          delta={kDelayed.delta} spark={kDelayed.spark} onClick={() => onOpenProjectList("delayed")} />
        <KpiCard tone="green" icon=" " label="Total Contract Value" value={formatINR(kContract.value ?? 0)}
          foot={kContract.projectCount != null ? `${kContract.withFinance ?? 0} of ${kContract.projectCount} projects` : undefined}
          delta={kContract.delta} spark={kContract.spark}
          onClick={() => navigate("/dashboard/org")} />
        <KpiCard tone="teal" icon=" " label="Amount Released" value={formatINR(kReleased.value ?? 0)}
          foot={`${kReleased.pctOfContract ?? 0}% of contract`}
          delta={kReleased.delta} spark={kReleased.spark}
          onClick={() => navigate("/dashboard/org")} />
        <KpiCard tone="amber" icon=" " label="SLA Compliance"
          value={kSla.value != null ? `${kSla.value}%` : "N/A"}
          foot={kSla.evaluated != null ? `${kSla.met ?? 0} of ${kSla.evaluated} met` : undefined}
          gauge={kSla.value != null ? kSla.value : undefined}
          delta={kSla.delta} />
      </div>

      {/* ── Widgets — 3 per row ── */}
      <div className="dp-row c3">
        <Widget title="Project Status" sub={`${counts.total} total`} onClick={() => onOpenProjectList("total")}>
          <DonutChart counts={counts} keys={["active", "completed", "ontrack", "delayed"]} centerLabel="projects" height={180} />
        </Widget>
        <Widget title="Payment by Phase" sub="Scheduled / One-time / Carry-fwd" onClick={() => navigate("/dashboard/org")}>
          {phaseData.length
            ? <div style={{ flex: 1, display: "flex", flexDirection: "column", minHeight: 0 }}>
                <StackedBar data={phaseData} money height="100%"
                  series={[
                    { key: "Scheduled", name: "Scheduled", color: DOMAIN.finance },
                    { key: "One-time", name: "One-time", color: DOMAIN.slaSoft },
                    { key: "Carry-fwd", name: "Carry-fwd", color: DOMAIN.neutral },
                  ]} />
              </div>
            : <div className="dash-empty">No phased payment data.</div>}
        </Widget>
        <Widget title="SLA Health" sub="by activities">
          {sla.available ? (
            <div className="dp-gauge-wrap">
              <GaugeRing value={sla.compliance} label="SLA Compliance" color={DOMAIN.finance} height={150} />
              <SplitBars rows={[
                { label: "Met", a: sla.met, b: 0, aColor: DOMAIN.finance, aLabel: `${sla.met ?? 0} (${sla.compliance ?? pctOf(sla.met, sla.evaluated)}%)` },
                { label: "Breached", a: sla.breached, b: 0, aColor: "#e11d48", aLabel: `${sla.breached ?? 0} (${pctOf(sla.breached, sla.evaluated)}%)` },
                { label: "Pending", a: sla.pending, b: 0, aColor: DOMAIN.neutral, aLabel: `${sla.pending ?? 0}` },
              ]} />
            </div>
          ) : (
            <div className="dash-empty" style={{ padding: "26px 12px", lineHeight: 1.6 }}>
              SLA compliance not available.
            </div>
          )}
        </Widget>
        <Widget title="Approval Workflow" sub={workflow.available ? `${workflow.total} in pipeline` : "activity approvals"} onClick={() => navigate("/approvals/concerned-division")}>
          {(!workflow.available || !workflow.total) && (
            <div className="dash-empty">No activities in the approval workflow.</div>
          )}
          {workflow.available && workflow.total > 0 && (
            <FunnelBars stages={(workflow.stages || []).map((s, i) => ({
              ...s, color: [DOMAIN.neutral, DOMAIN.workflowSoft, DOMAIN.workflow, DOMAIN.finance, DOMAIN.tickets][i] || DOMAIN.workflow,
            }))} />
          )}
        </Widget>
      {/* operations */}
        <Widget title="Tickets by Priority" sub={tickets.available ? `${tickets.total} tickets` : "support tickets"} onClick={() => navigate("/tickets")}>
          {!tickets.available && <div className="dash-empty">Ticket service unavailable.</div>}
          {tickets.available && (
            ticketPriorityRows.length
              ? <PriorityBars rows={ticketPriorityRows} />
              : <div className="dash-empty">No tickets found.</div>
          )}
        </Widget>
        <Widget title="Meetings Overview" sub={meetings.available ? `${meetings.total} total` : "meetings"} onClick={() => navigate("/meetings")}>
          {!meetings.available && <div className="dash-empty">Meetings service unavailable.</div>}
          {meetings.available && (
            <Stat4 items={[
              { k: "Today", v: meetings.today, icon: <FiSun size={14} /> },
              { k: "This Week", v: meetings.thisWeek, icon: <FiCalendar size={14} /> },
              { k: "Upcoming", v: meetings.upcoming, icon: <FiClock size={14} /> },
              { k: "Pending MoM", v: meetings.pendingMom, icon: <FiClipboard size={14} /> },
            ]} />
          )}
        </Widget>
        <Widget title="Monthly Trend" sub="completed projects / released" >
          {monthlyTrend.length
            ? <TrendArea data={monthlyTrend} height={210} series={[
                { key: "Projects Completed", name: "Completed", color: DOMAIN.schedule },
                { key: "Released (Cr)", name: "Released Cr", color: DOMAIN.finance },
              ]} />
            : <div className="dash-empty">No monthly trend data.</div>}
        </Widget>
      {/* roll-up tables */}
        <Widget title="Top Organizations" link="View All Organizations" onLink={() => navigate("/dashboard/org")} onClick={() => navigate("/dashboard/org")}>
          <table className="dp-mtable">
            <thead><tr><th>Organization</th><th className="num">Proj</th><th className="num">Value</th><th className="num">Delayed</th></tr></thead>
            <tbody>
              {orgs.slice(0, 5).map((o) => (
                <tr key={o.name}>
                  <td><button className="dp-link-name" onClick={() => onOpenOrg(o.name)}>{o.name}</button></td>
                  <td className="num">{o.total}</td>
                  <td className="num">{o.value ? formatINR(o.value) : "—"}</td>
                  <td className="num dp-danger">{o.delayed}</td>
                </tr>
              ))}
              {!orgs.length && <tr><td colSpan={4}><div className="dash-empty">No organizations.</div></td></tr>}
            </tbody>
          </table>
        </Widget>
        <Widget title="Top Divisions" link="View All Divisions" onLink={() => onOpenDivision(divs[0]?.name || "")} onClick={() => onOpenDivision(divs[0]?.name || "")}>
          <table className="dp-mtable">
            <thead><tr><th>Division</th><th className="num">Proj</th><th className="num">Value</th><th className="num">Delayed</th></tr></thead>
            <tbody>
              {divs.slice(0, 5).map((dv) => (
                <tr key={dv.name}>
                  <td><button className="dp-link-name" onClick={() => onOpenDivision(dv.name)}>{dv.name}</button></td>
                  <td className="num">{dv.total}</td>
                  <td className="num">{dv.value ? formatINR(dv.value) : "—"}</td>
                  <td className="num dp-danger">{dv.delayed}</td>
                </tr>
              ))}
              {!divs.length && <tr><td colSpan={4}><div className="dash-empty">No divisions.</div></td></tr>}
            </tbody>
          </table>
        </Widget>
        <Widget title="Delayed Track" sub="delay > 0" onClick={() => onOpenProjectList("delayed")}>
          <table className="dp-mtable">
            <thead><tr><th>Project</th><th className="num">Delay</th><th className="num">Items</th></tr></thead>
            <tbody>
              {delayedList.slice(0, 5).map((dl) => (
                <tr key={dl.projectId || dl.projectCode}>
                  <td>
                    <button className="dp-link-name"
                      title={dl.name || dl.projectName || "—"}
                      onClick={() => onOpenProjectItems({ id: dl.projectCode, uuid: dl.projectId, name: dl.name, organisation: dl.organisation, division: dl.division }, { status: "delayed" })}>
                      {dl.name || dl.projectName || "—"}
                    </button>
                  </td>
                  <td className="num dp-danger">{dl.maxDelayDays}d</td>
                  <td className="num">{dl.delayedItems}</td>
                </tr>
              ))}
              {!delayedList.length && <tr><td colSpan={3}><div className="dash-empty">No delayed projects.</div></td></tr>}
            </tbody>
          </table>
        </Widget>
        <Widget title="Escalations Triggered" sub="ticket-derived" onClick={() => navigate("/tickets")}>
          <table className="dp-mtable">
            <thead><tr><th>Issue</th><th className="num">Count</th><th style={{ textAlign: "right" }}>Severity</th></tr></thead>
            <tbody>
              {escalations.map((e) => (
                <tr key={e.issue}>
                  <td>{e.issue}</td>
                  <td className="num">{e.count}</td>
                  <td style={{ textAlign: "right" }}><span className={`dp-tag ${e.severity}`}>{e.severity}</span></td>
                </tr>
              ))}
              {!escalations.length && <tr><td colSpan={3}><div className="dash-empty">No escalations.</div></td></tr>}
            </tbody>
          </table>
        </Widget>
        <Widget title="Payment by Organization" sub="contract value per vendor" onClick={() => navigate("/dashboard/org")}>
          {payByOrg.length
            ? <StackedBar vertical money height={Math.max(200, Math.min(8, payByOrg.length) * 34 + 40)}
                data={payByOrg.slice(0, 8).map((o) => ({ label: o.name, Value: o.contractValue }))}
                series={[{ key: "Value", name: "Contract Value", color: DOMAIN.finance }]} />
            : <div className="dash-empty">No finance data.</div>}
        </Widget>
        {(costTypeCounts.fixed + costTypeCounts.one_time + costTypeCounts.recurring > 0) && (
          <Widget title="Cost Composition" sub="Fixed / One-time / Recurring" onClick={() => navigate("/dashboard/org")}>
            <DonutChart counts={costTypeCounts} keys={["fixed", "one_time", "recurring"]} centerLabel="contract ₹" money height={220} />
          </Widget>
        )}
      </div>

      <div className="dp-footer-note">
        All dates in DD-MM-YYYY (IST) · Amounts in ₹ (Indian Rupees) · 1 Cr = 100 Lakh.
      </div>
    </>
  );
}

/* ─── Drill-down sub-views (preserved — use per-resource endpoints) ── */

function ProjectListView({ mode, searchText, onSearch, onBack, onOpenProject }) {
  const bucket = API_BUCKETS[mode] || null;
  const [list, setList] = useState([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);

  useEffect(() => {
    let cancelled = false;
    Promise.resolve().then(async () => {
      if (cancelled) return;
      setBusy(true); setErr(null);
      const query = bucket ? { bucket, pageSize: 200 } : { pageSize: 200 };
      try {
        const payload = await fetchDashboardProjects(query);
        if (cancelled) return;
        const cards = extractProjectsPayload(payload);
        setList(cards.map(projectCardToLegacy).filter(Boolean)); setBusy(false);
      } catch {
        if (cancelled) return; setErr("Failed to load projects. Please retry."); setList([]); setBusy(false);
      }
    });
    return () => { cancelled = true; };
  }, [bucket]);

  const q = searchText.trim().toLowerCase();
  const rows = useMemo(() => list.filter((p) => !q || [p.id, p.name, p.organisation, p.division, p.owner].join(" ").toLowerCase().includes(q)), [list, q]);
  const titleMap = { total: "All Projects", active: "Active Projects", completed: "Completed Projects", ontrack: "In Progress Projects", delayed: "Delayed Projects" };
  const title = titleMap[mode] || "Projects";

  return (
    <>
      <div className="dash-card">
        <div className="dash-card-title">{title}<span className="dash-card-sub">{rows.length} project{rows.length === 1 ? "" : "s"}</span><button type="button" className="dash-ghost-btn" style={{ marginLeft: "auto" }} onClick={onBack}>← Back</button></div>
        <input className="dash-list-search" type="search" value={searchText} placeholder="Search Project" onChange={(e) => onSearch(e.target.value)} />
        {busy && <div className="dash-empty">Loading projects…</div>}
        {!busy && err && <div className="dash-empty" style={{ color: "#d4440e" }}>{err}</div>}
        {!busy && !err && <ProjectCardGrid projects={rows} onOpenProject={(id) => { const p = rows.find((x) => x.id === id); onOpenProject(p?.uuid || id); }} />}
      </div>
    </>
  );
}

function DivisionDetail({ name, onBack, onOpenProject }) {
  const today = useMemo(() => todayDate(), []);
  const [list, setList] = useState([]);
  const [busy, setBusy] = useState(true);
  const [err, setErr] = useState(null);

  useEffect(() => {
    let cancelled = false;
    Promise.resolve().then(async () => {
      if (cancelled) return;
      setBusy(true); setErr(null);
      try {
        const payload = await fetchDashboardProjects({ division: name, pageSize: 200 });
        if (cancelled) return;
        const cards = extractProjectsPayload(payload);
        setList(cards.map(projectCardToLegacy).filter(Boolean)); setBusy(false);
      } catch {
        if (cancelled) return; setErr("Failed to load projects. Please retry."); setList([]); setBusy(false);
      }
    });
    return () => { cancelled = true; };
  }, [name]);

  const c = useMemo(() => countsForProjects(list, today), [list, today]);

  return (
    <>
      <div className="dash-project-head">
        <div className="dash-project-title">{name}</div>
        <div className="dash-project-desc">{busy ? "Loading projects…" : `${list.length} project${list.length === 1 ? "" : "s"} in this division.`}</div>
        <div className="dash-track-actions"><button type="button" className="dash-ghost-btn" onClick={onBack}>← Back</button></div>
      </div>
      {busy && <div className="dash-empty">Loading projects…</div>}
      {!busy && err && <div className="dash-empty" style={{ color: "#d4440e" }}>{err}</div>}
      {!busy && !err && (
        <>
          <div className="dash-kpi-grid">
            <Kpi cls="total" label="Total Projects" value={list.length} foot="assigned projects" />
            <Kpi cls="completed" label="Completed" value={c.completed} foot="delivered" />
            <Kpi cls="ontrack" label="In Progress" value={c.ontrack} foot="within schedule" />
            <Kpi cls="delayed" label="Delayed" value={c.delayed} foot="delayed projects" />
          </div>
          <div className="dash-card">
            <div className="dash-card-title">Status Distribution<span className="dash-card-sub">{name}</span></div>
            <DonutChart counts={c} keys={["completed", "ontrack", "delayed", "active"]} centerLabel="projects" />
          </div>
          <div className="dash-card">
            <div className="dash-card-title">Projects<span className="dash-card-sub">Click project to open Project View</span></div>
            <ProjectCardGrid projects={list} onOpenProject={(id) => { const p = list.find((x) => x.id === id); onOpenProject(p?.uuid || id); }} />
          </div>
        </>
      )}
    </>
  );
}

function ProjectItemsInline({ project, status, onBack, navigate }) {
  function openInPM() { const id = project?.uuid || project?.id; if (!id) return; navigate(`/projects/${encodeURIComponent(id)}/config`); }
  const [items, setItems] = useState([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);

  useEffect(() => {
    let cancelled = false;
    Promise.resolve().then(async () => {
      if (cancelled || !project?.uuid) return;
      setBusy(true); setErr(null);
      try {
        const payload = await fetchProjectItems(project.uuid, { bucket: status || undefined });
        if (cancelled) return;
        const rows = extractItemsPayload(payload);
        setItems(rows.map((r) => itemRowToTrackRow(r, project))); setBusy(false);
      } catch {
        if (cancelled) return; setErr("Failed to load project items. Please retry."); setItems([]); setBusy(false);
      }
    });
    return () => { cancelled = true; };
  }, [project, status]);

  const isDelayed = status === "delayed";
  const title = isDelayed ? "Delayed Tracks" : "Project Items";
  if (!project) {
    return (
      <>
        <div className="dash-track-head"><div className="dash-track-head-title">{title}</div>
          <div className="dash-track-actions"><button type="button" className="dash-ghost-btn" onClick={onBack}>← Back</button></div></div>
        <div className="dash-empty">Project not found.</div>
      </>
    );
  }
  const c = items.reduce((acc, r) => { acc[r.status] = (acc[r.status] || 0) + 1; acc.total = (acc.total || 0) + 1; return acc; }, { active: 0, ontrack: 0, completed: 0, delayed: 0, total: 0 });
  const pieCounts = isDelayed ? { delayed: c.delayed, total: c.delayed } : c;
  const pieKeys = isDelayed ? ["delayed"] : ["active", "completed", "ontrack", "delayed"];

  return (
    <>
      <div className="dash-track-head">
        <div className="dash-track-head-title">{title}</div>
        <div className="dash-track-sub">{project.id} — {project.name}</div>
        <div className="dash-track-actions"><button type="button" className="dash-ghost-btn" onClick={onBack}>← Back</button></div>
      </div>
      {!isDelayed && (
        <div className="dash-kpi-grid">
          <Kpi cls="total" label="Total Items" value={c.total} foot="milestones + activities" />
          <Kpi cls="completed" label="Completed" value={c.completed} foot="finished" />
          <Kpi cls="ontrack" label="In Progress" value={c.ontrack} foot="within schedule" />
          <Kpi cls="delayed" label="Delayed" value={c.delayed} foot="past expected end date" />
        </div>
      )}
      {!isDelayed && (
        <div className="dash-card">
          <div className="dash-card-title">Status Distribution<span className="dash-card-sub">Milestones &amp; activities</span></div>
          <DonutChart counts={pieCounts} keys={pieKeys} centerLabel="items" />
        </div>
      )}
      <div className="dash-track-table-wrap" style={{ marginTop: "20px", marginBottom: "20px" }}>
        {busy && <div className="dash-empty">Loading items…</div>}
        {!busy && err && <div className="dash-empty" style={{ color: "#d4440e" }}>{err}</div>}
        {!busy && !err && (
          <table className="dash-track-table">
            <thead><tr><th>WBS</th><th>Name</th><th>Progress</th><th>Status</th><th>Expected Dates</th><th>Actual Dates</th><th>Delay</th><th>Type</th><th>Approval</th><th>Project Management</th></tr></thead>
            <tbody>
              {items.length === 0 ? (
                <tr><td colSpan={10}><div className="dash-empty">No items found.</div></td></tr>
              ) : items.map((r) => (
                <tr key={r.key} className={`dash-row-${r.kind}`}>
                  <td className="dash-wbs">{r.wbs}</td>
                  <td><span className="dash-track-name">{r.name}</span><span className="dash-track-context">{r.context}</span></td>
                  <td><div className="dash-mini-progress"><span className="dash-mini-bar"><div style={{ width: `${r.progress}%`, background: COLORS[r.status] }} /></span><span className="dash-mini-pct">{r.progress}%</span></div></td>
                  <td><span className={`dash-pill ${r.status}`}>{LABELS[r.status] || r.status}</span></td>
                  <td className="dash-date-cell">{range(r.plannedStart, r.plannedEnd)}</td>
                  <td className="dash-date-cell">{r.actualStart ? range(r.actualStart, r.actualEnd) : "-"}</td>
                  <td>{r.delay ? `${r.delay}d` : "-"}</td>
                  <td><span className="dash-type-pill">{r.kind}</span></td>
                  <td>{r.kind === "activity" && <span className={`dash-pill approval-${r.approvalState || "idle"}`}>{LABELS[r.approvalState] || r.approvalState || "Idle"}</span>}</td>
                  <td><button type="button" className="dash-pm-btn" onClick={openInPM}>Open in PM</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </>
  );
}