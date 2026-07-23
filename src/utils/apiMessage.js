/* ══════════════════════════════════════════════════════════════════
   apiMessage.js — the single gate every user-facing API message passes
   through.

   The rule this enforces: a raw response body must never reach the
   screen. Backends answer failures with JSON envelopes, HTML gateway
   pages, Java stack traces and bare exception class names, and every one
   of those reads as a bug to the person looking at the page. Anything
   that doesn't look like a sentence is swapped for a plain one.

   Use `readErrorMessage` / `readJsonBody` / `requestErrorMessage` around
   a fetch and nothing else is needed; `messageFromBody` is there for the
   callers that must read the body themselves first (to special-case a
   particular error shape) and then fall back to the standard handling.
   ══════════════════════════════════════════════════════════════════ */

import { uiStore } from "../store/project/uiStore";

/* A backend string is only worth showing if it reads like a sentence. */
export function isReadableMessage(value) {
  const text = String(value ?? "").trim();
  if (!text || text.length > 300) return false;
  if (/^[[{<]/.test(text)) return false;               // serialised body or HTML
  if (/^\s*<!doctype/i.test(text)) return false;       // an HTML error page
  if (/"\w+"\s*:/.test(text)) return false;            // a JSON fragment mid-string
  if (/\sat\s[\w.$]+\(/.test(text)) return false;      // a stack trace
  if (/\b\w+(\.\w+)+(Exception|Error)\b/.test(text)) return false;
  if (/^[\w.$]+(\.[\w$]+)+$/.test(text)) return false; // a bare class name
  return true;
}

/* A plain sentence per status, so a failure always says something useful
   even when the body is empty, HTML, or unreadable. */
const STATUS_MESSAGE = {
  400: "The server rejected that request. Please check the values and try again.",
  401: "Your session has expired. Please sign in again.",
  403: "You don't have permission to do this.",
  404: "That record couldn't be found.",
  405: "That action isn't allowed here.",
  409: "This conflicts with a record that's already saved.",
  413: "That file is larger than the server accepts.",
  415: "The server rejected that file type.",
  422: "Some values weren't accepted. Please review and try again.",
  429: "Too many requests. Please wait a moment and try again.",
  500: "The server hit an error. Please try again.",
  502: "The server is unavailable. Please try again shortly.",
  503: "The server is unavailable. Please try again shortly.",
  504: "The server took too long to respond. Please try again.",
};

export const statusMessage = (status, fallback) =>
  STATUS_MESSAGE[status] || fallback || `Request failed (${status}).`;

/* Reduce an already-read body to one line. Error bodies vary: {message},
   {error}, {errors:[…]} holding strings or objects, or plain text. */
export function messageFromBody(raw, status, fallback) {
  const safe = statusMessage(status, fallback);
  if (!String(raw ?? "").trim()) return safe;

  let data;
  try {
    data = JSON.parse(raw);
  } catch {
    return isReadableMessage(raw) ? String(raw).trim() : safe;   // plain-text body
  }

  if (typeof data === "string") {
    return isReadableMessage(data) ? data.trim() : safe;
  }

  const fromList = Array.isArray(data?.errors)
    ? data.errors
        .map((e) => (typeof e === "string" ? e : e?.message || e?.defaultMessage || ""))
        .filter(Boolean)
        .join(", ")
    : "";

  const candidate = [data?.message, data?.error, data?.detail, data?.title, fromList].find(
    (v) => typeof v === "string" && v.trim()
  );

  return candidate && isReadableMessage(candidate) ? candidate.trim() : safe;
}

/* Read a failed response and reduce it to one showable line. */
export async function readErrorMessage(res, fallback) {
  let raw = "";
  try {
    raw = await res.text();
  } catch {
    return statusMessage(res?.status, fallback);
  }
  return messageFromBody(raw, res?.status, fallback);
}

/* A success body may carry its own message; show it only when it reads
   like one, so a 200 echoing the saved record doesn't dump JSON. */
export async function readSuccessMessage(res, fallback) {
  try {
    const raw = await res.text();
    if (!raw.trim()) return fallback;
    let data;
    try {
      data = JSON.parse(raw);
    } catch {
      return isReadableMessage(raw) ? raw.trim() : fallback;
    }
    if (typeof data === "string") return isReadableMessage(data) ? data.trim() : fallback;
    const candidate = [data?.message, data?.status, data?.detail].find(
      (v) => typeof v === "string" && v.trim()
    );
    return candidate && isReadableMessage(candidate) ? candidate.trim() : fallback;
  } catch {
    return fallback;
  }
}

/* res.json() throws on an empty or non-JSON body, and the raw SyntaxError
   ("Unexpected token < in JSON…") is exactly what must not reach the
   screen. Returns null for an empty body — that's "no data", not a crash. */
export async function readJsonBody(res, fallback) {
  let raw = "";
  try {
    raw = await res.text();
  } catch {
    throw new Error(fallback);
  }
  if (!raw.trim()) return null;
  try {
    return JSON.parse(raw);
  } catch {
    throw new Error(fallback);
  }
}

/* Turns anything thrown inside a fetch into a sentence. A dropped
   connection surfaces as a TypeError whose message ("Failed to fetch" /
   "NetworkError…") means nothing to the user, so it gets named plainly.
   Aborts return null — callers ignore those, the user navigated away. */
export function requestErrorMessage(err, fallback) {
  if (err?.name === "AbortError") return null;
  if (err instanceof TypeError) {
    return "Couldn't reach the server. Check your connection and try again.";
  }
  return isReadableMessage(err?.message) ? err.message : fallback;
}

/* ── presentation ───────────────────────────────────────────────────
   The app shows API outcomes through one shared popup: uiStore feeds
   MessageModal, which renders the navy→cyan stripe, a warn/check icon,
   a bold title and a softer body line.

   MessageModal splits on the FIRST newline — "Title\nBody" — and falls
   back to a generic title ("Please review the form" / "Success") when a
   message arrives as one line. Every action message therefore ships its
   own title, so a failed upload reads "Upload failed", not the generic
   form-review heading. uiStore strips trailing periods itself, so the
   sentences below can keep theirs for the inline-banner callers.

   Page-LOAD failures deliberately stay inline on the page: a popup that
   dismisses to an empty screen leaves the user with nothing to act on.
   These helpers are for ACTIONS — save, upload, submit, delete. */

/* Titles are short and past-tense, matching "Session Expired" in
   client.js and the existing "Upload failed" / "Import failed" strings. */
export function notifyActionError(title, message) {
  uiStore.showError(`${title}\n${String(message ?? "").trim()}`);
}

export function notifyActionSuccess(title, message) {
  /* showMessage guesses error-ness from the wording, and a success line
     containing e.g. "invalid" would be mis-flagged — so the success path
     sets the state directly through showMessage only when the text is
     plainly a confirmation. Callers pass confirmations here. */
  uiStore.showMessage(`${title}\n${String(message ?? "").trim()}`);
}

/* ── shared value parsers ───────────────────────────────────────────
   Year and quarter travel through query strings and selects, where they
   can be anything at all, and are then echoed into API calls. Both
   return null when invalid so callers can branch on it. */
export const MIN_YEAR = 2000;
export const MAX_YEAR = 2100;

export const parseYear = (v) => {
  const n = Number(String(v ?? "").trim());
  return Number.isInteger(n) && n >= MIN_YEAR && n <= MAX_YEAR ? n : null;
};

export const parseQuarter = (v) => {
  const n = Number(String(v ?? "").trim());
  return Number.isInteger(n) && n >= 1 && n <= 4 ? n : null;
};

export const parseMonth = (v) => {
  const n = Number(String(v ?? "").trim());
  return Number.isInteger(n) && n >= 1 && n <= 12 ? n : null;
};

/* "YYYY-MM-DD" that is also a real calendar date — "2026-02-31" parses as
   a number triple but isn't a day, and the round-trip catches it. */
export function parseISODate(v) {
  const text = String(v ?? "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return null;
  const d = new Date(`${text}T00:00:00`);
  if (Number.isNaN(d.getTime())) return null;
  const back = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  return back === text ? d : null;
}

/* Whole days between two ISO dates, inclusive of both ends. */
export const daysBetween = (startISO, endISO) => {
  const a = parseISODate(startISO);
  const b = parseISODate(endISO);
  if (!a || !b) return null;
  return Math.round((b - a) / 86400000) + 1;
};
