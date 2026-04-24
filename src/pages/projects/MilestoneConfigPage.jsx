import React, { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { projectsStore, useProject, useProjects } from "../../store/project/projectsStore";
import { draftStore, useDraft } from "../../store/project/draftStore";
import { uiStore } from "../../store/project/uiStore";
import { safeArray, deepClone, generateNodeUid } from "../../utils/project/helpers";
import {
  normalizeProject,
  recomputeActualDates,
  rollUpStatus,
  getChildren,
  locateNode,
  effectiveStatus,
  buildDepDisplayMap,
  isVersionProject,
  isBaselineProject,
  isNodeBaselineLocked,
  addAudit,
  collectDescendantUids,
  findChildDateViolations,
  propagateNodeAddToVersions,
  propagateNodeUpdateToVersions,
  propagateNodeDeleteToVersions
} from "../../utils/project/nodeUtils";
import NodeModal from "../../components/projects/modals/NodeModal";
import { formatDateDisplay } from "../../utils/project/helpers";
import * as projectsApi from "../../api/projects";
import * as nodesApi from "../../api/nodes";
import { tokenStore } from "../../api/client";
import { getToken, logout } from "../../api/auth";
import { hydrateProjects } from "../../store/project/apiSync";

const API_BASE = "http://10.1.131.199:8000";

/* ─── Onboarding draft persistence ─── */
const DRAFT_STORAGE_KEY = "uidai_onboarding_draft";

function persistOnboardingDraft(p) {
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
function readPersistedOnboardingDraft() {
  try {
    const raw = localStorage.getItem(DRAFT_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return parsed && parsed.projectId ? parsed : null;
  } catch (e) {
    return null;
  }
}
function clearPersistedOnboardingDraft() {
  try { localStorage.removeItem(DRAFT_STORAGE_KEY); } catch (e) {}
}

/* ─── Helpers ─── */
function toMilestoneIsoStart(d) {
  if (!d) return null;
  return new Date(`${d}T00:00:00Z`).toISOString();
}
function toMilestoneIsoEnd(d) {
  if (!d) return null;
  return new Date(`${d}T23:59:59Z`).toISOString();
}
function mapStatusForApi(s) {
  return s === "Completed" ? "completed" : "not_completed";
}
function resolveVendorIds(project, vendorName) {
  if (!vendorName) return [];
  const vendors = safeArray(project && project.vendors);
  const match = vendors.find((v) => {
    if (v && typeof v === "object") return v.name === vendorName;
    return v === vendorName;
  });
  if (match && typeof match === "object" && match.id) return [match.id];
  return [];
}
function toDateInputValue(iso) {
  if (!iso) return "";
  const s = String(iso);
  const tIdx = s.indexOf("T");
  return tIdx > 0 ? s.slice(0, tIdx) : s;
}
function mapStatusFromApi(s) {
  return s === "completed" ? "Completed" : "Not Completed";
}
function stripTime(iso) {
  if (!iso) return "";
  const s = String(iso);
  const idx = s.indexOf("T");
  return idx > 0 ? s.slice(0, idx) : s;
}

/* Pull a friendly message out of a server error body. */
async function readErrorBody(res) {
  const body = await res.text().catch(() => "");
  if (!body) return `Request failed (${res.status})`;
  try {
    const parsed = JSON.parse(body);
    return parsed?.error?.message || parsed?.message || parsed?.detail || body;
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

function mapApiMilestoneToNode(m) {
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

/* ─── API activity → local node shape ─── */
function mapApiActivityToNode(a) {
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

function extractListElements(raw) {
  const elements =
    raw?.data?._embedded?.elements ??
    raw?._embedded?.elements ??
    raw?.data ??
    [];
  return Array.isArray(elements) ? elements : [];
}

/* Activity endpoint resolver — which sub-path to POST to based on UI state. */
function activityEndpointFor(formData) {
  const t = String(formData?.type || "").toLowerCase();
  if (t.includes("resource")) {
    return (formData.resourceEntryType === "count") ? "resource/count" : "resource/details";
  }
  if (t.includes("transactional")) return "transactional";
  return "standard";
}

export default function MilestoneConfigPage({ mode }) {
  const { projectId } = useParams();
  const navigate = useNavigate();

  useProjects();
  const draft = useDraft();
  const isOnboarding = mode === "onboarding";
  const realProject = useProject(projectId);

  const [editingConfig, setEditingConfig] = useState(isOnboarding);
  const [expandedRows, setExpandedRows] = useState(() => new Set());
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(5);
  const [modalCtx, setModalCtx] = useState(null);
  const [milestonesLoading, setMilestonesLoading] = useState(false);
  const [milestonesError, setMilestonesError] = useState("");

  const [apiProjectLocal, setApiProjectLocal] = useState(null);
  const [projectLoading, setProjectLoading] = useState(false);
  const [projectError, setProjectError] = useState("");

  const [restoring, setRestoring] = useState(() => {
    if (!isOnboarding) return false;
    if (draft) return false;
    return !!readPersistedOnboardingDraft();
  });

  const project = isOnboarding ? draft : (apiProjectLocal || realProject);

  const totalMilestones = project ? safeArray(project.milestones).length : 0;
  const effectivePageSize = pageSize > 0 ? pageSize : Math.max(totalMilestones, 1);
  const totalPages = totalMilestones === 0 ? 1 : Math.ceil(totalMilestones / effectivePageSize);
  const page = Math.max(1, Math.min(currentPage, totalPages));

  const rows = useMemo(() => {
    if (!project) return [];
    const out = [];
    function walk(node, kind, depth, milestoneUid, activityUid, parentTaskUid) {
      const kids = getChildren(node);
      const hasKids = kids.length > 0;
      const isExp = expandedRows.has(node.uid);
      out.push({
        node,
        kind,
        depth,
        hasKids,
        isExpanded: isExp,
        milestoneUid,
        activityUid,
        parentTaskUid
      });
      if (!isExp) return;
      if (kind === "milestone")
        kids.forEach((k) => walk(k, "activity", depth + 1, node.uid, null, null));
      else if (kind === "activity")
        kids.forEach((k) => walk(k, "task", depth + 1, milestoneUid, node.uid, null));
      else if (kind === "task")
        kids.forEach((k) => walk(k, "subtask", depth + 1, milestoneUid, activityUid, node.uid));
      else kids.forEach((k) => walk(k, "subtask", depth + 1, milestoneUid, activityUid, node.uid));
    }
    const allMs = safeArray(project.milestones);
    const startIdx = (page - 1) * effectivePageSize;
    const endIdx = Math.min(startIdx + effectivePageSize, allMs.length);
    allMs.slice(startIdx, endIdx).forEach((m) => walk(m, "milestone", 0, m.uid, null, null));
    return out;
  }, [project, expandedRows, page, effectivePageSize]);

  const depMap = useMemo(() => (project ? buildDepDisplayMap(project) : {}), [project]);

  const pid = project && project.projectId ? project.projectId : null;

  function commitUpdate(target) {
    if (!target) return;
    if (isOnboarding) {
      draftStore.refresh();
    } else {
      try { if (projectsStore.refresh) projectsStore.refresh(); } catch (e) {}
      setApiProjectLocal({ ...target });
    }
  }

  /* ─── Restore onboarding draft ─── */
  useEffect(() => {
    if (!isOnboarding) {
      setRestoring(false);
      return;
    }
    if (draft && draft.projectId) {
      setRestoring(false);
      return;
    }
    const persisted = readPersistedOnboardingDraft();
    if (persisted) {
      draftStore.set({
        projectName: "",
        description: "",
        owner: "",
        startDate: "",
        endDate: "",
        actualEndDate: "",
        isPublic: "Yes",
        category: "",
        vendors: [],
        milestones: [],
        auditLogs: [],
        resources: [],
        ...persisted,
        milestones: []
      });
    }
    setRestoring(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* ─── Persist onboarding draft ─── */
  useEffect(() => {
    if (isOnboarding && project && project.projectId) {
      persistOnboardingDraft(project);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOnboarding, pid, project && project.projectName]);

  /* ─── Fetch project from API ─── */
  useEffect(() => {
    if (isOnboarding) return;
    if (!projectId) return;

    let cancelled = false;

    async function loadProject() {
      const fromStore = projectsStore.find ? projectsStore.find(projectId) : null;
      if (fromStore) {
        setApiProjectLocal({ ...fromStore });
        return;
      }

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
          const msg = await readErrorBody(res);
          throw new Error(msg);
        }

        const raw = await res.json().catch(() => ({}));
        const mapped = mapApiProject(raw?.data ?? raw);

        if (cancelled) return;

        if (mapped) {
          setApiProjectLocal(mapped);
          try {
            if (projectsStore.addProject) {
              projectsStore.addProject(mapped);
              if (projectsStore.refresh) projectsStore.refresh();
            }
          } catch (e) {}
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
  }, [projectId, isOnboarding]);

  /* ─── GET /api/v3/milestones/{id}/activities ─── */
  async function loadActivitiesForMilestone(milestoneApiId) {
    if (!milestoneApiId) return [];
    const token = getToken();
    if (!token) return [];

    try {
      const res = await fetch(
        `${API_BASE}/api/v3/milestones/${encodeURIComponent(milestoneApiId)}/activities?offset=1&pageSize=20&includeDeleted=false`,
        {
          method: "GET",
          headers: {
            accept: "application/json",
            Authorization: `Bearer ${token}`
          }
        }
      );
      if (!res.ok) return [];
      const raw = await res.json().catch(() => ({}));
      return extractListElements(raw)
        .slice()
        .sort((a, b) => (a?.position ?? 0) - (b?.position ?? 0))
        .map(mapApiActivityToNode);
    } catch (e) {
      return [];
    }
  }

  /* ─── Load milestones, then activities for each ─── */
  async function loadMilestonesFromApi() {
    if (!pid) return;
    const token = getToken();
    if (!token) return;

    setMilestonesLoading(true);
    setMilestonesError("");
    try {
      const res = await fetch(
        `${API_BASE}/api/v3/projects/${encodeURIComponent(pid)}/milestones`,
        {
          method: "GET",
          headers: {
            accept: "application/json",
            Authorization: `Bearer ${token}`
          }
        }
      );

      if (res.status === 401) {
        logout();
        uiStore.showMessage("Session expired. Please sign in again.");
        navigate("/login");
        return;
      }

      if (!res.ok) {
        const msg = await readErrorBody(res);
        throw new Error(msg);
      }

      const raw = await res.json().catch(() => ({}));
      const apiList = extractListElements(raw)
        .slice()
        .sort((a, b) => (a?.position ?? 0) - (b?.position ?? 0));
      const mapped = apiList.map(mapApiMilestoneToNode);

      let target = null;
      if (isOnboarding) {
        target = draft;
      } else {
        target = projectsStore.find ? projectsStore.find(pid) : null;
        if (!target) target = apiProjectLocal;
      }

      if (target) {
        target.milestones = mapped;
        try { normalizeProject(target); } catch (e) {}
        try { recomputeActualDates(target); } catch (e) {}
        // Render milestones first (empty activity rows), then fill activities
        commitUpdate(target);

        // Phase 2: fetch activities for every milestone in parallel.
        if (mapped.length > 0) {
          const activityLists = await Promise.all(
            mapped.map((m) =>
              m.apiId ? loadActivitiesForMilestone(m.apiId) : Promise.resolve([])
            )
          );
          mapped.forEach((m, i) => { m.activities = activityLists[i] || []; });
          try { normalizeProject(target); } catch (e) {}
          try { recomputeActualDates(target); } catch (e) {}
          commitUpdate(target);
        }
      }
    } catch (err) {
      setMilestonesError(err?.message || "Failed to load milestones");
    } finally {
      setMilestonesLoading(false);
    }
  }

  useEffect(() => {
    if (pid) loadMilestonesFromApi();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pid]);

  if (!project) {
    if (restoring || projectLoading) {
      return (
        <div>
          <div className="uidai-page-title">Milestone Configuration</div>
          <div className="uidai-card-project">
            <div className="uidai-hint">
              {restoring ? "Restoring your session…" : "Loading project…"}
            </div>
          </div>
        </div>
      );
    }
    return (
      <div>
        <div className="uidai-page-title">Milestone Configuration</div>
        <div className="uidai-card-project">
          <div className="uidai-hint">
            {isOnboarding
              ? "No draft found. Please start from Add Project."
              : projectError
              ? `Could not load project: ${projectError}`
              : "Project not found."}
          </div>
          <div className="uidai-card-project-actions" style={{ justifyContent: "flex-start" }}>
            <button
              type="button"
              className="uidai-btn uidai-btn--cancel"
              onClick={() => navigate(isOnboarding ? "/projects/add" : "/projects")}
            >
              Back
            </button>
          </div>
        </div>
      </div>
    );
  }

  const editable = isOnboarding ? true : editingConfig;
  const canMod = isOnboarding || editable;
  const isVersion = !isOnboarding && isVersionProject(project);

  normalizeProject(project);
  try { recomputeActualDates(project); } catch (e) {}

  const showStatusCol = !isOnboarding;

  function allRowsExpanded() {
    let total = 0;
    let exp = 0;
    function walk(list) {
      safeArray(list).forEach((n) => {
        const kids = getChildren(n);
        if (kids.length) {
          total++;
          if (expandedRows.has(n.uid)) exp++;
          walk(kids);
        }
      });
    }
    walk(project.milestones);
    return total > 0 && total === exp;
  }

  function toggleExpandAll() {
    if (allRowsExpanded()) {
      setExpandedRows(new Set());
    } else {
      const next = new Set();
      function walk(list) {
        safeArray(list).forEach((n) => {
          if (getChildren(n).length) {
            next.add(n.uid);
            walk(getChildren(n));
          }
        });
      }
      walk(project.milestones);
      setExpandedRows(next);
    }
  }

  function toggleRow(uid) {
    const next = new Set(expandedRows);
    if (next.has(uid)) {
      next.delete(uid);
      const loc = locateNode(project, uid);
      if (loc) collectDescendantUids(loc.node).forEach((du) => next.delete(du));
    } else {
      const loc = locateNode(project, uid);
      if (loc && loc.kind !== "milestone" && loc.parent) {
        let siblings = [];
        if (loc.kind === "activity") siblings = safeArray(loc.parent.activities);
        else if (loc.kind === "task") siblings = safeArray(loc.parent.tasks);
        else siblings = safeArray(loc.parent.subtasks);
        siblings.forEach((s) => {
          if (s.uid !== uid) {
            next.delete(s.uid);
            collectDescendantUids(s).forEach((du) => next.delete(du));
          }
        });
      }
      next.add(uid);
    }
    setExpandedRows(next);
  }

  function goToPage(n) {
    setCurrentPage(Math.max(1, Math.min(totalPages, n)));
  }
  function setSize(v) {
    setPageSize(v);
    setCurrentPage(1);
  }

  function toggleEdit() {
    if (!editingConfig) {
      setEditingConfig(true);
      return;
    }
    setEditingConfig(false);
  }

  function openNodeModal(kind, modeAction, parentUid, nodeUid) {
    setModalCtx({ kind, mode: modeAction, parentUid, nodeUid });
  }
  function closeNodeModal() {
    setModalCtx(null);
  }

  /* ─── POST /milestones/create ─── */
  async function createMilestoneApi(formData) {
    const token = getToken();
    if (!token) throw new Error("Your session has expired. Please sign in again.");

    const payload = {
      name: formData.name.trim(),
      description: (formData.description || "").trim(),
      startDate: toMilestoneIsoStart(formData.startDate),
      endDate: toMilestoneIsoEnd(formData.endDate),
      status: mapStatusForApi(formData.status || "Not Completed"),
      vendorIds: resolveVendorIds(project, formData.vendor)
    };

    const res = await fetch(
      `${API_BASE}/api/v3/projects/${encodeURIComponent(project.projectId)}/milestones/create`,
      {
        method: "POST",
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
    if (!res.ok) {
      const msg = await readErrorBody(res);
      throw new Error(msg);
    }
    const raw = await res.json().catch(() => ({}));
    return raw?.data ?? raw ?? {};
  }

  /* ─── PATCH /milestones/{id} ─── */
  async function updateMilestoneApi(milestoneServerId, formData) {
    const token = getToken();
    if (!token) throw new Error("Your session has expired. Please sign in again.");

    const payload = {
      name: formData.name.trim(),
      description: (formData.description || "").trim(),
      startDate: toMilestoneIsoStart(formData.startDate),
      endDate: toMilestoneIsoEnd(formData.endDate),
      status: mapStatusForApi(formData.status || "Not Completed"),
      vendorIds: resolveVendorIds(project, formData.vendor)
    };

    const res = await fetch(
      `${API_BASE}/api/v3/milestones/${encodeURIComponent(milestoneServerId)}`,
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
    if (!res.ok) {
      const msg = await readErrorBody(res);
      throw new Error(msg);
    }
    const raw = await res.json().catch(() => ({}));
    return raw?.data ?? raw ?? {};
  }

  /* ─── DELETE /milestones/{id} ─── */
  async function deleteMilestoneApi(milestoneServerId) {
    const token = getToken();
    if (!token) throw new Error("Your session has expired. Please sign in again.");

    const res = await fetch(
      `${API_BASE}/api/v3/milestones/${encodeURIComponent(milestoneServerId)}`,
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
      const msg = await readErrorBody(res);
      throw new Error(msg);
    }
    return true;
  }

  /* ─── POST /projects/{id}/save ─── */
  async function saveProjectApi(projectServerId) {
    const token = getToken();
    if (!token) throw new Error("Your session has expired. Please sign in again.");

    const res = await fetch(
      `${API_BASE}/api/v3/projects/${encodeURIComponent(projectServerId)}/save`,
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
      const msg = await readErrorBody(res);
      throw new Error(msg);
    }
    const raw = await res.json().catch(() => ({}));
    return raw?.data ?? raw ?? {};
  }

  /* ─── POST /milestones/{id}/activities/{kind}/create
     Four endpoints — standard, transactional, resource/count, resource/details. */
  async function createActivityApi(milestoneApiId, formData) {
    const token = getToken();
    if (!token) throw new Error("Your session has expired. Please sign in again.");

    const endpoint = activityEndpointFor(formData);

    const base = {
      name: formData.name.trim(),
      description: (formData.description || "").trim(),
      startDate: toMilestoneIsoStart(formData.startDate),
      endDate: toMilestoneIsoEnd(formData.endDate),
      actualStartDate: formData.actualStartDate ? toMilestoneIsoStart(formData.actualStartDate) : null,
      actualEndDate: formData.actualEndDate ? toMilestoneIsoEnd(formData.actualEndDate) : null,
      position: 0,
      dependsOn: []
    };

    let payload;
    if (endpoint === "standard") {
      payload = { ...base, status: mapStatusForApi(formData.status || "Not Completed") };
    } else if (endpoint === "transactional") {
      payload = { ...base };
    } else if (endpoint === "resource/count") {
      const rc = formData.resourceCount || {};
      payload = {
        ...base,
        resourceCount: parseInt(rc.count, 10) || 1
      };
    } else {
      // resource/details
      const rd = formData.resourceDetails || {};
      payload = {
        ...base,
        resource: {
          resourceName: rd.resourceName || "",
          onboardDate: rd.onboardingDate ? toMilestoneIsoStart(rd.onboardingDate) : null,
          actualOnboardDate: rd.actualOnboardingDate ? toMilestoneIsoStart(rd.actualOnboardingDate) : null,
          offboardDate: rd.offboardingDate ? toMilestoneIsoEnd(rd.offboardingDate) : null,
          actualOffboardDate: rd.actualOffboardingDate ? toMilestoneIsoEnd(rd.actualOffboardingDate) : null,
          position: rd.position || "",
          designation: rd.designation || "",
          jobRole: rd.jobRole || "",
          qualification: rd.qualification || "",
          experienceYears: parseFloat(rd.experience) || 0,
          typeOfResourceId: rd.resType || "",
          division: rd.division || "",
          divisionOther: ""
        }
      };
    }

    const url = `${API_BASE}/api/v3/milestones/${encodeURIComponent(milestoneApiId)}/activities/${endpoint}/create`;
    const res = await fetch(url, {
      method: "POST",
      headers: {
        accept: "application/json",
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`
      },
      body: JSON.stringify(payload)
    });

    if (res.status === 401) {
      logout();
      const err = new Error("Session expired. Please sign in again.");
      err.isAuth = true;
      throw err;
    }
    if (!res.ok) {
      const msg = await readErrorBody(res);
      throw new Error(msg);
    }
    const raw = await res.json().catch(() => ({}));
    return raw?.data ?? raw ?? {};
  }

  function saveNodeFromModal(formData) {
    if (!modalCtx) return;
    const { kind, mode: modeAction, parentUid, nodeUid } = modalCtx;
    const bounds = formData.bounds;

    if (isVersionProject(project)) {
      if (modeAction === "add" && (kind === "milestone" || kind === "activity")) {
        uiStore.showMessage(
          "Cannot add " + kind + "s to a version project. Only Tasks and Sub-Tasks can be added."
        );
        return;
      }
      if (modeAction === "edit" && nodeUid) {
        const loc = locateNode(project, nodeUid);
        if (loc && isNodeBaselineLocked(project, loc.node)) {
          uiStore.showMessage("Baseline items cannot be edited within a version.");
          return;
        }
      }
    } else if (!isOnboarding) {
      if (modeAction === "add" && (kind === "task" || kind === "subtask")) {
        uiStore.showMessage(
          "Tasks and Sub-Tasks can only be added in a version. Publish this project and create a version first."
        );
        return;
      }
    } else {
      if (modeAction === "add" && (kind === "task" || kind === "subtask")) {
        uiStore.showMessage(
          "Only Milestones and Activities can be added during onboarding. Tasks and Sub-Tasks are added later in a version."
        );
        return;
      }
    }

    if (!formData.name.trim() || !formData.startDate || !formData.endDate) {
      uiStore.showMessage("Fill required fields.");
      return;
    }
    if (formData.endDate < formData.startDate) {
      uiStore.showMessage("Expected End Date cannot be earlier than Expected Start Date.");
      return;
    }

    if (bounds && bounds.start && bounds.end) {
      if (formData.startDate < bounds.start || formData.startDate > bounds.end) {
        uiStore.showMessage(
          `Expected Start Date must be between ${formatDateDisplay(bounds.start)} and ${formatDateDisplay(bounds.end)}.`
        );
        return;
      }
      if (formData.endDate < bounds.start || formData.endDate > bounds.end) {
        uiStore.showMessage(
          `Expected End Date must be between ${formatDateDisplay(bounds.start)} and ${formatDateDisplay(bounds.end)}.`
        );
        return;
      }
    }

    if (modeAction === "edit" && nodeUid) {
      const loc = locateNode(project, nodeUid);
      if (loc) {
        const violations = findChildDateViolations(loc.node, formData.startDate, formData.endDate);
        if (violations.length) {
          const v = violations[0];
          uiStore.showMessage(
            `Cannot narrow date range — "${v.name}" is scheduled ${formatDateDisplay(
              v.startDate
            )} to ${formatDateDisplay(v.endDate)} which falls outside the new range.`
          );
          return;
        }
      }
    }

    if (formData.status === "Completed") {
      const unmet = safeArray(formData.dependsOn)
        .map((uid) => {
          const loc = locateNode(project, uid);
          return loc && effectiveStatus(loc.node) !== "Completed" ? loc.node : null;
        })
        .filter(Boolean);
      if (unmet.length) {
        uiStore.showMessage(
          `Cannot mark as Completed: dependency "${unmet[0].name}" is not yet completed.`
        );
        return;
      }
    }

    uiStore.showLoader(modeAction === "add" ? "Saving new item..." : "Updating item...");

    const uiPayload = {
      name: formData.name.trim(),
      description: (formData.description || "").trim(),
      startDate: formData.startDate,
      endDate: formData.endDate,
      status: formData.status,
      dependsOn: formData.dependsOn,
      type: formData.type,
      vendor: formData.vendor,
      resourceEntryType: formData.resourceEntryType,
      resourceDetails: formData.resourceDetails,
      resourceCount: formData.resourceCount,
    };

    /* ── Milestone remote branches ── */
    const shouldCreateMilestoneRemotely =
      modeAction === "add" &&
      kind === "milestone" &&
      !!project.projectId &&
      !!getToken();

    let milestoneServerId = null;
    if (modeAction === "edit" && kind === "milestone" && nodeUid) {
      const loc = locateNode(project, nodeUid);
      milestoneServerId = loc && loc.node ? loc.node.apiId || null : null;
    }
    const shouldUpdateMilestoneRemotely =
      modeAction === "edit" &&
      kind === "milestone" &&
      !!milestoneServerId &&
      !!getToken();

    /* ── Activity remote branch — parent milestone's server UUID ── */
    let activityParentMilestoneApiId = null;
    if (modeAction === "add" && kind === "activity" && parentUid) {
      const mLoc = locateNode(project, parentUid);
      if (mLoc && mLoc.node) activityParentMilestoneApiId = mLoc.node.apiId || null;
    }
    const shouldCreateActivityRemotely =
      modeAction === "add" &&
      kind === "activity" &&
      !!activityParentMilestoneApiId &&
      !!getToken();

    const doLocal = (apiData) => {
      let target;
      if (isOnboarding) target = project;
      else {
        target = projectsStore.find ? projectsStore.find(project.projectId) : null;
        if (!target) target = apiProjectLocal;
      }
      if (!target) {
        uiStore.hideLoader();
        return;
      }

      if (modeAction === "add") {
        const newNode = {
          uid: generateNodeUid(kind[0]),
          name: formData.name.trim(),
          description: formData.description.trim(),
          startDate: formData.startDate,
          endDate: formData.endDate,
          status: "Not Completed",
          dependsOn: formData.dependsOn,
          comments: safeArray(formData.comments),
          attachments: []
        };
        if (apiData && apiData.id) newNode.apiId = apiData.id;

        if (kind !== "milestone") {
          newNode.actualStartDate = "";
          newNode.actualEndDate = "";
          newNode.type = formData.type;
          if (formData.type === "Resource Type") {
            newNode.resourceEntryType = formData.resourceEntryType;
            if (formData.resourceEntryType === "details")
              newNode.resourceDetails = formData.resourceDetails;
            else newNode.resourceCount = formData.resourceCount;
          }
        } else {
          newNode.vendor = formData.vendor;
        }
        if (kind === "milestone") {
          newNode.activities = [];
          target.milestones.push(newNode);
        } else if (kind === "activity") {
          newNode.tasks = [];
          const parent = locateNode(target, parentUid)?.node;
          if (!parent) {
            uiStore.hideLoader();
            uiStore.showMessage("Parent milestone not found.");
            return;
          }
          parent.activities = safeArray(parent.activities);
          parent.activities.push(newNode);
        } else if (kind === "task") {
          newNode.subtasks = [];
          const parent = locateNode(target, parentUid)?.node;
          if (!parent) {
            uiStore.hideLoader();
            uiStore.showMessage("Parent activity not found.");
            return;
          }
          parent.tasks = safeArray(parent.tasks);
          parent.tasks.push(newNode);
        } else {
          newNode.subtasks = [];
          const parent = locateNode(target, parentUid)?.node;
          if (!parent) {
            uiStore.hideLoader();
            uiStore.showMessage("Parent not found.");
            return;
          }
          parent.subtasks = safeArray(parent.subtasks);
          parent.subtasks.push(newNode);
        }

        if (parentUid) {
          setExpandedRows((prev) => new Set([...prev, parentUid]));
        }

        if (kind === "milestone" && pageSize > 0) {
          const idx = target.milestones.findIndex((m) => m.uid === newNode.uid);
          if (idx >= 0) setCurrentPage(Math.floor(idx / pageSize) + 1);
        }

        if (!isOnboarding) {
          addAudit(
            target,
            `Add ${kind.charAt(0).toUpperCase() + kind.slice(1)}`,
            "-",
            deepClone(newNode)
          );
          if (isBaselineProject(target)) {
            propagateNodeAddToVersions(projectsStore.getAll ? projectsStore.getAll() : [], target, parentUid, kind, newNode);
          }
        }
      } else {
        const loc = locateNode(target, nodeUid);
        if (!loc) {
          uiStore.hideLoader();
          uiStore.showMessage("Item not found.");
          return;
        }
        const { node } = loc;
        const before = deepClone(node);
        node.name = formData.name.trim();
        node.description = formData.description.trim();
        node.startDate = formData.startDate;
        node.endDate = formData.endDate;
        node.status = formData.status;
        node.dependsOn = formData.dependsOn;
        if (kind !== "milestone") {
          if (getChildren(node).length === 0) {
            node.actualStartDate = formData.actualStartDate;
            node.actualEndDate = formData.actualEndDate;
          }
          node.type = formData.type;
          if (formData.type === "Resource Type") {
            node.resourceEntryType = formData.resourceEntryType;
            if (formData.resourceEntryType === "details")
              node.resourceDetails = formData.resourceDetails;
            else node.resourceCount = formData.resourceCount;
          }
        } else {
          node.vendor = formData.vendor;
        }
        node.comments = safeArray(formData.comments);

        if (!isOnboarding) {
          addAudit(
            target,
            `Update ${kind.charAt(0).toUpperCase() + kind.slice(1)}`,
            before,
            deepClone(node)
          );
          if (isBaselineProject(target)) {
            propagateNodeUpdateToVersions(projectsStore.getAll ? projectsStore.getAll() : [], target, nodeUid, {
              name: node.name,
              description: node.description,
              startDate: node.startDate,
              endDate: node.endDate,
              status: node.status,
              dependsOn: node.dependsOn,
              type: node.type,
              vendor: node.vendor,
              resourceEntryType: node.resourceEntryType,
              resourceDetails: node.resourceDetails,
              resourceCount: node.resourceCount
            });
          }
        }
      }

      rollUpStatus(target);
      recomputeActualDates(target);
      normalizeProject(target);

      commitUpdate(target);
      uiStore.hideLoader();
      closeNodeModal();
      uiStore.showMessage(modeAction === "add" ? "Item added" : "Item updated");
    };

    if (shouldCreateMilestoneRemotely) {
      createMilestoneApi(formData)
        .then((created) => {
          doLocal(created);
          loadMilestonesFromApi();
        })
        .catch((err) => {
          uiStore.hideLoader();
          if (err && err.isAuth) {
            uiStore.showMessage(err.message);
            navigate("/login");
            return;
          }
          uiStore.showMessage(err?.message || "Failed to create milestone");
        });
      return;
    }

    if (shouldUpdateMilestoneRemotely) {
      updateMilestoneApi(milestoneServerId, formData)
        .then((updated) => {
          doLocal(updated);
          loadMilestonesFromApi();
        })
        .catch((err) => {
          uiStore.hideLoader();
          if (err && err.isAuth) {
            uiStore.showMessage(err.message);
            navigate("/login");
            return;
          }
          uiStore.showMessage(err?.message || "Failed to update milestone");
        });
      return;
    }

    if (shouldCreateActivityRemotely) {
      createActivityApi(activityParentMilestoneApiId, formData)
        .then((created) => {
          doLocal(created);
          loadMilestonesFromApi();
        })
        .catch((err) => {
          uiStore.hideLoader();
          if (err && err.isAuth) {
            uiStore.showMessage(err.message);
            navigate("/login");
            return;
          }
          uiStore.showMessage(err?.message || "Failed to create activity");
        });
      return;
    }

    const apiCall = (() => {
      if (isOnboarding || !tokenStore.get()) return null;
      if (modeAction === "add") {
        const parentId = kind === "milestone" ? project.projectId : parentUid;
        return nodesApi.createByKind[kind] ? nodesApi.createByKind[kind](parentId, uiPayload) : null;
      }
      return nodesApi.updateByKind[kind] ? nodesApi.updateByKind[kind](nodeUid, uiPayload) : null;
    })();

    if (apiCall) {
      apiCall
        .then(() => { hydrateProjects({ force: true }); doLocal(); })
        .catch((err) => { uiStore.hideLoader(); uiStore.showMessage(err?.message || "Failed to save item"); });
    } else {
      setTimeout(doLocal, 500);
    }
  }

  function removeNode(kind, uid) {
    let target;
    if (isOnboarding) target = project;
    else {
      target = projectsStore.find ? projectsStore.find(project.projectId) : null;
      if (!target) target = apiProjectLocal;
    }
    if (!target) return;
    const loc = locateNode(target, uid);
    if (!loc) return;
    if (isNodeBaselineLocked(target, loc.node)) {
      uiStore.showMessage("Baseline items cannot be deleted from a version project.");
      return;
    }
    if (!window.confirm(`Remove ${kind} "${loc.node.name || uid}" and all of its children?`)) return;

    uiStore.showLoader("Removing...");

    const doLocal = () => {
      const { parent, parentKind, node } = loc;
      const removed = deepClone(node);
      let list;
      if (parentKind === "project") list = parent.milestones;
      else if (parentKind === "milestone") list = parent.activities;
      else if (parentKind === "activity") list = parent.tasks;
      else list = parent.subtasks;
      const idx = list.findIndex((x) => x.uid === uid);
      if (idx >= 0) list.splice(idx, 1);

      if (!isOnboarding) {
        addAudit(target, `Delete ${kind.charAt(0).toUpperCase() + kind.slice(1)}`, removed, "-");
        if (isBaselineProject(target)) {
          propagateNodeDeleteToVersions(projectsStore.getAll ? projectsStore.getAll() : [], target, uid);
        }
      }

      setExpandedRows((prev) => {
        const next = new Set(prev);
        next.delete(uid);
        return next;
      });
      normalizeProject(target);
      recomputeActualDates(target);
      commitUpdate(target);
      uiStore.hideLoader();
      uiStore.showMessage("Removed");
    };

    const milestoneServerId =
      kind === "milestone" && loc.node ? loc.node.apiId || null : null;
    const shouldDeleteMilestoneRemotely =
      kind === "milestone" && !!milestoneServerId && !!getToken();

    if (shouldDeleteMilestoneRemotely) {
      deleteMilestoneApi(milestoneServerId)
        .then(() => {
          doLocal();
          loadMilestonesFromApi();
        })
        .catch((err) => {
          uiStore.hideLoader();
          if (err && err.isAuth) {
            uiStore.showMessage(err.message);
            navigate("/login");
            return;
          }
          uiStore.showMessage(err?.message || "Failed to delete milestone");
        });
      return;
    }

    if (!isOnboarding && tokenStore.get() && nodesApi.removeByKind[kind]) {
      nodesApi.removeByKind[kind](uid)
        .then(() => { hydrateProjects({ force: true }); doLocal(); })
        .catch((err) => { uiStore.hideLoader(); uiStore.showMessage(err?.message || "Failed to remove item"); });
    } else {
      setTimeout(doLocal, 500);
    }
  }

  function finalizeOnboarding() {
    if (!safeArray(project.milestones).length) {
      uiStore.showMessage("Add at least one milestone before saving.");
      return;
    }
    uiStore.showLoader("Saving project...");

    const doLocal = (idOverride) => {
      const p = deepClone(project);
      p.projectId = idOverride || p.projectId || projectsStore.getNextProjectId();
      p.status = "DRAFT";
      p.baselineId = "-";
      p.auditLogs = [];
      normalizeProject(p);
      projectsStore.addProject(p);
      draftStore.clear();
      clearPersistedOnboardingDraft();
      uiStore.hideLoader();
      uiStore.showMessage(`Project ${p.projectId} added successfully!`, () =>
        navigate("/projects")
      );
    };

    if (project.projectId && getToken()) {
      saveProjectApi(project.projectId)
        .then(() => {
          try { hydrateProjects({ force: true }); } catch (e) {}
          doLocal(project.projectId);
        })
        .catch((err) => {
          uiStore.hideLoader();
          if (err && err.isAuth) {
            uiStore.showMessage(err.message);
            navigate("/login");
            return;
          }
          uiStore.showMessage(err?.message || "Failed to save project");
        });
      return;
    }

    if (project.projectId) {
      try { hydrateProjects({ force: true }); } catch (e) {}
      setTimeout(() => doLocal(project.projectId), 400);
      return;
    }

    if (!tokenStore.get()) {
      setTimeout(() => doLocal(), 900);
      return;
    }

    (async () => {
      try {
        const created = await projectsApi.create({
          projectName: project.projectName,
          description: project.description,
          owner: project.owner,
          isPublic: project.isPublic,
          category: project.category,
          startDate: project.startDate,
          endDate: project.endDate,
        });
        const projectUuid = created.projectId;
        for (const m of safeArray(project.milestones)) {
          const mRes = await nodesApi.createMilestone(projectUuid, m);
          const mId = mRes?.uuid || mRes?.id;
          if (!mId) continue;
          for (const a of safeArray(m.activities)) {
            const aRes = await nodesApi.createActivity(mId, a);
            const aId = aRes?.uuid || aRes?.id;
            if (!aId) continue;
            for (const t of safeArray(a.tasks)) {
              const tRes = await nodesApi.createTask(aId, t);
              const tId = tRes?.uuid || tRes?.id;
              if (!tId) continue;
              for (const s of safeArray(t.subtasks)) {
                await nodesApi.createSubtask(tId, s);
              }
            }
          }
        }
        try { await saveProjectApi(projectUuid); } catch {}
        hydrateProjects({ force: true });
        doLocal(projectUuid);
      } catch (err) {
        uiStore.hideLoader();
        uiStore.showMessage(err?.message || "Failed to create project");
      }
    })();
  }

  const title = project.projectName || "New Project";
  const topActions = isOnboarding ? (
    <>
      <button type="button" className="uidai-btn" onClick={finalizeOnboarding}>
        Save Project
      </button>
      <button
        type="button"
        className="uidai-btn uidai-btn--cancel"
        onClick={() => navigate("/projects/add")}
      >
        Back
      </button>
    </>
  ) : (
    <>
      <button type="button" className="uidai-btn" onClick={toggleEdit}>
        {editingConfig ? "Save" : "Edit"}
      </button>
      <button
        type="button"
        className="uidai-btn uidai-btn--cancel"
        onClick={() => navigate(`/projects/${encodeURIComponent(project.projectId)}`)}
      >
        Back
      </button>
    </>
  );

  const expandAllLabel = allRowsExpanded() ? "Collapse All" : "Expand All";
  const addMilestoneBtn =
    canMod && !isVersion ? (
      <button
        type="button"
        className="uidai-btn uidai-btn--small"
        onClick={() => openNodeModal("milestone", "add", null, null)}
      >
        + Add Milestone
      </button>
    ) : null;

  const versionBanner = isVersion ? (
    <div className="uidai-baseline-note">
      🔒{" "}
      <span>
        <strong>Version project.</strong> Baseline milestones and activities are locked here. You
        can add <em>Tasks</em> under existing activities and <em>Sub-Tasks</em> under existing
        tasks. Progress on those new items rolls up to the baseline.
      </span>
    </div>
  ) : null;

  const colSpan = showStatusCol ? 9 : 8;

  return (
    <div>
      <div className="uidai-page-header">
        <div className="uidai-page-title">Milestone Configuration</div>
        <div className="uidai-page-header__actions">{topActions}</div>
      </div>

      <div className="uidai-card-project">
        <h3 style={{ marginTop: 0 }}>{title}</h3>
        <div className="uidai-hint">
          Disclaimer: Every add, edit, delete, and version change is audited with who, when, what
          changed, and before/after details.
        </div>
        {versionBanner}

        {milestonesLoading && (
          <div className="uidai-hint" style={{ marginTop: 8 }}>
            Loading milestones...
          </div>
        )}
        {milestonesError && !milestonesLoading && (
          <div className="uidai-hint" style={{ marginTop: 8, color: "#b91c1c" }}>
            Could not load milestones: {milestonesError}
          </div>
        )}

        <div className="uidai-msgrid__toolbar">
          <div className="uidai-msgrid__toolbar-right">
            <button
              type="button"
              className="uidai-btn uidai-btn--small"
              onClick={toggleExpandAll}
            >
              {expandAllLabel}
            </button>
            {addMilestoneBtn}
          </div>
        </div>

        <div className="uidai-msgrid-wrap">
          <table className="uidai-msgrid">
            <thead>
              <tr>
                <th style={{ width: 90 }}>WBS</th>
                <th>Name</th>
                <th style={{ width: 130 }}>Type</th>
                {showStatusCol && <th style={{ width: 160 }}>Status</th>}
                <th style={{ width: 130 }}>Start Date</th>
                <th style={{ width: 130 }}>End Date</th>
                <th style={{ width: 120 }}>Vendor</th>
                <th style={{ width: 160 }}>Depends On</th>
                <th style={{ width: 220 }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 ? (
                <tr className="uidai-msgrid__empty">
                  <td colSpan={colSpan}>
                    {milestonesLoading
                      ? "Loading milestones..."
                      : totalMilestones === 0
                      ? `No milestones added yet${
                          canMod ? " — click + Add Milestone above to start." : "."
                        }`
                      : "No milestones to display on this page."}
                  </td>
                </tr>
              ) : (
                rows.map((r) => (
                  <GridRow
                    key={r.node.uid}
                    r={r}
                    project={project}
                    depMap={depMap}
                    canMod={canMod}
                    showStatusCol={showStatusCol}
                    isOnboarding={isOnboarding}
                    isVersion={isVersion}
                    onToggle={toggleRow}
                    onAddChild={openNodeModal}
                    onEdit={openNodeModal}
                    onDelete={removeNode}
                    onTrack={(uid) =>
                      navigate(
                        `/projects/${encodeURIComponent(project.projectId)}/track/${encodeURIComponent(
                          uid
                        )}`
                      )
                    }
                  />
                ))
              )}
            </tbody>
          </table>
        </div>

        {totalMilestones > 0 && (
          <Pagination
            total={totalMilestones}
            page={page}
            totalPages={totalPages}
            pageSize={pageSize}
            onGoto={goToPage}
            onSize={setSize}
          />
        )}
      </div>

      {modalCtx && (
        <NodeModal
          open
          kind={modalCtx.kind}
          mode={modalCtx.mode}
          project={project}
          parentUid={modalCtx.parentUid}
          nodeUid={modalCtx.nodeUid}
          editable={(() => {
            if (!canMod) return false;
            if (modalCtx.mode !== "edit" || !modalCtx.nodeUid) return true;
            const loc = locateNode(project, modalCtx.nodeUid);
            if (!loc) return true;
            return !isNodeBaselineLocked(project, loc.node);
          })()}
          onCancel={closeNodeModal}
          onSave={saveNodeFromModal}
          onError={(m) => uiStore.showMessage(m)}
        />
      )}
    </div>
  );
}

function GridRow({
  r,
  project,
  depMap,
  canMod,
  showStatusCol,
  isOnboarding,
  isVersion,
  onToggle,
  onAddChild,
  onEdit,
  onDelete,
  onTrack
}) {
  const { node, kind, depth, hasKids, isExpanded } = r;
  const indent = 10 + depth * 28;

  const eff = effectiveStatus(node);
  const rolled = eff === "Completed" && node.status !== "Completed";
  const pillClass =
    eff === "Completed"
      ? rolled
        ? "uidai-status-pill--rolledup"
        : "uidai-status-pill--done"
      : "uidai-status-pill--todo";
  const pillLabel =
    eff === "Completed" ? (rolled ? "All children completed" : "Completed") : "Not Completed";

  const deps = safeArray(node.dependsOn)
    .map((uid) => depMap[uid])
    .filter(Boolean);

  const typeLabel = kind === "milestone" ? "Milestone" : node.type || "";
  const locked = isNodeBaselineLocked(project, node);

  let addChildBtn = null;
  if (canMod) {
    if (kind === "milestone" && !isVersion) {
      addChildBtn = (
        <button
          type="button"
          className="uidai-msgrid__add-inline"
          onClick={(e) => {
            e.stopPropagation();
            onAddChild("activity", "add", node.uid, null);
          }}
        >
          + Activity
        </button>
      );
    } else if (kind === "activity" && !isOnboarding && isVersion) {
      addChildBtn = (
        <button
          type="button"
          className="uidai-msgrid__add-inline"
          onClick={(e) => {
            e.stopPropagation();
            onAddChild("task", "add", node.uid, null);
          }}
        >
          + Task
        </button>
      );
    } else if ((kind === "task" || kind === "subtask") && !isOnboarding && isVersion) {
      addChildBtn = (
        <button
          type="button"
          className="uidai-msgrid__add-inline"
          onClick={(e) => {
            e.stopPropagation();
            onAddChild("subtask", "add", node.uid, null);
          }}
        >
          + Sub Task
        </button>
      );
    }
  }

  const rowClass = `uidai-msgrid__row--${kind}` + (locked ? " uidai-msgrid__row--locked" : "");

  const parentUidForEdit = r.milestoneUid || r.activityUid || r.parentTaskUid || "";

  return (
    <tr className={rowClass}>
      <td className="uidai-msgrid__cell uidai-msgrid__cell--wbs">{node.id || ""}</td>
      <td className="uidai-msgrid__cell uidai-msgrid__cell--name">
        <div className="uidai-msgrid__name-inner" style={{ paddingLeft: indent }}>
          {hasKids ? (
            <button
              type="button"
              className="uidai-msgrid__expand-btn"
              onClick={(e) => {
                e.stopPropagation();
                onToggle(node.uid);
              }}
              aria-label="Toggle"
            >
              {isExpanded ? "−" : "+"}
            </button>
          ) : (
            <span className="uidai-msgrid__expand-spacer" />
          )}
          <span className="uidai-msgrid__row-label" title={node.name}>
            {node.name}
          </span>
          {locked && (
            <span
              className="uidai-baseline-lock-icon"
              title="Baseline item — locked in this version"
            >
              🔒
            </span>
          )}
          {addChildBtn}
        </div>
      </td>
      <td className="uidai-msgrid__cell">
        {typeLabel ? <span className="uidai-type-tag">{typeLabel}</span> : null}
      </td>
      {showStatusCol && (
        <td className="uidai-msgrid__cell">
          <span className={`uidai-status-pill ${pillClass}`}>{pillLabel}</span>
        </td>
      )}
      <td className="uidai-msgrid__cell uidai-msgrid__cell--date">
        {formatDateDisplay(node.startDate)}
      </td>
      <td className="uidai-msgrid__cell uidai-msgrid__cell--date">
        {formatDateDisplay(node.endDate)}
      </td>
      <td className="uidai-msgrid__cell">
        {kind === "milestone" && node.vendor ? (
          <span className="uidai-vendor-tag">{node.vendor}</span>
        ) : (
          <span className="uidai-dep-empty">—</span>
        )}
      </td>
      <td className="uidai-msgrid__cell">
        {deps.length === 0 ? (
          <span className="uidai-dep-empty">—</span>
        ) : (
          deps.map((d, i) => (
            <span key={i} className="uidai-dep-tag">
              {d.id || d.name}
            </span>
          ))
        )}
      </td>
      <td className="uidai-msgrid__cell uidai-msgrid__cell--actions">
        {!isOnboarding && (
          <button
            type="button"
            className="uidai-msgrid__btn-text"
            onClick={() => onTrack(node.uid)}
          >
            Track
          </button>
        )}
        <button
          type="button"
          className="uidai-msgrid__btn-text"
          onClick={() => onEdit(kind, "edit", parentUidForEdit, node.uid)}
        >
          {locked ? "View" : "Edit"}
        </button>
        <button
          type="button"
          className="uidai-msgrid__btn-text uidai-msgrid__btn-text--danger"
          disabled={!canMod || locked}
          title={locked ? "Baseline items cannot be deleted from a version" : ""}
          onClick={() => onDelete(kind, node.uid)}
        >
          Delete
        </button>
      </td>
    </tr>
  );
}

function Pagination({ total, page, totalPages, pageSize, onGoto, onSize }) {
  const maxNumbered = 5;
  let startP = Math.max(1, page - Math.floor(maxNumbered / 2));
  let endP = Math.min(totalPages, startP + maxNumbered - 1);
  if (endP - startP + 1 < maxNumbered) startP = Math.max(1, endP - maxNumbered + 1);
  const numbers = [];
  for (let i = startP; i <= endP; i++) numbers.push(i);
  const rangeStart = total === 0 ? 0 : (page - 1) * (pageSize > 0 ? pageSize : total) + 1;
  const rangeEnd = pageSize > 0 ? Math.min(page * pageSize, total) : total;

  return (
    <div className="uidai-pagination">
      <div className="uidai-pagination__info">
        Showing {rangeStart}–{rangeEnd} of {total} milestone{total === 1 ? "" : "s"}
      </div>
      <div className="uidai-pagination__controls">
        <button
          type="button"
          className="uidai-pagination__btn"
          onClick={() => onGoto(page - 1)}
          disabled={page <= 1}
        >
          ‹ Prev
        </button>
        {startP > 1 && (
          <>
            <button type="button" className="uidai-pagination__btn" onClick={() => onGoto(1)}>
              1
            </button>
            {startP > 2 && <span className="uidai-pagination__info">…</span>}
          </>
        )}
        {numbers.map((i) => (
          <button
            key={i}
            type="button"
            className={`uidai-pagination__btn${
              i === page ? " uidai-pagination__btn--active" : ""
            }`}
            onClick={() => onGoto(i)}
          >
            {i}
          </button>
        ))}
        {endP < totalPages && (
          <>
            {endP < totalPages - 1 && <span className="uidai-pagination__info">…</span>}
            <button
              type="button"
              className="uidai-pagination__btn"
              onClick={() => onGoto(totalPages)}
            >
              {totalPages}
            </button>
          </>
        )}
        <button
          type="button"
          className="uidai-pagination__btn"
          onClick={() => onGoto(page + 1)}
          disabled={page >= totalPages}
        >
          Next ›
        </button>
      </div>
      <div className="uidai-pagination__size">
        <label htmlFor="uidai-page-size" style={{ fontWeight: 600 }}>
          Page size:
        </label>
        <select
          id="uidai-page-size"
          className="uidai-select"
          value={pageSize}
          onChange={(e) => onSize(parseInt(e.target.value, 10))}
        >
          <option value="5">5</option>
          <option value="10">10</option>
          <option value="20">20</option>
          <option value="0">All</option>
        </select>
      </div>
    </div>
  );
}