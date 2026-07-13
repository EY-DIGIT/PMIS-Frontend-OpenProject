import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useParams } from "react-router-dom";
import { useProject } from "../../store/project/projectsStore";
import { setPageContext, clearPageContext } from "../../utils/pageContext";
import "../../styles/global.css";

const API_BASE = "http://10.1.131.199:8019"; // move to env / your api client

// ---------- formatting helpers ----------
// Swap "en-IN" / "INR" if the rate card is in another currency.
const money = new Intl.NumberFormat("en-IN", {
  style: "currency",
  currency: "INR",
  maximumFractionDigits: 0,
});
const formatMoney = (v) =>
  v == null || v === "" ? "—" : money.format(Number(v));

const formatDate = (v) => {
  if (!v) return "—";
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return v;
  return d.toLocaleDateString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
};

// A resource is editable field-by-field; resId + projectId stay fixed.
const EDITABLE_FIELDS = [
  "name",
  "emailId",
  "rateCard",
  "dateOfJoining",
  "lastDate",
  "designationType",
  "active",
];

export default function ProjectResourcePage() {
  const { projectId } = useParams();
  const project = useProject(projectId);
  const fileInputRef = useRef(null);

  // upload
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState(null);
  const [uploadOk, setUploadOk] = useState(false);

  // table data
  const [resources, setResources] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(null);

  // search
  const [query, setQuery] = useState("");
  const [serverSearching, setServerSearching] = useState(false);
  const [serverMsg, setServerMsg] = useState(null); // { type, text }

  // edit drawer
  const [editing, setEditing] = useState(null);
  // detail view — the resId whose full record is fetched & shown on row click
  const [viewingId, setViewingId] = useState(null);

  useEffect(() => {
    setPageContext({ projectName: project?.projectName || "" });
    return () => clearPageContext();
  }, [project?.projectName]);

  // ---------- load: GET /api/resources ----------
  const loadResources = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const res = await fetch(`${API_BASE}/api/resources`, {
        headers: { accept: "*/*" },
      });
      if (!res.ok) throw new Error(`Couldn't load resources (${res.status})`);
      const data = await res.json();
      const list = Array.isArray(data) ? data : data ? [data] : [];

      // The GET has no projectId param, so scope client-side.
      // If nothing matches (API isn't project-aware), show the full list
      // instead of an empty table.
      let scoped = list;
      if (projectId) {
        const byProject = list.filter(
          (r) => String(r.projectId) === String(projectId)
        );
        scoped = byProject.length ? byProject : list;
      }
      setResources(scoped);
    } catch (e) {
      setLoadError(e.message || "Couldn't load resources");
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    loadResources();
  }, [loadResources]);

  // ---------- client-side filter ----------
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return resources;
    return resources.filter((r) =>
      [r.resId, r.name, r.emailId, r.designationType]
        .filter(Boolean)
        .some((f) => String(f).toLowerCase().includes(q))
    );
  }, [resources, query]);

  const looksLikeResId = /^\d{3,}$/.test(query.trim());
  const showServerFallback =
    filtered.length === 0 && looksLikeResId && !loading;

  // ---------- server lookup: GET /api/resources/{resId} ----------
  async function fetchById(resId) {
    setServerSearching(true);
    setServerMsg(null);
    try {
      const res = await fetch(
        `${API_BASE}/api/resources/${encodeURIComponent(resId)}`,
        { headers: { accept: "*/*" } }
      );
      if (res.status === 404) {
        setServerMsg({ type: "warn", text: `No resource found for ${resId}.` });
        return;
      }
      if (!res.ok) throw new Error(`Lookup failed (${res.status})`);
      const data = await res.json();
      setResources((prev) =>
        prev.some((r) => r.resId === data.resId)
          ? prev.map((r) => (r.resId === data.resId ? data : r))
          : [data, ...prev]
      );
      setServerMsg({ type: "ok", text: `Found ${data.name} (${data.resId}).` });
    } catch (e) {
      setServerMsg({ type: "error", text: e.message || "Lookup failed" });
    } finally {
      setServerSearching(false);
    }
  }

  // ---------- save: PUT /api/resources/{resId} ----------
  async function saveResource(updated) {
    const res = await fetch(
      `${API_BASE}/api/resources/${encodeURIComponent(updated.resId)}`,
      {
        method: "PUT",
        headers: { "Content-Type": "application/json", accept: "*/*" },
        body: JSON.stringify(updated),
      }
    );
    if (!res.ok) throw new Error(`Save failed (${res.status})`);
    const text = await res.text();
    let saved = updated;
    try {
      saved = text ? JSON.parse(text) : updated;
    } catch {
      /* server returned no/So invalid body — keep our optimistic copy */
    }
    setResources((prev) =>
      prev.map((r) => (r.resId === saved.resId ? { ...r, ...saved } : r))
    );
    return saved;
  }

  // ---------- upload: POST /api/resources/upload ----------
  async function uploadFile(file) {
    if (!file || !projectId) return;
    setUploading(true);
    setUploadError(null);
    setUploadOk(false);

    const formData = new FormData();
    formData.append("file", file);

    try {
      const res = await fetch(
        `${API_BASE}/api/resources/upload?projectId=${encodeURIComponent(
          projectId
        )}`,
        {
          method: "POST",
          headers: { accept: "*/*" },
          // Don't set Content-Type — the browser adds the multipart boundary.
          body: formData,
        }
      );
      if (!res.ok) throw new Error(`Upload failed (${res.status})`);
      setUploadOk(true);
      await loadResources(); // refresh the table with the newly imported rows
    } catch (err) {
      setUploadError(err.message || "Upload failed");
    } finally {
      setUploading(false);
    }
  }

  function handleFileChange(e) {
    const file = e.target.files?.[0];
    uploadFile(file);
    e.target.value = ""; // allow re-selecting the same file
  }

  const activeCount = resources.filter((r) => r.active).length;

  return (
    <div className="uidai-pmis-content" style={{ padding: "28px 24px 64px", maxWidth: "1280px", margin: "0 auto" }}>
      <style>{`
        @media (max-width: 640px) {
          .uidai-pmis-content { padding: 20px 16px 48px; }
        }
        .search-container:focus-within {
          border-color: #0b3c88;
          box-shadow: 0 0 0 3px #eef2ff;
        }
      `}</style>
      <input
        ref={fileInputRef}
        type="file"
        accept=".xlsx,.xls,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
        onChange={handleFileChange}
        style={{ display: "none" }}
      />

      {/* Header section */}
      <div style={{ marginBottom: "32px" }}>
        <div style={{ marginBottom: "6px", fontSize: "12px", fontWeight: 600, letterSpacing: "0.08em", textTransform: "uppercase", color: "#0b3c88" }}>
          {project?.projectName ? project.projectName : "Project"}
        </div>
        <h1 className="uidai-pmis-title" style={{ marginBottom: "6px" }}>Resources</h1>
        <p className="uidai-pmis-subtitle">Manage team members and resource allocation for your project</p>
        <div style={{ display: "flex", gap: "18px", fontSize: "13px", color: "#6b7a90", marginTop: "18px", flexWrap: "wrap" }}>
          <span style={{ display: "flex", alignItems: "center", gap: "8px" }}>
            <span style={{ fontWeight: 700, color: "#1e2a3a", fontSize: "16px" }}>{resources.length}</span> 
            <span>total resources</span>
          </span>
          <span style={{ width: "4px", height: "4px", borderRadius: "50%", background: "#cbd2df", alignSelf: "center" }} />
          <span style={{ display: "flex", alignItems: "center", gap: "8px" }}>
            <span style={{ fontWeight: 700, color: "#0f9d58", fontSize: "16px" }}>{activeCount}</span> 
            <span>active now</span>
          </span>
        </div>
      </div>

      {/* Toolbar section */}
      <div style={{ display: "flex", gap: "12px", alignItems: "center", justifyContent: "space-between", marginBottom: "24px", flexWrap: "wrap" }}>
        <div style={{ position: "relative", display: "flex", alignItems: "center", flex: "1", minWidth: "240px", maxWidth: "400px", background: "#fff", border: "1px solid #dbe5f1", borderRadius: "10px", padding: "0 12px", transition: "all 0.2s ease", boxShadow: "0 1px 3px rgba(0,0,0,0.04)" }} className="search-container">
          <SearchIcon />
          <input
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setServerMsg(null);
            }}
            placeholder="Search by name, email, ID or role…"
            aria-label="Search resources"
            style={{ border: "none", outline: "none", background: "transparent", flex: 1, padding: "11px 10px", fontSize: "14px", color: "#1e2a3a", fontFamily: "inherit" }}
          />
          {query && (
            <button
              onClick={() => setQuery("")}
              aria-label="Clear search"
              style={{ border: "none", background: "transparent", color: "#6b7a90", cursor: "pointer", fontSize: "16px", padding: "6px 8px", borderRadius: "6px", transition: "all 0.2s ease", display: "flex", alignItems: "center", justifyContent: "center", height: "32px", width: "32px" }}
              onMouseEnter={(e) => {
                e.currentTarget.style.background = "#f1f5f9";
                e.currentTarget.style.color = "#1e2a3a";
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = "transparent";
                e.currentTarget.style.color = "#6b7a90";
              }}
              title="Clear search"
            >
              ✕
            </button>
          )}
        </div>

        <div style={{ display: "flex", gap: "10px", flexWrap: "wrap" }}>
          <button
            onClick={loadResources}
            disabled={loading}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: "8px",
              borderRadius: "10px",
              fontSize: "14px",
              fontWeight: 600,
              padding: "10px 16px",
              cursor: loading ? "not-allowed" : "pointer",
              border: "1px solid #dbe5f1",
              background: "#fff",
              color: "#1e2a3a",
              transition: "all 0.2s ease",
              opacity: loading ? 0.55 : 1,
              boxShadow: "0 1px 2px rgba(0,0,0,0.04)",
            }}
            onMouseEnter={(e) => !loading && (e.currentTarget.style.background = "#f9fafb")}
            onMouseLeave={(e) => !loading && (e.currentTarget.style.background = "#fff")}
            title="Reload resources"
          >
            <RefreshIcon spinning={loading} />
            Refresh
          </button>
          <button
            onClick={() => fileInputRef.current?.click()}
            disabled={uploading || !projectId}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: "8px",
              borderRadius: "10px",
              fontSize: "14px",
              fontWeight: 600,
              padding: "10px 16px",
              cursor: uploading || !projectId ? "not-allowed" : "pointer",
              border: "none",
              background: "#0b3c88",
              color: "#fff",
              transition: "all 0.2s ease",
              opacity: uploading || !projectId ? 0.55 : 1,
              boxShadow: "0 2px 4px rgba(11, 60, 136, 0.15)",
            }}
            onMouseEnter={(e) => !uploading && projectId && (e.currentTarget.style.background = "#051f4a")}
            onMouseLeave={(e) => !uploading && projectId && (e.currentTarget.style.background = "#0b3c88")}
            title={projectId ? "Upload resources from Excel file" : "Select a project first"}
          >
            <UploadIcon />
            {uploading ? "Uploading…" : "Upload"}
          </button>
        </div>
      </div>

      {/* Feedback banners */}
      {uploadError && (
        <div style={{ background: "#fde8e8", border: "1px solid #f5c9c9", color: "#d32f2f", borderRadius: "10px", padding: "14px 16px", fontSize: "14px", marginBottom: "16px", display: "flex", alignItems: "flex-start", gap: "12px", animation: "slideDown 0.3s ease-out" }}>
          <span style={{ fontSize: "20px", flexShrink: 0, marginTop: "2px" }}>⚠️</span>
          <div>
            <div style={{ fontWeight: 600, marginBottom: "2px" }}>Upload failed</div>
            <div style={{ fontSize: "13px", opacity: 0.9 }}>{uploadError}</div>
          </div>
        </div>
      )}
      {uploadOk && (
        <div style={{ background: "#e6f6ee", border: "1px solid #c7ead6", color: "#0f9d58", borderRadius: "10px", padding: "14px 16px", fontSize: "14px", marginBottom: "16px", display: "flex", alignItems: "flex-start", gap: "12px", animation: "slideDown 0.3s ease-out" }}>
          <span style={{ fontSize: "20px", flexShrink: 0, marginTop: "2px" }}>✓</span>
          <div>
            <div style={{ fontWeight: 600, marginBottom: "2px" }}>Upload successful</div>
            <div style={{ fontSize: "13px", opacity: 0.9 }}>Resources imported successfully. The table has been refreshed.</div>
          </div>
        </div>
      )}
      {serverMsg && (
        <div style={{
          background: serverMsg.type === "error" ? "#fde8e8" : serverMsg.type === "ok" ? "#e6f6ee" : "#fef3c7",
          border: serverMsg.type === "error" ? "1px solid #f5c9c9" : serverMsg.type === "ok" ? "1px solid #c7ead6" : "1px solid #fadf9a",
          color: serverMsg.type === "error" ? "#d32f2f" : serverMsg.type === "ok" ? "#0f9d58" : "#b45309",
          borderRadius: "10px",
          padding: "14px 16px",
          fontSize: "14px",
          marginBottom: "16px",
          display: "flex",
          alignItems: "flex-start",
          gap: "12px",
          animation: "slideDown 0.3s ease-out"
        }}>
          <span style={{ fontSize: "20px", flexShrink: 0, marginTop: "2px" }}>{serverMsg.type === "error" ? "❌" : serverMsg.type === "ok" ? "✓" : "ℹ️"}</span>
          <div style={{ fontSize: "13px" }}>{serverMsg.text}</div>
        </div>
      )}
      <style>{`@keyframes slideDown { from { opacity: 0; transform: translateY(-10px); } to { opacity: 1; transform: translateY(0); } }`}</style>

      {/* Main content card */}
      <div className="uidai-pmis-card" style={{ overflow: "hidden", border: "1px solid #dbe5f1" }}>
        {loading ? (
          <TableSkeleton />
        ) : loadError ? (
          <div style={{ textAlign: "center", padding: "64px 24px" }}>
            <div style={{ fontSize: "52px", marginBottom: "16px", opacity: "0.5" }}>⚠️</div>
            <div style={{ fontSize: "16px", fontWeight: 600, marginBottom: "8px", color: "#1e2a3a" }}>
              {loadError}
            </div>
            <p style={{ color: "#6b7a90", fontSize: "14px", marginBottom: "24px" }}>
              There was a problem loading the resources. Please try again.
            </p>
            <button
              onClick={loadResources}
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: "8px",
                borderRadius: "10px",
                fontSize: "14px",
                fontWeight: 600,
                padding: "10px 18px",
                cursor: "pointer",
                border: "none",
                background: "#0b3c88",
                color: "#fff",
                transition: "all 0.2s ease",
              }}
              onMouseEnter={(e) => (e.currentTarget.style.background = "#051f4a")}
              onMouseLeave={(e) => (e.currentTarget.style.background = "#0b3c88")}
            >
              🔄 Try again
            </button>
          </div>
        ) : filtered.length === 0 ? (
          <div style={{ textAlign: "center", padding: "64px 24px" }}>
            <div style={{ fontSize: "52px", marginBottom: "16px", opacity: "0.5" }}>👥</div>
            <div style={{ fontSize: "16px", fontWeight: 600, marginBottom: "8px", color: "#1e2a3a" }}>
              {query ? "No resources match your search." : "No resources yet."}
            </div>
            <p style={{ color: "#6b7a90", fontSize: "14px", marginBottom: "24px", maxWidth: "380px", margin: "0 auto" }}>
              {query
                ? showServerFallback
                  ? "This resource might not be loaded on this page. Try searching the server."
                  : "Try searching with a different name, email, ID, or designation."
                : "Upload a spreadsheet to import team members for this project. Resources help track team capacity and planning."}
            </p>
            {showServerFallback && (
              <button
                onClick={() => fetchById(query.trim())}
                disabled={serverSearching}
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: "8px",
                  borderRadius: "10px",
                  fontSize: "14px",
                  fontWeight: 600,
                  padding: "10px 18px",
                  cursor: serverSearching ? "not-allowed" : "pointer",
                  border: "none",
                  background: "#0b3c88",
                  color: "#fff",
                  transition: "all 0.2s ease",
                  opacity: serverSearching ? 0.55 : 1,
                }}
                onMouseEnter={(e) => !serverSearching && (e.currentTarget.style.background = "#051f4a")}
                onMouseLeave={(e) => !serverSearching && (e.currentTarget.style.background = "#0b3c88")}
              >
                {serverSearching ? "Searching…" : `🔍 Search server for "${query.trim()}"`}
              </button>
            )}
          </div>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table style={{
              width: "100%",
              borderCollapse: "collapse",
              fontSize: "14px",
            }}>
              <thead>
                <tr style={{ background: "#f4f7fb" }}>
                  <th style={{
                    position: "sticky",
                    top: 0,
                    background: "#f4f7fb",
                    color: "#6b7a90",
                    textAlign: "left",
                    fontSize: "11.5px",
                    fontWeight: 700,
                    letterSpacing: "0.05em",
                    textTransform: "uppercase",
                    padding: "12px 16px",
                    borderBottom: "1px solid #dbe5f1",
                    whiteSpace: "nowrap",
                  }}>ID</th>
                  <th style={{
                    position: "sticky",
                    top: 0,
                    background: "#f4f7fb",
                    color: "#6b7a90",
                    textAlign: "left",
                    fontSize: "11.5px",
                    fontWeight: 700,
                    letterSpacing: "0.05em",
                    textTransform: "uppercase",
                    padding: "12px 16px",
                    borderBottom: "1px solid #dbe5f1",
                    whiteSpace: "nowrap",
                  }}>Name</th>
                  <th style={{
                    position: "sticky",
                    top: 0,
                    background: "#f4f7fb",
                    color: "#6b7a90",
                    textAlign: "left",
                    fontSize: "11.5px",
                    fontWeight: 700,
                    letterSpacing: "0.05em",
                    textTransform: "uppercase",
                    padding: "12px 16px",
                    borderBottom: "1px solid #dbe5f1",
                    whiteSpace: "nowrap",
                  }}>Designation</th>
                  <th style={{
                    position: "sticky",
                    top: 0,
                    background: "#f4f7fb",
                    color: "#6b7a90",
                    textAlign: "right",
                    fontSize: "11.5px",
                    fontWeight: 700,
                    letterSpacing: "0.05em",
                    textTransform: "uppercase",
                    padding: "12px 16px",
                    borderBottom: "1px solid #dbe5f1",
                    whiteSpace: "nowrap",
                  }}>Rate card</th>
                  <th style={{
                    position: "sticky",
                    top: 0,
                    background: "#f4f7fb",
                    color: "#6b7a90",
                    textAlign: "left",
                    fontSize: "11.5px",
                    fontWeight: 700,
                    letterSpacing: "0.05em",
                    textTransform: "uppercase",
                    padding: "12px 16px",
                    borderBottom: "1px solid #dbe5f1",
                    whiteSpace: "nowrap",
                  }}>Joined</th>
                  <th style={{
                    position: "sticky",
                    top: 0,
                    background: "#f4f7fb",
                    color: "#6b7a90",
                    textAlign: "left",
                    fontSize: "11.5px",
                    fontWeight: 700,
                    letterSpacing: "0.05em",
                    textTransform: "uppercase",
                    padding: "12px 16px",
                    borderBottom: "1px solid #dbe5f1",
                    whiteSpace: "nowrap",
                  }}>Last date</th>
                  <th style={{
                    position: "sticky",
                    top: 0,
                    background: "#f4f7fb",
                    color: "#6b7a90",
                    textAlign: "center",
                    fontSize: "11.5px",
                    fontWeight: 700,
                    letterSpacing: "0.05em",
                    textTransform: "uppercase",
                    padding: "12px 16px",
                    borderBottom: "1px solid #dbe5f1",
                    whiteSpace: "nowrap",
                  }}>Status</th>
                  <th style={{
                    position: "sticky",
                    top: 0,
                    background: "#f4f7fb",
                    color: "#6b7a90",
                    textAlign: "center",
                    fontSize: "11.5px",
                    fontWeight: 700,
                    letterSpacing: "0.05em",
                    textTransform: "uppercase",
                    padding: "12px 16px",
                    borderBottom: "1px solid #dbe5f1",
                    whiteSpace: "nowrap",
                  }}>Action</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((r) => (
                  <tr
                    key={r.resId}
                    onClick={() => setViewingId(r.resId)}
                    title="View resource details"
                    style={{
                      borderBottom: "1px solid #eef1f6",
                      transition: "background-color 0.2s ease, box-shadow 0.2s ease",
                      cursor: "pointer",
                    }}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.background = "#f4f7fb";
                      e.currentTarget.style.boxShadow = "inset 0 0 0 1px #e0e7f0";
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.background = "transparent";
                      e.currentTarget.style.boxShadow = "none";
                    }}
                  >
                    <td style={{ padding: "13px 16px", verticalAlign: "middle", color: "#1e2a3a", fontVariantNumeric: "tabular-nums" }}>
                      <code style={{ fontSize: "13px", background: "#f4f7fb", padding: "2px 6px", borderRadius: "4px" }}>
                        {r.resId}
                      </code>
                    </td>
                    <td style={{ padding: "13px 16px", verticalAlign: "middle" }}>
                      <div style={{ fontWeight: 600, color: "#1e2a3a" }}>{r.name}</div>
                      <div style={{ color: "#6b7a90", fontSize: "12.5px", marginTop: "2px" }}>{r.emailId}</div>
                    </td>
                    <td style={{ padding: "13px 16px", verticalAlign: "middle", color: "#1e2a3a" }}>
                      {r.designationType || "—"}
                    </td>
                    <td style={{ padding: "13px 16px", verticalAlign: "middle", textAlign: "right", color: "#1e2a3a", fontVariantNumeric: "tabular-nums" }}>
                      {formatMoney(r.rateCard)}
                    </td>
                    <td style={{ padding: "13px 16px", verticalAlign: "middle", color: "#1e2a3a" }}>
                      {formatDate(r.dateOfJoining)}
                    </td>
                    <td style={{ padding: "13px 16px", verticalAlign: "middle", color: "#1e2a3a" }}>
                      {formatDate(r.lastDate)}
                    </td>
                    <td style={{ padding: "13px 16px", verticalAlign: "middle", textAlign: "center" }}>
                      <span
                        style={{
                          display: "inline-flex",
                          alignItems: "center",
                          gap: "6px",
                          fontSize: "12px",
                          fontWeight: 600,
                          padding: "4px 12px",
                          borderRadius: "999px",
                          background: r.active ? "#e6f6ee" : "#eef1f6",
                          color: r.active ? "#0f9d58" : "#6b7a90",
                        }}
                      >
                        <span style={{
                          width: "6px",
                          height: "6px",
                          borderRadius: "50%",
                          background: "currentColor",
                          display: "inline-block",
                        }} />
                        {r.active ? "Active" : "Inactive"}
                      </span>
                    </td>
                    <td style={{ padding: "13px 16px", verticalAlign: "middle", textAlign: "center" }}>
                      <button
                        onClick={(e) => { e.stopPropagation(); setEditing(r); }}
                        style={{
                          display: "inline-flex",
                          alignItems: "center",
                          gap: "6px",
                          fontSize: "13px",
                          fontWeight: 600,
                          color: "#0b3c88",
                          background: "transparent",
                          border: "1px solid #dbe5f1",
                          borderRadius: "8px",
                          padding: "6px 12px",
                          cursor: "pointer",
                          transition: "all 0.15s ease",
                        }}
                        onMouseEnter={(e) => {
                          e.currentTarget.style.background = "#eef2ff";
                          e.currentTarget.style.borderColor = "#0b3c88";
                        }}
                        onMouseLeave={(e) => {
                          e.currentTarget.style.background = "transparent";
                          e.currentTarget.style.borderColor = "#dbe5f1";
                        }}
                      >
                        <EditIcon />
                        Edit
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Edit drawer */}
      {editing && (
        <EditDrawer
          resource={editing}
          onClose={() => setEditing(null)}
          onSave={saveResource}
        />
      )}

      {/* Detail drawer — fetches GET /api/resources/{resId} on open */}
      {viewingId && (
        <ResourceDetailDrawer
          resId={viewingId}
          onClose={() => setViewingId(null)}
          onEdit={(r) => { setViewingId(null); setEditing(r); }}
        />
      )}
    </div>
  );
}

