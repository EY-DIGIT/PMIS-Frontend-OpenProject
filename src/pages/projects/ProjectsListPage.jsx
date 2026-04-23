import React, { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useProjects } from "../../store/project/projectsStore";
import { formatDateDisplay } from "../../utils/project/helpers";

export default function ProjectsListPage() {
  const navigate = useNavigate();
  const projects = useProjects();
  const [query, setQuery] = useState("");
  const [submitted, setSubmitted] = useState("");

  const filtered = useMemo(() => {
    const q = submitted.trim().toLowerCase();
    if (!q) return projects;
    return projects.filter((p) =>
      [
        p.projectId,
        p.projectName,
        p.description,
        p.baselineId,
        p.status,
        p.owner,
        p.category,
        p.actualEndDate
      ]
        .some((v) => String(v ?? "").toLowerCase().includes(q))
    );
  }, [projects, submitted]);

  function doSearch() {
    setSubmitted(query);
  }

  return (
    <div>
      <div className="uidai-page-title">Project Management</div>
      <div className="uidai-card-project">
        <div
          className="uidai-grid"
          style={{ gridTemplateColumns: "minmax(0,1fr) auto", alignItems: "end" }}
        >
          <div className="uidai-field">
            <label className="uidai-field__label">Search project</label>
            <input
              className="uidai-input"
              placeholder="Search project..."
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") doSearch();
              }}
            />
          </div>
          <div>
            <button className="uidai-btn" onClick={doSearch}>
              Search
            </button>
          </div>
        </div>

        <div className="uidai-table-wrap">
          <table className="uidai-table">
            <thead>
              <tr>
                <th>Project ID</th>
                <th>Name</th>
                <th>Description</th>
                <th>Baseline ID</th>
                <th>Status</th>
                <th>Expected Start Date</th>
                <th>Expected End Date</th>
                <th>Actual End Date</th>
                <th>Is Public</th>
                <th>Owner</th>
                <th>Category</th>
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 ? (
                <tr>
                  <td colSpan={11} style={{ textAlign: "center", padding: 16 }}>
                    No matching projects found.
                  </td>
                </tr>
              ) : (
                filtered.map((p) => (
                  <tr key={p.projectId}>
                    <td>
                      <button
                        className="uidai-link"
                        onClick={() => navigate(`/projects/${encodeURIComponent(p.projectId)}`)}
                      >
                        {p.projectId}
                      </button>
                    </td>
                    <td>{p.projectName}</td>
                    <td>{p.description || ""}</td>
                    <td>{p.baselineId || "-"}</td>
                    <td>{p.status}</td>
                    <td>{formatDateDisplay(p.startDate)}</td>
                    <td>{formatDateDisplay(p.endDate)}</td>
                    <td>{p.isVersion ? formatDateDisplay(p.actualEndDate || "-") : "-"}</td>
                    <td>{p.isPublic}</td>
                    <td>{p.owner}</td>
                    <td>{p.category || ""}</td>
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
