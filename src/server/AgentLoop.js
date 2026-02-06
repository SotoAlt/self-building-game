/**
 * AgentLoop - Autonomous agent heartbeat
 *
 * Ticks every 5 seconds, evaluates drama score, detects session phase,
 * and decides whether to invoke the AI agent via the AgentBridge.
 */

import { AgentBridge } from './AgentBridge.js';

// Session phase names
const PHASE = {
  WELCOME: 'welcome',
  WARMUP: 'warmup',
  GAMING: 'gaming',
  INTERMISSION: 'intermission',
  ESCALATION: 'escalation',
  FINALE: 'finale'
};

export class AgentLoop {
  constructor(worldState, broadcastFn, config = {}) {
    this.worldState = worldState;
    this.broadcast = broadcastFn;
    this.chain = config.chain || null;

    // Agent bridge for OpenClaw communication
    this.bridge = new AgentBridge(
      config.gatewayUrl || process.env.OPENCLAW_GATEWAY_URL || 'http://localhost:18789',
      config.sessionId || process.env.OPENCLAW_SESSION_ID || null
    );

    // Tick interval
    this.tickInterval = config.tickInterval || 5000;
    this._timer = null;

    // State
    this.phase = PHASE.WELCOME;
    this.paused = false;
    this.sessionStartTime = Date.now();
    this.lastInvokeTime = 0;
    this.lastActionTime = Date.now();
    this.gamesPlayed = 0;
    this.invokeCount = 0;

    // Tracking for drama score
    this.recentDeaths = [];    // timestamps
    this.recentChats = [];     // timestamps
    this.pendingMentions = []; // unhandled @agent messages
    this.lastMessageId = 0;
    this.lastEventId = 0;

    // Phase transition tracking
    this.phaseStartTime = Date.now();
    this.lastPhaseTransition = null;
  }

  start() {
    console.log('[AgentLoop] Starting autonomous agent loop');

    if (!this.bridge.sessionId) {
      console.warn('[AgentLoop] No OPENCLAW_SESSION_ID set — agent loop will not invoke');
    }

    this._timer = setInterval(() => this.tick(), this.tickInterval);
    // Initial tick after short delay
    setTimeout(() => this.tick(), 2000);
  }

  stop() {
    if (this._timer) {
      clearInterval(this._timer);
      this._timer = null;
    }
    console.log('[AgentLoop] Stopped');
  }

  get playerCount() {
    return this.worldState.players.size;
  }

  get humanPlayerCount() {
    let count = 0;
    for (const p of this.worldState.players.values()) {
      if (p.type !== 'ai') count++;
    }
    return count;
  }

  pause() {
    this.paused = true;
    console.log('[AgentLoop] Paused — agent will not invoke');
  }

  resume() {
    this.paused = false;
    console.log('[AgentLoop] Resumed');
  }

  async tick() {
    try {
      // Don't invoke if paused or no human players
      if (this.paused) return;
      if (this.humanPlayerCount === 0) return;

      // Rate limit: minimum 15s between invocations
      if (Date.now() - this.lastInvokeTime < 15000) return;

      // Gather context
      this.gatherContext();

      // Detect phase transitions
      const prevPhase = this.phase;
      this.detectPhase();
      const phaseChanged = prevPhase !== this.phase;

      // Calculate drama
      const drama = this.calculateDrama();

      // Decide whether to invoke
      if (this.shouldInvoke(phaseChanged, drama)) {
        await this.invoke(drama);
      }
    } catch (err) {
      console.error('[AgentLoop] Tick error:', err.message);
    }
  }

  gatherContext() {
    const now = Date.now();

    // Gather new chat messages
    const messages = this.worldState.getMessages(this.lastMessageId);
    for (const msg of messages) {
      this.lastMessageId = Math.max(this.lastMessageId, msg.id);
      this.recentChats.push(now);

      // Track @agent mentions
      if (msg.senderType === 'player' && /@agent/i.test(msg.text)) {
        this.pendingMentions.push({
          id: msg.id,
          sender: msg.sender,
          text: msg.text,
          timestamp: msg.timestamp
        });
      }
    }

    // Gather events (deaths, etc.)
    const events = this.worldState.getEvents(this.lastEventId);
    for (const evt of events) {
      this.lastEventId = Math.max(this.lastEventId, evt.id);
      if (evt.type === 'player_death') {
        this.recentDeaths.push(now);
      }
    }

    // Clean old entries (10s window for deaths, 30s for chats)
    this.recentDeaths = this.recentDeaths.filter(t => now - t < 10000);
    this.recentChats = this.recentChats.filter(t => now - t < 30000);
  }

  detectPhase() {
    const elapsed = Date.now() - this.sessionStartTime;
    const gamePhase = this.worldState.gameState.phase;

    const prev = this.phase;

    if (elapsed < 30000 && this.gamesPlayed === 0) {
      this.phase = PHASE.WELCOME;
    } else if (gamePhase === 'building') {
      this.phase = PHASE.WARMUP;
    } else if (gamePhase === 'playing' || gamePhase === 'countdown') {
      this.phase = PHASE.GAMING;
    } else if (gamePhase === 'ended') {
      this.phase = PHASE.INTERMISSION;
    } else if (gamePhase === 'lobby' && this.gamesPlayed === 0) {
      this.phase = PHASE.WARMUP;
    } else if (this.gamesPlayed >= 6) {
      this.phase = PHASE.FINALE;
    } else if (this.gamesPlayed >= 3) {
      this.phase = PHASE.ESCALATION;
    } else {
      this.phase = PHASE.INTERMISSION;
    }

    if (prev !== this.phase) {
      this.phaseStartTime = Date.now();
      this.lastPhaseTransition = { from: prev, to: this.phase, time: Date.now() };
      console.log(`[AgentLoop] Phase transition: ${prev} → ${this.phase}`);
    }
  }

