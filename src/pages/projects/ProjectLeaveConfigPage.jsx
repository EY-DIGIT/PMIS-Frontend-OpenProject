import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useProject } from "../../store/project/projectsStore";
import { setPageContext, clearPageContext } from "../../utils/pageContext";
import { API_BASE, authorizedFetch } from "../../api/client";
import { getToken, logout } from "../../api/auth";
import { ENDPOINTS } from "../../api/endpoint";
import { loadProjectById } from "../../api/milestoneConfigApi";
import {
  FiClock, FiCalendar, FiUsers, FiSettings, FiBarChart2,
  FiRefreshCw, FiCheckSquare, FiLayers, FiUmbrella, FiSave,
} from "react-icons/fi";
import "../../styles/global.css";

// ---------- design tokens ----------
const C = {
  primary: "#0b3c88",
  primaryDark: "#051f4a",
  ink: "#1e2a3a",
  muted: "#6b7a90",
  border: "#dbe5f1",
  surface: "#f4f7fb",
  green: "#0f9d58",
  red: "#d32f2f",
  accentBg: "#eef2ff",
};

const LEAVE_FREQUENCY_OPTIONS = [
  { value: "MONTHLY", label: "Monthly" },
  { value: "QUARTERLY", label: "Quarterly" },
  { value: "HALF_YEARLY", label: "Half-Yearly" },
  { value: "YEARLY", label: "Yearly" },
];
const DAY_TYPE_OPTIONS = [
  { value: "HALF_DAY", label: "Half Day" },
  { value: "FULL_DAY", label: "Full Day" },
];
const isDayType = (v) => v === "HALF_DAY" || v === "FULL_DAY";

