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
    const activityLabel=searchParams.get("activityCode") || searchParams.get("activityName") || activityIdInput;

    // ---- API configuration ----
    const [baseUrl, setBaseUrl] = useState("http://10.1.131.199/contracts");

    // ---- Two-view flow: the mapping screen (default) and the SLA picker. ----
    const [view, setView] = useState("mapping"); // "mapping" | "picker"
    // Picker search combobox open state, and whether the mapping (effective
    // dates) editor is expanded in the SLA Details panel.
    const [pickerOpen, setPickerOpen] = useState(false);
    const [showMappingEdit, setShowMappingEdit] = useState(false);

    // ---- SLA masters list (loaded once, searched/filtered client-side) ----
    const [slaList, setSlaList] = useState([]);
    const [slaTotal, setSlaTotal] = useState(0);
    // Load a large page so the picker's typeahead can search across (nearly)
    // all masters without a backend search param or pagination.
    const [pageSize] = useState(200);
    const [listLoading, setListLoading] = useState(false);
    const [listError, setListError] = useState("");
    // Client-side filters + free-text search over the loaded SLA masters.
    const [slaFilters, setSlaFilters] = useState({ contract_type: "", formula_type: "", status: "" });
    const [slaSearch, setSlaSearch] = useState("");

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
        loadSlaMasters();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    // Prefill the Activity ID from the ?activityId=… the launching page passes
    // (e.g. an activity's node modal) and auto-load its mappings, so the user
    // arrives on the mapping screen ready to work instead of re-typing the id.
    useEffect(() => {
        const fromQuery = searchParams.get("activityId");
        if (!fromQuery) return;
        setActivityIdInput(fromQuery);
        loadMappings(fromQuery);
        setView("mapping");
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
    async function loadSlaMasters() {
        setListLoading(true);
        setListError("");
        try {
            const res = await authorizedFetch(
                `${baseUrl}/api/v3/sla-masters?offset=1&pageSize=${pageSize}`,
                { method: "GET", headers: { Accept: "application/json" } }
            );
            const payload = await readJson(res);
            setSlaList(extractElements(payload));
            setSlaTotal(payload?.data?.total ?? 0);
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
            // Return to the main page (Activity SLA Mappings) after mapping.
            setShowMappingEdit(false);
            setView("mapping");
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

    // Filter options are derived from whatever SLA masters are loaded, so they
    // always reflect the real data without a separate metadata call.
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

    // Picker results: filters + free-text typeahead over ref/title/contract/formula.
    const pickerResults = useMemo(() => {
        const q = slaSearch.trim().toLowerCase();
        if (!q) return filteredSlaList;
        return filteredSlaList.filter((s) =>
            [s.sla_ref, s.title, s.contract_type, s.formula_type]
                .some((v) => String(v || "").toLowerCase().includes(q))
        );
    }, [filteredSlaList, slaSearch]);

    const filterFieldLabel = { fontSize: 12, fontWeight: 600, color: "var(--uidai-pmis-muted)", marginBottom: 6 };

    function openPicker() {
        setCreateMessage("");
        setShowMappingEdit(false);
        setView("picker");
    }
    function backToMapping() { setView("mapping"); }

    // Pick an SLA from the search dropdown: load its details, reflect the
    // choice in the search box, and close the dropdown.
    function pickSla(s) {
        setSlaSearch(s.title || s.sla_ref || "");
        setPickerOpen(false);
        selectSla(s.id);
    }

    return (
        <div className="uidai-pmis-content">
            {/* Header */}
            <div className="uidai-pmis-title">SLA → Activity Mapping &amp; Evaluation</div>
            <div className="uidai-pmis-subtitle" style={{ marginTop: -10 }}>
                {view === "picker"
                    ? "Search the SLA library, view an SLA, then map it to this activity."
                    : "Review the SLAs mapped to this activity, map new ones, and evaluate."}
            </div>

            {/* PICKER — find & view an SLA (filters + typeahead search) */}
            {view === "picker" && (
            <div className="uidai-pmis-card">
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 12, marginBottom: 8 }}>
                    <div style={{ ...sectionHead, marginBottom: 0 }}>Select an SLA</div>
                    <button type="button" className="uidai-pmis-filter-toggle" onClick={backToMapping}>← Back to mapping</button>
                </div>
                {listError && <Banner text={listError} />}

                {/* Filters */}
                <div className="uidai-pmis-filter-shell">
                    <div className="uidai-pmis-filter-head">
                        <div className="uidai-pmis-filter-title">Filters</div>
                        {(filtersActive || slaSearch) && (
                            <button type="button" className="uidai-pmis-filter-toggle"
                                onClick={() => { setSlaFilters({ contract_type: "", formula_type: "", status: "" }); setSlaSearch(""); }}>
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

                {/* Search combobox — matches appear in a dropdown (filtered by the above) */}
                <div style={{ marginTop: 16, maxWidth: 560 }}>
                    <label style={{ fontWeight: 600, display: "block", marginBottom: 8 }}>Search SLA</label>
                    <div style={{ position: "relative" }}>
                        <input
                            className="uidai-pmis-filter-input"
                            type="text"
                            placeholder="Type to search by ref, title, contract, formula…"
                            value={slaSearch}
                            onChange={(e) => { setSlaSearch(e.target.value); setPickerOpen(true); }}
                            onFocus={() => setPickerOpen(true)}
                            onBlur={() => setTimeout(() => setPickerOpen(false), 150)}
                        />
                        {pickerOpen && (
                            <div style={{
                                position: "absolute", top: "calc(100% + 4px)", left: 0, right: 0, zIndex: 30,
                                background: "#fff", border: "1px solid var(--uidai-pmis-border)", borderRadius: 8,
                                boxShadow: "var(--uidai-pmis-shadow, 0 4px 12px rgba(0,0,0,.08))",
                                maxHeight: 280, overflowY: "auto",
                            }}>
                                {listLoading ? (
                                    <div style={{ padding: 12, ...muted, fontSize: 13 }}>Loading SLAs…</div>
                                ) : pickerResults.length === 0 ? (
                                    <div style={{ padding: 12, ...muted, fontSize: 13 }}>
                                        {slaList.length === 0 ? "No SLA masters found." : "No SLAs match your search / filters."}
                                    </div>
                                ) : pickerResults.slice(0, 50).map((s) => (
                                    <button
                                        key={s.id}
                                        type="button"
                                        // onMouseDown fires before the input's onBlur so the click still registers.
                                        onMouseDown={() => pickSla(s)}
                                        style={{
                                            display: "block", width: "100%", textAlign: "left", border: "none",
                                            borderBottom: "1px solid #eef3f9", background: s.id === selectedSlaId ? "#eef6ff" : "#fff",
                                            padding: "10px 12px", cursor: "pointer", font: "inherit",
                                        }}
                                    >
                                        <div style={{ fontWeight: 700, color: "#173e77", fontSize: 13 }}>{s.title || s.sla_ref || "—"}</div>
                                        <div style={{ ...muted, fontSize: 11, marginTop: 2 }}>
                                            <span style={{ fontFamily: "monospace" }}>{s.sla_ref || "—"}</span>
                                            {s.contract_type ? ` · ${s.contract_type}` : ""}{s.formula_type ? ` · ${s.formula_type}` : ""}
                                        </div>
                                    </button>
                                ))}
                            </div>
                        )}
                    </div>
                    <div style={{ fontSize: 12, ...muted, marginTop: 8 }}>
                        {pickerResults.length} match{pickerResults.length === 1 ? "" : "es"}{slaTotal > slaList.length ? ` · searching first ${slaList.length} of ${slaTotal}` : ""}
                    </div>
                </div>
            </div>
            )}

            {/* PICKER — selected SLA details + "Map this SLA" action */}
            {view === "picker" && selectedSlaId && (
            <div className="uidai-pmis-card">
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 12, marginBottom: 12 }}>
                    <div style={{ fontSize: 15, fontWeight: 800, color: "#173e77" }}>SLA Details</div>
                    <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                        <button type="button" className="uidai-pmis-btn uidai-pmis-btn-cancel uidai-pmis-btn-small" style={{ marginTop: 0 }} onClick={() => setShowMappingEdit((v) => !v)}>
                            {showMappingEdit ? "Hide mapping fields" : "✎ Edit mapping"}
                        </button>
                        <button type="button" className="uidai-pmis-btn uidai-pmis-btn-small" style={{ marginTop: 0 }} onClick={createMapping} disabled={createLoading || detailLoading || !slaDetail}>
                            {createLoading ? "Mapping…" : "Map this SLA →"}
                        </button>
                    </div>
                </div>

                {/* Map SLA to Activity — the activity mapping (activity + effective window)
                    that gets POSTed. "Edit mapping" reveals the editable fields; the rest
                    of the SLA fields would go under overrides (not built yet). */}
                <div className="uidai-pmis-filter-shell" style={{ marginBottom: 14 }}>
                    <div style={{ fontSize: 13, fontWeight: 700, color: "#173e77", marginBottom: showMappingEdit ? 12 : 0 }}>
                        Map SLA to Activity
                        <span style={{ ...muted, fontWeight: 400, marginLeft: 8 }}>
                            activity <code style={{ background: "#f1f6fd", padding: "2px 8px", borderRadius: 6, color: "#173e77", fontWeight: 700 }}>{activityLabel}</code>
                            {!showMappingEdit && ` · ${effFrom} → ${effUntil}`}
                        </span>
                    </div>
                    {showMappingEdit && (
                        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 16 }}>
                            <div className="uidai-pmis-field" style={{ marginBottom: 0 }}>
                                <label>Activity ID</label>
                                <input type="text" value={activityLabel} readOnly style={{background:"#f1f6fd"}}
                                // onChange={(e) => setActivityIdInput(e.target.value)} 
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
                        </div>
                    )}
                </div>
                {createMessage && <Banner text={createMessage} />}
                {detailError && <Banner text={detailError} />}
                {detailLoading ? (
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
            )}

            {/* MAPPING — activity's current SLA mappings */}
            {view === "mapping" && (
            <div className="uidai-pmis-card">
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 12, marginBottom: 8 }}>
                    <div style={{ ...sectionHead, marginBottom: 0 }}>Activity SLA Mappings</div>
                    <div style={{ display: "flex", gap: 14, alignItems: "center" }}>
                        <label style={{ fontSize: 13, color: "var(--uidai-pmis-text)", display: "flex", alignItems: "center", gap: 6, fontWeight: 600 }}>
                            <input type="checkbox" style={{ width: "auto" }} checked={activeOnly} onChange={(e) => setActiveOnly(e.target.checked)} /> Active only
                        </label>
                        <button type="button" className="uidai-pmis-btn uidai-pmis-btn-cancel uidai-pmis-btn-small" style={{ marginTop: 0 }} onClick={loadMappings} disabled={mappingsLoading}>
                            {mappingsLoading ? "Loading…" : "↻ Reload"}
                        </button>
                        <button type="button" className="uidai-pmis-btn uidai-pmis-btn-small" style={{ marginTop: 0 }} onClick={openPicker}>
                            + Map SLA
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
                                <tr><td colSpan={7} style={{ textAlign: "center", padding: 28, ...muted }}>
                                    <div style={{ marginBottom: 10 }}>No mapped SLA — please map SLA.</div>
                                    <button type="button" className="uidai-pmis-btn uidai-pmis-btn-small" style={{ marginTop: 0 }} onClick={openPicker}>+ Map SLA</button>
                                </td></tr>
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
            </div>
            )}

            {/* MAPPING — evaluation, two panels side by side */}
            {view === "mapping" && (
            <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) minmax(0, 1fr)", gap: 22, alignItems: "start" }}>
                {/* Single-mapping evaluate */}
                <div className="uidai-pmis-card" style={{ marginBottom: 0, minWidth: 0 }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, marginBottom: 12 }}>
                        <div style={{ ...sectionHead, marginBottom: 0 }}>Evaluate a Mapping</div>
                        {singleEval && <button type="button" className="uidai-pmis-filter-toggle" onClick={closeSingleEval}>✕ Close</button>}
                    </div>
                    {!singleEval ? (
                        <div style={{ padding: 18, textAlign: "center", ...muted, fontSize: 12 }}>Click “Evaluate” on a mapping above to evaluate a single SLA.</div>
                    ) : (
                        <>
                            <div style={{ fontSize: 13, fontWeight: 700, color: "#173e77", marginBottom: 10 }}>
                                {singleEval.slaTitle || "Mapping"}
                                <span style={{ ...muted, fontWeight: 400, fontFamily: "monospace", fontSize: 11, marginLeft: 8 }}>{singleEval.slaRef}</span>
                            </div>
                            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 16 }}>
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
                        </>
                    )}
                </div>

                {/* Whole-activity evaluate */}
                <div className="uidai-pmis-card" style={{ marginBottom: 0, minWidth: 0 }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 12 }}>
                        <div style={{ ...sectionHead, marginBottom: 0 }}>Evaluate Whole Activity</div>
                        {!actEval ? (
                            <button type="button" className="uidai-pmis-btn uidai-pmis-btn-small" style={{ marginTop: 0 }} onClick={openActivityEval} disabled={actEvalBuilding}>
                                {actEvalBuilding ? "Preparing…" : "Configure & Evaluate"}
                            </button>
                        ) : (
                            <button type="button" className="uidai-pmis-filter-toggle" onClick={closeActivityEval}>✕ Close</button>
                        )}
                    </div>
                    <div style={{ fontSize: 12, ...muted, marginTop: 8 ,padding: 11}}>
                        Evaluates every active SLA mapping on activity{" "}
                        <code style={{ background: "#f1f6fd", padding: "2px 8px", borderRadius: 6, color: "#173e77", fontWeight: 700 }}>{activityLabel}</code>.
                    </div>
                    {actEvalError && <Banner text={actEvalError} />}

                    {actEval && (
                        <div style={{ marginTop: 14 }}>
                            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
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
            )}

        </div>
    );
}