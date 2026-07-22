import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { FiUploadCloud, FiRefreshCw, FiSearch, FiX, FiClock, FiEdit2 } from "react-icons/fi";
import { getToken } from "../../api/auth";
import { useData } from "../../data/DataContext";
import * as projectsApi from "../../api/projects";
import { ENDPOINTS } from "../../api/endpoint";

// Resource service — same host/port as Holidays, Resource and Attendance.
const API_BASE = "http://10.1.131.199:8019";

/* ─────────────────────────────────────────────────────────────────────
   API response handling

   Every call on this page funnels through these so the user sees a
   sentence they can act on instead of "Failed to fetch" or a bare 500.
   A failure is always described as { title, detail, issues[] }:
     title   what went wrong, in one short phrase
     detail  why, and what to do about it
     issues  per-row / per-field messages the service listed, if any
   ───────────────────────────────────────────────────────────────────── */

// Read a response body once, as JSON when possible and raw text otherwise.
// Callers need the body on both the success and failure paths, and a body
// can only be consumed once, so this always runs before any branching.
async function readBody(res) {
  const text = await res.text().catch(() => "");
  if (!text) return null;
  try { return JSON.parse(text); } catch { return text; }
}

// Dig the service's own explanation out of an error body. Backends here
// have shipped `message`, `error`, `detail` and `errors[]` at various
// times, so accept all of them rather than betting on one.
function messageFromBody(body) {
  if (!body) return "";
  if (typeof body === "string") return body.trim().slice(0, 300);
  if (typeof body !== "object") return String(body);
  const direct = body.message || body.error || body.detail || body.errorMessage || body.msg;
  if (typeof direct === "string" && direct.trim()) return direct.trim();
  return "";
}

// Row/field-level problems, when the service itemizes them.
function issuesFromBody(body) {
  if (!body || typeof body !== "object") return [];
  const raw = body.errors || body.issues || body.failures || body.rejectedRows;
  if (!Array.isArray(raw)) return [];
  return raw
    .map((e) => {
      if (typeof e === "string") return e;
      if (!e || typeof e !== "object") return "";
      const where = e.row != null ? `Row ${e.row}` : e.field || e.resId || "";
      const what = e.message || e.error || e.reason || "";
      return [where, what].filter(Boolean).join(": ");
    })
    .filter(Boolean)
    .slice(0, 25);
}

// What a status code means in this app's terms. The service's own message
// wins when it sent one — this is the fallback that keeps a bare 403 or
// 500 from reaching the user as a number.
function reasonForStatus(status) {
  if (status === 400) return "The request was rejected as invalid. Check the values and try again.";
  if (status === 401) return "Your session has expired. Sign in again to continue.";
  if (status === 403) return "You don't have permission to do this.";
  if (status === 404) return "The record no longer exists — it may have been removed.";
  if (status === 409) return "This conflicts with a record that already exists.";
  if (status === 413) return "The file is too large for the server to accept.";
  if (status === 415) return "That file type isn't supported. Upload an .xlsx workbook.";
  if (status === 422) return "The file was read but its contents were rejected. Check the column headers and values.";
  if (status === 429) return "Too many requests. Wait a moment and try again.";
  if (status >= 500) return "The resource service hit an error. Try again shortly, and contact support if it persists.";
  return `The server responded with status ${status}.`;
}

// A non-2xx response → something displayable.
function describeHttpFailure(title, status, body) {
  return {
    title,
    detail: messageFromBody(body) || reasonForStatus(status),
    status,
    issues: issuesFromBody(body),
  };
}

// A thrown fetch (DNS, CORS, offline, connection reset) has no status and
// a message — "Failed to fetch" — that tells the user nothing.
function describeNetworkFailure(title, err) {
  const isOffline = typeof navigator !== "undefined" && navigator.onLine === false;
  return {
    title,
    detail: isOffline
      ? "You appear to be offline. Reconnect and try again."
      : "Couldn't reach the resource service. It may be down, or your network may be blocking it.",
    status: null,
    issues: err?.message ? [err.message] : [],
  };
}

// ---------- formatting helpers ----------
const money = new Intl.NumberFormat("en-IN", {
  style: "currency",
  currency: "INR",
  maximumFractionDigits: 0,
});
const formatMoney = (v) => (v == null || v === "" ? "—" : money.format(Number(v)));

const formatDate = (v) => {
  if (!v) return "—";
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return v;
  return d.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
};

// <input type="date"> only accepts yyyy-MM-dd. The API returns that already,
// but tolerate a full ISO timestamp so an edit never silently drops a date.
const toDateInput = (v) => (v ? String(v).slice(0, 10) : "");

const initialsOf = (name) => {
  const parts = String(name || "").trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return "?";
  return (parts[0][0] + (parts[1]?.[0] || "")).toUpperCase();
};
const AVATAR_COLORS = [
  { bg: "#e6eefb", fg: "#0b3c88" },
  { bg: "#e7f7ee", fg: "#0f7a45" },
  { bg: "#fdeede", fg: "#b45309" },
  { bg: "#f0e9fb", fg: "#6d3bbf" },
  { bg: "#fde8ec", fg: "#c02757" },
  { bg: "#e2f4f6", fg: "#0d7a86" },
];
const avatarColor = (name) => {
  const s = String(name || "");
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return AVATAR_COLORS[h % AVATAR_COLORS.length];
};

// rateYear comes back as the key itself ("Year-1"), but older rows have
// shipped a bare number — accept both when picking the in-force rate.
const currentRateOf = (r) => {
  const map = r?.rateCardByYear;
  if (!map) return null;
  const key = String(r.rateYear ?? "");
  if (!key) return null;
  return map[key] ?? map[`Year-${key}`] ?? null;
};

const yearKeyOrder = (a, b) =>
  (parseInt(String(a).replace(/\D+/g, ""), 10) || 0) -
  (parseInt(String(b).replace(/\D+/g, ""), 10) || 0);

const EMPTY_FILTERS = {
  projectId: "",
  resId: "",
  name: "",
  designationType: "",
  active: "",
  joinedFrom: "",
  joinedTo: "",
};

