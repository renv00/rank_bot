import Database from "better-sqlite3";
import path from "node:path";
import process from "node:process";

// Resolve an absolute path to avoid permission / working directory errors
const dbPath = path.resolve(process.cwd(), "ranked.sqlite");

let db;
try {
  db = new Database(dbPath);
  db.pragma("journal_mode=WAL");
} catch (err) {
  console.error("Failed to initialize SQLite database at:", dbPath, err);
  throw err;
}

db.exec(`
CREATE TABLE IF NOT EXISTS players (
  user_id TEXT PRIMARY KEY,
  rank TEXT NOT NULL DEFAULT 'Unranked',
  rating REAL,
  rxp INTEGER NOT NULL DEFAULT 0,
  wins INTEGER NOT NULL DEFAULT 0,
  losses INTEGER NOT NULL DEFAULT 0,
  kills INTEGER NOT NULL DEFAULT 0,
  deaths INTEGER NOT NULL DEFAULT 0,
  assists INTEGER NOT NULL DEFAULT 0,
  placement_games INTEGER NOT NULL DEFAULT 0,
  placement_complete INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS matches (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  image_hash TEXT,
  player_user_id TEXT,
  match_type TEXT,
  score_for INTEGER,
  score_against INTEGER,
  kills INTEGER,
  deaths INTEGER,
  assists INTEGER,
  placement INTEGER,
  won INTEGER,
  rxp INTEGER,
  image_url TEXT,
  voided INTEGER DEFAULT 0,
  created_at INTEGER
);

CREATE TABLE IF NOT EXISTS placements (
  user_id TEXT,
  match_id INTEGER,
  score_for INTEGER,
  score_against INTEGER
);

CREATE TABLE IF NOT EXISTS games (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  started_by TEXT NOT NULL,
  started_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'active',
  submitted_by TEXT,
  screenshot_hash TEXT,
  completed_at INTEGER
);

CREATE TABLE IF NOT EXISTS game_players (
  game_id INTEGER NOT NULL,
  user_id TEXT NOT NULL,
  username TEXT NOT NULL,
  team INTEGER NOT NULL,
  PRIMARY KEY (game_id, user_id)
);
`);

/* ---------------- PLAYERS ---------------- */

export function ensure(id) {
  db.prepare("INSERT OR IGNORE INTO players(user_id) VALUES(?)").run(id);
  return db.prepare("SELECT * FROM players WHERE user_id=?").get(id);
}

export function player(id) {
  return ensure(id);
}

/* ---------------- PLACEMENT ---------------- */

export function placements(id) {
  return db
    .prepare(
      `
    SELECT
      score_for AS scoreFor,
      score_against AS scoreAgainst
    FROM placements
    WHERE user_id=?
    ORDER BY rowid
  `,
    )
    .all(id);
}

export function placementAdd(uid, mid, sf, sa) {
  db.prepare(
    `
    INSERT INTO placements
    VALUES (?, ?, ?, ?)
  `,
  ).run(uid, mid, sf, sa);
}

/* ---------------- MATCHES ---------------- */

export function match(x) {
  const result = db
    .prepare(
      `
    INSERT INTO matches (
      image_hash,
      player_user_id,
      match_type,
      score_for,
      score_against,
      kills,
      deaths,
      assists,
      placement,
      won,
      rxp,
      image_url,
      created_at
    )
    VALUES (
      @hash,
      @uid,
      @type,
      @sf,
      @sa,
      @k,
      @d,
      @a,
      @p,
      @w,
      @rxp,
      @url,
      @now
    )
  `,
    )
    .run({
      ...x,
      now: Date.now(),
    });

  return result.lastInsertRowid;
}

/* ---------------- ACTIVE GAMES ---------------- */

export function createGame(startedBy, players) {
  const now = Date.now();

  const result = db
    .prepare(
      `
    INSERT INTO games (
      started_by,
      started_at,
      expires_at,
      status
    )
    VALUES (?, ?, ?, 'active')
  `,
    )
    .run(startedBy, now, now + 10 * 60 * 1000);

  const gameId = result.lastInsertRowid;

  const insertPlayer = db.prepare(`
    INSERT INTO game_players (
      game_id,
      user_id,
      username,
      team
    )
    VALUES (?, ?, ?, ?)
  `);

  const transaction = db.transaction(() => {
    for (const p of players) {
      insertPlayer.run(gameId, p.userId, p.username, p.team);
    }
  });

  transaction();

  return getGame(gameId);
}

