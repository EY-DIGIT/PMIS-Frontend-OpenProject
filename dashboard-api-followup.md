# Hi [Developer name],

Thanks for shipping the six `/api/v3/dashboard/*` endpoints — I've reviewed the Postman collection on `uat` and the schemas in `app/api/v3/dashboard/schemas.py`. The shape matches what I asked for in `dashboard-api-request.md` almost end-to-end. **7 of 7 asks have a server answer** — 4 shipped exactly, 2 in a slightly different (acceptable) form, 1 deferred. Great work.

All three open items have been decided (recorded below). I just need three small confirmations from you before I do the mock → live swap on the frontend.

---

## Decisions

### 1. Pending Approvals KPI — static for v1

`pendingApprovals = 0` from the BE is fine. The FE will render a small static value on the tile so the design doesn't look broken. Real wiring happens when `approvalState` ships in the next version.

  **Confirm:** any rough ETA for the next-version `approvalState` work?

### 2. Track Progress drill-down — using `/tree`

`/dashboard/projects/{id}/items` returning Milestones + Activities only is fine. For the deeper Task / Sub-Task rows in the **Track Progress** view, the FE will call the existing **`GET /api/v3/projects/{uuid}/tree`** — no new endpoint needed.

  **Confirm:** `/tree` returns Task and Sub-Task levels with `actualStartDate`, `actualEndDate`, and `status` populated. (Per your 2026-05-08 commit Milestones now also have these — thanks.)

### 3. Access policy — admin-only for v1

Keeping `require_admin` gate as-is for v1. The FE will hide the Dashboard sidebar entry for non-admin users and route them to a different landing page. We'll revisit scoped (PM / OA) dashboards in a later phase if needed.

  No action from you on this one.

---

## Small items — just confirming I read the schemas right

Not blockers, just sanity checks:

- **`BucketCounts` has no `active` field on purpose** — FE computes `active = total - completed`. ✅
- **`organisations: VendorChip[]`** stays as a list — FE shows the first as primary or chips them all. ✅
- **`division: Optional[str]` + `divisionOther: Optional[str]`** are first-class on the project. Where on the model is the source-of-truth field? I want to make sure these survive a project edit and round-trip on PATCH `/projects/{id}`.
- **All dates emitted as IST `+05:30`** — FE will not re-convert. ✅
- **`asOf`** on every response — will render as "Data as of …" footer. Thanks for adding it.

---

## My plan

1. Swap `Dashboard.jsx` from `mockDashboardProjects` → live API calls (Summary, Project List, Project View, Org View).
2. Wire Track Progress to `/projects/{uuid}/tree` for the M/A/T/ST hierarchy.
3. Keep Pending Approvals on a static value until the next version.
4. Drop my client-side bucket derivation — use `bucket` and `counts` straight from the server.
5. Hide the Dashboard sidebar entry for non-admin users.

I'll start this once you confirm the three small items above (ETA for approvals, `/tree` populates T/ST actuals + status, and division source field).

Thanks again!
— Pankaj
