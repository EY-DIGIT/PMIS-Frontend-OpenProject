/* ══════════════════════════════════════════════════════════════════
   Section A of the payment statement — what the deliverables cost
   THIS QUARTER.

   The statement used to total every deliverable that happened to carry
   an SLA evaluation, which is neither this quarter's money nor the
   project's: it was whatever the SLA fan-out happened to touch. What a
   quarter-end invoice actually contains is narrower and differently
   shaped:

     · Only deliverables COMPLETED inside this contract quarter. A
       deliverable due in Q1 and delivered in Q2 is paid at the end of
       Q2 — late, penalised, but paid then and not before.
     · Their PRE-TAX payment. Tax is added once, on the invoice
       (§5.28.1.e), so carrying a tax-inclusive figure into the invoice
       line taxes it twice.
     · LD charged on the LD BASIS, not on the payment. Those are
       different numbers — the payment page returns `ldBasisPretaxValue`
       (allotment × delivery pre-tax) alongside a smaller `preTaxValue` —
       and §5.28.2 charges on the deliverable's cost while §5.25.1.b
       deducts from what is paid.
     · A deliverable still incomplete is NOT payable, however much LD it
       has accrued. Its penalty is real and growing, and it becomes
       chargeable in whichever quarter it finally completes.

   ── Completion ────────────────────────────────────────────────────
   Milestones carry `status` but no actual end date; activities carry
   both. So a deliverable is complete when its milestone says so, and it
   completed on the LATEST actual end date among its activities. A
   milestone marked complete whose activities carry no actual date
   cannot be placed in a quarter at all — reported as undated rather
   than dropped into whichever quarter is on screen.

   Pure functions. No React, no fetching.
   ══════════════════════════════════════════════════════════════════ */

import { paymentTermsByMilestone } from "./deliverablePayable";

/* ─── reading one activity's approval summary ─────────────────────
   The approval-status payload is what the Milestone Configuration
   screen's workflow panel renders. Its last step, "Activity Completed",
   is drawn from the OWNER DIVISION's decision — so an approved owner
   decision is the completion, and its `actionAt` is the date.

   `actionAt` arrives as epoch milliseconds. Converted here, in IST,
   because every other date on this page is a plain YYYY-MM-DD in local
   terms and a UTC conversion would move a late-evening approval into the
   next day — which, at a quarter boundary, moves it into the next
   quarter's invoice. */
const IST_OFFSET_MINUTES = 330;

function istDateFromMillis(v) {
    const n = Number(v);
    if (!Number.isFinite(n) || n <= 0) return "";
    const shifted = new Date(n + IST_OFFSET_MINUTES * 60000);
    if (Number.isNaN(shifted.getTime())) return "";
    return `${shifted.getUTCFullYear()}-${String(shifted.getUTCMonth() + 1).padStart(2, "0")}`
        + `-${String(shifted.getUTCDate()).padStart(2, "0")}`;
}

const APPROVED = /^approved$/i;

export function readActivityCompletion(approvalSummary) {
    const owner = approvalSummary?.ownerDivision || null;
    if (!owner || !APPROVED.test(String(owner.status || ""))) {
        return { completed: false, completedOn: "", approver: "" };
    }
    return {
        completed: true,
        completedOn: istDateFromMillis(owner.actionAt),
        approver: owner.approverName || owner.approverEmail || "",
    };
}

const num = (v) => {
    if (v === null || v === undefined || v === "") return null;
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
};
const iso = (v) => (v ? String(v).slice(0, 10) : "");

/* Signed day count between two YYYY-MM-DD dates — positive when `to` is
   later. Parsed as UTC midnight so a DST boundary cannot shift a slip by
   a day. */
const DAY_MS = 86400000;
function daysBetween(fromIso, toIso) {
    const p = (s) => {
        const [y, m, d] = String(s).split("-").map(Number);
        if (!y || !m || !d) return null;
        const dt = new Date(Date.UTC(y, m - 1, d));
        return Number.isNaN(dt.getTime()) ? null : dt;
    };
    const a = p(fromIso);
    const b = p(toIso);
    if (!a || !b) return null;
    return Math.round((b - a) / DAY_MS);
}

