// ---------------------------------------------------------------------------
// Project-level SLA settlement — Phase B (quarterly aggregate), Phase C (PQP),
// Phase D (settlement / override) and Phase E (mark invoiced) for one quarter.
//
// Self-contained and prop-driven (`projectId` only), so it can be dropped onto
// a dedicated project page later by moving this one import.
// ---------------------------------------------------------------------------
import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
    getQuarterlyAggregate,
    getPqp,
    listSettlements,
    getSettlement,
    overrideSettlement,
    finalizeSettlement,
    clearSettlementOverride,
    isSettlementFinal,
    isSettlementOverridden,
    markSettlementInvoiced,
    quarterKeyOf,
    quarterKeyOfRow,
    recentQuarterKeys,
    parseQuarterKey,
    rowMatchesQuarter,
} from "../../../api/slaCompliance";
import { contractQuarters, contractQuarterFor, anchorFromQuarterRow } from "../../../utils/project/slaRollup";
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

export default function SlaSettlementPanel({ projectId, projectStartDate = "", projectEndDate = "" }) {
    const [aggregate, setAggregate] = useState(null);
    const [pqp, setPqp] = useState(null);
    const [settlement, setSettlement] = useState(null);
    const [history, setHistory] = useState([]);

    /* ── which quarters this project has ──────────────────────────────
       Quarters are anchored to the project's start date now, so the
       options come from T0 ("Y1-Q1", "Y1-Q2", …) rather than from the
       calendar. Two things can leave that list empty: a project with no
       start date (the backend then genuinely keys by calendar quarter),
       and a deep link, where `useProject` reads an in-memory list nothing
       has populated yet. The settlement history covers the second case —
       its rows already name the quarters this project has closed — and
       the calendar list is the last resort for the first. */
    /* T0 for the selector's grid. Contract quarters anchor on the
       RESOURCE PHASE, not on the project's start, and this panel has no
       milestone tree to read that from — but any settled row states both
       its window and its position in the grid, which pins T0 exactly.
       The project start is the fallback for a project with no rows yet,
       and it is the same fallback the backend uses. */
    const anchorDate = useMemo(() => {
        for (const r of history) {
            const t0 = anchorFromQuarterRow(r);
            if (t0) return t0;
        }
        return projectStartDate;
    }, [history, projectStartDate]);
    // Whether that anchor came from a backend row (exact) or is the fallback.
    const anchorFromRow = useMemo(
        () => history.some((r) => !!anchorFromQuarterRow(r)),
        [history]
    );

    const contractQs = useMemo(
        () => contractQuarters(anchorDate, projectEndDate),
        [anchorDate, projectEndDate]
    );
    const quarterOptions = useMemo(() => {
        const seen = new Set();
        const out = [];
        for (const q of contractQs) { seen.add(q.key); out.push(q.key); }
        for (const r of history) {
            const key = quarterKeyOfRow(r);
            if (key && !seen.has(key)) { seen.add(key); out.push(key); }
        }
        return out.length ? out : recentQuarterKeys(8);
    }, [contractQs, history]);

    const [quarter, setQuarter] = useState("");
    // Land on the quarter the project is actually in; hold the user's pick
    // once the options have arrived.
    useEffect(() => {
        setQuarter((cur) => {
            if (cur && quarterOptions.includes(cur)) return cur;
            if (contractQs.length) return (contractQuarterFor(contractQs) || contractQs[0]).key;
            return quarterOptions[0] || quarterKeyOf();
        });
    }, [quarterOptions, contractQs]);

    /* The selected quarter's date window. A contract key carries no dates
       of its own, so the bounds come from the anchored list; a row the
       backend already returned is the next best source, and a calendar key
       derives its own. */
    const range = useMemo(() => {
        const anchored = contractQs.find((q) => q.key === quarter);
        if (anchored) return { year: anchored.year, quarter: anchored.quarter, start: anchored.start, end: anchored.end };
        const row = history.find((r) => quarterKeyOfRow(r) === quarter);
        const parsed = parseQuarterKey(quarter);
        if (row?.quarterStart && row?.quarterEnd) {
            return {
                year: Number(row.fiscalYear),
                quarter: Number(row.quarter),
                start: String(row.quarterStart).slice(0, 10),
                end: String(row.quarterEnd).slice(0, 10),
            };
        }
        return parsed;
    }, [quarter, contractQs, history]);

    const [loading, setLoading] = useState(false);
    const [closing, setClosing] = useState(false);
    const [error, setError] = useState("");
    const [notice, setNotice] = useState("");

    // Override / invoice forms
    const [showOverride, setShowOverride] = useState(false);
    const [overrideForm, setOverrideForm] = useState({ sumLdPercent: "", overrideReason: "" });
    const [overrideLoading, setOverrideLoading] = useState(false);
    const [finalizeLoading, setFinalizeLoading] = useState(false);
    const [clearLoading, setClearLoading] = useState(false);
    const [invoiceRef, setInvoiceRef] = useState("");
    const [invoiceLoading, setInvoiceLoading] = useState(false);

    // Load the two pure reads (aggregate + PQP) plus the settlement history.
    // The per-quarter settlement is deliberately NOT fetched here: that call
    // auto-closes the quarter as a side effect, so it stays behind a button.
    const load = useCallback(async () => {
        if (!projectId) { setError("Missing project id."); return; }
        // The first render has no quarter yet — the options arrive a tick later.
        if (!quarter) return;
        setLoading(true);
        setError("");
        setNotice("");
        setShowOverride(false);
        const [aggRes, pqpRes, histRes] = await Promise.allSettled([
            getQuarterlyAggregate(projectId, quarter),
            getPqp(projectId, quarter),
            listSettlements(projectId),
        ]);
        const problems = [];
        if (aggRes.status === "fulfilled") setAggregate(aggRes.value);
        else { setAggregate(null); problems.push(`Quarterly aggregate: ${aggRes.reason?.message || "failed"}`); }

        if (pqpRes.status === "fulfilled") setPqp(pqpRes.value);
        else { setPqp(null); problems.push(`PQP: ${pqpRes.reason?.message || "failed"}`); }

        const rows = histRes.status === "fulfilled" ? (histRes.value?.items || []) : [];
        setHistory(rows);
        if (histRes.status === "rejected") problems.push(`Settlement history: ${histRes.reason?.message || "failed"}`);

        // If this quarter has already been closed, show it without re-triggering
        // the lazy auto-close. Matched on fiscalYear + quarter rather than on a
        // reconstructed label, and numerically — see rowMatchesQuarter.
        setSettlement(rows.find((r) => rowMatchesQuarter(r, quarter)) || null);

        if (problems.length) setError(problems.join("\n"));
        setLoading(false);
        /* `range` is deliberately NOT a dependency: it is derived from
           `history`, which this function sets, so depending on it would
           re-create load() on every load and spin. */
    }, [projectId, quarter]);

    useEffect(() => { load(); }, [load]);

    // Explicit auto-close: computes rollup + PQP + cap + AQP and persists the row.
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

    /* The PRE-BILLING lock. Not the same act as marking it invoiced: this
       says the SLA owner is standing behind the figure, invoicing says
       finance has billed it. A finalized quarter can still be invoiced
       afterwards, which is why both controls survive side by side.

       No body — the endpoint accepts none, so nothing is collected. */
    async function submitFinalize() {
        setFinalizeLoading(true);
        setError("");
        setNotice("");
        try {
            const row = await finalizeSettlement(projectId, quarter);
            setSettlement(row);
            setShowOverride(false);
            setNotice("Quarter finalized — the LD is locked. It can still be marked invoiced.");
            listSettlements(projectId).then((r) => setHistory(r?.items || [])).catch(() => { });
        } catch (err) {
            /* The server's own words. It distinguishes "already invoiced"
               (settlement_immutable) from "nothing computed to finalize"
               (settlement_not_computed), and those need different actions
               from the reader — a status code alone would flatten them. */
            setError(err?.message || "Failed to finalize the settlement.");
        } finally {
            setFinalizeLoading(false);
        }
    }

    /* Throw the manual figure away and go back to the computed one. The
       only route back: an overridden row is deliberately never recomputed
       by a refresh, so without this the way to undo a wrong override was
       to override it again with a guess at the computed value. */
    async function submitClearOverride() {
        setClearLoading(true);
        setError("");
        setNotice("");
        try {
            const row = await clearSettlementOverride(projectId, quarter);
            setSettlement(row);
            setShowOverride(false);
            setNotice(`Override cleared — recomputed from current data, LD is now ${pct(row?.cappedLdPercent)}.`);
            listSettlements(projectId).then((r) => setHistory(r?.items || [])).catch(() => { });
        } catch (err) {
            // 422 `settlement_locked` once invoiced or finalized.
            setError(err?.message || "Failed to clear the override.");
        } finally {
            setClearLoading(false);
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

    const isContractKey = range?.kind === "contract" || /^Y\d+-Q[1-4]$/i.test(quarter);
    const invoiced = settlement?.status === "invoiced";
    /* Two independent facts, and the UI needs both. `finalized` is a lock;
       `overridden` is how the figure got there and survives the lock. A
       locked row that was hand-set is not the same thing as a locked row
       that was computed, and only one of them has a reason worth reading. */
    const finalized = isSettlementFinal(settlement);
    const overridden = isSettlementOverridden(settlement);
    // Both refuse an override, so both close the form.
    const locked = invoiced || finalized;
    const pqpUnavailable = pqp && pqp.status && pqp.status !== "ok";
    const aggItems = Array.isArray(aggregate?.items) ? aggregate.items : [];
    const perMonth = Array.isArray(pqp?.perMonth) ? pqp.perMonth : [];

    return (
        <div className="uidai-pmis-card" style={{ marginBottom: 0, width: "100%" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 12 }}>
                <div>
                    <div style={{ fontSize: 16, fontWeight: 800, color: "#173e77" }}>Quarterly LD Settlement</div>
                    <div style={{ fontSize: 12, ...muted, marginTop: 2 }}>
                        Per-SLA rollup, PQP and the capped LD deduction for this project&rsquo;s quarter.
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
                    {/* Quarters run from the resource phase's start date, so the
                        year in the key is the contract year — spelled out here so
                        "Y2" is never read as a calendar year. A project with no
                        resource-based milestone to anchor to falls back to
                        calendar quarters and is labelled as such. */}
                    {isContractKey
                        ? <>Contract year <b style={{ color: "#173e77" }}>{range.year}</b>, quarter <b style={{ color: "#173e77" }}>{range.quarter}</b> · </>
                        : <>Calendar quarter (nothing to anchor contract quarters to) · </>}
                    {range.start
                        ? <>Period <b style={{ color: "#173e77" }}>{range.start}</b> → <b style={{ color: "#173e77" }}>{range.end}</b></>
                        : <>period resolved by the backend</>}
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
                        Closing computes the per-SLA rollup, pulls PQP, applies the quarter cap and persists an
                        <b style={{ color: "#173e77" }}> auto_closed</b> settlement row.
                    </div>
                    {/* Closing WRITES a row, and the row records whatever window
                        the key resolves to. With no settled row to pin T0 the
                        grid is built from the project's start rather than the
                        resource phase, so the key offered here may name a
                        different three months than the backend's — and once
                        written, that row is what Settlement invoices. */}
                    {!anchorFromRow && (
                        <div style={{
                            fontSize: 11.5, color: "#8a6d1f", background: "#fffaf0",
                            border: "1px solid #e8d9b0", borderRadius: 8,
                            padding: "9px 12px", margin: "0 auto 14px", maxWidth: 520,
                            lineHeight: 1.6, textAlign: "left",
                        }}>
                            ⚠ No quarter has been settled yet, so this grid is anchored on the project&rsquo;s start
                            date rather than on the resource phase. Check that <b>{quarter}</b> is the quarter you
                            mean before closing — the row persists the window it resolves to.
                        </div>
                    )}
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
                        {/* PQP is F alone. QGR was part of the base under the
                            deleted NPQP clause and is not any more — it appears
                            once, in the AQP add-back below. */}
                        <Tile label="PQP" value={money(settlement.pqp)} hint={`F ${money(settlement.fAmount)} — QGR excluded`} />
                        <Tile label="LD Amount" value={money(settlement.ldAmount)} accent="#c0392b" hint="LD % × PQP, deducted this quarter" />
                        <Tile label="Payable Amount (PA)" value={money(settlement.paAmount)} />
                        <Tile label="Adjusted Quarterly Payment (AQP)" value={money(settlement.aqpAmount)} accent="#1f8a4c" hint="(PA − LD) + QGR" />
                    </div>
                    {/* The deleted NPQP figure, for reference only. Kept
                        visible because statements issued before the
                        corrigendum were based on it, and a reader comparing
                        this quarter against one of those needs to see where
                        the older, larger base came from. Nothing is computed
                        from it. */}
                    {Number.isFinite(Number(settlement.fAmount)) && Number.isFinite(Number(settlement.qgrAmount)) && (
                        <div style={{ fontSize: 11.5, ...muted, marginTop: 10, lineHeight: 1.6 }}>
                            For reference: the superseded <b>NPQP</b> base (F + QGR) would have been{" "}
                            <b style={{ color: "#173e77" }}>
                                {money(Number(settlement.fAmount) + Number(settlement.qgrAmount))}
                            </b>. Corrigendum item 49 deleted that clause — LD is charged on PQP (F) alone.
                        </div>
                    )}

                    {/* Shown only when the row is actually flagged as
                        overridden. A cleared override can leave the old reason
                        behind on the row, and printing that under a recomputed
                        figure would describe a decision that has been undone. */}
                    {overridden && settlement.overrideReason && (
                        <div style={{ fontSize: 12, ...muted, marginTop: 10 }}>
                            <b style={{ color: "#173e77" }}>Reason:</b> {settlement.overrideReason}
                        </div>
                    )}

                    {/* ── Finance actions ──────────────────────────────────── */}
                    <div className="uidai-pmis-filter-shell" style={{ marginTop: 14 }}>
                        <div className="uidai-pmis-filter-head">
                            <div className="uidai-pmis-filter-title">Finance actions</div>
                            {/* Both badges can be true at once — an overridden
                                row that was then finalized is both, and hiding
                                either would lose a fact somebody needs. */}
                            {overridden && (
                                <span
                                    className="uidai-pmis-badge"
                                    title={settlement.overrideReason
                                        ? `Reason: ${settlement.overrideReason}`
                                        : "No reason is recorded against this override."}
                                    style={{
                                        background: "#fdf6e8", border: "1px solid #eddcb4",
                                        color: "#8a5a00", cursor: "help",
                                    }}
                                >
                                    Manually overridden
                                </span>
                            )}
                            {finalized && !invoiced && (
                                <span className="uidai-pmis-badge" style={{ background: "#eef3fb", border: "1px solid #cfdcf0", color: "#173e77" }}>
                                    Finalized — locked
                                </span>
                            )}
                            {invoiced && <span className="uidai-pmis-badge uidai-pmis-badge-green">Locked — invoiced</span>}
                        </div>
                        {locked ? (
                            <div style={{ fontSize: 12.5, ...muted, marginTop: 10, lineHeight: 1.5 }}>
                                {invoiced
                                    ? "This settlement is immutable. Corrections must be issued as a credit note, not by editing the row."
                                    : "This settlement is finalized. The LD can no longer be overridden or reverted to the computed figure; it can still be marked invoiced below."}
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

                                    {/* Offered only while it would work: an
                                        override exists and nothing has locked
                                        yet. Past that the endpoint answers 422
                                        `settlement_locked`, and a control whose
                                        only outcome is a refusal is worse than
                                        no control. */}
                                    {overridden && (
                                        <button
                                            type="button"
                                            className="uidai-pmis-btn uidai-pmis-btn-cancel uidai-pmis-btn-small"
                                            style={{ marginTop: 0 }}
                                            onClick={submitClearOverride}
                                            disabled={clearLoading}
                                            title="Discard the manual figure and recompute from current data. This is the only route back to the computed value."
                                        >
                                            {clearLoading ? "Reverting…" : "↺ Revert to computed"}
                                        </button>
                                    )}

                                    <button
                                        type="button"
                                        className="uidai-pmis-btn uidai-pmis-btn-small"
                                        style={{ marginTop: 0 }}
                                        onClick={submitFinalize}
                                        disabled={finalizeLoading}
                                        title="Lock the LD before billing. Blocks further overrides and reverts; marking invoiced can still follow."
                                    >
                                        {finalizeLoading ? "Locking…" : "✓ Mark as final"}
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

                            </div>
                        )}

                        {/* OUTSIDE the lock branch, because finalize is the
                            PRE-billing lock and invoicing is what follows it.
                            A finalized quarter must still be billable — only
                            an already-invoiced one has nothing left to do. */}
                        {!invoiced && (
                            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 14, marginTop: 14, paddingTop: 14, borderTop: "1px solid var(--uidai-pmis-border)" }}>
                                <div className="uidai-pmis-field" style={{ marginBottom: 0 }}>
                                    <label>Invoice reference</label>
                                    <input
                                        type="text"
                                        value={invoiceRef}
                                        placeholder={`INV-${quarter || "Y1-Q3"}-001`}
                                        onChange={(e) => setInvoiceRef(e.target.value)}
                                    />
                                    <div style={{ fontSize: 11, ...muted, marginTop: 4 }}>Locks the row permanently once the LD has been billed.</div>
                                </div>
                                <div style={{ display: "flex", alignItems: "flex-end" }}>
                                    <button type="button" className="uidai-pmis-btn uidai-pmis-btn-small" style={{ marginTop: 0 }} onClick={submitInvoiced} disabled={invoiceLoading}>
                                        {invoiceLoading ? "Locking…" : "🔒 Mark invoiced"}
                                    </button>
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
                        {/* Σ ONE %LD per SLA — the same basis as the
                            settlement row's `sumLdPercent`, so the two now
                            agree. It used to sum per MAPPING, which counted an
                            SLA once for every activity it was mapped to and
                            read far higher than the figure actually charged. */}
                        Uncapped total: <b style={{ color: "#c0392b" }}>{pct(aggregate.totalLdPercentUncapped)}</b>
                        <span style={{ fontSize: 11.5 }}> (Σ one LD % per SLA, before the quarter cap)</span>
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

            {/* ── Phase C: PQP breakdown ──────────────────────────────────── */}
            <Section title="PQP breakdown" badge={perMonth.length || null}>
                {!pqp ? (
                    <div style={{ fontSize: 12.5, ...muted, fontStyle: "italic" }}>PQP not loaded.</div>
                ) : (
                    <>
                        {pqpUnavailable && (
                            <Banner
                                kind="error"
                                text={pqp.status === "leave_mgmt_unavailable"
                                    ? "Leave-management is unreachable — F could not be computed, so this quarter cannot be settled from live data."
                                    : `PQP status: ${pqp.status}`}
                            />
                        )}
                        <div className="uidai-pmis-grid-4" style={{ gap: 12, marginTop: 10 }}>
                            <Tile label="F (resource cost)" value={money(pqp.fAmount)} hint="3 months of per-resource cost" />
                            <Tile label="QGR" value={money(pqp.qgrAmount)} />
                            <Tile label="PQP" value={money(pqp.pqp)} accent="#1f8a4c" hint="= F — the LD base" />
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
                                    <th style={{ textAlign: "right" }}>PQP</th>
                                    <th style={{ textAlign: "right" }}>LD Amount</th>
                                    <th style={{ textAlign: "right" }}>AQP</th>
                                    <th>Updated</th>
                                </tr>
                            </thead>
                            <tbody>
                                {history.map((r) => {
                                    /* "Y1-Q3", not "2026-Q3": fiscalYear is the
                                       contract year on an anchored project. */
                                    const key = quarterKeyOfRow(r);
                                    const isCurrent = key === quarter;
                                    return (
                                        <tr key={r.id} style={{ background: isCurrent ? "#fff8ec" : undefined, cursor: "pointer" }} onClick={() => setQuarter(key)}>
                                            <td style={{ fontWeight: 700, color: "#173e77", whiteSpace: "nowrap" }}>{key}</td>
                                            <td><StatusBadge status={r.status} /></td>
                                            <td style={{ textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{pct(r.sumLdPercent)}</td>
                                            <td style={{ textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{pct(r.cappedLdPercent)}</td>
                                            <td style={{ textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{money(r.pqp)}</td>
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
