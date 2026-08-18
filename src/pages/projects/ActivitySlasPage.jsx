import React, { useEffect, useMemo, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { authorizedFetch } from "../../api/client";
import { loadProjectTree } from "../../api/milestoneConfigApi";
import { uiStore } from "../../store/project/uiStore";
import ActivityCompliancePanel from "../../components/projects/sla/ActivityCompliancePanel";
import ResourceObservationPanel from "../../components/projects/sla/ResourceObservationPanel";
import "../../styles/global.css";

const STATUS_OPTIONS = ["ACTIVE", "RETIRED"];

function today() {
    return new Date().toISOString().slice(0, 10);
}

// "2026-07-28" → "Q3 2026". LD is settled per calendar quarter, so an
// evaluation is easier to place when the quarter is spelled out next to
// the date it starts in.
function quarterLabel(iso) {
    if (!iso || iso.length < 7) return "";
    const y = Number(iso.slice(0, 4));
    const m = Number(iso.slice(5, 7));
    if (!y || !m) return "";
    return `Q${Math.floor((m - 1) / 3) + 1} ${y}`;
}

// Whether a mapping actually bites today. Status alone doesn't say it — an
// ACTIVE mapping can still be out of its effective window, which is the thing
// the reader is really working out from the two date columns.
function forceState(m) {
    const t = today();
    if (String(m?.status || "").toUpperCase() === "RETIRED") return { label: "Retired", tone: "muted" };
    const from = m?.effective_from || "";
    const until = m?.effective_until || "";
    if (from && from > t) return { label: `From ${from}`, tone: "muted" };
    if (until && until < t) return { label: "Expired", tone: "bad" };
    if (until) {
        const days = Math.round((new Date(`${until}T00:00:00`) - new Date(`${t}T00:00:00`)) / 86400000);
        if (Number.isFinite(days) && days <= 30) return { label: `Ends in ${days}d`, tone: "warn" };
    }
    return { label: "In force", tone: "ok" };
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

// ---------------------------------------------------------------------------
// Human-readable labels for raw API enum values (e.g. "band_accumulation",
// "point_accumulation", "calendar_days"). Add the exact display text you want
// for each raw value here — anything not listed falls back to a generic
// snake_case / kebab-case → "Title Case" conversion.
//
// >>> FILL ME IN <<< : map each raw API value to its confirmed label, e.g.
//   band_accumulation: "Band Accumulation",
//   point_accumulation: "Point Accumulation",
// ---------------------------------------------------------------------------
const VALUE_LABELS = {
    // raw_value: "Display Text",
};

// Convert a raw enum-ish value to readable text (via VALUE_LABELS or fallback).
function humanize(value) {
    if (value === null || value === undefined || value === "") return "—";
    const key = String(value);
    if (Object.prototype.hasOwnProperty.call(VALUE_LABELS, key)) return VALUE_LABELS[key];
    return key.replace(/[_-]+/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

// True for snake_case-looking values that are safe to humanize (avoids
// mangling UUIDs, dates, refs, numbers).
function looksEnum(v) {
    return typeof v === "string" && /^[a-z0-9]+(_[a-z0-9]+)+$/.test(v);
}

// Render any cell/scalar: humanize enum-looking strings, pass the rest through.
function maybeHumanize(v) {
    if (v === null || v === undefined || v === "") return "—";
    if (looksEnum(v)) return humanize(v);
    return String(v);
}

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
                            <div style={{ fontSize: 14, fontWeight: 700, color: "#173e77", wordBreak: "break-word" }}>{maybeHumanize(v)}</div>
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

// ---------------------------------------------------------------------------
// Demo SLA "screenshot" — a lightweight inline SVG that resembles a table so
// the image-card grid has something to show until real screenshots are wired
// in. Replace by setting `image_url` (or `screenshot_url`) on the SLA record;
// the card uses that when present and falls back to this generated demo.
// ---------------------------------------------------------------------------
function demoTableImage(s) {
    const esc = (t) => String(t || "").replace(/[<>&]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;" }[c])).slice(0, 30);
    const ref = esc(s.sla_ref || "SLA");
    const title = esc(s.title || "SLA definition");
    const ct = esc(s.contract_type || "");
    const rows = [
        ["Formula", esc(humanize(s.formula_type))],
        ["Measurement", esc(s.measurement_interval || "—")],
        ["Reporting", esc(s.reporting_interval || "—")],
        ["Status", esc(s.status || "ACTIVE")],
    ];
    const rowSvg = rows.map((r, i) => {
        const y = 96 + i * 22;
        const bg = i % 2 === 0 ? "#f6f9fd" : "#ffffff";
        return `<rect x='10' y='${y - 14}' width='300' height='20' fill='${bg}'/>`
            + `<text x='18' y='${y}' fill='#5a6680' font-family='Arial' font-size='10'>${r[0]}</text>`
            + `<text x='150' y='${y}' fill='#173e77' font-family='Arial' font-size='10' font-weight='700'>${r[1]}</text>`;
    }).join("");
    const svg = `<svg xmlns='http://www.w3.org/2000/svg' width='320' height='200' viewBox='0 0 320 200'>`
        + `<rect width='320' height='200' fill='#ffffff'/>`
        + `<rect x='0' y='0' width='320' height='32' fill='#0b3c88'/>`
        + `<rect x='0' y='32' width='320' height='3' fill='#19b6c9'/>`
        + `<text x='12' y='21' fill='#ffffff' font-family='Arial' font-size='12' font-weight='700'>${ref}</text>`
        + `<text x='310' y='20' fill='#bcdcff' font-family='Arial' font-size='10' text-anchor='end'>${ct}</text>`
        + `<text x='12' y='56' fill='#173e77' font-family='Arial' font-size='12' font-weight='700'>${title}</text>`
        + `<rect x='10' y='68' width='300' height='1' fill='#dbe5f1'/>`
        + rowSvg
        + `<rect x='0.5' y='0.5' width='319' height='199' fill='none' stroke='#dbe5f1'/>`
        + `</svg>`;
    return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}

// ---------------------------------------------------------------------------
// SLA image card — the card IS a screenshot of the SLA table. Hovering scales
// it up (transform only → no reflow; it floats over neighbours), clicking
// opens the details side-panel. A thin caption keeps look-alike demos
// identifiable. The real screenshot comes from the SLA's first image
// attachment (attachments[].file_url); otherwise a themed demo is generated.
// ---------------------------------------------------------------------------

// Resolve the screenshot URL for an SLA master: prefer an explicit
// image_url/screenshot_url, then the first image attachment's file_url.
// Returns null when nothing real is available (caller falls back to the demo).
function slaImageUrl(s) {
    if (!s) return null;
    if (s.image_url) return s.image_url;
    if (s.screenshot_url) return s.screenshot_url;
    const atts = Array.isArray(s.attachments) ? s.attachments : [];
    const img = atts.find((a) => String(a?.mime_type || "").startsWith("image/")) || atts[0];
    return img?.file_url || null;
}

function SlaCard({ sla, selected, mapped, onPick }) {
    const [hover, setHover] = useState(false);
    const real = slaImageUrl(sla);
    const fallback = demoTableImage(sla);
    const src = real || fallback;
    return (
        <div
            role="button"
            tabIndex={0}
            title={sla.title || sla.sla_ref || "SLA"}
            onClick={onPick}
            onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onPick(); } }}
            onMouseEnter={() => setHover(true)}
            onMouseLeave={() => setHover(false)}
            onFocus={() => setHover(true)}
            onBlur={() => setHover(false)}
            style={{ position: "relative", cursor: "pointer", borderRadius: 10, zIndex: hover ? 5 : 1 }}
        >
            {selected && (
                <div style={{ position: "absolute", top: 6, right: 6, zIndex: 3, background: "#2f6fb0", color: "#fff", borderRadius: 999, width: 22, height: 22, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 12, fontWeight: 800, boxShadow: "0 2px 6px rgba(0,0,0,.28)" }}>✓</div>
            )}
            <div
                style={{
                    border: selected ? "2px solid #2f6fb0" : "1px solid var(--uidai-pmis-border)",
                    borderRadius: 10, overflow: "hidden", background: selected ? "#eef4ff" : "#fff",
                    boxShadow: hover
                        ? "0 14px 30px rgba(11,60,136,.22)"
                        : (selected ? "0 0 0 3px rgba(47,111,176,.30), inset 0 2px 8px rgba(11,60,136,.16)" : "0 1px 3px rgba(11,60,136,.06)"),
                    transform: hover ? "translateY(-3px) scale(1.03)" : (selected ? "scale(0.97)" : "none"),
                    transformOrigin: "center",
                    transition: "transform .16s ease, box-shadow .16s ease, border-color .16s ease",
                }}
            >
                <img
                    src={src}
                    alt={sla.title || sla.sla_ref || "SLA"}
                    loading="lazy"
                    onError={(e) => { if (real && e.currentTarget.src !== fallback) e.currentTarget.src = fallback; }}
                    style={{ display: "block", width: "100%", aspectRatio: "16 / 10", objectFit: "cover", objectPosition: "top" }}
                />
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, padding: "6px 9px", borderTop: "1px solid var(--uidai-pmis-border)", background: "#fbfdff" }}>
                    <span style={{ fontFamily: "monospace", fontSize: 10.5, color: "var(--uidai-pmis-muted)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{sla.sla_ref || "—"}</span>
                    {mapped
                        ? <span style={{ fontSize: 10.5, fontWeight: 600, color: "#1f4e87", whiteSpace: "nowrap" }}>mapped</span>
                        : <StatusBadge status={sla.status} />}
                </div>
            </div>
        </div>
    );
}

// Sortable column header for the mappings table.
function SortTh({ label, col, sort, onSort }) {
    const active = sort.key === col;
    return (
        <th aria-sort={active ? (sort.dir === 1 ? "ascending" : "descending") : "none"}>
            <button
                type="button"
                onClick={() => onSort(col)}
                style={{
                    border: "none", background: "none", font: "inherit", color: "inherit",
                    cursor: "pointer", padding: 0, display: "inline-flex", alignItems: "center", gap: 4,
                }}
            >
                {label}
                <span aria-hidden="true" style={{ opacity: active ? 0.75 : 0.25, fontSize: 10 }}>
                    {active && sort.dir === -1 ? "▼" : "▲"}
                </span>
            </button>
        </th>
    );
}

// Whether a mapping bites today — derived from status + the effective window.
function InForce({ state }) {
    const colour = { ok: "#1f8a4c", warn: "#c77700", bad: "#c0392b", muted: "var(--uidai-pmis-muted)" }[state.tone];
    return <span style={{ fontSize: 12, fontWeight: state.tone === "muted" ? 400 : 600, color: colour, whiteSpace: "nowrap" }}>{state.label}</span>;
}

// Collapsible section for the SLA Details panel. Controlled internally so the
// caret can rotate; `defaultOpen` decides the initial state.
function Accordion({ title, badge, defaultOpen = false, children }) {
    const [open, setOpen] = useState(!!defaultOpen);
    return (
        <div style={{ border: "1px solid var(--uidai-pmis-border)", borderRadius: 10, marginTop: 12, background: "#fff", overflow: "hidden" }}>
            <button
                type="button"
                onClick={() => setOpen((o) => !o)}
                style={{
                    width: "100%", textAlign: "left", border: "none", background: open ? "#eef4ff" : "#f6f9fd",
                    padding: "11px 14px", display: "flex", alignItems: "center", gap: 10, cursor: "pointer", font: "inherit",
                }}
            >
                <span style={{ transition: "transform .15s ease", transform: open ? "rotate(90deg)" : "none", color: "var(--uidai-pmis-muted)", fontSize: 11 }}>▶</span>
                <span style={{ fontWeight: 800, color: "#173e77", fontSize: 13.5 }}>{title}</span>
                {badge != null && (
                    <span style={{ marginLeft: 8, background: "#dceafe", color: "#1f4e87", borderRadius: 999, padding: "1px 8px", fontSize: 11, fontWeight: 800 }}>{badge}</span>
                )}
            </button>
            {open && <div style={{ padding: 14 }}>{children}</div>}
        </div>
    );
}

// Label/value grid used inside the detail accordions. `[label, value]` pairs;
// entries with an undefined value are dropped.
function DetailGrid({ fields }) {
    const shown = fields.filter(([, v]) => v !== undefined);
    if (shown.length === 0) return null;
    return (
        <div className="uidai-pmis-grid-4" style={{ gap: 16, gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))" }}>
            {shown.map(([k, v]) => (
                <div key={k}>
                    <div style={{ color: "var(--uidai-pmis-muted)", fontWeight: 600, marginBottom: 4, fontSize: 12 }}>{k}</div>
                    <div style={{ color: "#173e77", fontWeight: 700, wordBreak: "break-word", fontSize: 13 }}>
                        {v === null || v === undefined || v === "" ? "—" : v}
                    </div>
                </div>
            ))}
        </div>
    );
}

// ---------------------------------------------------------------------------
// RFP-style SLA detail — mirrors the "View" card from SLA Master.html: a flat
// 2-column table showing only the contract-document fields, plus the Target
// (severity thresholds) sub-table built from condition_bands / lookup_table.
// ---------------------------------------------------------------------------

// Friendly label for the LD computation base ("Applied On" row).
const APPLIED_ON_LABEL = {
    QUARTERLY_PAYMENT: "Net Planned Quarterly Payment (PQP)",
    ANNUAL_PAYMENT: "Annual Contract Value",
    FIXED_AMOUNT: "Deliverable Cost (set per mapping)",
};

// One label/value row in the RFP detail table.
function RfpRow({ label, value, mono }) {
    const empty = value === null || value === undefined || value === "";
    return (
        <tr>
            <th style={{ width: 170, background: "#f1f6fd", padding: "10px 12px", textAlign: "left", verticalAlign: "top", color: "#173e77", fontWeight: 700, fontSize: 11.5, textTransform: "uppercase", letterSpacing: ".3px" }}>{label}</th>
            <td style={{ padding: "10px 12px", verticalAlign: "top", lineHeight: 1.5, fontSize: 13, fontFamily: mono ? "monospace" : "inherit", color: "var(--uidai-pmis-text)" }}>
                {empty ? <span style={{ color: "var(--uidai-pmis-muted)", fontStyle: "italic" }}>—</span> : value}
            </td>
        </tr>
    );
}

// Plain-English threshold derived from a band's range bounds (RFP wording).
function bandThreshold(b) {
    const unit = b.range_unit || "";
    const lo = b.range_min, hi = b.range_max;
    if (lo == null && hi != null) return `≤ ${hi} ${unit}`.trim();
    if (lo != null && hi == null) return `> ${lo} ${unit}`.trim();
    if (lo != null && hi != null) return `${lo}${unit ? " " + unit : ""} < x ≤ ${hi}${unit ? " " + unit : ""}`;
    return "—";
}

// Target (severity thresholds) table — bands (severity/rate/points) + lookup tiers.
function TargetTable({ bands, lookup }) {
    const b = (Array.isArray(bands) ? bands : []).slice().sort((a, z) => (a.sort_order || 0) - (z.sort_order || 0));
    const l = (Array.isArray(lookup) ? lookup : []).slice().sort((a, z) => (a.sort_order || 0) - (z.sort_order || 0));
    if (!b.length && !l.length) {
        return <span style={{ color: "var(--uidai-pmis-muted)", fontStyle: "italic", fontSize: 12.5 }}>No target table defined.</span>;
    }
    return (
        <div className="uidai-pmis-table-wrap" style={{ marginTop: 0 }}>
            <table className="uidai-pmis-table uidai-pmis-table-compact" style={{ marginTop: 0, minWidth: 0 }}>
                <thead><tr><th style={{ width: 110 }}>Scoring</th><th>Threshold</th><th>Label</th><th>Measure</th></tr></thead>
                <tbody>
                    {b.map((bd, i) => {
                        let outcome;
                        if (bd.severity_level != null && bd.severity_level !== "") outcome = <strong>Severity {bd.severity_level}</strong>;
                        else if (bd.rate_percent != null && bd.rate_percent !== "") outcome = <span><strong>{bd.rate_percent}%</strong> <span style={{ color: "var(--uidai-pmis-muted)", fontSize: 11 }}>LD/day</span></span>;
                        else if (bd.points_contribution != null && bd.points_contribution !== "") outcome = <strong>{bd.points_contribution} pts</strong>;
                        else outcome = <span style={{ color: "var(--uidai-pmis-muted)" }}>—</span>;
                        return <tr key={`b${i}`}><td>{outcome}</td><td>{bandThreshold(bd)}</td><td>{bd.band_label || "—"}</td><td>{bd.metric_key || "—"}</td></tr>;
                    })}
                    {l.map((lk, i) => (
                        <tr key={`l${i}`}><td><strong>Tier {lk.sort_order ?? "—"}</strong></td><td>{(lk.lookup_value ?? lk.threshold ?? "—")}%</td><td>{lk.lookup_key || lk.tier_label || "—"}</td><td>linear escalation</td></tr>
                    ))}
                </tbody>
            </table>
        </div>
    );
}

// ---------------------------------------------------------------------------
// Evaluation result rendering — turns a MappingEvaluation response (or a list
// of them, for the whole-activity evaluate) into headline metric tiles plus
// collapsible sections (Summary / Breaches / Guards / Notes / Overrides),
// mirroring the SLA Details accordions. All enum-ish values are humanized.
// ---------------------------------------------------------------------------

// The four key outputs surfaced as big tiles at the top of a result.
const EVAL_HEADLINE = [
    { key: "severity_level", label: "Severity Level", kind: "severity" },
    { key: "accumulated_points", label: "Accumulated Points" },
    { key: "ld_percent", label: "LD Percent", suffix: "%" },
    { key: "ld_amount", label: "LD Amount", kind: "ld" },
];
// Keys we never want to dump into the Summary grid (ids, links, nested blocks).
const EVAL_INTERNAL = new Set([
    "_type", "mapping_id", "activity_id", "sla_id", "project_id",
    "breaches", "guards", "notes", "overrides_applied",
    "evaluations", "mappings", "mapping_evaluations", "results",
]);

function evalNum(v) {
    if (v === null || v === undefined || v === "") return "—";
    const n = Number(v);
    if (Number.isNaN(n)) return String(v);
    return n.toLocaleString("en-IN", { maximumFractionDigits: 2 });
}

// Prettify a field key into a label, fixing common acronyms.
function labelize(k) {
    return String(k)
        .replace(/[_-]+/g, " ")
        .replace(/\b\w/g, (c) => c.toUpperCase())
        .replace(/\bSla\b/g, "SLA").replace(/\bLd\b/g, "LD").replace(/\bId\b/g, "ID").replace(/\bPct\b/g, "%");
}

// Higher severity = worse → warmer colour for the headline tile.
function severityAccent(level) {
    const n = Number(level);
    if (!Number.isFinite(n)) return "#173e77";
    if (n >= 3) return "#c0392b";
    if (n === 2) return "#c77700";
    return "#1f8a4c";
}

function EvalStatTile({ label, value, accent }) {
    return (
        <div style={{ background: "#f6f9fd", border: "1px solid var(--uidai-pmis-border)", borderRadius: 10, padding: "12px 14px" }}>
            <div style={{ fontSize: 11, color: "var(--uidai-pmis-muted)", fontWeight: 700, marginBottom: 6, textTransform: "uppercase", letterSpacing: ".3px" }}>{label}</div>
            <div style={{ fontSize: 22, fontWeight: 800, color: accent || "#173e77", lineHeight: 1.1, wordBreak: "break-word" }}>{value}</div>
        </div>
    );
}

const BREACH_COLS = [
    { key: "metric_key", label: "Metric", humanize: true },
    { key: "observed_value", label: "Observed", num: true },
    { key: "days_in_band", label: "Days in Band", num: true },
    { key: "severity_level", label: "Severity", num: true },
    { key: "points_contribution", label: "Points", num: true },
    { key: "rate_percent", label: "Rate %", num: true },
    { key: "contribution_percent", label: "Contribution %", num: true },
    { key: "note", label: "Note" },
];

function BreachTable({ rows }) {
    if (!Array.isArray(rows) || rows.length === 0) {
        return <div style={{ fontSize: 12.5, color: "var(--uidai-pmis-muted)" }}>No breaches recorded.</div>;
    }
    const has = (k) => rows.some((r) => r[k] !== null && r[k] !== undefined && r[k] !== "");
    const cols = BREACH_COLS.filter((c) => has(c.key));
    return (
        <div className="uidai-pmis-table-wrap">
            <table className="uidai-pmis-table uidai-pmis-table-compact" style={{ marginTop: 0 }}>
                <thead>
                    <tr>{cols.map((c) => <th key={c.key} style={c.num ? { textAlign: "right" } : undefined}>{c.label}</th>)}</tr>
                </thead>
                <tbody>
                    {rows.map((r, i) => (
                        <tr key={i}>
                            {cols.map((c) => {
                                const v = r[c.key];
                                if (c.num) return <td key={c.key} style={{ textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{evalNum(v)}</td>;
                                if (c.humanize) return <td key={c.key}>{maybeHumanize(v)}</td>;
                                return <td key={c.key}>{v === null || v === undefined || v === "" ? "—" : String(v)}</td>;
                            })}
                        </tr>
                    ))}
                </tbody>
            </table>
        </div>
    );
}

// Guard conditions — readable table: metric · condition (op + threshold) ·
// observed · state (triggered/OK) · action · description.
const GUARD_OP_LABEL = { LT: "<", LTE: "≤", GT: ">", GTE: "≥", EQ: "=", NEQ: "≠" };
function GuardsTable({ rows }) {
    if (!Array.isArray(rows) || rows.length === 0) {
        return <div style={{ fontSize: 12.5, color: "var(--uidai-pmis-muted)", fontStyle: "italic" }}>No guard conditions.</div>;
    }
    return (
        <div className="uidai-pmis-table-wrap">
            <table className="uidai-pmis-table uidai-pmis-table-compact" style={{ marginTop: 0 }}>
                <thead>
                    <tr>
                        <th>Metric</th>
                        <th>Condition</th>
                        <th style={{ textAlign: "right" }}>Observed</th>
                        <th>State</th>
                        <th>Action</th>
                        <th>Description</th>
                    </tr>
                </thead>
                <tbody>
                    {rows.map((g, i) => (
                        <tr key={i}>
                            <td>{maybeHumanize(g.metric_key)}</td>
                            <td style={{ whiteSpace: "nowrap", fontVariantNumeric: "tabular-nums" }}>
                                {(GUARD_OP_LABEL[g.operator] || g.operator || "")}{g.threshold_value != null && g.threshold_value !== "" ? ` ${g.threshold_value}` : ""}
                            </td>
                            <td style={{ textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{g.observed_value == null || g.observed_value === "" ? "—" : evalNum(g.observed_value)}</td>
                            <td><span className={`uidai-pmis-badge ${g.triggered ? "uidai-pmis-badge-red" : "uidai-pmis-badge-green"}`}>{g.triggered ? "Triggered" : "OK"}</span></td>
                            <td>{g.action ? maybeHumanize(g.action) : "—"}</td>
                            <td style={{ minWidth: 220, color: "var(--uidai-pmis-text)" }}>{g.action_description || "—"}</td>
                        </tr>
                    ))}
                </tbody>
            </table>
        </div>
    );
}

function isMappingEval(d) {
    return d && typeof d === "object" && !Array.isArray(d) &&
        (d._type === "MappingEvaluation" || "accumulated_points" in d || "breaches" in d || "ld_amount" in d);
}

// ---------------------------------------------------------------------------
// Schema-driven inputs — render one control from a form-schema `inputs[]` item
// (type: number / money / integer / date / select / textarea / text).
// ---------------------------------------------------------------------------
function SchemaInput({ input, value, onChange }) {
    const type = String(input.type || "text").toLowerCase();
    const common = { value: value ?? "", onChange: (e) => onChange(e.target.value), placeholder: input.placeholder || "" };
    if (type === "select" && Array.isArray(input.options)) {
        return (
            <select {...common}>
                <option value="">— Select —</option>
                {input.options.map((o) => {
                    const val = (o && typeof o === "object") ? (o.value ?? o.key) : o;
                    const label = (o && typeof o === "object") ? (o.label ?? humanize(o.value ?? o.key)) : humanize(o);
                    return <option key={String(val)} value={val}>{label}</option>;
                })}
            </select>
        );
    }
    if (type === "textarea") return <textarea {...common} style={{ height: 80, resize: "vertical" }} />;
    if (type === "date") return <input type="date" {...common} />;
    if (type === "number" || type === "money" || type === "integer") {
        return <input type="number" {...common} min={input.minimum ?? undefined} max={input.maximum ?? undefined} step={type === "integer" ? 1 : "any"} />;
    }
    return <input type="text" {...common} />;
}

// Scoring-bands reference table from a form-schema `bands[]` (display only).
function EvalBandsReference({ bands }) {
    if (!Array.isArray(bands) || bands.length === 0) return null;
    const showSeverity = bands.some((b) => b.severity != null);
    const showRange = bands.some((b) => b.range_min != null || b.range_max != null);
    const showRate = bands.some((b) => b.rate_percent != null);
    return (
        <div className="uidai-pmis-table-wrap">
            <table className="uidai-pmis-table uidai-pmis-table-compact" style={{ marginTop: 0 }}>
                <thead>
                    <tr>
                        {showSeverity && <th>Severity</th>}
                        <th>Band</th>
                        {showRange && <th>Range</th>}
                        {showRate && <th style={{ textAlign: "right" }}>Rate %</th>}
                    </tr>
                </thead>
                <tbody>
                    {bands.map((b, i) => (
                        <tr key={i}>
                            {showSeverity && <td>{b.severity != null ? `L${b.severity}` : "—"}</td>}
                            <td>{b.label || "—"}</td>
                            {showRange && <td>{(b.range_min != null || b.range_max != null) ? `${b.range_min ?? "−∞"} – ${b.range_max ?? "∞"}${b.unit ? " " + b.unit : ""}` : "—"}</td>}
                            {showRate && <td style={{ textAlign: "right" }}>{b.rate_percent != null ? `${b.rate_percent}%` : "—"}</td>}
                        </tr>
                    ))}
                </tbody>
            </table>
        </div>
    );
}

// A result section: a standalone Accordion normally, or a plain titled block
// when it already sits inside an activity-level accordion (no double nesting).
function EvalSection({ title, badge, nested, defaultOpen, children }) {
    if (nested) {
        return (
            <div style={{ marginTop: 16 }}>
                <div style={{ fontSize: 13, fontWeight: 800, color: "#173e77", marginBottom: 8, display: "flex", alignItems: "center", gap: 8 }}>
                    {title}
                    {badge != null && <span style={{ background: "#dceafe", color: "#1f4e87", borderRadius: 999, padding: "1px 8px", fontSize: 11, fontWeight: 800 }}>{badge}</span>}
                </div>
                {children}
            </div>
        );
    }
    return <Accordion title={title} badge={badge} defaultOpen={defaultOpen}>{children}</Accordion>;
}

// One MappingEvaluation: headline tiles + Summary/Breaches/Guards/Notes/Overrides.
function SingleEvaluation({ ev, nested }) {
    // Always surface Severity + Points (show "—" when null); LD tiles only when
    // the response actually carries them.
    const ALWAYS = new Set(["severity_level", "accumulated_points"]);
    const headline = EVAL_HEADLINE.filter((h) => ALWAYS.has(h.key) || (ev[h.key] !== undefined && ev[h.key] !== null));
    const guards = Array.isArray(ev.guards) ? ev.guards : [];
    const notes = Array.isArray(ev.notes) ? ev.notes : [];
    const overrides = ev.overrides_applied && typeof ev.overrides_applied === "object" ? Object.entries(ev.overrides_applied) : [];

    return (
        <div style={{ marginTop: nested ? 8 : 12 }}>
            {headline.length > 0 && (
                <div className="uidai-pmis-grid-4" style={{ gap: 12 }}>
                    {headline.map((h) => (
                        <EvalStatTile
                            key={h.key}
                            label={h.label}
                            value={h.suffix ? `${evalNum(ev[h.key])}${h.suffix}` : evalNum(ev[h.key])}
                            accent={h.kind === "severity" ? severityAccent(ev[h.key]) : (h.kind === "ld" ? "#c0392b" : "#173e77")}
                        />
                    ))}
                </div>
            )}

            {/* <EvalSection title="Summary" nested={nested} defaultOpen>
                <DetailGrid fields={summary.map(([k, v]) => [labelize(k), maybeHumanize(v)])} />
            </EvalSection> */}

            <EvalSection title="Breaches" badge={Array.isArray(ev.breaches) ? ev.breaches.length : 0} nested={nested}>
                <BreachTable rows={ev.breaches} />
            </EvalSection>

            {guards.length > 0 && (
                <EvalSection title="Guards" badge={guards.length} nested={nested}>
                    <GuardsTable rows={guards} />
                </EvalSection>
            )}

            {notes.length > 0 && (
                <EvalSection title="Notes" badge={notes.length} nested={nested}>
                    <ul style={{ margin: 0, paddingLeft: 18, fontSize: 13, color: "var(--uidai-pmis-text)", lineHeight: 1.6 }}>
                        {notes.map((n, i) => <li key={i}>{typeof n === "object" ? JSON.stringify(n) : String(n)}</li>)}
                    </ul>
                </EvalSection>
            )}

            {overrides.length > 0 && (
                <EvalSection title="Overrides Applied" badge={overrides.length} nested={nested}>
                    <DetailGrid fields={overrides.map(([k, v]) => [labelize(k), maybeHumanize(typeof v === "object" ? JSON.stringify(v) : v)])} />
                </EvalSection>
            )}
        </div>
    );
}

// Entry point: a single MappingEvaluation, a list of them (whole-activity
// evaluate → one accordion per SLA), or an unknown shape (→ ResultView).
function EvaluationResult({ data }) {
    if (data === null || data === undefined) return null;
    const list =
        Array.isArray(data) ? data :
            Array.isArray(data?.mapping_results) ? data.mapping_results :
                Array.isArray(data?.evaluations) ? data.evaluations :
                    Array.isArray(data?.mappings) ? data.mappings :
                        Array.isArray(data?.mapping_evaluations) ? data.mapping_evaluations :
                            Array.isArray(data?.results) ? data.results : null;

    if (list) {
        const meta = !Array.isArray(data)
            ? Object.entries(data).filter(([k, v]) => !EVAL_INTERNAL.has(k) && (v === null || typeof v !== "object"))
            : [];
        return (
            <div>
                {meta.length > 0 && (
                    <div className="uidai-pmis-grid-4" style={{ gap: 12, marginTop: 12 }}>
                        {meta.map(([k, v]) => <EvalStatTile key={k} label={labelize(k)} value={maybeHumanize(v)} accent={/ld/i.test(k) ? "#c0392b" : "#173e77"} />)}
                    </div>
                )}
                {list.length === 0 ? (
                    <div style={{ marginTop: 12, fontSize: 13, color: "var(--uidai-pmis-muted)", fontStyle: "italic" }}>No SLA evaluations returned for this period.</div>
                ) : list.map((ev, i) => (
                    <Accordion
                        key={ev?.mapping_id || ev?.sla_ref || i}
                        title={`${ev?.sla_title || ev?.sla_ref || `SLA ${i + 1}`}`}
                        badge={isMappingEval(ev) && ev.ld_amount != null ? `LD ${evalNum(ev.ld_amount)}` : null}
                        defaultOpen={list.length === 1}
                    >
                        {isMappingEval(ev) ? <SingleEvaluation ev={ev} /> : <ResultView data={ev} />}
                    </Accordion>
                ))}
            </div>
        );
    }

    if (isMappingEval(data)) return <SingleEvaluation ev={data} />;
    return <ResultView data={data} />;
}

// ---------------------------------------------------------------------------
// Activity chooser — shown when the page is opened without ?activityId (i.e.
// from the SLA System nav rather than from an activity's node modal).
//
// SLAs are mapped onto activities, so this page needs one before it can do
// anything; without this the only ways in were walking the milestone tree or
// knowing the raw activity UUID. Picking here writes the same query params the
// node modal passes, so both entry points land in exactly the same state.
// ---------------------------------------------------------------------------
function ActivityChooser({ milestones, loading, error, onReload, onPick, current }) {
    const [query, setQuery] = useState("");
    // Milestone uid/index → expanded. Everything starts open when the project
    // is small enough to scan; collapsed once there's a lot to wade through.
    const [collapsed, setCollapsed] = useState(() => new Set());

    const dim = { color: "var(--uidai-pmis-muted)" };
    const q = query.trim().toLowerCase();

    // Filter activities by code/name; keep a milestone if its own name matches
    // (so searching a milestone shows everything under it).
    const groups = (milestones || []).map((m, mi) => {
        const acts = Array.isArray(m?.activities) ? m.activities : [];
        const msLabel = `${m?.serverDisplayCode || `M${mi + 1}`} ${m?.name || ""}`;
        const msHit = q && msLabel.toLowerCase().includes(q);
        const rows = acts
            .map((a, ai) => ({
                apiId: a?.apiId || "",
                name: a?.name || "",
                code: a?.serverDisplayCode || `A${mi + 1}.${ai + 1}`,
            }))
            // No apiId means the activity was never saved server-side, so it has
            // nothing to map an SLA against.
            .filter((a) => a.apiId)
            .filter((a) => !q || msHit || `${a.code} ${a.name}`.toLowerCase().includes(q));
        return { key: m?.uid || m?.apiId || `m${mi}`, name: m?.name || `Milestone ${mi + 1}`, code: m?.serverDisplayCode || `M${mi + 1}`, rows };
    });
    const visible = groups.filter((g) => g.rows.length);
    const totalShown = visible.reduce((n, g) => n + g.rows.length, 0);

    return (
        <div className="uidai-pmis-card">
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 10, marginBottom: 10 }}>
                <div style={{ fontSize: 14, fontWeight: 700, color: "#173e77" }}>Choose an activity</div>
                <button type="button" className="uidai-pmis-btn uidai-pmis-btn-cancel uidai-pmis-btn-small" style={{ marginTop: 0 }} onClick={onReload} disabled={loading}>
                    {loading ? "Loading…" : "↻ Reload"}
                </button>
            </div>

            <div style={{ marginBottom: 10 }}>
                <input
                    type="text"
                    className="uidai-pmis-filter-select"
                    style={{ width: "100%" }}
                    placeholder="Search by code or name"
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                />
            </div>

            {error && (
                <div className="uidai-pmis-badge uidai-pmis-badge-red" style={{ display: "block", borderRadius: 8, padding: "10px 12px", marginBottom: 12, fontWeight: 600 }}>
                    {error}
                </div>
            )}

            {loading && !visible.length ? (
                <div style={{ padding: 18, ...dim, fontSize: 13 }}>Loading activities…</div>
            ) : !visible.length ? (
                <div style={{ padding: 18, ...dim, fontSize: 13 }}>
                    {q ? "No match." : "No saved activities in this project."}
                </div>
            ) : (
                <>
                    <div style={{ fontSize: 12, ...dim, marginBottom: 6 }}>
                        {totalShown} activit{totalShown === 1 ? "y" : "ies"} in {visible.length} milestone{visible.length === 1 ? "" : "s"}
                    </div>
                    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                        {visible.map((g) => {
                            const shut = collapsed.has(g.key);
                            return (
                                <div key={g.key} style={{ border: "1px solid var(--uidai-pmis-border)", borderRadius: 6, overflow: "hidden" }}>
                                    <button
                                        type="button"
                                        aria-expanded={!shut}
                                        onClick={() => setCollapsed((s) => {
                                            const next = new Set(s);
                                            if (next.has(g.key)) next.delete(g.key); else next.add(g.key);
                                            return next;
                                        })}
                                        style={{
                                            display: "flex", alignItems: "center", gap: 8, width: "100%", textAlign: "left",
                                            background: "#f6f9fd", border: "none", cursor: "pointer", font: "inherit",
                                            padding: "7px 10px", color: "#173e77", fontWeight: 600, fontSize: 13,
                                        }}
                                    >
                                        <span style={{ ...dim, fontSize: 11 }} aria-hidden="true">{shut ? "▸" : "▾"}</span>
                                        <span style={{ fontFamily: "monospace", fontSize: 12, ...dim }}>{g.code}</span>
                                        <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{g.name}</span>
                                        <span style={{ marginLeft: "auto", fontSize: 12, ...dim }}>{g.rows.length}</span>
                                    </button>
                                    {!shut && (
                                        <div style={{ display: "flex", flexDirection: "column" }}>
                                            {g.rows.map((a) => {
                                                const isCurrent = current && a.apiId === current;
                                                return (
                                                    <button
                                                        key={a.apiId}
                                                        type="button"
                                                        onClick={() => onPick(g, a)}
                                                        style={{
                                                            display: "flex", alignItems: "center", gap: 10, width: "100%", textAlign: "left",
                                                            background: isCurrent ? "#eef3fb" : "#fff", border: "none",
                                                            borderTop: "1px solid var(--uidai-pmis-border)", cursor: "pointer", font: "inherit",
                                                            padding: "6px 10px", fontSize: 13, color: "var(--uidai-pmis-text)",
                                                        }}
                                                    >
                                                        <span style={{ fontFamily: "monospace", fontSize: 12, ...dim, flex: "0 0 auto" }}>{a.code}</span>
                                                        <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                                                            {a.name || "—"}
                                                        </span>
                                                        {isCurrent && (
                                                            <span style={{ marginLeft: "auto", fontSize: 12, ...dim, flex: "0 0 auto" }}>current</span>
                                                        )}
                                                    </button>
                                                );
                                            })}
                                        </div>
                                    )}
                                </div>
                            );
                        })}
                    </div>
                </>
            )}
        </div>
    );
}

export default function ActivitySlasPage() {
    // Prefill the Activity ID when we're launched from an activity's node modal
    // (it navigates here with ?activityId=…), so the user lands ready to map.
    const [searchParams, setSearchParams] = useSearchParams();
    // The route is /projects/:projectId/activity-slas — that id scopes the SLA
    // library to this project (sent as ?project_id= to the masters API). Allow a
    // ?project_id= query override too, in case the page is opened standalone.
    const { projectId: routeProjectId } = useParams();
    const projectId = routeProjectId || searchParams.get("project_id") || "";

    // The project's contract type (e.g. "PMU", "MSAP") — when present, only SLAs
    // of this contract type are shown, so the user never sees irrelevant SLAs.
    // TODO(launching page): append &contractType=<PROJECT_CONTRACT_TYPE> to the
    // navigation URL (alongside activityId) so this pre-filter kicks in. Falls
    // back to showing all SLAs when not provided.
    const projectContractType = searchParams.get("contractType") || "";

    // ---- API configuration ----
    const [baseUrl] = useState("http://10.1.131.199/contracts");

    // ---- Two-view flow: the mapping screen (default) and the SLA picker. ----
    const [view, setView] = useState("mapping"); // "mapping" | "picker"
    // Whether the "Map SLA to Activity" form (effective window + overrides) is
    // expanded in the details panel.
    const [showMappingEdit, setShowMappingEdit] = useState(false);
    // Width (px) of the SLA details side-panel — user-resizable via the drag handle.
    const [panelWidth, setPanelWidth] = useState(460);
    // A mapping row whose SLA image is shown in the popup (null = closed), plus
    // the resolved image URL (fetched from the SLA detail so it always carries
    // the real attachment).
    const [previewSla, setPreviewSla] = useState(null);
    const [previewSrc, setPreviewSrc] = useState("");

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
    // Human-friendly name for the activity in headings — falls back to the raw
    // id. Declared after activityIdInput because it reads it.
    const activityLabel = searchParams.get("activityCode") || searchParams.get("activityName") || activityIdInput;
    // ---- Activity chooser (shown when we arrive without an ?activityId) ----
    const [chooserOpen, setChooserOpen] = useState(false);
    const [tree, setTree] = useState(null);        // milestones[] with nested activities
    const [treeLoading, setTreeLoading] = useState(false);
    const [treeError, setTreeError] = useState("");
    // ---- Copy-mappings-from-another-activity picker ----
    const [copyOpen, setCopyOpen] = useState(false);
    const [copyBusy, setCopyBusy] = useState(false);
    // ---- Mappings table sort ----
    const [sort, setSort] = useState({ key: "sla_ref", dir: 1 });
    const [effFrom, setEffFrom] = useState(today());
    const [effUntil, setEffUntil] = useState("");
    const [createLoading, setCreateLoading] = useState(false);
    const [createMessage, setCreateMessage] = useState("");
    // Schema-driven mapping form (GET …/mapping-form-schema): question,
    // explanation, effective_from default, dynamic override inputs, submit.
    const [mapSchema, setMapSchema] = useState(null);
    const [mapSchemaLoading, setMapSchemaLoading] = useState(false);
    const [mapValues, setMapValues] = useState({}); // override input values

    // ---- Step 4: activity mappings + edit ----
    const [mappings, setMappings] = useState([]);
    const [activeOnly, setActiveOnly] = useState(true);
    const [mappingsLoading, setMappingsLoading] = useState(false);
    const [mappingsError, setMappingsError] = useState("");
    const [editingId, setEditingId] = useState("");
    const [editForm, setEditForm] = useState({ status: "ACTIVE", effective_until: "" });
    const [editLoading, setEditLoading] = useState(false);

    // ---- Step 5a: single-mapping evaluate ----
    const [singleEval, setSingleEval] = useState(null); // { mappingId, slaRef, slaTitle, period_start, ld_base_amount, observations, loadingMetrics }
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
        setChooserOpen(false);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [searchParams]);

    // The chooser needs the project's milestone → activity tree (one round-trip,
    // the same call Milestone Configuration makes). Loaded lazily: the common
    // path in here carries an ?activityId and never opens the chooser.
    const chooserVisible = chooserOpen || !activityIdInput.trim();
    useEffect(() => {
        if ((!chooserVisible && !copyOpen) || !projectId || tree) return;
        loadActivityTree();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [chooserVisible, copyOpen, projectId]);

    // SLA refs already on this activity — drives the "mapped" marker in the
    // picker so the same SLA doesn't get attached twice.
    const mappedRefs = useMemo(
        () => new Set(mappings.map((m) => m.sla_ref).filter(Boolean)),
        [mappings]
    );

    const sortedMappings = useMemo(() => {
        const rows = mappings.slice();
        const { key, dir } = sort;
        return rows.sort((a, b) => {
            const av = String(a?.[key] ?? "");
            const bv = String(b?.[key] ?? "");
            if (av === bv) return 0;
            // Blanks last regardless of direction — an empty "until" is
            // open-ended, not "earliest".
            if (!av) return 1;
            if (!bv) return -1;
            return av.localeCompare(bv, undefined, { numeric: true }) * dir;
        });
    }, [mappings, sort]);

    function toggleSort(key) {
        setSort((s) => (s.key === key ? { key, dir: -s.dir } : { key, dir: 1 }));
    }

    async function loadActivityTree() {
        if (!projectId) { setTreeError("No project in the URL."); return; }
        setTreeLoading(true);
        setTreeError("");
        try {
            const project = await loadProjectTree(projectId);
            setTree(Array.isArray(project?.milestones) ? project.milestones : []);
        } catch (err) {
            setTreeError(err?.message || "Failed to load the project's activities");
            setTree([]);
        } finally {
            setTreeLoading(false);
        }
    }

    // Write the same query params the activity node modal passes, so both entry
    // points land in an identical state (and the breadcrumb reads the same).
    // The prefill effect above picks the change up and loads the mappings.
    function pickActivity(milestone, activity) {
        const next = new URLSearchParams(searchParams);
        next.set("activityId", activity.apiId);
        next.set("activityCode", activity.code || "");
        next.set("activityName", activity.name || "");
        next.set("milestoneName", milestone.name || "");
        // Belongs to the previously-selected activity's node form, not this one.
        next.delete("nodeUid");
        next.delete("activityMode");
        setSearchParams(next);
        setChooserOpen(false);
    }

    // ---- Copy every mapping from another activity onto this one ----------------
    // Mapping 11 SLAs across a project one activity at a time is the single
    // biggest time sink here, and activities usually repeat the same set.
    async function copyMappingsFrom(milestone, activity) {
        const target = activityIdInput.trim();
        if (!target || !activity?.apiId || activity.apiId === target) { setCopyOpen(false); return; }
        setCopyBusy(true);
        try {
            const res = await authorizedFetch(
                `${baseUrl}/api/v3/activities/${encodeURIComponent(activity.apiId)}/sla-mappings?active_only=true`,
                { method: "GET", headers: { Accept: "application/json" } }
            );
            const source = extractElements(await readJson(res));
            const existing = new Set(mappings.map((m) => m.sla_ref).filter(Boolean));
            // The mapping rows don't carry the master's id, so resolve it off the
            // SLA library we already loaded. Anything unresolved is reported, not
            // silently dropped.
            const byRef = new Map(slaList.map((s) => [s.sla_ref, s.id]));
            const todo = source.filter((m) => m.sla_ref && !existing.has(m.sla_ref));
            if (!todo.length) {
                uiStore.showMessage(source.length ? "Nothing to copy — those SLAs are already mapped." : "That activity has no active mappings.");
                return;
            }
            const skipped = [];
            let copied = 0;
            for (const m of todo) {
                const slaId = byRef.get(m.sla_ref);
                if (!slaId) { skipped.push(m.sla_ref); continue; }
                try {
                    const body = { sla_id: slaId, activity_id: target, effective_from: m.effective_from || today() };
                    if (m.effective_until) body.effective_until = m.effective_until;
                    const r = await authorizedFetch(`${baseUrl}/api/v3/sla-activity-mappings`, {
                        method: "POST",
                        headers: { "Content-Type": "application/json", Accept: "application/json" },
                        body: JSON.stringify(body),
                    });
                    await readJson(r);
                    copied += 1;
                } catch { skipped.push(m.sla_ref); }
            }
            await loadMappings(target);
            if (skipped.length) uiStore.showError(`Copied ${copied}. Skipped: ${skipped.join(", ")}.`);
            else uiStore.showMessage(`Copied ${copied} mapping${copied === 1 ? "" : "s"} from ${activity.code || activity.name}.`);
        } catch (err) {
            uiStore.showError(err?.message || "Failed to copy mappings");
        } finally {
            setCopyBusy(false);
            setCopyOpen(false);
        }
    }

    // Shared response/error unwrapper.
    async function readJson(res) {
        const payload = await res.json().catch(() => null);
        if (!res.ok) throw new Error(payload?.error?.message || payload?.message || `Request failed (${res.status})`);
        return payload;
    }

    // ---------------------------------------------------------------------------
    // Step 1 — GET /api/v3/sla-masters
    // ---------------------------------------------------------------------------
    async function loadSlaMasters() {
        setListLoading(true);
        setListError("");
        try {
            // Scope the SLA library to this project — the backend returns only the
            // SLAs associated with project_id (each with its image attachments).
            const qs = new URLSearchParams({ offset: "1", pageSize: String(pageSize) });
            if (projectId) qs.set("project_id", projectId);
            const res = await authorizedFetch(
                `${baseUrl}/api/v3/sla-masters?${qs.toString()}`,
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
        setCreateMessage("");
        loadMapSchema(slaId); // fetch the mapping form for this SLA + activity
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

    // GET /sla-masters/{sla_id}/mapping-form-schema?activity_id=… — drives the
    // "Map SLA to Activity" form (effective_from default + any override inputs).
    async function loadMapSchema(slaId) {
        setMapSchema(null);
        setMapValues({});
        const activityId = activityIdInput.trim();
        if (!activityId) return;
        setMapSchemaLoading(true);
        try {
            const res = await authorizedFetch(
                `${baseUrl}/api/v3/sla-masters/${encodeURIComponent(slaId)}/mapping-form-schema?activity_id=${encodeURIComponent(activityId)}`,
                { method: "GET", headers: { Accept: "application/json" } }
            );
            const payload = await readJson(res);
            const schema = payload?.data || payload;
            setMapSchema(schema);
            if (schema?.effective_from_default) setEffFrom(schema.effective_from_default);
        } catch {
            setMapSchema(null); // fall back to the plain effective-dates form
        } finally {
            setMapSchemaLoading(false);
        }
    }

    // ---------------------------------------------------------------------------
    // Step 3 — POST /api/v3/sla-activity-mappings (schema-driven)
    // ---------------------------------------------------------------------------
    async function createMapping() {
        if (!selectedSlaId) { setCreateMessage("Select an SLA first."); return; }
        if (!activityIdInput.trim()) { setCreateMessage("Enter an Activity ID."); return; }
        setCreateLoading(true);
        setCreateMessage("");
        try {
            // Collect any override inputs the mapping schema asked for.
            const overrides = {};
            const missing = [];
            (Array.isArray(mapSchema?.inputs) ? mapSchema.inputs : []).forEach((inp) => {
                const key = inp.name || inp.key;
                let v = mapValues[key];
                const t = String(inp.type || "").toLowerCase();
                const isNum = (t === "number" || t === "money" || t === "integer");
                if (v === "" || v === undefined || v === null) {
                    if (inp.required) missing.push(inp.label || key);
                    return; // omit empty (never send null)
                }
                if (isNum) {
                    const n = Number(v);
                    if (Number.isNaN(n)) { missing.push(`${inp.label || key} (must be a number)`); return; }
                    v = n;
                }
                overrides[key] = v;
            });
            if (missing.length) { setCreateMessage(`Please enter: ${missing.join(", ")}.`); return; }

            // Build the body from the schema's template when present.
            const tmpl = mapSchema?.submit?.body_template || {};
            const body = {
                ...tmpl,
                sla_id: selectedSlaId,
                activity_id: activityIdInput.trim(),
                effective_from: effFrom,
                overrides: { ...(tmpl.overrides || {}), ...overrides },
            };
            if (effUntil) body.effective_until = effUntil;

            const url = mapSchema?.submit?.url ? `${baseUrl}${mapSchema.submit.url}` : `${baseUrl}/api/v3/sla-activity-mappings`;
            const res = await authorizedFetch(url, {
                method: mapSchema?.submit?.method || "POST",
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
        setEditForm({ status: m.status || "ACTIVE", effective_until: m.effective_until || "" });
    }
    function cancelEdit() { setEditingId(""); }

    async function saveEdit(mappingId) {
        // Retiring is the nearest thing this page has to a delete — the mapping
        // stops counting towards the activity's LD from here on. Everything else
        // (dates) is freely reversible, so only this asks.
        const wasActive = String(mappings.find((m) => m.id === mappingId)?.status || "").toUpperCase() !== "RETIRED";
        if (wasActive && editForm.status === "RETIRED" &&
            !window.confirm("Retire this mapping? It will stop being evaluated for this activity.")) {
            return;
        }
        setEditLoading(true);
        try {
            // overrides intentionally omitted for now — backend support is pending.
            const body = { status: editForm.status, effective_until: editForm.effective_until || null };
            const res = await authorizedFetch(
                `${baseUrl}/api/v3/sla-activity-mappings/${encodeURIComponent(mappingId)}`,
                { method: "PATCH", headers: { "Content-Type": "application/json", Accept: "application/json" }, body: JSON.stringify(body) }
            );
            await readJson(res);
            uiStore.showMessage("Mapping updated.");
            setEditingId("");
            loadMappings();
        } catch (err) {
            uiStore.showError(err?.message || "Failed to update mapping");
        } finally {
            setEditLoading(false);
        }
    }

    // ---------------------------------------------------------------------------
    // Step 5a — schema-driven single evaluate:
    //   GET  /activities/{id}/sla-evaluate/{sla_ref}/form-schema   (render form)
    //   POST /activities/{id}/sla-evaluate/{sla_ref}               (run)
    // The user fills human-friendly inputs; the backend builds the technical
    // metric_observations itself.
    // ---------------------------------------------------------------------------
    async function openSingleEval(m) {
        setSingleEvalResult(null);
        setSingleEvalError("");
        setSingleEval({
            sla_ref: m.sla_ref, sla_title: m.sla_title,
            schema: null, loadingSchema: true, schemaError: "",
            // No period_end: the reporting window is the backend's to decide
            // from the start date, so it is neither asked for nor sent.
            period_start: today(), values: {},
        });
        const activityId = activityIdInput.trim();
        if (!activityId || !m.sla_ref) {
            setSingleEval((s) => (s ? { ...s, loadingSchema: false, schemaError: "Missing activity id or SLA ref." } : s));
            return;
        }
        try {
            const res = await authorizedFetch(
                `${baseUrl}/api/v3/activities/${encodeURIComponent(activityId)}/sla-evaluate/${encodeURIComponent(m.sla_ref)}/form-schema`,
                { method: "GET", headers: { Accept: "application/json" } }
            );
            const payload = await readJson(res);
            const schema = payload?.data || payload;
            setSingleEval((s) => {
                if (!s || s.sla_ref !== m.sla_ref) return s;
                const start = schema?.period?.start_default || schema?.start_default || s.period_start;
                return {
                    ...s,
                    schema,
                    loadingSchema: false,
                    period_start: start,
                    values: {},
                };
            });
        } catch (err) {
            setSingleEval((s) => (s && s.sla_ref === m.sla_ref ? { ...s, loadingSchema: false, schemaError: err?.message || "Failed to load the evaluation form." } : s));
        }
    }
    function closeSingleEval() { setSingleEval(null); setSingleEvalResult(null); setSingleEvalError(""); }

    async function submitSingleEval() {
        if (!singleEval || !singleEval.schema) return;
        setSingleEvalLoading(true);
        setSingleEvalError("");
        setSingleEvalResult(null);
        try {
            const schema = singleEval.schema;
            // Build the body from the filled inputs. Empty values are OMITTED
            // (never sent as null — the backend rejects null with a 422), required
            // inputs are validated up-front, and numeric inputs are coerced.
            // period_end is NOT sent — the backend derives the window from the
            // start, so the payload is just the start plus the observed inputs
            // (e.g. { period_start: "2025-11-10", value: 12 }).
            const body = { period_start: singleEval.period_start };
            const missing = [];
            (schema.inputs || []).forEach((inp) => {
                let v = singleEval.values[inp.name];
                const t = String(inp.type || "").toLowerCase();
                const isNum = (t === "number" || t === "money" || t === "integer");
                if (v === "" || v === undefined || v === null) {
                    if (inp.required) missing.push(inp.label || inp.name);
                    return; // omit empty values entirely
                }
                if (isNum) {
                    const n = Number(v);
                    if (Number.isNaN(n)) { missing.push(`${inp.label || inp.name} (must be a number)`); return; }
                    v = n;
                }
                body[inp.name] = v;
            });
            if (!singleEval.period_start) missing.push("Reporting period");
            if (missing.length) {
                setSingleEvalError(`Please enter: ${missing.join(", ")}.`);
                return; // `finally` resets the loading flag
            }
            const url = schema.submit?.url
                ? `${baseUrl}${schema.submit.url}`
                : `${baseUrl}/api/v3/activities/${encodeURIComponent(activityIdInput.trim())}/sla-evaluate/${encodeURIComponent(singleEval.sla_ref)}`;
            const res = await authorizedFetch(url, {
                method: schema.submit?.method || "POST",
                headers: { "Content-Type": "application/json", Accept: "application/json" },
                body: JSON.stringify(body),
            });
            const payload = await readJson(res);
            setSingleEvalResult(payload?.data ?? payload);
        } catch (err) {
            setSingleEvalError(err?.message || "Evaluation failed");
        } finally {
            setSingleEvalLoading(false);
        }
    }

    // ---------------------------------------------------------------------------
    // Step 5b — schema-driven bulk evaluate:
    //   GET  …/sla-evaluate/{sla_ref}/form-schema  (per active SLA, for inputs)
    //   POST /activities/{id}/sla-evaluate          { observations, period }
    // ---------------------------------------------------------------------------
    async function openActivityEval() {
        setActEvalResult(null);
        setActEvalError("");
        if (!mappings.length) { setActEvalError("Load this activity's mappings first."); return; }
        const activityId = activityIdInput.trim();
        if (!activityId) { setActEvalError("Missing activity id."); return; }
        setActEvalBuilding(true);
        try {
            // One entry per unique sla_ref among the loaded (active) mappings.
            const byRef = new Map();
            for (const m of mappings) {
                if (!m.sla_ref || byRef.has(m.sla_ref)) continue;
                byRef.set(m.sla_ref, m);
            }
            const refs = [...byRef.keys()];
            // Pull each SLA's form-schema in parallel so we render simple inputs
            // (no metric keys / shape) instead of the technical editor.
            const schemas = await Promise.all(refs.map(async (ref) => {
                try {
                    const res = await authorizedFetch(
                        `${baseUrl}/api/v3/activities/${encodeURIComponent(activityId)}/sla-evaluate/${encodeURIComponent(ref)}/form-schema`,
                        { method: "GET", headers: { Accept: "application/json" } }
                    );
                    const payload = await readJson(res);
                    return payload?.data || payload;
                } catch { return null; }
            }));
            let ps = today(), pe = today();
            const groups = refs.map((ref, i) => {
                const sc = schemas[i];
                const m = byRef.get(ref);
                const scStart = sc?.period?.start_default || sc?.start_default;
                const scEnd = sc?.period?.end_default || sc?.end_default;
                if (scStart) ps = scStart;
                if (scEnd) pe = scEnd;
                return {
                    sla_ref: ref,
                    sla_title: m?.sla_title || sc?.sla_title || ref,
                    inputs: Array.isArray(sc?.inputs) ? sc.inputs : [],
                    schemaError: sc ? "" : "Could not load this SLA's form.",
                    values: {},
                };
            });
            setActEval({ period_start: ps, period_end: pe, groups });
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
            // observations = { sla_ref: <bare value | { input.name: value }> }.
            // Single-input SLAs send a bare scalar; multi-input send an object.
            // SLAs left blank are omitted (the backend notes "no observation").
            const observations = {};
            const bad = [];
            for (const g of actEval.groups) {
                const inputs = g.inputs || [];
                const filled = {};
                let count = 0;
                for (const inp of inputs) {
                    let v = g.values[inp.name];
                    const t = String(inp.type || "").toLowerCase();
                    const isNum = (t === "number" || t === "money" || t === "integer");
                    if (v === "" || v === undefined || v === null) continue;
                    if (isNum) {
                        const n = Number(v);
                        if (Number.isNaN(n)) { bad.push(`${g.sla_ref}: ${inp.label || inp.name} must be a number`); continue; }
                        v = n;
                    }
                    filled[inp.name] = v;
                    count += 1;
                }
                if (count === 0) continue;
                observations[g.sla_ref] = inputs.length === 1 ? filled[inputs[0].name] : filled;
            }
            if (bad.length) { setActEvalError(bad.join("; ")); return; }
            const body = {
                observations,
                period_start: actEval.period_start,
                period_end: actEval.period_end,
            };
            const res = await authorizedFetch(
                `${baseUrl}/api/v3/activities/${encodeURIComponent(activityIdInput.trim())}/sla-evaluate`,
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
    const sectionHead = { display: "flex", alignItems: "center", marginBottom: 10, fontSize: 14, fontWeight: 700, color: "#173e77" };
    // Sub-heading inside a card — labels a block of fields without wrapping it
    // in another bordered panel.
    const subHead = { fontSize: 12, fontWeight: 600, color: "var(--uidai-pmis-muted)", marginBottom: 6 };
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

    // Filter options are derived from whatever SLA masters are loaded, so they
    // always reflect the real data without a separate metadata call.
    const filterOptions = useMemo(() => {
        const uniq = (key) => Array.from(new Set(slaList.map((s) => s[key]).filter(Boolean))).sort();
        return { contract: uniq("contract_type"), formula: uniq("formula_type"), status: uniq("status") };
    }, [slaList]);

    const filtersActive = !!slaFilters.formula_type;

    const filteredSlaList = useMemo(() => slaList.filter((s) =>
        // Pre-filter by the project's contract type (if supplied), then by the
        // only user-facing filter left: Formula.
        (!projectContractType || s.contract_type === projectContractType) &&
        (!slaFilters.formula_type || s.formula_type === slaFilters.formula_type)
    ), [slaList, slaFilters, projectContractType]);

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

    // Pick an SLA card: load its full details into the right-hand panel.
    function pickSla(s) {
        selectSla(s.id);
    }
    // Dismiss the details side-panel.
    function closeDetail() {
        setSelectedSlaId("");
        setSlaDetail(null);
        setShowMappingEdit(false);
        setMapSchema(null);
        setMapValues({});
    }
    // Drag the splitter to resize the details panel (wider / narrower), tab-style.
    function startResize(e) {
        e.preventDefault();
        const startX = e.clientX;
        const startW = panelWidth;
        const onMove = (ev) => setPanelWidth(Math.min(Math.max(startW - (ev.clientX - startX), 320), 920));
        const onUp = () => {
            window.removeEventListener("mousemove", onMove);
            window.removeEventListener("mouseup", onUp);
            document.body.style.userSelect = "";
        };
        window.addEventListener("mousemove", onMove);
        window.addEventListener("mouseup", onUp);
        document.body.style.userSelect = "none";
    }
    // Open the SLA image popup for a mapping row. Resolve the real attachment
    // image: try the already-loaded master, else fetch the SLA detail (which
    // always carries attachments), else fall back to the generated demo.
    async function openImagePreview(m) {
        setPreviewSla(m);
        setPreviewSrc("");
        const demo = demoTableImage({ ...m, title: m.sla_title });
        let url = slaImageUrl(slaList.find((s) => s.id === m.sla_id));
        if (!url && m.sla_id) {
            try {
                const res = await authorizedFetch(
                    `${baseUrl}/api/v3/sla-masters/${encodeURIComponent(m.sla_id)}`,
                    { method: "GET", headers: { Accept: "application/json" } }
                );
                const payload = await readJson(res);
                url = slaImageUrl(payload?.data || payload);
            } catch { /* fall through to the demo */ }
        }
        // Guard against a race if the user closed/changed selection meanwhile.
        setPreviewSla((cur) => {
            if (cur && cur.id === m.id) setPreviewSrc(url || demo);
            return cur;
        });
    }
    function closePreview() { setPreviewSla(null); setPreviewSrc(""); }

    return (
        <div className="uidai-pmis-content">
            {/* Header */}
            <div className="uidai-pmis-title">SLA → Activity Mapping &amp; Evaluation</div>

            {/* Which activity we're on, and the way back to the chooser. Shown on
                the picker too — that's where the mapping is actually created, so
                the activity has to stay in sight while browsing SLAs. */}
            {!chooserVisible && (
                <div className="uidai-pmis-filter-shell" style={{ marginBottom: 14, display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
                    <div style={{ minWidth: 0 }}>
                        <div style={{ fontSize: 11, fontWeight: 700, color: "var(--uidai-pmis-muted)", textTransform: "uppercase", letterSpacing: ".3px", marginBottom: 2 }}>Activity</div>
                        <div style={{ fontSize: 14, fontWeight: 800, color: "#173e77" }}>
                            {searchParams.get("activityName") || activityLabel}
                            {searchParams.get("activityCode") && (
                                <span style={{ ...muted, fontWeight: 400, fontFamily: "monospace", fontSize: 11, marginLeft: 8 }}>
                                    {searchParams.get("activityCode")}
                                </span>
                            )}
                        </div>
                    </div>
                    {/* Switching activity mid-selection would strand the picked
                        SLA, so the way out is only offered on the mapping view. */}
                    {view === "mapping" && (
                        <button
                            type="button"
                            className="uidai-pmis-btn uidai-pmis-btn-cancel uidai-pmis-btn-small"
                            style={{ marginTop: 0, marginLeft: "auto" }}
                            onClick={() => setChooserOpen(true)}
                        >
                            Change activity
                        </button>
                    )}
                </div>
            )}

            {/* CHOOSER — no activity yet (or the user asked to switch) */}
            {view === "mapping" && chooserVisible && (
                <ActivityChooser
                    milestones={tree}
                    loading={treeLoading}
                    error={treeError}
                    onReload={loadActivityTree}
                    onPick={pickActivity}
                    current={activityIdInput.trim()}
                />
            )}

            {/* PICKER — browse cards (left) + SLA details side-panel (right).
                Height is clamped, not a bare calc: on short viewports (or when
                the SLA System tab strip wraps) a raw calc collapses the panes. */}
            {view === "picker" && (
                <div style={{ display: "flex", gap: 14, alignItems: "stretch", height: "clamp(460px, calc(100vh - 220px), 1100px)" }}>
                    <div style={{ flex: "1 1 auto", minWidth: 320, minHeight: 0, display: "flex" }}>
                        <div className="uidai-pmis-card" style={{ marginBottom: 0, display: "flex", flexDirection: "column", height: "100%", width: "100%", overflow: "hidden", minHeight: 0 }}>
                    {/* Fixed top — header, filters, count (stay put while the cards scroll) */}
                    <div style={{ flex: "0 0 auto" }}>
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
                        <div className="uidai-pmis-filter-body" style={{ display: "flex", flexWrap: "wrap", gap: 14, alignItems: "flex-end", width: "100%" }}>
                            <div style={{ flex: "3 1 280px", minWidth: 220 }}>
                                <div style={filterFieldLabel}>Search</div>
                                <input
                                    className="uidai-pmis-filter-input"
                                    type="text"
                                    placeholder="Search by ref, title, contract, formula…"
                                    value={slaSearch}
                                    onChange={(e) => setSlaSearch(e.target.value)}
                                />
                            </div>
                            <div style={{ flex: "1 1 180px", minWidth: 160 }}>
                                <div style={filterFieldLabel}>Formula</div>
                                <select className="uidai-pmis-filter-select" value={slaFilters.formula_type}
                                    onChange={(e) => setSlaFilters((f) => ({ ...f, formula_type: e.target.value }))}>
                                    <option value="">All</option>
                                    {filterOptions.formula.map((c) => <option key={c} value={c}>{humanize(c)}</option>)}
                                </select>
                            </div>
                        </div>
                    </div>

                    {/* Result count */}
                    <div style={{ fontSize: 12, ...muted, margin: "14px 2px 10px" }}>
                        {pickerResults.length} SLA{pickerResults.length === 1 ? "" : "s"}
                        {projectContractType ? ` · contract: ${humanize(projectContractType)}` : ""}
                        {slaTotal > slaList.length ? ` · showing first ${slaList.length} of ${slaTotal}` : ""}
                    </div>
                    </div>{/* /fixed top */}

                    {/* Scrollable card grid — scrolls on its own, independent of the details panel */}
                    <div style={{ flex: "1 1 auto", minHeight: 0, overflowY: "auto", overflowX: "hidden", paddingRight: 4 }}>
                    {listLoading ? (
                        <div style={{ padding: 28, textAlign: "center", ...muted, fontSize: 13 }}>Loading SLAs…</div>
                    ) : pickerResults.length === 0 ? (
                        <div style={{ padding: 28, textAlign: "center", ...muted, fontSize: 13 }}>
                            {slaList.length === 0 ? "No SLA masters found." : "No SLAs match your search / filters."}
                        </div>
                    ) : (
                        <div style={{ display: "grid", gridTemplateColumns: selectedSlaId ? "repeat(auto-fill, minmax(200px, 1fr))" : "repeat(4, minmax(0, 1fr))", gap: 16, alignItems: "start", padding: "4px 2px 8px" }}>
                            {pickerResults.map((s) => (
                                <SlaCard key={s.id} sla={s} selected={s.id === selectedSlaId} mapped={mappedRefs.has(s.sla_ref)} onPick={() => pickSla(s)} />
                            ))}
                        </div>
                    )}
                    </div>{/* /scroll grid */}
                        </div>
                    </div>

                    {/* Drag handle — resize the details panel like a tab */}
                    {selectedSlaId && (
                        <div
                            onMouseDown={startResize}
                            title="Drag to resize the panel"
                            style={{ flex: "0 0 10px", alignSelf: "stretch", cursor: "col-resize", display: "flex", alignItems: "center", justifyContent: "center" }}
                        >
                            <div style={{ width: 4, height: 54, borderRadius: 3, background: "#c2d2e8" }} />
                        </div>
                    )}

                    {/* RIGHT — SLA details side-panel; own scroll, independent of the cards.
                        Width is user-resizable via the drag handle above. */}
                    {selectedSlaId && (
                    <div style={{ flex: `0 0 ${panelWidth}px`, maxWidth: "72%", minWidth: 320, minHeight: 0, display: "flex" }}>
                        <div className="uidai-pmis-card" style={{ marginBottom: 0, display: "flex", flexDirection: "column", height: "100%", width: "100%", overflow: "hidden", minHeight: 0 }}>
                    {/* Fixed top — title, actions, mapping fields, banners */}
                    <div style={{ flex: "0 0 auto" }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 12, marginBottom: 12 }}>
                        <div style={{ fontSize: 15, fontWeight: 800, color: "#173e77" }}>SLA Details</div>
                        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                            <button type="button" className="uidai-pmis-btn uidai-pmis-btn-cancel uidai-pmis-btn-small" style={{ marginTop: 0 }} onClick={() => setShowMappingEdit((v) => !v)}>
                                {showMappingEdit ? "Hide mapping fields" : "✎ Edit mapping"}
                            </button>
                            <button
                                type="button"
                                className="uidai-pmis-btn uidai-pmis-btn-small"
                                style={{ marginTop: 0 }}
                                onClick={createMapping}
                                title={mappedRefs.has(slaDetail?.sla_ref) ? "Already mapped to this activity" : undefined}
                                disabled={createLoading || detailLoading || !slaDetail || mappedRefs.has(slaDetail?.sla_ref)}
                            >
                                {createLoading ? "Mapping…" : mappedRefs.has(slaDetail?.sla_ref) ? "Already mapped" : "Map this SLA →"}
                            </button>
                            <button type="button" className="uidai-pmis-filter-toggle" onClick={closeDetail} title="Close panel" style={{ padding: "6px 10px" }}>✕</button>
                        </div>
                    </div>

                    {/* Map SLA to Activity — schema-driven form (GET …/mapping-form-schema).
                        Collapsed shows a summary; "Edit mapping" reveals the effective
                        window + any override inputs the SLA asks for. */}
                    <div className="uidai-pmis-filter-shell" style={{ marginBottom: 14 }}>
                        <div style={{ fontSize: 13, fontWeight: 800, color: "#173e77" }}>
                            {mapSchema?.question || "Map SLA to Activity"}
                        </div>
                        <div style={{ fontSize: 12, ...muted, marginTop: 4 }}>
                            Activity <code style={{ background: "#f1f6fd", padding: "2px 8px", borderRadius: 6, color: "#173e77", fontWeight: 700 }}>{activityLabel}</code>
                            {mapSchema?.applied_on_label ? <> · Applied on: <b style={{ color: "#173e77", fontWeight: 700 }}>{mapSchema.applied_on_label}</b></> : null}
                            {!showMappingEdit && <> · {effFrom || "—"} → {effUntil || "—"}</>}
                        </div>

                        {showMappingEdit && (
                            <>
                                {mapSchema?.explanation && (
                                    <div style={{ fontSize: 12, ...muted, marginTop: 8, lineHeight: 1.5 }}>{mapSchema.explanation}</div>
                                )}
                                {mapSchemaLoading && <div style={{ fontSize: 12, ...muted, marginTop: 8 }}>Loading mapping form…</div>}
                                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 14, marginTop: 12 }}>
                                    <div className="uidai-pmis-field" style={{ marginBottom: 0 }}>
                                        <label>Effective From</label>
                                        <input type="date" value={effFrom} onChange={(e) => setEffFrom(e.target.value)} />
                                    </div>
                                    <div className="uidai-pmis-field" style={{ marginBottom: 0 }}>
                                        <label>Effective Until <span style={{ ...muted, fontWeight: 400 }}>(optional)</span></label>
                                        <input type="date" value={effUntil} onChange={(e) => setEffUntil(e.target.value)} />
                                    </div>
                                    {(Array.isArray(mapSchema?.inputs) ? mapSchema.inputs : []).map((inp) => {
                                        const key = inp.name || inp.key;
                                        return (
                                            <div key={key} className="uidai-pmis-field" style={{ marginBottom: 0 }}>
                                                <label>
                                                    {inp.label || key}
                                                    {inp.required && <span style={{ color: "var(--uidai-pmis-red, #d32f2f)" }}> *</span>}
                                                    {inp.unit ? <span style={{ ...muted, fontWeight: 400 }}> ({inp.unit})</span> : null}
                                                </label>
                                                <SchemaInput input={inp} value={mapValues[key]} onChange={(v) => setMapValues((mv) => ({ ...mv, [key]: v }))} />
                                            </div>
                                        );
                                    })}
                                </div>
                            </>
                        )}
                    </div>
                    {createMessage && <Banner text={createMessage} />}
                    {detailError && <Banner text={detailError} />}
                    </div>{/* /fixed top */}

                    {/* Scrollable details body — opening accordions scrolls here, never the cards */}
                    <div style={{ flex: "1 1 auto", minHeight: 0, overflowY: "auto", paddingRight: 4, marginTop: 4 }}>
                    {detailLoading ? (
                        <div style={{ padding: 22, textAlign: "center", ...muted, fontSize: 13 }}>Loading SLA details…</div>
                    ) : slaDetail ? (
                        <div>
                            {/* Title strip */}
                            <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap", marginBottom: 8 }}>
                                <div style={{ fontSize: 16, fontWeight: 800, color: "#173e77" }}>{slaDetail.title || slaDetail.sla_ref || "SLA"}</div>
                                <span style={{ fontFamily: "monospace", fontSize: 12, color: "var(--uidai-pmis-muted)" }}>{slaDetail.sla_ref || "—"}</span>
                                <StatusBadge status={slaDetail.status} />
                            </div>

                            {/* RFP-style detail card — only the contract-document fields */}
                            <div className="uidai-pmis-table-wrap" style={{ marginTop: 0 }}>
                                <table className="uidai-pmis-table" style={{ minWidth: 0 }}>
                                    <tbody>
                                        <RfpRow label="SLA Number" value={slaDetail.sla_ref} mono />
                                        <RfpRow label="Title" value={slaDetail.title || slaDetail.name} />
                                        <RfpRow label="Category" value={slaDetail.category || (slaDetail.formula_type ? humanize(slaDetail.formula_type) : null)} />
                                        <RfpRow label="Contract Type" value={slaDetail.contract_type ? humanize(slaDetail.contract_type) : null} />
                                        <RfpRow label="Definition of SLA" value={slaDetail.description} />
                                        <RfpRow label="Scope of SLA" value={slaDetail.scope_text} />
                                        <RfpRow label="Source of Data" value={slaDetail.data_source} />
                                        <RfpRow label="SLA Calculation" value={slaDetail.calculation_method} />
                                        <tr>
                                            <th style={{ width: 170, background: "#f1f6fd", padding: "10px 12px", textAlign: "left", verticalAlign: "top", color: "#173e77", fontWeight: 700, fontSize: 11.5, textTransform: "uppercase", letterSpacing: ".3px" }}>Target (severity thresholds)</th>
                                            <td style={{ padding: "10px 12px", verticalAlign: "top" }}><TargetTable bands={slaDetail.condition_bands} lookup={slaDetail.lookup_table} /></td>
                                        </tr>
                                        <RfpRow label="Measurement Interval" value={slaDetail.measurement_interval ? humanize(slaDetail.measurement_interval) : null} />
                                        <RfpRow label="Reporting Interval" value={slaDetail.reporting_interval ? humanize(slaDetail.reporting_interval) : null} />
                                        <RfpRow label="Applied On" value={APPLIED_ON_LABEL[slaDetail.ld_computation_base] || (slaDetail.ld_computation_base ? humanize(slaDetail.ld_computation_base) : null)} />
                                        <RfpRow label="Reports submitted to" value={slaDetail.reports_submitted_to} />
                                        <RfpRow label="Active From" value={(slaDetail.effective_from || "").slice(0, 10) || null} />
                                        <RfpRow label="Active Until" value={slaDetail.effective_until ? slaDetail.effective_until.slice(0, 10) : null} />
                                        <RfpRow label="Status" value={<StatusBadge status={slaDetail.status} />} />
                                    </tbody>
                                </table>
                            </div>
                        </div>
                    ) : null}
                    </div>{/* /scroll details body */}
                        </div>
                    </div>
                    )}
                </div>
            )}

            {/* MAPPING — activity's current SLA mappings */}
            {view === "mapping" && !chooserVisible && (
                <div className="uidai-pmis-card">
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 12, marginBottom: 8 }}>
                        <div>
                            <div style={{ ...sectionHead, marginBottom: 0 }}>
                                Activity SLA Mappings
                                {mappings.length > 0 && <span style={{ marginLeft: 8, background: "#dceafe", color: "#1f4e87", borderRadius: 999, padding: "1px 9px", fontSize: 12, fontWeight: 800 }}>{mappings.length}</span>}
                            </div>
                        </div>
                        <div style={{ display: "flex", gap: 14, alignItems: "center" }}>
                            <label style={{ fontSize: 13, color: "var(--uidai-pmis-text)", display: "flex", alignItems: "center", gap: 6, fontWeight: 600 }}>
                                <input type="checkbox" style={{ width: "auto" }} checked={activeOnly} onChange={(e) => setActiveOnly(e.target.checked)} /> Active only
                            </label>
                            <button type="button" className="uidai-pmis-btn uidai-pmis-btn-cancel uidai-pmis-btn-small" style={{ marginTop: 0 }} onClick={loadMappings} disabled={mappingsLoading}>
                                {mappingsLoading ? "Loading…" : "↻ Reload"}
                            </button>
                            <button type="button" className="uidai-pmis-btn uidai-pmis-btn-cancel uidai-pmis-btn-small" style={{ marginTop: 0 }} onClick={() => setCopyOpen(true)} disabled={copyBusy}>
                                {copyBusy ? "Copying…" : "Copy from activity"}
                            </button>
                            <button type="button" className="uidai-pmis-btn uidai-pmis-btn-small" style={{ marginTop: 0 }} onClick={openPicker}>
                                + Map SLA
                            </button>
                        </div>
                    </div>
                    {mappingsError && <Banner text={mappingsError} />}
                    <div className="uidai-pmis-table-wrap">
                        <table className="uidai-pmis-table uidai-pmis-table-compact">
                            <thead>
                                <tr>
                                    <SortTh label="SLA Ref" col="sla_ref" sort={sort} onSort={toggleSort} />
                                    <SortTh label="SLA Title" col="sla_title" sort={sort} onSort={toggleSort} />
                                    <SortTh label="Status" col="status" sort={sort} onSort={toggleSort} />
                                    <th>In force</th>
                                    <SortTh label="Effective From" col="effective_from" sort={sort} onSort={toggleSort} />
                                    <SortTh label="Effective Until" col="effective_until" sort={sort} onSort={toggleSort} />
                                    <th style={{ textAlign: "center" }}>Actions</th>
                                </tr>
                            </thead>
                            <tbody>
                                {mappingsLoading ? (
                                    <tr><td colSpan={7} style={{ padding: 14, ...muted }}>Loading mappings…</td></tr>
                                ) : mappings.length === 0 ? (
                                    <tr><td colSpan={7} style={{ padding: 14, ...muted, fontSize: 13 }}>
                                        No SLAs mapped to this activity.
                                    </td></tr>
                                ) : sortedMappings.map((m) => {
                                    const isEditing = editingId === m.id;
                                    return (
                                        <tr key={m.id} style={{ background: isEditing ? "#fff8ec" : undefined }}>
                                            <td><span style={{ fontFamily: "monospace", fontSize: 12, fontWeight: 700, color: "#173e77", whiteSpace: "nowrap" }}>{m.sla_ref || "—"}</span></td>
                                            <td>{m.sla_title || "—"}</td>
                                            <td>
                                                {isEditing ? (
                                                    <select style={ctrl} value={editForm.status} onChange={(e) => setEditForm((f) => ({ ...f, status: e.target.value }))}>
                                                        {STATUS_OPTIONS.map((o) => <option key={o} value={o}>{o}</option>)}
                                                    </select>
                                                ) : <StatusBadge status={m.status} />}
                                            </td>
                                            <td><InForce state={forceState(m)} /></td>
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
                                                        <button type="button" className="uidai-pm-icon-btn" title="View SLA image" aria-label={`View SLA image for ${m.sla_ref || "mapping"}`} onClick={() => openImagePreview(m)}>👁</button>
                                                        <button type="button" className="uidai-pmis-btn uidai-pmis-btn-cancel uidai-pmis-btn-small" aria-label={`Edit mapping ${m.sla_ref || ""}`} onClick={() => startEdit(m)}>Edit</button>
                                                        {/* Labelled "Test" until now, but it POSTs to
                                                            /sla-evaluate/{sla_ref} with no dry-run flag — the
                                                            result is persisted and flows straight into the
                                                            rollup and the quarter's settlement. "Test" invited
                                                            people to try it out; it is also the only way to
                                                            record a manual observation, which is what the
                                                            compliance panel points people here to do. */}
                                                        <button type="button" className="uidai-pmis-btn uidai-pmis-btn-small" style={{ marginTop: 0 }} title="Record the observed value and score this SLA. The result is saved." aria-label={`Evaluate ${m.sla_ref || "mapping"}`} onClick={() => openSingleEval(m)}>Evaluate</button>
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

            {/* Test drawer — opened by a row's Test button. It slides over the
                page instead of sitting below the table, so the click has a
                visible effect and the mappings stay in view behind it. */}
            {view === "mapping" && !chooserVisible && singleEval && (
                <div
                    onMouseDown={(e) => { if (e.target === e.currentTarget) closeSingleEval(); }}
                    style={{ position: "fixed", inset: 0, background: "rgba(7,26,52,.35)", zIndex: 1500, display: "flex", justifyContent: "flex-end" }}
                >
                    <aside
                        role="dialog"
                        aria-label="Test SLA evaluation"
                        style={{
                            width: "min(920px, 92vw)", height: "100%", background: "#fff",
                            boxShadow: "-8px 0 28px rgba(7,26,52,.18)", display: "flex", flexDirection: "column",
                        }}
                    >
                        <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "12px 16px", borderBottom: "1px solid var(--uidai-pmis-border)" }}>
                            <div style={{ ...sectionHead, marginBottom: 0 }}>Test evaluation</div>
                            <span style={{ fontSize: 11.5, ...muted }}>ad-hoc run · result shows here only</span>
                            <button type="button" className="uidai-pmis-filter-toggle" style={{ marginLeft: "auto" }} onClick={closeSingleEval}>✕ Close</button>
                        </div>
                        <div style={{ flex: "1 1 auto", overflowY: "auto", padding: 16 }}>
                            <div style={{ display: "flex", gap: 18, alignItems: "flex-start", flexWrap: "wrap" }}>
                                <div style={{ flex: singleEvalResult !== null ? "1 1 380px" : "1 1 100%", minWidth: 0 }}>
                                {/* Which mapping we're evaluating */}
                                <div className="uidai-pmis-filter-shell" style={{ marginBottom: 14 }}>
                                    <div style={{ fontSize: 11, fontWeight: 700, color: "var(--uidai-pmis-muted)", textTransform: "uppercase", letterSpacing: ".3px", marginBottom: 2 }}>Mapping</div>
                                    <div style={{ fontSize: 14, fontWeight: 800, color: "#173e77" }}>
                                        {singleEval.sla_title || "Mapping"}
                                        <span style={{ ...muted, fontWeight: 400, fontFamily: "monospace", fontSize: 11, marginLeft: 8 }}>{singleEval.sla_ref}</span>
                                    </div>
                                </div>

                                {singleEval.loadingSchema ? (
                                    <div style={{ padding: 18, textAlign: "center", ...muted, fontSize: 13 }}>Loading evaluation form…</div>
                                ) : singleEval.schemaError ? (
                                    <Banner text={singleEval.schemaError} />
                                ) : singleEval.schema ? (
                                    <>
                                        {/* Question + explanation from the schema */}
                                        {(singleEval.schema.question || singleEval.schema.explanation) && (
                                            <div className="uidai-pmis-filter-shell" style={{ marginBottom: 14 }}>
                                                {singleEval.schema.question && <div style={{ fontSize: 14, fontWeight: 800, color: "#173e77" }}>{singleEval.schema.question}</div>}
                                                {singleEval.schema.explanation && <div style={{ fontSize: 12.5, ...muted, marginTop: 6, lineHeight: 1.5 }}>{singleEval.schema.explanation}</div>}
                                            </div>
                                        )}

                                        {/* Reporting period — start only; the end of the window is
                                            the backend's to decide, so it is neither asked nor sent. */}
                                        <div className="uidai-pmis-filter-shell" style={{ marginBottom: 14 }}>
                                            <div className="uidai-pmis-filter-head">
                                                <div className="uidai-pmis-filter-title">Reporting Period</div>
                                            </div>
                                            <div style={{ maxWidth: 260, marginTop: 12 }}>
                                                <div className="uidai-pmis-field" style={{ marginBottom: 0 }}>
                                                    <label>
                                                        {singleEval.schema.period?.label_start || singleEval.schema.label_start || "Period Start"}
                                                        {quarterLabel(singleEval.period_start) && (
                                                            <span style={{ ...muted, fontWeight: 400 }}> · {quarterLabel(singleEval.period_start)}</span>
                                                        )}
                                                    </label>
                                                    <input type="date" value={singleEval.period_start} readOnly style={{ background: "#f1f6fd" }} />
                                                </div>
                                            </div>
                                        </div>

                                        {/* Dynamic inputs — no metric keys; just what to measure */}
                                        {Array.isArray(singleEval.schema.inputs) && singleEval.schema.inputs.length > 0 && (
                                            <div className="uidai-pmis-filter-shell" style={{ marginBottom: 14 }}>
                                                <div className="uidai-pmis-filter-head">
                                                    <div className="uidai-pmis-filter-title">What you observed</div>
                                                </div>
                                                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 16, marginTop: 12 }}>
                                                    {singleEval.schema.inputs.map((inp) => (
                                                        <div key={inp.name} className="uidai-pmis-field" style={{ marginBottom: 0 }}>
                                                            <label>
                                                                {inp.label || inp.name}
                                                                {inp.required && <span style={{ color: "var(--uidai-pmis-red, #d32f2f)" }}> *</span>}
                                                                {inp.unit ? <span style={{ ...muted, fontWeight: 400 }}> ({inp.unit})</span> : null}
                                                            </label>
                                                            <SchemaInput
                                                                input={inp}
                                                                value={singleEval.values[inp.name]}
                                                                onChange={(v) => setSingleEval((s) => ({ ...s, values: { ...s.values, [inp.name]: v } }))}
                                                            />
                                                        </div>
                                                    ))}
                                                </div>
                                            </div>
                                        )}

                                        {/* Scoring bands — reference only */}
                                        {Array.isArray(singleEval.schema.bands) && singleEval.schema.bands.length > 0 && (
                                            <div className="uidai-pmis-filter-shell" style={{ marginBottom: 14 }}>
                                                <div className="uidai-pmis-filter-head">
                                                    <div className="uidai-pmis-filter-title">Scoring Bands</div>
                                                </div>
                                                <div style={{ marginTop: 12 }}>
                                                    <EvalBandsReference bands={singleEval.schema.bands} />
                                                </div>
                                            </div>
                                        )}

                                        <div>
                                            <button type="button" className="uidai-pmis-btn uidai-pmis-btn-small" style={{ marginTop: 0 }} onClick={submitSingleEval} disabled={singleEvalLoading}>
                                                {singleEvalLoading ? "Testing…" : "Test Evaluation"}
                                            </button>
                                        </div>
                                        {singleEvalError && <Banner text={singleEvalError} />}
                                    </>
                                ) : null}
                                </div>{/* /form column */}

                                {singleEvalResult !== null && (
                                    <div style={{ flex: "1 1 380px", minWidth: 0 }}>
                                        <div style={{ border: "1px solid var(--uidai-pmis-border)", borderRadius: 6, padding: 12 }}>
                                            <div style={subHead}>Result</div>
                                            <EvaluationResult data={singleEvalResult} />
                                        </div>
                                    </div>
                                )}
                            </div>
                        </div>
                    </aside>
                </div>
            )}

            {/* Copy mappings from another activity — same chooser as the main
                one, in a modal so the current mappings stay behind it. */}
            {copyOpen && (
                <div
                    onMouseDown={(e) => { if (e.target === e.currentTarget) setCopyOpen(false); }}
                    style={{ position: "fixed", inset: 0, background: "rgba(7,26,52,.35)", zIndex: 1500, display: "flex", alignItems: "flex-start", justifyContent: "center", padding: "6vh 16px" }}
                >
                    <div role="dialog" aria-label="Copy mappings from another activity" style={{ width: "min(720px, 100%)", maxHeight: "88vh", overflowY: "auto", background: "#fff", borderRadius: 8, padding: 16 }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 10 }}>
                            <div style={{ ...sectionHead, marginBottom: 0 }}>Copy mappings from</div>
                            <button type="button" className="uidai-pmis-filter-toggle" style={{ marginLeft: "auto" }} onClick={() => setCopyOpen(false)}>✕ Close</button>
                        </div>
                        <ActivityChooser
                            milestones={tree}
                            loading={treeLoading || copyBusy}
                            error={treeError}
                            onReload={loadActivityTree}
                            onPick={copyMappingsFrom}
                            current={activityIdInput.trim()}
                        />
                    </div>
                </div>
            )}

            {/* MAPPING — whole-activity evaluation, compliance record, settlement */}
            {view === "mapping" && !chooserVisible && (
                <div style={{ display: "flex", flexDirection: "column", gap: 14, alignItems: "start" }}>
                    {/* Whole-activity evaluate */}
                    <div className="uidai-pmis-card" style={{ marginBottom: 0, width: "100%" }}>
                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 12 }}>
                            <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                                <div style={{ ...sectionHead, marginBottom: 0 }}>Evaluate Whole Activity</div>
                                <span style={{ fontSize: 11.5, ...muted }}>ad-hoc run · result shows here only</span>
                            </div>
                            {!actEval ? (
                                <button type="button" className="uidai-pmis-btn uidai-pmis-btn-small" style={{ marginTop: 0 }} onClick={openActivityEval} disabled={actEvalBuilding}>
                                    {actEvalBuilding ? "Preparing…" : "Configure & Evaluate"}
                                </button>
                            ) : (
                                <button type="button" className="uidai-pmis-filter-toggle" onClick={closeActivityEval}>✕ Close</button>
                            )}
                        </div>
                        {actEvalError && <Banner text={actEvalError} />}

                        {/* The measured figures behind the resource SLAs, sat
                            directly above the form they get typed into. The
                            attendance system already knows them; before this
                            they lived on a different page, so filling this form
                            meant reading a number off one screen and retyping it
                            into another. Reference only — see the panel's own
                            note for why nothing is submitted from it. */}
                        <ResourceObservationPanel
                            projectId={projectId}
                            activityId={activityIdInput.trim()}
                        />

                        {actEval && (
                            <div style={{ display: "flex", gap: 18, alignItems: "flex-start", flexWrap: "wrap", marginTop: 12 }}>
                                <div style={{ flex: actEvalResult !== null ? "1 1 380px" : "1 1 100%", minWidth: 0 }}>
                                <div className="uidai-pmis-filter-shell">
                                    <div className="uidai-pmis-filter-head">
                                        <div className="uidai-pmis-filter-title">Evaluation Period</div>
                                    </div>
                                    <div style={{ display: "grid", gridTemplateColumns: "repeat(2,minmax(0,1fr))", gap: 16, maxWidth: 440, marginTop: 12 }}>
                                        <div className="uidai-pmis-field" style={{ marginBottom: 0 }}>
                                            <label>
                                                Period Start
                                                {quarterLabel(actEval.period_start) && (
                                                    <span style={{ ...muted, fontWeight: 400 }}> · {quarterLabel(actEval.period_start)}</span>
                                                )}
                                            </label>
                                            <input type="date" value={actEval.period_start} onChange={(e) => setActEval((a) => ({ ...a, period_start: e.target.value }))} />
                                        </div>
                                        <div className="uidai-pmis-field" style={{ marginBottom: 0 }}>
                                            <label>Period End</label>
                                            <input type="date" value={actEval.period_end} onChange={(e) => setActEval((a) => ({ ...a, period_end: e.target.value }))} />
                                        </div>
                                    </div>
                                </div>

                                <div style={{ fontSize: 12, fontWeight: 700, color: "var(--uidai-pmis-muted)", textTransform: "uppercase", letterSpacing: ".3px", margin: "18px 2px 2px" }}>
                                    SLAs to evaluate ({actEval.groups.length})
                                </div>

                                {actEval.groups.map((g, gi) => (
                                    <div key={g.sla_ref} className="uidai-pmis-filter-shell" style={{ marginTop: 14 }}>
                                        <div className="uidai-pmis-filter-head">
                                            <div className="uidai-pmis-filter-title">
                                                {g.sla_title || "SLA"}
                                                <span style={{ ...muted, fontWeight: 400, fontFamily: "monospace", fontSize: 11, marginLeft: 8 }}>{g.sla_ref}</span>
                                            </div>
                                        </div>
                                        <div style={{ marginTop: 12 }}>
                                            {g.schemaError ? (
                                                <div style={{ ...muted, fontSize: 12.5, fontStyle: "italic" }}>{g.schemaError}</div>
                                            ) : g.inputs.length === 0 ? (
                                                <div style={{ ...muted, fontSize: 12.5, fontStyle: "italic" }}>No input needed for this SLA.</div>
                                            ) : (
                                                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 12 }}>
                                                    {g.inputs.map((inp) => (
                                                        <div key={inp.name} className="uidai-pmis-field" style={{ marginBottom: 0 }}>
                                                            <label>
                                                                {inp.label || inp.name}
                                                                {inp.unit ? <span style={{ ...muted, fontWeight: 400 }}> ({inp.unit})</span> : null}
                                                            </label>
                                                            <SchemaInput
                                                                input={inp}
                                                                value={g.values[inp.name]}
                                                                onChange={(v) => setActEval((a) => ({ ...a, groups: a.groups.map((x, i) => i === gi ? { ...x, values: { ...x.values, [inp.name]: v } } : x) }))}
                                                            />
                                                        </div>
                                                    ))}
                                                </div>
                                            )}
                                        </div>
                                    </div>
                                ))}

                                <div style={{ marginTop: 14 }}>
                                    <button type="button" className="uidai-pmis-btn uidai-pmis-btn-small" style={{ marginTop: 0 }} onClick={submitActivityEval} disabled={actEvalLoading}>
                                        {actEvalLoading ? "Evaluating…" : "Evaluate All Active SLAs"}
                                    </button>
                                </div>
                                </div>{/* /form column */}

                                {actEvalResult !== null && (
                                    <div style={{ flex: "1 1 380px", minWidth: 0 }}>
                                        <div style={{ border: "1px solid var(--uidai-pmis-border)", borderRadius: 6, padding: 12 }}>
                                            <div style={subHead}>Result</div>
                                            <EvaluationResult data={actEvalResult} />
                                        </div>
                                    </div>
                                )}
                            </div>
                        )}
                    </div>
                    {/* Recorded compliance results for this activity + the
                        on-completion evaluation trigger. */}
                    {activityIdInput.trim() && (
                        <ActivityCompliancePanel activityId={activityIdInput.trim()} activityLabel={activityLabel} />
                    )}

                    {/* Quarterly settlement is PROJECT-scoped, not activity-scoped,
                        so it moved to its own page in the SLA System section
                        (/projects/:id/sla-settlement). Left as a pointer for
                        anyone who knew it by its old spot. */}
                    {projectId && (
                        <div className="uidai-pmis-filter-shell" style={{ width: "100%", display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
                            <div style={{ fontSize: 13.5, fontWeight: 800, color: "#173e77" }}>Quarterly LD Settlement</div>
                            <Link
                                to={`/projects/${encodeURIComponent(projectId)}/sla-settlement`}
                                className="uidai-pmis-btn uidai-pmis-btn-small"
                                style={{ marginTop: 0, marginLeft: "auto", textDecoration: "none", display: "inline-flex", alignItems: "center" }}
                            >
                                Open Settlement &amp; LD →
                            </Link>
                        </div>
                    )}
                </div>
            )}

            {/* SLA image popup — opened from the eye button on a mapping row */}
            {previewSla && (
                <div
                    onMouseDown={(e) => { if (e.target === e.currentTarget) closePreview(); }}
                    style={{ position: "fixed", inset: 0, background: "rgba(7,26,52,.55)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 2000, padding: 20 }}
                >
                    <div style={{ position: "relative", background: "#fff", borderRadius: 12, overflow: "hidden", boxShadow: "0 20px 60px rgba(0,0,0,.3)", maxWidth: "min(900px, 95vw)", maxHeight: "90vh", display: "flex", flexDirection: "column" }}>
                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, padding: "12px 14px", borderBottom: "1px solid var(--uidai-pmis-border)" }}>
                            <div style={{ fontWeight: 800, color: "#173e77", fontSize: 14, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                                {previewSla.sla_title || previewSla.sla_ref || "SLA"}
                                <span style={{ fontFamily: "monospace", fontWeight: 400, fontSize: 12, color: "var(--uidai-pmis-muted)", marginLeft: 8 }}>{previewSla.sla_ref}</span>
                            </div>
                            <button type="button" onClick={closePreview} title="Close" style={{ width: 30, height: 30, borderRadius: "50%", background: "#fdecec", border: "none", color: "#b42318", cursor: "pointer", fontSize: 15, fontWeight: 700, flex: "0 0 auto" }}>✕</button>
                        </div>
                        <div style={{ padding: 14, overflow: "auto", background: "#f6f9fd", minHeight: 140, display: "flex", alignItems: "center", justifyContent: "center" }}>
                            {previewSrc
                                ? <img src={previewSrc} alt={previewSla.sla_ref || "SLA"} style={{ display: "block", maxWidth: "100%", borderRadius: 8, border: "1px solid var(--uidai-pmis-border)" }} />
                                : <div style={{ ...muted, fontSize: 13 }}>Loading image…</div>}
                        </div>
                    </div>
                </div>
            )}

        </div>
    );
}