/**
 * Client Auth Module - Privy OAuth + Guest login
 *
 * Wraps @privy-io/js-sdk-core for vanilla JS usage.
 * Falls back to guest-only when Privy credentials aren't configured.
 */

import Privy, { LocalStorage } from '@privy-io/js-sdk-core';
import { Buffer } from 'buffer';
globalThis.Buffer = Buffer;

const isLocalhost = window.location.hostname === 'localhost';
const API_URL = isLocalhost
  ? 'http://localhost:3000'
  : `${window.location.protocol}//${window.location.host}`;

let privy = null;

export function initPrivy(appId, clientId) {
  privy = new Privy({ appId, clientId, storage: new LocalStorage() });
}

export async function getPrivyUser() {
  if (!privy) return null;
  try {
    const result = await privy.user.get();
    return result.user;
  } catch {
    return null;
  }
}

export async function loginWithTwitter() {
  if (!privy) throw new Error('Privy not initialized — check VITE_PRIVY_APP_ID and VITE_PRIVY_CLIENT_ID');
  const redirectURI = window.location.origin;
  const { url } = await privy.auth.oauth.generateURL('twitter', redirectURI);
  window.location.href = url;
}

export async function handleOAuthCallback() {
  if (!privy) return null;
  const params = new URLSearchParams(window.location.search);
  const code = params.get('privy_oauth_code');
  const state = params.get('privy_oauth_state');
  const provider = params.get('privy_oauth_provider');
  if (!code || !state) return null;

  try {
    const session = await privy.auth.oauth.loginWithCode(code, state, provider);
    return session.user;
  } catch (e) {
    console.error('[Auth] OAuth callback login failed:', e);
    throw e;
  } finally {
    window.history.replaceState({}, '', window.location.pathname);
  }
}

export async function exchangeForBackendToken() {
  if (!privy) return null;
  const privyToken = await privy.getAccessToken();
  if (!privyToken) {
    console.warn('[Auth] No Privy access token available');
    return null;
  }

  const res = await fetch(`${API_URL}/api/auth/privy`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ accessToken: privyToken })
  });
  if (!res.ok) {
    console.error('[Auth] Backend token exchange failed:', res.status, await res.text().catch(() => ''));
    return null;
  }

  const data = await res.json();
  localStorage.setItem('game:token', data.token);
  return data;
}

export async function loginAsGuest() {
  const name = `Guest-${Date.now().toString(36)}`;
  const res = await fetch(`${API_URL}/api/auth/guest`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name })
  });
  if (!res.ok) return null;

  const data = await res.json();
  localStorage.setItem('game:token', data.token);
  return data;
}

export function getToken() {
  return localStorage.getItem('game:token');
}

export function getTwitterProfile(user) {
  const tw = user?.linked_accounts?.find(a => a.type === 'twitter_oauth');
  if (!tw) return null;
  return { username: tw.username, name: tw.name, avatar: tw.profile_picture_url };
}

export async function logout() {
  localStorage.removeItem('game:token');
  if (privy) await privy.auth.logout();
}

export async function debugAuth() {
  let privyAccessToken = false;
  let privyUser = null;

  if (privy) {
    privyAccessToken = !!(await privy.getAccessToken().catch(() => null));
    privyUser = await privy.user.get().then(r => r.user).catch(() => null);
  }

  const info = {
    privyInitialized: !!privy,
    gameToken: !!localStorage.getItem('game:token'),
    privyAccessToken,
    privyUser,
    urlParams: Object.fromEntries(new URLSearchParams(window.location.search))
  };
  console.table(info);
  return info;
}
