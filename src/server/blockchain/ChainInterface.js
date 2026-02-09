/**
 * ChainInterface - Abstract blockchain interface + mock implementation
 *
 * See MonadChainInterface for real native MON implementation on Monad mainnet.
 */

export class ChainInterface {
  async submitBribe(playerId, amount, request, txHash) {
    throw new Error('Not implemented');
  }
  async verifyBribeTransaction(txHash, expectedAmountWei, expectedSender = null) {
    throw new Error('Not implemented');
  }
  async acknowledgeBribe(bribeId, honored) {
    throw new Error('Not implemented');
  }
  async checkPendingBribes() {
    throw new Error('Not implemented');
  }
  async getBalance(playerId) {
    throw new Error('Not implemented');
  }
  async getHonoredBribes(limit = 5) {
    throw new Error('Not implemented');
  }
  async recordResult(gameId, winnerId, scores) {
    throw new Error('Not implemented');
  }
}

export class MockChainInterface extends ChainInterface {
  constructor() {
    super();
    this.bribes = [];
    this.balances = new Map();
    this._nextId = 1;
  }

  async verifyBribeTransaction(txHash, expectedAmountWei, expectedSender = null) {
    return { valid: true, txHash };
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

    // Deduct mock balance
    const balance = this.balances.get(playerId) || 1000;
    this.balances.set(playerId, Math.max(0, balance - amount));

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
      // Refund if rejected
      if (!honored) {
        const balance = this.balances.get(bribe.playerId) || 0;
        this.balances.set(bribe.playerId, balance + bribe.amount);
      }
    }
    return bribe;
  }

  async getBalance(playerId) {
    if (!this.balances.has(playerId)) {
      this.balances.set(playerId, 1000); // Starting balance
    }
    return this.balances.get(playerId);
  }

  async getHonoredBribes(limit = 5) {
    return this.bribes
      .filter(b => b.status === 'honored')
      .slice(-limit);
  }

  async recordResult(gameId, winnerId, scores) {
    console.log(`[Chain] Game ${gameId} result recorded (mock)`);
    return { gameId, winnerId, scores, recorded: true };
  }
}