/* =====================================================================
   Detail drawer — GET /api/resources/{resId}. Opened by clicking a row;
   shows the resource's full record fetched fresh from the server.
   ===================================================================== */
function ResourceDetailDrawer({ resId, onClose, onEdit }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    const onKey = (e) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  useEffect(() => {
    let active = true;
    const controller = new AbortController();
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch(
          `${API_BASE}/api/resources/${encodeURIComponent(resId)}`,
          { headers: { accept: "*/*" }, signal: controller.signal }
        );
        if (!res.ok) throw new Error(`Couldn't load resource (${res.status})`);
        const json = await res.json();
        if (active) setData(json);
      } catch (e) {
        if (active && e.name !== "AbortError")
          setError(e.message || "Couldn't load resource");
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => { active = false; controller.abort(); };
  }, [resId]);

  const rows = data
    ? [
        { label: "Resource ID", value: data.resId },
        { label: "Full name", value: data.name || "—" },
        { label: "Email", value: data.emailId || "—" },
        { label: "Designation", value: data.designationType || "—" },
        { label: "Rate card", value: formatMoney(data.rateCard) },
        { label: "Date of joining", value: formatDate(data.dateOfJoining) },
        { label: "Last date", value: formatDate(data.lastDate) },
        { label: "Status", value: data.active ? "Active" : "Inactive" },
        { label: "Project ID", value: data.projectId || "—" },
      ]
    : [];

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(11, 42, 99, 0.45)",
        backdropFilter: "blur(2px)",
        display: "flex",
        justifyContent: "flex-end",
        zIndex: 1000,
        animation: "fadeIn 0.15s ease",
      }}
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
    >
      <style>{`@keyframes fadeIn { from { opacity: 0; } to { opacity: 1; } }
               @keyframes slideIn { from { transform: translateX(24px); opacity: 0.6; } to { transform: translateX(0); opacity: 1; } }
               .drawer { animation: slideIn 0.22s cubic-bezier(0.2, 0.8, 0.2, 1); }`}</style>
      <aside
        className="drawer"
        style={{
          width: "min(440px, 100%)",
          height: "100%",
          background: "#fff",
          display: "flex",
          flexDirection: "column",
          boxShadow: "-16px 0 40px rgba(11, 23, 42, 0.18)",
        }}
        role="dialog"
        aria-modal="true"
        aria-label={`Resource ${resId}`}
      >
        {/* Header */}
        <div style={{
          display: "flex",
          alignItems: "flex-start",
          justifyContent: "space-between",
          padding: "22px 24px",
          borderBottom: "1px solid #dbe5f1",
          gap: "16px",
        }}>
          <div>
            <div style={{ fontSize: "12px", fontWeight: 600, letterSpacing: "0.08em", textTransform: "uppercase", color: "#0b3c88", marginBottom: "4px" }}>
              Resource details
            </div>
            <h2 style={{ margin: "2px 0 0", fontSize: "20px", fontWeight: 700, letterSpacing: "-0.01em", color: "#1e2a3a" }}>
              {data?.name || `#${resId}`}
            </h2>
          </div>
          <button
            onClick={onClose}
            aria-label="Close"
            style={{
              border: "none",
              background: "#eef1f6",
              color: "#6b7a90",
              width: "30px",
              height: "30px",
              borderRadius: "8px",
              cursor: "pointer",
              fontSize: "18px",
              lineHeight: "1",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              transition: "all 0.2s ease",
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = "#e3e7ef";
              e.currentTarget.style.color = "#1e2a3a";
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = "#eef1f6";
              e.currentTarget.style.color = "#6b7a90";
            }}
          >
            ✕
          </button>
        </div>

        {/* Body */}
        <div style={{ padding: "22px 24px", overflowY: "auto", flex: 1 }}>
          {loading ? (
            <div style={{ color: "#6b7a90", fontSize: "14px", padding: "8px 0" }}>Loading…</div>
          ) : error ? (
            <div style={{
              background: "#fde8e8",
              border: "1px solid #f5c9c9",
              color: "#d32f2f",
              borderRadius: "10px",
              padding: "12px 14px",
              fontSize: "13.5px",
            }}>
              {error}
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: "2px" }}>
              {rows.map((row, i) => (
                <div
                  key={row.label}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    gap: "16px",
                    padding: "12px 2px",
                    borderBottom: i === rows.length - 1 ? "none" : "1px solid #eef1f6",
                  }}
                >
                  <span style={{ fontSize: "13px", color: "#6b7a90", fontWeight: 600 }}>{row.label}</span>
                  <span style={{
                    fontSize: "14px",
                    color: "#1e2a3a",
                    fontWeight: 600,
                    textAlign: "right",
                    wordBreak: "break-word",
                    fontVariantNumeric: "tabular-nums",
                  }}>
                    {row.label === "Status" ? (
                      <span style={{
                        display: "inline-flex",
                        alignItems: "center",
                        gap: "6px",
                        fontSize: "12px",
                        fontWeight: 600,
                        padding: "4px 12px",
                        borderRadius: "999px",
                        background: data.active ? "#e6f6ee" : "#eef1f6",
                        color: data.active ? "#0f9d58" : "#6b7a90",
                      }}>
                        <span style={{ width: "6px", height: "6px", borderRadius: "50%", background: "currentColor" }} />
                        {row.value}
                      </span>
                    ) : (
                      row.value
                    )}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Footer */}
        <div style={{
          display: "flex",
          justifyContent: "flex-end",
          gap: "10px",
          padding: "16px 24px",
          borderTop: "1px solid #dbe5f1",
          background: "#f9fafb",
        }}>
          <button
            onClick={onClose}
            style={{
              borderRadius: "10px",
              fontSize: "14px",
              fontWeight: 600,
              padding: "9px 14px",
              cursor: "pointer",
              border: "1px solid #dbe5f1",
              background: "#fff",
              color: "#1e2a3a",
            }}
          >
            Close
          </button>
          <button
            onClick={() => data && onEdit(data)}
            disabled={!data}
            style={{
              borderRadius: "10px",
              fontSize: "14px",
              fontWeight: 600,
              padding: "9px 14px",
              cursor: data ? "pointer" : "not-allowed",
              border: "none",
              background: "#0b3c88",
              color: "#fff",
              opacity: data ? 1 : 0.55,
            }}
          >
            Edit
          </button>
        </div>
      </aside>
    </div>
  );
}

