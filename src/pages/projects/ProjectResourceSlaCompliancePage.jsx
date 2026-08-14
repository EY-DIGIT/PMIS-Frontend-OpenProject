/* ─────────────────────────────────────────────────────────────────────────
   Resource SLA Compliance — how far the deployed team met the availability
   the SLAs are measured against.

   Separate from the Attendance page on purpose. That page answers "how did
   this person do", per resource and per rupee. This one answers what the SLA
   is measured on: whether the team was actually available, month by month.
   The two read the same underlying attendance, but nobody settling an SLA
   wants a per-employee cost table, and nobody checking one person's leave
   wants a monthly availability roll-up.

   First source: GET /api/attendance/report/availability/activity
     ?projectId&activityId — both required (verified: omitting either is 400).
   More are expected here as the SLA inputs are built out, so the page is laid
   out as a stack of independent sections rather than one report.
   ───────────────────────────────────────────────────────────────────────── */
import { useCallback, useEffect, useMemo, useState } from "react";
import { useParams, useSearchParams } from "react-router-dom";
import { useProject } from "../../store/project/projectsStore";
import { setPageContext, clearPageContext } from "../../utils/pageContext";
import {
  loadMilestonesForProject, loadActivitiesForMilestone,
} from "../../api/milestoneConfigApi";
import { readErrorMessage, readJsonBody, requestErrorMessage } from "../../utils/apiMessage";
import { getToken } from "../../api/auth";
import "../../styles/global.css";

// TODO: move to env / the shared api client, alongside the other :8019 calls.
const API_BASE = "http://10.1.131.199:8019";

const C = {
  primary: "#0b3c88", ink: "#16202e", ink2: "#334155", muted: "#64748b",
  faint: "#94a3b8", border: "#e3e9f2", borderStrong: "#cbd5e1",
  surface: "#f6f9fc", surfaceAlt: "#eef3f9", divider: "#eef2f7",
  green: "#0f9d58", amber: "#c07d0a", red: "#d64545",
};

