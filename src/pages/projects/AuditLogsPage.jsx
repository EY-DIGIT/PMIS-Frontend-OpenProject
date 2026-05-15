import React, { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { authorizedFetch, API_BASE } from "../../api/client";
import { getToken, logout } from "../../api/auth";
import { ENDPOINTS } from "../../api/endpoint";
import { projectsStore } from "../../store/project/projectsStore";
import "../../styles/project/auditLogs.css";

const ACTION_OPTIONS = [
  "Create",
  "Update",
  "Delete",
  "Approve",
  "Reject",
  // "Publish",
  // "Login"
];

const PAGE_SIZE_OPTIONS = [5, 10, 20, 50, 100];

// Format an ISO timestamp to "DD-MMM-YYYY HH:MM" in IST. Falls back to
// the raw input if parsing fails.
function formatIstTime(iso) {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return String(iso);
  const ist = new Date(d.getTime() + 330 * 60000);
  const day = String(ist.getUTCDate()).padStart(2, "0");
  const month = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][ist.getUTCMonth()];
  const year = ist.getUTCFullYear();
  const hh = String(ist.getUTCHours()).padStart(2, "0");
  const mm = String(ist.getUTCMinutes()).padStart(2, "0");
  return `${day}-${month}-${year} ${hh}:${mm}`;
}

