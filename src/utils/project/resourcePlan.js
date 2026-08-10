/* ══════════════════════════════════════════════════════════════════
   F — the planned quarterly resource cost (RFP §5.28.1.d).

   Every LD figure on the rollup is a percentage of PQP, and

       PQP = F + QGR              (§5.28.1.d, steps c–e)

   where F is "the Planned Quarterly Payment applicable (aggregate of
   monthly payment of all resources to be deployed as per resource
   deployment plan Plus CCN resources, if any)".

   Until now F arrived only as a number from the PQP endpoint, which
   computes it from leave-management. The deployment plan itself is now
   on the project tree: a resource-based milestone's activities each
   carry allocation rows of

       { designation, quantity, duration (months), monthlyRate, computedCost }

   and that IS the "resource deployment plan" the clause names. Summing
   it gives F independently — so the base every LD on the page is
   charged against becomes checkable rather than taken on faith.

   ── What this module does NOT do ───────────────────────────────────
   It does not replace the endpoint's F. Leave-management holds the
   actual attendance and applies §5.25.2.b's MP = R(1 − L/N), which the
   plan cannot know; the plan is what was PLANNED, which is exactly what
   §5.28.1.d asks F to be, but the two are computed from different
   sources and a divergence is a finding for a human, not a number to
   silently prefer.

   Pure functions, no React, no fetching.
   ══════════════════════════════════════════════════════════════════ */

const num = (v) => {
    if (v === null || v === undefined || v === "") return null;
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
};

const iso = (v) => (v ? String(v).slice(0, 10) : "");

/* Inclusive overlap between an activity's dates and a quarter window.
   An activity with no dates cannot be placed in a quarter at all — it is
   reported as undated rather than quietly counted into whichever quarter
   happens to be on screen, which would inflate that quarter's F. */
function overlapsWindow(row, window) {
    const s = iso(row.startDate);
    const e = iso(row.endDate) || s;
    if (!s) return false;
    return s <= window.end && e >= window.start;
}

/* One allocation row's cost.

   The backend resolves monthlyRate and computedCost at save time from the
   rate card for the activity's contract year, so computedCost is the
   figure of record. The rate × qty × months fallback exists only for rows
   saved before that resolution ran; it is marked `derived` so a screen can
   say which rows are the server's numbers and which are arithmetic done
   here. A row with neither is unpriced — NOT zero, because zero would
   silently shrink F. */
export function priceAllocation(r) {
    const cost = num(r?.computedCost);
    if (cost !== null) return { cost, derived: false };

    const rate = num(r?.monthlyRate);
    const months = num(r?.duration);
    const qty = num(r?.quantity) ?? 1;
    if (rate === null || months === null) return { cost: null, derived: false };
    return { cost: rate * qty * months, derived: true };
}

/* ─── the plan for one quarter ────────────────────────────────────
   `rows` is the distilled activity list — see `collectResourceActivities`
   below — and `window` a contract quarter from `contractQuarters`.     */
