import "../styles/Homepage.css";

export default function HomePage() {
  return (
    <div className="uidai-home-panel">
      <div className="uidai-home-title">Welcome to UIDAI Automation Governance Tool</div>
      <div className="uidai-home-subtitle">
        Please proceed to the relevant module to perform project onboarding,
        master data handling, vendor administration, user access management,
        meeting coordination, and audit review. Use the sidebar to navigate
        across the workspace and keep your governance tasks organized,
        traceable, and consistent with the UIDAI theme.
      </div>

      <div className="uidai-home-grid">
        <div className="uidai-home-card">
          <h3>Project Management</h3>
          <div className="uidai-home-tag">Plan, track, deliver.</div>
          <p>
            Create, update, and monitor project records with structured
            tracking for progress, milestones, and ownership.
          </p>
        </div>
        <div className="uidai-home-card">
          <h3>Vendor &amp; User Management</h3>
          <div className="uidai-home-tag">Controlled access for every role.</div>
          <p>
            Maintain vendors and users in a controlled flow so access,
            mapping, and accountability stay clean.
          </p>
        </div>
        <div className="uidai-home-card">
          <h3>Audit &amp; Monitoring</h3>
          <div className="uidai-home-tag">Transparent, searchable trails.</div>
          <p>
            Review logs and activities to keep operations transparent,
            searchable, and easy to verify.
          </p>
        </div>
      </div>
    </div>
  );
}
