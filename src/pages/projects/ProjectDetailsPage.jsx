import React, { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams, useLocation } from "react-router-dom";
import { projectsStore, useProject } from "../../store/project/projectsStore";
import { uiStore } from "../../store/project/uiStore";
import {
  VENDOR_MASTER,
  ALLOWED_FILE_ACCEPT,
  ALLOWED_FILE_EXTENSIONS,
  MAX_ATTACHMENT_BYTES,
  getFileExtension
} from "../../utils/project/constants";
import { safeArray, deepClone } from "../../utils/project/helpers";
import {
  addAudit,
  normalizeProject
} from "../../utils/project/nodeUtils";
import ChipControl from "../../components/projects/ChipControl";
import PublishModal from "../../components/projects/modals/PublishModal";
import DeleteProjectModal from "../../components/projects/modals/DeleteProjectModal";
import { tokenStore, API_BASE, authorizedFetch } from "../../api/client";
import { getToken, logout } from "../../api/auth";
import { ENDPOINTS } from "../../api/endpoint";
import { loadMilestonesForProject } from "../../api/milestoneConfigApi";
import { hydrateProjects } from "../../store/project/apiSync";
import { useCan, useCurrentRole } from "../../auth/permissions";

/* IST-aware: backend stores IST midnight as UTC 18:30 of the prior day,
   so naive "T"-chopping returns yesterday's date. Project to IST then
   format YYYY-MM-DD. */
function stripTime(iso) {
  if (!iso) return "";
  const s = String(iso);
  if (!s.includes("T")) return s;
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return s.slice(0, s.indexOf("T"));
  const shifted = new Date(d.getTime() + 330 * 60000);
  return `${shifted.getUTCFullYear()}-${String(shifted.getUTCMonth() + 1).padStart(2, "0")}-${String(shifted.getUTCDate()).padStart(2, "0")}`;
}

/* Send the user's picked date with an explicit IST offset so the payload
   shows exactly the date they chose (no UTC roll-back). */
const IST_OFFSET = "+05:30";

function toIsoDate(d) {
  if (!d) return null;
  return `${d}T23:59:59${IST_OFFSET}`;
}

function toIsoStartDate(d) {
  if (!d) return null;
  return `${d}T00:00:00${IST_OFFSET}`;
}

function vendorName(v) {
  if (!v) return "";
  if (typeof v === "object") return v.name || "";
  return String(v);
}
function vendorsToNames(list) {
  return safeArray(list).map(vendorName).filter(Boolean);
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
    ownerOther: p.ownerOther || "",
    status: p.status ? String(p.status).toUpperCase() : "",
    statusExplanation: p.statusExplanation || "",
    startDate: stripTime(p.startDate),
    endDate: stripTime(p.endDate),
    actualStartDate: stripTime(p.actualStartDate),
    /* Why the project started late. Its supporting documents live on their
       own endpoint (see actualStartAttachments) and are excluded from the
       general `attachments` list below. */
    actualStartRemarks: p.actualStartRemarks || "",
    actualEndDate: stripTime(p.actualEndDate),
    vendors: Array.isArray(p.vendors) ? p.vendors : [],
    parentId: p.parentId || null,
    /* Leave / attendance configuration bag — surfaced/edited via the
       "Leave Config" action. Keep the nested shape the backend returns. */
    config: (p.config && typeof p.config === "object") ? { ...p.config } : {
      halfDayHours: null,
      attendanceCaptured: null,
      sandwichLeaveApplied: null,
      leavesPerFrequencyCount: null,
      leavesFrequency: null,
      proratedLeavesApplied: null
    },
    milestones: [],
    auditLogs: [],
    resources: [],
    // Backend returns uploaded project files under `attachments` —
    // {id, filename, url, mimeType, sizeBytes, uploadedAt, ...}. Older
    // payloads may still ship `documents`, so accept either.
    documents: Array.isArray(p.attachments)
      ? p.attachments
      : (Array.isArray(p.documents) ? p.documents : [])
  };
}

