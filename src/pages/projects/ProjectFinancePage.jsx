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
    if (!open) { setPos((p) => ({ ...p, ready: false })); return; }
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
  const total = Number(totals?.totalContractCost) || 0;
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
          <strong style={{ color: "#173e77" }}>{inr(fixed)}</strong>
        </div>
        <div style={{
          display: "flex", justifyContent: "space-between", alignItems: "center",
          gap: 8, fontSize: 13,
          background: "#fff", border: "1px solid var(--uidai-pmis-border)",
          borderRadius: 8, padding: "8px 12px",
        }}>
          <span style={muted}>One-Time Cost</span>
          <strong style={{ color: "#173e77" }}>{inr(oneTime)}</strong>
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
          <strong style={{ fontSize: 18, color: "#fff" }}>{inr(total)}</strong>
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

/* ──────────────────────────────────────────────────────────────────
   Add Cost Item modal — replaces the previous inline form. Renders
   into the standard `.uidai-modal` shell so it inherits the project's
   navy→cyan stripe, dimming overlay, and width treatment.
   ────────────────────────────────────────────────────────────────── */
function AddCostItemModal({
  open, onClose, onSubmit, submitting,
  costTypes, milestones, hasOneTime, disabledMilestoneIds,
}) {
  const [draft, setDraft] = useState({
    costTypeCode: "fixed", phase: "", cost: "", taxAmount: "", milestoneIds: [],
  });
  // Reseed the draft each time the modal opens.
  useEffect(() => {
    if (open) {
      setDraft({
        costTypeCode: "fixed", phase: "", cost: "", taxAmount: "", milestoneIds: [],
      });
    }
  }, [open]);

  if (!open) return null;
  /* Only one_time is a standalone amount row (no phase, no milestones).
     fixed, resource_cost and transaction_cost all carry phase +
     milestones, so those fields show for everything except one_time. */
  const isOneTime = draft.costTypeCode === "one_time";

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
              mandatory
                type="text"
                value={draft.phase}
                placeholder="Phase"
                onChange={(e) => setDraft((d) => ({ ...d, phase: e.target.value }))}
              />
            )}
          </div>
          <div className="uidai-pmis-field" style={{ marginBottom: 0 }}>
            <label>Cost (₹)</label>
            <input
              type="number"
              min="0"
              value={draft.cost}
              onChange={(e) => setDraft((d) => ({ ...d, cost: e.target.value }))}
            />
          </div>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "minmax(120px, 200px) minmax(0, 1fr)", gap: 14, marginTop: 14 }}>
          <div className="uidai-pmis-field" style={{ marginBottom: 0 }}>
            <label>Tax Amount (₹)</label>
            <input
              type="number"
              min="0"
              value={draft.taxAmount}
              onChange={(e) => setDraft((d) => ({ ...d, taxAmount: e.target.value }))}
            />
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
            disabled={submitting || !draft.phase || !draft.cost || !draft.taxAmount}
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
    costTypeCode: "fixed", phase: "", cost: "", taxAmount: "", milestoneIds: [],
  });

  useEffect(() => {
    if (!open || !row) return;
    const isOne = row.costTypeCode === "one_time";
    const taxAmt = row.taxAmount != null
      ? row.taxAmount
      : (row.taxPercent != null
          ? (Number(row.cost) || 0) * (Number(row.taxPercent) / 100)
          : "");
    setDraft({
      costTypeCode: row.costTypeCode || "fixed",
      phase: isOne ? "" : (row.phase ?? ""),
      cost: row.cost != null ? String(row.cost) : "",
      taxAmount: taxAmt === "" ? "" : String(taxAmt),
      milestoneIds: !isOne && Array.isArray(row.milestoneIds) ? row.milestoneIds.slice() : [],
    });
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
          <div className="uidai-pmis-field" style={{ marginBottom: 0 }}>
            <label>Cost (₹)</label>
            <input
              type="number"
              min="0"
              value={draft.cost}
              onChange={(e) => setDraft((d) => ({ ...d, cost: e.target.value }))}
            />
          </div>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "minmax(120px, 200px) minmax(0, 1fr)", gap: 14, marginTop: 14 }}>
          <div className="uidai-pmis-field" style={{ marginBottom: 0 }}>
            <label>Tax Amount (₹)</label>
            <input
              type="number"
              min="0"
              value={draft.taxAmount}
              onChange={(e) => setDraft((d) => ({ ...d, taxAmount: e.target.value }))}
            />
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
function CostItemActions({ row, isLocked, isDeleting, onEdit, onDelete }) {
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
   phase level via Apply Frequency); only % of Payment is editable.
   Save PATCHes the term and the parent silently re-loads the page.
   ────────────────────────────────────────────────────────────────── */
