/* ══════════════════════════════════════════════════════════════════
   SlaAiReviewForm.jsx — review ONE AI-extracted SLA before creating it.

   ⚠ DELIBERATE DUPLICATE. This is a copy of the manual builder in
   ../SlaOnboardingPage.jsx, adapted for the AI flow. The two are kept
   independent ON PURPOSE so nothing here can affect manual onboarding —
   a fix made in one will NOT reach the other. If you change a widget
   here, check whether the manual page wants the same change.

   Differences from the manual page:
     • hydrates from a record passed in as a prop, never from GET /{id}
     • catalogs arrive pre-loaded from the parent (11 SLAs would
       otherwise re-fetch four endpoints 44 times)
     • no edit mode — this form only ever creates
     • the project is fixed to the one picked at upload and locked
     • the source PDF is attached automatically; no image picker
     • fields the parser was unsure about are flagged amber
     • the action bar drives a wizard: Previous / Onboard & Next

   POST /api/v3/sla-masters/from-rfp   (multipart: payload JSON + the PDF)
   ══════════════════════════════════════════════════════════════════ */

import React, { useEffect, useRef } from "react";
import { authorizedFetch } from "../../../api/client";
import { clampMetricKey } from "./aiSlaNormalize";

const CONTRACTS_BASE = "http://10.1.131.199/contracts";

/* ─── Scoped stylesheet. Prefixed `.sla-ai-onb-root` — a different root
   class from the manual page's `.sla-onb-root`, so the two stylesheets
   can never collide even if both were somehow mounted at once. ─── */
