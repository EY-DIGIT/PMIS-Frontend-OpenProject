/* ══════════════════════════════════════════════════════════════════
   TicketManagementPage.jsx — Ticket & SLA Management (SRS §2.14).

   Reads live tickets from the ticket-service
   (GET /ticket-service/tickets?page=&size=, via src/api/tickets.js) and
   renders them with client-side search, filtering and KPIs. The catalog
   look-ups (categories / statuses) stay as static enums from
   ticketsMock — they match the codes the service returns.

   Bulk status update is applied to the loaded list locally (not yet
   persisted) until the update-status endpoint is wired.
   ══════════════════════════════════════════════════════════════════ */

import React, { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { CATEGORIES, STATUSES } from "../../data/ticketsMock";
import { listTickets } from "../../api/tickets";
import "../../styles/tickets.css";

const PAGE_SIZE = 50;

/* Priority enum the ticket-service uses. */
const PRIORITIES = [
  { code: "CRITICAL", label: "Critical" },
  { code: "HIGH", label: "High" },
  { code: "MEDIUM", label: "Medium" },
  { code: "LOW", label: "Low" },
];

const catLabel = (code) => CATEGORIES.find((c) => c.code === code)?.label || code;
const statusLabel = (code) => STATUSES.find((s) => s.code === code)?.label || code;
const prioLabel = (code) => PRIORITIES.find((p) => p.code === code)?.label || code;
const slaLabel = (code) => (code ? code.replace(/_/g, " ") : "—");

const initials = (name) =>
  (name || "?").split(" ").map((w) => w[0]).slice(0, 2).join("").toUpperCase();

/* Map a raw ticket-service record into the flat shape this table uses. */
function normalize(t) {
  return {
    uuid: t.uuid,
    id: t.ticketNumber || t.uuid,
    title: t.title || "",
    description: t.description || "",
    category: t.category || "",
    subCategory: t.subCategory || "",
    priority: t.priority || "",
    status: t.status || "",
    projectId: t.projectId || "",
    projectName: t.projectName || "",
    activityName: t.activityName || "",
    taskName: t.taskName || "",
    assigneeName: t.assignee?.name || "",
    assigneeEmail: t.assignee?.email || "",
    slaStatus: t.slaStatus || "",
    slaBreached: !!t.slaBreached,
    childCount: Array.isArray(t.childTickets) ? t.childTickets.length : 0,
  };
}

const Badge = ({ cls, children }) => <span className={`tkt-badge ${cls}`}>{children}</span>;

export default function TicketManagementPage() {
  const navigate = useNavigate();

  const [tickets, setTickets] = useState([]);
  const [page, setPage] = useState(0);
  const [totalCount, setTotalCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  // Filters
  const [q, setQ] = useState("");
  const [fCategory, setFCategory] = useState("ALL");
  const [fPriority, setFPriority] = useState("ALL");
  const [fStatus, setFStatus] = useState("ALL");
  const [fProject, setFProject] = useState("ALL");

  // Bulk selection (PMIS-FR-35.5) — local only for now.
  const [selected, setSelected] = useState(() => new Set());
  const [bulkStatus, setBulkStatus] = useState("");

  const load = (pageNum) => {
    setLoading(true);
    setError("");
    return listTickets({ page: pageNum, size: PAGE_SIZE })
      .then((res) => {
        const rows = (res?.tickets || []).map(normalize);
        setTotalCount(Number(res?.totalCount ?? rows.length) || 0);
        setPage(Number(res?.page ?? pageNum) || 0);
        setTickets((prev) => (pageNum === 0 ? rows : [...prev, ...rows]));
      })
      .catch((e) => setError(e.message || "Failed to load tickets."))
      .finally(() => setLoading(false));
  };

  // Initial fetch — state is only set after the await, so no synchronous
  // setState happens inside the effect body.
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const res = await listTickets({ page: 0, size: PAGE_SIZE });
        if (!alive) return;
        const rows = (res?.tickets || []).map(normalize);
        setTotalCount(Number(res?.totalCount ?? rows.length) || 0);
        setPage(Number(res?.page ?? 0) || 0);
        setTickets(rows);
      } catch (e) {
        if (alive) setError(e.message || "Failed to load tickets.");
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => { alive = false; };
  }, []);

  // Project filter options derived from the loaded tickets.
  const projectOptions = useMemo(() => {
    const map = new Map();
    tickets.forEach((t) => { if (t.projectId) map.set(t.projectId, t.projectName || t.projectId); });
    return Array.from(map, ([id, name]) => ({ id, name }));
  }, [tickets]);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return tickets.filter((t) => {
      if (fCategory !== "ALL" && t.category !== fCategory) return false;
      if (fPriority !== "ALL" && t.priority !== fPriority) return false;
      if (fStatus !== "ALL" && t.status !== fStatus) return false;
      if (fProject !== "ALL" && t.projectId !== fProject) return false;
      if (needle) {
        const hay = `${t.id} ${t.title} ${t.description} ${t.assigneeName}`.toLowerCase();
        if (!hay.includes(needle)) return false;
      }
      return true;
    });
  }, [tickets, q, fCategory, fPriority, fStatus, fProject]);

  const kpis = useMemo(() => {
    let open = 0, inProgress = 0, resolved = 0, breached = 0;
    tickets.forEach((t) => {
      if (t.status === "OPEN") open += 1;
      if (t.status === "IN_PROGRESS") inProgress += 1;
      if (t.status === "RESOLVED" || t.status === "CLOSED") resolved += 1;
      if (t.slaBreached) breached += 1;
    });
    return { open, inProgress, resolved, breached };
  }, [tickets]);

  // ── selection helpers ──
  const allVisibleSelected = filtered.length > 0 && filtered.every((t) => selected.has(t.uuid));
  const toggleAll = () => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (allVisibleSelected) filtered.forEach((t) => next.delete(t.uuid));
      else filtered.forEach((t) => next.add(t.uuid));
      return next;
    });
  };
  const toggleOne = (uuid) => {
    setSelected((prev) => {
      const next = new Set(prev);
      next.has(uuid) ? next.delete(uuid) : next.add(uuid);
      return next;
    });
  };
  const clearSelection = () => setSelected(new Set());

  const applyBulkStatus = () => {
    if (!bulkStatus) return;
    setTickets((list) => list.map((t) => (selected.has(t.uuid) ? { ...t, status: bulkStatus } : t)));
    setBulkStatus("");
    clearSelection();
  };

  const hasMore = tickets.length < totalCount;

  return (
    <div className="uidai-pmis-content tkt-page">
      {/* Action bar — heading now lives in the global navbar. */}
      <div className="tkt-header tkt-header-actions">
        <button type="button" className="tkt-btn" onClick={() => navigate("/tickets/new")}>
          + Create Ticket
        </button>
      </div>

      {error && <div className="tkt-err-msg" style={{ marginBottom: 12 }}>{error}</div>}

      {/* KPI summary */}
      <div className="tkt-kpis">
        <div className="tkt-kpi">
          <div className="tkt-kpi-val">{kpis.open}</div>
          <div className="tkt-kpi-lbl">Open</div>
        </div>
        <div className="tkt-kpi">
          <div className="tkt-kpi-val">{kpis.inProgress}</div>
          <div className="tkt-kpi-lbl">In Progress</div>
        </div>
        <div className="tkt-kpi">
          <div className="tkt-kpi-val">{kpis.resolved}</div>
          <div className="tkt-kpi-lbl">Resolved / Closed</div>
        </div>
        <div className="tkt-kpi">
          <div className="tkt-kpi-val">{kpis.breached}</div>
          <div className="tkt-kpi-lbl">SLA Breached</div>
        </div>
      </div>

      {/* Filters */}
      <div className="tkt-toolbar">
        <div className="tkt-field grow">
          <label htmlFor="tkt-q">Search</label>
          <input
            id="tkt-q"
            type="search"
            placeholder="Search ID, title, description or assignee…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
        </div>
        <div className="tkt-field">
          <label htmlFor="tkt-cat">Category</label>
          <select id="tkt-cat" value={fCategory} onChange={(e) => setFCategory(e.target.value)}>
            <option value="ALL">All categories</option>
            {CATEGORIES.map((c) => <option key={c.code} value={c.code}>{c.label}</option>)}
          </select>
        </div>
        <div className="tkt-field">
          <label htmlFor="tkt-prio">Priority</label>
          <select id="tkt-prio" value={fPriority} onChange={(e) => setFPriority(e.target.value)}>
            <option value="ALL">All priorities</option>
            {PRIORITIES.map((p) => <option key={p.code} value={p.code}>{p.label}</option>)}
          </select>
        </div>
        <div className="tkt-field">
          <label htmlFor="tkt-status">Status</label>
          <select id="tkt-status" value={fStatus} onChange={(e) => setFStatus(e.target.value)}>
            <option value="ALL">All statuses</option>
            {STATUSES.map((s) => <option key={s.code} value={s.code}>{s.label}</option>)}
          </select>
        </div>
        <div className="tkt-field">
          <label htmlFor="tkt-proj">Project</label>
          <select id="tkt-proj" value={fProject} onChange={(e) => setFProject(e.target.value)}>
            <option value="ALL">All projects</option>
            {projectOptions.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </div>
      </div>

      {/* Bulk action bar — PMIS-FR-35.5 (local only) */}
      {selected.size > 0 && (
        <div className="tkt-bulkbar">
          <span className="tkt-bulk-count">{selected.size} selected</span>

          <select value={bulkStatus} onChange={(e) => setBulkStatus(e.target.value)}>
            <option value="">Set status…</option>
            {STATUSES.map((s) => <option key={s.code} value={s.code}>{s.label}</option>)}
          </select>
          <button type="button" className="tkt-btn small" disabled={!bulkStatus} onClick={applyBulkStatus}>
            Apply
          </button>

          <span className="tkt-bulk-spacer" />
          <button type="button" className="tkt-btn ghost small" onClick={clearSelection}>
            Clear
          </button>
        </div>
      )}

      {/* Ticket table */}
      <div className="tkt-table-wrap">
        <table className="tkt-table">
          <thead>
            <tr>
              <th style={{ width: 36 }}>
                <input
                  type="checkbox"
                  className="tkt-checkbox"
                  aria-label="Select all"
                  checked={allVisibleSelected}
                  onChange={toggleAll}
                />
              </th>
              <th style={{ width: 130 }}>Ticket</th>
              <th>Summary</th>
              <th style={{ width: 130 }}>Category</th>
              <th style={{ width: 90 }}>Priority</th>
              <th style={{ width: 170 }}>Assignee</th>
              <th style={{ width: 110 }}>SLA</th>
              <th style={{ width: 120 }}>Status</th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr>
                <td colSpan={8}>
                  <div className="tkt-empty">
                    {loading ? "Loading tickets…" : "No tickets match your filters."}
                  </div>
                </td>
              </tr>
            ) : (
              filtered.map((t) => (
                <tr key={t.uuid}>
                  <td>
                    <input
                      type="checkbox"
                      className="tkt-checkbox"
                      aria-label={`Select ${t.id}`}
                      checked={selected.has(t.uuid)}
                      onChange={() => toggleOne(t.uuid)}
                    />
                  </td>
                  <td><span className="tkt-id">{t.id}</span></td>
                  <td>
                    <div className="tkt-title">{t.title}</div>
                    <div className="tkt-sub">
                      {t.projectName || "—"}
                      {t.activityName && <> · Activity: {t.activityName}</>}
                      {t.taskName && <> · Task: {t.taskName}</>}
                    </div>
                    {t.childCount > 0 && <span className="tkt-parent">⛓ {t.childCount} child ticket(s)</span>}
                  </td>
                  <td><Badge cls={`cat-${t.category}`}>{catLabel(t.category)}</Badge></td>
                  <td><Badge cls={`prio-${t.priority}`}>{prioLabel(t.priority)}</Badge></td>
                  <td>
                    {t.assigneeName ? (
                      <div className="tkt-assignee">
                        <span className="tkt-avatar">{initials(t.assigneeName)}</span>
                        <span>{t.assigneeName}</span>
                      </div>
                    ) : <span className="tkt-sub">Unassigned</span>}
                  </td>
                  <td>
                    {t.slaStatus
                      ? <Badge cls={`sla-${t.slaStatus}`}>{slaLabel(t.slaStatus)}</Badge>
                      : <span className="tkt-sub">—</span>}
                  </td>
                  <td><Badge cls={`st-${t.status}`}>{statusLabel(t.status)}</Badge></td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Footer: count + load-more pager */}
      <div className="tkt-header tkt-header-actions" style={{ marginTop: 12 }}>
        <span className="tkt-sub">
          Showing {filtered.length} of {totalCount} ticket(s)
        </span>
        <span className="tkt-bulk-spacer" />
        {hasMore && (
          <button type="button" className="tkt-btn ghost small" disabled={loading} onClick={() => load(page + 1)}>
            {loading ? "Loading…" : "Load more"}
          </button>
        )}
      </div>
    </div>
  );
}
