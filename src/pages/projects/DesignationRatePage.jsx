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
  readErrorMessage, readJsonBody, requestErrorMessage, messageFromBody, isReadableMessage,
} from "../../utils/apiMessage";

// Resource service — same host/port as the Resource and Attendance pages.
const API_BASE = "http://10.1.131.199:8019"; // move to env / your api client

/* A rate-card workbook is small; anything past this is the wrong file. */
const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;

const fmtBytes = (n) => {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
};

/* An .xlsx is a zip and an .xls a compound file, so browsers report their
   MIME types inconsistently (and not at all for some drag sources) — the
   extension is the reliable check. Returns "" when the file is usable. */
function validateSheetFile(f) {
  if (!f) return "Choose a file to upload.";
  if (!/\.(xlsx|xls)$/i.test(f.name || "")) {
    return "That isn't an Excel file. Choose a .xlsx or .xls file.";
  }
  if (!f.size) return "That file is empty. Choose the filled-in template.";
  if (f.size > MAX_UPLOAD_BYTES) {
    return `That file is ${fmtBytes(f.size)} — the limit is ${fmtBytes(MAX_UPLOAD_BYTES)}.`;
  }
  return "";
}

// ---------- formatting helpers ----------
const money = new Intl.NumberFormat("en-IN", {
  style: "currency",
  currency: "INR",
  maximumFractionDigits: 0,
});
const formatMoney = (v) =>
  v == null || v === "" ? "—" : money.format(Number(v));

// rateCardByYear keys look like "Year-1", "Year-2", "Year-10" — sort by the
// trailing number so 10 doesn't land between 1 and 2.
const yearKeyOrder = (a, b) =>
  (parseInt(String(a).replace(/\D+/g, ""), 10) || 0) -
  (parseInt(String(b).replace(/\D+/g, ""), 10) || 0);

// The year columns are whatever the API returned — different orgs can carry
// different contract lengths, so the union across all rows drives the header.
const collectYears = (rows) => {
  const set = new Set();
  rows.forEach((r) =>
    Object.keys(r?.rateCardByYear || {}).forEach((k) => set.add(k))
  );
  return [...set].sort(yearKeyOrder);
};

