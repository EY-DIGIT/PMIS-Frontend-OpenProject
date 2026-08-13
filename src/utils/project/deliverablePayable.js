/* ══════════════════════════════════════════════════════════════════
   Deliverable payment → LD → net payable (RFP §5.28.2).

   Joins the deliverable track of the SLA rollup to the finance page:

       SLA occurrence → activity → milestone → payment term(s)

   ── Which number the LD is charged on ─────────────────────────────
   SLA 001 and 002 both charge on "the total cost of that deliverable"
   (§5.28.2.b, §5.28.2.c). That cost is NOT the amount invoiced for the
   deliverable — the two come from DIFFERENT columns of §5.23.1's table,
   and confusing them is the easiest way to get this wrong:

     · "Payment Schedule in % of the Fixed cost for Phase-1 and One-time
       cost" — what is invoiced. D1–D6 5%, D7 15%, D8 20%. Sums to 65%;
       the other 35% is paid later as QGR.
     · "% of Phase-1 cost" — the deliverable's actual VALUE, added by
       corrigendum item 42 and stated by item 41 to be "used for SLA
       enforcement purposes". D1–D4 8%, D5 10%, D6 8%, D7 20%, D8 30%.
       Sums to 100%. THIS is the LD base.

   The corrigendum's own illustration (§5.25.1.e, item 46) settles it:
   Phase-1 cost 100, D1 invoiced at 5% = 5, but LD charged on 8% = 8, so
   a 4-week delay costs 0.5% x 4 = 2% of 8 = 1.6, and the payment
   released is 5 - 1.6 + 2.5(one-time) = 5.9.

   Verified against the live payload on 2026-08-14 (project 60c67666…):
   the payment page returns `percentOfPayment` 5/5/5/5/5/5/15/20 and
   `ldBasisPercent` 8/8/8/8/10/8/20/30 — i.e. it already supplies the
   enforcement column, and `ldBasisPretaxValue` is built from that. So
   the base below is the right one; do not "fix" it to the payment %.

   The payment page now computes that base itself and returns it per
   term as `ldBasisPretaxValue` = allotment × delivery PRE-TAX. It is the
   right base for two reasons the frontend cannot reconstruct on its own:

     · TAX IS EXCLUDED. A penalty is charged on the work, not on the GST
       collected on it. `value` and `ldBasisValue` are both post-tax, so
       charging on either inflates every LD by the tax rate (18% on a
       standard term).
     · ONE-TIME COST IS EXCLUDED. Out-of-pocket expense allocated to a
       milestone is a reimbursement, not deliverable value, and §5.28.2
       charges on the deliverable.

   So:
       LD ₹        = ldBasisPretaxValue × Σ LD %
       Net payable = payment − LD ₹        (deducted from what is paid,
                                            which IS tax-inclusive)

   `paymentValue` remains the fallback base for a payload that predates
   the split — the old behaviour exactly — and every row reports which of
   the two it used, so a screen never has to guess.

   The post-tax `ldBasisValue` allotment is still carried on each row so a
   divergence can be reported: a base that differs from the deliverable's
   own pre-tax payment usually means the LD Basis % is still sitting on
   the backend's even split (100 / milestones-in-phase) rather than the
   §5.23.1 schedule.

   ── Ceilings ──────────────────────────────────────────────────────
   §5.28.2 states no ceiling. The RFP's two ceilings are both scoped to
   the quarterly regime and cannot reach this one:

     · §5.27.6 caps cumulative quarterly LD at 10% of PQP, and
       PQP = F + QGR (§5.28.1.d). SLA 001/002 apply only to D1–D8,
       i.e. Phase 1, where F does not exist (staff cost starts at D9,
       §5.25.2) and QGR does not exist (§5.23.2 runs it over Phase 2
       and 3). There is no PQP for that cap to be 10% of.
     · §5.28.1.b caps points at severity 4 and reads a band table.
       SLA 001/002 carry no severity level, so there is nothing to cap.

   So nothing is capped here. `capPercent` remains as a single-argument
   switch for the day a clause is pointed at it; left null, nothing is
   capped and `ldPercentCapped` equals `ldPercent`.

   No React, no fetching — pass data in, get rows back.
   ══════════════════════════════════════════════════════════════════ */

