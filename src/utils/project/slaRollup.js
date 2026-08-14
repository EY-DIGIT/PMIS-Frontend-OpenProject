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
   its middle day. Since PQP is only published per calendar quarter and
   the RFP measures everything from T0, the honest answer is to take
   both and weight them by actual day overlap:

       Y2-Q1 = 15 Feb → 14 May (89 days)
         2026-Q1  45 days  50.6%
         2026-Q2  44 days  49.4%
       PQP = 0.506 × PQP(2026-Q1) + 0.494 × PQP(2026-Q2)

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

/* Blend per-quarter PQP figures by day weight. `values` maps a calendar
   quarter key to its PQP.

   A quarter whose PQP could not be read is NOT treated as zero — that
   would quietly halve the base and understate every LD on the screen.
   The blend is instead reported as incomplete, with the missing keys
   named, and the caller decides whether to show a number at all.      */
export function blendPqp(overlaps, values) {
    const list = Array.isArray(overlaps) ? overlaps : [];
    if (!list.length) return { pqp: null, complete: false, missing: [], parts: [] };

    const parts = list.map((o) => ({ ...o, pqp: Number(values?.[o.key]) }));
    const missing = parts.filter((p) => !Number.isFinite(p.pqp) || p.pqp <= 0);
    const usable = parts.filter((p) => Number.isFinite(p.pqp) && p.pqp > 0);

    return {
        parts,
        missing: missing.map((p) => p.key),
        complete: missing.length === 0,
        exact: list.length === 1,
        pqp: missing.length === 0
            ? usable.reduce((n, p) => n + p.pqp * p.weight, 0)
            : null,
    };
}

export function withinWindow(dateValue, window) {
    if (!dateValue || !window) return false;
    const d = String(dateValue).slice(0, 10);
    return d >= window.start && d <= window.end;
}

/* Which date decides the quarter a result is charged to.

   NOT `evaluatedOn`. That is the day somebody pressed Evaluate, so it
   files a breach into whichever quarter the RUN happened in — evaluate a
   Q3 activity in August and its penalty lands in Q4, while Q3 closes at
   zero. The results carry no field saying which period they measure
   (checked: severityLevel, delayDays, ldPercent, evaluatedOn … and
   nothing else), so the activity's own window is the best available
   answer to "when was this work done".

   The END date decides it, for two reasons:
     · one quarter only — an activity that straddles a boundary is never
       counted in both, which would charge the same breach twice;
     · it matches how a deliverable becomes payable in the quarter its
       work finishes, however late that is.

   With contract quarters anchored so activities start on a boundary,
   start and end fall in the same quarter and the choice is moot. The
   rule only bites on a straddling activity, and there it errs towards
   the quarter the work was completed in.

   `evaluatedOn` remains the last resort: an activity with no dates at
   all still has to appear somewhere rather than vanish from every
   quarter. */
export function attributionDate(result) {
    return result?.activityEndDate || result?.activityStartDate || result?.evaluatedOn;
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
   delay. No severity, no points, no PQP. §5.28.2.a is explicit that
   resource-based SLAs do not apply in this phase at all.

   §5.28.3–5.28.4 (Phase 2/3 and the governance tool). Severity →
   points → LD band → a percentage of PQP, accumulated over a quarter.

   §5.28.3.a (SLA 003) is the hybrid that forces two axes rather than
   one: it escalates linearly (0.1% per day, no points) but is charged
   against PQP. So the TRACK is decided by what the LD is charged on,
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
       every other category on PQP. The base is only consulted when no
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
    const status = normalizeStatus(result.status);
    const raw = Number(result.severityLevel);
    const hasLevel = Number.isFinite(raw);
    const capLevel = scale.capLevel;
    const cappedLevel = hasLevel && capLevel != null ? Math.min(raw, capLevel) : raw;

    /* An excluded occurrence scores nothing even if a severity came back
       on it. SLA 007's Note removes such resources from the calculation
       outright, so letting a stale severity through would charge LD for
       precisely the case the clause exempts. */
    const excluded = status === STATUS.EXCLUDED;
    const points = hasLevel && !excluded ? scale.points.get(cappedLevel) : undefined;

    return {
        ...result,
        normalizedStatus: status,
        excluded,
        severityLevel: hasLevel ? raw : null,
        cappedLevel: hasLevel ? cappedLevel : null,
        capApplied: !excluded && hasLevel && capLevel != null && raw > capLevel,
        points: Number.isFinite(points) ? points : null,
        // Only a genuine gap — a level with no row in the severity master.
        // An excluded row is not "unknown", it is deliberately unscored.
        pointsUnknown: hasLevel && !excluded && !Number.isFinite(points),
    };
}

