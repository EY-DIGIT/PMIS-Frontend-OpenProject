import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useParams } from "react-router-dom";
import { API_BASE, authorizedFetch } from "../../api/client";
import { ENDPOINTS } from "../../api/endpoint";
import { uiStore } from "../../store/project/uiStore";
import { projectItems } from "../../api/dashboard";
import "../../styles/global.css";

/* ────────────────────────────────────────────────────────────────────
   Penalty Report — the "separate page" that ties delay → LD → payment.

   What this page does (all on the frontend; the backend still owns the
   severity→points→LD% chain):

     1. Reads each milestone's deadline (endDate) and actual completion
        (actualEndDate) and computes how many days it slipped.
     2. For every SLA mapped to that milestone's activities, converts the
        day-count into the SLA's own unit (weeks → ceil(days/7) for
        "week or part thereof"; days → as-is) — read dynamically from the
        SLA's evaluation form-schema, so no SLA ref is hard-coded here.
     3. Feeds that count into the SAME evaluate endpoint the Activity-SLA
        page already uses, so the backend returns accumulated points and
        LD% exactly as it does today.
     4. Applies the penalty to the milestone's payment as the RFP states:
        net payable = payment − LD, with LD% capped at 10% per activity
        (and per milestone).

   ── The one seam you need to wire ──────────────────────────────────
   SLAs live on ACTIVITIES; payments group by MILESTONE. To join them we
   need, for the project, the list of activities and each activity's
   milestone. See `loadProjectActivities` below — it currently derives
   that from the payment page's activity splits (which only cover
   partial-payment milestones). Point it at your real activities endpoint
   (one that returns every activity with its milestoneId) and the whole
   report fills in for every milestone. Nothing else has to change.
   ──────────────────────────────────────────────────────────────────── */

// Base for the contracts service (SLA masters / mappings / evaluate).
// SeverityPage uses this same relative prefix successfully; switch to the
// absolute host (http://10.1.131.199/contracts) if your authorizedFetch
// needs it.
const CONTRACTS_BASE = "/contracts";

// LD caps (RFP §5.27.6 / §5.28.1 — 10% of the net planned quarterly payment).
// Kept as knobs so the cap policy is trivial to change.
const ACTIVITY_LD_CAP = 10;   // max LD% any single activity can contribute
const MILESTONE_LD_CAP = 10;  // max LD% applied to a milestone's payment

/* ── date helpers (compare by calendar date to avoid +05:30 drift) ── */
function toYmd(iso) {
  return typeof iso === "string" && iso.length >= 10 ? iso.slice(0, 10) : null;
}
function ymdToUTC(ymd) {
  const [y, m, d] = ymd.split("-").map(Number);
  return Date.UTC(y, m - 1, d);
}
function diffDays(aYmd, bYmd) {
  return Math.round((ymdToUTC(aYmd) - ymdToUTC(bYmd)) / 86400000);
}
function todayYmd() {
  return new Date().toISOString().slice(0, 10);
}
// Last day of the quarter window from a start (start + 3 months − 1 day),
// used to keep the evaluate period inside the backend's one-quarter rule.
function quarterEndYmd(ymd) {
  if (!ymd) return undefined;
  const [y, m, d] = ymd.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCMonth(dt.getUTCMonth() + 3);
  dt.setUTCDate(dt.getUTCDate() - 1);
  return dt.toISOString().slice(0, 10);
}
function fmtDMY(iso) {
  const ymd = toYmd(iso);
  if (!ymd) return "—";
  const [y, m, d] = ymd.split("-");
  return `${d}-${m}-${y}`;
}
function isCompleted(m) {
  return String(m?.status || "").toLowerCase() === "completed" || !!m?.actualEndDate;
}

/* Delay for a milestone as of `asOf` (YYYY-MM-DD).
   The day-count comes from the backend's per-milestone `daysDelayed`
   (single source of truth — it already handles overdue-in-progress) when
   available; otherwise it falls back to a local date subtraction:
   - completed → measured to actualEndDate
   - not completed → measured to `asOf` (a live, growing figure)
   Returns { days, state, refYmd, source }. */
