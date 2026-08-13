/* ══════════════════════════════════════════════════════════════════
   aiSlaNormalize.js — turn one SLA record from the n8n parser into the
   shape the AI review form can hydrate from.

   Part of the AI onboarding flow ONLY. The manual flow on
   /sla-masters/onboard does not import this and is unaffected by it.

   The parser is an LLM reading a PDF, so its output is close to — but
   not the same as — what the form's widgets accept. Two failure modes
   matter, and both used to be silent:

     • Type mismatches. `rate_per_unit_percent: "1%"` assigned to a
       <input type="number"> yields an EMPTY field, so the penalty rate
       vanished without anyone noticing.
     • Vocabulary mismatches. `ld_computation_base: "DELIVERABLE_COST"`
       isn't one of the form's options, so the select would silently
       carry a value the backend never uses.

   Every fix made here is reported back as a warning so the reviewer's
   eye lands on the field. Nothing is dropped quietly.

   normalizeAiSla(raw, { projectId }) → { record, warnings }
       record   — feed straight to the review form
       warnings — [{ field, label, message }]
   ══════════════════════════════════════════════════════════════════ */

// Mirrors the form's own option lists (see the RFP field catalog).
const MEASUREMENT_INTERVALS = ["DAILY", "WEEKLY", "MONTHLY", "QUARTERLY", "ONE_TIME"];
const REPORTING_INTERVALS = ["WEEKLY", "MONTHLY", "QUARTERLY", "ANNUAL"];
const LD_BASES = ["QUARTERLY_PAYMENT", "ANNUAL_PAYMENT", "FIXED_AMOUNT"];
const LINEAR_UNITS = ["week", "day", "month"];

// Enforced by the contracts service on measurement.metric_key.
const MAX_METRIC_KEY_LEN = 100;

/* Shorten an over-long metric key at a word boundary. Exported so the review
   form can apply the same clamp at submit time — a key typed or edited in the
   form never passes through normalizeAiSla. */
export function clampMetricKey(key) {
    const k = str(key);
    if (!k || k.length <= MAX_METRIC_KEY_LEN) return k;
    const cut = k.slice(0, MAX_METRIC_KEY_LEN);
    const lastSep = cut.lastIndexOf("_");
    return (lastSep > MAX_METRIC_KEY_LEN / 2 ? cut.slice(0, lastSep) : cut).replace(/_+$/, "");
}

// The parser emits contract vocabulary the form doesn't carry a slot for.
// These are equivalences, not guesses — FIXED_AMOUNT is labelled
// "Deliverable Cost (set per mapping)" in the form itself.
const LD_BASE_ALIASES = {
    DELIVERABLE_COST: "FIXED_AMOUNT",
    DELIVERABLE: "FIXED_AMOUNT",
    NPQP: "QUARTERLY_PAYMENT",
    NET_PLANNED_QUARTERLY_PAYMENT: "QUARTERLY_PAYMENT",
    ANNUAL_CONTRACT_VALUE: "ANNUAL_PAYMENT",
    ACV: "ANNUAL_PAYMENT",
};

// How the form labels each LD base, so warnings can name the option the
// reviewer actually sees rather than the code behind it.
const LD_BASE_LABELS = {
    QUARTERLY_PAYMENT: "Net Planned Quarterly Payment (NPQP)",
    ANNUAL_PAYMENT: "Annual Contract Value",
    FIXED_AMOUNT: "Deliverable Cost (set per mapping)",
};

// "DELIVERABLE_COST" → "deliverable cost". Raw enum values in a message are
// noise to anyone reading the screen.
const humanize = (v) => String(v == null ? "" : v).replace(/_+/g, " ").trim().toLowerCase();

const str = (v) => (v === null || v === undefined ? "" : String(v).trim());
const orNull = (v) => (str(v) === "" ? null : str(v));
const asDate = (v) => (str(v) ? str(v).slice(0, 10) : null);

/* The parser's LD templating double-escapes its percent sign, so
   "LD = 1% per week" arrives as "LD = 1%% per week". Cosmetic, but it
   would be stored verbatim on the record. */
const fixPercent = (v) => (str(v) ? str(v).replace(/%{2,}/g, "%") : null);

