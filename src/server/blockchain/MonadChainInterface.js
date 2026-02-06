/**
 * MonadChainInterface - Native MON verification on Monad mainnet
 *
 * Read-only: no private keys needed. Users sign transactions client-side
 * via Privy embedded wallet. Server verifies on-chain receipts.
 */

import { createPublicClient, http, formatEther } from 'viem';
import { ChainInterface } from './ChainInterface.js';

// Monad mainnet chain definition
const monad = {
  id: 143,
  name: 'Monad',
  nativeCurrency: { name: 'MON', symbol: 'MON', decimals: 18 },
  rpcUrls: {
    default: { http: ['https://rpc.monad.xyz'] }
  },
  blockExplorers: {
    default: { name: 'Monadscan', url: 'https://monadscan.com' }
  }
};

export class MonadChainInterface extends ChainInterface {
  constructor({ rpcUrl, treasuryAddress }) {
    super();

    const chain = rpcUrl
      ? { ...monad, rpcUrls: { default: { http: [rpcUrl] } } }
      : monad;

    this.treasuryAddress = treasuryAddress.toLowerCase();
    this.publicClient = createPublicClient({ chain, transport: http() });
    this.bribes = [];
    this._nextId = 1;
    this._verifiedTxHashes = new Set();

    console.log(`[Chain] MonadChainInterface initialized — treasury: ${treasuryAddress}`);
  }

  async getBalance(addressOrId) {
    const isEvmAddress = addressOrId?.startsWith('0x') && addressOrId.length === 42;
    if (!isEvmAddress) return '0';

    try {
      const raw = await this.publicClient.getBalance({ address: addressOrId });
      return formatEther(raw);
    } catch (err) {
      console.error('[Chain] getBalance failed:', err.message);
      return '0';
    }
  }

  async verifyBribeTransaction(txHash, expectedAmountWei) {
    // Replay check
    if (this._verifiedTxHashes.has(txHash)) {
      return { valid: false, error: 'Transaction already used for a bribe' };
    }

    try {
      const receipt = await this.publicClient.getTransactionReceipt({ hash: txHash });
      if (receipt.status !== 'success') {
        return { valid: false, error: 'Transaction failed on-chain' };
      }

      const tx = await this.publicClient.getTransaction({ hash: txHash });
      if (tx.to?.toLowerCase() !== this.treasuryAddress) {
        return { valid: false, error: 'Transaction not sent to treasury address' };
      }

      const expected = BigInt(expectedAmountWei);
      if (tx.value < expected) {
        return { valid: false, error: `Insufficient amount: sent ${tx.value}, expected ${expected}` };
      }

      this._verifiedTxHashes.add(txHash);
      return { valid: true, txHash };
    } catch (err) {
      console.error('[Chain] verifyBribeTransaction failed:', err.message);
      return { valid: false, error: 'Failed to verify transaction: ' + err.message };
    }
  }

  async submitBribe(playerId, amount, request, txHash) {
    const bribe = {
      id: `bribe-${this._nextId++}`,
      playerId,
      amount,
      request,
      txHash: txHash || null,
      status: 'pending',
      timestamp: Date.now()
    };
    this.bribes.push(bribe);
    console.log(`[Chain] Bribe submitted: ${amount} MON from ${playerId} — "${request}" (tx: ${txHash || 'none'})`);
    return bribe;
  }

  async checkPendingBribes() {
    return this.bribes.filter(b => b.status === 'pending');
  }

  async acknowledgeBribe(bribeId, honored) {
    const bribe = this.bribes.find(b => b.id === bribeId);
    if (bribe) {
      bribe.status = honored ? 'honored' : 'rejected';
    }
    return bribe;
  }

  async getHonoredBribes(limit = 5) {
    return this.bribes
      .filter(b => b.status === 'honored')
      .slice(-limit);
  }

  async recordResult(gameId, winnerId, scores) {
    console.log(`[Chain] Game ${gameId} result recorded`);
    return { gameId, winnerId, scores, recorded: true };
  }
}
