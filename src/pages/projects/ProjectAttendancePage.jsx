import React, { useEffect, useMemo, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { useProject } from "../../store/project/projectsStore";
import { setPageContext, clearPageContext } from "../../utils/pageContext";
import { loadMilestonesForProject, loadActivitiesForMilestone } from "../../api/milestoneConfigApi";
import {
  readErrorMessage, readJsonBody, requestErrorMessage, messageFromBody, notifyActionError,
  parseYear, parseQuarter, parseMonth, parseISODate, daysBetween, MIN_YEAR, MAX_YEAR,
} from "../../utils/apiMessage";
import { getToken } from "../../api/auth";
import { API_BASE as GATEWAY_BASE, authorizedFetch, tokenStore } from "../../api/client";
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
/* The Quarterly Attendance section opens on Q1 rather than on whichever
   quarter today falls in. Fixed on purpose — swap back to CURRENT_QUARTER
   to have it follow the calendar again. */
const DEFAULT_QUARTER = 1;
const YEAR_OPTIONS = [CURRENT_YEAR, CURRENT_YEAR - 1, CURRENT_YEAR - 2];

// ---------- helpers ----------
const pad2 = (n) => String(n).padStart(2, "0");

const num = (v) => {
  const n = parseFloat(String(v ?? ""));
  return Number.isFinite(n) ? n : 0;
};

// The monthly/quarterly report endpoints return an envelope
// { period, resourceCount, totals, resources } — older builds returned a bare
// array, so both shapes are accepted here.
const reportRows = (payload) =>
  Array.isArray(payload) ? payload : Array.isArray(payload?.resources) ? payload.resources : [];

const reportTotals = (payload) =>
  !Array.isArray(payload) && payload?.totals ? payload.totals : null;

const money = (v) =>
  `₹${num(v).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/* Whole rupees, for the stat cards. A lakh-scale total at card font size is
   far wider than "11" or "89.6%", and the paise carry no meaning at that
   scale — the exact figure rides along as the card's tooltip. */
const moneyShort = (v) =>
  `₹${Math.round(num(v)).toLocaleString("en-IN", { maximumFractionDigits: 0 })}`;

/* Quarterly cost lands as a separate payload keyed the same way as the
   attendance report — { resources: [{ attendanceId, totalCost,
   relaxationAmount, monthlyBreakdown: [{ period, cost, ... }] }], totals }.
   Index it by attendanceId so the table can join a cost onto each row
   without caring about ordering (or about rows the cost API doesn't know). */
function indexCostByResource(payload) {
  const map = new Map();
  reportRows(payload).forEach((r) => {
    const id = r?.attendanceId;
    if (id == null) return;
    map.set(String(id), r);
  });
  return map;
}

// Prefer the API's own totals; fall back to summing rows for the array shape.
function buildMetrics(payload, employees) {
  if (!employees.length) return null;
  const t = reportTotals(payload);
  if (t) {
    return {
      n: num(t.resourceCount) || employees.length,
      avg: num(t.avgAttendancePercentage),
      present: num(t.presentDays),
      paidLeave: t.paidLeaveDays == null ? null : num(t.paidLeaveDays),
      unpaidLeave: t.unpaidLeaveDays == null ? null : num(t.unpaidLeaveDays),
    };
  }
  const n = employees.length;
  return {
    n,
    avg: employees.reduce((s, e) => s + num(e.attendancePercentage), 0) / n,
    present: employees.reduce((s, e) => s + num(e.presentDays), 0),
    paidLeave: null,
    unpaidLeave: null,
  };
}

/* Total leave for a row. The report zeroes `leaveDays` and sends the real
   figure as `leaveTaken` (paid + unpaid). Older payloads have neither, so
   this walks down to whatever they do carry rather than printing a 0 that
   isn't true. */
const leaveTakenOf = (e) => {
  if (e?.leaveTaken != null) return num(e.leaveTaken);
  if (e?.paidLeaveDays != null || e?.unpaidLeaveDays != null) {
    return num(e.paidLeaveDays) + num(e.unpaidLeaveDays);
  }
  return num(e?.leaveDays);
};

/* Attendance sheets are small; anything this size is the wrong file. */
const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;
/* A single upload covers a month or a quarter — a longer span means the
   dates were mistyped (a wrong year is the usual culprit). */
const MAX_RANGE_DAYS = 366;

const fmtBytes = (n) => {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
};

/* GET /api/export/template/attendance — a blank sheet covering the range.
   Binary .xlsx, so it's read as a blob and saved via <a download>. Shared by
   the page header and the upload modal; both need the identical request and
   the identical failure handling, so it lives here rather than in either.
   Returns the saved filename; throws with a showable message on failure. */
async function downloadAttendanceTemplate(startDate, endDate) {
  const DL_FALLBACK = "Couldn't download the template. Please try again.";
  const token = getToken();
  const res = await fetch(
    `${API_BASE}${ENDPOINTS.resources.attendanceTemplate(startDate, endDate)}`,
    { headers: { accept: "*/*", ...(token ? { Authorization: `Bearer ${token}` } : {}) } }
  );

  // An error body is text/JSON, not a spreadsheet, and must not be shown raw.
  if (!res.ok) throw new Error(await readErrorMessage(res, DL_FALLBACK));

  const blob = await res.blob();
  // A 200 with an empty body would save a 0-byte file that Excel refuses to
  // open — clearer to report it than to hand over a broken download.
  if (!blob.size) throw new Error("The server returned an empty template file.");

  const disposition = res.headers.get("content-disposition") || "";
  const match = /filename\*?=(?:UTF-8'')?"?([^";]+)"?/i.exec(disposition);
  // Cross-origin JS can't read Content-Disposition unless the backend exposes
  // it, so this usually falls back to our own naming.
  const filename = match
    ? decodeURIComponent(match[1].trim())
    : `attendance_template_${startDate}_${endDate}.xlsx`;

  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
  return filename;
}

/* Last day of a month, as a YYYY-MM-DD string. Day 0 of the NEXT month is
   the last of this one, which sidesteps leap-year special-casing. */
function lastDayOfMonth(year, month) {
  return `${year}-${pad2(month)}-${pad2(new Date(year, month, 0).getDate())}`;
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

// Color/label for an attendance percentage — the scannability backbone.
function attTone(pct) {
  const n = num(pct);
  if (n >= 90) return { color: C.green, bg: C.greenBg, label: "Strong" };
  if (n >= 75) return { color: C.amber, bg: C.amberBg, label: "Watch" };
  return { color: C.red, bg: C.redBg, label: "At risk" };
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

/* Tooltip for the table's Holiday column: the count is in the cell, this says
   which days it counted. Only `named` entries — the unnamed ones are weekday
   artifacts of the API's own list, and the Holidays modal ignores them too.
   Returns undefined when there's nothing to say, so the cell gets no title
   rather than an empty one. */
function buildHolidayTitle(holidays, range) {
  if (!holidays?.length || !range) return undefined;
  const inRange = holidays.filter(
    (h) => h.named && h.date >= range.start && h.date <= range.end
  );
  if (!inRange.length) return undefined;
  const lines = inRange.map(
    (h) => `${dayNum(h.date)} ${MONTH_NAMES[Number(h.date.slice(5, 7))]} (${weekdayShort(h.date)}) — ${h.name}`
  );
  /* Deliberately "Holidays in <period>" and not "these are your N holidays":
     a holiday landing on a week-off is in this list but not in the cell's
     count, and the wording mustn't promise the two always match. */
  return [`Holidays in ${range.label}:`, ...lines].join("\n");
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
  const [quarter, setQuarter] = useState(DEFAULT_QUARTER);

  const [summary, setSummary] = useState(null);
  const [summaryLoading, setSummaryLoading] = useState(false);
  const [summaryError, setSummaryError] = useState(null);

  const [quarterly, setQuarterly] = useState(null);
  const [quarterlyLoading, setQuarterlyLoading] = useState(false);
  const [quarterlyError, setQuarterlyError] = useState(null);

  /* Quarterly cost is a second, independent call. It's supporting detail on
     top of the attendance report, so a failure here only drops the Cost
     column — the attendance table still renders. */
  const [quarterlyCost, setQuarterlyCost] = useState(null);
  const [quarterlyCostError, setQuarterlyCostError] = useState(null);

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
  // Attendance upload modal — the milestone is picked inside it.
  const [uploadOpen, setUploadOpen] = useState(false);

  /* Header template download. The endpoint is built for a date range, and the
     header has no dates of its own, so the range comes from the Year + Month
     controls right below it: a chosen month covers that month, "All months"
     covers the whole year. The exact range is spelled out in the button's
     tooltip so it's never a guess. */
  const [templateBusy, setTemplateBusy] = useState(false);
  const [templateMsg, setTemplateMsg] = useState(null);
  const [templateError, setTemplateError] = useState(null);

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

  // Only milestones saved on the server (apiId present) can receive an upload.
  const uploadableMilestones = useMemo(
    () => resourceMilestones.filter((m) => m.apiId),
    [resourceMilestones]
  );

  /* The report rows now carry the milestoneId whose Excel produced them.
     Resolve it against the milestone list this page already loads, so the
     table can name the source instead of printing a UUID. Built from the
     full list rather than `uploadableMilestones` — a milestone that has
     since been closed or un-flagged as resource-based still has rows that
     came from it, and those should stay named. */
  const milestoneNameById = useMemo(() => {
    const map = new Map();
    milestones.forEach((m) => {
      if (m.apiId) map.set(String(m.apiId), m.name || "");
    });
    return map;
  }, [milestones]);
  const milestoneName = (id) => milestoneNameById.get(String(id)) || "";

  /* Year, month and quarter drive three API calls, so they're checked before
     a request is built rather than after the backend rejects one. They come
     from selects today, but a stale bookmark or a future URL-driven filter
     would put anything here — and "(400)" tells the user nothing. */
  const paramError = useMemo(() => {
    if (!projectId) return "No project was specified in the link.";
    if (parseYear(year) === null) return `"${year}" isn't a valid year (${MIN_YEAR}–${MAX_YEAR}).`;
    if (selectedMonth !== "all" && parseMonth(selectedMonth) === null) {
      return `"${selectedMonth}" isn't a valid month.`;
    }
    if (parseQuarter(quarter) === null) return `"${quarter}" isn't a valid quarter — it must be 1 to 4.`;
    return "";
  }, [projectId, year, selectedMonth, quarter]);

  // Monthly summary — fetched per selected month. "All months" shows a prompt instead.
  useEffect(() => {
    if (paramError) { setSummaryLoading(false); return undefined; }
    if (selectedMonth === "all") {
      setSummary(null);
      setSummaryError(null);
      setSummaryLoading(false);
      return undefined;
    }
    const FALLBACK = "Couldn't load the attendance summary.";
    let active = true;
    const controller = new AbortController();
    (async () => {
      setSummaryLoading(true);
      setSummaryError(null);
      try {
        const token = getToken();
        const qs = new URLSearchParams({
          projectId,
          year: String(parseYear(year)),
          month: String(parseMonth(selectedMonth)),
        });
        const res = await fetch(
          `${API_BASE}/api/attendance/report/monthly?${qs}`,
          { signal: controller.signal, headers: token ? { Authorization: `Bearer ${token}` } : {} }
        );
        if (!res.ok) throw new Error(await readErrorMessage(res, FALLBACK));
        // An empty 200 is a month with nothing logged, not a failure.
        const data = await readJsonBody(res, FALLBACK);
        if (active) setSummary(data);
      } catch (err) {
        const msg = requestErrorMessage(err, FALLBACK);
        if (active && msg) setSummaryError(msg);
      } finally {
        if (active) setSummaryLoading(false);
      }
    })();
    return () => { active = false; controller.abort(); };
  }, [projectId, year, selectedMonth, paramError]);

  // Quarterly leave policy
  useEffect(() => {
    if (paramError) { setQuarterlyLoading(false); return undefined; }
    const FALLBACK = "Couldn't load the quarterly attendance.";
    let active = true;
    const controller = new AbortController();
    (async () => {
      setQuarterlyLoading(true);
      setQuarterlyError(null);
      try {
        const token = getToken();
        const qs = new URLSearchParams({
          projectId,
          year: String(parseYear(year)),
          quarter: String(parseQuarter(quarter)),
        });
        const res = await fetch(
          `${API_BASE}/api/attendance/report/quarterly?${qs}`,
          { signal: controller.signal, headers: token ? { Authorization: `Bearer ${token}` } : {} }
        );
        if (!res.ok) throw new Error(await readErrorMessage(res, FALLBACK));
        const data = await readJsonBody(res, FALLBACK);
        if (active) setQuarterly(data);
      } catch (err) {
        const msg = requestErrorMessage(err, FALLBACK);
        if (active && msg) setQuarterlyError(msg);
      } finally {
        if (active) setQuarterlyLoading(false);
      }
    })();
    return () => { active = false; controller.abort(); };
  }, [projectId, year, quarter, paramError]);

  /* Quarterly cost — per-resource ₹ for the same quarter, joined onto the
     attendance rows by attendanceId. `resourceId` is optional on this
     endpoint and is deliberately omitted: the table shows the whole team, so
     one call covers every row (pass it only when scoping to one resource).
     Errors are kept out of the main error slot — the Cost column just
     doesn't render. */
  useEffect(() => {
    if (paramError) return undefined;
    const FALLBACK = "Couldn't load the quarterly cost.";
    let active = true;
    const controller = new AbortController();
    (async () => {
      setQuarterlyCostError(null);
      try {
        const token = getToken();
        const qs = new URLSearchParams({
          projectId,
          year: String(parseYear(year)),
          quarter: String(parseQuarter(quarter)),
        });
        const res = await fetch(
          `${API_BASE}/api/attendance/cost/quarterly?${qs}`,
          { signal: controller.signal, headers: token ? { Authorization: `Bearer ${token}` } : {} }
        );
        if (!res.ok) throw new Error(await readErrorMessage(res, FALLBACK));
        const data = await readJsonBody(res, FALLBACK);
        if (active) setQuarterlyCost(data);
      } catch (err) {
        const msg = requestErrorMessage(err, FALLBACK);
        if (active) { setQuarterlyCost(null); if (msg) setQuarterlyCostError(msg); }
      }
    })();
    return () => { active = false; controller.abort(); };
  }, [projectId, year, quarter, paramError]);

  /* Holidays + calendar. Fetched as soon as the year is known rather than on
     the modal opening: the attendance tables tooltip their Holiday counts with
     these dates, so they're needed whether or not anyone clicks Holidays —
     and the modal now opens with its data already in hand. */
  useEffect(() => {
    let active = true;
    const controller = new AbortController();
    (async () => {
      setHolidayLoading(true);
      setHolidayError(null);
      try {
        const token = getToken();
        const safeYear = parseYear(year);
        if (safeYear === null) throw new Error(`"${year}" isn't a valid year.`);
        const opts = {
          signal: controller.signal,
          headers: token ? { Authorization: `Bearer ${token}` } : {},
        };
        const FALLBACK = "Couldn't load the holiday calendar.";
        /* The calendar is supporting detail, so it's reduced to its payload or
           null here, inside the Promise.all. Reading it afterwards meant a
           calendar *network* failure rejected the whole batch and took the
           holiday list down with it — the opposite of the intent. */
        const [hRes, cData] = await Promise.all([
          fetch(`${API_BASE}/api/holidays/${safeYear}?month=all`, opts),
          fetch(`${API_BASE}/api/calendar/${safeYear}?month=all`, opts)
            .then((r) => (r.ok ? readJsonBody(r, FALLBACK) : null))
            .catch(() => null),
        ]);
        if (!hRes.ok) throw new Error(await readErrorMessage(hRes, FALLBACK));
        const hData = await readJsonBody(hRes, FALLBACK);
        if (active) {
          // normalizeHolidays iterates its argument — an object or null body
          // would throw, so anything that isn't a list becomes an empty one.
          setHolidays(normalizeHolidays(Array.isArray(hData) ? hData : []));
          setCalendar(cData);
        }
      } catch (err) {
        const msg = requestErrorMessage(err, "Couldn't load the holiday calendar.");
        if (active && msg) setHolidayError(msg);
      } finally {
        if (active) setHolidayLoading(false);
      }
    })();
    return () => { active = false; controller.abort(); };
  }, [year]);

  /* Range for the header's template button, derived from Year + Month. */
  const templateRange = useMemo(() => {
    const y = parseYear(year);
    if (y === null) return null;
    const m = selectedMonth === "all" ? null : parseMonth(selectedMonth);
    if (m === null) return { start: `${y}-01-01`, end: `${y}-12-31`, label: String(y) };
    return {
      start: `${y}-${pad2(m)}-01`,
      end: lastDayOfMonth(y, m),
      label: `${MONTH_NAMES[m]} ${y}`,
    };
  }, [year, selectedMonth]);

  async function handleHeaderTemplate() {
    if (templateBusy || !templateRange) return;
    setTemplateBusy(true);
    setTemplateMsg(null);
    setTemplateError(null);
    try {
      const filename = await downloadAttendanceTemplate(templateRange.start, templateRange.end);
      setTemplateMsg(`Template downloaded — ${filename}`);
    } catch (err) {
      const msg = requestErrorMessage(err, "Couldn't download the template. Please try again.");
      setTemplateError(msg);
      notifyActionError("Download failed", msg);
    } finally {
      setTemplateBusy(false);
    }
  }

  // Row click → open the full-page leave detail (year + quarter in the URL).
  const goLeaveDetail = (emp, quarterNum) =>
    navigate(
      `/projects/${encodeURIComponent(projectId)}/attendance/leave/${encodeURIComponent(emp.attendanceId)}?year=${year}&quarter=${quarterNum}`
    );

  const employees = useMemo(() => reportRows(summary), [summary]);
  const period =
    summary?.period ||
    employees[0]?.period ||
    (selectedMonth !== "all" ? `${MONTH_NAMES[Number(selectedMonth)]} ${year}` : "");

  // At-a-glance metrics for the selected month.
  const metrics = useMemo(() => buildMetrics(summary, employees), [summary, employees]);

  /* Which holidays each table's Holiday column is counting. The monthly view
     reuses the template's range (the selected month, or the whole year when
     "all" is picked); the quarterly one spans its three months. */
  const quarterRange = useMemo(() => {
    const y = parseYear(year);
    const q = parseQuarter(quarter);
    if (y === null || q === null) return null;
    const firstMonth = (q - 1) * 3 + 1;
    return {
      start: `${y}-${pad2(firstMonth)}-01`,
      end: lastDayOfMonth(y, firstMonth + 2),
      label: `Q${q} ${y}`,
    };
  }, [year, quarter]);

  const monthlyHolidayTitle = useMemo(
    () => buildHolidayTitle(holidays, templateRange),
    [holidays, templateRange]
  );
  const quarterlyHolidayTitle = useMemo(
    () => buildHolidayTitle(holidays, quarterRange),
    [holidays, quarterRange]
  );

  const quarterlyRows = useMemo(() => reportRows(quarterly), [quarterly]);
  const quarterlyMetrics = useMemo(
    () => buildMetrics(quarterly, quarterlyRows),
    [quarterly, quarterlyRows]
  );
  const quarterlyCostById = useMemo(
    () => indexCostByResource(quarterlyCost),
    [quarterlyCost]
  );
  /* Prefer the API's own total; fall back to summing the rows so the footer
     still adds up if `totals` is ever missing. */
  const quarterlyCostTotal = useMemo(() => {
    const t = reportTotals(quarterlyCost);
    if (t && t.totalCost != null) return num(t.totalCost);
    let sum = 0;
    quarterlyCostById.forEach((r) => { sum += num(r.totalCost); });
    return sum;
  }, [quarterlyCost, quarterlyCostById]);

  return (
    <div className="uidai-pmis-content att-page">
      <style>{ATT_CSS}</style>

      {/* Header — upload is the page's primary action, so it sits up here
          rather than in a table of its own. */}
      <header className="att-head">
        <div className="att-head-main">
          <div className="att-eyebrow">{project?.projectName || "Project"}</div>
          <h1 className="uidai-pmis-title att-title">Attendance</h1>
          <p className="uidai-pmis-subtitle att-subtitle">
            Monthly attendance, quarterly leave and the holiday calendar for your project team.
          </p>
        </div>
        <div className="att-head-actions">
          <button
            className="att-btn-secondary"
            onClick={handleHeaderTemplate}
            disabled={templateBusy || !templateRange}
            title={
              templateRange
                ? `Download a blank attendance template for ${templateRange.label} (${templateRange.start} → ${templateRange.end})`
                : "Fix the filters above first"
            }
          >
            <DownloadIcon />
            {templateBusy ? "Preparing…" : "Download template"}
          </button>
          <button
            className="att-btn-primary"
            onClick={() => setUploadOpen(true)}
            disabled={milestonesLoading || uploadableMilestones.length === 0 || !!paramError}
            title={
              paramError
                ? "Fix the filters above before uploading"
                : milestonesLoading
                  ? "Loading milestones…"
                  : uploadableMilestones.length === 0
                    ? "No resource-based milestones are ready for upload"
                    : "Upload attendance for a resource-based milestone"
            }
          >
            <UploadIcon />
            Upload attendance
          </button>
        </div>
      </header>

      {paramError && <div className="att-error" role="alert">⚠️ {paramError}</div>}
      {milestonesError && <div className="att-error" role="alert">{milestonesError}</div>}
      {templateError && <div className="att-error" role="alert">{templateError}</div>}
      {templateMsg && <div className="att-note" role="status">{templateMsg}</div>}

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
            <MetricsRow metrics={metrics} />
            <AttendanceTable
              period={period}
              employees={employees}
              milestoneName={milestoneName}
              holidayTitle={monthlyHolidayTitle}
              onRowClick={(emp) => goLeaveDetail(emp, Math.ceil(Number(selectedMonth) / 3))}
            />
          </>
        )}
      </section>

      {/* Quarterly leave */}
      <section className="att-section">
        <div className="att-section-head">
          <h2 className="att-section-title" style={{ margin: 0 }}>Quarterly Attendance</h2>
          {/* Year sits beside Quarter so a quarter can be picked without
              scrolling back to the toolbar. It's the SAME `year` state the
              toolbar uses — one source of truth, so the two controls can't
              disagree about which year the page is showing. Unlike the
              toolbar's copy this one leaves the month alone: resetting the
              monthly view from a quarterly control would be a surprise. */}
          <div className="att-controls att-section-controls">
            <Field label="Year">
              <select
                className="att-select"
                value={year}
                onChange={(e) => setYear(Number(e.target.value))}
              >
                {YEAR_OPTIONS.map((y) => <option key={y} value={y}>{y}</option>)}
              </select>
            </Field>
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
        </div>
        {quarterlyLoading && <SkeletonTable rows={5} cols={7} />}
        {quarterlyError && <div className="att-error">{quarterlyError}</div>}
        {!quarterlyLoading && !quarterlyError && (
          <QuarterlyPanel
            data={quarterlyRows}
            metrics={quarterlyMetrics}
            period={quarterly?.period}
            quarter={quarter}
            year={year}
            milestoneName={milestoneName}
            holidayTitle={quarterlyHolidayTitle}
            costById={quarterlyCostById}
            costTotal={quarterlyCostTotal}
            costError={quarterlyCostError}
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

      {uploadOpen && (
        <LeaveUploadModal
          projectId={projectId}
          milestones={uploadableMilestones}
          onClose={() => setUploadOpen(false)}
        />
      )}
    </div>
  );
}

