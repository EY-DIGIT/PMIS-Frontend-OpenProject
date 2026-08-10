/* ══════════════════════════════════════════════════════════════════
   Cross-check: does the rollup agree with the finance page?

   Two services hold this project's money and they do NOT keep it on the
   same side of the tax line:

     · /payment-page returns every term twice — `preTaxValue` and
       `totalValue` — and every bucket twice on `totals`
       (`fixedCost` / `fixedCostPretax` / `fixedCostTax`).
     · The contracts service keeps PQP, PA, LD and AQP EXCLUSIVE of tax
       (§5.27.6 says so outright) and taxes once at the invoice
       (§5.28.1.e).

   Fine until something compares across that line — and when it does the
   error is the whole tax rate, far too large to spot by eye.

   ── Verified against the live payload, not inferred ───────────────
   Everything below was written against a real /payment-page response
   (project 60c67666…, 2026-08-07). Three things that response settled:

     1. The tax rate is 18% — but ONLY on the fixed, one-time and
        recurring buckets. `resource_cost` items put something else in
        `taxAmount` entirely: one carries cost 23,60,404 with "tax"
        62,39,627 (264%), another cost 0.00 with "tax" 2,49,58,508. So
        the project-level implied rate reads 61.29%, which is not a tax
        rate and must not be used as one. The representative rate is
        therefore taken from the buckets that behave like tax, and the
        others are reported as anomalies.
     2. The contract ceiling is the backend's own: `ccn.capPercent` 25%
        of the TAX-INCLUSIVE `totalContractCost`. Its `ccn.value`
        matches 0.25 × total to the paisa, so that is the definition in
        force — not a pre-tax one.
     3. The payment page publishes `slaLdDeductions`: the settlement
        rows themselves, on CONTRACT quarters (`fiscalYear: 1`,
        `quarter: 3`, `quarterStart: 2026-05-10`). That makes a direct
        figure-for-figure reconciliation possible, which is what
        `reconcileSlaDeductions` does.

   Nothing here changes a number. It reports which basis each figure is
   on and where two of them have been compared across bases.

   Pure functions. No React, no fetching.
   ══════════════════════════════════════════════════════════════════ */

export const BASIS = { PRETAX: "pretax", POSTTAX: "posttax", UNKNOWN: "unknown" };
export const SEVERITY = { OK: "ok", WARN: "warn", ERROR: "error", UNKNOWN: "unknown" };

const num = (v) => {
    if (v === null || v === undefined || v === "") return null;
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
};

/* The two sides are summed in different orders through different
   services, so half a rupee of float drift is not a finding. */
const EPS = 1;
const round2 = (n) => Math.round(Number(n) * 100) / 100;

function fmt(v) {
    const n = num(v);
    return n === null ? "—" : `₹${Math.round(n).toLocaleString("en-IN")}`;
}
const pctStr = (v) => (v === null || v === undefined ? "—" : `${round2(v)}%`);

/* GST in India tops out at 28%. Anything above 50% is not a tax rate,
   it is a field being used for something else — which is exactly what
   `resource_cost.taxAmount` turns out to be on this project. */
const MAX_PLAUSIBLE_RATE = 50;

const BUCKETS = [
    ["fixed", "fixedCost"],
    ["one-time", "oneTimeCost"],
    ["resource", "resourceCost"],
    ["recurring", "recurringCost"],
    ["transaction", "transactionCost"],
];