const STYLES = `
.mr { font-family: inherit; color: #334155; }

/* ── upload card ── */
.mr-upload-card {
  background: #fff; border: 1px solid #e2e8f0; border-radius: 14px;
  box-shadow: 0 2px 10px rgba(11,60,136,.06); overflow: hidden; margin-bottom: 18px;
}
.mr-upload-card-head { padding: 20px 20px 16px; border-bottom: 1px solid #f1f5fb; display: flex; align-items: center; gap: 14px; }
.mr-upload-icon-wrap { width: 46px; height: 46px; border-radius: 12px; background: #eef3fb; display: flex; align-items: center; justify-content: center; flex-shrink: 0; color: #0b3c88; }
.mr-upload-card-title { font-size: 16px; font-weight: 800; color: #1e2a3a; margin: 0 0 2px; }
.mr-upload-card-sub { font-size: 12.5px; color: #64748b; margin: 0; }
.mr-upload-body { padding: 20px; }
.mr-upload-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; margin-bottom: 16px; }
.mr-field { display: flex; flex-direction: column; gap: 6px; }
.mr-field-label { font-size: 12.5px; font-weight: 600; color: #64748b; }
.mr-field select, .mr-field input {
  width: 100%; border: 1px solid #e2e8f0; border-radius: 9px; padding: 10px 12px;
  font-size: 14px; background: #fff; color: #1e2a3a; font-family: inherit; outline: none;
  box-sizing: border-box; height: 42px;
  /* The app is light-only. Without this, a browser/OS in dark mode paints
     the native dropdown list and date picker in its own dark palette. */
  color-scheme: light;
}
/* Custom chevron so every picker matches, instead of each platform's own
   arrow glyph. Padding-right clears the arrow; the swatch is an inline SVG
   so there's no external asset to load. */
.mr-field select {
  cursor: pointer; appearance: none; -webkit-appearance: none; -moz-appearance: none;
  padding-right: 34px;
  background-image: url("data:image/svg+xml;charset=utf-8,%3Csvg xmlns='http://www.w3.org/2000/svg' width='14' height='14' viewBox='0 0 24 24' fill='none' stroke='%2364748b' stroke-width='2.5' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='m6 9 6 6 6-6'/%3E%3C/svg%3E");
  background-repeat: no-repeat;
  background-position: right 12px center;
  text-overflow: ellipsis;
}
.mr-field select:hover:not(:disabled) { border-color: #c8d6ee; }
/* A picker still waiting on its data reads as "busy", not as "broken" —
   keep the white background so it stays distinct from a genuinely
   unavailable field, and swap the chevron for a wait cursor. */
.mr-field select.is-loading {
  background-color: #fff; color: #64748b; cursor: progress;
  background-image: none;
}
/* Inline spinner sitting next to a field label while its options load. */
.mr-spinner {
  display: inline-block; width: 11px; height: 11px; vertical-align: -1px;
  margin-left: 6px; border-radius: 50%;
  border: 2px solid #c8d6ee; border-top-color: #0b3c88;
  animation: mr-spin .7s linear infinite;
}
.mr-field select:focus, .mr-field input:focus { border-color: #0b3c88; box-shadow: 0 0 0 3px #eef3fb; }
.mr-field select:disabled {
  background-color: #f7f9fd; color: #94a3b8; cursor: not-allowed;
  background-image: url("data:image/svg+xml;charset=utf-8,%3Csvg xmlns='http://www.w3.org/2000/svg' width='14' height='14' viewBox='0 0 24 24' fill='none' stroke='%23cbd5e1' stroke-width='2.5' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='m6 9 6 6 6-6'/%3E%3C/svg%3E");
}
/* Long designation names would otherwise stretch the filter column. */
.mr-field select option { color: #1e2a3a; background: #fff; }
.mr-dropzone {
  border: 2px dashed #c8d6ee; border-radius: 10px; padding: 16px;
  display: flex; align-items: center; gap: 14px; cursor: pointer; transition: border-color .15s;
  background: #f8fbff; margin-bottom: 16px;
}
.mr-dropzone:hover { border-color: #0b3c88; }
.mr-dropzone[aria-disabled="true"] { opacity: .6; cursor: not-allowed; }
.mr-dropzone-icon { width: 44px; height: 44px; background: #e8f5e9; border-radius: 8px; display: flex; align-items: center; justify-content: center; flex-shrink: 0; font-size: 22px; }
.mr-dropzone-text { font-size: 13px; color: #64748b; flex: 1; }
.mr-dropzone-filename { font-size: 13px; font-weight: 600; color: #1e2a3a; }
.mr-info-note {
  display: flex; align-items: flex-start; gap: 10px; background: #f0f6ff;
  border: 1px solid #c8d6ee; border-radius: 9px; padding: 11px 14px;
  font-size: 12.5px; color: #334155; margin-bottom: 16px; line-height: 1.5;
}
.mr-btn-upload {
  display: flex; align-items: center; justify-content: center; gap: 8px; width: 100%;
  border-radius: 10px; font-size: 14px; font-weight: 700; padding: 12px;
  cursor: pointer; border: none; background: #0b3c88; color: #fff; font-family: inherit;
  box-shadow: 0 2px 6px rgba(11,60,136,.25); transition: background .15s;
}
.mr-btn-upload:hover:not(:disabled) { background: #062a63; }
.mr-btn-upload:disabled { opacity: .55; cursor: not-allowed; }
/* ── result banner ──
   One structure for every API outcome on this page: an icon, a one-line
   title, a sentence of detail, optional stat tiles and an itemized list. */
.mr-banner {
  display: flex; gap: 12px; align-items: flex-start;
  border: 1px solid; border-radius: 12px; padding: 14px 16px; margin-bottom: 16px;
}
.mr-banner--ok { background: #e6f6ee; border-color: #c7ead6; }
.mr-banner--warn { background: #fef6e7; border-color: #f2ddab; }
.mr-banner--err { background: #fdecec; border-color: #f5c9c9; }
.mr-banner-ic {
  width: 24px; height: 24px; border-radius: 7px; flex-shrink: 0;
  display: flex; align-items: center; justify-content: center;
  font-size: 13px; font-weight: 700; color: #fff;
}
.mr-banner--ok .mr-banner-ic { background: #0f9d58; }
.mr-banner--warn .mr-banner-ic { background: #b45309; }
.mr-banner--err .mr-banner-ic { background: #dc2626; }
.mr-banner-body { flex: 1; min-width: 0; }
.mr-banner-title { font-size: 14px; font-weight: 700; color: #1e2a3a; }
.mr-banner-detail { font-size: 13px; color: #475569; margin-top: 3px; line-height: 1.5; }
.mr-banner-status {
  font-size: 11px; font-weight: 700; color: #64748b; background: rgba(255,255,255,.7);
  border: 1px solid rgba(15,28,51,.1); border-radius: 999px; padding: 1px 8px; margin-left: 8px;
  vertical-align: 1px; font-variant-numeric: tabular-nums;
}
.mr-banner-stats { display: flex; gap: 8px; flex-wrap: wrap; margin-top: 12px; }
.mr-banner-stat {
  background: rgba(255,255,255,.75); border: 1px solid rgba(15,28,51,.08);
  border-radius: 9px; padding: 7px 13px; min-width: 92px;
}
.mr-banner-stat b { display: block; font-size: 18px; color: #1e2a3a; font-variant-numeric: tabular-nums; line-height: 1.2; }
.mr-banner-stat span { font-size: 11px; font-weight: 600; color: #64748b; }
.mr-banner-list {
  margin: 10px 0 0; padding: 0 0 0 18px; font-size: 12.5px; color: #475569;
  line-height: 1.6; max-height: 132px; overflow-y: auto;
}
.mr-banner-more { font-size: 12px; color: #64748b; margin-top: 6px; font-style: italic; }
.mr-banner-x {
  border: none; background: transparent; color: #94a3b8; cursor: pointer;
  font-size: 15px; line-height: 1; padding: 2px 4px; border-radius: 5px; flex-shrink: 0;
}
.mr-banner-x:hover { color: #1e2a3a; background: rgba(255,255,255,.6); }
.mr-banner-actions { margin-top: 12px; display: flex; gap: 8px; flex-wrap: wrap; }

/* ── panel ── */
.mr-panel { background: #fff; border: 1px solid #e2e8f0; border-radius: 14px; box-shadow: 0 2px 10px rgba(11,60,136,.06); overflow: hidden; }
.mr-topbar { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; padding: 14px 18px; border-bottom: 1px solid #f1f5fb; }
.mr-topbar-title { font-size: 15px; font-weight: 800; color: #1e2a3a; margin: 0; }
.mr-badge { display: inline-flex; align-items: center; gap: 6px; padding: 5px 12px; border-radius: 999px; background: #eef3fb; font-size: 13px; font-weight: 700; color: #0b3c88; }
.mr-topbar-right { margin-left: auto; display: flex; gap: 10px; flex-wrap: wrap; }
.mr-btn-reload {
  display: inline-flex; align-items: center; gap: 6px; height: 36px; padding: 0 14px;
  border-radius: 8px; border: 1px solid #e2e8f0; background: #fff; font-size: 13px;
  font-weight: 600; color: #334155; cursor: pointer; font-family: inherit; transition: background .15s;
}
.mr-btn-reload:hover:not(:disabled) { background: #f8fbff; }
.mr-btn-reload:disabled { opacity: .55; cursor: not-allowed; }
.mr-btn-apply {
  display: inline-flex; align-items: center; gap: 6px; height: 36px; padding: 0 16px;
  border-radius: 8px; border: none; background: #0b3c88; color: #fff; font-size: 13px;
  font-weight: 700; cursor: pointer; font-family: inherit; transition: background .15s;
}
.mr-btn-apply:hover:not(:disabled) { background: #062a63; }
.mr-btn-apply:disabled { opacity: .55; cursor: not-allowed; }

/* ── filters ── */
.mr-filters { padding: 16px 18px; border-bottom: 1px solid #f1f5fb; background: #fbfcfe; }
.mr-filter-grid {
  display: grid; gap: 12px; margin-bottom: 12px;
  grid-template-columns: repeat(auto-fit, minmax(170px, 1fr));
}
.mr-filter-actions { display: flex; gap: 10px; flex-wrap: wrap; align-items: center; }
.mr-filter-hint { font-size: 12px; color: #94a3b8; margin-left: auto; }

/* ── rate-card year chips ── */
.mr-years { display: flex; gap: 6px; flex-wrap: wrap; padding: 12px 18px; border-bottom: 1px solid #f1f5fb; align-items: center; }
.mr-years-label { font-size: 12px; font-weight: 700; color: #64748b; text-transform: uppercase; letter-spacing: .05em; margin-right: 4px; }
.mr-year-chip { font-size: 12px; font-weight: 700; color: #0b3c88; background: #eef3fb; border-radius: 999px; padding: 4px 11px; }

/* ── table ── */
.mr-scroll { overflow-x: auto; }
.mr-table { width: 100%; border-collapse: collapse; font-size: 14px; }
.mr-th {
  position: sticky; top: 0; background: #f7f9fd; color: #64748b; text-align: left;
  font-size: 11.5px; font-weight: 700; letter-spacing: .05em; text-transform: uppercase;
  padding: 13px 16px; border-bottom: 1px solid #e6ecf3; white-space: nowrap; z-index: 1;
}
.mr-th[data-align="right"] { text-align: right; }
.mr-th[data-align="center"] { text-align: center; }
.mr-row { border-bottom: 1px solid #eef2f7; cursor: pointer; transition: background .16s, box-shadow .16s; }
.mr-row:last-child { border-bottom: none; }
.mr-row:hover { background: #f7f9fd; box-shadow: inset 3px 0 0 #0b3c88; }
.mr-td { padding: 12px 16px; vertical-align: middle; color: #0f1c33; }
.mr-td[data-align="right"] { text-align: right; font-variant-numeric: tabular-nums; }
.mr-td[data-align="center"] { text-align: center; }
.mr-id { font-size: 12.5px; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; background: #eef2f7; padding: 3px 7px; border-radius: 5px; color: #334155; }
.mr-person { display: flex; align-items: center; gap: 11px; }
.mr-avatar { width: 34px; height: 34px; border-radius: 9px; flex-shrink: 0; display: flex; align-items: center; justify-content: center; font-size: 12.5px; font-weight: 700; }
.mr-name { font-weight: 600; color: #0f1c33; }
.mr-sub { color: #64748b; font-size: 12.5px; margin-top: 1px; }
.mr-pill { display: inline-flex; align-items: center; gap: 6px; font-size: 12px; font-weight: 600; padding: 4px 12px; border-radius: 999px; }
.mr-dot { width: 7px; height: 7px; border-radius: 50%; background: currentColor; }
.mr-pill--on { background: #e7f7ee; color: #0f9d58; }
.mr-pill--off { background: #eef2f7; color: #64748b; }

/* ── states ── */
.mr-empty { text-align: center; padding: 60px 24px; }
.mr-empty-emoji { font-size: 42px; margin-bottom: 14px; opacity: .55; }
.mr-empty h3 { font-size: 16px; font-weight: 700; color: #0f1c33; margin: 0 0 8px; }
.mr-empty p { color: #64748b; font-size: 14px; max-width: 420px; margin: 0 auto; line-height: 1.5; }
.mr-skel-bar { height: 12px; border-radius: 6px; background: linear-gradient(90deg, #eef2f7 25%, #e2e8f2 37%, #eef2f7 63%); background-size: 400% 100%; animation: mr-skel 1.3s ease infinite; }

/* ── drawer ── */
.mr-scrim {
  position: fixed; inset: 0; background: rgba(11,42,99,.42); backdrop-filter: blur(2px);
  display: flex; justify-content: flex-end; z-index: 1000; animation: mr-fade .15s ease;
}
.mr-drawer {
  width: min(500px, 100%); height: 100%; background: #fff;
  display: flex; flex-direction: column; box-shadow: -18px 0 48px rgba(11,23,42,.18);
  animation: mr-slide .24s cubic-bezier(.2,.8,.2,1);
}
.mr-drawer-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 16px; padding: 22px 24px; border-bottom: 1px solid #e6ecf3; }
.mr-drawer-eyebrow { font-size: 12px; font-weight: 700; letter-spacing: .09em; text-transform: uppercase; color: #0b3c88; }
.mr-drawer-head h2 { margin: 2px 0 0; font-size: 20px; font-weight: 700; letter-spacing: -.01em; color: #0f1c33; }
.mr-close {
  border: none; background: #eef2f7; color: #64748b; width: 30px; height: 30px;
  border-radius: 8px; cursor: pointer; font-size: 17px; line-height: 1; display: flex;
  align-items: center; justify-content: center; transition: background .18s, color .18s; flex-shrink: 0;
}
.mr-close:hover:not(:disabled) { background: #e3e7ef; color: #0f1c33; }
.mr-close:disabled { opacity: .5; cursor: not-allowed; }
.mr-tab:disabled { opacity: .45; cursor: not-allowed; }
.mr-tabs { display: flex; gap: 4px; padding: 0 24px; border-bottom: 1px solid #e6ecf3; }
.mr-tab {
  border: none; background: transparent; font-family: inherit; font-size: 13.5px; font-weight: 600;
  color: #64748b; padding: 12px 4px; margin-right: 18px; cursor: pointer;
  border-bottom: 2px solid transparent; transition: color .15s, border-color .15s;
}
.mr-tab:hover { color: #0f1c33; }
.mr-tab.active { color: #0b3c88; border-bottom-color: #0b3c88; }
.mr-drawer-body { padding: 22px 24px; overflow-y: auto; flex: 1; }
.mr-drawer-foot { display: flex; justify-content: flex-end; gap: 10px; padding: 16px 24px; border-top: 1px solid #e6ecf3; background: #f7f9fd; }
.mr-btn-ghost {
  display: inline-flex; align-items: center; gap: 7px; border: 1px solid #e2e8f0;
  background: #fff; color: #0f1c33; border-radius: 9px; font-size: 13.5px; font-weight: 600;
  padding: 10px 16px; cursor: pointer; font-family: inherit; transition: background .15s;
}
.mr-btn-ghost:hover:not(:disabled) { background: #f7f9fd; }
.mr-btn-ghost:disabled { opacity: .55; cursor: not-allowed; }
.mr-btn-primary {
  display: inline-flex; align-items: center; gap: 7px; border: none;
  background: #0b3c88; color: #fff; border-radius: 9px; font-size: 13.5px; font-weight: 700;
  padding: 10px 18px; cursor: pointer; font-family: inherit; transition: background .15s;
  box-shadow: 0 2px 6px rgba(11,60,136,.22);
}
.mr-btn-primary:hover:not(:disabled) { background: #062a63; }
.mr-btn-primary:disabled { opacity: .55; cursor: not-allowed; }

/* ── edit form ── */
.mr-form { display: flex; flex-direction: column; gap: 15px; }
.mr-grid-2 { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; }
.mr-readonly {
  display: flex; align-items: center; justify-content: space-between; gap: 16px;
  background: #f7f9fd; border: 1px solid #e6ecf3; border-radius: 10px;
  padding: 12px 14px; font-size: 13px; color: #64748b;
}
.mr-readonly b { color: #0f1c33; font-variant-numeric: tabular-nums; }
.mr-switch { display: inline-flex; align-items: center; gap: 10px; cursor: pointer; user-select: none; padding-top: 4px; }
.mr-switch input { position: absolute; opacity: 0; pointer-events: none; }
.mr-track { width: 40px; height: 22px; border-radius: 999px; background: #cbd5e1; position: relative; transition: background .2s; display: inline-block; flex-shrink: 0; }
.mr-track.on { background: #0f9d58; }
.mr-thumb { position: absolute; top: 2px; left: 2px; width: 18px; height: 18px; border-radius: 50%; background: #fff; box-shadow: 0 1px 2px rgba(0,0,0,.2); transition: left .2s; }
.mr-track.on .mr-thumb { left: 20px; }
.mr-rate-edit { display: flex; flex-direction: column; gap: 8px; }
.mr-rate-edit-row { display: grid; grid-template-columns: 1fr 1.4fr; align-items: center; gap: 12px; }
.mr-rate-edit-year { display: inline-flex; align-items: center; gap: 8px; font-size: 13.5px; font-weight: 600; color: #0f1c33; }
.mr-rate-current-tag {
  font-size: 10.5px; font-weight: 700; letter-spacing: .04em; text-transform: uppercase;
  color: #0b3c88; background: #eef3fb; border-radius: 999px; padding: 2px 7px;
}
.mr-rate-none { font-size: 13.5px; color: #64748b; background: #f7f9fd; border: 1px solid #eef2f7; border-radius: 10px; padding: 11px 13px; }
.mr-detail-row { display: flex; align-items: center; justify-content: space-between; gap: 16px; padding: 12px 2px; border-bottom: 1px solid #eef2f7; }
.mr-detail-row:last-child { border-bottom: none; }
.mr-detail-k { font-size: 13px; color: #64748b; font-weight: 600; }
.mr-detail-v { font-size: 14px; color: #0f1c33; font-weight: 600; text-align: right; word-break: break-word; font-variant-numeric: tabular-nums; }
.mr-section-label { font-size: 12px; font-weight: 700; color: #64748b; text-transform: uppercase; letter-spacing: .06em; margin: 18px 0 8px; }
.mr-rate-box { border: 1px solid #e6ecf3; border-radius: 10px; overflow: hidden; }
.mr-rate-row { display: flex; justify-content: space-between; align-items: center; padding: 9px 14px; border-bottom: 1px solid #eef2f7; }
.mr-rate-row:last-child { border-bottom: none; }
.mr-rate-row.active { background: #eef3fb; }
.mr-rate-row .yr { font-size: 13px; font-weight: 500; color: #334155; }
.mr-rate-row.active .yr { font-weight: 700; color: #0b3c88; }
.mr-rate-row .amt { font-size: 13px; font-weight: 700; color: #0f1c33; font-variant-numeric: tabular-nums; }
.mr-rate-row.active .amt { color: #0b3c88; }

/* ── history timeline ── */
.mr-stint { position: relative; padding: 0 0 22px 26px; border-left: 2px solid #e6ecf3; }
.mr-stint:last-child { border-left-color: transparent; padding-bottom: 0; }
.mr-stint::before {
  content: ""; position: absolute; left: -7px; top: 3px; width: 12px; height: 12px;
  border-radius: 50%; background: #fff; border: 2px solid #cbd5e1;
}
.mr-stint.current::before { border-color: #0f9d58; background: #0f9d58; }
.mr-stint-title { font-size: 14px; font-weight: 700; color: #0f1c33; }
.mr-stint-dates { font-size: 12.5px; color: #64748b; margin-top: 2px; }
.mr-stint-meta { display: flex; gap: 8px; flex-wrap: wrap; margin-top: 8px; }
.mr-chip { font-size: 11.5px; font-weight: 600; color: #334155; background: #f1f5fb; border: 1px solid #e2e8f0; border-radius: 999px; padding: 3px 10px; }

@keyframes mr-fade { from { opacity: 0; } to { opacity: 1; } }
@keyframes mr-slide { from { transform: translateX(28px); opacity: .5; } to { transform: translateX(0); opacity: 1; } }
@keyframes mr-spin { to { transform: rotate(360deg); } }
@keyframes mr-skel { 0% { background-position: 100% 0; } 100% { background-position: -100% 0; } }

@media (max-width: 720px) {
  .mr-upload-grid { grid-template-columns: 1fr; }
}
@media (prefers-reduced-motion: reduce) {
  .mr *, .mr *::before, .mr *::after { animation: none !important; transition: none !important; }
}
`;

