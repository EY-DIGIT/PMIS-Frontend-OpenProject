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
import { loadProjectTree } from "../../../api/milestoneConfigApi";
import {
    getActivityCompliance,
    getNpqp,
    getSeverityMaster,
    getLdBands,
    listSlaMasters,
    getQuarterlyAggregate,
    listSettlements,
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
} from "../../../utils/project/slaRollup";
import { recheckSla, detectCarryForward, METHOD } from "../../../utils/project/slaReporting";
import {
    collectResourceActivities,
    deriveQuarterlyResourcePlan,
    compareFToPlan,
} from "../../../utils/project/resourcePlan";
import {
    buildSettlementChain,
    verifyAqp,
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
function severityAccent(level) {
    const n = Number(level);
    if (!Number.isFinite(n)) return INK;
    if (n >= 3) return RED;
    if (n === 2) return AMBER;
    return GREEN;
}
const RESULT_BADGE = {
    breached: "uidai-pmis-badge-red",
    met: "uidai-pmis-badge-green",
    pending: "uidai-pmis-badge-orange",
};

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
                            <span className={`uidai-pmis-badge ${RESULT_BADGE[c.status] || ""}`} style={{ marginLeft: 6, fontSize: 10 }}>
                                {c.status}
                            </span>
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
function SectionHead({ title, count, sub, onToggle, toggleLabel, showToggle, style }) {
    return (
        <div style={{ marginTop: 18, ...style }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                <div style={{ fontSize: 13.5, fontWeight: 800, color: INK }}>{title}</div>
                <span style={{ background: "#dceafe", color: "#1f4e87", borderRadius: 999, padding: "1px 8px", fontSize: 11, fontWeight: 800 }}>
                    {count}
                </span>
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

/* ─── plain-language summary ──────────────────────────────────────
   The answer, before the evidence. Someone opening this page wants
   three numbers: how bad was the quarter, what did it cost, what do we
   pay. Everything below this card explains those three; none of it
   should be needed to read them.

   Deliberately free of acronyms — NPQP, PA and AQP are defined in the
   glossary and used from the sections downward, but the headline says
   "you pay" because that is what it means. */
function Headline({ period, breaches, measured, ldPercent, ldAmount, deliverableLd, finalPayment, pending }) {
    const clean = !breaches;
    const totalPenalty = (Number(ldAmount) || 0) + (Number(deliverableLd) || 0);

    return (
        <div style={{
            marginTop: 14, borderRadius: 12, overflow: "hidden",
            border: `1px solid ${clean ? "#bfe3cd" : "#f0c9c2"}`,
            background: clean ? "#f3fbf6" : "#fdf7f5",
        }}>
            <div style={{ padding: "13px 16px 4px", fontSize: 12, fontWeight: 800, color: INK, letterSpacing: ".2px" }}>
                {period ? `${period.label} at a glance` : "This quarter at a glance"}
                {period && (
                    <span style={{ ...muted, fontWeight: 500, marginLeft: 8, fontSize: 11.5 }}>
                        {period.start} → {period.end}
                    </span>
                )}
            </div>
            <div style={{
                display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(170px, 1fr))",
                gap: 2, padding: "6px 16px 15px",
            }}>
                <div>
                    <div style={{ fontSize: 26, fontWeight: 800, color: clean ? GREEN : RED, lineHeight: 1.1 }}>
                        {clean ? "No breaches" : `${breaches} breach${breaches === 1 ? "" : "es"}`}
                    </div>
                    <div style={{ fontSize: 11.5, ...muted, marginTop: 3 }}>
                        {measured > 0 ? `across ${measured} SLA${measured === 1 ? "" : "s"} measured` : "nothing measured yet"}
                    </div>
                </div>
                <div>
                    <div style={{ fontSize: 26, fontWeight: 800, color: totalPenalty > 0 ? RED : GREEN, lineHeight: 1.1 }}>
                        {totalPenalty > 0 ? money(totalPenalty) : "No penalty"}
                    </div>
                    <div style={{ fontSize: 11.5, ...muted, marginTop: 3 }}>
                        deducted this quarter
                        {Number(ldPercent) > 0 && ` · ${pct(ldPercent)} of the payment base`}
                    </div>
                </div>
                <div>
                    <div style={{ fontSize: 26, fontWeight: 800, color: INK, lineHeight: 1.1 }}>
                        {finalPayment === null || finalPayment === undefined ? "—" : money(finalPayment)}
                    </div>
                    <div style={{ fontSize: 11.5, ...muted, marginTop: 3 }}>
                        {pending?.length
                            ? <span style={{ color: AMBER, fontWeight: 600 }}>partial — {pending.join(" and ")} still pending</span>
                            : "paid to the consultant, after penalty and tax"}
                    </div>
                </div>
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
    ["Penalty (LD)", "“Liquidated damages” — money deducted when an SLA is missed. Agreed up front in the contract, not a fine."],
    ["Severity", "How badly one measurement missed its target, 0 (fine) to 4 (worst). Converted to points."],
    ["Points", "Severity turned into a number that adds up across the quarter. A clean measurement scores negative points and pulls the total down."],
    ["Measurement interval", "How often the SLA is checked — e.g. monthly. All resources are combined into one score per interval."],
    ["Reporting interval", "What the penalty is charged for — the quarter. Points from every measurement add up into it, then reset."],
    ["F", "The resource cost planned for the quarter, from the deployment plan."],
    ["QGR", "Guaranteed quarterly amount. Paid regardless of how many resources were actually deployed."],
    ["NPQP", "F + QGR. The base the penalty percentage is applied to — what was PLANNED."],
    ["PA", "What was actually earned this quarter, from real attendance — what was ACTUAL."],
    ["AQP", "The final payment: actual earnings, minus the penalty, plus the guaranteed amount."],
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
   way each term moves so the chain reads the way the clause does. */
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
                    {sign && <span style={{ display: "inline-block", width: 12, color: "var(--uidai-pmis-muted)" }}>{sign}</span>}
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

/* Open state is local, seeded from `defaultOpen`. Expand/collapse-all works
   by changing the React key at the call site so each group remounts with a
   new seed — which is also the behaviour you want: pressing "expand all"
   should override whatever was toggled by hand, not merge with it.

   One component serves both regimes because the shell is identical; only
   the header figures and the occurrence columns differ, and splitting it
   in two would duplicate the badges, the chrome and the empty states. */
function SlaGroup({ item, recheck, defaultOpen }) {
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
                    {item.pending > 0 && <span className="uidai-pmis-badge uidai-pmis-badge-orange">{item.pending} pending</span>}
                    {item.capHits > 0 && (
                        <span
                            className="uidai-pmis-badge uidai-pmis-badge-orange"
                            title="Severity above the configured ceiling was capped before scoring — RFP §5.28.1.b"
                        >
                            SLA cap ×{item.capHits}
                        </span>
                    )}
                    {recheck?.diverges && (
                        <span
                            className="uidai-pmis-badge uidai-pmis-badge-red"
                            title={recheck.note || "This SLA's own scoring rule gives a different figure — expand to see both."}
                        >
                            ⚠ RFP rule differs
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
                                            <span className={`uidai-pmis-badge ${RESULT_BADGE[o.status] || "uidai-pmis-badge-orange"}`}>
                                                {o.status || "—"}
                                            </span>
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
                for (const m of mastersRes.value) {
                    if (m.slaRef) masters.set(String(m.slaRef), m);
                    if (m.slaId) masters.set(String(m.slaId), m);
                }
            } else {
                setSlaLibraryEmpty(false);
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

    const { deliverableItems, quarterlyItems, scale, classification } = useMemo(
        () => rollupBySla(inQuarter, { severityMaster, ldBands }),
        [inQuarter, severityMaster, ldBands]
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

    /* ── the money chain (§5.28.1.d) ──────────────────────────────────
       The settled row for THIS quarter, matched only when the contract
       quarter aligns with a calendar one — settlement rows are keyed by
       fiscal year + calendar quarter, and pairing a straddling window
       with one of them would attribute the wrong money to it. */
    const settlementRow = useMemo(() => {
        if (!alignedQuarterKey) return null;
        const [y, q] = alignedQuarterKey.split("-Q");
        return settlements.find(
            (r) => Number(r.fiscalYear) === Number(y) && Number(r.quarter) === Number(q)
        ) || null;
    }, [settlements, alignedQuarterKey]);

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

    /* Which AQP formula the backend actually applied. §5.28.1.d(h) is
       (PA − LD) + QGR; a row equal to PA − LD is short by exactly one
       QGR instalment, every Phase 2/3 quarter. */
    const aqpCheck = useMemo(() => verifyAqp({
        aqpAmount: settlementRow?.aqpAmount,
        paAmount: settlementRow?.paAmount,
        ldAmount: settlementRow?.ldAmount,
        qgrAmount: settlementRow?.qgrAmount,
    }), [settlementRow]);

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
    const statement = useMemo(() => {
        const deliverableNet = Number.isFinite(payables.totals.totalNetPayable)
            ? payables.totals.totalNetPayable : null;
        const quarterlyNet = Number.isFinite(chain.aqp) ? chain.aqp : null;

        const present = [deliverableNet, quarterlyNet].filter((v) => v !== null);
        const grossDue = present.length ? present.reduce((a, b) => a + b, 0) : null;

        const pending = [];
        if (deliverableItems.length > 0 && deliverableNet === null) pending.push("deliverable payments");
        if (quarterlyItems.length > 0 && quarterlyNet === null) pending.push("the quarterly resource payment");

        return {
            deliverableNet,
            quarterlyNet,
            grossDue,
            pending,
            complete: pending.length === 0 && grossDue !== null,
            tax: taxBreakdown(grossDue),
        };
    }, [payables.totals.totalNetPayable, chain.aqp, deliverableItems.length, quarterlyItems.length]);

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
        return out;
    }, [loadedOnce, classification, mastersError, slaLibraryEmpty, unconfigured, scale.configured,
        ldBands.length, aggregateCheck, alignedQuarterKey, recheckIssues, quarterlyItems.length,
        overlaps.length, aggregateError, undated]);

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
                    <div style={{ fontSize: 12, ...muted, marginTop: 2 }}>
                        What each service level cost this quarter, which activities caused it, and what gets paid.
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
                </div>
            </div>

            {period && (
                <div style={{ fontSize: 12, ...muted, marginTop: 10, lineHeight: 1.7 }}>
                    <b style={{ color: INK }}>{period.label}</b> · reporting interval{" "}
                    <b style={{ color: INK }}>{period.start}</b> → <b style={{ color: INK }}>{period.end}</b>{" "}
                    <span style={{ opacity: .8 }}>(measured from contract start {projectStartDate})</span>
                    {overlaps.length > 1 && (
                        <>
                            <br />
                            <span>
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
                            </span>
                        </>
                    )}
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
                        ldPercent={totals.cappedLdPercent}
                        ldAmount={totals.ldAmount}
                        deliverableLd={dTotals.totalLdAmount}
                        finalPayment={statement.tax.net}
                        pending={statement.pending}
                    />
                    <Glossary open={showGlossary} onToggle={() => setShowGlossary((v) => !v)} />
                </>
            )}

            {/* Every remaining diagnostic, folded into one counted panel.
                They were nine stacked red blocks, which read as "everything
                is broken" and buried the quarter's actual figures. Nothing
                is lost — see the `issues` memo. */}
            <IssuePanel issues={issues} open={showIssues} onToggle={() => setShowIssues((v) => !v)} />

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
                            {/* ══ Quarterly track (§5.28.3 / §5.28.4) ══════════════
                                Resource, recommendation and governance-tool SLAs. All
                                measured and reported quarterly and charged against
                                NPQP, so these — and only these — sum into the §5.27.6
                                quarter ceiling. */}
                            <SectionHead
                                title="Quarterly SLAs — resource, recommendation &amp; governance tool"
                                count={quarterlyItems.length}
                                sub="Penalties for missed service levels on resources, recommendations and the governance tool. Charged as a % of the quarter's payment base. §5.28.3–5.28.4"
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
                                    <div className="uidai-pmis-grid-4" style={{ gap: 12, marginTop: 12 }}>
                                        <Tile label="SLAs scored" value={num(totals.slaCount, 0)} hint={`${num(totals.totalOccurrences, 0)} occurrences`} />
                                        <Tile label="Breaches" value={num(totals.totalBreaches, 0)} accent={totals.totalBreaches > 0 ? RED : GREEN} />
                                        <Tile label="Points this quarter" value={num(totals.totalPoints, 0)} hint="after the per-measurement SLA cap" />
                                        <Tile
                                            label="Penalty % before the cap"
                                            value={pct(totals.sumLdPercent)}
                                            accent={totals.sumLdPercent > 0 ? RED : GREEN}
                                            hint={`${num(totals.contributingCount, 0)} SLA${totals.contributingCount === 1 ? "" : "s"} contributing · §5.28.1.d`}
                                        />
                                        <Tile
                                            label="Penalty % applied"
                                            value={pct(totals.cappedLdPercent)}
                                            accent={RED}
                                            hint={totals.capApplied
                                                ? `capped from ${pct(totals.sumLdPercent)} at the ${totals.quarterCapPercent}% ceiling`
                                                : `quarter ceiling ${totals.quarterCapPercent}% · §5.27.6`}
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
                                    {quarterlyItems.map((it) => (
                                        <SlaGroup
                                            key={`q:${it.slaRef}:${expandAll}`}
                                            item={it}
                                            recheck={rechecks.get(String(it.slaRef))}
                                            defaultOpen={expandAll}
                                        />
                                    ))}
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
                                        title="The payment base — what the resources cost"
                                        count={plan.activityCount}
                                        sub="What the resources planned for this quarter cost. This is the figure the penalty percentage is applied to, so it is checked two ways. §5.28.1.d(c)"
                                        onToggle={() => setShowPlanDetail((v) => !v)}
                                        toggleLabel={showPlanDetail ? "Hide activities" : "Show activities"}
                                        showToggle={plan.activityCount > 0}
                                        style={{ marginTop: 26 }}
                                    />

                                    <div className="uidai-pmis-grid-4" style={{ gap: 12, marginTop: 12 }}>
                                        <Tile
                                            label="Planned cost — from the deployment plan"
                                            value={money(plan.fAmount)}
                                            hint={`${num(plan.activityCount, 0)} activit${plan.activityCount === 1 ? "y" : "ies"} · `
                                                + `${num(plan.allocationCount, 0)} allocation${plan.allocationCount === 1 ? "" : "s"} · `
                                                + `${num(plan.headcount, 0)} head${plan.headcount === 1 ? "" : "s"}`}
                                        />
                                        <Tile
                                            label="Planned cost — from attendance records"
                                            value={money(endpointF)}
                                            hint={endpointF === null
                                                ? "not available for this quarter"
                                                : "leave-management, after §5.25.2.b"}
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
                                        F here is summed from the activities&rsquo; own allocation rows &mdash; the
                                        &ldquo;resource deployment plan&rdquo; §5.28.1.d(c) names. The NPQP endpoint derives its
                                        F from leave-management instead, after §5.25.2.b&rsquo;s{" "}
                                        <b>MP = R(1 &minus; L/N)</b> reduction for leave beyond the 6 permissible days a
                                        quarter, so the two are expected to differ slightly. The endpoint&rsquo;s figure is
                                        what NPQP and every LD amount above actually use; this one is the check on it.
                                    </div>
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
                                        title="Carried forward — unresolved from an earlier quarter"
                                        count={carried.length}
                                        sub="Breaches from an earlier quarter that were never resolved. These keep scoring every quarter until fixed — shown for information, not counted above. §5.28.3.f–g"
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
                            <SectionHead
                                title="Deliverable-linked SLAs — submission &amp; defect rectification"
                                count={deliverableItems.length}
                                sub="Penalties for late or rejected deliverables. Charged against that deliverable's own cost, and not subject to the quarter's 10% ceiling. §5.28.2"
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
                                    {deliverableItems.map((it) => (
                                        <SlaGroup
                                            key={`d:${it.slaRef}:${expandAll}`}
                                            item={it}
                                            recheck={rechecks.get(String(it.slaRef))}
                                            defaultOpen={expandAll}
                                        />
                                    ))}
                                </>
                            )}

                            {/* ── deliverable payment → LD → net payable ────
                                The section above answers "what did each SLA do".
                                This one answers the finance question underneath it:
                                per deliverable, what was scheduled, what the SLAs
                                took off it, and what is left to pay. */}
                            {/* Always rendered, never gated on there being rows.
                                A section that vanishes when it is empty is
                                indistinguishable from a section that was never
                                built — and the empty state is where the reason
                                lives. */}
                            <>
                                    <SectionHead
                                        title="Deliverable payment &amp; net payable"
                                        count={payables.rows.length}
                                        sub="What each deliverable was due, what the penalties took off it, and what is left to pay. §5.28.2"
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
                                                <Tile label="Deliverables" value={num(payables.totals.deliverableCount, 0)} hint="with an SLA evaluation this period" />
                                                <Tile label="Deliverable cost" value={money(payables.totals.totalPayment)} hint="their own cost per RFP §5.23.1" />
                                                <Tile label="LD deducted" value={money(payables.totals.totalLdAmount)} accent={RED} hint="charged on that cost · §5.28.2 · uncapped" />
                                                <Tile label="Net payable" value={money(payables.totals.totalNetPayable)} accent={GREEN} hint="deliverable cost − LD" />
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

                                            {payables.totals.missingBaseCount > 0 && (
                                                <Banner
                                                    kind="error"
                                                    text={
                                                        `${payables.totals.missingBaseCount} deliverable(s) have a payment term worth ₹0, so there is ` +
                                                        "no deliverable cost to charge LD against. Set % of Payment on the milestone's term in Finance."
                                                    }
                                                />
                                            )}
                                            {/* Not an error — the allotment simply is not the §5.28.2 base.
                                                But a divergence usually means LD Basis was never configured
                                                and is sitting on the backend's even split, which would give
                                                the quarterly settlement a different number from this table. */}
                                            {payables.totals.ldBasisMismatchCount > 0 && (
                                                <Banner
                                                    kind="error"
                                                    text={
                                                        `${payables.totals.ldBasisMismatchCount} deliverable(s) have an LD Basis allotment that differs from ` +
                                                        "their own cost. This table ignores it — §5.28.2 charges SLA 001 / 002 on \"the total cost of that " +
                                                        "deliverable\", which §5.23.1 defines as its payment share (D1–D6 5%, D7 15%, D8 20%).\n" +
                                                        "Worth checking in Finance: an LD Basis equal to 100 / milestones-in-phase is the backend's even " +
                                                        "split, i.e. it was never set against the RFP schedule."
                                                    }
                                                />
                                            )}
                                            {payables.unlinked.length > 0 && (
                                                <Banner
                                                    kind="error"
                                                    text={
                                                        `${payables.unlinked.length} SLA evaluation(s) could not be charged to any payment: ` +
                                                        payables.unlinked.slice(0, 4)
                                                            .map((u) => `${u.slaRef} on ${u.activityCode || u.activityId} — ${u.reason}`)
                                                            .join("; ") +
                                                        (payables.unlinked.length > 4 ? `; …and ${payables.unlinked.length - 4} more.` : "")
                                                    }
                                                />
                                            )}
                                            <div style={{ fontSize: 11.5, ...muted, marginTop: 8, lineHeight: 1.6 }}>
                                                SLA 001 (0.5% per week) and SLA 002 (1% per week) are charged on{" "}
                                                <b>that deliverable&rsquo;s own cost</b> (§5.28.2), which §5.23.1 sets as its
                                                share of the Phase-1 fixed + one-time cost. Cost and payment are the same
                                                number for D1&ndash;D8, so the finance module&rsquo;s separate LD Basis
                                                allotment is not used here.
                                                <br />
                                                Nothing is capped. §5.28.2 states no ceiling; §5.27.6&rsquo;s 10% is 10% of
                                                NPQP, which does not exist in Phase 1 (F starts at D9 per §5.25.2, QGR at
                                                Phase 2 per §5.23.2); and §5.28.1.b&rsquo;s band ceiling needs a severity
                                                level, which these two SLAs do not carry.
                                            </div>
                                        </>
                                    )}
                            </>

                            {/* ══ Final payment for the quarter (§5.28.1.d) ════════
                                The conclusion of the whole page. LD is computed on
                                NPQP — the PLANNED figure — and then deducted from PA,
                                the ACTUAL one; §5.28.1.d says so explicitly. QGR sits
                                inside NPQP (so LD is charged on it) and is added back
                                after the deduction, because §5.23.2 guarantees it
                                regardless of deployment. */}
                            <SectionHead
                                title="What gets paid this quarter"
                                sub="How the quarter's payment is worked out, step by step — from the planned cost, through the penalty, to what is actually paid. §5.28.1.d"
                                count={settlementRow ? (settlementRow.status || "closed").replace(/_/g, " ") : "not settled"}
                                style={{ marginTop: 26 }}
                            />

                            {/* A finance override replaces the computed Σ LD % with a
                                human's figure (Settlement & LD → "Override LD %"). The
                                chain below then runs on that number, not on what this
                                page scored — so saying so is the difference between a
                                calculation and an unexplained discrepancy. */}
                            {settlementRow && (settlementRow.status === "overridden" || settlementRow.overrideReason) && (
                                <Banner
                                    kind="error"
                                    text={
                                        `This quarter's LD was overridden on the Settlement & LD page. The figures below use the `
                                        + `overridden ${pct(settlementRow.sumLdPercent)}, not the ${pct(totals.sumLdPercent)} this page scored `
                                        + `from the evaluation results.\n`
                                        + `Reason given: ${settlementRow.overrideReason || "— none recorded —"}`
                                    }
                                />
                            )}

                            {!alignedQuarterKey ? (
                                <div className="uidai-pmis-filter-shell" style={{ marginTop: 10, padding: 16, fontSize: 12.5, ...muted, lineHeight: 1.6 }}>
                                    Settlement rows are keyed by fiscal year and calendar quarter, and this contract
                                    quarter spans {overlaps.length} of them. Pairing it with one would attribute the
                                    wrong quarter&rsquo;s money to it, so the chain is not shown for this period.
                                </div>
                            ) : (
                                <>
                                    <div style={{
                                        marginTop: 12, background: "#fbfdff",
                                        border: "1px solid var(--uidai-pmis-border)",
                                        borderRadius: 10, padding: "14px 16px",
                                    }}>
                                        <table style={{ borderCollapse: "collapse", width: "100%", maxWidth: 520 }}>
                                            <tbody>
                                                <ChainRow
                                                    label="Planned resource cost (F)"
                                                    clause="§5.28.1.d(c)"
                                                    value={money(chain.f)}
                                                />
                                                <ChainRow
                                                    label="Guaranteed amount (QGR)"
                                                    clause="§5.23.2"
                                                    sign="+"
                                                    value={money(chain.qgr)}
                                                />
                                                <ChainRow
                                                    label="Payment base — penalty is a % of this (NPQP)"
                                                    clause="§5.28.1.d(e)"
                                                    sign="="
                                                    value={money(chain.npqp)}
                                                    strong
                                                    rule
                                                    hint={chain.npqpConsistent === false
                                                        ? `⚠ The stored NPQP (${formatINR(chain.npqpStated)}) does not equal F + QGR `
                                                          + `(${formatINR(chain.npqpDerived)}). One of the three is stale at source.`
                                                        : null}
                                                />

                                                <ChainRow
                                                    label={`Σ LD % across every quarterly SLA`}
                                                    clause="§5.28.1.d(f)"
                                                    value={pct(chain.sumLdPercent)}
                                                    rule
                                                />
                                                {chain.capApplied && (
                                                    <ChainRow
                                                        label={`capped at ${chain.quarterCapPercent}% of NPQP`}
                                                        clause="§5.27.6"
                                                        value={pct(chain.cappedLdPercent)}
                                                        tone={RED}
                                                    />
                                                )}
                                                <ChainRow
                                                    label="Penalty"
                                                    value={chain.ldAmount === null ? "—" : `− ${money(chain.ldAmount)}`}
                                                    tone={RED}
                                                    strong
                                                />

                                                <ChainRow
                                                    label="Actually earned, from real attendance (PA)"
                                                    clause="§5.25.2"
                                                    value={chain.pa === null
                                                        ? <span style={{ color: AMBER, fontWeight: 700 }}>not settled yet</span>
                                                        : money(chain.pa)}
                                                    rule
                                                    hint={chain.pa === null
                                                        ? "PA comes from attendance and only exists once the quarter is closed on the "
                                                          + "Settlement page. Everything above is available now."
                                                        : null}
                                                />
                                                <ChainRow
                                                    label="less the LD computed on NPQP"
                                                    sign="−"
                                                    value={chain.ldAmount === null ? "—" : money(chain.ldAmount)}
                                                    tone={RED}
                                                />
                                                <ChainRow
                                                    label="QGR added back — guaranteed regardless of deployment"
                                                    sign="+"
                                                    value={money(chain.qgr)}
                                                />
                                                <ChainRow
                                                    label="Final payment for the quarter (AQP)"
                                                    clause="§5.28.1.d(h)"
                                                    sign="="
                                                    value={chain.aqp === null ? "—" : money(chain.aqp)}
                                                    strong
                                                    rule
                                                    tone={GREEN}
                                                />
                                            </tbody>
                                        </table>

                                        {/* The asymmetry, stated as a number. */}
                                        {chain.effectiveLdPercentOnPa !== null && chain.ldAmount > 0 && (
                                            <div style={{
                                                marginTop: 12, padding: "10px 12px", borderRadius: 8,
                                                background: chain.paBelowPlan ? "#fffaf0" : "#f4f8ff",
                                                border: `1px solid ${chain.paBelowPlan ? "#f0dfc0" : "#c8d6ee"}`,
                                                fontSize: 11.5, lineHeight: 1.65, color: "#334155",
                                            }}>
                                                <b style={{ color: chain.paBelowPlan ? AMBER : INK }}>
                                                    Effective LD rate on what is actually paid:{" "}
                                                    {Math.round(chain.effectiveLdPercentOnPa * 100) / 100}%
                                                </b>
                                                {" "}against a headline {pct(chain.cappedLdPercent)}.
                                                {chain.paBelowPlan && (
                                                    <>
                                                        {" "}The LD is computed on NPQP ({money(chain.npqp)}) but deducted from PA
                                                        ({money(chain.pa)}) — §5.28.1.d is explicit about that — and actual
                                                        deployment is <b>{money(chain.deploymentShortfall)}</b> below plan, so the
                                                        penalty takes a bigger bite out of the payment than the percentage reads.
                                                    </>
                                                )}
                                            </div>
                                        )}
                                    </div>

                                    {/* Which formula the backend actually used. */}
                                    {aqpCheck.comparable && aqpCheck.matches === "without_qgr" && (
                                        <Banner
                                            kind="error"
                                            text={
                                                `The settled AQP for this quarter is ${formatINR(aqpCheck.stated)}, which equals PA − LD. `
                                                + `§5.28.1.d(h) is (PA − LD) + QGR = ${formatINR(aqpCheck.expected)}.\n`
                                                + `The QGR add-back is missing, so this quarter is short by ${formatINR(aqpCheck.shortfall)} `
                                                + `— one full QGR instalment. §5.23.2 pays QGR as an equal quarterly instalment of the `
                                                + `remaining 35% of the Phase-1 fixed and one-time cost, independent of deployment; it is `
                                                + `inside NPQP so that LD is charged on it, and added back afterwards because it is `
                                                + `guaranteed. If every Phase 2/3 quarter is computed this way, the shortfall repeats.`
                                            }
                                        />
                                    )}
                                    {aqpCheck.comparable && aqpCheck.matches === "neither" && (
                                        <Banner
                                            kind="error"
                                            text={
                                                `The settled AQP (${formatINR(aqpCheck.stated)}) matches neither (PA − LD) + QGR `
                                                + `(${formatINR(aqpCheck.expected)}) nor PA − LD (${formatINR(aqpCheck.withoutQgr)}). `
                                                + `Something other than §5.28.1.d(h) produced it.`
                                            }
                                        />
                                    )}
                                    {aqpCheck.comparable && aqpCheck.matches === "rfp" && (
                                        <div style={{ fontSize: 11.5, color: GREEN, marginTop: 8, fontWeight: 600 }}>
                                            ✓ The settled AQP matches §5.28.1.d(h) — (PA − LD) + QGR.
                                        </div>
                                    )}

                                    {/* Tax is NOT applied here — it belongs to the invoice
                                        as a whole, which also carries the deliverable
                                        stream. See the payment statement at the foot of
                                        the page. */}

                                    {!chain.complete && (
                                        <div style={{ fontSize: 11.5, ...muted, marginTop: 10, lineHeight: 1.6 }}>
                                            ◍ The chain is incomplete — {chain.missing.join(", ")}{" "}
                                            {chain.missing.length === 1 ? "is" : "are"} not available for this quarter, so AQP
                                            could not be computed. Close the quarter on the Settlement page to resolve PA from
                                            attendance.
                                        </div>
                                    )}
                                </>
                            )}

                            {/* ══ Across the contract (§5.26.2) ════════════════════ */}
                            {cumulative.quarterCount > 0 && (
                                <>
                                    <SectionHead
                                        title="Paid so far across the contract"
                                        count={cumulative.quarterCount}
                                        sub="Everything paid so far across closed quarters, and how much of the contract's spending limit that uses. §5.26.2"
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
                                    <div style={{ fontSize: 11.5, ...muted, marginTop: 8, lineHeight: 1.6 }}>
                                        This covers the Phase 2/3 quarterly stream only. Phase-1 deliverable payments
                                        (D1&ndash;D8, §5.23.1) and the annual Governance Tool payment (D11, §5.25.3) are separate
                                        streams and are <b>not</b> included, so usage against the ceiling is understated.
                                    </div>
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

                                {!showFormulas && (
                                    <div style={{ fontSize: 11.5, ...muted, marginTop: 6, lineHeight: 1.6 }}>
                                        The RFP runs two separate LD regimes and never adds them together. Severity is capped
                                        per measurement, points accumulate per reporting interval, and the quarter&rsquo;s total is
                                        capped once at {totals.quarterCapPercent}% of NPQP.
                                    </div>
                                )}

                                {showFormulas && (
                                    <>
                                        <div style={{ fontSize: 11.5, ...muted, marginTop: 8, lineHeight: 1.6 }}>
                                            Two regimes, never added together. Values below are{" "}
                                            <b style={{ color: INK }}>this project&rsquo;s configuration</b>, not the RFP defaults.
                                        </div>

                                        {/* ── 1 · scoring ─────────────────────────── */}
                                        <FormulaTable
                                            title="1 · Scoring one SLA (quarterly track, §5.28.3–5.28.4)"
                                            subtitle="A measurement interval is when the SLA runs; a reporting interval is what the LD is charged for."
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
                                            title="2 · The quarter's money (§5.28.1.d)"
                                            subtitle="LD is computed on NPQP — the planned figure — and deducted from PA, the actual one."
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
                                            title="3 · Deliverable-linked SLAs (§5.28.2)"
                                            subtitle="Charged on the deliverable's own cost. No severity, no points, no NPQP — and no ceiling."
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
                                The same breakdown as above, with the money in it.
                                Both streams, the invoice, and where the contract
                                stands — so "what is due and what do we actually pay"
                                is answerable without leaving the page. */}
                            <div style={{
                                marginTop: 20, background: "#fbfdff",
                                border: "1px solid var(--uidai-pmis-border)",
                                borderRadius: 10, padding: "14px 16px",
                            }}>
                                <div style={{ fontSize: 14, fontWeight: 800, color: INK }}>
                                    Payment statement — {period?.label || "this quarter"}
                                </div>
                                <div style={{ fontSize: 11.5, ...muted, marginTop: 2 }}>
                                    What is due and what will actually be paid. The two LD regimes are computed
                                    separately and never mixed, but they are invoiced together.
                                </div>

                                <table style={{ borderCollapse: "collapse", width: "100%", maxWidth: 620, marginTop: 12 }}>
                                    <tbody>
                                        {/* ── A · deliverable stream ──────────────── */}
                                        <ChainRow
                                            label="A · Phase-1 deliverables"
                                            clause="§5.23.1 · §5.28.2"
                                            value={deliverableItems.length === 0 ? "—" : ""}
                                            strong
                                        />
                                        {deliverableItems.length === 0 ? (
                                            <ChainRow
                                                label="no deliverable-linked SLA evaluated this quarter"
                                                value="—"
                                            />
                                        ) : (
                                            <>
                                                <ChainRow
                                                    label="Deliverable cost scheduled"
                                                    value={money(payables.totals.totalPayment)}
                                                />
                                                <ChainRow
                                                    label="less SLA 001 / 002 liquidated damages"
                                                    sign="−"
                                                    value={money(payables.totals.totalLdAmount)}
                                                    tone={RED}
                                                />
                                                <ChainRow
                                                    label="Net payable on deliverables"
                                                    sign="="
                                                    value={money(statement.deliverableNet)}
                                                    strong
                                                    rule
                                                    hint="Uncapped — §5.28.2 sets no ceiling, so this can go negative."
                                                />
                                            </>
                                        )}

                                        {/* ── B · quarterly stream ────────────────── */}
                                        <ChainRow
                                            label="B · Quarterly resource payment"
                                            clause="§5.28.1.d"
                                            value=""
                                            strong
                                            rule
                                        />
                                        <ChainRow label="Planned resource cost (F)" value={money(chain.f)} />
                                        <ChainRow label="Guaranteed amount (QGR)" sign="+" value={money(chain.qgr)} />
                                        <ChainRow label="Payment base — penalty is a % of this (NPQP)" sign="=" value={money(chain.npqp)} />
                                        <ChainRow
                                            label={`Liquidated damages @ ${pct(chain.cappedLdPercent)} of NPQP`}
                                            value={chain.ldAmount === null ? "—" : `− ${money(chain.ldAmount)}`}
                                            tone={RED}
                                            hint={[
                                                chain.capApplied
                                                    ? `Capped from ${pct(chain.sumLdPercent)} at the ${chain.quarterCapPercent}% quarter ceiling (§5.27.6).`
                                                    : null,
                                                settlementRow?.overrideReason
                                                    ? `⚠ Overridden by finance — "${settlementRow.overrideReason}". This is not the figure this page scored.`
                                                    : null,
                                            ].filter(Boolean).join(" ") || null}
                                        />
                                        <ChainRow
                                            label="Actually earned (PA)"
                                            value={chain.pa === null
                                                ? <span style={{ color: AMBER, fontWeight: 700 }}>not settled yet</span>
                                                : money(chain.pa)}
                                        />
                                        <ChainRow
                                            label="Final payment for the quarter (AQP)"
                                            clause="(PA − LD) + QGR"
                                            sign="="
                                            value={statement.quarterlyNet === null ? "—" : money(statement.quarterlyNet)}
                                            strong
                                            rule
                                            hint={chain.effectiveLdPercentOnPa !== null && chain.ldAmount > 0
                                                ? `The LD is ${Math.round(chain.effectiveLdPercentOnPa * 100) / 100}% of what is actually paid, `
                                                  + `against a headline ${pct(chain.cappedLdPercent)} — it is charged on NPQP but deducted from PA.`
                                                : null}
                                        />

                                        {/* ── C · the invoice ─────────────────────── */}
                                        <ChainRow
                                            label="C · Due this quarter"
                                            clause="A + B"
                                            value={statement.grossDue === null ? "—" : money(statement.grossDue)}
                                            strong
                                            rule
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
                                            label="Net paid to the consultant"
                                            clause="§5.28.1.e"
                                            sign="="
                                            value={money(statement.tax.net)}
                                            strong
                                            rule
                                            tone={GREEN}
                                            hint="LD and NPQP are exclusive of taxes (§5.27.6), so tax applies after the deduction."
                                        />
                                    </tbody>
                                </table>

                                {statement.pending.length > 0 && (
                                    <div style={{
                                        marginTop: 12, padding: "9px 11px", borderRadius: 8,
                                        background: "#fffaf0", border: "1px solid #f0dfc0",
                                        fontSize: 11.5, lineHeight: 1.6, color: "#334155",
                                    }}>
                                        <b style={{ color: AMBER }}>◍ Incomplete</b> — {statement.pending.join(" and ")}{" "}
                                        {statement.pending.length === 1 ? "is" : "are"} not resolved yet, so the total above is
                                        only what is currently known. It is deliberately not treated as zero.
                                        {chain.pa === null && " Close the quarter on the Settlement page to resolve PA from attendance."}
                                    </div>
                                )}

                                {/* ── D · where the contract stands ───────────── */}
                                <div style={{ fontSize: 12.5, fontWeight: 800, color: INK, marginTop: 18 }}>
                                    D · Contract to date <span style={{ ...muted, fontWeight: 400, fontSize: 11 }}>§5.26.2</span>
                                </div>
                                <table style={{ borderCollapse: "collapse", width: "100%", maxWidth: 620, marginTop: 6 }}>
                                    <tbody>
                                        <ChainRow
                                            label="Total paid, settled quarters"
                                            value={cumulative.quarterCount === 0 ? "no quarter closed yet" : money(cumulative.totalAqp)}
                                            hint={cumulative.quarterCount === 0
                                                ? null
                                                : `${cumulative.pricedCount} of ${cumulative.quarterCount} quarters priced`}
                                        />
                                        {cumulative.quarterCount > 0 && (
                                            <>
                                                <ChainRow label="of which invoiced" value={money(cumulative.invoicedAqp)} />
                                                <ChainRow
                                                    label="still provisional"
                                                    value={money(cumulative.provisionalAqp)}
                                                    tone={cumulative.provisionalAqp > 0 ? AMBER : undefined}
                                                    hint={cumulative.provisionalAqp > 0
                                                        ? "Auto-closed but not invoiced — a computation, not yet a commitment."
                                                        : null}
                                                />
                                                <ChainRow label="Total penalties deducted" value={money(cumulative.totalLd)} tone={RED} rule />
                                            </>
                                        )}
                                        <ChainRow
                                            label={`Ceiling — ${ceiling.multiplier ?? 1.25} × contract value`}
                                            value={ceiling.known ? money(ceiling.ceiling) : "—"}
                                            strong
                                            rule
                                            hint={ceiling.known
                                                ? `Contract value ${formatINR(ceiling.contractValue)} plus 25% CCN headroom.`
                                                : ceiling.reason}
                                        />
                                        {ceiling.known && ceiling.remaining !== null && (
                                            <ChainRow
                                                label="Remaining headroom"
                                                value={money(ceiling.remaining)}
                                                tone={ceiling.exceeded ? RED : ceiling.intoCcn ? AMBER : GREEN}
                                                hint={`${Math.round((ceiling.usedPercent ?? 0) * 10) / 10}% of the ceiling used.`}
                                            />
                                        )}
                                    </tbody>
                                </table>

                                <div style={{ fontSize: 11, ...muted, marginTop: 12, lineHeight: 1.6 }}>
                                    <b style={{ color: INK }}>What this does not cover.</b>{" "}
                                    Section A counts only deliverables that had an SLA evaluated this quarter — a
                                    deliverable accepted with no SLA against it is paid but does not appear here.
                                    Section D covers the Phase 2/3 quarterly stream only, so Phase-1 deliverable
                                    payments and the annual Governance Tool payment (D11, §5.25.3) are missing from it
                                    and usage against the ceiling is understated.
                                </div>
                            </div>
                        </>
                    )}
                </>
            )}
        </div>
    );
}