/* =====================================================================
   Shared attendance table — used by both monthly and quarterly views.
   ===================================================================== */
function AttendanceTable({
  period, employees, onRowClick, milestoneName, costById, costTotal, holidayTitle,
}) {
  const clickable = typeof onRowClick === "function";
  /* Cost only exists for the quarterly view, so the column appears only when
     a cost payload was actually joined in — the monthly table is unchanged. */
  const showCost = !!costById && costById.size > 0;
  const costFor = (emp) => (showCost ? costById.get(String(emp.attendanceId)) : null);
  // The report now splits leave into paid/unpaid and leaves `leaveDays` at 0.
  // Older payloads only carry `leaveDays`, so pick whichever the rows have.
  const splitLeave = employees.some(
    (e) => e.paidLeaveDays != null || e.unpaidLeaveDays != null
  );

  /* Which milestone's upload each row came from. In practice a report is
     usually one upload, so the id repeats down every row — showing it as a
     column then means eleven identical cells. It becomes a header chip when
     the whole table shares one milestone, and only earns a column when the
     rows genuinely differ. Rows from older payloads carry no milestoneId at
     all, in which case neither appears. */
  const milestoneIds = Array.from(
    new Set(employees.map((e) => e.milestoneId).filter(Boolean))
  );
  const sharedMilestoneId = milestoneIds.length === 1 ? milestoneIds[0] : null;
  const showMilestoneCol = milestoneIds.length > 1;
  // Name if we have it; otherwise a truncated id, with the full one on hover.
  const labelFor = (id) => {
    const name = milestoneName?.(id);
    if (name) return name;
    const s = String(id || "");
    return s.length > 10 ? `${s.slice(0, 8)}…` : s;
  };

  return (
    <div className="uidai-pmis-card att-card">
      <div className="att-card-head">
        <strong className="att-card-title">{period}</strong>
        <div className="att-chips">
          <Chip>{employees.length} {employees.length === 1 ? "employee" : "employees"}</Chip>
          {sharedMilestoneId && (
            <span
              className="att-ms-chip"
              title={`Uploaded against milestone ${sharedMilestoneId}`}
            >
              <span className="att-ms-chip-lbl">Milestone</span>
              {labelFor(sharedMilestoneId)}
            </span>
          )}
          {clickable && <span className="att-hint-inline">Click a row for full leave detail</span>}
        </div>
      </div>
      <div className="att-table-wrap">
        <table className="att-table">
          <thead>
            <tr>
              <th className="att-th">ID</th>
              <th className="att-th">Name</th>
              {showMilestoneCol && <th className="att-th">Milestone</th>}
              <th className="att-th att-num">Working</th>
              <th className="att-th att-num">Present</th>
              {/* Half-day column withdrawn — half days already count as 0.5
                  inside Present, so the separate tally was double-reporting. */}
              {splitLeave && (
                <>
                  <th className="att-th att-num">Paid Leave</th>
                  <th className="att-th att-num">Unpaid Leave</th>
                </>
              )}
              <th className="att-th att-num">Leave Taken</th>
              {/* Week off hidden for now — uncomment with the matching <td> below.
              <th className="att-th att-num">Week off</th>
              */}
              {/* The dates behind the count sit on both the header and each
                  cell — whichever the pointer lands on, the answer is there. */}
              <th className="att-th att-num" title={holidayTitle}>Holiday</th>
              <th className="att-th att-num att-th-att">Attendance</th>
              {showCost && <th className="att-th att-num">Cost</th>}
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
                <td className="att-td att-strong att-name-cell">
                  {emp.employeeName}
                  {emp.designation && (
                    <div className="att-desig" title={emp.designation}>
                      {emp.designation}
                    </div>
                  )}
                </td>
                {showMilestoneCol && (
                  <td className="att-td att-dim" title={emp.milestoneId || ""}>
                    {emp.milestoneId ? labelFor(emp.milestoneId) : "—"}
                  </td>
                )}
                <td className="att-td att-num att-dim">{emp.workingDays}</td>
                <td className="att-td att-num">{emp.presentDays}</td>
                {splitLeave && (
                  <>
                    <td className="att-td att-num">{num(emp.paidLeaveDays)}</td>
                    <td className={`att-td att-num${num(emp.unpaidLeaveDays) > 0 ? " att-warn" : " att-dim"}`}>
                      {num(emp.unpaidLeaveDays)}
                    </td>
                  </>
                )}
                <td className={`att-td att-num${leaveTakenOf(emp) > 0 ? "" : " att-dim"}`}>
                  {leaveTakenOf(emp)}
                </td>
                {/* Week off hidden for now — uncomment with the matching <th> above.
                <td className="att-td att-num att-dim">{emp.weekOffDays}</td>
                */}
                <td className="att-td att-num att-dim" title={holidayTitle}>
                  {emp.holidayDays}
                </td>
                <td className="att-td att-num att-att-cell">
                  <AttendanceBar value={emp.attendancePercentage} />
                </td>
                {showCost && (() => {
                  const c = costFor(emp);
                  return (
                    <td className={`att-td att-num${c ? " att-cost-total" : " att-dim"}`}>
                      {c ? money(c.totalCost) : "—"}
                    </td>
                  );
                })()}
              </tr>
            ))}
          </tbody>
          {showCost && (
            <tfoot>
              <tr className="att-row att-foot-row">
                {/* Everything up to the Cost column is one spanned label. Seven
                    fixed columns, plus Milestone when the rows differ and the
                    paid/unpaid pair when the report splits leave — so the
                    total always lands under Cost. */}
                <td
                  className="att-td att-strong"
                  colSpan={7 + (showMilestoneCol ? 1 : 0) + (splitLeave ? 2 : 0)}
                >
                  Total for {period}
                </td>
                <td className="att-td att-num att-strong att-cost-total">
                  {money(costTotal)}
                </td>
              </tr>
            </tfoot>
          )}
        </table>
      </div>
    </div>
  );
}


