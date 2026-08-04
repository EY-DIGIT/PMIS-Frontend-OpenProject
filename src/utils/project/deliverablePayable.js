/* ══════════════════════════════════════════════════════════════════
   Deliverable payment → LD → net payable (RFP §5.28.2).

   Joins the deliverable track of the SLA rollup to the finance page:

       SLA occurrence → activity → milestone → payment term(s)

   ── Which number the LD is charged on ─────────────────────────────
   SLA 001 and 002 both charge on "the total cost of that deliverable"
   (§5.28.2.b, §5.28.2.c), and §5.23.1 defines that cost as the
   deliverable's own share of the Phase-1 fixed + one-time cost —
   D1..D6 at 5% each, D7 at 15%, D8 at 20%. For D1–D8 the deliverable's
   cost and its payment are therefore the SAME number:

       LD ₹        = payment × Σ LD %
       Net payable = payment − LD ₹

   The finance module's separate "LD Basis %" allotment is deliberately
   NOT used here. That split — a milestone paid less than its allotment
   but penalised on the whole of it — is built for the resource /
   quarterly regime; Phase 1 has no such distinction, because §5.23.1
   pays each deliverable its own cost outright. The allotment is still
   carried on each row so a divergence can be reported: an LD Basis that
   differs from the deliverable's cost usually means it is still sitting
   on the backend's even split (100 / milestones-in-phase) rather than
   the §5.23.1 schedule.

   ── Ceilings ──────────────────────────────────────────────────────
   §5.28.2 states no ceiling. The RFP's two ceilings are both scoped to
   the quarterly regime and cannot reach this one:

     · §5.27.6 caps cumulative quarterly LD at 10% of NPQP, and
       NPQP = F + QGR (§5.28.1.d). SLA 001/002 apply only to D1–D8,
       i.e. Phase 1, where F does not exist (staff cost starts at D9,
       §5.25.2) and QGR does not exist (§5.23.2 runs it over Phase 2
       and 3). There is no NPQP for that cap to be 10% of.
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
                    paymentPercent: 0,
                    ldBasisValue: 0,
                    ldBasisPercent: 0,
                });
            }
            const e = byMilestone.get(key);
            e.terms.push(t);
            const phaseLabel = String(ph?.phase ?? "");
            if (phaseLabel && !e.phases.includes(phaseLabel)) e.phases.push(phaseLabel);
            e.paymentValue += num(t.value) ?? 0;
            e.paymentPercent += num(t.percentOfPayment) ?? 0;
            e.ldBasisValue += num(t.ldBasisValue) ?? 0;
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
                    paymentPercent: term.paymentPercent,
                    ldBasisValue: term.ldBasisValue,
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

        /* §5.28.2 charges on "the total cost of that deliverable", and
           §5.23.1 makes that cost the deliverable's own payment. So the
           base IS the payment — there is no allotment step in Phase 1. */
        const hasBase = row.paymentValue > 0;
        const ldAmount = hasBase ? (row.paymentValue * ldPercentCapped) / 100 : null;

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
            ldAmount,
            backendLdAmount,
            /* LD % can exceed 100 — §5.28.2 sets no ceiling and the rates
               accrue per week indefinitely — so net payable can go
               negative. Shown rather than clamped: a deliverable whose
               LD has eaten its entire cost is a fact the reviewer needs. */
            netPayable: ldAmount === null ? null : row.paymentValue - ldAmount,
            /* The allotment is not the charge base (see header). A
               divergence means LD Basis is configured off the §5.23.1
               deliverable schedule — worth reporting, not acting on. */
            ldBasisDiffers:
                row.ldBasisValue > 0 && Math.abs(row.ldBasisValue - row.paymentValue) > 0.5,
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
            totalLdBasis: sum(out, (r) => r.ldBasisValue),
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
