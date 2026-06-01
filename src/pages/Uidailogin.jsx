import React, { useState, useEffect, useRef } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import '../assets/css/UIDAILogin.css';
import aadhaarLogo from '../assets/Aadhaar.png';
import * as auth from '../api/auth';

const RESEND_COOLDOWN_SECONDS = 60;

const UIDAILogin = () => {
  const navigate = useNavigate();

  const [step, setStep] = useState('creds');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [submitError, setSubmitError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const [usernameError, setUsernameError] = useState('');
  const [passwordError, setPasswordError] = useState('');
  const [usernameTouched, setUsernameTouched] = useState(false);
  const [passwordTouched, setPasswordTouched] = useState(false);

  const [ephemeralToken, setEphemeralToken] = useState('');
  const [channels, setChannels] = useState({});
  const [otpChannel, setOtpChannel] = useState('email');
  const [otp, setOtp] = useState('');
  const [otpError, setOtpError] = useState('');
  const [resendIn, setResendIn] = useState(0);

  const eyeButtonRef = useRef(null);
  const otpInputRef = useRef(null);

  const validateUsername = (v) => (v.trim() ? '' : 'Username is required');
  const validatePassword = (v) => (v ? '' : 'Password is required');

  useEffect(() => {
    const uErr = validateUsername(username);
    const pErr = validatePassword(password);
    if (usernameTouched) setUsernameError(uErr);
    if (passwordTouched) setPasswordError(pErr);
  }, [username, password, usernameTouched, passwordTouched]);

  const isStep1Disabled =
    !username || !password || !!validateUsername(username) || !!validatePassword(password);
  const isOtpDisabled = otp.length !== 6;

  useEffect(() => {
    if (resendIn <= 0) return undefined;
    const t = setTimeout(() => setResendIn((n) => n - 1), 1000);
    return () => clearTimeout(t);
  }, [resendIn]);

  useEffect(() => {
    if (step === 'otp' && otpInputRef.current) otpInputRef.current.focus();
  }, [step]);

  const togglePasswordVisibility = () => setShowPassword((v) => !v);

  const handleSendOtp = async () => {
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
      const res = await auth.login({ login: username.trim(), password });
      if (res?.requiresOtp) {
        setEphemeralToken(res.ephemeralToken);
        setChannels(res.channelsAvailable || {});
        const channel =
          res.channelsAvailable?.email
            ? 'email'
            : res.channelsAvailable?.sms
            ? 'sms'
            : 'email';
        setOtpChannel(channel);
        await auth.sendOtp({ ephemeralToken: res.ephemeralToken, channel });
        setStep('otp');
        setResendIn(RESEND_COOLDOWN_SECONDS);
      } else {
        sessionStorage.setItem('uidai_user', username);
        sessionStorage.setItem('uidai_loggedIn', 'true');
        navigate('/');
      }
    } catch (err) {
      setSubmitError(err?.message || 'Login failed. Please try again.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleVerifyOtp = async () => {
    setOtpError('');
    if (otp.length !== 6) {
      setOtpError('Please enter the 6-digit OTP');
      return;
    }
    setSubmitting(true);
    try {
      await auth.verifyOtp({ ephemeralToken, code: otp });
      sessionStorage.setItem('uidai_user', username);
      sessionStorage.setItem('uidai_loggedIn', 'true');
      navigate('/');
    } catch (err) {
      setOtpError(err?.message || 'Invalid OTP. Please try again.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleResendOtp = async () => {
    if (resendIn > 0 || !ephemeralToken) return;
    setOtpError('');
    setSubmitting(true);
    try {
      await auth.sendOtp({ ephemeralToken, channel: otpChannel });
      setResendIn(RESEND_COOLDOWN_SECONDS);
    } catch (err) {
      setOtpError(err?.message || 'Could not resend OTP. Please try again.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleBackToCreds = () => {
    setStep('creds');
    setOtp('');
    setOtpError('');
    setEphemeralToken('');
    setResendIn(0);
  };

  /* Accessibility: text-size resizer */
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

  const channelMobile = channels?.sms || channels?.mobile || channels?.phone;
  const channelEmail = channels?.email;

  // Floating header: collapse the a11y (text-size) strip once the user
  // scrolls past a small threshold so only the brand bar stays pinned
  // at the top. Mirrors the PMIS Project Management reference behavior.
  // Hysteresis: hide above 28px, reveal back below 4px — avoids jitter
  // when scroll position oscillates near the boundary.
  const [a11yCollapsed, setA11yCollapsed] = useState(false);
  useEffect(() => {
    const HIDE_AT = 28;
    const SHOW_AT = 4;
    const overlay = document.querySelector('.uidai-overlay');
    let ticking = false;
    let hidden = false;
    const update = () => {
      const top = Math.max(overlay?.scrollTop || 0, window.scrollY || 0);
      if (!hidden && top > HIDE_AT) {
        hidden = true;
        setA11yCollapsed(true);
      } else if (hidden && top < SHOW_AT) {
        hidden = false;
        setA11yCollapsed(false);
      }
      ticking = false;
    };
    const onScroll = () => {
      if (!ticking) {
        window.requestAnimationFrame(update);
        ticking = true;
      }
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    if (overlay) overlay.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      window.removeEventListener('scroll', onScroll);
      if (overlay) overlay.removeEventListener('scroll', onScroll);
    };
  }, []);

  return (
    <div className="uidai-login-page">
      <header className="site-header" role="banner">
        <div className={`header-accessibility-strip${a11yCollapsed ? ' collapsed' : ''}`}>
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

      <main className="uidai-main" id="mainContent">
        <div className="uidai-overlay">
          <div className="uidai-card-loginfix">
            <div className="uidai-card-head">
              <img src={aadhaarLogo} alt="Aadhaar" />
              <h1>UIDAI PMIS Secure Login</h1>
              <div className="uidai-sub">Authorized access only</div>
            </div>

            <div className="uidai-tabs">
              <div className="uidai-tab uidai-tab-active">User Login</div>
              <div className="uidai-tab">Admin Login</div>
            </div>

            {step === 'creds' && (
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  if (isStep1Disabled || submitting) return;
                  handleSendOtp();
                }}
                noValidate
              >
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
                  type="submit"
                  className="uidai-btn-primary"
                  id="sendOtpBtn"
                  disabled={isStep1Disabled || submitting}
                >
                  {submitting ? 'Please wait…' : 'Send OTP'}
                </button>
              </form>
            )}

            {step === 'otp' && (
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  if (isOtpDisabled || submitting) return;
                  handleVerifyOtp();
                }}
                noValidate
              >
                <div className="uidai-otp-sent-box">
                  <strong>✓ OTP sent successfully</strong>
                  {channelMobile && (
                    <>Mobile: <span>{channelMobile}</span><br /></>
                  )}
                  {channelEmail && (
                    <>Email: <span>{channelEmail}</span></>
                  )}
                </div>

                <div className="uidai-field">
                  <label className="uidai-label uidai-required">Enter 6-digit OTP</label>
                  <input
                    ref={otpInputRef}
                    type="password"
                    id="otp"
                    className={`uidai-input ${otpError ? 'uidai-input-error' : ''}`}
                    maxLength={6}
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    placeholder="••••••"
                    value={otp}
                    onChange={(e) => setOtp(e.target.value.replace(/\D/g, '').slice(0, 6))}
                  />
                  {otpError && <div className="uidai-error-msg">{otpError}</div>}
                </div>

                <button
                  type="submit"
                  className="uidai-btn-primary"
                  id="loginBtn"
                  disabled={isOtpDisabled || submitting}
                >
                  {submitting ? 'Signing In…' : 'Sign In'}
                </button>

                <div className="uidai-otp-actions">
                  <button
                    type="button"
                    className="uidai-link-btn"
                    onClick={handleBackToCreds}
                    disabled={submitting}
                  >
                    ← Back
                  </button>
                  <button
                    type="button"
                    className="uidai-link-btn"
                    onClick={handleResendOtp}
                    disabled={resendIn > 0 || submitting}
                  >
                    {resendIn > 0 ? `Resend OTP in ${resendIn}s` : 'Resend OTP'}
                  </button>
                </div>
              </form>
            )}

            <div className="uidai-links">
              <Link to="/forgot-password">Forgot Password?</Link>
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
