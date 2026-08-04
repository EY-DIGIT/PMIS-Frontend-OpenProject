import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useNavigate, useParams } from "react-router-dom";
import { useProject } from "../../store/project/projectsStore";
import { uiStore } from "../../store/project/uiStore";
import { API_BASE, authorizedFetch } from "../../api/client";
import { ENDPOINTS } from "../../api/endpoint";
import { getToken, logout } from "../../api/auth";
import { fromApiNodeStatus } from "../../api/adapters";
import { get as getProjectById } from "../../api/projects";
import { setPageContext, clearPageContext } from "../../utils/pageContext";

import "../../styles/global.css";

/* ────────────────────────────────────────────────────────────────────
   Project Finance page — wired against the Payment Module API:

     GET   /master/cost-types                       — cost-type catalog
     GET   /master/frequencies                      — frequency catalog
     GET   /projects/{pid}/payment-page             — full hydrated state
     GET   /projects/{pid}/milestones               — milestone id → name
     POST  /projects/{pid}/cost-items               — add a cost row
     PATCH /projects/payment-terms/{tid}            — set frequency + %
     PATCH /projects/payment-terms/{tid}/activities — per-activity split
     PUT   /projects/{pid}/phases/{n}/carry-forward — carry leftover fwd
     PATCH /projects/{pid}/ccn-cap                  — set CCN cap %

   The /payment-page response is the single source of truth — every
   mutation refreshes it so totals, derived values and carry-forward stay
   in sync.
   ──────────────────────────────────────────────────────────────────── */

