import React, { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
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
     DELETE/projects/cost-items/{id}                — remove a cost row
     PATCH /projects/payment-terms/{tid}            — set frequency + %
     PUT   /projects/{pid}/phases/{n}/qrg           — toggle QRG per phase
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

/* Shared response/error unwrapper that mirrors the backend envelope. */
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

/* Inline multi-select used for the Milestones cell on the Fixed-row
   editor. Keeps the spec-mocked "<No Milestones>" italic placeholder
   when disabled. */
function MilestoneMultiSelect({ value, options, onChange, disabled }) {
  const [open, setOpen] = useState(false);
  const selected = Array.isArray(value) ? value : [];

  function toggle(id) {
    if (selected.includes(id)) onChange(selected.filter((s) => s !== id));
    else onChange([...selected, id]);
  }

  // Render selected ids as names from the options list.
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
          fontStyle: disabled ? "italic" : "normal",
        }}
      >
        <span style={{
          overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
          color: labels.length ? "var(--uidai-pmis-text)" : "var(--uidai-pmis-muted)",
        }}>
          {disabled
            ? "<No Milestones>"
            : labels.length
              ? labels.join(", ")
              : "Select milestones…"}
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
          ) : options.map((opt) => (
            <label key={opt.id} style={{
              display: "flex", alignItems: "center", gap: 8, padding: "6px 8px",
              borderRadius: 6, cursor: "pointer", fontSize: 13,
            }}
              onMouseDown={(e) => e.preventDefault()}
              onClick={(e) => { e.stopPropagation(); toggle(opt.id); }}
            >
              <input type="checkbox" readOnly checked={selected.includes(opt.id)} style={{ width: "auto" }} />
              {opt.name}
            </label>
          ))}
        </div>
      )}
    </div>
  );
}

function SummaryPanel({ totals, rules }) {
  const fixed = Number(totals?.fixedCost) || 0;
  const oneTime = Number(totals?.oneTimeCost) || 0;
  const total = Number(totals?.totalContractCost) || 0;
  return (
    <div style={{
      background: "#f7faff", border: "1px solid var(--uidai-pmis-border)",
      borderRadius: 10, padding: 16, height: "fit-content",
    }}>
      <div style={{
        textAlign: "center", fontSize: 15, fontWeight: 800, color: "#173e77",
        paddingBottom: 10, marginBottom: 12,
        borderBottom: "1px solid var(--uidai-pmis-border)",
      }}>
        Summary
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 10, marginBottom: 14 }}>
        <div style={{ display: "flex", justifyContent: "space-between", gap: 8, fontSize: 13 }}>
          <span style={muted}>Fixed Cost</span>
          <strong style={{ color: "#173e77" }}>{inr(fixed)}</strong>
        </div>
        <div style={{ display: "flex", justifyContent: "space-between", gap: 8, fontSize: 13 }}>
          <span style={muted}>One-Time Cost</span>
          <strong style={{ color: "#173e77" }}>{inr(oneTime)}</strong>
        </div>
        <div style={{
          display: "flex", justifyContent: "space-between", gap: 8,
          padding: "10px 0", borderTop: "1px dashed var(--uidai-pmis-border)",
          fontSize: 14, fontWeight: 700,
        }}>
          <span style={{ color: "#173e77" }}>Total Cost</span>
          <strong style={{ color: "#173e77" }}>{inr(total)}</strong>
        </div>
      </div>

      <div style={{
        background: "#eef4fc", borderRadius: 8, padding: "10px 12px",
      }}>
        <ul style={{ margin: 0, paddingLeft: 18, fontSize: 12, lineHeight: 1.55, color: "#33445e" }}>
          {rules.map((r, i) => <li key={i} style={{ marginBottom: 4 }}>{r}</li>)}
        </ul>
      </div>
    </div>
  );
}

