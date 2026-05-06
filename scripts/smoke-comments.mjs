#!/usr/bin/env node
/* Quick smoke for the comment-on-save flow exercised by issue #94.
   Logs in, finds a milestone, posts a comment, lists comments to verify.   */

const BASE = process.env.PMIS_BASE || 'http://10.1.131.199:8000';
const USER = process.env.PMIS_USER || 'admin';
const PASS = process.env.PMIS_PASS || 'admin123';

const G = '\x1b[32m', R = '\x1b[31m', Y = '\x1b[33m', D = '\x1b[90m', X = '\x1b[0m';

async function call(label, method, path, { body, token, expectError } = {}) {
  const init = { method, headers: { 'Content-Type': 'application/json' } };
  if (token) init.headers.Authorization = `Bearer ${token}`;
  if (body !== undefined) init.body = JSON.stringify(body);
  const t0 = Date.now();
  const res = await fetch(BASE + path, init);
  const text = await res.text();
  let json = null; try { json = JSON.parse(text); } catch {}
  const ms = Date.now() - t0;
  const ok = res.ok || (expectError && !res.ok);
  console.log(`${ok ? G + '✓' : R + '✗'}${X} ${label}  ${D}${method} ${path}${X}  HTTP ${res.status} (${ms}ms)`);
  if (!ok) console.log(`    ${D}${text.slice(0, 300)}${X}`);
  return { ok, status: res.status, json, text };
}

console.log(`\n${Y}━━━ Comment-on-save smoke (#94) ━━━${X}\nTarget: ${BASE}\n`);

const login = await call('Login', 'POST', '/api/v3/users/login', { body: { login: USER, password: PASS } });
const token = login.json?.data?.access_token || login.json?.data?.token;
if (!token) { console.log(`${R}No token — abort${X}`); process.exit(1); }

const projects = await call('List projects', 'GET', '/api/v3/projects', { token });
const projectList =
  projects.json?._embedded?.elements ||
  projects.json?.data?._embedded?.elements || [];
if (!projectList.length) { console.log(`${R}No projects on backend${X}`); process.exit(0); }

let project = null, milestone = null;
for (const p of projectList) {
  if (!p?.id) continue;
  const ms = await call(`Probe milestones in ${p.name}`, 'GET', `/api/v3/projects/${p.id}/milestones`, { token });
  const list = ms.json?._embedded?.elements || ms.json?.data?._embedded?.elements || [];
  if (list.length) { project = p; milestone = list[0]; break; }
}
if (!project || !milestone?.id) {
  console.log(`${Y}No project with milestones found — create one via the UI first${X}`);
  process.exit(0);
}
console.log(`  ${D}using project:   ${project.name} (${project.id})${X}`);
console.log(`  ${D}using milestone: ${milestone.name} (${milestone.id})${X}`);

const stamp = Date.now();
const txt = `Smoke #94 comment ${stamp}`;
const fd = new FormData();
fd.append('body', txt);
const t0 = Date.now();
const postRes = await fetch(`${BASE}/api/v3/milestones/${milestone.id}/comments`, {
  method: 'POST',
  headers: { Authorization: `Bearer ${token}`, accept: 'application/json' },
  body: fd,
});
const postText = await postRes.text();
const ms2 = Date.now() - t0;
const postOk = postRes.ok;
console.log(`${postOk ? G + '✓' : R + '✗'}${X} Post comment (multipart)  ${D}POST /api/v3/milestones/${milestone.id}/comments${X}  HTTP ${postRes.status} (${ms2}ms)`);
if (!postOk) console.log(`    ${D}${postText.slice(0, 300)}${X}`);

const list = await call('List milestone comments', 'GET', `/api/v3/milestones/${milestone.id}/comments`, { token });
const items = list.json?._embedded?.elements || list.json?.data?._embedded?.elements || [];
const found = items.find((c) => (c.body || c.text) === txt);
console.log(found ? `${G}✓${X} comment round-trip verified (id=${found.id || 'n/a'})` : `${R}✗${X} comment NOT found in list`);

process.exit(postOk && found ? 0 : 1);
