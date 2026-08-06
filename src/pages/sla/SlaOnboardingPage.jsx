/* ══════════════════════════════════════════════════════════════════
   SlaOnboardingPage.jsx — Onboard / Edit an SLA (route /sla-masters/onboard).

   A faithful React host for the standalone "SLA Onboarding.html" dynamic-row
   builder. The proven imperative logic is ported verbatim (markup injected
   into a ref'd container, behaviour driven by the same functions); only the
   data layer is adapted to this app:
     • raw fetch()            → authorizedFetch() (injects the bearer token)
     • hardcoded host bases   → relative /contracts/* paths through the shared
                                API_BASE gateway (same as severity.jsx / ENDPOINTS),
                                and the projects helper for the project list
     • window.location href   → react-router navigate back to /sla-masters

   Edit mode: /sla-masters/onboard?id=<sla_id>.

   POST  /api/v3/sla-masters/from-rfp   create (multipart: payload JSON + image files)
   PATCH /api/v3/sla-masters/{id}       update (JSON, same payload shape)
   GET   /api/v3/sla-categories         category catalog (drives the Target widget)
   GET   /api/v3/sla-rfp-fields         RFP row-type catalog (fallback baked in)
   GET   /api/v3/sla-input-variables    measurement / input-variable catalog
   ══════════════════════════════════════════════════════════════════ */

