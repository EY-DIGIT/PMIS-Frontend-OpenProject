import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { FaEye, FaEyeSlash } from 'react-icons/fa';
import { useData } from '../../data/DataContext';
import MultiSelect from '../../components/MultiSelect';
import AssignRoleField from '../../components/AssignRoleField';
import { DIVISION_OPTIONS, PROJECT_OPTIONS } from '../../data/demoData';
import * as usersApi from '../../api/users';
import { API_BASE, authorizedFetch, tokenStore } from '../../api/client';
import { ENDPOINTS } from '../../api/endpoint';
import { uiStore } from '../../store/project/uiStore';

export default function UserForm() {
  const { vendors, refresh, setUsers, users } = useData();
  const navigate = useNavigate();

  const [fullName, setFullName] = useState('');
  const [employeeId, setEmployeeId] = useState('');
  const [email, setEmail] = useState('');
  const [mobile, setMobile] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [vendorId, setVendorId] = useState('');
  const [division, setDivision] = useState('');
  const [divisionOther, setDivisionOther] = useState('');
  const [mapping, setMapping] = useState([]);
  const [permissions, setPermissions] = useState([]);
  const [projectList, setProjectList] = useState([]);
  const [divisionList, setDivisionList] = useState([]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  // Per-field errors keyed by field name. Populated on submit, cleared as
  // the user edits each field.
  const [errors, setErrors] = useState({});

  function clearFieldError(field) {
    setErrors((prev) => {
      if (!prev[field]) return prev;
      const next = { ...prev };
      delete next[field];
      return next;
    });
  }
  const errClass = (field) => (errors[field] ? 'uidai-pmis-field uidai-pmis-has-error' : 'uidai-pmis-field');

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

  /* Collect ALL field errors at once so every invalid input is highlighted
     simultaneously and the popup lists every missing/invalid field. */
  const validate = () => {
    const errs = {};
    if (!fullName.trim()) errs.fullName = 'Full Name is required';
    if (!employeeId.trim()) errs.employeeId = 'Username is required';
    if (!email.trim()) errs.email = 'Email is required';
    else if (!/^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/.test(email.trim()))
      errs.email = 'Enter a valid email (e.g. name@example.com)';
    if (!mobile.trim()) errs.mobile = 'Mobile Number is required';
    else if (!/^\d{10}$/.test(mobile.trim()))
      errs.mobile = 'Enter a valid 10-digit mobile number';
    if (!password) errs.password = 'Temporary Password is required';
    if (!vendorId) errs.vendorId = 'Please select an Organization';
    if (!division) errs.division = 'Please select a division';
    if (divisionRequiresOther && !divisionOther.trim()) errs.divisionOther = 'Please specify the division';
    if (!Array.isArray(permissions) || permissions.length === 0)
      errs.permissions = 'Please assign at least one role/permission';
    return errs;
  };

  const splitName = (n) => {
    const parts = n.trim().split(/\s+/);
    return { firstName: parts[0] || '', lastName: parts.slice(1).join(' ') };
  };

  const handleAdd = async () => {
    const errs = validate();
    setErrors(errs);
    const errList = Object.values(errs);
    if (errList.length) {
      setError('');
      uiStore.showError(`Please fix the highlighted fields\n• ${errList.join('\n• ')}`);
      return;
    }
    setError('');
    setSubmitting(true);
    uiStore.showLoader('Adding user...');
    try {
      if (tokenStore.get()) {
        const { firstName, lastName } = splitName(fullName);
        await usersApi.create({
          login: employeeId.trim(),
          email: email.trim(),
          phone_number: mobile.trim(),
          password,
          firstName,
          lastName,
          vendor_id: vendorId,
          division,
          division_other: divisionRequiresOther ? divisionOther.trim() : '',
          project_ids: Array.isArray(mapping) ? mapping : [],
          permissions: Array.isArray(permissions) ? permissions : [],
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
            mobile: mobile.trim(),
            vendorName: selectedVendor?.vendorName || '',
            division,
            projectMapping: mapping,
            permissions,
            status: 'Active',
          },
        ]);
      }
      uiStore.hideLoader();
      uiStore.showMessage('User added successfully', () => navigate('/users'));
    } catch (err) {
      uiStore.hideLoader();
      const errMsg = err?.message || 'Failed to add user';
      setError(errMsg);
      uiStore.showError(errMsg);
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
          <div className={errClass('fullName')}>
            <label>Full Name <span className="uidai-pmis-required">*</span></label>
            <input
              placeholder="e.g. Ravi Kumar"
              value={fullName}
              onChange={(e) => { setFullName(e.target.value); clearFieldError('fullName'); }}
            />
            {errors.fullName && <div className="uidai-pmis-field-error">{errors.fullName}</div>}
          </div>
          <div className={errClass('employeeId')}>
            <label>Username <span className="uidai-pmis-required">*</span></label>
            <input
              placeholder="e.g. ravikumar"
              value={employeeId}
              onChange={(e) => { setEmployeeId(e.target.value); clearFieldError('employeeId'); }}
            />
            {errors.employeeId && <div className="uidai-pmis-field-error">{errors.employeeId}</div>}
          </div>
          <div className={errClass('email')}>
            <label>Email <span className="uidai-pmis-required">*</span></label>
            <input
              type="email"
              placeholder="e.g. name@example.com"
              value={email}
              onChange={(e) => { setEmail(e.target.value); clearFieldError('email'); }}
            />
            {errors.email && <div className="uidai-pmis-field-error">{errors.email}</div>}
          </div>
          <div className={errClass('mobile')}>
            <label>Mobile Number <span className="uidai-pmis-required">*</span></label>
            <div className="uidai-pmis-phone-input">
              <span className="uidai-pmis-phone-prefix" aria-hidden="true">+91</span>
              <input
                type="tel"
                inputMode="numeric"
                maxLength={10}
                placeholder="10-digit mobile number"
                value={mobile}
                autoComplete="tel-national"
                onChange={(e) => {
                  const cleaned = e.target.value.replace(/\D/g, '').slice(0, 10);
                  setMobile(cleaned);
                  clearFieldError('mobile');
                }}
                onKeyPress={(e) => {
                  if (e.key.length === 1 && !/[0-9]/.test(e.key)) e.preventDefault();
                }}
              />
            </div>
            {errors.mobile && <div className="uidai-pmis-field-error">{errors.mobile}</div>}
          </div>
          <div className={errClass('password')}>
            <label>Temporary Password <span className="uidai-pmis-required">*</span></label>
            <div style={{ position: "relative", display: "block" }}>
              <input
                type={showPassword ? "text" : "password"}
                placeholder="Set a temporary password"
                value={password}
                onChange={(e) => { setPassword(e.target.value); clearFieldError('password'); }}
                style={{ paddingRight: 36, width: "100%", boxSizing: "border-box" }}
              />
              <button
                type="button"
                aria-label={showPassword ? "Hide password" : "Show password"}
                title={showPassword ? "Hide password" : "Show password"}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => setShowPassword((v) => !v)}
                style={{
                  position: "absolute",
                  top: "50%",
                  right: 8,
                  transform: "translateY(-50%)",
                  background: "transparent",
                  border: "none",
                  cursor: "pointer",
                  padding: 0,
                  fontSize: 16,
                  lineHeight: 1,
                  color: "#555",
                  zIndex: 2
                }}
              >
                {showPassword ? <FaEyeSlash /> : <FaEye />}
              </button>
            </div>
            {errors.password && <div className="uidai-pmis-field-error">{errors.password}</div>}
          </div>
          <div className={errClass('vendorId')}>
            <label>Organization <span className="uidai-pmis-required">*</span></label>
            <select
              value={vendorId}
              onChange={(e) => { setVendorId(e.target.value); clearFieldError('vendorId'); }}
            >
              <option value="" disabled>Select Organization</option>
              {vendors.map((v) => (
                <option key={v.vendorId} value={v.vendorId}>{v.vendorName}</option>
              ))}
            </select>
            {errors.vendorId && <div className="uidai-pmis-field-error">{errors.vendorId}</div>}
          </div>
          <div className={errClass('division')}>
            <label>Division <span className="uidai-pmis-required">*</span></label>
            <select
              value={division}
              onChange={(e) => {
                const next = e.target.value;
                setDivision(next);
                clearFieldError('division');
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
            {errors.division && <div className="uidai-pmis-field-error">{errors.division}</div>}
          </div>
          {divisionRequiresOther && (
            <div className={errClass('divisionOther')}>
              <label>Specify Division <span className="uidai-pmis-required">*</span></label>
              <input
                placeholder="Specify division name"
                value={divisionOther}
                onChange={(e) => { setDivisionOther(e.target.value); clearFieldError('divisionOther'); }}
              />
              {errors.divisionOther && <div className="uidai-pmis-field-error">{errors.divisionOther}</div>}
            </div>
          )}
          <div className="uidai-pmis-field">
            <label>Project Mapping</label>
            <MultiSelect
              name="userProjectMapping"
              value={mapping}
              options={projectOptions}
              onChange={setMapping}
            />
          </div>
          <div className={`${errClass('permissions')} uidai-pmis-full`}>
            <label>Role &amp; Permissions <span className="uidai-pmis-required">*</span></label>
            <AssignRoleField
              value={permissions}
              onChange={(next) => { setPermissions(next); clearFieldError('permissions'); }}
              editable
            />
            {errors.permissions && <div className="uidai-pmis-field-error">{errors.permissions}</div>}
          </div>
        </div>
        {error && <div className="uidai-error-msg" style={{ marginTop: 8 }}>{error}</div>}
        <div className="uidai-pmis-action-row">
          <button className="uidai-pmis-btn" onClick={handleAdd} disabled={submitting}>
            {submitting ? 'Adding…' : 'Add'}
          </button>
          <button className="uidai-pmis-btn uidai-pmis-btn-cancel" onClick={() => navigate('/')}>Cancel</button>
        </div>
      </div>
    </>
  );
}