export function getGame(id) {
  const game = db
    .prepare(
      `
    SELECT *
    FROM games
    WHERE id=?
  `,
    )
    .get(id);

  if (!game) return null;

  const players = db
    .prepare(
      `
    SELECT *
    FROM game_players
    WHERE game_id=?
    ORDER BY team, rowid
  `,
    )
    .all(id);

  return {
    ...game,
    players,
  };
}

export function activeGamesForPlayer(userId) {
  return db
    .prepare(
      `
    SELECT g.*
    FROM games g
    JOIN game_players gp
      ON gp.game_id = g.id
    WHERE gp.user_id=?
      AND g.status='active'
  `,
    )
    .all(userId);
}

export function activeGame(id) {
  const game = getGame(id);

  if (!game) return null;

  if (game.status === "active" && Date.now() > game.expires_at) {
    db.prepare(
      `
      UPDATE games
      SET status='expired'
      WHERE id=?
    `,
    ).run(id);

    return {
      ...game,
      status: "expired",
    };
  }

  return game;
}

export function completeGame(id, submittedBy, screenshotHash) {
  return db
    .prepare(
      `
    UPDATE games
    SET
      status='completed',
      submitted_by=?,
      screenshot_hash=?,
      completed_at=?
    WHERE id=?
      AND status='active'
  `,
    )
    .run(submittedBy, screenshotHash, Date.now(), id);
}

/* ---------------- DUPLICATE SCREENSHOTS ---------------- */

export function dup(hash) {
  return !!db
    .prepare(
      `
    SELECT 1
    FROM games
    WHERE screenshot_hash=?
    LIMIT 1
  `,
    )
    .get(hash);
}

/* ---------------- PLAYER UPDATES ---------------- */

export function patch(id, values) {
  const keys = Object.keys(values);

  if (!keys.length) {
    return player(id);
  }

  db.prepare(
    `
    UPDATE players
    SET ${keys.map((k) => `${k}=@${k}`).join(", ")}
    WHERE user_id=@id
  `,
  ).run({
    ...values,
    id,
  });

  return player(id);
}

/* ---------------- RESET ---------------- */

export function reset(id) {
  db.prepare(
    `
    DELETE FROM placements
    WHERE user_id=?
  `,
  ).run(id);

  db.prepare(
    `
    DELETE FROM matches
    WHERE player_user_id=?
  `,
  ).run(id);

  return patch(id, {
    rank: "Unranked",
    rating: null,
    rxp: 0,
    wins: 0,
    losses: 0,
    kills: 0,
    deaths: 0,
    assists: 0,
    placement_games: 0,
    placement_complete: 0,
  });
}

/* ---------------- STATS ---------------- */

export function recent(id) {
  return db
    .prepare(
      `
    SELECT *
    FROM matches
    WHERE player_user_id=?
      AND voided=0
    ORDER BY id DESC
    LIMIT 5
  `,
    )
    .all(id);
}

/* ---------------- LEADERBOARD ---------------- */

export function leaderboard() {
  return db
    .prepare(
      `
    SELECT *
    FROM players
    WHERE
      rank='Supreme'
      OR (
        rank='Elite'
        AND rating IN (9, 9.5)
      )
    ORDER BY rxp DESC
    LIMIT 100
  `,
    )
    .all();
}

/* ---------------- VOID ---------------- */

export function getMatch(id) {
  return db
    .prepare(
      `
    SELECT *
    FROM matches
    WHERE id=?
      AND voided=0
  `,
    )
    .get(id);
}

export function voidMatch(id) {
  const m = getMatch(id);

  if (!m) return null;

  db.prepare(
    `
    UPDATE matches
    SET voided=1
    WHERE id=?
  `,
  ).run(id);

  const p = player(m.player_user_id);

  patch(m.player_user_id, {
    rxp: Math.max(0, p.rxp - m.rxp),
    wins: Math.max(0, p.wins - (m.won ? 1 : 0)),
    losses: Math.max(0, p.losses - (m.won ? 0 : 1)),
    kills: Math.max(0, p.kills - m.kills),
    deaths: Math.max(0, p.deaths - m.deaths),
    assists: Math.max(0, p.assists - m.assists),
  });

  return m;
}
