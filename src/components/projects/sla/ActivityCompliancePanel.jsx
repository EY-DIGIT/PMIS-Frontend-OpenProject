// ---------------------------------------------------------------------------
// Activity-scoped SLA compliance — the "Pre-plan" pair:
//   POST …/sla-compliance/activities/{id}/on-complete  (trigger on completion)
//   GET  …/sla-compliance/activities/{id}              (all results + rollup)
//
// Prop-driven (`activityId`), so it can move to an activity detail page or a
// completion modal without touching anything else.
// ---------------------------------------------------------------------------
import React, { useCallback, useEffect, useState } from "react";
import { triggerActivityOnComplete, getActivityCompliance } from "../../../api/slaCompliance";
import { formatINR } from "../../../utils/project/helpers";

const muted = { color: "var(--uidai-pmis-muted)" };

function num(v) {
    if (v === null || v === undefined || v === "") return "—";
    const n = Number(v);
    return Number.isNaN(n) ? String(v) : n.toLocaleString("en-IN", { maximumFractionDigits: 2 });
}
function pct(v) {
    if (v === null || v === undefined || v === "") return "—";
    const n = Number(v);
    return Number.isNaN(n) ? String(v) : `${n}%`;
}
function money(v) {
    return v === null || v === undefined || v === "" ? "—" : formatINR(v);
}

function Banner({ text, kind }) {
    if (!text) return null;
    const bad = kind === "error" || (kind === undefined && /fail|error|missing|cannot/i.test(text));
    return (
        <div className={`uidai-pmis-badge ${bad ? "uidai-pmis-badge-red" : "uidai-pmis-badge-green"}`}
            style={{ display: "block", borderRadius: 8, padding: "10px 12px", marginTop: 12, fontWeight: 600, whiteSpace: "pre-line" }}>
            {text}
        </div>
    );
}

function Tile({ label, value, accent }) {
    return (
        <div style={{ background: "#f6f9fd", border: "1px solid var(--uidai-pmis-border)", borderRadius: 10, padding: "12px 14px" }}>
            <div style={{ fontSize: 11, ...muted, fontWeight: 700, marginBottom: 6, textTransform: "uppercase", letterSpacing: ".3px" }}>{label}</div>
            <div style={{ fontSize: 20, fontWeight: 800, color: accent || "#173e77", lineHeight: 1.15 }}>{value}</div>
        </div>
    );
}

// Higher severity = worse.
function severityAccent(level) {
    const n = Number(level);
    if (!Number.isFinite(n)) return "#173e77";
    if (n >= 3) return "#c0392b";
    if (n === 2) return "#c77700";
    return "#1f8a4c";
}

const RESULT_BADGE = { breached: "uidai-pmis-badge-red", met: "uidai-pmis-badge-green", pending: "uidai-pmis-badge-orange" };

