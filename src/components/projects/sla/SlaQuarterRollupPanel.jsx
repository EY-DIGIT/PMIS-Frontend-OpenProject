/* ══════════════════════════════════════════════════════════════════
   Per-SLA quarterly rollup — "what did each SLA actually cost us, and
   which activities caused it?"

   The Settlement page answers the money question (one flat row per SLA,
   then PQP and the cap). It cannot answer the audit question, because
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
    getPqp,
    getSeverityMaster,
    getLdBands,
    listSlaMasters,
    hydrateSlaMasters,
    getQuarterlyAggregate,
    listSettlements,
    getSettlement,
    overrideSettlement,
    formatQuarterKey,
    isContractYear,
} from "../../../api/slaCompliance";
import { getPaymentPage, isFinanceForbidden } from "../../../api/paymentPage";
import {
    contractQuarters,
    resourcePhaseStart,
    contractQuarterFor,
    overlappingCalendarQuarters,
    blendPqp,
    withinWindow,
    attributionDate,
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
import {
    indexMilestoneCompletion,
    buildQuarterDeliverablePayment,
    readActivityCompletion,
} from "../../../utils/project/quarterDeliverablePayment";
import { getActivityApprovalStatus } from "../../../api/activityWorkflow";
import {
    detectFinanceBasis,
    reconcileTaxBasis,
    reconcileSlaDeductions,
    ceilingBaseFor,
    SEVERITY,
} from "../../../utils/project/taxBasis";
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

/* ─── the quarter's LD ceiling (§5.27.6) ──────────────────────────
   10% of PQP, pre-tax, over the quarter's CUMULATIVE liquidated
   damages — both tracks together, all SLAs, all deliverables.

   There is deliberately no per-deliverable and no per-SLA ceiling: the
   RFP has neither, and a bidder who asked for a per-milestone cap was
   refused (pre-bid query 138, "No Change"). An individual deliverable
   may therefore exceed 10% of its own cost, as long as the quarter's
   total stays inside 10% of PQP.

   The arithmetic lives in `combinedCapCheck`; this constant exists so
   the screen quotes the same figure the maths uses. */
const QUARTER_LD_CAP_PERCENT = 10;

/* Hides the "Cross-check against Finance" block at the foot of the
   payment statement. Hidden on request, not deleted — `taxCheck` still
   runs, so flipping this back to true restores the section as it was. */
const SHOW_FINANCE_CROSSCHECK = false;

/* ─── printing the statement ──────────────────────────────────────
   The statement is the audit record for the quarter, so it has to leave
   the screen as a filed document. `window.print()` plus a stylesheet
   that hides everything else is the whole mechanism — no dependency, no
   second rendering path that can drift from what is on screen, and
   "Save as PDF" in the browser's own dialog produces the file.

   Injected once at module scope rather than per render: a second copy of
   these rules would fight the first over which `visibility` wins. */
const PRINT_ROOT_ID = "sla-payment-statement-print";
const PRINT_STYLE_ID = "sla-payment-statement-print-style";

/* The whole rollup, top to bottom, as opposed to the statement alone.
   Both buttons run the same `window.print()`; which subtree survives is
   decided by this class on <body>, set for the duration of the dialog.
   One stylesheet, two modes — a second print path would be free to drift
   from the first. */
const PAGE_PRINT_ROOT_ID = "sla-rollup-print";
const PRINT_ALL_CLASS = "sla-printing-all";
const PRINT_CSS = `
@media print {
  /* ── unwind the app shell first ──────────────────────────────────
     The shell is a fixed-height CLIPPED scroller: .pmis-wrap is
     height:100vh + overflow:hidden, and .pmis-main / .pmis-content
     scroll inside it. Left alone, the sheet comes out BLANK — the
     statement below is positioned to the top of the page, which is
     outside those ancestors' clip rectangle, and anything past the
     first viewport is cut off anyway.

     So the shell has to lay out at its natural height before any of
     the rules below can matter. */
  html, body {
    height: auto !important; max-height: none !important;
    overflow: visible !important;
  }
  .pmis-wrap, .pmis-shell-row, .pmis-main, .pmis-content {
    display: block !important;
    height: auto !important; max-height: none !important;
    overflow: visible !important; position: static !important;
  }
  /* Chrome is removed outright rather than hidden. Left visible-but-
     hidden it keeps its box, and a sticky header's box reserves space
     on every sheet — which is how a "blank first page" happens. */
  .pmis-sidebar, .pmis-header, .site-header, .pmis-footer { display: none !important; }

  /* Hide the page, then re-show only the chosen subtree. Done with
     visibility rather than display so the element keeps its box and can
     be repositioned to the top of the sheet.

     Which subtree that is depends on the mode: the statement alone by
     default, the whole rollup when <body> carries the print-all class. */
  body * { visibility: hidden !important; }

  body:not(.${PRINT_ALL_CLASS}) #${PRINT_ROOT_ID},
  body:not(.${PRINT_ALL_CLASS}) #${PRINT_ROOT_ID} * { visibility: visible !important; }
  body:not(.${PRINT_ALL_CLASS}) #${PRINT_ROOT_ID} {
    position: absolute !important; left: 0 !important; top: 0 !important;
    width: 100% !important; margin: 0 !important; padding: 0 !important;
    box-shadow: none !important;
  }

  body.${PRINT_ALL_CLASS} #${PAGE_PRINT_ROOT_ID},
  body.${PRINT_ALL_CLASS} #${PAGE_PRINT_ROOT_ID} * { visibility: visible !important; }
  body.${PRINT_ALL_CLASS} #${PAGE_PRINT_ROOT_ID} {
    position: absolute !important; left: 0 !important; top: 0 !important;
    width: 100% !important; margin: 0 !important; padding: 0 !important;
    border: 0 !important; box-shadow: none !important;
  }
  /* Controls are dead on paper and the reload button reads as a defect
     in a filed document. The pickers' CURRENT values matter, though, so
     the quarter heading below carries them instead. */
  body.${PRINT_ALL_CLASS} #${PAGE_PRINT_ROOT_ID} button,
  body.${PRINT_ALL_CLASS} #${PAGE_PRINT_ROOT_ID} select { display: none !important; }
  body.${PRINT_ALL_CLASS} #${PAGE_PRINT_ROOT_ID} .sla-print-only { display: block !important; }
  /* Nested inside the page root, the statement must not also be pulled
     to top:0 — that would stack it over the sections above it. */
  body.${PRINT_ALL_CLASS} #${PRINT_ROOT_ID} { position: static !important; }

  /* The masthead is a gradient on ink — without this browsers drop the
     background and print white text on white. */
  #${PRINT_ROOT_ID} *, #${PAGE_PRINT_ROOT_ID} * {
    -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important;
  }
  #${PRINT_ROOT_ID} > div { box-shadow: none !important; border-radius: 0 !important; }
  /* A lettered section should not be split across a page break. */
  #${PRINT_ROOT_ID} table, #${PAGE_PRINT_ROOT_ID} table { break-inside: avoid; page-break-inside: avoid; }
  @page { margin: 12mm; }
}
`;

/* Runs the browser's print dialog with the whole rollup selected rather
   than the statement. The class is cleared on `afterprint` rather than
   straight after `print()` returns, because print() does not block in
   every browser — removing it early would take the rollup back off the
   sheet mid-dialog. */
function printWholePage() {
    const body = document.body;
    const done = () => {
        body.classList.remove(PRINT_ALL_CLASS);
        window.removeEventListener("afterprint", done);
    };
    window.addEventListener("afterprint", done);
    body.classList.add(PRINT_ALL_CLASS);
    window.print();
}

/* Idempotent by CONTENT, not merely by presence.
   Returning early whenever the id existed meant a tab that had already
   loaded an older build kept that build's rules for the rest of its
   life — hot reload swaps the module but never the injected <style>.
   That is not cosmetic: it silently printed the wrong subtree, because
   the older stylesheet had no notion of the print-all mode and showed
   the statement unconditionally. Refresh when the text differs. */
function ensurePrintStyle() {
    if (typeof document === "undefined") return;
    let el = document.getElementById(PRINT_STYLE_ID);
    if (!el) {
        el = document.createElement("style");
        el.id = PRINT_STYLE_ID;
        document.head.appendChild(el);
    }
    if (el.textContent !== PRINT_CSS) el.textContent = PRINT_CSS;
}

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
   The library stores a category code per SLA. The page no longer filters
   by it — there are two sections, matching the RFP's two charging bases —
   but it still GROUPS by it inside each, so resource deployment and query
   resolution do not run together just because both are quarterly.

   A string that cannot collide with a real code, so a project that
   genuinely names a category "NONE" is still told apart from one that
   sent no category at all. */
const UNCATEGORISED = "__none__";

/* The governance tool (D11) is listed with the deliverables because that
   is where people look for it. Matched on the CATEGORY rather than on a
   ref number, so a project that numbers its governance SLAs differently
   still groups them right — and a project with no such category simply
   leaves everything where the track put it.

   Display only. The track still decides how it is charged. */
function isGovernanceCategory(cat) {
    return /GOVERNANCE/i.test(String(cat?.code || ""));
}

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

/* The sub-header above one category's SLA groups. Deliberately lighter
   than SectionHead — this sits INSIDE a track section, and giving it the
   same weight would make the page read as twice as many sections.

   Collapsible, and it OWNS its rows rather than sitting beside them, so
   folding one shut actually hides the SLAs underneath it. CLOSED by
   default: the page then opens as a one-screen index of the quarter —
   every category, what it holds and what it cost — and the reader opens
   only the one they came for.

   That only works because the counts and the LD figure live in the
   header. Collapsed, the strip still answers "did anything in here cost
   money", which is the whole question worth asking before deciding to
   open it. */
function CategoryBlock({ cat, accent, children, defaultOpen = false }) {
    const [open, setOpen] = useState(defaultOpen);
    const costs = cat.track === TRACK.DELIVERABLE ? cat.ldAmount > 0 : cat.ldPercent > 0;
    return (
        <div style={{ marginTop: 16 }}>
        <button
            type="button"
            onClick={() => setOpen((o) => !o)}
            aria-expanded={open}
            title={open ? `Hide the ${cat.label} SLAs` : `Show the ${cat.label} SLAs`}
            style={{
                width: "100%", display: "flex", alignItems: "center", gap: 9, flexWrap: "wrap",
                font: "inherit", cursor: "pointer", textAlign: "left",
                background: "transparent", border: "none", margin: 0, padding: "0 0 6px",
                borderBottom: "1px solid var(--uidai-pmis-border)",
            }}
        >
            <span style={{
                ...muted, fontSize: 10, display: "inline-block", flex: "0 0 auto",
                transition: "transform .15s ease", transform: open ? "rotate(90deg)" : "none",
            }}>▶</span>
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
                        title="This category holds SLAs charged on different bases — one on a deliverable's cost, one on PQP. Check the category on those SLAs in the library."
                    >
                        ⚠ mixed base
                    </span>
                )}
            </span>
        </button>
        {open && children}
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

