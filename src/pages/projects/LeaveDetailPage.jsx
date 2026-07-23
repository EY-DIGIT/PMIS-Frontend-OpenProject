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
  FiPlay, FiFlag, FiLayers, FiDollarSign, FiInfo, FiUmbrella,
  FiShield, FiCreditCard, FiPieChart, FiClock, FiUploadCloud, FiDownload,
} from "react-icons/fi";
import { useProject } from "../../store/project/projectsStore";
import { setPageContext, clearPageContext } from "../../utils/pageContext";
import { getToken } from "../../api/auth";
import { ENDPOINTS } from "../../api/endpoint";
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
// with the employee details rather than in the metric grid.
const CONTEXT_CARDS = [
  { key: "quarterStart", label: "Quarter Start", tone: "purple", icon: <FiPlay /> },
  { key: "quarterEnd", label: "Quarter End", tone: "orange", icon: <FiFlag /> },
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

/* ── per-month leave, derived from the cost report ────────────────────
   The monthly breakdown carries no "total leave" field, but it carries the
   parts, and they reconcile exactly:

     effectivePaidDays = presentDays + paidLeaveDaysApplied + relaxationDaysApplied
     unpaid            = workingDays − effectivePaidDays
     deductedAmount    = unpaid × perDayRate

   Verified against a live Q3-2026 payload: July's 0.5 unpaid day × ₹4385.83
   is exactly its ₹2192.91 deduction, and the same holds for the other two
   months. So `unpaid` here is not an estimate — it is the very figure the
   deduction is charged on. */
function monthLeave(m) {
  const paid = num(m.paidLeaveDaysApplied);
  const unpaid = Math.max(0, num(m.workingDays) - num(m.effectivePaidDays));
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

function useRelaxationAttachment({ resourceId, projectId, year, quarter, refreshKey }) {
  const [file, setFile] = useState(null);

  useEffect(() => {
    if (!resourceId || !projectId || !year || !quarter) return undefined;
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
  }, [resourceId, projectId, year, quarter, refreshKey]);

  return file;
}

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
        const { report, totals } = unwrapCostReport(json, resourceId);
        if (active) {
          setCostReport(report || {});
          setCostTotals(totals);
        }
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

  // The image filed with the relaxation request, if one was ever uploaded.
  // Re-fetched after a submit so a freshly attached document appears at once.
  const relaxDoc = useRelaxationAttachment({
    resourceId,
    projectId: d.projectId || projectId,
    year: d.year || year,
    quarter: d.quarter || quarter,
    refreshKey,
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
          <p className="uidai-pmis-subtitle ld-subtitle">
            Quarterly leave detail · Attendance ID {show(d.attendanceId || attendanceId)}
            {" · "}Q{show(d.quarter || quarter)} {show(d.year || year)}
          </p>
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
      </header>

      {loading && <div className="ld-muted">Loading leave detail…</div>}
      {error && <div className="ld-error">⚠️ {error}</div>}

      {!loading && !error && (
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
                  sub={
                    c.key === "relaxationLeave" && relaxCap > 0
                      ? `${relaxUsed} of ${relaxCap} used · ${relaxLeft} left`
                      : null
                  }
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
          maxDays={relaxCap > 0 ? relaxLeft : null}
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

function DateList({ color, chipBg, title, dates, note }) {
  return (
    <div className="ld-datecol">
      {/* The swatch is the exact donut-segment colour, so the tie between
          this list and that slice is visual rather than explained. */}
      <div className="ld-datehead">
        <span className="ld-datehead-dot" style={{ background: color }} />
        {title} · {dates.length} {dates.length === 1 ? "day" : "days"}
      </div>
      {note && <div className="ld-datenote">{note}</div>}
      {dates.length ? (
        <div className="ld-datechips">
          {dates.map((dt, i) => (
            <span key={i} className="ld-datechip" style={{ background: chipBg, color: C.ink }}>{dt}</span>
          ))}
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

function MonthGrid({ year, month, paidSet, unpaidSet }) {
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
          // Monday-first grid: indexes 5 and 6 of each week are Sat/Sun.
          const weekend = i % 7 >= 5;
          const cls = paid ? " is-paid" : unpaid ? " is-unpaid" : weekend ? " is-weekend" : "";
          const title = paid ? `${key} · Paid Leave` : unpaid ? `${key} · Unpaid Leave` : key;
          return (
            <span key={i} className={`ld-cal-cell${cls}`} title={title}>{day}</span>
          );
        })}
      </div>
    </div>
  );
}

/* Candidate A — quarter calendar. The only view where a weekend caught
   between two unpaid days is visible, which is what sandwich leave is. */
function QuarterCalendar({ year, quarter, paidDates, unpaidDates }) {
  const q = Number(quarter) || 1;
  const yr = Number(year) || new Date().getFullYear();
  const paidSet = new Set(paidDates.map(dateKey).filter(Boolean));
  const unpaidSet = new Set(unpaidDates.map(dateKey).filter(Boolean));
  const months = [0, 1, 2].map((i) => (q - 1) * 3 + 1 + i);

  const matched = paidSet.size + unpaidSet.size;
  const total = paidDates.length + unpaidDates.length;

  return (
    <>
      <div className="ld-cal-wrap">
        {months.map((m) => (
          <MonthGrid key={m} year={yr} month={m} paidSet={paidSet} unpaidSet={unpaidSet} />
        ))}
      </div>
      <div className="ld-cal-legend">
        <span><i className="ld-cal-key is-paid" /> Paid Leave</span>
        <span><i className="ld-cal-key is-unpaid" /> Unpaid Leave</span>
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
function DateChipLists({ paidDates, unpaidDates, note }) {
  return (
    <div className="ld-dates">
      <DateList color="#2a78d6" chipBg="#eaf2fd" title="Paid Leave Dates" dates={paidDates} />
      <DateList color="#e34948" chipBg="#fdecec" title="Unpaid Leave Dates" dates={unpaidDates} note={note} />
    </div>
  );
}

/* Hosts all three so they can be compared. The switcher is scaffolding —
   it goes when one is picked. */
function LeaveDatesSection({ paidDates, unpaidDates, note, year, quarter }) {
  const [view, setView] = useState("calendar");
  const [open, setOpen] = useState(true);
  const [drawer, setDrawer] = useState(false);

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
              {paidDates.length + unpaidDates.length} dates
            </span>
          </button>
          {open && (
            <div style={{ padding: "0 20px 18px" }}>
              <DateChipLists paidDates={paidDates} unpaidDates={unpaidDates} note={note} />
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
                  {paidDates.length + unpaidDates.length}
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
                  <DateList color="#2a78d6" chipBg="#eaf2fd" title="Paid Leave Dates" dates={paidDates} />
                  <div style={{ height: 22 }} />
                  <DateList color="#e34948" chipBg="#fdecec" title="Unpaid Leave Dates" dates={unpaidDates} note={note} />
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

function CostReportSection({ loading, error, report, totals }) {
  if (loading) return <div className="ld-muted">Loading cost report…</div>;
  if (error) return <div className="ld-error">⚠️ {error}</div>;
  if (!report || typeof report !== "object" || Object.keys(report).length === 0) {
    return <div className="ld-muted">No cost data available.</div>;
  }

  const months = Array.isArray(report.monthlyBreakdown) ? report.monthlyBreakdown : [];
  const extraEntries = Object.entries(report).filter(([k]) => !COST_KNOWN_KEYS.has(k));

  /* Relaxation is GRANTED per quarter but APPLIED per month —
     relaxationDaysApplied is 1.0 in July and 0.0 in Aug/Sep of the live
     payload, i.e. real per-month values rather than one figure stamped
     across the rows. The quarter's total is therefore the sum, not the max.
     It is summarised here rather than kept as a column because the grant it
     draws on is a quarterly one. */
  const relaxationApplied = months.reduce((t, m) => t + num(m.relaxationDaysApplied), 0);

  /* The envelope's totals carry the quarter's deduction; without one (older
     payload shape) the months add up to the same figure. */
  const totalDeducted =
    totals?.totalDeductedAmount != null
      ? num(totals.totalDeductedAmount)
      : months.reduce((t, m) => t + num(m.deductedAmount), 0);

  return (
    <>
      {/* Summary cards */}
      <div className="ld-grid" style={{ marginBottom: 18 }}>
        <StatCard tone="blue" icon={<FiCalendar />} label="Period" value={show(report.period)}
          hint="The quarter this cost report covers." />
        <StatCard tone="green" icon={<FiDollarSign />} label="Total Cost" value={money(report.totalCost)}
          hint="Billable cost for the quarter — the sum of each month's cost after deductions." />
        <StatCard tone="red" icon={<FiFileText />} label="Total Deducted" value={money(totalDeducted)}
          hint="Amount withheld across the quarter for absent and unpaid days." />
        <StatCard tone="purple" icon={<FiLayers />} label="Months Covered" value={show(months.length)}
          hint="How many months of the quarter are included in the breakdown below." />
        <StatCard tone="amber" icon={<FiUmbrella />} label="Relaxation Applied" value={dayCount(relaxationApplied)}
          hint="Relaxation days applied across the quarter, against the relaxation granted for it." />
      </div>

      {/* Monthly breakdown table */}
      {months.length > 0 && (
        <div className="uidai-pmis-card ld-costtable-card">
          <div className="ld-costtable-wrap">
          <table className="ld-costtable">
            <thead>
              <tr>
                <th title="Calendar month this row covers.">Period</th>
                <th title="Which year of the resource's rate card was used for this month.">Rate Year</th>
                <th className="ld-num" title="Total working days in the month, excluding weekends and holidays.">Working Days</th>
                <th className="ld-num" title="Days the employee was present. Half days count as 0.5.">Present Days</th>
                <th className="ld-num" title="Paid leave plus unpaid leave for the month. Derived here — the report sends the parts but no total. Relaxation days are not included.">Total Leave</th>
                <th className="ld-num" title="Present days as a percentage of working days.">Attendance %</th>
                <th className="ld-num" title="Full monthly rate from the rate card, before any deduction.">Monthly Rate</th>
                <th className="ld-num" title="Monthly rate divided by the working days in the month.">Per Day Rate</th>
                {/* <th className="ld-num">HalfDay Amount</th> */}
                <th className="ld-num" title="Amount withheld for absent and unpaid days.">Deducted Amount</th>
                <th className="ld-num" title="Monthly rate minus the deducted amount — what is billable for the month.">Cost</th>
              </tr>
            </thead>
            <tbody>
              {months.map((m, i) => {
                const leave = monthLeave(m);
                return (
                <tr key={i}>
                  <td className="ld-costtable-period">{show(m.period)}</td>
                  <td>{show(m.rateYear)}</td>
                  <td className="ld-num">{show(m.workingDays)}</td>
                  <td className="ld-num">{show(m.presentDays)}</td>
                  <td
                    className="ld-num"
                    title={`${dayCount(leave.paid)} paid + ${dayCount(leave.unpaid)} unpaid`}
                  >
                    {dayCount(leave.total)}
                  </td>
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
                );
              })}
            </tbody>
            <tfoot>
              <tr>
                {/* 9 = the ten body columns minus the Cost column this
                    total sits under. Bump it if a column is added. */}
                <td colSpan={9} className="ld-costtable-totallbl">Total Cost</td>
                <td className="ld-num ld-costtable-cost">{money(report.totalCost)}</td>
              </tr>
            </tfoot>
          </table>
          </div>
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

function RelaxationModal({ resourceId, projectId, year, quarter, maxDays, hasDocument, onSuccess, onClose }) {
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
  const [attachment, setAttachment] = useState(null);
  const [fileError, setFileError] = useState(null);

  useEffect(() => {
    const onKey = (e) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const set = (patch) => setForm((f) => ({ ...f, ...patch }));

  /* Rejecting a bad file here rather than at submit keeps the attachment
     out of the main error line — the request is still perfectly valid
     without it, so an oversized image shouldn't read like a blocked form. */
  const pickFile = (f) => {
    if (!f) return;
    if (!ACCEPTED_IMAGE.test(f.type)) {
      setFileError("That file isn't an image. Choose a PNG, JPG, WEBP or GIF.");
      return;
    }
    if (f.size > MAX_ATTACHMENT_BYTES) {
      setFileError(`That image is ${fmtBytes(f.size)} — the limit is 5 MB.`);
      return;
    }
    setFileError(null);
    setAttachment(f);
  };

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
      const qs = new URLSearchParams({
        resourceId: String(form.resourceId),
        projectId: String(form.projectId),
        year: String(Number(form.year)),
        quarter: String(Number(form.quarter)),
        relaxationDays: String(days),
      });
      if (form.remarks.trim()) qs.set("remarks", form.remarks.trim());

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
                {/* step 0.5, not 1 — unpaid leave is counted in half days,
                    so a 0.5-day balance must be relaxable by 0.5. */}
                <input type="number" min="0" step="0.5" max={maxDays ?? undefined} className="ld-input"
                  value={form.relaxationDays}
                  onChange={(e) => set({ relaxationDays: e.target.value })} placeholder="e.g. 1.5" />
              </label>
              <label className="ld-field ld-field--full">
                <span className="ld-field-lbl">Remarks</span>
                <textarea className="ld-input" rows={3} value={form.remarks}
                  onChange={(e) => set({ remarks: e.target.value })} placeholder="Reason for the relaxation…"
                  style={{ resize: "vertical", fontFamily: "inherit" }} />
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
.ld-cal-cell { display: grid; place-items: center; aspect-ratio: 1; border-radius: 6px;
  font-size: 12px; font-variant-numeric: tabular-nums; color: ${C.ink}; }
.ld-cal-cell.is-blank { visibility: hidden; }
.ld-cal-cell.is-weekend { color: ${C.faint}; background: ${C.surface}; }
/* Same two hues as the donut segments, so a day and its slice read as one. */
.ld-cal-cell.is-paid { background: #2a78d6; color: #fff; font-weight: 700; }
.ld-cal-cell.is-unpaid { background: #e34948; color: #fff; font-weight: 700; }
.ld-cal-legend { display: flex; flex-wrap: wrap; gap: 18px; margin-top: 20px;
  padding-top: 14px; border-top: 1px solid ${C.divider};
  font-size: 12px; color: ${C.muted}; }
.ld-cal-legend span { display: inline-flex; align-items: center; gap: 7px; }
.ld-cal-key { width: 11px; height: 11px; border-radius: 3px; display: inline-block; }
.ld-cal-key.is-paid { background: #2a78d6; }
.ld-cal-key.is-unpaid { background: #e34948; }
.ld-cal-key.is-weekend { background: ${C.surface}; border: 1px solid ${C.border}; }

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
.ld-costtable-period { font-weight: 600; }
/* Only the money column that the total keys off is accented. */
.ld-costtable-cost { font-weight: 700; color: ${C.primary}; }
.ld-costtable tfoot td { padding: 14px; border-top: 1px solid ${C.border}; background: ${C.surface}; }
.ld-costtable-totallbl { text-align: right; font-weight: 700; color: ${C.muted}; text-transform: uppercase; font-size: 10.5px; letter-spacing: .07em; }
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