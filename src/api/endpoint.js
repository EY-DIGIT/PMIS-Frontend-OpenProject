/* ══════════════════════════════════════════════════════════════════
   src/api/endpoint.js

   Single source of truth for every REST path the frontend calls.
   Organized by resource; dynamic segments are expressed as functions
   so callers can do:  ENDPOINTS.projects.get(uuid)
   ══════════════════════════════════════════════════════════════════ */

const enc = encodeURIComponent;

export const ENDPOINTS = {
  auth: {
    login: '/api/v3/users/login',
    logout: '/api/v3/users/logout',
    me: '/api/v3/users/me',
    introspect: '/api/v3/users/introspect',
    refresh: '/api/v3/users/refresh',
    sendOtp: '/api/v3/users/login/send-otp',
    verifyOtp: '/api/v3/users/login/verify-otp',
    forgotPassword: '/api/v3/users/forgot-password',
    resetPassword: '/api/v3/users/reset-password',
  },

  users: {
    list: '/api/v3/users',
    get: (id) => `/api/v3/users/${enc(id)}`,
    create: '/api/v3/users/create',
    update: (id) => `/api/v3/users/${enc(id)}`,
    updatePassword: (id) => `/api/v3/users/${enc(id)}/password`,
    remove: (id) => `/api/v3/users/${enc(id)}`,
  },

  vendors: {
    list: '/api/v3/vendors',
    get: (id) => `/api/v3/vendors/${enc(id)}`,
    create: '/api/v3/vendors/create',
    update: (id) => `/api/v3/vendors/${enc(id)}`,
    remove: (id) => `/api/v3/vendors/${enc(id)}`,
    users: (id) => `/api/v3/vendors/${enc(id)}/users`,
  },

  divisions: {
    list: '/api/v3/divisions',
  },

  master: {
    divisions: {
      list: '/api/v3/master/divisions',
      create: '/api/v3/master/divisions/create',
      byCode: (code) => `/api/v3/master/divisions/${enc(code)}`,
      restore: (code) => `/api/v3/master/divisions/${enc(code)}/restore`,
    },
  },

  resourceTypes: {
    list: '/api/v3/resource_types',
  },

  priorities: {
    list: '/api/v3/priorities',
  },

  roles: {
    list: '/api/v3/master/roles',
  },

  projects: {
    list: '/api/v3/projects',
    get: (uuid) => `/api/v3/projects/${enc(uuid)}`,
    tree: (uuid) => `/api/v3/projects/${enc(uuid)}/tree`,
    create: '/api/v3/projects/create',
    update: (uuid) => `/api/v3/projects/${enc(uuid)}`,
    remove: (uuid) => `/api/v3/projects/${enc(uuid)}`,
    save: (uuid) => `/api/v3/projects/${enc(uuid)}/save`,
    publish: (uuid) => `/api/v3/projects/${enc(uuid)}/publish`,
    close: (uuid) => `/api/v3/projects/${enc(uuid)}/close`,
    milestones: (uuid) => `/api/v3/projects/${enc(uuid)}/milestones`,
    milestoneCreate: (uuid) => `/api/v3/projects/${enc(uuid)}/milestones/create`,
    auditLogs: (uuid) => `/api/v3/projects/${enc(uuid)}/audit-logs`,
    attachments: (uuid) => `/api/v3/projects/${enc(uuid)}/attachments`,
  },

  milestones: {
    update: (id) => `/api/v3/milestones/${enc(id)}`,
    remove: (id) => `/api/v3/milestones/${enc(id)}`,
    activities: (id) => `/api/v3/milestones/${enc(id)}/activities`,
    attachments: (id) => `/api/v3/milestones/${enc(id)}/attachments`,
    comments: (id) => `/api/v3/milestones/${enc(id)}/comments`,
    // Doc 38: single unified create endpoint (legacy /standard, /transactional,
    // /resource/count, /resource/details paths were removed).
    activityCreate: (milestoneId) =>
      `/api/v3/milestones/${enc(milestoneId)}/activities/create`,
  },

  activities: {
    get: (id) => `/api/v3/activities/${enc(id)}`,
    update: (id) => `/api/v3/activities/${enc(id)}`,
    remove: (id) => `/api/v3/activities/${enc(id)}`,
    tasks: (id) => `/api/v3/activities/${enc(id)}/tasks`,
    taskCreate: (id) => `/api/v3/activities/${enc(id)}/tasks/create`,
    attachments: (id) => `/api/v3/activities/${enc(id)}/attachments`,
    comments: (id) => `/api/v3/activities/${enc(id)}/comments`,
  },

  tasks: {
    get: (id) => `/api/v3/tasks/${enc(id)}`,
    update: (id) => `/api/v3/tasks/${enc(id)}`,
    remove: (id) => `/api/v3/tasks/${enc(id)}`,
    subtasks: (id) => `/api/v3/tasks/${enc(id)}/subtasks`,
    subtaskCreate: (id) => `/api/v3/tasks/${enc(id)}/subtasks/create`,
    attachments: (id) => `/api/v3/tasks/${enc(id)}/attachments`,
    comments: (id) => `/api/v3/tasks/${enc(id)}/comments`,
  },

  subtasks: {
    get: (id) => `/api/v3/subtasks/${enc(id)}`,
    update: (id) => `/api/v3/subtasks/${enc(id)}`,
    remove: (id) => `/api/v3/subtasks/${enc(id)}`,
    subtasks: (id) => `/api/v3/subtasks/${enc(id)}/subtasks`,
    subtaskCreate: (id) => `/api/v3/subtasks/${enc(id)}/subtasks/create`,
    attachments: (id) => `/api/v3/subtasks/${enc(id)}/attachments`,
    comments: (id) => `/api/v3/subtasks/${enc(id)}/comments`,
  },

  // Admin-only dashboard endpoints. Live on the monolith starting 2026-05-09.
  // See app/api/v3/dashboard/schemas.py for canonical response shapes.
  dashboard: {
    summary: '/api/v3/dashboard/summary',
    projects: '/api/v3/dashboard/projects',
    project: (uuid) => `/api/v3/dashboard/projects/${enc(uuid)}`,
    projectItems: (uuid) => `/api/v3/dashboard/projects/${enc(uuid)}/items`,
    organisations: '/api/v3/dashboard/organisations',
    organisation: (vendorId) => `/api/v3/dashboard/organisations/${enc(vendorId)}`,
  },
};
