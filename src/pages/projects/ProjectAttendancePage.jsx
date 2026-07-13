import React, { useEffect, useMemo, useState } from "react";
import { useParams } from "react-router-dom";
import { useProject } from "../../store/project/projectsStore";
import { setPageContext, clearPageContext } from "../../utils/pageContext";
import { loadMilestonesForProject } from "../../api/milestoneConfigApi";
import { getToken } from "../../api/auth";
import "../../styles/global.css";

const API_BASE = "http://10.1.131.199:8019"; // move to env / your api client

// ---------- design tokens (matched to ProjectResourcePage) ----------
const C = {
  primary: "#0b3c88",
  primaryDark: "#051f4a",
  ink: "#1e2a3a",
  muted: "#6b7a90",
  border: "#dbe5f1",
  surface: "#f4f7fb",
  divider: "#eef1f6",
  green: "#0f9d58",
  greenBg: "#e6f6ee",
  red: "#d32f2f",
  accentBg: "#eef2ff",
};

const MONTH_NAMES = [
  "", "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];
const WEEKDAY_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const WEEKDAY_NAMES = new Set([
  "monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday",
]);

const now = new Date();
const CURRENT_YEAR = now.getFullYear();
const CURRENT_QUARTER = Math.floor(now.getMonth() / 3) + 1;
const YEAR_OPTIONS = [CURRENT_YEAR, CURRENT_YEAR - 1, CURRENT_YEAR - 2];

// ---------- helpers ----------
const pad2 = (n) => String(n).padStart(2, "0");

function parseHours(value) {
  const n = parseFloat(String(value ?? ""));
  return Number.isFinite(n) ? n : 0;
}
function totalShortHours(shortHours) {
  if (!shortHours) return 0;
  return Object.values(shortHours).reduce((sum, v) => sum + parseHours(v), 0);
}
function getCalc(resource) {
  return resource?.calculation ?? resource ?? {};
}
function isWeekdayName(name) {
  return WEEKDAY_NAMES.has(String(name ?? "").trim().toLowerCase());
}
function dayNum(s) {
  return Number(s.slice(8, 10));
}
function weekdayShort(s) {
  return WEEKDAY_SHORT[new Date(`${s}T00:00:00`).getDay()];
}

// Collapse the raw [{date,name}] list: dedupe by date, prefer real holiday
// names over weekday-only artifacts. `named` = a real title exists.
function normalizeHolidays(raw) {
  const byDate = new Map();
  for (const h of raw ?? []) {
    if (!h?.date) continue;
    const entry = byDate.get(h.date) ?? { date: h.date, real: [], weekday: [] };
    if (isWeekdayName(h.name)) {
      if (!entry.weekday.includes(h.name)) entry.weekday.push(h.name);
    } else if (h.name) {
      if (!entry.real.includes(h.name)) entry.real.push(h.name);
    }
    byDate.set(h.date, entry);
  }
  return [...byDate.values()]
    .map((e) => ({
      date: e.date,
      name: e.real.length ? e.real.join(" / ") : (e.weekday[0] || ""),
      named: e.real.length > 0,
    }))
    .sort((a, b) => a.date.localeCompare(b.date));
}

function buildMonthGrid(year, month) {
  const startDay = new Date(year, month - 1, 1).getDay();
  const daysInMonth = new Date(year, month, 0).getDate();
  const cells = [];
  for (let i = 0; i < startDay; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(d);
  while (cells.length % 7 !== 0) cells.push(null);
  return cells;
}

export default function ProjectAttendancePage() {
  const { projectId } = useParams();
  const project = useProject(projectId);

  const [year, setYear] = useState(CURRENT_YEAR);
  const [selectedMonth, setSelectedMonth] = useState("all");
  const [quarter, setQuarter] = useState(CURRENT_QUARTER);
  const [expanded, setExpanded] = useState({});

  const [summary, setSummary] = useState(null);
  const [summaryLoading, setSummaryLoading] = useState(false);
  const [summaryError, setSummaryError] = useState(null);

  const [quarterly, setQuarterly] = useState(null);
  const [quarterlyLoading, setQuarterlyLoading] = useState(false);
  const [quarterlyError, setQuarterlyError] = useState(null);

  // Holiday modal
  const [holidayOpen, setHolidayOpen] = useState(false);
  const [holidays, setHolidays] = useState(null);
  const [calendar, setCalendar] = useState(null);
  const [holidayLoading, setHolidayLoading] = useState(false);
  const [holidayError, setHolidayError] = useState(null);

  // Resource-based milestones + Leave Management upload modal
  const [milestones, setMilestones] = useState([]);
  const [milestonesLoading, setMilestonesLoading] = useState(false);
  const [milestonesError, setMilestonesError] = useState(null);
  // The milestone whose Leave Management modal is open (null = closed).
  const [leaveMilestone, setLeaveMilestone] = useState(null);

  useEffect(() => {
    setPageContext({ projectName: project?.projectName || "" });
    return () => clearPageContext();
  }, [project?.projectName]);

  // Resource-based milestones — only milestones with isResourceBased === true
  // are eligible for attendance / leave uploads, so that's all we list.
  useEffect(() => {
    if (!projectId) return;
    let active = true;
    (async () => {
      setMilestonesLoading(true);
      setMilestonesError(null);
      try {
        const list = await loadMilestonesForProject(projectId);
        if (active) setMilestones(Array.isArray(list) ? list : []);
      } catch (err) {
        if (active) setMilestonesError(err?.message || "Failed to load milestones");
      } finally {
        if (active) setMilestonesLoading(false);
      }
    })();
    return () => { active = false; };
  }, [projectId]);

  const resourceMilestones = useMemo(
    () => milestones.filter((m) => m.isResourceBased === true),
    [milestones]
  );

  // Yearly summary (month=all) — fetched once per year, filtered client-side.
  useEffect(() => {
    if (!projectId) return;
    let active = true;
    const controller = new AbortController();
    (async () => {
      setSummaryLoading(true);
      setSummaryError(null);
      try {
        const res = await fetch(
          `${API_BASE}/api/attendance/summary?year=${year}&month=all&projectId=${projectId}`,
          { signal: controller.signal }
        );
        if (!res.ok) throw new Error(`Request failed (${res.status})`);
        const data = await res.json();
        if (active) setSummary(data);
      } catch (err) {
        if (active && err.name !== "AbortError")
          setSummaryError(err.message || "Failed to load attendance summary");
      } finally {
        if (active) setSummaryLoading(false);
      }
    })();
    return () => { active = false; controller.abort(); };
  }, [projectId, year]);

  // Quarterly leave policy
  useEffect(() => {
    if (!projectId) return;
    let active = true;
    const controller = new AbortController();
    (async () => {
      setQuarterlyLoading(true);
      setQuarterlyError(null);
      try {
        const res = await fetch(
          `${API_BASE}/api/attendance/quarterly-leave?year=${year}&quarter=${quarter}&projectId=${projectId}`,
          { signal: controller.signal }
        );
        if (!res.ok) throw new Error(`Request failed (${res.status})`);
        const data = await res.json();
        if (active) setQuarterly(data);
      } catch (err) {
        if (active && err.name !== "AbortError")
          setQuarterlyError(err.message || "Failed to load quarterly leave");
      } finally {
        if (active) setQuarterlyLoading(false);
      }
    })();
    return () => { active = false; controller.abort(); };
  }, [projectId, year, quarter]);

  // Holidays + calendar — lazy fetch when modal opens (or year changes while open).
  useEffect(() => {
    if (!holidayOpen) return;
    let active = true;
    const controller = new AbortController();
    (async () => {
      setHolidayLoading(true);
      setHolidayError(null);
      try {
        const [hRes, cRes] = await Promise.all([
          fetch(`${API_BASE}/api/holidays/${year}?month=all`, { signal: controller.signal }),
          fetch(`${API_BASE}/api/calendar/${year}?month=all`, { signal: controller.signal }),
        ]);
        if (!hRes.ok) throw new Error(`Holidays request failed (${hRes.status})`);
        const hData = await hRes.json();
        const cData = cRes.ok ? await cRes.json() : null;
        if (active) {
          setHolidays(normalizeHolidays(hData));
          setCalendar(cData);
        }
      } catch (err) {
        if (active && err.name !== "AbortError")
          setHolidayError(err.message || "Failed to load holidays");
      } finally {
        if (active) setHolidayLoading(false);
      }
    })();
    return () => { active = false; controller.abort(); };
  }, [holidayOpen, year]);

  const toggleRow = (key) =>
    setExpanded((prev) => ({ ...prev, [key]: !prev[key] }));

  const allMonths = summary?.months ?? [];
  const availableMonths = allMonths.map((m) => m.month).sort((a, b) => a - b);
  const visibleMonths =
    selectedMonth === "all"
      ? allMonths
      : allMonths.filter((m) => m.month === Number(selectedMonth));

  const uniqueEmployees = new Set();
  visibleMonths.forEach((m) =>
    (m.employees ?? []).forEach((e) => uniqueEmployees.add(e.attendanceId))
  );

  return (
    <div className="uidai-pmis-content att-page">
      <style>{ATT_CSS}</style>

      {/* Header */}
      <div style={{ marginBottom: 28 }}>
        <div className="att-eyebrow">{project?.projectName || "Project"}</div>
        <h1 className="uidai-pmis-title" style={{ marginBottom: 6 }}>Attendance</h1>
        <p className="uidai-pmis-subtitle">
          Monthly attendance, short hours and quarterly leave for your project team
        </p>

        <div className="att-stats">
          <span className="att-stat">
            <b>{visibleMonths.length}</b> month{visibleMonths.length === 1 ? "" : "s"} reported
          </span>
          <span className="att-dot" />
          <span className="att-stat">
            <b style={{ color: C.green }}>{uniqueEmployees.size}</b> employees
          </span>
        </div>
      </div>

      {/* Resource-based milestones — Leave Management */}
      <section style={{ marginBottom: 28 }}>
        <h2 className="att-section-title">Resource-based milestones</h2>
        {milestonesLoading && <div className="att-muted">Loading milestones…</div>}
        {milestonesError && <div className="att-error">{milestonesError}</div>}
        {!milestonesLoading && !milestonesError && resourceMilestones.length === 0 && (
          <div className="att-empty">No resource-based milestones for this project.</div>
        )}
        {!milestonesLoading && !milestonesError && resourceMilestones.length > 0 && (
          <div className="uidai-pmis-card att-card">
            <div className="att-table-wrap">
              <table className="att-table">
                <thead>
                  <tr>
                    <th className="att-th">Code</th>
                    <th className="att-th">Milestone</th>
                    <th className="att-th">Start</th>
                    <th className="att-th">End</th>
                    <th className="att-th">Status</th>
                    <th className="att-th att-num">Leave Management</th>
                  </tr>
                </thead>
                <tbody>
                  {resourceMilestones.map((m) => (
                    <tr className="att-row" key={m.apiId || m.uid}>
                      <td className="att-td">
                        <code className="att-code">{m.serverDisplayCode || m.id || "—"}</code>
                      </td>
                      <td className="att-td att-strong">{m.name || "—"}</td>
                      <td className="att-td">{m.startDate || "—"}</td>
                      <td className="att-td">{m.endDate || "—"}</td>
                      <td className="att-td">{m.status || "—"}</td>
                      <td className="att-td att-num">
                        <button
                          className="att-btn-primary"
                          onClick={() => setLeaveMilestone(m)}
                          disabled={!m.apiId}
                          title={
                            m.apiId
                              ? "Upload attendance for this milestone"
                              : "Milestone must be saved before uploading attendance"
                          }
                        >
                          Leave Management
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </section>

      {/* Controls */}
      <div className="att-toolbar">
        <div className="att-controls">
          <Field label="Year">
            <select
              className="att-select"
              value={year}
              onChange={(e) => { setYear(Number(e.target.value)); setSelectedMonth("all"); }}
            >
              {YEAR_OPTIONS.map((y) => <option key={y} value={y}>{y}</option>)}
            </select>
          </Field>
          <Field label="Month">
            <select
              className="att-select"
              value={selectedMonth}
              onChange={(e) => setSelectedMonth(e.target.value)}
            >
              <option value="all">All months</option>
              {availableMonths.map((m) => (
                <option key={m} value={m}>{MONTH_NAMES[m]}</option>
              ))}
            </select>
          </Field>
        </div>
        <button className="att-btn-secondary" onClick={() => setHolidayOpen(true)}>
          <CalendarIcon />
          Holiday list
        </button>
      </div>

      {/* Monthly summary */}
      <section style={{ marginTop: 8 }}>
        <h2 className="att-section-title">Monthly summary</h2>
        {summaryLoading && <div className="att-muted">Loading summary…</div>}
        {summaryError && <div className="att-error">{summaryError}</div>}
        {!summaryLoading && !summaryError && visibleMonths.length === 0 && (
          <div className="att-empty">
            {selectedMonth === "all"
              ? `No attendance recorded for ${year}.`
              : `No attendance recorded for ${MONTH_NAMES[Number(selectedMonth)]} ${year}.`}
          </div>
        )}
        {visibleMonths.map((m) => (
          <MonthCard key={m.month} month={m} expanded={expanded} onToggle={toggleRow} />
        ))}
      </section>

      {/* Quarterly leave */}
      <section style={{ marginTop: 28 }}>
        <div className="att-section-head">
          <h2 className="att-section-title" style={{ margin: 0 }}>Quarterly leave</h2>
          <Field label="Quarter">
            <select
              className="att-select"
              value={quarter}
              onChange={(e) => setQuarter(Number(e.target.value))}
            >
              {[1, 2, 3, 4].map((q) => <option key={q} value={q}>Q{q}</option>)}
            </select>
          </Field>
        </div>
        {quarterlyLoading && <div className="att-muted">Loading quarterly leave…</div>}
        {quarterlyError && <div className="att-error">{quarterlyError}</div>}
        {!quarterlyLoading && !quarterlyError && quarterly && (
          <QuarterlyPanel data={quarterly} expanded={expanded} onToggle={toggleRow} />
        )}
      </section>

      {holidayOpen && (
        <HolidayModal
          year={year}
          holidays={holidays}
          calendar={calendar}
          loading={holidayLoading}
          error={holidayError}
          onClose={() => setHolidayOpen(false)}
        />
      )}

      {leaveMilestone && (
        <LeaveUploadModal
          projectId={projectId}
          milestone={leaveMilestone}
          onClose={() => setLeaveMilestone(null)}
        />
      )}
    </div>
  );
}

/* =====================================================================
   Leave Management — per-milestone attendance Excel upload.
   Mirrors the milestone-modal upload: POST /api/attendance/monthly with
   month, year, milestoneId and projectId, plus the Excel file.
   ===================================================================== */
function LeaveUploadModal({ projectId, milestone, onClose }) {
  const [month, setMonth] = useState("");
  const [uploadYear, setUploadYear] = useState("");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [rateYear, setRateYear] = useState("");
  const [file, setFile] = useState(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState(null);
  const [done, setDone] = useState(false);

  // Rate-year options (Year-1, Year-2, …) — as many as the milestone spans,
  // falling back to 5 when the dates can't be resolved.
  const rateYearOptions = useMemo(() => {
    const sy = parseInt(String(milestone?.startDate || "").slice(0, 4), 10);
    const ey = parseInt(String(milestone?.endDate || "").slice(0, 4), 10);
    const count =
      Number.isFinite(sy) && Number.isFinite(ey) && ey >= sy
        ? Math.min(10, ey - sy + 1)
        : 5;
    return Array.from({ length: count }, (_, i) => i + 1);
  }, [milestone]);

  useEffect(() => {
    const onKey = (e) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [onClose]);

  const upload = async () => {
    setError(null);
    if (!file) { setError("Please select an Excel file."); return; }
    if (!month || !uploadYear) { setError("Please select both month and year."); return; }
    if (!startDate || !endDate) { setError("Please select both start and end date."); return; }
    if (endDate < startDate) { setError("End date cannot be earlier than start date."); return; }
    if (!rateYear) { setError("Please select a rate year."); return; }
    if (!milestone?.apiId) { setError("Couldn't determine the milestone."); return; }
    if (!projectId) { setError("Couldn't determine the project."); return; }

    const body = new FormData();
    body.append("file", file);
    const params = new URLSearchParams({
      month: String(month),
      year: String(uploadYear),
      startDate: String(startDate),
      endDate: String(endDate),
      rateYear: String(rateYear),
      milestoneId: milestone.apiId,
      projectId,
    });

    try {
      setUploading(true);
      const token = getToken();
      const res = await fetch(`${API_BASE}/api/attendance/monthly?${params.toString()}`, {
        method: "POST",
        headers: token ? { Authorization: `Bearer ${token}` } : {},
        body,
      });
      if (!res.ok) throw new Error(`Upload failed (${res.status})`);
      setDone(true);
    } catch (err) {
      setError(err?.message || "Failed to upload attendance.");
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className="att-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="att-modal" role="dialog" aria-modal="true" aria-label="Leave Management"
        style={{ maxWidth: 540 }}>
        <div className="att-modal-head">
          <div>
            <div className="att-eyebrow" style={{ marginBottom: 4 }}>Leave Management</div>
            <h2 className="att-modal-title">Upload Attendance</h2>
          </div>
          <button className="att-close" onClick={onClose} aria-label="Close">✕</button>
        </div>

        <div className="att-muted" style={{ paddingTop: 0, marginBottom: 12 }}>
          {milestone.serverDisplayCode || milestone.id ? (
            <><code className="att-code">{milestone.serverDisplayCode || milestone.id}</code>{" "}</>
          ) : null}
          {milestone.name}
        </div>

        {done ? (
          <>
            <div style={{ padding: "8px 0 16px", color: C.green, fontWeight: 600 }}>
              Attendance uploaded successfully!
            </div>
            <div style={{ display: "flex", justifyContent: "flex-end" }}>
              <button className="att-btn-primary" onClick={onClose}>Done</button>
            </div>
          </>
        ) : (
          <>
            <div className="att-controls" style={{ marginBottom: 14 }}>
              <Field label="Month">
                <select className="att-select" value={month} onChange={(e) => setMonth(e.target.value)}>
                  <option value="" disabled>Select month</option>
                  {MONTH_NAMES.slice(1).map((m, i) => (
                    <option key={m} value={i + 1}>{m}</option>
                  ))}
                </select>
              </Field>
              <Field label="Year">
                <select className="att-select" value={uploadYear} onChange={(e) => setUploadYear(e.target.value)}>
                  <option value="" disabled>Select year</option>
                  {YEAR_OPTIONS.map((y) => <option key={y} value={y}>{y}</option>)}
                </select>
              </Field>
            </div>

            <div className="att-controls" style={{ marginBottom: 14 }}>
              <Field label="Start Date">
                <input
                  type="date"
                  className="att-select"
                  value={startDate}
                  onChange={(e) => setStartDate(e.target.value)}
                />
              </Field>
              <Field label="End Date">
                <input
                  type="date"
                  className="att-select"
                  value={endDate}
                  min={startDate || undefined}
                  onChange={(e) => setEndDate(e.target.value)}
                />
              </Field>
              <Field label="Rate Year">
                <select className="att-select" value={rateYear} onChange={(e) => setRateYear(e.target.value)}>
                  <option value="" disabled>Select rate year</option>
                  {rateYearOptions.map((n) => (
                    <option key={n} value={n}>Year-{n}</option>
                  ))}
                </select>
              </Field>
            </div>

            <Field label="Attendance Excel">
              <input
                type="file"
                accept=".xlsx,.xls"
                onChange={(e) => setFile(e.target.files?.[0] || null)}
                style={{ fontSize: 14 }}
              />
            </Field>

            {error && <div className="att-error">{error}</div>}

            <div style={{ display: "flex", justifyContent: "flex-end", gap: 10, marginTop: 22 }}>
              <button className="att-btn-secondary" onClick={onClose} disabled={uploading}>Cancel</button>
              <button className="att-btn-primary" onClick={upload} disabled={uploading}>
                {uploading ? "Uploading…" : "Upload"}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

/* ---------- small building blocks ---------- */
function Field({ label, children }) {
  return (
    <label className="att-field">
      <span className="att-field-label">{label}</span>
      {children}
    </label>
  );
}

function Chip({ children, accent }) {
  return <span className={accent ? "att-chip att-chip-accent" : "att-chip"}>{children}</span>;
}

/* =====================================================================
   Holiday modal — calendar mode
   ===================================================================== */
function HolidayModal({ year, holidays, calendar, loading, error, onClose }) {
  const today = new Date();
  const initialMonth = today.getFullYear() === year ? today.getMonth() + 1 : 1;
  const [viewMonth, setViewMonth] = useState(initialMonth);

  useEffect(() => {
    setViewMonth(today.getFullYear() === year ? today.getMonth() + 1 : 1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [year]);

  useEffect(() => {
    const onKey = (e) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [onClose]);

  const holidayMap = useMemo(() => {
    const m = new Map();
    (holidays ?? []).forEach((h) => { if (h.named) m.set(h.date, h); });
    return m;
  }, [holidays]);

  const namedCount = holidays ? holidays.filter((h) => h.named).length : 0;
  const monthHolidays = (holidays ?? []).filter(
    (h) => h.named && Number(h.date.slice(5, 7)) === viewMonth
  );
  const monthMeta = calendar?.months?.find((m) => m.month === viewMonth);

  const cells = buildMonthGrid(year, viewMonth);
  const todayStr = `${today.getFullYear()}-${pad2(today.getMonth() + 1)}-${pad2(today.getDate())}`;

  return (
    <div className="att-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="att-modal" role="dialog" aria-modal="true" aria-label={`Holidays ${year}`}>
        <div className="att-modal-head">
          <div>
            <div className="att-eyebrow" style={{ marginBottom: 4 }}>Calendar</div>
            <h2 className="att-modal-title">Holidays · {year}</h2>
          </div>
          <button className="att-close" onClick={onClose} aria-label="Close">✕</button>
        </div>

        {loading && <div className="att-muted">Loading holidays…</div>}
        {error && <div className="att-error">{error}</div>}

        {!loading && !error && (
          <>
            <div className="att-chips" style={{ marginBottom: 14 }}>
              {calendar && (
                <>
                  <Chip>{calendar.saturdays} Saturdays</Chip>
                  <Chip>{calendar.sundays} Sundays</Chip>
                  <Chip>{calendar.totalWeekendDays} weekend days</Chip>
                </>
              )}
              <Chip accent>{namedCount} holidays</Chip>
            </div>

            {/* Calendar nav */}
            <div className="att-cal-nav">
              <button
                className="att-nav-btn"
                onClick={() => setViewMonth((m) => Math.max(1, m - 1))}
                disabled={viewMonth === 1}
                aria-label="Previous month"
              >‹</button>
              <div className="att-cal-title">{MONTH_NAMES[viewMonth]} {year}</div>
              <button
                className="att-nav-btn"
                onClick={() => setViewMonth((m) => Math.min(12, m + 1))}
                disabled={viewMonth === 12}
                aria-label="Next month"
              >›</button>
            </div>

            {/* Calendar grid */}
            <div className="att-cal-grid att-cal-weekhead">
              {WEEKDAY_SHORT.map((w) => (
                <div key={w} className="att-cal-wd">{w}</div>
              ))}
            </div>
            <div className="att-cal-grid">
              {cells.map((d, i) => {
                if (d == null) return <div key={`e-${i}`} className="att-cal-cell att-cal-empty" />;
                const dateStr = `${year}-${pad2(viewMonth)}-${pad2(d)}`;
                const dow = new Date(year, viewMonth - 1, d).getDay();
                const isWeekend = dow === 0 || dow === 6;
                const holiday = holidayMap.get(dateStr);
                const isToday = dateStr === todayStr;
                const cls = [
                  "att-cal-cell",
                  isWeekend ? "att-cal-weekend" : "",
                  holiday ? "att-cal-holiday" : "",
                  isToday ? "att-cal-today" : "",
                ].join(" ").trim();
                return (
                  <div key={dateStr} className={cls} title={holiday ? holiday.name : undefined}>
                    <span className="att-cal-day">{d}</span>
                    {holiday && <span className="att-cal-mark" />}
                  </div>
                );
              })}
            </div>

            {/* Legend */}
            <div className="att-legend">
              <span className="att-legend-item"><span className="att-sw att-sw-holiday" /> Public holiday</span>
              <span className="att-legend-item"><span className="att-sw att-sw-weekend" /> Weekend</span>
              <span className="att-legend-item"><span className="att-sw att-sw-today" /> Today</span>
            </div>

            {/* This month's holidays */}
            <div className="att-cal-list">
              <div className="att-cal-list-head">
                Holidays in {MONTH_NAMES[viewMonth]}
                {monthMeta && (
                  <span className="att-cal-list-sub"> · {monthMeta.totalWeekendDays} weekend days</span>
                )}
              </div>
              {monthHolidays.length === 0 ? (
                <div className="att-muted" style={{ padding: "6px 0" }}>
                  No public holidays this month.
                </div>
              ) : (
                monthHolidays.map((h) => (
                  <div key={`${h.date}-${h.name}`} className="att-holiday-row">
                    <div className="att-date-badge">
                      <span className="att-date-day">{dayNum(h.date)}</span>
                      <span className="att-date-wd">{weekdayShort(h.date)}</span>
                    </div>
                    <div className="att-holiday-name">{h.name}</div>
                  </div>
                ))
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

/* =====================================================================
   Monthly summary card
   ===================================================================== */
function MonthCard({ month, expanded, onToggle }) {
  const employees = month.employees ?? [];
  return (
    <div className="uidai-pmis-card att-card">
      <div className="att-card-head">
        <strong className="att-card-title">{MONTH_NAMES[month.month]} {month.year}</strong>
        <div className="att-chips">
          <Chip>{month.totalDaysInMonth} days</Chip>
          <Chip>{month.totalWeekendDays} weekend days</Chip>
          <Chip>{employees.length} employees</Chip>
          {month.publicHolidayCount > 0 && (
            <span
              className="att-chip"
              title={month.publicHolidays.map((h) => `${h.date} · ${h.name}`).join("\n")}
            >
              {month.publicHolidayCount} holiday{month.publicHolidayCount > 1 ? "s" : ""}
            </span>
          )}
        </div>
      </div>

      {employees.length === 0 ? (
        <div className="att-muted">No employee data.</div>
      ) : (
        <div className="att-table-wrap">
          <table className="att-table">
            <thead>
              <tr>
                <th className="att-th att-th-x" />
                <th className="att-th">ID</th>
                <th className="att-th">Name</th>
                <th className="att-th">Designation</th>
                <th className="att-th att-num">Leave days</th>
                <th className="att-th att-num">Half days</th>
                <th className="att-th att-num">Short-hour days</th>
                <th className="att-th att-num">Total short hrs</th>
              </tr>
            </thead>
            <tbody>
              {employees.map((emp) => {
                const key = `m-${month.month}-${emp.attendanceId}`;
                const shortEntries = Object.entries(emp.shortHours ?? {});
                const hasDetail = shortEntries.length > 0 || (emp.halfDays?.length ?? 0) > 0;
                const isOpen = !!expanded[key];
                const totalShort = totalShortHours(emp.shortHours);
                return (
                  <React.Fragment key={key}>
                    <tr className="att-row">
                      <td className="att-td">
                        {hasDetail && (
                          <button className="att-expand" onClick={() => onToggle(key)}
                            aria-label={isOpen ? "Collapse" : "Expand"}>
                            {isOpen ? "▾" : "▸"}
                          </button>
                        )}
                      </td>
                      <td className="att-td">
                        <code className="att-code">{emp.attendanceId}</code>
                      </td>
                      <td className="att-td att-strong">{emp.employeeName}</td>
                      <td className="att-td">{emp.designation || "—"}</td>
                      <td className="att-td att-num">{emp.leaveDays}</td>
                      <td className="att-td att-num">{emp.halfDays?.length ?? 0}</td>
                      <td className="att-td att-num">{emp.shortHourDays}</td>
                      <td className="att-td att-num">{totalShort ? totalShort.toFixed(2) : "0"}</td>
                    </tr>
                    {isOpen && hasDetail && (
                      <tr className="att-detail-row">
                        <td />
                        <td className="att-detail" colSpan={7}>
                          {(emp.halfDays?.length ?? 0) > 0 && (
                            <div className="att-detail-block">
                              <span className="att-detail-label">Half days:</span>{" "}
                              {emp.halfDays.join(", ")}
                            </div>
                          )}
                          {shortEntries.length > 0 && (
                            <div className="att-detail-block">
                              <span className="att-detail-label">Short hours:</span>{" "}
                              {shortEntries.map(([date, hrs]) => `${date} (${hrs})`).join(", ")}
                            </div>
                          )}
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

/* =====================================================================
   Quarterly leave panel
   ===================================================================== */
function QuarterlyPanel({ data, expanded, onToggle }) {
  const resources = data.resources ?? [];
  const monthsLabel = (data.monthsWithData ?? [])
    .map((m) => MONTH_NAMES[m] || m).join(", ");

  return (
    <div className="uidai-pmis-card att-card">
      <div className="att-card-head">
        <strong className="att-card-title">Q{data.quarter} {data.year}</strong>
        <div className="att-chips">
          <Chip>{data.quarterStart} → {data.quarterEnd}</Chip>
          <Chip>{data.resourceCount} resources</Chip>
          {monthsLabel && <Chip>Data: {monthsLabel}</Chip>}
        </div>
      </div>

      {resources.length === 0 ? (
        <div className="att-muted">No leave data recorded for this quarter.</div>
      ) : (
        <div className="att-table-wrap">
          <table className="att-table">
            <thead>
              <tr>
                <th className="att-th att-th-x" />
                <th className="att-th">Attendance Id</th>
                <th className="att-th">Employee Name</th>
                <th className="att-th">Joining Date</th>
                <th className="att-th att-num" title="Permissible paid leave">Permissible</th>
                <th className="att-th att-num" title="Leave days taken">Taken</th>
                <th className="att-th att-num" title="Paid leave days">Paid</th>
                <th className="att-th att-num" title="Unpaid leave days">Unpaid</th>
                <th className="att-th att-num" title="Sandwich days charged">Sandwich</th>
                <th className="att-th att-num" title="Total unpaid days">Total unpaid</th>
              </tr>
            </thead>
            <tbody>
              {resources.map((r, i) => {
                const c = getCalc(r);
                const key = `q-${data.quarter}-${r.attendanceId ?? i}`;
                const unpaidDates = c.unpaidLeaveDates ?? [];
                const sandwichDates = c.sandwichDates ?? [];
                const hasDetail = unpaidDates.length > 0 || sandwichDates.length > 0;
                const isOpen = !!expanded[key];
                const totalUnpaid = c.totalUnpaidDays ?? 0;
                return (
                  <React.Fragment key={key}>
                    <tr className="att-row">
                      <td className="att-td">
                        {hasDetail && (
                          <button className="att-expand" onClick={() => onToggle(key)}
                            aria-label={isOpen ? "Collapse" : "Expand"}>
                            {isOpen ? "▾" : "▸"}
                          </button>
                        )}
                      </td>
                      <td className="att-td"><code className="att-code">{r.attendanceId}</code></td>
                      <td className="att-td att-strong">{r.employeeName}</td>
                      <td className="att-td">{r.joiningDate || "—"}</td>
                      <td className="att-td att-num">{c.permissibleLeave ?? 0}</td>
                      <td className="att-td att-num">{c.leaveDaysTaken ?? 0}</td>
                      <td className="att-td att-num">{c.paidLeaveDays ?? 0}</td>
                      <td className="att-td att-num">{c.unpaidLeaveDays ?? 0}</td>
                      <td className="att-td att-num">{c.sandwichDays ?? 0}</td>
                      <td className={`att-td att-num${totalUnpaid > 0 ? " att-danger" : ""}`}>
                        {totalUnpaid}
                      </td>
                    </tr>
                    {isOpen && hasDetail && (
                      <tr className="att-detail-row">
                        <td />
                        <td className="att-detail" colSpan={9}>
                          {unpaidDates.length > 0 && (
                            <div className="att-detail-block">
                              <span className="att-detail-label">Unpaid leave dates:</span>{" "}
                              {unpaidDates.join(", ")}
                            </div>
                          )}
                          {sandwichDates.length > 0 && (
                            <div className="att-detail-block">
                              <span className="att-detail-label">Sandwich dates:</span>{" "}
                              {sandwichDates.join(", ")}
                            </div>
                          )}
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

/* ---------- icons ---------- */
function CalendarIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <rect x="3" y="4.5" width="18" height="16" rx="2.5" stroke="currentColor" strokeWidth="1.8" />
      <path d="M3 9h18M8 3v3M16 3v3" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

/* ---------- scoped styles (matched to ProjectResourcePage) ---------- */
const ATT_CSS = `
.att-page { padding: 28px 24px 64px; max-width: 1280px; margin: 0 auto; }
@media (max-width: 640px) { .att-page { padding: 20px 16px 48px; } }

.att-eyebrow { font-size: 12px; font-weight: 600; letter-spacing: 0.08em;
  text-transform: uppercase; color: ${C.primary}; margin-bottom: 6px; }

.att-stats { display: flex; gap: 14px; align-items: center; margin-top: 16px;
  font-size: 13px; color: ${C.muted}; flex-wrap: wrap; }
.att-stat b { font-size: 16px; color: ${C.ink}; font-weight: 700; margin-right: 4px; }
.att-dot { width: 4px; height: 4px; border-radius: 50%; background: #cbd2df; }

.att-toolbar { display: flex; align-items: flex-end; justify-content: space-between;
  gap: 16px; margin-bottom: 22px; flex-wrap: wrap; }
.att-controls { display: flex; gap: 12px; flex-wrap: wrap; }
.att-field { display: flex; flex-direction: column; gap: 6px; }
.att-field-label { font-size: 11.5px; font-weight: 700; letter-spacing: 0.05em;
  text-transform: uppercase; color: ${C.muted}; }
.att-select { padding: 9px 12px; border-radius: 10px; border: 1px solid ${C.border};
  background: #fff; color: ${C.ink}; font-size: 14px; font-family: inherit; min-width: 140px;
  outline: none; cursor: pointer; transition: all .15s ease; box-shadow: 0 1px 2px rgba(0,0,0,.04); }
.att-select:focus { border-color: ${C.primary}; box-shadow: 0 0 0 3px ${C.accentBg}; }

.att-btn-secondary { display: inline-flex; align-items: center; gap: 8px;
  border-radius: 10px; font-size: 14px; font-weight: 600; padding: 10px 16px; height: 40px;
  cursor: pointer; border: 1px solid ${C.border}; background: #fff; color: ${C.ink};
  transition: all .2s ease; box-shadow: 0 1px 2px rgba(0,0,0,.04); }
.att-btn-secondary:hover { background: #f9fafb; border-color: ${C.primary}; color: ${C.primary}; }
.att-btn-secondary:disabled { opacity: .5; cursor: not-allowed; }

.att-btn-primary { display: inline-flex; align-items: center; gap: 8px; border: none;
  border-radius: 10px; font-size: 14px; font-weight: 600; padding: 9px 16px; cursor: pointer;
  color: #fff; background: linear-gradient(90deg, ${C.primary}, #129ab8);
  transition: filter .2s ease, opacity .2s ease; box-shadow: 0 1px 2px rgba(0,0,0,.08); white-space: nowrap; }
.att-btn-primary:hover:not(:disabled) { filter: brightness(1.06); }
.att-btn-primary:disabled { opacity: .5; cursor: not-allowed; }

.att-section-title { font-size: 15px; font-weight: 700; color: ${C.ink}; margin: 0 0 14px; }
.att-section-head { display: flex; align-items: flex-end; justify-content: space-between;
  gap: 16px; margin-bottom: 14px; flex-wrap: wrap; }

.att-card { padding: 18px; margin-bottom: 16px; border: 1px solid ${C.border}; }
.att-card-head { display: flex; align-items: center; justify-content: space-between;
  gap: 12px; margin-bottom: 14px; flex-wrap: wrap; }
.att-card-title { font-size: 15px; color: ${C.ink}; font-weight: 700; }

.att-chips { display: flex; gap: 6px; flex-wrap: wrap; }
.att-chip { font-size: 12px; background: ${C.surface}; color: ${C.ink};
  padding: 3px 10px; border-radius: 999px; border: 1px solid ${C.border}; white-space: pre-line; }
.att-chip-accent { background: ${C.accentBg}; color: ${C.primary}; border-color: #d7def7; font-weight: 600; }

.att-table-wrap { overflow-x: auto; }
.att-table { width: 100%; border-collapse: collapse; font-size: 14px; }
.att-th { background: ${C.surface}; color: ${C.muted}; text-align: left; font-size: 11.5px;
  font-weight: 700; letter-spacing: 0.05em; text-transform: uppercase; padding: 11px 14px;
  border-bottom: 1px solid ${C.border}; white-space: nowrap; }
.att-th-x { width: 34px; }
.att-num { text-align: right; }
.att-td { padding: 12px 14px; vertical-align: middle; color: ${C.ink};
  border-bottom: 1px solid ${C.divider}; white-space: nowrap; }
.att-td.att-num { text-align: right; font-variant-numeric: tabular-nums; }
.att-strong { font-weight: 600; }
.att-danger { color: ${C.red}; font-weight: 700; }
.att-row { transition: background-color .15s ease, box-shadow .15s ease; }
.att-row:hover { background: ${C.surface}; box-shadow: inset 0 0 0 1px #e0e7f0; }
.att-code { font-size: 13px; background: ${C.surface}; padding: 2px 6px; border-radius: 4px;
  font-variant-numeric: tabular-nums; }
.att-expand { border: none; background: none; cursor: pointer; font-size: 12px; color: ${C.muted}; padding: 0; }
.att-detail-row td { border-bottom: 1px solid ${C.divider}; }
.att-detail { padding: 10px 14px; background: #fafbfd; font-size: 13px; color: #45566b; white-space: normal; }
.att-detail-block { margin-bottom: 4px; }
.att-detail-label { font-weight: 600; color: ${C.muted}; }

.att-muted { color: #9ca3af; font-size: 14px; padding: 8px 0; }
.att-error { color: ${C.red}; font-size: 14px; padding: 8px 0; }
.att-empty { color: ${C.muted}; font-size: 14px; padding: 20px; text-align: center;
  border: 1px dashed ${C.border}; border-radius: 10px; background: #fbfcfe; }

/* ---- modal ---- */
.att-backdrop { position: fixed; inset: 0; background: rgba(11,42,99,.45);
  backdrop-filter: blur(2px); display: flex; align-items: flex-start; justify-content: center;
  padding: 48px 16px; z-index: 1000; animation: attFade .15s ease; }
@keyframes attFade { from { opacity: 0; } to { opacity: 1; } }
.att-modal { background: #fff; border-radius: 14px; width: 100%; max-width: 560px;
  max-height: 86vh; overflow-y: auto; padding: 22px; box-shadow: 0 24px 60px rgba(11,23,42,.28);
  animation: attPop .18s cubic-bezier(.2,.8,.2,1); }
@keyframes attPop { from { transform: translateY(8px); opacity: .6; } to { transform: translateY(0); opacity: 1; } }
.att-modal-head { display: flex; align-items: flex-start; justify-content: space-between;
  gap: 12px; margin-bottom: 16px; }
.att-modal-title { margin: 0; font-size: 20px; font-weight: 700; color: ${C.ink}; letter-spacing: -0.01em; }
.att-close { border: none; background: #eef1f6; color: ${C.muted}; width: 30px; height: 30px;
  border-radius: 8px; cursor: pointer; font-size: 15px; line-height: 1; transition: all .2s ease; }
.att-close:hover { background: #e3e7ef; color: ${C.ink}; }

.att-cal-nav { display: flex; align-items: center; justify-content: space-between; margin-bottom: 12px; }
.att-cal-title { font-size: 15px; font-weight: 700; color: ${C.ink}; }
.att-nav-btn { width: 32px; height: 32px; border-radius: 8px; border: 1px solid ${C.border};
  background: #fff; color: ${C.ink}; font-size: 18px; line-height: 1; cursor: pointer; transition: all .15s ease; }
.att-nav-btn:hover:not(:disabled) { background: ${C.surface}; border-color: ${C.primary}; color: ${C.primary}; }
.att-nav-btn:disabled { opacity: .4; cursor: not-allowed; }

.att-cal-grid { display: grid; grid-template-columns: repeat(7, 1fr); gap: 4px; }
.att-cal-weekhead { margin-bottom: 4px; }
.att-cal-wd { text-align: center; font-size: 10.5px; font-weight: 700; letter-spacing: .04em;
  text-transform: uppercase; color: ${C.muted}; padding: 4px 0; }
.att-cal-cell { position: relative; min-height: 44px; border-radius: 8px; display: flex;
  flex-direction: column; align-items: center; justify-content: center; font-size: 14px; color: ${C.ink}; }
.att-cal-empty { background: transparent; }
.att-cal-weekend { background: ${C.surface}; color: ${C.muted}; }
.att-cal-holiday { background: ${C.accentBg}; color: ${C.primary}; font-weight: 700; }
.att-cal-today { box-shadow: inset 0 0 0 2px ${C.primary}; }
.att-cal-day { line-height: 1; }
.att-cal-mark { position: absolute; bottom: 6px; width: 5px; height: 5px; border-radius: 50%; background: ${C.primary}; }

.att-legend { display: flex; gap: 16px; flex-wrap: wrap; margin: 14px 0; }
.att-legend-item { display: inline-flex; align-items: center; gap: 6px; font-size: 12px; color: ${C.muted}; }
.att-sw { width: 12px; height: 12px; border-radius: 4px; display: inline-block; }
.att-sw-holiday { background: ${C.accentBg}; border: 1px solid #d7def7; }
.att-sw-weekend { background: ${C.surface}; border: 1px solid ${C.border}; }
.att-sw-today { background: #fff; box-shadow: inset 0 0 0 2px ${C.primary}; }

.att-cal-list { border-top: 1px solid ${C.divider}; padding-top: 12px; }
.att-cal-list-head { font-size: 12px; font-weight: 700; text-transform: uppercase;
  letter-spacing: .05em; color: ${C.muted}; margin-bottom: 8px; }
.att-cal-list-sub { font-weight: 600; text-transform: none; letter-spacing: 0; }
.att-holiday-row { display: flex; align-items: center; gap: 12px; padding: 6px 2px; }
.att-date-badge { display: flex; flex-direction: column; align-items: center; justify-content: center;
  min-width: 46px; padding: 4px 0; border-radius: 8px; background: ${C.surface}; border: 1px solid ${C.border}; }
.att-date-day { font-size: 16px; font-weight: 700; color: ${C.ink}; line-height: 1.1; }
.att-date-wd { font-size: 10px; color: ${C.muted}; text-transform: uppercase; }
.att-holiday-name { font-size: 14px; color: ${C.ink}; }
`;