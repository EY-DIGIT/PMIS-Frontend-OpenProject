import React, { useState, useEffect } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { draftStore, useDraft } from "../../store/project/draftStore";
import { uiStore } from "../../store/project/uiStore";
import {
  VENDOR_MASTER,
  ALLOWED_FILE_ACCEPT,
  ALLOWED_FILE_EXTENSIONS,
  MAX_ATTACHMENT_BYTES,
  getFileExtension
} from "../../utils/project/constants";
import { safeArray } from "../../utils/project/helpers";
import ChipControl from "../../components/projects/ChipControl";
import { getToken, logout } from "../../api/auth";
import { ENDPOINTS } from "../../api/endpoint";
import { API_BASE, authorizedFetch } from "../../api/client";
import { useCan } from "../../auth/permissions";

/* Pull the human-readable message out of the backend's error envelope so
   the user sees "A project named X already exists…" instead of the raw
   JSON. Shape: { error: { message }, message, detail, status }. Falls back
   to the raw body, then a generic line. */
function extractApiError(body, status) {
  if (!body) return `Request failed (${status})`;
  let parsed;
  try { parsed = JSON.parse(body); } catch { return body; }
  const nested =
    parsed && parsed.error && typeof parsed.error === "object"
      ? parsed.error.message
      : null;
  const flat = typeof parsed?.message === "string" ? parsed.message : null;
  const detail = typeof parsed?.detail === "string" ? parsed.detail : null;
  return nested || flat || detail || `Request failed (${status})`;
}

function makeEmpty() {
  return {
    projectName: "",
    description: "",
    owner: "",
    ownerOther: "",
    startDate: "",
    endDate: "",
    actualEndDate: "",
    auditLogs: [],
    milestones: [],
    vendors: [],
    resources: [],
    documents: []
  };
}

/* ChipControl on this page uses vendor NAMES (strings) as its value. When a
   project is created via the API, the response returns vendors as objects
   {id, name}, which get persisted into the draft. On Back-navigation we must
   flatten those back to string names, otherwise React will try to render
   the object as a child and crash. */
function normalizeVendorNames(vendors) {
  return safeArray(vendors)
    .map((v) => {
      if (typeof v === "string") return v;
      if (v && typeof v === "object") return v.name || "";
      return "";
    })
    .filter(Boolean);
}

/* Merge an arbitrary draft on top of makeEmpty() so that every field the
   component reads is guaranteed to be defined. Prevents `.length` / etc.
   crashes when a persisted or partial draft comes in without, say, a
   `description` field. */
function normalizeFormShape(maybeDraft) {
  const base = makeEmpty();
  if (!maybeDraft || typeof maybeDraft !== "object") return base;
  return {
    ...base,
    ...maybeDraft,
    projectName: maybeDraft.projectName || "",
    description: maybeDraft.description || "",
    owner: maybeDraft.owner || "",
    ownerOther: maybeDraft.ownerOther || "",
    startDate: maybeDraft.startDate || "",
    endDate: maybeDraft.endDate || "",
    actualEndDate: maybeDraft.actualEndDate || "",
    vendors: normalizeVendorNames(maybeDraft.vendors),
    milestones: safeArray(maybeDraft.milestones),
    auditLogs: safeArray(maybeDraft.auditLogs),
    resources: safeArray(maybeDraft.resources),
    documents: safeArray(maybeDraft.documents)
  };
}

/* Send the user's picked date with an explicit IST offset so the payload
   shows exactly the date they chose (no UTC roll-back). */
const IST_OFFSET = "+05:30";
function toIsoStart(d) {
  if (!d) return null;
  return `${d}T00:00:00${IST_OFFSET}`;
}
function toIsoEnd(d) {
  if (!d) return null;
  return `${d}T23:59:59${IST_OFFSET}`;
}

function extractVendors(raw) {
  const elements =
    raw?.data?._embedded?.elements ??
    raw?._embedded?.elements ??
    raw?.data ??
    raw ??
    [];
  const list = Array.isArray(elements) ? elements : [];
  return list
    .filter((v) => v?.active !== false && v?.id && v?.name)
    .map((v) => ({ id: v.id, name: v.name }));
}

function extractDivisions(raw) {
  const elements =
    raw?.data?._embedded?.elements ??
    raw?._embedded?.elements ??
    raw?.data ??
    raw ??
    [];
  const list = Array.isArray(elements) ? elements : [];
  return list
    .filter((d) => d?.code && d?.label)
    .map((d) => ({ code: d.code, label: d.label, requiresOther: !!d.requiresOther }));
}

