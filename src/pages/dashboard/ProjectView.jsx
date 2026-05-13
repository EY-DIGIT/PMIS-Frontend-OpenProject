/* Dashboard / Project view.
   Top-level routable page — fetches only what the URL needs:
   - `?id=<projectCode>` → small q-filtered call to find that one
     project (resolves UUID for the items fetch).
   - Picker dropdown → lazy-fetches the full list only on first open.
   - Refresh button → re-fires whatever's currently visible.
   No eager full-list fetch on this page. */

import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import {
  projectsList as fetchDashboardProjects,
  projectItems as fetchProjectItems,
} from "../../api/dashboard";
import {
  Picker, Kpi, Donut, Legend, DelayList,
  itemRowToTrackRow, extractItemsPayload,
  kpisForProject, projectCardToLegacy,
  range, COLORS, LABELS,
} from "./_shared";
import "../../styles/Dashboard.css";

const VIS = 4;

export default function ProjectView() {
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const selectedId = params.get("id") || null;

  const [reloadTick, setReloadTick] = useState(0);

  // Selected project — only this one record loads on mount when ?id=X.
  const [selectedProject, setSelectedProject] = useState(null);
  const [selectedLoading, setSelectedLoading] = useState(false);
  const [selectedError, setSelectedError] = useState(null);

  // Picker list — lazy. Loaded only when the user opens the dropdown
  // (or refreshes the page with no project selected).
  const [pickerList, setPickerList] = useState([]);
  const [pickerLoading, setPickerLoading] = useState(false);
  const [pickerError, setPickerError] = useState(null);
  const [pickerLoadedOnce, setPickerLoadedOnce] = useState(false);
  const [comboOpen, setComboOpen] = useState(false);

  // Fetch only the selected project when ?id changes or refresh fires.
  useEffect(() => {
    if (!selectedId) {
      setSelectedProject(null);
      setSelectedError(null);
      return undefined;
    }

    let cancelled = false;
    setSelectedLoading(true); setSelectedError(null);
    fetchDashboardProjects({ q: selectedId, pageSize: 20 })
      .then((payload) => {
        if (cancelled) return;
        const cards = Array.isArray(payload?.projects) ? payload.projects : [];
        const mapped = cards.map(projectCardToLegacy).filter(Boolean);
        // BE `q` is fuzzy — narrow by exact projectCode (the URL value).
        const exact = mapped.find((p) => p.id === selectedId) || mapped[0] || null;
        setSelectedProject(exact);
        setSelectedLoading(false);
        if (!exact) setSelectedError("Project not found.");
      })
      .catch(() => {
        if (cancelled) return;
        setSelectedError("Failed to load project. Please retry.");
        setSelectedProject(null);
        setSelectedLoading(false);
      });
    return () => { cancelled = true; };
  }, [selectedId, reloadTick]);

  // Picker list — loaded once on first dropdown open. Refresh button
  // also re-loads it if it was already loaded.
  useEffect(() => {
    if (!pickerLoadedOnce) return undefined;
    let cancelled = false;
    setPickerLoading(true); setPickerError(null);
    fetchDashboardProjects({ pageSize: 200 })
      .then((payload) => {
        if (cancelled) return;
        const cards = Array.isArray(payload?.projects) ? payload.projects : [];
        setPickerList(cards.map(projectCardToLegacy).filter(Boolean));
        setPickerLoading(false);
      })
      .catch(() => {
        if (cancelled) return;
        setPickerError("Failed to load projects.");
        setPickerList([]); setPickerLoading(false);
      });
    return () => { cancelled = true; };
  }, [pickerLoadedOnce, reloadTick]);

  function openPicker() {
    if (!comboOpen && !pickerLoadedOnce) setPickerLoadedOnce(true);
    setComboOpen((v) => !v);
  }

  function pickProject(id) {
    setComboOpen(false);
    setParams((prev) => {
      const next = new URLSearchParams(prev);
      if (id) next.set("id", id); else next.delete("id");
      return next;
    });
  }
  function handleRefresh() { setReloadTick((n) => n + 1); }

  // Picker always sees the selected project as a fallback option so the
  // combo button shows its label even before the full list loads.
  const pickerProjects = useMemo(() => {
    if (pickerList.length) return pickerList;
    return selectedProject ? [selectedProject] : [];
  }, [pickerList, selectedProject]);

  const showInitialError = !!selectedError && !selectedProject && !selectedLoading;

  return (
    <div className="dashboard-wrap">
      <div className="dash-page-head">
        <div className="dash-page-title">Project View</div>
        <button type="button" className="dash-primary-btn" onClick={handleRefresh}>Refresh</button>
      </div>

      {showInitialError && (
        <div className="dash-empty" style={{ padding: 24, color: "#d4440e" }}>
          {selectedError} <button type="button" className="dash-ghost-btn" onClick={handleRefresh}>Retry</button>
        </div>
      )}

      <section className="dash-view" hidden={showInitialError}>
        <Picker
          projects={pickerProjects} selectedId={selectedId}
          open={comboOpen} onToggle={openPicker} onPick={pickProject}
          loading={pickerLoading} error={pickerError}
        />

        {!selectedId && (
          <div className="dash-card">
            <div className="dash-empty">Select a project to see details, KPIs and pie chart.</div>
          </div>
        )}

        {selectedId && selectedLoading && !selectedProject && (
          <div className="dash-empty" style={{ padding: 24 }}>Loading project…</div>
        )}

        {selectedId && selectedProject && (
          <ProjectDetail
            key={`${selectedProject.uuid}|${reloadTick}`}
            p={selectedProject} navigate={navigate}
          />
        )}
      </section>
    </div>
  );
}

