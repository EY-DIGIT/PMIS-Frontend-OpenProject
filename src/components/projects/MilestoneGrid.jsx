import React from 'react';
import GridRow from './GridRow';
import { safeArray, getChildren, getAllProjectNodes } from './utils';

export default function MilestoneGrid({
  project, canMod, isOnboarding, expandedRows, onToggleRow,
  page, pageSize, onAddChild, onEditNode, onDeleteNode,
}) {
  const allMilestones = safeArray(project.milestones);
  const effPageSize = pageSize > 0 ? pageSize : Math.max(allMilestones.length, 1);
  const startIdx = (page - 1) * effPageSize;
  const endIdx = Math.min(startIdx + effPageSize, allMilestones.length);
  const pagedMilestones = allMilestones.slice(startIdx, endIdx);

  const rows = [];
  function walk(node, kind, depth, milestoneUid, activityUid, parentTaskUid) {
    const kids = getChildren(node);
    const hasKids = kids.length > 0;
    const isExp = expandedRows.has(node.uid);
    rows.push({ node, kind, depth, hasKids, isExpanded: isExp, milestoneUid, activityUid, parentTaskUid });
    if (!isExp) return;
    if (kind === 'milestone')     kids.forEach((k) => walk(k, 'activity', depth + 1, node.uid, null, null));
    else if (kind === 'activity') kids.forEach((k) => walk(k, 'task', depth + 1, milestoneUid, node.uid, null));
    else if (kind === 'task')     kids.forEach((k) => walk(k, 'subtask', depth + 1, milestoneUid, activityUid, node.uid));
    else                          kids.forEach((k) => walk(k, 'subtask', depth + 1, milestoneUid, activityUid, node.uid));
  }
  pagedMilestones.forEach((m) => walk(m, 'milestone', 0, m.uid, null, null));

  const allProjectNodes = getAllProjectNodes(project);

  return (
    <div className="pmis-grid-wrap">
      <table className="pmis-grid-table">
        <thead>
          <tr>
            <th className="pmis-th-wbs">WBS</th>
            <th>Name</th>
            <th className="pmis-th-type">Type</th>
            <th className="pmis-th-status">Status</th>
            <th className="pmis-th-date">Start</th>
            <th className="pmis-th-date">End</th>
            <th className="pmis-th-vendor">Vendor</th>
            <th className="pmis-th-deps">Depends On</th>
            <th className="pmis-th-actions">Actions</th>
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr className="pmis-empty-row">
              <td colSpan={9}>
                {allMilestones.length === 0
                  ? canMod
                    ? <>No milestones added yet — click <strong>+ Add Milestone</strong> above to start.</>
                    : 'No milestones added yet.'
                  : 'No milestones to display on this page.'}
              </td>
            </tr>
          ) : (
            rows.map((r) => (
              <GridRow
                key={r.node.uid}
                row={r}
                canMod={canMod}
                isOnboarding={isOnboarding}
                allProjectNodes={allProjectNodes}
                onToggleRow={onToggleRow}
                onAddChild={onAddChild}
                onEditNode={onEditNode}
                onDeleteNode={onDeleteNode}
              />
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}