export default function ActivityCompliancePanel({ activityId, activityLabel }) {
    const [data, setData] = useState(null);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState("");
    const [notice, setNotice] = useState("");
    const [triggering, setTriggering] = useState(false);
    const [triggerResult, setTriggerResult] = useState(null);

    const load = useCallback(async () => {
        if (!activityId) { setData(null); return; }
        setLoading(true);
        setError("");
        try {
            setData(await getActivityCompliance(activityId));
        } catch (err) {
            setError(err?.message || "Failed to load SLA compliance for this activity.");
            setData(null);
        } finally {
            setLoading(false);
        }
    }, [activityId]);

    useEffect(() => { load(); }, [load]);

    // Fires the completion hook. The backend scores what it can — since
    // 2026-08-11 that includes the resource SLAs (005–009), which come
    // back under `autoEvaluated` with a point_accumulation result — and
    // emails the owners of anything left in `manualNeeded`, now usually
    // empty. Both counts are still reported: `manualNeeded` shrinking to
    // nothing is a backend behaviour, not a guarantee to hard-code.
    async function runOnComplete() {
        if (!activityId) { setError("Missing activity id."); return; }
        setTriggering(true);
        setError("");
        setNotice("");
        setTriggerResult(null);
        try {
            const res = await triggerActivityOnComplete(activityId);
            setTriggerResult(res);
            const auto = res?.autoEvaluated?.length || 0;
            const manual = res?.manualNeeded?.length || 0;
            const errs = res?.errors?.length || 0;
            setNotice(
                `Evaluated on ${res?.evaluatedOn || "—"}: ${auto} auto-evaluated`
                + (manual ? `, ${manual} awaiting manual input` : "")
                + (errs ? `, ${errs} error(s).` : ".")
                + (manual ? " Owners have been emailed." : "")
            );
            load();
        } catch (err) {
            setError(err?.message || "Failed to trigger the completion evaluation.");
        } finally {
            setTriggering(false);
        }
    }

    const results = Array.isArray(data?.results) ? data.results : [];
    const available = data?.available !== false;

    return (
        <div className="uidai-pmis-card" style={{ marginBottom: 0, width: "100%" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 12 }}>
                <div>
                    <div style={{ fontSize: 16, fontWeight: 800, color: "#173e77" }}>SLA Compliance</div>
                    <div style={{ fontSize: 12, ...muted, marginTop: 2 }}>
                        Recorded evaluation results for activity{" "}
                        <code style={{ background: "#f1f6fd", padding: "2px 8px", borderRadius: 6, color: "#173e77", fontWeight: 700 }}>
                            {activityLabel || activityId || "—"}
                        </code>
                    </div>
                </div>
                <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
                    <button type="button" className="uidai-pmis-btn uidai-pmis-btn-cancel uidai-pmis-btn-small" style={{ marginTop: 0 }} onClick={load} disabled={loading || !activityId}>
                        {loading ? "Loading…" : "↻ Reload"}
                    </button>
                    <button type="button" className="uidai-pmis-btn uidai-pmis-btn-small" style={{ marginTop: 0 }} onClick={runOnComplete} disabled={triggering || !activityId}>
                        {triggering ? "Evaluating…" : "✓ Run completion evaluation"}
                    </button>
                </div>
            </div>

            {error && <Banner text={error} kind="error" />}
            {notice && <Banner text={notice} kind="ok" />}

            {/* Manual-input SLAs from the last trigger — the actionable half of
                the on-complete response. */}
            {triggerResult?.manualNeeded?.length > 0 && (
                <div className="uidai-pmis-filter-shell" style={{ marginTop: 14 }}>
                    <div className="uidai-pmis-filter-head">
                        <div className="uidai-pmis-filter-title">Awaiting manual observation ({triggerResult.manualNeeded.length})</div>
                    </div>
                    <div style={{ fontSize: 12.5, ...muted, marginTop: 10, lineHeight: 1.6 }}>
                        {/* Driven by the backend's own `manualNeeded`, so this
                            list is correct whatever it contains — but the
                            wording no longer implies the resource SLAs live
                            here. Since 2026-08-11 they are auto-evaluated, so
                            one turning up in this list is worth questioning
                            rather than simply typing in. */}
                        The backend could not score these automatically — use <b style={{ color: "#173e77" }}>Evaluate</b> on the mapping row to enter what was observed.
                        Resource SLAs (005&ndash;009) are normally scored from attendance, so one appearing here means its measurement was unavailable.
                        <ul style={{ margin: "8px 0 0", paddingLeft: 18 }}>
                            {triggerResult.manualNeeded.map((m, i) => (
                                <li key={m.mapping_id || i}>
                                    <b style={{ color: "#173e77", fontFamily: "monospace", fontSize: 12 }}>{m.sla_ref || m.sla_id}</b>
                                    {m.reason ? ` — ${m.reason}` : ""}
                                </li>
                            ))}
                        </ul>
                    </div>
                </div>
            )}
            {triggerResult?.errors?.length > 0 && (
                <Banner kind="error" text={`Evaluation errors:\n${triggerResult.errors.map((e) => (typeof e === "string" ? e : JSON.stringify(e))).join("\n")}`} />
            )}

            {/* Rollup + per-SLA results */}
            {loading ? (
                <div style={{ padding: 26, textAlign: "center", ...muted, fontSize: 13 }}>Loading compliance…</div>
            ) : !data ? null : !available ? (
                <div style={{ padding: 26, textAlign: "center", ...muted, fontSize: 13 }}>
                    No compliance data yet for this activity{data.data_state ? ` (${data.data_state})` : ""}.
                </div>
            ) : (
                <>
                    <div className="uidai-pmis-grid-4" style={{ gap: 12, marginTop: 16 }}>
                        <Tile label="Compliance" value={pct(data.compliance)} accent={Number(data.compliance) >= 100 ? "#1f8a4c" : "#c0392b"} />
                        <Tile label="Met" value={num(data.met)} accent="#1f8a4c" />
                        <Tile label="Breached" value={num(data.breached)} accent="#c0392b" />
                        <Tile label="Evaluated" value={num(data.evaluated)} />
                        <Tile label="Pending" value={num(data.pending)} accent="#c77700" />
                        <Tile label="Excluded" value={num(data.excluded)} />
                    </div>

                    {results.length === 0 ? (
                        <div style={{ padding: 22, textAlign: "center", ...muted, fontSize: 13, marginTop: 12 }}>
                            No SLA results recorded yet — run the completion evaluation above.
                        </div>
                    ) : (
                        <div className="uidai-pmis-table-wrap" style={{ marginTop: 14 }}>
                            <table className="uidai-pmis-table uidai-pmis-table-compact">
                                <thead>
                                    <tr>
                                        <th>SLA Ref</th><th>Formula</th><th>Status</th>
                                        <th style={{ textAlign: "right" }}>Severity</th>
                                        <th style={{ textAlign: "right" }}>Points</th>
                                        <th style={{ textAlign: "right" }}>Target Days</th>
                                        <th style={{ textAlign: "right" }}>Actual Days</th>
                                        <th style={{ textAlign: "right" }}>Delay</th>
                                        <th style={{ textAlign: "right" }}>LD %</th>
                                        <th style={{ textAlign: "right" }}>LD Amount</th>
                                        <th>Evaluated On</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {results.map((r, i) => (
                                        <tr key={r.mappingId || i}>
                                            <td style={{ fontFamily: "monospace", fontSize: 12, fontWeight: 700, color: "#173e77", whiteSpace: "nowrap" }}>{r.slaRef || "—"}</td>
                                            <td>{String(r.formulaType || "—").replace(/_/g, " ")}</td>
                                            <td><span className={`uidai-pmis-badge ${RESULT_BADGE[r.status] || "uidai-pmis-badge-orange"}`}>{r.status || "—"}</span></td>
                                            <td style={{ textAlign: "right", fontVariantNumeric: "tabular-nums", fontWeight: 700, color: severityAccent(r.severityLevel) }}>{num(r.severityLevel)}</td>
                                            <td style={{ textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{num(r.accumulatedPoints)}</td>
                                            <td style={{ textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{num(r.targetDays)}</td>
                                            <td style={{ textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{num(r.actualDays)}</td>
                                            <td style={{ textAlign: "right", fontVariantNumeric: "tabular-nums", color: Number(r.delayDays) > 0 ? "#c0392b" : undefined, fontWeight: Number(r.delayDays) > 0 ? 700 : 400 }}>{num(r.delayDays)}</td>
                                            <td style={{ textAlign: "right", fontVariantNumeric: "tabular-nums", fontWeight: 700 }}>{pct(r.ldPercent)}</td>
                                            <td style={{ textAlign: "right", fontVariantNumeric: "tabular-nums" }} title={r.ldBaseKind ? `Base: ${r.ldBaseKind}` : undefined}>{money(r.ldAmount)}</td>
                                            <td style={{ fontSize: 12, ...muted, whiteSpace: "nowrap" }}>{r.evaluatedOn || "—"}</td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    )}
                    {results.some((r) => r.ldAmount === null) && (
                        <div style={{ fontSize: 11.5, ...muted, marginTop: 8, fontStyle: "italic" }}>
                            LD amounts are null until the quarter&rsquo;s PQP base is resolved — see the quarterly settlement below.
                        </div>
                    )}
                </>
            )}
        </div>
    );
}
