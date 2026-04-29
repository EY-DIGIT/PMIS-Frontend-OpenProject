import React, { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { draftStore, useDraft } from "../../store/project/draftStore";
import { uiStore } from "../../store/project/uiStore";
import { CATEGORY_OPTIONS, VENDOR_MASTER } from "../../utils/project/constants";
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
    startDate: "",
    endDate: "",
    actualEndDate: "",
    isPublic: "Yes",
    category: "",
    categoryOtherReason: "",
    isVersion: false,
    versionOf: "",
    versionNo: 0,
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
    startDate: maybeDraft.startDate || "",
    endDate: maybeDraft.endDate || "",
    actualEndDate: maybeDraft.actualEndDate || "",
    isPublic: maybeDraft.isPublic || "Yes",
    category: maybeDraft.category || "",
    categoryOtherReason: maybeDraft.categoryOtherReason || "",
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

function tomorrowStr() {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
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
  const minDate = tomorrowStr();

  const categoryInList = CATEGORY_OPTIONS.includes(form.category);
  const selCat = categoryInList ? form.category : form.category ? "Others" : "MSAP";
  const otherCat = !categoryInList && form.category ? form.category : "";

  const [otherCategory, setOtherCategory] = useState(otherCat);
  const [otherCategoryReason, setOtherCategoryReason] = useState(form.categoryOtherReason || "");
  const [selectedCategory, setSelectedCategory] = useState(selCat);

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

  function buildPayload() {
    const isOther = selectedCategory === "Others";
    const selectedNames = safeArray(form.vendors);
    const vendorIds = selectedNames.map((n) => vendorNameToId[n]).filter(Boolean);

    return {
      name: (form.projectName || "").trim(),
      description: (form.description || "").trim(),
      active: true,
      isPublic: form.isPublic === "Yes",
      status_explanation: "",
      status: "new",
      owner: (form.owner || "").trim(),
      category: isOther ? "Others" : selectedCategory,
      category_other: isOther ? otherCategory.trim() : "",
      category_other_reason: isOther ? otherCategoryReason.trim() : "",
      vendor_ids: vendorIds,
      startDate: toIso(form.startDate),
      endDate: toIso(form.endDate)
    };
  }

  async function goNext() {
    if (submitting) return;

    const finalCat =
      selectedCategory === "Others" ? otherCategory.trim() : selectedCategory;
    if (selectedCategory === "Others" && !otherCategory.trim()) {
      setErrorCreated("Please specify the category.");
      return;
    }
    if (selectedCategory === "Others" && !otherCategoryReason.trim()) {
      setErrorCreated("Please provide a reason for the 'Others' category.");
      return;
    }
    if (!(form.projectName || "").trim() || !(form.owner || "").trim() || !form.startDate || !form.endDate) {
      setErrorCreated("Fill required fields");
      return;
    }
    if (form.startDate < minDate) {
      setErrorCreated("Expected Start Date must be a future date.");
      return;
    }
    if (form.endDate < minDate) {
      setErrorCreated("Expected End Date must be a future date.");
      return;
    }
    if (form.endDate < form.startDate) {
      setErrorCreated("Expected End Date cannot be earlier than Expected Start Date.");
      return;
    }

    const token = getToken();
    if (!token) {
      setErrorCreated("Your session has expired. Please sign in again.");
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
        setErrorCreated("Session expired. Please sign in again.");
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
        category: finalCat,
        categoryOtherReason: selectedCategory === "Others" ? otherCategoryReason.trim() : "",
        baselineId: "-",
        status: "DRAFT",
        milestones: safeArray(form.milestones),
        vendors: Array.isArray(created.vendors) && created.vendors.length
          ? created.vendors
          : safeArray(form.vendors)
      };
      draftStore.set(next);
      navigate("/projects/add/config");
    } catch (err) {
      setErrorCreated(err?.message || "Failed to create project");
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
          <div className="uidai-field">
            <label className="uidai-field__label">
              Project Name <span className="uidai-required-project">*</span>
            </label>
            <input
              className="uidai-input"
              value={form.projectName || ""}
              onChange={(e) => update({ projectName: e.target.value })}
            />
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

          <div className="uidai-field">
            <label className="uidai-field__label">
              Owner <span className="uidai-required-project">*</span>
            </label>
            <select
              className="uidai-select"
              value={form.owner || ""}
              onChange={(e) => update({ owner: e.target.value })}
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
          </div>

          <div className="uidai-field">
            <label className="uidai-field__label">
              Expected Start Date <span className="uidai-required-project">*</span>
            </label>
            <input
              className="uidai-input"
              type="date"
              min={minDate}
              value={form.startDate || ""}
              onChange={(e) => update({ startDate: e.target.value })}
            />
          </div>

          <div className="uidai-field">
            <label className="uidai-field__label">
              Expected End Date <span className="uidai-required-project">*</span>
            </label>
            <input
              className="uidai-input"
              type="date"
              min={form.startDate || minDate}
              value={form.endDate || ""}
              onChange={(e) => update({ endDate: e.target.value })}
            />
          </div>

          <div className="uidai-field">
            <label className="uidai-field__label">
              Is Public <span className="uidai-required-project">*</span>
            </label>
            <select
              className="uidai-select"
              value={form.isPublic || "Yes"}
              onChange={(e) => update({ isPublic: e.target.value })}
            >
              <option>Yes</option>
              <option>No</option>
            </select>
          </div>

          <div className="uidai-field">
            <label className="uidai-field__label">
              Category <span className="uidai-required-project">*</span>
            </label>
            <select
              className="uidai-select"
              value={selectedCategory}
              onChange={(e) => setSelectedCategory(e.target.value)}
            >
              {CATEGORY_OPTIONS.map((c) => (
                <option key={c}>{c}</option>
              ))}
            </select>
          </div>

          {selectedCategory === "Others" && (
            <>
              <div className="uidai-field">
                <label className="uidai-field__label">
                  Specify Category <span className="uidai-required-project">*</span>
                </label>
                <input
                  className="uidai-input"
                  value={otherCategory}
                  onChange={(e) => setOtherCategory(e.target.value)}
                />
              </div>
              <div className="uidai-field uidai-grid__full">
                <label className="uidai-field__label">
                  Reason for 'Others' <span className="uidai-required-project">*</span>
                </label>
                <textarea
                  className="uidai-textarea"
                  maxLength={1000}
                  value={otherCategoryReason}
                  onChange={(e) => setOtherCategoryReason(e.target.value)}
                />
                <div className="uidai-char-count">
                  {1000 - otherCategoryReason.length} characters remaining
                </div>
              </div>
            </>
          )}

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