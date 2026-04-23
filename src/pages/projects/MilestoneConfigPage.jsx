import React, { useMemo, useState } from "react";
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

export default function MilestoneConfigPage({ mode }) {
  /* mode = 'onboarding' | 'update' */
  const { projectId } = useParams();
  const navigate = useNavigate();

  /* ─────────────────────────────────────────────────────────────
     ALL HOOKS FIRST — nothing conditional before this block.
     Keeping hook order stable across renders is mandatory
     (React's Rules of Hooks; CRA's eslint blocks compile otherwise,
     which is what was preventing /projects/add/config from opening).
     ───────────────────────────────────────────────────────────── */
  useProjects();
  const draft = useDraft();
  const isOnboarding = mode === "onboarding";
  const realProject = useProject(projectId);
  const project = isOnboarding ? draft : realProject;

  const [editingConfig, setEditingConfig] = useState(isOnboarding);
  const [expandedRows, setExpandedRows] = useState(() => new Set());
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(5);
  const [modalCtx, setModalCtx] = useState(null);

  /* Pagination math (no hooks — safe whether project exists or not) */
  const totalMilestones = project ? safeArray(project.milestones).length : 0;
  const effectivePageSize = pageSize > 0 ? pageSize : Math.max(totalMilestones, 1);
  const totalPages = totalMilestones === 0 ? 1 : Math.ceil(totalMilestones / effectivePageSize);
  const page = Math.max(1, Math.min(currentPage, totalPages));

  /* Memoized rows — tolerates null project so the hook is always called */
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

  /* Memoized dep-display map — also null-tolerant */
  const depMap = useMemo(() => (project ? buildDepDisplayMap(project) : {}), [project]);

  /* ─────────────────────────────────────────────────────────────
     From here on, conditional returns are safe — no more hooks.
     ───────────────────────────────────────────────────────────── */
  if (!project) {
    return (
      <div>
        <div className="uidai-page-title">Milestone Configuration</div>
        <div className="uidai-card-project">
          <div className="uidai-hint">
            {isOnboarding
              ? "No draft found. Please start from Add Project."
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

  /* Ensure project is normalized & actuals refreshed */
  normalizeProject(project);
  try {
    recomputeActualDates(project);
  } catch (e) {}

  const showStatusCol = !isOnboarding;

  /* ─── Expand/collapse ─── */
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
    setTimeout(() => {
      const target = isOnboarding ? project : projectsStore.find(project.projectId);
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
            propagateNodeAddToVersions(projectsStore.getAll(), target, parentUid, kind, newNode);
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
            propagateNodeUpdateToVersions(projectsStore.getAll(), target, nodeUid, {
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

      if (isOnboarding) {
        draftStore.refresh();
      } else {
        projectsStore.refresh();
      }
      uiStore.hideLoader();
      closeNodeModal();
      uiStore.showMessage(modeAction === "add" ? "Item added" : "Item updated");
    }, 500);
  }

  function removeNode(kind, uid) {
    const target = isOnboarding ? project : projectsStore.find(project.projectId);
    if (!target) return;
    const loc = locateNode(target, uid);
    if (!loc) return;
    if (isNodeBaselineLocked(target, loc.node)) {
      uiStore.showMessage("Baseline items cannot be deleted from a version project.");
      return;
    }
    if (!window.confirm(`Remove ${kind} "${loc.node.name || uid}" and all of its children?`)) return;

    uiStore.showLoader("Removing...");
    setTimeout(() => {
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
          propagateNodeDeleteToVersions(projectsStore.getAll(), target, uid);
        }
      }

      setExpandedRows((prev) => {
        const next = new Set(prev);
        next.delete(uid);
        return next;
      });
      normalizeProject(target);
      recomputeActualDates(target);
      if (isOnboarding) draftStore.refresh();
      else projectsStore.refresh();
      uiStore.hideLoader();
      uiStore.showMessage("Removed");
    }, 500);
  }

  function finalizeOnboarding() {
    if (!safeArray(project.milestones).length) {
      uiStore.showMessage("Add at least one milestone before saving.");
      return;
    }
    uiStore.showLoader("Saving project...");
    setTimeout(() => {
      const p = deepClone(project);
      p.projectId = projectsStore.getNextProjectId();
      p.status = "DRAFT";
      p.baselineId = "-";
      p.auditLogs = [];
      normalizeProject(p);
      projectsStore.addProject(p);
      draftStore.clear();
      uiStore.hideLoader();
      uiStore.showMessage(`Project ${p.projectId} added successfully!`, () =>
        navigate("/projects")
      );
    }, 900);
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
                    {totalMilestones === 0
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