const STYLES = `
.dr {
  --dr-primary: #0b3c88;
  --dr-primary-700: #062a63;
  --dr-primary-50: #eef3fb;
  --dr-ink: #0f1c33;
  --dr-ink-2: #334155;
  --dr-muted: #64748b;
  --dr-faint: #94a3b8;
  --dr-line: #e6ecf3;
  --dr-line-2: #eef2f7;
  --dr-surface: #ffffff;
  --dr-surface-2: #f7f9fd;
  --dr-success: #0f9d58;
  --dr-success-bg: #e7f7ee;
  --dr-warn: #b45309;
  --dr-warn-bg: #fef3c7;
  --dr-danger: #dc2626;
  --dr-danger-bg: #fdecec;
  --dr-shadow-sm: 0 1px 2px rgba(15,28,51,0.06);
  --dr-shadow-md: 0 6px 20px rgba(15,28,51,0.08);
  color: var(--dr-ink-2);
}

.dr-eyebrow {
  font-size: 12px; font-weight: 700; letter-spacing: .09em;
  text-transform: uppercase; color: var(--dr-primary);
}
.dr-stats { display: flex; gap: 10px; flex-wrap: wrap; margin-top: 18px; }
.dr-stat {
  display: inline-flex; align-items: center; gap: 10px;
  padding: 9px 14px; border-radius: 999px;
  background: var(--dr-surface); border: 1px solid var(--dr-line);
  box-shadow: var(--dr-shadow-sm); font-size: 13px; color: var(--dr-muted);
}
.dr-stat b { color: var(--dr-ink); font-size: 15px; font-variant-numeric: tabular-nums; }

/* ---- toolbar ---- */
.dr-toolbar {
  display: flex; gap: 12px; align-items: center;
  justify-content: space-between; margin-bottom: 10px; flex-wrap: wrap;
}
.dr-toolbar-left { display: flex; gap: 12px; align-items: center; flex-wrap: wrap; flex: 1; }
.dr-search {
  position: relative; display: flex; align-items: center; flex: 1;
  min-width: 220px; max-width: 380px; background: var(--dr-surface);
  border: 1px solid var(--dr-line); border-radius: 11px; padding: 0 10px 0 12px;
  box-shadow: var(--dr-shadow-sm); transition: border-color .18s, box-shadow .18s;
}
.dr-search:focus-within { border-color: var(--dr-primary); box-shadow: 0 0 0 3px var(--dr-primary-50); }
.dr-search svg { color: var(--dr-faint); flex-shrink: 0; }
.dr-search input {
  border: none; outline: none; background: transparent; flex: 1;
  padding: 11px 10px; font-size: 14px; color: var(--dr-ink); font-family: inherit;
}
.dr-iconbtn {
  border: none; background: transparent; color: var(--dr-faint); cursor: pointer;
  height: 30px; width: 30px; border-radius: 7px; display: flex;
  align-items: center; justify-content: center; transition: background .15s, color .15s;
}
.dr-iconbtn:hover { background: var(--dr-line-2); color: var(--dr-ink); }

.dr-org { display: flex; align-items: center; gap: 8px; }
.dr-org > span { font-size: 12.5px; font-weight: 600; color: var(--dr-muted); white-space: nowrap; }
.dr-select {
  border: 1px solid var(--dr-line); border-radius: 10px; padding: 10px 12px;
  font-size: 14px; color: var(--dr-ink); background: var(--dr-surface);
  font-family: inherit; outline: none; box-shadow: var(--dr-shadow-sm);
  min-width: 200px; max-width: 320px; transition: border-color .15s, box-shadow .15s;
}
.dr-select:focus { border-color: var(--dr-primary); box-shadow: 0 0 0 3px var(--dr-primary-50); }
.dr-select[disabled] { background: var(--dr-surface-2); color: var(--dr-muted); cursor: not-allowed; }

.dr-actions { display: flex; gap: 10px; flex-wrap: wrap; }
.dr-btn {
  display: inline-flex; align-items: center; gap: 8px; border-radius: 10px;
  font-size: 14px; font-weight: 600; padding: 10px 16px; cursor: pointer;
  font-family: inherit; transition: background .18s, border-color .18s, box-shadow .18s, transform .05s;
}
.dr-btn:active { transform: translateY(1px); }
.dr-btn:focus-visible { outline: 3px solid var(--dr-primary-50); outline-offset: 1px; }
.dr-btn[disabled] { cursor: not-allowed; opacity: .55; }
.dr-btn-ghost { border: 1px solid var(--dr-line); background: var(--dr-surface); color: var(--dr-ink); box-shadow: var(--dr-shadow-sm); }
.dr-btn-ghost:not([disabled]):hover { background: var(--dr-surface-2); }
.dr-btn-primary { border: none; background: var(--dr-primary); color: #fff; box-shadow: 0 2px 6px rgba(11,60,136,.22); }
.dr-btn-primary:not([disabled]):hover { background: var(--dr-primary-700); }

.dr-caption { font-size: 13px; color: var(--dr-muted); margin: 2px 0 18px; }
.dr-caption b { color: var(--dr-ink); }

/* ---- card + table ---- */
.dr-card { overflow: hidden; border: 1px solid var(--dr-line); border-radius: 14px; background: var(--dr-surface); box-shadow: var(--dr-shadow-md); }
.dr-scroll { overflow-x: auto; }
.dr-table { width: 100%; border-collapse: collapse; font-size: 14px; }
.dr-th {
  position: sticky; top: 0; background: var(--dr-surface-2); color: var(--dr-muted);
  font-size: 11.5px; font-weight: 700; letter-spacing: .05em; text-transform: uppercase;
  padding: 13px 16px; border-bottom: 1px solid var(--dr-line); white-space: nowrap; z-index: 1;
  text-align: left;
}
.dr-th[data-align="right"] { text-align: right; }
/* The role column stays put while the year columns scroll sideways. */
.dr-th--role, .dr-td--role {
  position: sticky; left: 0; z-index: 2;
  box-shadow: 1px 0 0 var(--dr-line);
}
.dr-th--role { background: var(--dr-surface-2); }
.dr-td--role { background: var(--dr-surface); }
.dr-row:hover .dr-td--role { background: var(--dr-surface-2); }
button.dr-th-btn {
  border: none; background: transparent; font: inherit; color: inherit; padding: 0;
  letter-spacing: inherit; text-transform: inherit; cursor: pointer; transition: color .15s;
  display: inline-flex; align-items: center; gap: 6px;
}
button.dr-th-btn:hover { color: var(--dr-primary); }
.dr-th .arrow { font-size: 10px; opacity: .45; transition: opacity .15s; }
.dr-th[aria-sort="ascending"] .arrow,
.dr-th[aria-sort="descending"] .arrow { opacity: 1; color: var(--dr-primary); }

.dr-row { border-bottom: 1px solid var(--dr-line-2); transition: background .16s, box-shadow .16s; }
.dr-row:last-child { border-bottom: none; }
.dr-row:hover { background: var(--dr-surface-2); box-shadow: inset 3px 0 0 var(--dr-primary); }
.dr-td { padding: 12px 16px; vertical-align: middle; color: var(--dr-ink); white-space: nowrap; }
.dr-td[data-align="right"] { text-align: right; font-variant-numeric: tabular-nums; }
.dr-role { font-weight: 600; color: var(--dr-ink); white-space: normal; min-width: 240px; display: block; }
.dr-id { font-size: 12px; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; color: var(--dr-faint); margin-top: 2px; }

/* ---- states ---- */
.dr-empty { text-align: center; padding: 64px 24px; }
.dr-empty-emoji { font-size: 44px; margin-bottom: 14px; opacity: .55; }
.dr-empty h3 { font-size: 16px; font-weight: 700; color: var(--dr-ink); margin: 0 0 8px; }
.dr-empty p { color: var(--dr-muted); font-size: 14px; max-width: 420px; margin: 0 auto 24px; line-height: 1.5; }

.dr-skel-bar { height: 12px; border-radius: 6px; background: linear-gradient(90deg, var(--dr-line-2) 25%, #e2e8f2 37%, var(--dr-line-2) 63%); background-size: 400% 100%; animation: dr-skel 1.3s ease infinite; }

.dr-inline-error { background: var(--dr-danger-bg); border: 1px solid #f5c9c9; color: var(--dr-danger); border-radius: 10px; padding: 12px 14px; font-size: 13.5px; display: flex; align-items: center; gap: 10px; }
.dr-inline-success { background: var(--dr-success-bg); border: 1px solid #bfe6cf; color: var(--dr-success); border-radius: 10px; padding: 12px 14px; font-size: 13.5px; font-weight: 600; display: flex; align-items: center; gap: 10px; }
.dr-inline-warn { background: var(--dr-warn-bg); border: 1px solid #f2ddab; color: var(--dr-warn); border-radius: 10px; padding: 12px 14px; font-size: 13.5px; display: flex; align-items: center; gap: 10px; margin-bottom: 16px; }

/* ---- upload summary ---- */
.dr-summary { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; margin-top: 14px; }
.dr-summary-cell { border: 1px solid var(--dr-line); border-radius: 10px; padding: 12px 14px; background: var(--dr-surface-2); }
.dr-summary-cell b { display: block; font-size: 22px; color: var(--dr-ink); font-variant-numeric: tabular-nums; }
.dr-summary-cell span { font-size: 12px; color: var(--dr-muted); font-weight: 600; }

/* ---- toasts ---- */
.dr-toasts { position: fixed; right: 20px; bottom: 20px; z-index: 1100; display: flex; flex-direction: column; gap: 10px; max-width: 360px; }
.dr-toast {
  display: flex; align-items: flex-start; gap: 11px; padding: 13px 14px; border-radius: 11px;
  background: var(--dr-surface); box-shadow: var(--dr-shadow-md); border: 1px solid var(--dr-line);
  animation: dr-toast-in .22s cubic-bezier(.2,.8,.2,1);
}
.dr-toast-ic { width: 22px; height: 22px; border-radius: 6px; display: flex; align-items: center; justify-content: center; font-size: 13px; flex-shrink: 0; margin-top: 1px; }
.dr-toast--ok { border-left: 3px solid var(--dr-success); }
.dr-toast--ok .dr-toast-ic { background: var(--dr-success-bg); color: var(--dr-success); }
.dr-toast--error { border-left: 3px solid var(--dr-danger); }
.dr-toast--error .dr-toast-ic { background: var(--dr-danger-bg); color: var(--dr-danger); }
.dr-toast--warn { border-left: 3px solid var(--dr-warn); }
.dr-toast--warn .dr-toast-ic { background: var(--dr-warn-bg); color: var(--dr-warn); }
.dr-toast-title { font-size: 13.5px; font-weight: 700; color: var(--dr-ink); }
.dr-toast-msg { font-size: 13px; color: var(--dr-muted); margin-top: 1px; line-height: 1.4; }
.dr-toast-x { border: none; background: transparent; color: var(--dr-faint); cursor: pointer; font-size: 14px; padding: 2px 4px; border-radius: 5px; }
.dr-toast-x:hover { color: var(--dr-ink); }

/* ---- centered popup modal ---- */
.dr-modal-scrim {
  position: fixed; inset: 0; background: rgba(11,42,99,.42); backdrop-filter: blur(2px);
  display: flex; align-items: center; justify-content: center; z-index: 1000;
  animation: dr-fade .15s ease; padding: 20px;
}
.dr-modal {
  width: min(480px, 100%); max-height: 85vh; background: var(--dr-surface);
  border-radius: 16px; display: flex; flex-direction: column; overflow: hidden;
  box-shadow: 0 20px 60px rgba(11,23,42,.28);
  animation: dr-modal-in .18s cubic-bezier(.2,.8,.2,1);
}
.dr-modal-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 16px; padding: 22px 24px 16px; }
.dr-modal-head h2 { margin: 2px 0 0; font-size: 19px; font-weight: 700; letter-spacing: -.01em; color: var(--dr-ink); }
.dr-modal-body { padding: 0 24px 22px; overflow-y: auto; flex: 1; }
.dr-modal-foot { display: flex; justify-content: flex-end; gap: 10px; padding: 16px 24px; border-top: 1px solid var(--dr-line); background: var(--dr-surface-2); }
.dr-close {
  border: none; background: var(--dr-line-2); color: var(--dr-muted); width: 30px; height: 30px;
  border-radius: 8px; cursor: pointer; font-size: 17px; line-height: 1; display: flex;
  align-items: center; justify-content: center; transition: background .18s, color .18s; flex-shrink: 0;
}
.dr-close:hover { background: #e3e7ef; color: var(--dr-ink); }

@keyframes dr-fade { from { opacity: 0; } to { opacity: 1; } }
@keyframes dr-toast-in { from { transform: translateY(12px); opacity: 0; } to { transform: translateY(0); opacity: 1; } }
@keyframes dr-modal-in {
  from { transform: scale(.96) translateY(6px); opacity: 0; }
  to { transform: scale(1) translateY(0); opacity: 1; }
}
@keyframes dr-spin { to { transform: rotate(360deg); } }
@keyframes dr-skel { 0% { background-position: 100% 0; } 100% { background-position: -100% 0; } }

@media (max-width: 640px) {
  .dr-toasts { left: 16px; right: 16px; max-width: none; }
  .dr-summary { grid-template-columns: 1fr; }
}
@media (prefers-reduced-motion: reduce) {
  .dr *, .dr *::before, .dr *::after { animation: none !important; transition: none !important; }
}
`;

