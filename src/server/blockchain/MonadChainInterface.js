/**
 * MonadChainInterface - ERC-20 token operations on Monad via viem
 *
 * Falls back to MockChainInterface when env vars are not set.
 * Treasury wallet executes all transfers server-side (users don't need MON for gas).
 */

import { createPublicClient, createWalletClient, http, formatUnits, parseUnits, parseAbi } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { ChainInterface } from './ChainInterface.js';

// Monad Testnet chain definition
const monad = {
  id: 10143,
  name: 'Monad Testnet',
  nativeCurrency: { name: 'MON', symbol: 'MON', decimals: 18 },
  rpcUrls: {
    default: { http: ['https://testnet-rpc.monad.xyz'] }
  },
  blockExplorers: {
    default: { name: 'Monad Explorer', url: 'https://testnet.monadexplorer.com' }
  }
};

const ERC20_ABI = parseAbi([
  'function balanceOf(address owner) view returns (uint256)',
  'function transfer(address to, uint256 amount) returns (bool)',
  'function decimals() view returns (uint8)'
]);

export class MonadChainInterface extends ChainInterface {
  constructor({ rpcUrl, tokenAddress, treasuryPrivateKey }) {
    super();

    const chain = {
      ...monad,
      rpcUrls: rpcUrl
        ? { default: { http: [rpcUrl] } }
        : monad.rpcUrls
    };

    this.tokenAddress = tokenAddress;
    this.publicClient = createPublicClient({ chain, transport: http() });

    this.treasuryAccount = privateKeyToAccount(treasuryPrivateKey);
    this.walletClient = createWalletClient({
      account: this.treasuryAccount,
      chain,
      transport: http()
    });

    this.bribes = [];
    this._nextId = 1;
    this._decimals = null;

    console.log(`[Chain] MonadChainInterface initialized — token: ${tokenAddress}, treasury: ${this.treasuryAccount.address}`);
  }

  async _getDecimals() {
    if (this._decimals !== null) return this._decimals;
    try {
      this._decimals = await this.publicClient.readContract({
        address: this.tokenAddress,
        abi: ERC20_ABI,
        functionName: 'decimals'
      });
    } catch {
      this._decimals = 18;
    }
    return this._decimals;
  }

  async getBalance(walletOrPlayerId) {
    const isAddress = walletOrPlayerId?.startsWith('0x') && walletOrPlayerId.length === 42;
    if (isAddress) {
      try {
        const raw = await this.publicClient.readContract({
          address: this.tokenAddress,
          abi: ERC20_ABI,
          functionName: 'balanceOf',
          args: [walletOrPlayerId]
        });
        const decimals = await this._getDecimals();
        return Number(formatUnits(raw, decimals));
      } catch (err) {
        console.error('[Chain] balanceOf failed:', err.message);
        return 0;
      }
    }
    return 1000; // Non-wallet players get mock balance
  }

  async transferTokens(to, amount) {
    const decimals = await this._getDecimals();
    const rawAmount = parseUnits(String(amount), decimals);
    try {
      const hash = await this.walletClient.writeContract({
        address: this.tokenAddress,
        abi: ERC20_ABI,
        functionName: 'transfer',
        args: [to, rawAmount]
      });
      console.log(`[Chain] Transfer ${amount} tokens to ${to} — tx: ${hash}`);
      return { hash, success: true };
    } catch (err) {
      console.error('[Chain] Transfer failed:', err.message);
      return { success: false, error: err.message };
    }
  }

  async submitBribe(playerId, amount, request) {
    const bribe = {
      id: `bribe-${this._nextId++}`,
      playerId,
      amount,
      request,
      status: 'pending',
      timestamp: Date.now()
    };
    this.bribes.push(bribe);
    console.log(`[Chain] Bribe submitted: ${amount} tokens from ${playerId} — "${request}"`);
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
