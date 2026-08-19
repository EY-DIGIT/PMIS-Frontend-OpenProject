import React, { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import * as ratesApi from "../../api/designationRates";
import { getAdditionalResourceOnboardingReport } from "../../api/attendanceReports";
import {
  readAdditionalResources, groupByDesignation, tallyOnboarding,
} from "../../utils/project/additionalOnboarding";

/* ────────────────────────────────────────────────────────────────────
   Resource allocation on a resource-based activity.

   A resource-based milestone's activities carry their own allocation rows:
   designation (a role from the organisation's rate card) + headcount +
   duration + the date those resources are planned to deploy. The activity's
   resource cost is the sum of those rows, and the finance page reads it back
   as the activity's share of the payment term.

   `duration` is a flat number of MONTHS in [0, 3] — an activity is one
   quarter.

   ONE ROW IS ONE DATE. Three of a designation all starting on the same day
   is a single row with quantity 3. A staggered start is separate rows — 2
   Program Managers on 01-Sep and 1 more on 15-Sep are two rows, not one row
   with a range. The "+ Add resource" button is how a split is expressed.

   All of designation, quantity, duration and plannedDeploymentDate are
   required; the backend answers 422 on a row missing any of them, so each is
   flagged here before the save is attempted.

   The backend resolves each row's monthly rate itself when the activity is
   saved (from leave-management, for the activity's contract year) and echoes
   back monthlyRate + computedCost. So the rate shown here is:
     • the saved monthlyRate/computedCost when the row came back from a save
     • otherwise an estimate from the rate card, clearly marked "est." —
       because a client-side guess at the contract year must never be
       mistaken for the figure that was actually stored.
   ──────────────────────────────────────────────────────────────────── */

const inr = (n) => {
  const v = Number(n);
  return Number.isFinite(v) ? `₹ ${v.toLocaleString("en-IN", { maximumFractionDigits: 2 })}` : "—";
};

const MAX_DURATION = 3;

/* ─── additional-resource flags (SLA 008) ──────────────────────────────
   Some of these rows are not original deployment — they are heads the team
   was approved to GROW by, after it was already staffed. That distinction
   is invisible in this table: a row for 1 Program Director looks the same
   whether it was in the original plan or added eighteen months later, and
   only the second one is scored by SLA 008.

   Worth flagging here, of all places, because this is where somebody
   changes a quantity. Raising a designation from 1 to 2 IS the act that
   creates an additional resource and starts that SLA's clock — and doing
   it without knowing that is how a breach gets created by accident.

   The flag is an annotation and nothing more. It never edits a row, never
   blocks a save, and never colours a field red: the report is a
   measurement of what the backend already approved, not a validation of
   what is being typed. */
/* Three levels of loudness, because one badge could not carry it.

   `row` tints the whole row, so which rows are additional is answered by
   glancing down the table rather than by reading each one. `solid` fills
   the badge itself — a tinted-outline pill sat in a tinted panel and read
   as decoration, so this one is filled and reversed out in white, which is
   the only treatment in this table that does that. `edge` draws the left
   margin stripe that ties the two together. */
const FLAG_TONE = {
  pass: { solid: "#1a7a48", row: "#f1faf5", edge: "#1a7a48", word: "onboarded" },
  fail: { solid: "#c0392b", row: "#fdf4f2", edge: "#c0392b", word: "breached" },
  pending: { solid: "#b06f00", row: "#fffaef", edge: "#b06f00", word: "pending" },
  unknown: { solid: "#456186", row: "#f6faff", edge: "#456186", word: "unclassified" },
};

/* Designations come from one rate card on both sides, so they should match
   exactly — but "Program Director" and "program  director" arriving from
   two services is a difference in typing, not in meaning, and letting it
   drop the flag would be a silent failure. */
const desigKey = (s) => String(s || "").trim().toLowerCase().replace(/\s+/g, " ");

/* The report sends ISO. Formatted explicitly rather than through `new Date`,
   which applies a timezone offset and can slide a 1st-of-month back a day. */
const MONTH_ABBR = ["", "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
function fmtDay(raw) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(raw || ""));
  if (!m) return "";
  const mm = Number(m[2]);
  return MONTH_ABBR[mm] ? `${Number(m[3])} ${MONTH_ABBR[mm]} ${m[1]}` : "";
}

