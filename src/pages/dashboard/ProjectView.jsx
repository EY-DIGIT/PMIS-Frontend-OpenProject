/* Dashboard / Project view — MOCKUP LAYOUT (2026-07).
   Single-project deep dive. All data now comes from ONE call:
   GET /dashboard/projects/{uuid}/full (src/api/dashboardConsolidated.js).
   The ?id= URL param is the project UUID (the header picker navigates
   with it). Rich header, 6 gradient KPI cards, and the widget grid
   (status donut, payment terms, timeline, SLA, approvals, items table). */

import { useEffect, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { FiGrid } from "react-icons/fi";
import { projectFull as fetchProjectFull } from "../../api/dashboardConsolidated";
import { getRawProjectTree, treeToLegacyProject } from "../../api/dashboard";
import { getQuarterlyAggregate, getPqp, listSettlements, quarterKeyOfRow } from "../../api/slaCompliance";
import { contractQuarters } from "../../utils/project/slaRollup";
import {
  DelayList,
  itemRowToTrackRow,
  flattenRows,
  range, fmt, COLORS, LABELS,
} from "./_shared";
import { DonutChart, StackedBar, TrendArea, GaugeRing, FunnelBars, formatINR, DOMAIN } from "./charts";
import { KpiCard, Widget, SplitBars } from "./kit";
import "../../styles/Dashboard.css";

const VIS = 5;

export default function ProjectView() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const selectedId = params.get("id") || null;   // project UUID
  const [reloadTick, setReloadTick] = useState(0);

  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    let cancelled = false;
    Promise.resolve().then(async () => {
      if (cancelled) return;
      if (!selectedId) { setData(null); setError(null); return; }
      setLoading(true); setError(null);
      try {
        const payload = await fetchProjectFull(selectedId);
        if (cancelled) return;
        if (!payload || !payload.project) {
          setError("Project not found."); setData(null);
        } else {
          const treeResult = await Promise.allSettled([getRawProjectTree(selectedId)]);
          if (cancelled) return;
          const tree = treeResult[0].status === "fulfilled" ? treeResult[0].value : null;
          const treeProject = tree ? treeToLegacyProject(tree, payload.project) : null;
          const treeItems = treeProject?.milestones?.length ? flattenRows(treeProject) : null;
          setData(treeItems ? { ...payload, treeItems } : payload);
        }
        setLoading(false);
      } catch {
        if (cancelled) return;
        setError("Failed to load project. Please retry."); setData(null); setLoading(false);
      }
    });
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

function firstDefined(...values) { return values.find((value) => value !== undefined && value !== null && value !== ""); }
function num(...values) { return Number(firstDefined(...values) ?? 0) || 0; }
function asArray(value) { return Array.isArray(value) ? value : []; }
function statusBucket(status) {
  const raw = String(status || "active").toLowerCase();
  if (["completed", "complete", "done", "closed"].includes(raw)) return "completed";
  if (["delayed", "delay", "behind"].includes(raw)) return "delayed";
  if (["ontrack", "in_progress", "in-progress", "started", "published"].includes(raw)) return "ontrack";
  if (["not_started", "not-started", "new", "draft"].includes(raw)) return "active";
  return raw;
}
function normalizeProject(raw = {}) {
  const orgs = asArray(raw.organisations || raw.organizations || raw.vendors);
  const primaryOrg = orgs[0];
  const orgName = firstDefined(raw.organisation, raw.organization, raw.organisationName, raw.organizationName, primaryOrg?.name, primaryOrg?.vendorName);
  return {
    ...raw,
    id: firstDefined(raw.id, raw.uuid, raw.projectUuid, raw.projectId),
    projectCode: firstDefined(raw.projectCode, raw.code, raw.id) || "—",
    name: firstDefined(raw.name, raw.projectName, raw.title) || "—",
    organisation: orgName || "—",
    division: firstDefined(raw.division, raw.divisionLabel, raw.divisionOther, raw.owner) || "—",
    owner: firstDefined(raw.owner, raw.projectOwner, raw.projectManager) || "—",
    lifecycleStatus: firstDefined(raw.lifecycleStatus, raw.status, raw.bucket) || "—",
    bucket: statusBucket(firstDefined(raw.bucket, raw.status, raw.lifecycleStatus)),
    plannedStart: firstDefined(raw.plannedStart, raw.startDate, raw.plannedStartDate),
    plannedEnd: firstDefined(raw.plannedEnd, raw.endDate, raw.plannedFinish, raw.plannedEndDate),
    actualStart: firstDefined(raw.actualStart, raw.actualStartDate),
    actualEnd: firstDefined(raw.actualEnd, raw.actualEndDate),
  };
}
function normalizeProjectKpis(raw = {}, project = {}) {
  const progress = raw.overallProgress || {};
  const milestones = raw.milestones || {};
  const activities = raw.activities || {};
  const delayed = raw.delayedItems || raw.delayed || {};
  const pending = raw.pendingApprovals || raw.approvals || {};
  const budget = raw.budget || {};
  return {
    ...raw,
    overallProgress: { ...progress, value: num(progress.value, raw.progressPct, raw.progress, project.progressPct) },
    milestones: {
      ...milestones,
      done: num(milestones.done, milestones.completed, raw.milestonesCompleted),
      total: num(milestones.total, raw.milestonesTotal),
      pct: firstDefined(milestones.pct, milestones.percent),
    },
    activities: {
      ...activities,
      done: num(activities.done, activities.completed, raw.activitiesCompleted),
      total: num(activities.total, raw.activitiesTotal),
      pct: firstDefined(activities.pct, activities.percent),
    },
    delayedItems: { ...delayed, value: num(delayed.value, delayed.count, raw.delayedItemCount), maxDelayDays: num(delayed.maxDelayDays, raw.maxDelayDays) },
    pendingApprovals: { ...pending, value: num(pending.value, pending.pending, raw.pendingApprovals) },
    budget,
  };
}
function normalizeFinance(raw = {}) {
  const contractValue = num(raw.contractValue, raw.totalValue, raw.value);
  const scheduled = num(raw.scheduled, raw.scheduledPayout, raw.scheduledAmount, raw.released);
  return {
    ...raw,
    hasData: raw.hasData ?? (contractValue > 0 || scheduled > 0),
    contractValue,
    scheduled,
    scheduledPctOfContract: firstDefined(raw.scheduledPctOfContract, raw.pctOfContract, contractValue ? Math.round((scheduled / contractValue) * 100) : 0),
    fixedCost: num(raw.fixedCost, raw.fixed),
    oneTimeCost: num(raw.oneTimeCost, raw.oneTime, raw.one_time),
    recurringCost: num(raw.recurringCost, raw.recurring),
    byPhase: asArray(raw.byPhase || raw.paymentByPhase).map((phase) => ({
      label: firstDefined(phase.label, phase.phase, phase.name) || "—",
      scheduled: num(phase.scheduled, phase.scheduledAmount),
      oneTime: num(phase.oneTime, phase.oneTimeCost, phase.one_time),
      carriedOut: num(phase.carriedOut, phase.carryForward, phase.carriedForward),
    })),
  };
}
function normalizeSla(raw = {}) {
  const met = num(raw.met, raw.slaMet, raw.compliant);
  const breached = num(raw.breached, raw.slaBreached);
  const compliance = firstDefined(raw.compliance, raw.value, raw.compliancePct, met + breached ? Math.round((met / (met + breached)) * 100) : null);
  return {
    ...raw,
    available: raw.available ?? compliance !== null,
    met,
    breached,
    compliance,
    evaluated: num(raw.evaluated, raw.evaluatedItems),
    pending: num(raw.pending, raw.pendingItems),
    excluded: num(raw.excluded, raw.excludedItems),
    breaches: asArray(raw.breaches || raw.topBreaches).map((row) => ({
      ...row,
      wbs: firstDefined(row.wbs, row.code) || "",
      activity: firstDefined(row.activity, row.name, row.activityName) || "—",
      slaRef: firstDefined(row.slaRef, row.slaReference, row.slaCode) || "—",
      formulaType: firstDefined(row.formulaType, row.formula) || "—",
      severityLevel: firstDefined(row.severityLevel, row.severity) ?? "—",
      accumulatedPoints: firstDefined(row.accumulatedPoints, row.points) ?? "—",
      ldPercent: firstDefined(row.ldPercent, row.ld_percentage) ?? "—",
      ldAmount: firstDefined(row.ldAmount, row.ld_amount),
      ldBaseAmount: firstDefined(row.ldBaseAmount, row.ld_base_amount),
      ldBaseKind: firstDefined(row.ldBaseKind, row.ld_base_kind) || "—",
      observedValue: firstDefined(row.observedValue, row.observed_value) ?? "—",
      status: firstDefined(row.status, row.state) || "breached",
      sla: firstDefined(row.sla, row.slaDays) ?? "—",
      actual: firstDefined(row.actual, row.actualDays) ?? "—",
      delay: num(row.delay, row.delayDays, row.daysDelayed),
    })),
  };
}
function normalizeApprovals(raw = {}) {
  return {
    ...raw,
    available: raw.available ?? asArray(raw.workflow || raw.stages).length > 0,
    pending: num(raw.pending, raw.pendingApprovals),
    workflow: asArray(raw.workflow || raw.stages).map((stage) => ({
      label: firstDefined(stage.label, stage.name, stage.status) || "—",
      value: num(stage.value, stage.count, stage.total),
    })),
    statusByItems: raw.statusByItems || raw.itemsByStatus || null,
  };
}
function normalizeStatusCounts(raw = {}) {
  const total = num(raw.total);
  const completed = num(raw.completed);
  const ontrack = num(raw.ontrack, raw.onTrack);
  const delayed = num(raw.delayed);
  // The API's `active` count includes delayed work. Donut slices must be
  // mutually exclusive, so show only active work that is not delayed.
  const active = Math.max(num(raw.active) - delayed, 0);
  return { total, completed, ontrack, delayed, active };
}

function ProjectDetail({ data, navigate }) {
  const p = normalizeProject(data.project || {});
  const kpis = normalizeProjectKpis(data.kpis || {}, p);
  const finance = normalizeFinance(data.finance || {});
  const sla = normalizeSla(data.sla || {});
  const approvals = normalizeApprovals(data.approvals || {});
  const statusCounts = normalizeStatusCounts(data.statusCounts || {});

  const uuid = p.id;
  const status = String(p.lifecycleStatus || p.bucket || "").toUpperCase();

  // Context object attached to each item row so the tables/DelayList can
  // show project code / org / division.
  const pCtx = {
    id: p.projectCode, uuid, name: p.name,
    organisation: p.organisation, division: p.division,
  };

  const items = Array.isArray(data.treeItems)
    ? data.treeItems
    : (Array.isArray(data.items) ? data.items.map((r) => itemRowToTrackRow(r, pCtx)) : []);

  const [itemsFilter, setItemsFilter] = useState(null);
  const itemsFilterRef = useRef(null);

  const filteredItems = (() => {
    if (!itemsFilter) return items;
    return items.filter((r) => {
      if (itemsFilter.kind && r.kind !== itemsFilter.kind) return false;
      if (itemsFilter.status && r.status !== itemsFilter.status) return false;
      return true;
    });
  })();

  function applyFilter(next) { setItemsFilter(next); requestAnimationFrame(() => itemsFilterRef.current?.scrollIntoView({ behavior: "smooth", block: "start" })); }
  function clearFilter() { setItemsFilter(null); }

  function openInPM() { if (!uuid) return; navigate(`/projects/${encodeURIComponent(uuid)}/config`); }
  function openFinance() { if (!uuid) return; navigate(`/projects/${encodeURIComponent(uuid)}/finance`); }

  const chartCounts = itemsFilter
    ? filteredItems.reduce((acc, r) => { acc[r.status] = (acc[r.status] || 0) + 1; acc.total = (acc.total || 0) + 1; return acc; }, { active: 0, ontrack: 0, completed: 0, delayed: 0, total: 0 })
    : statusCounts.total ? statusCounts : items.reduce((acc, r) => { acc[r.status] = (acc[r.status] || 0) + 1; acc.total = (acc.total || 0) + 1; return acc; }, { active: 0, ontrack: 0, completed: 0, delayed: 0, total: 0 });

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

  const timeline = asArray(data.paymentTimeline || data.timeline).map((t) => ({
    label: firstDefined(t.month, t.label, t.period) || "—",
    "Planned (Cr)": num(t.plannedCr, t.planned, t.plannedAmount),
    "Actual (Cr)": num(t.actualCr, t.actual, t.actualAmount),
  }));
  const breaches = sla.breaches || [];
  const wf = approvals.workflow || [];
  const apprStatus = approvals.statusByItems || null;
  const delayedTrackRows = asArray(data.delayedTrack || data.delayedItems).map((d) => ({
    key: `${firstDefined(d.kind, d.type, "item")}:${firstDefined(d.wbs, d.code, d.id, d.name)}`,
    name: firstDefined(d.name, d.activity, d.activityName) || "—",
    kind: firstDefined(d.kind, d.type) || "activity",
    delay: num(d.delay, d.delayDays, d.daysDelayed),
    wbs: firstDefined(d.wbs, d.code) || "—",
    project: pCtx,
  }));

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
          {p.description && <div className="dash-phead-description">{p.description}</div>}
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
        <KpiCard tone="blue" icon=" " label="Overall Progress" value={`${kProgress.value ?? 0}%`} onClick={() => applyFilter(null)} gauge={kProgress.value ?? 0}
          delta={kProgress.delta} />
        <KpiCard tone="cyan" icon=" " label="Milestones" value={`${kMilestones.done ?? 0}/${kMilestones.total ?? 0}`}
          foot={kMilestones.total ? `${kMilestones.pct ?? Math.round((kMilestones.done / kMilestones.total) * 100)}% completed` : "—"} onClick={() => applyFilter({ kind: "milestone" })} />
        <KpiCard tone="green" icon=" " label="Activities" value={`${kActivities.done ?? 0}/${kActivities.total ?? 0}`}
          foot={kActivities.total ? `${kActivities.pct ?? Math.round((kActivities.done / kActivities.total) * 100)}% completed` : "—"} onClick={() => applyFilter({ kind: "activity" })} />
        <KpiCard tone="orange" icon=" " label="Delayed Items" value={kDelayed.value ?? 0} foot={kDelayed.maxDelayDays ? `Max Delay ${kDelayed.maxDelayDays} Days` : "on schedule"} onClick={() => applyFilter({ status: "delayed" })} />
        <KpiCard tone="purple" icon=" " label="Pending Approvals" value={approvals.available ? (kPending.value ?? approvals.pending ?? 0) : "—"} foot={approvals.available ? "activities awaiting approval" : "workflow n/a"} delta={kPending.delta} />
        <KpiCard tone="teal" icon=" " label="Budget vs Released"
          value={hasFinance ? <CurrencyAmount value={contractValue} /> : "—"}
          foot={hasFinance ? <><CurrencyAmount value={released} /> released · {budgetPct}%</> : "no finance"} />
      </div>

      <QuarterlyProjectReview
        project={p}
        finance={finance}
        settlements={data.settlements}
        navigate={navigate}
      />

      {/* ── Widgets — 3 per row ── */}
      <div className="dp-row c3">
        <Widget title="M → A → T → ST Status" sub={itemsFilter ? `Filtered: ${filterLabel(itemsFilter)}` : `${statusCounts.total || items.length} project items`} onClick={() => applyFilter(null)}>
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
              <div className="dp-sla-meta">{sla.dataState || "available"} · {sla.evaluated} evaluated · {sla.pending} pending · {sla.excluded} excluded</div>
            </div>
          ) : (
            <div className="dash-empty" style={{ padding: "26px 12px", lineHeight: 1.6 }}>SLA data not available.</div>
          )}
        </Widget>
        <Widget title="SLA Performance" sub="top 5 breaches">
          {sla.available && breaches.length ? (
            <table className="dp-mtable">
              <thead><tr><th>Activity / SLA</th><th>Formula</th><th className="num">Observed</th><th className="num">Points</th><th className="num">LD</th><th>Status</th></tr></thead>
              <tbody>
                {breaches.slice(0, 5).map((b) => (
                  <tr key={`${b.wbs}:${b.activity}:${b.slaRef}`}>
                    <td>{b.wbs} {b.activity}<small className="dp-table-detail">{b.slaRef} · severity {b.severityLevel}</small></td>
                    <td>{b.formulaType}</td><td className="num">{b.observedValue}</td><td className="num">{b.accumulatedPoints}</td>
                    <td className="num dp-danger">{b.ldPercent}%</td><td><span className={`dp-tag ${b.status}`}>{b.status}</span></td>
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
                <tr><td>Contract Value</td><td className="num"><CurrencyAmount value={contractValue} /></td></tr>
                <tr><td>Scheduled</td><td className="num"><CurrencyAmount value={finance.scheduled ?? 0} /></td></tr>
                <tr><td>Fixed Cost</td><td className="num"><CurrencyAmount value={finance.fixedCost ?? 0} /></td></tr>
                <tr><td>One-time Cost</td><td className="num"><CurrencyAmount value={finance.oneTimeCost ?? 0} /></td></tr>
                <tr><td>Recurring Cost</td><td className="num"><CurrencyAmount value={finance.recurringCost ?? 0} /></td></tr>
                <tr><td>Released</td><td className="num"><CurrencyAmount value={released} /></td></tr>
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

function moneyValue(value) {
  return value == null || value === "" ? null : Number(value) || 0;
}

function CurrencyAmount({ value }) {
  return <span title={formatINR(value, { compact: false })}>{formatINR(value)}</span>;
}

function QuarterlyProjectReview({ project, finance, settlements: suppliedSettlements, navigate }) {
  const projectId = project.id;
  const [quarters, setQuarters] = useState(() => contractQuarters(project.plannedStart, project.plannedEnd));
  const [quarter, setQuarter] = useState(() => contractQuarters(project.plannedStart, project.plannedEnd)[0]?.key || "");
  const [settlements, setSettlements] = useState(Array.isArray(suppliedSettlements) ? suppliedSettlements : []);
  const [rollup, setRollup] = useState(null);
  const [pqp, setPqp] = useState(null);
  const [loading, setLoading] = useState(false);
  const [historyLoading, setHistoryLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    const fallback = contractQuarters(project.plannedStart, project.plannedEnd);
    listSettlements(projectId)
      .then((rows) => {
        if (cancelled) return;
        const list = Array.isArray(rows) ? rows : [];
        setSettlements(list);
        const fromRows = list.map((row) => ({
          key: quarterKeyOfRow(row),
          label: quarterKeyOfRow(row),
          start: row.quarterStart,
          end: row.quarterEnd,
        })).filter((row) => row.key);
        const merged = [...fromRows, ...fallback].filter((row, index, all) => all.findIndex((x) => x.key === row.key) === index);
        if (merged.length) {
          setQuarters(merged);
          setQuarter((current) => current && merged.some((row) => row.key === current) ? current : merged[0].key);
        }
      })
      .catch(() => {})
      .finally(() => { if (!cancelled) setHistoryLoading(false); });
    return () => { cancelled = true; };
  }, [projectId, project.plannedStart, project.plannedEnd]);

  useEffect(() => {
    if (!projectId || !quarter) return undefined;
    let cancelled = false;
    Promise.resolve().then(() => {
      if (cancelled) return null;
      setLoading(true); setRollup(null); setPqp(null);
      return Promise.allSettled([getQuarterlyAggregate(projectId, quarter), getPqp(projectId, quarter)]);
    })
      .then((results) => {
        if (!results) return;
        const [aggregateResult, pqpResult] = results;
        if (cancelled) return;
        setRollup(aggregateResult.status === "fulfilled" ? aggregateResult.value : null);
        setPqp(pqpResult.status === "fulfilled" ? pqpResult.value : null);
      })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [projectId, quarter]);

  const settlement = settlements.find((row) => quarterKeyOfRow(row) === quarter) || null;
  const planned = moneyValue(settlement?.pqp ?? pqp?.pqp ?? pqp?.fAmount);
  const ldAmount = moneyValue(settlement?.ldAmount);
  const adjusted = moneyValue(settlement?.aqpAmount);
  const ldPercent = settlement?.sumLdPercent ?? rollup?.totalLdPercent ?? rollup?.totalLdPercentUncapped;
  const breaches = Array.isArray(rollup?.perSla) ? rollup.perSla.filter((row) => Number(row.ldPercent ?? row.ld_percent ?? 0) > 0) : [];
  const selectedWindow = quarters.find((row) => row.key === quarter);
  const financeBaseline = moneyValue(finance?.scheduled);
  const status = settlement?.status || (rollup ? "calculated_not_settled" : "not_available");

  return (
    <section className="dp-quarter-review">
      <div className="dp-quarter-head">
        <div>
          <div className="dp-quarter-kicker">Project commercial health</div>
          <h2 className="dp-quarter-title">Quarterly SLA + Finance Review</h2>
          <p className="dp-quarter-copy">See what was planned, what SLA performance deducted, and what is actually payable.</p>
        </div>
        <div className="dp-quarter-controls">
          <label htmlFor="project-review-quarter">Quarter</label>
          <select id="project-review-quarter" value={quarter} onChange={(event) => setQuarter(event.target.value)} disabled={historyLoading || !quarters.length}>
            {!quarters.length && <option value="">No quarter data</option>}
            {quarters.map((row) => <option key={row.key} value={row.key}>{row.label || row.key}</option>)}
          </select>
        </div>
      </div>

      {selectedWindow?.start && <div className="dp-quarter-window">Measurement window: {selectedWindow.start} to {selectedWindow.end}</div>}
      {loading && <div className="dp-quarter-empty">Loading SLA and payment figures…</div>}
      {!loading && !quarter && <div className="dp-quarter-empty">No quarter is configured for this project.</div>}
      {!loading && quarter && (
        <>
          <div className="dp-quarter-metrics">
            <QuarterMetric label="SLA deduction base (PQP)" value={planned != null ? <CurrencyAmount value={planned} /> : "—"} tone="finance" hint="F / PQP from SLA service; not total contract value" />
            <QuarterMetric label="SLA deduction" value={ldAmount != null ? <CurrencyAmount value={ldAmount} /> : "Not settled"} tone="danger" hint={ldPercent != null ? `${Number(ldPercent).toFixed(2)}% LD` : "No settlement result yet"} />
            <QuarterMetric label="Adjusted payable" value={adjusted != null ? <CurrencyAmount value={adjusted} /> : "Pending"} tone="payable" hint="Quarterly base after SLA deduction" />
            <QuarterMetric label="Finance baseline" value={financeBaseline != null ? <CurrencyAmount value={financeBaseline} /> : "—"} tone="neutral" hint="All project payment terms, not a quarter allocation" />
          </div>
          <div className="dp-quarter-bottom">
            <div className={`dp-quarter-status ${status.includes("blocked") || status === "not_available" ? "is-warn" : ""}`}>
              <strong>{status === "auto_closed" || status === "finalized" || status === "invoiced" ? "Quarter settled" : status === "calculated_not_settled" ? "SLA calculated, payment not settled" : "Quarter data unavailable"}</strong>
              <span>{status === "calculated_not_settled" ? "Review the breaches and close the quarter in the SLA settlement view before invoicing." : status === "not_available" ? "There is no SLA rollup or settlement recorded for this quarter." : "Use the detailed settlement view for approval, override, and invoice actions."}</span>
            </div>
            <div className="dp-quarter-gap">
              <span className="dp-quarter-gap-label">What may be going wrong</span>
              <strong>{breaches.length ? `${breaches.length} SLA${breaches.length === 1 ? "" : "s"} causing LD` : "No breach detail available"}</strong>
              <span>{rollup?.totalLdPercentUncapped != null ? `Uncapped LD: ${Number(rollup.totalLdPercentUncapped).toFixed(2)}%` : "Check activity-level SLA results"}</span>
            </div>
          </div>
          <div className="dp-quarter-actions">
            <button type="button" className="dash-ghost-btn" onClick={() => navigate(`/projects/${encodeURIComponent(projectId)}/sla-settlement`)}>Open SLA settlement</button>
            <button type="button" className="dash-primary-btn" onClick={() => navigate(`/projects/${encodeURIComponent(projectId)}/finance`)}>Open finance details</button>
          </div>
        </>
      )}
    </section>
  );
}

function QuarterMetric({ label, value, hint, tone }) {
  return <div className={`dp-quarter-metric ${tone}`}><span>{label}</span><strong>{value}</strong><small>{hint}</small></div>;
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
        <thead><tr><th>WBS</th><th>Name</th><th>Progress</th><th>Status</th><th>Expected Dates</th><th>Actual Dates</th><th>Delay</th><th>Type</th><th>Approval</th><th>Project Management</th></tr></thead>
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
              <td>{r.kind === "activity" && <span className={`dash-pill approval-${r.approvalState || "idle"}`}>{LABELS[r.approvalState] || r.approvalState || "Idle"}</span>}</td>
              <td><button type="button" className="dash-pm-btn" onClick={onOpenPM}>Open in PM</button></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}