import { useState, useEffect, useRef, useCallback } from "react";
import Btn from "./Btn";
import Field from "./Field";
const fmtDate = (d) => { if (!d || d === "-") return "-"; const p = String(d).split("-"); return p.length === 3 ? `${p[2]}-${p[1]}-${p[0]}` : d; };
const fmtDT = (iso) => { if (!iso) return "-"; const d = new Date(iso); return isNaN(d.getTime()) ? iso : d.toLocaleString("en-GB"); };
export default function ProjectTable({ projects, onOpen, onOpenConfig, query, setQuery }) {
  const q = query.trim().toLowerCase();
  const rows = projects.filter(p => {
    if (!q) return true;
    return [p.projectId, p.projectName, p.description, p.baselineId, p.status, p.category, p.actualEndDate].some(v => String(v ?? "").toLowerCase().includes(q));
  });
  return (
    <div>
      <div className="pm-title">Project Management</div>
      <div className="card">
        <div className="grid" style={{ gridTemplateColumns: "minmax(0,1fr) auto", gap: 12, alignItems: "end" }}>
          <Field label="Search project">
            <input placeholder="Search project…" value={query} onChange={e => setQuery(e.target.value)} onKeyDown={e => e.key === "Enter" && setQuery(query)} />
          </Field>
          <div><Btn onClick={() => setQuery(query)}>Search</Btn></div>
        </div>
        <div className="table-wrap">
          <table className="table">
            <thead><tr><th>Project ID</th><th>Name</th><th>Category</th><th>Baseline ID</th><th>Status</th><th>Start Date</th><th>End Date</th><th>Actual End Date</th></tr></thead>
            <tbody>
              {rows.length === 0 ? <tr><td colSpan={8} style={{ textAlign: "center", padding: 16 }}>No matching projects found.</td></tr> :
                rows.map(p => (
                  <tr key={p.projectId}>
                    <td className="link" onClick={() => onOpen(p.projectId)}>{p.projectId}</td>
                    <td>{p.projectName}</td>
                    <td>{p.category}</td>
                    <td>{p.baselineId || "-"}</td>
                    <td>{p.status}</td>
                    <td>{fmtDate(p.startDate)}</td>
                    <td>{fmtDate(p.endDate)}</td>
                    <td>{p.isVersion ? fmtDate(p.actualEndDate || "-") : "-"}</td>
                  </tr>
                ))
              }
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}