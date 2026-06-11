import React, { useEffect, useMemo, useState } from "react";
import { useParams, useSearchParams } from "react-router-dom";
import { authorizedFetch } from "../../api/client";
import "../../styles/global.css";

const STATUS_OPTIONS = ["ACTIVE", "RETIRED"];

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

function SlaCard({ sla, selected, onPick }) {
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
                    <StatusBadge status={sla.status} />
                </div>
            </div>
        </div>
    );
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
    QUARTERLY_PAYMENT: "Net Planned Quarterly Payment (NPQP)",
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

function bandBadgeClass(label) {
    const s = String(label || "").toLowerCase();
    if (/crit|breach|severe|fail|red|high/.test(s)) return "uidai-pmis-badge-red";
    if (/major|warn|amber|medium|moderate/.test(s)) return "uidai-pmis-badge-orange";
    if (/minor|ok|green|pass|low|none/.test(s)) return "uidai-pmis-badge-green";
    return "uidai-pmis-badge-orange";
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
    { key: "band_label", label: "Band", band: true },
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
        return <div style={{ fontSize: 12.5, color: "#1f8a4c", fontWeight: 600 }}>✓ No breaches recorded for this period.</div>;
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
                                if (c.band) return <td key={c.key}><span className={`uidai-pmis-badge ${bandBadgeClass(v)}`}>{v || "—"}</span></td>;
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

export default function ActivitySlasPage() {
    // Prefill the Activity ID when we're launched from an activity's node modal
    // (it navigates here with ?activityId=…), so the user lands ready to map.
    const [searchParams] = useSearchParams();
    // The route is /projects/:projectId/activity-slas — that id scopes the SLA
    // library to this project (sent as ?project_id= to the masters API). Allow a
    // ?project_id= query override too, in case the page is opened standalone.
    const { projectId: routeProjectId } = useParams();
    const projectId = routeProjectId || searchParams.get("project_id") || "";
    const activityLabel = searchParams.get("activityCode") || searchParams.get("activityName") || activityIdInput;

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
    // Whether the mapping (effective dates) editor is expanded in the SLA
    // Details panel.
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
            period_start: today(), period_end: today(), values: {},
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
            setSingleEval((s) => (s && s.sla_ref === m.sla_ref ? {
                ...s,
                schema,
                loadingSchema: false,
                period_start: schema?.start_default || s.period_start,
                period_end: schema?.end_default || s.period_end,
                values: {},
            } : s));
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
            const body = {
                period_start: singleEval.period_start,
                period_end: singleEval.period_end,
            };
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
            if (!singleEval.period_start || !singleEval.period_end) missing.push("Reporting period");
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
                if (sc?.start_default) ps = sc.start_default;
                if (sc?.end_default) pe = sc.end_default;
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
            <div className="uidai-pmis-subtitle" style={{ marginTop: -10 }}>
                {view === "picker"
                    ? "Search the SLA library, view an SLA, then map it to this activity."
                    : "Review the SLAs mapped to this activity, map new ones, and evaluate."}
            </div>

            {/* PICKER — browse cards (left) + SLA details side-panel (right) */}
            {view === "picker" && (
                <div style={{ display: "flex", gap: 14, alignItems: "stretch", height: "calc(100vh - 200px)", minHeight: 460 }}>
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
                                <SlaCard key={s.id} sla={s} selected={s.id === selectedSlaId} onPick={() => pickSla(s)} />
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
                            <button type="button" className="uidai-pmis-btn uidai-pmis-btn-small" style={{ marginTop: 0 }} onClick={createMapping} disabled={createLoading || detailLoading || !slaDetail}>
                                {createLoading ? "Mapping…" : "Map this SLA →"}
                            </button>
                            <button type="button" className="uidai-pmis-filter-toggle" onClick={closeDetail} title="Close panel" style={{ padding: "6px 10px" }}>✕</button>
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
                            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 16 }}>
                                <div className="uidai-pmis-field" style={{ marginBottom: 0 }}>
                                    <label>Activity ID</label>
                                    <input type="text" value={activityLabel} readOnly style={{ background: "#f1f6fd" }}
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
                                            <td>{m.contract_type ? humanize(m.contract_type) : "—"}</td>
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
                                                        <button type="button" className="uidai-pm-icon-btn" title="View SLA image" onClick={() => openImagePreview(m)}>👁</button>
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
                <div style={{ display: "flex", flexDirection: "column", gap: 22, alignItems: "start" }}>
                    {/* Single-mapping evaluate */}
                    <div className="uidai-pmis-card" style={{ marginBottom: 0, width: "100%" }}>
                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, marginBottom: 12 }}>
                            <div style={{ ...sectionHead, marginBottom: 0 }}>Evaluate a Mapping</div>
                            {singleEval && <button type="button" className="uidai-pmis-filter-toggle" onClick={closeSingleEval}>✕ Close</button>}
                        </div>
                        {!singleEval ? (
                            <div style={{ padding: 18, textAlign: "center", ...muted, fontSize: 12 }}>Click “Evaluate” on a mapping above to evaluate a single SLA.</div>
                        ) : (
                            <div style={{ display: "flex", gap: 18, alignItems: "flex-start", flexWrap: "wrap" }}>
                                <div style={{ flex: singleEvalResult !== null ? "1 1 380px" : "1 1 100%", minWidth: 0 }}>
                                {/* Which mapping we're evaluating */}
                                <div className="uidai-pmis-filter-shell" style={{ marginBottom: 14, display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
                                    <div>
                                        <div style={{ fontSize: 11, fontWeight: 700, color: "var(--uidai-pmis-muted)", textTransform: "uppercase", letterSpacing: ".3px", marginBottom: 2 }}>Mapping</div>
                                        <div style={{ fontSize: 14, fontWeight: 800, color: "#173e77" }}>
                                            {singleEval.sla_title || "Mapping"}
                                            <span style={{ ...muted, fontWeight: 400, fontFamily: "monospace", fontSize: 11, marginLeft: 8 }}>{singleEval.sla_ref}</span>
                                        </div>
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

                                        {/* Reporting period (labels + defaults from the schema) */}
                                        <div className="uidai-pmis-filter-shell" style={{ marginBottom: 14 }}>
                                            <div className="uidai-pmis-filter-head">
                                                <div className="uidai-pmis-filter-title">Reporting Period</div>
                                            </div>
                                            <div style={{ display: "grid", gridTemplateColumns: "repeat(2,minmax(0,1fr))", gap: 16, maxWidth: 440, marginTop: 12 }}>
                                                <div className="uidai-pmis-field" style={{ marginBottom: 0 }}>
                                                    <label>{singleEval.schema.label_start || "Period Start"}</label>
                                                    <input type="date" value={singleEval.period_start} onChange={(e) => setSingleEval((s) => ({ ...s, period_start: e.target.value }))} />
                                                </div>
                                                <div className="uidai-pmis-field" style={{ marginBottom: 0 }}>
                                                    <label>{singleEval.schema.label_end || "Period End"}</label>
                                                    <input type="date" value={singleEval.period_end} onChange={(e) => setSingleEval((s) => ({ ...s, period_end: e.target.value }))} />
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
                                                            {inp.help && <div style={{ fontSize: 11, ...muted, marginTop: 4 }}>{inp.help}</div>}
                                                        </div>
                                                    ))}
                                                </div>
                                            </div>
                                        )}

                                        {/* Scoring bands — reference only */}
                                        {Array.isArray(singleEval.schema.bands) && singleEval.schema.bands.length > 0 && (
                                            <div className="uidai-pmis-filter-shell" style={{ marginBottom: 14 }}>
                                                <div className="uidai-pmis-filter-head">
                                                    <div className="uidai-pmis-filter-title">Scoring Bands <span style={{ ...muted, fontWeight: 400, fontSize: 11, textTransform: "none", letterSpacing: 0 }}>(reference)</span></div>
                                                </div>
                                                <div style={{ marginTop: 12 }}>
                                                    <EvalBandsReference bands={singleEval.schema.bands} />
                                                </div>
                                            </div>
                                        )}

                                        <div>
                                            <button type="button" className="uidai-pmis-btn" style={{ marginTop: 0 }} onClick={submitSingleEval} disabled={singleEvalLoading}>
                                                {singleEvalLoading ? "Evaluating…" : "⚡ Run Evaluation"}
                                            </button>
                                        </div>
                                        {singleEvalError && <Banner text={singleEvalError} />}
                                    </>
                                ) : null}
                                </div>{/* /form column */}

                                {singleEvalResult !== null && (
                                    <div style={{ flex: "1 1 380px", minWidth: 0 }}>
                                        <div className="uidai-pmis-card" style={{ marginTop: 0, marginBottom: 0, boxShadow: "var(--uidai-pmis-shadow-soft)" }}>
                                            <div style={{ fontSize: 14, fontWeight: 800, color: "#173e77", display: "flex", alignItems: "center", gap: 8 }}>
                                                <span aria-hidden="true">📊</span> Evaluation Result
                                            </div>
                                            <EvaluationResult data={singleEvalResult} />
                                        </div>
                                    </div>
                                )}
                            </div>
                        )}
                    </div>

                    {/* Whole-activity evaluate */}
                    <div className="uidai-pmis-card" style={{ marginBottom: 0, width: "100%" }}>
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
                        <div style={{ fontSize: 12, ...muted, marginTop: 8 }}>
                            Evaluates every active SLA mapping on activity{" "}
                            <code style={{ background: "#f1f6fd", padding: "2px 8px", borderRadius: 6, color: "#173e77", fontWeight: 700 }}>{activityLabel}</code>.
                        </div>
                        {actEvalError && <Banner text={actEvalError} />}

                        {actEval && (
                            <div style={{ display: "flex", gap: 18, alignItems: "flex-start", flexWrap: "wrap", marginTop: 14 }}>
                                <div style={{ flex: actEvalResult !== null ? "1 1 380px" : "1 1 100%", minWidth: 0 }}>
                                <div className="uidai-pmis-filter-shell">
                                    <div className="uidai-pmis-filter-head">
                                        <div className="uidai-pmis-filter-title">Evaluation Period</div>
                                    </div>
                                    <div style={{ display: "grid", gridTemplateColumns: "repeat(2,minmax(0,1fr))", gap: 16, maxWidth: 440, marginTop: 12 }}>
                                        <div className="uidai-pmis-field" style={{ marginBottom: 0 }}>
                                            <label>Period Start</label>
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
                                                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 16 }}>
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
                                                            {inp.help && <div style={{ fontSize: 11, ...muted, marginTop: 4 }}>{inp.help}</div>}
                                                        </div>
                                                    ))}
                                                </div>
                                            )}
                                        </div>
                                    </div>
                                ))}

                                <div style={{ marginTop: 14 }}>
                                    <button type="button" className="uidai-pmis-btn" style={{ marginTop: 0 }} onClick={submitActivityEval} disabled={actEvalLoading}>
                                        {actEvalLoading ? "Evaluating…" : "⚡ Evaluate All Active SLAs"}
                                    </button>
                                </div>
                                </div>{/* /form column */}

                                {actEvalResult !== null && (
                                    <div style={{ flex: "1 1 380px", minWidth: 0 }}>
                                        <div className="uidai-pmis-card" style={{ marginTop: 0, marginBottom: 0, boxShadow: "var(--uidai-pmis-shadow-soft)" }}>
                                            <div style={{ fontSize: 14, fontWeight: 800, color: "#173e77", display: "flex", alignItems: "center", gap: 8 }}>
                                                <span aria-hidden="true">📊</span> Activity Evaluation Result
                                                <span style={{ ...muted, fontWeight: 400, fontSize: 12 }}>· one section per SLA</span>
                                            </div>
                                            <EvaluationResult data={actEvalResult} />
                                        </div>
                                    </div>
                                )}
                            </div>
                        )}
                    </div>
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