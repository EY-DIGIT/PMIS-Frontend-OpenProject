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
import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import { useParams, useSearchParams } from "react-router-dom";
import { useProject } from "../../store/project/projectsStore";
import { setPageContext, clearPageContext } from "../../utils/pageContext";
import {
  loadMilestonesForProject, loadActivitiesForMilestone,
} from "../../api/milestoneConfigApi";
import { getActivityCompliance } from "../../api/slaCompliance";
import {
  getActivityReplacementsReport,
  getAdditionalResourceOnboardingReport,
} from "../../api/attendanceReports";
import {
  readAdditionalResources, groupByDesignation, tallyOnboarding,
  readSlaNumbers, countCheck, classifyOnboarding,
} from "../../utils/project/additionalOnboarding";
import { normalizeStatus, STATUS } from "../../utils/project/slaRollup";
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
  if (m) return s;
  /* The overlap report sends ISO, but the rest of this service speaks
     dd-MM-yyyy — accepted here so one shape change doesn't blank a column.
     Never via `new Date`: it reads "04-03-2026" as 3 April, not 4 March. */
  const dmy = /^(\d{1,2})-(\d{1,2})-(\d{4})$/.exec(s);
  if (dmy) return `${dmy[3]}-${String(dmy[2]).padStart(2, "0")}-${String(dmy[1]).padStart(2, "0")}`;
  return "";
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

/* `slaResult` is free text, and every one of these reports comes from the same
   service — so the vocabulary is shared with the additional-resource report
   rather than restated here. Two copies drifted apart once already: this page
   had no idea "Within 21 Days" meant a pass, which is what the server actually
   sends, so six compliant rows rendered as unclassified.

   classifyOnboarding also returns "pending", which the replacement reports do
   not use today. It is mapped to its own neutral tone rather than folded into
   a pass or a failure, because a seat nobody has filled yet is neither. */