function ProjectDetail({ p, navigate }) {
  const pk = kpisForProject(p);

  // All M+A rows for this project (server-computed). The pie chart,
  // status counts and delayed-track sub-list all read from this one
  // dashboard call — no tree fetch, no client-side derivation.
  const [items, setItems] = useState([]);
  const [itemsLoading, setItemsLoading] = useState(false);
  const [itemsError, setItemsError] = useState(null);
  const [delaysExpanded, setDelaysExpanded] = useState(false);
  // Tile-driven inline filter for the Items table below — clicking a
  // KPI scopes the table without leaving the page.
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

  // BE doesn't ship activity.approvalState yet, so this stays at 0.
  const pendingApprovals = 0;

  function applyFilter(next) {
    setItemsFilter(next);
    // Scroll the items table into view so the click feels like a drill-down.
    requestAnimationFrame(() => {
      itemsFilterRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  }
  function clearFilter() { setItemsFilter(null); }

  useEffect(() => {
    if (!p?.uuid) return undefined;
    let cancelled = false;
    setItemsLoading(true); setItemsError(null);
    fetchProjectItems(p.uuid)
      .then((payload) => {
        if (cancelled) return;
        const rows = extractItemsPayload(payload);
        setItems(rows.map((r) => itemRowToTrackRow(r, p)));
        setItemsLoading(false);
      })
      .catch(() => {
        if (cancelled) return;
        setItemsError("Failed to load project items. Please retry.");
        setItems([]); setItemsLoading(false);
      });
    return () => { cancelled = true; };
  }, [p?.uuid]);

  function openInPM() {
    const id = p?.uuid || p?.id;
    if (!id) return;
    navigate(`/projects/${encodeURIComponent(id)}/config`);
  }

  const chartCounts = useMemo(() => items.reduce((acc, r) => {
    acc[r.status] = (acc[r.status] || 0) + 1;
    acc.total = (acc.total || 0) + 1;
    return acc;
  }, { active: 0, ontrack: 0, completed: 0, delayed: 0, total: 0 }), [items]);

  const delays = useMemo(
    () => items.filter((r) => r.status === "delayed")
                .sort((a, b) => (b.delay || 0) - (a.delay || 0)),
    [items],
  );

  return (
    <>
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
        <div className="dash-track-actions">
          <button type="button" className="dash-primary-btn" onClick={openInPM}>Open in PM</button>
        </div>
      </div>

      <div className="dash-kpi-grid" style={{ marginTop: "20px", marginBottom: "20px" }}>
        <Kpi cls="total" label="Overall Progress" value={pk.progress + "%"}
          foot="open all items"
          onClick={() => applyFilter(null)} />
        <Kpi cls="completed" label="Milestones"
          value={`${pk.milestonesDone}/${pk.milestonesTotal}`} foot="open milestones"
          onClick={() => applyFilter({ kind: "milestone" })} />
        <Kpi cls="ontrack" label="Activities"
          value={`${pk.activitiesDone}/${pk.activitiesTotal}`} foot="open activities"
          onClick={() => applyFilter({ kind: "activity" })} />
        <Kpi cls="pending" label="Pending for Approval" value={pendingApprovals}
          foot="activities only"
          onClick={() => applyFilter({ kind: "activity" })} />
        <Kpi cls="delayed" label="Delayed"
          value={pk.delayed}
          foot={pk.maxDelayDays ? `max ${pk.maxDelayDays}d behind` : "open delayed items"}
          onClick={() => applyFilter({ status: "delayed" })} />
      </div>

      <div className="dash-grid-2" style={{ marginTop: "20px", marginBottom: "20px" }}>
        <div className="dash-card">
          <div className="dash-card-title">Project Pie Chart<span className="dash-card-sub">Milestones and activities</span></div>
          {itemsLoading && <div className="dash-empty">Loading items…</div>}
          {!itemsLoading && itemsError && <div className="dash-empty" style={{ color: "#d4440e" }}>{itemsError}</div>}
          {!itemsLoading && !itemsError && (
            <div className="dash-donut-wrap">
              <Donut counts={chartCounts} keys={["completed", "ontrack", "delayed"]} />
              <Legend counts={chartCounts} keys={["completed", "ontrack", "delayed"]} />
            </div>
          )}
        </div>
        <div className="dash-card">
          <div className="dash-card-title">
            Delayed Track
            <span className="dash-card-sub">{delays.length} delayed item{delays.length === 1 ? "" : "s"}</span>
          </div>
          {itemsLoading && <div className="dash-empty">Loading items…</div>}
          {!itemsLoading && itemsError && <div className="dash-empty" style={{ color: "#d4440e" }}>{itemsError}</div>}
          {!itemsLoading && !itemsError && (
            <DelayList rows={delays} limit={delaysExpanded ? undefined : VIS} />
          )}
          {!itemsLoading && !itemsError && delays.length > VIS && (
            <div className="dash-actions">
              <button type="button" className="dash-more-btn"
                onClick={() => setDelaysExpanded((v) => !v)}>
                {delaysExpanded ? "Show less" : `+${delays.length - VIS} More`}
              </button>
            </div>
          )}
        </div>
      </div>

      <div ref={itemsFilterRef} className="dash-card" style={{ marginTop: "20px", marginBottom: "20px" }}>
        <div className="dash-card-title">
          Items
          <span className="dash-card-sub">
            {itemsFilter
              ? `${filteredItems.length} of ${items.length} — filtered by ${filterLabel(itemsFilter)}`
              : "All milestones & activities for this project"}
          </span>
          {itemsFilter && (
            <button type="button" className="dash-ghost-btn"
              style={{ marginLeft: "auto" }} onClick={clearFilter}>
              Clear filter
            </button>
          )}
        </div>
        {itemsLoading && <div className="dash-empty">Loading items…</div>}
        {!itemsLoading && itemsError && <div className="dash-empty" style={{ color: "#d4440e" }}>{itemsError}</div>}
        {!itemsLoading && !itemsError && (
          <ItemsTable rows={filteredItems} onOpenPM={openInPM} />
        )}
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
        <thead>
          <tr>
            <th>WBS</th><th>Name</th><th>Progress</th><th>Status</th>
            <th>Expected Dates</th><th>Actual Dates</th><th>Delay</th><th>Type</th>
            <th>Project Management</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
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
                <button type="button" className="dash-pm-btn" onClick={onOpenPM}>
                  Open in PM
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
