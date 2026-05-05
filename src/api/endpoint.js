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
  },

  divisions: {
    list: '/api/v3/divisions',
  },

  resourceTypes: {
    list: '/api/v3/resource_types',
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
    suspend: (uuid) => `/api/v3/projects/${enc(uuid)}/suspend`,
    createVersion: (uuid) => `/api/v3/projects/${enc(uuid)}/versions/create`,
    milestones: (uuid) => `/api/v3/projects/${enc(uuid)}/milestones`,
    milestoneCreate: (uuid) => `/api/v3/projects/${enc(uuid)}/milestones/create`,
  },

  milestones: {
    update: (id) => `/api/v3/milestones/${enc(id)}`,
    remove: (id) => `/api/v3/milestones/${enc(id)}`,
    activities: (id) => `/api/v3/milestones/${enc(id)}/activities`,
    attachments: (id) => `/api/v3/milestones/${enc(id)}/attachments`,
    // endpoint = "standard" | "transactional" | "resource/count" | "resource/details"
    activityCreate: (milestoneId, endpoint) =>
      `/api/v3/milestones/${enc(milestoneId)}/activities/${endpoint}/create`,
  },

  activities: {
    get: (id) => `/api/v3/activities/${enc(id)}`,
    update: (id) => `/api/v3/activities/${enc(id)}`,
    remove: (id) => `/api/v3/activities/${enc(id)}`,
    tasks: (id) => `/api/v3/activities/${enc(id)}/tasks`,
    taskCreate: (id) => `/api/v3/activities/${enc(id)}/tasks/create`,
    attachments: (id) => `/api/v3/activities/${enc(id)}/attachments`,
  },

  tasks: {
    get: (id) => `/api/v3/tasks/${enc(id)}`,
    update: (id) => `/api/v3/tasks/${enc(id)}`,
    remove: (id) => `/api/v3/tasks/${enc(id)}`,
    subtasks: (id) => `/api/v3/tasks/${enc(id)}/subtasks`,
    subtaskCreate: (id) => `/api/v3/tasks/${enc(id)}/subtasks/create`,
    attachments: (id) => `/api/v3/tasks/${enc(id)}/attachments`,
  },

  subtasks: {
    get: (id) => `/api/v3/subtasks/${enc(id)}`,
    update: (id) => `/api/v3/subtasks/${enc(id)}`,
    remove: (id) => `/api/v3/subtasks/${enc(id)}`,
    subtasks: (id) => `/api/v3/subtasks/${enc(id)}/subtasks`,
    subtaskCreate: (id) => `/api/v3/subtasks/${enc(id)}/subtasks/create`,
    attachments: (id) => `/api/v3/subtasks/${enc(id)}/attachments`,
  },
};