export default function ProjectFinancePage() {
  const { projectId } = useParams();
  const navigate = useNavigate();

  // ── Master data ──
  const [costTypes, setCostTypes] = useState([]);   // [{ code, name, active }]
  const [frequencies, setFrequencies] = useState([]); // [{ code, name, active }]
  const [milestones, setMilestones] = useState([]); // [{ id, name }]

  // ── Live payment-page state (single source of truth) ──
  const [page, setPage] = useState(null); // PaymentPage shape from API
  const [pageLoading, setPageLoading] = useState(false);
  const [pageError, setPageError] = useState("");

  // ── New-cost-item draft (inline form below the table) ──
  const [showAddRow, setShowAddRow] = useState(false);
  const [draft, setDraft] = useState({
    costTypeCode: "fixed", phase: 1, cost: "", taxPercent: "", milestoneIds: [],
  });
  const [addingRow, setAddingRow] = useState(false);

  // ── Per-payment-term local edit buffer (debounced PATCH per term) ──
  const [termEdits, setTermEdits] = useState({}); // { termId: { frequencyCode, percentOfPayment, saving, error } }

  // ── CCN cap edit buffer (number input) ──
  const [ccnInput, setCcnInput] = useState("");
  const [ccnSaving, setCcnSaving] = useState(false);

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
      // Milestone failure is non-fatal — the Fixed editor will just be empty.
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
      // Seed the CCN input from server (so toggling save/refresh doesn't
      // blow away the user's in-progress typing on subsequent silent refreshes).
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

  // Initial load — masters + milestones + payment page in parallel.
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

  // Active phases come from the cost items (phase numbers in use).
  const phaseNumbersFromCosts = useMemo(() => {
    const set = new Set();
    costItems.forEach((c) => { if (c.phase) set.add(Number(c.phase)); });
    return Array.from(set).sort((a, b) => a - b);
  }, [costItems]);

  const hasOneTime = costItems.some((c) => c.costTypeCode === "one_time");

  // ── Mutations ────────────────────────────────────────────────────
  async function addCostItem() {
    if (!projectId) return;
    if (draft.cost === "" || draft.taxPercent === "") {
      uiStore.showError("Enter both Cost and Tax %.");
      return;
    }
    if (draft.costTypeCode === "fixed" && draft.milestoneIds.length === 0) {
      uiStore.showError("Pick at least one milestone for a Fixed cost row.");
      return;
    }
    if (draft.costTypeCode === "one_time" && hasOneTime) {
      uiStore.showError("Only one One-Time cost row is allowed per project.");
      return;
    }
    const body =
      draft.costTypeCode === "fixed"
        ? {
          costTypeCode: "fixed",
          phase: Number(draft.phase) || 1,
          cost: Number(draft.cost),
          taxPercent: Number(draft.taxPercent),
          milestoneIds: draft.milestoneIds,
        }
        : {
          costTypeCode: "one_time",
          cost: Number(draft.cost),
          taxPercent: Number(draft.taxPercent),
        };
    setAddingRow(true);
    try {
      const res = await authorizedFetch(`${API_BASE}${ENDPOINTS.projects.costItems(projectId)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      await readJson(res);
      setShowAddRow(false);
      setDraft({
        costTypeCode: "fixed", phase: 1, cost: "", taxPercent: "", milestoneIds: [],
      });
      await loadPaymentPage({ silent: true });
      uiStore.showMessage("Cost item added.");
    } catch (err) {
      if (handleAuthError(err)) return;
      uiStore.showError(err?.message || "Failed to add cost item");
    } finally {
      setAddingRow(false);
    }
  }

  async function removeCostItem(id) {
    if (!id) return;
    if (!window.confirm("Remove this cost item? Its payment terms will also be removed.")) return;
    try {
      const res = await authorizedFetch(`${API_BASE}${ENDPOINTS.costItems.remove(id)}`, { method: "DELETE" });
      if (res.status !== 204) await readJson(res);
      await loadPaymentPage({ silent: true });
      uiStore.showMessage("Cost item removed.");
    } catch (err) {
      if (handleAuthError(err)) return;
      uiStore.showError(err?.message || "Failed to remove cost item");
    }
  }

  function setTermEdit(id, patch) {
    setTermEdits((e) => ({ ...e, [id]: { ...(e[id] || {}), ...patch } }));
  }

  async function saveTerm(term) {
    const edits = termEdits[term.id] || {};
    const frequencyCode = edits.frequencyCode ?? term.frequencyCode ?? null;
    const percentRaw = edits.percentOfPayment ?? term.percentOfPayment ?? "";
    const percentOfPayment = percentRaw === "" || percentRaw === null
      ? null
      : Number(percentRaw);
    setTermEdit(term.id, { saving: true, error: "" });
    try {
      const res = await authorizedFetch(`${API_BASE}${ENDPOINTS.paymentTerms.update(term.id)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ frequencyCode, percentOfPayment }),
      });
      await readJson(res);
      setTermEdit(term.id, { saving: false, error: "" });
      // Clear staged edits for this term now that the server is authoritative.
      setTermEdits((e) => {
        const { [term.id]: _drop, ...rest } = e;
        return rest;
      });
      await loadPaymentPage({ silent: true });
    } catch (err) {
      if (handleAuthError(err)) return;
      setTermEdit(term.id, { saving: false, error: err?.message || "Save failed" });
    }
  }

  async function setQrgForPhase(phase, applied) {
    try {
      const res = await authorizedFetch(`${API_BASE}${ENDPOINTS.projects.qrg(projectId, phase)}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ qrgApplied: !!applied }),
      });
      await readJson(res);
      await loadPaymentPage({ silent: true });
    } catch (err) {
      if (handleAuthError(err)) return;
      uiStore.showError(err?.message || "Failed to update QRG");
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
      // The PATCH response is itself a full PaymentPage — use it directly
      // to avoid an extra round-trip.
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

  function frequencyLabel(code) {
    if (!code) return "";
    return frequencies.find((f) => f.code === code)?.name || code;
  }

  /* Static rules pulled from the right-hand list in the spec. */
  const summaryRules = [
    "One Time costs will not have any milestone or phase.",
    "Only one One-Time cost row is allowed per project.",
    "CCN Value is derived from the CCN Cap % applied to total cost.",
    "Every calculation is done with the Tax Value included.",
    "QRG percentile is determined automatically from the % of Payment.",
  ];

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
      {/* Page title lives in the global navbar now; only the LOCKED pill
          (when applicable) needs surfacing here. */}
      {isLocked && (
        <div style={{
          display: "inline-block", marginBottom: 14,
          padding: "4px 10px", borderRadius: 999,
          background: "#fff4e0", color: "#a35a00", fontWeight: 700, fontSize: 11,
        }}>
          LOCKED
        </div>
      )}

      {/* Section 1 — Project Cost + Summary panel */}
      <div style={{
        display: "grid",
        gridTemplateColumns: "minmax(0, 1fr) 280px",
        gap: 20,
        alignItems: "start",
      }}>
        <div className="uidai-pmis-card">
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 10, marginBottom: 8 }}>
            <div style={{ ...sectionHead, marginBottom: 0 }}>
              <span style={stepBadge}>1</span> Project Cost
            </div>
            <button
              type="button"
              className="uidai-pmis-btn uidai-pmis-btn-small"
              style={{ marginTop: 0 }}
              disabled={isLocked || showAddRow}
              onClick={() => setShowAddRow(true)}
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
                  <th style={{ width: 100 }}>Tax %</th>
                  <th style={{ width: 150 }}>Total</th>
                  <th style={{ width: 60, textAlign: "center" }}>—</th>
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
                  return (
                    <tr key={r.id}>
                      <td>{costTypeLabel(r.costTypeCode)}</td>
                      <td>
                        {isOneTime ? (
                          <span style={{ ...muted, fontStyle: "italic", fontSize: 12 }}>&lt;No Milestones&gt;</span>
                        ) : (
                          (r.milestoneIds || []).map(milestoneName).join(", ") || "—"
                        )}
                      </td>
                      <td>{inr(r.cost)}</td>
                      <td>
                        {isOneTime
                          ? <span style={{ ...muted, fontStyle: "italic", fontSize: 12 }}>&lt;No Phase&gt;</span>
                          : (r.phase ?? "—")}
                      </td>
                      <td>{r.taxPercent != null ? `${Number(r.taxPercent)} %` : "—"}</td>
                      <td>
                        <div style={{ fontWeight: 700, color: "#173e77" }}>{inr(r.total)}</div>
                        <div style={{ fontSize: 11, ...muted }}>({isOneTime ? "One-Time" : "Fixed"})</div>
                      </td>
                      <td style={{ textAlign: "center" }}>
                        <button
                          type="button"
                          title="Remove cost item"
                          disabled={isLocked}
                          onClick={() => removeCostItem(r.id)}
                          style={{
                            border: "1px solid var(--uidai-pmis-red)",
                            color: "var(--uidai-pmis-red)",
                            background: "#fff",
                            borderRadius: 6,
                            padding: "4px 10px",
                            cursor: isLocked ? "not-allowed" : "pointer",
                            fontWeight: 700,
                            opacity: isLocked ? 0.5 : 1,
                          }}
                        >
                          ✕
                        </button>
                      </td>
                    </tr>
                  );
                })}
                <tr style={{ background: "#f1f6fd" }}>
                  <td colSpan={5} style={{ fontWeight: 800, color: "#173e77" }}>Total Contract Cost</td>
                  <td colSpan={2} style={{ fontWeight: 800, color: "#173e77" }}>{inr(totals.totalContractCost)}</td>
                </tr>
              </tbody>
            </table>
          </div>

          {/* Inline "Add Cost Item" form */}
          {showAddRow && (
            <div style={{
              marginTop: 14, padding: 14,
              background: "#f7faff", border: "1px solid var(--uidai-pmis-border)", borderRadius: 10,
            }}>
              <div style={{ fontSize: 13, fontWeight: 800, color: "#173e77", marginBottom: 10 }}>
                New Cost Item
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 12 }}>
                <div className="uidai-pmis-field" style={{ marginBottom: 0 }}>
                  <label>Cost Type</label>
                  <select
                    value={draft.costTypeCode}
                    onChange={(e) => {
                      const next = e.target.value;
                      setDraft((d) => ({
                        ...d,
                        costTypeCode: next,
                        // Clear phase / milestones when switching to one_time.
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
                  {draft.costTypeCode === "one_time" ? (
                    <input value="<No Phase>" disabled style={{ fontStyle: "italic" }} />
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
                  <label>Tax %</label>
                  <input
                    type="number"
                    min="0" max="100"
                    value={draft.taxPercent}
                    onChange={(e) => setDraft((d) => ({ ...d, taxPercent: e.target.value }))}
                  />
                </div>
                <div className="uidai-pmis-field" style={{ marginBottom: 0, gridColumn: "1 / -1" }}>
                  <label>Milestones</label>
                  <MilestoneMultiSelect
                    value={draft.milestoneIds}
                    options={milestones}
                    onChange={(next) => setDraft((d) => ({ ...d, milestoneIds: next }))}
                    disabled={draft.costTypeCode === "one_time"}
                  />
                </div>
              </div>
              <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 12 }}>
                <button
                  type="button"
                  className="uidai-pmis-btn uidai-pmis-btn-cancel uidai-pmis-btn-small"
                  onClick={() => { setShowAddRow(false); }}
                  disabled={addingRow}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  className="uidai-pmis-btn uidai-pmis-btn-small"
                  style={{ marginTop: 0 }}
                  onClick={addCostItem}
                  disabled={addingRow}
                >
                  {addingRow ? "Adding…" : "Save Cost Item"}
                </button>
              </div>
            </div>
          )}
        </div>

        <SummaryPanel totals={totals} rules={summaryRules} />
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
            frequencies={frequencies}
            milestoneName={milestoneName}
            termEdits={termEdits}
            setTermEdit={setTermEdit}
            saveTerm={saveTerm}
            setQrgForPhase={setQrgForPhase}
            isLocked={isLocked}
            totals={totals}
            frequencyLabel={frequencyLabel}
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
          <div className="uidai-pmis-field" style={{ marginBottom: 0 }}>
            <label>Total Contract Cost</label>
            <input value={inr(totals.totalContractCost)} disabled />
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
  );
}

/* Each phase renders as its own collapsible panel — header is always
   visible, body collapses. Mirrors the "Collapsible" tag in the spec. */
function PhasePanel({
  phase, frequencies, termEdits, setTermEdit, saveTerm, setQrgForPhase,
  isLocked, totals, milestoneName, frequencyLabel,
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
    }}>
      <button
        type="button"
        onClick={() => setExpanded((e) => !e)}
        style={{
          width: "100%",
          display: "flex", alignItems: "center", justifyContent: "space-between",
          background: "#f1f6fd",
          border: "none",
          borderBottom: expanded ? "1px solid var(--uidai-pmis-border)" : "none",
          padding: "12px 16px",
          cursor: "pointer",
          font: "inherit",
          textAlign: "left",
        }}
      >
        <span style={{ fontWeight: 800, color: "#173e77", fontSize: 14 }}>
          Phase {phase.phase}
          <span style={{ color: "var(--uidai-pmis-muted)", fontWeight: 500, marginLeft: 10, fontSize: 12 }}>
            ({terms.length} term{terms.length === 1 ? "" : "s"} · {totalPercent}% scheduled · Phase Fixed: {inr(phase.phaseFixedTotal)})
          </span>
        </span>
        <span style={{ color: "var(--uidai-pmis-muted)", fontSize: 14 }}>{expanded ? "▲ Collapse" : "▼ Expand"}</span>
      </button>

      {expanded && (
        <div style={{ padding: 16 }}>
          <div style={{
            display: "flex", flexWrap: "wrap", alignItems: "center", gap: 16,
            background: "#f7faff", border: "1px solid var(--uidai-pmis-border)",
            borderRadius: 8, padding: "10px 14px", marginBottom: 14,
          }}>
            <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
              <span style={{ fontWeight: 700, color: "#173e77", fontSize: 13 }}>QRG Applied:</span>
              <label style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: 13, cursor: isLocked ? "not-allowed" : "pointer" }}>
                <input
                  type="radio"
                  name={`qrg-${phase.phase}`}
                  checked={qrgApplied === true}
                  disabled={isLocked}
                  onChange={() => setQrgForPhase(phase.phase, true)}
                  style={{ width: "auto" }}
                />
                Yes
              </label>
              <label style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: 13, cursor: isLocked ? "not-allowed" : "pointer" }}>
                <input
                  type="radio"
                  name={`qrg-${phase.phase}`}
                  checked={qrgApplied === false}
                  disabled={isLocked}
                  onChange={() => setQrgForPhase(phase.phase, false)}
                  style={{ width: "auto" }}
                />
                No
              </label>
            </div>
            {qrgApplied && phase.qrg && (
              <div style={{ flex: 1, minWidth: 280, fontSize: 12, color: "#33445e" }}>
                <span style={{ fontWeight: 700, color: "#173e77" }}>QRG:</span>{" "}
                {Number(phase.qrg.percent)} % ={" "}
                <strong style={{ color: "#173e77" }}>{inr(phase.qrg.value)}</strong>
              </div>
            )}
          </div>

          <div className="uidai-pmis-table-wrap">
            <table className="uidai-pmis-table uidai-pmis-table-compact">
              <thead>
                <tr>
                  <th style={{ width: 70 }}>Phase</th>
                  <th>Milestone</th>
                  <th style={{ width: 160 }}>Frequency</th>
                  <th style={{ width: 150 }}>% of Payment</th>
                  <th style={{ width: 170 }}>Value</th>
                  <th style={{ width: 90, textAlign: "center" }}>—</th>
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
                  const edit = termEdits[t.id] || {};
                  const freq = edit.frequencyCode ?? t.frequencyCode ?? "";
                  const pct = edit.percentOfPayment ?? (t.percentOfPayment ?? "");
                  const dirty =
                    edit.frequencyCode !== undefined ||
                    edit.percentOfPayment !== undefined;
                  return (
                    <tr key={t.id}>
                      <td style={{ fontWeight: 700, color: "#173e77" }}>{t.phase}</td>
                      <td>{milestoneName(t.milestoneId)}</td>
                      <td>
                        <select
                          style={ctrl}
                          value={freq || ""}
                          disabled={isLocked}
                          onChange={(e) => setTermEdit(t.id, { frequencyCode: e.target.value || null })}
                        >
                          <option value="">— Select —</option>
                          {frequencies.map((f) => <option key={f.code} value={f.code}>{f.name}</option>)}
                        </select>
                      </td>
                      <td>
                        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                          <input
                            type="number"
                            min="0" max="100"
                            style={ctrl}
                            value={pct === null ? "" : pct}
                            disabled={isLocked}
                            onChange={(e) => setTermEdit(t.id, { percentOfPayment: e.target.value })}
                          />
                          <span style={{ color: "var(--uidai-pmis-muted)", fontSize: 13 }}>%</span>
                        </div>
                      </td>
                      <td style={{ fontWeight: 700, color: "#173e77" }}>{inr(t.value)}</td>
                      <td style={{ textAlign: "center" }}>
                        <button
                          type="button"
                          className="uidai-pmis-btn uidai-pmis-btn-small"
                          style={{
                            marginTop: 0,
                            opacity: dirty && !edit.saving ? 1 : 0.5,
                            cursor: dirty && !edit.saving ? "pointer" : "not-allowed",
                          }}
                          disabled={!dirty || edit.saving || isLocked}
                          onClick={() => saveTerm(t)}
                        >
                          {edit.saving ? "Saving…" : "Save"}
                        </button>
                        {edit.error && (
                          <div style={{ color: "var(--uidai-pmis-red)", fontSize: 11, marginTop: 4 }}>
                            {edit.error}
                          </div>
                        )}
                        {!dirty && t.frequencyCode && (
                          <div style={{ ...{ color: "var(--uidai-pmis-muted)" }, fontSize: 11, marginTop: 4 }}>
                            {frequencyLabel(t.frequencyCode)}
                          </div>
                        )}
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
