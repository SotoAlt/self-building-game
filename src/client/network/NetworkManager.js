/**
 * Network manager — safe message sending and reconnection logic.
 */

import { state, network } from '../state.js';
import { MAX_RECONNECT_ATTEMPTS } from '../config.js';

let _connectToServerFn = null;

export function initNetworkManager({ connectToServerFn }) {
  _connectToServerFn = connectToServerFn;
}

export function sendToServer(type, data) {
  if (!state.room) return false;

  try {
    state.room.send(type, data);
    return true;
  } catch (e) {
    console.warn('[Network] Send failed:', e.message);
    state.connected = false;
    attemptReconnect();
    return false;
  }
}

export async function attemptReconnect() {
  if (network.reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
    console.error('[Network] Max reconnect attempts reached');
    return;
  }

  network.reconnectAttempts++;
  console.log(`[Network] Reconnecting... (attempt ${network.reconnectAttempts})`);

  try {
    await _connectToServerFn();
    network.reconnectAttempts = 0;
    console.log('[Network] Reconnected successfully');
  } catch (e) {
    console.warn('[Network] Reconnect failed, retrying in 2s...');
    setTimeout(attemptReconnect, 2000);
  }
}
