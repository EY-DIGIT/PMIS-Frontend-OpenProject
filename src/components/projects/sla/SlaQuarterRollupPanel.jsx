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
} from "../../../api/slaCompliance";
import { getPaymentPage, isFinanceForbidden } from "../../../api/paymentPage";
import {
    contractQuarters,
    contractQuarterFor,
    calendarQuarterFor,
    withinWindow,
    rollupBySla,
    quarterTotals,
    deliverableTotals,
    TRACK,
    SCORING,
} from "../../../utils/project/slaRollup";
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

/* Open state is local, seeded from `defaultOpen`. Expand/collapse-all works
   by changing the React key at the call site so each group remounts with a
   new seed — which is also the behaviour you want: pressing "expand all"
   should override whatever was toggled by hand, not merge with it.

   One component serves both regimes because the shell is identical; only
   the header figures and the occurrence columns differ, and splitting it
   in two would duplicate the badges, the chrome and the empty states. */
function SlaGroup({ item, defaultOpen }) {
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
                </span>

                {/* Deliverable SLAs are charged in rupees on each deliverable's own
                    cost, so a percentage headline would be comparing unlike bases.
                    Points-scored SLAs lead with points; the linear NPQP one (SLA
                    003) has no points, so it leads with the delay that drove it. */}
                <span style={{ marginLeft: "auto", display: "flex", gap: 18, alignItems: "center", flexWrap: "wrap" }}>
                    {isDeliverable ? (
                        <>
                            <Metric label="Deliverables" value={num(item.occurrences.length, 0)} />
                            <Metric label="LD amount" value={money(item.totalLdAmount)} accent={costing ? RED : GREEN} />
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
    const [npqp, setNpqp] = useState(null);
    const [npqpError, setNpqpError] = useState("");
    const [mastersError, setMastersError] = useState("");
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
    const calendar = useMemo(() => calendarQuarterFor(period), [period]);

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
            const [treeRes, sevRes, ldRes, mastersRes, financeRes] = await Promise.allSettled([
                loadProjectTree(projectId),
                getSeverityMaster(projectId),
                getLdBands(projectId),
                listSlaMasters(projectId),
                getPaymentPage(projectId),
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
       usually the whole diagnosis. */
    useEffect(() => {
        let cancelled = false;
        setNpqpError("");
        if (!projectId || !calendar?.key) { setNpqp(null); return undefined; }
        getNpqp(projectId, calendar.key)
            .then((d) => { if (!cancelled) setNpqp(d); })
            .catch((err) => {
                if (cancelled) return;
                setNpqp(null);
                setNpqpError(err?.message || "request failed");
            });
        return () => { cancelled = true; };
    }, [projectId, calendar?.key]);

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
    const npqpOk = !npqp?.status || npqp.status === "ok";
    const npqpValue = npqp && npqpOk ? npqp.npqp : null;
    const npqpIssue = npqp && !npqpOk
        ? (npqp.status === "leave_mgmt_unavailable"
            ? "leave-management unreachable, so F could not be computed"
            : `NPQP status: ${npqp.status}`)
        : npqpError
            ? `NPQP call failed — ${npqpError}`
            : null;
    const totals = useMemo(
        () => quarterTotals(quarterlyItems, { npqp: npqpValue }),
        [quarterlyItems, npqpValue]
    );
    const dTotals = useMemo(() => deliverableTotals(deliverableItems), [deliverableItems]);

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
    const needsScale = quarterlyItems.some((i) => i.scoring === SCORING.POINTS);
    const unconfigured = needsScale && (!scale.configured || !ldBands.length);
    const undated = allResults.filter((r) => !r.evaluatedOn).length;
    const nothingFound = deliverableItems.length === 0 && quarterlyItems.length === 0;

    return (
        <div className="uidai-pmis-card" style={{ marginBottom: 0, width: "100%" }}>
            {/* ── header + period pickers ───────────────────────────── */}
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", flexWrap: "wrap", gap: 12 }}>
                <div>
                    <div style={{ fontSize: 16, fontWeight: 800, color: INK }}>SLA Rollup by Quarter</div>
                    <div style={{ fontSize: 12, ...muted, marginTop: 2 }}>
                        Every SLA scored for one contract quarter, with the activities that produced each breach.
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
                    {calendar && !calendar.aligned && (
                        <>
                            <br />
                            <span style={{ color: AMBER }}>
                                ⚠ NPQP is published per calendar quarter, so the payment base below is taken from{" "}
                                <b>{calendar.key}</b> ({calendar.start} → {calendar.end}), which only partly overlaps this
                                contract quarter. Points and breaches are exact; the money line is indicative.
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

            {/* The split is only as good as the evidence behind it. If SLAs had
                to be placed by default, the deliverable section being empty is
                not a finding — it is a gap in the data, and saying which SLAs
                and why is the difference between a diagnosis and a shrug. */}
            {loadedOnce && classification.defaulted > 0 && (
                <Banner
                    kind="error"
                    text={
                        `${classification.defaulted} of ${classification.total} SLA(s) carried no LD base ` +
                        `(applied_on) and no category, so they were placed in the Quarterly section by default: ` +
                        `${classification.defaultedRefs.join(", ")}.\n` +
                        (mastersError
                            ? `The SLA library could not be read (${mastersError}), which is why the fallback had nothing to use.`
                            : `Set each SLA's category on the SLA Library — DELIVERABLE_SUBMISSION is what routes an SLA to the deliverable section.`)
                    }
                />
            )}
            {/* The quiet one. `applied_on` defaults to QUARTERLY_PAYMENT
                server-side, so an SLA with no category does not arrive looking
                like missing data — it arrives looking like a confident
                "quarterly". Every such SLA lands in the quarterly section and
                the deliverable section reads as a genuine zero. Naming them is
                the only way to tell "no deliverable SLAs" from "nobody set a
                category". */}
            {loadedOnce && classification.byLdBaseKind > 0 && classification.byCategory === 0 && (
                <Banner
                    kind="error"
                    text={
                        `${classification.byLdBaseKind} of ${classification.total} SLA(s) carry no category, so the ` +
                        `track was taken from applied_on alone: ${classification.byLdBaseKindRefs.join(", ")}.\n` +
                        `applied_on defaults to QUARTERLY_PAYMENT server-side, so SLA 001 / 002 land in the quarterly ` +
                        `section this way even when they are deliverable SLAs.\n` +
                        (slaLibraryEmpty
                            ? `The SLA library returned no rows for this project, so there was no category to fall back on — ` +
                              `check that these SLAs are saved against this project on the SLA Library.`
                            : `Open each on the SLA Library and set SLA Category to Deliverable Submission.`)
                    }
                />
            )}
            {/* Not fatal — the category was trusted and the SLA is in the right
                section — but the stored applied_on is wrong at source and will
                keep misleading anything that reads it without this correction. */}
            {loadedOnce && classification.conflictCount > 0 && (
                <Banner
                    kind="error"
                    text={
                        `${classification.conflictCount} SLA(s) have an "Applied On" that contradicts their category, ` +
                        `and were classified by category:\n` +
                        classification.conflicts
                            .map((c) => `  · ${c.slaRef} — category ${c.category}, but stored as ${c.storedBase}`)
                            .join("\n") +
                        `\nThe contracts service defaults Applied On to QUARTERLY_PAYMENT when it is not set explicitly. ` +
                        `Re-save these on the SLA Library to correct the stored value.`
                    }
                />
            )}
            {loadedOnce && mastersError && classification.defaulted === 0 && (
                <Banner
                    kind="error"
                    text={`SLA library unavailable (${mastersError}) — titles are missing, but every SLA classified itself from its own result data, so the split below is unaffected.`}
                />
            )}

            {unconfigured && loadedOnce && (
                <Banner
                    kind="error"
                    text={
                        "Scoring configuration is incomplete — " +
                        [!scale.configured && "no severity levels", !ldBands.length && "no LD bands"]
                            .filter(Boolean).join(" and ") +
                        " are configured for this project. Points and LD % cannot be computed until Severity & LD Bands is set up."
                    }
                />
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
                            {/* ══ Quarterly track (§5.28.3 / §5.28.4) ══════════════
                                Resource, recommendation and governance-tool SLAs. All
                                measured and reported quarterly and charged against
                                NPQP, so these — and only these — sum into the §5.27.6
                                quarter ceiling. */}
                            <SectionHead
                                title="Quarterly SLAs — resource, recommendation &amp; governance tool"
                                count={quarterlyItems.length}
                                sub="Charged on NPQP · RFP §5.28.3–5.28.4 · summed and capped for the quarter"
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
                                        <Tile label="Points accumulated" value={num(totals.totalPoints, 0)} hint="after the per-measurement SLA cap" />
                                        <Tile
                                            label="Sum LD %"
                                            value={pct(totals.sumLdPercent)}
                                            accent={totals.sumLdPercent > 0 ? RED : GREEN}
                                            hint={`${num(totals.contributingCount, 0)} SLA${totals.contributingCount === 1 ? "" : "s"} contributing · §5.28.1.d`}
                                        />
                                        <Tile
                                            label="Capped LD %"
                                            value={pct(totals.cappedLdPercent)}
                                            accent={RED}
                                            hint={totals.capApplied
                                                ? `capped from ${pct(totals.sumLdPercent)} at the ${totals.quarterCapPercent}% ceiling`
                                                : `quarter ceiling ${totals.quarterCapPercent}% · §5.27.6`}
                                        />
                                        <Tile
                                            label="NPQP"
                                            value={money(totals.npqp)}
                                            hint={npqpIssue || (calendar ? `calendar ${calendar.key}` : undefined)}
                                            accent={npqpIssue ? AMBER : undefined}
                                        />
                                        <Tile
                                            label="LD amount"
                                            value={money(totals.ldAmount)}
                                            accent={RED}
                                            hint={totals.npqp === null ? "needs an NPQP base" : "capped LD % × NPQP"}
                                        />
                                    </div>
                                    {quarterlyItems.map((it) => (
                                        <SlaGroup key={`q:${it.slaRef}:${expandAll}`} item={it} defaultOpen={expandAll} />
                                    ))}
                                </>
                            )}

                            {/* ══ Deliverable track (§5.28.2) ══════════════════════
                                SLA 001/002 fire on a deliverable's completion and are
                                charged on that deliverable's cost, so they are totalled
                                in rupees and kept out of the NPQP ceiling entirely. */}
                            <SectionHead
                                title="Deliverable-linked SLAs — submission &amp; defect rectification"
                                count={deliverableItems.length}
                                sub="Charged on each deliverable's own cost · RFP §5.28.2 · outside the NPQP ceiling"
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
                                            label="LD amount"
                                            value={money(dTotals.totalLdAmount)}
                                            accent={RED}
                                            hint={dTotals.unpricedCount > 0
                                                ? `${dTotals.unpricedCount} occurrence(s) still unpriced`
                                                : "sum of per-deliverable LD"}
                                        />
                                    </div>
                                    {deliverableItems.map((it) => (
                                        <SlaGroup key={`d:${it.slaRef}:${expandAll}`} item={it} defaultOpen={expandAll} />
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
                                        sub="LD charged on the milestone's LD Basis (its full allotment) · deducted from the scheduled payment · RFP §5.28.2"
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

                            {/* ── how the numbers were reached ────────────── */}
                            <div style={{
                                marginTop: 20, background: "#f0f6ff", border: "1px solid #c8d6ee",
                                borderRadius: 10, padding: "12px 15px", fontSize: 12, color: "#334155", lineHeight: 1.7,
                            }}>
                                <b style={{ color: INK }}>How this period was scored.</b>{" "}
                                The RFP runs two separate LD regimes and they are never added together.
                                <br />
                                <b style={{ color: INK }}>Quarterly (§5.28.3–5.28.4).</b>{" "}
                                Each evaluation&rsquo;s severity is capped at level <b>{scale.capLevel ?? "—"}</b> and
                                converted to points
                                {scale.rows.length > 0 && (
                                    <> ({scale.rows.map((r) => `L${r.level}→${r.points}`).join(", ")})</>
                                )}
                                . Points accumulate per SLA across the reporting interval and the total is read off the
                                LD band table
                                {ldBands.length > 0 && (
                                    <> ({[...ldBands].sort((a, b) => a.points_threshold - b.points_threshold)
                                        .map((b) => `≥${b.points_threshold}→${b.ld_percent}%`).join(", ")})</>
                                )}
                                , whose top row is also the per-SLA ceiling (§5.28.1.b). Every SLA&rsquo;s LD % is then
                                summed and the sum capped at {totals.quarterCapPercent}% of NPQP (§5.27.6) — the RFP caps
                                the total, never the individual SLAs, so the per-SLA figures above are left as scored.
                                <br />
                                <b style={{ color: INK }}>Deliverable-linked (§5.28.2).</b>{" "}
                                SLA 001 and 002 deduct a fixed percentage per week of delay from{" "}
                                <b>that deliverable&rsquo;s own cost</b>, with no severity, points or NPQP involved —
                                §5.28.2.a states resource-based SLAs do not apply in Phase 1 at all.
                                {undated > 0 && (
                                    <>
                                        <br />
                                        <span style={{ color: AMBER }}>
                                            {undated} result{undated === 1 ? " has" : "s have"} no evaluation date and so
                                            appear in no period.
                                        </span>
                                    </>
                                )}
                            </div>
                        </>
                    )}
                </>
            )}
        </div>
    );
}
