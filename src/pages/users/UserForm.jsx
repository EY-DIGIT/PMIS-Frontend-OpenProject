import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useData } from '../../data/DataContext';
import MultiSelect from '../../components/MultiSelect';
import { USER_ROLES, DIVISION_OPTIONS, PROJECT_OPTIONS } from '../../data/demoData';

export default function UserForm() {
  const { vendors } = useData();
  const navigate = useNavigate();
  const [mapping, setMapping] = useState([]);

  return (
    <>
      <div className="uidai-pmis-title">User Management</div>
      <div className="uidai-pmis-card">
        <h3>Add User</h3>
        <br />
        <div className="uidai-pmis-grid-4">
          <div className="uidai-pmis-field">
            <label>Full Name <span className="uidai-pmis-required">*</span></label>
            <input />
          </div>
          <div className="uidai-pmis-field">
            <label>Employee ID <span className="uidai-pmis-required">*</span></label>
            <input />
          </div>
          <div className="uidai-pmis-field">
            <label>Email <span className="uidai-pmis-required">*</span></label>
            <input type="email" />
          </div>
          <div className="uidai-pmis-field">
            <label>Temporary Password <span className="uidai-pmis-required">*</span></label>
            <input type="password" />
          </div>
          <div className="uidai-pmis-field">
            <label>Role <span className="uidai-pmis-required">*</span></label>
            <select>
              {USER_ROLES.map((r) => <option key={r}>{r}</option>)}
            </select>
          </div>
          <div className="uidai-pmis-field">
            <label>Associated Vendor Name <span className="uidai-pmis-required">*</span></label>
            <select defaultValue="">
              <option value="" disabled>Select Vendor</option>
              {vendors.map((v) => (
                <option key={v.vendorId}>{v.vendorName}</option>
              ))}
            </select>
          </div>
          <div className="uidai-pmis-field">
            <label>Division <span className="uidai-pmis-required">*</span></label>
            <select>
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
        <div className="uidai-pmis-action-row">
          <button className="uidai-pmis-btn">Add</button>
          <button className="uidai-pmis-btn uidai-pmis-btn-cancel" onClick={() => navigate('/users')}>Cancel</button>
        </div>
      </div>
    </>
  );
}