/* Pull a number out of whatever the parser put in a numeric field:
   "0.5" → 0.5, "1%" → 1, "  2.5 % " → 2.5. Returns null when there is
   no number in there at all. */
function toNumber(raw) {
    if (raw === null || raw === undefined || raw === "") return null;
    if (typeof raw === "number") return Number.isFinite(raw) ? raw : null;
    const m = String(raw).match(/-?\d+(\.\d+)?/);
    if (!m) return null;
    const n = Number(m[0]);
    return Number.isFinite(n) ? n : null;
}

/* The parser frequently fills `linear_escalation.unit` with the LD base
   ("%", "of total cost of that particular deliverable") instead of the
   time unit the escalation is measured in. The real unit is almost
   always stated in the description — "for every week or part thereof",
   "for every day of delay" — so read it from there. */
function inferLinearUnit(rawUnit, ...contextStrings) {
    const direct = str(rawUnit).toLowerCase();
    const hit = LINEAR_UNITS.find((u) => direct === u || direct === u + "s");
    if (hit) return { unit: hit, inferred: false };

    const ctx = contextStrings.map(str).join(" ").toLowerCase();
    // Ordered by specificity — "per week or part thereof" beats a stray "day".
    for (const u of ["week", "day", "month"]) {
        if (new RegExp(`(per|every|each)\\s+(\\w+\\s+){0,2}${u}`, "i").test(ctx)) {
            return { unit: u, inferred: true };
        }
    }
    for (const u of LINEAR_UNITS) {
        if (new RegExp(`\\b${u}s?\\b`, "i").test(ctx)) return { unit: u, inferred: true };
    }
    return { unit: "", inferred: false };
}

function normalizeEnum(raw, allowed, aliases) {
    const v = str(raw).toUpperCase().replace(/[\s-]+/g, "_");
    if (!v) return { value: null, changed: false, unknown: false };
    if (allowed.includes(v)) return { value: v, changed: false, unknown: false };
    const alias = aliases && aliases[v];
    if (alias) return { value: alias, changed: true, unknown: false };
    return { value: v, changed: false, unknown: true };
}

