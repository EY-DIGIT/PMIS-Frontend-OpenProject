// ============================================================
// LeaveDetailPage.jsx — full-page quarterly leave detail for one
// employee. Opened by clicking a row in the Attendance page's
// monthly / quarterly tables (no longer a modal).
//
//   GET /api/reports/leave/{attendanceId}?year=&quarter=&projectId=
//   GET /api/attendance/cost/quarterly?resourceId=&year=&quarter=
//
// When the employee has unpaid leave, a "Relaxation" action opens a
// small form that POSTs to /api/attendance/quarterly-relaxation.
// ============================================================
import { useEffect, useState } from "react";
import { useParams, useSearchParams, useNavigate } from "react-router-dom";
import {
  FiX, FiUser, FiBriefcase, FiHash, FiFileText, FiCalendar,
  FiPlay, FiFlag, FiShield, FiChevronsRight, FiCreditCard,
  FiUmbrella, FiLayers, FiPieChart, FiClock, FiDollarSign, FiInfo,
} from "react-icons/fi";
import { useProject } from "../../store/project/projectsStore";
import { setPageContext, clearPageContext } from "../../utils/pageContext";
import { getToken } from "../../api/auth";
import { ENDPOINTS } from "../../api/endpoint";
import "../../styles/global.css";

const API_BASE = "http://10.1.131.199:8019";

const C = {
  primary: "#0b3c88",
  ink: "#16202e",
  muted: "#64748b",
  faint: "#94a3b8",
  border: "#e3e9f2",
  surface: "#f6f9fc",
  green: "#0f9d58",
  red: "#d64545",
  accentBg: "#eef2ff",
};

// Tinted background + icon colour per card tone.
const TONES = {
  blue: { bg: "#eef4ff", fg: "#2563eb" },
  purple: { bg: "#f1edfe", fg: "#7c3aed" },
  orange: { bg: "#fff1e6", fg: "#ea580c" },
  green: { bg: "#e9f9ef", fg: "#16a34a" },
  red: { bg: "#fdecec", fg: "#dc2626" },
  amber: { bg: "#fff6e0", fg: "#d97706" },
  teal: { bg: "#e6f7f6", fg: "#0d9488" },
};

// Leave-summary cards — key maps to the report payload, label is the display
// text, tone/icon drive the styling. Order matches the reference design.
const SUMMARY_CARDS = [
  { key: "quarter", label: "Quarter", tone: "blue", icon: <FiCalendar /> },
  { key: "quarterStart", label: "Start Date", tone: "purple", icon: <FiPlay /> },
  { key: "quarterEnd", label: "End Date", tone: "orange", icon: <FiFlag /> },
  { key: "permissibleLeave", label: "Permissible Leave", tone: "green", icon: <FiShield /> },
  // { key: "carriedForwardLeave", label: "Carried Forward Leave", tone: "blue", icon: <FiChevronsRight /> },
  { key: "leaveTaken", label: "Leave Taken", tone: "blue", icon: <FiBriefcase /> },
  { key: "paidLeave", label: "Paid Leave", tone: "green", icon: <FiCreditCard /> },
  { key: "unpaidLeave", label: "Unpaid Leave", tone: "red", icon: <FiFileText /> },
  { key: "relaxationLeave", label: "Relaxation Leave", tone: "purple", icon: <FiUmbrella /> },
  { key: "sandwichDays", label: "Sandwich Days", tone: "amber", icon: <FiLayers /> },
  { key: "totalUnpaidDays", label: "Total Unpaid Days", tone: "red", icon: <FiPieChart /> },
  { key: "lapsedLeave", label: "Lapsed Leave", tone: "teal", icon: <FiClock /> },
];

// Plain-language explanations for each figure. These names are easy to mix up
// (an allowance vs. what was used vs. what's left over), so every card carries
// its meaning rather than leaving the reader to infer it.
const HINTS = {
  quarter: "The quarter this report covers.",
  quarterStart: "First day of the quarter.",
  quarterEnd: "Last day of the quarter.",
  permissibleLeave: "Paid leave allowed for this quarter. Leave within this limit costs the employee nothing.",
  leaveTaken: "Total days of leave taken in the quarter, before any of it is classified as paid or unpaid.",
  paidLeave: "Days covered by the permissible allowance. No salary is deducted for these.",
  unpaidLeave: "Days left over after the paid allowance and any relaxation are applied. Salary is deducted for these.",
  relaxationLeave: "Extra days granted as an exception, on top of the paid allowance. Each quarter has a fixed limit.",
  sandwichDays: "Weekends or holidays falling between leave days, counted as leave.",
  totalUnpaidDays: "Every day being deducted this quarter — unpaid leave plus sandwich days.",
  lapsedLeave: "Allowance that went unused and has expired. It does not carry into the next quarter.",
};

const SECTION_HINT =
  "Leave taken is settled in order: first against the paid allowance, then against any relaxation granted. Whatever remains is unpaid and gets deducted.";

const show = (v) => (v === null || v === undefined || v === "" ? "—" : String(v));
const num = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