/* ─── completion ──────────────────────────────────────────────────
   A deliverable is delivered when its activities are, and an activity is
   delivered when its APPROVAL WORKFLOW says so — not when someone
   remembers to tick a status box.

   That distinction is the whole of this function. On a live project
   every milestone reads `status: "not_completed"` and every
   `actualEndDate` is null, while the workflow shows the activity
   approved and closed months ago. Gating on the status field means no
   deliverable is ever payable; gating on the workflow means the page
   agrees with what the Milestone Configuration screen already shows.

   Three signals, strongest first:
     1. the workflow's owner-division approval (`activityCompletion`) —
        authoritative, and carries the date the tool itself displays;
     2. an explicit `status: "Completed"` on the activity;
     3. an `actualEndDate`, for a record predating the workflow.

   `activityCompletion` is a Map of activityId → { completed, completedOn }
   built by the caller from the approval-status endpoint, so this module
   stays free of fetching.                                             */
export function indexMilestoneCompletion(milestones, { activityCompletion } = {}) {
    const flow = activityCompletion instanceof Map ? activityCompletion : new Map();
    const out = new Map();

    for (const [mi, m] of (Array.isArray(milestones) ? milestones : []).entries()) {
        if (!m?.apiId) continue;
        const activities = Array.isArray(m.activities) ? m.activities : [];

        let latest = "";
        let completedActivities = 0;
        let anyWorkflowDated = false;
        const rows = [];

        for (const [ai, a] of activities.entries()) {
            const wf = a?.apiId ? flow.get(String(a.apiId)) : null;
            const byFlow = !!wf?.completed;
            const byStatus = String(a?.status || "").toLowerCase() === "completed";
            const endDate = iso(a?.actualEndDate);
            const done = byFlow || byStatus || !!endDate;

            /* The workflow's date wins — it is the moment the deliverable
               was accepted, which is what §5.23.1 pays against. An
               actualEndDate is when work stopped, which can be earlier. */
            const on = done ? (iso(wf?.completedOn) || endDate) : "";

            /* Planned against actual, per activity. Both ends are kept
               because they answer different questions: a late START is a
               resourcing problem, a late FINISH is what SLA 001 charges
               for, and a deliverable can easily have one without the
               other. */
            const plannedStart = iso(a?.startDate);
            const plannedEnd = iso(a?.endDate);
            const actualStart = iso(a?.actualStartDate);
            const actualEnd = endDate || iso(wf?.completedOn);

            rows.push({
                activityId: a?.apiId ? String(a.apiId) : "",
                code: a?.serverDisplayCode || `A${mi + 1}.${ai + 1}`,
                name: a?.name || "",
                status: a?.status || "",
                done,
                plannedStart,
                plannedEnd,
                actualStart,
                actualEnd,
                /* Positive = finished late. Null when either end is unknown,
                   never 0 — "on time" and "we cannot tell" are different
                   answers and only one of them is reassuring. */
                startSlipDays: plannedStart && actualStart ? daysBetween(plannedStart, actualStart) : null,
                endSlipDays: plannedEnd && actualEnd ? daysBetween(plannedEnd, actualEnd) : null,
                acceptedOn: iso(wf?.completedOn),
                acceptedBy: wf?.approver || "",
                completedVia: wf?.completedOn ? "workflow" : endDate ? "actual end date" : byStatus ? "status" : "",
            });

            if (!done) continue;
            completedActivities += 1;
            if (wf?.completedOn) anyWorkflowDated = true;
            if (on && on > latest) latest = on;
        }

        /* All of them, not any: a milestone with three activities and one
           finished is not a delivered deliverable. A milestone explicitly
           marked complete is taken at its word — that only ever adds
           deliverables, never removes one. */
        const allDone = activities.length > 0 && completedActivities === activities.length;
        const complete = allDone || String(m.status || "").toLowerCase() === "completed";

        out.set(String(m.apiId), {
            milestoneId: String(m.apiId),
            code: m.serverDisplayCode || `M${mi + 1}`,
            name: m.name || "",
            status: m.status || "",
            complete,
            completedOn: latest || "",
            completedVia: anyWorkflowDated ? "workflow approval" : latest ? "actual end date" : "",
            activityCount: activities.length,
            completedActivityCount: completedActivities,
            activities: rows,
            /* Complete but with nothing to date it by — a deliverable with
               no activities under it, or one whose workflow carries no
               decision timestamp. It cannot be placed in a quarter, which
               is reported rather than guessed. */
            undated: complete && !latest,
        });
    }
    return out;
}

/* ─── this quarter's deliverable payment ──────────────────────────
   `ldByMilestone` is a Map of milestoneId → { ldPercent, ldPercentCapped,
   ldAmount, ldBase, slas[] } — the payable report already computes it, so
   it is passed in rather than recomputed here.                        */
