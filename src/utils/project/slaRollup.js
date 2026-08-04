/* ══════════════════════════════════════════════════════════════════
   SLA quarterly rollup — contract-quarter windows and the RFP §5.28
   points → LD calculation.

   Kept free of React and of the API layer: feed it evaluation results,
   the project's severity master and its LD bands, get plain data back.
   That keeps the arithmetic testable on its own and stops the panel
   from quietly becoming the place the rules live.

   The RFP models a quarter as a REPORTING interval containing several
   MEASUREMENT intervals. Each measurement scores a severity level; the
   level is capped ("SLA Cap") at the top configured level, converted to
   points, and the points accumulate across the reporting interval. The
   accumulated total is then looked up in the LD band table to give that
   SLA's LD %, and every SLA's LD % is summed and capped for the quarter
   (§5.27.6). This module implements exactly that chain — with the
   thresholds read from the project's own configuration rather than
   hardcoded, so a project that tunes its bands is scored on its bands.
   ══════════════════════════════════════════════════════════════════ */

/* ─── date helpers ───────────────────────────────────────────────── */

const isoOf = (d) =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

/* Parse to a LOCAL midnight date. `new Date("2026-01-01")` is parsed as
   UTC and can land on the previous day west of Greenwich, which would
   shift a quarter boundary by a day — so the yyyy-mm-dd path is built
   component-wise instead. */
