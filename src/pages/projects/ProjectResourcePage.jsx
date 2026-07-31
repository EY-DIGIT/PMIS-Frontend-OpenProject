import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useParams } from "react-router-dom";
import { useProject } from "../../store/project/projectsStore";
import { setPageContext, clearPageContext } from "../../utils/pageContext";
import "../../styles/global.css";
import { getToken } from "../../api/auth";
import { API_BASE as GATEWAY_BASE, authorizedFetch, tokenStore } from "../../api/client";
import { ENDPOINTS } from "../../api/endpoint";
import {
  readErrorMessage, readJsonBody, requestErrorMessage, messageFromBody,
  isReadableMessage, parseISODate,
} from "../../utils/apiMessage";

const API_BASE = "http://10.1.131.199:8019"; // move to env / your api client

/* ── upload + field limits ──────────────────────────────────────────
   A resource master sheet is small; anything past this is the wrong
   file. The text caps mirror what the columns realistically hold and
   stop a paste of a whole document reaching the API. */
const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;
const MAX_NAME = 120;
const MAX_TEXT = 120;
/* A rate card entry is an annual figure in rupees — ₹100 crore is already
   far past anything real, so beyond it the value is a typo. Unused while the
   rate card is read-only; restore with the rate inputs in EditDrawer.
const MAX_RATE = 1_000_000_000;
*/

const fmtBytes = (n) => {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
};

/* An .xlsx is a zip and an .xls a compound file, so browsers report their
   MIME types inconsistently (and not at all for some drag sources) — the
   extension is the reliable check. Returns "" when the file is usable. */
function validateSheetFile(f) {
  if (!f) return "Choose a file to import.";
  if (!/\.(xlsx|xls)$/i.test(f.name || "")) {
    return "That isn't an Excel file. Choose a .xlsx or .xls file.";
  }
  if (!f.size) return "That file is empty. Choose the filled-in template.";
  if (f.size > MAX_UPLOAD_BYTES) {
    return `That file is ${fmtBytes(f.size)} — the limit is ${fmtBytes(MAX_UPLOAD_BYTES)}.`;
  }
  return "";
}

/* Deliberately permissive: this only catches the typo cases (missing @,
   trailing dot, spaces). Anything stricter rejects addresses that are
   perfectly valid, and the server is the real authority. */
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

// ---------- formatting helpers ----------
// Swap "en-IN" / "INR" if the rate card is in another currency.
const money = new Intl.NumberFormat("en-IN", {
  style: "currency",
  currency: "INR",
  maximumFractionDigits: 0,
});
const formatMoney = (v) =>
  v == null || v === "" ? "—" : money.format(Number(v));

const formatDate = (v) => {
  if (!v) return "—";
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return v;
  return d.toLocaleDateString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
};

// Initials + a stable accent colour for the avatar chip.
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


// Column comparator for header sorting.
const makeComparator = (key, dir) => {
  const mul = dir === "asc" ? 1 : -1;
  return (a, b) => {
    if (key === "rateCard") {
      const av = a.rateCard == null || a.rateCard === "" ? -Infinity : Number(a.rateCard);
      const bv = b.rateCard == null || b.rateCard === "" ? -Infinity : Number(b.rateCard);
      return (av - bv) * mul;
    }
    if (key === "dateOfJoining" || key === "lastDate") {
      const av = a[key] ? new Date(a[key]).getTime() : -Infinity;
      const bv = b[key] ? new Date(b[key]).getTime() : -Infinity;
      return (av - bv) * mul;
    }
    if (key === "active") {
      return ((a.active ? 1 : 0) - (b.active ? 1 : 0)) * mul;
    }
    return (
      String(a[key] ?? "").localeCompare(String(b[key] ?? ""), undefined, {
        numeric: true,
        sensitivity: "base",
      }) * mul
    );
  };
};

// A resource is editable field-by-field; resId + projectId stay fixed.
const EDITABLE_FIELDS = [
  "name",
  "emailId",
  "location",
  "dateOfJoining",
  "lastDate",
  "designationType",
  "active",
];

// rateCardByYear keys look like "Year-1", "Year-2", "Year-10" — sort by the
// trailing number so 10 doesn't land between 1 and 2.
const yearKeyOrder = (a, b) =>
  (parseInt(String(a).replace(/\D+/g, ""), 10) || 0) -
  (parseInt(String(b).replace(/\D+/g, ""), 10) || 0);

/* Which organisation a resource row belongs to. The field name isn't stable
   across the resource service's payloads, so every spelling we've seen is
   accepted and the first present one wins. Returns "" when the row carries no
   organisation at all — which is meaningfully different from "belongs to a
   different org" (see the filter in loadResources). */
const resourceOrgId = (r) =>
  String(
    r?.organisationId ?? r?.organizationId ?? r?.orgId ?? r?.vendorId ?? ""
  );

// Table columns — drives both the header and sorting. One source of truth.
const COLUMNS = [
  { key: "resId", label: "ID", align: "left", sortable: true },
  { key: "name", label: "Name", align: "left", sortable: true },
  { key: "designationType", label: "Designation", align: "left", sortable: true },
  // Rate card hidden for now — restore this entry (and the matching <td>
  // in the table body) to bring the column back.
  // { key: "rateCard", label: "Rate card", align: "right", sortable: true },
  { key: "dateOfJoining", label: "Joined", align: "left", sortable: true },
  { key: "lastDate", label: "Last date", align: "left", sortable: true },
  { key: "active", label: "Status", align: "center", sortable: true },
  { key: "_action", label: "Action", align: "center", sortable: false },
];

