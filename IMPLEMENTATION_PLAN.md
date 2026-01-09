# OpenProject Standalone Frontend - Implementation Plan

**Date:** January 5, 2026
**Based on:** Cloud API Audit + Original OpenProject Feature Analysis

---

## Executive Summary

This plan outlines the implementation of a standalone OpenProject frontend that connects to the Cloud API at `http://13.201.75.232:8000`. The goal is to achieve feature parity with the original OpenProject while working within the constraints of available API endpoints.

---

## Feature Comparison Matrix

| Feature | Original OpenProject | Cloud API Support | Implementation Status |
|---------|---------------------|-------------------|----------------------|
| **Projects** | Full CRUD, Members, Modules | Full CRUD | To Implement |
| **Work Packages** | Full CRUD, Relations, Watchers | CRUD (via project) | To Implement |
| **Users** | Full CRUD, Invite, Groups | Full CRUD | To Implement |
| **Roles** | Full CRUD, Permissions | Full CRUD | To Implement |
| **Work Package Types** | Full CRUD | GET + POST | To Implement |
| **Statuses** | Full CRUD | GET only (mock) | Partial |
| **Priorities** | Full CRUD | GET only (mock) | Partial |
| **Boards (Kanban)** | Drag-drop, Filters | Via WP API | To Implement |
| **Gantt Chart** | Timeline, Dependencies | Via WP API | To Implement |
| **Calendar** | WP + Time Entries | Via WP API | To Implement |
| **Team Planner** | Resource Planning | Via Users + WP | To Implement |
| **Time Tracking** | Full CRUD | GET only (mock) | Limited |
| **Attachments** | Upload, Download, Delete | Not Available | Cannot Implement |
| **Meetings** | Full CRUD | Not Available | Cannot Implement |
| **Wiki** | Full CRUD | Not Available | Cannot Implement |
| **News** | Full CRUD | Not Available | Cannot Implement |
| **Notifications** | Full System | GET only (mock) | Limited |

---

## Implementation Phases

### Phase 1: Core CRUD Operations (Priority: HIGH)

#### 1.1 Projects Module - Full CRUD
**Components:**
- Project List (Grid + Table view)
- Project Create Modal
- Project Edit Modal
- Project Delete Confirmation
- Project Detail View
- Project Settings

**API Endpoints Used:**
```
GET    /api/v3/projects           - List all
GET    /api/v3/projects/{id}      - Get single
POST   /api/v3/projects           - Create
PATCH  /api/v3/projects/{id}      - Update
DELETE /api/v3/projects/{id}      - Delete
```

**Fields:**
- name (required)
- identifier (required, unique)
- description
- public (boolean)
- active (boolean)
- statusExplanation

---

#### 1.2 Work Packages Module - Full CRUD
**Components:**
- Work Package Table View
- Work Package Card/Board View
- Work Package Create Modal
- Work Package Edit Modal (Split View)
- Work Package Delete Confirmation
- Work Package Detail View
- Inline Status Change
- Inline Assignee Change
- Progress (doneRatio) Editor

**API Endpoints Used:**
```
GET    /api/v3/projects/{id}/work_packages  - List by project
GET    /api/v3/work_packages/{id}           - Get single
POST   /api/v3/projects/{id}/work_packages  - Create
PATCH  /api/v3/work_packages/{id}           - Update
DELETE /api/v3/work_packages/{id}           - Delete
```

**Fields:**
- subject (required)
- description
- typeId
- status (new, in_progress, closed, on_hold, rejected)
- priority (low, normal, high, urgent)
- assigneeId
- parentId (for subtasks)
- doneRatio (0-100)
- startDate
- dueDate
- estimatedTime

---

#### 1.3 Users Module - Full CRUD
**Components:**
- User List (Table)
- User Create Modal
- User Edit Modal
- User Delete Confirmation
- User Profile View
- User Status Toggle (active/locked)

**API Endpoints Used:**
```
GET    /api/v3/users           - List all
GET    /api/v3/users/{id}      - Get single
POST   /api/v3/users           - Create
PATCH  /api/v3/users/{id}      - Update
DELETE /api/v3/users/{id}      - Delete
```

**Fields:**
- login (required, unique)
- firstName (required)
- lastName (required)
- email (required)
- password (required for create)
- admin (boolean)
- status (active, locked)

---

#### 1.4 Roles Module - Full CRUD
**Components:**
- Role List
- Role Create Modal
- Role Edit Modal
- Role Delete Confirmation
- Permission Checkboxes

**API Endpoints Used:**
```
GET    /api/v3/roles           - List all
GET    /api/v3/roles/{id}      - Get single
POST   /api/v3/roles           - Create
PATCH  /api/v3/roles/{id}      - Update
DELETE /api/v3/roles/{id}      - Delete
```

**Fields:**
- name (required)
- permissions (array of strings)

---

### Phase 2: Enhanced Views (Priority: MEDIUM)

#### 2.1 Kanban Board View
**Features:**
- Columns by Status (New, In Progress, Closed, etc.)
- Drag-and-drop cards between columns
- Card quick actions (edit, delete)
- Filter by project, assignee, type
- Card details on hover/click

