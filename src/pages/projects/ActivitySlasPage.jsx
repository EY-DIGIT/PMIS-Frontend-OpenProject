import React, { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { authorizedFetch } from "../../api/client";
import "../../styles/global.css";

const STATUS_OPTIONS = ["ACTIVE", "RETIRED"];
const SHAPE_OPTIONS = ["SINGLE_VALUE", "DAILY_VALUES", "BAND_COUNTS", "WAC_BREAKDOWN"];

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

function parseJsonSafe(text, fallback) {
    if (!text || !text.trim()) return fallback;
    try { return JSON.parse(text); } catch { return fallback; }
}

// Turn one editor row into the API observation object based on its `shape`.
function buildObservation(o) {
    const obs = { metric_key: o.metric_key, shape: o.shape };
    if (o.shape === "SINGLE_VALUE") obs.single_value = Number(o.single_value) || 0;
    else if (o.shape === "DAILY_VALUES") obs.daily_values = parseJsonSafe(o.raw, []);
    else if (o.shape === "BAND_COUNTS") obs.band_counts = parseJsonSafe(o.raw, {});
    else if (o.shape === "WAC_BREAKDOWN") obs.wac_breakdown = parseJsonSafe(o.raw, {});
    return obs;
}

// Small inline input/select styling for controls that live OUTSIDE a
// .uidai-pmis-field wrapper (tables, observation editors).
const ctrl = {
    width: "100%",
    padding: "8px 10px",
    border: "1px solid var(--uidai-pmis-border)",
    borderRadius: 6,
    background: "#fff",
    color: "var(--uidai-pmis-text)",
    font: "inherit",
    fontSize: 13,
    boxSizing: "border-box",
};

function StatusBadge({ status }) {
    const s = (status || "").toUpperCase();
    const cls =
        s === "RETIRED" ? "uidai-pmis-badge-red" :
            s === "ACTIVE" ? "uidai-pmis-badge-green" :
                "uidai-pmis-badge-orange";
    return <span className={`uidai-pmis-badge ${cls}`}>{status || "—"}</span>;
}

// Generic, theme-aware viewer for an evaluate response of unknown exact shape.
// Scalars render as a labelled grid; nested objects/arrays drop into a
// collapsible raw-JSON block so nothing is ever hidden.
function ResultView({ data }) {
    if (data === null || data === undefined) return null;
    const obj = (data && typeof data === "object" && !Array.isArray(data)) ? data : { result: data };
    const scalars = Object.entries(obj).filter(([, v]) => v === null || typeof v !== "object");
    const nested = Object.entries(obj).filter(([, v]) => v !== null && typeof v === "object");
    return (
        <div style={{ marginTop: 10 }}>
            {scalars.length > 0 && (
                <div className="uidai-pmis-grid-4" style={{ gap: 14 }}>
                    {scalars.map(([k, v]) => (
                        <div key={k}>
                            <div style={{ fontSize: 12, color: "var(--uidai-pmis-muted)", fontWeight: 600, marginBottom: 4 }}>{k}</div>
                            <div style={{ fontSize: 14, fontWeight: 700, color: "#173e77", wordBreak: "break-word" }}>{String(v ?? "—")}</div>
                        </div>
                    ))}
                </div>
            )}
            {nested.map(([k, v]) => (
                <details key={k} style={{ marginTop: 10 }}>
                    <summary style={{ cursor: "pointer", fontSize: 13, fontWeight: 700, color: "var(--uidai-pmis-navy)" }}>{k}</summary>
                    <pre style={{
                        background: "#f6f9fd", border: "1px solid var(--uidai-pmis-border)", borderRadius: 8,
                        padding: 12, fontSize: 12, overflowX: "auto", marginTop: 6,
                    }}>{JSON.stringify(v, null, 2)}</pre>
                </details>
            ))}
        </div>
    );
}

// Reusable metric-observation editor (used by both evaluate flows).
function ObservationEditor({ observations, onChange }) {
    const update = (i, patch) => onChange(observations.map((o, idx) => (idx === i ? { ...o, ...patch } : o)));
    const add = () => onChange([...observations, { metric_key: "", shape: "SINGLE_VALUE", single_value: "", raw: "" }]);
    const remove = (i) => onChange(observations.filter((_, idx) => idx !== i));

    return (
        <div>
            {observations.length === 0 && (
                <div style={{ fontSize: 12, color: "var(--uidai-pmis-muted)", fontStyle: "italic", marginBottom: 8 }}>
                    No metric observations — add one.
                </div>
            )}
            {observations.map((o, i) => (
                <div key={i} style={{ display: "grid", gridTemplateColumns: "1.3fr 1fr 1.2fr auto", gap: 8, marginBottom: 8, alignItems: "start" }}>
                    <input
                        style={ctrl}
                        placeholder="metric_key"
                        value={o.metric_key}
                        onChange={(e) => update(i, { metric_key: e.target.value })}
                    />
                    <select style={ctrl} value={o.shape} onChange={(e) => update(i, { shape: e.target.value })}>
                        {SHAPE_OPTIONS.map((s) => <option key={s} value={s}>{s}</option>)}
                    </select>
                    {o.shape === "SINGLE_VALUE" ? (
                        <input
                            style={ctrl}
                            type="number"
                            placeholder="single_value"
                            value={o.single_value}
                            onChange={(e) => update(i, { single_value: e.target.value })}
                        />
                    ) : (
                        <input
                            style={{ ...ctrl, fontFamily: "monospace" }}
                            placeholder={o.shape === "DAILY_VALUES" ? "[1, 2, 3]" : '{"key": 0}'}
                            value={o.raw}
                            onChange={(e) => update(i, { raw: e.target.value })}
                        />
                    )}
                    <button type="button" className="uidai-pm-icon-btn uidai-pm-icon-btn--danger" title="Remove" onClick={() => remove(i)}>✕</button>
                </div>
            ))}
            <button type="button" className="uidai-pmis-btn uidai-pmis-btn-cancel uidai-pmis-btn-small" onClick={add}>
                + Add observation
            </button>
        </div>
    );
}

export default function ActivitySlasPage() {
    // Prefill the Activity ID when we're launched from an activity's node modal
    // (it navigates here with ?activityId=…), so the user lands ready to map.
    const [searchParams] = useSearchParams();

    // ---- API configuration ----
    const [baseUrl, setBaseUrl] = useState("http://10.1.131.199/contracts");

    // ---- Step 1: SLA masters list ----
    const [slaList, setSlaList] = useState([]);
    const [slaTotal, setSlaTotal] = useState(0);
    const [offset, setOffset] = useState(1);
    const [pageSize] = useState(20);
    const [listLoading, setListLoading] = useState(false);
    const [listError, setListError] = useState("");
    // Client-side filters over the loaded SLA masters page.
    const [slaFilters, setSlaFilters] = useState({ contract_type: "", formula_type: "", status: "" });

    // ---- Step 2: single SLA detail ----
    const [selectedSlaId, setSelectedSlaId] = useState("");
    const [slaDetail, setSlaDetail] = useState(null);
    const [detailLoading, setDetailLoading] = useState(false);
    const [detailError, setDetailError] = useState("");

    // ---- Step 3: create mapping ----
    const [activityIdInput, setActivityIdInput] = useState(() => searchParams.get("activityId") || "");
    const [effFrom, setEffFrom] = useState(today());
    const [effUntil, setEffUntil] = useState(today());
    const [createLoading, setCreateLoading] = useState(false);
    const [createMessage, setCreateMessage] = useState("");

    // ---- Step 4: activity mappings + edit ----
    const [mappings, setMappings] = useState([]);
    const [activeOnly, setActiveOnly] = useState(true);
    const [mappingsLoading, setMappingsLoading] = useState(false);
    const [mappingsError, setMappingsError] = useState("");
    const [editingId, setEditingId] = useState("");
    const [editForm, setEditForm] = useState({ status: "ACTIVE", effective_until: "" });
    const [editLoading, setEditLoading] = useState(false);
    const [editMessage, setEditMessage] = useState("");

    // ---- Step 5a: single-mapping evaluate ----
    const [singleEval, setSingleEval] = useState(null); // { mappingId, slaRef, slaTitle, period_start, period_end, ld_base_amount, observations, loadingMetrics }
    const [singleEvalLoading, setSingleEvalLoading] = useState(false);
    const [singleEvalResult, setSingleEvalResult] = useState(null);
    const [singleEvalError, setSingleEvalError] = useState("");

    // ---- Step 5b: activity-wide evaluate ----
    const [actEval, setActEval] = useState(null); // { period_start, period_end, groups: [{ sla_ref, sla_id, sla_title, ld_base_amount, observations }] }
    const [actEvalBuilding, setActEvalBuilding] = useState(false);
    const [actEvalLoading, setActEvalLoading] = useState(false);
    const [actEvalResult, setActEvalResult] = useState(null);
    const [actEvalError, setActEvalError] = useState("");

    useEffect(() => {
        loadSlaMasters(1);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    // Prefill the Activity ID from the ?activityId=… the launching page passes
    // (e.g. an activity's node modal) and auto-load its mappings, so the user
    // arrives ready to work instead of re-typing the id. Re-runs if the param
    // changes; ignores plain visits that carry no activityId.
    useEffect(() => {
        const fromQuery = searchParams.get("activityId");
        if (!fromQuery) return;
        setActivityIdInput(fromQuery);
        loadMappings(fromQuery);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [searchParams]);

    // Shared response/error unwrapper.
    async function readJson(res) {
        const payload = await res.json().catch(() => null);
        if (!res.ok) throw new Error(payload?.error?.message || payload?.message || `Request failed (${res.status})`);
        return payload;
    }

    // Fetch a single SLA's metric_keys (used to prefill observation editors).
    async function fetchSlaMetrics(slaId) {
        try {
            const res = await authorizedFetch(`${baseUrl}/api/v3/sla-masters/${encodeURIComponent(slaId)}`, {
                method: "GET", headers: { Accept: "application/json" },
            });
            const payload = await readJson(res);
            const metrics = payload?.data?.metrics || [];
            return metrics.map((m) => m.metric_key).filter(Boolean);
        } catch {
            return [];
        }
    }

    function blankObservations(metricKeys) {
        if (!metricKeys.length) return [{ metric_key: "", shape: "SINGLE_VALUE", single_value: "", raw: "" }];
        return metricKeys.map((k) => ({ metric_key: k, shape: "SINGLE_VALUE", single_value: "", raw: "" }));
    }

    // ---------------------------------------------------------------------------
    // Step 1 — GET /api/v3/sla-masters
    // ---------------------------------------------------------------------------
    async function loadSlaMasters(nextOffset = offset) {
        setListLoading(true);
        setListError("");
        try {
            const res = await authorizedFetch(
                `${baseUrl}/api/v3/sla-masters?offset=${nextOffset}&pageSize=${pageSize}`,
                { method: "GET", headers: { Accept: "application/json" } }
            );
            const payload = await readJson(res);
            setSlaList(extractElements(payload));
            setSlaTotal(payload?.data?.total ?? 0);
            setOffset(nextOffset);
        } catch (err) {
            setListError(err?.message || "Failed to load SLA masters");
            setSlaList([]);
        } finally {
            setListLoading(false);
        }
    }

    // ---------------------------------------------------------------------------
    // Step 2 — GET /api/v3/sla-masters/{slaId}
    // ---------------------------------------------------------------------------
    async function selectSla(slaId) {
        setSelectedSlaId(slaId);
        setSlaDetail(null);
        setDetailError("");
        setDetailLoading(true);
        try {
            const res = await authorizedFetch(
                `${baseUrl}/api/v3/sla-masters/${encodeURIComponent(slaId)}`,
                { method: "GET", headers: { Accept: "application/json" } }
            );
            const payload = await readJson(res);
            setSlaDetail(payload?.data || payload);
        } catch (err) {
            setDetailError(err?.message || "Failed to load SLA details");
        } finally {
            setDetailLoading(false);
        }
    }

    // ---------------------------------------------------------------------------
    // Step 3 — POST /api/v3/sla-activity-mappings
    // ---------------------------------------------------------------------------
    async function createMapping() {
        if (!selectedSlaId) { setCreateMessage("Select an SLA first (Step 1)."); return; }
        if (!activityIdInput.trim()) { setCreateMessage("Enter an Activity ID."); return; }
        setCreateLoading(true);
        setCreateMessage("");
        try {
            const body = {
                activity_id: activityIdInput.trim(),
                sla_id: selectedSlaId,
                effective_from: effFrom,
                effective_until: effUntil,
                overrides: {},
            };
            const res = await authorizedFetch(`${baseUrl}/api/v3/sla-activity-mappings`, {
                method: "POST",
                headers: { "Content-Type": "application/json", Accept: "application/json" },
                body: JSON.stringify(body),
            });
            await readJson(res);
            setCreateMessage("SLA mapped to activity successfully.");
            loadMappings();
        } catch (err) {
            setCreateMessage(err?.message || "Failed to create mapping");
        } finally {
            setCreateLoading(false);
        }
    }

    // ---------------------------------------------------------------------------
    // Step 4a — GET /api/v3/activities/{activityId}/sla-mappings
    // ---------------------------------------------------------------------------
    async function loadMappings(idArg) {
        // Allow an explicit id (used by the prefill effect) — otherwise fall back
        // to the input. Guard against an event object sneaking in via onClick.
        const activityId = (typeof idArg === "string" ? idArg : activityIdInput).trim();
        if (!activityId) { setMappingsError("Enter an Activity ID to load its mappings."); return; }
        setMappingsLoading(true);
        setMappingsError("");
        try {
            const res = await authorizedFetch(
                `${baseUrl}/api/v3/activities/${encodeURIComponent(activityId)}/sla-mappings?active_only=${activeOnly}`,
                { method: "GET", headers: { Accept: "application/json" } }
            );
            const payload = await readJson(res);
            setMappings(extractElements(payload));
        } catch (err) {
            setMappingsError(err?.message || "Failed to load mappings");
            setMappings([]);
        } finally {
            setMappingsLoading(false);
        }
    }

    // ---------------------------------------------------------------------------
    // Step 4b — PATCH /api/v3/sla-activity-mappings/{mappingId}
    // ---------------------------------------------------------------------------
    function startEdit(m) {
        setEditingId(m.id);
        setEditMessage("");
        setEditForm({ status: m.status || "ACTIVE", effective_until: m.effective_until || "" });
    }
    function cancelEdit() { setEditingId(""); setEditMessage(""); }

    async function saveEdit(mappingId) {
        setEditLoading(true);
        setEditMessage("");
        try {
            // overrides intentionally omitted for now — backend support is pending.
            const body = { status: editForm.status, effective_until: editForm.effective_until || null };
            const res = await authorizedFetch(
                `${baseUrl}/api/v3/sla-activity-mappings/${encodeURIComponent(mappingId)}`,
                { method: "PATCH", headers: { "Content-Type": "application/json", Accept: "application/json" }, body: JSON.stringify(body) }
            );
            await readJson(res);
            setEditMessage("Mapping updated successfully.");
            setEditingId("");
            loadMappings();
        } catch (err) {
            setEditMessage(err?.message || "Failed to update mapping");
        } finally {
            setEditLoading(false);
        }
    }

    // ---------------------------------------------------------------------------
    // Step 5a — POST /api/v3/sla-activity-mappings/{mappingId}/evaluate
    // ---------------------------------------------------------------------------
    async function openSingleEval(m) {
        setSingleEvalResult(null);
        setSingleEvalError("");
        setSingleEval({
            mappingId: m.id, slaRef: m.sla_ref, slaTitle: m.sla_title,
            period_start: today(), period_end: today(), ld_base_amount: "",
            observations: [], loadingMetrics: true,
        });
        const keys = await fetchSlaMetrics(m.sla_id);
        setSingleEval((s) => (s && s.mappingId === m.id ? { ...s, observations: blankObservations(keys), loadingMetrics: false } : s));
    }
    function closeSingleEval() { setSingleEval(null); setSingleEvalResult(null); setSingleEvalError(""); }

    async function submitSingleEval() {
        if (!singleEval) return;
        setSingleEvalLoading(true);
        setSingleEvalError("");
        setSingleEvalResult(null);
        try {
            const body = {
                period_start: singleEval.period_start,
                period_end: singleEval.period_end,
                ld_base_amount: Number(singleEval.ld_base_amount) || 0,
                metric_observations: singleEval.observations.map(buildObservation),
            };
            const res = await authorizedFetch(
                `${baseUrl}/api/v3/sla-activity-mappings/${encodeURIComponent(singleEval.mappingId)}/evaluate`,
                { method: "POST", headers: { "Content-Type": "application/json", Accept: "application/json" }, body: JSON.stringify(body) }
            );
            const payload = await readJson(res);
            setSingleEvalResult(payload?.data ?? payload);
        } catch (err) {
            setSingleEvalError(err?.message || "Evaluation failed");
        } finally {
            setSingleEvalLoading(false);
        }
    }

    // ---------------------------------------------------------------------------
    // Step 5b — POST /api/v3/activities/{activityId}/evaluate
    // ---------------------------------------------------------------------------
    async function openActivityEval() {
        setActEvalResult(null);
        setActEvalError("");
        if (!mappings.length) { setActEvalError("Load this activity's mappings first (Step 4)."); return; }
        setActEvalBuilding(true);
        try {
            // One group per unique sla_ref among the loaded (active) mappings.
            const byRef = new Map();
            for (const m of mappings) {
                if (!m.sla_ref || byRef.has(m.sla_ref)) continue;
                byRef.set(m.sla_ref, m);
            }
            const groups = [];
            for (const [ref, m] of byRef) {
                const keys = await fetchSlaMetrics(m.sla_id);
                groups.push({
                    sla_ref: ref, sla_id: m.sla_id, sla_title: m.sla_title,
                    ld_base_amount: "", observations: blankObservations(keys),
                });
            }
            setActEval({ period_start: today(), period_end: today(), groups });
        } finally {
            setActEvalBuilding(false);
        }
    }
    function closeActivityEval() { setActEval(null); setActEvalResult(null); setActEvalError(""); }

    async function submitActivityEval() {
        if (!actEval) return;
        setActEvalLoading(true);
        setActEvalError("");
        setActEvalResult(null);
        try {
            const ld_base_amount_overrides = {};
            const observations_by_sla_ref = {};
            for (const g of actEval.groups) {
                if (g.ld_base_amount !== "" && g.ld_base_amount !== null) {
                    ld_base_amount_overrides[g.sla_ref] = Number(g.ld_base_amount) || 0;
                }
                observations_by_sla_ref[g.sla_ref] = g.observations.map(buildObservation);
            }
            const body = {
                period_start: actEval.period_start,
                period_end: actEval.period_end,
                ld_base_amount_overrides,
                observations_by_sla_ref,
            };
            const res = await authorizedFetch(
                `${baseUrl}/api/v3/activities/${encodeURIComponent(activityIdInput.trim())}/evaluate`,
                { method: "POST", headers: { "Content-Type": "application/json", Accept: "application/json" }, body: JSON.stringify(body) }
            );
            const payload = await readJson(res);
            setActEvalResult(payload?.data ?? payload);
        } catch (err) {
            setActEvalError(err?.message || "Activity evaluation failed");
        } finally {
            setActEvalLoading(false);
        }
    }

    // ---------------------------------------------------------------------------
    // Local style helpers
    // ---------------------------------------------------------------------------
    const stepBadge = {
        display: "inline-flex", alignItems: "center", justifyContent: "center",
        width: 24, height: 24, borderRadius: "50%",
        background: "linear-gradient(135deg, var(--uidai-pmis-navy), var(--uidai-pmis-cyan))",
        color: "#fff", fontSize: 13, fontWeight: 800, marginRight: 10, flex: "0 0 auto",
    };
    const sectionHead = { display: "flex", alignItems: "center", marginBottom: 16, fontSize: 16, fontWeight: 800, color: "#173e77" };
    const muted = { color: "var(--uidai-pmis-muted)" };

    function Banner({ text }) {
        if (!text) return null;
        const bad = /fail|error|select|enter|first/i.test(text);
        return (
            <div className={`uidai-pmis-badge ${bad ? "uidai-pmis-badge-red" : "uidai-pmis-badge-green"}`}
                style={{ display: "block", borderRadius: 8, padding: "10px 12px", marginTop: 12, fontWeight: 600, whiteSpace: "pre-line" }}>
                {text}
            </div>
        );
    }

    function NestedTable({ title, rows }) {
        if (!Array.isArray(rows) || rows.length === 0) return null;
        const cols = Object.keys(rows[0]).filter((k) => k !== "sla_id" && k !== "id" && k !== "created_at");
        return (
            <div style={{ marginTop: 16 }}>
                <div style={{ fontSize: 13, fontWeight: 700, color: "#173e77", marginBottom: 8 }}>
                    {title} <span style={{ ...muted, fontWeight: 400 }}>({rows.length})</span>
                </div>
                <div className="uidai-pmis-table-wrap">
                    <table className="uidai-pmis-table uidai-pmis-table-compact" style={{ marginTop: 0, minWidth: 0 }}>
                        <thead>
                            <tr>{cols.map((c) => <th key={c}>{c}</th>)}</tr>
                        </thead>
                        <tbody>
                            {rows.map((r, i) => (
                                <tr key={r.id || i}>
                                    {cols.map((c) => (
                                        <td key={c}>{typeof r[c] === "object" ? JSON.stringify(r[c]) : String(r[c] ?? "—")}</td>
                                    ))}
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            </div>
        );
    }

    const totalPages = Math.max(1, Math.ceil(slaTotal / pageSize));
    const currentPage = Math.floor((offset - 1) / pageSize) + 1;

    // Filter options are derived from whatever SLA page is currently loaded, so
    // they always reflect the real data without a separate metadata call.
    const filterOptions = useMemo(() => {
        const uniq = (key) => Array.from(new Set(slaList.map((s) => s[key]).filter(Boolean))).sort();
        return { contract: uniq("contract_type"), formula: uniq("formula_type"), status: uniq("status") };
    }, [slaList]);

    const filtersActive = !!(slaFilters.contract_type || slaFilters.formula_type || slaFilters.status);

    const filteredSlaList = useMemo(() => slaList.filter((s) =>
        (!slaFilters.contract_type || s.contract_type === slaFilters.contract_type) &&
        (!slaFilters.formula_type || s.formula_type === slaFilters.formula_type) &&
        (!slaFilters.status || s.status === slaFilters.status)
    ), [slaList, slaFilters]);

    const filterFieldLabel = { fontSize: 12, fontWeight: 600, color: "var(--uidai-pmis-muted)", marginBottom: 6 };

    return (
        <div className="uidai-pmis-content">
            {/* Header */}
            <div className="uidai-pmis-title">SLA → Activity Mapping &amp; Evaluation</div>
            <div className="uidai-pmis-subtitle" style={{ marginTop: -10 }}>
                Browse SLA masters, inspect one, map it to an activity, edit the mapping, and evaluate SLAs.
            </div>


            {/* STEP 1 — SLA masters list */}
            <div className="uidai-pmis-card">
                <div style={sectionHead}><span style={stepBadge}>1</span> All SLA Masters</div>
                {listError && <Banner text={listError} />}

                {/* Filters — contract type / formula / status, applied to the loaded page */}
                <div className="uidai-pmis-filter-shell">
                    <div className="uidai-pmis-filter-head">
                        <div className="uidai-pmis-filter-title">Filters</div>
                        {filtersActive && (
                            <button type="button" className="uidai-pmis-filter-toggle"
                                onClick={() => setSlaFilters({ contract_type: "", formula_type: "", status: "" })}>
                                ✕ Clear
                            </button>
                        )}
                    </div>
                    <div className="uidai-pmis-filter-body">
                        <div>
                            <div style={filterFieldLabel}>Contract Type</div>
                            <select className="uidai-pmis-filter-select" value={slaFilters.contract_type}
                                onChange={(e) => setSlaFilters((f) => ({ ...f, contract_type: e.target.value }))}>
                                <option value="">All</option>
                                {filterOptions.contract.map((c) => <option key={c} value={c}>{c}</option>)}
                            </select>
                        </div>
                        <div>
                            <div style={filterFieldLabel}>Formula</div>
                            <select className="uidai-pmis-filter-select" value={slaFilters.formula_type}
                                onChange={(e) => setSlaFilters((f) => ({ ...f, formula_type: e.target.value }))}>
                                <option value="">All</option>
                                {filterOptions.formula.map((c) => <option key={c} value={c}>{c}</option>)}
                            </select>
                        </div>
                        <div>
                            <div style={filterFieldLabel}>Status</div>
                            <select className="uidai-pmis-filter-select" value={slaFilters.status}
                                onChange={(e) => setSlaFilters((f) => ({ ...f, status: e.target.value }))}>
                                <option value="">All</option>
                                {filterOptions.status.map((c) => <option key={c} value={c}>{c}</option>)}
                            </select>
                        </div>
                    </div>
                </div>

                <div className="uidai-pmis-table-wrap">
                    <table className="uidai-pmis-table">
                        <thead>
                            <tr>
                                <th>SLA Ref</th><th>Title</th><th>Contract</th><th>Formula</th><th>Status</th><th>Effective From</th><th style={{ textAlign: "center" }}>Action</th>
                            </tr>
                        </thead>
                        <tbody>
                            {listLoading ? (
                                <tr><td colSpan={7} style={{ textAlign: "center", padding: 28, ...muted }}>Loading SLAs…</td></tr>
                            ) : filteredSlaList.length === 0 ? (
                                <tr><td colSpan={7} style={{ textAlign: "center", padding: 28, ...muted }}>
                                    {slaList.length === 0 ? "No SLA masters found." : "No SLAs match the selected filters."}
                                </td></tr>
                            ) : filteredSlaList.map((s) => (
                                <tr key={s.id} style={{ background: s.id === selectedSlaId ? "#eef6ff" : undefined }}>
                                    <td style={{ fontFamily: "monospace", fontSize: 11, ...muted, maxWidth: 220, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{s.sla_ref || "—"}</td>
                                    <td>{s.title || "—"}</td>
                                    <td>{s.contract_type || "—"}</td>
                                    <td>{s.formula_type || "—"}</td>
                                    <td><StatusBadge status={s.status} /></td>
                                    <td>{s.effective_from || "—"}</td>
                                    <td style={{ textAlign: "center" }}>
                                        <button type="button" className="uidai-pmis-btn uidai-pmis-btn-small" style={{ marginTop: 0 }} onClick={() => selectSla(s.id)}>
                                            {s.id === selectedSlaId ? "Selected ✓" : "Select"}
                                        </button>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 14 }}>
                    <span style={{ fontSize: 12, ...muted }}>
                        {filtersActive ? `Showing ${filteredSlaList.length} of ${slaList.length} on this page · ` : ""}
                        Total: {slaTotal} · Page {currentPage} / {totalPages}
                    </span>
                    <div style={{ display: "flex", gap: 8 }}>
                        <button type="button" className="uidai-pmis-btn uidai-pmis-btn-cancel uidai-pmis-btn-small" disabled={offset <= 1 || listLoading} onClick={() => loadSlaMasters(Math.max(1, offset - pageSize))}>‹ Prev</button>
                        <button type="button" className="uidai-pmis-btn uidai-pmis-btn-cancel uidai-pmis-btn-small" disabled={currentPage >= totalPages || listLoading} onClick={() => loadSlaMasters(offset + pageSize)}>Next ›</button>
                    </div>
                </div>
            </div>

            {/* STEP 2 — SLA detail */}
            <div className="uidai-pmis-card">
                <div style={sectionHead}><span style={stepBadge}>2</span> SLA Details</div>
                {detailError && <Banner text={detailError} />}
                {!selectedSlaId ? (
                    <div style={{ padding: 22, textAlign: "center", ...muted, fontSize: 13 }}>Select an SLA in Step 1 to view its full details.</div>
                ) : detailLoading ? (
                    <div style={{ padding: 22, textAlign: "center", ...muted, fontSize: 13 }}>Loading SLA details…</div>
                ) : slaDetail ? (
                    <div>
                        <div className="uidai-pmis-grid-4" style={{ gap: 16 }}>
                            {[
                                ["SLA Ref", slaDetail.sla_ref], ["Title", slaDetail.title], ["Description", slaDetail.description],
                                ["Contract Type", slaDetail.contract_type], ["Formula Type", slaDetail.formula_type], ["Measurement", slaDetail.measurement_interval],
                                ["Reporting", slaDetail.reporting_interval], ["Baseline", slaDetail.baseline_type], ["LD Aggregation", slaDetail.ld_aggregation_method],
                                ["LD Base", slaDetail.ld_computation_base], ["Status", slaDetail.status], ["Effective", `${slaDetail.effective_from || "—"} → ${slaDetail.effective_until || "—"}`],
                            ].map(([k, v]) => (
                                <div key={k}>
                                    <div style={{ ...muted, fontWeight: 600, marginBottom: 4, fontSize: 12 }}>{k}</div>
                                    <div style={{ color: "#173e77", fontWeight: 700, wordBreak: "break-word", fontSize: 13 }}>{v || "—"}</div>
                                </div>
                            ))}
                        </div>
                        <NestedTable title="Metrics" rows={slaDetail.metrics} />
                        <NestedTable title="Condition Bands" rows={slaDetail.condition_bands} />
                        <NestedTable title="Parameters" rows={slaDetail.parameters} />
                        <NestedTable title="Guard Conditions" rows={slaDetail.guard_conditions} />
                        <NestedTable title="Lookup Table" rows={slaDetail.lookup_table} />
                    </div>
                ) : null}
            </div>

            {/* STEP 3 — Map to activity */}
            <div className="uidai-pmis-card">
                <div style={sectionHead}><span style={stepBadge}>3</span> Map SLA to Activity</div>
                <div style={{ display: "grid", gridTemplateColumns: "1.4fr 1fr 1fr auto", gap: 16, alignItems: "end" }}>
                    <div className="uidai-pmis-field" style={{ marginBottom: 0 }}>
                        <label>Activity ID</label>
                        <input

                            type="text" placeholder="e.g. A1.1"
                            value={activityIdInput}
                            onChange={(e) => setActivityIdInput(e.target.value)}
                            style={activityIdInput ? { background: "#f1f6fd", color: "" } : undefined}

                        />

                    </div>
                    <div className="uidai-pmis-field" style={{ marginBottom: 0 }}>
                        <label>Effective From</label>
                        <input type="date" value={effFrom} onChange={(e) => setEffFrom(e.target.value)} />
                    </div>
                    <div className="uidai-pmis-field" style={{ marginBottom: 0 }}>
                        <label>Effective Until</label>
                        <input type="date" value={effUntil} onChange={(e) => setEffUntil(e.target.value)} />
                    </div>
                    <button type="button" className="uidai-pmis-btn" style={{ marginTop: 0, whiteSpace: "nowrap" }} onClick={createMapping} disabled={createLoading}>
                        {createLoading ? "Mapping…" : "+ Create Mapping"}
                    </button>
                </div>
                <div style={{ fontSize: 12, ...muted, marginTop: 12 }}>
                    Selected SLA:{" "}
                    {selectedSlaId
                        ? <code style={{ background: "#f1f6fd", padding: "2px 8px", borderRadius: 6, color: "#173e77", fontWeight: 700 }}>{selectedSlaId}</code>
                        : <span style={{ color: "var(--uidai-pmis-red)" }}>none — pick one in Step 1</span>}
                </div>
                <Banner text={createMessage} />
            </div>

            {/* STEP 4 — Mappings + edit */}
            <div className="uidai-pmis-card">
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 12, marginBottom: 8 }}>
                    <div style={{ ...sectionHead, marginBottom: 0 }}><span style={stepBadge}>4</span> Activity SLA Mappings</div>
                    <div style={{ display: "flex", gap: 14, alignItems: "center" }}>
                        <label style={{ fontSize: 13, color: "var(--uidai-pmis-text)", display: "flex", alignItems: "center", gap: 6, fontWeight: 600 }}>
                            <input type="checkbox" style={{ width: "auto" }} checked={activeOnly} onChange={(e) => setActiveOnly(e.target.checked)} /> Active only
                        </label>
                        <button type="button" className="uidai-pmis-btn uidai-pmis-btn-small" style={{ marginTop: 0 }} onClick={loadMappings} disabled={mappingsLoading}>
                            {mappingsLoading ? "Loading…" : "Load Mappings"}
                        </button>
                    </div>
                </div>
                {mappingsError && <Banner text={mappingsError} />}
                {editMessage && <Banner text={editMessage} />}
                <div className="uidai-pmis-table-wrap">
                    <table className="uidai-pmis-table">
                        <thead>
                            <tr>
                                <th>SLA Ref</th><th>SLA Title</th><th>Contract</th><th>Status</th><th>Effective From</th><th>Effective Until</th><th style={{ textAlign: "center" }}>Actions</th>
                            </tr>
                        </thead>
                        <tbody>
                            {mappingsLoading ? (
                                <tr><td colSpan={7} style={{ textAlign: "center", padding: 28, ...muted }}>Loading mappings…</td></tr>
                            ) : mappings.length === 0 ? (
                                <tr><td colSpan={7} style={{ textAlign: "center", padding: 28, ...muted }}>No mappings — enter an Activity ID and click “Load Mappings”.</td></tr>
                            ) : mappings.map((m) => {
                                const isEditing = editingId === m.id;
                                return (
                                    <tr key={m.id} style={{ background: isEditing ? "#fff8ec" : undefined }}>
                                        <td style={{ fontFamily: "monospace", fontSize: 11, ...muted, maxWidth: 200, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{m.sla_ref || "—"}</td>
                                        <td>{m.sla_title || "—"}</td>
                                        <td>{m.contract_type || "—"}</td>
                                        <td>
                                            {isEditing ? (
                                                <select style={ctrl} value={editForm.status} onChange={(e) => setEditForm((f) => ({ ...f, status: e.target.value }))}>
                                                    {STATUS_OPTIONS.map((o) => <option key={o} value={o}>{o}</option>)}
                                                </select>
                                            ) : <StatusBadge status={m.status} />}
                                        </td>
                                        <td>{m.effective_from || "—"}</td>
                                        <td>
                                            {isEditing ? (
                                                <input type="date" style={ctrl} value={editForm.effective_until || ""} onChange={(e) => setEditForm((f) => ({ ...f, effective_until: e.target.value }))} />
                                            ) : (m.effective_until || "—")}
                                        </td>
                                        <td style={{ textAlign: "center", whiteSpace: "nowrap" }}>
                                            {isEditing ? (
                                                <span style={{ display: "inline-flex", gap: 6 }}>
                                                    <button type="button" className="uidai-pmis-btn uidai-pmis-btn-small" style={{ marginTop: 0 }} onClick={() => saveEdit(m.id)} disabled={editLoading}>{editLoading ? "Saving…" : "Save"}</button>
                                                    <button type="button" className="uidai-pmis-btn uidai-pmis-btn-cancel uidai-pmis-btn-small" onClick={cancelEdit} disabled={editLoading}>Cancel</button>
                                                </span>
                                            ) : (
                                                <span style={{ display: "inline-flex", gap: 6 }}>
                                                    <button type="button" className="uidai-pmis-btn uidai-pmis-btn-cancel uidai-pmis-btn-small" onClick={() => startEdit(m)}>Edit</button>
                                                    <button type="button" className="uidai-pmis-btn uidai-pmis-btn-small" style={{ marginTop: 0 }} onClick={() => openSingleEval(m)}>Evaluate</button>
                                                </span>
                                            )}
                                        </td>
                                    </tr>
                                );
                            })}
                        </tbody>
                    </table>
                </div>

                {/* Single-mapping evaluate panel */}
                {singleEval && (
                    <div className="uidai-pmis-filter-shell" style={{ marginTop: 16 }}>
                        <div className="uidai-pmis-filter-head">
                            <div className="uidai-pmis-filter-title">
                                Evaluate Mapping
                                {singleEval.slaTitle ? ` · ${singleEval.slaTitle}` : ""}
                                <span style={{ ...muted, fontWeight: 400, fontFamily: "monospace", fontSize: 11, marginLeft: 8 }}>{singleEval.slaRef}</span>
                            </div>
                            <button type="button" className="uidai-pmis-filter-toggle" onClick={closeSingleEval}>✕ Close</button>
                        </div>

                        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 16, marginTop: 12 }}>
                            <div className="uidai-pmis-field" style={{ marginBottom: 0 }}>
                                <label>Period Start</label>
                                <input type="date" value={singleEval.period_start} onChange={(e) => setSingleEval((s) => ({ ...s, period_start: e.target.value }))} />
                            </div>
                            <div className="uidai-pmis-field" style={{ marginBottom: 0 }}>
                                <label>Period End</label>
                                <input type="date" value={singleEval.period_end} onChange={(e) => setSingleEval((s) => ({ ...s, period_end: e.target.value }))} />
                            </div>
                            <div className="uidai-pmis-field" style={{ marginBottom: 0 }}>
                                <label>LD Base Amount</label>
                                <input type="number" value={singleEval.ld_base_amount} onChange={(e) => setSingleEval((s) => ({ ...s, ld_base_amount: e.target.value }))} />
                            </div>
                        </div>

                        <div style={{ marginTop: 14 }}>
                            <div style={{ fontSize: 13, fontWeight: 700, color: "#173e77", marginBottom: 8 }}>
                                Metric Observations {singleEval.loadingMetrics && <span style={{ ...muted, fontWeight: 400 }}>(loading metric keys…)</span>}
                            </div>
                            <ObservationEditor
                                observations={singleEval.observations}
                                onChange={(obs) => setSingleEval((s) => ({ ...s, observations: obs }))}
                            />
                        </div>

                        <div style={{ marginTop: 14 }}>
                            <button type="button" className="uidai-pmis-btn" style={{ marginTop: 0 }} onClick={submitSingleEval} disabled={singleEvalLoading}>
                                {singleEvalLoading ? "Evaluating…" : "⚡ Run Evaluation"}
                            </button>
                        </div>
                        {singleEvalError && <Banner text={singleEvalError} />}
                        {singleEvalResult !== null && (
                            <div className="uidai-pmis-card" style={{ marginTop: 14, marginBottom: 0, boxShadow: "var(--uidai-pmis-shadow-soft)" }}>
                                <div style={{ fontSize: 14, fontWeight: 800, color: "#173e77" }}>Evaluation Result</div>
                                <ResultView data={singleEvalResult} />
                            </div>
                        )}
                    </div>
                )}
            </div>

            {/* STEP 5 — Activity-wide evaluate */}
            <div className="uidai-pmis-card">
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 12 }}>
                    <div style={{ ...sectionHead, marginBottom: 0 }}><span style={stepBadge}>5</span> Evaluate Whole Activity</div>
                    {!actEval ? (
                        <button type="button" className="uidai-pmis-btn uidai-pmis-btn-small" style={{ marginTop: 0 }} onClick={openActivityEval} disabled={actEvalBuilding}>
                            {actEvalBuilding ? "Preparing…" : "Configure & Evaluate"}
                        </button>
                    ) : (
                        <button type="button" className="uidai-pmis-filter-toggle" onClick={closeActivityEval}>✕ Close</button>
                    )}
                </div>
                <div style={{ fontSize: 12, ...muted, marginTop: 8 }}>
                    Evaluates every active SLA mapping on activity{" "}
                    <code style={{ background: "#f1f6fd", padding: "2px 8px", borderRadius: 6, color: "#173e77", fontWeight: 700 }}>{activityIdInput || "—"}</code>.
                    Uses the mappings currently loaded in Step 4.
                </div>
                {actEvalError && <Banner text={actEvalError} />}

                {actEval && (
                    <div style={{ marginTop: 14 }}>
                        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, maxWidth: 520 }}>
                            <div className="uidai-pmis-field" style={{ marginBottom: 0 }}>
                                <label>Period Start</label>
                                <input type="date" value={actEval.period_start} onChange={(e) => setActEval((a) => ({ ...a, period_start: e.target.value }))} />
                            </div>
                            <div className="uidai-pmis-field" style={{ marginBottom: 0 }}>
                                <label>Period End</label>
                                <input type="date" value={actEval.period_end} onChange={(e) => setActEval((a) => ({ ...a, period_end: e.target.value }))} />
                            </div>
                        </div>

                        {actEval.groups.map((g, gi) => (
                            <div key={g.sla_ref} className="uidai-pmis-filter-shell" style={{ marginTop: 14 }}>
                                <div className="uidai-pmis-filter-head">
                                    <div className="uidai-pmis-filter-title">
                                        {g.sla_title || "SLA"}
                                        <span style={{ ...muted, fontWeight: 400, fontFamily: "monospace", fontSize: 11, marginLeft: 8 }}>{g.sla_ref}</span>
                                    </div>
                                    <div className="uidai-pmis-field" style={{ marginBottom: 0, display: "flex", alignItems: "center", gap: 8 }}>
                                        <label style={{ marginBottom: 0, whiteSpace: "nowrap", fontSize: 12 }}>LD Base Override</label>
                                        <input
                                            type="number" style={{ width: 140 }} placeholder="(optional)" value={g.ld_base_amount}
                                            onChange={(e) => setActEval((a) => ({ ...a, groups: a.groups.map((x, i) => i === gi ? { ...x, ld_base_amount: e.target.value } : x) }))}
                                        />
                                    </div>
                                </div>
                                <div style={{ marginTop: 12 }}>
                                    <ObservationEditor
                                        observations={g.observations}
                                        onChange={(obs) => setActEval((a) => ({ ...a, groups: a.groups.map((x, i) => i === gi ? { ...x, observations: obs } : x) }))}
                                    />
                                </div>
                            </div>
                        ))}

                        <div style={{ marginTop: 14 }}>
                            <button type="button" className="uidai-pmis-btn" style={{ marginTop: 0 }} onClick={submitActivityEval} disabled={actEvalLoading}>
                                {actEvalLoading ? "Evaluating…" : "⚡ Evaluate All Active SLAs"}
                            </button>
                        </div>
                    </div>
                )}

                {actEvalResult !== null && (
                    <div className="uidai-pmis-card" style={{ marginTop: 14, marginBottom: 0, boxShadow: "var(--uidai-pmis-shadow-soft)" }}>
                        <div style={{ fontSize: 14, fontWeight: 800, color: "#173e77" }}>Activity Evaluation Result</div>
                        <ResultView data={actEvalResult} />
                    </div>
                )}
            </div>
        </div>
    );
}