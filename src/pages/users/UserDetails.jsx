import { useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useData } from '../../data/DataContext';
import MultiSelect from '../../components/MultiSelect';
import CharTextarea from '../../components/CharTextarea';
import { USER_ROLES, PROJECT_OPTIONS } from '../../data/demoData';

const DIVISION_DETAIL_OPTIONS = ['Technology', 'Operations', 'Audit'];

export default function UserDetails() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { users } = useData();
  const u = users.find((x) => x.userId === id);
  const [editing, setEditing] = useState(false);
  const [mapping, setMapping] = useState(u ? u.projectMapping : []);

  if (!u) {
    return (
      <>
        <div className="uidai-pmis-title">User Details</div>
        <div className="uidai-pmis-card">
          <p className="uidai-pmis-subtitle">User not found.</p>
          <button className="uidai-pmis-btn uidai-pmis-btn-cancel" onClick={() => navigate('/users')}>Back</button>
        </div>
      </>
    );
  }

  return (
    <>
      <div className="uidai-pmis-title">User Details</div>
      <div className="uidai-pmis-card">
        <div className="uidai-pmis-card-actions">
          <button className="uidai-pmis-btn" onClick={() => setEditing((e) => !e)}>
            <span className="uidai-pmis-btn-icon">{editing ? '💾' : '✏️'}</span>{' '}
            <span className="uidai-pmis-btn-text">{editing ? 'Save' : 'Edit'}</span>
          </button>
          <button className="uidai-pmis-btn uidai-pmis-btn-cancel" onClick={() => navigate('/users')}>Back</button>
        </div>
        <h3>User Information</h3>
        <br />
        <div className="uidai-pmis-grid-4">
          <div className="uidai-pmis-field">
            <label>User ID <span className="uidai-pmis-required">*</span></label>
            <input defaultValue={u.userId} disabled />
          </div>
          <div className="uidai-pmis-field">
            <label>Full Name <span className="uidai-pmis-required">*</span></label>
            <input defaultValue={u.fullName} disabled={!editing} />
          </div>
          <div className="uidai-pmis-field">
            <label>Employee ID <span className="uidai-pmis-required">*</span></label>
            <input defaultValue={u.employeeId} disabled />
          </div>
          <div className="uidai-pmis-field">
            <label>Email <span className="uidai-pmis-required">*</span></label>
            <input type="email" defaultValue={u.email} disabled={!editing} />
          </div>
          <div className="uidai-pmis-field">
            <label>Role <span className="uidai-pmis-required">*</span></label>
            <select defaultValue={u.role} disabled={!editing}>
              {USER_ROLES.map((r) => <option key={r}>{r}</option>)}
            </select>
          </div>
          <div className="uidai-pmis-field">
            <label>Associated Vendor Name <span className="uidai-pmis-required">*</span></label>
            <input defaultValue={u.vendorName} disabled />
          </div>
          <div className="uidai-pmis-field">
            <label>Division <span className="uidai-pmis-required">*</span></label>
            <select defaultValue={u.division} disabled={!editing}>
              {DIVISION_DETAIL_OPTIONS.map((d) => <option key={d}>{d}</option>)}
            </select>
          </div>
          <div className="uidai-pmis-field">
            <label>Project Mapping <span className="uidai-pmis-required">*</span></label>
            <MultiSelect
              name="userProjectMapping"
              value={mapping}
              options={PROJECT_OPTIONS}
              onChange={setMapping}
              disabled={!editing}
            />
          </div>
          <div className="uidai-pmis-field">
            <label>Status <span className="uidai-pmis-required">*</span></label>
            <select defaultValue={u.status} disabled={!editing}>
              <option>Active</option>
              <option>Inactive</option>
            </select>
          </div>
        </div>
      </div>

      <div className="uidai-pmis-card">
        <h3>Remarks</h3>
        <br />
        <div className="uidai-pmis-grid">
          <div className="uidai-pmis-field uidai-pmis-full">
            <CharTextarea
              value="Access aligned to role-based permissions."
              disabled={!editing}
            />
          </div>
        </div>
      </div>
    </>
  );
}
