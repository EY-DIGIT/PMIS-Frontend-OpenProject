import React, { useState, useEffect, useRef } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import '../assets/css/ResetPassword.css';
import aadhaarLogo from '../assets/Aadhaar.png';
import * as auth from '../api/auth';

const ResetPassword = () => {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const tokenOrCode =
    searchParams.get('token') || searchParams.get('code') || '';

  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showNewPassword, setShowNewPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);

  const [submitError, setSubmitError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const newPwdRef = useRef(null);
  const confirmPwdRef = useRef(null);

  /* Validation rules — same as the HTML reference */
  const rules = [
    { id: 'r1', label: 'Minimum 12 characters', test: (v) => v.length >= 12 },
    { id: 'r2', label: 'Uppercase & lowercase letters', test: (v) => /[a-z]/.test(v) && /[A-Z]/.test(v) },
    { id: 'r3', label: 'At least 1 number', test: (v) => /\d/.test(v) },
    { id: 'r4', label: 'At least 1 special character', test: (v) => /[^A-Za-z0-9]/.test(v) }
  ];
  const ruleStates = rules.map((r) => ({ ...r, valid: r.test(newPassword) }));
  const allRulesValid = ruleStates.every((r) => r.valid);
  const passwordsMatch = confirmPassword.length > 0 && newPassword === confirmPassword;
  const showConfirmFeedback = confirmPassword.length > 0;
  const isButtonEnabled = allRulesValid && passwordsMatch;

  const toggleNewPassword = () => setShowNewPassword((v) => !v);
  const toggleConfirmPassword = () => setShowConfirmPassword((v) => !v);

  const handleReset = async (e) => {
    if (e && typeof e.preventDefault === 'function') e.preventDefault();
    if (submitting) return;
    if (!allRulesValid) {
      setSubmitError('Please satisfy all password requirements');
      return;
    }
    if (!passwordsMatch) {
      setSubmitError('Passwords do not match');
      return;
    }
    if (!tokenOrCode) {
      setSubmitError('Reset link is invalid or has expired. Please request a new one.');
      return;
    }
    setSubmitError('');
    setSubmitting(true);
    try {
      await auth.resetPassword({ tokenOrCode, newPassword });
      navigate('/login', {
        replace: true,
        state: { resetSuccess: true },
      });
    } catch (err) {
      setSubmitError(err?.message || 'Could not reset password. The link may have expired.');
    } finally {
      setSubmitting(false);
    }
  };

  /* Accessibility: text-size resizer (matches the reference). Uses CSS zoom
     when supported, falls back to a CSS transform. */
  const STEPS = [80, 90, 100, 110, 125];
  const DEFAULT_IDX = 2;
  const [zoomIdx, setZoomIdx] = useState(DEFAULT_IDX);

  useEffect(() => {
    const pct = STEPS[zoomIdx];
    const root = document.body;
    const supportsZoom = (() => {
      const probe = document.createElement('div');
      probe.style.zoom = '2';
      return probe.style.zoom === '2';
    })();
    if (supportsZoom) {
      root.style.zoom = (pct / 100).toString();
      root.style.transform = '';
      root.style.width = '';
    } else {
      root.style.transformOrigin = 'top left';
      root.style.transform = `scale(${pct / 100})`;
      root.style.width = `${(100 * 100) / pct}%`;
    }
    return () => {
      root.style.zoom = '';
      root.style.transform = '';
      root.style.width = '';
      root.style.transformOrigin = '';
    };
  }, [zoomIdx]);

  /* Eye icon SVG (open + slashed) */
  const EyeIcon = ({ isOpen }) => (
    isOpen ? (
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
        <path
          fill="currentColor"
          d="M2 5l17 17-1.5 1.5-3.2-3.2C13.5 20.8 12.8 21 12 21c-7 0-10-7-10-7a17.6 17.6 0 0 1 5.2-6.1L.5 6.5 2 5zm10 2c5.5 0 8.7 4.5 9.7 6-.4.6-1.3 1.9-2.7 3.2l-1.5-1.5A5 5 0 0 0 12 7zm0 3a2 2 0 0 1 2 2c0 .3-.1.6-.2.9l-2.7-2.7c.3-.1.6-.2.9-.2z"
        />
      </svg>
    ) : (
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
        <path
          fill="currentColor"
          d="M12 5c-7 0-10 7-10 7s3 7 10 7 10-7 10-7-3-7-10-7zm0 12a5 5 0 1 1 0-10 5 5 0 0 1 0 10zm0-8a3 3 0 1 0 0 6 3 3 0 0 0 0-6z"
        />
      </svg>
    )
  );

  return (
    <div className="uidai-rp-page">
      {/* HEADER */}
      <header className="site-header" role="banner">
        <div className="header-accessibility-strip">
          <span className="a11y-label" aria-hidden="true">Text Size:</span>
          <div className="font-resizer" role="group" aria-label="Adjust text size">
            <button
              type="button"
              className="fr-plus"
              aria-label="Increase text size"
              title="Increase text size"
              aria-pressed={zoomIdx === STEPS.length - 1}
              onClick={() => setZoomIdx((i) => Math.min(STEPS.length - 1, i + 1))}
            >+A</button>
            <button
              type="button"
              className="fr-reset"
              aria-label="Reset text size to default"
              title="Reset text size"
              aria-pressed={zoomIdx === DEFAULT_IDX}
              onClick={() => setZoomIdx(DEFAULT_IDX)}
            >A</button>
            <button
              type="button"
              className="fr-minus"
              aria-label="Decrease text size"
              title="Decrease text size"
              aria-pressed={zoomIdx === 0}
              onClick={() => setZoomIdx((i) => Math.max(0, i - 1))}
            >-A</button>
          </div>
        </div>
        <div className="header-main">
          <div className="header-brand">
            <img src={aadhaarLogo} alt="Aadhaar logo" />
            <div className="header-brand-text">
              <span className="header-brand-hi-1" lang="hi">मेरा आधार</span>
              <span className="header-brand-hi-2" lang="hi">मेरी पहचान</span>
            </div>
          </div>
          <h1 className="header-title">UIDAI Automation Governance Tool</h1>
          <div className="header-authority">
            Unique Identification<br />Authority of India
          </div>
        </div>
      </header>

      {/* MAIN */}
      <main className="uidai-rp-main" id="mainContent">
        <div className="uidai-rp-overlay">
          <div className="uidai-rp-card-reset">
            <div className="uidai-rp-card-head">
              <img src={aadhaarLogo} alt="Aadhaar" />
              <h1>Reset Password</h1>
              <div className="uidai-rp-sub">Create a secure new password</div>
            </div>

            <form onSubmit={handleReset} noValidate>
            {/* New Password */}
            <div className="uidai-rp-field">
              <label className="uidai-rp-label uidai-rp-required">New Password</label>
              <div className="uidai-rp-password-wrapper">
                <input
                  ref={newPwdRef}
                  type={showNewPassword ? 'text' : 'password'}
                  id="newpassword"
                  className="uidai-rp-input"
                  placeholder="Enter New Password"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  required
                />
                <button
                  type="button"
                  className="uidai-rp-eye-btn"
                  aria-label={showNewPassword ? 'Hide password' : 'Show password'}
                  aria-pressed={showNewPassword ? 'true' : 'false'}
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={toggleNewPassword}
                  style={{ display: newPassword ? 'flex' : 'none' }}
                >
                  <EyeIcon isOpen={showNewPassword} />
                </button>
              </div>
            </div>

            {/* Rules */}
            <ul className="uidai-rp-rules">
              {ruleStates.map((rule) => (
                <li
                  key={rule.id}
                  className={`uidai-rp-rule-item ${rule.valid ? 'uidai-rp-rule-valid' : ''}`}
                >
                  <span className="uidai-rp-rule-icon">{rule.valid ? '✔' : '❌'}</span>
                  {rule.label}
                </li>
              ))}
            </ul>

            {/* Confirm Password */}
            <div className="uidai-rp-field">
              <label className="uidai-rp-label uidai-rp-required">Confirm Password</label>
              <div className="uidai-rp-password-wrapper">
                <input
                  ref={confirmPwdRef}
                  type={showConfirmPassword ? 'text' : 'password'}
                  id="confirmpassword"
                  className="uidai-rp-input"
                  placeholder="Confirm Password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  required
                />
                <button
                  type="button"
                  className="uidai-rp-eye-btn"
                  aria-label={showConfirmPassword ? 'Hide password' : 'Show password'}
                  aria-pressed={showConfirmPassword ? 'true' : 'false'}
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={toggleConfirmPassword}
                  style={{ display: confirmPassword ? 'flex' : 'none' }}
                >
                  <EyeIcon isOpen={showConfirmPassword} />
                </button>
              </div>
              {showConfirmFeedback && (
                <div
                  className={`uidai-rp-confirm-msg ${passwordsMatch ? 'uidai-rp-confirm-valid' : ''}`}
                >
                  {passwordsMatch ? 'Passwords match' : 'Passwords do not match'}
                </div>
              )}
            </div>

            {submitError && (
              <div className="uidai-rp-submit-error">{submitError}</div>
            )}

            <button
              id="resetBtn"
              type="submit"
              className={`uidai-rp-btn ${isButtonEnabled ? 'uidai-rp-btn-enabled' : ''}`}
              disabled={!isButtonEnabled || submitting}
            >
              {submitting ? 'Resetting…' : 'Reset Password'}
            </button>
            </form>

            <div className="uidai-rp-footer">
              © 2026 UIDAI · PMIS Automation Tool · Internal Use Only
            </div>
          </div>
        </div>
      </main>
    </div>
  );
};

export default ResetPassword;
