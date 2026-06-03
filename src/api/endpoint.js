// /* ══════════════════════════════════════════════════════════════════
//    src/api/endpoint.js

//    Single source of truth for every REST path the frontend calls.
//    Organized by resource; dynamic segments are expressed as functions
//    so callers can do:  ENDPOINTS.projects.get(uuid)
//    ══════════════════════════════════════════════════════════════════ */

// const enc = encodeURIComponent;

// export const ENDPOINTS = {
//   auth: {
//     login: '/api/v3/users/login',
//     logout: '/api/v3/users/logout',
//     me: '/api/v3/users/me',
//     introspect: '/api/v3/users/introspect',
//     refresh: '/api/v3/users/refresh',
//     sendOtp: '/api/v3/users/login/send-otp',
//     verifyOtp: '/api/v3/users/login/verify-otp',
//     forgotPassword: '/api/v3/users/forgot-password',
//     resetPassword: '/api/v3/users/reset-password',
//   },

//   users: {
//     list: '/api/v3/users',
//     get: (id) => `/api/v3/users/${enc(id)}`,
//     create: '/api/v3/users/create',
//     update: (id) => `/api/v3/users/${enc(id)}`,
//     updatePassword: (id) => `/api/v3/users/${enc(id)}/password`,
//     remove: (id) => `/api/v3/users/${enc(id)}`,
//   },

//   vendors: {
//     list: '/api/v3/vendors',
//     get: (id) => `/api/v3/vendors/${enc(id)}`,
//     create: '/api/v3/vendors/create',
//     update: (id) => `/api/v3/vendors/${enc(id)}`,
//     remove: (id) => `/api/v3/vendors/${enc(id)}`,
//     users: (id) => `/api/v3/vendors/${enc(id)}/users`,
//   },

//   divisions: {
//     list: '/api/v3/divisions',
//   },

//   master: {
//     divisions: {
//       list: '/api/v3/master/divisions',
//       create: '/api/v3/master/divisions/create',
//       byCode: (code) => `/api/v3/master/divisions/${enc(code)}`,
//       restore: (code) => `/api/v3/master/divisions/${enc(code)}/restore`,
//     },
//   },

//   resourceTypes: {
//     list: '/api/v3/resource_types',
//   },

//   priorities: {
//     list: '/api/v3/priorities',
//   },

//   roles: {
//     list: '/api/v3/master/roles',
//   },

//   projects: {
//     list: '/api/v3/projects',
//     get: (uuid) => `/api/v3/projects/${enc(uuid)}`,
//     tree: (uuid) => `/api/v3/projects/${enc(uuid)}/tree`,
//     create: '/api/v3/projects/create',
//     update: (uuid) => `/api/v3/projects/${enc(uuid)}`,
//     remove: (uuid) => `/api/v3/projects/${enc(uuid)}`,
//     save: (uuid) => `/api/v3/projects/${enc(uuid)}/save`,
//     publish: (uuid) => `/api/v3/projects/${enc(uuid)}/publish`,
//     close: (uuid) => `/api/v3/projects/${enc(uuid)}/close`,
//     milestones: (uuid) => `/api/v3/projects/${enc(uuid)}/milestones`,
//     milestoneCreate: (uuid) => `/api/v3/projects/${enc(uuid)}/milestones/create`,
//     auditLogs: (uuid) => `/api/v3/projects/${enc(uuid)}/audit-logs`,
//     attachments: (uuid) => `/api/v3/projects/${enc(uuid)}/attachments`,
//     discussionFeed: (uuid) => `/api/v3/projects/${enc(uuid)}/discussion-feed`,
//   },

