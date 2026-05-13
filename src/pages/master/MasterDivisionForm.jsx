import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { tokenStore } from '../../api/client';
import * as divisionsApi from '../../api/divisions';
import { uiStore } from '../../store/project/uiStore';

export default function MasterDivisionForm() {
  const navigate = useNavigate();
  const { code: codeParam } = useParams();
  const isEdit = !!codeParam;

  const [code, setCode] = useState('');
  const [label, setLabel] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [active, setActive] = useState(true);
  const [isBuiltin, setIsBuiltin] = useState(false);

  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [errors, setErrors] = useState({});

  const errClass = (field) => (errors[field] ? 'uidai-pmis-field uidai-pmis-has-error' : 'uidai-pmis-field');
  function clearFieldError(field) {
    setErrors((prev) => {
      if (!prev[field]) return prev;
      const next = { ...prev };
      delete next[field];
      return next;
    });
  }

  useEffect(() => {
    if (!isEdit) return;
    if (!tokenStore.get()) return;
    let cancelled = false;
    setLoading(true);
    (async () => {
      try {
        const all = await divisionsApi.list();
        if (cancelled) return;
        const found = all.find((d) => d.code === codeParam);
        if (!found) {
          setError('Division not found');
          return;
        }
        setCode(found.code);
        setLabel(found.label);
        setEmail(found.email || '');
        setPhone(found.phoneNumber || '');
        setActive(!!found.active);
        setIsBuiltin(!!found.isBuiltin);
      } catch (err) {
        setError(err?.message || 'Failed to load division');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [isEdit, codeParam]);

  function validate() {
    const errs = {};
    if (!isEdit && !code.trim()) errs.code = 'Code is required';
    else if (!isEdit && !/^[a-zA-Z0-9_-]+$/.test(code.trim()))
      errs.code = 'Only letters, numbers, dash and underscore';
    if (!label.trim()) errs.label = 'Label is required';
    if (!email.trim()) errs.email = 'Email is required';
    else if (!/^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/.test(email.trim()))
      errs.email = 'Enter a valid email';
    if (!phone.trim()) errs.phone = 'Phone is required';
    else if (!/^\+?\d{10,15}$/.test(phone.trim()))
      errs.phone = 'Enter a valid phone (digits only, 10-15)';
    return errs;
  }

  async function handleSubmit() {
    const errs = validate();
    setErrors(errs);
    const list = Object.values(errs);
    if (list.length) {
      uiStore.showError(`Please fix the highlighted fields\n• ${list.join('\n• ')}`);
      return;
    }
    setError('');
    setSubmitting(true);
    try {
      if (isEdit) {
        // Built-in divisions: backend allows only email + phone updates
        const body = isBuiltin
          ? { email: email.trim(), phone_number: phone.trim() }
          : {
              label: label.trim(),
              email: email.trim(),
              phone_number: phone.trim(),
            };
        await divisionsApi.update(code, body);
      } else {
        await divisionsApi.create({
          code: code.trim(),
          label: label.trim(),
          email: email.trim(),
          phone_number: phone.trim(),
        });
      }
      uiStore.showMessage(
        isEdit ? 'Division updated successfully' : 'Division added successfully',
        () => navigate('/master/divisions')
      );
    } catch (err) {
      const msg = err?.message || (isEdit ? 'Failed to update division' : 'Failed to add division');
      setError(msg);
      uiStore.showError(msg);
    } finally {
      setSubmitting(false);
    }
  }

  if (loading) {
    return (
      <div className="uidai-pmis-card">
        <p className="uidai-pmis-subtitle">Loading division…</p>
      </div>
    );
  }

  return (
    <>
      <div className="uidai-pmis-card">
        <h3>{isEdit ? `Edit Division${isBuiltin ? ' (Built-in)' : ''}` : 'Add Division'}</h3>
        {isBuiltin && (
          <div style={{ background: '#fdf3ee', border: '1px solid #fae0d2', color: '#a8390a', padding: '8px 12px', borderRadius: 6, fontSize: 13, margin: '8px 0 16px' }}>
            🔒 This is a built-in division. Code and label are locked. Only email and phone may be updated.
          </div>
        )}
        <br />
        <div className="uidai-pmis-grid-4">
          <div className={errClass('code')}>
            <label>Code <span className="uidai-pmis-required">*</span></label>
            <input
              placeholder="e.g. tmd3"
              value={code}
              onChange={(e) => { setCode(e.target.value); clearFieldError('code'); }}
              disabled={isEdit}
              maxLength={40}
            />
            {errors.code && <div className="uidai-pmis-field-error">{errors.code}</div>}
          </div>
          <div className={errClass('label')}>
            <label>Label <span className="uidai-pmis-required">*</span></label>
            <input
              placeholder="e.g. TMD3"
              value={label}
              onChange={(e) => { setLabel(e.target.value); clearFieldError('label'); }}
              disabled={isEdit && isBuiltin}
              maxLength={120}
            />
            {errors.label && <div className="uidai-pmis-field-error">{errors.label}</div>}
          </div>
          {isEdit && (
            <div className="uidai-pmis-field">
              <label>Status</label>
              <input value={active ? 'Active' : 'Inactive'} disabled />
            </div>
          )}
          <div className={errClass('email')}>
            <label>Email <span className="uidai-pmis-required">*</span></label>
            <input
              type="email"
              placeholder="e.g. division@uidai.gov.in"
              value={email}
              onChange={(e) => { setEmail(e.target.value); clearFieldError('email'); }}
            />
            {errors.email && <div className="uidai-pmis-field-error">{errors.email}</div>}
          </div>
          <div className={errClass('phone')}>
            <label>Phone Number <span className="uidai-pmis-required">*</span></label>
            <input
              type="tel"
              placeholder="e.g. 9876543210 or +919876543210"
              value={phone}
              onChange={(e) => { setPhone(e.target.value); clearFieldError('phone'); }}
              maxLength={20}
            />
            {errors.phone && <div className="uidai-pmis-field-error">{errors.phone}</div>}
          </div>
        </div>
        {error && <div className="uidai-error-msg" style={{ marginTop: 8 }}>{error}</div>}
        <div className="uidai-pmis-action-row">
          <button className="uidai-pmis-btn" onClick={handleSubmit} disabled={submitting}>
            {submitting ? (isEdit ? 'Saving…' : 'Adding…') : (isEdit ? 'Save' : 'Add')}
          </button>
          <button
            className="uidai-pmis-btn uidai-pmis-btn-cancel"
            onClick={() => navigate('/master/divisions')}
            disabled={submitting}
          >
            Cancel
          </button>
        </div>
      </div>
    </>
  );
}
