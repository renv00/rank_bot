import {
  player,
  ensure,
  placements,
  dup,
  match,
  placementAdd,
  patch,
  reset,
  recent,
  leaderboard,
  getMatch,
  voidMatch,
  createGame,
  getGame,
  activeGamesForPlayer,
  activeGame,
  completeGame,
} from "./db.js";

// Global error handlers (placed after imports)
process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection at:', promise, 'reason:', reason);
});

process.on('uncaughtException', (err) => {
  console.error('Uncaught Exception thrown:', err);
});

console.log("Starting bot...");

const token = process.env.DISCORD_TOKEN;

if (!token) {
  console.error("CRITICAL ERROR: process.env.DISCORD_TOKEN is undefined! Check variable name in FadeHost.");
  process.exit(1);
}

client.login(token).catch((err) => {
  console.error("FAILED TO LOGIN TO DISCORD:", err);
});
