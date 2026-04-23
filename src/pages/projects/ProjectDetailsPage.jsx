import React, { useEffect, useState } from "react";
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

export default function ProjectDetailsPage() {
  const { projectId } = useParams();
  const navigate = useNavigate();
  const project = useProject(projectId);

  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState(null);
  const [selCat, setSelCat] = useState("");
  const [otherCat, setOtherCat] = useState("");
  const [publishOpen, setPublishOpen] = useState(false);
  const [versionOpen, setVersionOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);

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
      vendors: safeArray(project.vendors).slice()
    });
  }, [project, editing]);

  if (!project) {
    return (
      <div>
        <div className="uidai-page-title">Project Details</div>
        <div className="uidai-card-project">
          <div className="uidai-hint">Project not found.</div>
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

    uiStore.showLoader("Saving project details...");
    setTimeout(() => {
      const all = projectsStore.getAll();
      const target = all.find((p) => p.projectId === project.projectId);
      if (!target) {
        uiStore.hideLoader();
        return;
      }
      const before = deepClone(target);
      if (isVersion) {
        target.owner = form.owner.trim();
        target.isPublic = form.isPublic;
        target.actualEndDate = form.actualEndDate || "";
        target.vendors = form.vendors.slice();
      } else {
        target.projectName = form.projectName.trim();
        target.description = form.description.trim();
        target.owner = form.owner.trim();
        target.startDate = form.startDate;
        target.endDate = form.endDate;
        target.isPublic = form.isPublic;
        target.category = finalCat;
        target.vendors = form.vendors.slice();
      }
      addAudit(target, "Update Project Details", before, deepClone(target));
      if (!isVersion) propagateBaselineDetailsToVersions(all, target);
      projectsStore.refresh();
      uiStore.hideLoader();
      setEditing(false);
      uiStore.showMessage("Project details saved");
    }, 600);
  }

  function confirmPublish() {
    setPublishOpen(false);
    uiStore.showLoader("Publishing project...");
    setTimeout(() => {
      const target = projectsStore.find(project.projectId);
      if (!target) {
        uiStore.hideLoader();
        return;
      }
      const before = deepClone(target);
      target.status = "PUBLISHED";
      target.baselineId = "-";
      addAudit(target, "Publish Project", before, deepClone(target));
      projectsStore.refresh();
      uiStore.hideLoader();
      uiStore.showMessage("Project published successfully");
    }, 900);
  }

  function confirmCreateVersion() {
    setVersionOpen(false);
    uiStore.showLoader("Creating version...");
    setTimeout(() => {
      const base = getRootProjectId(project);
      const src = projectsStore.find(project.projectId);
      if (!src) {
        uiStore.hideLoader();
        return;
      }
      const np = deepClone(src);
      np.projectId = projectsStore.getNextVersionId(base);
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
    }, 900);
  }

  function confirmDelete() {
    setDeleteOpen(false);
    projectsStore.removeProject(project.projectId);
    navigate("/projects");
  }

  const disclaimer = isPubBase
    ? "This is a published baseline project. You can still edit it — all changes will automatically be mirrored to every version created from this baseline."
    : isVersion
    ? "This is a version project. Version projects can edit Owner, Is Public, Actual End Date, and their own hierarchy. Changes to a version do NOT propagate back to the baseline."
    : "Complete project details and milestone configuration, then publish to create a baseline.";

  const versionId = projectsStore.getNextVersionId(getRootProjectId(project));

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
            <input className="uidai-input" value={project.projectId} disabled />
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
            options={VENDOR_MASTER}
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
