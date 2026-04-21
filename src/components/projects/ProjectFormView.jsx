import React, { useState, useEffect } from 'react';
import ChipControl from './ChipControl';
import { useStore, showMessage } from './store';
import { CATEGORY_OPTIONS, VENDOR_MASTER, safeArray } from './utils';

export default function ProjectFormView({ onNext, onCancel }) {
  const { onboardDraft } = useStore();

  const [projectName, setProjectName] = useState('');
  const [description, setDescription] = useState('');
  const [owner, setOwner] = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [isPublic, setIsPublic] = useState('Yes');
  const [category, setCategory] = useState('MSAP');
  const [categoryOther, setCategoryOther] = useState('');
  const [vendors, setVendors] = useState([]);

  useEffect(() => {
    const d = onboardDraft;
    if (d) {
      setProjectName(d.projectName || '');
      setDescription(d.description || '');
      setOwner(d.owner || '');
      setStartDate(d.startDate || '');
      setEndDate(d.endDate || '');
      setIsPublic(d.isPublic || 'Yes');
      const catVal = d.category || '';
      const inList = CATEGORY_OPTIONS.includes(catVal);
      setCategory(inList ? catVal : (catVal ? 'Others' : 'MSAP'));
      setCategoryOther(!inList && catVal ? catVal : '');
      setVendors(safeArray(d.vendors));
    }
  }, [onboardDraft]);

  const handleNext = () => {
    const finalCat = category === 'Others' ? categoryOther.trim() : category;
    if (category === 'Others' && !categoryOther.trim()) {
      showMessage('Please specify the category.');
      return;
    }
    if (!projectName.trim() || !owner.trim() || !startDate || !endDate) {
      showMessage('Fill required fields');
      return;
    }
    const draft = {
      projectName: projectName.trim(),
      description: description.trim(),
      owner: owner.trim(),
      startDate, endDate, actualEndDate: '',
      isPublic, category: finalCat,
      baselineId: '-', status: 'DRAFT',
      isVersion: false, versionOf: '', versionNo: 0,
      auditLogs: [],
      milestones: safeArray(onboardDraft?.milestones),
      vendors, resources: [],
    };
    onNext(draft);
  };

  const charsRemaining = 5000 - description.length;

  return (
    <div className="pmis-page">
      <div className="pmis-page-title">Project Management</div>
      <div className="pmis-card">
        <h3>New Project</h3>
        <br />
        <div className="pmis-grid">
          <div className="pmis-field">
            <label>Project Name <span className="pmis-required">*</span></label>
            <input value={projectName} onChange={(e) => setProjectName(e.target.value)} />
          </div>
          <div className="pmis-field pmis-grid-full">
            <label>Description</label>
            <textarea maxLength={5000} value={description} onChange={(e) => setDescription(e.target.value)} />
            <div className="pmis-char-count">{charsRemaining} characters remaining</div>
          </div>
          <div className="pmis-field"><label>Status</label><input value="DRAFT" disabled /></div>
          <div className="pmis-field">
            <label>Owner <span className="pmis-required">*</span></label>
            <input value={owner} onChange={(e) => setOwner(e.target.value)} />
          </div>
          <div className="pmis-field">
            <label>Start Date <span className="pmis-required">*</span></label>
            <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
          </div>
          <div className="pmis-field">
            <label>End Date <span className="pmis-required">*</span></label>
            <input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
          </div>
          <div className="pmis-field">
            <label>Is Public <span className="pmis-required">*</span></label>
            <select value={isPublic} onChange={(e) => setIsPublic(e.target.value)}>
              <option>Yes</option><option>No</option>
            </select>
          </div>
          <div className="pmis-field">
            <label>Category <span className="pmis-required">*</span></label>
            <select value={category} onChange={(e) => setCategory(e.target.value)}>
              {CATEGORY_OPTIONS.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>
          {category === 'Others' && (
            <div className="pmis-field">
              <label>Specify Category <span className="pmis-required">*</span></label>
              <input value={categoryOther} onChange={(e) => setCategoryOther(e.target.value)} />
            </div>
          )}
          <div className="pmis-field pmis-grid-full">
            <label>Associated Vendors</label>
            <div className="pmis-hint pmis-field-sub-hint">Select vendors for this project</div>
            <ChipControl values={vendors} options={VENDOR_MASTER} onChange={setVendors} label="vendor" />
          </div>
        </div>
        <div className="pmis-card-footer-actions">
          <button className="pmis-btn" onClick={handleNext}>Next</button>
          <button className="pmis-btn pmis-btn-cancel" onClick={onCancel}>Cancel</button>
        </div>
      </div>
    </div>
  );
}
