/* Dashboard / Summary view.
   Top-level routable page — reads from /api/v3/dashboard/projects in a
   single call and derives everything client-side: pie totals, per-org
   roll-up, per-division roll-up, delayed-track list. Cards expand
   inline ("+N More" → show all). Sub-view drill-downs (KPI / division /
   delayed-row) fetch their own data on click. */

import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  summary as fetchSummary,
  projectsList as fetchDashboardProjects,
  projectItems as fetchProjectItems,
  projectCardToLegacy,
  normalizeSummaryResponse,
} from "../../api/dashboard";
import {
  API_BUCKETS, LABELS, COLORS,
  Donut, Legend, Kpi, DelayList, SignalCards, DelayFilter, ProjectCardGrid,
  itemRowToTrackRow, extractItemsPayload,
  countsForProjects,
  range, todayDate,
} from "./_shared";
import "../../styles/Dashboard.css";

const VIS = 4, VIS_GROUPS = 3;

export default function SummaryView() {
  const navigate = useNavigate();

  const [summaryData, setSummaryData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(null);
  const [reloadTick, setReloadTick] = useState(0);

  const [delayFilter, setDelayFilter] = useState(5);
  const [subView, setSubView] = useState(null);

  useEffect(() => {
    setLoading(true); setLoadError(null);

    let cancelled = false;
    // Track which source has populated `summaryData` so the slow
    // projects fetch always wins if it arrives — even if the fast
    // summary call already painted the screen with top-N rollups.
    let projectsArrived = false;
    let summaryArrived = false;

    // Fast path — /dashboard/summary is a small aggregated response
    // that paints KPIs, pie chart, and top-N orgs/divs/delays within
    // ~1s. Skipped if the slower projects call has already won.
    fetchSummary({ delayMinDays: 1 })
      .then((payload) => {
        if (cancelled || projectsArrived) return;
        const normalized = normalizeSummaryResponse(payload);
        if (!normalized) return;
        summaryArrived = true;
        setSummaryData(normalized);
        setLoading(false);
      })
      .catch((e) => {
        // Don't surface — the slow path may still rescue us.
        console.warn("[SummaryView] summary failed:", e?.message || e);
      });

    // Slow path — /dashboard/projects?pageSize=200 returns every
    // project, which we aggregate client-side to populate the full
    // "+N More" counts and the entire delayed-track list.
    fetchDashboardProjects({ pageSize: 200 })
      .then((payload) => {
        if (cancelled) return;
        projectsArrived = true;
        setSummaryData(deriveSummary(payload));
        setLoading(false);
      })
      .catch((e) => {
        if (cancelled) return;
        console.error("[SummaryView] projects failed:", e?.message || e);
        // Only surface as a hard error if the fast path never landed.
        if (!summaryArrived) {
          setLoadError("Failed to load dashboard. Please retry.");
          setSummaryData(null);
          setLoading(false);
        }
      });

    return () => { cancelled = true; };
  }, [reloadTick]);

  function handleRefresh() { setReloadTick((n) => n + 1); }

  function openProjectList(mode) { setSubView({ kind: "projects", mode, searchText: "" }); }
  function openDivision(name) { setSubView({ kind: "division", name }); }
  function openProjectItems(project, opts = {}) {
    // Drill-down into a single project always shows every item the BE
    // tagged with the requested bucket. We pass the project record we
    // already have (from the summary response or a sub-view list) so
    // the items view doesn't need its own project-lookup call.
    setSubView({ kind: "project-items", project, status: opts.status || null });
  }
  function backToSummary() { setSubView(null); }

  function openProject(id) { navigate(`/dashboard/project?id=${encodeURIComponent(id)}`); }
  function openOrg(name) { navigate(`/dashboard/org?name=${encodeURIComponent(name)}`); }

  return (
    <div className="dashboard-wrap">
      <div className="dash-page-head">
        <div className="dash-page-title">Dashboard</div>
        <button type="button" className="dash-primary-btn" onClick={handleRefresh}>Refresh</button>
      </div>

      {loading && <div className="dash-empty" style={{ padding: 24 }}>Loading dashboard…</div>}
      {!loading && loadError && (
        <div className="dash-empty" style={{ padding: 24, color: "#d4440e" }}>
          {loadError} <button type="button" className="dash-ghost-btn" onClick={handleRefresh}>Retry</button>
        </div>
      )}
      {!loading && !loadError && !summaryData && (
        <div className="dash-empty" style={{ padding: 24 }}>No projects yet.</div>
      )}

      <section className="dash-view" hidden={loading || !!loadError || !summaryData}>
        {subView === null && summaryData && (
          <SummaryContent
            data={summaryData}
            delayFilter={delayFilter} setDelayFilter={setDelayFilter}
            onOpenProjectList={openProjectList}
            onOpenProjectItems={openProjectItems}
            onOpenOrg={openOrg}
            onOpenDivision={openDivision}
          />
        )}
        {subView?.kind === "projects" && (
          <ProjectListView
            mode={subView.mode}
            searchText={subView.searchText}
            onSearch={(v) => setSubView((s) => ({ ...s, searchText: v }))}
            onBack={backToSummary}
            onOpenProject={openProject}
          />
        )}
        {subView?.kind === "division" && (
          <DivisionDetail
            name={subView.name}
            onBack={backToSummary} onOpenProject={openProject}
          />
        )}
        {subView?.kind === "project-items" && (
          <ProjectItemsInline
            project={subView.project}
            status={subView.status}
            onBack={backToSummary}
            navigate={navigate}
          />
        )}
      </section>
    </div>
  );
}

/* ─── Summary content — reads from /dashboard/summary aggregate ─── */

function SummaryContent({
  data, delayFilter, setDelayFilter,
  onOpenProjectList, onOpenProjectItems, onOpenOrg, onOpenDivision,
}) {
  const t = data.totals || {};
  const counts = {
    total: t.projects ?? 0,
    active: t.active ?? 0,
    completed: t.completed ?? 0,
    ontrack: t.ontrack ?? 0,
    delayed: t.delayed ?? 0,
  };

  // Each card expands inline — no navigation, no extra fetch.
  const [delaysExpanded, setDelaysExpanded] = useState(false);
  const [orgsExpanded, setOrgsExpanded] = useState(false);
  const [divsExpanded, setDivsExpanded] = useState(false);

  // Delayed projects — BE returns the full list; FE applies the user's
  // chosen threshold without a round-trip.
  const delays = useMemo(() => {
    const list = Array.isArray(data.delayedProjects) ? data.delayedProjects : [];
    return list
      .filter((dp) => (dp.maxDelayDays ?? 0) >= delayFilter)
      .map((dp) => ({
        project: {
          id: dp.projectCode,
          uuid: dp.projectId,
          name: dp.name,
          organisation: dp.organisation,
          division: dp.division,
        },
        name: dp.name,
        count: dp.delayedItems ?? 0,
        delay: dp.maxDelayDays ?? 0,
        kind: "project",
      }))
      .sort((a, b) => b.count - a.count || b.delay - a.delay);
  }, [data.delayedProjects, delayFilter]);

  const totalDelayedItems = useMemo(
    () => delays.reduce((s, x) => s + x.count, 0),
    [delays],
  );

  // Adapt byOrganisation / byDivision to the SignalCards shape — the
  // component reads `g.projects.length`, so we mint a sized-but-empty
  // array (no per-project records needed; the drill-down fetches them).
  const orgs = useMemo(() => bucketsToSignalGroups(data.byOrganisation), [data.byOrganisation]);
  const divs = useMemo(() => bucketsToSignalGroups(data.byDivision), [data.byDivision]);

  return (
    <>
      <div className="dash-kpi-grid" >
        <Kpi cls="total" label="Total Projects" value={counts.total}
          foot={`${orgs.length} organizations / ${divs.length} divisions`}
          onClick={() => onOpenProjectList("total")} />
        <Kpi cls="total" label="Active Projects" value={counts.active}
          foot="open project list" onClick={() => onOpenProjectList("active")} />
        <Kpi cls="completed" label="Completed Projects" value={counts.completed}
          foot="delivered projects" onClick={() => onOpenProjectList("completed")} />
        <Kpi cls="ontrack" label="In Progress" value={counts.ontrack}
          foot="within schedule" onClick={() => onOpenProjectList("ontrack")} />
        <Kpi cls="delayed" label="Delayed" value={counts.delayed}
          foot="open project list" onClick={() => onOpenProjectList("delayed")} />
      </div>

      <div className="dash-grid-2" >
        <div className="dash-card">
          <div className="dash-card-title">Pie Chart<span className="dash-card-sub">Project status</span></div>
          <div className="dash-donut-wrap">
            <Donut counts={counts} keys={["completed", "ontrack", "delayed"]} />
            <Legend counts={counts} keys={["completed", "ontrack", "delayed"]} />
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
          <DelayList rows={delays} mode="project"
            limit={delaysExpanded ? undefined : VIS}
            onOpenProject={(p, df) => onOpenProjectItems(p, { status: "delayed", minDelay: df })}
            delayFilter={delayFilter} />
          {delays.length > VIS && (
            <div className="dash-actions">
              <button type="button" className="dash-more-btn"
                onClick={() => setDelaysExpanded((v) => !v)}>
                {delaysExpanded ? "Show less" : `+${delays.length - VIS} More`}
              </button>
            </div>
          )}
        </div>
      </div>

      <div className="dash-grid-2" >
        <div className="dash-card">
          <div className="dash-card-title">Organization View<span className="dash-card-sub">Total / Completed / In Progress / Delayed</span></div>
          <SignalCards groups={orgs} limit={orgsExpanded ? undefined : VIS_GROUPS} onClick={onOpenOrg} />
          {orgs.length > VIS_GROUPS && (
            <div className="dash-actions">
              <button type="button" className="dash-more-btn"
                onClick={() => setOrgsExpanded((v) => !v)}>
                {orgsExpanded ? "Show less" : `+${orgs.length - VIS_GROUPS} More`}
              </button>
            </div>
          )}
        </div>
        <div className="dash-card">
          <div className="dash-card-title">Division View<span className="dash-card-sub">Total / Completed / In Progress / Delayed</span></div>
          <SignalCards groups={divs} limit={divsExpanded ? undefined : VIS_GROUPS} onClick={onOpenDivision} />
          {divs.length > VIS_GROUPS && (
            <div className="dash-actions">
              <button type="button" className="dash-more-btn"
                onClick={() => setDivsExpanded((v) => !v)}>
                {divsExpanded ? "Show less" : `+${divs.length - VIS_GROUPS} More`}
              </button>
            </div>
          )}
        </div>
      </div>
    </>
  );
}

/* Project list → canonical summary view-model.
   Produces totals, byOrganisation, byDivision, delayedProjects in the
   exact shape SummaryContent already consumes. Each project counts once
   for the pie totals but contributes once *per org it belongs to* in
   byOrganisation — that mirrors how the BE's `topOrganisations`
   roll-up worked, so the numbers line up with what users saw before. */
function deriveSummary(payload) {
  const cards = Array.isArray(payload?.projects) ? payload.projects : [];
  const beCounts = payload?.counts || {};

  const orgMap = new Map();
  const divMap = new Map();
  const delayedProjects = [];

  for (const card of cards) {
    const bucket = card?.bucket || "active";

    const orgs = Array.isArray(card?.organisations) ? card.organisations : [];
    for (const o of orgs) {
      const key = o?.id || o?.name;
      if (!key) continue;
      const g = orgMap.get(key) || { name: o?.name || "—", total: 0, completed: 0, ontrack: 0, delayed: 0 };
      g.total++;
      if (g[bucket] != null) g[bucket]++;
      orgMap.set(key, g);
    }

    const divName = card?.division || card?.divisionOther || "—";
    const dg = divMap.get(divName) || { name: divName, total: 0, completed: 0, ontrack: 0, delayed: 0 };
    dg.total++;
    if (dg[bucket] != null) dg[bucket]++;
    divMap.set(divName, dg);

    if (bucket === "delayed" && (card?.delayedItemCount ?? 0) > 0) {
      const primaryOrg = orgs[0]?.name || "—";
      delayedProjects.push({
        projectId: card.id,
        projectCode: card.projectCode || card.id,
        name: card.name || "",
        organisation: primaryOrg,
        division: divName,
        delayedItems: card.delayedItemCount ?? 0,
        maxDelayDays: card.maxDelayDays ?? 0,
      });
    }
  }

  // Prefer BE-supplied roll-up counts (covers the whole project set
  // even when cards[] is capped at pageSize).
  const totalProjects = beCounts.total ?? cards.length;
  const completed = beCounts.completed ?? 0;
  const totals = {
    projects: totalProjects,
    completed,
    ontrack: beCounts.ontrack ?? 0,
    delayed: beCounts.delayed ?? 0,
    active: beCounts.active ?? Math.max(totalProjects - completed, 0),
  };

  return {
    totals,
    byOrganisation: Array.from(orgMap.values()),
    byDivision: Array.from(divMap.values()),
    delayedProjects: delayedProjects.sort(
      (a, b) => b.delayedItems - a.delayedItems || b.maxDelayDays - a.maxDelayDays,
    ),
  };
}

function bucketsToSignalGroups(input) {
  const list = Array.isArray(input) ? input : [];
  return list.map((o) => ({
    name: o.name,
    projects: new Array(o.total ?? 0),
    counts: {
      total: o.total ?? 0,
      completed: o.completed ?? 0,
      ontrack: o.ontrack ?? 0,
      delayed: o.delayed ?? 0,
    },
  })).sort((a, b) => b.projects.length - a.projects.length || a.name.localeCompare(b.name));
}

/* ─── Project list sub-view (per-bucket fetch) ─────────────── */

function ProjectListView({ mode, searchText, onSearch, onBack, onOpenProject }) {
  const today = useMemo(() => todayDate(), []);
  const bucket = API_BUCKETS[mode] || null;

  const [list, setList] = useState([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);

  useEffect(() => {
    let cancelled = false;
    setBusy(true); setErr(null);
    const query = bucket ? { bucket, pageSize: 200 } : { pageSize: 200 };
    fetchDashboardProjects(query)
      .then((payload) => {
        if (cancelled) return;
        const cards = Array.isArray(payload?.projects) ? payload.projects : [];
        setList(cards.map(projectCardToLegacy).filter(Boolean));
        setBusy(false);
      })
      .catch(() => {
        if (cancelled) return;
        setErr("Failed to load projects. Please retry.");
        setList([]); setBusy(false);
      });
    return () => { cancelled = true; };
  }, [bucket]);

  const q = searchText.trim().toLowerCase();
  const rows = useMemo(() => list.filter((p) =>
    !q || [p.id, p.name, p.organisation, p.division, p.owner].join(" ").toLowerCase().includes(q)
  ), [list, q]);

  const titleMap = {
    total: "All Projects", active: "Active Projects", completed: "Completed Projects",
    ontrack: "In Progress Projects", delayed: "Delayed Projects",
  };
  const title = titleMap[mode] || "Projects";
  const c = useMemo(() => countsForProjects(rows, today), [rows, today]);

  return (
    <>
      <div className="dash-track-head">
        <div className="dash-track-head-title">{title}</div>
        <div className="dash-track-actions">
          <button type="button" className="dash-ghost-btn" onClick={onBack}>Back</button>
        </div>
      </div>
      <div className="dash-card">
        <div className="dash-card-title">Pie Chart<span className="dash-card-sub">{title} status distribution</span></div>
        <div className="dash-donut-wrap">
          <Donut counts={c} keys={["completed", "ontrack", "delayed"]} />
          <Legend counts={c} keys={["completed", "ontrack", "delayed"]} />
        </div>
      </div>
      <div className="dash-card">
        <div className="dash-card-title">{title}<span className="dash-card-sub">{rows.length} project{rows.length === 1 ? "" : "s"}</span></div>
        <input className="dash-list-search" type="search" value={searchText}
          placeholder="Search Project" onChange={(e) => onSearch(e.target.value)} />
        {busy && <div className="dash-empty">Loading projects…</div>}
        {!busy && err && <div className="dash-empty" style={{ color: "#d4440e" }}>{err}</div>}
        {!busy && !err && <ProjectCardGrid projects={rows} onOpenProject={onOpenProject} />}
      </div>
    </>
  );
}

/* ─── Division detail — self-fetches its own projects list ─── */

function DivisionDetail({ name, onBack, onOpenProject }) {
  const today = useMemo(() => todayDate(), []);
  const [list, setList] = useState([]);
  const [busy, setBusy] = useState(true);
  const [err, setErr] = useState(null);

  useEffect(() => {
    let cancelled = false;
    setBusy(true); setErr(null);
    fetchDashboardProjects({ division: name, pageSize: 200 })
      .then((payload) => {
        if (cancelled) return;
        const cards = Array.isArray(payload?.projects) ? payload.projects : [];
        setList(cards.map(projectCardToLegacy).filter(Boolean));
        setBusy(false);
      })
      .catch(() => {
        if (cancelled) return;
        setErr("Failed to load projects. Please retry.");
        setList([]); setBusy(false);
      });
    return () => { cancelled = true; };
  }, [name]);

  const c = useMemo(() => countsForProjects(list, today), [list, today]);

  return (
    <>
      <div className="dash-project-head">
        <div className="dash-project-title">{name}</div>
        <div className="dash-project-desc">
          {busy ? "Loading projects…" : `${list.length} project${list.length === 1 ? "" : "s"} in this division.`}
        </div>
        <div className="dash-track-actions">
          <button type="button" className="dash-ghost-btn" onClick={onBack}>Back</button>
        </div>
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
            <div className="dash-card-title">Pie Chart<span className="dash-card-sub">{name}</span></div>
            <div className="dash-donut-wrap">
              <Donut counts={c} keys={["completed", "ontrack", "delayed"]} />
              <Legend counts={c} keys={["completed", "ontrack", "delayed"]} />
            </div>
          </div>
          <div className="dash-card" style={{marginTop:"20px"}}>
            <div className="dash-card-title">Projects<span className="dash-card-sub">Click project to open Project View</span></div>
            <ProjectCardGrid projects={list} onOpenProject={onOpenProject} />
          </div>
        </>
      )}
    </>
  );
}

