import { Client, GatewayIntentBits, Partials } from "discord.js";
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

// 1. Global Uncaught Error Handlers
process.on("unhandledRejection", (reason, promise) => {
  console.error("Unhandled Rejection at:", promise, "reason:", reason);
});

process.on("uncaughtException", (err) => {
  console.error("Uncaught Exception thrown:", err);
});

console.log("Starting bot...");

// 2. INITIALIZE CLIENT FIRST
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.MessageContent,
  ],
  partials: [Partials.Channel, Partials.Message],
});

// 3. READY EVENT
client.once("ready", () => {
  console.log(`✅ Logged in successfully as ${client.user.tag}! Bot is online.`);
});

// 4. SLASH COMMAND HANDLER (must come AFTER client is initialized)
client.on("interactionCreate", async (interaction) => {
  if (!interaction.isChatInputCommand()) return;

  try {
    if (interaction.commandName === "ping") {
      await interaction.reply({ content: "Pong!", ephemeral: true });
    }
    // Add additional slash command logic here
  } catch (error) {
    console.error("Error executing command:", error);

    if (interaction.replied || interaction.deferred) {
      await interaction.followUp({ content: "There was an error executing this command!", ephemeral: true });
    } else {
      await interaction.reply({ content: "There was an error executing this command!", ephemeral: true });
    }
  }
});

// 5. AUTHENTICATION & LOGIN
const token = process.env.DISCORD_TOKEN;

if (!token) {
  console.error(
    "CRITICAL ERROR: process.env.DISCORD_TOKEN is undefined! Check variable name in FadeHost environment settings."
  );
  process.exit(1);
}

client.login(token).catch((err) => {
  console.error("FAILED TO LOGIN TO DISCORD:", err);
});
