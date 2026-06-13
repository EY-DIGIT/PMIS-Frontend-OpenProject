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
        setPhone(String(found.phoneNumber || '').replace(/\D/g, '').slice(-10));
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
    if (!label.trim()) errs.label = 'Label is required';
    if (!email.trim()) errs.email = 'Email is required';
    else if (!/^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/.test(email.trim()))
      errs.email = 'Enter a valid email (e.g. name@example.com)';
    if (!phone.trim()) errs.phone = 'Mobile Number is required';
    else if (!/^\d{10}$/.test(phone.trim()))
      errs.phone = 'Enter a valid 10-digit mobile number';
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
          {/* Code is shown read-only on edit (it's the division's identifier);
              the Add form no longer collects it — it's derived from Label. */}
          {isEdit && (
            <div className="uidai-pmis-field">
              <label>Code</label>
              <input value={code} disabled maxLength={40} />
            </div>
          )}
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
              placeholder="e.g. name@example.com"
              value={email}
              onChange={(e) => { setEmail(e.target.value); clearFieldError('email'); }}
            />
            {errors.email && <div className="uidai-pmis-field-error">{errors.email}</div>}
          </div>
          <div className={errClass('phone')}>
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
                  clearFieldError('phone');
                }}
                onKeyPress={(e) => {
                  if (e.key.length === 1 && !/[0-9]/.test(e.key)) e.preventDefault();
                }}
              />
            </div>
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
