import { useCallback, useEffect, useMemo, useState } from "react";
import { getToken } from "../../api/auth";
import { FiUploadCloud, FiCalendar } from "react-icons/fi";

const API_BASE = "http://10.1.131.199:8019";

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = ["January","February","March","April","May","June","July","August","September","October","November","December"];
const DAY_NAMES = new Set(["Sunday","Monday","Tuesday","Wednesday","Thursday","Friday","Saturday"]);

const CAL_STYLES = `
.mh-wrap { font-family: inherit; }

/* ── upload card ── */
.mh-upload-card {
  background: #fff; border: 1px solid #e2e8f0; border-radius: 14px;
  box-shadow: 0 2px 10px rgba(11,60,136,.06); overflow: hidden;
}
.mh-upload-card-head { padding: 20px 20px 16px; border-bottom: 1px solid #f1f5fb; display: flex; align-items: center; gap: 14px; }
.mh-upload-icon-wrap { width: 46px; height: 46px; border-radius: 12px; background: #eef3fb; display: flex; align-items: center; justify-content: center; flex-shrink: 0; }
.mh-upload-card-title { font-size: 16px; font-weight: 800; color: #1e2a3a; margin: 0 0 2px; }
.mh-upload-card-sub { font-size: 12.5px; color: #64748b; margin: 0; }
.mh-upload-body { padding: 20px; }
.mh-field { display: flex; flex-direction: column; gap: 6px; margin-bottom: 16px; }
.mh-field-label { font-size: 12.5px; font-weight: 600; color: #64748b; }
.mh-field select {
  width: 100%; border: 1px solid #e2e8f0; border-radius: 9px; padding: 10px 12px;
  font-size: 14px; background: #fff; color: #1e2a3a; font-family: inherit; outline: none;
  appearance: auto; cursor: pointer;
}
.mh-field select:focus { border-color: #0b3c88; box-shadow: 0 0 0 3px #eef3fb; }
.mh-dropzone {
  border: 2px dashed #c8d6ee; border-radius: 10px; padding: 16px;
  display: flex; align-items: center; gap: 14px; cursor: pointer; transition: border-color .15s;
  background: #f8fbff;
}
.mh-dropzone:hover { border-color: #0b3c88; }
.mh-dropzone-icon { width: 44px; height: 44px; background: #e8f5e9; border-radius: 8px; display: flex; align-items: center; justify-content: center; flex-shrink: 0; font-size: 22px; }
.mh-dropzone-text { font-size: 13px; color: #64748b; flex: 1; }
.mh-dropzone-filename { font-size: 13px; font-weight: 600; color: #1e2a3a; }
.mh-info-note {
  display: flex; align-items: flex-start; gap: 10px; background: #f0f6ff;
  border: 1px solid #c8d6ee; border-radius: 9px; padding: 11px 14px;
  font-size: 12.5px; color: #334155; margin-bottom: 16px; line-height: 1.5;
}
.mh-info-note-icon { color: #0b3c88; flex-shrink: 0; margin-top: 1px; }
.mh-btn-upload {
  display: flex; align-items: center; justify-content: center; gap: 8px; width: 100%;
  border-radius: 10px; font-size: 14px; font-weight: 700; padding: 12px;
  cursor: pointer; border: none; background: #0b3c88; color: #fff; font-family: inherit;
  box-shadow: 0 2px 6px rgba(11,60,136,.25); transition: background .15s;
}
.mh-btn-upload:hover:not(:disabled) { background: #062a63; }
.mh-btn-upload:disabled { opacity: .55; cursor: not-allowed; }
.mh-msg { display: flex; align-items: center; gap: 10px; border-radius: 10px; padding: 12px 16px; font-size: 14px; margin-bottom: 14px; font-weight: 500; }
.mh-msg.ok { background: #e6f6ee; border: 1px solid #c7ead6; color: #0f7a45; }
.mh-msg.err { background: #fde8e8; border: 1px solid #f5c9c9; color: #d32f2f; }

/* ── calendar panel ── */
.mh-cal-panel { background: #fff; border: 1px solid #e2e8f0; border-radius: 14px; box-shadow: 0 2px 10px rgba(11,60,136,.06); overflow: hidden; }

/* ── topbar ── */
.mh-topbar { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; padding: 14px 18px; border-bottom: 1px solid #f1f5fb; }
.mh-topbar-label { font-size: 13px; font-weight: 600; color: #64748b; display: flex; align-items: center; gap: 6px; white-space: nowrap; }
.mh-topbar select {
  height: 36px; padding: 0 10px; border: 1px solid #e2e8f0; border-radius: 8px;
  font-size: 14px; font-weight: 600; color: #1e2a3a; background: #fff;
  outline: none; cursor: pointer; font-family: inherit; min-width: 100px;
}
.mh-topbar select:focus { border-color: #0b3c88; box-shadow: 0 0 0 3px #eef3fb; }
.mh-btn-reload {
  display: inline-flex; align-items: center; gap: 6px; height: 36px; padding: 0 14px;
  border-radius: 8px; border: 1px solid #e2e8f0; background: #fff; font-size: 13px;
  font-weight: 600; color: #334155; cursor: pointer; font-family: inherit; transition: background .15s;
}
.mh-btn-reload:hover { background: #f8fbff; }
.mh-btn-reload:disabled { opacity: .55; cursor: not-allowed; }
.mh-badge { display: inline-flex; align-items: center; gap: 6px; padding: 5px 12px; border-radius: 999px; background: #eef3fb; font-size: 13px; font-weight: 700; color: #0b3c88; }
.mh-badge-dot { width: 8px; height: 8px; border-radius: 50%; background: #ef4444; flex-shrink: 0; }
.mh-legend { display: flex; gap: 14px; flex-wrap: wrap; margin-left: auto; }
.mh-legend-item { display: flex; align-items: center; gap: 7px; font-size: 12.5px; color: #64748b; font-weight: 500; }
.mh-legend-swatch { width: 14px; height: 14px; border-radius: 4px; flex-shrink: 0; }

/* ── month nav ── */
.mh-month-nav { display: flex; align-items: center; justify-content: space-between; padding: 12px 18px; border-bottom: 1px solid #f1f5fb; }
.mh-nav-btn {
  width: 34px; height: 34px; border: 1px solid #e2e8f0; border-radius: 9px;
  background: #fff; color: #0b3c88; cursor: pointer; font-size: 18px;
  display: flex; align-items: center; justify-content: center; transition: background .15s;
  font-family: inherit;
}
.mh-nav-btn:hover:not(:disabled) { background: #eef3fb; border-color: #0b3c88; }
.mh-nav-btn:disabled { color: #c8d6ee; border-color: #e8eef5; cursor: not-allowed; }
.mh-month-nav-title { font-size: 16px; font-weight: 800; color: #0b3c88; }

/* ── calendar grid ── */
.mh-cal-body { padding: 16px; }
.mh-cal-title { font-size: 16px; font-weight: 800; color: #0b3c88; text-align: center; margin-bottom: 12px; }
.mh-day-headers { display: grid; grid-template-columns: repeat(7, 1fr); background: #0b3c88; border-radius: 8px; overflow: hidden; margin-bottom: 6px; }
.mh-day-hdr { font-size: 11px; font-weight: 700; color: #fff; text-align: center; padding: 10px 4px; text-transform: uppercase; letter-spacing: .05em; }
.mh-days { display: grid; grid-template-columns: repeat(7, 1fr); gap: 3px; }
.mh-cell {
  min-height: 64px; display: flex; flex-direction: column; align-items: center;
  justify-content: flex-start; padding: 8px 4px 6px; border-radius: 8px;
  font-size: 14px; font-weight: 600; color: #334155; position: relative;
  cursor: default; transition: background .1s; border: 1px solid transparent;
}
.mh-cell.blank { pointer-events: none; border-color: transparent; }
.mh-cell:not(.blank):not(.holiday):not(.today):hover { background: #f8fbff; }
.mh-cell.today { background: #0b3c88 !important; color: #fff !important; font-weight: 800; border-color: transparent; box-shadow: 0 2px 8px rgba(11,60,136,.3); }
.mh-cell.holiday { background: #fff1f2; color: #b91c1c !important; font-weight: 700; border-color: #fca5a5; }
.mh-cell.holiday.today { background: linear-gradient(135deg,#0b3c88,#dc2626) !important; border-color: transparent; color: #fff !important; }
.mh-cell-day { font-size: 15px; font-weight: 700; line-height: 1; margin-bottom: 4px; }
.mh-cell-name { font-size: 10px; font-weight: 600; color: #dc2626; line-height: 1.3; text-align: center; word-break: break-word; }
.mh-cell.today .mh-cell-name { color: #fecaca; }
.mh-dot { width: 5px; height: 5px; border-radius: 50%; background: #ef4444; margin-top: auto; }
.mh-cell.today .mh-dot { background: #fca5a5; }

/* ── footer legend ── */
.mh-cal-footer { display: flex; gap: 20px; padding: 12px 16px; border-top: 1px solid #f1f5fb; flex-wrap: wrap; }
.mh-cal-footer-item { display: flex; align-items: center; gap: 8px; font-size: 12.5px; color: #64748b; }
.mh-cal-footer-dot { width: 12px; height: 12px; border-radius: 50%; flex-shrink: 0; }

/* ── dots nav ── */
.mh-dot-nav { display: flex; gap: 6px; justify-content: center; padding: 12px; border-top: 1px solid #f1f5fb; }

/* ── loading ── */
.mh-loading { text-align: center; padding: 60px 0; color: #94a3b8; font-size: 14px; }
.mh-loading-spinner { display: inline-block; width: 28px; height: 28px; border: 3px solid #dbe5f1; border-top-color: #0b3c88; border-radius: 50%; animation: mh-spin .7s linear infinite; margin-bottom: 12px; display: block; margin: 0 auto 12px; }
@keyframes mh-spin { to { transform: rotate(360deg); } }
`;

