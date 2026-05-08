import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { FaTrashAlt } from 'react-icons/fa';
import { tokenStore } from '../../api/client';
import * as divisionsApi from '../../api/divisions';
import { normalizeText } from '../../utils/helpers';
import MilestonePagination from '../../components/projects/MilestonePagination';
import { useCan } from '../../auth/permissions';

export default function MasterDivisions() {
  const navigate = useNavigate();
  const location = useLocation();
  const canCreateDivision = useCan('createDivision');
  const canDeleteDivision = useCan('deleteDivision');
  const [divisions, setDivisions] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [deletingCode, setDeletingCode] = useState('');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);

  async function loadList() {
    setLoading(true);
    setError('');
    try {
      const list = await divisionsApi.list();
      setDivisions(Array.isArray(list) ? list : []);
    } catch (err) {
      setError(err?.message || 'Failed to load divisions');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (tokenStore.get()) loadList();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.pathname, location.key]);

  async function handleDelete(d) {
    if (d.isBuiltin) return;
    const ok = window.confirm(
      `Delete division "${d.label}" (code: ${d.code})?\nThis is a soft delete; the division can be restored later.`
    );
    if (!ok) return;
    try {
      setDeletingCode(d.code);
      await divisionsApi.remove(d.code);
      await loadList();
    } catch (err) {
      window.alert(err?.message || 'Failed to delete division');
    } finally {
      setDeletingCode('');
    }
  }

  const filtered = useMemo(() => {
    const q = normalizeText(search);
    if (!q) return divisions;
    return divisions.filter((d) =>
      [d.code, d.label, d.email, d.phoneNumber]
        .map((s) => normalizeText(s))
        .some((s) => s.includes(q))
    );
  }, [divisions, search]);

  const total = filtered.length;
  const effectivePageSize = pageSize > 0 ? pageSize : Math.max(total, 1);
  const totalPages = total === 0 ? 1 : Math.ceil(total / effectivePageSize);
  const currentPage = Math.max(1, Math.min(page, totalPages));
  const paged = useMemo(() => {
    if (pageSize <= 0) return filtered;
    const start = (currentPage - 1) * pageSize;
    return filtered.slice(start, start + pageSize);
  }, [filtered, currentPage, pageSize]);

  useEffect(() => { setPage(1); }, [search]);

  return (
    <>
      <div className="uidai-pmis-card">
        <div className="uidai-pmis-search-row">
          <input
            className="uidai-pmis-search-input"
            placeholder="Search divisions..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <button className="uidai-pmis-btn uidai-pmis-btn-small">Search</button>
          {canCreateDivision && (
            <div style={{ marginLeft: 'auto' }}>
              <button
                type="button"
                className="uidai-pmis-btn"
                onClick={() => navigate('/master/divisions/new')}
              >
                + Add Division
              </button>
            </div>
          )}
        </div>

        {error && (
          <div style={{ color: '#b91c1c', fontSize: 13, padding: '8px 0' }}>{error}</div>
        )}

        <div className="uidai-pmis-table-wrap">
          <table className="uidai-pmis-table uidai-pmis-table-compact">
            <thead>
              <tr>
                <th>Code</th>
                <th>Label</th>
                <th>Requires Other</th>
                <th>Email</th>
                <th>Phone</th>
                <th>Status</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              {loading && (
                <tr className="uidai-pmis-no-results">
                  <td colSpan={7} style={{ textAlign: 'center', padding: 16 }}>
                    Loading divisions...
                  </td>
                </tr>
              )}
              {!loading && paged.length === 0 && (
                <tr className="uidai-pmis-no-results">
                  <td colSpan={7} style={{ textAlign: 'center', padding: 16 }}>
                    No divisions found.
                  </td>
                </tr>
              )}
              {!loading && paged.map((d) => (
                <tr key={d.code}>
                  <td
                    className="uidai-pmis-link"
                    onClick={() => navigate(`/master/divisions/${encodeURIComponent(d.code)}`)}
                    title={d.isBuiltin ? 'Built-in division (limited edits)' : 'Open division'}
                  >
                    {d.code}{d.isBuiltin && (
                      <span style={{ marginLeft: 6, fontSize: 10, color: '#0aa1c0' }} title="Built-in">🔒</span>
                    )}
                  </td>
                  <td>{d.label}</td>
                  <td>{d.requiresOther ? 'Yes' : 'No'}</td>
                  <td>{d.email || '—'}</td>
                  <td>{d.phoneNumber || '—'}</td>
                  <td>
                    <span className={`uidai-pmis-badge ${d.active ? 'uidai-pmis-badge-green' : 'uidai-pmis-badge-red'}`}>
                      {d.active ? 'Active' : 'Inactive'}
                    </span>
                  </td>
                  <td>
                    {canDeleteDivision ? (
                      <button
                        type="button"
                        title={d.isBuiltin ? 'Built-in divisions cannot be deleted' : 'Delete division'}
                        aria-label="Delete division"
                        disabled={d.isBuiltin || deletingCode === d.code}
                        onClick={() => handleDelete(d)}
                        style={{
                          border: '1px solid #d32f2f',
                          background: '#fff',
                          color: '#d32f2f',
                          borderRadius: 4,
                          padding: '4px 8px',
                          cursor: d.isBuiltin || deletingCode === d.code ? 'not-allowed' : 'pointer',
                          opacity: d.isBuiltin || deletingCode === d.code ? 0.45 : 1,
                          display: 'inline-flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                        }}
                      >
                        <FaTrashAlt aria-hidden="true" />
                      </button>
                    ) : (
                      <span style={{ color: '#aaa', fontSize: 12 }}>—</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {!loading && total > 0 && (
          <MilestonePagination
            total={total}
            page={currentPage}
            totalPages={totalPages}
            pageSize={pageSize}
            onGoto={setPage}
            onSize={(s) => { setPageSize(s); setPage(1); }}
            itemLabel="division"
          />
        )}
      </div>
    </>
  );
}
