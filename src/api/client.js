import { uiStore } from '../store/project/uiStore';

const RAW_BASE = import.meta.env.VITE_API_BASE_URL || 'http://10.1.131.199:8000/';

// Exported for modules that use raw `fetch` (e.g. milestoneConfigApi, project pages).
// Normalized to NOT end with a slash so callers can do `${API_BASE}${ENDPOINTS.x}`.
export const API_BASE = RAW_BASE.replace(/\/+$/, '');

const BASE = RAW_BASE;
const REFRESH_PATH = '/api/v3/users/refresh';

const TOKEN_KEY = 'pmis_token';
const REFRESH_KEY = 'pmis_refresh_token';
const USER_KEY = 'pmis_user';
const EXPIRES_AT_KEY = 'pmis_access_expires_at';

// Mirror keys used by auth.js so legacy callers and tab-restored sessions stay
// in sync. Read = session-first then local fallback; Write = both; Clear = both.
const LEGACY_TOKEN_KEY = 'auth_token';
const LEGACY_REFRESH_KEY = 'auth_refresh_token';
const LEGACY_USER_KEY = 'auth_user';

// Fire a same-tab signal whenever the persisted user object changes so the
// permissions module (and any other listener) can react without us
// importing it here — that import would create a cycle through auth.js.
function emitUserChanged() {
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('pmis:user-changed'));
  }
}

// Session-reset is fired on both login and logout so every client-side
// cache (DataContext, projectsStore, draftStore, uiStore, apiSync) can
// drop User A's data before User B sees it. Imported by auth.js / sessionManager.
export function notifySessionReset() {
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('pmis:session-reset'));
  }
}

export const tokenStore = {
  get: () =>
    sessionStorage.getItem(TOKEN_KEY) ||
    localStorage.getItem(TOKEN_KEY) ||
    localStorage.getItem(LEGACY_TOKEN_KEY) ||
    null,
  set: (t) => {
    sessionStorage.setItem(TOKEN_KEY, t);
    localStorage.setItem(TOKEN_KEY, t);
    localStorage.setItem(LEGACY_TOKEN_KEY, t);
  },
  clear: () => {
    sessionStorage.removeItem(TOKEN_KEY);
    sessionStorage.removeItem(REFRESH_KEY);
    sessionStorage.removeItem(USER_KEY);
    sessionStorage.removeItem(EXPIRES_AT_KEY);
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(REFRESH_KEY);
    localStorage.removeItem(USER_KEY);
    localStorage.removeItem(EXPIRES_AT_KEY);
    localStorage.removeItem(LEGACY_TOKEN_KEY);
    localStorage.removeItem(LEGACY_REFRESH_KEY);
    localStorage.removeItem(LEGACY_USER_KEY);
    emitUserChanged();
  },
  getRefresh: () =>
    sessionStorage.getItem(REFRESH_KEY) ||
    localStorage.getItem(REFRESH_KEY) ||
    localStorage.getItem(LEGACY_REFRESH_KEY) ||
    null,
  setRefresh: (t) => {
    sessionStorage.setItem(REFRESH_KEY, t);
    localStorage.setItem(REFRESH_KEY, t);
    localStorage.setItem(LEGACY_REFRESH_KEY, t);
  },
  getUser: () => {
    const raw =
      sessionStorage.getItem(USER_KEY) ||
      localStorage.getItem(USER_KEY) ||
      localStorage.getItem(LEGACY_USER_KEY);
    try { return raw ? JSON.parse(raw) : null; } catch { return null; }
  },
  setUser: (u) => {
    const v = JSON.stringify(u || null);
    sessionStorage.setItem(USER_KEY, v);
    localStorage.setItem(USER_KEY, v);
    localStorage.setItem(LEGACY_USER_KEY, v);
    emitUserChanged();
  },
  getExpiresAt: () => {
    const v =
      sessionStorage.getItem(EXPIRES_AT_KEY) ||
      localStorage.getItem(EXPIRES_AT_KEY);
    const n = v ? parseInt(v, 10) : 0;
    return Number.isFinite(n) ? n : 0;
  },
  setExpiresAt: (epochMs) => {
    if (!epochMs) return;
    const v = String(epochMs);
    sessionStorage.setItem(EXPIRES_AT_KEY, v);
    localStorage.setItem(EXPIRES_AT_KEY, v);
  },
};

// Pull an absolute "access token expires at" epoch (ms) from a server payload
// that may use either ISO `accessTokenExpiresAt` or `expiresInSeconds`.
export function readExpiresAt(payload) {
  if (!payload) return 0;
  if (payload.accessTokenExpiresAt) {
    const t = Date.parse(payload.accessTokenExpiresAt);
    if (Number.isFinite(t)) return t;
  }
  if (payload.expiresInSeconds) {
    const s = Number(payload.expiresInSeconds);
    if (Number.isFinite(s) && s > 0) return Date.now() + s * 1000;
  }
  return 0;
}