const STYLE = `
.sla-ai-onb-root{--navy:#0b3c88;--navy-deep:#173e77;--cyan:#0aa1c0;
  --bg:#f4f7fb;--bg-card:#ffffff;
  --text:#1e2a3a;--text-soft:#41506a;--text-muted:#6b7a90;
  --border-soft:#dbe5f1;--border-medium:#dbe5f1;
  --red:#d32f2f;--green:#1a7f37;--amber:#d97706;
  --brand-grad:linear-gradient(90deg,var(--navy),var(--cyan));
  --ring:0 0 0 3px rgba(11,60,136,.12);
  --card-shadow:0 4px 12px rgba(0,0,0,.08);
  font-family:Inter,system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;
  background:var(--bg);color:var(--text);font-size:13px;}
.sla-ai-onb-root *{box-sizing:border-box;}

.sla-ai-onb-root .page-header{position:relative;background:#fff;border:1px solid var(--border-soft);border-radius:12px;
  padding:18px 20px;margin-bottom:18px;box-shadow:var(--card-shadow);overflow:hidden;}
.sla-ai-onb-root .page-header::before{content:"";position:absolute;top:0;left:0;right:0;height:4px;background:var(--brand-grad);}
.sla-ai-onb-root .page-title{font-size:22px;font-weight:800;color:var(--navy-deep);margin:0;line-height:1.3;}
.sla-ai-onb-root .page-sub{font-size:12px;color:var(--text-muted);margin-top:3px;line-height:1.6;}
.sla-ai-onb-root .progress-pill{display:inline-flex;align-items:center;gap:6px;padding:5px 12px;border-radius:99px;
  background:#eef7fb;border:1px solid var(--cyan);color:var(--navy-deep);font-size:12px;font-weight:800;white-space:nowrap;}

.sla-ai-onb-root main{padding:0;}

.sla-ai-onb-root .dyn-table-wrap{background:#fff;border:1px solid var(--border-soft);border-radius:12px;
  overflow:hidden;box-shadow:var(--card-shadow);}
.sla-ai-onb-root .dyn-table-head{display:grid;grid-template-columns:340px 1fr auto;gap:0;align-items:center;
  background:linear-gradient(90deg,#f1f6fd 0%,#eaf2fb 100%);
  padding:13px 16px;border-bottom:1px solid var(--border-soft);
  font-size:12px;font-weight:800;color:var(--navy-deep);text-transform:uppercase;letter-spacing:.3px;}
.sla-ai-onb-root .dyn-row{display:grid;grid-template-columns:340px 1fr auto;gap:0;align-items:stretch;
  border-bottom:1px solid var(--border-soft);}
.sla-ai-onb-root .dyn-row:last-child{border-bottom:none;}
.sla-ai-onb-root .dyn-row:hover{background:#f9fcff;}
.sla-ai-onb-root .dyn-row > .dyn-cell-label{background:#f7fafd;padding:13px 14px;border-right:1px solid var(--border-soft);}
.sla-ai-onb-root .dyn-row > .dyn-cell-value{padding:11px 14px;}
.sla-ai-onb-root .dyn-row > .dyn-cell-delete{padding:11px 12px 11px 6px;display:flex;align-items:flex-start;}

.sla-ai-onb-root .dyn-cell-label select{width:100%;padding:9px 10px;font-size:13px;font-weight:600;
  color:var(--navy-deep);border:1px solid var(--border-soft);border-radius:6px;background:#fff;cursor:pointer;}
.sla-ai-onb-root .dyn-cell-label select:focus{outline:none;border-color:var(--navy);box-shadow:var(--ring);}
.sla-ai-onb-root .dyn-cell-label .field-help{font-size:11px;color:var(--text-muted);margin-top:4px;line-height:1.4;}

.sla-ai-onb-root .dyn-cell-value input[type=text],
.sla-ai-onb-root .dyn-cell-value input[type=number],
.sla-ai-onb-root .dyn-cell-value input[type=date],
.sla-ai-onb-root .dyn-cell-value textarea,
.sla-ai-onb-root .dyn-cell-value select{
  width:100%;box-sizing:border-box;font-size:13px;padding:9px 10px;color:var(--text);
  border:1px solid var(--border-soft);border-radius:6px;background:#fff;font-family:inherit;}
.sla-ai-onb-root .dyn-cell-value input::placeholder,
.sla-ai-onb-root .dyn-cell-value textarea::placeholder{color:#9aa7ba;}
.sla-ai-onb-root .dyn-cell-value input:focus,
.sla-ai-onb-root .dyn-cell-value textarea:focus,
.sla-ai-onb-root .dyn-cell-value select:focus{outline:none;border-color:var(--navy);box-shadow:var(--ring);}
.sla-ai-onb-root .dyn-cell-value textarea{min-height:60px;resize:vertical;}

.sla-ai-onb-root .dyn-cell-empty{color:var(--text-muted);font-style:italic;font-size:12px;}

.sla-ai-onb-root .dyn-delete-btn{width:30px;height:30px;border-radius:6px;background:#fff;color:var(--red);
  border:1px solid var(--red);cursor:pointer;font-size:14px;font-weight:700;transition:all .15s;}
.sla-ai-onb-root .dyn-delete-btn:hover{background:var(--red);color:#fff;}

.sla-ai-onb-root .add-row{padding:14px 16px;background:#f7fafd;text-align:center;border-top:1px solid var(--border-soft);}
.sla-ai-onb-root .add-row-btn{background:var(--brand-grad);color:#fff;border:none;border-radius:6px;
  padding:10px 22px;font-size:13px;font-weight:700;cursor:pointer;transition:filter .15s;}
.sla-ai-onb-root .add-row-btn:hover{filter:brightness(1.05);}
.sla-ai-onb-root .add-row-btn:disabled{background:#cbd5e1;cursor:not-allowed;filter:none;}

.sla-ai-onb-root .action-bar{position:sticky;bottom:0;background:rgba(255,255,255,.92);backdrop-filter:blur(6px);
  border-top:1px solid var(--border-soft);margin-top:18px;padding:14px 0;display:flex;justify-content:space-between;
  align-items:center;gap:10px;z-index:10;}
.sla-ai-onb-root .btn{padding:10px 20px;border-radius:6px;font-size:13px;font-weight:700;border:none;cursor:pointer;font-family:inherit;transition:filter .15s,background .15s;}
.sla-ai-onb-root .btn:disabled{opacity:.55;cursor:not-allowed;}
.sla-ai-onb-root .btn.primary{background:var(--brand-grad);color:#fff;}
.sla-ai-onb-root .btn.primary:hover:not(:disabled){filter:brightness(1.05);}
.sla-ai-onb-root .btn.cancel{background:#fff;color:var(--navy-deep);border:1px solid var(--border-soft);}
.sla-ai-onb-root .btn.cancel:hover:not(:disabled){background:#f1f6fd;}

.sla-ai-onb-root .sub-form{padding:8px 0;}
.sla-ai-onb-root .sub-form .sub-grid{display:grid;gap:8px;}
.sla-ai-onb-root .sub-form label{font-size:11px;color:var(--text-muted);margin-bottom:3px;display:block;}

.sla-ai-onb-root .sev-header{display:grid;grid-template-columns:auto 0.9fr 1.6fr 1.6fr 0.8fr 0.8fr auto;
  gap:8px;align-items:center;padding:7px 8px;background:#f1f6fd;border-radius:6px;
  font-size:11px;font-weight:700;color:var(--navy-deep);text-transform:uppercase;letter-spacing:.3px;margin-bottom:4px;}
.sla-ai-onb-root .sev-row{display:grid;grid-template-columns:auto 0.9fr 1.6fr 1.6fr 0.8fr 0.8fr auto;
  gap:8px;align-items:center;margin-bottom:6px;}
.sla-ai-onb-root .sev-pill{display:inline-flex;align-items:center;justify-content:center;
  min-width:34px;height:26px;padding:0 8px;border-radius:99px;color:#fff;font-size:11px;font-weight:700;letter-spacing:.3px;}
.sla-ai-onb-root .sub-form .small-btn{padding:5px 12px;font-size:11px;border:1px solid var(--border-soft);
  background:#fff;color:var(--navy-deep);border-radius:6px;cursor:pointer;font-weight:600;transition:background .15s;}
.sla-ai-onb-root .sub-form .small-btn:hover{background:#f1f6fd;}

.sla-ai-onb-root .toast-stack{position:fixed;top:20px;right:20px;z-index:2000;display:flex;flex-direction:column;gap:10px;
  width:340px;max-width:90vw;max-height:calc(100vh - 40px);overflow-y:auto;}
.sla-ai-onb-root .toast{position:relative;background:#fff;border-left:4px solid var(--cyan);
  padding:12px 30px 12px 14px;border-radius:8px;box-shadow:0 10px 30px rgba(0,0,0,.15);}
.sla-ai-onb-root .toast.success{border-left-color:var(--green);}
.sla-ai-onb-root .toast.error{border-left-color:var(--red);}
.sla-ai-onb-root .toast-title{font-weight:800;font-size:13px;margin-bottom:3px;color:var(--navy-deep);}
.sla-ai-onb-root .toast-msg{font-size:12px;color:var(--text-soft);line-height:1.45;}
.sla-ai-onb-root .toast-close{position:absolute;top:7px;right:9px;border:none;background:none;cursor:pointer;
  color:#9aa7ba;font-weight:700;font-size:14px;line-height:1;padding:2px;}
.sla-ai-onb-root .toast-close:hover{color:var(--red);}

.sla-ai-onb-root .required{color:var(--red);}
.sla-ai-onb-root .hint{font-size:11px;color:var(--text-muted);margin-top:4px;line-height:1.4;}

.sla-ai-onb-root .lin-preview{margin-top:10px;padding:10px 12px;border-radius:8px;
  border:1px dashed var(--cyan);background:#eef7fb;font-size:13px;color:var(--navy-deep);}

.sla-ai-onb-root .field-error,
.sla-ai-onb-root .field-error:focus{border:1px solid var(--red) !important;box-shadow:0 0 0 3px rgba(211,47,47,.14) !important;}
.sla-ai-onb-root #s_target_container.field-error{border-radius:8px;padding:6px;}
.sla-ai-onb-root .table-error{outline:2px solid var(--red);outline-offset:2px;}

/* AI-specific: pick the target shape independently of the category. */
.sla-ai-onb-root .target-mode{display:flex;align-items:center;gap:6px;margin-bottom:10px;flex-wrap:wrap;}
.sla-ai-onb-root .target-mode-label{font-size:11px;color:var(--text-muted);text-transform:uppercase;
  letter-spacing:.3px;font-weight:700;margin-right:2px;}
.sla-ai-onb-root .target-mode-btn{padding:5px 12px;font-size:11px;font-weight:700;border-radius:99px;cursor:pointer;
  border:1px solid var(--border-soft);background:#fff;color:var(--text-muted);transition:all .15s;}
.sla-ai-onb-root .target-mode-btn:hover{border-color:var(--navy);color:var(--navy);}
.sla-ai-onb-root .target-mode-btn.active{background:var(--navy);border-color:var(--navy);color:#fff;}

/* AI-specific: fields the parser wasn't confident about. */
.sla-ai-onb-root .ai-warn-note{margin-top:6px;padding:7px 10px;border-radius:6px;background:#fffbeb;
  border:1px solid #fcd34d;color:#92400e;font-size:11px;line-height:1.5;font-weight:600;}
.sla-ai-onb-root .ai-warn-note::before{content:"⚠ ";}
.sla-ai-onb-root .ai-warn-banner{margin-bottom:14px;padding:11px 14px;border-radius:8px;background:#fffbeb;
  border:1px solid #fcd34d;color:#92400e;font-size:12px;line-height:1.6;}
.sla-ai-onb-root .locked-note{font-size:11px;color:var(--amber);font-weight:600;margin-top:4px;}
`;

