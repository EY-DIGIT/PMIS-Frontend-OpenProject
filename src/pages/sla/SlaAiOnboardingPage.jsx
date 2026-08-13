/* ══════════════════════════════════════════════════════════════════
   SlaAiOnboardingPage.jsx — Onboard SLAs from a document (route
   /sla-masters/onboard-ai).

   Runs PARALLEL to the manual builder on /sla-masters/onboard and shares
   no code with it — nothing here can change how the manual flow behaves.

   Three phases on one route:
     intake  — pick the project, upload the SLA PDF, POST the n8n webhook
     list    — every SLA the parser found, with per-SLA review status
     review  — one SLA at a time in ai/SlaAiReviewForm, then create it

   Each SLA is reviewed by a human before it is created; there is no bulk
   path on purpose. The source PDF stays in memory for the whole session
   because every created SLA carries it as evidence.

   POST {VITE_SLA_AI_WEBHOOK_URL}   multipart: projectId + sessionId + file
   ══════════════════════════════════════════════════════════════════ */

import React, { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { authorizedFetch, tokenStore } from "../../api/client";
import { listAll as listAllProjects } from "../../api/projects";
import { normalizeAiBatch } from "./ai/aiSlaNormalize";
import SlaAiReviewForm from "./ai/SlaAiReviewForm";

const WEBHOOK_URL =
    import.meta.env.VITE_SLA_AI_WEBHOOK_URL || "http://10.1.131.199:5678/webhook/sla";
const CONTRACTS_BASE = "http://10.1.131.199/contracts";

// Parsing a full RFP is an LLM round-trip, not a CRUD call — give it room
// rather than letting the browser's default timeout kill a good run.
const PARSE_TIMEOUT_MS = 10 * 60 * 1000;
const MAX_FILE_MB = 25;

const labelStyle = {
    fontSize: 12, fontWeight: 700, color: "#41506a",
    textTransform: "uppercase", letterSpacing: ".3px", marginBottom: 6,
};
const helpStyle = { fontSize: 11, color: "#6b7a90", marginTop: 6, lineHeight: 1.5 };

function fmtSize(bytes) {
    if (!bytes) return "";
    const mb = bytes / (1024 * 1024);
    return mb >= 1 ? `${mb.toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

const STATUS_STYLE = {
    pending: { bg: "#f1f5f9", fg: "#475569", label: "Not reviewed" },
    done: { bg: "#dcfce7", fg: "#166534", label: "✓ Onboarded" },
    // Skipped is deliberately not a failure state — the SLA is set aside to be
    // picked up again once whatever blocked it is resolved.
    skipped: { bg: "#fef3c7", fg: "#92400e", label: "↷ Skipped" },
};

const FLASH_STYLE = {
    success: { bg: "#dcfce7", border: "#86efac", fg: "#166534", icon: "✓" },
    skip: { bg: "#fef3c7", border: "#fcd34d", fg: "#92400e", icon: "↷" },
    info: { bg: "#eff6ff", border: "#93c5fd", fg: "#1e40af", icon: "✎" },
    error: { bg: "#fef2f2", border: "#fca5a5", fg: "#991b1b", icon: "⚠" },
};

// The prefix is the segment before the first "-" in "MSIP-SLA003-20260813074507".
// The API enforces ^[A-Z0-9_-]+$ on the whole ref; "-" is excluded here because
// it's the separator this rewrite keys off.
// Shown on the intake screen so the whole flow is visible before starting —
// people were being asked to upload a document without knowing what follows.
const STEPS = [
    { n: 1, title: "Select project", detail: "The contract these SLAs belong to" },
    { n: 2, title: "Upload SLA PDF", detail: "One document, read in place" },
    { n: 3, title: "Review each SLA", detail: "Correct anything the AI got wrong" },
    { n: 4, title: "Onboard", detail: "Added to the library one at a time" },
];

const PREFIX_RE = /^[A-Z0-9_]+$/;
const refPrefix = (ref) => {
    const i = String(ref || "").indexOf("-");
    return i > 0 ? String(ref).slice(0, i) : "";
};

export default function SlaAiOnboardingPage() {
    const navigate = useNavigate();
    const fileInputRef = useRef(null);

    /* intake */
    const [projects, setProjects] = useState([]);
    const [projectsError, setProjectsError] = useState("");
    const [projectKey, setProjectKey] = useState("");
    const [file, setFile] = useState(null);
    const [fileError, setFileError] = useState("");
    const [busy, setBusy] = useState(false);
    const [elapsed, setElapsed] = useState(0);
    const [error, setError] = useState("");

    /* review */
    const [items, setItems] = useState(null);       // [{ record, warnings, status, createdId }]
    const [phase, setPhase] = useState("intake");   // intake | list | review
    const [cursor, setCursor] = useState(0);
    const [catalogs, setCatalogs] = useState(null);
    const [catalogsLoading, setCatalogsLoading] = useState(false);
    // Confirmation after each action. Lives here rather than in the review
    // form: the form unmounts the instant the next SLA loads, taking its toast
    // with it. { text, kind: "success" | "skip" } or null.
    const [flash, setFlash] = useState(null);
    // Bulk prefix rewrite — the parser often reads the contract type wrong for
    // the whole document, and retyping it on every form is not reasonable.
    const [prefixInput, setPrefixInput] = useState("");

    const selectedProject = useMemo(
        () => projects.find((p) => p.projectId === projectKey) || null,
        [projects, projectKey]
    );

    /* ─── project list ─── */
    useEffect(() => {
        let alive = true;
        (async () => {
            try {
                const rows = await listAllProjects();
                if (!alive) return;
                const list = (Array.isArray(rows) ? rows : []).filter((p) => p && p.projectId);
                setProjects(list);
                if (!list.length) setProjectsError("No projects returned.");
            } catch (e) {
                if (alive) setProjectsError(e.message || "Could not load projects.");
            }
        })();
        return () => { alive = false; };
    }, []);

    /* ─── elapsed-time ticker while the webhook runs ─── */
    useEffect(() => {
        if (!busy) return undefined;
        const started = performance.now();
        setElapsed(0);
        const t = window.setInterval(() => setElapsed(Math.floor((performance.now() - started) / 1000)), 1000);
        return () => window.clearInterval(t);
    }, [busy]);

    /* ─── the success banner clears itself ─── */
    useEffect(() => {
        if (!flash) return undefined;
        const t = window.setTimeout(() => setFlash(null), 6000);
        return () => window.clearTimeout(t);
    }, [flash]);

    /* ─── leaving mid-review loses the parse (the PDF can't be persisted) ─── */
    useEffect(() => {
        if (phase === "intake") return undefined;
        const warn = (e) => { e.preventDefault(); e.returnValue = ""; };
        window.addEventListener("beforeunload", warn);
        return () => window.removeEventListener("beforeunload", warn);
    }, [phase]);

    function onPickFile(e) {
        const f = (e.target.files && e.target.files[0]) || null;
        setFileError("");
        if (!f) { setFile(null); return; }
        const isPdf = f.type === "application/pdf" || /\.pdf$/i.test(f.name);
        if (!isPdf) {
            setFile(null);
            setFileError("That isn't a PDF. Upload the SLA document as a PDF.");
            e.target.value = "";
            return;
        }
        if (f.size > MAX_FILE_MB * 1024 * 1024) {
            setFile(null);
            setFileError(`That file is ${fmtSize(f.size)} — the limit is ${MAX_FILE_MB} MB.`);
            e.target.value = "";
            return;
        }
        setFile(f);
    }

    function clearFile() {
        setFile(null);
        setFileError("");
        if (fileInputRef.current) fileInputRef.current.value = "";
    }

    /* ─── catalogs, fetched once and shared by every review form ───
       Without this each of N forms would re-fetch three endpoints. The
       form carries its own fallbacks, so a failure here is not fatal. */
    async function loadCatalogs() {
        setCatalogsLoading(true);
        const grab = async (path) => {
            try {
                const r = await authorizedFetch(CONTRACTS_BASE + path, { method: "GET", headers: { Accept: "application/json" } });
                if (!r.ok) return [];
                const body = await r.json();
                return (body?.data?._embedded?.elements || []).map((el) => el.data || el);
            } catch { return []; }
        };
        const [rfpFields, categories, inputVariables] = await Promise.all([
            grab("/api/v3/sla-rfp-fields"),
            grab("/api/v3/sla-categories"),
            grab("/api/v3/sla-input-variables"),
        ]);
        setCatalogs({
            rfpFields,
            categories,
            inputVariables,
            // The review form's project picker reads {id, name, projectCode}.
            projects: projects.map((p) => ({ id: p.projectId, name: p.projectName, projectCode: p.projectCode })),
        });
        setCatalogsLoading(false);
    }

    /* ─── submit to the parsing webhook ─── */
    async function parseDocument() {
        setError("");
        setItems(null);
        if (!selectedProject) { setError("Pick the project this SLA document belongs to."); return; }
        if (!file) { setError("Upload the SLA document (PDF)."); return; }

        // The webhook identifies the project by its code (e.g. UIDAI-PR2606…),
        // not the internal uuid — fall back to the uuid if a project has no code.
        const fd = new FormData();
        fd.append("projectId", selectedProject.projectCode || selectedProject.projectId);
        fd.append("sessionId", tokenStore.get() || "");
        fd.append("file", file, file.name);

        const controller = new AbortController();
        const killer = window.setTimeout(() => controller.abort(), PARSE_TIMEOUT_MS);
        setBusy(true);
        try {
            // Deliberately plain `fetch`, not authorizedFetch: the token travels
            // in the form body as `sessionId`, and adding an Authorization header
            // would turn this into a CORS-preflighted request for no benefit.
            const res = await fetch(WEBHOOK_URL, { method: "POST", body: fd, signal: controller.signal });
            const text = await res.text();
            if (!res.ok) {
                setError(`The parser returned HTTP ${res.status}. ${text.slice(0, 300)}`);
                return;
            }
            if (!text.trim()) {
                setError(
                    `The parser returned an empty body (HTTP ${res.status}). ` +
                    "The workflow ran but sent nothing back — check the Respond node in n8n, " +
                    "and that you're calling the production webhook rather than a test listener."
                );
                return;
            }
            let body = null;
            try { body = JSON.parse(text); } catch {
                setError("The parser replied with something that isn't JSON: " + text.slice(0, 200));
                return;
            }
            const slas = Array.isArray(body?.slas) ? body.slas
                : Array.isArray(body) ? body
                    : Array.isArray(body?.data?.slas) ? body.data.slas : null;
            if (!slas) {
                setError("The parser replied without an `slas` list. Raw response logged to the console.");
                // eslint-disable-next-line no-console
                console.warn("[sla-ai] unexpected webhook shape:", body);
                return;
            }
            if (!slas.length) {
                setError("The parser found no SLAs in that document.");
                return;
            }
            const normalized = normalizeAiBatch(slas, { projectId: selectedProject.projectId });
            setItems(normalized.map((n) => ({ ...n, status: "pending", createdId: null })));
            setPhase("list");
            loadCatalogs();
        } catch (e) {
            if (e.name === "AbortError") {
                setError(`Gave up after ${Math.round(PARSE_TIMEOUT_MS / 60000)} minutes with no reply from the parser.`);
            } else {
                setError(
                    `Couldn't reach the parsing service at ${WEBHOOK_URL}. ` +
                    "Either it's down, or it isn't allowing requests from this app's origin (CORS). " +
                    `(${e.message})`
                );
            }
        } finally {
            window.clearTimeout(killer);
            setBusy(false);
        }
    }

    /* ─── wizard navigation ─── */
    const doneCount = items ? items.filter((i) => i.status === "done").length : 0;

    function openReview(idx) { setCursor(idx); setPhase("review"); }

    /* Move to the next SLA that hasn't been dealt with yet. Skipped ones are
       stepped over here — you'd otherwise land straight back on the record you
       just set aside — and are picked up again from the list at the end. */
    function advancePast(idx) {
        const nextIdx = items.findIndex((it, i) => i > idx && it.status === "pending");
        if (nextIdx >= 0) setCursor(nextIdx);
        else setPhase("list");
    }

    function handleOnboarded(createdId, submitted) {
        const edited = submitted && typeof submitted === "object" ? submitted : {};
        const ref = edited.sla_ref || (items[cursor] && items[cursor].record.sla_ref) || "The SLA";
        setFlash({ text: `${ref} has been onboarded successfully.`, kind: "success" });
        setItems((prev) => {
            const next = prev.slice();
            next[cursor] = {
                ...next[cursor],
                status: "done",
                createdId,
                /* Store what was actually sent, not what the parser produced.
                   Otherwise reopening this SLA shows the AI's original values
                   and every correction looks like it was thrown away. */
                record: { ...next[cursor].record, ...edited },
            };
            return next;
        });
        advancePast(cursor);
    }

    function handleSkip() {
        const ref = (items[cursor] && items[cursor].record.sla_ref) || "The SLA";
        setFlash({ text: `${ref} was skipped — it's still in the list to come back to.`, kind: "skip" });
        setItems((prev) => {
            const next = prev.slice();
            // Never overwrite an SLA that was already created.
            if (next[cursor].status !== "done") next[cursor] = { ...next[cursor], status: "skipped" };
            return next;
        });
        advancePast(cursor);
    }

    // Green confirmation shown after each successful create. Rendered above
    // both the review form and the list so it survives the switch between them.
    const flashStyle = flash ? (FLASH_STYLE[flash.kind] || FLASH_STYLE.success) : null;
    const flashBanner = flash ? (
        <div
            role="status"
            style={{
                display: "flex", alignItems: "center", gap: 10,
                margin: "0 0 14px", padding: "12px 16px", borderRadius: 8,
                background: flashStyle.bg, border: `1px solid ${flashStyle.border}`, color: flashStyle.fg,
                fontSize: 13, fontWeight: 700,
            }}
        >
            <span style={{ fontSize: 16 }}>{flashStyle.icon}</span>
            <span style={{ flex: 1 }}>{flash.text}</span>
            <button
                type="button"
                onClick={() => setFlash(null)}
                aria-label="Dismiss"
                style={{ border: "none", background: "none", color: flashStyle.fg, cursor: "pointer", fontSize: 15, fontWeight: 700, padding: 0, lineHeight: 1 }}
            >
                ✕
            </button>
        </div>
    ) : null;

    /* Rewrite the prefix on every SLA that hasn't been created yet. Onboarded
       ones are left alone — their number is fixed in the library, and changing
       it here would only make the list lie about what exists. */
    function applyPrefix() {
        const next = prefixInput.trim().toUpperCase();
        if (!next) return;
        if (!PREFIX_RE.test(next)) {
            setFlash({ text: `"${next}" isn't a usable prefix — capital letters, digits and _ only.`, kind: "error" });
            return;
        }
        const changed = items.filter(
            (it) => it.status !== "done" && refPrefix(it.record.sla_ref) && refPrefix(it.record.sla_ref) !== next
        ).length;
        if (!changed) {
            setFlash({ text: `Every SLA still to onboard already starts with ${next}.`, kind: "info" });
            return;
        }
        setItems((prev) => prev.map((it) => {
            if (it.status === "done") return it;
            const ref = it.record.sla_ref || "";
            const i = ref.indexOf("-");
            if (i <= 0) return it;
            return { ...it, record: { ...it.record, sla_ref: next + ref.slice(i) } };
        }));
        setFlash({ text: `SLA number prefix changed to ${next} on ${changed} SLA${changed === 1 ? "" : "s"}.`, kind: "info" });
    }

    function startOver() {
        setItems(null);
        setPhase("intake");
        setCursor(0);
        setError("");
    }

    /* ═══════════ review phase ═══════════ */
    if (phase === "review" && items && items[cursor]) {
        const it = items[cursor];
        if (catalogsLoading || !catalogs) {
            return <div className="uidai-pmis-card" style={{ padding: 32, textAlign: "center", color: "#6b7a90" }}>Loading catalogs…</div>;
        }
        return (
            <>
                {flashBanner}
                <SlaAiReviewForm
                    key={cursor}
                    record={it.record}
                    warnings={it.warnings}
                    catalogs={catalogs}
                    position={{ index: cursor + 1, total: items.length }}
                    progress={items.map((i) => i.status)}
                    onJump={(i) => setCursor(i)}
                    pdfFile={file}
                    onOnboarded={handleOnboarded}
                    onSkip={handleSkip}
                    onPrev={() => setCursor((c) => Math.max(0, c - 1))}
                    onExit={() => setPhase("list")}
                />
            </>
        );
    }

    /* ═══════════ list phase ═══════════ */
    if (phase === "list" && items) {
        const skippedCount = items.filter((i) => i.status === "skipped").length;
        const pendingCount = items.filter((i) => i.status === "pending").length;
        // Work through the untouched ones first; once they're gone, the button
        // brings you back to whatever was skipped.
        const firstPending = pendingCount
            ? items.findIndex((i) => i.status === "pending")
            : items.findIndex((i) => i.status === "skipped");
        const nothingLeft = firstPending < 0;
        // Distinct prefixes across the SLAs that can still be renamed.
        const editablePrefixes = Array.from(new Set(
            items.filter((i) => i.status !== "done").map((i) => refPrefix(i.record.sla_ref)).filter(Boolean)
        ));
        return (
            <>
                {flashBanner}
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: 12 }}>
                    <div>
                        <div className="uidai-pmis-title" style={{ marginBottom: 2 }}>
                            {items.length} SLA{items.length === 1 ? "" : "s"} read from {file ? file.name : "the document"}
                        </div>
                        <div className="uidai-pmis-subtitle" style={{ marginTop: 0 }}>
                            {doneCount} of {items.length} onboarded
                            {skippedCount ? `, ${skippedCount} skipped` : ""}
                            {pendingCount ? `, ${pendingCount} still to review` : ""}.
                            {nothingLeft && skippedCount
                                ? " Nothing left to review — the skipped ones were never created."
                                : " Each SLA is reviewed before it is created."}
                        </div>
                    </div>
                    <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                        <button type="button" className="uidai-pmis-btn uidai-pmis-btn-cancel uidai-pmis-btn-small" style={{ marginTop: 0 }} onClick={startOver}>
                            ↩ Upload a different document
                        </button>
                        {!nothingLeft && (
                            <button type="button" className="uidai-pmis-btn uidai-pmis-btn-small" style={{ marginTop: 0 }} onClick={() => openReview(firstPending)}>
                                {!doneCount && !skippedCount
                                    ? "Start review →"
                                    : pendingCount ? "Continue review →" : "Revisit skipped →"}
                            </button>
                        )}
                        {nothingLeft && (
                            <button type="button" className="uidai-pmis-btn uidai-pmis-btn-small" style={{ marginTop: 0 }} onClick={() => navigate("/sla-masters")}>
                                Back to SLA Masters
                            </button>
                        )}
                    </div>
                </div>

                <div className="uidai-pmis-card" style={{ marginTop: 16 }}>
                    {/* Bulk prefix rewrite */}
                    <div style={{ display: "flex", alignItems: "flex-end", gap: 10, flexWrap: "wrap", marginBottom: 16, padding: "12px 14px", background: "#f7fafd", border: "1px solid #dbe5f1", borderRadius: 8 }}>
                        <div style={{ flexBasis: "100%", fontSize: 13, fontWeight: 800, color: "#173e77" }}>
                            Did the AI read the contract type correctly?
                        </div>
                        <div style={{ flexBasis: "100%", fontSize: 12, color: "#41506a", lineHeight: 1.6, marginTop: -4, marginBottom: 4 }}>
                            {editablePrefixes.length
                                ? <>
                                    It numbered {editablePrefixes.length === 1 ? "every SLA" : "these SLAs"} as{" "}
                                    <code style={{ fontWeight: 700 }}>{editablePrefixes.join(", ")}</code>.
                                    {" "}If that's the wrong contract, enter the right prefix below and apply it to all of them.
                                </>
                                : "Every SLA has been onboarded — nothing left to rename."}
                        </div>
                        <input
                            className="uidai-pmis-filter-input"
                            style={{ width: 150, textTransform: "uppercase" }}
                            value={prefixInput}
                            onChange={(e) => setPrefixInput(e.target.value)}
                            onKeyDown={(e) => { if (e.key === "Enter") applyPrefix(); }}
                            placeholder="PMC"
                            disabled={!editablePrefixes.length}
                            aria-label="New SLA number prefix"
                        />
                        <button
                            type="button"
                            className="uidai-pmis-btn uidai-pmis-btn-small"
                            style={{ marginTop: 0 }}
                            onClick={applyPrefix}
                            disabled={!prefixInput.trim() || !editablePrefixes.length}
                        >
                            Apply to all
                        </button>
                        <div style={{ ...helpStyle, flexBasis: "100%", marginTop: 2 }}>
                            Replaces the first part of every SLA number not yet onboarded — <code>MSIP-SLA003-2026…</code> becomes <code>PMC-SLA003-2026…</code>.
                            The number and timestamp are untouched, and re-applying the old prefix puts it back.
                        </div>
                    </div>

                    <div className="uidai-pmis-table-wrap">
                        <table className="uidai-pmis-table">
                            <thead>
                                <tr>
                                    <th style={{ width: 50 }}>#</th>
                                    <th>SLA Number</th>
                                    <th>Title</th>
                                    <th>Status</th>
                                    <th style={{ textAlign: "center" }}>Review</th>
                                </tr>
                            </thead>
                            <tbody>
                                {items.map((it, i) => {
                                    const st = STATUS_STYLE[it.status] || STATUS_STYLE.pending;
                                    return (
                                        <tr key={it.record.sla_ref || i}>
                                            <td>{i + 1}</td>
                                            <td style={{ fontWeight: 600, color: "#2a6fb0" }}>{it.record.sla_ref || "—"}</td>
                                            <td>{it.record.title || "—"}</td>
                                            <td>
                                                <span style={{ background: st.bg, color: st.fg, padding: "3px 10px", borderRadius: 99, fontSize: 11, fontWeight: 700, whiteSpace: "nowrap" }}>
                                                    {st.label}
                                                </span>
                                            </td>
                                            <td style={{ textAlign: "center" }}>
                                                <button
                                                    type="button"
                                                    className="uidai-pmis-btn uidai-pmis-btn-cancel uidai-pmis-btn-small"
                                                    style={{ marginTop: 0 }}
                                                    onClick={() => openReview(i)}
                                                >
                                                    {it.status === "done" ? "View" : "Review"}
                                                </button>
                                            </td>
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </table>
                    </div>
                    <div style={{ ...helpStyle, marginTop: 12 }}>
                        Leaving this page discards the parse — the document would have to be read again.
                    </div>
                </div>
            </>
        );
    }

    /* ═══════════ intake phase ═══════════ */
    const canSubmit = !!selectedProject && !!file && !busy;

    return (
        <>
            {/* No subtitle — the numbered steps inside the card say the same
                thing, and the card takes the space back. */}
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 12 }}>
                <div className="uidai-pmis-title" style={{ marginBottom: 0 }}>Onboard SLAs via AI</div>
                <button
                    type="button"
                    className="uidai-pmis-btn uidai-pmis-btn-cancel uidai-pmis-btn-small"
                    style={{ marginTop: 0 }}
                    onClick={() => navigate("/sla-masters")}
                    disabled={busy}
                >
                    ← Back to SLA Masters
                </button>
            </div>

            <div className="uidai-pmis-card" style={{ marginTop: 12 }}>
                {/* The four steps replace a prose description — the flow is
                    easier to take in as a sequence than as a paragraph. */}
                <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 16 }}>
                    {STEPS.map((s) => (
                        <div
                            key={s.n}
                            style={{
                                flex: "1 1 155px", minWidth: 145, padding: "10px 12px",
                                background: "#f7fafd", border: "1px solid #dbe5f1", borderRadius: 8,
                            }}
                        >
                            <div style={{ display: "flex", alignItems: "center", gap: 7, marginBottom: 3 }}>
                                <span
                                    style={{
                                        width: 19, height: 19, borderRadius: "50%", background: "#0b3c88",
                                        color: "#fff", fontSize: 11, fontWeight: 800, flexShrink: 0,
                                        display: "inline-flex", alignItems: "center", justifyContent: "center",
                                    }}
                                >
                                    {s.n}
                                </span>
                                <span style={{ fontSize: 12.5, fontWeight: 700, color: "#173e77" }}>{s.title}</span>
                            </div>
                            <div style={{ fontSize: 11, color: "#6b7a90", lineHeight: 1.5 }}>{s.detail}</div>
                        </div>
                    ))}
                </div>

                {/* Carries weight through type and colour alone — a panel or icon
                    here made the page feel crowded. */}
                <div style={{ fontSize: 12, fontWeight: 700, color: "#92400e", lineHeight: 1.55, marginBottom: 20 }}>
                    <span style={{ textTransform: "uppercase", letterSpacing: ".4px", marginRight: 5 }}>Important:</span>
                    Values are AI-extracted and may lack accuracy. Please verify every field of each
                    SLA against the document before onboarding it.
                </div>

                <div style={{ display: "flex", flexWrap: "wrap", gap: 18, alignItems: "flex-start" }}>
                    <div style={{ flex: "1 1 320px", minWidth: 260 }}>
                        <div style={labelStyle}>Project <span style={{ color: "#d32f2f" }}>*</span></div>
                        <select
                            className="uidai-pmis-filter-select"
                            style={{ width: "100%" }}
                            value={projectKey}
                            onChange={(e) => setProjectKey(e.target.value)}
                            disabled={busy || !projects.length}
                        >
                            <option value="">— Select a project —</option>
                            {projects.map((p) => (
                                <option key={p.projectId} value={p.projectId}>
                                    {(p.projectCode ? p.projectCode + " — " : "") + (p.projectName || p.projectId)}
                                </option>
                            ))}
                        </select>
                        {projectsError
                            ? <div style={{ ...helpStyle, color: "#d32f2f" }}>Couldn't load projects — {projectsError}</div>
                            : <div style={helpStyle}>The contract these SLAs belong to.</div>}
                        {selectedProject && (
                            <div style={{ ...helpStyle, color: "#41506a" }}>
                                Sent to the parser as <code>{selectedProject.projectCode || selectedProject.projectId}</code>
                            </div>
                        )}
                    </div>

                    <div style={{ flex: "1 1 320px", minWidth: 260 }}>
                        <div style={labelStyle}>SLA document (PDF) <span style={{ color: "#d32f2f" }}>*</span></div>
                        <input
                            ref={fileInputRef}
                            type="file"
                            accept=".pdf,application/pdf"
                            onChange={onPickFile}
                            disabled={busy}
                            style={{ width: "100%", fontSize: 13 }}
                        />
                        {fileError && <div style={{ ...helpStyle, color: "#d32f2f" }}>{fileError}</div>}
                        {file && (
                            <div style={{ ...helpStyle, color: "#1a7f37" }}>
                                {file.name} ({fmtSize(file.size)}){" "}
                                <button
                                    type="button"
                                    onClick={clearFile}
                                    disabled={busy}
                                    style={{ border: "none", background: "none", color: "#d32f2f", cursor: "pointer", font: "inherit", padding: 0 }}
                                >
                                    remove
                                </button>
                            </div>
                        )}
                        {!file && !fileError && <div style={helpStyle}>One PDF, up to {MAX_FILE_MB} MB. It is also attached to each SLA as evidence.</div>}
                    </div>
                </div>

                {error && (
                    <div style={{ marginTop: 16, padding: "10px 14px", borderRadius: 6, background: "#fef2f2", border: "1px solid #fca5a5", color: "#991b1b", fontSize: 12, lineHeight: 1.6 }}>
                        {error}
                    </div>
                )}

                <div style={{ display: "flex", alignItems: "center", gap: 12, marginTop: 18, flexWrap: "wrap" }}>
                    <button
                        type="button"
                        className="uidai-pmis-btn uidai-pmis-btn-small"
                        style={{ marginTop: 0, opacity: canSubmit ? 1 : 0.6 }}
                        onClick={parseDocument}
                        disabled={!canSubmit}
                    >
                        {busy ? "Reading document…" : "Read SLAs from document"}
                    </button>
                    {busy && (
                        <span style={{ fontSize: 12, color: "#6b7a90" }}>
                            {elapsed}s elapsed — a long document can take a few minutes. Don't close this tab.
                        </span>
                    )}
                </div>
            </div>
        </>
    );
}
