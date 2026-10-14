import {
  Client,
  GatewayIntentBits,
  Partials,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ComponentType,
} from "discord.js";
import {
  player,
  ensure,
  placements,
  placementAdd,
  match,
  patch,
  reset as resetDb,
  recent,
  leaderboard,
  getMatch,
  voidMatch,
  createGame,
  getGame,
  activeGame,
  completeGame,
} from "./db.js";

import { REST, Routes } from "discord.js";
import { config } from "./config.js"; // Ensure path matches your config file location

// Auto-register slash commands on startup
async function registerCommands() {
  try {
    console.log("Syncing slash commands with Discord...");
    
    // Import your command definitions from deploy-commands or define them directly
    const rest = new REST({ version: "10" }).setToken(process.env.DISCORD_TOKEN || config.token);

    // Runs command deployment directly
    await rest.put(
      Routes.applicationGuildCommands(config.clientId, config.guildId),
      { body: cmds.map((x) => x.toJSON()) }
    );

    console.log("✅ Slash commands registered successfully!");
  } catch (error) {
    console.error("Failed to register slash commands:", error);
  }
}

// Call registration on startup
registerCommands();
// Global error handlers
process.on("unhandledRejection", (reason, promise) => {
  console.error("Unhandled Rejection at:", promise, "reason:", reason);
});

process.on("uncaughtException", (err) => {
  console.error("Uncaught Exception thrown:", err);
});

console.log("Starting bot...");

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.MessageContent,
  ],
  partials: [Partials.Channel, Partials.Message],
});

client.once("ready", () => {
  console.log(`✅ Logged in successfully as ${client.user.tag}! Bot is online.`);
});

// Active game lobbies held in memory before match initialization
const activeLobbies = new Map();

client.on("interactionCreate", async (interaction) => {
  // Handle "Join" button clicks
  if (interaction.isButton()) {
    if (interaction.customId.startsWith("join_game_")) {
      const gameId = interaction.customId.replace("join_game_", "");
      const lobby = activeLobbies.get(gameId);

      if (!lobby) {
        return interaction.reply({ content: "This game lobby no longer exists.", ephemeral: true });
      }

      if (lobby.players.some((p) => p.id === interaction.user.id)) {
        return interaction.reply({ content: "You are already in this game!", ephemeral: true });
      }

      // Add joining player
      lobby.players.push({ id: interaction.user.id, username: interaction.user.username });

      // Update Embed & Counter
      const updatedEmbed = EmbedBuilder.from(interaction.message.embeds[0])
        .setDescription(`----------------------------------------\n\nWaiting for players to join...\n\n**Players (${lobby.players.length}/${lobby.maxPlayers}):**\n` +
          lobby.players.map((p, i) => `${i + 1}. <@${p.id}>`).join("\n"));

      const isFull = lobby.players.length >= lobby.maxPlayers;

      const updatedRow = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId(`join_game_${gameId}`)
          .setLabel(isFull ? "Game Full" : "Join")
          .setStyle(ButtonStyle.Success)
          .setDisabled(isFull)
      );

      await interaction.update({ embeds: [updatedEmbed], components: [updatedRow] });

      if (isFull) {
        activeLobbies.delete(gameId);
        await interaction.followUp({ content: `🎮 **Game #${gameId} is ready!** All players have joined.` });
      }
    }
    return;
  }

  if (!interaction.isChatInputCommand()) return;

  const { commandName, options, user } = interaction;

  try {
    /* ---------------- /startgame ---------------- */
    if (commandName === "startgame") {
      await interaction.deferReply();

      const rawT1 = options.getString("team1", true);
      const rawT2 = options.getString("team2", true);

      const t1Names = rawT1.split(",").map((s) => s.trim()).filter(Boolean);
      const t2Names = rawT2.split(",").map((s) => s.trim()).filter(Boolean);

      const maxPlayers = t1Names.length + t2Names.length;
      const gameId = Date.now().toString().slice(-6);

      // Store lobby in memory
      activeLobbies.set(gameId, {
        host: user.id,
        maxPlayers: maxPlayers || 2,
        players: [{ id: user.id, username: user.username }],
      });

      // Build Pending Game Embed
      const embed = new EmbedBuilder()
        .setTitle("Pending game")
        .setColor(0x2b2d31)
        .setDescription(
          `----------------------------------------\n\nWaiting for players to join...\n\n**Players (1/${maxPlayers || 2}):**\n1. <@${user.id}>`
        );

      const joinButton = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId(`join_game_${gameId}`)
          .setLabel("Join")
          .setStyle(ButtonStyle.Success)
      );

      await interaction.editReply({ embeds: [embed], components: [joinButton] });
    }

    /* ---------------- /stats ---------------- */
    else if (commandName === "stats") {
      const targetUser = options.getUser("user") || user;
      const p = player(targetUser.id);

      const embed = new EmbedBuilder()
        .setTitle(`Stats for ${targetUser.username}`)
        .setColor(0x00aeef)
        .addFields(
          { name: "Rank", value: `${p.rank}`, inline: true },
          { name: "Rating", value: `${p.rating ?? "N/A"}`, inline: true },
          { name: "RXP", value: `${p.rxp}`, inline: true },
          { name: "W / L", value: `${p.wins} / ${p.losses}`, inline: true },
          { name: "K / D / A", value: `${p.kills} / ${p.deaths} / ${p.assists}`, inline: true }
        );

      await interaction.reply({ embeds: [embed] });
    }

    /* ---------------- /lb ---------------- */
    else if (commandName === "lb") {
      const top = leaderboard();
      if (!top.length) {
        return interaction.reply({ content: "The leaderboard is currently empty.", ephemeral: true });
      }

      const list = top
        .slice(0, 10)
        .map((p, i) => `${i + 1}. <@${p.user_id}> - **${p.rank}** (${p.rxp} RXP)`)
        .join("\n");

      await interaction.reply({ content: `🏆 **Ranked Leaderboard**\n${list}` });
    }

    /* ---------------- /reset ---------------- */
    else if (commandName === "reset") {
      const targetUser = options.getUser("user", true);
      resetDb(targetUser.id);

      await interaction.reply({ content: `Successfully reset all stats and matches for <@${targetUser.id}>.` });
    }

  } catch (error) {
    console.error("Error executing command:", error);

    if (interaction.replied || interaction.deferred) {
      await interaction.followUp({ content: "There was an error executing this command!", ephemeral: true });
    } else {
      await interaction.reply({ content: "There was an error executing this command!", ephemeral: true });
    }
  }
});

const token = process.env.DISCORD_TOKEN;

if (!token) {
  console.error("CRITICAL ERROR: process.env.DISCORD_TOKEN is undefined!");
  process.exit(1);
}

client.login(token).catch((err) => {
  console.error("FAILED TO LOGIN TO DISCORD:", err);
});
