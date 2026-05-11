# Dashboard — Ready for Testing

Hi team / QA,

The new Dashboard (PMIS_Screens design dated 2026-05-08) is now wired to **live backend APIs**. Please run through the test plan below and flag anything that doesn't match the design or the BE spec.

---

## What's live (real data)

| View | Endpoint(s) used |
|---|---|
| Summary view (KPIs, pie, delayed track, org/division cards) | `GET /api/v3/dashboard/projects?pageSize=200` |
| Project View (header, 5 KPIs, pie, delayed track) | Same list + `GET /api/v3/projects/{uuid}/tree` (lazy) |
| Organization View (vendor cards + drill-down) | Same list, grouped client-side by vendor |
| Division View (division cards + drill-down) | Same list, grouped client-side by division |
| Project List (filtered by bucket/search) | Same list |
| Track Progress (M → A → T → ST hierarchy) | `GET /api/v3/projects/{uuid}/tree` (lazy per project) |

All bucket counts (`ontrack` / `delayed` / `completed`), progress %, milestone counts, activity counts, delayed-item counts, and max-delay-days come **server-computed** from the new `/api/v3/dashboard/*` endpoints. The frontend does not derive these any more — what you see is what the BE returns.

---

## What's still mock / static (and why)

There is **only one** piece of mock data left in the Dashboard:

### "Pending for Approval" KPI tile (Project View)

- **Where it shows:** Project View → 4th KPI tile labeled "Pending for Approval"
- **What it shows now:** a small static number (0–4) derived deterministically per project from the project ID hash. So PRJ001 always shows the same value, PRJ002 always shows a different stable value, etc.
- **Why it's static:** the BE schema currently returns `pendingApprovals = 0` for all projects (`# static 0 in v1` in `app/api/v3/dashboard/schemas.py`). The `approvalState` field on activities is **deferred to the next backend phase**.
- **What changes in v2:** when BE ships `approvalState` on activities, this tile will switch to a real count. One-line frontend swap.
- **QA expectation:** don't validate the actual number on this tile. Just confirm it renders a small non-zero integer and doesn't break the layout.

That's it. Everything else (every other KPI, every chart, every drill-down row) is real data.

---

## Access policy (v1)

- Dashboard is **admin-only**: `super_admin` and `admin` roles can see and access it.
- `org_admin`, `project_admin`, `project_member` → Dashboard hidden from sidebar; direct `/dashboard` URL redirects.
- This is enforced server-side too (all `/api/v3/dashboard/*` endpoints return 403 to non-admins).

---

## Test plan

### Access control
- [ ] Log in as `super_admin` → Dashboard visible in sidebar, opens correctly.
- [ ] Log in as `admin` → same as above.
- [ ] Log in as `org_admin` → no Dashboard entry in sidebar; manually visiting `/dashboard` redirects.
- [ ] Log in as `project_admin` → no Dashboard entry; URL redirects.
- [ ] Log in as `project_member` → no Dashboard entry; URL redirects.

### Summary view
- [ ] Page loads inside 2 seconds with all KPI tiles populated (Total / Active / Completed / On Track / Delayed).
- [ ] Total Projects = sum of all projects returned by BE.
- [ ] Active = Total − Completed (FE derives this; no `active` field on BE).
- [ ] Pie chart matches the KPI numbers.
- [ ] "Delayed Track" card shows projects with `delayedItemCount > 0` AND `maxDelayDays ≥ <delay filter>`.
- [ ] Change "Delayed by N days" dropdown (5 / 10 / 15 / 20 / 30) → list re-filters.
- [ ] Org cards and Division cards render with correct totals.
- [ ] "+N More" buttons expand to show all orgs / divisions.

### Project View
- [ ] Pick any project from the dropdown → header (id, name, description, org, division, owner, planned dates, progress) renders.
- [ ] 5 KPI tiles: Overall Progress, Milestones (X/Y), Activities (X/Y), Pending for Approval (static — see note above), Delayed.
- [ ] Pie chart shows status distribution over Milestones + Activities.
- [ ] Delayed Track lists rows above the chosen day threshold.
- [ ] Clicking any KPI tile drills into Track Progress filtered to that scope.

### Organization / Division view
- [ ] Click an org card → drill into that vendor's projects.
- [ ] Click a division card → drill into that division's projects.
- [ ] Drill-down shows correct project count and bucket distribution.
- [ ] "Back" returns to Summary.

### Project List
- [ ] Click any of: Total / Active / Completed / On Track / Delayed KPI tiles → Project List opens filtered to that bucket.
- [ ] Search bar filters by id / name / org / division / owner.

### Track Progress (4-level hierarchy)
- [ ] Open a project in Track Progress → all four levels visible: **M**ilestone (M1), **A**ctivity (A1.1), **T**ask (T1.1.1), **S**ub-**T**ask (ST1.1.1.1).
- [ ] Status pill on each row matches the dates (planned end < today and not completed → "Delayed").
- [ ] Activity rows show a small approval-state pill — for v1 this will read "idle" or similar placeholder for every row (this is expected — see "Pending for Approval" note above).
- [ ] "Open in PM" button on any row navigates to the existing Project Details page at `/projects/{id}`.

### Data freshness
- [ ] "Refresh" button at the top re-fetches the project list and clears the tree cache.
- [ ] All dates render as DD-MM-YYYY in IST.

### Failure paths
- [ ] Stop the backend → Dashboard shows an error banner with a Retry button.
- [ ] Slow network (DevTools throttle to "Slow 3G") → loading state appears before data lands; no flicker / no broken layout.

---

## Known issues / FE-side limitations to flag

- **Activity approval state pills** all read the same placeholder value until v2 backend lands `approvalState`. This is expected.
- **Track Progress "all delayed" view** (clicking the Delayed KPI on Summary with no project selected) fan-outs one `/tree` request per delayed project. On a network with many delayed projects this can take a few seconds. Acceptable for v1; we'll add a server-side aggregated rows endpoint if performance is an issue.
- **Owner field** on project cards shows "—" — BE doesn't return a project owner string in the dashboard payload; needs clarification with the dev team.

---

## Reference

- **Design source:** `EY-DIGIT/PMIS_Screens` → `Dashboard.html` (commit 2026-05-08)
- **Backend endpoints:** `EY-DIGIT/PMIS-OpenProject` → `app/api/v3/dashboard/` (commit 2026-05-09)
- **Postman collection:** `PMIS-OpenProject` repo → `PMIS_API_Collection.postman_collection.json` → **Dashboard** folder (6 requests)
- **Frontend mock fallback (unused, kept for reference):** `src/data/dashboardMockData.js`

Please file any bugs against me on this thread and include the **role you logged in as** + the **view you were on** + a **screenshot / Network response** if a KPI value looks off.

Thanks,
— Pankaj
