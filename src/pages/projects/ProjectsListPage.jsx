import React, { useMemo, useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useProjects } from "../../store/project/projectsStore";
import { uiStore } from "../../store/project/uiStore";
import { formatDateDisplay } from "../../utils/project/helpers";
import { hydrateProjects } from "../../store/project/apiSync";
import { getToken, logout } from "../../api/auth";
import { API_BASE, authorizedFetch } from "../../api/client";
import { ENDPOINTS } from "../../api/endpoint";
import MilestonePagination from "../../components/projects/MilestonePagination";

/* IST-aware: backend stores IST midnight as UTC 18:30 of the prior day,
   so naive "T"-chopping returns yesterday's date. Project to IST then
   format YYYY-MM-DD. */
function stripTime(iso) {
  if (!iso) return "";
  const s = String(iso);
  if (!s.includes("T")) return s;
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return s.slice(0, s.indexOf("T"));
  const shifted = new Date(d.getTime() + 330 * 60000);
  return `${shifted.getUTCFullYear()}-${String(shifted.getUTCMonth() + 1).padStart(2, "0")}-${String(shifted.getUTCDate()).padStart(2, "0")}`;
}

/* "new" → "NEW", "draft" → "DRAFT", etc. */
function formatStatus(s) {
  if (!s) return "";
  return String(s).replace(/_/g, " ").toUpperCase();
}

function mapApiProjectToRow(p) {
  return {
    // UUID used for navigation and downstream API calls
    projectId: p.id || "",
    // Human-readable project code ("UIDAI-PR...") — what the user thinks of as the ID
    projectCode: p.projectCode || "",
    projectName: p.name || "",
    description: p.description || "",
    status: formatStatus(p.status),
    startDate: stripTime(p.startDate),
    endDate: stripTime(p.endDate),
    actualEndDate: stripTime(p.actualEndDate),
    owner: p.owner || "",
    vendors: Array.isArray(p.vendors) ? p.vendors : []
  };
}

function extractProjectsFromResponse(raw) {
  const elements =
    raw?.data?._embedded?.elements ??
    raw?._embedded?.elements ??
    raw?.data ??
    [];
  return Array.isArray(elements) ? elements : [];
}

export default function ProjectsListPage() {
  const navigate = useNavigate();
  // Kept so the local store stays hydrated for other pages that still read from it
  useProjects();

  const [query, setQuery] = useState("");
  const [submitted, setSubmitted] = useState("");
  const [apiProjects, setApiProjects] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);

  useEffect(() => {
    // legacy store refresh (harmless if other screens still rely on it)
    try { hydrateProjects(); } catch (e) {}

    let cancelled = false;

    async function loadProjects() {
      const token = getToken();
      if (!token) {
        uiStore.showMessage("Please sign in to continue.");
        navigate("/login");
        return;
      }

      setLoading(true);
      setError("");
      try {
        const res = await authorizedFetch(
          `${API_BASE}${ENDPOINTS.projects.list}?offset=1&pageSize=100`,
          {
            method: "GET",
            headers: { accept: "application/json" }
          }
        );

        if (cancelled) return;

        if (res.status === 401) {
          logout();
          uiStore.showMessage("Session expired. Please sign in again.");
          navigate("/login");
          return;
        }

        if (!res.ok) {
          const body = await res.text().catch(() => "");
          throw new Error(body || `Failed to load projects (${res.status})`);
        }

        const raw = await res.json().catch(() => ({}));
        const mapped = extractProjectsFromResponse(raw).map(mapApiProjectToRow);

        if (!cancelled) setApiProjects(mapped);
      } catch (err) {
        if (!cancelled) setError(err?.message || "Failed to load projects");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    loadProjects();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const filtered = useMemo(() => {
    const q = submitted.trim().toLowerCase();
    if (!q) return apiProjects;
    return apiProjects.filter((p) =>
      [
        p.projectId,
        p.projectCode,
        p.projectName,
        p.description,
        p.status,
        p.owner,
        p.actualEndDate
      ].some((v) => String(v ?? "").toLowerCase().includes(q))
    );
  }, [apiProjects, submitted]);

  const total = filtered.length;
  const totalPages = pageSize > 0 ? Math.max(1, Math.ceil(total / pageSize)) : 1;

  // Clamp page when filter or page-size shrinks the list below current page
  useEffect(() => {
    if (page > totalPages) setPage(totalPages);
  }, [page, totalPages]);

  const paged = useMemo(() => {
    if (pageSize <= 0) return filtered;
    const start = (page - 1) * pageSize;
    return filtered.slice(start, start + pageSize);
  }, [filtered, page, pageSize]);

  function doSearch() {
    setSubmitted(query);
    setPage(1);
  }

  function gotoPage(next) {
    const clamped = Math.max(1, Math.min(totalPages, next));
    setPage(clamped);
  }

  function changePageSize(next) {
    setPageSize(next);
    setPage(1);
  }

  return (
    <div>
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
          <div className="uidai-field">
            {/* Invisible label keeps this column's vertical structure
                identical to the search-input column so the button's bottom
                aligns with the input's bottom. */}
            <label
              className="uidai-field__label"
              aria-hidden="true"
              style={{ visibility: "hidden" }}
            >
              Search
            </label>
            <button className="uidai-btn" onClick={doSearch}>
              Search
            </button>
          </div>
        </div>

        {/* {error && !loading && (
          <div className="uidai-hint" style={{ marginTop: 8, color: "#b91c1c" }}>
            Could not load projects: {error}
          </div>
        )} */}

        <div className="uidai-table-wrap">
          <table className="uidai-table">
            <thead>
              <tr>
                <th>Project ID</th>
                <th>Name</th>
                {/* <th>Description</th> */}
                <th>Status</th>
                <th>Expected Start Date</th>
                <th>Expected End Date</th>
                <th>Actual End Date</th>
                <th>Owner</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={7} style={{ textAlign: "center", padding: 16 }}>
                    Loading projects...
                  </td>
                </tr>
              ) : paged.length === 0 ? (
                <tr>
                  <td colSpan={7} style={{ textAlign: "center", padding: 16 }}>
                    {apiProjects.length === 0
                      ? "No projects found."
                      : "No matching projects found."}
                  </td>
                </tr>
              ) : (
                paged.map((p) => (
                  <tr key={p.projectId}>
                    <td>
                      <button
                        className="uidai-link"
                        onClick={() =>
                          navigate(`/projects/${encodeURIComponent(p.projectId)}`)
                        }
                        title={p.projectId}
                      >
                        {p.projectCode || p.projectId}
                      </button>
                    </td>
                    <td>
                      <div className="uidai-clamp-2" title={p.projectName}>
                        {p.projectName}
                      </div>
                    </td>
                    {/* <td>{p.description || ""}</td> */}
                    <td>{p.status}</td>
                    <td>{formatDateDisplay(p.startDate)}</td>
                    <td>{formatDateDisplay(p.endDate)}</td>
                    <td>{p.actualEndDate ? formatDateDisplay(p.actualEndDate) : "-"}</td>
                    <td>{p.owner}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {!loading && total > 0 && (
          <MilestonePagination
            total={total}
            page={page}
            totalPages={totalPages}
            pageSize={pageSize}
            onGoto={gotoPage}
            onSize={changePageSize}
            itemLabel="project"
          />
        )}
      </div>
    </div>
  );
}