// Turns "billableCostUsd" -> "Billable Cost Usd" for fields we don't
// have an explicit label for.
const formatLabel = (key) =>
  key
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/^./, (c) => c.toUpperCase());

const money = (v) =>
  `₹${num(v).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const pct = (v) => `${num(v).toLocaleString("en-IN", { maximumFractionDigits: 2 })}%`;

export default function LeaveDetailPage() {
  const { projectId, attendanceId } = useParams();
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const project = useProject(projectId);

  const year = params.get("year") || "";
  const quarter = params.get("quarter") || "";

  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [relaxOpen, setRelaxOpen] = useState(false);
  // Bumped after a successful relaxation submit to re-fetch the leave detail.
  const [refreshKey, setRefreshKey] = useState(0);

  // Quarterly cost report — shown at the bottom of the page.
  const [costReport, setCostReport] = useState(null);
  const [costLoading, setCostLoading] = useState(false);
  const [costError, setCostError] = useState(null);

  useEffect(() => {
    setPageContext({ projectName: project?.projectName || "" });
    return () => clearPageContext();
  }, [project?.projectName]);

  useEffect(() => {
    if (!attendanceId) return;
    let active = true;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const token = getToken();
        const qs = new URLSearchParams({ year, quarter, projectId });
        const res = await fetch(
          `${API_BASE}${ENDPOINTS.resources.leaveReport(attendanceId)}?${qs}`,
          { headers: { accept: "*/*", ...(token ? { Authorization: `Bearer ${token}` } : {}) } }
        );
        if (!res.ok) throw new Error(`Couldn't load leave detail (${res.status})`);
        const json = await res.json();
        const payload = json && json.data && typeof json.data === "object" ? json.data : json;
        if (active) setData(payload || {});
      } catch (e) {
        if (active) setError(e?.message || "Couldn't load leave detail");
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => { active = false; };
  }, [attendanceId, year, quarter, projectId, refreshKey]);

  const d = data || {};
  const resourceId = d.resourceId || d.attendanceId || attendanceId;

  // Fetch the quarterly cost report once we know the resourceId (comes back
  // from the leave-detail payload) and have a year/quarter to query with.
  useEffect(() => {
    if (!resourceId || !year || !quarter) return;
    let active = true;
    (async () => {
      setCostLoading(true);
      setCostError(null);
      try {
        const token = getToken();
        const qs = new URLSearchParams({ resourceId, year, quarter });
        const res = await fetch(`${API_BASE}/api/attendance/cost/quarterly?${qs}`, {
          headers: { accept: "*/*", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        });
        if (!res.ok) throw new Error(`Couldn't load quarterly cost report (${res.status})`);
        const json = await res.json();
        let payload = json && json.data && typeof json.data === "object" ? json.data : json;
        // Some endpoints wrap the single report object in an array — unwrap it.
        if (Array.isArray(payload)) payload = payload[0] || {};
        if (active) setCostReport(payload || {});
      } catch (e) {
        if (active) setCostError(e?.message || "Couldn't load quarterly cost report");
      } finally {
        if (active) setCostLoading(false);
      }
    })();
    return () => { active = false; };
  }, [resourceId, year, quarter, refreshKey]);

  const employeeName = d.employeeName || attendanceId || "Employee";
  const unpaidLeave = num(d.unpaidLeave);
  const paidDates = Array.isArray(d.paidLeaveDates) ? d.paidLeaveDates : [];
  const unpaidDates = Array.isArray(d.unpaidLeaveDates) ? d.unpaidLeaveDates : [];

  // Relaxation is capped per quarter. The cost report carries that cap as
  // relaxationDaysApplied, stamped on the month it was computed for and 0 on
  // the rest — so the quarter's cap is the highest value across the months,
  // not their sum. d.relaxationLeave is how many of those days are used.
  const relaxCap = Math.max(
    0,
    ...(costReport?.monthlyBreakdown || []).map((m) => num(m.relaxationDaysApplied))
  );
  const relaxUsed = num(d.relaxationLeave);
  const relaxLeft = relaxCap - relaxUsed;

  const leaveTaken = num(d.leaveTaken);
  const paidLeave = num(d.paidLeave);
  // Only claim the quarter "adds up" when it genuinely does — otherwise the
  // strip is hidden rather than showing an equation that doesn't balance.
  const breakdownBalances =
    leaveTaken > 0 && paidLeave + relaxUsed + unpaidLeave === leaveTaken;
  // While the cost report is still loading (or failed), fall back to the
  // unpaid balance so the action doesn't disappear on a slow request.
  const canRelax = relaxCap > 0 ? relaxLeft > 0 : unpaidLeave > 0;

  return (
    <div className="uidai-pmis-content ld-page">
      <style>{LD_CSS}</style>

      <div className="ld-card">
        {/* Header */}
        <div className="ld-head">
          <div className="ld-head-main">
            <h1 className="ld-title">{loading ? "Loading…" : employeeName}</h1>
            <div className="ld-chips">
              <div className="ld-chip ld-chip--blue">
                <div className="ld-chip-val">{show(d.attendanceId || attendanceId)}</div>
                <div className="ld-chip-lbl">Attendance ID</div>
              </div>
              <div className="ld-chip ld-chip--green">
                <div className="ld-chip-val">Q{show(d.quarter || quarter)} {show(d.year || year)}</div>
                <div className="ld-chip-lbl">Quarter</div>
              </div>
            </div>
          </div>
          <div className="ld-head-actions">
            {canRelax && !loading && !error && (
              <button className="ld-btn ld-btn--primary" onClick={() => setRelaxOpen(true)}>
                Relaxation{relaxCap > 0 ? ` (${relaxLeft} left)` : ""}
              </button>
            )}
            <button className="ld-close" onClick={() => navigate(-1)} aria-label="Close">
              <FiX size={20} />
            </button>
          </div>
        </div>

        {loading && <div className="ld-muted">Loading leave detail…</div>}
        {error && <div className="ld-error">⚠️ {error}</div>}

        {!loading && !error && (
          <>
            {/* Employee info */}
            <div className="ld-info">
              <InfoItem tone="blue" icon={<FiUser />} label="Employee Name" value={show(d.employeeName)} />
              <InfoItem tone="purple" icon={<FiHash />} label="Attendance ID" value={show(d.attendanceId || attendanceId)} />
              <InfoItem tone="blue" icon={<FiBriefcase />} label="Project Name" value={show(d.projectName || project?.projectName)} />
              <InfoItem tone="green" icon={<FiCalendar />} label="Joining Date" value={show(d.joiningDate)} />
              <InfoItem tone="amber" icon={<FiCalendar />} label="Year" value={show(d.year || year)} />
            </div>

            {/* Leave summary */}
            <div className="ld-section-head">
              <span className="ld-section-ico"><FiCalendar /></span> Leave Summary
              <Hint text={SECTION_HINT} />
            </div>

            {/* How the quarter settles, in one line. Only rendered when the
                parts actually add up, so a mismatched payload never shows a
                broken-looking equation. */}
            {breakdownBalances && (
              <div className="ld-breakdown">
                <span className="ld-breakdown-lbl">How this quarter adds up</span>
                <span className="ld-breakdown-eq">
                  <b>{leaveTaken}</b> taken
                  <span className="ld-breakdown-op">=</span>
                  <span className="ld-breakdown-part ld-breakdown-part--paid">{paidLeave} paid</span>
                  <span className="ld-breakdown-op">+</span>
                  <span className="ld-breakdown-part ld-breakdown-part--relax">{relaxUsed} relaxation</span>
                  <span className="ld-breakdown-op">+</span>
                  <span className="ld-breakdown-part ld-breakdown-part--unpaid">{unpaidLeave} unpaid</span>
                </span>
              </div>
            )}

            <div className="ld-grid">
              {SUMMARY_CARDS.map((c) => (
                <StatCard
                  key={c.key}
                  tone={c.tone}
                  icon={c.icon}
                  label={c.label}
                  value={show(d[c.key])}
                  hint={HINTS[c.key]}
                  sub={
                    c.key === "relaxationLeave" && relaxCap > 0
                      ? `${relaxUsed} of ${relaxCap} used · ${relaxLeft} left`
                      : null
                  }
                />
              ))}
            </div>

            {/* Leave dates */}
            <div className="ld-dates">
              <DateList
                tone="green"
                title="Paid Leave Dates"
                dates={paidDates}
                hint="Leave days covered by the paid allowance — no deduction for these."
              />
              <DateList
                tone="red"
                title="Unpaid Leave Dates"
                dates={unpaidDates}
                hint="Leave days that fell outside the paid allowance. Any relaxation granted is applied against these."
                note={
                  unpaidDates.length > 0 && unpaidLeave === 0
                    ? relaxUsed > 0
                      ? `Covered by ${relaxUsed} relaxation ${relaxUsed === 1 ? "day" : "days"} — nothing deducted.`
                      : "No unpaid balance remaining — nothing deducted."
                    : null
                }
              />
            </div>

            {/* Quarterly cost report */}
            <div className="ld-section-head" style={{ marginTop: 22 }}>
              <span className="ld-section-ico"><FiDollarSign /></span> Quarterly Cost Report
            </div>
            <CostReportSection loading={costLoading} error={costError} report={costReport} />
          </>
        )}
      </div>

      {relaxOpen && (
        <RelaxationModal
          resourceId={resourceId}
          projectId={d.projectId || projectId}
          year={d.year || year}
          quarter={d.quarter || quarter}
          maxDays={relaxCap > 0 ? relaxLeft : null}
          onSuccess={() => setRefreshKey((k) => k + 1)}
          onClose={() => setRelaxOpen(false)}
        />
      )}
    </div>
  );
}

