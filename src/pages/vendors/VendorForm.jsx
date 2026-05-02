import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import MultiSelect from '../../components/MultiSelect';
import CharTextarea from '../../components/CharTextarea';
import { VENDOR_TYPES, PROJECT_OPTIONS } from '../../data/demoData';
import * as vendorsApi from '../../api/vendors';
import { API_BASE, authorizedFetch, tokenStore } from '../../api/client';
import { ENDPOINTS } from '../../api/endpoint';
import { useData } from '../../data/DataContext';
import { uiStore } from '../../store/project/uiStore';

export default function VendorForm() {
  const navigate = useNavigate();
  const { refresh, setVendors, vendors } = useData();

  const [name, setName] = useState('');
  const [type, setType] = useState(VENDOR_TYPES[0]);
  const [contact, setContact] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [description, setDescription] = useState('');
  const [mapping, setMapping] = useState([]);
  const [projectList, setProjectList] = useState([]);
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

  const projectOptions = useMemo(() => {
    if (!tokenStore.get()) return PROJECT_OPTIONS;
    return projectList.map((p) => ({
      label: p.name || p.projectCode || p.id,
      value: p.id || p.uuid,
    }));
  }, [projectList]);

  const validate = () => {
    if (!name.trim()) return 'Vendor Name is required';
    if (!contact.trim()) return 'Contact Person is required';
    if (!/^[A-Za-z][A-Za-z\s\-'.]*$/.test(contact.trim()))
      return "Contact Person can only contain letters, spaces, hyphens, apostrophes, and full stops";
    if (!email.trim()) return 'Email is required';
    if (!/^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/.test(email.trim()))
      return 'Please enter a valid email address (e.g. name@example.com)';
    if (!phone.trim()) return 'Mobile Number is required';
    if (!/^[6-9]\d{9}$/.test(phone.trim())) return 'Enter a valid 10-digit mobile number starting with 6-9';
    if (!Array.isArray(mapping) || mapping.length === 0)
      return 'At least one Project Mapping is required';
    return '';
  };

  const handleAdd = async () => {
    const msg = validate();
    if (msg) { setError(msg); return; }
    setError('');
    setSubmitting(true);
    uiStore.showLoader('Adding vendor...');
    try {
      if (tokenStore.get()) {
        await vendorsApi.create({
          name: name.trim(),
          description: description.trim(),
          active: true,
          email: email.trim(),
          contact_person: contact.trim(),
          phone_number: phone.trim(),
          projectMapping: mapping,
        });
        await refresh();
      } else {
        setVendors([
          ...vendors,
          {
            vendorId: `VND${String(vendors.length + 1).padStart(3, '0')}`,
            vendorName: name.trim(),
            vendorType: type,
            status: 'Active',
            contact: contact.trim(),
            email: email.trim(),
            phone: phone.trim(),
            projectMapping: mapping,
            services: description.trim(),
          },
        ]);
      }
      uiStore.hideLoader();
      uiStore.showMessage('Vendor added successfully', () => navigate('/vendors'));
    } catch (err) {
      uiStore.hideLoader();
      const errMsg = err?.message || 'Failed to add vendor';
      setError(errMsg);
      uiStore.showError(errMsg);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <>
      <div className="uidai-pmis-card">
        <h3>Add Vendor</h3>
        <br />
        <div className="uidai-pmis-grid-4">
          <div className="uidai-pmis-field">
            <label>Vendor Name <span className="uidai-pmis-required">*</span></label>
            <input value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div className="uidai-pmis-field">
            <label>Vendor Type <span className="uidai-pmis-required">*</span></label>
            <select value={type} onChange={(e) => setType(e.target.value)}>
              {VENDOR_TYPES.map((t) => (
                <option key={t}>{t}</option>
              ))}
            </select>
          </div>
          <div className="uidai-pmis-field">
            <label>Contact Person <span className="uidai-pmis-required">*</span></label>
            <input
              value={contact}
              maxLength={100}
              placeholder="e.g. Ravi Kumar"
              onChange={(e) => {
                // Allow only letters, spaces, hyphens, apostrophes, fullstops
                const cleaned = e.target.value.replace(/[^A-Za-z\s\-'.]/g, '');
                setContact(cleaned);
              }}
              onKeyDown={(e) => {
                // Block disallowed single-character keys (digits, special chars)
                if (e.key.length === 1 && !/[A-Za-z\s\-'.]/.test(e.key)) {
                  e.preventDefault();
                }
              }}
            />
          </div>
          <div className="uidai-pmis-field">
            <label>Email <span className="uidai-pmis-required">*</span></label>
            <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
          </div>
          <div className="uidai-pmis-field">
            <label>Mobile Number <span className="uidai-pmis-required">*</span></label>
            <div className="uidai-pmis-phone-input">
              <span className="uidai-pmis-phone-prefix" aria-hidden="true">+91</span>
              <input
                type="tel"
                inputMode="numeric"
                maxLength={10}
                placeholder="10-digit mobile number"
                value={phone}
                autoComplete="tel-national"
                onChange={(e) => {
                  const cleaned = e.target.value.replace(/\D/g, '').slice(0, 10);
                  setPhone(cleaned);
                }}
                onKeyPress={(e) => {
                  if (e.key.length === 1 && !/[0-9]/.test(e.key)) e.preventDefault();
                }}
              />
            </div>
          </div>
          <div className="uidai-pmis-field">
            <label>Project Mapping <span className="uidai-pmis-required">*</span></label>
            <MultiSelect
              name="vendorProjectMapping"
              value={mapping}
              options={projectOptions}
              onChange={setMapping}
            />
          </div>
          <div className="uidai-pmis-field uidai-pmis-full">
            <label>Vendor Description</label>
            <CharTextarea value={description} onChange={setDescription} />
          </div>
        </div>
        {error && <div className="uidai-error-msg" style={{ marginTop: 8 }}>{error}</div>}
        <div className="uidai-pmis-action-row">
          <button className="uidai-pmis-btn" onClick={handleAdd} disabled={submitting}>
            {submitting ? 'Adding…' : 'Add'}
          </button>
          <button className="uidai-pmis-btn uidai-pmis-btn-cancel" onClick={() => navigate('/')}>
            Cancel
          </button>
        </div>
      </div>
    </>
  );
}