const MONTH_NAMES = [
  "", "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

const num = (v) => {
  const n = parseFloat(String(v ?? ""));
  return Number.isFinite(n) ? n : 0;
};

/* Trailing .0 is noise on a day count, but 21.5 has to survive. */
const days = (v) => (Number.isInteger(v) ? String(v) : String(Number(num(v).toFixed(2))));
const hours = (v) => num(v).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/* The payload mixes formats: `period` is "07-Jan-2026 to 06-Feb-2026" while
   fromDate/toDate are ISO. Parsed explicitly — `new Date("07-01-2026")` reads
   as 1 July, not 7 January, and would be wrong without ever looking wrong. */
const isoDate = (raw) => {
  const s = String(raw ?? "").trim();
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  return m ? s : "";
};
const prettyDate = (raw) => {
  const iso = isoDate(raw);
  if (!iso) return "";
  const mm = Number(iso.slice(5, 7));
  return MONTH_NAMES[mm] ? `${Number(iso.slice(8, 10))} ${MONTH_NAMES[mm].slice(0, 3)} ${iso.slice(0, 4)}` : "";
};

/* Availability is the SLA figure: the share of business days the team was
   actually present for. Returns null rather than 0 when there are no business
   days — "no days to be present for" is not "0% available", and a month that
   hasn't started would otherwise read as a total failure. */
const availabilityPct = (m) => {
  const bd = num(m?.totalBusinessDays);
  if (bd <= 0) return null;
  return (num(m?.totalPresentDays) / bd) * 100;
};

const pctTone = (p) => {
  if (p == null) return C.faint;
  if (p >= 99.5) return C.green;
  if (p >= 95) return C.amber;
  return C.red;
};

export default function ProjectResourceSlaCompliancePage() {
  const { projectId } = useParams();
  const project = useProject(projectId);

  useEffect(() => {
    setPageContext({ projectName: project?.projectName || "" });
    return () => clearPageContext();
  }, [project?.projectName]);

  /* Filter in the URL, like the attendance page: returning to this page —
     from a browser back or a nav round-trip — should land on the activity you
     were looking at rather than an empty picker. */
  const [searchParams, setSearchParams] = useSearchParams();
  const milestoneId = searchParams.get("milestone") || "";
  const activityId = searchParams.get("activity") || "";
  const setFilter = useCallback((patch) => {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      Object.entries(patch).forEach(([k, v]) => { if (v) next.set(k, v); else next.delete(k); });
      return next;
    }, { replace: true });
  }, [setSearchParams]);
  /* Changing the milestone drops the activity, which belonged to the old one.
     Done on the user's action rather than in the load effect below — that
     effect also runs on mount, and clearing there would wipe the activity
     being restored from the URL. */
  const setMilestoneId = useCallback((id) => setFilter({ milestone: id, activity: "" }), [setFilter]);
  const setActivityId = useCallback((id) => setFilter({ activity: id }), [setFilter]);

  const [milestones, setMilestones] = useState([]);
  const [milestonesError, setMilestonesError] = useState(null);
  useEffect(() => {
    if (!projectId) return undefined;
    let active = true;
    (async () => {
      try {
        const list = await loadMilestonesForProject(projectId);
        if (active) setMilestones(Array.isArray(list) ? list : []);
      } catch (err) {
        if (active) setMilestonesError(requestErrorMessage(err, "Couldn't load this project's milestones."));
      }
    })();
    return () => { active = false; };
  }, [projectId]);

  /* Only resource-based milestones saved on the server carry attendance, so
     they are the only ones that can answer for availability. */
  const pickableMilestones = useMemo(
    () => milestones.filter((m) => m.isResourceBased === true && m.apiId),
    [milestones]
  );
  const [activities, setActivities] = useState([]);
  const [activitiesLoading, setActivitiesLoading] = useState(false);
  useEffect(() => {
    if (!milestoneId) { setActivities([]); return undefined; }
    let active = true;
    setActivitiesLoading(true);
    (async () => {
      const list = await loadActivitiesForMilestone(milestoneId);
      if (!active) return;
      setActivities(Array.isArray(list) ? list : []);
      setActivitiesLoading(false);
    })();
    return () => { active = false; };
  }, [milestoneId]);

  /* A URL can name an activity that doesn't belong to the milestone beside it
     — bookmarked before it moved, or hand-edited. Only checked once the list
     has arrived: clearing while it loads would drop what we're restoring. */
  useEffect(() => {
    if (activitiesLoading || !activityId || !activities.length) return;
    if (!activities.some((a) => String(a.apiId) === String(activityId))) setActivityId("");
  }, [activities, activitiesLoading, activityId, setActivityId]);

  const [refreshKey, setRefreshKey] = useState(0);
  const [availability, setAvailability] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!projectId || !activityId) { setAvailability(null); setError(null); return undefined; }
    let active = true;
    const controller = new AbortController();
    const FALLBACK = "Couldn't load the availability report.";
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const token = getToken();
        const qs = new URLSearchParams({ projectId, activityId });
        const res = await fetch(`${API_BASE}/api/attendance/report/availability/activity?${qs}`, {
          signal: controller.signal,
          cache: "no-store",
          headers: { accept: "*/*", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        });
        /* No availability recorded yet is a real answer, not a failure. */
        if (res.status === 404) { if (active) setAvailability(null); return; }
        if (!res.ok) throw new Error(await readErrorMessage(res, FALLBACK));
        const data = await readJsonBody(res, FALLBACK);
        if (active) setAvailability(data && typeof data === "object" ? data : null);
      } catch (err) {
        const msg = requestErrorMessage(err, FALLBACK);
        if (active) { setAvailability(null); if (msg) setError(msg); }
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => { active = false; controller.abort(); };
  }, [projectId, activityId, refreshKey]);

  const months = useMemo(
    () => (Array.isArray(availability?.months) ? availability.months : []),
    [availability?.months]
  );

  /* Totals summed from the rows rather than taken from the envelope, which
     doesn't carry them. Availability is recomputed from the summed days, NOT
     averaged across months — a mean of monthly percentages would weight a
     2-day month the same as a 31-day one. */
  const totals = useMemo(() => {
    if (!months.length) return null;
    const businessDays = months.reduce((t, m) => t + num(m.totalBusinessDays), 0);
    const presentDays = months.reduce((t, m) => t + num(m.totalPresentDays), 0);
    const workingHours = months.reduce((t, m) => t + num(m.totalWorkingHours), 0);
    return {
      businessDays, presentDays, workingHours,
      pct: businessDays > 0 ? (presentDays / businessDays) * 100 : null,
      resources: months.reduce((mx, m) => Math.max(mx, num(m.resourceCount)), 0),
    };
  }, [months]);

  const selectionComplete = !!milestoneId && !!activityId;

  return (
    <div className="uidai-pmis-content sla-page">
      <style>{STYLES}</style>

      <header className="sla-head">
        <div>
          <div className="sla-eyebrow">{project?.projectName || "Project"}</div>
          <h1 className="uidai-pmis-title sla-title">Resource SLA Compliance</h1>
        </div>
        <button
          className="sla-btn"
          onClick={() => setRefreshKey((k) => k + 1)}
          disabled={loading || !selectionComplete}
          title="Reload the availability report"
        >
          Refresh
        </button>
      </header>

      {milestonesError && <div className="sla-error" role="alert">{milestonesError}</div>}

      <div className="sla-toolbar">
        <Field label="Milestone">
          <select
            className="sla-select"
            value={milestoneId}
            onChange={(e) => setMilestoneId(e.target.value)}
          >
            <option value="">Select Milestone</option>
            {pickableMilestones.map((m) => (
              <option key={m.apiId} value={m.apiId}>
                {[m.serverDisplayCode || m.id, m.name].filter(Boolean).join(" · ")}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Activity">
          <select
            className="sla-select"
            value={activityId}
            onChange={(e) => setActivityId(e.target.value)}
            disabled={!milestoneId || activitiesLoading || activities.length === 0}
          >
            <option value="">
              {!milestoneId ? "Choose a milestone first"
                : activitiesLoading ? "Loading activities…"
                : activities.length === 0 ? "No activities"
                : "Select Activity"}
            </option>
            {activities.map((a) => (
              <option key={a.apiId} value={a.apiId}>
                {[a.serverDisplayCode || a.id, a.name].filter(Boolean).join(" · ")}
              </option>
            ))}
          </select>
        </Field>
      </div>

      <section className="sla-section">
        <div className="sla-section-head">
          <h2 className="sla-section-title">Resource availability</h2>
        </div>

        {!selectionComplete ? (
          <EmptyState
            title={!milestoneId ? "Select a milestone to begin" : "Now select an activity"}
            hint={
              !milestoneId
                ? "Pick a milestone above, then the activity within it."
                : "Availability is reported per activity — choose one of this milestone's activities."
            }
          />
        ) : loading ? (
          <div className="sla-muted">Loading availability…</div>
        ) : error ? (
          <div className="sla-error">{error}</div>
        ) : !months.length ? (
          <EmptyState
            title="No availability recorded"
            hint="Nothing has been reported for this activity yet. Upload its attendance first."
          />
        ) : (
          <AvailabilityTable data={availability} months={months} totals={totals} />
        )}
      </section>
    </div>
  );
}

function AvailabilityTable({ data, months, totals }) {
  return (
    <div className="uidai-pmis-card sla-card">
      <div className="sla-card-head">
        <div className="sla-meta">
          <span className="sla-meta-lbl">Activity</span>
          <span className="sla-meta-val">{data?.activityName || "—"}</span>
        </div>
        <div className="sla-meta">
          <span className="sla-meta-lbl">Period</span>
          <span className="sla-meta-val">
            {prettyDate(data?.activityStartDate) || "—"}
            <span className="sla-arrow" aria-hidden="true"> → </span>
            {prettyDate(data?.activityEndDate) || "—"}
          </span>
        </div>
        {totals && (
          <div className="sla-meta">
            <span className="sla-meta-lbl">Availability</span>
            <span className="sla-meta-val" style={{ color: pctTone(totals.pct) }}>
              {totals.pct == null ? "—" : `${totals.pct.toFixed(2)}%`}
            </span>
          </div>
        )}
      </div>

      <div className="sla-table-wrap">
        <table className="sla-table">
          <thead>
            <tr>
              <th className="sla-th">Period</th>
              <th className="sla-th">From</th>
              <th className="sla-th">To</th>
              <th className="sla-th sla-num" title="Resources deployed on the activity in this cycle.">Resources</th>
              <th className="sla-th sla-num" title="Days the team was expected to cover: working days summed across every resource.">Business Days</th>
              <th className="sla-th sla-num" title="Days actually covered, summed across every resource.">Present Days</th>
              <th className="sla-th sla-num" title="Present days ÷ business days × 100. This is the figure an availability SLA is measured on.">Availability</th>
              <th className="sla-th sla-num" title="Hours logged across the team in this cycle.">Working Hours</th>
            </tr>
          </thead>
          <tbody>
            {months.map((m, i) => {
              const pct = availabilityPct(m);
              const short = num(m.totalBusinessDays) - num(m.totalPresentDays);
              return (
                <tr key={`${m.year}-${m.month}-${i}`} className="sla-row">
                  <td className="sla-td sla-strong">{m.period || `${MONTH_NAMES[num(m.month)] || ""} ${m.year || ""}`}</td>
                  <td className="sla-td">{prettyDate(m.fromDate) || "—"}</td>
                  <td className="sla-td">{prettyDate(m.toDate) || "—"}</td>
                  <td className="sla-td sla-num">{days(m.resourceCount)}</td>
                  <td className="sla-td sla-num">{days(m.totalBusinessDays)}</td>
                  {/* The shortfall on hover: "85 of 85" is reassuring, but when
                      it isn't, the gap is the number being argued over. */}
                  <td
                    className="sla-td sla-num"
                    title={short > 0 ? `${days(short)} days short of ${days(m.totalBusinessDays)}` : undefined}
                  >
                    {days(m.totalPresentDays)}
                  </td>
                  <td className="sla-td sla-num sla-strong" style={{ color: pctTone(pct) }}>
                    {pct == null ? "—" : `${pct.toFixed(2)}%`}
                  </td>
                  <td className="sla-td sla-num">{hours(m.totalWorkingHours)}</td>
                </tr>
              );
            })}
          </tbody>
          {totals && (
            <tfoot>
              <tr className="sla-row sla-foot">
                {/* Period, From and To — a total has no dates of its own. */}
                <td className="sla-td sla-strong" colSpan={3}>
                  Total · {months.length} {months.length === 1 ? "cycle" : "cycles"}
                </td>
                {/* Peak, not a sum: the same five people appearing in three
                    months are five resources, not fifteen. */}
                <td className="sla-td sla-num" title="The most resources deployed in any one cycle — not a sum, since the same people recur each month.">
                  {days(totals.resources)}
                </td>
                <td className="sla-td sla-num sla-strong">{days(totals.businessDays)}</td>
                <td className="sla-td sla-num sla-strong">{days(totals.presentDays)}</td>
                <td className="sla-td sla-num sla-strong" style={{ color: pctTone(totals.pct) }}>
                  {totals.pct == null ? "—" : `${totals.pct.toFixed(2)}%`}
                </td>
                <td className="sla-td sla-num sla-strong">{hours(totals.workingHours)}</td>
              </tr>
            </tfoot>
          )}
        </table>
      </div>
    </div>
  );
}

function Field({ label, children }) {
  return (
    <label className="sla-field">
      <span className="sla-field-lbl">{label}</span>
      {children}
    </label>
  );
}

function EmptyState({ title, hint }) {
  return (
    <div className="sla-empty">
      <h3 className="sla-empty-title">{title}</h3>
      <p className="sla-empty-hint">{hint}</p>
    </div>
  );
}

const STYLES = `
.sla-page { padding: 0 10px 72px; max-width: 1320px; margin: 0 auto; color: ${C.ink}; }
@media (max-width: 640px) { .sla-page { padding: 0 16px 48px; } }
.sla-page :focus-visible { outline: 2px solid ${C.primary}; outline-offset: 2px; border-radius: 6px; }

.sla-head { display: flex; align-items: center; justify-content: space-between;
  gap: 16px; flex-wrap: wrap; margin-bottom: 24px; }
.sla-eyebrow { font-size: 11px; font-weight: 700; letter-spacing: .08em;
  text-transform: uppercase; color: ${C.muted}; margin-bottom: 6px; }
.sla-title { margin: 0; letter-spacing: -0.02em; }
.sla-btn { display: inline-flex; align-items: center; gap: 8px; height: 40px; padding: 0 14px;
  border-radius: 10px; border: 1px solid ${C.border}; background: #fff; color: ${C.ink2};
  font-size: 14px; font-weight: 600; font-family: inherit; cursor: pointer;
  transition: background .15s ease, border-color .15s ease; }
.sla-btn:hover:not(:disabled) { background: ${C.surface}; border-color: ${C.borderStrong}; }
.sla-btn:disabled { opacity: .5; cursor: not-allowed; }

.sla-toolbar { display: flex; gap: 12px; flex-wrap: wrap; margin-bottom: 24px; }
.sla-field { display: flex; flex-direction: column; gap: 6px; }
.sla-field-lbl { font-size: 11.5px; font-weight: 700; letter-spacing: .05em;
  text-transform: uppercase; color: ${C.muted}; }
.sla-select { height: 40px; padding: 0 12px; border-radius: 10px; border: 1px solid ${C.border};
  background: #fff; color: ${C.ink}; font-size: 14px; font-family: inherit;
  min-width: 230px; max-width: 320px; cursor: pointer; outline: none; }
.sla-select:hover { border-color: ${C.borderStrong}; }
.sla-select:disabled { background: ${C.surfaceAlt}; color: ${C.muted}; cursor: not-allowed; }

.sla-section { margin-bottom: 24px; }
.sla-section-head { margin-bottom: 14px; }
.sla-section-title { font-size: 15px; font-weight: 700; color: ${C.ink}; margin: 0;
  letter-spacing: -0.01em; }

.sla-card { padding: 0; overflow: hidden; }
.sla-card-head { display: flex; gap: 28px; flex-wrap: wrap; padding: 14px 16px;
  border-bottom: 1px solid ${C.divider}; }
.sla-meta { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
.sla-meta-lbl { font-size: 10px; font-weight: 700; letter-spacing: .08em;
  text-transform: uppercase; color: ${C.faint}; }
.sla-meta-val { font-size: 14px; font-weight: 700; color: ${C.ink};
  font-variant-numeric: tabular-nums; }
.sla-arrow { color: ${C.faint}; font-weight: 400; }

.sla-table-wrap { overflow-x: auto; }
.sla-table { width: 100%; border-collapse: collapse; font-size: 14px; }
.sla-th { background: ${C.surface}; color: ${C.muted}; text-align: left; font-size: 11px;
  font-weight: 700; letter-spacing: .05em; text-transform: uppercase;
  padding: 10px 14px; border-bottom: 1px solid ${C.border}; white-space: nowrap; }
.sla-td { padding: 12px 14px; vertical-align: middle; color: ${C.ink};
  border-bottom: 1px solid ${C.divider}; white-space: nowrap; }
.sla-num { text-align: right; font-variant-numeric: tabular-nums; }
.sla-strong { font-weight: 700; }
.sla-row:hover .sla-td { background: ${C.surface}; }
.sla-foot .sla-td { background: ${C.surface}; border-top: 2px solid ${C.borderStrong};
  border-bottom: none; }

.sla-muted { color: ${C.muted}; font-size: 14px; padding: 16px 0; }
.sla-error { color: ${C.red}; font-size: 14px; padding: 12px 14px; background: #fdecec;
  border: 1px solid #f4cccc; border-radius: 10px; margin: 4px 0 16px;
  white-space: pre-line; line-height: 1.55; }
.sla-empty { border: 1px dashed ${C.borderStrong}; border-radius: 14px; padding: 34px 20px;
  text-align: center; background: #fff; }
.sla-empty-title { margin: 0 0 6px; font-size: 15px; font-weight: 700; color: ${C.ink}; }
.sla-empty-hint { margin: 0 auto; font-size: 13px; color: ${C.muted}; max-width: 46ch; line-height: 1.6; }
`;
