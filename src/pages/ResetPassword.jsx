import React, { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import '../assets/css/ResetPassword.css'; // Assuming you have a CSS file for styling
import logo from '../assets/logo.avif';
import aadhaarLogo from '../assets/Aadhaar.png';
const ResetPassword = () => {
  const navigate = useNavigate();

  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showNewPassword, setShowNewPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);

  // Touched states
  const [newPasswordTouched, setNewPasswordTouched] = useState(false);
  const [confirmTouched, setConfirmTouched] = useState(false);

  // Submit error
  const [submitError, setSubmitError] = useState('');

  const newPwdRef = useRef(null);
  const confirmPwdRef = useRef(null);

  /* ===== VALIDATION RULES ===== */
  const rules = [
    {
      id: 'r1',
      label: 'Minimum 12 characters',
      test: (v) => v.length >= 12,
    },
    {
      id: 'r2',
      label: 'Uppercase & lowercase letters',
      test: (v) => /[a-z]/.test(v) && /[A-Z]/.test(v),
    },
    {
      id: 'r3',
      label: 'At least 1 number',
      test: (v) => /\d/.test(v),
    },
    {
      id: 'r4',
      label: 'At least 1 special character',
      test: (v) => /[^A-Za-z0-9]/.test(v),
    },
  ];

  // Compute rule validity
  const ruleStates = rules.map((r) => ({
    ...r,
    valid: r.test(newPassword),
  }));

  const allRulesValid = ruleStates.every((r) => r.valid);
  const passwordsMatch =
    confirmPassword.length > 0 && newPassword === confirmPassword;
  const showConfirmFeedback = confirmPassword.length > 0;

  // Enable button only when everything is valid
  const isButtonEnabled = allRulesValid && passwordsMatch;

  /* ===== PASSWORD TOGGLES ===== */
  const toggleNewPassword = () => setShowNewPassword((prev) => !prev);
  const toggleConfirmPassword = () => setShowConfirmPassword((prev) => !prev);

  /* ===== SUBMIT ===== */
  const handleReset = () => {
    setNewPasswordTouched(true);
    setConfirmTouched(true);

    if (!allRulesValid) {
      setSubmitError('Please satisfy all password requirements');
      return;
    }

    if (!passwordsMatch) {
      setSubmitError('Passwords do not match');
      return;
    }

    setSubmitError('');

    // Success — navigate to login
    alert('Password reset successful! Please login with new credentials.');
    navigate('/login');
  };

  // Eye SVG (reusable)
  const EyeIcon = ({ isOpen }) => (
    <>
      <svg
        xmlns="http://www.w3.org/2000/svg"
        viewBox="0 0 24 24"
        width="20"
        height="20"
        style={{ display: isOpen ? 'none' : 'block' }}
      >
        <path
          fill="currentColor"
          d="M12 5c-7 0-10 7-10 7s3 7 10 7 10-7 10-7-3-7-10-7zm0 12a5 5 0 1 1 0-10 5 5 0 0 1 0 10zm0-8a3 3 0 1 0 0 6 3 3 0 0 0 0-6z"
        />
      </svg>
      <svg
        xmlns="http://www.w3.org/2000/svg"
        viewBox="0 0 24 24"
        width="20"
        height="20"
        style={{ display: isOpen ? 'block' : 'none' }}
      >
        <path
          fill="currentColor"
          d="M2 5l17 17-1.5 1.5-3.2-3.2C13.5 20.8 12.8 21 12 21c-7 0-10-7-10-7a17.6 17.6 0 0 1 5.2-6.1L.5 6.5 2 5zm10 2c5.5 0 8.7 4.5 9.7 6-.4.6-1.3 1.9-2.7 3.2l-1.5-1.5A5 5 0 0 0 12 7zm0 3a2 2 0 0 1 2 2c0 .3-.1.6-.2.9l-2.7-2.7c.3-.1.6-.2.9-.2z"
        />
      </svg>
    </>
  );

  return (
    <>
      {/* HEADER */}
      <div className="uidai-rp-header">
        <img src={logo} alt="Logo" />
        <div>
          <strong className="uidai-rp-header-title">
            UIDAI Automation Governance Tool
          </strong>
        </div>
        <img src={aadhaarLogo} alt="Government of India" />
      </div>

      {/* MAIN */}
      <div className="uidai-rp-main">
        <div className="uidai-rp-overlay">
          <div className="uidai-rp-card">
            {/* CARD HEAD */}
            <div className="uidai-rp-card-head">
              <img src={aadhaarLogo} alt="Aadhaar" />
              <h1>Reset Password</h1>
              <div className="uidai-rp-sub">Create a secure new password</div>
            </div>

            {/* NEW PASSWORD */}
            <div className="uidai-rp-field">
              <label className="uidai-rp-label uidai-rp-required">
                New Password
              </label>
              <div className="uidai-rp-password-wrapper">
                <input
                  ref={newPwdRef}
                  type={showNewPassword ? 'text' : 'password'}
                  id="newpassword"
                  className="uidai-rp-input"
                  placeholder="Enter New Password"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  onBlur={() => setNewPasswordTouched(true)}
                  required
                />
                <button
                  type="button"
                  className="uidai-rp-eye-btn"
                  aria-label={
                    showNewPassword ? 'Hide password' : 'Show password'
                  }
                  aria-pressed={showNewPassword ? 'true' : 'false'}
                  onClick={toggleNewPassword}
                  style={{ display: newPassword ? 'block' : 'none' }}
                >
                  <EyeIcon isOpen={showNewPassword} />
                </button>
              </div>
            </div>

            {/* PASSWORD RULES */}
            <ul className="uidai-rp-rules">
              {ruleStates.map((rule) => (
                <li
                  key={rule.id}
                  className={`uidai-rp-rule-item ${
                    rule.valid ? 'uidai-rp-rule-valid' : ''
                  }`}
                >
                  <span className="uidai-rp-rule-icon">
                    {rule.valid ? '✔' : '❌'}
                  </span>
                  {rule.label}
                </li>
              ))}
            </ul>

            {/* CONFIRM PASSWORD */}
            <div className="uidai-rp-field">
              <label className="uidai-rp-label uidai-rp-required">
                Confirm Password
              </label>
              <div className="uidai-rp-password-wrapper">
                <input
                  ref={confirmPwdRef}
                  type={showConfirmPassword ? 'text' : 'password'}
                  id="confirmpassword"
                  className="uidai-rp-input"
                  placeholder="Confirm Password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  onBlur={() => setConfirmTouched(true)}
                  required
                />
                <button
                  type="button"
                  className="uidai-rp-eye-btn"
                  aria-label={
                    showConfirmPassword ? 'Hide password' : 'Show password'
                  }
                  aria-pressed={showConfirmPassword ? 'true' : 'false'}
                  onClick={toggleConfirmPassword}
                  style={{ display: confirmPassword ? 'block' : 'none' }}
                >
                  <EyeIcon isOpen={showConfirmPassword} />
                </button>
              </div>

              {showConfirmFeedback && (
                <div
                  className={`uidai-rp-confirm-msg ${
                    passwordsMatch ? 'uidai-rp-confirm-valid' : ''
                  }`}
                >
                  {passwordsMatch
                    ? 'Passwords match'
                    : 'Passwords do not match'}
                </div>
              )}
            </div>

            {/* SUBMIT ERROR */}
            {submitError && (
              <div className="uidai-rp-submit-error">{submitError}</div>
            )}

            {/* RESET BUTTON */}
            <button
              id="resetBtn"
              className={`uidai-rp-btn ${
                isButtonEnabled ? 'uidai-rp-btn-enabled' : ''
              }`}
              onClick={handleReset}
              disabled={!isButtonEnabled}
            >
              Reset Password
            </button>

            <div className="uidai-rp-footer">
              © 2026 UIDAI · PMIS Automation Tool · Internal Use Only
            </div>
          </div>
        </div>
      </div>
    </>
  );
};

export default ResetPassword;