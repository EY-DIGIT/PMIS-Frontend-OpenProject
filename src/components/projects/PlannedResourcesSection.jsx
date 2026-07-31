import React, { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { uiStore } from "../../store/project/uiStore";
import * as plannedApi from "../../api/plannedResources";

/* ────────────────────────────────────────────────────────────────────
   Planned Resources — resource-type phase costing.

   A resource-type phase's resource cost is not a typed amount: it is the
   SUM of its planned-resource rows, and that sum auto-populates the phase's
   `resource_cost` cost item. One row = role + deployment window + headcount.

   Pricing is PER CONTRACT YEAR, not a flat monthly rate. The backend splits
   the deployment window on the project's contract-year boundaries and, for
   each year the window touches, charges

       quantity × rateCardByYear["Year-N"] × months-in-that-year

   The split comes back as `costByYear`, which is why each row can be
   expanded to show it — a row spanning a rate change is otherwise a single
   number the user can't reconcile against the rate card.

   Roles and their rate cards come from leave-management (the same data the
   Designation Rates page uploads), scoped to project + organization. The
   payment backend never calls that service, so picking a role here sends
   both the role and its rateCardByYear.
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

const EMPTY_DRAFT = { role: "", quantity: "1", deployStart: "", deployEnd: "" };

const cell = {
  width: "100%", padding: "5px 7px", border: "1px solid var(--uidai-pmis-border)",
  borderRadius: 6, background: "#fff", font: "inherit", fontSize: 12.5,
  boxSizing: "border-box",
};

/* A compact "₹1.98L → ₹2.12L" summary of a multi-year card, so the picker
   and the row can show what a role costs without a table. */
function rateCardSummary(card) {
  const keys = plannedApi.sortedYearKeys(card);
  if (keys.length === 0) return "";
  const first = card[keys[0]];
  const last = card[keys[keys.length - 1]];
  if (keys.length === 1 || first === last) return `${inr(first)}/mo`;
  return `${inr(first)} → ${inr(last)}/mo`;
}

export default function PlannedResourcesSection({
  projectId,
  /* Resource-cost cost items for the project. Each: { id, phase, lineLabel }. */
  resourceCostItems = [],
  vendorId = "",
  vendorName = "",
  isLocked = false,
  onChanged,
}) {
  const [rows, setRows] = useState([]);
  const [roles, setRoles] = useState([]);
  const [roleError, setRoleError] = useState("");
  const [rolesLoading, setRolesLoading] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [busyId, setBusyId] = useState("");
  const [activeItem, setActiveItem] = useState(0);
  const [draft, setDraft] = useState(EMPTY_DRAFT);
  /* Rows expanded to show their per-contract-year cost split. */
  const [expanded, setExpanded] = useState(() => new Set());

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

  /* Rate cards are per project + organization, so the picker reloads when the
     active org tab changes. Failures are surfaced rather than swallowed —
     an empty dropdown and a failed request are not the same problem. */
  async function loadRoles() {
    setRoleError("");
    if (!vendorId) {
      setRoles([]);
      return;
    }
    setRolesLoading(true);
    try {
      setRoles(await plannedApi.listDesignationRates(projectId, vendorId));
    } catch (err) {
      setRoles([]);
      setRoleError(err?.message || "Failed to load the rate card");
    } finally {
      setRolesLoading(false);
    }
  }

  useEffect(() => {
    loadRows();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId]);

  useEffect(() => {
    loadRoles();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId, vendorId]);

  const itemRows = useMemo(
    () => (costItem ? rows.filter((r) => r.costItemId === costItem.id) : []),
    [rows, costItem]
  );
  const tabTotal = itemRows.reduce((s, r) => s + (Number(r.computedCost) || 0), 0);

  /* Roles are keyed by name because that IS the identifier on a saved row —
     the response carries `role`, not a rate-card id. */
  const roleByName = useMemo(() => {
    const m = {};
    roles.forEach((r) => { m[r.role] = r; });
    return m;
  }, [roles]);

  /* Every contract year present across this tab's rows — drives the
     expanded breakdown's ordering. */
  const yearKeys = useMemo(() => {
    const set = new Set();
    itemRows.forEach((r) => {
      Object.keys(r.costByYear || {}).forEach((k) => set.add(k));
      Object.keys(r.rateCardSnapshot || {}).forEach((k) => set.add(k));
    });
    return [...set].sort(plannedApi.yearKeyOrder);
  }, [itemRows]);

  const toggleExpand = (id) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  /* Mutations always re-pull both this list and the payment page: the row's
     costByYear/computedCost and the phase's resource cost are both
     backend-derived. */
  async function afterMutation() {
    await loadRows();
    if (typeof onChanged === "function") await onChanged();
  }

  async function addRow() {
    if (!costItem) return;
    const rate = roleByName[draft.role];
    if (!rate) { uiStore.showError("Pick a role."); return; }
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
      await plannedApi.createPlannedResource(projectId, {
        costItemId: costItem.id,
        role: rate.role,
        // The payment backend doesn't read leave-management — the card
        // travels with the role and is snapshotted on the row.
        rateCardByYear: rate.rateCardByYear,
        organisationId: vendorId,
        quantity: qty,
        deployStart: draft.deployStart,
        deployEnd: draft.deployEnd,
      });
      setDraft(EMPTY_DRAFT);
      await afterMutation();
      uiStore.showMessage("Planned resource added.");
    } catch (err) {
      uiStore.showError(err?.message || "Failed to add planned resource");
    } finally {
      setBusyId("");
    }
  }

  /* One field at a time — the BE re-prices the row on every PATCH, so there
     is nothing to batch. Changing the role carries its rate card along,
     otherwise the row would keep the previous role's prices. */
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

  function changeRole(row, roleName) {
    const rate = roleByName[roleName];
    if (!rate) return;
    patchRow(row, { role: rate.role, rateCardByYear: rate.rateCardByYear, organisationId: vendorId });
  }

  async function removeRow(row) {
    const label = row.role || "this row";
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

  /* No resource-cost cost item = nothing rows could attach to. Say so rather
     than rendering an empty table the user can't use. */
  if (resourceCostItems.length === 0) {
    return (
      <div style={{ padding: 18, textAlign: "center", color: "var(--uidai-pmis-muted)", fontSize: 13 }}>
        Add a <strong>Resource</strong> cost row to a phase first — planned resources attach to it,
        and their total becomes that phase's resource cost.
      </div>
    );
  }

  const noRoles = !rolesLoading && !roleError && roles.length === 0;

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
          Priced from {vendorName ? <><strong>{vendorName}</strong>'s</> : "the organization's"} contract-year
          rate card — each year of the deployment window is charged at that year's rate.
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

      {/* Why the role picker looks the way it does. Without this, an empty
          dropdown gives the user nothing to act on. */}
      {(roleError || noRoles || !vendorId) && (
        <div
          style={{
            display: "flex", alignItems: "center", justifyContent: "space-between",
            flexWrap: "wrap", gap: 10, marginBottom: 10, padding: "9px 12px",
            border: `1px solid ${roleError ? "#f5c6c6" : "#e2e8f3"}`,
            background: roleError ? "#fff7f7" : "#f7fbff",
            borderRadius: 8, fontSize: 12.5,
            color: roleError ? "#b3261e" : "#3d5372",
          }}
        >
          <span>
            {roleError
              ? `The rate card could not be loaded — ${roleError}`
              : !vendorId
                ? "This organization couldn't be matched to the vendor master, so its rate card can't be looked up."
                : <>No rate card on file for {vendorName || "this organization"} yet — upload it on the Designation Rates page, then reload here.</>}
          </span>
          <span style={{ display: "inline-flex", gap: 8, alignItems: "center" }}>
            {roleError && (
              <button
                type="button"
                className="uidai-pmis-btn uidai-pmis-btn-cancel uidai-pmis-btn-small"
                style={{ marginTop: 0, padding: "4px 10px" }}
                onClick={loadRoles}
              >
                Retry
              </button>
            )}
            {projectId && (
              <Link
                to={`/projects/${encodeURIComponent(projectId)}/designation-rate`}
                className="uidai-pmis-btn uidai-pmis-btn-small"
                style={{ marginTop: 0, padding: "4px 10px", textDecoration: "none" }}
              >
                Designation Rates
              </Link>
            )}
          </span>
        </div>
      )}

      <div className="uidai-pmis-table-wrap">
        <table className="uidai-pmis-table uidai-pmis-table-compact">
          <thead>
            <tr>
              <th style={{ minWidth: 200 }}>Role</th>
              <th style={{ width: 170 }}>Rate Card</th>
              <th style={{ width: 150 }}>Deploy From</th>
              <th style={{ width: 150 }}>Deploy To</th>
              <th style={{ width: 90, textAlign: "right" }}>Qty</th>
              <th style={{ width: 100, textAlign: "right" }}>Months</th>
              <th style={{ width: 150, textAlign: "right" }}>Cost</th>
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
              /* A row's rate card is its own snapshot, which can differ from
                 the current card — show the snapshot, not today's rate. */
              const summary = rateCardSummary(r.rateCardSnapshot);
              const hasSplit = Object.keys(r.costByYear || {}).length > 0;
              const open = expanded.has(r.id);
              /* A role that has since been removed from the rate card isn't in
                 the options, so keep it selectable-looking rather than blank. */
              const roleMissing = r.role && !roleByName[r.role];
              return (
                <React.Fragment key={r.id}>
                  <tr style={open ? { background: "#eef5ff" } : undefined}>
                    <td>
                      {roles.length === 0 ? (
                        <span>{r.role || "—"}</span>
                      ) : (
                        <select
                          style={cell}
                          value={r.role}
                          disabled={isLocked || busy}
                          onChange={(e) => changeRole(r, e.target.value)}
                        >
                          {roleMissing && <option value={r.role}>{r.role} (not on the current card)</option>}
                          {roles.map((o) => (
                            <option key={o.id || o.role} value={o.role}>{o.role}</option>
                          ))}
                        </select>
                      )}
                    </td>
                    <td title="Rate card snapshotted when this row was saved">
                      <span style={{ fontSize: 12 }}>{summary || "—"}</span>
                    </td>
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
                    <td style={{ textAlign: "right" }} title="Total across the whole window (fractional months)">
                      {fmtMonths(r.durationMonths)}
                    </td>
                    <td style={{ textAlign: "right", fontWeight: 700, color: "#173e77", whiteSpace: "nowrap" }}>
                      {inr(r.computedCost)}
                      {hasSplit && (
                        <button
                          type="button"
                          onClick={() => toggleExpand(r.id)}
                          aria-expanded={open}
                          title="Show the per-contract-year split"
                          style={{
                            display: "block", marginLeft: "auto", marginTop: 2,
                            border: "1px solid #cfe0f5", background: "#eef3fb", color: "#0b3c88",
                            fontSize: 10.5, fontWeight: 700, borderRadius: 999,
                            padding: "1px 8px", cursor: "pointer",
                          }}
                        >
                          {open ? "▾" : "▸"} {Object.keys(r.costByYear).length} year
                          {Object.keys(r.costByYear).length === 1 ? "" : "s"}
                        </button>
                      )}
                    </td>
                    <td style={{ textAlign: "center" }}>
                      <button
                        type="button"
                        className="uidai-pmis-iconbtn is-danger"
                        title="Remove planned resource"
                        aria-label={`Remove ${r.role || "row"}`}
                        disabled={isLocked || busy}
                        onClick={() => removeRow(r)}
                      >
                        ✕
                      </button>
                    </td>
                  </tr>

                  {/* Per-contract-year split — what the window actually cost in
                      each year, at that year's rate. */}
                  {open && hasSplit && (
                    <tr style={{ background: "#f6faff" }}>
                      <td style={{ borderLeft: "3px solid #0aa1c0" }} />
                      <td colSpan={7} style={{ padding: "8px 10px" }}>
                        <div style={{ display: "flex", gap: 18, flexWrap: "wrap" }}>
                          {(yearKeys.length ? yearKeys : plannedApi.sortedYearKeys(r.costByYear))
                            .filter((y) => r.costByYear[y] != null)
                            .map((y) => (
                              <div key={y} style={{ fontSize: 11.5, lineHeight: 1.5 }}>
                                <div style={{ fontWeight: 800, color: "#0b3c88" }}>{y}</div>
                                <div style={{ color: "#173e77", fontWeight: 700 }}>{inr(r.costByYear[y])}</div>
                                {r.rateCardSnapshot[y] != null && (
                                  <div style={{ color: "var(--uidai-pmis-muted)" }}>
                                    @ {inr(r.rateCardSnapshot[y])}/mo × {r.quantity}
                                  </div>
                                )}
                              </div>
                            ))}
                        </div>
                      </td>
                    </tr>
                  )}
                </React.Fragment>
              );
            })}

            {/* Add-row: the same columns, so the shape of what you're adding
                matches the table above it. */}
            {!isLocked && (
              <tr style={{ background: "#f7fbff" }}>
                <td>
                  <select
                    style={cell}
                    value={draft.role}
                    disabled={roles.length === 0}
                    onChange={(e) => setDraft((d) => ({ ...d, role: e.target.value }))}
                  >
                    <option value="">
                      {rolesLoading
                        ? "Loading roles…"
                        : roles.length === 0 ? "— No rate card —" : "— Select role —"}
                    </option>
                    {roles.map((o) => (
                      <option key={o.id || o.role} value={o.role}>{o.role}</option>
                    ))}
                  </select>
                </td>
                <td style={{ color: "var(--uidai-pmis-muted)", fontSize: 12 }}>
                  {draft.role ? rateCardSummary(roleByName[draft.role]?.rateCardByYear) || "—" : "—"}
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
                {/* Months and the per-year cost are backend-computed — they
                    appear once the row is saved. */}
                <td style={{ textAlign: "right", color: "var(--uidai-pmis-muted)" }}>—</td>
                <td style={{ textAlign: "right", color: "var(--uidai-pmis-muted)" }}>—</td>
                <td style={{ textAlign: "center" }}>
                  <button
                    type="button"
                    className="uidai-pmis-btn uidai-pmis-btn-small"
                    style={{ marginTop: 0, padding: "4px 10px" }}
                    disabled={busyId === "new" || roles.length === 0}
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
