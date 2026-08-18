import React, { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import * as ratesApi from "../../api/designationRates";

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

const cellStyle = {
  width: "100%", padding: "6px 8px", border: "1px solid var(--uidai-pmis-border)",
  borderRadius: 6, background: "#fff", font: "inherit", fontSize: 13,
  boxSizing: "border-box",
};

const headStyle = {
  textAlign: "left", fontSize: 11, fontWeight: 800, letterSpacing: 0.4,
  textTransform: "uppercase", color: "#5b6b82", padding: "0 6px 6px 0",
  /* A squeezed column must clip its heading, never break "Monthly Rate"
     into a stack of two-letter fragments. */
  whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
};

/* The same label above a field once the row is a card rather than a table
   row — the column headings have to go somewhere. */
const fieldLabelStyle = {
  display: "block", fontSize: 10, fontWeight: 800, letterSpacing: 0.4,
  textTransform: "uppercase", color: "#5b6b82", marginBottom: 3,
};

/* Below this the columns can no longer hold a role name, a date picker and
   two rupee figures at a readable size, so the table gives way to one card
   per allocation. Above it, the table scrolls sideways rather than
   compressing — TABLE_MIN_WIDTH is what the seven columns actually need. */
const TABLE_MIN_WIDTH = 860;
const STACK_BELOW = 720;

export default function ActivityResourceAllocations({
  rows = [],
  onChange,
  projectId,
  projectStartDate = "",
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

  /* Which layout to use is decided by the space this panel actually has,
     not by the viewport — the same window is far narrower here with the
     sidebar open, or with the modal's right-hand column showing. */
  const panelRef = useRef(null);
  const [panelWidth, setPanelWidth] = useState(0);

  useEffect(() => {
    const el = panelRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const measure = () => setPanelWidth(el.clientWidth);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  /* Width 0 means it has not been measured yet (or ResizeObserver is
     missing) — fall back to the table, which scrolls on its own. */
  const stacked = panelWidth > 0 && panelWidth < STACK_BELOW;

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
    return {
      rate, cost, estimated,
      missingRole: !!row.designation && !roleByName[row.designation],
      durationBad,
      dateOutside,
      dateBad: dateMissing || dateOutside,
    };
  }

  /* One definition per input, used by the table and the cards alike — the
     two layouts must not drift apart as either is edited. */
  const designationField = (row, idx, st) => (
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
      ref={panelRef}
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
        <div style={{ fontSize: 12, color: "#5b6b82", flex: "1 1 260px", minWidth: 0 }}>
          One row per role <strong>per deployment date</strong>. Duration is in{" "}
          <strong>months (0–{MAX_DURATION})</strong> — an activity covers a single quarter.
          Staggering a role across dates? Add a row for each.
        </div>
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

      {/* Too narrow for a legible table: one card per allocation, so nothing
          ends up clipped or hidden behind a scrollbar. */}
      {rows.length > 0 && stacked && (
        <div style={{ display: "grid", gap: 10 }}>
          {rows.map((row, idx) => {
            const st = rowState(row);
            return (
              <div
                key={idx}
                style={{
                  border: "1px solid var(--uidai-pmis-border)", borderRadius: 8,
                  background: "#fff", padding: 10, boxSizing: "border-box", minWidth: 0,
                }}
              >
                <div style={{ display: "flex", alignItems: "flex-end", gap: 8 }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <span style={fieldLabelStyle}>Designation</span>
                    {designationField(row, idx, st)}
                  </div>
                  {removeButton(idx)}
                </div>

                <div
                  style={{
                    display: "grid", gap: 8, marginTop: 8,
                    gridTemplateColumns: "repeat(auto-fit, minmax(110px, 1fr))",
                  }}
                >
                  <div style={{ minWidth: 0 }}>
                    <span style={fieldLabelStyle}>Qty</span>
                    {qtyField(row, idx)}
                  </div>
                  <div style={{ minWidth: 0 }}>
                    <span style={fieldLabelStyle}>Duration (mo)</span>
                    {durationField(row, idx, st)}
                  </div>
                  <div style={{ minWidth: 0, gridColumn: "1 / -1" }}>
                    <span style={fieldLabelStyle}>Planned deployment</span>
                    {dateField(row, idx, st)}
                  </div>
                </div>

                <div
                  style={{
                    display: "flex", justifyContent: "space-between", flexWrap: "wrap",
                    gap: 8, marginTop: 10, paddingTop: 8, fontSize: 12.5,
                    borderTop: "1px dashed var(--uidai-pmis-border)",
                  }}
                >
                  <span style={{ color: "#5b6b82", whiteSpace: "nowrap" }}>
                    Monthly rate: {st.rate == null ? "—" : inr(st.rate)}
                  </span>
                  <span style={{ fontWeight: 700, color: "#173e77", whiteSpace: "nowrap" }}>
                    Cost: {costText(st)}
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Wide enough for the table. The columns hold their proportions and
          share out any extra room; the min-width is what they genuinely
          need, so a tight fit scrolls instead of mangling the cells. */}
      {rows.length > 0 && !stacked && (
        <div style={{ overflowX: "auto", maxWidth: "100%", paddingBottom: 4 }}>
          <table
            style={{
              width: "100%", minWidth: TABLE_MIN_WIDTH,
              borderCollapse: "collapse", tableLayout: "fixed",
            }}
          >
            <colgroup>
              <col style={{ width: "24%" }} />
              <col style={{ width: "9%" }} />
              <col style={{ width: "13%" }} />
              <col style={{ width: "18%" }} />
              <col style={{ width: "16%" }} />
              <col style={{ width: "16%" }} />
              <col style={{ width: 44 }} />
            </colgroup>
            <thead>
              <tr>
                <th style={headStyle}>Designation</th>
                <th style={headStyle}>Qty</th>
                <th style={headStyle}>Duration (mo)</th>
                <th
                  style={headStyle}
                  title="The date these resources are planned to deploy. One row covers one date — split a staggered start across separate rows."
                >
                  Planned deployment
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
                return (
                  <tr key={idx}>
                    <td style={{ padding: "0 6px 6px 0" }}>{designationField(row, idx, st)}</td>
                    <td style={{ padding: "0 6px 6px 0" }}>{qtyField(row, idx)}</td>
                    <td style={{ padding: "0 6px 6px 0" }}>{durationField(row, idx, st)}</td>
                    <td style={{ padding: "0 6px 6px 0" }}>{dateField(row, idx, st)}</td>
                    <td style={{ padding: "0 6px 6px 0", fontSize: 12.5, color: "#5b6b82", whiteSpace: "nowrap" }}>
                      {st.rate == null ? "—" : inr(st.rate)}
                    </td>
                    <td style={{ padding: "0 6px 6px 0", fontSize: 12.5, fontWeight: 700, color: "#173e77", whiteSpace: "nowrap" }}>
                      {costText(st)}
                    </td>
                    <td style={{ padding: "0 0 6px 0", textAlign: "center" }}>
                      {removeButton(idx)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
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
    </div>
  );
}