function computeDelay(m, asOf, backendDays) {
  const deadline = toYmd(m?.endDate);
  const completed = isCompleted(m);
  const refYmd = completed ? toYmd(m?.actualEndDate) || deadline : asOf;
  const localDays = deadline ? Math.max(0, diffDays(refYmd, deadline)) : 0;
  const hasBackend = Number.isFinite(backendDays);
  const days = hasBackend ? Math.max(0, Math.round(backendDays)) : localDays;
  if (!deadline && !hasBackend) return { days: 0, state: "no-deadline", refYmd: null, source: "none" };
  let state;
  if (completed) state = days > 0 ? "completed_late" : "completed_on_time";
  else state = days > 0 ? "overdue" : "pending";
  return { days, state, refYmd, source: hasBackend ? "backend" : "local" };
}

/* ── unit conversion (dynamic, off the SLA's declared input unit) ── */
function unitKind(unit) {
  const u = String(unit || "").toLowerCase();
  if (u.startsWith("week")) return "week";
  if (u.startsWith("day")) return "day";
  return "day"; // default: treat an untyped delay input as days
}
function convertDelay(days, unit) {
  if (unitKind(unit) === "week") return Math.ceil(days / 7); // "week or part thereof"
  return days;
}
function unitLabel(unit) {
  return unitKind(unit) === "week" ? "weeks" : "days";
}

/* Find the delay input in an evaluate form-schema's inputs[]. Prefers an
   input whose unit is day/week or whose name/label reads like a delay;
   falls back to the sole numeric input. Returns null when the SLA isn't a
   delay type (e.g. occurrence-based SLAs), which the report then leaves for
   manual entry rather than guessing. */
function findDelayInput(inputs) {
  const list = Array.isArray(inputs) ? inputs : [];
  const timed = list.find(
    (i) =>
      /day|week/i.test(i?.unit || "") ||
      /delay|late|overdue|slip|beyond/i.test(`${i?.name || ""} ${i?.label || ""}`)
  );
  if (timed) return timed;
  const nums = list.filter((i) => /number|integer/i.test(String(i?.type || "")));
  return nums.length === 1 ? nums[0] : null;
}

