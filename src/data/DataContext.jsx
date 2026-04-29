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

  return (
    <DataContext.Provider value={{ vendors, setVendors, users, setUsers, loading, error, refresh }}>
      {children}
    </DataContext.Provider>
  );
}

export function useData() {
  const ctx = useContext(DataContext);
  if (!ctx) throw new Error('useData must be used within DataProvider');
  return ctx;
}
