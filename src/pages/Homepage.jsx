// ============================================================
// pages/HomePage.jsx  –  Route: /
// ============================================================
export default function HomePage() {
  return (
    <div
      style={{
        display: "flex", alignItems: "center", justifyContent: "center",
        height: "80%", flexDirection: "column", gap: 16, color: "#66788f",
      }}
    >
      <div style={{ fontSize: 48 }}>🏛️</div>
      <div style={{ fontSize: 20, fontWeight: 800, color: "#173e77" }}>
        UIDAI Automation Governance Tool
      </div>
      <div style={{ fontSize: 14 }}>
        Select a module from the sidebar to get started
      </div>
    </div>
  );
}