import { useEffect } from 'react';
import { useData } from '../../data/DataContext';
import { tokenStore } from '../../api/client';
import { renderMappingText } from '../../utils/helpers';

export default function MasterUsers() {
  const { users, refresh, loading } = useData();

  useEffect(() => {
    if (tokenStore.get()) refresh();
  }, [refresh]);

  return (
    <>
      <p className="uidai-pmis-subtitle">
        User master records currently stored in the system
      </p>
      <div className="uidai-pmis-card">
        <div className="uidai-pmis-table-wrap">
          <table className="uidai-pmis-table uidai-pmis-table-compact">
            <thead>
              <tr>
                <th>User ID</th><th>Full Name</th><th>Username</th><th>Email</th>
                <th>Role</th><th>Organization</th><th>Division</th>
                <th>Project Mapping</th><th>Status</th>
              </tr>
            </thead>
            <tbody>
              {loading && (
                <tr className="uidai-pmis-no-results">
                  <td colSpan={9} style={{ textAlign: 'center', padding: 16 }}>
                    Loading users...
                  </td>
                </tr>
              )}
              {!loading && users.map((u) => (
                <tr key={u.userId}>
                  <td>{u.userCode || u.userId}</td>
                  <td>{u.fullName}</td>
                  <td>{u.employeeId}</td>
                  <td>{u.email}</td>
                  <td>{u.role}</td>
                  <td>{u.vendorName}</td>
                  <td>{u.division}</td>
                  <td>{renderMappingText(u.projectMapping)}</td>
                  <td>
                    <span className={`uidai-pmis-badge ${u.status === 'Active' ? 'uidai-pmis-badge-green' : 'uidai-pmis-badge-red'}`}>
                      {u.status}
                    </span>
                  </td>
                </tr>
              ))}
              {!loading && users.length === 0 && (
                <tr className="uidai-pmis-no-results">
                  <td colSpan={9}>No data found.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}
