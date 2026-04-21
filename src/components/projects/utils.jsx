/* ═══════════════════════════════════════════════════════════════
   Constants, pure utility helpers, and seed data
   ═══════════════════════════════════════════════════════════════ */

/* ─── Constants ─── */
export const NODE_TYPE_OPTIONS   = ['Standard Type', 'Resource Type', 'Transactional Type'];
export const RESOURCE_TYPE_CODES = ['RFP', 'ASG', 'CCM'];
export const CATEGORY_OPTIONS    = ['MSAP', 'MSIP', 'BSP', 'Others'];
export const VENDOR_MASTER       = ['Vendor A', 'Vendor B', 'Vendor C', 'Vendor D', 'Vendor E'];

export const DELETE_PHRASES = [
  'quiet blue river bends',
  'silver dawn warms hills',
  'steady hands build trust',
  'gentle winds move forward',
  'bright paths stay clear',
  'calm lights guide work',
];

/* ─── Basic utils ─── */
export const deepClone = (obj) => (obj == null ? obj : JSON.parse(JSON.stringify(obj)));
export const safeArray = (v) => (Array.isArray(v) ? v : []);

export function formatDateDisplay(iso) {
  if (!iso || iso === '-') return '-';
  const parts = String(iso).split('-');
  return parts.length === 3 ? `${parts[2]}-${parts[1]}-${parts[0]}` : iso;
}