import React, { useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { authorizedFetch } from "../../api/client";
import { listAll as listAllProjects } from "../../api/projects";

// Contracts service host (SLA masters / categories / RFP fields / input variables).
const CONTRACTS_BASE = "http://10.1.131.199/contracts";

/* ─── Scoped stylesheet (ported from the reference, prefixed with
   `.sla-onb-root` so it can't leak into the rest of the app) ─── */
const STYLE = `
.sla-onb-root{--navy:#0b3c88;--navy-deep:#173e77;--cyan:#0aa1c0;
  --bg:#f4f7fb;--bg-card:#ffffff;
  --text:#1e2a3a;--text-soft:#41506a;--text-muted:#6b7a90;
  --border-soft:#dbe5f1;--border-medium:#dbe5f1;
  --red:#d32f2f;--green:#1a7f37;--amber:#d97706;
  --brand-grad:linear-gradient(90deg,var(--navy),var(--cyan));
  --ring:0 0 0 3px rgba(11,60,136,.12);
  --card-shadow:0 4px 12px rgba(0,0,0,.08);
  font-family:Inter,system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;
  background:var(--bg);color:var(--text);font-size:13px;}
.sla-onb-root *{box-sizing:border-box;}

.sla-onb-root .page-header{position:relative;background:#fff;border:1px solid var(--border-soft);border-radius:12px;
  padding:18px 20px;margin-bottom:18px;box-shadow:var(--card-shadow);overflow:hidden;}
.sla-onb-root .page-header::before{content:"";position:absolute;top:0;left:0;right:0;height:4px;background:var(--brand-grad);}
.sla-onb-root .breadcrumb{font-size:12px;color:var(--text-soft);margin-bottom:4px;}
.sla-onb-root .breadcrumb a{color:var(--navy);font-weight:600;text-decoration:none;cursor:pointer;}
.sla-onb-root .breadcrumb a:hover{text-decoration:underline;}
.sla-onb-root .page-title{font-size:22px;font-weight:800;color:var(--navy-deep);margin:0;line-height:1.3;}
.sla-onb-root .page-sub{font-size:12px;color:var(--text-muted);margin-top:3px;line-height:1.6;}

.sla-onb-root main{padding:0;}

.sla-onb-root .dyn-table-wrap{background:#fff;border:1px solid var(--border-soft);border-radius:12px;
  overflow:hidden;box-shadow:var(--card-shadow);}
.sla-onb-root .dyn-table-head{display:grid;grid-template-columns:340px 1fr auto;gap:0;align-items:center;
  background:linear-gradient(90deg,#f1f6fd 0%,#eaf2fb 100%);
  padding:13px 16px;border-bottom:1px solid var(--border-soft);
  font-size:12px;font-weight:800;color:var(--navy-deep);text-transform:uppercase;letter-spacing:.3px;}
.sla-onb-root .dyn-row{display:grid;grid-template-columns:340px 1fr auto;gap:0;align-items:stretch;
  border-bottom:1px solid var(--border-soft);}
.sla-onb-root .dyn-row:last-child{border-bottom:none;}
.sla-onb-root .dyn-row:hover{background:#f9fcff;}
.sla-onb-root .dyn-row > .dyn-cell-label{background:#f7fafd;padding:13px 14px;border-right:1px solid var(--border-soft);}
.sla-onb-root .dyn-row > .dyn-cell-value{padding:11px 14px;}
.sla-onb-root .dyn-row > .dyn-cell-delete{padding:11px 12px 11px 6px;display:flex;align-items:flex-start;}

.sla-onb-root .dyn-cell-label select{width:100%;padding:9px 10px;font-size:13px;font-weight:600;
  color:var(--navy-deep);border:1px solid var(--border-soft);border-radius:6px;background:#fff;cursor:pointer;}
.sla-onb-root .dyn-cell-label select:focus{outline:none;border-color:var(--navy);box-shadow:var(--ring);}
.sla-onb-root .dyn-cell-label .field-help{font-size:11px;color:var(--text-muted);margin-top:4px;line-height:1.4;}

.sla-onb-root .dyn-cell-value input[type=text],
.sla-onb-root .dyn-cell-value input[type=number],
.sla-onb-root .dyn-cell-value input[type=date],
.sla-onb-root .dyn-cell-value textarea,
.sla-onb-root .dyn-cell-value select{
  width:100%;box-sizing:border-box;font-size:13px;padding:9px 10px;color:var(--text);
  border:1px solid var(--border-soft);border-radius:6px;background:#fff;font-family:inherit;}
.sla-onb-root .dyn-cell-value input::placeholder,
.sla-onb-root .dyn-cell-value textarea::placeholder{color:#9aa7ba;}
.sla-onb-root .dyn-cell-value input:focus,
.sla-onb-root .dyn-cell-value textarea:focus,
.sla-onb-root .dyn-cell-value select:focus{outline:none;border-color:var(--navy);box-shadow:var(--ring);}
.sla-onb-root .dyn-cell-value textarea{min-height:60px;resize:vertical;}

.sla-onb-root .dyn-cell-empty{color:var(--text-muted);font-style:italic;font-size:12px;}

.sla-onb-root .dyn-delete-btn{width:30px;height:30px;border-radius:6px;background:#fff;color:var(--red);
  border:1px solid var(--red);cursor:pointer;font-size:14px;font-weight:700;transition:all .15s;}
.sla-onb-root .dyn-delete-btn:hover{background:var(--red);color:#fff;}

.sla-onb-root .add-row{padding:14px 16px;background:#f7fafd;text-align:center;border-top:1px solid var(--border-soft);}
.sla-onb-root .add-row-btn{background:var(--brand-grad);color:#fff;border:none;border-radius:6px;
  padding:10px 22px;font-size:13px;font-weight:700;cursor:pointer;transition:filter .15s;}
.sla-onb-root .add-row-btn:hover{filter:brightness(1.05);}
.sla-onb-root .add-row-btn:disabled{background:#cbd5e1;cursor:not-allowed;filter:none;}

.sla-onb-root .action-bar{position:sticky;bottom:0;background:rgba(255,255,255,.92);backdrop-filter:blur(6px);
  border-top:1px solid var(--border-soft);margin-top:18px;padding:14px 0;display:flex;justify-content:flex-end;gap:10px;z-index:10;}
.sla-onb-root .btn{padding:10px 20px;border-radius:6px;font-size:13px;font-weight:700;border:none;cursor:pointer;font-family:inherit;transition:filter .15s,background .15s;}
.sla-onb-root .btn.primary{background:var(--brand-grad);color:#fff;}
.sla-onb-root .btn.primary:hover{filter:brightness(1.05);}
.sla-onb-root .btn.cancel{background:#fff;color:var(--navy-deep);border:1px solid var(--border-soft);}
.sla-onb-root .btn.cancel:hover{background:#f1f6fd;}

.sla-onb-root .sub-form{padding:8px 0;}
.sla-onb-root .sub-form .sub-grid{display:grid;gap:8px;}
.sla-onb-root .sub-form label{font-size:11px;color:var(--text-muted);margin-bottom:3px;display:block;}

.sla-onb-root .sev-header{display:grid;grid-template-columns:auto 0.9fr 1.6fr 1.6fr 0.8fr 0.8fr auto;
  gap:8px;align-items:center;padding:7px 8px;background:#f1f6fd;border-radius:6px;
  font-size:11px;font-weight:700;color:var(--navy-deep);text-transform:uppercase;letter-spacing:.3px;margin-bottom:4px;}
.sla-onb-root .sev-row{display:grid;grid-template-columns:auto 0.9fr 1.6fr 1.6fr 0.8fr 0.8fr auto;
  gap:8px;align-items:center;margin-bottom:6px;}
.sla-onb-root .sev-pill{display:inline-flex;align-items:center;justify-content:center;
  min-width:34px;height:26px;padding:0 8px;border-radius:99px;color:#fff;font-size:11px;font-weight:700;letter-spacing:.3px;}
.sla-onb-root .sub-form .small-btn{padding:5px 12px;font-size:11px;border:1px solid var(--border-soft);
  background:#fff;color:var(--navy-deep);border-radius:6px;cursor:pointer;font-weight:600;transition:background .15s;}
.sla-onb-root .sub-form .small-btn:hover{background:#f1f6fd;}

/* Toast stack — each message is its own card, stacked top-right. */
.sla-onb-root .toast-stack{position:fixed;top:20px;right:20px;z-index:2000;display:flex;flex-direction:column;gap:10px;
  width:340px;max-width:90vw;max-height:calc(100vh - 40px);overflow-y:auto;}
.sla-onb-root .toast{position:relative;background:#fff;border-left:4px solid var(--cyan);
  padding:12px 30px 12px 14px;border-radius:8px;box-shadow:0 10px 30px rgba(0,0,0,.15);}
.sla-onb-root .toast.success{border-left-color:var(--green);}
.sla-onb-root .toast.error{border-left-color:var(--red);}
.sla-onb-root .toast-title{font-weight:800;font-size:13px;margin-bottom:3px;color:var(--navy-deep);}
.sla-onb-root .toast-msg{font-size:12px;color:var(--text-soft);line-height:1.45;}
.sla-onb-root .toast-close{position:absolute;top:7px;right:9px;border:none;background:none;cursor:pointer;
  color:#9aa7ba;font-weight:700;font-size:14px;line-height:1;padding:2px;}
.sla-onb-root .toast-close:hover{color:var(--red);}

.sla-onb-root .required{color:var(--red);}
.sla-onb-root .hint{font-size:11px;color:var(--text-muted);margin-top:4px;line-height:1.4;}

.sla-onb-root .lin-preview{margin-top:10px;padding:10px 12px;border-radius:8px;
  border:1px dashed var(--cyan);background:#eef7fb;font-size:13px;color:var(--navy-deep);}

/* Validation highlights */
.sla-onb-root .field-error,
.sla-onb-root .field-error:focus{border:1px solid var(--red) !important;box-shadow:0 0 0 3px rgba(211,47,47,.14) !important;}
.sla-onb-root #s_target_container.field-error{border-radius:8px;padding:6px;}
.sla-onb-root .table-error{outline:2px solid var(--red);outline-offset:2px;}
`;

/* ─── Page markup (ported; inline handlers call window.__slaOnb.*) ─── */
const BODY_HTML = `
<div class="page-header">
  <div style="display:flex;justify-content:space-between;align-items:center;gap:16px;">
    <div>
      <h1 class="page-title" id="pageTitle">Onboard New SLA</h1>
      <div class="page-sub">Pick which RFP row you want to add, fill in the value. Add as many rows as your SLA needs.</div>
    </div>
  </div>
  <div id="connStatus" style="display:none;margin-top:8px;padding:8px 12px;border-radius:6px;background:#fef2f2;border:1px solid #fca5a5;color:#991b1b;font-size:12px;"></div>
</div>

<main>
  <div class="dyn-table-wrap" style="margin-bottom:18px;">
    <div class="dyn-table-head">
      <div style="grid-column:1 / span 3;">
        <span style="display:inline-flex;align-items:center;justify-content:center;width:22px;height:22px;border-radius:6px;background:#e8f3fb;color:#0b3c88;font-size:12px;margin-right:6px;font-weight:700;">★</span>
        SLA Identification &nbsp;<span style="font-weight:500;font-size:10px;color:var(--text-muted);text-transform:none;letter-spacing:0;">(required — every SLA needs these)</span>
      </div>
    </div>
    <div class="dyn-row">
      <div class="dyn-cell-label" style="display:flex;flex-direction:column;justify-content:center;">
        <div style="font-weight:600;color:var(--navy);font-size:13px;">SLA Number <span class="required">*</span></div>
        <div class="field-help">RFP table header. e.g. PMU-SLA001.</div>
      </div>
      <div class="dyn-cell-value"><input id="s_sla_ref" type="text" placeholder="PMU-SLA001" oninput="window.__slaOnb._syncContractType()"></div>
      <div class="dyn-cell-delete"></div>
    </div>
    <div class="dyn-row">
      <div class="dyn-cell-label" style="display:flex;flex-direction:column;justify-content:center;">
        <div style="font-weight:600;color:var(--navy);font-size:13px;">Contract Type</div>
        <div class="field-help">Derived from the SLA Number prefix — BSP-SLA001 → BSP. Set server-side; shown here for confirmation.</div>
      </div>
      <div class="dyn-cell-value"><input id="s_contract_type" type="text" readonly placeholder="—" style="background:#f8fafc;font-weight:600;color:var(--navy);"></div>
      <div class="dyn-cell-delete"></div>
    </div>
    <div class="dyn-row">
      <div class="dyn-cell-label" style="display:flex;flex-direction:column;justify-content:center;">
        <div style="font-weight:600;color:var(--navy);font-size:13px;">Title <span class="required">*</span></div>
      </div>
      <div class="dyn-cell-value"><input id="s_title" type="text" placeholder="Non-submission of deliverable"></div>
      <div class="dyn-cell-delete"></div>
    </div>
    <div class="dyn-row">
      <div class="dyn-cell-label" style="display:flex;flex-direction:column;justify-content:center;">
        <div style="font-weight:600;color:var(--navy);font-size:13px;">Project <span class="required">*</span></div>
        <div class="field-help">The contract this SLA belongs to.</div>
      </div>
      <div class="dyn-cell-value"><select id="s_project_id"><option value="">— Select a project —</option></select></div>
      <div class="dyn-cell-delete"></div>
    </div>
    <div class="dyn-row">
      <div class="dyn-cell-label" style="display:flex;flex-direction:column;justify-content:center;">
        <div style="font-weight:600;color:var(--navy);font-size:13px;">SLA Category <span class="required">*</span></div>
        <div class="field-help">Picks the calculation engine. Also chooses whether Target below is a severity table or a linear LD form</div>
      </div>
      <div class="dyn-cell-value">
        <select id="s_category_code" onchange="window.__slaOnb._onStaticCategoryChange()"><option value="">— Select —</option></select>
      </div>
      <div class="dyn-cell-delete"></div>
    </div>
    <div class="dyn-row">
      <div class="dyn-cell-label" style="display:flex;flex-direction:column;justify-content:center;">
        <div style="font-weight:600;color:var(--navy);font-size:13px;">Definition of SLA <span class="required">*</span></div>
        <div class="field-help">One-sentence summary — what does this SLA cover?</div>
      </div>
      <div class="dyn-cell-value"><textarea id="s_description" placeholder='RFP "Definition of SLA" / "Description" row.'></textarea></div>
      <div class="dyn-cell-delete"></div>
    </div>
    <div class="dyn-row">
      <div class="dyn-cell-label" style="display:flex;flex-direction:column;justify-content:center;">
        <div style="font-weight:600;color:var(--navy);font-size:13px;">SLA Calculation <span class="required">*</span></div>
        <div class="field-help">How the value is derived — formula / counting rule / measurement method.</div>
      </div>
      <div class="dyn-cell-value"><textarea id="s_calculation_method" placeholder='Plain-English description (RFP "SLA calculation" row).'></textarea></div>
      <div class="dyn-cell-delete"></div>
    </div>
    <div class="dyn-row" style="border-bottom:none;">
      <div class="dyn-cell-label" style="display:flex;flex-direction:column;justify-content:center;">
        <div style="font-weight:600;color:var(--navy);font-size:13px;">Target / Applied Severity level <span class="required">*</span></div>
        <div class="field-help" id="s_target_help">Pick a category above — the right input renders here automatically (severity table for banded SLAs, linear LD form for deliverable / query SLAs).</div>
      </div>
      <div class="dyn-cell-value">
        <div id="s_target_container">
          <div class="dyn-cell-empty">Waiting for category selection above…</div>
        </div>
      </div>
      <div class="dyn-cell-delete"></div>
    </div>
  </div>

  <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">
    <div>
      <h2 style="font-size:14px;font-weight:800;color:var(--navy);margin:0;">RFP rows you've added</h2>
      <div style="font-size:11px;color:var(--text-muted);margin-top:2px;">
        Click <strong>+ Add row</strong> to pick the next field. Use <strong>Pre-load standard RFP rows</strong> to add them all at once.
      </div>
    </div>
    <button class="btn cancel" style="font-size:12px;padding:6px 12px;" onclick="window.__slaOnb.useTemplate()">↻ Pre-load standard RFP rows</button>
  </div>

  <div class="dyn-table-wrap" id="dynTable">
    <div class="dyn-table-head">
      <div>RFP Row Type</div>
      <div>Value</div>
      <div style="width:36px;"></div>
    </div>
    <div id="dynBody"></div>
    <div class="add-row">
      <button class="add-row-btn" id="addRowBtn" onclick="window.__slaOnb.addRow()">+ Add row</button>
    </div>
  </div>
</main>

<div class="action-bar" id="actionBar">
  <button class="btn cancel" onclick="window.__slaOnb.cancelOnboarding()">Cancel</button>
  <button class="btn primary" id="submitBtn" onclick="window.__slaOnb.submitSla()">Onboard SLA</button>
</div>

<div class="toast-stack" id="toastStack"></div>
`;

export default function SlaOnboardingPage() {
    const navigate = useNavigate();
    const hostRef = useRef(null);

    useEffect(() => {
        const host = hostRef.current;
        if (!host) return undefined;

        /* ── inject scoped stylesheet ── */
        const styleEl = document.createElement("style");
        styleEl.setAttribute("data-sla-onb", "");
        styleEl.textContent = STYLE;
        document.head.appendChild(styleEl);

        // Drop the app shell's bottom scroll padding so the sticky action bar
        // sits flush — restored on unmount. (Imperative override; no global CSS.)
        const scroller = host.closest(".pmis-content");
        const prevPadBottom = scroller ? scroller.style.paddingBottom : "";
        if (scroller) scroller.style.paddingBottom = "0";

        /* ════════ ported builder logic (scoped to this effect) ════════ */
        const _BOOT_FAILS = new Set();

        let RFP_FIELDS = [];
        let CATEGORIES = [];
        let PROJECTS = [];
        let INPUT_VARIABLES = [];
        let editingId = null;
        // Blob URLs minted for existing-attachment thumbnails; revoked on unmount.
        const OBJECT_URLS = [];
        // Serialized form state captured right after edit-mode hydration (see _dirty).
        let _formBaseline = null;

        // After editing, return to that SLA's detail page (so changes are
        // visible and Back goes to the list); after creating, go to the list.
        const goBack = () => navigate(editingId ? `/sla-masters/view/${encodeURIComponent(editingId)}` : "/sla-masters");

        function _sevColour(sev) {
            const palette = { 0: "#16a34a", 1: "#f59e0b", 2: "#f97316", 3: "#ef4444", 4: "#991b1b" };
            if (palette[sev] !== undefined) return palette[sev];
            if (sev >= 5) return `hsl(0, 60%, ${Math.max(15, 30 - (sev - 4) * 3)}%)`;
            return "#64748b";
        }
        const _SEV_COLOUR = new Proxy({}, { get: (_, s) => _sevColour(Number(s)) });

        function _severityOptions(currentSev) {
            const max = Math.max(9, currentSev || 0);
            return Array.from({ length: max + 1 }, (_, s) =>
                `<option value="${s}" ${currentSev === s ? "selected" : ""}>Severity ${s}</option>`
            ).join("");
        }

        const _FALLBACK_RFP_FIELDS = [
            { key: "sla_ref", label: "SLA Number", section: "Identification", input_type: "text", required: true, placeholder: "PMU-SLA001" },
            { key: "title", label: "Title", section: "Identification", input_type: "text", required: true },
            { key: "project_id", label: "Project", section: "Identification", input_type: "project_picker", required: true },
            { key: "category_code", label: "SLA Category", section: "Identification", input_type: "category_picker", required: true },
            { key: "description", label: "Definition of SLA", section: "Definition", input_type: "textarea" },
            { key: "scope_text", label: "Scope of SLA", section: "Definition", input_type: "textarea" },
            { key: "data_source", label: "Source of Data / Tool used for SLA monitoring", section: "Source & Calculation", input_type: "text" },
            { key: "calculation_method", label: "SLA Calculation", section: "Source & Calculation", input_type: "textarea" },
            { key: "reports_submitted_to", label: "Reports submitted to", section: "Source & Calculation", input_type: "text" },
            { key: "measurement_interval", label: "Measurement Interval", section: "Cadence", input_type: "select", options: ["DAILY", "WEEKLY", "MONTHLY", "QUARTERLY", "ONE_TIME"], default: "MONTHLY" },
            { key: "reporting_interval", label: "Reporting Interval", section: "Cadence", input_type: "select", options: ["WEEKLY", "MONTHLY", "QUARTERLY", "ANNUAL"], default: "QUARTERLY" },
            {
                key: "ld_computation_base", label: "Applied On", section: "Cadence", input_type: "select",
                options: [
                    { value: "QUARTERLY_PAYMENT", label: "Net Planned Quarterly Payment (NPQP)" },
                    { value: "ANNUAL_PAYMENT", label: "Annual Contract Value" },
                    { value: "FIXED_AMOUNT", label: "Deliverable Cost (set per mapping)" },
                ], default: "QUARTERLY_PAYMENT",
            },
            /* No `default` here on purpose (#349): a hardcoded start date is
               the same trap as a placeholder value — it looks filled in, so it
               gets saved unchanged. The field is required, so the user picks. */
            { key: "effective_from", label: "Active From", section: "Cadence", input_type: "date", required: true },
            { key: "effective_until", label: "Active Until", section: "Cadence", input_type: "date" },
            { key: "measurement", label: "What is measured (primary)", section: "Measurement", input_type: "measurement_set", required: true },
            { key: "secondary_measurement", label: "What is measured (secondary)", section: "Measurement", input_type: "measurement_set" },
            { key: "target_rows", label: "Target / Applied Severity level", section: "Target", input_type: "severity_table" },
            { key: "linear_escalation", label: "Linear LD escalation", section: "Target", input_type: "linear_form" },
            { key: "placeholders", label: "Mapping inputs (filled at attach time)", section: "Mapping", input_type: "placeholder_table" },
            { key: "attachments", label: "Image attachments", section: "Evidence", input_type: "file_picker" },
            { key: "data_capture_process", label: "Process to capture raw data for SLA calculations", section: "Source & Calculation", input_type: "textarea", help: "Appears in all 4 RFPs (PMU, MSAP, BSP, MSIP). Describes how the raw measurement is captured before the SLA calculation runs." },
            { key: "monitoring_tool", label: "Tool used for SLA monitoring", section: "Source & Calculation", input_type: "text", help: 'Appears in MSAP, MSIP. e.g. "EMS tools", "biometric attendance system", "N/A".' },
            { key: "ld_calculation", label: "LD calculation (separate from SLA calculation)", section: "Source & Calculation", input_type: "textarea", help: "MSAP RFP separates the SLA-value calculation from the LD-value calculation. Optional for other contracts." },
            { key: "assumptions", label: "Assumptions / Remarks", section: "Source & Calculation", input_type: "textarea", help: 'MSAP "Assumptions" / "Remarks" row — definitions of T, planned dates, application tracks, etc.' },
            { key: "metric_type", label: "Metric Type", section: "Identification", input_type: "text", help: 'BSP RFP per-metric category — e.g. "Accuracy", "Throughput", "Availability".' },
        ];

        const _FALLBACK_CATEGORIES = [
            { code: "DELIVERABLE_SUBMISSION", display_name: "Deliverable Submission", formula_type: "fixed_escalation" },
            { code: "QUERY_RESOLUTION", display_name: "Query Resolution", formula_type: "fixed_escalation" },
            { code: "RECOMMENDATION_QUALITY", display_name: "Recommendation Quality", formula_type: "point_accumulation" },
            { code: "RESOURCE_MANAGEMENT", display_name: "Resource Management", formula_type: "point_accumulation" },
            { code: "GOVERNANCE_TOOL", display_name: "Governance Tool", formula_type: "point_accumulation" },
        ];

        RFP_FIELDS = _FALLBACK_RFP_FIELDS.slice();
        CATEGORIES = _FALLBACK_CATEGORIES.slice();
        // No fallback for projects — an empty / failed list shows no options
        // (and a "couldn't load projects" note), never a fake row.
        PROJECTS = [];

        /* ── boot ── */
        async function boot() {
            _BOOT_FAILS.clear();
            host.querySelector("#connStatus").style.display = "none";
            await Promise.all([loadRfpFields(), loadCategories(), loadProjects(), loadInputVariables()]);
            _renderConnStatus();
            _populateStaticDropdowns();
            const params = new URLSearchParams(window.location.search);
            if (params.get("id")) {
                editingId = params.get("id");
                host.querySelector("#pageTitle").textContent = "Edit SLA";
                host.querySelector("#submitBtn").textContent = "Save Changes";
                await loadSlaForEdit(editingId);
            }
        }

        function _renderConnStatus() {
            const el = host.querySelector("#connStatus");
            if (!_BOOT_FAILS.size) { el.style.display = "none"; return; }
            const items = Array.from(_BOOT_FAILS);
            el.style.display = "";
            el.innerHTML = `
                <div style="display:flex;justify-content:space-between;align-items:center;gap:12px;">
                  <div>
                    <strong>⚠ Some catalogs failed to load</strong> &nbsp;—&nbsp; ${items.length} endpoint${items.length === 1 ? "" : "s"}.
                    <div style="font-size:11px;margin-top:4px;color:#7f1d1d;">${items.map((i) => "<code>" + esc(i) + "</code>").join(", ")}.</div>
                  </div>
                  <button class="btn cancel" style="font-size:11px;padding:5px 10px;" onclick="window.__slaOnb.boot()">Retry</button>
                </div>`;
        }

        async function _safeFetch(url, label) {
            try {
                const r = await authorizedFetch(url, { method: "GET", headers: { Accept: "application/json" } });
                if (!r.ok) { _BOOT_FAILS.add(label + " HTTP " + r.status); return null; }
                return await r.json();
            } catch (e) {
                _BOOT_FAILS.add(label + " (" + e.message + ")");
                return null;
            }
        }

        async function loadRfpFields() {
            const body = await _safeFetch(CONTRACTS_BASE + "/api/v3/sla-rfp-fields", "sla-rfp-fields");
            if (body) {
                const live = (body?.data?._embedded?.elements || []).map((el) => el.data || el);
                if (live.length) {
                    // A select field needs an `options` array to render its choices.
                    // If the live catalog omits them, backfill from the curated
                    // fallback so the dropdown isn't empty.
                    const fb = new Map(_FALLBACK_RFP_FIELDS.map((f) => [f.key, f]));
                    live.forEach((f) => {
                        if (f.input_type === "select" && (!Array.isArray(f.options) || !f.options.length)) {
                            const src = fb.get(f.key);
                            if (src) {
                                f.options = src.options;
                                if (f.default == null) f.default = src.default;
                            }
                        }
                    });
                    RFP_FIELDS = live;
                }
            }
            if (!RFP_FIELDS.length) RFP_FIELDS = _FALLBACK_RFP_FIELDS.slice();
        }
        async function loadCategories() {
            const body = await _safeFetch(CONTRACTS_BASE + "/api/v3/sla-categories", "sla-categories");
            if (body) {
                const live = (body?.data?._embedded?.elements || []).map((el) => el.data || el);
                if (live.length) CATEGORIES = live;
            }
            if (!CATEGORIES.length) CATEGORIES = _FALLBACK_CATEGORIES.slice();
        }
        async function loadProjects() {
            // Use the app's proven projects helper (handles the gateway + envelope
            // shape) rather than a hand-rolled fetch — this is what worked before.
            // No fallback: on empty/failure the dropdown stays empty.
            try {
                const rows = await listAllProjects();
                PROJECTS = (Array.isArray(rows) ? rows : [])
                    .map((p) => ({ id: p.projectId, name: p.projectName, projectCode: p.projectCode }))
                    .filter((p) => p.id);
                if (!PROJECTS.length) _BOOT_FAILS.add("projects (empty response)");
            } catch (e) {
                PROJECTS = [];
                _BOOT_FAILS.add("projects (" + e.message + ")");
            }
        }
        async function loadInputVariables() {
            const body = await _safeFetch(CONTRACTS_BASE + "/api/v3/sla-input-variables", "sla-input-variables");
            if (body) {
                INPUT_VARIABLES = (body?.data?._embedded?.elements || []).map((el) => el.data || el);
            }
        }

        const _STATIC_ID_KEYS = [
            "sla_ref", "title", "project_id", "category_code",
            "description", "calculation_method",
            "target_rows", "linear_escalation",
        ];
        const _TEMPLATE_KEYS = [
            "scope_text", "data_source", "reports_submitted_to",
            "measurement_interval", "reporting_interval", "ld_computation_base",
            "effective_from", "measurement",
        ];

        function useTemplate() {
            const present = new Set(Array.from(host.querySelectorAll("#dynBody .dyn-row")).map((r) => r.dataset.fieldKey).filter(Boolean));
            const ordered = RFP_FIELDS.filter((f) => _TEMPLATE_KEYS.includes(f.key) && !present.has(f.key))
                .sort((a, b) => _TEMPLATE_KEYS.indexOf(a.key) - _TEMPLATE_KEYS.indexOf(b.key));
            ordered.forEach((f) => addRow(f.key));
        }

        /* #362 — Contract Type auto-derives server-side from the SLA ref
           prefix (BSP-SLA001 → BSP) when it's omitted, which is why Mapping
           no longer shows it blank. Mirroring that derivation here is purely
           informational: the field is read-only and is NOT submitted, so the
           backend stays the single source of truth. */
        function _syncContractType() {
            const src = host.querySelector("#s_sla_ref");
            const out = host.querySelector("#s_contract_type");
            if (!src || !out) return;
            const ref = (src.value || "").trim();
            const m = ref.match(/^([A-Za-z0-9]+)[-_]/);
            out.value = m ? m[1].toUpperCase() : "";
        }

        /* A saved SLA stores `category` as the catalog's DISPLAY NAME
           ("Resource Management"), while the picker's option values are the
           catalog CODEs ("RESOURCE_MANAGEMENT"). Assigning the display name
           straight to select.value fails silently — the category stayed blank
           on every edit, which in turn left the Target widget unrendered and
           dropped the severity table. Resolve either form back to a code. */
        function _normKey(x) {
            return String(x == null ? "" : x).toLowerCase().replace(/[^a-z0-9]+/g, "");
        }
        function _resolveCategoryCode(raw) {
            const s = String(raw == null ? "" : raw).trim();
            if (!s) return "";
            const n = _normKey(s);
            const hit = CATEGORIES.find((c) => _normKey(c.code) === n || _normKey(c.display_name) === n);
            return hit ? hit.code : s;
        }
        // Select a value even when the catalog that built the <option>s didn't
        // include it — a missing option would otherwise blank the field.
        function _setSelect(el, value, labelSuffix) {
            if (!el) return;
            const v = value == null ? "" : String(value);
            if (v && !Array.from(el.options).some((o) => o.value === v)) {
                el.insertAdjacentHTML("beforeend", `<option value="${esc(v)}">${esc(v)}${esc(labelSuffix || "")}</option>`);
            }
            el.value = v;
        }

        function _onStaticCategoryChange() {
            const sel = host.querySelector("#s_category_code");
            const code = (sel.value || "").trim();
            const container = host.querySelector("#s_target_container");
            if (!code) {
                container.innerHTML = '<div class="dyn-cell-empty">Waiting for category selection above…</div>';
                return;
            }
            // Drive the widget off the category's formula_type (robust to renames).
            const cat = CATEGORIES.find((c) => c.code === code);
            const isLinear = cat ? cat.formula_type === "fixed_escalation"
                : (code === "Deliverable Submission" || code === "Query Resolution");
            const fakeField = isLinear ? { key: "linear_escalation" } : { key: "target_rows" };
            if (isLinear) _widgetLinearForm(container, fakeField);
            else _widgetSeverityTable(container, fakeField);
        }

        function _populateStaticDropdowns() {
            const proj = host.querySelector("#s_project_id");
            if (proj) {
                const cur = proj.value;
                proj.innerHTML = '<option value="">— Select a project —</option>' +
                    PROJECTS.map((p) => `<option value="${esc(p.id)}">${esc(((p.projectCode || p.code || "") + " — " + (p.name || "")))}</option>`).join("");
                if (cur) proj.value = cur;
            }
            const cat = host.querySelector("#s_category_code");
            if (cat) {
                const cur = cat.value;
                cat.innerHTML = '<option value="">— Select —</option>' +
                    CATEGORIES.map((c) => `<option value="${esc(c.code)}" data-formula="${esc(c.formula_type || "")}">${esc(c.display_name || c.code)}</option>`).join("");
                if (cur) { cat.value = cur; _onStaticCategoryChange(); }
            }
        }

        function cancelOnboarding() {
            if (_dirty() && !window.confirm("Discard your changes and go back?")) return;
            goBack();
        }
        function _dirty() {
            // Edit mode baselines the form once hydration finishes and diffs
            // against that — otherwise every loaded value counts as a change
            // (assigning .value never updates .defaultValue, and <select> has
            // no .defaultValue at all), so Cancel always nagged.
            if (_formBaseline !== null) return _formSnapshot() !== _formBaseline;
            const staticEls = ["s_sla_ref", "s_title", "s_project_id", "s_category_code"].map((id) => host.querySelector("#" + id)).filter(Boolean);
            const dynEls = Array.from(host.querySelectorAll("#dynBody input, #dynBody textarea, #dynBody select"));
            return [...staticEls, ...dynEls].some((el) => (el.value || "").trim() !== "" && el.value !== el.defaultValue);
        }
        function _formSnapshot() {
            return Array.from(host.querySelectorAll(
                "#s_sla_ref, #s_title, #s_project_id, #s_category_code, #s_description, #s_calculation_method," +
                "#s_target_container [data-k], #dynBody input, #dynBody textarea, #dynBody select"
            )).map((el) => (el.type === "file" ? String(el.files ? el.files.length : 0) : el.value)).join("");
        }

        /* ── row management ── */
        function _usedKeysExcept(excludeRow) {
            const used = new Set();
            host.querySelectorAll("#dynBody .dyn-row").forEach((r) => {
                if (r === excludeRow) return;
                const k = r.dataset.fieldKey;
                if (k) used.add(k);
            });
            return used;
        }
        function _fieldTypeOptions(selectedKey, excludeRow) {
            const used = _usedKeysExcept(excludeRow);
            const opts = ['<option value="">— Pick a field type —</option>'];
            const sections = {};
            for (const f of RFP_FIELDS) {
                if (_STATIC_ID_KEYS.includes(f.key)) continue;
                if (used.has(f.key) && f.key !== selectedKey) continue;
                (sections[f.section || "Other"] = sections[f.section || "Other"] || []).push(f);
            }
            for (const [section, fields] of Object.entries(sections)) {
                opts.push(`<optgroup label="${esc(section)}">`);
                for (const f of fields) {
                    const sel = f.key === selectedKey ? " selected" : "";
                    const req = f.required ? " *" : "";
                    opts.push(`<option value="${esc(f.key)}"${sel}>${esc(f.label)}${req}</option>`);
                }
                opts.push("</optgroup>");
            }
            return opts.join("");
        }
        function _refreshAllRowDropdowns() {
            host.querySelectorAll("#dynBody .dyn-row").forEach((row) => {
                const sel = row.querySelector(".field-type-select");
                if (!sel) return;
                const current = sel.value;
                sel.innerHTML = _fieldTypeOptions(current, row);
                sel.value = current;
            });
        }
        function addRow(prefilledKey) {
            const body = host.querySelector("#dynBody");
            const row = document.createElement("div");
            row.className = "dyn-row";
            row.dataset.fieldKey = prefilledKey || "";
            row.innerHTML = `
                <div class="dyn-cell-label">
                  <select class="field-type-select" onchange="window.__slaOnb._onFieldTypeChange(this)">
                    ${_fieldTypeOptions(prefilledKey || "", row)}
                  </select>
                  <div class="field-help"></div>
                </div>
                <div class="dyn-cell-value">
                  <div class="dyn-cell-empty">Pick a field type on the left to render the input here.</div>
                </div>
                <div class="dyn-cell-delete">
                  <button class="dyn-delete-btn" title="Remove this row" onclick="window.__slaOnb._deleteRow(this)">✕</button>
                </div>`;
            body.appendChild(row);
            if (prefilledKey) _renderValueWidget(row, prefilledKey);
            _refreshAllRowDropdowns();
            _refreshAddButton();
        }
        function _onFieldTypeChange(sel) {
            const row = sel.closest(".dyn-row");
            const key = sel.value;
            row.dataset.fieldKey = key;
            if (!key) {
                row.querySelector(".dyn-cell-value").innerHTML = '<div class="dyn-cell-empty">Pick a field type on the left to render the input here.</div>';
                row.querySelector(".field-help").textContent = "";
            } else {
                _renderValueWidget(row, key);
                // A row added by hand during an edit is subject to the same
                // PATCH field-set limits as the hydrated ones.
                if (editingId && !_PATCHABLE_KEYS.has(key) && key !== "attachments") _lockCell(row.querySelector(".dyn-cell-value"));
            }
            _refreshAllRowDropdowns();
            _refreshAddButton();
        }
        function _deleteRow(btn) {
            btn.closest(".dyn-row").remove();
            _refreshAllRowDropdowns();
            _refreshAddButton();
        }
        function _refreshAddButton() {
            const used = _usedKeysExcept(null);
            const addable = RFP_FIELDS.filter((f) => !_STATIC_ID_KEYS.includes(f.key)).length;
            host.querySelector("#addRowBtn").disabled = used.size >= addable;
        }

        /* ── value-cell widget renderers ── */
        function _renderValueWidget(row, key) {
            const field = RFP_FIELDS.find((f) => f.key === key);
            if (!field) return;
            row.querySelector(".field-help").textContent = field.help || "";
            const cell = row.querySelector(".dyn-cell-value");
            const t = field.input_type;
            if (t === "text") return _widgetText(cell, field);
            if (t === "textarea") return _widgetTextarea(cell, field);
            if (t === "date") return _widgetDate(cell, field);
            if (t === "select") return _widgetSelect(cell, field);
            if (t === "project_picker") return _widgetProjectPicker(cell, field);
            if (t === "category_picker") return _widgetCategoryPicker(cell, field);
            if (t === "measurement_set") return _widgetMeasurementSet(cell, field);
            if (t === "severity_table") return _widgetSeverityTable(cell, field);
            if (t === "linear_form") return _widgetLinearForm(cell, field);
            if (t === "placeholder_table") return _widgetPlaceholderTable(cell, field);
            if (t === "file_picker") return _widgetFilePicker(cell, field);
            cell.innerHTML = `<div class="dyn-cell-empty">Unknown widget: ${esc(t)}</div>`;
            return undefined;
        }
        /* Placeholders are routed through _cleanExample so a junk catalog
           example ("test" / "string" / "1.1") never even suggests itself. */
        function _widgetText(cell, f) { cell.innerHTML = `<input type="text" data-v="${esc(f.key)}" placeholder="${esc(_cleanExample(f.placeholder))}">`; }
        function _widgetTextarea(cell, f) { cell.innerHTML = `<textarea data-v="${esc(f.key)}" placeholder="${esc(_cleanExample(f.placeholder))}"></textarea>`; }
        function _widgetDate(cell, f) { cell.innerHTML = `<input type="date" data-v="${esc(f.key)}" value="${esc(_cleanExample(f.default))}">`; }
        function _widgetSelect(cell, f) {
            const opts = (f.options || []).map((o) => {
                const v = typeof o === "string" ? o : o.value;
                const l = typeof o === "string" ? o : o.label;
                const sel = v === (f.default || "") ? " selected" : "";
                return `<option value="${esc(v)}"${sel}>${esc(l)}</option>`;
            }).join("");
            cell.innerHTML = `<select data-v="${esc(f.key)}">${opts}</select>`;
        }
        function _widgetProjectPicker(cell, f) {
            const opts = PROJECTS.map((p) => `<option value="${esc(p.id)}">${esc(((p.projectCode || p.code || "") + " — " + (p.name || "")))}</option>`).join("");
            cell.innerHTML = `<select data-v="${esc(f.key)}"><option value="">— Select a project —</option>${opts}</select>`;
        }
        function _widgetCategoryPicker(cell, f) {
            const opts = CATEGORIES.map((c) => `<option value="${esc(c.code)}" data-formula="${esc(c.formula_type || "")}">${esc(c.display_name || c.code)}</option>`).join("");
            cell.innerHTML = `<select data-v="${esc(f.key)}"><option value="">— Select —</option>${opts}</select>
                <div class="hint">Picks the calculation engine.</div>`;
        }
        function _widgetMeasurementSet(cell, f) {
            cell.innerHTML = `
                <div class="sub-form" data-mv-host data-mv-key="${esc(f.key)}">
                  <div style="display:grid;grid-template-columns:1fr;gap:8px;">
                    <div>
                      <label>Measurement variable <span class="required">*</span></label>
                      <select class="mv-picker" onchange="window.__slaOnb._onMeasurementPick(this)">${_measurementOptions("")}</select>
                      <div class="hint">Picked from the DSL catalog. To add a new one, choose "+ Define new measurement variable" below.</div>
                    </div>
                    <div class="mv-detail" style="display:none;background:#f8fafc;padding:10px 12px;border-radius:6px;border:1px solid var(--border-soft);">
                      <div style="display:grid;grid-template-columns:1.4fr 0.6fr 0.7fr;gap:10px;align-items:end;">
                        <div>
                          <label>Display name <span style="font-size:10px;color:var(--text-muted);">(read-only — from catalog)</span></label>
                          <input type="text" class="mv-label" readonly style="background:#fff;color:var(--navy);font-weight:600;">
                        </div>
                        <div>
                          <label>Unit <span style="font-size:10px;color:var(--text-muted);">(read-only)</span></label>
                          <input type="text" class="mv-unit" readonly style="background:#fff;color:var(--navy);font-weight:600;">
                        </div>
                        <div>
                          <label>Target value (optional)</label>
                          <input type="text" class="mv-target" placeholder="0">
                        </div>
                      </div>
                      <input type="hidden" class="mv-metric-key">
                    </div>
                    <div class="mv-create" style="display:none;background:#fffbeb;padding:10px 12px;border-radius:6px;border:1px dashed #fcd34d;">
                      <div style="font-size:11px;color:#92400e;font-weight:600;margin-bottom:6px;">Define a new measurement variable</div>
                      <div style="display:grid;grid-template-columns:1fr 1.4fr 0.6fr auto auto;gap:8px;align-items:end;">
                        <div><label>Key (snake_case)</label><input type="text" class="mv-new-key" placeholder="e.g. uptime_percent"></div>
                        <div><label>Display name</label><input type="text" class="mv-new-label" placeholder="e.g. System uptime"></div>
                        <div><label>Unit</label><input type="text" class="mv-new-unit" placeholder="e.g. %"></div>
                        <button type="button" class="small-btn" onclick="window.__slaOnb._confirmNewMeasurement(this)" style="background:var(--navy);color:#fff;border:none;">Add to catalog</button>
                        <button type="button" class="small-btn" onclick="window.__slaOnb._cancelNewMeasurement(this)">Cancel</button>
                      </div>
                    </div>
                  </div>
                </div>`;
        }
        function _measurementOptions(selectedKey) {
            const opts = [`<option value="" ${!selectedKey ? "selected" : ""}>— Pick a measurement variable —</option>`];
            for (const v of INPUT_VARIABLES) {
                const lbl = `${v.label}${v.unit ? " (" + v.unit + ")" : ""}`;
                opts.push(`<option value="${esc(v.key)}" ${v.key === selectedKey ? "selected" : ""}>${esc(lbl)}</option>`);
            }
            opts.push('<option value="__new__">+ Define new measurement variable…</option>');
            if (selectedKey && !INPUT_VARIABLES.find((v) => v.key === selectedKey)) {
                opts.splice(1, 0, `<option value="${esc(selectedKey)}" selected>${esc(selectedKey)} (custom)</option>`);
            }
            return opts.join("");
        }
        function _onMeasurementPick(sel) {
            const hostEl = sel.closest("[data-mv-host]");
            const detail = hostEl.querySelector(".mv-detail");
            const create = hostEl.querySelector(".mv-create");
            const key = sel.value;
            if (key === "__new__") { detail.style.display = "none"; create.style.display = ""; return; }
            create.style.display = "none";
            if (!key) { detail.style.display = "none"; return; }
            const v = INPUT_VARIABLES.find((x) => x.key === key);
            detail.style.display = "";
            hostEl.querySelector(".mv-label").value = (v && v.label) || key;
            hostEl.querySelector(".mv-unit").value = (v && v.unit) || "";
            hostEl.querySelector(".mv-metric-key").value = key;
            const tgt = hostEl.querySelector(".mv-target");
            /* #349 — the catalog's example_value is a HINT, never a value.
               Pre-filling it is what put "test" / "string" / "1.1" into real
               SLA rows: the user saw a filled field, left it alone, and the
               placeholder got saved. Show it as a placeholder instead, and
               drop the known junk sentinels entirely so they can't even
               suggest themselves. */
            if (tgt) {
                const hint = _cleanExample(v && v.example_value);
                tgt.placeholder = hint || "0";
            }
        }
        /* Values the old catalog rows shipped as "examples". They carry no
           meaning, so they're never surfaced — not as a value, not as a
           placeholder. */
        const _JUNK_EXAMPLES = new Set(["test", "string", "1.1", "0.0", "example", "none", "n/a", "na", "null"]);
        function _cleanExample(raw) {
            if (raw === null || raw === undefined) return "";
            const s = String(raw).trim();
            if (!s) return "";
            return _JUNK_EXAMPLES.has(s.toLowerCase()) ? "" : s;
        }
        function _confirmNewMeasurement(btn) {
            const hostEl = btn.closest("[data-mv-host]");
            const rawKey = (hostEl.querySelector(".mv-new-key").value || "").trim();
            const rawLabel = (hostEl.querySelector(".mv-new-label").value || "").trim();
            const rawUnit = (hostEl.querySelector(".mv-new-unit").value || "").trim();
            if (!rawKey || !rawLabel) { toast("Missing fields", "Key and Display name are required.", "error"); return; }
            const safeKey = rawKey.toLowerCase().replace(/[^a-z0-9_]+/g, "_").replace(/^_+|_+$/g, "");
            if (!safeKey) { toast("Invalid key", "Use snake_case letters / digits / underscores.", "error"); return; }
            if (INPUT_VARIABLES.find((v) => v.key === safeKey)) { toast("Already exists", `"${safeKey}" is already in the catalog.`, "error"); return; }
            INPUT_VARIABLES.push({ key: safeKey, label: rawLabel, unit: rawUnit || null, source: "custom" });
            const sel = hostEl.querySelector(".mv-picker");
            sel.innerHTML = _measurementOptions(safeKey);
            sel.value = safeKey;
            _onMeasurementPick(sel);
            toast("Added", `"${rawLabel}" is now in the catalog and selected.`, "success");
        }
        function _cancelNewMeasurement(btn) {
            const hostEl = btn.closest("[data-mv-host]");
            hostEl.querySelector(".mv-create").style.display = "none";
            const sel = hostEl.querySelector(".mv-picker");
            sel.value = "";
            _onMeasurementPick(sel);
        }

        /* ── severity-table widget ── */
        function _widgetSeverityTable(cell, f) {
            cell.innerHTML = `
                <div class="sub-form" data-v="${esc(f.key)}">
                  <div class="sev-header">
                    <span></span><span>Severity</span><span>Input variable</span><span>Threshold (RFP wording)</span>
                    <span>From <span style="font-weight:400;text-transform:none;color:var(--text-muted);">excl.</span></span>
                    <span>To <span style="font-weight:400;text-transform:none;color:var(--text-muted);">incl.</span></span><span></span>
                  </div>
                  <div class="sev-body"></div>
                  <button type="button" class="small-btn" style="margin-top:6px;" onclick="window.__slaOnb._addSevRow(this)">+ Add severity row</button>
                  <div class="hint">Leave "From" or "To" blank for unbounded sides (e.g. "≤ 7 days" = leave From blank).</div>
                </div>`;
            _addSevRow(cell.querySelector("button"));
            _addSevRow(cell.querySelector("button"));
        }
        function _sevInputVarOptions(selected, excludeSevRow) {
            const used = new Set();
            const parent = excludeSevRow && excludeSevRow.parentElement;
            if (parent) {
                parent.querySelectorAll(".sev-row").forEach((r) => {
                    if (r === excludeSevRow) return;
                    const sel = r.querySelector('[data-k="input_variable"]');
                    if (sel && sel.value && sel.value !== "__custom__") used.add(sel.value);
                });
            }
            const opts = [`<option value="" ${!selected ? "selected" : ""}>— Primary measurement —</option>`];
            for (const v of INPUT_VARIABLES) {
                if (used.has(v.key) && v.key !== selected) continue;
                const lbl = `${v.label}${v.unit ? " (" + v.unit + ")" : ""}`;
                opts.push(`<option value="${esc(v.key)}" ${selected === v.key ? "selected" : ""}>${esc(lbl)}</option>`);
            }
            opts.push('<option value="__custom__">+ Type a new variable…</option>');
            if (selected && !INPUT_VARIABLES.find((v) => v.key === selected) && !used.has(selected)) {
                opts.splice(1, 0, `<option value="${esc(selected)}" selected>${esc(selected)} (custom)</option>`);
            }
            return opts.join("");
        }
        function _refreshSevDropdowns(hostEl) {
            hostEl.querySelectorAll(".sev-row").forEach((row) => {
                const sel = row.querySelector('[data-k="input_variable"]');
                if (!sel) return;
                const cur = sel.value;
                sel.innerHTML = _sevInputVarOptions(cur === "__custom__" ? "" : cur, row);
                if (cur && cur !== "__custom__") sel.value = cur;
            });
        }
        function _addSevRow(btn) {
            const hostEl = btn.closest(".sub-form");
            const body = hostEl.querySelector(".sev-body");
            const sev = 0;
            const r = document.createElement("div");
            r.className = "sev-row";
            r.innerHTML = `
                <span class="sev-pill" style="background:${_SEV_COLOUR[sev]};">L${sev}</span>
                <select data-k="severity" onchange="window.__slaOnb._updateSevPill(this)">${_severityOptions(sev)}</select>
                <select data-k="input_variable" onchange="window.__slaOnb._onSevInputVarChange(this)">${_sevInputVarOptions("", r)}</select>
                <input data-k="threshold_label" type="text" placeholder="e.g. ≤ 21 days">
                <input data-k="from_value" type="number" step="any" placeholder="—">
                <input data-k="to_value" type="number" step="any" placeholder="—">
                <button type="button" class="dyn-delete-btn" onclick="window.__slaOnb._deleteSevRow(this)">✕</button>`;
            body.appendChild(r);
            _refreshSevDropdowns(hostEl);
        }
        function _updateSevPill(sel) {
            const row = sel.closest(".sev-row");
            const pill = row.querySelector(".sev-pill");
            const v = Number(sel.value);
            pill.style.background = _SEV_COLOUR[v];
            pill.textContent = "L" + v;
        }
        function _onSevInputVarChange(sel) {
            if (sel.value === "__custom__") {
                const key = (window.prompt("New input variable (snake_case):") || "").trim();
                if (!key) { sel.value = ""; return _refreshSevDropdowns(sel.closest(".sub-form")); }
                const safe = key.toLowerCase().replace(/[^a-z0-9_]+/g, "_").replace(/^_+|_+$/g, "");
                if (!safe) { sel.value = ""; return _refreshSevDropdowns(sel.closest(".sub-form")); }
                if (!INPUT_VARIABLES.find((v) => v.key === safe)) INPUT_VARIABLES.push({ key: safe, label: safe, unit: null, source: "custom" });
                sel.value = safe;
            }
            return _refreshSevDropdowns(sel.closest(".sub-form"));
        }
        function _deleteSevRow(btn) {
            const hostEl = btn.closest(".sub-form");
            btn.parentElement.remove();
            _refreshSevDropdowns(hostEl);
        }

        /* ── linear LD escalation widget ── */
        function _widgetLinearForm(cell, f) {
            cell.innerHTML = `
                <div class="sub-form" data-v="${esc(f.key)}">
                  <div class="sub-grid" style="grid-template-columns:1fr 1fr 1fr;">
                    <div><label>Rate per unit (%) <span class="required">*</span></label>
                      <input type="number" step="0.01" data-k="rate_per_unit_percent" placeholder="0.5" oninput="window.__slaOnb._renderLinPreview(this)"></div>
                    <div><label>Unit</label>
                      <select data-k="unit" onchange="window.__slaOnb._renderLinPreview(this)">
                        <option value="week">week</option><option value="day">day</option><option value="month">month</option>
                      </select></div>
                    <div><label>Grace (units before LD starts)</label>
                      <input type="number" min="0" value="0" data-k="grace_units" oninput="window.__slaOnb._renderLinPreview(this)"></div>
                  </div>
                  <div class="lin-preview" data-k="preview">
                    <span style="color:var(--text-muted);font-style:italic;">Type a rate above to see the LD rule.</span>
                  </div>
                </div>`;
        }
        function _renderLinPreview(el) {
            const hostEl = el.closest(".sub-form");
            const rate = (hostEl.querySelector('[data-k="rate_per_unit_percent"]').value || "").trim();
            const unit = hostEl.querySelector('[data-k="unit"]').value;
            const grace = parseInt(hostEl.querySelector('[data-k="grace_units"]').value || "0", 10);
            const prev = hostEl.querySelector('[data-k="preview"]');
            if (!rate) { prev.innerHTML = '<span style="color:var(--text-muted);font-style:italic;">Type a rate above to see the LD rule.</span>'; return; }
            const graceLine = grace > 0 ? `<div style="color:var(--text-muted);font-size:11px;margin-top:4px;">First ${grace} ${unit}${grace === 1 ? "" : "s"} excluded as grace period.</div>` : "";
            prev.innerHTML = `
                <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;">
                  <span>If delayed by</span>
                  <code style="background:#fff7e6;padding:2px 6px;border-radius:5px;color:#b45309;">N</code>
                  <span>${esc(unit)}s →</span>
                  <span><strong style="color:var(--red);">LD = N × ${esc(rate)}% × base</strong></span>
                </div>${graceLine}`;
        }

        /* ── placeholder-table widget ── */
        function _widgetPlaceholderTable(cell, f) {
            cell.innerHTML = `
                <div class="sub-form" data-v="${esc(f.key)}">
                  <div class="ph-body"></div>
                  <button type="button" class="small-btn" style="margin-top:6px;" onclick="window.__slaOnb._addPhRow(this)">+ Add mapping input</button>
                  <div class="hint">Most SLAs need <strong>nothing</strong> here. Add a row only for per-attachment variables (deliverable cost, anchor date, etc.).</div>
                </div>`;
        }
        function _addPhRow(btn) {
            const hostEl = btn.closest(".sub-form");
            const body = hostEl.querySelector(".ph-body");
            const r = document.createElement("div");
            r.style.cssText = "display:grid;grid-template-columns:1fr 1.6fr 0.8fr 0.6fr auto;gap:6px;align-items:center;margin-bottom:5px;";
            r.innerHTML = `
                <input data-k="key" placeholder="t_anchor_date">
                <input data-k="label" placeholder="T0 — project go-live">
                <select data-k="type"><option value="text">text</option><option value="number">number</option><option value="date">date</option><option value="money">money</option></select>
                <select data-k="required"><option value="true">Yes</option><option value="false">No</option></select>
                <button type="button" class="dyn-delete-btn" onclick="this.parentElement.remove()">✕</button>`;
            body.appendChild(r);
        }

        /* ── file-picker widget ── */
        function _widgetFilePicker(cell, f) {
            cell.innerHTML = `
                <div class="sub-form" data-v="${esc(f.key)}">
                  <input type="file" data-k="files" accept="image/png,image/jpeg,image/webp,image/gif" multiple>
                  <div class="hint">Hold Shift/Ctrl to pick multiple. PNG/JPEG/WebP/GIF, 10 MB max each.</div>
                </div>`;
        }

        /* ── submit ── */
        async function submitSla() {
            _clearErrorState();
            const payload = _collectPayload();

            // ── Client-side validation → one toast per error, plus inline marks ──
            const errors = [];          // { label, message }
            const markIds = [];         // static field ids to outline red
            let tableErr = false;       // red-border the whole RFP table
            const presentKeys = new Set(
                Array.from(host.querySelectorAll("#dynBody .dyn-row")).map((r) => r.dataset.fieldKey).filter(Boolean)
            );
            RFP_FIELDS.filter((f) => f.required).forEach((f) => {
                const v = payload[f.key];
                const missing = v == null || v === "" || (Array.isArray(v) && v.length === 0);
                if (!missing) return;
                const staticId = STATIC_FIELD_IDS[f.key];
                if (staticId) { errors.push({ label: f.label, message: "This field is required." }); markIds.push(staticId); }
                else { errors.push({ label: f.label, message: presentKeys.has(f.key) ? "Fill in this required RFP row." : "Add this RFP row and fill it in." }); tableErr = true; }
            });
            if (!payload.target_rows && !payload.linear_escalation) {
                errors.push({ label: "Target / Applied Severity level", message: "Add a severity table or linear LD escalation." });
                markIds.push("s_target_container");
            }
            if (!editingId) {
                const stashed = window.__currentPayload__ && window.__currentPayload__.__files;
                if (!stashed || !stashed.length) { errors.push({ label: "Image attachment", message: "Upload an RFP image (add the 'Image attachments' row)." }); tableErr = true; }
            }
            if (errors.length) {
                markIds.forEach(_markField);
                if (tableErr) _flagTable();
                errors.forEach((e) => toast(e.label, e.message, "error"));
                return;
            }

            const url = editingId
                ? CONTRACTS_BASE + "/api/v3/sla-masters/" + editingId
                : CONTRACTS_BASE + "/api/v3/sla-masters/from-rfp";
            const method = editingId ? "PATCH" : "POST";
            /* /from-rfp (create) and PATCH /sla-masters/{id} (edit) speak
               DIFFERENT field names for the same four values. Everything above
               — validation, the RFP row widgets — works in the internal (edit)
               names, so translate once, here, only on the create path (#349). */
            const wire = editingId ? _toPatchPayload(payload) : _toFromRfpPayload(payload);
            // The file-picker widget stashes selected files on window.__currentPayload__
            // during _collectPayload() (they can't ride inside the JSON object).
            const files = (window.__currentPayload__ && window.__currentPayload__.__files) || [];
            try {
                let resp;
                if (files.length && !editingId) {
                    const fd = new FormData();
                    fd.append("payload", JSON.stringify(wire));
                    for (const f of files) fd.append("files", f);
                    resp = await authorizedFetch(url, { method, headers: { Accept: "application/json" }, body: fd });
                } else {
                    resp = await authorizedFetch(url, {
                        method, headers: { "Content-Type": "application/json", Accept: "application/json" },
                        body: JSON.stringify(wire),
                    });
                }
                if (!resp.ok) {
                    const t = await resp.text();
                    // Each server validation error becomes its own toast, with the
                    // matching field outlined (or the RFP table flagged) where known.
                    const serverErrors = _parseServerErrors(t, resp.status);
                    let flagTbl = false;
                    serverErrors.forEach((e) => { if (e.fieldId) _markField(e.fieldId); else if (e.table) flagTbl = true; });
                    if (flagTbl) _flagTable();
                    serverErrors.forEach((e) => toast(e.label, e.message, "error"));
                    return;
                }
                // PATCH can't carry files, so new attachments go up separately
                // (they were dropped on the floor before).
                if (files.length && editingId) {
                    const failed = await _uploadAttachments(editingId, files);
                    if (failed.length) toast("Attachments", `${failed.length} of ${files.length} image(s) failed to upload.`, "error");
                }
                toast("Saved", editingId ? "SLA updated." : "SLA onboarded.", "success");
                window.setTimeout(() => goBack(), 800);
            } catch (e) {
                toast("Network error", e.message, "error");
            }
        }

        /* PATCH /sla-masters/{id} takes SlaUpdateRequest — a narrower, partly
           differently-named field set than the create payload. Unknown keys are
           dropped server-side, so sending the raw form payload meant a category
           change never saved. Send only what the endpoint accepts. */
        function _toPatchPayload(payload) {
            const out = {};
            const copy = [
                "title", "description", "scope_text", "data_source", "calculation_method",
                "reports_submitted_to", "measurement_interval", "reporting_interval",
                "ld_computation_base", "effective_until", "project_id", "placeholders",
            ];
            copy.forEach((k) => { if (payload[k] !== undefined) out[k] = payload[k]; });
            // The record stores the category's display name, not its code.
            if (payload.category_code) {
                const cat = CATEGORIES.find((c) => c.code === payload.category_code);
                out.category = (cat && cat.display_name) || payload.category_code;
            }
            return out;
        }

        // POST /sla-masters/{id}/attachments — one multipart request per file.
        async function _uploadAttachments(id, files) {
            const failed = [];
            for (const f of files) {
                try {
                    const fd = new FormData();
                    fd.append("file", f);
                    const res = await authorizedFetch(`${CONTRACTS_BASE}/api/v3/sla-masters/${id}/attachments`, {
                        method: "POST", headers: { Accept: "application/json" }, body: fd,
                    });
                    if (!res.ok) failed.push(f.name);
                } catch { failed.push(f.name); }
            }
            return failed;
        }

        /* ── internal (edit) names → /from-rfp (create) names ──────────────
           The create endpoint silently ignores unknown keys, so sending the
           edit names saved nulls for these four fields. Mapping (#349):
             description        → definition
             calculation_method → calculation
             scope_text         → scope
             ld_computation_base→ applied_on
           `applied_on` is always sent explicitly: the backend defaults it to
           QUARTERLY_PAYMENT, which is wrong for Deliverable Submission (that
           category is penalised on the deliverable cost = FIXED_AMOUNT). */
        const _FROM_RFP_RENAMES = {
            description: "definition",
            calculation_method: "calculation",
            scope_text: "scope",
            ld_computation_base: "applied_on",
        };
        function _toFromRfpPayload(payload) {
            const out = {};
            Object.keys(payload).forEach((k) => {
                if (k.startsWith("__")) return;          // local stash keys never go on the wire
                out[_FROM_RFP_RENAMES[k] || k] = payload[k];
            });
            if (!out.applied_on) {
                out.applied_on = payload.category_code === "DELIVERABLE_SUBMISSION"
                    ? "FIXED_AMOUNT"
                    : "QUARTERLY_PAYMENT";
            }
            return out;
        }

        function _collectPayload() {
            // Reset the file stash so re-submits don't accumulate stale picks.
            window.__currentPayload__ = {};
            const payload = {};
            const slaRef = (host.querySelector("#s_sla_ref").value || "").trim();
            const title = (host.querySelector("#s_title").value || "").trim();
            const projId = (host.querySelector("#s_project_id").value || "").trim();
            const catCode = (host.querySelector("#s_category_code").value || "").trim();
            const desc = (host.querySelector("#s_description").value || "").trim();
            const calc = (host.querySelector("#s_calculation_method").value || "").trim();
            if (slaRef) payload.sla_ref = slaRef;
            if (title) payload.title = title;
            if (projId) payload.project_id = projId;
            if (catCode) payload.category_code = catCode;
            if (desc) payload.description = desc;
            if (calc) payload.calculation_method = calc;
            const targetHost = host.querySelector("#s_target_container");
            const cat = CATEGORIES.find((c) => c.code === catCode);
            const isLinear = cat ? cat.formula_type === "fixed_escalation" : (catCode === "Deliverable Submission" || catCode === "Query Resolution");
            if (targetHost) {
                const value = isLinear ? _collectLinearFromHost(targetHost) : _collectSeverityFromHost(targetHost);
                if (isLinear && value) payload.linear_escalation = value;
                else if (!isLinear && value) payload.target_rows = value;
            }
            host.querySelectorAll("#dynBody .dyn-row").forEach((row) => {
                const key = row.dataset.fieldKey;
                if (!key) return;
                const field = RFP_FIELDS.find((f) => f.key === key);
                if (!field) return;
                const v = _collectRowValue(row, field);
                if (v !== undefined) payload[key] = v;
            });
            return payload;
        }
        function _collectSeverityFromHost(hostEl) {
            const rows = [];
            hostEl.querySelectorAll(".sev-row").forEach((r) => {
                const o = {};
                r.querySelectorAll("[data-k]").forEach((el) => {
                    const v = (el.value || "").trim();
                    const k = el.dataset.k;
                    if (k === "severity") o.severity = Number(v);
                    else if (k === "threshold_label") o.threshold_label = v || null;
                    else if (k === "input_variable") o.input_variable = (v && v !== "__custom__") ? v : null;
                    else o[k] = v === "" ? null : Number(v);
                });
                if (o.threshold_label || o.from_value != null || o.to_value != null) rows.push(o);
            });
            return rows.length ? rows : undefined;
        }
        function _collectLinearFromHost(hostEl) {
            const obj = {};
            hostEl.querySelectorAll("[data-k]").forEach((el) => {
                const v = (el.value || "").trim();
                const k = el.dataset.k;
                if (k === "preview") return;
                if (k === "rate_per_unit_percent" && v) obj.rate_per_unit_percent = v;
                else if (k === "unit" && v) obj.unit = v;
                else if (k === "grace_units" && v !== "") obj.grace_units = Number(v);
            });
            if (obj.rate_per_unit_percent) { obj.max_units = 20; return obj; }
            return undefined;
        }
        function _collectRowValue(row, field) {
            const t = field.input_type;
            const cell = row.querySelector(".dyn-cell-value");
            if (["text", "textarea", "date"].includes(t)) {
                const el = cell.querySelector("[data-v]");
                return el ? (el.value || "").trim() || undefined : undefined;
            }
            if (t === "select" || t === "project_picker" || t === "category_picker") {
                const el = cell.querySelector("[data-v]");
                return el ? (el.value || undefined) : undefined;
            }
            if (t === "measurement_set") {
                const hostEl = cell.querySelector("[data-mv-host]");
                if (!hostEl) return undefined;
                const metricKey = (hostEl.querySelector(".mv-metric-key").value || "").trim();
                const displayName = (hostEl.querySelector(".mv-label").value || "").trim();
                if (!metricKey && !displayName) return undefined;
                const obj = { display_name: displayName, unit: (hostEl.querySelector(".mv-unit").value || "").trim() };
                if (metricKey) obj.metric_key = metricKey;
                const tgt = (hostEl.querySelector(".mv-target").value || "").trim();
                if (tgt) obj.target_value = tgt;
                return obj;
            }
            if (t === "severity_table") return _collectSeverityFromHost(cell);
            if (t === "linear_form") return _collectLinearFromHost(cell);
            if (t === "placeholder_table") {
                const rows = [];
                cell.querySelectorAll(".ph-body > div").forEach((r) => {
                    const o = {};
                    r.querySelectorAll("[data-k]").forEach((el) => {
                        const v = (el.value || "").trim();
                        if (el.dataset.k === "required") o.required = v === "true";
                        else if (v) o[el.dataset.k] = v;
                    });
                    if (o.key) rows.push(o);
                });
                return rows.length ? rows : undefined;
            }
            if (t === "file_picker") {
                const el = cell.querySelector('[data-k="files"]');
                const files = el && el.files ? Array.from(el.files) : [];
                if (files.length) {
                    const p = (window.__currentPayload__ = window.__currentPayload__ || {});
                    p.__files = (p.__files || []).concat(files);
                }
                return undefined;
            }
            return undefined;
        }

        /* ── edit-mode hydration ── */

        // The detail envelope is sometimes double-wrapped ({data:{_type,data:{…}}}).
        function _unwrapSla(body) {
            const lvl1 = (body && body.data) || body || {};
            return lvl1 && typeof lvl1.data === "object" && lvl1.data !== null ? lvl1.data : lvl1;
        }
        const _hasValue = (v) => v !== null && v !== undefined && v !== "" && !(Array.isArray(v) && v.length === 0);
        const _asDate = (v) => (v ? String(v).slice(0, 10) : null);

        /* Every RFP row the edit form can carry, in display order, paired with
           the response field(s) it reads. `always` rows render even when the
           record has no value so the form shows the SLA's full shape (the old
           code skipped every null, so most of the form simply wasn't there). */
        function _editRowPlan(d) {
            return [
                { key: "scope_text", value: d.scope_text ?? d.scope, always: true },
                { key: "data_source", value: d.data_source, always: true },
                { key: "monitoring_tool", value: d.monitoring_tool },
                { key: "data_capture_process", value: d.data_capture_process },
                { key: "ld_calculation", value: d.ld_calculation },
                { key: "assumptions", value: d.assumptions },
                { key: "reports_submitted_to", value: d.reports_submitted_to, always: true },
                { key: "metric_type", value: d.metric_type },
                { key: "measurement_interval", value: d.measurement_interval, always: true },
                { key: "reporting_interval", value: d.reporting_interval, always: true },
                { key: "ld_computation_base", value: d.ld_computation_base ?? d.applied_on, always: true },
                { key: "effective_from", value: _asDate(d.effective_from), always: true },
                { key: "effective_until", value: _asDate(d.effective_until), always: true },
                { key: "measurement", value: d.measurement, always: true },
                { key: "secondary_measurement", value: d.secondary_measurement },
                { key: "placeholders", value: d.placeholders },
                { key: "attachments", value: d.attachments, always: true },
            ];
        }

        async function loadSlaForEdit(id) {
            try {
                const r = await authorizedFetch(CONTRACTS_BASE + "/api/v3/sla-masters/" + id, { method: "GET", headers: { Accept: "application/json" } });
                if (!r.ok) { toast("Load failed", "HTTP " + r.status, "error"); return; }
                const d = _unwrapSla(await r.json());
                host.querySelector("#dynBody").innerHTML = "";

                /* ── static identification block ── */
                const setStatic = (elId, v) => { const el = host.querySelector("#" + elId); if (el) el.value = v == null ? "" : v; };
                setStatic("s_sla_ref", d.sla_ref);
                /* Prefer the stored contract_type when the SLA already has
                   one; otherwise fall back to the prefix derivation so the
                   row isn't blank on an older record. */
                const ctEl = host.querySelector("#s_contract_type");
                if (ctEl && d.contract_type) ctEl.value = d.contract_type;
                else _syncContractType();
                setStatic("s_title", d.title || d.name);
                setStatic("s_description", d.description || d.definition);
                setStatic("s_calculation_method", d.calculation_method || d.calculation);
                _setSelect(host.querySelector("#s_project_id"), d.project_id, " (not in project list)");

                const catSel = host.querySelector("#s_category_code");
                _setSelect(catSel, _resolveCategoryCode(d.category_code || d.category));
                // Renders the Target widget for the resolved category. Must run
                // BEFORE the target hydration below — the old code hydrated on a
                // setTimeout hop that fired against an empty container.
                _onStaticCategoryChange();
                _hydrateTarget(host.querySelector("#s_target_container"), d);

                /* ── dynamic RFP rows ── */
                _editRowPlan(d).forEach(({ key, value, always }) => {
                    if (!RFP_FIELDS.some((f) => f.key === key)) return;   // not in this catalog
                    const has = _hasValue(value);
                    if (!has && !always) return;
                    // addRow() renders the widget synchronously, so hydrate inline.
                    addRow(key);
                    if (has) { _hydrateRow(key, value); return; }
                    /* An `always` row with nothing stored must stay empty — a
                       <select> would otherwise show its catalog default and
                       PATCH that over the record's null. */
                    const sel = host.querySelector(`#dynBody .dyn-row[data-field-key="${key}"] select[data-v]`);
                    if (sel) { sel.insertAdjacentHTML("afterbegin", '<option value="" selected>— Not set —</option>'); sel.value = ""; }
                });

                _lockUnpatchableFields();
                _snapshotDefaults();
            } catch (e) {
                toast("Network error", e.message, "error");
            }
        }

        // Fill the Target widget from whichever shape the record actually
        // stores, re-rendering the widget if the category picked the other one.
        function _hydrateTarget(container, d) {
            if (!container) return;
            const rows = Array.isArray(d.target_rows) && d.target_rows.length ? d.target_rows
                : (Array.isArray(d.bands) && d.bands.length ? d.bands : null);
            const lin = d.linear_escalation;
            if (!rows && !lin) return;   // nothing stored — keep the category's default widget

            if (rows) {
                if (!container.querySelector(".sev-body")) _widgetSeverityTable(container, { key: "target_rows" });
                const form = container.querySelector(".sub-form");
                const body = container.querySelector(".sev-body");
                const addBtn = form.querySelector(":scope > button");
                body.innerHTML = "";
                rows.forEach((tr) => {
                    _addSevRow(addBtn);
                    const sevRow = body.lastElementChild;
                    const sevSel = sevRow.querySelector('[data-k="severity"]');
                    const sev = Number(tr.severity ?? 0);
                    // Regenerate so a severity above the default 0–9 range exists.
                    sevSel.innerHTML = _severityOptions(sev);
                    sevSel.value = String(sev);
                    _updateSevPill(sevSel);
                    // The input variable may not be in the catalog — rebuild the
                    // options with it selected so it can't blank itself out.
                    const ivSel = sevRow.querySelector('[data-k="input_variable"]');
                    if (tr.input_variable && ivSel) {
                        ivSel.innerHTML = _sevInputVarOptions(tr.input_variable, sevRow);
                        ivSel.value = tr.input_variable;
                    }
                    sevRow.querySelector('[data-k="threshold_label"]').value = tr.threshold_label ?? "";
                    if (tr.from_value != null) sevRow.querySelector('[data-k="from_value"]').value = tr.from_value;
                    if (tr.to_value != null) sevRow.querySelector('[data-k="to_value"]').value = tr.to_value;
                });
                return;
            }

            if (!container.querySelector('[data-k="rate_per_unit_percent"]')) _widgetLinearForm(container, { key: "linear_escalation" });
            const rate = container.querySelector('[data-k="rate_per_unit_percent"]');
            if (lin.rate_per_unit_percent != null && rate) rate.value = lin.rate_per_unit_percent;
            if (lin.unit) _setSelect(container.querySelector('[data-k="unit"]'), lin.unit);
            const grace = container.querySelector('[data-k="grace_units"]');
            if (lin.grace_units != null && grace) grace.value = lin.grace_units;
            if (rate) _renderLinPreview(rate);
        }

        /* PATCH /sla-masters/{id} accepts a narrow field set (SlaUpdateRequest):
           title, description, category, scope_text, data_source,
           calculation_method, reports_submitted_to, measurement_interval,
           reporting_interval, ld_computation_base, effective_until, project_id,
           placeholders, status. Everything else is silently dropped, so leaving
           those fields editable on an edit means changes vanish on save. Show
           them (they're part of the SLA) but lock them. */
        const _PATCHABLE_KEYS = new Set([
            "title", "description", "category_code", "scope_text", "data_source",
            "calculation_method", "reports_submitted_to", "measurement_interval",
            "reporting_interval", "ld_computation_base", "effective_until",
            "project_id", "placeholders",
        ]);
        const _LOCK_NOTE = "Set at onboarding — this field can't be changed from the edit form.";
        function _lockCell(cell, note) {
            if (!cell || cell.dataset.locked) return;
            cell.dataset.locked = "1";
            cell.querySelectorAll("input, textarea, select, button").forEach((el) => { el.disabled = true; });
            cell.style.opacity = ".72";
            cell.insertAdjacentHTML("beforeend", `<div class="hint" style="color:var(--amber);font-weight:600;">🔒 ${esc(note || _LOCK_NOTE)}</div>`);
        }
        function _lockUnpatchableFields() {
            ["s_sla_ref"].forEach((elId) => {
                const el = host.querySelector("#" + elId);
                if (el) { el.readOnly = true; el.style.background = "#f8fafc"; }
            });
            _lockCell(host.querySelector("#s_target_container").parentElement,
                "Target / severity bands are fixed at onboarding — re-onboard the SLA to change them.");
            host.querySelectorAll("#dynBody .dyn-row").forEach((row) => {
                const key = row.dataset.fieldKey;
                if (!key || _PATCHABLE_KEYS.has(key) || key === "attachments") return;
                _lockCell(row.querySelector(".dyn-cell-value"));
                const sel = row.querySelector(".field-type-select");
                if (sel) sel.disabled = true;
                const del = row.querySelector(".dyn-delete-btn");
                if (del) del.disabled = true;
            });
        }

        function _snapshotDefaults() { _formBaseline = _formSnapshot(); }

        /* Existing attachments — rendered above the file input in edit mode.
           Fetched as authorized blobs (the store URLs are token-protected),
           falling back to a direct <img src> for public URLs. */
        function _renderExistingAttachments(cell, list) {
            const form = cell.querySelector(".sub-form");
            if (!form) return;
            const wrap = document.createElement("div");
            wrap.style.cssText = "display:flex;flex-wrap:wrap;gap:10px;margin-bottom:10px;";
            list.forEach((a) => {
                const url = a && (a.file_url || a.url || a.href || a.download_url);
                if (!url) return;
                const fig = document.createElement("a");
                fig.href = url; fig.target = "_blank"; fig.rel = "noreferrer";
                fig.title = a.original_filename || "attachment";
                fig.style.cssText = "display:block;border:1px solid var(--border-soft);border-radius:8px;padding:6px;background:#fff;text-decoration:none;color:var(--text-muted);font-size:11px;max-width:170px;";
                fig.innerHTML = `<div style="width:156px;height:104px;border-radius:5px;background:#f1f5f9;display:flex;align-items:center;justify-content:center;overflow:hidden;">…</div>
                    <div style="margin-top:5px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${esc(a.original_filename || "attachment")}</div>`;
                const box = fig.firstElementChild;
                (async () => {
                    let src = url;
                    try {
                        const res = await authorizedFetch(url, { method: "GET" });
                        if (!res.ok) throw new Error("HTTP " + res.status);
                        const objUrl = URL.createObjectURL(await res.blob());
                        OBJECT_URLS.push(objUrl);
                        src = objUrl;
                    } catch { /* fall through to the direct URL */ }
                    box.innerHTML = `<img src="${esc(src)}" alt="" style="max-width:100%;max-height:100%;object-fit:contain;">`;
                    fig.href = src;
                })();
                wrap.appendChild(fig);
            });
            if (!wrap.childElementCount) return;
            form.insertAdjacentHTML("afterbegin", '<label style="display:block;margin-bottom:6px;">Already uploaded</label>');
            form.insertBefore(wrap, form.children[1]);
        }
        function _hydrateRow(key, value) {
            const row = Array.from(host.querySelectorAll("#dynBody .dyn-row")).find((r) => r.dataset.fieldKey === key);
            if (!row) return;
            const cell = row.querySelector(".dyn-cell-value");
            const field = RFP_FIELDS.find((f) => f.key === key);
            if (!field) return;
            const t = field.input_type;
            if (["text", "textarea", "date"].includes(t)) {
                const el = cell.querySelector("[data-v]");
                if (el) el.value = value || "";
                return;
            }
            if (t === "select" || t === "project_picker") {
                _setSelect(cell.querySelector("[data-v]"), value);
                return;
            }
            if (t === "category_picker") {
                _setSelect(cell.querySelector("[data-v]"), _resolveCategoryCode(value));
                return;
            }
            if (t === "file_picker") {
                if (Array.isArray(value) && value.length) _renderExistingAttachments(cell, value);
                return;
            }
            if (t === "measurement_set") {
                const hostEl = cell.querySelector("[data-mv-host]");
                if (!hostEl) return;
                const wantKey = value.metric_key
                    || (INPUT_VARIABLES.find((v) => v.label === value.display_name) || {}).key
                    || (value.display_name || "").toLowerCase().replace(/[^a-z0-9_]+/g, "_").replace(/^_+|_+$/g, "");
                const sel = hostEl.querySelector(".mv-picker");
                sel.innerHTML = _measurementOptions(wantKey);
                sel.value = wantKey;
                _onMeasurementPick(sel);
                if (value.display_name) hostEl.querySelector(".mv-label").value = value.display_name;
                if (value.unit) hostEl.querySelector(".mv-unit").value = value.unit;
                if (value.target_value != null) hostEl.querySelector(".mv-target").value = value.target_value;
                return;
            }
            if (t === "placeholder_table") {
                cell.querySelector(".ph-body").innerHTML = "";
                const addBtn = cell.querySelector("button");
                value.forEach((p) => {
                    _addPhRow(addBtn);
                    const phRow = cell.querySelector(".ph-body").lastChild;
                    phRow.querySelector('[data-k="key"]').value = p.key || "";
                    phRow.querySelector('[data-k="label"]').value = p.label || "";
                    phRow.querySelector('[data-k="type"]').value = p.type || "text";
                    phRow.querySelector('[data-k="required"]').value = p.required ? "true" : "false";
                });
            }
        }

        /* ── helpers ── */
        function esc(s) {
            return String(s == null ? "" : s)
                .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
                .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
        }
        // Each call adds a separate card to the top-right stack (errors stay
        // longer and carry a data-err flag so a re-submit can clear stale ones).
        function toast(title, msg, kind) {
            const stack = host.querySelector("#toastStack");
            if (!stack) return;
            const el = document.createElement("div");
            el.className = "toast " + (kind || "");
            if (kind === "error") el.setAttribute("data-err", "1");
            el.innerHTML =
                `<button type="button" class="toast-close" onclick="this.parentElement.remove()">✕</button>` +
                `<div class="toast-title">${esc(title)}</div>` +
                (msg ? `<div class="toast-msg">${esc(msg)}</div>` : "");
            stack.appendChild(el);
            window.setTimeout(() => { el.remove(); }, kind === "error" ? 9000 : 3800);
        }
        // Clear inline validation marks + any lingering error toasts before re-validating.
        function _clearErrorState() {
            host.querySelectorAll(".field-error").forEach((el) => el.classList.remove("field-error"));
            const tbl = host.querySelector("#dynTable");
            if (tbl) tbl.classList.remove("table-error");
            host.querySelectorAll("#toastStack [data-err]").forEach((el) => el.remove());
        }
        function _markField(id) {
            if (!id) return;
            const el = host.querySelector("#" + id);
            if (el) el.classList.add("field-error");
        }
        function _flagTable() {
            const tbl = host.querySelector("#dynTable");
            if (tbl) tbl.classList.add("table-error");
        }
        function _prettyKey(k) {
            return String(k).replace(/[._-]+/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
        }
        // Map a payload/loc key → the static field element id to mark red.
        const STATIC_FIELD_IDS = {
            sla_ref: "s_sla_ref", title: "s_title", project_id: "s_project_id",
            category_code: "s_category_code", description: "s_description",
            calculation_method: "s_calculation_method",
            target_rows: "s_target_container", linear_escalation: "s_target_container",
            condition_bands: "s_target_container", lookup_table: "s_target_container",
        };
        // Turn a server error body into a list of {label, message, fieldId?, table?}.
        function _parseServerErrors(text, status) {
            let data = null;
            try { data = JSON.parse(text); } catch { /* not JSON */ }
            const out = [];
            const pushLoc = (loc, msg) => {
                const key = String(loc).split(".").pop();
                const fieldId = STATIC_FIELD_IDS[key];
                const label = (RFP_FIELDS.find((f) => f.key === key) || {}).label || _prettyKey(loc || "Error");
                out.push({ label, message: msg, fieldId, table: !fieldId });
            };
            // FastAPI-style arrays (detail[] or error._embedded.details.errors[]).
            const arr = (Array.isArray(data?.detail) && data.detail) ||
                (Array.isArray(data?.error?._embedded?.details?.errors) && data.error._embedded.details.errors) || null;
            if (arr) {
                arr.forEach((it) => {
                    const loc = Array.isArray(it.loc) ? it.loc.filter((p) => p !== "body").join(".") : (it.loc || "");
                    pushLoc(loc, it.msg || "Invalid value");
                });
            }
            // error.message may embed a pydantic repr list, or be a single message.
            const msg = data?.error?.message || data?.message;
            if (!out.length && typeof msg === "string") {
                const re = /'loc':\s*\(([^)]*)\)\s*,\s*'msg':\s*'([^']*)'/g;
                let m; let any = false;
                while ((m = re.exec(msg)) !== null) {
                    any = true;
                    const loc = m[1].replace(/['"\s]/g, "").split(",").filter(Boolean).filter((p) => p !== "body").join(".");
                    pushLoc(loc, m[2]);
                }
                if (!any) {
                    const low = msg.toLowerCase();
                    const targetish = /condition_band|lookup|target|severity|escalation/.test(low);
                    out.push({
                        label: data?.error?.errorIdentifier ? _prettyKey(data.error.errorIdentifier) : "Server error",
                        message: msg,
                        fieldId: targetish ? "s_target_container" : null,
                        table: false,
                    });
                }
            }
            if (!out.length) out.push({ label: "Save failed", message: (typeof text === "string" && text.slice(0, 300)) || `HTTP ${status}` });
            return out;
        }

        /* ── expose handler-referenced functions for the inline DOM events ── */
        window.__slaOnb = {
            boot, _onStaticCategoryChange, _syncContractType, useTemplate, cancelOnboarding, submitSla,
            addRow, _onFieldTypeChange, _deleteRow, _onMeasurementPick, _confirmNewMeasurement, _cancelNewMeasurement,
            _addSevRow, _updateSevPill, _onSevInputVarChange, _deleteSevRow, _renderLinPreview, _addPhRow,
        };

        /* ── render + boot ── */
        host.innerHTML = BODY_HTML;
        boot();

        return () => {
            try { document.head.removeChild(styleEl); } catch { /* already gone */ }
            if (scroller) scroller.style.paddingBottom = prevPadBottom;
            OBJECT_URLS.forEach((u) => { try { URL.revokeObjectURL(u); } catch { /* already revoked */ } });
            delete window.__slaOnb;
            delete window.__currentPayload__;
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    return <div ref={hostRef} className="sla-onb-root" />;
}
