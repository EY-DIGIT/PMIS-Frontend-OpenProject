// ---------------------------------------------------------------------------
// SLA Compliance / PQP / Settlement API layer (contracts service).
//
// Kept deliberately free of React so the whole feature can be lifted onto a
// dedicated page later: import these functions from anywhere, pass ids in,
// get plain data back. Every call throws an Error with the backend's message
// on failure, so callers only need one try/catch.
//
// Base URL: override with VITE_CONTRACTS_BASE_URL when the service moves.
// ---------------------------------------------------------------------------
import { authorizedFetch } from "./client";

export const CONTRACTS_BASE =
    (import.meta.env?.VITE_CONTRACTS_BASE_URL || "http://10.1.131.199/contracts").replace(/\/+$/, "");

// The contracts service wraps everything in { data, message, error, status }.
async function readEnvelope(res) {
    const payload = await res.json().catch(() => null);
    if (!res.ok) {
        throw new Error(
            payload?.error?.message ||
            payload?.error ||
            payload?.message ||
            payload?.detail?.[0]?.msg ||
            (typeof payload?.detail === "string" ? payload.detail : "") ||
            `Request failed (${res.status})`
        );
    }
    return payload?.data ?? payload;
}

function call(path, { method = "GET", body } = {}) {
    return authorizedFetch(`${CONTRACTS_BASE}${path}`, {
        method,
        headers: body
            ? { "Content-Type": "application/json", Accept: "application/json" }
            : { Accept: "application/json" },
        // The on-complete endpoint is a POST with no payload — send nothing
        // rather than "null", which FastAPI rejects.
        ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    }).then(readEnvelope);
}

const enc = encodeURIComponent;

/* ── NPQP → PQP, renamed at the boundary ──────────────────────────────
   The contract dropped the NPQP term. The BACKEND has not caught up —
   the route is still `/api/v3/npqp/...` and every payload still carries
   an `npqp` field.

   This is a RENAME ONLY — the value passed through is unchanged. What
   changed is what the backend puts in it: the deployed service now
   returns F alone, QGR excluded (corrigendum items 47/49). A row still
   carrying F + QGR was written by the old service; `buildSettlementChain`
   flags that as `staleNpqpBase` rather than silently recomputing it,
   because the invoice followed the row.

   Rather than leave the old name loose in the app, it is translated here
   and nowhere else. Everything downstream speaks only `pqp`, so when the
   backend does rename, this one function changes and nothing else does.

   Shallow by design: `npqp` only ever appears at the top level of a
   payload or of a settlement row, and a deep walk would also rewrite the
   `perMonth` entries, which have no such field. */
function toPqp(v) {
    if (Array.isArray(v)) return v.map(toPqp);
    if (v && typeof v === "object" && !Array.isArray(v) && "npqp" in v) {
        const { npqp, ...rest } = v;
        return { ...rest, pqp: npqp };
    }
    return v;
}

/* The FIRST image attachment on an SLA master, or null.

   `attachments[]` carries { file_url, mime_type, original_filename,
   caption } and is served as public static content — the files answer
   200 without an Authorization header, so an <img src> works directly
   and no blob fetch is needed.

   Filtered on `mime_type` starting "image/" rather than taken blindly:
   the field is a general attachment list, and a PDF rendered into an
   <img> would show as a broken icon next to every SLA that has one.
   Only the first is taken — no record currently carries more than one,
   and a row header has space for exactly one thumbnail. */
function pickSlaImage(s) {
    const list = Array.isArray(s?.attachments) ? s.attachments : [];
    const hit = list.find((a) => String(a?.mime_type || "").toLowerCase().startsWith("image/"));
    if (!hit?.file_url) return null;
    return {
        url: hit.file_url,
        name: hit.original_filename || "",
        caption: hit.caption || "",
    };
}

