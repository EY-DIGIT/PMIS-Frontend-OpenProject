/* Dashboard / Organization view — MOCKUP LAYOUT (2026-07).
   Two modes via a segmented toggle, each backed by ONE call:
   - All Organizations  → GET /dashboard/organisation-view
   - Single Organization → GET /dashboard/organisations/{id}/view
   (src/api/dashboardConsolidated.js). The URL carries ?id=<organisationId>;
   a legacy ?name= deep-link (from the Summary view) is resolved to an id
   against the all-orgs list. */

import { useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import {
  organisationViewAll as fetchOrgViewAll,
  organisationViewById as fetchOrgViewById,
} from "../../api/dashboardConsolidated";
import { LABELS, fmt } from "./_shared";
import { DonutChart, RankedBar, StackedBar, GaugeRing, formatINR, DOMAIN } from "./charts";
import { KpiCard, Widget, SegToggle, Stat4, SplitBars } from "./kit";
import "../../styles/Dashboard.css";

export default function OrganizationView() {
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const idParam = params.get("id") || "";
  const nameParam = params.get("name") || "";
  const mode = idParam || nameParam ? "single" : "all";

  const [reloadTick, setReloadTick] = useState(0);
  const [allData, setAllData] = useState(null);
  const [singleData, setSingleData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState(null);

  useEffect(() => {
    let cancelled = false;
    Promise.resolve().then(async () => {
      if (cancelled) return;
      setLoading(true); setErr(null);
      try {
        if (mode === "all") {
          const all = await fetchOrgViewAll({ topN: 8 });
          if (cancelled) return;
          setAllData(all); setSingleData(null);
        } else {
          let id = idParam;
          if (!id && nameParam) {
            // Resolve a legacy name deep-link to an organisation id.
            const all = await fetchOrgViewAll({ topN: 8 });
            if (cancelled) return;
            const orgs = all?.organizations || all?.organisations || [];
            const targetName = nameParam.trim().toLowerCase();
            id = orgs.find((o) => orgName(o).toLowerCase() === targetName)?.organisationId;
          }
          if (!id) { setErr("Organization not found."); setSingleData(null); setLoading(false); return; }
          const single = await fetchOrgViewById(id);
          if (cancelled) return;
          setSingleData(single);
        }
        setLoading(false);
      } catch (e) {
        if (cancelled) return;
        console.error("[OrgView] load failed:", e?.message || e);
        setErr("Failed to load organizations. Please retry."); setLoading(false);
      }
    });
    return () => { cancelled = true; };
  }, [mode, idParam, nameParam, reloadTick]);

  function handleRefresh() { setReloadTick((n) => n + 1); }
  function setMode(m) {
    if (m === "all") setParams({});
    else {
      const firstId = (allData?.organizations || allData?.organisations || singleData?.organisations || [])[0];
      const id = orgId(firstId);
      setParams(id ? { id } : {});
    }
  }
  function pickOrg(id) { setParams(id ? { id } : {}); }
  function openProject(uuid) { navigate(`/dashboard/project?id=${encodeURIComponent(uuid)}`); }

  // Refresh trigger from the global header.
  useEffect(() => {
    const h = () => setReloadTick((n) => n + 1);
    window.addEventListener("pmis:dashboard-refresh", h);
    return () => window.removeEventListener("pmis:dashboard-refresh", h);
  }, []);

  return (
    <div className="dashboard-wrap">
      <div style={{ display: "flex", marginBottom: 2 }}>
        <SegToggle options={[{ value: "all", label: "All Organizations" }, { value: "single", label: "Single Organization" }]} value={mode} onChange={setMode} />
      </div>

      {loading && <div className="dash-empty" style={{ padding: 24 }}>Loading organizations…</div>}
      {!loading && err && <div className="dash-empty" style={{ padding: 24, color: "#d4440e" }}>{err} <button className="dash-ghost-btn" onClick={handleRefresh}>Retry</button></div>}

      {!loading && !err && mode === "all" && allData && (
        <AllOrgs data={allData} onOpenOrg={pickOrg} />
      )}
      {!loading && !err && mode === "single" && singleData && (
        <SingleOrg data={singleData} onPickOrg={pickOrg} onOpenProject={openProject} />
      )}
    </div>
  );
}

function asArray(value) { return Array.isArray(value) ? value : []; }
function firstDefined(...values) { return values.find((value) => value !== undefined && value !== null && value !== ""); }
function num(...values) { return Number(firstDefined(...values) ?? 0) || 0; }
function orgId(org) { return firstDefined(org?.organisationId, org?.organizationId, org?.vendorId, org?.id) || ""; }
function orgName(org) { return firstDefined(org?.name, org?.organisationName, org?.organizationName, org?.vendorName) || "—"; }
function projectUuid(project) { return firstDefined(project?.uuid, project?.projectUuid, project?.project_id, project?.projectId, project?.id) || ""; }
function statusBucket(status) {
  const raw = String(status || "active").toLowerCase();
  if (["completed", "complete", "done", "closed"].includes(raw)) return "completed";
  if (["delayed", "delay", "behind"].includes(raw)) return "delayed";
  if (["ontrack", "in_progress", "in-progress", "started", "published"].includes(raw)) return "ontrack";
  if (["not_started", "not-started", "new", "draft"].includes(raw)) return "active";
  return raw;
}
function statusCounts(raw = {}) {
  const completed = num(raw.completed, raw.done);
  const delayed = num(raw.delayed, raw.delayedProjects);
  const ontrack = num(raw.ontrack, raw.inProgress, raw.in_progress);
  const total = num(raw.total, raw.projects, raw.value, completed + delayed + ontrack);
  const activeRaw = firstDefined(raw.active, raw.notStarted, raw.not_started);
  const activeCandidate = num(activeRaw);
  const active = activeRaw !== undefined && activeCandidate + completed + delayed + ontrack <= total
    ? activeCandidate
    : Math.max(total - completed - delayed - ontrack, 0);
  return { total, active, completed, ontrack, delayed };
}
function normalizeOrgRow(row) {
  const counts = row?.counts || row || {};
  return {
    ...row,
    organisationId: orgId(row),
    name: orgName(row),
    total: num(counts.total, row?.total, row?.projects, row?.projectCount),
    active: num(counts.active, row?.active),
    completed: num(counts.completed, row?.completed),
    ontrack: num(counts.ontrack, row?.ontrack, row?.inProgress),
    delayed: num(counts.delayed, row?.delayed, row?.delayedProjects),
    contractValue: num(row?.contractValue, row?.value, row?.totalValue),
  };
}
function normalizeProject(row) {
  return {
    ...row,
    uuid: projectUuid(row),
    projectCode: firstDefined(row?.projectCode, row?.code, row?.id) || "—",
    name: firstDefined(row?.name, row?.projectName, row?.title) || "—",
    status: statusBucket(firstDefined(row?.status, row?.bucket, row?.lifecycleStatus)),
    progressPct: num(row?.progressPct, row?.progress, row?.overallProgress),
    contractValue: num(row?.contractValue, row?.value, row?.totalValue),
    scheduled: num(row?.scheduled, row?.scheduledPayout, row?.scheduledAmount),
    delayedItems: num(row?.delayedItems, row?.delayedItemCount, row?.delayed),
    maxDelayDays: num(row?.maxDelayDays, row?.delayDays),
    plannedEnd: firstDefined(row?.plannedEnd, row?.endDate, row?.plannedFinish),
  };
}

/* ─── All-orgs ─── */

function AllOrgs({ data, onOpenOrg }) {
  const kpis = data.kpis || {};
  const kOrgs = kpis.totalOrganizations || {};
  const kProjects = kpis.totalProjects || {};
  const kContract = kpis.contractValue || {};
  const kDelayed = kpis.delayedProjects || {};
  const kSla = kpis.slaCompliance || {};

  const pie = statusCounts(data.projectStatus || data.counts || {});
  const orgs = asArray(data.organizations || data.organisations).map(normalizeOrgRow);
  const leaderboard = (asArray(data.leaderboard).length ? asArray(data.leaderboard) : orgs)
    .map((o) => ({ label: orgName(o), value: num(o.projects, o.projectCount, o.total) }))
    .filter((o) => o.value > 0)
    .slice(0, 8);
  const payByOrg = (asArray(data.paymentByOrganization).length ? asArray(data.paymentByOrganization) : orgs)
    .map((o) => ({ label: orgName(o), value: num(o.contractValue, o.value, o.totalValue) }))
    .filter((o) => o.value > 0)
    .slice(0, 8);
  const slaOrgRows = asArray(data.slaByOrganization || data.slaByOrganisation).map((o) => ({
    name: orgName(o),
    met: num(o.met, o.compliant, o.slaMet),
    breached: num(o.breached, o.slaBreached),
  }));

  return (
    <>
      <div className="dp-kpi-grid">
        <KpiCard tone="blue" icon=" " label="Total Organizations" value={num(kOrgs.value, orgs.length)}
          split={kOrgs.active != null ? [{ k: "Active", v: kOrgs.active }, { k: "Inactive", v: kOrgs.inactive ?? 0 }] : undefined} />
        <KpiCard tone="cyan" icon=" " label="Total Projects" value={num(kProjects.value, pie.total)} split={[{ k: "Active", v: num(kProjects.active, pie.active) }, { k: "Completed", v: num(kProjects.completed, pie.completed) }]} />
        <KpiCard tone="green" icon=" " label="Total Contract Value" value={formatINR(num(kContract.value, orgs.reduce((sum, row) => sum + row.contractValue, 0)))}
          foot={kContract.projectCount != null ? `${kContract.withFinance ?? 0}/${kContract.projectCount} projects` : undefined} />
        <KpiCard tone="orange" icon=" " label="Delayed Projects" value={num(kDelayed.value, pie.delayed)} foot="across all vendors" />
        <KpiCard tone="amber" icon=" " label="SLA Compliance" value={kSla.value != null ? `${kSla.value}%` : "N/A"} gauge={kSla.value != null ? kSla.value : undefined} />
      </div>

      <div className="dp-row c4">
        <Widget title="Organization Leaderboard" sub="by project count" onClick={() => orgs[0] && onOpenOrg(orgs[0].organisationId)}>
          {leaderboard.length ? <RankedBar data={leaderboard} color={DOMAIN.schedule} height={Math.max(200, leaderboard.length * 30)} /> : <div className="dash-empty">No data.</div>}
        </Widget>
        <Widget title="Payment by Organization" sub="contract value (₹)" onClick={() => orgs[0] && onOpenOrg(orgs[0].organisationId)}>
          {payByOrg.length ? <RankedBar data={payByOrg} money color={DOMAIN.finance} height={Math.max(200, payByOrg.length * 30)} /> : <div className="dash-empty">No finance data.</div>}
        </Widget>
        <Widget title={slaOrgRows.length ? "SLA Compliance by Organization" : "Project Status"} sub={slaOrgRows.length ? "met % / breached %" : "all organizations"}>
          {slaOrgRows.length ? (
            <SplitBars rows={slaOrgRows.map((o) => ({
              label: o.name, a: o.met, b: o.breached, aColor: DOMAIN.finance, bColor: "#e11d48", aLabel: `${o.met}%`,
            }))} />
          ) : (
            <DonutChart counts={pie} keys={["completed", "ontrack", "delayed", "active"]} centerLabel="projects" height={210} />
          )}
        </Widget>
        <Widget title="Organization Signal Cards" sub="top 5">
          <table className="dp-mtable">
            <thead><tr><th>Organization</th><th className="num">Proj</th><th className="num">Value</th><th className="num">Delayed</th></tr></thead>
            <tbody>
              {orgs.slice(0, 6).map((o) => (
                <tr key={o.organisationId || o.name}>
                  <td><button className="dp-link-name" onClick={() => onOpenOrg(o.organisationId)}>{o.name}</button></td>
                  <td className="num">{o.total}</td>
                  <td className="num">{o.contractValue ? formatINR(o.contractValue) : "—"}</td>
                  <td className="num dp-danger">{o.delayed}</td>
                </tr>
              ))}
              {!orgs.length && <tr><td colSpan={4}><div className="dash-empty">No organizations.</div></td></tr>}
            </tbody>
          </table>
        </Widget>
      </div>
    </>
  );
}

/* ─── Single-org drill-down ─── */

const DRILL_TABS = ["Overview", "Projects", "Payments", "Delayed", "SLA", "Tickets", "Meetings"];

function SingleOrg({ data, onPickOrg, onOpenProject }) {
  const [tab, setTab] = useState("Overview");

  const name = firstDefined(data.name, data.organisationName, data.organizationName) || "";
  const orgList = asArray(data.organisations || data.organizations).map(normalizeOrgRow);
  const kpis = data.kpis || {};
  const kProjects = kpis.totalProjects || {};
  const kValue = kpis.totalValue || {};
  const kScheduled = kpis.scheduledPayout || {};
  const kDelayed = kpis.delayedProjects || {};
  const kSla = kpis.slaCompliance || {};
  const kTickets = kpis.openTickets || {};

  const projects = asArray(data.projects).map(normalizeProject);
  const aggregateCounts = statusCounts(data.projectStatus || data.counts || {});
  const projectCounts = projects.reduce((acc, project) => {
    acc.total += 1;
    const status = statusBucket(project.status);
    if (acc[status] != null) acc[status] += 1;
    return acc;
  }, { total: 0, active: 0, completed: 0, ontrack: 0, delayed: 0 });
  const counts = aggregateCounts.total ? aggregateCounts : projectCounts;
  const payByProject = asArray(data.paymentByProject).map((p) => ({
    label: firstDefined(p.projectCode, p.code, p.name) || "—",
    value: num(p.contractValue, p.value, p.totalValue),
  })).filter((x) => x.value > 0).slice(0, 12);
  const cvs = data.contractVsScheduled || {};
  const topDelayed = asArray(data.topDelayedProjects || data.delayedProjects).map((p) => normalizeProject(p));
  const sla = data.sla || {};
  const tickets = data.tickets || {};
  const meetings = data.meetings || {};
  const delayedRows = projects.filter((p) => p.delayedItems > 0 || p.maxDelayDays > 0);
  const statusBars = [
    { label: "Projects", Active: counts.active, "In Progress": counts.ontrack, Completed: counts.completed, Delayed: counts.delayed },
  ];

  return (
    <>
      <div className="dp-viewbar" style={{ gap: 10 }}>
        <span className="dp-viewbar-title" style={{ fontSize: 15 }}>Organization</span>
        <span className="dp-viewswitch">
          <select value={data.organisationId || ""} onChange={(e) => onPickOrg(e.target.value)}>
            {orgList.map((o) => <option key={o.organisationId} value={o.organisationId}>{o.name}</option>)}
          </select>
        </span>
        <span className="dp-viewbar-spacer" />
        <span className="dp-chip">{kProjects.value ?? projects.length} projects</span>
      </div>

      <div className="dp-kpi-grid" style={{ marginTop: 14 }}>
        <KpiCard tone="blue" icon=" " label="Total Projects" value={num(kProjects.value, projects.length)} split={[{ k: "Active", v: num(kProjects.active, counts.active) }, { k: "Done", v: num(kProjects.completed, counts.completed) }]} />
        <KpiCard tone="green" icon=" " label="Total Value" value={formatINR(num(kValue.value, projects.reduce((sum, row) => sum + row.contractValue, 0)))} foot="contract value" />
        <KpiCard tone="teal" icon=" " label="Scheduled Payout" value={formatINR(num(kScheduled.value, projects.reduce((sum, row) => sum + row.scheduled, 0)))} foot={kScheduled.pctOfValue != null ? `${kScheduled.pctOfValue}% of value` : "—"} />
        <KpiCard tone="orange" icon=" " label="Delayed Projects" value={num(kDelayed.value, delayedRows.length)} foot="behind schedule" />
        <KpiCard tone="amber" icon=" " label="SLA Compliance" value={kSla.value != null ? `${kSla.value}%` : "N/A"} gauge={kSla.value != null ? kSla.value : undefined} />
        <KpiCard tone="purple" icon=" " label="Open Tickets" value={kTickets.value ?? "—"} foot={kTickets.value != null ? `${kTickets.highPriority ?? 0} high priority · ${kTickets.meetings ?? 0} meetings` : "not org-scoped"} />
      </div>

      <div className="dp-drill" style={{ marginTop: 14 }}>
        <div className="dp-drill-tabs">
          {DRILL_TABS.map((t) => (
            <button key={t} type="button" className={`dp-drill-tab ${tab === t ? "active" : ""}`} onClick={() => setTab(t)}>{t}</button>
          ))}
        </div>

        <div>
          {tab === "Overview" && (
            <>
              <div className="dp-row c2">
                <Widget title="Payment by Project" sub="contract value (₹)" onClick={() => payByProject[0] && onOpenProject(projectUuid(projects.find((p) => p.projectCode === payByProject[0].label)))}>
                  {payByProject.length ? <RankedBar data={payByProject} money color={DOMAIN.finance} height={Math.max(200, payByProject.length * 28)} /> : <div className="dash-empty">No finance data.</div>}
                </Widget>
                <Widget title="Project Status" sub={name}>
                  <DonutChart counts={counts} keys={["completed", "ontrack", "delayed", "active"]} centerLabel="projects" height={210} />
                </Widget>
              </div>
              <div className="dp-row c2">
                <Widget title="Projects Overview" sub="status split">
                  <StackedBar data={statusBars} height={180} series={[
                    { key: "Active", name: "Active", color: DOMAIN.neutral },
                    { key: "In Progress", name: "In Progress", color: DOMAIN.scheduleSoft },
                    { key: "Completed", name: "Completed", color: DOMAIN.finance },
                    { key: "Delayed", name: "Delayed", color: DOMAIN.tickets },
                  ]} />
                </Widget>
                <Widget title="Top Delayed Projects" sub={`${topDelayed.length} delayed`}>
                  <table className="dp-mtable">
                    <thead><tr><th>Project</th><th className="num">Delay</th><th className="num">Items</th></tr></thead>
                    <tbody>
                      {topDelayed.slice(0, 5).map((d) => (
                        <tr key={d.projectCode}><td><button className="dp-link-name" onClick={() => onOpenProject(projectUuid(d) || projectUuid(projects.find((p) => p.projectCode === d.projectCode)))}>{d.projectCode}</button></td><td className="num dp-danger">{d.maxDelayDays}d</td><td className="num">{d.delayedItems}</td></tr>
                      ))}
                      {!topDelayed.length && <tr><td colSpan={3}><div className="dash-empty">No delayed projects.</div></td></tr>}
                    </tbody>
                  </table>
                </Widget>
              </div>
            </>
          )}

          {tab === "Projects" && (
            <Widget title="Organization Projects" sub={`${projects.length} projects`}>
              <OrgProjectsTable projects={projects} onOpenProject={onOpenProject} />
            </Widget>
          )}

          {tab === "Payments" && (
            <div className="dp-row c2">
              <Widget title="Payment by Project" sub="contract value (₹)">
                {payByProject.length ? <RankedBar data={payByProject} money color={DOMAIN.finance} height={Math.max(200, payByProject.length * 28)} /> : <div className="dash-empty">No finance data.</div>}
              </Widget>
              <Widget title="Contract vs Scheduled" sub="this organization">
                <DonutChart counts={{ Scheduled: num(cvs.scheduled, kScheduled.value), Remaining: Math.max(num(cvs.remaining, num(kValue.value) - num(cvs.scheduled, kScheduled.value)), 0) }} keys={["Scheduled", "Remaining"]} centerLabel="₹ value" money height={210} />
              </Widget>
            </div>
          )}

          {tab === "Delayed" && (
            <Widget title="Delayed Projects" sub={`${delayedRows.length} delayed`}>
              <table className="dp-mtable">
                <thead><tr><th>Project</th><th>Name</th><th className="num">Delayed Items</th><th className="num">Max Delay</th></tr></thead>
                <tbody>
                  {delayedRows.map((p) => (
                    <tr key={p.projectCode}>
                      <td><button className="dp-link-name" onClick={() => onOpenProject(projectUuid(p))}>{p.projectCode}</button></td>
                      <td>{p.name}</td><td className="num">{p.delayedItems ?? p.delayed ?? 0}</td><td className="num dp-danger">{p.maxDelayDays}d</td>
                    </tr>
                  ))}
                  {!delayedRows.length && <tr><td colSpan={4}><div className="dash-empty">No delayed projects.</div></td></tr>}
                </tbody>
              </table>
            </Widget>
          )}

          {tab === "SLA" && (
            <Widget title="SLA Compliance" sub={name}>
              {sla.available ? (
                <div className="dp-gauge-wrap">
                  {/* Cap the gauge at its natural aspect ratio (170 × 200/118 ≈ 288px).
                      GaugeRing offsets its centre text with padding-bottom: 16%, which
                      resolves against width — unconstrained in this full-width widget it
                      overshot and pushed the % up into the arc. */}
                  <div style={{ width: "100%", maxWidth: 288 }}>
                    <GaugeRing value={sla.compliance} label="SLA Compliance" color={DOMAIN.finance} height={170} />
                  </div>
                  <SplitBars rows={[
                    { label: "Met", a: sla.met, b: 0, aColor: DOMAIN.finance, aLabel: `${sla.compliance}%` },
                    { label: "Breached", a: sla.breached, b: 0, aColor: "#e11d48", aLabel: `${100 - sla.compliance}%` },
                  ]} />
                </div>
              ) : <div className="dash-empty">SLA data not available.</div>}
            </Widget>
          )}
          {tab === "Tickets" && (
            <Widget title="Tickets" sub={name}>
              {tickets.available ? (
                <Stat4 items={[
                  { k: "Open", v: tickets.open ?? 0, icon: " " },
                  { k: "High Priority", v: tickets.highPriority ?? 0, icon: " " },
                  { k: "Resolved (30d)", v: tickets.resolved30d ?? 0, icon: " " },
                  { k: "Avg Age (days)", v: tickets.avgAgeDays ?? 0, icon: " " },
                ]} />
              ) : <div className="dash-empty">Ticket data not available.</div>}
            </Widget>
          )}
          {tab === "Meetings" && (
            <Widget title="Meetings" sub={name}>
              {meetings.available ? (
                <Stat4 items={[
                  { k: "Upcoming", v: meetings.upcoming ?? 0, icon: " " },
                  { k: "This Week", v: meetings.thisWeek ?? 0, icon: " " },
                  { k: "Pending MoM", v: meetings.pendingMom ?? 0, icon: " " },
                  { k: "Completed", v: meetings.completed ?? 0, icon: " " },
                ]} />
              ) : <div className="dash-empty">Meeting data not available.</div>}
            </Widget>
          )}
        </div>
      </div>

      {/* Full projects table always visible below the drill-down */}
      <div className="dp-widget" style={{ marginTop: 14 }}>
        <div className="dp-widget-head"><span className="dp-widget-title">Organization Projects</span><span className="dp-widget-sub">all · {projects.length}</span></div>
        <OrgProjectsTable projects={projects} onOpenProject={onOpenProject} />
      </div>
    </>
  );
}

function OrgProjectsTable({ projects, onOpenProject }) {
  if (!projects.length) return <div className="dash-empty">No projects.</div>;
  return (
    <div className="dash-track-table-wrap" style={{ marginTop: 4 }}>
      <table className="dash-track-table">
        <thead>
          <tr><th>Code</th><th>Name</th><th>Status</th><th>Progress</th><th className="num">Value</th><th className="num">Scheduled</th><th className="num">Delayed</th><th>Planned Finish</th><th>Action</th></tr>
        </thead>
        <tbody>
          {projects.map((p) => {
            const st = p.status || "active";
            return (
              <tr key={p.projectCode}>
                <td className="dash-wbs">{p.projectCode}</td>
                <td><span className="dash-track-name">{p.name}</span></td>
                <td><span className={`dash-pill ${st}`}>{LABELS[st] || st}</span></td>
                <td>
                  <div className="dash-mini-progress"><span className="dash-mini-bar"><div style={{ width: `${p.progressPct ?? 0}%` }} /></span><span className="dash-mini-pct">{p.progressPct ?? 0}%</span></div>
                </td>
                <td className="dash-date-cell">{p.contractValue ? formatINR(p.contractValue) : "—"}</td>
                <td className="dash-date-cell">{p.scheduled ? formatINR(p.scheduled) : "—"}</td>
                    <td>{(p.delayedItems ?? p.delayed) ? <span className="dp-danger">{p.delayedItems ?? p.delayed}</span> : "—"}</td>
                <td className="dash-date-cell">{p.plannedEnd ? fmt(p.plannedEnd) : "—"}</td>
                <td><button type="button" className="dash-pm-btn" onClick={() => onOpenProject(projectUuid(p))}>Open ↗</button></td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}