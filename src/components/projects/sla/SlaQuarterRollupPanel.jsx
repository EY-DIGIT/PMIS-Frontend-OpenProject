/* ══════════════════════════════════════════════════════════════════
   Per-SLA quarterly rollup — "what did each SLA actually cost us, and
   which activities caused it?"

   The Settlement page answers the money question (one flat row per SLA,
   then NPQP and the cap). It cannot answer the audit question, because
   the evidence — which deliverable breached, by how many days, scored at
   what severity — only exists per ACTIVITY. This panel joins the two:
   group by SLA, expand to the activities underneath, and show the points
   accumulating into the LD band.

   Data assembly is a client-side fan-out. There is no project-wide
   "every result grouped by SLA" endpoint, so the project tree is walked
   and GET /sla-compliance/activities/{id} is called per activity. That
   is done ONCE per project and cached in state: changing year or quarter
   re-filters what is already loaded rather than re-fetching, which is
   what makes flipping between quarters instant.

   Quarters here are CONTRACT quarters measured from the project's start
   date (T0), matching how the RFP schedules deliverables (T0 + n months)
   and counts QGR instalments — not calendar or financial quarters.
   ══════════════════════════════════════════════════════════════════ */
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { loadProjectTree } from "../../../api/milestoneConfigApi";
import {
    getActivityCompliance,
    getNpqp,
    getSeverityMaster,
    getLdBands,
    listSlaMasters,
    hydrateSlaMasters,
    getQuarterlyAggregate,
    listSettlements,
    getSettlement,
    overrideSettlement,
} from "../../../api/slaCompliance";
import { getPaymentPage, isFinanceForbidden } from "../../../api/paymentPage";
import {
    contractQuarters,
    contractQuarterFor,
    overlappingCalendarQuarters,
    blendNpqp,
    withinWindow,
    rollupBySla,
    quarterTotals,
    deliverableTotals,
    combinedCapCheck,
    TRACK,
    SCORING,
    STATUS,
    normalizeStatus,
} from "../../../utils/project/slaRollup";
import { recheckSla, detectCarryForward, severityForValue, METHOD } from "../../../utils/project/slaReporting";
import {
    listDrafts, saveDraft, removeDraft, clearDrafts, applyDrafts, observationKey,
} from "../../../utils/project/localObservations";
import {
    collectResourceActivities,
    deriveQuarterlyResourcePlan,
    compareFToPlan,
} from "../../../utils/project/resourcePlan";
import { fetchReplacementsForActivities } from "../../../api/attendanceReport";
import {
    normalizeReplacementReport,
    occupancyForWindow,
    occupancyByInterval,
    sla007Adjustment,
} from "../../../utils/project/resourceReplacements";
import {
    buildSettlementChain,
    taxBreakdown,
    cumulativePayout,
    contractCeiling,
} from "../../../utils/project/settlementChain";
import { buildDeliverablePayables } from "../../../utils/project/deliverablePayable";
import { formatINR } from "../../../utils/project/helpers";

const muted = { color: "var(--uidai-pmis-muted)" };
const RED = "#c0392b";
const GREEN = "#1f8a4c";
const AMBER = "#c77700";
const INK = "#173e77";

/* Requests run a few at a time rather than all at once: a large project
   has hundreds of activities and firing every request together stalls the
   browser's connection pool and can trip backend rate limits. Six keeps
   the wall-clock short without flooding anything. */
const FAN_OUT_CONCURRENCY = 6;

/* The folded "N things to check" diagnostics panel. Off for now.
   The `issues` memo behind it still runs — it also feeds the blocking
   count used elsewhere — so this is a display switch, not a removal. */
const SHOW_ISSUE_PANEL = false;

function num(v, digits = 2) {
    if (v === null || v === undefined || v === "") return "—";
    const n = Number(v);
    return Number.isNaN(n) ? String(v) : n.toLocaleString("en-IN", { maximumFractionDigits: digits });
}
function pct(v) {
    if (v === null || v === undefined || v === "") return "—";
    const n = Number(v);
    return Number.isNaN(n) ? String(v) : `${n}%`;
}
function money(v) {
    return v === null || v === undefined || v === "" ? "—" : formatINR(v);
}

/* ─── dates ────────────────────────────────────────────────────────
   Parsed as UTC midnight rather than through `new Date(iso)`, which a
   browser reads as UTC but then renders in local time — enough, west of
   Greenwich, to show a quarter starting the day before it does. */
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const DAY_MS = 86400000;

function parseIso(iso) {
    const [y, m, d] = String(iso ?? "").split("-").map(Number);
    if (!y || !m || !d) return null;
    const dt = new Date(Date.UTC(y, m - 1, d));
    return Number.isNaN(dt.getTime()) ? null : dt;
}
function longDate(iso) {
    const dt = parseIso(iso);
    if (!dt) return iso || "—";
    return `${String(dt.getUTCDate()).padStart(2, "0")} ${MONTHS[dt.getUTCMonth()]} ${dt.getUTCFullYear()}`;
}
/* Inclusive of both endpoints: 10 May → 09 Aug is 92 days of obligation,
   not 91 gaps between them. */
function daysBetween(fromIso, toIso) {
    const from = parseIso(fromIso);
    const to = parseIso(toIso);
    if (!from || !to) return null;
    return Math.round((to - from) / DAY_MS) + 1;
}
function todayIso() {
    const n = new Date();
    return `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, "0")}-${String(n.getDate()).padStart(2, "0")}`;
}
/* Inclusive of both endpoints, on ISO strings. Same rule as the period
   strip's day count, kept here so the settlement check does not depend on
   the staffing module. */
