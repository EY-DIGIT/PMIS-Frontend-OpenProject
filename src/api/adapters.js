export function toApiDate(ymd) {
  if (!ymd) return null;
  if (typeof ymd === 'string' && ymd.includes('T')) return ymd;
  return `${ymd}T00:00:00+05:30`;
}

export function fromApiDate(iso) {
  if (!iso) return '';
  return String(iso).slice(0, 10);
}

const STATUS_API_TO_UI = {
  new: 'NEW',
  draft: 'DRAFT',
  inprogress: 'INPROGRESS',
  in_progress: 'INPROGRESS',
  published: 'PUBLISHED',
  closed: 'CLOSED',
  suspended: 'SUSPENDED',
};

const NODE_STATUS_API_TO_UI = {
  not_completed: 'Not Completed',
  completed: 'Completed',
};
const NODE_STATUS_UI_TO_API = {
  'Not Completed': 'not_completed',
  Completed: 'completed',
};

export const toApiNodeStatus = (s) => NODE_STATUS_UI_TO_API[s] || 'not_completed';
export const fromApiNodeStatus = (s) => NODE_STATUS_API_TO_UI[s] || 'Not Completed';

export function fromApiProject(api) {
  if (!api) return null;
  return {
    projectId: api.uuid || api.id,
    projectCode: api.projectCode || '',
    projectName: api.name || '',
    description: api.description || '',
    owner: api.owner || '',
    status: STATUS_API_TO_UI[String(api.status || '').toLowerCase()] || 'NEW',
    startDate: fromApiDate(api.startDate || api.start_date),
    endDate: fromApiDate(api.endDate || api.end_date),
    actualEndDate: fromApiDate(api.actualEndDate || api.actual_end_date),
    vendors: Array.isArray(api.vendors) ? api.vendors.map((v) => v.name || v) : [],
    resources: api.resources || [],
    milestones: (api.milestones || []).map(fromApiMilestone),
    auditLogs: api.auditLogs || [],
  };
}

const nodeId = (n) => n.uuid || n.id;

function fromApiMilestone(m) {
  const id = nodeId(m);
  return {
    uid: id,
    uuid: id,
    name: m.name || '',
    description: m.description || '',
    startDate: fromApiDate(m.startDate),
    endDate: fromApiDate(m.endDate),
    status: fromApiNodeStatus(m.status),
    vendor: m.vendor || '',
    activities: (m.activities || []).map(fromApiActivity),
  };
}

function fromApiActivity(a) {
  const id = nodeId(a);
  return {
    uid: id,
    uuid: id,
    name: a.name || '',
    description: a.description || '',
    type: mapTypeApiToUi(a.type),
    startDate: fromApiDate(a.startDate),
    endDate: fromApiDate(a.endDate),
    status: fromApiNodeStatus(a.status),
    resourceEntryType: a.resourceMode || 'details',
    resourceDetails: a.resource || {},
    resourceCount: a.resource || {},
    tasks: (a.tasks || []).map(fromApiTask),
  };
}

function fromApiTask(t) {
  const id = nodeId(t);
  return {
    uid: id,
    uuid: id,
    name: t.name || '',
    description: t.description || '',
    type: mapTypeApiToUi(t.type),
    startDate: fromApiDate(t.startDate),
    endDate: fromApiDate(t.endDate),
    status: fromApiNodeStatus(t.status),
    subtasks: (t.subtasks || []).map(fromApiSubtask),
  };
}

function fromApiSubtask(s) {
  const id = nodeId(s);
  return {
    uid: id,
    uuid: id,
    name: s.name || '',
    description: s.description || '',
    type: mapTypeApiToUi(s.type),
    startDate: fromApiDate(s.startDate),
    endDate: fromApiDate(s.endDate),
    status: fromApiNodeStatus(s.status),
    subtasks: (s.subtasks || []).map(fromApiSubtask),
  };
}

const TYPE_UI_TO_API = {
  'Standard Type': 'standard',
  'Resource Type': 'resource',
  'Transactional Type': 'transactional',
};
const TYPE_API_TO_UI = {
  standard: 'Standard Type',
  resource: 'Resource Type',
  transactional: 'Transactional Type',
};

export const mapTypeUiToApi = (t) => TYPE_UI_TO_API[t] || 'standard';
export const mapTypeApiToUi = (t) => TYPE_API_TO_UI[t] || 'Standard Type';

export function toApiProject(ui) {
  return {
    name: ui.projectName,
    description: ui.description || '',
    active: true,
    owner: ui.owner,
    startDate: toApiDate(ui.startDate),
    endDate: toApiDate(ui.endDate),
    vendorIds: ui.vendorIds || [],
  };
}
