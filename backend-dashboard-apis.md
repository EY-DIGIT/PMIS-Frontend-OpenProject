# Dashboard — Backend API Requirements

**To:** Backend team
**From:** Frontend
**Re:** APIs required to drive the new Dashboard (PMIS_Screens / Dashboard.html, design dated 2026-05-08)
**Status:** Frontend is currently rendering mock data because the existing `GET /api/v3/projects` does not return enough information to compute the new KPIs. This document specifies what we need.

---

## 1. The problem

The new Dashboard has **6 views** and **18+ KPIs** that drill into a hierarchy (Project → Milestone → Activity → Task → Sub-Task). Today the only endpoint we can call is `GET /api/v3/projects`, which returns flat project metadata. That gives us:

- ✅ Total Projects
- ✅ Project status (PUBLISHED / NEW / COMPLETED) — but only at project level
- ✅ Organisation (vendors[]) and Division (owner)

That is roughly **20%** of what the Dashboard needs. Everything else (Milestones X/Y, Activities X/Y, Pending Approvals, Delayed Track with day filter, hierarchy table, status pies) requires the full tree **and** new fields that don't exist today.

---

## 2. What we need — in priority order

### Option A (recommended) — Dedicated dashboard endpoint

A single aggregated endpoint that returns pre-computed KPIs + minimum tree data needed for drill-downs. Cheaper than fetching 30 trees just to render the summary.

```
GET /api/v3/dashboard/summary
```

**Response:**
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
    {"name": "EY",      "total": 5, "completed": 2, "ontrack": 2, "delayed": 1},
    {"name": "Wipro",   "total": 4, "completed": 1, "ontrack": 2, "delayed": 1}
  ],
  "byDivision": [
    {"name": "TMD-I",   "total": 6, "completed": 2, "ontrack": 3, "delayed": 1},
    {"name": "TMD-II",  "total": 5, "completed": 2, "ontrack": 2, "delayed": 1}
  ],
  "delayedProjects": [
    {
      "projectId": "...uuid...",
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

**Status bucket rules (per design):**
- `completed`: all tasks under project have `actualEndDate` set
- `delayed`: at least one task has `plannedEndDate < today` AND no `actualEndDate`
- `ontrack`: at least one task has `actualStartDate` set, no delays
- `active`: nothing started yet

The frontend currently re-implements these rules — moving them server-side keeps everyone honest.

### Option B (acceptable fallback) — Expand on existing list

Add an `?expand=tree` query parameter to `GET /api/v3/projects`:

```
GET /api/v3/projects?expand=tree
```

Returns the existing project payload **with full tree embedded** (milestones → activities → tasks → subtasks). Frontend computes KPIs client-side as it does today with mock data.

### Option C (slowest) — Just expose tree per project

Keep `GET /api/v3/projects` flat, frontend fans-out N+1 calls to `GET /api/v3/projects/{uuid}/tree`. **Not acceptable for production** — 30 projects = 31 requests just to render the homepage. List this as a non-goal.

---

## 3. New fields required (regardless of which option)

### 3.1 On **activities** — `approvalState`

The Dashboard has a **"Pending for Approval"** KPI tile + a status pill on every activity row in the Track Progress table. This needs a new field:

```
activity.approvalState: "idle" | "pending_division" | "pending_owner" | "division_approved" | "rejected" | "completed"
```

Current model only has `activity.status: "completed" | "not_completed"`. The approval workflow is a separate axis — an activity can be `not_completed` while its approval is `pending_division`, or `completed` with approval `rejected`. We need both.

**Without this field, the "Pending for Approval" KPI will always show 0 — the tile renders but is meaningless.**

### 3.2 On **tasks and sub-tasks** — `actualStartDate` and `actualEndDate`

Used by the Dashboard's "Delayed by N days" calculation and the Track Progress "Actual Dates" column.

Please confirm these fields are persisted and returned on `GET /api/v3/activities/{id}/tasks` and `GET /api/v3/tasks/{id}/subtasks`. If they exist but aren't surfaced on the response, add them.

### 3.3 On **projects** — `actualStartDate` (in addition to existing `actualEndDate`)

Currently we have `endDate` (planned), `actualEndDate`. We also need `actualStartDate` so the project header can render "Planned: 2026-01-05 → 2026-05-10" alongside "Actual: 2026-01-05 → —".

### 3.4 On **organisation field**

The design shows `organisation` as a single string per project (e.g. "EY", "Wipro"). Today we have `project.vendors[]` as an array. Frontend currently displays `vendors[0]` as the primary org. **Confirm** that the first vendor in `vendors[]` is the prime organisation, or add a dedicated `primaryVendor` / `organisation` field on the project.

### 3.5 On **division field**

Similarly, design's `division` is a single string per project (TMD-I, TMD-II, Audit, Operations, PMC). Today we have `project.owner` (free text) and `concernedDivision[]` on activities. **Confirm** which field represents the project-level owning division. If `owner` is meant to be free-text and division is meant to come from somewhere else, please specify.

---

## 4. Endpoints needed for drill-down views

Even with the summary endpoint above, drill-downs need details. We need at minimum:

| View | What it shows | Needs |
|---|---|---|
| Summary | 5 KPIs, pie, delayed track, org/div cards | Option A endpoint above |
| Project View | Single project's KPIs, delayed track | `GET /api/v3/projects/{uuid}/tree` *(already exists — confirm it returns full hierarchy with new fields)* |
| Track Progress | WBS hierarchy table (M / A / T / ST rows) | Same `/tree` endpoint with **all** levels populated |
| Organization View | Projects grouped by vendor | Summary endpoint's `byOrganisation` |
| Division View | Projects grouped by division | Summary endpoint's `byDivision` |
| Project List | Filterable list by bucket (active/completed/ontrack/delayed) | Add `?status=delayed` filter to `GET /api/v3/projects` |

---

## 5. Concrete request to the team

Please:

1. **Decide between Option A and Option B** for serving the summary. We prefer A.
2. **Add `approvalState` to the activity model** and expose it on all activity-returning endpoints.
3. **Confirm `actualStartDate` / `actualEndDate`** are present and returned at task and sub-task levels.
4. **Add `actualStartDate` to project** model.
5. **Confirm `primaryVendor`/`organisation` and `division`** fields on projects, or tell us how to derive them from existing fields.
6. **Confirm** `GET /api/v3/projects/{uuid}/tree` returns the full M→A→T→ST hierarchy in one response.

Until these land, the Dashboard ships with **mock data** that mirrors the PMIS_Screens design exactly. The mock is hard-coded in `src/data/dashboardMockData.js` and is clearly labeled.

Once the APIs are ready, swapping is a one-line change — `Dashboard.jsx` reads from `useProjects()` instead of the mock module.

---

## 6. Reference

Design file in scope: **EY-DIGIT/PMIS_Screens → Dashboard.html** (commit 2026-05-08)
Mock data source: lines 349–544 of that file.
