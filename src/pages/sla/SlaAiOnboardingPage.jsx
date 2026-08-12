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
    // Success confirmation. Lives here rather than in the review form: the
    // form unmounts the instant the next SLA loads, taking its toast with it.
    const [flash, setFlash] = useState("");

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
        const t = window.setTimeout(() => setFlash(""), 6000);
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

    function handleOnboarded(createdId) {
        const ref = (items[cursor] && items[cursor].record.sla_ref) || "The SLA";
        setFlash(`${ref} has been onboarded successfully.`);
        setItems((prev) => {
            const next = prev.slice();
            next[cursor] = { ...next[cursor], status: "done", createdId };
            return next;
        });
        // Advance to the next SLA still awaiting review; fall back to the list.
        const nextIdx = items.findIndex((it, i) => i > cursor && it.status !== "done");
        if (nextIdx >= 0) setCursor(nextIdx);
        else setPhase("list");
    }

    // Green confirmation shown after each successful create. Rendered above
    // both the review form and the list so it survives the switch between them.
    const flashBanner = flash ? (
        <div
            role="status"
            style={{
                display: "flex", alignItems: "center", gap: 10,
                margin: "0 0 14px", padding: "12px 16px", borderRadius: 8,
                background: "#dcfce7", border: "1px solid #86efac", color: "#166534",
                fontSize: 13, fontWeight: 700,
            }}
        >
            <span style={{ fontSize: 16 }}>✓</span>
            <span style={{ flex: 1 }}>{flash}</span>
            <button
                type="button"
                onClick={() => setFlash("")}
                aria-label="Dismiss"
                style={{ border: "none", background: "none", color: "#166534", cursor: "pointer", fontSize: 15, fontWeight: 700, padding: 0, lineHeight: 1 }}
            >
                ✕
            </button>
        </div>
    ) : null;

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
                    pdfFile={file}
                    onOnboarded={handleOnboarded}
                    onPrev={() => setCursor((c) => Math.max(0, c - 1))}
                    onExit={() => setPhase("list")}
                />
            </>
        );
    }

    /* ═══════════ list phase ═══════════ */
    if (phase === "list" && items) {
        const allDone = doneCount === items.length;
        const firstPending = items.findIndex((i) => i.status !== "done");
        return (
            <>
                {flashBanner}
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: 12 }}>
                    <div>
                        <div className="uidai-pmis-title" style={{ marginBottom: 2 }}>
                            {items.length} SLA{items.length === 1 ? "" : "s"} read from {file ? file.name : "the document"}
                        </div>
                        <div className="uidai-pmis-subtitle" style={{ marginTop: 0 }}>
                            {doneCount} of {items.length} onboarded. Each SLA is reviewed before it is created.
                        </div>
                    </div>
                    <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                        <button type="button" className="uidai-pmis-btn uidai-pmis-btn-cancel uidai-pmis-btn-small" style={{ marginTop: 0 }} onClick={startOver}>
                            ↩ Upload a different document
                        </button>
                        {!allDone && (
                            <button type="button" className="uidai-pmis-btn uidai-pmis-btn-small" style={{ marginTop: 0 }} onClick={() => openReview(firstPending < 0 ? 0 : firstPending)}>
                                {doneCount ? "Continue review →" : "Start review →"}
                            </button>
                        )}
                        {allDone && (
                            <button type="button" className="uidai-pmis-btn uidai-pmis-btn-small" style={{ marginTop: 0 }} onClick={() => navigate("/sla-masters")}>
                                Done — back to SLA Masters
                            </button>
                        )}
                    </div>
                </div>

                <div className="uidai-pmis-card" style={{ marginTop: 16 }}>
                    <div className="uidai-pmis-table-wrap">
                        <table className="uidai-pmis-table">
                            <thead>
                                <tr>
                                    <th style={{ width: 50 }}>#</th>
                                    <th>SLA Number</th>
                                    <th>Title</th>
                                    <th>Category</th>
                                    <th>Flags</th>
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
                                            <td>{it.record.category_code || "—"}</td>
                                            <td>
                                                {it.warnings.length
                                                    ? <span style={{ color: "#92400e", fontWeight: 700, fontSize: 12 }}>⚠ {it.warnings.length}</span>
                                                    : <span style={{ color: "#94a3b8", fontSize: 12 }}>—</span>}
                                            </td>
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
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: 12 }}>
                <div>
                    <div className="uidai-pmis-title" style={{ marginBottom: 2 }}>Onboard SLAs via AI</div>
                    <div className="uidai-pmis-subtitle" style={{ marginTop: 0 }}>
                        Upload the contract SLA document — every SLA it contains is read out for you to review.
                    </div>
                </div>
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

            <div className="uidai-pmis-card" style={{ marginTop: 16 }}>
                <div style={{ fontSize: 16, fontWeight: 800, color: "#173e77", marginBottom: 4 }}>Source document</div>
                <div style={{ fontSize: 12, color: "#6b7a90", marginBottom: 18 }}>
                    Nothing is added to the SLA library from this step — the document is only read.
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
