import { useEffect, useState, useMemo } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { FaTrashAlt } from 'react-icons/fa';
import { useData } from '../../data/DataContext';
import { tokenStore } from '../../api/client';
import * as usersApi from '../../api/users';
import { normalizeText, renderMappingText, uniqueSorted } from '../../utils/helpers';
import { DIVISION_OPTIONS } from '../../data/demoData';
import FilterShell from '../../components/FilterShell';

export default function UserList() {
  const { users, setUsers, refresh } = useData();
  const navigate = useNavigate();
  const location = useLocation();
  const [deletingId, setDeletingId] = useState('');
  const [loading, setLoading] = useState(false);

  // Directly hit the list endpoint on every mount/navigation. No token guard
  // here — if the token is missing, the request still fires (and surfaces as
  // 401 in the Network tab), which is far better for debugging than the
  // shared refresh()'s silent early-return.
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    (async () => {
      try {
        const list = await usersApi.list();
        if (!cancelled) setUsers(Array.isArray(list) ? list : []);
      } catch (err) {
        // eslint-disable-next-line no-console
        console.error('[UserList] Failed to load users', err);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.pathname, location.key]);

  async function handleDelete(u) {
    const ok = window.confirm(`Delete user "${u.fullName || u.email}"?`);
    if (!ok) return;
    if (tokenStore.get()) {
      try {
        setDeletingId(u.userId);
        await usersApi.remove(u.userId);
        await refresh();
      } catch (err) {
        window.alert(err?.message || 'Failed to delete user');
      } finally {
        setDeletingId('');
      }
    } else {
      setUsers(users.filter((x) => x.userId !== u.userId));
    }
  }

  const [search, setSearch] = useState('');
  const [filters, setFilters] = useState({
    fullName: '', email: '', role: '', vendorName: '',
    division: '', mapping: '', status: ''
  });

  function updateFilter(key, value) {
    setFilters((f) => ({ ...f, [key]: value }));
  }

  const roleOptions = useMemo(() => uniqueSorted(users.map((u) => u.role)), [users]);
  const statusOptions = useMemo(() => uniqueSorted(users.map((u) => u.status)), [users]);

  const filtered = users.filter((u) => {
    const q = normalizeText(search);
    const combined = [
      u.fullName, u.employeeId, u.email, u.role, u.vendorName,
      u.division, renderMappingText(u.projectMapping), u.status
    ].join(' ').toLowerCase();
    const contains = (field, val) => !val || normalizeText(field).includes(normalizeText(val));
    const exact = (field, val) => !val || normalizeText(field) === normalizeText(val);
    return (
      (!q || combined.includes(q)) &&
      contains(u.fullName, filters.fullName) &&
      contains(u.email, filters.email) &&
      exact(u.role, filters.role) &&
      contains(u.vendorName, filters.vendorName) &&
      exact(u.division, filters.division) &&
      contains(renderMappingText(u.projectMapping), filters.mapping) &&
      exact(u.status, filters.status)
    );
  });

  return (
    <>
      <div className="uidai-pmis-card">
        <div className="uidai-pmis-search-row">
          <input
            className="uidai-pmis-search-input"
            placeholder="Search users..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <button className="uidai-pmis-btn uidai-pmis-btn-small">Search</button>
        </div>

        <FilterShell>
          <div className="uidai-pmis-field">
            <label>Full Name</label>
            <input
              className="uidai-pmis-filter-input"
              placeholder="Search full name"
              value={filters.fullName}
              onChange={(e) => updateFilter('fullName', e.target.value)}
            />
          </div>
          <div className="uidai-pmis-field">
            <label>Email</label>
            <input
              className="uidai-pmis-filter-input"
              placeholder="Search email"
              value={filters.email}
              onChange={(e) => updateFilter('email', e.target.value)}
            />
          </div>
          <div className="uidai-pmis-field">
            <label>Role</label>
            <select
              className="uidai-pmis-filter-select"
              value={filters.role}
              onChange={(e) => updateFilter('role', e.target.value)}
            >
              <option value="">All</option>
              {roleOptions.map((r) => <option key={r} value={r}>{r}</option>)}
            </select>
          </div>
          <div className="uidai-pmis-field">
            <label>Associated Vendor</label>
            <input
              className="uidai-pmis-filter-input"
              placeholder="Search associated vendor"
              value={filters.vendorName}
              onChange={(e) => updateFilter('vendorName', e.target.value)}
            />
          </div>
          <div className="uidai-pmis-field">
            <label>Division</label>
            <select
              className="uidai-pmis-filter-select"
              value={filters.division}
              onChange={(e) => updateFilter('division', e.target.value)}
            >
              <option value="">All</option>
              {DIVISION_OPTIONS.map((d) => <option key={d} value={d}>{d}</option>)}
            </select>
          </div>
          <div className="uidai-pmis-field">
            <label>Project Mapping</label>
            <input
              className="uidai-pmis-filter-input"
              placeholder="Search project mapping"
              value={filters.mapping}
              onChange={(e) => updateFilter('mapping', e.target.value)}
            />
          </div>
          <div className="uidai-pmis-field">
            <label>Status</label>
            <select
              className="uidai-pmis-filter-select"
              value={filters.status}
              onChange={(e) => updateFilter('status', e.target.value)}
            >
              <option value="">All</option>
              {statusOptions.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>
        </FilterShell>

        <div className="uidai-pmis-table-wrap">
          <table className="uidai-pmis-table uidai-pmis-table-compact">
            <thead>
              <tr>
                <th>User ID</th><th>Full Name</th><th>Employee ID</th><th>Email</th>
                <th>Role</th><th>Associated Vendor</th><th>Division</th>
                <th>Project Mapping</th><th>Status</th><th>Action</th>
              </tr>
            </thead>
            <tbody>
              {loading && (
                <tr className="uidai-pmis-no-results">
                  <td colSpan={10} style={{ textAlign: 'center', padding: 16 }}>
                    Loading users...
                  </td>
                </tr>
              )}
              {!loading && filtered.map((u) => (
                <tr key={u.userId}>
                  <td className="uidai-pmis-link" onClick={() => navigate(`/users/${u.userId}`)}>
                    {u.userId}
                  </td>
                  <td>
                    <div className="uidai-clamp-2" title={u.fullName}>
                      {u.fullName}
                    </div>
                  </td>
                  <td>{u.employeeId}</td>
                  <td>{u.email}</td>
                  <td>{u.role}</td>
                  <td>{u.vendorName}</td>
                  <td>{u.division}</td>
                  <td>{renderMappingText(u.projectMapping)}</td>
                  <td>
                    <span className={`uidai-pmis-badge ${u.status === 'Active' ? 'uidai-pmis-badge-green' : 'uidai-pmis-badge-red'}`}>
                      {u.status}
                    </span>
                  </td>
                  <td>
                    <button
                      type="button"
                      title="Delete user"
                      aria-label="Delete user"
                      disabled={deletingId === u.userId}
                      onClick={() => handleDelete(u)}
                      style={{
                        border: '1px solid #d32f2f',
                        background: '#fff',
                        color: '#d32f2f',
                        borderRadius: 4,
                        padding: '4px 8px',
                        cursor: deletingId === u.userId ? 'not-allowed' : 'pointer',
                        opacity: deletingId === u.userId ? 0.6 : 1,
                        display: 'inline-flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                      }}
                    >
                      <FaTrashAlt />
                    </button>
                  </td>
                </tr>
              ))}
              {!loading && filtered.length === 0 && (
                <tr className="uidai-pmis-no-results">
                  <td colSpan={10}>No matching users found.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}
