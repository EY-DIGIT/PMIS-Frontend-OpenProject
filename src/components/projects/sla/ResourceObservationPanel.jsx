/* ══════════════════════════════════════════════════════════════════
   Measured resource data — the numbers behind SLA 005 (replacement
   count), 006 (handover overlap), 007 (availability) and 009 (onboarding
   time), shown next to the evaluation form so they can be read off
   rather than hunted for on another page.

   This is a REFERENCE panel and nothing more. It scores nothing, writes
   nothing and prefills nothing: the evaluation form is schema-driven and
   its input names are the backend's to define, so filling those fields
   automatically would mean guessing at which measurement belongs in
   which field. Guessing wrong is worse than typing — a value written
   under the wrong name is either rejected, or silently accepted into a
   result that feeds LD.

   So until the backend accepts these directly, the honest version is:
   fetch the figures, show them with their dates and their working, and
   let the person filling the form decide what goes where. Each figure
   is click-to-copy, because the alternative is transcribing a number
   between two screens by eye.
   ══════════════════════════════════════════════════════════════════ */
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { getResourceObservations } from "../../../api/attendanceReports";

const muted = { color: "var(--uidai-pmis-muted)" };
const INK = "#173e77";
const RED = "#c0392b";
const GREEN = "#1f8a4c";
const AMBER = "#c77700";

