import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useProject } from "../../store/project/projectsStore";
import { setPageContext, clearPageContext } from "../../utils/pageContext";
import { API_BASE, authorizedFetch } from "../../api/client";
import { getToken, logout } from "../../api/auth";
import { ENDPOINTS } from "../../api/endpoint";
import { loadProjectById } from "../../api/milestoneConfigApi";
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

export default function ProjectLeaveConfigPage() {
  const { projectId } = useParams();
  const navigate = useNavigate();
  const project = useProject(projectId);

  const [form, setForm] = useState(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(null);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState(null); // { type: "ok" | "error", text }

  const set = (patch) => setForm((f) => ({ ...f, ...patch }));

  useEffect(() => {
    setPageContext({ projectName: project?.projectName || "" });
    return () => clearPageContext();
  }, [project?.projectName]);

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
        `${API_BASE}${ENDPOINTS.projects.update(projectId)}`,
        {
          method: "PATCH",
          headers: { accept: "application/json", "Content-Type": "application/json" },
          body: JSON.stringify({ leaveConfig: buildConfig() }),
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

      {/* Heading + project name already live in the top navbar, so this page
          shows only a Back action. */}
      <div className="lc-head">
        <button className="lc-btn lc-btn--ghost" onClick={() => navigate(-1)}>
          ← Back
        </button>
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
          {/* General rules — ordered: Half-Day Hours → Full-Day Hours →
              Sandwich Leave Applied → Leaves Per Frequency → Leaves Frequency */}
          <div className="lc-card">
            <h2 className="lc-section">General</h2>
            <div className="lc-grid">
              <Field label="Half-Day Hours">
                <input
                  type="number" min="0" step="0.5"
                  className="lc-input"
                  value={form.halfDayHours}
                  onChange={(e) => set({ halfDayHours: e.target.value })}
                  placeholder="e.g. 4"
                />
              </Field>

              <Field label="Full-Day Hours">
                <input
                  type="number" min="0" step="0.5"
                  className="lc-input"
                  value={form.fullDayHours}
                  onChange={(e) => set({ fullDayHours: e.target.value })}
                  placeholder="e.g. 8"
                />
              </Field>

              <YesNo
                label="Sandwich Leave Applied"
                name="sandwichLeaveApplied"
                value={form.sandwichLeaveApplied}
                onChange={(v) => set({ sandwichLeaveApplied: v })}
              />

              <Field label="Leaves Frequency">
                <select
                  className="lc-select"
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
              </Field>

              {/* Leaves Per Frequency only matters once a frequency is chosen. */}
              {form.leavesFrequency && (
                <Field label="Leaves Per Frequency">
                  <input
                    type="number" min="0" step="1"
                    className="lc-input"
                    value={form.leavesPerFrequencyCount}
                    onChange={(e) => set({ leavesPerFrequencyCount: e.target.value })}
                    placeholder="e.g. 2"
                  />
                </Field>
              )}
            </div>
          </div>

          {/* Toggles */}
          <div className="lc-card">
            <h2 className="lc-section">Attendance &amp; Leave rules</h2>
            <div className="lc-grid">
              <YesNo
                label="Attendance Captured"
                name="attendanceCaptured"
                value={form.attendanceCaptured}
                onChange={(v) => set({ attendanceCaptured: v })}
              />
              <YesNo
                label="Prorated Leaves Applied"
                name="proratedLeavesApplied"
                value={form.proratedLeavesApplied}
                onChange={(v) => set({ proratedLeavesApplied: v })}
              />
            </div>
          </div>

          {/* Weekend */}
          <div className="lc-card">
            <h2 className="lc-section">Weekend working</h2>
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
              Cancel
            </button>
            <button className="lc-btn lc-btn--primary" onClick={submit} disabled={saving}>
              {saving ? "Saving…" : "Save changes"}
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

/* ---------- scoped styles ---------- */
const LC_CSS = `
.lc-page {max-width: 960px; width: 100%; min-width: 0; margin: 0 auto; box-sizing: border-box; }
.lc-page * { box-sizing: border-box; }
@media (max-width: 640px) { .lc-page { padding: 14px 14px 24px; } }

.lc-head { display: flex; align-items: center; justify-content: space-between; gap: 16px; margin-bottom: 14px; flex-wrap: wrap; }
.lc-eyebrow { font-size: 12px; font-weight: 600; letter-spacing: .08em; text-transform: uppercase; color: ${C.primary}; }
.lc-title { font-size: 20px; font-weight: 800; letter-spacing: -.02em; color: ${C.ink}; margin: 0 0 2px; }
.lc-subtitle { color: ${C.muted}; font-size: 13px; margin: 0; }

.lc-card { background: #fff; border: 1px solid ${C.border}; border-radius: 12px; padding: 14px 16px; margin-bottom: 12px; box-shadow: 0 1px 2px rgba(11,23,42,.04); }
.lc-section { font-size: 12px; font-weight: 700; letter-spacing: .04em; text-transform: uppercase; color: ${C.muted}; margin: 0 0 12px; padding-bottom: 8px; border-bottom: 1px solid #eef1f6; }

/* 3 columns on wide screens keeps the form short; collapse on smaller ones. */
.lc-grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 12px 20px; }
@media (max-width: 720px) { .lc-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
@media (max-width: 460px) { .lc-grid { grid-template-columns: 1fr; } }

.lc-field { display: flex; flex-direction: column; gap: 5px; min-width: 0; }
.lc-field-label { font-size: 12.5px; font-weight: 600; color: ${C.ink}; }

.lc-input, .lc-select { width: 100%; box-sizing: border-box; padding: 8px 11px; border-radius: 9px; border: 1px solid ${C.border}; background: #fff; color: ${C.ink}; font-size: 14px; font-family: inherit; outline: none; transition: border-color .15s ease, box-shadow .15s ease; }
.lc-select { cursor: pointer; }
.lc-input:focus, .lc-select:focus { border-color: ${C.primary}; box-shadow: 0 0 0 3px ${C.accentBg}; }
.lc-input::placeholder { color: #9aa7b8; }

/* segmented radio pills */
.lc-radio-row { display: flex; flex-wrap: wrap; gap: 6px; }
.lc-radio { position: relative; overflow: hidden; display: inline-flex; align-items: center; gap: 7px; cursor: pointer; user-select: none;
  border: 1px solid ${C.border}; background: #fff; color: ${C.ink}; font-size: 13.5px; font-weight: 600;
  padding: 7px 13px; border-radius: 9px; transition: all .15s ease; }
.lc-radio:hover { border-color: #b9c9de; }
/* Anchor + zero-size the native input inside the pill so it can't stretch
   the page's scroll area (absolute without a positioned parent escapes). */
.lc-radio input { position: absolute; top: 0; left: 0; width: 1px; height: 1px; opacity: 0; margin: 0; pointer-events: none; }
.lc-radio-dot { width: 14px; height: 14px; border-radius: 50%; border: 2px solid #c3cede; position: relative; transition: all .15s ease; }
.lc-radio--on { border-color: ${C.primary}; background: ${C.accentBg}; color: ${C.primary}; }
.lc-radio--on .lc-radio-dot { border-color: ${C.primary}; }
.lc-radio--on .lc-radio-dot::after { content: ""; position: absolute; inset: 2px; border-radius: 50%; background: ${C.primary}; }

.lc-actions { display: flex; justify-content: flex-end; gap: 10px; margin-top: 2px; }
.lc-btn { border-radius: 9px; font-size: 14px; font-weight: 600; padding: 9px 18px; cursor: pointer; border: 1px solid ${C.border}; transition: all .18s ease; }
.lc-btn:disabled { opacity: .55; cursor: not-allowed; }
.lc-btn--ghost { background: #fff; color: ${C.ink}; }
.lc-btn--ghost:hover:not(:disabled) { background: #f9fafb; border-color: ${C.primary}; color: ${C.primary}; }
.lc-btn--primary { border: none; color: #fff; background: linear-gradient(90deg, ${C.primary}, #129ab8); box-shadow: 0 2px 6px rgba(11,60,136,.2); }
.lc-btn--primary:hover:not(:disabled) { filter: brightness(1.06); }

.lc-banner { display: flex; align-items: center; gap: 10px; border-radius: 9px; padding: 10px 14px; font-size: 13.5px; margin-bottom: 12px; }
.lc-banner--ok { background: #e6f6ee; border: 1px solid #c7ead6; color: ${C.green}; }
.lc-banner--error { background: #fde8e8; border: 1px solid #f5c9c9; color: ${C.red}; }
.lc-muted { color: ${C.muted}; font-size: 14px; padding: 6px 0; }
`;
