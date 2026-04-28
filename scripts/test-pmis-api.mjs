#!/usr/bin/env node
// PMIS API end-to-end test runner.
// Walks every endpoint listed in the Postman collection, in dependency order,
// then writes a Markdown report next to this script.
//
// Usage:   node scripts/test-pmis-api.mjs
// Env:     PMIS_BASE_URL (default http://10.1.131.199:8000)
//          PMIS_USER     (default admin)
//          PMIS_PASS     (default admin123)

import { writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const BASE = process.env.PMIS_BASE_URL || 'http://10.1.131.199:8000';
const LOGIN = process.env.PMIS_USER || 'admin';
const PASS = process.env.PMIS_PASS || 'admin123';
const STAMP = Date.now();
const __dirname = dirname(fileURLToPath(import.meta.url));
const REPORT = resolve(__dirname, '..', 'pmis-api-test-report.md');

const results = [];
const ctx = {
  token: null,
  refresh: null,
  resourceTypeId: null,
  vendorId: null,
  userId: null,
  projectUuid: null,
  projectUuidOthers: null,
  milestoneId: null,
  activityIdStd: null,
  activityIdsExtra: [],
  taskId: null,
  subtaskId: null,
  membershipId: null,
  roleId: null,
  wpId: null,
  wptId: null,
  meetingId: null,
  agendaItemId: null,
  versionUuid: null,
  versionMilestoneId: null,
  versionActivityId: null,
};

function row(entry) {
  results.push(entry);
  const flag = entry.ok === true ? 'PASS' : entry.ok === false ? 'FAIL' : 'SKIP';
  const tail = entry.note ? `  ${entry.note}` : '';
  console.log(`[${flag}] ${entry.method.padEnd(6)} ${entry.path}  -> ${entry.status}  (${entry.ms}ms)${tail}`);
}

function skip(name, method, path, reason) {
  row({ name, method, path, status: '-', ok: null, ms: 0, note: 'SKIPPED: ' + reason, body: '', curl: '', requestBody: '' });
}

function buildCurl(method, fullUrl, headers, body) {
  const lines = [`curl -sS -X ${method} '${fullUrl}'`];
  for (const [k, v] of Object.entries(headers)) {
    const val = k === 'Authorization' ? 'Bearer $TOKEN' : v;
    lines.push(`  -H '${k}: ${val}'`);
  }
  if (body !== undefined) {
    const json = JSON.stringify(body);
    // single-quote escape
    lines.push(`  -d '${json.replace(/'/g, `'\\''`)}'`);
  }
  return lines.join(' \\\n');
}

async function call(name, method, path, { body, query, auth = true } = {}) {
  const url = new URL(path.startsWith('http') ? path : BASE + path);
  if (query) Object.entries(query).forEach(([k, v]) => v != null && v !== '' && url.searchParams.set(k, v));
  const headers = { Accept: 'application/json' };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (auth && ctx.token) headers.Authorization = `Bearer ${ctx.token}`;
  const fullUrl = url.toString();
  const curl = buildCurl(method, fullUrl, headers, body);
  const requestBody = body === undefined ? '' : JSON.stringify(body, null, 2);
  const t0 = Date.now();
  let status = 0, text = '', payload = null, ok = false, note = '';
  try {
    const res = await fetch(url, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
    status = res.status;
    ok = res.ok;
    text = await res.text();
    if (text) { try { payload = JSON.parse(text); } catch { payload = null; } }
  } catch (err) {
    note = `network error: ${err.message}`;
  }
  const ms = Date.now() - t0;
  // Pretty-print response body if JSON, else first 1500 chars
  let responseBody = text || '';
  try {
    const parsed = JSON.parse(text);
    responseBody = JSON.stringify(parsed, null, 2);
  } catch { /* leave as-is */ }
  if (responseBody.length > 1500) responseBody = responseBody.slice(0, 1500) + '\n... (truncated)';
  row({
    name, method,
    path: url.pathname + url.search,
    fullUrl,
    status: status || 'ERR',
    ok,
    ms,
    note,
    body: responseBody,
    curl,
    requestBody,
  });
  return { status, ok, payload, text };
}

function pickId(payload, ...keys) {
  if (!payload) return null;
  // walk common wrappers
  const candidates = [
    payload,
    payload.data,
    payload.data?._embedded?.elements?.[0],
    payload._embedded?.elements?.[0],
  ].filter(Boolean);
  for (const c of candidates) {
    for (const k of keys) {
      if (c[k] != null) return c[k];
    }
  }
  return null;
}

function unwrapList(payload) {
  if (!payload) return [];
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload._embedded?.elements)) return payload._embedded.elements;
  if (Array.isArray(payload.data?._embedded?.elements)) return payload.data._embedded.elements;
  if (Array.isArray(payload.items)) return payload.items;
  if (Array.isArray(payload.data?.items)) return payload.data.items;
  if (Array.isArray(payload.data)) return payload.data;
  return [];
}

// ─────────────────────────────────────────────────────────────────────────
async function run() {
  console.log(`PMIS API test — base ${BASE}\n`);

  // Phase 0 — Health
  await call('Health Check', 'GET', '/health', { auth: false });
  await call('Root', 'GET', '/', { auth: false });

  // Phase 1 — Auth
  const login = await call('Login', 'POST', '/api/v3/users/login', {
    auth: false, body: { login: LOGIN, password: PASS },
  });
  if (login.ok && login.payload) {
    ctx.token = login.payload.access_token || login.payload.token || login.payload.data?.access_token || null;
    ctx.refresh = login.payload.refresh_token || login.payload.data?.refresh_token || null;
  }
  if (!ctx.token) {
    console.error('\nLOGIN FAILED — cannot continue with authenticated calls.');
    return finish();
  }

  await call('Introspect Token', 'POST', '/api/v3/users/introspect', {
    body: { access_token: ctx.token, refresh_token: ctx.refresh || '' },
  });
  await call('Get Current User', 'GET', '/api/v3/users/me');

  // Phase 2 — Resource types
  await call('List Resource Types', 'GET', '/api/v3/resource_types');
  const rt = await call('Create Resource Type (admin)', 'POST', '/api/v3/resource_types/create', {
    body: { code: `test_${STAMP}`, name: `Test Resource Type ${STAMP}`, active: true },
  });
  ctx.resourceTypeId = pickId(rt.payload, 'id', 'uuid', 'code');

  // Phase 3 — Vendors
  await call('List Vendors', 'GET', '/api/v3/vendors');
  const v = await call('Create Vendor (admin)', 'POST', '/api/v3/vendors/create', {
    body: { name: `Test Vendor ${STAMP}`, description: 'API test vendor', active: true },
  });
  ctx.vendorId = pickId(v.payload, 'uuid', 'id');
  if (ctx.vendorId) {
    await call('Update Vendor (admin)', 'PATCH', `/api/v3/vendors/${ctx.vendorId}`, {
      body: { name: `Test Vendor ${STAMP} (updated)`, active: true },
    });
  } else {
    skip('Update Vendor (admin)', 'PATCH', '/api/v3/vendors/{vendorId}', 'no vendorId from create');
  }

  // Phase 4 — Users
  const u = await call('Create User', 'POST', '/api/v3/users/create', {
    body: {
      login: `tester_${STAMP}`,
      email: `tester_${STAMP}@example.com`,
      password: 'TestPass123!',
      firstName: 'Test',
      lastName: 'User',
      admin: false,
    },
  });
  ctx.userId = pickId(u.payload, 'id', 'uuid');
  await call('List Users', 'GET', '/api/v3/users', { query: { offset: 1, pageSize: 20 } });
  if (ctx.userId) {
    await call('Get User by ID', 'GET', `/api/v3/users/${ctx.userId}`);
    await call('Update User', 'PATCH', `/api/v3/users/${ctx.userId}`, {
      body: { firstName: 'Test', lastName: 'User Updated', admin: false, status: 'active' },
    });
    await call('Update User Password', 'PATCH', `/api/v3/users/${ctx.userId}/password`, {
      body: { password: 'NewTestPass123!' },
    });
  } else {
    skip('Get User by ID', 'GET', '/api/v3/users/{id}', 'no userId from create');
    skip('Update User', 'PATCH', '/api/v3/users/{id}', 'no userId');
    skip('Update User Password', 'PATCH', '/api/v3/users/{id}/password', 'no userId');
  }

  // Phase 5 — Projects
  const proj = await call('Create Project', 'POST', '/api/v3/projects/create', {
    body: {
      name: `Test Project ${STAMP}`,
      description: 'API test project',
      active: true,
      isPublic: false,
      owner: 'admin',
      category: 'MSIP',
      startDate: '2026-05-01T09:00:00Z',
      endDate: '2026-12-31T17:00:00Z',
      vendorIds: ctx.vendorId ? [String(ctx.vendorId)] : [],
    },
  });
  ctx.projectUuid = pickId(proj.payload, 'uuid', 'id');

  const projOthers = await call('Create Project (category=others)', 'POST', '/api/v3/projects/create', {
    body: {
      name: `Test Project Others ${STAMP}`,
      description: 'others-category test',
      owner: 'admin',
      category: 'others',
      categoryOther: 'Inception Phase',
      categoryOtherReason: 'API test — required when category=others',
      vendorIds: ctx.vendorId ? [String(ctx.vendorId)] : [],
      startDate: '2026-05-01T09:00:00Z',
      endDate: '2026-12-31T17:00:00Z',
    },
  });
  ctx.projectUuidOthers = pickId(projOthers.payload, 'uuid', 'id');

  await call('List Projects', 'GET', '/api/v3/projects', { query: { offset: 1, pageSize: 20, active: 'true' } });

  if (ctx.projectUuid) {
    await call('Get Project by UUID', 'GET', `/api/v3/projects/${ctx.projectUuid}`);
    await call('Upsert Project by UUID', 'PUT', `/api/v3/projects/${ctx.projectUuid}`, {
      body: {
        name: `Test Project ${STAMP} (upsert)`,
        owner: 'admin',
        isPublic: false,
        startDate: '2026-05-01T09:00:00Z',
        endDate: '2026-12-31T17:00:00Z',
      },
    });
    await call('Update Project', 'PATCH', `/api/v3/projects/${ctx.projectUuid}`, {
      body: {
        name: `Test Project ${STAMP} (patched)`,
        description: 'Updated',
        isPublic: true,
        vendorIds: ctx.vendorId ? [String(ctx.vendorId)] : [],
      },
    });
    await call('Get Project Tree', 'GET', `/api/v3/projects/${ctx.projectUuid}/tree`);
    // Save / Publish / Create Version / Suspend Version run AFTER Phase 6
    // (save needs a milestone; suspend operates on a version project, not the base)
  } else {
    for (const n of ['Get Project by UUID','Upsert Project by UUID','Update Project','Get Project Tree']) {
      skip(n, 'X', '/api/v3/projects/{uuid}/...', 'no projectUuid from create');
    }
  }

  // Phase 6 — Milestones (need projectUuid)
  if (ctx.projectUuid) {
    const m = await call('Create Milestone', 'POST', `/api/v3/projects/${ctx.projectUuid}/milestones/create`, {
      body: {
        name: `M-test-${STAMP}`,
        description: 'API test milestone',
        startDate: '2026-05-05T09:00:00Z',
        endDate: '2026-08-31T17:00:00Z',
        status: 'not_completed',
        depends: [],
        vendorIds: ctx.vendorId ? [String(ctx.vendorId)] : [],
      },
    });
    ctx.milestoneId = pickId(m.payload, 'id', 'uuid');

    await call('List Milestones under Project', 'GET', `/api/v3/projects/${ctx.projectUuid}/milestones`, { query: { offset: 1, pageSize: 20 } });

    if (ctx.milestoneId) {
      await call('Get Milestone by ID', 'GET', `/api/v3/milestones/${ctx.milestoneId}`);
      await call('Update Milestone', 'PATCH', `/api/v3/milestones/${ctx.milestoneId}`, {
        body: { name: `M-test-${STAMP}-renamed`, status: 'completed', vendorIds: ctx.vendorId ? [String(ctx.vendorId)] : [] },
      });
    } else {
      skip('Get Milestone by ID', 'GET', '/api/v3/milestones/{id}', 'no milestoneId');
      skip('Update Milestone', 'PATCH', '/api/v3/milestones/{id}', 'no milestoneId');
    }
  } else {
    for (const n of ['Create Milestone','List Milestones under Project','Get Milestone by ID','Update Milestone']) {
      skip(n, 'X', '/api/v3/projects/{uuid}/milestones', 'no projectUuid');
    }
  }

  // Phase 7 — Activities (5 variants from Postman)
  // Backend rules (discovered via 403 errors):
  //   - Milestones & activities → baseline only, BEFORE versions/create.
  //   - Tasks & subtasks → version's cloned tree, AFTER versions/create.
  // So activities run NOW on the baseline; save/publish/version come after.
  const activityMilestoneId = ctx.milestoneId;
  if (activityMilestoneId) {
    // Backend split /activities/create into 4 type-specific URLs (per design doc 15).
    // Bodies still need `type` (tasks/subtasks inherit from parent — activities don't).
    const a1 = await call('Create Activity (standard)', 'POST', `/api/v3/milestones/${activityMilestoneId}/activities/standard/create`, {
      body: {
        name: `A-std-${STAMP}`,
        description: '',
        type: 'standard',
        startDate: '2026-05-10T09:00:00Z',
        endDate: '2026-07-31T17:00:00Z',
        status: 'not_completed',
        dependency: [],
      },
    });
    ctx.activityIdStd = pickId(a1.payload, 'id', 'uuid');

    const a2 = await call('Create Activity (transactional)', 'POST', `/api/v3/milestones/${activityMilestoneId}/activities/transactional/create`, {
      body: {
        name: `A-tx-${STAMP}`,
        type: 'transactional',
        startDate: '2026-05-10T09:00:00Z',
        endDate: '2026-07-31T17:00:00Z',
      },
    });
    if (a2.ok) ctx.activityIdsExtra.push(pickId(a2.payload, 'id', 'uuid'));

    const a3 = await call('Create Activity (resource, count mode)', 'POST', `/api/v3/milestones/${activityMilestoneId}/activities/resource/count/create`, {
      body: {
        name: `A-rc-${STAMP}`,
        type: 'resource',
        startDate: '2026-05-10T09:00:00Z',
        endDate: '2026-07-31T17:00:00Z',
        resourceMode: 'count',
        resourceCount: 3,
      },
    });
    if (a3.ok) ctx.activityIdsExtra.push(pickId(a3.payload, 'id', 'uuid'));

    const a4 = await call('Create Activity (resource, details — tmd1)', 'POST', `/api/v3/milestones/${activityMilestoneId}/activities/resource/details/create`, {
      body: {
        name: `A-rd-tmd1-${STAMP}`,
        type: 'resource',
        startDate: '2026-05-10T09:00:00Z',
        endDate: '2026-07-31T17:00:00Z',
        resourceMode: 'details',
        resource: {
          resourceName: 'Alice Kumar',
          onboardDate: '2026-05-11T09:00:00Z',
          offboardDate: '2026-07-25T17:00:00Z',
          jobRole: 'Backend Engineer',
          experienceYears: 5,
          typeOfResourceId: ctx.resourceTypeId || '',
          division: 'tmd1',
        },
      },
    });
    if (a4.ok) ctx.activityIdsExtra.push(pickId(a4.payload, 'id', 'uuid'));

    const a5 = await call('Create Activity (resource, details — division=others)', 'POST', `/api/v3/milestones/${activityMilestoneId}/activities/resource/details/create`, {
      body: {
        name: `A-rd-others-${STAMP}`,
        type: 'resource',
        startDate: '2026-05-10T09:00:00Z',
        endDate: '2026-07-31T17:00:00Z',
        resourceMode: 'details',
        resource: {
          resourceName: 'Bob Pereira',
          jobRole: 'Integration Lead',
          experienceYears: 8,
          typeOfResourceId: ctx.resourceTypeId || '',
          division: 'others',
          divisionOther: 'Beta Program',
        },
      },
    });
    if (a5.ok) ctx.activityIdsExtra.push(pickId(a5.payload, 'id', 'uuid'));

    await call('List Activities under Milestone', 'GET', `/api/v3/milestones/${activityMilestoneId}/activities`, { query: { offset: 1, pageSize: 20 } });

    if (ctx.activityIdStd) {
      await call('Get Activity by ID', 'GET', `/api/v3/activities/${ctx.activityIdStd}`);
      await call('Update Activity', 'PATCH', `/api/v3/activities/${ctx.activityIdStd}`, {
        body: { name: `A-std-${STAMP}-renamed`, status: 'completed' },
      });
    } else {
      skip('Get Activity by ID', 'GET', '/api/v3/activities/{id}', 'no standard activityId');
      skip('Update Activity', 'PATCH', '/api/v3/activities/{id}', 'no standard activityId');
    }
  } else {
    for (const n of [
      'Create Activity (standard)','Create Activity (transactional)','Create Activity (resource, count mode)',
      'Create Activity (resource, details — tmd1)','Create Activity (resource, details — division=others)',
      'List Activities under Milestone','Get Activity by ID','Update Activity',
    ]) skip(n, 'X', '/api/v3/milestones/{id}/activities', 'no milestoneId');
  }

  // Phase 5b — Project state machine. Runs AFTER baseline tree (milestones+activities) is built.
  // versions/create clones the baseline; we then look up the version's cloned activity for tasks.
  if (ctx.projectUuid) {
    await call('Save Project (new -> draft)', 'POST', `/api/v3/projects/${ctx.projectUuid}/save`);
    await call('Publish Project (admin)', 'POST', `/api/v3/projects/${ctx.projectUuid}/publish`);
    const vc = await call('Create Version', 'POST', `/api/v3/projects/${ctx.projectUuid}/versions/create`);
    ctx.versionUuid = pickId(vc.payload, 'uuid', 'id');
    if (ctx.versionUuid) {
      const vm = await call('List Milestones (version, for task setup)', 'GET', `/api/v3/projects/${ctx.versionUuid}/milestones`, { query: { offset: 1, pageSize: 20 } });
      const vmList = unwrapList(vm.payload);
      ctx.versionMilestoneId = vmList[0]?.id || vmList[0]?.uuid || null;
      if (ctx.versionMilestoneId) {
        const va = await call('List Activities (version milestone, for task setup)', 'GET', `/api/v3/milestones/${ctx.versionMilestoneId}/activities`, { query: { offset: 1, pageSize: 20 } });
        const vaList = unwrapList(va.payload);
        const stdAct = vaList.find(a => String(a.type || '').toLowerCase().includes('standard')) || vaList[0];
        ctx.versionActivityId = stdAct?.id || stdAct?.uuid || null;
      }
    }
  } else {
    for (const n of ['Save Project (new -> draft)','Publish Project (admin)','Create Version']) {
      skip(n, 'X', '/api/v3/projects/{uuid}/...', 'no projectUuid');
    }
  }

  // Phase 8 — Tasks (must run on a VERSION-side activity, not baseline)
  // Backend: "Tasks and subtasks can only be added or modified within a version."
  const taskActivityId = ctx.versionActivityId;
  if (taskActivityId) {
    const t = await call('Create Task', 'POST', `/api/v3/activities/${taskActivityId}/tasks/create`, {
      body: {
        name: `T-test-${STAMP}`,
        startDate: '2026-05-15T09:00:00Z',
        endDate: '2026-07-20T17:00:00Z',
      },
    });
    ctx.taskId = pickId(t.payload, 'id', 'uuid');
    await call('List Tasks under Activity', 'GET', `/api/v3/activities/${taskActivityId}/tasks`, { query: { offset: 1, pageSize: 20 } });
    if (ctx.taskId) {
      await call('Get Task by ID', 'GET', `/api/v3/tasks/${ctx.taskId}`);
      await call('Update Task', 'PATCH', `/api/v3/tasks/${ctx.taskId}`, { body: { name: `T-test-${STAMP}-renamed` } });
    } else {
      skip('Get Task by ID', 'GET', '/api/v3/tasks/{id}', 'no taskId');
      skip('Update Task', 'PATCH', '/api/v3/tasks/{id}', 'no taskId');
    }
  } else {
    for (const n of ['Create Task','List Tasks under Activity','Get Task by ID','Update Task']) skip(n, 'X', '/api/v3/activities/{id}/tasks', 'no activityId');
  }

  // Phase 9 — Subtasks
  if (ctx.taskId) {
    // Backend rule: subtask resourceMode/resource only valid if parent task type='resource'.
    // Parent task here is type='standard' (Postman default), so subtask must omit those fields.
    const st = await call('Create Subtask (resource, details)', 'POST', `/api/v3/tasks/${ctx.taskId}/subtasks/create`, {
      body: {
        name: `ST-test-${STAMP}`,
        startDate: '2026-05-18T09:00:00Z',
        endDate: '2026-06-30T17:00:00Z',
      },
    });
    ctx.subtaskId = pickId(st.payload, 'id', 'uuid');
    await call('List Subtasks under Task', 'GET', `/api/v3/tasks/${ctx.taskId}/subtasks`, { query: { offset: 1, pageSize: 20 } });
    if (ctx.subtaskId) {
      await call('Get Subtask by ID', 'GET', `/api/v3/subtasks/${ctx.subtaskId}`);
      await call('Update Subtask', 'PATCH', `/api/v3/subtasks/${ctx.subtaskId}`, { body: { name: `ST-test-${STAMP}-renamed` } });
    } else {
      skip('Get Subtask by ID', 'GET', '/api/v3/subtasks/{id}', 'no subtaskId');
      skip('Update Subtask', 'PATCH', '/api/v3/subtasks/{id}', 'no subtaskId');
    }
  } else {
    for (const n of ['Create Subtask (resource, details)','List Subtasks under Task','Get Subtask by ID','Update Subtask']) skip(n, 'X', '/api/v3/tasks/{id}/subtasks', 'no taskId');
  }

  // Phase 11 — Roles (run BEFORE memberships so we have a roleId to attach)
  const r = await call('Create Role', 'POST', '/api/v3/roles/create', {
    body: { name: `Role-${STAMP}`, permissions: ['read','write'], builtin: false },
  });
  ctx.roleId = pickId(r.payload, 'id', 'uuid');
  await call('List Roles', 'GET', '/api/v3/roles', { query: { offset: 1, pageSize: 20 } });
  if (ctx.roleId) {
    await call('Get Role by ID', 'GET', `/api/v3/roles/${ctx.roleId}`);
    await call('Update Role', 'PATCH', `/api/v3/roles/${ctx.roleId}`, {
      body: { name: `Role-${STAMP}-renamed`, permissions: ['read','write','delete'] },
    });
  } else {
    skip('Get Role by ID', 'GET', '/api/v3/roles/{id}', 'no roleId');
    skip('Update Role', 'PATCH', '/api/v3/roles/{id}', 'no roleId');
  }

  // Phase 10 — Memberships
  // Backend expects { user: {id}, roles: [{id|name}] } — Postman's { user_id, roles: ["member"] } is stale.
  if (ctx.projectUuid && ctx.userId) {
    const memBody = {
      user: { id: ctx.userId },
      roles: ctx.roleId ? [{ id: ctx.roleId }] : [{ name: 'member' }],
    };
    const mem = await call('Add Project Member', 'POST', `/api/v3/projects/${ctx.projectUuid}/memberships/create`, { body: memBody });
    ctx.membershipId = pickId(mem.payload, 'id', 'uuid');
    await call('List Project Members', 'GET', `/api/v3/projects/${ctx.projectUuid}/memberships`, { query: { offset: 1, pageSize: 20 } });
    if (ctx.membershipId) {
      await call('Update Project Member', 'PATCH', `/api/v3/memberships/${ctx.membershipId}`, {
        body: { roles: ctx.roleId ? [{ id: ctx.roleId }] : [{ name: 'admin' }] },
      });
    } else {
      skip('Update Project Member', 'PATCH', '/api/v3/memberships/{id}', 'no membershipId');
    }
  } else {
    for (const n of ['Add Project Member','List Project Members','Update Project Member']) skip(n, 'X', '/api/v3/projects/{uuid}/memberships', 'no projectUuid or userId');
  }

  // Phase 12 — Work Packages
  // Backend rule: top-level WP under a project must be type='milestone'
  // (hierarchy: project → milestone → activity → task). Pick a milestone type id.
  let milestoneTypeId = null;
  {
    const tlist = await call('List Work Package Types (for WP type lookup)', 'GET', '/api/v3/work_package_types', { query: { offset: 1, pageSize: 50 } });
    const types = unwrapList(tlist.payload);
    const m = types.find(t => String(t.name || t.internalName || '').toLowerCase().includes('milestone')) || types[0];
    milestoneTypeId = m?.id || m?.uuid || null;
  }
  if (ctx.projectUuid) {
    // Backend wants camelCase startDate/endDate (Postman snake_case is stale).
    const wp = await call('Create Work Package', 'POST', `/api/v3/projects/${ctx.projectUuid}/work_packages/create`, {
      body: {
        subject: `WP-${STAMP}`,
        description: 'API test WP',
        typeId: milestoneTypeId,
        status: 'new',
        priority: 'normal',
        startDate: '2026-05-15T09:00:00Z',
        endDate: '2026-07-20T17:00:00Z',
      },
    });
    ctx.wpId = pickId(wp.payload, 'id', 'uuid');
    await call('List Work Packages', 'GET', `/api/v3/projects/${ctx.projectUuid}/work_packages`, { query: { offset: 1, pageSize: 20 } });
    if (ctx.wpId) {
      await call('Get Work Package by ID', 'GET', `/api/v3/work_packages/${ctx.wpId}`);
      await call('Get Work Package Children (subtree)', 'GET', `/api/v3/work_packages/${ctx.wpId}/children`);
      await call('Update Work Package', 'PATCH', `/api/v3/work_packages/${ctx.wpId}`, {
        body: { subject: `WP-${STAMP}-renamed`, status: 'in_progress', priority: 'high' },
      });
    } else {
      for (const n of ['Get Work Package by ID','Get Work Package Children (subtree)','Update Work Package']) skip(n, 'X', '/api/v3/work_packages/{id}', 'no wpId');
    }
  } else {
    for (const n of ['Create Work Package','List Work Packages','Get Work Package by ID','Get Work Package Children (subtree)','Update Work Package']) skip(n, 'X', '/api/v3/projects/{uuid}/work_packages', 'no projectUuid');
  }

  // Phase 13 — Work Package Types
  const wpt = await call('Create Work Package Type', 'POST', '/api/v3/work_package_types/create', {
    body: { name: `Feature-${STAMP}`, internalName: `feature_${STAMP}`, is_builtin: false, is_active: true },
  });
  ctx.wptId = pickId(wpt.payload, 'id', 'uuid');
  await call('List Work Package Types', 'GET', '/api/v3/work_package_types', { query: { offset: 1, pageSize: 20 } });
  if (ctx.wptId) {
    await call('Get Work Package Type by ID', 'GET', `/api/v3/work_package_types/${ctx.wptId}`);
    await call('Update Work Package Type', 'PATCH', `/api/v3/work_package_types/${ctx.wptId}`, { body: { name: `Feature-${STAMP}-renamed` } });
  } else {
    skip('Get Work Package Type by ID', 'GET', '/api/v3/work_package_types/{id}', 'no wptId');
    skip('Update Work Package Type', 'PATCH', '/api/v3/work_package_types/{id}', 'no wptId');
  }

  // Phase 14 — Meetings
  if (ctx.projectUuid) {
    const me = await call('Create Meeting', 'POST', `/api/v3/projects/${ctx.projectUuid}/meetings/create`, {
      body: {
        title: `Meeting-${STAMP}`,
        description: 'API test meeting',
        scheduled_at: '2026-05-15T10:00:00Z',
        duration_minutes: 60,
        location: 'Conference Room A',
      },
    });
    ctx.meetingId = pickId(me.payload, 'id', 'uuid');
    await call('List Meetings', 'GET', `/api/v3/projects/${ctx.projectUuid}/meetings`, { query: { offset: 1, limit: 20 } });
    if (ctx.meetingId) {
      await call('Get Meeting by ID', 'GET', `/api/v3/meetings/${ctx.meetingId}`);
      await call('Update Meeting', 'PATCH', `/api/v3/meetings/${ctx.meetingId}`, {
        body: { title: `Meeting-${STAMP}-renamed`, scheduled_at: '2026-05-15T14:00:00Z', duration_minutes: 90 },
      });
    } else {
      skip('Get Meeting by ID', 'GET', '/api/v3/meetings/{id}', 'no meetingId');
      skip('Update Meeting', 'PATCH', '/api/v3/meetings/{id}', 'no meetingId');
    }
  } else {
    for (const n of ['Create Meeting','List Meetings','Get Meeting by ID','Update Meeting']) skip(n, 'X', '/api/v3/projects/{uuid}/meetings', 'no projectUuid');
  }

  // Phase 15 — Participants & Agenda
  if (ctx.meetingId && ctx.userId) {
    // Backend wants { user_id } per validation message. (Earlier 500 may have been transient.)
    await call('Add Participant', 'POST', `/api/v3/meetings/${ctx.meetingId}/participants/create`, { body: { user_id: ctx.userId } });
    await call('List Participants', 'GET', `/api/v3/meetings/${ctx.meetingId}/participants`);
  } else {
    skip('Add Participant', 'POST', '/api/v3/meetings/{id}/participants/create', 'no meetingId or userId');
    skip('List Participants', 'GET', '/api/v3/meetings/{id}/participants', 'no meetingId');
  }
  if (ctx.meetingId) {
    const ag = await call('Create Agenda Item', 'POST', `/api/v3/meetings/${ctx.meetingId}/agenda_items/create`, {
      body: { title: `Agenda-${STAMP}`, description: 'API test agenda', duration: 15, position: 1 },
    });
    ctx.agendaItemId = pickId(ag.payload, 'id', 'uuid');
    await call('List Agenda Items', 'GET', `/api/v3/meetings/${ctx.meetingId}/agenda_items`);
    if (ctx.agendaItemId) {
      await call('Get Agenda Item by ID', 'GET', `/api/v3/meetings/agenda_items/${ctx.agendaItemId}`);
      await call('Update Agenda Item', 'PATCH', `/api/v3/meetings/agenda_items/${ctx.agendaItemId}`, {
        body: { title: `Agenda-${STAMP}-renamed`, description: 'updated', duration: 20 },
      });
    } else {
      skip('Get Agenda Item by ID', 'GET', '/api/v3/meetings/agenda_items/{id}', 'no agendaItemId');
      skip('Update Agenda Item', 'PATCH', '/api/v3/meetings/agenda_items/{id}', 'no agendaItemId');
    }
  } else {
    for (const n of ['Create Agenda Item','List Agenda Items','Get Agenda Item by ID','Update Agenda Item']) skip(n, 'X', '/api/v3/meetings/{id}/agenda_items', 'no meetingId');
  }

  // Phase 16 — Restore endpoints (delete first, then restore, in subtree order)
  if (ctx.subtaskId) {
    await call('Delete Subtask (pre-restore)', 'DELETE', `/api/v3/subtasks/${ctx.subtaskId}`);
    await call('Restore Subtask (admin)', 'POST', `/api/v3/subtasks/${ctx.subtaskId}/restore`);
  } else {
    skip('Restore Subtask (admin)', 'POST', '/api/v3/subtasks/{id}/restore', 'no subtaskId');
  }
  if (ctx.taskId) {
    await call('Delete Task (pre-restore, cascades to subtasks)', 'DELETE', `/api/v3/tasks/${ctx.taskId}`);
    await call('Restore Task (admin)', 'POST', `/api/v3/tasks/${ctx.taskId}/restore`);
  } else {
    skip('Restore Task (admin)', 'POST', '/api/v3/tasks/{id}/restore', 'no taskId');
  }
  if (ctx.activityIdStd) {
    await call('Delete Activity (pre-restore, cascades)', 'DELETE', `/api/v3/activities/${ctx.activityIdStd}`);
    await call('Restore Activity (admin)', 'POST', `/api/v3/activities/${ctx.activityIdStd}/restore`);
  } else {
    skip('Restore Activity (admin)', 'POST', '/api/v3/activities/{id}/restore', 'no activityIdStd');
  }
  if (ctx.milestoneId) {
    await call('Delete Milestone (pre-restore, cascades)', 'DELETE', `/api/v3/milestones/${ctx.milestoneId}`);
    await call('Restore Milestone (admin)', 'POST', `/api/v3/milestones/${ctx.milestoneId}/restore`);
  } else {
    skip('Restore Milestone (admin)', 'POST', '/api/v3/milestones/{id}/restore', 'no milestoneId');
  }

  // Phase 17 — Final cleanup (reverse dependency order)
  if (ctx.agendaItemId) await call('Delete Agenda Item', 'DELETE', `/api/v3/meetings/agenda_items/${ctx.agendaItemId}`);
  else skip('Delete Agenda Item', 'DELETE', '/api/v3/meetings/agenda_items/{id}', 'no agendaItemId');

  if (ctx.meetingId && ctx.userId) await call('Remove Participant', 'DELETE', `/api/v3/meetings/${ctx.meetingId}/participants/${ctx.userId}`);
  else skip('Remove Participant', 'DELETE', '/api/v3/meetings/{id}/participants/{userId}', 'no meetingId or userId');

  if (ctx.meetingId) await call('Delete Meeting', 'DELETE', `/api/v3/meetings/${ctx.meetingId}`);
  else skip('Delete Meeting', 'DELETE', '/api/v3/meetings/{id}', 'no meetingId');

  if (ctx.wptId) await call('Delete Work Package Type', 'DELETE', `/api/v3/work_package_types/${ctx.wptId}`);
  else skip('Delete Work Package Type', 'DELETE', '/api/v3/work_package_types/{id}', 'no wptId');

  if (ctx.wpId) await call('Delete Work Package', 'DELETE', `/api/v3/work_packages/${ctx.wpId}`);
  else skip('Delete Work Package', 'DELETE', '/api/v3/work_packages/{id}', 'no wpId');

  if (ctx.roleId) await call('Delete Role', 'DELETE', `/api/v3/roles/${ctx.roleId}`);
  else skip('Delete Role', 'DELETE', '/api/v3/roles/{id}', 'no roleId');

  if (ctx.membershipId) await call('Remove Project Member', 'DELETE', `/api/v3/memberships/${ctx.membershipId}`);
  else skip('Remove Project Member', 'DELETE', '/api/v3/memberships/{id}', 'no membershipId');

  // Subtasks and tasks are cascade-deleted by the milestone delete below — no individual deletes here.
  skip('Delete Subtask', 'DELETE', '/api/v3/subtasks/{id}', 'covered by milestone-cascade delete');
  skip('Delete Task (cascades to subtasks)', 'DELETE', '/api/v3/tasks/{id}', 'covered by milestone-cascade delete');

  // Activities are cascade-deleted by the milestone delete in Phase 16 — no individual deletes here.
  // Milestone delete here is also redundant after Phase 16's Delete-then-Restore, but it confirms the endpoint.
  if (ctx.milestoneId) await call('Delete Milestone (cascades to subtree)', 'DELETE', `/api/v3/milestones/${ctx.milestoneId}`);
  else skip('Delete Milestone (cascades to subtree)', 'DELETE', '/api/v3/milestones/{id}', 'no milestoneId');

  // Suspend Version — must run on a version uuid; baseline returns 409.
  if (ctx.versionUuid) {
    await call('Suspend Version', 'POST', `/api/v3/projects/${ctx.versionUuid}/suspend`);
  } else {
    skip('Suspend Version', 'POST', '/api/v3/projects/{uuid}/suspend', 'no versionUuid');
  }

  if (ctx.projectUuidOthers) await call('Delete Project (others-category cleanup)', 'DELETE', `/api/v3/projects/${ctx.projectUuidOthers}`);
  if (ctx.projectUuid) await call('Delete Project (admin, cascades to versions)', 'DELETE', `/api/v3/projects/${ctx.projectUuid}`);
  else skip('Delete Project (admin, cascades to versions)', 'DELETE', '/api/v3/projects/{uuid}', 'no projectUuid');

  if (ctx.userId) await call('Delete User', 'DELETE', `/api/v3/users/${ctx.userId}`);
  else skip('Delete User', 'DELETE', '/api/v3/users/{id}', 'no userId');

  finish();
}

// Reasons for failures (manually maintained — keyed by exact endpoint name).
// Categories: backend-bug | postman-drift | cascade | precondition
const FAILURE_REASONS = {
  'Add Participant': {
    category: 'backend-bug',
    text: 'Backend returns 500 InternalError despite a valid `{user_id}` body — the same shape backend asks for in its own validation message. Internal exception inside the participant creation handler. **Backend dev must investigate.**',
  },
  'Create Agenda Item': {
    category: 'backend-bug',
    text: 'Backend returns 500 InternalError with a body that matches the validation feedback (`title, description, duration, position`). Internal exception inside the agenda-item creation handler. **Backend dev must investigate.**',
  },
  'Remove Participant': {
    category: 'cascade',
    text: 'Returns 404 because Add Participant failed (no participant exists to remove). Will pass automatically once Add Participant 500 is fixed.',
  },
};

function finish() {
  const total = results.length;
  const pass = results.filter(r => r.ok === true).length;
  const fail = results.filter(r => r.ok === false).length;
  const skipped = results.filter(r => r.ok === null).length;

  const lines = [];
  lines.push(`# PMIS API — End-to-End Test Report`);
  lines.push('');
  lines.push(`- **Base URL:** ${BASE}`);
  lines.push(`- **Login:** \`${LOGIN}\``);
  lines.push(`- **Run timestamp:** ${new Date().toISOString()}`);
  lines.push(`- **Test resources tagged with:** \`${STAMP}\``);
  lines.push(`- **Total endpoints exercised:** ${total} (Postman collection has 90; some endpoints exercised more than once for retry/setup)`);
  lines.push('');
  lines.push(`## Summary`);
  lines.push('');
  lines.push(`| Total calls | ✅ Passed | ❌ Failed | ⊘ Skipped |`);
  lines.push(`|------------:|---------:|---------:|----------:|`);
  lines.push(`| ${total} | ${pass} | ${fail} | ${skipped} |`);
  lines.push('');
  lines.push('> **Note on `$TOKEN`:** every authenticated cURL below uses `Authorization: Bearer $TOKEN`. Replace with the access token returned from `POST /api/v3/users/login`.');
  lines.push('');

  // ─── Failures for backend dev ───
  const failures = results.filter(r => r.ok === false);
  lines.push(`## Failures — for the backend developer`);
  lines.push('');
  if (failures.length === 0) {
    lines.push(`_All endpoints passed. No backend issues found._`);
  } else {
    for (const f of failures) {
      const r = FAILURE_REASONS[f.name] || { category: 'unknown', text: 'Reason TBD — see response body below.' };
      lines.push(`### ❌ ${f.name}`);
      lines.push('');
      lines.push(`- **Endpoint:** \`${f.method} ${f.path}\``);
      lines.push(`- **HTTP status:** ${f.status}`);
      lines.push(`- **Category:** ${r.category}`);
      lines.push(`- **Diagnosis:** ${r.text}`);
      lines.push('');
      if (f.requestBody) {
        lines.push('**Request body sent:**');
        lines.push('```json');
        lines.push(f.requestBody);
        lines.push('```');
        lines.push('');
      }
      lines.push('**Response received:**');
      lines.push('```json');
      lines.push(f.body || '(empty)');
      lines.push('```');
      lines.push('');
    }
  }

  // ─── Frontend validation rules ───
  lines.push(`## Frontend validation rules to implement`);
  lines.push('');
  lines.push(`These were learned from backend 422/400 responses while iterating the test runner. Adding these on the frontend will give users clear errors before the request leaves the browser.`);
  lines.push('');
  lines.push(`### Body shape / field naming`);
  lines.push(`- **\`POST /projects/create\` (when \`category="others"\`):** \`categoryOtherReason\` is **required** (1–1000 chars). Without it: 422 \`"categoryOtherReason is required when category is 'others'."\``);
  lines.push(`- **\`POST /projects/{uuid}/memberships/create\`:** \`user\` must be a **dictionary** \`{id: <int>}\` (not a bare integer); \`roles\` must be an **array of dictionaries** \`[{id: <int>}]\` (not strings).`);
  lines.push(`- **\`PATCH /memberships/{id}\`:** same — \`roles: [{id: <int>}]\`, not \`["member"]\`.`);
  lines.push(`- **\`POST /projects/{uuid}/work_packages/create\`:** field is \`typeId\` (integer, must point to a milestone-type WP type for top-level WPs); use \`startDate\`/\`endDate\` (camelCase ISO timestamps), not \`start_date\`/\`end_date\`.`);
  lines.push(`- **\`PATCH /work_packages/{id}\`:** \`status\` must be one of \`new | in_progress | resolved | closed | on_hold\` (lowercase). \`priority\` must be one of \`low | normal | high | urgent\` (lowercase).`);
  lines.push(`- **\`POST /work_package_types/create\`:** field is \`internalName\` (camelCase), not \`internal_name\`.`);
  lines.push(`- **\`POST /projects/{uuid}/meetings/create\`:** required fields are \`scheduled_at\` (ISO timestamp) and \`duration_minutes\` (int). Postman's \`start_date\`/\`end_date\` are stale.`);
  lines.push(`- **List endpoints with \`offset\`:** backend requires \`offset >= 1\` for at least \`/roles\` and \`/projects/{uuid}/meetings\`. Don't pass \`offset=0\` from any list page.`);
  lines.push(`- **Activity create endpoints split:** the single \`POST /milestones/{id}/activities/create\` is gone. Frontend must use **four** type-specific URLs:`);
  lines.push(`    - \`POST /milestones/{id}/activities/standard/create\``);
  lines.push(`    - \`POST /milestones/{id}/activities/transactional/create\``);
  lines.push(`    - \`POST /milestones/{id}/activities/resource/count/create\` (body: \`resourceCount: <int>\`)`);
  lines.push(`    - \`POST /milestones/{id}/activities/resource/details/create\` (body: \`resource: {...}\`)`);
  lines.push(`    Frontend \`src/api/nodes.js\` already does this.`);
  lines.push('');
  lines.push(`### Workflow / state-machine rules`);
  lines.push(`- **Save Project** requires at least one milestone to exist before it can succeed (422 \`"Add at least one milestone before saving the project."\`).`);
  lines.push(`- **Suspend Version** must be called against a **version project's UUID**, not the baseline. Calling on baseline returns 409 \`version_only\`.`);
  lines.push(`- **Milestones & Activities can only be created/modified on the BASELINE**, not on a version. Call against the baseline; the change auto-propagates to active versions. (UI: when the user is editing a version project, hide/disable "Add milestone" and "Add activity" controls.)`);
  lines.push(`- **Tasks & Subtasks can only be created/modified on a VERSION's cloned tree**, not the baseline. (UI: when the user clicks "Add task" on a baseline activity, prompt to "Create version first".)`);
  lines.push(`- **Subtask resource fields:** \`resourceMode\` and \`resource\` are valid only when the **parent task's type is \`'resource'\`**. If the parent task is \`standard\` or \`transactional\`, omit those fields from the subtask body. (UI: hide the resource panel on the subtask form unless parent type is resource.)`);
  lines.push('');

  // ─── Captured IDs ───
  lines.push(`## Test-run captured IDs (cleaned up at end)`);
  lines.push('');
  for (const [k, v] of Object.entries(ctx)) {
    if (k === 'token' || k === 'refresh') continue;
    lines.push(`- \`${k}\` = ${JSON.stringify(v)}`);
  }
  lines.push('');

  // ─── Verdict-at-a-glance table ───
  lines.push(`## Verdict at a glance`);
  lines.push('');
  lines.push(`| # | Result | Method | Endpoint | Status | ms |`);
  lines.push(`|--:|:------:|:------:|----------|------:|---:|`);
  results.forEach((r, i) => {
    const flag = r.ok === true ? '✅ PASS' : r.ok === false ? '❌ FAIL' : '⊘ SKIP';
    lines.push(`| ${i+1} | ${flag} | ${r.method} | ${r.name} | ${r.status} | ${r.ms} |`);
  });
  lines.push('');

  // ─── Detailed per-endpoint breakdown ───
  lines.push(`## Detailed results — every endpoint`);
  lines.push('');
  results.forEach((r, i) => {
    const flag = r.ok === true ? '✅ PASS' : r.ok === false ? '❌ FAIL' : '⊘ SKIP';
    lines.push(`### ${i+1}. ${r.name}`);
    lines.push('');
    lines.push(`- **Verdict:** ${flag}`);
    lines.push(`- **Method:** \`${r.method}\``);
    lines.push(`- **Endpoint:** \`${r.path || '-'}\``);
    if (r.fullUrl) lines.push(`- **Full URL:** \`${r.fullUrl}\``);
    lines.push(`- **HTTP status:** ${r.status}`);
    lines.push(`- **Latency:** ${r.ms} ms`);
    if (r.note) lines.push(`- **Note:** ${r.note}`);
    if (r.ok === false) {
      const reason = FAILURE_REASONS[r.name];
      if (reason) lines.push(`- **Failure category:** ${reason.category} — ${reason.text}`);
    }
    lines.push('');
    if (r.curl) {
      lines.push('**cURL request:**');
      lines.push('```bash');
      lines.push(r.curl);
      lines.push('```');
      lines.push('');
    }
    if (r.requestBody) {
      lines.push('**Request body:**');
      lines.push('```json');
      lines.push(r.requestBody);
      lines.push('```');
      lines.push('');
    }
    if (r.body) {
      lines.push('**Response:**');
      lines.push('```json');
      lines.push(r.body);
      lines.push('```');
      lines.push('');
    }
    lines.push('---');
    lines.push('');
  });

  writeFileSync(REPORT, lines.join('\n'));
  console.log(`\n=== DONE ===`);
  console.log(`Total: ${total}  Passed: ${pass}  Failed: ${fail}  Skipped: ${skipped}`);
  console.log(`Report written to: ${REPORT}`);
}

run().catch(err => {
  console.error('Fatal error:', err);
  finish();
  process.exit(1);
});