function relativeTime(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const diff = Date.now() - d.getTime();
  if (diff < 0) return "in the future";
  const sec = Math.floor(diff / 1000);
  if (sec < 60) return "just now";
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min} minute${min === 1 ? "" : "s"} ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr} hour${hr === 1 ? "" : "s"} ago`;
  const day = Math.floor(hr / 24);
  if (day < 30) return `${day} day${day === 1 ? "" : "s"} ago`;
  const mo = Math.floor(day / 30);
  if (mo < 12) return `${mo} month${mo === 1 ? "" : "s"} ago`;
  const yr = Math.floor(day / 365);
  return `${yr} year${yr === 1 ? "" : "s"} ago`;
}

// API actions arrive as "entity.subaction" (e.g. "activity.update",
// "milestone.dep_change"). Split + title-case so the action pill in the
// table reads like "Activity · Update" instead of a raw snake_case key.
function prettyAction(raw) {
  if (!raw) return "—";
  const parts = String(raw).split(".");
  const titled = parts.map((p) =>
    p
      .split("_")
      .map((w) => (w ? w.charAt(0).toUpperCase() + w.slice(1) : w))
      .join(" ")
  );
  return titled.join(" · ");
}

// Diff before/after and pick the scalar fields that actually changed.
// The audit-logs endpoint includes the entity id under keys like
// `activity_id` / `milestone_id` on both sides; those are not real
// edits, so skip them.
const ID_KEYS = new Set([
  "activity_id",
  "milestone_id",
  "task_id",
  "subtask_id",
  "project_id"
]);

function isScalar(v) {
  return v == null || ["string", "number", "boolean"].includes(typeof v);
}

function fmtScalar(v) {
  if (v == null || v === "") return "—";
  return String(v);
}

function summarizeSide(before, after, side, displayOverrides) {
  if (!before && !after) return "—";
  if (!before || !after || typeof before !== "object" || typeof after !== "object") {
    const v = side === "old" ? before : after;
    if (v == null || v === "") return "—";
    if (typeof v === "object") {
      // Render arrays as comma-joined values, drop empty objects.
      if (Array.isArray(v)) return v.length ? v.join(", ") : "—";
      const entries = Object.entries(v).filter(([k]) => !ID_KEYS.has(k));
      if (!entries.length) return "—";
      return entries
        .slice(0, 3)
        .map(([k, val]) => `${k}: ${Array.isArray(val) ? val.join(", ") : fmtScalar(val)}`)
        .join(" · ");
    }
    return String(v);
  }
  const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
  const diffs = [];
  keys.forEach((k) => {
    if (ID_KEYS.has(k)) return;
    let a = before[k];
    let b = after[k];
    // Audit logs reference dependencies by UUID in before/after, but the
    // entry carries human-readable codes ("A1.1") under
    // dependsOnDisplay / dependsOnDisplayBefore. Swap them in so the cell
    // shows codes instead of opaque IDs.
    if (k === "depends_on" && displayOverrides) {
      if (displayOverrides.before !== undefined) a = displayOverrides.before;
      if (displayOverrides.after !== undefined) b = displayOverrides.after;
    }
    // Compare arrays element-wise so an unchanged list isn't flagged.
    if (Array.isArray(a) || Array.isArray(b)) {
      const aArr = Array.isArray(a) ? a : [];
      const bArr = Array.isArray(b) ? b : [];
      if (aArr.length === bArr.length && aArr.every((x, i) => x === bArr[i])) return;
      diffs.push({
        key: k,
        old: aArr.length ? aArr.join(", ") : "—",
        new: bArr.length ? bArr.join(", ") : "—"
      });
      return;
    }
    if (!isScalar(a) || !isScalar(b)) return;
    if (a === b) return;
    diffs.push({ key: k, old: a, new: b });
  });
  if (diffs.length === 0) return "—";
  return diffs
    .slice(0, 3)
    .map((d) => `${d.key}: ${fmtScalar(side === "old" ? d.old : d.new)}`)
    .join(" · ");
}

function shortenId(id) {
  if (!id) return "—";
  const s = String(id);
  return s.length > 8 ? s.slice(0, 8) : s;
}

function normalizeEntry(e) {
  const displayOverrides = {
    before: e.dependsOnDisplayBefore,
    after: e.dependsOnDisplay
  };
  return {
    userId: e.actorCode || e.actor_code || "—",
    username: e.actorLogin || e.actor_login || e.actorId || "—",
    role: e.actorRole || e.actor_role || "—",
    actionRaw: e.action || "",
    action: prettyAction(e.action),
    code: e.code || "",
    old: summarizeSide(e.before, e.after, "old", displayOverrides),
    new: summarizeSide(e.before, e.after, "new", displayOverrides),
    time: formatIstTime(e.createdAt || e.created_at),
    sub: relativeTime(e.createdAt || e.created_at),
    rawWhen: e.createdAt || e.created_at || "",
    id: e.id
  };
}

function statusLabel(s) {
  if (!s) return "—";
  const v = String(s).toUpperCase();
  if (v === "PUBLISHED") return "Published";
  if (v === "DRAFT") return "Draft";
  if (v === "NEW") return "New";
  if (v === "CLOSED") return "Closed";
  return v.charAt(0) + v.slice(1).toLowerCase();
}

export default function AuditLogsPage() {
  const { projectId } = useParams();
  const navigate = useNavigate();

  const [entries, setEntries] = useState([]);
  const [total, setTotal] = useState(0);
  const [projectInfo, setProjectInfo] = useState(null);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState("");

  const [searchTerm, setSearchTerm] = useState("");
  const [searchFrom, setSearchFrom] = useState("");
  const [searchTo, setSearchTo] = useState("");
  const [searchAction, setSearchAction] = useState("");
  const [appliedFilters, setAppliedFilters] = useState({
    term: "", from: "", to: "", action: ""
  });
  const [pageSize, setPageSize] = useState(10);
  const [currentPage, setCurrentPage] = useState(1);

  // Fetch the page from the audit-logs endpoint whenever the user
  // changes the page or page size. The response carries the project
  // context block too, so this single call powers the banner as well.
  // The "All" page size (0) is sent as a large pageSize the backend
  // will cap. When any filter is active we also fetch the full corpus
  // so search/date/action filtering matches across every entry — not
  // only the rows that happened to land on the current server page.
  const hasActiveFilter =
    !!(appliedFilters.term || appliedFilters.from || appliedFilters.to || appliedFilters.action);
  useEffect(() => {
    if (!projectId) return;
    const token = getToken();
    if (!token) {
      navigate("/login");
      return;
    }
    let cancelled = false;
    setLoading(true);
    setLoadError("");
    (async () => {
      try {
        const apiPageSize = hasActiveFilter || pageSize === 0 ? 200 : pageSize;
        const apiOffset = hasActiveFilter ? 1 : currentPage;
        const url = `${API_BASE}${ENDPOINTS.projects.auditLogs(projectId)}?offset=${apiOffset}&pageSize=${apiPageSize}`;
        const res = await authorizedFetch(url, {
          method: "GET",
          headers: { accept: "application/json" }
        });
        if (res.status === 401) {
          logout();
          navigate("/login");
          return;
        }
        if (!res.ok) {
          const body = await res.text().catch(() => "");
          throw new Error(body || `Request failed (${res.status})`);
        }
        const raw = await res.json().catch(() => ({}));
        const d = raw?.data ?? raw ?? {};
        const elements = d?._embedded?.elements ?? [];
        if (!cancelled) {
          setEntries(Array.isArray(elements) ? elements : []);
          setTotal(typeof d.total === "number" ? d.total : (Array.isArray(elements) ? elements.length : 0));
          setProjectInfo(d.project || null);
          // Seed the projects store with the response's project block so
          // the App-level breadcrumb resolves the project segment to its
          // code (UIDAI-PR...) instead of the raw UUID on hard refresh.
          if (d.project && d.project.projectId && !projectsStore.find(d.project.projectId)) {
            projectsStore.addProject({
              projectId: d.project.projectId,
              projectCode: d.project.projectCode || "",
              projectName: d.project.projectName || "",
              status: d.project.projectStatus
                ? String(d.project.projectStatus).toUpperCase()
                : "",
              owner: d.project.owner || "",
              milestones: [],
              auditLogs: [],
              resources: [],
              vendors: []
            });
          }
        }
      } catch (err) {
        if (!cancelled) {
          setEntries([]);
          setTotal(0);
          setLoadError(err?.message || "Failed to load audit logs");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [projectId, currentPage, pageSize, navigate, hasActiveFilter]);

  const allRows = useMemo(() => entries.map(normalizeEntry), [entries]);

  // Client-side filtering operates on the currently loaded page only.
  // For full-corpus search/date/action filtering the backend would need
  // matching query params; until then, keep the UI working as-is.
  const filteredRows = useMemo(() => {
    const q = appliedFilters.term.trim().toLowerCase();
    const action = appliedFilters.action.trim().toLowerCase();
    const fromTs = appliedFilters.from
      ? new Date(`${appliedFilters.from}T00:00:00`).getTime()
      : null;
    const toTs = appliedFilters.to
      ? new Date(`${appliedFilters.to}T23:59:59`).getTime()
      : null;
    return allRows.filter((r) => {
      if (action) {
        // The dropdown lists single-word actions ("Update", "Delete", …)
        // but the API returns "entity.subaction" pairs. Match against
        // the trailing word so "Update" matches both "activity.update"
        // and "milestone.update".
        const tail = (r.actionRaw || "").split(".").pop().toLowerCase();
        if (tail !== action && r.action.toLowerCase() !== action) return false;
      }
      if (fromTs || toTs) {
        const t = r.rawWhen ? new Date(r.rawWhen).getTime() : NaN;
        if (Number.isNaN(t)) return false;
        if (fromTs && t < fromTs) return false;
        if (toTs && t > toTs) return false;
      }
      if (!q) return true;
      return [r.userId, r.username, r.role, r.action, r.old, r.new]
        .some((v) => String(v ?? "").toLowerCase().includes(q));
    });
  }, [allRows, appliedFilters]);

  // Pagination math — when the user has any filter applied we hide the
  // server total and fall back to the filtered count so the range info
  // doesn't mislead.
  const hasFilter = hasActiveFilter;
  const effectivePageSize = pageSize > 0 ? pageSize : Math.max(total, 1);
  const totalPages = Math.max(1, Math.ceil((hasFilter ? filteredRows.length : total) / effectivePageSize));
  const safePage = Math.min(Math.max(1, currentPage), totalPages);

  // Server gave us the right slice for `currentPage` when no filter is
  // active. When filters ARE active we re-fetched the full corpus, so
  // show every matching row.
  const pageRows = hasFilter ? filteredRows : allRows;

  const rangeStart = total === 0 ? 0 : ((safePage - 1) * (pageSize > 0 ? pageSize : total)) + 1;
  const rangeEnd = pageSize > 0
    ? Math.min(safePage * pageSize, total)
    : total;

  function runSearch() {
    setAppliedFilters({
      term: searchTerm,
      from: searchFrom,
      to: searchTo,
      action: searchAction
    });
    setCurrentPage(1);
  }

  function resetFilters() {
    setSearchTerm("");
    setSearchFrom("");
    setSearchTo("");
    setSearchAction("");
    setAppliedFilters({ term: "", from: "", to: "", action: "" });
    setCurrentPage(1);
  }

  // Build a styled HTML table that mirrors the on-screen layout — used
  // for both Excel (saved as .xls so Excel opens it) and PDF (rendered
  // in a new window so the browser's print dialog can save it as PDF).
  function buildExportHtml() {
    const escape = (s) =>
      String(s ?? "").replace(/[&<>"']/g, (c) => ({
        "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
      }[c]));

    const projectName = projectInfo && projectInfo.projectName ? projectInfo.projectName : "";
    const projectCode =
      projectInfo && (projectInfo.projectCode || projectInfo.projectId)
        ? (projectInfo.projectCode || projectInfo.projectId)
        : "";
    const status = statusLabel(projectInfo && projectInfo.projectStatus);
    const owner = (projectInfo && projectInfo.owner) || "—";
    const generatedAt = new Date().toLocaleString("en-IN", {
      day: "2-digit", month: "short", year: "numeric",
      hour: "2-digit", minute: "2-digit"
    });

    const rowsHtml = pageRows.map((r) => `
      <tr>
        <td><span class="userid">${escape(r.userId)}</span></td>
        <td class="user">${escape(r.username)}</td>
        <td><span class="pill">${escape(r.role)}</span></td>
        <td><span class="pill">${escape(r.action)}</span></td>
        <td>${r.old === "—" ? '<span class="muted">—</span>' : `<span class="old">${escape(r.old)}</span>`}</td>
        <td>${r.new === "—" ? '<span class="muted">—</span>' : `<span class="new">${escape(r.new)}</span>`}</td>
        <td class="time">${escape(r.time)}${r.sub ? `<div class="sub">${escape(r.sub)}</div>` : ""}</td>
      </tr>
    `).join("");

    return `<!DOCTYPE html>
