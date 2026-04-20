import { useData } from '../../data/DataContext';

export default function MasterOverview() {
  const { vendors, users } = useData();

  return (
    <>
      <div className="uidai-pmis-title">Master Data</div>
      <p className="uidai-pmis-subtitle">
        Consolidated vendor and user counts and status at a glance
      </p>
      <div className="uidai-pmis-kpi-row">
        <div className="uidai-pmis-kpi">
          <div className="uidai-pmis-kpi-label">Total Vendors</div>
          <div className="uidai-pmis-kpi-value">{vendors.length}</div>
          <div className="uidai-pmis-kpi-meta">All vendor records</div>
        </div>
        <div className="uidai-pmis-kpi">
          <div className="uidai-pmis-kpi-label">Total Users</div>
          <div className="uidai-pmis-kpi-value">{users.length}</div>
          <div className="uidai-pmis-kpi-meta">All user records</div>
        </div>
        <div className="uidai-pmis-kpi">
          <div className="uidai-pmis-kpi-label">Active Vendors</div>
          <div className="uidai-pmis-kpi-value">{vendors.filter((v) => v.status === 'Active').length}</div>
          <div className="uidai-pmis-kpi-meta">Currently enabled</div>
        </div>
        <div className="uidai-pmis-kpi">
          <div className="uidai-pmis-kpi-label">Active Users</div>
          <div className="uidai-pmis-kpi-value">{users.filter((u) => u.status === 'Active').length}</div>
          <div className="uidai-pmis-kpi-meta">Currently enabled</div>
        </div>
      </div>
      <div className="uidai-pmis-card">
        <p className="uidai-pmis-subtitle" style={{ marginBottom: 0 }}>
          Use the dropdown on the left to open Vendor Data or User Data.
        </p>
      </div>
    </>
  );
}
