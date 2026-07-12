import React, { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { useProject } from "../../store/project/projectsStore";
import { setPageContext, clearPageContext } from "../../utils/pageContext";

// Swap this for your shared API client / env base URL if you have one.
const API_BASE = "http://10.1.131.199:8019";

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

// "0.5 hrs" -> 0.5
function parseHours(value) {
  const n = parseFloat(String(value ?? ""));
  return Number.isFinite(n) ? n : 0;
}

function totalShortHours(shortHours) {
  if (!shortHours) return 0;
  return Object.values(shortHours).reduce((sum, v) => sum + parseHours(v), 0);
}

// The per-resource calc fields may be nested under `calculation` or flat.
function getCalc(resource) {
  return resource?.calculation ?? resource ?? {};
}

function isWeekdayName(name) {
  return WEEKDAY_NAMES.has(String(name ?? "").trim().toLowerCase());
}

function parseDate(s) {
  return new Date(`${s}T00:00:00`);
}
function dayNum(s) {
  return parseDate(s).getDate();
}
function weekdayShort(s) {
  return WEEKDAY_SHORT[parseDate(s).getDay()];
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

function groupHolidaysByMonth(holidays) {
  const groups = new Map();
  for (const h of holidays) {
    const m = Number(h.date.slice(5, 7));
    if (!groups.has(m)) groups.set(m, []);
    groups.get(m).push(h);
  }
  return [...groups.entries()].sort((a, b) => a[0] - b[0]);
}

export default function ProjectAttendancePage() {
  const { projectId } = useParams();
  const project = useProject(projectId);

  const [year, setYear] = useState(CURRENT_YEAR);
  const [selectedMonth, setSelectedMonth] = useState("all"); // "all" | 1..12
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

  useEffect(() => {
    setPageContext({ projectName: project?.projectName || "" });
    return () => clearPageContext();
  }, [project?.projectName]);

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
          { signal: controller.signal } // add { headers: { Authorization: ... } } here if needed
        );
        if (!res.ok) throw new Error(`Request failed (${res.status})`);
        const data = await res.json();
        if (active) setSummary(data);
      } catch (err) {
        if (active && err.name !== "AbortError") {
          setSummaryError(err.message || "Failed to load attendance summary");
        }
      } finally {
        if (active) setSummaryLoading(false);
      }
    })();

    return () => {
      active = false;
      controller.abort();
    };
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
        if (active && err.name !== "AbortError") {
          setQuarterlyError(err.message || "Failed to load quarterly leave");
        }
      } finally {
        if (active) setQuarterlyLoading(false);
      }
    })();

    return () => {
      active = false;
      controller.abort();
    };
  }, [projectId, year, quarter]);

  // Holidays + calendar — lazy fetch when the modal opens (or year changes while open).
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
        const cData = cRes.ok ? await cRes.json() : null; // calendar is supplementary
        if (active) {
          setHolidays(normalizeHolidays(hData));
          setCalendar(cData);
        }
      } catch (err) {
        if (active && err.name !== "AbortError") {
          setHolidayError(err.message || "Failed to load holidays");
        }
      } finally {
        if (active) setHolidayLoading(false);
      }
    })();

    return () => {
      active = false;
      controller.abort();
    };
  }, [holidayOpen, year]);

  const toggleRow = (key) =>
    setExpanded((prev) => ({ ...prev, [key]: !prev[key] }));

  const allMonths = summary?.months ?? [];
  const availableMonths = allMonths.map((m) => m.month).sort((a, b) => a - b);
  const visibleMonths =
    selectedMonth === "all"
      ? allMonths
      : allMonths.filter((m) => m.month === Number(selectedMonth));

  return (
    <div style={styles.page}>
      <div style={styles.headerRow}>
        <div>
          <h1 style={styles.title}>Attendance</h1>
          <div style={styles.subtitle}>{project?.projectName || "Project"}</div>
        </div>
        <div style={styles.controlsRow}>
          <label style={styles.control}>
            Year
            <select
              value={year}
              onChange={(e) => {
                setYear(Number(e.target.value));
                setSelectedMonth("all");
              }}
              style={styles.select}
            >
              {YEAR_OPTIONS.map((y) => (
                <option key={y} value={y}>{y}</option>
              ))}
            </select>
          </label>
          <label style={styles.control}>
            Month
            <select
              value={selectedMonth}
              onChange={(e) => setSelectedMonth(e.target.value)}
              style={styles.select}
            >
              <option value="all">All months</option>
              {availableMonths.map((m) => (
                <option key={m} value={m}>{MONTH_NAMES[m]}</option>
              ))}
            </select>
          </label>
          <button
            type="button"
            style={styles.holidayBtn}
            onClick={() => setHolidayOpen(true)}
          >
            <CalendarIcon />
            Holiday list
          </button>
        </div>
      </div>

      {/* ---- Monthly summary ---- */}
      <section style={styles.section}>
        <h2 style={styles.sectionTitle}>Monthly summary</h2>

        {summaryLoading && <div style={styles.muted}>Loading summary…</div>}
        {summaryError && <div style={styles.error}>{summaryError}</div>}
        {!summaryLoading && !summaryError && visibleMonths.length === 0 && (
          <div style={styles.muted}>
            {selectedMonth === "all"
              ? `No attendance recorded for ${year}.`
              : `No attendance recorded for ${MONTH_NAMES[Number(selectedMonth)]} ${year}.`}
          </div>
        )}

        {visibleMonths.map((m) => (
          <MonthCard key={m.month} month={m} expanded={expanded} onToggle={toggleRow} />
        ))}
      </section>

      {/* ---- Quarterly leave ---- */}
      <section style={styles.section}>
        <div style={styles.headerRow}>
          <h2 style={styles.sectionTitle}>Quarterly leave</h2>
          <label style={styles.control}>
            Quarter
            <select
              value={quarter}
              onChange={(e) => setQuarter(Number(e.target.value))}
              style={styles.select}
            >
              {[1, 2, 3, 4].map((q) => (
                <option key={q} value={q}>Q{q}</option>
              ))}
            </select>
          </label>
        </div>

        {quarterlyLoading && <div style={styles.muted}>Loading quarterly leave…</div>}
        {quarterlyError && <div style={styles.error}>{quarterlyError}</div>}
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
    </div>
  );
}

function CalendarIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <rect x="3" y="4.5" width="18" height="16" rx="2.5" stroke="currentColor" strokeWidth="1.8" />
      <path d="M3 9h18M8 3v3M16 3v3" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

function HolidayModal({ year, holidays, calendar, loading, error, onClose }) {
  useEffect(() => {
    const onKey = (e) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [onClose]);

  const grouped = holidays ? groupHolidaysByMonth(holidays) : [];
  const namedCount = holidays ? holidays.filter((h) => h.named).length : 0;

  return (
    <div style={styles.backdrop} onClick={onClose}>
      <div
        style={styles.modal}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label={`Holidays ${year}`}
      >
        <div style={styles.modalHeader}>
          <div>
            <h2 style={styles.modalTitle}>Holidays · {year}</h2>
            <div style={styles.subtitle}>Public holidays & weekend summary</div>
          </div>
          <button type="button" style={styles.closeBtn} onClick={onClose} aria-label="Close">
            ×
          </button>
        </div>

        {loading && <div style={styles.muted}>Loading holidays…</div>}
        {error && <div style={styles.error}>{error}</div>}

        {!loading && !error && (
          <>
            <div style={styles.chips}>
              {calendar && (
                <>
                  <span style={styles.chip}>{calendar.saturdays} Saturdays</span>
                  <span style={styles.chip}>{calendar.sundays} Sundays</span>
                  <span style={styles.chip}>{calendar.totalWeekendDays} weekend days</span>
                </>
              )}
              <span style={{ ...styles.chip, ...styles.chipAccent }}>{namedCount} holidays</span>
            </div>

            <div style={styles.modalBody}>
              {grouped.length === 0 ? (
                <div style={styles.muted}>No holidays found for {year}.</div>
              ) : (
                grouped.map(([month, items]) => (
                  <div key={month} style={styles.monthGroup}>
                    <div style={styles.monthGroupHeader}>{MONTH_NAMES[month]}</div>
                    {items.map((h) => (
                      <div key={`${h.date}-${h.name}`} style={styles.holidayRow}>
                        <div style={styles.dateBadge}>
                          <span style={styles.dateBadgeDay}>{dayNum(h.date)}</span>
                          <span style={styles.dateBadgeWd}>{weekdayShort(h.date)}</span>
                        </div>
                        <div style={h.named ? styles.holidayName : styles.holidayNameMuted}>
                          {h.name}
                        </div>
                      </div>
                    ))}
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

function MonthCard({ month, expanded, onToggle }) {
  const employees = month.employees ?? [];
  return (
    <div style={styles.card}>
      <div style={styles.cardHeader}>
        <strong>{MONTH_NAMES[month.month]} {month.year}</strong>
        <div style={styles.chips}>
          <span style={styles.chip}>{month.totalDaysInMonth} days</span>
          <span style={styles.chip}>{month.totalWeekendDays} weekend days</span>
          <span style={styles.chip}>{employees.length} employees</span>
          {month.publicHolidayCount > 0 && (
            <span
              style={styles.chip}
              title={month.publicHolidays.map((h) => `${h.date} · ${h.name}`).join("\n")}
            >
              {month.publicHolidayCount} holiday{month.publicHolidayCount > 1 ? "s" : ""}
            </span>
          )}
        </div>
      </div>

      {employees.length === 0 ? (
        <div style={styles.muted}>No employee data.</div>
      ) : (
        <table style={styles.table}>
          <thead>
            <tr>
              <th style={styles.th}></th>
              <th style={styles.th}>ID</th>
              <th style={styles.th}>Name</th>
              <th style={styles.th}>Designation</th>
              <th style={styles.thNum}>Leave days</th>
              <th style={styles.thNum}>Half days</th>
              <th style={styles.thNum}>Short-hour days</th>
              <th style={styles.thNum}>Total short hrs</th>
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
                  <tr>
                    <td style={styles.td}>
                      {hasDetail && (
                        <button
                          type="button"
                          onClick={() => onToggle(key)}
                          style={styles.expandBtn}
                          aria-label={isOpen ? "Collapse" : "Expand"}
                        >
                          {isOpen ? "▾" : "▸"}
                        </button>
                      )}
                    </td>
                    <td style={styles.td}>{emp.attendanceId}</td>
                    <td style={styles.td}>{emp.employeeName}</td>
                    <td style={styles.td}>{emp.designation}</td>
                    <td style={styles.tdNum}>{emp.leaveDays}</td>
                    <td style={styles.tdNum}>{emp.halfDays?.length ?? 0}</td>
                    <td style={styles.tdNum}>{emp.shortHourDays}</td>
                    <td style={styles.tdNum}>{totalShort ? totalShort.toFixed(2) : "0"}</td>
                  </tr>
                  {isOpen && hasDetail && (
                    <tr>
                      <td />
                      <td style={styles.detailCell} colSpan={7}>
                        {(emp.halfDays?.length ?? 0) > 0 && (
                          <div style={styles.detailBlock}>
                            <span style={styles.detailLabel}>Half days:</span>{" "}
                            {emp.halfDays.join(", ")}
                          </div>
                        )}
                        {shortEntries.length > 0 && (
                          <div style={styles.detailBlock}>
                            <span style={styles.detailLabel}>Short hours:</span>{" "}
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
      )}
    </div>
  );
}

function QuarterlyPanel({ data, expanded, onToggle }) {
  const resources = data.resources ?? [];
  const monthsLabel = (data.monthsWithData ?? [])
    .map((m) => MONTH_NAMES[m] || m)
    .join(", ");

  return (
    <div style={styles.card}>
      <div style={styles.cardHeader}>
        <strong>Q{data.quarter} {data.year}</strong>
        <div style={styles.chips}>
          <span style={styles.chip}>{data.quarterStart} → {data.quarterEnd}</span>
          <span style={styles.chip}>{data.resourceCount} resources</span>
          {monthsLabel && <span style={styles.chip}>Data: {monthsLabel}</span>}
        </div>
      </div>

      {resources.length === 0 ? (
        <div style={styles.muted}>No leave data recorded for this quarter.</div>
      ) : (
        <table style={styles.table}>
          <thead>
            <tr>
              <th style={styles.th}></th>
              <th style={styles.th}>Attendance Id</th>
              <th style={styles.th}>Employee Name</th>
              <th style={styles.th}>Joining Date</th>
              <th style={styles.thNum} title="Permissible paid leave">Permissible</th>
              <th style={styles.thNum} title="Leave days taken">Taken</th>
              <th style={styles.thNum} title="Paid leave days">Paid</th>
              <th style={styles.thNum} title="Unpaid leave days">Unpaid</th>
              <th style={styles.thNum} title="Sandwich days charged">Sandwich</th>
              <th style={styles.thNum} title="Total unpaid days">Total unpaid</th>
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
                  <tr>
                    <td style={styles.td}>
                      {hasDetail && (
                        <button
                          type="button"
                          onClick={() => onToggle(key)}
                          style={styles.expandBtn}
                          aria-label={isOpen ? "Collapse" : "Expand"}
                        >
                          {isOpen ? "▾" : "▸"}
                        </button>
                      )}
                    </td>
                    <td style={styles.td}>{r.attendanceId}</td>
                    <td style={styles.td}>{r.employeeName}</td>
                    <td style={styles.td}>{r.joiningDate || "—"}</td>
                    <td style={styles.tdNum}>{c.permissibleLeave ?? 0}</td>
                    <td style={styles.tdNum}>{c.leaveDaysTaken ?? 0}</td>
                    <td style={styles.tdNum}>{c.paidLeaveDays ?? 0}</td>
                    <td style={styles.tdNum}>{c.unpaidLeaveDays ?? 0}</td>
                    <td style={styles.tdNum}>{c.sandwichDays ?? 0}</td>
                    <td style={{ ...styles.tdNum, fontWeight: totalUnpaid > 0 ? 600 : 400, color: totalUnpaid > 0 ? "#b91c1c" : "inherit" }}>
                      {totalUnpaid}
                    </td>
                  </tr>
                  {isOpen && hasDetail && (
                    <tr>
                      <td />
                      <td style={styles.detailCell} colSpan={9}>
                        {unpaidDates.length > 0 && (
                          <div style={styles.detailBlock}>
                            <span style={styles.detailLabel}>Unpaid leave dates:</span>{" "}
                            {unpaidDates.join(", ")}
                          </div>
                        )}
                        {sandwichDates.length > 0 && (
                          <div style={styles.detailBlock}>
                            <span style={styles.detailLabel}>Sandwich dates:</span>{" "}
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
      )}
    </div>
  );
}

const styles = {
  page: { padding: 24, maxWidth: 1100, margin: "0 auto" },
  headerRow: { display: "flex", alignItems: "flex-end", justifyContent: "space-between", gap: 16, marginBottom: 8 },
  controlsRow: { display: "flex", gap: 12, alignItems: "flex-end" },
  title: { margin: 0, fontSize: 22 },
  subtitle: { color: "#6b7280", marginTop: 2, fontSize: 13 },
  section: { marginTop: 28 },
  sectionTitle: { fontSize: 16, margin: "0 0 12px" },
  control: { display: "flex", flexDirection: "column", fontSize: 12, color: "#6b7280", gap: 4 },
  select: { padding: "6px 8px", borderRadius: 6, border: "1px solid #d1d5db", fontSize: 14, minWidth: 120 },
  holidayBtn: {
    display: "inline-flex", alignItems: "center", gap: 6,
    padding: "8px 12px", borderRadius: 6, border: "1px solid #d1d5db",
    background: "#fff", color: "#374151", fontSize: 14, cursor: "pointer", height: 34,
  },
  card: { border: "1px solid #e5e7eb", borderRadius: 10, padding: 16, marginBottom: 16, background: "#fff" },
  cardHeader: { display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, marginBottom: 12, flexWrap: "wrap" },
  chips: { display: "flex", gap: 6, flexWrap: "wrap" },
  chip: { fontSize: 12, background: "#f3f4f6", color: "#374151", padding: "2px 8px", borderRadius: 999, whiteSpace: "pre-line" },
  chipAccent: { background: "#eef2ff", color: "#3730a3", fontWeight: 600 },
  table: { width: "100%", borderCollapse: "collapse", fontSize: 14 },
  th: { textAlign: "left", padding: "8px 10px", borderBottom: "2px solid #e5e7eb", color: "#6b7280", fontWeight: 600, whiteSpace: "nowrap" },
  thNum: { textAlign: "right", padding: "8px 10px", borderBottom: "2px solid #e5e7eb", color: "#6b7280", fontWeight: 600, whiteSpace: "nowrap" },
  td: { padding: "8px 10px", borderBottom: "1px solid #f3f4f6" },
  tdNum: { padding: "8px 10px", borderBottom: "1px solid #f3f4f6", textAlign: "right" },
  detailCell: { padding: "8px 10px", background: "#fafafa", fontSize: 13, color: "#374151" },
  detailBlock: { marginBottom: 4 },
  detailLabel: { fontWeight: 600, color: "#6b7280" },
  expandBtn: { border: "none", background: "none", cursor: "pointer", fontSize: 12, color: "#6b7280", padding: 0 },
  muted: { color: "#9ca3af", fontSize: 14, padding: "8px 0" },
  error: { color: "#b91c1c", fontSize: 14, padding: "8px 0" },

  // ---- Holiday modal ----
  backdrop: {
    position: "fixed", inset: 0, background: "rgba(17,24,39,0.45)",
    display: "flex", alignItems: "flex-start", justifyContent: "center",
    padding: "48px 16px", zIndex: 1000,
  },
  modal: {
    background: "#fff", borderRadius: 12, width: "100%", maxWidth: 540,
    maxHeight: "85vh", display: "flex", flexDirection: "column",
    boxShadow: "0 20px 50px rgba(0,0,0,0.25)", padding: 20,
  },
  modalHeader: { display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12, marginBottom: 14 },
  modalTitle: { margin: 0, fontSize: 18 },
  closeBtn: {
    border: "none", background: "#f3f4f6", borderRadius: 8, width: 30, height: 30,
    fontSize: 20, lineHeight: 1, cursor: "pointer", color: "#6b7280",
  },
  modalBody: { marginTop: 14, overflowY: "auto", paddingRight: 4 },
  monthGroup: { marginBottom: 14 },
  monthGroupHeader: {
    fontSize: 12, fontWeight: 700, textTransform: "uppercase", letterSpacing: 0.5,
    color: "#6b7280", padding: "4px 0", borderBottom: "1px solid #f3f4f6", marginBottom: 6,
  },
  holidayRow: { display: "flex", alignItems: "center", gap: 12, padding: "6px 2px" },
  dateBadge: {
    display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
    minWidth: 46, padding: "4px 0", borderRadius: 8, background: "#f9fafb", border: "1px solid #eef0f3",
  },
  dateBadgeDay: { fontSize: 16, fontWeight: 700, color: "#111827", lineHeight: 1.1 },
  dateBadgeWd: { fontSize: 10, color: "#9ca3af", textTransform: "uppercase" },
  holidayName: { fontSize: 14, color: "#111827" },
  holidayNameMuted: { fontSize: 14, color: "#9ca3af", fontStyle: "italic" },
};