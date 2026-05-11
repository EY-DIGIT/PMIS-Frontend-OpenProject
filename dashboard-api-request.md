# Hi [Developer name],

I need a new API for the Dashboard. The current `GET /api/v3/projects` returns flat project metadata only, but the new Dashboard design (PMIS_Screens / Dashboard.html, dated 2026-05-08) has 18+ KPIs, 6 views, and a hierarchy drill-down — none of which I can compute from a flat list.

For now I have wired the frontend to mock data so the UI is visible, but I need real APIs to make it functional. Please prioritize this — without the changes below, half the Dashboard tiles will permanently show 0.

---

## What I need — please build these

### 1. New endpoint: `GET /api/v3/dashboard/summary`

A single aggregated endpoint that returns pre-computed KPIs. Cheaper than fetching 30 trees just to render the homepage.

**Response shape:**

```json
{
  "totals": {
    "projects": 30,
    "active": 24,
    "completed": 6,
    "ontrack": 14,
    "delayed": 4
  },
  "byOrganisation": [
    { "name": "EY", "total": 5, "completed": 2, "ontrack": 2, "delayed": 1 },
    { "name": "Wipro", "total": 4, "completed": 1, "ontrack": 2, "delayed": 1 }
  ],
  "byDivision": [
    { "name": "TMD-I", "total": 6, "completed": 2, "ontrack": 3, "delayed": 1 },
    { "name": "TMD-II", "total": 5, "completed": 2, "ontrack": 2, "delayed": 1 }
  ],
  "delayedProjects": [
    {
      "projectId": "uuid-here",
      "projectCode": "PRJ017",
      "name": "Exception Case Workflow",
      "organisation": "Wipro",
      "division": "TMD-II",
      "delayedItems": 3,
      "maxDelayDays": 18
    }
  ]
}
```

**Status bucket rules** (please implement these server-side so frontend and backend stay aligned):
- `completed` → every task under the project has `actualEndDate` set
- `delayed` → at least one task has `plannedEndDate < today` AND no `actualEndDate`
- `ontrack` → at least one task has `actualStartDate`, no delays
- `active` → nothing started yet

### 2. Confirm `GET /api/v3/projects/{uuid}/tree` returns full hierarchy

The Project View, Track Progress drill-down, and per-project KPIs all rely on this endpoint returning Milestones → Activities → Tasks → Sub-Tasks **in one response**. Please confirm:

- All 4 levels are returned in a single call (no N+1 fan-out from the frontend)
- All new fields below are populated at every level

### 3. New field: `approvalState` on activities

The Dashboard has a **"Pending for Approval"** KPI tile and a status pill on every activity row. Today the `activity` model only has `status: completed | not_completed`. I need a separate field:

```
activity.approvalState: "idle" | "pending_division" | "pending_owner"
                       | "division_approved" | "rejected" | "completed"
```

Approval is a **separate axis** from completion — an activity can be `not_completed` while approval is `pending_division`, or `completed` with approval `rejected`. Please add `approvalState` to the activity model and return it on every endpoint that returns activities (`GET /milestones/{id}/activities`, `GET /activities/{id}`, `GET /projects/{uuid}/tree`, etc.).

**Without this field, the "Pending for Approval" KPI will always show 0.**

### 4. Confirm `actualStartDate` and `actualEndDate` are returned

For tasks and sub-tasks. The Dashboard's "Delayed by N days" calculation and the Track Progress "Actual Dates" column both need these. Please confirm they are:

- Persisted on task and sub-task models
- Returned on every endpoint (currently I see `startDate` and `endDate` but not the actuals)

### 5. Add `actualStartDate` to the project model

Today we have `project.endDate` (planned), `project.actualEndDate`. Please also add `project.actualStartDate` so the project header can show "Actual: 2026-01-05 → —" while the project is in flight.

### 6. Clarify how to derive `organisation` and `division` for a project

The Dashboard groups projects by these two fields. Today we have `project.vendors[]` (array) and `project.owner` (free text). Please confirm:

- **Organisation**: should I take `vendors[0].name` as the prime org? Or do you want to add a `project.primaryVendor` / `project.organisation` field?
- **Division**: is `project.owner` meant to carry the division name? Or is there a separate field I should use? (Activities have `concernedDivision[]` but I need it at the project level.)

### 7. Add status filter to project list

```
GET /api/v3/projects?status=delayed
GET /api/v3/projects?status=completed
GET /api/v3/projects?status=ontrack
GET /api/v3/projects?status=active
```

The Dashboard's KPI tiles drill into a filtered project list view. Without server-side filtering I have to fetch every project and filter client-side — that won't scale.

---

## Why this is blocking

| KPI tile | Works today? | Needs |
|---|---|---|
| Total Projects | yes | already works |
| Active / Completed / On Track / Delayed | partial | needs status bucket logic, all 5 fields above |
| Milestones (X/Y) | no | needs tree |
| Activities (X/Y) | no | needs tree |
| **Pending for Approval** | **no** | **needs `approvalState` field** |
| Delayed by 5/10/15+ days | no | needs tree + actual dates |
| Track Progress hierarchy table | no | needs tree |
| Organization / Division grouping | no | needs aggregated summary |

---

## What I have done in the meantime

- Frontend Dashboard ships with **mock data** that matches the PMIS_Screens design 1:1 (30 projects, full hierarchy, all KPIs populated). Mock lives at `src/data/dashboardMockData.js`.
- Once your APIs are ready, swap is one line — `Dashboard.jsx` will read from the new endpoint instead of the mock module.

---

## Reference

- **Design:** EY-DIGIT/PMIS_Screens → Dashboard.html (commit 2026-05-08)
- **Frontend code:** `src/pages/Dashboard.jsx`, `src/data/dashboardMockData.js`
- **Detailed spec (with response shapes):** `backend-dashboard-apis.md` in the frontend repo

Please give an ETA. Happy to jump on a call to walk through the design if anything is unclear.

Thanks!
— Pankaj
