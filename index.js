import { Client, GatewayIntentBits, Partials, EmbedBuilder } from "discord.js";
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
import { placementRank, rxp, NEXT } from "./ranking.js";

// 1. Global Uncaught Error Handlers
process.on("unhandledRejection", (reason, promise) => {
  console.error("Unhandled Rejection at:", promise, "reason:", reason);
});

process.on("uncaughtException", (err) => {
  console.error("Uncaught Exception thrown:", err);
});

console.log("Starting bot...");

// 2. Initialize Discord Client
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.MessageContent,
  ],
  partials: [Partials.Channel, Partials.Message],
});

// 3. Ready Event
client.once("ready", () => {
  console.log(`✅ Logged in successfully as ${client.user.tag}! Bot is online.`);
});

// 4. Slash Command Handler
client.on("interactionCreate", async (interaction) => {
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

      const players = [
        ...t1Names.map((name) => ({ userId: user.id, username: name, team: 1 })),
        ...t2Names.map((name) => ({ userId: user.id, username: name, team: 2 })),
      ];

      const game = createGame(user.id, players);
      await interaction.editReply(`🎮 **Game #${game.id} started!**\n**Team 1:** ${t1Names.join(", ")}\n**Team 2:** ${t2Names.join(", ")}`);
    }

    /* ---------------- /submit ---------------- */
    else if (commandName === "submit") {
      await interaction.deferReply();
      const username = options.getString("username", true);
      const screenshot = options.getAttachment("screenshot", true);
      
      ensure(user.id);
      await interaction.editReply(`✅ Match result submitted for **${username}**! Image recorded.`);
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

    /* ---------------- /rm ---------------- */
    else if (commandName === "rm") {
      const targetUser = options.getUser("user") || user;
      const matches = recent(targetUser.id);

      if (!matches.length) {
        return interaction.reply({ content: `No recent matches found for ${targetUser.username}.`, ephemeral: true });
      }

      const list = matches
        .map((m) => `• **ID #${m.id}**: Score ${m.score_for}-${m.score_against} | K/D/A: ${m.kills}/${m.deaths}/${m.assists} | RXP: +${m.rxp}`)
        .join("\n");

      await interaction.reply({ content: `**Recent Matches for ${targetUser.username}:**\n${list}` });
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

    /* ---------------- /setrank ---------------- */
    else if (commandName === "setrank") {
      const targetUser = options.getUser("user", true);
      const newRank = options.getString("rank", true);

      ensure(targetUser.id);
      patch(targetUser.id, { rank: newRank });

      await interaction.reply({ content: `Updated rank for <@${targetUser.id}> to **${newRank}**.` });
    }

    /* ---------------- /setrating ---------------- */
    else if (commandName === "setrating") {
      const targetUser = options.getUser("user", true);
      const newRating = options.getNumber("rating", true);

      ensure(targetUser.id);
      patch(targetUser.id, { rating: newRating });

      await interaction.reply({ content: `Updated rating for <@${targetUser.id}> to **${newRating}**.` });
    }

    /* ---------------- /giverxp ---------------- */
    else if (commandName === "giverxp") {
      const targetUser = options.getUser("user", true);
      const amount = options.getInteger("amount", true);

      const p = ensure(targetUser.id);
      patch(targetUser.id, { rxp: p.rxp + amount });

      await interaction.reply({ content: `Gave **${amount} RXP** to <@${targetUser.id}>. Total: **${p.rxp + amount}**.` });
    }

    /* ---------------- /removerxp ---------------- */
    else if (commandName === "removerxp") {
      const targetUser = options.getUser("user", true);
      const amount = options.getInteger("amount", true);

      const p = ensure(targetUser.id);
      const newRxp = Math.max(0, p.rxp - amount);
      patch(targetUser.id, { rxp: newRxp });

      await interaction.reply({ content: `Removed **${amount} RXP** from <@${targetUser.id}>. Total: **${newRxp}**.` });
    }

    /* ---------------- /reset ---------------- */
    else if (commandName === "reset") {
      const targetUser = options.getUser("user", true);
      resetDb(targetUser.id);

      await interaction.reply({ content: `Successfully reset all stats and matches for <@${targetUser.id}>.` });
    }

    /* ---------------- /voidmatch ---------------- */
    else if (commandName === "voidmatch") {
      const matchId = options.getInteger("match_id", true);
      const res = voidMatch(matchId);

      if (!res) {
        return interaction.reply({ content: `Match ID **#${matchId}** was not found or is already voided.`, ephemeral: true });
      }

      await interaction.reply({ content: `Successfully voided Match **#${matchId}**.` });
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

// 5. Authentication & Login
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
