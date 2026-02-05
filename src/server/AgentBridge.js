/**
 * AgentBridge - Communicates with OpenClaw Gateway
 *
 * Uses the `openclaw agent` CLI to send messages to the Chaos Magician.
 * The agent responds using game-world skill tools (HTTP calls back to game server).
 */

import { exec } from 'child_process';

export class AgentBridge {
  constructor(gatewayUrl, sessionId) {
    this.gatewayUrl = gatewayUrl;
    this.sessionId = sessionId || null;
    this._invoking = false;
  }

  async invoke(context, phase, drama, pendingRequests) {
    if (!this.sessionId) {
      // No session ID = agent-runner handles invocation externally
      return;
    }
    if (this._invoking) {
      console.log('[AgentBridge] Already invoking, skipping');
      return;
    }

    const message = this.buildMessage(context, phase, drama, pendingRequests);

    this._invoking = true;
    try {
      await this._execAgent(message);
      console.log(`[AgentBridge] Invoked agent (phase=${phase}, drama=${drama})`);
    } catch (err) {
      console.error('[AgentBridge] Failed to invoke agent:', err.message);
    } finally {
      this._invoking = false;
    }
  }

  _execAgent(message) {
    return new Promise((resolve, reject) => {
      // Escape message for shell
      const escaped = message.replace(/'/g, "'\\''");
      const cmd = `openclaw agent --session-id "${this.sessionId}" --message '${escaped}' --json --timeout 30`;

      exec(cmd, {
        timeout: 35000,
        env: { ...process.env, PATH: process.env.PATH + ':/usr/bin:/usr/local/bin' }
      }, (error, stdout, stderr) => {
        if (error) {
          reject(new Error(`Agent exec failed: ${error.message}${stderr ? ` | ${stderr}` : ''}`));
          return;
        }
        resolve(stdout);
      });
    });
  }

  buildMessage(context, phase, drama, pendingRequests) {
    const parts = [];

    // Phase-specific directive
    parts.push(this.getPhasePrompt(phase, context));

    // Drama level
    parts.push(`\n**Drama Level**: ${drama}/100 ${this.getDramaEmoji(drama)}`);

    // World snapshot
    parts.push(`\n**World State**:`);
    parts.push(`- Players: ${context.playerCount} online`);
    if (context.players.length > 0) {
      parts.push(`- Player list: ${context.players.map(p => `${p.name} (${p.state})`).join(', ')}`);
    }
    parts.push(`- Entities: ${context.entityCount} in world`);
    parts.push(`- Game phase: ${context.gameState.phase}`);
    if (context.gameState.gameType) {
      parts.push(`- Game type: ${context.gameState.gameType}`);
    }
    if (context.gameState.timeRemaining) {
      parts.push(`- Time remaining: ${Math.ceil(context.gameState.timeRemaining / 1000)}s`);
    }
    parts.push(`- Games played this session: ${context.gamesPlayed}`);
    parts.push(`- Session uptime: ${context.sessionUptime}s`);

    // Active effects
    if (context.activeEffects.length > 0) {
      parts.push(`- Active spells: ${context.activeEffects.map(e => e.name).join(', ')}`);
    }

    // Recent deaths
    if (context.recentDeathCount > 0) {
      parts.push(`- Deaths in last 10s: ${context.recentDeathCount}`);
    }

    // Recent chat
    if (context.recentChat.length > 0) {
      parts.push(`\n**Recent Chat**:`);
      for (const msg of context.recentChat.slice(-5)) {
        parts.push(`  [${msg.senderType}] ${msg.sender}: ${msg.text}`);
      }
    }

    // Pending player requests
    if (pendingRequests.length > 0) {
      parts.push(`\n**Player Requests (RESPOND TO THESE)**:`);
      for (const req of pendingRequests) {
        parts.push(`  - ${req.sender}: "${req.text}"`);
      }
    }

    // Leaderboard
    if (context.leaderboard.length > 0) {
      parts.push(`\n**Leaderboard**: ${context.leaderboard.slice(0, 3).map((e, i) => `${i + 1}. ${e.name} (${e.wins}W)`).join(', ')}`);
    }

    return parts.join('\n');
  }

  getPhasePrompt(phase, context) {
    switch (phase) {
      case 'welcome':
        return `**Phase: WELCOME** — Players are joining! Greet them dramatically. Introduce yourself as the Chaos Magician. Tease what's coming. Use send_chat_message and announce tools. If you have enough players, start building an arena (clear_world, then spawn entities or load_template).`;

      case 'warmup':
        return `**Phase: WARMUP** — Time to build an arena! Use clear_world first, then either load_template or spawn entities manually to create an interesting arena. Set the respawn point with set_respawn. When ready, start a game with start_game. Keep chatting to build hype.`;

      case 'gaming':
        return `**Phase: GAMING** — Game is live! Commentate on the action. React to deaths and near-misses. Add tricks with add_trick if you haven't already. Cast spells when drama is high. Don't start new games, just enhance the current one.`;

      case 'intermission':
        return `**Phase: INTERMISSION** — Game just ended! Congratulate the winner. Comment on highlights. After a brief pause, clear the world and build the next arena. Make each arena different from the last. Use a different template or build custom.`;

      case 'escalation':
        return `**Phase: ESCALATION** — ${context.gamesPlayed} games deep! Time to ramp up difficulty. Use harder templates (parkour_hell, gauntlet). Cast more spells. Add more tricks. Shorter time limits. The audience expects chaos!`;

      case 'finale':
        return `**Phase: FINALE** — This is the grand finale! Maximum chaos. Multiple spells active. Hardest arenas. Epic commentary. Make it memorable. The session is reaching its climax!`;

      default:
        return `**Phase: ${phase}** — Use your judgment. Keep the game entertaining.`;
    }
  }

  getDramaEmoji(drama) {
    if (drama >= 80) return '(EXPLOSIVE!)';
    if (drama >= 60) return '(intense)';
    if (drama >= 40) return '(building)';
    if (drama >= 20) return '(warming up)';
    return '(quiet - liven things up!)';
  }
}