export function formatDateTime(iso) {
  if (!iso) return '-';
  try {
    const d = new Date(iso);
    if (isNaN(d.getTime())) return iso;
    const pad = (n) => String(n).padStart(2, '0');
    return `${pad(d.getDate())}-${pad(d.getMonth() + 1)}-${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
  } catch (e) { return iso; }
}

export function generateNodeUid(prefix) {
  return `${prefix}-${Math.random().toString(36).slice(2, 10)}-${Date.now().toString(36)}`;
}

/* ─── Normalization ─── */
function normalizeNode(node, kind) {
  if (!node.uid) node.uid = generateNodeUid(kind[0]);
  if (!node.comments)    node.comments    = [];
  if (!node.attachments) node.attachments = [];
  if (!('status' in node) || !node.status) node.status = 'Not Completed';
  if (!('description' in node))     node.description = '';
  if (!('startDate' in node))       node.startDate = '';
  if (!('endDate' in node))         node.endDate = '';
  if (!('actualStartDate' in node)) node.actualStartDate = '';
  if (!('actualEndDate' in node))   node.actualEndDate = '';
  if (!('dependsOn' in node))       node.dependsOn = [];
  if (kind === 'milestone' && !('vendor' in node)) node.vendor = '';
  if (kind !== 'milestone' && !('type' in node))   node.type = 'Standard Type';
  if (kind === 'activity' || kind === 'task' || kind === 'subtask') {
    if (!('resourceEntryType' in node)) node.resourceEntryType = 'details';
    if (!node.resourceDetails) node.resourceDetails = {};
    if (!node.resourceCount)   node.resourceCount = { resType: 'RFP', count: 1, onboardingDate: '', division: '' };
  }
}

function normalizeSubtaskList(list, parentId) {
  list.forEach((s, si) => {
    normalizeNode(s, 'subtask');
    s.id = `${parentId}.${si + 1}`;
    s.subtasks = safeArray(s.subtasks);
    normalizeSubtaskList(s.subtasks, s.id);
  });
}

export function normalizeProject(project) {
  if (!project) return project;
  if (!project.auditLogs) project.auditLogs = [];
  if (!('isVersion' in project))     project.isVersion = false;
  if (!('versionOf' in project))     project.versionOf = '';
  if (!('versionNo' in project))     project.versionNo = 0;
  if (!('actualEndDate' in project)) project.actualEndDate = '';
  if (!project.baselineId) project.baselineId = '-';
  if (!project.vendors)    project.vendors = [];
  if (!project.resources)  project.resources = [];
  project.milestones = safeArray(project.milestones);

  project.milestones.forEach((m, mi) => {
    normalizeNode(m, 'milestone');
    m.id = `M${mi + 1}`;
    m.activities = safeArray(m.activities);
    m.activities.forEach((a, ai) => {
      normalizeNode(a, 'activity');
      a.id = `A${mi + 1}.${ai + 1}`;
      a.tasks = safeArray(a.tasks);
      a.tasks.forEach((t, ti) => {
        normalizeNode(t, 'task');
        t.id = `T${mi + 1}.${ai + 1}.${ti + 1}`;
        t.subtasks = safeArray(t.subtasks);
        normalizeSubtaskList(t.subtasks, t.id);
      });
    });
  });
  return project;
}

export const renumberProject = normalizeProject;

/* ─── Tree traversal ─── */
export function getChildren(node) {
  if (!node) return [];
  if (node.activities) return safeArray(node.activities);
  if (node.tasks)      return safeArray(node.tasks);
  return safeArray(node.subtasks);
}

export function locateNode(project, uid) {
  if (!project) return null;
  const stack = [];
  function scan(list, parent, parentKind, kind) {
    for (const item of list) {
      const chain = stack.concat([{ node: item, kind, parent, parentKind }]);
      if (item.uid === uid) return chain;
      stack.push({ node: item, kind, parent, parentKind });
      let res = null;
      if (kind === 'milestone')      res = scan(safeArray(item.activities), item, 'milestone', 'activity');
      else if (kind === 'activity')  res = scan(safeArray(item.tasks), item, 'activity', 'task');
      else if (kind === 'task')      res = scan(safeArray(item.subtasks), item, 'task', 'subtask');
      else if (kind === 'subtask')   res = scan(safeArray(item.subtasks), item, 'subtask', 'subtask');
      stack.pop();
      if (res) return res;
    }
    return null;
  }
  const chain = scan(safeArray(project.milestones), project, 'project', 'milestone');
  if (!chain) return null;
  const last = chain[chain.length - 1];
  return { node: last.node, kind: last.kind, parent: last.parent, parentKind: last.parentKind, chain };
}

export function getAllProjectNodes(project) {
  const out = [];
  function walk(list, kind) {
    safeArray(list).forEach((n) => {
      out.push({ uid: n.uid, id: n.id, name: n.name, kind });
      if (kind === 'milestone')      walk(n.activities, 'activity');
      else if (kind === 'activity')  walk(n.tasks, 'task');
      else                           walk(n.subtasks, 'subtask');
    });
  }
  walk(project.milestones, 'milestone');
  return out;
}

/* ─── Status propagation ─── */
export function effectiveStatus(node) {
  if (!node) return 'Not Completed';
  if (node.status === 'Completed') return 'Completed';
  const kids = getChildren(node);
  if (!kids.length) return node.status || 'Not Completed';
  const allDone = kids.every((k) => effectiveStatus(k) === 'Completed');
  return allDone ? 'Completed' : (node.status || 'Not Completed');
}

export function rollUpStatus(project) {
  function walk(node, kind) {
    const kids = getChildren(node);
    kids.forEach((k) => {
      let childKind = 'subtask';
      if (kind === 'project')        childKind = 'milestone';
      else if (kind === 'milestone') childKind = 'activity';
      else if (kind === 'activity')  childKind = 'task';
      walk(k, childKind);
    });
    if (kids.length && kids.every((k) => k.status === 'Completed')) {
      node.status = 'Completed';
    }
  }
  walk(project, 'project');
}

/* ─── Audit ─── */
export function addAudit(project, action, before, after) {
  if (!project) return;
  if (!project.auditLogs) project.auditLogs = [];
  project.auditLogs.unshift({
    when: new Date().toISOString(), who: 'Admin', action, before, after,
  });
}

/* ─── Project-id helpers ─── */
export function getNextProjectId(projects) {
  const max = projects.reduce((acc, p) => {
    const m = String(p.projectId || '').match(/^PRJ(\d+)(?:-V\d+)?$/i);
    return m ? Math.max(acc, parseInt(m[1], 10)) : acc;
  }, 0);
  return `PRJ${String(max + 1).padStart(3, '0')}`;
}

export function getRootProjectId(p) {
  return p.versionOf || String(p.projectId || '').split('-V')[0];
}

export function getNextVersionId(projects, base) {
  let maxV = 0;
  projects.forEach((p) => {
    if (getRootProjectId(p) === base) {
      const m = String(p.projectId || '').match(/-V(\d+)$/i);
      if (m) maxV = Math.max(maxV, parseInt(m[1], 10));
    }
  });
  return `${base}-V${maxV + 1}`;
}

export const canEditProjectDetails = (p) => !!p && !(p.status === 'PUBLISHED' && !p.isVersion);
export const canEditHierarchy      = (p) => !!p && !(p.status === 'PUBLISHED' && !p.isVersion);
export const isVersionProject      = (p) => !!p && !!p.isVersion;

/* ─── Seed data ─── */
export function seedProjects() {
  const seeds = [
    {
      projectId: 'PRJ001', projectName: 'Test Project Alpha', baselineId: '-',
      description: 'Testing description alpha', status: 'NEW', owner: 'Admin',
      startDate: '2026-04-01', endDate: '2026-04-30', actualEndDate: '',
      isPublic: 'Yes', category: 'MSAP', isVersion: false, versionOf: '',
      versionNo: 0, auditLogs: [], vendors: ['Vendor A'], resources: [],
      milestones: [
        {
          name: 'Initiation', description: 'Set up the project, confirm scope, and secure approvals.',
          status: 'Not Completed', vendor: 'Vendor A', startDate: '2026-04-01', endDate: '2026-04-05',
          activities: [
            {
              name: 'Requirement Collection', description: 'Collect and confirm functional requirements.',
              type: 'Standard Type', status: 'Not Completed',
              startDate: '2026-04-01', endDate: '2026-04-02',
              tasks: [
                { name: 'Gather Reference Documents', description: 'Collect policy documents, forms, and baseline references.',
                  type: 'Standard Type', status: 'Not Completed',
                  startDate: '2026-04-01', endDate: '2026-04-01', subtasks: [] },
                { name: 'Stakeholder Confirmation', description: 'Finalize internal and external stakeholder list.',
                  type: 'Resource Type', status: 'Not Completed',
                  startDate: '2026-04-02', endDate: '2026-04-02',
                  resourceEntryType: 'count',
                  resourceCount: { resType: 'ASG', count: 2, onboardingDate: '2026-04-02', division: 'Dev' },
                  subtasks: [] },
              ],
            },
            {
              name: 'Kickoff Preparation', description: 'Prepare agenda, invite participants.',
              type: 'Resource Type', status: 'Not Completed',
              startDate: '2026-04-03', endDate: '2026-04-04',
              resourceEntryType: 'details',
              resourceDetails: {
                resourceName: 'John Doe', resType: 'RFP', division: 'PMO',
                onboardingDate: '2026-04-03', offboardingDate: '2026-04-04',
                actualOnboardingDate: '', actualOffboardingDate: '',
                position: 'Lead', designation: 'Manager', jobRole: 'PM',
                qualification: 'MBA', experience: '8',
              },
              tasks: [
                { name: 'Agenda Drafting', description: 'Draft the kickoff agenda.',
                  type: 'Standard Type', status: 'Not Completed',
                  startDate: '2026-04-03', endDate: '2026-04-03', subtasks: [] },
              ],
            },
          ],
        },
        {
          name: 'Execution', description: 'Core delivery phase.',
          status: 'Not Completed', vendor: '', startDate: '2026-04-06', endDate: '2026-04-18',
          activities: [
            {
              name: 'Configuration Setup', description: 'Configure settings and validate implementation readiness.',
              type: 'Transactional Type', status: 'Not Completed',
              startDate: '2026-04-06', endDate: '2026-04-10',
              tasks: [
                { name: 'Environment Preparation', description: 'Prepare the environment.',
                  type: 'Standard Type', status: 'Not Completed',
                  startDate: '2026-04-08', endDate: '2026-04-08', subtasks: [] },
              ],
            },
          ],
        },
      ],
    },
    {
      projectId: 'PRJ002', projectName: 'Test Project Beta', baselineId: '-',
      description: 'Testing description beta', status: 'INPROGRESS', owner: 'Supervisor',
      startDate: '2026-05-01', endDate: '2026-05-20', actualEndDate: '',
      isPublic: 'No', category: 'MSIP', isVersion: false, versionOf: '',
      versionNo: 0, auditLogs: [], vendors: [], resources: [],
      milestones: [
        {
          name: 'Planning', description: 'Planning and approvals.',
          status: 'Not Completed', vendor: '', startDate: '2026-05-01', endDate: '2026-05-04',
          activities: [
            {
              name: 'Scope Finalization', description: 'Finalize the project scope.',
              type: 'Standard Type', status: 'Not Completed',
              startDate: '2026-05-02', endDate: '2026-05-03',
              tasks: [
                { name: 'Scope Review', description: 'Review all planned deliverables.',
                  type: 'Standard Type', status: 'Not Completed',
                  startDate: '2026-05-02', endDate: '2026-05-02', subtasks: [] },
              ],
            },
          ],
        },
      ],
    },
    {
      projectId: 'PRJ003', projectName: 'Test Project Gamma', baselineId: '-',
      description: 'Testing description gamma', status: 'NEW', owner: 'Manager',
      startDate: '2026-06-01', endDate: '2026-06-25', actualEndDate: '',
      isPublic: 'Yes', category: 'BSP', isVersion: false, versionOf: '',
      versionNo: 0, auditLogs: [], vendors: [], resources: [],
      milestones: [],
    },
  ];
  seeds.forEach((p) => normalizeProject(p));
  return seeds;
}
