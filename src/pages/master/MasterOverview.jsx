import { useEffect } from 'react';
import { useData } from '../../data/DataContext';
import { tokenStore } from '../../api/client';

export default function MasterOverview() {
  const { vendors, users, refresh, loading } = useData();

  useEffect(() => {
    if (tokenStore.get()) refresh();
  }, [refresh]);

  const kpiValue = (n) => (loading ? '…' : n);

  return (
    <>
      <p className="uidai-pmis-subtitle">
        Consolidated organization and user counts and status at a glance
      </p>
      <div className="uidai-pmis-kpi-row">
        <div className="uidai-pmis-kpi">
          <div className="uidai-pmis-kpi-label">Total Organizations</div>
          <div className="uidai-pmis-kpi-value">{kpiValue(vendors.length)}</div>
          <div className="uidai-pmis-kpi-meta">All organization records</div>
        </div>
        <div className="uidai-pmis-kpi">
          <div className="uidai-pmis-kpi-label">Total Users</div>
          <div className="uidai-pmis-kpi-value">{kpiValue(users.length)}</div>
          <div className="uidai-pmis-kpi-meta">All user records</div>
        </div>
        <div className="uidai-pmis-kpi">
          <div className="uidai-pmis-kpi-label">Active Organizations</div>
          <div className="uidai-pmis-kpi-value">{kpiValue(vendors.filter((v) => v.status === 'Active').length)}</div>
          <div className="uidai-pmis-kpi-meta">Currently enabled</div>
        </div>
        <div className="uidai-pmis-kpi">
          <div className="uidai-pmis-kpi-label">Active Users</div>
          <div className="uidai-pmis-kpi-value">{kpiValue(users.filter((u) => u.status === 'Active').length)}</div>
          <div className="uidai-pmis-kpi-meta">Currently enabled</div>
        </div>
      </div>
      <div className="uidai-pmis-card">
        <p className="uidai-pmis-subtitle" style={{ marginBottom: 0 }}>
          Use the dropdown on the left to open Organization Data or User Data.
        </p>
      </div>
    </>
  );
}