/* null / undefined / "" are ABSENT, not zero. Number(null) is 0 and
   Number.isFinite(0) is true, so testing only for finiteness turns "no
   cap configured" into "cap of 0%" and "not priced yet" into "priced at
   nothing" — both silently wrong in the direction that hides money. */
import { normalizeStatus, STATUS } from "./slaRollup";

const num = (v) => {
    if (v === null || v === undefined || v === "") return null;
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
};
const sum = (list, pick) => list.reduce((n, x) => n + (pick(x) ?? 0), 0);

/* ─── finance side ────────────────────────────────────────────────
   A milestone can hold a payment term in more than one phase, so the
   terms are summed per milestone and the phases recorded, rather than
   arbitrarily picking one. */
export function paymentTermsByMilestone(paymentPage) {
    const byMilestone = new Map();
    const phases = Array.isArray(paymentPage?.phases) ? paymentPage.phases : [];

    for (const ph of phases) {
        for (const t of Array.isArray(ph?.paymentTerms) ? ph.paymentTerms : []) {
            if (!t?.milestoneId) continue;
            const key = String(t.milestoneId);
            if (!byMilestone.has(key)) {
                byMilestone.set(key, {
                    milestoneId: key,
                    terms: [],
                    phases: [],
                    paymentValue: 0,
                    paymentPreTaxValue: 0,
                    paymentTaxValue: 0,
                    paymentPercent: 0,
                    ldBasisValue: 0,
                    ldBasisPretaxValue: 0,
                    ldBasisPercent: 0,
                    /* Whether the pre-tax base was actually returned. Summing
                       into a 0 cannot say that: a term genuinely worth 0 and a
                       term from a payload that predates the field both leave
                       the total at 0, and only one of them means "fall back to
                       the payment". */
                    hasLdBasisPretax: false,
                    hasValueBreakup: false,
                });
            }
            const e = byMilestone.get(key);
            e.terms.push(t);
            const phaseLabel = String(ph?.phase ?? "");
            if (phaseLabel && !e.phases.includes(phaseLabel)) e.phases.push(phaseLabel);
            e.paymentValue += num(t.value) ?? 0;
            /* preTaxValue / taxValue are additive — an older payload carries
               neither, and there the legacy `value` is the only figure there
               is, so the pre-tax total degrades to it rather than to zero. */
            const pre = num(t.preTaxValue);
            const tax = num(t.taxValue);
            if (pre !== null || tax !== null) e.hasValueBreakup = true;
            e.paymentPreTaxValue += pre ?? num(t.value) ?? 0;
            e.paymentTaxValue += tax ?? 0;
            e.paymentPercent += num(t.percentOfPayment) ?? 0;
            e.ldBasisValue += num(t.ldBasisValue) ?? 0;
            const ldPre = num(t.ldBasisPretaxValue);
            if (ldPre !== null) { e.hasLdBasisPretax = true; e.ldBasisPretaxValue += ldPre; }
            e.ldBasisPercent += num(t.ldBasisPercent) ?? 0;
        }
    }
    return byMilestone;
}

/* ─── the report ──────────────────────────────────────────────────
   `deliverableItems` is rollupBySla().deliverableItems — already
   filtered to whatever period the caller is showing. `activityIndex`
   maps activityId → { milestoneId, milestoneName, code }.

   Occurrences whose activity has no milestone, or whose milestone has
   no payment term, cannot be netted against anything. They are
   returned separately instead of being dropped: an LD nobody can
   charge is precisely what a reviewer needs to see.               */
