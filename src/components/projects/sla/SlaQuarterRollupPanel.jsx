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
} from "../../../api/slaCompliance";
import {
    contractQuarters,
    contractQuarterFor,
    calendarQuarterFor,
    withinWindow,
    rollupBySla,
    quarterTotals,
} from "../../../utils/project/slaRollup";
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

/* ─── one SLA group ──────────────────────────────────────────────── */

/* Open state is local, seeded from `defaultOpen`. Expand/collapse-all works
   by changing the React key at the call site so each group remounts with a
   new seed — which is also the behaviour you want: pressing "expand all"
   should override whatever was toggled by hand, not merge with it. */
function SlaGroup({ item, defaultOpen }) {
    const [open, setOpen] = useState(!!defaultOpen);

    const costing = Number(item.ldPercent) > 0;

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

                <span style={{ fontFamily: "monospace", fontSize: 13, fontWeight: 800, color: INK, whiteSpace: "nowrap" }}>
                    {item.slaRef}
                </span>
                {item.formulaType && (
                    <span style={{ fontSize: 11.5, ...muted }}>{String(item.formulaType).replace(/_/g, " ")}</span>
                )}

                <span style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
                    <span className="uidai-pmis-badge uidai-pmis-badge-red" title="Breached occurrences in this quarter">
                        {item.breached} breach{item.breached === 1 ? "" : "es"}
                    </span>
                    {item.met > 0 && <span className="uidai-pmis-badge uidai-pmis-badge-green">{item.met} met</span>}
                    {item.pending > 0 && <span className="uidai-pmis-badge uidai-pmis-badge-orange">{item.pending} pending</span>}
                    {item.capHits > 0 && (
                        <span
                            className="uidai-pmis-badge uidai-pmis-badge-orange"
                            title="Severity above the configured ceiling was capped before scoring"
                        >
                            SLA cap ×{item.capHits}
                        </span>
                    )}
                </span>

                <span style={{ marginLeft: "auto", display: "flex", gap: 18, alignItems: "center", flexWrap: "wrap" }}>
                    <span style={{ textAlign: "right" }}>
                        <span style={{ display: "block", fontSize: 10.5, ...muted, fontWeight: 700, textTransform: "uppercase", letterSpacing: ".3px" }}>
                            Points
                        </span>
                        <span style={{ fontSize: 15, fontWeight: 800, color: INK, fontVariantNumeric: "tabular-nums" }}>
                            {num(item.accumulatedPoints, 0)}
                            {item.pointsCapped && (
                                <span style={{ fontSize: 11, color: AMBER, fontWeight: 700, marginLeft: 4 }} title={`${num(item.excessPoints, 0)} points beyond the top band earn no further LD`}>
                                    ▲
                                </span>
                            )}
                        </span>
                    </span>
                    <span style={{ textAlign: "right", minWidth: 74 }}>
                        <span style={{ display: "block", fontSize: 10.5, ...muted, fontWeight: 700, textTransform: "uppercase", letterSpacing: ".3px" }}>
                            LD %
                        </span>
                        <span style={{ fontSize: 15, fontWeight: 800, color: costing ? RED : GREEN, fontVariantNumeric: "tabular-nums" }}>
                            {pct(item.ldPercent)}
                        </span>
                    </span>
                </span>
            </button>

            {open && (
                <div style={{ padding: "12px 14px" }}>
                    <div style={{ fontSize: 12, ...muted, marginBottom: 10, lineHeight: 1.55 }}>
                        {item.scoredCount} scored occurrence{item.scoredCount === 1 ? "" : "s"} accumulated{" "}
                        <b style={{ color: INK }}>{num(item.accumulatedPoints, 0)} points</b>
                        {item.band ? (
                            <>
                                , which falls in band <b style={{ color: INK }}>{item.band.label}</b> (threshold{" "}
                                {num(item.band.points_threshold, 0)}) → <b style={{ color: costing ? RED : GREEN }}>{pct(item.ldPercent)}</b> of NPQP.
                            </>
                        ) : (
                            " — no LD band matched, so this SLA is unscored."
                        )}
                        {item.unscoredCount > 0 && (
                            <> {item.unscoredCount} occurrence{item.unscoredCount === 1 ? " has" : "s have"} no severity yet and contributed nothing.</>
                        )}
                    </div>

                    <div className="uidai-pmis-table-wrap">
                        <table className="uidai-pmis-table uidai-pmis-table-compact" style={{ marginTop: 0 }}>
                            <thead>
                                <tr>
                                    <th>Activity</th>
                                    <th>Milestone</th>
                                    <th>Status</th>
                                    <th style={{ textAlign: "right" }}>Severity</th>
                                    <th style={{ textAlign: "right" }}>Points</th>
                                    <th style={{ textAlign: "right" }}>Target</th>
                                    <th style={{ textAlign: "right" }}>Actual</th>
                                    <th style={{ textAlign: "right" }}>Delay</th>
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
                                        <td style={{ textAlign: "right", fontVariantNumeric: "tabular-nums", fontWeight: 700 }}>
                                            {o.pointsUnknown ? (
                                                <span title="No severity master row for this level" style={{ color: AMBER }}>?</span>
                                            ) : (
                                                num(o.points, 0)
                                            )}
                                        </td>
                                        <td style={{ textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{num(o.targetDays)}</td>
                                        <td style={{ textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{num(o.actualDays)}</td>
                                        <td style={{
                                            textAlign: "right", fontVariantNumeric: "tabular-nums",
                                            color: Number(o.delayDays) > 0 ? RED : undefined,
                                            fontWeight: Number(o.delayDays) > 0 ? 700 : 400,
                                        }}>
                                            {num(o.delayDays)}
                                        </td>
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

    const [loading, setLoading] = useState(false);
    const [progress, setProgress] = useState({ done: 0, total: 0 });
    const [loadedOnce, setLoadedOnce] = useState(false);
    const [error, setError] = useState("");
    const [partial, setPartial] = useState("");
    const [expandAll, setExpandAll] = useState(false);

    const quarters = useMemo(
        () => contractQuarters(projectStartDate, projectEndDate),
        [projectStartDate, projectEndDate]
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
            const [treeRes, sevRes, ldRes] = await Promise.allSettled([
                loadProjectTree(projectId),
                getSeverityMaster(projectId),
                getLdBands(projectId),
            ]);

            if (treeRes.status === "rejected") {
                throw new Error(treeRes.reason?.message || "Failed to load the project's activities.");
            }
            setSeverityMaster(sevRes.status === "fulfilled" ? sevRes.value : []);
            setLdBands(ldRes.status === "fulfilled" ? ldRes.value : []);

            // Flatten milestone → activity, keeping the labels the rest of
            // the app shows so a row here is recognisable on the mapping page.
            const activities = [];
            for (const [mi, m] of (treeRes.value?.milestones || []).entries()) {
                for (const [ai, a] of (m?.activities || []).entries()) {
                    if (!a?.apiId) continue; // never saved server-side → nothing to evaluate
                    activities.push({
                        apiId: a.apiId,
                        code: a.serverDisplayCode || `A${mi + 1}.${ai + 1}`,
                        name: a.name || "",
                        milestoneName: m?.name || `Milestone ${mi + 1}`,
                    });
                }
            }
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
                            collected.push({
                                ...r,
                                activityId: act.apiId,
                                activityCode: act.code,
                                activityName: act.name,
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

    const { items, scale } = useMemo(
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
    const totals = useMemo(() => quarterTotals(items, { npqp: npqpValue }), [items, npqpValue]);

    const unconfigured = !scale.configured || !ldBands.length;
    const undated = allResults.filter((r) => !r.evaluatedOn).length;

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

            {!quarters.length && (
                <Banner
                    kind="error"
                    text="This project has no start date, so contract quarters cannot be derived. Set the project start date (T0) to use this view."
                />
            )}
            {error && <Banner text={error} kind="error" />}
            {partial && <Banner text={partial} kind="error" />}

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
                    {/* ── quarter totals ────────────────────────────── */}
                    <div className="uidai-pmis-grid-4" style={{ gap: 12, marginTop: 16 }}>
                        <Tile label="SLAs with results" value={num(totals.slaCount, 0)} hint={`${num(totals.totalOccurrences, 0)} occurrences`} />
                        <Tile label="Breaches" value={num(totals.totalBreaches, 0)} accent={totals.totalBreaches > 0 ? RED : GREEN} />
                        <Tile label="Points accumulated" value={num(totals.totalPoints, 0)} hint="after the per-measurement SLA cap" />
                        <Tile
                            label="Sum LD %"
                            value={pct(totals.sumLdPercent)}
                            accent={totals.sumLdPercent > 0 ? RED : GREEN}
                            hint={`${num(totals.contributingCount, 0)} SLA${totals.contributingCount === 1 ? "" : "s"} contributing`}
                        />
                        <Tile
                            label="Capped LD %"
                            value={pct(totals.cappedLdPercent)}
                            accent={RED}
                            hint={totals.capApplied
                                ? `capped from ${pct(totals.sumLdPercent)} at the ${totals.quarterCapPercent}% quarter ceiling`
                                : `quarter ceiling ${totals.quarterCapPercent}% · RFP §5.27.6`}
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

                    {/* ── grouped SLAs ──────────────────────────────── */}
                    <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 20, flexWrap: "wrap" }}>
                        <div style={{ fontSize: 13.5, fontWeight: 800, color: INK }}>
                            By SLA
                        </div>
                        <span style={{ background: "#dceafe", color: "#1f4e87", borderRadius: 999, padding: "1px 8px", fontSize: 11, fontWeight: 800 }}>
                            {items.length}
                        </span>
                        {items.length > 0 && (
                            <button
                                type="button"
                                className="uidai-pmis-btn uidai-pmis-btn-cancel uidai-pmis-btn-small"
                                style={{ marginTop: 0, marginLeft: "auto" }}
                                onClick={() => setExpandAll((v) => !v)}
                            >
                                {expandAll ? "Collapse all" : "Expand all"}
                            </button>
                        )}
                    </div>

                    {items.length === 0 ? (
                        <div className="uidai-pmis-filter-shell" style={{ marginTop: 12, textAlign: "center", padding: 24 }}>
                            <div style={{ fontSize: 13, ...muted }}>
                                {loadedOnce
                                    ? `No SLA evaluations were recorded between ${period?.start} and ${period?.end}.`
                                    : "Nothing loaded yet."}
                            </div>
                            {loadedOnce && allResults.length > 0 && (
                                <div style={{ fontSize: 12, ...muted, marginTop: 6 }}>
                                    This project has {allResults.length} result{allResults.length === 1 ? "" : "s"} in
                                    other quarters — try a different period.
                                </div>
                            )}
                        </div>
                    ) : (
                        items.map((it) => (
                            <SlaGroup key={`${it.slaRef}:${expandAll}`} item={it} defaultOpen={expandAll} />
                        ))
                    )}

                    {/* ── how the number was reached ────────────────── */}
                    {items.length > 0 && (
                        <div style={{
                            marginTop: 16, background: "#f0f6ff", border: "1px solid #c8d6ee",
                            borderRadius: 10, padding: "12px 15px", fontSize: 12, color: "#334155", lineHeight: 1.7,
                        }}>
                            <b style={{ color: INK }}>How this quarter was scored.</b>{" "}
                            Each evaluation's severity is capped at level{" "}
                            <b>{scale.capLevel ?? "—"}</b> and converted to points
                            {scale.rows.length > 0 && (
                                <> ({scale.rows.map((r) => `L${r.level}→${r.points}`).join(", ")})</>
                            )}
                            . Points accumulate per SLA across the reporting interval, and the total is looked up in the
                            LD band table
                            {ldBands.length > 0 && (
                                <> ({[...ldBands].sort((a, b) => a.points_threshold - b.points_threshold)
                                    .map((b) => `≥${b.points_threshold}→${b.ld_percent}%`).join(", ")})</>
                            )}
                            . Every SLA's LD % is summed, then capped at {totals.quarterCapPercent}% of NPQP for the
                            quarter and applied to the payment base.
                            {undated > 0 && (
                                <>
                                    {" "}
                                    <span style={{ color: AMBER }}>
                                        {undated} result{undated === 1 ? " has" : "s have"} no evaluation date and appear
                                        in no quarter.
                                    </span>
                                </>
                            )}
                        </div>
                    )}
                </>
            )}
        </div>
    );
}
