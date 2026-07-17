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

const API_BASE = "http://10.1.131.199:8019"; // move to env / your api client

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
  "rateCard",
  "dateOfJoining",
  "lastDate",
  "designationType",
  "active",
];

// Table columns — drives both the header and sorting. One source of truth.
const COLUMNS = [
  { key: "resId", label: "ID", align: "left", sortable: true },
  { key: "name", label: "Name", align: "left", sortable: true },
  { key: "designationType", label: "Designation", align: "left", sortable: true },
  { key: "rateCard", label: "Rate card", align: "right", sortable: true },
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

  // table data
  const [resources, setResources] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(null);

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

  // ---------- load: GET /api/resources ----------
  const loadResources = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const token = getToken();
      // The API is project-aware — pass projectId so the server returns only
      // this project's resources instead of the whole list.
      const url = projectId
        ? `${API_BASE}/api/resources?projectId=${encodeURIComponent(projectId)}`
        : `${API_BASE}/api/resources`;
      const res = await fetch(url, {
        headers: { accept: "*/*", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      });
      if (!res.ok) throw new Error(`Couldn't load resources (${res.status})`);
      const data = await res.json();
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
      setResources(scoped);
    } catch (e) {
      setLoadError(e.message || "Couldn't load resources");
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    loadResources();
  }, [loadResources]);

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

  // ---------- server lookup: GET /api/resources/{resId} ----------
  async function fetchById(resId) {
    setServerSearching(true);
    try {
      const token = getToken();
      const res = await fetch(
        `${API_BASE}/api/resources/${encodeURIComponent(resId)}`,
        { headers: { accept: "*/*", ...(token ? { Authorization: `Bearer ${token}` } : {}) } }
      );
      if (res.status === 404) {
        pushToast({ type: "warn", title: "Not found", msg: `No resource matches ${resId}.` });
        return;
      }
      if (!res.ok) throw new Error(`Lookup failed (${res.status})`);
      const data = await res.json();
      setResources((prev) =>
        prev.some((r) => r.resId === data.resId)
          ? prev.map((r) => (r.resId === data.resId ? data : r))
          : [data, ...prev]
      );
      pushToast({ type: "ok", title: "Found on server", msg: `${data.name} (${data.resId}) added to the list.` });
    } catch (e) {
      pushToast({ type: "error", title: "Lookup failed", msg: e.message || "Please try again." });
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
    setApiResponse({
      title: "Save failed",
      ok: false,
      status: null,
      data: { message: err.message },
    });
    throw err; // let EditDrawer still show its inline error + stay open
  }

  const text = await res.text();
  let body;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text; // non-JSON body — show raw text
  }

  if (!res.ok) {
    setApiResponse({ title: "Save failed", ok: false, status: res.status, data: body });
    throw new Error(`Save failed (${res.status})`);
  }

  const saved = body || updated;
  setResources((prev) =>
    prev.map((r) => (r.resId === saved.resId ? { ...r, ...saved } : r))
  );

  setApiResponse({ title: "Changes saved", ok: true, status: res.status, data: saved });
  pushToast({ type: "ok", title: "Changes saved", msg: `${saved.name || "Resource"} updated.` });
  return saved;
}

  // ---------- upload: POST /api/resources/upload ----------
  async function uploadFile(file) {
  if (!file || !projectId) return;
  setUploading(true);

  const formData = new FormData();
  formData.append("file", file);

  try {
    const token = getToken();
    const res = await fetch(
      `${API_BASE}/api/resources/upload?projectId=${encodeURIComponent(projectId)}`,
      {
        method: "POST",
        headers: { accept: "*/*", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: formData,
      }
    );

    // read body regardless of status, so we can show it either way
    const text = await res.text();
    let data;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      data = text; // not JSON — show raw text
    }

    if (!res.ok) {
      setApiResponse({ title: "Import failed", ok: false, status: res.status, data });
      pushToast({ type: "error", title: "Import failed", msg: `Server responded ${res.status}.` });
      return;
    }

    setApiResponse({ title: "Import complete", ok: true, status: res.status, data });
    pushToast({ type: "ok", title: "Import complete", msg: "Resources imported and the table refreshed." });
    await loadResources();
  } catch (err) {
    setApiResponse({ title: "Import failed", ok: false, status: null, data: { message: err.message } });
    pushToast({ type: "error", title: "Import failed", msg: err.message || "Check the file and try again." });
  } finally {
    setUploading(false);
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
            className="rp-btn rp-btn-primary"
            onClick={() => fileInputRef.current?.click()}
            disabled={uploading || !projectId}
            title={projectId ? "Import resources from an Excel file" : "Open a project first"}
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
            <div className="rp-empty-emoji">{query ? "🔍" : "👥"}</div>
            <h3>{query ? "No matching resources" : "No resources yet"}</h3>
            <p>
              {query
                ? showServerFallback
                  ? "This ID isn't loaded on this page. Search the server to pull it in."
                  : "Try a different name, email, ID, or designation."
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
                disabled={!projectId}
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
                      className="rp-row"
                      onClick={() => setViewingId(r.resId)}
                      title="View resource details"
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
                      <td className="rp-td" data-align="right" style={{ whiteSpace: "nowrap" }}>
                        <RateCardCell resource={r} />
                      </td>
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
        if (!res.ok) throw new Error(`Couldn't load resource (${res.status})`);
        const json = await res.json();
        if (active) setData(json);
      } catch (e) {
        if (active && e.name !== "AbortError")
          setError(e.message || "Couldn't load resource");
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
        { label: "Email", value: data.emailId || "—" },
        { label: "Location", value: data.location || "—" },
        { label: "Designation", value: data.designationType || "—" },
        { label: "Category", value: data.category || "—" },
        { label: "Category Details", value: data.categoryDetails || "—" },
        { label: "Rate Year", value: data.rateYear ? `Year-${data.rateYear}` : "—" },
        { label: "Rate (Current Year)", value: formatMoney(currentRate) },
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
              {data.rateCardByYear && Object.keys(data.rateCardByYear).length > 0 && (
                <div style={{ marginTop: "16px" }}>
                  <div style={{ fontSize: "12px", fontWeight: 700, color: "var(--rp-muted)", textTransform: "uppercase", letterSpacing: ".06em", marginBottom: "8px" }}>Rate Card by Year</div>
                  <div style={{ border: "1px solid var(--rp-line)", borderRadius: "10px", overflow: "hidden" }}>
                    {Object.entries(data.rateCardByYear).map(([yr, rate], i) => (
                      <div key={yr} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "9px 14px", borderBottom: i < Object.keys(data.rateCardByYear).length - 1 ? "1px solid var(--rp-line-2)" : "none", background: yr === `Year-${data.rateYear}` ? "var(--rp-primary-50)" : "transparent" }}>
                        <span style={{ fontSize: "13px", fontWeight: yr === `Year-${data.rateYear}` ? 700 : 500, color: yr === `Year-${data.rateYear}` ? "var(--rp-primary)" : "var(--rp-ink-2)" }}>{yr}{yr === `Year-${data.rateYear}` ? " ★" : ""}</span>
                        <span style={{ fontSize: "13px", fontWeight: 700, fontVariantNumeric: "tabular-nums", color: "var(--rp-ink)" }}>{formatMoney(rate)}</span>
                      </div>
                    ))}
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
    rateCard: resource.rateCard ?? "",
  }));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    const onKey = (e) => e.key === "Escape" && !saving && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, saving]);

  const set = (key) => (e) => {
    const value = key === "active" ? e.target.checked : e.target.value;
    setForm((f) => ({ ...f, [key]: value }));
  };

  async function submit() {
    setSaving(true);
    setError(null);
    try {
      const payload = {
        ...resource,
        ...Object.fromEntries(EDITABLE_FIELDS.map((k) => [k, form[k]])),
        lastDate: form.lastDate ? form.lastDate : null,
        rateCard:
          form.rateCard === "" || form.rateCard == null ? null : Number(form.rateCard),
      };
      await onSave(payload);
      onClose();
    } catch (e) {
      setError(e.message || "Save failed");
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

          <EditField label="Full name">
            <input className="rp-input" value={form.name || ""} onChange={set("name")} />
          </EditField>

          <EditField label="Email">
            <input className="rp-input" type="email" value={form.emailId || ""} onChange={set("emailId")} />
          </EditField>

          <EditField label="Designation">
            <input className="rp-input" value={form.designationType || ""} onChange={set("designationType")} />
          </EditField>

          <div className="rp-grid-2">
            <EditField label="Rate card (₹)">
              <input
                className="rp-input"
                type="number"
                inputMode="numeric"
                value={form.rateCard}
                onChange={set("rateCard")}
              />
            </EditField>
            <EditField label="Date of joining">
              <input className="rp-input" type="date" value={form.dateOfJoining || ""} onChange={set("dateOfJoining")} />
            </EditField>
          </div>

          <div className="rp-grid-2">
            <EditField label="Last date">
              <input className="rp-input" type="date" value={form.lastDate || ""} onChange={set("lastDate")} />
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

  function extractErrorMessage(d) {
    if (d == null) return "Something went wrong. Please try again.";
    if (typeof d === "string") return d.trim() || "Something went wrong. Please try again.";
    if (typeof d === "object") {
      return (
        d.message ||
        d.error ||
        d.detail ||
        d.errorMessage ||
        d.msg ||
        (Array.isArray(d.errors) && d.errors.length
          ? d.errors.map((e) => (typeof e === "string" ? e : e.message || JSON.stringify(e))).join("\n")
          : null) ||
        "Something went wrong. Please try again."
      );
    }
    return String(d);
  }

  const pretty = typeof data === "string" ? data : JSON.stringify(data, null, 2);

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
            data == null ? (
              <div style={{ color: "var(--rp-muted)", fontSize: "14px" }}>No response body.</div>
            ) : (
              <pre
                style={{
                  margin: 0,
                  fontSize: "12.5px",
                  lineHeight: 1.5,
                  background: "var(--rp-surface-2)",
                  border: "1px solid var(--rp-line)",
                  borderRadius: "10px",
                  padding: "14px",
                  overflowX: "auto",
                  whiteSpace: "pre-wrap",
                  wordBreak: "break-word",
                  color: "var(--rp-ink)",
                }}
              >
                {pretty}
              </pre>
            )
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

function EditField({ label, children }) {
  return (
    <label className="rp-field">
      <span>{label}</span>
      {children}
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

/* ---------- RateCardCell — shows current year rate; hover reveals all years ---------- */
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
const EditIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <path d="M12 20h9" />
    <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" />
  </svg>
);