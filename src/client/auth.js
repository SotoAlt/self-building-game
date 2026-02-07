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

export async function initPrivy(appId, clientId) {
  privy = new Privy({ appId, clientId, storage: new LocalStorage() });
  try {
    await privy.initialize();
    console.log('[Auth] Privy initialized');
    await setupEmbeddedWalletProxy();
  } catch (e) {
    console.error('[Auth] Privy initialization failed:', e);
  }
}

async function setupEmbeddedWalletProxy() {
  const iframeUrl = privy.embeddedWallet.getURL();
  const iframe = document.createElement('iframe');
  iframe.src = iframeUrl;
  iframe.style.display = 'none';
  iframe.id = 'privy-embedded-wallet-iframe';
  document.body.appendChild(iframe);

  await new Promise((resolve) => {
    iframe.addEventListener('load', resolve, { once: true });
  });

  privy.setMessagePoster({
    postMessage(msg, origin, transfer) {
      iframe.contentWindow?.postMessage(msg, origin, transfer);
    },
    reload() {
      iframe.src = iframeUrl;
    }
  });

  window.addEventListener('message', (e) => {
    if (e.source === iframe.contentWindow && e.data?.type?.startsWith?.('privy:')) {
      privy.embeddedWallet.onMessage(e.data);
    }
  });

  // Verify proxy is responsive
  const ready = await privy.embeddedWallet.ping(10000).catch(() => false);
  console.log('[Auth] Embedded wallet proxy:', ready ? 'ready' : 'timeout (will retry on use)');
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
  try {
    const { url } = await privy.auth.oauth.generateURL('twitter', window.location.origin);
    window.location.href = url;
  } catch (e) {
    console.error('[Auth] Twitter OAuth failed:', e);
    throw new Error('Failed to start Twitter login. Check Privy dashboard settings.');
  }
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

function findEvmWallet(user) {
  return user?.linked_accounts?.find(
    a => a.type === 'wallet' && a.walletClientType === 'privy' && a.chainType === 'ethereum'
  ) || null;
}

export async function ensureEmbeddedWallet() {
  if (!privy) return;
  try {
    await privy.embeddedWallet.create({});
    console.log('[Auth] Embedded wallet provisioned on device');
  } catch (e) {
    // Expected if wallet already provisioned on this device
    console.log('[Auth] Embedded wallet create:', e.message);
  }
}

export async function exchangeForBackendToken() {
  if (!privy) return null;
  await ensureEmbeddedWallet();

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
    console.error('[Auth] Backend token exchange failed:', res.status);
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

export async function getEmbeddedWalletProvider() {
  if (!privy) {
    console.warn('[Auth] getProvider: privy not initialized');
    return null;
  }
  try {
    let wallet = findEvmWallet((await privy.user.get()).user);
    if (!wallet) {
      console.warn('[Auth] getProvider: no EVM wallet in linked_accounts');
      return null;
    }

    // Try getting the provider directly; if it fails, provision keys and retry
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const provider = await privy.embeddedWallet.getProvider(wallet);
        return { provider, address: wallet.address };
      } catch (err) {
        if (attempt > 0) throw err;
        console.warn('[Auth] getProvider failed, provisioning keys:', err.message);
        await privy.embeddedWallet.create({}).catch(() => {});
        wallet = findEvmWallet((await privy.user.get()).user);
        if (!wallet) {
          console.warn('[Auth] getProvider: no EVM wallet after provisioning');
          return null;
        }
      }
    }
  } catch (e) {
    console.error('[Auth] getEmbeddedWalletProvider failed:', e);
    return null;
  }
  return null;
}

export async function getEmbeddedWalletAddress() {
  if (!privy) return null;
  try {
    const { user } = await privy.user.get();
    return findEvmWallet(user)?.address || null;
  } catch {
    return null;
  }
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
