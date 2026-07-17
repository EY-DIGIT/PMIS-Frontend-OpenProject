import React, { useEffect, useMemo, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { useProject } from "../../store/project/projectsStore";
import { setPageContext, clearPageContext } from "../../utils/pageContext";
import { loadMilestonesForProject } from "../../api/milestoneConfigApi";
import { getToken } from "../../api/auth";
import { ENDPOINTS } from "../../api/endpoint";
import "../../styles/global.css";

const API_BASE = "http://10.1.131.199:8019"; // move to env / your api client

// ---------- design tokens ----------
const C = {
  primary: "#0b3c88",
  primaryDark: "#072a63",
  primarySoft: "#eaf0fb",
  accent: "#0e7aa6",
  ink: "#16202e",
  ink2: "#334155",
  muted: "#64748b",
  faint: "#94a3b8",
  border: "#e3e9f2",
  borderStrong: "#cbd5e1",
  surface: "#f6f9fc",
  surfaceAlt: "#eef3f9",
  divider: "#eef2f7",
  green: "#0f9d58",
  greenBg: "#e7f6ee",
  amber: "#c07d0a",
  amberBg: "#fdf4e3",
  red: "#d64545",
  redBg: "#fdecec",
  accentBg: "#eef2ff",
  white: "#ffffff",
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

const num = (v) => {
  const n = parseFloat(String(v ?? ""));
  return Number.isFinite(n) ? n : 0;
};

function isWeekdayName(name) {
  return WEEKDAY_NAMES.has(String(name ?? "").trim().toLowerCase());
}
function dayNum(s) {
  return Number(s.slice(8, 10));
}
function weekdayShort(s) {
  return WEEKDAY_SHORT[new Date(`${s}T00:00:00`).getDay()];
}

// Color/label for an attendance percentage — the scannability backbone.
function attTone(pct) {
  const n = num(pct);
  if (n >= 90) return { color: C.green, bg: C.greenBg, label: "Strong" };
  if (n >= 75) return { color: C.amber, bg: C.amberBg, label: "Watch" };
  return { color: C.red, bg: C.redBg, label: "At risk" };
}

// Maps a free-text status to a badge tone without assuming exact values.
function statusTone(status) {
  const s = String(status ?? "").toLowerCase();
  if (/(complete|closed|done|finished)/.test(s)) return { color: C.primary, bg: C.primarySoft };
  if (/(active|progress|ongoing|open|running|live)/.test(s)) return { color: C.green, bg: C.greenBg };
  if (/(hold|pending|await|delay|block|paused)/.test(s)) return { color: C.amber, bg: C.amberBg };
  if (/(cancel|reject|fail|closed lost)/.test(s)) return { color: C.red, bg: C.redBg };
  return { color: C.muted, bg: C.surfaceAlt };
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
  const navigate = useNavigate();
  const project = useProject(projectId);

  const [year, setYear] = useState(CURRENT_YEAR);
  const [selectedMonth, setSelectedMonth] = useState("all");
  const [quarter, setQuarter] = useState(CURRENT_QUARTER);

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
        if (active) setMilestonesError(err?.message || "Couldn't load milestones.");
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

  // Monthly summary — fetched per selected month. "All months" shows a prompt instead.
  useEffect(() => {
    if (!projectId) return;
    if (selectedMonth === "all") {
      setSummary(null);
      setSummaryError(null);
      setSummaryLoading(false);
      return;
    }
    let active = true;
    const controller = new AbortController();
    (async () => {
      setSummaryLoading(true);
      setSummaryError(null);
      try {
        const token = getToken();
        const res = await fetch(
          `${API_BASE}/api/attendance/report/monthly?projectId=${projectId}&year=${year}&month=${selectedMonth}`,
          { signal: controller.signal, headers: token ? { Authorization: `Bearer ${token}` } : {} }
        );
        if (!res.ok) throw new Error(`Request failed (${res.status})`);
        const data = await res.json();
        if (active) setSummary(data);
      } catch (err) {
        if (active && err.name !== "AbortError")
          setSummaryError(err.message || "Couldn't load the attendance summary.");
      } finally {
        if (active) setSummaryLoading(false);
      }
    })();
    return () => { active = false; controller.abort(); };
  }, [projectId, year, selectedMonth]);

  // Quarterly leave policy
  useEffect(() => {
    if (!projectId) return;
    let active = true;
    const controller = new AbortController();
    (async () => {
      setQuarterlyLoading(true);
      setQuarterlyError(null);
      try {
        const token = getToken();
        const res = await fetch(
          `${API_BASE}/api/attendance/report/quarterly?projectId=${projectId}&year=${year}&quarter=${quarter}`,
          { signal: controller.signal, headers: token ? { Authorization: `Bearer ${token}` } : {} }
        );
        if (!res.ok) throw new Error(`Request failed (${res.status})`);
        const data = await res.json();
        if (active) setQuarterly(data);
      } catch (err) {
        if (active && err.name !== "AbortError")
          setQuarterlyError(err.message || "Couldn't load quarterly leave.");
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
        const token = getToken();
        const [hRes, cRes] = await Promise.all([
          fetch(`${API_BASE}/api/holidays/${year}?month=all`, { signal: controller.signal , headers: token ? { Authorization: `Bearer ${token}` } : {}}),
          fetch(`${API_BASE}/api/calendar/${year}?month=all`, { signal: controller.signal , headers: token ? { Authorization: `Bearer ${token}` } : {}}),
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
          setHolidayError(err.message || "Couldn't load holidays.");
      } finally {
        if (active) setHolidayLoading(false);
      }
    })();
    return () => { active = false; controller.abort(); };
  }, [holidayOpen, year]);

  // Row click → open the full-page leave detail (year + quarter in the URL).
  const goLeaveDetail = (emp, quarterNum) =>
    navigate(
      `/projects/${encodeURIComponent(projectId)}/attendance/leave/${encodeURIComponent(emp.attendanceId)}?year=${year}&quarter=${quarterNum}`
    );

  const employees = Array.isArray(summary) ? summary : [];
  const period =
    employees[0]?.period ||
    (selectedMonth !== "all" ? `${MONTH_NAMES[Number(selectedMonth)]} ${year}` : "");

  // At-a-glance metrics for the selected month.
  const metrics = useMemo(() => {
    if (!employees.length) return null;
    const n = employees.length;
    const avg = employees.reduce((s, e) => s + num(e.attendancePercentage), 0) / n;
    const present = employees.reduce((s, e) => s + num(e.presentDays), 0);
    const leave = employees.reduce((s, e) => s + num(e.leaveDays), 0);
    const absent = employees.reduce((s, e) => s + num(e.absentDays), 0);
    return { n, avg, present, leave, absent };
  }, [employees]);

  return (
    <div className="uidai-pmis-content att-page">
      <style>{ATT_CSS}</style>

      {/* Header */}
      <header className="att-head">
        <div className="att-eyebrow">{project?.projectName || "Project"}</div>
        <h1 className="uidai-pmis-title att-title">Attendance</h1>
        <p className="uidai-pmis-subtitle att-subtitle">
          Monthly attendance, quarterly leave and the holiday calendar for your project team.
        </p>
      </header>

      {/* Resource-based milestones — Leave Management */}
      <section className="att-section">
        <h2 className="att-section-title">Resource-based milestones</h2>

        {milestonesLoading && <SkeletonTable rows={3} cols={6} />}
        {milestonesError && <div className="att-error">{milestonesError}</div>}
        {!milestonesLoading && !milestonesError && resourceMilestones.length === 0 && (
          <EmptyState
            title="No resource-based milestones"
            hint="Milestones marked as resource-based will appear here, ready for attendance uploads."
          />
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
                      <td className="att-td att-dim">{m.startDate || "—"}</td>
                      <td className="att-td att-dim">{m.endDate || "—"}</td>
                      <td className="att-td"><StatusBadge status={m.status} /></td>
                      <td className="att-td att-num">
                        <button
                          className="att-btn-primary"
                          onClick={() => setLeaveMilestone(m)}
                          disabled={!m.apiId}
                          title={
                            m.apiId
                              ? "Upload attendance for this milestone"
                              : "Save the milestone before uploading attendance"
                          }
                        >
                          <UploadIcon />
                          Upload Attendence
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
              {MONTH_NAMES.slice(1).map((name, i) => (
                <option key={i + 1} value={i + 1}>{name}</option>
              ))}
            </select>
          </Field>
        </div>
        <button className="att-btn-secondary" onClick={() => setHolidayOpen(true)}>
          <CalendarIcon />
          Holiday calendar
        </button>
      </div>

      {/* Monthly summary */}
      <section className="att-section">
        <h2 className="att-section-title">Monthly summary</h2>

        {selectedMonth === "all" && (
          <EmptyState
            icon={<CalendarIcon />}
            title="Choose a month to begin"
            hint="Pick a month above and the team's attendance summary loads here."
          />
        )}
        {selectedMonth !== "all" && summaryLoading && <SkeletonTable rows={5} cols={7} withMetrics />}
        {selectedMonth !== "all" && summaryError && <div className="att-error">{summaryError}</div>}
        {selectedMonth !== "all" && !summaryLoading && !summaryError && employees.length === 0 && (
          <EmptyState
            icon={<CalendarIcon />}
            title="Nothing recorded yet"
            hint={`No attendance has been logged for ${MONTH_NAMES[Number(selectedMonth)]} ${year}.`}
          />
        )}
        {selectedMonth !== "all" && !summaryLoading && !summaryError && employees.length > 0 && (
          <>
            {metrics && (
              <div className="att-metrics">
                <StatCard label="Team size" value={metrics.n} sub={metrics.n === 1 ? "employee" : "employees"} />
                <StatCard
                  label="Avg attendance"
                  value={`${metrics.avg.toFixed(1)}%`}
                  sub={`${attTone(metrics.avg).label} overall`}
                  tone={attTone(metrics.avg).color}
                />
                <StatCard label="Present" value={metrics.present} sub="days across team" />
                <StatCard label="On leave" value={metrics.leave} sub="days taken" />
                <StatCard
                  label="Absent"
                  value={metrics.absent}
                  sub="days"
                  tone={metrics.absent > 0 ? C.red : undefined}
                />
              </div>
            )}
            <AttendanceTable
              period={period}
              employees={employees}
              onRowClick={(emp) => goLeaveDetail(emp, Math.ceil(Number(selectedMonth) / 3))}
            />
          </>
        )}
      </section>

      {/* Quarterly leave */}
      <section className="att-section">
        <div className="att-section-head">
          <h2 className="att-section-title" style={{ margin: 0 }}>Quarterly Attendance</h2>
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
        {quarterlyLoading && <SkeletonTable rows={5} cols={7} />}
        {quarterlyError && <div className="att-error">{quarterlyError}</div>}
        {!quarterlyLoading && !quarterlyError && (
          <QuarterlyPanel
            data={Array.isArray(quarterly) ? quarterly : []}
            quarter={quarter}
            year={year}
            onRowClick={(emp) => goLeaveDetail(emp, quarter)}
          />
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
   Shared attendance table — used by both monthly and quarterly views.
   ===================================================================== */
function AttendanceTable({ period, employees, onRowClick }) {
  const clickable = typeof onRowClick === "function";
  return (
    <div className="uidai-pmis-card att-card">
      <div className="att-card-head">
        <strong className="att-card-title">{period}</strong>
        <div className="att-chips">
          <Chip>{employees.length} {employees.length === 1 ? "employee" : "employees"}</Chip>
          {clickable && <span className="att-hint-inline">Click a row for full leave detail</span>}
        </div>
      </div>
      <div className="att-table-wrap">
        <table className="att-table">
          <thead>
            <tr>
              <th className="att-th">ID</th>
              <th className="att-th">Name</th>
              <th className="att-th att-num">Working</th>
              <th className="att-th att-num">Present</th>
              <th className="att-th att-num">Half</th>
              <th className="att-th att-num">Leave Taken</th>
              <th className="att-th att-num">Absent</th>
              <th className="att-th att-num">Week off</th>
              <th className="att-th att-num">Holiday</th>
              <th className="att-th att-num">WFH</th>
              <th className="att-th att-num att-th-att">Attendance</th>
            </tr>
          </thead>
          <tbody>
            {employees.map((emp) => (
              <tr
                className={`att-row${clickable ? " att-row-click" : ""}`}
                key={emp.attendanceId}
                onClick={clickable ? () => onRowClick(emp) : undefined}
                title={clickable ? "View leave detail" : undefined}
              >
                <td className="att-td"><code className="att-code">{emp.attendanceId}</code></td>
                <td className="att-td att-strong">{emp.employeeName}</td>
                <td className="att-td att-num att-dim">{emp.workingDays}</td>
                <td className="att-td att-num">{emp.presentDays}</td>
                <td className="att-td att-num att-dim">{emp.halfDays}</td>
                <td className="att-td att-num">{emp.leaveDays}</td>
                <td className={`att-td att-num${num(emp.absentDays) > 0 ? " att-danger" : " att-dim"}`}>
                  {emp.absentDays}
                </td>
                <td className="att-td att-num att-dim">{emp.weekOffDays}</td>
                <td className="att-td att-num att-dim">{emp.holidayDays}</td>
                <td className="att-td att-num att-dim">{emp.wfhDays}</td>
                <td className="att-td att-num att-att-cell">
                  <AttendanceBar value={emp.attendancePercentage} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/* =====================================================================
   Quarterly leave panel
   ===================================================================== */
function QuarterlyPanel({ data, quarter, year, onRowClick }) {
  const employees = data ?? [];
  const period = employees[0]?.period || `Q${quarter} ${year}`;

  if (employees.length === 0) {
    return (
      <EmptyState
        icon={<CalendarIcon />}
        title="No leave this quarter"
        hint={`Nothing has been logged for Q${quarter} ${year} yet.`}
      />
    );
  }
  return <AttendanceTable period={period} employees={employees} onRowClick={onRowClick} />;
}

/* =====================================================================
   Leave Management — per-milestone attendance Excel upload.
   POST /api/attendance/upload with projectId, milestoneId, dates + file.
   ===================================================================== */
function LeaveUploadModal({ projectId, milestone, onClose }) {
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [rateYear, setRateYear] = useState("");
  const [rateYears, setRateYears] = useState([]);
  const [file, setFile] = useState(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState(null);
  const [done, setDone] = useState(false);
  // Holds the actual message returned by the API so the popup reflects
  // what the backend reported, rather than a hardcoded string.
  const [responseMessage, setResponseMessage] = useState("");

  // Fetch rate-year options from the resources service.
  useEffect(() => {
    if (!projectId) return;
    let active = true;
    (async () => {
      try {
        const token = getToken();
        const res = await fetch(
          `${API_BASE}${ENDPOINTS.resources.rateCards(projectId)}`,
          token ? { headers: { Authorization: `Bearer ${token}` } } : undefined
        );
        if (res.ok) {
          const data = await res.json();
          if (active && Array.isArray(data)) setRateYears(data);
        }
      } catch {
        // non-fatal — dropdown stays empty
      }
    })();
    return () => { active = false; };
  }, [projectId]);

  useModalChrome(onClose);

  // Reads the response body once, tolerating JSON or plain text.
  // Returns { raw, data } — data is the parsed JSON, or null if it wasn't JSON.
  const parseResponseBody = async (res) => {
    const raw = await res.text();
    if (!raw) return { raw: "", data: null };
    try {
      return { raw, data: JSON.parse(raw) };
    } catch {
      return { raw, data: null };
    }
  };

  // The API's validation errors array sometimes lists resource IDs that
  // simply belong to a different project ("Resource X does not exist.").
  // Surface that as one clear, actionable line instead of a raw ID dump.
  // Any other error shape falls through to the API's own message/error text.
  const buildErrorMessage = (data, raw, status) => {
    const validationErrors = Array.isArray(data?.errors) ? data.errors : null;
    const isResourceMismatch =
      validationErrors?.length > 0 &&
      validationErrors.every((e) => /does not exist/i.test(String(e)));

    if (isResourceMismatch) {
      return "These resources belong to another project. Please upload the correct attendance file.";
    }
    return data?.message || data?.error || raw || `Upload failed (${status})`;
  };

  const upload = async () => {
    setError(null);
    if (!file) { setError("Choose an Excel file to upload."); return; }
    if (!startDate || !endDate) { setError("Set both a start and end date."); return; }
    if (endDate < startDate) { setError("End date can't be earlier than the start date."); return; }
    if (!milestone?.apiId) { setError("This milestone couldn't be identified."); return; }
    if (!projectId) { setError("This project couldn't be identified."); return; }

    const body = new FormData();
    body.append("file", file);
    const params = new URLSearchParams({
      projectId,
      milestoneId: milestone.apiId,
      startDate: String(startDate),
      endDate: String(endDate),
    });
    // rateYear is optional — the dropdown values are "Year-1" etc; API wants the number.
    if (rateYear) {
      params.set("rateYear", rateYear);
    }

    try {
      setUploading(true);
      const token = getToken();
      const res = await fetch(`${API_BASE}/api/attendance/upload?${params.toString()}`, {
        method: "POST",
        headers: token ? { Authorization: `Bearer ${token}` } : {},
        body,
      });

      const { raw, data } = await parseResponseBody(res);

      if (!res.ok) {
        throw new Error(buildErrorMessage(data, raw, res.status));
      }

      setResponseMessage(data?.message || raw || "Attendance uploaded successfully.");
      setDone(true);
    } catch (err) {
      setError(err?.message || "The upload didn't go through. Try again.");
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className="att-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="att-modal" role="dialog" aria-modal="true" aria-label="Leave Management" style={{ maxWidth: 540 }}>
        <div className="att-modal-head">
          <div>
            <div className="att-eyebrow" style={{ marginBottom: 4 }}>Leave Management</div>
            <h2 className="att-modal-title">Upload attendance</h2>
          </div>
          <button className="att-close" onClick={onClose} aria-label="Close">✕</button>
        </div>

        <div className="att-modal-sub">
          {milestone.serverDisplayCode || milestone.id ? (
            <><code className="att-code">{milestone.serverDisplayCode || milestone.id}</code>{" "}</>
          ) : null}
          {milestone.name}
        </div>

        {done ? (
          <>
            <div className="att-success">
              <CheckIcon />
              {responseMessage}
            </div>
            <div className="att-modal-actions">
              <button className="att-btn-primary" onClick={onClose}>Done</button>
            </div>
          </>
        ) : (
          <>
            <div className="att-controls" style={{ marginBottom: 14 }}>
              <Field label="Start date">
                <input
                  type="date"
                  className="att-select"
                  value={startDate}
                  onChange={(e) => setStartDate(e.target.value)}
                />
              </Field>
              <Field label="End date">
                <input
                  type="date"
                  className="att-select"
                  value={endDate}
                  min={startDate || undefined}
                  onChange={(e) => setEndDate(e.target.value)}
                />
              </Field>
              <Field label="Rate year (optional)">
                <select className="att-select" value={rateYear} onChange={(e) => setRateYear(e.target.value)}>
                  <option value="">None</option>
                  {rateYears.map((y) => <option key={y} value={y}>{y}</option>)}
                </select>
              </Field>
            </div>

            <Field label="Attendance file">
              <label className="att-file">
                <input
                  type="file"
                  accept=".xlsx,.xls"
                  onChange={(e) => setFile(e.target.files?.[0] || null)}
                />
                <span className="att-file-btn"><UploadIcon />Choose file</span>
                <span className="att-file-name">{file ? file.name : "No file selected — .xlsx or .xls"}</span>
              </label>
            </Field>

            {error && <div className="att-error">{error}</div>}

            <div className="att-modal-actions">
              <button className="att-btn-secondary" onClick={onClose} disabled={uploading}>Cancel</button>
              <button className="att-btn-primary" onClick={upload} disabled={uploading}>
                {uploading ? "Uploading…" : "Upload attendance"}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
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

  useModalChrome(onClose);

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

function StatCard({ label, value, sub, tone }) {
  return (
    <div className="att-metric" style={tone ? { borderTopColor: tone } : undefined}>
      <div className="att-metric-label">{label}</div>
      <div className="att-metric-value" style={tone ? { color: tone } : undefined}>{value}</div>
      {sub != null && <div className="att-metric-sub">{sub}</div>}
    </div>
  );
}

// The signature element: attendance % rendered as a scannable strength meter.
function AttendanceBar({ value }) {
  const n = num(value);
  const t = attTone(n);
  const w = Math.max(0, Math.min(100, n));
  return (
    <div className="att-bar" title={`${n}% attendance · ${t.label}`}>
      <span className="att-bar-track">
        <span className="att-bar-fill" style={{ width: `${w}%`, background: t.color }} />
      </span>
      <span className="att-bar-val" style={{ color: t.color }}>{n}%</span>
    </div>
  );
}

function StatusBadge({ status }) {
  if (!status) return <span className="att-muted" style={{ padding: 0 }}>—</span>;
  const t = statusTone(status);
  return <span className="att-badge" style={{ color: t.color, background: t.bg }}>{status}</span>;
}

function EmptyState({ icon, title, hint }) {
  return (
    <div className="att-empty">
      {icon && <div className="att-empty-icon">{icon}</div>}
      <div className="att-empty-title">{title}</div>
      {hint && <div className="att-empty-hint">{hint}</div>}
    </div>
  );
}

function SkeletonTable({ rows = 4, cols = 6, withMetrics = false }) {
  return (
    <>
      {withMetrics && (
        <div className="att-metrics">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="att-metric">
              <div className="att-skel att-skel-line" style={{ width: "60%", height: 10 }} />
              <div className="att-skel att-skel-line" style={{ width: "45%", height: 22, marginTop: 10 }} />
            </div>
          ))}
        </div>
      )}
      <div className="uidai-pmis-card att-card">
        <div className="att-skel att-skel-line" style={{ width: 160, height: 14, marginBottom: 18 }} />
        {Array.from({ length: rows }).map((_, r) => (
          <div key={r} className="att-skel-row">
            {Array.from({ length: cols }).map((_, c) => (
              <div key={c} className="att-skel att-skel-line" style={{ flex: c === 1 ? 2.4 : 1 }} />
            ))}
          </div>
        ))}
      </div>
    </>
  );
}

/* ---------- shared modal behaviour (esc to close + scroll lock) ---------- */
function useModalChrome(onClose) {
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
function UploadIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M12 15V4m0 0-4 4m4-4 4 4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M4 15v3.5A1.5 1.5 0 0 0 5.5 20h13a1.5 1.5 0 0 0 1.5-1.5V15" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}
function CheckIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="1.8" />
      <path d="m8.5 12 2.5 2.5 4.5-5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/* ---------- scoped styles ---------- */
const ATT_CSS = `
.att-page { padding: 30px 10px 72px; max-width: 1320px; margin: 0 auto; color: ${C.ink}; }
@media (max-width: 640px) { .att-page { padding: 20px 16px 48px; } }

.att-page :focus-visible { outline: 2px solid ${C.primary}; outline-offset: 2px; border-radius: 6px; }

.att-head { margin-bottom: 26px; }
.att-title { margin: 0 0 6px; letter-spacing: -0.02em; }
.att-subtitle { margin: 0; color: ${C.muted}; max-width: 640px; }

.att-eyebrow { font-size: 12px; font-weight: 700; letter-spacing: 0.08em;
  text-transform: uppercase; color: ${C.primary}; margin-bottom: 8px; }

.att-section { margin-bottom: 30px; }
.att-section-title { font-size: 15px; font-weight: 700; color: ${C.ink}; margin: 0 0 14px; letter-spacing: -0.01em; }
.att-section-head { display: flex; align-items: flex-end; justify-content: space-between;
  gap: 16px; margin-bottom: 14px; flex-wrap: wrap; }

/* ---- toolbar / controls ---- */
.att-toolbar { display: flex; align-items: flex-end; justify-content: space-between;
  gap: 16px; margin-bottom: 24px; flex-wrap: wrap; }
.att-controls { display: flex; gap: 12px; flex-wrap: wrap; }
.att-field { display: flex; flex-direction: column; gap: 6px; }
.att-field-label { font-size: 11.5px; font-weight: 700; letter-spacing: 0.05em;
  text-transform: uppercase; color: ${C.muted}; }
.att-select { padding: 9px 12px; border-radius: 10px; border: 1px solid ${C.border};
  background: #fff; color: ${C.ink}; font-size: 14px; font-family: inherit; min-width: 150px;
  outline: none; cursor: pointer; transition: border-color .15s ease, box-shadow .15s ease;
  box-shadow: 0 1px 2px rgba(16,32,60,.04); }
.att-select:hover { border-color: ${C.borderStrong}; }
.att-select:focus { border-color: ${C.primary}; box-shadow: 0 0 0 3px ${C.accentBg}; }

.att-btn-secondary { display: inline-flex; align-items: center; gap: 8px;
  border-radius: 10px; font-size: 14px; font-weight: 600; padding: 10px 16px; height: 40px;
  cursor: pointer; border: 1px solid ${C.border}; background: #fff; color: ${C.ink2};
  transition: background .18s ease, border-color .18s ease, color .18s ease; box-shadow: 0 1px 2px rgba(16,32,60,.04); }
.att-btn-secondary:hover:not(:disabled) { background: ${C.surface}; border-color: ${C.primary}; color: ${C.primary}; }
.att-btn-secondary:disabled { opacity: .5; cursor: not-allowed; }

.att-btn-primary { display: inline-flex; align-items: center; gap: 8px; border: none;
  border-radius: 10px; font-size: 14px; font-weight: 600; padding: 9px 15px; cursor: pointer;
  color: #fff; background: linear-gradient(100deg, ${C.primary}, ${C.accent});
  transition: filter .18s ease, transform .06s ease, box-shadow .18s ease;
  box-shadow: 0 2px 6px rgba(11,60,136,.22); white-space: nowrap; }
.att-btn-primary:hover:not(:disabled) { filter: brightness(1.05); box-shadow: 0 4px 12px rgba(11,60,136,.28); }
.att-btn-primary:active:not(:disabled) { transform: translateY(1px); }
.att-btn-primary:disabled { opacity: .45; cursor: not-allowed; box-shadow: none; }

/* ---- metric cards ---- */
.att-metrics { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
  gap: 12px; margin-bottom: 18px; }
.att-metric { background: #fff; border: 1px solid ${C.border}; border-top: 3px solid ${C.borderStrong};
  border-radius: 12px; padding: 15px 16px 16px; box-shadow: 0 1px 2px rgba(16,32,60,.04); }
.att-metric-label { font-size: 11px; font-weight: 700; letter-spacing: .06em;
  text-transform: uppercase; color: ${C.muted}; }
.att-metric-value { font-size: 27px; font-weight: 800; color: ${C.ink}; line-height: 1.05;
  margin-top: 8px; letter-spacing: -.02em; font-variant-numeric: tabular-nums; }
.att-metric-sub { font-size: 12px; color: ${C.faint}; margin-top: 4px; }

/* ---- cards / tables ---- */
.att-card { padding: 6px 6px 2px; margin-bottom: 4px; border: 1px solid ${C.border};
  border-radius: 14px; background: #fff; box-shadow: 0 1px 3px rgba(16,32,60,.05); overflow: hidden; }
.att-card-head { display: flex; align-items: center; justify-content: space-between;
  gap: 12px; padding: 14px 16px 12px; flex-wrap: wrap; }
.att-card-title { font-size: 15px; color: ${C.ink}; font-weight: 700; }

.att-chips { display: flex; gap: 6px; flex-wrap: wrap; align-items: center; }
.att-chip { font-size: 12px; background: ${C.surface}; color: ${C.ink2};
  padding: 3px 10px; border-radius: 999px; border: 1px solid ${C.border}; white-space: pre-line; }
.att-chip-accent { background: ${C.accentBg}; color: ${C.primary}; border-color: #d7def7; font-weight: 600; }
.att-hint-inline { font-size: 12px; color: ${C.faint}; }

.att-table-wrap { overflow-x: auto; }
.att-table { width: 100%; border-collapse: collapse; font-size: 14px; }
.att-th { background: ${C.surface}; color: ${C.muted}; text-align: left; font-size: 11px;
  font-weight: 700; letter-spacing: 0.05em; text-transform: uppercase; padding: 11px 14px;
  border-bottom: 1px solid ${C.border}; white-space: nowrap; position: sticky; top: 0; z-index: 1; }
.att-th-att { min-width: 130px; }
.att-num { text-align: right; }
.att-td { padding: 12px 14px; vertical-align: middle; color: ${C.ink};
  border-bottom: 1px solid ${C.divider}; white-space: nowrap; }
.att-td.att-num { text-align: right; font-variant-numeric: tabular-nums; }
.att-dim { color: ${C.faint}; }
.att-strong { font-weight: 600; }
.att-danger { color: ${C.red}; font-weight: 700; }
.att-att-cell { padding-right: 16px; }
.att-row { transition: background-color .13s ease; }
.att-row:hover { background: ${C.surface}; }
.att-row:last-child .att-td { border-bottom: none; }
.att-row-click { cursor: pointer; }
.att-row-click:hover { background: ${C.accentBg}; }
.att-code { font-size: 13px; background: ${C.surface}; padding: 2px 7px; border-radius: 5px;
  border: 1px solid ${C.border}; font-variant-numeric: tabular-nums; }

/* attendance strength meter */
.att-bar { display: inline-flex; align-items: center; gap: 9px; justify-content: flex-end; }
.att-bar-track { width: 54px; height: 6px; border-radius: 999px; background: #e6ecf4; overflow: hidden; }
.att-bar-fill { display: block; height: 100%; border-radius: 999px; transition: width .45s cubic-bezier(.2,.8,.2,1); }
.att-bar-val { font-variant-numeric: tabular-nums; font-weight: 700; font-size: 13px; min-width: 40px; text-align: right; }

/* status badge */
.att-badge { display: inline-flex; align-items: center; font-size: 12px; font-weight: 600;
  padding: 3px 11px; border-radius: 999px; white-space: nowrap; text-transform: capitalize; }

/* states */
.att-muted { color: ${C.muted}; font-size: 14px; padding: 8px 0; }
.att-error { color: ${C.red}; font-size: 14px; padding: 12px 14px; background: ${C.redBg};
  border: 1px solid #f4cccc; border-radius: 10px; margin: 4px 0; }
.att-empty { display: flex; flex-direction: column; align-items: center; text-align: center;
  padding: 34px 20px; border: 1px dashed ${C.borderStrong}; border-radius: 14px; background: #fbfcfe; }
.att-empty-icon { display: inline-flex; align-items: center; justify-content: center;
  width: 44px; height: 44px; border-radius: 12px; background: ${C.accentBg}; color: ${C.primary}; margin-bottom: 12px; }
.att-empty-title { font-size: 15px; font-weight: 700; color: ${C.ink}; }
.att-empty-hint { font-size: 13px; color: ${C.muted}; margin-top: 5px; max-width: 380px; }

/* skeletons */
.att-skel { background: linear-gradient(90deg, ${C.surfaceAlt} 25%, #e3e9f1 37%, ${C.surfaceAlt} 63%);
  background-size: 400% 100%; animation: attShimmer 1.4s ease infinite; border-radius: 6px; }
.att-skel-line { height: 12px; }
.att-skel-row { display: flex; gap: 14px; padding: 13px 16px; border-top: 1px solid ${C.divider}; }
@keyframes attShimmer { 0% { background-position: 100% 0; } 100% { background-position: 0 0; } }

/* ---- modal ---- */
.att-backdrop { position: fixed; inset: 0; background: rgba(9,24,52,.46);
  backdrop-filter: blur(3px); display: flex; align-items: flex-start; justify-content: center;
  padding: 48px 16px; z-index: 1000; animation: attFade .15s ease; }
@keyframes attFade { from { opacity: 0; } to { opacity: 1; } }
.att-modal { background: #fff; border-radius: 16px; width: 100%; max-width: 560px;
  max-height: 86vh; overflow-y: auto; padding: 24px; box-shadow: 0 24px 64px rgba(9,20,42,.32);
  animation: attPop .18s cubic-bezier(.2,.8,.2,1); }
@keyframes attPop { from { transform: translateY(10px); opacity: .5; } to { transform: translateY(0); opacity: 1; } }
.att-modal-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; margin-bottom: 14px; }
.att-modal-title { margin: 0; font-size: 20px; font-weight: 700; color: ${C.ink}; letter-spacing: -0.01em; }
.att-modal-sub { color: ${C.muted}; font-size: 14px; margin-bottom: 16px; }
.att-modal-actions { display: flex; justify-content: flex-end; gap: 10px; margin-top: 22px; }
.att-close { border: none; background: ${C.surfaceAlt}; color: ${C.muted};
  width: 30px; height: 30px; border-radius: 8px; cursor: pointer; font-size: 15px; line-height: 1;
  transition: background .18s ease, color .18s ease; flex: 0 0 auto; }
.att-close:hover { background: #e0e6ef; color: ${C.ink}; }

.att-success { display: flex; align-items: center; gap: 10px; color: ${C.green}; font-weight: 600;
  padding: 14px 16px; background: ${C.greenBg}; border: 1px solid #bfe6cf; border-radius: 10px; margin: 6px 0; }

/* file input */
.att-file { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; }
.att-file input[type="file"] { display: none; }
.att-file-btn { display: inline-flex; align-items: center; gap: 7px; padding: 8px 14px;
  border-radius: 10px; border: 1px solid ${C.border}; background: #fff; color: ${C.ink2};
  font-size: 13px; font-weight: 600; cursor: pointer; transition: border-color .18s ease, color .18s ease; }
.att-file:hover .att-file-btn { border-color: ${C.primary}; color: ${C.primary}; }
.att-file-name { font-size: 13px; color: ${C.muted}; }

/* leave-detail key/value */
.att-kv-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(150px, 1fr));
  gap: 12px 20px; margin-bottom: 18px; padding: 15px 16px; background: ${C.surface};
  border-radius: 12px; border: 1px solid ${C.border}; }
.att-kv-grid-sm { grid-template-columns: repeat(auto-fill, minmax(140px, 1fr)); gap: 10px 16px; padding: 13px 14px; margin-bottom: 0; }
.att-kv-label { font-size: 10.5px; font-weight: 700; text-transform: uppercase; letter-spacing: .05em; color: ${C.muted}; margin-bottom: 3px; }
.att-kv-value { font-size: 14px; color: ${C.ink}; font-weight: 600; }
.att-kv-value-sm { font-size: 13px; font-weight: 500; }
.att-detail-section { margin-bottom: 16px; }
.att-detail-heading { font-size: 11.5px; font-weight: 700; text-transform: uppercase; letter-spacing: .05em; color: ${C.muted}; margin-bottom: 8px; }
.att-detail-count { font-weight: 400; text-transform: none; color: ${C.faint}; }
.att-detail-inline { font-size: 13px; color: ${C.ink}; line-height: 1.8; }

/* ---- holiday calendar ---- */
.att-cal-nav { display: flex; align-items: center; justify-content: space-between; margin-bottom: 12px; }
.att-cal-title { font-size: 15px; font-weight: 700; color: ${C.ink}; }
.att-nav-btn { width: 32px; height: 32px; border-radius: 8px; border: 1px solid ${C.border};
  background: #fff; color: ${C.ink}; font-size: 18px; line-height: 1; cursor: pointer; transition: background .15s ease, border-color .15s ease, color .15s ease; }
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

.att-cal-list { border-top: 1px solid ${C.divider}; padding-top: 12px; margin-top: 4px; }
.att-cal-list-head { font-size: 12px; font-weight: 700; text-transform: uppercase; letter-spacing: .05em; color: ${C.muted}; margin-bottom: 8px; }
.att-cal-list-sub { font-weight: 600; text-transform: none; letter-spacing: 0; }
.att-holiday-row { display: flex; align-items: center; gap: 12px; padding: 6px 2px; }
.att-date-badge { display: flex; flex-direction: column; align-items: center; justify-content: center;
  min-width: 46px; padding: 4px 0; border-radius: 8px; background: ${C.surface}; border: 1px solid ${C.border}; }
.att-date-day { font-size: 16px; font-weight: 700; color: ${C.ink}; line-height: 1.1; }
.att-date-wd { font-size: 10px; color: ${C.muted}; text-transform: uppercase; }
.att-holiday-name { font-size: 14px; color: ${C.ink}; }

@media (prefers-reduced-motion: reduce) {
  .att-skel { animation: none; }
  .att-bar-fill { transition: none; }
  .att-backdrop, .att-modal { animation: none; }
}
`;