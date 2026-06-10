/* ══════════════════════════════════════════════════════════════════
   SlaMastersPage.jsx — SLA Masters library (route /sla-masters).

   Mirrors the standalone "SLA Master.html" reference in the project's
   uidai-pmis design system. Backed by the contracts API:
     GET    /api/v3/sla-masters?offset=1&pageSize=200   list
     GET    /api/v3/sla-masters/{id}                    detail
     POST   /api/v3/sla-masters                         create (full schema)
     PATCH  /api/v3/sla-masters/{id}                    update (subset)
     DELETE /api/v3/sla-masters/{id}                    delete
   ══════════════════════════════════════════════════════════════════ */

import React, { useEffect, useMemo, useState } from "react";
import { authorizedFetch } from "../../api/client";
import "../../styles/global.css";

const DEFAULT_BASE = "http://10.1.131.199/contracts";

const CONTRACT_TYPES = ["BSP", "MSAP", "MSIP", "PMU"];
const STATUS_OPTIONS = ["ACTIVE", "DRAFT", "RETIRED"];
const FORMULA_TYPES = ["band_accumulation", "point_accumulation", "fixed_escalation", "wac"];
const MEAS_INTERVALS = ["DAILY", "WEEKLY", "MONTHLY", "QUARTERLY", "ONE_TIME"];
const REP_INTERVALS = ["WEEKLY", "MONTHLY", "QUARTERLY", "ANNUAL"];
const BASELINE_TYPES = ["STATIC", "ROLLING"];
const COMPOUND_RULES = ["INDEPENDENT", "COMBINED"];
const LD_AGG_METHODS = ["SUM", "MAX", "AVG"];
const LD_BASES = ["QUARTERLY_PAYMENT", "ANNUAL_PAYMENT", "FIXED_AMOUNT"];
const DIRECTIONS = ["LOWER_BETTER", "HIGHER_BETTER"];
const GUARD_OPS = ["GT", "GTE", "LT", "LTE", "EQ", "NEQ"];

function today() {
    return new Date().toISOString().slice(0, 10);
}

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

const inputStyle = {
    width: "100%", padding: "9px 10px", borderRadius: 6, border: "1px solid var(--uidai-pmis-border)",
    background: "#fff", color: "var(--uidai-pmis-text)", font: "inherit", fontSize: 13, boxSizing: "border-box",
};
const smallInput = { ...inputStyle, padding: "6px 8px", fontSize: 12 };
const muted = { color: "var(--uidai-pmis-muted)" };

function StatusBadge({ status }) {
    const s = String(status || "ACTIVE").toUpperCase();
    const cls = s === "ACTIVE" ? "uidai-pmis-badge-green" : s === "RETIRED" ? "uidai-pmis-badge-red" : "uidai-pmis-badge-orange";
    return <span className={`uidai-pmis-badge ${cls}`}>{s}</span>;
}

