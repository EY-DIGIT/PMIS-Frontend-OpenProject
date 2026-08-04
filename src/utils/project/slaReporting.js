/* ══════════════════════════════════════════════════════════════════
   RFP conformance re-check for the quarterly rollup.

   `slaRollup.js` scores a quarter the way the backend does: every
   evaluation result is one measurement, and points are summed across
   the reporting interval. That is right for most SLAs and wrong for
   three shapes the RFP defines, all of which this module detects and
   re-derives from the SLA's OWN target table:

   ── 1. One score per measurement interval (§5.28.1.a–c) ────────────
   The two intervals do different jobs:

     · MEASUREMENT interval — when the SLA runs. All the resources in
       scope are aggregated into ONE availability figure for that
       interval, which gives one severity, and the SLA Cap (§5.28.1.b,
       "capped at Severity level = 4 WITHIN a measurement interval")
       is applied there.
     · REPORTING interval — points from each measurement interval
       ACCUMULATE (§5.28.1.a: "points will be accumulated, at every
       measurement interval, within their respective reporting
       intervals"), the total is read off the LD band table, the LD cap
       applies, and the SLA resets (§5.28.1.c).

   So for SLA 007 over a quarter:

       M1: 10 resources deployed → aggregate present days + hours
           → severity → SLA cap → points
       M2: same
       M3: same
       Quarter: M1 + M2 + M3 points → LD band → LD % → LD cap

   Summing is therefore CORRECT, and SLA 007's "Quarterly (based on
   average monthly availability of resource in a quarter)" describes
   the aggregation ACROSS RESOURCES inside each month — not an average
   across the three months.

   What can still go wrong is structural: if a measurement interval
   produces one result PER RESOURCE instead of one aggregated result,
   the points for that interval are multiplied by the headcount. Ten
   resources at SL2 would score 40 points where the RFP scores 4. That
   is what this module checks — one scored occurrence per measurement
   interval — along with intervals that produced no measurement at all.

   ── 2. Count-driven severity (SLA 004, 005, 011) ───────────────────
   These map a quarter's OCCURRENCE COUNT to a single severity —
   "No of occurrence >1 and <=2 → 3" — rather than scoring each
   occurrence. Per-occurrence summing double counts. The 4% band
   ceiling often hides it in the final LD %, but the points shown are
   wrong and the §5.28.1.a −2 offset for a clean measurement stops
   working.

   ── 3. "Week or part thereof" (§5.28.2.b/c) and per-day (§5.28.3.a) ─
   SLA 001/002 charge "for delay of each week OR PART THEREOF", i.e.
   ceil(days/7) — a floor would under-charge every partial week. The
   rate and unit are stored on the SLA as linear_escalation, so the
   expected percentage is checkable.

   ── 4. Carry-forward (SLA 008, 009) ────────────────────────────────
   "Severity level 4 applicable for every quarter thereafter till the
   actual date of onboarding" / "Severity Level 2 applicable for every
   quarter till replacement(s) is/are on-boarded". A breach opened in
   Y1-Q2 and still open in Y1-Q3 scores again in Q3 — but the rollup
   only sees results dated inside the selected quarter, so it silently
   disappears. Detected here from an unresolved earlier breach.

   ── What this module does NOT do ───────────────────────────────────
   It never changes a number. Every function returns what the RFP
   WOULD give alongside what the backend DID give, so the panel can
   show a divergence and name its cause. The backend stays the number
   of record, so the rollup and the Settlement page can never quietly
   disagree about what gets invoiced.

   Pure functions, no React, no fetching.
   ══════════════════════════════════════════════════════════════════ */

import { ldBandFor, parseISO } from "./slaRollup";

const num = (v) => {
    if (v === null || v === undefined || v === "") return null;
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
};

/* ─── interval cadence ───────────────────────────────────────────── */

/* Ranked so "finer than" is a comparison rather than a lookup table of
   pairs. ONE_TIME sits above ANNUAL because a one-time SLA is never
   re-measured within any reporting interval. */
