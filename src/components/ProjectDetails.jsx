// ============================================================
// pages/ProjectDetails.jsx  –  Route: /projects/:projectId
// ============================================================
import { useState, useEffect } from "react";
import { useParams, useNavigate } from "react-router-dom";

import {
  useProjects, deepClone, addAudit,
} from "../store/Projectstore";

import Field from "./Field";
import Btn from "./Btn";
import PublishModal from "./PublishModal";
import DeleteProjectModal from "./DeleteProjectModal";
import CreateVersionModal from "./CreateVersionModal";

export default function ProjectDetails() {
  const { projectId } = useParams();
  const navigate = useNavigate();
  const {
    getById, mutate, removeProject,
    addProject, getNextVerId,
    withLoader, showMsg,
  } = useProjects();

  const project = getById(projectId);

  // ── Local UI state ────────────────────────────────────────
  const [editing, setEditing] = useState(false);
  const [modal, setModal] = useState(null);   // "publish" | "delete" | "version"
  const [form, setForm] = useState({});

  // Sync form whenever project changes or editing toggles
  useEffect(() => {
    if (!project) return;
    setForm({
      projectName: project.projectName,
      description: project.description || "",
      owner: project.owner,
      startDate: project.startDate,
      endDate: project.endDate,
      isPublic: project.isPublic,
      actualEndDate: project.actualEndDate || "",
    });
  }, [project, editing]);

  // ── Guard – project not found ─────────────────────────────
  if (!project) {
    return (
      <div className="card" style={{ padding: 24 }}>
        <p>Project <strong>{projectId}</strong> not found.</p>
        <Btn onClick={() => navigate("/projects")}>Back to list</Btn>
      </div>
    );
  }

  const isPublishedBaseline = project.status === "PUBLISHED" && !project.isVersion;
  const isVersion = project.isVersion;
  const u = (k, v) => setForm((f) => ({ ...f, [k]: v }));

  // ── Save ─────────────────────────────────────────────────
  const handleSave = () => {
    if (!form.owner || (!isVersion && (!form.projectName || !form.startDate || !form.endDate))) {
      showMsg("Fill required fields.");
      return;
    }
    withLoader("Saving project details…", () => {
      const p = deepClone(project);
      const before = deepClone(p);
      if (isVersion) {
        p.owner = form.owner;
        p.isPublic = form.isPublic;
        p.actualEndDate = form.actualEndDate;
      } else {
        p.projectName = form.projectName;
        p.description = form.description;
        p.owner = form.owner;
        p.startDate = form.startDate;
        p.endDate = form.endDate;
        p.isPublic = form.isPublic;
      }
      addAudit(p, "Update Project Details", before, deepClone(p));
      mutate(p);
      setEditing(false);
    }, "Project details saved");
  };

  // ── Publish ───────────────────────────────────────────────
  const confirmPublish = () => {
    setModal(null);
    withLoader("Publishing project…", () => {
      const p = deepClone(project);
      const before = deepClone(p);
      p.status = "PUBLISHED";
      p.baselineId = "-";
      addAudit(p, "Publish Project", before, deepClone(p));
      mutate(p);
    }, "Project published successfully", () =>
      navigate(`/projects/${projectId}/config`)
    );
  };

  // ── Delete ────────────────────────────────────────────────
  const confirmDelete = () => {
    setModal(null);
    removeProject(projectId);
    navigate("/projects");
  };

  // ── Create Version ────────────────────────────────────────
  const confirmCreateVersion = () => {
    setModal(null);
    withLoader("Creating version…", () => {
      const clone = deepClone(project);
      const baseId = project.versionOf || projectId.split("-V")[0];
      clone.projectId = getNextVerId(baseId);
      clone.versionOf = baseId;
      clone.isVersion = true;
      clone.versionNo = (project.versionNo || 0) + 1;
      clone.baselineId = baseId;
      clone.actualEndDate = "";
      clone.status = "NEW";
      clone.auditLogs = [];
      addProject(clone);
    }, "Version created successfully");
  };

  // ── Render ────────────────────────────────────────────────
  return (
    <div>
      <div className="pm-title">Project Details</div>
      <div className="card">

        {/* Top action bar */}
        <div className="detail-top-actions">
          {isPublishedBaseline ? (
            <>
              <Btn onClick={() => setModal("version")}>Create Version</Btn>
              <Btn variant="cancel" onClick={() => navigate("/projects")}>Back</Btn>
            </>
          ) : (
            <>
              <Btn onClick={editing ? handleSave : () => setEditing(true)}>
                {editing ? "Save" : "Edit"}
              </Btn>
              {!isVersion && project.status !== "PUBLISHED" && (
                <Btn onClick={() => setModal("publish")} disabled={editing}>Publish</Btn>
              )}
              <Btn variant="cancel" onClick={() => navigate("/projects")}>Back</Btn>
            </>
          )}
        </div>

        <h3>Project Information</h3>
        <div className="hint" style={{ marginBottom: 12 }}>
          Published baseline projects are read-only. Version projects can edit only Owner, Is Public,
          and Actual End Date.
        </div>

        {/* Fields grid */}
        <div className="grid">
          <Field label="Project ID" required>
            <input value={project.projectId} disabled />
          </Field>

          <Field label="Project Name" required>
            <input
              value={form.projectName || ""}
              onChange={(e) => u("projectName", e.target.value)}
              disabled={isVersion || !editing}
            />
          </Field>

          <Field label="Baseline ID">
            <input value={project.baselineId || "-"} disabled />
          </Field>

          <Field label="Status" required>
            <input value={project.status} disabled />
          </Field>

          <Field label="Description" full>
            <textarea
              value={form.description || ""}
              onChange={(e) => u("description", e.target.value)}
              maxLength={5000}
              disabled={isVersion || !editing}
            />
            <div className="char-count">{5000 - (form.description || "").length} characters remaining</div>
          </Field>

          <Field label="Owner" required>
            <input
              value={form.owner || ""}
              onChange={(e) => u("owner", e.target.value)}
              disabled={!editing}
            />
          </Field>

          <Field label="Start Date" required>
            <input
              type="date"
              value={form.startDate || ""}
              onChange={(e) => u("startDate", e.target.value)}
              disabled={isVersion || !editing}
            />
          </Field>

          <Field label="End Date" required>
            <input
              type="date"
              value={form.endDate || ""}
              onChange={(e) => u("endDate", e.target.value)}
              disabled={isVersion || !editing}
            />
          </Field>

          {isVersion && (
            <Field label="Actual End Date">
              <input
                type="date"
                value={form.actualEndDate || ""}
                onChange={(e) => u("actualEndDate", e.target.value)}
                disabled={!editing}
              />
            </Field>
          )}

          <Field label="Is Public" required>
            <select
              value={form.isPublic || "Yes"}
              onChange={(e) => u("isPublic", e.target.value)}
              disabled={!editing}
            >
              <option>Yes</option>
              <option>No</option>
            </select>
          </Field>

          <Field label="Category" required>
            <input value={project.category} disabled />
          </Field>
        </div>

        {/* Bottom actions */}
        <div className="detail-bottom-actions">
          <Btn variant="delete" onClick={() => setModal("delete")} disabled={editing}>
            Remove Project
          </Btn>
          <Btn
            onClick={() => navigate(`/projects/${projectId}/config`)}
            disabled={editing}
          >
            Go to Milestones Configuration
          </Btn>
        </div>
      </div>

      {/* ── Local modals ── */}
      {modal === "publish" && (
        <PublishModal
          project={project}
          onConfirm={confirmPublish}
          onClose={() => setModal(null)}
        />
      )}
      {modal === "delete" && (
        <DeleteProjectModal
          project={project}
          onConfirm={confirmDelete}
          onClose={() => setModal(null)}
        />
      )}
      {modal === "version" && (
        <CreateVersionModal
          project={project}
          onConfirm={confirmCreateVersion}
          onClose={() => setModal(null)}
        />
      )}
    </div>
  );
}