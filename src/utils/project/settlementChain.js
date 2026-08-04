/* ══════════════════════════════════════════════════════════════════
   The quarterly money chain — RFP §5.28.1.d, §5.28.1.e, §5.26.2.

   The rollup answers "what did the SLAs cost us in percent". This
   answers the question underneath it: what is actually payable.

   ── The chain (§5.28.1.d) ──────────────────────────────────────────
       MP    = R × (1 − L/N)      per resource, per month  (§5.25.2.b)
       AMP   = Σ MP for a month
       PA    = AMP(m1) + AMP(m2) + AMP(m3)     ← ACTUAL deployment
       F     = planned quarterly resource cost + CCN
       QGR   = 35% of Phase-1 fixed + one-time, ÷ Phase 2&3 quarters
       NPQP  = F + QGR                         ← the LD BASE
       LD    = min(Σ LD%, 10%) × NPQP          (§5.27.6 ceiling)
       AQP   = (PA − LD) + QGR

   The RFP's own worked example, which the tests pin to:
       F=100, QGR=10, NPQP=110, ΣLD%=3% → LD=3.30
       PA=90 → AQP = (90 − 3.30) + 10 = 96.70

   ── The asymmetry that matters ─────────────────────────────────────
   LD is computed on NPQP — the PLANNED figure — and then deducted from
   PA, the ACTUAL one. §5.28.1.d is explicit: "The applicable LD
   calculated above on Net Planned Quarterly Payment (NPQP) will be
   deducted from Payable amount for actual resource deployment PA".

   So whenever actual deployment runs below plan, the penalty bites
   harder than the headline percentage suggests. In the RFP's own
   example ₹3.30 comes off ₹90 — an effective 3.67% of what is really
   payable, not 3%. That number is computed here and surfaced, because
   it is the one that decides whether a quarter's SLA performance was
   actually affordable, and nothing else on the screen shows it.

   ── QGR appears twice, and that is correct ─────────────────────────
   It is inside NPQP (so LD is charged on it) and added back after the
   deduction (because it is guaranteed revenue — §5.23.2 pays it as an
   equal instalment regardless of deployment). Dropping the add-back
   understates every Phase 2/3 quarter by exactly one instalment, which
   is why `verifyAqp` exists.

   Pure functions, no React, no fetching.
   ══════════════════════════════════════════════════════════════════ */

const num = (v) => {
    if (v === null || v === undefined || v === "") return null;
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
};

/* §5.28.1.e. GST is added to the invoice; TDS is withheld on the invoice
   value (not on the GST-inclusive figure) — the clause works it as
   1.18X − 0.1X = 1.08X, so both percentages apply to X. */
export const TAX_DEFAULTS = { gstPercent: 18, tdsPercent: 10 };

/* §5.26.2 — "payments under this Contract shall not exceed 1.25 times
   the amount specified in Clause 6.4.2", i.e. contract value + 25% CCN. */
export const CONTRACT_MULTIPLIER = 1.25;

/* ─── one quarter ─────────────────────────────────────────────────
   Every input is optional. A missing one is reported by name rather
   than defaulted to zero: a chain that quietly treats an absent PA as
   ₹0 would show a large negative AQP and look like a catastrophe
   instead of like missing data.                                     */
