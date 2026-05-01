import React, { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { projectsStore, useProject, useProjects } from "../../store/project/projectsStore";
import { draftStore, useDraft } from "../../store/project/draftStore";
import { uiStore } from "../../store/project/uiStore";
import { safeArray, deepClone, generateNodeUid, formatDateDisplay } from "../../utils/project/helpers";
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
import {
  persistOnboardingDraft,
  readPersistedOnboardingDraft,
  clearPersistedOnboardingDraft,
  findEnclosingTaskApiId
} from "../../utils/project/milestoneConfigHelpers";
import {
  loadProjectById,
  loadMilestonesForProject,
  loadActivitiesForMilestone,
  loadTasksForActivity,
  loadSubtasksForTask,
  createMilestoneApi,
  updateMilestoneApi,
  deleteMilestoneApi,
  saveProjectApi,
  createActivityApi,
  updateActivityApi,
  deleteActivityApi,
  createTaskApi,
  updateTaskApi,
  deleteTaskApi,
  createSubtaskApi,
  updateSubtaskApi,
  deleteSubtaskApi,
  resolveProjectDependsOn
} from "../../api/milestoneConfigApi";
import NodeModal from "../../components/projects/modals/NodeModal";
import MilestoneGridRow from "../../components/projects/MilestoneGridRow";
import MilestonePagination from "../../components/projects/MilestonePagination";
import * as projectsApi from "../../api/projects";
import * as nodesApi from "../../api/nodes";
import { tokenStore } from "../../api/client";
import { getToken } from "../../api/auth";
import { hydrateProjects } from "../../store/project/apiSync";

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
        node, kind, depth, hasKids, isExpanded: isExp,
        milestoneUid, activityUid, parentTaskUid
      });
      if (!isExp) return;
      if (kind === "milestone")
        kids.forEach((k) => walk(k, "activity", depth + 1, node.uid, null, null));
      else if (kind === "activity")
        kids.forEach((k) => walk(k, "task", depth + 1, milestoneUid, node.uid, null));
      else if (kind === "task")
        kids.forEach((k) => walk(k, "subtask", depth + 1, milestoneUid, activityUid, node.uid));
      else
        kids.forEach((k) => walk(k, "subtask", depth + 1, milestoneUid, activityUid, node.uid));
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

  function handleAuthError(err) {
    uiStore.showMessage(err?.message || "Session expired. Please sign in again.");
    navigate("/login");
  }

  /* ─── Restore onboarding draft from localStorage if needed ─── */
  useEffect(() => {
    if (!isOnboarding) { setRestoring(false); return; }
    if (draft && draft.projectId) { setRestoring(false); return; }
    const persisted = readPersistedOnboardingDraft();
    if (persisted) {
      draftStore.set({
        projectName: "", description: "", owner: "",
        startDate: "", endDate: "", actualEndDate: "",
        isPublic: "Yes", category: "",
        vendors: [], milestones: [], auditLogs: [], resources: [],
        ...persisted,
        milestones: []
      });
    }
    setRestoring(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (isOnboarding && project && project.projectId) {
      persistOnboardingDraft(project);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOnboarding, pid, project && project.projectName]);

  /* ─── Fetch project when not onboarding and the store doesn't have it ─── */
  useEffect(() => {
    if (isOnboarding || !projectId) return;

    let cancelled = false;

    async function load() {
      const fromStore = projectsStore.find ? projectsStore.find(projectId) : null;
      if (fromStore) {
        setApiProjectLocal({ ...fromStore });
        return;
      }

      if (!getToken()) {
        uiStore.showMessage("Please sign in to continue.");
        navigate("/login");
        return;
      }

      setProjectLoading(true);
      setProjectError("");
      try {
        const mapped = await loadProjectById(projectId);
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
        if (cancelled) return;
        if (err?.isAuth) return handleAuthError(err);
        setProjectError(err?.message || "Failed to load project");
      } finally {
        if (!cancelled) setProjectLoading(false);
      }
    }

    load();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId, isOnboarding]);

  /* ─── 4-phase load: milestones → activities → tasks → subtasks.
     Each phase commits a fresh target reference so the UI fills in
     progressively rather than waiting for the whole tree. ─── */
  async function loadMilestonesFromApi() {
    if (!pid || !getToken()) return;

    setMilestonesLoading(true);
    setMilestonesError("");
    try {
      const milestones = await loadMilestonesForProject(pid);

      let target = isOnboarding
        ? draft
        : (projectsStore.find ? projectsStore.find(pid) : null) || apiProjectLocal;
      if (!target) return;

      target.milestones = milestones;
      try { normalizeProject(target); } catch (e) {}
      try { resolveProjectDependsOn(target); } catch (e) {}
      try { recomputeActualDates(target); } catch (e) {}
      commitUpdate(target);

      if (milestones.length === 0) return;

      // Phase 2: activities for every milestone in parallel
      const activityLists = await Promise.all(
        milestones.map((m) =>
          m.apiId ? loadActivitiesForMilestone(m.apiId) : Promise.resolve([])
        )
      );
      milestones.forEach((m, i) => { m.activities = activityLists[i] || []; });
      try { normalizeProject(target); } catch (e) {}
      try { resolveProjectDependsOn(target); } catch (e) {}
      try { recomputeActualDates(target); } catch (e) {}
      commitUpdate(target);

      // Phase 3: tasks for every activity in parallel
      const allActivities = milestones.flatMap((m) => safeArray(m.activities));
      if (allActivities.length > 0) {
        const taskLists = await Promise.all(
          allActivities.map((a) =>
            a.apiId ? loadTasksForActivity(a.apiId) : Promise.resolve([])
          )
        );
        allActivities.forEach((a, i) => { a.tasks = taskLists[i] || []; });
        try { normalizeProject(target); } catch (e) {}
        try { resolveProjectDependsOn(target); } catch (e) {}
        try { recomputeActualDates(target); } catch (e) {}
        commitUpdate(target);
      }

      // Phase 4: subtasks for every task in parallel
      const allTasks = allActivities.flatMap((a) => safeArray(a.tasks));
      if (allTasks.length > 0) {
        const subtaskLists = await Promise.all(
          allTasks.map((t) =>
            t.apiId ? loadSubtasksForTask(t.apiId) : Promise.resolve([])
          )
        );
        allTasks.forEach((t, i) => { t.subtasks = subtaskLists[i] || []; });
        try { normalizeProject(target); } catch (e) {}
        try { resolveProjectDependsOn(target); } catch (e) {}
        try { recomputeActualDates(target); } catch (e) {}
        commitUpdate(target);
      }
    } catch (err) {
      if (err?.isAuth) return handleAuthError(err);
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
    setEditingConfig((prev) => !prev);
  }

  function openNodeModal(kind, modeAction, parentUid, nodeUid) {
    setModalCtx({ kind, mode: modeAction, parentUid, nodeUid });
  }
  function closeNodeModal() {
    setModalCtx(null);
  }

  function saveNodeFromModal(formData) {
    if (!modalCtx) return;
    const { kind, mode: modeAction, parentUid, nodeUid } = modalCtx;
    const bounds = formData.bounds;

    /* ─── Permission checks ─── */
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

    /* ─── Field validations ─── */
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

    if (formData.type === "Resource Type") {
      const isCount = formData.resourceEntryType === "count";
      const res = isCount ? (formData.resourceCount || {}) : (formData.resourceDetails || {});
      if (!res.resType) {
        uiStore.showMessage("Please select a Resource Type.");
        return;
      }
      if (!res.division) {
        uiStore.showMessage("Please select a Resource Division.");
        return;
      }
      if (String(res.division).toLowerCase() === "others" && !(res.divisionOther || "").trim()) {
        uiStore.showMessage("Please specify the division.");
        return;
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
      resourceCount: formData.resourceCount
    };

    /* ─── Resolve which remote branch to take ─── */
    const shouldCreateMilestoneRemotely =
      modeAction === "add" && kind === "milestone" &&
      !!project.projectId && !!getToken();

    let milestoneServerId = null;
    if (modeAction === "edit" && kind === "milestone" && nodeUid) {
      const loc = locateNode(project, nodeUid);
      milestoneServerId = loc?.node?.apiId || null;
    }
    const shouldUpdateMilestoneRemotely =
      modeAction === "edit" && kind === "milestone" &&
      !!milestoneServerId && !!getToken();

    let activityParentMilestoneApiId = null;
    if (modeAction === "add" && kind === "activity" && parentUid) {
      const mLoc = locateNode(project, parentUid);
      activityParentMilestoneApiId = mLoc?.node?.apiId || null;
    }
    const shouldCreateActivityRemotely =
      modeAction === "add" && kind === "activity" &&
      !!activityParentMilestoneApiId && !!getToken();

    let activityServerId = null;
    if (modeAction === "edit" && kind === "activity" && nodeUid) {
      const loc = locateNode(project, nodeUid);
      activityServerId = loc?.node?.apiId || null;
    }
    const shouldUpdateActivityRemotely =
      modeAction === "edit" && kind === "activity" &&
      !!activityServerId && !!getToken();

    // ── Task remote branches ──
    let taskParentActivityApiId = null;
    if (modeAction === "add" && kind === "task" && parentUid) {
      const aLoc = locateNode(project, parentUid);
      taskParentActivityApiId = aLoc?.node?.apiId || null;
    }
    const shouldCreateTaskRemotely =
      modeAction === "add" && kind === "task" &&
      !!taskParentActivityApiId && !!getToken();

    let taskServerId = null;
    if (modeAction === "edit" && kind === "task" && nodeUid) {
      const loc = locateNode(project, nodeUid);
      taskServerId = loc?.node?.apiId || null;
    }
    const shouldUpdateTaskRemotely =
      modeAction === "edit" && kind === "task" &&
      !!taskServerId && !!getToken();

    // ── Subtask remote branches ──
    // Subtask create accepts ONLY a task id as parent. If the parent is a
    // subtask in the UI (nested), we walk up to the enclosing task.
    let subtaskParentTaskApiId = null;
    if (modeAction === "add" && kind === "subtask" && parentUid) {
      subtaskParentTaskApiId = findEnclosingTaskApiId(project, parentUid);
    }
    const shouldCreateSubtaskRemotely =
      modeAction === "add" && kind === "subtask" &&
      !!subtaskParentTaskApiId && !!getToken();

    let subtaskServerId = null;
    if (modeAction === "edit" && kind === "subtask" && nodeUid) {
      const loc = locateNode(project, nodeUid);
      subtaskServerId = loc?.node?.apiId || null;
    }
    const shouldUpdateSubtaskRemotely =
      modeAction === "edit" && kind === "subtask" &&
      !!subtaskServerId && !!getToken();

    /* ─── Local mutation — common to all branches ─── */
    const doLocal = (apiData) => {
      const target = isOnboarding
        ? project
        : (projectsStore.find ? projectsStore.find(project.projectId) : null) || apiProjectLocal;
      if (!target) { uiStore.hideLoader(); return; }

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
          if (!parent) { uiStore.hideLoader(); uiStore.showMessage("Parent milestone not found."); return; }
          parent.activities = safeArray(parent.activities);
          parent.activities.push(newNode);
        } else if (kind === "task") {
          newNode.subtasks = [];
          const parent = locateNode(target, parentUid)?.node;
          if (!parent) { uiStore.hideLoader(); uiStore.showMessage("Parent activity not found."); return; }
          parent.tasks = safeArray(parent.tasks);
          parent.tasks.push(newNode);
        } else {
          newNode.subtasks = [];
          const parent = locateNode(target, parentUid)?.node;
          if (!parent) { uiStore.hideLoader(); uiStore.showMessage("Parent not found."); return; }
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
          addAudit(target, `Add ${kind.charAt(0).toUpperCase() + kind.slice(1)}`, "-", deepClone(newNode));
          if (isBaselineProject(target)) {
            propagateNodeAddToVersions(
              projectsStore.getAll ? projectsStore.getAll() : [],
              target, parentUid, kind, newNode
            );
          }
        }
      } else {
        const loc = locateNode(target, nodeUid);
        if (!loc) { uiStore.hideLoader(); uiStore.showMessage("Item not found."); return; }
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
          addAudit(target, `Update ${kind.charAt(0).toUpperCase() + kind.slice(1)}`, before, deepClone(node));
          if (isBaselineProject(target)) {
            propagateNodeUpdateToVersions(
              projectsStore.getAll ? projectsStore.getAll() : [],
              target, nodeUid,
              {
                name: node.name, description: node.description,
                startDate: node.startDate, endDate: node.endDate,
                status: node.status, dependsOn: node.dependsOn,
                type: node.type, vendor: node.vendor,
                resourceEntryType: node.resourceEntryType,
                resourceDetails: node.resourceDetails,
                resourceCount: node.resourceCount
              }
            );
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

    /* ─── Dispatch to the correct remote branch, then run doLocal ─── */
    const handleRemote = (promise, failMessage) => {
      promise
        .then((updated) => { doLocal(updated); loadMilestonesFromApi(); })
        .catch((err) => {
          uiStore.hideLoader();
          if (err?.isAuth) return handleAuthError(err);
          uiStore.showMessage(err?.message || failMessage);
        });
    };

    if (shouldCreateMilestoneRemotely) {
      return handleRemote(createMilestoneApi(project, formData), "Failed to create milestone");
    }
    if (shouldUpdateMilestoneRemotely) {
      return handleRemote(updateMilestoneApi(milestoneServerId, formData, project), "Failed to update milestone");
    }
    if (shouldCreateActivityRemotely) {
      return handleRemote(createActivityApi(activityParentMilestoneApiId, formData, project), "Failed to create activity");
    }
    if (shouldUpdateActivityRemotely) {
      return handleRemote(updateActivityApi(activityServerId, formData, project), "Failed to update activity");
    }
    if (shouldCreateTaskRemotely) {
      return handleRemote(createTaskApi(taskParentActivityApiId, formData, project), "Failed to create task");
    }
    if (shouldUpdateTaskRemotely) {
      return handleRemote(updateTaskApi(taskServerId, formData, project), "Failed to update task");
    }
    if (shouldCreateSubtaskRemotely) {
      return handleRemote(createSubtaskApi(subtaskParentTaskApiId, formData, project), "Failed to create subtask");
    }
    if (shouldUpdateSubtaskRemotely) {
      return handleRemote(updateSubtaskApi(subtaskServerId, formData, project), "Failed to update subtask");
    }

    /* Legacy fallback for anything not covered above (e.g. onboarding or
       unauthenticated sessions using the stubbed nodesApi). */
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
        .catch((err) => {
          uiStore.hideLoader();
          uiStore.showMessage(err?.message || "Failed to save item");
        });
    } else {
      setTimeout(doLocal, 500);
    }
  }

  function removeNode(kind, uid) {
    const target = isOnboarding
      ? project
      : (projectsStore.find ? projectsStore.find(project.projectId) : null) || apiProjectLocal;
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
          propagateNodeDeleteToVersions(
            projectsStore.getAll ? projectsStore.getAll() : [],
            target, uid
          );
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

    const serverId = loc.node?.apiId || null;

    const handleRemote = (promise, failMessage) => {
      promise
        .then(() => { doLocal(); loadMilestonesFromApi(); })
        .catch((err) => {
          uiStore.hideLoader();
          if (err?.isAuth) return handleAuthError(err);
          uiStore.showMessage(err?.message || failMessage);
        });
    };

    if (kind === "milestone" && serverId && getToken()) {
      return handleRemote(deleteMilestoneApi(serverId), "Failed to delete milestone");
    }
    if (kind === "activity" && serverId && getToken()) {
      return handleRemote(deleteActivityApi(serverId), "Failed to delete activity");
    }
    if (kind === "task" && serverId && getToken()) {
      return handleRemote(deleteTaskApi(serverId), "Failed to delete task");
    }
    if (kind === "subtask" && serverId && getToken()) {
      return handleRemote(deleteSubtaskApi(serverId), "Failed to delete subtask");
    }

    /* Fallback for legacy or unauthenticated sessions. */
    if (!isOnboarding && tokenStore.get() && nodesApi.removeByKind[kind]) {
      nodesApi.removeByKind[kind](uid)
        .then(() => { hydrateProjects({ force: true }); doLocal(); })
        .catch((err) => {
          uiStore.hideLoader();
          uiStore.showMessage(err?.message || "Failed to remove item");
        });
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

    const doLocal = (idOverride, codeOverride) => {
      const p = deepClone(project);
      p.projectId = idOverride || p.projectId || projectsStore.getNextProjectId();
      if (codeOverride) p.projectCode = codeOverride;
      p.status = "DRAFT";
      p.baselineId = "-";
      p.auditLogs = [];
      normalizeProject(p);
      projectsStore.addProject(p);
      draftStore.clear();
      clearPersistedOnboardingDraft();
      uiStore.hideLoader();
      const label = p.projectCode || p.projectId;
      uiStore.showMessage(`Project ${label} added successfully!`, () =>
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
          if (err?.isAuth) return handleAuthError(err);
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
          endDate: project.endDate
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
        doLocal(projectUuid, created.projectCode);
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
      <div className="uidai-page-header" style={{ justifyContent: "flex-end" }}>
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
            <button type="button" className="uidai-btn uidai-btn--small" onClick={toggleExpandAll}>
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
                      ? `No milestones added yet${canMod ? " — click + Add Milestone above to start." : "."}`
                      : "No milestones to display on this page."}
                  </td>
                </tr>
              ) : (
                rows.map((r) => (
                  <MilestoneGridRow
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
                        `/projects/${encodeURIComponent(project.projectId)}/track/${encodeURIComponent(uid)}`
                      )
                    }
                  />
                ))
              )}
            </tbody>
          </table>
        </div>

        {totalMilestones > 0 && (
          <MilestonePagination
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