function EditTermModal({
  open, onClose, term, onSubmit, submitting, milestoneName,
}) {
  const [percentOfPayment, setPercentOfPayment] = useState("");

  useEffect(() => {
    if (!open || !term) return;
    setPercentOfPayment(
      term.percentOfPayment === null || term.percentOfPayment === undefined
        ? ""
        : String(term.percentOfPayment)
    );
  }, [open, term]);

  if (!open || !term) return null;

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
            <label>Cycle</label>
            <input
              type="text"
              value={term.cycleCount == null ? "" : String(term.cycleCount)}
              disabled
              title="Set via Apply Frequency"
            />
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
            onClick={() => onSubmit({
              percentOfPayment:
                percentOfPayment === "" || percentOfPayment === null
                  ? null
                  : Number(percentOfPayment),
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
  const [summaryCollapsed, setSummaryCollapsed] = useState(false);
  /* Payment Terms: phases render as tabs (like the org tabs at the top);
     only the selected phase's panel is shown. */
  const [activePhaseIdx, setActivePhaseIdx] = useState(0);

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
      if (!silent || ccnInput === "") {
        const cap = data?.ccn?.capPercent;
        setCcnInput(cap !== null && cap !== undefined ? String(cap) : "");
        const act = data?.ccn?.additionalCostType;
        if (act) setAdditionalCostType(String(act).toLowerCase());
      }
    } catch (err) {
      if (handleAuthError(err)) return;
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
  /* Order phases chronologically — earliest startDate first, latest endDate
     last. This makes "subsequent phases" (used to divide a phase's
     carry-forward) mean the phases that come AFTER it in time: laterPhases
     = phases.slice(idx + 1) on this sorted list. Phases missing a startDate
     sort to the end. */
  const phases = useMemo(() => {
    const list = page?.phases || [];
    const ts = (d) => {
      const t = d ? Date.parse(d) : NaN;
      return Number.isNaN(t) ? Infinity : t;
    };
    return [...list].sort((a, b) => {
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
  const ccnCapPctServer = page?.ccn?.capPercent;
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
    if (draft.cost === "" || draft.taxAmount === "") {
      uiStore.showError("Enter both Cost and Tax Amount.");
      return;
    }
    if (draft.costTypeCode === "fixed" && draft.milestoneIds.length === 0) {
      uiStore.showError("Pick at least one milestone for a Fixed cost row.");
      return;
    }
    if (draft.costTypeCode === "one_time" && hasOneTimeNow) {
      uiStore.showError("Only one One-Time cost row is allowed per project.");
      return;
    }
    const body =
      draft.costTypeCode === "one_time"
        ? {
          /* one_time is the only standalone row — no phase, no milestones. */
          costTypeCode: "one_time",
          cost: Number(draft.cost),
          taxAmount: Number(draft.taxAmount),
        }
        : {
          /* fixed / resource_cost / transaction_cost — all carry phase +
             milestones; send the actual selected code. */
          costTypeCode: draft.costTypeCode,
          phase: draft.phase || "default",
          cost: Number(draft.cost),
          taxAmount: Number(draft.taxAmount),
          milestoneIds: draft.milestoneIds,
        };
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
    if (draft.cost === "" || draft.taxAmount === "") {
      uiStore.showError("Enter both Cost and Tax Amount.");
      return;
    }
    if (draft.costTypeCode === "fixed" && draft.milestoneIds.length === 0) {
      uiStore.showError("Pick at least one milestone for a Fixed cost row.");
      return;
    }
    const body =
      draft.costTypeCode === "one_time"
        ? {
            /* one_time is the only standalone row — no phase, no milestones. */
            costTypeCode: "one_time",
            cost: Number(draft.cost),
            taxAmount: Number(draft.taxAmount),
          }
        : {
            /* fixed / resource_cost / transaction_cost — all carry phase +
               milestones; send the actual selected code. */
            costTypeCode: draft.costTypeCode,
            phase: draft.phase || "default",
            cost: Number(draft.cost),
            taxAmount: Number(draft.taxAmount),
            milestoneIds: draft.milestoneIds,
          };
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
  async function saveTerm(term, { percentOfPayment }) {
    if (!term) return false;

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
          onClick={() =>
            navigate(`/projects/${encodeURIComponent(projectId)}`, {
              // Signal the detail page to auto-open the Publish modal when
              // the project isn't published yet (final step of the flow).
              state: { autoPublish: true },
            })
          }
        >
          Save and Next →
        </button>
      </div>

      {/* Project name now lives in the global navbar's right-side pill
          (NavProjectName in Layout, fed via setPageContext above), so the
          in-page header pill was removed. */}

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
                  transition: "background .15s, color .15s",
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
                        <td>{costTypeLabel(r.costTypeCode)}</td>
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
                        <td>{inr(r.cost)}</td>
                        <td >
                          {isOneTime
                            ? <span style={disabledCell}></span>
                            : (r.phase ?? "—")}
                        </td>
                        <td>{taxAmt == null ? "—" : inr(taxAmt)}</td>
                        <td style={{ fontWeight: 700, color: "#173e77" }}>{inr(r.total)}</td>
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
                    onGenerateInvoice={generateInvoice}
                    onApplyFrequency={applyPhaseFrequency}
                    isLocked={isLocked}
                    isLastPhase={activePhaseIdx === phases.length - 1}
                    carryLocked={isLocked || carrySaving}
                    carryBusy={carrySaving}
                    onSetCarryForward={setCarryForward}
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
                ? "the One-Time cost row"
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
  const [rows, setRows] = useState([]);

  useEffect(() => {
    if (!open || !term) return;
    setRows(
      (term.activities || []).map((a) => ({
        activityId: a.activityId,
        activityDisplayCode: a.activityDisplayCode || a.activityId,
        percentOfPayment:
          a.percentOfPayment === null || a.percentOfPayment === undefined
            ? ""
            : String(a.percentOfPayment),
      }))
    );
  }, [open, term]);

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
  leftover = 0, laterPhases = [], laterMilestones = [],
  projectFrequencyCode = "",
}) {
  const [methodCode, setMethodCode] = useState(initialMethodCode);
  const [unit, setUnit] = useState("percent");       // allocationMode: 'percent' | 'amount'
  const [alloc, setAlloc] = useState({});            // recipientKey -> string

  /* Seed on open: select the saved method and pre-fill any saved custom
     split (backend returns allocations[] with recipientKey + allocMode +
     inputValue/percent). */
  useEffect(() => {
    if (open) {
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
    }
  }, [open, initialMethodCode, initialAllocations]);

  const selected = methods.find((m) => m.code === methodCode) || null;
  const selMethod = selected?.method || "";          // phase | milestone | time
  const isCustom = (selected?.variant || "") === "custom";
  const isTime = selMethod === "time";

  /* Recipients only matter for the *_custom variants: later phases for
     phase_custom, subsequent milestones for milestone_custom. */
  const recipients = useMemo(() => (
    selMethod === "phase"
      ? laterPhases.map((p) => ({ key: String(p.phase), label: `Phase ${p.phase}` }))
      : selMethod === "milestone"
        ? laterMilestones.map((m) => ({ key: String(m.id), label: m.name }))
        : []
  ), [selMethod, laterPhases, laterMilestones]);

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
    !!selected && !timeBlocked && (!isCustom || (recipients.length > 0 && sumOk));

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
              ? "Set a project frequency first — time-based carry-forward weights the split by each later phase's cycle count."
              : `Leftover is split across later phases, weighted by each phase's cycle count at the project frequency (${projectFrequencyCode}).`}
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

        <div style={{ marginTop: 14, fontSize: 11, color: "var(--uidai-pmis-muted)" }}>
          Saved to the backend, which recomputes every phase. Note: only
          testable once the carry-forward backend is deployed.
        </div>

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
              isCustom
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
function PhasePanel({
  phase, allPhases = [],
  milestoneName, milestoneStatus = () => "Not Completed",
  frequencies = [], carryMethods = [], projectFrequencyCode = "",
  onEditTerm, onEditActivities, onGenerateInvoice, onApplyFrequency,
  isLocked, isLastPhase, carryLocked, carryBusy, onSetCarryForward,
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
  const terms = phase.paymentTerms || [];
  const totalPercent = terms.reduce((s, r) => s + (Number(r.percentOfPayment) || 0), 0);
  const totalValue = terms.reduce((s, r) => s + (Number(r.value) || 0), 0);
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
  const [cfModalOpen, setCfModalOpen] = useState(false);

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
          display: "flex", alignItems: "center",
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
              {phase.cycleCount} {Number(phase.cycleCount) === 1 ? "Cycle" : "Cycles"}
            </span>
          )}

          {canToggleCarry && (
            <div
              onClick={(e) => e.stopPropagation()}
              style={{ display: "inline-flex", alignItems: "center", gap: 7 }}
            >
              <span style={{ fontSize: 11, fontWeight: 800, color: "#173e77", letterSpacing: 0.3 }}>
                Carry Forward Cost
              </span>
              {/* Two separate pill buttons (not a fused segmented control) so
                  both Yes and No are always clearly visible: the active one is
                  filled, the inactive one is outlined. "Yes" opens the config
                  popup; "No" turns carry-forward off. */}
              <div role="group" aria-label={`Carry forward leftover from Phase ${phase.phase}`}
                style={{ display: "inline-flex", gap: 6, opacity: cfDisabled ? 0.6 : 1 }}>
                <button
                  type="button"
                  disabled={cfDisabled}
                  aria-pressed={cfEnabled}
                  onClick={() => setCfModalOpen(true)}
                  style={{
                    padding: "4px 16px",
                    minWidth: 48,
                    textAlign: "center",
                    borderRadius: 999,
                    border: cfEnabled ? "1px solid #1b7a42" : "1px solid var(--uidai-pmis-border)",
                    background: cfEnabled ? "#1b7a42" : "#fff",
                    color: cfEnabled ? "#fff" : "#173e77",
                    fontWeight: 700, fontSize: 12,
                    cursor: cfDisabled ? "not-allowed" : "pointer",
                  }}
                >
                  Yes
                </button>
                <button
                  type="button"
                  disabled={cfDisabled}
                  aria-pressed={!cfEnabled}
                  onClick={() => onSetCarryForward(phase.phase, { enabled: false })}
                  style={{
                    padding: "4px 16px",
                    minWidth: 48,
                    textAlign: "center",
                    borderRadius: 999,
                    border: !cfEnabled ? "1px solid #5b6b82" : "1px solid var(--uidai-pmis-border)",
                    background: !cfEnabled ? "#5b6b82" : "#fff",
                    color: !cfEnabled ? "#fff" : "#173e77",
                    fontWeight: 700, fontSize: 12,
                    cursor: cfDisabled ? "not-allowed" : "pointer",
                  }}
                >
                  No
                </button>
              </div>

              {/* When enabled, show the saved mode + (local) method, and let
                  the user reopen the popup to edit. */}
              {cfEnabled && (
                <button
                  type="button"
                  onClick={() => setCfModalOpen(true)}
                  style={{
                    border: "1px solid var(--uidai-pmis-border)",
                    borderRadius: 999, padding: "3px 10px",
                    fontSize: 11, fontWeight: 700, color: "#173e77", background: "#fff",
                    cursor: "pointer",
                  }}
                >
                  {cfMethodName || "Configure"}
                  {" ✎"}
                </button>
              )}

              {cfIsLast && (
                <span style={{ fontSize: 10.5, color: "var(--uidai-pmis-muted)", fontWeight: 600 }}>
                  Last phase — n/a
                </span>
              )}
            </div>
          )}
        </div>
      </div>

      <div style={{ padding: 16 }}>
          <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 10 }}>
            <button
              type="button"
              className="uidai-pmis-btn uidai-pmis-btn-small"
              style={{ marginTop: 0 }}
              disabled={isLocked || terms.length === 0}
              onClick={() => {
                /* Start/end come from the phase (read-only); seed frequency
                   from the first term when nothing has been chosen yet. */
                setFreqStart(toDateInput(phase.startDate));
                setFreqEnd(toDateInput(phase.endDate));
                setFreqCode((c) => c || terms[0]?.frequencyCode || "");
                setShowFreqModal(true);
              }}
            >
              Apply Frequency
            </button>
          </div>
          <div className="uidai-pmis-table-wrap">
            <table className="uidai-pmis-table uidai-pmis-table-compact">
              <thead>
                <tr style={{ verticalAlign: "middle" }}>
                  <th style={{ minWidth: 240 }}>Milestone</th>
                  <th style={{ width: 150 }}>Activity</th>
                  <th style={{ width: 80, textAlign: "center" }}>Cycle</th>
                  <th style={{ width: 110, textAlign: "right" }}>
                    % of Payment
                    <span style={{
                      display: "block", fontWeight: 500, fontSize: 10.5,
                      color: "var(--uidai-pmis-muted)", textTransform: "none", letterSpacing: 0,
                    }}>
                      (Fixed + One-time)
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
                    <td colSpan={7} style={{ textAlign: "center", padding: 18, color: "var(--uidai-pmis-muted)" }}>
                      No payment terms — terms are auto-created from the cost rows on this phase.
                    </td>
                  </tr>
                ) : terms.map((t, idx) => {
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
                      <td style={{ fontWeight: 700, color: "#173e77", textAlign: "right", whiteSpace: "nowrap" }}>
                        ₹ {value.toLocaleString("en-IN")}
                      </td>
                      <td>
                        <div style={{ display: "flex", flexDirection: "column", gap: 2, fontSize: 11, lineHeight: 1.4 }}>
                          <span style={muted}>Total: <strong style={{ color: "#173e77" }}>{inr(phaseBase)}</strong></span>
                          <span style={{ color: "#173e77" }}>{pct}% of Payment: {inr(value)}</span>
                          <span style={{ fontWeight: 700, color: remaining > 0 ? "#b54708" : "#1b7a42" }}>
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
                        {(() => {
                          const msComplete = milestoneStatus(t.milestoneId) === "Completed";
                          const genDisabled = isLocked || !msComplete;
                          return (
                            <button
                              type="button"
                              className="uidai-pmis-pillbtn"
                              title={
                                msComplete
                                  ? "Generate invoice for this milestone"
                                  : "Available only when the milestone status is Completed"
                              }
                              aria-label="Generate invoice"
                              disabled={genDisabled}
                              onClick={() => onGenerateInvoice(t)}
                            >
                              <svg width="14" height="14" viewBox="0 0 24 24" fill="none"
                                stroke="currentColor" strokeWidth="2"
                                strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                                <path d="M14 2v6h6" />
                                <path d="M9 13h6M9 17h6" />
                              </svg>
                              Generate Invoice
                            </button>
                          );
                        })()}
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
                              <span style={{ color: "#0b3c88", fontSize: 12.5, fontWeight: 600 }}>{code}</span>
                            </span>
                          </td>
                          <td style={{ textAlign: "center" }}><span style={{ color: "var(--uidai-pmis-muted)" }}>—</span></td>
                          <td style={{ textAlign: "right" }}><strong style={{ color: "#173e77" }}>{aPct} %</strong></td>
                          <td style={{ fontWeight: 700, color: "#173e77", textAlign: "right", whiteSpace: "nowrap" }}>₹ {aVal.toLocaleString("en-IN")}</td>
                          <td>
                            <span style={{
                              display: "inline-block", padding: "1px 8px", borderRadius: 999,
                              background: "#e6f6fa", color: "#067a93", fontSize: 10.5, fontWeight: 700,
                              border: "1px solid #bfe7ef",
                            }}>Activity-wise</span>
                          </td>
                          <td style={{ textAlign: "center" }}>
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
                          </td>
                        </tr>
                      );
                    })}
                    </React.Fragment>
                  );
                })}
                {terms.length > 0 && (
                  <tr style={{ background: "#f1f6fd" }}>
                    <td colSpan={4} style={{ fontWeight: 800, color: "#173e77", textAlign: "right" }}>
                      Total
                    </td>
                    <td style={{ fontWeight: 800, color: "#173e77", textAlign: "right", whiteSpace: "nowrap" }}>
                      ₹ {totalValue.toLocaleString("en-IN")}
                    </td>
                    <td style={{ fontSize: 11, lineHeight: 1.4, fontWeight: 700 }}>
                      <div style={{ color: "#173e77" }}>Total: {inr(phaseBase)}</div>
                      <div style={{ color: phaseRemaining > 0 ? "#b54708" : "#1b7a42" }}>
                        Remaining: {inr(phaseRemaining)}
                      </div>
                    </td>
                    <td />
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          <div style={{ marginTop: 12, display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 10 }}>
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
          </div>
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
        {phases.map((p) => {
          const terms = p.paymentTerms || [];
          const totalPercent = terms.reduce((s, r) => s + (Number(r.percentOfPayment) || 0), 0);
          const phaseTotal = terms.reduce((s, r) => s + (Number(r.value) || 0), 0);
          const phaseFixed = Number(p.effectivePhaseTotal || p.phaseFixedTotal || 0);
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
                  {yes && (
                    <span style={{
                      fontSize: 9, fontWeight: 800, letterSpacing: 0.4,
                      padding: "1px 6px", borderRadius: 999,
                      background: "#1b7a42", color: "#fff",
                    }}>
                      Carry Forward Cost
                    </span>
                  )}
                </span>
                <span style={{ fontWeight: 800, color: "#173e77" }}>{inr(phaseTotal)}</span>
              </div>

              <div style={{ display: "flex", flexDirection: "column" }}>
                {stat("Scheduled", `${totalPercent}%`,
                  { first: true, color: totalPercent > 100 ? "var(--uidai-pmis-red)" : "#173e77" })}
                {stat("Delivery Cost", inr(phaseFixed))}
                {stat("Carried Forward",
                  yes ? `${inr(carriedOut)}${cfMethodName ? ` · ${cfMethodName}` : ""}` : "—",
                  { color: yes ? "#1b7a42" : "#a3afc1" })}
                {stat("Received",
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
          Total Remaining Balance
        </span>
        <strong style={{ fontSize: 16, color: "#fff" }}>{inr(totalRemaining)}</strong>
      </div>
    </div>
  );
}
