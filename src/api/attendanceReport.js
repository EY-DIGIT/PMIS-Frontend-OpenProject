// ---------------------------------------------------------------------------
// Attendance reporting service — the staffing side of the SLA picture.
//
// The contracts service (slaCompliance.js) knows what an SLA scored. It does
// not know WHO was on the seat when it scored, and RFP §5.28.3's Note on
// SLA 007 turns on exactly that: a resource whose replacement UIDAI initiated
// is outside the calculation until the replacement joins, and a seat standing
// empty for part of a month is one head fewer for those days.
//
// This module is the read side of that. No React, no state — ids in, plain
// data out, one Error carrying the backend's message on failure.
//
// Base URL: override with VITE_ATTENDANCE_BASE_URL when the service moves.
// ---------------------------------------------------------------------------
import { getToken } from "./auth";

export const ATTENDANCE_BASE =
    (import.meta.env?.VITE_ATTENDANCE_BASE_URL || "http://10.1.131.199:8019").replace(/\/+$/, "");

async function readBody(res, fallback) {
    const payload = await res.json().catch(() => null);
    if (!res.ok) {
        throw new Error(
            payload?.error?.message ||
            payload?.error ||
            payload?.message ||
            (typeof payload?.detail === "string" ? payload.detail : "") ||
            payload?.detail?.[0]?.msg ||
            fallback ||
            `Request failed (${res.status})`
        );
    }
    return payload;
}

/* Who held each designation on one activity, and where one person handed over
   to another.

       {
         activityName, activityStartDate, activityEndDate,
         totalReplacements,
         designations: [{
           designation, configuredQuantity,
           distinctResourceCount, replacementCount,
           resources: [{ resourceId, employeeName, joiningDate,
                         lastWorkingDate, active }]
         }]
       }

   A 404 means "no staffing reported against this activity yet", which is a
   normal state for an activity that has not started — returned as `null`
   rather than thrown, so a caller fanning out over a whole quarter is not
   forced to treat the ordinary case as a failure. */
export async function getActivityReplacements(projectId, activityId, { signal } = {}) {
    if (!projectId || !activityId) return null;
    const token = getToken();
    const qs = new URLSearchParams({ projectId: String(projectId), activityId: String(activityId) });
    const res = await fetch(`${ATTENDANCE_BASE}/api/attendance/report/activity/replacements?${qs}`, {
        signal,
        cache: "no-store",
        headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
    if (res.status === 404) return null;
    const data = await readBody(res, "Couldn't load the replacement history.");
    return data && typeof data === "object" ? data : null;
}

/* Several activities at once, capped so a quarter with fifty resource
   activities does not open fifty sockets. One activity failing is recorded
   against that activity and never fails the batch — a partial staffing
   picture that says which parts are missing beats no picture at all. */
export async function fetchReplacementsForActivities(projectId, activities, {
    concurrency = 6,
    signal,
    onProgress,
} = {}) {
    const list = (Array.isArray(activities) ? activities : []).filter((a) => a?.activityId);
    const reports = new Map();
    const failures = [];
    let cursor = 0;
    let done = 0;

    async function worker() {
        for (;;) {
            const i = cursor++;
            if (i >= list.length) return;
            const act = list[i];
            try {
                const data = await getActivityReplacements(projectId, act.activityId, { signal });
                if (data) reports.set(String(act.activityId), data);
            } catch (err) {
                if (err?.name === "AbortError") return;
                failures.push(`${act.code || act.activityId}: ${err?.message || "failed"}`);
            } finally {
                done += 1;
                onProgress?.(done, list.length);
            }
        }
    }

    await Promise.all(
        Array.from({ length: Math.min(concurrency, list.length || 1) }, worker)
    );

    return { reports, failures, requested: list.length };
}