export function buildSettlementChain({
    fAmount, qgrAmount, npqp,
    sumLdPercent, cappedLdPercent,
    quarterCapPercent = 10,
    paAmount,
} = {}) {
    const f = num(fAmount);
    const qgr = num(qgrAmount);
    const statedNpqp = num(npqp);
    const pa = num(paAmount);

    const sumLd = num(sumLdPercent);
    // The cap is applied here when the caller did not already apply it, so
    // the chain is correct whether it is fed a settlement row (pre-capped)
    // or the rollup's raw sum.
    const capped = num(cappedLdPercent) ?? (sumLd === null ? null : Math.min(sumLd, quarterCapPercent));

    // NPQP = F + QGR. Both the stated and the derived value are kept: a
    // disagreement means one of the three fields is stale at source.
    const derivedNpqp = f !== null && qgr !== null ? f + qgr : null;
    const base = statedNpqp ?? derivedNpqp;
    const npqpConsistent = statedNpqp === null || derivedNpqp === null
        ? null
        : Math.abs(statedNpqp - derivedNpqp) <= 1;

    const ldAmount = base !== null && capped !== null ? (base * capped) / 100 : null;
    const ldAmountUncapped = base !== null && sumLd !== null ? (base * sumLd) / 100 : null;

    // (PA − LD) + QGR — §5.28.1.d(h).
    const aqp = pa !== null && ldAmount !== null && qgr !== null ? pa - ldAmount + qgr : null;
    // The same figure with the QGR add-back omitted, kept so a backend
    // using this shorter formula can be identified rather than guessed at.
    const aqpWithoutQgr = pa !== null && ldAmount !== null ? pa - ldAmount : null;

    /* What the LD actually costs as a share of the money it comes out of.
       Only meaningful when PA is positive — a quarter with no actual
       deployment has no denominator, and reporting ∞% would be noise. */
    const effectiveLdPercentOnPa = ldAmount !== null && pa !== null && pa > 0
        ? (ldAmount / pa) * 100
        : null;

    const missing = [];
    if (f === null) missing.push("F");
    if (qgr === null) missing.push("QGR");
    if (pa === null) missing.push("PA");
    if (capped === null) missing.push("LD %");

    return {
        f, qgr,
        npqp: base,
        npqpStated: statedNpqp,
        npqpDerived: derivedNpqp,
        npqpConsistent,
        sumLdPercent: sumLd,
        cappedLdPercent: capped,
        quarterCapPercent,
        capApplied: sumLd !== null && capped !== null && sumLd > capped,
        ldAmount,
        ldAmountUncapped,
        pa,
        aqp,
        aqpWithoutQgr,
        effectiveLdPercentOnPa,
        /* PA below F is the ordinary shape — resources onboarded late, or
           unpaid leave under §5.25.2.b — and it is exactly the condition
           that makes the effective LD rate exceed the headline one. */
        paBelowPlan: pa !== null && f !== null && pa < f,
        deploymentShortfall: pa !== null && f !== null ? f - pa : null,
        complete: missing.length === 0,
        missing,
    };
}

/* ─── which formula did the backend use? ──────────────────────────
   The settlement row carries its own aqpAmount. Comparing it against
   both candidate formulas identifies the one in force, instead of
   leaving it as a suspicion nobody can settle.

   Tolerance is ₹1: these are rupee figures rounded at source, and the
   two candidates differ by a whole QGR instalment — lakhs, not paise —
   so there is no risk of a tight tolerance confusing them.           */
export function verifyAqp({ aqpAmount, paAmount, ldAmount, qgrAmount } = {}) {
    const stated = num(aqpAmount);
    const pa = num(paAmount);
    const ld = num(ldAmount);
    const qgr = num(qgrAmount);

    if (stated === null || pa === null || ld === null || qgr === null) {
        return { comparable: false, matches: null, stated, expected: null, shortfall: null };
    }
    const expected = pa - ld + qgr;      // §5.28.1.d(h)
    const withoutQgr = pa - ld;

    let matches = "neither";
    if (Math.abs(stated - expected) <= 1) matches = "rfp";
    else if (Math.abs(stated - withoutQgr) <= 1) matches = "without_qgr";

    return {
        comparable: true,
        matches,
        stated,
        expected,
        withoutQgr,
        // Positive when the stated figure falls short of the RFP formula.
        shortfall: expected - stated,
        qgr,
    };
}

/* ─── §5.28.1.e — what actually lands ─────────────────────────────
   X is the invoice; GST is added, TDS withheld, both on X. */
