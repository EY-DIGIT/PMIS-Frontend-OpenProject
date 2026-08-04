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
import { useEffect, useMemo, useState } from "react";
import { useParams, useSearchParams, useNavigate } from "react-router-dom";
import {
  FiX, FiUser, FiBriefcase, FiHash, FiFileText, FiCalendar,
  FiPlay, FiFlag, FiLayers, FiInfo, FiUmbrella,
  FiShield, FiCreditCard, FiPieChart, FiClock, FiUploadCloud, FiDownload,
} from "react-icons/fi";
import { useProject } from "../../store/project/projectsStore";
import { setPageContext, clearPageContext } from "../../utils/pageContext";
import { rupeesInWords } from "../../utils/moneyWords";
import { getToken } from "../../api/auth";
import { ENDPOINTS } from "../../api/endpoint";
import {
  readErrorMessage, readSuccessMessage, readJsonBody, requestErrorMessage,
  notifyActionError, parseYear, parseQuarter, MIN_YEAR, MAX_YEAR,
} from "../../utils/apiMessage";
import "../../styles/global.css";

const API_BASE = "http://10.1.131.199:8019";

const C = {
  primary: "#0b3c88",
  primaryDark: "#072a63",
  ink: "#16202e",
  muted: "#64748b",
  faint: "#94a3b8",
  border: "#e3e9f2",
  borderStrong: "#cbd5e1",
  divider: "#eef2f7",
  surface: "#f6f9fc",
  green: "#0f9d58",
  red: "#d64545",
  accentBg: "#eef2ff",
};

/* Pass / fail tint for the attendance pill — the only place on this page a
   tinted block still earns its keep, because there the colour states the
   result. The five decorative tones that used to sit alongside these (blue,
   purple, orange, amber, teal) tinted an icon badge on every stat card and
   info item; seven hues competing meant none of them said anything. */
const TONES = {
  green: { bg: "#e9f9ef", fg: "#16a34a" },
  red: { bg: "#fdecec", fg: "#dc2626" },
};

// Quarter context — dates and the quarter number aren't counts, so they sit
// with the employee details rather than in the metric grid. Labelled "From"
// and "To" rather than "Quarter Start/End": the quarter is already named in
// the page subtitle, so what these add is the span itself.
const CONTEXT_CARDS = [
  { key: "quarterStart", label: "From Date", tone: "purple", icon: <FiPlay /> },
  { key: "quarterEnd", label: "To Date", tone: "orange", icon: <FiFlag /> },
];

/* Every label on this page is the term the RFP uses (§5.24 Leave Policy,
   §5.25 Payment Process) — "Permissible Leave", "Unpaid Leave", "Sandwich
   Leave", "Relaxation", "Lapsed". These are the words the contract is
   written in and the words the client already knows, so renaming them to
   something that reads friendlier in isolation only forces a translation
   back to the contract. The explanations below quote the RFP's own rules.

   Donut segment colours — validated as a categorical set against a white
   surface (scripts/validate_palette.js, --pairs all): worst pair ΔE 15.3
   under deuteranopia, well clear of the ≥8 gate. Green-for-paid /
   red-for-unpaid was the obvious first choice and FAILED that check at
   ΔE 4.1 — the classic red/green confusion. Amber sits at 2.17:1 on white,
   under the 3:1 bar, so every segment ships a visible value beside it. */
const SPLIT = [
  {
    key: "paid",
    label: "Paid Leave",
    color: "#2a78d6",
    hint: "Days covered by the quarter's permissible leave. No deduction for these.",
  },
  {
    key: "relaxation",
    label: "Relaxation",
    color: "#eda100",
    hint: "Unpaid days waived by UIDAI against an exigency request (RFP 5.24.1.b.vi). No deduction for these.",
  },
  {
    key: "unpaid",
    label: "Unpaid Leave",
    color: "#e34948",
    hint: "Absence beyond the permissible six days a quarter. Salary is deducted for these (RFP 5.24.1.a.i).",
  },
];

/* The remaining figures from the report, in the RFP's terms. Kept as one
   plain list rather than a grid of tiles — the numbers are reference, not
   headlines, and eight loud tiles were what made this page hard to read. */
/* The settlement order, straight from the RFP: leave is set against the
   permissible allowance first, then any relaxation granted; the remainder
   is unpaid and deducted. */
const SECTION_HINT =
  "Leave taken is settled in order: first against the permissible leave for the quarter, then against any relaxation granted. Whatever remains is unpaid and gets deducted.";

// Leave-summary cards — key maps to the report payload, label is the display
// text, tone/icon drive the styling. Order follows how the quarter settles:
// allowance, then what was taken, then how it was absorbed.
const SUMMARY_CARDS = [
  { key: "permissibleLeave", label: "Permissible Leave", tone: "green", icon: <FiShield /> },
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
  permissibleLeave: "Paid leave allowed for this quarter. Leave within this limit costs the employee nothing.",
  leaveTaken: "Total days of leave taken in the quarter, before any of it is classified as paid or unpaid.",
  paidLeave: "Days covered by the permissible allowance. No salary is deducted for these.",
  unpaidLeave: "Days left over after the paid allowance and any relaxation are applied. Salary is deducted for these.",
  relaxationLeave: "Extra days granted as an exception, on top of the paid allowance. Each quarter has a fixed limit.",
  sandwichDays: "Weekends or holidays falling between leave days, counted as leave.",
  totalUnpaidDays: "Every day being deducted this quarter — unpaid leave plus sandwich days.",
  lapsedLeave: "Allowance that went unused and has expired. It does not carry into the next quarter.",
};

/* Never let a raw structure reach the screen. An object here would render as
   "[object Object]" and an array as a comma-splice of its parts — both read
   as a bug to anyone looking at the page, so they degrade to a dash. */
const show = (v) => {
  if (v === null || v === undefined || v === "") return "—";
  if (typeof v === "object") return "—";
  if (typeof v === "number" && !Number.isFinite(v)) return "—";
  return String(v);
};
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


/* Only the commented-out Attendance % column used this — uncomment with it. */
// const pct = (v) => `${num(v).toLocaleString("en-IN", { maximumFractionDigits: 2 })}%`;

/* Day counts arrive as 19.5 / 2.0 — render a half day as "2.5" without
   dressing a whole day up as "2.0". */
const dayCount = (v) => {
  const n = num(v);
  return Number.isInteger(n) ? String(n) : String(Math.round(n * 100) / 100);
};

/* ═══════════════════════════════════════════════════════════════════
   TEMPORARY — three candidate presentations for the leave dates, behind
   a switcher, so they can be compared side by side. Once one is chosen,
   delete the other two, the `view` state and the `.ld-switch` styles.
   ═══════════════════════════════════════════════════════════════════ */
const MONTH_NAMES = [
  "", "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];
const DOW = ["M", "T", "W", "T", "F", "S", "S"];

const pad2 = (n) => String(n).padStart(2, "0");

/* Leave dates arrive as strings of no guaranteed shape, so reduce each to
   a "YYYY-MM-DD" key before matching it against a calendar cell. The Date
   fallback is gated on a four-digit year — Date parsing is lenient enough
   to invent one, and a wrong key would mark the wrong day. */
const dateKey = (v) => {
  if (!v) return "";
  const s = String(v).trim();
  const iso = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(s);
  if (iso) return `${iso[1]}-${pad2(iso[2])}-${pad2(iso[3])}`;
  if (/\d{4}/.test(s)) {
    const d = new Date(s);
    if (!Number.isNaN(d.getTime())) {
      return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
    }
  }
  return "";
};

// Monday-first grid, padded to whole weeks.
function buildMonthGrid(year, month) {
  const jsDay = new Date(year, month - 1, 1).getDay();   // 0 = Sunday
  const lead = (jsDay + 6) % 7;                          // shift to Monday-first
  const daysInMonth = new Date(year, month, 0).getDate();
  const cells = [];
  for (let i = 0; i < lead; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(d);
  while (cells.length % 7 !== 0) cells.push(null);
  return cells;
}

/* ── the cost report's own date format ────────────────────────────────
   Every other endpoint this page touches sends yyyy-MM-dd; the quarterly
   cost report sends its month bands as dd-MM-yyyy. Parsed explicitly here
   rather than through dateKey() or `new Date`, both of which get it wrong
   quietly rather than loudly: V8 reads "07-01-2026" as MM-dd-yyyy and hands
   back 1 July, not 7 January — a plausible date, off by five months, with
   nothing to flag it. */
function formatBandDate(raw) {
  const s = String(raw ?? "").trim();
  if (!s) return "";
  const dmy = /^(\d{1,2})-(\d{1,2})-(\d{4})$/.exec(s);
  if (dmy) {
    const d = Number(dmy[1]);
    const m = Number(dmy[2]);
    return MONTH_NAMES[m] ? `${d} ${MONTH_NAMES[m].slice(0, 3)} ${dmy[3]}` : s;
  }
  // Tolerated in case the endpoint is normalised to ISO later.
  const iso = dateKey(s);
  if (iso) {
    const [y, m, d] = iso.split("-").map(Number);
    return `${d} ${MONTH_NAMES[m].slice(0, 3)} ${y}`;
  }
  return s;
}

/* ── which bucket each half day belongs to ────────────────────────────
   The report used to fold half days into paidLeaveDates / unpaidLeaveDates
   and repeat them in halfDayDates purely as a "counts 0.5" marker. It now
   sends them as their own disjoint set, present in neither list — so every
   half day stopped rendering at all: the chip lists iterate paid/unpaid, and
   the calendar only marks a cell it finds in one of those sets. Two of
   resource 422's eleven leave dates were simply absent from the page.

   The response doesn't say which bucket a half day belongs to, but the
   settlement rule this page already explains to the user does: leave is
   consumed in date order against the paid allowance, and whatever doesn't
   fit is unpaid. Re-running that over the merged list recovers the split.

   It isn't trusted blind. The same pass re-derives the FULL days, whose
   buckets the server does state — if those don't come back exactly as sent,
   the inference is wrong (a changed rule, or a relaxation tier this doesn't
   model) and `verified` is false, so the caller shows the half days as their
   own category rather than filing them under a colour that might be a lie.

   Checked against two live Q1-2026 payloads: 422 (halves 1.0 paid / 0
   unpaid, where a full day is skipped so a later half can take the last
   0.5) and 430 (1.0 paid / 2.5 unpaid). Both reproduce the server's own
   paid and unpaid lists exactly. */
function assignHalfDays(halfDayDates, paidLeaveDates, unpaidLeaveDates, paidLeave) {
  const half = (halfDayDates || []).map(dateKey).filter(Boolean);
  const paidFull = (paidLeaveDates || []).map(dateKey).filter(Boolean);
  const unpaidFull = (unpaidLeaveDates || []).map(dateKey).filter(Boolean);
  const none = { paidHalves: [], unpaidHalves: [], unassigned: [] };
  if (!half.length) return none;

  /* Older payloads already fold them in — the dates are in the lists, so the
     existing rendering works and there is nothing to recover. */
  const inLists = new Set([...paidFull, ...unpaidFull]);
  if (half.some((k) => inLists.has(k))) return none;

  const items = [
    ...half.map((k) => ({ k, w: 0.5 })),
    ...paidFull.map((k) => ({ k, w: 1 })),
    ...unpaidFull.map((k) => ({ k, w: 1 })),
  ].sort((a, b) => (a.k < b.k ? -1 : a.k > b.k ? 1 : 0));

  /* Fill the paid allowance in date order. A day that would overrun it is
     left unpaid and the walk continues — that's what lets a later half day
     take a remaining 0.5, which is exactly what 422's payload does. */
  let budget = num(paidLeave);
  const paid = new Set();
  for (const it of items) {
    if (it.w <= budget + 1e-9) { paid.add(it.k); budget -= it.w; }
  }

  const verified =
    paidFull.every((k) => paid.has(k)) && unpaidFull.every((k) => !paid.has(k));
  if (!verified) return { ...none, unassigned: half };

  return {
    paidHalves: half.filter((k) => paid.has(k)),
    unpaidHalves: half.filter((k) => !paid.has(k)),
    unassigned: [],
  };
}

// Merge recovered half dates into their bucket, kept in date order.
function withHalves(dates, halves) {
  if (!halves.length) return dates;
  return [...dates, ...halves].sort((a, b) => {
    const x = dateKey(a), y = dateKey(b);
    return x < y ? -1 : x > y ? 1 : 0;
  });
}

/* ── per-month leave, from the cost report ────────────────────────────
   The breakdown carries no "total leave" field, but it now sends both parts
   outright as `paidLeaveDays` / `unpaidLeaveDays`, and `unpaidLeaveDays` is
   the very figure the deduction is charged on:

     deductedAmount = unpaidLeaveDays × perDayRate

   Verified against a live Q1-2026 payload: January's 1 unpaid day × ₹6401.10
   is exactly its ₹6401.10 deduction, and March matches the same way.

   Older payloads sent neither field and had to be derived from
   `effectivePaidDays` instead — that path is kept as a fallback. Reading the
   old names first was silently wrong against the current shape: both resolved
   to 0, so `unpaid` came out as the month's entire workingDays (21 instead
   of 1 for January). */
function monthLeave(m) {
  const paid =
    m.paidLeaveDays != null ? num(m.paidLeaveDays) : num(m.paidLeaveDaysApplied);
  const unpaid =
    m.unpaidLeaveDays != null
      ? num(m.unpaidLeaveDays)
      : Math.max(0, num(m.workingDays) - num(m.effectivePaidDays));
  return { paid, unpaid, total: paid + unpaid };
}

/* ── cost report envelope ─────────────────────────────────────────────
   /api/attendance/cost/quarterly now answers with
     { period, resourceCount, totals, resources: [ …one per resource… ] }
   where each resource carries its own totalCost + monthlyBreakdown. Older
   builds returned that single report object directly, or wrapped in an
   array, so all three shapes are unwrapped here. Returns the one resource
   this page is about, plus the envelope's totals for the summary cards. */
function unwrapCostReport(json, resourceId) {
  let payload = json && json.data && typeof json.data === "object" ? json.data : json;
  if (Array.isArray(payload)) return { report: payload[0] || {}, totals: null };
  if (!payload || typeof payload !== "object") return { report: {}, totals: null };

  const rows = Array.isArray(payload.resources) ? payload.resources : null;
  if (!rows) return { report: payload, totals: null };

  const match =
    rows.find((r) => String(r.attendanceId) === String(resourceId)) || rows[0] || {};
  return {
    report: { ...match, period: match.period || payload.period },
    totals: payload.totals || null,
  };
}

/* ── the relaxation's supporting document ─────────────────────────────
   GET /api/attendance/quarterly-relaxation/attachment
       ?resourceId=&projectId=&year=&quarter=

   Answers with the raw file. The response is fetched as a blob rather than
   linked to directly because the endpoint sits behind the same bearer token
   as the rest of the API, and a plain <a href> can't carry that header.

   A non-2xx here means "no document was ever uploaded for this quarter",
   which is an ordinary state, not a failure — so it resolves to null and
   the card simply doesn't render. */
const CD_EXT = {
  "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp",
  "image/gif": "gif", "application/pdf": "pdf",
};

// Content-Disposition carries the server's own filename when it sets one.
// RFC 5987 `filename*` wins over plain `filename` when both are present.
function filenameFromDisposition(cd) {
  if (!cd) return "";
  const star = /filename\*=(?:UTF-8'')?([^;]+)/i.exec(cd);
  if (star) {
    try { return decodeURIComponent(star[1].trim().replace(/^"|"$/g, "")); } catch { /* fall through */ }
  }
  const plain = /filename="?([^";]+)"?/i.exec(cd);
  return plain ? plain[1].trim() : "";
}