/* ─── Modal shell (project-themed, no global modal class) ─── */
function Modal({ open, onClose, title, subtitle, width = 900, children, footer }) {
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
                        <div>
                            <div style={{ fontSize: 18, fontWeight: 800, color: "var(--uidai-pmis-navy)" }}>{title}</div>
                            {subtitle && <div style={{ fontSize: 12, ...muted, marginTop: 3 }}>{subtitle}</div>}
                        </div>
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

/* ─── A labelled field ─── */
function Field({ label, required, children, full, hint }) {
    return (
        <div style={full ? { gridColumn: "1 / -1" } : undefined}>
            <label style={{ fontWeight: 600, display: "block", marginBottom: 5, fontSize: 13, color: "var(--uidai-pmis-text)" }}>
                {label} {required && <span style={{ color: "var(--uidai-pmis-red, #d32f2f)" }}>*</span>}
            </label>
            {children}
            {hint && <div style={{ fontSize: 11, ...muted, marginTop: 4 }}>{hint}</div>}
        </div>
    );
}

/* ─── A collapsible sub-section in the onboard form ─── */
function SubSection({ title, action, children }) {
    return (
        <div style={{ border: "1px solid var(--uidai-pmis-border)", borderRadius: 8, padding: 14, marginTop: 12, background: "#fafcff" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
                <div style={{ fontWeight: 800, color: "var(--uidai-pmis-navy)", fontSize: 13.5 }}>{title}</div>
                {action}
            </div>
            {children}
        </div>
    );
}

/* ─── Generic add/remove row editor for the array sub-tables ─── */
function ArrayEditor({ columns, rows, onChange, addLabel = "+ Add row" }) {
    const blank = () => Object.fromEntries(columns.map((c) => [c.key, c.default ?? ""]));
    const update = (i, key, val) => onChange(rows.map((r, idx) => (idx === i ? { ...r, [key]: val } : r)));
    const add = () => onChange([...rows, blank()]);
    const remove = (i) => onChange(rows.filter((_, idx) => idx !== i));
    const gridCols = columns.map((c) => c.width || "1fr").join(" ") + " auto";
    return (
        <div>
            {rows.length === 0 && (
                <div style={{ fontSize: 12, ...muted, fontStyle: "italic", marginBottom: 8 }}>None added.</div>
            )}
            {rows.length > 0 && (
                <div style={{ overflowX: "auto" }}>
                    <div style={{ minWidth: columns.length * 120 }}>
                        <div style={{ display: "grid", gridTemplateColumns: gridCols, gap: 8, marginBottom: 6, fontSize: 10.5, fontWeight: 700, ...muted, textTransform: "uppercase", letterSpacing: ".3px" }}>
                            {columns.map((c) => <div key={c.key}>{c.label}</div>)}
                            <div />
                        </div>
                        {rows.map((r, i) => (
                            <div key={i} style={{ display: "grid", gridTemplateColumns: gridCols, gap: 8, marginBottom: 8, alignItems: "center" }}>
                                {columns.map((c) => (
                                    c.options ? (
                                        <select key={c.key} style={smallInput} value={r[c.key]} onChange={(e) => update(i, c.key, e.target.value)}>
                                            {c.options.map((o) => <option key={String(o.value ?? o)} value={o.value ?? o}>{o.label ?? humanize(o)}</option>)}
                                        </select>
                                    ) : (
                                        <input key={c.key} style={smallInput} type={c.type || "text"} placeholder={c.label} value={r[c.key]} onChange={(e) => update(i, c.key, e.target.value)} />
                                    )
                                ))}
                                <button type="button" className="uidai-pm-icon-btn uidai-pm-icon-btn--danger" title="Remove" onClick={() => remove(i)}>✕</button>
                            </div>
                        ))}
                    </div>
                </div>
            )}
            <button type="button" className="uidai-pmis-btn uidai-pmis-btn-cancel uidai-pmis-btn-small" style={{ marginTop: 4 }} onClick={add}>{addLabel}</button>
        </div>
    );
}

/* ─── Column specs for each array sub-table ─── */
const METRIC_COLS = [
    { key: "metric_key", label: "Internal key" },
    { key: "display_name", label: "Display name" },
    { key: "unit", label: "Unit" },
    { key: "target_numeric", label: "Target", type: "number" },
    { key: "direction", label: "Direction", options: DIRECTIONS, default: "LOWER_BETTER" },
    { key: "is_primary", label: "Primary?", options: [{ value: "false", label: "No" }, { value: "true", label: "Yes" }], default: "false" },
];
const PARAM_COLS = [
    { key: "param_key", label: "Key" },
    { key: "param_value", label: "Value" },
];
const BAND_COLS = [
    { key: "sort_order", label: "Order", type: "number", width: "70px" },
    { key: "band_label", label: "Label" },
    { key: "metric_key", label: "Metric key" },
    { key: "range_min", label: "From", type: "number", width: "90px" },
    { key: "range_max", label: "To", type: "number", width: "90px" },
    { key: "range_unit", label: "Unit", width: "80px" },
    { key: "severity_level", label: "Severity", type: "number", width: "90px" },
    { key: "rate_percent", label: "Rate %", type: "number", width: "90px" },
    { key: "points_contribution", label: "Points", type: "number", width: "80px" },
];
const LOOKUP_COLS = [
    { key: "sort_order", label: "Order", type: "number", width: "70px" },
    { key: "lookup_key", label: "Tier label" },
    { key: "lookup_value", label: "LD %", type: "number" },
];
const GUARD_COLS = [
    { key: "metric_key", label: "Metric key" },
    { key: "operator", label: "Op", options: GUARD_OPS, default: "GT", width: "90px" },
    { key: "threshold_value", label: "Threshold", type: "number", width: "100px" },
    { key: "threshold_unit", label: "Unit", width: "80px" },
    { key: "action", label: "Action" },
    { key: "action_description", label: "Description" },
];

const EMPTY_FORM = {
    sla_ref: "", title: "", contract_type: "PMU", category: "", formula_type: "point_accumulation",
    description: "", scope_text: "", data_source: "", calculation_method: "", reports_submitted_to: "",
    measurement_interval: "MONTHLY", reporting_interval: "QUARTERLY", baseline_type: "STATIC",
    compound_metric_rule: "INDEPENDENT", ld_aggregation_method: "SUM", ld_computation_base: "QUARTERLY_PAYMENT",
    effective_from: today(), effective_until: "", status: "ACTIVE",
};

export default function SlaMastersPage() {
    const [baseUrl, setBaseUrl] = useState(DEFAULT_BASE);
    const [health, setHealth] = useState("unknown"); // unknown | ok | err

    const [slas, setSlas] = useState([]);
    const [loading, setLoading] = useState(false);

    const [search, setSearch] = useState("");
    const [filters, setFilters] = useState({ contract_type: "", category: "", status: "" });

    const [toast, setToast] = useState(null); // { title, msg, kind }

    // Onboard / edit modal
    const [formOpen, setFormOpen] = useState(false);
    const [editingId, setEditingId] = useState(null);
    const [form, setForm] = useState(EMPTY_FORM);
    const [metrics, setMetrics] = useState([]);
    const [parameters, setParameters] = useState([]);
    const [bands, setBands] = useState([]);
    const [lookup, setLookup] = useState([]);
    const [guards, setGuards] = useState([]);
    const [saving, setSaving] = useState(false);

    // View modal
    const [viewOpen, setViewOpen] = useState(false);
    const [viewData, setViewData] = useState(null);
    const [viewLoading, setViewLoading] = useState(false);

    // Delete confirm
    const [pendingDelete, setPendingDelete] = useState(null); // { id, ref }
    const [deleting, setDeleting] = useState(false);

    const api = (path) => `${baseUrl.replace(/\/$/, "")}${path}`;
    const setF = (patch) => setForm((f) => ({ ...f, ...patch }));

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

    /* ─── Health ─── */
    async function checkHealth() {
        try {
            const res = await authorizedFetch(api("/health"), { method: "GET", headers: { Accept: "application/json" } });
            setHealth(res.ok ? "ok" : "err");
            if (res.ok) loadSlas();
        } catch {
            setHealth("err");
        }
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
        checkHealth();
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

    /* ─── Onboard / Edit ─── */
    function openOnboard() {
        setEditingId(null);
        setForm({ ...EMPTY_FORM });
        setMetrics([]); setParameters([]); setBands([]); setLookup([]); setGuards([]);
        setFormOpen(true);
    }

    async function openEdit(id) {
        try {
            const res = await authorizedFetch(api(`/api/v3/sla-masters/${encodeURIComponent(id)}`), { method: "GET", headers: { Accept: "application/json" } });
            const payload = await readJson(res);
            const d = payload?.data || payload;
            setEditingId(id);
            setForm({
                sla_ref: d.sla_ref || "", title: d.title || d.name || "", contract_type: d.contract_type || "PMU",
                category: d.category || "", formula_type: d.formula_type || "point_accumulation",
                description: d.description || "", scope_text: d.scope_text || "", data_source: d.data_source || "",
                calculation_method: d.calculation_method || "", reports_submitted_to: d.reports_submitted_to || "",
                measurement_interval: d.measurement_interval || "MONTHLY", reporting_interval: d.reporting_interval || "QUARTERLY",
                baseline_type: d.baseline_type || "STATIC", compound_metric_rule: d.compound_metric_rule || "INDEPENDENT",
                ld_aggregation_method: d.ld_aggregation_method || "SUM", ld_computation_base: d.ld_computation_base || "QUARTERLY_PAYMENT",
                effective_from: (d.effective_from || today()).slice(0, 10), effective_until: (d.effective_until || "").slice(0, 10),
                status: d.status || "ACTIVE",
            });
            const toStr = (rows, cols) => (Array.isArray(rows) ? rows : []).map((r) =>
                Object.fromEntries(cols.map((c) => [c.key, r[c.key] === undefined || r[c.key] === null ? (c.default ?? "") : (typeof r[c.key] === "boolean" ? String(r[c.key]) : r[c.key])])));
            setMetrics(toStr(d.metrics, METRIC_COLS));
            setParameters(toStr(d.parameters, PARAM_COLS));
            setBands(toStr(d.condition_bands || d.bands, BAND_COLS));
            setLookup(toStr(d.lookup_table || d.lookup_rows, LOOKUP_COLS));
            setGuards(toStr(d.guard_conditions || d.guards, GUARD_COLS));
            setFormOpen(true);
        } catch (e) {
            showToast("Load failed", e.message, "error");
        }
    }

    // Coerce numeric-looking string fields to numbers; drop empty rows.
    function cleanRows(rows, cols) {
        return rows
            .filter((r) => cols.some((c) => String(r[c.key] ?? "").trim() !== ""))
            .map((r) => {
                const out = {};
                cols.forEach((c) => {
                    let v = r[c.key];
                    if (v === "" || v === undefined) return;
                    if (c.type === "number") v = Number(v);
                    else if (v === "true") v = true;
                    else if (v === "false") v = false;
                    out[c.key] = v;
                });
                return out;
            });
    }

    async function submitForm() {
        if (!form.sla_ref.trim() || !form.title.trim()) {
            showToast("Missing fields", "SLA Ref and Title are required.", "error");
            return;
        }
        setSaving(true);
        try {
            if (editingId) {
                // PATCH — subset the API accepts on update.
                const body = {
                    title: form.title.trim(), description: form.description.trim() || null,
                    measurement_interval: form.measurement_interval, reporting_interval: form.reporting_interval,
                    baseline_type: form.baseline_type, compound_metric_rule: form.compound_metric_rule,
                    ld_aggregation_method: form.ld_aggregation_method, ld_computation_base: form.ld_computation_base,
                    effective_until: form.effective_until || null, status: form.status, metadata: {},
                    category: form.category || null, scope_text: form.scope_text.trim() || null,
                    data_source: form.data_source.trim() || null, calculation_method: form.calculation_method.trim() || null,
                    reports_submitted_to: form.reports_submitted_to.trim() || null,
                };
                const res = await authorizedFetch(api(`/api/v3/sla-masters/${encodeURIComponent(editingId)}`), {
                    method: "PATCH", headers: { "Content-Type": "application/json", Accept: "application/json" }, body: JSON.stringify(body),
                });
                await readJson(res);
                showToast("Saved", "SLA updated.");
            } else {
                // POST — full schema.
                const body = {
                    contract_type: form.contract_type, formula_type: form.formula_type, sla_ref: form.sla_ref.trim(),
                    title: form.title.trim(), description: form.description.trim() || null,
                    measurement_interval: form.measurement_interval, reporting_interval: form.reporting_interval,
                    baseline_type: form.baseline_type, compound_metric_rule: form.compound_metric_rule,
                    ld_aggregation_method: form.ld_aggregation_method, ld_computation_base: form.ld_computation_base,
                    effective_from: form.effective_from, effective_until: form.effective_until || null, metadata: {},
                    category: form.category || null, scope_text: form.scope_text.trim() || null,
                    data_source: form.data_source.trim() || null, calculation_method: form.calculation_method.trim() || null,
                    reports_submitted_to: form.reports_submitted_to.trim() || null,
                    metrics: cleanRows(metrics, METRIC_COLS),
                    parameters: cleanRows(parameters, PARAM_COLS),
                    condition_bands: cleanRows(bands, BAND_COLS),
                    lookup_table: cleanRows(lookup, LOOKUP_COLS),
                    guard_conditions: cleanRows(guards, GUARD_COLS),
                };
                const res = await authorizedFetch(api("/api/v3/sla-masters"), {
                    method: "POST", headers: { "Content-Type": "application/json", Accept: "application/json" }, body: JSON.stringify(body),
                });
                await readJson(res);
                showToast("Saved", "SLA onboarded.");
            }
            setFormOpen(false);
            loadSlas();
        } catch (e) {
            showToast("Save failed", e.message, "error");
        } finally {
            setSaving(false);
        }
    }

    /* ─── View ─── */
    async function openView(id) {
        setViewOpen(true);
        setViewData(null);
        setViewLoading(true);
        try {
            const res = await authorizedFetch(api(`/api/v3/sla-masters/${encodeURIComponent(id)}`), { method: "GET", headers: { Accept: "application/json" } });
            const payload = await readJson(res);
            setViewData(payload?.data || payload);
        } catch (e) {
            showToast("Load failed", e.message, "error");
            setViewOpen(false);
        } finally {
            setViewLoading(false);
        }
    }

    /* ─── Delete ─── */
    async function confirmDelete() {
        if (!pendingDelete) return;
        setDeleting(true);
        try {
            const res = await authorizedFetch(api(`/api/v3/sla-masters/${encodeURIComponent(pendingDelete.id)}`), { method: "DELETE", headers: { Accept: "application/json" } });
            if (!res.ok) throw new Error(`Request failed (${res.status})`);
            showToast("Deleted", "SLA removed.");
            setPendingDelete(null);
            loadSlas();
        } catch (e) {
            showToast("Delete failed", e.message, "error");
        } finally {
            setDeleting(false);
        }
    }

    const filterLabel = { fontSize: 12, fontWeight: 600, color: "var(--uidai-pmis-muted)", marginBottom: 6 };

    return (
        <div className="uidai-pmis-content">
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
                    <button type="button" className="uidai-pmis-btn uidai-pmis-btn-small" style={{ marginTop: 0 }} onClick={openOnboard}>+ Onboard New SLA</button>
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
                            ) : filtered.map((s) => (
                                <tr key={s.id}>
                                    <td><button type="button" className="uidai-pmis-link" style={{ background: "none", border: "none", padding: 0, font: "inherit", color: "#173e77", fontWeight: 700, cursor: "pointer", textDecoration: "underline" }} onClick={() => openView(s.id)}>{s.sla_ref || "—"}</button></td>
                                    <td>{s.title || s.name || "—"}</td>
                                    <td><span className="uidai-pmis-badge">{s.contract_type || "—"}</span></td>
                                    <td>{s.category || humanize(s.formula_type)}</td>
                                    <td><StatusBadge status={s.status} /></td>
                                    <td style={{ ...muted, fontSize: 12 }}>{(s.updated_at || s.created_at || "").slice(0, 10) || "—"}</td>
                                    <td style={{ textAlign: "center", whiteSpace: "nowrap" }}>
                                        <span style={{ display: "inline-flex", gap: 6 }}>
                                            <button type="button" className="uidai-pmis-btn uidai-pmis-btn-cancel uidai-pmis-btn-small" onClick={() => openView(s.id)}>View</button>
                                            <button type="button" className="uidai-pmis-btn uidai-pmis-btn-cancel uidai-pmis-btn-small" onClick={() => openEdit(s.id)}>Edit</button>
                                            <button type="button" className="uidai-pm-icon-btn uidai-pm-icon-btn--danger" title="Delete" onClick={() => setPendingDelete({ id: s.id, ref: s.sla_ref })}>🗑</button>
                                        </span>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            </div>

            {/* ─── Onboard / Edit modal ─── */}
            <Modal
                open={formOpen}
                onClose={() => setFormOpen(false)}
                width={980}
                title={editingId ? `Edit SLA — ${form.sla_ref}` : "Onboard New SLA"}
                subtitle="Reusable SLA template — identification, definition, cadence, scoring bands and guards."
                footer={
                    <>
                        <button type="button" className="uidai-pmis-btn uidai-pmis-btn-cancel" onClick={() => setFormOpen(false)} disabled={saving}>Cancel</button>
                        <button type="button" className="uidai-pmis-btn" onClick={submitForm} disabled={saving}>{saving ? "Saving…" : (editingId ? "Save Changes" : "Onboard SLA")}</button>
                    </>
                }
            >
                <SubSection title="SLA Identification">
                    <div className="uidai-pmis-grid-4" style={{ gap: 14 }}>
                        <Field label="SLA Number" required><input style={inputStyle} value={form.sla_ref} disabled={!!editingId} onChange={(e) => setF({ sla_ref: e.target.value })} placeholder="PMU-SLA001" /></Field>
                        <Field label="Title" required><input style={inputStyle} value={form.title} onChange={(e) => setF({ title: e.target.value })} placeholder="Non-submission of deliverable" /></Field>
                        <Field label="Contract Type" required>
                            <select style={inputStyle} value={form.contract_type} disabled={!!editingId} onChange={(e) => setF({ contract_type: e.target.value })}>
                                {CONTRACT_TYPES.map((c) => <option key={c} value={c}>{c}</option>)}
                            </select>
                        </Field>
                        <Field label="Formula Type" required hint="Calculation engine">
                            <select style={inputStyle} value={form.formula_type} disabled={!!editingId} onChange={(e) => setF({ formula_type: e.target.value })}>
                                {FORMULA_TYPES.map((c) => <option key={c} value={c}>{humanize(c)}</option>)}
                            </select>
                        </Field>
                        <Field label="Category"><input style={inputStyle} value={form.category} onChange={(e) => setF({ category: e.target.value })} placeholder="Resource Management" /></Field>
                        <Field label="Status">
                            <select style={inputStyle} value={form.status} onChange={(e) => setF({ status: e.target.value })}>
                                {STATUS_OPTIONS.map((c) => <option key={c} value={c}>{c}</option>)}
                            </select>
                        </Field>
                    </div>
                </SubSection>

                <SubSection title="Definition & Scope">
                    <div style={{ display: "grid", gridTemplateColumns: "1fr", gap: 14 }}>
                        <Field label="Definition of SLA"><textarea style={{ ...inputStyle, height: 70, resize: "vertical" }} value={form.description} onChange={(e) => setF({ description: e.target.value })} placeholder="One-sentence summary of what this SLA covers." /></Field>
                        <Field label="Scope of SLA"><textarea style={{ ...inputStyle, height: 70, resize: "vertical" }} value={form.scope_text} onChange={(e) => setF({ scope_text: e.target.value })} placeholder="Who or what this SLA applies to." /></Field>
                    </div>
                </SubSection>

                <SubSection title="Source & Calculation">
                    <div className="uidai-pmis-grid-4" style={{ gap: 14 }}>
                        <Field label="Source of Data"><input style={inputStyle} value={form.data_source} onChange={(e) => setF({ data_source: e.target.value })} placeholder="Manual / system name" /></Field>
                        <Field label="Reports submitted to"><input style={inputStyle} value={form.reports_submitted_to} onChange={(e) => setF({ reports_submitted_to: e.target.value })} placeholder="TMD, UIDAI HO" /></Field>
                        <Field label="SLA Calculation" full><textarea style={{ ...inputStyle, height: 60, resize: "vertical" }} value={form.calculation_method} onChange={(e) => setF({ calculation_method: e.target.value })} placeholder="Plain-English description of how this SLA is computed." /></Field>
                    </div>
                </SubSection>

                <SubSection title="Cadence & Baseline">
                    <div className="uidai-pmis-grid-4" style={{ gap: 14 }}>
                        <Field label="Measurement Interval"><select style={inputStyle} value={form.measurement_interval} onChange={(e) => setF({ measurement_interval: e.target.value })}>{MEAS_INTERVALS.map((c) => <option key={c} value={c}>{c}</option>)}</select></Field>
                        <Field label="Reporting Interval"><select style={inputStyle} value={form.reporting_interval} onChange={(e) => setF({ reporting_interval: e.target.value })}>{REP_INTERVALS.map((c) => <option key={c} value={c}>{c}</option>)}</select></Field>
                        <Field label="Baseline Type"><select style={inputStyle} value={form.baseline_type} onChange={(e) => setF({ baseline_type: e.target.value })}>{BASELINE_TYPES.map((c) => <option key={c} value={c}>{c}</option>)}</select></Field>
                        <Field label="Compound Metric Rule"><select style={inputStyle} value={form.compound_metric_rule} onChange={(e) => setF({ compound_metric_rule: e.target.value })}>{COMPOUND_RULES.map((c) => <option key={c} value={c}>{c}</option>)}</select></Field>
                        <Field label="LD Aggregation"><select style={inputStyle} value={form.ld_aggregation_method} onChange={(e) => setF({ ld_aggregation_method: e.target.value })}>{LD_AGG_METHODS.map((c) => <option key={c} value={c}>{c}</option>)}</select></Field>
                        <Field label="Applied On (LD base)"><select style={inputStyle} value={form.ld_computation_base} onChange={(e) => setF({ ld_computation_base: e.target.value })}>{LD_BASES.map((c) => <option key={c} value={c}>{humanize(c)}</option>)}</select></Field>
                        <Field label="Active From" required><input style={inputStyle} type="date" value={form.effective_from} onChange={(e) => setF({ effective_from: e.target.value })} /></Field>
                        <Field label="Active Until"><input style={inputStyle} type="date" value={form.effective_until} onChange={(e) => setF({ effective_until: e.target.value })} /></Field>
                    </div>
                </SubSection>

                <SubSection title="Metrics"><ArrayEditor columns={METRIC_COLS} rows={metrics} onChange={setMetrics} addLabel="+ Add metric" /></SubSection>
                <SubSection title="Condition Bands (severity thresholds)"><ArrayEditor columns={BAND_COLS} rows={bands} onChange={setBands} addLabel="+ Add band" /></SubSection>
                <SubSection title="Lookup Table (linear escalation tiers)"><ArrayEditor columns={LOOKUP_COLS} rows={lookup} onChange={setLookup} addLabel="+ Add tier" /></SubSection>
                <SubSection title="Parameters"><ArrayEditor columns={PARAM_COLS} rows={parameters} onChange={setParameters} addLabel="+ Add parameter" /></SubSection>
                <SubSection title="Guard Conditions"><ArrayEditor columns={GUARD_COLS} rows={guards} onChange={setGuards} addLabel="+ Add guard" /></SubSection>

                {editingId && <div style={{ fontSize: 11.5, ...muted, marginTop: 12 }}>Note: edits PATCH the core fields. Metrics / bands / lookup / guards are shown for reference; the API updates them via the dedicated endpoints.</div>}
            </Modal>

            {/* ─── View modal ─── */}
            <Modal
                open={viewOpen}
                onClose={() => setViewOpen(false)}
                width={1000}
                title={viewData ? (viewData.title || viewData.name || viewData.sla_ref || "SLA") : "SLA Details"}
                subtitle={viewData ? `${viewData.sla_ref || ""}  ·  ${viewData.contract_type || ""}  ·  ${viewData.category || humanize(viewData.formula_type)}` : ""}
                footer={<button type="button" className="uidai-pmis-btn uidai-pmis-btn-cancel" onClick={() => setViewOpen(false)}>Close</button>}
            >
                {viewLoading ? (
                    <div style={{ padding: 22, textAlign: "center", ...muted, fontSize: 13 }}>Loading SLA details…</div>
                ) : viewData ? (
                    <ViewBody d={viewData} />
                ) : null}
            </Modal>

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

/* ─── View modal body — RFP-style 2-column table + sub-tables ─── */
function ViewRow({ label, value, mono }) {
    const empty = value === null || value === undefined || value === "";
    return (
        <tr>
            <th style={{ width: 210, background: "#f1f6fd", padding: "10px 12px", textAlign: "left", verticalAlign: "top", color: "#173e77", fontWeight: 700, fontSize: 12, textTransform: "uppercase", letterSpacing: ".3px" }}>{label}</th>
            <td style={{ padding: "10px 12px", verticalAlign: "top", lineHeight: 1.5, fontFamily: mono ? "monospace" : "inherit", fontSize: 13 }}>
                {empty ? <span style={{ ...muted, fontStyle: "italic" }}>—</span> : value}
            </td>
        </tr>
    );
}

function ViewSubTable({ title, columns, rows }) {
    if (!Array.isArray(rows) || rows.length === 0) return null;
    return (
        <div style={{ marginTop: 14 }}>
            <div style={{ fontWeight: 700, color: "#173e77", fontSize: 12.5, marginBottom: 6 }}>{title} <span style={{ ...muted, fontWeight: 400 }}>({rows.length})</span></div>
            <div className="uidai-pmis-table-wrap">
                <table className="uidai-pmis-table uidai-pmis-table-compact" style={{ marginTop: 0, minWidth: 0 }}>
                    <thead><tr>{columns.map((c) => <th key={c.key}>{c.label}</th>)}</tr></thead>
                    <tbody>
                        {rows.map((r, i) => (
                            <tr key={i}>{columns.map((c) => <td key={c.key}>{r[c.key] === null || r[c.key] === undefined || r[c.key] === "" ? "—" : (typeof r[c.key] === "boolean" ? (r[c.key] ? "✓" : "") : String(r[c.key]))}</td>)}</tr>
                        ))}
                    </tbody>
                </table>
            </div>
        </div>
    );
}

function ViewBody({ d }) {
    const category = d.category || humanize(d.formula_type);
    return (
        <div>
            <div className="uidai-pmis-table-wrap">
                <table className="uidai-pmis-table" style={{ minWidth: 0 }}>
                    <tbody>
                        <ViewRow label="SLA Number" value={d.sla_ref} mono />
                        <ViewRow label="Title" value={d.title || d.name} />
                        <ViewRow label="Category" value={category} />
                        <ViewRow label="Contract Type" value={d.contract_type} />
                        <ViewRow label="Formula Type" value={humanize(d.formula_type)} />
                        <ViewRow label="Definition" value={d.description} />
                        <ViewRow label="Scope" value={d.scope_text} />
                        <ViewRow label="Source of Data" value={d.data_source} />
                        <ViewRow label="SLA Calculation" value={d.calculation_method} />
                        <ViewRow label="Measurement Interval" value={d.measurement_interval} />
                        <ViewRow label="Reporting Interval" value={d.reporting_interval} />
                        <ViewRow label="Baseline Type" value={humanize(d.baseline_type)} />
                        <ViewRow label="LD Aggregation" value={d.ld_aggregation_method} />
                        <ViewRow label="Applied On" value={humanize(d.ld_computation_base)} />
                        <ViewRow label="Reports submitted to" value={d.reports_submitted_to} />
                        <ViewRow label="Active From" value={(d.effective_from || "").slice(0, 10)} />
                        <ViewRow label="Active Until" value={d.effective_until ? d.effective_until.slice(0, 10) : null} />
                        <ViewRow label="Status" value={<StatusBadge status={d.status} />} />
                    </tbody>
                </table>
            </div>

            <ViewSubTable title="Metrics" columns={[{ key: "metric_key", label: "Key" }, { key: "display_name", label: "Display name" }, { key: "unit", label: "Unit" }, { key: "direction", label: "Direction" }, { key: "is_primary", label: "Primary" }]} rows={d.metrics} />
            <ViewSubTable title="Condition Bands" columns={[{ key: "sort_order", label: "Order" }, { key: "band_label", label: "Label" }, { key: "metric_key", label: "Metric" }, { key: "range_min", label: "From" }, { key: "range_max", label: "To" }, { key: "severity_level", label: "Severity" }, { key: "rate_percent", label: "Rate %" }, { key: "points_contribution", label: "Points" }]} rows={d.condition_bands || d.bands} />
            <ViewSubTable title="Lookup Table" columns={[{ key: "sort_order", label: "Order" }, { key: "lookup_key", label: "Tier" }, { key: "lookup_value", label: "LD %" }]} rows={d.lookup_table || d.lookup_rows} />
            <ViewSubTable title="Parameters" columns={[{ key: "param_key", label: "Key" }, { key: "param_value", label: "Value" }]} rows={d.parameters} />
            <ViewSubTable title="Guard Conditions" columns={[{ key: "metric_key", label: "Metric" }, { key: "operator", label: "Op" }, { key: "threshold_value", label: "Threshold" }, { key: "action", label: "Action" }, { key: "action_description", label: "Description" }]} rows={d.guard_conditions || d.guards} />
        </div>
    );
}