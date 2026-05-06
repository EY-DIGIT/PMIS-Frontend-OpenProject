import { useEffect, useMemo, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useData } from '../../data/DataContext';
import MultiSelect from '../../components/MultiSelect';
import CharTextarea from '../../components/CharTextarea';
import { VENDOR_TYPES, PROJECT_OPTIONS } from '../../data/demoData';
import * as vendorsApi from '../../api/vendors';
import { API_BASE, authorizedFetch, tokenStore } from '../../api/client';
import { ENDPOINTS } from '../../api/endpoint';

export default function VendorDetails() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { vendors, refresh } = useData();
  const fallback = vendors.find((x) => x.vendorId === id) || null;

  const [vendor, setVendor] = useState(fallback);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState('');
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');

  const [name, setName] = useState('');
  const [type, setType] = useState(VENDOR_TYPES[0]);
  const [status, setStatus] = useState('Active');
  const [contact, setContact] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [description, setDescription] = useState('');
  const [mapping, setMapping] = useState([]);

  const [projectList, setProjectList] = useState([]);

  const seed = (v) => {
    setName(v?.vendorName || '');
    setType(v?.vendorType || VENDOR_TYPES[0]);
    setStatus(v?.status || 'Active');
    setContact(v?.contact || '');
    setEmail(v?.email || '');
    setPhone(v?.phone || '');
    setDescription(v?.description || v?.services || '');
    setMapping(Array.isArray(v?.projectIds) && v.projectIds.length
      ? v.projectIds
      : Array.isArray(v?.projectMapping) ? v.projectMapping : []);
  };

  useEffect(() => {
    if (!id) return;
    if (!tokenStore.get()) {
      setVendor(fallback);
      seed(fallback);
      return;
    }
    let cancelled = false;
    (async () => {
      setLoading(true);
      setLoadError('');
      try {
        const v = await vendorsApi.get(id);
        if (!cancelled) {
          setVendor(v);
          seed(v);
        }
      } catch (err) {
        if (!cancelled) {
          setLoadError(err?.message || 'Failed to load vendor');
          if (fallback) {
            setVendor(fallback);
            seed(fallback);
          }
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

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

  const handleEditToggle = async () => {
    if (!editing) {
      setSaveError('');
      setEditing(true);
      return;
    }
    if (saving) return;
    setSaveError('');
    setSaving(true);
    try {
      if (tokenStore.get()) {
        const updated = await vendorsApi.update(id, {
          name: name.trim(),
          description: description.trim(),
          active: status === 'Active',
          email: email.trim(),
          contact_person: contact.trim(),
          phone_number: phone.trim(),
          projectMapping: mapping,
        });
        setVendor(updated);
        seed(updated);
        await refresh();
      }
      setEditing(false);
    } catch (err) {
      setSaveError(err?.message || 'Failed to update vendor');
    } finally {
      setSaving(false);
    }
  };

  const handleCancelEdit = () => {
    seed(vendor);
    setEditing(false);
    setSaveError('');
  };

  if (loading && !vendor) {
    return (
      <>
        <div className="uidai-pmis-title">Vendor Details</div>
        <div className="uidai-pmis-card">
          <p className="uidai-pmis-subtitle">Loading...</p>
        </div>
      </>
    );
  }

  if (!vendor) {
    return (
      <>
        <div className="uidai-pmis-title">Vendor Details</div>
        <div className="uidai-pmis-card">
          <p className="uidai-pmis-subtitle">{loadError || 'Vendor not found.'}</p>
          <button className="uidai-pmis-btn uidai-pmis-btn-cancel" onClick={() => navigate('/vendors')}>Back</button>
        </div>
      </>
    );
  }

  return (
    <>
      <div className="uidai-pmis-title">Vendor Details</div>
      <div className="uidai-pmis-card">
        <div className="uidai-pmis-card-actions">
          <button className="uidai-pmis-btn" onClick={handleEditToggle} disabled={saving}>
            <span className="uidai-pmis-btn-icon">{editing ? '💾' : '✏️'}</span>{' '}
            <span className="uidai-pmis-btn-text">
              {editing ? (saving ? 'Saving…' : 'Save') : 'Edit'}
            </span>
          </button>
          {editing ? (
            <button className="uidai-pmis-btn uidai-pmis-btn-cancel" onClick={handleCancelEdit} disabled={saving}>Cancel</button>
          ) : (
            <button className="uidai-pmis-btn uidai-pmis-btn-cancel" onClick={() => navigate('/vendors')}>Back</button>
          )}
        </div>
        <h3>Vendor Information</h3>
        <br />
        <div className="uidai-pmis-grid-4">
          <div className="uidai-pmis-field">
            <label>Vendor ID <span className="uidai-pmis-required">*</span></label>
            <input value={vendor.vendorCode || vendor.vendorId} disabled />
          </div>
          <div className="uidai-pmis-field">
            <label>Vendor Name <span className="uidai-pmis-required">*</span></label>
            <input value={name} onChange={(e) => setName(e.target.value)} disabled={!editing} />
          </div>
          <div className="uidai-pmis-field">
            <label>Vendor Type <span className="uidai-pmis-required">*</span></label>
            <select value={type} onChange={(e) => setType(e.target.value)} disabled={!editing}>
              {VENDOR_TYPES.map((t) => (
                <option key={t}>{t}</option>
              ))}
            </select>
          </div>
          <div className="uidai-pmis-field">
            <label>Status <span className="uidai-pmis-required">*</span></label>
            <select value={status} onChange={(e) => setStatus(e.target.value)} disabled={!editing}>
              <option>Active</option>
              <option>Inactive</option>
            </select>
          </div>
          <div className="uidai-pmis-field">
            <label>Contact Person <span className="uidai-pmis-required">*</span></label>
            <input value={contact} onChange={(e) => setContact(e.target.value)} disabled={!editing} />
          </div>
          <div className="uidai-pmis-field">
            <label>Email <span className="uidai-pmis-required">*</span></label>
            <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} disabled={!editing} />
          </div>
          <div className="uidai-pmis-field">
            <label>Phone <span className="uidai-pmis-required">*</span></label>
            <input value={phone} onChange={(e) => setPhone(e.target.value)} disabled={!editing} />
          </div>
          <div className="uidai-pmis-field">
            <label>Project Mapping <span className="uidai-pmis-required">*</span></label>
            <MultiSelect
              name="vendorProjectMapping"
              value={mapping}
              options={projectOptions}
              onChange={setMapping}
              disabled={!editing}
            />
          </div>
          <div className="uidai-pmis-field uidai-pmis-full">
            <label>Description</label>
            <CharTextarea value={description} onChange={setDescription} disabled={!editing} />
          </div>
        </div>
        {saveError && <div className="uidai-error-msg" style={{ marginTop: 8 }}>{saveError}</div>}
        {loadError && !saveError && <div className="uidai-error-msg" style={{ marginTop: 8 }}>{loadError}</div>}
      </div>
    </>
  );
}