<html lang="en"><head><meta charset="UTF-8"><title>Audit Logs — ${escape(projectCode || projectName || "Project")}</title>
<style>
  body { font-family: 'Roboto', Arial, sans-serif; color: #1e2a3a; padding: 24px; margin: 0; background: #fff; }
  h1 { color: #0b3c88; font-size: 22px; margin: 0 0 4px; }
  .subtitle { color: #1a8a3d; font-size: 13px; font-weight: 700; margin-bottom: 10px; }
  .ctx { border: 1px solid #e9eef6; border-radius: 8px; padding: 12px 16px; margin: 12px 0 16px; background: #fff; }
  .ctx-row { display: flex; flex-wrap: wrap; gap: 22px; align-items: center; }
  .ctx-item { display: flex; flex-direction: column; gap: 2px; }
  .ctx-label { font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: .6px; color: #7a869a; }
  .ctx-value { font-size: 13px; font-weight: 700; color: #0b3c88; }
  .ctx-id { font-size: 14px; font-weight: 800; color: #062a63; font-family: 'Courier New', monospace; }
  .ctx-name { font-size: 15px; font-weight: 800; color: #062a63; }
  .pill { display: inline-block; padding: 2px 9px; border-radius: 999px; font-size: 11px; font-weight: 700; background: #e3eefc; color: #0b3c88; border: 1px solid #c8d9ee; }
  .status { background: #e7f7ec; color: #1a8a3d; border: 1px solid #b6e7c7; }
  .meta { font-size: 11px; color: #5a6680; margin-bottom: 10px; }
  table { width: 100%; border-collapse: collapse; font-size: 12px; }
  th { background: #f1f6fd; color: #062a63; padding: 8px 10px; border: 1px solid #dbe5f1; text-align: left; text-transform: uppercase; font-size: 11px; letter-spacing: .2px; }
  td { padding: 8px 10px; border: 1px solid #dbe5f1; vertical-align: top; }
  td.user { font-weight: 600; color: #0b3c88; }
  td.time { white-space: nowrap; color: #3d4c6b; font-variant-numeric: tabular-nums; }
  td.time .sub { font-size: 10px; color: #7a869a; margin-top: 2px; }
  .userid { display: inline-block; font-family: 'Courier New', monospace; font-size: 11px; font-weight: 700; color: #062a63; background: #f1f5f9; padding: 2px 8px; border-radius: 3px; }
  .old { display: inline-block; color: #7a3d3d; background: #fdecec; padding: 2px 8px; border-radius: 4px; border-left: 3px solid #f4b8b8; font-size: 11px; }
  .new { display: inline-block; color: #1b6a3a; background: #e7f8ee; padding: 2px 8px; border-radius: 4px; border-left: 3px solid #b6e7c7; font-size: 11px; }
  .muted { color: #7a869a; font-style: italic; }
  @media print {
    body { padding: 12px; }
    .ctx { background: #fff; }
    thead { display: table-header-group; }
    tr { page-break-inside: avoid; }
  }
</style>
</head><body>
  <h1>Audit Logs</h1>
  <div class="subtitle">Every change, fully traceable.</div>
  <div class="ctx"><div class="ctx-row">
    <div class="ctx-item"><span class="ctx-label">Project ID</span><span class="ctx-id">${escape(projectCode || "—")}</span></div>
    <div class="ctx-item"><span class="ctx-label">Project Name</span><span class="ctx-name">${escape(projectName || "—")}</span></div>
    <div class="ctx-item"><span class="ctx-label">Status</span><span class="pill status">${escape(status)}</span></div>
    <div class="ctx-item"><span class="ctx-label">Owner</span><span class="ctx-value">${escape(owner)}</span></div>
  </div></div>
  <div class="meta">Generated ${escape(generatedAt)} · ${pageRows.length} ${pageRows.length === 1 ? "entry" : "entries"}${hasFilter ? " (filtered)" : ""}</div>
  <table>
    <thead><tr>
      <th>User ID</th><th>Username</th><th>Role</th><th>Action</th>
      <th>Old Value</th><th>New Value</th><th>Time (IST)</th>
    </tr></thead>
    <tbody>${rowsHtml || `<tr><td colspan="7" style="text-align:center;padding:24px;color:#7a869a;">No audit log entries.</td></tr>`}</tbody>
  </table>
</body></html>`;
  }

  function exportLogs(kind) {
    const html = buildExportHtml();
    const baseName = (projectInfo && (projectInfo.projectCode || projectInfo.projectId)) || "project";
    const stamp = new Date().toISOString().replace(/[:T]/g, "-").slice(0, 16);

    if (kind === "excel") {
      // .xls + an HTML table body is a long-standing trick — Excel opens
      // the file and reads the styling. No external library required.
      const blob = new Blob(["﻿", html], {
        type: "application/vnd.ms-excel"
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `audit-logs-${baseName}-${stamp}.xls`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      return;
    }

    // PDF: open the HTML in a new tab and trigger the print dialog. The
    // user picks "Save as PDF" (the default destination in Chrome/Edge).
    const win = window.open("", "_blank");
    if (!win) {
      alert("Please allow popups to export as PDF.");
      return;
    }
    win.document.open();
    win.document.write(html);
    win.document.close();
    const triggerPrint = () => {
      try {
        win.focus();
        win.print();
      } catch {
        /* user cancelled or popup blocked */
      }
    };
    if (win.document.readyState === "complete") {
      setTimeout(triggerPrint, 150);
    } else {
      win.addEventListener("load", () => setTimeout(triggerPrint, 150));
    }
  }

  function handleSearchKeyDown(e) {
    if (e.key === "Enter") {
      e.preventDefault();
      runSearch();
    }
  }

  function goToPage(n) {
    const next = Math.max(1, Math.min(totalPages, parseInt(n, 10) || 1));
    setCurrentPage(next);
  }

  // Compact pagination buttons — same window-of-5 model as the project
  // list paginator.
  const numberedPages = useMemo(() => {
    const max = 5;
    let s = Math.max(1, safePage - Math.floor(max / 2));
    let e = Math.min(totalPages, s + max - 1);
    if (e - s + 1 < max) s = Math.max(1, e - max + 1);
    const arr = [];
    for (let i = s; i <= e; i++) arr.push(i);
    return { start: s, end: e, arr };
  }, [safePage, totalPages]);

  return (
    <div className="audit-logs-page">
      <div className="al-page-header">
        <div className="al-page-header-text">
          {/* <div className="al-title">Audit Logs</div> */}
          <div className="al-subtitle">Every change, fully traceable.</div>
          <div className="al-description">
            A chronological record of every action performed inside this project — who did what, when, and what changed.
          </div>
        </div>
        <div className="al-page-header-actions">
          <button
            type="button"
            className="al-btn al-cancel"
            onClick={() =>
              navigate(`/projects/${encodeURIComponent(projectId)}`)
            }
          >
            Back to Project
          </button>
        </div>
      </div>

      <div className="al-card" aria-label="Project context">
        <div className="al-project-context">
          <div className="al-context-id-block">
            <span className="al-context-label">Project ID</span>
            <span className="al-context-id-value">
              {(projectInfo && (projectInfo.projectCode || projectInfo.projectId)) || "—"}
            </span>
          </div>
          <div className="al-context-name-block">
            <span className="al-context-label">Project Name</span>
            <span className="al-context-name-value">
              {(projectInfo && projectInfo.projectName) || (loading ? "Loading…" : "—")}
            </span>
          </div>
          <div className="al-context-meta-block">
            <div className="al-context-meta-item">
              <span className="al-context-label">Status</span>
              <span className="al-status-pill">
                {statusLabel(projectInfo && projectInfo.projectStatus)}
              </span>
            </div>
            <div className="al-context-meta-item">
              <span className="al-context-label">Owner</span>
              <span className="al-context-value">
                {(projectInfo && projectInfo.owner) || "—"}
              </span>
            </div>
          </div>
        </div>
      </div>

      <div className="al-card">
        <h2 className="al-card-title">Search Audit Logs</h2>
        <div className="al-grid">
          <div className="al-field">
            <label htmlFor="al-searchTerm">Search</label>
            <input
              id="al-searchTerm"
              placeholder="username, action or value..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              onKeyDown={handleSearchKeyDown}
            />
            <div className="al-field-hint">
              Filters the rows currently on screen. Search across  username, role, action, old/new value.
            </div>
          </div>
          <div className="al-field">
            <label htmlFor="al-searchFrom">From date</label>
            <input
              id="al-searchFrom"
              type="date"
              value={searchFrom}
              onChange={(e) => setSearchFrom(e.target.value)}
              onKeyDown={handleSearchKeyDown}
            />
          </div>
          <div className="al-field">
            <label htmlFor="al-searchTo">To date</label>
            <input
              id="al-searchTo"
              type="date"
              value={searchTo}
              onChange={(e) => setSearchTo(e.target.value)}
              onKeyDown={handleSearchKeyDown}
            />
          </div>
          <div className="al-field">
            <label htmlFor="al-searchAction">Action type</label>
            <select
              id="al-searchAction"
              value={searchAction}
              onChange={(e) => {
                setSearchAction(e.target.value);
                setAppliedFilters((f) => ({ ...f, action: e.target.value }));
                setCurrentPage(1);
              }}
            >
              <option value="">All actions</option>
              {ACTION_OPTIONS.map((a) => (
                <option key={a} value={a}>{a}</option>
              ))}
            </select>
          </div>
        </div>

        <div className="al-btn-row">
          <button type="button" className="al-btn" onClick={runSearch}>Search</button>
          <button type="button" className="al-btn al-cancel" onClick={resetFilters}>Reset</button>
          <span className="al-spacer" />
          <button type="button" className="al-btn al-outline" onClick={() => exportLogs("excel")}>Export Excel</button>
          <button type="button" className="al-btn al-outline" onClick={() => exportLogs("pdf")}>Export PDF</button>
        </div>
      </div>

      <div className="al-card">
        <h2 className="al-card-title">
          Log Entries{" "}
          <span className="al-card-title-meta">
            {hasFilter
              ? `(${filteredRows.length} ${filteredRows.length === 1 ? "match" : "matches"} across all entries)`
              : `(Showing ${rangeStart}–${rangeEnd} of ${total} ${total === 1 ? "entry" : "entries"})`}
          </span>
        </h2>
        {loadError && (
          <div className="al-empty-state" style={{ color: "#d32f2f" }}>
            {loadError}
          </div>
        )}
        <div className="al-table-wrap">
          <table className="al-table">
            <thead>
              <tr>
                {/* <th>User ID</th> */}
                <th>Username</th>
                <th>Role</th>
                <th>Action</th>
                <th>Old Value</th>
                <th>New Value</th>
                <th>Time (IST)</th>
              </tr>
            </thead>
            <tbody>
              {pageRows.length === 0 ? (
                <tr>
                  <td colSpan={7}>
                    <div className="al-empty-state">
                      {loading
                        ? "Loading audit log entries…"
                        : (loadError
                          ? "Could not load audit logs."
                          : "No audit log entries match your filters.")}
                    </div>
                  </td>
                </tr>
              ) : (
                pageRows.map((row) => (
                  <tr key={row.id || `${row.rawWhen}-${row.username}`}>
                    {/* <td><span className="al-cell-userid">{row.userId}</span></td> */}
                    <td><div className="al-cell-user">{row.username}</div></td>
                    <td><span className="al-info-pill">{row.role}</span></td>
                    <td><span className="al-info-pill">{row.action}</span></td>
                    <td className="al-value-cell" title={row.code || undefined}>
                      {row.old === "—"
                        ? <span className="al-value-empty">—</span>
                        : <span className="al-value-old" title={row.code || undefined}>{row.old}</span>}
                    </td>
                    <td className="al-value-cell" title={row.code || undefined}>
                      {row.new === "—"
                        ? <span className="al-value-empty">—</span>
                        : <span className="al-value-new" title={row.code || undefined}>{row.new}</span>}
                    </td>
                    <td className="al-time-cell">
                      {row.time}
                      {row.sub && <span className="al-time-sub">{row.sub}</span>}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        <div className="al-pagination">
          <div className="al-page-info">
            {hasFilter
              ? `Filter active · ${filteredRows.length} match${filteredRows.length === 1 ? "" : "es"} across all entries`
              : `Showing ${rangeStart}–${rangeEnd} of ${total} ${total === 1 ? "entry" : "entries"}`}
          </div>
          <div className="al-page-controls">
            <button
              type="button"
              className="al-page-btn"
              onClick={() => goToPage(safePage - 1)}
              disabled={safePage <= 1}
            >
              ‹ Prev
            </button>
            {numberedPages.start > 1 && (
              <>
                <button type="button" className="al-page-btn" onClick={() => goToPage(1)}>1</button>
                {numberedPages.start > 2 && <span className="al-page-info">…</span>}
              </>
            )}
            {numberedPages.arr.map((i) => (
              <button
                key={i}
                type="button"
                className={`al-page-btn ${i === safePage ? "al-active" : ""}`}
                onClick={() => goToPage(i)}
              >
                {i}
              </button>
            ))}
            {numberedPages.end < totalPages && (
              <>
                {numberedPages.end < totalPages - 1 && <span className="al-page-info">…</span>}
                <button type="button" className="al-page-btn" onClick={() => goToPage(totalPages)}>
                  {totalPages}
                </button>
              </>
            )}
            <button
              type="button"
              className="al-page-btn"
              onClick={() => goToPage(safePage + 1)}
              disabled={safePage >= totalPages}
            >
              Next ›
            </button>
          </div>
          <div className="al-page-size">
            <label htmlFor="al-pageSizeSel" style={{ fontWeight: 600 }}>Page size:</label>
            <select
              id="al-pageSizeSel"
              value={pageSize}
              onChange={(e) => {
                const v = parseInt(e.target.value, 10);
                setPageSize(Number.isNaN(v) ? 0 : v);
                setCurrentPage(1);
              }}
            >
              {PAGE_SIZE_OPTIONS.map((n) => (
                <option key={n} value={n}>{n}</option>
              ))}
            </select>
          </div>
        </div>
      </div>
    </div>
  );
}

