/**
 * Client Auth Module — Privy OAuth + Guest login.
 *
 * Uses @privy-io/react-auth via a hidden React island (PrivyBridge.jsx).
 * Exposes a flat async API consumed by main.js.
 */

import { mountPrivyBridge } from './PrivyBridge.jsx';
import { Buffer } from 'buffer';
globalThis.Buffer = Buffer;

const API_URL = window.location.hostname === 'localhost'
  ? 'http://localhost:3000'
  : `${window.location.protocol}//${window.location.host}`;

let bridge = null;

export async function initPrivy(appId, clientId) {
  if (!appId) {
    console.warn('[Auth] No Privy appId — Twitter login disabled');
    return;
  }
  try {
    bridge = await mountPrivyBridge(appId, clientId);
    if (bridge) {
      console.log('[Auth] Privy bridge ready, authenticated:', bridge.authenticated);
    } else {
      console.warn('[Auth] Privy bridge failed to mount');
    }
  } catch (e) {
    console.error('[Auth] Privy initialization failed:', e);
  }
}

export async function getPrivyUser() {
  return bridge?.user ?? null;
}

export async function loginWithTwitter() {
  if (!bridge) throw new Error('Privy not initialized — check VITE_PRIVY_APP_ID and VITE_PRIVY_CLIENT_ID');
  try {
    bridge.initOAuth({ provider: 'twitter' });
  } catch (e) {
    console.error('[Auth] Twitter OAuth failed:', e);
    throw new Error('Failed to start Twitter login. Check Privy dashboard settings.');
  }
}

export async function handleOAuthCallback() {
  if (!bridge) return null;

  const params = new URLSearchParams(window.location.search);
  const hasOAuthParams = params.has('privy_oauth_code') || params.has('privy_oauth_state');

  // PrivyProvider processes OAuth params on mount. If already authenticated, just clean up.
  if (bridge.authenticated && bridge.user) {
    if (hasOAuthParams) cleanOAuthParams();
    return bridge.user;
  }

  // OAuth params present but SDK hasn't finished processing -- poll briefly
  if (hasOAuthParams) {
    const user = await pollFor(() => bridge.authenticated ? bridge.user : null, 5000, 200);
    cleanOAuthParams();
    return user;
  }

  return null;
}

// No-op: React SDK auto-creates embedded wallets via createOnLogin: 'all-users'
export async function ensureEmbeddedWallet() {}

export async function exchangeForBackendToken() {
  if (!bridge) return null;

  const privyToken = await bridge.getAccessToken();
  if (!privyToken) {
    console.warn('[Auth] No Privy access token available');
    return null;
  }

  const res = await fetch(`${API_URL}/api/auth/privy`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ accessToken: privyToken }),
  });
  if (!res.ok) {
    console.error('[Auth] Backend token exchange failed:', res.status);
    return null;
  }

  return storeToken(await res.json());
}

export async function loginAsGuest() {
  const name = `Guest-${Date.now().toString(36)}`;
  const res = await fetch(`${API_URL}/api/auth/guest`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name }),
  });
  if (!res.ok) return null;

  return storeToken(await res.json());
}

export function getToken() {
  return localStorage.getItem('game:token');
}

export function getTwitterProfile(user) {
  // React SDK format
  if (user?.twitter) {
    return {
      username: user.twitter.username,
      name: user.twitter.name,
      avatar: user.twitter.profilePictureUrl,
    };
  }
  // Server format (linked_accounts array)
  const tw = user?.linked_accounts?.find(a => a.type === 'twitter_oauth');
  if (!tw) return null;
  return { username: tw.username, name: tw.name, avatar: tw.profile_picture_url };
}

export async function logout() {
  localStorage.removeItem('game:token');
  if (bridge) await bridge.logout();
}

export async function getEmbeddedWalletProvider() {
  if (!bridge) {
    console.warn('[Auth] getProvider: bridge not initialized');
    return null;
  }

  // Wallet may not be immediately available after login
  const wallet = await pollFor(() => bridge.getEmbeddedWallet(), 5000, 200);
  if (!wallet) {
    console.warn('[Auth] No embedded wallet available after timeout');
    return null;
  }

  try {
    const provider = await wallet.getEthereumProvider();
    return { provider, address: wallet.address };
  } catch (e) {
    console.error('[Auth] getEthereumProvider failed:', e);
    return null;
  }
}

export async function getEmbeddedWalletAddress() {
  if (!bridge) return null;
  return await pollFor(() => bridge.getEmbeddedWalletAddress(), 2000, 200);
}

export async function debugAuth() {
  const privyAccessToken = bridge
    ? !!(await bridge.getAccessToken().catch(() => null))
    : false;

  const info = {
    bridgeReady: !!bridge,
    authenticated: bridge?.authenticated ?? false,
    gameToken: !!localStorage.getItem('game:token'),
    privyAccessToken,
    privyUser: bridge?.user ?? null,
    embeddedWallet: bridge?.getEmbeddedWalletAddress() ?? null,
    urlParams: Object.fromEntries(new URLSearchParams(window.location.search)),
  };
  console.table(info);
  return info;
}

// --- Helpers ---

function cleanOAuthParams() {
  window.history.replaceState({}, '', window.location.pathname);
}

function storeToken(data) {
  localStorage.setItem('game:token', data.token);
  return data;
}

function pollFor(fn, timeoutMs, intervalMs) {
  return new Promise((resolve) => {
    const start = Date.now();
    function check() {
      const result = fn();
      if (result) return resolve(result);
      if (Date.now() - start >= timeoutMs) return resolve(null);
      setTimeout(check, intervalMs);
    }
    check();
  });
}