function PeriodStrip({ period }) {
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
                <div style={{ display: "inline-flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                    <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: ".5px", textTransform: "uppercase", ...muted }}>
                        Reporting interval
                    </div>
                    {/* The quarter's own name. Contract-anchored, so "Y2" is the
                        second CONTRACT year measured from T0 — never 2026. This
                        is also the value the settlement / PQP / aggregate
                        endpoints take as ?quarter=. */}
                    {period?.key && (
                        <span
                            title={`Contract year ${period.year}, quarter ${period.quarter} — measured from the project's start date, not the calendar`}
                            style={{
                                fontFamily: "monospace", fontSize: 11, fontWeight: 800,
                                color: INK, background: "#dceafe", border: "1px solid #bcd4f5",
                                borderRadius: 999, padding: "1px 8px",
                            }}
                        >
                            {period.key}
                        </span>
                    )}
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

        </div>
    );
}

/* ─── deliverable payable report ──────────────────────────────────
   "What was this deliverable meant to be paid, what did the SLAs take
   off it, and what is actually payable?"

   The base and the payment are different numbers and are kept visibly
   apart here for that reason. LD is charged on `ldBasisPretaxValue` —
   the milestone's allotment × its delivery cost BEFORE tax, one-time
   cost excluded — and deducted from what is actually paid, which is
   tax-inclusive. So the deduction is a smaller slice of the payment
   than of the base, and the payment column names both rather than
   letting one stand in for the other. */
function PayableRow({ row, open, onToggle, activityDates }) {
    const overrun = row.netPayable !== null && row.netPayable < 0;

    /* Dates keyed by activity id AND by code — a contribution carries
       whichever of the two the evaluation happened to record, and matching
       on one alone silently drops the dates for the other half. */
    const byActivity = useMemo(() => {
        const m = new Map();
        for (const a of activityDates || []) {
            if (a.activityId) m.set(String(a.activityId), a);
            if (a.code) m.set(String(a.code), a);
        }
        return m;
    }, [activityDates]);

    /* First row per activity only — an activity that breached two SLAs gets
       two contribution rows, and printing the same four dates on both is
       noise rather than evidence.

       Resolved ONCE, into an array parallel to `contributions`, rather than
       by a function called from the JSX. A "have I shown this yet" function
       is not idempotent, and `f(c) && <X d={f(c)} />` calls it twice: the
       first call claims the activity, the second returns null, and the
       component renders nothing at all. */
    const datesByContribution = useMemo(() => {
        const seen = new Set();
        return (row.contributions || []).map((c) => {
            const id = c.activityId ? String(c.activityId) : "";
            const code = c.activityCode ? String(c.activityCode) : "";
            const hit = (id && byActivity.get(id)) || (code && byActivity.get(code)) || null;
            if (!hit) return null;
            const key = hit.activityId || hit.code || id || code;
            if (seen.has(key)) return null;
            seen.add(key);
            return hit;
        });
    }, [row.contributions, byActivity]);

    /* Activities with no SLA evaluation at all — nothing above will show
       their dates, so they are listed after the contributions. */
    const scoredKeys = new Set(
        (row.contributions || []).flatMap((c) => [c.activityId, c.activityCode].filter(Boolean).map(String))
    );
    const unscoredActivities = (activityDates || []).filter(
        (a) => !scoredKeys.has(String(a.activityId)) && !scoredKeys.has(String(a.code))
    );

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
                    {row.hasBase ? money(row.ldBase) : <span style={{ color: AMBER, fontWeight: 700 }}>no payment term</span>}
                    <div style={{ fontSize: 10.5, ...muted, fontWeight: 400 }}>
                        {!row.hasBase ? "nothing to charge against"
                            : row.ldBaseSource === "ldBasisPretaxValue"
                                /* Tax-free and one-time-free: the LD is charged on the
                                   work, not on the GST or the reimbursed expense. */
                                ? `${pct(row.ldBasisPercent)} allotment · pre-tax`
                                : `${pct(row.paymentPercent)} of phase`}
                    </div>
                    {row.hasBase && row.ldBaseSource === "ldBasisPretaxValue" && (
                        <div
                            style={{ fontSize: 10.5, ...muted, fontWeight: 400 }}
                            title={"The penalty base is ldBasisPretaxValue — the milestone's allotment × its "
                                + "delivery cost BEFORE tax, with one-time cost excluded. It is deliberately not "
                                + "the paid amount " + money(row.paymentValue) + ", which carries "
                                + money(row.paymentTaxValue) + " of tax and any one-time share."}
                        >
                            paid {money(row.paymentValue)} incl. tax
                        </div>
                    )}
                    {row.hasBase && row.ldBaseSource === "paymentValue" && (
                        <div
                            style={{ fontSize: 10.5, color: AMBER, fontWeight: 700 }}
                            title={"The payment page did not return ldBasisPretaxValue for this milestone, so the LD "
                                + "falls back to the paid amount — which INCLUDES tax and any one-time share, and so "
                                + "overstates the penalty. Re-save the term on the finance page to have the backend "
                                + "compute the pre-tax base."}
                        >
                            ⚠ post-tax base (no pre-tax figure)
                        </div>
                    )}
                    {row.ldBasisDiffers && (
                        <div
                            style={{ fontSize: 10.5, color: AMBER, fontWeight: 700 }}
                            title={"The base charged (" + money(row.ldBase) + ") differs from this deliverable's own "
                                + "pre-tax payment (" + money(row.paymentPreTaxValue) + "). The schedule pays each "
                                + "deliverable its own cost, so those should agree. A gap usually means the LD Basis % "
                                + "is still on the backend's even split rather than the payment schedule, or that a "
                                + "one-time share makes up part of the milestone."}
                        >
                            ⚠ base ≠ pre-tax payment
                        </div>
                    )}
                </td>
                <td style={{ textAlign: "right", fontVariantNumeric: "tabular-nums", fontWeight: 800, color: row.ldPercent > 0 ? RED : GREEN }}>
                    {/* Σ across this deliverable's SLAs. No per-deliverable
                        ceiling exists (§5.28.2), so before and after are equal
                        here by construction — the quarter's 10%-of-PQP cap acts
                        on the total, in the payment statement. */}
                    <CapPair
                        before={Math.round(row.ldPercent * 100) / 100}
                        after={Math.round(row.ldPercentCapped * 100) / 100}
                        noCapClause="no row cap"
                        compact
                    />
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
                            title={"Accrued LD has exceeded this deliverable's entire cost. There is no ceiling "
                                + "of its own, so the figure is shown as calculated rather than clamped to zero."}
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
                        {/* The activity's own dates, under the activity. Resolved
                            above so this is a plain lookup, not a call with a
                            side effect. */}
                        <ActivityDateLines activity={datesByContribution[i]} />
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

            {/* Activities under this deliverable that no SLA fired on — they
                have no contribution row to hang their dates from, but a
                deliverable is only delivered when all of them are, so a
                reader checking why it is or is not payable needs them. */}
            {open && unscoredActivities.map((a) => (
                <tr key={`${row.milestoneId}-a-${a.activityId || a.code}`} style={{ background: "#f6faff" }}>
                    <td style={{ borderLeft: "3px solid #cbd5e1", paddingLeft: 18 }}>
                        <span style={{ fontSize: 12, color: "#0b3c88", fontWeight: 600 }} title={a.name || ""}>
                            {a.code}
                        </span>
                        <div style={{ fontSize: 10.5, ...muted }}>no SLA evaluated</div>
                        <ActivityDateLines activity={a} />
                    </td>
                    <td colSpan={5} />
                </tr>
            ))}
        </>
    );
}

/* Heading for one of the two LD regimes. The subtitle carries the RFP
   clause and the money base, because "which of these two lists does this
   SLA belong in" is the question the whole screen exists to answer. */
/* ─── a top-level section of the page ─────────────────────────────
   The rollup has three: the quarter's dates, the SLA breakup, and the
   payment statement. Only the statement stood out, so the other two read
   as one long undifferentiated column — a reader could not see where the
   evidence ended and the money began.

   A numbered band, a rule, and real space above each. Deliberately
   heavier than the sub-headers inside them: the point is that these
   three are different KINDS of thing, not three more headings. */
function PageSection({ index, title, sub, right, children, id }) {
    return (
        <section id={id} style={{ marginTop: 30 }}>
            <div style={{
                display: "flex", alignItems: "flex-end", gap: 12, flexWrap: "wrap",
                paddingBottom: 10, borderBottom: "2px solid #dbe6f5",
            }}>
                <span style={{
                    width: 26, height: 26, borderRadius: 8, background: INK, color: "#fff",
                    fontSize: 12, fontWeight: 800, flex: "0 0 auto",
                    display: "inline-flex", alignItems: "center", justifyContent: "center",
                }}>
                    {index}
                </span>
                <span style={{ minWidth: 0 }}>
                    <span style={{ display: "block", fontSize: 15, fontWeight: 800, color: INK, letterSpacing: "-.2px" }}>
                        {title}
                    </span>
                    {sub && (
                        <span style={{ display: "block", fontSize: 11.5, ...muted, marginTop: 2 }}>{sub}</span>
                    )}
                </span>
                {right && <span style={{ marginLeft: "auto" }}>{right}</span>}
            </div>
            {children}
        </section>
    );
}

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

/* The two TRACKS are the page's real division: one is charged as a
   percentage of PQP, the other in rupees on a deliverable's own cost,
   and they share no ceiling. Plain text headings gave them the same
   weight as the category rows beneath them, so the page read as one
   continuous list of sections and the boundary was invisible.

   A banner — tinted, bordered, with an accent rail down its left edge —
   makes each track announce itself as a region. The hue differs only to
   tell the two apart at a glance; neither is good or bad, so the
   semantic red/amber/green of the badges is left untouched. */
const TRACK_BANNER = {
    quarterly: { accent: "#2f6db5", bg: "#f2f7fd", border: "#cfe0f5" },
    deliverable: { accent: "#5b52b5", bg: "#f5f4fd", border: "#d8d5f2" },
};