/* ───────────────────────── Quarter helpers ─────────────────────────
   Contract quarters are RESOURCE-PHASE-ANCHORED: they run from the
   earliest resource-based milestone's start date — the point the vendor
   actually starts being measured — not from the project's own start and
   not from a calendar year. (They were anchored on project start until
   2026-08-17; see `contractQuarters` in utils/project/slaRollup.js.)

   The responses carry their own `quarterStart` / `quarterEnd` /
   `quarterKey`, so a caller holding a row should read the window off the
   row rather than re-deriving it. Every settlement / PQP /
   quarterly-aggregate response reports one as

       fiscalYear = the 1-based CONTRACT year (1, 2, 3 …) — NOT a calendar year
       quarter    = 1..4 within that contract year
       label      = "Y1-Q2"   (a resource phase starting 2025-11-10 has
                               Y1-Q2 = 2026-02-10 .. 2026-05-09)

   and the ?quarter= param on those endpoints takes the same "Y1-Q2" — or
   any ISO date inside the quarter, which still resolves to the containing
   one and is the safer thing to send when T0 is not to hand.

   An UNDATED project has nothing to anchor to, so the backend keeps
   falling back to calendar quarters ("2026-Q2", fiscalYear = 2026). Both
   shapes therefore reach the frontend, and everything below handles
   either: a 4-digit year reads as calendar, anything smaller as a
   contract year.                                                        */

const CONTRACT_KEY = /^Y(\d{1,3})-Q([1-4])$/i;
const CALENDAR_KEY = /^(\d{4})-Q([1-4])$/;

/* A fiscalYear of 1..999 is a contract year; a 4-digit one is a calendar
   year. Nothing else can tell the two apart — the field carries both. */
export function isContractYear(fiscalYear) {
    const n = Number(fiscalYear);
    return Number.isFinite(n) && n > 0 && n < 1000;
}

/* fiscalYear + quarter → the key the backend uses, in whichever regime
   the row belongs to. Feed it a settlement / PQP / aggregate row and it
   labels itself correctly without the caller having to know which. */
export function formatQuarterKey(fiscalYear, quarter) {
    const y = Number(fiscalYear);
    const q = Number(quarter);
    if (!Number.isFinite(y) || !Number.isFinite(q)) return "";
    return isContractYear(y) ? `Y${y}-Q${q}` : `${y}-Q${q}`;
}

/* A row's quarter key. The backend's own label wins when it sent one —
   it knows which regime the project is in — and fiscalYear + quarter is
   the fallback for responses that predate the label. */
export function quarterKeyOfRow(row) {
    const given = row?.quarterLabel ?? row?.label ?? row?.quarterKey;
    const s = String(given || "").trim();
    if (CONTRACT_KEY.test(s) || CALENDAR_KEY.test(s)) return s;
    return formatQuarterKey(row?.fiscalYear, row?.quarter);
}

/* CALENDAR key for a date — the fallback for a project with nothing to
   anchor to, and only that. A project whose resource phase has a start
   date has contract quarters, and a caller that reaches for this instead
   will build a selector whose keys can never match an anchored row. Use
   `contractQuarters()` first and fall back here only when it is empty. */
export function quarterKeyOf(date = new Date()) {
    const d = typeof date === "string" ? new Date(`${date}T00:00:00`) : date;
    if (Number.isNaN(d.getTime())) return "";
    return `${d.getFullYear()}-Q${Math.floor(d.getMonth() / 3) + 1}`;
}

/* Parse either shape.

   A CONTRACT key carries no dates of its own — its window depends on the
   resource-phase anchor, which lives on the project's milestones and not
   in the key — so `start` / `end` come back null and the caller pairs it
   with contractQuarters() from utils/project/slaRollup, or reads
   `quarterStart` / `quarterEnd` straight off the backend row when it has
   one. `kind` says which was parsed, so nobody has to sniff the year. */