/* ---------- building blocks ---------- */

// Hover/focus tooltip. Keyboard reachable via tabIndex, and the text is also
// exposed as title/aria-label so it survives touch and screen readers.
function Hint({ text }) {
  if (!text) return null;
  return (
    <span className="ld-hint" tabIndex={0} role="note" aria-label={text} title={text}>
      <FiInfo />
      <span className="ld-hint-bub">{text}</span>
    </span>
  );
}

function InfoItem({ tone, icon, label, value }) {
  const t = TONES[tone] || TONES.blue;
  return (
    <div className="ld-info-item">
      <span className="ld-info-ico" style={{ background: t.bg, color: t.fg }}>{icon}</span>
      <div className="ld-info-text">
        <div className="ld-info-lbl">{label}</div>
        <div className="ld-info-val">{value}</div>
      </div>
    </div>
  );
}

function StatCard({ tone, icon, label, value, hint, sub }) {
  const t = TONES[tone] || TONES.blue;
  return (
    <div className="ld-stat" style={{ background: t.bg + "80" }}>
      <span className="ld-stat-ico" style={{ background: t.bg, color: t.fg }}>{icon}</span>
      <div className="ld-stat-text">
        <div className="ld-stat-lbl">
          {label}
          <Hint text={hint} />
        </div>
        <div className="ld-stat-val">{value}</div>
        {sub && <div className="ld-stat-sub">{sub}</div>}
      </div>
    </div>
  );
}

