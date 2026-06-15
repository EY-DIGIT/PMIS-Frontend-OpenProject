/* ══════════════════════════════════════════════════════════════════
   SlaMastersPage.jsx — SLA Masters library (route /sla-masters).

   Lists onboarded SLAs. Clicking one opens a full-width DETAIL SECTION
   (in-page, not a modal) showing every field of the new SLA shape.
   Onboarding / editing live on /sla-masters/onboard.

   Backed by the contracts API:
     GET    /api/v3/sla-masters?offset=1&pageSize=200   list
     GET    /api/v3/sla-masters/{id}                    detail
     DELETE /api/v3/sla-masters/{id}                    delete
   ══════════════════════════════════════════════════════════════════ */

import React, { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { authorizedFetch } from "../../api/client";
import "../../styles/global.css";

const DEFAULT_BASE = "http://10.1.131.199/contracts";

const CONTRACT_TYPES = ["BSP", "MSAP", "MSIP", "PMU"];
const STATUS_OPTIONS = ["ACTIVE", "DRAFT", "RETIRED"];

const NAVY = "#173e77";

// Pull the collection array regardless of which envelope shape the API uses.
function extractElements(payload) {
    const el =
        payload?.data?._embedded?.elements ||
        payload?.data?.elements ||
        payload?.data ||
        [];
    return Array.isArray(el) ? el : [];
}
// Some list rows arrive wrapped as { data: {...} }.
function unwrap(el) {
    return el && typeof el === "object" && el.data && typeof el.data === "object" ? el.data : el;
}

// snake_case / kebab-case enum → "Title Case" for display.
function humanize(value) {
    if (value === null || value === undefined || value === "") return "—";
    return String(value).replace(/[_-]+/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

const muted = { color: "var(--uidai-pmis-muted)" };

function StatusBadge({ status }) {
    const s = String(status || "ACTIVE").toUpperCase();
    const cls = s === "ACTIVE" ? "uidai-pmis-badge-green" : s === "RETIRED" ? "uidai-pmis-badge-red" : "uidai-pmis-badge-orange";
    return <span className={`uidai-pmis-badge ${cls}`}>{s}</span>;
}

/* ─── Modal shell — used only for the delete confirm ─── */
function Modal({ open, onClose, title, width = 520, children, footer }) {
    if (!open) return null;
    return (
        <div
            onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}
            style={{ position: "fixed", inset: 0, background: "rgba(7,26,52,.55)", display: "flex", alignItems: "flex-start", justifyContent: "center", padding: 20, zIndex: 1900, overflowY: "auto" }}
        >
            <div style={{ background: "#fff", width: `min(${width}px, 100%)`, maxHeight: "92vh", overflow: "auto", borderRadius: 12, padding: 0, boxShadow: "0 20px 60px rgba(0,0,0,.18)", position: "relative", marginTop: 24 }}>
                <div style={{ height: 4, background: "linear-gradient(90deg,#0b3c88,#19b6c9)", borderRadius: "12px 12px 0 0" }} />
                <div style={{ padding: 24 }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 16, gap: 12 }}>
                        <div style={{ fontSize: 18, fontWeight: 800, color: "var(--uidai-pmis-navy)" }}>{title}</div>
                        <button type="button" onClick={onClose} title="Close"
                            style={{ width: 30, height: 30, borderRadius: "50%", background: "#fdecec", border: "none", color: "#b42318", cursor: "pointer", fontSize: 15, fontWeight: 700 }}>✕</button>
                    </div>
                    {children}
                    {footer && <div style={{ display: "flex", gap: 10, justifyContent: "flex-end", marginTop: 18 }}>{footer}</div>}
                </div>
            </div>
        </div>
    );
}

export default function SlaMastersPage() {
    const navigate = useNavigate();
    const [baseUrl] = useState(DEFAULT_BASE);

    const [slas, setSlas] = useState([]);
    const [loading, setLoading] = useState(false);

    const [search, setSearch] = useState("");
    const [filters, setFilters] = useState({ contract_type: "", category: "", status: "" });
    const [page, setPage] = useState(1);
    const PAGE_SIZE = 10;

    const [toast, setToast] = useState(null); // { title, msg, kind }

    // In-page detail section
    const [detailId, setDetailId] = useState(null);
    const [detail, setDetail] = useState(null);
    const [detailLoading, setDetailLoading] = useState(false);

    // Delete confirm
    const [pendingDelete, setPendingDelete] = useState(null); // { id, ref }
    const [deleting, setDeleting] = useState(false);

    const api = (path) => `${baseUrl.replace(/\/$/, "")}${path}`;

    function showToast(title, msg, kind = "success") {
        setToast({ title, msg, kind });
        window.clearTimeout(showToast._t);
        showToast._t = window.setTimeout(() => setToast(null), 3500);
    }

    async function readJson(res) {
        const payload = await res.json().catch(() => null);
        if (!res.ok) throw new Error(payload?.error?.message || payload?.message || `Request failed (${res.status})`);
        return payload;
    }

    /* ─── List ─── */
    async function loadSlas() {
        setLoading(true);
        try {
            const res = await authorizedFetch(api("/api/v3/sla-masters?offset=1&pageSize=200"), { method: "GET", headers: { Accept: "application/json" } });
            const payload = await readJson(res);
            setSlas(extractElements(payload).map(unwrap));
        } catch (e) {
            showToast("Load failed", e.message, "error");
        } finally {
            setLoading(false);
        }
    }

    useEffect(() => {
        loadSlas();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    /* ─── Derived ─── */
    const categories = useMemo(
        () => Array.from(new Set(slas.map((s) => s.category).filter(Boolean))).sort(),
        [slas]
    );
    const kpis = useMemo(() => ({
        total: slas.length,
        active: slas.filter((s) => (s.status || "ACTIVE") === "ACTIVE").length,
        contracts: new Set(slas.map((s) => s.contract_type).filter(Boolean)).size,
        categories: new Set(slas.map((s) => s.category).filter(Boolean)).size,
    }), [slas]);

    const filtered = useMemo(() => {
        const q = search.trim().toLowerCase();
        return slas.filter((s) =>
            (!q || `${s.sla_ref || ""} ${s.title || s.name || ""}`.toLowerCase().includes(q)) &&
            (!filters.contract_type || s.contract_type === filters.contract_type) &&
            (!filters.category || s.category === filters.category) &&
            (!filters.status || (s.status || "ACTIVE") === filters.status)
        );
    }, [slas, search, filters]);

    const filtersActive = !!(filters.contract_type || filters.category || filters.status || search);

    // Pagination — 10 rows per page over the filtered set.
    const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
    const safePage = Math.min(page, pageCount);
    const paged = useMemo(
        () => filtered.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE),
        [filtered, safePage]
    );
    // Snap back to page 1 whenever the filtered set changes (search/filter edits).
    useEffect(() => { setPage(1); }, [search, filters]);

    /* ─── Detail (in-page section) ─── */
    async function openDetail(id) {
        setDetailId(id);
        setDetail(null);
        setDetailLoading(true);
        try {
            const res = await authorizedFetch(api(`/api/v3/sla-masters/${encodeURIComponent(id)}`), { method: "GET", headers: { Accept: "application/json" } });
            const payload = await readJson(res);
            setDetail(payload?.data || payload);
        } catch (e) {
            showToast("Load failed", e.message, "error");
            setDetailId(null);
        } finally {
            setDetailLoading(false);
        }
    }
    function closeDetail() {
        setDetailId(null);
        setDetail(null);
    }

    /* ─── Delete ─── */
    async function confirmDelete() {
        if (!pendingDelete) return;
        setDeleting(true);
        try {
            const res = await authorizedFetch(api(`/api/v3/sla-masters/${encodeURIComponent(pendingDelete.id)}`), { method: "DELETE", headers: { Accept: "application/json" } });
            if (!res.ok) throw new Error(`Request failed (${res.status})`);
            showToast("Deleted", "SLA removed.");
            const removedId = pendingDelete.id;
            setPendingDelete(null);
            if (detailId === removedId) closeDetail();
            loadSlas();
        } catch (e) {
            showToast("Delete failed", e.message, "error");
        } finally {
            setDeleting(false);
        }
    }

    const filterLabel = { fontSize: 12, fontWeight: 600, color: "var(--uidai-pmis-muted)", marginBottom: 6 };
    const showingDetail = !!detailId;

    return (
        <div className="uidai-pmis-content">
            {showingDetail ? (
                <SlaDetailSection
                    d={detail}
                    loading={detailLoading}
                    onBack={closeDetail}
                    onEdit={(id) => navigate(`/sla-masters/onboard?id=${encodeURIComponent(id)}`)}
                    onDelete={(d) => setPendingDelete({ id: d.id || detailId, ref: d.sla_ref })}
                    fallbackId={detailId}
                />
            ) : (
                <>
                    {/* Header */}
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: 12 }}>
                        <div>
                            <div className="uidai-pmis-title" style={{ marginBottom: 2 }}>SLA Masters</div>
                            <div className="uidai-pmis-subtitle" style={{ marginTop: 0 }}>
                                Define once, map everywhere — onboard contract SLAs as reusable templates.
                            </div>
                        </div>
                        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
                            <button type="button" className="uidai-pmis-btn uidai-pmis-btn-cancel uidai-pmis-btn-small" style={{ marginTop: 0 }} onClick={loadSlas} disabled={loading}>
                                {loading ? "Loading…" : "↻ Refresh"}
                            </button>
                            <button type="button" className="uidai-pmis-btn uidai-pmis-btn-small" style={{ marginTop: 0 }} onClick={() => navigate("/sla-masters/onboard")}>+ Onboard New SLA</button>
                        </div>
                    </div>

                    {/* KPIs */}
                    <div className="uidai-pmis-kpi-row">
                        <div className="uidai-pmis-kpi"><div className="uidai-pmis-kpi-label">Total SLAs</div><div className="uidai-pmis-kpi-value">{kpis.total}</div></div>
                        <div className="uidai-pmis-kpi"><div className="uidai-pmis-kpi-label">Active</div><div className="uidai-pmis-kpi-value">{kpis.active}</div></div>
                        <div className="uidai-pmis-kpi"><div className="uidai-pmis-kpi-label">Contract Types</div><div className="uidai-pmis-kpi-value">{kpis.contracts}</div></div>
                        <div className="uidai-pmis-kpi"><div className="uidai-pmis-kpi-label">Categories</div><div className="uidai-pmis-kpi-value">{kpis.categories}</div></div>
                    </div>

                    {/* List card */}
                    <div className="uidai-pmis-card">
                        <div style={{ fontSize: 16, fontWeight: 800, color: "#173e77", marginBottom: 12 }}>SLA Definitions</div>

                        <div className="uidai-pmis-filter-shell">
                            <div className="uidai-pmis-filter-head">
                                <div className="uidai-pmis-filter-title">Filters</div>
                                {filtersActive && (
                                    <button type="button" className="uidai-pmis-filter-toggle" onClick={() => { setFilters({ contract_type: "", category: "", status: "" }); setSearch(""); }}>✕ Clear</button>
                                )}
                            </div>
                            <div className="uidai-pmis-filter-body" style={{ display: "flex", flexWrap: "wrap", gap: 14, alignItems: "flex-end" }}>
                                <div style={{ flex: "2 1 240px", minWidth: 200 }}>
                                    <div style={filterLabel}>Search</div>
                                    <input className="uidai-pmis-filter-input" type="text" placeholder="Search by SLA ref or title…" value={search} onChange={(e) => setSearch(e.target.value)} />
                                </div>
                                <div style={{ flex: "1 1 150px", minWidth: 140 }}>
                                    <div style={filterLabel}>Contract Type</div>
                                    <select className="uidai-pmis-filter-select" value={filters.contract_type} onChange={(e) => setFilters((f) => ({ ...f, contract_type: e.target.value }))}>
                                        <option value="">All</option>
                                        {CONTRACT_TYPES.map((c) => <option key={c} value={c}>{c}</option>)}
                                    </select>
                                </div>
                                <div style={{ flex: "1 1 160px", minWidth: 140 }}>
                                    <div style={filterLabel}>Category</div>
                                    <select className="uidai-pmis-filter-select" value={filters.category} onChange={(e) => setFilters((f) => ({ ...f, category: e.target.value }))}>
                                        <option value="">All</option>
                                        {categories.map((c) => <option key={c} value={c}>{c}</option>)}
                                    </select>
                                </div>
                                <div style={{ flex: "1 1 140px", minWidth: 130 }}>
                                    <div style={filterLabel}>Status</div>
                                    <select className="uidai-pmis-filter-select" value={filters.status} onChange={(e) => setFilters((f) => ({ ...f, status: e.target.value }))}>
                                        <option value="">All</option>
                                        {STATUS_OPTIONS.map((c) => <option key={c} value={c}>{c}</option>)}
                                    </select>
                                </div>
                            </div>
                        </div>

                        <div className="uidai-pmis-table-wrap" style={{ marginTop: 14 }}>
                            <table className="uidai-pmis-table">
                                <thead>
                                    <tr>
                                        <th>SLA Number</th><th>Title</th><th>Contract</th><th>Category</th><th>Status</th><th>Updated</th><th style={{ textAlign: "center" }}>Actions</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {loading ? (
                                        <tr><td colSpan={7} style={{ textAlign: "center", padding: 28, ...muted }}>Loading…</td></tr>
                                    ) : filtered.length === 0 ? (
                                        <tr><td colSpan={7} style={{ textAlign: "center", padding: 28, ...muted, fontStyle: "italic" }}>
                                            {slas.length === 0 ? "No SLAs loaded. Check the API base, then Refresh." : "No matching SLAs."}
                                        </td></tr>
                                    ) : paged.map((s) => (
                                        <tr key={s.id}>
                                            <td><button type="button" className="uidai-pmis-link" style={{ background: "none", border: "none", padding: 0, font: "inherit", color: "#173e77", fontWeight: 700, cursor: "pointer", textDecoration: "underline" }} onClick={() => openDetail(s.id)}>{s.sla_ref || "—"}</button></td>
                                            <td>{s.title || s.name || "—"}</td>
                                            <td><span className="uidai-pmis-badge">{s.contract_type || "—"}</span></td>
                                            <td>{s.category || humanize(s.formula_type)}</td>
                                            <td><StatusBadge status={s.status} /></td>
                                            <td style={{ ...muted, fontSize: 12 }}>{(s.updated_at || s.created_at || "").slice(0, 10) || "—"}</td>
                                            <td style={{ textAlign: "center", whiteSpace: "nowrap" }}>
                                                <span style={{ display: "inline-flex", gap: 6 }}>
                                                    <button type="button" className="uidai-pmis-btn uidai-pmis-btn-cancel uidai-pmis-btn-small" onClick={() => openDetail(s.id)}>View</button>
                                                    <button type="button" className="uidai-pmis-btn uidai-pmis-btn-cancel uidai-pmis-btn-small" onClick={() => navigate(`/sla-masters/onboard?id=${encodeURIComponent(s.id)}`)}>Edit</button>
                                                    <button type="button" className="uidai-pm-icon-btn uidai-pm-icon-btn--danger" title="Delete" onClick={() => setPendingDelete({ id: s.id, ref: s.sla_ref })}>🗑</button>
                                                </span>
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>

                        {/* Pagination */}
                        {!loading && filtered.length > 0 && (
                            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 10, marginTop: 14 }}>
                                <div style={{ fontSize: 12.5, ...muted }}>
                                    Showing <strong style={{ color: "#173e77" }}>{(safePage - 1) * PAGE_SIZE + 1}–{Math.min(safePage * PAGE_SIZE, filtered.length)}</strong> of <strong style={{ color: "#173e77" }}>{filtered.length}</strong>
                                </div>
                                <div style={{ display: "inline-flex", gap: 6, alignItems: "center" }}>
                                    <button type="button" className="uidai-pmis-btn uidai-pmis-btn-cancel uidai-pmis-btn-small" disabled={safePage <= 1} onClick={() => setPage(1)}>« First</button>
                                    <button type="button" className="uidai-pmis-btn uidai-pmis-btn-cancel uidai-pmis-btn-small" disabled={safePage <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))}>‹ Prev</button>
                                    <span style={{ fontSize: 12.5, fontWeight: 700, color: "#173e77", padding: "0 8px" }}>Page {safePage} / {pageCount}</span>
                                    <button type="button" className="uidai-pmis-btn uidai-pmis-btn-cancel uidai-pmis-btn-small" disabled={safePage >= pageCount} onClick={() => setPage((p) => Math.min(pageCount, p + 1))}>Next ›</button>
                                    <button type="button" className="uidai-pmis-btn uidai-pmis-btn-cancel uidai-pmis-btn-small" disabled={safePage >= pageCount} onClick={() => setPage(pageCount)}>Last »</button>
                                </div>
                            </div>
                        )}
                    </div>
                </>
            )}

            {/* ─── Delete confirm ─── */}
            <Modal
                open={!!pendingDelete}
                onClose={() => setPendingDelete(null)}
                width={520}
                title="Delete SLA?"
                footer={
                    <>
                        <button type="button" className="uidai-pmis-btn uidai-pmis-btn-cancel" onClick={() => setPendingDelete(null)} disabled={deleting}>Cancel</button>
                        <button type="button" className="uidai-pm-icon-btn uidai-pm-icon-btn--danger" style={{ padding: "9px 16px", borderRadius: 6 }} onClick={confirmDelete} disabled={deleting}>{deleting ? "Deleting…" : "Delete"}</button>
                    </>
                }
            >
                <div style={{ fontSize: 13, ...muted }}>
                    Are you sure you want to delete <strong style={{ color: "#173e77" }}>{pendingDelete?.ref || "this SLA"}</strong>? This action cannot be undone.
                </div>
            </Modal>

            {/* ─── Toast ─── */}
            {toast && (
                <div style={{ position: "fixed", top: 20, right: 20, background: "#fff", borderLeft: `4px solid ${toast.kind === "error" ? "#d32f2f" : "#1a7f37"}`, padding: "12px 16px", borderRadius: 8, boxShadow: "0 10px 30px rgba(0,0,0,.15)", zIndex: 2000, minWidth: 280, maxWidth: 420 }}>
                    <div style={{ fontWeight: 800, fontSize: 13, marginBottom: 3, color: "#173e77" }}>{toast.title}</div>
                    {toast.msg && <div style={{ fontSize: 12, ...muted }}>{toast.msg}</div>}
                </div>
            )}
        </div>
    );
}

