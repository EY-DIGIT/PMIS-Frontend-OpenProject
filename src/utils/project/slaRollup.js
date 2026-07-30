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

/* NPQP is served per CALENDAR quarter, so a contract quarter has to be
   mapped onto one to fetch the payment base. The midpoint is used because
   it is the calendar quarter the contract quarter overlaps most. When the
   contract starts on a calendar boundary the two coincide exactly and
   `aligned` is true; otherwise the caller should say so on screen rather
   than presenting an approximate base as exact. */
export function calendarQuarterFor(window) {
    const start = parseISO(window?.start);
    const end = parseISO(window?.end);
    if (!start || !end) return null;
    const mid = new Date((start.getTime() + end.getTime()) / 2);
    const q = Math.floor(mid.getMonth() / 3) + 1;
    const calStart = new Date(mid.getFullYear(), (q - 1) * 3, 1);
    const calEnd = new Date(mid.getFullYear(), q * 3, 0);
    return {
        key: `${mid.getFullYear()}-Q${q}`,
        start: isoOf(calStart),
        end: isoOf(calEnd),
        aligned: isoOf(calStart) === window.start && isoOf(calEnd) === window.end,
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

/* ─── the rollup ─────────────────────────────────────────────────── */

/* One evaluation result becomes one scored occurrence.

   `severityLevel` is the measurement's raw score; `cappedLevel` is it
   after the SLA Cap. `points` is always derived from the CAPPED level —
   that is the whole point of the cap, and reporting the uncapped figure
   would overstate the quarter. `capApplied` is surfaced so the screen can
   show the cap doing its job rather than silently swallowing severity. */
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

/* Group evaluation results by SLA and score each group for one quarter.

   Occurrences with no severity contribute nothing to the points total but
   are still listed: a `pending` SLA that was never scored is exactly the
   thing a reviewer needs to see, and dropping it would make the quarter
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
                formulaType: r.formulaType || null,
                occurrences: [],
            });
        }
        const g = groups.get(ref);
        if (!g.formulaType && r.formulaType) g.formulaType = r.formulaType;
        g.occurrences.push(scoreOccurrence(r, scale));
    }

    const items = [...groups.values()].map((g) => {
        const occurrences = g.occurrences.slice().sort((a, b) =>
            String(a.evaluatedOn || "").localeCompare(String(b.evaluatedOn || ""))
        );
        const scored = occurrences.filter((o) => Number.isFinite(o.points));
        const accumulatedPoints = scored.reduce((n, o) => n + o.points, 0);
        const band = scale.configured ? ldBandFor(accumulatedPoints, ldBands) : null;

        return {
            ...g,
            occurrences,
            breached: occurrences.filter((o) => o.status === "breached").length,
            met: occurrences.filter((o) => o.status === "met").length,
            pending: occurrences.filter((o) => o.status === "pending").length,
            scoredCount: scored.length,
            unscoredCount: occurrences.length - scored.length,
            capHits: occurrences.filter((o) => o.capApplied).length,
            accumulatedPoints,
            // Points beyond the top band earn nothing further — the LD per
            // SLA is capped for the reporting interval (§5.28.1.b/c).
            pointsCapped: topThreshold != null && accumulatedPoints > topThreshold,
            excessPoints: topThreshold != null ? Math.max(0, accumulatedPoints - topThreshold) : 0,
            band,
            ldPercent: band ? band.ld_percent : null,
        };
    });

    // Worst first: the SLAs actually costing money should not need scrolling to.
    items.sort(
        (a, b) =>
            (b.ldPercent ?? -1) - (a.ldPercent ?? -1) ||
            b.accumulatedPoints - a.accumulatedPoints ||
            String(a.slaRef).localeCompare(String(b.slaRef))
    );

    return { items, scale, topThreshold };
}

/* Quarter totals. `quarterCapPercent` is the §5.27.6 ceiling on cumulative
   LD (10% of NPQP by default). NPQP may legitimately be absent — the base
   comes from leave-management and that service can be down — so the LD
   amount stays null rather than being reported as zero. */
export function quarterTotals(items, { npqp, quarterCapPercent = 10 } = {}) {
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
        totalPoints: items.reduce((n, i) => n + i.accumulatedPoints, 0),
        sumLdPercent,
        cappedLdPercent,
        capApplied: sumLdPercent > quarterCapPercent,
        quarterCapPercent,
        npqp: hasBase ? base : null,
        ldAmount: hasBase ? (base * cappedLdPercent) / 100 : null,
        ldAmountUncapped: hasBase ? (base * sumLdPercent) / 100 : null,
    };
}
