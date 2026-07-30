// ---------------------------------------------------------------------------
// SLA Compliance / NPQP / Settlement API layer (contracts service).
//
// Kept deliberately free of React so the whole feature can be lifted onto a
// dedicated page later: import these functions from anywhere, pass ids in,
// get plain data back. Every call throws an Error with the backend's message
// on failure, so callers only need one try/catch.
//
// Base URL: override with VITE_CONTRACTS_BASE_URL when the service moves.
// ---------------------------------------------------------------------------
import { authorizedFetch } from "./client";

export const CONTRACTS_BASE =
    (import.meta.env?.VITE_CONTRACTS_BASE_URL || "http://10.1.131.199/contracts").replace(/\/+$/, "");

// The contracts service wraps everything in { data, message, error, status }.
async function readEnvelope(res) {
    const payload = await res.json().catch(() => null);
    if (!res.ok) {
        throw new Error(
            payload?.error?.message ||
            payload?.error ||
            payload?.message ||
            payload?.detail?.[0]?.msg ||
            (typeof payload?.detail === "string" ? payload.detail : "") ||
            `Request failed (${res.status})`
        );
    }
    return payload?.data ?? payload;
}

function call(path, { method = "GET", body } = {}) {
    return authorizedFetch(`${CONTRACTS_BASE}${path}`, {
        method,
        headers: body
            ? { "Content-Type": "application/json", Accept: "application/json" }
            : { Accept: "application/json" },
        // The on-complete endpoint is a POST with no payload — send nothing
        // rather than "null", which FastAPI rejects.
        ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    }).then(readEnvelope);
}

const enc = encodeURIComponent;

/* ───────────────────────── Quarter helpers ─────────────────────────
   The backend accepts "2026-Q1".."2026-Q4" (calendar quarters) or any ISO
   date inside the target quarter. These mirror that convention exactly.   */

export function quarterKeyOf(date = new Date()) {
    const d = typeof date === "string" ? new Date(`${date}T00:00:00`) : date;
    if (Number.isNaN(d.getTime())) return "";
    return `${d.getFullYear()}-Q${Math.floor(d.getMonth() / 3) + 1}`;
}

