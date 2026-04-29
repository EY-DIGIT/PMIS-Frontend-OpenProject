import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useData } from '../../data/DataContext';
import MultiSelect from '../../components/MultiSelect';
import { USER_ROLES, DIVISION_OPTIONS, PROJECT_OPTIONS } from '../../data/demoData';
import * as usersApi from '../../api/users';
import { API_BASE, authorizedFetch, tokenStore } from '../../api/client';
import { ENDPOINTS } from '../../api/endpoint';

export default function UserForm() {
  const { vendors, refresh, setUsers, users } = useData();
  const navigate = useNavigate();

  const [fullName, setFullName] = useState('');
  const [employeeId, setEmployeeId] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [role, setRole] = useState(USER_ROLES[0]);
  const [vendorId, setVendorId] = useState('');
  const [division, setDivision] = useState('');
  const [divisionOther, setDivisionOther] = useState('');
  const [mapping, setMapping] = useState([]);
  const [projectList, setProjectList] = useState([]);
  const [divisionList, setDivisionList] = useState([]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!tokenStore.get()) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await authorizedFetch(
          `${API_BASE}${ENDPOINTS.projects.list}?offset=1&pageSize=100`,
          { method: 'GET', headers: { accept: 'application/json' } }
        );
        if (!res.ok) return;
        const raw = await res.json().catch(() => ({}));
        const elements =
          raw?.data?._embedded?.elements ??
          raw?._embedded?.elements ??
          raw?.data ??
          [];
        if (!cancelled && Array.isArray(elements)) setProjectList(elements);
      } catch {
        if (!cancelled) setProjectList([]);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (!tokenStore.get()) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await authorizedFetch(
          `${API_BASE}${ENDPOINTS.divisions.list}`,
          { method: 'GET', headers: { accept: 'application/json' } }
        );
        if (!res.ok) return;
        const raw = await res.json().catch(() => ({}));
        const elements =
          raw?.data?._embedded?.elements ??
          raw?._embedded?.elements ??
          raw?.data ??
          [];
        const divisions = (Array.isArray(elements) ? elements : [])
          .filter((d) => d?.code && d?.label)
          .map((d) => ({ code: d.code, label: d.label, requiresOther: !!d.requiresOther }));
        if (!cancelled) setDivisionList(divisions);
      } catch {
        if (!cancelled) setDivisionList([]);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const projectOptions = useMemo(() => {
    if (!tokenStore.get()) return PROJECT_OPTIONS;
    return projectList.map((p) => ({
      label: p.name || p.projectCode || p.id,
      value: p.id || p.uuid,
    }));
  }, [projectList]);

  const divisionOptions = useMemo(() => {
    if (!tokenStore.get() || divisionList.length === 0) {
      return DIVISION_OPTIONS.map((d) => ({ code: d, label: d, requiresOther: false }));
    }
    return divisionList;
  }, [divisionList]);

  const selectedDivision = divisionOptions.find((d) => d.code === division);
  const divisionRequiresOther =
    !!selectedDivision &&
    (selectedDivision.requiresOther ||
      String(selectedDivision.label || '').toLowerCase() === 'others' ||
      String(selectedDivision.code || '').toLowerCase() === 'others');

  const selectedVendor = vendors.find((v) => v.vendorId === vendorId);

  const validate = () => {
    if (!fullName.trim()) return 'Full Name is required';
    if (!employeeId.trim()) return 'Employee ID is required';
    if (!email.trim()) return 'Email is required';
    if (!password) return 'Temporary Password is required';
    if (!vendorId) return 'Please select an associated vendor';
    if (divisionRequiresOther && !divisionOther.trim()) return 'Please specify the division';
    return '';
  };

  const splitName = (n) => {
    const parts = n.trim().split(/\s+/);
    return { firstName: parts[0] || '', lastName: parts.slice(1).join(' ') };
  };

  const handleAdd = async () => {
    const msg = validate();
    if (msg) { setError(msg); return; }
    setError('');
    setSubmitting(true);
    try {
      if (tokenStore.get()) {
        const { firstName, lastName } = splitName(fullName);
        await usersApi.create({
          login: employeeId.trim(),
          email: email.trim(),
          password,
          firstName,
          lastName,
          admin: role === 'Admin',
          vendor_id: vendorId,
          division,
          division_other: divisionRequiresOther ? divisionOther.trim() : '',
          project_ids: Array.isArray(mapping) ? mapping : [],
        });
        await refresh();
      } else {
        setUsers([
          ...users,
          {
            userId: `USR${String(users.length + 1).padStart(3, '0')}`,
            fullName: fullName.trim(),
            employeeId: employeeId.trim(),
            email: email.trim(),
            role,
            vendorName: selectedVendor?.vendorName || '',
            division,
            projectMapping: mapping,
            status: 'Active',
          },
        ]);
      }
      navigate('/users');
    } catch (err) {
      setError(err?.message || 'Failed to add user');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <>
      <div className="uidai-pmis-card">
        <h3>Add User</h3>
        <br />
        <div className="uidai-pmis-grid-4">
          <div className="uidai-pmis-field">
            <label>Full Name <span className="uidai-pmis-required">*</span></label>
            <input value={fullName} onChange={(e) => setFullName(e.target.value)} />
          </div>
          <div className="uidai-pmis-field">
            <label>Employee ID <span className="uidai-pmis-required">*</span></label>
            <input value={employeeId} onChange={(e) => setEmployeeId(e.target.value)} />
          </div>
          <div className="uidai-pmis-field">
            <label>Email <span className="uidai-pmis-required">*</span></label>
            <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
          </div>
          <div className="uidai-pmis-field">
            <label>Temporary Password <span className="uidai-pmis-required">*</span></label>
            <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} />
          </div>
          <div className="uidai-pmis-field">
            <label>Role <span className="uidai-pmis-required">*</span></label>
            <select value={role} onChange={(e) => setRole(e.target.value)}>
              {USER_ROLES.map((r) => <option key={r}>{r}</option>)}
            </select>
          </div>
          <div className="uidai-pmis-field">
            <label>Associated Vendor Name <span className="uidai-pmis-required">*</span></label>
            <select value={vendorId} onChange={(e) => setVendorId(e.target.value)}>
              <option value="" disabled>Select Vendor</option>
              {vendors.map((v) => (
                <option key={v.vendorId} value={v.vendorId}>{v.vendorName}</option>
              ))}
            </select>
          </div>
          <div className="uidai-pmis-field">
            <label>Division <span className="uidai-pmis-required">*</span></label>
            <select
              value={division}
              onChange={(e) => {
                const next = e.target.value;
                setDivision(next);
                const nextDiv = divisionOptions.find((d) => d.code === next);
                const stillNeedsOther =
                  !!nextDiv &&
                  (nextDiv.requiresOther ||
                    String(nextDiv.label || '').toLowerCase() === 'others' ||
                    String(nextDiv.code || '').toLowerCase() === 'others');
                if (!stillNeedsOther) setDivisionOther('');
              }}
            >
              <option value="" disabled>Select Division</option>
              {divisionOptions.map((d) => (
                <option key={d.code} value={d.code}>{d.label}</option>
              ))}
            </select>
          </div>
          {divisionRequiresOther && (
            <div className="uidai-pmis-field">
              <label>Specify Division <span className="uidai-pmis-required">*</span></label>
              <input value={divisionOther} onChange={(e) => setDivisionOther(e.target.value)} />
            </div>
          )}
          <div className="uidai-pmis-field">
            <label>Project Mapping <span className="uidai-pmis-required">*</span></label>
            <MultiSelect
              name="userProjectMapping"
              value={mapping}
              options={projectOptions}
              onChange={setMapping}
            />
          </div>
        </div>
        {error && <div className="uidai-error-msg" style={{ marginTop: 8 }}>{error}</div>}
        <div className="uidai-pmis-action-row">
          <button className="uidai-pmis-btn" onClick={handleAdd} disabled={submitting}>
            {submitting ? 'Adding…' : 'Add'}
          </button>
          <button className="uidai-pmis-btn uidai-pmis-btn-cancel" onClick={() => navigate('/users')}>Cancel</button>
        </div>
      </div>
    </>
  );
}
