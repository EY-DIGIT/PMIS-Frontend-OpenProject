/* ══════════════════════════════════════════════════════════════════
   Local observation drafts — a stopgap, not a store.

   Resource SLAs (005–009) and the count-driven ones (004, 011) are not
   date-derivable: the backend cannot score them without a human stating
   what was observed. Today that reading has nowhere to go —
   `POST /activities/{id}/sla-evaluate` computes a severity and returns
   it, but nothing in the app calls
   `POST /sla-compliance/observations`, so the compliance store keeps
   reporting `pending_observation` and the quarter reads as unmeasured.

   This module parks those readings in localStorage so a quarter can be
   worked through end to end while that gap is open.

   ── What is deliberately NOT done here ────────────────────────────
   Only the RAW OBSERVED VALUE is stored — never the severity, points
   or LD % derived from it. Those are recomputed at render time from
   the project's current severity master, LD bands and the SLA's target
   table. Freezing a derived figure would mean a project that fixes its
   severity master still sees yesterday's points, and the number would
   quietly outlive the configuration that produced it.

   ── Why this is safe to show, and where it stops ──────────────────
   Every figure derived from a draft is flagged `isLocalDraft` all the
   way to the screen, and the settlement chain still reads the
   backend's settled row — so drafts can move what the ROLLUP shows,
   and can never move what gets invoiced. The moment the backend starts
   persisting observations, `hasDrafts` goes false and this module stops
   contributing anything.

   Browser-local and per-user: another reviewer opening the same
   quarter sees the server's view, which is the honest default.
   ══════════════════════════════════════════════════════════════════ */

const KEY = "pmis.sla.localObservations.v1";

/* localStorage throws in private-mode Safari and when a quota is hit, and
   a rollup page must not white-screen because a draft could not be
   parked. Every access is guarded and degrades to "no drafts". */
function readAll() {
    try {
        const raw = window.localStorage.getItem(KEY);
        if (!raw) return {};
        const parsed = JSON.parse(raw);
        return parsed && typeof parsed === "object" ? parsed : {};
    } catch {
        return {};
    }
}

function writeAll(data) {
    try {
        window.localStorage.setItem(KEY, JSON.stringify(data));
        return true;
    } catch {
        return false;
    }
}

/* One obligation = one SLA, on one activity, in one reporting period.
   The period is part of the key because the same SLA on the same
   activity is measured again every quarter, and last quarter's reading
   must not leak into this one. */
export function observationKey({ activityId, slaRef, periodKey }) {
    return `${activityId ?? "—"}::${slaRef ?? "—"}::${periodKey ?? "—"}`;
}

export function listDrafts(projectId) {
    if (!projectId) return {};
    return readAll()[String(projectId)] || {};
}

export function getDraft(projectId, key) {
    return listDrafts(projectId)[key] || null;
}

export function countDrafts(projectId, periodKey) {
    const all = listDrafts(projectId);
    const rows = Object.values(all);
    return periodKey ? rows.filter((r) => r.periodKey === periodKey).length : rows.length;
}

export function saveDraft(projectId, record) {
    if (!projectId || !record?.slaRef) return false;
    const key = observationKey(record);
    const all = readAll();
    const forProject = { ...(all[String(projectId)] || {}) };
    forProject[key] = {
        ...record,
        key,
        // Stamped so a stale draft can be recognised as stale rather than
        // trusted indefinitely.
        savedAt: new Date().toISOString(),
    };
    all[String(projectId)] = forProject;
    return writeAll(all);
}

export function removeDraft(projectId, key) {
    const all = readAll();
    const forProject = { ...(all[String(projectId)] || {}) };
    if (!(key in forProject)) return false;
    delete forProject[key];
    all[String(projectId)] = forProject;
    return writeAll(all);
}

/* Clearing is scoped to one period by default. "Clear everything for this
   project" exists too, but wiping other quarters' readings as a side
   effect of tidying this one would be its own small disaster. */
export function clearDrafts(projectId, periodKey = null) {
    const all = readAll();
    if (!periodKey) {
        delete all[String(projectId)];
        return writeAll(all);
    }
    const forProject = { ...(all[String(projectId)] || {}) };
    for (const [k, v] of Object.entries(forProject)) {
        if (v?.periodKey === periodKey) delete forProject[k];
    }
    all[String(projectId)] = forProject;
    return writeAll(all);
}

/* ─── applying drafts to results ──────────────────────────────────
   Fills the gap in a `pending_observation` row with the drafted value
   and lets the normal scoring path take over from there.

   `deriveSeverity(value, slaRef)` is injected rather than imported so
   this module stays free of the scoring engine — the caller already
   holds the SLA masters and knows how to read a target table.

   A draft NEVER overwrites a row the backend actually scored. If the
   observation lands server-side later, the real result wins on the next
   load without anyone clearing anything.                             */
export function applyDrafts(results, { drafts, deriveSeverity, isPending } = {}) {
    const list = Array.isArray(results) ? results : [];
    if (!drafts || !Object.keys(drafts).length) return { results: list, appliedCount: 0 };

    let appliedCount = 0;
    const out = list.map((r) => {
        if (!isPending(r)) return r;

        const key = observationKey({
            activityId: r.activityId,
            slaRef: r.slaRef,
            periodKey: r.__periodKey,
        });
        const draft = drafts[key];
        if (!draft || draft.value === "" || draft.value === null || draft.value === undefined) return r;

        const derived = deriveSeverity(draft.value, r);
        if (derived?.severity === null || derived?.severity === undefined) {
            // The value could not be read against the SLA's target table.
            // Surfaced on the row rather than silently ignored.
            return { ...r, isLocalDraft: true, draftValue: draft.value, draftError: derived?.reason || "no matching band" };
        }

        appliedCount += 1;
        return {
            ...r,
            severityLevel: derived.severity,
            /* Severity 0 is the RFP's "target met" row — it scores −2 points
               and is not a breach. Anything above it is. */
            status: derived.severity > 0 ? "breached" : "met",
            isLocalDraft: true,
            draftValue: draft.value,
            draftSavedAt: draft.savedAt,
            draftKey: key,
        };
    });

    return { results: out, appliedCount };
}
