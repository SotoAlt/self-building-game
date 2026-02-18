/**
 * AFK warning and kicked overlays.
 */

import { state, afk } from '../state.js';

export function showAfkWarning(token, timeout) {
  hideAfkWarning();

  afk.overlay = document.createElement('div');
  afk.overlay.id = 'afk-overlay';
  afk.overlay.style.cssText = 'position:fixed;inset:0;z-index:99999;background:rgba(0,0,0,0.85);display:flex;flex-direction:column;align-items:center;justify-content:center;';

  const title = document.createElement('div');
  title.style.cssText = 'color:#ff6b6b;font-size:32px;font-weight:bold;margin-bottom:16px;text-shadow:0 0 20px rgba(255,107,107,0.5);';
  title.textContent = 'ARE YOU STILL THERE?';

  const countdownEl = document.createElement('div');
  countdownEl.style.cssText = 'color:#fff;font-size:20px;margin-bottom:24px;';
  let remaining = Math.ceil(timeout / 1000);
  countdownEl.textContent = `You'll be kicked in ${remaining}s...`;
  afk.countdownInterval = setInterval(() => {
    remaining--;
    if (remaining <= 0) {
      clearInterval(afk.countdownInterval);
      countdownEl.textContent = 'Kicking...';
    } else {
      countdownEl.textContent = `You'll be kicked in ${remaining}s...`;
    }
  }, 1000);

  const btn = document.createElement('button');
  btn.style.cssText = 'padding:16px 48px;font-size:22px;font-weight:bold;background:#4caf50;color:#fff;border:none;border-radius:12px;cursor:pointer;transition:transform 0.1s;';
  btn.textContent = "I'm here!";
  btn.onmouseenter = () => btn.style.transform = 'scale(1.05)';
  btn.onmouseleave = () => btn.style.transform = 'scale(1)';
  btn.onclick = () => {
    if (state.room) state.room.send('afk_heartbeat', { token });
    hideAfkWarning();
  };

  afk.overlay.appendChild(title);
  afk.overlay.appendChild(countdownEl);
  afk.overlay.appendChild(btn);
  document.body.appendChild(afk.overlay);

  const keyHandler = () => {
    if (state.room) state.room.send('afk_heartbeat', { token });
    hideAfkWarning();
  };
  document.addEventListener('keydown', keyHandler);
  afk.overlay._keyHandler = keyHandler;
}

export function hideAfkWarning() {
  if (afk.countdownInterval) {
    clearInterval(afk.countdownInterval);
    afk.countdownInterval = null;
  }
  if (afk.overlay) {
    if (afk.overlay._keyHandler) {
      document.removeEventListener('keydown', afk.overlay._keyHandler);
    }
    afk.overlay.remove();
    afk.overlay = null;
  }
}

export function showAfkKickedScreen() {
  hideAfkWarning();
  const overlay = document.createElement('div');
  overlay.style.cssText = 'position:fixed;inset:0;z-index:99999;background:rgba(0,0,0,0.92);display:flex;flex-direction:column;align-items:center;justify-content:center;';

  const title = document.createElement('div');
  title.style.cssText = 'color:#ff6b6b;font-size:36px;font-weight:bold;margin-bottom:12px;';
  title.textContent = 'DISCONNECTED';

  const reason = document.createElement('div');
  reason.style.cssText = 'color:#aaa;font-size:18px;margin-bottom:32px;';
  reason.textContent = 'You were kicked for being AFK.';

  const btn = document.createElement('button');
  btn.style.cssText = 'padding:16px 48px;font-size:20px;font-weight:bold;background:#2196f3;color:#fff;border:none;border-radius:12px;cursor:pointer;';
  btn.textContent = 'Rejoin';
  btn.onclick = () => location.reload();

  overlay.appendChild(title);
  overlay.appendChild(reason);
  overlay.appendChild(btn);
  document.body.appendChild(overlay);
}