export function parseISO(value) {
    if (!value) return null;
    const s = String(value).slice(0, 10);
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
    if (m) return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? null : new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

/* Add months, clamping the day of month. Date#setMonth alone rolls 31 Jan
   + 1 month into 3 March; a contract signed on the 31st must not have its
   quarters drift, so short months clamp to their last day instead. */
export function addMonths(date, months) {
    const d = new Date(date.getFullYear(), date.getMonth() + months, 1);
    const lastDay = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
    d.setDate(Math.min(date.getDate(), lastDay));
    return d;
}

/* ─── contract quarters ──────────────────────────────────────────── */

/* Contract quarters are measured from T0 (the date the contract is
   signed / the project starts), NOT from a calendar or financial year.
   Quarter n spans [T0 + 3n months, T0 + 3(n+1) months). Year 1 is
   quarters 0–3, Year 2 is 4–7, and so on.

   `count` comes from the project's own end date when it has one; the
   fallback is 26 quarters — the RFP's 78-month (6.5 year) initial term.
   `max` is a guard so a bad end date can't generate a thousand options. */
export function contractQuarters(startDate, endDate, { max = 40 } = {}) {
    const t0 = parseISO(startDate);
    if (!t0) return [];

    let count = 26;
    const end = parseISO(endDate);
    if (end && end > t0) {
        const months =
            (end.getFullYear() - t0.getFullYear()) * 12 +
            (end.getMonth() - t0.getMonth()) +
            (end.getDate() >= t0.getDate() ? 1 : 0);
        count = Math.max(1, Math.ceil(months / 3));
    }
    count = Math.min(count, max);

    const out = [];
    for (let n = 0; n < count; n += 1) {
        const year = Math.floor(n / 4) + 1;
        const quarter = (n % 4) + 1;
        const start = addMonths(t0, 3 * n);
        const nextStart = addMonths(t0, 3 * (n + 1));
        const last = new Date(nextStart);
        last.setDate(last.getDate() - 1);
        out.push({
            index: n,
            year,
            quarter,
            key: `Y${year}-Q${quarter}`,
            label: `Year ${year} · Q${quarter}`,
            start: isoOf(start),
            end: isoOf(last),
        });
    }
    return out;
}

/* The contract quarter containing `on` — used to default the selector to
   wherever the project actually is today rather than to Year 1. */
export function contractQuarterFor(quarters, on = new Date()) {
    const target = on instanceof Date ? isoOf(on) : String(on).slice(0, 10);
    return quarters.find((q) => target >= q.start && target <= q.end) || null;
}

/* Every calendar quarter a contract quarter touches, with the share of
   the contract quarter's days that falls in each.

   `calendarQuarterFor` above picks ONE quarter by midpoint, which is an
   admitted approximation: a contract quarter of equal length straddling
   two calendar quarters is charged entirely against whichever one holds
   its middle day. Since NPQP is only published per calendar quarter and
   the RFP measures everything from T0, the honest answer is to take
   both and weight them by actual day overlap:

       Y2-Q1 = 15 Feb → 14 May (89 days)
         2026-Q1  45 days  50.6%
         2026-Q2  44 days  49.4%
       NPQP = 0.506 × NPQP(2026-Q1) + 0.494 × NPQP(2026-Q2)

   A contract quarter spans at most four months, so it can touch at most
   two calendar quarters — but the loop is written generally rather than
   assuming that, because a project with a badly-set end date can
   produce longer windows and silently dropping the tail would understate
   the base. When the quarters align exactly, one entry comes back with
   weight 1 and the result is exact rather than blended.               */
export function overlappingCalendarQuarters(window) {
    const start = parseISO(window?.start);
    const end = parseISO(window?.end);
    if (!start || !end || end < start) return [];

    const DAY = 24 * 60 * 60 * 1000;
    // Inclusive of both ends: 1 Jan → 1 Jan is one day, not zero.
    const totalDays = Math.round((end - start) / DAY) + 1;
    if (totalDays <= 0) return [];

    const out = [];
    let cursorYear = start.getFullYear();
    let cursorQ = Math.floor(start.getMonth() / 3) + 1;

    for (let guard = 0; guard < 24; guard += 1) {
        const qStart = new Date(cursorYear, (cursorQ - 1) * 3, 1);
        const qEnd = new Date(cursorYear, cursorQ * 3, 0);
        if (qStart > end) break;

        const from = qStart > start ? qStart : start;
        const to = qEnd < end ? qEnd : end;
        const days = Math.round((to - from) / DAY) + 1;
        if (days > 0) {
            out.push({
                key: `${cursorYear}-Q${cursorQ}`,
                start: isoOf(qStart),
                end: isoOf(qEnd),
                overlapStart: isoOf(from),
                overlapEnd: isoOf(to),
                days,
                weight: days / totalDays,
            });
        }
        cursorQ += 1;
        if (cursorQ === 5) { cursorQ = 1; cursorYear += 1; }
    }

    return out;
}

/* Blend per-quarter NPQP figures by day weight. `values` maps a calendar
   quarter key to its NPQP.

   A quarter whose NPQP could not be read is NOT treated as zero — that
   would quietly halve the base and understate every LD on the screen.
   The blend is instead reported as incomplete, with the missing keys
   named, and the caller decides whether to show a number at all.      */
export function blendNpqp(overlaps, values) {
    const list = Array.isArray(overlaps) ? overlaps : [];
    if (!list.length) return { npqp: null, complete: false, missing: [], parts: [] };

    const parts = list.map((o) => ({ ...o, npqp: Number(values?.[o.key]) }));
    const missing = parts.filter((p) => !Number.isFinite(p.npqp) || p.npqp <= 0);
    const usable = parts.filter((p) => Number.isFinite(p.npqp) && p.npqp > 0);

    return {
        parts,
        missing: missing.map((p) => p.key),
        complete: missing.length === 0,
        exact: list.length === 1,
        npqp: missing.length === 0
            ? usable.reduce((n, p) => n + p.npqp * p.weight, 0)
            : null,
    };
}

export function withinWindow(dateValue, window) {
    if (!dateValue || !window) return false;
    const d = String(dateValue).slice(0, 10);
    return d >= window.start && d <= window.end;
}

/* ─── severity & LD band lookups ─────────────────────────────────── */

/* Severity master → { level → points } plus the ceiling used for the
   per-measurement SLA Cap. RFP defaults are 0:-2, 1:2, 2:4, 3:6, 4:8 with
   a ceiling of 4, but everything here reads the project's own rows. */
export function severityScale(severityMaster) {
    const rows = (Array.isArray(severityMaster) ? severityMaster : [])
        .map((r) => ({ level: Number(r.level), points: Number(r.points), label: r.label }))
        .filter((r) => Number.isFinite(r.level) && Number.isFinite(r.points))
        .sort((a, b) => a.level - b.level);
    const points = new Map(rows.map((r) => [r.level, r.points]));
    return {
        rows,
        points,
        capLevel: rows.length ? rows[rows.length - 1].level : null,
        configured: rows.length > 0,
    };
}

/* LD bands → the band a points total falls in. Bands are thresholds, not
   ranges: the matching band is the highest whose threshold the total has
   reached. Below every threshold means no LD, which is the RFP's "<= 0
   → 0%" row. */
export function ldBandFor(points, ldBands) {
    const bands = (Array.isArray(ldBands) ? ldBands : [])
        .map((b) => ({ ...b, points_threshold: Number(b.points_threshold), ld_percent: Number(b.ld_percent) }))
        .filter((b) => Number.isFinite(b.points_threshold) && Number.isFinite(b.ld_percent))
        .sort((a, b) => a.points_threshold - b.points_threshold);
    if (!bands.length) return null;

    let hit = null;
    for (const b of bands) if (points >= b.points_threshold) hit = b;
    // Under the lowest threshold there is no penalty — return that band so
    // callers can still name the row they were scored against.
    return hit || bands[0];
}

export function topBandThreshold(ldBands) {
    const list = (Array.isArray(ldBands) ? ldBands : [])
        .map((b) => Number(b.points_threshold))
        .filter(Number.isFinite);
    return list.length ? Math.max(...list) : null;
}

/* ─── SLA classification ─────────────────────────────────────────────
   The RFP runs TWO distinct LD regimes, and they must never be added
   together — they are charged against different money.

   §5.28.2 (Phase 1, deliverables D1–D8). SLA 001 deducts 0.5% and SLA
   002 deducts 1% "of the total cost of that deliverable" per week of
   delay. No severity, no points, no NPQP. §5.28.2.a is explicit that
   resource-based SLAs do not apply in this phase at all.

   §5.28.3–5.28.4 (Phase 2/3 and the governance tool). Severity →
   points → LD band → a percentage of NPQP, accumulated over a quarter.

   §5.28.3.a (SLA 003) is the hybrid that forces two axes rather than
   one: it escalates linearly (0.1% per day, no points) but is charged
   against NPQP. So the TRACK is decided by what the LD is charged on,
   and the SCORING by how the percentage is derived.

   Both facts already travel on every evaluation result — `ldBaseKind`
   is the SLA master's `applied_on`, `formulaType` its category's
   formula — so none of this needs a backend change.                   */

export const TRACK = { DELIVERABLE: "deliverable", QUARTERLY: "quarterly" };
export const SCORING = { POINTS: "points", LINEAR: "linear" };

/* Categories charged on a single deliverable's cost.

   The category catalog stores a `code` (DELIVERABLE_SUBMISSION) next to
   a `display_name` ("Deliverable Submission"), and the onboarding form
   already carries a fallback for records that saved the display name
   instead of the code — so both forms are in the data. Comparing raw
   strings would match one and silently drop the other into the
   quarterly track, so everything is folded to a single shape first:
   upper-cased with every run of non-alphanumerics collapsed to "_".  */
export function normalizeCategory(value) {
    return String(value ?? "")
        .trim()
        .toUpperCase()
        .replace(/[^A-Z0-9]+/g, "_")
        .replace(/^_+|_+$/g, "");
}

const DELIVERABLE_CATEGORIES = new Set(["DELIVERABLE_SUBMISSION"]);

/* `basis` records WHY an SLA landed where it did. Without it the default
   branch is invisible: a project whose results carry no LD base at all
   would silently show every SLA as quarterly and an empty deliverable
   section, which reads exactly like "this project has no deliverable
   SLAs". Those two situations need telling apart, so the basis is
   returned and surfaced rather than swallowed. */
export function classifyResult(result) {
    const base = normalizeCategory(result?.ldBaseKind ?? result?.appliedOn);
    const formula = String(result?.formulaType ?? "").toLowerCase();
    const category = normalizeCategory(result?.categoryCode ?? result?.category);

    /* CATEGORY WINS over the stated LD base, and that ordering is load-
       bearing. The contracts service defaults `applied_on` to
       QUARTERLY_PAYMENT whenever it is not sent explicitly — the SLA
       onboarding form documents this and works around it by always
       sending the field. Any SLA created another way (seeded, imported,
       or before that workaround) therefore arrives claiming a quarterly
       base even when its category is DELIVERABLE_SUBMISSION, and
       trusting the base first silently files SLA 001/002 as resource
       SLAs.

       The category is the safer authority because it DERIVES the base:
       DELIVERABLE_SUBMISSION is charged on the deliverable's cost, and
       every other category on NPQP. The base is only consulted when no
       category came through at all.                                    */
    let track;
    let basis;
    if (DELIVERABLE_CATEGORIES.has(category)) { track = TRACK.DELIVERABLE; basis = "category"; }
    else if (category) { track = TRACK.QUARTERLY; basis = "category"; }
    else if (base === "FIXED_AMOUNT") { track = TRACK.DELIVERABLE; basis = "ldBaseKind"; }
    else if (base === "QUARTERLY_PAYMENT") { track = TRACK.QUARTERLY; basis = "ldBaseKind"; }
    // Nothing to go on. Default to the quarterly track, because that is where
    // the §5.27.6 ceiling lives: better contained than uncapped.
    else { track = TRACK.QUARTERLY; basis = "default"; }

    /* A category that contradicts the stated base is a data defect worth
       reporting — it is exactly the backend-default bug above, and the
       person configuring the SLA library is the one who can fix it. */
    const expectedBase = track === TRACK.DELIVERABLE ? "FIXED_AMOUNT" : "QUARTERLY_PAYMENT";
    const baseConflict = basis === "category" && !!base && base !== expectedBase;

    let scoring;
    if (formula === "fixed_escalation") scoring = SCORING.LINEAR;
    else if (formula === "point_accumulation") scoring = SCORING.POINTS;
    else scoring = track === TRACK.DELIVERABLE ? SCORING.LINEAR : SCORING.POINTS;

    return { track, scoring, basis, baseConflict, category, base };
}

/* ─── the rollup ─────────────────────────────────────────────────── */

/* One evaluation result becomes one scored occurrence.

   `severityLevel` is the measurement's raw score; `cappedLevel` is it
   after the §5.28.1.b SLA Cap. Points always derive from the CAPPED
   level — that is the whole purpose of the cap — while `capApplied` is
   surfaced so the screen can show the cap working rather than silently
   swallowing severity. */
function scoreOccurrence(result, scale) {
    const raw = Number(result.severityLevel);
    const hasLevel = Number.isFinite(raw);
    const capLevel = scale.capLevel;
    const cappedLevel = hasLevel && capLevel != null ? Math.min(raw, capLevel) : raw;
    const points = hasLevel ? scale.points.get(cappedLevel) : undefined;
    return {
        ...result,
        severityLevel: hasLevel ? raw : null,
        cappedLevel: hasLevel ? cappedLevel : null,
        capApplied: hasLevel && capLevel != null && raw > capLevel,
        points: Number.isFinite(points) ? points : null,
        pointsUnknown: hasLevel && !Number.isFinite(points),
    };
}

function statusCounts(occurrences) {
    return {
        breached: occurrences.filter((o) => o.status === "breached").length,
        met: occurrences.filter((o) => o.status === "met").length,
        pending: occurrences.filter((o) => o.status === "pending").length,
    };
}

const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : null);
const byDate = (a, b) => String(a.evaluatedOn || "").localeCompare(String(b.evaluatedOn || ""));

