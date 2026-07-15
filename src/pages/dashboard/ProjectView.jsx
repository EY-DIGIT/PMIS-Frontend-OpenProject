/* Dashboard / Project view — MOCKUP LAYOUT (2026-07).
   Single-project deep dive. All data now comes from ONE call:
   GET /dashboard/projects/{uuid}/full (src/api/dashboardConsolidated.js).
   The ?id= URL param is the project UUID (the header picker navigates
   with it). Rich header, 6 gradient KPI cards, and the widget grid
   (status donut, payment terms, timeline, SLA, approvals, items table). */

import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { FiGrid } from "react-icons/fi";
import { projectFull as fetchProjectFull } from "../../api/dashboardConsolidated";
import {
  DelayList,
  itemRowToTrackRow,
  range, fmt, COLORS, LABELS,
} from "./_shared";
import { DonutChart, StackedBar, TrendArea, GaugeRing, FunnelBars, formatINR, DOMAIN } from "./charts";
import { KpiCard, Widget, SplitBars } from "./kit";
import "../../styles/Dashboard.css";

const VIS = 5;

export default function ProjectView() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const selectedId = params.get("id") || null;   // project UUID
  const [reloadTick, setReloadTick] = useState(0);

  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!selectedId) { setData(null); setError(null); return undefined; }
    let cancelled = false; setLoading(true); setError(null);
    fetchProjectFull(selectedId)
      .then((payload) => {
        if (cancelled) return;
        if (!payload || !payload.project) { setError("Project not found."); setData(null); }
        else setData(payload);
        setLoading(false);
      })
      .catch(() => { if (cancelled) return; setError("Failed to load project. Please retry."); setData(null); setLoading(false); });
    return () => { cancelled = true; };
  }, [selectedId, reloadTick]);

  function handleRefresh() { setReloadTick((n) => n + 1); }

  // Refresh trigger from the global header.
  useEffect(() => {
    const h = () => setReloadTick((n) => n + 1);
    window.addEventListener("pmis:dashboard-refresh", h);
    return () => window.removeEventListener("pmis:dashboard-refresh", h);
  }, []);

  const showInitialError = !!error && !data && !loading;

  return (
    <div className="dashboard-wrap">
      {showInitialError && (
        <div className="dash-empty" style={{ padding: 24, color: "#d4440e" }}>
          {error} <button type="button" className="dash-ghost-btn" onClick={handleRefresh}>Retry</button>
        </div>
      )}

      <section className="dash-view" hidden={showInitialError}>
        {!selectedId && <div className="dash-card"><div className="dash-empty">Select a project from the header dropdown to see its details, KPIs, finance and charts.</div></div>}
        {selectedId && loading && !data && <div className="dash-empty" style={{ padding: 24 }}>Loading project…</div>}
        {selectedId && data && <ProjectDetail key={`${selectedId}|${reloadTick}`} data={data} navigate={navigate} />}
      </section>
    </div>
  );
}

/* Circular progress ring for the project header (green track, % centre). */
function ProgressRing({ value, size = 84, stroke = 9 }) {
  const pct = Math.max(0, Math.min(100, Math.round(Number(value) || 0)));
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const dash = (pct / 100) * c;
  const color = pct >= 75 ? "#1a8a3d" : pct >= 40 ? "#0aa1c0" : "#d4440e";
  return (
    <div className="dash-phead-ring" style={{ width: size, height: size }}>
      <svg width={size} height={size} style={{ transform: "rotate(-90deg)" }}>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="#eef3fa" strokeWidth={stroke} />
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={color} strokeWidth={stroke}
          strokeLinecap="round" strokeDasharray={`${dash.toFixed(1)} ${(c - dash).toFixed(1)}`} />
      </svg>
      <span className="dash-phead-ring-txt">{pct}%</span>
    </div>
  );
}

function ownerInitials(name) {
  if (!name || name === "—") return "—";
  return name.split(/[\s.@]+/).filter(Boolean).slice(0, 2).map((s) => s[0]?.toUpperCase()).join("") || "—";
}