/* ─── Per-project items sub-view (uses /dashboard/projects/{uuid}/items) ── */

function ProjectItemsInline({ project, status, onBack, navigate }) {
  function openInPM() {
    const id = project?.uuid || project?.id;
    if (!id) return;
    navigate(`/projects/${encodeURIComponent(id)}/config`);
  }
  const [items, setItems] = useState([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);

  useEffect(() => {
    if (!project?.uuid) return;
    let cancelled = false;
    setBusy(true); setErr(null);
    fetchProjectItems(project.uuid, { bucket: status || undefined })
      .then((payload) => {
        if (cancelled) return;
        const rows = extractItemsPayload(payload);
        setItems(rows.map((r) => itemRowToTrackRow(r, project)));
        setBusy(false);
      })
      .catch(() => {
        if (cancelled) return;
        setErr("Failed to load project items. Please retry.");
        setItems([]); setBusy(false);
      });
    return () => { cancelled = true; };
  }, [project?.uuid, status]);

  const isDelayed = status === "delayed";
  const title = isDelayed ? "Delayed Tracks" : "Project Items";

  if (!project) {
    return (
      <>
        <div className="dash-track-head">
          <div className="dash-track-head-title">{title}</div>
          <div className="dash-track-actions">
            <button type="button" className="dash-ghost-btn" onClick={onBack}>Back</button>
          </div>
        </div>
        <div className="dash-empty">Project not found.</div>
      </>
    );
  }

  const c = items.reduce((acc, r) => {
    acc[r.status] = (acc[r.status] || 0) + 1;
    acc.total = (acc.total || 0) + 1;
    return acc;
  }, { active: 0, ontrack: 0, completed: 0, delayed: 0, total: 0 });

  const pieCounts = isDelayed ? { delayed: c.delayed, total: c.delayed } : c;
  const pieKeys = isDelayed ? ["delayed"] : ["completed", "ontrack", "delayed"];

  return (
    <>
      <div className="dash-track-head">
        <div className="dash-track-head-title">{title}</div>
        <div className="dash-track-sub">{project.id} — {project.name}</div>
        <div className="dash-track-actions">
          <button type="button" className="dash-ghost-btn" onClick={onBack}>Back</button>
        </div>
      </div>

      {!isDelayed && (
        <div className="dash-kpi-grid" >
          <Kpi cls="total" label="Total Items" value={c.total} foot="milestones + activities" />
          <Kpi cls="completed" label="Completed" value={c.completed} foot="finished" />
          <Kpi cls="ontrack" label="In Progress" value={c.ontrack} foot="within schedule" />
          <Kpi cls="delayed" label="Delayed" value={c.delayed} foot="past expected end date" />
        </div>
      )}

      {!isDelayed && (
        <div className="dash-card">
          <div className="dash-card-title">Pie Chart<span className="dash-card-sub">Status distribution</span></div>
          <div className="dash-donut-wrap">
            <Donut counts={pieCounts} keys={pieKeys} />
            <Legend counts={pieCounts} keys={pieKeys} />
          </div>
        </div>
      )}

      <div className="dash-track-table-wrap" style={{ marginTop: "20px", marginBottom: "20px" }}>
        {busy && <div className="dash-empty">Loading items…</div>}
        {!busy && err && <div className="dash-empty" style={{ color: "#d4440e" }}>{err}</div>}
        {!busy && !err && (
          <table className="dash-track-table">
            <thead>
              <tr>
                <th>WBS</th><th>Name</th><th>Progress</th><th>Status</th>
                <th>Expected Dates</th><th>Actual Dates</th><th>Delay</th><th>Type</th>
                <th>Project Management</th>
              </tr>
            </thead>
            <tbody>
              {items.length === 0 ? (
                <tr><td colSpan={9}><div className="dash-empty">No items found.</div></td></tr>
              ) : items.map((r) => (
                <tr key={r.key} className={`dash-row-${r.kind}`}>
                  <td className="dash-wbs">{r.wbs}</td>
                  <td>
                    <span className="dash-track-name">{r.name}</span>
                    <span className="dash-track-context">{r.context}</span>
                  </td>
                  <td>
                    <div className="dash-mini-progress">
                      <span className="dash-mini-bar"><div style={{ width: `${r.progress}%`, background: COLORS[r.status] }} /></span>
                      <span className="dash-mini-pct">{r.progress}%</span>
                    </div>
                  </td>
                  <td><span className={`dash-pill ${r.status}`}>{LABELS[r.status] || r.status}</span></td>
                  <td className="dash-date-cell">{range(r.plannedStart, r.plannedEnd)}</td>
                  <td className="dash-date-cell">{r.actualStart ? range(r.actualStart, r.actualEnd) : "-"}</td>
                  <td>{r.delay ? `${r.delay}d` : "-"}</td>
                  <td><span className="dash-type-pill">{r.kind}</span></td>
                  <td>
                    <button type="button" className="dash-pm-btn" onClick={openInPM}>
                      Open in PM
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </>
  );
}
