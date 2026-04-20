import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import MultiSelect from '../../components/MultiSelect';
import CharTextarea from '../../components/CharTextarea';
import { VENDOR_TYPES, PROJECT_OPTIONS } from '../../data/demoData';

export default function VendorForm() {
  const navigate = useNavigate();
  const [mapping, setMapping] = useState([]);

  return (
    <>
      <div className="uidai-pmis-title">Vendor Management</div>
      <div className="uidai-pmis-card">
        <h3>Add Vendor</h3>
        <br />
        <div className="uidai-pmis-grid-4">
          <div className="uidai-pmis-field">
            <label>Vendor Name <span className="uidai-pmis-required">*</span></label>
            <input />
          </div>
          <div className="uidai-pmis-field">
            <label>Vendor Type <span className="uidai-pmis-required">*</span></label>
            <select>
              {VENDOR_TYPES.map((t) => (
                <option key={t}>{t}</option>
              ))}
            </select>
          </div>
          <div className="uidai-pmis-field">
            <label>Status <span className="uidai-pmis-required">*</span></label>
            <select>
              <option>Active</option>
              <option>Inactive</option>
            </select>
          </div>
          <div className="uidai-pmis-field">
            <label>Contact Person <span className="uidai-pmis-required">*</span></label>
            <input />
          </div>
          <div className="uidai-pmis-field">
            <label>Email <span className="uidai-pmis-required">*</span></label>
            <input type="email" />
          </div>
          <div className="uidai-pmis-field">
            <label>Phone <span className="uidai-pmis-required">*</span></label>
            <input type="tel" />
          </div>
          <div className="uidai-pmis-field">
            <label>Project Mapping <span className="uidai-pmis-required">*</span></label>
            <MultiSelect
              name="vendorProjectMapping"
              value={mapping}
              options={PROJECT_OPTIONS}
              onChange={setMapping}
            />
          </div>
          <div className="uidai-pmis-field uidai-pmis-full">
            <label>Vendor Description</label>
            <CharTextarea />
          </div>
        </div>
        <div className="uidai-pmis-action-row">
          <button className="uidai-pmis-btn">Add</button>
          <button className="uidai-pmis-btn uidai-pmis-btn-cancel" onClick={() => navigate('/vendors')}>
            Cancel
          </button>
        </div>
      </div>
    </>
  );
}
