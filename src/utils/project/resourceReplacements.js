/* ══════════════════════════════════════════════════════════════════
   Resource replacements — how many heads were actually on the seats.

   RFP §5.28.3, SLA 007 ("Deployment of resources") is scored against the
   number of resources that were SUPPOSED to be deployed. The Note under
   it, and the way the PMU reads it, carve two holes in that number:

     1. A seat whose occupant left and whose replacement UIDAI initiated
        is OUTSIDE the calculation until the replacement joins. Scoring
        it as a missing resource would penalise the consultant for a
        vacancy the client caused.

     2. A seat that was refilled but stood empty in between is one head
        fewer FOR THOSE DAYS ONLY — not for the whole interval. Ten
        vacant days in a 30-day month is a third of one seat, not a
        whole one.

   Both are the same statement once you stop counting people and start
   counting seat-days:

       occupied seat-days ÷ days in the interval  =  effective headcount

   A seat empty all month contributes nothing and drops out (rule 1). A
   seat empty for ten days contributes 20/30 of a head (rule 2). No
   special cases, and the two rules stop being two rules.

   ── Why day-by-day rather than a formula ──────────────────────────
   The report gives per-designation `configuredQuantity` and a flat list
   of people with joining / last-working dates. It does NOT say which
   person sat in which seat when a designation has several. With two
   seats and three people there is no way to reconstruct the pairing —
   but there is never any need to: counting how many people were present
   on each day answers the question without ever assigning anyone to a
   seat.

   Occupancy is capped at the configured quantity per day. A handover
   where the leaver and the joiner overlap by a week is three people on
   two seats, and letting that read as 150% deployment would turn an
   orderly handover into a bonus.

   Pure functions. No React, no fetching.
   ══════════════════════════════════════════════════════════════════ */

const DAY_MS = 86400000;

const iso = (v) => (v ? String(v).slice(0, 10) : "");

const num = (v) => {
    if (v === null || v === undefined || v === "") return null;
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
};

function toUtc(isoDate) {
    const [y, m, d] = String(isoDate ?? "").split("-").map(Number);
    if (!y || !m || !d) return null;
    const dt = new Date(Date.UTC(y, m - 1, d));
    return Number.isNaN(dt.getTime()) ? null : dt;
}

