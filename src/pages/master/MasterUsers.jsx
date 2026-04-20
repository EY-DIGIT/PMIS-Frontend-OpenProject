import { useData } from '../../data/DataContext';
import { renderMappingText } from '../../utils/helpers';

export default function MasterUsers() {
  const { users } = useData();

  return (
    <>
      <div className="uidai-pmis-title">User Data</div>
      <p className="uidai-pmis-subtitle">
        User master records currently stored in the system
      </p>
      <div className="uidai-pmis-card">
        <div className="uidai-pmis-table-wrap">
          <table className="uidai-pmis-table uidai-pmis-table-compact">
            <thead>
              <tr>
                <th>User ID</th><th>Full Name</th><th>Employee ID</th><th>Email</th>
                <th>Role</th><th>Associated Vendor</th><th>Division</th>
                <th>Project Mapping</th><th>Status</th>
              </tr>
            </thead>
            <tbody>
              {users.map((u) => (
                <tr key={u.userId}>
                  <td>{u.userId}</td>
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
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}
