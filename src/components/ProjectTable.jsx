// ============================================================
// pages/ProjectTable.jsx  –  Route: /projects
// ============================================================
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useProjects, fmtDate } from "../store/Projectstore";
import Field from "./Field";
import Btn   from "./Btn";

export default function ProjectTable() {
  const { projects }  = useProjects();
  const navigate      = useNavigate();
  const [query, setQuery] = useState("");

  const q    = query.trim().toLowerCase();
  const rows = projects.filter((p) => {
    if (!q) return true;
    return [p.projectId, p.projectName, p.description, p.baselineId, p.status, p.category, p.actualEndDate]
      .some((v) => String(v ?? "").toLowerCase().includes(q));
  });

  return (
    <div>
      <div className="pm-title">Project Management</div>
      <div className="card">

        {/* Search bar */}
        <div
          className="grid"
          style={{ gridTemplateColumns: "minmax(0,1fr) auto", gap: 12, alignItems: "end" }}
        >
          <Field label="Search project">
            <input
              placeholder="Search project…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => e.key === "Escape" && setQuery("")}
            />
          </Field>
          <div><Btn onClick={() => setQuery(query)}>Search</Btn></div>
        </div>

        {/* Table */}
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Project ID</th>
                <th>Name</th>
                <th>Category</th>
                <th>Baseline ID</th>
                <th>Status</th>
                <th>Start Date</th>
                <th>End Date</th>
                <th>Actual End Date</th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 ? (
                <tr>
                  <td colSpan={8} style={{ textAlign: "center", padding: 16 }}>
                    No matching projects found.
                  </td>
                </tr>
              ) : (
                rows.map((p) => (
                  <tr key={p.projectId}>
                    {/* Clicking Project ID navigates to details page */}
                    <td
                      className="link"
                      onClick={() => navigate(`/projects/${p.projectId}`)}
                      style={{ cursor: "pointer" }}
                    >
                      {p.projectId}
                    </td>
                    <td>{p.projectName}</td>
                    <td>{p.category}</td>
                    <td>{p.baselineId || "-"}</td>
                    <td>{p.status}</td>
                    <td>{fmtDate(p.startDate)}</td>
                    <td>{fmtDate(p.endDate)}</td>
                    <td>{p.isVersion ? fmtDate(p.actualEndDate || "-") : "-"}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}