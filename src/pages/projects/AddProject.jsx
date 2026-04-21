import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import ProjectFormView from '../../components/projects/ProjectFormView';
import MilestoneConfigView from '../../components/projects/MilestoneConfigView';
import ProjectDetailsView from '../../components/projects/ProjectDetailsView';
import {
  useStore, findProject, addProject, setOnboardDraft,
  showMessage, showLoader, hideLoader,
} from '../../components/projects/store';
import {
  safeArray, deepClone, getNextProjectId, normalizeProject,
} from '../../components/projects/utils';

/**
 * Main entry for everything under /project/:id
 *   /project/new           -> onboarding form (step 1 → step 2)
 *   /project/:existingId   -> details view (with sub-view for milestone config)
 *
 * NOTE: No Provider anywhere. State comes from the module-level store
 * via useStore() — MessageModal / LoaderModal are mounted in App.js.
 */
export default function AddProject() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { projects, onboardDraft } = useStore();

  const isNew = id === 'new';

  /* Internal view state:
     - for new:      'form' | 'config'
     - for existing: 'details' | 'config' */
  const [view, setView] = useState(isNew ? 'form' : 'details');

  useEffect(() => {
    setView(isNew ? 'form' : 'details');
  }, [id, isNew]);

  const existingProject = !isNew ? findProject(id) : null;

  /* ───── Guards ───── */
  if (!isNew && !existingProject) {
    return (
      <div className="pmis-page">
        <div className="pmis-page-title">Project Details</div>
        <div className="pmis-card">
          <div className="pmis-hint">Project not found.</div>
          <div className="pmis-card-footer-actions">
            <button className="pmis-btn pmis-btn-cancel" onClick={() => navigate('/')}>Back</button>
          </div>
        </div>
      </div>
    );
  }

  /* ───── NEW PROJECT FLOW ───── */
  if (isNew) {
    if (view === 'form') {
      return (
        <ProjectFormView
          onNext={(draft) => { setOnboardDraft(draft); setView('config'); }}
          onCancel={() => { setOnboardDraft(null); navigate('/'); }}
        />
      );
    }

    /* config view for new project */
    const draft = onboardDraft;
    if (!draft) {
      /* no draft → go back to the form */
      setTimeout(() => setView('form'), 0);
      return null;
    }

    const handleSaveOnboarding = () => {
      if (!safeArray(draft.milestones).length) {
        showMessage('Add at least one milestone before saving.');
        return;
      }
      showLoader('Saving project...');
      setTimeout(() => {
        const p = deepClone(draft);
        p.projectId = getNextProjectId(projects);
        p.status = 'DRAFT';
        p.baselineId = '-';
        p.auditLogs = [];
        normalizeProject(p);
        addProject(p);
        setOnboardDraft(null);
        hideLoader();
        showMessage(`Project ${p.projectId} added successfully!`, () => navigate('/'));
      }, 900);
    };

    return (
      <MilestoneConfigView
        project={draft}
        isOnboarding={true}
        onBack={() => setView('form')}
        onSaveOnboarding={handleSaveOnboarding}
      />
    );
  }

  /* ───── EXISTING PROJECT FLOW ───── */
  if (view === 'details') {
    return (
      <ProjectDetailsView
        project={existingProject}
        onBack={() => navigate('/')}
        onGoConfig={() => setView('config')}
      />
    );
  }

  return (
    <MilestoneConfigView
      project={existingProject}
      isOnboarding={false}
      onBack={() => setView('details')}
    />
  );
}
