import { useEffect, useState, useMemo } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { FaTrashAlt } from 'react-icons/fa';
import { useData } from '../../data/DataContext';
import { tokenStore } from '../../api/client';
import * as vendorsApi from '../../api/vendors';
import { normalizeText, renderMappingText, uniqueSorted } from '../../utils/helpers';
import FilterShell from '../../components/FilterShell';

export default function VendorList() {
  const { vendors, setVendors, refresh } = useData();
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
        const list = await vendorsApi.list();
        if (!cancelled) setVendors(Array.isArray(list) ? list : []);
      } catch (err) {
        // eslint-disable-next-line no-console
        console.error('[VendorList] Failed to load vendors', err);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.pathname, location.key]);

  async function handleDelete(v) {
    const ok = window.confirm(`Delete vendor "${v.vendorName}"?`);
    if (!ok) return;
    if (tokenStore.get()) {
      try {
        setDeletingId(v.vendorId);
        await vendorsApi.remove(v.vendorId);
        await refresh();
      } catch (err) {
        window.alert(err?.message || 'Failed to delete vendor');
      } finally {
        setDeletingId('');
      }
    } else {
      setVendors(vendors.filter((x) => x.vendorId !== v.vendorId));
    }
  }

  const [search, setSearch] = useState('');
  const [filters, setFilters] = useState({
    vendorName: '',
    vendorType: '',
    status: '',
    contact: '',
    email: '',
    phone: '',
    mapping: ''
  });

  function updateFilter(key, value) {
    setFilters((f) => ({ ...f, [key]: value }));
  }

  const typeOptions = useMemo(() => uniqueSorted(vendors.map((v) => v.vendorType)), [vendors]);
  const statusOptions = useMemo(() => uniqueSorted(vendors.map((v) => v.status)), [vendors]);

  const filtered = vendors.filter((v) => {
    const q = normalizeText(search);
    const combined = [
      v.vendorName, v.vendorType, v.status, v.contact, v.email, v.phone, renderMappingText(v.projectMapping)
    ].join(' ').toLowerCase();
    const contains = (field, value) => !value || normalizeText(field).includes(normalizeText(value));
    const exact = (field, value) => !value || normalizeText(field) === normalizeText(value);
    return (
      (!q || combined.includes(q)) &&
      contains(v.vendorName, filters.vendorName) &&
      exact(v.vendorType, filters.vendorType) &&
      exact(v.status, filters.status) &&
      contains(v.contact, filters.contact) &&
      contains(v.email, filters.email) &&
      contains(v.phone, filters.phone) &&
      contains(renderMappingText(v.projectMapping), filters.mapping)
    );
  });

  return (
    <>
      <div className="uidai-pmis-card">
        <div className="uidai-pmis-search-row">
          <input
            className="uidai-pmis-search-input"
            placeholder="Search vendors..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <button className="uidai-pmis-btn uidai-pmis-btn-small">Search</button>
        </div>

        <FilterShell>
          <div className="uidai-pmis-field">
            <label>Vendor Name</label>
            <input
              className="uidai-pmis-filter-input"
              type="text"
              placeholder="Search vendor name"
              value={filters.vendorName}
              onChange={(e) => updateFilter('vendorName', e.target.value)}
            />
          </div>
          <div className="uidai-pmis-field">
            <label>Type</label>
            <select
              className="uidai-pmis-filter-select"
              value={filters.vendorType}
              onChange={(e) => updateFilter('vendorType', e.target.value)}
            >
              <option value="">All</option>
              {typeOptions.map((t) => (
                <option key={t} value={t}>{t}</option>
              ))}
            </select>
          </div>
          <div className="uidai-pmis-field">
            <label>Status</label>
            <select
              className="uidai-pmis-filter-select"
              value={filters.status}
              onChange={(e) => updateFilter('status', e.target.value)}
            >
              <option value="">All</option>
              {statusOptions.map((s) => (
                <option key={s} value={s}>{s}</option>
              ))}
            </select>
          </div>
          <div className="uidai-pmis-field">
            <label>Contact Person</label>
            <input
              className="uidai-pmis-filter-input"
              type="text"
              placeholder="Search contact person"
              value={filters.contact}
              onChange={(e) => updateFilter('contact', e.target.value)}
            />
          </div>
          <div className="uidai-pmis-field">
            <label>Email</label>
            <input
              className="uidai-pmis-filter-input"
              type="text"
              placeholder="Search email"
              value={filters.email}
              onChange={(e) => updateFilter('email', e.target.value)}
            />
          </div>
          <div className="uidai-pmis-field">
            <label>Phone</label>
            <input
              className="uidai-pmis-filter-input"
              type="text"
              placeholder="Search phone"
              value={filters.phone}
              onChange={(e) => updateFilter('phone', e.target.value)}
            />
          </div>
          <div className="uidai-pmis-field uidai-pmis-full">
            <label>Project Mapping</label>
            <input
              className="uidai-pmis-filter-input"
              type="text"
              placeholder="Search project mapping"
              value={filters.mapping}
              onChange={(e) => updateFilter('mapping', e.target.value)}
            />
          </div>
        </FilterShell>

        <div className="uidai-pmis-table-wrap">
          <table className="uidai-pmis-table uidai-pmis-table-compact">
            <thead>
              <tr>
                <th>Vendor ID</th><th>Vendor Name</th><th>Status</th>
                <th>Contact Person</th><th>Email</th><th>Phone</th><th>Project Mapping</th><th>Action</th>
              </tr>
            </thead>
            <tbody>
              {loading && (
                <tr className="uidai-pmis-no-results">
                  <td colSpan={8} style={{ textAlign: 'center', padding: 16 }}>
                    Loading vendors...
                  </td>
                </tr>
              )}
              {!loading && filtered.map((v) => (
                <tr key={v.vendorId}>
                  <td className="uidai-pmis-link" onClick={() => navigate(`/vendors/${v.vendorId}`)}>
                    {v.vendorCode || v.vendorId}
                  </td>
                  <td>
                    <div className="uidai-clamp-2" title={v.vendorName}>
                      {v.vendorName}
                    </div>
                  </td>
                  <td>
                    <span className={`uidai-pmis-badge ${v.status === 'Active' ? 'uidai-pmis-badge-green' : 'uidai-pmis-badge-red'}`}>
                      {v.status}
                    </span>
                  </td>
                  <td>{v.contact}</td>
                  <td>{v.email}</td>
                  <td>{v.phone}</td>
                  <td>{renderMappingText(v.projectMapping)}</td>
                  <td>
                    <button
                      type="button"
                      title="Delete vendor"
                      aria-label="Delete vendor"
                      disabled={deletingId === v.vendorId}
                      onClick={() => handleDelete(v)}
                      style={{
                        border: '1px solid #d32f2f',
                        background: '#fff',
                        color: '#d32f2f',
                        borderRadius: 4,
                        padding: '4px 8px',
                        cursor: deletingId === v.vendorId ? 'not-allowed' : 'pointer',
                        opacity: deletingId === v.vendorId ? 0.6 : 1,
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
                  <td colSpan={8}>No matching vendors found.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}
