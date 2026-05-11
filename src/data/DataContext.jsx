import { createContext, useContext, useEffect, useState, useCallback } from 'react';
import * as vendorsApi from '../api/vendors';
import * as usersApi from '../api/users';
import { tokenStore } from '../api/client';

const DataContext = createContext(null);

export function DataProvider({ children }) {
  const [vendors, setVendors] = useState([]);
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const refresh = useCallback(async () => {
    if (!tokenStore.get()) {
      setVendors([]);
      setUsers([]);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const [v, u] = await Promise.all([
        vendorsApi.list().catch(() => []),
        usersApi.list().catch(() => []),
      ]);
      setVendors(Array.isArray(v) ? v : []);
      setUsers(Array.isArray(u) ? u : []);
    } catch (e) {
      setError(e);
      setVendors([]);
      setUsers([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  // On both login and logout, drop the cached vendors/users so a freshly
  // authenticated User B never sees User A's data, then re-fetch under
  // the new identity. The refresh()'s own token guard means a logout
  // event simply leaves the arrays empty.
  useEffect(() => {
    function onReset() {
      setVendors([]);
      setUsers([]);
      setError(null);
      refresh();
    }
    window.addEventListener('pmis:session-reset', onReset);
    return () => window.removeEventListener('pmis:session-reset', onReset);
  }, [refresh]);

  return (
    <DataContext.Provider value={{ vendors, setVendors, users, setUsers, loading, error, refresh }}>
      {children}
    </DataContext.Provider>
  );
}

// Safe defaults so a transient render where the Provider isn't yet
// reachable (e.g. the post-login navigation, or a Fast-Refresh edge
// where this module re-evaluates and the existing tree briefly sees
// a fresh DataContext) degrades to empty data instead of crashing
// the whole page. Real consumers get the live values once the
// Provider re-attaches on the next render.
const EMPTY_CTX = {
  vendors: [],
  users: [],
  loading: false,
  error: null,
  refresh: () => {},
  setVendors: () => {},
  setUsers: () => {},
};

export function useData() {
  const ctx = useContext(DataContext);
  if (!ctx) {
    if (typeof console !== 'undefined') {
      console.warn('useData() called outside DataProvider — returning empty defaults.');
    }
    return EMPTY_CTX;
  }
  return ctx;
}