**Implementation:**
- Use existing work packages API
- Group by status field
- PATCH to update status on drop

---

#### 2.2 Gantt Chart View
**Features:**
- Timeline visualization
- Work package bars with start/due dates
- Milestone markers
- Drag to change dates
- Zoom levels (day, week, month)

**Implementation:**
- Use dhtmlx-gantt or similar library
- Map work packages to gantt tasks
- PATCH to update dates on drag

---

#### 2.3 Calendar View
**Features:**
- Monthly/Weekly/Daily views
- Work packages as events (by due date)
- Click to view/edit work package
- Color by type or status

**Implementation:**
- Use FullCalendar library
- Map work packages to calendar events
- Filter by project

---

#### 2.4 Team Planner View
**Features:**
- User rows with assigned work packages
- Timeline view per user
- Workload visualization
- Assignment via drag-drop

**Implementation:**
- Fetch users and their assigned work packages
- Display as resource timeline

---

### Phase 3: Additional Features (Priority: LOWER)

#### 3.1 Work Package Relations
**Note:** Requires backend API support

**Features:**
- Parent-Child hierarchy (already supported via parentId)
- Predecessor/Successor (blocked by, blocks)
- Related work packages

---

#### 3.2 Activity/Comments
**Note:** Requires `/api/v3/work_packages/{id}/activities` endpoint

**Features:**
- Activity timeline on work package detail
- Add comments
- Track changes

---

#### 3.3 Work Package Types Management
**Components:**
- Type List
- Type Create Form
- Type Color/Icon selection

**API Endpoints:**
```
GET    /api/v3/work_package_types     - List all
POST   /api/v3/work_package_types     - Create
```

---

#### 3.4 Dashboard/My Page
**Features:**
- Work packages assigned to me
- Recently updated work packages
- Project statistics
- Quick actions

---

## UI Component Architecture

### Layout Structure
```
┌─────────────────────────────────────────────────────────────┐
│                        HEADER                                │
│  [Logo] [Home] [Projects] [Work Packages] [Calendar]  [User]│
├──────────────┬──────────────────────────────────────────────┤
│              │                                              │
│   SIDEBAR    │              CONTENT AREA                    │
│              │                                              │
│  - Home      │  ┌────────────────────────────────────────┐ │
│  - Projects  │  │  PAGE HEADER                           │ │
│  - WPs       │  │  [Title]              [Actions]        │ │
│  - Calendar  │  ├────────────────────────────────────────┤ │
│  - Boards    │  │                                        │ │
│  - Gantt     │  │  PAGE CONTENT                          │ │
│  - Team      │  │                                        │ │
│  - Time      │  │  (Table, Cards, Forms, etc.)           │ │
│              │  │                                        │ │
│  ADMIN       │  │                                        │ │
│  - Users     │  │                                        │ │
│  - Roles     │  │                                        │ │
│  - Types     │  │                                        │ │
│  - Statuses  │  │                                        │ │
│              │  └────────────────────────────────────────┘ │
└──────────────┴──────────────────────────────────────────────┘
```

### Modal System
```
┌─────────────────────────────────────────┐
│  MODAL OVERLAY (dark background)        │
│  ┌───────────────────────────────────┐  │
│  │  MODAL HEADER                     │  │
│  │  [Title]                    [X]   │  │
│  ├───────────────────────────────────┤  │
│  │                                   │  │
│  │  MODAL BODY                       │  │
│  │  (Form fields, content)           │  │
│  │                                   │  │
│  ├───────────────────────────────────┤  │
│  │  MODAL FOOTER                     │  │
│  │           [Cancel] [Save/Submit]  │  │
│  └───────────────────────────────────┘  │
└─────────────────────────────────────────┘
```

### Split View (Work Package Detail)
```
┌─────────────────────────────────────────────────────────────┐
│                        HEADER                                │
├──────────────┬──────────────────────┬───────────────────────┤
│              │                      │                       │
│   SIDEBAR    │    TABLE VIEW        │   DETAIL PANEL        │
│              │                      │                       │
│              │  ┌────────────────┐  │  ┌─────────────────┐  │
│              │  │ #1 Task A      │  │  │ #1 Task A       │  │
│              │  │ #2 Task B  <── │──│──│                 │  │
│              │  │ #3 Task C      │  │  │ Subject: ...    │  │
│              │  │ #4 Task D      │  │  │ Status: ...     │  │
│              │  │ #5 Task E      │  │  │ Assignee: ...   │  │
│              │  └────────────────┘  │  │ Description:    │  │
│              │                      │  │ ...             │  │
│              │                      │  │                 │  │
│              │                      │  │ [Save] [Cancel] │  │
│              │                      │  └─────────────────┘  │
└──────────────┴──────────────────────┴───────────────────────┘
```

---

## JavaScript Architecture