// ---------- value coercion ----------
const toBoolOrNull = (v) => (v === "yes" ? true : v === "no" ? false : null);
const boolToRadio = (v) => (v === true ? "yes" : v === false ? "no" : "");
const toNumOrNull = (v) => {
  if (v === "" || v == null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};
const toStrOrNull = (v) => {
  const s = String(v ?? "").trim();
  return s || null;
};
// Summary-bar display helpers.
const freqLabel = (v) => LEAVE_FREQUENCY_OPTIONS.find((o) => o.value === v)?.label || "—";
const yesNoText = (v) => (v === "yes" ? "Yes" : v === "no" ? "No" : "—");

export default function ProjectLeaveConfigPage() {
  const { projectId } = useParams();
  const navigate = useNavigate();
  const project = useProject(projectId);

  const [form, setForm] = useState(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(null);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState(null); // { type: "ok" | "error", text }
  // The store's project is empty on a hard refresh, which blanks the navbar
  // project name. Keep the name we fetch below as a fallback so it survives.
  const [fetchedName, setFetchedName] = useState("");

  const set = (patch) => setForm((f) => ({ ...f, ...patch }));

  useEffect(() => {
    setPageContext({ projectName: project?.projectName || fetchedName || "" });
    return () => clearPageContext();
  }, [project?.projectName, fetchedName]);

  // Load the project's current config to prefill the form.
  useEffect(() => {
    if (!projectId) return;
    let active = true;
    (async () => {
      setLoading(true);
      setLoadError(null);
      try {
        const p = await loadProjectById(projectId);
        const c = p?.config || {};
        if (active) {
          setFetchedName(p?.projectName || "");
          // Backend keys: halfDay / fullDay / saturdayWorking / sundayWorking.
          // Fall back to the older names so existing records still prefill.
          const sat = c.saturdayWorking ?? c.saturday;
          const sun = c.sundayWorking ?? c.sunday;
          const weekendOn = isDayType(sat) || isDayType(sun);
          setForm({
            halfDayHours: c.halfDay ?? c.halfDayHours ?? "",
            fullDayHours: c.fullDay ?? c.fullDayHours ?? "",
            attendanceCaptured: boolToRadio(c.attendanceCaptured),
            sandwichLeaveApplied: boolToRadio(c.sandwichLeaveApplied),
            leavesPerFrequencyCount: c.leavesPerFrequencyCount ?? "",
            leavesFrequency: c.leavesFrequency ?? "",
            proratedLeavesApplied: boolToRadio(c.proratedLeavesApplied),
            carryForwardAllowed: boolToRadio(c.carryForwardAllowed),
            weekendWorking: weekendOn ? "yes" : "no",
            saturday: isDayType(sat) ? sat : "",
            sunday: isDayType(sun) ? sun : "",
          });
        }
      } catch (e) {
        if (active) setLoadError(e?.message || "Failed to load leave policy");
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => { active = false; };
  }, [projectId]);

  const weekendOn = form?.weekendWorking === "yes";

  const buildConfig = () => ({
    halfDay: toStrOrNull(form.halfDayHours),
    fullDay: toStrOrNull(form.fullDayHours),
    attendanceCaptured: toBoolOrNull(form.attendanceCaptured),
    sandwichLeaveApplied: toBoolOrNull(form.sandwichLeaveApplied),
    // Count is only meaningful alongside a frequency; null it out otherwise.
    leavesPerFrequencyCount: form.leavesFrequency ? toNumOrNull(form.leavesPerFrequencyCount) : null,
    leavesFrequency: toStrOrNull(form.leavesFrequency),
    proratedLeavesApplied: toBoolOrNull(form.proratedLeavesApplied),
    carryForwardAllowed: toBoolOrNull(form.carryForwardAllowed),
    // Weekend off → both null. On → send each day's type (blank stays null).
    saturdayWorking: weekendOn ? (form.saturday || null) : null,
    sundayWorking: weekendOn ? (form.sunday || null) : null,
  });

   async function submit() {

    setMsg(null);

    setSaving(true);

    try {

      const token = getToken();

      if (!token) throw new Error("Your session has expired. Please sign in again.");

      const res = await authorizedFetch(

        `${API_BASE}${ENDPOINTS.projects.config(projectId)}`,

        {

          method: "PUT",

          headers: { accept: "application/json", "Content-Type": "application/json" },

          body: JSON.stringify(buildConfig()),

        }

      );

      if (res.status === 401) { logout(); navigate("/login"); return; }

      if (!res.ok && res.status !== 204) {

        const body = await res.text().catch(() => "");

        throw new Error(body || `Request failed (${res.status})`);

      }

      setMsg({ type: "ok", text: "Leave policy saved successfully." });

    } catch (e) {

      setMsg({ type: "error", text: e?.message || "Failed to save leave policy" });

    } finally {

      setSaving(false);

    }

  }

  return (
    <div className="uidai-pmis-content lc-page">
      <style>{LC_CSS}</style>

      {/* Page header — icon + title + subtitle (matches the mockup). */}
      <div className="lc-pagehead">
        <span className="lc-pagehead-ico"><FiCalendar /></span>
        <div>
          <h1 className="lc-pagehead-title">Leave Policy Configuration</h1>
        </div>
      </div>

      {msg && (
        <div className={`lc-banner lc-banner--${msg.type}`}>
          <span>{msg.type === "error" ? "⚠️" : "✓"}</span>
          {msg.text}
        </div>
      )}

      {loading ? (
        <div className="lc-card"><div className="lc-muted">Loading…</div></div>
      ) : loadError ? (
        <div className="lc-card"><div className="lc-banner lc-banner--error" style={{ margin: 0 }}>⚠️ {loadError}</div></div>
      ) : (
        <>
          {/* Leave Rule Summary bar */}
          <div className="lc-summary">
            <div className="lc-summary-head">
              <span className="lc-summary-ico"><FiBarChart2 /></span>
              <span>Leave Rule<br />Summary</span>
            </div>
            <SummaryItem tone="blue" icon={<FiClock />} label="Half Day Hours" value={`${form.halfDayHours || "—"} Hours`} />
            <SummaryItem tone="blue" icon={<FiClock />} label="Full Day Hours" value={`${form.fullDayHours || "—"} Hours`} />
            <SummaryItem tone="purple" icon={<FiCalendar />} label="Leaves Frequency" value={freqLabel(form.leavesFrequency)} />
            <SummaryItem tone="green" icon={<FiUsers />} label="Leaves Per Frequency" value={form.leavesPerFrequencyCount || "—"} />
            <SummaryItem tone="orange" icon={<FiLayers />} label="Sandwich Leave" value={yesNoText(form.sandwichLeaveApplied)} />
          </div>

          {/* General Configuration */}
          <div className="lc-card">
            <div className="lc-section">
              <span className="lc-section-ico"><FiSettings /></span> General Configuration
            </div>
            <div className="lc-grid">
              <Field label="Half-Day Hours">
                <div className="lc-ig">
                  <span className="lc-ig-ico"><FiClock /></span>
                  <input
                    type="number" min="0" step="0.5"
                    className="lc-input lc-input--icon lc-input--suffix"
                    value={form.halfDayHours}
                    onChange={(e) => set({ halfDayHours: e.target.value })}
                    placeholder="e.g. 4"
                  />
                  <span className="lc-ig-suffix">Hours</span>
                </div>
              </Field>

              <Field label="Full-Day Hours">
                <div className="lc-ig">
                  <span className="lc-ig-ico"><FiClock /></span>
                  <input
                    type="number" min="0" step="0.5"
                    className="lc-input lc-input--icon lc-input--suffix"
                    value={form.fullDayHours}
                    onChange={(e) => set({ fullDayHours: e.target.value })}
                    placeholder="e.g. 8"
                  />
                  <span className="lc-ig-suffix">Hours</span>
                </div>
              </Field>

              <Field label="Sandwich Leave Applied">
                <Segmented
                  value={form.sandwichLeaveApplied}
                  onChange={(v) => set({ sandwichLeaveApplied: v })}
                />
              </Field>

              <Field label="Leaves Frequency">
                <div className="lc-ig">
                  <span className="lc-ig-ico"><FiCalendar /></span>
                  <select
                    className="lc-select lc-input--icon"
                    value={form.leavesFrequency}
                    onChange={(e) => {
                      const v = e.target.value;
                      // Clearing the frequency clears the dependent count too.
                      set(v ? { leavesFrequency: v } : { leavesFrequency: "", leavesPerFrequencyCount: "" });
                    }}
                  >
                    <option value="">— Select —</option>
                    {LEAVE_FREQUENCY_OPTIONS.map((o) => (
                      <option key={o.value} value={o.value}>{o.label}</option>
                    ))}
                  </select>
                </div>
              </Field>

              <Field label="Leaves Per Frequency">
                <div className="lc-ig">
                  <span className="lc-ig-ico"><FiUsers /></span>
                  <input
                    type="number" min="0" step="1"
                    className="lc-input lc-input--icon"
                    value={form.leavesPerFrequencyCount}
                    onChange={(e) => set({ leavesPerFrequencyCount: e.target.value })}
                    placeholder="e.g. 2"
                    disabled={!form.leavesFrequency}
                    title={!form.leavesFrequency ? "Select a leaves frequency first" : undefined}
                  />
                </div>
              </Field>
            </div>
          </div>

          {/* Attendance & Leave Rules — toggle switches */}
          <div className="lc-card">
            <div className="lc-section">
              <span className="lc-section-ico"><FiCalendar /></span> Attendance &amp; Leave Rules
            </div>
            <div className="lc-toggle-grid">
              <Toggle icon={<FiCheckSquare />} label="Attendance Captured"
                value={form.attendanceCaptured} onChange={(v) => set({ attendanceCaptured: v })} />
              <Toggle icon={<FiCalendar />} label="Prorated Leaves Applied"
                value={form.proratedLeavesApplied} onChange={(v) => set({ proratedLeavesApplied: v })} />
              <Toggle icon={<FiRefreshCw />} label="Carry Forward Allowed"
                value={form.carryForwardAllowed} onChange={(v) => set({ carryForwardAllowed: v })} />
            </div>
          </div>

          {/* Weekend */}
          <div className="lc-card">
            <div className="lc-section">
              <span className="lc-section-ico"><FiUmbrella /></span> Weekend Working
            </div>
            <div className="lc-grid">
              <YesNo
                label="Is the weekend a working period?"
                name="weekendWorking"
                value={form.weekendWorking}
                onChange={(v) => set({ weekendWorking: v })}
              />
            </div>

            {weekendOn && (
              <div className="lc-grid" style={{ marginTop: 4 }}>
                <Field label="Saturday">
                  <select
                    className="lc-select"
                    value={form.saturday}
                    onChange={(e) => set({ saturday: e.target.value })}
                  >
                    <option value="">Off (not a working day)</option>
                    {DAY_TYPE_OPTIONS.map((o) => (
                      <option key={o.value} value={o.value}>{o.label}</option>
                    ))}
                  </select>
                </Field>
                <Field label="Sunday">
                  <select
                    className="lc-select"
                    value={form.sunday}
                    onChange={(e) => set({ sunday: e.target.value })}
                  >
                    <option value="">Off (not a working day)</option>
                    {DAY_TYPE_OPTIONS.map((o) => (
                      <option key={o.value} value={o.value}>{o.label}</option>
                    ))}
                  </select>
                </Field>
              </div>
            )}
          </div>

          {/* Actions */}
          <div className="lc-actions">
            <button className="lc-btn lc-btn--ghost" onClick={() => navigate(-1)} disabled={saving}>
              ← Back
            </button>
            <button className="lc-btn lc-btn--primary" onClick={submit} disabled={saving}>
              <FiSave style={{ marginRight: 7 }} /> {saving ? "Saving…" : "Save"}
            </button>
          </div>
        </>
      )}
    </div>
  );
}

/* ---------- building blocks ---------- */
function Field({ label, children }) {
  return (
    <label className="lc-field">
      <span className="lc-field-label">{label}</span>
      {children}
    </label>
  );
}

function YesNo({ label, name, value, onChange }) {
  return (
    <div className="lc-field">
      <span className="lc-field-label">{label}</span>
      <div className="lc-radio-row">
        {[
          { v: "yes", l: "Yes" },
          { v: "no", l: "No" },
        ].map((opt) => {
          const active = value === opt.v;
          return (
            <label key={opt.v} className={`lc-radio${active ? " lc-radio--on" : ""}`}>
              <input
                type="radio"
                name={name}
                checked={active}
                onChange={() => onChange(opt.v)}
              />
              <span className="lc-radio-dot" />
              {opt.l}
            </label>
          );
        })}
      </div>
    </div>
  );
}

function SummaryItem({ icon, tone, label, value }) {
  return (
    <div className="lc-sum-item">
      <span className={`lc-sum-ico ${tone}`}>{icon}</span>
      <div className="lc-sum-text">
        <div className="lc-sum-label">{label}</div>
        <div className={`lc-sum-value ${tone}`}>{value}</div>
      </div>
    </div>
  );
}

function Segmented({ value, onChange }) {
  return (
    <div className="lc-seg">
      {[{ v: "yes", l: "Yes" }, { v: "no", l: "No" }].map((o) => {
        const on = value === o.v;
        return (
          <button
            key={o.v}
            type="button"
            className={`lc-seg-btn${on ? " lc-seg-btn--on" : ""}`}
            onClick={() => onChange(o.v)}
          >
            {on && <span className="lc-seg-check">✓</span>}
            {o.l}
          </button>
        );
      })}
    </div>
  );
}

function Toggle({ icon, label, value, onChange }) {
  const on = value === "yes";
  return (
    <div className="lc-toggle-row">
      <span className="lc-toggle-ico">{icon}</span>
      <span className="lc-toggle-label" title={label}>{label}</span>
      <button
        type="button"
        role="switch"
        aria-checked={on}
        aria-label={label}
        className={`lc-switch${on ? " lc-switch--on" : ""}`}
        onClick={() => onChange(on ? "no" : "yes")}
      >
        <span className="lc-switch-knob" />
      </button>
      <span className={`lc-toggle-state${on ? " on" : ""}`}>{on ? "On" : "Off"}</span>
    </div>
  );
}

/* ---------- scoped styles ---------- */
const LC_CSS = `
.lc-page {max-width: 1040px; width: 100%; min-width: 0; margin: 0 auto; box-sizing: border-box; }
.lc-page * { box-sizing: border-box; }
@media (max-width: 640px) { .lc-page { padding: 14px 14px 24px; } }

/* Page header */
.lc-pagehead { display: flex; align-items: center; gap: 14px; margin-bottom: 16px; }
.lc-pagehead-ico { display: grid; place-items: center; width: 44px; height: 44px; border-radius: 12px; background: #ede9fe; color: #7c3aed; font-size: 20px; flex: 0 0 44px; }
.lc-pagehead-title { font-size: 20px; font-weight: 800; letter-spacing: -.02em; color: ${C.ink}; margin: 0 0 2px; }
.lc-pagehead-sub { color: ${C.muted}; font-size: 13px; margin: 0; }

/* Leave Rule Summary bar */
.lc-summary { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; background: #fff; border: 1px solid ${C.border}; border-radius: 14px; padding: 14px 16px; margin-bottom: 14px; box-shadow: 0 1px 2px rgba(11,23,42,.04); }
.lc-summary-head { display: flex; align-items: center; gap: 10px; font-size: 13px; font-weight: 700; line-height: 1.15; color: ${C.ink}; padding-right: 14px; margin-right: 4px; border-right: 1px solid #eef1f6; }
.lc-summary-ico { display: grid; place-items: center; width: 36px; height: 36px; border-radius: 10px; background: #eef2ff; color: ${C.primary}; font-size: 17px; flex: 0 0 36px; }
.lc-sum-item { display: flex; align-items: center; gap: 10px; padding: 4px 10px; flex: 1 1 auto; min-width: 150px; }
.lc-sum-ico { display: grid; place-items: center; width: 36px; height: 36px; border-radius: 50%; font-size: 16px; flex: 0 0 36px; }
.lc-sum-ico.blue { background: #e0edff; color: #2563eb; }
.lc-sum-ico.purple { background: #ede9fe; color: #7c3aed; }
.lc-sum-ico.green { background: #dcfce7; color: #16a34a; }
.lc-sum-ico.orange { background: #ffedd5; color: #ea580c; }
.lc-sum-text { min-width: 0; }
.lc-sum-label { font-size: 11.5px; color: ${C.muted}; font-weight: 500; }
.lc-sum-value { font-size: 15px; font-weight: 800; }
.lc-sum-value.blue { color: #2563eb; }
.lc-sum-value.purple { color: #7c3aed; }
.lc-sum-value.green { color: #16a34a; }
.lc-sum-value.orange { color: #ea580c; }

/* Cards + section header */
.lc-card { background: #fff; border: 1px solid ${C.border}; border-radius: 14px; padding: 16px 18px; margin-bottom: 14px; box-shadow: 0 1px 2px rgba(11,23,42,.04); }
.lc-section { display: flex; align-items: center; gap: 10px; font-size: 15px; font-weight: 800; color: ${C.ink}; margin: 0 0 16px; }
.lc-section-ico { display: grid; place-items: center; width: 30px; height: 30px; border-radius: 8px; background: #eef2ff; color: ${C.primary}; font-size: 15px; flex: 0 0 30px; }

/* 3 columns on wide screens keeps the form short; collapse on smaller ones. */
.lc-grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 16px 20px; }
@media (max-width: 720px) { .lc-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
@media (max-width: 460px) { .lc-grid { grid-template-columns: 1fr; } }

.lc-field { display: flex; flex-direction: column; gap: 7px; min-width: 0; }
.lc-field-label { font-size: 12.5px; font-weight: 600; color: ${C.muted}; }

/* Input group: icon prefix + optional suffix */
.lc-ig { position: relative; display: flex; align-items: center; }
.lc-ig-ico { position: absolute; left: 11px; color: #9aa7b8; font-size: 15px; display: grid; place-items: center; pointer-events: none; z-index: 1; }
.lc-ig-suffix { position: absolute; right: 1px; top: 1px; bottom: 1px; display: grid; place-items: center; padding: 0 13px; color: ${C.muted}; font-size: 13px; background: ${C.surface}; border-left: 1px solid ${C.border}; border-radius: 0 10px 10px 0; }

.lc-input, .lc-select { width: 100%; box-sizing: border-box; padding: 10px 12px; border-radius: 10px; border: 1px solid ${C.border}; background: #fff; color: ${C.ink}; font-size: 14px; font-family: inherit; outline: none; transition: border-color .15s ease, box-shadow .15s ease; }
.lc-input--icon { padding-left: 34px; }
.lc-input--suffix { padding-right: 66px; }
.lc-select { cursor: pointer; }
.lc-input:focus, .lc-select:focus { border-color: ${C.primary}; box-shadow: 0 0 0 3px ${C.accentBg}; }
.lc-input::placeholder { color: #9aa7b8; }
.lc-input:disabled { background: #f7f9fc; color: #9aa7b8; cursor: not-allowed; }

/* Segmented Yes/No (Sandwich Leave) */
.lc-seg { display: flex; gap: 10px; }
.lc-seg-btn { flex: 1; display: inline-flex; align-items: center; justify-content: center; gap: 7px; cursor: pointer; border: 1px solid ${C.border}; background: #fff; color: ${C.ink}; font-size: 14px; font-weight: 600; padding: 10px 14px; border-radius: 10px; transition: all .15s ease; }
.lc-seg-btn:hover { border-color: #b9c9de; }
.lc-seg-btn--on { border-color: ${C.primary}; background: ${C.accentBg}; color: ${C.primary}; }
.lc-seg-check { display: inline-grid; place-items: center; width: 17px; height: 17px; border-radius: 50%; background: ${C.primary}; color: #fff; font-size: 10px; }

/* Attendance toggle switches */
.lc-toggle-grid { display: grid; grid-template-columns: repeat(3, minmax(0,1fr)); gap: 14px 20px; }
@media (max-width: 820px) { .lc-toggle-grid { grid-template-columns: repeat(2, minmax(0,1fr)); } }
@media (max-width: 520px) { .lc-toggle-grid { grid-template-columns: 1fr; } }
.lc-toggle-row { display: flex; align-items: center; gap: 10px; background: ${C.surface}; border: 1px solid #eef1f6; border-radius: 10px; padding: 10px 12px; }
.lc-toggle-ico { display: grid; place-items: center; width: 30px; height: 30px; border-radius: 8px; background: #eef2ff; color: ${C.primary}; font-size: 14px; flex: 0 0 30px; }
.lc-toggle-label { flex: 1; min-width: 0; font-size: 13px; font-weight: 600; color: ${C.ink}; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.lc-switch { position: relative; width: 44px; height: 24px; border-radius: 999px; border: none; background: #cbd5e1; cursor: pointer; padding: 0; transition: background .18s ease; flex: 0 0 44px; }
.lc-switch--on { background: #22c55e; }
.lc-switch-knob { position: absolute; top: 3px; left: 3px; width: 18px; height: 18px; border-radius: 50%; background: #fff; box-shadow: 0 1px 2px rgba(0,0,0,.25); transition: left .18s ease; }
.lc-switch--on .lc-switch-knob { left: 23px; }
.lc-toggle-state { font-size: 12.5px; font-weight: 700; color: ${C.muted}; width: 24px; text-align: left; flex: 0 0 24px; }
.lc-toggle-state.on { color: #16a34a; }

/* segmented radio pills (weekend) */
.lc-radio-row { display: flex; flex-wrap: wrap; gap: 10px; }
.lc-radio { position: relative; overflow: hidden; display: inline-flex; align-items: center; gap: 8px; cursor: pointer; user-select: none;
  border: 1px solid ${C.border}; background: #fff; color: ${C.ink}; font-size: 14px; font-weight: 600;
  padding: 9px 18px; border-radius: 10px; transition: all .15s ease; min-width: 76px; }
.lc-radio:hover { border-color: #b9c9de; }
/* Anchor + zero-size the native input inside the pill so it can't stretch
   the page's scroll area (absolute without a positioned parent escapes). */
.lc-radio input { position: absolute; top: 0; left: 0; width: 1px; height: 1px; opacity: 0; margin: 0; pointer-events: none; }
.lc-radio-dot { width: 15px; height: 15px; border-radius: 50%; border: 2px solid #c3cede; position: relative; transition: all .15s ease; }
.lc-radio--on { border-color: ${C.primary}; background: ${C.accentBg}; color: ${C.primary}; }
.lc-radio--on .lc-radio-dot { border-color: ${C.primary}; }
.lc-radio--on .lc-radio-dot::after { content: ""; position: absolute; inset: 2px; border-radius: 50%; background: ${C.primary}; }

/* Actions — centred Save (matches mockup) */
.lc-actions { display: flex; justify-content: center; gap: 10px; margin-top: 6px; }
.lc-btn { display: inline-flex; align-items: center; justify-content: center; border-radius: 10px; font-size: 14px; font-weight: 600; padding: 11px 36px; cursor: pointer; border: 1px solid ${C.border}; transition: all .18s ease; }
.lc-btn:disabled { opacity: .55; cursor: not-allowed; }
.lc-btn--ghost { background: #fff; color: ${C.ink}; }
.lc-btn--ghost:hover:not(:disabled) { background: #f9fafb; border-color: ${C.primary}; color: ${C.primary}; }
.lc-btn--primary { border: none; color: #fff; background: linear-gradient(90deg, ${C.primary}, #129ab8); box-shadow: 0 2px 6px rgba(11,60,136,.2); }
.lc-btn--primary:hover:not(:disabled) { filter: brightness(1.06); }

.lc-banner { display: flex; align-items: center; gap: 10px; border-radius: 10px; padding: 10px 14px; font-size: 13.5px; margin-bottom: 12px; }
.lc-banner--ok { background: #e6f6ee; border: 1px solid #c7ead6; color: ${C.green}; }
.lc-banner--error { background: #fde8e8; border: 1px solid #f5c9c9; color: ${C.red}; }
.lc-muted { color: ${C.muted}; font-size: 14px; padding: 6px 0; }
`;