/* ════════════════════ Detail section (in-page) ════════════════════ */

const labelStyle = { fontSize: 10.5, fontWeight: 700, textTransform: "uppercase", letterSpacing: ".4px", color: "var(--uidai-pmis-muted)", marginBottom: 5 };

function InfoGrid({ items, min = 220 }) {
    const visible = items.filter((it) => it && it.value !== undefined);
    return (
        <div style={{ display: "grid", gridTemplateColumns: `repeat(auto-fit, minmax(${min}px, 1fr))`, gap: "18px 26px" }}>
            {visible.map((it, i) => (
                <div key={i} style={it.full ? { gridColumn: "1 / -1" } : undefined}>
                    <div style={labelStyle}>{it.label}</div>
                    <div style={{ fontSize: 13.5, color: "var(--uidai-pmis-text)", lineHeight: 1.55, wordBreak: "break-word", fontFamily: it.mono ? "ui-monospace, SFMono-Regular, Menlo, monospace" : "inherit" }}>
                        {it.value === null || it.value === "" || it.value === undefined ? <span style={{ color: "#9aa7ba", fontStyle: "italic" }}>—</span> : it.value}
                    </div>
                </div>
            ))}
        </div>
    );
}

function Chip({ children, tone = "navy" }) {
    const tones = {
        navy: { bg: "#eef4fc", fg: "#173e77" },
        cyan: { bg: "#e6f6fa", fg: "#0b6a7e" },
        slate: { bg: "#eef1f6", fg: "#41506a" },
    };
    const t = tones[tone] || tones.navy;
    return <span style={{ display: "inline-block", background: t.bg, color: t.fg, fontWeight: 700, fontSize: 11.5, padding: "3px 10px", borderRadius: 99 }}>{children}</span>;
}