function useRelaxationAttachment({ resourceId, projectId, year, quarter, refreshKey, enabled = true }) {
  const [file, setFile] = useState(null);

  useEffect(() => {
    // `enabled` is false when the page's own params are invalid — no point
    // asking for an attachment keyed on a year the server will reject.
    if (!enabled) return undefined;
    if (!resourceId || !projectId || parseYear(year) === null || parseQuarter(quarter) === null) {
      return undefined;
    }
    let active = true;
    let objectUrl = "";
    (async () => {
      try {
        const token = getToken();
        const qs = new URLSearchParams({ resourceId, projectId, year, quarter });
        const res = await fetch(
          `${API_BASE}/api/attendance/quarterly-relaxation/attachment?${qs}`,
          { headers: { accept: "*/*", ...(token ? { Authorization: `Bearer ${token}` } : {}) } }
        );
        if (!res.ok) { if (active) setFile(null); return; }
        const blob = await res.blob();
        // Some builds answer 200 with an empty body instead of a 404.
        if (!blob.size) { if (active) setFile(null); return; }
        objectUrl = URL.createObjectURL(blob);
        if (!active) { URL.revokeObjectURL(objectUrl); objectUrl = ""; return; }
        const type = blob.type || res.headers.get("content-type") || "";
        setFile({
          url: objectUrl,
          type,
          size: blob.size,
          name:
            filenameFromDisposition(res.headers.get("content-disposition")) ||
            `relaxation-Q${quarter}-${year}.${CD_EXT[type.toLowerCase()] || "bin"}`,
        });
      } catch {
        if (active) setFile(null);
      }
    })();
    return () => {
      active = false;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [resourceId, projectId, year, quarter, refreshKey, enabled]);

  return file;
}

/* ── which unpaid-leave dates can still be relaxed ────────────────────
   GET /api/attendance/quarterly-relaxation/eligible-dates
       ?resourceId=&projectId=&year=&quarter=
   → { unpaidFullDayDates, unpaidHalfDayDates, sandwichDates, allUnpaidDates,
       eligibleDates, approvedRelaxationDates, approvedRelaxationCost }

   `eligibleDates` is the authoritative pick-list — the unpaid dates minus what
   has already been granted — so it is used as sent rather than re-derived. The
   three category lists are what give each date its WEIGHT, which is the whole
   point of the picker: two days of relaxation buys four half days, or two half
   days and one full one.

   Sandwich days weigh a full day. Checked against resource 421's Q1-2026:
   7 full + 4 half + 2 sandwich reconciles to the leave report's
   totalUnpaidDays of 11.0 only at 1.0 each (7 + 2.0 + 2.0); at 0.5 it would
   come to 10.0. `unpaidLeave` (9.0) is the same figure with sandwich days
   left out, which is why the two disagree. */
const DAY_KINDS = {
  full: { weight: 1, label: "Full day", short: "1" },
  half: { weight: 0.5, label: "Half day", short: "0.5" },
  sandwich: { weight: 1, label: "Sandwich", short: "1" },
};

function useEligibleRelaxationDates({ resourceId, projectId, year, quarter, refreshKey }) {
  const [data, setData] = useState({ options: [], approved: [], approvedCost: 0 });
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const y = parseYear(year);
    const q = parseQuarter(quarter);
    if (!resourceId || !projectId || y === null || q === null) {
      setData({ options: [], approved: [], approvedCost: 0 });
      return undefined;
    }
    let active = true;
    setLoading(true);
    (async () => {
      try {
        const token = getToken();
        const qs = new URLSearchParams({
          resourceId: String(resourceId), projectId: String(projectId),
          year: String(y), quarter: String(q),
        });
        const res = await fetch(
          `${API_BASE}/api/attendance/quarterly-relaxation/eligible-dates?${qs}`,
          { headers: { accept: "*/*", ...(token ? { Authorization: `Bearer ${token}` } : {}) } }
        );
        if (!res.ok) throw new Error("unavailable");
        const json = await res.json().catch(() => ({}));
        const raw = json?.data ?? json;
        const list = (k) => (Array.isArray(raw?.[k]) ? raw[k] : []);

        const half = new Set(list("unpaidHalfDayDates").map(dateKey).filter(Boolean));
        const sandwich = new Set(list("sandwichDates").map(dateKey).filter(Boolean));
        /* Anything eligible that isn't flagged half or sandwich is a full day.
           Derived by exclusion rather than by membership of unpaidFullDayDates
           so a date the server forgets to categorise still gets a weight
           instead of silently counting as zero. */
        const options = list("eligibleDates")
          .map(dateKey)
          .filter(Boolean)
          .map((d) => ({
            date: d,
            kind: half.has(d) ? "half" : sandwich.has(d) ? "sandwich" : "full",
          }));

        if (active) {
          setData({
            options,
            approved: list("approvedRelaxationDates").map(dateKey).filter(Boolean),
            approvedCost: num(raw?.approvedRelaxationCost),
          });
        }
      } catch {
        if (active) setData({ options: [], approved: [], approvedCost: 0 });
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => { active = false; };
  }, [resourceId, projectId, year, quarter, refreshKey]);

  return { ...data, loading };
}

export default function LeaveDetailPage() {
  const { projectId, attendanceId } = useParams();
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const project = useProject(projectId);

  const year = params.get("year") || "";
  const quarter = params.get("quarter") || "";

  /* The URL is user-editable, so nothing is trusted from it. An invalid
     year/quarter is caught here instead of being echoed into three API
     calls that would each come back 400 and render as "(400)". */
  const paramError = useMemo(() => {
    if (!attendanceId) return "No employee was specified in the link.";
    if (!projectId) return "No project was specified in the link.";
    if (parseYear(year) === null) {
      return year
        ? `"${year}" isn't a valid year. Open this page from the Attendance table.`
        : "The link is missing a year. Open this page from the Attendance table.";
    }
    if (parseQuarter(quarter) === null) {
      return quarter
        ? `"${quarter}" isn't a valid quarter — it must be 1, 2, 3 or 4.`
        : "The link is missing a quarter. Open this page from the Attendance table.";
    }
    return "";
  }, [attendanceId, projectId, year, quarter]);

  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [relaxOpen, setRelaxOpen] = useState(false);
  // Which donut segment the pointer is on — shared by the arcs and the
  // legend rows so hovering either one highlights the pair.
  const [hoverKey, setHoverKey] = useState(null);
  // Bumped after a successful relaxation submit to re-fetch the leave detail.
  const [refreshKey, setRefreshKey] = useState(0);

  // Quarterly cost report — shown at the bottom of the page.
  const [costReport, setCostReport] = useState(null);
  const [costTotals, setCostTotals] = useState(null);
  const [costLoading, setCostLoading] = useState(false);
  const [costError, setCostError] = useState(null);

  useEffect(() => {
    setPageContext({ projectName: project?.projectName || "" });
    return () => clearPageContext();
  }, [project?.projectName]);

  useEffect(() => {
    // A bad link is reported by `paramError`; don't fire a request we know
    // the server will reject.
    if (paramError) { setLoading(false); return undefined; }
    const FALLBACK = "Couldn't load the leave detail.";
    let active = true;
    const controller = new AbortController();
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const token = getToken();
        const qs = new URLSearchParams({ year, quarter, projectId });
        const res = await fetch(
          `${API_BASE}${ENDPOINTS.resources.leaveReport(attendanceId)}?${qs}`,
          {
            signal: controller.signal,
            headers: { accept: "*/*", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
          }
        );
        if (!res.ok) throw new Error(await readErrorMessage(res, FALLBACK));
        const json = await readJsonBody(res, FALLBACK);
        const payload = json && json.data && typeof json.data === "object" ? json.data : json;
        // A 200 with no body is a real answer — an empty quarter, not a failure.
        if (active) setData(payload && typeof payload === "object" ? payload : {});
      } catch (e) {
        const msg = requestErrorMessage(e, FALLBACK);
        if (active && msg) setError(msg);
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => { active = false; controller.abort(); };
  }, [attendanceId, year, quarter, projectId, refreshKey, paramError]);

  const d = data || {};
  const resourceId = d.resourceId || d.attendanceId || attendanceId;

  // Fetch the quarterly cost report once we know the resourceId (comes back
  // from the leave-detail payload) and have a year/quarter to query with.
  useEffect(() => {
    if (paramError || !resourceId) return undefined;
    const FALLBACK = "Couldn't load the quarterly cost report.";
    let active = true;
    const controller = new AbortController();
    (async () => {
      setCostLoading(true);
      setCostError(null);
      try {
        const token = getToken();
        const qs = new URLSearchParams({ resourceId, year, quarter });
        const res = await fetch(`${API_BASE}/api/attendance/cost/quarterly?${qs}`, {
          signal: controller.signal,
          headers: { accept: "*/*", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        });
        if (!res.ok) throw new Error(await readErrorMessage(res, FALLBACK));
        const json = await readJsonBody(res, FALLBACK);
        const { report, totals } = unwrapCostReport(json, resourceId);
        if (active) {
          setCostReport(report || {});
          setCostTotals(totals);
        }
      } catch (e) {
        const msg = requestErrorMessage(e, FALLBACK);
        if (active && msg) setCostError(msg);
      } finally {
        if (active) setCostLoading(false);
      }
    })();
    return () => { active = false; controller.abort(); };
  }, [resourceId, year, quarter, refreshKey, paramError]);

  const employeeName = d.employeeName || attendanceId || "Employee";
  const unpaidLeave = num(d.unpaidLeave);
  const halfDayDates = Array.isArray(d.halfDayDates) ? d.halfDayDates : [];
  const sandwichDates = Array.isArray(d.sandwichDates) ? d.sandwichDates : [];
  /* A half day is a 0.5-weight modifier on a paid or unpaid day, never a
     category of its own — so each one is folded into the bucket it belongs
     to and `halfDayDates` stays purely the marker that says "this one counts
     0.5". Which bucket that is has to be recovered now that the report sends
     them disjoint from both lists — see assignHalfDays. Once merged, the
     chip underline and the calendar's half-fill work unchanged.

     sandwichDates, by contrast, IS its own category — non-working days
     caught between leave days and charged as leave. */
  const halfSplit = assignHalfDays(
    halfDayDates, d.paidLeaveDates, d.unpaidLeaveDates, d.paidLeave
  );
  const paidDates = withHalves(
    Array.isArray(d.paidLeaveDates) ? d.paidLeaveDates : [], halfSplit.paidHalves
  );
  const unpaidDates = withHalves(
    Array.isArray(d.unpaidLeaveDates) ? d.unpaidLeaveDates : [], halfSplit.unpaidHalves
  );

  /* How many relaxation days are already granted this quarter. There is no
     longer a per-quarter cap to show alongside it: the report used to carry
     one as `relaxationDaysApplied`, which the current payload doesn't send at
     all. The real constraint now lives in the eligible-dates endpoint the
     modal calls — a date is relaxable or it isn't — so a cap derived here
     would only ever have read 0. */
  const relaxUsed = num(d.relaxationLeave);

  // The image filed with the relaxation request, if one was ever uploaded.
  // Re-fetched after a submit so a freshly attached document appears at once.
  const relaxDoc = useRelaxationAttachment({
    resourceId,
    projectId: d.projectId || projectId,
    year: d.year || year,
    quarter: d.quarter || quarter,
    refreshKey,
    enabled: !paramError,
  });

  const leaveTaken = num(d.leaveTaken);
  const paidLeave = num(d.paidLeave);
  // Only claim the quarter "adds up" when it genuinely does — otherwise the
  // strip is hidden rather than showing an equation that doesn't balance.
  const breakdownBalances =
    leaveTaken > 0 && paidLeave + relaxUsed + unpaidLeave === leaveTaken;

  /* ── at-a-glance figures ───────────────────────────────────────────
     The donut is plotted over the sum of its own parts, never over
     leaveTaken — if the payload disagrees, a chart drawn to a total its
     slices don't reach would be quietly wrong. The mismatch is called
     out below the chart instead. */
  const splitValues = { paid: paidLeave, relaxation: relaxUsed, unpaid: unpaidLeave };
  const splitSegments = SPLIT.map((s) => ({ ...s, value: num(splitValues[s.key]) }));
  const splitTotal = splitSegments.reduce((t, s) => t + s.value, 0);
  /* The remaining report figures are rendered straight from `d` by the
     SUMMARY_CARDS grid, so they need no locals here. The quarter's deduction
     amount lives in the cost report below, where the per-month working
     that produces it is also shown — repeating it up here would be the
     same number in two places. */

  /* Relaxation exists to offset unpaid leave, so the unpaid balance is the
     only thing that decides whether the action is offered. Half-days count:
     `> 0` is deliberate — 0.5 unpaid days still earn the button, which a
     `>= 1` test would swallow.

     This used to read `relaxCap > 0 ? relaxLeft > 0 : unpaidLeave > 0`,
     which ignored the unpaid balance entirely whenever a cap was known —
     hiding the button on unpaid days once the cap was spent, and offering
     it on quarters with nothing to relax. */
  const canRelax = unpaidLeave > 0;

  return (
    <div className="uidai-pmis-content ld-page">
      <style>{LD_CSS}</style>

      {/* Header — eyebrow carries the project, the title the employee, matching
          the Attendance and Resources pages. */}
      <header className="ld-head">
        <div className="ld-head-main">
          <div className="ld-eyebrow">{project?.projectName || "Project"}</div>
          <h1 className="uidai-pmis-title ld-title">{loading ? "Loading…" : employeeName}</h1>
          {/* Directly under the name, the way the Attendance table's name cell
              carries it — it identifies the person, so it belongs with them
              rather than filed among the quarter's figures below. */}
          {d.designation && <div className="ld-desig">{d.designation}</div>}
          <p className="uidai-pmis-subtitle ld-subtitle">
            Quarterly leave detail · Attendance ID {show(d.attendanceId || attendanceId)}
            {" · "}Q{show(d.quarter || quarter)} {show(d.year || year)}
          </p>
        </div>
        <div className="ld-head-actions">
          {canRelax && !loading && !error && !paramError && (
            <button className="ld-btn ld-btn--primary" onClick={() => setRelaxOpen(true)}>
              Relaxation
            </button>
          )}
          <button className="ld-close" onClick={() => navigate(-1)} aria-label="Close">
            <FiX size={20} />
          </button>
        </div>
      </header>

      {/* A malformed link is a dead end, not a retry — say what's wrong and
          offer the way back rather than leaving a spinner or a bare 400. */}
      {paramError ? (
        <div className="ld-error" role="alert">
          <span aria-hidden="true">⚠️</span>
          <span>
            {paramError}
            <button type="button" className="ld-error-act" onClick={() => navigate(-1)}>
              Go back
            </button>
          </span>
        </div>
      ) : (
        <>
          {loading && <div className="ld-muted">Loading leave detail…</div>}
          {error && <div className="ld-error" role="alert">⚠️ {error}</div>}
        </>
      )}

      {!loading && !error && !paramError && (
        <>
          {/* Leave summary — one card, one chart, one list. The donut shows
              how Leave Taken splits; the list carries the remaining figures
              from the report. All labels are the RFP's own terms. */}
          <section className="ld-section">
            <h2 className="ld-section-title">
              Leave summary
              <Hint text={SECTION_HINT} />
            </h2>
            <div className="uidai-pmis-card ld-card">
              <div className="ld-glance">
                <div className="ld-glance-chart">
                  <LeaveDonut
                    segments={splitSegments}
                    total={splitTotal}
                    hoverKey={hoverKey}
                    onHover={setHoverKey}
                  />
                </div>

                {/* The legend doubles as the table view — every value is here
                    as text, so nothing rides on colour or on hovering. */}
                <div className="ld-legend">
                  {splitSegments.map((s) => (
                    <div
                      key={s.key}
                      className={`ld-legend-row${hoverKey === s.key ? " is-on" : ""}${
                        s.value === 0 ? " is-zero" : ""
                      }`}
                      onMouseEnter={() => s.value > 0 && setHoverKey(s.key)}
                      onMouseLeave={() => setHoverKey(null)}
                    >
                      <span className="ld-legend-dot" style={{ background: s.color }} />
                      <span className="ld-legend-lbl">
                        {s.label}
                        <Hint text={s.hint} />
                      </span>
                      <span className="ld-legend-val">{s.value}</span>
                    </div>
                  ))}
                  {!breakdownBalances && leaveTaken > 0 && (
                    <div className="ld-legend-note">
                      Report lists {leaveTaken} days taken — chart plots {splitTotal}.
                    </div>
                  )}
                </div>

              </div>
            </div>

            {/* The eight-figure grid, as it was. The donut above shows how the
                quarter split; this carries every number the report returns. */}
            <div className="ld-grid" style={{ marginTop: 14 }}>
              {SUMMARY_CARDS.map((c) => (
                <StatCard
                  key={c.key}
                  tone={c.tone}
                  icon={c.icon}
                  label={c.label}
                  value={show(d[c.key])}
                  hint={HINTS[c.key]}
                />
              ))}
            </div>

            {/* Only rendered when a document was actually filed — see the
                hook's note on why a missing one isn't an error. */}
            <RelaxationDocCard file={relaxDoc} />
          </section>

          {/* Employee + quarter context */}
          <section className="ld-section">
            <h2 className="ld-section-title">Employee</h2>
            <div className="uidai-pmis-card ld-card">
              <div className="ld-info">
                <InfoItem tone="blue" icon={<FiUser />} label="Employee Name" value={show(d.employeeName)} />
                {/* Designation now sits under the employee name in the header
                    — it names the person, not the quarter, and repeating it
                    here would be the same fact in two places on one screen. */}
                <InfoItem tone="purple" icon={<FiHash />} label="Attendance ID" value={show(d.attendanceId || attendanceId)} />
                <InfoItem tone="blue" icon={<FiBriefcase />} label="Project Name" value={show(d.projectName || project?.projectName)} />
                <InfoItem tone="green" icon={<FiCalendar />} label="Joining Date" value={show(d.joiningDate)} />
                {CONTEXT_CARDS.map((c) => (
                  <InfoItem key={c.key} tone={c.tone} icon={c.icon} label={c.label} value={show(d[c.key])} />
                ))}
              </div>
            </div>
          </section>

          {/* TEMPORARY — three candidate layouts behind a switcher. */}
          <LeaveDatesSection
            paidDates={paidDates}
            unpaidDates={unpaidDates}
            halfDayDates={halfDayDates}
            unassignedHalves={halfSplit.unassigned}
            sandwichDates={sandwichDates}
            year={d.year || year}
            quarter={d.quarter || quarter}
            note={
              unpaidDates.length > 0 && unpaidLeave === 0
                ? relaxUsed > 0
                  ? `Covered by ${relaxUsed} relaxation ${relaxUsed === 1 ? "day" : "days"} — nothing deducted.`
                  : "No unpaid balance remaining — nothing deducted."
                : null
            }
          />

          {/* Quarterly cost report */}
          <section className="ld-section">
            <h2 className="ld-section-title">Quarterly cost report</h2>
            <CostReportSection
              loading={costLoading}
              error={costError}
              report={costReport}
              totals={costTotals}
            />
          </section>
        </>
      )}

      {relaxOpen && (
        <RelaxationModal
          resourceId={resourceId}
          projectId={d.projectId || projectId}
          year={d.year || year}
          quarter={d.quarter || quarter}
          hasDocument={!!relaxDoc}
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

/* =====================================================================
   "At a glance" — the plain-language answer to "why this much data?"

   A reader who has never seen this report needs three things before any
   table: how the quarter's leave split, whether any of it costs money,
   and how much allowance is left. Everything below is that, in order.
   ===================================================================== */

/* Donut of the leave split. Part-to-whole at a glance with three
   segments, which is what a donut is actually good at — it is NOT here to
   compare close values, so every segment also carries its exact number in
   the legend beside it. */
function LeaveDonut({ segments, total, hoverKey, onHover }) {
  const R = 58;
  // Thinner ring reads more considered than a fat one; the arc maths is
  // measured along the circumference, so stroke width doesn't touch it.
  const STROKE = 16;
  const CIRC = 2 * Math.PI * R;
  const live = segments.filter((s) => s.value > 0);

  // The 2px separator is a gap in the surface, not a stroke around each
  // arc. With a single segment there is no neighbour to separate from, so
  // the gap would just read as a notch cut out of a full ring.
  const gap = live.length > 1 ? 2 : 0;

  let walked = 0;
  const arcs = live.map((s) => {
    const frac = s.value / total;
    const full = frac * CIRC;
    const arc = { ...s, len: Math.max(full - gap, 0.5), offset: walked };
    walked += full;
    return arc;
  });

  const focused = live.find((s) => s.key === hoverKey);

  return (
    <svg
      className="ld-donut"
      viewBox="0 0 160 160"
      role="img"
      aria-label={`Leave split: ${live
        .map((s) => `${s.label} ${s.value} days`)
        .join(", ")}. Total ${total} days.`}
    >
      <g transform="rotate(-90 80 80)">
        {/* Track — visible only when there is nothing to plot, so an empty
            quarter still renders as a ring rather than blank space. */}
        {live.length === 0 && (
          <circle cx="80" cy="80" r={R} fill="none" stroke="#e8edf5" strokeWidth={STROKE} />
        )}
        {arcs.map((a) => (
          <circle
            key={a.key}
            cx="80"
            cy="80"
            r={R}
            fill="none"
            stroke={a.color}
            strokeWidth={hoverKey === a.key ? STROKE + 4 : STROKE}
            strokeDasharray={`${a.len} ${CIRC - a.len}`}
            strokeDashoffset={-a.offset}
            opacity={hoverKey && hoverKey !== a.key ? 0.35 : 1}
            style={{ transition: "opacity .15s ease, stroke-width .15s ease", cursor: "pointer" }}
            onMouseEnter={() => onHover(a.key)}
            onMouseLeave={() => onHover(null)}
          >
            <title>{`${a.label}: ${a.value} of ${total} days`}</title>
          </circle>
        ))}
      </g>
      {/* Centre reads the total, or the hovered segment while pointing. */}
      <text className="ld-donut-num" x="80" y="76" textAnchor="middle">
        {focused ? focused.value : total}
      </text>
      <text className="ld-donut-cap" x="80" y="94" textAnchor="middle">
        {focused ? focused.label.toUpperCase() : total === 1 ? "DAY TAKEN" : "DAYS TAKEN"}
      </text>
    </svg>
  );
}

// Same restraint as StatCard — the icon is a quiet marker beside the label,
// not a coloured badge competing with the value.
function InfoItem({ icon, label, value }) {
  return (
    <div className="ld-info-item">
      <div className="ld-info-lbl">
        {icon && <span className="ld-info-ico">{icon}</span>}
        {label}
      </div>
      <div className="ld-info-val">{value}</div>
    </div>
  );
}

/* Colour is spent only where it carries meaning: the figures that mean pay
   is being withheld. Every other tile stays neutral — eight tinted icon
   chips in seven hues were decorating the page, not informing it, and they
   drowned out the two numbers that actually matter. */
function StatCard({ tone, icon, label, value, hint, sub }) {
  const alert = tone === "red";
  return (
    <div className={`ld-stat${alert ? " ld-stat--alert" : ""}`}>
      <div className="ld-stat-lbl">
        {icon && <span className="ld-stat-ico">{icon}</span>}
        <span className="ld-stat-lbl-txt">{label}</span>
        <Hint text={hint} />
      </div>
      <div className="ld-stat-val">{value}</div>
      {sub && <div className="ld-stat-sub">{sub}</div>}
    </div>
  );
}

/* Days a list of dates actually costs — a half day counts 0.5. The header
   used to read the array length as a day count, which is wrong the moment
   any of them is a half day (8 dates, 6 days). */
function countDays(dates, halfSet) {
  return dates.reduce((sum, dt) => sum + (halfSet?.has(dateKey(dt)) ? 0.5 : 1), 0);
}

function DateList({ color, chipBg, title, dates, note, halfSet }) {
  const days = countDays(dates, halfSet);
  const halves = dates.filter((dt) => halfSet?.has(dateKey(dt))).length;
  return (
    <div className="ld-datecol">
      {/* The swatch is the exact donut-segment colour, so the tie between
          this list and that slice is visual rather than explained. */}
      <div className="ld-datehead">
        <span className="ld-datehead-dot" style={{ background: color }} />
        {title} · {dayCount(days)} {days === 1 ? "day" : "days"}
        {/* Only worth spelling out when the two numbers differ. */}
        {halves > 0 && (
          <span className="ld-datehead-sub">
            {dates.length} dates · {halves} half
          </span>
        )}
      </div>
      {note && <div className="ld-datenote">{note}</div>}
      {dates.length ? (
        <div className="ld-datechips">
          {dates.map((dt, i) => {
            const half = halfSet?.has(dateKey(dt));
            return (
              <span
                key={i}
                className={`ld-datechip${half ? " is-half" : ""}`}
                // --chip-band colours the half-width underline (see .is-half::before).
                style={{ background: chipBg, color: C.ink, "--chip-band": color }}
                title={half ? `${dt} · Half day (0.5)` : `${dt} · Full day (1)`}
              >
                {dt}
              </span>
            );
          })}
        </div>
      ) : (
        <div className="ld-muted" style={{ padding: "4px 0" }}>None</div>
      )}
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════
   TEMPORARY — the three candidates. Keep one, delete the rest.
   ═══════════════════════════════════════════════════════════════════ */

function MonthGrid({ year, month, paidSet, unpaidSet, halfSet, sandwichSet, halfOnlySet }) {
  const cells = buildMonthGrid(year, month);
  return (
    <div className="ld-cal">
      <div className="ld-cal-title">{MONTH_NAMES[month]} {year}</div>
      <div className="ld-cal-dow">
        {DOW.map((d, i) => <span key={i}>{d}</span>)}
      </div>
      <div className="ld-cal-grid">
        {cells.map((day, i) => {
          if (!day) return <span key={i} className="ld-cal-cell is-blank" />;
          const key = `${year}-${pad2(month)}-${pad2(day)}`;
          const paid = paidSet.has(key);
          const unpaid = unpaidSet.has(key);
          const sandwich = sandwichSet.has(key);
          /* A half day is a modifier on paid/unpaid, never a state of its own
             — except in the fallback where the report left its bucket
             unrecoverable, which is the one case it has to stand alone. */
          const halfOnly = !!halfOnlySet?.has(key) && !paid && !unpaid;
          const half = (halfSet.has(key) && (paid || unpaid)) || halfOnly;
          // Monday-first grid: indexes 5 and 6 of each week are Sat/Sun.
          const weekend = i % 7 >= 5;
          /* Sandwich is checked before the weekend fallback: a sandwich day IS
             normally a weekend, and the fact that it's being charged as leave
             outranks the fact that it's a Saturday. */
          const cls = paid ? " is-paid"
            : unpaid ? " is-unpaid"
            : sandwich ? " is-sandwich"
            : halfOnly ? " is-halfonly"
            : weekend ? " is-weekend" : "";
          // "Taken Leave" rather than "Paid Leave", matching the legend below.
          const kind = paid ? "Taken Leave"
            : unpaid ? "Unpaid Leave"
            : sandwich ? "Sandwich Leave"
            : halfOnly ? "Half day — paid or unpaid not stated" : "";
          const title = kind
            ? `${key} · ${kind}${half ? " · Half day (0.5)" : sandwich ? "" : " · Full day (1)"}`
            : key;
          return (
            <span key={i} className={`ld-cal-cell${cls}${half ? " is-half" : ""}`} title={title}>
              {day}
            </span>
          );
        })}
      </div>
    </div>
  );
}

/* Candidate A — quarter calendar. The only view where a weekend caught
   between two unpaid days is visible, which is what sandwich leave is. */
function QuarterCalendar({
  year, quarter, paidDates, unpaidDates,
  halfDayDates = [], sandwichDates = [], unassignedHalves = [],
}) {
  const q = Number(quarter) || 1;
  const yr = Number(year) || new Date().getFullYear();
  const paidSet = new Set(paidDates.map(dateKey).filter(Boolean));
  const unpaidSet = new Set(unpaidDates.map(dateKey).filter(Boolean));
  const halfSet = new Set(halfDayDates.map(dateKey).filter(Boolean));
  const sandwichSet = new Set(sandwichDates.map(dateKey).filter(Boolean));
  /* Half days whose bucket couldn't be recovered still get marked, in a
     neutral tone — an unclassified leave day is a day the reader needs to
     see, and leaving the cell blank is the failure this whole change fixes. */
  const halfOnlySet = new Set(unassignedHalves.map(dateKey).filter(Boolean));
  const months = [0, 1, 2].map((i) => (q - 1) * 3 + 1 + i);

  const matched = paidSet.size + unpaidSet.size + sandwichSet.size + halfOnlySet.size;
  const total =
    paidDates.length + unpaidDates.length + sandwichDates.length + unassignedHalves.length;
  const hasHalf = halfSet.size > 0;

  return (
    <>
      <div className="ld-cal-wrap">
        {months.map((m) => (
          <MonthGrid
            key={m}
            year={yr}
            month={m}
            paidSet={paidSet}
            unpaidSet={unpaidSet}
            halfSet={halfSet}
            sandwichSet={sandwichSet}
            halfOnlySet={halfOnlySet}
          />
        ))}
      </div>
      <div className="ld-cal-legend">
        {/* One key, because paid and unpaid days now share one colour. Two
            entries with identical swatches would ask the reader to tell them
            apart by a difference that isn't there. Which days were unpaid is
            still on each cell's tooltip and in the lists below. */}
        <span><i className="ld-cal-key is-leave" /> Leave Taken</span>
        {/* Keys for categories the quarter doesn't contain are omitted —
            a legend entry with nothing to point at is just noise. */}
        {hasHalf && <span><i className="ld-cal-key is-halfkey" /> Half Day (0.5)</span>}
        {sandwichSet.size > 0 && <span><i className="ld-cal-key is-sandwich" /> Sandwich Leave</span>}
        <span><i className="ld-cal-key is-weekend" /> Weekend</span>
      </div>
      {/* An unreadable date format would silently mark nothing — say so
          rather than showing an empty quarter as if it were leave-free. */}
      {total > 0 && matched === 0 && (
        <div className="ld-datenote" style={{ marginTop: 12 }}>
          {total} leave dates were returned but none could be read as calendar
          dates, so no days are marked below.
        </div>
      )}
    </>
  );
}

/* Candidate B — the current chip lists, foldable. */
function DateChipLists({
  paidDates, unpaidDates, note, halfSet, sandwichDates = [], unassignedHalves = [],
}) {
  return (
    <div className="ld-dates">
      <DateList color="#2a78d6" chipBg="#eaf2fd" title="Paid Leave Dates" dates={paidDates} halfSet={halfSet} />
      <DateList color="#e34948" chipBg="#fdecec" title="Unpaid Leave Dates" dates={unpaidDates} note={note} halfSet={halfSet} />
      {/* Its own column, unlike half days — a sandwich day is charged on top
          of the paid/unpaid lists rather than reclassifying a day in them. */}
      {sandwichDates.length > 0 && (
        <DateList color="#8a6d3b" chipBg="#f8f3ea" title="Sandwich Leave Dates" dates={sandwichDates} />
      )}
      {/* Only when the paid/unpaid split couldn't be recovered — see
          assignHalfDays. Neutral on purpose: showing these dates under a
          colour we'd be guessing at is worse than showing them uncoloured,
          and dropping them (what happens today) is worse than both. */}
      {unassignedHalves.length > 0 && (
        <DateList
          color={C.muted}
          chipBg="#eef2f7"
          title="Half Days (0.5)"
          dates={unassignedHalves}
          note="These count 0.5 each. The report didn't say whether they're paid or unpaid."
        />
      )}
    </div>
  );
}

/* Hosts all three so they can be compared. The switcher is scaffolding —
   it goes when one is picked. */
function LeaveDatesSection({
  paidDates, unpaidDates, note, year, quarter,
  halfDayDates = [], sandwichDates = [], unassignedHalves = [],
}) {
  const [view, setView] = useState("calendar");
  const [open, setOpen] = useState(true);
  const [drawer, setDrawer] = useState(false);

  // Normalised once here — every candidate view below needs the same lookup.
  const halfSet = useMemo(
    () => new Set(halfDayDates.map(dateKey).filter(Boolean)),
    [halfDayDates]
  );
  const totalDates =
    paidDates.length + unpaidDates.length + sandwichDates.length + unassignedHalves.length;

  const VIEWS = [
    ["calendar", "A · Calendar"],
    ["collapse", "B · Collapsible"],
    ["drawer", "C · Side drawer"],
  ];

  return (
    <section className="ld-section">
      <h2 className="ld-section-title">
        Leave dates
        <span className="ld-switch">
          {VIEWS.map(([k, lbl]) => (
            <button
              key={k}
              type="button"
              className={`ld-switch-btn${view === k ? " is-on" : ""}`}
              onClick={() => setView(k)}
            >
              {lbl}
            </button>
          ))}
        </span>
      </h2>

      {view === "calendar" && (
        <div className="uidai-pmis-card ld-card">
          <QuarterCalendar
            year={year}
            quarter={quarter}
            paidDates={paidDates}
            unpaidDates={unpaidDates}
            halfDayDates={halfDayDates}
            sandwichDates={sandwichDates}
            unassignedHalves={unassignedHalves}
          />
        </div>
      )}

      {view === "collapse" && (
        <div className="uidai-pmis-card ld-card" style={{ padding: 0 }}>
          <button
            type="button"
            className="ld-fold"
            aria-expanded={open}
            onClick={() => setOpen((o) => !o)}
          >
            <span className="ld-fold-chev">{open ? "▾" : "▸"}</span>
            Paid &amp; unpaid leave dates
            <span className="ld-fold-count">
              {totalDates} dates
            </span>
          </button>
          {open && (
            <div style={{ padding: "0 20px 18px" }}>
              <DateChipLists
                paidDates={paidDates}
                unpaidDates={unpaidDates}
                sandwichDates={sandwichDates}
                unassignedHalves={unassignedHalves}
                halfSet={halfSet}
                note={note}
              />
            </div>
          )}
        </div>
      )}

      {view === "drawer" && (
        <>
          <div className="uidai-pmis-card ld-card">
            <div className="ld-drawer-teaser">
              <div>
                <div className="ld-drawer-teaser-num">
                  {totalDates}
                </div>
                <div className="ld-drawer-teaser-cap">leave dates this quarter</div>
              </div>
              <button className="ld-btn ld-btn--ghost" onClick={() => setDrawer(true)}>
                View leave dates →
              </button>
            </div>
          </div>
          {drawer && (
            <div className="ld-scrim" onMouseDown={(e) => e.target === e.currentTarget && setDrawer(false)}>
              <aside className="ld-drawer" role="dialog" aria-modal="true" aria-label="Leave dates">
                <div className="ld-drawer-head">
                  <h3 className="ld-drawer-title">Leave dates</h3>
                  <button className="ld-close" onClick={() => setDrawer(false)} aria-label="Close">
                    <FiX size={18} />
                  </button>
                </div>
                <div className="ld-drawer-body">
                  <DateList color="#2a78d6" chipBg="#eaf2fd" title="Paid Leave Dates" dates={paidDates} halfSet={halfSet} />
                  <div style={{ height: 22 }} />
                  <DateList color="#e34948" chipBg="#fdecec" title="Unpaid Leave Dates" dates={unpaidDates} note={note} halfSet={halfSet} />
                  {sandwichDates.length > 0 && (
                    <>
                      <div style={{ height: 22 }} />
                      <DateList color="#8a6d3b" chipBg="#f8f3ea" title="Sandwich Leave Dates" dates={sandwichDates} />
                    </>
                  )}
                  {unassignedHalves.length > 0 && (
                    <>
                      <div style={{ height: 22 }} />
                      <DateList
                        color={C.muted}
                        chipBg="#eef2f7"
                        title="Half Days (0.5)"
                        dates={unassignedHalves}
                        note="These count 0.5 each. The report didn't say whether they're paid or unpaid."
                      />
                    </>
                  )}
                </div>
              </aside>
            </div>
          )}
        </>
      )}
    </section>
  );
}

/* =====================================================================
   Quarterly Cost Report
   GET /api/attendance/cost/quarterly?resourceId=&year=&quarter=
   Shape: { attendanceId, employeeName, projectId, period, calendarDays,
            plannedPeriodCost, perDayCost, unpaidLeaveDays, paidCalendarDays,
            deductedAmount, periodCost, relaxationDays, relaxationCost,
            totalCost,
            monthlyBreakdown: [{ period, rateYear, workingDays, presentDays,
              halfDays, absentDays, paidLeaveDays, calendarDays,
              unpaidLeaveDays, paidCalendarDays, monthlyRate, perDayRate,
              deductedAmount, cost, ... }] }

   The money is charged on CALENDAR days, not working days:
     perDayCost     = plannedPeriodCost ÷ calendarDays
     deductedAmount = unpaidLeaveDays × perDayCost
     totalCost      = plannedPeriodCost − deductedAmount
   and the same chain per month against monthlyRate ÷ calendarDays. The
   working-day figures (workingDays / presentDays / absentDays) describe
   attendance and are on a different denominator — see the grouped headers
   on the table below.

   Falls back to a generic key/value + JSON dump for any extra top-level
   fields the API adds later, so nothing is silently dropped.
   ===================================================================== */
const COST_KNOWN_KEYS = new Set([
  "attendanceId", "employeeName", "projectId", "period", "totalCost", "monthlyBreakdown",
  // Surfaced by the cost-chain strip rather than as loose cards.
  "calendarDays", "plannedPeriodCost", "perDayCost", "unpaidLeaveDays",
  "paidCalendarDays", "deductedAmount", "periodCost",
  // Rendered as a footer row in the table rather than as loose cards below it.
  // `relaxationCost` is the current name; `relaxationAmount` the older one.
  "relaxationCost", "relaxationAmount", "relaxationDays",
]);

/* ── the quarter's money, as one sentence ─────────────────────────────
   The payload is a derivation chain, and showing every link at equal weight
   — four stat cards in a row — left the reader to work out for themselves
   that Planned minus Deducted is where Total came from. Here the arithmetic
   runs in the order it happens, and the meter underneath shows how much of
   the plan survived as billable.

   The working (calendar days, the per-day rate) is what a disputed figure
   needs and nothing a satisfied reader wants, so it starts closed. Every
   figure is written out as text either way — the meter is a second reading
   of numbers already on screen, never the only way to reach one. */
function ChainTerm({ label, value, amount, total }) {
  return (
    <div className={`ld-chain-term${total ? " is-total" : ""}`}>
      <div className="ld-chain-lbl">{label}</div>
      {/* The figure spelled out on hover. These are the largest numbers on the
          page, and the one place a reader is asked to check that the
          arithmetic closes — so they're the ones worth being sure of. */}
      <div className="ld-chain-val" title={rupeesInWords(amount)}>{value}</div>
    </div>
  );
}

function CostChain({
  planned, deducted, relaxation, relaxationDays, total,
  calendarDays, paidCalendarDays, unpaidDays, perDayCost,
}) {
  const billablePct =
    planned > 0 ? Math.min(100, Math.max(0, (total / planned) * 100)) : 0;
  // The working only reads as an explanation when both halves of it are real.
  const showWorking = num(calendarDays) > 0 && num(perDayCost) > 0;

  return (
    <div className="uidai-pmis-card ld-chain">
      <div className="ld-chain-row">
        <ChainTerm label="Planned" value={money(planned)} amount={planned} />
        <span className="ld-chain-op" aria-hidden="true">−</span>
        <ChainTerm label="Deducted" value={money(deducted)} amount={deducted} />
        {relaxation > 0 && (
          <>
            <span className="ld-chain-op" aria-hidden="true">+</span>
            <ChainTerm
              label={
                relaxationDays > 0
                  ? `Relaxation · ${dayCount(relaxationDays)} ${relaxationDays === 1 ? "day" : "days"}`
                  : "Relaxation"
              }
              value={money(relaxation)}
              amount={relaxation}
            />
          </>
        )}
        <span className="ld-chain-op" aria-hidden="true">=</span>
        <ChainTerm label="Billable" value={money(total)} amount={total} total />
      </div>

      {/* Meter, not a two-slice pie: this is one ratio against a limit. The
          track is a lighter step of the fill's own hue, so the whole bar
          reads as the plan and the fill as the part of it that survived. */}
      {planned > 0 && (
        <>
          <div
            className="ld-chain-meter"
            role="img"
            aria-label={`${billablePct.toFixed(1)}% of the planned cost is billable`}
          >
            <div className="ld-chain-meter-fill" style={{ width: `${billablePct}%` }} />
          </div>
          <div className="ld-chain-meter-cap">
            {billablePct.toFixed(1)}% of the planned cost is billable
          </div>
        </>
      )}

      {showWorking && (
        <details className="ld-chain-working">
          <summary>How the deduction was worked out</summary>
          <p>
            <span title={rupeesInWords(planned)}>{money(planned)}</span> ÷{" "}
            {dayCount(calendarDays)} calendar days
            = <strong title={rupeesInWords(perDayCost)}>{money(perDayCost)}</strong> a day.
            {" "}
            {dayCount(unpaidDays)} unpaid {num(unpaidDays) === 1 ? "day" : "days"}
            {" "}× <span title={rupeesInWords(perDayCost)}>{money(perDayCost)}</span>
            {" "}= <strong title={rupeesInWords(deducted)}>{money(deducted)}</strong> withheld,
            leaving {dayCount(paidCalendarDays)} of {dayCount(calendarDays)} days paid.
          </p>
          <p className="ld-chain-working-note">
            The cost is charged on calendar days. The working-day figures in the
            table below (working, present, leave) describe attendance and sit on a
            different denominator — only the unpaid-day count crosses between them.
          </p>
        </details>
      )}
    </div>
  );
}

function CostReportSection({ loading, error, report, totals }) {
  if (loading) return <div className="ld-muted">Loading cost report…</div>;
  if (error) return <div className="ld-error">⚠️ {error}</div>;
  if (!report || typeof report !== "object" || Object.keys(report).length === 0) {
    return <div className="ld-muted">No cost data available.</div>;
  }

  const months = Array.isArray(report.monthlyBreakdown) ? report.monthlyBreakdown : [];
  /* Older payloads carry no band on the month rows; two columns of "—" say
     less than no columns at all, so they appear only when there's data. */
  const showBand = months.some((m) => m.fromDate || m.toDate);
  const extraEntries = Object.entries(report).filter(([k]) => !COST_KNOWN_KEYS.has(k));

  /* The envelope's totals carry the quarter's deduction; without one (older
     payload shape) the months add up to the same figure. */
  const totalDeducted =
    totals?.totalDeductedAmount != null
      ? num(totals.totalDeductedAmount)
      : months.reduce((t, m) => t + num(m.deductedAmount), 0);

  /* ── why the relaxation line sits inside the table ─────────────────────
     The Cost column doesn't add up to Total Cost on its own — the relaxation
     amount is added back on top of it. Verified against the live Q3-2026
     payload: the three months' costs (₹94,295.26 + ₹95,830.30 + ₹91,266.95)
     come to ₹2,81,392.51, and only with the ₹7,092.70 relaxation do they
     reach the ₹2,88,485.21 Total Cost. Shown as a card beneath the table it
     read as an unrelated statistic and left the total looking wrong; as the
     row directly above the total, the arithmetic closes. */
  /* Named `relaxationCost` in the current payload, `relaxationAmount` in
     older ones. Reading only the old name meant these rows silently never
     rendered — invisible while the figure is 0, but it would have left the
     Cost column not adding up to Total Cost the moment one was granted. */
  const relaxationAmount =
    report.relaxationCost != null ? num(report.relaxationCost) : num(report.relaxationAmount);
  const relaxationDays = num(report.relaxationDays);
  const monthsSubtotal = months.reduce((t, m) => t + num(m.cost), 0);

  /* Older payloads omit plannedPeriodCost; the chain still closes without it
     because it's whatever the total was worked back from. */
  const totalCost = num(report.totalCost);
  const planned =
    report.plannedPeriodCost != null
      ? num(report.plannedPeriodCost)
      : totalCost + totalDeducted - relaxationAmount;

  return (
    <>
      <CostChain
        planned={planned}
        deducted={totalDeducted}
        relaxation={relaxationAmount}
        relaxationDays={relaxationDays}
        total={totalCost}
        calendarDays={report.calendarDays}
        paidCalendarDays={report.paidCalendarDays}
        unpaidDays={report.unpaidLeaveDays}
        perDayCost={report.perDayCost}
      />

      {/* Monthly breakdown table */}
      {months.length > 0 && (
        <div className="uidai-pmis-card ld-costtable-card">
          <div className="ld-costtable-wrap">
          <table className="ld-costtable">
            <thead>
              {/* The two halves of this table count in different units —
                  attendance in working days, money in calendar days. Left
                  ungrouped, a reader naturally tries to reconcile 21 working
                  days against a rate divided by 31, and can't. The band says
                  outright that they don't meet. */}
              <tr className="ld-costtable-grouprow">
                {/* Period, the two band dates, Calendar Days and Rate Year —
                    all of which say WHICH days this row is about, before
                    either group starts counting them. */}
                <th colSpan={3 + (showBand ? 2 : 0)} />
                <th colSpan={3} className="ld-costtable-group">Attendance · working days</th>
                <th colSpan={4} className="ld-costtable-group ld-costtable-group--cost">Cost · calendar days</th>
              </tr>
              <tr>
                <th title="The month this row covers.">Period</th>
                {showBand && (
                  <>
                    {/* The band this month is rated over. Worth a column of its
                        own because it is NOT always the calendar month: bands
                        can run 7th-to-6th, and they differ between resources on
                        the same project — so "January 2026" alone doesn't say
                        which days were actually charged. */}
                    <th title="First day of the period this row is rated over.">Start Date</th>
                    <th title="Last day of the period this row is rated over. Per Day Rate is the monthly rate divided by the number of days between these two dates.">End Date</th>
                  </>
                )}
                {/* Sits with the two dates rather than over in the cost group:
                    it counts the days between them, so the three read as one
                    statement of the period. Usually the full span, but fewer
                    for anyone who joined or left partway through — without
                    that note a row reading "7 Jan → 6 Feb" beside a 2 looks
                    like a bug. */}
                <th className="ld-num" title="Billable days in the period — normally the full span of the Start and End dates, but fewer for anyone who joined or left partway through. Per Day Rate is still divided over the whole span.">Calendar Days</th>
                <th title="Which year of the resource's rate card was used for this month.">Rate Year</th>
                <th className="ld-num" title="Total working days in the month, excluding weekends and holidays.">Working Days</th>
                <th className="ld-num" title="Paid leave plus unpaid leave for the month. Derived here — the report sends the parts but no total. Relaxation days are not included.">Total Leave</th>
                <th className="ld-num" title="Days the employee was present. Half days count as 0.5.">Present Days</th>
                {/* <th className="ld-num" title="Present days as a percentage of working days.">Attendance %</th> */}
                <th className="ld-num" title="Full monthly rate from the rate card, before any deduction.">Monthly Rate</th>
                <th className="ld-num" title="Monthly rate divided by the calendar days in the month — not the working days. January: ₹1,98,434 ÷ 31 = ₹6,401.10.">Per Day Rate</th>
                {/* <th className="ld-num">HalfDay Amount</th> */}
                <th className="ld-num" title="Unpaid days for the month charged at the per-day rate. This is the one figure that crosses from the attendance half of the table into the cost half.">Deducted Amount</th>
                <th className="ld-num" title="Monthly rate minus the deducted amount — what is billable for the month.">Cost</th>
              </tr>
            </thead>
            <tbody>
              {months.map((m, i) => {
                const leave = monthLeave(m);
                return (
                <tr key={i}>
                  <td className="ld-costtable-period">{show(m.period)}</td>
                  {showBand && (
                    <>
                      <td className="ld-costtable-band">{formatBandDate(m.fromDate) || "—"}</td>
                      <td className="ld-costtable-band">{formatBandDate(m.toDate) || "—"}</td>
                    </>
                  )}
                  <td className="ld-num ld-dim">{show(m.calendarDays)}</td>
                  <td>{show(m.rateYear)}</td>
                  <td className="ld-num">{show(m.workingDays)}</td>
                  <td
                    className="ld-num"
                    title={`${dayCount(leave.paid)} paid + ${dayCount(leave.unpaid)} unpaid`}
                  >
                    {dayCount(leave.total)}
                  </td>
                  <td className="ld-num">{show(m.presentDays)}</td>
                  {/* <td className="ld-num">
                    <span
                      className="ld-attpill"
                      style={{
                        background: num(m.attendancePercentage) === 0 ? TONES.red.bg : TONES.green.bg,
                        color: num(m.attendancePercentage) === 0 ? TONES.red.fg : TONES.green.fg,
                      }}
                    >
                      {pct(m.attendancePercentage)}
                    </span>
                  </td> */}
                  {/* Every money cell spells its own figure out on hover — see
                      rupeesInWords. The title sits on the cell so the whole
                      column width is the hover target. */}
                  <td className="ld-num" title={rupeesInWords(m.monthlyRate)}>{money(m.monthlyRate)}</td>

                  <td className="ld-num" title={rupeesInWords(m.perDayRate)}>{money(m.perDayRate)}</td>
                  {/* <td className="ld-num ld-costtable-cost">{money(m.halfDayAmount)}</td> */}
                  {/* The accent belongs on Cost, the column the Total Cost row
                      sits under — it was on Deducted Amount, so the emphasised
                      column and the total it keys off were a column apart. */}
                  <td className="ld-num" title={rupeesInWords(m.deductedAmount)}>{money(m.deductedAmount)}</td>
                  <td className="ld-num ld-costtable-cost" title={rupeesInWords(m.cost)}>{money(m.cost)}</td>
                </tr>
                );
              })}
            </tbody>
            <tfoot>
              {/* Every footer label spans everything up to Cost, so the figure
                  lands under it: ten fixed body columns minus Cost, plus the
                  two band columns when they're shown. Derived rather than
                  written out three times — the Total Cost row had been left at
                  a stale 8 when Calendar Days was added, which pushed its
                  figure a column left of the one it totals. Restoring the
                  commented-out Attendance % / HalfDay Amount columns needs a
                  +1 each here. */}
              {relaxationAmount > 0 && (
                <>
                  <tr className="ld-costtable-subrow">
                    <td colSpan={9 + (showBand ? 2 : 0)} className="ld-costtable-totallbl">Subtotal</td>
                    <td className="ld-num" title={rupeesInWords(monthsSubtotal)}>{money(monthsSubtotal)}</td>
                  </tr>
                  <tr className="ld-costtable-subrow">
                    <td colSpan={9 + (showBand ? 2 : 0)} className="ld-costtable-totallbl">
                      Relaxation Amount
                      {relaxationDays > 0 && (
                        <span className="ld-costtable-sublbl">
                          {dayCount(relaxationDays)} {relaxationDays === 1 ? "day" : "days"} waived
                        </span>
                      )}
                    </td>
                    <td className="ld-num" title={rupeesInWords(relaxationAmount)}>+ {money(relaxationAmount)}</td>
                  </tr>
                </>
              )}
              <tr>
                <td colSpan={9 + (showBand ? 2 : 0)} className="ld-costtable-totallbl">Total Cost</td>
                <td className="ld-num ld-costtable-cost" title={rupeesInWords(report.totalCost)}>
                  {money(report.totalCost)}
                </td>
              </tr>
            </tfoot>
          </table>
          </div>
        </div>
      )}

      {/* {extraEntries.length > 0 && (
        <div className="ld-grid">
          {extraEntries
            .filter(([, v]) => v === null || typeof v !== "object")
            .map(([key, value]) => (
              <StatCard key={key} tone="amber" icon={<FiFileText />} label={formatLabel(key)} value={show(value)} />
            ))}
        </div>
      )} */}
    </>
  );
}

/* =====================================================================
   Quarterly Relaxation — grants relaxation days against unpaid leave.
   POST /api/attendance/quarterly-relaxation
   ===================================================================== */

/* ── input validation ────────────────────────────────────────────────
   The HTTP-message and value parsers live in utils/apiMessage.js and are
   shared with the Attendance page; only the rules specific to a
   relaxation grant are defined here. */

const MAX_REMARKS = 500;

/* "2026-03-30" → "30 Mar 2026", for the eligible-dates dropdown. Falls back
   to the raw value on anything dateKey can't parse, so an odd server string
   still shows rather than vanishing. */
function formatLeaveDate(raw) {
  const key = dateKey(raw);
  if (!key) return String(raw ?? "");
  const [y, m, d] = key.split("-").map(Number);
  return `${d} ${MONTH_NAMES[m].slice(0, 3)} ${y}`;
}

/* The relaxation endpoint takes every field in the query string and the
   supporting image as the `attachment` part of a multipart body:

     POST /api/attendance/quarterly-relaxation?resourceId=&projectId=
          &year=&quarter=&relaxationDays=
     Content-Type: multipart/form-data   -F attachment=@proof.png

   The attachment is optional, so the form always sends a FormData — empty
   when no image was picked. That keeps the request multipart either way,
   which a controller declaring `consumes = multipart/form-data` requires,
   while the absent part satisfies an optional @RequestPart. */
const MAX_ATTACHMENT_BYTES = 5 * 1024 * 1024;
const ACCEPTED_IMAGE = /^image\/(png|jpe?g|webp|gif)$/i;

const fmtBytes = (n) => {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
};

/* Drop zone before a file is chosen, thumbnail + remove after. The preview
   URL is revoked when the file changes or the modal closes, so picking a
   few images in a row doesn't leak blobs. */
function AttachmentField({ file, onPick, onClear, error, disabled, replacing }) {
  const [dragOver, setDragOver] = useState(false);

  // Derived, not stored — a preview held in state would need a setState inside
  // an effect to stay in step with `file`. The effect only handles the revoke.
  const preview = useMemo(() => (file ? URL.createObjectURL(file) : ""), [file]);
  useEffect(() => () => { if (preview) URL.revokeObjectURL(preview); }, [preview]);

  const drop = (e) => {
    e.preventDefault();
    setDragOver(false);
    if (!disabled) onPick(e.dataTransfer?.files?.[0]);
  };

  return (
    <div className="ld-field ld-field--full">
      <span className="ld-field-lbl">
        Supporting Document
        <span className="ld-optional">Optional</span>
        <Hint text="A screenshot, scan or photo backing the exigency request (RFP 5.24.1.b.vi). The relaxation can be submitted without one." />
      </span>

      {file ? (
        <div className="ld-file">
          <img className="ld-file-thumb" src={preview} alt="" />
          <div className="ld-file-meta">
            <div className="ld-file-name" title={file.name}>{file.name}</div>
            <div className="ld-file-size">{fmtBytes(file.size)}</div>
          </div>
          <button
            type="button"
            className="ld-file-x"
            onClick={onClear}
            disabled={disabled}
            aria-label={`Remove ${file.name}`}
          >
            <FiX size={15} />
          </button>
        </div>
      ) : (
        <label
          className={`ld-drop${dragOver ? " is-over" : ""}${error ? " is-bad" : ""}`}
          onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
          onDragLeave={() => setDragOver(false)}
          onDrop={drop}
        >
          <input
            type="file"
            accept="image/png,image/jpeg,image/webp,image/gif"
            className="ld-drop-input"
            disabled={disabled}
            onChange={(e) => { onPick(e.target.files?.[0]); e.target.value = ""; }}
          />
          <FiUploadCloud className="ld-drop-ico" />
          <span className="ld-drop-main">
            Click to upload<span className="ld-drop-or"> or drag an image here</span>
          </span>
          <span className="ld-drop-sub">PNG, JPG, WEBP or GIF · up to 5 MB</span>
        </label>
      )}

      {error && <div className="ld-field-err">{error}</div>}
      {replacing && !error && (
        <div className="ld-field-note">
          A document is already on file for this quarter — uploading one replaces it.
        </div>
      )}
    </div>
  );
}

/* The filed document, shown under the leave summary. The thumbnail opens a
   full-size view; Download is a plain anchor over the blob URL, so the file
   is already in the browser and the save costs no second request. */
function RelaxationDocCard({ file }) {
  const [zoom, setZoom] = useState(false);

  useEffect(() => {
    if (!zoom) return undefined;
    const onKey = (e) => e.key === "Escape" && setZoom(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [zoom]);

  if (!file) return null;
  const isImage = file.type.startsWith("image/");

  return (
    <>
      <div className="ld-doc">
        {isImage ? (
          <button
            type="button"
            className="ld-doc-thumbbtn"
            onClick={() => setZoom(true)}
            aria-label={`View ${file.name} full size`}
          >
            <img className="ld-doc-thumb" src={file.url} alt="" />
          </button>
        ) : (
          <span className="ld-doc-thumb ld-doc-thumb--generic"><FiFileText /></span>
        )}

        <div className="ld-doc-meta">
          <div className="ld-doc-lbl">
            Relaxation supporting document
            <Hint text="The evidence filed with the relaxation request for this quarter." />
          </div>
          <div className="ld-doc-name" title={file.name}>{file.name}</div>
          <div className="ld-doc-size">{fmtBytes(file.size)}</div>
        </div>

        <div className="ld-doc-actions">
          {isImage && (
            <button type="button" className="ld-btn ld-btn--ghost" onClick={() => setZoom(true)}>View</button>
          )}
          <a className="ld-btn ld-btn--ghost" href={file.url} download={file.name}>
            <FiDownload size={14} /> Download
          </a>
        </div>
      </div>

      {zoom && isImage && (
        <div
          className="ld-backdrop"
          onMouseDown={(e) => e.target === e.currentTarget && setZoom(false)}
        >
          <div className="ld-lightbox" role="dialog" aria-modal="true" aria-label={file.name}>
            <div className="ld-lightbox-head">
              <span className="ld-lightbox-name" title={file.name}>{file.name}</span>
              <a className="ld-btn ld-btn--ghost" href={file.url} download={file.name}>
                <FiDownload size={14} /> Download
              </a>
              <button className="ld-close" onClick={() => setZoom(false)} aria-label="Close">
                <FiX size={18} />
              </button>
            </div>
            <img className="ld-lightbox-img" src={file.url} alt={file.name} />
          </div>
        </div>
      )}
    </>
  );
}

function RelaxationModal({ resourceId, projectId, year, quarter, hasDocument, onSuccess, onClose }) {
  const [form, setForm] = useState({
    resourceId: resourceId || "",
    projectId: projectId || "",
    year: year || "",
    quarter: Number(quarter) || 1,
    // Several dates per grant — relaxation is bought in days, and a day buys
    // two half days, so one pick is rarely the whole story.
    relaxationDates: [],
    remarks: "",
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const [done, setDone] = useState(false);
  const [doneMessage, setDoneMessage] = useState("");
  const [attachment, setAttachment] = useState(null);
  const [fileError, setFileError] = useState(null);
  // Per-field messages, keyed by field name. Populated on submit, then kept
  // live as the user edits so a corrected field clears the moment it's valid.
  const [fieldErrors, setFieldErrors] = useState({});
  const [submitted, setSubmitted] = useState(false);

  /* The dropdown's own source of truth — refetched whenever the form points
     at a different resource/project/period, since editing Year or Quarter
     here is allowed (see periodChanged below) and each period has its own
     eligible dates. */
  const {
    options: eligibleOptions,
    approved: approvedDates,
    approvedCost,
    loading: datesLoading,
  } = useEligibleRelaxationDates({
    resourceId: form.resourceId,
    projectId: form.projectId,
    year: form.year,
    quarter: form.quarter,
  });

  // Drop stale picks that fell out of the eligible list (e.g. Year/Quarter
  // just changed, or a date was granted elsewhere in the meantime).
  useEffect(() => {
    const live = new Set(eligibleOptions.map((o) => o.date));
    setForm((f) => {
      const kept = f.relaxationDates.filter((d) => live.has(d));
      return kept.length === f.relaxationDates.length ? f : { ...f, relaxationDates: kept };
    });
  }, [eligibleOptions]);

  /* What the current selection actually costs. This is the number the whole
     picker exists for: relaxation is granted in days, and the user is choosing
     dates that add up to it — four half days and two full days both come to
     two, and only the running total makes that visible while choosing. */
  const weightOf = (d) =>
    DAY_KINDS[eligibleOptions.find((o) => o.date === d)?.kind]?.weight ?? 0;
  const selectedDays = form.relaxationDates.reduce((t, d) => t + weightOf(d), 0);

  const toggleDate = (d) =>
    setForm((f) => {
      const has = f.relaxationDates.includes(d);
      const next = has
        ? f.relaxationDates.filter((x) => x !== d)
        : [...f.relaxationDates, d].sort();
      if (submitted) setFieldErrors(validate({ ...f, relaxationDates: next }));
      return { ...f, relaxationDates: next };
    });

  useEffect(() => {
    const onKey = (e) => e.key === "Escape" && !saving && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, saving]);

  /* One validator for the whole form, used both to gate submit and to
     re-check a field as it's edited — so the two can never disagree. */
  const validate = (f) => {
    const errs = {};
    if (!String(f.resourceId || "").trim()) {
      errs.resourceId = "This employee has no resource ID, so a relaxation can't be filed.";
    }
    if (!String(f.projectId || "").trim()) {
      errs.projectId = "This page has no project ID, so a relaxation can't be filed.";
    }
    if (parseYear(f.year) === null) {
      errs.year = `Enter a year between ${MIN_YEAR} and ${MAX_YEAR}.`;
    }
    if (parseQuarter(f.quarter) === null) errs.quarter = "Choose a quarter from 1 to 4.";
    if (!f.relaxationDates.length) {
      errs.relaxationDates = eligibleOptions.length
        ? "Choose at least one unpaid leave date to relax."
        : "No unpaid leave dates are eligible for relaxation this quarter.";
    }
    if (String(f.remarks || "").length > MAX_REMARKS) {
      errs.remarks = `Remarks are limited to ${MAX_REMARKS} characters.`;
    }
    return errs;
  };

  const set = (patch) => {
    setForm((f) => {
      const next = { ...f, ...patch };
      // Only re-validate once the user has tried to submit — flagging fields
      // they haven't reached yet reads as nagging.
      if (submitted) setFieldErrors(validate(next));
      return next;
    });
    if (error) setError(null);
  };

  /* Rejecting a bad file here rather than at submit keeps the attachment
     out of the main error line — the request is still perfectly valid
     without it, so an oversized image shouldn't read like a blocked form. */
  const pickFile = (f) => {
    if (!f) return;
    if (!ACCEPTED_IMAGE.test(f.type)) {
      setFileError("That file isn't an image. Choose a PNG, JPG, WEBP or GIF.");
      return;
    }
    if (!f.size) {
      setFileError("That file is empty. Choose an image with content.");
      return;
    }
    if (f.size > MAX_ATTACHMENT_BYTES) {
      setFileError(`That image is ${fmtBytes(f.size)} — the limit is 5 MB.`);
      return;
    }
    setFileError(null);
    setAttachment(f);
  };

  // True when the form points at a different period than the page is showing.
  const periodChanged =
    String(form.year) !== String(year) || Number(form.quarter) !== Number(quarter);

  const submit = async () => {
    if (saving) return;                       // guards a double-click / Enter twice
    setError(null);
    setSubmitted(true);

    const errs = validate(form);
    setFieldErrors(errs);
    const firstBad = Object.keys(errs)[0];
    if (firstBad) {
      // Take the user to the offending field rather than making them hunt.
      document.getElementById(`relax-${firstBad}`)?.focus();
      return;
    }

    try {
      setSaving(true);
      const token = getToken();
      const qs = new URLSearchParams({
        resourceId: String(form.resourceId).trim(),
        projectId: String(form.projectId).trim(),
        year: String(parseYear(form.year)),
        quarter: String(parseQuarter(form.quarter)),
        /* Comma-separated rather than a repeated key. Spring binds a
           comma-joined value to either `List<LocalDate>` or a plain `String`
           param; a repeated key only binds to the List form, so this is the
           shape that works against both. */
        relaxationDates: form.relaxationDates.join(","),
      });
      if (form.remarks.trim()) qs.set("remarks", form.remarks.trim().slice(0, MAX_REMARKS));

      // Always multipart — see the note above ACCEPTED_IMAGE. Content-Type is
      // deliberately unset so the browser writes it with the part boundary.
      const body = new FormData();
      if (attachment) body.append("attachment", attachment, attachment.name);

      const res = await fetch(`${API_BASE}/api/attendance/quarterly-relaxation?${qs}`, {
        method: "POST",
        headers: {
          accept: "*/*",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body,
      });
      const FALLBACK = "Couldn't submit the relaxation. Please try again.";
      if (!res.ok) throw new Error(await readErrorMessage(res, FALLBACK));
      // Show what the server actually reported when it reads like a sentence.
      setDoneMessage(await readSuccessMessage(res, "Relaxation submitted successfully."));
      setDone(true);
      onSuccess?.(); // refresh the parent's leave detail (and cost report) with the new figures
    } catch (err) {
      /* A failed action reports through the app's shared popup, matching the
         rest of the project. The inline line under the form is kept in step
         so the reason is still visible after the popup is dismissed. */
      const msg =
        requestErrorMessage(err, "Couldn't submit the relaxation. Please try again.") ||
        "Couldn't submit the relaxation. Please try again.";
      setError(msg);
      notifyActionError("Relaxation not submitted", msg);
    } finally {
      setSaving(false);
    }
  };

  return (
    /* Backdrop and ✕ are both inert while the request is in flight —
       dismissing mid-submit would orphan a write the user can't see. */
    <div
      className="ld-backdrop"
      onMouseDown={(e) => { if (e.target === e.currentTarget && !saving) onClose(); }}
    >
      <div className="ld-modal" role="dialog" aria-modal="true" aria-label="Quarterly Relaxation">
        <div className="ld-modal-head">
          <div>
            <div className="ld-eyebrow" style={{ marginBottom: 4 }}>Quarterly Relaxation</div>
            <h2 className="ld-modal-title">Add relaxation days</h2>
          </div>
          <button className="ld-close" onClick={onClose} disabled={saving} aria-label="Close">
            <FiX size={18} />
          </button>
        </div>

        {done ? (
          <>
            <div className="ld-success" role="status">✓ {doneMessage}</div>
            <div className="ld-modal-actions">
              <button className="ld-btn ld-btn--primary" onClick={onClose}>Done</button>
            </div>
          </>
        ) : (
          <>
            <div className="ld-form">
              <label className="ld-field">
                <span className="ld-field-lbl">Resource ID</span>
                <input id="relax-resourceId" className="ld-input" value={form.resourceId} disabled />
                {fieldErrors.resourceId && <span className="ld-field-err">{fieldErrors.resourceId}</span>}
                {fieldErrors.projectId && <span className="ld-field-err">{fieldErrors.projectId}</span>}
              </label>
              <label className="ld-field">
                <span className="ld-field-lbl">Year</span>
                {/* text + inputMode rather than type="number": a number input
                    reports "" for an unparseable entry like "20e5", so the
                    validator never sees what was actually typed. */}
                <input
                  id="relax-year"
                  type="text"
                  inputMode="numeric"
                  maxLength={4}
                  className={`ld-input${fieldErrors.year ? " is-bad" : ""}`}
                  value={form.year}
                  aria-invalid={!!fieldErrors.year}
                  onChange={(e) => set({ year: e.target.value.replace(/[^\d]/g, "") })}
                />
                {fieldErrors.year && <span className="ld-field-err">{fieldErrors.year}</span>}
              </label>
              <label className="ld-field">
                <span className="ld-field-lbl">Quarter</span>
                <select
                  id="relax-quarter"
                  className={`ld-input${fieldErrors.quarter ? " is-bad" : ""}`}
                  value={form.quarter}
                  onChange={(e) => set({ quarter: Number(e.target.value) })}
                >
                  {[1, 2, 3, 4].map((q) => <option key={q} value={q}>Q{q}</option>)}
                </select>
                {fieldErrors.quarter && <span className="ld-field-err">{fieldErrors.quarter}</span>}
              </label>
              {/* Checkboxes rather than a multiple <select>: a native
                  multi-select needs ctrl-click to pick a second date and gives
                  no room for each date's weight, which is the one thing this
                  list has to show. */}
              {/* tabIndex -1 so submit's "focus the first bad field" can reach
                  it — a plain div is not focusable, and the jump would
                  silently do nothing. */}
              <div className="ld-field ld-field--full" id="relax-relaxationDates" tabIndex={-1}>
                <span className="ld-field-lbl">
                  Unpaid Leave Dates
                  <Hint text="The unpaid days being waived. Each is worth a full or a half day, so two days of relaxation covers two full days, four half days, or any mix. Only dates still eligible this quarter are listed." />
                </span>

                {datesLoading ? (
                  <div className="ld-daylist-note">Loading eligible dates…</div>
                ) : eligibleOptions.length === 0 ? (
                  <div className="ld-daylist-note">
                    No unpaid leave dates are eligible for relaxation this quarter.
                  </div>
                ) : (
                  <>
                    <div
                      className={`ld-daylist${fieldErrors.relaxationDates ? " is-bad" : ""}`}
                      role="group"
                      aria-label="Eligible unpaid leave dates"
                    >
                      {eligibleOptions.map((o) => {
                        const kind = DAY_KINDS[o.kind];
                        const checked = form.relaxationDates.includes(o.date);
                        return (
                          <label
                            key={o.date}
                            className={`ld-day${checked ? " is-on" : ""}`}
                          >
                            <input
                              type="checkbox"
                              checked={checked}
                              onChange={() => { toggleDate(o.date); setError(null); }}
                            />
                            <span className="ld-day-date">{formatLeaveDate(o.date)}</span>
                            <span className={`ld-day-kind ld-day-kind--${o.kind}`}>
                              {kind.label} · {kind.short}
                            </span>
                          </label>
                        );
                      })}
                    </div>
                    {/* The running total. Without it the user is adding halves
                        and wholes in their head while clicking. */}
                    <div className="ld-daysum">
                      <strong>{dayCount(selectedDays)}</strong>
                      {selectedDays === 1 ? " day" : " days"} selected
                      <span className="ld-daysum-sub">
                        {form.relaxationDates.length} of {eligibleOptions.length} dates
                      </span>
                    </div>
                  </>
                )}
                {fieldErrors.relaxationDates && (
                  <span className="ld-field-err">{fieldErrors.relaxationDates}</span>
                )}
              </div>

              {/* Already granted this quarter — read-only, so the user can see
                  what's been waived before adding more. These dates are absent
                  from the list above, which would otherwise look like they had
                  simply gone missing. */}
              {approvedDates.length > 0 && (
                <div className="ld-field ld-field--full">
                  <span className="ld-field-lbl">
                    Already Relaxed
                    <Hint text="Relaxation already approved for this quarter. These dates are no longer selectable." />
                  </span>
                  <div className="ld-approved">
                    {approvedDates.map((d) => (
                      <span key={d} className="ld-approved-chip">{formatLeaveDate(d)}</span>
                    ))}
                    {approvedCost > 0 && (
                      <span className="ld-approved-cost" title={rupeesInWords(approvedCost)}>
                        {money(approvedCost)} waived
                      </span>
                    )}
                  </div>
                </div>
              )}
              <label className="ld-field ld-field--full">
                <span className="ld-field-lbl">
                  Remarks
                  <span className="ld-optional">Optional</span>
                  {/* Counter appears only as the limit approaches, so it isn't
                      clutter for the one-line reason that's typical. */}
                  {form.remarks.length > MAX_REMARKS - 100 && (
                    <span className={`ld-counter${form.remarks.length > MAX_REMARKS ? " is-bad" : ""}`}>
                      {form.remarks.length} / {MAX_REMARKS}
                    </span>
                  )}
                </span>
                <textarea
                  id="relax-remarks"
                  className={`ld-input${fieldErrors.remarks ? " is-bad" : ""}`}
                  rows={3}
                  maxLength={MAX_REMARKS}
                  value={form.remarks}
                  onChange={(e) => set({ remarks: e.target.value })}
                  placeholder="Reason for the relaxation…"
                  style={{ resize: "vertical", fontFamily: "inherit" }}
                />
                {fieldErrors.remarks && <span className="ld-field-err">{fieldErrors.remarks}</span>}
              </label>

              <AttachmentField
                file={attachment}
                onPick={pickFile}
                onClear={() => { setAttachment(null); setFileError(null); }}
                error={fileError}
                disabled={saving}
                replacing={hasDocument}
              />
            </div>

            {/* Year and quarter are editable, so they can be pointed at a
                period other than the one on screen. That's allowed, but it
                silently files the grant elsewhere — so it's called out. */}
            {periodChanged && (
              <div className="ld-warn" role="status">
                This will be filed against <strong>Q{form.quarter} {form.year}</strong>, not the
                Q{quarter} {year} shown on this page.
              </div>
            )}

            {error && <div className="ld-error" role="alert">{error}</div>}

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
.ld-page { padding: 30px 10px 72px; max-width: 1320px; width: 100%; min-width: 0; margin: 0 auto; color: ${C.ink}; box-sizing: border-box; overflow-x: clip; }
.ld-page * { box-sizing: border-box; }
@media (max-width: 640px) { .ld-page { padding: 18px 14px 40px; } }
.ld-page :focus-visible { outline: 2px solid ${C.primary}; outline-offset: 2px; border-radius: 6px; }

/* Section card — pairs with .uidai-pmis-card so it inherits the house
   navy→cyan top stripe. The house shadow is traded for a hairline: at four
   cards a page the drop shadows stacked up and read heavy. */
.ld-card { padding: 18px 20px; margin-bottom: 0; border: 1px solid ${C.border};
  box-shadow: 0 1px 2px rgba(16,32,60,.04); }

/* header */
.ld-head { display: flex; align-items: flex-start; justify-content: space-between;
  gap: 16px; margin-bottom: 26px; padding-bottom: 18px; border-bottom: 1px solid ${C.border};
  flex-wrap: wrap; }
.ld-head-main { min-width: 0; }
.ld-eyebrow { font-size: 11px; font-weight: 700; letter-spacing: .1em; text-transform: uppercase; color: ${C.muted}; margin-bottom: 7px; }
.ld-title { margin: 0 0 5px; letter-spacing: -.022em; }
/* Matches the Attendance table's .att-desig, so the same fact reads the same
   on both screens. */
.ld-desig { font-size: 13px; color: ${C.faint}; font-weight: 400;
  margin: -2px 0 5px; line-height: 1.35; }
.ld-subtitle { margin: 0; color: ${C.muted}; max-width: 640px; font-size: 13.5px; }
.ld-head-actions { display: flex; align-items: center; gap: 10px; }
.ld-close { display: grid; place-items: center; width: 36px; height: 36px; border-radius: 9px; border: 1px solid ${C.border}; background: #fff; color: ${C.muted}; cursor: pointer; transition: all .15s ease; }
.ld-close:hover { background: ${C.surface}; color: ${C.ink}; border-color: ${C.faint}; }

/* sections — the title is a quiet label with a rule running off it, so the
   eye goes to the figures rather than to the headings. */
.ld-section { margin-bottom: 28px; }
.ld-section-title { display: flex; align-items: center; gap: 8px; font-size: 11.5px;
  font-weight: 700; letter-spacing: .09em; text-transform: uppercase; color: ${C.muted};
  margin: 0 0 12px; }
.ld-section-title::after { content: ""; flex: 1; height: 1px; background: ${C.border}; }

/* employee info */
/* six fields — 3×2 keeps both rows full rather than orphaning the last one */
.ld-info { display: grid; grid-template-columns: repeat(3, 1fr); gap: 18px 24px; }
@media (max-width: 860px) { .ld-info { grid-template-columns: repeat(2, 1fr); } }
@media (max-width: 560px) { .ld-info { grid-template-columns: 1fr; } }
.ld-info-item { min-width: 0; }
.ld-info-ico { display: inline-grid; place-items: center; font-size: 12px; color: ${C.faint}; }
.ld-info-lbl { display: flex; align-items: center; gap: 6px; font-size: 10.5px; font-weight: 700;
  letter-spacing: .06em; text-transform: uppercase; color: ${C.muted}; margin-bottom: 4px; }
.ld-info-val { font-size: 14px; font-weight: 600; color: ${C.ink}; word-break: break-word; }

/* leave summary grid — eight tiles, so they run denser than the four-up
   metric row on Attendance while keeping the same card treatment. */
.ld-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px; }
@media (max-width: 980px) { .ld-grid { grid-template-columns: repeat(3, 1fr); } }
@media (max-width: 720px) { .ld-grid { grid-template-columns: repeat(2, 1fr); } }
@media (max-width: 460px) { .ld-grid { grid-template-columns: 1fr; } }
/* Figure tile — label above, number below. Reading order matches how the
   tile is scanned, and dropping the icon badge lets the number own the
   card instead of sharing it with a coloured square. */
.ld-stat { background: #fff; border: 1px solid ${C.border}; border-radius: 10px;
  padding: 13px 15px 14px; transition: border-color .15s ease; min-width: 0; }
.ld-stat:hover { border-color: ${C.faint}; }
.ld-stat-ico { display: inline-grid; place-items: center; font-size: 12px; color: ${C.faint}; flex: 0 0 auto; }
.ld-stat-lbl { display: flex; align-items: center; gap: 6px; font-size: 10.5px; font-weight: 700;
  letter-spacing: .06em; text-transform: uppercase; color: ${C.muted}; line-height: 1.3; }
/* Truncate rather than wrap to two lines — a ragged label pushes the number
   down and breaks the grid's baseline. */
.ld-stat-lbl-txt { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.ld-stat-val { font-size: 23px; font-weight: 700; color: ${C.ink}; line-height: 1.15;
  margin-top: 8px; letter-spacing: -.025em; font-variant-numeric: tabular-nums; word-break: break-word; }
/* The one place colour is spent in this grid: figures that cost money. */
.ld-stat--alert .ld-stat-val { color: ${C.red}; }
.ld-stat-sub { font-size: 11px; color: ${C.faint}; margin-top: 4px; }

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

/* ── leave summary ────────────────────────────────────────────────
   Donut + legend on one row; the eight-figure grid sits under them. */
.ld-glance { display: grid; grid-template-columns: auto minmax(200px, 1fr);
  gap: 20px 32px; align-items: center; }
@media (max-width: 560px) {
  .ld-glance { grid-template-columns: 1fr; justify-items: center; }
  .ld-legend { width: 100%; }
}
.ld-glance-chart { display: grid; place-items: center; }
.ld-donut { width: 160px; height: 160px; display: block; }
/* Proportional figures — tabular would make the centre number look loose
   at this size. */
.ld-donut-num { font-size: 32px; font-weight: 700; fill: ${C.ink}; letter-spacing: -.025em; }
.ld-donut-cap { font-size: 9px; font-weight: 700; fill: ${C.muted}; letter-spacing: .11em; }

.ld-legend { min-width: 0; width: 100%; }
/* Rows are separated by a hairline rather than sitting in tinted blocks —
   the whole legend then reads as one small table. */
.ld-legend-row { display: grid; grid-template-columns: 8px 1fr auto; align-items: center;
  gap: 11px; padding: 9px 2px; border-bottom: 1px solid ${C.divider};
  transition: background .15s ease; }
.ld-legend-row:last-of-type { border-bottom: none; }
.ld-legend-row.is-on { background: ${C.surface}; }
.ld-legend-row.is-zero { opacity: .45; }
.ld-legend-dot { width: 8px; height: 8px; border-radius: 2px; }
/* Text wears ink tokens, never the series colour — the dot carries identity. */
.ld-legend-lbl { display: flex; align-items: center; gap: 5px; font-size: 13px; font-weight: 500; color: ${C.ink}; }
.ld-legend-val { font-size: 15px; font-weight: 700; color: ${C.ink}; font-variant-numeric: tabular-nums; }
.ld-legend-note { font-size: 11.5px; color: ${C.muted}; line-height: 1.45; margin-top: 8px; }

@media (prefers-reduced-motion: reduce) {
  .ld-legend-row, .ld-donut circle { transition: none !important; }
}

/* leave dates */
.ld-dates { display: grid; grid-template-columns: 1fr 1fr; gap: 20px; }
@media (max-width: 640px) { .ld-dates { grid-template-columns: 1fr; } }
.ld-datehead { display: flex; align-items: center; gap: 8px; font-size: 11px; font-weight: 700;
  letter-spacing: .07em; text-transform: uppercase; color: ${C.muted};
  padding-bottom: 9px; margin-bottom: 12px; border-bottom: 1px solid ${C.divider}; }
.ld-datehead-dot { width: 8px; height: 8px; border-radius: 2px; flex: 0 0 8px; }
.ld-datenote { font-size: 12.5px; color: ${C.muted}; background: ${C.surface}; border: 1px solid ${C.border};
  border-radius: 8px; padding: 7px 10px; margin-bottom: 10px; line-height: 1.45; }
.ld-datechips { display: flex; flex-wrap: wrap; gap: 6px; }
/* A hairline plus the faintest tint of the segment's hue. The tint alone,
   at full chip weight, turned twenty dates into a block of colour; the
   border does the containing so the wash can stay almost white. */
.ld-datechip { font-size: 12.5px; font-weight: 500; padding: 5px 10px; border-radius: 6px;
  border: 1px solid ${C.border}; font-variant-numeric: tabular-nums; }
/* Half day — the chip form of the calendar's half-height band: the category
   colour underlines the left half of the chip. Half the width rather than
   half the height, because a chip is too short to band horizontally and
   still leave the date legible. */
.ld-datechip { position: relative; overflow: hidden; }
.ld-datechip.is-half::before { content: ""; position: absolute; left: 0; bottom: 0;
  width: 50%; height: 3px; background: var(--chip-band, ${C.muted}); }
.ld-datehead-sub { margin-left: auto; font-size: 10px; font-weight: 600;
  letter-spacing: 0; text-transform: none; color: ${C.faint}; }

/* ═══ TEMPORARY — styles for the three candidate layouts ═══ */

/* switcher (scaffolding) */
.ld-switch { display: inline-flex; gap: 2px; padding: 2px; margin-left: 4px;
  background: ${C.surface}; border: 1px solid ${C.border}; border-radius: 8px; }
.ld-switch-btn { border: none; background: transparent; font-family: inherit;
  font-size: 10.5px; font-weight: 700; letter-spacing: .04em; color: ${C.muted};
  padding: 5px 9px; border-radius: 6px; cursor: pointer; white-space: nowrap;
  text-transform: none; transition: background .15s, color .15s; }
.ld-switch-btn:hover { color: ${C.ink}; }
.ld-switch-btn.is-on { background: #fff; color: ${C.primary};
  box-shadow: 0 1px 2px rgba(16,32,60,.10); }

/* A — quarter calendar */
.ld-cal-wrap { display: grid; grid-template-columns: repeat(3, 1fr); gap: 26px; }
@media (max-width: 860px) { .ld-cal-wrap { grid-template-columns: repeat(2, 1fr); } }
@media (max-width: 560px) { .ld-cal-wrap { grid-template-columns: 1fr; } }
.ld-cal-title { font-size: 11px; font-weight: 700; letter-spacing: .07em;
  text-transform: uppercase; color: ${C.muted}; margin-bottom: 10px; }
.ld-cal-dow, .ld-cal-grid { display: grid; grid-template-columns: repeat(7, 1fr); gap: 3px; }
.ld-cal-dow span { text-align: center; font-size: 9.5px; font-weight: 700;
  color: ${C.faint}; padding-bottom: 5px; }
.ld-cal-cell { position: relative; display: grid; place-items: center; aspect-ratio: 1;
  border-radius: 6px; font-size: 12px; font-variant-numeric: tabular-nums; color: ${C.ink}; }
.ld-cal-cell.is-blank { visibility: hidden; }
.ld-cal-cell.is-weekend { color: ${C.faint}; background: ${C.surface}; }
/* One red for every leave day, paid or unpaid. The calendar's job is "which
   days were taken"; whether a day was paid is a payroll question the donut,
   the chip lists and each cell's own tooltip still answer. Two hues here made
   the grid read as two kinds of event when it only ever showed one. */
.ld-cal-cell.is-paid,
.ld-cal-cell.is-unpaid { background: #e34948; color: #fff; font-weight: 700; }
/* Sandwich — a non-working day charged as leave. Hatched rather than given a
   fourth hue: the stripes read as "weekend, but counted", and a pattern still
   separates from paid/unpaid for anyone who can't tell the hues apart. */
.ld-cal-cell.is-sandwich { font-weight: 700; color: #6b5426;
  background: repeating-linear-gradient(135deg, #f3e6cd 0 4px, ${C.surface} 4px 8px); }
/* Half day — the cell is literally half filled: pale tint overall with the
   category's colour banding the bottom half. The split is horizontal rather
   than diagonal so the digit sits wholly on the light part and keeps full
   contrast (~15:1); a diagonal put it across both tones and forced the
   number down to ~3.5:1. The tooltip carries the wording. */
.ld-cal-cell.is-half {
  background: linear-gradient(to bottom, var(--half-rest) 0 50%, var(--half-fill) 50% 100%);
  align-content: start;
  padding-top: 2px;
}
.ld-cal-cell.is-half.is-paid,
.ld-cal-cell.is-half.is-unpaid { --half-fill: #e34948; --half-rest: #fdeaea; color: ${C.ink}; }
/* Bucket unrecoverable — marked, but in the neutral tone, so the day is
   never lost while the colour still doesn't claim a category. */
.ld-cal-cell.is-half.is-halfonly { --half-fill: #6b7a90; --half-rest: #eef2f7; color: ${C.ink}; }
.ld-cal-legend { display: flex; flex-wrap: wrap; gap: 18px; margin-top: 20px;
  padding-top: 14px; border-top: 1px solid ${C.divider};
  font-size: 12px; color: ${C.muted}; }
.ld-cal-legend span { display: inline-flex; align-items: center; gap: 7px; }
.ld-cal-key { width: 11px; height: 11px; border-radius: 3px; display: inline-block; }
.ld-cal-key.is-leave { background: #e34948; }
.ld-cal-key.is-weekend { background: ${C.surface}; border: 1px solid ${C.border}; }
.ld-cal-key.is-sandwich { background: repeating-linear-gradient(135deg, #f3e6cd 0 3px, ${C.surface} 3px 6px);
  border: 1px solid ${C.border}; }
/* Mirrors the cell's half-height band, in neutral tones so the key reads as
   "this shape means half" rather than as a fourth category. */
.ld-cal-key.is-halfkey { background: linear-gradient(to bottom, #e8edf5 0 50%, #6b7a90 50% 100%);
  border: 1px solid ${C.border}; }

/* B — collapsible */
.ld-fold { display: flex; align-items: center; gap: 10px; width: 100%;
  background: none; border: none; font-family: inherit; cursor: pointer;
  padding: 16px 20px; font-size: 13.5px; font-weight: 600; color: ${C.ink}; text-align: left; }
.ld-fold:hover { background: ${C.surface}; }
.ld-fold-chev { color: ${C.faint}; font-size: 11px; width: 10px; }
.ld-fold-count { margin-left: auto; font-size: 11px; font-weight: 700; letter-spacing: .05em;
  text-transform: uppercase; color: ${C.muted}; }

/* C — side drawer */
.ld-drawer-teaser { display: flex; align-items: center; justify-content: space-between; gap: 16px; flex-wrap: wrap; }
.ld-drawer-teaser-num { font-size: 26px; font-weight: 700; color: ${C.ink}; letter-spacing: -.025em; line-height: 1.1; }
.ld-drawer-teaser-cap { font-size: 12.5px; color: ${C.muted}; margin-top: 2px; }
.ld-scrim { position: fixed; inset: 0; background: rgba(15,23,42,.42);
  display: flex; justify-content: flex-end; z-index: 1000; }
.ld-drawer { width: min(430px, 100%); height: 100%; background: #fff;
  display: flex; flex-direction: column; box-shadow: -18px 0 48px rgba(11,23,42,.18); }
.ld-drawer-head { display: flex; align-items: center; justify-content: space-between;
  gap: 16px; padding: 20px 22px; border-bottom: 1px solid ${C.border}; }
.ld-drawer-title { margin: 0; font-size: 17px; font-weight: 700; color: ${C.ink}; }
.ld-drawer-body { padding: 20px 22px; overflow-y: auto; flex: 1; }

/* cost report */

/* ── cost chain ───────────────────────────────────────────────────────
   Planned − Deducted [+ Relaxation] = Billable, read left to right. The
   operators are real glyphs at full size: shrinking them to punctuation
   loses the only cue that says these figures are one calculation and not
   four unrelated cards. */
.ld-chain { border: 1px solid ${C.border}; padding: 18px 20px; margin-bottom: 18px; }
.ld-chain-row { display: flex; align-items: flex-end; flex-wrap: wrap; gap: 8px 14px; }
.ld-chain-op { font-size: 19px; font-weight: 400; color: ${C.faint}; line-height: 30px; }
.ld-chain-term { min-width: 0; }
.ld-chain-lbl { font-size: 10.5px; font-weight: 700; letter-spacing: .07em;
  text-transform: uppercase; color: ${C.muted}; margin-bottom: 3px; white-space: nowrap; }
/* Proportional figures, not tabular — these are standalone display numbers,
   and equal-width digits make them look loose at this size. */
.ld-chain-val { font-size: 19px; font-weight: 600; color: ${C.ink}; line-height: 1.15; white-space: nowrap; }
.ld-chain-term.is-total .ld-chain-val { color: ${C.primary}; font-weight: 700; }
@media (max-width: 560px) {
  .ld-chain-row { gap: 6px 10px; }
  .ld-chain-val { font-size: 16px; }
  .ld-chain-op { font-size: 16px; line-height: 26px; }
}

/* Meter, not a two-slice pie — one ratio against a limit. The track is a
   lighter step of the fill's own hue (ΔE 49 apart, checked, not eyeballed)
   so the full bar reads as the plan. Square at the baseline, 4px rounded at
   the data end, per the mark spec. */
.ld-chain-meter { position: relative; height: 8px; margin: 16px 0 0; border-radius: 999px;
  background: #c2d2ec; overflow: hidden; }
.ld-chain-meter-fill { height: 100%; background: ${C.primary}; border-radius: 0 4px 4px 0; }
.ld-chain-meter-cap { margin-top: 7px; font-size: 12px; color: ${C.muted}; }

/* The working starts closed: it's what a disputed figure needs and nothing
   a satisfied reader wants. */
.ld-chain-working { margin-top: 14px; border-top: 1px solid ${C.divider}; padding-top: 12px; }
.ld-chain-working summary { cursor: pointer; font-size: 12.5px; font-weight: 600;
  color: ${C.primary}; list-style: none; display: inline-flex; align-items: center; gap: 6px; }
.ld-chain-working summary::-webkit-details-marker { display: none; }
.ld-chain-working summary::before { content: "▸"; font-size: 10px; color: ${C.faint}; transition: transform .15s ease; }
.ld-chain-working[open] summary::before { transform: rotate(90deg); }
.ld-chain-working p { margin: 10px 0 0; font-size: 13px; line-height: 1.65; color: ${C.ink}; }
.ld-chain-working strong { font-weight: 700; }
.ld-chain-working-note { color: ${C.muted}; font-size: 12.5px; }

/* Outer card carries the house top stripe; the inner div does the scrolling,
   so the stripe stays put when the table is scrolled sideways. */
.ld-costtable-card { border: 1px solid ${C.border}; padding: 0; margin-bottom: 0; overflow: hidden; }
.ld-costtable-wrap { overflow: auto; border-radius: 0 0 12px 12px; }
.ld-costtable { width: 100%; border-collapse: collapse; font-size: 13.5px; min-width: 720px; }
/* Header sits on white with a rule under it rather than a filled band —
   at ten columns a grey strip dominated the card. */
.ld-costtable thead th { text-align: left; font-size: 10.5px; font-weight: 700; letter-spacing: .07em; text-transform: uppercase; color: ${C.muted}; background: #fff; padding: 13px 14px 11px; border-bottom: 1px solid ${C.borderStrong}; white-space: nowrap; }
.ld-costtable tbody td { padding: 12px 14px; border-bottom: 1px solid ${C.divider}; color: ${C.ink}; white-space: nowrap; font-size: 13.5px; }
.ld-costtable tbody tr:last-child td { border-bottom: none; }
.ld-costtable tbody tr:hover { background: ${C.surface}; }
.ld-costtable .ld-num { text-align: right; font-variant-numeric: tabular-nums; }
/* Group band — a hairline rule under each label rather than a filled strip,
   so it separates the two halves without adding a second heavy header. */
.ld-costtable-grouprow th { padding: 12px 14px 5px; border-bottom: none; background: #fff; }
.ld-costtable-group { text-align: left; font-size: 10px; font-weight: 700; letter-spacing: .08em;
  text-transform: uppercase; color: ${C.faint}; }
.ld-costtable-group::after { content: ""; display: block; height: 2px; margin-top: 5px;
  border-radius: 2px; background: ${C.borderStrong}; }
.ld-costtable-group--cost::after { background: ${C.primary}; opacity: .35; }
.ld-costtable-period { font-weight: 600; }
/* The band dates qualify the Period beside them rather than standing on their
   own, so they sit a step back from it in weight. */
.ld-costtable-band { color: ${C.muted}; font-variant-numeric: tabular-nums; }
/* Calendar days is the denominator behind Per Day Rate, not a headline of
   its own — present so the division is checkable, recessive so it doesn't
   compete with the money columns beside it. */
.ld-costtable .ld-dim { color: ${C.muted}; }
/* Only the money column that the total keys off is accented. */
.ld-costtable-cost { font-weight: 700; color: ${C.primary}; }
.ld-costtable tfoot td { padding: 14px; border-top: 1px solid ${C.border}; background: ${C.surface}; }
.ld-costtable-totallbl { text-align: right; font-weight: 700; color: ${C.muted}; text-transform: uppercase; font-size: 10.5px; letter-spacing: .07em; }
/* The two working rows that lead into the total — lighter and tighter than
   the total itself, so the sum still reads as the row that concludes. */
.ld-costtable-subrow td { padding: 9px 14px; border-top: 1px solid ${C.divider}; background: #fff; }
.ld-costtable-subrow .ld-num { font-weight: 600; color: ${C.ink}; }
.ld-costtable-sublbl { margin-left: 8px; font-weight: 600; font-size: 10px;
  text-transform: none; letter-spacing: 0; color: ${C.faint}; }
.ld-attpill { display: inline-block; font-size: 12px; font-weight: 600; padding: 3px 9px; border-radius: 6px; }

.ld-muted { color: ${C.muted}; font-size: 14px; padding: 8px 0; }
.ld-error { display: flex; align-items: center; gap: 8px; background: #fdecec; border: 1px solid #f5c9c9; color: ${C.red}; border-radius: 10px; padding: 10px 14px; font-size: 13.5px; margin: 8px 0; }

/* buttons */
.ld-btn { display: inline-flex; align-items: center; justify-content: center; border-radius: 10px; font-size: 14px; font-weight: 600; padding: 10px 22px; cursor: pointer; border: 1px solid ${C.border}; transition: all .15s ease; }
.ld-btn:disabled { opacity: .55; cursor: not-allowed; }
.ld-btn--ghost { background: #fff; color: ${C.ink}; }
.ld-btn--ghost:hover:not(:disabled) { border-color: ${C.primary}; color: ${C.primary}; }
/* Flat brand fill. The two-stop gradient it replaced read as decoration and
   fought the one accent colour the rest of the page now uses. */
.ld-btn--primary { border: 1px solid ${C.primary}; color: #fff; background: ${C.primary}; }
.ld-btn--primary:hover:not(:disabled) { background: ${C.primaryDark}; border-color: ${C.primaryDark}; }

/* ── relaxation date picker ────────────────────────────────────────────
   A scrolling checkbox list. Capped in height so a quarter with a dozen
   unpaid days doesn't push Remarks and the attachment off screen. */
.ld-daylist { display: grid; gap: 4px; max-height: 190px; overflow-y: auto;
  padding: 6px; border: 1px solid ${C.borderStrong}; border-radius: 10px;
  background: #fff; }
.ld-daylist.is-bad { border-color: ${C.red}; }
.ld-daylist-note { font-size: 13px; color: ${C.muted}; padding: 10px 2px; }
.ld-day { display: flex; align-items: center; gap: 10px; padding: 7px 9px;
  border-radius: 8px; cursor: pointer; font-size: 13.5px; transition: background .13s ease; }
.ld-day:hover { background: ${C.surface}; }
.ld-day.is-on { background: ${C.accentBg}; }
.ld-day input { width: 15px; height: 15px; accent-color: ${C.primary};
  cursor: pointer; flex-shrink: 0; margin: 0; }
.ld-day-date { font-weight: 600; color: ${C.ink}; font-variant-numeric: tabular-nums; }
/* The weight, which is the reason this list exists rather than a plain
   dropdown — half and full are told apart by tone as well as by the word. */
.ld-day-kind { margin-left: auto; font-size: 10.5px; font-weight: 700;
  letter-spacing: .04em; text-transform: uppercase; padding: 2px 8px;
  border-radius: 999px; white-space: nowrap; }
.ld-day-kind--full { background: #eef2f7; color: ${C.muted}; }
.ld-day-kind--half { background: #fdf4e3; color: #a4650a; }
.ld-day-kind--sandwich { background: #f8f3ea; color: #8a6d3b; }

/* Running total — the figure the picker is steering towards. */
.ld-daysum { display: flex; align-items: baseline; gap: 8px; margin-top: 8px;
  font-size: 13px; color: ${C.ink}; }
.ld-daysum strong { font-size: 16px; font-weight: 700; color: ${C.primary}; }
.ld-daysum-sub { margin-left: auto; font-size: 12px; color: ${C.muted}; }

/* Already-approved dates — read-only context, so lighter than the pickable
   list above and never mistakable for it. */
.ld-approved { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; }
.ld-approved-chip { font-size: 12px; font-weight: 600; padding: 3px 10px;
  border-radius: 999px; background: #e9f9ef; color: #197a45;
  font-variant-numeric: tabular-nums; }
.ld-approved-cost { font-size: 12px; color: ${C.muted}; margin-left: 2px; }

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
.ld-optional { font-size: 10px; font-weight: 700; letter-spacing: .06em; text-transform: uppercase;
  color: ${C.faint}; border: 1px solid ${C.border}; border-radius: 5px; padding: 1px 5px; }
.ld-field-err { font-size: 12px; color: ${C.red}; }
/* Invalid field — a red edge plus the message below it, so the error is
   findable by colour and readable without it. */
.ld-input.is-bad { border-color: ${C.red}; }
.ld-input.is-bad:focus { border-color: ${C.red}; box-shadow: 0 0 0 3px rgba(214,69,69,.14); }
.ld-counter { margin-left: auto; font-size: 10.5px; font-weight: 600; color: ${C.faint}; }
.ld-counter.is-bad { color: ${C.red}; }
/* A caution, not a failure — the action is still allowed to proceed. */
.ld-warn { display: flex; align-items: center; gap: 8px; font-size: 12.5px; line-height: 1.5;
  background: #fff8ec; border: 1px solid #f0dcb8; color: #8a5a00;
  border-radius: 10px; padding: 10px 13px; margin-bottom: 12px; }
.ld-warn strong { color: #6d4700; }
/* Inline recovery action inside an error banner. */
.ld-error-act { margin-left: 10px; font: inherit; font-size: 12.5px; font-weight: 700;
  color: ${C.red}; background: none; border: none; padding: 0; cursor: pointer;
  text-decoration: underline; }
.ld-field-note { font-size: 12px; color: ${C.muted}; }

/* optional image attachment — drop zone, then the picked file */
.ld-drop { position: relative; display: flex; flex-direction: column; align-items: center; gap: 3px;
  padding: 20px 16px; border: 1.5px dashed ${C.borderStrong}; border-radius: 10px;
  background: ${C.surface}; cursor: pointer; text-align: center;
  transition: border-color .15s ease, background .15s ease; }
.ld-drop:hover { border-color: ${C.primary}; background: ${C.accentBg}; }
.ld-drop.is-over { border-color: ${C.primary}; background: ${C.accentBg}; border-style: solid; }
.ld-drop.is-bad { border-color: ${C.red}; }
.ld-drop:focus-within { border-color: ${C.primary}; box-shadow: 0 0 0 3px ${C.accentBg}; }
.ld-drop-input { position: absolute; inset: 0; width: 100%; height: 100%; opacity: 0; cursor: pointer; }
.ld-drop-ico { font-size: 21px; color: ${C.primary}; margin-bottom: 3px; }
.ld-drop-main { font-size: 13px; font-weight: 600; color: ${C.primary}; }
.ld-drop-or { color: ${C.muted}; font-weight: 500; }
.ld-drop-sub { font-size: 11.5px; color: ${C.faint}; }
@media (max-width: 480px) { .ld-drop-or { display: none; } }

.ld-file { display: flex; align-items: center; gap: 12px; padding: 10px 12px;
  border: 1px solid ${C.border}; border-radius: 10px; background: #fff; }
.ld-file-thumb { width: 44px; height: 44px; flex: 0 0 44px; border-radius: 8px;
  object-fit: cover; background: ${C.surface}; border: 1px solid ${C.border}; }
.ld-file-meta { min-width: 0; flex: 1; }
.ld-file-name { font-size: 13px; font-weight: 600; color: ${C.ink};
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.ld-file-size { font-size: 11.5px; color: ${C.faint}; margin-top: 2px; }
.ld-file-x { display: grid; place-items: center; width: 28px; height: 28px; flex: 0 0 28px;
  border-radius: 7px; border: 1px solid ${C.border}; background: #fff; color: ${C.muted};
  cursor: pointer; transition: all .15s ease; }
.ld-file-x:hover:not(:disabled) { background: #fdecec; border-color: ${C.red}; color: ${C.red}; }
.ld-file-x:disabled { opacity: .5; cursor: not-allowed; }

/* the filed document, under the leave summary */
.ld-doc { display: flex; align-items: center; gap: 14px; margin-top: 12px; padding: 12px 14px;
  background: #fff; border: 1px solid ${C.border}; border-radius: 10px; }
.ld-doc-thumbbtn { padding: 0; border: 0; background: none; cursor: zoom-in; line-height: 0; border-radius: 8px; }
.ld-doc-thumb { width: 52px; height: 52px; flex: 0 0 52px; border-radius: 8px; object-fit: cover;
  background: ${C.surface}; border: 1px solid ${C.border}; transition: border-color .15s ease; }
.ld-doc-thumbbtn:hover .ld-doc-thumb { border-color: ${C.primary}; }
.ld-doc-thumb--generic { display: grid; place-items: center; font-size: 20px; color: ${C.faint}; }
.ld-doc-meta { min-width: 0; flex: 1; }
.ld-doc-lbl { display: flex; align-items: center; gap: 6px; font-size: 10.5px; font-weight: 700;
  letter-spacing: .06em; text-transform: uppercase; color: ${C.muted}; margin-bottom: 4px; }
.ld-doc-name { font-size: 13.5px; font-weight: 600; color: ${C.ink};
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.ld-doc-size { font-size: 11.5px; color: ${C.faint}; margin-top: 2px; }
.ld-doc-actions { display: flex; align-items: center; gap: 8px; flex: 0 0 auto; }
.ld-doc-actions .ld-btn { display: inline-flex; align-items: center; gap: 6px; text-decoration: none;
  padding: 8px 14px; font-size: 13px; }
@media (max-width: 560px) {
  .ld-doc { flex-wrap: wrap; }
  .ld-doc-actions { width: 100%; justify-content: flex-end; }
}

/* full-size view of the document */
.ld-lightbox { display: flex; flex-direction: column; gap: 12px; max-width: min(900px, 94vw); }
.ld-lightbox-head { display: flex; align-items: center; gap: 10px; }
.ld-lightbox-name { flex: 1; min-width: 0; color: #fff; font-size: 13px; font-weight: 600;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.ld-lightbox-img { display: block; max-width: 100%; max-height: 78vh; object-fit: contain;
  border-radius: 12px; background: #fff; box-shadow: 0 18px 50px rgba(11,23,42,.4); }
.ld-success { display: flex; align-items: center; gap: 8px; color: ${C.green}; font-weight: 600; background: #e7f6ee; border: 1px solid #c7ead6; border-radius: 10px; padding: 12px 14px; margin-bottom: 14px; }
.ld-modal-actions { display: flex; justify-content: flex-end; gap: 10px; }
`;