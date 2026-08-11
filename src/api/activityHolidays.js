/* Holidays for an activity's own window.
   GET /api/attendance/report/activity/holidays?projectId&activityId

   Both the attendance table and the per-employee detail need this, so it lives
   here rather than being written twice — two copies of the date parsing would
   be free to drift, and this payload uses dd-MM-yyyy where the rest of the
   page uses yyyy-MM-dd.

   Response:
     { activityId, activityName, activityStartDate, activityEndDate,
       totalHolidays, weekdayHolidayCount, weekendHolidayCount,
       holidays: [{ date: "26-01-2026", day: "Monday",
                    type: "HOLIDAY" | "WEEKEND_HOLIDAY", name: "Republic Day" }] }

   This replaces reading /api/holidays/{year} and filtering client-side: the
   server already knows the activity's window, and it separates holidays that
   fall on a working day from those that land on a week-off — a distinction the
   year-wide list couldn't make, and the reason a row's Holiday count could
   disagree with the length of its own tooltip. */
import { getToken } from "./auth";
import { readErrorMessage, readJsonBody } from "../utils/apiMessage";

// TODO: move to env / the shared api client, alongside the other :8019 calls.
const API_BASE = "http://10.1.131.199:8019";

/* dd-MM-yyyy → yyyy-MM-dd. Explicit, never `new Date`: V8 reads "04-03-2026"
   as 3 April, not 4 March — a plausible date a month out, with nothing to
   flag it. Returns "" for anything unparseable, which callers drop. */
export function holidayDateISO(raw) {
  const s = String(raw ?? "").trim();
  if (!s) return "";
  const p2 = (v) => String(v).padStart(2, "0");
  const dmy = /^(\d{1,2})-(\d{1,2})-(\d{4})$/.exec(s);
  if (dmy) return `${dmy[3]}-${p2(dmy[2])}-${p2(dmy[1])}`;
  const iso = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(s);
  if (iso) return `${iso[1]}-${p2(iso[2])}-${p2(iso[3])}`;
  return "";
}

/* The shape both pages consume. `weekend` marks a holiday that lands on a
   week-off — it is a real holiday, but it costs no working day, which is why
   the counts are kept apart rather than summed into one number. */
export function normalizeActivityHolidays(payload) {
  const raw = Array.isArray(payload?.holidays) ? payload.holidays : [];
  const list = raw
    .map((h) => ({
      iso: holidayDateISO(h?.date),
      name: String(h?.name || "").trim(),
      day: String(h?.day || "").trim(),
      weekend: String(h?.type || "").toUpperCase() === "WEEKEND_HOLIDAY",
    }))
    .filter((h) => h.iso)
    .sort((a, b) => a.iso.localeCompare(b.iso));

  const byDate = new Map(list.map((h) => [h.iso, h]));
  /* Prefer the server's counts; fall back to the list so the two can't
     silently disagree if a payload omits them. */
  const weekend = payload?.weekendHolidayCount != null
    ? Number(payload.weekendHolidayCount)
    : list.filter((h) => h.weekend).length;
  const weekday = payload?.weekdayHolidayCount != null
    ? Number(payload.weekdayHolidayCount)
    : list.filter((h) => !h.weekend).length;
  const total = payload?.totalHolidays != null ? Number(payload.totalHolidays) : list.length;

  return {
    list,
    byDate,
    total,
    weekday,
    weekend,
    activityName: payload?.activityName || "",
    start: holidayDateISO(payload?.activityStartDate),
    end: holidayDateISO(payload?.activityEndDate),
  };
}

export async function fetchActivityHolidays(projectId, activityId, { signal } = {}) {
  const qs = new URLSearchParams({ projectId, activityId });
  const token = getToken();
  const FALLBACK = "Couldn't load the activity's holidays.";
  const res = await fetch(
    `${API_BASE}/api/attendance/report/activity/holidays?${qs}`,
    {
      signal,
      cache: "no-store",
      headers: { accept: "*/*", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    }
  );
  /* An activity with no holiday calendar yet is a real answer, not a failure —
     the callers show no tooltip rather than an error banner. */
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(await readErrorMessage(res, FALLBACK));
  return normalizeActivityHolidays(await readJsonBody(res, FALLBACK));
}
