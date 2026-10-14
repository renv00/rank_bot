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
