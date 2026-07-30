import React, { useEffect, useMemo, useState } from "react";
import { uiStore } from "../../store/project/uiStore";
import * as plannedApi from "../../api/plannedResources";

/* ────────────────────────────────────────────────────────────────────
   Planned Resources — resource-type phase costing.

   A resource-type phase's resource cost is not a typed amount: it is the
   SUM of its planned-resource rows. One row = designation + deployment
   window + headcount, priced by the backend as

       monthlyRateSnapshot × durationMonths × quantity = computedCost

   durationMonths is fractional (days / 30.44), so Apr 1 → Jun 30 is ≈ 2.99
   months, not 3. Several rows may share a designation — they all
   accumulate.

   Rows hang off a `resource_cost` cost item (costItemId), so the phase must
   have one first; that is why this section renders a tab per resource-cost
   item rather than per phase. The per-tab total IS that phase's resource
   cost, which is why every mutation calls onChanged() to re-pull the
   payment page.

   Designations come from the /master gateway per ORGANIZATION
   (vendor_id) and carry the monthly rate shown in the picker.
   ──────────────────────────────────────────────────────────────────── */

const inr = (n) => {
  const v = Number(n);
  return Number.isFinite(v) ? `₹ ${v.toLocaleString("en-IN", { maximumFractionDigits: 2 })}` : "₹ 0";
};

/* Fractional months read badly at full precision — 2.9895… is noise. Two
   decimals is enough to show that a window is "just under 3 months". */
const fmtMonths = (n) => {
  const v = Number(n);
  return Number.isFinite(v) ? v.toFixed(2) : "—";
};

const cell = {
  width: "100%", padding: "5px 7px", border: "1px solid var(--uidai-pmis-border)",
  borderRadius: 6, background: "#fff", font: "inherit", fontSize: 12.5,
  boxSizing: "border-box",
};

/* Add-row draft. Module-level so it is a stable reference — it is reset on
   every successful POST and whenever the active tab changes. */
const EMPTY_DRAFT = { designationId: "", quantity: "1", deployStart: "", deployEnd: "" };

