import { useEffect } from 'react';
import { useData } from '../../data/DataContext';
import { tokenStore } from '../../api/client';
import { renderMappingText } from '../../utils/helpers';

export default function MasterVendors() {
  const { vendors, refresh } = useData();

  useEffect(() => {
    if (tokenStore.get()) refresh();
  }, [refresh]);

  return (
    <>
      <p className="uidai-pmis-subtitle">
        Vendor master records currently stored in the system.
      </p>
      <div className="uidai-pmis-card">
        <div className="uidai-pmis-table-wrap">
          <table className="uidai-pmis-table uidai-pmis-table-compact">
            <thead>
              <tr>
                <th>Vendor ID</th><th>Vendor Name</th><th>Type</th><th>Status</th>
                <th>Contact Person</th><th>Email</th><th>Phone</th>
                <th>Project Mapping</th>
              </tr>
            </thead>
            <tbody>
              {vendors.map((v) => (
                <tr key={v.vendorId}>
                  <td>{v.vendorId}</td>
                  <td>{v.vendorName}</td>
                  <td>{v.vendorType}</td>
                  <td>
                    <span className={`uidai-pmis-badge ${v.status === 'Active' ? 'uidai-pmis-badge-green' : 'uidai-pmis-badge-red'}`}>
                      {v.status}
                    </span>
                  </td>
                  <td>{v.contact}</td>
                  <td>{v.email}</td>
                  <td>{v.phone}</td>
                  <td>{renderMappingText(v.projectMapping)}</td>
                </tr>
              ))}
              {vendors.length === 0 && (
                <tr className="uidai-pmis-no-results">
                  <td colSpan={8}>No data found.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}
