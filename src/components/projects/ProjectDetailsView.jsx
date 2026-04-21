import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import ChipControl from './ChipControl';
import PublishModal from './PublishModal';
import DeleteProjectModal from './DeleteProjectModal';
import CreateVersionModal from './CreateVersionModal';
import {
  useStore, setProjects, commitProjects, removeProject,
  showMessage, showLoader, hideLoader,
} from './store';
import {
  CATEGORY_OPTIONS, VENDOR_MASTER,
  safeArray, deepClone, addAudit,
  canEditProjectDetails, isVersionProject,
  getRootProjectId, getNextVersionId,
  normalizeProject,
} from './utils';

export default function ProjectDetailsView({ project, onBack, onGoConfig }) {
  const { projects } = useStore();
  const navigate = useNavigate();

  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState(null);
  const [publishOpen, setPublishOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [versionOpen, setVersionOpen] = useState(false);

  useEffect(() => {
    if (!project) return;
    const catVal = project.category || '';
    const inList = CATEGORY_OPTIONS.includes(catVal);
    setForm({
      projectName: project.projectName || '',
      description: project.description || '',
      owner: project.owner || '',
      startDate: project.startDate || '',
      endDate: project.endDate || '',
      actualEndDate: project.actualEndDate || '',
      isPublic: project.isPublic || 'Yes',
      category: inList ? catVal : (catVal ? 'Others' : 'MSAP'),
      categoryOther: !inList && catVal ? catVal : '',
      vendors: safeArray(project.vendors),
    });
  }, [project, editing]);

  if (!form) return null;

  const isVersion = isVersionProject(project);
  const isPubBase = project.status === 'PUBLISHED' && !project.isVersion;
  const editable = editing && canEditProjectDetails(project);
  const canEditCat = editable && !isVersion && !isPubBase;

  const toggleEdit = () => {
    if (!editing) { setEditing(true); return; }
    saveDetails();
  };

  const saveDetails = () => {
    const name = form.projectName.trim() || project.projectName;
    const owner = form.owner.trim() || project.owner;
    let category = project.category || '';
    if (!isVersion) {
      if (form.category === 'Others') {
        if (!form.categoryOther.trim()) { showMessage('Please specify the category.'); return; }
        category = form.categoryOther.trim();
      } else {
        category = form.category;
      }
    }
    if (!owner || (!isVersion && (!name || !form.startDate || !form.endDate))) {
      showMessage('Fill required fields.'); return;
    }
    showLoader('Saving project details...');
    setTimeout(() => {
      const before = deepClone(project);
      if (isVersion) {
        project.owner = owner;
        project.isPublic = form.isPublic;
        project.actualEndDate = form.actualEndDate;
      } else {
        project.projectName = name;
        project.description = form.description.trim();
        project.owner = owner;
        project.startDate = form.startDate;
        project.endDate = form.endDate;
        project.isPublic = form.isPublic;
        project.category = category;
      }
      project.vendors = [...form.vendors];
      addAudit(project, 'Update Project Details', before, deepClone(project));
      commitProjects();
      setEditing(false);
      hideLoader();
      showMessage('Project details saved');
    }, 600);
  };

  const confirmPublish = () => {
    showLoader('Publishing project...');
    setTimeout(() => {
      const before = deepClone(project);
      project.status = 'PUBLISHED';
      project.baselineId = '-';
      addAudit(project, 'Publish Project', before, deepClone(project));
      commitProjects();
      setPublishOpen(false);
      hideLoader();
      showMessage('Project published successfully');
    }, 900);
  };

  const confirmDelete = () => {
    setDeleteOpen(false);
    removeProject(project.projectId);
    navigate('/');
  };

  const nextVersionId = getNextVersionId(projects, getRootProjectId(project));

  const confirmCreateVersion = () => {
    showLoader('Creating version...');
    setTimeout(() => {
      const base = getRootProjectId(project);
      const np = deepClone(project);
      np.projectId = getNextVersionId(projects, base);
      np.versionOf = base;
      np.isVersion = true;
      np.versionNo = (project.versionNo || 0) + 1;
      np.baselineId = base;
      np.status = 'NEW';
      np.actualEndDate = '';
      np.auditLogs = [];
      normalizeProject(np);
      addAudit(np, 'Create Version', deepClone(project), deepClone(np));
      setProjects((prev) => [np, ...prev]);
      setVersionOpen(false);
      hideLoader();
      showMessage('Version created successfully',
        () => navigate(`/project/${encodeURIComponent(np.projectId)}`));
    }, 900);
  };

  const charsRemaining = 5000 - (form.description || '').length;

  return (
    <div className="pmis-page">
      <div className="pmis-page-title">Project Details</div>
      <div className="pmis-card">
        <div className="pmis-card-actions">
          {isPubBase ? (
            <>
              <button className="pmis-btn" onClick={() => setVersionOpen(true)}>Create Version</button>
              <button className="pmis-btn pmis-btn-cancel" onClick={onBack}>Back</button>
            </>
          ) : (
            <>
              <button className="pmis-btn" onClick={toggleEdit}>{editing ? 'Save' : 'Edit'}</button>
              {!project.isVersion && project.status !== 'PUBLISHED' && (
                <button className="pmis-btn" onClick={() => setPublishOpen(true)} disabled={editing}>Publish</button>
              )}
              <button className="pmis-btn pmis-btn-cancel" onClick={onBack}>Back</button>
            </>
          )}
        </div>

        <h3>Project Information</h3>
        <div className="pmis-hint pmis-details-disclaimer">
          Published baseline projects are read-only. Version projects can edit only Owner, Is Public, and Actual End Date.
        </div>

        <div className="pmis-grid">
          <div className="pmis-field"><label>Project ID</label><input value={project.projectId} disabled /></div>
          <div className="pmis-field">
            <label>Project Name <span className="pmis-required">*</span></label>
            <input value={form.projectName}
              onChange={(e) => setForm({ ...form, projectName: e.target.value })}
              disabled={isVersion || !editable} />
          </div>
          <div className="pmis-field"><label>Baseline ID</label><input value={project.baselineId || '-'} disabled /></div>
          <div className="pmis-field"><label>Status</label><input value={project.status} disabled /></div>
          <div className="pmis-field pmis-grid-full">
            <label>Description</label>
            <textarea maxLength={5000} value={form.description}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
              disabled={isVersion || !editable} />
            <div className="pmis-char-count">{charsRemaining} characters remaining</div>
          </div>
          <div className="pmis-field">
            <label>Owner <span className="pmis-required">*</span></label>
            <input value={form.owner}
              onChange={(e) => setForm({ ...form, owner: e.target.value })}
              disabled={!editable} />
          </div>
          <div className="pmis-field">
            <label>Start Date <span className="pmis-required">*</span></label>
            <input type="date" value={form.startDate}
              onChange={(e) => setForm({ ...form, startDate: e.target.value })}
              disabled={isVersion || !editable} />
          </div>
          <div className="pmis-field">
            <label>End Date <span className="pmis-required">*</span></label>
            <input type="date" value={form.endDate}
              onChange={(e) => setForm({ ...form, endDate: e.target.value })}
              disabled={isVersion || !editable} />
          </div>
          {isVersion && (
            <div className="pmis-field">
              <label>Actual End Date</label>
              <input type="date" value={form.actualEndDate}
                onChange={(e) => setForm({ ...form, actualEndDate: e.target.value })}
                disabled={!editable} />
            </div>
          )}
          <div className="pmis-field">
            <label>Is Public <span className="pmis-required">*</span></label>
            <select value={form.isPublic}
              onChange={(e) => setForm({ ...form, isPublic: e.target.value })}
              disabled={!editable}>
              <option>Yes</option><option>No</option>
            </select>
          </div>
          <div className="pmis-field">
            <label>Category <span className="pmis-required">*</span></label>
            {canEditCat ? (
              <>
                <select value={form.category}
                  onChange={(e) => setForm({ ...form, category: e.target.value })}>
                  {CATEGORY_OPTIONS.map((c) => <option key={c} value={c}>{c}</option>)}
                </select>
                {form.category === 'Others' && (
                  <div className="pmis-field-sub-wrap">
                    <input placeholder="Specify category" value={form.categoryOther}
                      onChange={(e) => setForm({ ...form, categoryOther: e.target.value })} />
                  </div>
                )}
              </>
            ) : (
              <input value={project.category || ''} disabled />
            )}
          </div>
        </div>

        <div className="pmis-vendor-section">
          <h4 className="pmis-vendor-heading">Associated Vendors</h4>
          <ChipControl values={form.vendors} options={VENDOR_MASTER}
            onChange={(v) => setForm({ ...form, vendors: v })}
            disabled={!editable} label="vendor" />
        </div>

        <div className="pmis-card-footer-actions">
          <button className="pmis-btn pmis-btn-delete"
            onClick={() => setDeleteOpen(true)} disabled={editing}>Remove Project</button>
          <button className="pmis-btn" onClick={onGoConfig} disabled={editing}>
            Go to Milestones Configuration
          </button>
        </div>
      </div>

      <PublishModal open={publishOpen} onClose={() => setPublishOpen(false)}
        onConfirm={confirmPublish} project={project} />
      <DeleteProjectModal open={deleteOpen} onClose={() => setDeleteOpen(false)}
        onConfirm={confirmDelete} />
      <CreateVersionModal open={versionOpen} onClose={() => setVersionOpen(false)}
        onConfirm={confirmCreateVersion} project={project} nextId={nextVersionId} />
    </div>
  );
}