export default function PlannedResourcesSection({
  projectId,
  /* Resource-cost cost items for the ACTIVE organization, newest last.
     Each: { id, phase, lineLabel, cost, total }. */
  resourceCostItems = [],
  vendorId = "",
  vendorName = "",
  isLocked = false,
  onChanged,
}) {
  const [rows, setRows] = useState([]);
  const [designations, setDesignations] = useState([]);
  const [designationError, setDesignationError] = useState("");
  /* Which pool the options came from — 'vendor' | 'global' | 'all'. Anything
     other than 'vendor' is worth telling the user about, because the rates
     they're picking may not be this organization's. */
  const [designationScope, setDesignationScope] = useState("vendor");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [busyId, setBusyId] = useState("");
  const [activeItem, setActiveItem] = useState(0);
  /* Inline "new designation" form. The master has no UI of its own yet, so an
     empty picker would otherwise be a dead end. */
  const [newOpen, setNewOpen] = useState(false);
  const [newRow, setNewRow] = useState({ name: "", code: "", monthlyRate: "" });
  const [creating, setCreating] = useState(false);

  const [draft, setDraft] = useState(EMPTY_DRAFT);

  const costItem = resourceCostItems[activeItem] || null;

  useEffect(() => {
    if (activeItem > resourceCostItems.length - 1) setActiveItem(0);
  }, [resourceCostItems.length, activeItem]);

  /* One GET returns every row on the project; the tabs slice it by cost
     item, so switching tabs costs nothing. */
  async function loadRows() {
    if (!projectId) return;
    setLoading(true);
    setError("");
    try {
      setRows(await plannedApi.listPlannedResources(projectId));
    } catch (err) {
      setError(err?.message || "Failed to load planned resources");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadRows();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId]);

  /* Designations are per-organization, so the picker reloads whenever the
     active org tab changes. A row's response carries no designation name, so
     this list is also what labels existing rows — which is why it includes the
     global (unscoped) designations, not just this org's. */
  async function loadDesignations() {
    setDesignationError("");
    try {
      const { rows: list, scope } = await plannedApi.listDesignationsForVendor(vendorId);
      setDesignations(list.filter((d) => d.active));
      setDesignationScope(scope);
    } catch (err) {
      /* Swallowing this is what made an empty picker indistinguishable from a
         failed request — say which it was. */
      setDesignations([]);
      setDesignationError(err?.message || "Failed to load designations");
    }
  }

  useEffect(() => {
    loadDesignations();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [vendorId]);

  const itemRows = useMemo(
    () => (costItem ? rows.filter((r) => r.costItemId === costItem.id) : []),
    [rows, costItem]
  );
  const tabTotal = itemRows.reduce((s, r) => s + (Number(r.computedCost) || 0), 0);

  const designationById = useMemo(() => {
    const m = {};
    designations.forEach((d) => { m[d.id] = d; });
    return m;
  }, [designations]);

  /* Mutations always re-pull both this list and the payment page: the row's
     computedCost and the phase's resource cost are both backend-derived. */
  async function afterMutation() {
    await loadRows();
    if (typeof onChanged === "function") await onChanged();
  }

  /* The master requires a code matching ^[a-zA-Z0-9_-]+$ — derive one from the
     name so the user doesn't have to think about it (still editable). */
  const codeFromName = (name) =>
    String(name || "").trim().toUpperCase().replace(/[^A-Z0-9_-]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 64);

  async function createDesignation() {
    const name = newRow.name.trim();
    const code = (newRow.code.trim() || codeFromName(name));
    const rate = Number(newRow.monthlyRate);
    if (!name) { uiStore.showError("Designation name is required."); return; }
    if (!code) { uiStore.showError("Designation code is required."); return; }
    if (!Number.isFinite(rate) || rate < 0) { uiStore.showError("Enter a valid monthly rate."); return; }

    setCreating(true);
    try {
      /* Created against the ACTIVE org so its rate card stays that org's. With
         no org resolved it is created global (vendor_id null), which every org
         can then use. */
      const created = await plannedApi.createDesignation({
        code, name, vendorId: vendorId || null, monthlyRate: rate,
      });
      await loadDesignations();
      setNewRow({ name: "", code: "", monthlyRate: "" });
      setNewOpen(false);
      if (created?.id) setDraft((d) => ({ ...d, designationId: created.id }));
      uiStore.showMessage("Designation added.");
    } catch (err) {
      uiStore.showError(err?.message || "Failed to add designation");
    } finally {
      setCreating(false);
    }
  }

  async function addRow() {
    if (!costItem) return;
    if (!draft.designationId) { uiStore.showError("Pick a designation."); return; }
    if (!draft.deployStart || !draft.deployEnd) {
      uiStore.showError("Set both deployment dates.");
      return;
    }
    if (draft.deployEnd < draft.deployStart) {
      uiStore.showError("Deployment end cannot be earlier than deployment start.");
      return;
    }
    const qty = Number(draft.quantity);
    if (!Number.isFinite(qty) || qty <= 0) { uiStore.showError("Quantity must be at least 1."); return; }

    setBusyId("new");
    try {
      await plannedApi.createPlannedResource(projectId, { ...draft, costItemId: costItem.id, quantity: qty });
      setDraft(EMPTY_DRAFT);
      await afterMutation();
      uiStore.showMessage("Planned resource added.");
    } catch (err) {
      uiStore.showError(err?.message || "Failed to add planned resource");
    } finally {
      setBusyId("");
    }
  }

  /* One field at a time — the BE re-prices the row on every PATCH, so
     there is nothing to batch. `patch` is already in API field names. */
  async function patchRow(row, patch) {
    setBusyId(row.id);
    try {
      await plannedApi.updatePlannedResource(row.id, patch);
      await afterMutation();
    } catch (err) {
      uiStore.showError(err?.message || "Failed to update planned resource");
      await loadRows();   // discard the optimistic input value
    } finally {
      setBusyId("");
    }
  }

  async function removeRow(row) {
    const label = row.designationName || designationById[row.designationId]?.name || "this row";
    if (!window.confirm(`Remove ${label} from the planned resources? The phase's resource cost drops by ${inr(row.computedCost)}.`)) return;
    setBusyId(row.id);
    try {
      await plannedApi.removePlannedResource(row.id);
      await afterMutation();
      uiStore.showMessage("Planned resource removed.");
    } catch (err) {
      uiStore.showError(err?.message || "Failed to remove planned resource");
    } finally {
      setBusyId("");
    }
  }

  /* No resource-cost cost item = nothing rows could attach to. Say so
     rather than rendering an empty table the user can't use. */
  if (resourceCostItems.length === 0) {
    return (
      <div style={{ padding: 18, textAlign: "center", color: "var(--uidai-pmis-muted)", fontSize: 13 }}>
        Add a <strong>Resource</strong> cost row to a phase first — planned resources attach to it,
        and their total becomes that phase's resource cost.
      </div>
    );
  }

  return (
    <div>
      {/* One tab per resource-cost cost item (i.e. per resource-type phase). */}
      {resourceCostItems.length > 1 && (
        <div
          role="tablist"
          aria-label="Resource cost items"
          style={{ display: "flex", gap: 4, flexWrap: "wrap", borderBottom: "2px solid var(--uidai-pmis-border)", marginBottom: 14 }}
        >
          {resourceCostItems.map((c, i) => {
            const active = i === activeItem;
            return (
              <button
                key={c.id}
                type="button"
                role="tab"
                aria-selected={active}
                /* Switching tabs also drops the half-filled add-row: it was
                   being written against the previous cost item. */
                onClick={() => { setActiveItem(i); setDraft(EMPTY_DRAFT); }}
                style={{
                  border: "1px solid var(--uidai-pmis-border)",
                  borderBottom: active ? "2px solid #173e77" : "1px solid var(--uidai-pmis-border)",
                  borderTopLeftRadius: 8, borderTopRightRadius: 8,
                  background: active ? "#fff" : "#f1f6fd",
                  color: active ? "#173e77" : "#5b6b82",
                  fontWeight: active ? 800 : 600, fontSize: 13,
                  padding: "8px 16px", marginBottom: -2, cursor: "pointer",
                }}
              >
                Phase {c.phase ?? "—"}{c.lineLabel ? ` · ${c.lineLabel}` : ""}
              </button>
            );
          })}
        </div>
      )}

      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 8, marginBottom: 10 }}>
        <div style={{ fontSize: 12, color: "var(--uidai-pmis-muted)" }}>
          Rates are {vendorName ? <>the <strong>{vendorName}</strong> rate card</> : "per organization"} —
          cost = monthly rate × duration in months × quantity.
        </div>
        <div style={{ fontSize: 12, color: "var(--uidai-pmis-muted)" }}>
          Phase {costItem?.phase ?? "—"} resource cost:{" "}
          <strong style={{ color: "#173e77", fontSize: 14 }}>{inr(tabTotal)}</strong>
        </div>
      </div>

      {error && (
        <div style={{ padding: 10, marginBottom: 10, color: "#c0392b", fontWeight: 600, fontSize: 13 }}>
          {error}
        </div>
      )}

      {/* Why the designation picker looks the way it does. Without this, an
          empty dropdown gives the user nothing to act on. */}
      {(designationError || designations.length === 0 || designationScope !== "vendor") && (
        <div
          style={{
            display: "flex", alignItems: "center", justifyContent: "space-between",
            flexWrap: "wrap", gap: 10, marginBottom: 10, padding: "9px 12px",
            border: `1px solid ${designationError ? "#f5c6c6" : "#e2e8f3"}`,
            background: designationError ? "#fff7f7" : "#f7fbff",
            borderRadius: 8, fontSize: 12.5,
            color: designationError ? "#b3261e" : "#3d5372",
          }}
        >
          <span>
            {designationError
              ? `Designations could not be loaded — ${designationError}`
              : designations.length === 0
                ? "No designations in the master yet. Add one to start planning resources — name and monthly rate is all it needs."
                : designationScope === "global"
                  ? `No designations are mapped to ${vendorName || "this organization"} — showing the unscoped (global) rate card.`
                  : `No designations matched ${vendorName || "this organization"} — showing every designation, so check the rate before adding a row.`}
          </span>
          <span style={{ display: "inline-flex", gap: 8 }}>
            {designationError && (
              <button
                type="button"
                className="uidai-pmis-btn uidai-pmis-btn-cancel uidai-pmis-btn-small"
                style={{ marginTop: 0, padding: "4px 10px" }}
                onClick={loadDesignations}
              >
                Retry
              </button>
            )}
            {!isLocked && !newOpen && (
              <button
                type="button"
                className="uidai-pmis-btn uidai-pmis-btn-small"
                style={{ marginTop: 0, padding: "4px 10px" }}
                onClick={() => setNewOpen(true)}
              >
                + New designation
              </button>
            )}
          </span>
        </div>
      )}

      {/* Inline designation master form — the picker's source has no page of
          its own, so it is created where it is needed. Scoped to the active
          org (or global when no org resolved). */}
      {newOpen && (
        <div
          style={{
            display: "flex", alignItems: "flex-end", gap: 10, flexWrap: "wrap",
            marginBottom: 12, padding: "10px 12px",
            border: "1px solid var(--uidai-pmis-border)", borderRadius: 8, background: "#fff",
          }}
        >
          <div style={{ flex: "1 1 200px" }}>
            <label style={{ display: "block", fontSize: 11, fontWeight: 700, color: "#5b6b82", marginBottom: 3 }}>
              Designation name
            </label>
            <input
              style={cell}
              placeholder="e.g. Senior Consultant"
              value={newRow.name}
              onChange={(e) => setNewRow((r) => ({ ...r, name: e.target.value }))}
            />
          </div>
          <div style={{ flex: "0 1 150px" }}>
            <label style={{ display: "block", fontSize: 11, fontWeight: 700, color: "#5b6b82", marginBottom: 3 }}>
              Code
            </label>
            <input
              style={cell}
              placeholder={codeFromName(newRow.name) || "SR_CONSULTANT"}
              value={newRow.code}
              onChange={(e) => setNewRow((r) => ({ ...r, code: e.target.value }))}
              title="Letters, digits, _ and - only. Left blank, it is derived from the name."
            />
          </div>
          <div style={{ flex: "0 1 150px" }}>
            <label style={{ display: "block", fontSize: 11, fontWeight: 700, color: "#5b6b82", marginBottom: 3 }}>
              Monthly rate (₹)
            </label>
            <input
              type="number" min="0" step="0.01" style={{ ...cell, textAlign: "right" }}
              value={newRow.monthlyRate}
              onChange={(e) => setNewRow((r) => ({ ...r, monthlyRate: e.target.value }))}
            />
          </div>
          <div style={{ display: "inline-flex", gap: 8 }}>
            <button
              type="button"
              className="uidai-pmis-btn uidai-pmis-btn-cancel uidai-pmis-btn-small"
              style={{ marginTop: 0, padding: "6px 12px" }}
              disabled={creating}
              onClick={() => { setNewOpen(false); setNewRow({ name: "", code: "", monthlyRate: "" }); }}
            >
              Cancel
            </button>
            <button
              type="button"
              className="uidai-pmis-btn uidai-pmis-btn-small"
              style={{ marginTop: 0, padding: "6px 12px" }}
              disabled={creating}
              onClick={createDesignation}
            >
              {creating ? "Saving…" : "Save designation"}
            </button>
          </div>
          <div style={{ flexBasis: "100%", fontSize: 11.5, color: "var(--uidai-pmis-muted)" }}>
            Saved to {vendorName ? <strong>{vendorName}</strong> : "the global rate card"}. The rate is per month;
            rows snapshot it when created, so later changes don't re-price existing rows.
          </div>
        </div>
      )}

      <div className="uidai-pmis-table-wrap">
        <table className="uidai-pmis-table uidai-pmis-table-compact">
          <thead>
            <tr>
              <th style={{ minWidth: 200 }}>Designation</th>
              <th style={{ width: 130 }}>Monthly Rate</th>
              <th style={{ width: 150 }}>Deploy From</th>
              <th style={{ width: 150 }}>Deploy To</th>
              <th style={{ width: 90, textAlign: "right" }}>Qty</th>
              <th style={{ width: 100, textAlign: "right" }}>Months</th>
              <th style={{ width: 140, textAlign: "right" }}>Cost</th>
              <th style={{ width: 70, textAlign: "center" }}>Action</th>
            </tr>
          </thead>
          <tbody>
            {loading && itemRows.length === 0 ? (
              <tr><td colSpan={8} style={{ textAlign: "center", padding: 18, color: "var(--uidai-pmis-muted)" }}>Loading planned resources…</td></tr>
            ) : itemRows.length === 0 ? (
              <tr><td colSpan={8} style={{ textAlign: "center", padding: 18, color: "var(--uidai-pmis-muted)" }}>
                No planned resources on this phase yet — add the first row below.
              </td></tr>
            ) : itemRows.map((r) => {
              const busy = busyId === r.id;
              const name = r.designationName || designationById[r.designationId]?.name || "—";
              return (
                <tr key={r.id}>
                  <td>
                    {/* Retired designations aren't in the options list, so keep
                        showing the row's own name as a disabled fallback
                        instead of rendering an empty select. */}
                    {designationById[r.designationId] || designations.length ? (
                      <select
                        style={cell}
                        value={r.designationId}
                        disabled={isLocked || busy}
                        onChange={(e) => patchRow(r, { designationId: e.target.value })}
                      >
                        {!designationById[r.designationId] && (
                          <option value={r.designationId}>{name} (retired)</option>
                        )}
                        {designations.map((d) => (
                          <option key={d.id} value={d.id}>
                            {d.name} — {inr(d.monthlyRate)}/mo
                          </option>
                        ))}
                      </select>
                    ) : (
                      <span>{name}</span>
                    )}
                  </td>
                  {/* The rate is snapshotted when the row is created, so a later
                      master-rate change does not silently re-price it. */}
                  <td title="Rate snapshotted when this row was created">{inr(r.monthlyRateSnapshot)}</td>
                  <td>
                    <input
                      type="date" style={cell} value={r.deployStart}
                      disabled={isLocked || busy}
                      onChange={(e) => patchRow(r, { deployStart: e.target.value })}
                    />
                  </td>
                  <td>
                    <input
                      type="date" style={cell} value={r.deployEnd} min={r.deployStart || undefined}
                      disabled={isLocked || busy}
                      onChange={(e) => patchRow(r, { deployEnd: e.target.value })}
                    />
                  </td>
                  <td>
                    <input
                      type="number" min="1" step="1" style={{ ...cell, textAlign: "right" }}
                      defaultValue={r.quantity}
                      key={`qty-${r.id}-${r.quantity}`}
                      disabled={isLocked || busy}
                      onBlur={(e) => {
                        const q = Number(e.target.value);
                        if (!Number.isFinite(q) || q <= 0) { e.target.value = r.quantity; return; }
                        if (q === Number(r.quantity)) return;
                        patchRow(r, { quantity: q });
                      }}
                      onKeyDown={(e) => { if (e.key === "Enter") e.currentTarget.blur(); }}
                    />
                  </td>
                  <td style={{ textAlign: "right" }} title="Deployment days ÷ 30.44">
                    {fmtMonths(r.durationMonths)}
                  </td>
                  <td style={{ textAlign: "right", fontWeight: 700, color: "#173e77", whiteSpace: "nowrap" }}>
                    {inr(r.computedCost)}
                  </td>
                  <td style={{ textAlign: "center" }}>
                    <button
                      type="button"
                      className="uidai-pmis-iconbtn is-danger"
                      title="Remove planned resource"
                      aria-label={`Remove ${name}`}
                      disabled={isLocked || busy}
                      onClick={() => removeRow(r)}
                    >
                      ✕
                    </button>
                  </td>
                </tr>
              );
            })}

            {/* Add-row: the same columns, so the shape of what you're adding
                matches the table above it. */}
            {!isLocked && (
              <tr style={{ background: "#f7fbff" }}>
                <td>
                  <select
                    style={cell}
                    value={draft.designationId}
                    disabled={designations.length === 0}
                    onChange={(e) => setDraft((d) => ({ ...d, designationId: e.target.value }))}
                  >
                    <option value="">
                      {designations.length === 0 ? "— No designations —" : "— Select designation —"}
                    </option>
                    {designations.map((d) => (
                      <option key={d.id} value={d.id}>{d.name} — {inr(d.monthlyRate)}/mo</option>
                    ))}
                  </select>
                </td>
                <td style={{ color: "var(--uidai-pmis-muted)" }}>
                  {draft.designationId ? inr(designationById[draft.designationId]?.monthlyRate) : "—"}
                </td>
                <td>
                  <input
                    type="date" style={cell} value={draft.deployStart}
                    onChange={(e) => setDraft((d) => ({ ...d, deployStart: e.target.value }))}
                  />
                </td>
                <td>
                  <input
                    type="date" style={cell} value={draft.deployEnd} min={draft.deployStart || undefined}
                    onChange={(e) => setDraft((d) => ({ ...d, deployEnd: e.target.value }))}
                  />
                </td>
                <td>
                  <input
                    type="number" min="1" step="1" style={{ ...cell, textAlign: "right" }}
                    value={draft.quantity}
                    onChange={(e) => setDraft((d) => ({ ...d, quantity: e.target.value }))}
                  />
                </td>
                {/* Months and cost are backend-computed — they appear once the
                    row is saved. */}
                <td style={{ textAlign: "right", color: "var(--uidai-pmis-muted)" }}>—</td>
                <td style={{ textAlign: "right", color: "var(--uidai-pmis-muted)" }}>—</td>
                <td style={{ textAlign: "center" }}>
                  <button
                    type="button"
                    className="uidai-pmis-btn uidai-pmis-btn-small"
                    style={{ marginTop: 0, padding: "4px 10px" }}
                    disabled={busyId === "new"}
                    onClick={addRow}
                  >
                    {busyId === "new" ? "…" : "Add"}
                  </button>
                </td>
              </tr>
            )}

            {itemRows.length > 0 && (
              <tr style={{ background: "#f1f6fd" }}>
                <td colSpan={6} style={{ fontWeight: 800, color: "#173e77", textAlign: "right" }}>
                  Total resource cost — phase {costItem?.phase ?? "—"}
                </td>
                <td style={{ fontWeight: 800, color: "#173e77", textAlign: "right", whiteSpace: "nowrap" }}>
                  {inr(tabTotal)}
                </td>
                <td />
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