/* ─── what the finance page is holding ────────────────────────────── */
export function detectFinanceBasis(paymentPage) {
    const totals = paymentPage?.totals ?? null;
    if (!totals) {
        return { available: false, hasSplit: false, basis: BASIS.UNKNOWN, buckets: [], anomalies: [], reason: "the payment page was not readable" };
    }

    const postTax = num(totals.totalContractCost);
    const preTax = num(totals.totalContractCostPretax);
    const taxAmount = num(totals.totalContractCostTax)
        ?? (postTax !== null && preTax !== null ? postTax - preTax : null);
    const hasSplit = preTax !== null || num(totals.totalContractCostTax) !== null;

    /* Per bucket, because the project-level ratio is only meaningful when
       every bucket behaves. Here it does not, and averaging a real 18%
       with a bucket carrying 1321% produces a number that describes
       nothing. */
    const buckets = [];
    for (const [label, key] of BUCKETS) {
        const p = num(totals[`${key}Pretax`]);
        const x = num(totals[`${key}Tax`]);
        if (p === null && x === null) continue;
        const rate = p !== null && p > 0 && x !== null ? (x / p) * 100 : null;
        buckets.push({
            label,
            key,
            preTax: p,
            tax: x,
            ratePercent: rate,
            /* A zero base carrying a non-zero "tax" is the clearest case:
               there is nothing for a percentage to be a percentage OF. */
            plausible: rate !== null && rate >= 0 && rate <= MAX_PLAUSIBLE_RATE,
            zeroBaseWithTax: (p === null || p === 0) && x !== null && Math.abs(x) > EPS,
        });
    }

    const usable = buckets.filter((b) => b.plausible && b.tax !== null && Math.abs(b.tax) > EPS);
    const anomalies = buckets.filter((b) => b.zeroBaseWithTax || (b.ratePercent !== null && b.ratePercent > MAX_PLAUSIBLE_RATE));

    /* The rate the contract actually applies, taken from the buckets that
       behave like tax. Consistent across all of them on a healthy
       project; when they disagree that is itself worth saying, so the
       spread is kept rather than averaged away. */
    const rates = usable.map((b) => round2(b.ratePercent));
    const uniqueRates = [...new Set(rates)];
    const representativeRate = uniqueRates.length ? rates.slice().sort((a, b) => a - b)[Math.floor(rates.length / 2)] : null;

    const totalImpliedRate = preTax !== null && preTax > 0 && taxAmount !== null
        ? (taxAmount / preTax) * 100
        : null;

    return {
        available: true,
        hasSplit,
        postTax,
        preTax,
        taxAmount,
        buckets,
        anomalies,
        /* Deliberately NOT the project-level ratio — see the header. */
        representativeRate,
        rateSpread: uniqueRates.sort((a, b) => a - b),
        totalImpliedRate,
        rateTrustworthy: anomalies.length === 0,
        basis: BASIS.POSTTAX,
        taxFree: hasSplit && (representativeRate === 0 || (taxAmount !== null && Math.abs(taxAmount) <= EPS)),
        ccnPercent: num(paymentPage?.ccn?.capPercent),
        ccnValue: num(paymentPage?.ccn?.value),
        reason: hasSplit ? "" : "this payment page has no pre-tax split",
    };
}

/* ─── the ceiling, on the backend's own definition ────────────────
   §5.26.2 caps cumulative payments at contract value + CCN headroom.
   The payment page publishes both — `ccn.capPercent` and `ccn.value` —
   and its value is exactly capPercent × the TAX-INCLUSIVE total. That is
   the definition in force, so it is the one used; deriving a different
   one here would put this page at odds with Finance for no reason.

   AQP is tax-exclusive, so usage against it is not like-for-like. That
   is reported as a check, not silently corrected.                     */
export function ceilingBaseFor(finance) {
    if (!finance?.available) {
        return { value: null, multiplier: null, basis: BASIS.UNKNOWN, reason: finance?.reason || "no finance data" };
    }
    const capPercent = finance.ccnPercent ?? 25;
    return {
        value: finance.postTax,
        multiplier: 1 + capPercent / 100,
        capPercent,
        basis: BASIS.POSTTAX,
        reason: "",
    };
}

/* ─── the settlement rows, compared figure for figure ─────────────
   The payment page carries `slaLdDeductions` — the same settlement rows
   the contracts service returns, on contract quarters. Both sides derive
   from the same evaluations, so they should agree exactly; a divergence
   means one applied a rule the other did not.

   Matched on DATES rather than on the quarter key, because the key's
   meaning changed once (fiscalYear went from calendar to contract year)
   and dates cannot drift like that.                                   */