function ProjectDetail({ data, navigate }) {
  const p = data.project || {};
  const kpis = data.kpis || {};
  const finance = data.finance || {};
  const sla = data.sla || {};
  const approvals = data.approvals || {};

  const uuid = p.id;
  const status = String(p.lifecycleStatus || "").toUpperCase();

  // Context object attached to each item row so the tables/DelayList can
  // show project code / org / division.
  const pCtx = useMemo(() => ({
    id: p.projectCode, uuid, name: p.name,
    organisation: p.organisation, division: p.division,
  }), [p.projectCode, uuid, p.name, p.organisation, p.division]);

  const items = useMemo(
    () => (Array.isArray(data.items) ? data.items : []).map((r) => itemRowToTrackRow(r, pCtx)),
    [data.items, pCtx],
  );

  const [itemsFilter, setItemsFilter] = useState(null);
  const itemsFilterRef = useRef(null);

  const filteredItems = useMemo(() => {
    if (!itemsFilter) return items;
    return items.filter((r) => {
      if (itemsFilter.kind && r.kind !== itemsFilter.kind) return false;
      if (itemsFilter.status && r.status !== itemsFilter.status) return false;
      return true;
    });
  }, [items, itemsFilter]);

  function applyFilter(next) { setItemsFilter(next); requestAnimationFrame(() => itemsFilterRef.current?.scrollIntoView({ behavior: "smooth", block: "start" })); }
  function clearFilter() { setItemsFilter(null); }

  function openInPM() { if (!uuid) return; navigate(`/projects/${encodeURIComponent(uuid)}/config`); }
  function openFinance() { if (!uuid) return; navigate(`/projects/${encodeURIComponent(uuid)}/finance`); }

  const chartCounts = useMemo(() => filteredItems.reduce((acc, r) => { acc[r.status] = (acc[r.status] || 0) + 1; acc.total = (acc.total || 0) + 1; return acc; }, { active: 0, ontrack: 0, completed: 0, delayed: 0, total: 0 }), [filteredItems]);

  const kProgress = kpis.overallProgress || {};
  const kMilestones = kpis.milestones || {};
  const kActivities = kpis.activities || {};
  const kDelayed = kpis.delayedItems || {};
  const kPending = kpis.pendingApprovals || {};
  const kBudget = kpis.budget || {};

  const phaseData = (finance.byPhase || []).map((ph) => ({ label: ph.label, Scheduled: ph.scheduled, "One-time": ph.oneTime, "Carry-fwd": ph.carriedOut }));
  const hasFinance = finance.hasData;
  const contractValue = kBudget.contractValue ?? finance.contractValue ?? 0;
  const released = kBudget.released ?? finance.scheduled ?? 0;
  const budgetPct = kBudget.pctOfContract ?? finance.scheduledPctOfContract ?? 0;
  const costTypeCounts = {
    fixed: finance.fixedCost ?? 0,
    one_time: finance.oneTimeCost ?? 0,
    recurring: finance.recurringCost ?? 0,
  };

  const timeline = (data.paymentTimeline || []).map((t) => ({ label: t.month, "Planned (Cr)": t.plannedCr, "Actual (Cr)": t.actualCr }));
  const breaches = sla.breaches || [];
  const wf = approvals.workflow || [];
  const apprStatus = approvals.statusByItems || null;
  const delayedTrackRows = useMemo(() => (data.delayedTrack || []).map((d) => ({
    key: `${d.kind}:${d.wbs}`,
    name: d.name,
    kind: d.kind,
    delay: d.delay,
    wbs: d.wbs,
    project: pCtx,
  })), [data.delayedTrack, pCtx]);

  return (
    <>
      {/* ── Project header (mockup layout) ── */}
      <div className="dash-phead">
        <div className="dash-phead-icon"><FiGrid size={30} /></div>

        <div className="dash-phead-main">
          <div className="dash-phead-titlerow">
            <span className="dash-phead-code">{p.projectCode}</span>
            <span className={`dash-phead-badge st-${status.toLowerCase()}`}>{p.lifecycleStatus || "—"}</span>
          </div>
          <div className="dash-phead-name">{p.name}</div>
          <div className="dash-phead-tags">
            <div><span className="dash-phead-k">Organization</span><span className="dash-phead-v">{p.organisation || "—"}</span></div>
            <div><span className="dash-phead-k">Division</span><span className="dash-phead-v">{p.division || "—"}</span></div>
          </div>
        </div>

        <span className="dash-phead-div" />

        {/* Project Owner + the three dates stacked into a single column */}
        <div className="dash-phead-metacol">
          <div className="dash-phead-owner">
            <span className="dash-phead-k">Project Owner</span>
            <div className="dash-phead-ownerrow">
              <span className="dash-phead-avatar">{ownerInitials(p.owner)}</span>
              <span className="dash-phead-v">{p.owner && p.owner !== "—" ? p.owner : "—"}</span>
            </div>
          </div>
          <div className="dash-phead-dates">
            <div><span className="dash-phead-k">Planned Start</span><span className="dash-phead-v">{fmt(p.plannedStart)}</span></div>
            <div><span className="dash-phead-k">Planned Finish</span><span className="dash-phead-v">{fmt(p.plannedEnd)}</span></div>
            <div><span className="dash-phead-k">Actual Start</span><span className="dash-phead-v">{p.actualStart ? fmt(p.actualStart) : "—"}</span></div>
            <div><span className="dash-phead-k">Actual Finish</span><span className="dash-phead-v">{p.actualEnd ? fmt(p.actualEnd) : "—"}</span></div>
          </div>
        </div>

        <span className="dash-phead-div" />

        <div className="dash-phead-progress">
          <span className="dash-phead-k">% Progress (Overall)</span>
          <ProgressRing value={kProgress.value} />
        </div>

        <span className="dash-phead-div" />

        <div className="dash-phead-actions">
          <div className="dash-phead-btns">
            <button type="button" className="dash-primary-btn" onClick={openInPM}>Open in Project Manager ↗</button>
            {hasFinance && <button type="button" className="dash-ghost-btn" onClick={openFinance}>View Finance</button>}
          </div>
          <div className="dash-phead-lifecycle">
            <span className="dash-phead-k">Lifecycle Status</span>
            <span className="dash-phead-badge lifecycle">{p.lifecycleStatus || "—"}</span>
          </div>
        </div>
      </div>

      {/* ── 6 KPI cards ── */}
      <div className="dp-kpi-grid">
        <KpiCard tone="blue" icon="📊" label="Overall Progress" value={`${kProgress.value ?? 0}%`} onClick={() => applyFilter(null)} gauge={kProgress.value ?? 0}
          delta={kProgress.delta} />
        <KpiCard tone="cyan" icon="🏁" label="Milestones" value={`${kMilestones.done ?? 0}/${kMilestones.total ?? 0}`}
          foot={kMilestones.total ? `${kMilestones.pct ?? Math.round((kMilestones.done / kMilestones.total) * 100)}% completed` : "—"} onClick={() => applyFilter({ kind: "milestone" })} />
        <KpiCard tone="green" icon="📋" label="Activities" value={`${kActivities.done ?? 0}/${kActivities.total ?? 0}`}
          foot={kActivities.total ? `${kActivities.pct ?? Math.round((kActivities.done / kActivities.total) * 100)}% completed` : "—"} onClick={() => applyFilter({ kind: "activity" })} />
        <KpiCard tone="orange" icon="⏰" label="Delayed Items" value={kDelayed.value ?? 0} foot={kDelayed.maxDelayDays ? `Max Delay ${kDelayed.maxDelayDays} Days` : "on schedule"} onClick={() => applyFilter({ status: "delayed" })} />
        <KpiCard tone="purple" icon="🔔" label="Pending Approvals" value={approvals.available ? (kPending.value ?? approvals.pending ?? 0) : "—"} foot={approvals.available ? "activities awaiting approval" : "workflow n/a"} delta={kPending.delta} />
        <KpiCard tone="teal" icon="💰" label="Budget vs Released"
          value={hasFinance ? formatINR(contractValue) : "—"}
          foot={hasFinance ? `${formatINR(released)} released · ${budgetPct}%` : "no finance"} />
      </div>

      {/* ── Widgets — 3 per row ── */}
      <div className="dp-row c3">
        <Widget title="M → A → T → ST Status" sub={itemsFilter ? `Filtered: ${filterLabel(itemsFilter)}` : "milestones & activities"} onClick={() => applyFilter(null)}>
          <DonutChart counts={chartCounts} keys={["completed", "ontrack", "delayed", "active"]} centerLabel="items" height={210} />
        </Widget>
        <Widget title="Payment Terms" sub="by phase (₹)" onClick={openFinance}>
          {!hasFinance && <div className="dash-empty">No finance configured.</div>}
          {hasFinance && (phaseData.length
            ? <StackedBar data={phaseData} money height={210}
                series={[{ key: "Scheduled", name: "Scheduled", color: DOMAIN.finance }, { key: "One-time", name: "One-time", color: DOMAIN.slaSoft }, { key: "Carry-fwd", name: "Carry-fwd", color: DOMAIN.neutral }]} />
            : <div className="dash-empty">No phased payment terms.</div>)}
        </Widget>
        <Widget title="Payment Timeline" sub="planned vs actual (₹ Cr)">
          {timeline.length
            ? <TrendArea data={timeline} height={210} series={[{ key: "Planned (Cr)", name: "Planned", color: DOMAIN.scheduleSoft }, { key: "Actual (Cr)", name: "Actual", color: DOMAIN.finance }]} />
            : <div className="dash-empty" style={{ padding: "26px 12px", lineHeight: 1.6 }}>No payment timeline available.</div>}
        </Widget>
        <Widget title="SLA Compliance" sub="by activities">
          {sla.available ? (
            <div className="dp-gauge-wrap">
              <GaugeRing value={sla.compliance} label="SLA Compliance" color={DOMAIN.finance} height={140} />
              <SplitBars rows={[
                { label: "Met", a: sla.met, b: 0, aColor: DOMAIN.finance, aLabel: `${sla.met} (${sla.compliance}%)` },
                { label: "Breached", a: sla.breached, b: 0, aColor: "#e11d48", aLabel: `${sla.breached} (${100 - sla.compliance}%)` },
              ]} />
            </div>
          ) : (
            <div className="dash-empty" style={{ padding: "26px 12px", lineHeight: 1.6 }}>SLA data not available.</div>
          )}
        </Widget>
        <Widget title="SLA Performance" sub="top 5 breaches">
          {sla.available && breaches.length ? (
            <table className="dp-mtable">
              <thead><tr><th>Activity</th><th className="num">SLA</th><th className="num">Actual</th><th className="num">Delay</th><th>Status</th></tr></thead>
              <tbody>
                {breaches.slice(0, 5).map((b) => (
                  <tr key={b.wbs + b.activity}>
                    <td>{b.wbs} {b.activity}</td><td className="num">{b.sla}</td><td className="num">{b.actual}</td>
                    <td className="num dp-danger">{b.delay}</td><td><span className="dp-tag breached">Breached</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : <div className="dash-empty">SLA data not available.</div>}
        </Widget>
        <Widget title="Approval Workflow" sub="this project" onClick={() => navigate("/approvals/concerned-division")}>
          {approvals.available && wf.length
            ? <FunnelBars stages={wf.map((s, i) => ({ ...s, color: [DOMAIN.neutral, DOMAIN.workflowSoft, DOMAIN.workflow, DOMAIN.scheduleSoft, DOMAIN.finance, DOMAIN.tickets][i] || DOMAIN.workflow }))} />
            : <div className="dash-empty">Approval workflow not available.</div>}
        </Widget>
        <Widget title="Approval Status by Items" sub="activities">
          {approvals.available && apprStatus
            ? <DonutChart counts={apprStatus} keys={["idle", "pending_division", "pending_owner", "division_approved", "rejected"]} centerLabel="items" height={200} />
            : <div className="dash-empty">Approval state not available.</div>}
        </Widget>
        <Widget title="Delayed Track" sub={`${delayedTrackRows.length} delayed`} onClick={() => applyFilter({ status: "delayed" })}>
          <DelayList rows={delayedTrackRows} limit={VIS} />
        </Widget>
      </div>

      {/* ── Cost Composition ── */}
      {hasFinance && (costTypeCounts.fixed + costTypeCounts.one_time + costTypeCounts.recurring > 0) && (
        <div className="dp-row c2" style={{ marginTop: "14px" }}>
          <Widget title="Cost Composition" sub="Fixed / One-time / Recurring" onClick={openFinance}>
            <DonutChart counts={costTypeCounts} keys={["fixed", "one_time", "recurring"]} centerLabel="contract ₹" money height={200} />
          </Widget>
          <Widget title="Finance Summary" sub="contract breakdown" onClick={openFinance}>
            <table className="dp-mtable">
              <tbody>
                <tr><td>Contract Value</td><td className="num">{formatINR(contractValue)}</td></tr>
                <tr><td>Scheduled</td><td className="num">{formatINR(finance.scheduled ?? 0)}</td></tr>
                <tr><td>Fixed Cost</td><td className="num">{formatINR(finance.fixedCost ?? 0)}</td></tr>
                <tr><td>One-time Cost</td><td className="num">{formatINR(finance.oneTimeCost ?? 0)}</td></tr>
                <tr><td>Recurring Cost</td><td className="num">{formatINR(finance.recurringCost ?? 0)}</td></tr>
                <tr><td>Released</td><td className="num">{formatINR(released)}</td></tr>
              </tbody>
            </table>
          </Widget>
        </div>
      )}

      {/* ── Items table ── */}
      <div ref={itemsFilterRef} className="dash-card" style={{ marginTop: "14px", marginBottom: "20px" }}>
        <div className="dash-card-title">
          Project Items
          <span className="dash-card-sub">{itemsFilter ? `${filteredItems.length} of ${items.length} — ${filterLabel(itemsFilter)}` : "milestones & activities"}</span>
          {itemsFilter && <button type="button" className="dash-ghost-btn" style={{ marginLeft: "auto" }} onClick={clearFilter}>Clear filter</button>}
        </div>
        <ItemsTable rows={filteredItems} onOpenPM={openInPM} />
      </div>
    </>
  );
}

function filterLabel(f) {
  if (!f) return "all";
  const parts = [];
  if (f.kind === "milestone") parts.push("milestones");
  else if (f.kind === "activity") parts.push("activities");
  if (f.status === "delayed") parts.push("delayed");
  return parts.join(" / ") || "all";
}

function ItemsTable({ rows, onOpenPM }) {
  if (!rows.length) return <div className="dash-empty">No items.</div>;
  return (
    <div className="dash-track-table-wrap" style={{ marginTop: "12px" }}>
      <table className="dash-track-table">
        <thead><tr><th>WBS</th><th>Name</th><th>Progress</th><th>Status</th><th>Expected Dates</th><th>Actual Dates</th><th>Delay</th><th>Type</th><th>Project Management</th></tr></thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.key} className={`dash-row-${r.kind}`}>
              <td className="dash-wbs">{r.wbs}</td>
              <td><span className="dash-track-name">{r.name}</span><span className="dash-track-context">{r.context}</span></td>
              <td><div className="dash-mini-progress"><span className="dash-mini-bar"><div style={{ width: `${r.progress}%`, background: COLORS[r.status] }} /></span><span className="dash-mini-pct">{r.progress}%</span></div></td>
              <td><span className={`dash-pill ${r.status}`}>{LABELS[r.status] || r.status}</span></td>
              <td className="dash-date-cell">{range(r.plannedStart, r.plannedEnd)}</td>
              <td className="dash-date-cell">{r.actualStart ? range(r.actualStart, r.actualEnd) : "-"}</td>
              <td>{r.delay ? `${r.delay}d` : "-"}</td>
              <td><span className="dash-type-pill">{r.kind}</span></td>
              <td><button type="button" className="dash-pm-btn" onClick={onOpenPM}>Open in PM</button></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
