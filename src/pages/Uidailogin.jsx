import React, { useState, useEffect, useRef } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import '../assets/css/UIDAILogin.css'; // Assuming you have a CSS file for styling
import logo from '../assets/logo.avif';
import aadhaarLogo from '../assets/Aadhaar.png';
const UIDAILogin = () => {
  const navigate = useNavigate();

  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [isLoginDisabled, setIsLoginDisabled] = useState(true);

  // Validation error states
  const [usernameError, setUsernameError] = useState('');
  const [passwordError, setPasswordError] = useState('');

  // Touched states (show errors only after user interacts)
  const [usernameTouched, setUsernameTouched] = useState(false);
  const [passwordTouched, setPasswordTouched] = useState(false);

  const eyeButtonRef = useRef(null);

  /* ===== VALIDATION RULES ===== */
  const validateUsername = (value) => {
    if (!value.trim()) {
      return 'Username is required';
    }
    if (value.length < 4) {
      return 'Username must be at least 4 characters';
    }
    if (value.length > 20) {
      return 'Username must not exceed 20 characters';
    }
    if (!/^[a-zA-Z0-9_.]+$/.test(value)) {
      return 'Only letters, numbers, underscore and dot allowed';
    }
    return '';
  };

  const validatePassword = (value) => {
    if (!value) {
      return 'Password is required';
    }
    if (value.length < 8) {
      return 'Password must be at least 8 characters';
    }
    if (!/[A-Z]/.test(value)) {
      return 'Must contain at least one uppercase letter';
    }
    if (!/[a-z]/.test(value)) {
      return 'Must contain at least one lowercase letter';
    }
    if (!/[0-9]/.test(value)) {
      return 'Must contain at least one number';
    }
    if (!/[!@#$%^&*(),.?":{}|<>_\-+=]/.test(value)) {
      return 'Must contain at least one special character';
    }
    return '';
  };

  /* ===== LIVE VALIDATION ===== */
  useEffect(() => {
    const uErr = validateUsername(username);
    const pErr = validatePassword(password);

    if (usernameTouched) setUsernameError(uErr);
    if (passwordTouched) setPasswordError(pErr);

    setIsLoginDisabled(!(username && password && !uErr && !pErr));
  }, [username, password, usernameTouched, passwordTouched]);

  /* ===== PASSWORD EYE TOGGLE ===== */
  const togglePasswordVisibility = () => {
    setShowPassword((prev) => !prev);
  };

  /* ===== FORM SUBMIT ===== */
  const handleSubmit = () => {
    setUsernameTouched(true);
    setPasswordTouched(true);

    const uErr = validateUsername(username);
    const pErr = validatePassword(password);

    setUsernameError(uErr);
    setPasswordError(pErr);

    if (!uErr && !pErr) {
      // Save login info (simple session)
      sessionStorage.setItem('uidai_user', username);
      sessionStorage.setItem('uidai_loggedIn', 'true');

      // Navigate to home page
      navigate('/home');
    }
  };

  return (
    <>
      {/* HEADER */}
      <div className="uidai-header">
        <img src={logo} alt="Logo" />
        <div>
          <strong className="uidai-header-title">
            UIDAI Automation Governance Tool
          </strong>
        </div>
        <img src={aadhaarLogo} alt="Government of India" />
      </div>

      {/* MAIN */}
      <div className="uidai-main">
        <div className="uidai-overlay">
          <div className="uidai-card">
            <div className="uidai-card-head">
              <img src={aadhaarLogo} alt="Aadhaar" />
              <h1>UIDAI PMIS Secure Login</h1>
              <div className="uidai-sub">Authorized access only</div>
            </div>

            <div className="uidai-tabs">
              <div className="uidai-tab uidai-tab-active" id="userTab">
                User Login
              </div>
              <div className="uidai-tab" id="adminTab">
                Admin Login
              </div>
            </div>

            {/* USERNAME FIELD */}
            <div className="uidai-field">
              <label className="uidai-label uidai-required">Username</label>
              <input
                type="text"
                id="username"
                className={`uidai-input ${
                  usernameTouched && usernameError ? 'uidai-input-error' : ''
                }`}
                placeholder="Enter Username"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                onBlur={() => setUsernameTouched(true)}
              />
              {usernameTouched && usernameError && (
                <div className="uidai-error-msg">{usernameError}</div>
              )}
            </div>

            {/* PASSWORD FIELD */}
            <div className="uidai-field">
              <div className="uidai-password-wrapper">
                <label className="uidai-label uidai-required">Password</label>
                <input
                  type={showPassword ? 'text' : 'password'}
                  id="password"
                  className={`uidai-input ${
                    passwordTouched && passwordError ? 'uidai-input-error' : ''
                  }`}
                  placeholder="Enter Password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  onBlur={() => setPasswordTouched(true)}
                />

                <button
                  type="button"
                  className="uidai-eye-btn"
                  id="eye"
                  ref={eyeButtonRef}
                  aria-label={showPassword ? 'Hide password' : 'Show password'}
                  aria-pressed={showPassword ? 'true' : 'false'}
                  onClick={togglePasswordVisibility}
                  style={{ display: password ? 'block' : 'none' }}
                >
                  <svg
                    id="eyeOpen"
                    xmlns="http://www.w3.org/2000/svg"
                    viewBox="0 0 24 24"
                    width="20"
                    height="20"
                    style={{ display: showPassword ? 'none' : 'block' }}
                  >
                    <path
                      fill="currentColor"
                      d="M12 5c-7 0-10 7-10 7s3 7 10 7 10-7 10-7-3-7-10-7zm0 12a5 5 0 1 1 0-10 5 5 0 0 1 0 10zm0-8a3 3 0 1 0 0 6 3 3 0 0 0 0-6z"
                    />
                  </svg>

                  <svg
                    id="eyeClosed"
                    xmlns="http://www.w3.org/2000/svg"
                    viewBox="0 0 24 24"
                    width="20"
                    height="20"
                    style={{ display: showPassword ? 'block' : 'none' }}
                  >
                    <path
                      fill="currentColor"
                      d="M2 5l17 17-1.5 1.5-3.2-3.2C13.5 20.8 12.8 21 12 21c-7 0-10-7-10-7a17.6 17.6 0 0 1 5.2-6.1L.5 6.5 2 5zm10 2c5.5 0 8.7 4.5 9.7 6-.4.6-1.3 1.9-2.7 3.2l-1.5-1.5A5 5 0 0 0 12 7zm0 3a2 2 0 0 1 2 2c0 .3-.1.6-.2.9l-2.7-2.7c.3-.1.6-.2.9-.2z"
                    />
                  </svg>
                </button>
              </div>
              {passwordTouched && passwordError && (
                <div className="uidai-error-msg">{passwordError}</div>
              )}
            </div>

            <button
              className="uidai-btn-primary"
              id="loginBtn"
              disabled={isLoginDisabled}
              onClick={handleSubmit}
            >
              Sign In
            </button>

            <div className="uidai-links">
              <Link to="/reset-password">Forgot Password?</Link>
              <a href="#">Help</a>
            </div>

            <div className="uidai-footer">
              © 2026 UIDAI · PMIS Automation Tool · Internal Use Only
            </div>
          </div>
        </div>
      </div>
    </>
  );
};

export default UIDAILogin;