export class ApiError extends Error {
  constructor(message, { status, body } = {}) {
    super(message);
    this.status = status;
    this.body = body;
  }
}

// Global 401 handler: when an authenticated call fails auth after the
// refresh attempt, surface a single popup and bounce the user to /login
// once they click OK. Guarded so multiple concurrent 401s don't queue up
// duplicate popups or duplicate redirects.
let authErrorNotified = false;
function notifyAuthError(message) {
  if (authErrorNotified) return;
  if (typeof window === 'undefined') return;
  const path = window.location.pathname || '';
  // Public auth pages don't need this — a bad login already shows its
  // own error, and we don't want a redirect loop on /login itself.
  if (
    path === '/login' ||
    path.startsWith('/forgot-password') ||
    path.startsWith('/reset-password')
  ) return;
  authErrorNotified = true;
  tokenStore.clear();
  const body = (typeof message === 'string' && message) || 'Authentication required';
  uiStore.showError(`Session Expired\n${body}. Please log in again.`, () => {
    authErrorNotified = false;
    window.location.href = '/login';
  });
}

// Single-flight dedup: parallel requests that all hit 401 share one refresh.
let refreshInFlight = null;

export function refreshAccessToken() {
  if (refreshInFlight) return refreshInFlight;
  const refresh = tokenStore.getRefresh();
  if (!refresh) return Promise.resolve(null);

  refreshInFlight = (async () => {
    try {
      const url = API_BASE + REFRESH_PATH;
      // Backend accepts (and may require) the still-valid-ish bearer header
      // alongside the refresh body — match the working curl exactly.
      const headers = {
        'Content-Type': 'application/json',
        Accept: 'application/json',
      };
      const stale = tokenStore.get();
      if (stale) headers.Authorization = `Bearer ${stale}`;

      const res = await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify({ refresh_token: refresh }),
      });
      if (res.status === 401) {
        // Server says this refresh credential is dead. Hanging on to it just
        // guarantees the next tick fires another doomed /refresh.
        const body = await res.text().catch(() => '');
        // eslint-disable-next-line no-console
        console.warn('[auth] /refresh rejected with 401, clearing tokens:', body);
        tokenStore.clear();
        return null;
      }
      if (!res.ok) return null;
      const payload = await res.json().catch(() => null);
      const data = payload?.data ?? payload ?? {};
      const newAccess = data.access_token || data.accessToken || data.token;
      const newRefresh = data.refresh_token || data.refreshToken;
      if (!newAccess) return null;
      tokenStore.set(newAccess);
      if (newRefresh) tokenStore.setRefresh(newRefresh);
      if (data.user) tokenStore.setUser(data.user);
      const expiresAt = readExpiresAt(data);
      if (expiresAt) tokenStore.setExpiresAt(expiresAt);
      return newAccess;
    } catch {
      return null;
    } finally {
      refreshInFlight = null;
    }
  })();

  return refreshInFlight;
}

function buildUrl(input) {
  if (input instanceof URL) return input.toString();
  if (typeof input !== 'string') return input;
  if (input.startsWith('http')) return input;
  return API_BASE + (input.startsWith('/') ? input : '/' + input);
}

function mergeHeadersWithToken(initHeaders, token) {
  let headers;
  if (initHeaders instanceof Headers) {
    headers = Object.fromEntries(initHeaders.entries());
  } else if (Array.isArray(initHeaders)) {
    headers = Object.fromEntries(initHeaders);
  } else {
    headers = { ...(initHeaders || {}) };
  }
  // Drop any caller-supplied Authorization — we own this header now.
  delete headers.Authorization;
  delete headers.authorization;
  if (token) headers.Authorization = `Bearer ${token}`;
  if (!headers.Accept && !headers.accept) headers.Accept = 'application/json';
  // Defeat browser/proxy caching of authenticated responses so a fresh
  // login never sees the previous user's cached payload. Server-side
  // Cache-Control is still recommended; this is the client-side guard.
  if (!headers['Cache-Control'] && !headers['cache-control']) {
    headers['Cache-Control'] = 'no-cache';
  }
  if (!headers.Pragma && !headers.pragma) headers.Pragma = 'no-cache';
  return headers;
}

// Drop-in `fetch` replacement that injects the bearer token and, on 401,
// transparently refreshes the access token once and retries the request.
// Consumers can still inspect the returned Response — a 401 here means the
// refresh either had no refresh token or was rejected by the server.
export async function authorizedFetch(input, init = {}) {
  const url = buildUrl(input);
  const token = tokenStore.get();
  const firstInit = {
    cache: 'no-store',
    ...init,
    headers: mergeHeadersWithToken(init.headers, token),
  };

  let res = await fetch(url, firstInit);

  if (res.status === 401 && tokenStore.getRefresh()) {
    const newToken = await refreshAccessToken();
    if (newToken) {
      const retryInit = {
        cache: 'no-store',
        ...init,
        headers: mergeHeadersWithToken(init.headers, newToken),
      };
      res = await fetch(url, retryInit);
    }
  }
  // If we still got a 401 after the refresh path, the session is gone —
  // surface the global popup so the user is told before being kicked
  // back to /login.
  if (res.status === 401) {
    let bodyMsg = '';
    try {
      const clone = res.clone();
      const data = await clone.json();
      bodyMsg = data?.error?.message || data?.message || '';
    } catch { /* non-JSON body — ignore */ }
    notifyAuthError(bodyMsg);
  }
  return res;
}