### State Management
```javascript
const STATE = {
  // Auth
  user: null,
  isAuthenticated: false,

  // Data
  projects: [],
  workPackages: [],
  users: [],
  roles: [],
  types: [],
  statuses: [],
  priorities: [],

  // UI State
  currentPage: 'home',
  currentProject: null,
  selectedWorkPackage: null,
  filters: {},
  sortBy: null,
  sortOrder: 'asc',

  // Loading States
  loading: {
    projects: false,
    workPackages: false,
    users: false
  }
};
```

### API Module
```javascript
const API = {
  baseUrl: '/api/v3',

  // Generic methods
  async get(endpoint) { ... },
  async post(endpoint, data) { ... },
  async patch(endpoint, data) { ... },
  async delete(endpoint) { ... },

  // Projects
  projects: {
    list: () => API.get('/projects'),
    get: (id) => API.get(`/projects/${id}`),
    create: (data) => API.post('/projects', data),
    update: (id, data) => API.patch(`/projects/${id}`, data),
    delete: (id) => API.delete(`/projects/${id}`),
    workPackages: (id) => API.get(`/projects/${id}/work_packages`)
  },

  // Work Packages
  workPackages: {
    get: (id) => API.get(`/work_packages/${id}`),
    create: (projectId, data) => API.post(`/projects/${projectId}/work_packages`, data),
    update: (id, data) => API.patch(`/work_packages/${id}`, data),
    delete: (id) => API.delete(`/work_packages/${id}`)
  },

  // Users
  users: {
    list: () => API.get('/users'),
    get: (id) => API.get(`/users/${id}`),
    create: (data) => API.post('/users', data),
    update: (id, data) => API.patch(`/users/${id}`, data),
    delete: (id) => API.delete(`/users/${id}`)
  },

  // Roles
  roles: {
    list: () => API.get('/roles'),
    create: (data) => API.post('/roles', data),
    update: (id, data) => API.patch(`/roles/${id}`, data),
    delete: (id) => API.delete(`/roles/${id}`)
  }
};
```

### Event System
```javascript
const Events = {
  emit(event, data) { ... },
  on(event, callback) { ... },
  off(event, callback) { ... }
};

// Events
// - project:created, project:updated, project:deleted
// - workPackage:created, workPackage:updated, workPackage:deleted
// - user:created, user:updated, user:deleted
// - navigation:changed
// - modal:opened, modal:closed
// - toast:show
```

---

## Implementation Checklist

### Phase 1: Core CRUD
- [ ] Projects
  - [ ] List view with grid layout
  - [ ] Create modal with validation
  - [ ] Edit modal
  - [ ] Delete with confirmation
  - [ ] Detail page with work packages
  - [ ] Settings (name, description, status)

- [ ] Work Packages
  - [ ] Table view with sorting
  - [ ] Create modal with all fields
  - [ ] Edit modal / Split view
  - [ ] Delete with confirmation
  - [ ] Status dropdown inline edit
  - [ ] Assignee dropdown inline edit
  - [ ] Progress bar editor
  - [ ] Filter by status, type, assignee
  - [ ] Search by subject

- [ ] Users
  - [ ] Table view
  - [ ] Create modal
  - [ ] Edit modal
  - [ ] Delete with confirmation
  - [ ] Status toggle (active/locked)
  - [ ] Admin badge

- [ ] Roles
  - [ ] List view
  - [ ] Create modal with permissions
  - [ ] Edit modal
  - [ ] Delete with confirmation

### Phase 2: Enhanced Views
- [ ] Kanban Board
  - [ ] Status columns
  - [ ] Drag-and-drop
  - [ ] Card rendering
  - [ ] Quick actions

- [ ] Gantt Chart
  - [ ] Timeline rendering
  - [ ] Work package bars
  - [ ] Date editing
  - [ ] Zoom controls

- [ ] Calendar
  - [ ] Monthly view
  - [ ] Work package events
  - [ ] Click to edit

- [ ] Team Planner
  - [ ] User resource rows
  - [ ] Assignment view

### Phase 3: Polish
- [ ] Loading states
- [ ] Error handling
- [ ] Empty states
- [ ] Keyboard shortcuts
- [ ] Responsive design
- [ ] Accessibility

---

## File Structure

```
standalone/
├── index.html              # Main HTML with all components
├── server.js               # Node.js proxy server
├── dist/                   # Built Angular files (for assets)
├── CLOUD_API_AUDIT.md     # API documentation
├── IMPLEMENTATION_PLAN.md  # This file
└── README.md              # Usage instructions
```

---

## Dependencies

### Required (included via CDN or inline)
- None (pure vanilla JavaScript)

### Optional (for enhanced features)
- **Gantt Chart:** dhtmlx-gantt or frappe-gantt
- **Calendar:** FullCalendar
- **Drag-Drop:** SortableJS or native HTML5 DnD
- **Charts:** Chart.js (for dashboards)
- **Date Picker:** Flatpickr

---

## Next Steps

1. **Implement Phase 1** - Full CRUD for all entities
2. **Test thoroughly** - All create, read, update, delete operations
3. **Add Phase 2 features** - Enhanced views
4. **Polish and optimize** - Loading states, error handling
5. **Document** - Usage instructions

---

*Implementation Plan created January 5, 2026*
