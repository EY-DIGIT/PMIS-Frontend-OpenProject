/* ══════════════════════════════════════════════════════════════════
   src/utils/project/milestoneConfigHelpers.js

   Pure helpers used by MilestoneConfigPage:
   - Date/ISO string conversions
   - API ↔ UI status and type mapping
   - Vendor ID resolution against a project
   - Error body extraction
   - API-response → local node/project shape mappers
   - Activity endpoint / server-type resolvers
   - LocalStorage draft persistence for onboarding
   ══════════════════════════════════════════════════════════════════ */

import { generateNodeUid, safeArray } from "./helpers";

/* ─── Onboarding draft persistence ─── */
export const DRAFT_STORAGE_KEY = "uidai_onboarding_draft";

export function persistOnboardingDraft(p) {
  if (!p || !p.projectId) return;
  try {
    const snapshot = {
      projectId: p.projectId,
      projectName: p.projectName,
      description: p.description,
      owner: p.owner,
      isPublic: p.isPublic,
      category: p.category,
      startDate: p.startDate,
      endDate: p.endDate,
      vendors: safeArray(p.vendors),
      baselineId: p.baselineId || "-",
      status: p.status || "DRAFT",
      isVersion: !!p.isVersion
    };
    localStorage.setItem(DRAFT_STORAGE_KEY, JSON.stringify(snapshot));
  } catch (e) {}
}

