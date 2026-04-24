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
import { tokenStore } from "../../api/client";
import { getToken, logout } from "../../api/auth";
import { hydrateProjects } from "../../store/project/apiSync";

const API_BASE = "http://10.1.131.199:8000";

function stripTime(iso) {
  if (!iso) return "";
  const s = String(iso);
  const idx = s.indexOf("T");
  return idx > 0 ? s.slice(0, idx) : s;
}

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

/* Pull a friendly message out of a server error body. The backend wraps
   errors as { error: { message, errorIdentifier, _embedded: { details } } }. */
async function readErrorMessage(res) {
  const body = await res.text().catch(() => "");
  if (!body) return `Request failed (${res.status})`;
  try {
    const parsed = JSON.parse(body);
    return (
      parsed?.error?.message ||
      parsed?.message ||
      parsed?.detail ||
      body
    );
  } catch (e) {
    return body;
  }
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
          categoryOtherReason: mapped.categoryOtherReason,
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
  const [otherCatReason, setOtherCatReason] = useState("");
  const [publishOpen, setPublishOpen] = useState(false);
  const [versionOpen, setVersionOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);

  const [apiProject, setApiProject] = useState(null);
  const [projectLoading, setProjectLoading] = useState(false);
  const [projectError, setProjectError] = useState("");

  const [vendorMaster, setVendorMaster] = useState([]);

  const project = realProject || apiProject;

  const projectVendorIndex = useMemo(() => {
    const map = {};
    safeArray(project && project.vendors).forEach((v) => {
      if (v && typeof v === "object" && v.name) map[v.name] = v;
      else if (typeof v === "string" && v) map[v] = { name: v };
    });
    return map;
  }, [project]);

  const vendorMasterIndex = useMemo(() => {
    const map = {};
    vendorMaster.forEach((v) => { if (v && v.name) map[v.name] = v; });
    return map;
  }, [vendorMaster]);

  const vendorOptions = useMemo(() => {
    const names = vendorMaster.map((v) => v && v.name).filter(Boolean);
    return names.length ? names : VENDOR_MASTER;
  }, [vendorMaster]);

  /* ─── GET /api/v3/vendors ─── */
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
        if (res.status === 401) return;
        if (!res.ok) {
          const msg = await readErrorMessage(res);
          uiStore.showError(msg);
          return;
        }

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
      } catch (err) {
        if (!cancelled) uiStore.showError(err?.message || "Failed to load vendors");
      }
    }

    loadVendors();
    return () => { cancelled = true; };
  }, []);

  /* ─── GET /api/v3/projects/{id} ─── */
  useEffect(() => {
    if (!projectId) return;

    let cancelled = false;

    async function loadProject() {
      const token = getToken();
      if (!token) {
        uiStore.showError("Please sign in to continue");
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
          uiStore.showError("Session expired. Please sign in again.");
          navigate("/login");
          return;
        }

        if (!res.ok) {
          const msg = await readErrorMessage(res);
          throw new Error(msg);
        }

        const raw = await res.json().catch(() => ({}));
        const mapped = mapApiProject(raw?.data ?? raw);

        if (cancelled) return;

        if (mapped) {
          setApiProject(mapped);
          mergeIntoStore(mapped);
        }
      } catch (err) {
        if (!cancelled) {
          const msg = err?.message || "Failed to load project";
          setProjectError(msg);
          uiStore.showError(msg);
        }
      } finally {
        if (!cancelled) setProjectLoading(false);
      }
    }

    loadProject();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId]);

  useEffect(() => {
    if (!project) return;
    const catInList = CATEGORY_OPTIONS.includes(project.category || "");
    setSelCat(catInList ? project.category : project.category ? "Others" : "MSAP");
    setOtherCat(!catInList && project.category ? project.category : "");
    setOtherCatReason(project.categoryOtherReason || "");
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

  function rebuildVendorObjects(names) {
    return safeArray(names)
      .map((n) => {
        const name = typeof n === "object" ? n.name : String(n);
        if (!name) return null;
        return projectVendorIndex[name] || vendorMasterIndex[name] || { name };
      })
      .filter(Boolean);
  }

  /* ─── PATCH /api/v3/projects/{id}
     Server enforces a different editable-field set for version vs baseline
     projects. Sending a forbidden field returns 422 with errorIdentifier
     "invalid_field". So branch the payload by mode. */
  async function updateProjectApi(projectServerId, finalCat, isVersionMode) {
    const token = getToken();
    if (!token) throw new Error("Your session has expired. Please sign in again.");

    let payload;
    if (isVersionMode) {
      // Version projects: only owner, isPublic, actualEndDate,
      // status_explanation are editable per the server.
      payload = {
        owner: (form.owner || "").trim(),
        isPublic: form.isPublic === "Yes",
        actualEndDate: form.actualEndDate ? toIsoDate(form.actualEndDate) : null,
        status_explanation: project.statusExplanation || ""
      };
    } else {
      // Baseline / new projects: full edit allowed.
      payload = {
        name: (form.projectName || "").trim(),
        description: (form.description || "").trim(),
        active: true,
        isPublic: form.isPublic === "Yes",
        status_explanation: project.statusExplanation || "",
        status: (project.status || "new").toLowerCase(),
        owner: (form.owner || "").trim(),
        category: finalCat || "",
        category_other: finalCat === "Others" ? (otherCat || "").trim() : "",
        category_other_reason: finalCat === "Others" ? (otherCatReason || "").trim() : "",
        vendor_ids: resolveVendorIds(form.vendors),
        startDate: toIsoDate(form.startDate),
        endDate: toIsoDate(form.endDate),
        actualEndDate: form.actualEndDate ? toIsoDate(form.actualEndDate) : null
      };
      // parent_id only meaningful when present — sending empty string causes
      // some endpoints to choke.
      if (project.parentId) payload.parent_id = project.parentId;
    }

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
      const msg = await readErrorMessage(res);
      throw new Error(msg);
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
      const msg = await readErrorMessage(res);
      throw new Error(msg);
    }
    const raw = await res.json().catch(() => ({}));
    return raw?.data ?? raw ?? {};
  }

  /* ─── POST /api/v3/projects/{id}/versions/create ─── */
  async function createVersionApi(projectServerId) {
    const token = getToken();
    if (!token) throw new Error("Your session has expired. Please sign in again.");

    const res = await fetch(
      `${API_BASE}/api/v3/projects/${encodeURIComponent(projectServerId)}/versions/create`,
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
      const msg = await readErrorMessage(res);
      throw new Error(msg);
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
      const msg = await readErrorMessage(res);
      throw new Error(msg);
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
      uiStore.showError("Please specify the category.");
      return;
    }
    if (canEditCat && selCat === "Others" && !(otherCatReason || "").trim()) {
      uiStore.showError("Please provide a reason for the 'Others' category.");
      return;
    }
    if (!form.owner.trim() || (!isVersion && (!form.projectName.trim() || !form.startDate || !form.endDate))) {
      uiStore.showError("Fill required fields.");
      return;
    }
    if (!isVersion && form.endDate && form.startDate && form.endDate < form.startDate) {
      uiStore.showError("Expected End Date cannot be earlier than Expected Start Date.");
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
        // Match the API contract: only owner, isPublic, actualEndDate,
        // status_explanation are tracked locally for version projects.
        target.owner = form.owner.trim();
        target.isPublic = form.isPublic;
        target.actualEndDate = form.actualEndDate || "";
      } else {
        target.projectName = form.projectName.trim();
        target.description = form.description.trim();
        target.owner = form.owner.trim();
        target.startDate = form.startDate;
        target.endDate = form.endDate;
        target.isPublic = form.isPublic;
        target.category = finalCat;
        target.categoryOtherReason = finalCat === "Others" ? (otherCatReason || "").trim() : "";
        target.vendors = rebuiltVendors;
      }
      addAudit(target, "Update Project Details", before, deepClone(target));
      if (!isVersion) propagateBaselineDetailsToVersions(all, target);
      try { if (projectsStore.refresh) projectsStore.refresh(); } catch (e) {}

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
            uiStore.showError(err.message);
            navigate("/login");
            return;
          }
          uiStore.showError(err?.message || "Failed to save project details");
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
            uiStore.showError(err.message);
            navigate("/login");
            return;
          }
          uiStore.showError(err?.message || "Failed to publish project");
        });
    } else {
      setTimeout(() => doLocal(null), 900);
    }
  }

  function confirmCreateVersion() {
    setVersionOpen(false);
    uiStore.showLoader("Creating version...");

    const doLocal = (apiData) => {
      let newProjectUuid = apiData && apiData.id ? apiData.id : null;

      if (apiData && apiData.id) {
        const mapped = mapApiProject(apiData);
        if (mapped) {
          try {
            if (projectsStore.addProject) projectsStore.addProject(mapped);
            if (projectsStore.refresh) projectsStore.refresh();
          } catch (e) {}
        }
      } else {
        const base = getRootProjectId(project);
        const src = projectsStore.find ? projectsStore.find(project.projectId) : null;
        if (src) {
          const np = deepClone(src);
          np.projectId = newProjectUuid || (projectsStore.getNextVersionId
            ? projectsStore.getNextVersionId(base)
            : `${base}-v${(src.versionNo || 0) + 1}`);
          np.versionOf = base;
          np.isVersion = true;
          np.versionNo = (src.versionNo || 0) + 1;
          np.baselineId = base;
          np.status = "NEW";
          np.actualEndDate = "";
          np.auditLogs = [];
          safeArray(np.milestones).forEach(markSubtreeFromBaseline);
          normalizeProject(np);
          try {
            projectsStore.addProject(np);
            addAudit(np, "Create Version", deepClone(src), deepClone(np));
            projectsStore.refresh();
          } catch (e) {}
          newProjectUuid = np.projectId;
        }
      }

      uiStore.hideLoader();
      uiStore.showMessage("Version created successfully", () => {
        if (newProjectUuid) {
          navigate(`/projects/${encodeURIComponent(newProjectUuid)}`);
        } else {
          navigate("/projects");
        }
      });
    };

    if (getToken()) {
      createVersionApi(project.projectId)
        .then((created) => {
          try { hydrateProjects({ force: true }); } catch (e) {}
          doLocal(created);
        })
        .catch((err) => {
          uiStore.hideLoader();
          if (err && err.isAuth) {
            uiStore.showError(err.message);
            navigate("/login");
            return;
          }
          uiStore.showError(err?.message || "Failed to create version");
        });
    } else {
      setTimeout(() => doLocal(null), 900);
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
            uiStore.showError(err.message);
            navigate("/login");
            return;
          }
          uiStore.showError(err?.message || "Failed to delete project");
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
                  <>
                    <input
                      className="uidai-input"
                      style={{ marginTop: 6 }}
                      placeholder="Specify category"
                      value={otherCat}
                      onChange={(e) => setOtherCat(e.target.value)}
                    />
                    <textarea
                      className="uidai-textarea"
                      style={{ marginTop: 6 }}
                      maxLength={1000}
                      placeholder="Reason for 'Others' *"
                      value={otherCatReason}
                      onChange={(e) => setOtherCatReason(e.target.value)}
                    />
                  </>
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
            disabled={!editing || isVersion}
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