const BODY_HTML = `
<div class="page-header">
  <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:16px;flex-wrap:wrap;">
    <div>
      <h1 class="page-title" id="pageTitle">Review SLA</h1>
      <div class="page-sub" id="pageSub">Read from the uploaded document. Correct anything the parser got wrong, then onboard.</div>
    </div>
    <div class="progress-pill" id="progressPill"></div>
  </div>
</div>

<main>
  <div id="warnBanner"></div>

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
        <div class="field-help">RFP table header. Capitals only — A–Z, 0–9, - and _. e.g. PMU-SLA001.</div>
      </div>
      <div class="dyn-cell-value"><input id="s_sla_ref" type="text" placeholder="PMU-SLA001" oninput="window.__slaAiOnb._syncContractType()"></div>
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
        <div class="field-help">Fixed to the project you picked when uploading the document.</div>
      </div>
      <div class="dyn-cell-value">
        <select id="s_project_id" disabled style="background:#f8fafc;"><option value="">— Select a project —</option></select>
        <div class="locked-note">🔒 Set at upload — go back to change it.</div>
      </div>
      <div class="dyn-cell-delete"></div>
    </div>
    <div class="dyn-row">
      <div class="dyn-cell-label" style="display:flex;flex-direction:column;justify-content:center;">
        <div style="font-weight:600;color:var(--navy);font-size:13px;">SLA Category <span class="required">*</span></div>
        <div class="field-help">Picks the calculation engine. Also chooses whether Target below is a severity table or a linear LD form</div>
      </div>
      <div class="dyn-cell-value">
        <select id="s_category_code" onchange="window.__slaAiOnb._onStaticCategoryChange()"><option value="">— Select —</option></select>
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
        <!-- The parser often returns the wrong target SHAPE for the category it
             also returned (severity bands on a linear-LD category, and the
             reverse). Switching category to fix the widget would corrupt the
             category, so the shape is selectable on its own. -->
        <div class="target-mode" id="s_target_mode">
          <span class="target-mode-label">Target type</span>
          <button type="button" class="target-mode-btn" data-mode="severity" onclick="window.__slaAiOnb._setTargetMode('severity')">Severity table</button>
          <button type="button" class="target-mode-btn" data-mode="linear" onclick="window.__slaAiOnb._setTargetMode('linear')">Linear LD escalation</button>
        </div>
        <div id="s_target_container">
          <div class="dyn-cell-empty">Waiting for category selection above…</div>
        </div>
      </div>
      <div class="dyn-cell-delete"></div>
    </div>
  </div>

  <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">
    <div>
      <h2 style="font-size:14px;font-weight:800;color:var(--navy);margin:0;">RFP rows read from the document</h2>
      <div style="font-size:11px;color:var(--text-muted);margin-top:2px;">
        Everything the parser found is listed below. Edit any value, or use <strong>+ Add row</strong> for a field it missed.
      </div>
    </div>
  </div>

  <div class="dyn-table-wrap" id="dynTable">
    <div class="dyn-table-head">
      <div>RFP Row Type</div>
      <div>Value</div>
      <div style="width:36px;"></div>
    </div>
    <div id="dynBody"></div>
    <div class="add-row">
      <button class="add-row-btn" id="addRowBtn" onclick="window.__slaAiOnb.addRow()">+ Add row</button>
    </div>
  </div>
</main>

<div class="action-bar" id="actionBar">
  <button class="btn cancel" id="prevBtn" onclick="window.__slaAiOnb.goPrev()">← Previous</button>
  <div style="display:flex;gap:10px;align-items:center;">
    <button class="btn cancel" onclick="window.__slaAiOnb.exitReview()">Exit review</button>
    <button class="btn primary" id="submitBtn" onclick="window.__slaAiOnb.submitSla()">Onboard &amp; Next</button>
  </div>
</div>

<div class="toast-stack" id="toastStack"></div>
`;

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
    { key: "effective_from", label: "Active From", section: "Cadence", input_type: "date", required: true },
    { key: "effective_until", label: "Active Until", section: "Cadence", input_type: "date" },
    { key: "measurement", label: "What is measured (primary)", section: "Measurement", input_type: "measurement_set", required: true },
    { key: "secondary_measurement", label: "What is measured (secondary)", section: "Measurement", input_type: "measurement_set" },
    { key: "target_rows", label: "Target / Applied Severity level", section: "Target", input_type: "severity_table" },
    { key: "linear_escalation", label: "Linear LD escalation", section: "Target", input_type: "linear_form" },
    { key: "placeholders", label: "Mapping inputs (filled at attach time)", section: "Mapping", input_type: "placeholder_table" },
    { key: "data_capture_process", label: "Process to capture raw data for SLA calculations", section: "Source & Calculation", input_type: "textarea" },
    { key: "monitoring_tool", label: "Tool used for SLA monitoring", section: "Source & Calculation", input_type: "text" },
    { key: "ld_calculation", label: "LD calculation (separate from SLA calculation)", section: "Source & Calculation", input_type: "textarea" },
    { key: "assumptions", label: "Assumptions / Remarks", section: "Source & Calculation", input_type: "textarea" },
    { key: "metric_type", label: "Metric Type", section: "Identification", input_type: "text" },
];