/* ── money ── */
function inr(n) {
  const v = Number(n);
  if (!Number.isFinite(v)) return "₹ 0";
  return `₹ ${v.toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;
}
function num(v, fallback = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

/* ── fetch ── */
async function readJson(res) {
  const payload = await res.json().catch(() => null);
  if (!res.ok) {
    throw new Error(payload?.error?.message || payload?.message || `Request failed (${res.status})`);
  }
  return payload;
}
function extractElements(payload) {
  const el =
    payload?.data?._embedded?.elements ||
    payload?._embedded?.elements ||
    payload?.data?.elements ||
    payload?.data ||
    [];
  return Array.isArray(el) ? el : [];
}
// Dashboard project-items come back (already unwrapped by projectItems)
// under `rows` (the shape this API uses), or occasionally `items` / an
// _embedded collection / a bare array. Accept all.
function normalizeItems(data) {
  const rows =
    data?.rows ||
    data?.data?.rows ||
    data?.items ||
    data?._embedded?.elements ||
    data?.data?._embedded?.elements ||
    (Array.isArray(data) ? data : Array.isArray(data?.data) ? data.data : []);
  return Array.isArray(rows) ? rows : [];
}
// Read a metric from an evaluate result regardless of envelope shape.
function pick(result, key) {
  if (result == null) return undefined;
  if (result[key] !== undefined) return result[key];
  if (result.data && result.data[key] !== undefined) return result.data[key];
  return undefined;
}

const STATE_LABEL = {
  completed_late: "Completed late",
  completed_on_time: "Completed on time",
  overdue: "Overdue (in progress)",
  pending: "On track",
  "no-deadline": "No deadline set",
};

export default function PenaltyReportPage() {
  const { projectId } = useParams();

  const [milestones, setMilestones] = useState([]);
  const [page, setPage] = useState(null);
  const [items, setItems] = useState([]); // dashboard project items (backend delay + activity links)
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState("");

  const [asOf, setAsOf] = useState(todayYmd());
  const [includeProvisional, setIncludeProvisional] = useState(false);

  const [generating, setGenerating] = useState(false);
  const [report, setReport] = useState(null); // [{ milestone, delay, value, activities, milestoneLdPercent, penalty, net, ... }]
  const [expanded, setExpanded] = useState(() => new Set());

  const baseContracts = () => CONTRACTS_BASE;

  /* ── load milestones + payment page ── */
  const loadAll = useCallback(async () => {
    if (!projectId) return;
    setLoading(true);
    setLoadError("");
    try {
      const [mRes, pRes] = await Promise.all([
        authorizedFetch(
          `${API_BASE}${ENDPOINTS.projects.milestones(projectId)}?offset=1&pageSize=200&includeDeleted=false`,
          { headers: { Accept: "application/json" } }
        ),
        authorizedFetch(`${API_BASE}${ENDPOINTS.projects.paymentPage(projectId)}`, {
          headers: { Accept: "application/json" },
        }),
      ]);
      const mPayload = await readJson(mRes);
      const pPayload = await readJson(pRes);
      setMilestones(extractElements(mPayload));
      setPage(pPayload?.data ?? pPayload ?? null);

      // Backend-computed per-milestone delay + activity→milestone links.
      // Optional: if it's unavailable the page degrades to local date math
      // and the payment-derived activity fallback.
      try {
        const itemsData = await projectItems(projectId);
        setItems(normalizeItems(itemsData));
      } catch {
        setItems([]);
      }
    } catch (err) {
      setLoadError(err?.message || "Could not load milestones or payment data.");
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    loadAll();
  }, [loadAll]);

  /* Activities from the dashboard items — each carries its OWN daysDelayed
     and the milestoneId it rolls up to. This is what the SLAs get scored
     against (a milestone can read "on track" while a child activity is
     late). `activityId` is the item id the SLA endpoints key on. */
  const itemsActivities = useMemo(
    () =>
      items
        .filter((it) => String(it?.kind).toLowerCase() === "activity")
        .map((it) => ({
          activityId: it.id,
          code: it.wbs || it.name || it.id,
          name: it.name,
          milestoneId: it.milestoneId,
          milestoneName: it.milestoneName,
          daysDelayed: num(it.daysDelayed),
          plannedEnd: it.plannedEnd,
          actualEnd: it.actualEnd,
          status: it.status,
          bucket: it.bucket,
        })),
    [items]
  );

  // Milestone rows from items, indexed by id (for code/name fallback joins).
  const itemsMilestones = useMemo(() => {
    const map = new Map();
    for (const it of items) {
      if (String(it?.kind).toLowerCase() === "milestone" && it?.id != null) {
        map.set(it.id, { id: it.id, wbs: it.wbs, name: it.name, daysDelayed: num(it.daysDelayed) });
      }
    }
    return map;
  }, [items]);

  /* Resolve a milestone (from the milestones API) to its activity rows.
     Primary join is by uuid (activity.milestoneId === milestone.id); if the
     id spaces differ we fall back to matching the milestone's code (M1==M1)
     and finally its name, so the link survives id-space mismatches. */
  const activitiesForMilestone = useCallback(
    (m) => {
      if (!m) return [];
      let list = itemsActivities.filter((a) => a.milestoneId && a.milestoneId === m.id);
      if (list.length) return list;

      const code = m.displayCode || m.wbs;
      if (code) {
        const ids = new Set(
          [...itemsMilestones.values()].filter((im) => im.wbs === code).map((im) => im.id)
        );
        if (ids.size) {
          list = itemsActivities.filter((a) => ids.has(a.milestoneId));
          if (list.length) return list;
        }
      }
      if (m.name) {
        const nm = String(m.name).trim();
        list = itemsActivities.filter((a) => String(a.milestoneName || "").trim() === nm);
        if (list.length) return list;
      }
      return [];
    },
    [itemsActivities, itemsMilestones]
  );

  /* Milestone → total scheduled payment (sum of every phase's term value
     for that milestone). This is the base the penalty is taken from. */
  const paymentByMilestone = useMemo(() => {
    const map = new Map();
    const phases = page?.phases || [];
    for (const ph of phases) {
      for (const t of ph.paymentTerms || []) {
        if (!t.milestoneId) continue;
        map.set(t.milestoneId, num(map.get(t.milestoneId)) + num(t.value));
      }
    }
    return map;
  }, [page]);

  /* ── SEAM: activities for the project, each with its milestoneId ──
     Default derivation: the payment page exposes an activities[] split on
     partial-payment terms — { activityId, activityDisplayCode } under a
     term that carries milestoneId. That gives activity → milestone for
     those terms. Complete-payment milestones have no split, so their
     activities won't appear here.

     >>> Replace the body with your activities endpoint when available:
         GET /projects/api/v3/projects/{projectId}/activities
         → [{ id / activityId, displayCode, milestoneId }]
     Return the same shape and the rest of the page works unchanged. */
  async function loadMappings(activityId) {
    const res = await authorizedFetch(
      `${baseContracts()}/api/v3/activities/${encodeURIComponent(activityId)}/sla-mappings?active_only=true`,
      { headers: { Accept: "application/json" } }
    );
    const payload = await readJson(res);
    return extractElements(payload);
  }

  async function loadEvalSchema(activityId, slaRef) {
    const res = await authorizedFetch(
      `${baseContracts()}/api/v3/activities/${encodeURIComponent(activityId)}/sla-evaluate/${encodeURIComponent(slaRef)}/form-schema`,
      { headers: { Accept: "application/json" } }
    );
    const payload = await readJson(res);
    return payload?.data || payload;
  }

  async function evaluateSla(activityId, slaRef, body) {
    const res = await authorizedFetch(
      `${baseContracts()}/api/v3/activities/${encodeURIComponent(activityId)}/sla-evaluate/${encodeURIComponent(slaRef)}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify(body),
      }
    );
    const payload = await readJson(res);
    return payload?.data ?? payload;
  }

  /* ── orchestration ── */
  const generateReport = useCallback(async () => {
    if (!projectId) return;
    setGenerating(true);
    setExpanded(new Set());
    try {
      const rows = [];
      for (const m of milestones) {
        const acts = activitiesForMilestone(m);
        if (!acts.length) continue; // no activities → nothing to score

        const value = num(paymentByMilestone.get(m.id));

        const activityRows = [];
        for (const a of acts) {
          const aDelay = num(a.daysDelayed);
          const completed = String(a.status || "").toLowerCase() === "completed" || !!a.actualEnd;
          // Score an activity only if it slipped. Overdue-but-open ones are
          // included as provisional when the user asks for that view.
          const applies = aDelay > 0 && (completed || includeProvisional);
          if (!applies) continue;

          const periodStart = toYmd(a.plannedEnd) || toYmd(m.endDate);
          const qEnd = quarterEndYmd(periodStart);
          const periodEnd = qEnd && asOf > qEnd ? qEnd : asOf;

          let mappings = [];
          try {
            mappings = await loadMappings(a.activityId);
          } catch (err) {
            activityRows.push({ activity: a, delay: aDelay, completed, error: err?.message || "Could not load SLAs.", slaRows: [], activityLdPercent: 0, activityLdPercentRaw: 0 });
            continue;
          }

          // one row per unique SLA ref on the activity
          const seen = new Set();
          const slaRows = [];
          for (const map of mappings) {
            if (!map?.sla_ref || seen.has(map.sla_ref)) continue;
            seen.add(map.sla_ref);

            let schema;
            try {
              schema = await loadEvalSchema(a.activityId, map.sla_ref);
            } catch (err) {
              slaRows.push({ ref: map.sla_ref, title: map.sla_title, error: err?.message || "No form schema." });
              continue;
            }

            const di = findDelayInput(schema?.inputs);
            if (!di) {
              // Not a delay SLA (e.g. occurrence-based) — can't auto-fill.
              slaRows.push({ ref: map.sla_ref, title: map.sla_title, manual: true });
              continue;
            }

            // The activity's OWN delay, converted into the SLA's unit, is
            // dropped straight into the observation input the form used to
            // collect manually — then the backend scores it as usual.
            const count = convertDelay(aDelay, di.unit);
            const body = { period_start: periodStart, period_end: periodEnd, [di.name]: count };
            try {
              const result = await evaluateSla(a.activityId, map.sla_ref, body);
              slaRows.push({
                ref: map.sla_ref,
                title: map.sla_title,
                unit: di.unit,
                unitLabel: unitLabel(di.unit),
                count,
                severity: pick(result, "severity_level"),
                points: pick(result, "accumulated_points"),
                ldPercent: num(pick(result, "ld_percent")),
                ldAmount: pick(result, "ld_amount"),
              });
            } catch (err) {
              slaRows.push({ ref: map.sla_ref, title: map.sla_title, error: err?.message || "Evaluation failed." });
            }
          }

          const rawLd = slaRows.reduce((s, r) => s + num(r.ldPercent), 0);
          activityRows.push({
            activity: a,
            delay: aDelay,
            completed,
            slaRows,
            activityLdPercentRaw: rawLd,
            activityLdPercent: Math.min(ACTIVITY_LD_CAP, rawLd),
          });
        }

        if (!activityRows.length) continue; // no delayed activities on this milestone

        const summedActivityLd = activityRows.reduce((s, r) => s + num(r.activityLdPercent), 0);
        const milestoneLdPercent = Math.min(MILESTONE_LD_CAP, summedActivityLd);
        const penalty = (value * milestoneLdPercent) / 100;
        const maxDelay = activityRows.reduce((mx, r) => Math.max(mx, num(r.delay)), 0);

        rows.push({
          milestone: m,
          maxDelay,
          value,
          activities: activityRows,
          milestoneLdPercentRaw: summedActivityLd,
          milestoneLdPercent,
          penalty,
          net: value - penalty,
          provisional: activityRows.every((r) => !r.completed),
        });
      }
      setReport(rows);
      if (rows.length === 0) {
        uiStore.showMessage(
          items.length === 0
            ? "No activity delay data was returned for this project."
            : "No delayed activities to report for the selected date."
        );
      }
    } catch (err) {
      uiStore.showError(err?.message || "Could not generate the penalty report.");
    } finally {
      setGenerating(false);
    }
  }, [projectId, milestones, items, asOf, includeProvisional, paymentByMilestone, activitiesForMilestone]);

  /* ── totals ── */
  const totals = useMemo(() => {
    const list = Array.isArray(report) ? report : [];
    return {
      count: list.length,
      payment: list.reduce((s, r) => s + num(r.value), 0),
      penalty: list.reduce((s, r) => s + num(r.penalty), 0),
      net: list.reduce((s, r) => s + num(r.net), 0),
    };
  }, [report]);

  function toggle(id) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  const muted = { color: "var(--uidai-pmis-muted)" };
  const sectionHead = { fontSize: 16, fontWeight: 800, color: "#173e77", marginBottom: 12 };

  function StateBadge({ state }) {
    const cls =
      state === "completed_late" ? "uidai-pmis-badge-red" :
      state === "overdue" ? "uidai-pmis-badge-orange" :
      state === "completed_on_time" ? "uidai-pmis-badge-green" :
      "uidai-pmis-badge-orange";
    return <span className={`uidai-pmis-badge ${cls}`}>{STATE_LABEL[state] || state}</span>;
  }

  function Tile({ label, value, accent }) {
    return (
      <div style={{ background: "#f6f9fd", border: "1px solid var(--uidai-pmis-border)", borderRadius: 10, padding: "12px 14px" }}>
        <div style={{ fontSize: 11, ...muted, fontWeight: 700, textTransform: "uppercase", letterSpacing: ".3px", marginBottom: 6 }}>{label}</div>
        <div style={{ fontSize: 20, fontWeight: 800, color: accent || "#173e77", lineHeight: 1.1 }}>{value}</div>
      </div>
    );
  }

  return (
    <div className="uidai-pmis-content">
      <div className="uidai-pmis-title">Penalty Report</div>
      <div className="uidai-pmis-subtitle" style={{ marginTop: -10 }}>
        Delay against each milestone's deadline, the resulting SLA liquidated damages, and the net payable after penalty.
      </div>

      {/* Controls */}
      <div className="uidai-pmis-card">
        <div style={sectionHead}>Report settings</div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 16, alignItems: "flex-end" }}>
          <div className="uidai-pmis-field" style={{ marginBottom: 0, minWidth: 180 }}>
            <label>As of date</label>
            <input type="date" value={asOf} max={todayYmd()} onChange={(e) => setAsOf(e.target.value)} />
            <div style={{ fontSize: 11, ...muted, marginTop: 4 }}>Overdue milestones are measured up to this date.</div>
          </div>
          <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, fontWeight: 600, color: "var(--uidai-pmis-text)", marginBottom: 6 }}>
            <input type="checkbox" style={{ width: "auto" }} checked={includeProvisional} onChange={(e) => setIncludeProvisional(e.target.checked)} />
            Include overdue (in-progress) milestones as provisional
          </label>
          <div style={{ flex: 1 }} />
          <button type="button" className="uidai-pmis-btn uidai-pmis-btn-cancel uidai-pmis-btn-small" style={{ marginTop: 0 }} onClick={loadAll} disabled={loading || generating}>
            {loading ? "Loading…" : "↻ Reload data"}
          </button>
          <button type="button" className="uidai-pmis-btn uidai-pmis-btn-small" style={{ marginTop: 0 }} onClick={generateReport} disabled={loading || generating || !!loadError}>
            {generating ? "Generating…" : "Generate report"}
          </button>
        </div>
        {loadError && (
          <div className="uidai-pmis-badge uidai-pmis-badge-red" style={{ display: "block", borderRadius: 8, padding: "10px 12px", marginTop: 12, fontWeight: 600 }}>
            {loadError}
          </div>
        )}
      </div>

      {/* Totals */}
      {Array.isArray(report) && report.length > 0 && (
        <div className="uidai-pmis-card">
          <div className="uidai-pmis-grid-4" style={{ gap: 12 }}>
            <Tile label="Delayed milestones" value={totals.count} />
            <Tile label="Payment in scope" value={inr(totals.payment)} />
            <Tile label="Total penalty" value={inr(totals.penalty)} accent="#c0392b" />
            <Tile label="Net payable" value={inr(totals.net)} accent="#1b7a42" />
          </div>
        </div>
      )}

      {/* Report body */}
      {generating ? (
        <div className="uidai-pmis-card"><div style={{ padding: 24, textAlign: "center", ...muted }}>Evaluating SLAs and computing penalties…</div></div>
      ) : Array.isArray(report) ? (
        report.length === 0 ? (
          <div className="uidai-pmis-card">
            <div style={{ padding: 26, textAlign: "center", ...muted }}>
              <div style={{ fontSize: 26, marginBottom: 6 }} aria-hidden="true">✓</div>
              No delayed milestones for the selected date. Adjust the as-of date or include in-progress milestones to widen the view.
            </div>
          </div>
        ) : (
          report.map((row) => {
            const m = row.milestone;
            const open = expanded.has(m.id);
            return (
              <div key={m.id} className="uidai-pmis-card">
                {/* Milestone header */}
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12, flexWrap: "wrap" }}>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                      <span style={{ fontFamily: "monospace", fontSize: 12, fontWeight: 700, color: "#173e77" }}>{m.displayCode || "—"}</span>
                      <span style={{ fontSize: 15, fontWeight: 800, color: "#173e77" }}>{m.name}</span>
                      <StateBadge state={row.provisional ? "overdue" : "completed_late"} />
                    </div>
                    <div style={{ fontSize: 12, ...muted, marginTop: 4 }}>
                      Deadline {fmtDMY(m.endDate)} · Worst activity delay{" "}
                      <strong style={{ color: "#b54708" }}>{row.maxDelay} day{row.maxDelay === 1 ? "" : "s"}</strong>
                      {row.provisional && <span style={{ ...muted, fontStyle: "italic" }}> · provisional (in progress)</span>}
                    </div>
                  </div>
                  <div style={{ textAlign: "right" }}>
                    <div style={{ fontSize: 11, ...muted, fontWeight: 700, textTransform: "uppercase", letterSpacing: ".3px" }}>Net payable</div>
                    <div style={{ fontSize: 18, fontWeight: 800, color: "#1b7a42" }}>{inr(row.net)}</div>
                  </div>
                </div>

                {/* Money line */}
                <div className="uidai-pmis-grid-4" style={{ gap: 12, marginTop: 14 }}>
                  <Tile label="Milestone payment" value={inr(row.value)} />
                  <Tile
                    label="Applied LD"
                    value={`${row.milestoneLdPercent}%`}
                    accent={row.milestoneLdPercent > 0 ? "#c0392b" : "#173e77"}
                  />
                  <Tile label="Penalty" value={inr(row.penalty)} accent="#c0392b" />
                  <Tile label="Net payable" value={inr(row.net)} accent="#1b7a42" />
                </div>

                {row.milestoneLdPercentRaw > MILESTONE_LD_CAP && (
                  <div style={{ fontSize: 12, color: "#b54708", marginTop: 10 }}>
                    Raw LD was {row.milestoneLdPercentRaw}% — capped to {MILESTONE_LD_CAP}% per the quarterly LD ceiling.
                  </div>
                )}

                {/* Expand: per-SLA detail */}
                {row.activities.length > 0 && (
                  <>
                    <button
                      type="button"
                      onClick={() => toggle(m.id)}
                      style={{
                        marginTop: 12, display: "inline-flex", alignItems: "center", gap: 6,
                        border: "1px solid #cfe0f5", background: "#eef3fb", color: "#0b3c88",
                        fontSize: 12, fontWeight: 700, borderRadius: 999, padding: "4px 12px", cursor: "pointer",
                      }}
                    >
                      <span style={{ fontSize: 9 }}>{open ? "▾" : "▸"}</span>
                      SLA breakdown ({row.activities.reduce((s, a) => s + a.slaRows.length, 0)})
                    </button>

                    {open && (
                      <div style={{ marginTop: 12 }}>
                        {row.activities.map((a) => (
                          <div key={a.activity.activityId} style={{ marginBottom: 14 }}>
                            <div style={{ fontSize: 12.5, fontWeight: 700, color: "#173e77", marginBottom: 6 }}>
                              Activity <span style={{ fontFamily: "monospace" }}>{a.activity.code}</span>
                              <span style={{ color: "#b54708", fontWeight: 700, marginLeft: 10 }}>
                                {a.delay} day{a.delay === 1 ? "" : "s"} late
                              </span>
                              <span style={{ ...muted, fontWeight: 600, marginLeft: 10 }}>
                                Activity LD {a.activityLdPercent}%
                                {a.activityLdPercentRaw > ACTIVITY_LD_CAP ? ` (raw ${a.activityLdPercentRaw}%, capped)` : ""}
                              </span>
                            </div>
                            {a.error ? (
                              <div style={{ fontSize: 12.5, color: "#c0392b" }}>{a.error}</div>
                            ) : (
                              <div className="uidai-pmis-table-wrap">
                                <table className="uidai-pmis-table uidai-pmis-table-compact" style={{ marginTop: 0 }}>
                                  <thead>
                                    <tr>
                                      <th>SLA</th>
                                      <th>Delay</th>
                                      <th style={{ textAlign: "right" }}>Severity</th>
                                      <th style={{ textAlign: "right" }}>Points</th>
                                      <th style={{ textAlign: "right" }}>LD %</th>
                                    </tr>
                                  </thead>
                                  <tbody>
                                    {a.slaRows.map((s, i) => (
                                      <tr key={`${s.ref}-${i}`}>
                                        <td>
                                          <span style={{ fontFamily: "monospace", fontSize: 12, fontWeight: 700, color: "#173e77" }}>{s.ref}</span>
                                          {s.title && <div style={{ fontSize: 11, ...muted }}>{s.title}</div>}
                                        </td>
                                        <td>
                                          {s.error ? <span style={{ color: "#c0392b" }}>{s.error}</span>
                                            : s.manual ? <span style={muted}>Manual / non-delay SLA</span>
                                            : <span>{s.count} {s.unitLabel}</span>}
                                        </td>
                                        <td style={{ textAlign: "right" }}>{s.error || s.manual ? "—" : (s.severity ?? "—")}</td>
                                        <td style={{ textAlign: "right" }}>{s.error || s.manual ? "—" : (s.points ?? "—")}</td>
                                        <td style={{ textAlign: "right", fontWeight: 700, color: num(s.ldPercent) > 0 ? "#c0392b" : "#173e77" }}>
                                          {s.error || s.manual ? "—" : `${num(s.ldPercent)}%`}
                                        </td>
                                      </tr>
                                    ))}
                                  </tbody>
                                </table>
                              </div>
                            )}
                          </div>
                        ))}
                      </div>
                    )}
                  </>
                )}
              </div>
            );
          })
        )
      ) : (
        <div className="uidai-pmis-card">
          <div style={{ padding: 24, textAlign: "center", ...muted }}>
            Set the date, then choose <strong style={{ color: "#173e77" }}>Generate report</strong> to compute delay penalties across milestones.
          </div>
        </div>
      )}
    </div>
  );
}