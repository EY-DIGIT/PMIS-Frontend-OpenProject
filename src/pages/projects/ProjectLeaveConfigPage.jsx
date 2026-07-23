// ============================================================
// ProjectLeaveConfigPage.jsx — the project's leave policy
// (/projects/:projectId/leave-config).
//
//   GET  via loadProjectById(projectId) → project.config
//   PUT  ENDPOINTS.projects.config(projectId)
//
// Styled to the same idiom as Attendance and the Leave Detail page:
// eyebrow + title header, quiet section labels with a rule running off
// them, house cards, and colour spent only where it states something.
// ============================================================
import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useProject } from "../../store/project/projectsStore";
import { setPageContext, clearPageContext } from "../../utils/pageContext";
import { API_BASE, authorizedFetch } from "../../api/client";
import { getToken, logout } from "../../api/auth";
import { ENDPOINTS } from "../../api/endpoint";
import { loadProjectById } from "../../api/milestoneConfigApi";
import {
  readErrorMessage, requestErrorMessage, notifyActionError, notifyActionSuccess,
} from "../../utils/apiMessage";
import "../../styles/global.css";

// ---------- design tokens ----------
const C = {
  primary: "#0b3c88",
  primaryDark: "#072a63",
  ink: "#16202e",
  muted: "#64748b",
  faint: "#94a3b8",
  border: "#e3e9f2",
  divider: "#eef2f7",
  surface: "#f6f9fc",
  green: "#0f9d58",
  red: "#d64545",
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

/* ---------- validation ----------
   A day can't be longer than a day, and an allowance without a period (or a
   period without an allowance) is only half a rule. Both are checked here
   because the API accepts either silently and the mistake only surfaces
   months later in someone's leave balance. */
const MAX_HOURS = 24;
/* A yearly grant beyond this isn't a policy, it's a typo. */
const MAX_LEAVE_DAYS = 366;

/* Returns "" when valid. Hours are entered as 4 / 8 / 7.5 — decimals are
   allowed, everything else is not. */
function validateHours(raw, label) {
  const text = String(raw ?? "").trim();
  if (!text) return "";                                  // optional
  if (!/^\d+(\.\d+)?$/.test(text)) return `${label} must be a number, for example 8.`;
  const n = Number(text);
  if (!Number.isFinite(n)) return `${label} must be a number, for example 8.`;
  if (n <= 0) return `${label} must be greater than 0.`;
  if (n > MAX_HOURS) return `${label} can't be more than ${MAX_HOURS}.`;
  return "";
}

function validateConfig(f) {
  const errs = {};

  const halfErr = validateHours(f.halfDayHours, "Half-day hours");
  if (halfErr) errs.halfDayHours = halfErr;
  const fullErr = validateHours(f.fullDayHours, "Full-day hours");
  if (fullErr) errs.fullDayHours = fullErr;

  // Only compare once both are individually valid, or the message misleads.
  if (!halfErr && !fullErr && f.halfDayHours !== "" && f.fullDayHours !== "") {
    const half = Number(f.halfDayHours);
    const full = Number(f.fullDayHours);
    if (half >= full) {
      errs.halfDayHours = "A half day has to be shorter than a full day.";
    }
  }

  const countText = String(f.leavesPerFrequencyCount ?? "").trim();
  if (countText) {
    if (!/^\d+$/.test(countText)) errs.leavesPerFrequencyCount = "Enter a whole number of days.";
    else if (Number(countText) > MAX_LEAVE_DAYS) {
      errs.leavesPerFrequencyCount = `That's more days than a year holds.`;
    }
  }

  /* The two halves of the allowance rule. A count with no frequency is
     dropped on save (see buildConfig), so it must be caught here rather
     than silently discarded. */
  if (f.leavesFrequency && !countText) {
    errs.leavesPerFrequencyCount = "Set how many days each period grants.";
  }
  if (!f.leavesFrequency && countText) {
    errs.leavesFrequency = "Choose how often these days are granted.";
  }

  /* Weekend on with neither day picked sends both as null, which is exactly
     what "off" sends — the setting would appear saved but do nothing. */
  if (f.weekendWorking === "yes" && !f.saturday && !f.sunday) {
    errs.saturday = "Pick a day type for Saturday or Sunday, or turn weekend working off.";
  }

  return errs;
}

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
  // Per-field messages, shown once a save has been attempted.
  const [fieldErrors, setFieldErrors] = useState({});
  const [submitted, setSubmitted] = useState(false);
  // Set on the first edit; drives the unsaved-changes guard on Back.
  const [dirty, setDirty] = useState(false);

  const set = (patch) => {
    setForm((f) => {
      const next = { ...f, ...patch };
      // Only re-validate after a failed save — flagging fields the user
      // hasn't reached yet reads as nagging.
      if (submitted) setFieldErrors(validateConfig(next));
      return next;
    });
    setDirty(true);
    if (msg) setMsg(null);
  };

  /* A policy edit is easy to lose: the form holds a dozen values and Back is
     right next to Save. Warn on both a browser-level exit and the in-page
     Back button rather than discarding the work silently. */
  useEffect(() => {
    if (!dirty) return undefined;
    const onBeforeUnload = (e) => { e.preventDefault(); e.returnValue = ""; };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [dirty]);

  const goBack = () => {
    if (dirty && !window.confirm("Discard your unsaved changes to this leave policy?")) return;
    navigate(-1);
  };

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
        const err = requestErrorMessage(e, "Couldn't load the leave policy.");
        if (active && err) setLoadError(err);
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => { active = false; };
  }, [projectId]);

  // A freshly loaded policy isn't an edit — clear the guard after prefill.
  useEffect(() => { setDirty(false); }, [projectId]);

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
    if (saving) return;                         // guards a double-click
    setMsg(null);
    setSubmitted(true);

    if (!projectId) {
      setMsg({ type: "error", text: "This project couldn't be identified." });
      return;
    }

    const errs = validateConfig(form);
    setFieldErrors(errs);
    const firstBad = Object.keys(errs)[0];
    if (firstBad) {
      document.getElementById(`lc-${firstBad}`)?.focus();
      setMsg({
        type: "error",
        text: Object.keys(errs).length === 1
          ? errs[firstBad]
          : `${Object.keys(errs).length} fields need attention before saving.`,
      });
      return;
    }

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
        /* The raw body used to be thrown verbatim, so an HTML error page or
           a JSON envelope was shown as-is. */
        throw new Error(await readErrorMessage(res, "Couldn't save the leave policy."));
      }
      /* The outcome of an action goes through the app's shared popup, the
         same one the rest of the project uses. The inline banner stays for
         validation, which belongs beside the fields it's about. */
      notifyActionSuccess("Leave policy saved", "Your changes have been saved.");
      setDirty(false);          // saved work is no longer at risk on Back
      setSubmitted(false);
      setFieldErrors({});
    } catch (e) {
      notifyActionError("Save failed", requestErrorMessage(e, "Couldn't save the leave policy."));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="uidai-pmis-content lc-page">
      <style>{LC_CSS}</style>

      <header className="lc-head">
        <div className="lc-eyebrow">{project?.projectName || fetchedName || "Project"}</div>
        <h1 className="uidai-pmis-title lc-title">Leave Policy</h1>
        <p className="uidai-pmis-subtitle lc-subtitle">
          How leave is earned, counted and carried for everyone on this project.
        </p>
      </header>

      {msg && (
        <div
          className={`lc-banner lc-banner--${msg.type}`}
          role={msg.type === "error" ? "alert" : "status"}
        >
          <span aria-hidden="true">{msg.type === "error" ? "⚠️" : "✓"}</span>
          {msg.text}
        </div>
      )}

      {loading ? (
        <div className="lc-muted">Loading leave policy…</div>
      ) : loadError ? (
        <div className="lc-banner lc-banner--error">⚠️ {loadError}</div>
      ) : (
        <>
          <section className="lc-section">
            <h2 className="lc-section-title">Hours &amp; entitlement</h2>
            <div className="uidai-pmis-card lc-card">
              <div className="lc-grid">
                {/* text + inputMode, not type="number": a number input reports
                    "" for an entry like "8e2" or "1..5", so the validator
                    never sees what was typed and the value is silently
                    blanked instead of explained. */}
                <Field
                  label="Half-day hours"
                  hint="Hours that count as half a day's attendance."
                  error={fieldErrors.halfDayHours}
                >
                  <input
                    id="lc-halfDayHours"
                    type="text"
                    inputMode="decimal"
                    className={`lc-input${fieldErrors.halfDayHours ? " is-bad" : ""}`}
                    aria-invalid={!!fieldErrors.halfDayHours}
                    value={form.halfDayHours}
                    onChange={(e) =>
                      set({ halfDayHours: e.target.value.replace(/[^\d.]/g, "").replace(/(\..*)\./g, "$1") })
                    }
                    placeholder="e.g. 4"
                  />
                </Field>

                <Field
                  label="Full-day hours"
                  hint="Hours that count as a full day's attendance."
                  error={fieldErrors.fullDayHours}
                >
                  <input
                    id="lc-fullDayHours"
                    type="text"
                    inputMode="decimal"
                    className={`lc-input${fieldErrors.fullDayHours ? " is-bad" : ""}`}
                    aria-invalid={!!fieldErrors.fullDayHours}
                    value={form.fullDayHours}
                    onChange={(e) =>
                      set({ fullDayHours: e.target.value.replace(/[^\d.]/g, "").replace(/(\..*)\./g, "$1") })
                    }
                    placeholder="e.g. 8"
                  />
                </Field>

                <Field
                  label="Leave frequency"
                  hint="How often the leave allowance is granted."
                  error={fieldErrors.leavesFrequency}
                >
                  <select
                    id="lc-leavesFrequency"
                    className={`lc-input${fieldErrors.leavesFrequency ? " is-bad" : ""}`}
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

                <Field
                  label="Days per period"
                  hint={
                    form.leavesFrequency
                      ? "Leave days granted each period."
                      : "Select a leave frequency first."
                  }
                  error={fieldErrors.leavesPerFrequencyCount}
                >
                  <input
                    id="lc-leavesPerFrequencyCount"
                    type="text"
                    inputMode="numeric"
                    className={`lc-input${fieldErrors.leavesPerFrequencyCount ? " is-bad" : ""}`}
                    aria-invalid={!!fieldErrors.leavesPerFrequencyCount}
                    value={form.leavesPerFrequencyCount}
                    onChange={(e) => set({ leavesPerFrequencyCount: e.target.value.replace(/[^\d]/g, "") })}
                    placeholder="e.g. 2"
                    disabled={!form.leavesFrequency}
                  />
                </Field>
              </div>
            </div>
          </section>

          <section className="lc-section">
            <h2 className="lc-section-title">Leave rules</h2>
            <div className="uidai-pmis-card lc-card lc-card--rules">
              <RuleRow
                label="Sandwich leave applied"
                hint="Weekends and holidays falling between two leave days are counted as leave."
                value={form.sandwichLeaveApplied}
                onChange={(v) => set({ sandwichLeaveApplied: v })}
              />
              <RuleRow
                label="Prorated leaves applied"
                hint="Leave is earned in proportion to time on the project rather than granted in full."
                value={form.proratedLeavesApplied}
                onChange={(v) => set({ proratedLeavesApplied: v })}
              />
              <RuleRow
                label="Carry forward allowed"
                hint="Unused leave rolls into the next period instead of lapsing."
                value={form.carryForwardAllowed}
                onChange={(v) => set({ carryForwardAllowed: v })}
              />
            </div>
          </section>

          <section className="lc-section">
            <h2 className="lc-section-title">Weekend working</h2>
            <div className="uidai-pmis-card lc-card lc-card--rules">
              <RuleRow
                label="Weekend is a working period"
                hint="Turn on to count Saturday and Sunday towards attendance."
                value={form.weekendWorking}
                onChange={(v) => set({ weekendWorking: v })}
              />

              {weekendOn && (
                <div className="lc-grid lc-grid--nested">
                  <Field label="Saturday" error={fieldErrors.saturday}>
                    <select
                      id="lc-saturday"
                      className={`lc-input${fieldErrors.saturday ? " is-bad" : ""}`}
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
                      id="lc-sunday"
                      className={`lc-input${fieldErrors.saturday ? " is-bad" : ""}`}
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
          </section>

          <div className="lc-actions">
            <button className="lc-btn lc-btn--ghost" onClick={goBack} disabled={saving}>
              Back
            </button>
            <button className="lc-btn lc-btn--primary" onClick={submit} disabled={saving}>
              {saving ? "Saving…" : "Save policy"}
            </button>
          </div>
        </>
      )}
    </div>
  );
}

/* ---------- building blocks ---------- */

function Field({ label, hint, children, error }) {
  return (
    <label className="lc-field">
      <span className="lc-field-label">{label}</span>
      {children}
      {/* The error replaces the hint rather than stacking under it — two
          lines of guidance where one is a complaint reads as noise. */}
      {error
        ? <span className="lc-field-err">{error}</span>
        : hint && <span className="lc-field-hint">{hint}</span>}
    </label>
  );
}

/* One yes/no rule: what it means on the left, the answer on the right.
   Every rule on this page now uses the same control — the page previously
   mixed toggle switches, segmented buttons and radio pills for the same
   question, which read as three different kinds of setting. */
function RuleRow({ label, hint, value, onChange }) {
  return (
    <div className="lc-rule">
      <div className="lc-rule-text">
        <div className="lc-rule-label">{label}</div>
        {hint && <div className="lc-rule-hint">{hint}</div>}
      </div>
      <YesNo value={value} onChange={onChange} label={label} />
    </div>
  );
}

/* Three-state by design: an unanswered rule highlights neither button.
   A switch would have to render "not set" as Off, which is a different
   thing — the API stores null, false and true separately. */
function YesNo({ value, onChange, label }) {
  return (
    <div className="lc-yesno" role="group" aria-label={label}>
      {[{ v: "yes", l: "Yes" }, { v: "no", l: "No" }].map((o) => {
        const on = value === o.v;
        return (
          <button
            key={o.v}
            type="button"
            aria-pressed={on}
            className={`lc-yesno-btn${on ? " is-on" : ""}`}
            onClick={() => onChange(o.v)}
          >
            {o.l}
          </button>
        );
      })}
    </div>
  );
}

/* ---------- scoped styles ---------- */
const LC_CSS = `
.lc-page { width: 100%; min-width: 0; padding: 0 0 56px;
  color: ${C.ink}; box-sizing: border-box; }
.lc-page * { box-sizing: border-box; }
.lc-page :focus-visible { outline: 2px solid ${C.primary}; outline-offset: 2px; border-radius: 6px; }

/* header — eyebrow / title / subtitle, as on Attendance and Leave Detail */
.lc-head { margin-bottom: 26px; padding-bottom: 18px; border-bottom: 1px solid ${C.border}; }
.lc-eyebrow { font-size: 11px; font-weight: 700; letter-spacing: .1em; text-transform: uppercase;
  color: ${C.muted}; margin-bottom: 7px; }
.lc-title { margin: 0 0 5px; letter-spacing: -.022em; }
.lc-subtitle { margin: 0; color: ${C.muted}; max-width: 620px; font-size: 13.5px; }

/* sections — a quiet label with a rule running off it, so the eye goes to
   the controls rather than to the headings. */
.lc-section { margin-bottom: 26px; }
.lc-section-title { display: flex; align-items: center; gap: 8px; font-size: 11.5px;
  font-weight: 700; letter-spacing: .09em; text-transform: uppercase; color: ${C.muted};
  margin: 0 0 12px; }
.lc-section-title::after { content: ""; flex: 1; height: 1px; background: ${C.border}; }

/* card — pairs with .uidai-pmis-card for the house navy→cyan top stripe.
   The house shadow is traded for a hairline: stacked, the drop shadows
   read heavy. */
.lc-card { padding: 18px 20px; margin-bottom: 0; border: 1px solid ${C.border};
  box-shadow: 0 1px 2px rgba(16,32,60,.04); }
.lc-card--rules { padding: 4px 20px; }

/* Four across, which is exactly the field count — at full width a 2-up grid
   stretched each input to ~700px for a two-character number. Every step down
   halves cleanly, so no row is ever left with an orphan. */
.lc-grid { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 18px 22px; }
.lc-grid--nested { margin-top: 4px; padding: 14px 0 16px; border-top: 1px solid ${C.divider}; }
@media (max-width: 1100px) { .lc-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
@media (max-width: 560px) { .lc-grid { grid-template-columns: 1fr; } }

.lc-field { display: flex; flex-direction: column; gap: 6px; min-width: 0; }
.lc-field-label { font-size: 10.5px; font-weight: 700; letter-spacing: .06em;
  text-transform: uppercase; color: ${C.muted}; }
.lc-field-hint { font-size: 11.5px; color: ${C.faint}; line-height: 1.45; }
/* Sits where the hint would, so a field doesn't change height when it fails. */
.lc-field-err { font-size: 11.5px; color: ${C.red}; line-height: 1.45; font-weight: 600; }
/* Invalid control — a red edge alongside the message, so the error is
   findable by colour and readable without relying on it. */
.lc-input.is-bad { border-color: ${C.red}; }
.lc-input.is-bad:focus { border-color: ${C.red}; box-shadow: 0 0 0 3px rgba(214,69,69,.14); }

.lc-input { width: 100%; padding: 9px 12px; border-radius: 10px; border: 1px solid ${C.border};
  background: #fff; color: ${C.ink}; font-size: 14px; font-family: inherit; outline: none;
  transition: border-color .15s ease, box-shadow .15s ease; }
select.lc-input { cursor: pointer; }
.lc-input:focus { border-color: ${C.primary}; box-shadow: 0 0 0 3px ${C.accentBg}; }
.lc-input::placeholder { color: ${C.faint}; }
.lc-input:disabled { background: ${C.surface}; color: ${C.faint}; cursor: not-allowed; }

/* rules — a list of statements, each with its answer on the right */
.lc-rule { display: flex; align-items: center; gap: 20px; padding: 15px 0; }
.lc-rule + .lc-rule { border-top: 1px solid ${C.divider}; }
/* Capped measure — full-bleed, an unbounded hint runs to a line length
   that's genuinely hard to track back from. */
.lc-rule-text { min-width: 0; flex: 1; max-width: 680px; }
.lc-rule-label { font-size: 14px; font-weight: 600; color: ${C.ink}; }
.lc-rule-hint { font-size: 12px; color: ${C.muted}; margin-top: 3px; line-height: 1.5; }
@media (max-width: 560px) {
  .lc-rule { flex-direction: column; align-items: stretch; gap: 10px; }
}

.lc-yesno { display: flex; flex: 0 0 auto; border: 1px solid ${C.border}; border-radius: 10px;
  overflow: hidden; background: #fff; }
.lc-yesno-btn { min-width: 62px; padding: 8px 16px; border: 0; background: transparent;
  color: ${C.muted}; font: inherit; font-size: 13px; font-weight: 600; cursor: pointer;
  transition: background .15s ease, color .15s ease; }
.lc-yesno-btn + .lc-yesno-btn { border-left: 1px solid ${C.border}; }
.lc-yesno-btn:hover:not(.is-on) { background: ${C.surface}; color: ${C.ink}; }
.lc-yesno-btn.is-on { background: ${C.primary}; color: #fff; }
@media (max-width: 560px) { .lc-yesno-btn { flex: 1; } }

/* actions */
.lc-actions { display: flex; justify-content: flex-end; gap: 10px; }
.lc-btn { display: inline-flex; align-items: center; justify-content: center; border-radius: 10px;
  font: inherit; font-size: 14px; font-weight: 600; padding: 10px 22px; cursor: pointer;
  border: 1px solid ${C.border}; transition: all .15s ease; }
.lc-btn:disabled { opacity: .55; cursor: not-allowed; }
.lc-btn--ghost { background: #fff; color: ${C.ink}; }
.lc-btn--ghost:hover:not(:disabled) { border-color: ${C.primary}; color: ${C.primary}; }
.lc-btn--primary { border-color: ${C.primary}; background: ${C.primary}; color: #fff; }
.lc-btn--primary:hover:not(:disabled) { background: ${C.primaryDark}; border-color: ${C.primaryDark}; }

.lc-banner { display: flex; align-items: center; gap: 9px; border-radius: 10px; padding: 11px 14px;
  font-size: 13.5px; margin-bottom: 18px; }
.lc-banner--ok { background: #e7f6ee; border: 1px solid #c7ead6; color: ${C.green}; }
.lc-banner--error { background: #fdecec; border: 1px solid #f5c9c9; color: ${C.red}; }
.lc-muted { color: ${C.muted}; font-size: 14px; padding: 6px 0; }
`;