/* When the approved heads actually arrived.

   A designation can cover several people, so this is a summary rather than
   one date: every seat filled shows the dates themselves, a part-filled
   designation shows how many of how many, and an unfilled one says so. The
   per-person detail is on the tooltip, because the cell has room for a
   headline and the names are what you want once the headline surprises you. */
function onboardedSummary(group) {
  if (!group) return null;
  const rows = group.rows || [];
  const filled = rows.filter((r) => r.actualOnboardingDate);
  const dates = [...new Set(filled.map((r) => fmtDay(r.actualOnboardingDate)).filter(Boolean))];
  const detail = rows
    .map((r) => `${r.employeeName || "(unnamed seat)"} — ${
      r.actualOnboardingDate ? fmtDay(r.actualOnboardingDate) : "not onboarded yet"
    }${r.plannedDeploymentDate ? ` (planned ${fmtDay(r.plannedDeploymentDate)})` : ""}`)
    .join("\n");

  if (!rows.length) return null;
  if (!filled.length) return { text: "Pending", pending: true, detail };
  if (filled.length < rows.length) {
    return { text: `${filled.length} of ${rows.length}`, pending: true, detail };
  }
  /* All in: one date if they arrived together, otherwise the span. Listing
     six identical dates would be noise. */
  const text = dates.length === 1 ? dates[0] : `${dates[0]} – ${dates[dates.length - 1]}`;
  return { text, pending: false, detail };
}


/* One designation's worst outstanding state. A breach outranks a pending
   seat, which outranks a clean one — the badge has room for a single
   answer and the reason to look at it is the worst thing it can say. */
function worstKind(rows) {
  const t = tallyOnboarding(rows);
  if (t.fail > 0) return "fail";
  if (t.pending > 0) return "pending";
  if (t.pass > 0) return "pass";
  return "unknown";
}

function AdditionalFlag({ group, kind }) {
  const tone = FLAG_TONE[kind] || FLAG_TONE.unknown;
  const t = tallyOnboarding(group.rows);

  const qty = `Approved head count ${group.originalQuantity ?? "—"} → ${group.currentApprovedQuantity ?? "—"}`;
  const heads = group.additionalQuantity === null
    ? "an additional head"
    : `${group.additionalQuantity} additional head${group.additionalQuantity === 1 ? "" : "s"}`;
  const state = [
    t.pass > 0 ? `${t.pass} onboarded in time` : "",
    t.fail > 0 ? `${t.fail} breached` : "",
    t.pending > 0 ? `${t.pending} still pending` : "",
    t.unknown > 0 ? `${t.unknown} unclassified` : "",
  ].filter(Boolean).join(", ");

  // The planned dates, so the tooltip says WHEN without opening another page.
  const planned = group.rows
    .map((r) => r.plannedDeploymentDate)
    .filter(Boolean);

  return (
    <div
      title={`${qty} — ${heads} on this activity. ${state}.`
        + (planned.length ? ` Planned ${planned.join(", ")}.` : "")
        + (group.quantitiesVary ? " ⚠ the report's rows disagree about this designation's quantities." : "")
        + " Measured by SLA 008; shown here for reference and not editable."}
      style={{
        display: "flex", alignItems: "center", justifyContent: "center", gap: 6,
        width: "100%", boxSizing: "border-box", marginTop: 5,
        padding: "3px 8px", borderRadius: 6, cursor: "help",
        background: tone.solid, color: "#fff",
        fontSize: 9.5, fontWeight: 800, letterSpacing: ".7px", textTransform: "uppercase",
        whiteSpace: "nowrap", overflow: "hidden",
      }}
    >
      <span>
        {group.additionalQuantity === null ? "Additional" : `+${group.additionalQuantity} additional`}
      </span>
      <span style={{ opacity: .55 }} aria-hidden="true">•</span>
      <span style={{ opacity: .92, overflow: "hidden", textOverflow: "ellipsis" }}>{tone.word}</span>
    </div>
  );
}

const cellStyle = {
  width: "100%", padding: "6px 8px", border: "1px solid var(--uidai-pmis-border)",
  borderRadius: 6, background: "#fff", font: "inherit", fontSize: 13,
  boxSizing: "border-box",
};

const headStyle = {
  textAlign: "left", fontSize: 11, fontWeight: 800, letterSpacing: 0.4,
  textTransform: "uppercase", color: "#5b6b82", padding: "0 10px 8px 0",
  /* A heading is clipped rather than broken — never "Monthly Rate" stacked
     as two-letter fragments. */
  whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
};

