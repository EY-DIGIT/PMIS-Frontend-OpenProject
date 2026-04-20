import { useData } from '../data/DataContext';

export default function Dashboard() {
  const { vendors, users } = useData();

  return (
    <>
      <div className="uidai-pmis-title">Welcome</div>
      <div className="uidai-pmis-card">
        <h3>UIDAI Automation Governance Tool</h3>
        <p className="uidai-pmis-subtitle">
          Use the sidebar to move among Master Data, Vendor Management, and User Management.
        </p>
        <div className="uidai-pmis-kpi-row">
          <div className="uidai-pmis-kpi">
            <div className="uidai-pmis-kpi-label">Vendors</div>
            <div className="uidai-pmis-kpi-value">{vendors.length}</div>
            <div className="uidai-pmis-kpi-meta">Consolidated records</div>
          </div>
          <div className="uidai-pmis-kpi">
            <div className="uidai-pmis-kpi-label">Users</div>
            <div className="uidai-pmis-kpi-value">{users.length}</div>
            <div className="uidai-pmis-kpi-meta">Access-controlled users</div>
          </div>
          <div className="uidai-pmis-kpi">
            <div className="uidai-pmis-kpi-label">Status</div>
            <div className="uidai-pmis-kpi-value">Live</div>
            <div className="uidai-pmis-kpi-meta">Frontend prototype</div>
          </div>
        </div>
      </div>
    </>
  );
}