function isoOf(dt) {
    return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, "0")}-${String(dt.getUTCDate()).padStart(2, "0")}`;
}

/* Inclusive of both endpoints — 01 Jun → 30 Jun is 30 days of obligation. */
export function inclusiveDays(startIso, endIso) {
    const a = toUtc(startIso);
    const b = toUtc(endIso);
    if (!a || !b) return 0;
    return Math.max(0, Math.round((b - a) / DAY_MS) + 1);
}

/* ─── the report, flattened ───────────────────────────────────────
   One row per designation with its people ordered by joining date, so a
   seat's history reads as a handover chain. Anyone with an unusable
   joining date sorts last rather than silently reading as "earliest",
   which is what comparing empty strings would do.                    */
export function normalizeReplacementReport(raw, { activityId, activityCode, activityName } = {}) {
    const designations = (Array.isArray(raw?.designations) ? raw.designations : []).map((d) => {
        const people = (Array.isArray(d?.resources) ? d.resources : [])
            .map((r) => ({
                resourceId: r?.resourceId ?? null,
                name: r?.employeeName || "",
                joined: iso(r?.joiningDate),
                left: iso(r?.lastWorkingDate),
                active: r?.active !== false,
            }))
            .sort((a, b) => {
                if (!a.joined && !b.joined) return 0;
                if (!a.joined) return 1;
                if (!b.joined) return -1;
                return a.joined < b.joined ? -1 : a.joined > b.joined ? 1 : 0;
            });

        return {
            designation: String(d?.designation || "").trim() || "—",
            /* Falling back to the number of distinct people would make a
               designation that changed hands look over-staffed: two people
               through one seat is a configured quantity of one. */
            configured: num(d?.configuredQuantity) ?? 0,
            distinctPeople: num(d?.distinctResourceCount) ?? people.length,
            replacementCount: num(d?.replacementCount) ?? 0,
            people,
        };
    });

    return {
        activityId: activityId ?? null,
        activityCode: activityCode || "",
        activityName: activityName || raw?.activityName || "",
        activityStart: iso(raw?.activityStartDate),
        activityEnd: iso(raw?.activityEndDate),
        totalReplacements: num(raw?.totalReplacements) ?? 0,
        designations,
    };
}

/* Was this person on the seat on this day?

   An absent last-working date means "still here" — the seat is occupied
   from the joining date onward. An absent JOINING date is the opposite:
   the person is on the roster but has no start, which is precisely the
   "replacement approved, not yet joined" case, and counting them as
   present would erase the vacancy this module exists to find. */
function presentOn(person, dayIso) {
    if (!person.joined) return false;
    if (dayIso < person.joined) return false;
    if (person.left && dayIso > person.left) return false;
    return true;
}

/* ─── one designation over one window ─────────────────────────────
   Walks the window a day at a time. A contract quarter is ~92 days and
   a project has tens of designations, so this is a few thousand
   comparisons — cheaper than the request that fetched the data.      */
export function occupancyForDesignation(designation, window) {
    const start = iso(window?.start);
    const end = iso(window?.end);
    const days = inclusiveDays(start, end);
    const configured = designation?.configured ?? 0;

    if (!days || configured <= 0) {
        return {
            designation: designation?.designation || "—",
            configured,
            days,
            seatDays: 0,
            occupiedDays: 0,
            vacantDays: 0,
            effectiveHeadcount: null,
            gaps: [],
            overlapDays: 0,
            fullyVacant: false,
            peopleInWindow: [],
        };
    }

    const people = designation.people || [];
    const seatDays = configured * days;
    let occupiedDays = 0;
    let overlapDays = 0;
    const gaps = [];
    let openGap = null;

    const cursor = toUtc(start);
    for (let i = 0; i < days; i += 1) {
        const dayIso = isoOf(cursor);
        let present = 0;
        for (const p of people) if (presentOn(p, dayIso)) present += 1;

        /* Capped at the plan: an overlapping handover is not extra
           deployment, and the surplus is reported separately so it is
           visible rather than quietly discarded. */
        if (present > configured) {
            overlapDays += present - configured;
            present = configured;
        }
        occupiedDays += present;

        const short = configured - present;
        if (short > 0) {
            if (openGap && openGap.short === short) openGap.end = dayIso;
            else {
                if (openGap) gaps.push(openGap);
                openGap = { start: dayIso, end: dayIso, short };
            }
        } else if (openGap) {
            gaps.push(openGap);
            openGap = null;
        }

        cursor.setUTCDate(cursor.getUTCDate() + 1);
    }
    if (openGap) gaps.push(openGap);

    const peopleInWindow = people.filter(
        (p) => p.joined && p.joined <= end && (!p.left || p.left >= start)
    );

    return {
        designation: designation.designation,
        configured,
        days,
        seatDays,
        occupiedDays,
        vacantDays: seatDays - occupiedDays,
        /* The N that SLA 007 should be scored against. Fractional on
           purpose — a seat empty for a third of the month IS a third of
           a head, and rounding it away is the whole bug. */
        effectiveHeadcount: occupiedDays / days,
        gaps: gaps.map((g) => ({ ...g, days: inclusiveDays(g.start, g.end) })),
        overlapDays,
        /* Nobody at all, all window — rule 1. Distinguished from a partial
           gap because the two are different findings: this seat is out of
           the calculation, that seat is discounted within it. */
        fullyVacant: occupiedDays === 0,
        peopleInWindow,
        replacementCount: designation.replacementCount,
    };
}

/* ─── every designation, every activity, one window ───────────────
   `reports` is a Map of activityId → normalized report. Returns the
   quarter-level figure plus the per-designation rows behind it.      */
export function occupancyForWindow(reports, window) {
    const rows = [];
    let configuredSeats = 0;
    let seatDays = 0;
    let occupiedDays = 0;
    let overlapDays = 0;
    let replacementCount = 0;
    const vacantSeats = [];
    const gapRows = [];

    for (const report of reports?.values?.() ?? []) {
        for (const d of report.designations) {
            const occ = occupancyForDesignation(d, window);
            if (!occ.days || occ.configured <= 0) continue;

            const row = {
                ...occ,
                activityId: report.activityId,
                activityCode: report.activityCode,
                activityName: report.activityName,
            };
            rows.push(row);

            configuredSeats += occ.configured;
            seatDays += occ.seatDays;
            occupiedDays += occ.occupiedDays;
            overlapDays += occ.overlapDays;
            replacementCount += occ.replacementCount || 0;

            if (occ.fullyVacant) vacantSeats.push(row);
            for (const g of occ.gaps) gapRows.push({ ...g, row });
        }
    }

    const days = inclusiveDays(window?.start, window?.end);
    rows.sort((a, b) => b.vacantDays - a.vacantDays || a.designation.localeCompare(b.designation));
    gapRows.sort((a, b) => b.days - a.days);

    return {
        window,
        days,
        rows,
        designationCount: rows.length,
        configuredSeats,
        seatDays,
        occupiedDays,
        vacantDays: seatDays - occupiedDays,
        overlapDays,
        replacementCount,
        /* The quarter's deployment as a fraction of what was planned. This
           is what "8 of 10 resources deployed" should actually mean once
           part-month vacancies are counted honestly. */
        deployedPercent: seatDays > 0 ? (occupiedDays / seatDays) * 100 : null,
        effectiveHeadcount: days > 0 ? occupiedDays / days : null,
        vacantSeats,
        gaps: gapRows,
        hasData: rows.length > 0,
    };
}

/* ─── measurement intervals ───────────────────────────────────────
   SLA 007 is measured monthly and reported quarterly (§5.28.1.a): the
   points of each month accumulate into the quarter. So the headcount
   has to be resolved per month too — a seat vacant through May and
   filled all of June is not "94% deployed for the quarter", it is one
   month at 67% and one at 100%, and they score separately.

   Clipped to the window at both ends, so a contract quarter starting
   mid-month yields a first interval of the days it actually covers. */
export function monthlyIntervals(window) {
    const start = iso(window?.start);
    const end = iso(window?.end);
    if (!start || !end || start > end) return [];

    const out = [];
    const cursor = toUtc(start);
    while (cursor && isoOf(cursor) <= end) {
        const y = cursor.getUTCFullYear();
        const m = cursor.getUTCMonth();
        const monthStart = isoOf(cursor);
        const lastOfMonth = isoOf(new Date(Date.UTC(y, m + 1, 0)));
        const intervalEnd = lastOfMonth > end ? end : lastOfMonth;
        out.push({
            key: `${y}-${String(m + 1).padStart(2, "0")}`,
            start: monthStart,
            end: intervalEnd,
            days: inclusiveDays(monthStart, intervalEnd),
            /* A quarter rarely starts on the 1st, so its first and last
               intervals are usually part months. Saying so stops a reader
               reading a low headcount as under-deployment when it is just
               a 22-day window. */
            partial: monthStart !== isoOf(new Date(Date.UTC(y, m, 1))) || intervalEnd !== lastOfMonth,
        });
        cursor.setUTCDate(1);
        cursor.setUTCMonth(cursor.getUTCMonth() + 1);
    }
    return out;
}

/* The same figure resolved per measurement interval — what SLA 007 is
   actually scored on, one row per month of the reporting quarter. */
export function occupancyByInterval(reports, window) {
    return monthlyIntervals(window).map((interval) => ({
        interval,
        ...occupancyForWindow(reports, interval),
    }));
}

/* ─── what this means for SLA 007 ─────────────────────────────────
   Turns the occupancy into the two statements a reviewer needs: how
   many heads the SLA should be scored against, and which seats are out
   of the calculation entirely because their replacement has not joined.

   Deliberately does NOT rescore anything. The backend is the number of
   record — Settlement invoices from it — and a rollup that silently
   "corrected" SLA 007 would just put two screens out of step. This is
   evidence for a human, exactly like the conformance re-check.        */
export function sla007Adjustment(occupancy) {
    if (!occupancy?.hasData) {
        return { applicable: false, reason: "no staffing reported for this quarter" };
    }
    const { configuredSeats, effectiveHeadcount, vacantSeats, gaps, days } = occupancy;
    const partialGaps = gaps.filter((g) => g.row && !g.row.fullyVacant);

    return {
        applicable: true,
        configuredSeats,
        effectiveHeadcount,
        /* Rounded only for display; every calculation above uses the
           fraction. Two decimals because 9.97 and 10 are a different
           finding and 10.0 would hide it. */
        effectiveHeadcountLabel: effectiveHeadcount === null
            ? "—"
            : (Math.round(effectiveHeadcount * 100) / 100).toLocaleString("en-IN"),
        excludedSeats: vacantSeats.length,
        excludedDetail: vacantSeats.map((s) => ({
            designation: s.designation,
            activityCode: s.activityCode,
            seats: s.configured,
        })),
        discountedGapCount: partialGaps.length,
        discountedDays: partialGaps.reduce((n, g) => n + g.days * g.short, 0),
        days,
        diverges: Math.abs((effectiveHeadcount ?? 0) - configuredSeats) > 0.005,
    };
}