export function reconcileSlaDeductions({ paymentPage, period, totals, chain, quarterlyNet } = {}) {
    const rows = Array.isArray(paymentPage?.slaLdDeductions) ? paymentPage.slaLdDeductions : null;
    if (!rows) {
        return { available: false, reason: "the payment page returned no SLA deduction rows", checks: [] };
    }
    if (!period?.start || !period?.end) {
        return { available: false, reason: "no quarter selected", checks: [] };
    }

    const iso = (v) => (v ? String(v).slice(0, 10) : "");
    const row = rows.find((r) => iso(r.quarterStart) === period.start && iso(r.quarterEnd) === period.end) || null;

    if (!row) {
        return {
            available: true,
            row: null,
            checks: [{
                id: "fin-row-missing",
                title: "Finance has no SLA deduction row for this quarter",
                severity: SEVERITY.UNKNOWN,
                detail: `The payment page lists ${rows.length} settled quarter(s), none covering `
                    + `${period.start} → ${period.end}. Nothing to reconcile.`,
            }],
        };
    }

    const checks = [];
    const compare = (id, title, mine, theirs, format, note) => {
        const a = num(mine);
        const b = num(theirs);
        if (a === null || b === null) {
            checks.push({
                id, title, severity: SEVERITY.UNKNOWN,
                detail: `${a === null ? "This page" : "Finance"} has no figure, so the two were not compared.`,
            });
            return;
        }
        const diff = a - b;
        const agrees = Math.abs(diff) <= EPS;
        checks.push({
            id, title,
            severity: agrees ? SEVERITY.OK : SEVERITY.ERROR,
            detail: agrees
                ? `Both report ${format(b)}.${note ? ` ${note}` : ""}`
                : `This page computes ${format(a)}, Finance holds ${format(b)} — a gap of ${format(Math.abs(diff))}.`
                  + `${note ? ` ${note}` : ""}`,
        });
    };

    compare("fin-sum-ld", "Σ LD % before the cap", totals?.sumLdPercent, row.sumLdPercent, pctStr,
        row.overrideReason ? `Finance's figure carries a reason: "${row.overrideReason}".` : "");
    compare("fin-capped-ld", "LD % after the quarter cap", totals?.cappedLdPercent, row.cappedLdPercent, pctStr);
    compare("fin-npqp", "Payment base (PQP)", chain?.npqp, row.npqp, fmt,
        "Tax-exclusive on both sides.");
    compare("fin-ld-amount", "Liquidated damages", chain?.ldAmount, row.ldAmount, fmt);
    compare("fin-aqp", "Final payment (AQP)", quarterlyNet, row.aqpAmount, fmt);

    /* Finance's own row should satisfy §5.28.1.d(h) internally. Checked
       here rather than trusting it, because a row that disagrees with
       itself makes every comparison above meaningless. */
    const pa = num(row.paAmount);
    const ld = num(row.ldAmount);
    const qgr = num(row.qgrAmount);
    const aqp = num(row.aqpAmount);
    if (pa !== null && ld !== null && qgr !== null && aqp !== null) {
        const expected = pa - ld + qgr;
        const ok = Math.abs(expected - aqp) <= EPS;
        checks.push({
            id: "fin-aqp-formula",
            title: ok ? "Finance's AQP follows the formula" : "Finance's AQP does not follow the formula",
            severity: ok ? SEVERITY.OK : SEVERITY.ERROR,
            detail: ok
                ? `(PA ${fmt(pa)} − LD ${fmt(ld)}) + QGR ${fmt(qgr)} = ${fmt(aqp)}.`
                : `(PA ${fmt(pa)} − LD ${fmt(ld)}) + QGR ${fmt(qgr)} = ${fmt(expected)}, but the row holds ${fmt(aqp)}.`,
        });
    }

    return { available: true, row, checks, status: row.status || null };
}

