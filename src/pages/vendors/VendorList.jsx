import { useEffect, useState, useMemo } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { FaTrashAlt } from 'react-icons/fa';
import { useData } from '../../data/DataContext';
import { tokenStore } from '../../api/client';
import * as vendorsApi from '../../api/vendors';
import { normalizeText, renderMappingText, uniqueSorted } from '../../utils/helpers';
import FilterShell from '../../components/FilterShell';
import MultiSelect from '../../components/MultiSelect';
import MilestonePagination from '../../components/projects/MilestonePagination';
import { useCan } from '../../auth/permissions';

export default function VendorList() {
  const { vendors, setVendors, refresh } = useData();
  const navigate = useNavigate();
  const location = useLocation();
  const [deletingId, setDeletingId] = useState('');
  const [loading, setLoading] = useState(false);
  const canDeleteVendor = useCan('deleteVendor');

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
    const ok = window.confirm(`Delete organization "${v.vendorName}"?`);
    if (!ok) return;
    if (tokenStore.get()) {
      try {
        setDeletingId(v.vendorId);
        await vendorsApi.remove(v.vendorId);
        await refresh();
      } catch (err) {
        /* 409 = the org is still mapped to active (non-closed/completed)
           projects; the message names them. Deleting is only possible once
           those mappings are removed, so say that instead of leaving the
           user with a bare server string (#138). */
        if (err?.status === 409) {
          window.alert(
            `${err.message}\n\nUnmap this organization from the project(s) above, then delete it.`
          );
        } else {
          window.alert(err?.message || 'Failed to delete organization');
        }
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
    // Project Mapping is now a multi-select — array of project names selected
    // by the user. Empty array means "no filter".
    mapping: []
  });

  function updateFilter(key, value) {
    setFilters((f) => ({ ...f, [key]: value }));
  }

  const typeOptions = useMemo(() => uniqueSorted(vendors.map((v) => v.vendorType)), [vendors]);
  const statusOptions = useMemo(() => uniqueSorted(vendors.map((v) => v.status)), [vendors]);
  // Distinct organization names — feeds the Organization Name filter
  // dropdown so the user picks from existing names rather than free-typing.
  const vendorNameOptions = useMemo(
    () => uniqueSorted(vendors.map((v) => v.vendorName).filter(Boolean)),
    [vendors]
  );
  // Distinct project names from the loaded vendors — feeds the Project
  // Mapping multi-select. Sorted for a stable dropdown order.
  const projectOptions = useMemo(() => {
    const names = vendors.flatMap((v) =>
      Array.isArray(v.projectMapping) ? v.projectMapping : []
    );
    return uniqueSorted(names).map((n) => ({ label: n, value: n }));
  }, [vendors]);

  const filtered = vendors.filter((v) => {
    const q = normalizeText(search);
    const combined = [
      v.vendorName, v.vendorType, v.status, v.contact, v.email, v.phone, renderMappingText(v.projectMapping)
    ].join(' ').toLowerCase();
    const contains = (field, value) => !value || normalizeText(field).includes(normalizeText(value));
    const exact = (field, value) => !value || normalizeText(field) === normalizeText(value);
    // Multi-select intersection: pass when no filter is set, or when the
    // vendor has at least one of the selected project mappings.
    const hasAnyMapping = (mappings, picked) => {
      if (!Array.isArray(picked) || picked.length === 0) return true;
      const set = new Set((Array.isArray(mappings) ? mappings : []).map(normalizeText));
      return picked.some((p) => set.has(normalizeText(p)));
    };
    return (
      (!q || combined.includes(q)) &&
      exact(v.vendorName, filters.vendorName) &&
      exact(v.vendorType, filters.vendorType) &&
      exact(v.status, filters.status) &&
      contains(v.contact, filters.contact) &&
      contains(v.email, filters.email) &&
      contains(v.phone, filters.phone) &&
      hasAnyMapping(v.projectMapping, filters.mapping)
    );
  });

  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const total = filtered.length;
  const effectivePageSize = pageSize > 0 ? pageSize : Math.max(total, 1);
  const totalPages = total === 0 ? 1 : Math.ceil(total / effectivePageSize);
  const currentPage = Math.max(1, Math.min(page, totalPages));
  const pagedVendors = useMemo(() => {
    if (pageSize <= 0) return filtered;
    const start = (currentPage - 1) * pageSize;
    return filtered.slice(start, start + pageSize);
  }, [filtered, currentPage, pageSize]);

  // Filters/search changing the result set may move the active page out of
  // range — snap back to page 1 so users always see results immediately.
  useEffect(() => { setPage(1); }, [search, filters]);

  return (
    <>
      <div className="uidai-pmis-card">
        <div className="uidai-pmis-search-row">
          <input
            className="uidai-pmis-search-input"
            placeholder="Search organizations..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <button className="uidai-pmis-btn uidai-pmis-btn-small">Search</button>
        </div>

        <FilterShell>
          <div className="uidai-pmis-field">
            <label>Organization Name</label>
            <select
              className="uidai-pmis-filter-select"
              value={filters.vendorName}
              onChange={(e) => updateFilter('vendorName', e.target.value)}
            >
              <option value="">All</option>
              {vendorNameOptions.map((v) => <option key={v} value={v}>{v}</option>)}
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
            <MultiSelect
              name="vendorListMappingFilter"
              value={filters.mapping}
              options={projectOptions}
              onChange={(next) => updateFilter('mapping', next)}
              placeholder="All projects"
              searchPlaceholder="Search project..."
            />
          </div>
        </FilterShell>

        <div className="uidai-pmis-table-wrap">
          <table className="uidai-pmis-table uidai-pmis-table-compact">
            <thead>
              <tr>
                <th>Organization ID</th><th>Organization Name</th><th>Status</th>
                <th>Contact Person</th><th>Email</th><th>Phone</th><th>Project Mapping</th>
                {canDeleteVendor && <th>Action</th>}
              </tr>
            </thead>
            <tbody>
              {loading && (
                <tr className="uidai-pmis-no-results">
                  <td colSpan={canDeleteVendor ? 8 : 7} style={{ textAlign: 'center', padding: 16 }}>
                    Loading organizations...
                  </td>
                </tr>
              )}
              {!loading && pagedVendors.map((v) => (
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
                  {canDeleteVendor && (
                    <td>
                      <button
                        type="button"
                        title="Delete organization"
                        aria-label="Delete organization"
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
                  )}
                </tr>
              ))}
              {!loading && filtered.length === 0 && (
                <tr className="uidai-pmis-no-results">
                  <td colSpan={canDeleteVendor ? 8 : 7}>No matching organizations found.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {!loading && total > 0 && (
          <MilestonePagination
            total={total}
            page={currentPage}
            totalPages={totalPages}
            pageSize={pageSize}
            onGoto={(p) => setPage(Math.max(1, Math.min(p, totalPages)))}
            onSize={(s) => { setPageSize(s); setPage(1); }}
            itemLabel="organization"
          />
        )}
      </div>
    </>
  );
}