/* =====================================================================
   Edit drawer — PUT /api/resources/{resId}
   ===================================================================== */
function EditDrawer({ resource, onClose, onSave }) {
  const [form, setForm] = useState(() => ({
    ...resource,
    lastDate: resource.lastDate || "",
    rateCard: resource.rateCard ?? "",
  }));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  // Close on Escape.
  useEffect(() => {
    const onKey = (e) => e.key === "Escape" && !saving && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, saving]);

  const set = (key) => (e) => {
    const value =
      key === "active"
        ? e.target.checked
        : key === "rateCard"
        ? e.target.value
        : e.target.value;
    setForm((f) => ({ ...f, [key]: value }));
  };

  async function submit() {
    setSaving(true);
    setError(null);
    try {
      // Build a clean payload matching the API shape.
      const payload = {
        ...resource,
        ...Object.fromEntries(EDITABLE_FIELDS.map((k) => [k, form[k]])),
        lastDate: form.lastDate ? form.lastDate : null,
        rateCard:
          form.rateCard === "" || form.rateCard == null
            ? null
            : Number(form.rateCard),
      };
      await onSave(payload);
      onClose();
    } catch (e) {
      setError(e.message || "Save failed");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(11, 42, 99, 0.45)",
        backdropFilter: "blur(2px)",
        display: "flex",
        justifyContent: "flex-end",
        zIndex: 1000,
        animation: "fadeIn 0.15s ease",
      }}
      onMouseDown={(e) => e.target === e.currentTarget && !saving && onClose()}
    >
      <style>{`@keyframes fadeIn { from { opacity: 0; } to { opacity: 1; } }
               @keyframes slideIn { from { transform: translateX(24px); opacity: 0.6; } to { transform: translateX(0); opacity: 1; } }
               .drawer { animation: slideIn 0.22s cubic-bezier(0.2, 0.8, 0.2, 1); }`}</style>
      <aside
        className="drawer"
        style={{
          width: "min(440px, 100%)",
          height: "100%",
          background: "#fff",
          display: "flex",
          flexDirection: "column",
          boxShadow: "-16px 0 40px rgba(11, 23, 42, 0.18)",
        }}
        role="dialog"
        aria-modal="true"
        aria-label={`Edit ${resource.name}`}
      >
        {/* Drawer header */}
        <div style={{
          display: "flex",
          alignItems: "flex-start",
          justifyContent: "space-between",
          padding: "22px 24px",
          borderBottom: "1px solid #dbe5f1",
          gap: "16px",
        }}>
          <div>
            <div style={{ fontSize: "12px", fontWeight: 600, letterSpacing: "0.08em", textTransform: "uppercase", color: "#0b3c88", marginBottom: "4px" }}>
              Edit resource
            </div>
            <h2 style={{ margin: "2px 0 0", fontSize: "20px", fontWeight: 700, letterSpacing: "-0.01em", color: "#1e2a3a" }}>
              {resource.name}
            </h2>
          </div>
          <button
            onClick={onClose}
            aria-label="Close"
            style={{
              border: "none",
              background: "#eef1f6",
              color: "#6b7a90",
              width: "30px",
              height: "30px",
              borderRadius: "8px",
              cursor: "pointer",
              fontSize: "18px",
              lineHeight: "1",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              transition: "all 0.2s ease",
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = "#e3e7ef";
              e.currentTarget.style.color = "#1e2a3a";
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = "#eef1f6";
              e.currentTarget.style.color = "#6b7a90";
            }}
          >
            ✕
          </button>
        </div>

        {/* Drawer body */}
        <div style={{
          padding: "22px 24px",
          overflowY: "auto",
          flex: 1,
          display: "flex",
          flexDirection: "column",
          gap: "16px",
        }}>
          {/* Readonly field */}
          <div style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            background: "#f4f7fb",
            border: "1px solid #dbe5f1",
            borderRadius: "10px",
            padding: "12px 14px",
            fontSize: "13px",
            color: "#6b7a90",
          }}>
            <span>Resource ID</span>
            <b style={{ color: "#1e2a3a", fontVariantNumeric: "tabular-nums" }}>{resource.resId}</b>
          </div>

          {/* Full name field */}
          <EditField label="Full name">
            <input
              value={form.name || ""}
              onChange={set("name")}
              style={{
                width: "100%",
                border: "1px solid #dbe5f1",
                borderRadius: "9px",
                padding: "10px 12px",
                fontSize: "14px",
                color: "#1e2a3a",
                background: "#fff",
                outline: "none",
                transition: "all 0.15s ease",
                fontFamily: "inherit",
              }}
              onFocus={(e) => {
                e.currentTarget.style.borderColor = "#0b3c88";
                e.currentTarget.style.boxShadow = "0 0 0 3px #eef2ff";
              }}
              onBlur={(e) => {
                e.currentTarget.style.borderColor = "#dbe5f1";
                e.currentTarget.style.boxShadow = "none";
              }}
            />
          </EditField>

          {/* Email field */}
          <EditField label="Email">
            <input
              type="email"
              value={form.emailId || ""}
              onChange={set("emailId")}
              style={{
                width: "100%",
                border: "1px solid #dbe5f1",
                borderRadius: "9px",
                padding: "10px 12px",
                fontSize: "14px",
                color: "#1e2a3a",
                background: "#fff",
                outline: "none",
                transition: "all 0.15s ease",
                fontFamily: "inherit",
              }}
              onFocus={(e) => {
                e.currentTarget.style.borderColor = "#0b3c88";
                e.currentTarget.style.boxShadow = "0 0 0 3px #eef2ff";
              }}
              onBlur={(e) => {
                e.currentTarget.style.borderColor = "#dbe5f1";
                e.currentTarget.style.boxShadow = "none";
              }}
            />
          </EditField>

          {/* Designation field */}
          <EditField label="Designation">
            <input
              value={form.designationType || ""}
              onChange={set("designationType")}
              style={{
                width: "100%",
                border: "1px solid #dbe5f1",
                borderRadius: "9px",
                padding: "10px 12px",
                fontSize: "14px",
                color: "#1e2a3a",
                background: "#fff",
                outline: "none",
                transition: "all 0.15s ease",
                fontFamily: "inherit",
              }}
              onFocus={(e) => {
                e.currentTarget.style.borderColor = "#0b3c88";
                e.currentTarget.style.boxShadow = "0 0 0 3px #eef2ff";
              }}
              onBlur={(e) => {
                e.currentTarget.style.borderColor = "#dbe5f1";
                e.currentTarget.style.boxShadow = "none";
              }}
            />
          </EditField>

          {/* Rate card and joining date */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "14px" }}>
            <EditField label="Rate card (₹)">
              <input
                type="number"
                inputMode="numeric"
                value={form.rateCard}
                onChange={set("rateCard")}
                style={{
                  width: "100%",
                  border: "1px solid #dbe5f1",
                  borderRadius: "9px",
                  padding: "10px 12px",
                  fontSize: "14px",
                  color: "#1e2a3a",
                  background: "#fff",
                  outline: "none",
                  transition: "all 0.15s ease",
                  fontFamily: "inherit",
                }}
                onFocus={(e) => {
                  e.currentTarget.style.borderColor = "#0b3c88";
                  e.currentTarget.style.boxShadow = "0 0 0 3px #eef2ff";
                }}
                onBlur={(e) => {
                  e.currentTarget.style.borderColor = "#dbe5f1";
                  e.currentTarget.style.boxShadow = "none";
                }}
              />
            </EditField>
            <EditField label="Date of joining">
              <input
                type="date"
                value={form.dateOfJoining || ""}
                onChange={set("dateOfJoining")}
                style={{
                  width: "100%",
                  border: "1px solid #dbe5f1",
                  borderRadius: "9px",
                  padding: "10px 12px",
                  fontSize: "14px",
                  color: "#1e2a3a",
                  background: "#fff",
                  outline: "none",
                  transition: "all 0.15s ease",
                  fontFamily: "inherit",
                }}
                onFocus={(e) => {
                  e.currentTarget.style.borderColor = "#0b3c88";
                  e.currentTarget.style.boxShadow = "0 0 0 3px #eef2ff";
                }}
                onBlur={(e) => {
                  e.currentTarget.style.borderColor = "#dbe5f1";
                  e.currentTarget.style.boxShadow = "none";
                }}
              />
            </EditField>
          </div>

          {/* Last date and status */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "14px" }}>
            <EditField label="Last date">
              <input
                type="date"
                value={form.lastDate || ""}
                onChange={set("lastDate")}
                style={{
                  width: "100%",
                  border: "1px solid #dbe5f1",
                  borderRadius: "9px",
                  padding: "10px 12px",
                  fontSize: "14px",
                  color: "#1e2a3a",
                  background: "#fff",
                  outline: "none",
                  transition: "all 0.15s ease",
                  fontFamily: "inherit",
                }}
                onFocus={(e) => {
                  e.currentTarget.style.borderColor = "#0b3c88";
                  e.currentTarget.style.boxShadow = "0 0 0 3px #eef2ff";
                }}
                onBlur={(e) => {
                  e.currentTarget.style.borderColor = "#dbe5f1";
                  e.currentTarget.style.boxShadow = "none";
                }}
              />
            </EditField>
            <EditField label="Status">
              <label style={{
                display: "inline-flex",
                alignItems: "center",
                gap: "10px",
                cursor: "pointer",
                userSelect: "none",
                paddingTop: "4px",
              }}>
                <input
                  type="checkbox"
                  checked={!!form.active}
                  onChange={set("active")}
                  style={{
                    position: "absolute",
                    opacity: 0,
                    pointerEvents: "none",
                  }}
                />
                <span style={{
                  width: "40px",
                  height: "22px",
                  borderRadius: "999px",
                  background: form.active ? "#0f9d58" : "#cbd2df",
                  position: "relative",
                  transition: "background 0.2s ease",
                  display: "inline-block",
                }} className="switch-track">
                  <span style={{
                    content: "''",
                    position: "absolute",
                    top: "2px",
                    left: form.active ? "20px" : "2px",
                    width: "18px",
                    height: "18px",
                    borderRadius: "50%",
                    background: "#fff",
                    boxShadow: "0 1px 2px rgba(0,0,0,0.2)",
                    transition: "transform 0.2s ease",
                  }} />
                </span>
                <span style={{ fontSize: "14px", fontWeight: 600, color: "#1e2a3a" }}>
                  {form.active ? "Active" : "Inactive"}
                </span>
              </label>
            </EditField>
          </div>

          {error && (
            <div style={{
              background: "#fde8e8",
              border: "1px solid #f5c9c9",
              color: "#d32f2f",
              borderRadius: "10px",
              padding: "12px 14px",
              fontSize: "13.5px",
              display: "flex",
              alignItems: "center",
              gap: "10px",
            }}>
              <span style={{ fontSize: "18px" }}>!</span>
              {error}
            </div>
          )}
        </div>

        {/* Drawer footer */}
        <div style={{
          display: "flex",
          justifyContent: "flex-end",
          gap: "10px",
          padding: "16px 24px",
          borderTop: "1px solid #dbe5f1",
          background: "#f9fafb",
        }}>
          <button
            onClick={onClose}
            disabled={saving}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: "8px",
              borderRadius: "10px",
              fontSize: "14px",
              fontWeight: 600,
              padding: "9px 14px",
              cursor: saving ? "not-allowed" : "pointer",
              border: "1px solid #dbe5f1",
              background: "#fff",
              color: "#1e2a3a",
              transition: "all 0.2s ease",
              opacity: saving ? 0.55 : 1,
            }}
            onMouseEnter={(e) => !saving && (e.currentTarget.style.background = "#f1f5f9")}
            onMouseLeave={(e) => !saving && (e.currentTarget.style.background = "#fff")}
          >
            Cancel
          </button>
          <button
            onClick={submit}
            disabled={saving}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: "8px",
              borderRadius: "10px",
              fontSize: "14px",
              fontWeight: 600,
              padding: "9px 14px",
              cursor: saving ? "not-allowed" : "pointer",
              border: "none",
              background: "#0b3c88",
              color: "#fff",
              transition: "all 0.2s ease",
              opacity: saving ? 0.55 : 1,
            }}
            onMouseEnter={(e) => !saving && (e.currentTarget.style.background = "#051f4a")}
            onMouseLeave={(e) => !saving && (e.currentTarget.style.background = "#0b3c88")}
          >
            {saving ? "Saving…" : "Save changes"}
          </button>
        </div>
      </aside>
    </div>
  );
}