function formatBytes(n) {
  if (typeof n !== "number" || !Number.isFinite(n) || n <= 0) return "";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
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
          ownerOther: mapped.ownerOther,
          status: mapped.status,
          statusExplanation: mapped.statusExplanation,
          startDate: mapped.startDate,
          endDate: mapped.endDate,
          actualStartDate: mapped.actualStartDate,
          actualStartRemarks: mapped.actualStartRemarks,
          actualEndDate: mapped.actualEndDate,
          vendors: mapped.vendors,
          parentId: mapped.parentId,
          config: mapped.config,
          documents: mapped.documents
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
  const location = useLocation();
  const realProject = useProject(projectId);

  const [editing, setEditing] = useState(false);
  // Edit gate — per role spec, only super_admin / admin can edit project
  // detail; everyone else sees the page in read-only mode.
  const canEditProject = useCan('editProject');
  const currentRole = useCurrentRole();
  // Publish is restricted to super_admin / admin even though org_admin
  // and project_admin can edit. Gated by its own permission flag rather
  // than piggy-backing on editProject.
  const canPublishProject = useCan('publishProject');
  const canDeleteProject = useCan('deleteProject');
  const canManageDocuments = useCan('manageProjectDocuments');
  const canViewDocuments = useCan('viewProjectDocuments');
  const canViewMeetings = useCan('viewMeetings');
  const canViewFinance = useCan('payment:read');
  const [form, setForm] = useState(null);
  const [publishOpen, setPublishOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [documentsOpen, setDocumentsOpen] = useState(false);
  /* Overflow ("More ▾") menu for the page-header actions. Anything that
     isn't a primary action (Edit/Save, Back) collapses in here so the
     header stays readable as new actions get added. */
  const [actionsMenuOpen, setActionsMenuOpen] = useState(false);
  const actionsMenuRef = useRef(null);
  useEffect(() => {
    if (!actionsMenuOpen) return;
    const onDocClick = (e) => {
      if (!actionsMenuRef.current) return;
      if (!actionsMenuRef.current.contains(e.target)) setActionsMenuOpen(false);
    };
    const onKey = (e) => { if (e.key === "Escape") setActionsMenuOpen(false); };
    document.addEventListener("mousedown", onDocClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDocClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [actionsMenuOpen]);

  // Edit-mode document state. Files upload immediately on pick via
  // POST /projects/{id}/attachments, so we don't stage them — only
  // track validation errors and the input key (used to reset the
  // native file input after a successful upload).
  const [docError, setDocError] = useState("");
  const [docInputKey, setDocInputKey] = useState(0);
  const [docUploading, setDocUploading] = useState(false);

  /* Late-start reason documents (#322) — the evidence backing the Actual
     Start Date + Remarks. They live on their own endpoint and are excluded
     from the general project attachments above, so they get their own
     state and their own section in the UI. */
  const [startDocs, setStartDocs] = useState([]);
  const [startDocError, setStartDocError] = useState("");
  const [startDocInputKey, setStartDocInputKey] = useState(0);
  const [startDocUploading, setStartDocUploading] = useState(false);

  // Discussion feed (comments + their attachments) for the View
  // Documents modal. Lazy-loaded the first time the modal opens, then
  // kept warm so reopening is instant.
  const [feedEntries, setFeedEntries] = useState([]);
  const [feedLoading, setFeedLoading] = useState(false);
  const [feedError, setFeedError] = useState("");

  const [apiProject, setApiProject] = useState(null);
  const [projectLoading, setProjectLoading] = useState(false);
  const [projectError, setProjectError] = useState("");
  // null = unknown/not loaded yet, otherwise the project's milestone count.
  // Finance is hidden only when we know the project has zero milestones.
  const [milestoneCount, setMilestoneCount] = useState(null);

  const [vendorMaster, setVendorMaster] = useState([]);
  const [divisionOptions, setDivisionOptions] = useState([]);
  const [divisionsLoading, setDivisionsLoading] = useState(false);
  const [divisionsError, setDivisionsError] = useState("");

  const project = realProject || apiProject;

  /* Auto-publish hand-off from Finance "Save and Next": when we land here
     with the autoPublish flag set and the project still isn't PUBLISHED,
     pop the Publish modal so the user can finish the flow. Fires once
     (ref-guarded), then strips the flag from history so a refresh / back-
     nav doesn't re-open it. */
  const autoPublishHandledRef = useRef(false);
  useEffect(() => {
    if (autoPublishHandledRef.current) return;
    if (!location.state?.autoPublish) return;
    if (!project) return;
    autoPublishHandledRef.current = true;
    navigate(location.pathname, { replace: true, state: {} });
    const isPublished = String(project.status || "").toUpperCase() === "PUBLISHED";
    if (canPublishProject && !isPublished) {
      setPublishOpen(true);
    }
  }, [location, project, canPublishProject, navigate]);

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
        const res = await authorizedFetch(`${API_BASE}${ENDPOINTS.vendors.list}`, {
          method: "GET",
          headers: { accept: "application/json" }
        });

        if (cancelled) return;
        if (res.status === 401) return;
        // The vendor master is only used to populate the edit-mode
        // organization dropdown. Project Members lack the backend's
        // vendors:read scope and cannot edit anyway, so swallow 403 to
        // avoid a spurious "Insufficient permissions" popup on open.
        if (res.status === 403) return;
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

  /* ─── GET /api/v3/divisions ─── */
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
        if (res.status === 401) return;
        if (!res.ok) {
          const msg = await readErrorMessage(res);
          throw new Error(msg);
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
  }, []);

  /* Fetch the detail endpoint and push the mapped result into both
     `apiProject` state and the projects store. Returns the mapped
     project on success, null otherwise. Used by the initial-load
     useEffect and re-invoked after a successful PATCH so the UI
     reflects whatever the server stored. */
  async function fetchProjectDetail({ silent = false } = {}) {
    if (!projectId) return null;
    const token = getToken();
    if (!token) {
      if (!silent) {
        uiStore.showError("Please sign in to continue");
        navigate("/login");
      }
      return null;
    }

    if (!silent) {
      setProjectLoading(true);
      setProjectError("");
    }
    try {
      const res = await authorizedFetch(
        `${API_BASE}${ENDPOINTS.projects.get(projectId)}`,
        { method: "GET", headers: { accept: "application/json" } }
      );

      if (res.status === 401) {
        logout();
        if (!silent) {
          uiStore.showError("Session expired. Please sign in again.");
          navigate("/login");
        }
        return null;
      }

      if (!res.ok) {
        const msg = await readErrorMessage(res);
        throw new Error(msg);
      }

      const raw = await res.json().catch(() => ({}));
      const mapped = mapApiProject(raw?.data ?? raw);

      if (mapped) {
        setApiProject(mapped);
        mergeIntoStore(mapped);
      }
      return mapped;
    } catch (err) {
      const msg = err?.message || "Failed to load project";
      if (!silent) {
        setProjectError(msg);
        uiStore.showError(msg);
      }
      return null;
    } finally {
      if (!silent) setProjectLoading(false);
    }
  }

  /* ─── GET /api/v3/projects/{id} ─── */
  useEffect(() => {
    if (!projectId) return;
    fetchProjectDetail();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId]);

  /* Milestone count drives whether the Finance entry point is shown — a
     project with zero milestones has nothing to finance, so hide it. The
     detail GET doesn't return milestones, so fetch them separately. */
  useEffect(() => {
    if (!projectId || !getToken()) return;
    let cancelled = false;
    setMilestoneCount(null);
    loadMilestonesForProject(projectId)
      .then((list) => {
        if (!cancelled) setMilestoneCount(safeArray(list).length);
      })
      .catch(() => {
        // On failure leave count unknown (null) so Finance stays visible.
        if (!cancelled) setMilestoneCount(null);
      });
    return () => { cancelled = true; };
  }, [projectId]);

  useEffect(() => {
    if (!project) return;
    // Don't clobber the user's in-progress edits when fields land late from
    // the detail GET. The form is reseeded only on project switch or when
    // toggling in/out of edit mode.
    if (editing) return;
    setForm({
      projectName: project.projectName,
      description: project.description || "",
      owner: project.owner,
      ownerOther: project.ownerOther || "",
      startDate: project.startDate,
      endDate: project.endDate,
      actualStartDate: project.actualStartDate || "",
      actualStartRemarks: project.actualStartRemarks || "",
      actualEndDate: project.actualEndDate || "",
      vendors: vendorsToNames(project.vendors)
    });
    // Reseeding the form means the project just changed — clear any
    // residual pick-error state.
    setDocError("");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    project && project.projectId,
    project && project.actualStartDate,
    project && project.actualStartRemarks,
    project && project.actualEndDate,
    project && project.owner,
    project && project.ownerOther,
    editing
  ]);

  const selectedDivision = useMemo(
    () => divisionOptions.find((d) => d.code === (form && form.owner)),
    [divisionOptions, form && form.owner]
  );
  const ownerRequiresOther =
    !!selectedDivision &&
    (selectedDivision.requiresOther ||
      String(selectedDivision.label || "").toLowerCase() === "others" ||
      String(selectedDivision.code || "").toLowerCase() === "others");

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
     status is intentionally omitted — the field is shown read-only and the
     server manages transitions via publish/close endpoints. */
  async function updateProjectApi(projectServerId) {
    const token = getToken();
    if (!token) throw new Error("Your session has expired. Please sign in again.");

    const payload = {
      name: (form.projectName || "").trim(),
      description: (form.description || "").trim(),
      active: true,
      status_explanation: project.statusExplanation || "",
      owner: (form.owner || "").trim(),
      vendor_ids: resolveVendorIds(form.vendors),
      startDate: toIsoDate(form.startDate),
      endDate: toIsoDate(form.endDate),
      actualStartDate: form.actualStartDate ? toIsoStartDate(form.actualStartDate) : null,
      actualStartRemarks: (form.actualStartRemarks || "").trim(),
      actualEndDate: form.actualEndDate ? toIsoDate(form.actualEndDate) : null
    };
    if (project.parentId) payload.parent_id = project.parentId;

    const res = await authorizedFetch(
      `${API_BASE}${ENDPOINTS.projects.update(projectServerId)}`,
      {
        method: "PATCH",
        headers: {
          accept: "application/json",
          "Content-Type": "application/json"
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

    const res = await authorizedFetch(
      `${API_BASE}${ENDPOINTS.projects.publish(projectServerId)}`,
      {
        method: "POST",
        headers: {
          accept: "application/json",
          "Content-Type": "application/json"
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

    const res = await authorizedFetch(
      `${API_BASE}${ENDPOINTS.projects.remove(projectServerId)}`,
      {
        method: "DELETE",
        headers: { accept: "application/json" }
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

  // Lazy-load the project discussion feed (comments + their
  // attachments) when the View Documents modal opens. Must live
  // ABOVE the early returns below — calling hooks conditionally
  // would otherwise change the hook order between renders.
  useEffect(() => {
    if (!documentsOpen) return;
    if (!project?.projectId) return;
    if (feedLoading) return;
    if (feedEntries.length > 0) return;
    const token = getToken();
    if (!token) return;
    let cancelled = false;
    setFeedLoading(true);
    setFeedError("");
    (async () => {
      try {
        const url = `${API_BASE}${ENDPOINTS.projects.discussionFeed(project.projectId)}?offset=1&pageSize=50`;
        const res = await authorizedFetch(url, {
          method: "GET",
          headers: { accept: "application/json" }
        });
        if (res.status === 401) {
          logout();
          navigate("/login");
          return;
        }
        if (!res.ok) {
          const msg = await readErrorMessage(res);
          throw new Error(msg);
        }
        const raw = await res.json().catch(() => ({}));
        const elements =
          raw?.data?._embedded?.elements ??
          raw?._embedded?.elements ??
          [];
        if (!cancelled) setFeedEntries(Array.isArray(elements) ? elements : []);
      } catch (err) {
        if (!cancelled) setFeedError(err?.message || "Failed to load comments");
      } finally {
        if (!cancelled) setFeedLoading(false);
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [documentsOpen, project && project.projectId]);

  /* Pull the late-start reason documents whenever the project changes.
     Must sit ABOVE the early returns below — a hook after them would
     change the hook order between renders. */
  useEffect(() => {
    setStartDocs([]);
    setStartDocError("");
    loadStartDocs();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project && project.projectId]);

  if (!project) {
    if (projectLoading) {
      return (
        <div>
          <div className="uidai-card-project">
            <div className="uidai-hint">Loading project…</div>
          </div>
        </div>
      );
    }
    return (
      <div>
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

  const isPubBase = !!project && project.status === "PUBLISHED";

  function toggleEdit() {
    if (!editing) {
      setEditing(true);
      return;
    }
    save();
  }

  function save() {
    if (!form) return;
    if (!form.owner.trim() || !form.projectName.trim() || !form.startDate || !form.endDate) {
      uiStore.showError("Fill required fields.");
      return;
    }
    if (ownerRequiresOther && !(form.ownerOther || "").trim()) {
      uiStore.showError("Please specify the owner.");
      return;
    }
    if (form.endDate && form.startDate && form.endDate < form.startDate) {
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
      target.projectName = form.projectName.trim();
      target.description = form.description.trim();
      target.owner = form.owner.trim();
      target.ownerOther = ownerRequiresOther ? (form.ownerOther || "").trim() : "";
      target.startDate = form.startDate;
      target.endDate = form.endDate;
      target.vendors = rebuiltVendors;
      addAudit(target, "Update Project Details", before, deepClone(target));
      try { if (projectsStore.refresh) projectsStore.refresh(); } catch (e) { }

      if (apiData && apiData.id) {
        const mapped = mapApiProject(apiData);
        if (mapped) setApiProject(mapped);
      } else {
        setApiProject({ ...target });
      }

      uiStore.hideLoader();
      setEditing(false);
      setDocError("");
      uiStore.showMessage("Project details saved");
    };

    uiStore.showLoader("Saving project details...");

    if (getToken()) {
      updateProjectApi(project.projectId)
        .then((updated) => {
          doLocal(updated);
          // Re-pull the canonical record from the server so any field the
          // PATCH response omitted (or that the server normalized) shows up.
          fetchProjectDetail({ silent: true });
        })
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
      addAudit(t, "Publish Project", before, deepClone(t));
      try { if (projectsStore.refresh) projectsStore.refresh(); } catch (e) { }

      if (apiData && apiData.id) {
        const mapped = mapApiProject(apiData);
        if (mapped) setApiProject(mapped);
      } else {
        setApiProject({ ...t });
      }

      uiStore.hideLoader();
      uiStore.showMessage("Project published successfully", () =>
        navigate(`/manage-users/${encodeURIComponent(project.projectId)}`)
      );
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

  // ── Document-field helpers ─────────────────────────────────────
  // Mirrors the validation rules from AddProjectPage so edit-mode
  // uploads honor the same MIME / size limits.
  function validateNewDocs(files) {
    const bad = files.filter(
      (f) => !ALLOWED_FILE_EXTENSIONS.includes(getFileExtension(f.name))
    );
    if (bad.length) {
      setDocError(`Unsupported file type: ${bad.map((f) => f.name).join(", ")}`);
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

  // File picker change → upload all picked files in a single multipart
  // POST /api/v3/projects/{id}/attachments call with the `files` field
  // repeated once per file (matches the backend curl). On success,
  // silent-refresh the project so the freshly uploaded rows appear
  // with their server-assigned IDs/URLs.
  async function handleNewDocsChange(e) {
    const picked = Array.from(e.target.files || []);
    if (!picked.length) return;
    if (!validateNewDocs(picked)) {
      e.target.value = "";
      return;
    }
    if (!project?.projectId) {
      setDocError("Project must be saved before attaching documents.");
      e.target.value = "";
      return;
    }

    setDocUploading(true);
    try {
      const fd = new FormData();
      picked.forEach((file) => fd.append("files", file, file.name));
      const res = await authorizedFetch(
        `${API_BASE}${ENDPOINTS.projects.attachments(project.projectId)}`,
        {
          method: "POST",
          headers: { accept: "application/json" },
          body: fd
        }
      );
      if (res.status === 401) {
        logout();
        uiStore.showError("Session expired. Please sign in again.");
        navigate("/login");
        return;
      }
      if (!res.ok) {
        const msg = await readErrorMessage(res);
        throw new Error(msg || "Failed to upload document(s)");
      }
      await fetchProjectDetail({ silent: true });
      setDocInputKey((k) => k + 1);
    } catch (err) {
      setDocError(err?.message || "Failed to upload document(s)");
    } finally {
      setDocUploading(false);
      e.target.value = "";
    }
  }

  /* ── Late-start reason documents (#322) ────────────────────────────
     Separate from the general project attachments: these upload to
     POST /projects/{id}/actual-start-attachments (multipart, `files`
     repeated per file) and are listed by the matching GET. The general
     /attachments GET deliberately excludes them. */
  async function loadStartDocs() {
    if (!project?.projectId || !getToken()) return;
    try {
      const res = await authorizedFetch(
        `${API_BASE}${ENDPOINTS.projects.actualStartAttachments(project.projectId)}`,
        { method: "GET", headers: { accept: "application/json" } }
      );
      if (!res.ok) return;
      const raw = await res.json().catch(() => ({}));
      const list =
        raw?.data?._embedded?.elements ??
        raw?._embedded?.elements ??
        raw?.data?.attachments ??
        raw?.attachments ??
        raw?.data ??
        raw;
      setStartDocs(Array.isArray(list) ? list : []);
    } catch {
      // Leave whatever we already have — the section just won't refresh.
    }
  }

  async function handleStartDocsChange(e) {
    const picked = Array.from(e.target.files || []);
    if (!picked.length) return;
    const bad = picked.filter(
      (f) => !ALLOWED_FILE_EXTENSIONS.includes(getFileExtension(f.name))
    );
    if (bad.length) {
      setStartDocError(`Unsupported file type: ${bad.map((f) => f.name).join(", ")}`);
      e.target.value = "";
      return;
    }
    const oversize = picked.filter((f) => f.size > MAX_ATTACHMENT_BYTES);
    if (oversize.length) {
      setStartDocError(
        `File too large (max 25 MB): ${oversize
          .map((f) => `${f.name} (${(f.size / 1024 / 1024).toFixed(1)} MB)`)
          .join(", ")}`
      );
      e.target.value = "";
      return;
    }
    if (!project?.projectId) {
      setStartDocError("Project must be saved before attaching documents.");
      e.target.value = "";
      return;
    }
    setStartDocError("");
    setStartDocUploading(true);
    try {
      const fd = new FormData();
      picked.forEach((file) => fd.append("files", file, file.name));
      const res = await authorizedFetch(
        `${API_BASE}${ENDPOINTS.projects.actualStartAttachments(project.projectId)}`,
        { method: "POST", headers: { accept: "application/json" }, body: fd }
      );
      if (res.status === 401) {
        logout();
        uiStore.showError("Session expired. Please sign in again.");
        navigate("/login");
        return;
      }
      if (!res.ok) {
        const msg = await readErrorMessage(res);
        throw new Error(msg || "Failed to upload document(s)");
      }
      await loadStartDocs();
      setStartDocInputKey((k) => k + 1);
    } catch (err) {
      setStartDocError(err?.message || "Failed to upload document(s)");
    } finally {
      setStartDocUploading(false);
      e.target.value = "";
    }
  }

  // Stream the attachment via authorizedFetch so the Authorization
  // header is included for protected file URLs, then save it via a
  // blob URL. Falls back to opening the raw URL in a new tab if the
  // server can't be reached with credentials (e.g. CORS).
  async function downloadAttachment(att) {
    const url = att && (att.url || att.href);
    const filename = (att && (att.filename || att.name)) || "attachment";
    if (!url) return;
    try {
      const res = await authorizedFetch(url, {
        method: "GET",
        headers: { accept: att?.mimeType || "*/*" }
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const blob = await res.blob();
      const objectUrl = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = objectUrl;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
    } catch {
      window.open(url, "_blank", "noopener,noreferrer");
    }
  }

  function confirmDelete() {
    setDeleteOpen(false);
    uiStore.showLoader("Removing project...");

    const finish = () => {
      try {
        if (projectsStore.removeProject) projectsStore.removeProject(project.projectId);
      } catch (e) { }
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
    ? "This project is published. You can still edit details and milestone configuration."
    : "Complete project details and milestone configuration, then publish.";

  if (!form) return null;

  const documentEntries = feedEntries.filter(
    (c) => Array.isArray(c.attachments) && c.attachments.length > 0
  );

  /* ─── Page-header action config ───────────────────────────────────
     Every header action lives in this array. To add a new action,
     append one entry and (if needed) bump its `primary` flag so it
     shows inline. Anything left as `primary: false` collapses into
     the "More ▾" overflow menu — keeping the header readable as the
     action set grows.

     Fields:
       key       unique id (used for React keys)
       label     button / menu-item text
       onClick   click handler
       visible   show this action at all? (role/state gate)
       primary   render inline (true) or under "More ▾" (false/omitted)
       variant   "default" | "danger" | "cancel"  (uidai-btn modifier)
       disabled  per-action disable (defaults to `editing` for safety)
  */
  const manageUsersTarget = (() => {
    // "Manage Users" routes per role:
    //   - org_admin → their own organization (they never browse the list)
    //   - super/PMIS admin → for now, the first linked org
    //   - project_member → hidden; members never manage users.
    if (currentRole === "project_member") return "";
    const own =
      tokenStore.getUser()?.vendor_id ||
      tokenStore.getUser()?.vendorId ||
      "";
    const firstVendor = safeArray(form.vendors)[0];
    const firstVendorId = firstVendor
      ? (projectVendorIndex[firstVendor]?.id ||
        vendorMasterIndex[firstVendor]?.id ||
        "")
      : "";
    return currentRole === "org_admin" ? own || firstVendorId : firstVendorId;
  })();

  const actions = [
    {
      key: "view-documents",
      label: "View Documents",
      onClick: () => setDocumentsOpen(true),
      visible: canViewDocuments
    },
    {
      key: "audit-log",
      label: "Audit Log",
      onClick: () => navigate(`/projects/${encodeURIComponent(project.projectId)}/audit-logs`),
      visible: isPubBase
    },
    {
      key: "manage-teams",
      label: "Manage Teams",
      onClick: () => navigate(`/manage-users/${project.projectId}`),
      /* Team assignment is only meaningful once the project is
         PUBLISHED — milestones/activities don't exist as a stable team
         surface until then. Hide the entry point on drafts. */
      visible: isPubBase && !!manageUsersTarget
    },
    {
      key: "critical-path",
      label: "Critical Path Analysis",
      onClick: () => navigate(`/CriticalPathAnalysis/${project.projectId}`),
      visible: canPublishProject && project.status === "PUBLISHED"
    },
    {
      key: "activity-started-list",
      label: "Activity Started List",
      onClick: () => navigate(`/projects/${encodeURIComponent(project.projectId)}/activities-started`),
      /* Activities can only be started once the project is PUBLISHED, so
         the list is meaningless on drafts — hide it there. */
      visible: isPubBase
    },
    {
      key: "meeting-details",
      label: "Meeting Details",
      onClick: () => navigate(`/projects/${encodeURIComponent(project.projectId)}/meetings`),
      visible: canViewMeetings
    },
    {
      key: "publish",
      label: "Publish",
      onClick: () => setPublishOpen(true),
      visible: canPublishProject && project.status !== "PUBLISHED"
    },
    {
      key: "configure",
      label: "Configure",
      onClick: () => navigate(`/projects/${encodeURIComponent(project.projectId)}/config`),
      visible: true
    },
    {
      key: "finance",
      label: "Finance",
      onClick: () => navigate(`/projects/${encodeURIComponent(project.projectId)}/finance`),
      // Hidden when the project has no milestones (count known to be 0)
      // or the user lacks finance read access.
      visible: milestoneCount !== 0 && canViewFinance
    },
    {
      /* Single entry point for the whole workforce cluster — Resources,
         Attendance, Designation Rates and Leave Policy. They read the same
         records, so they live behind one hub with its own section nav
         rather than four separate entries here. */
      key: "attendance-system",
      label: "Attendance System",
      onClick: () => navigate(`/projects/${encodeURIComponent(project.projectId)}/attendance-system`),
      visible: true
    },
    {
      /* Single entry point for the whole SLA cluster — Severity & LD,
         the SLA library, activity mappings, quarterly settlement and the
         penalty report. They form one chain (points → bands → mapping →
         evaluation → LD → payment), so they live behind one hub with its
         own section nav rather than scattered entries here, in the sidebar
         and at the bottom of the mapping page. */
      key: "sla-system",
      label: "SLA System",
      onClick: () => navigate(`/projects/${encodeURIComponent(project.projectId)}/sla-system`),
      visible: true
    },
    {
      key: "edit",
      label: editing ? "Save" : "Edit",
      onClick: toggleEdit,
      visible: canEditProject,
      // Edit/Save is the one action that stays clickable while `editing`,
      // so the user can finish saving from inside the dropdown.
      disabled: false,
      // Pin to the header (outside the ⋮ overflow) so the primary
      // edit/save action is always one click away.
      primary: true
    },
    {
      key: "remove",
      label: "Remove",
      onClick: () => setDeleteOpen(true),
      visible: canDeleteProject,
      variant: "danger"
    }
  ];

  const visibleActions = actions.filter((a) => a.visible);
  const primaryActions = visibleActions.filter((a) => a.primary);
  const overflowActions = visibleActions.filter((a) => !a.primary);

  const variantClass = (v) =>
    v === "danger" ? " uidai-btn--delete"
    : v === "cancel" ? " uidai-btn--cancel"
    : "";

  return (
    <div>
      <div className="uidai-page-header" style={{ justifyContent: "flex-end" }}>
        <div className="uidai-page-header__actions">
          {primaryActions.map((a) => (
            <button
              key={a.key}
              type="button"
              className={`uidai-btn${variantClass(a.variant)}`}
              disabled={a.disabled === undefined ? editing : a.disabled}
              onClick={a.onClick}
            >
              {a.label}
            </button>
          ))}
          {overflowActions.length > 0 && (
            <div className="uidai-actions-menu" ref={actionsMenuRef}>
              <button
                type="button"
                className="uidai-actions-menu__toggle uidai-actions-menu__toggle--icon"
                aria-haspopup="menu"
                aria-label="More actions"
                aria-expanded={actionsMenuOpen}
                onClick={() => setActionsMenuOpen((o) => !o)}
              >
                <span aria-hidden="true">⋮</span>
              </button>
              {actionsMenuOpen && (
                <div className="uidai-actions-menu__panel" role="menu">
                  {overflowActions.map((a) => (
                    <button
                      key={a.key}
                      type="button"
                      role="menuitem"
                      className={`uidai-actions-menu__item${a.variant === "danger" ? " uidai-actions-menu__item--danger" : ""}`}
                      disabled={a.disabled === undefined ? editing : a.disabled}
                      onClick={() => { setActionsMenuOpen(false); a.onClick(); }}
                    >
                      {a.label}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
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
              disabled={!editing}
            />
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
              disabled={!editing}
            />
            <div className="uidai-char-count">
              {5000 - form.description.length} characters remaining
            </div>
          </div>
          <div className="uidai-field">
            <label className="uidai-field__label">
              Owner <span className="uidai-required-project">*</span>
            </label>
            {editing ? (
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
                  setForm((f) => ({
                    ...f,
                    owner: nextCode,
                    ownerOther: stillNeedsOther ? f.ownerOther || "" : ""
                  }));
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
            ) : (
              <input
                className="uidai-input"
                value={
                  (divisionOptions.find((d) => d.code === form.owner) || {}).label ||
                  form.owner ||
                  ""
                }
                disabled
              />
            )}
          </div>

          {ownerRequiresOther && (
            <div className="uidai-field">
              <label className="uidai-field__label">
                Specify Owner <span className="uidai-required-project">*</span>
              </label>
              <input
                className="uidai-input"
                value={form.ownerOther || ""}
                onChange={(e) => setForm((f) => ({ ...f, ownerOther: e.target.value }))}
                disabled={!editing}
              />
            </div>
          )}
          <div className="uidai-field">
            <label className="uidai-field__label">
              Expected Start Date <span className="uidai-required-project">*</span>
            </label>
            <input
              className="uidai-input"
              type="date"
              value={form.startDate}
              onChange={(e) => setForm((f) => ({ ...f, startDate: e.target.value }))}
              disabled={!editing}
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
              disabled={!editing}
            />
          </div>
          <div className="uidai-field">
            <label className="uidai-field__label">Actual Start Date</label>
            <input
              className="uidai-input"
              type="date"
              value={form.actualStartDate}
              onChange={(e) => setForm((f) => ({ ...f, actualStartDate: e.target.value }))}
              disabled={!editing}
            />
          </div>
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
          {/* Late-start reason (#322). The remark saves with the project;
              the supporting files upload to their own endpoint the moment
              they're picked, so they're listed separately from the general
              project documents below. */}
          <div className="uidai-field uidai-grid__full">
            <label className="uidai-field__label">Actual Start Date — Remarks</label>
            <textarea
              className="uidai-textarea"
              maxLength={2000}
              placeholder="Why did the project start on this date?"
              value={form.actualStartRemarks || ""}
              onChange={(e) => setForm((f) => ({ ...f, actualStartRemarks: e.target.value }))}
              disabled={!editing}
            />
            {editing && (
              <div className="uidai-char-count">
                {2000 - (form.actualStartRemarks || "").length} characters remaining
              </div>
            )}
            {editing && (
              <>
                <input
                  key={startDocInputKey}
                  type="file"
                  multiple
                  accept={ALLOWED_FILE_ACCEPT}
                  onChange={handleStartDocsChange}
                  disabled={startDocUploading}
                  style={{ marginTop: 8 }}
                />
                <div className="uidai-attach-hint" style={{ marginTop: 4 }}>
                  {startDocUploading
                    ? "Uploading…"
                    : "Optional supporting documents for the actual start date. Files upload immediately on pick; maximum 25 MB per file."}
                </div>
                {startDocError && <div className="uidai-attach-error">{startDocError}</div>}
              </>
            )}
            {startDocs.length > 0 && (
              <ul
                style={{
                  listStyle: "none",
                  padding: 0,
                  margin: "8px 0 0 0",
                  display: "flex",
                  flexDirection: "column",
                  gap: 4
                }}
              >
                {startDocs.map((d, idx) => {
                  const name = d?.filename || d?.name || d?.fileName || `Document ${idx + 1}`;
                  const sizeLabel = formatBytes(d?.sizeBytes);
                  return (
                    <li
                      key={d?.id || `${name}-${idx}`}
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
                      <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis" }}>
                        {name}
                        {sizeLabel && (
                          <span style={{ color: "#666", fontSize: 12, marginLeft: 6 }}>
                            ({sizeLabel})
                          </span>
                        )}
                      </span>
                      {(d?.url || d?.href) && (
                        <button
                          type="button"
                          className="uidai-btn"
                          style={{ padding: "2px 8px", fontSize: 12 }}
                          onClick={() => downloadAttachment(d)}
                        >
                          Download
                        </button>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </div>

        <div style={{ marginTop: 18 }} className="uidai-grid">
          <div>
            <h4 style={{ color: "#173e77", marginBottom: 8 }}>Organizations</h4>
            <ChipControl
              value={form.vendors}
              options={vendorOptions}
              onChange={(next) => setForm((f) => ({ ...f, vendors: next }))}
              label="organization"
              disabled={!editing}
            />
          </div>
          {canManageDocuments && (
            <div>
              <h4 style={{ color: "#173e77", marginBottom: 8 }}>Documents</h4>
              {editing && (
                <>
                  <input
                    key={docInputKey}
                    type="file"
                    multiple
                    accept={ALLOWED_FILE_ACCEPT}
                    onChange={handleNewDocsChange}
                    disabled={docUploading}
                  />
                  <div className="uidai-attach-hint" style={{ marginTop: 4 }}>
                    {docUploading
                      ? "Uploading…"
                      : "Optional. Files upload immediately on pick. Maximum size: 25 MB per file. Allowed types: Documents (pdf, docx, xlsx, txt, csv), Images (jpg, png, heic), Videos (mp4, webm, mov)."}
                  </div>
                  {docError && <div className="uidai-attach-error">{docError}</div>}
                </>
              )}
              {(() => {
                const docs = safeArray(project.documents);
                if (docs.length === 0) {
                  return (
                    <div className="uidai-hint" style={{ marginTop: editing ? 8 : 0 }}>
                      No documents added.
                    </div>
                  );
                }
                return (
                  <ul
                    style={{
                      listStyle: "none",
                      padding: 0,
                      margin: editing ? "8px 0 0 0" : 0,
                      display: "flex",
                      flexDirection: "column",
                      gap: 4
                    }}
                  >
                    {docs.map((d, idx) => {
                      const isObj = d && typeof d === "object";
                      const name = isObj
                        ? (d.filename || d.name || d.fileName || `Document ${idx + 1}`)
                        : String(d);
                      const url = isObj ? (d.url || d.href || "") : "";
                      const sizeLabel = isObj ? formatBytes(d.sizeBytes) : "";
                      const rowKey = isObj ? (d.id || `${name}-${idx}`) : `${name}-${idx}`;
                      return (
                        <li
                          key={rowKey}
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
                          <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis" }}>
                            {name}
                            {sizeLabel && (
                              <span style={{ color: "#666", fontSize: 12, marginLeft: 6 }}>
                                ({sizeLabel})
                              </span>
                            )}
                          </span>
                          {url && (
                            <button
                              type="button"
                              className="uidai-btn"
                              style={{ padding: "2px 8px", fontSize: 12 }}
                              onClick={() => downloadAttachment(d)}
                            >
                              Download
                            </button>
                          )}
                        </li>
                      );
                    })}
                  </ul>
                );
              })()}
            </div>
          )}
        </div>
      </div>

      <PublishModal
        open={publishOpen}
        project={project}
        onCancel={() => setPublishOpen(false)}
        onConfirm={confirmPublish}
      />
      <DeleteProjectModal
        open={deleteOpen}
        project={project}
        onCancel={() => setDeleteOpen(false)}
        onConfirm={confirmDelete}
      />


      {documentsOpen && (
        <div className="uidai-modal">
          <div className="uidai-modal__box" style={{ position: "relative" }}>
            <button
              type="button"
              aria-label="Close"
              onClick={() => setDocumentsOpen(false)}
              style={{
                position: "absolute",
                top: 8,
                right: 10,
                width: 28,
                height: 28,
                border: "none",
                background: "transparent",
                fontSize: 22,
                lineHeight: 1,
                cursor: "pointer",
                color: "#666",
                padding: 0
              }}
            >
              ×
            </button>
            <h3 className="uidai-modal__title">
              Project Documents
            </h3>
            {feedLoading && (
              <div className="uidai-hint" style={{ marginTop: 8 }}>
                Loading comments…
              </div>
            )}
            {!feedLoading && feedError && (
              <div className="uidai-hint" style={{ marginTop: 8, color: "#d32f2f" }}>
                {feedError}
              </div>
            )}
            {!feedLoading && !feedError && documentEntries.length === 0 && (
              <div className="uidai-hint" style={{ marginTop: 8 }}>
                No documents yet.
              </div>
            )}
            {!feedLoading && documentEntries.length > 0 && (
              <ul
                style={{
                  listStyle: "none",
                  padding: 0,
                  margin: "12px 0 0 0",
                  display: "flex",
                  flexDirection: "column",
                  gap: 10
                }}
              >
                {documentEntries.map((c) => {
                  const kindLabel = c.targetKind
                    ? c.targetKind.charAt(0).toUpperCase() + c.targetKind.slice(1)
                    : "";
                  // Backend may return createdAt as a naive ISO string
                  // (no Z / no ±HH:MM offset). Those are UTC in the
                  // database — appending "Z" prevents the browser from
                  // mis-parsing them as local time.
                  const rawCreatedAt = c.createdAt || "";
                  const normalizedCreatedAt =
                    rawCreatedAt && !/[zZ]|[+-]\d{2}:?\d{2}$/.test(rawCreatedAt)
                      ? `${rawCreatedAt}Z`
                      : rawCreatedAt;
                  const when = normalizedCreatedAt ? new Date(normalizedCreatedAt) : null;
                  const whenLabel =
                    when && !Number.isNaN(when.getTime())
                      ? `${when.toLocaleString("en-IN", {
                        day: "2-digit",
                        month: "short",
                        year: "numeric",
                        hour: "2-digit",
                        minute: "2-digit",
                        hour12: true,
                        timeZone: "Asia/Kolkata"
                      })}`
                      : "";
                  const createdByLogin =
                    c.createdByLogin || c.created_by_login || "";
                  return (
                    <li
                      key={c.id}
                      style={{
                        padding: "10px 12px",
                        background: "#f5f7fa",
                        borderRadius: 6,
                        border: "1px solid #e0e5ec"
                      }}
                    >
                      <div
                        style={{
                          display: "flex",
                          flexWrap: "wrap",
                          gap: 6,
                          alignItems: "baseline",
                          marginBottom: 4,
                          fontSize: 12,
                          color: "#5a6680"
                        }}
                      >
                        {kindLabel && (
                          <span
                            style={{
                              padding: "1px 8px",
                              borderRadius: 999,
                              background: "#e3eefc",
                              color: "#0b3c88",
                              border: "1px solid #c8d9ee",
                              fontWeight: 700
                            }}
                          >
                            {kindLabel}
                          </span>
                        )}
                        {c.targetName && (
                          <span style={{ color: "#173e77", fontWeight: 600 }}>
                            {c.targetName}
                          </span>
                        )}
                        {whenLabel && <span>· {whenLabel}</span>}
                        {createdByLogin && (
                          <span>· by <strong style={{ color: "#173e77" }}>{createdByLogin}</strong></span>
                        )}
                      </div>
                      {Array.isArray(c.attachments) && c.attachments.length > 0 && (
                        <ul
                          style={{
                            listStyle: "none",
                            padding: 0,
                            margin: "8px 0 0 0",
                            display: "flex",
                            flexDirection: "column",
                            gap: 4
                          }}
                        >
                          {c.attachments.map((att, attIdx) => {
                            const name = att.filename || att.name || `File ${attIdx + 1}`;
                            const sizeLabel = formatBytes(att.sizeBytes);
                            return (
                              <li
                                key={`${c.id}-${attIdx}`}
                                style={{
                                  display: "flex",
                                  alignItems: "center",
                                  justifyContent: "space-between",
                                  gap: 8,
                                  padding: "4px 8px",
                                  background: "#fff",
                                  borderRadius: 4,
                                  border: "1px solid #dbe5f1"
                                }}
                              >
                                <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis" }}>
                                  {name}
                                  {sizeLabel && (
                                    <span style={{ color: "#666", fontSize: 12, marginLeft: 6 }}>
                                      ({sizeLabel})
                                    </span>
                                  )}
                                </span>
                                {att.url && (
                                  <button
                                    type="button"
                                    className="uidai-btn"
                                    style={{ padding: "2px 8px", fontSize: 12 }}
                                    onClick={() => downloadAttachment(att)}
                                  >
                                    Download
                                  </button>
                                )}
                              </li>
                            );
                          })}
                        </ul>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}

            <div className="uidai-modal__actions">
              <button
                type="button"
                className="uidai-btn uidai-btn--cancel"
                onClick={() => setDocumentsOpen(false)}
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}