/* Group evaluation results by SLA, splitting the two regimes.

   Occurrences with no severity contribute nothing to a points total but
   are still listed: a `pending` SLA that was never scored is exactly
   what a reviewer needs to see, and hiding it would make the quarter
   look cleaner than it is. */
export function rollupBySla(results, { severityMaster, ldBands } = {}) {
    const scale = severityScale(severityMaster);
    const topThreshold = topBandThreshold(ldBands);
    const groups = new Map();

    for (const r of Array.isArray(results) ? results : []) {
        const ref = r.slaRef || r.slaId || "—";
        if (!groups.has(ref)) {
            groups.set(ref, {
                slaRef: ref,
                slaId: r.slaId || null,
                slaTitle: r.slaTitle || null,
                formulaType: r.formulaType || null,
                categoryCode: r.categoryCode || null,
                ...classifyResult(r),
                occurrences: [],
            });
        }
        const g = groups.get(ref);
        if (!g.formulaType && r.formulaType) g.formulaType = r.formulaType;
        if (!g.slaTitle && r.slaTitle) g.slaTitle = r.slaTitle;
        g.occurrences.push(r);
    }

    const deliverableItems = [];
    const quarterlyItems = [];

    for (const g of groups.values()) {
        const occurrences = g.occurrences.slice().sort(byDate);
        const counts = statusCounts(occurrences);
        const totalDelayDays = occurrences.reduce((n, o) => n + (num(o.delayDays) ?? 0), 0);

        /* ── Deliverable track (§5.28.2) ──────────────────────────────
           Each occurrence is charged on ITS OWN deliverable's cost, so
           percentages taken against different deliverables are not
           comparable and are deliberately never summed. Only the rupee
           amounts aggregate. */
        if (g.track === TRACK.DELIVERABLE) {
            const priced = occurrences.filter((o) => num(o.ldAmount) !== null);
            deliverableItems.push({
                ...g,
                occurrences,
                ...counts,
                totalDelayDays,
                totalLdAmount: priced.reduce((n, o) => n + num(o.ldAmount), 0),
                unpricedCount: occurrences.length - priced.length,
                maxLdPercent: occurrences.reduce((m, o) => Math.max(m, num(o.ldPercent) ?? 0), 0),
            });
            continue;
        }

        /* ── Quarterly track, linear scoring (§5.28.3.a — SLA 003) ────
           A per-day escalation charged on NPQP. No severity and no band,
           so the quarter's LD % is simply what its occurrences reached. */
        if (g.scoring === SCORING.LINEAR) {
            const scored = occurrences.filter((o) => num(o.ldPercent) !== null);
            quarterlyItems.push({
                ...g,
                occurrences,
                ...counts,
                totalDelayDays,
                scoredCount: scored.length,
                unscoredCount: occurrences.length - scored.length,
                capHits: 0,
                accumulatedPoints: null,
                pointsCapped: false,
                excessPoints: 0,
                band: null,
                ldPercent: scored.length ? scored.reduce((n, o) => n + num(o.ldPercent), 0) : null,
            });
            continue;
        }

        /* ── Quarterly track, points scoring (§5.28.1) ────────────────
           Severity capped per measurement, points accumulated across the
           reporting interval, then the band table read. That band table
           IS the per-SLA LD ceiling §5.28.1.b requires — points past the
           top threshold earn nothing further. */
        const scored = occurrences.map((o) => scoreOccurrence(o, scale));
        const contributing = scored.filter((o) => Number.isFinite(o.points));
        const accumulatedPoints = contributing.reduce((n, o) => n + o.points, 0);
        const band = scale.configured ? ldBandFor(accumulatedPoints, ldBands) : null;

        quarterlyItems.push({
            ...g,
            occurrences: scored,
            ...counts,
            totalDelayDays,
            scoredCount: contributing.length,
            unscoredCount: scored.length - contributing.length,
            capHits: scored.filter((o) => o.capApplied).length,
            accumulatedPoints,
            pointsCapped: topThreshold != null && accumulatedPoints > topThreshold,
            excessPoints: topThreshold != null ? Math.max(0, accumulatedPoints - topThreshold) : 0,
            band,
            ldPercent: band ? band.ld_percent : null,
        });
    }

    // Worst first: the SLAs actually costing money should not need scrolling to.
    const worstFirst = (key) => (a, b) =>
        (b[key] ?? -1) - (a[key] ?? -1) || String(a.slaRef).localeCompare(String(b.slaRef));
    quarterlyItems.sort(worstFirst("ldPercent"));
    deliverableItems.sort(worstFirst("totalLdAmount"));

    /* How the split was actually decided, so the screen can distinguish
       "no deliverable SLAs exist" from "nothing said which track to use". */
    const all = [...deliverableItems, ...quarterlyItems];
    const conflicted = all.filter((i) => i.baseConflict);
    const classification = {
        total: all.length,
        byLdBaseKind: all.filter((i) => i.basis === "ldBaseKind").length,
        /* Placed by applied_on because no category came through at all.
           This is the quiet failure: applied_on defaults to
           QUARTERLY_PAYMENT server-side, so a missing category does not
           look like missing data — it looks like a confident answer of
           "quarterly". Named so it can be reported rather than trusted. */
        byLdBaseKindRefs: all.filter((i) => i.basis === "ldBaseKind").map((i) => i.slaRef),
        byCategory: all.filter((i) => i.basis === "category").length,
        defaulted: all.filter((i) => i.basis === "default").length,
        defaultedRefs: all.filter((i) => i.basis === "default").map((i) => i.slaRef),
        // SLAs whose stored applied_on disagrees with their category.
        conflictCount: conflicted.length,
        conflicts: conflicted.map((i) => ({
            slaRef: i.slaRef, category: i.category, storedBase: i.base,
        })),
    };

    return { deliverableItems, quarterlyItems, scale, topThreshold, classification };
}

