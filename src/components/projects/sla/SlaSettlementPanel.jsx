// ---------------------------------------------------------------------------
// Project-level SLA settlement — Phase B (quarterly aggregate), Phase C (NPQP),
// Phase D (settlement / override) and Phase E (mark invoiced) for one quarter.
//
// Self-contained and prop-driven (`projectId` only), so it can be dropped onto
// a dedicated project page later by moving this one import.
// ---------------------------------------------------------------------------
import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
    getQuarterlyAggregate,
    getNpqp,
    listSettlements,
    getSettlement,
    overrideSettlement,
    markSettlementInvoiced,
    quarterKeyOf,
    recentQuarterKeys,
    parseQuarterKey,
} from "../../../api/slaCompliance";
import { formatINR } from "../../../utils/project/helpers";

const muted = { color: "var(--uidai-pmis-muted)" };

function pct(v) {
    if (v === null || v === undefined || v === "") return "—";
    const n = Number(v);
    return Number.isNaN(n) ? String(v) : `${n}%`;
}
function money(v) {
    if (v === null || v === undefined || v === "") return "—";
    return formatINR(v);
}
function dateTime(v) {
    if (!v) return "—";
    const d = new Date(v);
    return Number.isNaN(d.getTime()) ? String(v) : d.toLocaleString("en-IN");
}

// Settlement lifecycle → badge colour. `invoiced` is terminal/immutable.
const SETTLEMENT_BADGE = {
    invoiced: "uidai-pmis-badge-green",
    auto_closed: "uidai-pmis-badge-orange",
    overridden: "uidai-pmis-badge-orange",
};
function StatusBadge({ status }) {
    const cls = SETTLEMENT_BADGE[status] || "uidai-pmis-badge-orange";
    return <span className={`uidai-pmis-badge ${cls}`}>{status ? status.replace(/_/g, " ") : "—"}</span>;
}

function Banner({ text, kind }) {
    if (!text) return null;
    const bad = kind === "error" || (kind === undefined && /fail|error|unavailable|cannot|invalid/i.test(text));
    return (
        <div
            className={`uidai-pmis-badge ${bad ? "uidai-pmis-badge-red" : "uidai-pmis-badge-green"}`}
            style={{ display: "block", borderRadius: 8, padding: "10px 12px", marginTop: 12, fontWeight: 600, whiteSpace: "pre-line" }}
        >
            {text}
        </div>
    );
}

function Tile({ label, value, accent, hint }) {
    return (
        <div style={{ background: "#f6f9fd", border: "1px solid var(--uidai-pmis-border)", borderRadius: 10, padding: "12px 14px" }}>
            <div style={{ fontSize: 11, ...muted, fontWeight: 700, marginBottom: 6, textTransform: "uppercase", letterSpacing: ".3px" }}>{label}</div>
            <div style={{ fontSize: 20, fontWeight: 800, color: accent || "#173e77", lineHeight: 1.15, wordBreak: "break-word" }}>{value}</div>
            {hint && <div style={{ fontSize: 11, ...muted, marginTop: 4 }}>{hint}</div>}
        </div>
    );
}

function Section({ title, badge, defaultOpen = false, children }) {
    const [open, setOpen] = useState(!!defaultOpen);
    return (
        <div style={{ border: "1px solid var(--uidai-pmis-border)", borderRadius: 10, marginTop: 12, background: "#fff", overflow: "hidden" }}>
            <button
                type="button"
                onClick={() => setOpen((o) => !o)}
                style={{ width: "100%", textAlign: "left", border: "none", background: open ? "#eef4ff" : "#f6f9fd", padding: "11px 14px", display: "flex", alignItems: "center", gap: 10, cursor: "pointer", font: "inherit" }}
            >
                <span style={{ transition: "transform .15s ease", transform: open ? "rotate(90deg)" : "none", ...muted, fontSize: 11 }}>▶</span>
                <span style={{ fontWeight: 800, color: "#173e77", fontSize: 13.5 }}>{title}</span>
                {badge != null && (
                    <span style={{ marginLeft: 8, background: "#dceafe", color: "#1f4e87", borderRadius: 999, padding: "1px 8px", fontSize: 11, fontWeight: 800 }}>{badge}</span>
                )}
            </button>
            {open && <div style={{ padding: 14 }}>{children}</div>}
        </div>
    );
}

