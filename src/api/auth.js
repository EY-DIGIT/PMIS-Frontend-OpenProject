import { api, tokenStore, refreshAccessToken, authorizedFetch, readExpiresAt, notifySessionReset } from './client';
import { ENDPOINTS } from './endpoint';

export { refreshAccessToken, authorizedFetch };

const TOKEN_KEY = 'auth_token';
const REFRESH_KEY = 'auth_refresh_token';
const USER_KEY = 'auth_user';

function pickPayload(res) {
  return res?.data && typeof res.data === 'object' ? res.data : res || {};
}

function persistAuthFromPayload(payload) {
  const token = payload?.token || payload?.accessToken || payload?.access_token;
  const refresh = payload?.refreshToken || payload?.refresh_token;
  const user = payload?.user || null;

  if (!token) throw new Error('Login response missing token');

  tokenStore.set(token);
  localStorage.setItem(TOKEN_KEY, token);

  if (refresh) {
    tokenStore.setRefresh(refresh);
    localStorage.setItem(REFRESH_KEY, refresh);
  }
  if (user) {
    tokenStore.setUser(user);
    localStorage.setItem(USER_KEY, JSON.stringify(user));
  }

  const expiresAt = readExpiresAt(payload);
  if (expiresAt) tokenStore.setExpiresAt(expiresAt);

  // Drop every client-side cache from the previous session before the
  // app starts fetching with the new token. Listeners (DataProvider,
  // projectsStore, draftStore, uiStore, apiSync) clear their state.
  notifySessionReset();

  return { token, refresh, user };
}

export async function login({ login, password }) {
  const res = await api.post(
    ENDPOINTS.auth.login,
    { login, password },
    { auth: false }
  );
  const payload = pickPayload(res);

  if (payload?.requires_otp || payload?.requiresOtp) {
    return {
      requiresOtp: true,
      ephemeralToken: payload.ephemeral_token || payload.ephemeralToken,
      channelsAvailable:
        payload.channels_available || payload.channelsAvailable || {},
    };
  }

  return persistAuthFromPayload(payload);
}

export async function sendOtp({ ephemeralToken, channel }) {
  return api.post(
    ENDPOINTS.auth.sendOtp,
    { ephemeral_token: ephemeralToken, channel },
    { auth: false }
  );
}

export async function verifyOtp({ ephemeralToken, code }) {
  const res = await api.post(
    ENDPOINTS.auth.verifyOtp,
    { ephemeral_token: ephemeralToken, code },
    { auth: false }
  );
  return persistAuthFromPayload(pickPayload(res));
}

export async function forgotPassword({ loginOrEmail, channel = 'email' }) {
  return api.post(
    ENDPOINTS.auth.forgotPassword,
    { login_or_email: loginOrEmail, channel },
    { auth: false }
  );
}

export async function resetPassword({ tokenOrCode, newPassword }) {
  return api.post(
    ENDPOINTS.auth.resetPassword,
    { token_or_code: tokenOrCode, new_password: newPassword },
    { auth: false }
  );
}

export async function me() {
  return api.get(ENDPOINTS.auth.me);
}

export async function introspect() {
  return api.post(ENDPOINTS.auth.introspect, {});
}

export async function logout() {
  try {
    await api.post(ENDPOINTS.auth.logout);
  } finally {
    tokenStore.clear();
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(REFRESH_KEY);
    localStorage.removeItem(USER_KEY);
    localStorage.removeItem('pmis_last_activity');
    localStorage.removeItem('pmis_last_refresh_at');
    sessionStorage.removeItem('uidai_loggedIn');
    sessionStorage.removeItem('uidai_user');
    // Drop every client-side cache so User B can't inherit User A's
    // vendors/users/projects/drafts on the next login in this tab.
    notifySessionReset();
  }
}

export function getToken() {
  try {
    return tokenStore.get() || localStorage.getItem(TOKEN_KEY) || '';
  } catch {
    return localStorage.getItem(TOKEN_KEY) || '';
  }
}

export function getStoredUser() {
  const raw = localStorage.getItem(USER_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export function isAuthenticated() {
  return !!getToken();
}