/* ─── quarter totals (§5.28.1.d and §5.27.6) ─────────────────────────
   The RFP sums every SLA's LD % for the quarter and multiplies that sum
   by NPQP once. It never apportions the ceiling back onto individual
   SLAs, so neither does this: the only two ceilings are the per-SLA
   band (applied in the rollup) and the §5.27.6 cumulative 10% of NPQP
   applied here.

   NPQP may legitimately be absent — its F component comes from leave
   management — so the amount stays null rather than reporting zero.   */
export function quarterTotals(quarterlyItems, { npqp, quarterCapPercent = 10 } = {}) {
    const items = Array.isArray(quarterlyItems) ? quarterlyItems : [];
    const contributing = items.filter((i) => Number.isFinite(i.ldPercent));
    const sumLdPercent = contributing.reduce((n, i) => n + i.ldPercent, 0);
    const cappedLdPercent = Math.min(sumLdPercent, quarterCapPercent);
    const base = Number(npqp);
    const hasBase = Number.isFinite(base) && base > 0;

    return {
        slaCount: items.length,
        contributingCount: contributing.filter((i) => i.ldPercent > 0).length,
        totalOccurrences: items.reduce((n, i) => n + i.occurrences.length, 0),
        totalBreaches: items.reduce((n, i) => n + i.breached, 0),
        totalPoints: items.reduce(
            (n, i) => n + (Number.isFinite(i.accumulatedPoints) ? i.accumulatedPoints : 0), 0
        ),
        sumLdPercent,
        cappedLdPercent,
        capApplied: sumLdPercent > quarterCapPercent,
        quarterCapPercent,
        npqp: hasBase ? base : null,
        ldAmount: hasBase ? (base * cappedLdPercent) / 100 : null,
        ldAmountUncapped: hasBase ? (base * sumLdPercent) / 100 : null,
    };
}