/* =====================================================================
   Quarterly leave panel
   ===================================================================== */
function QuarterlyPanel({
  data, metrics, period: periodProp, quarter, year, onRowClick, milestoneName,
  costById, costTotal, costError, holidayTitle,
}) {
  const employees = data ?? [];
  const period = periodProp || employees[0]?.period || `Q${quarter} ${year}`;

  if (employees.length === 0) {
    return (
      <EmptyState
        icon={<CalendarIcon />}
        title="No leave this quarter"
        hint={`Nothing has been logged for Q${quarter} ${year} yet.`}
      />
    );
  }
  const hasCost = !!costById && costById.size > 0;
  return (
    <>
      <MetricsRow metrics={metrics} costTotal={hasCost ? costTotal : null} />
      {costError && <div className="att-error">{costError}</div>}
      <AttendanceTable
        period={period}
        employees={employees}
        milestoneName={milestoneName}
        holidayTitle={holidayTitle}
        costById={costById}
        costTotal={costTotal}
        onRowClick={onRowClick}
      />
    </>
  );
}

/* =====================================================================
   Metric cards — driven by the report's `totals` block when the API sends
   one, otherwise by row sums.
   ===================================================================== */
function MetricsRow({ metrics, costTotal }) {
  if (!metrics) return null;
  return (
    <div className="att-metrics">
      <StatCard label="Team size" value={metrics.n} sub={metrics.n === 1 ? "employee" : "employees"} />
      {costTotal != null && (
        <StatCard
          label="Quarter cost"
          value={moneyShort(costTotal)}
          sub="across team"
          tone={C.primary}
          title={money(costTotal)}
          compact
        />
      )}
      <StatCard
        label="Avg attendance"
        value={`${metrics.avg.toFixed(1)}%`}
        sub={`${attTone(metrics.avg).label} overall`}
        tone={attTone(metrics.avg).color}
      />
      <StatCard label="Present" value={metrics.present} sub="days across team" />
      {metrics.paidLeave != null && (
        <StatCard label="Paid leave" value={metrics.paidLeave} sub="days across team" />
      )}
      {metrics.unpaidLeave != null && (
        <StatCard
          label="Unpaid leave"
          value={metrics.unpaidLeave}
          sub="days across team"
          tone={metrics.unpaidLeave > 0 ? C.amber : undefined}
        />
      )}
    </div>
  );
}

