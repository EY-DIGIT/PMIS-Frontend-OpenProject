import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useParams, useNavigate, useSearchParams } from "react-router-dom";
import { useProject } from "../../store/project/projectsStore";
import { setPageContext, clearPageContext } from "../../utils/pageContext";
import {
  loadMilestonesForProject, loadActivitiesForMilestone, loadActivityById,
} from "../../api/milestoneConfigApi";
import {
  readErrorMessage, readJsonBody, requestErrorMessage, messageFromBody, notifyActionError,
  parseYear, parseQuarter, parseISODate, daysBetween, MIN_YEAR, MAX_YEAR,
} from "../../utils/apiMessage";
import { rupeesInWords } from "../../utils/moneyWords";
import { getToken } from "../../api/auth";
import { API_BASE as GATEWAY_BASE, authorizedFetch } from "../../api/client";
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
/* Fallbacks only, for before a milestone is chosen. The period comes from the
   selected milestone's window; these just name the quarter it starts in, for
   the holiday calendar and the leave-detail link. */
const DEFAULT_QUARTER = 1;

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

/* ── the activity's window, cut into whole months ─────────────────────
   An upload covers one month of an activity, measured from the activity's own
   start day rather than the calendar: 10 Jan → 6 Apr gives
     10 Jan – 9 Feb,  10 Feb – 9 Mar,  10 Mar – 6 Apr
   with the last band clipped to the activity's end date.

   A start day that some months don't have (29th–31st) clamps to that month's
   last day, and the ANCHOR is kept for later months rather than drifting: a
   31 Jan start gives 31 Jan, 28 Feb, 31 Mar, 30 Apr — not 28 Feb, 28 Mar,
   28 Apr, which is what carrying the clamped day forward would produce. */
function monthlyBands(startISO, endISO) {
  const a = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(startISO || ""));
  const b = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(endISO || ""));
  if (!a || !b) return [];
  const anchor = Number(a[3]);
  const [sy, sm] = [Number(a[1]), Number(a[2])];
  const [ey, em, ed] = [Number(b[1]), Number(b[2]), Number(b[3])];
  // Day 0 of month m+1 is the last day of month m.
  const lastOf = (y, m) => new Date(Date.UTC(y, m, 0)).getUTCDate();
  const iso = (y, m, d) => `${y}-${pad2(m)}-${pad2(d)}`;
  const after = (y1, m1, d1, y2, m2, d2) =>
    y1 > y2 || (y1 === y2 && (m1 > m2 || (m1 === m2 && d1 > d2)));

  const out = [];
  let y = sy;
  let m = sm;
  // 240 is a runaway guard, not a real limit — 20 years of months.
  for (let i = 0; i < 240; i++) {
    const startD = Math.min(anchor, lastOf(y, m));
    if (after(y, m, startD, ey, em, ed)) break;
    let ny = y;
    let nm = m + 1;
    if (nm > 12) { nm = 1; ny += 1; }
    const nextD = Math.min(anchor, lastOf(ny, nm));
    // This band ends the day before the next one starts.
    let by = ny;
    let bm = nm;
    let bd = nextD - 1;
    if (bd < 1) {
      bm -= 1;
      if (bm < 1) { bm = 12; by -= 1; }
      bd = lastOf(by, bm);
    }
    const clipped = after(by, bm, bd, ey, em, ed);
    out.push({ start: iso(y, m, startD), end: clipped ? iso(ey, em, ed) : iso(by, bm, bd) });
    if (clipped) break;
    y = ny;
    m = nm;
  }
  return out;
}


/* The attendance report sends its dates — joiningDate, lastWorkingDate — as
   dd-MM-yyyy, unlike the ISO dates the rest of this file deals in. Parsed
   explicitly rather than through `new Date`, which reads "05-02-2026" as
   MM-dd-yyyy and hands back 2 May instead of 5 February — three months out,
   and perfectly plausible on screen. ISO is accepted too, in case the endpoint
   is normalised later. */
const formatReportDate = (raw) => {
  const s = String(raw ?? "").trim();
  if (!s) return "";
  const dmy = /^(\d{1,2})-(\d{1,2})-(\d{4})$/.exec(s);
  if (dmy) {
    const m = Number(dmy[2]);
    return MONTH_NAMES[m] ? `${Number(dmy[1])} ${MONTH_NAMES[m].slice(0, 3)} ${dmy[3]}` : s;
  }
  const iso = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(s);
  if (iso) {
    const m = Number(iso[2]);
    return MONTH_NAMES[m] ? `${Number(iso[3])} ${MONTH_NAMES[m].slice(0, 3)} ${iso[1]}` : s;
  }
  return s;
};

/* Same dd-MM-yyyy the rest of the attendance service speaks, normalised to ISO
   so dates can be sorted and compared as plain strings and handed to
   daysBetween. Returns "" for anything unparseable — callers treat that as
   "no date", which is the honest reading of a value we can't place. */
const reportDateISO = (raw) => {
  const s = String(raw ?? "").trim();
  if (!s) return "";
  const p2 = (v) => String(v).padStart(2, "0");
  const dmy = /^(\d{1,2})-(\d{1,2})-(\d{4})$/.exec(s);
  if (dmy) return `${dmy[3]}-${p2(dmy[2])}-${p2(dmy[1])}`;
  const iso = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(s);
  if (iso) return `${iso[1]}-${p2(iso[2])}-${p2(iso[3])}`;
  /* 07-Jan-2026 — the shape the cost report puts in its `period` string, as
     opposed to the all-numeric dd-MM-yyyy it uses for the band dates. */
  const dMy = /^(\d{1,2})-([A-Za-z]{3,})-(\d{4})$/.exec(s);
  if (dMy) {
    const m = MONTH_NAMES.findIndex(
      (n) => n && n.toLowerCase().startsWith(dMy[2].toLowerCase().slice(0, 3))
    );
    if (m > 0) return `${dMy[3]}-${p2(m)}-${p2(dMy[1])}`;
  }
  return "";
};

// "2026-01-07" → "7 Jan 2026"
const formatISODate = (iso) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso || "");
  if (!m) return "";
  const mm = Number(m[2]);
  return MONTH_NAMES[mm] ? `${Number(m[3])} ${MONTH_NAMES[mm].slice(0, 3)} ${m[1]}` : "";
};

/* The reporting window, which arrives as one opaque string — and in three
   different date shapes depending on which endpoint produced it. Split into
   its two ends so the card can lay them out as a range rather than printing
   "2026-01-07 to 2026-04-06" as a title. Returns null when it can't be read,
   and the caller falls back to showing the raw string unchanged. */
