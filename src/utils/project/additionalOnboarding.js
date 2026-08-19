/* ══════════════════════════════════════════════════════════════════
   SLA 008 — onboarding of ADDITIONAL resources.

   Not the same event as SLA 009. That one measures a seat that already
   existed standing empty: somebody left, somebody replaced them, and
   the clock runs between the two. This one measures a seat that did not
   exist before — the team was approved to grow, and the clock runs from
   the date the new head was planned to deploy to the date they actually
   turned up.

   Which is why it is only ever the SECOND onboarding onwards. The first
   time a designation is staffed, that is the original deployment and it
   is measured as part of the activity's own mobilisation. Once that has
   happened, any further head against the same designation is an
   addition, and lands here.

   ── the report ────────────────────────────────────────────────────
   GET /api/attendance/report/activity/additional-resource-onboarding
       ?projectId&activityId

     { projectId, activityId, activityName, additionalResourceCount,
       additionalResources: [{
         slaNumber, designation,
         originalQuantity, currentApprovedQuantity, additionalQuantity,
         resId, employeeName,
         plannedDeploymentDate, actualOnboardingDate, onboardingDays,
         slaResult }] }

   ── what this module is for ───────────────────────────────────────
   Two screens render this report — the standalone compliance page and
   the reference panel beside the evaluation form. They look nothing
   alike, but they must AGREE: the same rows, the same grouping, the
   same tally, the same SLA number. Anything else and two screens quote
   two different figures for one activity, which is the specific failure
   that makes people stop trusting both of them.

   So the reading lives here and only the drawing lives in the two
   components.
   ══════════════════════════════════════════════════════════════════ */

/* Absence has to survive as null, which is why this checks for it BEFORE
   converting: `Number(null)` and `Number("")` are both 0, so the obvious
   one-liner turns "no onboarding time recorded" into "onboarded on the
   day it was planned" — a pending seat reading as a perfect score, which
   is the exact failure the pending state exists to prevent. */
const n = (v) => {
    if (v === null || v === undefined || v === "") return null;
    const x = Number(v);
    return Number.isFinite(x) ? x : null;
};

/* ─── the verdict ─────────────────────────────────────────────────
   PENDING IS ITS OWN ANSWER, and this is the point of the module.

   A row reading "Pending Onboarding" has no actualOnboardingDate and no
   onboardingDays — the seat is approved and nobody has arrived yet.
   That is not a pass: nothing has been met. It is not a failure either:
   the planned date may be months out, and colouring an unstaffed future
   seat red would put a breach on an activity that has not breached
   anything.

   Folding it into either would misstate the position, so it is counted
   separately and shown separately. That also matches how the two
   replacement tables already treat a result they cannot classify.

   Checked BEFORE pass/fail, because a pending row's text can contain
   words the other patterns match — "Pending Onboarding" contains
   nothing dangerous today, but "Awaiting compliance confirmation"
   contains "compliance", and a pending row shown green is exactly the
   mistake this ordering exists to prevent. */
const PENDING = /\b(pending|awaiting|await|awaited|yet\s+to|not\s+yet|in\s+progress|scheduled|planned|unfilled|vacant|open)\b/;

/* The failure words live inside the pass words — "not met" contains
   "met", "non-compliant" contains "compliant" — so negation is matched
   explicitly and first, exactly as the compliance page already does for
   the replacement SLAs. Punctuation is flattened so "not-met",
   "not_met" and "NOT MET" are one case rather than three. */
/* The server's real vocabulary, observed on a live activity, is a phrase
   rather than a verdict word: "Within 21 Days" for a seat filled inside the
   allowance. Nothing here matched it, so every row on a fully compliant
   activity read as UNCLASSIFIED — six grey rows where six should have been
   green. "within" is therefore a pass word and "beyond"/"exceeded"/"outside"/
   "more than" are failure words, with "not within" handled by the negation
   rule below so a breach phrased that way cannot come out green. */
