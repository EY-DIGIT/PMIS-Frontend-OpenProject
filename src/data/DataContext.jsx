import { createContext, useContext, useState } from 'react';
import { demoVendors, demoUsers } from './demoData';

const DataContext = createContext(null);

export function DataProvider({ children }) {
  const [vendors, setVendors] = useState(demoVendors);
  const [users, setUsers] = useState(demoUsers);

  return (
    <DataContext.Provider value={{ vendors, setVendors, users, setUsers }}>
      {children}
    </DataContext.Provider>
  );
}

export function useData() {
  const ctx = useContext(DataContext);
  if (!ctx) throw new Error('useData must be used within DataProvider');
  return ctx;
}
