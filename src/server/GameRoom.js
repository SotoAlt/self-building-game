/**
 * GameRoom - Colyseus room for real-time multiplayer
 *
 * Handles player connections, position sync, and game events.
 */

import { Room } from 'colyseus';

export class GameRoom extends Room {
  // World state injected by server
  worldState = null;

  onCreate(options) {
    console.log(`[GameRoom] Room created`);

    // Player position updates (client → server)
    this.onMessage('move', (client, data) => {
      if (this.worldState) {
        this.worldState.updatePlayer(client.sessionId, {
          position: data.position,
          velocity: data.velocity
        });

        // Broadcast to other clients
        this.broadcast('player_moved', {
          id: client.sessionId,
          position: data.position,
          velocity: data.velocity
        }, { except: client });
      }
    });

    // Player death
    this.onMessage('died', (client, data) => {
      if (this.worldState) {
        this.worldState.updatePlayer(client.sessionId, { state: 'dead' });

        // Record challenge attempt if relevant
        if (data.challengeId) {
          this.worldState.recordChallengeAttempt(data.challengeId);
        }

        // Broadcast death event (for agent observation)
        this.broadcast('player_died', {
          id: client.sessionId,
          position: data.position,
          challengeId: data.challengeId
        });

        console.log(`[GameRoom] Player died: ${client.sessionId}`);
      }
    });

    // Player respawn
    this.onMessage('respawn', (client) => {
      if (this.worldState) {
        this.worldState.updatePlayer(client.sessionId, {
          state: 'alive',
          position: [0, 2, 0]
        });

        this.broadcast('player_respawned', { id: client.sessionId });
      }
    });

    // Challenge completion
    this.onMessage('challenge_complete', (client, data) => {
      if (this.worldState) {
        const challenge = this.worldState.completeChallenge(data.challengeId, client.sessionId);

        if (challenge) {
          this.broadcast('challenge_completed', {
            challengeId: data.challengeId,
            playerId: client.sessionId,
            challenge
          });

          console.log(`[GameRoom] Challenge completed: ${data.challengeId} by ${client.sessionId}`);
        }
      }
    });

    // Collectible pickup
    this.onMessage('collect', (client, data) => {
      this.broadcast('collectible_picked', {
        entityId: data.entityId,
        playerId: client.sessionId
      });
    });

    // Set simulation interval (physics tick)
    this.setSimulationInterval((deltaTime) => {
      // Server-side physics updates could go here
      // For now, clients handle their own physics
    }, 1000 / 60); // 60 FPS
  }

  onJoin(client, options) {
    const name = options.name || `Player-${client.sessionId.slice(0, 4)}`;
    const type = options.type || 'human';

    if (this.worldState) {
      const player = this.worldState.addPlayer(client.sessionId, name, type);

      // Send current state to new player
      client.send('init', {
        playerId: client.sessionId,
        worldState: this.worldState.getState()
      });

      // Broadcast new player to others
      this.broadcast('player_joined', player, { except: client });
    }

    console.log(`[GameRoom] ${name} joined (${type})`);
  }

  onLeave(client, consented) {
    if (this.worldState) {
      const player = this.worldState.players.get(client.sessionId);
      const name = player?.name || client.sessionId;

      this.worldState.removePlayer(client.sessionId);

      this.broadcast('player_left', { id: client.sessionId, name });
    }

    console.log(`[GameRoom] Player left: ${client.sessionId}`);
  }

  onDispose() {
    console.log(`[GameRoom] Room disposed`);
  }
}