export function buildDeliverablePayables({
    deliverableItems,
    paymentPage,
    activityIndex,
    capPercent = null,
} = {}) {
    const items = Array.isArray(deliverableItems) ? deliverableItems : [];
    const finance = paymentTermsByMilestone(paymentPage);
    const acts = activityIndex instanceof Map ? activityIndex : new Map();

    const rows = new Map();
    const unlinked = [];

    for (const item of items) {
        for (const o of item.occurrences || []) {
            const act = acts.get(String(o.activityId));
            const milestoneId = act?.milestoneId ? String(act.milestoneId) : null;
            const term = milestoneId ? finance.get(milestoneId) : null;

            const contribution = {
                slaRef: item.slaRef,
                slaTitle: item.slaTitle || null,
                activityId: o.activityId || null,
                activityCode: o.activityCode || act?.code || null,
                activityName: o.activityName || act?.name || null,
                status: o.status || null,
                delayDays: num(o.delayDays),
                ldPercent: num(o.ldPercent),
                ldAmount: num(o.ldAmount),
                evaluatedOn: o.evaluatedOn || null,
            };

            if (!term) {
                unlinked.push({
                    ...contribution,
                    milestoneId,
                    milestoneName: act?.milestoneName || o.milestoneName || null,
                    reason: !milestoneId
                        ? "activity is not on any milestone"
                        : "milestone has no payment term",
                });
                continue;
            }

            if (!rows.has(milestoneId)) {
                rows.set(milestoneId, {
                    milestoneId,
                    milestoneName: act?.milestoneName || o.milestoneName || milestoneId,
                    phases: term.phases.slice(),
                    termCount: term.terms.length,
                    paymentValue: term.paymentValue,
                    paymentPreTaxValue: term.paymentPreTaxValue,
                    paymentTaxValue: term.paymentTaxValue,
                    hasValueBreakup: term.hasValueBreakup,
                    paymentPercent: term.paymentPercent,
                    ldBasisValue: term.ldBasisValue,
                    ldBasisPretaxValue: term.ldBasisPretaxValue,
                    hasLdBasisPretax: term.hasLdBasisPretax,
                    ldBasisPercent: term.ldBasisPercent,
                    contributions: [],
                });
            }
            rows.get(milestoneId).contributions.push(contribution);
        }
    }

    const out = [...rows.values()].map((row) => {
        const scored = row.contributions.filter((c) => c.ldPercent !== null);
        const ldPercent = sum(scored, (c) => c.ldPercent);
        const cap = num(capPercent);
        const ldPercentCapped = cap === null ? ldPercent : Math.min(ldPercent, cap);

        /* §5.28.2 charges on "the total cost of that deliverable". The
           payment page computes that as `ldBasisPretaxValue` — allotment ×
           delivery pre-tax, so tax-free and with one-time cost excluded —
           and that is the base whenever it came back. `paymentValue` is
           the fallback for payloads that predate the field, which is the
           behaviour this report had before. Which one was used is carried
           on the row, because the two differ by the tax rate and a reader
           comparing against the finance page needs to know why. */
        const usePretaxBase = row.hasLdBasisPretax && row.ldBasisPretaxValue > 0;
        const ldBase = usePretaxBase ? row.ldBasisPretaxValue : row.paymentValue;
        const ldBaseSource = usePretaxBase ? "ldBasisPretaxValue" : "paymentValue";
        const hasBase = ldBase > 0;
        const ldAmount = hasBase ? (ldBase * ldPercentCapped) / 100 : null;

        // What the backend itself priced each occurrence at, kept alongside
        // so a divergence between the two bases is visible rather than
        // silently resolved in favour of one of them.
        const priced = row.contributions.filter((c) => c.ldAmount !== null);
        const backendLdAmount = priced.length ? sum(priced, (c) => c.ldAmount) : null;

        // Per-SLA breakdown, so a row shows SLA001 and SLA002 separately.
        const bySla = new Map();
        for (const c of row.contributions) {
            if (!bySla.has(c.slaRef)) {
                bySla.set(c.slaRef, {
                    slaRef: c.slaRef, slaTitle: c.slaTitle,
                    ldPercent: 0, occurrences: 0, breaches: 0,
                });
            }
            const s = bySla.get(c.slaRef);
            s.ldPercent += c.ldPercent ?? 0;
            s.occurrences += 1;
            if (normalizeStatus(c.status) === STATUS.BREACHED) s.breaches += 1;
        }

        return {
            ...row,
            slas: [...bySla.values()].sort((a, b) => b.ldPercent - a.ldPercent),
            occurrenceCount: row.contributions.length,
            breachCount: row.contributions.filter((c) => normalizeStatus(c.status) === STATUS.BREACHED).length,
            unscoredCount: row.contributions.length - scored.length,
            ldPercent,
            ldPercentCapped,
            ldCapApplied: cap !== null && ldPercent > cap,
            hasBase,
            ldBase,
            ldBaseSource,
            ldAmount,
            backendLdAmount,
            /* LD % can exceed 100 — §5.28.2 sets no ceiling and the rates
               accrue per week indefinitely — so net payable can go
               negative. Shown rather than clamped: a deliverable whose
               LD has eaten its entire cost is a fact the reviewer needs.

               Deducted from `paymentValue`, the tax-inclusive amount that is
               actually paid, even though the LD was charged on a pre-tax
               base — §5.28.1.d takes the deduction off the payable. */
            netPayable: ldAmount === null ? null : row.paymentValue - ldAmount,
            /* §5.23.1 pays each deliverable its own cost, so the base and
               the deliverable's pre-tax payment should be the same number.
               Compared PRE-TAX on both sides — the base excludes tax, so
               measuring it against the post-tax payment would flag every
               taxed milestone. A real gap means the LD Basis % is off the
               §5.23.1 schedule (usually still on the backend's even split),
               or that one-time cost is a material part of the milestone —
               worth reporting, not acting on. */
            ldBasisDiffers:
                ldBase > 0
                && row.paymentPreTaxValue > 0
                && Math.abs(ldBase - row.paymentPreTaxValue) > 0.5,
        };
    });

    // Costliest deliverable first.
    out.sort((a, b) => (b.ldAmount ?? -1) - (a.ldAmount ?? -1)
        || String(a.milestoneName).localeCompare(String(b.milestoneName)));

    const withAmount = out.filter((r) => r.ldAmount !== null);
    return {
        rows: out,
        unlinked,
        totals: {
            deliverableCount: out.length,
            totalPayment: sum(out, (r) => r.paymentValue),
            totalPaymentPreTax: sum(out, (r) => r.paymentPreTaxValue),
            // What the LD was actually charged on, across every row.
            totalLdBase: sum(out, (r) => r.ldBase),
            totalLdBasis: sum(out, (r) => r.ldBasisValue),
            totalLdBasisPretax: sum(out, (r) => r.ldBasisPretaxValue),
            // Rows still falling back to the post-tax payment as their base.
            legacyBaseCount: out.filter((r) => r.ldBaseSource === "paymentValue").length,
            /* How many rows a ceiling actually bit on. Normally zero —
               §5.28.2 sets none, so `capPercent` is only ever passed by a
               caller that has decided otherwise — and a screen showing
               "before → after" needs to distinguish "nothing capped it"
               from "no cap exists". */
            capAppliedCount: out.filter((r) => r.ldCapApplied).length,
            /* The pre-cap total, so the pair can be shown without the
               caller re-deriving it from the rows. Equal to totalLdAmount
               whenever no ceiling was passed in. */
            totalLdAmountUncapped: withAmount.length
                ? sum(withAmount, (r) => (r.hasBase ? (r.ldBase * r.ldPercent) / 100 : 0))
                : null,
            totalLdAmount: withAmount.length ? sum(withAmount, (r) => r.ldAmount) : null,
            totalNetPayable: withAmount.length
                ? sum(out, (r) => r.paymentValue) - sum(withAmount, (r) => r.ldAmount)
                : null,
            missingBaseCount: out.filter((r) => !r.hasBase).length,
            // LD Basis configured off the §5.23.1 deliverable schedule.
            ldBasisMismatchCount: out.filter((r) => r.ldBasisDiffers).length,
            unlinkedCount: unlinked.length,
        },
    };
}
