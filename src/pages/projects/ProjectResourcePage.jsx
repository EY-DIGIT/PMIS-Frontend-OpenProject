import React, { useEffect, useRef, useState } from "react";
import { useParams } from "react-router-dom";
import { useProject } from "../../store/project/projectsStore";
import { setPageContext, clearPageContext } from "../../utils/pageContext";

const API_BASE = "http://10.1.131.199:8019"; // move to env / your api client

export default function ProjectResourcePage() {
  const { projectId } = useParams();
  const project = useProject(projectId);
  const fileInputRef = useRef(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState(null);
  const [result, setResult] = useState(null);

  useEffect(() => {
    setPageContext({ projectName: project?.projectName || "" });
    return () => clearPageContext();
  }, [project?.projectName]);

  async function uploadFile(file) {
    if (!file || !projectId) return;
    setUploading(true);
    setError(null);
    setResult(null);

    const formData = new FormData();
    formData.append("file", file);

    try {
      const res = await fetch(
        `${API_BASE}/api/resources/upload?projectId=${encodeURIComponent(projectId)}`,
        {
          method: "POST",
          headers: { accept: "*/*" },
          // NOTE: do NOT set Content-Type — the browser adds the multipart
          // boundary automatically when the body is a FormData.
          body: formData,
        }
      );

      if (!res.ok) throw new Error(`Upload failed (${res.status})`);

      const text = await res.text();
      let data = { ok: true };
      try {
        data = text ? JSON.parse(text) : { ok: true };
      } catch {
        data = { raw: text };
      }
      setResult(data);
    } catch (err) {
      setError(err.message || "Upload failed");
    } finally {
      setUploading(false);
    }
  }

  function handleChange(e) {
    const file = e.target.files?.[0];
    uploadFile(file);
    e.target.value = ""; // let the same file be re-selected
  }

  return (
    <div style={{ minHeight: 220, padding: 24 }}>
      <input
        ref={fileInputRef}
        type="file"
        accept=".xlsx,.xls,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
        onChange={handleChange}
        style={{ display: "none" }}
      />
      <button
        type="button"
        onClick={() => fileInputRef.current?.click()}
        disabled={uploading || !projectId}
      >
        {uploading ? "Uploading…" : "Upload resource"}
      </button>

      {error && <p style={{ color: "crimson" }}>{error}</p>}
      {result && <p style={{ color: "green" }}>Uploaded ✓</p>}
    </div>
  );
}