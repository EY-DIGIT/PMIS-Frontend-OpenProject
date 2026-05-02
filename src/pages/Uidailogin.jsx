import React, { useState, useEffect, useRef } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import '../assets/css/UIDAILogin.css';
import aadhaarLogo from '../assets/Aadhaar.png';
import * as auth from '../api/auth';

const UIDAILogin = () => {
  const navigate = useNavigate();

  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [isLoginDisabled, setIsLoginDisabled] = useState(true);
  const [submitError, setSubmitError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const [usernameError, setUsernameError] = useState('');
  const [passwordError, setPasswordError] = useState('');
  const [usernameTouched, setUsernameTouched] = useState(false);
  const [passwordTouched, setPasswordTouched] = useState(false);

  const eyeButtonRef = useRef(null);

  /* Validation rules */
  const validateUsername = (v) => (v.trim() ? '' : 'Username is required');
  const validatePassword = (v) => (v ? '' : 'Password is required');

  /* Live-validate as the user types (only after they've touched the field) */
  useEffect(() => {
    const uErr = validateUsername(username);
    const pErr = validatePassword(password);
    if (usernameTouched) setUsernameError(uErr);
    if (passwordTouched) setPasswordError(pErr);
    setIsLoginDisabled(!(username && password && !uErr && !pErr));
  }, [username, password, usernameTouched, passwordTouched]);

  const togglePasswordVisibility = () => setShowPassword((v) => !v);

  const handleSubmit = async () => {
    setUsernameTouched(true);
    setPasswordTouched(true);
    setSubmitError('');

    const uErr = validateUsername(username);
    const pErr = validatePassword(password);
    setUsernameError(uErr);
    setPasswordError(pErr);
    if (uErr || pErr) return;

    setSubmitting(true);
    try {
      await auth.login({ login: username.trim(), password });
      sessionStorage.setItem('uidai_user', username);
      sessionStorage.setItem('uidai_loggedIn', 'true');
      navigate('/');
    } catch (err) {
      setSubmitError(err?.message || 'Login failed. Please try again.');
    } finally {
      setSubmitting(false);
    }
  };

  /* Accessibility: text-size resizer (matches the reference's font-resizer
     control). Uses CSS zoom when supported, falls back to a CSS transform. */
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

  return (
    <div className="uidai-login-page">
      {/* HEADER */}
      <header className="uidai-site-header" role="banner">
        <div className="uidai-a11y-strip">
          <span className="uidai-a11y-label" aria-hidden="true">Text Size:</span>
          <div className="uidai-font-resizer" role="group" aria-label="Adjust text size">
            <button
              type="button"
              aria-label="Increase text size"
              title="Increase text size"
              aria-pressed={zoomIdx === STEPS.length - 1}
              onClick={() => setZoomIdx((i) => Math.min(STEPS.length - 1, i + 1))}
              style={{ fontSize: 15 }}
            >+A</button>
            <button
              type="button"
              aria-label="Reset text size to default"
              title="Reset text size"
              aria-pressed={zoomIdx === DEFAULT_IDX}
              onClick={() => setZoomIdx(DEFAULT_IDX)}
              style={{ fontSize: 13 }}
            >A</button>
            <button
              type="button"
              aria-label="Decrease text size"
              title="Decrease text size"
              aria-pressed={zoomIdx === 0}
              onClick={() => setZoomIdx((i) => Math.max(0, i - 1))}
              style={{ fontSize: 11 }}
            >-A</button>
          </div>
        </div>
        <div className="uidai-header-main">
          <div className="uidai-header-brand">
            <img src={aadhaarLogo} alt="Aadhaar logo" />
            <div className="uidai-header-brand-text">
              <span className="uidai-header-brand-hi-1" lang="hi">मेरा आधार</span>
              <span className="uidai-header-brand-hi-2" lang="hi">मेरी पहचान</span>
            </div>
          </div>
          <h1 className="uidai-header-title">UIDAI Automation Governance Tool</h1>
          <div className="uidai-header-authority">
            Unique Identification<br />Authority of India
          </div>
        </div>
      </header>

      {/* MAIN */}
      <main className="uidai-main" id="mainContent">
        <div className="uidai-overlay">
          <div className="uidai-card">
            <div className="uidai-card-head">
              <img src={aadhaarLogo} alt="Aadhaar" />
              <h1>UIDAI PMIS Secure Login</h1>
              <div className="uidai-sub">Authorized access only</div>
            </div>

            <div className="uidai-tabs">
              <div className="uidai-tab uidai-tab-active">User Login</div>
              <div className="uidai-tab">Admin Login</div>
            </div>

            {/* Username */}
            <div className="uidai-field">
              <label className="uidai-label uidai-required">Username</label>
              <input
                type="text"
                id="username"
                className={`uidai-input ${usernameTouched && usernameError ? 'uidai-input-error' : ''}`}
                placeholder="Enter Username"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                onBlur={() => setUsernameTouched(true)}
              />
              {usernameTouched && usernameError && (
                <div className="uidai-error-msg">{usernameError}</div>
              )}
            </div>

            {/* Password */}
            <div className="uidai-field">
              <label className="uidai-label uidai-required">Password</label>
              <div className="uidai-password-wrapper">
                <input
                  type={showPassword ? 'text' : 'password'}
                  id="password"
                  className={`uidai-input ${passwordTouched && passwordError ? 'uidai-input-error' : ''}`}
                  placeholder="Enter Password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  onBlur={() => setPasswordTouched(true)}
                />
                <button
                  type="button"
                  className="uidai-eye-btn"
                  ref={eyeButtonRef}
                  aria-label={showPassword ? 'Hide password' : 'Show password'}
                  aria-pressed={showPassword ? 'true' : 'false'}
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={togglePasswordVisibility}
                  style={{ display: password ? 'flex' : 'none' }}
                >
                  {showPassword ? (
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
                  )}
                </button>
              </div>
              {passwordTouched && passwordError && (
                <div className="uidai-error-msg">{passwordError}</div>
              )}
            </div>

            {submitError && (
              <div className="uidai-error-msg" style={{ marginBottom: 8 }}>{submitError}</div>
            )}

            <button
              className="uidai-btn-primary"
              id="loginBtn"
              disabled={isLoginDisabled || submitting}
              onClick={handleSubmit}
            >
              {submitting ? 'Signing In…' : 'Sign In'}
            </button>

            <div className="uidai-links">
              <Link to="/reset-password">Forgot Password?</Link>
              <a href="#help">Help</a>
            </div>

            <div className="uidai-footer">
              © 2026 UIDAI · PMIS Automation Tool · Internal Use Only
            </div>
          </div>
        </div>
      </main>
    </div>
  );
};

export default UIDAILogin;
