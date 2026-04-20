import { useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useData } from '../../data/DataContext';
import MultiSelect from '../../components/MultiSelect';
import CharTextarea from '../../components/CharTextarea';
import { VENDOR_TYPES, PROJECT_OPTIONS } from '../../data/demoData';

export default function VendorDetails() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { vendors } = useData();
  const v = vendors.find((x) => x.vendorId === id);
  const [editing, setEditing] = useState(false);
  const [mapping, setMapping] = useState(v ? v.projectMapping : []);

  if (!v) {
    return (
      <>
        <div className="uidai-pmis-title">Vendor Details</div>
        <div className="uidai-pmis-card">
          <p className="uidai-pmis-subtitle">Vendor not found.</p>
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
          <button className="uidai-pmis-btn" onClick={() => setEditing((e) => !e)}>
            <span className="uidai-pmis-btn-icon">{editing ? '💾' : '✏️'}</span>{' '}
            <span className="uidai-pmis-btn-text">{editing ? 'Save' : 'Edit'}</span>
          </button>
          <button className="uidai-pmis-btn uidai-pmis-btn-cancel" onClick={() => navigate('/vendors')}>Back</button>
        </div>
        <h3>Vendor Information</h3>
        <br />
        <div className="uidai-pmis-grid-4">
          <div className="uidai-pmis-field">
            <label>Vendor ID <span className="uidai-pmis-required">*</span></label>
            <input defaultValue={v.vendorId} disabled />
          </div>
          <div className="uidai-pmis-field">
            <label>Vendor Name <span className="uidai-pmis-required">*</span></label>
            <input defaultValue={v.vendorName} disabled={!editing} />
          </div>
          <div className="uidai-pmis-field">
            <label>Vendor Type <span className="uidai-pmis-required">*</span></label>
            <select defaultValue={v.vendorType} disabled={!editing}>
              {VENDOR_TYPES.map((t) => (
                <option key={t}>{t}</option>
              ))}
            </select>
          </div>
          <div className="uidai-pmis-field">
            <label>Status <span className="uidai-pmis-required">*</span></label>
            <select defaultValue={v.status} disabled={!editing}>
              <option>Active</option>
              <option>Inactive</option>
            </select>
          </div>
          <div className="uidai-pmis-field">
            <label>Contact Person <span className="uidai-pmis-required">*</span></label>
            <input defaultValue={v.contact} disabled={!editing} />
          </div>
          <div className="uidai-pmis-field">
            <label>Email <span className="uidai-pmis-required">*</span></label>
            <input type="email" defaultValue={v.email} disabled={!editing} />
          </div>
          <div className="uidai-pmis-field">
            <label>Phone <span className="uidai-pmis-required">*</span></label>
            <input defaultValue={v.phone} disabled={!editing} />
          </div>
          <div className="uidai-pmis-field">
            <label>Project Mapping <span className="uidai-pmis-required">*</span></label>
            <MultiSelect
              name="vendorProjectMapping"
              value={mapping}
              options={PROJECT_OPTIONS}
              onChange={setMapping}
              disabled={!editing}
            />
          </div>
          <div className="uidai-pmis-field uidai-pmis-full">
            <label>Description</label>
            <CharTextarea value={v.services} disabled={!editing} />
          </div>
        </div>
      </div>
    </>
  );
}
