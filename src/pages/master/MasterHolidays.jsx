import { useMemo, useState } from "react";
import { getToken } from "../../api/auth";

/* Holiday List — moved out of the milestone modal into Master Data.
   Uploads a holiday Excel for a given year to the attendance service. */
const API_BASE = "http://10.1.131.199:8019"; // move to env / your api client

export default function MasterHolidays() {
  const currentYear = new Date().getFullYear();
  const years = useMemo(
    () => [
      currentYear,
      ...Array.from({ length: 20 }, (_, i) => currentYear + i + 1), // future
      ...Array.from({ length: currentYear - 2000 }, (_, i) => currentYear - (i + 1)), // past
    ],
    [currentYear]
  );

  const [year, setYear] = useState("");
  const [file, setFile] = useState(null);
  const [uploading, setUploading] = useState(false);
  const [msg, setMsg] = useState(null); // { type: "ok" | "error", text }

  async function handleUpload() {
    setMsg(null);
    if (!year) { setMsg({ type: "error", text: "Please select a year." }); return; }
    if (!file) { setMsg({ type: "error", text: "Please select an Excel file." }); return; }

    const formData = new FormData();
    formData.append("file", file);

    try {
      setUploading(true);
      const token = getToken();
      const params = new URLSearchParams({ year: String(year) });
      const res = await fetch(`${API_BASE}/api/holidays?${params.toString()}`, {
        method: "POST",
        headers: token ? { Authorization: `Bearer ${token}` } : {},
        body: formData,
      });
      if (!res.ok) throw new Error(`Upload failed (${res.status})`);
      setMsg({ type: "ok", text: `Holiday list for ${year} uploaded successfully.` });
      setFile(null);
    } catch (err) {
      setMsg({ type: "error", text: err?.message || "Failed to upload holiday list." });
    } finally {
      setUploading(false);
    }
  }

  return (
    <div
      className="uidai-pmis-content"
      style={{ padding: "28px 24px 64px", maxWidth: 900, margin: "0 auto" }}
    >
      {/* Header */}
      <div style={{ marginBottom: 28 }}>
        <div style={{ marginBottom: 6, fontSize: 12, fontWeight: 600, letterSpacing: "0.08em", textTransform: "uppercase", color: "#0b3c88" }}>
          Master Data
        </div>
        <h1 className="uidai-pmis-title" style={{ marginBottom: 6 }}>Holidays</h1>
        <p className="uidai-pmis-subtitle">
          Upload the yearly holiday list used across attendance and leave calculations.
        </p>
      </div>

      {msg && (
        <div
          style={{
            background: msg.type === "error" ? "#fde8e8" : "#e6f6ee",
            border: `1px solid ${msg.type === "error" ? "#f5c9c9" : "#c7ead6"}`,
            color: msg.type === "error" ? "#d32f2f" : "#0f9d58",
            borderRadius: 10,
            padding: "14px 16px",
            fontSize: 14,
            marginBottom: 16,
            display: "flex",
            alignItems: "center",
            gap: 10,
          }}
        >
          <span style={{ fontSize: 18 }}>{msg.type === "error" ? "⚠️" : "✓"}</span>
          {msg.text}
        </div>
      )}

      {/* Upload card */}
      <div
        className="uidai-pmis-card"
        style={{ border: "1px solid #dbe5f1", padding: 24, maxWidth: 520 }}
      >
        <h2 style={{ margin: "0 0 18px", fontSize: 16, fontWeight: 700, color: "#1e2a3a" }}>
          Upload Holiday List
        </h2>

        <label style={{ display: "flex", flexDirection: "column", gap: 6, marginBottom: 16 }}>
          <span style={{ fontSize: 12.5, fontWeight: 600, color: "#6b7a90" }}>Year</span>
          <select
            className="uidai-select"
            value={year}
            onChange={(e) => setYear(e.target.value)}
          >
            <option value="" disabled>Select year</option>
            {years.map((y) => (
              <option key={y} value={y}>{y}</option>
            ))}
          </select>
        </label>

        <label style={{ display: "flex", flexDirection: "column", gap: 6, marginBottom: 22 }}>
          <span style={{ fontSize: 12.5, fontWeight: 600, color: "#6b7a90" }}>Holiday Excel</span>
          <input
            type="file"
            accept=".xlsx,.xls"
            onChange={(e) => setFile(e.target.files?.[0] || null)}
            style={{ fontSize: 14 }}
          />
        </label>

        <div style={{ display: "flex", justifyContent: "flex-end" }}>
          <button
            onClick={handleUpload}
            disabled={uploading}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 8,
              borderRadius: 10,
              fontSize: 14,
              fontWeight: 600,
              padding: "10px 18px",
              cursor: uploading ? "not-allowed" : "pointer",
              border: "none",
              background: "#0b3c88",
              color: "#fff",
              opacity: uploading ? 0.55 : 1,
              boxShadow: "0 2px 4px rgba(11, 60, 136, 0.15)",
            }}
          >
            {uploading ? "Uploading…" : "Upload"}
          </button>
        </div>
      </div>
    </div>
  );
}
