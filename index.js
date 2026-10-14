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

client.on("interactionCreate", async (interaction) => {
  // Only handle slash commands
  if (!interaction.isChatInputCommand()) return;

  try {
    // Example test command response
    if (interaction.commandName === "ping") {
      await interaction.reply({ content: "Pong!", ephemeral: true });
    }
    
    // Add logic for your other commands here...

  } catch (error) {
    console.error("Error executing command:", error);

    // Reply or followUp so Discord doesn't display "application did not respond"
    if (interaction.replied || interaction.deferred) {
      await interaction.followUp({ content: "There was an error executing this command!", ephemeral: true });
    } else {
      await interaction.reply({ content: "There was an error executing this command!", ephemeral: true });
    }
  }
});

// 1. Register global uncaught error listeners
process.on("unhandledRejection", (reason, promise) => {
  console.error("Unhandled Rejection at:", promise, "reason:", reason);
});

process.on("uncaughtException", (err) => {
  console.error("Uncaught Exception thrown:", err);
});

console.log("Starting bot...");

// 2. Initialize the Discord Client with standard Gateway Intents
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.MessageContent,
  ],
  partials: [Partials.Channel, Partials.Message],
});

// 3. Optional: Event listener when the bot logs in successfully
client.once("ready", () => {
  console.log(`✅ Logged in successfully as ${client.user.tag}! Bot is online.`);
});

// 4. Check for Discord Token in Environment Variables
const token = process.env.DISCORD_TOKEN;

if (!token) {
  console.error(
    "CRITICAL ERROR: process.env.DISCORD_TOKEN is undefined! Check variable name in FadeHost environment settings."
  );
  process.exit(1);
}

// 5. Authenticate and Log In
client.login(token).catch((err) => {
  console.error("FAILED TO LOGIN TO DISCORD:", err);
});