export function parseQuarterKey(key) {
    const m = /^(\d{4})-Q([1-4])$/.exec(String(key || "").trim());
    if (!m) return null;
    const year = Number(m[1]);
    const quarter = Number(m[2]);
    const startMonth = (quarter - 1) * 3;
    const start = new Date(year, startMonth, 1);
    const end = new Date(year, startMonth + 3, 0); // day 0 of next block = last day
    const iso = (d) =>
        `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    return { year, quarter, start: iso(start), end: iso(end) };
}

// The last N quarters ending at the current one, newest first — drives the
// quarter <select> without needing a backend list endpoint.
export function recentQuarterKeys(count = 8, from = new Date()) {
    const d = typeof from === "string" ? new Date(`${from}T00:00:00`) : from;
    let year = d.getFullYear();
    let q = Math.floor(d.getMonth() / 3) + 1;
    const out = [];
    for (let i = 0; i < count; i += 1) {
        out.push(`${year}-Q${q}`);
        q -= 1;
        if (q === 0) { q = 4; year -= 1; }
    }
    return out;
}

/* ───────────────────── Activity-scoped (Pre-plan) ───────────────────── */

// POST …/activities/{id}/on-complete — trigger evaluation when an activity
// completes. Date-derivable SLAs are auto-evaluated; the rest come back under
// manualNeeded (their owners get emailed by the backend).
export function triggerActivityOnComplete(activityId) {
    return call(`/api/v3/sla-compliance/activities/${enc(activityId)}/on-complete`, { method: "POST" });
}

// GET …/activities/{id} — every SLA evaluation result for one activity, plus
// the met/breached/pending rollup and a `data_state` readiness flag.
export function getActivityCompliance(activityId) {
    return call(`/api/v3/sla-compliance/activities/${enc(activityId)}`);
}

/* ───────────────────── Project-scoped (Phase B / C / D / E) ───────────────────── */

// Phase B — per-SLA quarterly rollup (points → LD % per SLA). Refreshes the
// rollup server-side before responding. totalLdPercentUncapped is pre-cap.
export function getQuarterlyAggregate(projectId, quarter) {
    const qs = quarter ? `?quarter=${enc(quarter)}` : "";
    return call(`/api/v3/sla-compliance/projects/${enc(projectId)}/quarterly-aggregate${qs}`);
}

// Phase C — NPQP = F (leave-mgmt per-month cost × 3) + QGR.
// Returns status='leave_mgmt_unavailable' with HTTP 200 when leave-mgmt is
// down, so callers must check `status`, not just the absence of an error.
export function getNpqp(projectId, quarter) {
    const qs = quarter ? `?quarter=${enc(quarter)}` : "";
    return call(`/api/v3/npqp/projects/${enc(projectId)}${qs}`);
}

// Phase D — settlement history, newest quarter first.
export function listSettlements(projectId) {
    return call(`/api/v3/sla-compliance/projects/${enc(projectId)}/settlement`);
}

// Phase D — one quarter. Lazily auto-closes (rollup + NPQP + cap + AQP) and
// persists status='auto_closed' when no row exists yet.
export function getSettlement(projectId, quarter) {
    return call(`/api/v3/sla-compliance/projects/${enc(projectId)}/settlement/${enc(quarter)}`);
}

// Phase D — finance override of sumLdPercent. Re-capped at the quarter cap
// before persistence. 404 when not auto-closed yet, 422 once invoiced.
export function overrideSettlement(projectId, quarter, { sumLdPercent, overrideReason }) {
    return call(`/api/v3/sla-compliance/projects/${enc(projectId)}/settlement/${enc(quarter)}/override`, {
        method: "POST",
        body: { sumLdPercent: Number(sumLdPercent), overrideReason },
    });
}

// Phase E — lock the row after the invoice is raised. Idempotent.
export function markSettlementInvoiced(projectId, quarter, invoiceRef) {
    return call(`/api/v3/sla-compliance/projects/${enc(projectId)}/settlement/${enc(quarter)}/mark-invoiced`, {
        method: "POST",
        body: { invoiceRef },
    });
}

/* ───────────────────── Scoring configuration ─────────────────────
   The severity master (level → points) and the LD band table (points
   threshold → LD %) are what any client-side rollup has to score
   against. They are edited on the Severity & LD page, which talks to
   these paths inline; exposing them here lets the rollup read the same
   configuration without importing a page component.

   Both 404 on a project that has not been configured yet — that is a
   normal empty state, not a failure, so both resolve to [] instead of
   throwing and leave the caller to say "configure this first".        */

function normalizeSeverityLevels(payload) {
    const raw = payload?.data ?? payload ?? {};
    const list = raw.levels ?? raw._embedded?.elements ?? raw.elements ?? raw;
    if (!Array.isArray(list)) return [];
    return list.map((it, idx) => ({
        level: Number(it.level ?? it.severity_level ?? it.sl ?? it.severityLevel ?? 0),
        points: Number(it.points ?? it.point ?? it.value ?? 0),
        label: String(it.label ?? it.name ?? `Level ${it.level ?? idx}`),
    }));
}

function normalizeLdBands(payload) {
    const raw = payload?.data ?? payload ?? {};
    const list = raw._embedded?.elements ?? raw.bands ?? raw.elements ?? raw;
    if (!Array.isArray(list)) return [];
    return list.map((it, idx) => ({
        id: it.id ?? it.band_id ?? it.bandId ?? null,
        points_threshold: Number(it.points_threshold ?? it.pointsThreshold ?? it.points ?? 0),
        ld_percent: Number(it.ld_percent ?? it.ldPercent ?? it.ld ?? 0),
        label: String(it.label ?? it.name ?? `Band ${idx}`),
    }));
}

// These two live under /contracts/api/v3 (project-scoped masters), not
// under the sla-compliance tree, so they use authorizedFetch directly
// rather than call() with CONTRACTS_BASE.
async function readMaster(path, normalize) {
    const res = await authorizedFetch(path, { method: "GET", headers: { Accept: "application/json" } });
    if (res.status === 404) return [];
    const text = await res.text().catch(() => "");
    if (!res.ok) throw new Error(`Request failed (${res.status})`);
    if (!text) return [];
    try {
        return normalize(JSON.parse(text));
    } catch {
        return [];
    }
}

export function getSeverityMaster(projectId) {
    return readMaster(
        `/contracts/api/v3/projects/${enc(projectId)}/severity-master`,
        normalizeSeverityLevels
    );
}

export function getLdBands(projectId) {
    return readMaster(
        `/contracts/api/v3/projects/${enc(projectId)}/ld-bands`,
        normalizeLdBands
    );
}