async function request(method, path, { body, query, auth = true, signal } = {}) {
  const url = new URL(path.startsWith('http') ? path : BASE + path);
  if (query) {
    Object.entries(query).forEach(([k, v]) => {
      if (v !== undefined && v !== null && v !== '') url.searchParams.set(k, v);
    });
  }

  const buildHeaders = (token) => {
    const h = {
      Accept: 'application/json',
      // Match authorizedFetch — defeat browser/proxy caching so a freshly
      // logged-in User B never sees a 200-from-cache that belongs to User A.
      'Cache-Control': 'no-cache',
      Pragma: 'no-cache',
    };
    if (body !== undefined) h['Content-Type'] = 'application/json';
    if (auth && token) h.Authorization = `Bearer ${token}`;
    return h;
  };

  const doFetch = (token) => fetch(url, {
    method,
    headers: buildHeaders(token),
    body: body === undefined ? undefined : JSON.stringify(body),
    cache: 'no-store',
    signal,
  });

  let res = await doFetch(auth ? tokenStore.get() : null);

  if (res.status === 401 && auth && tokenStore.getRefresh()) {
    const newToken = await refreshAccessToken();
    if (newToken) res = await doFetch(newToken);
  }

  const text = await res.text();
  let payload = null;
  if (text) {
    try { payload = JSON.parse(text); } catch { payload = text; }
  }

  if (!res.ok) {
    if (res.status === 401 && auth) {
      const bodyMsg =
        (payload && typeof payload === 'object' && payload.error && typeof payload.error === 'object'
          ? payload.error.message
          : null) ||
        (payload && typeof payload?.message === 'string' ? payload.message : '');
      notifyAuthError(bodyMsg);
    } else if (res.status === 401) {
      tokenStore.clear();
    }
    const nested =
      (payload && typeof payload === 'object' && payload.error && typeof payload.error === 'object'
        ? payload.error.message
        : null) ||
      (payload && typeof payload.error === 'string' ? payload.error : null);
    const flat = payload && typeof payload === 'object' ? payload.message : null;
    // Render a FastAPI-style validation array ([{loc, msg}, ...]) as a
    // multi-line "field: msg" string. Used both for the top-level
    // `detail` field and for the embedded errors[] our backend nests
    // under error._embedded.details.errors.
    const renderValidationList = (arr) => {
      if (!Array.isArray(arr)) return null;
      const parts = arr
        .map((item) => {
          if (!item || typeof item !== 'object') return null;
          const field = Array.isArray(item.loc)
            ? item.loc.filter((p) => p !== 'body').join('.')
            : '';
          const m = typeof item.msg === 'string' ? item.msg : '';
          if (!m) return null;
          return field ? `${field}: ${m}` : m;
        })
        .filter(Boolean);
      return parts.length ? parts.join('\n') : null;
    };
    // FastAPI validation errors come back as { detail: [{ loc, msg, ... }] }
    // or sometimes a plain { detail: "string" }. Surface the human-readable
    // message(s) so forms see "value is not a valid email address ..." instead
    // of a generic "POST ... failed (422)".
    const fastapiDetail = (() => {
      const d = payload && typeof payload === 'object' ? payload.detail : null;
      if (typeof d === 'string') return d;
      return renderValidationList(d);
    })();
    // Backend's wrapped error shape:
    //   { error: { message: "Validation failed",
    //              _embedded: { details: { errors: [{ loc, msg, ... }] } } } }
    // The outer `error.message` is intentionally generic ("Validation failed"),
    // so prefer the field-level errors when they're present.
    const embeddedValidation = (() => {
      const errs = payload?.error?._embedded?.details?.errors;
      return renderValidationList(errs);
    })();
    const msg =
      (typeof embeddedValidation === 'string' && embeddedValidation) ||
      (typeof fastapiDetail === 'string' && fastapiDetail) ||
      (typeof nested === 'string' && nested) ||
      (typeof flat === 'string' && flat) ||
      (typeof payload === 'string' && payload) ||
      `${method} ${path} failed (${res.status})`;
    throw new ApiError(msg, { status: res.status, body: payload });
  }
  return payload;
}

export const api = {
  get: (path, opts) => request('GET', path, opts),
  post: (path, body, opts) => request('POST', path, { ...opts, body }),
  put: (path, body, opts) => request('PUT', path, { ...opts, body }),
  patch: (path, body, opts) => request('PATCH', path, { ...opts, body }),
  del: (path, opts) => request('DELETE', path, opts),
};
