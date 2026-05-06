import React, { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { draftStore, useDraft } from "../../store/project/draftStore";
import { uiStore } from "../../store/project/uiStore";
import { VENDOR_MASTER } from "../../utils/project/constants";
import { safeArray } from "../../utils/project/helpers";
import ChipControl from "../../components/projects/ChipControl";
import { getToken, logout } from "../../api/auth";
import { ENDPOINTS } from "../../api/endpoint";
import { API_BASE, authorizedFetch } from "../../api/client";

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
    resources: []
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
    resources: safeArray(maybeDraft.resources)
  };
}

function toIso(d) {
  if (!d) return null;
  return new Date(`${d}T23:59:59Z`).toISOString();
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
  const existingDraft = useDraft();

  // Always initialize with a fully-shaped object — prevents blank-page crashes
  // when a partial/stale draft arrives (e.g. restored from localStorage with
  // description undefined).
  const [form, setForm] = useState(() => normalizeFormShape(existingDraft));
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
          throw new Error(errBody || `Failed to load vendors (${res.status})`);
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
          throw new Error(errBody || `Failed to load divisions (${res.status})`);
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

  const selectedDivision = divisionOptions.find((d) => d.code === form.owner);
  const ownerRequiresOther =
    !!selectedDivision &&
    (selectedDivision.requiresOther ||
      String(selectedDivision.label || "").toLowerCase() === "others" ||
      String(selectedDivision.code || "").toLowerCase() === "others");

  function buildPayload() {
    const selectedNames = safeArray(form.vendors);
    const vendorIds = selectedNames.map((n) => vendorNameToId[n]).filter(Boolean);

    return {
      name: (form.projectName || "").trim(),
      description: (form.description || "").trim(),
      active: true,
      status_explanation: "",
      status: "new",
      owner: (form.owner || "").trim(),
      ownerOther: ownerRequiresOther ? (form.ownerOther || "").trim() : "",
      vendor_ids: vendorIds,
      startDate: toIso(form.startDate),
      endDate: toIso(form.endDate)
    };
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
      const res = await authorizedFetch(`${API_BASE}${ENDPOINTS.projects.create}`, {
        method: "POST",
        headers: {
          accept: "application/json",
          "Content-Type": "application/json"
        },
        body: JSON.stringify(buildPayload())
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
        throw new Error(errBody || `Request failed (${res.status})`);
      }

      const raw = await res.json().catch(() => ({}));
      const created = raw?.data ?? raw ?? {};

      const next = {
        ...form,
        projectId: created.id ?? created._id ?? created.projectId ?? null,
        projectCode: created.projectCode ?? created.project_code ?? "",
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

          <div className="uidai-field uidai-grid__full">
            <label className="uidai-field__label">Associated Vendors</label>
            <div className="uidai-hint" style={{ marginBottom: 8 }}>
              {vendorsLoading
                ? "Loading vendors..."
                : vendorsError
                  ? `Could not load vendors (${vendorsError}). Showing fallback list.`
                  : "Select vendors for this project"}
            </div>
            <ChipControl
              value={safeArray(form.vendors)}
              options={vendorOptions}
              onChange={(next) => update({ vendors: next })}
              label="vendor"
            />
          </div>
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