function DetailCard({ title, right, children, style }) {
    return (
        <div className="uidai-pmis-card" style={{ marginBottom: 18, ...style }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16, gap: 12 }}>
                <div style={{ fontSize: 15, fontWeight: 800, color: NAVY }}>{title}</div>
                {right}
            </div>
            {children}
        </div>
    );
}

function SubTable({ columns, rows }) {
    if (!Array.isArray(rows) || rows.length === 0) {
        return <div style={{ fontSize: 12.5, ...muted, fontStyle: "italic" }}>None.</div>;
    }
    return (
        <div className="uidai-pmis-table-wrap">
            <table className="uidai-pmis-table uidai-pmis-table-compact" style={{ marginTop: 0, minWidth: 0 }}>
                <thead><tr>{columns.map((c) => <th key={c.key}>{c.label}</th>)}</tr></thead>
                <tbody>
                    {rows.map((r, i) => (
                        <tr key={i}>{columns.map((c) => {
                            const v = r[c.key];
                            const display = v === null || v === undefined || v === "" ? "—" : (typeof v === "boolean" ? (v ? "✓" : "—") : String(v));
                            return <td key={c.key}>{display}</td>;
                        })}</tr>
                    ))}
                </tbody>
            </table>
        </div>
    );
}

function MeasurementCard({ title, m }) {
    const empty = !m || !m.display_name;
    return (
        <div style={{ flex: "1 1 240px", minWidth: 220, border: "1px solid var(--uidai-pmis-border)", borderRadius: 10, padding: 14, background: "#fbfdff" }}>
            <div style={labelStyle}>{title}</div>
            {empty ? (
                <div style={{ color: "#9aa7ba", fontStyle: "italic", fontSize: 13 }}>Not set</div>
            ) : (
                <>
                    <div style={{ fontSize: 15, fontWeight: 700, color: NAVY, marginBottom: 6 }}>{m.display_name}</div>
                    <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                        {m.unit ? <Chip tone="slate">unit: {m.unit}</Chip> : null}
                        {m.target_value !== undefined && m.target_value !== null && m.target_value !== "" ? <Chip tone="cyan">target: {m.target_value}</Chip> : null}
                    </div>
                </>
            )}
        </div>
    );
}

