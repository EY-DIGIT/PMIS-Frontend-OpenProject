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
import { loadProjectTree } from "../../api/milestoneConfigApi";

/* ⚠️ TEMPORARY TEST FLAG — set to false (or delete the block that reads it in
   loadMilestones) once the backend returns paymentType + activities. When on,
   every milestone is treated as partial-payment with dummy activities so the
   Add Cost "Activity" dropdown can be exercised without backend support. */
const DUMMY_PARTIAL_TEST = true;
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
          overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
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
      <div style={{
        display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
        fontSize: 14, fontWeight: 800, color: "#173e77",
        letterSpacing: 0.5, textTransform: "uppercase",
        paddingBottom: 12, marginBottom: 14,
        borderBottom: "1px solid var(--uidai-pmis-border)",
      }}>
        Summary
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

/* Master cost-type list plus the two product-required extras (Resource
   Cost, Transaction Cost). Falls back to a lone "Fixed" entry when the
   master list hasn't loaded. Extras are appended only when the master list
   doesn't already define that code. */
function buildCostTypeOptions(costTypes) {
  const base =
    Array.isArray(costTypes) && costTypes.length
      ? costTypes
      : [{ code: "fixed", name: "Fixed" }];
  const extras = [
    { code: "resource", name: "Resource Cost" },
    { code: "transaction", name: "Transaction Cost" },
  ];
  const have = new Set(base.map((c) => String(c.code || "").toLowerCase()));
  return [...base, ...extras.filter((e) => !have.has(e.code))];
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
    costTypeCode: "fixed", phase: "default", cost: "", taxAmount: "", milestoneIds: [],
    milestoneActivities: {},
  });
  // Reseed the draft each time the modal opens.
  useEffect(() => {
    if (open) {
      setDraft({
        costTypeCode: "fixed", phase: "default", cost: "", taxAmount: "", milestoneIds: [],
        milestoneActivities: {},
      });
    }
  }, [open]);

  /* Milestones (among those selected) whose payment type is partial — each
     needs an Activity picked so the milestone's payment can be computed
     activity-wise. */
  const partialMilestones = (milestones || []).filter(
    (m) => (draft.milestoneIds || []).includes(m.id) && m.paymentType === "partial_activity"
  );

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
                  phase: next === "one_time" ? "" : (d.phase || "default"),
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
                placeholder="default"
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

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14, marginTop: 14 }}>
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
                onChange={(next) =>
                  setDraft((d) => {
                    // Drop activity selections for any milestone no longer chosen.
                    const keep = {};
                    Object.entries(d.milestoneActivities || {}).forEach(([mid, aid]) => {
                      if (next.includes(mid)) keep[mid] = aid;
                    });
                    return { ...d, milestoneIds: next, milestoneActivities: keep };
                  })
                }
              />
            )}
          </div>
        </div>

        {/* Activity picker(s) for partial-payment milestones — one per
            selected milestone whose payment type is partial (activity-based),
            so the milestone's payment is computed activity-wise. */}
        {!isOneTime && partialMilestones.length > 0 && (
          <div style={{ marginTop: 14 }}>
            <div style={{ fontSize: 12, fontWeight: 800, color: "#173e77", marginBottom: 6 }}>
              Activity (for partial-payment milestones)
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 14 }}>
              {partialMilestones.map((m) => (
                <div key={m.id} className="uidai-pmis-field" style={{ marginBottom: 0 }}>
                  <label>{m.name}</label>
                  <select
                    value={(draft.milestoneActivities && draft.milestoneActivities[m.id]) || ""}
                    onChange={(e) =>
                      setDraft((d) => ({
                        ...d,
                        milestoneActivities: { ...(d.milestoneActivities || {}), [m.id]: e.target.value },
                      }))
                    }
                  >
                    <option value="">— Select activity —</option>
                    {(m.activities || []).map((a) => (
                      <option key={a.id} value={a.id}>{a.name}</option>
                    ))}
                  </select>
                  {(m.activities || []).length === 0 && (
                    <div style={{ fontSize: 11, color: "var(--uidai-pmis-muted)", marginTop: 4 }}>
                      No activities found for this milestone.
                    </div>
                  )}
                </div>
              ))}
            </div>
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
    costTypeCode: "fixed", phase: "default", cost: "", taxAmount: "", milestoneIds: [],
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
      phase: isOne ? "" : (row.phase ?? "default"),
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
                  phase: next === "one_time" ? "" : (d.phase || "default"),
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
                placeholder="default"
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

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14, marginTop: 14 }}>
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
  // Additional cost type: ccn | qgr | aqp. Drives which input shows below.
  const [additionalCostType, setAdditionalCostType] = useState("ccn");
  // Value buffer for the QGR / AQP variants (CCN uses ccnInput above).
  const [additionalValue, setAdditionalValue] = useState("");

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
        .map((m) => ({
          id: m.id,
          name: m.name || m.title || m.id,
          status: fromApiNodeStatus(m.status),
          // Captured from the flat list when present; enriched from the
          // tree below (which also carries each milestone's activities).
          paymentType: m.paymentType || "",
          activities: [],
        }));
      setMilestones(list);

      /* Enrich with paymentType + activities from the project tree so the
         Add/Edit Cost modals can offer an Activity dropdown for milestones
         whose payment type is "partial_activity". Best-effort. */
      try {
        const tree = await loadProjectTree(projectId);
        const byId = new Map();
        (tree?.milestones || []).forEach((mn) => {
          const key = mn.apiId || mn.id || mn.uid;
          if (!key) return;
          byId.set(key, {
            paymentType: mn.paymentType || "",
            activities: (mn.activities || [])
              .map((a) => ({ id: a.apiId || a.id || a.uid, name: a.name || a.id || a.uid }))
              .filter((a) => a.id),
          });
        });
        if (byId.size) {
          setMilestones((prev) =>
            prev.map((m) => {
              const extra = byId.get(m.id);
              return extra ? { ...m, paymentType: extra.paymentType || m.paymentType, activities: extra.activities } : m;
            })
          );
        }
      } catch { /* tree enrichment is best-effort */ }

      /* ⚠️ TEMP DUMMY DATA — see DUMMY_PARTIAL_TEST above. Marks every
         milestone as partial-payment and seeds dummy activities so the
         partial → Activity-dropdown flow can be tested without backend
         support. Remove this block (and the flag) for production. */
      if (DUMMY_PARTIAL_TEST) {
        setMilestones((prev) =>
          prev.map((m) => ({
            ...m,
            paymentType: "partial_activity",
            activities:
              m.activities && m.activities.length
                ? m.activities
                : [
                    { id: `${m.id}-dummy-a1`, name: "Activity A1 (dummy)" },
                    { id: `${m.id}-dummy-a2`, name: "Activity A2 (dummy)" },
                    { id: `${m.id}-dummy-a3`, name: "Activity A3 (dummy)" },
                  ],
          }))
        );
      }
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
  // Finance page is always actionable — the user can edit terms, generate
  // invoices, add cost rows, etc. at any time regardless of the server's
  // locked flag.
  const isLocked = false;

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
          phase: draft.phase || "default",
          cost: Number(draft.cost),
          taxAmount: Number(draft.taxAmount),
          milestoneIds: draft.milestoneIds,
          /* Per partial-payment milestone: which activity the cost maps to,
             so that milestone is computed activity-wise. */
          milestoneActivities: Object.entries(draft.milestoneActivities || {})
            .filter(([, activityId]) => activityId)
            .map(([milestoneId, activityId]) => ({ milestoneId, activityId })),
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
            phase: draft.phase || "default",
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
  function activityName(activityId) {
    if (!activityId) return "";
    for (const m of milestones) {
      const a = (m.activities || []).find((x) => x.id === activityId);
      if (a) return a.name;
    }
    return activityId;
  }
  function isPartialMilestone(id) {
    return milestones.find((m) => m.id === id)?.paymentType === "partial_activity";
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
        gap: 10, marginBottom: 12,
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
                          {isOneTime ? (
                            <span style={disabledCell}></span>
                          ) : (r.milestoneIds || []).length === 0 ? (
                            "—"
                          ) : (() => {
                            /* Map of milestoneId → activityId for this row's
                               partial-payment milestones (echoed by the API). */
                            const actMap = {};
                            (r.milestoneActivities || []).forEach((x) => {
                              if (x && x.milestoneId) actMap[x.milestoneId] = x.activityId;
                            });
                            return (r.milestoneIds || []).map((mid) => {
                              const act = actMap[mid];
                              return (
                                <div key={mid}>
                                  {milestoneName(mid)}
                                  {isPartialMilestone(mid) && (
                                    <span style={{ color: "#0b3c88", fontSize: 11, fontWeight: 600 }}>
                                      {" · "}{act ? activityName(act) : "Partial (activity-wise)"}
                                    </span>
                                  )}
                                </div>
                              );
                            });
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
            ) : phases.map((p, idx) => (
              <PhasePanel
                key={p.phase}
                phase={p}
                milestoneName={milestoneName}
                milestoneStatus={milestoneStatus}
                frequencies={frequencies}
                onEditTerm={(t) => setEditingTerm(t)}
                onGenerateInvoice={generateInvoice}
                onApplyFrequency={applyPhaseFrequency}
                isLocked={isLocked}
                isLastPhase={idx === phases.length - 1}
                qgrLocked={isLocked || qgrSaving}
                qgrBusy={qgrSaving}
                onSetQrgForPhase={setQrgForPhase}
              />
            ))}
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
          <QgrSummarySection phases={phases} totals={totals} />
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
        onSubmit={async (vals) => {
          const ok = await saveTerm(editingTerm, vals);
          if (ok) setEditingTerm(null);
        }}
        submitting={savingTerm}
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
  phase, milestoneName, milestoneStatus = () => "Not Completed",
  frequencies = [], onEditTerm, onGenerateInvoice, onApplyFrequency,
  isLocked, isLastPhase, qgrLocked, qgrBusy, onSetQrgForPhase,
}) {
  const [expanded, setExpanded] = useState(true);
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
  const qrgApplied = !!phase.qrg?.applied;
  const canToggleQgr = typeof onSetQrgForPhase === "function";
  const qgrDisabled = qgrLocked || qgrBusy;

  return (
    <div style={{
      border: "1px solid var(--uidai-pmis-border)",
      borderRadius: 10,
      marginBottom: 14,
      background: "#fff",
      overflow: "hidden",
      boxShadow: "0 1px 2px rgba(20, 50, 110, 0.04)",
    }}>
      {/* Header is a div (not a button) so the QGR Yes/No segmented
          control can live inside it without nesting buttons. Clicking
          anywhere except the QGR control toggles the collapse. */}
      <div
        onClick={() => setExpanded((e) => !e)}
        style={{
          width: "100%",
          display: "flex", alignItems: "center", justifyContent: "space-between",
          gap: 12, flexWrap: "wrap",
          background: "linear-gradient(90deg, #eef4fc 0%, #f5f9ff 100%)",
          borderBottom: expanded ? "1px solid var(--uidai-pmis-border)" : "none",
          padding: "12px 16px",
          cursor: "pointer",
          textAlign: "left",
        }}
      >
        <div style={{ display: "inline-flex", alignItems: "center", gap: 12, minWidth: 0, flexWrap: "wrap" }}>
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
            {phase.cycleCount != null && (
              <span style={{
                fontSize: 10, fontWeight: 700, letterSpacing: 0.3,
                padding: "2px 7px", borderRadius: 999,
                background: "#eef4fc", color: "#173e77", border: "1px solid #cfe0f5",
              }}>
                {phase.cycleCount} {Number(phase.cycleCount) === 1 ? "Cycle" : "Cycles"}
              </span>
            )}
          </span>

          {canToggleQgr && (
            <div
              onClick={(e) => e.stopPropagation()}
              style={{ display: "inline-flex", alignItems: "center", gap: 7 }}
            >
              <span style={{ fontSize: 11, fontWeight: 800, color: "#173e77", letterSpacing: 0.3 }}>
                QGR{" "}
                <span style={{ fontWeight: 600, color: "var(--uidai-pmis-muted)" }}>
                  (Quarterly Guaranteed Revenue)
                </span>
              </span>
              <div role="group" aria-label={`Apply QGR to Phase ${phase.phase}`}
                style={{
                  display: "inline-flex",
                  border: "1px solid var(--uidai-pmis-border)",
                  borderRadius: 999, overflow: "hidden", background: "#fff",
                }}>
                <button
                  type="button"
                  disabled={qgrDisabled}
                  onClick={() => !qrgApplied && onSetQrgForPhase(phase.phase, true)}
                  style={{
                    padding: "4px 12px",
                    border: "none",
                    background: qrgApplied ? "#1b7a42" : "transparent",
                    color: qrgApplied ? "#fff" : "#173e77",
                    fontWeight: 700, fontSize: 12,
                    cursor: qgrDisabled ? "not-allowed" : "pointer",
                    opacity: qgrDisabled ? 0.5 : 1,
                  }}
                >
                  Yes
                </button>
                <button
                  type="button"
                  disabled={qgrDisabled}
                  onClick={() => qrgApplied && onSetQrgForPhase(phase.phase, false)}
                  style={{
                    padding: "4px 12px",
                    border: "none",
                    borderLeft: "1px solid var(--uidai-pmis-border)",
                    background: !qrgApplied ? "#eef2f7" : "transparent",
                    color: "#173e77",
                    fontWeight: 700, fontSize: 12,
                    cursor: qgrDisabled ? "not-allowed" : "pointer",
                    opacity: qgrDisabled ? 0.5 : 1,
                  }}
                >
                  No
                </button>
              </div>
            </div>
          )}
        </div>

        <span style={{ color: "var(--uidai-pmis-muted)", fontSize: 14, flex: "0 0 auto" }}>{expanded ? "▲ Collapse" : "▼ Expand"}</span>
      </div>

      {expanded && (
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
                <tr>
                  <th>Milestone</th>
                  <th style={{ width: 110 }}>Cycle</th>
                  <th style={{ width: 130 }}>% of Payment (Fixed + One-time)</th>
                  <th style={{ width: 170 }}>Value</th>
                  <th style={{ width: 220 }}>Breakup (Total / % / Remaining)</th>
                  <th style={{ width: 220, textAlign: "center" }}>Action</th>
                </tr>
              </thead>
              <tbody>
                {terms.length === 0 ? (
                  <tr>
                    <td colSpan={6} style={{ textAlign: "center", padding: 18, color: "var(--uidai-pmis-muted)" }}>
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
                  return (
                    <tr key={t.id}>
                      <td>{milestoneName(t.milestoneId)}</td>
                      <td>
                        {t.cycleCount != null
                          ? <span style={{
                              display: "inline-block", padding: "2px 8px", borderRadius: 999,
                              background: "#eef9f0", color: "#1b7a42", fontSize: 12, fontWeight: 600,
                              border: "1px solid #c4e9d0",
                            }}>{t.cycleCount}</span>
                          : <span style={{ color: "var(--uidai-pmis-muted)" }}>—</span>}
                      </td>
                      <td>
                        {t.percentOfPayment == null
                          ? <span style={{ color: "var(--uidai-pmis-muted)" }}>—</span>
                          : <strong style={{ color: "#173e77" }}>{Number(t.percentOfPayment)} %</strong>}
                      </td>
                      <td style={{ fontWeight: 700, color: "#173e77" }}>
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
                        {(() => {
                          const msComplete = milestoneStatus(t.milestoneId) === "Completed";
                          const genDisabled = isLocked || !msComplete;
                          return (
                            <button
                              type="button"
                              title={
                                msComplete
                                  ? "Generate invoice for this milestone"
                                  : "Available only when the milestone status is Completed"
                              }
                              aria-label="Generate invoice"
                              disabled={genDisabled}
                              onClick={() => onGenerateInvoice(t)}
                              style={{
                                height: 32,
                                display: "inline-flex", alignItems: "center", justifyContent: "center",
                                gap: 6,
                                padding: "0 10px",
                                border: "1px solid var(--uidai-pmis-border)",
                                background: genDisabled ? "#f4f6f9" : "#173e77",
                                color: genDisabled ? "var(--uidai-pmis-muted)" : "#fff",
                                borderColor: genDisabled ? "var(--uidai-pmis-border)" : "#173e77",
                                borderRadius: 6,
                                fontSize: 12,
                                fontWeight: 600,
                                whiteSpace: "nowrap",
                                cursor: genDisabled ? "not-allowed" : "pointer",
                                opacity: genDisabled ? 0.7 : 1,
                                transition: "background .15s, border-color .15s, transform .15s",
                              }}
                              onMouseEnter={(e) => {
                                if (genDisabled) return;
                                e.currentTarget.style.background = "#0f2f5e";
                                e.currentTarget.style.transform = "translateY(-1px)";
                              }}
                              onMouseLeave={(e) => {
                                if (genDisabled) return;
                                e.currentTarget.style.background = "#173e77";
                                e.currentTarget.style.transform = "translateY(0)";
                              }}
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
                  );
                })}
                {terms.length > 0 && (
                  <tr style={{ background: "#f1f6fd" }}>
                    <td colSpan={3} style={{ fontWeight: 800, color: "#173e77", textAlign: "right" }}>
                      Total
                    </td>
                    <td style={{ fontWeight: 800, color: "#173e77" }}>
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
              <div style={{
                display: "inline-flex", alignItems: "center", gap: 6,
                fontSize: 12, fontWeight: 700, color: "var(--uidai-pmis-red)",
                background: "#fdecec", border: "1px solid #f5c2c2",
                borderRadius: 8, padding: "6px 10px",
              }}>
                <span aria-hidden="true">⚠</span>
                Last phase must total 100% — currently {totalPercent}%
                {totalPercent < 100
                  ? ` (${100 - totalPercent}% short)`
                  : ` (${totalPercent - 100}% over)`}
              </div>
            ) : <span />}
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
    </div>
  );
}

/* ──────────────────────────────────────────────────────────────────
   QgrSummarySection — read-only per-phase summary in the right column
   below the Summary card. The Yes/No toggles live in each phase's
   collapsible header on the left; this panel reports, for every phase:
   the scheduled term count + %, the phase Fixed total, and (when the
   phase carries QGR) the held-back %/₹ value. Total Contract Cost is
   intentionally omitted here — it already shows in the Summary above.
   ────────────────────────────────────────────────────────────────── */
function QgrSummarySection({ phases, totals }) {
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
      display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8,
      fontSize: 12,
    }}>
      <span style={muted}>{label}</span>
      <strong style={{ color: opts.color || "#173e77" }}>{value}</strong>
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
          const yes = !!p.qrg?.applied;
          const qgrPercent = yes ? Number(p.qrg?.percent) || 0 : 0;
          const qgrValue = yes ? Number(p.qrg?.value) || 0 : 0;
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
                      QGR
                    </span>
                  )}
                </span>
                <span style={{ fontWeight: 800, color: "#173e77" }}>{inr(phaseTotal)}</span>
              </div>

              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                {stat("Scheduled", `${totalPercent}%`,
                  { color: totalPercent > 100 ? "var(--uidai-pmis-red)" : "#173e77" })}
                {stat("Delivery Cost", inr(phaseFixed))}
                {stat("QGR Hold-back",
                  yes ? `${qgrPercent}% · ${inr(qgrValue)}` : "—",
                  { color: yes ? "#1b7a42" : "#a3afc1" })}
              </div>
            </div>
          );
        })}
      </div>

      {/* Total remaining balance — sum of QGR hold-back across all phases. */}
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