export default function DesignationRatePage() {
  const { projectId } = useParams();
  const project = useProject(projectId);
  const fileInputRef = useRef(null);

  // Organisations the rate card can be uploaded against — the project's
  // linked vendors. Fetched from the gateway because the store isn't
  // guaranteed to be hydrated on a deep link.
  const [orgs, setOrgs] = useState([]);
  const [orgsLoading, setOrgsLoading] = useState(true);
  const [organisationId, setOrganisationId] = useState("");

  const [rates, setRates] = useState([]);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState(null);
  const [uploading, setUploading] = useState(false);
  const [downloading, setDownloading] = useState(false);

  const [query, setQuery] = useState("");
  const [sort, setSort] = useState({ key: "role", dir: "asc" });

  // Result of the last upload / a failed request — shown in a modal.
  const [apiResponse, setApiResponse] = useState(null);

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
        // Vendors are only needed to pick an organisation — a failure here
        // leaves the picker empty and the page shows an explanatory notice.
        if (active) setOrgs([]);
      } finally {
        if (active) setOrgsLoading(false);
      }
    })();
    return () => { active = false; };
  }, [projectId]);

  // ---------- load: GET /api/designation-rates ----------
  const loadRates = useCallback(async () => {
    if (!projectId || !organisationId) return;
    setLoading(true);
    setLoadError(null);
    try {
      const token = getToken();
      const res = await fetch(
        `${API_BASE}${ENDPOINTS.designationRates.list(projectId, organisationId)}`,
        {
          headers: {
            accept: "*/*",
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
          },
        }
      );
      const FALLBACK = "Couldn't load the designation rates.";
      if (!res.ok) throw new Error(await readErrorMessage(res, FALLBACK));
      // An empty 200 means no rates are on file yet, not a failure.
      const data = await readJsonBody(res, FALLBACK);
      setRates(Array.isArray(data) ? data : data ? [data] : []);
    } catch (e) {
      setLoadError(requestErrorMessage(e, "Couldn't load the designation rates."));
    } finally {
      setLoading(false);
    }
  }, [projectId, organisationId]);

  useEffect(() => {
    loadRates();
  }, [loadRates]);

  // ---------- upload: POST /api/designation-rates/upload ----------
  async function uploadFile(file) {
    if (uploading) return;                    // guards a double-pick
    /* These used to return silently, so choosing a file with no organisation
       selected did nothing at all with no explanation. */
    if (!projectId) {
      pushToast({ type: "error", title: "Upload blocked", msg: "This project couldn't be identified." });
      return;
    }
    if (!organisationId) {
      pushToast({
        type: "warn",
        title: "Pick an organisation",
        msg: "Choose the organisation these rates belong to, then upload again.",
      });
      return;
    }
    /* `accept` on the input is a filter, not a guarantee — "All files" and
       drag-and-drop both bypass it, so the file is checked here. */
    const fileError = validateSheetFile(file);
    if (fileError) {
      pushToast({ type: "error", title: "Can't upload this file", msg: fileError });
      return;
    }
    setUploading(true);

    const formData = new FormData();
    formData.append("file", file);

    try {
      const token = getToken();
      const res = await fetch(
        `${API_BASE}${ENDPOINTS.designationRates.upload(projectId, organisationId)}`,
        {
          method: "POST",
          headers: { accept: "*/*", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
          body: formData,
        }
      );

      // Read the body regardless of status so the modal can show either the
      // parsed/upserted counts or the server's error message.
      const text = await res.text();
      let data;
      try {
        data = text ? JSON.parse(text) : null;
      } catch {
        data = null;   // a non-JSON body is never shown raw — see below
      }

      if (!res.ok) {
        /* The raw text used to be handed to the modal, so an HTML error page
           or a bare JSON envelope was rendered verbatim. Reduce it to one
           sentence and use that for both the modal and the toast. */
        const msg = messageFromBody(text, res.status, "The upload didn't go through. Please try again.");
        setApiResponse({ title: "Upload failed", ok: false, status: res.status, data: { message: msg } });
        pushToast({ type: "error", title: "Upload failed", msg });
        return;
      }

      setApiResponse({
        title: "Upload complete",
        ok: true,
        status: res.status,
        message: "Designation rates uploaded successfully.",
        summary: {
          rowsParsed: data?.rowsParsed,
          rolesUpserted: data?.rolesUpserted,
        },
      });
      pushToast({
        type: "ok",
        title: "Upload complete",
        msg:
          data?.rolesUpserted != null
            ? `${data.rolesUpserted} role${data.rolesUpserted === 1 ? "" : "s"} updated.`
            : "Designation rates imported.",
      });
      await loadRates();
    } catch (err) {
      const msg = requestErrorMessage(err, "The upload didn't go through. Check the file and try again.");
      setApiResponse({ title: "Upload failed", ok: false, status: null, data: { message: msg } });
      pushToast({ type: "error", title: "Upload failed", msg });
    } finally {
      setUploading(false);
    }
  }

  // ---------- template: GET /api/export/template/designation-rates ----------
  // The blank rate-card workbook, identical for every project. The response
  // is a binary .xlsx, so it's read as a blob and handed to a temporary
  // <a download> rather than parsed like the JSON endpoints.
  async function downloadTemplate() {
    setDownloading(true);
    try {
      const token = getToken();
      const res = await fetch(
        `${API_BASE}${ENDPOINTS.designationRates.exportTemplate()}`,
        { headers: { accept: "*/*", ...(token ? { Authorization: `Bearer ${token}` } : {}) } }
      );

      if (!res.ok) {
        /* An error body is text/JSON, not a spreadsheet. It used to fall back
           to text.slice(0, 200) — a raw slice of HTML or JSON on screen — so
           it now goes through the shared gate. */
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
      // The API does send a Content-Disposition filename, but unless it is
      // listed in Access-Control-Expose-Headers cross-origin JS can't read
      // it and this returns null. Kept anyway: it starts working the moment
      // the backend exposes the header.
      const disposition = res.headers.get("content-disposition") || "";
      const match = /filename\*?=(?:UTF-8'')?"?([^";]+)"?/i.exec(disposition);
      const filename = match
        ? decodeURIComponent(match[1].trim())
        : "designation_rates_template.xlsx";

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

  // ---------- filter + sort ----------
  const years = useMemo(() => collectYears(rates), [rates]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return rates;
    return rates.filter((r) => String(r.role || "").toLowerCase().includes(q));
  }, [rates, query]);

  const sorted = useMemo(() => {
    const { key, dir } = sort;
    if (!key) return filtered;
    const mul = dir === "asc" ? 1 : -1;
    return [...filtered].sort((a, b) => {
      if (key === "role") {
        return (
          String(a.role ?? "").localeCompare(String(b.role ?? ""), undefined, {
            numeric: true,
            sensitivity: "base",
          }) * mul
        );
      }
      // Sorting by a year column — missing rates sink to the bottom.
      const av = a.rateCardByYear?.[key];
      const bv = b.rateCardByYear?.[key];
      const an = av == null ? -Infinity : Number(av);
      const bn = bv == null ? -Infinity : Number(bv);
      return (an - bn) * mul;
    });
  }, [filtered, sort]);

  const toggleSort = (key) =>
    setSort((s) =>
      s.key === key
        ? { key, dir: s.dir === "asc" ? "desc" : "asc" }
        : { key, dir: "asc" }
    );

  const total = rates.length;
  const orgName = orgs.find((o) => o.id === organisationId)?.name || "";
  const canUpload = !!projectId && !!organisationId && !uploading;

  return (
    <div
      className="uidai-pmis-content dr"
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
        disabled={uploading}
        style={{ display: "none" }}
      />

      {/* Header */}
      <div style={{ marginBottom: "28px" }}>
        <div className="dr-eyebrow" style={{ marginBottom: "6px" }}>
          {project?.projectName || "Project"}
        </div>
        <h1 className="uidai-pmis-title" style={{ marginBottom: "6px" }}>
          Upload Designation Rate
        </h1>
        <p className="uidai-pmis-subtitle">
          Import the per-role rate card for an organisation and review the year-wise rates in force.
        </p>
        <div className="dr-stats">
          <span className="dr-stat">
            <b>{total}</b> role{total === 1 ? "" : "s"}
          </span>
          <span className="dr-stat">
            <b>{years.length}</b> rate year{years.length === 1 ? "" : "s"}
          </span>
          {orgName && (
            <span className="dr-stat">
              {orgName}
            </span>
          )}
        </div>
      </div>

      {!orgsLoading && orgs.length === 0 && (
        <div className="dr-inline-warn">
          <span style={{ fontSize: "16px" }}>!</span>
          No organisation is linked to this project yet. Add one on the project
          details page before uploading a designation rate card.
        </div>
      )}

      {/* Toolbar */}
      <div className="dr-toolbar">
        <div className="dr-toolbar-left">
          <label className="dr-org">
            <span>Organisation</span>
            <select
              className="dr-select"
              value={organisationId}
              onChange={(e) => setOrganisationId(e.target.value)}
              disabled={orgsLoading || orgs.length === 0}
              aria-label="Organisation"
            >
              {orgsLoading && <option value="">Loading…</option>}
              {!orgsLoading && orgs.length === 0 && (
                <option value="">No organisation available</option>
              )}
              {orgs.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.name}
                </option>
              ))}
            </select>
          </label>

          <div className="dr-search">
            <SearchIcon />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search by designation…"
              aria-label="Search designations"
            />
            {query && (
              <button
                className="dr-iconbtn"
                onClick={() => setQuery("")}
                aria-label="Clear search"
                title="Clear search"
              >
                ✕
              </button>
            )}
          </div>
        </div>

        <div className="dr-actions">
          <button
            className="dr-btn dr-btn-ghost"
            onClick={loadRates}
            disabled={loading || !organisationId}
            title="Reload designation rates"
          >
            <RefreshIcon spinning={loading} />
            Refresh
          </button>
          <button
            className="dr-btn dr-btn-ghost"
            onClick={downloadTemplate}
            disabled={downloading}
            title="Download the blank designation rate template"
          >
            <DownloadIcon />
            {downloading ? "Preparing…" : "Download Template"}
          </button>
          <button
            className="dr-btn dr-btn-primary"
            onClick={() => fileInputRef.current?.click()}
            disabled={!canUpload}
            title={
              organisationId
                ? "Upload a designation rate card (.xlsx)"
                : "Pick an organisation first"
            }
          >
            <UploadIcon />
            {uploading ? "Uploading…" : "Upload Excel"}
          </button>
        </div>
      </div>

      {/* Result caption */}
      {query ? (
        <p className="dr-caption">
          Showing <b>{sorted.length}</b> of <b>{total}</b> designations for “{query.trim()}”.
        </p>
      ) : (
        <div style={{ height: "18px" }} />
      )}

      {/* Main card */}
      <div className="dr-card">
        {loading ? (
          <TableSkeleton />
        ) : loadError ? (
          <div className="dr-empty">
            <div className="dr-empty-emoji">⚠️</div>
            <h3>{loadError}</h3>
            <p>Something went wrong while loading the rate card. Check your connection and try again.</p>
            <button className="dr-btn dr-btn-primary" onClick={loadRates}>
              <RefreshIcon /> Try again
            </button>
          </div>
        ) : sorted.length === 0 ? (
          <div className="dr-empty">
            <div className="dr-empty-emoji">{query ? "🔍" : "💰"}</div>
            <h3>{query ? "No matching designations" : "No designation rates yet"}</h3>
            <p>
              {query
                ? "Try a different designation name."
                : organisationId
                ? "Upload a spreadsheet to set the year-wise rate for each designation on this project."
                : "Pick an organisation to see its rate card."}
            </p>
            {!query && organisationId && (
              // Nothing uploaded yet is exactly when the blank template is
              // most useful, so offer it alongside the upload action.
              <div style={{ display: "flex", gap: 10, justifyContent: "center", flexWrap: "wrap" }}>
                <button
                  className="dr-btn dr-btn-ghost"
                  onClick={downloadTemplate}
                  disabled={downloading}
                >
                  <DownloadIcon /> {downloading ? "Preparing…" : "Download Template"}
                </button>
                <button
                  className="dr-btn dr-btn-primary"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={!canUpload}
                >
                  <UploadIcon /> Upload Excel
                </button>
              </div>
            )}
          </div>
        ) : (
          <div className="dr-scroll">
            <table className="dr-table">
              <thead>
                <tr>
                  <th
                    className="dr-th dr-th--role"
                    aria-sort={
                      sort.key === "role"
                        ? sort.dir === "asc"
                          ? "ascending"
                          : "descending"
                        : "none"
                    }
                  >
                    <button className="dr-th-btn" onClick={() => toggleSort("role")} title="Sort by designation">
                      Designation
                      <span className="arrow">
                        {sort.key === "role" ? (sort.dir === "asc" ? "▲" : "▼") : "↕"}
                      </span>
                    </button>
                  </th>
                  {years.map((yr) => (
                    <th
                      key={yr}
                      className="dr-th"
                      data-align="right"
                      aria-sort={
                        sort.key === yr
                          ? sort.dir === "asc"
                            ? "ascending"
                            : "descending"
                          : "none"
                      }
                    >
                      <button className="dr-th-btn" onClick={() => toggleSort(yr)} title={`Sort by ${yr}`}>
                        {yr}
                        <span className="arrow">
                          {sort.key === yr ? (sort.dir === "asc" ? "▲" : "▼") : "↕"}
                        </span>
                      </button>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {sorted.map((r) => (
                  <tr key={r.id ?? r.role} className="dr-row">
                    <td className="dr-td dr-td--role">
                      <span className="dr-role">{r.role || "—"}</span>
                    </td>
                    {years.map((yr) => (
                      <td key={yr} className="dr-td" data-align="right">
                        {formatMoney(r.rateCardByYear?.[yr])}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {apiResponse && (
        <ApiResponseModal response={apiResponse} onClose={() => setApiResponse(null)} />
      )}

      {/* Toasts */}
      <div className="dr-toasts" role="status" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className={`dr-toast dr-toast--${t.type}`}>
            <span className="dr-toast-ic">
              {t.type === "ok" ? "✓" : t.type === "error" ? "✕" : "!"}
            </span>
            <div style={{ flex: 1 }}>
              {t.title ? <div className="dr-toast-title">{t.title}</div> : null}
              <div className="dr-toast-msg">{t.msg}</div>
            </div>
            <button className="dr-toast-x" onClick={() => dismissToast(t.id)} aria-label="Dismiss">
              ✕
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}

/* =====================================================================
   Upload result / error modal
   ===================================================================== */
function ApiResponseModal({ response, onClose }) {
  useEffect(() => {
    const onKey = (e) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  if (!response) return null;
  const { title, ok, status, data, message, summary } = response;

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

  return (
    <div className="dr dr-modal-scrim" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="dr-modal" role="dialog" aria-modal="true" aria-label={title}>
        <div className="dr-modal-head">
          <div>
            <div
              className="dr-eyebrow"
              style={{ marginBottom: "4px", color: ok ? "var(--dr-success)" : "var(--dr-danger)" }}
            >
              {ok ? "Success" : "Error"} {status != null ? `· ${status}` : ""}
            </div>
            <h2>{title}</h2>
          </div>
          <button className="dr-close" onClick={onClose} aria-label="Close">✕</button>
        </div>

        <div className="dr-modal-body">
          {ok ? (
            <>
              <div className="dr-inline-success">
                <span style={{ fontSize: "16px" }}>✓</span>
                {message || "Uploaded successfully."}
              </div>
              {summary && (summary.rowsParsed != null || summary.rolesUpserted != null) && (
                <div className="dr-summary">
                  <div className="dr-summary-cell">
                    <b>{summary.rowsParsed ?? "—"}</b>
                    <span>Rows parsed</span>
                  </div>
                  <div className="dr-summary-cell">
                    <b>{summary.rolesUpserted ?? "—"}</b>
                    <span>Roles upserted</span>
                  </div>
                </div>
              )}
            </>
          ) : (
            <div className="dr-inline-error">
              <span style={{ fontSize: "16px" }}>!</span>
              {extractErrorMessage(data)}
            </div>
          )}
        </div>

        <div className="dr-modal-foot">
          <button className="dr-btn dr-btn-primary" onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  );
}

function TableSkeleton() {
  const cols = ["Designation", "Year-1", "Year-2", "Year-3", "Year-4", "Year-5"];
  return (
    <div className="dr-scroll">
      <table className="dr-table">
        <thead>
          <tr>
            {cols.map((c, i) => (
              <th key={c} className="dr-th" data-align={i === 0 ? "left" : "right"}>
                {c}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {Array.from({ length: 6 }).map((_, i) => (
            <tr key={i} style={{ borderBottom: "1px solid var(--dr-line-2)" }}>
              {cols.map((c, j) => (
                <td key={c} className="dr-td">
                  <div className="dr-skel-bar" style={{ width: j === 0 ? "80%" : "60%" }} />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
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
    style={spinning ? { animation: "dr-spin 1s linear infinite" } : {}}
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
