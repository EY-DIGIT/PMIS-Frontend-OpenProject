import { api, tokenStore } from './client';

const TOKEN_KEY = 'auth_token';
const REFRESH_KEY = 'auth_refresh_token';
const USER_KEY = 'auth_user';

export async function login({ login, password }) {
  const res = await api.post(
    '/api/v3/users/login',
    { login, password },
    { auth: false }
  );
  console.log('Login response:', res);

  const token =
    res?.data?.token || res?.data?.accessToken || res?.data?.access_token;
  const refresh = res?.data?.refreshToken || res?.data?.refresh_token;
  const user = res?.data?.user || null;

  if (!token) throw new Error('Login response missing token');

  // keep your existing store + persist to localStorage
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

  return { token, refresh, user };
}

export async function me() {
  return api.get('/api/v3/users/me');
}

export async function introspect() {
  return api.post('/api/v3/users/introspect', {});
}

export function logout() {
  tokenStore.clear();
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(REFRESH_KEY);
  localStorage.removeItem(USER_KEY);
}

export function getToken() {
  // prefer in-memory store; fall back to localStorage (page reloads, new tabs)
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