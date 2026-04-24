import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useData } from '../../data/DataContext';
import MultiSelect from '../../components/MultiSelect';
import { USER_ROLES, DIVISION_OPTIONS, PROJECT_OPTIONS } from '../../data/demoData';
import * as usersApi from '../../api/users';
import { tokenStore } from '../../api/client';

export default function UserForm() {
  const { vendors, refresh, setUsers, users } = useData();
  const navigate = useNavigate();

  const [fullName, setFullName] = useState('');
  const [employeeId, setEmployeeId] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [role, setRole] = useState(USER_ROLES[0]);
  const [vendorName, setVendorName] = useState('');
  const [division, setDivision] = useState(DIVISION_OPTIONS[0]);
  const [mapping, setMapping] = useState([]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  const validate = () => {
    if (!fullName.trim()) return 'Full Name is required';
    if (!employeeId.trim()) return 'Employee ID is required';
    if (!email.trim()) return 'Email is required';
    if (!password) return 'Temporary Password is required';
    if (!vendorName) return 'Please select an associated vendor';
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
            vendorName,
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
            <select value={vendorName} onChange={(e) => setVendorName(e.target.value)}>
              <option value="" disabled>Select Vendor</option>
              {vendors.map((v) => (
                <option key={v.vendorId}>{v.vendorName}</option>
              ))}
            </select>
          </div>
          <div className="uidai-pmis-field">
            <label>Division <span className="uidai-pmis-required">*</span></label>
            <select value={division} onChange={(e) => setDivision(e.target.value)}>
              {DIVISION_OPTIONS.map((d) => <option key={d}>{d}</option>)}
            </select>
          </div>
          <div className="uidai-pmis-field">
            <label>Project Mapping <span className="uidai-pmis-required">*</span></label>
            <MultiSelect
              name="userProjectMapping"
              value={mapping}
              options={PROJECT_OPTIONS}
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