const MONTHS = ["", "Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

const num = (v) => {
    const n = Number(v);
    return Number.isFinite(n) ? n : 0;
};

/* Dates arrive as ISO from one report and dd-MM-yyyy from another.
   Parsed by hand, never through `new Date` — that reads "04-03-2026" as
   4 March in some engines and 3 April in others, and a handover window
   off by a month is not a rounding error. */
function isoDate(raw) {
    const s = String(raw || "").trim();
    if (!s) return "";
    if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
    const dmy = /^(\d{1,2})-(\d{1,2})-(\d{4})$/.exec(s);
    if (dmy) return `${dmy[3]}-${String(dmy[2]).padStart(2, "0")}-${String(dmy[1]).padStart(2, "0")}`;
    return "";
}
function prettyDate(raw) {
    const iso = isoDate(raw);
    if (!iso) return "—";
    const mm = Number(iso.slice(5, 7));
    return MONTHS[mm] ? `${Number(iso.slice(8, 10))} ${MONTHS[mm]} ${iso.slice(0, 4)}` : iso;
}

/* A figure you can click to copy. The whole point of this panel is that
   a number gets carried to another form; making that a click instead of
   a squint-and-retype is most of the value. */
function Figure({ value, suffix, tone, title }) {
    const [copied, setCopied] = useState(false);
    const text = value === null || value === undefined || value === "" ? "" : String(value);

    const copy = useCallback(() => {
        if (!text) return;
        const done = () => { setCopied(true); window.setTimeout(() => setCopied(false), 1200); };
        if (navigator.clipboard?.writeText) {
            navigator.clipboard.writeText(text).then(done).catch(() => { });
            return;
        }
        /* No clipboard API (insecure origin, older browser). Selecting the
           text is the graceful degradation — the user still gets a
           one-gesture copy, just with Ctrl+C. */
        done();
    }, [text]);

    if (!text) return <span style={{ ...muted }}>—</span>;
    return (
        <button
            type="button"
            onClick={copy}
            title={title ? `${title} — click to copy` : "Click to copy"}
            style={{
                border: "1px solid transparent", background: copied ? "#e8f6ed" : "transparent",
                borderColor: copied ? "#bfe3cd" : "transparent",
                borderRadius: 6, padding: "1px 6px", cursor: "pointer", font: "inherit",
                fontVariantNumeric: "tabular-nums", fontWeight: 700,
                color: copied ? GREEN : (tone || INK),
            }}
        >
            {copied ? "copied" : text}{copied ? "" : (suffix || "")}
        </button>
    );
}

function SectionHead({ title, sla }) {
    return (
        <div style={{ display: "flex", alignItems: "baseline", gap: 8, flexWrap: "wrap", marginBottom: 6 }}>
            <div style={{ fontSize: 12.5, fontWeight: 800, color: INK }}>{title}</div>
            {sla && (
                <code style={{
                    background: "#f1f6fd", padding: "1px 7px", borderRadius: 5,
                    color: INK, fontWeight: 700, fontSize: 11,
                }}>
                    {sla}
                </code>
            )}
        </div>
    );
}

function Empty({ text }) {
    return <div style={{ fontSize: 12, ...muted, fontStyle: "italic", padding: "2px 0 4px" }}>{text}</div>;
}

function Err({ text }) {
    return <div style={{ fontSize: 12, color: RED, padding: "2px 0 4px" }}>{text}</div>;
}

const th = {
    textAlign: "left", fontSize: 10.5, fontWeight: 700, letterSpacing: ".3px",
    textTransform: "uppercase", color: "var(--uidai-pmis-muted)",
    padding: "0 10px 5px 0", whiteSpace: "nowrap",
};
const td = { fontSize: 12, padding: "3px 10px 3px 0", whiteSpace: "nowrap" };

/* ─── replacement count (SLA 005) ───────────────────────────────────
   How many times a seat changed hands, per designation. SLA 005 scores
   on the COUNT, and its target table reads "every increase of 1
   replacement" — a repeating severity, so three replacements is not one
   breach but three. That is why the per-designation split is shown and
   not just the headline total: the count that matters is the one
   against the designation whose seat kept turning over.

   `configuredQuantity` is included because a replacement count only
   means something against the number of seats — 2 replacements across
   1 seat and across 10 seats are very different facts. */
function ReplacementCountSection({ result }) {
    const rows = useMemo(
        () => (Array.isArray(result?.data?.designations) ? result.data.designations : []),
        [result]
    );
    const stated = result?.data?.totalReplacements;
    const summed = useMemo(
        () => rows.reduce((t, d) => t + num(d.replacementCount), 0),
        [rows]
    );
    /* The envelope's own total against the sum of the rows. They should
       agree; when they don't, one of the two is what somebody would
       otherwise type into an evaluation form. */
    const mismatch = stated != null && num(stated) !== summed;

    return (
        <div>
            <SectionHead title="Resource replacement" sla="SLA 005" />
            {result?.error ? <Err text={result.error} />
                : !rows.length ? <Empty text="No staffing reported against this activity yet." />
                    : (
                        <div style={{ overflowX: "auto" }}>
                            <table style={{ borderCollapse: "collapse" }}>
                                <thead>
                                    <tr>
                                        <th style={th}>Designation</th>
                                        <th style={th}>Seats configured</th>
                                        <th style={th}>People seen</th>
                                        <th style={th}>Replacements</th>
                                        <th style={th}>Currently on seat</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {rows.map((d, i) => {
                                        const people = Array.isArray(d.resources) ? d.resources : [];
                                        const active = people.filter((p) => p?.active);
                                        const count = num(d.replacementCount);
                                        return (
                                            <tr key={d.designation || i}>
                                                <td style={{ ...td, color: INK, fontWeight: 600 }}>{d.designation || "—"}</td>
                                                <td style={{ ...td, ...muted }}>{num(d.configuredQuantity) || "—"}</td>
                                                <td style={{ ...td, ...muted }}>{num(d.distinctResourceCount) || "—"}</td>
                                                <td style={td}>
                                                    <Figure value={count} title="Replacements" tone={count > 0 ? RED : GREEN} />
                                                </td>
                                                <td style={{ ...td, ...muted, whiteSpace: "normal", maxWidth: 260 }}>
                                                    {active.length
                                                        ? active.map((p) => p.employeeName).filter(Boolean).join(", ") || "—"
                                                        : <span style={{ color: AMBER, fontWeight: 600 }}>seat vacant</span>}
                                                </td>
                                            </tr>
                                        );
                                    })}
                                    {rows.length > 1 && (
                                        <tr style={{ borderTop: "1px solid var(--uidai-pmis-border)" }}>
                                            <td style={{ ...td, fontWeight: 800, color: INK }}>Total</td>
                                            <td style={td} />
                                            <td style={td} />
                                            <td style={td}>
                                                <Figure value={summed} title="Replacements, all designations"
                                                    tone={summed > 0 ? RED : GREEN} />
                                            </td>
                                            <td style={td} />
                                        </tr>
                                    )}
                                </tbody>
                            </table>
                            <div style={{ fontSize: 11, ...muted, marginTop: 5, lineHeight: 1.5 }}>
                                SLA 005&rsquo;s target table reads &ldquo;every increase of 1 replacement&rdquo; — a
                                repeating severity, so {summed === 1 ? "1 replacement is one hit" : `${summed} replacements are ${summed} hits`},
                                not a single one.
                                {mismatch && (
                                    <span style={{ color: AMBER, fontWeight: 600 }}>
                                        {" "}⚠ The report&rsquo;s own total says {String(stated)}, but the rows sum to {summed}.
                                    </span>
                                )}
                            </div>
                        </div>
                    )}
        </div>
    );
}

/* ─── availability (SLA 007) ────────────────────────────────────────
   The percentage is recomputed from the SUMMED days rather than
   averaged across months: a mean of monthly percentages weights a
   2-day month the same as a 31-day one. */
function AvailabilitySection({ result }) {
    const months = useMemo(
        () => (Array.isArray(result?.data?.months) ? result.data.months : []),
        [result]
    );
    const totals = useMemo(() => {
        if (!months.length) return null;
        const businessDays = months.reduce((t, m) => t + num(m.totalBusinessDays), 0);
        const presentDays = months.reduce((t, m) => t + num(m.totalPresentDays), 0);
        const workingHours = months.reduce((t, m) => t + num(m.totalWorkingHours), 0);
        return {
            businessDays, presentDays, workingHours,
            pct: businessDays > 0 ? (presentDays / businessDays) * 100 : null,
        };
    }, [months]);

    return (
        <div>
            <SectionHead title="Resource availability" sla="SLA 007" />
            {result?.error ? <Err text={result.error} />
                : !months.length ? <Empty text="No attendance recorded for this activity yet." />
                    : (
                        <div style={{ overflowX: "auto" }}>
                            <table style={{ borderCollapse: "collapse" }}>
                                <thead>
                                    <tr>
                                        <th style={th}>Month</th>
                                        <th style={th}>Business days</th>
                                        <th style={th}>Present days</th>
                                        <th style={th}>Working hours</th>
                                        <th style={th}>Resources</th>
                                        <th style={th}>Availability</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {months.map((m, i) => {
                                        const bd = num(m.totalBusinessDays);
                                        const pd = num(m.totalPresentDays);
                                        // No business days is not 0% — a month that hasn't
                                        // started has nothing to be present for.
                                        const p = bd > 0 ? (pd / bd) * 100 : null;
                                        return (
                                            <tr key={m.month || i}>
                                                <td style={{ ...td, color: INK, fontWeight: 600 }}>{m.month || "—"}</td>
                                                <td style={td}><Figure value={bd} title="Business days" /></td>
                                                <td style={td}><Figure value={pd} title="Present days" /></td>
                                                <td style={td}><Figure value={num(m.totalWorkingHours)} title="Working hours" /></td>
                                                <td style={{ ...td, ...muted }}>{num(m.resourceCount) || "—"}</td>
                                                <td style={td}>
                                                    {p === null ? <span style={muted}>—</span>
                                                        : <Figure value={Math.round(p * 100) / 100} suffix="%" title="Availability"
                                                            tone={p >= 99.5 ? GREEN : p >= 95 ? AMBER : RED} />}
                                                </td>
                                            </tr>
                                        );
                                    })}
                                    {totals && months.length > 1 && (
                                        <tr style={{ borderTop: "1px solid var(--uidai-pmis-border)" }}>
                                            <td style={{ ...td, fontWeight: 800, color: INK }}>Total</td>
                                            <td style={td}><Figure value={totals.businessDays} title="Business days, all months" /></td>
                                            <td style={td}><Figure value={totals.presentDays} title="Present days, all months" /></td>
                                            <td style={td}><Figure value={totals.workingHours} title="Working hours, all months" /></td>
                                            <td style={td} />
                                            <td style={td}>
                                                {totals.pct === null ? <span style={muted}>—</span>
                                                    : <Figure value={Math.round(totals.pct * 100) / 100} suffix="%"
                                                        title="Availability across all months"
                                                        tone={totals.pct >= 99.5 ? GREEN : totals.pct >= 95 ? AMBER : RED} />}
                                            </td>
                                        </tr>
                                    )}
                                </tbody>
                            </table>
                            {totals && months.length > 1 && (
                                <div style={{ fontSize: 11, ...muted, marginTop: 5, lineHeight: 1.5 }}>
                                    The total availability is recomputed from the summed days, not averaged across
                                    months — a short month would otherwise count as much as a full one.
                                </div>
                            )}
                        </div>
                    )}
        </div>
    );
}

/* ─── the two replacement reports (SLA 006 / 009) ────────────────────
   Same envelope, different measured figure, so one component renders
   both rather than two near-identical copies drifting apart. */
function ReplacementSection({ result, title, sla, fromLabel, fromKey, toLabel, toKey, metricLabel, metricKey, metricSuffix }) {
    const rows = useMemo(
        () => (Array.isArray(result?.data?.replacements) ? result.data.replacements : []),
        [result]
    );
    const stated = result?.data?.replacementCount;
    /* The envelope's own count against the rows actually returned — a
       truncated list would otherwise pass unnoticed, and this panel
       exists to be read off. */
    const mismatch = stated != null && num(stated) !== rows.length;

    return (
        <div>
            <SectionHead title={title} sla={sla} />
            {result?.error ? <Err text={result.error} />
                : !rows.length ? <Empty text="No replacements recorded — nothing for this SLA to measure." />
                    : (
                        <div style={{ overflowX: "auto" }}>
                            <table style={{ borderCollapse: "collapse" }}>
                                <thead>
                                    <tr>
                                        <th style={th}>Resource</th>
                                        <th style={th}>{fromLabel}</th>
                                        <th style={th}>{toLabel}</th>
                                        <th style={th}>{metricLabel}</th>
                                        <th style={th}>Result</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {rows.map((r, i) => {
                                        const verdict = String(r?.slaResult || "").toLowerCase();
                                        const tone = /pass|met|complian/.test(verdict) ? GREEN
                                            : /fail|breach/.test(verdict) ? RED : undefined;
                                        return (
                                            <tr key={i}>
                                                <td style={{ ...td, color: INK, fontWeight: 600 }}>
                                                    {r?.outgoingResourceName || r?.resourceName || r?.designation || `#${i + 1}`}
                                                </td>
                                                <td style={{ ...td, ...muted }}>{prettyDate(r?.[fromKey])}</td>
                                                <td style={{ ...td, ...muted }}>{prettyDate(r?.[toKey])}</td>
                                                <td style={td}>
                                                    <Figure value={r?.[metricKey]} suffix={metricSuffix} title={metricLabel} />
                                                </td>
                                                <td style={{ ...td, color: tone, fontWeight: tone ? 700 : 400 }}>
                                                    {r?.slaResult || "—"}
                                                </td>
                                            </tr>
                                        );
                                    })}
                                </tbody>
                            </table>
                            <div style={{ fontSize: 11, ...muted, marginTop: 5 }}>
                                {rows.length} replacement{rows.length === 1 ? "" : "s"}
                                {mismatch && (
                                    <span style={{ color: AMBER, fontWeight: 600 }}>
                                        {" "}⚠ the report states {String(stated)} — the list may be truncated.
                                    </span>
                                )}
                            </div>
                        </div>
                    )}
        </div>
    );
}

export default function ResourceObservationPanel({ projectId, activityId }) {
    // Collapsed by default: this is reference material consulted while
    // filling the form below, not something every visit needs to scroll past.
    const [open, setOpen] = useState(false);
    const [tick, setTick] = useState(0);
    /* Nothing is fetched until the panel is opened for the first time —
       four requests per activity is a real cost to pay for a section
       most visits never expand. Latched rather than tied to `open`, so
       collapsing it again doesn't throw away what was already loaded and
       re-fetch on the next expand. */
    const [everOpened, setEverOpened] = useState(false);

    const toggle = useCallback(() => {
        setOpen((v) => !v);
        // Only ever set true; closing implies it was already open.
        setEverOpened(true);
    }, []);

    const reload = useCallback(() => {
        setTick((t) => t + 1);
        // Reload while collapsed would otherwise fetch nothing.
        setEverOpened(true);
        setOpen(true);
    }, []);

    /* Results are stamped with the request that produced them, and
       "loading" is DERIVED from that stamp not matching the current
       request. That keeps the effect free of synchronous setState, and
       it also means one activity's figures can never be shown under
       another's while a switch is in flight — the stale stamp reads as
       loading rather than as data. */
    const cacheKey = everOpened && projectId && activityId
        ? `${projectId}::${activityId}::${tick}`
        : "";
    const [result, setResult] = useState({ key: "", data: null });
    const loading = !!cacheKey && result.key !== cacheKey;
    const obs = result.key === cacheKey ? result.data : null;

    useEffect(() => {
        if (!cacheKey) return undefined;
        const controller = new AbortController();
        let active = true;
        getResourceObservations(projectId, activityId, controller.signal)
            .then((r) => { if (active) setResult({ key: cacheKey, data: r }); });
        return () => { active = false; controller.abort(); };
    }, [cacheKey, projectId, activityId]);

    if (!projectId || !activityId) return null;

    return (
        <div className="uidai-pmis-filter-shell" style={{ marginTop: 12 }}>
            <div className="uidai-pmis-filter-head" style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                <button
                    type="button"
                    onClick={toggle}
                    aria-expanded={open}
                    style={{
                        display: "inline-flex", alignItems: "center", gap: 7, border: "none",
                        background: "transparent", padding: 0, cursor: "pointer", font: "inherit",
                        color: INK, fontSize: 13, fontWeight: 800,
                    }}
                >
                    <span style={{ fontSize: 10, transform: open ? "rotate(90deg)" : "none", transition: "transform .15s" }}>▶</span>
                    Measured resource data
                </button>
                <span style={{ fontSize: 11.5, ...muted }}>
                    from attendance · read these into the form below
                </span>
                <button
                    type="button"
                    className="uidai-pmis-btn uidai-pmis-btn-cancel uidai-pmis-btn-small"
                    style={{ marginTop: 0, marginLeft: "auto" }}
                    onClick={reload}
                    disabled={loading}
                >
                    {loading ? "Loading…" : "↻ Reload"}
                </button>
            </div>

            {open && (
                <div style={{ marginTop: 12, display: "flex", flexDirection: "column", gap: 16 }}>
                    {loading && !obs ? (
                        <div style={{ fontSize: 12.5, ...muted, padding: "6px 0" }}>Loading measured data…</div>
                    ) : (
                        <>
                            {/* Ordered by SLA number — 005, 006, 007, 009 — so
                                the panel reads in the same order as the SLA
                                library and the rollup do. */}
                            <ReplacementCountSection result={obs?.replacements} />
                            <ReplacementSection
                                result={obs?.overlap}
                                title="Replacement overlap"
                                sla="SLA 006"
                                fromLabel="Last working day" fromKey="outgoingLastWorkingDate"
                                toLabel="Joining date" toKey="incomingJoiningDate"
                                metricLabel="Overlap working days" metricKey="overlapWorkingDays"
                            />
                            <AvailabilitySection result={obs?.availability} />
                            <ReplacementSection
                                result={obs?.onboarding}
                                title="Replacement onboarding"
                                sla="SLA 009"
                                fromLabel="Notified" fromKey="notificationDate"
                                toLabel="Mobilised" toKey="mobilizationDate"
                                metricLabel="Onboarding days" metricKey="onboardingDays"
                            />
                        </>
                    )}
                </div>
            )}
        </div>
    );
}
