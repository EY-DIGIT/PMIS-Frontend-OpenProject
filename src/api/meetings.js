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
  return api.get(ENDPOINTS.meetings.momGet(meetingId));
}

/* PUT /api/meetings/{id} — update meeting including attendance. */
export async function updateMeeting(meetingId, payload) {
  return api.put(ENDPOINTS.meetings.update(meetingId), payload);
}
