import React, { useState, useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import '../assets/css/UIDAILogin.css';
import aadhaarLogo from '../assets/Aadhaar.png';
import * as auth from '../api/auth';

const ForgotPassword = () => {
  const navigate = useNavigate();

  const [identifier, setIdentifier] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState('');
  const [sent, setSent] = useState(false);

  const isDisabled = !identifier.trim() || submitting;

  const handleSend = async (e) => {
    if (e && typeof e.preventDefault === 'function') e.preventDefault();
    if (submitting) return;
    setSubmitError('');
    if (!identifier.trim()) return;
    setSubmitting(true);
    try {
      await auth.forgotPassword({
        loginOrEmail: identifier.trim(),
        channel: 'email',
      });
      setSent(true);
    } catch (err) {
      setSubmitError(err?.message || 'Could not send reset link. Please try again.');
    } finally {
      setSubmitting(false);
    }
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

  return (
    <div className="uidai-login-page">
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

      <main className="uidai-main" id="mainContent">
        <div className="uidai-overlay">
          <div className="uidai-card-loginfix">
            <div className="uidai-card-head">
              <img src={aadhaarLogo} alt="Aadhaar" />
              <h1>UIDAI PMIS Reset Password Link</h1>
              <div className="uidai-sub">Authorized access only</div>
            </div>

            {sent ? (
              <>
                <div className="uidai-otp-sent-box">
                  <strong>✓ Request received</strong>
                  If an account matches that username, a reset link has been sent.
                  Please check your registered email.
                </div>
                {/* <button
                  className="uidai-btn-primary"
                  onClick={() => navigate('/login')}
                >
                  Back to Login
                </button> */}
              </>
            ) : (
              <form onSubmit={handleSend} noValidate>
                <div className="uidai-field">
                  <label className="uidai-label uidai-required">Username</label>
                  <input
                    type="text"
                    id="forgot-identifier"
                    className="uidai-input"
                    placeholder="Enter Username or Email"
                    value={identifier}
                    onChange={(e) => setIdentifier(e.target.value)}
                  />
                </div>

                {submitError && (
                  <div className="uidai-error-msg" style={{ marginBottom: 8 }}>{submitError}</div>
                )}

                <button
                  className="uidai-btn-primary"
                  id="sendLinkBtn"
                  type="submit"
                  disabled={isDisabled}
                >
                  {submitting ? 'Sending…' : 'Send Link'}
                </button>
              </form>
            )}

            <div className="uidai-links">
              <Link to="/login">Back to Login</Link>
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

export default ForgotPassword;
