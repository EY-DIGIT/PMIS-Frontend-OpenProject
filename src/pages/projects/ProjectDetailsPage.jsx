import React, { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { projectsStore, useProject } from "../../store/project/projectsStore";
import { uiStore } from "../../store/project/uiStore";
import { CATEGORY_OPTIONS, VENDOR_MASTER } from "../../utils/project/constants";
import { safeArray, deepClone } from "../../utils/project/helpers";
import {
  isVersionProject,
  isPublishedBaseline,
  getRootProjectId,
  addAudit,
  propagateBaselineDetailsToVersions,
  markSubtreeFromBaseline,
  normalizeProject
} from "../../utils/project/nodeUtils";
import ChipControl from "../../components/projects/ChipControl";
import PublishModal from "../../components/projects/modals/PublishModal";
import CreateVersionModal from "../../components/projects/modals/CreateVersionModal";
import DeleteProjectModal from "../../components/projects/modals/DeleteProjectModal";
import * as projectsApi from "../../api/projects";
import { tokenStore } from "../../api/client";
import { getToken, logout } from "../../api/auth";
import { hydrateProjects } from "../../store/project/apiSync";

const API_BASE = "http://10.1.131.199:8000";

/* "2026-04-24T23:59:59" → "2026-04-24" */
function stripTime(iso) {
  if (!iso) return "";
  const s = String(iso);
  const idx = s.indexOf("T");
  return idx > 0 ? s.slice(0, idx) : s;
}

/* "2026-04-24" → "2026-04-24T23:59:59.000Z" (end-of-day UTC). */
function toIsoDate(d) {
  if (!d) return null;
  try {
    return new Date(`${d}T23:59:59Z`).toISOString();
  } catch (e) {
    return null;
  }
}

function vendorName(v) {
  if (!v) return "";
  if (typeof v === "object") return v.name || "";
  return String(v);
}
function vendorsToNames(list) {
  return safeArray(list).map(vendorName).filter(Boolean);
}

function mapApiProject(p) {
  if (!p) return null;
  return {
    projectId: p.id || "",
    projectCode: p.projectCode || "",
    projectName: p.name || "",
    description: p.description || "",
    owner: p.owner || "",
    isPublic: p.isPublic ? "Yes" : "No",
    status: p.status ? String(p.status).toUpperCase() : "",
    statusExplanation: p.statusExplanation || "",
    startDate: stripTime(p.startDate),
    endDate: stripTime(p.endDate),
    actualEndDate: stripTime(p.actualEndDate),
    category: p.category || "",
    categoryOther: p.categoryOther || "",
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

function mergeIntoStore(mapped) {
  if (!mapped || !mapped.projectId) return false;
  try {
    if (projectsStore.find) {
      const existing = projectsStore.find(mapped.projectId);
      if (existing) {
        Object.assign(existing, {
          projectCode: mapped.projectCode,
          projectName: mapped.projectName,
          description: mapped.description,
          owner: mapped.owner,
          isPublic: mapped.isPublic,
          status: mapped.status,
          statusExplanation: mapped.statusExplanation,
          startDate: mapped.startDate,
          endDate: mapped.endDate,
          actualEndDate: mapped.actualEndDate,
          category: mapped.category,
          categoryOther: mapped.categoryOther,
          vendors: mapped.vendors,
          isVersion: mapped.isVersion,
          versionOf: mapped.versionOf,
          versionNo: mapped.versionNo,
          parentId: mapped.parentId,
          baselineId: mapped.baselineId
        });
        if (projectsStore.refresh) projectsStore.refresh();
        return true;
      }
    }
    if (projectsStore.addProject) {
      projectsStore.addProject(mapped);
      if (projectsStore.refresh) projectsStore.refresh();
      return true;
    }
  } catch (e) { /* store shape mismatch — caller keeps a local copy */ }
  return false;
}

export default function ProjectDetailsPage() {
  const { projectId } = useParams();
  const navigate = useNavigate();
  const realProject = useProject(projectId);

  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState(null);
  const [selCat, setSelCat] = useState("");
  const [otherCat, setOtherCat] = useState("");
  const [publishOpen, setPublishOpen] = useState(false);
  const [versionOpen, setVersionOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);

  const [apiProject, setApiProject] = useState(null);
  const [projectLoading, setProjectLoading] = useState(false);
  const [projectError, setProjectError] = useState("");

  // Full vendor master from GET /api/v3/vendors — [{id, name}]
  const [vendorMaster, setVendorMaster] = useState([]);

  const project = realProject || apiProject;

  /* Name → {id, name} lookup for vendors currently on this project. */
  const projectVendorIndex = useMemo(() => {
    const map = {};
    safeArray(project && project.vendors).forEach((v) => {
      if (v && typeof v === "object" && v.name) map[v.name] = v;
      else if (typeof v === "string" && v) map[v] = { name: v };
    });
    return map;
  }, [project]);

  /* Name → {id, name} lookup for the full fetched vendor master. */
  const vendorMasterIndex = useMemo(() => {
    const map = {};
    vendorMaster.forEach((v) => { if (v && v.name) map[v.name] = v; });
    return map;
  }, [vendorMaster]);

  /* Options for ChipControl. Prefer the live master, fall back to the
     hardcoded VENDOR_MASTER constant if the fetch hasn't returned yet. */
  const vendorOptions = useMemo(() => {
    const names = vendorMaster.map((v) => v && v.name).filter(Boolean);
    return names.length ? names : VENDOR_MASTER;
  }, [vendorMaster]);

  /* ─── GET /api/v3/vendors — for ChipControl options & ID resolution ─── */
  useEffect(() => {
    let cancelled = false;

    async function loadVendors() {
      const token = getToken();
      if (!token) return;
      try {
        const res = await fetch(`${API_BASE}/api/v3/vendors`, {
          method: "GET",
          headers: {
            accept: "application/json",
            Authorization: `Bearer ${token}`
          }
        });

        if (cancelled) return;
        if (res.status === 401) return; // handled by project fetch
        if (!res.ok) return;

        const raw = await res.json().catch(() => ({}));
        const elements =
          raw?.data?._embedded?.elements ??
          raw?._embedded?.elements ??
          raw?.data ??
          [];
        const mapped = Array.isArray(elements)
          ? elements
              .filter((v) => v && v.name)
              .map((v) => ({ id: v.id, name: v.name }))
          : [];

        if (!cancelled) setVendorMaster(mapped);
      } catch (e) { /* keep fallback to VENDOR_MASTER */ }
    }

    loadVendors();
    return () => { cancelled = true; };
  }, []);

  /* ─── Fetch project on mount / projectId change ─── */
  useEffect(() => {
    if (!projectId) return;

    let cancelled = false;

    async function loadProject() {
      const token = getToken();
      if (!token) {
        uiStore.showMessage("Please sign in to continue.");
        navigate("/login");
        return;
      }

      setProjectLoading(true);
      setProjectError("");
      try {
        const res = await fetch(
          `${API_BASE}/api/v3/projects/${encodeURIComponent(projectId)}`,
          {
            method: "GET",
            headers: {
              accept: "application/json",
              Authorization: `Bearer ${token}`
            }
          }
        );

        if (cancelled) return;

        if (res.status === 401) {
          logout();
          uiStore.showMessage("Session expired. Please sign in again.");
          navigate("/login");
          return;
        }

        if (!res.ok) {
          const body = await res.text().catch(() => "");
          throw new Error(body || `Failed to load project (${res.status})`);
        }

        const raw = await res.json().catch(() => ({}));
        const mapped = mapApiProject(raw?.data ?? raw);

        if (cancelled) return;

        if (mapped) {
          setApiProject(mapped);
          mergeIntoStore(mapped);
        }
      } catch (err) {
        if (!cancelled) setProjectError(err?.message || "Failed to load project");
      } finally {
        if (!cancelled) setProjectLoading(false);
      }
    }

    loadProject();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId]);

  /* ─── Populate the form whenever the project becomes available ─── */
  useEffect(() => {
    if (!project) return;
    const catInList = CATEGORY_OPTIONS.includes(project.category || "");
    setSelCat(catInList ? project.category : project.category ? "Others" : "MSAP");
    setOtherCat(!catInList && project.category ? project.category : "");
    setForm({
      projectName: project.projectName,
      description: project.description || "",
      owner: project.owner,
      startDate: project.startDate,
      endDate: project.endDate,
      isPublic: project.isPublic,
      actualEndDate: project.actualEndDate || "",
      vendors: vendorsToNames(project.vendors)
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project && project.projectId, editing]);

  /* ─── Resolve form vendor names → UUIDs.
     Check the project's own vendors first (captures freshly-unchanged),
     then the fetched master (captures newly-added from dropdown). */
  function resolveVendorIds(names) {
    return safeArray(names)
      .map((n) => {
        const name = typeof n === "object" ? n.name : String(n);
        if (!name) return null;
        const fromProject = projectVendorIndex[name];
        if (fromProject && fromProject.id) return fromProject.id;
        const fromMaster = vendorMasterIndex[name];
        if (fromMaster && fromMaster.id) return fromMaster.id;
        return null;
      })
      .filter(Boolean);
  }

  /* ─── Rebuild [{id, name}] vendor objects for the store copy. */
  function rebuildVendorObjects(names) {
    return safeArray(names)
      .map((n) => {
        const name = typeof n === "object" ? n.name : String(n);
        if (!name) return null;
        return projectVendorIndex[name] || vendorMasterIndex[name] || { name };
      })
      .filter(Boolean);
  }

  /* ─── PATCH /api/v3/projects/{id} ─── */
  async function updateProjectApi(projectServerId, finalCat, isVersionMode) {
    const token = getToken();
    if (!token) throw new Error("Your session has expired. Please sign in again.");

    const payload = {
      name: isVersionMode ? (project.projectName || "") : (form.projectName || "").trim(),
      description: (form.description || "").trim(),
      active: true,
      isPublic: form.isPublic === "Yes",
      status_explanation: project.statusExplanation || "",
      status: (project.status || "new").toLowerCase(),
      owner: (form.owner || "").trim(),
      category: finalCat || "",
      category_other: finalCat === "Others" ? (otherCat || "").trim() : "",
      vendor_ids: resolveVendorIds(form.vendors),
      startDate: toIsoDate(form.startDate),
      endDate: toIsoDate(form.endDate),
      actualEndDate: form.actualEndDate ? toIsoDate(form.actualEndDate) : null
    };
    if (project.parentId) payload.parent_id = project.parentId;

    const res = await fetch(
      `${API_BASE}/api/v3/projects/${encodeURIComponent(projectServerId)}`,
      {
        method: "PATCH",
        headers: {
          accept: "application/json",
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify(payload)
      }
    );

    if (res.status === 401) {
      logout();
      const err = new Error("Session expired. Please sign in again.");
      err.isAuth = true;
      throw err;
    }
    if (!res.ok && res.status !== 204) {
      const body = await res.text().catch(() => "");
      throw new Error(body || `Request failed (${res.status})`);
    }
    const raw = await res.json().catch(() => ({}));
    return raw?.data ?? raw ?? {};
  }

  /* ─── POST /api/v3/projects/{id}/publish ─── */
  async function publishProjectApi(projectServerId) {
    const token = getToken();
    if (!token) throw new Error("Your session has expired. Please sign in again.");

    const res = await fetch(
      `${API_BASE}/api/v3/projects/${encodeURIComponent(projectServerId)}/publish`,
      {
        method: "POST",
        headers: {
          accept: "application/json",
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({})
      }
    );

    if (res.status === 401) {
      logout();
      const err = new Error("Session expired. Please sign in again.");
      err.isAuth = true;
      throw err;
    }
    if (!res.ok && res.status !== 204) {
      const body = await res.text().catch(() => "");
      throw new Error(body || `Request failed (${res.status})`);
    }
    const raw = await res.json().catch(() => ({}));
    return raw?.data ?? raw ?? {};
  }

  /* ─── DELETE /api/v3/projects/{id} ─── */
  async function deleteProjectApi(projectServerId) {
    const token = getToken();
    if (!token) throw new Error("Your session has expired. Please sign in again.");

    const res = await fetch(
      `${API_BASE}/api/v3/projects/${encodeURIComponent(projectServerId)}`,
      {
        method: "DELETE",
        headers: {
          accept: "application/json",
          Authorization: `Bearer ${token}`
        }
      }
    );

    if (res.status === 401) {
      logout();
      const err = new Error("Session expired. Please sign in again.");
      err.isAuth = true;
      throw err;
    }
    if (!res.ok && res.status !== 204) {
      const body = await res.text().catch(() => "");
      throw new Error(body || `Request failed (${res.status})`);
    }
    return true;
  }

  if (!project) {
    if (projectLoading) {
      return (
        <div>
          <div className="uidai-page-title">Project Details</div>
          <div className="uidai-card-project">
            <div className="uidai-hint">Loading project…</div>
          </div>
        </div>
      );
    }
    return (
      <div>
        <div className="uidai-page-title">Project Details</div>
        <div className="uidai-card-project">
          <div className="uidai-hint">
            {projectError
              ? `Could not load project: ${projectError}`
              : "Project not found."}
          </div>
          <div className="uidai-card-project-actions" style={{ justifyContent: "flex-start" }}>
            <button className="uidai-btn uidai-btn--cancel" onClick={() => navigate("/projects")}>
              Back
            </button>
          </div>
        </div>
      </div>
    );
  }

  const isVersion = isVersionProject(project);
  const isPubBase = isPublishedBaseline(project);
  const canEditCat = editing && !isVersion;

  function toggleEdit() {
    if (!editing) {
      setEditing(true);
      return;
    }
    save();
  }

  function save() {
    if (!form) return;
    const finalCat =
      selCat === "Others" ? (otherCat || "").trim() : selCat;
    if (canEditCat && selCat === "Others" && !finalCat) {
      uiStore.showMessage("Please specify the category.");
      return;
    }
    if (!form.owner.trim() || (!isVersion && (!form.projectName.trim() || !form.startDate || !form.endDate))) {
      uiStore.showMessage("Fill required fields.");
      return;
    }
    if (!isVersion && form.endDate && form.startDate && form.endDate < form.startDate) {
      uiStore.showMessage("Expected End Date cannot be earlier than Expected Start Date.");
      return;
    }

    const rebuiltVendors = rebuildVendorObjects(form.vendors);

    const doLocal = (apiData) => {
      const all = projectsStore.getAll ? projectsStore.getAll() : [];
      let target = all.find((p) => p.projectId === project.projectId);
      if (!target) target = apiProject;
      if (!target) { uiStore.hideLoader(); return; }
      const before = deepClone(target);
      if (isVersion) {
        target.owner = form.owner.trim();
        target.isPublic = form.isPublic;
        target.actualEndDate = form.actualEndDate || "";
        target.vendors = rebuiltVendors;
      } else {
        target.projectName = form.projectName.trim();
        target.description = form.description.trim();
        target.owner = form.owner.trim();
        target.startDate = form.startDate;
        target.endDate = form.endDate;
        target.isPublic = form.isPublic;
        target.category = finalCat;
        target.vendors = rebuiltVendors;
      }
      addAudit(target, "Update Project Details", before, deepClone(target));
      if (!isVersion) propagateBaselineDetailsToVersions(all, target);
      try { if (projectsStore.refresh) projectsStore.refresh(); } catch (e) {}

      // Refresh local apiProject from API response, if present — guarantees
      // a fresh reference so React re-renders with authoritative server data.
      if (apiData && apiData.id) {
        const mapped = mapApiProject(apiData);
        if (mapped) setApiProject(mapped);
      } else {
        setApiProject({ ...target });
      }

      uiStore.hideLoader();
      setEditing(false);
      uiStore.showMessage("Project details saved");
    };

    uiStore.showLoader("Saving project details...");

    if (getToken()) {
      updateProjectApi(project.projectId, finalCat, isVersion)
        .then((updated) => { doLocal(updated); })
        .catch((err) => {
          uiStore.hideLoader();
          if (err && err.isAuth) {
            uiStore.showMessage(err.message);
            navigate("/login");
            return;
          }
          uiStore.showMessage(err?.message || "Failed to save project details");
        });
    } else {
      setTimeout(() => doLocal(null), 600);
    }
  }

  function confirmPublish() {
    setPublishOpen(false);
    uiStore.showLoader("Publishing project...");

    const doLocal = (apiData) => {
      const target = projectsStore.find ? projectsStore.find(project.projectId) : null;
      const t = target || apiProject;
      if (!t) { uiStore.hideLoader(); return; }
      const before = deepClone(t);
      t.status = (apiData && apiData.status ? String(apiData.status).toUpperCase() : "PUBLISHED");
      t.baselineId = apiData && apiData.baselineId ? apiData.baselineId : (t.baselineId || "-");
      addAudit(t, "Publish Project", before, deepClone(t));
      try { if (projectsStore.refresh) projectsStore.refresh(); } catch (e) {}

      if (apiData && apiData.id) {
        const mapped = mapApiProject(apiData);
        if (mapped) setApiProject(mapped);
      } else {
        setApiProject({ ...t });
      }

      uiStore.hideLoader();
      uiStore.showMessage("Project published successfully");
    };

    if (getToken()) {
      publishProjectApi(project.projectId)
        .then((updated) => { doLocal(updated); })
        .catch((err) => {
          uiStore.hideLoader();
          if (err && err.isAuth) {
            uiStore.showMessage(err.message);
            navigate("/login");
            return;
          }
          uiStore.showMessage(err?.message || "Failed to publish project");
        });
    } else {
      setTimeout(() => doLocal(null), 900);
    }
  }

  function confirmCreateVersion() {
    setVersionOpen(false);
    uiStore.showLoader("Creating version...");
    const doLocal = (overrideId) => {
      const base = getRootProjectId(project);
      const src = projectsStore.find(project.projectId);
      if (!src) { uiStore.hideLoader(); return; }
      const np = deepClone(src);
      np.projectId = overrideId || projectsStore.getNextVersionId(base);
      np.versionOf = base;
      np.isVersion = true;
      np.versionNo = (src.versionNo || 0) + 1;
      np.baselineId = base;
      np.status = "NEW";
      np.actualEndDate = "";
      np.auditLogs = [];
      safeArray(np.milestones).forEach(markSubtreeFromBaseline);
      normalizeProject(np);
      projectsStore.addProject(np);
      addAudit(np, "Create Version", deepClone(src), deepClone(np));
      projectsStore.refresh();
      uiStore.hideLoader();
      uiStore.showMessage("Version created successfully", () =>
        navigate(`/projects/${encodeURIComponent(np.projectId)}`)
      );
    };
    if (tokenStore.get()) {
      projectsApi.createVersion(project.projectId)
        .then((newProject) => { hydrateProjects({ force: true }); doLocal(newProject?.projectId); })
        .catch((err) => { uiStore.hideLoader(); uiStore.showMessage(err?.message || "Failed to create version"); });
    } else {
      setTimeout(() => doLocal(), 900);
    }
  }

  function confirmDelete() {
    setDeleteOpen(false);
    uiStore.showLoader("Removing project...");

    const finish = () => {
      try {
        if (projectsStore.removeProject) projectsStore.removeProject(project.projectId);
      } catch (e) {}
      uiStore.hideLoader();
      uiStore.showMessage("Project removed", () => navigate("/projects"));
    };

    if (getToken()) {
      deleteProjectApi(project.projectId)
        .then(() => { finish(); })
        .catch((err) => {
          uiStore.hideLoader();
          if (err && err.isAuth) {
            uiStore.showMessage(err.message);
            navigate("/login");
            return;
          }
          uiStore.showMessage(err?.message || "Failed to delete project");
        });
    } else {
      setTimeout(finish, 600);
    }
  }

  const disclaimer = isPubBase
    ? "This is a published baseline project. You can still edit it — all changes will automatically be mirrored to every version created from this baseline."
    : isVersion
    ? "This is a version project. Version projects can edit Owner, Is Public, Actual End Date, and their own hierarchy. Changes to a version do NOT propagate back to the baseline."
    : "Complete project details and milestone configuration, then publish to create a baseline.";

  const versionId = projectsStore.getNextVersionId
    ? projectsStore.getNextVersionId(getRootProjectId(project))
    : "";

  if (!form) return null;

  return (
    <div>
      <div className="uidai-page-header">
        <div className="uidai-page-title">Project Details</div>
        <div className="uidai-page-header__actions">
          <button className="uidai-btn" onClick={toggleEdit}>
            {editing ? "Save" : "Edit"}
          </button>
          {!isVersion && project.status !== "PUBLISHED" && (
            <button
              className="uidai-btn"
              disabled={editing}
              onClick={() => setPublishOpen(true)}
            >
              Publish
            </button>
          )}
          {!isVersion && project.status === "PUBLISHED" && (
            <button
              className="uidai-btn"
              disabled={editing}
              onClick={() => setVersionOpen(true)}
            >
              Create Version
            </button>
          )}
          <button
            className="uidai-btn"
            disabled={editing}
            onClick={() =>
              navigate(`/projects/${encodeURIComponent(project.projectId)}/config`)
            }
          >
            Go to Milestones Configuration
          </button>
          <button
            className="uidai-btn uidai-btn--delete"
            disabled={editing}
            onClick={() => setDeleteOpen(true)}
          >
            Remove Project
          </button>
          <button className="uidai-btn uidai-btn--cancel" onClick={() => navigate("/projects")}>
            Back
          </button>
        </div>
      </div>

      <div className="uidai-card-project">
        <h3>Project Information</h3>
        <div className="uidai-hint" style={{ marginBottom: 12 }}>
          {disclaimer}
        </div>
        <div className="uidai-grid">
          <div className="uidai-field">
            <label className="uidai-field__label">Project ID</label>
            <input className="uidai-input" value={project.projectCode || project.projectId} disabled />
          </div>
          <div className="uidai-field">
            <label className="uidai-field__label">
              Project Name <span className="uidai-required-project">*</span>
            </label>
            <input
              className="uidai-input"
              value={form.projectName}
              onChange={(e) => setForm((f) => ({ ...f, projectName: e.target.value }))}
              disabled={!(editing && !isVersion)}
            />
          </div>
          <div className="uidai-field">
            <label className="uidai-field__label">Baseline ID</label>
            <input className="uidai-input" value={project.baselineId || "-"} disabled />
          </div>
          <div className="uidai-field">
            <label className="uidai-field__label">Status</label>
            <input className="uidai-input" value={project.status} disabled />
          </div>
          <div className="uidai-field uidai-grid__full">
            <label className="uidai-field__label">Description</label>
            <textarea
              className="uidai-textarea"
              maxLength={5000}
              value={form.description}
              onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
              disabled={!(editing && !isVersion)}
            />
            <div className="uidai-char-count">
              {5000 - form.description.length} characters remaining
            </div>
          </div>
          <div className="uidai-field">
            <label className="uidai-field__label">
              Owner <span className="uidai-required-project">*</span>
            </label>
            <input
              className="uidai-input"
              value={form.owner}
              onChange={(e) => setForm((f) => ({ ...f, owner: e.target.value }))}
              disabled={!editing}
            />
          </div>
          <div className="uidai-field">
            <label className="uidai-field__label">
              Expected Start Date <span className="uidai-required-project">*</span>
            </label>
            <input
              className="uidai-input"
              type="date"
              value={form.startDate}
              onChange={(e) => setForm((f) => ({ ...f, startDate: e.target.value }))}
              disabled={!(editing && !isVersion)}
            />
          </div>
          <div className="uidai-field">
            <label className="uidai-field__label">
              Expected End Date <span className="uidai-required-project">*</span>
            </label>
            <input
              className="uidai-input"
              type="date"
              value={form.endDate}
              onChange={(e) => setForm((f) => ({ ...f, endDate: e.target.value }))}
              disabled={!(editing && !isVersion)}
            />
          </div>
          {isVersion && (
            <div className="uidai-field">
              <label className="uidai-field__label">Actual End Date</label>
              <input
                className="uidai-input"
                type="date"
                value={form.actualEndDate}
                onChange={(e) => setForm((f) => ({ ...f, actualEndDate: e.target.value }))}
                disabled={!editing}
              />
            </div>
          )}
          <div className="uidai-field">
            <label className="uidai-field__label">
              Is Public <span className="uidai-required-project">*</span>
            </label>
            <select
              className="uidai-select"
              value={form.isPublic}
              onChange={(e) => setForm((f) => ({ ...f, isPublic: e.target.value }))}
              disabled={!editing}
            >
              <option>Yes</option>
              <option>No</option>
            </select>
          </div>
          <div className="uidai-field">
            <label className="uidai-field__label">
              Category <span className="uidai-required-project">*</span>
            </label>
            {canEditCat ? (
              <>
                <select
                  className="uidai-select"
                  value={selCat}
                  onChange={(e) => setSelCat(e.target.value)}
                >
                  {CATEGORY_OPTIONS.map((c) => (
                    <option key={c}>{c}</option>
                  ))}
                </select>
                {selCat === "Others" && (
                  <input
                    className="uidai-input"
                    style={{ marginTop: 6 }}
                    placeholder="Specify category"
                    value={otherCat}
                    onChange={(e) => setOtherCat(e.target.value)}
                  />
                )}
              </>
            ) : (
              <input className="uidai-input" value={project.category || ""} disabled />
            )}
          </div>
        </div>

        <div style={{ marginTop: 18 }}>
          <h4 style={{ color: "#173e77", marginBottom: 8 }}>Associated Vendors</h4>
          <ChipControl
            value={form.vendors}
            options={vendorOptions}
            onChange={(next) => setForm((f) => ({ ...f, vendors: next }))}
            label="vendor"
            disabled={!editing}
          />
        </div>
      </div>

      <PublishModal
        open={publishOpen}
        project={project}
        onCancel={() => setPublishOpen(false)}
        onConfirm={confirmPublish}
      />
      <CreateVersionModal
        open={versionOpen}
        project={project}
        newId={versionId}
        onCancel={() => setVersionOpen(false)}
        onConfirm={confirmCreateVersion}
      />
      <DeleteProjectModal
        open={deleteOpen}
        project={project}
        onCancel={() => setDeleteOpen(false)}
        onConfirm={confirmDelete}
      />
    </div>
  );
}