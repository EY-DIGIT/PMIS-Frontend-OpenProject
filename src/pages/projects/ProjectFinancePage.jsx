import React, { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useProject } from "../../store/project/projectsStore";
import { uiStore } from "../../store/project/uiStore";
import { API_BASE, authorizedFetch } from "../../api/client";
import { ENDPOINTS } from "../../api/endpoint";
import { getToken, logout } from "../../api/auth";
import "../../styles/global.css";

/* ────────────────────────────────────────────────────────────────────
   Project Finance page — wired against the Payment Module API:

     GET   /master/cost-types                       — cost-type catalog
     GET   /master/frequencies                      — frequency catalog
     GET   /projects/{pid}/payment-page             — full hydrated state
     GET   /projects/{pid}/milestones               — milestone id → name
     POST  /projects/{pid}/cost-items               — add a cost row
     PATCH /projects/payment-terms/{tid}            — set frequency + %
     PUT   /projects/{pid}/phases/{n}/qrg           — toggle QGR per phase
     PATCH /projects/{pid}/ccn-cap                  — set CCN cap %

   The /payment-page response is the single source of truth — every
   mutation refreshes it so totals, derived values and QRG stay in sync.
   ──────────────────────────────────────────────────────────────────── */

function inr(n) {
  const v = Number(n);
  if (!Number.isFinite(v)) return "₹ 0";
  return `₹ ${v.toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;
}

const ctrl = {
  width: "100%",
  padding: "8px 10px",
  border: "1px solid var(--uidai-pmis-border)",
  borderRadius: 6,
  background: "#fff",
  color: "var(--uidai-pmis-text)",
  font: "inherit",
  fontSize: 13,
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

  return (
    <div style={{ position: "relative" }}>
      <button
        type="button"
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
          overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
          color: labels.length ? "var(--uidai-pmis-text)" : "var(--uidai-pmis-muted)",
        }}>
          {labels.length ? labels.join(", ") : "Select milestones…"}
        </span>
        <span style={{ ...muted, fontSize: 11 }}>▾</span>
      </button>
      {open && !disabled && (
        <div style={{
          position: "absolute", top: "calc(100% + 4px)", left: 0, right: 0, zIndex: 30,
          background: "#fff", border: "1px solid var(--uidai-pmis-border)",
          borderRadius: 8, boxShadow: "0 10px 24px rgba(0,0,0,.10)",
          maxHeight: 200, overflowY: "auto", padding: 4,
        }}>
          {options.length === 0 ? (
            <div style={{ padding: 10, fontSize: 12, ...muted }}>No milestones available</div>
          ) : options.map((opt) => {
            const locked = isLocked(opt.id);
            return (
              <label key={opt.id}
                title={locked ? "Already used in another cost item" : undefined}
                style={{
                  display: "flex", alignItems: "center", gap: 8, padding: "6px 8px",
                  borderRadius: 6,
                  cursor: locked ? "not-allowed" : "pointer",
                  fontSize: 13,
                  color: locked ? "#9aa6bb" : "var(--uidai-pmis-text)",
                  background: locked ? "#f3f6fb" : "transparent",
                }}
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
                  checked={selected.includes(opt.id)}
                  style={{ width: "auto" }}
                />
                <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {opt.name}
                </span>
                {locked && (
                  <span style={{
                    fontSize: 10, fontWeight: 700, letterSpacing: 0.3,
                    padding: "1px 6px", borderRadius: 999,
                    background: "#eef2f7", color: "#5a6680", border: "1px solid #d8e0ec",
                  }}>
                    USED
                  </span>
                )}
              </label>
            );
          })}
        </div>
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
      <div style={{
        display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
        fontSize: 14, fontWeight: 800, color: "#173e77",
        letterSpacing: 0.5, textTransform: "uppercase",
        paddingBottom: 12, marginBottom: 14,
        borderBottom: "1px solid var(--uidai-pmis-border)",
      }}>
        <span aria-hidden="true">💼</span> Summary
      </div>

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
    costTypeCode: "fixed", phase: 1, cost: "", taxAmount: "", milestoneIds: [],
  });
  // Reseed the draft each time the modal opens.
  useEffect(() => {
    if (open) {
      setDraft({
        costTypeCode: "fixed", phase: 1, cost: "", taxAmount: "", milestoneIds: [],
      });
    }
  }, [open]);

  if (!open) return null;
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
                  phase: next === "one_time" ? "" : (d.phase || 1),
                  milestoneIds: next === "one_time" ? [] : d.milestoneIds,
                }));
              }}
            >
              {costTypes.length === 0 ? (
                <option value="fixed">Fixed</option>
              ) : costTypes.map((c) => (
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
                type="number"
                min="1"
                value={draft.phase}
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
          <div className="uidai-pmis-field" style={{ marginBottom: 0 }}>
            <label>Tax Amount (₹)</label>
            <input
              type="number"
              min="0"
              value={draft.taxAmount}
              onChange={(e) => setDraft((d) => ({ ...d, taxAmount: e.target.value }))}
            />
          </div>
        </div>

        <div className="uidai-pmis-field" style={{ marginTop: 14, marginBottom: 0 }}>
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
    costTypeCode: "fixed", phase: 1, cost: "", taxAmount: "", milestoneIds: [],
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
      phase: isOne ? "" : (row.phase ?? 1),
      cost: row.cost != null ? String(row.cost) : "",
      taxAmount: taxAmt === "" ? "" : String(taxAmt),
      milestoneIds: Array.isArray(row.milestoneIds) ? row.milestoneIds.slice() : [],
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
                  phase: next === "one_time" ? "" : (d.phase || 1),
                  milestoneIds: next === "one_time" ? [] : d.milestoneIds,
                }));
              }}
            >
              {costTypes.length === 0 ? (
                <option value="fixed">Fixed</option>
              ) : costTypes.map((c) => (
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
                type="number"
                min="1"
                value={draft.phase}
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
          <div className="uidai-pmis-field" style={{ marginBottom: 0 }}>
            <label>Tax Amount (₹)</label>
            <input
              type="number"
              min="0"
              value={draft.taxAmount}
              onChange={(e) => setDraft((d) => ({ ...d, taxAmount: e.target.value }))}
            />
          </div>
        </div>

        <div className="uidai-pmis-field" style={{ marginTop: 14, marginBottom: 0 }}>
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
  const baseBtn = {
    width: 32, height: 32,
    display: "inline-flex", alignItems: "center", justifyContent: "center",
    border: "1px solid var(--uidai-pmis-border)",
    background: "#fff",
    borderRadius: 6,
    padding: 0,
    transition: "background .15s, border-color .15s, transform .15s",
  };
  return (
    <div style={{ display: "inline-flex", gap: 6 }}>
      <button
        type="button"
        title="Edit cost item"
        aria-label="Edit cost item"
        disabled={isLocked || isDeleting}
        onClick={onEdit}
        style={{
          ...baseBtn,
          color: "#173e77",
          cursor: isLocked ? "not-allowed" : "pointer",
          opacity: isLocked ? 0.5 : 1,
        }}
        onMouseEnter={(e) => {
          if (isLocked) return;
          e.currentTarget.style.background = "#eaf4ff";
          e.currentTarget.style.borderColor = "#0aa1c0";
          e.currentTarget.style.transform = "translateY(-1px)";
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.background = "#fff";
          e.currentTarget.style.borderColor = "var(--uidai-pmis-border)";
          e.currentTarget.style.transform = "translateY(0)";
        }}
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
        title="Delete cost item"
        aria-label="Delete cost item"
        disabled={isLocked || isDeleting}
        onClick={onDelete}
        style={{
          ...baseBtn,
          color: "#9b1c1c",
          cursor: isLocked || isDeleting ? "not-allowed" : "pointer",
          opacity: isLocked || isDeleting ? 0.5 : 1,
        }}
        onMouseEnter={(e) => {
          if (isLocked || isDeleting) return;
          e.currentTarget.style.background = "#fdecec";
          e.currentTarget.style.borderColor = "#e3a5a5";
          e.currentTarget.style.transform = "translateY(-1px)";
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.background = "#fff";
          e.currentTarget.style.borderColor = "var(--uidai-pmis-border)";
          e.currentTarget.style.transform = "translateY(0)";
        }}
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
   clicked. Holds local frequency + % state; Save PATCHes the term
   and the parent silently re-loads the payment page.
   ────────────────────────────────────────────────────────────────── */
function EditTermModal({
  open, onClose, term, onSubmit, submitting,
  frequencies, milestoneName,
}) {
  const [frequencyCode, setFrequencyCode] = useState("");
  const [percentOfPayment, setPercentOfPayment] = useState("");

  useEffect(() => {
    if (!open || !term) return;
    setFrequencyCode(term.frequencyCode || "");
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
            <label>Frequency</label>
            <select
              value={frequencyCode || ""}
              onChange={(e) => setFrequencyCode(e.target.value)}
            >
              <option value="">— Select —</option>
              {frequencies.map((f) => <option key={f.code} value={f.code}>{f.name}</option>)}
            </select>
          </div>
          <div className="uidai-pmis-field" style={{ marginBottom: 0 }}>
            <label>% of Payment</label>
            <input
              type="number"
              min="0" max="100"
              value={percentOfPayment}
              onChange={(e) => setPercentOfPayment(e.target.value)}
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
              frequencyCode: frequencyCode || null,
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

export default function ProjectFinancePage() {
  const { projectId } = useParams();
  const navigate = useNavigate();
  const project = useProject(projectId);

  // ── Master data ──
  const [costTypes, setCostTypes] = useState([]);
  const [frequencies, setFrequencies] = useState([]);
  const [milestones, setMilestones] = useState([]);

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

  // ── Edit Payment Term modal ──
  const [editingTerm, setEditingTerm] = useState(null);
  const [savingTerm, setSavingTerm] = useState(false);

  // ── CCN cap edit buffer ──
  const [ccnInput, setCcnInput] = useState("");
  const [ccnSaving, setCcnSaving] = useState(false);

  // ── QGR mutation guard — blocks concurrent cascades that could
  //    otherwise leave two phases showing Yes at once. ──
  const [qgrSaving, setQgrSaving] = useState(false);

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

  async function loadMilestones() {
    if (!projectId) return;
    try {
      const res = await authorizedFetch(
        `${API_BASE}${ENDPOINTS.projects.milestones(projectId)}?offset=1&pageSize=100&includeDeleted=false`,
      );
      const payload = await readJson(res);
      const list = extractElements(payload)
        .filter((m) => m && m.id)
        .map((m) => ({ id: m.id, name: m.name || m.title || m.id }));
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
    loadMilestones();
    loadPaymentPage();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId]);

  // ── Derived ──────────────────────────────────────────────────────
  const costItems = page?.costItems || [];
  const phases = page?.phases || [];
  const totals = page?.totals || {};
  const ccnCapPctServer = page?.ccn?.capPercent;
  const ccnValueServer = page?.ccn?.value;
  const isLocked = !!page?.isLocked;

  const phaseNumbersFromCosts = useMemo(() => {
    const set = new Set();
    costItems.forEach((c) => { if (c.phase) set.add(Number(c.phase)); });
    return Array.from(set).sort((a, b) => a - b);
  }, [costItems]);

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
      draft.costTypeCode === "fixed"
        ? {
          costTypeCode: "fixed",
          phase: Number(draft.phase) || 1,
          cost: Number(draft.cost),
          taxAmount: Number(draft.taxAmount),
          milestoneIds: draft.milestoneIds,
        }
        : {
          costTypeCode: "one_time",
          cost: Number(draft.cost),
          taxAmount: Number(draft.taxAmount),
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
      draft.costTypeCode === "fixed"
        ? {
            costTypeCode: "fixed",
            phase: Number(draft.phase) || 1,
            cost: Number(draft.cost),
            taxAmount: Number(draft.taxAmount),
            milestoneIds: draft.milestoneIds,
          }
        : {
            costTypeCode: "one_time",
            cost: Number(draft.cost),
            taxAmount: Number(draft.taxAmount),
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

  async function deleteCostItem(row) {
    if (!row?.id) return;
    const label = row.costTypeCode === "one_time" ? "the One-Time cost row" : `the ${costTypeLabel(row.costTypeCode)} cost row`;
    if (!window.confirm(`Delete ${label}? This cannot be undone.`)) return;
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

  async function submitTermEdit({ frequencyCode, percentOfPayment }) {
    if (!editingTerm) return;
    setSavingTerm(true);
    try {
      const res = await authorizedFetch(`${API_BASE}${ENDPOINTS.paymentTerms.update(editingTerm.id)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ frequencyCode, percentOfPayment }),
      });
      await readJson(res);
      setEditingTerm(null);
      await loadPaymentPage({ silent: true });
      uiStore.showMessage("Payment term updated.");
    } catch (err) {
      if (handleAuthError(err)) return;
      uiStore.showError(err?.message || "Failed to update payment term");
    } finally {
      setSavingTerm(false);
    }
  }

  async function setQrgForPhase(phase, applied) {
    /* Mutual exclusion: only one phase can carry QGR=Yes at a time.
       When the user turns Yes on for `phase`, we PUT every other
       currently-applied phase to false, then PUT the target to true.
       Turning Yes off (applied=false) just updates the target.

       The `qgrSaving` flag blocks re-entry so a second click during
       the cascade can't leave two phases looking Yes at once, and we
       optimistically flip the local `page.phases[*].qrg.applied`
       array so the UI reflects the single-Yes invariant immediately
       (the silent reload at the end overwrites with backend truth). */
    if (qgrSaving) return;
    setQgrSaving(true);
    const snapshot = page;
    try {
      if (applied) {
        /* Optimistic UI — every other phase loses Yes the moment the
           user clicks, even before the network round-trip. */
        setPage((prev) => prev && ({
          ...prev,
          phases: (prev.phases || []).map((p) => {
            if (p.phase === phase) {
              return { ...p, qrg: { ...(p.qrg || {}), applied: true } };
            }
            if (p.qrg?.applied) {
              return { ...p, qrg: { ...p.qrg, applied: false } };
            }
            return p;
          }),
        }));

        const others = (snapshot?.phases || [])
          .filter((p) => p.phase !== phase && !!p.qrg?.applied);
        for (const p of others) {
          const r = await authorizedFetch(`${API_BASE}${ENDPOINTS.projects.qrg(projectId, p.phase)}`, {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ qrgApplied: false }),
          });
          await readJson(r);
        }
      } else {
        setPage((prev) => prev && ({
          ...prev,
          phases: (prev.phases || []).map((p) =>
            p.phase === phase
              ? { ...p, qrg: { ...(p.qrg || {}), applied: false } }
              : p
          ),
        }));
      }

      const res = await authorizedFetch(`${API_BASE}${ENDPOINTS.projects.qrg(projectId, phase)}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ qrgApplied: !!applied }),
      });
      await readJson(res);
      await loadPaymentPage({ silent: true });
    } catch (err) {
      /* Revert the optimistic change on failure so the UI never shows
         two phases with Yes after a partial cascade. */
      setPage(snapshot);
      if (handleAuthError(err)) return;
      uiStore.showError(err?.message || "Failed to update QGR");
    } finally {
      setQgrSaving(false);
    }
  }

  async function saveCcnCap() {
    if (ccnInput === "" || ccnInput === null) {
      uiStore.showError("Enter a CCN Cap %.");
      return;
    }
    setCcnSaving(true);
    try {
      const res = await authorizedFetch(`${API_BASE}${ENDPOINTS.projects.ccnCap(projectId)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ccnCapPercent: Number(ccnInput) }),
      });
      const payload = await readJson(res);
      setPage(payload?.data ?? payload);
      uiStore.showMessage("CCN Cap updated.");
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

  function costTypeLabel(code) {
    return costTypes.find((c) => c.code === code)?.name ||
      (code === "fixed" ? "Fixed" : code === "one_time" ? "One-Time" : code);
  }

  function frequencyName(code) {
    if (!code) return "";
    return frequencies.find((f) => f.code === code)?.name || code;
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
      {/* Slim header — just the project name on the right (and the
          LOCKED chip if applicable). The long descriptive subtitle
          was dropped at the user's request. */}
      <div style={{
        display: "flex", justifyContent: "flex-end", alignItems: "center", gap: 10,
        marginTop: 0, marginBottom: 12,
      }}>
        <span style={{
          fontSize: 13, fontWeight: 700, color: "#fff",
          padding: "4px 14px", borderRadius: 999,
          background: "linear-gradient(135deg, var(--uidai-pmis-navy), var(--uidai-pmis-cyan))",
          boxShadow: "0 2px 6px rgba(23, 62, 119, 0.18)",
          letterSpacing: 0.2,
        }}>
          {page?.projectName || project?.projectName || ""}
        </span>
        {isLocked && (
          <span style={{
            padding: "2px 8px", borderRadius: 999,
            background: "#fff4e0", color: "#a35a00", fontWeight: 700, fontSize: 11,
          }}>
            LOCKED
          </span>
        )}
      </div>

      {/* Page-wide 2-column grid: every editable section sits on the
          left; the Summary panel sits on the right and sticks while
          the user scrolls through the long left column. */}
      <div style={{
        display: "grid",
        gridTemplateColumns: "minmax(0, 1fr) 320px",
        gap: 20,
        alignItems: "start",
      }}>
        <div style={{ minWidth: 0 }}>
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
                            : ((r.milestoneIds || []).map(milestoneName).join(", ") || "—")}
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
                            onEdit={() => setEditingCostItem(r)}
                            onDelete={() => deleteCostItem(r)}
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

          {/* Section 2 — Payment Terms (per phase, collapsible) */}
          <div className="uidai-pmis-card">
            <div style={sectionHead}><span style={stepBadge}>2</span> Payment Term</div>

            {phases.length === 0 && phaseNumbersFromCosts.length === 0 ? (
              <div style={{ padding: 18, textAlign: "center", ...muted, fontSize: 13 }}>
                Add a Fixed cost row with milestones to populate payment terms.
              </div>
            ) : phases.map((p) => (
              <PhasePanel
                key={p.phase}
                phase={p}
                milestoneName={milestoneName}
                frequencyName={frequencyName}
                onEditTerm={(t) => setEditingTerm(t)}
                isLocked={isLocked}
              />
            ))}
          </div>

          {/* Section 3 — CCN Cap & Value */}
          <div className="uidai-pmis-card">
            <div style={sectionHead}><span style={stepBadge}>3</span> CCN Cap &amp; Value</div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 18 }}>
              <div className="uidai-pmis-field" style={{ marginBottom: 0 }}>
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
              <div className="uidai-pmis-field" style={{ marginBottom: 0 }}>
                <label>CCN Value</label>
                <input value={inr(ccnValueServer)} disabled />
              </div>
            </div>
            <div style={{ marginTop: 12, display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 10 }}>
              <div style={{ fontSize: 12, ...muted }}>
                CCN Value = (CCN Cap % ÷ 100) × Total Contract Cost
                {ccnCapPctServer != null && (
                  <span style={{ marginLeft: 12 }}>
                    · Saved cap: <strong style={{ color: "#173e77" }}>{Number(ccnCapPctServer)} %</strong>
                  </span>
                )}
              </div>
              <button
                type="button"
                className="uidai-pmis-btn uidai-pmis-btn-small"
                style={{ marginTop: 0 }}
                onClick={saveCcnCap}
                disabled={ccnSaving || isLocked}
              >
                {ccnSaving ? "Saving…" : "Save CCN Cap"}
              </button>
            </div>
          </div>
        </div>

        {/* Right column — Summary + QGR fused into one sticky card so
            the eye reads them as a single status panel. The card itself
            owns the border + shadow; the inner sections render as bare
            content separated by a hairline divider. */}
        <div style={{
          position: "sticky",
          top: 16,
          background: "linear-gradient(180deg, #ffffff 0%, #f4f8fd 100%)",
          border: "1px solid var(--uidai-pmis-border)",
          borderRadius: 12,
          boxShadow: "0 4px 12px rgba(20, 50, 110, 0.06)",
          maxHeight: "calc(100vh - 32px)",
          overflowY: "auto",
        }}>
          <SummaryPanel totals={totals} />
          <div style={{
            height: 1,
            background: "var(--uidai-pmis-border)",
            margin: "0 16px",
          }} />
          <QgrConfigSection
            phases={phases}
            isLocked={isLocked || qgrSaving}
            busy={qgrSaving}
            onSetQrgForPhase={setQrgForPhase}
          />
        </div>
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
        onSubmit={submitTermEdit}
        submitting={savingTerm}
        frequencies={frequencies}
        milestoneName={milestoneName}
      />
    </div>
  );
}