function inr(n) {
  const v = Number(n);
  if (!Number.isFinite(v)) return "₹ 0";
  return `₹ ${v.toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;
}

/* ISO datetime → YYYY-MM-DD for <input type="date">. */
function toDateInput(iso) {
  return typeof iso === "string" && iso.length >= 10 ? iso.slice(0, 10) : "";
}

/* YYYY-MM-DD (or ISO datetime) → DD-MM-YYYY for read-only display. */
function fmtDMY(value) {
  const ymd = toDateInput(value);
  if (!ymd) return "";
  const [y, m, d] = ymd.split("-");
  return `${d}-${m}-${y}`;
}


/* Rupee amount → words (Indian numbering: Crore / Lakh / Thousand). Used as
   an inline confirmation under the Cost / Tax inputs. Integer part only. */
function amountToWords(value) {
  const n = Math.floor(Math.abs(Number(value) || 0));
  if (!Number.isFinite(n) || n === 0) return "";
  const ones = ["", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight",
    "Nine", "Ten", "Eleven", "Twelve", "Thirteen", "Fourteen", "Fifteen", "Sixteen",
    "Seventeen", "Eighteen", "Nineteen"];
  const tens = ["", "", "Twenty", "Thirty", "Forty", "Fifty", "Sixty", "Seventy", "Eighty", "Ninety"];
  const two = (num) => num < 20 ? ones[num] : (tens[Math.floor(num / 10)] + (num % 10 ? " " + ones[num % 10] : ""));
  const three = (num) => {
    const h = Math.floor(num / 100), r = num % 100;
    return (h ? ones[h] + " Hundred" + (r ? " " : "") : "") + (r ? two(r) : "");
  };
  const parts = [];
  const crore = Math.floor(n / 10000000);
  const lakh = Math.floor((n % 10000000) / 100000);
  const thousand = Math.floor((n % 100000) / 1000);
  const hundred = n % 1000;
  if (crore) parts.push(three(crore) + " Crore");
  if (lakh) parts.push(two(lakh) + " Lakh");
  if (thousand) parts.push(two(thousand) + " Thousand");
  if (hundred) parts.push(three(hundred));
  return parts.join(" ").trim();
}

/* Small ₹/% segmented toggle used on the Tax field. */
const segStyle = (active) => ({
  padding: "9px 12px", borderRadius: 6, fontSize: 13, fontWeight: 700,
  border: active ? "1px solid #173e77" : "1px solid var(--uidai-pmis-border)",
  background: active ? "#173e77" : "#fff",
  color: active ? "#fff" : "#173e77", cursor: "pointer", flex: "0 0 auto",
});
/* Muted "in words" hint shown under a rupee input. */
function wordsHint(amount) {
  const w = amountToWords(amount);
  return w ? `${w} Rupees` : "";
}

const ctrl = {
  width: "100%",
  padding: "10px",
  border: "1px solid var(--uidai-pmis-border)",
  borderRadius: 6,
  background: "#fff",
  color: "var(--uidai-pmis-text)",
  font: "inherit",
  boxSizing: "border-box",
};

const stepBadge = {
  display: "inline-flex", alignItems: "center", justifyContent: "center",
  width: 26, height: 26, borderRadius: "50%",
  background: "linear-gradient(135deg, var(--uidai-pmis-navy), var(--uidai-pmis-cyan))",
  color: "#fff", fontSize: 13, fontWeight: 800, marginRight: 10, flex: "0 0 auto",
};

const sectionHead = {
  display: "flex", alignItems: "center",
  marginBottom: 16, fontSize: 16, fontWeight: 800, color: "#173e77",
};

const muted = { color: "var(--uidai-pmis-muted)" };

/* Readable names for validate checks that come back with an id but no label.
   `ld-basis-pct` and `pay-le-basis` are the two LD-allotment checks. */
const CHECK_LABELS = {
  "ld-basis-pct": "LD Basis % totals 100% per phase",
  "pay-le-basis": "% of Payment is within each milestone's LD Basis %",
};

/* Disabled-looking blank cell used in the cost table for One-Time rows
   where Milestone / Phase do not apply. The grey wash + dash makes it
   clear the field is intentionally inert (not just empty). */
const disabledCell = {
  // background: "rgb(243, 246, 251)",
  color: "#a3afc1",
  borderRadius: 4,
  padding: "6px 10px",
  display: "inline-block",
  minWidth: 60,
  textAlign: "center",
  fontSize: 13,
};

async function readJson(res) {
  const payload = await res.json().catch(() => null);
  if (res.status === 401) {
    logout();
    const e = new Error("Session expired. Please sign in again.");
    e.isAuth = true;
    throw e;
  }
  if (!res.ok) {
    const msg =
      payload?.error?.message ||
      payload?.message ||
      payload?.detail?.[0]?.msg ||   
      payload?.detail ||
      `Request failed (${res.status})`;
    throw new Error(msg);
  }
  return payload;
}

function extractElements(payload) {
  return (
    payload?.data?._embedded?.elements ||
    payload?._embedded?.elements ||
    payload?.data ||
    []
  );
}

/* Inline multi-select used inside the Add Cost Item modal. Keeps the
   spec-mocked italic placeholder behaviour when disabled.

   `disabledIds` is the set of milestone ids already attached to a saved
   cost row — those rows render greyed out and are non-clickable. They
   stay visible so the user understands why they're unavailable. */
function MilestoneMultiSelect({ value, options, onChange, disabled, disabledIds }) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState({ top: 0, left: 0, width: 0, ready: false });
  const toggleRef = useRef(null);
  const panelRef = useRef(null);
  const selected = Array.isArray(value) ? value : [];

  function isLocked(id) {
    if (!disabledIds) return false;
    if (typeof disabledIds.has === "function") return disabledIds.has(id);
    return Array.isArray(disabledIds) && disabledIds.includes(id);
  }

  function toggle(id) {
    if (isLocked(id)) return;
    if (selected.includes(id)) onChange(selected.filter((s) => s !== id));
    else onChange([...selected, id]);
  }

  const labels = selected
    .map((id) => options.find((o) => o.id === id)?.name)
    .filter(Boolean);

  /* The Add Cost modal box is `overflow:auto`, so an absolutely-positioned
     dropdown gets clipped and the user has to scroll the modal to see the
     list. Render the panel position:fixed (anchored to the toggle) so it
     floats above the modal — same technique as the Manage Team picker. */
  useLayoutEffect(() => {
    if (!open) return;
    const place = () => {
      const toggleEl = toggleRef.current;
      const panel = panelRef.current;
      if (!toggleEl || !panel) return;
      const rect = toggleEl.getBoundingClientRect();
      const margin = 10;
      const gap = 6;
      const viewportH = window.innerHeight;
      const width = rect.width;
      let left = rect.left;
      if (left + width > window.innerWidth - margin) left = window.innerWidth - margin - width;
      if (left < margin) left = margin;

      const panelHeight = panel.offsetHeight;
      const spaceBelow = viewportH - rect.bottom - margin;
      const spaceAbove = rect.top - margin;
      let top;
      if (spaceBelow >= panelHeight + gap || spaceBelow >= spaceAbove) {
        top = rect.bottom + gap;
        if (top + panelHeight > viewportH - margin) top = Math.max(margin, viewportH - margin - panelHeight);
      } else {
        top = rect.top - panelHeight - gap;
        if (top < margin) top = margin;
      }
      setPos({ top, left, width, ready: true });
    };
    place();
    const onReposition = () => place();
    window.addEventListener("scroll", onReposition, true);
    window.addEventListener("resize", onReposition);
    return () => {
      window.removeEventListener("scroll", onReposition, true);
      window.removeEventListener("resize", onReposition);
    };
  }, [open, options.length]);

  /* Close on outside click. */
  useEffect(() => {
    if (!open) return;
    const onDocClick = (e) => {
      if (toggleRef.current?.contains(e.target)) return;
      if (panelRef.current?.contains(e.target)) return;
      setOpen(false);
    };
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, [open]);

  return (
    <div style={{ position: "relative" }}>
      <button
        type="button"
        ref={toggleRef}
        disabled={disabled}
        onClick={() => setOpen((o) => !o)}
        style={{
          ...ctrl,
          display: "flex", alignItems: "center", justifyContent: "space-between",
          cursor: disabled ? "not-allowed" : "pointer",
          background: disabled ? "#f3f6fb" : "#fff",
          color: disabled ? "#7c8aa1" : "var(--uidai-pmis-text)",
        }}
      >
        <span style={{
          flex: 1, minWidth: 0,
          overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
          textAlign: "left",
          color: labels.length ? "var(--uidai-pmis-text)" : "var(--uidai-pmis-muted)",
        }}>
          {labels.length ? labels.join(", ") : "Select milestones…"}
        </span>
        <span style={{ ...muted, fontSize: 11 }}>▾</span>
      </button>
      {open && !disabled && createPortal(
        <div
          ref={panelRef}
          className="fin-ms-panel"
          style={{
            position: "fixed",
            top: pos.top + "px",
            left: pos.left + "px",
            width: pos.width + "px",
            visibility: pos.ready ? "visible" : "hidden",
          }}
        >
          <div className="fin-ms-options" role="listbox">
            {options.length === 0 ? (
              <div className="fin-ms-empty">No milestones available</div>
            ) : options.map((opt) => {
              const locked = isLocked(opt.id);
              const checked = selected.includes(opt.id);
              return (
                <label key={opt.id}
                  className={`fin-ms-option${checked ? " fin-ms-checked" : ""}${locked ? " fin-ms-locked" : ""}`}
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={(e) => {
                    e.stopPropagation();
                    if (locked) return;
                    toggle(opt.id);
                  }}
                >
                  <input
                    type="checkbox"
                    readOnly
                    disabled={locked}
                    checked={checked}
                  />
                  <span>{opt.name}</span>
                </label>
              );
            })}
          </div>
        </div>,
        document.body
      )}
    </div>
  );
}

/* Summary section — top half of the unified right-side card. Renders
   as plain content (no border / shadow); the parent owns the card. */
function SummaryPanel({ totals }) {
  const fixed = Number(totals?.fixedCost) || 0;
  const oneTime = Number(totals?.oneTimeCost) || 0;
  const recurring = Number(totals?.recurringCost) || 0;
  const total = Number(totals?.totalContractCost) || 0;
  /* Allocated-vs-pending for the Out of Pocket Expense pool. These are the
     authoritative roll-up — summing the per-phase oneTimeAllocated would
     drift, because phases the backend clears (recurring-only) report no
     allocation at all. */
  const oneTimeAllocated = Number(totals?.oneTimeAllocated) || 0;
  const oneTimePending = Number(totals?.oneTimePending) || 0;
  const oneTimeAllocatedPercent = Number(totals?.oneTimeAllocatedPercent) || 0;
  const oneTimePendingPercent = Number(totals?.oneTimePendingPercent) || 0;
  const hasOneTimeSplit = oneTime > 0 && (oneTimeAllocated > 0 || oneTimePending > 0);

  const rowStyle = {
    display: "flex", justifyContent: "space-between", alignItems: "center",
    gap: 8, fontSize: 13,
    background: "#fff", border: "1px solid var(--uidai-pmis-border)",
    borderRadius: 8, padding: "8px 12px",
  };
  
  return (
    <div style={{ padding: 18 }}>
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        <div style={{
          display: "flex", justifyContent: "space-between", alignItems: "center",
          gap: 8, fontSize: 13,
          background: "#fff", border: "1px solid var(--uidai-pmis-border)",
          borderRadius: 8, padding: "8px 12px",
        }}>
          <span style={muted}>Fixed Cost</span>
          <strong style={{ color: "#173e77" }} title={wordsHint(fixed)}>
            {inr(fixed)}
          </strong>
        </div>
        <div style={{
          display: "flex", flexDirection: "column",
          gap: 6, fontSize: 13,
          background: "#fff", border: "1px solid var(--uidai-pmis-border)",
          borderRadius: 8, padding: "8px 12px",
        }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
            <span style={muted}>Out of Pocket Expense</span>
            <strong style={{ color: "#173e77" }} title={wordsHint(oneTime)}>
              {inr(oneTime)}
            </strong>
          </div>
          {hasOneTimeSplit && (
            <div style={{ display: "flex", justifyContent: "space-between", gap: 8, fontSize: 11.5 }}>
              <span style={{ color: "#0b6b8f" }} title={wordsHint(oneTimeAllocated)}>
                Allocated {inr(oneTimeAllocated)}
                {oneTimeAllocatedPercent > 0 && ` (${oneTimeAllocatedPercent}%)`}
              </span>
              <span style={{ color: "var(--uidai-pmis-muted)" }} title={wordsHint(oneTimePending)}>
                Pending {inr(oneTimePending)}
                {oneTimePendingPercent > 0 && ` (${oneTimePendingPercent}%)`}
              </span>
            </div>
          )}
        </div>
        <div style={rowStyle}>
          <span style={muted}>Recurring Cost</span>
          <strong style={{ color: "#173e77" }} title={wordsHint(recurring)}>
            {inr(recurring)}
          </strong>
        </div>
        <div style={{
          display: "flex", flexDirection: "column", alignItems: "center", gap: 4,
          marginTop: 6, padding: "12px 14px",
          background: "linear-gradient(135deg, var(--uidai-pmis-navy), var(--uidai-pmis-cyan))",
          color: "#fff",
          borderRadius: 10,
          boxShadow: "0 4px 10px rgba(23, 62, 119, 0.18)",
        }}>
          <span style={{ fontSize: 11, opacity: 0.9, letterSpacing: 0.5, textTransform: "uppercase" }}>
            Total Contract Cost
          </span>
          <strong style={{ fontSize: 18, color: "#fff" }} title={wordsHint(total)}>
            {inr(total)}
          </strong>
        </div>
      </div>
    </div>
  );
}

/* Cost-type options come entirely from the master list now — including
   resource_cost and transaction_cost, which the backend added to the
   catalog (no more frontend-side static extras). Falls back to a lone
   "Fixed" entry only while the master list is still loading. */
function buildCostTypeOptions(costTypes) {
  return Array.isArray(costTypes) && costTypes.length
    ? costTypes
    : [{ code: "fixed", name: "Fixed" }];
}

/* Validate a cost-row draft and build the POST/PATCH body. one_time is a
   standalone amount; fixed / resource_cost / transaction_cost all carry a
   phase + ≥1 milestone. transaction_cost's value is perTransactionCost ×
   plannedTransactions; resource/transaction also carry a lineLabel. Tax is
   sent as taxPercent (% mode) or taxAmount (₹ mode). Returns { error } or
   { body }. */
function buildCostItemBody(draft) {
  const isTxn = draft.costTypeCode === "transaction_cost";
  const isOne = draft.costTypeCode === "one_time";
  if (isTxn) {
    if (draft.perTransactionCost === "" || draft.plannedTransactions === "") {
      return { error: "Enter both Per-Transaction Cost and Planned Transactions." };
    }
  } else if (draft.cost === "") {
    return { error: "Enter the Cost." };
  }
  if (!isOne && (!Array.isArray(draft.milestoneIds) || draft.milestoneIds.length === 0)) {
    return { error: "Pick at least one milestone for this cost row." };
  }
  const taxField = draft.taxMode === "percent"
    ? { taxPercent: Number(draft.taxAmount) }
    : { taxAmount: Number(draft.taxAmount) };
  if (isOne) {
    return { body: { costTypeCode: "one_time", cost: Number(draft.cost), ...taxField } };
  }
  const amountFields = isTxn
    ? {
        perTransactionCost: Number(draft.perTransactionCost),
        plannedTransactions: Number(draft.plannedTransactions),
      }
    : { cost: Number(draft.cost) };
  const labelField = (isTxn || draft.costTypeCode === "resource_cost")
    ? { lineLabel: (draft.lineLabel || "").trim() }
    : {};
  return {
    body: {
      costTypeCode: draft.costTypeCode,
      phase: draft.phase || "default",
      ...amountFields,
      ...labelField,
      ...taxField,
      milestoneIds: draft.milestoneIds,
    },
  };
}

/* ──────────────────────────────────────────────────────────────────
   Add Cost Item modal — replaces the previous inline form. Renders
   into the standard `.uidai-modal` shell so it inherits the project's
   navy→cyan stripe, dimming overlay, and width treatment.
   ────────────────────────────────────────────────────────────────── */
function AddCostItemModal({
  open, onClose, onSubmit, submitting,
  costTypes, milestones, hasOneTime, disabledMilestoneIds,
}) {
  const [draft, setDraft] = useState(() => ({
    costTypeCode: "fixed", phase: "", cost: "", taxAmount: "", taxMode: "amount", milestoneIds: [],
    lineLabel: "", perTransactionCost: "", plannedTransactions: "",
  }));

  if (!open) return null;
  /* Only one_time is a standalone amount row (no phase, no milestones).
     fixed, resource_cost and transaction_cost all carry phase +
     milestones, so those fields show for everything except one_time. */
  const isOneTime = draft.costTypeCode === "one_time";
  /* resource_cost / transaction_cost are first-class lines like fixed: they
     carry a phase + milestones and a display label. transaction_cost's value
     is perTransactionCost × plannedTransactions instead of a single cost. */
  const isTxn = draft.costTypeCode === "transaction_cost";
  const isResource = draft.costTypeCode === "resource_cost";
  const showLabel = isTxn || isResource;

  return (
    <div className="uidai-modal" role="dialog" aria-modal="true">
      <div className="uidai-modal__box">
        <button
          type="button"
          aria-label="Close"
          onClick={onClose}
          style={{
            position: "absolute", top: 8, right: 10, width: 28, height: 28,
            border: "none", background: "transparent", fontSize: 22, lineHeight: 1,
            cursor: "pointer", color: "#666", padding: 0,
          }}
        >
          ×
        </button>
        <h3 className="uidai-modal__title">Add Cost Item</h3>
        <div className="uidai-pmis-subtitle" style={{ margin: "4px 0 16px" }}>
          Pick a cost type, enter the amount and tax %, then attach milestones for Fixed rows.
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 14 }}>
          <div className="uidai-pmis-field" style={{ marginBottom: 0 }}>
            <label>Cost Type</label>
            <select
              value={draft.costTypeCode}
              onChange={(e) => {
                const next = e.target.value;
                setDraft((d) => ({
                  ...d,
                  costTypeCode: next,
                  phase: next === "one_time" ? "" : d.phase,
                  milestoneIds: next === "one_time" ? [] : d.milestoneIds,
                }));
              }}
            >
              {buildCostTypeOptions(costTypes).map((c) => (
                <option key={c.code} value={c.code}>{c.name}</option>
              ))}
            </select>
          </div>
          <div className="uidai-pmis-field" style={{ marginBottom: 0 }}>
            <label>Phase</label>
            {isOneTime ? (
              <input value="" disabled placeholder="—" />
            ) : (
              <input
                type="text"
                value={draft.phase}
                placeholder="Phase"
                onChange={(e) => setDraft((d) => ({ ...d, phase: e.target.value }))}
              />
            )}
          </div>
          {isTxn ? (
            <>
              <div className="uidai-pmis-field" style={{ marginBottom: 0 }}>
                <label>Per-Transaction Cost (₹)</label>
                <input
                  type="number"
                  min="0"
                  value={draft.perTransactionCost}
                  onChange={(e) => setDraft((d) => ({ ...d, perTransactionCost: e.target.value }))}
                />
              </div>
              <div className="uidai-pmis-field" style={{ marginBottom: 0 }}>
                <label>Planned Transactions</label>
                <input
                  type="number"
                  min="0"
                  value={draft.plannedTransactions}
                  onChange={(e) => setDraft((d) => ({ ...d, plannedTransactions: e.target.value }))}
                />
                {draft.perTransactionCost !== "" && draft.plannedTransactions !== "" && (
                  <small style={{ color: "var(--uidai-pmis-muted)", fontSize: 11 }}>
                    Total: {inr((Number(draft.perTransactionCost) || 0) * (Number(draft.plannedTransactions) || 0))}
                  </small>
                )}
              </div>
            </>
          ) : (
            <div className="uidai-pmis-field" style={{ marginBottom: 0 }}>
              <label>Cost (₹)</label>
              <input
                type="number"
                min="0"
                value={draft.cost}
                onChange={(e) => setDraft((d) => ({ ...d, cost: e.target.value }))}
              />
              {draft.cost !== "" && wordsHint(draft.cost) && (
                <small style={{ color: "var(--uidai-pmis-muted)", fontSize: 11 }}>{wordsHint(draft.cost)}</small>
              )}
            </div>
          )}
        </div>

        {showLabel && (
          <div className="uidai-pmis-field" style={{ marginBottom: 0, marginTop: 14 }}>
            <label>Line Label</label>
            <input
              type="text"
              value={draft.lineLabel}
              placeholder="e.g. On-site engineer, Gateway fees"
              onChange={(e) => setDraft((d) => ({ ...d, lineLabel: e.target.value }))}
            />
          </div>
        )}

        <div style={{ display: "grid", gridTemplateColumns: "minmax(120px, 200px) minmax(0, 1fr)", gap: 14, marginTop: 14 }}>
          <div className="uidai-pmis-field" style={{ marginBottom: 0 }}>
            <label>Tax {draft.taxMode === "percent" ? "(%)" : "(₹)"}</label>
            <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
              <button type="button" style={segStyle(draft.taxMode !== "percent")}
                onClick={() => setDraft((d) => ({ ...d, taxMode: "amount" }))}>₹</button>
              <button type="button" style={segStyle(draft.taxMode === "percent")}
                onClick={() => setDraft((d) => ({ ...d, taxMode: "percent" }))}>%</button>
              <input
                type="number"
                min="0"
                value={draft.taxAmount}
                placeholder={draft.taxMode === "percent" ? "% of cost" : "₹ amount"}
                onChange={(e) => setDraft((d) => ({ ...d, taxAmount: e.target.value }))}
                style={{ flex: 1 }}
              />
            </div>
            {draft.taxAmount !== "" && (
              <small style={{ color: "var(--uidai-pmis-muted)", fontSize: 11 }}>
                {draft.taxMode === "percent"
                  ? (() => {
                      const amt = ((Number(draft.cost) || 0) * (Number(draft.taxAmount) || 0)) / 100;
                      return `= ${inr(amt)}${wordsHint(amt) ? ` · ${wordsHint(amt)}` : ""}`;
                    })()
                  : wordsHint(draft.taxAmount)}
              </small>
            )}
          </div>
          <div className="uidai-pmis-field" style={{ marginBottom: 0 }}>
            <label>Milestones</label>
            {isOneTime ? (
              <input value="" disabled placeholder="—" />
            ) : (
              <MilestoneMultiSelect
                value={draft.milestoneIds}
                options={milestones}
                disabledIds={disabledMilestoneIds}
                onChange={(next) => setDraft((d) => ({ ...d, milestoneIds: next }))}
              />
            )}
          </div>
        </div>

        <div className="uidai-modal__actions" style={{ justifyContent: "flex-end" }}>
          <button
            type="button"
            className="uidai-pmis-btn uidai-pmis-btn-cancel uidai-pmis-btn-small"
            onClick={onClose}
            disabled={submitting}
          >
            Cancel
          </button>
          <button
            type="button"
            className="uidai-pmis-btn uidai-pmis-btn-small"
            style={{ marginTop: 0 }}
            disabled={submitting || (isTxn ? (!draft.perTransactionCost || !draft.plannedTransactions) : !draft.cost)}
            onClick={() => onSubmit(draft, hasOneTime)}
          >
            {submitting ? "Adding…" : "Save Cost Item"}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ──────────────────────────────────────────────────────────────────
   Edit Cost Item modal — opens when a Project Cost row's pencil
   button is clicked. Same field layout as AddCostItemModal, but
   pre-populated with the row's current values and routed through the
   PATCH /cost-items/{id} endpoint. The milestone picker excludes
   "USED" milestones from OTHER rows (this row's own milestones stay
   selectable so the user can keep or replace them).
   ────────────────────────────────────────────────────────────────── */
function EditCostItemModal({
  open, onClose, onSubmit, submitting,
  costTypes, milestones, row, usedMilestoneIds,
}) {
  const [draft, setDraft] = useState({
    costTypeCode: "fixed", phase: "", cost: "", taxAmount: "", taxMode: "amount", milestoneIds: [],
    lineLabel: "", perTransactionCost: "", plannedTransactions: "",
  });

  useEffect(() => {
    if (!open || !row) return;
    const timeout = setTimeout(() => {
      const isOne = row.costTypeCode === "one_time";
      /* Seed the tax input in whichever unit the row was saved with — percent
         if a taxPercent is present, otherwise the rupee taxAmount. */
      const usePercent = row.taxPercent != null;
      const taxSeed = usePercent
        ? String(row.taxPercent)
        : (row.taxAmount != null ? String(row.taxAmount) : "");
      setDraft({
        costTypeCode: row.costTypeCode || "fixed",
        phase: isOne ? "" : (row.phase ?? ""),
        cost: row.cost != null ? String(row.cost) : "",
        taxAmount: taxSeed,
        taxMode: usePercent ? "percent" : "amount",
        milestoneIds: !isOne && Array.isArray(row.milestoneIds) ? row.milestoneIds.slice() : [],
        lineLabel: row.lineLabel || "",
        perTransactionCost: row.perTransactionCost != null ? String(row.perTransactionCost) : "",
        plannedTransactions: row.plannedTransactions != null ? String(row.plannedTransactions) : "",
      });
    }, 0);
    return () => clearTimeout(timeout);
  }, [open, row]);

  /* Disable milestones used by other cost rows — but keep THIS row's
     own milestones selectable so the user can leave them in place or
     swap them out. */
  const lockedIds = useMemo(() => {
    if (!usedMilestoneIds) return new Set();
    const own = new Set((row && row.milestoneIds) || []);
    const out = new Set();
    usedMilestoneIds.forEach((id) => { if (!own.has(id)) out.add(id); });
    return out;
  }, [usedMilestoneIds, row]);

  if (!open || !row) return null;
  const isOneTime = draft.costTypeCode === "one_time";
  /* resource_cost / transaction_cost are first-class lines like fixed: they
     carry a phase + milestones and a display label. transaction_cost's value
     is perTransactionCost × plannedTransactions instead of a single cost. */
  const isTxn = draft.costTypeCode === "transaction_cost";
  const isResource = draft.costTypeCode === "resource_cost";
  const showLabel = isTxn || isResource;

  return (
    <div className="uidai-modal" role="dialog" aria-modal="true">
      <div className="uidai-modal__box">
        <button
          type="button"
          aria-label="Close"
          onClick={onClose}
          style={{
            position: "absolute", top: 8, right: 10, width: 28, height: 28,
            border: "none", background: "transparent", fontSize: 22, lineHeight: 1,
            cursor: "pointer", color: "#666", padding: 0,
          }}
        >
          ×
        </button>
        <h3 className="uidai-modal__title">Edit Cost Item</h3>
        <div className="uidai-pmis-subtitle" style={{ margin: "4px 0 16px" }}>
          Update the cost row's amount, phase, tax, or milestones.
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 14 }}>
          <div className="uidai-pmis-field" style={{ marginBottom: 0 }}>
            <label>Cost Type</label>
            <select
              value={draft.costTypeCode}
              onChange={(e) => {
                const next = e.target.value;
                setDraft((d) => ({
                  ...d,
                  costTypeCode: next,
                  phase: next === "one_time" ? "" : d.phase,
                  milestoneIds: next === "one_time" ? [] : d.milestoneIds,
                }));
              }}
            >
              {buildCostTypeOptions(costTypes).map((c) => (
                <option key={c.code} value={c.code}>{c.name}</option>
              ))}
            </select>
          </div>
          <div className="uidai-pmis-field" style={{ marginBottom: 0 }}>
            <label>Phase</label>
            {isOneTime ? (
              <input value="" disabled placeholder="—" />
            ) : (
              <input
                type="text"
                value={draft.phase}
                placeholder="Phase"
                onChange={(e) => setDraft((d) => ({ ...d, phase: e.target.value }))}
              />
            )}
          </div>
          {isTxn ? (
            <>
              <div className="uidai-pmis-field" style={{ marginBottom: 0 }}>
                <label>Per-Transaction Cost (₹)</label>
                <input
                  type="number"
                  min="0"
                  value={draft.perTransactionCost}
                  onChange={(e) => setDraft((d) => ({ ...d, perTransactionCost: e.target.value }))}
                />
              </div>
              <div className="uidai-pmis-field" style={{ marginBottom: 0 }}>
                <label>Planned Transactions</label>
                <input
                  type="number"
                  min="0"
                  value={draft.plannedTransactions}
                  onChange={(e) => setDraft((d) => ({ ...d, plannedTransactions: e.target.value }))}
                />
                {draft.perTransactionCost !== "" && draft.plannedTransactions !== "" && (
                  <small style={{ color: "var(--uidai-pmis-muted)", fontSize: 11 }}>
                    Total: {inr((Number(draft.perTransactionCost) || 0) * (Number(draft.plannedTransactions) || 0))}
                  </small>
                )}
              </div>
            </>
          ) : (
            <div className="uidai-pmis-field" style={{ marginBottom: 0 }}>
              <label>Cost (₹)</label>
              <input
                type="number"
                min="0"
                value={draft.cost}
                onChange={(e) => setDraft((d) => ({ ...d, cost: e.target.value }))}
              />
              {draft.cost !== "" && wordsHint(draft.cost) && (
                <small style={{ color: "var(--uidai-pmis-muted)", fontSize: 11 }}>{wordsHint(draft.cost)}</small>
              )}
            </div>
          )}
        </div>

        {showLabel && (
          <div className="uidai-pmis-field" style={{ marginBottom: 0, marginTop: 14 }}>
            <label>Line Label</label>
            <input
              type="text"
              value={draft.lineLabel}
              placeholder="e.g. On-site engineer, Gateway fees"
              onChange={(e) => setDraft((d) => ({ ...d, lineLabel: e.target.value }))}
            />
          </div>
        )}

        <div style={{ display: "grid", gridTemplateColumns: "minmax(120px, 200px) minmax(0, 1fr)", gap: 14, marginTop: 14 }}>
          <div className="uidai-pmis-field" style={{ marginBottom: 0 }}>
            <label>Tax {draft.taxMode === "percent" ? "(%)" : "(₹)"}</label>
            <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
              <button type="button" style={segStyle(draft.taxMode !== "percent")}
                onClick={() => setDraft((d) => ({ ...d, taxMode: "amount" }))}>₹</button>
              <button type="button" style={segStyle(draft.taxMode === "percent")}
                onClick={() => setDraft((d) => ({ ...d, taxMode: "percent" }))}>%</button>
              <input
                type="number"
                min="0"
                value={draft.taxAmount}
                placeholder={draft.taxMode === "percent" ? "% of cost" : "₹ amount"}
                onChange={(e) => setDraft((d) => ({ ...d, taxAmount: e.target.value }))}
                style={{ flex: 1 }}
              />
            </div>
            {draft.taxAmount !== "" && (
              <small style={{ color: "var(--uidai-pmis-muted)", fontSize: 11 }}>
                {draft.taxMode === "percent"
                  ? (() => {
                      const amt = ((Number(draft.cost) || 0) * (Number(draft.taxAmount) || 0)) / 100;
                      return `= ${inr(amt)}${wordsHint(amt) ? ` · ${wordsHint(amt)}` : ""}`;
                    })()
                  : wordsHint(draft.taxAmount)}
              </small>
            )}
          </div>
          <div className="uidai-pmis-field" style={{ marginBottom: 0 }}>
            <label>Milestones</label>
            {isOneTime ? (
              <input value="" disabled placeholder="—" />
            ) : (
              <MilestoneMultiSelect
                value={draft.milestoneIds}
                options={milestones}
                disabledIds={lockedIds}
                onChange={(next) => setDraft((d) => ({ ...d, milestoneIds: next }))}
              />
            )}
          </div>
        </div>

        <div className="uidai-modal__actions" style={{ justifyContent: "flex-end" }}>
          <button
            type="button"
            className="uidai-pmis-btn uidai-pmis-btn-cancel uidai-pmis-btn-small"
            onClick={onClose}
            disabled={submitting}
          >
            Cancel
          </button>
          <button
            type="button"
            className="uidai-pmis-btn uidai-pmis-btn-small"
            style={{ marginTop: 0 }}
            disabled={submitting}
            onClick={() => onSubmit(draft)}
          >
            {submitting ? "Saving…" : "Save Changes"}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ──────────────────────────────────────────────────────────────────
   CostItemActions — pencil + trash icon buttons rendered in the
   Action column of the Project Cost table.
   ────────────────────────────────────────────────────────────────── */
function CostItemActions({  isLocked, isDeleting, onEdit, onDelete }) {
  return (
    <div style={{ display: "inline-flex", gap: 6 }}>
      <button
        type="button"
        className="uidai-pmis-iconbtn"
        title="Edit cost item"
        aria-label="Edit cost item"
        disabled={isLocked || isDeleting}
        onClick={onEdit}
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none"
          stroke="currentColor" strokeWidth="2"
          strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M12 20h9" />
          <path d="M16.5 3.5a2.121 2.121 0 1 1 3 3L7 19l-4 1 1-4 12.5-12.5z" />
        </svg>
      </button>
      <button
        type="button"
        className="uidai-pmis-iconbtn is-danger"
        title="Delete cost item"
        aria-label="Delete cost item"
        disabled={isLocked || isDeleting}
        onClick={onDelete}
      >
        {isDeleting ? (
          <span style={{ fontSize: 11, fontWeight: 700 }}>…</span>
        ) : (
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none"
            stroke="currentColor" strokeWidth="2"
            strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <polyline points="3 6 5 6 21 6" />
            <path d="M19 6l-2 14H7L5 6" />
            <path d="M10 11v6" />
            <path d="M14 11v6" />
            <path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" />
          </svg>
        )}
      </button>
    </div>
  );
}

/* ──────────────────────────────────────────────────────────────────
   Edit Payment Term modal — opens when a term row's Edit button is
   clicked. Start/End dates and Cycle are read-only (managed at the
   phase level via Apply Frequency); % of Payment and LD Basis % are
   editable. Save PATCHes the term and the parent silently re-loads.

   The two percentages are different things:
     % of Payment — what this milestone is PAID this phase.
     LD Basis %   — the milestone's allotment (its full share of the
                    phase) and the base penalties / LD are computed on.
   A milestone may be paid LESS than its LD Basis % (the remainder
   carries forward) but never MORE — it is still penalised on the full
   allotment either way. Blank LD Basis % = the even split.
   ────────────────────────────────────────────────────────────────── */
function EditTermModal({
  open, onClose, term, onSubmit, submitting, milestoneName,
}) {
  const [percentOfPayment, setPercentOfPayment] = useState(
    term?.percentOfPayment === null || term?.percentOfPayment === undefined
      ? ""
      : String(term?.percentOfPayment || "")
  );
  const [ldBasisPercent, setLdBasisPercent] = useState(
    term?.ldBasisPercent === null || term?.ldBasisPercent === undefined
      ? ""
      : String(term.ldBasisPercent)
  );

  if (!open || !term) return null;

  /* Client-side mirror of the backend's `pay-le-basis` check, shown inline so
     the user sees the problem before saving rather than as a Validate error. */
  const payNum = percentOfPayment === "" ? null : Number(percentOfPayment);
  const basisNum = ldBasisPercent === "" ? Number(term.ldBasisPercent) : Number(ldBasisPercent);
  const payOverBasis =
    payNum != null && Number.isFinite(payNum) &&
    Number.isFinite(basisNum) && basisNum > 0 &&
    payNum - basisNum > 0.001;

  return (
    <div className="uidai-modal" role="dialog" aria-modal="true">
      <div className="uidai-modal__box" style={{ width: "min(520px, 100%)" }}>
        <button
          type="button"
          aria-label="Close"
          onClick={onClose}
          style={{
            position: "absolute", top: 8, right: 10, width: 28, height: 28,
            border: "none", background: "transparent", fontSize: 22, lineHeight: 1,
            cursor: "pointer", color: "#666", padding: 0,
          }}
        >
          ×
        </button>
        <h3 className="uidai-modal__title">Edit Payment Term</h3>
        <div className="uidai-pmis-subtitle" style={{ margin: "4px 0 16px" }}>
          Phase <strong style={{ color: "#173e77" }}>{term.phase}</strong>
          {" · "}
          Milestone <strong style={{ color: "#173e77" }}>{milestoneName(term.milestoneId)}</strong>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
          <div className="uidai-pmis-field" style={{ marginBottom: 0 }}>
            <label>Start Date</label>
            <input type="text" value={fmtDMY(term.startDate)} disabled title="Set via Apply Frequency" />
          </div>
          <div className="uidai-pmis-field" style={{ marginBottom: 0 }}>
            <label>End Date</label>
            <input type="text" value={fmtDMY(term.endDate)} disabled title="Set via Apply Frequency" />
          </div>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14, marginTop: 14 }}>
          <div className="uidai-pmis-field" style={{ marginBottom: 0 }}>
            <label>% of Payment</label>
            <input
              type="number"
              min="0" max="100"
              value={percentOfPayment}
              onChange={(e) => setPercentOfPayment(e.target.value)}
            />
          </div>
          <div className="uidai-pmis-field" style={{ marginBottom: 0 }}>
            <label>LD Basis %</label>
            <input
              type="number"
              min="0" max="100" step="0.01"
              placeholder={term.ldBasisPercent == null ? "Even split" : String(term.ldBasisPercent)}
              value={ldBasisPercent}
              onChange={(e) => setLdBasisPercent(e.target.value)}
              title="The milestone's allotment — penalties / LD are calculated on this %"
            />
            <div className="uidai-pmis-subtitle" style={{ fontSize: 10.5, marginTop: 4 }}>
              Penalty base. Blank = even split. Must total 100% per phase.
            </div>
          </div>
        </div>

        <div className="uidai-pmis-field" style={{ marginTop: 14, marginBottom: 0 }}>
          <label>Interval</label>
          <input
            type="text"
            value={term.cycleCount == null ? "" : String(term.cycleCount)}
            disabled
            title="Set via Apply Frequency"
          />
        </div>

        {payOverBasis && (
          <div className="uidai-pmis-chip is-bad" style={{ marginTop: 14, borderRadius: 8 }}>
            <span aria-hidden="true">⚠</span>
            % of Payment ({payNum}%) cannot exceed LD Basis % ({basisNum}%).
          </div>
        )}

        <div className="uidai-modal__actions" style={{ justifyContent: "flex-end" }}>
          <button
            type="button"
            className="uidai-pmis-btn uidai-pmis-btn-cancel uidai-pmis-btn-small"
            onClick={onClose}
            disabled={submitting}
          >
            Cancel
          </button>
          <button
            type="button"
            className="uidai-pmis-btn uidai-pmis-btn-small"
            style={{ marginTop: 0 }}
            disabled={submitting || payOverBasis}
            onClick={() => onSubmit({
              percentOfPayment:
                percentOfPayment === "" || percentOfPayment === null
                  ? null
                  : Number(percentOfPayment),
              /* Blank means "leave it to the even split" — send null so the
                 backend clears any explicit override instead of storing 0. */
              ldBasisPercent:
                ldBasisPercent === "" || ldBasisPercent === null
                  ? null
                  : Number(ldBasisPercent),
            })}
          >
            {submitting ? "Saving…" : "Save"}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ──────────────────────────────────────────────────────────────────
   LdBasisCell — the editable "LD Basis %" cell on a payment-term row.

   `term.ldBasisPercent` is always the EFFECTIVE value (the backend fills in
   the even split, 100 / milestones-in-phase, when it was never set), so the
   input is seeded from it and clearing the box means "go back to the even
   split" (committed as null). `term.ldBasisValue` is the ₹ penalty base the
   backend derived from it and is shown read-only underneath.

   The edit commits on blur or Enter and only when the value actually changed;
   Escape restores the server value.
   ────────────────────────────────────────────────────────────────── */
function LdBasisCell({ term, disabled, busy, onSave }) {
  const server = term.ldBasisPercent == null ? "" : String(term.ldBasisPercent);
  /* null = not editing, so the cell renders the server value and a silent
     reload flows straight through. A string is the user's in-progress edit.
     Committing (or abandoning) drops back to null = server truth. */
  const [draft, setDraft] = useState(null);
  const shown = draft == null ? server : draft;

  const commit = async () => {
    if (draft == null) return;
    const raw = draft.trim();
    const next = raw === "" ? null : Number(raw);
    setDraft(null);
    if (next != null && !Number.isFinite(next)) return;
    if (String(next ?? "") === server) return;
    await onSave(term, next);
  };

  const value = Number(term.ldBasisValue);
  const overpaid = (Number(term.percentOfPayment) || 0) - (Number(term.ldBasisPercent) || 0) > 0.001;

  return (
    <td style={{ textAlign: "right" }}>
      <input
        type="number"
        min="0" max="100" step="0.01"
        value={shown}
        placeholder="Even split"
        disabled={disabled || busy}
        title={
          overpaid
            ? "This milestone is paid more than its LD Basis % — not allowed"
            : "The milestone's allotment. Penalties / LD are calculated on this %."
        }
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") e.currentTarget.blur();
          else if (e.key === "Escape") setDraft(null);
        }}
        style={{
          width: 78, textAlign: "right", padding: "3px 6px",
          border: `1px solid ${overpaid ? "#d32f2f" : "#cfe0f5"}`,
          borderRadius: 6, fontSize: 12.5, fontWeight: 700,
          color: overpaid ? "#b3261e" : "#173e77",
          background: disabled ? "#f5f6f8" : "#fff",
        }}
      />
      {Number.isFinite(value) && value > 0 && (
        <div style={{ fontSize: 10.5, color: "var(--uidai-pmis-muted)", marginTop: 2 }} title={wordsHint(value)}>
          {inr(value)}
        </div>
      )}
    </td>
  );
}

/* ──────────────────────────────────────────────────────────────────
   StructureWarningModal — a deliberate "review before you proceed" gate
   shown before editing OR deleting a Project Cost row. Both actions force
   the backend to recompute the whole payment structure (phase totals,
   every term's % + value, carry-forward), so this makes the blast radius
   explicit before the user commits.
   ────────────────────────────────────────────────────────────────── */
function StructureWarningModal({ open, action, rowLabel, onCancel, onProceed }) {
  if (!open) return null;
  const isDelete = action === "delete";
  return (
    <div className="uidai-modal" role="dialog" aria-modal="true">
      <div className="uidai-modal__box" style={{ width: "min(520px, 100%)" }}>
        <button
          type="button"
          aria-label="Close"
          onClick={onCancel}
          style={{
            position: "absolute", top: 8, right: 10, width: 28, height: 28,
            border: "none", background: "transparent", fontSize: 22, lineHeight: 1,
            cursor: "pointer", color: "#666", padding: 0,
          }}
        >
          ×
        </button>

        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10 }}>
          <span aria-hidden="true" style={{
            width: 34, height: 34, flex: "0 0 auto",
            display: "inline-flex", alignItems: "center", justifyContent: "center",
            borderRadius: "50%", background: "#fdecec", color: "#c0392b",
            fontSize: 20, fontWeight: 800,
          }}>
            ⚠
          </span>
          <h3 className="uidai-modal__title" style={{ margin: 0 }}>
            Review before you proceed
          </h3>
        </div>

        <div style={{ fontSize: 13.5, color: "var(--uidai-pmis-text)", lineHeight: 1.6 }}>
          You're about to <strong>{isDelete ? "delete" : "edit"}</strong>
          {rowLabel ? <> <strong style={{ color: "#173e77" }}>{rowLabel}</strong></> : " this cost item"}.
          <div style={{
            marginTop: 10, padding: "10px 12px", borderRadius: 8,
            background: "#fff7ed", border: "1px solid #f3d4a8", color: "#9a5b00",
          }}>
            This changes the <strong>entire payment structure</strong>. Phase totals,
            every payment term's % and value, the activity-wise split, and any
            carry-forward distribution will be <strong>recalculated</strong>
            {isDelete && <> — and a delete <strong>cannot be undone</strong></>}.
            Please review the impact before continuing.
          </div>
        </div>

        <div className="uidai-modal__actions" style={{ justifyContent: "flex-end" }}>
          <button
            type="button"
            className="uidai-pmis-btn uidai-pmis-btn-cancel uidai-pmis-btn-small"
            onClick={onCancel}
          >
            Cancel
          </button>
          <button
            type="button"
            className="uidai-pmis-btn uidai-pmis-btn-small"
            style={{
              marginTop: 0,
              ...(isDelete ? { background: "#c0392b", borderColor: "#c0392b" } : {}),
            }}
            onClick={onProceed}
          >
            {isDelete ? "Proceed & Delete" : "Proceed to Edit"}
          </button>
        </div>
      </div>
    </div>
  );
}

export default function ProjectFinancePage() {
  const { projectId } = useParams();
  const navigate = useNavigate();
  const project = useProject(projectId);

  /* Organizations (vendors) assigned to this project — drive the tab bar.
     Prefer the hydrated store project; fall back to a direct fetch when the
     store isn't populated (e.g. a hard refresh landing on the finance page). */
  const [fetchedVendors, setFetchedVendors] = useState([]);
  const orgs = useMemo(() => {
    const raw =
      Array.isArray(project?.vendors) && project.vendors.length
        ? project.vendors
        : fetchedVendors;
    const names = (Array.isArray(raw) ? raw : [])
      .map((v) => (typeof v === "string" ? v : (v && (v.name || v.label || v.id)) || ""))
      .filter(Boolean);
    return Array.from(new Set(names));
  }, [project, fetchedVendors]);
  const [activeOrg, setActiveOrg] = useState(0);
  useEffect(() => {
    if (orgs.length > 0 && activeOrg > orgs.length - 1) setActiveOrg(0);
  }, [orgs.length, activeOrg]);
  useEffect(() => {
    if (!projectId) return;
    if (Array.isArray(project?.vendors) && project.vendors.length) return;
    let cancelled = false;
    getProjectById(projectId)
      .then((p) => {
        if (!cancelled) setFetchedVendors(Array.isArray(p?.vendors) ? p.vendors : []);
      })
      .catch(() => { /* tabs just stay hidden if this fails */ });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId, project]);

  // ── Master data ──
  const [costTypes, setCostTypes] = useState([]);
  const [frequencies, setFrequencies] = useState([]);
  const [milestones, setMilestones] = useState([]);
  /* Carry-forward methods (8) — { code, name, method, variant, position }.
     Drives the per-phase carry-forward method picker. */
  const [carryMethods, setCarryMethods] = useState([]);

  // ── Live payment-page state (single source of truth) ──
  const [page, setPage] = useState(null);
  const [pageLoading, setPageLoading] = useState(false);
  const [pageError, setPageError] = useState("");
  const [showValidateModal, setShowValidateModal] = useState(false);
  const [validationLoading, setValidationLoading] = useState(false);
  const [validationResult, setValidationResult] = useState(null);
  const [validationError, setValidationError] = useState("");

  // ── Add Cost modal ──
  const [showAddModal, setShowAddModal] = useState(false);
  const [addingRow, setAddingRow] = useState(false);

  // ── Edit Cost Item modal ──
  const [editingCostItem, setEditingCostItem] = useState(null);
  const [savingCostItem, setSavingCostItem] = useState(false);

  // ── Per-row delete busy state (keyed by cost-item id) ──
  const [deletingCostItemId, setDeletingCostItemId] = useState("");

  // ── "Affects the whole structure" gate before a cost-row edit/delete.
  //    { action: 'edit' | 'delete', row } while pending, else null. ──
  const [structureWarn, setStructureWarn] = useState(null);

  // ── Edit Payment Term modal ──
  const [editingTerm, setEditingTerm] = useState(null);
  const [savingTerm, setSavingTerm] = useState(false);

  // ── CCN cap edit buffer ──
  const [ccnInput, setCcnInput] = useState("");
  const [ccnSaving, setCcnSaving] = useState(false);
  // Additional cost type: ccn | qgr | aqp. Drives which input shows below.
  const [additionalCostType, setAdditionalCostType] = useState("ccn");
  // Value buffer for the QGR / AQP variants (CCN uses ccnInput above).
  const [additionalValue, setAdditionalValue] = useState("");

  // ── Carry-forward mutation guard — blocks concurrent PUTs while the
  //    page reload is in flight. ──
  const [carrySaving, setCarrySaving] = useState(false);

  // ── Edit per-activity split modal (partial-payment terms) ──
  const [editingActivitiesTerm, setEditingActivitiesTerm] = useState(null);
  const [savingActivities, setSavingActivities] = useState(false);

  // ── Right-column summary collapse ──
  /* Collapse the summary column "to the side" — the left content goes
     full-width and the panel shrinks to a thin vertical rail with an expand
     arrow. The collapse/expand control is a vertically-centered handle on
     the panel's edge. */
  const [summaryCollapsed, setSummaryCollapsed] = useState(true);
  /* Payment Terms: phases render as tabs (like the org tabs at the top);
     only the selected phase's panel is shown. */
  const [activePhaseIdx, setActivePhaseIdx] = useState(0);
  /* Guards the one-time-distribution PUT while the page reload is in flight. */
  const [oneTimeSaving, setOneTimeSaving] = useState(false);

  function handleAuthError(err) {
    if (err && err.isAuth) {
      uiStore.showError(err.message);
      navigate("/login");
      return true;
    }
    return false;
  }

  // ── Loaders ──────────────────────────────────────────────────────
  async function loadCostTypes() {
    try {
      const res = await authorizedFetch(`${API_BASE}${ENDPOINTS.master.costTypes}`);
      const payload = await readJson(res);
      const list = extractElements(payload)
        .filter((c) => c && c.active !== false)
        .map((c) => ({ code: c.code, name: c.name, active: c.active }));
      setCostTypes(list);
    } catch (err) {
      if (handleAuthError(err)) return;
      uiStore.showError(err?.message || "Failed to load cost types");
    }
  }

  async function loadFrequencies() {
    try {
      const res = await authorizedFetch(`${API_BASE}${ENDPOINTS.master.frequencies}`);
      const payload = await readJson(res);
      const list = extractElements(payload)
        .filter((c) => c && c.active !== false)
        .map((c) => ({ code: c.code, name: c.name, active: c.active }));
      setFrequencies(list);
    } catch (err) {
      if (handleAuthError(err)) return;
      uiStore.showError(err?.message || "Failed to load frequencies");
    }
  }

  async function loadCarryForwardMethods() {
    try {
      const res = await authorizedFetch(`${API_BASE}${ENDPOINTS.master.carryForwardMethods}`);
      const payload = await readJson(res);
      const list = extractElements(payload)
        .filter((m) => m && m.code && m.active !== false)
        .map((m) => ({
          code: m.code,
          name: m.name || m.code,
          method: m.method || "",      // phase | milestone | time
          variant: m.variant || "",    // evenly | custom (time variants vary)
          position: typeof m.position === "number" ? m.position : 0,
        }))
        .sort((a, b) => a.position - b.position);
      setCarryMethods(list);
    } catch (err) {
      if (handleAuthError(err)) return;
      uiStore.showError(err?.message || "Failed to load carry-forward methods");
    }
  }

  async function loadMilestones() {
    if (!projectId) return;
    try {
      const res = await authorizedFetch(
        `${API_BASE}${ENDPOINTS.projects.milestones(projectId)}?offset=1&pageSize=100&includeDeleted=false`,
      );
      const payload = await readJson(res);
      const list = extractElements(payload)
        .filter((m) => m && m.id)
        .map((m) => ({
          id: m.id,
          name: m.name || m.title || m.id,
          status: fromApiNodeStatus(m.status),
          /* Payment type from the payment-types master (partial_payment |
             complete_payment; nullable) — drives whether the activity
             list shows for the milestone's payment terms. */
          paymentType: m.paymentType || "",
        }));
      setMilestones(list);
    } catch (err) {
      if (handleAuthError(err)) return;
      // eslint-disable-next-line no-console
      console.warn("Failed to load milestones for finance page:", err?.message);
    }
  }

  async function loadValidationResult({ silent = false } = {}) {
    if (!projectId) return;
    if (!silent) {
      setValidationLoading(true);
      setValidationError("");
    }
    try {
      const res = await authorizedFetch(`${API_BASE}${ENDPOINTS.projects.paymentPageValidate(projectId)}`);
      const payload = await readJson(res);
      setValidationResult(payload?.data ?? payload ?? null);
      setValidationError("");
    } catch (err) {
      if (handleAuthError(err)) return;
      setValidationResult(null);
      setValidationError(err?.message || "Failed to validate finance page");
    } finally {
      if (!silent) setValidationLoading(false);
    }
  }

  async function loadPaymentPage({ silent = false } = {}) {
    if (!projectId) return;
    if (!silent) {
      setPageLoading(true);
      setPageError("");
    }
    try {
      const res = await authorizedFetch(`${API_BASE}${ENDPOINTS.projects.paymentPage(projectId)}`);
      const payload = await readJson(res);
      const data = payload?.data ?? payload;
      setPage(data);
      if (showValidateModal) {
        loadValidationResult({ silent: true });
      }
      if (!silent || ccnInput === "") {
        const cap = data?.ccn?.capPercent;
        setCcnInput(cap !== null && cap !== undefined ? String(cap) : "");
        const act = data?.ccn?.additionalCostType;
        if (act) setAdditionalCostType(String(act).toLowerCase());
      }
    } catch (err) {
      if (handleAuthError(err)) return;
      if (err?.status === 403 || /permission denied/i.test(err?.message || "")) {
        setPageError("You do not have access to this finance page.");
        navigate(`/projects/${encodeURIComponent(projectId)}`, { replace: true });
        return;
      }
      setPageError(err?.message || "Failed to load payment page");
    } finally {
      if (!silent) setPageLoading(false);
    }
  }

  useEffect(() => {
    if (!projectId || !getToken()) return;
    loadCostTypes();
    loadFrequencies();
    loadCarryForwardMethods();
    loadMilestones();
    loadPaymentPage();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId]);

  // Publish the project name so the global navbar's right-side pill shows
  // it (NavProjectName in Layout) instead of an in-page header. Cleared on
  // unmount so other routes don't inherit a stale name.
  const navProjectName = page?.projectName || project?.projectName || "";
  useEffect(() => {
    setPageContext({ projectName: navProjectName });
  }, [navProjectName]);
  useEffect(() => () => clearPageContext(), []);

  // ── Derived ──────────────────────────────────────────────────────
  const costItems = page?.costItems || [];
  /* Which cost items are resource costs. A payment term pointing at one is a
     RESOURCE-BASED milestone: its activities' `value`s are the resource costs
     snapshotted when each activity was saved (allocation rows live on the
     activity now), and its split is cost-driven — the manual per-activity
     split endpoint rejects these terms outright. */
  const resourceCostItemIds = useMemo(() => {
    const set = new Set();
    (page?.costItems || []).forEach((c) => {
      if (c.costTypeCode === "resource_cost" && c.id) set.add(c.id);
    });
    return set;
  }, [page]);
  const validationChecks = Array.isArray(validationResult?.checks) ? validationResult.checks : [];
  const validationAllPass = Boolean(validationResult?.allPass);
  /* Order phases by the backend's authoritative `sequence` (1-based). This
     makes "subsequent phases" (used to divide a phase's carry-forward) mean
     the phases that come AFTER it — laterPhases = phases.slice(idx + 1) on
     this list, and the last entry is the last phase. Falls back to a
     start/end-date sort when `sequence` is absent. */
  const phases = useMemo(() => {
    const list = page?.phases || [];
    const ts = (d) => {
      const t = d ? Date.parse(d) : NaN;
      return Number.isNaN(t) ? Infinity : t;
    };
    return [...list].sort((a, b) => {
      const seqA = Number(a.sequence), seqB = Number(b.sequence);
      const hasSeq = Number.isFinite(seqA) && Number.isFinite(seqB);
      if (hasSeq && seqA !== seqB) return seqA - seqB;
      const sa = ts(a.startDate), sb = ts(b.startDate);
      if (sa !== sb) return sa - sb;
      return ts(a.endDate) - ts(b.endDate);
    });
  }, [page]);
  /* Keep the selected Payment-Terms phase tab in range as phases load/change. */
  useEffect(() => {
    if (phases.length > 0 && activePhaseIdx > phases.length - 1) setActivePhaseIdx(0);
  }, [phases.length, activePhaseIdx]);
  const totals = page?.totals || {};

  /* ── One-time-cost distribution (backend-owned) ─────────────────────
     One-time is a project pool phases opt into. Per-phase allocation lives
     on phase.oneTimeAllocated / oneTimeEnabled / oneTimeMode / oneTimeValue.
     The chronologically last phase auto-absorbs the remainder. */
  const oneTimeTotal = Number(totals?.oneTimeCost) || 0;
  const lastPhaseKey = phases.length ? phases[phases.length - 1].phase : null;
  /* Headroom used up by the non-last phases (the last phase's allocation is
     the auto remainder, not user-chosen, so it doesn't consume headroom). */
  const oneTimeNonLastAllocated = phases
    .filter((p) => p.phase !== lastPhaseKey)
    .reduce((s, p) => s + (Number(p.oneTimeAllocated) || 0), 0);
  // const ccnCapPctServer = page?.ccn?.capPercent;
  const ccnValueServer = page?.ccn?.value;
  // Finance page is always actionable — the user can edit terms, generate
  // invoices, add cost rows, etc. at any time regardless of the server's
  // locked flag.
  const isLocked = false;

  const hasOneTime = costItems.some((c) => c.costTypeCode === "one_time");

  /* Every milestone already attached to a saved cost row is off-limits
     for new rows — each milestone can back at most one Fixed cost item.
     We compute the set once and pass it down to the picker, which
     greys those rows out (visible so the user understands why they
     can't be picked again). */
  const usedMilestoneIds = useMemo(() => {
    const set = new Set();
    costItems.forEach((c) => {
      if (Array.isArray(c.milestoneIds)) {
        c.milestoneIds.forEach((id) => { if (id) set.add(id); });
      }
    });
    return set;
  }, [costItems]);

  // ── Mutations ────────────────────────────────────────────────────
  async function submitNewCostItem(draft, hasOneTimeNow) {
    if (!projectId) return;
    if (draft.costTypeCode === "one_time" && hasOneTimeNow) {
      uiStore.showError("Only one Out of Pocket Expense row is allowed per project.");
      return;
    }
    const { error, body } = buildCostItemBody(draft);
    if (error) { uiStore.showError(error); return; }
    setAddingRow(true);
    try {
      const res = await authorizedFetch(`${API_BASE}${ENDPOINTS.projects.costItems(projectId)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      await readJson(res);
      setShowAddModal(false);
      await loadPaymentPage({ silent: true });
      uiStore.showMessage("Cost item added.");
    } catch (err) {
      if (handleAuthError(err)) return;
      uiStore.showError(err?.message || "Failed to add cost item");
    } finally {
      setAddingRow(false);
    }
  }

  async function submitCostItemEdit(draft) {
    if (!editingCostItem) return;
    const { error, body } = buildCostItemBody(draft);
    if (error) { uiStore.showError(error); return; }
    setSavingCostItem(true);
    try {
      const res = await authorizedFetch(
        `${API_BASE}${ENDPOINTS.costItems.update(editingCostItem.id)}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        }
      );
      await readJson(res);
      setEditingCostItem(null);
      await loadPaymentPage({ silent: true });
      uiStore.showMessage("Cost item updated.");
    } catch (err) {
      if (handleAuthError(err)) return;
      uiStore.showError(err?.message || "Failed to update cost item");
    } finally {
      setSavingCostItem(false);
    }
  }

  /* The confirmation is handled by StructureWarningModal before this runs,
     so there's no window.confirm here. */
  async function deleteCostItem(row) {
    if (!row?.id) return;
    setDeletingCostItemId(row.id);
    try {
      const res = await authorizedFetch(
        `${API_BASE}${ENDPOINTS.costItems.remove(row.id)}`,
        { method: "DELETE" }
      );
      if (!res.ok && res.status !== 204) {
        await readJson(res);
      }
      await loadPaymentPage({ silent: true });
      uiStore.showMessage("Cost item deleted.");
    } catch (err) {
      if (handleAuthError(err)) return;
      uiStore.showError(err?.message || "Failed to delete cost item");
    } finally {
      setDeletingCostItemId("");
    }
  }

  /* Edit Payment Term — invoked from the EditTermModal's Save button.
     Returns true on success so the caller can close the modal. */
  async function saveTerm(term, { percentOfPayment, ldBasisPercent }) {
    if (!term) return false;

    /* A milestone may be paid less than its allotment (the remainder carries
       forward) but never more — the backend's `pay-le-basis` check. Catch it
       here so the PATCH isn't even attempted. */
    const effectiveBasis = ldBasisPercent == null ? Number(term.ldBasisPercent) : Number(ldBasisPercent);
    const newPay = Number(percentOfPayment) || 0;
    if (Number.isFinite(effectiveBasis) && effectiveBasis > 0 && newPay - effectiveBasis > 0.001) {
      uiStore.showError(
        `% of Payment (${newPay}%) cannot exceed this milestone's LD Basis % ` +
        `(${effectiveBasis}%). Raise the LD Basis % first, or pay less.`
      );
      return false;
    }

    /* Hard validation: the final milestone of the final phase is the
       balancing term — saving it must bring that phase's scheduled %
       to exactly 100%. Block the save (no PATCH) otherwise. */
    const lastPhase = phases[phases.length - 1];
    if (lastPhase && term.phase === lastPhase.phase) {
      const phaseTerms = lastPhase.paymentTerms || [];
      const isLastTerm =
        phaseTerms.length > 0 && phaseTerms[phaseTerms.length - 1].id === term.id;
      if (isLastTerm) {
        const others = phaseTerms
          .filter((t) => t.id !== term.id)
          .reduce((s, t) => s + (Number(t.percentOfPayment) || 0), 0);
        const newPct = Number(percentOfPayment) || 0;
        const total = others + newPct;
        if (Math.abs(total - 100) > 0.001) {
          const needed = 100 - others;
          uiStore.showError(
            `Last phase must total 100%. This makes it ${total}% ` +
            `(${total < 100 ? `${100 - total}% short` : `${total - 100}% over`}). ` +
            `Set this milestone to ${needed}%.`
          );
          return false;
        }
      }
    }

    setSavingTerm(true);
    try {
      const res = await authorizedFetch(`${API_BASE}${ENDPOINTS.paymentTerms.update(term.id)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          frequencyCode: term.frequencyCode ?? null,
          percentOfPayment,
          ldBasisPercent,
        }),
      });
      await readJson(res);
      await loadPaymentPage({ silent: true });
      uiStore.showMessage("Payment term updated.");
      return true;
    } catch (err) {
      if (handleAuthError(err)) return false;
      uiStore.showError(err?.message || "Failed to update payment term");
      return false;
    } finally {
      setSavingTerm(false);
    }
  }

  /* Inline LD Basis % edit from the term table — PATCHes only that field.
     `value` is a Number, or null to fall back to the even split.

     The allotments must total 100% per phase (the backend's `ld-basis-pct`
     check), and this milestone's pay % can't exceed its own allotment
     (`pay-le-basis`). Both are checked here so a bad edit never leaves the
     page, and the phase total is checked against the OTHER terms' effective
     values so the arithmetic matches what the user sees. */
  async function saveTermLdBasis(term, value) {
    if (!term) return false;

    const pay = Number(term.percentOfPayment) || 0;
    if (value != null && value > 0 && pay - value > 0.001) {
      uiStore.showError(
        `LD Basis % (${value}%) cannot be less than what this milestone is ` +
        `paid (${pay}%). A milestone may be paid less than its allotment, never more.`
      );
      return false;
    }

    const phase = phases.find((p) => p.phase === term.phase);
    if (value != null && phase) {
      const others = (phase.paymentTerms || [])
        .filter((t) => t.id !== term.id)
        .reduce((s, t) => s + (Number(t.ldBasisPercent) || 0), 0);
      const total = Math.round((others + value) * 100) / 100;
      if (Math.abs(total - 100) > 0.001) {
        uiStore.showError(
          `LD Basis % must total 100% for phase ${term.phase}. This makes it ` +
          `${total}% — set this milestone to ${Math.round((100 - others) * 100) / 100}%.`
        );
        return false;
      }
    }

    setSavingTerm(true);
    try {
      const res = await authorizedFetch(`${API_BASE}${ENDPOINTS.paymentTerms.update(term.id)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ldBasisPercent: value }),
      });
      await readJson(res);
      await loadPaymentPage({ silent: true });
      uiStore.showMessage("LD Basis % updated.");
      return true;
    } catch (err) {
      if (handleAuthError(err)) return false;
      uiStore.showError(err?.message || "Failed to update LD Basis %");
      return false;
    } finally {
      setSavingTerm(false);
    }
  }

  /* Apply Frequency — PUTs a single frequency onto a phase, then reloads
     so the per-phase startDate/endDate/cycleCount come back fresh.
     Returns true on success so the PhasePanel can close its modal. */
  async function applyPhaseFrequency(phaseNum, frequencyCode) {
    try {
      const res = await authorizedFetch(`${API_BASE}${ENDPOINTS.projects.phaseFrequency(projectId, phaseNum)}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ frequencyCode }),
      });
      await readJson(res);
      await loadPaymentPage({ silent: true });
      uiStore.showMessage("Frequency applied.");
      return true;
    } catch (err) {
      if (handleAuthError(err)) return false;
      uiStore.showError(err?.message || "Failed to apply frequency");
      return false;
    }
  }

  /* Carry-forward — a phase with leftover budget carries its ENTIRE
     leftover forward; the body chooses the distribution method (from the
     carry-forward-methods master). Multiple phases may carry at once, so no
     mutual-exclusion cascade. The silent reload re-renders every phase's
     carryForward.* from backend truth.

       PUT /phases/{phase}/carry-forward
         { enabled: false }                                       // disable
         { enabled: true, methodCode }                            // evenly / time_*
         { enabled: true, methodCode, allocationMode, allocations } // *_custom
     `body` is built by the caller (the config popup). A 422 (e.g. last
     phase, no project frequency for a time method, or an under-allocated
     custom split) surfaces the backend's error.message via readJson. */
  async function setCarryForward(phase, body) {
    if (carrySaving) return;
    setCarrySaving(true);
    try {
      const res = await authorizedFetch(`${API_BASE}${ENDPOINTS.projects.carryForward(projectId, phase)}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      await readJson(res);
      await loadPaymentPage({ silent: true });
      uiStore.showMessage(body?.enabled ? "Carry-forward enabled." : "Carry-forward disabled.");
    } catch (err) {
      if (handleAuthError(err)) return;
      uiStore.showError(err?.message || "Failed to update carry-forward");
    } finally {
      setCarrySaving(false);
    }
  }

  /* One-time distribution — opt a phase into the one-time pool (or clear it).
       PUT /phases/{phase}/one-time
         { enabled: false }
         { enabled: true, mode: "percent" | "amount", value }
     Returns the full recomputed page; the last phase auto-absorbs the rest.

     A 422 comes back when the phase can't hold an allocation at all (a
     recurring-only phase). The control is already disabled for those, so
     this is the backstop — readJson lifts `error.message` out of the
     envelope and it's shown verbatim. */
  async function setOneTimeForPhase(phase, body) {
    if (oneTimeSaving) return;
    setOneTimeSaving(true);
    try {
      const res = await authorizedFetch(`${API_BASE}${ENDPOINTS.projects.oneTime(projectId, phase)}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      await readJson(res);
      await loadPaymentPage({ silent: true });
      uiStore.showMessage(body?.enabled ? "Out of Pocket Expense updated." : "Out of Pocket Expense cleared for this phase.");
    } catch (err) {
      if (handleAuthError(err)) return;
      uiStore.showError(err?.message || "Failed to update Out of Pocket Expense");
    } finally {
      setOneTimeSaving(false);
    }
  }

  /* Per-activity split — PATCH the term's activities. `activities` is an
     array of { activityId, percentOfPayment } whose percents must sum to
     the term's percentOfPayment; an empty array resets to an even split.
     Returns true on success so the modal can close. */
  async function saveTermActivities(termId, activities) {
    if (!termId) return false;
    setSavingActivities(true);
    try {
      const res = await authorizedFetch(`${API_BASE}${ENDPOINTS.paymentTerms.termActivities(termId)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ activities }),
      });
      await readJson(res);
      await loadPaymentPage({ silent: true });
      uiStore.showMessage("Activity split updated.");
      return true;
    } catch (err) {
      if (handleAuthError(err)) return false;
      uiStore.showError(err?.message || "Failed to update activity split");
      return false;
    } finally {
      setSavingActivities(false);
    }
  }

  async function saveCcnCap() {
    const isCcn = additionalCostType === "ccn";
    if (isCcn && (ccnInput === "" || ccnInput === null)) {
      uiStore.showError("Enter a CCN Cap %.");
      return;
    }
    if (!isCcn && (additionalValue === "" || additionalValue === null)) {
      uiStore.showError(`Enter a ${additionalCostType.toUpperCase()} %.`);
      return;
    }
    setCcnSaving(true);
    try {
      const body = isCcn
        ? { additionalCostType, ccnCapPercent: Number(ccnInput) }
        : { additionalCostType, value: Number(additionalValue) };
      const res = await authorizedFetch(`${API_BASE}${ENDPOINTS.projects.ccnCap(projectId)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const payload = await readJson(res);
      setPage(payload?.data ?? payload);
      uiStore.showMessage(`${additionalCostType.toUpperCase()} updated.`);
    } catch (err) {
      if (handleAuthError(err)) return;
      uiStore.showError(err?.message || "Failed to update CCN Cap");
    } finally {
      setCcnSaving(false);
    }
  }

  // ── Helpers ──────────────────────────────────────────────────────
  function milestoneName(id) {
    return milestones.find((m) => m.id === id)?.name || id || "—";
  }

  /* Short label for compact display — the code prefix before " - " (e.g.
     "D1 - AS-IS Assessment…" → "D1"). Falls back to the full name when the
     milestone isn't code-prefixed. */
  function milestoneShort(id) {
    const name = milestones.find((m) => m.id === id)?.name || "";
    if (!name) return id || "—";
    return name.split(/\s[-–—]\s/)[0].trim() || name;
  }

  function milestoneStatus(id) {
    return milestones.find((m) => m.id === id)?.status || "Not Completed";
  }

  function generateInvoice(term) {
    const name = milestoneName(term?.milestoneId);
    uiStore.showMessage(`Invoice generated for milestone "${name}".`);
  }

  function costTypeLabel(code) {
    return costTypes.find((c) => c.code === code)?.name ||
      (code === "fixed" ? "Fixed" : code === "one_time" ? "One-Time" : code);
  }


  // Loading & error gates
  if (!projectId) return null;
  if (pageLoading && !page) {
    return (
      <div className="uidai-pmis-content">
        <div className="uidai-pmis-card">
          <div style={{ padding: 22, textAlign: "center", ...muted }}>Loading project finance…</div>
        </div>
      </div>
    );
  }
  if (pageError && !page) {
    return (
      <div className="uidai-pmis-content">
        <div className="uidai-pmis-card">
          <div style={{ color: "var(--uidai-pmis-red)", padding: 14, fontWeight: 600 }}>
            {pageError}
          </div>
          <button type="button" className="uidai-pmis-btn uidai-pmis-btn-small" onClick={() => loadPaymentPage()}>
            Retry
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="uidai-pmis-content">
      {/* Top action bar — Back returns to wherever the user came from;
          Save and Next advances to the project detail page. */}
      <div style={{
        display: "flex", justifyContent: "space-between", alignItems: "center",
        flexWrap: "wrap", gap: 10, marginBottom: 12,
      }}>
        <button
          type="button"
          className="uidai-pmis-btn uidai-pmis-btn-cancel uidai-pmis-btn-small"
          style={{ marginTop: 0 }}
          onClick={() => navigate(-1)}
        >
          ← Back
        </button>
        <button
          type="button"
          className="uidai-pmis-btn uidai-pmis-btn-small"
          style={{ marginTop: 0 }}
          onClick={() => {
            setShowValidateModal(true);
            loadValidationResult();
          }}
        >
          Validate
        </button>
      </div>

      {showValidateModal && createPortal(
        <div style={{ position: "fixed", inset: 0, background: "rgba(11, 19, 32, 0.62)", display: "flex", alignItems: "center", justifyContent: "center", padding: 20, zIndex: 3000 }}>
          <div style={{ width: "min(760px, 100%)", maxHeight: "84vh", overflowY: "auto", background: "#fff", borderRadius: 14, boxShadow: "0 18px 45px rgba(0, 0, 0, 0.25)", padding: 24 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, marginBottom: 16 }}>
              <div>
                <div style={{ fontSize: 20, fontWeight: 800, color: "#173e77" }}>Finance Validation</div>
                <div style={{ color: "var(--uidai-pmis-muted)", marginTop: 4 }}>Backend-driven checks for the finance page.</div>
              </div>
              <button type="button" className="uidai-pmis-btn uidai-pmis-btn-cancel uidai-pmis-btn-small" onClick={() => setShowValidateModal(false)}>Close</button>
            </div>
            {validationLoading ? (
              <div style={{ padding: 12, color: "var(--uidai-pmis-muted)" }}>Running validation…</div>
            ) : validationError ? (
              <div style={{ padding: 12, color: "#c0392b", fontWeight: 600 }}>{validationError}</div>
            ) : validationChecks.length === 0 ? (
              <div style={{ padding: 12, color: "var(--uidai-pmis-muted)" }}>No validation results were returned.</div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                {validationChecks.map((check) => (
                  <div key={check.id || check.label} style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12, padding: "12px 14px", border: "1px solid var(--uidai-pmis-border)", borderRadius: 10, background: check.pass ? "#f3fbf7" : "#fff7f7" }}>
                    <div style={{ display: "flex", gap: 10, minWidth: 0 }}>
                      <span style={{ color: check.pass ? "#14804a" : "#c0392b", fontSize: 17, fontWeight: 800, lineHeight: 1.2 }}>{check.pass ? "✓" : "✕"}</span>
                      <div style={{ minWidth: 0 }}>
                        <div style={{ fontWeight: 700, color: "#173e77" }}>{check.label || CHECK_LABELS[check.id] || check.id || "Validation check"}</div>
                        {!check.pass && check.reason ? <div style={{ color: "#c0392b", marginTop: 3, fontSize: 13 }}>{check.reason}</div> : null}
                      </div>
                    </div>
                    <span style={{ fontSize: 12, fontWeight: 700, color: check.pass ? "#14804a" : "#c0392b", whiteSpace: "nowrap" }}>{check.pass ? "Passed" : "Needs attention"}</span>
                  </div>
                ))}
              </div>
            )}
            <div style={{ display: "flex", justifyContent: "flex-end", gap: 10, marginTop: 18 }}>
              <button type="button" className="uidai-pmis-btn uidai-pmis-btn-cancel uidai-pmis-btn-small" onClick={() => setShowValidateModal(false)}>Cancel</button>
              <button
                type="button"
                className="uidai-pmis-btn uidai-pmis-btn-small"
                disabled={!validationAllPass || validationLoading || validationError !== ""}
                onClick={() => {
                  setShowValidateModal(false);
                  navigate(`/projects/${encodeURIComponent(projectId)}`, {
                    state: { autoPublish: true },
                  });
                }}
              >
                Save and Next →
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}

      {/* Project name now lives in the global navbar's right-side pill
          (NavProjectName in Layout, fed via setPageContext above), so the
          in-page header pill was removed. */}

      <div
        style={{
          display: "flex",
          flexWrap: "wrap",
          gap: 10,
          marginBottom: 14,
          padding: "12px 14px",
          borderRadius: 12,
          border: "1px solid #dfe8f7",
          background: "linear-gradient(90deg, #f7fbff 0%, #eef5ff 100%)",
          boxShadow: "0 1px 2px rgba(20, 50, 110, 0.05)",
        }}
      >
        <div style={{ minWidth: 160 }}>
          <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: 0.5, textTransform: "uppercase", color: "#5b6b82" }}>
            Contract Value
          </div>
          <div style={{ fontSize: 16, fontWeight: 800, color: "#173e77", marginTop: 2 }}>
            {inr(totals?.totalContractCost || 0)}
          </div>
        </div>
        <div style={{ minWidth: 120 }}>
          <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: 0.5, textTransform: "uppercase", color: "#5b6b82" }}>
            Phases
          </div>
          <div style={{ fontSize: 16, fontWeight: 800, color: "#173e77", marginTop: 2 }}>
            {phases.length}
          </div>
        </div>
        <div style={{ minWidth: 140 }}>
          <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: 0.5, textTransform: "uppercase", color: "#5b6b82" }}>
            Organizations
          </div>
          <div style={{ fontSize: 16, fontWeight: 800, color: "#173e77", marginTop: 2 }}>
            {orgs.length || 1}
          </div>
        </div>
      </div>

      {/* Organization tabs — one per organization (vendor) assigned to this
          project. Selecting a tab sets the active organization; the finance
          sections below render under it. */}
      {orgs.length > 0 && (
        <div
          role="tablist"
          aria-label="Organizations"
          style={{
            display: "flex",
            gap: 4,
            flexWrap: "wrap",
            borderBottom: "2px solid var(--uidai-pmis-border)",
            marginBottom: 14,
          }}
        >
          {orgs.map((name, i) => {
            const active = i === activeOrg;
            return (
              <button
                key={`${name}-${i}`}
                type="button"
                role="tab"
                aria-selected={active}
                onClick={() => setActiveOrg(i)}
                title={name}
                style={{
                  border: "1px solid var(--uidai-pmis-border)",
                  borderBottom: active ? "2px solid #173e77" : "1px solid var(--uidai-pmis-border)",
                  borderTopLeftRadius: 8,
                  borderTopRightRadius: 8,
                  background: active ? "#fff" : "#f1f6fd",
                  color: active ? "#173e77" : "#5b6b82",
                  fontWeight: active ? 800 : 600,
                  fontSize: 13,
                  padding: "8px 16px",
                  marginBottom: -2,
                  cursor: "pointer",
                  maxWidth: 220,
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                  transition: "background .16s ease, color .16s ease, border-color .16s ease, transform .16s ease",
                  boxShadow: active ? "0 2px 8px rgba(23, 62, 119, 0.08)" : "none",
                }}
              >
                {name}
              </button>
            );
          })}
        </div>
      )}

      {/* Page-wide 2-column grid: every editable section sits on the
          left; the Summary panel sits on the right and sticks while
          the user scrolls through the long left column. */}
      <div className={`uidai-pmis-finance-grid${summaryCollapsed ? " is-summary-collapsed" : ""}`}>
        <div className="uidai-pmis-finance-main">
          {/* Section 1 — Project Cost */}
          <div className="uidai-pmis-card">
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 10, marginBottom: 8 }}>
              <div style={{ ...sectionHead, marginBottom: 0 }}>
                <span style={stepBadge}>1</span> Project Cost
              </div>
              <button
                type="button"
                className="uidai-pmis-btn uidai-pmis-btn-small"
                style={{ marginTop: 0 }}
                disabled={isLocked}
                onClick={() => setShowAddModal(true)}
              >
                + Add
              </button>
            </div>

            <div className="uidai-pmis-table-wrap">
              <table className="uidai-pmis-table">
                <thead>
                  <tr>
                    <th style={{ width: 130 }}>Cost Type</th>
                    <th>Milestones</th>
                    <th style={{ width: 130 }}>Cost (₹)</th>
                    <th style={{ width: 90 }}>Phase</th>
                    <th style={{ width: 200 }}>Tax Amount</th>
                    <th style={{ width: 150 }}>Total</th>
                    <th style={{ width: 100, textAlign: "center" }}>Action</th>
                  </tr>
                </thead>
                <tbody>
                  {costItems.length === 0 ? (
                    <tr>
                      <td colSpan={7} style={{ textAlign: "center", padding: 22, ...muted }}>
                        No cost items yet — click “+ Add” to create one.
                      </td>
                    </tr>
                  ) : costItems.map((r) => {
                    /* Only one_time hides milestones + phase; fixed,
                       resource_cost and transaction_cost all show them. */
                    const isOneTime = r.costTypeCode === "one_time";
                    /* Prefer the new explicit taxAmount field; fall back
                       to deriving it from taxPercent for rows saved
                       before the contract change. */
                    const taxAmt = r.taxAmount != null
                      ? Number(r.taxAmount)
                      : (r.taxPercent != null
                          ? (Number(r.cost) || 0) * (Number(r.taxPercent) / 100)
                          : null);
                    return (
                      <tr key={r.id}>
                        <td>
                          {costTypeLabel(r.costTypeCode)}
                          {r.lineLabel && (
                            <div style={{ fontSize: 11, color: "var(--uidai-pmis-muted)", fontWeight: 600, marginTop: 2 }}>
                              {r.lineLabel}
                            </div>
                          )}
                        </td>
                        <td >
                          {isOneTime
                            ? <span style={disabledCell}></span>
                            : (() => {
                                /* Show just the short codes (D1, D2, …) so all
                                   milestones fit on one line; hover shows the
                                   full names via the native title tooltip. */
                                const ids = r.milestoneIds || [];
                                if (ids.length === 0) return "—";
                                const shorts = ids.map(milestoneShort).join(", ");
                                const full = ids.map(milestoneName).join(", ");
                                return <span title={full}>{shorts}</span>;
                              })()}
                        </td>
                       <td title={wordsHint(r.cost)}>
  {inr(r.cost)}
</td>
                        <td >
                          {isOneTime
                            ? <span style={disabledCell}></span>
                            : (r.phase ?? "—")}
                        </td>
                        <td title={taxAmt == null ? "" : wordsHint(taxAmt)}>  {taxAmt == null ? "—" : inr(taxAmt)}</td>
                        <td title={wordsHint(r.total)} style={{ fontWeight: 700, color: "#173e77" }}>{inr(r.total)}</td>
                        <td style={{ textAlign: "center" }}>
                          <CostItemActions
                            row={r}
                            isLocked={isLocked}
                            isDeleting={deletingCostItemId === r.id}
                            onEdit={() => setStructureWarn({ action: "edit", row: r })}
                            onDelete={() => setStructureWarn({ action: "delete", row: r })}
                          />
                        </td>
                      </tr>
                    );
                  })}
                  <tr style={{ background: "#f1f6fd" }}>
                    <td colSpan={5} style={{ fontWeight: 800, color: "#173e77" }}>Total Contract Cost</td>
                    <td style={{ fontWeight: 800, color: "#173e77" }}>{inr(totals.totalContractCost)}</td>
                    <td />
                  </tr>
                </tbody>
              </table>
            </div>
          </div>

          {/* Section 2 — Payment Terms. Phases render as tabs (like the org
              tabs above); clicking a tab shows only that phase's panel. */}
          <div className="uidai-pmis-card">
            <div style={sectionHead}><span style={stepBadge}>2</span> Payment Term</div>

            {phases.length === 0 ? (
              <div style={{ padding: 18, textAlign: "center", ...muted, fontSize: 13 }}>
                Add a Fixed cost row with milestones to populate payment terms.
              </div>
            ) : (
              <>
                {/* Phase tabs */}
                <div
                  role="tablist"
                  aria-label="Phases"
                  style={{
                    display: "flex", gap: 4, flexWrap: "wrap",
                    borderBottom: "2px solid var(--uidai-pmis-border)",
                    marginBottom: 14,
                  }}
                >
                  {phases.map((p, i) => {
                    const active = i === activePhaseIdx;
                    const carrying = !!p.carryForward?.enabled;
                    return (
                      <button
                        key={p.phase}
                        type="button"
                        role="tab"
                        aria-selected={active}
                        onClick={() => setActivePhaseIdx(i)}
                        className={`uidai-pmis-phasetab${active ? " is-active" : ""}`}
                        style={{
                          transition: "all .16s ease",
                          boxShadow: active ? "0 2px 8px rgba(23, 62, 119, 0.08)" : "none",
                        }}
                      >
                        Phase {p.phase}
                        {carrying && (
                          <span
                            title="Carry-forward enabled"
                            style={{ width: 7, height: 7, borderRadius: "50%", background: "#1b7a42", display: "inline-block" }}
                          />
                        )}
                      </button>
                    );
                  })}
                </div>

                {phases[activePhaseIdx] && (
                  <PhasePanel
                    key={phases[activePhaseIdx].phase}
                    phase={phases[activePhaseIdx]}
                    allPhases={phases}
                    milestoneName={milestoneName}
                    milestoneStatus={milestoneStatus}
                    frequencies={frequencies}
                    carryMethods={carryMethods}
                    projectFrequencyCode={page?.frequencyCode || ""}
                    onEditTerm={(t) => setEditingTerm(t)}
                    onEditActivities={(t) => setEditingActivitiesTerm(t)}
                    onSaveLdBasis={saveTermLdBasis}
                    ldBasisBusy={savingTerm}
                    resourceCostItemIds={resourceCostItemIds}
                    onGenerateInvoice={generateInvoice}
                    onApplyFrequency={applyPhaseFrequency}
                    costItems={costItems}   
                    isLocked={isLocked}
                    isLastPhase={activePhaseIdx === phases.length - 1}
                    carryLocked={isLocked || carrySaving}
                    carryBusy={carrySaving}
                    onSetCarryForward={setCarryForward}
                    oneTimeTotal={oneTimeTotal}
                    oneTimeAllocatedElsewhere={
                      oneTimeNonLastAllocated - (Number(phases[activePhaseIdx].oneTimeAllocated) || 0)
                    }
                    oneTimeBusy={oneTimeSaving}
                    onSetOneTime={setOneTimeForPhase}
                  />
                )}
              </>
            )}
          </div>

          {/* Section 3 — Additional Cost Type. The dropdown sits at the top;
              selecting CCN / QGR / AQP reveals that type's input(s) below. */}
          <div className="uidai-pmis-card">
            {/* Step heading carries the "3" badge directly on the
                Additional Cost Type selector. */}
            <div style={sectionHead}>
              <span style={stepBadge}>3</span>
              Additional Cost Type
            </div>
            <div className="uidai-pmis-field" style={{ marginBottom: 14, maxWidth: 260 }}>
              <select
                value={additionalCostType}
                onChange={(e) => setAdditionalCostType(e.target.value)}
                disabled={isLocked}
              >
                <option value="ccn">CCN</option>
                <option value="qgr">QGR</option>
                <option value="aqp">AQP</option>
              </select>
            </div>

            <div style={{ display: "flex", flexWrap: "wrap", gap: 18, alignItems: "flex-end" }}>
              {additionalCostType === "ccn" ? (
                <>
                  <div className="uidai-pmis-field" style={{ marginBottom: 0, flex: "1 1 220px", minWidth: 200 }}>
                    <label>CCN Cap (%)</label>
                    <input
                      type="number"
                      min="0"
                      max="100"
                      value={ccnInput}
                      onChange={(e) => setCcnInput(e.target.value)}
                      disabled={isLocked}
                    />
                  </div>
                  <div className="uidai-pmis-field" style={{ marginBottom: 0, flex: "1 1 220px", minWidth: 200 }}>
                    <label>CCN Value</label>
                    <input value={inr(ccnValueServer)} disabled />
                  </div>
                </>
              ) : (
                <div className="uidai-pmis-field" style={{ marginBottom: 0, flex: "1 1 220px", minWidth: 200 }}>
                  <label>{additionalCostType === "qgr" ? "QGR (%)" : "AQP (%)"}</label>
                  <input
                    type="number"
                    min="0"
                    max="100"
                    value={additionalValue}
                    onChange={(e) => setAdditionalValue(e.target.value)}
                    placeholder={additionalCostType === "qgr" ? "Enter QGR %" : "Enter AQP %"}
                    disabled={isLocked}
                  />
                </div>
              )}
              <button
                type="button"
                className="uidai-pmis-btn uidai-pmis-btn-small"
                style={{ marginTop: 0, flex: "0 0 auto" }}
                onClick={saveCcnCap}
                disabled={ccnSaving || isLocked}
              >
                {ccnSaving ? "Saving…" : "Save"}
              </button>
            </div>
          </div>
        </div>

        {/* Right column — Summary + carry-forward. When open it's a normal
            panel with a ▶ toggle in the gap to close it. When closed it
            becomes a fixed tab pinned to the right edge of the screen; the
            main content takes the full width. Clicking the tab reopens it. */}
        {summaryCollapsed ? (
          <button
            type="button"
            className="uidai-pmis-finance-reopen"
            onClick={() => setSummaryCollapsed(false)}
            title="Show Financial Summary"
            aria-label="Show Financial Summary"
          >
            <span aria-hidden="true" style={{ fontSize: 14 }}>◀</span>
            <span className="uidai-pmis-finance-reopen-label">Financial Summary</span>
          </button>
        ) : (
          <div className="uidai-pmis-finance-summary">
            <button
              type="button"
              className="uidai-pmis-finance-toggle"
              onClick={() => setSummaryCollapsed(true)}
              title="Hide Financial Summary"
              aria-label="Hide Financial Summary"
            >
              ▶
            </button>
            <div className="uidai-pmis-finance-summary-body">
              <div style={{
                padding: "12px 16px",
                borderBottom: "1px solid var(--uidai-pmis-border)",
              }}>
                <span style={{
                  fontSize: 13, fontWeight: 800, color: "#173e77",
                  letterSpacing: 0.5, textTransform: "uppercase",
                }}>
                  Financial Summary
                </span>
              </div>
              <SummaryPanel totals={totals} />
              <div style={{
                height: 1,
                background: "var(--uidai-pmis-border)",
                margin: "0 16px",
              }} />
              <CarryForwardSummarySection phases={phases} totals={totals} carryMethods={carryMethods} />
            </div>
          </div>
        )}
      </div>

      <AddCostItemModal
        open={showAddModal}
        onClose={() => setShowAddModal(false)}
        onSubmit={submitNewCostItem}
        submitting={addingRow}
        costTypes={costTypes}
        milestones={milestones}
        hasOneTime={hasOneTime}
        disabledMilestoneIds={usedMilestoneIds}
      />
      <EditCostItemModal
        open={!!editingCostItem}
        row={editingCostItem}
        onClose={() => setEditingCostItem(null)}
        onSubmit={submitCostItemEdit}
        submitting={savingCostItem}
        costTypes={costTypes}
        milestones={milestones}
        usedMilestoneIds={usedMilestoneIds}
      />
      <EditTermModal
        open={!!editingTerm}
        term={editingTerm}
        onClose={() => setEditingTerm(null)}
        onSubmit={async (vals) => {
          const ok = await saveTerm(editingTerm, vals);
          if (ok) setEditingTerm(null);
        }}
        submitting={savingTerm}
        milestoneName={milestoneName}
      />
      <EditActivitiesModal
        open={!!editingActivitiesTerm}
        term={editingActivitiesTerm}
        onClose={() => setEditingActivitiesTerm(null)}
        submitting={savingActivities}
        milestoneName={milestoneName}
        onSubmit={async (activities) => {
          const ok = await saveTermActivities(editingActivitiesTerm?.id, activities);
          if (ok) setEditingActivitiesTerm(null);
        }}
      />
      <StructureWarningModal
        open={!!structureWarn}
        action={structureWarn?.action}
        rowLabel={
          structureWarn?.row
            ? (structureWarn.row.costTypeCode === "one_time"
                ? "the Out of Pocket Expense row"
                : `the ${costTypeLabel(structureWarn.row.costTypeCode)} cost row`)
            : ""
        }
        onCancel={() => setStructureWarn(null)}
        onProceed={() => {
          const pending = structureWarn;
          setStructureWarn(null);
          if (!pending?.row) return;
          if (pending.action === "edit") setEditingCostItem(pending.row);
          else if (pending.action === "delete") deleteCostItem(pending.row);
        }}
      />
    </div>
  );
}

/* ──────────────────────────────────────────────────────────────────
   Edit Activities modal — per-activity split for a partial-payment term.
   The term's percentOfPayment is divided across its activities; the
   percents must sum back to that term %. "Reset to even" sends an empty
   list, which the backend re-splits evenly. Save PATCHes
   /payment-terms/{id}/activities and the parent re-loads the page.
   ────────────────────────────────────────────────────────────────── */
function EditActivitiesModal({ open, onClose, term, onSubmit, submitting, milestoneName }) {
  const computedRows = useMemo(() => (term && term.activities) ? (term.activities || []).map((a) => ({
    activityId: a.activityId,
    activityDisplayCode: a.activityDisplayCode || a.activityId,
    percentOfPayment:
      a.percentOfPayment === null || a.percentOfPayment === undefined
        ? ""
        : String(a.percentOfPayment),
  })) : [], [term, term?.activities]);
  
  const [rows, setRows] = useState(computedRows);

  if (!open || !term) return null;

  const termPct = Number(term.percentOfPayment) || 0;
  const sum = rows.reduce((s, r) => s + (Number(r.percentOfPayment) || 0), 0);
  const sumRounded = Math.round(sum * 100) / 100;
  const sumOk = Math.abs(sumRounded - termPct) < 0.001;

  const setRowPct = (idx, val) =>
    setRows((prev) => prev.map((r, i) => (i === idx ? { ...r, percentOfPayment: val } : r)));

  return (
    <div className="uidai-modal" role="dialog" aria-modal="true">
      <div className="uidai-modal__box" style={{ width: "min(560px, 100%)" }}>
        <button
          type="button"
          aria-label="Close"
          onClick={onClose}
          style={{
            position: "absolute", top: 8, right: 10, width: 28, height: 28,
            border: "none", background: "transparent", fontSize: 22, lineHeight: 1,
            cursor: "pointer", color: "#666", padding: 0,
          }}
        >
          ×
        </button>
        <h3 className="uidai-modal__title">Edit Activity Split</h3>
        <div className="uidai-pmis-subtitle" style={{ margin: "4px 0 16px" }}>
          Milestone <strong style={{ color: "#173e77" }}>{milestoneName(term.milestoneId)}</strong>
          {" · "}Term total <strong style={{ color: "#173e77" }}>{termPct}%</strong>. The activity
          percentages must add up to this.
        </div>

        {rows.length === 0 ? (
          <div style={{ ...muted, fontSize: 13, padding: "8px 0" }}>
            No activities on this term.
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {rows.map((r, idx) => (
              <div key={r.activityId} style={{ display: "flex", alignItems: "center", gap: 12 }}>
                <span style={{ flex: 1, color: "#173e77", fontWeight: 600, fontSize: 13 }}>
                  {r.activityDisplayCode}
                </span>
                <div className="uidai-pmis-field" style={{ marginBottom: 0, width: 140 }}>
                  <input
                    type="number"
                    min="0"
                    max="100"
                    value={r.percentOfPayment}
                    onChange={(e) => setRowPct(idx, e.target.value)}
                  />
                </div>
                <span style={{ ...muted, fontSize: 12, width: 16 }}>%</span>
              </div>
            ))}
          </div>
        )}

        <div style={{
          marginTop: 14, display: "flex", justifyContent: "space-between", alignItems: "center",
          fontSize: 13, fontWeight: 700,
          color: sumOk ? "#1b7a42" : "var(--uidai-pmis-red)",
        }}>
          <span>Sum: {sumRounded}% / {termPct}%</span>
          {!sumOk && <span>Must equal {termPct}%</span>}
        </div>

        <div className="uidai-modal__actions" style={{ justifyContent: "space-between" }}>
          <button
            type="button"
            className="uidai-pmis-btn uidai-pmis-btn-cancel uidai-pmis-btn-small"
            disabled={submitting || rows.length === 0}
            title="Reset to an even split across all activities"
            onClick={() => onSubmit([])}
          >
            Reset to even
          </button>
          <div style={{ display: "inline-flex", gap: 8 }}>
            <button
              type="button"
              className="uidai-pmis-btn uidai-pmis-btn-cancel uidai-pmis-btn-small"
              onClick={onClose}
              disabled={submitting}
            >
              Cancel
            </button>
            <button
              type="button"
              className="uidai-pmis-btn uidai-pmis-btn-small"
              style={{ marginTop: 0 }}
              disabled={submitting || !sumOk || rows.length === 0}
              onClick={() => onSubmit(rows.map((r) => ({
                activityId: r.activityId,
                percentOfPayment: Number(r.percentOfPayment) || 0,
              })))}
            >
              {submitting ? "Saving…" : "Save"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ──────────────────────────────────────────────────────────────────
   One-Time Cost distribution popup. Lets the user add a slice of the
   project's total one-time cost to this phase — Enable/Disable, then an
   amount in % (of the total) or ₹, with a live "remaining" tracker. The
   last phase auto-absorbs any unallocated remainder.

   ⚠️ UI-only for now — the backend books the whole one-time cost on the
   first phase; this state is client-side until an endpoint exists.
   ────────────────────────────────────────────────────────────────── */
function OneTimeCostModal({
  open, onClose, onApply, phaseLabel,
  total = 0, available = 0, initialConfig = null,
  isLastPhase = false, autoRemainder = 0,
}) {
  const [config, setConfig] = useState(() => {
    if (initialConfig) {
      return {
        enabled: !!initialConfig.enabled,
        mode: initialConfig.mode || "percent",
        value: initialConfig.value != null ? String(initialConfig.value) : "",
      };
    }
    return { enabled: false, mode: "percent", value: "" };
  });

  const enabled = config.enabled;
  const mode = config.mode;
  const value = config.value;
  const setEnabled = (val) => setConfig(prev => ({ ...prev, enabled: val }));
  const setMode = (val) => setConfig(prev => ({ ...prev, mode: val }));
  const setValue = (val) => setConfig(prev => ({ ...prev, value: val }));

  if (!open) return null;

  const entered = Number(value) || 0;
  const amount = mode === "amount" ? entered : (entered / 100) * total;
  const maxAmount = Math.max(0, available);
  const overBudget = enabled && amount > maxAmount + 0.5;
  const validValue = !enabled || (value !== "" && entered > 0 && !overBudget);
  const remainingAfter = Math.round((maxAmount - (enabled ? amount : 0)) * 100) / 100;

  const seg = (active) => ({
    padding: "6px 14px", borderRadius: 999, fontSize: 12.5, fontWeight: 700,
    border: active ? "1px solid #173e77" : "1px solid var(--uidai-pmis-border)",
    background: active ? "#173e77" : "#fff",
    color: active ? "#fff" : "#173e77",
    cursor: "pointer",
  });

  return (
    <div className="uidai-modal" role="dialog" aria-modal="true">
      <div className="uidai-modal__box" style={{ width: "min(520px, 100%)" }}>
        <button
          type="button"
          aria-label="Close"
          onClick={onClose}
          style={{
            position: "absolute", top: 8, right: 10, width: 28, height: 28,
            border: "none", background: "transparent", fontSize: 22, lineHeight: 1,
            cursor: "pointer", color: "#666", padding: 0,
          }}
        >
          ×
        </button>
        <h3 className="uidai-modal__title">Out of Pocket Expense — Phase {phaseLabel}</h3>
        <div className="uidai-pmis-subtitle" style={{ margin: "4px 0 16px" }}>
          Add a share of the project's Out of Pocket Expense to this phase.
        </div>

        <div style={{ display: "flex", gap: 10, marginBottom: 14 }}>
          <div style={{ flex: 1, border: "1px solid var(--uidai-pmis-border)", borderRadius: 8, padding: "8px 12px", background: "#f7f9fc" }}>
            <div style={{ fontSize: 11, color: "var(--uidai-pmis-muted)", fontWeight: 600 }}>Total Out of Pocket Expense</div>
            <strong style={{ color: "#173e77", fontSize: 15 }}>{inr(total)}</strong>
          </div>
          <div style={{ flex: 1, border: "1px solid var(--uidai-pmis-border)", borderRadius: 8, padding: "8px 12px", background: "#f7f9fc" }}>
            <div style={{ fontSize: 11, color: "var(--uidai-pmis-muted)", fontWeight: 600 }}>Available to this phase</div>
            <strong style={{ color: "#173e77", fontSize: 15 }}>{inr(maxAmount)}</strong>
          </div>
        </div>

        {/* Enable / Disable */}
        <div className="uidai-pmis-field" style={{ marginBottom: 14 }}>
          <label>Add Out of Pocket Expense to this phase?</label>
          <div style={{ display: "flex", gap: 8, marginTop: 4 }}>
            <button type="button" style={seg(enabled)} onClick={() => setEnabled(true)}>Yes</button>
            <button type="button" style={seg(!enabled)} onClick={() => setEnabled(false)}>No</button>
          </div>
        </div>

        {enabled && (
          <>
            <div className="uidai-pmis-field" style={{ marginBottom: 14 }}>
              <label>Amount</label>
              <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                <button type="button" style={seg(mode === "percent")} onClick={() => { setMode("percent"); setValue(""); }}>%</button>
                <button type="button" style={seg(mode === "amount")} onClick={() => { setMode("amount"); setValue(""); }}>₹</button>
                <input
                  type="number"
                  min="0"
                  value={value}
                  placeholder={mode === "percent" ? "% of total" : "₹ amount"}
                  onChange={(e) => setValue(e.target.value)}
                  style={{ flex: 1 }}
                />
              </div>
              {mode === "percent" && (
                <div style={{ fontSize: 11.5, color: "var(--uidai-pmis-muted)", marginTop: 6 }}>
                  = {inr(amount)} of {inr(total)}
                </div>
              )}
            </div>

            <div style={{
              display: "flex", justifyContent: "space-between", alignItems: "center",
              fontSize: 13, fontWeight: 700,
              color: overBudget ? "var(--uidai-pmis-red)" : "#1b7a42",
            }}>
              <span>This phase: {inr(amount)}</span>
              <span>Remaining after: {inr(remainingAfter)}</span>
            </div>
            {overBudget && (
              <div style={{ fontSize: 12, color: "var(--uidai-pmis-red)", marginTop: 6 }}>
                Exceeds the amount available to this phase ({inr(maxAmount)}).
              </div>
            )}
          </>
        )}

        {isLastPhase && autoRemainder > 0 && (
          <div style={{
            marginTop: 12, border: "1px solid #cfe0f5", background: "#eef5ff",
            borderRadius: 8, padding: "10px 12px", fontSize: 12.5, color: "#0b3c88",
          }}>
            This is the last phase — it auto-absorbs the unallocated Out of Pocket Expense
            of <strong>{inr(autoRemainder)}</strong>.
          </div>
        )}

        <div className="uidai-modal__actions" style={{ justifyContent: "flex-end" }}>
          <button type="button" className="uidai-pmis-btn uidai-pmis-btn-cancel uidai-pmis-btn-small" onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className="uidai-pmis-btn uidai-pmis-btn-small"
            style={{ marginTop: 0 }}
            disabled={!validValue}
            onClick={() => onApply(
              enabled
                ? { enabled: true, mode, value: entered }
                : { enabled: false }
            )}
          >
            Apply
          </button>
        </div>
      </div>
    </div>
  );
}

/* ──────────────────────────────────────────────────────────────────
   Carry-forward configuration popup. Opens when a phase's "Yes" is
   clicked. Collects:
     • type   — Milestone-based or Phase-based (the distribution `mode`)
     • method — Equal (auto, even split) or Custom (per-target amounts)
     • when Custom: a per-target editor whose rows switch with the type —
       one row per LATER phase (phase-based) or per NEXT-phase milestone
       (milestone-based). Amounts can be entered as % (must sum to 100) or
       ₹ (must sum to the phase leftover).

   ⚠️ The backend only persists { enabled, mode } (equal split). The
   chosen method + custom allocations are captured CLIENT-SIDE and handed
   back via onApply so the parent can display them; they are NOT yet sent
   to the server. Wire them through once the API accepts allocations.
   ────────────────────────────────────────────────────────────────── */
function CarryForwardModal({
  open, onClose, onApply, phaseLabel,
  methods = [], initialMethodCode = "", initialAllocations = [],
  initialEnabled = false,
  leftover = 0, laterPhases = [], laterMilestones = [],
  projectFrequencyCode = "",
}) {
  const [enabled, setEnabled] = useState(false);     // Enable/Disable carry-forward
  const [methodCode, setMethodCode] = useState(initialMethodCode);
  const [unit, setUnit] = useState("percent");       // allocationMode: 'percent' | 'amount'
  const [alloc, setAlloc] = useState({});            // recipientKey -> string

  /* Seed on open: select the saved method and pre-fill any saved custom
     split (backend returns allocations[] with recipientKey + allocMode +
     inputValue/percent). */
  useEffect(() => {
    if (open) {
      // Defer state updates to avoid synchronous setState within effect
      // which can trigger cascading renders. Using setTimeout(0) yields
      // a microtask after the current render.
      const t = setTimeout(() => {
        setEnabled(!!initialEnabled);
        setMethodCode(initialMethodCode || "");
        const seed = {};
        let unitSeed = "percent";
        (initialAllocations || []).forEach((a) => {
          if (a == null || a.recipientKey == null) return;
          const m = a.allocMode || a.allocationMode;
          if (m === "amount") unitSeed = "amount";
          const v = a.inputValue ?? a.value ?? a.percent;
          seed[String(a.recipientKey)] = v != null ? String(v) : "";
        });
        setUnit(unitSeed);
        setAlloc(seed);
      }, 0);
      return () => clearTimeout(t);
    }
  }, [open, initialEnabled, initialMethodCode, initialAllocations]);

  const selected = methods.find((m) => m.code === methodCode) || null;
  const selMethod = selected?.method || "";          // phase | milestone | time
  const isCustom = (selected?.variant || "") === "custom";
  const isTime = selMethod === "time";

  /* Recipients only matter for the *_custom variants: later phases for
     phase_custom, subsequent milestones for milestone_custom. */

const recipients =
  selMethod === "phase"
    ? laterPhases.map((p) => ({
        key: String(p.phase),
        label: `Phase ${p.phase}`,
      }))
    : selMethod === "milestone"
      ? laterMilestones.map((m) => ({
          key: String(m.id),
          label: m.name,
        }))
      : [];
  if (!open) return null;

  const setOne = (k, v) => setAlloc((prev) => ({ ...prev, [k]: v }));

  /* Pre-fill the custom rows with an even split so the user starts valid. */
  const fillEven = () => {
    const n = recipients.length || 1;
    const each = unit === "percent"
      ? Math.round((100 / n) * 100) / 100
      : Math.round((leftover / n) * 100) / 100;
    const next = {};
    recipients.forEach((r) => { next[r.key] = String(each); });
    setAlloc(next);
  };

  const sum = recipients.reduce((s, r) => s + (Number(alloc[r.key]) || 0), 0);
  const sumRounded = Math.round(sum * 100) / 100;
  const target = unit === "percent" ? 100 : Math.round(leftover * 100) / 100;
  const sumOk = Math.abs(sumRounded - target) < 0.5; // ₹ rounding tolerance
  const timeBlocked = isTime && !projectFrequencyCode;
  const canApply =
    !enabled || (!!selected && !timeBlocked && (!isCustom || (recipients.length > 0 && sumOk)));

  /* Picker options grouped by method family. */
  const groupLabel = { phase: "Phase-based", milestone: "Milestone-based", time: "Time-based" };
  const groups = ["phase", "milestone", "time"]
    .map((g) => ({ g, label: groupLabel[g] || g, items: methods.filter((m) => m.method === g) }))
    .filter((grp) => grp.items.length > 0);

  const seg = (active) => ({
    padding: "6px 14px", borderRadius: 999, fontSize: 12.5, fontWeight: 700,
    border: active ? "1px solid #173e77" : "1px solid var(--uidai-pmis-border)",
    background: active ? "#173e77" : "#fff",
    color: active ? "#fff" : "#173e77",
    cursor: "pointer",
  });

  return (
    <div className="uidai-modal" role="dialog" aria-modal="true">
      <div className="uidai-modal__box" style={{ width: "min(580px, 100%)" }}>
        <button
          type="button"
          aria-label="Close"
          onClick={onClose}
          style={{
            position: "absolute", top: 8, right: 10, width: 28, height: 28,
            border: "none", background: "transparent", fontSize: 22, lineHeight: 1,
            cursor: "pointer", color: "#666", padding: 0,
          }}
        >
          ×
        </button>
        <h3 className="uidai-modal__title">Carry Forward — Phase {phaseLabel}</h3>
        <div className="uidai-pmis-subtitle" style={{ margin: "4px 0 16px" }}>
          The phase's entire leftover{" "}
          <strong style={{ color: "#173e77" }}>{inr(leftover)}</strong>{" "}
          is carried forward. Choose how it's distributed.
        </div>

        {/* Enable / Disable */}
        <div className="uidai-pmis-field" style={{ marginBottom: 14 }}>
          <label>Enable carry-forward for this phase?</label>
          <div style={{ display: "flex", gap: 8, marginTop: 4 }}>
            <button type="button" style={seg(enabled)} onClick={() => setEnabled(true)}>Yes</button>
            <button type="button" style={seg(!enabled)} onClick={() => setEnabled(false)}>No</button>
          </div>
        </div>

        {enabled && (<>
        {/* Method picker — master-driven, grouped by family. */}
        <div className="uidai-pmis-field" style={{ marginBottom: 14 }}>
          <label>Carry-forward method</label>
          <select value={methodCode} onChange={(e) => setMethodCode(e.target.value)}>
            <option value="">— Select method —</option>
            {groups.map((grp) => (
              <optgroup key={grp.g} label={grp.label}>
                {grp.items.map((m) => (
                  <option key={m.code} value={m.code}>{m.name}</option>
                ))}
              </optgroup>
            ))}
          </select>
          {methods.length === 0 && (
            <small style={{ color: "var(--uidai-pmis-muted)" }}>No carry-forward methods available.</small>
          )}
        </div>

        {isTime && (
          <div style={{
            border: timeBlocked ? "1px solid #f0c0c0" : "1px solid #cfe0f5",
            background: timeBlocked ? "#fdecec" : "#eef5ff",
            borderRadius: 8, padding: "10px 12px", fontSize: 12.5,
            color: timeBlocked ? "#a3261f" : "#0b3c88", lineHeight: 1.5,
          }}>
            {timeBlocked
              ? "Set a project frequency first — time-based carry-forward weights the split by each later phase's interval count."
              : `Leftover is split across later phases, weighted by each phase's interval count at the project frequency (${projectFrequencyCode}).`}
          </div>
        )}

        {selected && !isCustom && !isTime && (
          <div style={{
            border: "1px solid #cfe0f5", background: "#eef5ff", borderRadius: 8,
            padding: "10px 12px", fontSize: 12.5, color: "#0b3c88", lineHeight: 1.5,
          }}>
            Split equally across {selMethod === "phase" ? "the later phases" : "the subsequent milestones"}.
          </div>
        )}

        {isCustom && (
          <div>
            {/* Unit toggle + even-fill helper */}
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, marginBottom: 10 }}>
              <div style={{ display: "flex", gap: 8 }}>
                <button type="button" style={seg(unit === "percent")} onClick={() => { setUnit("percent"); setAlloc({}); }}>
                  %
                </button>
                <button type="button" style={seg(unit === "amount")} onClick={() => { setUnit("amount"); setAlloc({}); }}>
                  ₹
                </button>
              </div>
              <button
                type="button"
                className="uidai-pmis-btn uidai-pmis-btn-cancel uidai-pmis-btn-small"
                onClick={fillEven}
                disabled={recipients.length === 0}
              >
                Distribute evenly
              </button>
            </div>

            {recipients.length === 0 ? (
              <div style={{ ...muted, fontSize: 13, padding: "8px 0" }}>
                No {selMethod === "phase" ? "later phases" : "subsequent milestones"} to distribute to.
              </div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 8, maxHeight: 240, overflowY: "auto" }}>
                {recipients.map((r) => (
                  <div key={r.key} style={{ display: "flex", alignItems: "center", gap: 12 }}>
                    <span style={{ flex: 1, color: "#173e77", fontWeight: 600, fontSize: 13 }}>{r.label}</span>
                    <div className="uidai-pmis-field" style={{ marginBottom: 0, width: 150 }}>
                      <input
                        type="number"
                        min="0"
                        value={alloc[r.key] ?? ""}
                        placeholder={unit === "percent" ? "%" : "₹"}
                        onChange={(e) => setOne(r.key, e.target.value)}
                      />
                    </div>
                    <span style={{ ...muted, fontSize: 12, width: 16 }}>{unit === "percent" ? "%" : "₹"}</span>
                  </div>
                ))}
              </div>
            )}

            {recipients.length > 0 && (
              <div style={{
                marginTop: 12, display: "flex", justifyContent: "space-between", alignItems: "center",
                fontSize: 13, fontWeight: 700,
                color: sumOk ? "#1b7a42" : "var(--uidai-pmis-red)",
              }}>
                <span>
                  Sum: {unit === "percent" ? `${sumRounded}% / 100%` : `${inr(sumRounded)} / ${inr(target)}`}
                </span>
                {!sumOk && <span>Must total {unit === "percent" ? "100%" : inr(target)}</span>}
              </div>
            )}
          </div>
        )}

        </>)}

        <div className="uidai-modal__actions" style={{ justifyContent: "flex-end" }}>
          <button
            type="button"
            className="uidai-pmis-btn uidai-pmis-btn-cancel uidai-pmis-btn-small"
            onClick={onClose}
          >
            Cancel
          </button>
          <button
            type="button"
            className="uidai-pmis-btn uidai-pmis-btn-small"
            style={{ marginTop: 0 }}
            disabled={!canApply}
            onClick={() => onApply(
              !enabled
                ? { enabled: false }
                : isCustom
                  ? {
                      enabled: true,
                      methodCode,
                      allocationMode: unit,
                      allocations: recipients.map((r) => ({ recipientKey: r.key, value: Number(alloc[r.key]) || 0 })),
                    }
                  : { enabled: true, methodCode }
            )}
          >
            Apply
          </button>
        </div>
      </div>
    </div>
  );
}