function inclusiveDaysOf(startIso, endIso) {
    const a = parseIso(startIso);
    const b = parseIso(endIso);
    if (!a || !b) return 0;
    return Math.max(0, Math.round((b - a) / DAY_MS) + 1);
}
function isoOfUtc(dt) {
    return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, "0")}-${String(dt.getUTCDate()).padStart(2, "0")}`;
}

/* First present value among several candidate field names.

   The backend's casing is not consistent across services — `qgrTotal`
   here, `qgr_total` there — and both spellings of "instal(l)ment" are in
   circulation. Reading a list of candidates is duller than agreeing one
   name, but it degrades to "not available" instead of to a wrong number,
   which is the property that matters for a figure on an invoice. */
function pick(source, names) {
    for (const src of Array.isArray(source) ? source : [source]) {
        if (!src) continue;
        for (const n of names) {
            const v = src[n];
            if (v !== null && v !== undefined && v !== "") {
                const num = Number(v);
                if (Number.isFinite(num)) return num;
            }
        }
    }
    return null;
}
/* ─── SLA categories ──────────────────────────────────────────────
   The library stores a category code per SLA; the rollup groups and
   filters by it. Both sentinels are strings that cannot collide with a
   real code, because a project that genuinely named a category "ALL"
   would otherwise hijack the tab. */
const ALL_CATEGORIES = "__all__";
const UNCATEGORISED = "__none__";

/* DELIVERABLE_SUBMISSION → "Deliverable Submission". Read off the code
   rather than a lookup table so a category added to the library needs no
   change here — and an unrecognised one still reads as words. */
function humanizeCategory(code) {
    if (code === UNCATEGORISED) return "Uncategorised";
    return String(code || "")
        .split(/[^A-Za-z0-9]+/)
        .filter(Boolean)
        .map((w) => (w.length <= 3 && w === w.toUpperCase() ? w : w[0].toUpperCase() + w.slice(1).toLowerCase()))
        .join(" ") || "Uncategorised";
}

/* A stable accent per category, assigned by position rather than by
   hashing the name — a hash gives two adjacent categories similar hues
   often enough to be worth avoiding, and the order here is already
   stable. Muted on purpose: the dot identifies, red/amber still mean
   "this cost money". */
const CATEGORY_DOTS = ["#2f6fd0", "#1f8a4c", "#8a5cd6", "#c77700", "#0f8ea3", "#c0392b", "#6b7a8f"];
const categoryDot = (i) => CATEGORY_DOTS[i % CATEGORY_DOTS.length];

/* One pill per category, plus All. Counts and cost sit on the pill so the
   bar answers "where did this quarter's penalty come from" before anything
   is clicked — which is the question most readers arrive with. */
function CategoryTabs({ categories, active, onSelect, dotFor }) {
    if (!categories.length) return null;
    const total = categories.reduce((n, c) => n + c.items.length, 0);

    const pill = (isActive, accent) => ({
        display: "inline-flex", alignItems: "center", gap: 7,
        border: `1px solid ${isActive ? accent : "var(--uidai-pmis-border)"}`,
        background: isActive ? accent : "#fff",
        color: isActive ? "#fff" : INK,
        borderRadius: 999, padding: "6px 13px", cursor: "pointer",
        font: "inherit", fontSize: 12, fontWeight: 700, whiteSpace: "nowrap",
        boxShadow: isActive ? "0 1px 3px rgba(23,62,119,.25)" : "none",
        transition: "background .12s ease, border-color .12s ease",
    });
    const countChip = (isActive) => ({
        background: isActive ? "rgba(255,255,255,.25)" : "#eef3fb",
        color: isActive ? "#fff" : "#1f4e87",
        borderRadius: 999, padding: "0 7px", fontSize: 11, fontWeight: 800,
    });

    return (
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 14, alignItems: "center" }}>
            <button type="button" style={pill(active === ALL_CATEGORIES, INK)} onClick={() => onSelect(ALL_CATEGORIES)}>
                All
                <span style={countChip(active === ALL_CATEGORIES)}>{total}</span>
            </button>

            {categories.map((c, i) => {
                const isActive = active === c.code;
                const accent = dotFor(i);
                const costs = c.track === TRACK.DELIVERABLE ? c.ldAmount > 0 : c.ldPercent > 0;
                return (
                    <button
                        key={c.code}
                        type="button"
                        style={pill(isActive, accent)}
                        onClick={() => onSelect(isActive ? ALL_CATEGORIES : c.code)}
                        title={`${c.label} · ${c.items.length} SLA(s) · ${c.breached} breach(es)`}
                    >
                        <span style={{
                            width: 8, height: 8, borderRadius: "50%", flex: "0 0 auto",
                            background: isActive ? "#fff" : accent,
                        }} />
                        {c.label}
                        <span style={countChip(isActive)}>{c.items.length}</span>
                        {/* Only shown when it cost something — a zero here would
                            be noise on every clean category. */}
                        {costs && (
                            <span style={{ fontSize: 11, fontWeight: 800, color: isActive ? "#fff" : RED }}>
                                {c.track === TRACK.DELIVERABLE ? money(c.ldAmount) : pct(Math.round(c.ldPercent * 100) / 100)}
                            </span>
                        )}
                    </button>
                );
            })}
        </div>
    );
}

/* A one-line "what you are looking at is wider than what you filtered to"
   marker. Only rendered while a filter is on: on the unfiltered view there
   is nothing to disambiguate and it would just be another line of text. */
function FilterScopeNote({ active, text }) {
    if (!active) return null;
    return (
        <div style={{ fontSize: 11, ...muted, marginTop: 10, display: "flex", alignItems: "center", gap: 6 }}>
            <span style={{ fontSize: 10 }}>◍</span>
            {text}
        </div>
    );
}

/* The sub-header above one category's SLA groups. Deliberately lighter
   than SectionHead — this sits INSIDE a track section, and giving it the
   same weight would make the page read as twice as many sections. */
function CategoryBlock({ cat, accent }) {
    const costs = cat.track === TRACK.DELIVERABLE ? cat.ldAmount > 0 : cat.ldPercent > 0;
    return (
        <div style={{
            display: "flex", alignItems: "center", gap: 9, flexWrap: "wrap",
            marginTop: 16, paddingBottom: 6, borderBottom: "1px solid var(--uidai-pmis-border)",
        }}>
            <span style={{ width: 9, height: 9, borderRadius: "50%", background: accent, flex: "0 0 auto" }} />
            <span style={{ fontSize: 12.5, fontWeight: 800, color: INK }}>{cat.label}</span>
            <span style={{ fontSize: 11, ...muted }}>
                {cat.items.length} SLA{cat.items.length === 1 ? "" : "s"}
            </span>

            <span style={{ marginLeft: "auto", display: "inline-flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
                {cat.breached > 0 && (
                    <span className="uidai-pmis-badge uidai-pmis-badge-red">{cat.breached} breached</span>
                )}
                {cat.met > 0 && <span className="uidai-pmis-badge uidai-pmis-badge-green">{cat.met} met</span>}
                {cat.pending > 0 && (
                    <span className="uidai-pmis-badge uidai-pmis-badge-orange">{cat.pending} awaiting</span>
                )}
                {cat.excluded > 0 && (
                    <span className="uidai-pmis-badge uidai-pmis-badge-grey">{cat.excluded} excluded</span>
                )}
                {costs && (
                    <span style={{ fontSize: 12.5, fontWeight: 800, color: RED, fontVariantNumeric: "tabular-nums" }}>
                        {cat.track === TRACK.DELIVERABLE ? money(cat.ldAmount) : pct(Math.round(cat.ldPercent * 100) / 100)}
                    </span>
                )}
                {cat.mixedTrack && (
                    <span
                        className="uidai-pmis-badge uidai-pmis-badge-orange"
                        title="This category holds SLAs charged on different bases — one on a deliverable's cost, one on NPQP. Check the category on those SLAs in the library."
                    >
                        ⚠ mixed base
                    </span>
                )}
            </span>
        </div>
    );
}

/* Which SLA the staffing figures actually belong to.

   Matched on the reference number rather than the title: the refs differ
   by project (PMU_SLA007, PMC-SLA007_, …) but the 007 is the RFP's and
   does not move, whereas titles are free text and get edited. The title
   check is a fallback for a library that renumbered. */
function isResourceDeploymentSla(item) {
    /* Read as a NUMBER, not matched as text — the refs carry leading zeros
       and trailing separators (PMC-SLA007_) that defeat a word boundary,
       and "SLA070" must not read as 7. */
    const m = /SLA[^0-9]*(\d+)/.exec(String(item?.slaRef || "").toUpperCase());
    if (m && Number(m[1]) === 7) return true;
    return /deployment of resource|resource deployment/i.test(String(item?.slaTitle || ""));
}

function severityAccent(level) {
    const n = Number(level);
    if (!Number.isFinite(n)) return INK;
    if (n >= 3) return RED;
    if (n === 2) return AMBER;
    return GREEN;
}
/* Keyed on the NORMALIZED status, not the raw backend string. The wire
   values are enum names — `pending_observation`, `excluded` — and
   matching them literally is what made an activity with two unread SLAs
   report zero of everything. */
const RESULT_BADGE = {
    [STATUS.BREACHED]: "uidai-pmis-badge-red",
    [STATUS.MET]: "uidai-pmis-badge-green",
    [STATUS.PENDING]: "uidai-pmis-badge-orange",
    [STATUS.EXCLUDED]: "uidai-pmis-badge-grey",
};

/* What the status means to a reader, rather than its enum name.
   `pending_observation` in particular is not "we are waiting for time to
   pass" — it is "somebody has to go and type in what was observed". */
const STATUS_LABEL = {
    [STATUS.BREACHED]: "breached",
    [STATUS.MET]: "met",
    [STATUS.PENDING]: "awaiting observation",
    [STATUS.EXCLUDED]: "excluded",
    [STATUS.UNKNOWN]: "unknown",
};

function StatusBadge({ status }) {
    const kind = normalizeStatus(status);
    return (
        <span
            className={`uidai-pmis-badge ${RESULT_BADGE[kind] || "uidai-pmis-badge-orange"}`}
            title={kind === STATUS.PENDING
                ? "The evaluation ran but this SLA is not date-derivable — enter the observed value on Activity SLA Mapping."
                : kind === STATUS.EXCLUDED
                    ? "Deliberately outside the calculation — e.g. a resource whose replacement UIDAI initiated (SLA 007 Note). Scores no points."
                    : status || undefined}
        >
            {STATUS_LABEL[kind] || status || "—"}
        </span>
    );
}

function Banner({ text, kind }) {
    if (!text) return null;
    const bad = kind === "error";
    return (
        <div
            className={`uidai-pmis-badge ${bad ? "uidai-pmis-badge-red" : "uidai-pmis-badge-green"}`}
            style={{
                display: "block", borderRadius: 8, padding: "10px 12px", marginTop: 12,
                fontWeight: 600, whiteSpace: "pre-line",
            }}
        >
            {text}
        </div>
    );
}

function Tile({ label, value, accent, hint }) {
    return (
        <div style={{ background: "#f6f9fd", border: "1px solid var(--uidai-pmis-border)", borderRadius: 10, padding: "12px 14px" }}>
            <div style={{ fontSize: 11, ...muted, fontWeight: 700, marginBottom: 6, textTransform: "uppercase", letterSpacing: ".3px" }}>
                {label}
            </div>
            <div style={{ fontSize: 20, fontWeight: 800, color: accent || INK, lineHeight: 1.15, wordBreak: "break-word" }}>
                {value}
            </div>
            {hint && <div style={{ fontSize: 11, ...muted, marginTop: 4 }}>{hint}</div>}
        </div>
    );
}

/* ─── the quarter's dates ─────────────────────────────────────────
   The year and quarter are already sitting in the pickers above, so
   restating "Year 1 · Q3" here is noise. What a reader cannot get from
   those pickers is WHICH DATES the quarter covers — and because contract
   quarters are counted from the project's start date rather than from
   January, they are never the dates anyone would guess. That, and how
   far through the window we are, is all this strip says. */
function EdgeDate({ caption, iso, align = "left" }) {
    const dt = parseIso(iso);
    return (
        <div style={{ textAlign: align, minWidth: 84 }}>
            <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: ".5px", textTransform: "uppercase", ...muted }}>
                {caption}
            </div>
            <div style={{ fontSize: 19, fontWeight: 800, color: INK, lineHeight: 1.15, marginTop: 4, whiteSpace: "nowrap" }}>
                {dt ? `${String(dt.getUTCDate()).padStart(2, "0")} ${MONTHS[dt.getUTCMonth()]}` : (iso || "—")}
            </div>
            <div style={{ fontSize: 11, ...muted, marginTop: 1 }}>{dt ? dt.getUTCFullYear() : " "}</div>
        </div>
    );
}

function PeriodStrip({ period, contractStart }) {
    const total = daysBetween(period?.start, period?.end);
    const now = todayIso();

    /* Three states, and they mean genuinely different things to a reader:
       a quarter still running has figures that will keep moving, a closed
       one is final, and a future one is not a mistake — it is what the
       picker lands on when someone looks ahead. */
    let phase = "open";
    if (period?.start && now < period.start) phase = "future";
    else if (period?.end && now > period.end) phase = "closed";

    const elapsed = phase === "open" ? daysBetween(period.start, now) : null;
    const remaining = phase === "open" && total && elapsed ? total - elapsed : null;
    const fill = phase === "closed" ? 1 : phase === "future" ? 0
        : (total && elapsed ? Math.min(1, Math.max(0, elapsed / total)) : 0);

    const tone = phase === "closed" ? INK : phase === "future" ? "var(--uidai-pmis-muted)" : GREEN;
    const stateText = phase === "closed" ? "Closed"
        : phase === "future" ? "Not started"
            : remaining === 0 ? "Closes today" : `${remaining} day${remaining === 1 ? "" : "s"} left`;

    return (
        <div
            style={{
                marginTop: 12, padding: "14px 16px", borderRadius: 12,
                background: "#f6f9fd", border: "1px solid var(--uidai-pmis-border)",
            }}
        >
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, marginBottom: 10, flexWrap: "wrap" }}>
                <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: ".5px", textTransform: "uppercase", ...muted }}>
                    Reporting interval
                </div>
                <div style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 12, fontWeight: 700, color: tone }}>
                    <span style={{ width: 7, height: 7, borderRadius: "50%", background: tone, display: "inline-block" }} />
                    {stateText}
                </div>
            </div>

            <div style={{ display: "flex", alignItems: "flex-end", gap: 16, flexWrap: "wrap" }}>
                <EdgeDate caption="From" iso={period?.start} />

                {/* The rail carries the duration above it and the progress
                    below, so the two dates never need a sentence between
                    them to be understood. */}
                <div style={{ flex: "1 1 200px", minWidth: 160, paddingBottom: 4 }}>
                    <div style={{ textAlign: "center", fontSize: 11, fontWeight: 700, color: INK, marginBottom: 5 }}>
                        {total ? `${total} days` : " "}
                    </div>
                    <div style={{ position: "relative", height: 6, borderRadius: 999, background: "#dbe6f5", overflow: "hidden" }}>
                        <div style={{ width: `${fill * 100}%`, height: "100%", background: tone, borderRadius: 999 }} />
                    </div>
                    <div style={{ textAlign: "center", fontSize: 11, ...muted, marginTop: 5 }}>
                        {phase === "open" && total && elapsed ? `Day ${elapsed} of ${total}`
                            : phase === "closed" ? "Window complete"
                                : "Window has not opened"}
                    </div>
                </div>

                <EdgeDate caption="To" iso={period?.end} align="right" />
            </div>

            {contractStart && (
                <div style={{ fontSize: 11, ...muted, marginTop: 12, paddingTop: 10, borderTop: "1px dashed var(--uidai-pmis-border)" }}>
                    Contract quarters are counted from the project start,{" "}
                    <b style={{ color: INK }}>{longDate(contractStart)}</b> — not from the calendar year.
                </div>
            )}
        </div>
    );
}

/* ─── deliverable payable report ──────────────────────────────────
   "What was this deliverable meant to be paid, what did the SLAs take
   off it, and what is actually payable?"

   The two finance percentages are different things and are kept
   visibly apart here for that reason: LD is charged on the milestone's
   LD Basis (its full allotment) while the payment it comes off is the
   % of Payment value. A milestone paid below its allotment is still
   penalised on the whole allotment, so the deduction can be a bigger
   slice of the payment than the LD % reads — flagged inline rather
   than quietly normalised.                                          */
function PayableRow({ row, open, onToggle }) {
    const overrun = row.netPayable !== null && row.netPayable < 0;
    return (
        <>
            <tr style={open ? { background: "#eef5ff" } : undefined}>
                <td>
                    <button
                        type="button"
                        onClick={onToggle}
                        aria-expanded={open}
                        style={{
                            display: "inline-flex", alignItems: "center", gap: 7,
                            border: "none", background: "transparent", padding: 0,
                            cursor: "pointer", textAlign: "left", color: INK,
                            fontWeight: 700, fontSize: 12.5,
                        }}
                    >
                        <span style={{ fontSize: 9 }}>{open ? "▾" : "▸"}</span>
                        {row.milestoneName}
                    </button>
                    <div style={{ fontSize: 11, ...muted, marginTop: 2, paddingLeft: 16 }}>
                        {row.phases.length ? row.phases.join(", ") : "—"}
                        {row.termCount > 1 && ` · ${row.termCount} terms`}
                        {` · ${row.occurrenceCount} evaluation${row.occurrenceCount === 1 ? "" : "s"}`}
                    </div>
                </td>
                <td>
                    <div style={{ display: "flex", flexWrap: "wrap", gap: 5 }}>
                        {row.slas.map((s) => (
                            <span
                                key={s.slaRef}
                                title={`${s.slaTitle || s.slaRef} · ${s.breaches} breach(es) of ${s.occurrences}`}
                                className="uidai-pmis-badge uidai-pmis-badge-red"
                                style={{ fontFamily: "monospace", fontSize: 10.5, fontWeight: 700 }}
                            >
                                {s.slaRef} {pct(Math.round(s.ldPercent * 100) / 100)}
                            </span>
                        ))}
                    </div>
                </td>
                <td style={{ textAlign: "right", fontVariantNumeric: "tabular-nums", fontWeight: 700, color: INK, whiteSpace: "nowrap" }}>
                    {row.hasBase ? money(row.paymentValue) : <span style={{ color: AMBER, fontWeight: 700 }}>no payment term</span>}
                    <div style={{ fontSize: 10.5, ...muted, fontWeight: 400 }}>
                        {row.hasBase ? `${pct(row.paymentPercent)} of phase · §5.23.1` : "nothing to charge against"}
                    </div>
                    {row.ldBasisDiffers && (
                        <div
                            style={{ fontSize: 10.5, color: AMBER, fontWeight: 700 }}
                            title={"Finance holds an LD Basis allotment of " + money(row.ldBasisValue)
                                + " (" + pct(row.ldBasisPercent) + ") for this milestone. It is NOT used here — §5.28.2 charges "
                                + "on the deliverable's own cost. A divergence usually means LD Basis is still on the backend's "
                                + "even split rather than the §5.23.1 schedule."}
                        >
                            ⚠ LD Basis {pct(row.ldBasisPercent)} differs
                        </div>
                    )}
                </td>
                <td style={{ textAlign: "right", fontVariantNumeric: "tabular-nums", fontWeight: 800, color: row.ldPercent > 0 ? RED : GREEN }}>
                    {pct(Math.round(row.ldPercent * 100) / 100)}
                </td>
                <td style={{ textAlign: "right", fontVariantNumeric: "tabular-nums", fontWeight: 700, color: RED, whiteSpace: "nowrap" }}>
                    {money(row.ldAmount)}
                    {row.backendLdAmount !== null
                        && row.ldAmount !== null
                        && Math.abs(row.backendLdAmount - row.ldAmount) > 0.5 && (
                        <div
                            style={{ fontSize: 10.5, color: AMBER, fontWeight: 700 }}
                            title={"The backend priced these occurrences at a different total, so it is charging "
                                + "them on a different base than the milestone's LD Basis."}
                        >
                            ⚠ backend: {money(row.backendLdAmount)}
                        </div>
                    )}
                </td>
                <td style={{ textAlign: "right", fontVariantNumeric: "tabular-nums", fontWeight: 800, color: overrun ? RED : INK, whiteSpace: "nowrap" }}>
                    {money(row.netPayable)}
                    {overrun && (
                        <div
                            style={{ fontSize: 10.5, color: RED, fontWeight: 700 }}
                            title={"Accrued LD has exceeded this deliverable's entire cost. §5.28.2 sets no ceiling, "
                                + "so the figure is shown as calculated rather than clamped to zero."}
                        >
                            LD exceeds deliverable cost
                        </div>
                    )}
                </td>
            </tr>

            {open && row.contributions.map((c, i) => (
                <tr key={`${row.milestoneId}-c-${i}`} style={{ background: "#f6faff" }}>
                    <td style={{ borderLeft: "3px solid #0aa1c0", paddingLeft: 18 }}>
                        <span style={{ fontSize: 12, color: "#0b3c88", fontWeight: 600 }} title={c.activityName || ""}>
                            {c.activityCode || c.activityId || "—"}
                        </span>
                        <div style={{ fontSize: 10.5, ...muted }}>{c.evaluatedOn || "no evaluation date"}</div>
                    </td>
                    <td>
                        <span style={{ fontFamily: "monospace", fontSize: 11.5, fontWeight: 700, color: INK }}>{c.slaRef}</span>
                        {c.status && (
                            <span style={{ marginLeft: 6, fontSize: 10 }}><StatusBadge status={c.status} /></span>
                        )}
                    </td>
                    <td style={{ textAlign: "right", fontSize: 11.5, ...muted }}>
                        {c.delayDays === null ? "—" : `${num(c.delayDays, 0)} d delay`}
                    </td>
                    <td style={{ textAlign: "right", fontVariantNumeric: "tabular-nums", fontWeight: 700 }}>{pct(c.ldPercent)}</td>
                    <td style={{ textAlign: "right", fontVariantNumeric: "tabular-nums", ...muted, fontSize: 11.5 }}>{money(c.ldAmount)}</td>
                    <td />
                </tr>
            ))}
        </>
    );
}

/* Heading for one of the two LD regimes. The subtitle carries the RFP
   clause and the money base, because "which of these two lists does this
   SLA belong in" is the question the whole screen exists to answer. */
/* The clause reference is a citation, not a sentence — it belongs in a
   chip beside the title rather than trailing the subtitle, where it made
   every section end in a string of section numbers. */
function ClauseChip({ clause }) {
    if (!clause) return null;
    return (
        <span style={{
            border: "1px solid #d7e0ee", color: "var(--uidai-pmis-muted)",
            borderRadius: 6, padding: "1px 6px", fontSize: 10.5, fontWeight: 600,
            fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap",
        }}>
            {clause}
        </span>
    );
}

function SectionHead({ title, count, sub, clause, onToggle, toggleLabel, showToggle, style }) {
    return (
        <div style={{ marginTop: 18, ...style }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                <div style={{ fontSize: 13.5, fontWeight: 800, color: INK }}>{title}</div>
                <span style={{ background: "#dceafe", color: "#1f4e87", borderRadius: 999, padding: "1px 8px", fontSize: 11, fontWeight: 800 }}>
                    {count}
                </span>
                <ClauseChip clause={clause} />
                {showToggle && onToggle && (
                    <button
                        type="button"
                        className="uidai-pmis-btn uidai-pmis-btn-cancel uidai-pmis-btn-small"
                        style={{ marginTop: 0, marginLeft: "auto" }}
                        onClick={onToggle}
                    >
                        {toggleLabel}
                    </button>
                )}
            </div>
            {sub && <div style={{ fontSize: 11.5, ...muted, marginTop: 3 }}>{sub}</div>}
        </div>
    );
}

/* One measurement interval's staffing, as a bar rather than a number.
   SLA 007 scores each month separately and the points accumulate, so the
   month that went short has to be findable at a glance — an average
   across the quarter is exactly what hides it. */
function IntervalBar({ interval, occupancy, configuredSeats }) {
    const pct = occupancy.deployedPercent ?? 0;
    const short = occupancy.vacantDays > 0;
    const tone = pct >= 99.95 ? GREEN : pct >= 90 ? AMBER : RED;
    const label = occupancy.effectiveHeadcount === null
        ? "—"
        : (Math.round(occupancy.effectiveHeadcount * 100) / 100).toLocaleString("en-IN");

    return (
        <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
            <div style={{ minWidth: 116, fontSize: 11.5 }}>
                <b style={{ color: INK }}>{longDate(interval.start).slice(3)}</b>
                <span style={{ ...muted, marginLeft: 6 }}>
                    {interval.days}d{interval.partial ? " · part" : ""}
                </span>
            </div>
            <div style={{ flex: "1 1 160px", minWidth: 120, height: 8, borderRadius: 999, background: "#e6edf7", overflow: "hidden" }}>
                <div style={{ width: `${Math.min(100, pct)}%`, height: "100%", background: tone, borderRadius: 999 }} />
            </div>
            <div style={{ minWidth: 96, textAlign: "right", fontSize: 12, fontVariantNumeric: "tabular-nums" }}>
                <b style={{ color: tone }}>{label}</b>
                <span style={{ ...muted }}> of {configuredSeats}</span>
            </div>
            <div style={{ minWidth: 92, textAlign: "right", fontSize: 11.5, ...(short ? { color: AMBER, fontWeight: 600 } : muted) }}>
                {short ? `${occupancy.vacantDays} vacant d` : "fully staffed"}
            </div>
        </div>
    );
}

/* ─── one SLA group ──────────────────────────────────────────────── */

/* A small right-aligned figure in the group header. */
function Metric({ label, value, accent, flag, flagTitle }) {
    return (
        <span style={{ textAlign: "right", minWidth: 74 }}>
            <span style={{ display: "block", fontSize: 10.5, ...muted, fontWeight: 700, textTransform: "uppercase", letterSpacing: ".3px" }}>
                {label}
            </span>
            <span style={{ fontSize: 15, fontWeight: 800, color: accent || INK, fontVariantNumeric: "tabular-nums" }}>
                {value}
                {flag && (
                    <span style={{ fontSize: 11, color: AMBER, fontWeight: 700, marginLeft: 4 }} title={flagTitle}>▲</span>
                )}
            </span>
        </span>
    );
}

/* ─── local observation entry ─────────────────────────────────────
   A value box on a `pending_observation` row.

   This exists because the backend has no route for a manual reading
   yet — `/sla-evaluate` computes one and returns it, but nothing
   persists it, so the row stays pending forever. The value typed here
   is parked in localStorage and the severity is derived from the SLA's
   own target table, exactly as the backend would.

   Styled as a draft on purpose, and never presented as saved. The
   moment observations persist server-side this control has nothing
   left to do. */
function ObservationCell({ occurrence, targetRows, onSave, onClear }) {
    const [value, setValue] = useState(
        occurrence.draftValue === undefined || occurrence.draftValue === null ? "" : String(occurrence.draftValue)
    );
    const [touched, setTouched] = useState(false);

    // What the typed value would score, shown live so the effect of a
    // reading is visible before it is committed to the quarter.
    const preview = useMemo(() => {
        if (value === "") return null;
        if (!targetRows?.length) return { severity: null, reason: "no target table on this SLA" };
        return severityForValue(Number(value), targetRows);
    }, [value, targetRows]);

    const dirty = touched && String(occurrence.draftValue ?? "") !== value;

    return (
        <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
            <input
                type="number"
                step="any"
                value={value}
                placeholder="observed"
                onChange={(e) => { setValue(e.target.value); setTouched(true); }}
                style={{
                    width: 78, padding: "3px 6px", fontSize: 12,
                    border: `1px solid ${dirty ? AMBER : "var(--uidai-pmis-border)"}`,
                    borderRadius: 5, textAlign: "right",
                }}
                aria-label={`Observed value for ${occurrence.slaRef}`}
            />
            {dirty && (
                <button
                    type="button"
                    className="uidai-pmis-btn uidai-pmis-btn-small"
                    style={{ marginTop: 0, padding: "2px 8px", fontSize: 11 }}
                    onClick={() => { onSave(value); setTouched(false); }}
                >
                    Save
                </button>
            )}
            {occurrence.isLocalDraft && !dirty && (
                <button
                    type="button"
                    className="uidai-pmis-btn uidai-pmis-btn-cancel uidai-pmis-btn-small"
                    style={{ marginTop: 0, padding: "2px 8px", fontSize: 11 }}
                    onClick={() => { onClear(); setValue(""); setTouched(false); }}
                    title="Remove this local draft"
                >
                    Clear
                </button>
            )}
            {preview && (
                <span style={{ fontSize: 10.5, ...muted }}>
                    {preview.severity === null
                        ? <span style={{ color: AMBER }}>⚠ {preview.reason}</span>
                        : <>→ severity <b style={{ color: severityAccent(preview.severity) }}>{preview.severity}</b></>}
                </span>
            )}
        </div>
    );
}

/* ─── plain-language summary ──────────────────────────────────────
   The answer, before the evidence. Someone opening this page wants
   three numbers: how bad was the quarter, what did it cost, what do we
   pay. Everything below this card explains those three; none of it
   should be needed to read them.

   Deliberately free of acronyms — NPQP, PA and AQP are defined in the
   glossary and used from the sections downward, but the headline says
   "you pay" because that is what it means. */
function HeadlineFigure({ caption, value, tone, note, noteTone }) {
    return (
        <div>
            <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: ".5px", textTransform: "uppercase", ...muted }}>
                {caption}
            </div>
            <div style={{ fontSize: 25, fontWeight: 800, lineHeight: 1.15, color: tone, marginTop: 3 }}>
                {value}
            </div>
            <div style={{ fontSize: 11.5, marginTop: 2, ...(noteTone ? { color: noteTone, fontWeight: 600 } : muted) }}>
                {note}
            </div>
        </div>
    );
}

function Headline({ period, breaches, measured, awaiting, ldPercent, ldAmount, deliverableLd, finalPayment, pending }) {
    /* "No breaches" is only true if everything was actually read. With SLAs
       still awaiting a manual observation the quarter is unmeasured, not
       clean — and every resource SLA needs a manual reading, so this is the
       normal state of an open quarter rather than an edge case. */
    const clean = !breaches && !awaiting;
    const totalPenalty = (Number(ldAmount) || 0) + (Number(deliverableLd) || 0);

    return (
        <div style={{
            marginTop: 14, borderRadius: 12, overflow: "hidden",
            border: `1px solid ${clean ? "#bfe3cd" : "#f0c9c2"}`,
            background: clean ? "#f3fbf6" : "#fdf7f5",
        }}>
            {/* No date range here — the period strip above already carries
                it, and repeating it made the two disagree in format. */}
            <div style={{
                padding: "12px 16px 4px", fontSize: 10, fontWeight: 700,
                letterSpacing: ".5px", textTransform: "uppercase", ...muted,
            }}>
                {period ? `${period.label} at a glance` : "This quarter at a glance"}
            </div>
            {/* Captioned so the three figures read as a KPI row rather than
                three sentences that happen to start with a number. */}
            <div style={{
                display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
                gap: "14px 24px", padding: "6px 16px 16px",
            }}>
                <HeadlineFigure
                    caption="Service levels"
                    value={breaches
                        ? `${breaches} breach${breaches === 1 ? "" : "es"}`
                        : awaiting ? "Not measured" : "All met"}
                    tone={breaches ? RED : awaiting ? AMBER : GREEN}
                    note={awaiting > 0
                        ? `${awaiting} awaiting an observation`
                        : measured > 0 ? `${measured} SLA${measured === 1 ? "" : "s"} measured` : "nothing measured yet"}
                    noteTone={awaiting > 0 ? AMBER : null}
                />
                <HeadlineFigure
                    caption="Penalty"
                    value={totalPenalty > 0 ? money(totalPenalty) : "None"}
                    tone={totalPenalty > 0 ? RED : GREEN}
                    note={Number(ldPercent) > 0 ? `${pct(ldPercent)} of the payment base` : "nothing deducted"}
                />
                <HeadlineFigure
                    caption="Net payment"
                    value={finalPayment === null || finalPayment === undefined ? "—" : money(finalPayment)}
                    tone={INK}
                    note={pending?.length ? `partial — ${pending.join(" and ")} pending` : "after penalty and tax"}
                    noteTone={pending?.length ? AMBER : null}
                />
            </div>
        </div>
    );
}

/* ─── glossary ────────────────────────────────────────────────────
   The RFP's vocabulary is unavoidable — these acronyms are what the
   contract, the invoices and the backend all use, so renaming them on
   screen would just make this page disagree with everything else.
   Defining them once, in one place, is the honest alternative. */
const GLOSSARY = [
    ["Penalty (LD)", "Liquidated damages — money deducted when an SLA is missed."],
    ["Severity", "How badly one measurement missed, 0 (fine) to 4 (worst)."],
    ["Points", "Severity as a number that adds up across the quarter. A clean measurement scores negative."],
    ["Measurement interval", "How often the SLA runs — e.g. monthly. All resources score together."],
    ["Reporting interval", "What the penalty is charged for — the quarter. Points add up, then reset."],
    ["F", "Planned resource cost for the quarter."],
    ["QGR", "Guaranteed quarterly amount, paid whatever the deployment."],
    ["NPQP", "F + QGR — the planned base the penalty % applies to."],
    ["PA", "What was actually earned, from real attendance."],
    ["AQP", "Final payment: (PA − penalty) + QGR."],
];

function Glossary({ open, onToggle }) {
    return (
        <div style={{ marginTop: 10 }}>
            <button
                type="button"
                onClick={onToggle}
                aria-expanded={open}
                style={{
                    display: "inline-flex", alignItems: "center", gap: 7, border: "none",
                    background: "transparent", padding: 0, cursor: "pointer", font: "inherit",
                    color: "#1f4e87", fontSize: 12, fontWeight: 700,
                }}
            >
                <span style={{ fontSize: 10, transition: "transform .15s ease", transform: open ? "rotate(90deg)" : "none" }}>▶</span>
                What do these terms mean?
            </button>
            {open && (
                <div style={{
                    marginTop: 8, background: "#f6f9fd", border: "1px solid var(--uidai-pmis-border)",
                    borderRadius: 10, padding: "12px 14px",
                    display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))", gap: "8px 22px",
                }}>
                    {GLOSSARY.map(([term, meaning]) => (
                        <div key={term} style={{ fontSize: 11.5, lineHeight: 1.55 }}>
                            <b style={{ color: INK }}>{term}</b>
                            <div style={{ ...muted }}>{meaning}</div>
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
}

/* ─── diagnostics, folded ─────────────────────────────────────────
   One row per issue, collapsed behind a count. Blocking issues force
   the panel open on first render — those genuinely mean the numbers
   above cannot be trusted, and hiding them behind a click would be
   the same as not showing them. */
function IssuePanel({ issues, open, onToggle }) {
    if (!issues.length) return null;
    const blocking = issues.filter((i) => i.level === "blocking").length;
    const tone = blocking ? RED : AMBER;

    return (
        <div style={{
            marginTop: 12, borderRadius: 10,
            border: `1px solid ${blocking ? "#f0c9c2" : "#e6e0cd"}`,
            background: blocking ? "#fdf4f2" : "#fdfbf4",
        }}>
            <button
                type="button"
                onClick={onToggle}
                aria-expanded={open}
                style={{
                    display: "flex", alignItems: "center", gap: 9, width: "100%",
                    border: "none", background: "transparent", padding: "10px 13px",
                    cursor: "pointer", font: "inherit", textAlign: "left",
                }}
            >
                <span style={{ ...muted, fontSize: 10, transition: "transform .15s ease", transform: open ? "rotate(90deg)" : "none" }}>▶</span>
                <b style={{ color: tone, fontSize: 12.5 }}>
                    {blocking > 0 ? "⚠" : "◍"} {issues.length} thing{issues.length === 1 ? "" : "s"} to check
                </b>
                <span style={{ fontSize: 11.5, ...muted }}>
                    {blocking > 0
                        ? `${blocking} affect${blocking === 1 ? "s" : ""} the figures above`
                        : "none of these change the figures above"}
                </span>
                <span style={{ fontSize: 11.5, ...muted, marginLeft: "auto" }}>{open ? "Hide" : "Show"}</span>
            </button>

            {open && (
                <div style={{ padding: "0 13px 12px 30px" }}>
                    {issues.map((it, i) => (
                        <div key={i} style={{ marginTop: i === 0 ? 0 : 10, fontSize: 11.5, lineHeight: 1.6 }}>
                            <b style={{ color: it.level === "blocking" ? RED : it.level === "warn" ? AMBER : INK }}>
                                {it.level === "blocking" ? "⚠ " : it.level === "warn" ? "▲ " : "◍ "}
                                {it.title}
                            </b>
                            <div style={{ color: "#334155" }}>{it.detail}</div>
                            {/* An issue that names its own fix beats one that
                                describes where the fix lives. */}
                            {it.actions?.length > 0 && (
                                <div style={{ marginTop: 6, display: "flex", flexWrap: "wrap", gap: 6 }}>
                                    {it.actions.map((a) => (
                                        <Link
                                            key={a.to}
                                            to={a.to}
                                            className="uidai-pmis-btn uidai-pmis-btn-small"
                                            style={{ marginTop: 0, textDecoration: "none", padding: "3px 10px", fontSize: 11 }}
                                        >
                                            {a.label} →
                                        </Link>
                                    ))}
                                </div>
                            )}
                            {it.hint && (
                                <div style={{ ...muted, marginTop: 4, fontSize: 11 }}>{it.hint}</div>
                            )}
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
}

/* ─── formula reference ───────────────────────────────────────────
   Every rule the page applies, in one table, with the clause it comes
   from and the moment it fires.

   The formulas are shown with THIS project's configured values folded
   in — the real severity scale, the real band table, the real quarter
   cap — rather than the RFP's defaults. A reference that quietly
   prints 0:−2 … 4:8 while the project is configured differently would
   be worse than no reference at all, so anything unconfigured says so
   instead of falling back to a plausible-looking default.

   Collapsed by default: it answers "why is this number what it is",
   which is a question you ask occasionally, not something that should
   push the quarter's actual figures off the screen. */
function Formula({ children }) {
    return (
        <code style={{
            fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
            fontSize: 11.5, background: "#eef3fb", padding: "1px 6px",
            borderRadius: 4, color: "#173e77", whiteSpace: "nowrap",
        }}>
            {children}
        </code>
    );
}

function FormulaRow({ step, formula, clause, when, note }) {
    return (
        <tr>
            <td style={{ padding: "6px 12px 6px 0", fontWeight: 700, color: INK, fontSize: 12, verticalAlign: "top", whiteSpace: "nowrap" }}>
                {step}
            </td>
            <td style={{ padding: "6px 12px 6px 0", verticalAlign: "top" }}>
                <Formula>{formula}</Formula>
                {note && <div style={{ fontSize: 11, ...muted, marginTop: 3, lineHeight: 1.5, whiteSpace: "normal" }}>{note}</div>}
            </td>
            <td style={{ padding: "6px 12px 6px 0", fontSize: 11, ...muted, verticalAlign: "top", whiteSpace: "nowrap" }}>
                {clause}
            </td>
            <td style={{ padding: "6px 0", fontSize: 11, ...muted, verticalAlign: "top" }}>
                {when}
            </td>
        </tr>
    );
}

function FormulaTable({ title, subtitle, children }) {
    return (
        <div style={{ marginTop: 16 }}>
            <div style={{ fontSize: 12.5, fontWeight: 800, color: INK }}>{title}</div>
            {subtitle && <div style={{ fontSize: 11, ...muted, marginTop: 2, marginBottom: 6 }}>{subtitle}</div>}
            <div style={{ overflowX: "auto" }}>
                <table style={{ borderCollapse: "collapse", width: "100%", minWidth: 640 }}>
                    <thead>
                        <tr style={{ borderBottom: "1px solid #c8d6ee" }}>
                            <th style={{ textAlign: "left", padding: "0 12px 5px 0", fontSize: 10.5, fontWeight: 800, textTransform: "uppercase", letterSpacing: ".3px", ...muted }}>Step</th>
                            <th style={{ textAlign: "left", padding: "0 12px 5px 0", fontSize: 10.5, fontWeight: 800, textTransform: "uppercase", letterSpacing: ".3px", ...muted }}>Formula</th>
                            <th style={{ textAlign: "left", padding: "0 12px 5px 0", fontSize: 10.5, fontWeight: 800, textTransform: "uppercase", letterSpacing: ".3px", ...muted }}>RFP</th>
                            <th style={{ textAlign: "left", padding: "0 0 5px 0", fontSize: 10.5, fontWeight: 800, textTransform: "uppercase", letterSpacing: ".3px", ...muted }}>Applied at</th>
                        </tr>
                    </thead>
                    <tbody>{children}</tbody>
                </table>
            </div>
        </div>
    );
}

/* One line of the §5.28.1.d waterfall. `sign` is presentational only —
   the arithmetic is done in settlementChain.js; this just shows which
   way each term moves so the chain reads the way the clause does.

   It sits against the AMOUNT rather than the label, because "+" and "−"
   describe what happens to the money, not to the words. In a fixed-width
   gutter, so the digits still right-align down the column. */
function ChainRow({ label, clause, value, sign, strong, rule, tone, hint }) {
    return (
        <>
            <tr style={rule ? { borderTop: "1px solid #d7e0ee" } : undefined}>
                <td style={{
                    padding: strong ? "7px 14px 4px 0" : "3px 14px 3px 0",
                    fontWeight: strong ? 800 : 500,
                    color: strong ? INK : "#334155",
                    fontSize: strong ? 12.5 : 12,
                }}>
                    {label}
                    {clause && <span style={{ ...muted, fontWeight: 400, marginLeft: 6, fontSize: 11 }}>{clause}</span>}
                </td>
                <td style={{
                    padding: strong ? "7px 0 4px 0" : "3px 0",
                    textAlign: "right", whiteSpace: "nowrap",
                    fontVariantNumeric: "tabular-nums",
                    fontWeight: strong ? 800 : 600,
                    fontSize: strong ? 13.5 : 12.5,
                    color: tone || (strong ? INK : "#334155"),
                }}>
                    {sign && (
                        <span style={{
                            display: "inline-block", width: 14, textAlign: "left",
                            fontWeight: 800, color: tone || (strong ? INK : "var(--uidai-pmis-muted)"),
                        }}>
                            {sign}
                        </span>
                    )}
                    {value}
                </td>
            </tr>
            {hint && (
                <tr>
                    <td colSpan={2} style={{ padding: "0 0 4px 12px", fontSize: 11, ...muted, lineHeight: 1.5 }}>
                        {hint}
                    </td>
                </tr>
            )}
        </>
    );
}

/* ─── payment statement chrome ────────────────────────────────────
   A headline figure inside the dark masthead. Light-on-dark, so it takes
   its own palette rather than the page's INK/GREEN, which would vanish
   against the gradient. */
function StatementHero({ caption, value, note, tone, strong }) {
    return (
        <div>
            <div style={{ fontSize: 9.5, fontWeight: 700, letterSpacing: ".9px", textTransform: "uppercase", opacity: .6 }}>
                {caption}
            </div>
            <div style={{
                fontSize: strong ? 26 : 21, fontWeight: 800, lineHeight: 1.15, marginTop: 4,
                color: tone || "#fff", letterSpacing: "-.3px",
            }}>
                {value}
            </div>
            {note && <div style={{ fontSize: 10.5, opacity: .62, marginTop: 3 }}>{note}</div>}
        </div>
    );
}

/* A lettered divider inside the statement. A–D were previously bold rows
   in one continuous table, which made four separate calculations read as
   one long column — the invoice total looked like it followed on from the
   deliverable rows above it, which it does not. */
function StatementSection({ letter, title, clause, first }) {
    return (
        <div style={{
            display: "flex", alignItems: "center", gap: 9,
            marginTop: first ? 16 : 20, marginBottom: 8,
        }}>
            <span style={{
                width: 21, height: 21, borderRadius: 6, background: "#eaf1fb",
                color: INK, fontSize: 11, fontWeight: 800,
                display: "inline-flex", alignItems: "center", justifyContent: "center", flex: "0 0 auto",
            }}>
                {letter}
            </span>
            <span style={{ fontSize: 12, fontWeight: 800, color: INK, letterSpacing: ".2px", textTransform: "uppercase" }}>
                {title}
            </span>
            <ClauseChip clause={clause} />
            <span style={{ flex: 1, height: 1, background: "var(--uidai-pmis-border)" }} />
        </div>
    );
}

/* ─── granting an LD relaxation ───────────────────────────────────
   Writes through the settlement override, which is what the backend
   offers: it replaces Σ LD % and stores the reason, re-capping the value
   server-side. So the form takes the relaxation as PERCENTAGE POINTS TO
   WAIVE rather than as the resulting figure — "waive 1.8 of the 3.3
   charged" is the decision a reviewer actually makes, and computing the
   remainder for them removes the subtraction where the mistakes live.

   The reason is mandatory and not defaulted. It is the only record that
   survives on the settlement row of why the scored figure was not used,
   and a blank one turns a deliberate concession into an unexplained
   discrepancy for whoever reads the quarter next. */
function RelaxationModal({ scoredPercent, npqp, quarterLabel, quarterDates, onCancel, onSubmit }) {
    const [value, setValue] = useState("");
    const [reason, setReason] = useState("");
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState("");

    const scored = Number(scoredPercent) || 0;
    const relax = Number(value);
    const valid = Number.isFinite(relax) && relax > 0 && relax <= scored + 1e-9;
    const next = valid ? Math.max(0, scored - relax) : scored;
    const amountOf = (p) => (Number.isFinite(Number(npqp)) ? (p / 100) * Number(npqp) : null);

    async function submit() {
        if (!valid || !reason.trim()) return;
        setBusy(true);
        setError("");
        try {
            await onSubmit({ relaxPercent: relax, reason: reason.trim() });
        } catch (err) {
            setError(err?.message || "The relaxation could not be saved.");
            setBusy(false);
        }
    }

    const field = {
        width: "100%", padding: "7px 10px", borderRadius: 8,
        border: "1px solid var(--uidai-pmis-border)", font: "inherit", fontSize: 13,
    };

    return (
        <div
            style={{
                position: "fixed", inset: 0, background: "rgba(12,26,48,.45)",
                display: "flex", alignItems: "center", justifyContent: "center",
                padding: 20, zIndex: 60,
            }}
            onMouseDown={(e) => { if (e.target === e.currentTarget && !busy) onCancel(); }}
        >
            <div style={{
                background: "#fff", borderRadius: 14, width: "100%", maxWidth: 460,
                boxShadow: "0 12px 40px rgba(12,26,48,.28)", overflow: "hidden",
            }}>
                <div style={{ background: INK, color: "#fff", padding: "14px 18px" }}>
                    <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: "1px", textTransform: "uppercase", opacity: .65 }}>
                        §5.28.1.d · quarterly LD only
                    </div>
                    <div style={{ fontSize: 16, fontWeight: 800, marginTop: 2 }}>Grant LD relaxation</div>
                    <div style={{ fontSize: 11.5, opacity: .8, marginTop: 2 }}>
                        {quarterLabel}{quarterDates ? ` · ${quarterDates}` : ""}
                    </div>
                </div>

                <div style={{ padding: "16px 18px" }}>
                    <div style={{ fontSize: 12, ...muted, marginBottom: 12, lineHeight: 1.6 }}>
                        Charged this quarter: <b style={{ color: RED }}>{pct(Math.round(scored * 100) / 100)}</b>
                        {amountOf(scored) !== null && <> · {money(amountOf(scored))}</>}
                    </div>

                    <label style={{ display: "block", fontSize: 11.5, fontWeight: 700, color: INK, marginBottom: 5 }}>
                        Relaxation to grant (percentage points)
                    </label>
                    <input
                        type="number" step="0.01" min="0" max={scored} value={value} autoFocus
                        onChange={(e) => setValue(e.target.value)}
                        placeholder={`0 – ${Math.round(scored * 100) / 100}`}
                        style={field}
                        disabled={busy}
                    />
                    {value !== "" && !valid && (
                        <div style={{ fontSize: 11, color: RED, marginTop: 5 }}>
                            Enter a figure above 0 and no more than the {Math.round(scored * 100) / 100}% charged.
                        </div>
                    )}

                    <label style={{ display: "block", fontSize: 11.5, fontWeight: 700, color: INK, margin: "14px 0 5px" }}>
                        Reason <span style={{ color: RED }}>*</span>
                    </label>
                    <textarea
                        rows={3} value={reason} onChange={(e) => setReason(e.target.value)}
                        placeholder="Who approved this relaxation, and on what grounds."
                        style={{ ...field, resize: "vertical" }}
                        disabled={busy}
                    />

                    {/* What the row will hold afterwards, before it is written —
                        the override replaces the figure rather than recording a
                        delta, so this is the last chance to see both. */}
                    {valid && (
                        <div style={{
                            marginTop: 14, padding: "10px 12px", borderRadius: 8,
                            background: "#f6f9fd", border: "1px solid var(--uidai-pmis-border)",
                        }}>
                            <table style={{ borderCollapse: "collapse", width: "100%" }}>
                                <tbody>
                                    <ChainRow label="Charged" value={pct(Math.round(scored * 100) / 100)} tone={RED} />
                                    <ChainRow label="Relaxation" sign="−" value={pct(Math.round(relax * 100) / 100)} tone={GREEN} />
                                    <ChainRow
                                        label="LD after relaxation"
                                        sign="="
                                        value={pct(Math.round(next * 100) / 100)}
                                        strong rule
                                        hint={amountOf(next) !== null
                                            ? `${money(amountOf(next))} of NPQP — down from ${money(amountOf(scored))}.`
                                            : null}
                                    />
                                </tbody>
                            </table>
                        </div>
                    )}

                    {error && (
                        <div style={{ marginTop: 12, fontSize: 11.5, color: RED, fontWeight: 600, lineHeight: 1.6 }}>
                            {error}
                        </div>
                    )}

                    <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 18 }}>
                        <button
                            type="button"
                            className="uidai-pmis-btn uidai-pmis-btn-cancel uidai-pmis-btn-small"
                            style={{ marginTop: 0 }}
                            onClick={onCancel}
                            disabled={busy}
                        >
                            Cancel
                        </button>
                        <button
                            type="button"
                            className="uidai-pmis-btn uidai-pmis-btn-small"
                            style={{ marginTop: 0 }}
                            onClick={submit}
                            disabled={busy || !valid || !reason.trim()}
                        >
                            {busy ? "Saving…" : "Grant relaxation"}
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
}

/* ─── RFP conformance note ────────────────────────────────────────
   What the SLA's own master says its scoring rule is, and what that
   rule would have produced, next to what the backend actually produced.

   Deliberately never rewrites the figures above it. The backend is the
   number of record — the Settlement page invoices from it — so a rollup
   that silently "corrected" itself would just put two screens out of
   step without anyone noticing. Divergence is a finding, not a fix. */
function RecheckNote({ recheck }) {
    if (!recheck) return null;
    const { method, note, diverges } = recheck;
    if (method === METHOD.SUM && !note) return null;

    const unverifiable = method === METHOD.UNVERIFIABLE;
    const tone = diverges ? RED : unverifiable ? AMBER : INK;
    const heading = {
        [METHOD.INTERVAL]: "Measurement intervals",
        [METHOD.COUNT]: "Count-driven severity",
        [METHOD.LINEAR]: "Per-unit rounding",
        [METHOD.UNVERIFIABLE]: "Could not be checked",
    }[method] || "RFP check";

    return (
        <div
            style={{
                marginTop: 10, marginBottom: 10, padding: "10px 12px",
                background: diverges ? "#fdf4f2" : unverifiable ? "#fffaf0" : "#f4f8ff",
                border: `1px solid ${diverges ? "#f0c9c2" : unverifiable ? "#f0dfc0" : "#c8d6ee"}`,
                borderRadius: 8, fontSize: 11.5, lineHeight: 1.65, color: "#334155",
            }}
        >
            <b style={{ color: tone }}>
                {diverges ? "⚠ " : unverifiable ? "◍ " : "✓ "}{heading}
            </b>
            {note && <> — {note}</>}

            {/* The §5.28.1 chain laid out interval by interval: each one
                aggregates its resources into a single capped severity, and
                those points accumulate into the reporting interval. */}
            {method === METHOD.INTERVAL && recheck.detail && (
                <div style={{ marginTop: 8 }}>
                    <table style={{ borderCollapse: "collapse", fontSize: 11.5, minWidth: 320 }}>
                        <thead>
                            <tr style={{ ...muted, textAlign: "left" }}>
                                <th style={{ padding: "2px 14px 4px 0", fontWeight: 700 }}>
                                    {recheck.detail.cadence} interval
                                </th>
                                <th style={{ padding: "2px 14px 4px 0", fontWeight: 700 }}>Results</th>
                                <th style={{ padding: "2px 14px 4px 0", fontWeight: 700 }}>Severity</th>
                                <th style={{ padding: "2px 0 4px 0", fontWeight: 700, textAlign: "right" }}>Points</th>
                            </tr>
                        </thead>
                        <tbody>
                            {recheck.detail.buckets.map((b) => {
                                const many = b.scored.length > 1;
                                const none = b.scored.length === 0 && b.unscored.length === 0;
                                return (
                                    <tr key={b.key} style={{ color: many ? RED : none ? AMBER : undefined }}>
                                        <td style={{ padding: "2px 14px 2px 0", fontFamily: "monospace", fontWeight: 700 }}>
                                            {b.key}
                                            {b.outsideWindow && (
                                                <span style={{ color: AMBER, marginLeft: 4 }} title="Outside this reporting window">*</span>
                                            )}
                                        </td>
                                        <td style={{ padding: "2px 14px 2px 0" }}>
                                            {none ? "not run" : b.scored.length}
                                            {b.unscored.length > 0 && ` (+${b.unscored.length} unscored)`}
                                            {many && " ⚠ not aggregated"}
                                        </td>
                                        <td style={{ padding: "2px 14px 2px 0", fontVariantNumeric: "tabular-nums" }}>
                                            {b.severities.length ? b.severities.join(", ") : "—"}
                                            {b.capApplied && (
                                                <span style={{ color: AMBER, marginLeft: 4 }} title="SLA Cap applied in this interval (§5.28.1.b)">▲</span>
                                            )}
                                        </td>
                                        <td style={{ padding: "2px 0", textAlign: "right", fontVariantNumeric: "tabular-nums", fontWeight: 700 }}>
                                            {b.scored.length ? num(b.points, 0) : "—"}
                                        </td>
                                    </tr>
                                );
                            })}
                        </tbody>
                        <tfoot>
                            <tr style={{ borderTop: "1px solid #d7e0ee" }}>
                                <td colSpan={3} style={{ padding: "4px 14px 0 0", fontWeight: 700, color: INK }}>
                                    Accumulated over the reporting interval (§5.28.1.a)
                                </td>
                                <td style={{ padding: "4px 0 0 0", textAlign: "right", fontWeight: 800, color: INK, fontVariantNumeric: "tabular-nums" }}>
                                    {num(recheck.backendPoints, 0)}
                                </td>
                            </tr>
                        </tfoot>
                    </table>
                    {recheck.expectedPoints !== null
                        && recheck.backendPoints !== null
                        && recheck.expectedPoints !== recheck.backendPoints && (
                        <div style={{ marginTop: 6 }}>
                            One score per interval would accumulate{" "}
                            <b style={{ color: tone }}>{num(recheck.expectedPoints, 0)} points</b> →{" "}
                            <b style={{ color: tone }}>{pct(recheck.expectedLdPercent)}</b>, against{" "}
                            <b>{num(recheck.backendPoints, 0)}</b> → <b>{pct(recheck.backendLdPercent)}</b> charged.
                        </div>
                    )}
                </div>
            )}

            {method === METHOD.COUNT && recheck.detail && (
                <div style={{ marginTop: 6 }}>
                    <b style={{ color: INK }}>{recheck.detail.count}</b> breach
                    {recheck.detail.count === 1 ? "" : "es"} this quarter → severity{" "}
                    <b style={{ color: INK }}>{recheck.detail.severity}</b> ={" "}
                    <b style={{ color: INK }}>{num(recheck.expectedPoints, 0)} points</b> →{" "}
                    <b style={{ color: tone }}>{pct(recheck.expectedLdPercent)}</b>.
                    {" "}Scored per occurrence it reached{" "}
                    <b>{num(recheck.backendPoints, 0)} points</b> → <b>{pct(recheck.backendLdPercent)}</b>.
                </div>
            )}

            {method === METHOD.LINEAR && Array.isArray(recheck.detail) && diverges && (
                <div style={{ marginTop: 6 }}>
                    {recheck.detail.filter((c) => c.diverges).slice(0, 4).map((c, i) => (
                        <div key={i} style={{ fontFamily: "monospace", fontSize: 11 }}>
                            {c.activityCode || "—"} · {num(c.delayDays, 0)}d delay → expected{" "}
                            <b style={{ color: tone }}>{pct(c.expected)}</b>, charged <b>{pct(c.actual)}</b>
                        </div>
                    ))}
                    {recheck.detail.filter((c) => c.diverges).length > 4 && (
                        <div style={{ ...muted }}>
                            …and {recheck.detail.filter((c) => c.diverges).length - 4} more.
                        </div>
                    )}
                </div>
            )}
        </div>
    );
}

/* ─── staffing, on the SLA that is scored against it ──────────────
   Shown inside the resource-deployment group only. §5.28.3's Note takes
   a seat out of the calculation while UIDAI-initiated replacement is
   pending, and discounts a part-month vacancy to the days it actually
   ran — so the number this SLA should be scored against is rarely the
   configured headcount, and the difference belongs next to the score
   rather than three sections away.

   States what was staffed; never restates the score. The backend
   remains the number of record. */
function StaffingNote({ staffing }) {
    if (!staffing?.applicable) return null;
    const { adjustment, intervals } = staffing;
    if (!adjustment?.diverges && !adjustment?.excludedSeats) return null;

    return (
        <div style={{
            marginBottom: 10, padding: "9px 11px", borderRadius: 8,
            background: "#fffaf0", border: "1px solid #e8d9b0",
            fontSize: 11.5, lineHeight: 1.6, color: "#334155",
        }}>
            <b style={{ color: AMBER }}>Staffing</b> — scored against{" "}
            <b style={{ color: INK }}>{adjustment.effectiveHeadcountLabel}</b> effective heads,
            not the {adjustment.configuredSeats} planned.
            {adjustment.excludedSeats > 0 && (
                <> {adjustment.excludedSeats} seat{adjustment.excludedSeats === 1 ? "" : "s"} never
                    filled this quarter — outside the calculation if UIDAI initiated the replacement.</>
            )}
            {adjustment.discountedDays > 0 && (
                <> {adjustment.discountedDays} resource-day{adjustment.discountedDays === 1 ? "" : "s"} lost
                    to gaps between a leaver and their replacement.</>
            )}
            {intervals?.length > 0 && (
                <div style={{ marginTop: 5, ...muted }}>
                    {intervals.map((b) => (
                        <span key={b.interval.key} style={{ marginRight: 12, whiteSpace: "nowrap" }}>
                            {longDate(b.interval.start).slice(3, 6)}{" "}
                            <b style={{ color: b.vacantDays > 0 ? AMBER : INK }}>
                                {b.effectiveHeadcount === null ? "—" : Math.round(b.effectiveHeadcount * 100) / 100}
                            </b>
                        </span>
                    ))}
                </div>
            )}
        </div>
    );
}

/* Open state is local, seeded from `defaultOpen`. Expand/collapse-all works
   by changing the React key at the call site so each group remounts with a
   new seed — which is also the behaviour you want: pressing "expand all"
   should override whatever was toggled by hand, not merge with it.

   One component serves both regimes because the shell is identical; only
   the header figures and the occurrence columns differ, and splitting it
   in two would duplicate the badges, the chrome and the empty states. */
function SlaGroup({ item, recheck, staffing, defaultOpen, targetRows, onSaveDraft, onClearDraft }) {
    const [open, setOpen] = useState(!!defaultOpen);

    const isDeliverable = item.track === TRACK.DELIVERABLE;
    const isPoints = item.scoring === SCORING.POINTS;
    const costing = isDeliverable
        ? Number(item.totalLdAmount) > 0
        : Number(item.ldPercent) > 0;

    return (
        <div
            style={{
                border: `1px solid ${costing ? "#f0c9c2" : "var(--uidai-pmis-border)"}`,
                borderRadius: 10, marginTop: 10, background: "#fff", overflow: "hidden",
            }}
        >
            <button
                type="button"
                onClick={() => setOpen((o) => !o)}
                style={{
                    width: "100%", textAlign: "left", border: "none", font: "inherit", cursor: "pointer",
                    background: costing ? "#fdf4f2" : "#f6f9fd", padding: "11px 14px",
                    display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap",
                }}
            >
                <span style={{ transition: "transform .15s ease", transform: open ? "rotate(90deg)" : "none", ...muted, fontSize: 11 }}>▶</span>

                <span style={{ display: "flex", flexDirection: "column", minWidth: 0 }}>
                    <span
                        style={{ fontFamily: "monospace", fontSize: 13, fontWeight: 800, color: INK, whiteSpace: "nowrap" }}
                        title={
                            `Placed in the ${item.track} section by ${item.basis}` +
                            (item.category ? ` · category ${item.category}` : " · no category") +
                            (item.base ? ` · applied_on ${item.base}` : " · no applied_on") +
                            (item.baseConflict ? " · ⚠ applied_on contradicts the category" : "")
                        }
                    >
                        {item.slaRef}
                        {item.baseConflict && <span style={{ color: AMBER, marginLeft: 5 }}>⚠</span>}
                    </span>
                    {item.slaTitle && (
                        <span style={{ fontSize: 11.5, ...muted, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", maxWidth: 260 }}>
                            {item.slaTitle}
                        </span>
                    )}
                </span>

                <span style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
                    <span className="uidai-pmis-badge uidai-pmis-badge-red" title="Breached occurrences in this period">
                        {item.breached} breach{item.breached === 1 ? "" : "es"}
                    </span>
                    {item.met > 0 && <span className="uidai-pmis-badge uidai-pmis-badge-green">{item.met} met</span>}
                    {item.pending > 0 && (
                        <span className="uidai-pmis-badge uidai-pmis-badge-orange"
                              title="Evaluated, but the observed value has not been entered yet — these score nothing.">
                            {item.pending} awaiting observation
                        </span>
                    )}
                    {item.excluded > 0 && (
                        <span className="uidai-pmis-badge uidai-pmis-badge-grey"
                              title="Excluded from the calculation by the RFP — e.g. SLA 007's Note on UIDAI-initiated replacements. Scores no points.">
                            {item.excluded} excluded
                        </span>
                    )}
                    {item.capHits > 0 && (
                        <span
                            className="uidai-pmis-badge uidai-pmis-badge-orange"
                            title="Severity above the configured ceiling was capped before scoring — RFP §5.28.1.b"
                        >
                            SLA cap ×{item.capHits}
                        </span>
                    )}
                </span>

                {/* Deliverable SLAs are charged in rupees on each deliverable's own
                    cost, so a percentage headline would be comparing unlike bases.
                    Points-scored SLAs lead with points; the linear NPQP one (SLA
                    003) has no points, so it leads with the delay that drove it. */}
                <span style={{ marginLeft: "auto", display: "flex", gap: 18, alignItems: "center", flexWrap: "wrap" }}>
                    {isDeliverable ? (
                        <>
                            <Metric label="Deliverables" value={num(item.occurrences.length, 0)} />
                            <Metric label="Penalty amount" value={money(item.totalLdAmount)} accent={costing ? RED : GREEN} />
                        </>
                    ) : (
                        <>
                            {isPoints ? (
                                <Metric
                                    label="Points"
                                    value={num(item.accumulatedPoints, 0)}
                                    flag={item.pointsCapped}
                                    flagTitle={`${num(item.excessPoints, 0)} points beyond the top band earn no further LD (§5.28.1.b)`}
                                />
                            ) : (
                                <Metric label="Delay" value={`${num(item.totalDelayDays, 0)}d`} />
                            )}
                            <Metric label="LD %" value={pct(item.ldPercent)} accent={costing ? RED : GREEN} />
                        </>
                    )}
                </span>
            </button>

            {open && (
                <div style={{ padding: "12px 14px" }}>
                    <StaffingNote staffing={staffing} />
                    <RecheckNote recheck={recheck} />
                    {/* How this SLA reached its number, in the RFP's own terms. */}
                    <div style={{ fontSize: 12, ...muted, marginBottom: 10, lineHeight: 1.6 }}>
                        {isDeliverable ? (
                            <>
                                Charged per deliverable on <b style={{ color: INK }}>that deliverable&rsquo;s own cost</b> (§5.28.2),
                                not on NPQP — so the amounts below add up but the percentages do not, and the
                                quarter&rsquo;s {"≤"}10% NPQP ceiling does not apply here.
                                {item.unpricedCount > 0 && (
                                    <> <span style={{ color: AMBER }}>{item.unpricedCount} occurrence
                                        {item.unpricedCount === 1 ? " has" : "s have"} no deliverable cost resolved yet.</span></>
                                )}
                            </>
                        ) : isPoints ? (
                            <>
                                {item.scoredCount} scored occurrence{item.scoredCount === 1 ? "" : "s"} accumulated{" "}
                                <b style={{ color: INK }}>{num(item.accumulatedPoints, 0)} points</b>
                                {item.band ? (
                                    <>
                                        , which falls in band <b style={{ color: INK }}>{item.band.label}</b> (threshold{" "}
                                        {num(item.band.points_threshold, 0)}) → <b style={{ color: costing ? RED : GREEN }}>{pct(item.ldPercent)}</b> of NPQP.
                                        {item.pointsCapped && (
                                            <> The top band is the per-SLA ceiling (§5.28.1.b), so the extra{" "}
                                                <b style={{ color: AMBER }}>{num(item.excessPoints, 0)} points</b> add nothing.</>
                                        )}
                                    </>
                                ) : (
                                    " — no LD band matched, so this SLA is unscored."
                                )}
                                {item.unscoredCount > 0 && (
                                    <> {item.unscoredCount} occurrence{item.unscoredCount === 1 ? " has" : "s have"} no severity yet and contributed nothing.</>
                                )}
                            </>
                        ) : (
                            <>
                                Escalates linearly with delay rather than through severity points (§5.28.3.a):{" "}
                                <b style={{ color: INK }}>{num(item.totalDelayDays, 0)} days</b> across{" "}
                                {item.scoredCount} occurrence{item.scoredCount === 1 ? "" : "s"} →{" "}
                                <b style={{ color: costing ? RED : GREEN }}>{pct(item.ldPercent)}</b> of NPQP.
                            </>
                        )}
                    </div>

                    <div className="uidai-pmis-table-wrap">
                        <table className="uidai-pmis-table uidai-pmis-table-compact" style={{ marginTop: 0 }}>
                            <thead>
                                <tr>
                                    <th>{isDeliverable ? "Deliverable / Activity" : "Activity"}</th>
                                    <th>Milestone</th>
                                    <th>Status</th>
                                    <th>Observed</th>
                                    {isPoints && <th style={{ textAlign: "right" }}>Severity</th>}
                                    {isPoints && <th style={{ textAlign: "right" }}>Points</th>}
                                    <th style={{ textAlign: "right" }}>Target</th>
                                    <th style={{ textAlign: "right" }}>Actual</th>
                                    <th style={{ textAlign: "right" }}>Delay</th>
                                    <th style={{ textAlign: "right" }}>LD %</th>
                                    {isDeliverable && <th style={{ textAlign: "right" }}>LD amount</th>}
                                    <th>Evaluated</th>
                                </tr>
                            </thead>
                            <tbody>
                                {item.occurrences.map((o, i) => (
                                    <tr key={`${o.activityId}-${o.mappingId || i}`}>
                                        <td>
                                            <div style={{ fontWeight: 700, color: INK, fontSize: 12.5 }}>{o.activityCode || "—"}</div>
                                            <div style={{ fontSize: 11.5, ...muted }}>{o.activityName || ""}</div>
                                        </td>
                                        <td style={{ fontSize: 12, ...muted }}>{o.milestoneName || "—"}</td>
                                        <td>
                                            <StatusBadge status={o.status} />
                                            {o.isLocalDraft && (
                                                <span
                                                    className="uidai-pmis-badge uidai-pmis-badge-orange"
                                                    style={{ marginLeft: 5, fontSize: 9.5 }}
                                                    title={`Scored from a local draft entered on this page${o.draftSavedAt ? ` on ${new Date(o.draftSavedAt).toLocaleString("en-IN")}` : ""}. Not saved to the server.`}
                                                >
                                                    draft
                                                </span>
                                            )}
                                        </td>
                                        {/* Only pending rows are editable. A row the
                                            backend actually scored is shown, never
                                            overwritten from here. */}
                                        <td>
                                            {o.normalizedStatus === STATUS.PENDING || o.isLocalDraft ? (
                                                <ObservationCell
                                                    occurrence={{ ...o, slaRef: item.slaRef }}
                                                    targetRows={targetRows}
                                                    onSave={(v) => onSaveDraft(o, v)}
                                                    onClear={() => onClearDraft(o)}
                                                />
                                            ) : (
                                                <span style={{ ...muted, fontSize: 11.5 }}>—</span>
                                            )}
                                        </td>
                                        {isPoints && (
                                            <td style={{ textAlign: "right", fontVariantNumeric: "tabular-nums", fontWeight: 700, color: severityAccent(o.cappedLevel) }}>
                                                {o.capApplied ? (
                                                    <span title={`Raw severity ${o.severityLevel} capped to ${o.cappedLevel} (§5.28.1.b)`}>
                                                        <s style={{ ...muted, fontWeight: 500, marginRight: 4 }}>{num(o.severityLevel, 0)}</s>
                                                        {num(o.cappedLevel, 0)}
                                                    </span>
                                                ) : (
                                                    num(o.cappedLevel, 0)
                                                )}
                                            </td>
                                        )}
                                        {isPoints && (
                                            <td style={{ textAlign: "right", fontVariantNumeric: "tabular-nums", fontWeight: 700 }}>
                                                {o.pointsUnknown ? (
                                                    <span title="No severity master row for this level" style={{ color: AMBER }}>?</span>
                                                ) : (
                                                    num(o.points, 0)
                                                )}
                                            </td>
                                        )}
                                        <td style={{ textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{num(o.targetDays)}</td>
                                        <td style={{ textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{num(o.actualDays)}</td>
                                        <td style={{
                                            textAlign: "right", fontVariantNumeric: "tabular-nums",
                                            color: Number(o.delayDays) > 0 ? RED : undefined,
                                            fontWeight: Number(o.delayDays) > 0 ? 700 : 400,
                                        }}>
                                            {num(o.delayDays)}
                                        </td>
                                        <td style={{ textAlign: "right", fontVariantNumeric: "tabular-nums", fontWeight: 700 }}>
                                            {pct(o.ldPercent)}
                                        </td>
                                        {isDeliverable && (
                                            <td
                                                style={{ textAlign: "right", fontVariantNumeric: "tabular-nums", fontWeight: 700, color: Number(o.ldAmount) > 0 ? RED : undefined }}
                                                title={o.ldBaseKind ? `Base: ${o.ldBaseKind}` : undefined}
                                            >
                                                {money(o.ldAmount)}
                                            </td>
                                        )}
                                        <td style={{ fontSize: 12, ...muted, whiteSpace: "nowrap" }}>{o.evaluatedOn || "—"}</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                </div>
            )}
        </div>
    );
}

/* ─── panel ──────────────────────────────────────────────────────── */

export default function SlaQuarterRollupPanel({ projectId, projectStartDate, projectEndDate }) {
    // Every evaluation result in the project, loaded once and filtered per
    // quarter in a memo below.
    const [allResults, setAllResults] = useState([]);
    const [severityMaster, setSeverityMaster] = useState([]);
    const [ldBands, setLdBands] = useState([]);
    /* NPQP is published per CALENDAR quarter while everything else here is
       measured from T0, so a contract quarter usually straddles two of
       them. Both are fetched and blended by day overlap — see
       `overlappingCalendarQuarters`. `npqpParts` keeps each quarter's raw
       payload so a per-quarter failure can be named rather than folded
       into one useless "NPQP unavailable". */
    const [npqpParts, setNpqpParts] = useState([]);
    const [npqpError, setNpqpError] = useState("");
    const [mastersError, setMastersError] = useState("");
    /* The SLA library keyed by ref AND id, kept in state because the RFP
       re-check needs the target tables and cadence long after `load` has
       returned — not just to fill gaps on incoming results. */
    const [mastersByRef, setMastersByRef] = useState(() => new Map());
    /* The backend's own quarterly aggregate, fetched purely to be compared
       against what this page computed. Two independent calculations of the
       same LD % are only worth having if a divergence is surfaced. */
    const [aggregate, setAggregate] = useState(null);
    const [aggregateError, setAggregateError] = useState("");
    /* Settlement HISTORY only — the read-only list.

       `getSettlement(projectId, quarter)` is deliberately never called from
       this page: it lazily auto-closes the quarter and persists a row as a
       side effect. A rollup someone opens to look around must not commit a
       quarter's money by being looked at. Closing stays on the Settlement
       page, behind its explicit button. */
    const [settlements, setSettlements] = useState([]);
    const [settlementsError, setSettlementsError] = useState("");
    // The library answering with zero rows is a different diagnosis from it
    // failing, and it is the one that leaves classification with nothing.
    const [slaLibraryEmpty, setSlaLibraryEmpty] = useState(false);
    /* How many SLAs came back with no target table and no escalation rule
       even after hydrating from the detail endpoint. Those cannot be
       cross-checked at all, and saying so beats a silent "✓ nothing to
       report" that only means nothing could be examined. */
    const [mastersIncomplete, setMastersIncomplete] = useState(0);

    /* Finance side of the deliverable report. `financeDenied` is kept apart
       from `financeError` because a 403 here is an ordinary outcome — plenty
       of people who read SLAs have no finance access — and reads very
       differently from the endpoint being broken. */
    const [paymentPage, setPaymentPage] = useState(null);
    const [financeError, setFinanceError] = useState("");
    const [financeDenied, setFinanceDenied] = useState(false);
    // activityId → { milestoneId, milestoneName, code, name }
    const [activityIndex, setActivityIndex] = useState(() => new Map());
    /* The resource deployment plan, distilled from the same project tree the
       fan-out already walks. §5.28.1.d defines F as the aggregate monthly
       payment of the resources deployed per this plan, so it gives an
       independent read on the NPQP base every LD here is charged against. */
    const [resourceActivities, setResourceActivities] = useState([]);

    /* T0 comes in as a prop, but `useProject` only reads an in-memory list
       that nothing populates on a deep link or a refresh — so the prop is
       empty exactly when someone opens this page directly. The project tree
       call below returns the same dates, so it is used as the real source
       and the prop is only a head start while that request is in flight. */
    const [fetchedDates, setFetchedDates] = useState(null);
    const startDate = fetchedDates?.startDate || projectStartDate || "";
    const endDate = fetchedDates?.endDate || projectEndDate || "";

    const [loading, setLoading] = useState(false);
    const [progress, setProgress] = useState({ done: 0, total: 0 });
    const [loadedOnce, setLoadedOnce] = useState(false);
    const [error, setError] = useState("");
    const [partial, setPartial] = useState("");
    const [expandAll, setExpandAll] = useState(false);
    const [showPlanDetail, setShowPlanDetail] = useState(false);
    const [showStaffingDetail, setShowStaffingDetail] = useState(false);

    /* The backend's own settlement row for THIS contract quarter.

       A contract quarter is one quarter — three months, 10 May → 09 Aug —
       and the fact that it straddles two calendar quarters is an artefact
       of how the rows happen to be keyed, not a property of the money. The
       settlement endpoint accepts any ISO date inside the target quarter,
       so asking it about a date in the middle of the window lets the
       backend resolve which quarter that is. No key is guessed here, and
       no figure is blended. */
    const [contractSettlement, setContractSettlement] = useState(null);
    const [contractSettlementError, setContractSettlementError] = useState("");
    // Bumped after a successful relaxation so the row is re-read.
    const [settlementTick, setSettlementTick] = useState(0);
    const [relaxOpen, setRelaxOpen] = useState(false);
    const [showFormulas, setShowFormulas] = useState(false);
    const [showGlossary, setShowGlossary] = useState(false);
    /* Opened automatically when something actually affects the figures —
       see IssuePanel. Otherwise it stays folded. */
    const [showIssues, setShowIssues] = useState(false);
    const [openPayables, setOpenPayables] = useState(() => new Set());
    const togglePayable = (id) => setOpenPayables((prev) => {
        const next = new Set(prev);
        if (next.has(id)) next.delete(id); else next.add(id);
        return next;
    });

    const quarters = useMemo(
        () => contractQuarters(startDate, endDate),
        [startDate, endDate]
    );
    const years = useMemo(
        () => [...new Set(quarters.map((q) => q.year))],
        [quarters]
    );

    // Default to the quarter the project is actually in — Year 1 Q1 is
    // rarely what someone opening this page wants to look at.
    const [selected, setSelected] = useState(null);
    useEffect(() => {
        if (!quarters.length) { setSelected(null); return; }
        setSelected((cur) => {
            if (cur && quarters.some((q) => q.key === cur)) return cur;
            return (contractQuarterFor(quarters) || quarters[0]).key;
        });
    }, [quarters]);

    const period = useMemo(
        () => quarters.find((q) => q.key === selected) || null,
        [quarters, selected]
    );
    /* Every calendar quarter this contract quarter touches, with the share
       of its days in each. One entry means the two align and the NPQP base
       is exact; two means it is blended. */
    const overlaps = useMemo(() => overlappingCalendarQuarters(period), [period]);
    const overlapKeys = useMemo(() => overlaps.map((o) => o.key).join(","), [overlaps]);
    /* Set only when the contract quarter coincides exactly with a calendar
       one. Both the backend's quarterly aggregate and the settlement rows
       are keyed by calendar quarter, so this is the gate on comparing this
       page against either of them: on a straddling window the two sides
       describe different date ranges and any difference between them says
       nothing about whether either is right. */
    const alignedQuarterKey = overlaps.length === 1 ? overlaps[0].key : null;

    /* A date in the middle of the contract quarter, used to ask the backend
       which quarter this window IS rather than deriving a key for it. The
       midpoint rather than the start, so a quarter beginning on the last day
       of a calendar quarter still resolves to the one it mostly occupies. */
    const quarterProbeDate = useMemo(() => {
        const a = parseIso(period?.start);
        const b = parseIso(period?.end);
        if (!a || !b) return null;
        return isoOfUtc(new Date(Math.round((a.getTime() + b.getTime()) / 2)));
    }, [period]);

    useEffect(() => {
        setContractSettlementError("");
        if (!projectId || !quarterProbeDate) { setContractSettlement(null); return undefined; }
        let cancelled = false;
        getSettlement(projectId, quarterProbeDate)
            .then((d) => { if (!cancelled) setContractSettlement(d && typeof d === "object" ? d : null); })
            .catch((err) => {
                if (cancelled) return;
                setContractSettlement(null);
                /* 404 is the ordinary "this quarter has not been closed yet"
                   answer, not a failure — the endpoint auto-closes lazily, so
                   an un-run quarter simply has no row. Reported quietly. */
                setContractSettlementError(err?.message || "settlement could not be read");
            });
        return () => { cancelled = true; };
    }, [projectId, quarterProbeDate, settlementTick]);

    /* ── the fan-out ──────────────────────────────────────────────
       Tree → activities → one compliance call each. Failures per
       activity are collected rather than thrown: one unreachable
       activity should not blank the whole quarter, but the reviewer
       does need telling that the picture is incomplete. */
    const load = useCallback(async () => {
        if (!projectId) { setError("No project in the URL."); return; }
        setLoading(true);
        setError("");
        setPartial("");
        setProgress({ done: 0, total: 0 });

        try {
            const [treeRes, sevRes, ldRes, mastersRes, financeRes, settleRes] = await Promise.allSettled([
                loadProjectTree(projectId),
                getSeverityMaster(projectId),
                getLdBands(projectId),
                listSlaMasters(projectId),
                getPaymentPage(projectId),
                listSettlements(projectId),
            ]);

            if (treeRes.status === "rejected") {
                throw new Error(treeRes.reason?.message || "Failed to load the project's activities.");
            }
            // The tree carries the project's own dates — the authoritative T0.
            setFetchedDates({
                startDate: treeRes.value?.startDate || "",
                endDate: treeRes.value?.endDate || "",
            });
            setSeverityMaster(sevRes.status === "fulfilled" ? sevRes.value : []);
            setLdBands(ldRes.status === "fulfilled" ? ldRes.value : []);

            /* The library gives each SLA a title, and a category / applied_on
               to fall back on when a result arrives without `ldBaseKind`.
               Keyed by ref AND id because results carry either.

               If it fails, say so: without it, results lacking an LD base all
               default into the quarterly track, and an empty deliverable
               section would look like a finding rather than a fault. */
            const masters = new Map();
            if (mastersRes.status === "fulfilled") {
                setMastersError("");
                setSlaLibraryEmpty(mastersRes.value.length === 0);

                /* The list is a summary — target_rows, linear_escalation and
                   the cadence fields only exist on the single-record fetch.
                   Without them every conformance check reports "could not be
                   checked", which reads like agreement. So the rows are
                   hydrated from the detail endpoint before anything uses them.
                   A detail failure keeps the list row: a missing target table
                   costs a cross-check, not the SLA's own figures. */
                const full = await hydrateSlaMasters(mastersRes.value);
                for (const m of full) {
                    if (m.slaRef) masters.set(String(m.slaRef), m);
                    if (m.slaId) masters.set(String(m.slaId), m);
                }
                const unscorable = full.filter((m) => !m.targetRows?.length && !m.linearEscalation).length;
                setMastersIncomplete(unscorable);
            } else {
                setSlaLibraryEmpty(false);
                setMastersIncomplete(0);
                setMastersError(mastersRes.reason?.message || "request failed");
            }
            setMastersByRef(masters);

            /* Closed quarters. A project with none is the normal state early
               on, not a failure — the chain then shows what it can from the
               rollup's own figures and says PA is unavailable until close. */
            if (settleRes.status === "fulfilled") {
                setSettlements(settleRes.value?.items || []);
                setSettlementsError("");
            } else {
                setSettlements([]);
                setSettlementsError(settleRes.reason?.message || "request failed");
            }

            /* Payment terms for the deliverable payable report. A 403 is an
               access outcome, not a fault: the SLA picture stays complete,
               only the money columns go away. Anything else is a real
               failure and is named. */
            if (financeRes.status === "fulfilled") {
                setPaymentPage(financeRes.value);
                setFinanceError("");
                setFinanceDenied(false);
            } else {
                setPaymentPage(null);
                const denied = isFinanceForbidden(financeRes.reason);
                setFinanceDenied(denied);
                setFinanceError(denied ? "" : (financeRes.reason?.message || "request failed"));
            }

            /* Flatten milestone → activity, keeping the labels the rest of
               the app shows so a row here is recognisable on the mapping
               page. The milestone id travels with each activity because the
               payable report joins on it: SLAs are evaluated per activity
               but money is scheduled per milestone. */
            const activities = [];
            const actIndex = new Map();
            for (const [mi, m] of (treeRes.value?.milestones || []).entries()) {
                for (const [ai, a] of (m?.activities || []).entries()) {
                    if (!a?.apiId) continue; // never saved server-side → nothing to evaluate
                    const entry = {
                        apiId: a.apiId,
                        code: a.serverDisplayCode || `A${mi + 1}.${ai + 1}`,
                        name: a.name || "",
                        milestoneId: m?.apiId || null,
                        milestoneName: m?.name || `Milestone ${mi + 1}`,
                    };
                    activities.push(entry);
                    actIndex.set(String(a.apiId), entry);
                }
            }
            setActivityIndex(actIndex);
            // Same tree, different question: what is deployed and what it costs.
            setResourceActivities(collectResourceActivities(treeRes.value?.milestones || []));
            setProgress({ done: 0, total: activities.length });

            const collected = [];
            const failures = [];
            let cursor = 0;
            let done = 0;

            async function worker() {
                for (;;) {
                    const i = cursor;
                    cursor += 1;
                    if (i >= activities.length) return;
                    const act = activities[i];
                    try {
                        const res = await getActivityCompliance(act.apiId);
                        for (const r of res?.results || []) {
                            const m = masters.get(String(r.slaRef)) || masters.get(String(r.slaId)) || null;
                            collected.push({
                                ...r,
                                // The result's own fields win; the master only fills gaps,
                                // so a re-categorised SLA cannot rewrite history.
                                ldBaseKind: r.ldBaseKind ?? m?.appliedOn ?? null,
                                formulaType: r.formulaType ?? m?.formulaType ?? null,
                                categoryCode: r.categoryCode ?? m?.categoryCode ?? null,
                                slaTitle: r.slaTitle ?? m?.title ?? null,
                                activityId: act.apiId,
                                activityCode: act.code,
                                activityName: act.name,
                                milestoneId: act.milestoneId,
                                milestoneName: act.milestoneName,
                            });
                        }
                    } catch (err) {
                        failures.push(`${act.code}: ${err?.message || "failed"}`);
                    } finally {
                        done += 1;
                        setProgress({ done, total: activities.length });
                    }
                }
            }

            await Promise.all(
                Array.from({ length: Math.min(FAN_OUT_CONCURRENCY, activities.length || 1) }, worker)
            );

            setAllResults(collected);
            setLoadedOnce(true);
            if (failures.length) {
                setPartial(
                    `${failures.length} of ${activities.length} activities could not be read, so this quarter may be understated:\n` +
                    failures.slice(0, 5).join("\n") +
                    (failures.length > 5 ? `\n…and ${failures.length - 5} more.` : "")
                );
            }
        } catch (err) {
            setError(err?.message || "Failed to build the rollup.");
            setAllResults([]);
        } finally {
            setLoading(false);
        }
    }, [projectId]);

    useEffect(() => { load(); }, [load]);

    /* NPQP is per calendar quarter and only needed for the money line, so it
       is fetched separately as the selection moves rather than in the fan-out.
       The failure message is kept rather than swallowed: "no payment base"
       is not an answer anyone can act on, and the backend's own message is
       usually the whole diagnosis.

       A contract quarter that straddles two calendar quarters needs BOTH:
       charging the whole quarter against whichever calendar quarter holds
       its midpoint was the old behaviour and could be up to half a quarter
       off. Both are fetched together and blended by day weight below. */
    useEffect(() => {
        let cancelled = false;
        setNpqpError("");
        if (!projectId || !overlaps.length) { setNpqpParts([]); return undefined; }

        Promise.allSettled(overlaps.map((o) => getNpqp(projectId, o.key)))
            .then((settled) => {
                if (cancelled) return;
                setNpqpParts(settled.map((s, i) => ({
                    ...overlaps[i],
                    data: s.status === "fulfilled" ? s.value : null,
                    error: s.status === "rejected" ? (s.reason?.message || "request failed") : "",
                })));
                const failed = settled
                    .map((s, i) => (s.status === "rejected" ? overlaps[i].key : null))
                    .filter(Boolean);
                setNpqpError(failed.length ? `could not read ${failed.join(" and ")}` : "");
            });
        return () => { cancelled = true; };
        // overlapKeys, not overlaps: the array is rebuilt on every render of a
        // new period object, but only a change of quarter keys needs a refetch.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [projectId, overlapKeys]);

    /* Results falling inside the selected contract quarter. `evaluatedOn` is
       the reporting date, which is what §5.28 accumulates points by — not
       the activity's own dates. */
    const inQuarter = useMemo(
        () => (period ? allResults.filter((r) => withinWindow(r.evaluatedOn, period)) : []),
        [allResults, period]
    );

    /* ── local observation drafts ─────────────────────────────────────
       Fills `pending_observation` rows with a value typed on this page,
       so a quarter can be worked through while the backend has no route
       for manual readings. The severity is DERIVED here from the SLA's
       own target table rather than stored, so it tracks the project's
       current configuration instead of freezing yesterday's.

       `draftTick` exists because localStorage is not reactive — saving a
       draft has to tell React something changed. */
    const [draftTick, setDraftTick] = useState(0);
    /* draftTick is the point of this dependency: localStorage is not
       reactive, so saving a draft has no other way to tell React to
       recompute. eslint reads it as unused because it is only a counter. */
    const drafts = useMemo(
        () => (projectId ? listDrafts(projectId) : {}),
        // eslint-disable-next-line react-hooks/exhaustive-deps
        [projectId, draftTick]
    );

    const scored = useMemo(() => {
        if (!period) return { results: [], appliedCount: 0 };
        // The period travels on each row so a draft is keyed to the quarter
        // it was observed for — the same SLA is measured again next quarter.
        const tagged = inQuarter.map((r) => ({ ...r, __periodKey: period.key }));
        return applyDrafts(tagged, {
            drafts,
            isPending: (r) => normalizeStatus(r.status) === STATUS.PENDING,
            deriveSeverity: (value, row) => {
                const master = mastersByRef.get(String(row.slaRef))
                    || (row.slaId ? mastersByRef.get(String(row.slaId)) : null);
                if (!master?.targetRows?.length) {
                    return { severity: null, reason: "this SLA has no target table on the SLA Library" };
                }
                return severityForValue(value, master.targetRows);
            },
        });
    }, [inQuarter, drafts, period, mastersByRef]);

    const draftCount = scored.appliedCount;

    const saveObservationDraft = useCallback((occurrence, value) => {
        if (!projectId || !period) return;
        saveDraft(projectId, {
            activityId: occurrence.activityId,
            activityCode: occurrence.activityCode,
            slaRef: occurrence.slaRef,
            periodKey: period.key,
            value: value === "" ? null : Number(value),
        });
        setDraftTick((n) => n + 1);
    }, [projectId, period]);

    const clearObservationDraft = useCallback((occurrence) => {
        if (!projectId || !period) return;
        removeDraft(projectId, observationKey({
            activityId: occurrence.activityId,
            slaRef: occurrence.slaRef,
            periodKey: period.key,
        }));
        setDraftTick((n) => n + 1);
    }, [projectId, period]);

    const clearAllDrafts = useCallback(() => {
        if (!projectId || !period) return;
        clearDrafts(projectId, period.key);
        setDraftTick((n) => n + 1);
    }, [projectId, period]);

    const { deliverableItems, quarterlyItems, scale, classification } = useMemo(
        () => rollupBySla(scored.results, { severityMaster, ldBands }),
        [scored.results, severityMaster, ldBands]
    );

    /* ── SLAs by category ─────────────────────────────────────────────
       The two TRACKS say what an LD is charged on — a deliverable's own
       cost, or NPQP. That is the right split for the money and the wrong
       one for a reader: it puts resource deployment, query resolution and
       the governance tool in one undifferentiated pile because they happen
       to share a charging base.

       Categories are what people actually mean by "the resource SLAs".
       Derived from the data rather than a hardcoded list, so a category
       added to the library appears here without a code change, and one
       with nothing in it this quarter does not render an empty tab. */
    const categories = useMemo(() => {
        const map = new Map();
        for (const it of [...quarterlyItems, ...deliverableItems]) {
            const code = it.category || UNCATEGORISED;
            if (!map.has(code)) {
                map.set(code, {
                    code,
                    label: humanizeCategory(code),
                    track: it.track,
                    items: [],
                    breached: 0, met: 0, pending: 0, excluded: 0,
                    ldPercent: 0, ldAmount: 0,
                    /* A category holding both tracks is a data defect, not a
                       layout case — flagged so the strip can say so rather
                       than silently show a % and a ₹ that do not add up. */
                    mixedTrack: false,
                });
            }
            const g = map.get(code);
            if (g.track !== it.track) g.mixedTrack = true;
            g.items.push(it);
            g.breached += Number(it.breached) || 0;
            g.met += Number(it.met) || 0;
            g.pending += Number(it.pending) || 0;
            g.excluded += Number(it.excluded) || 0;
            g.ldPercent += Number(it.ldPercent) || 0;
            g.ldAmount += Number(it.totalLdAmount) || 0;
        }
        /* Quarterly categories lead, matching the order of the sections
           below; within a track, the ones that cost something come first —
           a reader opening this quarter is looking for what it cost. */
        return [...map.values()].sort((a, b) => {
            if ((a.track === TRACK.DELIVERABLE) !== (b.track === TRACK.DELIVERABLE)) {
                return a.track === TRACK.DELIVERABLE ? 1 : -1;
            }
            const aCost = a.ldPercent + a.ldAmount;
            const bCost = b.ldPercent + b.ldAmount;
            if (aCost !== bCost) return bCost - aCost;
            return a.label.localeCompare(b.label);
        });
    }, [quarterlyItems, deliverableItems]);

    const [activeCategory, setActiveCategory] = useState(ALL_CATEGORIES);

    /* A tab that no longer exists — the quarter changed, or the SLA that
       carried the only instance of that category was not evaluated this
       time — falls back to All rather than rendering nothing at all. */
    useEffect(() => {
        if (activeCategory === ALL_CATEGORIES) return;
        if (!categories.some((c) => c.code === activeCategory)) setActiveCategory(ALL_CATEGORIES);
    }, [categories, activeCategory]);

    const visibleCategories = useMemo(
        () => (activeCategory === ALL_CATEGORIES
            ? categories
            : categories.filter((c) => c.code === activeCategory)),
        [categories, activeCategory]
    );
    const visibleQuarterly = useMemo(
        () => visibleCategories.filter((c) => c.track !== TRACK.DELIVERABLE),
        [visibleCategories]
    );
    const visibleDeliverable = useMemo(
        () => visibleCategories.filter((c) => c.track === TRACK.DELIVERABLE),
        [visibleCategories]
    );

    /* The NPQP endpoint answers 200 even when it could not compute a base,
       flagging why in `status` — so an absent base has to be read off that
       field rather than off a thrown error. Only `leave_mgmt_unavailable`
       actually means the leave service is unreachable; any other status is
       reported verbatim rather than guessed at, because telling someone to
       go chase a service that is fine wastes their afternoon. */
    /* Each overlapping calendar quarter reduced to a usable base or a named
       reason it has none, then blended by day weight. A part that answered
       200 with a non-ok status is NOT usable — that is the whole point of
       checking `status` rather than trusting the absence of a throw. */
    const npqpBlend = useMemo(() => {
        const values = {};
        for (const p of npqpParts) {
            const ok = p.data && (!p.data.status || p.data.status === "ok");
            if (ok) values[p.key] = p.data.npqp;
        }
        return blendNpqp(overlaps, values);
    }, [npqpParts, overlaps]);

    const npqpValue = npqpBlend.npqp;

    /* One line naming why there is no base, in the part's own words. A
       blend is all-or-nothing: half a base would understate every LD on
       screen while looking like a real number. */
    const npqpIssue = useMemo(() => {
        if (npqpBlend.complete) return null;
        if (!npqpParts.length) return npqpError ? `NPQP call failed — ${npqpError}` : null;
        const reasons = npqpParts
            .filter((p) => !(p.data && (!p.data.status || p.data.status === "ok")))
            .map((p) => {
                if (p.error) return `${p.key}: ${p.error}`;
                if (p.data?.status === "leave_mgmt_unavailable") {
                    return `${p.key}: leave-management unreachable, so F could not be computed`;
                }
                return `${p.key}: status ${p.data?.status ?? "no data"}`;
            });
        return reasons.length ? reasons.join(" · ") : null;
    }, [npqpBlend.complete, npqpParts, npqpError]);

    const totals = useMemo(
        () => quarterTotals(quarterlyItems, { npqp: npqpValue }),
        [quarterlyItems, npqpValue]
    );

    /* ── F from the resource deployment plan (§5.28.1.d) ──────────────
       The plan is scoped to the CONTRACT quarter, so the endpoint's F has
       to be blended across the same calendar quarters and by the same day
       weights as NPQP itself — otherwise the two sides would be describing
       different windows and any difference between them would say nothing. */
    const plan = useMemo(
        () => deriveQuarterlyResourcePlan(resourceActivities, period),
        [resourceActivities, period]
    );

    const endpointF = useMemo(() => {
        const values = {};
        for (const p of npqpParts) {
            const ok = p.data && (!p.data.status || p.data.status === "ok");
            if (ok) values[p.key] = p.data.fAmount;
        }
        return blendNpqp(overlaps, values).npqp;
    }, [npqpParts, overlaps]);

    const fCheck = useMemo(() => compareFToPlan(plan.fAmount, endpointF), [plan.fAmount, endpointF]);

    /* ── who was actually on the seats (§5.28.3, SLA 007 Note) ────────
       The deployment plan above says what was PLANNED. This says what was
       STAFFED — and the two differ whenever a resource left and their
       replacement had not joined, which is the case the SLA 007 Note
       carves out of the calculation.

       Fetched per activity because the endpoint is keyed that way, and
       only for the activities the quarter actually contains. The id list
       is joined into a string so the effect re-runs when the QUARTER's
       activities change, not on every render that rebuilds `plan`. */
    const [replacementReports, setReplacementReports] = useState(null);
    const [replacementsError, setReplacementsError] = useState("");
    const [replacementsLoading, setReplacementsLoading] = useState(false);

    const planActivityKey = useMemo(
        () => plan.activities.map((a) => a.activityId).filter(Boolean).join(","),
        [plan.activities]
    );

    useEffect(() => {
        const ids = planActivityKey ? planActivityKey.split(",") : [];
        setReplacementsError("");
        if (!projectId || !ids.length) { setReplacementReports(null); return undefined; }

        const controller = new AbortController();
        let cancelled = false;
        setReplacementsLoading(true);

        fetchReplacementsForActivities(
            projectId,
            plan.activities.filter((a) => a.activityId),
            { concurrency: FAN_OUT_CONCURRENCY, signal: controller.signal }
        )
            .then(({ reports, failures }) => {
                if (cancelled) return;
                const normalized = new Map();
                for (const [activityId, raw] of reports) {
                    const act = plan.activities.find((a) => String(a.activityId) === activityId);
                    normalized.set(activityId, normalizeReplacementReport(raw, {
                        activityId,
                        activityCode: act?.code || "",
                        activityName: act?.name || "",
                    }));
                }
                setReplacementReports(normalized);
                /* A partial staffing picture is still worth showing, but a
                   headcount computed from three of five activities is not
                   the quarter's headcount and must not read as though it
                   were. */
                if (failures.length) {
                    setReplacementsError(
                        `${failures.length} activit${failures.length === 1 ? "y" : "ies"} could not be read, `
                        + `so the deployment figures below are incomplete: ${failures.slice(0, 3).join("; ")}`
                        + (failures.length > 3 ? `; …and ${failures.length - 3} more.` : "")
                    );
                }
            })
            .catch((err) => {
                if (cancelled || err?.name === "AbortError") return;
                setReplacementReports(null);
                setReplacementsError(err?.message || "Staffing history could not be read.");
            })
            .finally(() => { if (!cancelled) setReplacementsLoading(false); });

        return () => { cancelled = true; controller.abort(); };
        // `plan.activities` is derived from planActivityKey; depending on the
        // array itself would refetch on every render that rebuilds the plan.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [projectId, planActivityKey]);

    /* Seat-days over the whole reporting quarter, and again per measurement
       interval — SLA 007 runs monthly and reports quarterly (§5.28.1.a), so
       a seat vacant through one month must not be averaged away against the
       two months it was filled. */
    const occupancy = useMemo(
        () => occupancyForWindow(replacementReports, period),
        [replacementReports, period]
    );
    const occupancyIntervals = useMemo(
        () => (replacementReports ? occupancyByInterval(replacementReports, period) : []),
        [replacementReports, period]
    );
    const sla007 = useMemo(() => sla007Adjustment(occupancy), [occupancy]);

    /* Bundled once so the SLA group and the staffing section read the same
       figures — two call sites recomputing this independently is how they
       drift apart. */
    const staffing = useMemo(
        () => ({ applicable: occupancy.hasData, adjustment: sla007, intervals: occupancyIntervals }),
        [occupancy.hasData, sla007, occupancyIntervals]
    );

    /* ── the money chain (§5.28.1.d) ──────────────────────────────────
       The settled row for THIS quarter, matched only when the contract
       quarter aligns with a calendar one — settlement rows are keyed by
       fiscal year + calendar quarter, and pairing a straddling window
       with one of them would attribute the wrong money to it. */
    const settlementRow = useMemo(() => {
        /* The backend's answer for a date inside this contract quarter wins:
           it resolved the window itself, so there is nothing left to guess.
           The keyed lookup below is the fallback for when that call has not
           landed, or 404'd because the quarter is not closed yet. */
        if (contractSettlement) return contractSettlement;
        if (!alignedQuarterKey) return null;
        const [y, q] = alignedQuarterKey.split("-Q");
        return settlements.find(
            (r) => Number(r.fiscalYear) === Number(y) && Number(r.quarter) === Number(q)
        ) || null;
    }, [contractSettlement, settlements, alignedQuarterKey]);

    /* PA only exists once a quarter has been settled — it is the actual
       deployment payable, computed from attendance. Everything else the
       chain needs, this page already has, so an unsettled quarter still
       shows F, QGR, NPQP and LD and simply names PA as pending. */
    const chain = useMemo(() => buildSettlementChain({
        fAmount: settlementRow?.fAmount ?? endpointF,
        qgrAmount: settlementRow?.qgrAmount ?? npqpParts.find((p) => p.data?.qgrAmount != null)?.data?.qgrAmount,
        npqp: settlementRow?.npqp ?? npqpValue,
        sumLdPercent: settlementRow?.sumLdPercent ?? totals.sumLdPercent,
        cappedLdPercent: settlementRow?.cappedLdPercent,
        quarterCapPercent: totals.quarterCapPercent,
        paAmount: settlementRow?.paAmount,
    }), [settlementRow, endpointF, npqpParts, npqpValue, totals.sumLdPercent, totals.quarterCapPercent]);

    /* The "which AQP formula did the backend apply" check lived here and
       rendered inside the settlement-chain section. That section is gone —
       the chain is keyed by calendar quarter and this page measures
       contract quarters — so the check has nowhere to report to.
       `verifyAqp` stays in settlementChain.js for the Settlement & LD page,
       which is keyed the same way the backend is. */

    /* ── QGR, and where this quarter's instalment sits ────────────────
       §5.23.2 guarantees 35% of the Phase-1 fixed + one-time cost, paid as
       equal instalments across the Phase 2/3 quarters. The NPQP endpoint
       carries that basis; the field names are read from a candidate list
       because the services do not agree on casing or on which spelling of
       "instal(l)ment" to use.

       Anything the payload does not carry is derived only where the
       arithmetic is exact — count from total ÷ per-quarter, total from
       per-quarter × count — and left null otherwise. An instalment number
       is never invented: "3 of 10" that is actually 4 of 12 is worse than
       no instalment line at all. */
    const qgr = useMemo(() => {
        const sources = [...npqpParts.map((p) => p.data), contractSettlement].filter(Boolean);

        const perQuarter = pick(sources, ["qgrAmount", "qgr_amount", "qgr"]);
        let total = pick(sources, ["qgrTotal", "qgr_total", "totalQgr", "total_qgr", "qgrGuaranteedTotal"]);
        let count = pick(sources, [
            "qgrInstalmentCount", "qgr_instalment_count",
            "qgrInstallmentCount", "qgr_installment_count",
            "qgrInstalments", "qgrInstallments",
            "totalInstalments", "totalInstallments",
            "phase23Quarters", "phase2And3Quarters", "phase_2_3_quarters",
        ]);
        const number = pick(sources, [
            "qgrInstalment", "qgr_instalment", "qgrInstalmentNumber", "qgr_instalment_number",
            "qgrInstallment", "qgr_installment", "qgrInstallmentNumber", "qgr_installment_number",
            "instalmentNumber", "installmentNumber", "instalmentNo", "installmentNo",
        ]);
        let base = pick(sources, [
            "phase1FixedOneTime", "phase1_fixed_one_time", "phase1Cost", "phase1_cost",
            "fixedAndOneTimeCost", "fixed_and_one_time_cost",
        ]);
        const sharePercent = pick(sources, ["qgrPercent", "qgr_percent", "guaranteedPercent"]) ?? 35;

        if (total === null && perQuarter !== null && count !== null) total = perQuarter * count;
        if (count === null && total !== null && perQuarter) {
            const derived = total / perQuarter;
            // Only when it divides cleanly — a fractional instalment count
            // means one of the two figures is not what this arithmetic assumes.
            if (Math.abs(derived - Math.round(derived)) < 0.01) count = Math.round(derived);
        }
        if (base === null && total !== null && sharePercent) base = total / (sharePercent / 100);

        /* QGR actually paid across settled quarters — the running total,
           independent of the instalment arithmetic above, so it stands even
           when the basis fields are absent. */
        const paidToDate = settlements.reduce((n, r) => {
            const v = Number(r?.qgrAmount);
            return Number.isFinite(v) ? n + v : n;
        }, 0);
        const paidCount = settlements.filter((r) => Number.isFinite(Number(r?.qgrAmount))).length;

        return {
            perQuarter, total, count, number, base, sharePercent,
            paidToDate, paidCount,
            hasBasis: total !== null || count !== null || number !== null,
        };
    }, [npqpParts, contractSettlement, settlements]);

    /* ── LD relaxation (§5.28.1.d) ────────────────────────────────────
       A relaxation lowers the quarter's Σ LD %. It is stored through the
       settlement override — the backend re-caps the value and keeps the
       reason — so the SCORED figure survives only here, recomputed from
       the evaluations. Showing both is the whole point: a statement that
       displayed the relaxed figure alone would give no way to see that a
       relaxation happened at all.

       Deliverable LD (SLA 001/002) is untouched — it is charged on each
       deliverable's own cost and settled separately. */
    const relaxation = useMemo(() => {
        const scored = Number(totals.sumLdPercent);
        /* Guarded on the RAW value, not on the converted one: `Number(null)`
           is 0, not NaN, so a settled row that simply carries no sumLdPercent
           would otherwise read as "relaxed to zero" and this page would claim
           a relaxation of the entire quarter's LD that nobody granted. */
        const rawStored = settlementRow?.sumLdPercent;
        const stored = Number(rawStored);
        const hasStored = rawStored !== null && rawStored !== undefined && rawStored !== ""
            && Number.isFinite(stored);
        const granted = hasStored && Number.isFinite(scored) && scored - stored > 0.0001
            ? scored - stored
            : 0;
        const npqp = Number(chain.npqp);
        return {
            scoredPercent: Number.isFinite(scored) ? scored : null,
            effectivePercent: hasStored ? stored : (Number.isFinite(scored) ? scored : null),
            grantedPercent: granted,
            grantedAmount: granted > 0 && Number.isFinite(npqp) ? (granted / 100) * npqp : null,
            reason: settlementRow?.overrideReason || "",
            applied: granted > 0,
            // Only a closed quarter has a row to override (404 before that).
            canGrant: !!settlementRow && String(settlementRow.status || "") !== "invoiced",
            blockedReason: !settlementRow
                /* The endpoint's own words when it refused, rather than a
                   guess at why. A 404 here means "not closed yet", which is
                   ordinary; anything else is worth reading verbatim. */
                ? (contractSettlementError
                    ? `This quarter's settlement could not be read — ${contractSettlementError}`
                    : "This quarter has no settlement row yet, so there is nothing to relax. It is created when the quarter is closed.")
                : String(settlementRow.status || "") === "invoiced"
                    /* The backend's own words, confirmed against the live
                       endpoint: it answers 422 `settlement_immutable` with
                       "Cannot override an invoiced settlement — issue a credit
                       note." That names the remedy, which my paraphrase did
                       not. The guard stays only to spare a doomed request and
                       a filled-in form; the rule is the server's. */
                    ? "Cannot override an invoiced settlement — issue a credit note."
                    : "",
        };
    }, [totals.sumLdPercent, settlementRow, chain.npqp, contractSettlementError]);

    /* ── does that settlement row actually cover this quarter? ────────
       The rows carry `quarterStart` / `quarterEnd`, and they are CALENDAR
       quarters: 2026-Q3 is 01 Jul → 30 Sep. A contract quarter measured
       from T0 is a different three-month window — Y1·Q3 here is 10 May →
       09 Aug — so asking the endpoint about a date inside the contract
       quarter returns a row describing a window that is not this one.

       Checked rather than assumed, because the failure is silent: every
       figure would look plausible while belonging to a different quarter.
       The dates are compared directly; nothing is inferred from the key. */
    const settlementWindow = useMemo(() => {
        const rowStart = settlementRow?.quarterStart ? String(settlementRow.quarterStart).slice(0, 10) : "";
        const rowEnd = settlementRow?.quarterEnd ? String(settlementRow.quarterEnd).slice(0, 10) : "";
        if (!settlementRow || !rowStart || !rowEnd || !period?.start || !period?.end) {
            return { known: false, matches: null, rowStart, rowEnd };
        }
        const matches = rowStart === period.start && rowEnd === period.end;
        const overlapStart = rowStart > period.start ? rowStart : period.start;
        const overlapEnd = rowEnd < period.end ? rowEnd : period.end;
        const overlapDays = overlapStart <= overlapEnd ? inclusiveDaysOf(overlapStart, overlapEnd) : 0;
        const periodDays = inclusiveDaysOf(period.start, period.end);
        return {
            known: true,
            matches,
            rowStart,
            rowEnd,
            overlapDays,
            periodDays,
            overlapPercent: periodDays ? Math.round((overlapDays / periodDays) * 1000) / 10 : null,
            key: settlementRow.fiscalYear && settlementRow.quarter
                ? `${settlementRow.fiscalYear}-Q${settlementRow.quarter}`
                : "",
        };
    }, [settlementRow, period]);

    const grantRelaxation = useCallback(async ({ relaxPercent, reason }) => {
        const scored = Number(totals.sumLdPercent) || 0;
        const next = Math.max(0, scored - Number(relaxPercent));
        await overrideSettlement(projectId, quarterProbeDate, {
            sumLdPercent: next,
            overrideReason: reason,
        });
        setSettlementTick((t) => t + 1);
    }, [projectId, quarterProbeDate, totals.sumLdPercent]);

    const cumulative = useMemo(() => cumulativePayout(settlements), [settlements]);

    /* §5.26.2 — 1.25 × contract value. The payment page is already loaded
       for the deliverable report and carries the contract value on its
       totals, so no extra call. */
    const ceiling = useMemo(
        () => contractCeiling(paymentPage?.totals?.totalContractCost, cumulative.totalAqp),
        [paymentPage, cumulative.totalAqp]
    );
    const dTotals = useMemo(() => deliverableTotals(deliverableItems), [deliverableItems]);

    /* ── the backend's own aggregate, for comparison ──────────────────
       Only fetched when the contract quarter aligns exactly with a
       calendar one. The aggregate endpoint is keyed by calendar quarter,
       so on a straddling window the two sides would be scoring different
       date ranges and any difference between them would say nothing about
       whether either is right. Refusing to run the check is the honest
       outcome; running it and reporting noise is not. */
    useEffect(() => {
        let cancelled = false;
        setAggregateError("");
        setAggregate(null);
        if (!projectId || !alignedQuarterKey) return undefined;
        getQuarterlyAggregate(projectId, alignedQuarterKey)
            .then((d) => { if (!cancelled) setAggregate(d); })
            .catch((err) => { if (!cancelled) setAggregateError(err?.message || "request failed"); });
        return () => { cancelled = true; };
    }, [projectId, alignedQuarterKey]);

    /* Per-SLA: what this page computed vs what the backend's aggregate
       says for the same SLA in the same window. Both are derived from the
       same evaluation results, so they should agree — a divergence means
       one of them applied a rule the other did not. */
    const aggregateCheck = useMemo(() => {
        if (!aggregate) return null;
        const items = Array.isArray(aggregate.items) ? aggregate.items : [];
        const byRef = new Map();
        for (const it of items) {
            const ref = it.slaRef ?? it.sla_ref;
            if (ref) byRef.set(String(ref), it);
        }
        const rows = quarterlyItems.map((i) => {
            const b = byRef.get(String(i.slaRef)) || null;
            const mine = Number.isFinite(i.ldPercent) ? i.ldPercent : null;
            const theirs = b && b.ldPercent !== null && b.ldPercent !== undefined ? Number(b.ldPercent) : null;
            return {
                slaRef: i.slaRef,
                mine,
                theirs,
                minePoints: i.accumulatedPoints,
                theirPoints: b?.accumulatedPoints ?? null,
                missing: !b,
                diverges: mine !== null && theirs !== null && Math.abs(mine - theirs) > 0.005,
            };
        });
        // SLAs the backend scored that never reached this page at all — an
        // activity the fan-out could not read, or a result with no date.
        const extra = items
            .filter((it) => !quarterlyItems.some((i) => String(i.slaRef) === String(it.slaRef ?? it.sla_ref)))
            .map((it) => String(it.slaRef ?? it.sla_ref));
        const mineTotal = totals.sumLdPercent;
        const theirTotal = Number(aggregate.totalLdPercentUncapped);
        return {
            rows,
            extra,
            problems: rows.filter((r) => r.diverges || r.missing),
            mineTotal,
            theirTotal: Number.isFinite(theirTotal) ? theirTotal : null,
            totalDiverges: Number.isFinite(theirTotal) && Math.abs(mineTotal - theirTotal) > 0.005,
        };
    }, [aggregate, quarterlyItems, totals.sumLdPercent]);

    /* ── RFP conformance re-check ─────────────────────────────────────
       Re-scores each SLA under the rule its own master describes —
       averaging where measurement is finer than reporting, counting where
       the target table is occurrence-driven, rounding weeks up where the
       escalation is linear. Advisory only: nothing here changes a total. */
    const rechecks = useMemo(() => {
        const out = new Map();
        for (const item of [...quarterlyItems, ...deliverableItems]) {
            const master = mastersByRef.get(String(item.slaRef))
                || (item.slaId ? mastersByRef.get(String(item.slaId)) : null);
            if (!master) continue;
            const r = recheckSla(item, master, { severityScale: scale, ldBands, period });
            if (r) out.set(String(item.slaRef), r);
        }
        return out;
    }, [quarterlyItems, deliverableItems, mastersByRef, scale, ldBands, period]);

    const recheckIssues = useMemo(
        () => [...rechecks.values()].filter((r) => r.diverges || r.note),
        [rechecks]
    );

    /* Breaches opened in an earlier quarter and never resolved. §5.28.3.f/g
       keep re-scoring these every quarter until onboarding happens, but the
       backend only emits a result when something is evaluated — so an open
       obligation silently vanishes from later quarters. */
    const carried = useMemo(
        () => detectCarryForward({ allResults, period, mastersByRef }),
        [allResults, period, mastersByRef]
    );

    // §5.27.6's ceiling becomes ambiguous only when both regimes charge in
    // the same quarter. See combinedCapCheck for why that is left to a human.
    const combinedCap = useMemo(() => combinedCapCheck(totals, dTotals), [totals, dTotals]);

    /* Deliverable payment → LD → net payable. Charged on the milestone's LD
       Basis (its full allotment) and deducted from what it is actually paid
       — the two are different fields and the finance module keeps them
       apart deliberately. No ceiling is imposed: §5.28.2 states none, and
       the §5.27.6 / §5.28.1.b ceilings govern the quarterly track only. */
    const payables = useMemo(
        () => buildDeliverablePayables({ deliverableItems, paymentPage, activityIndex }),
        [deliverableItems, paymentPage, activityIndex]
    );

    /* Severity/band configuration is only needed by the points-scored SLAs.
       A project running nothing but deliverable and linear SLAs is fully
       scoreable without it, so the warning is scoped to when it can bite. */
    /* The LD % of the highest band — the per-SLA ceiling §5.28.1.b imposes,
       since the band table's top row is what points past it earn. Read off
       the project's own bands rather than assuming the RFP's 4%. */
    const topBand = useMemo(() => {
        const sorted = ldBands
            .filter((b) => Number.isFinite(b.points_threshold) && Number.isFinite(b.ld_percent))
            .sort((a, b) => a.points_threshold - b.points_threshold);
        return sorted.length ? sorted[sorted.length - 1].ld_percent : null;
    }, [ldBands]);

    /* ── the payment statement ────────────────────────────────────────
       The two streams brought together into one invoice.

       They are computed separately and never mixed — deliverable LD is
       charged on a deliverable's own cost, quarterly LD on NPQP — but
       they are PAID together, and tax applies to the invoice as a whole
       (§5.28.1.e), not to each stream separately. So the tax is taken on
       the combined figure here rather than on AQP alone.

       A stream with no figure is left out of the total and named, never
       counted as zero: a quarter whose PA has not been resolved yet
       would otherwise show a confident "due" that is short by the whole
       resource payment. */
    /* The chain falls back to this page's own Σ LD % when a quarter has not
       been settled — so on an OPEN quarter a draft does reach the payment
       figures. On a settled quarter the backend's row wins and drafts cannot
       touch it. Both are fine; conflating them would not be. */
    const draftAffectsPayment = draftCount > 0 && !settlementRow;

    const statement = useMemo(() => {
        const deliverableNet = Number.isFinite(payables.totals.totalNetPayable)
            ? payables.totals.totalNetPayable : null;
        const quarterlyNet = Number.isFinite(chain.aqp) ? chain.aqp : null;

        const present = [deliverableNet, quarterlyNet].filter((v) => v !== null);
        const grossDue = present.length ? present.reduce((a, b) => a + b, 0) : null;

        const pending = [];
        if (deliverableItems.length > 0 && deliverableNet === null) pending.push("deliverable payments");
        if (quarterlyItems.length > 0 && quarterlyNet === null) pending.push("the quarterly resource payment");

        /* What the SLAs took off, across BOTH regimes. They are computed
           separately and never mixed — one on a deliverable's own cost, one
           on NPQP — but a reader asking "what did service levels cost us
           this quarter" wants the one figure, and it is only ever presented
           as a total, never fed back into either regime's arithmetic. */
        const ldParts = [payables.totals.totalLdAmount, chain.ldAmount]
            .filter((v) => Number.isFinite(v));
        const totalLd = ldParts.reduce((a, b) => a + b, 0);

        return {
            deliverableNet,
            quarterlyNet,
            grossDue,
            totalLd,
            pending,
            complete: pending.length === 0 && grossDue !== null,
            tax: taxBreakdown(grossDue),
        };
    }, [payables.totals.totalNetPayable, payables.totals.totalLdAmount, chain.aqp, chain.ldAmount,
        deliverableItems.length, quarterlyItems.length]);

    /* Occurrences that were evaluated but never read. Every resource SLA
       (005–009) is manual by definition — the backend cannot derive
       attendance — so these do not resolve by waiting.

       The activity is captured alongside the SLA ref because the fix is
       per-activity: Activity SLA Mapping is reached with an `activityId`
       in the query string, so knowing which activities are waiting turns
       "go and find it" into a link. */
    const awaiting = useMemo(() => {
        const rows = [];
        for (const item of [...quarterlyItems, ...deliverableItems]) {
            for (const o of item.occurrences || []) {
                if (normalizeStatus(o.status) !== STATUS.PENDING) continue;
                rows.push({
                    slaRef: item.slaRef,
                    activityId: o.activityId || null,
                    activityCode: o.activityCode || null,
                    activityName: o.activityName || null,
                });
            }
        }
        const byActivity = new Map();
        for (const r of rows) {
            const key = String(r.activityId ?? r.activityCode ?? "—");
            if (!byActivity.has(key)) {
                byActivity.set(key, { ...r, slaRefs: [] });
            }
            byActivity.get(key).slaRefs.push(r.slaRef);
        }
        return { rows, count: rows.length, activities: [...byActivity.values()] };
    }, [quarterlyItems, deliverableItems]);

    const awaitingObservation = awaiting.count;

    const needsScale = quarterlyItems.some((i) => i.scoring === SCORING.POINTS);
    const unconfigured = needsScale && (!scale.configured || !ldBands.length);
    const undated = allResults.filter((r) => !r.evaluatedOn).length;


    /* ── diagnostics, as data ─────────────────────────────────────────
       These were nine stacked red banners. Every one of them is real and
       worth keeping, but they are addressed to whoever configures the SLA
       library or runs the backend — not to the person who opened this page
       to find out what the quarter cost. Nine red blocks above the numbers
       also read as "everything is broken", which flattens the difference
       between "an SLA has no category" and "the LD is wrong".

       So they are collected here with a severity, folded into one
       collapsible block, and counted. Nothing is dropped or softened —
       `blocking` issues still say the figures cannot be trusted. */
    const issues = useMemo(() => {
        if (!loadedOnce) return [];
        const out = [];
        const add = (level, title, detail) => out.push({ level, title, detail });

        if (classification.defaulted > 0) {
            add("blocking",
                `${classification.defaulted} SLA(s) could not be classified`,
                `${classification.defaultedRefs.join(", ")} carry no LD base and no category, so they were put in the `
                + `Quarterly section by default. `
                + (mastersError
                    ? `The SLA library could not be read (${mastersError}), which is why the fallback had nothing to use.`
                    : `Set each SLA's category on the SLA Library — "Deliverable Submission" is what routes an SLA to the deliverable section.`));
        }
        if (classification.byLdBaseKind > 0 && classification.byCategory === 0) {
            add("blocking",
                `${classification.byLdBaseKind} SLA(s) have no category set`,
                `${classification.byLdBaseKindRefs.join(", ")} were placed using "Applied On" alone. That field defaults to `
                + `Quarterly Payment on the server, so deliverable SLAs (001 / 002) silently land in the quarterly section. `
                + (slaLibraryEmpty
                    ? `The SLA library returned no rows for this project — check these SLAs are saved against it.`
                    : `Open each on the SLA Library and set its category.`));
        }
        if (classification.conflictCount > 0) {
            add("warn",
                `${classification.conflictCount} SLA(s) have a contradictory "Applied On"`,
                classification.conflicts.map((c) => `${c.slaRef}: category ${c.category}, but stored as ${c.storedBase}`).join(" · ")
                + `. They were classified by category, which is correct — but the stored value is wrong at source. Re-save them on the SLA Library.`);
        }
        if (mastersError && classification.defaulted === 0) {
            add("info", "SLA library unavailable",
                `${mastersError}. SLA titles are missing, but every SLA classified itself from its own result data, so the figures are unaffected.`);
        }
        if (unconfigured) {
            add("blocking", "Scoring is not configured",
                [!scale.configured && "no severity levels", !ldBands.length && "no LD bands"].filter(Boolean).join(" and ")
                + " are set up for this project. Points and penalty % cannot be computed until Severity & LD Bands is configured.");
        }
        if (aggregateCheck && (aggregateCheck.totalDiverges || aggregateCheck.problems.length > 0 || aggregateCheck.extra.length > 0)) {
            add("blocking", `This page and the backend disagree about ${alignedQuarterKey}`,
                (aggregateCheck.totalDiverges ? `Total penalty: ${aggregateCheck.mineTotal}% here vs ${aggregateCheck.theirTotal}% on the backend. ` : "")
                + aggregateCheck.problems.slice(0, 5).map((p) => (p.missing
                    ? `${p.slaRef}: ${p.mine}% here, absent on the backend`
                    : `${p.slaRef}: ${p.mine}% here vs ${p.theirs}% there`)).join(" · ")
                + (aggregateCheck.problems.length > 5 ? ` …and ${aggregateCheck.problems.length - 5} more.` : "")
                + (aggregateCheck.extra.length
                    ? ` Scored by the backend but not seen here: ${aggregateCheck.extra.join(", ")} — usually an activity that could not be read, or a result with no date.`
                    : ""));
        }
        const diverging = recheckIssues.filter((r) => r.diverges);
        if (diverging.length > 0) {
            add("warn", `${diverging.length} SLA(s) do not follow their own scoring rule`,
                diverging.slice(0, 5).map((r) => `${r.slaRef} (${r.method}): ${r.backendLdPercent}% charged`
                    + (r.expectedLdPercent === null ? "" : `, ${r.expectedLdPercent}% under the RFP rule`)).join(" · ")
                + `. The charged figures are left as the backend computed them, because Settlement invoices from the same source. `
                + `Expand an SLA to see the measurement intervals behind it.`);
        }
        if (!alignedQuarterKey && quarterlyItems.length > 0) {
            add("info", "Backend cross-check not run for this quarter",
                `The backend's aggregate is keyed by calendar quarter and this contract quarter spans ${overlaps.length} of them. `
                + `They would be scoring different date ranges, so comparing them would say nothing.`);
        }
        if (aggregateError) {
            add("info", "Backend aggregate could not be read", `${aggregateError}. This period's figures were not cross-checked against it.`);
        }
        if (undated > 0) {
            add("info", `${undated} result(s) have no evaluation date`, "They appear in no period at all, so no quarter counts them.");
        }
        if (awaitingObservation > 0) {
            out.push({
                level: "blocking",
                title: `${awaitingObservation} SLA result(s) are awaiting a manual observation`,
                detail: "The evaluation ran and created these rows, but the SLA is not date-derivable so the backend "
                    + "could not score it. Every resource SLA (005–009) is manual — it reads from the biometric "
                    + "attendance system — so waiting will not resolve them. Until they are entered these score "
                    + "nothing, and this quarter is understated rather than clean.",
                // Rendered as links straight to the activity that needs the input.
                actions: awaiting.activities.map((a) => ({
                    label: `${a.activityCode || a.activityId} — ${a.slaRefs.join(", ")}`,
                    to: `/projects/${encodeURIComponent(projectId)}/activity-slas`
                        + `?activityId=${encodeURIComponent(a.activityId || "")}`
                        + (a.activityCode ? `&activityCode=${encodeURIComponent(a.activityCode)}` : ""),
                })).filter((a) => a.to.includes("activityId=") && !a.to.endsWith("activityId=")),
                hint: "Open the activity, then press Evaluate on the SLA's mapping row.",
            });
        }
        if (mastersIncomplete > 0) {
            add("info", `${mastersIncomplete} SLA(s) have no target table or escalation rule`,
                "Their severity thresholds and per-week rates are not filled in on the SLA Library, so their scoring "
                + "could not be cross-checked against the RFP. The figures shown are the backend's, unverified.");
        }
        return out;
    }, [loadedOnce, classification, mastersError, slaLibraryEmpty, unconfigured, scale.configured,
        ldBands.length, aggregateCheck, alignedQuarterKey, recheckIssues, quarterlyItems.length,
        overlaps.length, aggregateError, undated, mastersIncomplete, awaitingObservation, awaiting.activities, projectId]);

    const blockingCount = issues.filter((i) => i.level === "blocking").length;

    /* A blocking issue means the figures above it cannot be trusted, so the
       panel opens itself rather than waiting to be clicked. Done once per
       load rather than on every render, so a reader who folds it away again
       is not overruled. */
    useEffect(() => {
        if (blockingCount > 0) setShowIssues(true);
    }, [blockingCount, period?.key]);
    /* Carried-forward breaches count as "something to show". A quarter whose
       only content is an open obligation from an earlier quarter is exactly
       the case the empty state would hide — and it is the case §5.28.3.f/g
       exist to catch.

       So does a settled quarter: a clean quarter still has money moving
       through it — AQP = PA + QGR with no deduction — and "no SLA
       evaluations" is not a reason to hide what was paid. */
    const nothingFound = deliverableItems.length === 0
        && quarterlyItems.length === 0
        && carried.length === 0
        && !settlementRow;

    return (
        <div className="uidai-pmis-card" style={{ marginBottom: 0, width: "100%" }}>
            {/* ── header + period pickers ───────────────────────────── */}
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", flexWrap: "wrap", gap: 12 }}>
                <div>
                    <div style={{ fontSize: 16, fontWeight: 800, color: INK }}>SLA Rollup by Quarter</div>
                </div>

                <div style={{ display: "flex", gap: 10, alignItems: "flex-end", flexWrap: "wrap" }}>
                    <div>
                        <div style={{ fontSize: 12, fontWeight: 600, ...muted, marginBottom: 6 }}>Contract year</div>
                        <select
                            className="uidai-pmis-filter-select"
                            value={period?.year ?? ""}
                            disabled={!quarters.length}
                            onChange={(e) => {
                                const y = Number(e.target.value);
                                // Hold the quarter number steady when switching year,
                                // falling back to that year's first quarter.
                                const same = quarters.find((q) => q.year === y && q.quarter === period?.quarter);
                                const first = quarters.find((q) => q.year === y);
                                setSelected((same || first)?.key || null);
                            }}
                        >
                            {years.map((y) => <option key={y} value={y}>Year {y}</option>)}
                        </select>
                    </div>
                    <div>
                        <div style={{ fontSize: 12, fontWeight: 600, ...muted, marginBottom: 6 }}>Quarter</div>
                        <select
                            className="uidai-pmis-filter-select"
                            value={period?.key ?? ""}
                            disabled={!quarters.length}
                            onChange={(e) => setSelected(e.target.value)}
                        >
                            {quarters
                                .filter((q) => q.year === period?.year)
                                .map((q) => <option key={q.key} value={q.key}>Q{q.quarter}</option>)}
                        </select>
                    </div>
                    <button
                        type="button"
                        className="uidai-pmis-btn uidai-pmis-btn-cancel uidai-pmis-btn-small"
                        style={{ marginTop: 0 }}
                        onClick={load}
                        disabled={loading}
                    >
                        {loading ? "Loading…" : "↻ Reload"}
                    </button>
                </div>
            </div>

            {period && <PeriodStrip period={period} contractStart={startDate} />}

            {period && overlaps.length > 1 && (
                <div style={{ fontSize: 12, ...muted, marginTop: 10, lineHeight: 1.7 }}>
                    NPQP is published per calendar quarter, so the payment base is blended across the{" "}
                    {overlaps.length} calendar quarters this contract quarter covers, weighted by days:{" "}
                    {overlaps.map((o, i) => (
                        <React.Fragment key={o.key}>
                            {i > 0 && " + "}
                            <b style={{ color: INK }}>{o.key}</b>
                            {" "}({o.days}d · {Math.round(o.weight * 1000) / 10}%)
                        </React.Fragment>
                    ))}
                    .
                </div>
            )}

            {/* Only assert a missing T0 once the tree has actually answered —
                before that an empty prop means "not loaded", not "not set". */}
            {loadedOnce && !quarters.length && (
                <Banner
                    kind="error"
                    text={
                        "Contract quarters are measured from the project's start date (T0), and this project has none set" +
                        (startDate ? ` — "${startDate}" could not be read as a date.` : ".") +
                        " Set the start date on the project to use this view."
                    }
                />
            )}
            {error && <Banner text={error} kind="error" />}
            {partial && <Banner text={partial} kind="error" />}

            {/* The answer first: how bad, what it cost, what we pay. Everything
                below this card exists to explain these three numbers. */}
            {loadedOnce && !loading && !nothingFound && (
                <>
                    <Headline
                        period={period}
                        breaches={totals.totalBreaches + dTotals.totalBreaches}
                        measured={quarterlyItems.length + deliverableItems.length}
                        awaiting={awaitingObservation}
                        ldPercent={totals.cappedLdPercent}
                        ldAmount={totals.ldAmount}
                        deliverableLd={dTotals.totalLdAmount}
                        finalPayment={statement.tax.net}
                        pending={statement.pending}
                    />
                    <Glossary open={showGlossary} onToggle={() => setShowGlossary((v) => !v)} />
                    {draftCount > 0 && (
                        <div style={{
                            marginTop: 10, borderRadius: 10, padding: "10px 13px",
                            background: "#fffaf0", border: "1px solid #e8d9b0",
                            fontSize: 11.5, lineHeight: 1.6, color: "#334155",
                            display: "flex", alignItems: "flex-start", gap: 10, flexWrap: "wrap",
                        }}>
                            <div style={{ flex: 1, minWidth: 260 }}>
                                <b style={{ color: AMBER }}>
                                    ⚠ {draftCount} figure{draftCount === 1 ? "" : "s"} on this page come from local drafts
                                </b>
                                <div>
                                    Values typed here are stored <b>in this browser only</b> — they are not saved to the
                                    server, nobody else can see them, and clearing your browser data removes them. They
                                    are a stopgap while manual observations have no route to the backend.
                                    Once a quarter is closed on the Settlement page, the server&rsquo;s figures take over
                                    and drafts can no longer affect the payment. Until then the payment statement below
                                    falls back to this page&rsquo;s own total, so it reflects them too &mdash; it is marked
                                    where it does.
                                </div>
                            </div>
                            <button
                                type="button"
                                className="uidai-pmis-btn uidai-pmis-btn-cancel uidai-pmis-btn-small"
                                style={{ marginTop: 0, padding: "3px 10px", fontSize: 11 }}
                                onClick={clearAllDrafts}
                            >
                                Clear this quarter&rsquo;s drafts
                            </button>
                        </div>
                    )}

                </>
            )}

            {/* Every remaining diagnostic, folded into one counted panel.
                Hidden for now at the user's request — the `issues` memo still
                runs, so flipping SHOW_ISSUE_PANEL back to true restores it
                with nothing lost. */}
            {SHOW_ISSUE_PANEL && (
                <IssuePanel issues={issues} open={showIssues} onToggle={() => setShowIssues((v) => !v)} />
            )}

            {/* ── loading / empty / content ─────────────────────────── */}
            {loading ? (
                <div style={{ padding: 30, textAlign: "center", ...muted, fontSize: 13 }}>
                    Reading SLA results…
                    {progress.total > 0 && (
                        <>
                            <div style={{ marginTop: 8, fontSize: 12 }}>
                                {progress.done} of {progress.total} activities
                            </div>
                            <div style={{ margin: "10px auto 0", maxWidth: 280, height: 6, background: "#e8eef7", borderRadius: 999, overflow: "hidden" }}>
                                <div style={{
                                    width: `${Math.round((progress.done / progress.total) * 100)}%`,
                                    height: "100%", background: INK, transition: "width .2s ease",
                                }} />
                            </div>
                        </>
                    )}
                </div>
            ) : (
                <>
                    {nothingFound ? (
                        <div className="uidai-pmis-filter-shell" style={{ marginTop: 16, textAlign: "center", padding: 24 }}>
                            <div style={{ fontSize: 13, ...muted }}>
                                {loadedOnce
                                    ? `No SLA evaluations were recorded between ${period?.start} and ${period?.end}.`
                                    : "Nothing loaded yet."}
                            </div>
                            {loadedOnce && allResults.length > 0 && (
                                <div style={{ fontSize: 12, ...muted, marginTop: 6 }}>
                                    This project has {allResults.length} result{allResults.length === 1 ? "" : "s"} in
                                    other periods — try a different year or quarter.
                                </div>
                            )}
                        </div>
                    ) : (
                        <>
                            {/* ══ Category tabs ════════════════════════════════════
                                One pill per SLA category present this quarter. The
                                two TRACKS below still decide how an SLA is CHARGED —
                                that is the RFP's split and it does not move — but a
                                reader looking for "the resource SLAs" wants the
                                category, and lumping resource deployment in with
                                query resolution because they share a charging base
                                is exactly the confusion this removes. */}
                            <CategoryTabs
                                categories={categories}
                                active={activeCategory}
                                onSelect={setActiveCategory}
                                dotFor={categoryDot}
                            />

                            {/* ══ Quarterly track (§5.28.3 / §5.28.4) ══════════════
                                Resource, recommendation and governance-tool SLAs. All
                                measured and reported quarterly and charged against
                                NPQP, so these — and only these — sum into the §5.27.6
                                quarter ceiling. */}
                            {(activeCategory === ALL_CATEGORIES || visibleQuarterly.length > 0) && (
                            <>
                            <SectionHead
                                title="Quarterly SLAs"
                                count={visibleQuarterly.reduce((n, c) => n + c.items.length, 0)}
                                clause="§5.28.3–4"
                                sub="Charged as a % of the quarter's payment base."
                                onToggle={() => setExpandAll((v) => !v)}
                                toggleLabel={expandAll ? "Collapse all" : "Expand all"}
                                showToggle={quarterlyItems.length > 0 || deliverableItems.length > 0}
                            />

                            {quarterlyItems.length === 0 ? (
                                <div className="uidai-pmis-filter-shell" style={{ marginTop: 10, padding: 16, fontSize: 12.5, ...muted, fontStyle: "italic" }}>
                                    No quarterly SLA evaluations in this period.
                                </div>
                            ) : (
                                <>
                                    {/* These are the TRACK's totals, not the tab's — the
                                        §5.27.6 ceiling applies to every quarterly SLA
                                        together, so a per-category subtotal here would be
                                        a number the RFP never uses. Said out loud only
                                        when a filter is on and the two could be confused. */}
                                    <FilterScopeNote
                                        active={activeCategory !== ALL_CATEGORIES}
                                        text="Totals below cover every quarterly SLA, not just this category — the 10% ceiling applies to them together."
                                    />
                                    <div className="uidai-pmis-grid-4" style={{ gap: 12, marginTop: 12 }}>
                                        <Tile label="SLAs scored" value={num(totals.slaCount, 0)} hint={`${num(totals.totalOccurrences, 0)} occurrences`} />
                                        <Tile label="Breaches" value={num(totals.totalBreaches, 0)} accent={totals.totalBreaches > 0 ? RED : GREEN} />
                                        <Tile label="Points" value={num(totals.totalPoints, 0)} hint="after the SLA cap" />
                                        <Tile
                                            label="Penalty % before cap"
                                            value={pct(totals.sumLdPercent)}
                                            accent={totals.sumLdPercent > 0 ? RED : GREEN}
                                            hint={`${num(totals.contributingCount, 0)} SLA${totals.contributingCount === 1 ? "" : "s"} contributing`}
                                        />
                                        <Tile
                                            label="Penalty % applied"
                                            value={pct(totals.cappedLdPercent)}
                                            accent={RED}
                                            hint={totals.capApplied
                                                ? `capped from ${pct(totals.sumLdPercent)}`
                                                : `ceiling ${totals.quarterCapPercent}%`}
                                        />
                                        <Tile
                                            label="NPQP"
                                            value={money(totals.npqp)}
                                            hint={npqpIssue
                                                || (fCheck.diverges
                                                    ? `⚠ F differs from the deployment plan by ${Math.round(fCheck.percent * 100) / 100}%`
                                                    : npqpBlend.exact
                                                        ? `calendar ${overlaps[0]?.key} · exact`
                                                        : `blended across ${overlaps.map((o) => o.key).join(" + ")}`)}
                                            accent={npqpIssue || fCheck.diverges ? AMBER : undefined}
                                        />
                                        <Tile
                                            label="Penalty amount"
                                            value={money(totals.ldAmount)}
                                            accent={RED}
                                            hint={totals.npqp === null ? "needs an NPQP base" : "capped LD % × NPQP"}
                                        />
                                    </div>
                                    {/* Grouped under their own category rather than run
                                        together: resource deployment and query resolution
                                        are both quarterly and both charged on NPQP, and
                                        that is the only thing they have in common. */}
                                    {visibleQuarterly.map((cat) => (
                                        <React.Fragment key={cat.code}>
                                            <CategoryBlock
                                                cat={cat}
                                                accent={categoryDot(categories.indexOf(cat))}
                                            />
                                            {cat.items.map((it) => (
                                                <SlaGroup
                                                    key={`q:${it.slaRef}:${expandAll}`}
                                                    item={it}
                                                    recheck={rechecks.get(String(it.slaRef))}
                                                    staffing={isResourceDeploymentSla(it) ? staffing : null}
                                                    defaultOpen={expandAll}
                                                    targetRows={mastersByRef.get(String(it.slaRef))?.targetRows}
                                                    onSaveDraft={saveObservationDraft}
                                                    onClearDraft={clearObservationDraft}
                                                />
                                            ))}
                                        </React.Fragment>
                                    ))}
                                    {visibleQuarterly.length === 0 && (
                                        <div className="uidai-pmis-filter-shell" style={{ marginTop: 10, padding: 16, fontSize: 12.5, ...muted, fontStyle: "italic" }}>
                                            No quarterly SLA in this category.
                                        </div>
                                    )}
                                </>
                            )}
                            </>
                            )}

                            {/* ══ NPQP base — the resource deployment plan ═════════
                                Every LD % above is a percentage of NPQP, and
                                NPQP = F + QGR. §5.28.1.d(c) defines F as the aggregate
                                monthly payment of all resources to be deployed as per
                                the resource deployment plan — which is exactly what the
                                activities' allocation rows hold. Summing them gives F
                                independently of the NPQP endpoint, so the base the whole
                                page charges against becomes checkable. */}
                            {(plan.activityCount > 0 || fCheck.comparable) && (
                                <>
                                    <SectionHead
                                        title="The payment base"
                                        count={plan.activityCount}
                                        clause="§5.28.1.d(c)"
                                        sub="What the planned resources cost — the figure the penalty % is applied to."
                                        onToggle={() => setShowPlanDetail((v) => !v)}
                                        toggleLabel={showPlanDetail ? "Hide activities" : "Show activities"}
                                        showToggle={plan.activityCount > 0}
                                        style={{ marginTop: 26 }}
                                    />

                                    <div className="uidai-pmis-grid-4" style={{ gap: 12, marginTop: 12 }}>
                                        <Tile
                                            label="Plan — deployment"
                                            value={money(plan.fAmount)}
                                            hint={`${num(plan.activityCount, 0)} activit${plan.activityCount === 1 ? "y" : "ies"} · `
                                                + `${num(plan.allocationCount, 0)} allocation${plan.allocationCount === 1 ? "" : "s"} · `
                                                + `${num(plan.headcount, 0)} head${plan.headcount === 1 ? "" : "s"}`}
                                        />
                                        <Tile
                                            label="Plan — attendance"
                                            value={money(endpointF)}
                                            hint={endpointF === null
                                                ? "not available"
                                                : "after §5.25.2.b"}
                                            accent={endpointF === null ? AMBER : undefined}
                                        />
                                        <Tile
                                            label="Difference"
                                            value={fCheck.comparable
                                                ? `${fCheck.planHigher ? "+" : "−"}${money(Math.abs(fCheck.difference))}`
                                                : "—"}
                                            accent={fCheck.diverges ? RED : fCheck.comparable ? GREEN : AMBER}
                                            hint={fCheck.comparable
                                                ? `${Math.round(fCheck.percent * 100) / 100}% · tolerance ${fCheck.tolerancePercent}%`
                                                : fCheck.reason}
                                        />
                                        <Tile
                                            label="Designations deployed"
                                            value={num(plan.byDesignation.length, 0)}
                                            hint={plan.unpricedCount > 0
                                                ? `${num(plan.unpricedCount, 0)} allocation(s) unpriced`
                                                : "all allocations priced"}
                                            accent={plan.unpricedCount > 0 ? AMBER : undefined}
                                        />
                                    </div>

                                    {fCheck.diverges && (
                                        <Banner
                                            kind="error"
                                            text={
                                                `The deployment plan and the NPQP endpoint disagree about F for this quarter by `
                                                + `${formatINR(Math.abs(fCheck.difference))} (${Math.round(fCheck.percent * 100) / 100}%). `
                                                + `Every LD amount above is a percentage of NPQP = F + QGR, so this moves all of them.\n`
                                                + (fCheck.planHigher
                                                    ? `The plan is HIGHER. Usually an approved resource that was never onboarded, or unpaid `
                                                      + `leave: §5.25.2.b pays MP = R(1 − L/N), so leave beyond the 6 permissible days per `
                                                      + `quarter reduces the endpoint's F below the plan.`
                                                    : `The endpoint is HIGHER than the plan. That is the unusual direction — the plan may be `
                                                      + `missing allocations, or resources are being paid for outside the deployment plan `
                                                      + `(CCN resources, which §5.28.1.d(c) includes in F, are the common cause).`)
                                            }
                                        />
                                    )}
                                    {plan.unpricedCount > 0 && (
                                        <Banner
                                            kind="error"
                                            text={
                                                `${plan.unpricedCount} allocation(s) in this quarter have no cost — neither a stored `
                                                + `computed cost nor a monthly rate and duration to derive one. They contribute nothing to `
                                                + `F above, so the plan figure is understated. The backend resolves the rate from the `
                                                + `designation rate card when the activity is saved: re-save the activity, or check the `
                                                + `rate card covers its contract year.`
                                            }
                                        />
                                    )}
                                    {plan.spanningCount > 0 && (
                                        <Banner
                                            kind="error"
                                            text={
                                                `${plan.spanningCount} activit${plan.spanningCount === 1 ? "y" : "ies"} `
                                                + `(${plan.spanningRefs.slice(0, 5).join(", ")}${plan.spanningRefs.length > 5 ? ", …" : ""}) `
                                                + `extend outside this contract quarter. An activity is meant to cover a single quarter — `
                                                + `allocation duration is capped at 3 months for that reason — so its whole cost is counted `
                                                + `in every quarter it touches, overstating F in each.`
                                            }
                                        />
                                    )}
                                    {plan.storedMismatchCount > 0 && (
                                        <Banner
                                            kind="error"
                                            text={
                                                `${plan.storedMismatchCount} activit${plan.storedMismatchCount === 1 ? "y" : "ies"} have a `
                                                + `stored resource-cost total that differs from the sum of their own allocation rows. One of `
                                                + `the two was computed before an allocation changed; F above uses the allocation rows.`
                                            }
                                        />
                                    )}
                                    {plan.undatedCount > 0 && (
                                        <div style={{ fontSize: 11.5, ...muted, marginTop: 8 }}>
                                            ◍ {plan.undatedCount} activit{plan.undatedCount === 1 ? "y has" : "ies have"} resource
                                            allocations but no start date, so {plan.undatedCount === 1 ? "it falls" : "they fall"} in
                                            no quarter and {plan.undatedCount === 1 ? "is" : "are"} excluded from F
                                            {plan.undatedRefs.length > 0 && ` (${plan.undatedRefs.slice(0, 5).join(", ")})`}.
                                        </div>
                                    )}

                                    {/* Who is deployed, and what each role costs. */}
                                    {plan.byDesignation.length > 0 && (
                                        <div className="uidai-pmis-table-wrap" style={{ marginTop: 12 }}>
                                            <table className="uidai-pmis-table uidai-pmis-table-compact" style={{ marginTop: 0 }}>
                                                <thead>
                                                    <tr>
                                                        <th>Designation</th>
                                                        <th style={{ textAlign: "right" }}>Heads</th>
                                                        <th style={{ textAlign: "right" }}>Allocations</th>
                                                        <th style={{ textAlign: "right" }}>Activities</th>
                                                        <th style={{ textAlign: "right" }}>Cost this quarter</th>
                                                        <th style={{ textAlign: "right" }}>Share of F</th>
                                                    </tr>
                                                </thead>
                                                <tbody>
                                                    {plan.byDesignation.map((d) => (
                                                        <tr key={d.designation}>
                                                            <td style={{ fontWeight: 700, color: INK, fontSize: 12.5 }}>
                                                                {d.designation}
                                                                {d.unpriced > 0 && (
                                                                    <span
                                                                        style={{ color: AMBER, fontWeight: 700, marginLeft: 6, fontSize: 11 }}
                                                                        title={`${d.unpriced} allocation(s) for this role have no cost and are not in the figures.`}
                                                                    >
                                                                        ⚠ {d.unpriced} unpriced
                                                                    </span>
                                                                )}
                                                            </td>
                                                            <td style={{ textAlign: "right", fontVariantNumeric: "tabular-nums", fontWeight: 700 }}>{num(d.heads, 0)}</td>
                                                            <td style={{ textAlign: "right", fontVariantNumeric: "tabular-nums", ...muted }}>{num(d.allocations, 0)}</td>
                                                            <td style={{ textAlign: "right", fontVariantNumeric: "tabular-nums", ...muted }}>{num(d.activityCount, 0)}</td>
                                                            <td style={{ textAlign: "right", fontVariantNumeric: "tabular-nums", fontWeight: 700, color: INK, whiteSpace: "nowrap" }}>{money(d.cost)}</td>
                                                            <td style={{ textAlign: "right", fontVariantNumeric: "tabular-nums", ...muted }}>
                                                                {plan.fAmount ? `${Math.round((d.cost / plan.fAmount) * 1000) / 10}%` : "—"}
                                                            </td>
                                                        </tr>
                                                    ))}
                                                </tbody>
                                            </table>
                                        </div>
                                    )}

                                    {showPlanDetail && plan.activities.length > 0 && (
                                        <div className="uidai-pmis-table-wrap" style={{ marginTop: 12 }}>
                                            <table className="uidai-pmis-table uidai-pmis-table-compact" style={{ marginTop: 0 }}>
                                                <thead>
                                                    <tr>
                                                        <th>Activity</th>
                                                        <th>Allocations</th>
                                                        <th style={{ textAlign: "right" }}>Cost</th>
                                                    </tr>
                                                </thead>
                                                <tbody>
                                                    {plan.activities.map((a) => (
                                                        <tr key={a.activityId || a.code}>
                                                            <td>
                                                                <div style={{ fontWeight: 700, color: INK, fontSize: 12.5 }}>{a.code}</div>
                                                                <div style={{ fontSize: 11, ...muted }}>
                                                                    {a.name}
                                                                    {a.milestoneName ? ` · ${a.milestoneName}` : ""}
                                                                </div>
                                                            </td>
                                                            <td style={{ fontSize: 11.5 }}>
                                                                {a.allocations.map((al, i) => (
                                                                    <div key={i} style={{ ...muted }}>
                                                                        {al.designation} ×{al.quantity}
                                                                        {al.duration !== null && ` · ${al.duration} mo`}
                                                                        {al.monthlyRate !== null && ` · ${money(al.monthlyRate)}/mo`}
                                                                        {al.cost === null
                                                                            ? <span style={{ color: AMBER, fontWeight: 700 }}> · unpriced</span>
                                                                            : al.derived && <span style={{ color: AMBER }}> · derived</span>}
                                                                    </div>
                                                                ))}
                                                            </td>
                                                            <td style={{ textAlign: "right", fontVariantNumeric: "tabular-nums", fontWeight: 700, color: INK, whiteSpace: "nowrap" }}>
                                                                {money(a.cost)}
                                                                {a.storedDiffers && (
                                                                    <div
                                                                        style={{ fontSize: 10.5, color: AMBER, fontWeight: 700 }}
                                                                        title="The activity's stored resource-cost total disagrees with the sum of its allocation rows."
                                                                    >
                                                                        ⚠ stored: {money(a.storedTotal)}
                                                                    </div>
                                                                )}
                                                            </td>
                                                        </tr>
                                                    ))}
                                                </tbody>
                                            </table>
                                        </div>
                                    )}

                                    <div style={{ fontSize: 11.5, ...muted, marginTop: 8, lineHeight: 1.6 }}>
                                        The two are expected to differ slightly &mdash; attendance applies §5.25.2.b&rsquo;s{" "}
                                        <b>MP = R(1 &minus; L/N)</b> for leave beyond the 6 permissible days. NPQP uses the
                                        attendance figure; the plan is the check on it.
                                    </div>
                                </>
                            )}

                            {/* ══ Staffing — who was actually on the seats ═════════
                                The plan above is what was PROMISED. This is what was
                                DELIVERED, and §5.28.3's Note on SLA 007 turns on the
                                difference: a seat whose replacement UIDAI initiated is
                                outside the calculation until that replacement joins,
                                and a seat empty for part of a month is one head fewer
                                for those days only.

                                Both become the same statement in seat-days, which is
                                what this section counts. It reports; it never rescores
                                — the backend remains the number of record. */}
                            {(occupancy.hasData || replacementsLoading || replacementsError) && (
                                <>
                                    <SectionHead
                                        title="Resource deployment"
                                        count={occupancy.designationCount}
                                        clause="§5.28.3 · SLA 007"
                                        sub="Who was actually on the seats. Vacant days lower the headcount SLA 007 is scored against."
                                        onToggle={() => setShowStaffingDetail((v) => !v)}
                                        toggleLabel={showStaffingDetail ? "Hide designations" : "Show designations"}
                                        showToggle={occupancy.rows.length > 0}
                                        style={{ marginTop: 26 }}
                                    />

                                    {replacementsLoading && !occupancy.hasData && (
                                        <div style={{ fontSize: 12, ...muted, marginTop: 10 }}>Reading staffing history…</div>
                                    )}
                                    {replacementsError && <Banner kind="error" text={replacementsError} />}

                                    {occupancy.hasData && (
                                        <>
                                            <div className="uidai-pmis-grid-4" style={{ gap: 12, marginTop: 12 }}>
                                                <Tile
                                                    label="Seats planned"
                                                    value={num(occupancy.configuredSeats, 0)}
                                                    hint={`${num(occupancy.designationCount, 0)} designation${occupancy.designationCount === 1 ? "" : "s"}`}
                                                />
                                                <Tile
                                                    label="Effective headcount"
                                                    value={sla007.effectiveHeadcountLabel}
                                                    accent={sla007.diverges ? AMBER : GREEN}
                                                    hint={`${Math.round((occupancy.deployedPercent ?? 0) * 10) / 10}% of plan`}
                                                />
                                                <Tile
                                                    label="Vacant seat-days"
                                                    value={num(occupancy.vacantDays, 0)}
                                                    accent={occupancy.vacantDays > 0 ? AMBER : GREEN}
                                                    hint={`of ${num(occupancy.seatDays, 0)} planned`}
                                                />
                                                <Tile
                                                    label="Replacements"
                                                    value={num(occupancy.replacementCount, 0)}
                                                    hint={occupancy.vacantSeats.length > 0
                                                        ? `${num(occupancy.vacantSeats.length, 0)} seat${occupancy.vacantSeats.length === 1 ? "" : "s"} unfilled`
                                                        : "all seats held"}
                                                    accent={occupancy.vacantSeats.length > 0 ? RED : undefined}
                                                />
                                            </div>

                                            {/* Per measurement interval — SLA 007 scores monthly
                                                and the points accumulate, so an average across
                                                the quarter would hide the month that breached. */}
                                            {occupancyIntervals.length > 0 && (
                                                <div style={{
                                                    marginTop: 12, background: "#fbfdff",
                                                    border: "1px solid var(--uidai-pmis-border)",
                                                    borderRadius: 10, padding: "12px 14px",
                                                }}>
                                                    <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: ".5px", textTransform: "uppercase", ...muted, marginBottom: 8 }}>
                                                        By measurement interval
                                                    </div>
                                                    <div style={{ display: "grid", gap: 8 }}>
                                                        {occupancyIntervals.map((b) => (
                                                            <IntervalBar
                                                                key={b.interval.key}
                                                                interval={b.interval}
                                                                occupancy={b}
                                                                configuredSeats={occupancy.configuredSeats}
                                                            />
                                                        ))}
                                                    </div>
                                                </div>
                                            )}

                                            {occupancy.vacantSeats.length > 0 && (
                                                <Banner
                                                    kind="error"
                                                    text={
                                                        `${occupancy.vacantSeats.length} seat(s) had no one on them at any point this quarter: `
                                                        + occupancy.vacantSeats.slice(0, 4)
                                                            .map((s) => `${s.designation} (${s.activityCode || s.activityId})`)
                                                            .join("; ")
                                                        + (occupancy.vacantSeats.length > 4 ? `; …and ${occupancy.vacantSeats.length - 4} more.` : "")
                                                        + `\nUnder SLA 007's Note these are outside the calculation if UIDAI initiated the replacement — confirm before scoring them as under-deployment.`
                                                    }
                                                />
                                            )}

                                            {showStaffingDetail && (
                                                <div className="uidai-pmis-table-wrap" style={{ marginTop: 10 }}>
                                                    <table className="uidai-pmis-table" style={{ minWidth: 720 }}>
                                                        <thead>
                                                            <tr>
                                                                <th>Designation</th>
                                                                <th>Activity</th>
                                                                <th style={{ textAlign: "right" }}>Seats</th>
                                                                <th style={{ textAlign: "right" }}>Held</th>
                                                                <th style={{ textAlign: "right" }}>Vacant days</th>
                                                                <th>Gaps</th>
                                                            </tr>
                                                        </thead>
                                                        <tbody>
                                                            {occupancy.rows.map((r, i) => (
                                                                <tr key={`${r.activityId}:${r.designation}:${i}`}>
                                                                    <td style={{ fontWeight: 700, color: INK }}>{r.designation}</td>
                                                                    <td style={{ fontSize: 11.5, ...muted }}>{r.activityCode || "—"}</td>
                                                                    <td style={{ textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{num(r.configured, 0)}</td>
                                                                    <td style={{
                                                                        textAlign: "right", fontVariantNumeric: "tabular-nums", fontWeight: 700,
                                                                        color: r.fullyVacant ? RED : r.vacantDays > 0 ? AMBER : GREEN,
                                                                    }}>
                                                                        {num(Math.round(r.effectiveHeadcount * 100) / 100)}
                                                                    </td>
                                                                    <td style={{ textAlign: "right", fontVariantNumeric: "tabular-nums", color: r.vacantDays > 0 ? AMBER : undefined }}>
                                                                        {num(r.vacantDays, 0)}
                                                                    </td>
                                                                    <td style={{ fontSize: 11.5, ...muted }}>
                                                                        {r.fullyVacant
                                                                            ? <span style={{ color: RED, fontWeight: 700 }}>never filled</span>
                                                                            : r.gaps.length === 0
                                                                                ? "—"
                                                                                : r.gaps.slice(0, 3).map((g) => (
                                                                                    <div key={g.start}>
                                                                                        {longDate(g.start)} → {longDate(g.end)}
                                                                                        {" "}({g.days}d{g.short > 1 ? ` · ${g.short} short` : ""})
                                                                                    </div>
                                                                                ))}
                                                                        {!r.fullyVacant && r.gaps.length > 3 && (
                                                                            <div>…and {r.gaps.length - 3} more</div>
                                                                        )}
                                                                    </td>
                                                                </tr>
                                                            ))}
                                                        </tbody>
                                                    </table>
                                                </div>
                                            )}

                                            <div style={{ fontSize: 11.5, ...muted, marginTop: 8, lineHeight: 1.6 }}>
                                                Counted in seat-days: a seat empty 10 days of 30 is a third of a head, not a
                                                whole one. Reported only &mdash; SLA 007 is still scored by the backend.
                                            </div>
                                        </>
                                    )}
                                </>
                            )}

                            {/* ══ Carried forward (§5.28.3.f, §5.28.3.g) ═══════════
                                "Severity level 4 applicable for every quarter thereafter
                                till the actual date of onboarding" / "Severity Level 2
                                applicable for every quarter till replacement(s) is/are
                                on-boarded". A breach that opened earlier and was never
                                resolved keeps scoring — but a result only exists when
                                something is evaluated, so an open obligation with no
                                evaluation this quarter leaves no trace at all.

                                Listed, never added. Adding points the backend did not
                                emit would make this page disagree with the invoice. */}
                            {carried.length > 0 && (
                                <>
                                    <SectionHead
                                        title="Carried forward"
                                        count={carried.length}
                                        clause="§5.28.3.f–g"
                                        sub="Still-open breaches from earlier quarters. They keep scoring until fixed — shown for information, not counted above."
                                        style={{ marginTop: 26 }}
                                    />
                                    <div className="uidai-pmis-table-wrap" style={{ marginTop: 12 }}>
                                        <table className="uidai-pmis-table uidai-pmis-table-compact" style={{ marginTop: 0 }}>
                                            <thead>
                                                <tr>
                                                    <th>SLA</th>
                                                    <th>Activity</th>
                                                    <th>Breached on</th>
                                                    <th style={{ textAlign: "right" }}>Quarters open</th>
                                                    <th style={{ textAlign: "right" }}>Severity it would carry</th>
                                                    <th style={{ textAlign: "right" }}>Points</th>
                                                </tr>
                                            </thead>
                                            <tbody>
                                                {carried.map((c, i) => {
                                                    const pts = c.severity === null
                                                        ? null
                                                        : scale.points.get(c.severity);
                                                    return (
                                                        <tr key={`${c.slaRef}-${c.activityId}-${i}`}>
                                                            <td>
                                                                <div style={{ fontFamily: "monospace", fontSize: 12.5, fontWeight: 800, color: INK }}>
                                                                    {c.slaRef}
                                                                </div>
                                                                {c.slaTitle && (
                                                                    <div style={{ fontSize: 11, ...muted }}>{c.slaTitle}</div>
                                                                )}
                                                            </td>
                                                            <td>
                                                                <div style={{ fontSize: 12.5, fontWeight: 700, color: INK }}>{c.activityCode || "—"}</div>
                                                                <div style={{ fontSize: 11, ...muted }}>{c.activityName || ""}</div>
                                                            </td>
                                                            <td style={{ fontSize: 12, ...muted, whiteSpace: "nowrap" }}>{c.openedOn || "—"}</td>
                                                            <td style={{ textAlign: "right", fontVariantNumeric: "tabular-nums", fontWeight: 700 }}>
                                                                {c.quartersOpen ?? "—"}
                                                            </td>
                                                            <td style={{ textAlign: "right", fontVariantNumeric: "tabular-nums", fontWeight: 800, color: severityAccent(c.severity) }}>
                                                                {c.severity === null ? (
                                                                    <span
                                                                        style={{ color: AMBER, fontWeight: 700 }}
                                                                        title={c.hasTargetTable
                                                                            ? "The SLA's target table has no unbounded row, so there is no severity for an indefinitely-open breach."
                                                                            : "This SLA has no target table on the SLA Library, so the severity it would carry cannot be derived."}
                                                                    >
                                                                        unknown
                                                                    </span>
                                                                ) : c.severity}
                                                            </td>
                                                            <td style={{ textAlign: "right", fontVariantNumeric: "tabular-nums", ...muted }}>
                                                                {Number.isFinite(pts) ? num(pts, 0) : "—"}
                                                            </td>
                                                        </tr>
                                                    );
                                                })}
                                            </tbody>
                                        </table>
                                    </div>
                                    <div style={{ fontSize: 11.5, ...muted, marginTop: 8, lineHeight: 1.6 }}>
                                        These breaches were last evaluated as <b>breached</b> before {period?.start} and have
                                        no evaluation inside this quarter. The severity shown is the one the SLA&rsquo;s own
                                        target table assigns to an unbounded value — the RFP&rsquo;s &ldquo;every quarter
                                        thereafter till&hellip;&rdquo;. Nothing here is added to the points or LD % above:
                                        the backend emits no result for them, and inventing one would make this page
                                        disagree with what Settlement invoices. Re-evaluate the activity to have them
                                        scored properly.
                                    </div>
                                </>
                            )}

                            {/* ══ Deliverable track (§5.28.2) ══════════════════════
                                SLA 001/002 fire on a deliverable's completion and are
                                charged on that deliverable's cost, so they are totalled
                                in rupees and kept out of the NPQP ceiling entirely. */}
                            {(activeCategory === ALL_CATEGORIES || visibleDeliverable.length > 0) && (
                            <>
                            <SectionHead
                                title="Deliverable-linked SLAs"
                                count={visibleDeliverable.reduce((n, c) => n + c.items.length, 0)}
                                clause="§5.28.2"
                                sub="Charged on the deliverable's own cost — no quarter ceiling."
                                style={{ marginTop: 26 }}
                            />

                            {deliverableItems.length === 0 ? (
                                <div className="uidai-pmis-filter-shell" style={{ marginTop: 10, padding: 16, fontSize: 12.5, ...muted, lineHeight: 1.6 }}>
                                    <div style={{ fontStyle: "italic" }}>
                                        No deliverable-linked SLA evaluations in this period.
                                    </div>
                                    <div style={{ marginTop: 6 }}>
                                        This section only fills when an evaluated SLA is charged on a
                                        deliverable&rsquo;s own cost — i.e. its <b>Applied On</b> is{" "}
                                        <code style={{ background: "#eef3fb", padding: "1px 5px", borderRadius: 4 }}>FIXED_AMOUNT</code>{" "}
                                        or its category is{" "}
                                        <code style={{ background: "#eef3fb", padding: "1px 5px", borderRadius: 4 }}>DELIVERABLE_SUBMISSION</code>{" "}
                                        (the RFP&rsquo;s SLA 001 / 002). {classification.total > 0
                                            ? `All ${classification.total} SLA(s) evaluated in this period resolved to the quarterly track.`
                                            : ""}
                                    </div>
                                </div>
                            ) : (
                                <>
                                    <FilterScopeNote
                                        active={activeCategory !== ALL_CATEGORIES}
                                        text="Totals below cover every deliverable-linked SLA, not just this category."
                                    />
                                    <div className="uidai-pmis-grid-4" style={{ gap: 12, marginTop: 12 }}>
                                        <Tile label="SLAs triggered" value={num(dTotals.slaCount, 0)} hint={`${num(dTotals.totalOccurrences, 0)} occurrences`} />
                                        <Tile label="Deliverables hit" value={num(dTotals.affectedActivities, 0)} accent={dTotals.affectedActivities > 0 ? RED : GREEN} />
                                        <Tile label="Breaches" value={num(dTotals.totalBreaches, 0)} accent={dTotals.totalBreaches > 0 ? RED : GREEN} />
                                        <Tile
                                            label="Penalty amount"
                                            value={money(dTotals.totalLdAmount)}
                                            accent={RED}
                                            hint={dTotals.unpricedCount > 0
                                                ? `${dTotals.unpricedCount} occurrence(s) still unpriced`
                                                : "sum of per-deliverable LD"}
                                        />
                                    </div>
                                    {visibleDeliverable.map((cat) => (
                                        <React.Fragment key={cat.code}>
                                            <CategoryBlock
                                                cat={cat}
                                                accent={categoryDot(categories.indexOf(cat))}
                                            />
                                            {cat.items.map((it) => (
                                                <SlaGroup
                                                    key={`d:${it.slaRef}:${expandAll}`}
                                                    item={it}
                                                    recheck={rechecks.get(String(it.slaRef))}
                                                    defaultOpen={expandAll}
                                                    targetRows={mastersByRef.get(String(it.slaRef))?.targetRows}
                                                    onSaveDraft={saveObservationDraft}
                                                    onClearDraft={clearObservationDraft}
                                                />
                                            ))}
                                        </React.Fragment>
                                    ))}
                                    {visibleDeliverable.length === 0 && (
                                        <div className="uidai-pmis-filter-shell" style={{ marginTop: 10, padding: 16, fontSize: 12.5, ...muted, fontStyle: "italic" }}>
                                            No deliverable-linked SLA in this category.
                                        </div>
                                    )}
                                </>
                            )}
                            </>
                            )}

                            {/* ── deliverable payment → LD → net payable ────
                                The section above answers "what did each SLA do".
                                This one answers the finance question underneath it:
                                per deliverable, what was scheduled, what the SLAs
                                took off it, and what is left to pay. */}
                            {/* Never gated on there being ROWS — a section that
                                vanishes when it is empty is indistinguishable from
                                one that was never built, and the empty state is
                                where the reason lives. It is gated on the tab,
                                because this table IS the deliverable categories'
                                detail view and has nothing to say under Resource. */}
                            {(activeCategory === ALL_CATEGORIES || visibleDeliverable.length > 0) && (
                            <>
                                    <SectionHead
                                        title="Deliverable payment"
                                        count={payables.rows.length}
                                        clause="§5.28.2"
                                        sub="What each deliverable was due, less penalties."
                                        style={{ marginTop: 26 }}
                                    />

                                    {deliverableItems.length === 0 ? (
                                        <div className="uidai-pmis-filter-shell" style={{ marginTop: 10, padding: 16, fontSize: 12.5, ...muted, lineHeight: 1.6 }}>
                                            Nothing to net off yet — no deliverable-linked SLA was evaluated in this
                                            period, so no payment has an LD against it. This table fills from the
                                            section above.
                                        </div>
                                    ) : financeDenied ? (
                                        <div className="uidai-pmis-filter-shell" style={{ marginTop: 10, padding: 16, fontSize: 12.5, ...muted, lineHeight: 1.6 }}>
                                            You do not have access to this project&rsquo;s finance page, so the payment
                                            and net-payable figures cannot be shown. The SLA results above are complete
                                            and unaffected.
                                        </div>
                                    ) : financeError ? (
                                        <Banner text={`Payment page could not be read — ${financeError}. Payment and net payable are unavailable for this period.`} kind="error" />
                                    ) : payables.rows.length === 0 ? (
                                        <div className="uidai-pmis-filter-shell" style={{ marginTop: 10, padding: 16, fontSize: 12.5, ...muted, lineHeight: 1.6 }}>
                                            None of this period&rsquo;s deliverable SLA evaluations could be matched to a
                                            payment term. An activity needs to sit on a milestone that has a payment term
                                            for its LD to be deductible from anything.
                                        </div>
                                    ) : (
                                        <>
                                            <div className="uidai-pmis-grid-4" style={{ gap: 12, marginTop: 12 }}>
                                                <Tile label="Deliverables" value={num(payables.totals.deliverableCount, 0)} hint="with an SLA this period" />
                                                <Tile label="Deliverable cost" value={money(payables.totals.totalPayment)} hint="per §5.23.1" />
                                                <Tile label="LD deducted" value={money(payables.totals.totalLdAmount)} accent={RED} hint="uncapped · §5.28.2" />
                                                <Tile label="Net payable" value={money(payables.totals.totalNetPayable)} accent={GREEN} hint="cost − LD" />
                                            </div>

                                            <div className="uidai-pmis-table-wrap" style={{ marginTop: 12, overflowX: "auto" }}>
                                                <table className="uidai-pmis-table uidai-pmis-table-compact" style={{ minWidth: 940, marginTop: 0 }}>
                                                    <thead>
                                                        <tr>
                                                            <th>Deliverable</th>
                                                            <th>SLAs applied</th>
                                                            <th style={{ textAlign: "right" }}>Deliverable cost</th>
                                                            <th style={{ textAlign: "right" }}>LD %</th>
                                                            <th style={{ textAlign: "right" }}>LD amount</th>
                                                            <th style={{ textAlign: "right" }}>Net payable</th>
                                                        </tr>
                                                    </thead>
                                                    <tbody>
                                                        {payables.rows.map((row) => (
                                                            <PayableRow
                                                                key={row.milestoneId}
                                                                row={row}
                                                                open={openPayables.has(row.milestoneId)}
                                                                onToggle={() => togglePayable(row.milestoneId)}
                                                            />
                                                        ))}
                                                    </tbody>
                                                </table>
                                            </div>

                                        </>
                                    )}
                            </>
                            )}

                            {/* ══ Across the contract (§5.26.2) ════════════════════ */}
                            {cumulative.quarterCount > 0 && (
                                <>
                                    <SectionHead
                                        title="Paid so far across the contract"
                                        count={cumulative.quarterCount}
                                        clause="§5.26.2"
                                        style={{ marginTop: 26 }}
                                    />
                                    <div className="uidai-pmis-grid-4" style={{ gap: 12, marginTop: 12 }}>
                                        <Tile
                                            label="Total paid so far"
                                            value={money(cumulative.totalAqp)}
                                            hint={`${num(cumulative.pricedCount, 0)} of ${num(cumulative.quarterCount, 0)} quarters priced`}
                                            accent={GREEN}
                                        />
                                        <Tile
                                            label="Of which invoiced"
                                            value={money(cumulative.invoicedAqp)}
                                            hint={`${num(cumulative.invoicedCount, 0)} invoiced · ${money(cumulative.provisionalAqp)} still provisional`}
                                        />
                                        <Tile label="Total penalties deducted" value={money(cumulative.totalLd)} accent={RED} />
                                        <Tile
                                            label={`Ceiling — ${ceiling.multiplier ?? 1.25}× contract value`}
                                            value={money(ceiling.ceiling)}
                                            hint={ceiling.known
                                                ? (ceiling.usedPercent === null
                                                    ? "nothing settled yet"
                                                    : `${Math.round(ceiling.usedPercent * 10) / 10}% used · ${money(ceiling.remaining)} left`)
                                                : ceiling.reason}
                                            accent={ceiling.exceeded ? RED : ceiling.intoCcn ? AMBER : undefined}
                                        />
                                    </div>
                                    {ceiling.exceeded && (
                                        <Banner
                                            kind="error"
                                            text={
                                                `Settled payments (${formatINR(ceiling.paid)}) have passed §5.26.2's ceiling of `
                                                + `${formatINR(ceiling.ceiling)} — ${ceiling.multiplier}× the contract value of `
                                                + `${formatINR(ceiling.contractValue)}. No further payment is permitted under the contract `
                                                + `without a variation.`
                                            }
                                        />
                                    )}
                                    {ceiling.intoCcn && (
                                        <div style={{ fontSize: 11.5, color: AMBER, marginTop: 8, fontWeight: 600, lineHeight: 1.6 }}>
                                            ⚠ Settled payments have passed the base contract value ({money(ceiling.contractValue)})
                                            and are now drawing on the 25% CCN headroom. Permitted by §5.26.2, but the headroom is
                                            finite — {money(ceiling.remaining)} remains.
                                        </div>
                                    )}
                                    {cumulative.unpricedCount > 0 && (
                                        <div style={{ fontSize: 11.5, ...muted, marginTop: 8 }}>
                                            ◍ {cumulative.unpricedCount} settled quarter(s) carry no AQP and are not in the total above.
                                        </div>
                                    )}
                                </>
                            )}
                            {settlementsError && (
                                <div style={{ fontSize: 11.5, ...muted, marginTop: 10 }}>
                                    ◍ Settlement history could not be read ({settlementsError}), so PA, AQP and the
                                    paid-to-date total are unavailable.
                                </div>
                            )}

                            {/* ══ §5.27.6 when both regimes charge at once ═════════
                                The ceiling is applied to the quarterly track alone, on
                                the reasoning that Phase 1 has no NPQP for a 10% of it to
                                bite on. That holds only while the phases do not overlap
                                — which is exactly what a quarter charging on both tracks
                                means. Reported rather than resolved: which reading
                                applies is a contract question, not a code one. */}
                            {combinedCap.bothTracksCharged && (
                                <div style={{
                                    marginTop: 20,
                                    background: combinedCap.exceedsIfCombined ? "#fdf4f2" : "#fffaf0",
                                    border: `1px solid ${combinedCap.exceedsIfCombined ? "#f0c9c2" : "#f0dfc0"}`,
                                    borderRadius: 10, padding: "12px 15px", fontSize: 12,
                                    color: "#334155", lineHeight: 1.7,
                                }}>
                                    <b style={{ color: combinedCap.exceedsIfCombined ? RED : AMBER }}>
                                        {combinedCap.exceedsIfCombined ? "⚠ " : "◍ "}
                                        Both LD regimes charged this quarter — §5.27.6&rsquo;s ceiling is ambiguous here.
                                    </b>
                                    <br />
                                    Quarterly track <b style={{ color: INK }}>{money(combinedCap.quarterlyLd)}</b>
                                    {" "}+ deliverable track <b style={{ color: INK }}>{money(combinedCap.deliverableLd)}</b>
                                    {" "}= <b style={{ color: INK }}>{money(combinedCap.combined)}</b>.
                                    {combinedCap.ceiling !== null ? (
                                        <>
                                            {" "}§5.27.6&rsquo;s {combinedCap.capPercent}% of NPQP is{" "}
                                            <b style={{ color: INK }}>{money(combinedCap.ceiling)}</b>.
                                        </>
                                    ) : (
                                        <> No NPQP base is available, so the ceiling cannot be valued.</>
                                    )}
                                    <br />
                                    The figures above apply the ceiling to the <b>quarterly track only</b> — §5.28.2 states
                                    no ceiling, and §5.27.6&rsquo;s 10% is 10% of NPQP, which Phase 1 (D1&ndash;D8) does not
                                    have. That reasoning assumes the phases do not overlap. They do in this quarter.
                                    {combinedCap.exceedsIfCombined && (
                                        <>
                                            {" "}Read literally &mdash; &ldquo;the cumulative liquidated damages for each
                                            quarter shall under no circumstances exceed 10% of the NPQP&rdquo; &mdash; the
                                            combined total is over by{" "}
                                            <b style={{ color: RED }}>{money(combinedCap.excess)}</b>.
                                        </>
                                    )}
                                    {" "}Worth settling with the contract owner before this quarter is invoiced.
                                </div>
                            )}

                            {/* ── how every number on this page is calculated ──
                                The formulas, with this project's own configured
                                values folded in rather than the RFP's defaults. */}
                            <div style={{
                                marginTop: 20, background: "#f0f6ff", border: "1px solid #c8d6ee",
                                borderRadius: 10, padding: "12px 15px", color: "#334155",
                            }}>
                                <button
                                    type="button"
                                    onClick={() => setShowFormulas((v) => !v)}
                                    aria-expanded={showFormulas}
                                    style={{
                                        display: "flex", alignItems: "center", gap: 8, width: "100%",
                                        border: "none", background: "transparent", padding: 0, cursor: "pointer",
                                        font: "inherit", textAlign: "left",
                                    }}
                                >
                                    <span style={{ ...muted, fontSize: 11, transition: "transform .15s ease", transform: showFormulas ? "rotate(90deg)" : "none" }}>▶</span>
                                    <b style={{ color: INK, fontSize: 13 }}>How every number on this page is calculated</b>
                                    <span style={{ fontSize: 11.5, ...muted, marginLeft: "auto" }}>
                                        {showFormulas ? "Hide" : "Show"} formulas
                                    </span>
                                </button>

                                {showFormulas && (
                                    <>
                                        <div style={{ fontSize: 11.5, ...muted, marginTop: 8, lineHeight: 1.6 }}>
                                            Two regimes, never added together. Values are{" "}
                                            <b style={{ color: INK }}>this project&rsquo;s configuration</b>, not the RFP defaults.
                                        </div>

                                        {/* ── 1 · scoring ─────────────────────────── */}
                                        <FormulaTable
                                            title="1 · Scoring one SLA — quarterly track"
                                            subtitle="§5.28.3–4"
                                        >
                                            <FormulaRow
                                                step="Aggregate"
                                                formula="one figure per interval, across all resources in scope"
                                                clause="§5.28.1.b"
                                                when="each measurement interval"
                                                note="All resources combine into a single measurement — not one score per resource."
                                            />
                                            <FormulaRow
                                                step="① SLA Cap"
                                                formula={`severity = min(severity, ${scale.capLevel ?? "?"})`}
                                                clause="§5.28.1.b"
                                                when="each measurement interval"
                                                note={scale.capLevel === null
                                                    ? "No severity master configured for this project, so no cap level is known."
                                                    : "Capped before points are derived — that is the whole purpose of the cap."}
                                            />
                                            <FormulaRow
                                                step="Points"
                                                formula={scale.rows.length
                                                    ? scale.rows.map((r) => `L${r.level}→${r.points}`).join("  ")
                                                    : "not configured"}
                                                clause="§5.28.1.a"
                                                when="each measurement interval"
                                                note={scale.rows.some((r) => r.points < 0)
                                                    ? "A clean interval scores negative points, pulling the quarter's total down."
                                                    : null}
                                            />
                                            <FormulaRow
                                                step="Accumulate"
                                                formula="points = Σ points over every measurement interval"
                                                clause="§5.28.1.a"
                                                when="reporting interval"
                                                note="Summed, never averaged. M1 + M2 + M3 for a monthly SLA over a quarter."
                                            />
                                            <FormulaRow
                                                step="LD band"
                                                formula={ldBands.length
                                                    ? [...ldBands].sort((a, b) => b.points_threshold - a.points_threshold)
                                                        .map((b) => `≥${b.points_threshold}→${b.ld_percent}%`).join("  ")
                                                    : "not configured"}
                                                clause="§5.28.1.c"
                                                when="reporting interval"
                                            />
                                            <FormulaRow
                                                step="② Per-SLA cap"
                                                formula={`LD % ≤ ${topBand === null ? "?" : `${topBand}%`}  (the top band)`}
                                                clause="§5.28.1.b"
                                                when="reporting interval"
                                                note="The band table IS the ceiling — points past the top threshold earn nothing further."
                                            />
                                            <FormulaRow
                                                step="Reset"
                                                formula="points → 0"
                                                clause="§5.28.1.c"
                                                when="end of reporting interval"
                                            />
                                        </FormulaTable>

                                        {/* ── 2 · the quarter's money ─────────────── */}
                                        <FormulaTable
                                            title="2 · The quarter's money"
                                            subtitle="§5.28.1.d"
                                        >
                                            <FormulaRow step="MP" formula="R × (1 − L / N)" clause="§5.25.2.b" when="per resource, per month"
                                                note="L = leave beyond the 6 permissible days per quarter; N = calendar days in that month." />
                                            <FormulaRow step="PA" formula="Σ AMP over the quarter's 3 months" clause="§5.25.2.h" when="quarter"
                                                note="Payable on ACTUAL deployment. Resolved from attendance when the quarter is closed." />
                                            <FormulaRow step="F" formula="Σ monthly cost of resources in the deployment plan + CCN" clause="§5.28.1.d(c)" when="quarter" />
                                            <FormulaRow step="QGR" formula="35% of (Phase-1 fixed + one-time) ÷ Phase 2&3 quarters" clause="§5.23.2" when="quarter"
                                                note="Guaranteed regardless of deployment." />
                                            <FormulaRow step="NPQP" formula="F + QGR" clause="§5.28.1.d(e)" when="quarter"
                                                note="The LD base. QGR is inside it, so LD is charged on QGR too." />
                                            <FormulaRow step="Σ LD %" formula="sum of every quarterly SLA's LD %" clause="§5.28.1.d(f)" when="quarter" />
                                            <FormulaRow
                                                step="③ Quarter cap"
                                                formula={`LD % = min(Σ LD %, ${totals.quarterCapPercent}%)`}
                                                clause="§5.27.6"
                                                when="quarter"
                                                note="Caps the TOTAL, never the individual SLAs — so the per-SLA figures above stay as scored."
                                            />
                                            <FormulaRow step="LD ₹" formula="capped LD % × NPQP" clause="§5.28.1.d(f)" when="quarter" />
                                            <FormulaRow step="AQP" formula="(PA − LD ₹) + QGR" clause="§5.28.1.d(h)" when="quarter"
                                                note="QGR is added back after the deduction because §5.23.2 guarantees it." />
                                            <FormulaRow
                                                step="Effective rate"
                                                formula="LD ₹ ÷ PA × 100"
                                                clause="—"
                                                when="quarter"
                                                note="Not an RFP term. Charged on planned, paid from actual — so when PA is below F the real bite exceeds the headline %."
                                            />
                                            <FormulaRow step="On the invoice" formula="X + 18%·X − 10%·X = 1.08·X" clause="§5.28.1.e" when="each invoice"
                                                note="GST added, TDS withheld, both on the invoice value. Applied after the LD deduction — §5.27.6 makes LD and NPQP tax-exclusive." />
                                            <FormulaRow step="④ Contract ceiling" formula="Σ all payments ≤ 1.25 × contract value" clause="§5.26.2" when="whole contract"
                                                note="Contract value plus 25% CCN headroom." />
                                        </FormulaTable>

                                        {/* ── 3 · deliverable track ───────────────── */}
                                        <FormulaTable
                                            title="3 · Deliverable-linked SLAs"
                                            subtitle="§5.28.2 — no severity, no points, no ceiling"
                                        >
                                            <FormulaRow step="SLA 001" formula="0.5% × ⌈days / 7⌉ × that deliverable's cost" clause="§5.28.2.b" when="per deliverable"
                                                note="Non-submission. “Each week OR PART THEREOF” — the weeks round UP." />
                                            <FormulaRow step="SLA 002" formula="1% × ⌈days / 7⌉ × that deliverable's cost" clause="§5.28.2.c" when="per deliverable"
                                                note="Not accepted / defects not rectified." />
                                            <FormulaRow step="Net payable" formula="deliverable cost − LD ₹" clause="§5.25.1.b" when="per deliverable" />
                                            <FormulaRow step="Cap" formula="none" clause="§5.28.2" when="—"
                                                note="§5.28.2 states no ceiling; §5.27.6's 10% is 10% of NPQP, which Phase 1 does not have (F starts at D9, QGR at Phase 2). Net payable can go negative and is shown as calculated." />
                                            <FormulaRow step="Not applicable" formula="resource-based SLAs do not apply in Phase 1" clause="§5.28.2.a" when="—" />
                                        </FormulaTable>

                                        <div style={{ fontSize: 11, ...muted, marginTop: 14, lineHeight: 1.6 }}>
                                            <b style={{ color: INK }}>Where the four caps fire:</b>{" "}
                                            ① severity, at each measurement interval · ② one SLA&rsquo;s LD %, at each reporting
                                            interval · ③ the quarter&rsquo;s total LD, once · ④ cumulative payments, across the
                                            contract. Because ② holds any single SLA to {topBand === null ? "the top band" : `${topBand}%`},
                                            at least {topBand ? Math.ceil(totals.quarterCapPercent / topBand) : "three"} SLAs must be
                                            maxed out before ③ can engage at all.
                                        </div>
                                    </>
                                )}

                                {undated > 0 && (
                                    <div style={{ color: AMBER, fontSize: 11.5, marginTop: 10 }}>
                                        {undated} result{undated === 1 ? " has" : "s have"} no evaluation date and so
                                        appear in no period.
                                    </div>
                                )}
                            </div>

                            {/* ══ PAYMENT STATEMENT ════════════════════════════════
                                The conclusion of the page, and the only part of it
                                anyone takes to a finance meeting. Everything above is
                                evidence FOR this; it is not another SLA section, and
                                styling it like one made it read as an appendix to the
                                deliverable list it happened to sit under.

                                So it is deliberately built as a separate document:
                                its own rule above it, a dark masthead carrying the two
                                figures that matter, and lettered sections with real
                                headers instead of bold rows inside one long table. */}
                            <div style={{
                                marginTop: 34, borderTop: "3px solid #dbe6f5", paddingTop: 22,
                            }}>
                                <div style={{
                                    borderRadius: 14, overflow: "hidden",
                                    border: "1px solid #c8d6ee",
                                    boxShadow: "0 2px 14px rgba(23,62,119,.10)",
                                    background: "#fff",
                                }}>
                                    {/* ── masthead ─────────────────────────────── */}
                                    <div style={{
                                        background: `linear-gradient(135deg, ${INK} 0%, #0f2f5c 100%)`,
                                        color: "#fff", padding: "16px 20px 18px",
                                    }}>
                                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12, flexWrap: "wrap" }}>
                                            <div>
                                                <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: "1.2px", textTransform: "uppercase", opacity: .65 }}>
                                                    Final · what gets paid
                                                </div>
                                                <div style={{ fontSize: 19, fontWeight: 800, marginTop: 3, letterSpacing: "-.2px" }}>
                                                    Payment statement
                                                </div>
                                                <div style={{ fontSize: 11.5, opacity: .8, marginTop: 3 }}>
                                                    {period?.label || "this quarter"}
                                                    {period && ` · ${longDate(period.start)} → ${longDate(period.end)}`}
                                                </div>
                                            </div>
                                            <div style={{ textAlign: "right" }}>
                                                <span style={{
                                                    border: "1px solid rgba(255,255,255,.35)", borderRadius: 999,
                                                    padding: "3px 11px", fontSize: 11, fontWeight: 700,
                                                    background: "rgba(255,255,255,.10)", whiteSpace: "nowrap",
                                                }}>
                                                    {settlementRow ? (settlementRow.status || "closed").replace(/_/g, " ") : "not settled"}
                                                </span>
                                                {/* Which row those figures came from, and over what
                                                    dates — so a mismatch is visible in the masthead
                                                    rather than only in the banner below. */}
                                                {settlementWindow.known && (
                                                    <div style={{
                                                        fontSize: 10, marginTop: 5, whiteSpace: "nowrap",
                                                        color: settlementWindow.matches ? "rgba(255,255,255,.6)" : "#ffb3a7",
                                                        fontWeight: settlementWindow.matches ? 400 : 700,
                                                    }}>
                                                        {settlementWindow.matches ? "" : "⚠ "}
                                                        {settlementWindow.key || "settlement"}{" "}
                                                        {longDate(settlementWindow.rowStart)} → {longDate(settlementWindow.rowEnd)}
                                                    </div>
                                                )}
                                            </div>
                                        </div>

                                        {/* The two figures the statement exists to produce,
                                            lifted out of the table so they are readable
                                            without following the arithmetic first. */}
                                        <div style={{
                                            display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))",
                                            gap: 18, marginTop: 16, paddingTop: 14,
                                            borderTop: "1px solid rgba(255,255,255,.18)",
                                        }}>
                                            <StatementHero
                                                caption="Due this quarter"
                                                value={statement.grossDue === null ? "—" : money(statement.grossDue)}
                                                note="before tax · A + B"
                                            />
                                            <StatementHero
                                                caption="Net paid to consultant"
                                                value={money(statement.tax.net)}
                                                note={`after ${statement.tax.gstPercent}% GST and ${statement.tax.tdsPercent}% TDS`}
                                                strong
                                            />
                                            <StatementHero
                                                caption="Penalty deducted"
                                                value={statement.totalLd > 0 ? money(statement.totalLd) : "None"}
                                                note={statement.totalLd > 0 ? "both regimes combined" : "no SLA charged this quarter"}
                                                tone={statement.totalLd > 0 ? "#ffb3a7" : "#a8e6c1"}
                                            />
                                        </div>
                                    </div>

                                    {/* ── body ─────────────────────────────────── */}
                                    <div style={{ padding: "4px 20px 18px" }}>
                                {/* The settlement row describes a window of its
                                    own, and it is a CALENDAR quarter. When that
                                    is not this contract quarter, every figure
                                    drawn from the row — PA, AQP, the settled LD —
                                    belongs to different dates than the SLA
                                    figures above. Said plainly, because the
                                    failure is otherwise invisible: the numbers
                                    all look reasonable. */}
                                {settlementWindow.known && !settlementWindow.matches && (
                                    <Banner
                                        kind="error"
                                        text={
                                            `The settled figures below come from ${settlementWindow.key || "a settlement row"} `
                                            + `(${longDate(settlementWindow.rowStart)} → ${longDate(settlementWindow.rowEnd)}), `
                                            + `which is not this contract quarter (${longDate(period.start)} → ${longDate(period.end)}). `
                                            + `The two windows share ${settlementWindow.overlapDays} of ${settlementWindow.periodDays} days`
                                            + `${settlementWindow.overlapPercent === null ? "" : ` (${settlementWindow.overlapPercent}%)`}.\n`
                                            + `PA, AQP and the settled LD therefore describe a different period from the SLA scores above them. `
                                            + `Treat them as indicative until the backend settles on contract quarters.`
                                        }
                                    />
                                )}
                                {draftAffectsPayment && (
                                    <div style={{
                                        marginTop: 14, padding: "9px 12px", borderRadius: 8,
                                        background: "#fffaf0", border: "1px solid #e8d9b0",
                                        fontSize: 11.5, lineHeight: 1.6,
                                    }}>
                                        <b style={{ color: AMBER }}>⚠ Includes local drafts.</b>{" "}
                                        The penalty below includes {draftCount} value{draftCount === 1 ? "" : "s"} typed
                                        here and never saved. Close the quarter on Settlement &amp; LD to invoice.
                                    </div>
                                )}

                                        <StatementSection
                                            letter="A"
                                            title="Phase-1 deliverables"
                                            clause="§5.23.1 · §5.28.2"
                                            first
                                        />
                                <table style={{ borderCollapse: "collapse", width: "100%", maxWidth: 620 }}>
                                    <tbody>
                                        {deliverableItems.length === 0 ? (
                                            <ChainRow label="none evaluated this quarter" value="—" />
                                        ) : (
                                            <>
                                                <ChainRow
                                                    label="Deliverable cost"
                                                    value={money(payables.totals.totalPayment)}
                                                />
                                                <ChainRow
                                                    label="Liquidated damages"
                                                    clause="SLA 001 / 002"
                                                    sign="−"
                                                    value={money(payables.totals.totalLdAmount)}
                                                    tone={RED}
                                                />
                                                <ChainRow
                                                    label="Net payable"
                                                    sign="="
                                                    value={money(statement.deliverableNet)}
                                                    strong
                                                    rule
                                                    hint="Uncapped — can go negative."
                                                />
                                            </>
                                        )}

                                    </tbody>
                                </table>

                                        {/* ── B · quarterly stream ────────────────── */}
                                        <StatementSection
                                            letter="B"
                                            title="Quarterly resource payment"
                                            clause="§5.28.1.d"
                                        />
                                <table style={{ borderCollapse: "collapse", width: "100%", maxWidth: 620 }}>
                                    <tbody>
                                        <ChainRow label="Planned resource cost" clause="F" value={money(chain.f)} />
                                        <ChainRow
                                            label="Guaranteed amount"
                                            clause={qgr.number !== null && qgr.count !== null
                                                ? `QGR · instalment ${qgr.number} of ${qgr.count}`
                                                : "QGR"}
                                            sign="+"
                                            value={money(chain.qgr)}
                                        />
                                        <ChainRow label="Payment base" clause="NPQP" sign="=" value={money(chain.npqp)} />
                                        <ChainRow
                                            label={relaxation.applied ? "Liquidated damages as scored" : "Liquidated damages"}
                                            clause={relaxation.applied
                                                ? `${pct(Math.round(relaxation.scoredPercent * 100) / 100)} of NPQP`
                                                : `${pct(chain.cappedLdPercent)} of NPQP`}
                                            sign={chain.ldAmount === null ? undefined : "−"}
                                            value={chain.ldAmount === null ? "—" : money(chain.ldAmount)}
                                            tone={RED}
                                            hint={chain.capApplied
                                                ? `Capped from ${pct(chain.sumLdPercent)} at the ${chain.quarterCapPercent}% ceiling.`
                                                : null}
                                        />
                                        {/* A relaxation lowers the penalty, so it reads as
                                            money coming BACK — the only "+" in an otherwise
                                            downward column, which is exactly what it is. */}
                                        {relaxation.applied && (
                                            <ChainRow
                                                label="Relaxation granted"
                                                clause={`${pct(Math.round(relaxation.grantedPercent * 100) / 100)} waived`}
                                                sign="+"
                                                value={relaxation.grantedAmount === null ? "—" : money(relaxation.grantedAmount)}
                                                tone={GREEN}
                                                hint={relaxation.reason ? `Reason: ${relaxation.reason}` : "No reason recorded."}
                                            />
                                        )}
                                        <ChainRow
                                            label="Actually earned"
                                            clause="PA"
                                            value={chain.pa === null
                                                ? <span style={{ color: AMBER, fontWeight: 700 }}>not settled yet</span>
                                                : money(chain.pa)}
                                        />
                                        <ChainRow
                                            label="Final payment"
                                            clause="AQP = (PA − LD) + QGR"
                                            sign="="
                                            value={statement.quarterlyNet === null ? "—" : money(statement.quarterlyNet)}
                                            strong
                                            rule
                                            hint={chain.effectiveLdPercentOnPa !== null && chain.ldAmount > 0
                                                ? `Effective rate ${Math.round(chain.effectiveLdPercentOnPa * 100) / 100}% of what is paid, `
                                                  + `against a headline ${pct(chain.cappedLdPercent)}.`
                                                : null}
                                        />

                                    </tbody>
                                </table>

                                        {/* ── QGR, broken down ───────────────────────
                                            §5.23.2's guarantee, and where this quarter's
                                            instalment sits in it. Every line is read from
                                            the NPQP payload or derived by exact division —
                                            the block only appears when the basis is
                                            actually there, rather than showing an
                                            instalment number nobody can stand behind. */}
                                        {(qgr.hasBasis || qgr.paidCount > 0) && (
                                            <div style={{
                                                marginTop: 12, padding: "11px 13px", borderRadius: 9,
                                                background: "#f6f9fd", border: "1px solid var(--uidai-pmis-border)",
                                                maxWidth: 620,
                                            }}>
                                                <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8, flexWrap: "wrap" }}>
                                                    <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: ".5px", textTransform: "uppercase", ...muted }}>
                                                        Guaranteed amount
                                                    </span>
                                                    <ClauseChip clause="§5.23.2" />
                                                    {qgr.number !== null && qgr.count !== null && (
                                                        <span style={{ fontSize: 11, fontWeight: 700, color: INK, marginLeft: "auto" }}>
                                                            Instalment {qgr.number} of {qgr.count}
                                                        </span>
                                                    )}
                                                </div>

                                                {/* A slim progress rail: how much of the
                                                    guarantee has been paid out so far. */}
                                                {qgr.count !== null && qgr.number !== null && (
                                                    <div style={{ height: 6, borderRadius: 999, background: "#dbe6f5", overflow: "hidden", marginBottom: 10 }}>
                                                        <div style={{
                                                            width: `${Math.min(100, (qgr.number / qgr.count) * 100)}%`,
                                                            height: "100%", background: GREEN, borderRadius: 999,
                                                        }} />
                                                    </div>
                                                )}

                                                <table style={{ borderCollapse: "collapse", width: "100%" }}>
                                                    <tbody>
                                                        {qgr.base !== null && (
                                                            <ChainRow label="Phase-1 fixed + one-time" value={money(qgr.base)} />
                                                        )}
                                                        {qgr.total !== null && (
                                                            <ChainRow
                                                                label={`Guaranteed at ${qgr.sharePercent}%`}
                                                                sign="="
                                                                value={money(qgr.total)}
                                                                rule={qgr.base !== null}
                                                            />
                                                        )}
                                                        {qgr.count !== null && (
                                                            <ChainRow
                                                                label={`Split across ${qgr.count} Phase 2/3 quarters`}
                                                                sign="÷"
                                                                value={money(qgr.perQuarter)}
                                                                strong
                                                                rule
                                                            />
                                                        )}
                                                        {qgr.paidCount > 0 && (
                                                            <ChainRow
                                                                label="Paid to date"
                                                                clause={`${qgr.paidCount} settled quarter${qgr.paidCount === 1 ? "" : "s"}`}
                                                                value={money(qgr.paidToDate)}
                                                                tone={GREEN}
                                                                rule
                                                            />
                                                        )}
                                                    </tbody>
                                                </table>
                                                <div style={{ fontSize: 11, ...muted, marginTop: 7, lineHeight: 1.55 }}>
                                                    Paid whatever the deployment. It sits inside NPQP so LD is charged on it,
                                                    then is added back after the deduction.
                                                </div>
                                            </div>
                                        )}

                                        {/* ── relaxation control ─────────────────────
                                            Placed in B rather than beside the headline: a
                                            relaxation is an act on the quarterly LD, and
                                            putting the button where that LD is charged is
                                            what keeps it from reading as a discount on the
                                            invoice as a whole. */}
                                        <div style={{
                                            marginTop: 12, padding: "10px 13px", borderRadius: 9, maxWidth: 620,
                                            background: relaxation.applied ? "#f2faf5" : "#fbfdff",
                                            border: `1px solid ${relaxation.applied ? "#bfe3cd" : "var(--uidai-pmis-border)"}`,
                                            display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap",
                                        }}>
                                            <div style={{ minWidth: 0, flex: "1 1 240px" }}>
                                                <div style={{ fontSize: 11.5, fontWeight: 700, color: relaxation.applied ? GREEN : INK }}>
                                                    {relaxation.applied
                                                        ? `Relaxation of ${pct(Math.round(relaxation.grantedPercent * 100) / 100)} granted`
                                                        : "No relaxation on this quarter"}
                                                </div>
                                                <div style={{ fontSize: 11, ...muted, marginTop: 2, lineHeight: 1.55 }}>
                                                    {relaxation.applied
                                                        ? (relaxation.reason || "No reason was recorded against the settlement row.")
                                                        : relaxation.canGrant
                                                            ? "Lowers the quarterly LD only — deliverable penalties are settled separately."
                                                            : relaxation.blockedReason}
                                                </div>
                                            </div>
                                            <button
                                                type="button"
                                                className="uidai-pmis-btn uidai-pmis-btn-small"
                                                style={{ marginTop: 0 }}
                                                disabled={!relaxation.canGrant || !(relaxation.scoredPercent > 0)}
                                                title={!relaxation.canGrant
                                                    ? relaxation.blockedReason
                                                    : !(relaxation.scoredPercent > 0)
                                                        ? "Nothing was charged this quarter, so there is nothing to relax."
                                                        : "Waive part of this quarter's quarterly LD."}
                                                onClick={() => setRelaxOpen(true)}
                                            >
                                                {relaxation.applied ? "Revise relaxation" : "Grant relaxation"}
                                            </button>
                                        </div>

                                        {/* ── C · the invoice ─────────────────────── */}
                                        <StatementSection
                                            letter="C"
                                            title="The invoice"
                                            clause="§5.28.1.e"
                                        />
                                <table style={{ borderCollapse: "collapse", width: "100%", maxWidth: 620 }}>
                                    <tbody>
                                        <ChainRow
                                            label="Due this quarter"
                                            clause="A + B"
                                            value={statement.grossDue === null ? "—" : money(statement.grossDue)}
                                            strong
                                            tone={INK}
                                        />
                                        <ChainRow
                                            label={`GST @ ${statement.tax.gstPercent}%`}
                                            sign="+"
                                            value={money(statement.tax.gst)}
                                        />
                                        <ChainRow
                                            label={`TDS @ ${statement.tax.tdsPercent}% withheld`}
                                            sign="−"
                                            value={money(statement.tax.tds)}
                                            tone={RED}
                                        />
                                        <ChainRow
                                            label="Net paid"
                                            clause="§5.28.1.e"
                                            sign="="
                                            value={money(statement.tax.net)}
                                            strong
                                            rule
                                            tone={GREEN}
                                            hint="Tax applies after the LD deduction — §5.27.6."
                                        />
                                    </tbody>
                                </table>

                                    </div>

                                    {/* ── D · where the contract stands ─────────
                                        Tinted and set apart: A–C are THIS quarter's
                                        money, D is the running total they land in,
                                        and reading them as one column is how a
                                        quarter's figure gets mistaken for the
                                        contract's. */}
                                    <div style={{ background: "#f4f8fd", borderTop: "1px solid #dbe6f5", padding: "4px 20px 18px" }}>
                                        <StatementSection
                                            letter="D"
                                            title="Contract to date"
                                            clause="§5.26.2"
                                            first
                                        />
                                <table style={{ borderCollapse: "collapse", width: "100%", maxWidth: 620 }}>
                                    <tbody>
                                        <ChainRow
                                            label="Total paid"
                                            clause={cumulative.quarterCount === 0
                                                ? undefined
                                                : `${cumulative.pricedCount} of ${cumulative.quarterCount} quarters priced`}
                                            value={cumulative.quarterCount === 0 ? "no quarter closed yet" : money(cumulative.totalAqp)}
                                        />
                                        {cumulative.quarterCount > 0 && (
                                            <>
                                                <ChainRow label="of which invoiced" value={money(cumulative.invoicedAqp)} />
                                                <ChainRow
                                                    label="still provisional"
                                                    value={money(cumulative.provisionalAqp)}
                                                    tone={cumulative.provisionalAqp > 0 ? AMBER : undefined}
                                                    hint={cumulative.provisionalAqp > 0
                                                        ? "Auto-closed but not invoiced."
                                                        : null}
                                                />
                                                <ChainRow label="Penalties deducted" value={money(cumulative.totalLd)} tone={RED} rule />
                                            </>
                                        )}
                                        <ChainRow
                                            label="Ceiling"
                                            clause={`${ceiling.multiplier ?? 1.25} × contract value`}
                                            value={ceiling.known ? money(ceiling.ceiling) : "—"}
                                            strong
                                            rule
                                            hint={ceiling.known ? null : ceiling.reason}
                                        />
                                        {ceiling.known && ceiling.remaining !== null && (
                                            <ChainRow
                                                label="Remaining headroom"
                                                clause={`${Math.round((ceiling.usedPercent ?? 0) * 10) / 10}% used`}
                                                value={money(ceiling.remaining)}
                                                tone={ceiling.exceeded ? RED : ceiling.intoCcn ? AMBER : GREEN}
                                            />
                                        )}
                                    </tbody>
                                </table>
                                    </div>
                                </div>
                            </div>
                        </>
                    )}
                </>
            )}

            {relaxOpen && (
                <RelaxationModal
                    scoredPercent={relaxation.scoredPercent}
                    npqp={chain.npqp}
                    quarterLabel={period?.label || "this quarter"}
                    quarterDates={period ? `${longDate(period.start)} → ${longDate(period.end)}` : ""}
                    onCancel={() => setRelaxOpen(false)}
                    onSubmit={async (payload) => {
                        await grantRelaxation(payload);
                        setRelaxOpen(false);
                    }}
                />
            )}
        </div>
    );
}
