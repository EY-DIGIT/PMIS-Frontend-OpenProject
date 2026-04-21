import React from 'react';
import { safeArray, formatDateDisplay, effectiveStatus } from './utils';

export default function GridRow({
  row, canMod, isOnboarding, allProjectNodes,
  onToggleRow, onAddChild, onEditNode, onDeleteNode,
}) {
  const { node, kind, depth, hasKids, isExpanded } = row;
  const indent = 10 + depth * 28;

  const eff = effectiveStatus(node);
  const rolled = eff === 'Completed' && node.status !== 'Completed';
  const statusClass = eff === 'Completed' ? (rolled ? 'pmis-status-rolledup' : 'pmis-status-done') : 'pmis-status-todo';
  const statusLabel = eff === 'Completed' ? (rolled ? 'All children completed' : 'Completed') : 'Not Completed';

  const deps = safeArray(node.dependsOn)
    .map((uid) => allProjectNodes.find((n) => n.uid === uid))
    .filter(Boolean);

  const typeLabel = kind === 'milestone' ? 'Milestone' : (node.type || '');
  const showAddChildBtn = canMod && (
    kind === 'milestone' ||
    (kind === 'activity' && !isOnboarding) ||
    ((kind === 'task' || kind === 'subtask') && !isOnboarding)
  );

  let addChildLabel = '', addChildKind = '';
  if (kind === 'milestone')     { addChildLabel = '+ Activity'; addChildKind = 'activity'; }
  else if (kind === 'activity') { addChildLabel = '+ Task';     addChildKind = 'task'; }
  else                          { addChildLabel = '+ Sub Task'; addChildKind = 'subtask'; }

  return (
    <tr className={`pmis-row-${kind}`}>
      <td className="pmis-cell pmis-cell-wbs">{node.id || ''}</td>
      <td className="pmis-cell pmis-cell-name">
        <div className="pmis-name-inner" style={{ paddingLeft: indent }}>
          {hasKids ? (
            <button type="button" className="pmis-expand-btn"
              onClick={(e) => { e.stopPropagation(); onToggleRow(node.uid); }} aria-label="Toggle">
              {isExpanded ? '−' : '+'}
            </button>
          ) : (
            <span className="pmis-expand-spacer" />
          )}
          <span className="pmis-row-label" title={node.name}>{node.name}</span>
          {showAddChildBtn && (
            <button className="pmis-add-inline-btn"
              onClick={(e) => { e.stopPropagation(); onAddChild({ kind: addChildKind, parentUid: node.uid }); }}
            >{addChildLabel}</button>
          )}
        </div>
      </td>
      <td className="pmis-cell">{typeLabel && <span className="pmis-type-tag">{typeLabel}</span>}</td>
      <td className="pmis-cell"><span className={`pmis-status-pill ${statusClass}`}>{statusLabel}</span></td>
      <td className="pmis-cell">{formatDateDisplay(node.startDate)}</td>
      <td className="pmis-cell">{formatDateDisplay(node.endDate)}</td>
      <td className="pmis-cell">
        {kind === 'milestone' && node.vendor
          ? <span className="pmis-vendor-tag">{node.vendor}</span>
          : <span className="pmis-dep-empty">—</span>}
      </td>
      <td className="pmis-cell">
        {deps.length > 0
          ? deps.map((f) => <span className="pmis-dep-tag" key={f.uid}>{f.id || f.name}</span>)
          : <span className="pmis-dep-empty">—</span>}
      </td>
      <td className="pmis-cell pmis-cell-actions">
        <button className="pmis-btn-text" onClick={() => onEditNode(node.uid, kind)}>Edit</button>
        <button className="pmis-btn-text pmis-btn-text-danger" disabled={!canMod}
          onClick={() => onDeleteNode(node.uid, kind)}>Delete</button>
      </td>
    </tr>
  );
}