export default function AddProjectPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const existingDraft = useDraft();
  const canManageDocuments = useCan("manageProjectDocuments");

  // Always initialize with a fully-shaped object — prevents blank-page crashes
  // when a partial/stale draft arrives (e.g. restored from localStorage with
  // description undefined).
  // If a draft with projectId is in play, the user has already gone through
  // "Save & Next". Landing here again normally means they're starting a
  // brand-new project, so we drop the cached draft and render an empty form.
  // The exception is the "Back" button on the Milestone Config step, which
  // navigates here with { state: { fromConfig: true } } — in that case keep
  // the draft so every field is pre-filled and "Save & Next" updates the
  // already-created project (see goNext) instead of creating a new one.
  const cameFromConfig = !!(location.state && location.state.fromConfig);
  const [form, setForm] = useState(() => {
    if (existingDraft && existingDraft.projectId && !cameFromConfig) {
      draftStore.clear();
      return makeEmpty();
    }
    return normalizeFormShape(existingDraft);
  });
  const [submitting, setSubmitting] = useState(false);

  const [vendorOptions, setVendorOptions] = useState(() => safeArray(VENDOR_MASTER));
  const [vendorNameToId, setVendorNameToId] = useState(() => {
    const seeded = {};
    safeArray(existingDraft?.vendors).forEach((v) => {
      if (v && typeof v === "object" && v.name && v.id) seeded[v.name] = v.id;
    });
    return seeded;
  });
  const [vendorsLoading, setVendorsLoading] = useState(false);
  const [vendorsError, setVendorsError] = useState("");
  const [divisionOptions, setDivisionOptions] = useState([]);
  const [divisionsLoading, setDivisionsLoading] = useState(false);
  const [divisionsError, setDivisionsError] = useState("");
  const [errorCreated, setErrorCreated] = useState("");
  const [docError, setDocError] = useState("");
  // Bumping this remounts the (uncontrolled) <input type="file"> so the
  // browser's "no file chosen" label resets after files are removed.
  const [docInputKey, setDocInputKey] = useState(0);
  /* Per-field errors keyed by field name. Populated on submit, cleared as
     the user edits each field. */
  const [errors, setErrors] = useState({});

  function clearFieldError(field) {
    setErrors((prev) => {
      if (!prev[field]) return prev;
      const next = { ...prev };
      delete next[field];
      return next;
    });
  }
  const errClass = (field) =>
    errors[field] ? "uidai-field has-error" : "uidai-field";

  useEffect(() => {
    let cancelled = false;

    async function loadVendors() {
      const token = getToken();
      if (!token) return;

      setVendorsLoading(true);
      setVendorsError("");
      try {
        const res = await authorizedFetch(`${API_BASE}${ENDPOINTS.vendors.list}`, {
          method: "GET",
          headers: { accept: "application/json" }
        });

        if (cancelled) return;

        if (res.status === 401) {
          logout();
          setErrorCreated("Session expired. Please sign in again.");
          navigate("/login");
          return;
        }

        if (!res.ok) {
          const errBody = await res.text().catch(() => "");
          throw new Error(extractApiError(errBody, res.status));
        }

        const raw = await res.json().catch(() => ({}));
        const vendors = extractVendors(raw);

        if (!cancelled) {
          if (vendors.length) {
            setVendorOptions(vendors.map((v) => v.name));
            setVendorNameToId(Object.fromEntries(vendors.map((v) => [v.name, v.id])));
          } else {
            setVendorOptions(safeArray(VENDOR_MASTER));
            setVendorNameToId({});
          }
        }
      } catch (err) {
        if (!cancelled) setVendorsError(err?.message || "Failed to load vendors");
      } finally {
        if (!cancelled) setVendorsLoading(false);
      }
    }

    loadVendors();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function loadDivisions() {
      const token = getToken();
      if (!token) return;

      setDivisionsLoading(true);
      setDivisionsError("");
      try {
        const res = await authorizedFetch(`${API_BASE}${ENDPOINTS.divisions.list}`, {
          method: "GET",
          headers: { accept: "application/json" }
        });

        if (cancelled) return;

        if (res.status === 401) {
          logout();
          setErrorCreated("Session expired. Please sign in again.");
          navigate("/login");
          return;
        }

        if (!res.ok) {
          const errBody = await res.text().catch(() => "");
          throw new Error(extractApiError(errBody, res.status));
        }

        const raw = await res.json().catch(() => ({}));
        const divisions = extractDivisions(raw);

        if (!cancelled) setDivisionOptions(divisions);
      } catch (err) {
        if (!cancelled) setDivisionsError(err?.message || "Failed to load divisions");
      } finally {
        if (!cancelled) setDivisionsLoading(false);
      }
    }

    loadDivisions();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function update(patch) {
    setForm((f) => ({ ...f, ...patch }));
  }

  function validateDocs(files) {
    const bad = files.filter(
      (f) => !ALLOWED_FILE_EXTENSIONS.includes(getFileExtension(f.name))
    );
    if (bad.length) {
      setDocError(
        `Unsupported file type: ${bad.map((f) => f.name).join(", ")}`
      );
      return false;
    }
    const oversize = files.filter((f) => f.size > MAX_ATTACHMENT_BYTES);
    if (oversize.length) {
      const names = oversize
        .map((f) => `${f.name} (${(f.size / 1024 / 1024).toFixed(1)} MB)`)
        .join(", ");
      setDocError(`File too large (max 25 MB): ${names}`);
      return false;
    }
    setDocError("");
    return true;
  }

  function handleDocumentsChange(e) {
    const picked = Array.from(e.target.files || []);
    if (!picked.length) return;
    const merged = [...safeArray(form.documents), ...picked];
    if (!validateDocs(merged)) {
      e.target.value = "";
      return;
    }
    update({ documents: merged });
    // Reset native input so the same file can be re-picked after removal.
    e.target.value = "";
  }

  function removeDocument(idx) {
    const next = safeArray(form.documents).filter((_, i) => i !== idx);
    update({ documents: next });
    setDocError("");
    setDocInputKey((k) => k + 1);
  }

  // Open the picked file in a new tab via a blob URL. Browsers render
  // PDFs/images/videos/text inline and prompt download for office formats.
  // Revoke the URL after a minute so memory is reclaimed but the new tab
  // has time to load it.
  function viewDocument(file) {
    if (!file) return;
    const url = URL.createObjectURL(file);
    window.open(url, "_blank", "noopener,noreferrer");
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  }

  const selectedDivision = divisionOptions.find((d) => d.code === form.owner);
  const ownerRequiresOther =
    !!selectedDivision &&
    (selectedDivision.requiresOther ||
      String(selectedDivision.label || "").toLowerCase() === "others" ||
      String(selectedDivision.code || "").toLowerCase() === "others");

  // Build the multipart payload the create endpoint expects. Field names
  // mirror the backend's camelCase contract; picked documents are
  // attached under the `files` key (repeated, one entry per file). The
  // Content-Type header is intentionally NOT set on the request so the
  // browser writes the correct multipart boundary itself.
  function buildPayload() {
    const selectedNames = safeArray(form.vendors);
    const vendorIds = selectedNames.map((n) => vendorNameToId[n]).filter(Boolean);

    const fd = new FormData();
    fd.append("name", (form.projectName || "").trim());
    fd.append("description", (form.description || "").trim());
    fd.append("status", "");
    fd.append("statusExplanation", "");
    fd.append("owner", (form.owner || "").trim());
    fd.append("ownerOther", ownerRequiresOther ? (form.ownerOther || "").trim() : "");
    fd.append("startDate", toIsoStart(form.startDate) || "");
    fd.append("endDate", toIsoEnd(form.endDate) || "");
    fd.append("parentId", "");
    // Backend expects `vendorIds` as a single form field whose value is
    // a JSON-encoded array string (not repeated entries). Empty list →
    // empty string, matching the curl's `vendorIds=""` shape.
    fd.append(
      "vendorIds",
      vendorIds.length ? JSON.stringify(vendorIds) : ""
    );
    safeArray(form.documents).forEach((file) => {
      fd.append("files", file, file.name);
    });
    return fd;
  }

  /* Collect ALL field errors at once so every invalid input is highlighted
     simultaneously and the popup lists every missing/invalid field. */
  function validate() {
    const errs = {};
    if (!(form.projectName || "").trim()) errs.projectName = "Project Name is required";
    if (!(form.owner || "").trim()) errs.owner = "Owner is required";
    if (ownerRequiresOther && !(form.ownerOther || "").trim())
      errs.ownerOther = "Please specify the owner";
    if (!form.startDate) errs.startDate = "Expected Start Date is required";
    if (!form.endDate) errs.endDate = "Expected End Date is required";
    if (form.startDate && form.endDate && form.endDate < form.startDate)
      errs.endDate = "Expected End Date cannot be earlier than Expected Start Date";
    if (safeArray(form.vendors).length === 0)
      errs.vendors = "At least one associated Organization is required";
    return errs;
  }

  async function goNext() {
    if (submitting) return;

    const errs = validate();
    setErrors(errs);
    const errList = Object.values(errs);
    if (errList.length) {
      setErrorCreated("");
      uiStore.showError(`Please fix the highlighted fields\n• ${errList.join("\n• ")}`);
      return;
    }

    const token = getToken();
    if (!token) {
      setErrorCreated("Your session has expired. Please sign in again.");
      uiStore.showError("Your session has expired. Please sign in again.");
      navigate("/login");
      return;
    }

    setSubmitting(true);
    try {
      // When the draft already carries a projectId the user came back from
      // the Milestone Config step to edit — PATCH the existing project
      // instead of creating a new one.
      const isEditing = !!form.projectId;
      const endpoint = isEditing
        ? ENDPOINTS.projects.update(form.projectId)
        : ENDPOINTS.projects.create;
      const res = await authorizedFetch(`${API_BASE}${endpoint}`, {
        method: isEditing ? "PATCH" : "POST",
        headers: { accept: "application/json" },
        body: buildPayload()
      });

      if (res.status === 401) {
        logout();
        const m = "Session expired. Please sign in again.";
        setErrorCreated(m);
        uiStore.showError(m);
        navigate("/login");
        return;
      }

      if (!res.ok) {
        const errBody = await res.text().catch(() => "");
        throw new Error(extractApiError(errBody, res.status));
      }

      const raw = await res.json().catch(() => ({}));
      const created = raw?.data ?? raw ?? {};

      const next = {
        ...form,
        projectId: created.id ?? created._id ?? created.projectId ?? form.projectId ?? null,
        projectCode: created.projectCode ?? created.project_code ?? form.projectCode ?? "",
        projectName: (form.projectName || "").trim(),
        description: (form.description || "").trim(),
        owner: (form.owner || "").trim(),
        status: "DRAFT",
        milestones: safeArray(form.milestones),
        vendors: Array.isArray(created.vendors) && created.vendors.length
          ? created.vendors
          : safeArray(form.vendors)
      };
      draftStore.set(next);
      navigate("/projects/add/config");
    } catch (err) {
      const m = err?.message || "Failed to create project";
      setErrorCreated(m);
      uiStore.showError(m);
    } finally {
      setSubmitting(false);
    }
  }

  function cancel() {
    draftStore.clear();
    navigate("/");
  }

  return (
    <div>
      <div className="uidai-card-project">
        <div className="uidai-grid">
          <div className={errClass("projectName")}>
            <label className="uidai-field__label">
              Project Name <span className="uidai-required-project">*</span>
            </label>
            <input
              className="uidai-input"
              value={form.projectName || ""}
              onChange={(e) => {
                update({ projectName: e.target.value });
                clearFieldError("projectName");
              }}
            />
            {errors.projectName && (
              <div className="uidai-field-error">{errors.projectName}</div>
            )}
          </div>

          <div className="uidai-field uidai-grid__full">
            <label className="uidai-field__label">Description</label>
            <textarea
              className="uidai-textarea"
              maxLength={5000}
              value={form.description || ""}
              onChange={(e) => update({ description: e.target.value })}
            />
            <div className="uidai-char-count">
              {5000 - (form.description || "").length} characters remaining
            </div>
          </div>

          <div className="uidai-field">
            <label className="uidai-field__label">Status</label>
            <input className="uidai-input" value="NEW" disabled />
          </div>

          <div className={errClass("owner")}>
            <label className="uidai-field__label">
              Owner <span className="uidai-required-project">*</span>
            </label>
            <select
              className="uidai-select"
              value={form.owner || ""}
              onChange={(e) => {
                const nextCode = e.target.value;
                const nextDiv = divisionOptions.find((d) => d.code === nextCode);
                const stillNeedsOther =
                  !!nextDiv &&
                  (nextDiv.requiresOther ||
                    String(nextDiv.label || "").toLowerCase() === "others" ||
                    String(nextDiv.code || "").toLowerCase() === "others");
                update({
                  owner: nextCode,
                  ownerOther: stillNeedsOther ? form.ownerOther || "" : ""
                });
                clearFieldError("owner");
              }}
              disabled={divisionsLoading}
            >
              <option value="" disabled>
                {divisionsLoading
                  ? "Loading..."
                  : divisionsError
                    ? "Could not load divisions"
                    : "Select owner"}
              </option>
              {divisionOptions.map((d) => (
                <option key={d.code} value={d.code}>
                  {d.label}
                </option>
              ))}
            </select>
            {errors.owner && (
              <div className="uidai-field-error">{errors.owner}</div>
            )}
          </div>

          {ownerRequiresOther && (
            <div className={errClass("ownerOther")}>
              <label className="uidai-field__label">
                Specify Owner <span className="uidai-required-project">*</span>
              </label>
              <input
                className="uidai-input"
                placeholder="Specify owner name"
                value={form.ownerOther || ""}
                onChange={(e) => {
                  update({ ownerOther: e.target.value });
                  clearFieldError("ownerOther");
                }}
              />
              {errors.ownerOther && (
                <div className="uidai-field-error">{errors.ownerOther}</div>
              )}
            </div>
          )}

          <div className={errClass("startDate")}>
            <label className="uidai-field__label">
              Expected Start Date <span className="uidai-required-project">*</span>
            </label>
            <input
              className="uidai-input"
              type="date"
              value={form.startDate || ""}
              onChange={(e) => {
                update({ startDate: e.target.value });
                clearFieldError("startDate");
              }}
            />
            {errors.startDate && (
              <div className="uidai-field-error">{errors.startDate}</div>
            )}
          </div>

          <div className={errClass("endDate")}>
            <label className="uidai-field__label">
              Expected End Date <span className="uidai-required-project">*</span>
            </label>
            <input
              className="uidai-input"
              type="date"
              min={form.startDate || undefined}
              value={form.endDate || ""}
              onChange={(e) => {
                update({ endDate: e.target.value });
                clearFieldError("endDate");
              }}
            />
            {errors.endDate && (
              <div className="uidai-field-error">{errors.endDate}</div>
            )}
          </div>

          <div className="uidai-field">
            <label className="uidai-field__label">
              Organizations <span className="uidai-required-project">*</span>
            </label>
            <div className="uidai-hint" style={{ marginBottom: 8 }}>
              {vendorsLoading
                ? "Loading organizations..."
                : vendorsError
                  ? `Could not load organizations (${vendorsError}). Showing fallback list.`
                  : "Select organizations for this project"}
            </div>
            <ChipControl
              value={safeArray(form.vendors)}
              options={vendorOptions}
              onChange={(next) => update({ vendors: next })}
              label="organization"
            />
            {errors.vendors && (
              <div className="uidai-field-error">{errors.vendors}</div>
            )}
          </div>

          {canManageDocuments && (
          <div className="uidai-field">
            <label className="uidai-field__label">Documents</label>
             <div className="uidai-hint" style={{ marginBottom: 8 }}>Select Document</div>
            <input
              key={docInputKey}
              type="file"
              multiple
              accept={ALLOWED_FILE_ACCEPT}
              onChange={handleDocumentsChange}
            />
            <div className="uidai-attach-hint">
              Optional. Maximum file size: 25 MB per file. Multiple files allowed.
              Allowed types: Documents (pdf, docx, xlsx, txt, csv), Images (jpg, png, heic), Videos (mp4, webm, mov).
            </div>
            {docError && <div className="uidai-attach-error">{docError}</div>}
            {safeArray(form.documents).length > 0 && (
              <ul
                style={{
                  listStyle: "none",
                  padding: 0,
                  marginTop: 8,
                  display: "flex",
                  flexDirection: "column",
                  gap: 4
                }}
              >
                {safeArray(form.documents).map((f, idx) => (
                  <li
                    key={`${f.name}-${idx}`}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                      gap: 8,
                      padding: "4px 8px",
                      background: "#f5f5f5",
                      borderRadius: 4
                    }}
                  >
                    <span>
                      {f.name}{" "}
                      <span style={{ color: "#666", fontSize: 12 }}>
                        ({(f.size / 1024).toFixed(1)} KB)
                      </span>
                    </span>
                    <div style={{ display: "flex", gap: 6 }}>
                      <button
                        type="button"
                        className="uidai-btn"
                        style={{ padding: "2px 8px", fontSize: 12 }}
                        onClick={() => viewDocument(f)}
                      >
                        View
                      </button>
                      <button
                        type="button"
                        className="uidai-btn uidai-btn--cancel"
                        style={{ padding: "2px 8px", fontSize: 12 }}
                        onClick={() => removeDocument(idx)}
                      >
                        Remove
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
          )}
        </div>
        <p style={{ color: "red" }}>{errorCreated}</p>
        <div style={{ marginTop: 18, display: "flex", flexWrap: "wrap", gap: 10 }}>
          <button className="uidai-btn" onClick={goNext} disabled={submitting}>
            {submitting ? "Saving..." : "Save & Next"}
          </button>
          <button
            className="uidai-btn uidai-btn--cancel"
            onClick={cancel}
            disabled={submitting}
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}