/* Each phase renders as its own collapsible panel — header is always
   visible, body collapses. Frequency + % of Payment are first-class
   columns now; the row-level pencil button opens the EditTermModal
   which holds both. The carry-forward on/off toggle opens a config popup;
   the read-only roll-up is in the summary section below. */
/* Each phase renders as its own collapsible panel — header is always
   visible, body collapses. Frequency + % of Payment are first-class
   columns now; the row-level pencil button opens the EditTermModal
   which holds both. The carry-forward on/off toggle opens a config popup;
   the read-only roll-up is in the summary section below. */
function PhasePanel({
  phase, allPhases = [], costItems = [],
  milestoneName = () => "Not Completed",
  frequencies = [], carryMethods = [], projectFrequencyCode = "",
  onEditTerm, onEditActivities, onApplyFrequency,
  onSaveLdBasis, ldBasisBusy = false,
  /* Ids of the resource-cost cost items — a term pointing at one is a
     resource-based milestone (see the note where this is built). */
  resourceCostItemIds = new Set(),
  isLocked, isLastPhase, carryLocked, carryBusy, onSetCarryForward,
  oneTimeTotal = 0, oneTimeAllocatedElsewhere = 0, oneTimeBusy = false, onSetOneTime,
}) {
  /* Which payment-term rows are expanded to reveal their activity-wise
     breakdown (partial-payment milestones). */
  const [expandedTerms, setExpandedTerms] = useState(() => new Set());
  const toggleTermExpand = (id) =>
    setExpandedTerms((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  /* Apply-Frequency tool: a start/end/frequency window for the phase.
     Values persist between opens so the modal re-opens prefilled. */
  const [showFreqModal, setShowFreqModal] = useState(false);
  const [freqStart, setFreqStart] = useState("");
  const [freqEnd, setFreqEnd] = useState("");
  const [freqCode, setFreqCode] = useState("");
  const [applyingFreq, setApplyingFreq] = useState(false);

  /* Recurring costs don't generate milestone-linked payment terms (they book
     as a dated schedule with paymentTerms: []), so their milestone never shows
     in this table the way a fixed/resource phase's does. Synthesize read-only
     rows from the recurring cost items so the milestone renders here just like
     the other cost types. If the backend ever emits real payment terms for
     recurring costs, realTerms wins and this synthesis is skipped. */
  const realTerms = phase.paymentTerms || [];
  const phaseCostItems = (costItems || []).filter((c) => c.phase === phase.phase);
  const recurringItems = phaseCostItems.filter((c) => c.costTypeCode === "recurring_cost");
  const terms = realTerms.length
    ? realTerms
    : recurringItems.flatMap((c) =>
        (Array.isArray(c.milestoneIds) ? c.milestoneIds : []).map((mid) => ({
          id: `recurring-${c.id}-${mid}`,
          milestoneId: mid,
          percentOfPayment: null,
          value: Number(c.total) || 0,
          cycleCount: phase.cycleCount,
          activities: [],
          __recurring: true,
        }))
      );
  /* A phase showing only synthetic recurring rows has no % of payment, so the
     % total row and the Scheduled/Remaining chips are hidden for it. */
  const isSyntheticOnly = realTerms.length === 0 && terms.length > 0;
  const totalPercent = terms.reduce((s, r) => s + (Number(r.percentOfPayment) || 0), 0);
  const totalValue = terms.reduce((s, r) => s + (Number(r.value) || 0), 0);
  /* Allotment total for the phase — the backend's `ld-basis-pct` check wants
     exactly 100%. Rounded to 2dp so a 3-way even split (33.33 × 3) doesn't
     read as unbalanced from float noise. */
  const totalLdBasis =
    Math.round(terms.reduce((s, r) => s + (Number(r.ldBasisPercent) || 0), 0) * 100) / 100;
  const ldBasisBalanced = Math.abs(totalLdBasis - 100) <= 0.02;
  /* Base (100%) the term percentages are taken from = scheduled value
     scaled back up by the scheduled %. Remaining = the still-unscheduled
     part of that base. */
  const phaseBase = totalPercent > 0 ? totalValue / (totalPercent / 100) : 0;
  const phaseRemaining = phaseBase - totalValue;
  const canToggleCarry = typeof onSetCarryForward === "function";

  /* Carry-forward state is backend-owned (phase.carryForward). When enabled
     the phase carries its ENTIRE leftover forward via the chosen method.
     Clicking "Yes" opens the config popup; the last phase can't carry
     forward (nothing later to receive it), so the toggle is disabled there. */
  const cf = phase.carryForward || {};
  const cfEnabled = !!cf.enabled;
  const cfMethodCode = cf.methodCode || "";
  const cfMethodName = carryMethods.find((m) => m.code === cfMethodCode)?.name || cfMethodCode || "";
  const cfIsLast = cf.isLastPhase ?? isLastPhase;
  const cfDisabled = carryLocked || carryBusy || cfIsLast;
  const cfLeftover = Number(cf.leftover) || phaseRemaining || 0;
  const cfAllocations = Array.isArray(cf.allocations) ? cf.allocations : [];
  /* Frequency (time_*) carry-forward is a POOL: a dated installment schedule
     over the periods after the phase ends. It is NOT added to any phase/
     milestone total — it just shows here as a schedule. Applied (phase/
     milestone) methods return an empty pool. */
  const cfPool = Array.isArray(cf.pool) ? cf.pool : [];
  const cfPoolPerPeriod = Number(cf.poolPerPeriod) || 0;
  const [cfModalOpen, setCfModalOpen] = useState(false);
  const [poolOpen, setPoolOpen] = useState(false);


  /* Recurring-cost schedule (backend-owned) — a dated per-period breakdown
     of this phase's recurring cost, mirroring the carry-forward pool card.
     Only phases that carry a recurring cost return a schedule. */
  const recurringSchedule = Array.isArray(phase.recurringSchedule) ? phase.recurringSchedule : [];
  const recurringPerPeriod = Number(phase.recurringPerPeriod) || 0;
  const recurringTotal = Number(phase.recurringTotal) || 0;
  const [recurringOpen, setRecurringOpen] = useState(false);
  const canApplyFrequency = typeof onApplyFrequency === "function";

   const recurringMilestoneNames = Array.from(new Set(
    (costItems || [])
      .filter((c) => c.costTypeCode === "recurring_cost" && c.phase === phase.phase)
      .flatMap((c) => (Array.isArray(c.milestoneIds) ? c.milestoneIds : []))
      .filter(Boolean)
      .map((id) => milestoneName(id))
  ));
  const openFreqModal = () => {
    setFreqStart(toDateInput(phase.startDate));
    setFreqEnd(toDateInput(phase.endDate));
    setFreqCode((c) => c || projectFrequencyCode || "");
    setShowFreqModal(true);
  };

  /* One-time-cost distribution (backend-owned). This phase's ₹ share of the
     one-time pool comes from phase.oneTimeAllocated; the last phase can't be
     set — it auto-absorbs the remainder. */
  const otEnabled = !!phase.oneTimeEnabled;
  const otAmount = Number(phase.oneTimeAllocated) || 0;
  const otAvailable = Math.round((oneTimeTotal - oneTimeAllocatedElsewhere) * 100) / 100;
  const otLastAbsorb = isLastPhase ? (Number(phase.oneTimeAllocated) || 0) : 0;
  const otInitialConfig = {
    enabled: !!phase.oneTimeEnabled,
    mode: phase.oneTimeMode || "percent",
    value: phase.oneTimeValue,
  };
  /* A phase whose only live cost is recurring can't hold an Out of Pocket
     Expense share: the backend 422s the PUT and reports OPE as fully cleared
     on read (oneTimeEnabled false / mode + value null). Offering the control
     there would look like an edit that silently "resets" on the next visit,
     so it's shown disabled instead — same treatment as the last phase, which
     auto-absorbs the remainder and is likewise not user-settable. */
  const isRecurringOnlyPhase =
    phaseCostItems.length > 0 && recurringItems.length === phaseCostItems.length;
  const otLocked = isLastPhase || isRecurringOnlyPhase;
  const canToggleOneTime = typeof onSetOneTime === "function" && oneTimeTotal > 0;
  const [otModalOpen, setOtModalOpen] = useState(false);

  /* Recipients for the popup's custom variants, derived from the full phase
     list: later phases (phase_custom) or the milestones across all later
     phases (milestone_custom). */
  const myIdx = allPhases.findIndex((p) => p.phase === phase.phase);
  const laterPhases = myIdx >= 0 ? allPhases.slice(myIdx + 1) : [];
  const laterMilestones = Array.from(
    new Map(
      laterPhases
        .flatMap((p) => p.paymentTerms || [])
        .filter((t) => t.milestoneId)
        .map((t) => [t.milestoneId, milestoneName(t.milestoneId)])
    ),
    ([id, name]) => ({ id, name })
  );

  return (
    <div style={{
      border: "1px solid var(--uidai-pmis-border)",
      borderRadius: 10,
      marginBottom: 14,
      background: "#fff",
      overflow: "hidden",
      boxShadow: "0 1px 2px rgba(20, 50, 110, 0.04)",
    }}>
      {/* Phase toolbar — the phase is selected via the tabs above, so this is
          a static bar (no collapse) holding the cycle badge + carry-forward. */}
      <div
        style={{
          width: "100%",
          display: "flex", alignItems: "center", justifyContent: "space-between",
          gap: 12, flexWrap: "wrap",
          background: "linear-gradient(90deg, #eef4fc 0%, #f5f9ff 100%)",
          borderBottom: "1px solid var(--uidai-pmis-border)",
          padding: "10px 16px",
        }}
      >
        <div style={{ display: "inline-flex", alignItems: "center", gap: 12, minWidth: 0, flexWrap: "wrap" }}>
          {phase.cycleCount != null && (
            <span style={{
              fontSize: 10, fontWeight: 700, letterSpacing: 0.3,
              padding: "2px 7px", borderRadius: 999,
              background: "#eef4fc", color: "#173e77", border: "1px solid #cfe0f5",
            }}>
              {phase.cycleCount} {Number(phase.cycleCount) === 1 ? "Interval" : "Intervals"}
            </span>
          )}
          {phase.pendingCycles != null && (
            <span
              title="Project-frequency periods remaining after this phase (how far a frequency carry-forward would spread)"
              style={{
                fontSize: 10, fontWeight: 700, letterSpacing: 0.3,
                padding: "2px 7px", borderRadius: 999,
                background: "#fff5e9", color: "#b54708", border: "1px solid #f5d9b5",
              }}
            >
              {phase.pendingCycles} {Number(phase.pendingCycles) === 1 ? "Interval" : "Intervals"} left
            </span>
          )}
        </div>

        {(canToggleCarry || canApplyFrequency) && (
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              display: "inline-flex", alignItems: "center", gap: 8, flexWrap: "wrap",
              marginLeft: "auto", padding: "4px", borderRadius: 999,
              background: "rgba(255,255,255,0.7)", border: "1px solid rgba(207,224,245,0.8)",
            }}
          >
            {canApplyFrequency && (
              <button
                type="button"
                disabled={isLocked || terms.length === 0}
                onClick={openFreqModal}
                title="Apply frequency to this phase"
                style={{
                  display: "inline-flex", alignItems: "center", gap: 6,
                  border: "1px solid #cfe0f5", background: "#fff", color: "#0b3c88",
                  borderRadius: 999, padding: "6px 12px",
                  fontSize: 12, fontWeight: 700,
                  cursor: (isLocked || terms.length === 0) ? "not-allowed" : "pointer",
                  opacity: (isLocked || terms.length === 0) ? 0.6 : 1,
                  boxShadow: "0 1px 2px rgba(20, 50, 110, 0.06)",
                }}
              >
                <span aria-hidden="true" style={{ fontSize: 12 }}>⏱</span>
                Apply Frequency
              </button>
            )}

            {/* Carry Forward — a single status button that opens the config
                popup (Enable/Disable + distribution method). */}
            {canToggleCarry && (
              <button
                type="button"
                disabled={cfDisabled}
                onClick={() => setCfModalOpen(true)}
                title={cfIsLast ? "Carry-forward doesn't apply to the last phase" : "Configure carry-forward"}
                style={{
                  display: "inline-flex", alignItems: "center", gap: 6,
                  border: cfEnabled ? "1px solid #1b7a42" : "1px solid var(--uidai-pmis-border)",
                  background: cfEnabled ? "#eaf7ee" : "#fff",
                  color: cfEnabled ? "#1b7a42" : "#5b6b82",
                  borderRadius: 999, padding: "6px 12px",
                  fontSize: 12, fontWeight: 700,
                  cursor: cfDisabled ? "not-allowed" : "pointer",
                  opacity: cfDisabled ? 0.55 : 1,
                  boxShadow: "0 1px 2px rgba(20, 50, 110, 0.06)",
                }}
              >
                <span style={{ width: 7, height: 7, borderRadius: "50%", background: cfEnabled ? "#1b7a42" : "#c2cdda" }} />
                Carry Forward: {cfIsLast ? "n/a" : cfEnabled ? (cfMethodName || "On") : "Off"}
                {!cfIsLast && <span aria-hidden="true" style={{ opacity: 0.8 }}>✎</span>}
              </button>
            )}

            {/* One-Time Cost distribution — status button opens its popup.
                The last phase is display-only (auto-absorbs the remainder). */}
            {canToggleOneTime && (
              <button
                type="button"
                disabled={otLocked || oneTimeBusy}
                onClick={() => { if (!otLocked) setOtModalOpen(true); }}
                title={isLastPhase
                  ? "Last phase auto-absorbs the remaining Out of Pocket Expense"
                  : isRecurringOnlyPhase
                    ? "This phase carries only recurring cost, so it can't take an Out of Pocket Expense share"
                    : "Distribute Out of Pocket Expense to this phase"}
                style={{
                  display: "inline-flex", alignItems: "center", gap: 6,
                  border: otAmount > 0 ? "1px solid #0b6b8f" : "1px solid var(--uidai-pmis-border)",
                  background: otAmount > 0 ? "#e9f6fb" : "#fff",
                  color: otAmount > 0 ? "#0b6b8f" : "#5b6b82",
                  borderRadius: 999, padding: "6px 12px",
                  fontSize: 12, fontWeight: 700,
                  cursor: otLocked ? "default" : "pointer",
                  opacity: oneTimeBusy ? 0.6 : isRecurringOnlyPhase ? 0.55 : 1,
                  boxShadow: "0 1px 2px rgba(20, 50, 110, 0.06)",
                }}
              >
                <span style={{ width: 7, height: 7, borderRadius: "50%", background: otAmount > 0 ? "#0b6b8f" : "#c2cdda" }} />
                Out of Pocket Expense:{" "}
                {isRecurringOnlyPhase
                  ? "n/a"
                  : otAmount > 0 ? inr(otAmount) : (otEnabled ? inr(0) : "Off")}
                {isLastPhase
                  ? <span style={{ fontWeight: 600, opacity: 0.85 }}>(auto)</span>
                  : isRecurringOnlyPhase
                    ? <span style={{ fontWeight: 600, opacity: 0.85 }}>(recurring only)</span>
                    : <span aria-hidden="true" style={{ opacity: 0.8 }}>✎</span>}
              </button>
            )}
          </div>
        )}
      </div>

      <div style={{ padding: 16 }}>
          {/* Frequency carry-forward pool — a dated installment schedule that
              is NOT added to any total (it stays out until invoicing). Shown
              only for time_* methods (applied methods return an empty pool). */}
          {cfPool.length > 0 && (
            <div style={{
              marginBottom: 12, border: "1px solid #cfe0f5", borderRadius: 8,
              background: "#f6faff", overflow: "hidden",
            }}>
              <button
                type="button"
                onClick={() => setPoolOpen((o) => !o)}
                aria-expanded={poolOpen}
                style={{
                  width: "100%", border: "none", background: "transparent", cursor: "pointer",
                  display: "flex", alignItems: "center", justifyContent: "space-between",
                  gap: 8, padding: "10px 12px", textAlign: "left",
                }}
              >
                <span style={{ fontSize: 12.5, fontWeight: 800, color: "#0b3c88", display: "inline-flex", alignItems: "center", gap: 8 }}>
                  <span aria-hidden="true">📅</span>
                  Carry-Forward Schedule ({cfMethodName})
                  <span style={{
                    fontSize: 10, fontWeight: 700, padding: "1px 7px", borderRadius: 999,
                    background: "#e6eefb", color: "#0b3c88", border: "1px solid #cfe0f5",
                  }}>
                    {cfPool.length} {cfPool.length === 1 ? "installment" : "installments"}
                  </span>
                </span>
                <span style={{ fontSize: 12, color: "var(--uidai-pmis-muted)" }}>
                  {inr(cfPoolPerPeriod)} / period {poolOpen ? "▲" : "▼"}
                </span>
              </button>
              {poolOpen && (
                <div style={{ padding: "0 12px 12px" }}>
                  <div style={{ fontSize: 11, color: "var(--uidai-pmis-muted)", marginBottom: 8 }}>
                    The leftover {inr(cfLeftover)} is scheduled across the periods after this phase —
                    not added to any phase or milestone total.
                  </div>
                  <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                    {cfPool.map((row, i) => (
                      <div key={row.periodIndex ?? i} style={{
                        display: "flex", justifyContent: "space-between", alignItems: "center",
                        gap: 8, fontSize: 12, padding: "5px 8px",
                        background: "#fff", border: "1px solid var(--uidai-pmis-border)", borderRadius: 6,
                      }}>
                        <span style={{ color: "#173e77", fontWeight: 600 }}>
                          {fmtDMY(row.periodStart)} – {fmtDMY(row.periodEnd)}
                        </span>
                        <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
                          <span style={{ fontWeight: 700, color: "#173e77", fontVariantNumeric: "tabular-nums" }}>
                            {inr(row.amount)}
                          </span>
                          <span style={{
                            fontSize: 10, fontWeight: 700, padding: "1px 7px", borderRadius: 999,
                            background: row.status === "on_invoice" ? "#eef9f0" : "#fff5e9",
                            color: row.status === "on_invoice" ? "#1b7a42" : "#b54708",
                            border: `1px solid ${row.status === "on_invoice" ? "#c4e9d0" : "#f5d9b5"}`,
                          }}>
                            {row.status === "on_invoice" ? "Invoiced" : "Pending"}
                          </span>
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
          {/* Recurring-cost schedule — this phase's recurring cost spread
              across its billing periods, shown as a collapsible dated list
              (same treatment as the carry-forward schedule above). Renders
              only for phases that carry a recurring cost. */}
          {recurringSchedule.length > 0 && (
            <div style={{
              marginBottom: 12, border: "1px solid #cfe0f5", borderRadius: 8,
              background: "#f6faff", overflow: "hidden",
            }}>
              <button
                type="button"
                onClick={() => setRecurringOpen((o) => !o)}
                aria-expanded={recurringOpen}
                style={{
                  width: "100%", border: "none", background: "transparent", cursor: "pointer",
                  display: "flex", alignItems: "center", justifyContent: "space-between",
                  gap: 8, padding: "10px 12px", textAlign: "left",
                }}
              >
                <span style={{ fontSize: 12.5, fontWeight: 800, color: "#0b3c88", display: "inline-flex", alignItems: "center", gap: 8 }}>
                  <span aria-hidden="true">🔁</span>
                  Recurring Cost Schedule
                  <span style={{
                    fontSize: 10, fontWeight: 700, padding: "1px 7px", borderRadius: 999,
                    background: "#e6eefb", color: "#0b3c88", border: "1px solid #cfe0f5",
                  }}>
                    {recurringSchedule.length} {recurringSchedule.length === 1 ? "installment" : "installments"}
                  </span>
                </span>
                <span style={{ fontSize: 12, color: "var(--uidai-pmis-muted)" }}>
                  {inr(recurringPerPeriod)} / period {recurringOpen ? "▲" : "▼"}
                </span>
              </button>

              {recurringMilestoneNames.length > 0 && (
                <div style={{ display: "flex", flexWrap: "wrap", gap: 6, padding: "0 12px 10px" }}>
                  {recurringMilestoneNames.map((name, i) => (
                    <span key={i} style={{
                      display: "inline-flex", alignItems: "center", gap: 6,
                      fontSize: 11.5, fontWeight: 700, color: "#0b3c88",
                      background: "#fff", border: "1px solid #cfe0f5",
                      borderRadius: 999, padding: "3px 10px",
                    }}>
                      <span aria-hidden="true">🏁</span>
                      {name}
                    </span>
                  ))}
                </div>
              )}

              {recurringOpen && (
                <div style={{ padding: "0 12px 12px" }}>
                  <div style={{ fontSize: 11, color: "var(--uidai-pmis-muted)", marginBottom: 8 }}>
                    The recurring cost of {inr(recurringTotal)} is scheduled across this phase's billing periods.
                  </div>
                  <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                    {recurringSchedule.map((row, i) => (
                      <div key={row.periodIndex ?? i} style={{
                        display: "flex", justifyContent: "space-between", alignItems: "center",
                        gap: 8, fontSize: 12, padding: "5px 8px",
                        background: "#fff", border: "1px solid var(--uidai-pmis-border)", borderRadius: 6,
                      }}>
                        <span style={{ color: "#173e77", fontWeight: 600 }}>
                          {fmtDMY(row.periodStart)} – {fmtDMY(row.periodEnd)}
                        </span>
                        <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
                          <span style={{ fontWeight: 700, color: "#173e77", fontVariantNumeric: "tabular-nums" }}>
                            {inr(row.amount)}
                          </span>
                          <span style={{
                            fontSize: 10, fontWeight: 700, padding: "1px 7px", borderRadius: 999,
                            background: row.status === "on_invoice" ? "#eef9f0" : "#fff5e9",
                            color: row.status === "on_invoice" ? "#1b7a42" : "#b54708",
                            border: `1px solid ${row.status === "on_invoice" ? "#c4e9d0" : "#f5d9b5"}`,
                          }}>
                            {row.status === "on_invoice" ? "Invoiced" : "Pending"}
                          </span>
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
          <div className="uidai-pmis-table-wrap">
            <table className="uidai-pmis-table uidai-pmis-table-compact">
              <thead>
                <tr style={{ verticalAlign: "middle" }}>
                  <th style={{ minWidth: 240 }}>Milestone</th>
                  <th style={{ width: 150 }}>Activity</th>
                  <th style={{ width: 80, textAlign: "center" }}>INTERVAL</th>
                  <th style={{ width: 110, textAlign: "right" }}>
                    % of Payment
                    <span style={{
                      display: "block", fontWeight: 500, fontSize: 10.5,
                      color: "var(--uidai-pmis-muted)", textTransform: "none", letterSpacing: 0,
                    }}>
                      (Fixed + One-time)
                    </span>
                  </th>
                  {/* The milestone's allotment — its full share of the phase,
                      and the base LD / penalties are computed on. Separate
                      from what it is actually paid above. */}
                  <th style={{ width: 120, textAlign: "right" }}>
                    LD Basis %
                    <span style={{
                      display: "block", fontWeight: 500, fontSize: 10.5,
                      color: "var(--uidai-pmis-muted)", textTransform: "none", letterSpacing: 0,
                    }}>
                      (penalty base)
                    </span>
                  </th>
                  <th style={{ width: 130, textAlign: "right" }}>Value</th>
                  <th style={{ width: 220 }}>Breakup (Total / % / Remaining)</th>
                  <th style={{ width: 200, textAlign: "center" }}>Action</th>
                </tr>
              </thead>
              <tbody>
                {terms.length === 0 ? (
                  <tr>
                    <td colSpan={8} style={{ textAlign: "center", padding: 18, color: "var(--uidai-pmis-muted)" }}>
                      No payment terms — terms are auto-created from the cost rows on this phase.
                    </td>
                  </tr>
                ) : terms.map((t, idx) => {
                  if (t.__recurring) {
                    return (
                      <tr key={t.id}>
                        <td>
                          <span style={{ display: "inline-flex", alignItems: "center", gap: 7 }}>
                            <span aria-hidden="true" style={{ fontSize: 13 }}>🏁</span>
                            <strong style={{ color: "#173e77" }}>{milestoneName(t.milestoneId)}</strong>
                          </span>
                        </td>
                        <td><span style={{ color: "var(--uidai-pmis-muted)" }}>—</span></td>
                        <td style={{ textAlign: "center" }}>
                          {t.cycleCount != null
                            ? <span style={{ display: "inline-block", padding: "2px 8px", borderRadius: 999, background: "#eef9f0", color: "#1b7a42", fontSize: 12, fontWeight: 600, border: "1px solid #c4e9d0" }}>{t.cycleCount}</span>
                            : <span style={{ color: "var(--uidai-pmis-muted)" }}>—</span>}
                        </td>
                        <td style={{ textAlign: "right" }}><span style={{ color: "var(--uidai-pmis-muted)" }}>—</span></td>
                        {/* Recurring costs carry no % and therefore no LD basis. */}
                        <td style={{ textAlign: "right" }}><span style={{ color: "var(--uidai-pmis-muted)" }}>—</span></td>
                        <td style={{ fontWeight: 700, color: "#173e77", textAlign: "right", whiteSpace: "nowrap" }} title={wordsHint(t.value)}>
                          ₹ {Number(t.value).toLocaleString("en-IN")}
                        </td>
                        <td>
                          <span style={{ display: "inline-block", padding: "1px 8px", borderRadius: 999, background: "#eef3fb", color: "#0b3c88", fontSize: 10.5, fontWeight: 700, border: "1px solid #cfe0f5" }}>Recurring cost</span>
                        </td>
                        <td style={{ textAlign: "center" }}><span style={{ color: "var(--uidai-pmis-muted)" }}>—</span></td>
                      </tr>
                    );
                  }
                  const value = Number(t.value) || 0;
                  const pct = Number(t.percentOfPayment) || 0;
                  /* Running balance: each row's remaining = base minus every
                     term value up to and including this one, so it carries
                     down from the previous row's remaining. */
                  const scheduledSoFar = terms
                    .slice(0, idx + 1)
                    .reduce((s, r) => s + (Number(r.value) || 0), 0);
                  const remaining = phaseBase - scheduledSoFar;
                  /* Per-activity split — the backend returns activities[]
                     only for partial-payment terms (complete_payment terms
                     come back with []). So presence of the array is the
                     single source of truth for whether the row expands. */
                  const acts = Array.isArray(t.activities) ? t.activities : [];
                  const showActivities = acts.length > 0;
                  /* Resource-based milestone: each activity's `value` is the
                     resource cost snapshotted when that activity was saved
                     (from its allocation rows), and `percentOfPayment` is
                     merely derived from it. The split is therefore
                     cost-driven and can't be edited here — the manual split
                     endpoint rejects these terms. */
                  const isResourceTerm = resourceCostItemIds.has(t.costItemId);
                  return (
                    <React.Fragment key={t.id}>
                    <tr style={expandedTerms.has(t.id) ? { background: "#eef5ff" } : undefined}>
                      <td>
                        <span style={{ display: "inline-flex", alignItems: "center", gap: 7 }}>
                          <span aria-hidden="true" style={{ fontSize: 13 }}>🏁</span>
                          <strong style={{ color: "#173e77" }}>{milestoneName(t.milestoneId)}</strong>
                        </span>
                      </td>
                      <td>
                        {/* Activities expand only for partial-payment terms
                            (those the backend returned activities[] for);
                            complete-payment terms show a dash. */}
                        {showActivities ? (
                          <button
                            type="button"
                            onClick={() => toggleTermExpand(t.id)}
                            aria-expanded={expandedTerms.has(t.id)}
                            style={{
                              display: "inline-flex", alignItems: "center", gap: 6,
                              border: "1px solid #cfe0f5", background: "#eef3fb",
                              color: "#0b3c88", fontSize: 11, fontWeight: 700,
                              borderRadius: 999, padding: "2px 10px", cursor: "pointer",
                            }}
                          >
                            <span style={{ fontSize: 9 }}>{expandedTerms.has(t.id) ? "▾" : "▸"}</span>
                            Activities ({acts.length})
                          </button>
                        ) : (
                          <span style={{ color: "var(--uidai-pmis-muted)" }}>—</span>
                        )}
                      </td>
                      <td style={{ textAlign: "center" }}>
                        {t.cycleCount != null
                          ? <span style={{
                              display: "inline-block", padding: "2px 8px", borderRadius: 999,
                              background: "#eef9f0", color: "#1b7a42", fontSize: 12, fontWeight: 600,
                              border: "1px solid #c4e9d0",
                            }}>{t.cycleCount}</span>
                          : <span style={{ color: "var(--uidai-pmis-muted)" }}>—</span>}
                      </td>
                      <td style={{ textAlign: "right" }}>
                        {t.percentOfPayment == null
                          ? <span style={{ color: "var(--uidai-pmis-muted)" }}>—</span>
                          : <strong style={{ color: "#173e77" }}>{Number(t.percentOfPayment)} %</strong>}
                      </td>
                      {typeof onSaveLdBasis === "function" ? (
                        <LdBasisCell
                          term={t}
                          disabled={isLocked}
                          busy={ldBasisBusy}
                          onSave={onSaveLdBasis}
                        />
                      ) : (
                        <td style={{ textAlign: "right" }}>
                          {t.ldBasisPercent == null
                            ? <span style={{ color: "var(--uidai-pmis-muted)" }}>—</span>
                            : <strong style={{ color: "#173e77" }}>{Number(t.ldBasisPercent)} %</strong>}
                        </td>
                      )}
                      <td style={{ fontWeight: 700, color: "#173e77", textAlign: "right", whiteSpace: "nowrap" }} title={wordsHint(value)}>
                        ₹ {value.toLocaleString("en-IN")}
                      </td>
                      <td>
                        <div style={{ display: "flex", flexDirection: "column", gap: 2, fontSize: 11, lineHeight: 1.4 }}>
                          <span style={muted} title={wordsHint(phaseBase)}>Total: <strong style={{ color: "#173e77" }}>{inr(phaseBase)}</strong></span>
                          <span style={{ color: "#173e77" }} title={wordsHint(value)}>{pct}% of Total Payment: {inr(value)}</span>
                          <span title={wordsHint(remaining)} style={{fontWeight: 700,color: remaining > 0 ? "#b54708" : "#1b7a42",}}>
                            Remaining: {inr(remaining)}
                          </span>
                        </div>
                      </td>
                      <td style={{ textAlign: "center" }}>
                       <div style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                        <button
                          type="button"
                          className="uidai-pmis-iconbtn"
                          title="Edit payment term"
                          aria-label="Edit payment term"
                          disabled={isLocked}
                          onClick={() => onEditTerm(t)}
                        >
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none"
                            stroke="currentColor" strokeWidth="2"
                            strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                            <path d="M12 20h9" />
                            <path d="M16.5 3.5a2.121 2.121 0 1 1 3 3L7 19l-4 1 1-4 12.5-12.5z" />
                          </svg>
                        </button>
                        {/* Generate Invoice hidden */}
                       </div>
                      </td>
                    </tr>
                    {/* Activity-wise breakdown for a partial-payment term —
                        the term's value/% split across its activities, as
                        returned by the backend. The Edit pencil opens the
                        weightage modal for the whole term. */}
                    {showActivities && expandedTerms.has(t.id) && acts.map((a, ai) => {
                      const aPct = Number(a.percentOfPayment) || 0;
                      const aVal = Number(a.value) || 0;
                      const last = ai === acts.length - 1;
                      const code = a.activityDisplayCode || a.activityId;
                      return (
                        <tr key={`${t.id}-act-${a.activityId || ai}`} style={{ background: "#f6faff" }}>
                          <td style={{ borderLeft: "3px solid #0aa1c0", borderBottom: last ? undefined : "none" }} />
                          <td style={{ paddingLeft: 14 }}>
                            <span style={{ display: "inline-flex", alignItems: "center", gap: 7 }}>
                              <span style={{ width: 6, height: 6, borderRadius: "50%", background: "#0aa1c0", display: "inline-block" }} />
                              <span
                                style={{ color: "#0b3c88", fontSize: 12.5, fontWeight: 600 }}
                                title={a.activityName || a.name || a.activityDescription || code}
                              >
                                {code}
                              </span>
                            </span>
                          </td>
                          <td style={{ textAlign: "center" }}><span style={{ color: "var(--uidai-pmis-muted)" }}>—</span></td>
                          <td style={{ textAlign: "right" }}>
                            <strong style={{ color: "#173e77" }}>{aPct} %</strong>
                            {/* On a resource milestone this % is derived from
                                the cost, not set — say so rather than letting
                                it read as an editable weightage. */}
                            {isResourceTerm && (
                              <span style={{ display: "block", fontSize: 10, color: "var(--uidai-pmis-muted)" }}>
                                derived
                              </span>
                            )}
                          </td>
                          {/* LD basis is a milestone-level allotment — activities
                              don't carry one of their own. */}
                          <td style={{ textAlign: "right" }}><span style={{ color: "var(--uidai-pmis-muted)" }}>—</span></td>
                          <td
                            style={{ fontWeight: 700, color: "#173e77", textAlign: "right", whiteSpace: "nowrap" }}
                            title={isResourceTerm
                              ? "Resource cost of this activity — the total of its resource allocation, snapshotted when the activity was saved"
                              : wordsHint(aVal)}
                          >
                            ₹ {aVal.toLocaleString("en-IN")}
                          </td>
                          <td>
                            <span style={{
                              display: "inline-block", padding: "1px 8px", borderRadius: 999,
                              background: isResourceTerm ? "#eef9f0" : "#e6f6fa",
                              color: isResourceTerm ? "#1b7a42" : "#067a93",
                              fontSize: 10.5, fontWeight: 700,
                              border: `1px solid ${isResourceTerm ? "#c4e9d0" : "#bfe7ef"}`,
                            }}>
                              {isResourceTerm ? "Resource cost" : "Activity-wise"}
                            </span>
                          </td>
                          <td style={{ textAlign: "center" }}>
                            {isResourceTerm ? (
                              /* The split here is the resource cost itself, so
                                 there is nothing to weight — it changes by
                                 editing the activity's resource allocation. */
                              <span
                                style={{ fontSize: 10.5, color: "var(--uidai-pmis-muted)" }}
                                title="Set on the activity's Resource Allocation, not here"
                              >
                                From allocation
                              </span>
                            ) : (
                            <button
                              type="button"
                              title="Edit activity split"
                              aria-label={`Edit activity split for ${code}`}
                              disabled={isLocked}
                              onClick={() => onEditActivities(t)}
                              style={{
                                width: 28, height: 28,
                                display: "inline-flex", alignItems: "center", justifyContent: "center",
                                border: "1px solid #bfe7ef",
                                background: "#fff",
                                color: "#067a93",
                                borderRadius: 6,
                                cursor: isLocked ? "not-allowed" : "pointer",
                                opacity: isLocked ? 0.5 : 1,
                                padding: 0,
                                transition: "background .15s, border-color .15s, transform .15s",
                              }}
                              onMouseEnter={(e) => {
                                if (isLocked) return;
                                e.currentTarget.style.background = "#eaf7fb";
                                e.currentTarget.style.transform = "translateY(-1px)";
                              }}
                              onMouseLeave={(e) => {
                                e.currentTarget.style.background = "#fff";
                                e.currentTarget.style.transform = "translateY(0)";
                              }}
                            >
                              <svg width="13" height="13" viewBox="0 0 24 24" fill="none"
                                stroke="currentColor" strokeWidth="2"
                                strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                                <path d="M12 20h9" />
                                <path d="M16.5 3.5a2.121 2.121 0 1 1 3 3L7 19l-4 1 1-4 12.5-12.5z" />
                              </svg>
                            </button>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                    </React.Fragment>
                  );
                })}
                {terms.length > 0 && !isSyntheticOnly && (
                  <tr style={{ background: "#f1f6fd" }}>
                    <td colSpan={4} style={{ fontWeight: 800, color: "#173e77", textAlign: "right" }}>
                      Total
                    </td>
                    {/* Allotments must total exactly 100% for the phase — flag
                        the total in red the moment they don't. */}
                    <td
                      style={{
                        fontWeight: 800, textAlign: "right", whiteSpace: "nowrap",
                        color: ldBasisBalanced ? "#1b7a42" : "#b3261e",
                      }}
                      title={
                        ldBasisBalanced
                          ? "LD Basis % totals 100% for this phase"
                          : `LD Basis % must total 100% for this phase — currently ${totalLdBasis}%`
                      }
                    >
                      {totalLdBasis} %
                    </td>
                    <td style={{ fontWeight: 800, color: "#173e77", textAlign: "right", whiteSpace: "nowrap" }} title={wordsHint(totalValue)}>
                      ₹ {totalValue.toLocaleString("en-IN")}
                    </td>
                    <td style={{ lineHeight: 1.3, fontWeight: 800 }}>
                      <div style={{ fontSize: 15, color: phaseRemaining > 0 ? "#b54708" : "#1b7a42" }} title={wordsHint(phaseRemaining)}>
                        Remaining: {inr(phaseRemaining)}
                      </div>
                    </td>
                    <td />
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          {!isSyntheticOnly && (
          <div style={{ marginTop: 12, display: "flex", alignItems: "center", justifyContent: "right", flexWrap: "wrap", gap: 10 }}>
            {/* The final phase must schedule the full contract — i.e. its
                payment terms have to total exactly 100%. Flag any shortfall
                or overage so it can't be left unbalanced. */}
            {isLastPhase && terms.length > 0 && totalPercent !== 100 ? (
              <span className="uidai-pmis-chip is-bad" style={{ borderRadius: 8 }}>
                <span aria-hidden="true">⚠</span>
                Last phase must total 100% — currently {totalPercent}%
                {totalPercent < 100
                  ? ` (${100 - totalPercent}% short)`
                  : ` (${totalPercent - 100}% over)`}
              </span>
            ) : <span />}
            <span
              className={`uidai-pmis-chip${
                totalPercent > 100 ? " is-bad" : totalPercent === 100 ? " is-good" : ""
              }`}
            >
              Scheduled: {totalPercent}%{totalPercent > 100 && " · over 100%"}
            </span>
            <span
              className={`uidai-pmis-chip${
                totalPercent > 100 ? " is-bad" : totalPercent === 100 ? " is-good" : ""
              }`}
            >
              Remaining: {totalPercent < 100 && ` · ${100 - totalPercent}% remaining`}
            </span>
            {/* Allotment total — must be exactly 100% per phase, independent of
                how much of it is actually scheduled for payment. */}
            <span
              className={`uidai-pmis-chip${ldBasisBalanced ? " is-good" : " is-bad"}`}
              title="Penalties / LD are calculated on each milestone's LD Basis %"
            >
              LD Basis: {totalLdBasis}%
              {!ldBasisBalanced && " · must total 100%"}
            </span>
          </div>
          )}
        </div>

      {showFreqModal && (
        <div className="uidai-modal" role="dialog" aria-modal="true">
          <div className="uidai-modal__box" style={{ width: "min(520px, 100%)" }}>
            <button
              type="button"
              aria-label="Close"
              onClick={() => setShowFreqModal(false)}
              style={{
                position: "absolute", top: 8, right: 10, width: 28, height: 28,
                border: "none", background: "transparent", fontSize: 22, lineHeight: 1,
                cursor: "pointer", color: "#666", padding: 0,
              }}
            >
              ×
            </button>
            <h3 className="uidai-modal__title">Apply Frequency — Phase {phase.phase}</h3>
            <div className="uidai-pmis-subtitle" style={{ margin: "4px 0 16px" }}>
              Set the start date, end date and frequency for this phase's payment cycles.
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
              <div className="uidai-pmis-field" style={{ marginBottom: 0 }}>
                <label>Start Date</label>
                <input type="text" value={fmtDMY(freqStart)} disabled title="Set on the phase" />
              </div>
              <div className="uidai-pmis-field" style={{ marginBottom: 0 }}>
                <label>End Date</label>
                <input type="text" value={fmtDMY(freqEnd)} disabled title="Set on the phase" />
              </div>
            </div>
            <div className="uidai-pmis-field" style={{ marginTop: 14, marginBottom: 0 }}>
              <label>Frequency</label>
              <select value={freqCode} onChange={(e) => setFreqCode(e.target.value)}>
                <option value="">— Select —</option>
                {frequencies.map((f) => <option key={f.code} value={f.code}>{f.name}</option>)}
              </select>
            </div>

            <div className="uidai-modal__actions" style={{ justifyContent: "flex-end" }}>
              <button
                type="button"
                className="uidai-pmis-btn uidai-pmis-btn-cancel uidai-pmis-btn-small"
                onClick={() => setShowFreqModal(false)}
                disabled={applyingFreq}
              >
                Cancel
              </button>
              <button
                type="button"
                className="uidai-pmis-btn uidai-pmis-btn-small"
                style={{ marginTop: 0 }}
                disabled={applyingFreq}
                onClick={async () => {
                  if (!freqCode) {
                    uiStore.showError("Pick a frequency.");
                    return;
                  }
                  setApplyingFreq(true);
                  const ok = await onApplyFrequency(phase.phase, freqCode);
                  setApplyingFreq(false);
                  if (ok) setShowFreqModal(false);
                }}
              >
                {applyingFreq ? "Applying…" : "Apply"}
              </button>
            </div>
          </div>
        </div>
      )}

      <CarryForwardModal
        open={cfModalOpen}
        onClose={() => setCfModalOpen(false)}
        phaseLabel={phase.phase}
        methods={carryMethods}
        initialEnabled={cfEnabled}
        initialMethodCode={cfMethodCode}
        initialAllocations={cfAllocations}
        leftover={cfLeftover}
        laterPhases={laterPhases}
        laterMilestones={laterMilestones}
        projectFrequencyCode={projectFrequencyCode}
        onApply={(body) => {
          setCfModalOpen(false);
          onSetCarryForward(phase.phase, body);
        }}
      />

      <OneTimeCostModal
        open={otModalOpen}
        onClose={() => setOtModalOpen(false)}
        phaseLabel={phase.phase}
        total={oneTimeTotal}
        available={otAvailable}
        initialConfig={otInitialConfig}
        isLastPhase={isLastPhase}
        autoRemainder={otLastAbsorb}
        onApply={(cfg) => {
          setOtModalOpen(false);
          onSetOneTime(phase.phase, cfg);
        }}
      />
    </div>
  );
}

/* ──────────────────────────────────────────────────────────────────
   CarryForwardSummarySection — read-only per-phase roll-up in the right
   column below the Summary card. The on/off toggle + mode picker live in
   each phase's collapsible header on the left; this panel reports, for
   every phase: scheduled %, delivery cost, and (from phase.carryForward)
   the leftover carried out and the amount received from earlier phases.
   ────────────────────────────────────────────────────────────────── */
function CarryForwardSummarySection({ phases, totals, carryMethods = [] }) {
  if (!phases || phases.length === 0) return null;

  /* Remaining balance = Total Contract Cost minus everything already
     scheduled through the payment terms (sum of each term's ₹ value
     across all phases). It's the portion of the contract not yet
     committed to a payment term. */
  const totalContractCost = Number(totals?.totalContractCost) || 0;
  const totalScheduled = phases.reduce(
    (s, p) => s + (p.paymentTerms || []).reduce((a, t) => a + (Number(t.value) || 0), 0),
    0
  );
  const totalRemaining = totalContractCost - totalScheduled;

  const stat = (label, value, opts = {}) => (
    <div style={{
      display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 8,
      fontSize: 12, padding: "5px 0",
      borderTop: opts.first ? "none" : "1px solid #eef1f6",
    }}>
      <span style={muted}>{label}</span>
      <strong style={{ color: opts.color || "#173e77", fontVariantNumeric: "tabular-nums" }}>{value}</strong>
    </div>
  );

  return (
    <div style={{ padding: 18 }}>
      <div style={{
        display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
        fontSize: 14, fontWeight: 800, color: "#173e77",
        letterSpacing: 0.5, textTransform: "uppercase",
        paddingBottom: 12, marginBottom: 14,
        borderBottom: "1px solid var(--uidai-pmis-border)",
      }}>
        Phase Summary
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        {phases.map((p, i) => {
          const isLast = i === phases.length - 1;
          const terms = p.paymentTerms || [];
          const totalPercent = terms.reduce((s, r) => s + (Number(r.percentOfPayment) || 0), 0);
          const phaseTotal = terms.reduce((s, r) => s + (Number(r.value) || 0), 0);
          const phaseFixed = Number(p.effectivePhaseTotal || p.phaseFixedTotal || 0);
          const oneTimeAllocated = Number(p.oneTimeAllocated) || 0;
          const cf = p.carryForward || {};
          const yes = !!cf.enabled;
          const cfMethodName =
            carryMethods.find((m) => m.code === cf.methodCode)?.name || cf.methodCode || "";
          const carriedOut = Number(cf.carriedOut) || 0;
          const received = (Number(cf.received) || 0) + (Number(cf.receivedMilestone) || 0);
          return (
            <div
              key={p.phase}
              style={{
                border: yes ? "1px solid #1b7a42" : "1px solid var(--uidai-pmis-border)",
                background: yes ? "#f1faf4" : "#fff",
                borderRadius: 10,
                padding: "12px 14px",
                boxShadow: yes
                  ? "0 2px 6px rgba(27, 122, 66, 0.10)"
                  : "0 1px 2px rgba(20, 50, 110, 0.04)",
              }}
            >
              <div style={{
                display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8,
                fontWeight: 800, color: "#173e77", fontSize: 13,
                paddingBottom: 8, marginBottom: 8,
                borderBottom: "1px solid var(--uidai-pmis-border)",
              }}>
                <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                  Phase {p.phase}
                </span>
              </div>

              <div style={{ display: "flex", flexDirection: "column" }}>
                {stat("Scheduled", `${totalPercent}%`,
                  { first: true, color: totalPercent > 100 ? "var(--uidai-pmis-red)" : "#173e77" })}
                {stat("Total Cost", inr(phaseFixed))}

                {oneTimeAllocated > 0 && stat(
                  isLast ? "Out of Pocket Expense (auto)" : "Out of Pocket Expense",
                  inr(oneTimeAllocated),
                  { color: "#0b6b8f" }
                )}
                {stat("Carried Forward",
                  yes ? inr(carriedOut) : "—",
                  { color: yes ? "#1b7a42" : "#a3afc1" })}
                {cfMethodName && yes ? stat("Type", cfMethodName, { color: "#0b6b8f" }) : null}
                {stat("Carry Forward Received",
                  received > 0 ? inr(received) : "—",
                  { color: received > 0 ? "#173e77" : "#a3afc1" })}
              </div>
            </div>
          );
        })}
      </div>

      {/* Total remaining balance — contract cost not yet committed to terms. */}
      <div style={{
        display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8,
        marginTop: 14, padding: "12px 14px",
        background: "linear-gradient(135deg, var(--uidai-pmis-navy), var(--uidai-pmis-cyan))",
        color: "#fff", borderRadius: 10,
        boxShadow: "0 4px 10px rgba(23, 62, 119, 0.18)",
      }}>
        <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: 0.5, textTransform: "uppercase" }}>
          Carry Forward Remaining Balance
        </span>
        <strong style={{ fontSize: 16, color: "#fff" }} title={wordsHint(totalRemaining)}>
          {inr(totalRemaining)}
        </strong>
      </div>
    </div>
  );
}

/* ──────────────────────────────────────────────────────────────────
   CarryForwardSummarySection — read-only per-phase roll-up in the right
   column below the Summary card. The on/off toggle + mode picker live in
   each phase's collapsible header on the left; this panel reports, for
   every phase: scheduled %, delivery cost, and (from phase.carryForward)
   the leftover carried out and the amount received from earlier phases.
   ────────────────────────────────────────────────────────────────── */
// function CarryForwardSummarySection({ phases, totals, carryMethods = [] }) {
//   if (!phases || phases.length === 0) return null;

//   /* Remaining balance = Total Contract Cost minus everything already
//      scheduled through the payment terms (sum of each term's ₹ value
//      across all phases). It's the portion of the contract not yet
//      committed to a payment term. */
//   const totalContractCost = Number(totals?.totalContractCost) || 0;
//   const totalScheduled = phases.reduce(
//     (s, p) => s + (p.paymentTerms || []).reduce((a, t) => a + (Number(t.value) || 0), 0),
//     0
//   );
//   const totalRemaining = totalContractCost - totalScheduled;

//   const stat = (label, value, opts = {}) => (
//     <div style={{
//       display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 8,
//       fontSize: 12, padding: "5px 0",
//       borderTop: opts.first ? "none" : "1px solid #eef1f6",
//     }}>
//       <span style={muted}>{label}</span>
//       <strong style={{ color: opts.color || "#173e77", fontVariantNumeric: "tabular-nums" }}>{value}</strong>
//     </div>
//   );

//   return (
//     <div style={{ padding: 18 }}>
//       <div style={{
//         display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
//         fontSize: 14, fontWeight: 800, color: "#173e77",
//         letterSpacing: 0.5, textTransform: "uppercase",
//         paddingBottom: 12, marginBottom: 14,
//         borderBottom: "1px solid var(--uidai-pmis-border)",
//       }}>
//         Phase Summary
//       </div>

//       <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
//         {phases.map((p, i) => {
//           const isLast = i === phases.length - 1;
//           const realTerms = phase.paymentTerms || [];
// const recurringItems = (costItems || []).filter(
//   (c) => c.costTypeCode === "recurring_cost" && c.phase === phase.phase
// );
// const terms = realTerms.length
//   ? realTerms
//   : recurringItems.flatMap((c) =>
//       (Array.isArray(c.milestoneIds) ? c.milestoneIds : []).map((mid) => ({
//         id: `recurring-${c.id}-${mid}`,
//         milestoneId: mid,
//         percentOfPayment: null,
//         value: Number(c.total) || 0,
//         cycleCount: phase.cycleCount,
//         activities: [],
//         __recurring: true,
//       }))
//     );
//           const totalPercent = terms.reduce((s, r) => s + (Number(r.percentOfPayment) || 0), 0);
//           const phaseTotal = terms.reduce((s, r) => s + (Number(r.value) || 0), 0);
//           const phaseFixed = Number(p.effectivePhaseTotal || p.phaseFixedTotal || 0);
//           const oneTimeAllocated = Number(p.oneTimeAllocated) || 0;
//           const cf = p.carryForward || {};
//           const yes = !!cf.enabled;
//           const cfMethodName =
//             carryMethods.find((m) => m.code === cf.methodCode)?.name || cf.methodCode || "";
//           const carriedOut = Number(cf.carriedOut) || 0;
//           const received = (Number(cf.received) || 0) + (Number(cf.receivedMilestone) || 0);
//           return (
//             <div
//               key={p.phase}
//               style={{
//                 border: yes ? "1px solid #1b7a42" : "1px solid var(--uidai-pmis-border)",
//                 background: yes ? "#f1faf4" : "#fff",
//                 borderRadius: 10,
//                 padding: "12px 14px",
//                 boxShadow: yes
//                   ? "0 2px 6px rgba(27, 122, 66, 0.10)"
//                   : "0 1px 2px rgba(20, 50, 110, 0.04)",
//               }}
//             >
//               <div style={{
//                 display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8,
//                 fontWeight: 800, color: "#173e77", fontSize: 13,
//                 paddingBottom: 8, marginBottom: 8,
//                 borderBottom: "1px solid var(--uidai-pmis-border)",
//               }}>
//                 <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
//                   Phase {p.phase}
//                   {/* {yes && (
//                     <span style={{
//                       fontSize: 9, fontWeight: 800, letterSpacing: 0.4,
//                       padding: "1px 6px", borderRadius: 999,
//                       background: "#1b7a42", color: "#fff",
//                     }}
//                     >
//                       Carry Forward Cost
//                     </span>
//                   )} */}
//                 </span>
//                 {/* <span style={{ fontWeight: 800, color: "#173e77" }} title={wordsHint(phaseTotal)}>{inr(phaseTotal)}</span> */}
//               </div>

//               <div style={{ display: "flex", flexDirection: "column" }}>
//                 {stat("Scheduled", `${totalPercent}%`,
//                   { first: true, color: totalPercent > 100 ? "var(--uidai-pmis-red)" : "#173e77" })}
//                 {stat("Total Cost", inr(phaseFixed))}
                
//                 {oneTimeAllocated > 0 && stat(
//                   isLast ? "Out of Pocket Expense (auto)" : "Out of Pocket Expense",
//                   inr(oneTimeAllocated),
//                   { color: "#0b6b8f" }
//                 )}
//                 {stat("Carried Forward",
//                   yes ? inr(carriedOut) : "—",
//                   { color: yes ? "#1b7a42" : "#a3afc1" })}
//                 {cfMethodName && yes ? stat("Type", cfMethodName, { color: "#0b6b8f" }) : null}
//                 {stat("Carry Forward Received",
//                   received > 0 ? inr(received) : "—",
//                   { color: received > 0 ? "#173e77" : "#a3afc1" })}
//               </div>
//             </div>
//           );
//         })}
//       </div>

//       {/* Total remaining balance — contract cost not yet committed to terms. */}
//       <div style={{
//         display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8,
//         marginTop: 14, padding: "12px 14px",
//         background: "linear-gradient(135deg, var(--uidai-pmis-navy), var(--uidai-pmis-cyan))",
//         color: "#fff", borderRadius: 10,
//         boxShadow: "0 4px 10px rgba(23, 62, 119, 0.18)",
//       }}>
//         <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: 0.5, textTransform: "uppercase" }}>
//           Carry Forward Remaining Balance
//         </span>
//         <strong style={{ fontSize: 16, color: "#fff" }} title={wordsHint(totalRemaining)}>
//           {inr(totalRemaining)}
//         </strong>
//       </div>
//     </div>
//   );
// }