function EditField({ label, children }) {
  return (
    <label style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
      <span style={{ fontSize: "12.5px", fontWeight: 600, color: "#6b7a90" }}>
        {label}
      </span>
      {children}
    </label>
  );
}

function TableSkeleton() {
  return (
    <div style={{ overflowX: "auto" }}>
      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "14px" }}>
        <thead>
          <tr style={{ background: "#f4f7fb" }}>
            {["ID", "Name", "Designation", "Rate card", "Joined", "Last date", "Status", ""].map(
              (h, i) => (
                <th
                  key={i}
                  style={{
                    position: "sticky",
                    top: 0,
                    background: "#f4f7fb",
                    color: "#6b7a90",
                    textAlign: "left",
                    fontSize: "11.5px",
                    fontWeight: 700,
                    letterSpacing: "0.05em",
                    textTransform: "uppercase",
                    padding: "12px 16px",
                    borderBottom: "1px solid #dbe5f1",
                    whiteSpace: "nowrap",
                  }}
                >
                  {h}
                </th>
              )
            )}
          </tr>
        </thead>
        <tbody>
          {Array.from({ length: 6 }).map((_, i) => (
            <tr key={i} style={{ borderBottom: "1px solid #eef1f6" }}>
              {Array.from({ length: 8 }).map((__, j) => (
                <td
                  key={j}
                  style={{
                    padding: "13px 16px",
                    verticalAlign: "middle",
                  }}
                >
                  <div
                    style={{
                      height: "12px",
                      width: "70%",
                      borderRadius: "6px",
                      background: "linear-gradient(90deg, #eef1f6 25%, #e3e7ef 37%, #eef1f6 63%)",
                      backgroundSize: "400% 100%",
                      animation: "skeleton-loading 1.3s ease infinite",
                    }}
                  />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      <style>{`@keyframes skeleton-loading {
        0% { background-position: 100% 0; }
        100% { background-position: -100% 0; }
      }`}</style>
    </div>
  );
}

/* ---------- inline icons ---------- */
const SearchIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <circle cx="11" cy="11" r="7" />
    <path d="m21 21-4.3-4.3" />
  </svg>
);
const RefreshIcon = ({ spinning }) => (
  <svg
    style={spinning ? { animation: "spin 1s linear infinite" } : {}}
    width="15"
    height="15"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
  >
    <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    <path d="M21 12a9 9 0 1 1-2.64-6.36" />
    <path d="M21 3v6h-6" />
  </svg>
);
const UploadIcon = () => (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <path d="M12 16V4m0 0 4 4m-4-4-4 4" />
    <path d="M4 16v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2" />
  </svg>
);
const EditIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <path d="M12 20h9" />
    <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" />
  </svg>
);