  calculateDrama() {
    let score = 0;

    // Active game in progress
    if (this.worldState.gameState.phase === 'playing') score += 30;

    // Each player connected (max +20)
    score += Math.min(this.playerCount * 5, 20);

    // Deaths in last 10s
    score += this.recentDeaths.length * 10;

    // Chat messages in last 30s
    score += this.recentChats.length * 5;

    // Unhandled @agent mentions
    score += this.pendingMentions.length * 15;

    // Active spells
    score += this.worldState.getActiveEffects().length * 5;

    // Bonus when game is close to ending
    if (this.worldState.gameState.phase === 'playing' && this.worldState.gameState.timeLimit) {
      const remaining = this.worldState.gameState.timeLimit - (Date.now() - this.worldState.gameState.startTime);
      if (remaining > 0 && remaining < 15000) score += 10;
    }

    // Seconds since last agent action (decay)
    const sinceLast = (Date.now() - this.lastActionTime) / 1000;
    score -= Math.floor(sinceLast / 10) * 2;

    // Lobby with no game for >60s
    if (this.worldState.gameState.phase === 'lobby' && sinceLast > 60) {
      score -= 20;
    }

    return Math.max(0, Math.min(100, score));
  }

  shouldInvoke(phaseChanged, drama) {
    // No session configured
    if (!this.bridge.sessionId) return false;

    const sinceLast = Date.now() - this.lastInvokeTime;

    // Always invoke for pending @agent mentions (but still respect minimum)
    if (this.pendingMentions.length > 0) return true;

    // Phase changes and game endings
    if (phaseChanged && sinceLast > 20000) return true;
    if (this.worldState.gameState.phase === 'ended' && sinceLast > 20000) return true;

    // Conditionally invoke based on phase and timing (conservative intervals)
    if (this.phase === PHASE.GAMING) {
      return sinceLast > 30000; // every 30s during games
    }

    if (this.phase === PHASE.WELCOME) {
      return sinceLast > 20000; // greet within 20s
    }

    if (drama > 80) return sinceLast > 20000;  // high drama, every 20s

    return sinceLast > 45000; // default: every 45s
  }

  async invoke(drama) {
    if (!this.bridge.sessionId) return;

    this.lastInvokeTime = Date.now();
    this.invokeCount++;

    const context = await this.buildContext();

    try {
      await this.bridge.invoke(context, this.phase, drama, this.pendingMentions);
      this.lastActionTime = Date.now();

      // Clear pending mentions after handling
      this.pendingMentions = [];
    } catch (err) {
      console.error('[AgentLoop] Invoke failed:', err.message);
    }
  }

  async buildContext() {
    const players = this.worldState.getPlayers().map(p => ({
      id: p.id,
      name: p.name,
      type: p.type,
      state: p.state,
      position: p.position
    }));

    const entities = Array.from(this.worldState.entities.values()).map(e => ({
      id: e.id,
      type: e.type,
      position: e.position
    }));

    const ctx = {
      playerCount: this.playerCount,
      players,
      entityCount: entities.length,
      entities: entities.slice(0, 20), // limit for token efficiency
      gameState: this.worldState.getGameState(),
      activeEffects: this.worldState.getActiveEffects(),
      recentChat: this.worldState.getMessages(Math.max(0, this.lastMessageId - 10)),
      leaderboard: this.worldState.getLeaderboard(),
      gamesPlayed: this.gamesPlayed,
      sessionUptime: Math.floor((Date.now() - this.sessionStartTime) / 1000),
      recentDeathCount: this.recentDeaths.length,
      pendingBribes: [],
      recentHonoredBribes: []
    };

    // Fetch bribe data if chain is available
    if (this.chain) {
      try {
        ctx.pendingBribes = await this.chain.checkPendingBribes();
        ctx.recentHonoredBribes = await this.chain.getHonoredBribes(5);
      } catch (e) {
        // Non-critical — agent can still function without bribe data
      }
    }

    return ctx;
  }

  // Called by server when a game ends
  onGameEnded() {
    this.gamesPlayed++;
  }

  // Called when external agent (agent-runner) takes an action via HTTP API
  notifyAgentAction() {
    this.lastActionTime = Date.now();
  }

  getStatus() {
    return {
      phase: this.phase,
      paused: this.paused,
      drama: this.calculateDrama(),
      invokeCount: this.invokeCount,
      gamesPlayed: this.gamesPlayed,
      playerCount: this.playerCount,
      pendingMentions: this.pendingMentions.length,
      lastInvoke: this.lastInvokeTime ? Date.now() - this.lastInvokeTime : null,
      sessionUptime: Math.floor((Date.now() - this.sessionStartTime) / 1000)
    };
  }
}