const INTERVAL_RANK = {
    DAILY: 1, WEEKLY: 2, FORTNIGHTLY: 3, MONTHLY: 4,
    QUARTERLY: 5, HALF_YEARLY: 6, ANNUAL: 7, YEARLY: 7, ONE_TIME: 8,
};

export function intervalRank(value) {
    const key = String(value ?? "").trim().toUpperCase().replace(/[^A-Z]+/g, "_");
    return INTERVAL_RANK[key] ?? null;
}

/* True when an SLA is measured more often than it is reported, i.e. the
   reporting interval contains several measurement intervals whose points
   accumulate into it (§5.28.1.a). */
export function measuresMoreOftenThanItReports(master) {
    const m = intervalRank(master?.measurementInterval);
    const r = intervalRank(master?.reportingInterval);
    return m !== null && r !== null && m < r;
}

/* Which measurement interval a date falls in. The key only has to be
   stable and comparable within one reporting window, so the cheapest
   unambiguous form is used for each cadence. */
export function measurementIntervalKey(dateValue, interval) {
    const s = String(dateValue ?? "").slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
    const rank = intervalRank(interval);
    if (rank === null) return null;
    if (rank <= 1) return s;                       // DAILY
    if (rank <= 3) {                               // WEEKLY / FORTNIGHTLY
        const d = parseISO(s);
        if (!d) return null;
        // Monday-anchored week start, so a week never splits across keys.
        const day = (d.getDay() + 6) % 7;
        d.setDate(d.getDate() - day);
        return `W${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    }
    if (rank === 4) return s.slice(0, 7);          // MONTHLY → YYYY-MM
    return "whole";                                // QUARTERLY and coarser
}

/* Every measurement interval the reporting window contains, in order.
   Used to spot intervals that produced no measurement at all — a month
   with no attendance run is not a clean month, it is a missing one, and
   the difference matters when the severity-0 row is worth −2 points. */
export function expectedMeasurementIntervals(window, interval) {
    const rank = intervalRank(interval);
    if (!window || rank === null) return [];
    if (rank >= 5) return ["whole"];

    const start = parseISO(window.start);
    const end = parseISO(window.end);
    if (!start || !end || end < start) return [];

    const out = [];
    const seen = new Set();
    const cursor = new Date(start);
    // Day-by-day is wasteful for a quarter but exact for every cadence, and
    // a quarter is at most ~92 iterations.
    for (let guard = 0; guard < 400 && cursor <= end; guard += 1) {
        const key = measurementIntervalKey(
            `${cursor.getFullYear()}-${String(cursor.getMonth() + 1).padStart(2, "0")}-${String(cursor.getDate()).padStart(2, "0")}`,
            interval
        );
        if (key && !seen.has(key)) { seen.add(key); out.push(key); }
        cursor.setDate(cursor.getDate() + 1);
    }
    return out;
}

/* ─── target_rows ────────────────────────────────────────────────── */

/* `from` is EXCLUSIVE and `to` INCLUSIVE — the onboarding widget labels
   them so, and the RFP bands read the same way ("> P+7 days and <= P+14
   days"). null on either side means unbounded. */
function rowMatches(row, value) {
    if (row.fromValue !== null && !(value > row.fromValue)) return false;
    if (row.toValue !== null && !(value <= row.toValue)) return false;
    return true;
}

/* Rows can be written against different input variables (SLA 007 states
   both business days AND hours). Only one measured value is available
   here, so the rows are grouped and a single group chosen — matching the
   requested variable, else the unnamed "primary measurement" group, else
   the only group there is. An ambiguous table returns no severity rather
   than a guess: silently scoring against the wrong axis is worse than
   reporting that the check could not run. */
export function targetRowGroup(targetRows, inputVariable = null) {
    const rows = Array.isArray(targetRows) ? targetRows : [];
    if (!rows.length) return { rows: [], reason: "the SLA has no target table" };

    const groups = new Map();
    for (const r of rows) {
        const key = r.inputVariable || "";
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key).push(r);
    }
    if (groups.size === 1) return { rows: [...groups.values()][0], reason: null };

    if (inputVariable && groups.has(inputVariable)) {
        return { rows: groups.get(inputVariable), reason: null };
    }
    if (groups.has("")) return { rows: groups.get(""), reason: null };
    return {
        rows: [],
        reason: `the target table is split across ${groups.size} input variables `
            + `(${[...groups.keys()].filter(Boolean).join(", ")}) and none is the primary measurement`,
    };
}

/* A measured value → the severity its own table assigns. Returns null
   when nothing matches, which is a real answer: a value outside every
   band means the table has a hole. */
export function severityForValue(value, targetRows, inputVariable = null) {
    const v = num(value);
    if (v === null) return { severity: null, row: null, reason: "no measured value" };

    const { rows, reason } = targetRowGroup(targetRows, inputVariable);
    if (!rows.length) return { severity: null, row: null, reason };

    // Overlapping bands are a configuration error, not a decision to make
    // silently — take the harshest so the check never under-reports, and
    // say that it happened.
    const hits = rows.filter((r) => rowMatches(r, v));
    if (!hits.length) {
        return { severity: null, row: null, reason: `value ${v} falls outside every band in the target table` };
    }
    const worst = hits.reduce((a, b) => (b.severity > a.severity ? b : a));
    return {
        severity: worst.severity,
        row: worst,
        reason: hits.length > 1 ? `${hits.length} overlapping bands matched; took the highest severity` : null,
    };
}

/* The severity an unbounded-large value falls into — the row with no
   upper limit. That is exactly what an unresolved breach keeps scoring
   while it stays open, so SLA 008 yields 4 and SLA 009 yields 2 without
   either being named anywhere. */
export function openBreachSeverity(targetRows) {
    const { rows } = targetRowGroup(targetRows);
    const unbounded = rows.filter((r) => r.toValue === null);
    if (!unbounded.length) return null;
    return unbounded.reduce((a, b) => (b.severity > a.severity ? b : a)).severity;
}

/* Count-driven SLAs state their threshold against a number of events
   rather than a duration. The variable name is the only signal, and it
   is author-entered, so the match is deliberately broad — a false
   positive shows an extra advisory line, a false negative hides a real
   double-count. */
const COUNT_HINT = /(occurrence|count|number|replacement|instance|event|no_of|nos)/i;

export function isCountDriven(master) {
    const rows = Array.isArray(master?.targetRows) ? master.targetRows : [];
    if (!rows.length) return false;
    return rows.some((r) => COUNT_HINT.test(String(r.inputVariable ?? ""))
        || COUNT_HINT.test(String(r.thresholdLabel ?? "")));
}

/* "Every increase of 1 replacement → 4" (SLA 005) is a REPEATING
   severity, not a single one: three replacements is SL4 twice, not SL4
   once. A single-severity reading of such a table understates, so the
   wording is surfaced rather than resolved — the reviewer decides. */
const REPEAT_HINT = /\b(every|each|per)\b/i;

export function hasRepeatingThreshold(master) {
    const rows = Array.isArray(master?.targetRows) ? master.targetRows : [];
    return rows.some((r) => REPEAT_HINT.test(String(r.thresholdLabel ?? "")));
}

/* ─── linear escalation ──────────────────────────────────────────── */

const UNIT_DAYS = { day: 1, week: 7, fortnight: 14, month: 30 };

/* §5.28.2's "each week OR PART THEREOF" is a ceiling, not a division:
   8 days of delay is two weeks, not 1.14. Grace units are subtracted
   before the ceiling so a 3-working-day grace (§5.28.3.a) does not
   itself round up into a charge. */
export function expectedLinearPercent(delayDays, linearEscalation) {
    const days = num(delayDays);
    const esc = linearEscalation;
    if (days === null || !esc) return null;
    const unitDays = UNIT_DAYS[esc.unit] ?? null;
    if (!unitDays) return null;

    const chargeable = days - (esc.graceUnits ?? 0) * unitDays;
    if (chargeable <= 0) return 0;
    return Math.ceil(chargeable / unitDays) * esc.ratePerUnitPercent;
}

/* ─── the per-SLA re-check ───────────────────────────────────────── */

export const METHOD = {
    SUM: "sum",
    INTERVAL: "interval",
    COUNT: "count",
    LINEAR: "linear",
    UNVERIFIABLE: "unverifiable",
};

/* Percentages are compared with a tolerance: both sides are rounded
   money-adjacent figures and a 0.001% gap is float noise, not a finding. */
const EPSILON = 0.005;

/* One rolled-up SLA group re-scored under the RFP's own rules.

   `item` is a quarterlyItems / deliverableItems entry from rollupBySla,
   `master` its SLA library row, `period` the reporting window being
   shown — needed to know which measurement intervals it should contain.
   Returns null when there is nothing to check, so the caller can treat
   "no recheck" and "recheck agreed" differently — they are not the same
   statement. */
export function recheckSla(item, master, { severityScale: scale, ldBands, period } = {}) {
    if (!item) return null;

    const backendPoints = num(item.accumulatedPoints);
    const backendLdPercent = num(item.ldPercent);

    const toLd = (severity) => {
        if (severity === null || !scale?.points) return { points: null, ldPercent: null };
        const points = scale.points.get(severity);
        if (!Number.isFinite(points)) return { points: null, ldPercent: null };
        const band = ldBandFor(points, ldBands);
        return { points, ldPercent: band ? band.ld_percent : null };
    };

    const base = {
        slaRef: item.slaRef,
        backendPoints,
        backendLdPercent,
        expectedPoints: null,
        expectedLdPercent: null,
        diverges: false,
        method: METHOD.SUM,
        note: null,
        detail: null,
    };

    /* ── linear / deliverable: check the per-occurrence rounding ──── */
    if (item.scoring === "linear" || item.track === "deliverable") {
        if (!master?.linearEscalation) {
            return { ...base, method: METHOD.UNVERIFIABLE, note: "no linear escalation rule on the SLA master, so the per-week rounding could not be checked" };
        }
        const checked = [];
        for (const o of item.occurrences || []) {
            const expected = expectedLinearPercent(o.delayDays, master.linearEscalation);
            const actual = num(o.ldPercent);
            if (expected === null || actual === null) continue;
            checked.push({
                activityCode: o.activityCode, delayDays: num(o.delayDays),
                expected, actual, diverges: Math.abs(expected - actual) > EPSILON,
            });
        }
        if (!checked.length) {
            return { ...base, method: METHOD.UNVERIFIABLE, note: "no occurrence carried both a delay and an LD %, so the per-week rounding could not be checked" };
        }
        const bad = checked.filter((c) => c.diverges);
        const esc = master.linearEscalation;
        return {
            ...base,
            method: METHOD.LINEAR,
            expectedLdPercent: checked.reduce((n, c) => n + c.expected, 0),
            diverges: bad.length > 0,
            detail: checked,
            note: bad.length
                ? `${bad.length} of ${checked.length} occurrence(s) do not match `
                  + `${esc.ratePerUnitPercent}% per ${esc.unit} or part thereof `
                  + `(§5.28.2 charges each ${esc.unit} "or part thereof", i.e. rounded up)`
                : null,
        };
    }

    /* ── count-driven: the quarter's occurrence COUNT is the input ── */
    if (isCountDriven(master)) {
        // The RFP counts events that happened — an incorrect recommendation,
        // a failure, a replacement — not measurements taken. A met result is
        // a measurement with no event in it.
        const count = (item.occurrences || []).filter((o) => o.status === "breached").length;
        const { severity, reason } = severityForValue(count, master.targetRows);
        if (severity === null) {
            return { ...base, method: METHOD.UNVERIFIABLE, note: `count-driven SLA, but ${reason}` };
        }
        const { points, ldPercent } = toLd(severity);
        const repeats = hasRepeatingThreshold(master);
        return {
            ...base,
            method: METHOD.COUNT,
            expectedPoints: points,
            expectedLdPercent: ldPercent,
            diverges: points !== null && backendPoints !== null && Math.abs(points - backendPoints) > EPSILON,
            detail: { count, severity },
            note: repeats
                ? `Its target table says "every"/"each" — the RFP's SLA 005 wording `
                  + `("every increase of 1 replacement") repeats the severity per unit rather than `
                  + `applying it once, so this single-severity reading may understate.`
                : null,
        };
    }

    /* ── several measurement intervals inside one reporting interval ──
       Points accumulate across them (§5.28.1.a), so the sum is right.
       What has to hold is the SHAPE: each measurement interval
       aggregates its resources into ONE score, and the SLA Cap applies
       there (§5.28.1.b). An interval carrying several scored
       occurrences means the aggregation did not happen — one row per
       resource rather than one row for the interval — and its points
       are then multiplied by the headcount. */
    if (measuresMoreOftenThanItReports(master) && period) {
        const cadence = String(master.measurementInterval).toLowerCase();
        const expected = expectedMeasurementIntervals(period, master.measurementInterval);
        if (!expected.length) {
            return { ...base, method: METHOD.UNVERIFIABLE, note: `measured ${cadence}, but this reporting window yields no measurement intervals to check against` };
        }

        const buckets = new Map(expected.map((k) => [k, { key: k, scored: [], unscored: [] }]));
        const strays = [];
        for (const o of item.occurrences || []) {
            const key = measurementIntervalKey(o.evaluatedOn, master.measurementInterval);
            if (!key) { strays.push(o); continue; }
            if (!buckets.has(key)) buckets.set(key, { key, scored: [], unscored: [], outsideWindow: true });
            const b = buckets.get(key);
            if (Number.isFinite(o.points)) b.scored.push(o); else b.unscored.push(o);
        }

        const list = [...buckets.values()].sort((a, b) => String(a.key).localeCompare(String(b.key)));
        for (const b of list) {
            b.points = b.scored.reduce((n, o) => n + o.points, 0);
            b.capApplied = b.scored.some((o) => o.capApplied);
            b.severities = b.scored.map((o) => o.cappedLevel);
        }

        const multiScored = list.filter((b) => b.scored.length > 1);
        const empty = list.filter((b) => !b.outsideWindow && b.scored.length === 0 && b.unscored.length === 0);

        /* Only re-derivable when every interval already holds a single
           aggregated score. Where it does not, the aggregate across that
           interval's resources is not something this page can reconstruct
           — it needs the attendance behind each row — so no expected
           figure is invented. */
        const expectedPoints = multiScored.length
            ? null
            : list.reduce((n, b) => n + b.points, 0);

        const notes = [];
        if (multiScored.length) {
            notes.push(
                `${multiScored.length} measurement interval(s) hold more than one scored result `
                + `(${multiScored.map((b) => `${b.key}: ${b.scored.length}`).join(", ")}). `
                + `§5.28.1.b scores ONE aggregated figure per measurement interval — all resources in scope `
                + `combined — so several rows in one interval multiply that interval's points by the number of rows.`
            );
        }
        if (empty.length) {
            notes.push(
                `${empty.length} of ${expected.length} measurement interval(s) produced no result at all `
                + `(${empty.map((b) => b.key).join(", ")}). An interval that was never run is not a clean one: `
                + `a met interval scores severity 0, which is worth ${scale?.points?.get(0) ?? "−2"} points and would `
                + `pull the quarter's total down.`
            );
        }
        if (strays.length) {
            notes.push(`${strays.length} result(s) carry no usable evaluation date and sit in no measurement interval.`);
        }

        return {
            ...base,
            method: METHOD.INTERVAL,
            expectedPoints,
            expectedLdPercent: expectedPoints === null ? null : (() => {
                const band = ldBandFor(expectedPoints, ldBands);
                return band ? band.ld_percent : null;
            })(),
            diverges: multiScored.length > 0
                || (expectedPoints !== null && backendPoints !== null && Math.abs(expectedPoints - backendPoints) > EPSILON),
            detail: {
                cadence,
                expectedCount: expected.length,
                buckets: list,
                multiScoredCount: multiScored.length,
                emptyCount: empty.length,
            },
            note: notes.length
                ? notes.join(" ")
                : `Measured ${cadence}, reported ${String(master.reportingInterval).toLowerCase()} — `
                  + `${expected.length} measurement intervals, each scored once and capped at severity `
                  + `${scale?.capLevel ?? "—"} (§5.28.1.b), their points accumulating into the quarter (§5.28.1.a).`,
        };
    }

    // Measured and reported on the same cadence with a duration-driven
    // table: summing the measurements IS what §5.28.1.a asks for.
    return base;
}