const _FALLBACK_CATEGORIES = [
    { code: "DELIVERABLE_SUBMISSION", display_name: "Deliverable Submission", formula_type: "fixed_escalation" },
    { code: "QUERY_RESOLUTION", display_name: "Query Resolution", formula_type: "fixed_escalation" },
    { code: "RECOMMENDATION_QUALITY", display_name: "Recommendation Quality", formula_type: "point_accumulation" },
    { code: "RESOURCE_MANAGEMENT", display_name: "Resource Management", formula_type: "point_accumulation" },
    { code: "GOVERNANCE_TOOL", display_name: "Governance Tool", formula_type: "point_accumulation" },
];

export default function SlaAiReviewForm({
    record,            // normalized SLA (from aiSlaNormalize)
    warnings = [],     // [{ field, label, message }]
    catalogs = {},     // { rfpFields, categories, projects, inputVariables }
    position = {},     // { index, total }  1-based index
    pdfFile = null,    // the uploaded source document, attached as evidence
    onOnboarded,       // (createdId) => void
    onPrev,
    onExit,
}) {
    const hostRef = useRef(null);
    // Props are read inside a mount-once effect; the ref keeps the handlers
    // from closing over a stale first render.
    const propsRef = useRef(null);
    propsRef.current = { record, warnings, catalogs, position, pdfFile, onOnboarded, onPrev, onExit };

    useEffect(() => {
        const host = hostRef.current;
        if (!host) return undefined;

        const styleEl = document.createElement("style");
        styleEl.setAttribute("data-sla-ai-onb", "");
        styleEl.textContent = STYLE;
        document.head.appendChild(styleEl);

        const scroller = host.closest(".pmis-content");
        const prevPadBottom = scroller ? scroller.style.paddingBottom : "";
        if (scroller) scroller.style.paddingBottom = "0";

        const P = propsRef.current;
        /* The live catalog still carries the "Image attachments" row, but this
           form has no file picker — the source PDF is attached automatically on
           submit. Leaving the field selectable let a user pick it and get
           "Unknown widget: file_picker", so drop file inputs from the catalog
           entirely. (The manual form keeps its picker; this only affects here.) */
        const RFP_FIELDS = ((catalogs.rfpFields && catalogs.rfpFields.length) ? catalogs.rfpFields : _FALLBACK_RFP_FIELDS)
            .filter((f) => f.input_type !== "file_picker")
            .slice();
        const CATEGORIES = (catalogs.categories && catalogs.categories.length) ? catalogs.categories : _FALLBACK_CATEGORIES.slice();
        const PROJECTS = catalogs.projects || [];
        const INPUT_VARIABLES = (catalogs.inputVariables || []).slice();

        let submitting = false;

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

        const _STATIC_ID_KEYS = [
            "sla_ref", "title", "project_id", "category_code",
            "description", "calculation_method",
            "target_rows", "linear_escalation",
        ];

        function _syncContractType() {
            const src = host.querySelector("#s_sla_ref");
            const out = host.querySelector("#s_contract_type");
            if (!src || !out) return;
            const ref = (src.value || "").trim();
            const m = ref.match(/^([A-Za-z0-9]+)[-_]/);
            out.value = m ? m[1].toUpperCase() : "";
        }

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
            const cat = CATEGORIES.find((c) => c.code === code);
            const isLinear = cat ? cat.formula_type === "fixed_escalation"
                : (code === "Deliverable Submission" || code === "Query Resolution");
            const fakeField = isLinear ? { key: "linear_escalation" } : { key: "target_rows" };
            if (isLinear) _widgetLinearForm(container, fakeField);
            else _widgetSeverityTable(container, fakeField);
            _syncTargetModeButtons();
        }

        /* Which widget is actually rendered — the single source of truth for
           both the mode buttons and what gets collected on submit. */
        function _currentTargetMode() {
            const c = host.querySelector("#s_target_container");
            if (!c) return null;
            if (c.querySelector('[data-k="rate_per_unit_percent"]')) return "linear";
            if (c.querySelector(".sev-body")) return "severity";
            return null;
        }
        function _syncTargetModeButtons() {
            const mode = _currentTargetMode();
            host.querySelectorAll("#s_target_mode .target-mode-btn").forEach((b) => {
                b.classList.toggle("active", b.dataset.mode === mode);
            });
        }
        function _setTargetMode(mode) {
            if (_currentTargetMode() === mode) return;
            const container = host.querySelector("#s_target_container");
            if (!container) return;
            if (mode === "linear") _widgetLinearForm(container, { key: "linear_escalation" });
            else _widgetSeverityTable(container, { key: "target_rows" });
            container.classList.remove("field-error");
            _syncTargetModeButtons();
        }

        function _populateStaticDropdowns() {
            const proj = host.querySelector("#s_project_id");
            if (proj) {
                proj.innerHTML = '<option value="">— Select a project —</option>' +
                    PROJECTS.map((p) => `<option value="${esc(p.id)}">${esc(((p.projectCode || p.code || "") + " — " + (p.name || "")))}</option>`).join("");
            }
            const cat = host.querySelector("#s_category_code");
            if (cat) {
                cat.innerHTML = '<option value="">— Select —</option>' +
                    CATEGORIES.map((c) => `<option value="${esc(c.code)}" data-formula="${esc(c.formula_type || "")}">${esc(c.display_name || c.code)}</option>`).join("");
            }
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
                  <select class="field-type-select" onchange="window.__slaAiOnb._onFieldTypeChange(this)">
                    ${_fieldTypeOptions(prefilledKey || "", row)}
                  </select>
                  <div class="field-help"></div>
                </div>
                <div class="dyn-cell-value">
                  <div class="dyn-cell-empty">Pick a field type on the left to render the input here.</div>
                </div>
                <div class="dyn-cell-delete">
                  <button class="dyn-delete-btn" title="Remove this row" onclick="window.__slaAiOnb._deleteRow(this)">✕</button>
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
            cell.innerHTML = `<div class="dyn-cell-empty">Unknown widget: ${esc(t)}</div>`;
            return undefined;
        }
        const _JUNK_EXAMPLES = new Set(["test", "string", "1.1", "0.0", "example", "none", "n/a", "na", "null"]);
        function _cleanExample(raw) {
            if (raw === null || raw === undefined) return "";
            const s = String(raw).trim();
            if (!s) return "";
            return _JUNK_EXAMPLES.has(s.toLowerCase()) ? "" : s;
        }
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
            cell.innerHTML = `<select data-v="${esc(f.key)}"><option value="">— Select —</option>${opts}</select>`;
        }
        function _widgetMeasurementSet(cell, f) {
            cell.innerHTML = `
                <div class="sub-form" data-mv-host data-mv-key="${esc(f.key)}">
                  <div style="display:grid;grid-template-columns:1fr;gap:8px;">
                    <div>
                      <label>Measurement variable <span class="required">*</span></label>
                      <select class="mv-picker" onchange="window.__slaAiOnb._onMeasurementPick(this)">${_measurementOptions("")}</select>
                    </div>
                    <div class="mv-detail" style="display:none;background:#f8fafc;padding:10px 12px;border-radius:6px;border:1px solid var(--border-soft);">
                      <div style="display:grid;grid-template-columns:1.4fr 0.6fr 0.7fr;gap:10px;align-items:end;">
                        <div>
                          <label>Display name</label>
                          <input type="text" class="mv-label" style="background:#fff;color:var(--navy);font-weight:600;">
                        </div>
                        <div>
                          <label>Unit</label>
                          <input type="text" class="mv-unit" placeholder="days" style="background:#fff;color:var(--navy);font-weight:600;">
                        </div>
                        <div>
                          <label>Target value (optional)</label>
                          <input type="text" class="mv-target" placeholder="0">
                        </div>
                      </div>
                      <!-- Editable here, unlike the manual form: these come from
                           the parser's reading of the PDF, not the catalog, so
                           they are exactly the values most likely to need a fix. -->
                      <div class="hint">Read from the document — correct them if the parser got them wrong. Keep the unit short (e.g. "days", "%", "count").</div>
                      <input type="hidden" class="mv-metric-key">
                    </div>
                    <div class="mv-create" style="display:none;background:#fffbeb;padding:10px 12px;border-radius:6px;border:1px dashed #fcd34d;">
                      <div style="font-size:11px;color:#92400e;font-weight:600;margin-bottom:6px;">Define a new measurement variable</div>
                      <div style="display:grid;grid-template-columns:1fr 1.4fr 0.6fr auto auto;gap:8px;align-items:end;">
                        <div><label>Key (snake_case)</label><input type="text" class="mv-new-key" placeholder="e.g. uptime_percent"></div>
                        <div><label>Display name</label><input type="text" class="mv-new-label" placeholder="e.g. System uptime"></div>
                        <div><label>Unit</label><input type="text" class="mv-new-unit" placeholder="e.g. %"></div>
                        <button type="button" class="small-btn" onclick="window.__slaAiOnb._confirmNewMeasurement(this)" style="background:var(--navy);color:#fff;border:none;">Add to catalog</button>
                        <button type="button" class="small-btn" onclick="window.__slaAiOnb._cancelNewMeasurement(this)">Cancel</button>
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
                opts.splice(1, 0, `<option value="${esc(selectedKey)}" selected>${esc(selectedKey)} (from document)</option>`);
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
            if (tgt) tgt.placeholder = _cleanExample(v && v.example_value) || "0";
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
                  <button type="button" class="small-btn" style="margin-top:6px;" onclick="window.__slaAiOnb._addSevRow(this)">+ Add severity row</button>
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
                <select data-k="severity" onchange="window.__slaAiOnb._updateSevPill(this)">${_severityOptions(sev)}</select>
                <select data-k="input_variable" onchange="window.__slaAiOnb._onSevInputVarChange(this)">${_sevInputVarOptions("", r)}</select>
                <input data-k="threshold_label" type="text" placeholder="e.g. ≤ 21 days">
                <input data-k="from_value" type="number" step="any" placeholder="—">
                <input data-k="to_value" type="number" step="any" placeholder="—">
                <button type="button" class="dyn-delete-btn" onclick="window.__slaAiOnb._deleteSevRow(this)">✕</button>`;
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
                      <input type="number" step="0.01" data-k="rate_per_unit_percent" placeholder="0.5" oninput="window.__slaAiOnb._renderLinPreview(this)"></div>
                    <div><label>Unit</label>
                      <select data-k="unit" onchange="window.__slaAiOnb._renderLinPreview(this)">
                        <option value="">— Pick —</option>
                        <option value="week">week</option><option value="day">day</option><option value="month">month</option>
                      </select></div>
                    <div><label>Grace (units before LD starts)</label>
                      <input type="number" min="0" value="0" data-k="grace_units" oninput="window.__slaAiOnb._renderLinPreview(this)"></div>
                  </div>
                  <div class="lin-preview" data-k="preview">
                    <span style="color:var(--text-muted);font-style:italic;">Type a rate above to see the LD rule.</span>
                  </div>
                </div>`;
        }
        function _renderLinPreview(el) {
            const hostEl = el.closest(".sub-form");
            const rate = (hostEl.querySelector('[data-k="rate_per_unit_percent"]').value || "").trim();
            const unit = hostEl.querySelector('[data-k="unit"]').value || "unit";
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
                  <button type="button" class="small-btn" style="margin-top:6px;" onclick="window.__slaAiOnb._addPhRow(this)">+ Add mapping input</button>
                  <div class="hint">Most SLAs need <strong>nothing</strong> here.</div>
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

        /* ── collect ── */
        let _fileStash = [];
        function _collectPayload() {
            _fileStash = [];
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
            /* Read back whichever widget is actually on screen, NOT whichever
               one the category implies. The parser routinely returns severity
               bands for a category whose formula_type is linear (and vice
               versa); hydration renders what the document said, so deciding by
               category here looked past a filled-in table and reported the
               target as missing. */
            const targetHost = host.querySelector("#s_target_container");
            if (targetHost) {
                if (targetHost.querySelector('[data-k="rate_per_unit_percent"]')) {
                    const value = _collectLinearFromHost(targetHost);
                    if (value) payload.linear_escalation = value;
                } else if (targetHost.querySelector(".sev-body")) {
                    const value = _collectSeverityFromHost(targetHost);
                    if (value) payload.target_rows = value;
                }
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
            if (obj.rate_per_unit_percent) {
                // The parser reports a ceiling; the manual form hardcodes 20.
                // Prefer the document's value when it gave one.
                const fromDoc = P.record && P.record.linear_escalation && P.record.linear_escalation.max_units;
                obj.max_units = fromDoc != null ? fromDoc : 20;
                return obj;
            }
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
                // Last line of defence against the service's 100-char ceiling —
                // catches keys that never went through the normalizer.
                if (metricKey) obj.metric_key = clampMetricKey(metricKey);
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
            return undefined;
        }

        /* ── hydration from the parsed record ── */
        const _hasValue = (v) => v !== null && v !== undefined && v !== "" && !(Array.isArray(v) && v.length === 0);

        function _aiRowPlan(d) {
            return [
                { key: "scope_text", value: d.scope_text, always: true },
                { key: "data_source", value: d.data_source, always: true },
                { key: "reports_submitted_to", value: d.reports_submitted_to, always: true },
                { key: "measurement_interval", value: d.measurement_interval, always: true },
                { key: "reporting_interval", value: d.reporting_interval, always: true },
                { key: "ld_computation_base", value: d.ld_computation_base, always: true },
                { key: "effective_from", value: d.effective_from, always: true },
                { key: "effective_until", value: d.effective_until, always: true },
                { key: "measurement", value: d.measurement, always: true },
            ];
        }

        function hydrate(d) {
            host.querySelector("#dynBody").innerHTML = "";

            const setStatic = (elId, v) => { const el = host.querySelector("#" + elId); if (el) el.value = v == null ? "" : v; };
            setStatic("s_sla_ref", d.sla_ref);
            _syncContractType();
            setStatic("s_title", d.title);
            setStatic("s_description", d.description);
            setStatic("s_calculation_method", d.calculation_method);
            _setSelect(host.querySelector("#s_project_id"), d.project_id, " (not in project list)");

            _setSelect(host.querySelector("#s_category_code"), _resolveCategoryCode(d.category_code));
            _onStaticCategoryChange();
            // _hydrateTarget may swap the widget the category chose — the
            // document's shape wins on load — so re-sync the mode buttons after.
            _hydrateTarget(host.querySelector("#s_target_container"), d);
            _syncTargetModeButtons();

            _aiRowPlan(d).forEach(({ key, value, always }) => {
                if (!RFP_FIELDS.some((f) => f.key === key)) return;
                const has = _hasValue(value);
                if (!has && !always) return;
                addRow(key);
                if (has) { _hydrateRow(key, value); return; }
                const sel = host.querySelector(`#dynBody .dyn-row[data-field-key="${key}"] select[data-v]`);
                if (sel) { sel.insertAdjacentHTML("afterbegin", '<option value="" selected>— Not set —</option>'); sel.value = ""; }
            });
        }

        function _hydrateTarget(container, d) {
            if (!container) return;
            const rows = Array.isArray(d.target_rows) && d.target_rows.length ? d.target_rows : null;
            const lin = d.linear_escalation;
            if (!rows && !lin) return;

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
                    sevSel.innerHTML = _severityOptions(sev);
                    sevSel.value = String(sev);
                    _updateSevPill(sevSel);
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
            if (t === "select" || t === "project_picker") { _setSelect(cell.querySelector("[data-v]"), value); return; }
            if (t === "category_picker") { _setSelect(cell.querySelector("[data-v]"), _resolveCategoryCode(value)); return; }
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
                // The parser's own wording wins over the catalog label — these
                // fields are read-only, so this is the only chance to set them.
                if (value.display_name) hostEl.querySelector(".mv-label").value = value.display_name;
                if (value.unit) hostEl.querySelector(".mv-unit").value = value.unit;
                if (value.target_value != null) hostEl.querySelector(".mv-target").value = value.target_value;
                return;
            }
            if (t === "placeholder_table") {
                cell.querySelector(".ph-body").innerHTML = "";
                const addBtn = cell.querySelector("button");
                (value || []).forEach((p) => {
                    _addPhRow(addBtn);
                    const phRow = cell.querySelector(".ph-body").lastChild;
                    phRow.querySelector('[data-k="key"]').value = p.key || "";
                    phRow.querySelector('[data-k="label"]').value = p.label || "";
                    phRow.querySelector('[data-k="type"]').value = p.type || "text";
                    phRow.querySelector('[data-k="required"]').value = p.required ? "true" : "false";
                });
            }
        }

        /* ── parser warnings ── */
        const _WARN_TARGETS = {
            sla_ref: "#s_sla_ref", title: "#s_title", project_id: "#s_project_id",
            category_code: "#s_category_code", description: "#s_description",
            calculation_method: "#s_calculation_method",
            target_rows: "#s_target_container", linear_escalation: "#s_target_container",
        };
        function _renderWarnings(list) {
            if (!list || !list.length) return;
            const banner = host.querySelector("#warnBanner");
            banner.innerHTML = `<div class="ai-warn-banner">
                <strong>${list.length} field${list.length === 1 ? "" : "s"} need${list.length === 1 ? "s" : ""} a look.</strong>
                The parser either couldn't read these or had to reinterpret them. They're marked below.
              </div>`;
            list.forEach((w) => {
                const note = `<div class="ai-warn-note">${esc(w.message)}</div>`;
                const sel = _WARN_TARGETS[w.field];
                if (sel) {
                    const el = host.querySelector(sel);
                    if (el) {
                        const cell = el.closest(".dyn-cell-value") || el.parentElement;
                        if (cell) cell.insertAdjacentHTML("beforeend", note);
                        return;
                    }
                }
                const row = host.querySelector(`#dynBody .dyn-row[data-field-key="${w.field}"] .dyn-cell-value`);
                if (row) row.insertAdjacentHTML("beforeend", note);
                else banner.insertAdjacentHTML("beforeend", `<div class="ai-warn-note">${esc(w.label)}: ${esc(w.message)}</div>`);
            });
        }

        /* ── submit ── */
        const _FROM_RFP_RENAMES = {
            description: "definition",
            calculation_method: "calculation",
            scope_text: "scope",
            ld_computation_base: "applied_on",
        };
        function _toFromRfpPayload(payload) {
            const out = {};
            Object.keys(payload).forEach((k) => {
                if (k.startsWith("__")) return;
                out[_FROM_RFP_RENAMES[k] || k] = payload[k];
            });
            if (!out.applied_on) {
                out.applied_on = payload.category_code === "DELIVERABLE_SUBMISSION" ? "FIXED_AMOUNT" : "QUARTERLY_PAYMENT";
            }
            return out;
        }

        async function submitSla() {
            if (submitting) return;
            _clearErrorState();
            const payload = _collectPayload();

            const errors = [];
            const markIds = [];
            let tableErr = false;
            const presentKeys = new Set(
                Array.from(host.querySelectorAll("#dynBody .dyn-row")).map((r) => r.dataset.fieldKey).filter(Boolean)
            );
            RFP_FIELDS.filter((f) => f.required).forEach((f) => {
                const v = payload[f.key];
                const missing = v == null || v === "" || (Array.isArray(v) && v.length === 0);
                if (!missing) return;
                const staticSel = _WARN_TARGETS[f.key];
                if (staticSel) { errors.push({ label: f.label, message: "This field is required." }); markIds.push(staticSel); }
                else { errors.push({ label: f.label, message: presentKeys.has(f.key) ? "Fill in this required RFP row." : "Add this RFP row and fill it in." }); tableErr = true; }
            });
            if (!payload.target_rows && !payload.linear_escalation) {
                errors.push({ label: "Target / Applied Severity level", message: "Add a severity table or linear LD escalation." });
                markIds.push("#s_target_container");
            }
            // The API enforces ^[A-Z0-9_-]+$ on sla_ref; catch it here so a lowercase
            // ref fails as a normal field error instead of a raw schema dump.
            if (payload.sla_ref && !/^[A-Z0-9_-]+$/.test(payload.sla_ref)) {
                errors.push({ label: "SLA Number", message: "Use capital letters, digits, - and _ only — e.g. PMU-SLA001." });
                markIds.push("#s_sla_ref");
            }
            if (errors.length) {
                markIds.forEach(_markField);
                if (tableErr) _flagTable();
                errors.forEach((e) => toast(e.label, e.message, "error"));
                return;
            }

            const wire = _toFromRfpPayload(payload);
            submitting = true;
            const btn = host.querySelector("#submitBtn");
            if (btn) { btn.disabled = true; btn.textContent = "Onboarding…"; }
            try {
                // The source document rides along as this SLA's evidence, in
                // place of the RFP screenshot the manual flow asks for.
                const fd = new FormData();
                fd.append("payload", JSON.stringify(wire));
                if (P.pdfFile) fd.append("files", P.pdfFile, P.pdfFile.name);

                const resp = await authorizedFetch(CONTRACTS_BASE + "/api/v3/sla-masters/from-rfp", {
                    method: "POST", headers: { Accept: "application/json" }, body: fd,
                });
                if (!resp.ok) {
                    const t = await resp.text();
                    const serverErrors = _parseServerErrors(t, resp.status);
                    let flagTbl = false;
                    serverErrors.forEach((e) => { if (e.fieldSel) _markField(e.fieldSel); else if (e.table) flagTbl = true; });
                    if (flagTbl) _flagTable();
                    serverErrors.forEach((e) => toast(e.label, e.message, "error"));
                    return;
                }
                let createdId = null;
                try {
                    const body = await resp.json();
                    const d = (body && body.data && body.data.data) || (body && body.data) || body;
                    createdId = (d && (d.id || d.sla_id)) || null;
                } catch { /* a bodyless 201 is still a success */ }
                toast("Onboarded", `${payload.sla_ref || "SLA"} created.`, "success");
                window.setTimeout(() => { if (P.onOnboarded) P.onOnboarded(createdId); }, 550);
            } catch (e) {
                toast("Network error", e.message, "error");
            } finally {
                submitting = false;
                if (btn) { btn.disabled = false; btn.textContent = "Onboard & Next"; }
            }
        }

        /* ── helpers ── */
        function esc(s) {
            return String(s == null ? "" : s)
                .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
                .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
        }
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
        function _clearErrorState() {
            host.querySelectorAll(".field-error").forEach((el) => el.classList.remove("field-error"));
            const tbl = host.querySelector("#dynTable");
            if (tbl) tbl.classList.remove("table-error");
            host.querySelectorAll("#toastStack [data-err]").forEach((el) => el.remove());
        }
        function _markField(sel) {
            if (!sel) return;
            const el = host.querySelector(sel);
            if (el) el.classList.add("field-error");
        }
        function _flagTable() {
            const tbl = host.querySelector("#dynTable");
            if (tbl) tbl.classList.add("table-error");
        }
        function _prettyKey(k) {
            return String(k).replace(/[._-]+/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
        }
        function _parseServerErrors(text, status) {
            let data = null;
            try { data = JSON.parse(text); } catch { /* not JSON */ }
            const out = [];
            const pushLoc = (loc, msg) => {
                const key = String(loc).split(".").pop();
                const fieldSel = _WARN_TARGETS[key];
                const label = (RFP_FIELDS.find((f) => f.key === key) || {}).label || _prettyKey(loc || "Error");
                out.push({ label, message: msg, fieldSel, table: !fieldSel });
            };
            const arr = (Array.isArray(data?.detail) && data.detail) ||
                (Array.isArray(data?.error?._embedded?.details?.errors) && data.error._embedded.details.errors) || null;
            if (arr) {
                arr.forEach((it) => {
                    const loc = Array.isArray(it.loc) ? it.loc.filter((p) => p !== "body").join(".") : (it.loc || "");
                    pushLoc(loc, it.msg || "Invalid value");
                });
            }
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
                        fieldSel: targetish ? "#s_target_container" : null,
                        table: false,
                    });
                }
            }
            if (!out.length) out.push({ label: "Save failed", message: (typeof text === "string" && text.slice(0, 300)) || `HTTP ${status}` });
            return out;
        }

        function goPrev() { if (P.onPrev) P.onPrev(); }
        function exitReview() { if (P.onExit) P.onExit(); }

        window.__slaAiOnb = {
            _onStaticCategoryChange, _syncContractType, submitSla, goPrev, exitReview, _setTargetMode,
            addRow, _onFieldTypeChange, _deleteRow, _onMeasurementPick, _confirmNewMeasurement, _cancelNewMeasurement,
            _addSevRow, _updateSevPill, _onSevInputVarChange, _deleteSevRow, _renderLinPreview, _addPhRow,
        };

        /* ── render ── */
        host.innerHTML = BODY_HTML;
        _populateStaticDropdowns();
        hydrate(P.record || {});
        _renderWarnings(P.warnings);

        const pill = host.querySelector("#progressPill");
        if (pill && P.position && P.position.total) {
            pill.textContent = `SLA ${P.position.index} of ${P.position.total}`;
        }
        const prevBtn = host.querySelector("#prevBtn");
        if (prevBtn && P.position && P.position.index <= 1) prevBtn.disabled = true;

        return () => {
            try { document.head.removeChild(styleEl); } catch { /* already gone */ }
            if (scroller) scroller.style.paddingBottom = prevPadBottom;
            delete window.__slaAiOnb;
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    return <div ref={hostRef} className="sla-ai-onb-root" />;
}
