/* ══════════════════════════════════════════════════════════════════
   ApprovalRequestModal.jsx — popup that opens when the user clicks
   "Request Division Approval" or "Request Owner Approval" in the
   ApprovalPanel.

   Renders one row per target (each Concerned Division for a division
   request; the Activity Owner for an owner request). Each row has its
   own comment textarea and file picker. On Send Request, the parent's
   onSubmit handler receives `payloads = [{ id, kind, label, text,
   files }]` so it can apply the per-target system comments.

   Mirrors the HTML reference's `_openApprovalRequestModal` flow.
   ══════════════════════════════════════════════════════════════════ */

import React, { useEffect, useState } from "react";

function makeInitialState(rows) {
  const out = {};
  (rows || []).forEach((r) => {
    if (r && r.id) out[r.id] = { text: "", files: [] };
  });
  return out;
}

export default function ApprovalRequestModal({
  open,
  title,
  subtitle,
  rows,
  submitting,
  error,
  onSubmit,
  onClose
}) {
  const [state, setState] = useState(() => makeInitialState(rows));
  /* When the consumer reopens the popup with a different set of rows
     (e.g. owner row vs. division rows), refresh local state. */
  useEffect(() => {
    setState(makeInitialState(rows));
  }, [rows]);

  if (!open) return null;
  const list = Array.isArray(rows) ? rows : [];

  function setText(id, text) {
    setState((s) => ({ ...s, [id]: { ...(s[id] || { files: [] }), text } }));
  }
  function setFiles(id, fileList) {
    const files = Array.from(fileList || []).map((f) => ({
      name: f.name,
      size: formatBytes(f.size)
    }));
    setState((s) => ({ ...s, [id]: { ...(s[id] || { text: "" }), files } }));
  }

  function submit() {
    const payloads = list.map((r) => ({
      id: r.id,
      kind: r.kind || "division",
      label: r.label || "",
      text: (state[r.id] && state[r.id].text) || "",
      files: (state[r.id] && state[r.id].files) || []
    }));
    onSubmit(payloads);
  }

  return (
    <div className="pmis-awf-reqmodal pmis-awf-scope" role="dialog" aria-modal="true">
      <div className="pmis-awf-reqmodal__box">
        <div className="pmis-awf-reqmodal__head">
          <div>
            <h3>{title || "Request Approval"}</h3>
            {subtitle && <div className="pmis-awf-reqmodal__sub">{subtitle}</div>}
          </div>
          <button
            type="button"
            className="pmis-awf-reqmodal__close"
            aria-label="Close"
            onClick={onClose}
            disabled={submitting}
          >
            ✕
          </button>
        </div>

        <div className="pmis-awf-reqmodal__body">
          {list.length === 0 ? (
            <div className="pmis-awf-reqmodal__empty">No targets to route to.</div>
          ) : (
            list.map((row) => {
              const icon = row.kind === "owner" ? "👤" : "🏛️";
              const tag = row.kind === "owner" ? "Activity Owner" : "Concerned Division";
              const entry = state[row.id] || { text: "", files: [] };
              return (
                <div key={row.id} className="pmis-awf-reqmodal__row">
                  <div className="pmis-awf-reqmodal__row-head">
                    <span className="pmis-awf-reqmodal__row-icon">{icon}</span>
                    <div className="pmis-awf-reqmodal__row-titles">
                      <div className="pmis-awf-reqmodal__row-label">{row.label}</div>
                      <div className="pmis-awf-reqmodal__row-tag">{tag}</div>
                    </div>
                  </div>
                  <div className="pmis-awf-reqmodal__field">
                    <label>
                      Comment{" "}
                      <span className="pmis-awf-reqmodal__hint">
                        (optional, visible to this reviewer only)
                      </span>
                    </label>
                    <textarea
                      value={entry.text}
                      onChange={(e) => setText(row.id, e.target.value)}
                      placeholder={`Add a brief context note for ${row.label}…`}
                      disabled={submitting}
                    />
                  </div>
                  <div className="pmis-awf-reqmodal__field">
                    <label>
                      Attachments{" "}
                      <span className="pmis-awf-reqmodal__hint">
                        (optional, max 25 MB per file)
                      </span>
                    </label>
                    <input
                      type="file"
                      multiple
                      onChange={(e) => setFiles(row.id, e.target.files)}
                      disabled={submitting}
                    />
                    {entry.files.length > 0 && (
                      <div className="pmis-awf-reqmodal__files">
                        {entry.files.map((f, i) => (
                          <span key={i} className="pmis-awf-reqmodal__file-chip">
                            📎 {f.name}{" "}
                            <span className="pmis-awf-reqmodal__file-size">{f.size}</span>
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              );
            })
          )}
        </div>

        {error && <div className="pmis-awf-error">{error}</div>}

        <div className="pmis-awf-reqmodal__actions">
          <button
            type="button"
            className="pmis-awf-btn pmis-awf-btn--ghost"
            onClick={onClose}
            disabled={submitting}
          >
            Cancel
          </button>
          <button
            type="button"
            className="pmis-awf-btn"
            onClick={submit}
            disabled={submitting || list.length === 0}
          >
            {submitting ? "Sending…" : "Send Request"}
          </button>
        </div>
      </div>
    </div>
  );
}

function formatBytes(n) {
  const x = Number(n) || 0;
  if (x >= 1024 * 1024) return (x / 1024 / 1024).toFixed(1) + " MB";
  if (x >= 1024) return (x / 1024).toFixed(0) + " KB";
  return x + " B";
}
