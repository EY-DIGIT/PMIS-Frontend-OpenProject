import { api } from './client';
import { ENDPOINTS } from './endpoint';
import { toApiDate, toApiNodeStatus } from './adapters';

/* Concerned Division wire format: an array with one element per division
   code — e.g. ["tmd1", "tmd2"]. The UI already keeps an array of codes;
   we just trim and drop empties. Empty → null. Strings are split on
   commas so legacy comma-joined values still serialize correctly. */
function serializeConcernedDivision(v) {
  const out = [];
  const push = (x) => {
    String(x == null ? '' : x)
      .split(',')
      .forEach((s) => {
        const t = s.trim();
        if (t) out.push(t);
      });
  };
  if (Array.isArray(v)) v.forEach(push);
  else push(v);
  return out.length ? out : null;
}
function hasConcernedDivision(v) {
  return Array.isArray(v) ? v.some((x) => String(x || '').trim()) : Boolean(v);
}

/* Doc 38: create bodies for milestone / activity / task / subtask are
   minimal — name + description + dates only. Status, dependsOn, actuals,
   ownerDivision, vendorId, concernedDivision all flow via PATCH after
   the row exists. */
function minimalCreateBody(ui) {
  return {
    name: ui.name,
    description: ui.description || '',
    startDate: toApiDate(ui.startDate),
    endDate: toApiDate(ui.endDate),
  };
}

/* PATCH body shared by activity / task / subtask / milestone. Excludes
   the type / resourceMode / resource* fields — Doc 38 removed them from
   every node level. Activity-only fields (ownerDivision, vendorId,
   concernedDivision) are folded in when opts.activityFields is true. */
function nodePatchBody(ui, opts = {}) {
  const body = {
    name: ui.name,
    description: ui.description || '',
    startDate: toApiDate(ui.startDate),
    endDate: toApiDate(ui.endDate),
    actualStartDate: ui.actualStartDate ? toApiDate(ui.actualStartDate) : null,
    actualEndDate: ui.actualEndDate ? toApiDate(ui.actualEndDate) : null,
    status: toApiNodeStatus(ui.status),
  };
  if (Array.isArray(ui.dependsOn) && ui.dependsOn.length) body.dependsOn = ui.dependsOn;
  if (ui.priority !== undefined) body.priority = ui.priority || null;
  if (opts.taskOrSubtask && ui.assignedTo !== undefined) body.assignedTo = ui.assignedTo || null;
  if (opts.activityFields) {
    if (ui.ownerDivision !== undefined) body.ownerDivision = ui.ownerDivision || null;
    if (ui.vendorId !== undefined) body.vendorId = ui.vendorId || null;
    if (ui.concernedDivision !== undefined) body.concernedDivision = serializeConcernedDivision(ui.concernedDivision);
  }
  return body;
}

/* True if any field that Doc 38's minimal-create excludes is set on the
   form. Used to decide whether the post-create follow-up PATCH is worth
   firing. */
function hasRichFields(ui, includeActivity = false) {
  if (ui.status && ui.status !== 'Not Completed') return true;
  if (Array.isArray(ui.dependsOn) && ui.dependsOn.length) return true;
  if (ui.actualStartDate || ui.actualEndDate) return true;
  if (ui.priority) return true;
  if (ui.assignedTo) return true;
  if (includeActivity && (ui.ownerDivision || ui.vendorId || hasConcernedDivision(ui.concernedDivision))) return true;
  return false;
}

function newIdFrom(res) {
  if (!res || typeof res !== 'object') return null;
  return res.id || res.uuid || res.data?.id || res.data?.uuid || null;
}

/* Fire-and-forget follow-up PATCH after a minimal create. Failures are
   swallowed — the entity is already created; rich-field persistence is
   best-effort here. The Promise resolves with the create response so
   callers can keep using the new entity's id. */
async function patchAfterCreate(updatePath, ui, opts) {
  try {
    await api.patch(updatePath, nodePatchBody(ui, opts));
  } catch {
    /* swallow */
  }
}

// ── Milestones ─────────────────────────────────────────────
export async function createMilestone(projectUuid, ui) {
  const created = await api.post(
    ENDPOINTS.projects.milestoneCreate(projectUuid),
    minimalCreateBody(ui)
  );
  if (hasRichFields(ui)) {
    const id = newIdFrom(created);
    if (id) await patchAfterCreate(ENDPOINTS.milestones.update(id), ui);
  }
  return created;
}

export async function updateMilestone(id, ui) {
  return api.patch(ENDPOINTS.milestones.update(id), nodePatchBody(ui));
}

export async function removeMilestone(id) {
  return api.del(ENDPOINTS.milestones.remove(id));
}

// ── Activities ─────────────────────────────────────────────
export async function createActivity(milestoneId, ui) {
  const created = await api.post(
    ENDPOINTS.milestones.activityCreate(milestoneId),
    minimalCreateBody(ui)
  );
  if (hasRichFields(ui, true)) {
    const id = newIdFrom(created);
    if (id) await patchAfterCreate(ENDPOINTS.activities.update(id), ui, { activityFields: true });
  }
  return created;
}

export async function updateActivity(id, ui) {
  return api.patch(
    ENDPOINTS.activities.update(id),
    nodePatchBody(ui, { activityFields: true })
  );
}

export async function removeActivity(id) {
  return api.del(ENDPOINTS.activities.remove(id));
}

// ── Tasks ──────────────────────────────────────────────────
export async function createTask(activityId, ui) {
  const created = await api.post(
    ENDPOINTS.activities.taskCreate(activityId),
    minimalCreateBody(ui)
  );
  if (hasRichFields(ui)) {
    const id = newIdFrom(created);
    if (id) await patchAfterCreate(ENDPOINTS.tasks.update(id), ui, { taskOrSubtask: true });
  }
  return created;
}

export async function updateTask(id, ui) {
  return api.patch(ENDPOINTS.tasks.update(id), nodePatchBody(ui, { taskOrSubtask: true }));
}

export async function removeTask(id) {
  return api.del(ENDPOINTS.tasks.remove(id));
}

// ── Subtasks ───────────────────────────────────────────────
export async function createSubtask(parentId, ui, parentKind = 'task') {
  const createPath = parentKind === 'subtask'
    ? ENDPOINTS.subtasks.subtaskCreate(parentId)
    : ENDPOINTS.tasks.subtaskCreate(parentId);
  const created = await api.post(createPath, minimalCreateBody(ui));
  if (hasRichFields(ui)) {
    const id = newIdFrom(created);
    if (id) await patchAfterCreate(ENDPOINTS.subtasks.update(id), ui, { taskOrSubtask: true });
  }
  return created;
}

export async function updateSubtask(id, ui) {
  return api.patch(ENDPOINTS.subtasks.update(id), nodePatchBody(ui, { taskOrSubtask: true }));
}

export async function removeSubtask(id) {
  return api.del(ENDPOINTS.subtasks.remove(id));
}

// ── Polymorphic helpers used by UI ─────────────────────────
export const createByKind = {
  milestone: createMilestone,
  activity: createActivity,
  task: createTask,
  subtask: createSubtask,
};

export const updateByKind = {
  milestone: updateMilestone,
  activity: updateActivity,
  task: updateTask,
  subtask: updateSubtask,
};

export const removeByKind = {
  milestone: removeMilestone,
  activity: removeActivity,
  task: removeTask,
  subtask: removeSubtask,
};