function DateList({ tone, title, dates, hint, note }) {
  const t = TONES[tone] || TONES.green;
  return (
    <div className="ld-datecol">
      <div className="ld-datehead" style={{ color: t.fg }}>
        <FiCalendar /> {title.toUpperCase()} ({dates.length})
        <Hint text={hint} />
      </div>
      {note && <div className="ld-datenote">{note}</div>}
      {dates.length ? (
        <div className="ld-datechips">
          {dates.map((dt, i) => (
            <span key={i} className="ld-datechip" style={{ background: t.bg, color: t.fg }}>{dt}</span>
          ))}
        </div>
      ) : (
        <div className="ld-muted" style={{ padding: "4px 0" }}>None</div>
      )}
    </div>
  );
}

/* =====================================================================
   Quarterly Cost Report
   GET /api/attendance/cost/quarterly?resourceId=&year=&quarter=
   Shape: { attendanceId, employeeName, projectId, period, totalCost,
            monthlyBreakdown: [{ period, workingDays, presentDays,
              relaxationDaysApplied, attendancePercentage, monthlyRate,
              cost, rateYear, ... }] }
   Falls back to a generic key/value + JSON dump for any extra top-level
   fields the API adds later, so nothing is silently dropped.
   ===================================================================== */
const COST_KNOWN_KEYS = new Set([
  "attendanceId", "employeeName", "projectId", "period", "totalCost", "monthlyBreakdown",
]);

