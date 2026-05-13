/* Dashboard / Organization view.
   Top-level routable page. Two modes:
   - No params / ?all=1 → list of organisations, fed by
     /api/v3/dashboard/summary (aggregate; no project records needed).
   - ?name=<org> → single-org drill-down, lazy-fetches that org's
     projects via /api/v3/dashboard/projects?q=<name>. */

import { useEffect, useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import {
  projectsList as fetchDashboardProjects,
  projectCardToLegacy,
} from "../../api/dashboard";
import {
  Donut, Legend, Kpi, SignalCards, ProjectCardGrid,
  countsForProjects, todayDate,
} from "./_shared";
import "../../styles/Dashboard.css";

const VIS = 4;

export default function OrganizationView() {
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const selectedName = params.get("name");
  const showAll = params.get("all") === "1";

  const [reloadTick, setReloadTick] = useState(0);

  function handleRefresh() { setReloadTick((n) => n + 1); }
  function openGroup(name) { setParams({ name }); }
  function backToList() { setParams({}); }
  function showAllOrgs() { setParams({ all: "1" }); }
  function openProject(id) {
    navigate(`/dashboard/project?id=${encodeURIComponent(id)}`);
  }

  return (
    <div className="dashboard-wrap">
      <div className="dash-page-head">
        <div className="dash-page-title">Organization View</div>
        <button type="button" className="dash-primary-btn" onClick={handleRefresh}>Refresh</button>
      </div>

      {selectedName ? (
        <OrgDetail
          name={selectedName} reloadTick={reloadTick}
          onBack={backToList} onOpenProject={openProject}
        />
      ) : (
        <OrgListLoader
          showAll={showAll} reloadTick={reloadTick}
          onOpenGroup={openGroup} onShowAll={showAllOrgs}
        />
      )}
    </div>
  );
}

/* ─── All-orgs list — derived from /dashboard/projects?pageSize=200 ─── */

function OrgListLoader({ showAll, reloadTick, onOpenGroup, onShowAll }) {
  // Single call to /dashboard/projects gives us both the per-project
  // bucket aggregates (for the pie) and each project's organisations[]
  // (which we group on, so every org gets credited for the projects it
  // touches). Top N stays visible by default; "+More" just toggles the
  // client-side slice — no extra request.
  const [allOrgs, setAllOrgs] = useState([]);
  const [pieCounts, setPieCounts] = useState({ total: 0, completed: 0, ontrack: 0, delayed: 0, active: 0 });
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(null);

  useEffect(() => {
    setLoading(true); setLoadError(null);
    let cancelled = false;
    fetchDashboardProjects({ pageSize: 200 })
      .then((payload) => {
        if (cancelled) return;
        const cards = Array.isArray(payload?.projects) ? payload.projects : [];
        const { orgs, counts } = aggregateProjects(cards);
        // Prefer BE-supplied roll-up if present — projects may be
        // capped at pageSize while counts cover the entire set.
        const beCounts = payload?.counts;
        const pie = {
          total: beCounts?.total ?? counts.total,
          completed: beCounts?.completed ?? counts.completed,
          ontrack: beCounts?.ontrack ?? counts.ontrack,
          delayed: beCounts?.delayed ?? counts.delayed,
          active: beCounts?.active ?? Math.max((beCounts?.total ?? counts.total) - (beCounts?.completed ?? counts.completed), 0),
        };
        setAllOrgs(orgs);
        setPieCounts(pie);
        setLoading(false);
      })
      .catch((e) => {
        if (cancelled) return;
        console.error("[OrgListLoader] load failed:", e?.message || e);
        setLoadError("Failed to load organisations. Please retry.");
        setAllOrgs([]);
        setLoading(false);
      });
    return () => { cancelled = true; };
  }, [reloadTick]);

  if (loading) return <div className="dash-empty" style={{ padding: 24 }}>Loading dashboard…</div>;
  if (loadError) return (
    <div className="dash-empty" style={{ padding: 24, color: "#d4440e" }}>{loadError}</div>
  );
  if (allOrgs.length === 0) return (
    <div className="dash-empty" style={{ padding: 24 }}>No organizations yet.</div>
  );

  const visible = showAll ? allOrgs : allOrgs.slice(0, VIS);
  return (
    <section className="dash-view">
      <div className="dash-card">
        <div className="dash-card-title">
          Pie Chart<span className="dash-card-sub">All organizations / project status</span>
        </div>
        <div className="dash-donut-wrap">
          <Donut counts={pieCounts} keys={["completed", "ontrack", "delayed"]} />
          <Legend counts={pieCounts} keys={["completed", "ontrack", "delayed"]} />
        </div>
      </div>
      <div className="dash-card">
        <div className="dash-card-title">
          All Organizations
          <span className="dash-card-sub">
            {showAll
              ? `${allOrgs.length} organization${allOrgs.length === 1 ? "" : "s"}`
              : "Click organization to see projects"}
          </span>
        </div>
        <SignalCards groups={visible} onClick={onOpenGroup} />
        {!showAll && allOrgs.length > VIS && (
          <div className="dash-actions">
            <button type="button" className="dash-more-btn" onClick={onShowAll}>
              {`+${allOrgs.length - VIS} More`}
            </button>
          </div>
        )}
      </div>
    </section>
  );
}

/* Group project cards by organisation. A project belonging to N orgs
   contributes 1 to each org's per-bucket counter. Projects with no
   organisations[] entry are skipped (they're not "owned" by any vendor). */
function aggregateProjects(cards) {
  const orgMap = new Map();
  const counts = { total: cards.length, completed: 0, ontrack: 0, delayed: 0, active: 0 };

  for (const card of cards) {
    const bucket = card?.bucket || "active";
    if (counts[bucket] != null) counts[bucket]++;

    const orgs = Array.isArray(card?.organisations) ? card.organisations : [];
    for (const o of orgs) {
      const key = o?.id || o?.name;
      if (!key) continue;
      const g = orgMap.get(key) || {
        name: o?.name || "—",
        projects: [],
        counts: { total: 0, completed: 0, ontrack: 0, delayed: 0 },
      };
      g.projects.push(card.id);
      g.counts.total++;
      if (g.counts[bucket] != null) g.counts[bucket]++;
      orgMap.set(key, g);
    }
  }

  const orgs = Array.from(orgMap.values())
    .sort((a, b) => b.projects.length - a.projects.length || a.name.localeCompare(b.name));
  return { orgs, counts };
}

/* ─── Single-org detail — lazy fetches just that org's projects ─── */

function OrgDetail({ name, reloadTick, onBack, onOpenProject }) {
  const today = useMemo(() => todayDate(), []);
  const [list, setList] = useState([]);
  const [busy, setBusy] = useState(true);
  const [err, setErr] = useState(null);

  useEffect(() => {
    let cancelled = false;
    setBusy(true); setErr(null);
    // No precise vendorId in the URL — filter by free-text name. The
    // BE's `q` filter scopes the response, so the FE doesn't have to
    // pull every project just to find this org's slice.
    fetchDashboardProjects({ q: name, pageSize: 200 })
      .then((payload) => {
        if (cancelled) return;
        const cards = Array.isArray(payload?.projects) ? payload.projects : [];
        const mapped = cards.map(projectCardToLegacy).filter(Boolean);
        // Defensive: BE `q` may match more than the org name; tighten
        // by exact org-name match on the client.
        setList(mapped.filter((p) => (p.organisation || "") === name));
        setBusy(false);
      })
      .catch(() => {
        if (cancelled) return;
        setErr("Failed to load projects. Please retry.");
        setList([]); setBusy(false);
      });
    return () => { cancelled = true; };
  }, [name, reloadTick]);

  const c = useMemo(() => countsForProjects(list, today), [list, today]);

  return (
    <section className="dash-view">
      <div className="dash-project-head">
        <div className="dash-project-title">{name}</div>
        <div className="dash-project-desc">
          {busy ? "Loading projects…" : `${list.length} project${list.length === 1 ? "" : "s"} in this organisation.`}
        </div>
        <div className="dash-track-actions">
          <button type="button" className="dash-ghost-btn" onClick={onBack}>Back</button>
        </div>
      </div>

      {busy && <div className="dash-empty">Loading projects…</div>}
      {!busy && err && <div className="dash-empty" style={{ color: "#d4440e" }}>{err}</div>}

      {!busy && !err && (
        <>
          <div className="dash-kpi-grid" style={{ marginTop: "20px", marginBottom: "20px" }}>
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
          <div className="dash-card">
            <div className="dash-card-title">Projects<span className="dash-card-sub">Click project to open Project View</span></div>
            <ProjectCardGrid projects={list} onOpenProject={onOpenProject} />
          </div>
        </>
      )}
    </section>
  );
}