//   milestones: {
//     update: (id) => `/api/v3/milestones/${enc(id)}`,
//     remove: (id) => `/api/v3/milestones/${enc(id)}`,
//     activities: (id) => `/api/v3/milestones/${enc(id)}/activities`,
//     attachments: (id) => `/api/v3/milestones/${enc(id)}/attachments`,
//     comments: (id) => `/api/v3/milestones/${enc(id)}/comments`,
//     // Doc 38: single unified create endpoint (legacy /standard, /transactional,
//     // /resource/count, /resource/details paths were removed).
//     activityCreate: (milestoneId) =>
//       `/api/v3/milestones/${enc(milestoneId)}/activities/create`,
//   },

//   activities: {
//     get: (id) => `/api/v3/activities/${enc(id)}`,
//     update: (id) => `/api/v3/activities/${enc(id)}`,
//     remove: (id) => `/api/v3/activities/${enc(id)}`,
//     tasks: (id) => `/api/v3/activities/${enc(id)}/tasks`,
//     taskCreate: (id) => `/api/v3/activities/${enc(id)}/tasks/create`,
//     attachments: (id) => `/api/v3/activities/${enc(id)}/attachments`,
//     comments: (id) => `/api/v3/activities/${enc(id)}/comments`,
//   },

//   tasks: {
//     get: (id) => `/api/v3/tasks/${enc(id)}`,
//     update: (id) => `/api/v3/tasks/${enc(id)}`,
//     remove: (id) => `/api/v3/tasks/${enc(id)}`,
//     subtasks: (id) => `/api/v3/tasks/${enc(id)}/subtasks`,
//     subtaskCreate: (id) => `/api/v3/tasks/${enc(id)}/subtasks/create`,
//     attachments: (id) => `/api/v3/tasks/${enc(id)}/attachments`,
//     comments: (id) => `/api/v3/tasks/${enc(id)}/comments`,
//   },

//   subtasks: {
//     get: (id) => `/api/v3/subtasks/${enc(id)}`,
//     update: (id) => `/api/v3/subtasks/${enc(id)}`,
//     remove: (id) => `/api/v3/subtasks/${enc(id)}`,
//     subtasks: (id) => `/api/v3/subtasks/${enc(id)}/subtasks`,
//     subtaskCreate: (id) => `/api/v3/subtasks/${enc(id)}/subtasks/create`,
//     attachments: (id) => `/api/v3/subtasks/${enc(id)}/attachments`,
//     comments: (id) => `/api/v3/subtasks/${enc(id)}/comments`,
//   },

//   // Admin-only dashboard endpoints. Live on the monolith starting 2026-05-09.
//   // See app/api/v3/dashboard/schemas.py for canonical response shapes.
//   dashboard: {
//     summary: '/api/v3/dashboard/summary',
//     projects: '/api/v3/dashboard/projects',
//     project: (uuid) => `/api/v3/dashboard/projects/${enc(uuid)}`,
//     projectItems: (uuid) => `/api/v3/dashboard/projects/${enc(uuid)}/items`,
//     organisations: '/api/v3/dashboard/organisations',
//     organisation: (vendorId) => `/api/v3/dashboard/organisations/${enc(vendorId)}`,
//   },
// };



/* ══════════════════════════════════════════════════════════════════
   src/api/endpoint.js

   Single source of truth for every REST path the frontend calls.
   Organized by resource; dynamic segments are expressed as functions
   so callers can do:  ENDPOINTS.projects.get(uuid)
   ══════════════════════════════════════════════════════════════════ */

const enc = encodeURIComponent;