export function deriveQuarterlyResourcePlan(rows, window) {
    const list = Array.isArray(rows) ? rows : [];
    if (!window) {
        return emptyPlan();
    }

    const inQuarter = [];
    const undated = [];
    for (const row of list) {
        if (!iso(row.startDate)) { undated.push(row); continue; }
        if (overlapsWindow(row, window)) inQuarter.push(row);
    }

    const byDesignation = new Map();
    const activities = [];
    let fAmount = 0;
    let unpricedCount = 0;
    let derivedCount = 0;
    let headcount = 0;

    for (const row of inQuarter) {
        let activityCost = 0;
        let activityUnpriced = 0;
        const allocations = [];

        for (const r of row.resources || []) {
            const { cost, derived } = priceAllocation(r);
            const qty = num(r?.quantity) ?? 1;
            const designation = String(r?.designation || "").trim() || "—";

            if (cost === null) { unpricedCount += 1; activityUnpriced += 1; }
            else {
                activityCost += cost;
                fAmount += cost;
                if (derived) derivedCount += 1;
            }
            headcount += qty;

            if (!byDesignation.has(designation)) {
                byDesignation.set(designation, {
                    designation, heads: 0, cost: 0, allocations: 0,
                    activityIds: new Set(), unpriced: 0,
                });
            }
            const d = byDesignation.get(designation);
            d.heads += qty;
            d.allocations += 1;
            if (cost === null) d.unpriced += 1; else d.cost += cost;
            if (row.activityId) d.activityIds.add(String(row.activityId));

            allocations.push({
                designation,
                quantity: qty,
                duration: num(r?.duration),
                monthlyRate: num(r?.monthlyRate),
                cost,
                derived,
            });
        }

        /* The activity's own stored total, kept beside the sum of its rows
           so a disagreement between them is visible. They should match —
           the backend writes both — and when they don't, one of the two
           was computed before an allocation changed. */
        const stored = num(row.resourceCostTotal);
        activities.push({
            ...row,
            allocations,
            cost: activityCost,
            unpriced: activityUnpriced,
            storedTotal: stored,
            storedDiffers: stored !== null && Math.abs(stored - activityCost) > 0.5,
        });
    }

    activities.sort((a, b) => b.cost - a.cost);

    /* An activity is meant to cover a single quarter — allocation duration
       is capped at 3 months for exactly that reason — so one spanning two
       contract quarters has its whole cost counted in both, overstating F
       in each. Worth naming rather than silently double-counting. */
    const spanning = inQuarter.filter((row) => {
        const s = iso(row.startDate);
        const e = iso(row.endDate) || s;
        return s < window.start || e > window.end;
    });

    return {
        window,
        fAmount: inQuarter.length ? fAmount : null,
        activities,
        activityCount: activities.length,
        allocationCount: activities.reduce((n, a) => n + a.allocations.length, 0),
        headcount,
        unpricedCount,
        derivedCount,
        byDesignation: [...byDesignation.values()]
            .map((d) => ({ ...d, activityCount: d.activityIds.size, activityIds: undefined }))
            .sort((a, b) => b.cost - a.cost),
        undatedCount: undated.length,
        undatedRefs: undated.map((r) => r.code || r.activityId).filter(Boolean),
        spanningCount: spanning.length,
        spanningRefs: spanning.map((r) => r.code || r.activityId).filter(Boolean),
        storedMismatchCount: activities.filter((a) => a.storedDiffers).length,
    };
}

function emptyPlan() {
    return {
        window: null, fAmount: null, activities: [], activityCount: 0,
        allocationCount: 0, headcount: 0, unpricedCount: 0, derivedCount: 0,
        byDesignation: [], undatedCount: 0, undatedRefs: [],
        spanningCount: 0, spanningRefs: [], storedMismatchCount: 0,
    };
}

/* ─── distil the project tree ─────────────────────────────────────
   Keeps only what F needs, so the panel holds a small array in state
   rather than the whole tree. Activities with no allocation rows are
   dropped: they contribute nothing to F and would only dilute the
   counts shown next to it.                                          */
export function collectResourceActivities(milestones) {
    const out = [];
    for (const [mi, m] of (Array.isArray(milestones) ? milestones : []).entries()) {
        for (const [ai, a] of (m?.activities || []).entries()) {
            const resources = Array.isArray(a?.resources) ? a.resources : [];
            if (!resources.length) continue;
            out.push({
                activityId: a.apiId || null,
                code: a.serverDisplayCode || `A${mi + 1}.${ai + 1}`,
                name: a.name || "",
                startDate: a.startDate || "",
                endDate: a.endDate || "",
                milestoneId: m?.apiId || null,
                milestoneName: m?.name || `Milestone ${mi + 1}`,
                milestoneIsResourceBased: m?.isResourceBased ?? null,
                resources,
                resourceCostTotal: a.resourceCostTotal ?? null,
            });
        }
    }
    return out;
}

/* ─── plan vs the PQP endpoint ───────────────────────────────────
   `endpointF` is the blended fAmount for the same contract quarter, so
   both sides describe the same window.

   The tolerance is relative rather than absolute: F runs to crores, and
   a fixed rupee threshold would either fire on every rounding difference
   or never fire at all. 1% is tight enough to catch a missing resource
   and loose enough to ignore leave-management's MP = R(1 − L/N)
   adjustment for a couple of unpaid days.                            */
export function compareFToPlan(planF, endpointF, { tolerancePercent = 1 } = {}) {
    const plan = num(planF);
    const endpoint = num(endpointF);
    if (plan === null || endpoint === null || endpoint === 0) {
        return {
            comparable: false,
            plan, endpoint,
            reason: plan === null
                ? "the deployment plan has no priced allocation in this quarter"
                : "the PQP endpoint returned no F for this quarter",
        };
    }
    const difference = plan - endpoint;
    const percent = (Math.abs(difference) / Math.abs(endpoint)) * 100;
    return {
        comparable: true,
        plan,
        endpoint,
        difference,
        percent,
        tolerancePercent,
        diverges: percent > tolerancePercent,
        // Which way: the plan expecting more than leave-management priced is
        // the common shape (an approved resource never onboarded, or unpaid
        // leave under §5.25.2.b), and reads very differently from the reverse.
        planHigher: difference > 0,
    };
}