export function taxBreakdown(amount, { gstPercent, tdsPercent } = TAX_DEFAULTS) {
    const x = num(amount);
    const g = num(gstPercent) ?? TAX_DEFAULTS.gstPercent;
    const t = num(tdsPercent) ?? TAX_DEFAULTS.tdsPercent;
    if (x === null) return { base: null, gst: null, withGst: null, tds: null, net: null, gstPercent: g, tdsPercent: t };

    const gst = (x * g) / 100;
    const tds = (x * t) / 100;
    return {
        base: x,
        gst,
        withGst: x + gst,
        tds,
        net: x + gst - tds,
        gstPercent: g,
        tdsPercent: t,
    };
}

/* ─── across the contract ─────────────────────────────────────────
   Σ AQP over every settled quarter. Only rows that actually carry an
   AQP are totalled, and the count of those that do not is returned —
   a cumulative figure silently missing three quarters is worse than
   no cumulative figure at all.

   `invoiced` is tracked separately from `settled` because an
   auto_closed row is a computation and an invoiced one is a
   commitment; totalling them together hides how much of the payout is
   still provisional.                                                */
export function cumulativePayout(settlements) {
    const rows = (Array.isArray(settlements) ? settlements : [])
        .map((r) => ({
            key: `${r.fiscalYear}-Q${r.quarter}`,
            fiscalYear: r.fiscalYear,
            quarter: r.quarter,
            status: r.status || null,
            invoiced: r.status === "invoiced",
            npqp: num(r.npqp),
            ldAmount: num(r.ldAmount),
            paAmount: num(r.paAmount),
            qgrAmount: num(r.qgrAmount),
            aqpAmount: num(r.aqpAmount),
            sumLdPercent: num(r.sumLdPercent),
            cappedLdPercent: num(r.cappedLdPercent),
        }))
        .sort((a, b) => (a.fiscalYear - b.fiscalYear) || (a.quarter - b.quarter));

    const withAqp = rows.filter((r) => r.aqpAmount !== null);
    const invoicedRows = withAqp.filter((r) => r.invoiced);
    const sum = (list, pick) => list.reduce((n, r) => n + (pick(r) ?? 0), 0);

    return {
        rows,
        quarterCount: rows.length,
        pricedCount: withAqp.length,
        unpricedCount: rows.length - withAqp.length,
        totalAqp: withAqp.length ? sum(withAqp, (r) => r.aqpAmount) : null,
        totalLd: sum(rows, (r) => r.ldAmount),
        totalPa: sum(rows, (r) => r.paAmount),
        totalQgr: sum(rows, (r) => r.qgrAmount),
        invoicedCount: invoicedRows.length,
        invoicedAqp: invoicedRows.length ? sum(invoicedRows, (r) => r.aqpAmount) : null,
        provisionalAqp: withAqp.length - invoicedRows.length > 0
            ? sum(withAqp.filter((r) => !r.invoiced), (r) => r.aqpAmount)
            : 0,
    };
}

/* ─── §5.26.2 ceiling ─────────────────────────────────────────────
   Total payments must not exceed 1.25 × the contract value — the
   contract value plus a 25% CCN headroom.

   `paidToDate` should include every stream: Phase-1 deliverable
   payments AND quarterly AQPs. Passing only one understates usage
   against the ceiling, so the caller names what it included.        */
export function contractCeiling(contractValue, paidToDate, { multiplier = CONTRACT_MULTIPLIER } = {}) {
    const value = num(contractValue);
    const paid = num(paidToDate);
    if (value === null || value <= 0) {
        return { known: false, contractValue: value, ceiling: null, paid, reason: "no contract value on the payment page" };
    }
    const ceiling = value * multiplier;
    return {
        known: true,
        contractValue: value,
        multiplier,
        ceiling,
        paid,
        remaining: paid === null ? null : ceiling - paid,
        usedPercent: paid === null ? null : (paid / ceiling) * 100,
        exceeded: paid !== null && paid > ceiling,
        // Past the base contract value but still inside the CCN headroom —
        // permitted, but it means the 25% is being consumed.
        intoCcn: paid !== null && paid > value && paid <= ceiling,
    };
}
