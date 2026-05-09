import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { FaEye, FaEyeSlash } from 'react-icons/fa';
import { useData } from '../../data/DataContext';
import MultiSelect from '../../components/MultiSelect';
import { DIVISION_OPTIONS, PROJECT_OPTIONS } from '../../data/demoData';
import * as usersApi from '../../api/users';
import * as vendorsApi from '../../api/vendors';
import { API_BASE, authorizedFetch, tokenStore } from '../../api/client';
import { ENDPOINTS } from '../../api/endpoint';
import { uiStore } from '../../store/project/uiStore';
import { useCan } from '../../auth/permissions';

// Role-dropdown options keyed by the permission flag that must be true
// for the option to appear. Filtered at render time against the current
// user's role.
const ORG_ROLE_OPTIONS = [
  { value: 'super_admin', label: 'Super Admin', requires: 'createSuperAdmin' },
  { value: 'admin', label: 'PMIS Admin', requires: 'createAdmin' },
  { value: 'org_admin', label: 'Org Admin', requires: 'createOrgAdmin' },
  { value: 'project_admin', label: 'Project Admin', requires: 'createProjectAdmin' },
  { value: 'project_member', label: 'Project Member', requires: 'createProjectMember' },
];

export default function UserForm() {
  const { vendors, setVendors, refresh, setUsers, users } = useData();
  const navigate = useNavigate();
  // Vendors come from DataContext, but its initial refresh runs once at app
  // mount — if the token wasn't set yet (pre-login), the Organization
  // dropdown stays empty on the first visit here. Re-fetch on mount so the
  // list is always populated, mirroring what UserList does for users.
  useEffect(() => {
    if (!tokenStore.get()) return;
    if (Array.isArray(vendors) && vendors.length > 0) return;
    let cancelled = false;
    (async () => {
      try {
        const list = await vendorsApi.list();
        if (!cancelled && Array.isArray(list)) setVendors(list);
      } catch {
        /* swallow — dropdown will simply remain empty */
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const canCreateUser = useCan('createUser');
  const canCreateSuperAdmin = useCan('createSuperAdmin');
  const canCreateAdmin = useCan('createAdmin');
  const canCreateOrgAdmin = useCan('createOrgAdmin');
  const canCreateProjectAdmin = useCan('createProjectAdmin');
  const canCreateProjectMember = useCan('createProjectMember');
  const orgRoleFlags = {
    createSuperAdmin: canCreateSuperAdmin,
    createAdmin: canCreateAdmin,
    createOrgAdmin: canCreateOrgAdmin,
    createProjectAdmin: canCreateProjectAdmin,
    createProjectMember: canCreateProjectMember,
  };
  const allowedOrgRoles = ORG_ROLE_OPTIONS.filter(
    (o) => orgRoleFlags[o.requires]
  );

  const [fullName, setFullName] = useState('');
  const [employeeId, setEmployeeId] = useState('');
  const [email, setEmail] = useState('');
  const [mobile, setMobile] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [vendorId, setVendorId] = useState('');
  const [division, setDivision] = useState('');
  const [divisionOther, setDivisionOther] = useState('');
  const [orgRole, setOrgRole] = useState('');
  // Multi-select Project Mapping. Always visible regardless of role.
  const [mapping, setMapping] = useState([]);
  const [projectList, setProjectList] = useState([]);
  const [divisionList, setDivisionList] = useState([]);
  // Fresh vendor object fetched on demand. The vendors LIST endpoint
  // sometimes drops the `projects[]` array (server-side pagination /
  // partial payload), so when org_admin / project_admin needs vendor-
  // scoped projects we fall back to a one-off GET on /vendors/:id.
  // Keyed by vendorId so re-selecting the same org doesn't re-fetch.
  const [vendorDetailById, setVendorDetailById] = useState({});
  const [vendorDetailLoading, setVendorDetailLoading] = useState(false);
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

  const vendorFromList = vendors.find((v) => v.vendorId === vendorId);
  const vendorFromDetail = vendorId ? vendorDetailById[vendorId] : null;
  // Prefer the freshly-fetched vendor (full payload, has projects[]) and
  // fall back to whatever the LIST gave us so the form renders something
  // immediately while the GET is still in flight.
  const selectedVendor = vendorFromDetail || vendorFromList;

  // When the user picks an Organization (and the role needs to be scoped
  // to its projects), make sure we have the vendor's full payload — the
  // LIST endpoint occasionally returns vendors without their projects[]
  // array, which is why org-scoped project mapping was sometimes empty.
  useEffect(() => {
    if (!tokenStore.get()) return;
    if (!vendorId) return;
    const restrictToVendor =
      orgRole === 'org_admin' || orgRole === 'project_admin';
    if (!restrictToVendor) return;
    // Already have a full payload (with projects[]) cached → skip the GET.
    const cached = vendorDetailById[vendorId];
    if (cached && Array.isArray(cached.projects)) return;
    let cancelled = false;
    setVendorDetailLoading(true);
    (async () => {
      try {
        const v = await vendorsApi.get(vendorId);
        if (!cancelled && v) {
          setVendorDetailById((prev) => ({ ...prev, [vendorId]: v }));
        }
      } catch {
        /* swallow — fall back to whatever vendors LIST gave us */
      } finally {
        if (!cancelled) setVendorDetailLoading(false);
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [vendorId, orgRole]);

  // Project mapping must respect role + organization:
  //   - org_admin / project_admin → only the selected organization's projects
  //   - everyone else → all projects (legacy behavior, used for fallback)
  // Falls back to demoData when there's no token, to keep the no-auth dev
  // path working.
  const projectOptions = useMemo(() => {
    if (!tokenStore.get()) {
      return PROJECT_OPTIONS.map((name) => ({ label: name, value: name }));
    }
    const restrictToVendor =
      orgRole === 'org_admin' || orgRole === 'project_admin';
    if (restrictToVendor && selectedVendor) {
      const vendorProjects = Array.isArray(selectedVendor.projects)
        ? selectedVendor.projects
        : [];
      return vendorProjects
        .map((p) => ({
          label: p.name || p.projectCode || p.id || p.uuid,
          value: p.id || p.uuid,
        }))
        .filter((o) => o.value);
    }
    return projectList.map((p) => ({
      label: p.name || p.projectCode || p.id,
      value: p.id || p.uuid,
    }));
  }, [projectList, orgRole, selectedVendor]);

  const projectNameById = useMemo(() => {
    const map = {};
    projectList.forEach((p) => {
      const id = p.id || p.uuid;
      if (id) map[id] = p.name || p.projectCode || id;
    });
    // Vendor-scoped projects may not appear in the global projectList
    // (different page sizes, role-filtered endpoints, etc.) — make sure
    // labels still resolve when we restrict to the vendor's projects.
    if (selectedVendor && Array.isArray(selectedVendor.projects)) {
      selectedVendor.projects.forEach((p) => {
        const id = p.id || p.uuid;
        if (id && !map[id]) map[id] = p.name || p.projectCode || id;
      });
    }
    return map;
  }, [projectList, selectedVendor]);

  // Clear stale picks when the org/role context changes — switching
  // organization or role can shrink the available project options, and
  // keeping ids that no longer belong to the new context would silently
  // ship invalid mappings to the API.
  useEffect(() => {
    setMapping([]);
  }, [vendorId, orgRole]);

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
        // Project mapping is universal — same payload shape for every role.
        // No per-project role attached anymore.
        const projectIds = mapping.filter(Boolean);
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
          orgRole: orgRole || null,
          project_ids: projectIds,
          projectAssignments: projectIds.map((projectId) => ({ projectId })),
          assignments: [],
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
            orgRole: orgRole || null,
            projectAssignments: mapping.map((projectId) => ({ projectId })),
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
              onChange={(e) => {
                setVendorId(e.target.value);
                clearFieldError('vendorId');
              }}
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
            <label>Role</label>
            <select
              value={orgRole}
              onChange={(e) => setOrgRole(e.target.value)}
            >
              <option value="">— Select —</option>
              {allowedOrgRoles.map((o) => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
          </div>
        </div>

        <div className="uidai-pmis-grid-4" style={{ marginTop: 18 }}>
          <div className="uidai-pmis-field uidai-pmis-full">
            <label>Project Mapping</label>
            {(orgRole === 'org_admin' || orgRole === 'project_admin') && !vendorId && (
              <div className="uidai-hint" style={{ marginBottom: 6 }}>
                Select an Organization first to see its assigned projects.
              </div>
            )}
            {(orgRole === 'org_admin' || orgRole === 'project_admin') && vendorId && vendorDetailLoading && projectOptions.length === 0 && (
              <div className="uidai-hint" style={{ marginBottom: 6 }}>
                Loading the organization's projects...
              </div>
            )}
            {(orgRole === 'org_admin' || orgRole === 'project_admin') && vendorId && !vendorDetailLoading && projectOptions.length === 0 && (
              <div className="uidai-hint" style={{ marginBottom: 6 }}>
                No projects are assigned to the selected organization.
              </div>
            )}
            <MultiSelect
              name="userProjectMapping"
              value={mapping}
              options={projectOptions}
              onChange={setMapping}
            />
          </div>
        </div>
        {error && <div className="uidai-error-msg" style={{ marginTop: 8 }}>{error}</div>}
        {!canCreateUser && (
          <div className="uidai-error-msg" style={{ marginTop: 8 }}>
            You do not have permission to create users.
          </div>
        )}
        <div className="uidai-pmis-action-row">
          <button
            className="uidai-pmis-btn"
            onClick={handleAdd}
            disabled={submitting || !canCreateUser}
            title={!canCreateUser ? 'Insufficient permissions' : undefined}
          >
            {submitting ? 'Adding…' : 'Add'}
          </button>
          <button className="uidai-pmis-btn uidai-pmis-btn-cancel" onClick={() => navigate('/')}>Cancel</button>
        </div>
      </div>
    </>
  );
}
