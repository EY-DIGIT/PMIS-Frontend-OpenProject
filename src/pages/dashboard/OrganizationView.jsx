/* Dashboard / Organization view — MOCKUP LAYOUT (2026-07).
   Two modes via a segmented toggle, each backed by ONE call:
   - All Organizations  → GET /dashboard/organisation-view
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
import { DonutChart, RankedBar, GaugeRing, formatINR, DOMAIN } from "./charts";
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
    setLoading(true); setErr(null);
    (async () => {
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
            const orgs = all?.organizations || [];
            id = orgs.find((o) => o.name === nameParam)?.organisationId || orgs[0]?.organisationId;
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
    })();
    return () => { cancelled = true; };
  }, [mode, idParam, nameParam, reloadTick]);

  function handleRefresh() { setReloadTick((n) => n + 1); }
  function setMode(m) {
    if (m === "all") setParams({});
    else {
      const firstId = (allData?.organizations || singleData?.organisations || [])[0];
      const id = firstId?.organisationId;
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

/* ─── All-orgs ─── */

function AllOrgs({ data, onOpenOrg }) {
  const kpis = data.kpis || {};
  const kOrgs = kpis.totalOrganizations || {};
  const kProjects = kpis.totalProjects || {};
  const kContract = kpis.contractValue || {};
  const kDelayed = kpis.delayedProjects || {};
  const kSla = kpis.slaCompliance || {};

  const pie = data.projectStatus || {};
  const orgs = data.organizations || [];
  const leaderboard = (data.leaderboard || []).slice(0, 8).map((o) => ({ label: o.name, value: o.projects }));
  const payByOrg = (data.paymentByOrganization || []).slice(0, 8).map((o) => ({ label: o.name, value: o.contractValue }));
  const slaOrgRows = data.slaByOrganization || [];

  return (
    <>
      <div className="dp-kpi-grid">
        <KpiCard tone="blue" icon="🏢" label="Total Organizations" value={kOrgs.value ?? orgs.length}
          split={kOrgs.active != null ? [{ k: "Active", v: kOrgs.active }, { k: "Inactive", v: kOrgs.inactive ?? 0 }] : undefined} />
        <KpiCard tone="cyan" icon="📁" label="Total Projects" value={kProjects.value ?? 0} split={[{ k: "Active", v: kProjects.active ?? 0 }, { k: "Completed", v: kProjects.completed ?? 0 }]} />
        <KpiCard tone="green" icon="💰" label="Total Contract Value" value={formatINR(kContract.value ?? 0)}
          foot={kContract.projectCount != null ? `${kContract.withFinance ?? 0}/${kContract.projectCount} projects` : undefined} />
        <KpiCard tone="orange" icon="⏰" label="Delayed Projects" value={kDelayed.value ?? 0} foot="across all vendors" />
        <KpiCard tone="amber" icon="✅" label="SLA Compliance" value={kSla.value != null ? `${kSla.value}%` : "N/A"} gauge={kSla.value != null ? kSla.value : undefined} />
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

  const name = data.name || "";
  const orgList = data.organisations || [];
  const kpis = data.kpis || {};
  const kProjects = kpis.totalProjects || {};
  const kValue = kpis.totalValue || {};
  const kScheduled = kpis.scheduledPayout || {};
  const kDelayed = kpis.delayedProjects || {};
  const kSla = kpis.slaCompliance || {};
  const kTickets = kpis.openTickets || {};

  const counts = data.projectStatus || {};
  const overview = data.projectsOverview || {};
  const projects = data.projects || [];
  const payByProject = (data.paymentByProject || []).filter((x) => x.contractValue > 0)
    .map((p) => ({ label: p.projectCode, value: p.contractValue })).slice(0, 12);
  const cvs = data.contractVsScheduled || {};
  const topDelayed = data.topDelayedProjects || [];
  const sla = data.sla || {};
  const tickets = data.tickets || {};
  const meetings = data.meetings || {};
  const delayedRows = projects.filter((p) => (p.delayed ?? 0) > 0 || (p.maxDelayDays ?? 0) > 0);

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
        <KpiCard tone="blue" icon="📁" label="Total Projects" value={kProjects.value ?? 0} split={[{ k: "Active", v: kProjects.active ?? 0 }, { k: "Done", v: kProjects.completed ?? 0 }]} />
        <KpiCard tone="green" icon="💰" label="Total Value" value={formatINR(kValue.value ?? 0)} foot="contract value" />
        <KpiCard tone="teal" icon="🏦" label="Scheduled Payout" value={formatINR(kScheduled.value ?? 0)} foot={kScheduled.pctOfValue != null ? `${kScheduled.pctOfValue}% of value` : "—"} />
        <KpiCard tone="orange" icon="⏰" label="Delayed Projects" value={kDelayed.value ?? 0} foot="behind schedule" />
        <KpiCard tone="amber" icon="✅" label="SLA Compliance" value={kSla.value != null ? `${kSla.value}%` : "N/A"} gauge={kSla.value != null ? kSla.value : undefined} />
        <KpiCard tone="purple" icon="🎫" label="Open Tickets" value={kTickets.value ?? "—"} foot={kTickets.value != null ? `${kTickets.highPriority ?? 0} high priority · ${kTickets.meetings ?? 0} meetings` : "not org-scoped"} />
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
                <Widget title="Payment by Project" sub="contract value (₹)" onClick={() => payByProject[0] && onOpenProject(projects.find((p) => p.projectCode === payByProject[0].label)?.id)}>
                  {payByProject.length ? <RankedBar data={payByProject} money color={DOMAIN.finance} height={Math.max(200, payByProject.length * 28)} /> : <div className="dash-empty">No finance data.</div>}
                </Widget>
                <Widget title="Project Status" sub={name}>
                  <DonutChart counts={counts} keys={["completed", "ontrack", "delayed", "active"]} centerLabel="projects" height={210} />
                </Widget>
              </div>
              <div className="dp-row c2">
                <Widget title="Projects Overview" sub="status split">
                  <Stat4 items={[
                    { k: "In Progress", v: overview.inProgress ?? 0, icon: "🔵" },
                    { k: "Completed", v: overview.completed ?? 0, icon: "🟢" },
                    { k: "Delayed", v: overview.delayed ?? 0, icon: "🔴" },
                    { k: "Not Started", v: overview.notStarted ?? 0, icon: "⚪" },
                  ]} />
                </Widget>
                <Widget title="Top Delayed Projects" sub={`${topDelayed.length} delayed`}>
                  <table className="dp-mtable">
                    <thead><tr><th>Project</th><th className="num">Delay</th><th className="num">Items</th></tr></thead>
                    <tbody>
                      {topDelayed.slice(0, 5).map((d) => (
                        <tr key={d.projectCode}><td><button className="dp-link-name" onClick={() => onOpenProject(projects.find((p) => p.projectCode === d.projectCode)?.id)}>{d.projectCode}</button></td><td className="num dp-danger">{d.maxDelayDays}d</td><td className="num">{d.delayedItems}</td></tr>
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
                <DonutChart counts={{ Scheduled: cvs.scheduled ?? 0, Remaining: Math.max(cvs.remaining ?? 0, 0) }} keys={["Scheduled", "Remaining"]} centerLabel="₹ value" money height={210} />
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
                      <td><button className="dp-link-name" onClick={() => onOpenProject(p.id)}>{p.projectCode}</button></td>
                      <td>{p.name}</td><td className="num">{p.delayed}</td><td className="num dp-danger">{p.maxDelayDays}d</td>
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
                  <GaugeRing value={sla.compliance} label="SLA Compliance" color={DOMAIN.finance} height={170} />
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
                  { k: "Open", v: tickets.open ?? 0, icon: "🎫" },
                  { k: "High Priority", v: tickets.highPriority ?? 0, icon: "🔴" },
                  { k: "Resolved (30d)", v: tickets.resolved30d ?? 0, icon: "✅" },
                  { k: "Avg Age (days)", v: tickets.avgAgeDays ?? 0, icon: "⏱️" },
                ]} />
              ) : <div className="dash-empty">Ticket data not available.</div>}
            </Widget>
          )}
          {tab === "Meetings" && (
            <Widget title="Meetings" sub={name}>
              {meetings.available ? (
                <Stat4 items={[
                  { k: "Upcoming", v: meetings.upcoming ?? 0, icon: "📅" },
                  { k: "This Week", v: meetings.thisWeek ?? 0, icon: "🗓️" },
                  { k: "Pending MoM", v: meetings.pendingMom ?? 0, icon: "📝" },
                  { k: "Completed", v: meetings.completed ?? 0, icon: "✔️" },
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
                <td>{p.delayed ? <span className="dp-danger">{p.delayed}</span> : "—"}</td>
                <td className="dash-date-cell">{p.plannedEnd ? fmt(p.plannedEnd) : "—"}</td>
                <td><button type="button" className="dash-pm-btn" onClick={() => onOpenProject(p.id)}>Open ↗</button></td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
