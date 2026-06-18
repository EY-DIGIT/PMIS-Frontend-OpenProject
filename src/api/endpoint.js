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
    /* Authz assignable-users — the candidates that CAN be assigned a given
       role on a project. Backs the Manage Team Organization User dropdowns
       (role = project_admin | project_member). */
    authzAssignableUsers: (projectId, role) =>
      `/users/api/v3/authz/projects/${enc(projectId)}/assignable-users/${enc(role)}`,
    /* Users that can be assigned to a task / subtask, scoped to a vendor.
       Backs the "Assigned To" dropdown in the task / subtask modals. */
    vendorAssignableUsers: (vendorId) =>
      `/users/api/v3/vendors/${enc(vendorId)}/assignable-users`,
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
    /* Finance-module master tables — populate the Cost Type and
       Frequency dropdowns on the project Finance page. Both endpoints
       return active + retired rows; UI filters by `active`.
       NOTE: served by the /master/ gateway (same as vendors/divisions),
       NOT the /projects/ payment-module gateway. */
    costTypes: '/master/api/v3/master/cost-types',
    frequencies: '/master/api/v3/master/frequencies',
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
    /* Team-page candidate dropdown sources. project-owners / project-owner-
       approvers are project-level; activity-members / activity-approvers are
       scoped to a division (pass ?divisionCode=<code>). */
    teamCandidateProjectOwners: (uuid) => `/projects/api/v3/projects/${enc(uuid)}/team-candidates/project-owners`,
    teamCandidateProjectOwnerApprovers: (uuid) => `/projects/api/v3/projects/${enc(uuid)}/team-candidates/project-owner-approvers`,
    teamCandidateActivityMembers: (uuid) => `/projects/api/v3/projects/${enc(uuid)}/team-candidates/activity-members`,
    teamCandidateActivityApprovers: (uuid) => `/projects/api/v3/projects/${enc(uuid)}/team-candidates/activity-approvers`,
    /* Payment / Finance module — full life-cycle for the Finance page
       (Project Cost rows, Payment Terms per phase, QRG, and CCN cap).
       The /payment-page GET is the authoritative read; mutations live
       under /cost-items, /payment-terms, /phases/{n}/qrg and /ccn-cap. */
    paymentPage: (uuid) => `/projects/api/v3/projects/${enc(uuid)}/payment-page`,
    costItems: (uuid) => `/projects/api/v3/projects/${enc(uuid)}/cost-items`,
    paymentTerms: (uuid) => `/projects/api/v3/projects/${enc(uuid)}/payment-terms`,
    qrg: (uuid, phase) => `/projects/api/v3/projects/${enc(uuid)}/phases/${enc(phase)}/qrg`,
    phaseFrequency: (uuid, phase) => `/projects/api/v3/projects/${enc(uuid)}/phases/${enc(phase)}/frequency`,
    ccnCap: (uuid) => `/projects/api/v3/projects/${enc(uuid)}/ccn-cap`,
  },

  /* Payment-module endpoints not scoped to a project. Cost-item and
     payment-term IDs are global UUIDs — PATCH/DELETE go through these. */
  paymentTerms: {
    update: (id) => `/projects/api/v3/payment-terms/${enc(id)}`,
  },
  costItems: {
    update: (id) => `/projects/api/v3/cost-items/${enc(id)}`,
    remove: (id) => `/projects/api/v3/cost-items/${enc(id)}`,
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
    sync: (id) => `/projects/api/v3/approval-inbox/${enc(id)}/_sync`,
  },

  /* ──────────────────────────────────────────────────────────────────
     Activity Workflow service — distinct from /approval-inbox above.
     Lives at /activity-workflow/* (no /api/v3 prefix). Used by the
     ApprovalPanel (workflow toolbar on the activity edit modal) and
     the Concerned Division inbox.

     Flow:
       1. transition          → SUBMIT moves activity to PENDINGATCONCERNEDDIVISION
       2. requestDivisionApproval (multipart) → seeds approver rows
       3. inbox / inboxDetail → division approver pulls their queue + review
       4. parallelVote        → APPROVE / REJECT per approver
     ────────────────────────────────────────────────────────────────── */
  activityWorkflow: {
    transition: '/activity-workflow/activities/process/_transition',
    /* Multipart upload of approval attachments, scoped to a divisionId
       (a concerned-division code, or "OWNER" for the owner stage). Returns
       a documentStoreId that is then referenced in the request-*-approval
       JSON payloads below. */
    documentsUpload: '/activity-workflow/activities/documents/upload',
    requestDivisionApproval: '/activity-workflow/activities/parallel/request-division-approval',
    requestOwnerApproval: '/activity-workflow/activities/parallel/request-owner-approval',
    parallelVote: '/activity-workflow/activities/parallel/vote',
    inbox: '/activity-workflow/activities/inbox',
    inboxDetail: (activityId) => `/activity-workflow/activities/inbox/${enc(activityId)}`,
    /* Purpose-built timeline feed for an activity — ordered VOTE /
       STATE_TRANSITION events with ready title/detail strings. */
    timeline: (activityId) => `/activity-workflow/activities/inbox/${enc(activityId)}/timeline`,
    /* Approval summary — who requested (and when), plus each concerned
       division's + the owner's decision, status and timestamp. Drives the
       date/time labels on the activity workflow graph. */
    approvalStatus: (activityId) => `/activity-workflow/activities/inbox/${enc(activityId)}/approval-summary`,
    auditLogs: (activityId) => `/activity-workflow/activities/audit/ACTIVITY/${enc(activityId)}`,
    /* Parallel gate status — authoritative roll-up of the Concerned
       Division votes. `readyForOwner: true` means every division approved
       and the activity can be forwarded to the Activity Owner. */
    gateStatus: (activityId) => `/activity-workflow/activities/parallel/gate-status/ACTIVITY/${enc(activityId)}`,
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
    list: '/meetings/getAll',
    get: (id) => `/meetings/get/${enc(id)}`,
    create: '/meetings/create',
    update: (id) => `/meetings/update/${enc(id)}`,
    updateStatus: (id) => `/meetings/update-status/${enc(id)}`,
    mom: (id) => `/meetings/mom/create/${enc(id)}`,
    momGet: (id) => `/meetings/mom/get/${enc(id)}`,
    momGetByMeeting: (meetingId) => `/meetings/mom/getByMeeting/${enc(meetingId)}`,
    momUpdateStatus: (momId) => `/meetings/mom/updateStatus/${enc(momId)}`,
  },
};