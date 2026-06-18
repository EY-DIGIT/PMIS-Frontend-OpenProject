/* ══════════════════════════════════════════════════════════════════
   ApprovalRequestModal.jsx — popup that opens when the user clicks
   "Request Division Approval" or "Request Owner Approval" in the
   ApprovalPanel.

   Renders one row per target (each Concerned Division for a division
   request; the Activity Owner for an owner request). Each row has its
   own comment textarea and file picker.

   Per the 2026-06-18 contract, attachments upload IMMEDIATELY on every
   "Choose File" — each browse fires onUpload(), which POSTs that batch to
   /activities/documents/upload and returns a documentStoreId. The id is
   stored on the picked file entries. On Send Request the parent receives
   `payloads = [{ id, kind, label, text, files, documentStoreIds }]`.
   ══════════════════════════════════════════════════════════════════ */

import React, { useEffect, useRef, useState } from "react";

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
  onUpload,
  onClose
}) {
  const [state, setState] = useState(() => makeInitialState(rows));
  /* Monotonic key generator so every picked file entry is uniquely
     addressable while its async upload is in flight. */
  const keySeq = useRef(0);
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

  async function handleChoose(row, fileList) {
    const id = row.id;
    /* A native <input type="file"> only holds its LATEST pick, so each
       browse is treated as one upload batch. Dedupe by name+byte-size so
       re-picking the same file in the SAME row is a no-op. */
    setState((s) => {
      const prev = (s[id] && s[id].files) || [];
      const seen = new Set(prev.map((f) => `${f.name}::${f.bytes ?? ""}`));
      const merged = prev.slice();
      Array.from(fileList || []).forEach((f) => {
        const dedupeKey = `${f.name}::${f.size ?? ""}`;
        if (seen.has(dedupeKey)) return;
        seen.add(dedupeKey);
        keySeq.current += 1;
        merged.push({
          key: `f${keySeq.current}`,
          name: f.name,
          size: formatBytes(f.size),
          bytes: f.size,
          raw: f,
          documentStoreId: null,
          uploading: true,
          uploadError: ""
        });
      });
      return { ...s, [id]: { ...(s[id] || { text: "" }), files: merged } };
    });

    /* Determine which raw files are genuinely new (not duplicates already
       present) and upload exactly that batch — one call per browse. */
    const existingKeys = new Set(
      ((state[id] && state[id].files) || []).map((f) => `${f.name}::${f.bytes ?? ""}`)
    );
    const batch = Array.from(fileList || []).filter(
      (f) => !existingKeys.has(`${f.name}::${f.size ?? ""}`)
    );
    if (batch.length === 0) return;

    // Snapshot the keys we just appended for this batch so we can patch them.
    const targetNames = new Set(batch.map((f) => `${f.name}::${f.size ?? ""}`));

    if (typeof onUpload !== "function") return;
    try {
      const documentStoreId = await onUpload({
        row,
        files: batch,
        comment: (state[id] && state[id].text) || ""
      });
      setState((s) => {
        const entry = s[id] || { text: "", files: [] };
        const files = (entry.files || []).map((f) =>
          targetNames.has(`${f.name}::${f.bytes ?? ""}`) && f.uploading
            ? { ...f, uploading: false, documentStoreId: documentStoreId || null }
            : f
        );
        return { ...s, [id]: { ...entry, files } };
      });
    } catch (err) {
      const msg = (err && err.message) || "Upload failed.";
      setState((s) => {
        const entry = s[id] || { text: "", files: [] };
        const files = (entry.files || []).map((f) =>
          targetNames.has(`${f.name}::${f.bytes ?? ""}`) && f.uploading
            ? { ...f, uploading: false, uploadError: msg }
            : f
        );
        return { ...s, [id]: { ...entry, files } };
      });
    }
  }

  function removeFile(id, key) {
    setState((s) => {
      const entry = s[id] || { text: "", files: [] };
      const files = (entry.files || []).filter((f) => f.key !== key);
      return { ...s, [id]: { ...entry, files } };
    });
  }

  /* Distinct documentStoreIds still attached to (non-removed) files. */
  function documentStoreIdsFor(entry) {
    const ids = ((entry && entry.files) || [])
      .map((f) => f.documentStoreId)
      .filter(Boolean);
    return Array.from(new Set(ids));
  }

  const anyUploading = list.some((r) =>
    ((state[r.id] && state[r.id].files) || []).some((f) => f.uploading)
  );

  function submit() {
    const payloads = list.map((r) => {
      const entry = state[r.id] || { text: "", files: [] };
      return {
        id: r.id,
        kind: r.kind || "division",
        label: r.label || "",
        text: entry.text || "",
        files: entry.files || [],
        documentStoreIds: documentStoreIdsFor(entry)
      };
    });
    onSubmit(payloads);
  }

  const disableSend = submitting || anyUploading || list.length === 0;

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
                        (optional, max 25 MB per file — uploaded on selection)
                      </span>
                    </label>
                    <input
                      type="file"
                      multiple
                      onChange={(e) => {
                        handleChoose(row, e.target.files);
                        /* Reset so the next browse fires onChange even if
                           the same file is picked again. */
                        e.target.value = "";
                      }}
                      disabled={submitting}
                    />
                    {entry.files.length > 0 && (
                      <div className="pmis-awf-reqmodal__files">
                        {entry.files.map((f) => (
                          <span key={f.key} className="pmis-awf-reqmodal__file-chip">
                            📎 {f.name}{" "}
                            <span className="pmis-awf-reqmodal__file-size">{f.size}</span>
                            {f.uploading && (
                              <span style={{ marginLeft: 6, fontSize: 11, color: "#0b3c88" }}>
                                uploading…
                              </span>
                            )}
                            {!f.uploading && f.documentStoreId && (
                              <span style={{ marginLeft: 6, fontSize: 11, color: "#1b7a42" }}>
                                ✓ uploaded
                              </span>
                            )}
                            {!f.uploading && f.uploadError && (
                              <span
                                style={{ marginLeft: 6, fontSize: 11, color: "#9b1c1c" }}
                                title={f.uploadError}
                              >
                                ✕ failed
                              </span>
                            )}
                            <button
                              type="button"
                              className="pmis-awf-reqmodal__file-remove"
                              aria-label={`Remove ${f.name}`}
                              title="Remove"
                              onClick={() => removeFile(row.id, f.key)}
                              disabled={submitting}
                              style={{
                                marginLeft: 6, border: "none", background: "transparent",
                                cursor: "pointer", color: "#9b1c1c", fontWeight: 700,
                                fontSize: 13, lineHeight: 1, padding: 0,
                              }}
                            >
                              ✕
                            </button>
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
            disabled={disableSend}
          >
            {submitting ? "Sending…" : anyUploading ? "Uploading…" : "Send Request"}
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