export default function MasterHolidays() {
  const currentYear = new Date().getFullYear();
  const years = useMemo(() => [
    currentYear,
    ...Array.from({ length: 20 }, (_, i) => currentYear + i + 1),
    ...Array.from({ length: currentYear - 2000 }, (_, i) => currentYear - (i + 1)),
  ], [currentYear]);

  const [year, setYear] = useState("");
  const [file, setFile] = useState(null);
  const [uploading, setUploading] = useState(false);
  const [msg, setMsg] = useState(null);

  // calendar state
  const [calYear, setCalYear] = useState(String(currentYear));
  const [holidays, setHolidays] = useState([]);
  const [calLoading, setCalLoading] = useState(false);
  const [calError, setCalError] = useState(null);

  // Group holidays by date (filter out pure weekday-name entries for display)
  const holidayMap = useMemo(() => {
    const map = {};
    holidays.forEach(({ date, name }) => {
      if (!map[date]) map[date] = [];
      map[date].push(name);
    });
    return map;
  }, [holidays]);

  const fetchHolidays = useCallback(async (y) => {
    if (!y) return;
    setCalLoading(true); setCalError(null);
    try {
      const token = getToken();
      const res = await fetch(`${API_BASE}/api/holidays/${y}?month=all`, {
        headers: { Accept: "*/*", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      });
      if (!res.ok) throw new Error(`Failed to load holidays (${res.status})`);
      const data = await res.json();
      setHolidays(Array.isArray(data) ? data : []);
    } catch (e) {
      setCalError(e.message || "Failed to load holidays");
    } finally {
      setCalLoading(false);
    }
  }, []);

  useEffect(() => { fetchHolidays(calYear); }, [calYear, fetchHolidays]);

  async function handleUpload() {
    setMsg(null);
    if (!year) { setMsg({ type: "error", text: "Please select a year." }); return; }
    if (!file) { setMsg({ type: "error", text: "Please select an Excel file." }); return; }
    const formData = new FormData();
    formData.append("file", file);
    try {
      setUploading(true);
      const token = getToken();
      const res = await fetch(`${API_BASE}/api/holidays?year=${year}`, {
        method: "POST",
        headers: token ? { Authorization: `Bearer ${token}` } : {},
        body: formData,
      });
      if (!res.ok) throw new Error(`Upload failed (${res.status})`);
      setMsg({ type: "ok", text: `Holiday list for ${year} uploaded successfully.` });
      setFile(null);
      if (String(year) === String(calYear)) fetchHolidays(calYear);
    } catch (err) {
      setMsg({ type: "error", text: err?.message || "Failed to upload holiday list." });
    } finally {
      setUploading(false);
    }
  }

  const todayStr = new Date().toISOString().slice(0, 10);
  const totalHolidays = Object.keys(holidayMap).length;
  const [viewMonth, setViewMonth] = useState(0); // 0-based, shows 1 month

  const prevMonth = () => setViewMonth((m) => Math.max(0, m - 1));
  const nextMonth = () => setViewMonth((m) => Math.min(11, m + 1));
  const canPrev = viewMonth > 0;
  const canNext = viewMonth < 11;

  return (
    <div className="uidai-pmis-content mh-wrap" style={{ padding: "12px 0 24px", maxWidth: 1400, margin: "0 auto" }}>
      <style>{CAL_STYLES}</style>

      {/* Main layout: left = form, right = calendar */}
      <div style={{ display: "flex", gap: 20, alignItems: "flex-start" }}>

        {/* ── Left: Upload form ── */}
        <div style={{ flex: "0 0 460px", position: "sticky", top: 20 }}>
          <div className="mh-upload-card">
            <div className="mh-upload-card-head">
              <div className="mh-upload-icon-wrap">
                <FiCalendar size={22} color="#0b3c88" />
              </div>
              <div>
                <p className="mh-upload-card-title">Upload Holiday List</p>
                <p className="mh-upload-card-sub">Upload an Excel file to load holiday data</p>
              </div>
            </div>
            <div className="mh-upload-body">
              {msg && (
                <div className={`mh-msg ${msg.type === "ok" ? "ok" : "err"}`}>
                  <span>{msg.type === "ok" ? "✓" : "⚠️"}</span>{msg.text}
                </div>
              )}
              <div className="mh-field">
                <span className="mh-field-label">Year</span>
                <select value={year} onChange={(e) => setYear(e.target.value)}>
                  <option value="" disabled>Select year</option>
                  {years.map((y) => <option key={y} value={y}>{y}</option>)}
                </select>
              </div>
              <div className="mh-field">
                <span className="mh-field-label">Holiday Excel (.xlsx)</span>
                <label className="mh-dropzone" style={{ cursor: "pointer" }}>
                  <div className="mh-dropzone-icon">
                    <svg width="28" height="28" viewBox="0 0 24 24" fill="none"><rect width="24" height="24" rx="4" fill="#4caf50"/><text x="4" y="17" fontSize="8" fill="#fff" fontWeight="700">XLSX</text></svg>
                  </div>
                  <div>
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <span style={{ fontSize: 13, fontWeight: 600, color: "#0b3c88", border: "1px solid #c8d6ee", borderRadius: 6, padding: "4px 10px", background: "#fff" }}>Choose File</span>
                      <span className="mh-dropzone-filename">{file ? file.name : "No file chosen"}</span>
                    </div>
                    <div style={{ fontSize: 12, color: "#94a3b8", marginTop: 4 }}>Upload an Excel file with holiday list</div>
                  </div>
                  <input type="file" accept=".xlsx,.xls" onChange={(e) => setFile(e.target.files?.[0] || null)} style={{ display: "none" }} />
                </label>
              </div>
              <div className="mh-info-note">
                <span className="mh-info-note-icon">ℹ</span>
                <span>The Excel file should contain <strong>Date</strong> and <strong>Holiday Name</strong> columns.</span>
              </div>
              <button className="mh-btn-upload" onClick={handleUpload} disabled={uploading}>
                {uploading ? "Uploading…" : <><FiUploadCloud size={16} /> Upload</>}
              </button>
            </div>
          </div>
        </div>

        {/* ── Right: Calendar panel ── */}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div className="mh-cal-panel">
            {/* Top bar */}
            <div className="mh-topbar">
              <span className="mh-topbar-label"><FiCalendar size={14} /> Year</span>
              <select value={calYear} onChange={(e) => setCalYear(e.target.value)}>
                {years.map((y) => <option key={y} value={y}>{y}</option>)}
              </select>
              <button className="mh-btn-reload" onClick={() => fetchHolidays(calYear)} disabled={calLoading}>
                <span style={{ display: "inline-block", animation: calLoading ? "mh-spin .7s linear infinite" : "none" }}>↻</span>
                {calLoading ? "Loading…" : "Refresh"}
              </button>
              {totalHolidays > 0 && <div className="mh-badge"><span className="mh-badge-dot" />{totalHolidays} holidays in {calYear}</div>}
              {calError && <span style={{ color: "#d32f2f", fontSize: 13 }}>⚠️ {calError}</span>}
              <div className="mh-legend">
                <span className="mh-legend-item"><span className="mh-legend-swatch" style={{ background: "#fff1f2", border: "1.5px solid #fca5a5" }} />Holiday</span>
                <span className="mh-legend-item"><span className="mh-legend-swatch" style={{ background: "#0b3c88", border: "none" }} />Today</span>
              </div>
            </div>

            {calLoading ? (
              <div className="mh-loading">
                <div className="mh-loading-spinner" />
                <div>Loading holiday calendar…</div>
              </div>
            ) : (
              <>
                {/* Month nav */}
                <div className="mh-month-nav">
                  <button className="mh-nav-btn" onClick={prevMonth} disabled={!canPrev}>‹</button>
                  <span className="mh-month-nav-title">{MONTHS[viewMonth]} {calYear}</span>
                  <button className="mh-nav-btn" onClick={nextMonth} disabled={!canNext}>›</button>
                </div>
                {/* Calendar body */}
                <div className="mh-cal-body">
                  <MonthCalendar year={Number(calYear)} month={viewMonth} monthName={MONTHS[viewMonth]} holidayMap={holidayMap} todayStr={todayStr} />
                </div>
                {/* Footer legend */}
                <div className="mh-cal-footer">
                  <span className="mh-cal-footer-item"><span className="mh-cal-footer-dot" style={{ background: "#fca5a5" }} />Holidays are highlighted in pink</span>
                  <span className="mh-cal-footer-item"><span className="mh-cal-footer-dot" style={{ background: "#0b3c88" }} />Today is highlighted in blue</span>
                </div>
                {/* Dot nav */}
                <div className="mh-dot-nav">
                  {MONTHS.map((mn, m) => (
                    <button key={m} onClick={() => setViewMonth(m)} title={mn} style={{ width: viewMonth === m ? 20 : 8, height: 8, borderRadius: 999, border: "none", background: viewMonth === m ? "#0b3c88" : "#dbe5f1", cursor: "pointer", padding: 0, transition: "all .2s" }} />
                  ))}
                </div>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function MonthCalendar({ year, month, holidayMap, todayStr }) {
  const firstDay = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const cells = [];
  for (let i = 0; i < firstDay; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(d);

  return (
    <>
      <div className="mh-day-headers">
        {WEEKDAYS.map((d) => <div key={d} className="mh-day-hdr">{d}</div>)}
      </div>
      <div className="mh-days">
        {cells.map((day, idx) => {
          if (!day) return <div key={`b${idx}`} className="mh-cell blank" />;
          const dateStr = `${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
          const names = holidayMap[dateStr] || [];
          const isHoliday = names.length > 0;
          const isToday = dateStr === todayStr;
          const displayNames = names.filter((n) => !DAY_NAMES.has(n));
          const label = displayNames.length ? displayNames[0] : (names[0] || "");
          return (
            <div key={day} className={`mh-cell${isToday ? " today" : ""}${isHoliday ? " holiday" : ""}`}>
              <span className="mh-cell-day">{day}</span>
              {isHoliday && label && <span className="mh-cell-name">{label}</span>}
              {isHoliday && <span className="mh-dot" />}
            </div>
          );
        })}
      </div>
    </>
  );
}
