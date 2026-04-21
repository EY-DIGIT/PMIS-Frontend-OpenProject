import React, { useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useStore, setOnboardDraft } from '../../components/projects/store';
import { formatDateDisplay } from '../../components/projects/utils';

export default function SearchProject() {
  const { projects } = useStore();
  const navigate = useNavigate();
  const [liveQuery, setLiveQuery] = useState('');
  const [query, setQuery] = useState('');

  const rows = useMemo(() => {
    const q = (query || '').trim().toLowerCase();
    return projects.filter((p) => {
      if (!q) return true;
      return [p.projectId, p.projectName, p.description, p.baselineId,
              p.status, p.owner, p.category, p.actualEndDate]
        .some((v) => String(v ?? '').toLowerCase().includes(q));
    });
  }, [projects, query]);

  const doSearch = () => setQuery(liveQuery);

  const goAdd = () => {
    setOnboardDraft(null);
    navigate('/project/new');
  };

  return (
    <div className="pmis-page">
      <div className="pmis-page-title">Project Management</div>

      <div className="pmis-card">
        <div className="pmis-card-actions">
          <button className="pmis-btn" onClick={goAdd}>➕ Add Project</button>
        </div>

        <div className="pmis-search-grid">
          <div className="pmis-field">
            <label>Search project</label>
            <input
              placeholder="Search project..."
              value={liveQuery}
              onChange={(e) => setLiveQuery(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') doSearch(); }}
            />
          </div>
          <div>
            <button className="pmis-btn" onClick={doSearch}>Search</button>
          </div>
        </div>

        <div className="pmis-table-wrap">
          <table className="pmis-table">
            <thead>
              <tr>
                <th>Project ID</th>
                <th>Name</th>
                <th>Description</th>
                <th>Baseline ID</th>
                <th>Status</th>
                <th>Start Date</th>
                <th>End Date</th>
                <th>Actual End Date</th>
                <th>Is Public</th>
                <th>Owner</th>
                <th>Category</th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 ? (
                <tr>
                  <td colSpan={11} className="pmis-table-empty">No matching projects found.</td>
                </tr>
              ) : (
                rows.map((p) => (
                  <tr key={p.projectId}>
                    <td className="pmis-link"
                      onClick={() => navigate(`/project/${encodeURIComponent(p.projectId)}`)}
                    >{p.projectId}</td>
                    <td>{p.projectName}</td>
                    <td>{p.description || ''}</td>
                    <td>{p.baselineId || '-'}</td>
                    <td>{p.status}</td>
                    <td>{formatDateDisplay(p.startDate)}</td>
                    <td>{formatDateDisplay(p.endDate)}</td>
                    <td>{p.isVersion ? formatDateDisplay(p.actualEndDate || '-') : '-'}</td>
                    <td>{p.isPublic}</td>
                    <td>{p.owner}</td>
                    <td>{p.category || ''}</td>
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
