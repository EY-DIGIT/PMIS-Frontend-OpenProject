# Cloud API Audit Report

**Date:** January 5, 2026
**Cloud API URL:** http://13.201.75.232:8000
**Local Proxy:** http://localhost:4200/api/v3
**Authentication:** JWT (admin/admin123)

---

## Table of Contents

1. [Executive Summary](#executive-summary)
2. [Working APIs (Full CRUD)](#working-apis-full-crud)
3. [Working APIs (Read Only)](#working-apis-read-only)
4. [Non-Working APIs](#non-working-apis)
5. [APIs Needed for OpenProject Feature Parity](#apis-needed-for-openproject-feature-parity)
6. [Data Structure Reference](#data-structure-reference)

---

## Executive Summary

| Category | Count |
|----------|-------|
| Fully Working APIs (CRUD) | 6 |
| Read-Only APIs | 7 |
| Not Available APIs | 8 |
| APIs Needed for Full Features | 15+ |

---

## Working APIs (Full CRUD)

### 1. Projects API

**Endpoint:** `/api/v3/projects`

#### GET - List All Projects
```bash
curl -X GET "http://localhost:4200/api/v3/projects"
```

**Response:**
```json
{
  "data": {
    "_type": "Collection",
    "total": 9,
    "count": 9,
    "_embedded": {
      "elements": [
        {
          "_type": "Project",
          "id": 1,
          "identifier": "op0001",
          "name": "Test Project - KAMAL",
          "description": "created for testing",
          "active": true,
          "public": true,
          "statusExplanation": "string",
          "createdAt": "2025-12-17T13:23:44.912742",
          "updatedAt": "2025-12-17T13:23:44.912742"
        }
      ]
    }
  },
  "status": 200
}
```

#### GET - Single Project
```bash
curl -X GET "http://localhost:4200/api/v3/projects/1"
```

**Response:**
```json
{
  "data": {
    "_type": "Project",
    "id": 1,
    "identifier": "op0001",
    "name": "Test Project - KAMAL",
    "description": "created for testing",
    "active": true,
    "public": true
  },
  "status": 200
}
```

#### POST - Create Project
```bash
curl -X POST "http://localhost:4200/api/v3/projects" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "New Project",
    "identifier": "new-project-001",
    "description": "Project description",
    "public": false
  }'
```

**Response:**
```json
{
  "data": {
    "_type": "Project",
    "id": 11,
    "identifier": "new-project-001",
    "name": "New Project",
    "description": "Project description",
    "active": true,
    "public": false,
    "createdAt": "2026-01-04T19:14:51.855864"
  },
  "status": 201
}
```

#### PATCH - Update Project
```bash
curl -X PATCH "http://localhost:4200/api/v3/projects/1" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Updated Project Name",
    "description": "Updated description"
  }'
```

**Response:**
```json
{
  "data": {
    "_type": "Project",
    "id": 1,
    "name": "Updated Project Name",
    "description": "Updated description",
    "updatedAt": "2026-01-04T19:14:52.191521"
  },
  "status": 200
}
```

#### DELETE - Delete Project
```bash
curl -X DELETE "http://localhost:4200/api/v3/projects/11"
```

**Response:** Empty (204 No Content)

---

### 2. Work Packages API

**Endpoint:** `/api/v3/projects/{project_id}/work_packages`

> **Important:** Global `/api/v3/work_packages` does NOT work. Must use project-scoped endpoint.

#### GET - List Project Work Packages
```bash
curl -X GET "http://localhost:4200/api/v3/projects/1/work_packages"
```

**Response:**
```json
{
  "data": {
    "_type": "Collection",
    "total": 2,
    "count": 2,
    "_embedded": {
      "elements": [
        {
          "_type": "WorkPackage",
          "id": 1,
          "subject": "Creating Task",
          "description": "Main task",
          "projectId": 1,
          "parentId": null,
          "assigneeId": 2,
          "typeId": 1,
          "status": "new",
          "priority": "high",
          "doneRatio": 0,
          "createdAt": "2025-12-18T09:02:15.730201",
          "_links": {
            "project": { "href": "/api/v3/projects/1" },
            "assignee": { "href": "/api/v3/users/2" },
            "type": { "href": "/api/v3/work_package_types/1" }
          }
        }
      ]
    }
  },
  "status": 200
}
```

#### GET - Single Work Package
```bash
curl -X GET "http://localhost:4200/api/v3/work_packages/1"
```

**Response:**
```json
{
  "data": {
    "_type": "WorkPackage",
    "id": 1,
    "subject": "Creating Task",
    "description": "Main task",
    "projectId": 1,
    "parentId": null,
    "assigneeId": 2,
    "typeId": 1,
    "status": "new",
    "priority": "high",
    "doneRatio": 0
  },
  "status": 200
}
```

#### POST - Create Work Package
```bash
curl -X POST "http://localhost:4200/api/v3/projects/1/work_packages" \
  -H "Content-Type: application/json" \
  -d '{
    "subject": "New Task",
    "description": "Task description",
    "typeId": 1,
    "priority": "normal",
    "assigneeId": 2
  }'
```

**Response:**
```json
{
  "data": {
    "_type": "WorkPackage",
    "id": 3,
    "subject": "New Task",
    "description": "Task description",
    "projectId": 1,
    "typeId": 1,
    "status": "new",
    "priority": "normal",
    "createdAt": "2026-01-04T19:14:52.726312"
  },
  "status": 201
}
```

#### PATCH - Update Work Package
```bash
curl -X PATCH "http://localhost:4200/api/v3/work_packages/1" \
  -H "Content-Type: application/json" \
  -d '{
    "subject": "Updated Task",
    "status": "in_progress",
    "doneRatio": 50
  }'
```

**Response:**
```json
{
  "data": {
    "_type": "WorkPackage",
    "id": 1,
    "subject": "Updated Task",
    "status": "in_progress",
    "doneRatio": 50,
    "updatedAt": "2026-01-04T19:15:04.228055"
  },
  "status": 200
}
```

#### DELETE - Delete Work Package
```bash
curl -X DELETE "http://localhost:4200/api/v3/work_packages/3"
```

**Response:** Empty (204 No Content)

---

### 3. Users API

**Endpoint:** `/api/v3/users`

#### GET - List All Users
```bash
curl -X GET "http://localhost:4200/api/v3/users"
```

**Response:**
```json
{
  "data": {
    "_type": "Collection",
    "total": 3,
    "count": 3,
    "_embedded": {
      "elements": [
        {
          "_type": "User",
          "id": 1,
          "login": "admin",
          "firstName": "Administrator",
          "lastName": "System",
          "email": "admin@example.com",
          "admin": true,
          "status": "active",
          "createdAt": "2025-12-17T13:03:08.536780"
        },
        {
          "_type": "User",
          "id": 2,
          "login": "kamal",
          "firstName": "kamal",
          "lastName": "nanda",
          "email": "kamalnanda01@gmail.com",
          "admin": true,
          "status": "active"
        }
      ]
    }
  },
  "status": 200
}
```

#### GET - Single User
```bash
curl -X GET "http://localhost:4200/api/v3/users/1"
```

**Response:**
```json
{
  "data": {
    "_type": "User",
    "id": 1,
    "login": "admin",
    "firstName": "Administrator",
    "lastName": "System",
    "email": "admin@example.com",
    "admin": true,
    "status": "active"
  },
  "status": 200
}
```

#### POST - Create User
```bash
curl -X POST "http://localhost:4200/api/v3/users" \
  -H "Content-Type: application/json" \
  -d '{
    "login": "newuser",
    "firstName": "New",
    "lastName": "User",
    "email": "newuser@example.com",
    "password": "SecurePass123"
  }'
```

**Response:**
```json
{
  "data": {
    "_type": "User",
    "id": 4,
    "login": "newuser",
    "firstName": "New",
    "lastName": "User",
    "email": "newuser@example.com",
    "admin": false,
    "status": "active",
    "createdAt": "2026-01-04T19:15:04.046484"
  },
  "status": 201
}
```

#### PATCH - Update User
```bash
curl -X PATCH "http://localhost:4200/api/v3/users/4" \
  -H "Content-Type: application/json" \
  -d '{
    "firstName": "Updated",
    "lastName": "Name"
  }'
```

**Response:**
```json
{
  "data": {
    "_type": "User",
    "id": 4,
    "firstName": "Updated",
    "lastName": "Name",
    "updatedAt": "2026-01-04T19:15:17.163706"
  },
  "status": 200
}
```

#### DELETE - Delete User
```bash
curl -X DELETE "http://localhost:4200/api/v3/users/4"
```

**Response:**
```json
{
  "data": {
    "_type": "Success",
    "message": "User 4 deleted successfully"
  },
  "status": 200
}
```

---

### 4. Roles API

**Endpoint:** `/api/v3/roles`

#### GET - List All Roles
```bash
curl -X GET "http://localhost:4200/api/v3/roles"
```

**Response:**
```json
{
  "data": {
    "_type": "Collection",
    "total": 1,
    "count": 1,
    "_embedded": {
      "elements": [
        {
          "_type": "Role",
          "id": 1,
          "name": "Developer",
          "permissions": ["projects:view", "projects:edit"],
          "builtin": false,
          "createdAt": "2025-12-17T13:28:45.512322"
        }
      ]
    }
  },
  "status": 200
}
```

#### POST - Create Role
```bash
curl -X POST "http://localhost:4200/api/v3/roles" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Tester",
    "permissions": ["projects:view", "work_packages:view"]
  }'
```

**Response:**
```json
{
  "data": {
    "_type": "Role",
    "id": 2,
    "name": "Tester",
    "permissions": ["projects:view", "work_packages:view"],
    "builtin": false,
    "createdAt": "2026-01-04T19:15:16.938143"
  },
  "status": 201
}
```

#### PATCH - Update Role
```bash
curl -X PATCH "http://localhost:4200/api/v3/roles/1" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Senior Developer",
    "permissions": ["projects:view", "projects:edit", "projects:delete"]
  }'
```

**Response:**
```json
{
  "data": {
    "_type": "Role",
    "id": 1,
    "name": "Senior Developer",
    "permissions": ["projects:view", "projects:edit", "projects:delete"],
    "updatedAt": "2026-01-04T19:15:37.919511"
  },
  "status": 200
}
```

#### DELETE - Delete Role
```bash
curl -X DELETE "http://localhost:4200/api/v3/roles/2"
```

**Response:** Empty (204 No Content)

---

### 5. Work Package Types API

**Endpoint:** `/api/v3/work_package_types`

#### GET - List All Types
```bash
curl -X GET "http://localhost:4200/api/v3/work_package_types"
```

**Response:**
```json
{
  "data": {
    "_type": "Collection",
    "total": 6,
    "count": 6,
    "_embedded": {
      "elements": [
        {
          "_type": "WorkPackageType",
          "id": 1,
          "name": "Task",
          "internalName": "task",
          "isBuiltin": true,
          "isActive": true,
          "position": 1
        },
        {
          "_type": "WorkPackageType",
          "id": 2,
          "name": "Bug",
          "internalName": "bug",
          "isBuiltin": true,
          "isActive": true,
          "position": 2
        },
        {
          "_type": "WorkPackageType",
          "id": 3,
          "name": "Feature",
          "internalName": "feature",
          "isBuiltin": true,
          "isActive": true,
          "position": 3
        },
        {
          "_type": "WorkPackageType",
          "id": 4,
          "name": "Milestone",
          "internalName": "milestone",
          "isBuiltin": true,
          "isActive": true,
          "position": 4
        },
        {
          "_type": "WorkPackageType",
          "id": 5,
          "name": "Phase",
          "internalName": "phase",
          "isBuiltin": true,
          "isActive": true,
          "position": 5
        },
        {
          "_type": "WorkPackageType",
          "id": 6,
          "name": "Epic",
          "internalName": "epic",
          "isBuiltin": false,
          "isActive": true,
          "position": 6
        }
      ]
    }
  },
  "status": 200
}
```

#### POST - Create Type
```bash
curl -X POST "http://localhost:4200/api/v3/work_package_types" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Story",
    "internalName": "story",
    "isActive": true
  }'
```

**Response:**
```json
{
  "data": {
    "_type": "WorkPackageType",
    "id": 7,
    "name": "Story",
    "internalName": "story",
    "isBuiltin": false,
    "isActive": true
  },
  "status": 201
}
```

**Error Response (Duplicate):**
```json
{
  "data": null,
  "error": {
    "message": "Type with internal name 'epic' already exists",
    "type": "already_exists"
  },
  "status": 409
}
```

---

## Working APIs (Read Only)

These endpoints work but only support GET operations. They return mock data from the Node.js proxy server.

### 1. Statuses API

**Endpoint:** `/api/v3/statuses`

```bash
curl -X GET "http://localhost:4200/api/v3/statuses"
```

**Response:**
```json
{
  "_type": "Collection",
  "total": 5,
  "count": 5,
  "_embedded": {
    "elements": [
      {
        "_type": "Status",
        "id": 1,
        "name": "New",
        "color": "#1A67A3",
        "isDefault": true,
        "isClosed": false,
        "position": 1
      },
      {
        "_type": "Status",
        "id": 2,
        "name": "In Progress",
        "color": "#CC5DE8",
        "isDefault": false,
        "isClosed": false,
        "position": 2
      },
      {
        "_type": "Status",
        "id": 3,
        "name": "Closed",
        "color": "#82C91E",
        "isDefault": false,
        "isClosed": true,
        "position": 3
      },
      {
        "_type": "Status",
        "id": 4,
        "name": "On Hold",
        "color": "#FAB005",
        "isDefault": false,
        "isClosed": false,
        "position": 4
      },
      {
        "_type": "Status",
        "id": 5,
        "name": "Rejected",
        "color": "#E03131",
        "isDefault": false,
        "isClosed": true,
        "position": 5
      }
    ]
  }
}
```

---

### 2. Priorities API

**Endpoint:** `/api/v3/priorities`

```bash
curl -X GET "http://localhost:4200/api/v3/priorities"
```

**Response:**
```json
{
  "_type": "Collection",
  "total": 4,
  "count": 4,
  "_embedded": {
    "elements": [
      {
        "_type": "Priority",
        "id": 1,
        "name": "Low",
        "color": "#82C91E",
        "position": 1,
        "isDefault": false,
        "isActive": true
      },
      {
        "_type": "Priority",
        "id": 2,
        "name": "Normal",
        "color": "#1A67A3",
        "position": 2,
        "isDefault": true,
        "isActive": true
      },
      {
        "_type": "Priority",
        "id": 3,
        "name": "High",
        "color": "#FAB005",
        "position": 3,
        "isDefault": false,
        "isActive": true
      },
      {
        "_type": "Priority",
        "id": 4,
        "name": "Urgent",
        "color": "#E03131",
        "position": 4,
        "isDefault": false,
        "isActive": true
      }
    ]
  }
}
```

---

### 3. Activities API

**Endpoint:** `/api/v3/activities`

```bash
curl -X GET "http://localhost:4200/api/v3/activities"
```

**Response:**
```json
{
  "_type": "Collection",
  "total": 0,
  "count": 0,
  "_embedded": {
    "elements": []
  }
}
```

---

### 4. Versions API

**Endpoint:** `/api/v3/versions`

```bash
curl -X GET "http://localhost:4200/api/v3/versions"
```

**Response:**
```json
{
  "_type": "Collection",
  "total": 0,
  "count": 0,
  "_embedded": {
    "elements": []
  }
}
```

---

### 5. Time Entries API

**Endpoint:** `/api/v3/time_entries`

```bash
curl -X GET "http://localhost:4200/api/v3/time_entries"
```

**Response:**
```json
{
  "_type": "Collection",
  "total": 0,
  "count": 0,
  "_embedded": {
    "elements": []
  }
}
```

---

### 6. Queries API

**Endpoint:** `/api/v3/queries`

```bash
curl -X GET "http://localhost:4200/api/v3/queries"
```

**Response:**
```json
{
  "_type": "Collection",
  "total": 0,
  "count": 0,
  "_embedded": {
    "elements": []
  }
}
```

---

### 7. Notifications API

**Endpoint:** `/api/v3/notifications`

```bash
curl -X GET "http://localhost:4200/api/v3/notifications"
```

**Response:**
```json
{
  "_type": "Collection",
  "total": 0,
  "count": 0,
  "_embedded": {
    "elements": []
  }
}
```

---

## Non-Working APIs

These endpoints return `404 Not Found` and are not available in the Cloud API.

### 1. Global Work Packages

**Endpoint:** `/api/v3/work_packages`

```bash
curl -X GET "http://localhost:4200/api/v3/work_packages"
```

**Response:**
```json
{
  "detail": "Not Found"
}
```

**Workaround:** Use `/api/v3/projects/{id}/work_packages` instead

---

### 2. Meetings

**Endpoint:** `/api/v3/meetings`

```bash
curl -X GET "http://localhost:4200/api/v3/meetings"
```

**Response:**
```json
{
  "detail": "Not Found"
}
```

---

### 3. Attachments

**Endpoint:** `/api/v3/attachments`

```bash
curl -X GET "http://localhost:4200/api/v3/attachments"
```

**Response:**
```json
{
  "detail": "Not Found"
}
```

---

### 4. Memberships

**Endpoint:** `/api/v3/memberships`

```bash
curl -X GET "http://localhost:4200/api/v3/memberships"
```

**Response:**
```json
{
  "detail": "Not Found"
}
```

---

### 5. Groups

**Endpoint:** `/api/v3/groups`

```bash
curl -X GET "http://localhost:4200/api/v3/groups"
```

**Response:**
```json
{
  "detail": "Not Found"
}
```

---

### 6. Wiki Pages

**Endpoint:** `/api/v3/wiki_pages`

```bash
curl -X GET "http://localhost:4200/api/v3/wiki_pages"
```

**Response:**
```json
{
  "detail": "Not Found"
}
```

---

### 7. News

**Endpoint:** `/api/v3/news`

```bash
curl -X GET "http://localhost:4200/api/v3/news"
```

**Response:**
```json
{
  "detail": "Not Found"
}
```

---

### 8. Categories

**Endpoint:** `/api/v3/categories`

```bash
curl -X GET "http://localhost:4200/api/v3/categories"
```

**Response:**
```json
{
  "detail": "Not Found"
}
```

---

## APIs Needed for OpenProject Feature Parity

The following APIs need to be implemented in your Cloud API to achieve full OpenProject functionality:

### High Priority (Core Features)

| API | Purpose | Required Operations |
|-----|---------|---------------------|
| `/api/v3/work_packages` | Global work package list with filters | GET with query params |
| `/api/v3/work_packages/{id}/activities` | Work package comments/history | GET, POST |
| `/api/v3/work_packages/{id}/relations` | Work package dependencies | GET, POST, DELETE |
| `/api/v3/work_packages/{id}/watchers` | Work package watchers | GET, POST, DELETE |
| `/api/v3/attachments` | File attachments | GET, POST, DELETE |
| `/api/v3/projects/{id}/memberships` | Project member management | GET, POST, PATCH, DELETE |

### Medium Priority (Enhanced Features)

| API | Purpose | Required Operations |
|-----|---------|---------------------|
| `/api/v3/time_entries` | Time tracking (with POST) | GET, POST, PATCH, DELETE |
| `/api/v3/versions` | Project versions/releases | GET, POST, PATCH, DELETE |
| `/api/v3/meetings` | Meeting management | GET, POST, PATCH, DELETE |
| `/api/v3/queries` | Saved filters/views | GET, POST, PATCH, DELETE |
| `/api/v3/notifications` | User notifications | GET, PATCH (mark read) |
| `/api/v3/groups` | User groups | GET, POST, PATCH, DELETE |

### Low Priority (Additional Features)

| API | Purpose | Required Operations |
|-----|---------|---------------------|
| `/api/v3/wiki_pages` | Project wiki | GET, POST, PATCH, DELETE |
| `/api/v3/news` | Project news/announcements | GET, POST, PATCH, DELETE |
| `/api/v3/categories` | Work package categories | GET, POST, PATCH, DELETE |
| `/api/v3/custom_fields` | Custom field definitions | GET, POST, PATCH, DELETE |
| `/api/v3/custom_actions` | Workflow automation | GET, POST, PATCH, DELETE |
| `/api/v3/grids` | Dashboard widgets | GET, POST, PATCH, DELETE |

---

## Data Structure Reference

### Project Schema
```json
{
  "id": "integer",
  "identifier": "string (unique slug)",
  "name": "string",
  "description": "string",
  "active": "boolean",
  "public": "boolean",
  "statusExplanation": "string",
  "createdAt": "datetime",
  "updatedAt": "datetime"
}
```

### Work Package Schema
```json
{
  "id": "integer",
  "subject": "string",
  "description": "string",
  "projectId": "integer",
  "parentId": "integer (nullable)",
  "assigneeId": "integer (nullable)",
  "typeId": "integer",
  "status": "string (new|in_progress|closed|on_hold|rejected)",
  "priority": "string (low|normal|high|urgent)",
  "doneRatio": "integer (0-100)",
  "startDate": "date (nullable)",
  "dueDate": "date (nullable)",
  "estimatedTime": "float (nullable)",
  "createdAt": "datetime",
  "updatedAt": "datetime"
}
```

### User Schema
```json
{
  "id": "integer",
  "login": "string",
  "firstName": "string",
  "lastName": "string",
  "email": "string",
  "admin": "boolean",
  "status": "string (active|locked|invited)",
  "createdAt": "datetime",
  "updatedAt": "datetime"
}
```

### Role Schema
```json
{
  "id": "integer",
  "name": "string",
  "permissions": ["string"],
  "builtin": "boolean",
  "createdAt": "datetime",
  "updatedAt": "datetime"
}
```

### Work Package Type Schema
```json
{
  "id": "integer",
  "name": "string",
  "internalName": "string",
  "isBuiltin": "boolean",
  "isActive": "boolean",
  "position": "integer",
  "createdAt": "datetime",
  "updatedAt": "datetime"
}
```

---

## Summary Table

| Endpoint | GET | POST | PATCH | DELETE | Status |
|----------|-----|------|-------|--------|--------|
| `/projects` | ✅ | ✅ | ✅ | ✅ | **Working** |
| `/projects/{id}` | ✅ | - | ✅ | ✅ | **Working** |
| `/projects/{id}/work_packages` | ✅ | ✅ | - | - | **Working** |
| `/work_packages` | ❌ | - | - | - | Not Available |
| `/work_packages/{id}` | ✅ | - | ✅ | ✅ | **Working** |
| `/users` | ✅ | ✅ | - | - | **Working** |
| `/users/{id}` | ✅ | - | ✅ | ✅ | **Working** |
| `/roles` | ✅ | ✅ | - | - | **Working** |
| `/roles/{id}` | ✅ | - | ✅ | ✅ | **Working** |
| `/work_package_types` | ✅ | ✅ | - | - | **Working** |
| `/statuses` | ✅ | - | - | - | Mock Data |
| `/priorities` | ✅ | - | - | - | Mock Data |
| `/activities` | ✅ | - | - | - | Mock (Empty) |
| `/versions` | ✅ | - | - | - | Mock (Empty) |
| `/time_entries` | ✅ | - | - | - | Mock (Empty) |
| `/queries` | ✅ | - | - | - | Mock (Empty) |
| `/notifications` | ✅ | - | - | - | Mock (Empty) |
| `/meetings` | ❌ | - | - | - | Not Available |
| `/attachments` | ❌ | - | - | - | Not Available |
| `/memberships` | ❌ | - | - | - | Not Available |
| `/groups` | ❌ | - | - | - | Not Available |
| `/wiki_pages` | ❌ | - | - | - | Not Available |
| `/news` | ❌ | - | - | - | Not Available |
| `/categories` | ❌ | - | - | - | Not Available |

---
---

*Document generated during Cloud API audit on January 5, 2026*
