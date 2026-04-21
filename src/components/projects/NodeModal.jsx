import React, { useState, useEffect, useMemo } from 'react';
import ChipControl from './ChipControl';
import CommentsPanel from './CommentsPanel';
import ResourceSection from './ResourceSection';
import { commitProjects, showMessage, showLoader, hideLoader } from './store';
import {
  NODE_TYPE_OPTIONS, safeArray, deepClone, generateNodeUid,
  locateNode, getAllProjectNodes, effectiveStatus, rollUpStatus,
  addAudit, renumberProject,
} from './utils';

export default function NodeModal({
  open, onClose, project, isOnboarding, editable, context, onSaved,
}) {
  const existingNode = useMemo(() => {
    if (!project || !context || context.mode !== 'edit' || !context.nodeUid) return null;
    const loc = locateNode(project, context.nodeUid);
    return loc ? loc.node : null;
  }, [project, context]);

  const kind = context?.kind;

  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [actualStartDate, setActualStartDate] = useState('');
  const [actualEndDate, setActualEndDate] = useState('');
  const [status, setStatus] = useState('Not Completed');
  const [type, setType] = useState('Standard Type');
  const [vendor, setVendor] = useState('');
  const [dependsOn, setDependsOn] = useState([]);
  const [resourceEntryType, setResourceEntryType] = useState('details');
  const [resourceDetails, setResourceDetails] = useState({});
  const [resourceCount, setResourceCount] = useState({ resType: 'RFP', count: 1, onboardingDate: '', division: '' });

  const [commentsTick, setCommentsTick] = useState(0);
  const [pendingComments, setPendingComments] = useState([]);

  useEffect(() => {
    if (!open || !context) return;
    setPendingComments([]);
    setCommentsTick((t) => t + 1);

    if (context.mode === 'edit' && existingNode) {
      const n = existingNode;
      setName(n.name || '');
      setDescription(n.description || '');
      setStartDate(n.startDate || '');
      setEndDate(n.endDate || '');
      setActualStartDate(n.actualStartDate || '');
      setActualEndDate(n.actualEndDate || '');
      setStatus(n.status || 'Not Completed');
      setType(n.type || 'Standard Type');
      setVendor(n.vendor || '');
      setDependsOn(safeArray(n.dependsOn));
      setResourceEntryType(n.resourceEntryType || 'details');
      setResourceDetails(n.resourceDetails || {});
      setResourceCount(n.resourceCount || { resType: 'RFP', count: 1, onboardingDate: '', division: '' });
    } else {
      setName(''); setDescription(''); setStartDate(''); setEndDate('');
      setActualStartDate(''); setActualEndDate('');
      setStatus('Not Completed'); setType('Standard Type'); setVendor('');
      setDependsOn([]);
      setResourceEntryType('details'); setResourceDetails({});
      setResourceCount({ resType: 'RFP', count: 1, onboardingDate: '', division: '' });
    }
  /* eslint-disable-next-line react-hooks/exhaustive-deps */
  }, [open, context, existingNode]);

  if (!open || !context || !project) return null;

  const titleMap = { milestone: 'Milestone', activity: 'Activity', task: 'Task', subtask: 'Sub Task' };
  const isEdit = context.mode === 'edit' && existingNode;
  const formEditable = !!editable;
  const showActuals = kind !== 'milestone';
  const showType = kind !== 'milestone';
  const showVendor = kind === 'milestone';

  const hintFor = (k) => {
    if (k === 'milestone') return 'Milestones drive the project structure.';
    if (k === 'activity')  return 'Activity Type is required for every activity.';
    if (k === 'task')      return 'Task Type is required for every task.';
    return 'Sub-Tasks can be nested under tasks or under other sub-tasks.';
  };

  const allNodes = getAllProjectNodes(project).filter((x) => !existingNode || x.uid !== existingNode.uid);

  const handlePostComment = ({ text, files, error }) => {
    if (error) { showMessage(error); return; }
    const entry = { who: 'Admin', when: new Date().toISOString(), text, attachments: files || [] };
    if (isEdit) {
      existingNode.comments = safeArray(existingNode.comments);
      existingNode.comments.unshift(entry);
      if (!isOnboarding) addAudit(project, `Comment on ${kind}`, '-', entry);
      commitProjects();
      setCommentsTick((t) => t + 1);
    } else {
      setPendingComments((prev) => [entry, ...prev]);
    }
  };

  const handleSave = () => {
    if (!formEditable) { onClose(); return; }
    const trimmedName = name.trim();
    const desc = description.trim();

    if (!trimmedName || !startDate || !endDate) { showMessage('Fill required fields.'); return; }
    if (endDate < startDate) { showMessage('End date cannot be earlier than start date.'); return; }

    if (status === 'Completed') {
      const unmet = dependsOn
        .map((uid) => {
          const loc = locateNode(project, uid);
          return loc && effectiveStatus(loc.node) !== 'Completed' ? loc.node : null;
        })
        .filter(Boolean);
      if (unmet.length) {
        showMessage(`Cannot mark as Completed: dependency "${unmet[0].name}" is not yet completed.`);
        return;
      }
    }

    showLoader(context.mode === 'add' ? 'Saving new item...' : 'Updating item...');
    setTimeout(() => {
      if (context.mode === 'add') {
        const newNode = {
          uid: generateNodeUid(kind[0]),
          name: trimmedName, description: desc,
          startDate, endDate, status, dependsOn,
          comments: [], attachments: [],
        };
        if (kind !== 'milestone') {
          newNode.actualStartDate = actualStartDate;
          newNode.actualEndDate = actualEndDate;
          newNode.type = type;
          if (type === 'Resource Type') {
            newNode.resourceEntryType = resourceEntryType;
            if (resourceEntryType === 'details') newNode.resourceDetails = resourceDetails;
            else newNode.resourceCount = resourceCount;
          }
        } else {
          newNode.vendor = vendor;
        }

        if (kind === 'milestone') { newNode.activities = []; project.milestones.push(newNode); }
        else if (kind === 'activity') {
          newNode.tasks = [];
          const parent = locateNode(project, context.parentUid)?.node;
          if (!parent) { hideLoader(); showMessage('Parent milestone not found.'); return; }
          parent.activities = safeArray(parent.activities); parent.activities.push(newNode);
        }
        else if (kind === 'task') {
          newNode.subtasks = [];
          const parent = locateNode(project, context.parentUid)?.node;
          if (!parent) { hideLoader(); showMessage('Parent activity not found.'); return; }
          parent.tasks = safeArray(parent.tasks); parent.tasks.push(newNode);
        }
        else {
          newNode.subtasks = [];
          const parent = locateNode(project, context.parentUid)?.node;
          if (!parent) { hideLoader(); showMessage('Parent not found.'); return; }
          parent.subtasks = safeArray(parent.subtasks); parent.subtasks.push(newNode);
        }

        if (pendingComments.length) newNode.comments = [...pendingComments, ...newNode.comments];
        if (!isOnboarding) addAudit(project, `Add ${kind.charAt(0).toUpperCase() + kind.slice(1)}`, '-', deepClone(newNode));

        rollUpStatus(project); renumberProject(project); commitProjects();
        hideLoader(); onClose(); showMessage('Item added');
        onSaved?.({ newNodeUid: newNode.uid, kind });
      } else {
        const loc = locateNode(project, context.nodeUid);
        if (!loc) { hideLoader(); showMessage('Item not found.'); return; }
        const node = loc.node;
        const before = deepClone(node);
        node.name = trimmedName; node.description = desc;
        node.startDate = startDate; node.endDate = endDate;
        node.status = status; node.dependsOn = dependsOn;
        if (kind !== 'milestone') {
          node.actualStartDate = actualStartDate; node.actualEndDate = actualEndDate;
          node.type = type;
          if (type === 'Resource Type') {
            node.resourceEntryType = resourceEntryType;
            if (resourceEntryType === 'details') node.resourceDetails = resourceDetails;
            else node.resourceCount = resourceCount;
          }
        } else {
          node.vendor = vendor;
        }
        if (!isOnboarding) addAudit(project, `Update ${kind.charAt(0).toUpperCase() + kind.slice(1)}`, before, deepClone(node));
        rollUpStatus(project); renumberProject(project); commitProjects();
        hideLoader(); onClose(); showMessage('Item updated');
        onSaved?.({ kind });
      }
    }, 700);
  };

  const nodeId = existingNode?.id;
  const displayComments = isEdit ? safeArray(existingNode?.comments) : pendingComments;
  const charsRemaining = 5000 - (description || '').length;

  return (
    <div className="pmis-modal pmis-modal-open" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="pmis-modal-box pmis-modal-wide">
        <h3 className="pmis-modal-title">{isEdit ? 'View/Update' : 'Add'} {titleMap[kind] || ''}</h3>
        <div className="pmis-hint pmis-modal-subtitle">{hintFor(kind)}</div>

        <div className="pmis-grid">
          {isEdit && nodeId && (
            <div className="pmis-field">
              <label>{kind === 'milestone' ? 'Milestone' : kind === 'activity' ? 'Activity' : kind === 'task' ? 'Task' : 'Sub Task'} ID</label>
              <input value={nodeId} disabled />
            </div>
          )}
          <div className="pmis-field">
            <label>Name <span className="pmis-required">*</span></label>
            <input value={name} onChange={(e) => setName(e.target.value)} disabled={!formEditable} />
          </div>

          {showType && (
            <div className="pmis-field">
              <label>{kind === 'activity' ? 'Activity' : kind === 'task' ? 'Task' : 'Sub Task'} Type <span className="pmis-required">*</span></label>
              <select value={type} onChange={(e) => setType(e.target.value)} disabled={!formEditable}>
                {NODE_TYPE_OPTIONS.map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
            </div>
          )}

          <div className="pmis-field pmis-grid-full">
            <label>Description</label>
            <textarea maxLength={5000} value={description} onChange={(e) => setDescription(e.target.value)} disabled={!formEditable} />
            <div className="pmis-char-count">{charsRemaining} characters remaining</div>
          </div>

          <div className="pmis-field">
            <label>Start Date <span className="pmis-required">*</span></label>
            <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} disabled={!formEditable} />
          </div>
          <div className="pmis-field">
            <label>End Date <span className="pmis-required">*</span></label>
            <input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} disabled={!formEditable} />
          </div>

          {showActuals && (
            <>
              <div className="pmis-field">
                <label>Actual Start Date</label>
                <input type="date" value={actualStartDate} onChange={(e) => setActualStartDate(e.target.value)} disabled={!formEditable} />
              </div>
              <div className="pmis-field">
                <label>Actual End Date</label>
                <input type="date" value={actualEndDate} onChange={(e) => setActualEndDate(e.target.value)} disabled={!formEditable} />
              </div>
            </>
          )}

          <div className="pmis-field">
            <label>Status</label>
            <select value={status} onChange={(e) => setStatus(e.target.value)} disabled={!formEditable}>
              <option>Not Completed</option>
              <option>Completed</option>
            </select>
          </div>

          {showVendor && (
            <div className="pmis-field pmis-grid-full">
              <label>Vendor <span className="pmis-field-sub">(associated with this milestone)</span></label>
              <select value={vendor} onChange={(e) => setVendor(e.target.value)} disabled={!formEditable}>
                <option value="">— None —</option>
                {safeArray(project.vendors).map((v) => <option key={v} value={v}>{v}</option>)}
              </select>
            </div>
          )}

          <div className="pmis-field pmis-grid-full">
            <label>Depends On</label>
            <ChipControl values={dependsOn} options={allNodes} onChange={setDependsOn} disabled={!formEditable} label="dependency" />
          </div>

          {showType && type === 'Resource Type' && (
            <ResourceSection
              entryType={resourceEntryType} setEntryType={setResourceEntryType}
              resourceDetails={resourceDetails} setResourceDetails={setResourceDetails}
              resourceCount={resourceCount} setResourceCount={setResourceCount}
              disabled={!formEditable}
            />
          )}
        </div>

        {!isOnboarding && (
          <CommentsPanel
            key={commentsTick}
            comments={displayComments}
            editable={formEditable}
            onPost={handlePostComment}
          />
        )}

        <div className="pmis-modal-actions">
          {formEditable && <button className="pmis-btn" onClick={handleSave}>Save</button>}
          <button className="pmis-btn pmis-btn-cancel" onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  );
}