// All component styling lives here so the JSX stays readable and hover/focus
// states are pure CSS. Scoped under `.rp` to avoid clashing with global.css.
const STYLES = `
.rp {
  --rp-primary: #0b3c88;
  --rp-primary-600: #0a336f;
  --rp-primary-700: #062a63;
  --rp-primary-50: #eef3fb;
  --rp-ink: #0f1c33;
  --rp-ink-2: #334155;
  --rp-muted: #64748b;
  --rp-faint: #94a3b8;
  --rp-line: #e6ecf3;
  --rp-line-2: #eef2f7;
  --rp-surface: #ffffff;
  --rp-surface-2: #f7f9fd;
  --rp-success: #0f9d58;
  --rp-success-bg: #e7f7ee;
  --rp-warn: #b45309;
  --rp-warn-bg: #fef3c7;
  --rp-danger: #dc2626;
  --rp-danger-bg: #fdecec;
  --rp-shadow-sm: 0 1px 2px rgba(15,28,51,0.06);
  --rp-shadow-md: 0 6px 20px rgba(15,28,51,0.08);
  --rp-shadow-lg: -18px 0 48px rgba(11,23,42,0.18);
  color: var(--rp-ink-2);
}

/* ---- header ---- */
.rp-eyebrow {
  font-size: 12px; font-weight: 700; letter-spacing: .09em;
  text-transform: uppercase; color: var(--rp-primary);
}
.rp-stats { display: flex; gap: 10px; flex-wrap: wrap; margin-top: 18px; }
.rp-stat {
  display: inline-flex; align-items: center; gap: 10px;
  padding: 9px 14px; border-radius: 999px;
  background: var(--rp-surface); border: 1px solid var(--rp-line);
  box-shadow: var(--rp-shadow-sm); font-size: 13px; color: var(--rp-muted);
}
.rp-stat b { color: var(--rp-ink); font-size: 15px; font-variant-numeric: tabular-nums; }
.rp-dot { width: 7px; height: 7px; border-radius: 50%; }

/* ---- toolbar ---- */
.rp-toolbar {
  display: flex; gap: 12px; align-items: center;
  justify-content: space-between; margin-bottom: 10px; flex-wrap: wrap;
}
.rp-search {
  position: relative; display: flex; align-items: center; flex: 1;
  min-width: 240px; max-width: 420px; background: var(--rp-surface);
  border: 1px solid var(--rp-line); border-radius: 11px; padding: 0 10px 0 12px;
  box-shadow: var(--rp-shadow-sm); transition: border-color .18s, box-shadow .18s;
}
.rp-search:focus-within { border-color: var(--rp-primary); box-shadow: 0 0 0 3px var(--rp-primary-50); }
.rp-search svg { color: var(--rp-faint); flex-shrink: 0; }
.rp-search input {
  border: none; outline: none; background: transparent; flex: 1;
  padding: 11px 10px; font-size: 14px; color: var(--rp-ink); font-family: inherit;
}
.rp-iconbtn {
  border: none; background: transparent; color: var(--rp-faint); cursor: pointer;
  height: 30px; width: 30px; border-radius: 7px; display: flex;
  align-items: center; justify-content: center; transition: background .15s, color .15s;
}
.rp-iconbtn:hover { background: var(--rp-line-2); color: var(--rp-ink); }

/* Organisation picker — the import endpoint needs it alongside projectId. */
.rp-org { display: flex; align-items: center; gap: 8px; }
.rp-org > span { font-size: 12.5px; font-weight: 600; color: var(--rp-muted); white-space: nowrap; }
.rp-select {
  border: 1px solid var(--rp-line); border-radius: 10px; padding: 10px 34px 10px 12px;
  font-size: 14px; color: var(--rp-ink); background-color: var(--rp-surface);
  font-family: inherit; outline: none; box-shadow: var(--rp-shadow-sm);
  min-width: 190px; max-width: 300px; cursor: pointer; text-overflow: ellipsis;
  appearance: none; -webkit-appearance: none; -moz-appearance: none;
  /* Page is light-only; without this a dark-mode browser paints the
     dropdown list in its own palette. */
  color-scheme: light;
  background-image: url("data:image/svg+xml;charset=utf-8,%3Csvg xmlns='http://www.w3.org/2000/svg' width='14' height='14' viewBox='0 0 24 24' fill='none' stroke='%2364748b' stroke-width='2.5' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='m6 9 6 6 6-6'/%3E%3C/svg%3E");
  background-repeat: no-repeat; background-position: right 12px center;
  transition: border-color .15s, box-shadow .15s;
}
.rp-select:hover:not(:disabled) { border-color: #c8d6ee; }
.rp-select:focus { border-color: var(--rp-primary); box-shadow: 0 0 0 3px var(--rp-primary-50); }
.rp-select:disabled { background-color: var(--rp-surface-2); color: var(--rp-muted); cursor: not-allowed; background-image: none; }

.rp-actions { display: flex; gap: 10px; flex-wrap: wrap; }
.rp-btn {
  display: inline-flex; align-items: center; gap: 8px; border-radius: 10px;
  font-size: 14px; font-weight: 600; padding: 10px 16px; cursor: pointer;
  font-family: inherit; transition: background .18s, border-color .18s, box-shadow .18s, transform .05s;
}
.rp-btn:active { transform: translateY(1px); }
.rp-btn:focus-visible { outline: 3px solid var(--rp-primary-50); outline-offset: 1px; }
.rp-btn[disabled] { cursor: not-allowed; opacity: .55; }
.rp-btn-ghost { border: 1px solid var(--rp-line); background: var(--rp-surface); color: var(--rp-ink); box-shadow: var(--rp-shadow-sm); }
.rp-btn-ghost:not([disabled]):hover { background: var(--rp-surface-2); }
.rp-btn-primary { border: none; background: var(--rp-primary); color: #fff; box-shadow: 0 2px 6px rgba(11,60,136,.22); }
.rp-btn-primary:not([disabled]):hover { background: var(--rp-primary-700); }

.rp-caption { font-size: 13px; color: var(--rp-muted); margin: 2px 0 18px; }
.rp-caption b { color: var(--rp-ink); }

/* ---- card + table ---- */
.rp-card { overflow: hidden; border: 1px solid var(--rp-line); border-radius: 14px; background: var(--rp-surface); box-shadow: var(--rp-shadow-md); }
.rp-scroll { overflow-x: auto; }
.rp-table { width: 100%; border-collapse: collapse; font-size: 14px; }
.rp-th {
  position: sticky; top: 0; background: var(--rp-surface-2); color: var(--rp-muted);
  font-size: 11.5px; font-weight: 700; letter-spacing: .05em; text-transform: uppercase;
  padding: 0; border-bottom: 1px solid var(--rp-line); white-space: nowrap; z-index: 1;
}
.rp-th-inner { display: flex; align-items: center; gap: 6px; padding: 13px 16px; width: 100%; }
.rp-th[data-align="right"] .rp-th-inner { justify-content: flex-end; }
.rp-th[data-align="center"] .rp-th-inner { justify-content: center; }
button.rp-th-inner {
  border: none; background: transparent; font: inherit; color: inherit;
  letter-spacing: inherit; text-transform: inherit; cursor: pointer; transition: color .15s;
}
button.rp-th-inner:hover { color: var(--rp-primary); }
.rp-th .arrow { font-size: 10px; opacity: .45; transition: opacity .15s; }
.rp-th[aria-sort="ascending"] .arrow,
.rp-th[aria-sort="descending"] .arrow { opacity: 1; color: var(--rp-primary); }

.rp-row { border-bottom: 1px solid var(--rp-line-2); cursor: pointer; transition: background .16s, box-shadow .16s; }
.rp-row:last-child { border-bottom: none; }
.rp-row:hover { background: var(--rp-surface-2); box-shadow: inset 3px 0 0 var(--rp-primary); }

/* ── inactive resource ──────────────────────────────────────────────────
   The Status pill already says so, but a reader scanning fifty rows for the
   people still on the project shouldn't have to read a column to find them.
   The whole row steps back instead, so the active ones are what the eye
   lands on: text drops to muted, and the avatar — the loudest thing in the
   row — loses its colour.

   Deliberately neutral rather than red: inactive is a state a resource is
   meant to reach, not a fault. The pill keeps carrying the word "Inactive",
   so the meaning never rests on colour alone.

   The bar is a resting-state marker; hover replaces it with the usual primary
   one, which is fine — by then the pointer is already on the row. */
.rp-row--off { box-shadow: inset 3px 0 0 var(--rp-line); }
.rp-row--off .rp-td { color: var(--rp-muted); }
.rp-row--off .rp-name { color: var(--rp-muted); font-weight: 500; }
.rp-row--off .rp-id { color: var(--rp-faint); }
.rp-row--off .rp-avatar { filter: grayscale(1); opacity: .5; }
.rp-td { padding: 12px 16px; vertical-align: middle; color: var(--rp-ink); }
.rp-td[data-align="right"] { text-align: right; font-variant-numeric: tabular-nums; }
.rp-td[data-align="center"] { text-align: center; }

.rp-id { font-size: 12.5px; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; background: var(--rp-line-2); padding: 3px 7px; border-radius: 5px; color: var(--rp-ink-2); }
.rp-person { display: flex; align-items: center; gap: 11px; }
.rp-avatar { width: 34px; height: 34px; border-radius: 9px; flex-shrink: 0; display: flex; align-items: center; justify-content: center; font-size: 12.5px; font-weight: 700; }
.rp-name { font-weight: 600; color: var(--rp-ink); }
.rp-sub { color: var(--rp-muted); font-size: 12.5px; margin-top: 1px; }

.rp-pill { display: inline-flex; align-items: center; gap: 6px; font-size: 12px; font-weight: 600; padding: 4px 12px; border-radius: 999px; }
.rp-pill .rp-dot { background: currentColor; }
.rp-pill--on { background: var(--rp-success-bg); color: var(--rp-success); }
.rp-pill--off { background: var(--rp-line-2); color: var(--rp-muted); }

.rp-edit {
  display: inline-flex; align-items: center; gap: 6px; font-size: 13px; font-weight: 600;
  color: var(--rp-primary); background: transparent; border: 1px solid var(--rp-line);
  border-radius: 8px; padding: 6px 12px; cursor: pointer; transition: background .15s, border-color .15s;
}
.rp-edit:hover { background: var(--rp-primary-50); border-color: var(--rp-primary); }

/* ---- states ---- */
.rp-empty { text-align: center; padding: 64px 24px; }
.rp-empty-emoji { font-size: 44px; margin-bottom: 14px; opacity: .55; }
.rp-empty h3 { font-size: 16px; font-weight: 700; color: var(--rp-ink); margin: 0 0 8px; }
.rp-empty p { color: var(--rp-muted); font-size: 14px; max-width: 400px; margin: 0 auto 24px; line-height: 1.5; }

.rp-skel-bar { height: 12px; border-radius: 6px; background: linear-gradient(90deg, var(--rp-line-2) 25%, #e2e8f2 37%, var(--rp-line-2) 63%); background-size: 400% 100%; animation: rp-skel 1.3s ease infinite; }

/* ---- drawer ---- */
.rp-scrim {
  position: fixed; inset: 0; background: rgba(11,42,99,.42); backdrop-filter: blur(2px);
  display: flex; justify-content: flex-end; z-index: 1000; animation: rp-fade .15s ease;
}
.rp-drawer {
  width: min(460px, 100%); height: 100%; background: var(--rp-surface);
  display: flex; flex-direction: column; box-shadow: var(--rp-shadow-lg);
  animation: rp-slide .24s cubic-bezier(.2,.8,.2,1);
}
.rp-drawer-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 16px; padding: 22px 24px; border-bottom: 1px solid var(--rp-line); }
.rp-drawer-head h2 { margin: 2px 0 0; font-size: 20px; font-weight: 700; letter-spacing: -.01em; color: var(--rp-ink); }
.rp-close {
  border: none; background: var(--rp-line-2); color: var(--rp-muted); width: 30px; height: 30px;
  border-radius: 8px; cursor: pointer; font-size: 17px; line-height: 1; display: flex;
  align-items: center; justify-content: center; transition: background .18s, color .18s; flex-shrink: 0;
}
.rp-close:hover { background: #e3e7ef; color: var(--rp-ink); }
.rp-drawer-body { padding: 22px 24px; overflow-y: auto; flex: 1; }
.rp-drawer-foot { display: flex; justify-content: flex-end; gap: 10px; padding: 16px 24px; border-top: 1px solid var(--rp-line); background: var(--rp-surface-2); }

.rp-detail-row { display: flex; align-items: center; justify-content: space-between; gap: 16px; padding: 12px 2px; border-bottom: 1px solid var(--rp-line-2); }
.rp-detail-row:last-child { border-bottom: none; }
.rp-detail-k { font-size: 13px; color: var(--rp-muted); font-weight: 600; }
.rp-detail-v { font-size: 14px; color: var(--rp-ink); font-weight: 600; text-align: right; word-break: break-word; font-variant-numeric: tabular-nums; }

.rp-readonly { display: flex; align-items: center; justify-content: space-between; background: var(--rp-surface-2); border: 1px solid var(--rp-line); border-radius: 10px; padding: 12px 14px; font-size: 13px; color: var(--rp-muted); }
.rp-readonly b { color: var(--rp-ink); font-variant-numeric: tabular-nums; }

.rp-field { display: flex; flex-direction: column; gap: 6px; }
.rp-field > span { font-size: 12.5px; font-weight: 600; color: var(--rp-muted); }
.rp-input {
  width: 100%; border: 1px solid var(--rp-line); border-radius: 9px; padding: 10px 12px;
  font-size: 14px; color: var(--rp-ink); background: var(--rp-surface); outline: none;
  font-family: inherit; transition: border-color .15s, box-shadow .15s; box-sizing: border-box;
}
.rp-input:focus { border-color: var(--rp-primary); box-shadow: 0 0 0 3px var(--rp-primary-50); }
.rp-grid-2 { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; }

.rp-switch { display: inline-flex; align-items: center; gap: 10px; cursor: pointer; user-select: none; padding-top: 4px; }
.rp-switch input { position: absolute; opacity: 0; pointer-events: none; }
.rp-track { width: 40px; height: 22px; border-radius: 999px; background: #cbd5e1; position: relative; transition: background .2s; display: inline-block; }
.rp-track.on { background: var(--rp-success); }
.rp-thumb { position: absolute; top: 2px; left: 2px; width: 18px; height: 18px; border-radius: 50%; background: #fff; box-shadow: 0 1px 2px rgba(0,0,0,.2); transition: left .2s; }
.rp-track.on .rp-thumb { left: 20px; }

.rp-inline-error { background: var(--rp-danger-bg); border: 1px solid #f5c9c9; color: var(--rp-danger); border-radius: 10px; padding: 12px 14px; font-size: 13.5px; display: flex; align-items: center; gap: 10px; }
/* Field-level validation message, sitting under the control it belongs to. */
.rp-field-err { display: block; font-size: 12.5px; color: var(--rp-danger); margin-top: 5px; line-height: 1.45; font-weight: 500; }
/* Invalid control — a red edge alongside the message, so the error is
   findable by colour and readable without relying on it. */
.rp-input.is-bad { border-color: var(--rp-danger); }
.rp-input.is-bad:focus { border-color: var(--rp-danger); box-shadow: 0 0 0 3px rgba(220,38,38,.14); }
.rp-inline-success { background: var(--rp-success-bg); border: 1px solid #bfe6cf; color: var(--rp-success); border-radius: 10px; padding: 12px 14px; font-size: 13.5px; font-weight: 600; display: flex; align-items: center; gap: 10px; }

/* ---- rate card by year (edit drawer) ---- */
.rp-rate-list { display: flex; flex-direction: column; gap: 8px; }
.rp-rate-row { display: grid; grid-template-columns: 1fr 1.4fr; align-items: center; gap: 12px; }
.rp-rate-year { display: inline-flex; align-items: center; gap: 8px; font-size: 13.5px; font-weight: 600; color: var(--rp-ink); }
.rp-rate-current { font-size: 10.5px; font-weight: 700; letter-spacing: .04em; text-transform: uppercase;
  color: var(--rp-primary); background: var(--rp-primary-50); border-radius: 999px; padding: 2px 7px; }
.rp-rate-empty { font-size: 13.5px; color: var(--rp-muted); background: #f6f8fb;
  border: 1px solid var(--rp-line-2); border-radius: 10px; padding: 11px 13px; }
/* Read-only rate. Deliberately NOT styled as a disabled input — a greyed-out
   field reads as "temporarily locked"; a plain value reads as "reference". */
.rp-rate-value { font-size: 13.5px; font-weight: 700; text-align: right;
  font-variant-numeric: tabular-nums; color: var(--rp-ink);
  background: #f6f8fb; border: 1px solid var(--rp-line-2); border-radius: 8px;
  padding: 9px 12px; }
.rp-rate-note { font-size: 12px; color: var(--rp-muted); line-height: 1.5; margin-top: 2px; }

/* ---- toasts ---- */
.rp-toasts { position: fixed; right: 20px; bottom: 20px; z-index: 1100; display: flex; flex-direction: column; gap: 10px; max-width: 360px; }
.rp-toast {
  display: flex; align-items: flex-start; gap: 11px; padding: 13px 14px; border-radius: 11px;
  background: var(--rp-surface); box-shadow: var(--rp-shadow-md); border: 1px solid var(--rp-line);
  animation: rp-toast-in .22s cubic-bezier(.2,.8,.2,1);
}
.rp-toast-ic { width: 22px; height: 22px; border-radius: 6px; display: flex; align-items: center; justify-content: center; font-size: 13px; flex-shrink: 0; margin-top: 1px; }
.rp-toast--ok { border-left: 3px solid var(--rp-success); }
.rp-toast--ok .rp-toast-ic { background: var(--rp-success-bg); color: var(--rp-success); }
.rp-toast--error { border-left: 3px solid var(--rp-danger); }
.rp-toast--error .rp-toast-ic { background: var(--rp-danger-bg); color: var(--rp-danger); }
.rp-toast--warn { border-left: 3px solid var(--rp-warn); }
.rp-toast--warn .rp-toast-ic { background: var(--rp-warn-bg); color: var(--rp-warn); }
.rp-toast-title { font-size: 13.5px; font-weight: 700; color: var(--rp-ink); }
.rp-toast-msg { font-size: 13px; color: var(--rp-muted); margin-top: 1px; line-height: 1.4; }
.rp-toast-x { border: none; background: transparent; color: var(--rp-faint); cursor: pointer; font-size: 14px; padding: 2px 4px; border-radius: 5px; }
.rp-toast-x:hover { color: var(--rp-ink); }

@keyframes rp-fade { from { opacity: 0; } to { opacity: 1; } }
@keyframes rp-slide { from { transform: translateX(28px); opacity: .5; } to { transform: translateX(0); opacity: 1; } }
@keyframes rp-toast-in { from { transform: translateY(12px); opacity: 0; } to { transform: translateY(0); opacity: 1; } }
@keyframes rp-spin { to { transform: rotate(360deg); } }
@keyframes rp-skel { 0% { background-position: 100% 0; } 100% { background-position: -100% 0; } }

@media (max-width: 640px) {
  .rp-toasts { left: 16px; right: 16px; max-width: none; }
}
@media (prefers-reduced-motion: reduce) {
  .rp *, .rp *::before, .rp *::after { animation: none !important; transition: none !important; }
}

/* ---- rate card popover ---- */
.rp-rate-wrap { position: relative; display: inline-flex; align-items: center; gap: 4px; cursor: default; }
.rp-rate-popover {
  position: absolute; top: calc(100% + 6px); right: 0; z-index: 200;
  background: #fff; border: 1px solid var(--rp-line); border-radius: 10px;
  box-shadow: 0 8px 24px rgba(11,28,51,.13); padding: 6px 0; min-width: 200px;
  animation: rp-fade .12s ease;
}
.rp-rate-popover-row {
  display: flex; justify-content: space-between; align-items: center;
  padding: 6px 14px; font-size: 13px; gap: 16px;
}
.rp-rate-popover-row.active { background: var(--rp-primary-50); }
.rp-rate-popover-row .yr { color: var(--rp-muted); font-weight: 600; }
.rp-rate-popover-row.active .yr { color: var(--rp-primary); font-weight: 700; }
.rp-rate-popover-row .amt { font-weight: 700; color: var(--rp-ink); font-variant-numeric: tabular-nums; }
.rp-rate-popover-row.active .amt { color: var(--rp-primary); }
/* ---- centered popup modal ---- */
.rp-modal-scrim {
  position: fixed; inset: 0; background: rgba(11,42,99,.42); backdrop-filter: blur(2px);
  display: flex; align-items: center; justify-content: center; z-index: 1000;
  animation: rp-fade .15s ease; padding: 20px;
}
.rp-modal {
  width: min(480px, 100%); max-height: 85vh; background: var(--rp-surface);
  border-radius: 16px; display: flex; flex-direction: column; overflow: hidden;
  box-shadow: 0 20px 60px rgba(11,23,42,.28);
  animation: rp-modal-in .18s cubic-bezier(.2,.8,.2,1);
}
.rp-modal-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 16px; padding: 22px 24px 16px; }
.rp-modal-head h2 { margin: 2px 0 0; font-size: 19px; font-weight: 700; letter-spacing: -.01em; color: var(--rp-ink); }
.rp-modal-body { padding: 0 24px 22px; overflow-y: auto; flex: 1; }
.rp-modal-foot { display: flex; justify-content: flex-end; gap: 10px; padding: 16px 24px; border-top: 1px solid var(--rp-line); background: var(--rp-surface-2); }

@keyframes rp-modal-in {
  from { transform: scale(.96) translateY(6px); opacity: 0; }
  to { transform: scale(1) translateY(0); opacity: 1; }
}
`;

