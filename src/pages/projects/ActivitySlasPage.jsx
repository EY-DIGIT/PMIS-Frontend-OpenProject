import React, { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { authorizedFetch } from "../../api/client";
import { getToken } from "../../api/auth";

export default function ActivitySlasPage() {
  const navigate = useNavigate();

  // API Configuration
  const [contractApiUrl, setContractApiUrl] = useState("http://localhost:9000/contracts");
  const [projectMgmtApiUrl, setProjectMgmtApiUrl] = useState("http://localhost:9000/projects");
  const [activityIdInput, setActivityIdInput] = useState("");

  // Data state
  const [activityDetails, setActivityDetails] = useState(null);
  const [mappings, setMappings] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [actionMessage, setActionMessage] = useState("");
  const [actionLoading, setActionLoading] = useState(false);

  async function handleLoad() {
    if (!activityIdInput.trim()) {
      setError("Please enter an Activity ID");
      return;
    }

    setLoading(true);
    setError("");
    setActivityDetails(null);
    setMappings([]);

    try {
      // Load activity details from Project Mgmt API
      const activityRes = await authorizedFetch(
        `${projectMgmtApiUrl}/api/v3/activities/${encodeURIComponent(activityIdInput)}`,
        {
          method: "GET",
          headers: { Accept: "application/json" }
        }
      );
      const activityData = await activityRes.json();
      const activity = activityData?.data || activityData;
      setActivityDetails(activity);

      // Load SLA mappings from Contracts API
      const slasRes = await authorizedFetch(
        `${contractApiUrl}/api/v3/activities/${encodeURIComponent(activityIdInput)}/sla-mappings`,
        {
          method: "GET",
          headers: { Accept: "application/json" }
        }
      );
      const slasData = await slasRes.json();
      const elements = slasData?.data?._embedded?.elements || slasData?.data || [];
      setMappings(Array.isArray(elements) ? elements : []);
    } catch (err) {
      setError(err?.message || "Failed to load activity details or SLA mappings");
    } finally {
      setLoading(false);
    }
  }

  async function retireMapping(mappingId) {
    setActionLoading(true);
    setActionMessage("");
    try {
      const res = await authorizedFetch(
        `${contractApiUrl}/api/v3/sla-activity-mappings/${encodeURIComponent(mappingId)}`,
        {
          method: "PATCH",
          headers: {
            "Content-Type": "application/json",
            Accept: "application/json"
          },
          body: JSON.stringify({ status: "RETIRED" })
        }
      );
      if (!res.ok) {
        const data = await res.json();
        setActionMessage(data?.message || `Update failed (${res.status})`);
      } else {
        setActionMessage(`SLA mapping retired successfully`);
        setTimeout(() => handleLoad(), 800);
      }
    } catch (err) {
      setActionMessage(err?.message || "Failed to retire SLA mapping");
    } finally {
      setActionLoading(false);
    }
  }

  return (
    <div style={{ padding: "20px", background: "#fafafa", minHeight: "100vh" }}>
      <div style={{ maxWidth: "1400px", margin: "0 auto" }}>
        {/* Header */}
        <div style={{ marginBottom: 24, display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
          <div>
            <h1 style={{ margin: "0 0 4px 0", fontSize: 28, fontWeight: 700, color: "#1a1a1a" }}>
              Activity SLAs
            </h1>
            <p style={{ margin: 0, fontSize: 13, color: "#666" }}>
              Map, Evaluate, Calculate LD.
            </p>
            <p style={{ margin: "8px 0 0 0", fontSize: 12, color: "#999" }}>
              Attach SLAs to a project activity, evaluate severity per SLA, and roll up Liquidated Damages.
            </p>
          </div>
          <div style={{ display: "flex", gap: 12 }}>
            <button
              type="button"
              onClick={() => handleLoad()}
              style={{
                padding: "8px 16px",
                background: "#f0f0f0",
                border: "1px solid #ddd",
                borderRadius: 4,
                cursor: "pointer",
                fontSize: 13,
                fontWeight: 500
              }}
            >
              🔄 Refresh
            </button>
            <button
              type="button"
              style={{
                padding: "8px 16px",
                background: "#6366f1",
                color: "#fff",
                border: "none",
                borderRadius: 4,
                cursor: "pointer",
                fontSize: 13,
                fontWeight: 500
              }}
            >
              ⚡ Evaluate All
            </button>
            <button
              type="button"
              style={{
                padding: "8px 16px",
                background: "#f97316",
                color: "#fff",
                border: "none",
                borderRadius: 4,
                cursor: "pointer",
                fontSize: 13,
                fontWeight: 500
              }}
            >
              📊 Calculate Activity LD
            </button>
          </div>
        </div>

        {/* API Configuration Section */}
        <div style={{
          background: "#fff",
          border: "1px solid #e5e7eb",
          borderRadius: 8,
          padding: 16,
          marginBottom: 24
        }}>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
            <div>
              <label style={{ display: "block", fontSize: 12, fontWeight: 600, marginBottom: 6, color: "#333" }}>
                Contract API
              </label>
              <input
                type="text"
                value={contractApiUrl}
                onChange={(e) => setContractApiUrl(e.target.value)}
                style={{
                  width: "100%",
                  padding: "8px 12px",
                  border: "1px solid #ddd",
                  borderRadius: 4,
                  fontSize: 12,
                  fontFamily: "monospace"
                }}
              />
            </div>
            <div>
              <label style={{ display: "block", fontSize: 12, fontWeight: 600, marginBottom: 6, color: "#333" }}>
                Project Mgmt API (for prefill)
              </label>
              <input
                type="text"
                value={projectMgmtApiUrl}
                onChange={(e) => setProjectMgmtApiUrl(e.target.value)}
                style={{
                  width: "100%",
                  padding: "8px 12px",
                  border: "1px solid #ddd",
                  borderRadius: 4,
                  fontSize: 12,
                  fontFamily: "monospace"
                }}
              />
            </div>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr auto", gap: 12, marginTop: 16, alignItems: "flex-end" }}>
            <div>
              <label style={{ display: "block", fontSize: 12, fontWeight: 600, marginBottom: 6, color: "#333" }}>
                Activity ID
              </label>
              <input
                type="text"
                placeholder="e.g. agt-map-al001-demo or UUID"
                value={activityIdInput}
                onChange={(e) => setActivityIdInput(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleLoad()}
                style={{
                  width: "100%",
                  padding: "8px 12px",
                  border: "1px solid #ddd",
                  borderRadius: 4,
                  fontSize: 12
                }}
              />
            </div>
            <button
              type="button"
              onClick={handleLoad}
              disabled={loading}
              style={{
                padding: "8px 20px",
                background: "#2563eb",
                color: "#fff",
                border: "none",
                borderRadius: 4,
                cursor: loading ? "not-allowed" : "pointer",
                fontSize: 12,
                fontWeight: 600,
                opacity: loading ? 0.6 : 1
              }}
            >
              {loading ? "Loading..." : "Load"}
            </button>
          </div>
        </div>

        {/* Error Message */}
        {error && (
          <div style={{
            background: "#fee2e2",
            border: "1px solid #fca5a5",
            borderRadius: 8,
            padding: 12,
            marginBottom: 24,
            color: "#991b1b",
            fontSize: 13
          }}>
            {error}
          </div>
        )}

        {/* Action Message */}
        {actionMessage && (
          <div style={{
            background: actionMessage.toLowerCase().includes("failed") || actionMessage.toLowerCase().includes("error")
              ? "#fee2e2"
              : "#dcfce7",
            border: actionMessage.toLowerCase().includes("failed") || actionMessage.toLowerCase().includes("error")
              ? "1px solid #fca5a5"
              : "1px solid #86efac",
            borderRadius: 8,
            padding: 12,
            marginBottom: 24,
            color: actionMessage.toLowerCase().includes("failed") || actionMessage.toLowerCase().includes("error")
              ? "#991b1b"
              : "#15803d",
            fontSize: 13
          }}>
            {actionMessage}
          </div>
        )}

        {/* Activity Details Section */}
        {activityDetails && (
          <div style={{
            background: "#f3f4f6",
            border: "1px solid #d1d5db",
            borderRadius: 8,
            padding: 16,
            marginBottom: 24
          }}>
            <h3 style={{ margin: "0 0 16px 0", fontSize: 14, fontWeight: 600, color: "#1f2937" }}>
              Activity Details (from PMIS Project Management)
            </h3>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 16, fontSize: 12 }}>
              <div>
                <div style={{ color: "#6b7280", fontWeight: 500, marginBottom: 4 }}>Activity</div>
                <div style={{ color: "#111", fontWeight: 500 }}>{activityDetails.name || "—"}</div>
              </div>
              <div>
                <div style={{ color: "#6b7280", fontWeight: 500, marginBottom: 4 }}>Code</div>
                <div style={{ color: "#111", fontWeight: 500 }}>{activityDetails.code || "—"}</div>
              </div>
              <div>
                <div style={{ color: "#6b7280", fontWeight: 500, marginBottom: 4 }}>Project</div>
                <div style={{ color: "#111", fontWeight: 500 }}>{activityDetails.project || "—"}</div>
              </div>
              <div>
                <div style={{ color: "#6b7280", fontWeight: 500, marginBottom: 4 }}>Vendor</div>
                <div style={{ color: "#111", fontWeight: 500 }}>{activityDetails.vendor || "—"}</div>
              </div>
              <div>
                <div style={{ color: "#6b7280", fontWeight: 500, marginBottom: 4 }}>Start (planned)</div>
                <div style={{ color: "#111", fontWeight: 500 }}>{activityDetails.startPlanned || "—"}</div>
              </div>
              <div>
                <div style={{ color: "#6b7280", fontWeight: 500, marginBottom: 4 }}>End (planned)</div>
                <div style={{ color: "#111", fontWeight: 500 }}>{activityDetails.endPlanned || "—"}</div>
              </div>
              <div>
                <div style={{ color: "#6b7280", fontWeight: 500, marginBottom: 4 }}>Actual Start</div>
                <div style={{ color: "#111", fontWeight: 500 }}>{activityDetails.actualStart || "—"}</div>
              </div>
              <div>
                <div style={{ color: "#6b7280", fontWeight: 500, marginBottom: 4 }}>Actual End</div>
                <div style={{ color: "#111", fontWeight: 500 }}>{activityDetails.actualEnd || "—"}</div>
              </div>
            </div>
          </div>
        )}

        {/* Mapped SLAs Section */}
        <div style={{
          background: "#fff",
          border: "1px solid #e5e7eb",
          borderRadius: 8,
          overflow: "hidden"
        }}>
          <div style={{
            background: "#f3f4f6",
            padding: "16px",
            borderBottom: "1px solid #e5e7eb",
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center"
          }}>
            <h3 style={{ margin: 0, fontSize: 14, fontWeight: 600, color: "#1f2937" }}>
              Mapped SLAs
            </h3>
            <button
              type="button"
              style={{
                padding: "8px 16px",
                background: "#2563eb",
                color: "#fff",
                border: "none",
                borderRadius: 4,
                cursor: "pointer",
                fontSize: 12,
                fontWeight: 600
              }}
            >
              + Add SLA
            </button>
          </div>

          {!activityIdInput ? (
            <div style={{
              padding: "60px 20px",
              textAlign: "center",
              color: "#9ca3af",
              fontSize: 13
            }}>
              Enter activity ID and click Load.
            </div>
          ) : loading ? (
            <div style={{
              padding: "60px 20px",
              textAlign: "center",
              color: "#9ca3af",
              fontSize: 13
            }}>
              Loading SLA mappings…
            </div>
          ) : mappings.length === 0 ? (
            <div style={{
              padding: "60px 20px",
              textAlign: "center",
              color: "#9ca3af",
              fontSize: 13
            }}>
              No SLA mappings found for this activity.
            </div>
          ) : (
            <div style={{ overflowX: "auto" }}>
              <table style={{
                width: "100%",
                borderCollapse: "collapse",
                fontSize: 13
              }}>
                <thead>
                  <tr style={{ background: "#fafafa", borderBottom: "1px solid #e5e7eb" }}>
                    <th style={{ padding: "12px 16px", textAlign: "left", fontWeight: 600, color: "#374151" }}>
                      SLA REF
                    </th>
                    <th style={{ padding: "12px 16px", textAlign: "left", fontWeight: 600, color: "#374151" }}>
                      NAME
                    </th>
                    <th style={{ padding: "12px 16px", textAlign: "left", fontWeight: 600, color: "#374151" }}>
                      FORMULA
                    </th>
                    <th style={{ padding: "12px 16px", textAlign: "left", fontWeight: 600, color: "#374151" }}>
                      EFFECTIVE
                    </th>
                    <th style={{ padding: "12px 16px", textAlign: "left", fontWeight: 600, color: "#374151" }}>
                      STATUS
                    </th>
                    <th style={{ padding: "12px 16px", textAlign: "left", fontWeight: 600, color: "#374151" }}>
                      SEVERITY
                    </th>
                    <th style={{ padding: "12px 16px", textAlign: "center", fontWeight: 600, color: "#374151" }}>
                      POINTS
                    </th>
                    <th style={{ padding: "12px 16px", textAlign: "center", fontWeight: 600, color: "#374151" }}>
                      LD %
                    </th>
                    <th style={{ padding: "12px 16px", textAlign: "center", fontWeight: 600, color: "#374151" }}>
                      LD ↑
                    </th>
                    <th style={{ padding: "12px 16px", textAlign: "center", fontWeight: 600, color: "#374151" }}>
                      ACTIONS
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {mappings.map((mapping, idx) => (
                    <tr key={mapping.id || idx} style={{ borderBottom: "1px solid #e5e7eb" }}>
                      <td style={{ padding: "12px 16px", fontFamily: "monospace", fontSize: 11, color: "#6b7280" }}>
                        {mapping.sla_ref || mapping.slaRef || "—"}
                      </td>
                      <td style={{ padding: "12px 16px", color: "#1f2937" }}>
                        {mapping.sla_name || mapping.slaName || "—"}
                      </td>
                      <td style={{ padding: "12px 16px", color: "#6b7280" }}>
                        {mapping.formula || "—"}
                      </td>
                      <td style={{ padding: "12px 16px", color: "#6b7280" }}>
                        {mapping.effective_from || mapping.effectiveFrom || "—"}
                      </td>
                      <td style={{
                        padding: "12px 16px",
                        color: mapping.status === "RETIRED" ? "#9ca3af" : "#059669",
                        fontWeight: 500
                      }}>
                        {mapping.status || "ACTIVE"}
                      </td>
                      <td style={{ padding: "12px 16px", color: "#6b7280" }}>
                        {mapping.severity || "—"}
                      </td>
                      <td style={{ padding: "12px 16px", textAlign: "center", color: "#6b7280" }}>
                        {mapping.points || "—"}
                      </td>
                      <td style={{ padding: "12px 16px", textAlign: "center", color: "#6b7280" }}>
                        {mapping.ld_percent || mapping.ldPercent || "—"}
                      </td>
                      <td style={{ padding: "12px 16px", textAlign: "center", color: "#6b7280" }}>
                        {mapping.ld_value || mapping.ldValue || "—"}
                      </td>
                      <td style={{ padding: "12px 16px", textAlign: "center" }}>
                        {mapping.status !== "RETIRED" && (
                          <button
                            type="button"
                            onClick={() => retireMapping(mapping.id || mapping.mapping_id)}
                            disabled={actionLoading}
                            style={{
                              padding: "4px 12px",
                              background: "#fed7aa",
                              color: "#92400e",
                              border: "1px solid #fdba74",
                              borderRadius: 4,
                              cursor: actionLoading ? "not-allowed" : "pointer",
                              fontSize: 11,
                              fontWeight: 600,
                              opacity: actionLoading ? 0.6 : 1
                            }}
                          >
                            Retire
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