const parsePeriod = (raw) => {
  const s = String(raw ?? "").trim();
  if (!s) return null;
  const parts = s.split(/\s+to\s+/i);
  if (parts.length !== 2) return null;
  const startISO = reportDateISO(parts[0]);
  const endISO = reportDateISO(parts[1]);
  const start = formatISODate(startISO);
  const end = formatISODate(endISO);
  if (!start || !end) return null;
  // Inclusive of both ends: 7 Jan → 6 Apr is 90 days, which is what the
  // report's own calendarDays says for a full-window resource.
  const span = daysBetween(startISO, endISO);
  return {
    start, end,
    days: Number.isFinite(span) && span >= 0 ? span + 1 : null,
  };
};

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

  const [quarterly, setQuarterly] = useState(null);
  const [quarterlyLoading, setQuarterlyLoading] = useState(false);
  const [quarterlyError, setQuarterlyError] = useState(null);

  /* Quarterly cost is a second, independent call. It's supporting detail on
     top of the attendance report, so a failure here only drops the Cost
     column — the attendance table still renders. */
  const [quarterlyCost, setQuarterlyCost] = useState(null);
  const [quarterlyCostError, setQuarterlyCostError] = useState(null);

  /* Who held each designation over the activity, and where one person handed
     over to another. The attendance table shows a departed resource and their
     replacement as two unrelated rows; this is the only place that says they
     are the same seat. */
  const [replacements, setReplacements] = useState(null);
  const [replacementsError, setReplacementsError] = useState(null);
  const [replacementsLoading, setReplacementsLoading] = useState(false);
  const [replacementsOpen, setReplacementsOpen] = useState(false);

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

  /* The monthly view is gone — this page reports a milestone's activity over
     the milestone's own window, which a calendar month can only ever cut
     across. One report, so no switch. */

  /* Bumped to re-run the three report fetches without changing any filter.
     Two things need it: the Refresh buttons beside each table, and a finished
     upload — the rows the upload just created are exactly the rows on screen,
     and before this the only way to see them was to change the month or
     quarter and change it back. */
  const [refreshKey, setRefreshKey] = useState(0);
  const refresh = () => setRefreshKey((k) => k + 1);

  /* Header template download. The endpoint is built for a date range, and the
     header has no dates of its own, so the range comes from the Year + Month
     controls right below it: a chosen month covers that month, no month picked
     covers the whole year. The exact range is spelled out in the button's
     tooltip so it's never a guess — which matters more now the picker reads
     "Select Month" rather than announcing the year fallback. */
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

  /* ── milestone → activity filter ──────────────────────────────────────
     Applied to the rows after they arrive, not to the request: the report
     endpoints accept milestoneId and activityId and ignore both (verified — a
     nonsense id returns every row unchanged), and every row carries the two
     fields, so the filtering happens here. It narrows what is displayed; it
     does not reduce what is fetched.

     "" = no filter. UNASSIGNED is no longer offered in the dropdown, but the
     value is still handled everywhere below: a URL saved while the option
     existed still carries ?milestone=__none__, and the branches keep such a
     link showing the unassigned rows it was saved for rather than an
     unexplained empty table. Nothing in the UI can produce it any more. */
  const UNASSIGNED = "__none__";
  /* ── the filter lives in the URL, not in component state ──────────────
     A leave detail returns here with navigate(-1). Held in useState, the
     selection is gone by the time this remounts, so coming back from one
     employee landed on "Select Milestone" with both dropdowns to redo. As
     search params it rides the history entry and comes back with it.

     `replace` rather than push: picking a milestone and then an activity
     would otherwise leave two dead entries for Back to walk through before
     it reached wherever the user actually came from. */
  const [searchParams, setSearchParams] = useSearchParams();
  const filterMilestoneId = searchParams.get("milestone") || "";
  const filterActivityId = searchParams.get("activity") || "";

  const setFilter = useCallback(
    (patch) => {
      setSearchParams((prev) => {
        const next = new URLSearchParams(prev);
        Object.entries(patch).forEach(([k, v]) => {
          if (v) next.set(k, v);
          else next.delete(k);
        });
        return next;
      }, { replace: true });
    },
    [setSearchParams]
  );

  /* Changing the milestone drops the activity, which belonged to the old one.
     Done here, on the user's action, rather than in the load effect below —
     that effect also runs on mount, so clearing there would wipe the very
     activity being restored from the URL on the way back from a detail. */
  const setFilterMilestoneId = useCallback(
    (id) => setFilter({ milestone: id, activity: "" }),
    [setFilter]
  );
  const setFilterActivityId = useCallback(
    (id) => setFilter({ activity: id }),
    [setFilter]
  );

  const [filterActivities, setFilterActivities] = useState([]);
  const [filterActivitiesLoading, setFilterActivitiesLoading] = useState(false);

  /* Activities of the chosen milestone. Reloaded on every change so the second
     dropdown can only ever offer activities that belong to the first — the
     same cascade the upload modal uses. */
  useEffect(() => {
    if (!filterMilestoneId || filterMilestoneId === UNASSIGNED) {
      setFilterActivities([]);
      return undefined;
    }
    let active = true;
    setFilterActivitiesLoading(true);
    (async () => {
      const list = await loadActivitiesForMilestone(filterMilestoneId);
      if (!active) return;
      setFilterActivities(Array.isArray(list) ? list : []);
      setFilterActivitiesLoading(false);
    })();
    return () => { active = false; };
  }, [filterMilestoneId]);

  /* A URL can name an activity that doesn't belong to the milestone beside it
     — bookmarked before the activity moved, or hand-edited. Left alone, the
     dropdown shows blank while the page fetches against an id it can't
     display, which reads as "no data" rather than as a bad selection.

     Only checked once the list has actually arrived: clearing while it's
     still loading would drop the very selection being restored. */
  useEffect(() => {
    if (filterActivitiesLoading || !filterActivityId || !filterActivities.length) return;
    const known = filterActivities.some(
      (a) => String(a.apiId) === String(filterActivityId)
    );
    if (!known) setFilterActivityId("");
  }, [filterActivities, filterActivitiesLoading, filterActivityId, setFilterActivityId]);

  /* ── the period, taken from the milestone rather than asked for ───────
     Year and Quarter are gone as controls. The milestone's own window says
     which quarters and months the reports should cover; a span crossing more
     than one quarter is fetched in full and merged, since the endpoint only
     answers one quarter at a time.

     `year` / `quarter` survive as the FIRST period in the span. They still key
     the holiday calendar, the labels and the leave-detail link, none of which
     take a range. */
  const selectedMilestone = useMemo(
    () => uploadableMilestones.find((m) => String(m.apiId) === String(filterMilestoneId)) || null,
    [uploadableMilestones, filterMilestoneId]
  );
  /* The report itself is fetched over the milestone's whole window, so these
     two exist only for the things that still take a single year and quarter:
     the holiday calendar, the table's labels, and the leave-detail link. They
     name the quarter the milestone STARTS in. */
  const startParts = /^(\d{4})-(\d{2})-\d{2}$/.exec(selectedMilestone?.startDate || "");
  const year = startParts ? Number(startParts[1]) : CURRENT_YEAR;
  const quarter = startParts ? Math.ceil(Number(startParts[2]) / 3) : DEFAULT_QUARTER;

  /* The holiday calendar is the one thing here that isn't tied to the
     milestone — holidays belong to the project's whole life, and someone
     checking them usually wants a year the current milestone doesn't touch.
     So it gets its own year, offered across the project's span rather than
     pinned to whichever year the selected milestone happens to start in.

     Declared after `year` above, which it seeds from. */

  /* The project's own window, from GET /projects/{id}. The store copy is
     empty on a deep link — landing straight on this URL never runs the
     projects list that fills it — so the store is only the fallback here.
     (LeaveUploadModal reads the same endpoint for the vendor list, but it
     only mounts once the upload dialog is opened.) */
  const [projectWindow, setProjectWindow] = useState({ start: "", end: "" });
  useEffect(() => {
    if (!projectId) return undefined;
    let active = true;
    (async () => {
      try {
        const res = await authorizedFetch(
          `${GATEWAY_BASE}${ENDPOINTS.projects.get(projectId)}`,
          { method: "GET", headers: { accept: "application/json" } }
        );
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const raw = await res.json().catch(() => ({}));
        const body = (raw?.data ?? raw) || {};
        if (!active) return;
        setProjectWindow({
          start: String(body.startDate || body.start_date || ""),
          end: String(body.endDate || body.end_date || ""),
        });
      } catch {
        /* Non-fatal: the year picker just falls back to the store, and to
           the milestone's single year if that's empty too. */
        if (active) setProjectWindow({ start: "", end: "" });
      }
    })();
    return () => { active = false; };
  }, [projectId]);

  const projectYears = useMemo(() => {
    const a = /^(\d{4})/.exec(String(projectWindow.start || project?.startDate || ""));
    const b = /^(\d{4})/.exec(String(projectWindow.end || project?.endDate || ""));
    if (!a || !b) return [];
    const from = Number(a[1]);
    const to = Number(b[1]);
    if (to < from || to - from > 50) return [];
    return Array.from({ length: to - from + 1 }, (_, i) => from + i);
  }, [projectWindow.start, projectWindow.end, project?.startDate, project?.endDate]);

  const [holidayYear, setHolidayYear] = useState(null);
  /* Defaults to the milestone's year, but only once and only if the project
     actually covers it — after that it's the user's to change. */
  useEffect(() => {
    if (holidayYear !== null) return;
    const y = parseYear(year);
    if (y === null) return;
    if (projectYears.length && !projectYears.includes(y)) {
      setHolidayYear(projectYears.includes(CURRENT_YEAR) ? CURRENT_YEAR : projectYears[0]);
      return;
    }
    setHolidayYear(y);
  }, [holidayYear, year, projectYears]);
  /* The project loads asynchronously, so a year picked before its span was
     known can end up outside the options list — a <select> showing a value it
     doesn't offer. Pull it back in when the span finally arrives. */
  useEffect(() => {
    if (holidayYear === null || !projectYears.length) return;
    if (projectYears.includes(holidayYear)) return;
    setHolidayYear(projectYears.includes(CURRENT_YEAR) ? CURRENT_YEAR : projectYears[0]);
  }, [holidayYear, projectYears]);

  const activeHolidayYear = holidayYear ?? parseYear(year) ?? CURRENT_YEAR;

  /* The milestone's window as the range the period reports are fetched over.
     Null until a milestone with usable dates is chosen, which is what gates
     those two calls.

     Memoised because both fetch effects take it as a dependency: a fresh
     object literal every render would make them refetch on every render. */
  const milestoneRange = useMemo(
    () =>
      selectedMilestone?.startDate && selectedMilestone?.endDate
        ? { start: selectedMilestone.startDate, end: selectedMilestone.endDate }
        : null,
    [selectedMilestone?.startDate, selectedMilestone?.endDate]
  );

  const filterActive = !!filterMilestoneId;

  /* Nothing is shown until a milestone AND an activity have been chosen — the
     tables are a view onto one activity's team, not a project-wide dump you
     then narrow. Two exceptions, both cases where asking for an activity would
     be a dead end rather than a step:
       · "No milestone" — those rows have no activity to pick either.
       · a milestone with no activities at all — otherwise unreachable. */
  const milestoneHasNoActivities =
    !!filterMilestoneId &&
    filterMilestoneId !== UNASSIGNED &&
    !filterActivitiesLoading &&
    filterActivities.length === 0;
  const selectionComplete =
    filterMilestoneId === UNASSIGNED ||
    milestoneHasNoActivities ||
    (!!filterMilestoneId && !!filterActivityId);

  /* What's still missing, as the prompt the tables show in place of data. */
  const selectionPrompt = !filterMilestoneId
    ? {
        title: "Select a milestone to begin",
        hint: "Pick a milestone above, then the activity within it, and the team's attendance loads here.",
      }
    : {
        title: "Now select an activity",
        hint: filterActivitiesLoading
          ? "Loading the activities for this milestone…"
          : "Choose one of this milestone's activities above to see its team's attendance.",
      };
  /* One predicate for both tables, so monthly and quarterly can't drift on
     what "matching" means. */
  const matchesFilter = useCallback(
    (r) => {
      if (!filterMilestoneId) return true;
      if (filterMilestoneId === UNASSIGNED) return !r.milestoneId;
      if (String(r.milestoneId || "") !== String(filterMilestoneId)) return false;
      if (!filterActivityId) return true;
      return String(r.activityId || "") === String(filterActivityId);
    },
    [filterMilestoneId, filterActivityId]
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

  /* The period drives three API calls, so it's checked before a request is
     built rather than after the backend rejects one. It now comes from the
     milestone's stored dates rather than from selects — which is MORE reason
     to check it, not less: a milestone saved with a malformed or inverted
     window would otherwise turn into three 400s reading "(400)". */
  const paramError = useMemo(() => {
    if (!projectId) return "No project was specified in the link.";
    if (selectedMilestone && !milestoneRange) {
      return `"${selectedMilestone.name || "This milestone"}" has no usable start and end date, so there's no period to report on.`;
    }
    if (parseYear(year) === null) return `"${year}" isn't a valid year (${MIN_YEAR}–${MAX_YEAR}).`;
    if (parseQuarter(quarter) === null) return `"${quarter}" isn't a valid quarter — it must be 1 to 4.`;
    return "";
  }, [projectId, year, quarter, selectedMilestone, milestoneRange]);

  /* Whether an upload can start, and why not when it can't. Derived once
     because three controls now offer the action — the header button and the
     two empty states — and three copies of this condition would eventually
     disagree about when it's allowed. Declared after paramError, which it
     reads. */
  const uploadBlocked =
    milestonesLoading || uploadableMilestones.length === 0 || !!paramError;
  const uploadHint = paramError
    ? "Fix the filters above before uploading"
    : milestonesLoading
      ? "Loading milestones…"
      : uploadableMilestones.length === 0
        ? "No resource-based milestones are ready for upload"
        : "Upload attendance for a resource-based milestone";

  // Quarterly leave policy
  useEffect(() => {
    if (paramError) { setQuarterlyLoading(false); return undefined; }
    /* Both calls below are keyed on the milestone AND activity — the endpoint
       answers 400 without the milestone even though the activity implies it. */
    if (!filterMilestoneId || !filterActivityId) {
      setQuarterly(null);
      setQuarterlyError(null);
      setQuarterlyLoading(false);
      return undefined;
    }
    const FALLBACK = "Couldn't load the attendance for this milestone.";
    let active = true;
    const controller = new AbortController();
    (async () => {
      setQuarterlyLoading(true);
      setQuarterlyError(null);
      try {
        const token = getToken();
        /* Activity-scoped. The server picks the period itself — it reports one
           of the activity's month bands and returns which one as
           reportStartDate/reportEndDate. startDate/endDate are NOT accepted as
           a way to ask for a different band (verified: passing the 2nd and 3rd
           bands both came back as the 1st), so no range is sent.

           It also carries the activity's own name and window, plus
           configuredResourceCount vs uploadedResourceCount — how many people
           the activity expects against how many have attendance in. */
        const qs = new URLSearchParams({
          projectId,
          milestoneId: filterMilestoneId,
          activityId: filterActivityId,
        });
        const res = await fetch(
          `${API_BASE}/api/attendance/report/activity?${qs}`,
          {
            signal: controller.signal,
            cache: "no-store",
            headers: token ? { Authorization: `Bearer ${token}` } : {},
          }
        );
        // A period with nothing logged is an ordinary state, not a failure.
        if (res.status === 404) {
          if (active) { setQuarterly(null); setQuarterlyError(null); }
          return;
        }
        if (!res.ok) throw new Error(await readErrorMessage(res, FALLBACK));
        const data = await readJsonBody(res, FALLBACK);
        if (active) setQuarterly(data);
      } catch (err) {
        const msg = requestErrorMessage(err, FALLBACK);
        /* Drop the previous activity's rows on the way out — keeping them
           meant a failed load could sit behind its own error showing another
           activity's numbers. */
        if (active) { setQuarterly(null); if (msg) setQuarterlyError(msg); }
      } finally {
        if (active) setQuarterlyLoading(false);
      }
    })();
    return () => { active = false; controller.abort(); };
  }, [projectId, filterMilestoneId, filterActivityId, paramError, refreshKey]);

  /* Quarterly cost — per-resource ₹ for the same quarter, joined onto the
     attendance rows by attendanceId. `resourceId` is optional on this
     endpoint and is deliberately omitted: the table shows the whole team, so
     one call covers every row (pass it only when scoping to one resource).
     Errors are kept out of the main error slot — the Cost column just
     doesn't render. */
  useEffect(() => {
    if (paramError) return undefined;
    // Same reason as the report above — no milestone window, no request.
    if (!filterMilestoneId || !filterActivityId) { setQuarterlyCost(null); return undefined; }
    const FALLBACK = "Couldn't load the quarterly cost.";
    let active = true;
    const controller = new AbortController();
    (async () => {
      setQuarterlyCostError(null);
      try {
        const token = getToken();
        /* Activity-scoped like the report above, so the rows and their costs
           can't describe different periods. Same envelope as cost/quarterly —
           totals plus a resource list carrying monthlyBreakdown — so nothing
           downstream changes. */
        const qs = new URLSearchParams({
          projectId,
          milestoneId: filterMilestoneId,
          activityId: filterActivityId,
        });
        const res = await fetch(
          `${API_BASE}/api/attendance/cost/activity?${qs}`,
          {
            signal: controller.signal,
            cache: "no-store",
            headers: token ? { Authorization: `Bearer ${token}` } : {},
          }
        );
        if (res.status === 404) { if (active) setQuarterlyCost(null); return; }
        if (!res.ok) throw new Error(await readErrorMessage(res, FALLBACK));
        const data = await readJsonBody(res, FALLBACK);
        if (active) setQuarterlyCost(data);
      } catch (err) {
        const msg = requestErrorMessage(err, FALLBACK);
        if (active) { setQuarterlyCost(null); if (msg) setQuarterlyCostError(msg); }
      }
    })();
    return () => { active = false; controller.abort(); };
  }, [projectId, filterMilestoneId, filterActivityId, paramError, refreshKey]);

  /* Replacements. Unlike the two above this needs no milestone — the endpoint
     takes projectId + activityId only, and the activity already implies its
     milestone. */
  useEffect(() => {
    if (paramError || !projectId || !filterActivityId) {
      setReplacements(null);
      setReplacementsError(null);
      return undefined;
    }
    let active = true;
    const controller = new AbortController();
    const FALLBACK = "Couldn't load the replacement history.";
    (async () => {
      setReplacementsLoading(true);
      setReplacementsError(null);
      try {
        const token = getToken();
        const qs = new URLSearchParams({ projectId, activityId: filterActivityId });
        const res = await fetch(
          `${API_BASE}/api/attendance/report/activity/replacements?${qs}`,
          {
            signal: controller.signal,
            cache: "no-store",
            headers: token ? { Authorization: `Bearer ${token}` } : {},
          }
        );
        /* A 404 here means "no such activity report yet", not a failure worth
           an error banner — the button simply doesn't appear. */
        if (res.status === 404) { if (active) setReplacements(null); return; }
        if (!res.ok) throw new Error(await readErrorMessage(res, FALLBACK));
        const data = await readJsonBody(res, FALLBACK);
        if (active) setReplacements(data && typeof data === "object" ? data : null);
      } catch (err) {
        const msg = requestErrorMessage(err, FALLBACK);
        if (active) { setReplacements(null); if (msg) setReplacementsError(msg); }
      } finally {
        if (active) setReplacementsLoading(false);
      }
    })();
    return () => { active = false; controller.abort(); };
  }, [projectId, filterActivityId, paramError, refreshKey]);

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
        const safeYear = parseYear(activeHolidayYear);
        if (safeYear === null) throw new Error(`"${activeHolidayYear}" isn't a valid year.`);
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
  }, [activeHolidayYear]);

  /* Range for the header's template button, derived from Year + Month. */
  /* The header's blank template covers the milestone's own window, which is
     what the table reports over now that the monthly view is gone. */
  const templateRange = useMemo(
    () =>
      milestoneRange
        ? { ...milestoneRange, label: selectedMilestone?.name || "this milestone" }
        : null,
    [milestoneRange, selectedMilestone]
  );

  async function handleHeaderTemplate() {
    if (templateBusy || !activeRange) return;
    setTemplateBusy(true);
    setTemplateMsg(null);
    setTemplateError(null);
    try {
      const filename = await downloadAttendanceTemplate(activeRange.start, activeRange.end);
      setTemplateMsg(`Template downloaded — ${filename}`);
    } catch (err) {
      const msg = requestErrorMessage(err, "Couldn't download the template. Please try again.");
      setTemplateError(msg);
      notifyActionError("Download failed", msg);
    } finally {
      setTemplateBusy(false);
    }
  }

  /* Row click → the full-page leave detail. It needs the ACTIVITY: its leave
     report is scoped to resource + activity now. Year and quarter still ride
     along because the cost report and the relaxation workflow on that page
     remain quarter-keyed; they name the quarter the milestone starts in. */
  const goLeaveDetail = (emp, quarterNum, yearNum = year) =>
    navigate(
      `/projects/${encodeURIComponent(projectId)}/attendance/leave/${encodeURIComponent(emp.attendanceId)}` +
      `?year=${yearNum}&quarter=${quarterNum}` +
      `&activityId=${encodeURIComponent(emp.activityId || filterActivityId || "")}`
    );

  /* One range for everything on the page now: the template the header hands
     out, and the dates the Holiday column counts over. */
  const activeRange = templateRange;
  const quarterlyHolidayTitle = useMemo(
    () => buildHolidayTitle(holidays, milestoneRange),
    [holidays, milestoneRange]
  );

  const quarterlyRows = useMemo(
    () => reportRows(quarterly).filter(matchesFilter),
    [quarterly, matchesFilter]
  );
  // Same reason as the monthly metrics above.
  const quarterlyMetrics = useMemo(
    () => buildMetrics(filterActive ? null : quarterly, quarterlyRows),
    [quarterly, quarterlyRows, filterActive]
  );
  const quarterlyCostById = useMemo(
    () => indexCostByResource(quarterlyCost),
    [quarterlyCost]
  );
  /* Prefer the API's own total; fall back to summing the rows so the footer
     still adds up if `totals` is ever missing.

     With an organisation filter on, the envelope total can't be trusted: the
     cost endpoint ignores organisationId (verified — a nonsense id still
     returns every resource), so its total covers the whole project while the
     rows on screen came from the attendance report, which does filter. Taking
     the envelope figure there would print a total larger than the column above
     it. So when a filter is active the footer is summed from the rows actually
     displayed, which is the only figure that can agree with them. */
  const quarterlyCostTotal = useMemo(() => {
    if (filterActive) {
      return quarterlyRows.reduce(
        (sum, emp) => sum + num(quarterlyCostById.get(String(emp.attendanceId))?.totalCost),
        0
      );
    }
    const t = reportTotals(quarterlyCost);
    if (t && t.totalCost != null) return num(t.totalCost);
    let sum = 0;
    quarterlyCostById.forEach((r) => { sum += num(r.totalCost); });
    return sum;
  }, [quarterlyCost, quarterlyCostById, quarterlyRows, filterActive]);

  return (
    <div className="uidai-pmis-content att-page">
      <style>{ATT_CSS}</style>

      {/* Header — upload is the page's primary action, so it sits up here
          rather than in a table of its own. */}
      <header className="att-head">
        <div className="att-head-main">
          <div className="att-eyebrow">{project?.projectName || "Project"}</div>
          <h1 className="uidai-pmis-title att-title">Attendance</h1>
        </div>
        {/* The two upload-flow actions, together: you download the blank
            template in order to fill it in and upload it, so separating them
            put the two halves of one task in different places. The rest of the
            secondary actions stay in the toolbar with the filters. */}
        <div className="att-head-actions">
          <button
            className="att-btn-secondary"
            onClick={handleHeaderTemplate}
            disabled={templateBusy || !activeRange}
            title={
              activeRange
                ? `Download a blank attendance template for ${activeRange.label} (${activeRange.start} → ${activeRange.end})`
                : "Choose a milestone and activity first"
            }
          >
            <DownloadIcon />
            {templateBusy ? "Preparing…" : "Template"}
          </button>
          <button
            className="att-btn-primary"
            onClick={() => setUploadOpen(true)}
            disabled={uploadBlocked}
            title={uploadHint}
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

      {/* One filter row for the whole page: milestone, then its activity. The
          period isn't a control at all — the milestone's own window is the
          reporting range. */}
      <div className="att-toolbar">
        <div className="att-controls">
          {/* Milestone first, then the activities belonging to it — Activity
              stays disabled until a milestone is chosen, because an activity
              means nothing without one.

              The same resource-based list the upload modal offers, and for the
              same reason: attendance can only be filed against a resource-based
              milestone, so every milestone that appears in this data is one.
              Listing the rest would offer filters guaranteed to match nothing. */}
          {uploadableMilestones.length > 0 && (
            <Field label="Milestone">
              <select
                className="att-select att-select--org"
                value={filterMilestoneId}
                onChange={(e) => setFilterMilestoneId(e.target.value)}
                title="Show only rows uploaded against one milestone"
              >
                {/* Not "All milestones" — nothing loads until one is picked,
                    so the placeholder has to read as the prompt it is. */}
                <option value="">Select Milestone</option>
                {uploadableMilestones.map((m) => (
                  <option key={m.apiId} value={m.apiId}>
                    {[m.serverDisplayCode || m.id, m.name].filter(Boolean).join(" · ")}
                  </option>
                ))}
              </select>
            </Field>
          )}
          {uploadableMilestones.length > 0 && (
            <Field label="Activity">
              <select
                className="att-select att-select--org"
                value={filterActivityId}
                disabled={
                  !filterMilestoneId ||
                  filterMilestoneId === UNASSIGNED ||
                  filterActivitiesLoading ||
                  filterActivities.length === 0
                }
                onChange={(e) => setFilterActivityId(e.target.value)}
              >
                <option value="">
                  {!filterMilestoneId
                    ? "Choose a milestone first"
                    : filterMilestoneId === UNASSIGNED
                      ? "Not applicable"
                      : filterActivitiesLoading
                        ? "Loading activities…"
                        : filterActivities.length === 0
                          ? "No activities"
                          : "Select Activity"}
                </option>
                {filterActivities.map((a) => (
                  <option key={a.apiId} value={a.apiId}>
                    {[a.serverDisplayCode || a.id, a.name].filter(Boolean).join(" · ")}
                  </option>
                ))}
              </select>
            </Field>
          )}
          {/* The Organisation filter is gone: an activity belongs to exactly
              one vendor, so once one is chosen the organisation is already
              decided. Keeping the control could only ever contradict the
              activity and produce an empty table. */}
        </div>
        {/* Every secondary action, in one place. They were split across the
            header, this row and the section heading, which made the page read
            as three separate toolbars for one report. */}
        <div className="att-toolbar-actions">
          {/* Only once an activity is chosen — there is nothing to ask for
              before that, and a disabled button would just be noise. The modal
              carries its own loading and error states, so the button stays put
              instead of appearing and vanishing as the request settles. */}
          {!!filterActivityId && (
            <button
              className="att-btn-secondary"
              onClick={() => setReplacementsOpen(true)}
              title="Who held each designation over this activity, and where one person replaced another."
            >
              <UsersIcon />
              Replacements
              {num(replacements?.totalReplacements) > 0 && (
                <span className="att-btn-badge">{num(replacements.totalReplacements)}</span>
              )}
            </button>
          )}
          <button className="att-btn-secondary" onClick={() => setHolidayOpen(true)}>
            <CalendarIcon />
            Holidays
          </button>
          <RefreshButton onClick={refresh} busy={quarterlyLoading} />
        </div>
      </div>

      {/* The only report on this page, so it carries no heading of its own —
          "Quarterly Attendance" under a page titled "Attendance" was naming
          the same thing twice. Refresh moved up into the toolbar with the
          other secondary actions. */}
      <section className="att-section">
        {!selectionComplete && (
          <EmptyState icon={<LayersIcon />} title={selectionPrompt.title} hint={selectionPrompt.hint} />
        )}
        {selectionComplete && quarterlyLoading && <SkeletonTable rows={5} cols={7} />}
        {selectionComplete && quarterlyError && <div className="att-error">{quarterlyError}</div>}
        {selectionComplete && !quarterlyLoading && !quarterlyError && (
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
            onUpload={() => setUploadOpen(true)}
            uploadBlocked={uploadBlocked}
            uploadHint={uploadHint}
            filterActive={filterActive}
          />
        )}
      </section>

      {replacementsOpen && (
        <ReplacementsModal
          data={replacements}
          loading={replacementsLoading}
          error={replacementsError}
          onClose={() => setReplacementsOpen(false)}
        />
      )}

      {holidayOpen && (
        <HolidayModal
          year={activeHolidayYear}
          years={projectYears}
          onYearChange={setHolidayYear}
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
          onUploaded={refresh}
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

  /* Billable days for a row. The cost payload states this per month, not per
     resource, so a row's figure is the sum of its bands — the same numbers
     the leave-detail table lists month by month. Only months that actually
     carry the field are counted: summing over months that don't would report
     a confident 0 for a figure the server never sent. */
  const billableDaysOf = (c) => {
    if (!c) return null;
    if (c.billableDays != null) return num(c.billableDays);
    const months = Array.isArray(c.monthlyBreakdown) ? c.monthlyBreakdown : [];
    const stated = months.filter((m) => m?.billableDays != null);
    if (!stated.length) return null;
    return stated.reduce((t, m) => t + num(m.billableDays), 0);
  };
  /* Half days make these fractional, so 21.5 has to survive — but 21.0 should
     read as 21 rather than as a suspiciously precise 21.00. */
  const days = (v) => (Number.isInteger(v) ? String(v) : String(Number(v.toFixed(2))));
  /* Sandwich days — weekends and holidays falling between leave days, charged
     as leave. Stated per month like billableDays and with no resource-level
     total, so a row's figure is the sum of its bands. */
  const sandwichOf = (c) => {
    if (!c) return null;
    if (c.sandwichLeave != null) return num(c.sandwichLeave);
    const months = Array.isArray(c.monthlyBreakdown) ? c.monthlyBreakdown : [];
    const stated = months.filter((m) => m?.sandwichLeave != null);
    if (!stated.length) return null;
    return stated.reduce((t, m) => t + num(m.sandwichLeave), 0);
  };

  /* A column of dashes says less than no column — same rule as Joined. */
  const showBillable =
    showCost && employees.some((e) => billableDaysOf(costFor(e)) != null);
  /* Shown whenever the figure is reported, including when every row is 0 —
     "nobody lost a weekend to sandwich leave this quarter" is an answer, and a
     column that vanishes on zero would leave you unsure it was ever checked. */
  const showSandwich =
    showCost && employees.some((e) => sandwichOf(costFor(e)) != null);
  const billableTotal = employees.reduce(
    (t, e) => t + (billableDaysOf(costFor(e)) ?? 0), 0
  );
  // The report now splits leave into paid/unpaid and leaves `leaveDays` at 0.
  // Older payloads only carry `leaveDays`, so pick whichever the rows have.
  const splitLeave = employees.some(
    (e) => e.paidLeaveDays != null || e.unpaidLeaveDays != null
  );
  /* Older payloads carry no joining date; a column of "—" says less than no
     column, so it appears only when at least one row has one. */
  const showJoined = employees.some((e) => e.joiningDate);

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

  const periodRange = useMemo(() => parsePeriod(period), [period]);

  return (
    <div className="uidai-pmis-card att-card">
      <div className="att-card-head">
        {/* Laid out as a range rather than printed as a sentence: the two
            dates are the point, so they carry the weight and "to" becomes an
            arrow between them. Falls back to the raw string if the period
            arrives in a shape parsePeriod doesn't recognise — better an ugly
            label than a missing one. */}
        {periodRange ? (
          <div className="att-period" title={period}>
            <span className="att-period-lbl">Period</span>
            <span className="att-period-range">
              <span className="att-period-date">{periodRange.start}</span>
              <span className="att-period-arrow" aria-hidden="true">→</span>
              <span className="att-period-date">{periodRange.end}</span>
            </span>
            {periodRange.days != null && (
              <span className="att-period-days">{periodRange.days} days</span>
            )}
          </div>
        ) : (
          <strong className="att-card-title">{period}</strong>
        )}
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
        </div>
      </div>
      <div className="att-table-wrap">
        <table className="att-table">
          <thead>
            <tr>
              <th className="att-th">ID</th>
              <th className="att-th">Name</th>
              {showMilestoneCol && <th className="att-th">Milestone</th>}
              {/* Joined and Holiday lead the counts: both say how much of the
                  period this row could have been present for, which is what
                  makes a Working of 36 against everyone else's 60 read
                  correctly rather than looking like missing data. */}
              {showJoined && (
                <th className="att-th" title="The date this employee joined the project.">Joined</th>
              )}
              {/* The dates behind the count sit on both the header and each
                  cell — whichever the pointer lands on, the answer is there. */}
              <th className="att-th att-num" title={holidayTitle}>Holiday</th>
              <th className="att-th att-num" title="Working days = calendar days − week offs − holidays. This is the denominator of Attendance %.">Working</th>
              <th className="att-th att-num" title="Days present = full days present + (half days × 0.5).">Present</th>
              {/* Half-day column withdrawn — half days already count as 0.5
                  inside Present, so the separate tally was double-reporting. */}
              {/* Total first, then the split it breaks into — "6 taken, of
                  which 6 paid and 0 unpaid" reads in the order it's spoken. */}
              <th className="att-th att-num">Leave Taken</th>
              {splitLeave && (
                <>
                  <th className="att-th att-num">Paid Leave</th>
                  <th className="att-th att-num">Unpaid Leave</th>
                </>
              )}
              {/* Sits with the leave columns even though it comes from the cost
                  payload rather than the report — it is leave, and grouping it
                  by data source instead of meaning would be filing it by an
                  accident of the API. */}
              {showSandwich && (
                <th
                  className="att-th att-num"
                  title="Weekends or holidays falling between leave days, counted as leave. Summed across the period's monthly bands."
                >
                  Sandwich
                </th>
              )}
              {/* Week off hidden for now — uncomment with the matching <td> below.
              <th className="att-th att-num">Week off</th>
              */}
              {/* Last of the day counts, closing the run that starts at
                  Holiday — so every column measured in days sits together and
                  Attendance, the only percentage, is what breaks the run. */}
              {showBillable && (
                <th
                  className="att-th att-num"
                  title="Days billed to the client = days on the project − unpaid leave days. Paid leave and holidays stay billable. Summed across the period's monthly bands, so anyone who joined or left partway is counted only for the days they were on it."
                >
                  Billable Days
                </th>
              )}
              <th
                className="att-th att-num att-th-att"
                title="Attendance % = (present days + paid leave) ÷ working days × 100. Half days count as 0.5; weekends and holidays are excluded from working days. Example: (46 present + 6 paid) ÷ 59 × 100 = 88.14%."
              >
                Attendance
              </th>
              {showCost && (
                <th
                  className="att-th att-num"
                  title="Billable cost = billable days × daily rate, where the daily rate is the monthly rate ÷ that month's calendar days. Equivalently, the planned month cost minus the unpaid-leave deduction, summed across the period."
                >
                  Cost
                </th>
              )}
            </tr>
          </thead>
          <tbody>
            {employees.map((emp) => (
              <tr
                className={`att-row${clickable ? " att-row-click" : ""}${
                  emp.active === false ? " att-row--off" : ""
                }`}
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
                  {/* Under the designation rather than beside the name: as a
                      chip next to the name it wrapped to its own line in this
                      column's real width, splitting the name from the job title
                      and making the row a third taller than its neighbours.

                      Explicitly `=== false` — older payloads carry no `active`
                      field at all, and a plain `!emp.active` would brand every
                      row on them as inactive. */}
                  {emp.active === false && (
                    <div
                      className="att-off"
                      title={
                        formatReportDate(emp.lastWorkingDate)
                          ? `No longer on the project — last working day ${formatReportDate(emp.lastWorkingDate)}. The figures on this row cover their time on it.`
                          : "No longer on the project."
                      }
                    >
                      <span className="att-off-dot" aria-hidden="true" />
                      Inactive
                      {formatReportDate(emp.lastWorkingDate) && (
                        <span className="att-off-date">
                          · till {formatReportDate(emp.lastWorkingDate)}
                        </span>
                      )}
                    </div>
                  )}
                </td>
                {showMilestoneCol && (
                  <td className="att-td att-dim" title={emp.milestoneId || ""}>
                    {emp.milestoneId ? labelFor(emp.milestoneId) : "—"}
                  </td>
                )}
                {showJoined && (
                  <td className="att-td att-joined">
                    {formatReportDate(emp.joiningDate) || "—"}
                  </td>
                )}
                <td className="att-td att-num att-dim" title={holidayTitle}>
                  {emp.holidayDays}
                </td>
                <td className="att-td att-num att-dim">{emp.workingDays}</td>
                <td className="att-td att-num">{emp.presentDays}</td>
                <td className={`att-td att-num${leaveTakenOf(emp) > 0 ? "" : " att-dim"}`}>
                  {leaveTakenOf(emp)}
                </td>
                {splitLeave && (
                  <>
                    <td className="att-td att-num">{num(emp.paidLeaveDays)}</td>
                    <td className={`att-td att-num${num(emp.unpaidLeaveDays) > 0 ? " att-warn" : " att-dim"}`}>
                      {num(emp.unpaidLeaveDays)}
                    </td>
                  </>
                )}
                {showSandwich && (() => {
                  const s = sandwichOf(costFor(emp));
                  return (
                    <td className={`att-td att-num${s ? " att-warn" : " att-dim"}`}>
                      {s == null ? "—" : days(s)}
                    </td>
                  );
                })()}
                {/* Week off hidden for now — uncomment with the matching <th> above.
                <td className="att-td att-num att-dim">{emp.weekOffDays}</td>
                */}
                {showBillable && (() => {
                  const b = billableDaysOf(costFor(emp));
                  return (
                    <td className={`att-td att-num${b == null ? " att-dim" : ""}`}>
                      {b == null ? "—" : days(b)}
                    </td>
                  );
                })()}
                <td className="att-td att-num att-att-cell">
                  <AttendanceBar value={emp.attendancePercentage} />
                </td>
                {showCost && (() => {
                  const c = costFor(emp);
                  return (
                    /* The amount in words on hover — at lakh scale a mis-read
                       digit is easy and expensive, and the whole cell is the
                       hover target rather than just the text. */
                    <td
                      className={`att-td att-num${c ? " att-cost-total" : " att-dim"}`}
                      title={c ? rupeesInWords(c.totalCost) : undefined}
                    >
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
                {/* The label spans everything up to Billable Days: six fixed
                    columns — ID, Name, Holiday, Working, Present, Leave Taken —
                    plus Milestone when the rows differ, Joined when the report
                    carries it, the paid/unpaid pair when leave is split, and
                    Sandwich when it's reported. Every optional column before
                    Billable needs its term here, or both totals shift left. */}
                <td
                  className="att-td att-strong"
                  colSpan={
                    6 +
                    (showMilestoneCol ? 1 : 0) +
                    (showJoined ? 1 : 0) +
                    (splitLeave ? 2 : 0) +
                    (showSandwich ? 1 : 0)
                  }
                >
                  Total for {period}
                </td>
                {/* Its own cell rather than another term in the colSpan above —
                    the days total is worth stating, and folding it into the
                    label would push the cost total a column off Cost. */}
                {showBillable && (
                  <td className="att-td att-num att-strong">{days(billableTotal)}</td>
                )}
                {/* Attendance now sits between Billable Days and Cost, and an
                    average of percentages doesn't belong on a totals row — so
                    the column is held open and left blank. */}
                <td className="att-td" />
                <td
                  className="att-td att-num att-strong att-cost-total"
                  title={rupeesInWords(costTotal)}
                >
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
  costById, costTotal, costError, holidayTitle, onUpload, uploadBlocked, uploadHint,
  filterActive,
}) {
  const employees = data ?? [];
  const period = periodProp || employees[0]?.period || `Q${quarter} ${year}`;

  if (employees.length === 0) {
    return (
      <EmptyState
        icon={<CalendarIcon />}
        title={filterActive ? "Nothing matches this filter" : "No attendance yet"}
        hint={
          filterActive
            ? `No Q${quarter} ${year} attendance was uploaded against the selected milestone. Clear the milestone filter to see the whole team.`
            : `Upload a spreadsheet to record the team's attendance for Q${quarter} ${year} and start tracking leave and cost.`
        }
        action={
          !filterActive && onUpload && (
            <button
              className="att-btn-primary"
              onClick={onUpload}
              disabled={uploadBlocked}
              title={uploadHint}
            >
              <UploadIcon />
              Upload attendance
            </button>
          )
        }
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
          /* The card rounds to whole rupees, so the tooltip carries both the
             exact figure and its words — this is the one place the paise
             aren't on screen at all. */
          title={`${money(costTotal)} — ${rupeesInWords(costTotal)}`}
          compact
        />
      )}
      {/* The caveat matters more than the formula here: this is a mean OF
          percentages, so a resource who worked three days counts as much as
          one who worked the whole quarter. Anyone reading it as "the team's
          attendance" would be reading it as the wrong thing. */}
      <StatCard
        label="Avg attendance"
        value={`${metrics.avg.toFixed(1)}%`}
        sub={`${attTone(metrics.avg).label} overall`}
        tone={attTone(metrics.avg).color}
        title="The average of every listed resource's attendance percentage. Each resource counts equally regardless of how many days they worked — it is not recomputed from the team's summed days."
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
function LeaveUploadModal({ projectId, milestones = [], onUploaded, onClose }) {
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
  /* The period is chosen as one of the activity's own months rather than typed
     into two calendars: an upload covers exactly one of those months, so the
     pickers only ever offered ways to get it wrong. `period` holds the picked
     band's "start|end"; startDate/endDate stay as the derived pair because
     everything downstream — the template download, the rate-year lookup, the
     outside-milestone check, the POST — already speaks in them. */
  const activity = activities.find((a) => String(a.apiId) === String(activityId)) || null;
  const periodOptions = useMemo(
    () => (activity ? monthlyBands(activity.startDate, activity.endDate) : []),
    [activity]
  );
  const [period, setPeriod] = useState("");
  const [startDate, endDate] = period ? period.split("|") : ["", ""];

  // A period from a previously-chosen activity can't survive a new one.
  useEffect(() => { setPeriod(""); }, [activityId]);

  /* The organisation is the activity's own vendor, not a choice — one is set
     when the activity is created, so asking again could only ever file the
     attendance against the wrong one. The project's vendor list is still
     fetched, but purely to turn that id into a name worth reading.

     The activity LIST endpoint returns summaries and may omit vendorId, so
     the full record is fetched when it's missing rather than assumed absent. */
  const [orgs, setOrgs] = useState([]);
  const [orgsLoading, setOrgsLoading] = useState(true);
  const [activityVendorId, setActivityVendorId] = useState("");

  useEffect(() => {
    if (!activity) { setActivityVendorId(""); return undefined; }
    if (activity.vendorId) { setActivityVendorId(activity.vendorId); return undefined; }
    let active = true;
    (async () => {
      const full = await loadActivityById(activity.apiId).catch(() => null);
      if (active) setActivityVendorId(full?.vendorId || "");
    })();
    return () => { active = false; };
  }, [activity]);

  const organisationId = activityVendorId;
  const organisationName =
    orgs.find((o) => String(o.id) === String(organisationId))?.name || "";
  const [file, setFile] = useState(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState(null);
  const [done, setDone] = useState(false);
  // Holds the actual message returned by the API so the popup reflects
  // what the backend reported, rather than a hardcoded string.
  const [responseMessage, setResponseMessage] = useState("");
  // Per-field messages, shown once a submit has been attempted.
  const [fieldErrors, setFieldErrors] = useState({});
  const [submitted, setSubmitted] = useState(false);

  /* Which rate year the chosen dates land in. The user doesn't pick this —
     the server derives it from the range — but that left them uploading
     against a rate they couldn't see. Read-only, and resolved by the same
     endpoint the Designation Rate page uses, so what's shown here is the
     server's own answer rather than a band worked out client-side.

     A range can straddle a boundary and come back with two, which is worth
     knowing before uploading rather than after. */
  const [rateYears, setRateYears] = useState([]);
  const [rateYearsLoading, setRateYearsLoading] = useState(false);

  useEffect(() => {
    // All four params are required; the endpoint 400s without the dates.
    if (!projectId || !organisationId || !startDate || !endDate) {
      setRateYears([]);
      return undefined;
    }
    let active = true;
    const controller = new AbortController();
    setRateYearsLoading(true);
    (async () => {
      try {
        const token = getToken();
        const res = await fetch(
          `${API_BASE}${ENDPOINTS.designationRates.rateYear(
            projectId, organisationId, startDate, endDate
          )}`,
          {
            signal: controller.signal,
            headers: { accept: "*/*", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
          }
        );
        if (!res.ok) throw new Error("unavailable");
        const data = await res.json().catch(() => null);
        if (active) setRateYears(Array.isArray(data) ? data : []);
      } catch {
        /* Non-fatal: the upload doesn't depend on this, so a failure just
           falls back to the generic "matched automatically" line. */
        if (active) setRateYears([]);
      } finally {
        if (active) setRateYearsLoading(false);
      }
    })();
    return () => { active = false; controller.abort(); };
  }, [projectId, organisationId, startDate, endDate]);

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
        /* No default is chosen any more — the organisation comes from the
           activity. This list is only a name lookup. */
        if (active) setOrgs(list);
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
    /* Required now that the period comes from it — without an activity there
       are no months to choose between. */
    if (!activityId) {
      errs.activity = activities.length === 0 && !activitiesLoading
        ? "This milestone has no activities, so there's nothing to upload against."
        : "Choose the activity this attendance belongs to.";
    } else if (!periodOptions.length) {
      errs.activity = "This activity has no start and end date, so there are no months to upload for.";
    }
    /* Every activity is created with an organisation, so this is a guard
       against bad data rather than a step the user missed — worth saying
       plainly, since the upload can't be filed without one. */
    if (activityId && !organisationId) {
      errs.organisation =
        "This activity has no organisation set, so the upload can't be filed. Set one on the milestone configuration page.";
    }
    if (!period) {
      errs.period = "Choose the month this attendance covers.";
    } else {
      // The band comes from a fixed list, so this only catches a corrupt value.
      const rangeError = validateRange(startDate, endDate);
      if (rangeError) errs.period = rangeError;
    }
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

  const upload = async () => {
    if (uploading) return;                    // guards a double-click
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
      /* Refetch behind the success panel, so the new rows are already there
         when the user closes it rather than a step they have to think of. */
      onUploaded?.();
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
              {/* Required, not optional: the upload's period is one of this
                  activity's own months, so without it there is nothing to
                  choose from below. */}
              <Field label="Activity">
                <select
                  id="upl-activity"
                  className={`att-select att-select--wide${fieldErrors.activity ? " is-bad" : ""}`}
                  value={activityId}
                  disabled={!milestone || activitiesLoading || activities.length === 0}
                  aria-invalid={!!fieldErrors.activity}
                  onChange={(e) => { setActivityId(e.target.value); setError(null); revalidate(); }}
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
                {fieldErrors.activity && <span className="att-field-err">{fieldErrors.activity}</span>}
              </Field>
              {/* Read-only: it comes from the activity. Still shown rather than
                  hidden — an upload writes payroll-affecting data, so the
                  vendor it lands against is worth naming before you commit,
                  even though it isn't a decision. */}
              <Field label="Organisation">
                <div
                  id="upl-organisation"
                  className={`att-static${fieldErrors.organisation ? " is-bad" : ""}`}
                >
                  {!activityId
                    ? "Set by the activity"
                    : organisationName ||
                      (orgsLoading ? "Loading…" : organisationId || "Not set on this activity")}
                </div>
                {fieldErrors.organisation && <span className="att-field-err">{fieldErrors.organisation}</span>}
              </Field>
              {/* Monthly is the only type the API supports, so it's stated
                  rather than offered — a one-option dropdown asks for a
                  decision that doesn't exist. */}
              <Field label="Upload type">
                <div className="att-static">Monthly</div>
              </Field>
              {/* One dropdown of the activity's own months, in place of two
                  calendars. An upload covers exactly one of these, so free
                  date entry only ever offered ways to miss a boundary. */}
              <Field label="Period">
                <select
                  id="upl-period"
                  className={`att-select att-select--wide${fieldErrors.period ? " is-bad" : ""}`}
                  value={period}
                  disabled={!activityId || periodOptions.length === 0}
                  aria-invalid={!!fieldErrors.period}
                  onChange={(e) => { setPeriod(e.target.value); setError(null); revalidate(); }}
                >
                  <option value="">
                    {!activityId
                      ? "Choose an activity first"
                      : periodOptions.length === 0
                        ? "This activity has no dates set"
                        : "Select a month…"}
                  </option>
                  {periodOptions.map((b) => (
                    <option key={`${b.start}|${b.end}`} value={`${b.start}|${b.end}`}>
                      {formatReportDate(b.start)} → {formatReportDate(b.end)}
                    </option>
                  ))}
                </select>
                {fieldErrors.period && <span className="att-field-err">{fieldErrors.period}</span>}
              </Field>
            </div>
            {/* The rate year used to be picked here. It's still not a choice —
                the server derives it from the range — but it IS named now, so
                the upload isn't filed against a rate the user can't see. Falls
                back to the old generic line when the lookup can't answer. */}
            {startDate && endDate && !fieldErrors.period && (
              rateYearsLoading ? (
                <div className="att-note" role="status">Matching the rate year…</div>
              ) : rateYears.length > 0 ? (
                <div
                  className={`att-note${rateYears.length > 1 ? " att-note--warn" : ""}`}
                  role="status"
                >
                  <div className="att-ry-head">
                    {rateYears.length > 1
                      ? "These dates span two rate years"
                      : "Rate year for these dates"}
                  </div>
                  {rateYears.map((y) => (
                    <div key={y.rateYear} className="att-ry-row">
                      <span className="att-ry-name">{y.rateYear}</span>
                      <span className="att-ry-range">
                        {formatReportDate(y.effectiveFrom)} → {formatReportDate(y.effectiveTo)}
                      </span>
                    </div>
                  ))}
                  {/* Straddling a boundary means part of the sheet is rated at
                      one year's card and part at the next — fine, but only if
                      it was intended. */}
                  {rateYears.length > 1 && (
                    <div className="att-ry-note">
                      Each day is rated against the year it falls in. Split the upload
                      if you meant it to sit in one.
                    </div>
                  )}
                </div>
              ) : (
                <div className="att-note" role="status">
                  The rate year is matched automatically from these dates.
                </div>
              )
            )}
            {outsideMilestone && !fieldErrors.period && (
              <div className="att-note att-note--warn" role="status">
                These dates fall outside the milestone's own range
                ({milestone.startDate || "—"} → {milestone.endDate || "—"}). You can still
                upload, but check you've picked the right milestone.
              </div>
            )}

            {/* The template download lives on the page header, not here. Two
                buttons for one action, each scoped to a different range, meant
                the sheet you downloaded need not match the period you then
                uploaded against. */}
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
/* ─────────────────────────────────────────────────────────────────────────
   Replacements — who held each designation over the activity.

   The attendance table lists a departed resource and the person who took
   their place as two unrelated rows; the only hint of a connection is one of
   them being marked inactive. This says outright that they are the same seat,
   and in what order it changed hands.
   ───────────────────────────────────────────────────────────────────────── */
function ReplacementsModal({ data, loading, error, onClose }) {
  useModalChrome(onClose);

  /* Memoised because `ordered` below depends on it: the `: []` branch hands
     back a fresh array every render, which would re-sort on every render. */
  const rawDesignations = data?.designations;
  const designations = useMemo(
    () => (Array.isArray(rawDesignations) ? rawDesignations : []),
    [rawDesignations]
  );

  const ordered = useMemo(() => {
    /* Designations that changed hands lead — that is what anyone opening this
       came for; the stable ones are context. Ties hold the server's order
       rather than re-sorting by name, so the list doesn't reshuffle itself
       between two payloads that mean the same thing. */
    return designations
      .map((d, i) => ({ d, i }))
      .sort((a, b) => num(b.d.replacementCount) - num(a.d.replacementCount) || a.i - b.i)
      .map((x) => x.d);
  }, [designations]);

  /* Flattened to one row per person, carrying the rowSpan its designation
     needs. A seat nobody has held still gets a row — dropping it would make
     the table disagree with the "designations staffed" count above it. */
  const rows = useMemo(() => {
    const out = [];
    ordered.forEach((d) => {
      const people = peopleInOrder(d.resources);
      if (!people.length) {
        out.push({ d, r: null, first: true, span: 1, handover: null });
        return;
      }
      people.forEach((r, i) => {
        out.push({
          d,
          r,
          first: i === 0,
          span: people.length,
          handover: i === 0 ? null : handoverNote(people[i - 1], r),
        });
      });
    });
    return out;
  }, [ordered]);

  const total = num(data?.totalReplacements);
  const changedCount = designations.filter((d) => num(d.replacementCount) > 0).length;
  const windowLabel = [data?.activityStartDate, data?.activityEndDate]
    .map(formatReportDate).filter(Boolean).join(" → ");

  return (
    <div className="att-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="att-modal att-modal--wide" role="dialog" aria-modal="true" aria-label="Replacements">
        <div className="att-modal-head">
          <div>
            <div className="att-eyebrow" style={{ marginBottom: 4 }}>Staffing</div>
            <h2 className="att-modal-title">Replacements</h2>
            {(data?.activityName || windowLabel) && (
              <div className="att-rep-sub">
                {data?.activityName}
                {data?.activityName && windowLabel ? " · " : ""}
                {windowLabel}
              </div>
            )}
          </div>
          <button className="att-close" onClick={onClose} aria-label="Close">✕</button>
        </div>

        {loading && <div className="att-muted">Loading replacement history…</div>}
        {!loading && error && <div className="att-error">{error}</div>}

        {!loading && !error && (
          <>
            <div className="att-chips" style={{ marginBottom: 14 }}>
              <Chip accent={total > 0}>
                {total} {total === 1 ? "replacement" : "replacements"}
              </Chip>
              {total > 0 && (
                <Chip>
                  across {changedCount} {changedCount === 1 ? "designation" : "designations"}
                </Chip>
              )}
              <Chip>{designations.length} designations staffed</Chip>
            </div>

            {designations.length === 0 ? (
              <div className="att-muted">
                No staffing has been reported against this activity yet.
              </div>
            ) : (
              <div className="att-table-wrap att-rep-tablewrap">
                <table className="att-table att-rep-table">
                  <thead>
                    <tr>
                      <th className="att-th">Designation</th>
                      <th className="att-th att-num" title="Resources planned for this designation on the activity.">Configured</th>
                      {/* "People", not "resources": this counts everyone who
                          held the seat across the whole activity, which is not
                          the headcount at any one moment. */}
                      <th className="att-th att-num" title="Distinct people who held this designation at any point in the activity. Not a headcount at a single moment — a seat handed over once shows 2.">People</th>
                      <th className="att-th att-num" title="Times this designation changed hands during the activity.">Replacements</th>
                      {/* ID leads the person, as it does in the attendance
                          table — the two are read side by side. */}
                      <th className="att-th">ID</th>
                      <th className="att-th">Resource</th>
                      <th className="att-th">Joined</th>
                      <th className="att-th">Last Working Day</th>
                      <th className="att-th">Status</th>
                      <th className="att-th" title="How the seat passed from the person above to this one.">Handover</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((row, i) => {
                      const { d, r, first, span, handover } = row;
                      const isOff = r?.active === false;
                      return (
                        <tr
                          key={`${d.designation}-${r?.resourceId ?? "none"}-${i}`}
                          className={`att-row${first ? " att-rep-groupstart" : ""}${
                            isOff ? " att-row--off" : ""
                          }`}
                        >
                          {/* Spanned down the designation's people so the seat
                              reads as one thing rather than repeating itself. */}
                          {first && (
                            <>
                              <td className="att-td att-strong" rowSpan={span}>
                                {d.designation || "—"}
                              </td>
                              <td className="att-td att-num" rowSpan={span}>
                                {num(d.configuredQuantity)}
                              </td>
                              <td className="att-td att-num" rowSpan={span}>
                                {num(d.distinctResourceCount)}
                              </td>
                              <td
                                className={`att-td att-num${
                                  num(d.replacementCount) > 0 ? " att-warn" : " att-dim"
                                }`}
                                rowSpan={span}
                              >
                                {num(d.replacementCount)}
                              </td>
                            </>
                          )}
                          <td className="att-td">
                            {r ? <code className="att-code">{r.resourceId}</code> : "—"}
                          </td>
                          <td className="att-td att-strong">
                            {r
                              ? r.employeeName || "—"
                              : <span className="att-dim">No one assigned</span>}
                          </td>
                          <td className="att-td">{formatReportDate(r?.joiningDate) || "—"}</td>
                          <td className={`att-td${isOff ? "" : " att-dim"}`}>
                            {formatReportDate(r?.lastWorkingDate) || "—"}
                          </td>
                          <td className="att-td">
                            {r && (
                              <span className={`att-rep-pill${isOff ? " is-off" : ""}`}>
                                {isOff ? "Inactive" : "Active"}
                              </span>
                            )}
                          </td>
                          {/* Empty on the first person — there is nothing above
                              them to have handed over from. */}
                          <td className={`att-td${handover ? " att-warn" : " att-dim"}`}>
                            {handover || "—"}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

/* Ordered by joining date so a seat's rows read as a handover. Anyone without a
   usable date sinks to the end rather than silently sorting as "earliest",
   which is what comparing empty strings would do. */
function peopleInOrder(resources) {
  const list = Array.isArray(resources) ? resources.slice() : [];
  return list.sort((a, b) => {
    const x = reportDateISO(a?.joiningDate);
    const y = reportDateISO(b?.joiningDate);
    if (!x && !y) return 0;
    if (!x) return 1;
    if (!y) return -1;
    return x < y ? -1 : x > y ? 1 : 0;
  });
}

/* How the seat passed from one person to the next. Worth stating because the
   table's adjacency implies a clean same-day handover, and these two were on
   the project together for a month. Only claimed when both dates parse — a
   missing one is unknown, not zero. */
function handoverNote(prev, next) {
  const prevEnd = reportDateISO(prev?.lastWorkingDate);
  const thisStart = reportDateISO(next?.joiningDate);
  if (!prevEnd || !thisStart) return null;
  const gap = daysBetween(prevEnd, thisStart);
  if (!Number.isFinite(gap)) return null;
  if (gap < 0) return `Overlapped ${Math.abs(gap)} days`;
  if (gap > 1) return `${gap - 1} day gap`;
  return null; // consecutive days — a clean handover needs no note
}

function HolidayModal({ year, years, onYearChange, holidays, calendar, loading, error, onClose }) {
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
          <div className="att-modal-head-actions">
            {/* Only worth a control when there's somewhere else to go. */}
            {(years?.length ?? 0) > 1 && (
              <label className="att-year-pick">
                <span className="att-year-pick-label">Year</span>
                <select
                  className="att-select"
                  value={year}
                  onChange={(e) => onYearChange(Number(e.target.value))}
                  aria-label="Holiday year"
                >
                  {years.map((y) => (
                    <option key={y} value={y}>{y}</option>
                  ))}
                </select>
              </label>
            )}
            <button className="att-close" onClick={onClose} aria-label="Close">✕</button>
          </div>
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

/* An empty table is the most likely place a first-time user lands, so it
   carries the way out rather than just reporting the absence — the same shape
   the Resources page uses: icon, what's missing, what to do, and the button
   that does it. `action` is optional: the "pick a month" prompt is waiting on
   a choice already on screen, not on an upload. */
function EmptyState({ icon, title, hint, action }) {
  return (
    <div className="att-empty">
      {icon && <div className="att-empty-icon">{icon}</div>}
      <div className="att-empty-title">{title}</div>
      {hint && <div className="att-empty-hint">{hint}</div>}
      {action && <div className="att-empty-action">{action}</div>}
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
/* Two figures — one seat, more than one occupant, which is what a replacement
   is. Deliberately not the single-person icon the roster uses. */
function UsersIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="9" cy="8" r="3.2" stroke="currentColor" strokeWidth="1.8" />
      <path d="M3 19.5c0-3 2.7-4.8 6-4.8s6 1.8 6 4.8" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      <path d="M16.5 5.2a3.2 3.2 0 0 1 0 5.6M18 14.9c2 .6 3.5 2.2 3.5 4.6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
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
/* Stacked layers — the milestone/activity prompt, distinct from the calendar
   the period prompts use, so the two empty states aren't mistaken for each
   other while stepping through them. */
function LayersIcon() {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M12 3 3 7.5l9 4.5 9-4.5L12 3Z" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" />
      <path d="m3 12.5 9 4.5 9-4.5M3 17l9 4.5 9-4.5" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function RefreshIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M20 12a8 8 0 1 1-2.34-5.66" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      <path d="M20 4v4.5h-4.5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/* Re-runs the fetch for the table it sits beside. Spins while that table is
   loading, which doubles as the acknowledgement — a refresh that returns the
   same rows is otherwise indistinguishable from a click that did nothing. */
function RefreshButton({ onClick, busy, label = "Refresh" }) {
  return (
    <button
      type="button"
      className="att-refresh"
      onClick={onClick}
      disabled={busy}
      title={busy ? "Refreshing…" : `${label} — fetch the latest data`}
    >
      <span className={`att-refresh-ico${busy ? " is-busy" : ""}`}><RefreshIcon /></span>
      {busy ? "Refreshing…" : label}
    </button>
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
/* No top padding: this page always renders inside AttendanceSystemLayout,
   whose section nav already carries an 18px bottom margin. The two stacked to
   a 48px gulf between the tabs and the page title. */
.att-page { padding: 0 10px 72px; max-width: 1320px; margin: 0 auto; color: ${C.ink}; }
@media (max-width: 640px) { .att-page { padding: 0 16px 48px; } }

.att-page :focus-visible { outline: 2px solid ${C.primary}; outline-offset: 2px; border-radius: 6px; }

/* Spacing runs on a 8px rhythm — 8 / 16 / 24 — so the page has one vertical
   beat instead of the 26/30/14 mix it grew into. */
.att-head { display: flex; align-items: center; justify-content: space-between;
  gap: 16px; flex-wrap: wrap; margin-bottom: 24px; }
.att-head-main { min-width: 0; }
.att-head-actions { display: flex; align-items: center; gap: 8px; flex-shrink: 0; flex-wrap: wrap; }
/* No trailing margin now that the subtitle is gone — the eyebrow above and the
   header's own margin carry the spacing. */
.att-title { margin: 0; letter-spacing: -0.02em; }
/* milestone names are long — let that one select take the full modal row */
.att-select--wide { min-width: 100%; }
/* Vendor names run long; capped so one doesn't stretch the filter row. */
.att-select--org { max-width: 230px; }

/* Resolved rate year in the upload modal — sits inside .att-note, so it
   inherits that block's colour and only needs its own internal rhythm. */
.att-ry-head { font-weight: 700; margin-bottom: 5px; }
.att-ry-row { display: flex; align-items: baseline; gap: 10px; padding: 2px 0; }
.att-ry-name { font-weight: 700; font-variant-numeric: tabular-nums; }
.att-ry-range { opacity: .85; font-variant-numeric: tabular-nums; }
.att-ry-note { margin-top: 6px; opacity: .85; }

/* Quieter than it was: at 12px bold primary it competed with the page title
   directly beneath it. It labels the title, so it sits back from it. */
.att-eyebrow { font-size: 11px; font-weight: 700; letter-spacing: 0.08em;
  text-transform: uppercase; color: ${C.muted}; margin-bottom: 6px; }

.att-section { margin-bottom: 24px; }

/* View switch — a segmented control rather than two buttons, so the pair reads
   as one choice with one answer. Sized to line up with the selects beside it. */
.att-seg { display: inline-flex; padding: 3px; border-radius: 10px;
  border: 1px solid ${C.border}; background: ${C.surfaceAlt}; gap: 3px; }
.att-seg-btn { border: none; background: transparent; cursor: pointer;
  padding: 6px 16px; border-radius: 10px; font-size: 13.5px; font-weight: 600;
  color: ${C.muted}; transition: background .15s ease, color .15s ease, box-shadow .15s ease; }
.att-seg-btn:hover:not(.is-on) { color: ${C.ink}; }
.att-seg-btn.is-on { background: #fff; color: ${C.primary};
  box-shadow: 0 1px 2px rgba(16,32,60,.08); }

/* Refresh — a quiet control beside the table it reloads, deliberately lighter
   than the header's primary actions: it repeats a fetch the page already does
   on its own, so it shouldn't compete with Upload for attention. */
/* Same 40px box and 14px type as the buttons it now sits beside — it used to
   live alone in a section heading, where being a size smaller went unnoticed. */
.att-refresh { display: inline-flex; align-items: center; gap: 8px; flex-shrink: 0;
  padding: 0 14px; height: 40px; border-radius: 10px; border: 1px solid ${C.border};
  background: #fff; color: ${C.ink2}; font-size: 14px; font-weight: 600;
  cursor: pointer; transition: background .15s ease, border-color .15s ease, color .15s ease; }
.att-refresh:hover:not(:disabled) { background: ${C.surface}; border-color: ${C.borderStrong}; color: ${C.ink}; }
.att-refresh:disabled { opacity: .6; cursor: not-allowed; }
.att-refresh-ico { display: inline-flex; }
.att-refresh-ico.is-busy { animation: att-spin .8s linear infinite; }
@keyframes att-spin { to { transform: rotate(360deg); } }
/* Respect a reduced-motion preference — the label already says "Refreshing…". */
@media (prefers-reduced-motion: reduce) { .att-refresh-ico.is-busy { animation: none; } }

/* ---- toolbar / controls ---- */
/* Filters left, every secondary action right, on one line. Both sides align on
   their last row so the controls and buttons sit on a single baseline even
   after the row wraps on a narrow screen. */
.att-toolbar { display: flex; align-items: flex-end; justify-content: space-between;
  gap: 16px; margin-bottom: 24px; flex-wrap: wrap; }
.att-controls { display: flex; gap: 12px; flex-wrap: wrap; }
.att-toolbar-actions { display: flex; align-items: center; gap: 8px;
  flex-wrap: wrap; flex-shrink: 0; }
.att-field { display: flex; flex-direction: column; gap: 6px; }
.att-field-label { font-size: 11.5px; font-weight: 700; letter-spacing: 0.05em;
  text-transform: uppercase; color: ${C.muted}; }
/* Explicit height instead of padding-derived, so selects, buttons and the
   refresh control are all exactly 40px and share one baseline. */
.att-select { padding: 0 12px; height: 40px; border-radius: 10px; border: 1px solid ${C.border};
  background: #fff; color: ${C.ink}; font-size: 14px; font-family: inherit; min-width: 150px;
  outline: none; cursor: pointer; transition: border-color .15s ease, box-shadow .15s ease; }
/* A field with one possible value — sized like a control so the row lines
   up, but flat and inert because there is nothing to pick. */
.att-static { padding: 9px 12px; border-radius: 10px; border: 1px solid ${C.border};
  background: ${C.surfaceAlt}; color: ${C.ink2}; font-size: 14px; min-width: 150px;
  font-weight: 600; }
.att-select:hover { border-color: ${C.borderStrong}; }
.att-select:focus { border-color: ${C.primary}; box-shadow: 0 0 0 3px ${C.accentBg}; }

.att-btn-secondary { display: inline-flex; align-items: center; gap: 8px;
  border-radius: 10px; font-size: 14px; font-weight: 600; padding: 0 14px; height: 40px;
  cursor: pointer; border: 1px solid ${C.border}; background: #fff; color: ${C.ink2};
  transition: background .18s ease, border-color .18s ease, color .18s ease; }
.att-btn-secondary:hover:not(:disabled) { background: ${C.surface}; border-color: ${C.primary}; color: ${C.primary}; }
.att-btn-secondary:disabled { opacity: .5; cursor: not-allowed; }

/* Flat and solid rather than a gradient with a coloured glow. One accent
   colour, one weight — the button is the only primary action on the page, so
   it doesn't need decoration to be found. Height matched to the secondaries
   and the selects, which were 38 against 40 and sat a hair low beside them. */
.att-btn-primary { display: inline-flex; align-items: center; gap: 8px; border: none;
  border-radius: 10px; font-size: 14px; font-weight: 600; padding: 0 16px; height: 40px;
  cursor: pointer; color: #fff; background: ${C.primary};
  transition: background .18s ease, transform .06s ease; white-space: nowrap; }
.att-btn-primary:hover:not(:disabled) { background: ${C.primaryDark}; }
.att-btn-primary:active:not(:disabled) { transform: translateY(1px); }
.att-btn-primary:disabled { opacity: .45; cursor: not-allowed; }

/* ---- metric cards ----
   The strip carries up to eight cards, so each one has to survive at roughly
   an eighth of the content width. Values are kept on one line (a wrapped
   number reads as two numbers); anything long enough to threaten that gets
   .att-metric-value-sm instead of being allowed to spill past the border. */
.att-metrics { display: grid; grid-template-columns: repeat(auto-fit, minmax(138px, 1fr));
  gap: 10px; margin-bottom: 18px; }
.att-metric { background: #fff; border: 1px solid ${C.border}; border-top: 3px solid ${C.borderStrong};
  border-radius: 14px; padding: 12px 13px 13px; box-shadow: 0 1px 2px rgba(16,32,60,.04);
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

/* ── reporting period ───────────────────────────────────────────────────
   The two dates read as one range: a quiet label, the dates at full weight,
   and the span as a trailing fact. Tabular numerals so the two ends line up
   on their digits instead of drifting apart by glyph width. */
.att-period { display: flex; align-items: baseline; gap: 10px; flex-wrap: wrap; min-width: 0; }
.att-period-lbl { font-size: 10px; font-weight: 700; letter-spacing: .08em;
  text-transform: uppercase; color: ${C.faint}; }
.att-period-range { display: inline-flex; align-items: baseline; gap: 8px;
  font-variant-numeric: tabular-nums; }
.att-period-date { font-size: 15px; font-weight: 700; color: ${C.ink}; letter-spacing: -0.01em; }
.att-period-arrow { color: ${C.faint}; font-size: 13px; }
/* A fact about the range, not part of it — so it sits apart and lighter. */
.att-period-days { font-size: 12px; font-weight: 600; color: ${C.muted};
  background: ${C.surface}; border: 1px solid ${C.border};
  padding: 2px 8px; border-radius: 999px; white-space: nowrap; }

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
.att-code { font-size: 13px; background: ${C.surface}; padding: 2px 7px; border-radius: 6px;
  border: 1px solid ${C.border}; font-variant-numeric: tabular-nums; }
/* Designation rides under the employee name rather than in a column of its
   own: titles like "Developer - Enrolment Server, Middleware and Logistics"
   are far wider than any other cell and would push the table into a
   horizontal scroll. It's the one cell allowed to wrap. */
.att-name-cell { white-space: normal; min-width: 190px; max-width: 300px; }
.att-desig { font-size: 12px; color: ${C.faint}; font-weight: 400; margin-top: 2px;
  line-height: 1.35; }
/* Joining date — context for the Working count beside it, so it reads a step
   back from the figures rather than competing with them. */
.att-joined { color: ${C.muted}; white-space: nowrap; font-variant-numeric: tabular-nums; }

/* ── inactive employee ──────────────────────────────────────────────────
   No column of its own: only a handful of rows are ever inactive, so a column
   would be blank for everyone still on the project — and the same goes for the
   last working date, which rides on this same line.

   A plain line rather than a pill. As a bordered chip it was the heaviest
   thing in the table for what is a footnote about one row, and at this
   column's real width it wrapped and pushed the row taller than its
   neighbours. The scanning work is done by the rail on the left edge instead,
   which costs no height at all.

   Neutral, not red. Someone rolling off a project is an ordinary event and
   their attendance figures are still real — a warning colour would read as
   "this row is wrong" when it's just "this row ended early". It also explains
   a Working of 26 against everyone else's 60. */
/* A tinted pill, on its own line so the colour costs no row height. The text
   is a DEEPER red than the palette's ${C.red}: that one lands at 3.83:1 on
   this tint, under the 4.5:1 small-text floor, where #b91c1c reaches 5.66:1.
   Measured, not eyeballed — at 11.5px the difference is legibility. */
.att-off { display: inline-flex; align-items: center; gap: 6px; margin-top: 4px;
  padding: 2px 9px 2px 8px; border-radius: 999px; background: ${C.redBg};
  font-size: 11px; font-weight: 700; color: #b91c1c; line-height: 1.45;
  letter-spacing: .01em; }
.att-off-dot { width: 6px; height: 6px; border-radius: 50%; flex-shrink: 0;
  background: ${C.red}; }
/* The date is the detail, so it rides at normal weight inside the pill. */
.att-off-date { font-weight: 500; opacity: .85; font-variant-numeric: tabular-nums; }

/* The rail, in the same red so the two read as one signal. Sits on the first
   cell because the table collapses its borders, which makes a shadow on the
   row itself unreliable. Hover only changes the background, so they never
   fight. */
.att-row--off .att-td:first-child { box-shadow: inset 3px 0 0 ${C.red}; }

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
/* Roomier than it was, matching the Resources page's empty state — with a
   button under it the old 34px felt cramped, and this is the first thing a
   new project shows. */
.att-empty { display: flex; flex-direction: column; align-items: center; text-align: center;
  padding: 56px 24px; border: 1px dashed ${C.borderStrong}; border-radius: 14px; background: #fbfcfe; }
.att-empty-icon { display: inline-flex; align-items: center; justify-content: center;
  width: 52px; height: 52px; border-radius: 14px; background: ${C.accentBg}; color: ${C.primary}; margin-bottom: 14px; }
.att-empty-icon svg { width: 24px; height: 24px; }
.att-empty-title { font-size: 16px; font-weight: 700; color: ${C.ink}; }
.att-empty-hint { font-size: 14px; color: ${C.muted}; margin-top: 8px; max-width: 400px; line-height: 1.5; }
.att-empty-action { margin-top: 22px; }

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
.att-modal { background: #fff; border-radius: 14px; width: 100%; max-width: 560px;
  max-height: 86vh; overflow-y: auto; padding: 24px; box-shadow: 0 24px 64px rgba(9,20,42,.32);
  animation: attPop .18s cubic-bezier(.2,.8,.2,1); }
@keyframes attPop { from { transform: translateY(10px); opacity: .5; } to { transform: translateY(0); opacity: 1; } }
.att-modal-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; margin-bottom: 14px; }
.att-modal-title { margin: 0; font-size: 20px; font-weight: 700; color: ${C.ink}; letter-spacing: -0.01em; }
.att-modal-sub { color: ${C.muted}; font-size: 14px; margin-bottom: 16px; }
.att-modal-actions { display: flex; justify-content: flex-end; gap: 10px; margin-top: 22px; }
.att-modal-head-actions { display: flex; align-items: center; gap: 10px; flex: 0 0 auto; }

/* ── replacements ────────────────────────────────────────────────────── */
/* Sized for the ten-column table; it scrolls inside its wrapper below this. */
.att-modal--wide { max-width: min(1020px, 94vw); }
.att-btn-badge { display: inline-flex; align-items: center; justify-content: center;
  min-width: 18px; height: 18px; padding: 0 5px; margin-left: 2px; border-radius: 999px;
  background: ${C.primary}; color: #fff; font-size: 11px; font-weight: 700; line-height: 1; }
.att-rep-sub { color: ${C.muted}; font-size: 13px; margin-top: 4px; }
.att-rep-tablewrap { max-height: 62vh; overflow: auto; }
.att-rep-table { min-width: 960px; }
.att-rep-table th { position: sticky; top: 0; z-index: 1; background: #fff; }
/* The spanned designation cells already group the rows; this line makes the
   boundary readable when a group's people run to three or more. */
.att-rep-groupstart > .att-td { border-top: 1px solid ${C.borderStrong}; }
.att-rep-table tbody tr:first-child > .att-td { border-top: none; }
/* Status reads at a glance without relying on colour alone — the word is the
   signal, the tint only reinforces it. */
.att-rep-pill { display: inline-block; padding: 2px 8px; border-radius: 999px;
  font-size: 11px; font-weight: 700; background: ${C.greenBg}; color: #166534; }
.att-rep-pill.is-off { background: ${C.redBg}; color: #b91c1c; }
.att-year-pick { display: flex; align-items: center; gap: 7px; }
.att-year-pick-label { font-size: 12px; font-weight: 600; color: ${C.muted};
  text-transform: uppercase; letter-spacing: .04em; }
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
  border-radius: 14px; border: 1px solid ${C.border}; }
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