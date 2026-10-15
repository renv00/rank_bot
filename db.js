import Database from "better-sqlite3";
import crypto from "crypto";

const db = new Database("bot.db");

// Initialize tables
db.exec(`
  CREATE TABLE IF NOT EXISTS players (
    user_id TEXT PRIMARY KEY,
    rank TEXT DEFAULT 'Amateur',
    rating REAL DEFAULT 6.0,
    rxp INTEGER DEFAULT 200,
    kills INTEGER DEFAULT 0,
    deaths INTEGER DEFAULT 0,
    assists INTEGER DEFAULT 0,
    wins INTEGER DEFAULT 0,
    losses INTEGER DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS registry (
    discord_id TEXT PRIMARY KEY,
    roblox_username TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS matches (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id TEXT,
    score_for INTEGER,
    score_against INTEGER,
    kills INTEGER,
    deaths INTEGER,
    assists INTEGER,
    rxp INTEGER,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS games (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    started_by TEXT,
    players TEXT,
    status TEXT DEFAULT 'pending',
    screenshot_url TEXT
  );

  CREATE TABLE IF NOT EXISTS pending_claims (
    game_id INTEGER,
    user_id TEXT,
    roblox_username TEXT
  );

  CREATE TABLE IF NOT EXISTS submitted_images (
    hash TEXT PRIMARY KEY,
    submitted_by TEXT,
    game_id INTEGER,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );
`);

export function ensure(userId) {
  let p = db.prepare("SELECT * FROM players WHERE user_id = ?").get(userId);
  if (!p) {
    db.prepare("INSERT INTO players (user_id) VALUES (?)").run(userId);
    p = db.prepare("SELECT * FROM players WHERE user_id = ?").get(userId);
  }
  return p;
}

export function player(userId) {
  return ensure(userId);
}

export function patch(userId, fields) {
  ensure(userId);
  const keys = Object.keys(fields);
  const values = Object.values(fields);
  const setClause = keys.map((k) => `${k} = ?`).join(", ");
  db.prepare(`UPDATE players SET ${setClause} WHERE user_id = ?`).run(...values, userId);
}

export function reset(userId) {
  db.prepare(`
    UPDATE players SET rank = 'Amateur', rating = 6.0, rxp = 200, kills = 0, deaths = 0, assists = 0, wins = 0, losses = 0 
    WHERE user_id = ?
  `).run(userId);
}

export function recent(userId) {
  return db.prepare("SELECT * FROM matches WHERE user_id = ? ORDER BY id DESC LIMIT 5").all(userId);
}

export function leaderboard() {
  return db.prepare("SELECT * FROM players ORDER BY rxp DESC LIMIT 10").all();
}

export function getMatch(matchId) {
  return db.prepare("SELECT * FROM matches WHERE id = ?").get(matchId);
}

export function voidMatch(matchId) {
  const m = getMatch(matchId);
  if (!m) return false;
  db.prepare("DELETE FROM matches WHERE id = ?").run(matchId);
  return true;
}

export function createGame(startedBy, playersList) {
  const stmt = db.prepare("INSERT INTO games (started_by, players, status) VALUES (?, ?, 'pending')");
  const info = stmt.run(startedBy, JSON.stringify(playersList));
  return { id: info.lastInsertRowid, started_by: startedBy, players: playersList };
}

export function getGame(gameId) {
  const g = db.prepare("SELECT * FROM games WHERE id = ?").get(gameId);
  if (!g) return null;
  return { ...g, players: JSON.parse(g.players) };
}

export function activeGamesForPlayer(userId) {
  const games = db.prepare("SELECT * FROM games WHERE status = 'pending'").all();
  return games.map(g => ({ ...g, players: JSON.parse(g.players) })).filter(g => 
    g.started_by === userId || g.players.some(p => (p.user_id || p.userId) === userId)
  );
}

export function activeGame(userId) {
  const games = db.prepare("SELECT * FROM games WHERE status = 'pending'").all();
  for (const g of games) {
    const players = JSON.parse(g.players);
    if (g.started_by === userId || players.some(p => (p.user_id || p.userId) === userId)) {
      return { ...g, players };
    }
  }
  return null;
}

export function completeGame(gameId, winnerId, screenshotUrl) {
  db.prepare("UPDATE games SET status = 'completed', screenshot_url = ? WHERE id = ?").run(screenshotUrl, gameId);
}

export function getRegistry(discordId) {
  return db.prepare("SELECT * FROM registry WHERE discord_id = ?").get(discordId);
}

export function setRegistry(discordId, robloxUsername) {
  db.prepare("INSERT OR REPLACE INTO registry (discord_id, roblox_username) VALUES (?, ?)").run(discordId, robloxUsername);
}

export function resetRegistry(discordId) {
  db.prepare("DELETE FROM registry WHERE discord_id = ?").run(discordId);
}

export function setPendingClaim(gameId, losersList) {
  const stmt = db.prepare("INSERT INTO pending_claims (game_id, user_id, roblox_username) VALUES (?, ?, ?)");
  for (const l of losersList) {
    stmt.run(gameId, l.user_id || l.userId, l.username);
  }
}

export function getPendingClaims(gameId) {
  return db.prepare("SELECT * FROM pending_claims WHERE game_id = ?").all(gameId);
}

export function isImageHashUsed(buffer) {
  const hash = crypto.createHash("sha256").update(buffer).digest("hex");
  const row = db.prepare("SELECT hash FROM submitted_images WHERE hash = ?").get(hash);
  return !!row;
}

export function recordImageHash(buffer, userId, gameId) {
  const hash = crypto.createHash("sha256").update(buffer).digest("hex");
  db.prepare("INSERT INTO submitted_images (hash, submitted_by, game_id) VALUES (?, ?, ?)").run(hash, userId, gameId);
}
