/* ══════════════════════════════════════════════════════════════════
   sessionManager.js — inactivity-driven session lifecycle.

   Active user (mouse/keyboard/touch within last 15 min):
     - access token is silently refreshed ~60 s before expiry, so
       no API call ever sees a 401.

   Idle user (no input for 15 min):
     - shows a "session expired" popup, clears tokens, sends them
       to /login. Fires regardless of whether any API call is in
       flight, so the popup appears even on a static page.
   ══════════════════════════════════════════════════════════════════ */

import { useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { tokenStore, refreshAccessToken } from './client';
import { logout } from './auth';
import { uiStore } from '../store/project/uiStore';

const INACTIVITY_LIMIT_MS = 15 * 60 * 1000;      // 15 min idle → expire
const REFRESH_LEAD_MS     = 60 * 1000;           // refresh 60 s before expiry
const TICK_INTERVAL_MS    = 15 * 1000;           // check every 15 s
const ACTIVITY_KEY        = 'pmis_last_activity';
const ACTIVITY_THROTTLE_MS = 5 * 1000;           // localStorage write throttle

const ACTIVITY_EVENTS = ['mousedown', 'keydown', 'scroll', 'touchstart', 'click'];

function readLastActivity() {
  const v = parseInt(localStorage.getItem(ACTIVITY_KEY) || '0', 10);
  return Number.isFinite(v) && v > 0 ? v : Date.now();
}

function writeLastActivity(now) {
  try { localStorage.setItem(ACTIVITY_KEY, String(now)); } catch { /* quota */ }
}

export function markActivity() {
  writeLastActivity(Date.now());
}

export function useSessionManager() {
  const navigate = useNavigate();
  const expiredRef = useRef(false);
  const lastWriteRef = useRef(0);

  useEffect(() => {
    // Seed last-activity so a fresh login is treated as "just active".
    writeLastActivity(Date.now());
    expiredRef.current = false;

    const onActivity = () => {
      const now = Date.now();
      // Throttle localStorage writes — mousemove/scroll fire constantly.
      if (now - lastWriteRef.current < ACTIVITY_THROTTLE_MS) return;
      lastWriteRef.current = now;
      writeLastActivity(now);
    };

    ACTIVITY_EVENTS.forEach((ev) =>
      window.addEventListener(ev, onActivity, { passive: true })
    );

    const expireSession = async () => {
      if (expiredRef.current) return;
      expiredRef.current = true;
      try { await logout(); } catch { /* token already cleared */ }
      uiStore.showMessage(
        'Your session has expired due to inactivity. Please sign in again.',
        () => navigate('/login', { replace: true })
      );
    };

    const tick = async () => {
      if (expiredRef.current) return;
      // Bail if we've been logged out by another flow (e.g. manual sign-out).
      if (!tokenStore.get()) return;

      const now = Date.now();
      const idleFor = now - readLastActivity();
      if (idleFor >= INACTIVITY_LIMIT_MS) {
        await expireSession();
        return;
      }
      const expiresAt = tokenStore.getExpiresAt();
      if (expiresAt && expiresAt - now <= REFRESH_LEAD_MS) {
        await refreshAccessToken();
      }
    };

    const intervalId = setInterval(tick, TICK_INTERVAL_MS);
    // Run once immediately so a long-idle tab triggers without a 15 s delay.
    tick();

    return () => {
      ACTIVITY_EVENTS.forEach((ev) => window.removeEventListener(ev, onActivity));
      clearInterval(intervalId);
    };
  }, [navigate]);
}