export function normalizeAiSla(raw, { projectId } = {}) {
    const warnings = [];
    const warn = (field, label, message) => warnings.push({ field, label, message });
    const r = raw || {};

    /* ── identification ──
       The ref keeps its timestamp suffix exactly as the parser emits it.
       project_id is forced to the project the user picked on the intake
       screen — the parser echoes one back, but the user's choice wins. */
    const record = {
        sla_ref: orNull(r.sla_ref),
        title: orNull(r.title),
        project_id: projectId || orNull(r.project_id),
        category_code: orNull(r.category_code),
        description: orNull(r.description),
        scope_text: orNull(r.scope_text ?? r.scope),
        data_source: orNull(r.data_source),
        calculation_method: fixPercent(r.calculation_method),
        reports_submitted_to: orNull(r.reports_submitted_to),
        effective_from: asDate(r.effective_from),
        effective_until: asDate(r.effective_until),
    };

    if (!record.title) warn("title", "Title", "The parser didn't find a title.");
    if (!record.description) warn("description", "Definition of SLA", "The parser didn't find a definition — this field is required.");
    if (!record.calculation_method) warn("calculation_method", "SLA Calculation", "The parser didn't find a calculation method — this field is required.");
    if (!record.effective_from) warn("effective_from", "Active From", "No start date came back — required before this SLA can be created.");

    /* ── cadence + LD base ── */
    const mi = normalizeEnum(r.measurement_interval, MEASUREMENT_INTERVALS);
    record.measurement_interval = mi.value;
    if (mi.unknown) warn("measurement_interval", "Measurement Interval", `The document said "${humanize(r.measurement_interval)}", which isn't one of the intervals this field offers — pick the right one.`);

    const ri = normalizeEnum(r.reporting_interval, REPORTING_INTERVALS);
    record.reporting_interval = ri.value;
    if (ri.unknown) warn("reporting_interval", "Reporting Interval", `The document said "${humanize(r.reporting_interval)}", which isn't one of the intervals this field offers — pick the right one.`);

    const rawLd = r.ld_computation_base ?? r.applied_on;
    const ld = normalizeEnum(rawLd, LD_BASES, LD_BASE_ALIASES);
    record.ld_computation_base = ld.value;
    if (ld.changed) {
        warn("ld_computation_base", "Applied On",
            `The document said "${humanize(rawLd)}", which isn't one of this field's options. It was set to "${LD_BASE_LABELS[ld.value] || ld.value}", which means the same thing — check that's right.`);
    }
    if (ld.unknown) {
        warn("ld_computation_base", "Applied On",
            `The document said "${humanize(rawLd)}", which isn't something this field accepts — pick the right option.`);
    }

    /* ── measurement ──
       The parser derives metric_key by slugifying the whole title, which for a
       long SLA name blows past the contracts service's 100-char ceiling and
       gets the record rejected outright ("String should have at most 100
       characters"). Trim at a word boundary rather than mid-word, and say so —
       the reviewer can pick a catalog variable or define a shorter key. */
    if (r.measurement && (r.measurement.display_name || r.measurement.metric_key)) {
        let metricKey = orNull(r.measurement.metric_key);
        if (metricKey && metricKey.length > MAX_METRIC_KEY_LEN) {
            const originalLen = metricKey.length;
            metricKey = clampMetricKey(metricKey);
            warn("measurement", "Measurement variable",
                `The metric key was ${originalLen} characters (the limit is ${MAX_METRIC_KEY_LEN}) — shortened to "${metricKey}". Pick a catalog variable instead if you'd rather.`);
        }
        record.measurement = {
            display_name: orNull(r.measurement.display_name) || orNull(r.title),
            unit: orNull(r.measurement.unit) || "",
            metric_key: metricKey,
            target_value: orNull(r.measurement.target_value),
        };
    }

    /* ── target: severity bands ──
       The parser returns { condition, severity }; the form's table is
       { severity, threshold_label, from_value, to_value }. The wording
       carries over directly, but the numeric bounds are not extracted —
       flag that rather than pretend the bands are complete. */
    if (Array.isArray(r.target_rows) && r.target_rows.length) {
        record.target_rows = r.target_rows.map((row) => ({
            severity: toNumber(row.severity) ?? 0,
            threshold_label: orNull(row.condition ?? row.threshold_label),
            from_value: toNumber(row.from_value),
            to_value: toNumber(row.to_value),
            input_variable: orNull(row.input_variable),
        }));
        const missingBounds = record.target_rows.some((row) => row.from_value == null && row.to_value == null);
        if (missingBounds) {
            warn("target_rows", "Target / Severity",
                "Band wording was read from the document, but the numeric From/To bounds were not — fill them in if the calculation needs them.");
        }
    }

    /* ── target: linear LD escalation ── */
    if (r.linear_escalation) {
        const lin = r.linear_escalation;
        const rate = toNumber(lin.rate_per_unit_percent);
        const rateWasText = rate !== null && str(lin.rate_per_unit_percent) !== String(rate);
        const { unit, inferred } = inferLinearUnit(lin.unit, r.description, r.calculation_method, r.title);

        record.linear_escalation = {
            rate_per_unit_percent: rate,
            unit,
            grace_units: toNumber(lin.grace_units) ?? 0,
            max_units: toNumber(lin.max_units),
        };

        if (rate === null) {
            warn("linear_escalation", "LD rate", `No usable rate in "${lin.rate_per_unit_percent}" — enter the percentage.`);
        } else if (rateWasText) {
            warn("linear_escalation", "LD rate", `Read "${lin.rate_per_unit_percent}" as ${rate}% — confirm that's right.`);
        }
        if (!unit) {
            warn("linear_escalation", "LD unit", `The parser gave "${lin.unit}", which isn't a time unit — pick week, day or month.`);
        } else if (inferred) {
            warn("linear_escalation", "LD unit", `The parser gave "${lin.unit}"; "${unit}" was read from the description instead — confirm it.`);
        }
    }

    if (!record.target_rows && !record.linear_escalation) {
        warn("target_rows", "Target / Severity", "No severity bands or LD escalation came back — one of them is required.");
    }

    return { record, warnings };
}

/* Convenience for the intake screen: normalize the whole batch at once. */
export function normalizeAiBatch(slas, opts) {
    return (Array.isArray(slas) ? slas : []).map((raw) => normalizeAiSla(raw, opts));
}
