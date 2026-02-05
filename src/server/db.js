/**
 * Database Module - PostgreSQL persistence with graceful fallback
 *
 * If DATABASE_URL is set, connects to PostgreSQL and auto-creates tables.
 * If not set, all functions are no-ops (dev mode works without Postgres).
 */

import pg from 'pg';
const { Pool } = pg;

let pool = null;
let dbAvailable = false;

const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id            TEXT PRIMARY KEY,
  name          TEXT NOT NULL,
  type          TEXT DEFAULT 'human',
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  last_seen     TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS leaderboard (
  user_id       TEXT PRIMARY KEY REFERENCES users(id),
  name          TEXT NOT NULL,
  wins          INTEGER DEFAULT 0,
  total_score   INTEGER DEFAULT 0,
  games_played  INTEGER DEFAULT 0,
  updated_at    TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS game_history (
  id            TEXT PRIMARY KEY,
  game_type     TEXT NOT NULL,
  started_at    TIMESTAMPTZ DEFAULT NOW(),
  ended_at      TIMESTAMPTZ,
  duration_ms   INTEGER,
  result        TEXT,
  winner_id     TEXT,
  player_count  INTEGER,
  scores        JSONB DEFAULT '{}'
);
`;

export async function initDB() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.log('[DB] No DATABASE_URL set — running in-memory only');
    return false;
  }

  try {
    pool = new Pool({ connectionString: url });
    await pool.query('SELECT 1');
    await pool.query(SCHEMA);
    dbAvailable = true;
    console.log('[DB] PostgreSQL connected, tables ready');
    return true;
  } catch (err) {
    console.error('[DB] Connection failed, falling back to in-memory:', err.message);
    pool = null;
    dbAvailable = false;
    return false;
  }
}

export function isDBAvailable() {
  return dbAvailable;
}

// --- Users ---

export async function upsertUser(id, name, type = 'human') {
  if (!dbAvailable) return;
  try {
    await pool.query(
      `INSERT INTO users (id, name, type, last_seen)
       VALUES ($1, $2, $3, NOW())
       ON CONFLICT (id) DO UPDATE SET name = $2, last_seen = NOW()`,
      [id, name, type]
    );
  } catch (err) {
    console.error('[DB] upsertUser error:', err.message);
  }
}

// --- Leaderboard ---

export async function updateLeaderboard(userId, name, won, score) {
  if (!dbAvailable) return;
  try {
    await pool.query(
      `INSERT INTO leaderboard (user_id, name, wins, total_score, games_played, updated_at)
       VALUES ($1, $2, $3, $4, 1, NOW())
       ON CONFLICT (user_id) DO UPDATE SET
         name = $2,
         wins = leaderboard.wins + $3,
         total_score = leaderboard.total_score + $4,
         games_played = leaderboard.games_played + 1,
         updated_at = NOW()`,
      [userId, name, won ? 1 : 0, score]
    );
  } catch (err) {
    console.error('[DB] updateLeaderboard error:', err.message);
  }
}

export async function loadLeaderboard() {
  if (!dbAvailable) return [];
  try {
    const result = await pool.query(
      `SELECT user_id AS id, name, wins, total_score AS "totalScore", games_played AS "gamesPlayed"
       FROM leaderboard
       ORDER BY wins DESC, total_score DESC
       LIMIT 10`
    );
    return result.rows;
  } catch (err) {
    console.error('[DB] loadLeaderboard error:', err.message);
    return [];
  }
}

// --- Game History ---

export async function saveGameHistory(game) {
  if (!dbAvailable) return;
  try {
    await pool.query(
      `INSERT INTO game_history (id, game_type, started_at, ended_at, duration_ms, result, winner_id, player_count, scores)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [
        game.id,
        game.type,
        new Date(game.startTime),
        new Date(),
        Date.now() - game.startTime,
        game.result,
        game.winnerId || null,
        game.playerCount,
        JSON.stringify(game.scores)
      ]
    );
  } catch (err) {
    console.error('[DB] saveGameHistory error:', err.message);
  }
}

// --- Stats ---

export async function getStats() {
  if (!dbAvailable) {
    return { totalGames: 0, totalPlayers: 0, dbConnected: false };
  }
  try {
    const [games, players] = await Promise.all([
      pool.query('SELECT COUNT(*) AS count FROM game_history'),
      pool.query('SELECT COUNT(*) AS count FROM users')
    ]);
    return {
      totalGames: parseInt(games.rows[0].count),
      totalPlayers: parseInt(players.rows[0].count),
      dbConnected: true
    };
  } catch (err) {
    console.error('[DB] getStats error:', err.message);
    return { totalGames: 0, totalPlayers: 0, dbConnected: false };
  }
}

export async function closeDB() {
  if (pool) {
    await pool.end();
    console.log('[DB] Connection pool closed');
  }
}