/* ─── the two tracks meeting in one quarter (§5.27.6) ────────────────
   §5.27.6 says "the cumulative liquidated damages for each quarter
   shall under no circumstances exceed 10% of the Net Planned Quarterly
   Payment". `quarterTotals` applies that ceiling to the quarterly track
   only, on the reasoning documented in deliverablePayable.js: SLA
   001/002 apply to D1–D8, i.e. Phase 1, where neither F (staff cost,
   from D9 per §5.25.2) nor QGR (§5.23.2, Phase 2–3) exists, so there is
   no NPQP for a 10% of it to bite on.

   That reasoning holds only while the phases do not overlap. A D1–D8
   deliverable that slips into a quarter where Phase 2 is already
   running produces BOTH kinds of LD in one quarter, and the literal
   reading of "cumulative liquidated damages for each quarter" then
   covers the combined figure.

   This does not resolve the ambiguity — it detects the one situation in
   which it becomes a live question, and reports the numbers on both
   readings so a human can decide before the invoice is raised.       */
export function combinedCapCheck(totals, dTotals) {
    const quarterly = Number(totals?.ldAmount);
    const deliverable = Number(dTotals?.totalLdAmount);
    const hasQuarterly = Number.isFinite(quarterly) && quarterly > 0;
    const hasDeliverable = Number.isFinite(deliverable) && deliverable > 0;

    // Only interesting when both regimes actually charged something in the
    // same quarter. One track alone is unambiguous.
    if (!hasQuarterly || !hasDeliverable) {
        return { applies: false, bothTracksCharged: false };
    }

    const npqp = Number(totals?.npqp);
    const capPercent = Number(totals?.quarterCapPercent ?? 10);
    const ceiling = Number.isFinite(npqp) && npqp > 0 ? (npqp * capPercent) / 100 : null;
    const combined = quarterly + deliverable;

    return {
        applies: true,
        bothTracksCharged: true,
        quarterlyLd: quarterly,
        deliverableLd: deliverable,
        combined,
        ceiling,
        capPercent,
        // Under the strict reading the combined total is already over the
        // ceiling, so the two readings give materially different invoices.
        exceedsIfCombined: ceiling !== null && combined > ceiling,
        excess: ceiling !== null ? Math.max(0, combined - ceiling) : null,
    };
}

/* Deliverable-track totals (§5.28.2). Each SLA here is charged on its
   own deliverable's cost, so only rupee amounts aggregate — summing
   percentages taken against different bases would be meaningless — and
   the §5.27.6 NPQP ceiling does not reach this track. */
export function deliverableTotals(deliverableItems) {
    const items = Array.isArray(deliverableItems) ? deliverableItems : [];
    return {
        slaCount: items.length,
        totalOccurrences: items.reduce((n, i) => n + i.occurrences.length, 0),
        totalBreaches: items.reduce((n, i) => n + i.breached, 0),
        totalLdAmount: items.reduce((n, i) => n + i.totalLdAmount, 0),
        unpricedCount: items.reduce((n, i) => n + i.unpricedCount, 0),
        affectedActivities: new Set(
            items.flatMap((i) => i.occurrences.map((o) => o.activityId).filter(Boolean))
        ).size,
    };
}

