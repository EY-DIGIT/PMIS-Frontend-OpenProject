import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import MultiSelect from '../../components/MultiSelect';
import CharTextarea from '../../components/CharTextarea';
import { VENDOR_TYPES, PROJECT_OPTIONS } from '../../data/demoData';
import * as vendorsApi from '../../api/vendors';
import { API_BASE, authorizedFetch, tokenStore } from '../../api/client';
import { ENDPOINTS } from '../../api/endpoint';
import { useData } from '../../data/DataContext';

export default function VendorForm() {
  const navigate = useNavigate();
  const { refresh, setVendors, vendors } = useData();

  const [name, setName] = useState('');
  const [type, setType] = useState(VENDOR_TYPES[0]);
  const [status, setStatus] = useState('Active');
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
    if (!projectList.length) return PROJECT_OPTIONS;
    return projectList.map((p) => ({
      label: p.name || p.projectCode || p.id,
      value: p.id || p.uuid,
    }));
  }, [projectList]);

  const validate = () => {
    if (!name.trim()) return 'Vendor Name is required';
    if (!contact.trim()) return 'Contact Person is required';
    if (!email.trim()) return 'Email is required';
    if (!phone.trim()) return 'Phone is required';
    return '';
  };

  const handleAdd = async () => {
    const msg = validate();
    if (msg) { setError(msg); return; }
    setError('');
    setSubmitting(true);
    try {
      if (tokenStore.get()) {
        await vendorsApi.create({
          name: name.trim(),
          description: description.trim(),
          active: status === 'Active',
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
            status,
            contact: contact.trim(),
            email: email.trim(),
            phone: phone.trim(),
            projectMapping: mapping,
            services: description.trim(),
          },
        ]);
      }
      navigate('/vendors');
    } catch (err) {
      setError(err?.message || 'Failed to add vendor');
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
            <label>Status <span className="uidai-pmis-required">*</span></label>
            <select value={status} onChange={(e) => setStatus(e.target.value)}>
              <option>Active</option>
              <option>Inactive</option>
            </select>
          </div>
          <div className="uidai-pmis-field">
            <label>Contact Person <span className="uidai-pmis-required">*</span></label>
            <input value={contact} onChange={(e) => setContact(e.target.value)} />
          </div>
          <div className="uidai-pmis-field">
            <label>Email <span className="uidai-pmis-required">*</span></label>
            <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
          </div>
          <div className="uidai-pmis-field">
            <label>Phone <span className="uidai-pmis-required">*</span></label>
            <input type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} />
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
          <button className="uidai-pmis-btn uidai-pmis-btn-cancel" onClick={() => navigate('/vendors')}>
            Cancel
          </button>
        </div>
      </div>
    </>
  );
}