export default function ProjectResourcePage() {
  const { projectId } = useParams();
  const project = useProject(projectId);
  const fileInputRef = useRef(null);

  // upload
  const [uploading, setUploading] = useState(false);
  // template download
  const [downloading, setDownloading] = useState(false);

  // Organisation the upload is attributed to. The import endpoint needs it
  // alongside projectId, so the candidates come from the project's linked
  // vendors — fetched here because the projects store isn't guaranteed to
  // be hydrated on a deep link.
  const [orgs, setOrgs] = useState([]);
  const [orgsLoading, setOrgsLoading] = useState(true);
  const [organisationId, setOrganisationId] = useState("");

  // table data
  const [resources, setResources] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(null);
  /* True when the last load actually narrowed by organisation. Lets the empty
     state say "none for THIS organisation" instead of the flatly wrong "none
     on this project" — the two call for different next steps. */
  const [orgScoped, setOrgScoped] = useState(false);

  // search + sort
  const [query, setQuery] = useState("");
  const [serverSearching, setServerSearching] = useState(false);
  const [sort, setSort] = useState({ key: null, dir: "asc" });

  // drawers
  const [editing, setEditing] = useState(null);
  const [viewingId, setViewingId] = useState(null);

  
// add near your other state
const [apiResponse, setApiResponse] = useState(null);
// shape: { title, ok, status, data }

function closeApiResponse() {
  setApiResponse(null);
}

  // toasts
  const [toasts, setToasts] = useState([]);
  const toastSeq = useRef(0);
  const pushToast = useCallback((t) => {
    const id = ++toastSeq.current;
    setToasts((xs) => [...xs, { id, type: "ok", ...t }]);
    setTimeout(
      () => setToasts((xs) => xs.filter((x) => x.id !== id)),
      t.duration || 4500
    );
  }, []);
  const dismissToast = (id) => setToasts((xs) => xs.filter((x) => x.id !== id));

  useEffect(() => {
    setPageContext({ projectName: project?.projectName || "" });
    return () => clearPageContext();
  }, [project?.projectName]);

  // ---------- organisations: GET /projects/{id} → vendors[] ----------
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
        // Only the upload needs an organisation — a failure here leaves the
        // picker empty and the import disabled, with the table unaffected.
        if (active) setOrgs([]);
      } finally {
        if (active) setOrgsLoading(false);
      }
    })();
    return () => { active = false; };
  }, [projectId]);

  // ---------- load: GET /api/resources ----------
  const loadResources = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const token = getToken();
      /* The API is project-aware — pass projectId so the server returns only
         this project's resources instead of the whole list. organisationId
         goes along too: the service may or may not filter on it, and a param
         it doesn't know is ignored rather than rejected. The client-side
         narrowing below is what actually guarantees the picker takes effect. */
      const params = new URLSearchParams();
      if (projectId) params.set("projectId", projectId);
      if (organisationId) params.set("organisationId", organisationId);
      const qs = params.toString();
      const url = qs ? `${API_BASE}/api/resources?${qs}` : `${API_BASE}/api/resources`;
      const FALLBACK = "Couldn't load the resources.";
      const res = await fetch(url, {
        headers: { accept: "*/*", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      });
      if (!res.ok) throw new Error(await readErrorMessage(res, FALLBACK));
      // An empty 200 is a project with no resources yet, not a failure.
      const data = await readJsonBody(res, FALLBACK);
      const list = Array.isArray(data) ? data : data ? [data] : [];

      // Safety net: if the server ever returns unscoped data, still filter
      // client-side. Falls back to the full list when nothing matches.
      let scoped = list;
      if (projectId) {
        const byProject = list.filter(
          (r) => String(r.projectId) === String(projectId)
        );
        scoped = byProject.length ? byProject : list;
      }

      /* Narrow to the picked organisation — but ONLY when the rows actually
         carry an organisation. If the service doesn't return the field, every
         row would read as "" and a strict filter would blank the table.

         Note this deliberately does NOT use the projectId filter's
         "fall back to everything when nothing matches" rule: once the field
         exists, an empty result means the org genuinely has no resources, and
         quietly showing another org's people instead would be a worse lie
         than an empty table. */
      const canScopeByOrg = !!organisationId && scoped.some((r) => resourceOrgId(r));
      if (canScopeByOrg) {
        scoped = scoped.filter((r) => resourceOrgId(r) === String(organisationId));
      }
      setOrgScoped(canScopeByOrg);

      setResources(scoped);
    } catch (e) {
      setLoadError(requestErrorMessage(e, "Couldn't load the resources."));
    } finally {
      setLoading(false);
    }
  }, [projectId, organisationId]);

  /* Wait for the organisation picker to settle on its default before the
     first load, otherwise the table renders once unscoped and then jumps. */
  useEffect(() => {
    if (orgsLoading) return;
    loadResources();
  }, [loadResources, orgsLoading]);

  // ---------- client-side filter + sort ----------
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return resources;
    return resources.filter((r) =>
      [r.resId, r.name, r.emailId, r.designationType]
        .filter(Boolean)
        .some((f) => String(f).toLowerCase().includes(q))
    );
  }, [resources, query]);

  const sorted = useMemo(() => {
    if (!sort.key) return filtered;
    return [...filtered].sort(makeComparator(sort.key, sort.dir));
  }, [filtered, sort]);

  const toggleSort = (key) =>
    setSort((s) =>
      s.key === key
        ? { key, dir: s.dir === "asc" ? "desc" : "asc" }
        : { key, dir: "asc" }
    );

  const looksLikeResId = /^\d{3,}$/.test(query.trim());
  const showServerFallback = sorted.length === 0 && looksLikeResId && !loading;

  const selectedOrgName = orgs.find((o) => o.id === organisationId)?.name || "";
  /* An empty table with no search box in play is "this organisation has
     nobody" whenever the org filter is what's doing the narrowing. */
  const emptyBecauseOrg = !query && orgScoped && !!selectedOrgName;

  // ---------- server lookup: GET /api/resources/{resId} ----------
  async function fetchById(resId) {
    const id = String(resId ?? "").trim();
    // The caller gates on a digits-only query, but this is the value that
    // ends up in the URL path — check it here rather than trusting that.
    if (!/^\d{3,}$/.test(id)) {
      pushToast({ type: "warn", title: "Invalid ID", msg: "A resource ID is at least 3 digits." });
      return;
    }
    setServerSearching(true);
    try {
      const FALLBACK = "Couldn't look that resource up.";
      const token = getToken();
      const res = await fetch(
        `${API_BASE}/api/resources/${encodeURIComponent(id)}`,
        { headers: { accept: "*/*", ...(token ? { Authorization: `Bearer ${token}` } : {}) } }
      );
      if (res.status === 404) {
        pushToast({ type: "warn", title: "Not found", msg: `No resource matches ${id}.` });
        return;
      }
      if (!res.ok) throw new Error(await readErrorMessage(res, FALLBACK));
      const data = await readJsonBody(res, FALLBACK);
      // A 200 carrying nothing usable would splice a blank row into the table.
      if (!data || typeof data !== "object" || !data.resId) {
        throw new Error(`The server returned no details for ${id}.`);
      }
      setResources((prev) =>
        prev.some((r) => r.resId === data.resId)
          ? prev.map((r) => (r.resId === data.resId ? data : r))
          : [data, ...prev]
      );
      pushToast({
        type: "ok",
        title: "Found on server",
        msg: `${data.name || "Resource"} (${data.resId}) added to the list.`,
      });
    } catch (e) {
      pushToast({
        type: "error",
        title: "Lookup failed",
        msg: requestErrorMessage(e, "Couldn't look that resource up."),
      });
    } finally {
      setServerSearching(false);
    }
  }

  // ---------- save: PUT /api/resources/{resId} ----------
  async function saveResource(updated) {
  const token = getToken();
  let res;
  try {
    res = await fetch(
      `${API_BASE}/api/resources/${encodeURIComponent(updated.resId)}`,
      {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          accept: "*/*",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify(updated),
      }
    );
  } catch (err) {
    const msg = requestErrorMessage(err, "Couldn't save the changes. Please try again.");
    setApiResponse({ title: "Save failed", ok: false, status: null, data: { message: msg } });
    throw new Error(msg); // let EditDrawer still show its inline error + stay open
  }

  const text = await res.text();
  let body;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = null;   // a non-JSON body is never shown raw — see below
  }

  if (!res.ok) {
    /* The raw text used to be handed to the modal, which meant an HTML error
       page or a bare JSON envelope was rendered verbatim. Reduce it to one
       sentence first, and use that for both the modal and the thrown error
       so the drawer's inline message matches. */
    const msg = messageFromBody(text, res.status, "Couldn't save the changes. Please try again.");
    setApiResponse({ title: "Save failed", ok: false, status: res.status, data: { message: msg } });
    throw new Error(msg);
  }

  // A non-object body (plain "OK", or unparseable) must not replace the row.
  const saved = body && typeof body === "object" ? body : updated;
  setResources((prev) =>
    prev.map((r) => (r.resId === saved.resId ? { ...r, ...saved } : r))
  );

  // Show a clean confirmation — never the raw response body.
  setApiResponse({
    title: "Changes saved",
    ok: true,
    status: res.status,
    data: `${saved.name || "Resource"} details updated successfully.`,
  });
  pushToast({ type: "ok", title: "Changes saved", msg: `${saved.name || "Resource"} updated.` });
  return saved;
}

  // ---------- upload: POST /api/resources/upload ----------
  async function uploadFile(file) {
  if (uploading) return;                      // guards a double-pick
  /* organisationId is required by the endpoint — without it the server
     can't attribute the imported rows, so don't fire a doomed request.
     These used to return silently, leaving the user with no feedback at
     all after choosing a file. */
  if (!projectId) {
    pushToast({ type: "error", title: "Import blocked", msg: "This project couldn't be identified." });
    return;
  }
  if (!organisationId) {
    pushToast({
      type: "warn",
      title: "Pick an organisation",
      msg: "Choose the organisation these resources belong to, then import again.",
    });
    return;
  }
  /* `accept` on the input is a filter, not a guarantee — "All files" and
     drag-and-drop both bypass it, so the file is checked here. */
  const fileError = validateSheetFile(file);
  if (fileError) {
    pushToast({ type: "error", title: "Can't import this file", msg: fileError });
    return;
  }
  setUploading(true);

  const formData = new FormData();
  formData.append("file", file);

  try {
    const token = getToken();
    const res = await fetch(
      `${API_BASE}${ENDPOINTS.resources.upload(projectId, organisationId)}`,
      {
        method: "POST",
        headers: { accept: "*/*", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: formData,
      }
    );

    // Read the body regardless of status, then reduce it to one sentence —
    // it used to be passed through raw, so a non-JSON response was rendered
    // verbatim in the modal.
    const text = await res.text();

    if (!res.ok) {
      const msg = messageFromBody(text, res.status, "The import didn't go through. Please try again.");
      setApiResponse({ title: "Import failed", ok: false, status: res.status, data: { message: msg } });
      pushToast({ type: "error", title: "Import failed", msg });
      return;
    }

    // Show a clean success message instead of dumping the raw response body.
    setApiResponse({
      title: "Import complete",
      ok: true,
      status: res.status,
      data: "Resources uploaded successfully.",
    });
    pushToast({ type: "ok", title: "Import complete", msg: "Resources imported and the table refreshed." });
    await loadResources();
  } catch (err) {
    const msg = requestErrorMessage(err, "The import didn't go through. Check the file and try again.");
    setApiResponse({ title: "Import failed", ok: false, status: null, data: { message: msg } });
    pushToast({ type: "error", title: "Import failed", msg });
  } finally {
    setUploading(false);
  }
}

  // ---------- template: GET /api/export/template/resources ----------
  // A blank upload template, identical for every project. The response is a
  // binary .xlsx, so it's read as a blob and handed to a temporary
  // <a download> rather than parsed like the JSON endpoints.
  async function downloadTemplate() {
    setDownloading(true);
    try {
      const token = getToken();
      const res = await fetch(
        `${API_BASE}${ENDPOINTS.resources.exportTemplate()}`,
        { headers: { accept: "*/*", ...(token ? { Authorization: `Bearer ${token}` } : {}) } }
      );

      if (!res.ok) {
        /* An error body is text/JSON, not a spreadsheet. It used to fall
           back to text.slice(0, 200) — a 200-character slice of raw HTML or
           JSON on screen — so it now goes through the shared gate. */
        const detail = await readErrorMessage(res, "Couldn't download the template. Please try again.");
        pushToast({ type: "error", title: "Download failed", msg: detail });
        return;
      }

      const blob = await res.blob();
      // A 200 with an empty body saves a 0-byte file Excel refuses to open.
      if (!blob.size) {
        pushToast({
          type: "error",
          title: "Download failed",
          msg: "The server returned an empty template file.",
        });
        return;
      }
      // The API does send a Content-Disposition filename, but it isn't listed
      // in Access-Control-Expose-Headers, so cross-origin JS can't read it and
      // this returns null. Kept anyway: it starts working the moment the
      // backend adds `Access-Control-Expose-Headers: Content-Disposition`.
      const disposition = res.headers.get("content-disposition") || "";
      const match = /filename\*?=(?:UTF-8'')?"?([^";]+)"?/i.exec(disposition);
      // Falls back to the name the API itself uses, so the two agree.
      const filename = match
        ? decodeURIComponent(match[1].trim())
        : "resource_master_template.xlsx";

      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);

      pushToast({ type: "ok", title: "Template downloaded", msg: filename });
    } catch (err) {
      pushToast({
        type: "error",
        title: "Download failed",
        msg: requestErrorMessage(err, "Couldn't download the template. Please try again."),
      });
    } finally {
      setDownloading(false);
    }
  }

  function handleFileChange(e) {
    const file = e.target.files?.[0];
    uploadFile(file);
    e.target.value = ""; // allow re-selecting the same file
  }

  const total = resources.length;
  const activeCount = resources.filter((r) => r.active).length;
  const inactiveCount = total - activeCount;

  return (
    <div
  className="uidai-pmis-content rp"
  style={{
    padding: "10px clamp(12px, 3vw, 18px) 24px",
    maxWidth: "min(1600px, 96vw)",
    margin: "0 auto",
  }}
>
      <style>{STYLES}</style>
      <input
        ref={fileInputRef}
        type="file"
        accept=".xlsx,.xls,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
        onChange={handleFileChange}
        style={{ display: "none" }}
      />

      {/* Header */}
      <div style={{ marginBottom: "28px" }}>
        <div className="rp-eyebrow" style={{ marginBottom: "6px" }}>
          {project?.projectName || "Project"}
        </div>
        <h1 className="uidai-pmis-title" style={{ marginBottom: "6px" }}>Resources</h1>
        <p className="uidai-pmis-subtitle">
          Manage team members and resource allocation for this project.
        </p>
        <div className="rp-stats">
          <span className="rp-stat">
            <b>{total}</b> total
          </span>
          <span className="rp-stat">
            <span className="rp-dot" style={{ background: "var(--rp-success)" }} />
            <b>{activeCount}</b> active
          </span>
          <span className="rp-stat">
            <span className="rp-dot" style={{ background: "#cbd5e1" }} />
            <b>{inactiveCount}</b> inactive
          </span>
        </div>
      </div>

      {/* Toolbar */}
      <div className="rp-toolbar">
        <div className="rp-search">
          <SearchIcon />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search by name, email, ID or role…"
            aria-label="Search resources"
          />
          {query && (
            <button className="rp-iconbtn" onClick={() => setQuery("")} aria-label="Clear search" title="Clear search">
              ✕
            </button>
          )}
        </div>

        <div className="rp-actions">
          <label className="rp-org">
            <span>Organisation</span>
            <select
              className="rp-select"
              value={organisationId}
              onChange={(e) => setOrganisationId(e.target.value)}
              disabled={orgsLoading || orgs.length === 0}
              aria-label="Organisation for import"
            >
              {orgsLoading && <option value="">Loading…</option>}
              {!orgsLoading && orgs.length === 0 && (
                <option value="">No organisation linked</option>
              )}
              {orgs.map((o) => (
                <option key={o.id} value={o.id}>{o.name}</option>
              ))}
            </select>
          </label>
          <button
            className="rp-btn rp-btn-ghost"
            onClick={loadResources}
            disabled={loading}
            title="Reload resources"
          >
            <RefreshIcon spinning={loading} />
            Refresh
          </button>
          <button
            className="rp-btn rp-btn-ghost"
            onClick={downloadTemplate}
            disabled={downloading}
            title="Download the blank resource upload template"
          >
            <DownloadIcon />
            {downloading ? "Preparing…" : "Download Template"}
          </button>
          <button
            className="rp-btn rp-btn-primary"
            onClick={() => fileInputRef.current?.click()}
            disabled={uploading || !projectId || !organisationId}
            title={
              !projectId
                ? "Open a project first"
                : !organisationId
                  ? "Pick an organisation to import against"
                  : "Import resources from an Excel file"
            }
          >
            <UploadIcon />
            {uploading ? "Importing…" : "Import Excel"}
          </button>
        </div>
      </div>

      {/* Result caption */}
      {query ? (
        <p className="rp-caption">
          Showing <b>{sorted.length}</b> of <b>{total}</b> resources for “{query.trim()}”.
        </p>
      ) : (
        <div style={{ height: "18px" }} />
      )}

      {/* Main card */}
      <div className="rp-card">
        {loading ? (
          <TableSkeleton />
        ) : loadError ? (
          <div className="rp-empty">
            <div className="rp-empty-emoji">⚠️</div>
            <h3>{loadError}</h3>
            <p>Something went wrong while loading resources. Check your connection and try again.</p>
            <button className="rp-btn rp-btn-primary" onClick={loadResources}>
              <RefreshIcon /> Try again
            </button>
          </div>
        ) : sorted.length === 0 ? (
          <div className="rp-empty">
            <div className="rp-empty-emoji">
              {query ? "🔍" : emptyBecauseOrg ? "🏢" : "👥"}
            </div>
            <h3>
              {query
                ? "No matching resources"
                : emptyBecauseOrg
                  ? `No resources for ${selectedOrgName}`
                  : "No resources yet"}
            </h3>
            <p>
              {query
                ? showServerFallback
                  ? "This ID isn't loaded on this page. Search the server to pull it in."
                  : "Try a different name, email, ID, or designation."
                : emptyBecauseOrg
                  ? "Nobody on this project is mapped to this organisation. Pick a different organisation above, or import a spreadsheet to add them."
                  : "Import a spreadsheet to add team members for this project and start tracking capacity."}
            </p>
            {showServerFallback ? (
              <button
                className="rp-btn rp-btn-primary"
                onClick={() => fetchById(query.trim())}
                disabled={serverSearching}
              >
                {serverSearching ? "Searching…" : `Search server for “${query.trim()}”`}
              </button>
            ) : !query ? (
              <button
                className="rp-btn rp-btn-primary"
                onClick={() => fileInputRef.current?.click()}
                disabled={!projectId || !organisationId || uploading}
                title={!organisationId ? "Pick an organisation to import against" : undefined}
              >
                <UploadIcon /> Import Excel
              </button>
            ) : null}
          </div>
        ) : (
          <div className="rp-scroll">
            <table className="rp-table">
              <thead>
                <tr>
                  {COLUMNS.map((col) => {
                    const isSorted = sort.key === col.key;
                    const ariaSort = !col.sortable
                      ? undefined
                      : isSorted
                      ? sort.dir === "asc"
                        ? "ascending"
                        : "descending"
                      : "none";
                    return (
                      <th key={col.key} className="rp-th" data-align={col.align} aria-sort={ariaSort}>
                        {col.sortable ? (
                          <button
                            className="rp-th-inner"
                            onClick={() => toggleSort(col.key)}
                            title={`Sort by ${col.label}`}
                          >
                            {col.label}
                            <span className="arrow">{isSorted ? (sort.dir === "asc" ? "▲" : "▼") : "↕"}</span>
                          </button>
                        ) : (
                          <span className="rp-th-inner">{col.label}</span>
                        )}
                      </th>
                    );
                  })}
                </tr>
              </thead>
              <tbody>
                {sorted.map((r) => {
                  const ac = avatarColor(r.name);
                  return (
                    <tr
                      key={r.resId}
                      className={`rp-row${r.active ? "" : " rp-row--off"}`}
                      onClick={() => setViewingId(r.resId)}
                      title={r.active ? "View resource details" : "Inactive — view resource details"}
                    >
                      <td className="rp-td" data-align="left">
                        <code className="rp-id">{r.resId}</code>
                      </td>
                      <td className="rp-td" data-align="left">
                        <div className="rp-person">
                          <span className="rp-avatar" style={{ background: ac.bg, color: ac.fg }}>
                            {initialsOf(r.name)}
                          </span>
                          <div>
                            <div className="rp-name">{r.name || "—"}</div>
                            {r.emailId ? <div className="rp-sub">{r.emailId}</div> : null}
                          </div>
                        </div>
                      </td>
                      <td className="rp-td" data-align="left">{r.designationType || "—"}</td>
                      {/* Rate card column hidden for now — see COLUMNS above.
                      <td className="rp-td" data-align="right" style={{ whiteSpace: "nowrap" }}>
                        <RateCardCell resource={r} />
                      </td>
                      */}
                      <td className="rp-td" data-align="left">{formatDate(r.dateOfJoining)}</td>
                      <td className="rp-td" data-align="left">{formatDate(r.lastDate)}</td>
                      <td className="rp-td" data-align="center">
                        <span className={`rp-pill ${r.active ? "rp-pill--on" : "rp-pill--off"}`}>
                          <span className="rp-dot" />
                          {r.active ? "Active" : "Inactive"}
                        </span>
                      </td>
                      <td className="rp-td" data-align="center">
                        <button
                          className="rp-edit"
                          onClick={(e) => { e.stopPropagation(); setEditing(r); }}
                        >
                          <EditIcon /> Edit
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Edit drawer */}
      {editing && (
        <EditDrawer
          resource={editing}
          onClose={() => setEditing(null)}
          onSave={saveResource}
        />
      )}

      {/* Detail drawer — GET /api/resources/{resId} on open */}
      {viewingId && (
        <ResourceDetailDrawer
          resId={viewingId}
          projectName={project?.projectName || null}
          onClose={() => setViewingId(null)}
          onEdit={(r) => { setViewingId(null); setEditing(r); }}
        />
      )}

{apiResponse && (
  <ApiResponseModal response={apiResponse} onClose={closeApiResponse} />
)}

      {/* Toasts */}
      <div className="rp-toasts" role="status" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className={`rp-toast rp-toast--${t.type}`}>
            <span className="rp-toast-ic">{t.type === "ok" ? "✓" : t.type === "error" ? "✕" : "!"}</span>
            <div style={{ flex: 1 }}>
              {t.title ? <div className="rp-toast-title">{t.title}</div> : null}
              <div className="rp-toast-msg">{t.msg}</div>
            </div>
            <button className="rp-toast-x" onClick={() => dismissToast(t.id)} aria-label="Dismiss">✕</button>
          </div>
        ))}
      </div>
    </div>
  );
}

/* =====================================================================
   Detail drawer — GET /api/resources/{resId}. Opened by clicking a row.
   ===================================================================== */
function ResourceDetailDrawer({ resId, projectName, onClose, onEdit }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    const onKey = (e) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  useEffect(() => {
    let active = true;
    const controller = new AbortController();
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const token = getToken();
        const res = await fetch(
          `${API_BASE}/api/resources/${encodeURIComponent(resId)}`,
          { headers: { accept: "*/*", ...(token ? { Authorization: `Bearer ${token}` } : {}) }, signal: controller.signal }
        );
        const FALLBACK = "Couldn't load this resource.";
        if (!res.ok) throw new Error(await readErrorMessage(res, FALLBACK));
        const json = await readJsonBody(res, FALLBACK);
        if (!json || typeof json !== "object") throw new Error(FALLBACK);
        if (active) setData(json);
      } catch (e) {
        const msg = requestErrorMessage(e, "Couldn't load this resource.");
        if (active && msg) setError(msg);
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => { active = false; controller.abort(); };
  }, [resId]);

  const currentRate = data?.rateCardByYear && data?.rateYear
    ? data.rateCardByYear[`Year-${data.rateYear}`]
    : data?.rateCard;

  const rows = data
    ? [
        { label: "Resource ID", value: data.resId },
        { label: "Full name", value: data.name || "—" },
        // { label: "Email", value: data.emailId || "—" },
        { label: "Location", value: data.location || "—" },
        { label: "Designation", value: data.designationType || "—" },
        { label: "Category", value: data.category || "—" },
        { label: "Category Details", value: data.categoryDetails || "—" },
        { label: "Rate Year", value: data.rateYear ? `Year-${data.rateYear}` : "—" },
        // { label: "Rate (Current Year)", value: formatMoney(currentRate) },
        { label: "Date of Joining", value: formatDate(data.dateOfJoining) },
        { label: "Assignment Start", value: formatDate(data.assignmentStartDate) },
        { label: "Assignment End", value: data.assignmentEndDate ? formatDate(data.assignmentEndDate) : "Ongoing" },
        { label: "Last Date", value: formatDate(data.lastDate) },
        { label: "Status", value: data.active ? "Active" : "Inactive" },
        { label: "Project", value: projectName || data.projectId || "—" },
      ]
    : [];

  return (
    <div className="rp rp-scrim" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <aside className="rp-drawer" role="dialog" aria-modal="true" aria-label={`Resource ${resId}`}>
        <div className="rp-drawer-head">
          <div>
            <div className="rp-eyebrow" style={{ marginBottom: "4px" }}>Resource details</div>
            <h2>{data?.name || `#${resId}`}</h2>
          </div>
          <button className="rp-close" onClick={onClose} aria-label="Close">✕</button>
        </div>

        <div className="rp-drawer-body">
          {loading ? (
            <div style={{ color: "var(--rp-muted)", fontSize: "14px", padding: "8px 0" }}>Loading…</div>
          ) : error ? (
            <div className="rp-inline-error">{error}</div>
          ) : (
            <div>
              {rows.map((row) => (
                <div className="rp-detail-row" key={row.label}>
                  <span className="rp-detail-k">{row.label}</span>
                  <span className="rp-detail-v">
                    {row.label === "Status" ? (
                      <span className={`rp-pill ${data.active ? "rp-pill--on" : "rp-pill--off"}`}>
                        <span className="rp-dot" />
                        {row.value}
                      </span>
                    ) : (
                      row.value
                    )}
                  </span>
                </div>
              ))}
              {/* Rate Card by Year — read-only. This drawer is a view, so
                  the values are simply displayed; the ★ row is the year
                  currently in force. Rates come from the designation rate
                  card, which is why they can't be edited from a resource. */}
              {data.rateCardByYear && Object.keys(data.rateCardByYear).length > 0 && (
                <div style={{ marginTop: "16px" }}>
                  <div style={{ fontSize: "12px", fontWeight: 700, color: "var(--rp-muted)", textTransform: "uppercase", letterSpacing: ".06em", marginBottom: "8px" }}>Rate Card by Year</div>
                  <div style={{ border: "1px solid var(--rp-line)", borderRadius: "10px", overflow: "hidden" }}>
                    {Object.entries(data.rateCardByYear).sort(([a], [b]) => yearKeyOrder(a, b)).map(([yr, rate], i, arr) => (
                      <div key={yr} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "9px 14px", borderBottom: i < arr.length - 1 ? "1px solid var(--rp-line-2)" : "none", background: yr === `Year-${data.rateYear}` ? "var(--rp-primary-50)" : "transparent" }}>
                        <span style={{ fontSize: "13px", fontWeight: yr === `Year-${data.rateYear}` ? 700 : 500, color: yr === `Year-${data.rateYear}` ? "var(--rp-primary)" : "var(--rp-ink-2)" }}>{yr}{yr === `Year-${data.rateYear}` ? " ★" : ""}</span>
                        <span style={{ fontSize: "13px", fontWeight: 700, fontVariantNumeric: "tabular-nums", color: "var(--rp-ink)" }}>{formatMoney(rate)}</span>
                      </div>
                    ))}
                  </div>
                  <div className="rp-rate-note" style={{ marginTop: "8px" }}>
                    Set from the designation rate card — update it under Designation Rates.
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        <div className="rp-drawer-foot">
          <button className="rp-btn rp-btn-ghost" onClick={onClose}>Close</button>
          <button className="rp-btn rp-btn-primary" onClick={() => data && onEdit(data)} disabled={!data}>
            <EditIcon /> Edit
          </button>
        </div>
      </aside>
    </div>
  );
}

/* =====================================================================
   Edit drawer — PUT /api/resources/{resId}
   ===================================================================== */
function EditDrawer({ resource, onClose, onSave }) {
  const [form, setForm] = useState(() => ({
    ...resource,
    lastDate: resource.lastDate || "",
    location: resource.location || "",
  }));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const [fieldErrors, setFieldErrors] = useState({});
  const [submitted, setSubmitted] = useState(false);

  useEffect(() => {
    const onKey = (e) => e.key === "Escape" && !saving && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, saving]);

  // Read straight off the resource — rates aren't part of the edit form.
  const rateYears = Object.keys(resource.rateCardByYear || {}).sort(yearKeyOrder);

  /* One validator for the whole drawer, used to gate submit and to re-check
     a field as it's edited, so the two can never disagree. Previously only
     the rate numbers were checked — a blank name, a malformed email or a
     last date before the joining date all went to the server unexamined. */
  const validate = (f) => {
    const errs = {};

    const name = String(f.name || "").trim();
    if (!name) errs.name = "A full name is required.";
    else if (name.length > MAX_NAME) errs.name = `Keep the name under ${MAX_NAME} characters.`;

    const email = String(f.emailId || "").trim();
    if (email && !EMAIL_RE.test(email)) errs.emailId = "That doesn't look like an email address.";
    else if (email.length > MAX_TEXT) errs.emailId = `Keep the email under ${MAX_TEXT} characters.`;

    if (String(f.location || "").length > MAX_TEXT) {
      errs.location = `Keep the location under ${MAX_TEXT} characters.`;
    }
    if (String(f.designationType || "").length > MAX_TEXT) {
      errs.designationType = `Keep the designation under ${MAX_TEXT} characters.`;
    }

    if (f.dateOfJoining && !parseISODate(f.dateOfJoining)) {
      errs.dateOfJoining = "That isn't a valid date.";
    }
    if (f.lastDate && !parseISODate(f.lastDate)) {
      errs.lastDate = "That isn't a valid date.";
    }
    /* A last date before the joining date is the one date error that isn't
       obvious from the field alone, and it silently corrupts tenure maths. */
    if (
      f.dateOfJoining && f.lastDate &&
      parseISODate(f.dateOfJoining) && parseISODate(f.lastDate) &&
      f.lastDate < f.dateOfJoining
    ) {
      errs.lastDate = "The last date can't be earlier than the joining date.";
    }

    /* Rates used to be validated here. They're read-only now — the values
       go back to the server exactly as they arrived, so there's nothing
       the user can enter for this drawer to reject. */

    return errs;
  };

  const set = (key) => (e) => {
    const value = key === "active" ? e.target.checked : e.target.value;
    setForm((f) => {
      const next = { ...f, [key]: value };
      if (submitted) setFieldErrors(validate(next));
      return next;
    });
    if (error) setError(null);
  };

  async function submit() {
    if (saving) return;                       // guards a double-click
    setError(null);
    setSubmitted(true);

    const errs = validate(form);
    setFieldErrors(errs);
    const firstBad = Object.keys(errs)[0];
    if (firstBad) {
      document.getElementById(`res-${firstBad}`)?.focus();
      // The summary names the count; each field carries its own message.
      setError(
        Object.keys(errs).length === 1
          ? errs[firstBad]
          : `${Object.keys(errs).length} fields need attention before saving.`
      );
      return;
    }

    setSaving(true);
    try {
      const payload = {
        ...resource,
        ...Object.fromEntries(
          // Trim on the way out so a stray space isn't persisted as data.
          EDITABLE_FIELDS.map((k) => [k, typeof form[k] === "string" ? form[k].trim() : form[k]])
        ),
        lastDate: form.lastDate ? form.lastDate : null,
        /* Echoed back untouched — the drawer can't change these, but the PUT
           schema still expects the map, so it's rebuilt from the resource. */
        rateCardByYear: Object.fromEntries(
          rateYears.map((yr) => {
            const raw = resource.rateCardByYear?.[yr];
            return [yr, raw === "" || raw == null ? 0 : Number(raw)];
          })
        ),
      };
      // rateCard isn't part of the PUT schema — the per-year map replaces it.
      delete payload.rateCard;
      await onSave(payload);
      onClose();
    } catch (e) {
      setError(requestErrorMessage(e, "Couldn't save the changes. Please try again."));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div
      className="rp rp-scrim"
      onMouseDown={(e) => e.target === e.currentTarget && !saving && onClose()}
    >
      <aside className="rp-drawer" role="dialog" aria-modal="true" aria-label={`Edit ${resource.name}`}>
        <div className="rp-drawer-head">
          <div>
            <div className="rp-eyebrow" style={{ marginBottom: "4px" }}>Edit resource</div>
            <h2>{resource.name}</h2>
          </div>
          <button className="rp-close" onClick={onClose} aria-label="Close">✕</button>
        </div>

        <div className="rp-drawer-body" style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
          <div className="rp-readonly">
            <span>Resource ID</span>
            <b>{resource.resId}</b>
          </div>

          <EditField label="Full name" error={fieldErrors.name}>
            <input
              id="res-name"
              className={`rp-input${fieldErrors.name ? " is-bad" : ""}`}
              maxLength={MAX_NAME}
              aria-invalid={!!fieldErrors.name}
              value={form.name || ""}
              onChange={set("name")}
            />
          </EditField>

          <EditField label="Email" error={fieldErrors.emailId}>
            <input
              id="res-emailId"
              className={`rp-input${fieldErrors.emailId ? " is-bad" : ""}`}
              type="email"
              maxLength={MAX_TEXT}
              aria-invalid={!!fieldErrors.emailId}
              value={form.emailId || ""}
              onChange={set("emailId")}
            />
          </EditField>

          <EditField label="Designation" error={fieldErrors.designationType}>
            <input
              id="res-designationType"
              className={`rp-input${fieldErrors.designationType ? " is-bad" : ""}`}
              maxLength={MAX_TEXT}
              value={form.designationType || ""}
              onChange={set("designationType")}
            />
          </EditField>

          <div className="rp-grid-2">
            <EditField label="Location" error={fieldErrors.location}>
              <input
                id="res-location"
                className={`rp-input${fieldErrors.location ? " is-bad" : ""}`}
                maxLength={MAX_TEXT}
                value={form.location || ""}
                onChange={set("location")}
              />
            </EditField>
            <EditField label="Date of joining" error={fieldErrors.dateOfJoining}>
              <input
                id="res-dateOfJoining"
                className={`rp-input${fieldErrors.dateOfJoining ? " is-bad" : ""}`}
                type="date"
                max={form.lastDate || undefined}
                value={form.dateOfJoining || ""}
                onChange={set("dateOfJoining")}
              />
            </EditField>
          </div>

          <div className="rp-grid-2">
            <EditField label="Last date" error={fieldErrors.lastDate}>
              <input
                id="res-lastDate"
                className={`rp-input${fieldErrors.lastDate ? " is-bad" : ""}`}
                type="date"
                min={form.dateOfJoining || undefined}
                aria-invalid={!!fieldErrors.lastDate}
                value={form.lastDate || ""}
                onChange={set("lastDate")}
              />
            </EditField>
            <EditField label="Status">
              <label className="rp-switch">
                <input type="checkbox" checked={!!form.active} onChange={set("active")} />
                <span className={`rp-track ${form.active ? "on" : ""}`}>
                  <span className="rp-thumb" />
                </span>
                <span style={{ fontSize: "14px", fontWeight: 600, color: "var(--rp-ink)" }}>
                  {form.active ? "Active" : "Inactive"}
                </span>
              </label>
            </EditField>
          </div>

          {/* Rate card — READ ONLY. Rates are derived from the designation
              rate card upload, not from the individual resource, so editing
              them here would put one person out of step with everyone on the
              same designation. Shown for reference; change them by
              re-uploading Designation Rates. */}
          <EditField label="Rate card by year (₹)">
            {rateYears.length === 0 ? (
              <div className="rp-rate-empty">No rate card years set for this resource.</div>
            ) : (
              <div className="rp-rate-list">
                {rateYears.map((yr) => (
                  <div className="rp-rate-row" key={yr}>
                    <span className="rp-rate-year">
                      {yr}
                      {yr === `Year-${resource.rateYear}` && (
                        <span className="rp-rate-current">current</span>
                      )}
                    </span>
                    <span className="rp-rate-value">
                      {formatMoney(resource.rateCardByYear?.[yr])}
                    </span>
                  </div>
                ))}
                <div className="rp-rate-note">
                  Set from the designation rate card — update it under
                  Designation Rates.
                </div>
              </div>
            )}
          </EditField>

          {error && (
            <div className="rp-inline-error">
              <span style={{ fontSize: "16px" }}>!</span>
              {error}
            </div>
          )}
        </div>

        <div className="rp-drawer-foot">
          <button className="rp-btn rp-btn-ghost" onClick={onClose} disabled={saving}>Cancel</button>
          <button className="rp-btn rp-btn-primary" onClick={submit} disabled={saving}>
            {saving ? "Saving…" : "Save changes"}
          </button>
        </div>
      </aside>
    </div>
  );
}

function ApiResponseModal({ response, onClose }) {
  useEffect(() => {
    const onKey = (e) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  if (!response) return null;
  const { title, ok, status, data } = response;

  /* Every branch here ends at a sentence. The previous version fell back to
     JSON.stringify(e) for an unrecognised error entry and returned raw
     strings unchecked, which put serialised bodies and HTML error pages in
     front of the user; both now go through the shared readability gate. */
  const GENERIC = "Something went wrong. Please try again.";
  function extractErrorMessage(d) {
    if (d == null) return GENERIC;
    if (typeof d === "string") {
      return isReadableMessage(d) ? d.trim() : GENERIC;
    }
    if (typeof d === "object") {
      const fromList = Array.isArray(d.errors)
        ? d.errors
            .map((e) => (typeof e === "string" ? e : e?.message || e?.defaultMessage || ""))
            .filter((line) => line && isReadableMessage(line))
            .join("\n")
        : "";
      const candidate = [d.message, d.error, d.detail, d.errorMessage, d.msg, fromList].find(
        (v) => typeof v === "string" && v.trim() && isReadableMessage(v)
      );
      return candidate ? candidate.trim() : GENERIC;
    }
    return GENERIC;
  }

  // Success is always a human-readable line. If a caller ever hands us an
  // object, fall back to a generic confirmation rather than dumping JSON.
  const successMessage =
    typeof data === "string" && data.trim()
      ? data.trim()
      : "Details updated successfully.";

  return (
    <div className="rp rp-modal-scrim" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="rp-modal" role="dialog" aria-modal="true" aria-label={title}>
        <div className="rp-modal-head">
          <div>
            <div className="rp-eyebrow" style={{ marginBottom: "4px", color: ok ? "var(--rp-success)" : "var(--rp-danger)" }}>
              {ok ? "Success" : "Error"} {status != null ? `· ${status}` : ""}
            </div>
            <h2>{title}</h2>
          </div>
          <button className="rp-close" onClick={onClose} aria-label="Close">✕</button>
        </div>

        <div className="rp-modal-body">
          {ok ? (
            <div className="rp-inline-success">
              <span style={{ fontSize: "16px" }}>✓</span>
              {successMessage}
            </div>
          ) : (
            <div className="rp-inline-error">
              <span style={{ fontSize: "16px" }}>!</span>
              {extractErrorMessage(data)}
            </div>
          )}
        </div>

        <div className="rp-modal-foot">
          <button className="rp-btn rp-btn-primary" onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  );
}

function EditField({ label, children, error }) {
  return (
    <label className="rp-field">
      <span>{label}</span>
      {children}
      {/* The message belongs with the control it's about — a single banner
          at the foot makes the user hunt for which field is wrong. */}
      {error && <span className="rp-field-err">{error}</span>}
    </label>
  );
}

function TableSkeleton() {
  return (
    <div className="rp-scroll">
      <table className="rp-table">
        <thead>
          <tr>
            {COLUMNS.map((col) => (
              <th key={col.key} className="rp-th" data-align={col.align}>
                <span className="rp-th-inner">{col.label}</span>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {Array.from({ length: 6 }).map((_, i) => (
            <tr key={i} style={{ borderBottom: "1px solid var(--rp-line-2)" }}>
              {COLUMNS.map((col) => (
                <td key={col.key} className="rp-td">
                  <div className="rp-skel-bar" style={{ width: col.key === "name" ? "80%" : "60%" }} />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/* ---------- RateCardCell — shows current year rate; hover reveals all years ----------
   Currently unreferenced: the Rate card column is commented out of COLUMNS
   and the table body. Kept intact so restoring the column is a one-line
   change rather than a rewrite. */
function RateCardCell({ resource: r }) {
  const [open, setOpen] = useState(false);
  const hasYears = r.rateCardByYear && Object.keys(r.rateCardByYear).length > 0;
  const currentRate = hasYears && r.rateYear
    ? r.rateCardByYear[`Year-${r.rateYear}`]
    : r.rateCard;

  return (
    <div
      className="rp-rate-wrap"
      onMouseEnter={() => hasYears && setOpen(true)}
      onMouseLeave={() => setOpen(false)}
      onClick={(e) => { e.stopPropagation(); hasYears && setOpen((v) => !v); }}
    >
      <span style={{ fontVariantNumeric: "tabular-nums", fontWeight: 600 }}>
        {formatMoney(currentRate)}
      </span>
      {r.rateYear && (
        <span style={{ fontSize: "11px", color: "var(--rp-primary)", background: "var(--rp-primary-50)", borderRadius: 5, padding: "1px 5px", fontWeight: 700 }}>
          Yr {r.rateYear}
        </span>
      )}
      {hasYears && <span style={{ fontSize: "10px", color: "var(--rp-faint)" }}>▾</span>}
      {open && hasYears && (
        <div className="rp-rate-popover">
          <div style={{ fontSize: "11px", fontWeight: 700, color: "var(--rp-muted)", padding: "4px 14px 6px", textTransform: "uppercase", letterSpacing: ".06em", borderBottom: "1px solid var(--rp-line-2)" }}>
            Rate Card by Year
          </div>
          {Object.entries(r.rateCardByYear).map(([yr, rate]) => {
            const isActive = yr === `Year-${r.rateYear}`;
            return (
              <div key={yr} className={`rp-rate-popover-row${isActive ? " active" : ""}`}>
                <span className="yr">{yr}{isActive ? " ★" : ""}</span>
                <span className="amt">{formatMoney(rate)}</span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

/* ---------- inline icons ---------- */
const SearchIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <circle cx="11" cy="11" r="7" />
    <path d="m21 21-4.3-4.3" />
  </svg>
);
const RefreshIcon = ({ spinning }) => (
  <svg
    style={spinning ? { animation: "rp-spin 1s linear infinite" } : {}}
    width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
  >
    <path d="M21 12a9 9 0 1 1-2.64-6.36" />
    <path d="M21 3v6h-6" />
  </svg>
);
const UploadIcon = () => (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <path d="M12 16V4m0 0 4 4m-4-4-4 4" />
    <path d="M4 16v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2" />
  </svg>
);
// Mirror of UploadIcon with the arrow reversed.
const DownloadIcon = () => (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <path d="M12 4v12m0 0 4-4m-4 4-4-4" />
    <path d="M4 16v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2" />
  </svg>
);
const EditIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <path d="M12 20h9" />
    <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" />
  </svg>
);