const NEGATED_FAILURE = /\bno(t)?\s+(breach(ed)?|fail(ed|ure)?|delay(ed)?|shortfall|violat(ed|ion))\b/;
const NEGATED_PASS = /\bno(t|n)?\s+(met|meets|compl(y|ied|iant)|satisf(y|ied)|ok|onboarded|deployed|within)\b/;
const FAILURE = /\b(fail(ed|ure)?|breach(ed|es)?|delay(ed|s)?|late|overdue|shortfall|violat(ed|ion)|lapse[ds]?|beyond|exceed(ed|s)?|outside|more\s+than)\b/;
const PASSING = /\b(pass(ed|es)?|met|meets|compl(y|ied|iant)|ok|yes|onboarded|deployed|within|satisf(y|ied|actory))\b/;

export function classifyOnboarding(raw) {
    const s = String(raw ?? "").trim();
    if (!s) return "unknown";
    const norm = s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

    if (PENDING.test(norm)) return "pending";
    if (NEGATED_FAILURE.test(norm)) return "pass";
    if (NEGATED_PASS.test(norm)) return "fail";
    if (FAILURE.test(norm)) return "fail";
    if (PASSING.test(norm)) return "pass";
    if (norm === "no") return "fail";
    /* Anything else is shown as the server wrote it, in a neutral tone.
       An unrecognised result must stay readable and must never be
       coloured green by guesswork. */
    return "unknown";
}

/* ─── the rows ────────────────────────────────────────────────────
   Normalised so neither component has to know which fields might be
   absent. Quantities and day counts become numbers or null — never 0 by
   accident, because `Number(null)` is 0 and a seat with no recorded
   onboarding time would otherwise read as "onboarded the same day". */
export function readAdditionalResources(data) {
    const raw = Array.isArray(data?.additionalResources) ? data.additionalResources : [];
    return raw.map((r, i) => ({
        i,
        slaNumber: String(r?.slaNumber || "").trim(),
        designation: String(r?.designation || "").trim(),
        originalQuantity: n(r?.originalQuantity),
        currentApprovedQuantity: n(r?.currentApprovedQuantity),
        additionalQuantity: n(r?.additionalQuantity),
        resId: r?.resId ?? null,
        /* A named person or an empty seat. Both are real states: the
           head is approved from the moment the quantity changes, and it
           can sit unnamed for weeks before anyone is assigned to it. */
        employeeName: String(r?.employeeName || "").trim(),
        plannedDeploymentDate: r?.plannedDeploymentDate ?? null,
        actualOnboardingDate: r?.actualOnboardingDate ?? null,
        onboardingDays: n(r?.onboardingDays),
        slaResult: String(r?.slaResult || "").trim(),
        kind: classifyOnboarding(r?.slaResult),
    }));
}

/* ─── the tally ───────────────────────────────────────────────────
   Counted from the rows rather than trusting a headline. Four buckets,
   not three: pending is not a verdict and does not belong in either
   column, and "unknown" stays separate from it because they mean
   different things — pending is the server telling us it is not done,
   unknown is us not understanding what the server said. */
export function tallyOnboarding(rows) {
    const t = { pass: 0, fail: 0, pending: 0, unknown: 0, total: rows.length };
    rows.forEach((r) => { t[r.kind] = (t[r.kind] || 0) + 1; });
    return t;
}

/* ─── the SLA number ──────────────────────────────────────────────
   Read off the rows rather than hardcoded, because that is where the
   backend puts it. Normally every row says the same thing and the
   heading can just show it.

   `mixed` is the case worth carrying: if two designations come back
   under different SLA numbers, a single heading would be a claim the
   payload does not support, so the caller shows the number per row
   instead. Rare, probably never — but a heading that is quietly wrong
   about which SLA a table scores is worse than a slightly busier one. */
