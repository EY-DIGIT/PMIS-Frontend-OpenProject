/* ══════════════════════════════════════════════════════════════════
   meetings.js — POST /api/meetings wrapper.

   Reference payload (from Gaurav's curl, 2026-06-03):
     {
       title, meetingDate, startTime, endTime, description, meetingLink,
       projectId, milestoneId,
       attendees:        [{ userId, participantRole, mandatory }],
       externalAttendees:[{ email }],
       attachments:      [{ filename, contentType, content (base64) }]
     }

   `attachments` is our extension to the contract — files are read as
   base64 in the browser so the request stays JSON. Swap to multipart
   if the backend ever rejects this shape.
   ══════════════════════════════════════════════════════════════════ */

import { api } from './client';
import { ENDPOINTS } from './endpoint';

/* Read a File into a base64 string (no `data:...;base64,` prefix). */
export function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = String(reader.result || '');
      const comma = result.indexOf(',');
      resolve(comma >= 0 ? result.slice(comma + 1) : result);
    };
    reader.onerror = () => reject(reader.error || new Error('File read failed'));
    reader.readAsDataURL(file);
  });
}

export async function encodeAttachments(files) {
  if (!files || !files.length) return [];
  const list = Array.from(files);
  const out = [];
  for (const f of list) {
    const content = await fileToBase64(f);
    out.push({
      filename: f.name,
      contentType: f.type || 'application/octet-stream',
      content,
    });
  }
  return out;
}

export async function createMeeting(payload) {
  return api.post(ENDPOINTS.meetings.create, payload);
}

/* GET /api/meetings?projectId=ALL&status=ALL&page=0&size=20
   Response: { content:[…], page, size, totalElements, totalPages, last } */
export async function listMeetings({
  projectId = 'ALL',
  status = 'ALL',
  page = 0,
  size = 20,
} = {}) {
  return api.get(ENDPOINTS.meetings.list, {
    query: { projectId, status, page, size },
  });
}

export async function getMeeting(id) {
  return api.get(ENDPOINTS.meetings.get(id));
}

/* POST /api/meetings/{id}/mom — body is the structured MoM payload
   (title, templateId, content, decisions[], actionItems[], risks[]). */
export async function saveMoM(meetingId, body) {
  return api.post(ENDPOINTS.meetings.mom(meetingId), body);
}

/* GET /api/meetings/mom/get/{id} — returns the existing MoM record
   ({decisions, actionItems, risks, ...}) used to prefill the MoM
   form on the meeting detail page. Returns null if no MoM exists. */
export async function getMoM(meetingId) {
  return api.get(ENDPOINTS.meetings.momGetByMeeting(meetingId));
}

/* PUT /api/meetings/{id} — update meeting including attendance. */
export async function updateMeeting(meetingId, payload) {
  return api.put(ENDPOINTS.meetings.update(meetingId), payload);
}

export async function updateMeetingStatus(meetingId, status) {
  return api.put(ENDPOINTS.meetings.updateStatus(meetingId),undefined,{query: { status },
  });
}

export async function momUpdateStatus(momId, status) {
  return api.put(
    `${ENDPOINTS.meetings.momUpdateStatus(momId)}?status=${encodeURIComponent(status)}`,
    null
  );
}

/* POST /projects/api/v3/activities/{activityId}/tasks/create — create one
   task under the meeting's linked activity. Called once per MoM task row
   when the user saves the MoM. Body shape (per the backend curl):
     { name, description, startDate, endDate, actualStartDate,
       actualEndDate, status, priority, position, assignedTo, dependsOn[] } */
export async function createActivityTask(activityId, body) {
  return api.post(ENDPOINTS.activities.taskCreate(activityId), body);
}

/* GET /projects/api/v3/activities/{activityId}/tasks — the real tasks under
   an activity. Response: { data: { _embedded: { elements: [Task…] }, total,
   count, pageSize, offset } }. The Linked-Task view sources its rows (and the
   task UUIDs it PATCHes) from here. offset is 1-based; pull a big page so all
   tasks for the meeting's activity come back in one call. */
export async function listActivityTasks(
  activityId,
  { offset = 1, pageSize = 200, includeDeleted = false } = {}
) {
  return api.get(ENDPOINTS.activities.tasks(activityId), {
    query: { offset, pageSize, includeDeleted },
  });
}

/* PATCH /projects/api/v3/tasks/{id} — update a single activity task in
   place. Used by the Linked-Task view to push edited description /
   assignee / priority back onto the real task. */
export async function updateTask(taskId, body) {
  return api.patch(ENDPOINTS.tasks.update(taskId), body);
}

/* DELETE /projects/api/v3/tasks/{id} — remove a single activity task. Used
   by the Linked-Task view's per-row delete. */
export async function deleteTask(taskId) {
  return api.del(ENDPOINTS.tasks.remove(taskId));
}