/* Each phase renders as its own collapsible panel — header is always
   visible, body collapses. Frequency + % of Payment are first-class
   columns now; the row-level pencil button opens the EditTermModal
   which holds both. QGR moved out into the dedicated section below
   the Summary, so this panel stays focused on payment terms. */
function PhasePanel({
  phase, milestoneName, frequencyName, onEditTerm, isLocked,
}) {
  const [expanded, setExpanded] = useState(true);
  const terms = phase.paymentTerms || [];
  const totalPercent = terms.reduce((s, r) => s + (Number(r.percentOfPayment) || 0), 0);
  const qrgApplied = !!phase.qrg?.applied;

  return (
    <div style={{
      border: "1px solid var(--uidai-pmis-border)",
      borderRadius: 10,
      marginBottom: 14,
      background: "#fff",
      overflow: "hidden",
      boxShadow: "0 1px 2px rgba(20, 50, 110, 0.04)",
    }}>
      <button
        type="button"
        onClick={() => setExpanded((e) => !e)}
        style={{
          width: "100%",
          display: "flex", alignItems: "center", justifyContent: "space-between",
          background: "linear-gradient(90deg, #eef4fc 0%, #f5f9ff 100%)",
          border: "none",
          borderBottom: expanded ? "1px solid var(--uidai-pmis-border)" : "none",
          padding: "12px 16px",
          cursor: "pointer",
          font: "inherit",
          textAlign: "left",
        }}
      >
        <span style={{ fontWeight: 800, color: "#173e77", fontSize: 14, display: "inline-flex", alignItems: "center", gap: 8 }}>
          Phase {phase.phase}
          {qrgApplied && (
            <span style={{
              fontSize: 10, fontWeight: 800, letterSpacing: 0.4,
              padding: "2px 7px", borderRadius: 999,
              background: "#e6f6ec", color: "#1b7a42", border: "1px solid #c4e9d0",
            }}>
              QGR
            </span>
          )}
          <span style={{ color: "var(--uidai-pmis-muted)", fontWeight: 500, marginLeft: 4, fontSize: 12 }}>
            ({terms.length} term{terms.length === 1 ? "" : "s"} · {totalPercent}% scheduled · Phase Fixed: ₹ {Number(phase.phaseFixedTotal || 0).toLocaleString("en-IN")})
          </span>
        </span>
        <span style={{ color: "var(--uidai-pmis-muted)", fontSize: 14 }}>{expanded ? "▲ Collapse" : "▼ Expand"}</span>
      </button>

      {expanded && (
        <div style={{ padding: 16 }}>
          <div className="uidai-pmis-table-wrap">
            <table className="uidai-pmis-table uidai-pmis-table-compact">
              <thead>
                <tr>
                  <th style={{ width: 70 }}>Phase</th>
                  <th>Milestone</th>
                  <th style={{ width: 140 }}>Frequency</th>
                  <th style={{ width: 130 }}>% of Payment</th>
                  <th style={{ width: 170 }}>Value</th>
                  <th style={{ width: 90, textAlign: "center" }}>Action</th>
                </tr>
              </thead>
              <tbody>
                {terms.length === 0 ? (
                  <tr>
                    <td colSpan={6} style={{ textAlign: "center", padding: 18, color: "var(--uidai-pmis-muted)" }}>
                      No payment terms — terms are auto-created from the cost rows on this phase.
                    </td>
                  </tr>
                ) : terms.map((t) => {
                  const freqLabel = frequencyName ? frequencyName(t.frequencyCode) : (t.frequencyCode || "");
                  return (
                    <tr key={t.id}>
                      <td style={{ fontWeight: 700, color: "#173e77" }}>{t.phase}</td>
                      <td>{milestoneName(t.milestoneId)}</td>
                      <td>
                        {freqLabel
                          ? <span style={{
                              display: "inline-block", padding: "2px 8px", borderRadius: 999,
                              background: "#eef4fc", color: "#173e77", fontSize: 12, fontWeight: 600,
                            }}>{freqLabel}</span>
                          : <span style={{ color: "var(--uidai-pmis-muted)" }}>—</span>}
                      </td>
                      <td>
                        {t.percentOfPayment == null
                          ? <span style={{ color: "var(--uidai-pmis-muted)" }}>—</span>
                          : <strong style={{ color: "#173e77" }}>{Number(t.percentOfPayment)} %</strong>}
                      </td>
                      <td style={{ fontWeight: 700, color: "#173e77" }}>
                        ₹ {Number(t.value || 0).toLocaleString("en-IN")}
                      </td>
                      <td style={{ textAlign: "center" }}>
                        <button
                          type="button"
                          title="Edit payment term"
                          aria-label="Edit payment term"
                          disabled={isLocked}
                          onClick={() => onEditTerm(t)}
                          style={{
                            width: 32, height: 32,
                            display: "inline-flex", alignItems: "center", justifyContent: "center",
                            border: "1px solid var(--uidai-pmis-border)",
                            background: "#fff",
                            color: "#173e77",
                            borderRadius: 6,
                            cursor: isLocked ? "not-allowed" : "pointer",
                            opacity: isLocked ? 0.5 : 1,
                            padding: 0,
                            transition: "background .15s, border-color .15s, transform .15s",
                          }}
                          onMouseEnter={(e) => {
                            if (isLocked) return;
                            e.currentTarget.style.background = "#eaf4ff";
                            e.currentTarget.style.borderColor = "#0aa1c0";
                            e.currentTarget.style.transform = "translateY(-1px)";
                          }}
                          onMouseLeave={(e) => {
                            e.currentTarget.style.background = "#fff";
                            e.currentTarget.style.borderColor = "var(--uidai-pmis-border)";
                            e.currentTarget.style.transform = "translateY(0)";
                          }}
                        >
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none"
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
              </tbody>
            </table>
          </div>

          <div style={{ marginTop: 12, display: "flex", justifyContent: "flex-end", flexWrap: "wrap", gap: 10 }}>
            <div style={{
              fontSize: 13,
              color: totalPercent > 100 ? "var(--uidai-pmis-red)" : "#173e77",
              fontWeight: 700,
            }}>
              Scheduled: {totalPercent}%{totalPercent > 100 && " — over 100%"}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/* ──────────────────────────────────────────────────────────────────
   QgrConfigSection — compact panel rendered in the right column below
   the Summary card. Each phase is a single horizontal row with a
   segmented Yes / No control on the right. Only one phase can carry
   QGR=Yes at a time (the page-level setQrgForPhase enforces the
   cascade via PUT calls). When a phase has QGR applied the row
   highlights green and surfaces the computed % + ₹ value the backend
   ships in phase.qrg.
   ────────────────────────────────────────────────────────────────── */
function QgrConfigSection({ phases, isLocked, busy, onSetQrgForPhase }) {
  if (!phases || phases.length === 0) return null;
  const appliedPhase = phases.find((p) => p.qrg?.applied);
  return (
    <div style={{ padding: 16 }}>
      <div style={{
        display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
        fontSize: 14, fontWeight: 800, color: "#173e77",
        letterSpacing: 0.5, textTransform: "uppercase",
        paddingBottom: 12, marginBottom: 14,
        borderBottom: "1px solid var(--uidai-pmis-border)",
      }}>
        <span aria-hidden="true">🛡️</span> QGR Configuration
      </div>

      <div style={{
        fontSize: 11, color: "var(--uidai-pmis-muted)", textAlign: "center",
        marginBottom: 12, lineHeight: 1.4,
      }}>
        Only one phase can carry QGR at a time.
        {appliedPhase ? (
          <>
            {" "}Active on{" "}
            <strong style={{ color: "#1b7a42" }}>Phase {appliedPhase.phase}</strong>.
          </>
        ) : (
          <> No phase active.</>
        )}
        {busy && (
          <span style={{
            display: "inline-block", marginLeft: 6,
            padding: "1px 8px", borderRadius: 999,
            background: "#fff4e0", color: "#a35a00", fontWeight: 700, fontSize: 10,
          }}>
            Updating…
          </span>
        )}
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {phases.map((p) => {
          const yes = !!p.qrg?.applied;
          return (
            <div
              key={p.phase}
              style={{
                display: "flex", alignItems: "center", gap: 10,
                border: yes ? "1px solid #1b7a42" : "1px solid var(--uidai-pmis-border)",
                background: yes ? "#f1faf4" : "#fff",
                borderRadius: 10,
                padding: "10px 12px",
                boxShadow: yes
                  ? "0 2px 6px rgba(27, 122, 66, 0.10)"
                  : "0 1px 2px rgba(20, 50, 110, 0.04)",
                transition: "border-color .15s, background .15s, box-shadow .15s",
              }}
            >
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{
                  display: "flex", alignItems: "center", gap: 6,
                  fontWeight: 800, color: "#173e77", fontSize: 13,
                }}>
                  Phase {p.phase}
                  {yes && (
                    <span style={{
                      fontSize: 9, fontWeight: 800, letterSpacing: 0.4,
                      padding: "1px 6px", borderRadius: 999,
                      background: "#1b7a42", color: "#fff",
                    }}>
                      ON
                    </span>
                  )}
                </div>
                <div style={{ fontSize: 11, marginTop: 3, lineHeight: 1.3 }}>
                  {yes && p.qrg ? (
                    <>
                      <span style={{ fontWeight: 700, color: "#1b7a42" }}>
                        {Number(p.qrg.percent)} %
                      </span>
                      <span style={{ color: "var(--uidai-pmis-muted)" }}> · </span>
                      <strong style={{ color: "#173e77" }}>
                        ₹ {Number(p.qrg.value || 0).toLocaleString("en-IN")}
                      </strong>
                    </>
                  ) : (
                    <span style={{ color: "var(--uidai-pmis-muted)" }}>No hold-back</span>
                  )}
                </div>
              </div>

              <div role="group" aria-label={`Apply QGR to Phase ${p.phase}`}
                style={{
                  display: "inline-flex", flex: "0 0 auto",
                  border: "1px solid var(--uidai-pmis-border)",
                  borderRadius: 999, overflow: "hidden",
                  background: "#fff",
                }}>
                <button
                  type="button"
                  disabled={isLocked}
                  onClick={() => !yes && onSetQrgForPhase(p.phase, true)}
                  style={{
                    padding: "5px 12px",
                    border: "none",
                    background: yes ? "#1b7a42" : "transparent",
                    color: yes ? "#fff" : "#173e77",
                    fontWeight: 700,
                    cursor: isLocked ? "not-allowed" : "pointer",
                    opacity: isLocked ? 0.5 : 1,
                    fontSize: 12,
                  }}
                >
                  Yes
                </button>
                <button
                  type="button"
                  disabled={isLocked}
                  onClick={() => yes && onSetQrgForPhase(p.phase, false)}
                  style={{
                    padding: "5px 12px",
                    border: "none",
                    borderLeft: "1px solid var(--uidai-pmis-border)",
                    background: !yes ? "#eef2f7" : "transparent",
                    color: "#173e77",
                    fontWeight: 700,
                    cursor: isLocked ? "not-allowed" : "pointer",
                    opacity: isLocked ? 0.5 : 1,
                    fontSize: 12,
                  }}
                >
                  No
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