/* =====================================================================
   Leave Management — per-milestone attendance Excel upload.
   POST /api/attendance/upload with projectId, milestoneId, dates + file.
   ===================================================================== */
function LeaveUploadModal({ projectId, milestones = [], onClose }) {
  // Milestone is picked here rather than on the page. Preselect when there's
  // only one, so the common case is a single choice fewer.
  const [milestoneId, setMilestoneId] = useState(
    milestones.length === 1 ? String(milestones[0].apiId) : ""
  );
  const milestone = milestones.find((m) => String(m.apiId) === String(milestoneId)) || null;
  /* Activities under the chosen milestone — loaded fresh each time the
     milestone changes, so the list always matches the current pick rather
     than showing a stale unrelated set. Picking one is optional: it just
     lets the upload carry an activityId alongside the milestoneId. */
  const [activities, setActivities] = useState([]);
  const [activitiesLoading, setActivitiesLoading] = useState(false);
  const [activityId, setActivityId] = useState("");
  useEffect(() => {
    setActivityId("");
    if (!milestone?.apiId) { setActivities([]); return; }
    let active = true;
    setActivitiesLoading(true);
    (async () => {
      const list = await loadActivitiesForMilestone(milestone.apiId);
      if (active) setActivities(Array.isArray(list) ? list : []);
      if (active) setActivitiesLoading(false);
    })();
    return () => { active = false; };
  }, [milestone?.apiId]);
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  /* The organisation whose attendance this is — required by the upload, and
     picked from the vendors linked to the project. */
  const [orgs, setOrgs] = useState([]);
  const [orgsLoading, setOrgsLoading] = useState(true);
  const [organisationId, setOrganisationId] = useState("");
  const [file, setFile] = useState(null);
  const [uploading, setUploading] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState(null);
  const [done, setDone] = useState(false);
  // Holds the actual message returned by the API so the popup reflects
  // what the backend reported, rather than a hardcoded string.
  const [responseMessage, setResponseMessage] = useState("");
  // Per-field messages, shown once a submit has been attempted.
  const [fieldErrors, setFieldErrors] = useState({});
  const [submitted, setSubmitted] = useState(false);

  /* Organisations the attendance can be filed against — the project's linked
     vendors, from the gateway. This replaced the rate-year lookup that used
     to sit here: the server now derives the rate year from the upload's date
     range, so there is nothing left for the user to choose. */
  useEffect(() => {
    if (!projectId) return;
    let active = true;
    setOrgsLoading(true);
    (async () => {
      try {
        const res = await authorizedFetch(
          `${GATEWAY_BASE}${ENDPOINTS.projects.get(projectId)}`,
          { method: "GET", headers: { accept: "application/json" } }
        );
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const raw = await res.json().catch(() => ({}));
        const vendors = (raw?.data ?? raw)?.vendors;
        const list = (Array.isArray(vendors) ? vendors : [])
          .filter((v) => v && v.id)
          .map((v) => ({ id: v.id, name: v.name || v.id }));
        if (!active) return;
        setOrgs(list);
        // Prefer the signed-in user's own organisation when it's on the
        // project; otherwise fall back to the first linked vendor.
        const own =
          tokenStore.getUser()?.vendor_id || tokenStore.getUser()?.vendorId || "";
        const preferred = list.find((o) => o.id === own) || list[0];
        setOrganisationId(preferred ? preferred.id : "");
      } catch {
        // Non-fatal here — the picker stays empty and submit explains why.
        if (active) setOrgs([]);
      } finally {
        if (active) setOrgsLoading(false);
      }
    })();
    return () => { active = false; };
  }, [projectId]);

  useModalChrome(onClose, uploading);

  /* ── validation ──────────────────────────────────────────────────
     The date range is validated in one place because three things depend
     on it: the template download, the upload, and the range-vs-milestone
     caution. Returns "" when valid. */
  const validateRange = (start, end) => {
    if (!start || !end) return "Set both a start and an end date.";
    if (!parseISODate(start)) return "The start date isn't a valid date.";
    if (!parseISODate(end)) return "The end date isn't a valid date.";
    if (end < start) return "The end date can't be earlier than the start date.";
    const span = daysBetween(start, end);
    if (span !== null && span > MAX_RANGE_DAYS) {
      return `That range covers ${span} days — upload a period of ${MAX_RANGE_DAYS} days or less.`;
    }
    return "";
  };

  /* An .xlsx is a zip and an .xls is a compound file; browsers report their
     MIME types inconsistently (and not at all for a drag from some apps), so
     the extension is the reliable check and the MIME type is a bonus. */
  const validateFile = (f) => {
    if (!f) return "Choose an Excel file to upload.";
    if (!/\.(xlsx|xls)$/i.test(f.name || "")) {
      return "That isn't an Excel file. Choose a .xlsx or .xls file.";
    }
    if (!f.size) return "That file is empty. Choose the filled-in template.";
    if (f.size > MAX_UPLOAD_BYTES) {
      return `That file is ${fmtBytes(f.size)} — the limit is ${fmtBytes(MAX_UPLOAD_BYTES)}.`;
    }
    return "";
  };

  const validateForm = () => {
    const errs = {};
    if (!milestone?.apiId) errs.milestone = "Choose a milestone to upload against.";
    if (!organisationId) {
      errs.organisation = orgs.length === 0 && !orgsLoading
        ? "No organisation is linked to this project. Add one on the project details page."
        : "Choose the organisation this attendance belongs to.";
    }
    const rangeError = validateRange(startDate, endDate);
    if (rangeError) errs.startDate = rangeError;
    const fileError = validateFile(file);
    if (fileError) errs.file = fileError;
    return errs;
  };

  // Re-check after a failed submit so a corrected field clears as it's fixed.
  const revalidate = () => { if (submitted) setFieldErrors(validateForm()); };

  /* The upload range sitting outside the milestone's own dates is allowed —
     a milestone can be extended later — but it's almost always a mis-pick,
     so it's called out rather than silently accepted. */
  const outsideMilestone =
    milestone && startDate && endDate && milestone.startDate && milestone.endDate &&
    !validateRange(startDate, endDate) &&
    (startDate < milestone.startDate || endDate > milestone.endDate);

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

  /* What the SERVER said went wrong, not a generic stand-in.

     The shared messageFromBody() joins an `errors` array into one comma-
     separated line and then drops the whole thing when it exceeds 300 chars
     — which a real row-by-row validation list always does. The upshot was
     that the more the server explained, the less the user saw: a fifty-row
     rejection surfaced as "Some values weren't accepted."

     So the array is read directly here and rendered one error per line.
     Long lists are capped with a count of the remainder rather than being
     discarded. The shared gate still handles the no-array case, where it
     does its real job of keeping HTML pages and stack traces off screen. */
  const MAX_LISTED_ERRORS = 12;
  const buildErrorMessage = (data, raw, status) => {
    const list = (Array.isArray(data?.errors) ? data.errors : [])
      .map((e) => (typeof e === "string" ? e : e?.message || e?.defaultMessage || ""))
      .map((s) => String(s).trim())
      .filter(Boolean);

    if (list.length) {
      // Every row failing for the same reason means the wrong file, not fifty
      // separate problems — say that once instead of listing it fifty times.
      if (list.every((e) => /does not exist/i.test(e))) {
        return "These resources belong to another project. Please upload the correct attendance file.";
      }
      const shown = list.slice(0, MAX_LISTED_ERRORS);
      const rest = list.length - shown.length;
      const headline =
        typeof data?.message === "string" && data.message.trim()
          ? data.message.trim()
          : `The server rejected ${list.length} ${list.length === 1 ? "entry" : "entries"}:`;
      return [
        headline,
        ...shown.map((e) => `• ${e}`),
        rest > 0 ? `…and ${rest} more.` : null,
      ].filter(Boolean).join("\n");
    }

    return messageFromBody(raw, status, "The upload didn't go through. Please try again.");
  };

  // Blank sheet for the chosen range — see downloadAttendanceTemplate.
  const downloadTemplate = async () => {
    if (downloading || uploading) return;
    setError(null);
    setNotice(null);
    // The template is built for the range, so the range rules apply here too.
    const rangeError = validateRange(startDate, endDate);
    if (rangeError) { setError(rangeError); return; }

    try {
      setDownloading(true);
      const filename = await downloadAttendanceTemplate(startDate, endDate);
      setNotice(`Template downloaded — ${filename}`);
    } catch (err) {
      /* Action outcome → the app's shared popup. The inline line is kept in
         step so the reason survives dismissing the popup. */
      const msg = requestErrorMessage(err, "Couldn't download the template. Please try again.");
      setError(msg);
      notifyActionError("Download failed", msg);
    } finally {
      setDownloading(false);
    }
  };

  const upload = async () => {
    if (uploading || downloading) return;     // guards a double-click
    setError(null);
    setNotice(null);
    setSubmitted(true);

    if (!projectId) { setError("This project couldn't be identified."); return; }

    const errs = validateForm();
    setFieldErrors(errs);
    const firstBad = Object.keys(errs)[0];
    if (firstBad) {
      document.getElementById(`upl-${firstBad}`)?.focus();
      return;
    }

    const body = new FormData();
    body.append("file", file);
    /* No rateYear: the server resolves it from the date range against the
       project's rate-year bands. */
    const params = new URLSearchParams({
      projectId,
      organisationId,
      milestoneId: milestone.apiId,
      startDate: String(startDate),
      endDate: String(endDate),
    });
    // Optional — only sent when the user picked one of the milestone's activities.
    if (activityId) params.set("activityId", activityId);

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
        /* Handled here rather than thrown: requestErrorMessage() in the catch
           below runs the message through the same 300-char readability gate
           that was swallowing these lists in the first place. The full detail
           goes inline where there's room to read it, and the popup gets the
           headline only — a fifty-line modal helps nobody. */
        const detail = buildErrorMessage(data, raw, res.status);
        setError(detail);
        notifyActionError("Upload failed", detail.split("\n")[0]);
        return;
      }

      /* The success body is shown only when it reads like a sentence —
         `raw` was already read above, so it's re-checked through the same
         gate rather than printed. Falls back to a fixed line. */
      setResponseMessage(
        messageFromBody(
          typeof data?.message === "string" ? data.message : "",
          res.status,
          "Attendance uploaded successfully."
        )
      );
      setDone(true);
    } catch (err) {
      const msg = requestErrorMessage(err, "The upload didn't go through. Please try again.");
      setError(msg);
      notifyActionError("Upload failed", msg);
    } finally {
      setUploading(false);
    }
  };

  return (
    /* Dismissing mid-upload would orphan a write the user can't see, so the
       backdrop and ✕ are inert until the request settles. */
    <div
      className="att-backdrop"
      onMouseDown={(e) => { if (e.target === e.currentTarget && !uploading) onClose(); }}
    >
      <div className="att-modal" role="dialog" aria-modal="true" aria-label="Leave Management" style={{ maxWidth: 540 }}>
        <div className="att-modal-head">
          <div>
            <div className="att-eyebrow" style={{ marginBottom: 4 }}>Leave Management</div>
            <h2 className="att-modal-title">Upload attendance</h2>
          </div>
          <button className="att-close" onClick={onClose} disabled={uploading} aria-label="Close">✕</button>
        </div>

        <div className="att-modal-sub">
          {milestone
            ? `${milestone.startDate || "—"} → ${milestone.endDate || "—"}`
            : "Choose the milestone this attendance belongs to."}
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
              <Field label="Milestone">
                <select
                  id="upl-milestone"
                  className={`att-select att-select--wide${fieldErrors.milestone ? " is-bad" : ""}`}
                  value={milestoneId}
                  aria-invalid={!!fieldErrors.milestone}
                  onChange={(e) => { setMilestoneId(e.target.value); setError(null); revalidate(); }}
                >
                  <option value="">Select a milestone…</option>
                  {milestones.map((m) => (
                    <option key={m.apiId} value={m.apiId}>
                      {[m.serverDisplayCode || m.id, m.name].filter(Boolean).join(" · ")}
                    </option>
                  ))}
                </select>
                {fieldErrors.milestone && <span className="att-field-err">{fieldErrors.milestone}</span>}
              </Field>
              {/* The activities that belong to the chosen milestone — optional,
                  so the upload can be tied to a specific activity when one applies. */}
              <Field label="Activity (optional)">
                <select
                  id="upl-activity"
                  className="att-select att-select--wide"
                  value={activityId}
                  disabled={!milestone || activitiesLoading || activities.length === 0}
                  onChange={(e) => setActivityId(e.target.value)}
                >
                  <option value="">
                    {!milestone
                      ? "Choose a milestone first"
                      : activitiesLoading
                        ? "Loading activities…"
                        : activities.length === 0
                          ? "No activities under this milestone"
                          : "Select an activity…"}
                  </option>
                  {activities.map((a) => (
                    <option key={a.apiId} value={a.apiId}>
                      {[a.serverDisplayCode || a.id, a.name].filter(Boolean).join(" · ")}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Organisation">
                <select
                  id="upl-organisation"
                  className={`att-select att-select--wide${fieldErrors.organisation ? " is-bad" : ""}`}
                  value={organisationId}
                  disabled={orgsLoading || orgs.length === 0}
                  aria-invalid={!!fieldErrors.organisation}
                  onChange={(e) => { setOrganisationId(e.target.value); setError(null); revalidate(); }}
                >
                  {orgsLoading && <option value="">Loading…</option>}
                  {!orgsLoading && orgs.length === 0 && (
                    <option value="">No organisation available</option>
                  )}
                  {orgs.map((o) => (
                    <option key={o.id} value={o.id}>{o.name}</option>
                  ))}
                </select>
                {fieldErrors.organisation && <span className="att-field-err">{fieldErrors.organisation}</span>}
              </Field>
              {/* Monthly is the only type the API supports, so it's stated
                  rather than offered — a one-option dropdown asks for a
                  decision that doesn't exist. */}
              <Field label="Upload type">
                <div className="att-static">Monthly</div>
              </Field>
              <Field label="Start date">
                <input
                  id="upl-startDate"
                  type="date"
                  className={`att-select${fieldErrors.startDate ? " is-bad" : ""}`}
                  value={startDate}
                  max={endDate || undefined}
                  aria-invalid={!!fieldErrors.startDate}
                  onChange={(e) => { setStartDate(e.target.value); setError(null); revalidate(); }}
                />
              </Field>
              <Field label="End date">
                <input
                  id="upl-endDate"
                  type="date"
                  className={`att-select${fieldErrors.startDate ? " is-bad" : ""}`}
                  value={endDate}
                  min={startDate || undefined}
                  onChange={(e) => { setEndDate(e.target.value); setError(null); revalidate(); }}
                />
              </Field>
            </div>

            {/* The range error covers both date fields, so it sits under the
                pair rather than being duplicated beneath each one. */}
            {fieldErrors.startDate && <div className="att-field-err">{fieldErrors.startDate}</div>}
            {/* The rate year used to be picked here. It's now derived from the
                dates, against the bands set when the rate card was uploaded —
                so it's explained once the dates are in, not requested. */}
            {startDate && endDate && !fieldErrors.startDate && (
              <div className="att-note" role="status">
                The rate year is matched automatically from these dates.
              </div>
            )}
            {outsideMilestone && !fieldErrors.startDate && (
              <div className="att-note att-note--warn" role="status">
                These dates fall outside the milestone's own range
                ({milestone.startDate || "—"} → {milestone.endDate || "—"}). You can still
                upload, but check you've picked the right milestone.
              </div>
            )}

            {/* Template is built for the range above, so it sits between the
                dates and the file picker — download, fill, then upload. */}
            <div className="att-template-row">
              <button
                className="att-btn-secondary"
                onClick={downloadTemplate}
                disabled={downloading || uploading || !startDate || !endDate}
                title={
                  startDate && endDate
                    ? "Download a blank template for this date range"
                    : "Set both dates first"
                }
              >
                <DownloadIcon />
                {downloading ? "Preparing…" : "Download template"}
              </button>
              <span className="att-template-hint">
                Blank sheet covering the selected dates — fill it in, then upload it below.
              </span>
            </div>

            <Field label="Attendance file">
              <label className={`att-file${fieldErrors.file ? " is-bad" : ""}`}>
                <input
                  id="upl-file"
                  type="file"
                  accept=".xlsx,.xls"
                  disabled={uploading}
                  onChange={(e) => {
                    /* `accept` is a filter, not a guarantee — a user can pick
                       "All files", and a drag-and-drop bypasses it entirely.
                       Validate here so a .pdf is caught before the request. */
                    const picked = e.target.files?.[0] || null;
                    setFile(picked);
                    setError(null);
                    const msg = picked ? validateFile(picked) : "";
                    setFieldErrors((prev) => ({ ...prev, file: msg || undefined }));
                  }}
                />
                <span className="att-file-btn"><UploadIcon />Choose file</span>
                <span className="att-file-name">
                  {file ? `${file.name} · ${fmtBytes(file.size)}` : "No file selected — .xlsx or .xls"}
                </span>
              </label>
              {fieldErrors.file && <span className="att-field-err">{fieldErrors.file}</span>}
            </Field>

            {notice && <div className="att-note" role="status">{notice}</div>}
            {error && <div className="att-error" role="alert">{error}</div>}

            <div className="att-modal-actions">
              <button className="att-btn-secondary" onClick={onClose} disabled={uploading}>Cancel</button>
              <button className="att-btn-primary" onClick={upload} disabled={uploading || downloading}>
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

/* `compact` drops the value to a smaller type scale — for long values such as
   a lakh-scale currency figure that would otherwise overflow the card.
   `title` carries the unrounded figure. */
function StatCard({ label, value, sub, tone, title, compact }) {
  return (
    <div className="att-metric" style={tone ? { borderTopColor: tone } : undefined} title={title}>
      <div className="att-metric-label">{label}</div>
      <div
        className={`att-metric-value${compact ? " att-metric-value-sm" : ""}`}
        style={tone ? { color: tone } : undefined}
      >
        {value}
      </div>
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
/* `busy` blocks Escape while a request is in flight, matching the inert
   backdrop and ✕ — closing mid-write orphans it. */
function useModalChrome(onClose, busy = false) {
  useEffect(() => {
    const onKey = (e) => { if (e.key === "Escape" && !busy) onClose(); };
    window.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [onClose, busy]);
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
// Mirror of UploadIcon with the arrow reversed.
function DownloadIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M12 4v11m0 0 4-4m-4 4-4-4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
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
.att-head { display: flex; align-items: flex-start; justify-content: space-between;
  gap: 16px; flex-wrap: wrap; margin-bottom: 26px; }
.att-head-main { min-width: 0; }
.att-head-actions { display: flex; align-items: center; gap: 10px; flex-shrink: 0; flex-wrap: wrap; }
.att-title { margin: 0 0 6px; letter-spacing: -0.02em; }
.att-subtitle { margin: 0; color: ${C.muted}; max-width: 640px; }
/* milestone names are long — let that one select take the full modal row */
.att-select--wide { min-width: 100%; }

/* template download row inside the upload modal */
.att-template-row { display: flex; align-items: center; gap: 12px; flex-wrap: wrap;
  padding: 12px 14px; margin-bottom: 14px; background: ${C.surface};
  border: 1px solid ${C.border}; border-radius: 10px; }
.att-template-hint { font-size: 12.5px; color: ${C.muted}; line-height: 1.45; flex: 1 1 200px; }

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
/* Filters sitting inside a section heading rather than the page toolbar —
   held to the right edge and kept from stretching the heading row. */
.att-section-controls { flex: 0 0 auto; align-items: flex-end; }
.att-field { display: flex; flex-direction: column; gap: 6px; }
.att-field-label { font-size: 11.5px; font-weight: 700; letter-spacing: 0.05em;
  text-transform: uppercase; color: ${C.muted}; }
.att-select { padding: 9px 12px; border-radius: 10px; border: 1px solid ${C.border};
  background: #fff; color: ${C.ink}; font-size: 14px; font-family: inherit; min-width: 150px;
  outline: none; cursor: pointer; transition: border-color .15s ease, box-shadow .15s ease;
  box-shadow: 0 1px 2px rgba(16,32,60,.04); }
/* A field with one possible value — sized like a control so the row lines
   up, but flat and inert because there is nothing to pick. */
.att-static { padding: 9px 12px; border-radius: 10px; border: 1px solid ${C.border};
  background: ${C.surfaceAlt}; color: ${C.ink2}; font-size: 14px; min-width: 150px;
  font-weight: 600; }
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

/* ---- metric cards ----
   The strip carries up to eight cards, so each one has to survive at roughly
   an eighth of the content width. Values are kept on one line (a wrapped
   number reads as two numbers); anything long enough to threaten that gets
   .att-metric-value-sm instead of being allowed to spill past the border. */
.att-metrics { display: grid; grid-template-columns: repeat(auto-fit, minmax(138px, 1fr));
  gap: 10px; margin-bottom: 18px; }
.att-metric { background: #fff; border: 1px solid ${C.border}; border-top: 3px solid ${C.borderStrong};
  border-radius: 12px; padding: 12px 13px 13px; box-shadow: 0 1px 2px rgba(16,32,60,.04);
  min-width: 0; overflow: hidden; }
.att-metric-label { font-size: 10px; font-weight: 700; letter-spacing: .05em;
  text-transform: uppercase; color: ${C.muted}; white-space: nowrap;
  overflow: hidden; text-overflow: ellipsis; }
.att-metric-value { font-size: 22px; font-weight: 800; color: ${C.ink}; line-height: 1.1;
  margin-top: 6px; letter-spacing: -.02em; font-variant-numeric: tabular-nums;
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.att-metric-value-sm { font-size: 17px; letter-spacing: -.01em; }
.att-metric-sub { font-size: 11px; color: ${C.faint}; margin-top: 3px; white-space: nowrap;
  overflow: hidden; text-overflow: ellipsis; }

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
/* Source milestone — the same pill as .att-chip with its label built in, so
   "Milestone" reads as a field name rather than part of the value. */
.att-ms-chip { display: inline-flex; align-items: baseline; gap: 6px; max-width: 320px;
  font-size: 12px; font-weight: 600; background: ${C.accentBg}; color: ${C.primary};
  padding: 3px 10px; border-radius: 999px; border: 1px solid #d7def7;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.att-ms-chip-lbl { font-size: 9.5px; font-weight: 700; letter-spacing: .06em;
  text-transform: uppercase; color: ${C.muted}; flex: 0 0 auto; }
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
.att-warn { color: ${C.amber}; font-weight: 700; }
.att-att-cell { padding-right: 16px; }
/* Cost column — each resource's quarter total, and the team total in tfoot. */
.att-cost-total { font-weight: 700; color: ${C.ink}; }
.att-foot-row { background: ${C.surface}; }
.att-foot-row:hover { background: ${C.surface}; }
.att-foot-row .att-td { border-bottom: none; border-top: 2px solid ${C.border};
  font-size: 13.5px; }
.att-foot-row .att-cost-total { font-size: 15px; color: ${C.primary}; }
.att-row { transition: background-color .13s ease; }
.att-row:hover { background: ${C.surface}; }
.att-row:last-child .att-td { border-bottom: none; }
.att-row-click { cursor: pointer; }
.att-row-click:hover { background: ${C.accentBg}; }
.att-code { font-size: 13px; background: ${C.surface}; padding: 2px 7px; border-radius: 5px;
  border: 1px solid ${C.border}; font-variant-numeric: tabular-nums; }
/* Designation rides under the employee name rather than in a column of its
   own: titles like "Developer - Enrolment Server, Middleware and Logistics"
   are far wider than any other cell and would push the table into a
   horizontal scroll. It's the one cell allowed to wrap. */
.att-name-cell { white-space: normal; min-width: 190px; max-width: 300px; }
.att-desig { font-size: 12px; color: ${C.faint}; font-weight: 400; margin-top: 2px;
  line-height: 1.35; }

/* attendance strength meter */
.att-bar { display: inline-flex; align-items: center; gap: 9px; justify-content: flex-end; }
.att-bar-track { width: 54px; height: 6px; border-radius: 999px; background: #e6ecf4; overflow: hidden; }
.att-bar-fill { display: block; height: 100%; border-radius: 999px; transition: width .45s cubic-bezier(.2,.8,.2,1); }
.att-bar-val { font-variant-numeric: tabular-nums; font-weight: 700; font-size: 13px; min-width: 40px; text-align: right; }


/* states */
.att-muted { color: ${C.muted}; font-size: 14px; padding: 8px 0; }
/* pre-line, so a server error listing one problem per line renders as a list
   rather than collapsing into a wall of text. Capped in height because a
   rejection can name dozens of rows and must not push the form off-screen. */
.att-error { color: ${C.red}; font-size: 14px; padding: 12px 14px; background: ${C.redBg};
  border: 1px solid #f4cccc; border-radius: 10px; margin: 4px 0;
  white-space: pre-line; line-height: 1.55; max-height: 240px; overflow-y: auto; }
.att-note { color: ${C.muted}; font-size: 14px; padding: 12px 14px; background: #f6f8fb;
  border: 1px solid ${C.border}; border-radius: 10px; margin: 4px 0; }
/* A caution, not a failure — the action is still allowed to proceed. */
.att-note--warn { background: #fff8ec; border-color: #f0dcb8; color: #8a5a00; }
/* Field-level validation message — sits under the control it belongs to. */
.att-field-err { display: block; font-size: 12.5px; color: ${C.red}; margin-top: 5px; line-height: 1.45; }
/* Invalid control — a red edge alongside the message, so the error is
   findable by colour and readable without relying on it. */
.att-select.is-bad, .att-file.is-bad { border-color: ${C.red}; }
.att-select.is-bad:focus { border-color: ${C.red}; box-shadow: 0 0 0 3px rgba(214,69,69,.14); }
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