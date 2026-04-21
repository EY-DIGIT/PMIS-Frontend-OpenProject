import React from 'react';
import { RESOURCE_TYPE_CODES } from './utils';

export default function ResourceSection({
  entryType, setEntryType,
  resourceDetails, setResourceDetails,
  resourceCount, setResourceCount,
  disabled,
}) {
  const updD = (key, val) => setResourceDetails({ ...resourceDetails, [key]: val });
  const updC = (key, val) => setResourceCount({ ...resourceCount, [key]: val });
  const adjCount = (delta) => updC('count', Math.max(1, (parseInt(resourceCount.count, 10) || 1) + delta));

  return (
    <div className="pmis-resource-outer pmis-grid-full">
      <h4 className="pmis-section-heading">Resource Details</h4>
      <div className="pmis-resource-radio-group" role="radiogroup" aria-label="Resource entry type">
        <div
          className={`pmis-resource-radio-option ${entryType === 'details' ? 'pmis-resource-radio-active' : ''}`}
          onClick={() => !disabled && setEntryType('details')}
          role="radio" aria-checked={entryType === 'details'}
        >
          <div className="pmis-resource-radio-dot" />
          <div className="pmis-resource-radio-info">
            <div className="pmis-resource-radio-title">Resource Details</div>
            <div className="pmis-resource-radio-sub">Record a specific named resource with full profile</div>
          </div>
        </div>
        <div
          className={`pmis-resource-radio-option ${entryType === 'count' ? 'pmis-resource-radio-active' : ''}`}
          onClick={() => !disabled && setEntryType('count')}
          role="radio" aria-checked={entryType === 'count'}
        >
          <div className="pmis-resource-radio-dot" />
          <div className="pmis-resource-radio-info">
            <div className="pmis-resource-radio-title">Resource Count</div>
            <div className="pmis-resource-radio-sub">Record only a count of resources (no name)</div>
          </div>
        </div>
      </div>

      {entryType === 'details' && (
        <div className="pmis-resource-section">
          <div className="pmis-resource-section-title">Resource Profile</div>
          <div className="pmis-grid">
            <div className="pmis-field"><label>Resource Name</label>
              <input value={resourceDetails.resourceName || ''} onChange={(e) => updD('resourceName', e.target.value)} disabled={disabled} /></div>
            <div className="pmis-field"><label>Resource Type</label>
              <select value={resourceDetails.resType || 'RFP'} onChange={(e) => updD('resType', e.target.value)} disabled={disabled}>
                {RESOURCE_TYPE_CODES.map((t) => <option key={t} value={t}>{t}</option>)}
              </select></div>
            <div className="pmis-field"><label>Resource Division</label>
              <input value={resourceDetails.division || ''} onChange={(e) => updD('division', e.target.value)} disabled={disabled} /></div>
            <div className="pmis-field"><label>Onboarding Date</label>
              <input type="date" value={resourceDetails.onboardingDate || ''} onChange={(e) => updD('onboardingDate', e.target.value)} disabled={disabled} /></div>
            <div className="pmis-field"><label>Offboarding Date</label>
              <input type="date" value={resourceDetails.offboardingDate || ''} onChange={(e) => updD('offboardingDate', e.target.value)} disabled={disabled} /></div>
            <div className="pmis-field"><label>Actual Onboarding Date</label>
              <input type="date" value={resourceDetails.actualOnboardingDate || ''} onChange={(e) => updD('actualOnboardingDate', e.target.value)} disabled={disabled} /></div>
            <div className="pmis-field"><label>Actual Offboarding Date</label>
              <input type="date" value={resourceDetails.actualOffboardingDate || ''} onChange={(e) => updD('actualOffboardingDate', e.target.value)} disabled={disabled} /></div>
            <div className="pmis-field"><label>Position</label>
              <input value={resourceDetails.position || ''} onChange={(e) => updD('position', e.target.value)} disabled={disabled} /></div>
            <div className="pmis-field"><label>Designation</label>
              <input value={resourceDetails.designation || ''} onChange={(e) => updD('designation', e.target.value)} disabled={disabled} /></div>
            <div className="pmis-field"><label>Job Role</label>
              <input value={resourceDetails.jobRole || ''} onChange={(e) => updD('jobRole', e.target.value)} disabled={disabled} /></div>
            <div className="pmis-field"><label>Qualification</label>
              <input value={resourceDetails.qualification || ''} onChange={(e) => updD('qualification', e.target.value)} disabled={disabled} /></div>
            <div className="pmis-field"><label>Experience (Years)</label>
              <input type="number" min="0" step="0.1" value={resourceDetails.experience || ''} onChange={(e) => updD('experience', e.target.value)} disabled={disabled} /></div>
          </div>
        </div>
      )}

      {entryType === 'count' && (
        <div className="pmis-resource-section">
          <div className="pmis-resource-section-title">Resource Count</div>
          <div className="pmis-grid">
            <div className="pmis-field"><label>Resource Type</label>
              <select value={resourceCount.resType || 'RFP'} onChange={(e) => updC('resType', e.target.value)} disabled={disabled}>
                {RESOURCE_TYPE_CODES.map((t) => <option key={t} value={t}>{t}</option>)}
              </select></div>
            <div className="pmis-field"><label>Resource Count</label>
              <div className="pmis-res-count-wrap">
                <button type="button" className="pmis-res-count-btn" onClick={() => adjCount(-1)} disabled={disabled}>−</button>
                <input type="number" min="1" value={resourceCount.count || 1}
                  onChange={(e) => updC('count', Math.max(1, parseInt(e.target.value, 10) || 1))}
                  className="pmis-res-count-input" disabled={disabled} />
                <button type="button" className="pmis-res-count-btn" onClick={() => adjCount(1)} disabled={disabled}>+</button>
              </div></div>
            <div className="pmis-field"><label>Onboarding Date</label>
              <input type="date" value={resourceCount.onboardingDate || ''} onChange={(e) => updC('onboardingDate', e.target.value)} disabled={disabled} /></div>
            <div className="pmis-field"><label>Resource Division</label>
              <input value={resourceCount.division || ''} onChange={(e) => updC('division', e.target.value)} disabled={disabled} /></div>
          </div>
        </div>
      )}
    </div>
  );
}
