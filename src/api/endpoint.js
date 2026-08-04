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
    /* SuperAdmin session management (#365). super_admin ONLY — every other
       role gets a 403. Responses on this branch are snake_case:
         GET    sessions        → { user_id, sessions: [{ session_id,
                                    issued_at, last_used_at, expires_at }] }
         POST   revokeAllSessions → { revoked: n }
         DELETE session           → { revoked: 1 }
       Revocation is an instant hard cut — the target's current access
       token stops working immediately. */
    sessions: (userId) => `/users/api/v3/users/${enc(userId)}/sessions`,
    revokeAllSessions: (userId) =>
      `/users/api/v3/users/${enc(userId)}/sessions/revoke-all`,
    session: (userId, sessionId) =>
      `/users/api/v3/users/${enc(userId)}/sessions/${enc(sessionId)}`,
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
    /* Payment-type catalog for the milestone create/edit form's Payment
       Type dropdown. Current values: partial_payment, complete_payment.
       Served by the same /master gateway as the other finance masters. */
    paymentTypes: '/master/api/v3/master/payment-types',
    /* Carry-forward method catalog (8 methods). Each row carries
       { code, name, method: phase|milestone|time, variant: evenly|custom,
       position } — the Finance page groups the picker by method × variant. */
    carryForwardMethods: '/master/api/v3/master/carry-forward-methods',
    /* NOTE: the masters designation catalog that used to live here is gone.
       Planned resources are priced from the leave-management per-contract-
       year rate cards instead — see `designationRates` below. */
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
    config: (uuid) => `/projects/api/v3/projects/${enc(uuid)}/leave-policies`,
    remove: (uuid) => `/projects/api/v3/projects/${enc(uuid)}`,
    save: (uuid) => `/projects/api/v3/projects/${enc(uuid)}/save`,
    publish: (uuid) => `/projects/api/v3/projects/${enc(uuid)}/publish`,
    close: (uuid) => `/projects/api/v3/projects/${enc(uuid)}/close`,
    milestones: (uuid) => `/projects/api/v3/projects/${enc(uuid)}/milestones`,
    milestoneCreate: (uuid) => `/projects/api/v3/projects/${enc(uuid)}/milestones/create`,
    auditLogs: (uuid) => `/projects/api/v3/projects/${enc(uuid)}/audit-logs`,
    attachments: (uuid) => `/projects/api/v3/projects/${enc(uuid)}/attachments`,
    /* Late-start ("Actual Start Date + Remarks") reason documents (#322).
       These are DELIBERATELY separate from the general project attachments
       above — `attachments` excludes them, so each list renders its own
       section. POST is multipart with the form key `files` repeated once
       per file; GET returns only these documents. */
    actualStartAttachments: (uuid) =>
      `/projects/api/v3/projects/${enc(uuid)}/actual-start-attachments`,
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
    paymentPageValidate: (uuid) => `/projects/api/v3/projects/${enc(uuid)}/payment-page/validate`,
    costItems: (uuid) => `/projects/api/v3/projects/${enc(uuid)}/cost-items`,
    paymentTerms: (uuid) => `/projects/api/v3/projects/${enc(uuid)}/payment-terms`,
    /* Carry-forward replaces the old /qrg toggle. A phase carries its
       ENTIRE leftover forward; the body chooses the distribution method:
         { enabled: false }                                   // clear
         { enabled: true, methodCode: "milestone_evenly" }    // evenly / time_*
         { enabled: true, methodCode: "phase_custom",         // custom
           allocationMode: "percent" | "amount",
           allocations: [{ recipientKey, value }, …] }
       methodCode comes from the carry-forward-methods master. Response lands
       in phases[].carryForward (methodCode, leftover, carriedOut, received,
       receivedMilestone, isLastPhase, allocations[]). */
    carryForward: (uuid, phase) => `/projects/api/v3/projects/${enc(uuid)}/phases/${enc(phase)}/carry-forward`,
    /* One-time cost is a project-level pool phases opt into. Body:
         { enabled: false }                              // clear this phase
         { enabled: true, mode: "percent", value: 30 }   // 30% of the pool
         { enabled: true, mode: "amount", value: 15000 } // ₹15,000
       The chronologically last phase auto-absorbs the remainder (can't be
       set). Response lands in phases[].oneTimeAllocated / oneTimeEnabled /
       oneTimeMode / oneTimeValue. Returns the full recomputed page. */
    oneTime: (uuid, phase) => `/projects/api/v3/projects/${enc(uuid)}/phases/${enc(phase)}/one-time`,
    /* Frequency is now a SINGLE project-level setting (drives every
       cycleCount + time-based carry-forward). Body: { frequencyCode }.
       The legacy per-phase route still works but also sets the project
       frequency (the {phase} segment is ignored server-side). */
    frequency: (uuid) => `/projects/api/v3/projects/${enc(uuid)}/frequency`,
    phaseFrequency: (uuid, phase) => `/projects/api/v3/projects/${enc(uuid)}/phases/${enc(phase)}/frequency`,
    ccnCap: (uuid) => `/projects/api/v3/projects/${enc(uuid)}/ccn-cap`,
    /* NOTE: the project-level /planned-resources routes are GONE. Resource
       costing now lives on the ACTIVITY — a resource-based activity carries
       a `resources` allocation array on its create/update body (see the
       activity endpoints), and the finance page reads the resulting cost off
       each payment term's activities[].value. */
  },

  /* Payment-module endpoints not scoped to a project. Cost-item and
     payment-term IDs are global UUIDs — PATCH/DELETE go through these. */
  paymentTerms: {
    update: (id) => `/projects/api/v3/payment-terms/${enc(id)}`,
    /* Per-activity split for partial-payment terms. PATCH body:
       { activities: [{ activityId, percentOfPayment }] } — percents must
       sum to the term's percentOfPayment; an empty list resets to an even
       split. Returns the recomputed term with activities[]. */
    termActivities: (id) => `/projects/api/v3/payment-terms/${enc(id)}/activities`,
  },
  costItems: {
    update: (id) => `/projects/api/v3/cost-items/${enc(id)}`,
    remove: (id) => `/projects/api/v3/cost-items/${enc(id)}`,
  },

  /* ──────────────────────────────────────────────────────────────────
     Role-based document access (#323). Every attachment — project,
     milestone, activity, task or subtask — is PUBLIC by default.
     Superadmin/admin can restrict one to specific role(s); the first
     rule turns the document into a WHITELIST (superadmin/admin, the
     uploader, and holders of a granted role at the document's scope).

     Everyone else stops seeing the document in EVERY list — the server
     filters it out, so the normal attachment views need no "locked"
     state and no changes at all. Only the admin menu below talks to
     these routes.
       GET  access?targetKind=&targetId=  → the target's docs, newest first
       GET  documentAccess(commentId)     → one document's rules
       PUT  documentAccess(commentId)     → { rules: [{ roleName,
                                              organizationId?, division? }] }
                                            (an EMPTY rules array = public)
     ────────────────────────────────────────────────────────────────── */
  documents: {
    access: '/projects/api/v3/documents/access',
    documentAccess: (commentId) => `/projects/api/v3/documents/${enc(commentId)}/access`,
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
   resources: {
    /* Master resource registry (resource service, port 8019 — NOT the
       gateway). `list` takes any subset of { resId, name, emailId,
       designationType, projectId, active, joinedFrom, joinedTo } and
       ANDs them server-side; name/emailId are case-insensitive contains,
       the rest are exact. Omit projectId to get every resource. */
    list: (filters = {}) => {
      const qs = Object.entries(filters)
        .filter(([, v]) => v !== undefined && v !== null && v !== "")
        .map(([k, v]) => `${enc(k)}=${enc(v)}`)
        .join("&");
      return `/api/resources${qs ? `?${qs}` : ""}`;
    },
    /* The resource's currently-active stint, or its most recent one when
       none is active. 404 when the res_id has no stints at all. */
    get: (resId) => `/api/resources/${enc(resId)}`,
    /* Every stint for a res_id, oldest first — one entry per designation
       change or resignation/rejoin. Empty list for an unknown res_id. */
    history: (resId) => `/api/resources/${enc(resId)}/history`,
    /* PUT — edit the resource's own attributes. The body is a fixed subset:
       { name, emailId, designationType, location, rateCardByYear, category,
         categoryDetails, dateOfJoining, lastDate, active }.
       resId / projectId / rateYear / assignment dates are NOT accepted —
       those are set by the upload and the stint machinery. */
    update: (resId) => `/api/resources/${enc(resId)}`,
    /* Bulk import (.xlsx, multipart `file`). Both query params required.
       Responds { totalRows, resourcesStored }. */
    upload: (projectId, organisationId) =>
      `/api/resources/upload?projectId=${enc(projectId)}&organisationId=${enc(organisationId)}`,
    rateCards: (projectId) =>
`/api/resources/rate-cards?projectId=${enc(projectId)}`,
    leaveReport: (employeeId) => `/api/reports/leave/${enc(employeeId)}`,
    // Blank resource-upload template (.xlsx) — same for every project.
    exportTemplate: () => `/api/export/template/resources`,
    // Attendance-upload template (.xlsx) — built for a specific date range.
    attendanceTemplate: (startDate, endDate) =>
      `/api/export/template/attendance?startDate=${enc(startDate)}&endDate=${enc(endDate)}`,
  },

  /* Designation rate cards — the per-role, per-year rate table for a
     project + organisation pair. Served by the same resource service as
     `resources` above (port 8019), NOT the gateway. Both routes need
     BOTH id params; the upload is multipart with a single `file`
     field holding the .xlsx. */
  designationRates: {
    list: (projectId, organisationId) =>
      `/api/designation-rates?projectId=${enc(projectId)}&organisationId=${enc(organisationId)}`,
    /* The project window is required too, as yyyy-MM-dd: the server slices it
       into the Year-1..Year-N bands the sheet's columns are rated against and
       returns the resulting `yearMappings`. Without it there is nothing to
       anchor "Year-1" to. */
    upload: (projectId, organisationId, projectStartDate, projectEndDate) =>
      `/api/designation-rates/upload?projectId=${enc(projectId)}&organisationId=${enc(organisationId)}` +
      `&projectStartDate=${enc(projectStartDate)}&projectEndDate=${enc(projectEndDate)}`,
    /* The Year-1..Year-N bands the project window is sliced into, as
       [{ rateYear, effectiveFrom, effectiveTo }] — the same mapping the
       upload returns, but readable without uploading anything. All four
       params are required; omitting the dates answers 400, so only call it
       once the project window is known. The final band is truncated at
       endDate rather than running a full year. */
    rateYear: (projectId, organisationId, startDate, endDate) =>
      `/api/designation-rates/rate-year?projectId=${enc(projectId)}&organisationId=${enc(organisationId)}` +
      `&startDate=${enc(startDate)}&endDate=${enc(endDate)}`,
    // Blank rate-card upload template (.xlsx) — same for every project, so
    // it takes no query params (unlike the attendance template).
    exportTemplate: () => `/api/export/template/designation-rates`,
  },

  activities: {
    get: (id) => `/projects/api/v3/activities/${enc(id)}`,
    update: (id) => `/projects/api/v3/activities/${enc(id)}`,
    /* Start Activity (#188). Body is optional —
       { actualStartDate: "2026-04-01T00:00:00Z" }, defaulting to now.
       Returns the updated activity (activityStarted: true + the stamped
       actualStartDate). Rejects with 422 + error.message when the activity
       is already started/completed, the project is closed, or a predecessor
       activity isn't complete. "Start" is NOT "submit" — a started activity
       is still not_completed and runs the approval workflow later. */
    start: (id) => `/projects/api/v3/activities/${enc(id)}/start`,
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
    /* Consolidated single-call dashboard endpoints (2026-07). Each returns
       the WHOLE view in one response so the FE stops firing the per-project
       payment-page loop + tickets/meetings/approval-inbox fan-out.
         summaryView       -> Summary view
         projectFull        -> Project view (single-project deep dive)
         organisationView   -> Organization view, All-Orgs mode
         organisationViewById -> Organization view, Single-Org mode (by org id) */
    summaryView: '/projects/api/v3/dashboard/summary-view',
    projectFull: (uuid) => `/projects/api/v3/dashboard/projects/${enc(uuid)}/full`,
    organisationView: '/projects/api/v3/dashboard/organisation-view',
    organisationViewById: (organisationId) => `/projects/api/v3/dashboard/organisations/${enc(organisationId)}/view`,
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

  /* Ticket & SLA Management — the ticket-service is hit DIRECTLY on
     port 8017 (NOT through the gateway). tickets.js builds the absolute
     base (host of API_BASE + :8017, override via VITE_TICKET_API_BASE_URL)
     and prepends it to this path. Reference curl:
       POST http://<host>:8017/ticket-service/tickets
         { requestInfo: { userInfo: { uuid, userName, email,
             roles: [{ code }] } },
           ticket: { category, subCategory, priority, title, description,
             projectId, projectName, activityId, activityName, taskId,
             taskName, parentTicketUuid, assigneeUuid, assigneeName,
             assigneeEmail, baselineRef, contractRef } } */
  tickets: {
    create: '/ticket-service/tickets',
    list: '/ticket-service/tickets',
    get: (uuid) => `/ticket-service/tickets/${enc(uuid)}`,
    /* PATCH — move a ticket to a new workflow state and/or set the
       assignee. Body: { requestInfo, ticket: { status, comment,
       assigneeUuid, assigneeName, assigneeEmail } }. */
    update: (uuid) => `/ticket-service/tickets/${enc(uuid)}`,
    /* Workflow definition (states + allowed actions → nextState + roles)
       and the allowed-actions lookup for a given state. */
    workflow: '/ticket-service/workflow',
    workflowActions: '/ticket-service/workflow/actions',
    escalationLogs: (uuid) => `/ticket-service/escalation/tickets/${enc(uuid)}/logs`,
    /* Escalation matrix — the priority × level → { triggerHours, emails,
       isActive } config. GET lists all rows; PATCH edits one row (body:
       { triggerHours, emails, isActive } — no requestInfo wrapper). */
    escalationMatrix: '/ticket-service/escalation/matrix',
    escalationMatrixItem: (uuid) => `/ticket-service/escalation/matrix/${enc(uuid)}`,
  },
};