export function parseQuarterKey(key) {
    const raw = String(key || "").trim();

    const c = CONTRACT_KEY.exec(raw);
    if (c) {
        return { kind: "contract", year: Number(c[1]), quarter: Number(c[2]), start: null, end: null };
    }

    const m = CALENDAR_KEY.exec(raw);
    if (!m) return null;
    const year = Number(m[1]);
    const quarter = Number(m[2]);
    const startMonth = (quarter - 1) * 3;
    const start = new Date(year, startMonth, 1);
    const end = new Date(year, startMonth + 3, 0); // day 0 of next block = last day
    const iso = (d) =>
        `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    return { kind: "calendar", year, quarter, start: iso(start), end: iso(end) };
}

/* Does a settlement / aggregate row describe this quarter key?

   Compared numerically because the services disagree on whether
   fiscalYear comes back as a number or a string — a strict === against a
   parsed number silently reports an already-closed quarter as open and
   offers to re-close it. */
export function rowMatchesQuarter(row, key) {
    const p = parseQuarterKey(key);
    if (!p || !row) return false;
    return Number(row.fiscalYear) === p.year && Number(row.quarter) === p.quarter;
}

// The last N CALENDAR quarters ending at the current one, newest first.
// Same caveat as quarterKeyOf: last resort for an un-anchorable project,
// never a substitute for contractQuarters() on one that has an anchor.
export function recentQuarterKeys(count = 8, from = new Date()) {
    const d = typeof from === "string" ? new Date(`${from}T00:00:00`) : from;
    let year = d.getFullYear();
    let q = Math.floor(d.getMonth() / 3) + 1;
    const out = [];
    for (let i = 0; i < count; i += 1) {
        out.push(`${year}-Q${q}`);
        q -= 1;
        if (q === 0) { q = 4; year -= 1; }
    }
    return out;
}

/* ───────────────────── Activity-scoped (Pre-plan) ───────────────────── */

// POST …/activities/{id}/on-complete — trigger evaluation when an activity
// completes. Date-derivable SLAs are auto-evaluated; the rest come back under
// manualNeeded (their owners get emailed by the backend).
export function triggerActivityOnComplete(activityId) {
    return call(`/api/v3/sla-compliance/activities/${enc(activityId)}/on-complete`, { method: "POST" });
}

// GET …/activities/{id} — every SLA evaluation result for one activity, plus
// the met/breached/pending rollup and a `data_state` readiness flag.
export function getActivityCompliance(activityId) {
    return call(`/api/v3/sla-compliance/activities/${enc(activityId)}`);
}

/* ───────────────────── Project-scoped (Phase B / C / D / E) ───────────────────── */

// Phase B — per-SLA quarterly rollup (points → LD % per SLA). Refreshes the
// rollup server-side before responding. totalLdPercentUncapped is pre-cap.
// `quarter` is a contract key ("Y1-Q2") or any ISO date inside the quarter.
export function getQuarterlyAggregate(projectId, quarter) {
    const qs = quarter ? `?quarter=${enc(quarter)}` : "";
    return call(`/api/v3/sla-compliance/projects/${enc(projectId)}/quarterly-aggregate${qs}`).then(toPqp);
}

// Phase C — PQP, the base the LD % is charged on.
// NOTE: the route and the payload field are still called `npqp` server-side;
// `toPqp` renames the field so nothing downstream carries the old term.
// Returns status='leave_mgmt_unavailable' with HTTP 200 when leave-mgmt is
// down, so callers must check `status`, not just the absence of an error.
export function getPqp(projectId, quarter) {
    const qs = quarter ? `?quarter=${enc(quarter)}` : "";
    return call(`/api/v3/npqp/projects/${enc(projectId)}${qs}`).then(toPqp);
}

// Phase D — settlement history, newest quarter first.
export function listSettlements(projectId) {
    return call(`/api/v3/sla-compliance/projects/${enc(projectId)}/settlement`).then(toPqp);
}

// Phase D — one quarter. Lazily auto-closes (rollup + PQP + cap + AQP) and
// persists status='auto_closed' when no row exists yet.
export function getSettlement(projectId, quarter) {
    return call(`/api/v3/sla-compliance/projects/${enc(projectId)}/settlement/${enc(quarter)}`).then(toPqp);
}

/* Phase D — finance override of sumLdPercent. Re-capped at the quarter cap
   before persistence. 404 when not auto-closed yet, 422 once invoiced or
   finalized.

   `overrideReason` is REQUIRED SERVER-SIDE as of contract/eyremote — a
   blank or whitespace-only reason is refused with 422
   (`override_reason_required`, or a plain schema 422). The caller keeps
   its own required-field check so the user gets an inline error instead
   of a round trip, but the rule is the server's and this does not try to
   soften it. */
export function overrideSettlement(projectId, quarter, { sumLdPercent, overrideReason }) {
    return call(`/api/v3/sla-compliance/projects/${enc(projectId)}/settlement/${enc(quarter)}/override`, {
        method: "POST",
        body: { sumLdPercent: Number(sumLdPercent), overrideReason },
    }).then(toPqp);
}

/* Lock the quarter WITHOUT invoicing it — the pre-billing lock.

   Two distinct locks, and they are not interchangeable. Finalize is the
   SLA owner signing off the penalty: the figure stops moving, but no
   money has been raised. Mark-invoiced is the billing lock and comes
   later. A finalized quarter can still go on to be invoiced.

   ── NO BODY ────────────────────────────────────────────────────────
   POST .../settlement/{quarter}/finalize   → the locked row
       (`status: "finalized"`, `finalized: true`)

   No reason is sent. An earlier draft of this took `{ reason }` on the
   assumption that a lock needs an audit note; the shipped endpoint does
   not accept one, and posting a body it ignores would leave the UI
   collecting a reason that goes nowhere — worse than not asking, because
   the user believes it was recorded. The override reason remains the
   place a decision is explained; this only records that it is closed.

   Errors: 422 `settlement_immutable` (already invoiced), 422
   `settlement_not_computed` (a blocked_* row — nothing to finalize),
   404 (no row for this quarter).                                      */
export function finalizeSettlement(projectId, quarter) {
    return call(`/api/v3/sla-compliance/projects/${enc(projectId)}/settlement/${enc(quarter)}/finalize`, {
        method: "POST",
    }).then(toPqp);
}

/* Throw a manual override away and go back to the computed figure.

   The ONLY route back to the live computation. A row carrying an
   override is not recomputed by a refresh — that is the point of an
   override — so without this the only way to undo a wrong figure was to
   override it again with a guess at what the computation would have said.

   POST .../settlement/{quarter}/clear-override   → the recomputed row
       (`status: "auto_closed"`, `manuallyOverridden: false`)

   Errors: 422 `settlement_locked` once invoiced or finalized. Which is
   why the button offering this has to disappear at the same moment the
   lock lands, rather than staying and failing.                        */
export function clearSettlementOverride(projectId, quarter) {
    return call(`/api/v3/sla-compliance/projects/${enc(projectId)}/settlement/${enc(quarter)}/clear-override`, {
        method: "POST",
    }).then(toPqp);
}

/* Is this row locked against further change?

   Reads the shipped `finalized` flag first, then falls back to the
   status string and the older timestamp shapes — a row fetched from a
   cache, or an endpoint not yet redeployed, can still arrive without the
   boolean, and treating that as unlocked would offer an override the
   server refuses.

   An INVOICED row counts too: invoicing is the stronger lock and implies
   finality. Erring toward "locked" is the safe direction — reading a
   locked row as open offers an action the server will reject, while
   reading an open row as locked only hides a button. */
export function isSettlementFinal(row) {
    if (!row) return false;
    if (row.finalized === true) return true;
    const status = String(row.status || "").toLowerCase();
    if (status === "final" || status === "finalized" || status === "finalised") return true;
    if (status === "invoiced") return true;
    return !!(row.finalizedAt || row.finalisedAt || row.isFinal);
}

/* Has the LD on this row been set by hand rather than computed?

   Survives a finalize — a locked row that was overridden is still an
   overridden row, and the badge has to keep saying so after the lock
   lands. False for invoiced and auto-closed rows.

   `overrideReason` alone is NOT taken as proof: a cleared override may
   leave the old reason on the row, and reading that as "still
   overridden" would offer a Clear-override button for an override that
   is already gone. The flag is the answer; the reason is only what the
   badge says when it is true. */
export function isSettlementOverridden(row) {
    if (!row) return false;
    if (row.manuallyOverridden === true) return true;
    // Pre-flag rows: the old status was the only signal there was.
    return String(row.status || "").toLowerCase() === "manual_override";
}

// Phase E — lock the row after the invoice is raised. Idempotent.
export function markSettlementInvoiced(projectId, quarter, invoiceRef) {
    return call(`/api/v3/sla-compliance/projects/${enc(projectId)}/settlement/${enc(quarter)}/mark-invoiced`, {
        method: "POST",
        body: { invoiceRef },
    }).then(toPqp);
}

/* ───────────────────── Scoring configuration ─────────────────────
   The severity master (level → points) and the LD band table (points
   threshold → LD %) are what any client-side rollup has to score
   against. They are edited on the Severity & LD page, which talks to
   these paths inline; exposing them here lets the rollup read the same
   configuration without importing a page component.

   Both 404 on a project that has not been configured yet — that is a
   normal empty state, not a failure, so both resolve to [] instead of
   throwing and leave the caller to say "configure this first".        */

function normalizeSeverityLevels(payload) {
    const raw = payload?.data ?? payload ?? {};
    const list = raw.levels ?? raw._embedded?.elements ?? raw.elements ?? raw;
    if (!Array.isArray(list)) return [];
    return list.map((it, idx) => ({
        level: Number(it.level ?? it.severity_level ?? it.sl ?? it.severityLevel ?? 0),
        points: Number(it.points ?? it.point ?? it.value ?? 0),
        label: String(it.label ?? it.name ?? `Level ${it.level ?? idx}`),
    }));
}

function normalizeLdBands(payload) {
    const raw = payload?.data ?? payload ?? {};
    const list = raw._embedded?.elements ?? raw.bands ?? raw.elements ?? raw;
    if (!Array.isArray(list)) return [];
    return list.map((it, idx) => ({
        id: it.id ?? it.band_id ?? it.bandId ?? null,
        points_threshold: Number(it.points_threshold ?? it.pointsThreshold ?? it.points ?? 0),
        ld_percent: Number(it.ld_percent ?? it.ldPercent ?? it.ld ?? 0),
        label: String(it.label ?? it.name ?? `Band ${idx}`),
    }));
}

// These two live under /contracts/api/v3 (project-scoped masters), not
// under the sla-compliance tree, so they use authorizedFetch directly
// rather than call() with CONTRACTS_BASE.
async function readMaster(path, normalize) {
    const res = await authorizedFetch(path, { method: "GET", headers: { Accept: "application/json" } });
    if (res.status === 404) return [];
    const text = await res.text().catch(() => "");
    if (!res.ok) throw new Error(`Request failed (${res.status})`);
    if (!text) return [];
    try {
        return normalize(JSON.parse(text));
    } catch {
        return [];
    }
}

export function getSeverityMaster(projectId) {
    return readMaster(
        `/contracts/api/v3/projects/${enc(projectId)}/severity-master`,
        normalizeSeverityLevels
    );
}

export function getLdBands(projectId) {
    return readMaster(
        `/contracts/api/v3/projects/${enc(projectId)}/ld-bands`,
        normalizeLdBands
    );
}

/* ───────────────────── SLA master library ─────────────────────────
   The library carries the two fields that decide how an SLA is scored:
   `category_code` (DELIVERABLE_SUBMISSION, RESOURCE_MANAGEMENT, …) and
   `applied_on` / `ld_computation_base` (FIXED_AMOUNT vs
   QUARTERLY_PAYMENT). Evaluation results normally carry the same facts
   as `formulaType` / `ldBaseKind`, so this list is used for titles and
   as a fallback when a result arrives without them — never as the sole
   source, since a project can hold SLAs it has never evaluated.

   It ALSO carries the four fields the rollup needs to check the RFP's
   own scoring rules rather than take the backend's word for them:

     · measurement_interval / reporting_interval (§5.28.1.a). When
       measurement is finer than reporting, points must not simply be
       summed — SLA 007 reports "quarterly, based on AVERAGE monthly
       availability", so three monthly scores collapse to one severity.
     · target_rows — the SLA's own severity table
       ({severity, input_variable, from_value excl, to_value incl}),
       which is what an averaged or counted value has to be read against.
     · linear_escalation — {rate_per_unit_percent, unit, grace_units},
       which is how "0.5% per week or part thereof" is actually stored.

   All four are optional: an SLA library that predates them simply
   yields no cross-check, which the rollup reports as "not verifiable"
   rather than as agreement.                                            */

/* The onboarding widget writes `target_rows`, but older records saved
   the same array as `bands` / `condition_bands` — the masters detail
   page already reads all three, so this mirrors it. */
function pickTargetRows(s) {
    const raw = s.target_rows ?? s.targetRows ?? s.bands ?? s.condition_bands ?? s.conditionBands;
    if (!Array.isArray(raw)) return [];
    return raw
        .map((r) => ({
            severity: Number(r.severity ?? r.severity_level ?? r.severityLevel),
            inputVariable: r.input_variable ?? r.inputVariable ?? null,
            thresholdLabel: r.threshold_label ?? r.thresholdLabel ?? "",
            // from is EXCLUSIVE, to is INCLUSIVE — the widget labels them
            // that way and the RFP bands read the same ("> 21 days & <= 28").
            // null means unbounded on that side.
            fromValue: numOrNull(r.from_value ?? r.fromValue),
            toValue: numOrNull(r.to_value ?? r.toValue),
        }))
        .filter((r) => Number.isFinite(r.severity));
}

function pickLinearEscalation(s) {
    const raw = s.linear_escalation ?? s.linearEscalation;
    if (!raw || typeof raw !== "object") return null;
    const rate = numOrNull(raw.rate_per_unit_percent ?? raw.ratePerUnitPercent);
    if (rate === null) return null;
    return {
        ratePerUnitPercent: rate,
        unit: String(raw.unit ?? "week").toLowerCase(),
        graceUnits: numOrNull(raw.grace_units ?? raw.graceUnits) ?? 0,
    };
}

function numOrNull(v) {
    if (v === null || v === undefined || v === "") return null;
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
}

/* GET /api/v3/sla-masters/{id} — the RFP-shape record.

   The LIST endpoint returns summaries. `target_rows`, `linear_escalation`
   and the cadence fields only come back on the single-record fetch —
   SlaMastersPage reads them exactly this way, and only in detail mode.
   Without them the whole conformance re-check degrades to "could not be
   checked" on every SLA, which looks like agreement and is not.

   Shaped identically to a `listSlaMasters` row so the two are
   interchangeable and a failed detail call can fall back to the list. */
export function getSlaMaster(slaId) {
    return call(`/api/v3/sla-masters/${enc(slaId)}`).then((s) => ({
        slaId: s.id ?? s.sla_id ?? slaId,
        slaRef: s.sla_ref ?? s.slaRef ?? "",
        title: s.title ?? s.name ?? "",
        categoryCode: s.category ?? s.category_code ?? null,
        appliedOn: s.applied_on ?? s.ld_computation_base ?? null,
        formulaType: s.formula_type ?? s.formulaType ?? null,
        measurementInterval: s.measurement_interval ?? s.measurementInterval ?? null,
        reportingInterval: s.reporting_interval ?? s.reportingInterval ?? null,
        targetRows: pickTargetRows(s),
        linearEscalation: pickLinearEscalation(s),
        calculationMethod: s.calculation ?? s.calculation_method ?? "",
        assumptions: s.assumptions ?? "",
        image: pickSlaImage(s),
    }));
}

/* Fill in the scoring detail the list omits, a few at a time.

   Only SLAs the caller actually needs are fetched, and a failure keeps
   the list row rather than dropping the SLA — a missing target table
   costs a cross-check, not the SLA's own figures. */
export async function hydrateSlaMasters(masters, { concurrency = 5 } = {}) {
    const list = Array.isArray(masters) ? masters : [];
    const out = list.slice();
    let cursor = 0;

    async function worker() {
        for (;;) {
            const i = cursor;
            cursor += 1;
            if (i >= out.length) return;
            const m = out[i];
            // Already complete — nothing the detail call would add.
            if (!m?.slaId || (m.targetRows?.length && m.measurementInterval)) continue;
            try {
                const full = await getSlaMaster(m.slaId);
                // List values win where the detail is blank, never the reverse.
                out[i] = {
                    ...m,
                    ...Object.fromEntries(
                        Object.entries(full).filter(([, v]) =>
                            v !== null && v !== "" && !(Array.isArray(v) && v.length === 0))
                    ),
                };
            } catch {
                /* keep the list row */
            }
        }
    }

    await Promise.all(Array.from({ length: Math.min(concurrency, out.length || 1) }, worker));
    return out;
}

export function listSlaMasters(projectId, { pageSize = 200 } = {}) {
    const qs = new URLSearchParams({ offset: "1", pageSize: String(pageSize) });
    if (projectId) qs.set("project_id", projectId);
    // Deliberately NOT caught here. A library that fails to load degrades
    // classification silently, which is indistinguishable from a project
    // that genuinely has no deliverable SLAs — the caller has to be able
    // to tell those apart, so the rejection is left to propagate.
    return call(`/api/v3/sla-masters?${qs.toString()}`).then((payload) => {
        const list =
            payload?._embedded?.elements ?? payload?.elements ??
            (Array.isArray(payload) ? payload : payload?.items) ?? [];
        return (Array.isArray(list) ? list : []).map((s) => ({
            slaId: s.id ?? s.sla_id ?? null,
            slaRef: s.sla_ref ?? s.slaRef ?? "",
            title: s.title ?? s.name ?? "",
            categoryCode: s.category_code ?? s.category ?? null,
            appliedOn: s.applied_on ?? s.ld_computation_base ?? null,
            formulaType: s.formula_type ?? s.formulaType ?? null,
            // Cadence and scoring tables — see the block comment above.
            measurementInterval: s.measurement_interval ?? s.measurementInterval ?? null,
            reportingInterval: s.reporting_interval ?? s.reportingInterval ?? null,
            targetRows: pickTargetRows(s),
            linearEscalation: pickLinearEscalation(s),
            // "based on average monthly availability…" lives in the reporting
            // interval's free text on some records; the recheck reads it to
            // confirm averaging is what the SLA actually asks for.
            calculationMethod: s.calculation_method ?? s.calculationMethod ?? "",
            assumptions: s.assumptions ?? "",
            image: pickSlaImage(s),
        }));
    });
}