function SectionHead({ title, count, sub, clause, onToggle, toggleLabel, showToggle, style, track }) {
    const banner = track ? TRACK_BANNER[track] || TRACK_BANNER.quarterly : null;

    return (
        <div style={banner
            ? {
                marginTop: 18, borderRadius: 10, padding: "12px 16px",
                background: banner.bg, border: `1px solid ${banner.border}`,
                borderLeft: `4px solid ${banner.accent}`, ...style,
            }
            : { marginTop: 18, ...style }}
        >
            <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                <div style={{
                    fontSize: banner ? 15 : 13.5, fontWeight: 800,
                    color: banner ? banner.accent : INK,
                }}>
                    {title}
                </div>
                <span style={{
                    background: banner ? "#fff" : "#dceafe",
                    border: banner ? `1px solid ${banner.border}` : "none",
                    color: banner ? banner.accent : "#1f4e87",
                    borderRadius: 999, padding: "1px 8px", fontSize: 11, fontWeight: 800,
                }}>
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
            {sub && (
                <div style={{ fontSize: 11.5, ...muted, marginTop: banner ? 4 : 3, lineHeight: 1.55 }}>
                    {sub}
                </div>
            )}
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
function Metric({ label, value, accent, flag, flagTitle, wide }) {
    /* `wide` sizes for the LABEL now, not for a trailing cap phrase — the
       value under it is a bare figure unless a cap actually bit. */
    return (
        <span style={{ textAlign: "right", minWidth: wide ? 100 : 74 }}>
            <span style={{ display: "block", fontSize: 10.5, ...muted, fontWeight: 700, textTransform: "uppercase", letterSpacing: ".3px" }}>
                {label}
            </span>
            <span style={{ fontSize: wide ? 13 : 15, fontWeight: 800, color: accent || INK, fontVariantNumeric: "tabular-nums" }}>
                {value}
                {flag && (
                    <span style={{ fontSize: 11, color: AMBER, fontWeight: 700, marginLeft: 4 }} title={flagTitle}>▲</span>
                )}
            </span>
        </span>
    );
}

/* ─── planned vs actual, per activity ─────────────────────────────
   The evidence behind a deliverable's completion date. Four dates
   because they answer four different questions, and a deliverable can
   easily be late on one and fine on another:

     Planned start / Actual start   — a resourcing problem
     Planned end   / Actual end     — what SLA 001 actually charges for

   Slip is signed and shown only when both ends of the pair are known.
   A blank is "we cannot tell", which is not the same as "on time" and
   must not read like it. */
function slipLabel(days) {
    if (days === null || days === undefined) return null;
    if (days === 0) return { text: "on time", tone: GREEN };
    if (days < 0) return { text: `${Math.abs(days)}d early`, tone: GREEN };
    return { text: `${days}d late`, tone: days > 7 ? RED : AMBER };
}

/* Four labelled lines, stacked under the activity they belong to.

   A six-column table off to the side made the reader carry the activity
   code across the screen and back. Planned and actual sit on adjacent
   lines instead, so each pair is read as a comparison without moving
   the eye — which is the only thing anyone is doing with these dates. */
function ActivityDateLines({ activity }) {
    if (!activity) return null;
    const startSlip = slipLabel(activity.startSlipDays);
    const endSlip = slipLabel(activity.endSlipDays);

    const line = (label, value, slip, missing) => (
        <div style={{ display: "flex", gap: 6, alignItems: "baseline", lineHeight: 1.5 }}>
            <span style={{ ...muted, fontSize: 9.5, fontWeight: 700, letterSpacing: ".3px", textTransform: "uppercase", minWidth: 74 }}>
                {label}
            </span>
            <span style={{ fontSize: 11, color: value ? "#334155" : undefined, fontVariantNumeric: "tabular-nums" }}>
                {value ? longDate(value) : <span style={{ ...muted }}>{missing}</span>}
            </span>
            {slip && (
                <span style={{ fontSize: 9.5, color: slip.tone, fontWeight: 700 }}>{slip.text}</span>
            )}
        </div>
    );

    return (
        <div style={{ marginTop: 5, borderLeft: "2px solid #dbe6f5", paddingLeft: 8 }}>
            {line("Planned start", activity.plannedStart, null, "—")}
            {line("Actual start", activity.actualStart, startSlip, "not started")}
            {line("Planned end", activity.plannedEnd, null, "—")}
            {line("Actual end", activity.actualEnd, endSlip,
                activity.done ? "not recorded" : "open")}
            {activity.done && activity.completedVia && (
                <div style={{ ...muted, fontSize: 9.5, marginTop: 2 }}>
                    accepted via {activity.completedVia}
                    {activity.acceptedBy ? ` · ${activity.acceptedBy}` : ""}
                </div>
            )}
        </div>
    );
}

/* The qualifier beside a capped figure is a status, not prose: "under
   the cap" and "no cap · within band" both name which ceiling applied.
   Set as a chip it reads as one glanceable token instead of a grey
   sentence competing with the number it qualifies — and the tone says
   whether a cap actually bit without the reader parsing the words. */
const CHIP_TONE = {
    neutral: { bg: "#f1f5fb", border: "#d7e0ee", fg: "var(--uidai-pmis-muted)" },
    capped: { bg: "#fdf3e3", border: "#f0d7a8", fg: AMBER },
};

function StatusChip({ children, tone = "neutral", title }) {
    const t = CHIP_TONE[tone] || CHIP_TONE.neutral;
    return (
        <span
            title={title}
            style={{
                display: "inline-block", background: t.bg,
                border: `1px solid ${t.border}`, color: t.fg,
                borderRadius: 999, padding: "1px 7px",
                fontSize: 10, fontWeight: 700, lineHeight: 1.7,
                whiteSpace: "nowrap", letterSpacing: ".1px",
            }}
        >
            {children}
        </span>
    );
}

/* ─── before the cap → after the cap ──────────────────────────────
   Every SLA type is capped by something different — the top LD band for
   a points SLA, nothing at all for a deliverable one, the 10% quarter
   ceiling for the total — and the page used to say only "uncapped",
   which reads as "we did not check" rather than "the RFP sets none".

   So the pair is always shown, in the same shape, whatever the type:

       12.4% → 10%     a cap bit, and by how much
       3.2%            nothing to cap it with, and the clause that says so

   `before` and `after` being equal is a real answer, not a missing one.
   Where a type genuinely has no ceiling, the clause is named — because
   "no cap" is a contractual fact about §5.28.2, not an oversight. */
function CapPair({ before, after, format = pct, clause, noCapClause, compact }) {
    /* Guarded on the RAW values: `Number(null)` is 0, not NaN, so an SLA
       that was never scored would otherwise render a confident "0%" —
       which reads as "cost nothing" rather than "not measured". */
    const real = (v) => v !== null && v !== undefined && v !== "" && Number.isFinite(Number(v));
    const b = real(before) ? Number(before) : null;
    const a = real(after) ? Number(after) : null;
    const known = b !== null && a !== null;
    const bit = known && Math.abs(b - a) > 1e-9;

    if (!known) {
        const only = a ?? b;
        return (
            <span style={{ ...muted, fontVariantNumeric: "tabular-nums" }}>
                {only === null ? "—" : format(only)}
            </span>
        );
    }

    return (
        <span style={{ display: "inline-flex", alignItems: "center", gap: 5, flexWrap: "wrap", fontVariantNumeric: "tabular-nums" }}>
            {bit ? (
                <>
                    {/* The pre-cap figure is struck through rather than dropped:
                        it is what was scored, and a reader checking the working
                        needs to see the number the cap acted on. */}
                    <span style={{ ...muted, textDecoration: "line-through", fontSize: compact ? 11 : 12 }}>
                        {format(b)}
                    </span>
                    <span style={{ ...muted, fontSize: compact ? 10 : 11 }}>→</span>
                    <b style={{ color: RED }}>{format(a)}</b>
                    {clause && (
                        <StatusChip tone="capped" title={`Capped by ${clause}`}>
                            {clause}
                        </StatusChip>
                    )}
                </>
            ) : (
                /* Nothing was capped — which is the ordinary case on nearly
                   every row, so saying so earns no space. The figure alone
                   IS the statement "this is what was charged"; a chip
                   repeating "under the cap" on all twelve rows only made
                   the one row where a cap DID bite harder to find.
                   The fact survives on the tooltip for anyone checking. */
                <b
                    style={{ color: INK }}
                    title={noCapClause
                        ? `No ceiling applies to this figure — ${noCapClause}`
                        : "Below the ceiling that applies to it"}
                >
                    {format(a)}
                </b>
            )}
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

   Deliberately free of acronyms — PQP, PA and AQP are defined in the
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

function Headline({ period, breaches, measured, awaiting, ldPercent, ldAmount, deliverableLd, finalPayment, pending, settled }) {
    /* "No breaches" is only true if everything was actually read. With SLAs
       still unscored the quarter is unmeasured, not clean. Since 005–009
       now score automatically on activity completion this should be rare,
       so an unclean headline here is a real signal rather than the normal
       state of an open quarter. */
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
                {/* Fed from the settlement row on a closed quarter, so this
                    cannot say "None" while the payment statement below shows
                    a deduction — they now read the same source. */}
                <HeadlineFigure
                    caption="Penalty"
                    value={totalPenalty > 0 ? money(totalPenalty) : "None"}
                    tone={totalPenalty > 0 ? RED : GREEN}
                    note={Number(ldPercent) > 0
                        ? `${pct(ldPercent)} of the payment base${settled ? " · as settled" : ""}`
                        : settled ? "settled at nil" : "nothing deducted"}
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
    ["QGR", "Guaranteed quarterly amount, paid whatever the deployment. No penalty is charged on it."],
    ["PQP", "The planned base the penalty % applies to — F alone. QGR is not part of it."],
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

/* ─── one finance cross-check ─────────────────────────────────────
   Four states, and "not examined" is deliberately one of them: a check
   that could not run must not read like a check that passed, because
   only one of those is reassuring. */
const CHECK_MARK = {
    [SEVERITY.OK]: { icon: "✓", tone: GREEN, bg: "#f2faf5", border: "#bfe3cd" },
    [SEVERITY.WARN]: { icon: "▲", tone: AMBER, bg: "#fffaf0", border: "#e8d9b0" },
    [SEVERITY.ERROR]: { icon: "✕", tone: RED, bg: "#fdf4f2", border: "#f0c9c2" },
    [SEVERITY.UNKNOWN]: { icon: "◍", tone: "var(--uidai-pmis-muted)", bg: "#f6f9fd", border: "var(--uidai-pmis-border)" },
};

function CheckRow({ check }) {
    const m = CHECK_MARK[check.severity] || CHECK_MARK[SEVERITY.UNKNOWN];
    return (
        <div style={{
            display: "flex", gap: 10, padding: "10px 12px", borderRadius: 9,
            background: m.bg, border: `1px solid ${m.border}`,
        }}>
            <span style={{ color: m.tone, fontWeight: 800, fontSize: 12, lineHeight: 1.5, flex: "0 0 auto" }}>
                {m.icon}
            </span>
            <span style={{ minWidth: 0 }}>
                <span style={{ display: "block", fontSize: 12, fontWeight: 700, color: INK }}>
                    {check.title}
                </span>
                <span style={{ display: "block", fontSize: 11.5, color: "#334155", marginTop: 2, lineHeight: 1.6 }}>
                    {check.detail}
                </span>
            </span>
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
function RelaxationModal({ scoredPercent, pqp, quarterLabel, quarterDates, onCancel, onSubmit }) {
    const [value, setValue] = useState("");
    const [reason, setReason] = useState("");
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState("");

    const scored = Number(scoredPercent) || 0;
    const relax = Number(value);
    const valid = Number.isFinite(relax) && relax > 0 && relax <= scored + 1e-9;
    const next = valid ? Math.max(0, scored - relax) : scored;
    const amountOf = (p) => (Number.isFinite(Number(pqp)) ? (p / 100) * Number(pqp) : null);

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
                        quarterly LD only
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
                                            ? `${money(amountOf(next))} of PQP — down from ${money(amountOf(scored))}.`
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
                                                <span style={{ color: AMBER, marginLeft: 4 }} title="SLA Cap applied in this interval">▲</span>
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
                                    Accumulated over the reporting interval
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
/* The SLA's own reference image from the SLA Library, shown beside its ref.

   Rendered as a plain <img> rather than fetched: the attachment files are
   served as public static content and answer 200 with no Authorization
   header, so a blob round-trip would buy nothing.

   Hides itself on a load error instead of leaving a broken-image icon.
   The URL is stored on the master and the file lives in a different
   service, so a record can outlive its file — and a row of broken icons
   would read as a fault in the rollup rather than in the library. Not
   interactive: the header is already a <button>, and nesting a link
   inside it is invalid and steals the row's own click. */
function SlaThumb({ image }) {
    const [failed, setFailed] = useState(false);
    if (!image?.url || failed) return null;
    const label = image.caption || image.name || "";
    return (
        <img
            src={image.url}
            alt={label || "SLA reference image"}
            title={label ? `${label} — from the SLA Library` : "Reference image from the SLA Library"}
            onError={() => setFailed(true)}
            loading="lazy"
            style={{
                width: 34, height: 34, flex: "0 0 auto",
                objectFit: "cover", borderRadius: 6, background: "#fff",
                border: "1px solid var(--uidai-pmis-border)",
            }}
        />
    );
}

function SlaGroup({ item, image, onViewImage, recheck, staffing, defaultOpen, targetRows, onSaveDraft, onClearDraft }) {
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
            {/* The toggle and "View SLA" are SIBLINGS, not nested. The header
                used to be one full-width <button>; a second button inside it
                would be invalid markup and its click would also toggle the
                row. So the strip is a flex row and each control owns its own
                hit area. */}
            <div style={{
                display: "flex", alignItems: "stretch", gap: 8,
                background: costing ? "#fdf4f2" : "#f6f9fd",
            }}>
            <button
                type="button"
                onClick={() => setOpen((o) => !o)}
                style={{
                    flex: "1 1 auto", minWidth: 0,
                    textAlign: "left", border: "none", font: "inherit", cursor: "pointer",
                    background: "transparent", padding: "11px 14px",
                    display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap",
                }}
            >
                <span style={{ transition: "transform .15s ease", transform: open ? "rotate(90deg)" : "none", ...muted, fontSize: 11 }}>▶</span>

                <SlaThumb image={image} />

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
                            title="Severity above the configured ceiling was capped before scoring"
                        >
                            SLA cap ×{item.capHits}
                        </span>
                    )}
                </span>

                {/* Deliverable SLAs are charged in rupees on each deliverable's own
                    cost, so a percentage headline would be comparing unlike bases.
                    Points-scored SLAs lead with points; the linear PQP one (SLA
                    003) has no points, so it leads with the delay that drove it. */}
                <span style={{ marginLeft: "auto", display: "flex", gap: 18, alignItems: "center", flexWrap: "wrap" }}>
                    {/* Every type shows its cap the same way — what was scored,
                        what survived the ceiling, and which clause imposed it.
                        A type the RFP sets no ceiling for says so outright
                        instead of showing a bare figure that reads as
                        "nobody checked". */}
                    {isDeliverable ? (
                        <>
                            <Metric label="Deliverables" value={num(item.occurrences.length, 0)} />
                            <Metric
                                label="Highest LD %"
                                wide
                                value={<CapPair before={item.maxLdPercent} after={item.maxLdPercent} compact />}
                                flag={item.capHits > 0}
                                flagTitle={`Severity was capped to level ${item.severityCapLevel} on ${item.capHits} `
                                    + `reporting interval(s). The cap does not change the amount charged.`}
                            />
                            <Metric label="Penalty amount" value={money(item.totalLdAmount)} accent={costing ? RED : GREEN} />
                        </>
                    ) : (
                        <>
                            {isPoints ? (
                                <Metric
                                    label="Points"
                                    wide
                                    value={
                                        <CapPair
                                            before={item.accumulatedPoints}
                                            after={item.pointsCapped
                                                ? item.accumulatedPoints - item.excessPoints
                                                : item.accumulatedPoints}
                                            format={(v) => num(v, 0)}
                                            noCapClause={null}
                                            compact
                                        />
                                    }
                                    flag={item.capHits > 0}
                                    flagTitle={`Severity was capped on ${item.capHits} measurement(s) before these points were scored`}
                                />
                            ) : (
                                <Metric label="Delay" value={`${num(item.totalDelayDays, 0)}d`} />
                            )}
                            {/* The band table IS this SLA's ceiling, so the LD % is
                                already post-cap. Points past the top threshold buy
                                nothing, which is what the pair above shows. */}
                            <Metric
                                label="LD %"
                                wide
                                value={
                                    <CapPair
                                        before={item.ldPercent}
                                        after={item.ldPercent}
                                        noCapClause={item.pointsCapped ? "at top band" : isPoints ? "within band" : "no cap"}
                                        compact
                                    />
                                }
                                accent={costing ? RED : GREEN}
                            />
                        </>
                    )}
                </span>
            </button>

            {image?.url && (
                <button
                    type="button"
                    className="uidai-pmis-btn uidai-pmis-btn-cancel uidai-pmis-btn-small"
                    onClick={() => onViewImage?.({ slaRef: item.slaRef, slaTitle: item.slaTitle, image })}
                    title="Show this SLA's reference image from the SLA Library"
                    style={{
                        alignSelf: "center", marginRight: 12, marginTop: 0,
                        flex: "0 0 auto", whiteSpace: "nowrap",
                    }}
                >
                    View SLA
                </button>
            )}
            </div>

            {open && (
                <div style={{ padding: "12px 14px" }}>
                    <StaffingNote staffing={staffing} />
                    <RecheckNote recheck={recheck} />
                    {/* How this SLA reached its number, in the RFP's own terms. */}
                    <div style={{ fontSize: 12, ...muted, marginBottom: 10, lineHeight: 1.6 }}>
                        {isDeliverable ? (
                            <>
                                Charged per deliverable on <b style={{ color: INK }}>that deliverable&rsquo;s own cost</b>,
                                not on PQP — so the amounts below add up but the percentages do not, and the
                                quarter&rsquo;s {"≤"}10% PQP ceiling does not apply here.
                                {item.unpricedCount > 0 && (
                                    <> <span style={{ color: AMBER }}>{item.unpricedCount} occurrence
                                        {item.unpricedCount === 1 ? " has" : "s have"} no deliverable cost resolved yet.</span></>
                                )}
                                {item.capHits > 0 && (
                                    <> <span style={{ color: AMBER }}>
                                        Severity was capped to level {item.severityCapLevel} on {item.capHits}{" "}
                                        reporting interval{item.capHits === 1 ? "" : "s"} — the amount charged is unchanged.
                                    </span></>
                                )}
                            </>
                        ) : isPoints ? (
                            <>
                                {item.scoredCount} scored occurrence{item.scoredCount === 1 ? "" : "s"} accumulated{" "}
                                <b style={{ color: INK }}>{num(item.accumulatedPoints, 0)} points</b>
                                {item.band ? (
                                    <>
                                        , which falls in band <b style={{ color: INK }}>{item.band.label}</b> (threshold{" "}
                                        {num(item.band.points_threshold, 0)}) → <b style={{ color: costing ? RED : GREEN }}>{pct(item.ldPercent)}</b> of PQP.
                                        {item.pointsCapped && (
                                            <> The top band is the per-SLA ceiling, so the extra{" "}
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
                                Escalates linearly with delay rather than through severity points:{" "}
                                <b style={{ color: INK }}>{num(item.totalDelayDays, 0)} days</b> across{" "}
                                {item.scoredCount} occurrence{item.scoredCount === 1 ? "" : "s"} →{" "}
                                <b style={{ color: costing ? RED : GREEN }}>{pct(item.ldPercent)}</b> of PQP.
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
                                                    <span title={`Raw severity ${o.severityLevel} capped to ${o.cappedLevel}`}>
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
    /* PQP is published per CALENDAR quarter while everything else here is
       measured from T0, so a contract quarter usually straddles two of
       them. Both are fetched and blended by day overlap — see
       `overlappingCalendarQuarters`. `pqpParts` keeps each quarter's raw
       payload so a per-quarter failure can be named rather than folded
       into one useless "PQP unavailable". */
    const [pqpParts, setPqpParts] = useState([]);
    const [pqpError, setPqpError] = useState("");
    const [mastersError, setMastersError] = useState("");
    /* The SLA library keyed by ref AND id, kept in state because the RFP
       re-check needs the target tables and cadence long after `load` has
       returned — not just to fill gaps on incoming results. */
    const [mastersByRef, setMastersByRef] = useState(() => new Map());

    /* The SLA reference image, shown full size on demand. Holds the whole
       row rather than just a URL so the dialog can caption itself with the
       ref and title without looking anything back up. */
    const [previewSla, setPreviewSla] = useState(null);
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
    // milestoneId → { complete, completedOn, code, name, … }
    const [milestoneCompletion, setMilestoneCompletion] = useState(() => new Map());
    // Kept so the workflow pass can re-index the same tree without refetching it.
    const [treeMilestones, setTreeMilestones] = useState([]);
    const [completionSource, setCompletionSource] = useState("tree");
    /* The resource deployment plan, distilled from the same project tree the
       fan-out already walks. §5.28.1.d defines F as the aggregate monthly
       payment of the resources deployed per this plan, so it gives an
       independent read on the PQP base every LD here is charged against. */
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

    /* T0 for the quarter grid: the resource phase's own start, falling
       back to the project start only when no resource-based milestone
       carries a date. See `resourcePhaseStart` — the two anchors usually
       differ by months, and using the project's start put every window
       out of step with the backend's rows. `anchorIsFallback` drives the
       note on screen, so a reader is never left to wonder which of the
       two dates the grid was built from. */
    const resourceAnchor = useMemo(
        () => resourcePhaseStart(treeMilestones),
        [treeMilestones]
    );
    const anchorDate = resourceAnchor || startDate;
    const anchorIsFallback = !resourceAnchor && !!startDate;

    const quarters = useMemo(
        () => contractQuarters(anchorDate, endDate),
        [anchorDate, endDate]
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
       of its days in each. One entry means the two align and the PQP base
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
                        /* Carried so a result can be filed into the quarter its
                           WORK falls in rather than the quarter someone
                           happened to run the evaluation in — see
                           `attributionDate`. */
                        startDate: a.startDate || "",
                        endDate: a.endDate || "",
                    };
                    activities.push(entry);
                    actIndex.set(String(a.apiId), entry);
                }
            }
            setActivityIndex(actIndex);
            // Same tree, different question: what is deployed and what it costs.
            setResourceActivities(collectResourceActivities(treeRes.value?.milestones || []));
            /* And a third: which deliverables are DONE, and when — which
               decides the quarter each one's payment falls in.

               The tree alone cannot answer it. On a live project every
               milestone reads `not_completed` and every actualEndDate is
               null, while the approval workflow has the activity closed
               months earlier; the workflow is where completion actually
               lives. So the tree is indexed first (so the section renders
               immediately) and the workflow fills it in below. */
            setTreeMilestones(treeRes.value?.milestones || []);
            setMilestoneCompletion(indexMilestoneCompletion(treeRes.value?.milestones || []));
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
                                activityStartDate: act.startDate,
                                activityEndDate: act.endDate,
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
    useEffect(() => { ensurePrintStyle(); }, []);

    /* ── when each deliverable was actually accepted ──────────────────
       Read from the approval workflow, because that is where completion
       lives: the Milestone Configuration screen's "Activity Completed on
       …" is the owner division's decision timestamp, and neither the
       activity's `status` nor its `actualEndDate` is set when that
       happens.

       Scoped to activities under NON-resource milestones — D1–D8, the
       deliverables §5.28.2 charges against. D9/D10 are resource
       milestones with twenty activities apiece and are paid per quarter
       from attendance, not per acceptance, so asking about their
       approvals would be twenty pointless requests each. */
    const deliverableActivityIds = useMemo(() => {
        const ids = [];
        for (const m of treeMilestones) {
            if (m?.isResourceBased) continue;
            for (const a of m?.activities || []) if (a?.apiId) ids.push(String(a.apiId));
        }
        return ids;
    }, [treeMilestones]);

    const deliverableActivityKey = deliverableActivityIds.join(",");

    useEffect(() => {
        if (!deliverableActivityKey) return undefined;
        const ids = deliverableActivityKey.split(",");
        let cancelled = false;

        (async () => {
            const flow = new Map();
            let cursor = 0;
            async function worker() {
                for (;;) {
                    const i = cursor++;
                    if (i >= ids.length || cancelled) return;
                    try {
                        const summary = await getActivityApprovalStatus(ids[i]);
                        const done = readActivityCompletion(summary?.data ?? summary);
                        if (done.completed) flow.set(ids[i], done);
                    } catch {
                        /* An activity with no workflow yet answers 404, which
                           is the ordinary case for one never submitted. The
                           tree's own signals still apply to it. */
                    }
                }
            }
            await Promise.all(
                Array.from({ length: Math.min(FAN_OUT_CONCURRENCY, ids.length) }, worker)
            );
            if (cancelled) return;
            setMilestoneCompletion(indexMilestoneCompletion(treeMilestones, { activityCompletion: flow }));
            setCompletionSource(flow.size > 0 ? "workflow" : "tree");
        })();

        return () => { cancelled = true; };
        // treeMilestones is what deliverableActivityKey is derived from;
        // depending on the array itself would refetch on every render.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [deliverableActivityKey]);

    /* PQP is per calendar quarter and only needed for the money line, so it
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
        setPqpError("");
        if (!projectId || !overlaps.length) { setPqpParts([]); return undefined; }

        Promise.allSettled(overlaps.map((o) => getPqp(projectId, o.key)))
            .then((settled) => {
                if (cancelled) return;
                setPqpParts(settled.map((s, i) => ({
                    ...overlaps[i],
                    data: s.status === "fulfilled" ? s.value : null,
                    error: s.status === "rejected" ? (s.reason?.message || "request failed") : "",
                })));
                const failed = settled
                    .map((s, i) => (s.status === "rejected" ? overlaps[i].key : null))
                    .filter(Boolean);
                setPqpError(failed.length ? `could not read ${failed.join(" and ")}` : "");
            });
        return () => { cancelled = true; };
        // overlapKeys, not overlaps: the array is rebuilt on every render of a
        // new period object, but only a change of quarter keys needs a refetch.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [projectId, overlapKeys]);

    /* Results falling inside the selected contract quarter, filed by the
       activity's own window rather than by the date the evaluation was run
       — see `attributionDate` for why. */
    const inQuarter = useMemo(
        () => (period ? allResults.filter((r) => withinWindow(attributionDate(r), period)) : []),
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
       cost, or PQP. That is the right split for the money and the wrong
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

    /* Two sections, not one per category. The per-category tabs split
       "the resource SLAs" from "query resolution" cleanly enough, but
       they also split the page into six places to look — and the RFP's
       own division is two: charged on a deliverable's cost, or charged
       on PQP. Categories survive as the sub-headers WITHIN each.

       The governance tool is listed under deliverables because that is
       where people look for it. It is a display move only: it still
       scores on the quarterly track, still counts into the §5.27.6
       ceiling, and its figures still reach `totals` unchanged. */
    const visibleQuarterly = useMemo(
        () => categories.filter((c) => c.track !== TRACK.DELIVERABLE && !isGovernanceCategory(c)),
        [categories]
    );
    const visibleDeliverable = useMemo(
        () => categories.filter((c) => c.track === TRACK.DELIVERABLE || isGovernanceCategory(c)),
        [categories]
    );

    /* The PQP endpoint answers 200 even when it could not compute a base,
       flagging why in `status` — so an absent base has to be read off that
       field rather than off a thrown error. Only `leave_mgmt_unavailable`
       actually means the leave service is unreachable; any other status is
       reported verbatim rather than guessed at, because telling someone to
       go chase a service that is fine wastes their afternoon. */
    /* Each overlapping calendar quarter reduced to a usable base or a named
       reason it has none, then blended by day weight. A part that answered
       200 with a non-ok status is NOT usable — that is the whole point of
       checking `status` rather than trusting the absence of a throw. */
    const pqpBlend = useMemo(() => {
        const values = {};
        for (const p of pqpParts) {
            const ok = p.data && (!p.data.status || p.data.status === "ok");
            if (ok) values[p.key] = p.data.pqp;
        }
        return blendPqp(overlaps, values);
    }, [pqpParts, overlaps]);

    const pqpValue = pqpBlend.pqp;

    /* One line naming why there is no base, in the part's own words. A
       blend is all-or-nothing: half a base would understate every LD on
       screen while looking like a real number. */
    const pqpIssue = useMemo(() => {
        if (pqpBlend.complete) return null;
        if (!pqpParts.length) return pqpError ? `PQP call failed — ${pqpError}` : null;
        const reasons = pqpParts
            .filter((p) => !(p.data && (!p.data.status || p.data.status === "ok")))
            .map((p) => {
                if (p.error) return `${p.key}: ${p.error}`;
                if (p.data?.status === "leave_mgmt_unavailable") {
                    return `${p.key}: leave-management unreachable, so F could not be computed`;
                }
                /* Not an outage: the quarter priced out at zero because no
                   resource is deployed in it (perMonth comes back empty).
                   Deliberately NOT usable as a base — a PQP of 0 would make
                   the §5.27.6 ceiling 10% x 0 = 0 and silently cap every LD
                   in the quarter down to nothing. */
                if (p.data?.status === "no_resources") {
                    return `${p.key}: no resource deployed in the quarter, so PQP is nil`;
                }
                return `${p.key}: status ${p.data?.status ?? "no data"}`;
            });
        return reasons.length ? reasons.join(" · ") : null;
    }, [pqpBlend.complete, pqpParts, pqpError]);

    const totals = useMemo(
        () => quarterTotals(quarterlyItems, { pqp: pqpValue }),
        [quarterlyItems, pqpValue]
    );

    /* ── F from the resource deployment plan (§5.28.1.d) ──────────────
       The plan is scoped to the CONTRACT quarter, so the endpoint's F has
       to be blended across the same calendar quarters and by the same day
       weights as PQP itself — otherwise the two sides would be describing
       different windows and any difference between them would say nothing. */
    const plan = useMemo(
        () => deriveQuarterlyResourcePlan(resourceActivities, period),
        [resourceActivities, period]
    );

    const endpointF = useMemo(() => {
        const values = {};
        for (const p of pqpParts) {
            const ok = p.data && (!p.data.status || p.data.status === "ok");
            if (ok) values[p.key] = p.data.fAmount;
        }
        return blendPqp(overlaps, values).pqp;
    }, [pqpParts, overlaps]);

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
       The settled row for THIS quarter.

       Settlement rows are now anchored the same way this page is —
       fiscalYear is the 1-based CONTRACT year and quarter is 1..4 within
       it — so a row can be matched to the selected contract quarter
       directly. Rows from an UNDATED project are still calendar-keyed, and
       those can only be paired when the contract quarter happens to
       coincide with a calendar one; pairing a straddling window with one
       of them would attribute the wrong money to it. */
    const settlementRow = useMemo(() => {
        /* The backend's answer for a date inside this contract quarter wins:
           it resolved the window itself, so there is nothing left to guess.
           The keyed lookups below are the fallback for when that call has
           not landed, or 404'd because the quarter is not closed yet. */
        if (contractSettlement) return contractSettlement;

        // Contract-anchored rows: match the selected contract quarter outright.
        if (period) {
            const anchored = settlements.find(
                (r) => isContractYear(r.fiscalYear)
                    && Number(r.fiscalYear) === Number(period.year)
                    && Number(r.quarter) === Number(period.quarter)
            );
            if (anchored) return anchored;
        }

        // Calendar-keyed rows (undated project): only when the windows align.
        if (!alignedQuarterKey) return null;
        const [y, q] = alignedQuarterKey.split("-Q");
        return settlements.find(
            (r) => Number(r.fiscalYear) === Number(y) && Number(r.quarter) === Number(q)
        ) || null;
    }, [contractSettlement, settlements, alignedQuarterKey, period]);

    /* PA only exists once a quarter has been settled — it is the actual
       deployment payable, computed from attendance. Everything else the
       chain needs, this page already has, so an unsettled quarter still
       shows F, QGR, PQP and LD and simply names PA as pending. */
    /* A quarter the backend has priced. `blocked_*` rows are deliberately
       excluded: the backend created them but could not compute them, so
       their nulls are missing data rather than a settled figure, and
       rendering them would replace a computable estimate with a blank. */
    const settlementSettled = !!settlementRow
        && !String(settlementRow.status || "").toLowerCase().startsWith("blocked");

    const chain = useMemo(() => buildSettlementChain({
        fAmount: settlementRow?.fAmount ?? endpointF,
        qgrAmount: settlementRow?.qgrAmount ?? pqpParts.find((p) => p.data?.qgrAmount != null)?.data?.qgrAmount,
        pqp: settlementRow?.pqp ?? pqpValue,
        sumLdPercent: settlementRow?.sumLdPercent ?? totals.sumLdPercent,
        cappedLdPercent: settlementRow?.cappedLdPercent,
        quarterCapPercent: totals.quarterCapPercent,
        paAmount: settlementRow?.paAmount,
        // Closed quarter → render what was invoiced, don't re-derive it.
        statedLdAmount: settlementRow?.ldAmount,
        statedAqpAmount: settlementRow?.aqpAmount,
        settled: settlementSettled,
    }), [settlementRow, settlementSettled, endpointF, pqpParts, pqpValue,
        totals.sumLdPercent, totals.quarterCapPercent]);

    /* The "which AQP formula did the backend apply" check lived here and
       rendered inside the settlement-chain section. That section is gone —
       the chain is keyed by calendar quarter and this page measures
       contract quarters — so the check has nowhere to report to.
       `verifyAqp` stays in settlementChain.js for the Settlement & LD page,
       which is keyed the same way the backend is. */

    /* ── QGR, and where this quarter's instalment sits ────────────────
       §5.23.2 guarantees 35% of the Phase-1 fixed + one-time cost, paid as
       equal instalments across the Phase 2/3 quarters. The PQP endpoint
       carries that basis; the field names are read from a candidate list
       because the services do not agree on casing or on which spelling of
       "instal(l)ment" to use.

       Anything the payload does not carry is derived only where the
       arithmetic is exact — count from total ÷ per-quarter, total from
       per-quarter × count — and left null otherwise. An instalment number
       is never invented: "3 of 10" that is actually 4 of 12 is worse than
       no instalment line at all. */
    const qgr = useMemo(() => {
        const sources = [...pqpParts.map((p) => p.data), contractSettlement].filter(Boolean);

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
    }, [pqpParts, contractSettlement, settlements]);

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
        const pqp = Number(chain.pqp);
        return {
            scoredPercent: Number.isFinite(scored) ? scored : null,
            effectivePercent: hasStored ? stored : (Number.isFinite(scored) ? scored : null),
            grantedPercent: granted,
            grantedAmount: granted > 0 && Number.isFinite(pqp) ? (granted / 100) * pqp : null,
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
    }, [totals.sumLdPercent, settlementRow, chain.pqp, contractSettlementError]);

    /* ── does that settlement row actually cover this quarter? ────────
       The rows carry `quarterStart` / `quarterEnd`. Those are now anchored
       to the project's start date, so on a dated project they should equal
       this contract quarter's own window exactly and `matches` comes back
       true. Two cases still make them differ: an UNDATED project, where
       the backend falls back to calendar quarters (2026-Q3 = 01 Jul → 30
       Sep, against a Y1-Q3 of 10 May → 09 Aug), and a service that has not
       taken the anchoring deploy yet.

       So the check stays, and is checked rather than assumed, because the
       failure is silent: every figure would look plausible while belonging
       to a different quarter. The dates are compared directly; nothing is
       inferred from the key. */
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
            /* "Y1-Q3" on an anchored project, "2026-Q3" on an undated one —
               fiscalYear carries the contract year in the first case. */
            key: formatQuarterKey(settlementRow.fiscalYear, settlementRow.quarter),
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

    /* Which basis the finance page is keeping its money on. Read off the
       payload rather than assumed: this contract follows the RFP's
       "compute without tax, tax once at the invoice", but another project
       may hold tax-inclusive values, or a different rate, or an older
       payload with no split at all. */
    const financeBasis = useMemo(() => detectFinanceBasis(paymentPage), [paymentPage]);

    /* §5.26.2 — 1.25 × contract value. The payment page is already loaded
       for the deliverable report and carries the contract value on its
       totals, so no extra call.

       Measured against the PRE-TAX contract value when the page returns
       one. AQP is tax-exclusive (§5.27.6), so comparing it with the
       tax-inclusive total understates usage by the entire tax component —
       on an 18% contract, 40% of the ceiling reads as 33.9%. */
    const ceilingBase = useMemo(() => ceilingBaseFor(financeBasis), [financeBasis]);
    const ceiling = useMemo(
        () => contractCeiling(ceilingBase.value, cumulative.totalAqp),
        [ceilingBase.value, cumulative.totalAqp]
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
        /* Σ ONE LD % per SLA, pre-cap — the same basis as `sumLdPercent`
           here. It used to sum per MAPPING, counting an SLA once for every
           activity it was mapped to, which made the totals differ by the
           mapping count and turned this comparison into noise. Now they
           are like for like, so a divergence means something real. */
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
        /* No capPercent: §5.27.6's ceiling is on the QUARTER's cumulative
           total, not on any single deliverable. Applied once, in
           `combinedCap`, after both tracks are summed. */
        () => buildDeliverablePayables({ deliverableItems, paymentPage, activityIndex }),
        [deliverableItems, paymentPage, activityIndex]
    );

    /* ── this quarter's deliverable payment (statement section A) ─────
       Deliberately NOT the payable report above. That one answers "every
       deliverable an SLA touched, and what it would net" — a project-wide
       view. An invoice is narrower: only what COMPLETED inside this
       quarter, priced pre-tax, with LD charged on the LD basis and
       deducted from the payment.

       A deliverable still open is not payable however much LD it has
       accrued, so it is listed separately rather than counted or
       hidden. */
    const ldByMilestone = useMemo(() => {
        const m = new Map();
        for (const r of payables.rows) m.set(String(r.milestoneId), r);
        return m;
    }, [payables.rows]);

    const quarterPayment = useMemo(() => buildQuarterDeliverablePayment({
        paymentPage,
        milestoneCompletion,
        ldByMilestone,
        period,
    }), [paymentPage, milestoneCompletion, ldByMilestone, period]);

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
       charged on a deliverable's own cost, quarterly LD on PQP — but
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
        /* This quarter's completed deliverables, PRE-TAX. The payable
           report's project-wide, tax-inclusive total used to feed this,
           which both overstated the quarter and made section C add GST to
           a figure that already carried it. */
        const deliverableNet = quarterPayment.available && quarterPayment.paid.length
            ? quarterPayment.totals.net
            : null;
        const quarterlyNet = Number.isFinite(chain.aqp) ? chain.aqp : null;

        const present = [deliverableNet, quarterlyNet].filter((v) => v !== null);
        const grossDue = present.length ? present.reduce((a, b) => a + b, 0) : null;

        const pending = [];
        /* Only a deliverable COMPLETED this quarter is owed anything, so a
           quarter with none is complete rather than pending — the old check
           read "an SLA fired somewhere" and reported a quarter as unfinished
           because a deliverable in a different one had a penalty. */
        /* Naming the CAUSE, not just the gap. "the quarterly resource
           payment pending" sends a reader hunting through resource data
           that is usually fine — the payment is missing because PQP had
           no usable base, and `pqpIssue` already knows why (leave
           management unreachable, no resources deployed, and so on). */
        if (quarterlyItems.length > 0 && quarterlyNet === null) {
            pending.push(pqpIssue
                ? `the quarterly resource payment (${pqpIssue})`
                : "the quarterly resource payment");
        }

        /* What the SLAs took off, across BOTH regimes. They are computed
           separately and never mixed — one on a deliverable's own cost, one
           on PQP — but a reader asking "what did service levels cost us
           this quarter" wants the one figure, and it is only ever presented
           as a total, never fed back into either regime's arithmetic. */
        const ldParts = [quarterPayment.totals.ldAmount, chain.ldAmount]
            .filter((v) => Number.isFinite(v));
        const totalLd = ldParts.reduce((a, b) => a + b, 0);

        return {
            deliverableNet,
            quarterlyNet,
            grossDue,
            totalLd,
            pending,
            complete: pending.length === 0 && grossDue !== null,
            /* GST now lands on a genuinely pre-tax base on both sides:
               section A is the pre-tax net of this quarter's deliverables,
               section B is tax-exclusive by §5.27.6. */
            tax: taxBreakdown(grossDue),
        };
    }, [quarterPayment, chain.aqp, chain.ldAmount, quarterlyItems.length, pqpIssue]);

    /* ── does this page agree with Finance about tax? ─────────────────
       The rollup draws from two services that keep money on different
       bases: the payment page returns each term pre-tax AND post-tax,
       while the contracts service keeps PQP, PA, LD and AQP exclusive of
       tax (§5.27.6) and taxes once at the invoice (§5.28.1.e).

       That is fine as long as nothing compares across the line. This
       memo checks the places that do — and reports rather than corrects,
       because which basis a project uses is a contract fact, not
       something a screen should decide on its behalf. */
    const taxCheck = useMemo(() => reconcileTaxBasis({
        finance: financeBasis,
        payables,
        statement,
        cumulative,
        expectedGstPercent: statement?.tax?.gstPercent,
    }), [financeBasis, payables, statement, cumulative]);

    /* The payment page publishes `slaLdDeductions` — the settlement rows
       themselves, on contract quarters. Both sides derive from the same
       evaluations, so every figure should match to the rupee; anything
       that does not means one of them applied a rule the other did not.

       This is the reconciliation proper. The tax checks above are about
       which BASIS a figure is on; these are about whether the two screens
       agree on the figure at all. */
    const financeDeductions = useMemo(() => reconcileSlaDeductions({
        paymentPage,
        period,
        totals,
        chain,
        quarterlyNet: statement?.quarterlyNet,
    }), [paymentPage, period, totals, chain, statement?.quarterlyNet]);

    /* Occurrences that were evaluated but never read.

       Resource SLAs 005–009 are now scored by the backend on activity
       completion, so this list should normally be EMPTY. A row landing
       here means that SLA genuinely could not be scored — worth chasing
       rather than the expected state it used to be.

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
    /* Unplaceable, not merely undated: a result with no evaluation date is
       still filed correctly if its activity has a window, so only a result
       with neither falls outside every quarter. */
    const undated = allResults.filter((r) => !attributionDate(r)).length;


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
        /* The grid was built from the wrong anchor. Not blocking — the
           windows are still three months long and the arithmetic inside
           each is sound — but every one of them is shifted, so a quarter
           here may not be the quarter the backend priced. */
        if (anchorIsFallback) {
            add("warn", "Quarters are anchored on the project start, not the resource phase",
                `No resource-based milestone carries a start date, so the grid falls back to the project's own start `
                + `(${startDate}). The backend anchors on the earliest resource-based milestone, so its settlement rows `
                + `may describe different windows than the ones shown here. Set a start date on the resource-based `
                + `milestone to align them.`);
        }
        /* A row priced on the deleted NPQP base. Its LD is overstated and
           this page cannot correct it — the invoice followed the row. */
        if (chain.staleNpqpBase) {
            add("blocking", "This quarter was priced on the old NPQP base",
                `The settlement row's base matches F + QGR (${money(chain.npqpReference)}) rather than F `
                + `(${money(chain.f)}). LD was charged on guaranteed revenue, which the corrigendum removed, so the `
                + `deduction is overstated. The row has to be re-closed by the backend — recomputing it here would only `
                + `make this page disagree with the invoice.`);
        }
        if (undated > 0) {
            add("info", `${undated} result(s) cannot be placed in a quarter`,
                "Their activity carries no start or end date and they have no evaluation date either, "
                + "so there is nothing to file them by and no quarter counts them.");
        }
        if (awaitingObservation > 0) {
            out.push({
                level: "blocking",
                title: `${awaitingObservation} SLA result(s) could not be scored`,
                detail: "The evaluation ran and created these rows, but the backend returned no reading for them. "
                    + "Resource SLAs 005–009 are now scored automatically when the activity completes, so this is "
                    + "no longer the expected state — a row sitting here points at something that actually failed "
                    + "to evaluate. Until it is resolved these score nothing, and this quarter is understated "
                    + "rather than clean.",
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
        overlaps.length, aggregateError, undated, mastersIncomplete, awaitingObservation, awaiting.activities, projectId,
        anchorIsFallback, startDate, chain.staleNpqpBase, chain.npqpReference, chain.f]);

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
        <div id={PAGE_PRINT_ROOT_ID} className="uidai-pmis-card" style={{ marginBottom: 0, width: "100%" }}>
            {/* ── header + period pickers ───────────────────────────── */}
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", flexWrap: "wrap", gap: 12 }}>
                <div>
                    <div style={{ fontSize: 16, fontWeight: 800, color: INK }}>SLA Rollup by Quarter</div>
                    {/* The pickers are dropped from the printed copy, so the
                        quarter they were set to has to be stated instead —
                        otherwise the sheet does not say what it covers. */}
                    <div className="sla-print-only" style={{ display: "none", fontSize: 12, ...muted, marginTop: 4 }}>
                        {period
                            ? `${period.key} · ${longDate(period.start)} to ${longDate(period.end)}`
                            : "No quarter selected"}
                    </div>
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
                    <button
                        type="button"
                        className="uidai-pmis-btn uidai-pmis-btn-small"
                        style={{ marginTop: 0 }}
                        onClick={printWholePage}
                        disabled={loading || !period}
                        title="Opens the print dialog with the whole rollup — every section, top to bottom. Choose 'Save as PDF' for a filed copy. Collapsed rows print collapsed."
                    >
                        ⭳ Download / print full page
                    </button>
                </div>
            </div>

            {/* ══ SECTION 1 · the window everything below is measured over ══ */}
            {period && (
                <PageSection
                    index="1"
                    title="Reporting interval"
                    sub="The contract quarter every figure below is measured over."
                >
                    <PeriodStrip period={period} />
                </PageSection>
            )}

            {/* Only assert a missing T0 once the tree has actually answered —
                before that an empty prop means "not loaded", not "not set". */}
            {loadedOnce && !quarters.length && (
                <Banner
                    kind="error"
                    text={
                        "Contract quarters are measured from the resource phase's start date, and this project has none" +
                        (anchorDate ? ` — "${anchorDate}" could not be read as a date.` : ".") +
                        " Set a start date on a resource-based milestone (or on the project) to use this view."
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
                        ldPercent={chain.cappedLdPercent ?? totals.cappedLdPercent}
                        /* The chain, not `totals` — on a settled quarter it
                           carries the invoiced figure, and on an open one it
                           falls back to exactly what `totals` computed. */
                        ldAmount={chain.ldAmount ?? totals.ldAmount}
                        deliverableLd={dTotals.totalLdAmount}
                        finalPayment={statement.tax.net}
                        pending={statement.pending}
                        settled={settlementSettled}
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
                            {/* ══ SECTION 2 · the SLA breakup ══════════════════════
                                Two sub-sections inside it, matching the RFP's two
                                charging bases: on a deliverable's own cost, or on
                                PQP. Categories group the SLAs within each. */}
                            <PageSection
                                index="2"
                                title="Service levels this quarter"
                                sub="What each SLA scored, and what it cost. Grouped by how the penalty is charged."
                                right={
                                    <button
                                        type="button"
                                        className="uidai-pmis-btn uidai-pmis-btn-cancel uidai-pmis-btn-small"
                                        style={{ marginTop: 0 }}
                                        onClick={() => setExpandAll((v) => !v)}
                                    >
                                        {expandAll ? "Collapse all" : "Expand all"}
                                    </button>
                                }
                            >
                            {(
                            <>
                            <SectionHead
                                track="quarterly"
                                title="Quarterly SLAs"
                                count={visibleQuarterly.reduce((n, c) => n + c.items.length, 0)}
                                sub="Charged as a % of the quarter's payment base. Resources, query resolution, recommendations."
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
                                            label="Penalty % before → after"
                                            value={<CapPair
                                                before={totals.sumLdPercent}
                                                after={totals.cappedLdPercent}
                                                noCapClause={`under the ${totals.quarterCapPercent}% ceiling`}
                                            />}
                                            accent={RED}
                                            hint={totals.capApplied
                                                ? `the ${totals.quarterCapPercent}% quarter ceiling bit`
                                                : `ceiling ${totals.quarterCapPercent}% of PQP`}
                                        />
                                        <Tile
                                            label="PQP"
                                            value={money(totals.pqp)}
                                            hint={pqpIssue
                                                || (fCheck.diverges
                                                    ? `⚠ F differs from the deployment plan by ${Math.round(fCheck.percent * 100) / 100}%`
                                                    : pqpBlend.exact
                                                        ? `calendar ${overlaps[0]?.key} · exact`
                                                        : `blended across ${overlaps.map((o) => o.key).join(" + ")}`)}
                                            accent={pqpIssue || fCheck.diverges ? AMBER : undefined}
                                        />
                                        <Tile
                                            label="Penalty amount"
                                            value={money(chain.ldAmount ?? totals.ldAmount)}
                                            accent={RED}
                                            hint={chain.ldSource === "row"
                                                ? (chain.ldDiverges
                                                    ? `⚠ as settled — this page computes ${money(chain.ldComputed)}`
                                                    : "as settled by the backend")
                                                : totals.pqp === null ? "needs a PQP base" : "capped LD % × PQP"}
                                        />
                                    </div>
                                    {/* Grouped under their own category rather than run
                                        together: resource deployment and query resolution
                                        are both quarterly and both charged on PQP, and
                                        that is the only thing they have in common. */}
                                    {visibleQuarterly.map((cat) => (
                                        <CategoryBlock
                                            key={`${cat.code}:${expandAll}`}
                                            cat={cat}
                                            accent={categoryDot(categories.indexOf(cat))}
                                            defaultOpen={expandAll}
                                        >
                                            {cat.items.map((it) => (
                                                <SlaGroup
                                                    key={`q:${it.slaRef}:${expandAll}`}
                                                    item={it}
                                                    image={mastersByRef.get(String(it.slaRef))?.image}
                                                    onViewImage={setPreviewSla}
                                                    recheck={rechecks.get(String(it.slaRef))}
                                                    staffing={isResourceDeploymentSla(it) ? staffing : null}
                                                    defaultOpen={expandAll}
                                                    targetRows={mastersByRef.get(String(it.slaRef))?.targetRows}
                                                    onSaveDraft={saveObservationDraft}
                                                    onClearDraft={clearObservationDraft}
                                                />
                                            ))}
                                        </CategoryBlock>
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

                            {/* ══ PQP base — the resource deployment plan ═════════
                                Every LD % above is a percentage of PQP, and
                                PQP = F. §5.28.1.d(c) defines F as the aggregate
                                monthly payment of all resources to be deployed as per
                                the resource deployment plan — which is exactly what the
                                activities' allocation rows hold. Summing them gives F
                                independently of the PQP endpoint, so the base the whole
                                page charges against becomes checkable. */}
                            {(plan.activityCount > 0 || fCheck.comparable) && (
                                <>
                                    <SectionHead
                                        title="The payment base"
                                        count={plan.activityCount}
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
                                                : "after leave adjustment"}
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
                                                `The deployment plan and the PQP endpoint disagree about F for this quarter by `
                                                + `${formatINR(Math.abs(fCheck.difference))} (${Math.round(fCheck.percent * 100) / 100}%). `
                                                + `Every LD amount above is a percentage of PQP, which IS F, so this moves all of them `
                                                + `one-for-one.\n`
                                                + (fCheck.planHigher
                                                    ? `The plan is HIGHER. Usually an approved resource that was never onboarded, or unpaid `
                                                      + `leave: MP = R(1 − L/N), so leave beyond the 6 permissible days per `
                                                      + `quarter reduces the endpoint's F below the plan.`
                                                    : `The endpoint is HIGHER than the plan. That is the unusual direction — the plan may be `
                                                      + `missing allocations, or resources are being paid for outside the deployment plan `
                                                      + `(CCN resources, which are included in F, are the common cause).`)
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
                                        The two are expected to differ slightly &mdash; attendance applies the leave formula&rsquo;s{" "}
                                        <b>MP = R(1 &minus; L/N)</b> for leave beyond the 6 permissible days. PQP uses the
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
                                        clause="SLA 007"
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
                                in rupees and kept out of the PQP ceiling entirely. */}
                            {(
                            <>
                            {/* A rule as well as the gap: the quarterly track ends in
                                its own tiles and tables, so without a hard break the
                                deliverable banner reads as one more block inside it. */}
                            <div style={{ borderTop: "1px solid var(--uidai-pmis-border)", marginTop: 30 }} />
                            <SectionHead
                                track="deliverable"
                                title="Deliverable-linked SLAs"
                                count={visibleDeliverable.reduce((n, c) => n + c.items.length, 0)}
                                sub="Charged on the deliverable's own cost — no per-deliverable ceiling. Submission, defect rectification, governance tool."
                                style={{ marginTop: 22 }}
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
                                        <CategoryBlock
                                            key={`${cat.code}:${expandAll}`}
                                            cat={cat}
                                            accent={categoryDot(categories.indexOf(cat))}
                                            defaultOpen={expandAll}
                                        >
                                            {cat.items.map((it) => (
                                                <SlaGroup
                                                    key={`d:${it.slaRef}:${expandAll}`}
                                                    item={it}
                                                    image={mastersByRef.get(String(it.slaRef))?.image}
                                                    onViewImage={setPreviewSla}
                                                    recheck={rechecks.get(String(it.slaRef))}
                                                    defaultOpen={expandAll}
                                                    targetRows={mastersByRef.get(String(it.slaRef))?.targetRows}
                                                    onSaveDraft={saveObservationDraft}
                                                    onClearDraft={clearObservationDraft}
                                                />
                                            ))}
                                        </CategoryBlock>
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
                            {(
                            <>
                                    <SectionHead
                                        title="Deliverable payment"
                                        count={payables.rows.length}
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
                                                <Tile
                                                    label="LD base"
                                                    value={money(payables.totals.totalLdBase)}
                                                    hint={payables.totals.legacyBaseCount
                                                        ? `pre-tax · ${payables.totals.legacyBaseCount} row(s) still post-tax`
                                                        : "pre-tax, one-time excluded"}
                                                />
                                                <Tile
                                                    label="LD deducted"
                                                    value={money(payables.totals.totalLdAmount)}
                                                    accent={RED}
                                                    hint={`charged per deliverable · the ${QUARTER_LD_CAP_PERCENT}% ceiling `
                                                        + "acts on the quarter's total"}
                                                />
                                                <Tile label="Net payable" value={money(payables.totals.totalNetPayable)} accent={GREEN} hint={`paid ${money(payables.totals.totalPayment)} − LD`} />
                                            </div>

                                            <div className="uidai-pmis-table-wrap" style={{ marginTop: 12, overflowX: "auto" }}>
                                                <table className="uidai-pmis-table uidai-pmis-table-compact" style={{ minWidth: 940, marginTop: 0 }}>
                                                    <thead>
                                                        <tr>
                                                            <th>Deliverable</th>
                                                            <th>SLAs applied</th>
                                                            <th style={{ textAlign: "right" }}>LD base (pre-tax)</th>
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
                                                                activityDates={milestoneCompletion.get(String(row.milestoneId))?.activities}
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
                                                `Settled payments (${formatINR(ceiling.paid)}) have passed the contract ceiling of `
                                                + `${formatINR(ceiling.ceiling)} — ${ceiling.multiplier}× the contract value of `
                                                + `${formatINR(ceiling.contractValue)}. No further payment is permitted under the contract `
                                                + `without a variation.`
                                            }
                                        />
                                    )}
                                    {ceiling.intoCcn && (
                                        <div style={{ fontSize: 11.5, color: AMBER, marginTop: 8, fontWeight: 600, lineHeight: 1.6 }}>
                                            ⚠ Settled payments have passed the base contract value ({money(ceiling.contractValue)})
                                            and are now drawing on the 25% CCN headroom. Permitted, but the headroom is
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
                                the reasoning that Phase 1 has no PQP for a 10% of it to
                                bite on. That holds only while the phases do not overlap
                                — which is exactly what a quarter charging on both tracks
                                means. Reported rather than resolved: which reading
                                applies is a contract question, not a code one. */}
                            {/* ── the quarter's only LD ceiling (§5.27.6) ──
                                One cap, over both tracks, on the quarter's
                                cumulative LD. Shown whenever any LD was charged
                                — a ceiling that held is as much a result as one
                                that bit, and an auditor needs to see it was
                                tested rather than assume it. */}
                            {combinedCap.applies && (
                                <div style={{
                                    marginTop: 20,
                                    background: combinedCap.capApplied ? "#fdf4f2"
                                        : combinedCap.unvalued ? "#fffaf0" : "#f2f9f4",
                                    border: `1px solid ${combinedCap.capApplied ? "#f0c9c2"
                                        : combinedCap.unvalued ? "#f0dfc0" : "#cfe6d8"}`,
                                    borderRadius: 10, padding: "12px 15px", fontSize: 12,
                                    color: "#334155", lineHeight: 1.7,
                                }}>
                                    <b style={{
                                        color: combinedCap.capApplied ? RED
                                            : combinedCap.unvalued ? AMBER : GREEN,
                                    }}>
                                        {combinedCap.capApplied ? "⚠ " : combinedCap.unvalued ? "◍ " : "✓ "}
                                        The quarter&rsquo;s cumulative LD ceiling
                                        {combinedCap.capApplied ? " has been reached"
                                            : combinedCap.unvalued ? " cannot be valued"
                                                : " holds"}
                                    </b>
                                    <br />
                                    Quarterly track <b style={{ color: INK }}>{money(combinedCap.quarterlyLd)}</b>
                                    {" "}+ deliverable track <b style={{ color: INK }}>{money(combinedCap.deliverableLd)}</b>
                                    {" "}= <b style={{ color: INK }}>{money(combinedCap.combined)}</b> cumulative,
                                    before tax.
                                    {combinedCap.ceilingKnown ? (
                                        <>
                                            {" "}The ceiling is {combinedCap.capPercent}% of a PQP of{" "}
                                            <b style={{ color: INK }}>{money(combinedCap.pqp)}</b> ={" "}
                                            <b style={{ color: INK }}>{money(combinedCap.ceiling)}</b>.
                                            {combinedCap.capApplied ? (
                                                <>
                                                    {" "}The total is over by{" "}
                                                    <b style={{ color: RED }}>{money(combinedCap.excess)}</b>, so{" "}
                                                    <b style={{ color: RED }}>{money(combinedCap.chargeable)}</b> is
                                                    chargeable and the excess is not recoverable this quarter.
                                                </>
                                            ) : (
                                                <> The total is inside it, so nothing is capped.</>
                                            )}
                                        </>
                                    ) : (
                                        <>
                                            {" "}<b style={{ color: AMBER }}>No PQP is available for this quarter</b>,
                                            so 10% of it cannot be valued and the LD above stands uncapped. PQP is
                                            defined as the monthly payment of the resources in the
                                            deployment plan, which a deliverable-paid Phase-1 quarter does not have.
                                            Phase 1 is not carved out of the ceiling, so this is worth settling
                                            with the contract owner before the quarter is invoiced.
                                        </>
                                    )}
                                    <br />
                                    <span style={{ ...muted }}>
                                        The cap is cumulative: one ceiling over the quarter&rsquo;s whole LD bill.
                                        There is no per-SLA and no per-deliverable ceiling — the rule sums the
                                        percentages before applying them, and a per-milestone cap was asked for
                                        in the pre-bid queries and refused.
                                    </span>
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
                                        >
                                            <FormulaRow
                                                step="Aggregate"
                                                formula="one figure per interval, across all resources in scope"
                                                when="each measurement interval"
                                                note="All resources combine into a single measurement — not one score per resource."
                                            />
                                            <FormulaRow
                                                step="① SLA Cap"
                                                formula={`severity = min(severity, ${scale.capLevel ?? "?"})`}
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
                                                when="each measurement interval"
                                                note={scale.rows.some((r) => r.points < 0)
                                                    ? "A clean interval scores negative points, pulling the quarter's total down."
                                                    : null}
                                            />
                                            <FormulaRow
                                                step="Accumulate"
                                                formula="points = Σ points over every measurement interval"
                                                when="reporting interval"
                                                note="Summed, never averaged. M1 + M2 + M3 for a monthly SLA over a quarter."
                                            />
                                            <FormulaRow
                                                step="LD band"
                                                formula={ldBands.length
                                                    ? [...ldBands].sort((a, b) => b.points_threshold - a.points_threshold)
                                                        .map((b) => `≥${b.points_threshold}→${b.ld_percent}%`).join("  ")
                                                    : "not configured"}
                                                when="reporting interval"
                                            />
                                            <FormulaRow
                                                step="② Per-SLA cap"
                                                formula={`LD % ≤ ${topBand === null ? "?" : `${topBand}%`}  (the top band)`}
                                                when="reporting interval"
                                                note="The band table IS the ceiling — points past the top threshold earn nothing further."
                                            />
                                            <FormulaRow
                                                step="Reset"
                                                formula="points → 0"
                                                when="end of reporting interval"
                                            />
                                        </FormulaTable>

                                        {/* ── 2 · the quarter's money ─────────────── */}
                                        <FormulaTable
                                            title="2 · The quarter's money"
                                        >
                                            <FormulaRow step="MP" formula="R × (1 − L / N)" when="per resource, per month"
                                                note="L = leave beyond the 6 permissible days per quarter; N = calendar days in that month." />
                                            <FormulaRow step="PA" formula="Σ AMP over the quarter's 3 months" when="quarter"
                                                note="Payable on ACTUAL deployment. Resolved from attendance when the quarter is closed." />
                                            <FormulaRow step="F" formula="Σ monthly cost of resources in the deployment plan + CCN" when="quarter" />
                                            <FormulaRow step="QGR" formula="35% of (Phase-1 fixed + one-time) ÷ Phase 2&3 quarters" when="quarter"
                                                note="Guaranteed regardless of deployment." />
                                            <FormulaRow step="PQP" formula="F" when="quarter"
                                                note="The LD base — the quarter's resource payment. QGR is NOT inside it, so no penalty is charged on guaranteed revenue." />
                                            <FormulaRow step="Σ LD %" formula="sum of every quarterly SLA's LD %" when="quarter" />
                                            <FormulaRow
                                                step="③ Quarter cap"
                                                formula={`LD % = min(Σ LD %, ${totals.quarterCapPercent}%)`}
                                                when="quarter"
                                                note="Caps the TOTAL, never the individual SLAs — so the per-SLA figures above stay as scored."
                                            />
                                            <FormulaRow step="LD ₹" formula="capped LD % × PQP" when="quarter" />
                                            <FormulaRow step="AQP" formula="(PA − LD ₹) + QGR" when="quarter"
                                                note="QGR is added back after the deduction because it is guaranteed." />
                                            <FormulaRow
                                                step="Effective rate"
                                                formula="LD ₹ ÷ PA × 100"
                                                clause="—"
                                                when="quarter"
                                                note="Not an RFP term. Charged on planned, paid from actual — so when PA is below F the real bite exceeds the headline %."
                                            />
                                            <FormulaRow step="On the invoice" formula="X + 18%·X − 10%·X = 1.08·X" when="each invoice"
                                                note="GST added, TDS withheld, both on the invoice value. Applied after the LD deduction — LD and PQP are tax-exclusive." />
                                            <FormulaRow step="④ Contract ceiling" formula="Σ all payments ≤ 1.25 × contract value" when="whole contract"
                                                note="Contract value plus 25% CCN headroom." />
                                        </FormulaTable>

                                        {/* ── 3 · deliverable track ───────────────── */}
                                        <FormulaTable
                                            title="3 · Deliverable-linked SLAs"
                                            subtitle="no severity, no points, no per-deliverable ceiling"
                                        >
                                            <FormulaRow step="SLA 001" formula="0.5% × ⌈days / 7⌉ × that deliverable's cost" when="per deliverable"
                                                note="Non-submission. “Each week OR PART THEREOF” — the weeks round UP." />
                                            <FormulaRow step="SLA 002" formula="1% × ⌈days / 7⌉ × that deliverable's cost" when="per deliverable"
                                                note="Not accepted / defects not rectified." />
                                            <FormulaRow step="Net payable" formula="deliverable cost − LD ₹" when="per deliverable" />
                                            <FormulaRow step="Cap" formula={`Σ quarter LD ≤ ${QUARTER_LD_CAP_PERCENT}% × PQP`} when="per quarter"
                                                note="The ONLY ceiling: cumulative across both tracks, every SLA and every deliverable, pre-tax. No per-SLA or per-deliverable cap exists — the rule sums the percentages first, and a per-milestone cap was refused in the pre-bid queries. An individual deliverable may therefore exceed 10% of its own cost. Net payable can go negative and is shown as calculated." />
                                            <FormulaRow step="Not applicable" formula="resource-based SLAs do not apply in Phase 1" when="—" />
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
                                        {undated} result{undated === 1 ? " has" : "s have"} no activity dates and no
                                        evaluation date, so {undated === 1 ? "it appears" : "they appear"} in no period.
                                    </div>
                                )}
                            </div>
                            </PageSection>

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
                            <PageSection
                                index="3"
                                title="Payment statement"
                                sub="The quarter's audit record — what was earned, what was penalised, what is paid."
                                right={
                                    <button
                                        type="button"
                                        className="uidai-pmis-btn uidai-pmis-btn-small"
                                        style={{ marginTop: 0 }}
                                        onClick={() => window.print()}
                                        title="Opens the print dialog. Only the statement is printed — choose 'Save as PDF' for a filed copy."
                                    >
                                        ⭳ Download / print
                                    </button>
                                }
                            >
                            <div id={PRINT_ROOT_ID} style={{ marginTop: 16 }}>
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
                                            title="Deliverables completed this quarter"
                                            clause="before tax"
                                            first
                                        />
                                {/* Where "completed" came from. Worth stating: the
                                    milestone's own status field says not_completed on
                                    every deliverable of a live project, while the
                                    approval workflow has them closed — so a reader
                                    comparing this against the milestone list needs to
                                    know which of the two this section believes. */}
                                <div style={{ fontSize: 11, ...muted, marginBottom: 8, lineHeight: 1.6 }}>
                                    {completionSource === "workflow"
                                        ? "Completion is taken from each activity's approval workflow — the date the owner division accepted it."
                                        : "No activity approval workflow was readable, so completion falls back to the milestone status and actual end dates."}
                                </div>
                                {/* One line per deliverable, then the total —
                                    not a single "deliverable cost" figure. An
                                    audit reader has to be able to see which
                                    deliverables were paid for and what each
                                    one's penalty was, without leaving the
                                    statement. */}
                                <table style={{ borderCollapse: "collapse", width: "100%", maxWidth: 620 }}>
                                    <tbody>
                                        {quarterPayment.paid.length === 0 ? (
                                            <ChainRow
                                                label="No deliverable completed in this quarter"
                                                value="—"
                                                hint="A deliverable becomes payable in the quarter its activities finish, however late that is."
                                            />
                                        ) : (
                                            <>
                                                {/* The statement stays a money document — the
                                                    dates behind each completion live in the
                                                    Deliverable payment table above, where the
                                                    row can be expanded. */}
                                                {quarterPayment.paid.map((d) => (
                                                    <ChainRow
                                                        key={d.milestoneId}
                                                        label={`${d.code ? `${d.code} · ` : ""}${d.name || "—"}`}
                                                        clause={d.completedOn ? `completed ${longDate(d.completedOn)}` : undefined}
                                                        value={money(d.payment)}
                                                        hint={!d.paymentIsPreTax
                                                            ? "⚠ tax-inclusive — the payment page returned no pre-tax split for this milestone."
                                                            : null}
                                                    />
                                                ))}
                                                <ChainRow
                                                    label={`Deliverable cost · ${quarterPayment.paid.length} completed`}
                                                    sign="="
                                                    value={money(quarterPayment.totals.payment)}
                                                    strong
                                                    rule
                                                />

                                                {/* Each penalty on its own line, with the base it
                                                    was charged on — §5.28.2 charges on the LD
                                                    basis, which is not the payment, and a reader
                                                    checking the arithmetic needs both. */}
                                                {quarterPayment.paid.filter((d) => d.ldAmount > 0).map((d) => (
                                                    /* Σ across this deliverable's SLAs, uncapped —
                                                       §5.27.6's ceiling acts on the quarter's total
                                                       below, not on any single line here. */
                                                    <ChainRow
                                                        key={`ld-${d.milestoneId}`}
                                                        label={`LD on ${d.code || d.name}`}
                                                        clause={`${pct(Math.round(d.ldPercent * 100) / 100)} of ${money(d.ldBase)}`}
                                                        sign="−"
                                                        value={money(d.ldAmount)}
                                                        tone={RED}
                                                    />
                                                ))}
                                                <ChainRow
                                                    label="Liquidated damages"
                                                    clause={combinedCap.capApplied
                                                        ? `SLA 001 / 002 · capped at ${QUARTER_LD_CAP_PERCENT}% of PQP`
                                                        : combinedCap.unvalued
                                                            ? "SLA 001 / 002 · ceiling unvalued — no PQP"
                                                            : `SLA 001 / 002 · within the ${QUARTER_LD_CAP_PERCENT}% quarterly ceiling`}
                                                    sign="−"
                                                    value={money(quarterPayment.totals.ldAmount)}
                                                    tone={RED}
                                                    rule
                                                />
                                                <ChainRow
                                                    label="Net payable, before tax"
                                                    sign="="
                                                    value={money(quarterPayment.totals.net)}
                                                    strong
                                                    rule
                                                    hint={`Charged on the LD basis, deducted from the payment. The quarter’s cumulative LD is capped at ${QUARTER_LD_CAP_PERCENT}% of PQP; the net can still go negative.`}
                                                />
                                            </>
                                        )}
                                    </tbody>
                                </table>

                                {/* Accrued but not chargeable. Listed because the
                                    penalty is real and growing — it simply lands on
                                    the quarter the deliverable finally completes in,
                                    not this one. */}
                                {quarterPayment.accruing.length > 0 && (
                                    <div style={{
                                        marginTop: 10, padding: "10px 12px", borderRadius: 9, maxWidth: 620,
                                        background: "#fffaf0", border: "1px solid #e8d9b0",
                                    }}>
                                        <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: ".5px", textTransform: "uppercase", color: AMBER, marginBottom: 6 }}>
                                            Not yet chargeable · {quarterPayment.accruing.length} incomplete
                                        </div>
                                        <table style={{ borderCollapse: "collapse", width: "100%" }}>
                                            <tbody>
                                                {quarterPayment.accruing.map((d) => (
                                                    <ChainRow
                                                        key={`acc-${d.milestoneId}`}
                                                        label={`${d.code ? `${d.code} · ` : ""}${d.name || "—"}`}
                                                        clause={`${d.reason} · ${d.completedActivityCount}/${d.activityCount} activities`}
                                                        value={money(d.ldAmount)}
                                                        tone={AMBER}
                                                    />
                                                ))}
                                                <ChainRow
                                                    label="LD accrued so far"
                                                    value={money(quarterPayment.totals.accruingLd)}
                                                    strong
                                                    rule
                                                    tone={AMBER}
                                                    hint="Charged in whichever quarter the deliverable completes — not in this one, and not counted above."
                                                />
                                            </tbody>
                                        </table>
                                    </div>
                                )}

                                {quarterPayment.undated.length > 0 && (
                                    <div style={{ fontSize: 11, ...muted, marginTop: 8, lineHeight: 1.6, maxWidth: 620 }}>
                                        ◍ {quarterPayment.undated.length} deliverable(s) are marked complete but no
                                        activity carries an actual end date, so they cannot be placed in a quarter:{" "}
                                        {quarterPayment.undated.slice(0, 4).map((d) => d.code || d.name).join(", ")}
                                        {quarterPayment.undated.length > 4 ? ` …and ${quarterPayment.undated.length - 4} more` : ""}.
                                    </div>
                                )}

                                        {/* ── B · quarterly stream ────────────────── */}
                                        <StatementSection
                                            letter="B"
                                            title="Quarterly resource payment"
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
                                        <ChainRow label="Payment base" clause="PQP" sign="=" value={money(chain.pqp)} />
                                        <ChainRow
                                            label={relaxation.applied ? "Liquidated damages as scored" : "Liquidated damages"}
                                            clause={relaxation.applied
                                                ? `${pct(Math.round(relaxation.scoredPercent * 100) / 100)} of PQP`
                                                : `${pct(chain.cappedLdPercent)} of PQP`}
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
                                            the PQP payload or derived by exact division —
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
                                                    Paid whatever the deployment. It sits inside PQP so LD is charged on it,
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
                                            sign="="
                                            value={money(statement.tax.net)}
                                            strong
                                            rule
                                            tone={GREEN}
                                            hint="Tax applies after the LD deduction."
                                        />
                                    </tbody>
                                </table>

                                {/* The cross-check below is the detail; this is the
                                    pointer, because the figure it affects is the one
                                    directly above it and a reader who stops here
                                    would otherwise take it as final. */}
                                {taxCheck.checks.some((c) => c.id === "mixed-basis-invoice" && c.severity === SEVERITY.ERROR) && (
                                    <div style={{ fontSize: 11.5, color: RED, fontWeight: 600, marginTop: 8, lineHeight: 1.6, maxWidth: 620 }}>
                                        ✕ GST here is applied to two figures kept on different tax bases &mdash; see the
                                        cross-check below before invoicing this.
                                    </div>
                                )}

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

                                {/* ══ CROSS-CHECK AGAINST FINANCE ══════════
                                    The statement above draws from two services
                                    that keep money on different sides of the
                                    tax line: the payment page returns each term
                                    pre-tax and post-tax, the contracts service
                                    keeps PQP / PA / LD / AQP tax-exclusive
                                    (§5.27.6) and taxes once at the invoice.

                                    Fine until something compares across that
                                    line — and when it does, the error is the
                                    whole tax rate, which is far too large to
                                    find by eye. Reported, never silently
                                    corrected: which basis a project uses is a
                                    contract fact, not a screen's decision. */}
                                {SHOW_FINANCE_CROSSCHECK && taxCheck.checked && taxCheck.checks.length > 0 && (
                                    <div style={{ marginTop: 18 }}>
                                        <div style={{
                                            display: "flex", alignItems: "center", gap: 9, flexWrap: "wrap",
                                            marginBottom: 10,
                                        }}>
                                            <span style={{
                                                width: 21, height: 21, borderRadius: 6, background: "#eaf1fb",
                                                color: INK, fontSize: 11, fontWeight: 800,
                                                display: "inline-flex", alignItems: "center", justifyContent: "center", flex: "0 0 auto",
                                            }}>
                                                ✓
                                            </span>
                                            <span style={{ fontSize: 12, fontWeight: 800, color: INK, letterSpacing: ".2px", textTransform: "uppercase" }}>
                                                Cross-check against Finance
                                            </span>
                                            <span style={{ flex: 1, height: 1, background: "var(--uidai-pmis-border)" }} />
                                            {/* Counted across BOTH groups — a reader glancing
                                                at the header wants "is anything wrong here",
                                                not "is anything wrong in one of the two
                                                halves of this section". */}
                                            {(() => {
                                                const all = [...(financeDeductions.checks || []), ...taxCheck.checks];
                                                const errors = all.filter((c) => c.severity === SEVERITY.ERROR).length;
                                                const warns = all.filter((c) => c.severity === SEVERITY.WARN).length;
                                                return (
                                                    <span style={{ display: "inline-flex", gap: 6, alignItems: "center" }}>
                                                        {errors > 0 && (
                                                            <span className="uidai-pmis-badge uidai-pmis-badge-red">{errors} to fix</span>
                                                        )}
                                                        {warns > 0 && (
                                                            <span className="uidai-pmis-badge uidai-pmis-badge-orange">{warns} to watch</span>
                                                        )}
                                                        {errors === 0 && warns === 0 && (
                                                            <span className="uidai-pmis-badge uidai-pmis-badge-green">agrees</span>
                                                        )}
                                                    </span>
                                                );
                                            })()}
                                        </div>

                                        {/* Figure-for-figure first: whether the two screens
                                            agree at all matters before whether they agree
                                            about tax. */}
                                        {financeDeductions.available && financeDeductions.checks.length > 0 && (
                                            <>
                                                <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: ".5px", textTransform: "uppercase", ...muted, margin: "2px 0 7px" }}>
                                                    Same quarter, both screens
                                                    {financeDeductions.status && (
                                                        <span style={{ marginLeft: 8, fontWeight: 600, textTransform: "none", letterSpacing: 0 }}>
                                                            · Finance row is {String(financeDeductions.status).replace(/_/g, " ")}
                                                        </span>
                                                    )}
                                                </div>
                                                <div style={{ display: "grid", gap: 8, maxWidth: 720, marginBottom: 14 }}>
                                                    {financeDeductions.checks.map((c) => <CheckRow key={c.id} check={c} />)}
                                                </div>
                                            </>
                                        )}
                                        {!financeDeductions.available && (
                                            <div style={{ fontSize: 11.5, ...muted, marginBottom: 12, lineHeight: 1.6 }}>
                                                ◍ Figure-for-figure reconciliation not run &mdash; {financeDeductions.reason}.
                                            </div>
                                        )}

                                        <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: ".5px", textTransform: "uppercase", ...muted, margin: "2px 0 7px" }}>
                                            Tax basis
                                        </div>
                                        <div style={{ display: "grid", gap: 8, maxWidth: 720 }}>
                                            {taxCheck.checks.map((c) => <CheckRow key={c.id} check={c} />)}
                                        </div>
                                    </div>
                                )}
                            </div>
                            </PageSection>
                        </>
                    )}
                </>
            )}

            {relaxOpen && (
                <RelaxationModal
                    scoredPercent={relaxation.scoredPercent}
                    pqp={chain.pqp}
                    quarterLabel={period?.label || "this quarter"}
                    quarterDates={period ? `${longDate(period.start)} → ${longDate(period.end)}` : ""}
                    onCancel={() => setRelaxOpen(false)}
                    onSubmit={async (payload) => {
                        await grantRelaxation(payload);
                        setRelaxOpen(false);
                    }}
                />
            )}

            {/* ══ SLA reference image ══════════════════════════════════
                Same dialog the SLA mapping screen uses, so the image looks
                the same wherever it is opened from. No fetch on open: the
                URL already travelled on the master and the files are public
                static content.

                Backdrop closes only on a mousedown that both starts AND
                ends on the backdrop itself — a drag that begins on the
                image and releases outside would otherwise close it. */}
            {previewSla && (
                <div
                    onMouseDown={(e) => { if (e.target === e.currentTarget) setPreviewSla(null); }}
                    style={{
                        position: "fixed", inset: 0, background: "rgba(7,26,52,.55)",
                        display: "flex", alignItems: "center", justifyContent: "center",
                        zIndex: 2000, padding: 20,
                    }}
                >
                    <div style={{
                        position: "relative", background: "#fff", borderRadius: 12, overflow: "hidden",
                        boxShadow: "0 20px 60px rgba(0,0,0,.3)",
                        maxWidth: "min(900px, 95vw)", maxHeight: "90vh",
                        display: "flex", flexDirection: "column",
                    }}>
                        <div style={{
                            display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12,
                            padding: "12px 14px", borderBottom: "1px solid var(--uidai-pmis-border)",
                        }}>
                            <div style={{
                                fontWeight: 800, color: INK, fontSize: 14, minWidth: 0,
                                overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                            }}>
                                {previewSla.slaTitle || previewSla.slaRef || "SLA"}
                                <span style={{ fontFamily: "monospace", fontWeight: 400, fontSize: 12, ...muted, marginLeft: 8 }}>
                                    {previewSla.slaRef}
                                </span>
                            </div>
                            <button
                                type="button"
                                onClick={() => setPreviewSla(null)}
                                title="Close"
                                style={{
                                    width: 30, height: 30, borderRadius: "50%", background: "#fdecec",
                                    border: "none", color: "#b42318", cursor: "pointer",
                                    fontSize: 15, fontWeight: 700, flex: "0 0 auto",
                                }}
                            >
                                ✕
                            </button>
                        </div>
                        <div style={{
                            padding: 14, overflow: "auto", background: "#f6f9fd", minHeight: 140,
                            display: "flex", alignItems: "center", justifyContent: "center",
                        }}>
                            <img
                                src={previewSla.image?.url}
                                alt={previewSla.image?.caption || previewSla.slaRef || "SLA"}
                                style={{
                                    display: "block", maxWidth: "100%", borderRadius: 8,
                                    border: "1px solid var(--uidai-pmis-border)",
                                }}
                            />
                        </div>
                        {(previewSla.image?.caption || previewSla.image?.name) && (
                            <div style={{ padding: "9px 14px", borderTop: "1px solid var(--uidai-pmis-border)", fontSize: 11.5, ...muted }}>
                                {previewSla.image.caption || previewSla.image.name}
                            </div>
                        )}
                    </div>
                </div>
            )}
        </div>
    );
}