const resultTone = (raw) => {
  const s = String(raw ?? "").trim();
  if (!s) return { label: "—", tone: C.faint, kind: "unknown" };
  const kind = classifyOnboarding(s);
  const tone =
    kind === "fail" ? C.red
      : kind === "pass" ? C.green
        : kind === "pending" ? C.amber
          : C.ink2;
  return { label: s, tone, kind };
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

  /* ── SLA state for the selected activity ──────────────────────────
     The availability numbers are what the SLAs are measured on; this is
     the verdict they produced. Read from the compliance store rather
     than derived here — the scoring is the backend's, and a second
     opinion computed on this page could disagree with the rollup and
     with what Settlement invoices.

     Only the activity's OWN mapped SLAs are read (the endpoint is
     activity-scoped), which is the cross-check asked for. Every
     activity reachable on this page already sits under a resource-based
     milestone — `pickableMilestones` filters on `isResourceBased` — so
     no further gating is needed for "resource-based only".

     A failed call leaves `slaBreached` false and shows no badge. That is
     deliberate: the badge asserts a breach, and asserting one on a
     failed lookup is worse than staying quiet. `slaCheckFailed` records
     it so the absence can be explained rather than read as "clean". */
  const [slaResults, setSlaResults] = useState([]);
  const [slaCheckFailed, setSlaCheckFailed] = useState(false);

  useEffect(() => {
    if (!activityId) { setSlaResults([]); setSlaCheckFailed(false); return undefined; }
    let active = true;
    (async () => {
      try {
        const res = await getActivityCompliance(activityId);
        if (!active) return;
        setSlaResults(Array.isArray(res?.results) ? res.results : []);
        setSlaCheckFailed(false);
      } catch {
        if (!active) return;
        setSlaResults([]);
        setSlaCheckFailed(true);
      }
    })();
    return () => { active = false; };
  }, [activityId, refreshKey]);

  /* Breached if ANY mapped SLA is. Counted through `normalizeStatus`
     because the wire values are enum names — "breached" here, but also
     `pending_observation`, `excluded` — and matching the bare string
     would quietly score a breach as nothing. */
  const breachedSlas = useMemo(
    () => slaResults.filter((r) => normalizeStatus(r?.status) === STATUS.BREACHED),
    [slaResults]
  );
  const slaBreached = breachedSlas.length > 0;

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

  /* ── SLA 005 · replacement count ──────────────────────────────────────
     GET /api/attendance/report/activity/replacements
       ?projectId&activityId — the staffing history behind the two
     sections below. They score how well each handover went; this one is
     the count of handovers, which is its own SLA and its own request. */
  const [replacements, setReplacements] = useState(null);
  const [replacementsLoading, setReplacementsLoading] = useState(false);
  const [replacementsError, setReplacementsError] = useState(null);

  useEffect(() => {
    if (!projectId || !activityId) { setReplacements(null); setReplacementsError(null); return undefined; }
    let active = true;
    const controller = new AbortController();
    (async () => {
      setReplacementsLoading(true);
      setReplacementsError(null);
      const { data, error: err } = await getActivityReplacementsReport(
        projectId, activityId, controller.signal
      );
      if (!active) return;
      setReplacements(data);
      // A 404 comes back as null data with no error — "nobody has been
      // staffed here yet" is a real answer, not a fault.
      if (err) setReplacementsError(err);
      setReplacementsLoading(false);
    })();
    return () => { active = false; controller.abort(); };
  }, [projectId, activityId, refreshKey]);

  /* ── SLA 006 · replacement overlap ────────────────────────────────────
     GET /api/attendance/report/activity/replacement-overlap
       ?projectId&activityId — both required (verified: omitting either is 400).
     Its own request and its own error state: one section failing shouldn't
     take the other off the page, since they answer different SLAs. */
  const [overlap, setOverlap] = useState(null);
  const [overlapLoading, setOverlapLoading] = useState(false);
  const [overlapError, setOverlapError] = useState(null);

  useEffect(() => {
    if (!projectId || !activityId) { setOverlap(null); setOverlapError(null); return undefined; }
    let active = true;
    const controller = new AbortController();
    const FALLBACK = "Couldn't load the replacement overlap report.";
    (async () => {
      setOverlapLoading(true);
      setOverlapError(null);
      try {
        const token = getToken();
        const qs = new URLSearchParams({ projectId, activityId });
        const res = await fetch(
          `${API_BASE}/api/attendance/report/activity/replacement-overlap?${qs}`,
          {
            signal: controller.signal,
            cache: "no-store",
            headers: { accept: "*/*", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
          }
        );
        // No replacements recorded is a real answer, not a failure.
        if (res.status === 404) { if (active) setOverlap(null); return; }
        if (!res.ok) throw new Error(await readErrorMessage(res, FALLBACK));
        const data = await readJsonBody(res, FALLBACK);
        if (active) setOverlap(data && typeof data === "object" ? data : null);
      } catch (err) {
        const msg = requestErrorMessage(err, FALLBACK);
        if (active) { setOverlap(null); if (msg) setOverlapError(msg); }
      } finally {
        if (active) setOverlapLoading(false);
      }
    })();
    return () => { active = false; controller.abort(); };
  }, [projectId, activityId, refreshKey]);

  /* ── SLA 008 · additional resource onboarding ─────────────────────────
     GET /api/attendance/report/activity/additional-resource-onboarding
       ?projectId&activityId — both required, same as the two below.

     A different event from SLA 009: that one refills a seat somebody
     vacated, this one fills a seat that did not exist until the team was
     approved to grow. So it only ever covers the second onboarding
     onwards against a designation — the first is the original deployment.

     Fetched through the api module rather than inline, like the
     replacement history above; the four hand-rolled fetches on this page
     predate it and are left alone rather than rewritten here. */
  const [additional, setAdditional] = useState(null);
  const [additionalLoading, setAdditionalLoading] = useState(false);
  const [additionalError, setAdditionalError] = useState(null);

  useEffect(() => {
    if (!projectId || !activityId) { setAdditional(null); setAdditionalError(null); return undefined; }
    let active = true;
    const controller = new AbortController();
    (async () => {
      setAdditionalLoading(true);
      setAdditionalError(null);
      const { data, error: err } = await getAdditionalResourceOnboardingReport(
        projectId, activityId, controller.signal
      );
      if (!active) return;
      setAdditional(data);
      // A 404 comes back as null data with no error — "the team was never
      // grown here" is a real answer, not a fault.
      if (err) setAdditionalError(err);
      setAdditionalLoading(false);
    })();
    return () => { active = false; controller.abort(); };
  }, [projectId, activityId, refreshKey]);

  /* ── SLA 009 · replacement onboarding ─────────────────────────────────
     GET /api/attendance/report/activity/replacement-onboarding
       ?projectId&activityId — both required, same as the overlap report.
     Its own request and error state for the same reason: the two answer
     different SLAs, and one failing shouldn't blank the other. */
  const [onboarding, setOnboarding] = useState(null);
  const [onboardingLoading, setOnboardingLoading] = useState(false);
  const [onboardingError, setOnboardingError] = useState(null);

  useEffect(() => {
    if (!projectId || !activityId) { setOnboarding(null); setOnboardingError(null); return undefined; }
    let active = true;
    const controller = new AbortController();
    const FALLBACK = "Couldn't load the replacement onboarding report.";
    (async () => {
      setOnboardingLoading(true);
      setOnboardingError(null);
      try {
        const token = getToken();
        const qs = new URLSearchParams({ projectId, activityId });
        const res = await fetch(
          `${API_BASE}/api/attendance/report/activity/replacement-onboarding?${qs}`,
          {
            signal: controller.signal,
            cache: "no-store",
            headers: { accept: "*/*", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
          }
        );
        // No replacements recorded is a real answer, not a failure.
        if (res.status === 404) { if (active) setOnboarding(null); return; }
        if (!res.ok) throw new Error(await readErrorMessage(res, FALLBACK));
        const data = await readJsonBody(res, FALLBACK);
        if (active) setOnboarding(data && typeof data === "object" ? data : null);
      } catch (err) {
        const msg = requestErrorMessage(err, FALLBACK);
        if (active) { setOnboarding(null); if (msg) setOnboardingError(msg); }
      } finally {
        if (active) setOnboardingLoading(false);
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
          <h2 className="sla-section-title">
            Resource availability
            {/* State only — deliberately not a link or a control. The
                scoring behind it lives on the SLA Rollup; repeating any
                of it here would be a second place to keep correct. */}
            {selectionComplete && slaBreached && (
              <span
                className="sla-breach-badge"
                title={
                  `Breached: ${breachedSlas.map((r) => r.slaRef || r.slaId).join(", ")}`
                  + " — scored by the SLA evaluation for this activity."
                }
              >
                Breached
              </span>
            )}
            {/* Without this, a failed lookup looks exactly like a clean
                activity — the badge is simply absent either way. */}
            {selectionComplete && slaCheckFailed && (
              <span className="sla-breach-unknown" title="The SLA results for this activity could not be read, so no breach state is shown.">
                SLA status unavailable
              </span>
            )}
          </h2>
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

      {/* SLA 005 — the count itself. The two sections below measure how
          WELL each replacement was handled; this one measures how many
          there were, which is a separate SLA and was the one figure this
          page could not answer. */}
      <section className="sla-section">
        <div className="sla-section-head">
          <h2 className="sla-section-title">Resource replacement</h2>
        </div>

        {!selectionComplete ? (
          <EmptyState
            title={!milestoneId ? "Select a milestone to begin" : "Now select an activity"}
            hint={
              !milestoneId
                ? "Pick a milestone above, then the activity within it."
                : "Replacements are reported per activity — choose one of this milestone's activities."
            }
          />
        ) : replacementsLoading ? (
          <div className="sla-muted">Loading replacement history…</div>
        ) : replacementsError ? (
          <div className="sla-error">{replacementsError}</div>
        ) : (
          <ReplacementCountTable data={replacements} />
        )}
      </section>

      <section className="sla-section">
        <div className="sla-section-head">
          <h2 className="sla-section-title">Replacement overlap</h2>
        </div>

        {!selectionComplete ? (
          <EmptyState
            title={!milestoneId ? "Select a milestone to begin" : "Now select an activity"}
            hint={
              !milestoneId
                ? "Pick a milestone above, then the activity within it."
                : "Overlap is reported per activity — choose one of this milestone's activities."
            }
          />
        ) : overlapLoading ? (
          <div className="sla-muted">Loading replacement overlap…</div>
        ) : overlapError ? (
          <div className="sla-error">{overlapError}</div>
        ) : (
          <ReplacementSlaTable data={overlap} {...SLA006} />
        )}
      </section>

      {/* Placed immediately before replacement onboarding because the two
          are the easiest pair on this page to confuse — both measure days
          to onboard — and reading them adjacently is what makes the
          difference obvious: this one moves an approved head count, that
          one refills a seat that was already funded. */}
      <section className="sla-section">
        <div className="sla-section-head">
          <h2 className="sla-section-title">Additional resource onboarding</h2>
        </div>

        {!selectionComplete ? (
          <EmptyState
            title={!milestoneId ? "Select a milestone to begin" : "Now select an activity"}
            hint={
              !milestoneId
                ? "Pick a milestone above, then the activity within it."
                : "Additional resources are reported per activity — choose one of this milestone's activities."
            }
          />
        ) : additionalLoading ? (
          <div className="sla-muted">Loading additional resource onboarding…</div>
        ) : additionalError ? (
          <div className="sla-error">{additionalError}</div>
        ) : (
          <AdditionalOnboardingTable data={additional} />
        )}
      </section>

      <section className="sla-section">
        <div className="sla-section-head">
          <h2 className="sla-section-title">Replacement onboarding</h2>
        </div>

        {!selectionComplete ? (
          <EmptyState
            title={!milestoneId ? "Select a milestone to begin" : "Now select an activity"}
            hint={
              !milestoneId
                ? "Pick a milestone above, then the activity within it."
                : "Onboarding time is reported per activity — choose one of this milestone's activities."
            }
          />
        ) : onboardingLoading ? (
          <div className="sla-muted">Loading replacement onboarding…</div>
        ) : onboardingError ? (
          <div className="sla-error">{onboardingError}</div>
        ) : (
          <ReplacementSlaTable data={onboarding} {...SLA009} />
        )}
      </section>
    </div>
  );
}

/* The replacement SLAs share one shape: an envelope of replacements, each
   naming who left and who arrived, two dates that bracket the handover, and
   the server's verdict. SLA 006 measures the overlap between the two people;
   SLA 009 measures how long the seat took to refill. Only those two dates and
   the measured figure differ, so they are passed in rather than the whole
   table being written twice — one copy to drift is enough.

   The server decides pass or fail. This shows the dates it decided from, so a
   disputed result can be checked rather than taken on trust. */
function ReplacementSlaTable({ data, outgoingDate, incomingDate, metrics = [] }) {
  /* Memoised because the tally below depends on it: the `: []` branch hands
     back a fresh array every render, which would re-tally on every render. */
  const raw = data?.replacements;
  const rows = useMemo(() => (Array.isArray(raw) ? raw : []), [raw]);

  /* Counted from the rows rather than trusting a headline, and only rows we
     could actually classify — an unrecognised result is neither a pass nor a
     failure, and folding it into either would misstate the position. */
  const tally = useMemo(() => {
    let pass = 0, fail = 0, unknown = 0;
    rows.forEach((r) => {
      const k = resultTone(r?.slaResult).kind;
      if (k === "pass") pass += 1;
      else if (k === "fail") fail += 1;
      else unknown += 1;
    });
    return { pass, fail, unknown };
  }, [rows]);

  if (!rows.length) {
    return (
      <EmptyState
        title="No replacements"
        hint="Nobody was replaced on this activity, so there is nothing for this SLA to measure."
      />
    );
  }

  /* The envelope's own count, kept only to flag a disagreement with the rows
     actually returned — a truncated list would otherwise pass unnoticed. */
  const stated = data?.replacementCount;
  const countMismatch = stated != null && num(stated) !== rows.length;

  return (
    <div className="uidai-pmis-card sla-card">
      <div className="sla-card-head">
        <div className="sla-meta">
          <span className="sla-meta-lbl">Activity</span>
          <span className="sla-meta-val">{data?.activityName || "—"}</span>
        </div>
        <div className="sla-meta">
          <span className="sla-meta-lbl">Replacements</span>
          <span className="sla-meta-val">{rows.length}</span>
        </div>
        {tally.fail > 0 && (
          <div className="sla-meta">
            <span className="sla-meta-lbl">Not met</span>
            <span className="sla-meta-val" style={{ color: C.red }}>{tally.fail}</span>
          </div>
        )}
        {tally.pass > 0 && (
          <div className="sla-meta">
            <span className="sla-meta-lbl">Met</span>
            <span className="sla-meta-val" style={{ color: C.green }}>{tally.pass}</span>
          </div>
        )}
        {tally.unknown > 0 && (
          <div className="sla-meta">
            <span className="sla-meta-lbl">Unclassified</span>
            <span className="sla-meta-val" style={{ color: C.ink2 }}>{tally.unknown}</span>
          </div>
        )}
      </div>

      {countMismatch && (
        <div className="sla-warn">
          The report states {days(stated)} replacements but returned {rows.length}.
          The rows below are what was returned.
        </div>
      )}

      <div className="sla-table-wrap">
        <table className="sla-table">
          <thead>
            <tr>
              <th className="sla-th">SLA</th>
              <th className="sla-th">Designation</th>
              <th className="sla-th">Outgoing</th>
              {outgoingDate && <th className="sla-th" title={outgoingDate.title}>{outgoingDate.h}</th>}
              <th className="sla-th">Incoming</th>
              {incomingDate && <th className="sla-th" title={incomingDate.title}>{incomingDate.h}</th>}
              {metrics.map((c) => (
                <th key={c.h} className={`sla-th${c.num ? " sla-num" : ""}`} title={c.title}>{c.h}</th>
              ))}
              <th className="sla-th">Result</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => {
              const res = resultTone(r?.slaResult);
              /* A replacement into a different role is not a like-for-like
                 handover. The server may not treat it as a breach, but it is
                 the kind of thing a reviewer needs to see. */
              const outDes = String(r?.outgoingDesignation || "").trim();
              const inDes = String(r?.incomingDesignation || "").trim();
              const roleChanged = outDes && inDes && outDes !== inDes;
              return (
                <tr key={`${r?.outgoingResId}-${r?.incomingResId}-${i}`} className="sla-row">
                  <td className="sla-td sla-strong">{r?.slaNumber || "—"}</td>
                  <td className="sla-td">
                    {outDes || inDes || "—"}
                    {roleChanged && (
                      <span className="sla-flag" title={`Replaced by a different designation — ${inDes}`}>
                        → {inDes}
                      </span>
                    )}
                  </td>
                  <td className="sla-td">
                    <span className="sla-strong">{r?.outgoingName || "—"}</span>
                    {r?.outgoingResId && <code className="sla-code">{r.outgoingResId}</code>}
                  </td>
                  {outgoingDate && <td className="sla-td">{outgoingDate.get(r)}</td>}
                  <td className="sla-td">
                    <span className="sla-strong">{r?.incomingName || "—"}</span>
                    {r?.incomingResId && <code className="sla-code">{r.incomingResId}</code>}
                  </td>
                  {incomingDate && <td className="sla-td">{incomingDate.get(r)}</td>}
                  {metrics.map((c) => (
                    <td key={c.h} className={`sla-td${c.num ? " sla-num sla-strong" : ""}`}>{c.get(r)}</td>
                  ))}
                  <td className="sla-td sla-strong" style={{ color: res.tone }}>{res.label}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/* SLA 006 — the handover overlap: how many working days the outgoing resource
   and their replacement were both on the activity. */
const SLA006 = {
  outgoingDate: {
    h: "Last Working Day",
    title: "The outgoing resource's last day on the activity.",
    get: (r) => prettyDate(r?.outgoingLastWorkingDate) || "—",
  },
  incomingDate: {
    h: "Joining Date",
    title: "The day the replacement joined the activity.",
    get: (r) => prettyDate(r?.incomingJoiningDate) || "—",
  },
  metrics: [
    {
      h: "Overlap",
      title: "The days both were on the activity — the handover window.",
      get: (r) => {
        const from = prettyDate(r?.overlapStartDate);
        const to = prettyDate(r?.overlapEndDate);
        if (!from && !to) return <span className="sla-dim">No overlap</span>;
        return <>{from || "—"}<span className="sla-arrow" aria-hidden="true"> → </span>{to || "—"}</>;
      },
    },
    {
      h: "Working Days",
      num: true,
      title: "Working days in the overlap window, excluding weekends and holidays. This is the figure the SLA is judged on.",
      get: (r) => days(r?.overlapWorkingDays),
    },
  ],
};

/* SLA 005 — the replacement COUNT, per designation.

   The other two replacement sections judge how well each handover went.
   This one judges how many there were, which is a different SLA and a
   different question: a project can hand over perfectly every time and
   still breach 005 by handing over too often.

   Split by designation rather than shown as one number, because the
   target table reads "every increase of 1 replacement" — a repeating
   severity — and because a count only means something against the number
   of seats. Two replacements across one seat is churn; across ten seats
   it is ordinary.

   `resources[]` carries who held the seat and whether they are still on
   it, so a vacant seat is called out: it is the state that generates the
   NEXT replacement, and it is invisible in a bare count. */
function ReplacementCountTable({ data }) {
  const raw = data?.designations;
  const rows = useMemo(() => (Array.isArray(raw) ? raw : []), [raw]);

  const summed = useMemo(
    () => rows.reduce((t, d) => t + num(d.replacementCount), 0),
    [rows]
  );
  const vacant = useMemo(
    () => rows.filter((d) => {
      const people = Array.isArray(d.resources) ? d.resources : [];
      return people.length > 0 && !people.some((p) => p?.active);
    }).length,
    [rows]
  );

  if (!rows.length) {
    return (
      <EmptyState
        title="No staffing reported"
        hint="Nobody has been recorded against this activity yet, so there are no replacements to count."
      />
    );
  }

  /* The envelope's own total against the sum of the rows — a disagreement
     matters here because either number could be the one someone types
     into an evaluation form. */
  const stated = data?.totalReplacements;
  const countMismatch = stated != null && num(stated) !== summed;

  return (
    <div className="uidai-pmis-card sla-card">
      <div className="sla-card-head">
        <div className="sla-meta">
          <span className="sla-meta-lbl">Activity</span>
          <span className="sla-meta-val">{data?.activityName || "—"}</span>
        </div>
        <div className="sla-meta">
          <span className="sla-meta-lbl">Replacements</span>
          <span className="sla-meta-val" style={{ color: summed > 0 ? C.red : C.green }}>{summed}</span>
        </div>
        <div className="sla-meta">
          <span className="sla-meta-lbl">Designations</span>
          <span className="sla-meta-val">{rows.length}</span>
        </div>
        {vacant > 0 && (
          <div className="sla-meta">
            <span className="sla-meta-lbl">Seats vacant</span>
            <span className="sla-meta-val" style={{ color: C.amber }}>{vacant}</span>
          </div>
        )}
      </div>

      {countMismatch && (
        <div className="sla-warn">
          The report states {days(stated)} replacements in total but the rows sum to {summed}.
          The per-designation rows below are what was returned.
        </div>
      )}

      <div className="sla-table-wrap">
        <table className="sla-table">
          <thead>
            <tr>
              <th className="sla-th">Designation</th>
              <th className="sla-th sla-num" title="Seats this activity is configured for.">Seats</th>
              <th className="sla-th sla-num" title="How many different people have held one of those seats.">People seen</th>
              <th className="sla-th sla-num" title="Times a seat changed hands. This is the figure SLA 005 is judged on.">Replacements</th>
              <th className="sla-th" title="Who is on the seat now.">Currently deployed</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((d, i) => {
              const people = Array.isArray(d.resources) ? d.resources : [];
              const active = people.filter((p) => p?.active);
              const count = num(d.replacementCount);
              const seatVacant = people.length > 0 && active.length === 0;
              return (
                <tr key={d.designation || i} className="sla-row">
                  <td className="sla-td sla-strong">{d.designation || "—"}</td>
                  <td className="sla-td sla-num">{num(d.configuredQuantity) || "—"}</td>
                  <td className="sla-td sla-num">{num(d.distinctResourceCount) || "—"}</td>
                  <td className="sla-td sla-num" style={{ color: count > 0 ? C.red : C.green, fontWeight: 700 }}>
                    {count}
                  </td>
                  <td className="sla-td">
                    {seatVacant ? (
                      <span className="sla-flag" title="Nobody is currently on this seat.">seat vacant</span>
                    ) : (
                      active.map((p) => p.employeeName).filter(Boolean).join(", ") || "—"
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="sla-note">
        SLA 005 scores on the count, and its target table reads &ldquo;every increase of 1
        replacement&rdquo; — a repeating severity, so {summed === 1 ? "one replacement is one hit" : `${summed} replacements are ${summed} hits`},
        not a single one.
      </div>
    </div>
  );
}

/* SLA 009 — how long the seat stood empty: from being notified that the
   outgoing resource is leaving, to the replacement actually mobilising. */
const SLA009 = {
  outgoingDate: {
    h: "Notification Date",
    title: "When the replacement was notified — the clock for this SLA starts here.",
    get: (r) => prettyDate(r?.notificationDate) || "—",
  },
  incomingDate: {
    h: "Mobilization Date",
    title: "When the incoming resource actually mobilised — the clock stops here.",
    get: (r) => prettyDate(r?.mobilizationDate) || "—",
  },
  metrics: [
    {
      h: "Onboarding Days",
      num: true,
      title: "Days from notification to mobilisation. This is the figure the SLA is judged on.",
      get: (r) => days(r?.onboardingDays),
    },
  ],
};

/* SLA 008 — onboarding of a resource ADDED to the team.

   The quantity columns are what distinguish this from SLA 009 above, and they
   earn their width: an addition is only an addition because an approved head
   count moved. "0 → 1" is the whole justification for the row existing, and
   without it a reader has two near-identical onboarding tables and no way to
   tell which event each one measured.

   The reading — grouping, tally, SLA number — is in
   utils/project/additionalOnboarding, shared with the reference panel on the
   Activity SLAs page so the two screens cannot quote different figures for one
   activity. */
function AdditionalOnboardingTable({ data }) {
  const rows = useMemo(() => readAdditionalResources(data), [data]);
  const groups = useMemo(() => groupByDesignation(rows), [rows]);
  const tally = useMemo(() => tallyOnboarding(rows), [rows]);
  const sla = useMemo(() => readSlaNumbers(rows), [rows]);
  const check = useMemo(() => countCheck(data, rows, groups), [data, rows, groups]);

  if (!rows.length) {
    return (
      <EmptyState
        title="No additional resources"
        hint="This activity's team was never approved to grow, so nothing has been onboarded as an addition. The first person against a designation is the original deployment, not an addition."
      />
    );
  }

  /* Pending is deliberately not a verdict. An approved head that nobody has
     arrived for yet has neither met the SLA nor missed it — the planned date
     may be months out — so it is counted and coloured on its own rather than
     folded into either column. */
  const kindTone = (k) => (k === "fail" ? C.red : k === "pass" ? C.green : k === "pending" ? C.amber : C.ink2);

  // Stated once per designation: the quantities describe the seat count, not
  // the person, so repeating them per head would read as repeated approvals.
  const approved = (g) => (
    <>
      <td className="sla-td sla-num">
        {g.originalQuantity === null ? "—" : g.originalQuantity}
        <span className="sla-arrow" aria-hidden="true"> → </span>
        {g.currentApprovedQuantity === null ? "—" : g.currentApprovedQuantity}
      </td>
      <td className="sla-td sla-num sla-strong">
        {g.additionalQuantity === null ? "—" : `+${g.additionalQuantity}`}
        {g.quantitiesVary && (
          <span className="sla-flag" title="Rows of this designation disagree about its quantities — the figures shown are the first row's.">
            ⚠ varies
          </span>
        )}
      </td>
    </>
  );

  const measured = (r) => (
    <>
      <td className="sla-td">
        {r.employeeName
          ? <span className="sla-strong">{r.employeeName}</span>
          : <span style={{ color: C.faint, fontStyle: "italic" }}>unassigned</span>}
        {r.resId && <code className="sla-code">{r.resId}</code>}
      </td>
      <td className="sla-td">{prettyDate(r.plannedDeploymentDate) || "—"}</td>
      <td className="sla-td">{prettyDate(r.actualOnboardingDate) || "—"}</td>
      <td className="sla-td sla-num sla-strong">
        {r.onboardingDays === null ? "—" : days(r.onboardingDays)}
      </td>
      <td className="sla-td sla-strong" style={{ color: kindTone(r.kind) }}>
        {r.slaResult || "—"}
      </td>
    </>
  );

  return (
    <div className="uidai-pmis-card sla-card">
      <div className="sla-card-head">
        <div className="sla-meta">
          <span className="sla-meta-lbl">Activity</span>
          <span className="sla-meta-val">{data?.activityName || "—"}</span>
        </div>
        <div className="sla-meta">
          <span className="sla-meta-lbl">Additional resources</span>
          <span className="sla-meta-val">{rows.length}</span>
        </div>
        {check.headcount !== null && check.headcount !== rows.length && (
          <div className="sla-meta">
            <span className="sla-meta-lbl">Heads approved</span>
            <span className="sla-meta-val">{check.headcount}</span>
          </div>
        )}
        {tally.fail > 0 && (
          <div className="sla-meta">
            <span className="sla-meta-lbl">Not met</span>
            <span className="sla-meta-val" style={{ color: C.red }}>{tally.fail}</span>
          </div>
        )}
        {tally.pass > 0 && (
          <div className="sla-meta">
            <span className="sla-meta-lbl">Met</span>
            <span className="sla-meta-val" style={{ color: C.green }}>{tally.pass}</span>
          </div>
        )}
        {tally.pending > 0 && (
          <div className="sla-meta">
            <span className="sla-meta-lbl">Pending</span>
            <span className="sla-meta-val" style={{ color: C.amber }}>{tally.pending}</span>
          </div>
        )}
        {tally.unknown > 0 && (
          <div className="sla-meta">
            <span className="sla-meta-lbl">Unclassified</span>
            <span className="sla-meta-val" style={{ color: C.ink2 }}>{tally.unknown}</span>
          </div>
        )}
      </div>

      {check.mismatch && (
        <div className="sla-warn">
          The report states {days(check.stated)} additional resources but returned {rows.length} row
          {rows.length === 1 ? "" : "s"} covering {days(check.headcount)} head
          {check.headcount === 1 ? "" : "s"}. The rows below are what was returned.
        </div>
      )}

      <div className="sla-table-wrap">
        <table className="sla-table">
          <thead>
            <tr>
              <th className="sla-th">SLA</th>
              <th className="sla-th">Designation</th>
              <th className="sla-th sla-num" title="Approved head count before → after the addition.">Approved</th>
              <th className="sla-th sla-num" title="Heads added to this designation.">Added</th>
              <th className="sla-th">Resource</th>
              <th className="sla-th" title="When the added head was planned to deploy — the clock for this SLA starts here.">
                Planned Deployment
              </th>
              <th className="sla-th" title="When they actually onboarded — the clock stops here. Empty while the seat is unfilled.">
                Actual Onboarding
              </th>
              <th className="sla-th sla-num" title="Days from planned deployment to actual onboarding. This is the figure the SLA is judged on.">
                Onboarding Days
              </th>
              <th className="sla-th">Result</th>
            </tr>
          </thead>
          <tbody>
            {groups.map((g) => (
              g.rows.length === 1 ? (
                <tr key={g.designation} className="sla-row">
                  <td className="sla-td sla-strong">{g.rows[0].slaNumber || sla.label || "—"}</td>
                  <td className="sla-td">{g.designation || "—"}</td>
                  {approved(g)}
                  {measured(g.rows[0])}
                </tr>
              ) : (
                /* Several heads against one approval. The designation and its
                   quantities are stated once on a header row, then a row per
                   person beneath — repeating "0 → 3" on each would read as
                   three separate approvals for nine heads. */
                <Fragment key={g.designation}>
                  <tr className="sla-row">
                    <td className="sla-td sla-strong">{g.slaNumber || sla.label || "—"}</td>
                    <td className="sla-td sla-strong">{g.designation || "—"}</td>
                    {approved(g)}
                    <td className="sla-td" colSpan={5} style={{ color: C.muted, fontStyle: "italic" }}>
                      {g.rows.length} heads against this approval
                    </td>
                  </tr>
                  {g.rows.map((r) => (
                    <tr key={r.i} className="sla-row">
                      <td className="sla-td" />
                      <td className="sla-td" />
                      <td className="sla-td" />
                      <td className="sla-td" />
                      {measured(r)}
                    </tr>
                  ))}
                </Fragment>
              )
            ))}
          </tbody>
        </table>
      </div>

      <div className="sla-note">
        Measured from the planned deployment date to the actual onboarding date, so it
        only covers heads ADDED to an already-staffed designation — the first person
        against a designation is the original deployment and is not scored here.
        {tally.pending > 0 && (
          <> {tally.pending === 1 ? "One seat is" : `${tally.pending} seats are`} still
            pending: approved, not yet onboarded, and so neither met nor missed.</>
        )}
      </div>
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
  letter-spacing: -0.01em; display: flex; align-items: center; gap: 9px;
  flex-wrap: wrap; }

/* Sized off the heading it sits beside rather than set in absolute px, so
   it reads as part of the title and not as a control. */
.sla-breach-badge {
  font-size: 11.5px; font-weight: 800; letter-spacing: .04em;
  text-transform: uppercase; color: ${C.red};
  background: #fdeeee; border: 1px solid #f3c9c9;
  border-radius: 999px; padding: 3px 10px; white-space: nowrap;
}

/* Muted, not amber: this is "we don't know", not "something is wrong". */
.sla-breach-unknown {
  font-size: 11.5px; font-weight: 600; color: ${C.muted};
  background: ${C.surface}; border: 1px solid ${C.border};
  border-radius: 999px; padding: 3px 10px; white-space: nowrap;
}

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

.sla-dim { color: ${C.faint}; }
.sla-code { display: inline-block; margin-left: 7px; font-size: 11.5px; padding: 1px 6px;
  border-radius: 6px; background: ${C.surfaceAlt}; color: ${C.muted};
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }
/* A role change on a handover — quiet, but it shouldn't need a hover to spot. */
.sla-flag { display: inline-block; margin-left: 7px; font-size: 11.5px; font-weight: 700;
  padding: 1px 7px; border-radius: 999px; background: #fdf4e3; color: ${C.amber}; }
.sla-warn { margin: 0; padding: 10px 16px; font-size: 12.5px; color: ${C.amber};
  background: #fdf4e3; border-bottom: 1px solid ${C.divider}; line-height: 1.5; }
/* Explains how a figure in the table above is read. Sits BELOW the table
   and stays quiet — it is a footnote, not a warning. */
.sla-note { margin: 0; padding: 10px 16px; font-size: 12px; color: ${C.muted};
  border-top: 1px solid ${C.divider}; line-height: 1.6; }

.sla-muted { color: ${C.muted}; font-size: 14px; padding: 16px 0; }
.sla-error { color: ${C.red}; font-size: 14px; padding: 12px 14px; background: #fdecec;
  border: 1px solid #f4cccc; border-radius: 10px; margin: 4px 0 16px;
  white-space: pre-line; line-height: 1.55; }
.sla-empty { border: 1px dashed ${C.borderStrong}; border-radius: 14px; padding: 34px 20px;
  text-align: center; background: #fff; }
.sla-empty-title { margin: 0 0 6px; font-size: 15px; font-weight: 700; color: ${C.ink}; }
.sla-empty-hint { margin: 0 auto; font-size: 13px; color: ${C.muted}; max-width: 46ch; line-height: 1.6; }
`;
