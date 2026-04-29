const RAW_BASE = import.meta.env.VITE_API_BASE_URL || 'http://10.1.131.199:8000/';

// Exported for modules that use raw `fetch` (e.g. milestoneConfigApi, project pages).
// Normalized to NOT end with a slash so callers can do `${API_BASE}${ENDPOINTS.x}`.
export const API_BASE = RAW_BASE.replace(/\/+$/, '');

const BASE = RAW_BASE;
const REFRESH_PATH = '/api/v3/users/refresh';

const TOKEN_KEY = 'pmis_token';
const REFRESH_KEY = 'pmis_refresh_token';
const USER_KEY = 'pmis_user';

// Mirror keys used by auth.js so legacy callers and tab-restored sessions stay
// in sync. Read = session-first then local fallback; Write = both; Clear = both.
const LEGACY_TOKEN_KEY = 'auth_token';
const LEGACY_REFRESH_KEY = 'auth_refresh_token';
const LEGACY_USER_KEY = 'auth_user';

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
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(REFRESH_KEY);
    localStorage.removeItem(USER_KEY);
    localStorage.removeItem(LEGACY_TOKEN_KEY);
    localStorage.removeItem(LEGACY_REFRESH_KEY);
    localStorage.removeItem(LEGACY_USER_KEY);
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
  },
};

export class ApiError extends Error {
  constructor(message, { status, body } = {}) {
    super(message);
    this.status = status;
    this.body = body;
  }
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
      if (!res.ok) return null;
      const payload = await res.json().catch(() => null);
      const data = payload?.data ?? payload ?? {};
      const newAccess = data.access_token || data.accessToken || data.token;
      const newRefresh = data.refresh_token || data.refreshToken;
      if (!newAccess) return null;
      tokenStore.set(newAccess);
      if (newRefresh) tokenStore.setRefresh(newRefresh);
      if (data.user) tokenStore.setUser(data.user);
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
  return headers;
}

// Drop-in `fetch` replacement that injects the bearer token and, on 401,
// transparently refreshes the access token once and retries the request.
// Consumers can still inspect the returned Response — a 401 here means the
// refresh either had no refresh token or was rejected by the server.
export async function authorizedFetch(input, init = {}) {
  const url = buildUrl(input);
  const token = tokenStore.get();
  const firstInit = { ...init, headers: mergeHeadersWithToken(init.headers, token) };

  let res = await fetch(url, firstInit);

  if (res.status === 401 && tokenStore.getRefresh()) {
    const newToken = await refreshAccessToken();
    if (newToken) {
      const retryInit = { ...init, headers: mergeHeadersWithToken(init.headers, newToken) };
      res = await fetch(url, retryInit);
    }
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
    const h = { Accept: 'application/json' };
    if (body !== undefined) h['Content-Type'] = 'application/json';
    if (auth && token) h.Authorization = `Bearer ${token}`;
    return h;
  };

  const doFetch = (token) => fetch(url, {
    method,
    headers: buildHeaders(token),
    body: body === undefined ? undefined : JSON.stringify(body),
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
    if (res.status === 401) tokenStore.clear();
    const nested =
      (payload && typeof payload === 'object' && payload.error && typeof payload.error === 'object'
        ? payload.error.message
        : null) ||
      (payload && typeof payload.error === 'string' ? payload.error : null);
    const flat = payload && typeof payload === 'object' ? payload.message : null;
    const msg =
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