export function readPersistedOnboardingDraft() {
  try {
    const raw = localStorage.getItem(DRAFT_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return parsed && parsed.projectId ? parsed : null;
  } catch (e) {
    return null;
  }
}

export function clearPersistedOnboardingDraft() {
  try { localStorage.removeItem(DRAFT_STORAGE_KEY); } catch (e) {}
}

/* ─── Date conversions ─── */
export function toMilestoneIsoStart(d) {
  if (!d) return null;
  return new Date(`${d}T00:00:00Z`).toISOString();
}

export function toMilestoneIsoEnd(d) {
  if (!d) return null;
  return new Date(`${d}T23:59:59Z`).toISOString();
}

export function toDateInputValue(iso) {
  if (!iso) return "";
  const s = String(iso);
  const tIdx = s.indexOf("T");
  return tIdx > 0 ? s.slice(0, tIdx) : s;
}

export function stripTime(iso) {
  if (!iso) return "";
  const s = String(iso);
  const idx = s.indexOf("T");
  return idx > 0 ? s.slice(0, idx) : s;
}

/* ─── Status mapping ─── */
export function mapStatusForApi(s) {
  return s === "Completed" ? "completed" : "not_completed";
}

export function mapStatusFromApi(s) {
  return s === "completed" ? "Completed" : "Not Completed";
}

/* ─── Vendor name → UUID resolution (uses project.vendors) ─── */
export function resolveVendorIds(project, vendorName) {
  if (!vendorName) return [];
  const vendors = safeArray(project && project.vendors);
  const match = vendors.find((v) => {
    if (v && typeof v === "object") return v.name === vendorName;
    return v === vendorName;
  });
  if (match && typeof match === "object" && match.id) return [match.id];
  return [];
}

/* ─── Pull a friendly message out of a server error body ─── */
export async function readErrorBody(res) {
  const body = await res.text().catch(() => "");
  if (!body) return `Request failed (${res.status})`;
  try {
    const parsed = JSON.parse(body);
    return parsed?.error?.message || parsed?.message || parsed?.detail || body;
  } catch (e) {
    return body;
  }
}

/* ─── API → local project shape ─── */
export function mapApiProject(p) {
  if (!p) return null;
  return {
    projectId: p.id || "",
    projectCode: p.projectCode || "",
    projectName: p.name || "",
    description: p.description || "",
    owner: p.owner || "",
    isPublic: p.isPublic ? "Yes" : "No",
    status: p.status ? String(p.status).toUpperCase() : "",
    startDate: stripTime(p.startDate),
    endDate: stripTime(p.endDate),
    actualEndDate: stripTime(p.actualEndDate),
    category: p.category || "",
    categoryOther: p.categoryOther || "",
    categoryOtherReason: p.categoryOtherReason || "",
    vendors: Array.isArray(p.vendors) ? p.vendors : [],
    isVersion: !!p.isVersion,
    versionOf: p.versionOf || null,
    versionNo: p.versionNo || null,
    parentId: p.parentId || null,
    baselineId: p.baselineId || "-",
    milestones: [],
    auditLogs: [],
    resources: []
  };
}

/* ─── API → local milestone node ─── */
export function mapApiMilestoneToNode(m) {
  const vendors = Array.isArray(m.vendors) ? m.vendors : [];
  return {
    uid: generateNodeUid("m"),
    apiId: m.id || "",
    id: m.id || "",
    name: m.name || "",
    description: m.description || "",
    startDate: toDateInputValue(m.startDate),
    endDate: toDateInputValue(m.endDate),
    status: mapStatusFromApi(m.status),
    vendor: vendors.length ? vendors[0].name || "" : "",
    dependsOn: [],
    activities: [],
    comments: [],
    attachments: [],
    position: typeof m.position === "number" ? m.position : undefined
  };
}

/* ─── API → local activity node. Stashes raw server type/resourceMode so
   PATCH can round-trip them even when the UI hasn't changed the type. */
export function mapApiActivityToNode(a) {
  const apiType = String(a?.type || "").toLowerCase();
  let uiType = "Standard Type";
  let resourceEntryType = "details";

  if (apiType === "resource") {
    uiType = "Resource Type";
    resourceEntryType = a.resourceMode === "count" ? "count" : "details";
  } else if (apiType === "transactional") {
    uiType = "Transactional";
  }

  const node = {
    uid: generateNodeUid("a"),
    apiId: a.id || "",
    id: a.id || "",
    apiType: apiType || "standard",
    apiResourceMode: a.resourceMode || null,
    name: a.name || "",
    description: a.description || "",
    startDate: toDateInputValue(a.startDate),
    endDate: toDateInputValue(a.endDate),
    actualStartDate: toDateInputValue(a.actualStartDate),
    actualEndDate: toDateInputValue(a.actualEndDate),
    status: mapStatusFromApi(a.status),
    type: uiType,
    resourceEntryType,
    dependsOn: [],
    tasks: [],
    comments: [],
    attachments: [],
    position: typeof a.position === "number" ? a.position : 0
  };

  if (apiType === "resource" && a.resourceMode === "count") {
    node.resourceCount = {
      resType: "RFP",
      count: a.resourceCount || 1,
      onboardingDate: "",
      division: ""
    };
  }

  if (apiType === "resource" && a.resourceMode === "details" && a.resource) {
    const r = a.resource || {};
    node.resourceDetails = {
      resourceName: r.resourceName || "",
      resType: r.typeOfResourceId || "RFP",
      division: r.division || "",
      onboardingDate: toDateInputValue(r.onboardDate),
      offboardingDate: toDateInputValue(r.offboardDate),
      actualOnboardingDate: toDateInputValue(r.actualOnboardDate),
      actualOffboardingDate: toDateInputValue(r.actualOffboardDate),
      position: r.position || "",
      designation: r.designation || "",
      jobRole: r.jobRole || "",
      qualification: r.qualification || "",
      experience: r.experienceYears != null ? String(r.experienceYears) : ""
    };
  }

  return node;
}

/* ─── Extract { data: { _embedded: { elements: [...] } } } safely. */
export function extractListElements(raw) {
  const elements =
    raw?.data?._embedded?.elements ??
    raw?._embedded?.elements ??
    raw?.data ??
    [];
  return Array.isArray(elements) ? elements : [];
}

/* ─── Which create endpoint to POST to based on UI state. */
export function activityEndpointFor(formData) {
  const t = String(formData?.type || "").toLowerCase();
  if (t.includes("resource")) {
    return (formData.resourceEntryType === "count") ? "resource/count" : "resource/details";
  }
  if (t.includes("transactional")) return "transactional";
  return "standard";
}

/* ─── UI labels → server's (type, resourceMode) pair for PATCH. */
export function activityServerTypePair(formData) {
  const t = String(formData?.type || "").toLowerCase();
  if (t.includes("resource")) {
    return {
      type: "resource",
      resourceMode: formData.resourceEntryType === "count" ? "count" : "details"
    };
  }
  if (t.includes("transactional")) return { type: "transactional", resourceMode: null };
  return { type: "standard", resourceMode: null };
}
