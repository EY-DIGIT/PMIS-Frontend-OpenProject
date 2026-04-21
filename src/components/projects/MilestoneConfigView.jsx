import React, { useState, useEffect, useMemo, useRef } from 'react';
import MilestoneGrid from './MilestoneGrid';
import PaginationBar from './PaginationBar';
import NodeModal from './NodeModal';
import {
  commitProjects, setOnboardDraft,
  showMessage, showLoader, hideLoader,
} from './store';
import {
  safeArray, deepClone, canEditHierarchy,
  locateNode, addAudit, renumberProject, normalizeProject,
  getChildren,
} from './utils';

export default function MilestoneConfigView({ project, isOnboarding, onBack, onSaveOnboarding }) {
  const [editingConfig, setEditingConfig] = useState(isOnboarding);
  const [expandedRows, setExpandedRows] = useState(() => new Set());
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(5);
  const [modalOpen, setModalOpen] = useState(false);
  const [modalContext, setModalContext] = useState(null);

  const normalizedRef = useRef(false);
  useEffect(() => {
    if (project && !normalizedRef.current) {
      normalizeProject(project);
      normalizedRef.current = true;
    }
  }, [project]);

  useEffect(() => {
    if (!project) return;
    renumberProject(project);
  /* eslint-disable-next-line react-hooks/exhaustive-deps */
  }, [project]);

  const allMilestones = safeArray(project?.milestones);
  const totalMilestones = allMilestones.length;
  const effectivePageSize = pageSize > 0 ? pageSize : Math.max(totalMilestones, 1);
  const totalPages = totalMilestones === 0 ? 1 : Math.ceil(totalMilestones / effectivePageSize);
  const safePage = Math.max(1, Math.min(page, totalPages));

  useEffect(() => { if (page !== safePage) setPage(safePage); }, [page, safePage]);

  const allRowsExpanded = useMemo(() => {
    if (!project) return false;
    let total = 0, exp = 0;
    function walk(list) {
      safeArray(list).forEach((n) => {
        const kids = getChildren(n);
        if (kids.length) { total++; if (expandedRows.has(n.uid)) exp++; walk(kids); }
      });
    }
    walk(project.milestones);
    return total > 0 && total === exp;
  }, [project, expandedRows]);

  if (!project) return null;

  const readOnlyBaseline = !isOnboarding && project.status === 'PUBLISHED' && !project.isVersion;
  const editable = isOnboarding ? true : (canEditHierarchy(project) && editingConfig);
  const canMod = !readOnlyBaseline && (isOnboarding || editable);

  const toggleExpandAll = () => {
    if (allRowsExpanded) { setExpandedRows(new Set()); return; }
    const next = new Set();
    function walk(list) {
      safeArray(list).forEach((n) => {
        if (getChildren(n).length) { next.add(n.uid); walk(getChildren(n)); }
      });
    }
    walk(project.milestones);
    setExpandedRows(next);
  };

  const toggleRow = (uid) => {
    setExpandedRows((prev) => {
      const next = new Set(prev);
      if (next.has(uid)) next.delete(uid); else next.add(uid);
      return next;
    });
  };

  const openAddMilestone = () => {
    setModalContext({ kind: 'milestone', mode: 'add', parentUid: null, nodeUid: null });
    setModalOpen(true);
  };
  const openAddChild = ({ kind, parentUid }) => {
    setModalContext({ kind, mode: 'add', parentUid, nodeUid: null });
    setModalOpen(true);
  };
  const openEditNode = (uid, kind) => {
    setModalContext({ kind, mode: 'edit', parentUid: null, nodeUid: uid });
    setModalOpen(true);
  };

  const handleDeleteNode = (uid, kind) => {
    const loc = locateNode(project, uid);
    if (!loc) return;
    const { node, parent, parentKind } = loc;
    const nm = node.name || uid;
    // eslint-disable-next-line no-alert, no-restricted-globals
    if (!window.confirm(`Remove ${kind} "${nm}" and all of its children?`)) return;

    showLoader('Removing...');
    setTimeout(() => {
      const removed = deepClone(node);
      let list;
      if (parentKind === 'project')        list = parent.milestones;
      else if (parentKind === 'milestone') list = parent.activities;
      else if (parentKind === 'activity')  list = parent.tasks;
      else                                 list = parent.subtasks;
      const idx = list.findIndex((x) => x.uid === uid);
      if (idx >= 0) list.splice(idx, 1);

      if (!isOnboarding) addAudit(project, `Delete ${kind.charAt(0).toUpperCase() + kind.slice(1)}`, removed, '-');
      setExpandedRows((prev) => { const next = new Set(prev); next.delete(uid); return next; });
      renumberProject(project);
      if (isOnboarding) setOnboardDraft({ ...project }); else commitProjects();
      hideLoader();
      showMessage('Removed');
    }, 500);
  };

  const toggleConfigEdit = () => {
    if (!editingConfig) { setEditingConfig(true); return; }
    setEditingConfig(false);
  };

  const handleNodeSaved = ({ newNodeUid, kind }) => {
    if (modalContext?.parentUid) {
      setExpandedRows((prev) => new Set(prev).add(modalContext.parentUid));
    }
    if (newNodeUid && kind === 'milestone' && pageSize > 0) {
      const idx = project.milestones.findIndex((m) => m.uid === newNodeUid);
      if (idx >= 0) setPage(Math.floor(idx / pageSize) + 1);
    }
    if (isOnboarding) setOnboardDraft({ ...project });
  };

  const title = isOnboarding ? (project.projectName || 'New Project') : project.projectName;

  return (
    <div className="pmis-page">
      <div className="pmis-page-title">Milestone Configuration</div>
      <div className="pmis-card">
        <div className="pmis-card-actions">
          {isOnboarding ? (
            <>
              <button className="pmis-btn" onClick={onSaveOnboarding}>Save Project</button>
              <button className="pmis-btn pmis-btn-cancel" onClick={onBack}>Back</button>
            </>
          ) : (
            <>
              {!readOnlyBaseline && (
                <button className="pmis-btn" onClick={toggleConfigEdit}>{editingConfig ? 'Save' : 'Edit'}</button>
              )}
              <button className="pmis-btn pmis-btn-cancel" onClick={onBack}>Back</button>
            </>
          )}
        </div>
        <h3 className="pmis-config-title">{title}</h3>
        <div className="pmis-hint">
          Disclaimer: Every add, edit, delete, and version change is audited with who, when, what changed, and before/after details.
        </div>

        <div className="pmis-toolbar">
          <div className="pmis-toolbar-right">
            <button className="pmis-btn pmis-btn-small" onClick={toggleExpandAll}>
              {allRowsExpanded ? 'Collapse All' : 'Expand All'}
            </button>
            {canMod && (
              <button className="pmis-btn pmis-btn-small" onClick={openAddMilestone}>+ Add Milestone</button>
            )}
          </div>
        </div>

        <MilestoneGrid
          project={project} canMod={canMod} isOnboarding={isOnboarding}
          expandedRows={expandedRows} onToggleRow={toggleRow}
          page={safePage} pageSize={pageSize}
          onAddChild={openAddChild} onEditNode={openEditNode} onDeleteNode={handleDeleteNode}
        />

        <PaginationBar
          total={totalMilestones} page={safePage} pageSize={pageSize} totalPages={totalPages}
          onPage={(n) => setPage(Math.max(1, n))}
          onPageSize={(s) => { setPageSize(s); setPage(1); }}
        />
      </div>

      <NodeModal
        open={modalOpen}
        onClose={() => { setModalOpen(false); setModalContext(null); }}
        project={project} isOnboarding={isOnboarding} editable={canMod}
        context={modalContext} onSaved={handleNodeSaved}
      />
    </div>
  );
}
