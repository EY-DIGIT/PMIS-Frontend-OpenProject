#!/usr/bin/env node
/* Smoke test for the new doc-33 auth endpoints + plain login.
   Run: node scripts/smoke-auth.mjs                                          */

const BASE = process.env.PMIS_BASE || 'http://10.1.131.199:8000';
const USER = process.env.PMIS_USER || 'admin';
const PASS = process.env.PMIS_PASS || 'admin123';

const results = [];
const RESET = '\x1b[0m';
const GREEN = '\x1b[32m';
const RED = '\x1b[31m';
const YELLOW = '\x1b[33m';
const DIM = '\x1b[90m';

async function call(label, method, path, body, opts = {}) {
  const url = BASE + path;
  const init = {
    method,
    headers: { 'Content-Type': 'application/json', ...(opts.headers || {}) },
  };
  if (body !== undefined) init.body = JSON.stringify(body);
  const t0 = Date.now();
  let res, text, json;
  try {
    res = await fetch(url, init);
    text = await res.text();
    try { json = JSON.parse(text); } catch { json = null; }
  } catch (e) {
    const ms = Date.now() - t0;
    console.log(`${RED}✗${RESET} ${label}  ${DIM}${method} ${path}${RESET}  ${RED}NETWORK ${e.message}${RESET}  (${ms}ms)`);
    results.push({ label, method, path, status: 0, ok: false, body: e.message, ms });
    return { ok: false };
  }
  const ms = Date.now() - t0;
  const ok = res.ok || (opts.expectError && !res.ok);
  const mark = ok ? `${GREEN}✓${RESET}` : `${RED}✗${RESET}`;
  console.log(`${mark} ${label}  ${DIM}${method} ${path}${RESET}  ${ok ? GREEN : RED}HTTP ${res.status}${RESET}  (${ms}ms)`);
  if (!ok || process.env.VERBOSE) {
    const preview = text.length > 400 ? text.slice(0, 400) + '…' : text;
    console.log(`    ${DIM}${preview}${RESET}`);
  }
  results.push({ label, method, path, status: res.status, ok, body: json || text, ms });
  return { ok, status: res.status, json, text };
}

console.log(`\n${YELLOW}━━━ PMIS auth smoke test ━━━${RESET}`);
console.log(`Target: ${BASE}`);
console.log(`User:   ${USER}\n`);

// 1. Health
await call('Health check', 'GET', '/health');

// 2. Plain login
const login = await call('Login (plain)', 'POST', '/api/v3/users/login', { login: USER, password: PASS });
const requiresOtp = login.json?.data?.requires_otp || login.json?.requires_otp;
const ephemeral = login.json?.data?.ephemeral_token || login.json?.ephemeral_token;
const accessToken =
  login.json?.data?.token ||
  login.json?.data?.access_token ||
  login.json?.token ||
  login.json?.access_token;

if (requiresOtp) {
  console.log(`  ${YELLOW}→ 2FA branch active. ephemeral_token captured: ${(ephemeral || '').slice(0, 20)}…${RESET}`);
} else if (accessToken) {
  console.log(`  ${YELLOW}→ token-only branch (2FA disabled for this user). token: ${accessToken.slice(0, 20)}…${RESET}`);
} else {
  console.log(`  ${RED}→ neither requires_otp nor token in response — backend contract drift?${RESET}`);
}

// 3. send-otp — only valid if we got an ephemeral_token
if (ephemeral) {
  await call('Send OTP (email)', 'POST', '/api/v3/users/login/send-otp', {
    ephemeral_token: ephemeral,
    channel: 'email',
  });
} else {
  // Probe with a fake ephemeral to confirm route exists & rejects gracefully
  await call('Send OTP (fake token, expect 4xx)', 'POST', '/api/v3/users/login/send-otp', {
    ephemeral_token: 'fake-' + Date.now(),
    channel: 'email',
  }, { expectError: true });
}

// 4. verify-otp — fake code, expect 4xx
await call('Verify OTP (fake code, expect 4xx)', 'POST', '/api/v3/users/login/verify-otp', {
  ephemeral_token: ephemeral || ('fake-' + Date.now()),
  code: '000000',
}, { expectError: true });

// 5. forgot-password — backend ALWAYS returns 200 (anti-enumeration)
await call('Forgot password (real user)', 'POST', '/api/v3/users/forgot-password', {
  login_or_email: USER,
  channel: 'email',
});

await call('Forgot password (unknown user, still 200)', 'POST', '/api/v3/users/forgot-password', {
  login_or_email: 'definitely-not-a-real-user-' + Date.now(),
  channel: 'email',
});

// 6. reset-password — fake token, expect 4xx
await call('Reset password (fake token, expect 4xx)', 'POST', '/api/v3/users/reset-password', {
  token_or_code: 'fake-' + Date.now(),
  new_password: 'NewPassword!2345',
}, { expectError: true });

// Summary
console.log(`\n${YELLOW}━━━ Summary ━━━${RESET}`);
const pass = results.filter((r) => r.ok).length;
const fail = results.filter((r) => !r.ok).length;
console.log(`${GREEN}PASS: ${pass}${RESET}  ${fail ? RED + 'FAIL: ' + fail + RESET : ''}`);
process.exit(fail ? 1 : 0);