/* ─── carry-forward ──────────────────────────────────────────────── */

/* SLA 008 and SLA 009 keep scoring every quarter until the underlying
   breach is resolved. Nothing is hardcoded to those two refs — the app
   also carries the MSAP / BSP / MSIP libraries — so an open breach is
   inferred instead:

     · a BREACHED result dated before the selected quarter, and
     · no later MET result for the same SLA on the same activity.

   The severity it would carry is whatever its own target table assigns
   to an unbounded value (`openBreachSeverity`), which is precisely the
   RFP's "SL4 every quarter thereafter" / "SL2 every quarter till".

   Deliverable-track SLAs are excluded: §5.28.2 charges per week of
   delay on the deliverable itself and has no quarterly re-score.

   Returned as advisory only. It is never added to any total, because
   the backend is the number of record and inventing points here would
   put the rollup and the invoice out of step.                        */
export function detectCarryForward({ allResults, period, mastersByRef } = {}) {
    if (!period) return [];
    const results = Array.isArray(allResults) ? allResults : [];
    const masters = mastersByRef instanceof Map ? mastersByRef : new Map();

    // key = slaRef + activity, so two activities breaching the same SLA are
    // tracked as two independent obligations.
    const threads = new Map();
    for (const r of results) {
        if (!r.evaluatedOn) continue;
        const ref = r.slaRef || r.slaId;
        if (!ref) continue;
        const key = `${ref}::${r.activityId ?? ""}`;
        if (!threads.has(key)) threads.set(key, []);
        threads.get(key).push(r);
    }

    const out = [];
    for (const [key, list] of threads) {
        const sorted = list.slice().sort((a, b) => String(a.evaluatedOn).localeCompare(String(b.evaluatedOn)));
        const before = sorted.filter((r) => String(r.evaluatedOn).slice(0, 10) < period.start);
        if (!before.length) continue;

        // The most recent statement made before this quarter opened.
        const last = before[before.length - 1];
        if (last.status !== "breached") continue;

        // Already re-scored inside this quarter — the backend is emitting the
        // recurring row, so there is nothing missing to report.
        const inQuarter = sorted.some((r) => {
            const d = String(r.evaluatedOn).slice(0, 10);
            return d >= period.start && d <= period.end;
        });
        if (inQuarter) continue;

        const ref = key.split("::")[0];
        const master = masters.get(String(ref)) || null;

        // Only the quarterly, points-scored regime re-scores per quarter.
        const category = String(master?.categoryCode ?? "").toUpperCase();
        if (category.includes("DELIVERABLE")) continue;

        const severity = openBreachSeverity(master?.targetRows);
        out.push({
            slaRef: ref,
            slaTitle: master?.title || last.slaTitle || null,
            activityId: last.activityId ?? null,
            activityCode: last.activityCode || null,
            activityName: last.activityName || null,
            openedOn: last.evaluatedOn,
            quartersOpen: quartersBetween(last.evaluatedOn, period.start),
            severity,
            hasTargetTable: !!(master?.targetRows || []).length,
        });
    }

    return out.sort((a, b) => (b.severity ?? -1) - (a.severity ?? -1)
        || String(a.slaRef).localeCompare(String(b.slaRef)));
}

function quartersBetween(fromISO, toISO) {
    const a = parseISO(fromISO);
    const b = parseISO(toISO);
    if (!a || !b) return null;
    const months = (b.getFullYear() - a.getFullYear()) * 12 + (b.getMonth() - a.getMonth());
    return Math.max(1, Math.floor(months / 3));
}