export const ENDPOINTS = {
  auth: {
    login: '/users/api/v3/users/login',
    logout: '/users/api/v3/users/logout',
    me: '/users/api/v3/users/me',
    introspect: '/users/api/v3/users/introspect',
    refresh: '/users/api/v3/users/refresh',
    sendOtp: '/users/api/v3/users/login/send-otp',
    verifyOtp: '/users/api/v3/users/login/verify-otp',
    forgotPassword: '/users/api/v3/users/forgot-password',
    resetPassword: '/users/api/v3/users/reset-password',
  },

  users: {
    list: '/users/api/v3/users',
    get: (id) => `/users/api/v3/users/${enc(id)}`,
    create: '/users/api/v3/users/create',
    update: (id) => `/users/api/v3/users/${enc(id)}`,
    updatePassword: (id) => `/users/api/v3/users/${enc(id)}/password`,
    remove: (id) => `/users/api/v3/users/${enc(id)}`,
    associated: '/projects/api/v3/associated-users',
  },

  vendors: {
    list: '/master/api/v3/master/vendors',
    get: (id) => `/master/api/v3/master/vendors/${enc(id)}`,
    create: '/master/api/v3/master/vendors/create',
    update: (id) => `/master/api/v3/master/vendors/${enc(id)}`,
    remove: (id) => `/master/api/v3/master/vendors/${enc(id)}`,
    users: (id) => `/master/api/v3/master/vendors/${enc(id)}/users`,
  },

  divisions: {
    list: '/master/api/v3/master/divisions',
  },

  master: {
    divisions: {
      list: '/master/api/v3/master/divisions',
      create: '/master/api/v3/master/divisions/create',
      byCode: (code) => `/master/api/v3/master/divisions/${enc(code)}`,
      restore: (code) => `/master/api/v3/master/divisions/${enc(code)}/restore`,
    },
  },

  resourceTypes: {
    list: '/master/api/v3/master/resource_types',
  },

  priorities: {
    list: '/master/api/v3/master/priorities',
  },

  roles: {
    /* Role catalog used by the Add User form's Role dropdown. Backend
       moved this off the /master tree onto /users — keep this path in
       sync with what the curl in PR review uses. */
    list: '/users/api/v3/roles',
  },

  projects: {
    list: '/projects/api/v3/projects',
    get: (uuid) => `/projects/api/v3/projects/${enc(uuid)}`,
    tree: (uuid) => `/projects/api/v3/projects/${enc(uuid)}/tree`,
    create: '/projects/api/v3/projects/create',
    update: (uuid) => `/projects/api/v3/projects/${enc(uuid)}`,
    remove: (uuid) => `/projects/api/v3/projects/${enc(uuid)}`,
    save: (uuid) => `/projects/api/v3/projects/${enc(uuid)}/save`,
    publish: (uuid) => `/projects/api/v3/projects/${enc(uuid)}/publish`,
    close: (uuid) => `/projects/api/v3/projects/${enc(uuid)}/close`,
    milestones: (uuid) => `/projects/api/v3/projects/${enc(uuid)}/milestones`,
    milestoneCreate: (uuid) => `/projects/api/v3/projects/${enc(uuid)}/milestones/create`,
    auditLogs: (uuid) => `/projects/api/v3/projects/${enc(uuid)}/audit-logs`,
    attachments: (uuid) => `/projects/api/v3/projects/${enc(uuid)}/attachments`,
    discussionFeed: (uuid) => `/projects/api/v3/projects/${enc(uuid)}/discussion-feed`,
    criticalPathDependencies: (uuid) => `/projects/api/v3/projects/${enc(uuid)}/critical-path/dependencies`,
    criticalPathAnalysis: (uuid) => `/projects/api/v3/projects/${enc(uuid)}/critical-path/analysis`,
      teamPage: (uuid) => `/projects/api/v3/projects/${enc(uuid)}/team-page`,
  },

  milestones: {
    update: (id) => `/projects/api/v3/milestones/${enc(id)}`,
    remove: (id) => `/projects/api/v3/milestones/${enc(id)}`,
    activities: (id) => `/projects/api/v3/milestones/${enc(id)}/activities`,
    attachments: (id) => `/projects/api/v3/milestones/${enc(id)}/attachments`,
    comments: (id) => `/projects/api/v3/milestones/${enc(id)}/comments`,
    // Doc 38: single unified create endpoint (legacy /standard, /transactional,
    // /resource/count, /resource/details paths were removed).
    activityCreate: (milestoneId) =>
      `/projects/api/v3/milestones/${enc(milestoneId)}/activities/create`,
  },

  activities: {
    get: (id) => `/projects/api/v3/activities/${enc(id)}`,
    update: (id) => `/projects/api/v3/activities/${enc(id)}`,
    remove: (id) => `/projects/api/v3/activities/${enc(id)}`,
    tasks: (id) => `/projects/api/v3/activities/${enc(id)}/tasks`,
    taskCreate: (id) => `/projects/api/v3/activities/${enc(id)}/tasks/create`,
    attachments: (id) => `/projects/api/v3/activities/${enc(id)}/attachments`,
    comments: (id) => `/projects/api/v3/activities/${enc(id)}/comments`,
  },

  tasks: {
    get: (id) => `/projects/api/v3/tasks/${enc(id)}`,
    update: (id) => `/projects/api/v3/tasks/${enc(id)}`,
    remove: (id) => `/projects/api/v3/tasks/${enc(id)}`,
    subtasks: (id) => `/projects/api/v3/tasks/${enc(id)}/subtasks`,
    subtaskCreate: (id) => `/projects/api/v3/tasks/${enc(id)}/subtasks/create`,
    attachments: (id) => `/projects/api/v3/tasks/${enc(id)}/attachments`,
    comments: (id) => `/projects/api/v3/tasks/${enc(id)}/comments`,
  },

  subtasks: {
    get: (id) => `/projects/api/v3/subtasks/${enc(id)}`,
    update: (id) => `/projects/api/v3/subtasks/${enc(id)}`,
    remove: (id) => `/projects/api/v3/subtasks/${enc(id)}`,
    subtasks: (id) => `/projects/api/v3/subtasks/${enc(id)}/subtasks`,
    subtaskCreate: (id) => `/projects/api/v3/subtasks/${enc(id)}/subtasks/create`,
    attachments: (id) => `/projects/api/v3/subtasks/${enc(id)}/attachments`,
    comments: (id) => `/projects/api/v3/subtasks/${enc(id)}/comments`,
  },

  // Dashboard — stays on monolith, no prefix change (per migration spec).
  dashboard: {
    summary: '/projects/api/v3/dashboard/summary',
    projects: '/projects/api/v3/dashboard/projects',
    project: (uuid) => `/projects/api/v3/dashboard/projects/${enc(uuid)}`,
    projectItems: (uuid) => `/projects/api/v3/dashboard/projects/${enc(uuid)}/items`,
    organisations: '/projects/api/v3/dashboard/organisations',
    organisation: (vendorId) => `/projects/api/v3/dashboard/organisations/${enc(vendorId)}`,
  },

  /* ──────────────────────────────────────────────────────────────────
     Approval Inbox — kept at the bottom and scoped strictly to the
     /approvals/* pages (Concerned Division + Activity Owner inboxes).
     Nothing else in the app should reference these. Move/rename here
     if the gateway path changes; do NOT inline these URLs anywhere.

     The backend exposes these at /api/v3/approval-inbox with no
     service prefix — DO NOT add /activity-workflow/, /users/, or any
     other prefix here.
     ────────────────────────────────────────────────────────────────── */
  approvalInbox: {
    list: '/projects/api/v3/approval-inbox',
    detail: (id) => `/projects/api/v3/approval-inbox/${enc(id)}`,
    transition: (id) => `/projects/api/v3/approval-inbox/${enc(id)}/_transition`,
  },

  /* Meeting Management — the backend exposes a flat /api/meetings path
     (no service prefix). The curl shared by Gaurav on 2026-06-03 is the
     reference contract:
       POST /api/meetings → { title, meetingDate, startTime, endTime,
         description, meetingLink, projectId, milestoneId,
         attendees: [{ userId, participantRole, mandatory }],
         externalAttendees: [{ email }],
         attachments: [{ filename, contentType, content (base64) }]
       } */
  meetings: {
    list: '/api/meetings',
    get: (id) => `/api/meetings/${enc(id)}`,
    create: '/api/meetings',
    mom: (id) => `/api/meetings/${enc(id)}/mom`,
  },
};