function CostReportSection({ loading, error, report }) {
  if (loading) return <div className="ld-muted">Loading cost report…</div>;
  if (error) return <div className="ld-error">⚠️ {error}</div>;
  if (!report || typeof report !== "object" || Object.keys(report).length === 0) {
    return <div className="ld-muted">No cost data available.</div>;
  }

  const months = Array.isArray(report.monthlyBreakdown) ? report.monthlyBreakdown : [];
  const extraEntries = Object.entries(report).filter(([k]) => !COST_KNOWN_KEYS.has(k));

  return (
    <>
      {/* Summary cards */}
      <div className="ld-grid" style={{ marginBottom: 18 }}>
        <StatCard tone="blue" icon={<FiCalendar />} label="Period" value={show(report.period)}
          hint="The quarter this cost report covers." />
        <StatCard tone="green" icon={<FiDollarSign />} label="Total Cost" value={money(report.totalCost)}
          hint="Billable cost for the quarter — the sum of each month's cost after deductions." />
        <StatCard tone="purple" icon={<FiLayers />} label="Months Covered" value={show(months.length)}
          hint="How many months of the quarter are included in the breakdown below." />
      </div>

      {/* Monthly breakdown table */}
      {months.length > 0 && (
        <div className="ld-costtable-wrap">
          <table className="ld-costtable">
            <thead>
              <tr>
                <th title="Calendar month this row covers.">Period</th>
                <th title="Which year of the resource's rate card was used for this month.">Rate Year</th>
                <th className="ld-num" title="Total working days in the month, excluding weekends and holidays.">Working Days</th>
                <th className="ld-num" title="Days the employee was present. Half days count as 0.5.">Present Days</th>
                <th className="ld-num" title="Relaxation days allowed for the quarter.">Relaxation Allowed</th>
                <th className="ld-num" title="Present days as a percentage of working days.">Attendance %</th>
                <th className="ld-num" title="Full monthly rate from the rate card, before any deduction.">Monthly Rate</th>
                <th className="ld-num" title="Monthly rate divided by the working days in the month.">Per Day Rate</th>
                {/* <th className="ld-num">HalfDay Amount</th> */}
                <th className="ld-num" title="Amount withheld for absent and unpaid days.">Deducted Amount</th>
                <th className="ld-num" title="Monthly rate minus the deducted amount — what is billable for the month.">Cost</th>
              </tr>
            </thead>
            <tbody>
              {months.map((m, i) => (
                <tr key={i}>
                  <td className="ld-costtable-period">{show(m.period)}</td>
                  <td>{show(m.rateYear)}</td>
                  <td className="ld-num">{show(m.workingDays)}</td>
                  <td className="ld-num">{show(m.presentDays)}</td>
                  <td className="ld-num">{show(m.relaxationDaysApplied)}</td>
                  <td className="ld-num">
                    <span
                      className="ld-attpill"
                      style={{
                        background: num(m.attendancePercentage) === 0 ? TONES.red.bg : TONES.green.bg,
                        color: num(m.attendancePercentage) === 0 ? TONES.red.fg : TONES.green.fg,
                      }}
                    >
                      {pct(m.attendancePercentage)}
                    </span>
                  </td>
                  <td className="ld-num">{money(m.monthlyRate)}</td>

                  <td className="ld-num">{money(m.perDayRate)}</td>
                  {/* <td className="ld-num ld-costtable-cost">{money(m.halfDayAmount)}</td> */}
                  <td className="ld-num ld-costtable-cost">{money(m.deductedAmount)}</td>
                                    <td className="ld-num">{money(m.cost)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <td colSpan={9} className="ld-costtable-totallbl">Total Cost</td>
                <td className="ld-num ld-costtable-cost">{money(report.totalCost)}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}

      {extraEntries.length > 0 && (
        <div className="ld-grid">
          {extraEntries
            .filter(([, v]) => v === null || typeof v !== "object")
            .map(([key, value]) => (
              <StatCard key={key} tone="amber" icon={<FiFileText />} label={formatLabel(key)} value={show(value)} />
            ))}
        </div>
      )}
    </>
  );
}

/* =====================================================================
   Quarterly Relaxation — grants relaxation days against unpaid leave.
   POST /api/attendance/quarterly-relaxation
   ===================================================================== */

// A backend string is only worth showing if it reads like a sentence. JSON
// dumps, stack traces and Java exception names get swapped for a plain line.
function isReadableMessage(value) {
  const text = String(value ?? "").trim();
  if (!text || text.length > 300) return false;
  if (/^[[{]/.test(text)) return false;              // a serialised body
  if (/\sat\s[\w.$]+\(/.test(text)) return false;    // a stack trace
  if (/\b\w+(\.\w+)+(Exception|Error)\b/.test(text)) return false;
  return true;
}

// Error bodies from this API vary: {message}, {error}, {errors:[…]} holding
// either strings or objects, or plain text. Reduce all of that to one line.
async function readErrorMessage(res) {
  const fallback = `Couldn't submit the relaxation (${res.status}). Please try again.`;

  let raw = "";
  try {
    raw = await res.text();
  } catch {
    return fallback;
  }
  if (!raw.trim()) return fallback;

  let data;
  try {
    data = JSON.parse(raw);
  } catch {
    return isReadableMessage(raw) ? raw.trim() : fallback;   // plain-text body
  }

  if (typeof data === "string") {
    return isReadableMessage(data) ? data.trim() : fallback;
  }

  const fromList = Array.isArray(data?.errors)
    ? data.errors
        .map((e) => (typeof e === "string" ? e : e?.message || e?.defaultMessage || ""))
        .filter(Boolean)
        .join(", ")
    : "";

  const candidate = [data?.message, data?.error, data?.detail, fromList].find(
    (v) => typeof v === "string" && v.trim()
  );

  return candidate && isReadableMessage(candidate) ? candidate.trim() : fallback;
}

function RelaxationModal({ resourceId, projectId, year, quarter, maxDays, onSuccess, onClose }) {
  const [form, setForm] = useState({
    resourceId: resourceId || "",
    projectId: projectId || "",
    year: year || "",
    quarter: Number(quarter) || 1,
    relaxationDays: "",
    remarks: "",
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const [done, setDone] = useState(false);

  useEffect(() => {
    const onKey = (e) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const set = (patch) => setForm((f) => ({ ...f, ...patch }));

  const submit = async () => {
    setError(null);
    if (!form.resourceId) { setError("Resource ID is missing."); return; }
    if (!form.projectId) { setError("Project ID is missing."); return; }
    const days = Number(form.relaxationDays);
    if (!Number.isFinite(days) || days <= 0) { setError("Enter relaxation days greater than 0."); return; }
    if (maxDays != null && days > maxDays) {
      setError(`Only ${maxDays} relaxation ${maxDays === 1 ? "day is" : "days are"} left this quarter.`);
      return;
    }
    try {
      setSaving(true);
      const token = getToken();
      const res = await fetch(`${API_BASE}/api/attendance/quarterly-relaxation`, {
        method: "POST",
        headers: {
          accept: "*/*",
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({
          resourceId: String(form.resourceId),
          projectId: String(form.projectId),
          year: Number(form.year),
          quarter: Number(form.quarter),
          relaxationDays: days,
          remarks: form.remarks || "",
        }),
      });
      if (!res.ok) throw new Error(await readErrorMessage(res));
      setDone(true);
      onSuccess?.(); // refresh the parent's leave detail (and cost report) with the new figures
    } catch (err) {
      setError(err?.message || "Couldn't submit the relaxation. Try again.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="ld-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="ld-modal" role="dialog" aria-modal="true" aria-label="Quarterly Relaxation">
        <div className="ld-modal-head">
          <div>
            <div className="ld-eyebrow" style={{ marginBottom: 4 }}>Quarterly Relaxation</div>
            <h2 className="ld-modal-title">Add relaxation days</h2>
          </div>
          <button className="ld-close" onClick={onClose} aria-label="Close"><FiX size={18} /></button>
        </div>

        {done ? (
          <>
            <div className="ld-success">✓ Relaxation submitted successfully.</div>
            <div className="ld-modal-actions">
              <button className="ld-btn ld-btn--primary" onClick={onClose}>Done</button>
            </div>
          </>
        ) : (
          <>
            <div className="ld-form">
              <label className="ld-field">
                <span className="ld-field-lbl">Resource ID</span>
                <input className="ld-input" value={form.resourceId} disabled />
              </label>
              <label className="ld-field">
                <span className="ld-field-lbl">Year</span>
                <input type="number" className="ld-input" value={form.year} onChange={(e) => set({ year: e.target.value })} />
              </label>
              <label className="ld-field">
                <span className="ld-field-lbl">Quarter</span>
                <select className="ld-input" value={form.quarter} onChange={(e) => set({ quarter: Number(e.target.value) })}>
                  {[1, 2, 3, 4].map((q) => <option key={q} value={q}>Q{q}</option>)}
                </select>
              </label>
              <label className="ld-field">
                <span className="ld-field-lbl">
                  Relaxation Days{maxDays != null ? ` (${maxDays} left)` : ""}
                  <Hint text="Extra days waived on top of the paid allowance, up to the quarter's limit. Each day granted removes one unpaid day." />
                </span>
                <input type="number" min="0" step="1" max={maxDays ?? undefined} className="ld-input"
                  value={form.relaxationDays}
                  onChange={(e) => set({ relaxationDays: e.target.value })} placeholder="e.g. 2" />
              </label>
              <label className="ld-field ld-field--full">
                <span className="ld-field-lbl">Remarks</span>
                <textarea className="ld-input" rows={3} value={form.remarks}
                  onChange={(e) => set({ remarks: e.target.value })} placeholder="Reason for the relaxation…"
                  style={{ resize: "vertical", fontFamily: "inherit" }} />
              </label>
            </div>

            {error && <div className="ld-error">{error}</div>}

            <div className="ld-modal-actions">
              <button className="ld-btn ld-btn--ghost" onClick={onClose} disabled={saving}>Cancel</button>
              <button className="ld-btn ld-btn--primary" onClick={submit} disabled={saving}>
                {saving ? "Submitting…" : "Submit"}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

/* ---------- scoped styles ---------- */
const LD_CSS = `
.ld-page { max-width: 1200px; width: 100%; min-width: 0; margin: 0 auto; box-sizing: border-box; }
.ld-page * { box-sizing: border-box; }
@media (max-width: 640px) { .ld-page { padding: 12px 12px 24px; } }

.ld-card { background: #fbfcfe; border: 1px solid ${C.border}; border-radius: 16px; padding: 22px 24px; box-shadow: 0 1px 2px rgba(11,23,42,.04); }

/* header */
.ld-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 16px; margin-bottom: 20px; flex-wrap: wrap; }
.ld-eyebrow { font-size: 12px; font-weight: 800; letter-spacing: .12em; text-transform: uppercase; color: ${C.primary}; margin-bottom: 4px; }
.ld-title { font-size: 32px; font-weight: 800; letter-spacing: -.02em; color: ${C.ink}; margin: 0 0 12px; }
.ld-chips { display: flex; gap: 12px; flex-wrap: wrap; }
.ld-chip { border-radius: 10px; padding: 8px 16px; }
.ld-chip--blue { background: #eef4ff; }
.ld-chip--green { background: #e9f9ef; }
.ld-chip-val { font-size: 16px; font-weight: 800; }
.ld-chip--blue .ld-chip-val { color: #2563eb; }
.ld-chip--green .ld-chip-val { color: #16a34a; }
.ld-chip-lbl { font-size: 10.5px; font-weight: 700; letter-spacing: .06em; text-transform: uppercase; color: ${C.faint}; }
.ld-head-actions { display: flex; align-items: center; gap: 10px; }
.ld-close { display: grid; place-items: center; width: 40px; height: 40px; border-radius: 10px; border: 1px solid ${C.border}; background: #eef1f5; color: ${C.muted}; cursor: pointer; transition: all .15s ease; }
.ld-close:hover { background: #e2e6ec; color: ${C.ink}; }

/* employee info */
.ld-info { display: grid; grid-template-columns: repeat(3, 1fr); gap: 18px 24px; background: #fff; border: 1px solid ${C.border}; border-radius: 14px; padding: 18px 20px; margin-bottom: 22px; }
@media (max-width: 760px) { .ld-info { grid-template-columns: 1fr; } }
.ld-info-item { display: flex; align-items: center; gap: 12px; min-width: 0; }
.ld-info-ico { display: grid; place-items: center; width: 40px; height: 40px; border-radius: 11px; font-size: 17px; flex: 0 0 40px; }
.ld-info-text { min-width: 0; }
.ld-info-lbl { font-size: 12.5px; color: ${C.muted}; font-weight: 500; margin-bottom: 2px; }
.ld-info-val { font-size: 15px; font-weight: 700; color: ${C.ink}; word-break: break-word; }

/* section head */
.ld-section-head { display: flex; align-items: center; gap: 10px; font-size: 14px; font-weight: 800; letter-spacing: .04em; text-transform: uppercase; color: ${C.primary}; margin: 0 0 14px; }
.ld-section-ico { display: grid; place-items: center; width: 28px; height: 28px; border-radius: 8px; background: ${C.accentBg}; color: ${C.primary}; font-size: 14px; }

/* leave summary grid */
.ld-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 14px; margin-bottom: 22px; }
@media (max-width: 860px) { .ld-grid { grid-template-columns: repeat(2, 1fr); } }
@media (max-width: 520px) { .ld-grid { grid-template-columns: 1fr; } }
.ld-stat { display: flex; align-items: center; gap: 12px; border: 1px solid ${C.border}; border-radius: 12px; padding: 14px 16px; }
.ld-stat-ico { display: grid; place-items: center; width: 38px; height: 38px; border-radius: 10px; font-size: 16px; flex: 0 0 38px; }
.ld-stat-text { min-width: 0; }
.ld-stat-lbl { display: flex; align-items: center; gap: 5px; font-size: 12.5px; color: ${C.muted}; font-weight: 500; margin-bottom: 2px; }
.ld-stat-val { font-size: 18px; font-weight: 800; color: ${C.ink}; word-break: break-word; }
.ld-stat-sub { font-size: 11.5px; font-weight: 600; color: ${C.faint}; margin-top: 3px; }

/* hint tooltip */
.ld-hint { position: relative; display: inline-grid; place-items: center; width: 15px; height: 15px;
  flex: 0 0 15px; color: ${C.faint}; font-size: 13px; cursor: help; outline: none; }
.ld-hint:hover, .ld-hint:focus-visible { color: ${C.primary}; }
.ld-hint-bub { position: absolute; bottom: calc(100% + 9px); left: 50%; transform: translateX(-50%);
  width: max-content; max-width: 250px; background: ${C.ink}; color: #fff; text-align: left;
  font-size: 12px; font-weight: 500; line-height: 1.5; letter-spacing: 0; text-transform: none;
  padding: 9px 11px; border-radius: 9px; box-shadow: 0 6px 18px rgba(11,23,42,.22);
  opacity: 0; visibility: hidden; transition: opacity .14s ease, visibility .14s ease;
  pointer-events: none; z-index: 60; white-space: normal; }
.ld-hint-bub::after { content: ""; position: absolute; top: 100%; left: 50%; transform: translateX(-50%);
  border: 5px solid transparent; border-top-color: ${C.ink}; }
.ld-hint:hover .ld-hint-bub, .ld-hint:focus-visible .ld-hint-bub { opacity: 1; visibility: visible; }
@media (max-width: 520px) { .ld-hint-bub { max-width: 190px; } }

/* leave breakdown strip */
.ld-breakdown { display: flex; align-items: center; gap: 14px; flex-wrap: wrap;
  background: #fff; border: 1px solid ${C.border}; border-left: 3px solid ${C.primary};
  border-radius: 12px; padding: 12px 16px; margin-bottom: 16px; }
.ld-breakdown-lbl { font-size: 11.5px; font-weight: 800; letter-spacing: .06em; text-transform: uppercase; color: ${C.muted}; }
.ld-breakdown-eq { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; font-size: 13.5px; color: ${C.ink}; }
.ld-breakdown-eq b { font-size: 15px; font-weight: 800; }
.ld-breakdown-op { color: ${C.faint}; font-weight: 700; }
.ld-breakdown-part { font-weight: 700; padding: 4px 10px; border-radius: 999px; }
.ld-breakdown-part--paid { background: ${TONES.green.bg}; color: ${TONES.green.fg}; }
.ld-breakdown-part--relax { background: ${TONES.purple.bg}; color: ${TONES.purple.fg}; }
.ld-breakdown-part--unpaid { background: ${TONES.red.bg}; color: ${TONES.red.fg}; }

/* leave dates */
.ld-dates { display: grid; grid-template-columns: 1fr 1fr; gap: 24px; background: #fff; border: 1px solid ${C.border}; border-radius: 14px; padding: 18px 20px; }
@media (max-width: 640px) { .ld-dates { grid-template-columns: 1fr; } }
.ld-datehead { display: flex; align-items: center; gap: 8px; font-size: 13px; font-weight: 800; letter-spacing: .04em; margin-bottom: 12px; }
.ld-datenote { font-size: 12.5px; color: ${C.muted}; background: ${C.surface}; border: 1px solid ${C.border};
  border-radius: 8px; padding: 7px 10px; margin-bottom: 10px; line-height: 1.45; }
.ld-datechips { display: flex; flex-wrap: wrap; gap: 8px; }
.ld-datechip { font-size: 13px; font-weight: 600; padding: 6px 12px; border-radius: 8px; }

/* cost report */

.ld-costtable-wrap { background: #fff; border: 1px solid ${C.border}; border-radius: 14px; overflow: auto; margin-bottom: 14px; }
.ld-costtable { width: 100%; border-collapse: collapse; font-size: 13.5px; min-width: 720px; }
.ld-costtable thead th { text-align: left; font-size: 11.5px; font-weight: 800; letter-spacing: .04em; text-transform: uppercase; color: ${C.muted}; background: ${C.surface}; padding: 12px 14px; border-bottom: 1px solid ${C.border}; white-space: nowrap; }
.ld-costtable tbody td { padding: 12px 14px; border-bottom: 1px solid ${C.border}; color: ${C.ink}; white-space: nowrap; }
.ld-costtable tbody tr:last-child td { border-bottom: none; }
.ld-costtable tbody tr:hover { background: ${C.surface}; }
.ld-costtable .ld-num { text-align: right; font-variant-numeric: tabular-nums; }
.ld-costtable-period { font-weight: 700; }
.ld-costtable-cost { font-weight: 800; color: ${C.primary}; }
.ld-costtable tfoot td { padding: 12px 14px; border-top: 2px solid ${C.border}; }
.ld-costtable-totallbl { text-align: right; font-weight: 800; color: ${C.ink}; text-transform: uppercase; font-size: 11.5px; letter-spacing: .04em; }
.ld-attpill { display: inline-block; font-size: 12.5px; font-weight: 700; padding: 3px 10px; border-radius: 999px; }

.ld-muted { color: ${C.muted}; font-size: 14px; padding: 8px 0; }
.ld-error { display: flex; align-items: center; gap: 8px; background: #fdecec; border: 1px solid #f5c9c9; color: ${C.red}; border-radius: 10px; padding: 10px 14px; font-size: 13.5px; margin: 8px 0; }

/* buttons */
.ld-btn { display: inline-flex; align-items: center; justify-content: center; border-radius: 10px; font-size: 14px; font-weight: 600; padding: 10px 22px; cursor: pointer; border: 1px solid ${C.border}; transition: all .15s ease; }
.ld-btn:disabled { opacity: .55; cursor: not-allowed; }
.ld-btn--ghost { background: #fff; color: ${C.ink}; }
.ld-btn--ghost:hover:not(:disabled) { border-color: ${C.primary}; color: ${C.primary}; }
.ld-btn--primary { border: none; color: #fff; background: linear-gradient(90deg, ${C.primary}, #129ab8); box-shadow: 0 2px 6px rgba(11,60,136,.2); }
.ld-btn--primary:hover:not(:disabled) { filter: brightness(1.06); }

/* relaxation modal */
.ld-backdrop { position: fixed; inset: 0; background: rgba(15,23,42,.45); display: flex; align-items: center; justify-content: center; padding: 20px; z-index: 1000; }
.ld-modal { background: #fff; border-radius: 16px; padding: 22px 24px; width: 100%; max-width: 520px; box-shadow: 0 20px 50px rgba(0,0,0,.25); max-height: 90vh; overflow-y: auto; }
.ld-modal-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; margin-bottom: 16px; }
.ld-modal-title { font-size: 19px; font-weight: 800; color: ${C.ink}; margin: 0; }
.ld-form { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; margin-bottom: 14px; }
@media (max-width: 480px) { .ld-form { grid-template-columns: 1fr; } }
.ld-field { display: flex; flex-direction: column; gap: 6px; min-width: 0; }
.ld-field--full { grid-column: 1 / -1; }
.ld-field-lbl { display: flex; align-items: center; gap: 5px; font-size: 12px; font-weight: 700; color: ${C.ink}; }
.ld-input { width: 100%; box-sizing: border-box; padding: 9px 12px; border-radius: 10px; border: 1px solid ${C.border}; background: #fff; color: ${C.ink}; font-size: 14px; font-family: inherit; outline: none; }
.ld-input:focus { border-color: ${C.primary}; box-shadow: 0 0 0 3px ${C.accentBg}; }
.ld-input:disabled { background: ${C.surface}; color: ${C.muted}; }
.ld-success { display: flex; align-items: center; gap: 8px; color: ${C.green}; font-weight: 600; background: #e7f6ee; border: 1px solid #c7ead6; border-radius: 10px; padding: 12px 14px; margin-bottom: 14px; }
.ld-modal-actions { display: flex; justify-content: flex-end; gap: 10px; }
`;