// Find the first image reference in a detail object, across the common
// shapes (attachments/images/files arrays, or a *_url field).
function extractImageRef(d) {
    if (!d) return null;
    const direct = d.image_url || d.imageUrl || d.rfp_image_url || d.rfp_image || d.image;
    if (typeof direct === "string" && direct.trim()) return direct;
    const arrays = [d.attachments, d.images, d.files, d?._embedded?.attachments, d?._embedded?.images, d?._embedded?.files];
    for (const arr of arrays) {
        if (!Array.isArray(arr)) continue;
        for (const it of arr) {
            if (!it) continue;
            if (typeof it === "string" && it.trim()) return it;
            const u = it.url || it.href || it.file_url || it.fileUrl || it.download_url || it.downloadUrl
                || it.path || it.src || it?._links?.download?.href || it?._links?.self?.href;
            if (typeof u === "string" && u.trim()) return u;
        }
    }
    return null;
}
function resolveImageUrl(u) {
    if (!u) return null;
    if (/^https?:\/\//i.test(u) || u.startsWith("data:") || u.startsWith("blob:")) return u;
    return DEFAULT_BASE.replace(/\/$/, "") + (u.startsWith("/") ? u : "/" + u);
}

function SlaDetailSection({ d, loading, onBack, onEdit, onDelete, fallbackId }) {
    // RFP image — fetched as an authorized blob (token-protected), with a
    // direct-src fallback for public URLs. Hooks run before any early return.
    const [imgSrc, setImgSrc] = useState(null);
    const [imgState, setImgState] = useState("none"); // none | loading | ok | error
    useEffect(() => {
        let cancelled = false;
        let objectUrl = null;
        const ref = extractImageRef(d);
        if (!ref) { setImgState("none"); setImgSrc(null); return undefined; }
        const url = resolveImageUrl(ref);
        setImgState("loading"); setImgSrc(null);
        (async () => {
            try {
                const res = await authorizedFetch(url, { method: "GET" });
                if (!res.ok) throw new Error(`HTTP ${res.status}`);
                const blob = await res.blob();
                if (cancelled) return;
                objectUrl = URL.createObjectURL(blob);
                setImgSrc(objectUrl);
                setImgState("ok");
            } catch {
                if (cancelled) return;
                // Fall back to a direct <img src> (works for public URLs).
                setImgSrc(url);
                setImgState("ok");
            }
        })();
        return () => { cancelled = true; if (objectUrl) URL.revokeObjectURL(objectUrl); };
    }, [d]);

    const backBtn = (
        <button type="button" className="uidai-pmis-btn uidai-pmis-btn-cancel uidai-pmis-btn-small" style={{ marginTop: 0 }} onClick={onBack}>← Back to SLA Masters</button>
    );

    if (loading || !d) {
        return (
            <>
                <div style={{ marginBottom: 16 }}>{backBtn}</div>
                <div className="uidai-pmis-card" style={{ textAlign: "center", padding: 40, ...muted }}>Loading SLA details…</div>
            </>
        );
    }

    const definition = d.definition || d.description;
    const scope = d.scope || d.scope_text;
    const calculation = d.calculation || d.calculation_method;
    const appliedOn = d.applied_on || d.ld_computation_base;
    const category = d.category || d.category_code;
    const lin = d.linear_escalation;
    const targetRows = d.target_rows || d.bands || d.condition_bands;
    const id = d.id || fallbackId;

    return (
        <div>
            {/* Action row */}
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 10, marginBottom: 16 }}>
                {backBtn}
                <div style={{ display: "flex", gap: 8 }}>
                    <button type="button" className="uidai-pmis-btn uidai-pmis-btn-small" style={{ marginTop: 0 }} onClick={() => onEdit(id)}>✎ Edit</button>
                    <button type="button" className="uidai-pmis-btn uidai-pmis-btn-outline-red uidai-pmis-btn-small" style={{ marginTop: 0 }} onClick={() => onDelete(d)}>🗑 Delete</button>
                </div>
            </div>

            {/* Hero */}
            <div className="uidai-pmis-card" style={{ marginBottom: 18 }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: 14 }}>
                    <div style={{ minWidth: 0 }}>
                        <div style={{ fontSize: 13, fontWeight: 700, color: "var(--uidai-pmis-muted)", fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace", marginBottom: 6 }}>{d.sla_ref || "—"}</div>
                        <div style={{ fontSize: 22, fontWeight: 800, color: NAVY, lineHeight: 1.25 }}>{d.title || d.name || "Untitled SLA"}</div>
                    </div>
                    <StatusBadge status={d.status} />
                </div>
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 14 }}>
                    {d.contract_type ? <Chip>{d.contract_type}</Chip> : null}
                    {category ? <Chip tone="cyan">{category}</Chip> : null}
                    {d.formula_type ? <Chip tone="slate">{humanize(d.formula_type)}</Chip> : null}
                </div>
            </div>

            {/* Definition & Scope */}
            <DetailCard title="Definition & Scope">
                <InfoGrid min={300} items={[
                    { label: "Definition of SLA", value: definition, full: true },
                    { label: "Scope of SLA", value: scope, full: true },
                ]} />
            </DetailCard>

            {/* Source & Calculation */}
            <DetailCard title="Source & Calculation">
                <InfoGrid items={[
                    { label: "Source of Data", value: d.data_source },
                    { label: "Reports submitted to", value: d.reports_submitted_to },
                    { label: "SLA Calculation", value: calculation, full: true },
                ]} />
            </DetailCard>

            {/* Cadence & Application */}
            <DetailCard title="Cadence & Application">
                <InfoGrid items={[
                    { label: "Measurement Interval", value: d.measurement_interval ? humanize(d.measurement_interval) : null },
                    { label: "Reporting Interval", value: d.reporting_interval ? humanize(d.reporting_interval) : null },
                    { label: "Applied On", value: appliedOn ? humanize(appliedOn) : null },
                    { label: "Active From", value: (d.effective_from || "").slice(0, 10) || null },
                    { label: "Active Until", value: d.effective_until ? d.effective_until.slice(0, 10) : null },
                ]} />
            </DetailCard>

            {/* Measurement */}
            <DetailCard title="Measurement">
                <div style={{ display: "flex", gap: 14, flexWrap: "wrap" }}>
                    <MeasurementCard title="Primary measurement" m={d.measurement} />
                    {d.secondary_measurement ? <MeasurementCard title="Secondary measurement" m={d.secondary_measurement} /> : null}
                </div>
            </DetailCard>

            {/* Target */}
            <DetailCard title={lin ? "Target — Linear LD escalation" : "Target — Severity bands"}>
                {lin ? (
                    <div>
                        <div style={{ padding: "12px 14px", borderRadius: 8, border: "1px dashed #0aa1c0", background: "#eef7fb", fontSize: 14, color: NAVY }}>
                            If delayed by <strong>N</strong> {lin.unit || "unit"}{(lin.unit || "unit").endsWith("s") ? "" : "s"} → <strong style={{ color: "#b91c1c" }}>LD = N × {lin.rate_per_unit_percent}% × base</strong>
                        </div>
                        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 12 }}>
                            <Chip tone="slate">rate: {lin.rate_per_unit_percent}%</Chip>
                            <Chip tone="slate">unit: {lin.unit}</Chip>
                            <Chip tone="slate">grace: {lin.grace_units ?? 0}</Chip>
                            {lin.max_units != null ? <Chip tone="slate">max: {lin.max_units}</Chip> : null}
                        </div>
                    </div>
                ) : (
                    <SubTable
                        columns={[
                            { key: "severity", label: "Severity" },
                            { key: "threshold_label", label: "Threshold" },
                            { key: "from_value", label: "From (excl.)" },
                            { key: "to_value", label: "To (incl.)" },
                            { key: "input_variable", label: "Input variable" },
                        ]}
                        rows={targetRows}
                    />
                )}
            </DetailCard>

            {/* Placeholders */}
            {Array.isArray(d.placeholders) && d.placeholders.length > 0 && (
                <DetailCard title="Mapping inputs (placeholders)">
                    <SubTable
                        columns={[
                            { key: "key", label: "Key" },
                            { key: "label", label: "Label" },
                            { key: "type", label: "Type" },
                            { key: "required", label: "Required" },
                            { key: "help", label: "Help" },
                        ]}
                        rows={d.placeholders}
                    />
                </DetailCard>
            )}

            {/* Meta */}
            {(d.created_at || d.updated_at || d.project_id) && (
                <DetailCard title="Record">
                    <InfoGrid items={[
                        { label: "Project ID", value: d.project_id, mono: true },
                        { label: "Created", value: (d.created_at || "").slice(0, 19).replace("T", " ") || null },
                        { label: "Updated", value: (d.updated_at || "").slice(0, 19).replace("T", " ") || null },
                    ]} />
                </DetailCard>
            )}

            {/* RFP image (below the details) */}
            {imgState !== "none" && (
                <DetailCard title="RFP Image">
                    {imgState === "loading" && <div style={{ fontSize: 12.5, ...muted }}>Loading image…</div>}
                    {imgState === "error" && <div style={{ fontSize: 12.5, ...muted, fontStyle: "italic" }}>Couldn’t load the image.</div>}
                    {imgState === "ok" && imgSrc && (
                        <a href={imgSrc} target="_blank" rel="noreferrer" title="Open full size">
                            <img
                                src={imgSrc}
                                alt={`RFP source for ${d.sla_ref || "SLA"}`}
                                onError={() => setImgState("error")}
                                style={{ display: "block", maxWidth: "100%", maxHeight: 520, borderRadius: 8, border: "1px solid var(--uidai-pmis-border)" }}
                            />
                        </a>
                    )}
                </DetailCard>
            )}
        </div>
    );
}
