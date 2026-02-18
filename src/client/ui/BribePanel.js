/**
 * Bribe system UI — modal, balance display, transaction signing.
 */

import { state, auth } from '../state.js';
import { isSpectator, getApiBase, API_URL, TREASURY_ADDRESS } from '../config.js';
import { getToken, getEmbeddedWalletProvider, getEmbeddedWalletAddress } from '../auth.js';
import { showToast } from './Announcements.js';

let bribeOptions = null;

export function setupBribeUI() {
  if (isSpectator) return;

  const panel = document.getElementById('bribe-panel');
  const btn = document.getElementById('btn-bribe');
  const balanceEl = document.getElementById('bribe-balance');
  const modal = document.getElementById('bribe-modal');
  const optionsList = document.getElementById('bribe-options-list');
  const closeBtn = document.getElementById('bribe-close');
  if (!panel || !btn) return;

  panel.style.display = 'block';

  async function updateBalance() {
    if (!state.room) return;
    try {
      const addr = await getEmbeddedWalletAddress();
      if (!addr) { if (balanceEl) balanceEl.textContent = '— MON'; return; }
      const res = await fetch(`${API_URL}/api/balance/${addr}`);
      const data = await res.json();
      const bal = parseFloat(data.balance || 0);
      if (balanceEl) balanceEl.textContent = `${bal.toFixed(4)} MON`;
    } catch { /* silent */ }
  }
  updateBalance();
  setInterval(updateBalance, 30000);

  fetch(`${getApiBase()}/bribe/options`)
    .then(r => r.json())
    .then(data => {
      bribeOptions = data.options;
      updateBalance();
    })
    .catch(() => {});

  btn.addEventListener('click', () => {
    if (document.pointerLockElement) document.exitPointerLock();
    if (!bribeOptions || !modal || !optionsList) return;

    optionsList.innerHTML = '';
    for (const [key, opt] of Object.entries(bribeOptions)) {
      const item = document.createElement('button');
      item.className = 'bribe-option';
      const costText = `${opt.costMON} MON`;
      item.innerHTML = `<span class="bribe-opt-label">${opt.label}</span><span class="bribe-opt-cost">${costText}</span><span class="bribe-opt-desc">${opt.description}</span>`;
      item.addEventListener('click', () => submitBribe(key));
      optionsList.appendChild(item);
    }
    modal.style.display = 'flex';
  });

  if (closeBtn) {
    closeBtn.addEventListener('click', () => {
      modal.style.display = 'none';
    });
  }

  function handleBribeResponse(data) {
    if (data.success) {
      updateBalance();
      if (data.autoExecuted) {
        showToast('Bribe accepted! Effect applied.', 'success');
      } else {
        showToast('Bribe queued! The Magician will consider it...', 'warning');
      }
    } else {
      showToast(data.error || 'Bribe rejected', 'error');
    }
  }

  async function signAndSendTransaction(option) {
    if (auth.user?.user?.type === 'guest') {
      showToast('Login with Twitter to unlock bribes', 'error');
      return null;
    }

    const walletResult = await getEmbeddedWalletProvider();
    if (!walletResult) {
      showToast('Wallet not available. Try refreshing the page.', 'error');
      console.error('[Bribe] getEmbeddedWalletProvider returned null (see [Auth] warnings)');
      return null;
    }
    const { provider, address } = walletResult;

    try {
      await provider.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: '0x8f' }] });
    } catch (switchErr) {
      try {
        await provider.request({
          method: 'wallet_addEthereumChain',
          params: [{
            chainId: '0x8f',
            chainName: 'Monad',
            nativeCurrency: { name: 'MON', symbol: 'MON', decimals: 18 },
            rpcUrls: ['https://rpc.monad.xyz'],
            blockExplorerUrls: ['https://monadscan.com']
          }]
        });
      } catch (addErr) {
        console.warn('[Bribe] Could not add Monad chain:', addErr.message);
      }
    }

    try {
      const chainId = await provider.request({ method: 'eth_chainId' });
      console.log('[Bribe] Current chain:', chainId);
      if (chainId !== '0x8f') {
        showToast('Wrong network. Expected Monad (chain 143).', 'error');
        return null;
      }
    } catch (e) {
      console.warn('[Bribe] eth_chainId failed:', e.message);
    }

    try {
      const balHex = await provider.request({ method: 'eth_getBalance', params: [address, 'latest'] });
      if (BigInt(balHex) < BigInt(option.costWei)) {
        showToast(`Insufficient MON. Need ${option.costMON} MON.`, 'error');
        return null;
      }
    } catch {
      showToast('Could not check balance', 'error');
      return null;
    }

    try {
      showToast('Sending transaction...', 'warning');
      console.log('[Bribe] Calling eth_sendTransaction...', { from: address, to: TREASURY_ADDRESS, value: option.costWei });
      const result = await provider.request({
        method: 'eth_sendTransaction',
        params: [{
          from: address,
          to: TREASURY_ADDRESS,
          value: '0x' + BigInt(option.costWei).toString(16)
        }]
      });
      console.log('[Bribe] Transaction result:', typeof result, String(result).slice(0, 100));
      if (typeof result === 'string' && result.startsWith('0x') && result.length === 66) {
        showToast('Transaction sent!', 'success');
        return result;
      }
      console.warn('[Bribe] Unexpected result format:', result);
      showToast('Transaction may have failed — check console', 'error');
      return null;
    } catch (err) {
      console.error('[Bribe] Full tx error:', err);
      const errMsg = (err.message || 'Unknown error').slice(0, 80);
      showToast('Transaction failed: ' + errMsg, 'error');
      return null;
    }
  }

  async function submitBribe(bribeType) {
    if (!state.room?.sessionId) {
      showToast('Not connected to server', 'error');
      return;
    }

    const option = bribeOptions[bribeType];
    if (!option) return;

    let request = null;
    if (bribeType === 'custom') {
      request = prompt('What do you want the Magician to do?');
      if (!request || !request.trim()) return;
      request = request.trim();
    }

    modal.style.display = 'none';

    const txHash = await signAndSendTransaction(option);
    if (!txHash) return;

    try {
      const headers = { 'Content-Type': 'application/json' };
      const token = getToken();
      if (token) headers.Authorization = `Bearer ${token}`;

      const res = await fetch(`${getApiBase()}/bribe`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ bribeType, request, txHash })
      });
      handleBribeResponse(await res.json());
    } catch {
      showToast('Bribe submission failed', 'error');
    }
  }
}