export default function MasterResources() {
  // `loading` from the data context covers the vendor (organisation) fetch.
  const { vendors, loading: orgsLoading } = useData();
  const fileInputRef = useRef(null);

  // ---- project list (for both the upload card and the project filter) ----
  const [projects, setProjects] = useState([]);
  // Starts true: the fetch is kicked off on mount, so the very first render
  // is already a loading state — defaulting to false would flash "No
  // projects available" before the request settles.
  const [projectsLoading, setProjectsLoading] = useState(true);
  const [projectsFailed, setProjectsFailed] = useState(false);
  useEffect(() => {
    let active = true;
    setProjectsLoading(true);
    setProjectsFailed(false);
    projectsApi
      .listAll()
      .then((list) => {
        if (!active) return;
        setProjects(
          (Array.isArray(list) ? list : [])
            .filter((p) => p && p.projectId)
            .map((p) => ({ id: p.projectId, name: p.projectName || p.projectId }))
        );
      })
      .catch(() => {
        if (!active) return;
        setProjects([]);
        setProjectsFailed(true);
      })
      .finally(() => { if (active) setProjectsLoading(false); });
    return () => { active = false; };
  }, []);

  // Placeholder text for a picker that may be loading, empty, or broken —
  // shared so the upload card and the filter row never drift apart.
  const pickerPlaceholder = ({ loading, failed, empty, ready, emptyText, failedText }) =>
    loading ? "Loading…" : failed ? failedText : empty ? emptyText : ready;

  // ---- upload form ----
  const [upProjectId, setUpProjectId] = useState("");
  const [upOrgId, setUpOrgId] = useState("");
  const [upFile, setUpFile] = useState(null);
  const [uploading, setUploading] = useState(false);
  const [uploadMsg, setUploadMsg] = useState(null); // { ok, text }

  // Organisations are scoped to the chosen project via the vendor master's
  // projectIds mapping. Falls back to the full vendor list when the mapping
  // is unavailable, so the picker is never empty for a valid project.
  const uploadOrgs = useMemo(() => {
    const all = (Array.isArray(vendors) ? vendors : [])
      .filter((v) => v && v.vendorId)
      .map((v) => ({ id: v.vendorId, name: v.vendorName || v.vendorId, projectIds: v.projectIds || [] }));
    if (!upProjectId) return all;
    const scoped = all.filter((v) => v.projectIds.includes(upProjectId));
    return scoped.length ? scoped : all;
  }, [vendors, upProjectId]);

  // Keep the org selection valid when the project (and therefore the org
  // list) changes.
  useEffect(() => {
    if (upOrgId && !uploadOrgs.some((o) => o.id === upOrgId)) setUpOrgId("");
  }, [uploadOrgs, upOrgId]);

  // ---- filters + results ----
  // `draft` is what the inputs bind to; `applied` is what was last sent to
  // the server. Keeping them apart means typing doesn't fire a request per
  // keystroke against a filter set the API evaluates as exact matches.
  const [draft, setDraft] = useState(EMPTY_FILTERS);
  const [applied, setApplied] = useState(EMPTY_FILTERS);
  const [resources, setResources] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(null);

  const [rateYears, setRateYears] = useState([]);
  const [viewingId, setViewingId] = useState(null);

  const loadResources = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const token = getToken();
      const res = await fetch(`${API_BASE}${ENDPOINTS.resources.list(applied)}`, {
        headers: { accept: "*/*", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      });
      const data = await readBody(res);
      if (!res.ok) {
        setLoadError(describeHttpFailure("Couldn't load the registry", res.status, data));
        setResources([]);
        return;
      }
      setResources(Array.isArray(data) ? data : data ? [data] : []);
    } catch (e) {
      setLoadError(describeNetworkFailure("Couldn't load the registry", e));
      setResources([]);
    } finally {
      setLoading(false);
    }
  }, [applied]);

  useEffect(() => { loadResources(); }, [loadResources]);

  // Distinct rate-card years across the project's active resources — only
  // meaningful once a single project is in scope.
  useEffect(() => {
    const pid = applied.projectId;
    if (!pid) { setRateYears([]); return; }
    let active = true;
    (async () => {
      try {
        const token = getToken();
        const res = await fetch(`${API_BASE}${ENDPOINTS.resources.rateCards(pid)}`, {
          headers: { accept: "*/*", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        });
        if (!res.ok) throw new Error(String(res.status));
        const data = await res.json();
        if (active) setRateYears(Array.isArray(data) ? [...data].sort(yearKeyOrder) : []);
      } catch {
        // Purely informational — a failure just hides the chip row.
        if (active) setRateYears([]);
      }
    })();
    return () => { active = false; };
  }, [applied.projectId]);

  // ---- upload: POST /api/resources/upload ----
  async function doUpload() {
    if (!upFile || !upProjectId || !upOrgId) return;
    setUploading(true);
    setUploadMsg(null);

    const formData = new FormData();
    formData.append("file", upFile);

    try {
      const token = getToken();
      const res = await fetch(
        `${API_BASE}${ENDPOINTS.resources.upload(upProjectId, upOrgId)}`,
        {
          method: "POST",
          headers: { accept: "*/*", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
          body: formData,
        }
      );

      // Read the body either way — success carries the row counts, failure
      // carries the server's explanation.
      const data = await readBody(res);

      if (!res.ok) {
        setUploadMsg({
          tone: "err",
          ...describeHttpFailure("Upload failed", res.status, data),
        });
        return;
      }

      const totalRows = data?.totalRows;
      const stored = data?.resourcesStored;
      const skipped =
        Number.isFinite(totalRows) && Number.isFinite(stored) ? totalRows - stored : 0;
      const stats = [];
      if (Number.isFinite(totalRows)) stats.push({ label: "Rows read", value: totalRows });
      if (Number.isFinite(stored)) stats.push({ label: "Resources stored", value: stored });
      if (skipped > 0) stats.push({ label: "Skipped", value: skipped });

      // A partial import is not a success — the user needs to know rows
      // fell out, or they'll assume the whole workbook landed.
      setUploadMsg({
        tone: skipped > 0 ? "warn" : "ok",
        title: skipped > 0 ? "Imported with skipped rows" : "Import complete",
        detail:
          skipped > 0
            ? `${stored} of ${totalRows} rows were stored. The rest were skipped — usually a missing Resource ID, or a designation with no rate card for this project and organisation.`
            : "Every row in the workbook was stored. The registry below now shows this project.",
        stats,
        issues: issuesFromBody(data),
      });
      setUpFile(null);
      // Show the freshly imported rows: scope the table to the project that
      // was just uploaded against.
      const next = { ...EMPTY_FILTERS, projectId: upProjectId };
      setDraft(next);
      setApplied(next);
    } catch (err) {
      setUploadMsg({ tone: "err", ...describeNetworkFailure("Upload failed", err) });
    } finally {
      setUploading(false);
    }
  }

  const projectName = (id) => projects.find((p) => p.id === id)?.name || id || "—";

  // Designation choices for the filter — the API matches exactly, so the
  // picker offers real values rather than free text. The catalog only ever
  // grows: filtering down to one designation must not empty the dropdown
  // and strand the user on that selection.
  const [designationOptions, setDesignationOptions] = useState([]);
  useEffect(() => {
    const seen = resources.map((r) => r.designationType).filter(Boolean);
    if (!seen.length) return;
    setDesignationOptions((prev) => {
      const merged = [...new Set([...prev, ...seen])].sort();
      return merged.length === prev.length ? prev : merged;
    });
  }, [resources]);

  const total = resources.length;
  const activeCount = resources.filter((r) => r.active).length;
  const filtersDirty = JSON.stringify(draft) !== JSON.stringify(applied);
  const hasFilters = Object.values(applied).some(Boolean);
  const canUpload = !!upFile && !!upProjectId && !!upOrgId && !uploading;

  const setField = (k) => (e) => setDraft((f) => ({ ...f, [k]: e.target.value }));

  return (
    <div className="mr">
      <style>{STYLES}</style>
      <p className="uidai-pmis-subtitle">
        Import the resource master for a project and organisation, then search
        every resource record and its employment history.
      </p>

      {/* ── Upload card ── */}
      <div className="mr-upload-card">
        <div className="mr-upload-card-head">
          <div className="mr-upload-icon-wrap">
            <FiUploadCloud size={22} />
          </div>
          <div>
            <h3 className="mr-upload-card-title">Upload Resource Data</h3>
            <p className="mr-upload-card-sub">
              Bulk-import resources from an Excel workbook (.xlsx).
            </p>
          </div>
        </div>

        <div className="mr-upload-body">
          {uploadMsg && (
            <ResultBanner {...uploadMsg} onDismiss={() => setUploadMsg(null)} />
          )}

          <div className="mr-upload-grid">
            <label className="mr-field">
              <span className="mr-field-label">
                Project * {projectsLoading && <Spinner />}
              </span>
              <select
                value={upProjectId}
                onChange={(e) => setUpProjectId(e.target.value)}
                disabled={projectsLoading || projects.length === 0}
                className={projectsLoading ? "is-loading" : undefined}
              >
                <option value="">
                  {pickerPlaceholder({
                    loading: projectsLoading,
                    failed: projectsFailed,
                    empty: projects.length === 0,
                    ready: "Select a project…",
                    emptyText: "No projects available",
                    failedText: "Couldn't load projects",
                  })}
                </option>
                {projects.map((p) => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
              </select>
            </label>
            <label className="mr-field">
              <span className="mr-field-label">
                Organisation * {upProjectId && orgsLoading && <Spinner />}
              </span>
              <select
                value={upOrgId}
                onChange={(e) => setUpOrgId(e.target.value)}
                disabled={!upProjectId || orgsLoading}
                className={upProjectId && orgsLoading ? "is-loading" : undefined}
              >
                <option value="">
                  {!upProjectId
                    ? "Pick a project first"
                    : pickerPlaceholder({
                        loading: orgsLoading,
                        failed: false,
                        empty: uploadOrgs.length === 0,
                        ready: "Select an organisation…",
                        emptyText: "No organisation available",
                      })}
                </option>
                {uploadOrgs.map((o) => (
                  <option key={o.id} value={o.id}>{o.name}</option>
                ))}
              </select>
            </label>
          </div>

          <div
            className="mr-dropzone"
            aria-disabled={!upProjectId || !upOrgId}
            onClick={() => upProjectId && upOrgId && fileInputRef.current?.click()}
          >
            <div className="mr-dropzone-icon">📄</div>
            <div className="mr-dropzone-text">
              {upFile ? (
                <span className="mr-dropzone-filename">{upFile.name}</span>
              ) : (
                <>Click to choose an .xlsx file<br />with the resource records.</>
              )}
            </div>
            {upFile && (
              <button
                className="mr-close"
                onClick={(e) => { e.stopPropagation(); setUpFile(null); }}
                aria-label="Clear selected file"
              >
                <FiX size={15} />
              </button>
            )}
          </div>
          <input
            ref={fileInputRef}
            type="file"
            accept=".xlsx,.xls,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
            onChange={(e) => {
              setUpFile(e.target.files?.[0] || null);
              setUploadMsg(null);
              e.target.value = ""; // allow re-picking the same file
            }}
            style={{ display: "none" }}
          />

          <div className="mr-info-note">
            <span>ℹ️</span>
            <span>
              Rows are matched on Resource ID — an existing resource is updated
              in place, and a new one is created otherwise. Rates come from the
              designation rate card already uploaded for this project and
              organisation.
            </span>
          </div>

          <button className="mr-btn-upload" onClick={doUpload} disabled={!canUpload}>
            <FiUploadCloud size={17} />
            {uploading ? "Uploading…" : "Upload Resource File"}
          </button>
        </div>
      </div>

      {/* ── Resource registry ── */}
      <div className="mr-panel">
        <div className="mr-topbar">
          <h3 className="mr-topbar-title">Resource Registry</h3>
          <span className="mr-badge">{total} record{total === 1 ? "" : "s"}</span>
          {total > 0 && (
            <span className="mr-badge" style={{ background: "#e7f7ee", color: "#0f9d58" }}>
              {activeCount} active
            </span>
          )}
          <div className="mr-topbar-right">
            <button className="mr-btn-reload" onClick={loadResources} disabled={loading}>
              <FiRefreshCw size={14} style={loading ? { animation: "mr-spin 1s linear infinite" } : undefined} />
              Refresh
            </button>
          </div>
        </div>

        <div className="mr-filters">
          <div className="mr-filter-grid">
            <label className="mr-field">
              <span className="mr-field-label">
                Project {projectsLoading && <Spinner />}
              </span>
              <select
                value={draft.projectId}
                onChange={setField("projectId")}
                disabled={projectsLoading}
                className={projectsLoading ? "is-loading" : undefined}
              >
                <option value="">
                  {projectsLoading ? "Loading projects…" : "All projects"}
                </option>
                {projects.map((p) => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
              </select>
            </label>
            <label className="mr-field">
              <span className="mr-field-label">Resource ID</span>
              <input value={draft.resId} onChange={setField("resId")} placeholder="e.g. 421" />
            </label>
            <label className="mr-field">
              <span className="mr-field-label">Name</span>
              <input value={draft.name} onChange={setField("name")} placeholder="Contains…" />
            </label>
            <label className="mr-field">
              <span className="mr-field-label">Designation</span>
              <select
                value={draft.designationType}
                onChange={setField("designationType")}
                disabled={designationOptions.length === 0}
              >
                <option value="">All designations</option>
                {designationOptions.map((d) => (
                  <option key={d} value={d}>{d}</option>
                ))}
              </select>
            </label>
            <label className="mr-field">
              <span className="mr-field-label">Status</span>
              <select value={draft.active} onChange={setField("active")}>
                <option value="">Any</option>
                <option value="true">Active</option>
                <option value="false">Inactive</option>
              </select>
            </label>
            <label className="mr-field">
              <span className="mr-field-label">Joined from</span>
              <input type="date" value={draft.joinedFrom} onChange={setField("joinedFrom")} />
            </label>
            <label className="mr-field">
              <span className="mr-field-label">Joined to</span>
              <input type="date" value={draft.joinedTo} onChange={setField("joinedTo")} />
            </label>
          </div>
          <div className="mr-filter-actions">
            <button
              className="mr-btn-apply"
              onClick={() => setApplied(draft)}
              disabled={loading || !filtersDirty}
            >
              <FiSearch size={14} /> Apply filters
            </button>
            <button
              className="mr-btn-reload"
              onClick={() => { setDraft(EMPTY_FILTERS); setApplied(EMPTY_FILTERS); }}
              disabled={loading || (!hasFilters && !filtersDirty)}
            >
              <FiX size={14} /> Reset
            </button>
            <span className="mr-filter-hint">
              Name matches partially; ID, designation and dates match exactly.
            </span>
          </div>
        </div>

        {rateYears.length > 0 && (
          <div className="mr-years">
            <span className="mr-years-label">Rate years in use</span>
            {rateYears.map((y) => <span key={y} className="mr-year-chip">{y}</span>)}
          </div>
        )}

        {loading ? (
          <TableSkeleton />
        ) : loadError ? (
          <div style={{ padding: "18px" }}>
            <ResultBanner {...loadError} tone="err">
              <div className="mr-banner-actions">
                <button className="mr-btn-ghost" onClick={loadResources}>
                  <FiRefreshCw size={14} /> Try again
                </button>
              </div>
            </ResultBanner>
          </div>
        ) : resources.length === 0 ? (
          <div className="mr-empty">
            <div className="mr-empty-emoji">{hasFilters ? "🔍" : "👥"}</div>
            <h3>{hasFilters ? "No matching resources" : "No resources yet"}</h3>
            <p>
              {hasFilters
                ? "No record matches every filter. Resource ID and designation must match exactly — try loosening one of them."
                : "Upload a resource workbook above to populate the registry."}
            </p>
          </div>
        ) : (
          <div className="mr-scroll">
            <table className="mr-table">
              <thead>
                <tr>
                  <th className="mr-th">ID</th>
                  <th className="mr-th">Name</th>
                  <th className="mr-th">Designation</th>
                  <th className="mr-th">Project</th>
                  <th className="mr-th">Category</th>
                  <th className="mr-th" data-align="right">Rate (in force)</th>
                  <th className="mr-th">Joined</th>
                  <th className="mr-th" data-align="center">Status</th>
                </tr>
              </thead>
              <tbody>
                {resources.map((r) => {
                  const ac = avatarColor(r.name);
                  return (
                    <tr
                      key={r.id ?? r.resId}
                      className="mr-row"
                      onClick={() => setViewingId(r.resId)}
                      title="View resource details and history"
                    >
                      <td className="mr-td"><code className="mr-id">{r.resId}</code></td>
                      <td className="mr-td">
                        <div className="mr-person">
                          <span className="mr-avatar" style={{ background: ac.bg, color: ac.fg }}>
                            {initialsOf(r.name)}
                          </span>
                          <div>
                            <div className="mr-name">{r.name || "—"}</div>
                            {r.emailId ? <div className="mr-sub">{r.emailId}</div> : null}
                          </div>
                        </div>
                      </td>
                      <td className="mr-td">{r.designationType || "—"}</td>
                      <td className="mr-td">{projectName(r.projectId)}</td>
                      <td className="mr-td">{r.category || "—"}</td>
                      <td className="mr-td" data-align="right" style={{ whiteSpace: "nowrap" }}>
                        {formatMoney(currentRateOf(r))}
                        {r.rateYear ? (
                          <span style={{ fontSize: 11, color: "#0b3c88", background: "#eef3fb", borderRadius: 5, padding: "1px 5px", fontWeight: 700, marginLeft: 6 }}>
                            {String(r.rateYear).replace(/^Year-/, "Yr ")}
                          </span>
                        ) : null}
                      </td>
                      <td className="mr-td">{formatDate(r.dateOfJoining)}</td>
                      <td className="mr-td" data-align="center">
                        <span className={`mr-pill ${r.active ? "mr-pill--on" : "mr-pill--off"}`}>
                          <span className="mr-dot" />
                          {r.active ? "Active" : "Inactive"}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {viewingId && (
        <ResourceDrawer
          resId={viewingId}
          projectName={projectName}
          onClose={() => setViewingId(null)}
          onSaved={(saved) =>
            // Patch the row in place rather than refetching the whole list —
            // the applied filters may no longer match the edited record, and
            // yanking it out from under the open drawer reads as a bug.
            setResources((prev) =>
              prev.map((r) => (r.resId === saved.resId ? { ...r, ...saved } : r))
            )
          }
        />
      )}
    </div>
  );
}

/* =====================================================================
   Detail drawer — GET /api/resources/{resId} plus the /history stints.
   ===================================================================== */
function ResourceDrawer({ resId, projectName, onClose, onSaved }) {
  const [tab, setTab] = useState("details");
  const [data, setData] = useState(null);
  const [history, setHistory] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  // Edit mode lives on the Details tab. `form` is null whenever we're just
  // viewing, so there's one source of truth for "is the user editing".
  const [form, setForm] = useState(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState(null);
  const [savedMsg, setSavedMsg] = useState("");
  const editing = form !== null;

  useEffect(() => {
    // Escape closes the drawer, but not mid-save and not while editing —
    // losing a half-filled form to a stray keypress is worse than an extra
    // click on Cancel.
    const onKey = (e) => {
      if (e.key !== "Escape") return;
      if (saving || editing) return;
      onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, saving, editing]);

  useEffect(() => {
    let active = true;
    const controller = new AbortController();
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const token = getToken();
        const headers = {
          accept: "*/*",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        };
        // The stint list is supplementary — a failure there shouldn't blank
        // out the detail pane, so it's settled independently.
        const [detailRes, historyRes] = await Promise.all([
          fetch(`${API_BASE}${ENDPOINTS.resources.get(resId)}`, { headers, signal: controller.signal }),
          fetch(`${API_BASE}${ENDPOINTS.resources.history(resId)}`, { headers, signal: controller.signal })
            .catch(() => null),
        ]);
        if (detailRes.status === 404) {
          if (active) {
            setError({
              title: "No employment record",
              detail:
                "This resource has no employment stints on file, so there is nothing to show. It may have been created without an assignment.",
              status: 404,
            });
          }
          return;
        }
        const detail = await readBody(detailRes);
        if (!detailRes.ok) {
          if (active) setError(describeHttpFailure("Couldn't load this resource", detailRes.status, detail));
          return;
        }
        if (!active) return;
        setData(detail);
        if (historyRes && historyRes.ok) {
          const stints = await readBody(historyRes);
          if (active) setHistory(Array.isArray(stints) ? stints : []);
        }
      } catch (e) {
        if (active && e.name !== "AbortError") {
          setError(describeNetworkFailure("Couldn't load this resource", e));
        }
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => { active = false; controller.abort(); };
  }, [resId]);

  function startEdit() {
    if (!data) return;
    setSaveError(null);
    setSavedMsg("");
    setTab("details");
    setForm({
      name: data.name || "",
      emailId: data.emailId || "",
      designationType: data.designationType || "",
      location: data.location || "",
      category: data.category || "",
      categoryDetails: data.categoryDetails || "",
      dateOfJoining: toDateInput(data.dateOfJoining),
      lastDate: toDateInput(data.lastDate),
      active: !!data.active,
      // Held as strings so a field can be cleared mid-typing without the
      // input going uncontrolled; coerced back to numbers on submit.
      rateCardByYear: Object.fromEntries(
        Object.entries(data.rateCardByYear || {}).map(([yr, rate]) => [
          yr,
          rate == null ? "" : String(rate),
        ])
      ),
    });
  }

  const setField = (key) => (e) => {
    const value = key === "active" ? e.target.checked : e.target.value;
    setForm((f) => ({ ...f, [key]: value }));
  };
  const setRate = (year) => (e) => {
    const value = e.target.value;
    setForm((f) => ({ ...f, rateCardByYear: { ...f.rateCardByYear, [year]: value } }));
  };

  // ---- save: PUT /api/resources/{resId} ----
  async function save() {
    const formYears = Object.keys(form.rateCardByYear || {}).sort(yearKeyOrder);
    const bad = formYears.find(
      (yr) => form.rateCardByYear[yr] !== "" && !Number.isFinite(Number(form.rateCardByYear[yr]))
    );
    // Local checks are framed the same way as server failures so the user
    // isn't reading two different kinds of error message.
    if (bad) {
      setSaveError({ title: "Check the rate card", detail: `${bad} needs a valid number.` });
      return;
    }
    if (!form.name.trim()) {
      setSaveError({ title: "Full name is required", detail: "Enter the resource's name before saving." });
      return;
    }
    if (form.lastDate && form.dateOfJoining && form.lastDate < form.dateOfJoining) {
      setSaveError({
        title: "Dates are out of order",
        detail: "The last date can't be earlier than the date of joining.",
      });
      return;
    }

    setSaving(true);
    setSaveError(null);
    setSavedMsg("");
    try {
      const token = getToken();
      // Exactly the fields the PUT contract accepts — resId, projectId,
      // rateYear and the assignment dates are server-owned and rejected.
      const payload = {
        name: form.name.trim(),
        emailId: form.emailId.trim() || null,
        designationType: form.designationType.trim(),
        location: form.location.trim(),
        category: form.category.trim(),
        categoryDetails: form.categoryDetails.trim(),
        dateOfJoining: form.dateOfJoining || null,
        lastDate: form.lastDate || null,
        active: !!form.active,
        rateCardByYear: Object.fromEntries(
          formYears.map((yr) => [
            yr,
            form.rateCardByYear[yr] === "" ? 0 : Number(form.rateCardByYear[yr]),
          ])
        ),
      };

      const res = await fetch(`${API_BASE}${ENDPOINTS.resources.update(resId)}`, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          accept: "*/*",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify(payload),
      });

      const body = await readBody(res);

      if (!res.ok) {
        setSaveError(describeHttpFailure("Couldn't save changes", res.status, body));
        return;
      }

      // Prefer the server's echo — it may normalize values we sent.
      const saved = body && typeof body === "object" ? { ...data, ...body } : { ...data, ...payload };
      setData(saved);
      setForm(null);
      setSavedMsg("Resource details updated.");
      if (onSaved) onSaved(saved);
    } catch (e) {
      setSaveError(describeNetworkFailure("Couldn't save changes", e));
    } finally {
      setSaving(false);
    }
  }

  const rateYears = Object.keys(data?.rateCardByYear || {}).sort(yearKeyOrder);
  const formYears = Object.keys(form?.rateCardByYear || {}).sort(yearKeyOrder);
  const activeYearKey = data?.rateYear
    ? (data.rateCardByYear?.[String(data.rateYear)] != null
        ? String(data.rateYear)
        : `Year-${data.rateYear}`)
    : "";

  const rows = data
    ? [
        { label: "Resource ID", value: data.resId },
        { label: "Full name", value: data.name || "—" },
        { label: "Email", value: data.emailId || "—" },
        { label: "Location", value: data.location || "—" },
        { label: "Designation", value: data.designationType || "—" },
        { label: "Category", value: data.category || "—" },
        { label: "Category details", value: data.categoryDetails || "—" },
        { label: "Rate year", value: data.rateYear || "—" },
        { label: "Rate in force", value: formatMoney(currentRateOf(data)) },
        { label: "Date of joining", value: formatDate(data.dateOfJoining) },
        { label: "Assignment start", value: formatDate(data.assignmentStartDate) },
        { label: "Assignment end", value: data.assignmentEndDate ? formatDate(data.assignmentEndDate) : "Ongoing" },
        { label: "Last date", value: data.lastDate ? formatDate(data.lastDate) : "—" },
        { label: "Status", value: data.active ? "Active" : "Inactive" },
        { label: "Project", value: projectName(data.projectId) },
      ]
    : [];

  return (
    <div
      className="mr mr-scrim"
      // Same guard as Escape: a stray backdrop click must not throw away
      // a half-filled form or interrupt an in-flight save.
      onMouseDown={(e) => {
        if (e.target !== e.currentTarget) return;
        if (saving || editing) return;
        onClose();
      }}
    >
      <aside className="mr-drawer" role="dialog" aria-modal="true" aria-label={`Resource ${resId}`}>
        <div className="mr-drawer-head">
          <div>
            <div className="mr-drawer-eyebrow">Resource</div>
            <h2>{data?.name || `#${resId}`}</h2>
          </div>
          <button className="mr-close" onClick={onClose} aria-label="Close" disabled={saving}>✕</button>
        </div>

        <div className="mr-tabs">
          <button
            className={`mr-tab${tab === "details" ? " active" : ""}`}
            onClick={() => setTab("details")}
          >
            {editing ? "Edit details" : "Details"}
          </button>
          <button
            className={`mr-tab${tab === "history" ? " active" : ""}`}
            onClick={() => setTab("history")}
            // History is read-only context; switching away mid-edit would
            // hide the form while its unsaved state is still live.
            disabled={editing}
            title={editing ? "Finish or cancel the edit first" : undefined}
          >
            Employment history{history.length ? ` (${history.length})` : ""}
          </button>
        </div>

        <div className="mr-drawer-body">
          {loading ? (
            <div style={{ color: "#64748b", fontSize: 14, padding: "8px 0" }}>Loading…</div>
          ) : error ? (
            <ResultBanner {...error} tone={error.status === 404 ? "warn" : "err"} />
          ) : tab === "details" && editing ? (
            <div className="mr-form">
              {saveError && (
                <ResultBanner
                  {...saveError}
                  tone="err"
                  onDismiss={() => setSaveError(null)}
                />
              )}

              <div className="mr-readonly">
                <span>Resource ID</span>
                <b>{data.resId}</b>
              </div>
              <div className="mr-readonly">
                <span>Project</span>
                <b>{projectName(data.projectId)}</b>
              </div>

              <label className="mr-field">
                <span className="mr-field-label">Full name *</span>
                <input value={form.name} onChange={setField("name")} />
              </label>

              <label className="mr-field">
                <span className="mr-field-label">Email</span>
                <input type="email" value={form.emailId} onChange={setField("emailId")} />
              </label>

              <label className="mr-field">
                <span className="mr-field-label">Designation</span>
                <input value={form.designationType} onChange={setField("designationType")} />
              </label>

              <div className="mr-grid-2">
                <label className="mr-field">
                  <span className="mr-field-label">Location</span>
                  <input value={form.location} onChange={setField("location")} />
                </label>
                <label className="mr-field">
                  <span className="mr-field-label">Category</span>
                  <input value={form.category} onChange={setField("category")} />
                </label>
              </div>

              <label className="mr-field">
                <span className="mr-field-label">Category details</span>
                <input value={form.categoryDetails} onChange={setField("categoryDetails")} />
              </label>

              <div className="mr-grid-2">
                <label className="mr-field">
                  <span className="mr-field-label">Date of joining</span>
                  <input type="date" value={form.dateOfJoining} onChange={setField("dateOfJoining")} />
                </label>
                <label className="mr-field">
                  <span className="mr-field-label">Last date</span>
                  <input type="date" value={form.lastDate} onChange={setField("lastDate")} />
                </label>
              </div>

              <div className="mr-field">
                <span className="mr-field-label">Status</span>
                <label className="mr-switch">
                  <input type="checkbox" checked={!!form.active} onChange={setField("active")} />
                  <span className={`mr-track ${form.active ? "on" : ""}`}>
                    <span className="mr-thumb" />
                  </span>
                  <span style={{ fontSize: 14, fontWeight: 600, color: "#0f1c33" }}>
                    {form.active ? "Active" : "Inactive"}
                  </span>
                </label>
              </div>

              <div className="mr-field">
                <span className="mr-field-label">Rate card by year (₹)</span>
                {formYears.length === 0 ? (
                  <div className="mr-rate-none">
                    No rate card years are set for this resource. Upload a
                    designation rate card for the project to populate them.
                  </div>
                ) : (
                  <div className="mr-rate-edit">
                    {formYears.map((yr) => (
                      <div className="mr-rate-edit-row" key={yr}>
                        <span className="mr-rate-edit-year">
                          {yr}
                          {yr === activeYearKey && <span className="mr-rate-current-tag">in force</span>}
                        </span>
                        <input
                          type="number"
                          inputMode="decimal"
                          value={form.rateCardByYear[yr]}
                          onChange={setRate(yr)}
                          aria-label={`Rate for ${yr}`}
                        />
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          ) : tab === "details" ? (
            <>
              {savedMsg && (
                <ResultBanner
                  tone="ok"
                  title="Changes saved"
                  detail={savedMsg}
                  onDismiss={() => setSavedMsg("")}
                />
              )}
              {rows.map((row) => (
                <div className="mr-detail-row" key={row.label}>
                  <span className="mr-detail-k">{row.label}</span>
                  <span className="mr-detail-v">
                    {row.label === "Status" ? (
                      <span className={`mr-pill ${data.active ? "mr-pill--on" : "mr-pill--off"}`}>
                        <span className="mr-dot" />
                        {row.value}
                      </span>
                    ) : (
                      row.value
                    )}
                  </span>
                </div>
              ))}
              {rateYears.length > 0 && (
                <>
                  <div className="mr-section-label">Rate card by year</div>
                  <div className="mr-rate-box">
                    {rateYears.map((yr) => (
                      <div key={yr} className={`mr-rate-row${yr === activeYearKey ? " active" : ""}`}>
                        <span className="yr">{yr}{yr === activeYearKey ? " ★" : ""}</span>
                        <span className="amt">{formatMoney(data.rateCardByYear[yr])}</span>
                      </div>
                    ))}
                  </div>
                </>
              )}
            </>
          ) : history.length === 0 ? (
            <div style={{ color: "#64748b", fontSize: 14, display: "flex", gap: 10, alignItems: "center" }}>
              <FiClock size={16} />
              No employment stints recorded for this resource.
            </div>
          ) : (
            <div>
              {history.map((s, i) => (
                <div
                  key={s.id ?? i}
                  className={`mr-stint${!s.assignmentEndDate && s.active ? " current" : ""}`}
                >
                  <div className="mr-stint-title">{s.designationType || "—"}</div>
                  <div className="mr-stint-dates">
                    {formatDate(s.assignmentStartDate || s.dateOfJoining)} →{" "}
                    {s.assignmentEndDate ? formatDate(s.assignmentEndDate) : "Present"}
                  </div>
                  <div className="mr-stint-meta">
                    {s.location && <span className="mr-chip">{s.location}</span>}
                    {s.category && <span className="mr-chip">{s.category}</span>}
                    {s.rateYear && <span className="mr-chip">{s.rateYear}</span>}
                    <span className="mr-chip">{formatMoney(currentRateOf(s))}</span>
                    <span className="mr-chip">{projectName(s.projectId)}</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {!loading && !error && tab === "details" && (
          <div className="mr-drawer-foot">
            {editing ? (
              <>
                <button className="mr-btn-ghost" onClick={() => { setForm(null); setSaveError(null); }} disabled={saving}>
                  Cancel
                </button>
                <button className="mr-btn-primary" onClick={save} disabled={saving}>
                  {saving ? "Saving…" : "Save changes"}
                </button>
              </>
            ) : (
              <>
                <button className="mr-btn-ghost" onClick={onClose}>Close</button>
                <button className="mr-btn-primary" onClick={startEdit} disabled={!data}>
                  <FiEdit2 size={14} /> Edit details
                </button>
              </>
            )}
          </div>
        )}
      </aside>
    </div>
  );
}

// Marks a field whose options are still being fetched. Announced politely
// so a screen reader hears it without the label being read twice.
function Spinner() {
  return <span className="mr-spinner" role="status" aria-label="Loading" />;
}

/* =====================================================================
   ResultBanner — the single presentation for any API outcome here.
   `stats` are the numbers the call returned; `issues` are the per-row
   problems it listed. Both are optional, so the same component covers a
   plain error and a detailed import report.
   ===================================================================== */
function ResultBanner({ tone = "err", title, detail, status, stats, issues, children, onDismiss }) {
  const icon = tone === "ok" ? "✓" : tone === "warn" ? "!" : "✕";
  const shown = Array.isArray(issues) ? issues.slice(0, 8) : [];
  const hidden = Array.isArray(issues) ? issues.length - shown.length : 0;
  return (
    <div
      className={`mr-banner mr-banner--${tone}`}
      role={tone === "err" ? "alert" : "status"}
    >
      <span className="mr-banner-ic" aria-hidden="true">{icon}</span>
      <div className="mr-banner-body">
        <div className="mr-banner-title">
          {title}
          {/* The status code is diagnostic, not the message — keep it
              present for a support ticket but out of the sentence. */}
          {status != null && <span className="mr-banner-status">HTTP {status}</span>}
        </div>
        {detail && <div className="mr-banner-detail">{detail}</div>}
        {Array.isArray(stats) && stats.length > 0 && (
          <div className="mr-banner-stats">
            {stats.map((s) => (
              <div className="mr-banner-stat" key={s.label}>
                <b>{s.value}</b>
                <span>{s.label}</span>
              </div>
            ))}
          </div>
        )}
        {shown.length > 0 && (
          <>
            <ul className="mr-banner-list">
              {shown.map((t, i) => <li key={i}>{t}</li>)}
            </ul>
            {hidden > 0 && (
              <div className="mr-banner-more">…and {hidden} more.</div>
            )}
          </>
        )}
        {children}
      </div>
      {onDismiss && (
        <button className="mr-banner-x" onClick={onDismiss} aria-label="Dismiss">✕</button>
      )}
    </div>
  );
}

function TableSkeleton() {
  const cols = ["ID", "Name", "Designation", "Project", "Category", "Rate", "Joined", "Status"];
  return (
    <div className="mr-scroll">
      <table className="mr-table">
        <thead>
          <tr>{cols.map((c) => <th key={c} className="mr-th">{c}</th>)}</tr>
        </thead>
        <tbody>
          {Array.from({ length: 6 }).map((_, i) => (
            <tr key={i} style={{ borderBottom: "1px solid #eef2f7" }}>
              {cols.map((c, j) => (
                <td key={c} className="mr-td">
                  <div className="mr-skel-bar" style={{ width: j === 1 ? "80%" : "60%" }} />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