export default function SlaSettlementPanel({ projectId }) {
    const quarterOptions = useMemo(() => recentQuarterKeys(8), []);
    const [quarter, setQuarter] = useState(() => quarterKeyOf());
    const range = useMemo(() => parseQuarterKey(quarter), [quarter]);

    const [aggregate, setAggregate] = useState(null);
    const [npqp, setNpqp] = useState(null);
    const [settlement, setSettlement] = useState(null);
    const [history, setHistory] = useState([]);

    const [loading, setLoading] = useState(false);
    const [closing, setClosing] = useState(false);
    const [error, setError] = useState("");
    const [notice, setNotice] = useState("");

    // Override / invoice forms
    const [showOverride, setShowOverride] = useState(false);
    const [overrideForm, setOverrideForm] = useState({ sumLdPercent: "", overrideReason: "" });
    const [overrideLoading, setOverrideLoading] = useState(false);
    const [invoiceRef, setInvoiceRef] = useState("");
    const [invoiceLoading, setInvoiceLoading] = useState(false);

    // Load the two pure reads (aggregate + NPQP) plus the settlement history.
    // The per-quarter settlement is deliberately NOT fetched here: that call
    // auto-closes the quarter as a side effect, so it stays behind a button.
    const load = useCallback(async () => {
        if (!projectId) { setError("Missing project id."); return; }
        setLoading(true);
        setError("");
        setNotice("");
        setShowOverride(false);
        const [aggRes, npqpRes, histRes] = await Promise.allSettled([
            getQuarterlyAggregate(projectId, quarter),
            getNpqp(projectId, quarter),
            listSettlements(projectId),
        ]);
        const problems = [];
        if (aggRes.status === "fulfilled") setAggregate(aggRes.value);
        else { setAggregate(null); problems.push(`Quarterly aggregate: ${aggRes.reason?.message || "failed"}`); }

        if (npqpRes.status === "fulfilled") setNpqp(npqpRes.value);
        else { setNpqp(null); problems.push(`NPQP: ${npqpRes.reason?.message || "failed"}`); }

        const rows = histRes.status === "fulfilled" ? (histRes.value?.items || []) : [];
        setHistory(rows);
        if (histRes.status === "rejected") problems.push(`Settlement history: ${histRes.reason?.message || "failed"}`);

        // If this quarter has already been closed, show it without re-triggering
        // the lazy auto-close.
        const existing = range
            ? rows.find((r) => r.fiscalYear === range.year && r.quarter === range.quarter)
            : null;
        setSettlement(existing || null);

        if (problems.length) setError(problems.join("\n"));
        setLoading(false);
    }, [projectId, quarter, range]);

    useEffect(() => { load(); }, [load]);

    // Explicit auto-close: computes rollup + NPQP + cap + AQP and persists the row.
    async function closeQuarter() {
        setClosing(true);
        setError("");
        setNotice("");
        try {
            const row = await getSettlement(projectId, quarter);
            setSettlement(row);
            setNotice(`Quarter ${quarter} settled (${row?.status || "closed"}).`);
            listSettlements(projectId).then((r) => setHistory(r?.items || [])).catch(() => { });
        } catch (err) {
            setError(err?.message || "Failed to close the quarter.");
        } finally {
            setClosing(false);
        }
    }

    async function submitOverride() {
        const raw = overrideForm.sumLdPercent;
        if (raw === "" || Number.isNaN(Number(raw))) { setError("Enter a numeric sum LD %."); return; }
        if (!overrideForm.overrideReason.trim()) { setError("An override reason is required for the audit trail."); return; }
        setOverrideLoading(true);
        setError("");
        setNotice("");
        try {
            const row = await overrideSettlement(projectId, quarter, {
                sumLdPercent: Number(raw),
                overrideReason: overrideForm.overrideReason.trim(),
            });
            setSettlement(row);
            setShowOverride(false);
            setNotice(`Override applied — capped LD is now ${pct(row?.cappedLdPercent)}.`);
            listSettlements(projectId).then((r) => setHistory(r?.items || [])).catch(() => { });
        } catch (err) {
            setError(err?.message || "Failed to override the settlement.");
        } finally {
            setOverrideLoading(false);
        }
    }

    async function submitInvoiced() {
        if (!invoiceRef.trim()) { setError("Enter the invoice reference."); return; }
        setInvoiceLoading(true);
        setError("");
        setNotice("");
        try {
            const row = await markSettlementInvoiced(projectId, quarter, invoiceRef.trim());
            setSettlement(row);
            setInvoiceRef("");
            setNotice(`Settlement locked against ${row?.overrideReason || invoiceRef}. Further changes need a credit note.`);
            listSettlements(projectId).then((r) => setHistory(r?.items || [])).catch(() => { });
        } catch (err) {
            setError(err?.message || "Failed to mark the settlement invoiced.");
        } finally {
            setInvoiceLoading(false);
        }
    }

    const invoiced = settlement?.status === "invoiced";
    const npqpUnavailable = npqp && npqp.status && npqp.status !== "ok";
    const aggItems = Array.isArray(aggregate?.items) ? aggregate.items : [];
    const perMonth = Array.isArray(npqp?.perMonth) ? npqp.perMonth : [];

    return (
        <div className="uidai-pmis-card" style={{ marginBottom: 0, width: "100%" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 12 }}>
                <div>
                    <div style={{ fontSize: 16, fontWeight: 800, color: "#173e77" }}>Quarterly LD Settlement</div>
                    <div style={{ fontSize: 12, ...muted, marginTop: 2 }}>
                        Per-SLA rollup, NPQP and the capped LD deduction for this project&rsquo;s quarter.
                    </div>
                </div>
                <div style={{ display: "flex", gap: 10, alignItems: "flex-end", flexWrap: "wrap" }}>
                    <div>
                        <div style={{ fontSize: 12, fontWeight: 600, ...muted, marginBottom: 6 }}>Quarter</div>
                        <select className="uidai-pmis-filter-select" value={quarter} onChange={(e) => setQuarter(e.target.value)}>
                            {quarterOptions.map((q) => <option key={q} value={q}>{q}</option>)}
                        </select>
                    </div>
                    <button type="button" className="uidai-pmis-btn uidai-pmis-btn-cancel uidai-pmis-btn-small" style={{ marginTop: 0 }} onClick={load} disabled={loading}>
                        {loading ? "Loading…" : "↻ Reload"}
                    </button>
                </div>
            </div>

            {range && (
                <div style={{ fontSize: 12, ...muted, marginTop: 8 }}>
                    Period <b style={{ color: "#173e77" }}>{range.start}</b> → <b style={{ color: "#173e77" }}>{range.end}</b>
                </div>
            )}

            {error && <Banner text={error} kind="error" />}
            {notice && <Banner text={notice} kind="ok" />}

            {/* ── Settlement summary ───────────────────────────────────────── */}
            {loading ? (
                <div style={{ padding: 26, textAlign: "center", ...muted, fontSize: 13 }}>Loading quarter…</div>
            ) : !settlement ? (
                <div className="uidai-pmis-filter-shell" style={{ marginTop: 14, textAlign: "center", padding: 22 }}>
                    <div style={{ fontSize: 13, ...muted, marginBottom: 4 }}>
                        {quarter} has not been closed yet.
                    </div>
                    <div style={{ fontSize: 12, ...muted, marginBottom: 14 }}>
                        Closing computes the per-SLA rollup, pulls NPQP, applies the quarter cap and persists an
                        <b style={{ color: "#173e77" }}> auto_closed</b> settlement row.
                    </div>
                    <button type="button" className="uidai-pmis-btn uidai-pmis-btn-small" style={{ marginTop: 0 }} onClick={closeQuarter} disabled={closing}>
                        {closing ? "Closing…" : "Compute & close quarter"}
                    </button>
                </div>
            ) : (
                <>
                    <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 16, marginBottom: 10, flexWrap: "wrap" }}>
                        <div style={{ fontSize: 13.5, fontWeight: 800, color: "#173e77" }}>Settlement</div>
                        <StatusBadge status={settlement.status} />
                        {settlement.contractType && <span style={{ fontSize: 12, ...muted }}>· {settlement.contractType}</span>}
                        {settlement.closedAt && <span style={{ fontSize: 12, ...muted }}>· closed {dateTime(settlement.closedAt)}</span>}
                    </div>
                    <div className="uidai-pmis-grid-4" style={{ gap: 12 }}>
                        <Tile label="Sum LD %" value={pct(settlement.sumLdPercent)} hint="before quarter cap" />
                        <Tile label="Capped LD %" value={pct(settlement.cappedLdPercent)} accent="#c0392b" hint="RFP §5.27.6 cap" />
                        <Tile label="NPQP" value={money(settlement.npqp)} hint={`F ${money(settlement.fAmount)} + QGR ${money(settlement.qgrAmount)}`} />
                        <Tile label="LD Amount" value={money(settlement.ldAmount)} accent="#c0392b" hint="deducted this quarter" />
                        <Tile label="Payable Amount (PA)" value={money(settlement.paAmount)} />
                        <Tile label="Adjusted Quarterly Payment (AQP)" value={money(settlement.aqpAmount)} accent="#1f8a4c" hint="PA − LD" />
                    </div>
                    {settlement.overrideReason && (
                        <div style={{ fontSize: 12, ...muted, marginTop: 10 }}>
                            <b style={{ color: "#173e77" }}>Reason:</b> {settlement.overrideReason}
                        </div>
                    )}

                    {/* ── Finance actions ──────────────────────────────────── */}
                    <div className="uidai-pmis-filter-shell" style={{ marginTop: 14 }}>
                        <div className="uidai-pmis-filter-head">
                            <div className="uidai-pmis-filter-title">Finance actions</div>
                            {invoiced && <span className="uidai-pmis-badge uidai-pmis-badge-green">Locked — invoiced</span>}
                        </div>
                        {invoiced ? (
                            <div style={{ fontSize: 12.5, ...muted, marginTop: 10, lineHeight: 1.5 }}>
                                This settlement is immutable. Corrections must be issued as a credit note, not by editing the row.
                            </div>
                        ) : (
                            <div style={{ marginTop: 12 }}>
                                <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
                                    <button type="button" className="uidai-pmis-btn uidai-pmis-btn-cancel uidai-pmis-btn-small" style={{ marginTop: 0 }} onClick={() => {
                                        setShowOverride((v) => !v);
                                        setOverrideForm({ sumLdPercent: String(settlement.sumLdPercent ?? ""), overrideReason: "" });
                                    }}>
                                        {showOverride ? "Cancel override" : "✎ Override LD %"}
                                    </button>
                                </div>

                                {showOverride && (
                                    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 14, marginTop: 12 }}>
                                        <div className="uidai-pmis-field" style={{ marginBottom: 0 }}>
                                            <label>Sum LD % <span style={{ color: "var(--uidai-pmis-red, #d32f2f)" }}>*</span></label>
                                            <input type="number" min={0} step="any" value={overrideForm.sumLdPercent}
                                                onChange={(e) => setOverrideForm((f) => ({ ...f, sumLdPercent: e.target.value }))} />
                                            <div style={{ fontSize: 11, ...muted, marginTop: 4 }}>Re-capped at the quarter cap on save.</div>
                                        </div>
                                        <div className="uidai-pmis-field" style={{ marginBottom: 0 }}>
                                            <label>Override reason <span style={{ color: "var(--uidai-pmis-red, #d32f2f)" }}>*</span></label>
                                            <input type="text" value={overrideForm.overrideReason} placeholder="Why is the computed value being replaced?"
                                                onChange={(e) => setOverrideForm((f) => ({ ...f, overrideReason: e.target.value }))} />
                                        </div>
                                        <div style={{ display: "flex", alignItems: "flex-end" }}>
                                            <button type="button" className="uidai-pmis-btn uidai-pmis-btn-small" style={{ marginTop: 0 }} onClick={submitOverride} disabled={overrideLoading}>
                                                {overrideLoading ? "Saving…" : "Apply override"}
                                            </button>
                                        </div>
                                    </div>
                                )}

                                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 14, marginTop: 14, paddingTop: 14, borderTop: "1px solid var(--uidai-pmis-border)" }}>
                                    <div className="uidai-pmis-field" style={{ marginBottom: 0 }}>
                                        <label>Invoice reference</label>
                                        <input type="text" value={invoiceRef} placeholder="INV-2026-Q3-001" onChange={(e) => setInvoiceRef(e.target.value)} />
                                        <div style={{ fontSize: 11, ...muted, marginTop: 4 }}>Locks the row permanently once the LD has been billed.</div>
                                    </div>
                                    <div style={{ display: "flex", alignItems: "flex-end" }}>
                                        <button type="button" className="uidai-pmis-btn uidai-pmis-btn-small" style={{ marginTop: 0 }} onClick={submitInvoiced} disabled={invoiceLoading}>
                                            {invoiceLoading ? "Locking…" : "🔒 Mark invoiced"}
                                        </button>
                                    </div>
                                </div>
                            </div>
                        )}
                    </div>
                </>
            )}

            {/* ── Phase B: per-SLA quarterly aggregate ─────────────────────── */}
            <Section title="Per-SLA quarterly rollup" badge={aggItems.length} defaultOpen={aggItems.length > 0}>
                {aggregate && (
                    <div style={{ fontSize: 12.5, ...muted, marginBottom: 10 }}>
                        Uncapped total: <b style={{ color: "#c0392b" }}>{pct(aggregate.totalLdPercentUncapped)}</b>
                        {aggregate.quarterStart ? ` · ${aggregate.quarterStart} → ${aggregate.quarterEnd}` : ""}
                    </div>
                )}
                {aggItems.length === 0 ? (
                    <div style={{ fontSize: 12.5, ...muted, fontStyle: "italic" }}>No SLA contributions recorded for this quarter.</div>
                ) : (
                    <div className="uidai-pmis-table-wrap">
                        <table className="uidai-pmis-table uidai-pmis-table-compact" style={{ marginTop: 0 }}>
                            <thead>
                                <tr>
                                    <th>SLA Ref</th><th>Formula</th>
                                    <th style={{ textAlign: "right" }}>Points</th>
                                    <th style={{ textAlign: "right" }}>Severity</th>
                                    <th style={{ textAlign: "right" }}>LD %</th>
                                </tr>
                            </thead>
                            <tbody>
                                {aggItems.map((it, i) => (
                                    <tr key={it.id || it.mappingId || i}>
                                        <td style={{ fontFamily: "monospace", fontSize: 12, fontWeight: 700, color: "#173e77" }}>{it.slaRef || it.sla_ref || "—"}</td>
                                        <td>{String(it.formulaType || it.formula_type || "—").replace(/_/g, " ")}</td>
                                        <td style={{ textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{it.accumulatedPoints ?? "—"}</td>
                                        <td style={{ textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{it.severityLevel ?? "—"}</td>
                                        <td style={{ textAlign: "right", fontVariantNumeric: "tabular-nums", fontWeight: 700 }}>{pct(it.ldPercent)}</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                )}
            </Section>

            {/* ── Phase C: NPQP breakdown ──────────────────────────────────── */}
            <Section title="NPQP breakdown" badge={perMonth.length || null}>
                {!npqp ? (
                    <div style={{ fontSize: 12.5, ...muted, fontStyle: "italic" }}>NPQP not loaded.</div>
                ) : (
                    <>
                        {npqpUnavailable && (
                            <Banner
                                kind="error"
                                text={npqp.status === "leave_mgmt_unavailable"
                                    ? "Leave-management is unreachable — F could not be computed, so this quarter cannot be settled from live data."
                                    : `NPQP status: ${npqp.status}`}
                            />
                        )}
                        <div className="uidai-pmis-grid-4" style={{ gap: 12, marginTop: 10 }}>
                            <Tile label="F (resource cost)" value={money(npqp.fAmount)} hint="3 months of per-resource cost" />
                            <Tile label="QGR" value={money(npqp.qgrAmount)} />
                            <Tile label="NPQP" value={money(npqp.npqp)} accent="#1f8a4c" hint="F + QGR" />
                        </div>
                        {perMonth.length > 0 && (
                            <div className="uidai-pmis-table-wrap" style={{ marginTop: 12 }}>
                                <table className="uidai-pmis-table uidai-pmis-table-compact" style={{ marginTop: 0 }}>
                                    <thead>
                                        <tr>
                                            <th>Resource</th><th>Employee</th>
                                            <th style={{ textAlign: "right" }}>Month</th>
                                            <th style={{ textAlign: "right" }}>Monthly Rate</th>
                                            <th style={{ textAlign: "right" }}>Cost</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {perMonth.map((r, i) => (
                                            <tr key={`${r.resourceId}-${r.year}-${r.month}-${i}`}>
                                                <td style={{ fontFamily: "monospace", fontSize: 12 }}>{r.resourceId || "—"}</td>
                                                <td>{r.employeeName || "—"}</td>
                                                <td style={{ textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{r.year}-{String(r.month).padStart(2, "0")}</td>
                                                <td style={{ textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{money(r.monthlyRate)}</td>
                                                <td style={{ textAlign: "right", fontVariantNumeric: "tabular-nums", fontWeight: 700 }}>{money(r.cost)}</td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        )}
                    </>
                )}
            </Section>

            {/* ── Phase D: settlement history ──────────────────────────────── */}
            <Section title="Settlement history" badge={history.length}>
                {history.length === 0 ? (
                    <div style={{ fontSize: 12.5, ...muted, fontStyle: "italic" }}>No quarters closed for this project yet.</div>
                ) : (
                    <div className="uidai-pmis-table-wrap">
                        <table className="uidai-pmis-table uidai-pmis-table-compact" style={{ marginTop: 0 }}>
                            <thead>
                                <tr>
                                    <th>Quarter</th><th>Status</th>
                                    <th style={{ textAlign: "right" }}>Sum LD %</th>
                                    <th style={{ textAlign: "right" }}>Capped LD %</th>
                                    <th style={{ textAlign: "right" }}>NPQP</th>
                                    <th style={{ textAlign: "right" }}>LD Amount</th>
                                    <th style={{ textAlign: "right" }}>AQP</th>
                                    <th>Updated</th>
                                </tr>
                            </thead>
                            <tbody>
                                {history.map((r) => {
                                    const key = `${r.fiscalYear}-Q${r.quarter}`;
                                    const isCurrent = key === quarter;
                                    return (
                                        <tr key={r.id} style={{ background: isCurrent ? "#fff8ec" : undefined, cursor: "pointer" }} onClick={() => setQuarter(key)}>
                                            <td style={{ fontWeight: 700, color: "#173e77", whiteSpace: "nowrap" }}>{key}</td>
                                            <td><StatusBadge status={r.status} /></td>
                                            <td style={{ textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{pct(r.sumLdPercent)}</td>
                                            <td style={{ textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{pct(r.cappedLdPercent)}</td>
                                            <td style={{ textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{money(r.npqp)}</td>
                                            <td style={{ textAlign: "right", fontVariantNumeric: "tabular-nums", color: "#c0392b", fontWeight: 700 }}>{money(r.ldAmount)}</td>
                                            <td style={{ textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{money(r.aqpAmount)}</td>
                                            <td style={{ fontSize: 12, ...muted, whiteSpace: "nowrap" }}>{dateTime(r.updatedAt)}</td>
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </table>
                    </div>
                )}
            </Section>
        </div>
    );
}