/* ─── result status ──────────────────────────────────────────────────
   The backend's status vocabulary is wider than the three values this
   module originally matched, and the extra ones are not cosmetic:

     · `pending_observation` — the evaluation ran and made a row, but the
       backend could not score it and is waiting on a reading. Matching
       only the bare string "pending" counted these as zero of
       everything, so an activity with two unread SLAs reported a clean
       quarter.

       This used to be the PERMANENT state of every resource SLA
       (005–009), on the basis that attendance could not be derived. That
       is no longer true: as of 2026-08-11 `/on-complete` returns
       005–009 in `autoEvaluated` with `formula_type:
       "point_accumulation"` and a real met/breached status, and
       `manualNeeded` comes back empty. So a pending row is now an
       EXCEPTION worth chasing rather than the expected resting state —
       which is why the code still handles it, and why the screens no
       longer describe it as normal.

     · `excluded` — the occurrence is deliberately outside the
       calculation. SLA 007's Note is the case the RFP spells out:
       "Any of the above-mentioned resources for whom replacement is
       initiated by UIDAI will be excluded from this calculation."
       An excluded row must contribute NO points — counting it would
       penalise exactly the resource the clause protects.

   Matched by prefix rather than equality, because these are backend
   enum names and a new variant (`pending_input`, `excluded_by_uidai`)
   should degrade to the right bucket instead of silently becoming
   "unknown" and dropping out of every count.                          */
export const STATUS = {
    MET: "met",
    BREACHED: "breached",
    PENDING: "pending",
    EXCLUDED: "excluded",
    UNKNOWN: "unknown",
};

export function normalizeStatus(value) {
    const s = String(value ?? "").trim().toLowerCase();
    if (!s) return STATUS.UNKNOWN;
    if (s.startsWith("pending") || s.startsWith("awaiting")) return STATUS.PENDING;
    if (s.startsWith("exclud") || s.startsWith("not_applicable") || s === "n/a" || s === "na") return STATUS.EXCLUDED;
    if (s.startsWith("breach") || s.startsWith("fail") || s.startsWith("violat")) return STATUS.BREACHED;
    if (s === "met" || s.startsWith("complian") || s.startsWith("pass") || s.startsWith("achiev")) return STATUS.MET;
    return STATUS.UNKNOWN;
}

function statusCounts(occurrences) {
    const of = (kind) => occurrences.filter((o) => normalizeStatus(o.status) === kind).length;
    return {
        breached: of(STATUS.BREACHED),
        met: of(STATUS.MET),
        pending: of(STATUS.PENDING),
        excluded: of(STATUS.EXCLUDED),
        unknownStatus: of(STATUS.UNKNOWN),
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
            /* PROVISIONAL — severity capping on the deliverable track.
               Added on the contract team's instruction: "each SLA has a
               cap on severity for each reporting interval". One occurrence
               IS one reporting interval's measurement, so the §5.28.1.b
               cap is applied per occurrence exactly as on the quarterly
               points track.

               This does NOT follow from the RFP as read here: §5.28.2
               scores SLA 001/002 linearly in weeks of delay, with no
               severity input, and §5.28.2.a keeps the resource regime out
               of Phase 1 entirely. It is applied because the contract team
               says the contract requires it, and is to be revisited.

               Deliberately NOT wired into the money. `ldAmount` stays the
               backend's figure, because no clause maps a capped severity
               back to a deliverable LD percentage — inventing that mapping
               would silently change what gets charged. The cap is scored
               and surfaced; if it is meant to reduce LD, the mapping has
               to come from the contract, not from here. */
            const scored = occurrences.map((o) => scoreOccurrence(o, scale));
            const priced = scored.filter((o) => num(o.ldAmount) !== null);
            deliverableItems.push({
                ...g,
                occurrences: scored,
                ...counts,
                totalDelayDays,
                totalLdAmount: priced.reduce((n, o) => n + num(o.ldAmount), 0),
                unpricedCount: scored.length - priced.length,
                maxLdPercent: scored.reduce((m, o) => Math.max(m, num(o.ldPercent) ?? 0), 0),
                capHits: scored.filter((o) => o.capApplied).length,
                severityCapLevel: scale.configured ? scale.capLevel : null,
            });
            continue;
        }

        /* ── Quarterly track, linear scoring (§5.28.3.a — SLA 003) ────
           A per-day escalation charged on PQP. No severity and no band,
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
   by PQP once. It never apportions the ceiling back onto individual
   SLAs, so neither does this: the only two ceilings are the per-SLA
   band (applied in the rollup) and the §5.27.6 cumulative 10% of PQP
   applied here.

   PQP may legitimately be absent — its F component comes from leave
   management — so the amount stays null rather than reporting zero.   */
export function quarterTotals(quarterlyItems, { pqp, quarterCapPercent = 10 } = {}) {
    const items = Array.isArray(quarterlyItems) ? quarterlyItems : [];
    const contributing = items.filter((i) => Number.isFinite(i.ldPercent));
    const sumLdPercent = contributing.reduce((n, i) => n + i.ldPercent, 0);
    const cappedLdPercent = Math.min(sumLdPercent, quarterCapPercent);
    const base = Number(pqp);
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
        pqp: hasBase ? base : null,
        ldAmount: hasBase ? (base * cappedLdPercent) / 100 : null,
        ldAmountUncapped: hasBase ? (base * sumLdPercent) / 100 : null,
    };
}

