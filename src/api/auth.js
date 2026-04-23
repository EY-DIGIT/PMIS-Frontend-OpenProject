import { api, tokenStore } from './client';

export async function login({ login, password }) {
  const res = await api.post('/api/v3/users/login', { login, password }, { auth: false });
  const token = res?.token || res?.accessToken || res?.access_token;
  const refresh = res?.refreshToken || res?.refresh_token;
  const user = res?.user || res?.data?.user || null;
  if (!token) throw new Error('Login response missing token');
  tokenStore.set(token);
  if (refresh) tokenStore.setRefresh(refresh);
  if (user) tokenStore.setUser(user);
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
}

export function isAuthenticated() {
  return !!tokenStore.get();
}
