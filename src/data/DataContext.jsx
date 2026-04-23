import { createContext, useContext, useEffect, useState, useCallback } from 'react';
import { demoVendors, demoUsers } from './demoData';
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
      setVendors(demoVendors);
      setUsers(demoUsers);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const [v, u] = await Promise.all([
        vendorsApi.list().catch(() => demoVendors),
        usersApi.list().catch(() => demoUsers),
      ]);
      setVendors(v);
      setUsers(u);
    } catch (e) {
      setError(e);
      setVendors(demoVendors);
      setUsers(demoUsers);
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