/* ─── the quarter's one and only LD ceiling (§5.27.6) ────────────────
   As amended by the corrigendum of 21-Jul-2025 (s.no. 47):

     "Liquidated damages will be calculated on a quarterly basis. The
      cumulative 'liquidated damages' for each quarter shall under no
      circumstances exceed 10% of the Planned Quarterly Payment (PQP)
      (exclusive of applicable taxes, duties and levies)."

   Three things that sentence settles, and that this function encodes:

     · CUMULATIVE — one ceiling over the quarter's whole LD bill, both
       tracks together. Not per SLA: §5.28.1.f sums the percentages
       first, `(1%+2%) × PQP`. Not per deliverable either — a bidder
       asked for exactly that (query 138, "cap to 5% of respective
       milestone") and UIDAI answered "No Change".
     · 10% OF PQP — §5.28.1.c defines PQP as the aggregate monthly
       payment of all resources in the deployment plan plus any CCN
       resources. PQP was deleted outright (s.no. 49), so QGR is no
       longer part of the base.
     · EXCLUSIVE OF TAX — the ceiling and the charge are both pre-tax.

   PQP is a RESOURCE figure, and Phase 1 (D1–D8) is paid on deliverables
   against no deployment plan. So a Phase-1 quarter can charge LD while
   having no PQP to take 10% of. The RFP does not resolve that: §5.27.6
   says "each quarter" without carving Phase 1 out, and §5.28.1.c hands
   it a base that does not exist yet.

   Where the base is unknown the ceiling is reported as UNVALUED and the
   LD stands uncapped. Inventing a base — falling back on the contract
   value, or on the deliverable payments — would silently move invoiced
   money onto a rule nobody wrote.                                     */
export function combinedCapCheck(totals, dTotals) {
    const quarterly = Number(totals?.ldAmount);
    const deliverable = Number(dTotals?.totalLdAmount);
    const q = Number.isFinite(quarterly) ? Math.max(0, quarterly) : 0;
    const d = Number.isFinite(deliverable) ? Math.max(0, deliverable) : 0;
    const combined = q + d;

    const pqp = Number(totals?.pqp);
    const capPercent = Number(totals?.quarterCapPercent ?? 10);
    const ceilingKnown = Number.isFinite(pqp) && pqp > 0;
    const ceiling = ceilingKnown ? (pqp * capPercent) / 100 : null;

    /* Guarded on `> ceiling` rather than `>=` so a quarter landing exactly
       on the ceiling reports "at the ceiling", not "capped" — the figure
       does not move, and saying it was capped would misdescribe it. */
    const exceeds = ceilingKnown && combined > ceiling;

    return {
        applies: combined > 0,
        bothTracksCharged: q > 0 && d > 0,
        quarterlyLd: q,
        deliverableLd: d,
        combined,
        pqp: ceilingKnown ? pqp : null,
        ceiling,
        ceilingKnown,
        capPercent,
        /* What may actually be charged. Equal to `combined` unless the
           ceiling is both known and breached — never a clamp to zero. */
        chargeable: exceeds ? ceiling : combined,
        capApplied: exceeds,
        excess: exceeds ? combined - ceiling : 0,
        /* Charging LD with no valued ceiling is the reportable state: it
           is not a breach, but nobody has checked that it isn't one. */
        unvalued: combined > 0 && !ceilingKnown,
    };
}

/* Deliverable-track totals (§5.28.2). Each SLA here is charged on its
   own deliverable's cost, so only rupee amounts aggregate — summing
   percentages taken against different bases would be meaningless — and
   the §5.27.6 PQP ceiling does not reach this track. */
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