export function buildQuarterDeliverablePayment({
    paymentPage,
    milestoneCompletion,
    ldByMilestone,
    period,
} = {}) {
    const terms = paymentTermsByMilestone(paymentPage);
    const completion = milestoneCompletion instanceof Map ? milestoneCompletion : new Map();
    const ld = ldByMilestone instanceof Map ? ldByMilestone : new Map();

    const start = iso(period?.start);
    const end = iso(period?.end);
    if (!start || !end) {
        return emptyResult("no quarter selected");
    }

    const paid = [];
    const accruing = [];
    const undated = [];

    for (const [milestoneId, term] of terms) {
        const done = completion.get(String(milestoneId)) || null;
        const charge = ld.get(String(milestoneId)) || null;

        /* Pre-tax throughout. `paymentPreTaxValue` degrades to the legacy
           `value` on a payload with no split, which is the old behaviour —
           flagged by the term's own `hasValueBreakup` so a screen can say
           the figure is tax-inclusive rather than quietly implying it is
           not. */
        const payment = num(term.paymentPreTaxValue) ?? 0;

        const row = {
            milestoneId: String(milestoneId),
            code: done?.code || "",
            name: done?.name || term.milestoneName || "",
            phases: term.phases.slice(),
            payment,
            paymentIsPreTax: !!term.hasValueBreakup,
            paymentTax: num(term.paymentTaxValue) ?? 0,
            ldBase: charge?.ldBase ?? null,
            ldBaseSource: charge?.ldBaseSource ?? null,
            ldPercent: charge?.ldPercent ?? 0,
            ldPercentCapped: charge?.ldPercentCapped ?? 0,
            ldAmount: charge?.ldAmount ?? 0,
            slas: charge?.slas ?? [],
            completedOn: done?.completedOn || "",
            completedVia: done?.completedVia || "",
            complete: !!done?.complete,
            activityCount: done?.activityCount ?? 0,
            completedActivityCount: done?.completedActivityCount ?? 0,
            /* Planned vs actual, per activity — the evidence behind the
               completion date this row is placed by. */
            activities: done?.activities ?? [],
        };
        row.net = row.payment - (row.ldAmount || 0);

        if (!done || !done.complete) {
            /* Not payable this quarter — but its LD is real and growing, so
               it is listed rather than hidden. §5.28.2's weekly accrual does
               not pause because nobody delivered. */
            if ((row.ldAmount || 0) > 0 || (row.ldPercent || 0) > 0) {
                accruing.push({ ...row, reason: done ? "not completed yet" : "no completion record" });
            }
            continue;
        }

        if (done.undated) {
            undated.push({ ...row, reason: "completed, but no activity carries an actual end date" });
            continue;
        }

        if (done.completedOn >= start && done.completedOn <= end) {
            paid.push(row);
        }
        // Completed in another quarter — that quarter's invoice, not this one.
    }

    /* Newest completion last, so the list reads in the order the work
       actually finished. */
    paid.sort((a, b) => (a.completedOn || "").localeCompare(b.completedOn || "")
        || String(a.code).localeCompare(String(b.code)));
    accruing.sort((a, b) => (b.ldAmount || 0) - (a.ldAmount || 0));

    const sum = (rows, pick) => rows.reduce((n, r) => n + (num(pick(r)) ?? 0), 0);

    return {
        available: true,
        reason: "",
        period: { start, end },
        paid,
        accruing,
        undated,
        totals: {
            count: paid.length,
            payment: sum(paid, (r) => r.payment),
            ldAmount: sum(paid, (r) => r.ldAmount),
            net: sum(paid, (r) => r.payment) - sum(paid, (r) => r.ldAmount),
            tax: sum(paid, (r) => r.paymentTax),
            accruingCount: accruing.length,
            accruingLd: sum(accruing, (r) => r.ldAmount),
            undatedCount: undated.length,
            /* Rows whose payment figure is still tax-inclusive because the
               payload carried no split. Their net is overstated by the tax,
               and the invoice would then tax it again. */
            postTaxPaymentCount: paid.filter((r) => !r.paymentIsPreTax).length,
        },
    };
}

function emptyResult(reason) {
    return {
        available: false,
        reason,
        period: null,
        paid: [],
        accruing: [],
        undated: [],
        totals: {
            count: 0, payment: 0, ldAmount: 0, net: 0, tax: 0,
            accruingCount: 0, accruingLd: 0, undatedCount: 0, postTaxPaymentCount: 0,
        },
    };
}
