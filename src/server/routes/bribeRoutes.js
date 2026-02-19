import { requireAuth } from '../auth.js';
import {
  findUser, saveTransaction, findTransactionByTxHash,
  updateTransactionStatus, getTransactionsByUser,
} from '../db.js';
import { BRIBE_OPTIONS } from '../constants.js';

export function mountBribeRoutes(router, ctx) {
  const { chain, isRealChain, arenaService } = ctx;

  router.post('/spell/cast', (req, res) => {
    const arena = req.arena;
    const phase = arena.worldState.gameState.phase;
    if (phase !== 'playing') {
      return res.status(400).json({ error: `Cannot cast spells during ${phase} phase. Wait for a game to start.` });
    }

    const { type, duration } = req.body;
    if (!type) {
      return res.status(400).json({ error: 'Missing required: type' });
    }

    try {
      const spell = arena.worldState.castSpell(type, duration);
      arena.broadcastToRoom('spell_cast', spell);

      const spellMsg = arena.worldState.addMessage('System', 'system', `Spell active: ${spell.name}`);
      arena.broadcastToRoom('chat_message', spellMsg);
      arena.worldState.addEvent('spell_cast', { type, name: spell.name });
      if (arena.agentLoop) arena.agentLoop.notifyAgentAction();

      res.json({ success: true, spell });
    } catch (error) {
      res.status(400).json({ success: false, error: error.message });
    }
  });

  router.post('/spell/clear', (req, res) => {
    const arena = req.arena;
    arena.worldState.clearEffects();
    arena.broadcastToRoom('effects_cleared', {});
    res.json({ success: true });
  });

  router.get('/spell/active', (req, res) => {
    res.json({ effects: req.arena.worldState.getActiveEffects() });
  });

  router.get('/bribe/options', (req, res) => {
    res.json({ options: BRIBE_OPTIONS, isRealChain });
  });

  router.post('/bribe', requireAuth, async (req, res) => {
    const arena = req.arena;
    const ws = arena.worldState;
    const { bribeType, request, txHash } = req.body;
    if (!bribeType) {
      return res.status(400).json({ error: 'Missing required: bribeType' });
    }

    const userId = req.user.id;
    const sessionPlayer = Array.from(ws.players.values()).find(p => p.userId === userId);
    if (!sessionPlayer) {
      return res.status(400).json({ error: 'No active game session' });
    }
    const playerId = sessionPlayer.id;

    const option = BRIBE_OPTIONS[bribeType];
    if (!option) {
      return res.status(400).json({ error: `Invalid bribe type. Available: ${Object.keys(BRIBE_OPTIONS).join(', ')}` });
    }

    if (bribeType === 'custom' && !request) {
      return res.status(400).json({ error: 'Custom bribe requires a request text' });
    }

    if (!txHash) {
      return res.status(400).json({ error: 'Missing txHash — transaction required' });
    }

    const dbUser = await findUser(userId);

    const existingTx = await findTransactionByTxHash(txHash);
    if (existingTx) {
      return res.status(400).json({ error: 'Transaction already used' });
    }

    const verification = await chain.verifyBribeTransaction(txHash, option.costWei, dbUser?.wallet_address);
    if (!verification.valid) {
      return res.status(400).json({ error: verification.error });
    }

    const amount = option.costMON;
    const costLabel = `${amount} MON`;
    const description = bribeType === 'custom' ? request : option.label;
    const bribe = await chain.submitBribe(playerId, amount, description, txHash);

    await saveTransaction({
      id: bribe.id, userId, walletAddress: dbUser?.wallet_address,
      txHash: txHash || null, txType: bribeType, amount: String(amount), description
    });

    const player = ws.players.get(playerId);
    const name = player?.name || playerId.slice(0, 8);

    arena.broadcastToRoom('announcement', ws.announce(
      `${name} bribed the Magician (${option.label}) for ${costLabel}!`, 'player', 8000
    ));
    arena.broadcastToRoom('chat_message',
      ws.addMessage('System', 'system', `Bribe: ${option.label} from ${name}`)
    );

    ws.addEvent('bribe', {
      playerId, name, amount, bribeType,
      request: description, bribeId: bribe.id, txHash: txHash || null
    });

    const autoExecuted = await arenaService.executeAutoBribe(arena, bribeType, bribe.id, chain);
    res.json({ success: true, bribe, autoExecuted });
  });

  router.get('/bribe/pending', async (req, res) => {
    const pending = await chain.checkPendingBribes();
    res.json({ bribes: pending });
  });

  router.post('/bribe/:id/honor', async (req, res) => {
    const arena = req.arena;
    const ws = arena.worldState;
    const { id } = req.params;
    const { response } = req.body;

    const bribe = await chain.acknowledgeBribe(id, true);
    if (!bribe) {
      return res.status(404).json({ error: `Bribe not found: ${id}` });
    }

    await updateTransactionStatus(id, 'honored');

    const player = ws.players.get(bribe.playerId);
    const name = player?.name || bribe.playerId.slice(0, 8);

    const announcement = ws.announce(
      `The Magician honors ${name}'s bribe!${response ? ` "${response}"` : ''}`, 'agent', 8000
    );
    arena.broadcastToRoom('announcement', announcement);

    ws.addEvent('bribe_honored', {
      bribeId: id, playerId: bribe.playerId, name, response
    });

    res.json({ success: true, bribe });
  });

  router.get('/bribe/honored', async (req, res) => {
    const limit = parseInt(req.query.limit) || 5;
    const honored = await chain.getHonoredBribes(limit);
    res.json({ bribes: honored });
  });

  // Transactions
  router.get('/transactions', requireAuth, async (req, res) => {
    const limit = Math.min(parseInt(req.query.limit) || 20, 100);
    const offset = parseInt(req.query.offset) || 0;
    const transactions = await getTransactionsByUser(req.user.id, limit, offset);
    res.json({ transactions });
  });

  router.get('/balance/:addressOrId', async (req, res) => {
    const param = req.params.addressOrId;
    const isEvmAddress = param?.startsWith('0x') && param.length === 42;

    if (isEvmAddress) {
      const balance = await chain.getBalance(param);
      return res.json({ address: param, balance });
    }

    const user = await findUser(param);
    const walletAddress = user?.wallet_address || null;
    const balance = await chain.getBalance(walletAddress || param);
    res.json({ playerId: param, balance, walletAddress });
  });

  router.get('/wallet/:playerId', async (req, res) => {
    const { playerId } = req.params;
    const user = await findUser(playerId);
    const walletAddress = user?.wallet_address || null;
    res.json({ playerId, walletAddress, hasWallet: !!walletAddress });
  });

  router.post('/tokens/faucet', requireAuth, async (req, res) => {
    if (isRealChain) {
      return res.status(400).json({ error: 'Faucet not available on mainnet. Send MON to your wallet address.' });
    }
    const playerId = req.user.id;
    const balance = await chain.getBalance(playerId);
    chain.balances.set(playerId, balance + 100);
    res.json({ success: true, amount: 100, balance: balance + 100 });
  });
}