const cellPad = "0 10px 8px 0";

/* The first column carries a 9px gutter on EVERY row, flagged or not, so the
   additional-resource stripe has somewhere to live without resizing the cell.
   Applying it only to flagged rows would indent their pickers 9px further
   than everyone else's, and a column that doesn't line up is a worse problem
   than the one the stripe solves. */
const firstCellPad = "0 10px 8px 9px";

/* What the seven columns genuinely need to stay comfortable. The table never
   shrinks below this — a narrower panel scrolls sideways instead, which is
   what the scrollbar under the table is for. */
const TABLE_MIN_WIDTH = 900;

export default function ActivityResourceAllocations({
  rows = [],
  onChange,
  projectId,
  projectStartDate = "",
  /* The saved activity's backend id. Empty while an activity is being
     CREATED, which is correct and not a gap: nothing has been approved to
     grow yet, so there is no additional-resource report to flag against. */
  activityId = "",
  /* The activity's organisation — the rate card is keyed on it. */
  organisationId = "",
  /* Anchors the contract year for the cost estimate, and — with
     `activityEndDate` — bounds each row's planned deployment date. The
     backend rejects a date outside that window with 422, so the picker
     is bounded to it rather than letting the save fail. */
  activityStartDate = "",
  activityEndDate = "",
  disabled = false,
}) {
  const [roles, setRoles] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function loadRoles() {
    setError("");
    if (!projectId || !organisationId) {
      setRoles([]);
      return;
    }
    setLoading(true);
    try {
      setRoles(await ratesApi.listDesignationRates(projectId, organisationId));
    } catch (err) {
      setRoles([]);
      setError(err?.message || "Failed to load the rate card");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadRoles();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId, organisationId]);

  const roleByName = useMemo(() => {
    const m = {};
    roles.forEach((r) => { m[r.role] = r; });
    return m;
  }, [roles]);

  /* ── which of these rows are ADDITIONAL (SLA 008) ──────────────────
     Read-only, and deliberately not part of `loadRoles`: the rate card
     decides what this table can contain and its failure is worth a banner,
     whereas this only annotates what is already there. If the attendance
     service is down the editor must still work exactly as it did before
     the flags existed. */
  const [additional, setAdditional] = useState(null);
  const [additionalError, setAdditionalError] = useState("");

  useEffect(() => {
    if (!projectId || !activityId) { setAdditional(null); setAdditionalError(""); return undefined; }
    let alive = true;
    const controller = new AbortController();
    (async () => {
      const { data, error: err } = await getAdditionalResourceOnboardingReport(
        projectId, activityId, controller.signal
      );
      if (!alive) return;
      setAdditional(data);
      // 404 is "the team was never grown here" — a real answer, not a fault.
      setAdditionalError(err || "");
    })();
    return () => { alive = false; controller.abort(); };
  }, [projectId, activityId]);

  /* Keyed by designation, because that is the only field the report and an
     allocation row have in common — the report is about approved head
     counts per role, and these rows have no id it could refer to. */
  const additionalByDesignation = useMemo(() => {
    const groups = groupByDesignation(readAdditionalResources(additional));
    const m = new Map();
    groups.forEach((g) => { if (g.designation) m.set(desigKey(g.designation), g); });
    return m;
  }, [additional]);

  /* Approved to grow, but no row here to grow into. Worth saying out loud:
     it means either the allocation was never updated to match the approval,
     or the designation was renamed on one side. Both are things somebody
     editing this table needs to know, and neither is visible from the rows
     themselves — an absent row cannot carry a badge. */
  const anyAdditional = rows.some(
    (r) => r.designation && additionalByDesignation.has(desigKey(r.designation))
  );

  const unallocatedAdditions = useMemo(() => {
    const present = new Set(rows.map((r) => desigKey(r.designation)).filter(Boolean));
    const out = [];
    additionalByDesignation.forEach((g, k) => { if (!present.has(k)) out.push(g); });
    return out;
  }, [rows, additionalByDesignation]);

  /* What a row costs. Prefer the server's own numbers; fall back to an
     estimate at the rate for the activity's contract year. */
  function priceOf(row) {
    if (row.computedCost != null && row.monthlyRate != null) {
      return { rate: row.monthlyRate, cost: row.computedCost, estimated: false };
    }
    const card = roleByName[row.designation]?.rateCardByYear;
    const rate = card ? ratesApi.rateForDate(card, projectStartDate, activityStartDate) : null;
    if (rate == null) return { rate: null, cost: null, estimated: true };
    const qty = Math.max(1, parseInt(row.quantity, 10) || 1);
    const months = Number(row.duration) || 0;
    return { rate, cost: rate * qty * months, estimated: true };
  }

  const total = rows.reduce((sum, r) => {
    const { cost } = priceOf(r);
    return sum + (Number(cost) || 0);
  }, 0);
  const anyEstimated = rows.some((r) => r.designation && priceOf(r).estimated);

  function patchRow(idx, patch) {
    onChange(rows.map((r, i) => {
      if (i !== idx) return r;
      const next = { ...r, ...patch };
      /* Any edit invalidates the server's snapshot for this row — drop it so
         the table falls back to an estimate rather than showing a stale cost
         next to changed inputs. */
      if ("designation" in patch || "quantity" in patch || "duration" in patch) {
        next.monthlyRate = null;
        next.computedCost = null;
      }
      return next;
    }));
  }

  /* A new row defaults its date to the activity's own start — the common
     case is "deploys when the activity begins", and it matches how the
     backend backfilled the rows that predate this field. Still editable,
     and still required: an activity with no start date leaves it blank
     rather than guessing. */
  const addRow = () =>
    onChange([...rows, {
      designation: "",
      quantity: 1,
      duration: "",
      plannedDeploymentDate: String(activityStartDate || "").slice(0, 10),
      monthlyRate: null,
      computedCost: null,
    }]);

  const removeRow = (idx) => onChange(rows.filter((_, i) => i !== idx));

  /* Everything that decides how one row renders. Shared by both layouts, so
     a narrow screen flags exactly what a wide one flags. */
  function rowState(row) {
    const { rate, cost, estimated } = priceOf(row);
    const durationNum = Number(row.duration);
    const durationBad =
      row.duration !== "" &&
      (!Number.isFinite(durationNum) || durationNum < 0 || durationNum > MAX_DURATION);
    const dateMissing = !!row.designation && !row.plannedDeploymentDate;
    /* The backend rejects a deployment date outside the activity's own
       window with 422 `deployment_date_outside_activity_window`. The
       picker's `min`/`max` stop it offering one, but a date typed in
       directly — or one that was valid until the activity's dates were
       narrowed — still has to be caught here. */
    const dateOutside =
      !!row.plannedDeploymentDate
      && ((activityStartDate && row.plannedDeploymentDate < String(activityStartDate).slice(0, 10))
        || (activityEndDate && row.plannedDeploymentDate > String(activityEndDate).slice(0, 10)));
    const addl = row.designation
      ? additionalByDesignation.get(desigKey(row.designation)) || null
      : null;
    return {
      rate, cost, estimated,
      missingRole: !!row.designation && !roleByName[row.designation],
      durationBad,
      dateOutside,
      dateBad: dateMissing || dateOutside,
      /* Annotation only — never folded into any of the `*Bad` flags above.
         Being an additional resource is not an error in the row. */
      additional: addl,
      // Resolved once here, because the tint, the stripe and the badge all
      // key off it and computing it three times could disagree three ways.
      additionalKind: addl ? worstKind(addl.rows) : null,
    };
  }

  /* One definition per input, used by the table and the cards alike — the
     two layouts must not drift apart as either is edited. */
  const designationField = (row, idx, st) => (
    <>
      <select
        style={cellStyle}
        value={row.designation}
        disabled={disabled || roles.length === 0}
        onChange={(e) => patchRow(idx, { designation: e.target.value })}
      >
        <option value="">
          {loading ? "Loading roles…" : roles.length === 0 ? "— No rate card —" : "— Select role —"}
        </option>
        {/* A role dropped from the card since this was saved still has to
            render, or the row looks empty. */}
        {st.missingRole && (
          <option value={row.designation}>{row.designation} (not on the current card)</option>
        )}
        {roles.map((r) => (
          <option key={r.id || r.role} value={r.role}>{r.role}</option>
        ))}
      </select>
      {/* Full width under the picker rather than floating beside it. The
          column is 25% wide, so a badge on the same line would squeeze the
          select narrower than the role names it has to show — and a small
          pill tucked under one corner was what read as an afterthought. */}
      {st.additional && <AdditionalFlag group={st.additional} kind={st.additionalKind} />}
    </>
  );

  const qtyField = (row, idx) => (
    <input
      type="number" min="1" step="1" style={{ ...cellStyle, textAlign: "right" }}
      value={row.quantity}
      disabled={disabled}
      onChange={(e) => patchRow(idx, { quantity: e.target.value })}
    />
  );

  const durationField = (row, idx, st) => (
    <input
      type="number" min="0" max={MAX_DURATION} step="0.01"
      style={{
        ...cellStyle, textAlign: "right",
        borderColor: st.durationBad ? "#d32f2f" : "var(--uidai-pmis-border)",
      }}
      value={row.duration}
      disabled={disabled}
      placeholder="0.00"
      title={`Months, 0 to ${MAX_DURATION}`}
      onChange={(e) => patchRow(idx, { duration: e.target.value })}
    />
  );

  /* Required: the backend 422s without it. Flagged red only once the row has
     a designation, so a freshly added blank row is not scolded before it is
     filled. */
  const dateField = (row, idx, st) => (
    <>
      <input
        type="date"
        style={{
          ...cellStyle,
          borderColor: st.dateBad ? "#d32f2f" : "var(--uidai-pmis-border)",
        }}
        value={row.plannedDeploymentDate || ""}
        disabled={disabled}
        required
        min={activityStartDate ? String(activityStartDate).slice(0, 10) : undefined}
        max={activityEndDate ? String(activityEndDate).slice(0, 10) : undefined}
        title={st.dateOutside
          ? `Must fall between ${String(activityStartDate).slice(0, 10)} and ${String(activityEndDate).slice(0, 10)} — the activity's own dates`
          : "Date these resources are planned to deploy"}
        onChange={(e) => patchRow(idx, { plannedDeploymentDate: e.target.value })}
      />
      {st.dateOutside && (
        <div style={{ fontSize: 10.5, color: "#d32f2f", marginTop: 2, lineHeight: 1.4 }}>
          Outside the activity ({String(activityStartDate).slice(0, 10)} → {String(activityEndDate).slice(0, 10)})
        </div>
      )}
    </>
  );

  /* Only an additional resource has an onboarding date to show — this comes
     from the SLA 008 report, which measures heads the team was approved to
     grow by. An original-plan row is left blank rather than borrowing a date
     it has no claim to. */
  const onboardedText = (st) => {
    const summary = onboardedSummary(st.additional);
    if (!summary) return <span style={{ color: "#9aa7ba" }}>—</span>;
    return (
      <span
        title={summary.detail}
        style={{
          color: summary.pending ? "#b06f00" : "#1a7a48",
          fontWeight: summary.pending ? 700 : 600,
          cursor: "help",
        }}
      >
        {summary.text}
      </span>
    );
  };

  const removeButton = (idx) => (
    <button
      type="button"
      title="Remove this allocation"
      aria-label={`Remove allocation ${idx + 1}`}
      disabled={disabled}
      onClick={() => removeRow(idx)}
      style={{
        border: "1px solid #e6b4b4", background: "#fff", color: "#b3261e",
        borderRadius: 6, width: 28, height: 30, flex: "0 0 auto",
        cursor: disabled ? "not-allowed" : "pointer", fontSize: 13, lineHeight: 1,
      }}
    >
      ✕
    </button>
  );

  const costText = (st) => (
    <>
      {st.cost == null ? "—" : inr(st.cost)}
      {st.cost != null && st.estimated && (
        <span style={{ fontWeight: 500, fontSize: 11, color: "#5b6b82" }}> est.</span>
      )}
    </>
  );

  return (
    <div
      style={{
        border: "1px solid var(--uidai-pmis-border)", borderRadius: 10,
        padding: "12px 14px", background: "#fbfdff",
        /* The panel sits in a form grid: without these it would grow to fit
           its widest child and drag the whole form sideways, instead of
           letting the table below take the scrolling on itself. */
        minWidth: 0, maxWidth: "100%", boxSizing: "border-box",
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 8, marginBottom: 8 }}>
        <div style={{ fontSize: 12, color: "#5b6b82", whiteSpace: "nowrap" }}>
          Resource cost:{" "}
          <strong style={{ color: "#173e77", fontSize: 14 }}>{inr(total)}</strong>
          {anyEstimated && <span style={{ fontSize: 11 }}> (est.)</span>}
        </div>
      </div>

      {/* Why the role picker is empty, when it is. */}
      {(error || (!organisationId) || (!loading && roles.length === 0 && organisationId)) && (
        <div
          style={{
            display: "flex", alignItems: "center", justifyContent: "space-between",
            flexWrap: "wrap", gap: 10, marginBottom: 10, padding: "8px 11px",
            border: `1px solid ${error ? "#f5c6c6" : "#e2e8f3"}`,
            background: error ? "#fff7f7" : "#f2f7ff", borderRadius: 8,
            fontSize: 12.5, color: error ? "#b3261e" : "#3d5372",
          }}
        >
          <span style={{ flex: "1 1 240px", minWidth: 0 }}>
            {error
              ? `The rate card could not be loaded — ${error}`
              : !organisationId
                ? "Pick this activity's Organization first — roles and rates come from that organisation's rate card."
                : "No rate card on file for this organisation yet — upload it on the Designation Rates page."}
          </span>
          <span style={{ display: "inline-flex", gap: 8 }}>
            {error && (
              <button
                type="button"
                className="uidai-pmis-btn uidai-pmis-btn-cancel uidai-pmis-btn-small"
                style={{ marginTop: 0, padding: "3px 10px" }}
                onClick={loadRoles}
              >
                Retry
              </button>
            )}
            {projectId && organisationId && !error && (
              <Link
                to={`/projects/${encodeURIComponent(projectId)}/designation-rate`}
                className="uidai-pmis-btn uidai-pmis-btn-small"
                style={{ marginTop: 0, padding: "3px 10px", textDecoration: "none" }}
              >
                Designation Rates
              </Link>
            )}
          </span>
        </div>
      )}

      {/* The columns hold their proportions and share out any extra room on a
          wide panel; below TABLE_MIN_WIDTH this scrolls sideways rather than
          squeezing headings and amounts into unreadable stacks. */}
      {rows.length > 0 && (
        <div style={{ overflowX: "auto", maxWidth: "100%", paddingBottom: 6 }}>
          <table
            style={{
              width: "100%", minWidth: TABLE_MIN_WIDTH,
              borderCollapse: "collapse", tableLayout: "fixed",
            }}
          >
            <colgroup>
              <col style={{ width: "22%" }} />
              <col style={{ width: "8%" }} />
              <col style={{ width: "11%" }} />
              <col style={{ width: "15%" }} />
              <col style={{ width: "14%" }} />
              <col style={{ width: "15%" }} />
              <col style={{ width: "15%" }} />
              <col style={{ width: 44 }} />
            </colgroup>
            <thead>
              <tr>
                <th style={{ ...headStyle, padding: firstCellPad }}>Designation</th>
                <th style={headStyle}>Qty</th>
                <th style={headStyle}>Duration (mo)</th>
                <th
                  style={headStyle}
                  title="The date these resources are planned to deploy. One row covers one date — split a staggered start across separate rows."
                >
                  Planned deployment
                </th>
                {/* Read-only, and only ever filled for an additional resource:
                    this comes from the SLA 008 report, which measures heads the
                    team was approved to grow by. An original-plan row has no
                    onboarding to measure, so it stays blank rather than
                    borrowing a date from somewhere else. */}
                <th
                  style={headStyle}
                  title="When the approved heads actually onboarded, from the additional-resource report. Blank for rows that are not additional resources."
                >
                  Onboarded
                </th>
                <th style={headStyle} title="Rate-card rate for this designation, per resource per month.">Monthly Rate</th>
                {/* The planned budget, not what gets billed — attendance has no
                    say in it. The formula is on the tooltip because the three
                    inputs are all in this row, so a reader can check it. */}
                <th
                  style={headStyle}
                  title="Planned cost for this designation = monthly rate × planned months × number of resources. Example: 2,11,982 × 3 × 2 = ₹12,71,892."
                >
                  Cost
                </th>
                <th style={headStyle} />
              </tr>
            </thead>
            <tbody>
              {rows.map((row, idx) => {
                const st = rowState(row);
                const flag = st.additionalKind ? FLAG_TONE[st.additionalKind] : null;
                return (
                  /* The whole row is tinted, so "which of these are
                     additional" is answered by glancing down the table
                     instead of reading every row. The stripe is an inset
                     shadow rather than a border because a border would
                     resize the cell and knock the flagged rows' inputs out
                     of alignment with every other row's. */
                  <tr key={idx} style={flag ? { background: flag.row } : undefined}>
                    <td style={{
                      padding: firstCellPad,
                      boxShadow: flag ? `inset 3px 0 0 ${flag.edge}` : undefined,
                    }}>
                      {designationField(row, idx, st)}
                    </td>
                    <td style={{ padding: cellPad }}>{qtyField(row, idx)}</td>
                    <td style={{ padding: cellPad }}>{durationField(row, idx, st)}</td>
                    <td style={{ padding: cellPad }}>{dateField(row, idx, st)}</td>
                    <td style={{ padding: cellPad, fontSize: 12.5, whiteSpace: "nowrap" }}>
                      {onboardedText(st)}
                    </td>
                    <td style={{ padding: cellPad, fontSize: 12.5, color: "#5b6b82", whiteSpace: "nowrap" }}>
                      {st.rate == null ? "—" : inr(st.rate)}
                    </td>
                    <td style={{ padding: cellPad, fontSize: 12.5, fontWeight: 700, color: "#173e77", whiteSpace: "nowrap" }}>
                      {costText(st)}
                    </td>
                    <td style={{ padding: "0 0 8px 0", textAlign: "center" }}>
                      {removeButton(idx)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Says what the tint means. A colour nobody has been told the meaning
          of is decoration, and this one is carrying a fact about the SLA. */}
      {anyAdditional && (
        <div style={{
          display: "flex", alignItems: "center", gap: 7, flexWrap: "wrap",
          fontSize: 11.5, color: "#5b6b82", marginTop: 2, lineHeight: 1.5,
        }}>
          <span style={{
            width: 22, height: 10, borderRadius: 3, flex: "0 0 auto",
            background: FLAG_TONE.pending.row,
            boxShadow: `inset 3px 0 0 ${FLAG_TONE.pending.edge}`,
            border: "1px solid #eddcb4",
          }} aria-hidden="true" />
          <span>
            Highlighted rows are <b>additional resources</b> — heads approved after this
            activity was first staffed, and the ones SLA 008 scores on how quickly they
            onboarded. Reference only; editing a row does not change them.
          </span>
        </div>
      )}

      {rows.length === 0 && (
        <div style={{ fontSize: 12.5, color: "#5b6b82", padding: "6px 0 10px" }}>
          No resources allocated to this activity yet.
        </div>
      )}

      <button
        type="button"
        className="uidai-pmis-btn uidai-pmis-btn-small"
        style={{ marginTop: 8, padding: "5px 12px" }}
        disabled={disabled}
        onClick={addRow}
      >
        + Add resource
      </button>

      {anyEstimated && rows.length > 0 && (
        <div style={{ fontSize: 11.5, color: "#5b6b82", marginTop: 8 }}>
          Costs marked “est.” are calculated here from the rate card. The saved figure is
          resolved by the server when you save the activity.
        </div>
      )}

      {/* Approved to grow with nothing here to grow into. Stated rather than
          silently absent: a designation the backend has already approved an
          extra head for, but which has no row on this activity, is either an
          allocation nobody updated or a designation renamed on one side. */}
      {unallocatedAdditions.length > 0 && (
        <div style={{
          marginTop: 8, padding: "7px 10px", borderRadius: 8,
          border: "1px solid #eddcb4", background: "#fdf6e8",
          fontSize: 11.5, color: "#8a5a00", lineHeight: 1.55,
        }}>
          <b>Approved for additional resources, but not allocated here:</b>{" "}
          {unallocatedAdditions.map((g, i) => (
            <span key={g.designation}>
              {i > 0 ? ", " : ""}{g.designation}
              {g.additionalQuantity === null ? "" : ` (+${g.additionalQuantity})`}
            </span>
          ))}
          . Either the allocation has not been updated to match the approval, or the
          designation is spelled differently on the two sides.
        </div>
      )}

      {/* Quiet, because it is not this editor's job. But the flags being
          absent has to be distinguishable from there being nothing to flag —
          otherwise an unreachable report reads as "no additional resources". */}
      {additionalError && (
        <div style={{ fontSize: 11, color: "#8a5a00", marginTop: 8, lineHeight: 1.5 }}>
          Additional-resource flags unavailable — {additionalError} Rows are shown without them.
        </div>
      )}
    </div>
  );
}
