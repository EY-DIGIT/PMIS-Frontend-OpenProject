/* ══════════════════════════════════════════════════════════════════
   Attendance reports — the measured figures behind the resource SLAs.

   Four per-activity reports, one per SLA the attendance system can
   actually answer for:

     · replacements          → how many times a seat changed hands  (005)
     · replacement-overlap   → the handover window between two people (006)
     · availability          → business days vs days actually covered (007)
     · replacement-onboarding→ how long a vacated seat stood empty    (009)

   These are READ-ONLY observations. Nothing here scores an SLA or
   writes a result — they are the numbers a person reads off the screen
   while filling in an evaluation form, until the backend accepts them
   directly.

   A 404 means "nothing recorded", which is a real answer and not a
   failure: an activity where nobody was replaced has no replacement
   rows, and reporting that as an error would put a red banner on a
   perfectly healthy activity. It comes back as `null` data with no
   error, and the caller renders "none recorded" rather than a fault.

   Both query params are required on all three — omitting either is a
   400, verified against the service.
   ══════════════════════════════════════════════════════════════════ */
import { getToken } from "./auth";
import { readErrorMessage, readJsonBody, requestErrorMessage } from "../utils/apiMessage";

/* The attendance service. Overridable so it can move without a code
   change; the hardcoded host is the dev default, matching what
   ProjectResourceSlaCompliancePage already talks to. */
export const ATTENDANCE_BASE =
    (import.meta.env?.VITE_ATTENDANCE_BASE_URL || "http://10.1.131.199:8019").replace(/\/+$/, "");

/* One shape for every report: { data, error }.

   Never throws. A report failing is not a reason for the panel around
   it to disappear — the three answer different SLAs, and one being
   unreachable says nothing about the other two, so each carries its own
   outcome and the caller renders them independently. */
async function report(path, { projectId, activityId, signal, fallback }) {
    if (!projectId || !activityId) return { data: null, error: null };
    try {
        const token = getToken();
        const qs = new URLSearchParams({ projectId, activityId });
        const res = await fetch(`${ATTENDANCE_BASE}${path}?${qs}`, {
            signal,
            cache: "no-store",
            headers: { accept: "*/*", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        });
        // Nothing recorded — a real answer, not a fault.
        if (res.status === 404) return { data: null, error: null };
        if (!res.ok) return { data: null, error: await readErrorMessage(res, fallback) };
        const data = await readJsonBody(res, fallback);
        return { data: data && typeof data === "object" ? data : null, error: null };
    } catch (err) {
        // An aborted request is the caller changing its mind, not a failure.
        if (err?.name === "AbortError") return { data: null, error: null, aborted: true };
        return { data: null, error: requestErrorMessage(err, fallback) };
    }
}

/* SLA 005 — replacement count.

   Returns { activityName, activityStartDate, activityEndDate,
   totalReplacements, designations: [{ designation, configuredQuantity,
   distinctResourceCount, replacementCount, resources: [{ resourceId,
   employeeName, joiningDate, lastWorkingDate, active }] }] }.

   Same endpoint `attendanceReport.js` already calls for the staffing
   picture; wrapped here in the { data, error } shape so the panel can
   render all four reports through one code path instead of one of them
   throwing while the other three return. */
export function getActivityReplacementsReport(projectId, activityId, signal) {
    return report("/api/attendance/report/activity/replacements", {
        projectId, activityId, signal,
        fallback: "Couldn't load the replacement history.",
    });
}

/* SLA 007 — availability (deployment of resources).
   Returns { activityName, months: [{ month, totalBusinessDays,
   totalPresentDays, totalWorkingHours, resourceCount }] }. */
export function getAvailabilityReport(projectId, activityId, signal) {
    return report("/api/attendance/report/availability/activity", {
        projectId, activityId, signal,
        fallback: "Couldn't load the availability report.",
    });
}

/* SLA 006 — replacement overlap.
   Returns { activityName, replacementCount, replacements: [{
   outgoingLastWorkingDate, incomingJoiningDate, overlapStartDate,
   overlapEndDate, overlapWorkingDays, slaResult }] }. */
export function getReplacementOverlapReport(projectId, activityId, signal) {
    return report("/api/attendance/report/activity/replacement-overlap", {
        projectId, activityId, signal,
        fallback: "Couldn't load the replacement overlap report.",
    });
}

/* SLA 009 — replacement onboarding.
   Returns { activityName, replacementCount, replacements: [{
   notificationDate, mobilizationDate, onboardingDays, slaResult }] }. */
export function getReplacementOnboardingReport(projectId, activityId, signal) {
    return report("/api/attendance/report/activity/replacement-onboarding", {
        projectId, activityId, signal,
        fallback: "Couldn't load the replacement onboarding report.",
    });
}

/* All four at once. `Promise.all` is safe here precisely because
   `report` never rejects — one unreachable service cannot take the
   other three down with it. */
export function getResourceObservations(projectId, activityId, signal) {
    return Promise.all([
        getActivityReplacementsReport(projectId, activityId, signal),
        getReplacementOverlapReport(projectId, activityId, signal),
        getAvailabilityReport(projectId, activityId, signal),
        getReplacementOnboardingReport(projectId, activityId, signal),
    ]).then(([replacements, overlap, availability, onboarding]) => ({
        replacements, overlap, availability, onboarding,
    }));
}