export function readSlaNumbers(rows) {
    const seen = [];
    rows.forEach((r) => { if (r.slaNumber && !seen.includes(r.slaNumber)) seen.push(r.slaNumber); });
    return {
        numbers: seen,
        // "SLA008" reads as "SLA 008" everywhere else on these screens.
        label: seen.length === 1 ? seen[0].replace(/^([A-Za-z]+)\s*0*(\d+)$/, (_, a, d) => `${a.toUpperCase()} ${d.padStart(3, "0")}`) : "",
        mixed: seen.length > 1,
    };
}

/* ─── grouping ────────────────────────────────────────────────────
   The report's row granularity is not pinned down: a designation
   approved for three extra heads may come back as three rows (one per
   person) or as one row carrying additionalQuantity 3. Both are
   plausible readings of the contract and the sample only shows the
   one-of-one case, so this handles either rather than betting on one
   and rendering nonsense if the other turns up.

   Grouping by designation is what makes that possible. One row in a
   group renders as a plain row; several render under a designation
   header carrying the quantities once, because the quantities describe
   the DESIGNATION and repeating "0 → 3" on all three people's rows
   reads as three separate approvals for nine heads. */
export function groupByDesignation(rows) {
    const order = [];
    const by = new Map();

    rows.forEach((r) => {
        const key = r.designation || "—";
        if (!by.has(key)) {
            by.set(key, {
                designation: key,
                rows: [],
                originalQuantity: r.originalQuantity,
                currentApprovedQuantity: r.currentApprovedQuantity,
                additionalQuantity: r.additionalQuantity,
                slaNumber: r.slaNumber,
                /* Set when rows of one designation disagree about the
                   designation's own quantities. They describe the seat
                   count, so they cannot legitimately differ between two
                   people filling those seats — a disagreement means one
                   of the two readings above is wrong, and silently
                   showing the first row's numbers would hide it. */
                quantitiesVary: false,
            });
            order.push(key);
        }
        const g = by.get(key);
        if (g.rows.length) {
            const differs = (a, b) => a !== b && a !== null && b !== null;
            if (differs(g.originalQuantity, r.originalQuantity)
                || differs(g.currentApprovedQuantity, r.currentApprovedQuantity)
                || differs(g.additionalQuantity, r.additionalQuantity)) {
                g.quantitiesVary = true;
            }
        }
        // First non-null wins, so a group is not blanked by a sparse row.
        if (g.originalQuantity === null) g.originalQuantity = r.originalQuantity;
        if (g.currentApprovedQuantity === null) g.currentApprovedQuantity = r.currentApprovedQuantity;
        if (g.additionalQuantity === null) g.additionalQuantity = r.additionalQuantity;
        g.rows.push(r);
    });

    return order.map((k) => by.get(k));
}

/* ─── the envelope's own count ────────────────────────────────────
   `additionalResourceCount` is checked against the rows to catch a
   truncated list, which would otherwise pass unnoticed on a screen
   whose whole job is to be read off.

   It is compared against BOTH readings — the number of rows and the
   total additional headcount — because which one it means depends on
   the same unresolved granularity question above. Matching either is
   consistent; matching neither is the only state worth warning about,
   and warning on a disagreement that is really just the other reading
   would train people to ignore the warning. */
export function countCheck(data, rows, groups) {
    const stated = n(data?.additionalResourceCount);
    if (stated === null) return { stated: null, mismatch: false, headcount: null };

    /* Summed over DESIGNATIONS, not rows. `additionalQuantity` describes
       the designation, so in the one-row-per-person shape every one of a
       designation's three rows carries the same 3 — adding them per row
       gives 9 heads where 3 were approved, and the figure grows with the
       square of the team. Counting each group once is the only reading
       that holds under both row granularities. */
    const by = groups || groupByDesignation(rows);
    const headcount = by.reduce((t, g) => t + (g.additionalQuantity ?? 0), 0);

    return {
        stated,
        headcount,
        mismatch: stated !== rows.length && stated !== headcount,
    };
}