/* ─── tax-basis checks ────────────────────────────────────────────── */
export function reconcileTaxBasis({ finance, payables, statement, cumulative, expectedGstPercent } = {}) {
    const checks = [];
    const add = (c) => checks.push(c);

    if (!finance?.available) {
        add({
            id: "finance-unreadable",
            title: "Finance page not readable",
            severity: SEVERITY.UNKNOWN,
            detail: `Tax basis cannot be checked — ${finance?.reason || "the payment page did not load"}.`,
        });
        return { checks, checked: false, errorCount: 0, warnCount: 0, unknownCount: 1 };
    }

    /* 1 · the split, and whether its rate can be trusted */
    if (!finance.hasSplit) {
        add({
            id: "no-split",
            title: "Payment page has no pre-tax split",
            severity: SEVERITY.WARN,
            detail: "Every term returns only its tax-inclusive value, so penalties are charged on a "
                + "tax-inclusive base. Penalties are charged on the deliverable's cost, not on the tax collected on it.",
        });
    } else if (finance.anomalies.length) {
        add({
            id: "rate-anomaly",
            title: "Some cost buckets carry a tax that is not a tax",
            severity: SEVERITY.ERROR,
            detail: finance.anomalies.map((b) =>
                b.zeroBaseWithTax
                    ? `${b.label}: base ${fmt(b.preTax)} but tax ${fmt(b.tax)} — a percentage of nothing`
                    : `${b.label}: ${fmt(b.preTax)} + ${fmt(b.tax)} implies ${pctStr(b.ratePercent)}`
            ).join("; ")
            + `. The project total therefore implies ${pctStr(finance.totalImpliedRate)}, which is not a tax rate. `
            + `${finance.representativeRate === null ? "No usable rate could be read." : `The rate used here is ${pctStr(finance.representativeRate)}, taken from the buckets that behave like tax.`}`,
        });
    } else {
        add({
            id: "split-present",
            title: "Finance page reports both bases",
            severity: SEVERITY.OK,
            detail: finance.taxFree
                ? `Contract value ${fmt(finance.postTax)} with no tax component — this contract is untaxed.`
                : `Contract value ${fmt(finance.preTax)} before tax, ${fmt(finance.postTax)} after — `
                  + `a consistent ${pctStr(finance.representativeRate)} across every bucket.`,
        });
    }

    /* 2 · which base the deliverable LD used */
    const legacy = Number(payables?.totals?.legacyBaseCount) || 0;
    const rowCount = Number(payables?.totals?.deliverableCount) || 0;
    if (rowCount === 0) {
        add({ id: "ld-base", title: "Deliverable LD base", severity: SEVERITY.UNKNOWN,
            detail: "No deliverable carried an SLA this quarter, so no LD base was used." });
    } else if (legacy === 0) {
        add({ id: "ld-base", title: "Deliverable LD charged before tax", severity: SEVERITY.OK,
            detail: `All ${rowCount} deliverable(s) charge LD on the pre-tax delivery value `
                + `(${fmt(payables?.totals?.totalLdBase)}), which is the correct base.` });
    } else {
        add({ id: "ld-base", title: "Some deliverable LD charged on a tax-inclusive base", severity: SEVERITY.ERROR,
            detail: `${legacy} of ${rowCount} deliverable(s) have no pre-tax base and fall back to the `
                + `tax-inclusive payment, overstating their LD by about ${pctStr(finance.representativeRate)}. `
                + "Re-save those milestones' payment terms so the page returns ldBasisPretaxValue." });
    }

    /* 3 · the invoice taxes two bases as one */
    const dNet = num(statement?.deliverableNet);
    const qNet = num(statement?.quarterlyNet);
    if (dNet !== null && qNet !== null && finance.hasSplit && !finance.taxFree) {
        add({ id: "mixed-basis-invoice", title: "Invoice adds GST across two different bases", severity: SEVERITY.ERROR,
            detail: `Section A's ${fmt(dNet)} is tax-inclusive — LD is charged pre-tax but deducted from the `
                + `payment, which carries tax. Section B's ${fmt(qNet)} is tax-exclusive. Section C then `
                + `applies ${expectedGstPercent ?? "GST"}% to their sum, so the deliverable half is taxed twice. `
                + "Either A should carry its pre-tax net into C, or C should tax only B." });
    }

    /* 4 · does the statement's rate match the contract's */
    const expected = num(expectedGstPercent);
    if (finance.representativeRate !== null && expected !== null && !finance.taxFree) {
        const matches = Math.abs(finance.representativeRate - expected) <= 0.5;
        add({ id: "rate", title: matches ? "Tax rate agrees with finance" : "Tax rate disagrees with finance",
            severity: matches ? SEVERITY.OK : SEVERITY.ERROR,
            detail: matches
                ? `The statement applies ${expected}% GST and the contract's cost items imply ${pctStr(finance.representativeRate)}.`
                : `The statement applies ${expected}% GST, but the contract's cost items imply `
                  + `${pctStr(finance.representativeRate)}. One of the two is wrong for this project.` });
    }

    /* 5 · the ceiling is measured tax-inclusive, AQP is not */
    const paid = num(cumulative?.totalAqp);
    if (paid !== null && finance.postTax !== null && finance.preTax !== null && !finance.taxFree) {
        const onPost = finance.postTax > 0 ? (paid / finance.postTax) * 100 : null;
        const onPre = finance.preTax > 0 ? (paid / finance.preTax) * 100 : null;
        add({ id: "ceiling-basis", title: "Ceiling and payments sit on different tax bases", severity: SEVERITY.WARN,
            detail: `The ceiling follows Finance — ${finance.ccnPercent ?? 25}% CCN headroom on the tax-inclusive `
                + `${fmt(finance.postTax)}, matching its own ccn.value. But AQP is tax-exclusive, so `
                + `${fmt(paid)} paid reads as ${pctStr(onPost)} of that ceiling when like-for-like against the `
                + `pre-tax ${fmt(finance.preTax)} it is ${pctStr(onPre)}. Usage is understated, not overstated.` });
    }

    return {
        checks,
        checked: true,
        errorCount: checks.filter((c) => c.severity === SEVERITY.ERROR).length,
        warnCount: checks.filter((c) => c.severity === SEVERITY.WARN).length,
        unknownCount: checks.filter((c) => c.severity === SEVERITY.UNKNOWN).length,
    };
}

export { num as toNumber };
