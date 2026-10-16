import "dotenv/config";
import {
  Client,
  GatewayIntentBits,
  Partials,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  REST,
  Routes,
  SlashCommandBuilder,
  PermissionFlagsBits,
} from "discord.js";
import OpenAI from "openai";
import crypto from "crypto";

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
  getActiveGameForHost,
  activeGamesForPlayer,
  completeGame,
  getRegistry,
  setRegistry,
  resetRegistry,
  setPendingClaim,
  getPendingClaims,
  isImageHashUsed,
  recordImageHash,
  getPlayerMatchCount,
} from "./db.js";

import { placementRank, rxp } from "./ranking.js";
import { getRxpDisplay, checkRankProgression } from "./progression.js";

// Initialize OpenAI Client pointing to OpenRouter API
const openrouterKey = process.env.OPENROUTER_API_KEY?.trim();

if (!openrouterKey) {
  console.error("⚠️ WARNING: OPENROUTER_API_KEY is not set in environment variables!");
} else {
  console.log("🔑 OpenRouter API Key loaded successfully!");
}

const openai = new OpenAI({
  baseURL: "https://openrouter.ai/api/v1",
  apiKey: openrouterKey || "",
});

// ---------------- GLOBAL ERROR HANDLERS ----------------
process.on("unhandledRejection", (reason, promise) => {
  console.error("Unhandled Rejection at:", promise, "reason:", reason);
});

process.on("uncaughtException", (err) => {
  console.error("Uncaught Exception thrown:", err);
});

console.log("Starting bot...");

// ---------------- CLIENT SETUP ----------------
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.MessageContent,
  ],
  partials: [Partials.Channel, Partials.Message],
});

const activeLobbies = new Map();

// ---------------- AUTOMATIC COMMAND REGISTRATION ----------------
const ranks = ["Unranked", "Amateur", "Contender", "Comp", "Elite", "Supreme"];

const commandDefinitions = [
  new SlashCommandBuilder()
    .setName("help")
    .setDescription("View a guide on how to use all available commands"),

  new SlashCommandBuilder()
    .setName("startgame")
    .setDescription("Start a ranked game")
    .addStringOption((o) =>
      o.setName("team1").setDescription("Tag Team 1 members (e.g. @user1, @user2)").setRequired(true)
    )
    .addStringOption((o) =>
      o.setName("team2").setDescription("Tag Team 2 members (e.g. @user3, @user4)").setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName("register")
    .setDescription("Register your exact Roblox username")
    .addStringOption((o) =>
      o.setName("username").setDescription("Your exact Roblox Username").setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName("submit")
    .setDescription("Submit a result screenshot")
    .addAttachmentOption((o) =>
      o.setName("screenshot").setDescription("Result screenshot showing Duel History").setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName("claim")
    .setDescription("Claim RXP if your team lost the recent match")
    .addStringOption((o) =>
      o.setName("username").setDescription("Your registered Roblox Username").setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName("reset-registry")
    .setDescription("Staff: allow a user to re-register their Roblox account")
    .addUserOption((o) => o.setName("user").setDescription("Target Discord User").setRequired(true))
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),

  new SlashCommandBuilder()
    .setName("")
    .setDescription("View ")
    .addUserOption((o) => o.setName("user").setDescription("Player")),

  new SlashCommandBuilder()
    .setName("rm")
    .setDescription("Recent matches")
    .addUserOption((o) => o.setName("user").setDescription("Player")),

  new SlashCommandBuilder().setName("lb").setDescription("Leaderboard"),

  new SlashCommandBuilder()
    .setName("setrank")
    .setDescription("Staff: set rank")
    .addUserOption((o) => o.setName("user").setDescription("Player").setRequired(true))
    .addStringOption((o) =>
      o.setName("rank").setDescription("Rank").setRequired(true).addChoices(...ranks.map((x) => ({ name: x, value: x })))
    )
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),

  new SlashCommandBuilder()
    .setName("setrating")
    .setDescription("Staff: set rating")
    .addUserOption((o) => o.setName("user").setDescription("Player").setRequired(true))
    .addNumberOption((o) =>
      o.setName("rating").setDescription("6-9.5").setMinValue(6).setMaxValue(9.5).setRequired(true)
    )
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),

  new SlashCommandBuilder()
    .setName("giverxp")
    .setDescription("Staff: give RXP")
    .addUserOption((o) => o.setName("user").setDescription("Player").setRequired(true))
    .addIntegerOption((o) => o.setName("amount").setDescription("Amount").setMinValue(1).setRequired(true))
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),

  new SlashCommandBuilder()
    .setName("removerxp")
    .setDescription("Staff: remove RXP")
    .addUserOption((o) => o.setName("user").setDescription("Player").setRequired(true))
    .addIntegerOption((o) => o.setName("amount").setDescription("Amount").setMinValue(1).setRequired(true))
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),

  new SlashCommandBuilder()
    .setName("reset")
    .setDescription("Staff: reset player")
    .addUserOption((o) => o.setName("user").setDescription("Player").setRequired(true))
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),

  new SlashCommandBuilder()
    .setName("voidmatch")
    .setDescription("Staff: void match")
    .addIntegerOption((o) => o.setName("match_id").setDescription("Match ID").setMinValue(1).setRequired(true))
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),
];

client.once("ready", async () => {
  console.log(`✅ Logged in successfully as ${client.user.tag}! Bot is online.`);

  try {
    const rest = new REST({ version: "10" }).setToken(process.env.DISCORD_TOKEN);

    const guilds = await client.guilds.fetch();
    for (const [guildId] of guilds) {
      await rest.put(Routes.applicationGuildCommands(client.user.id, guildId), { body: [] });
    }
    console.log("🧹 Cleared old guild-specific command duplicates.");

    console.log("Syncing global slash commands with Discord...");
    await rest.put(Routes.applicationCommands(client.user.id), {
      body: commandDefinitions.map((cmd) => cmd.toJSON()),
    });
    console.log("✅ Global slash commands successfully synced!");
  } catch (err) {
    console.error("Failed to sync slash commands:", err);
  }
});

// ---------------- INTERACTION HANDLER ----------------
client.on("interactionCreate", async (interaction) => {
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

      lobby.players.push({ id: interaction.user.id, username: interaction.user.username });

      const updatedEmbed = EmbedBuilder.from(interaction.message.embeds[0]).setDescription(
        `----------------------------------------\n\nWaiting for players to join...\n\n**Team 1:** ${lobby.t1Pings}\n**Team 2:** ${lobby.t2Pings}\n\n**Players Joined (${lobby.players.length}/${lobby.maxPlayers}):**\n` +
          lobby.players.map((p, i) => `${i + 1}. <@${p.id}>`).join("\n")
      );

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

  // 🛡️ RESTRICTION: Unregistered users can only use /register, /, /lb, and /help
  const allowedWithoutRegistration = ["register", "stats", "lb", "help"];
  const registryCheck = getRegistry(user.id);

  if (!registryCheck && !allowedWithoutRegistration.includes(commandName)) {
    return interaction.reply({
      content: "❌ You must register your Roblox username first! Please run `/register <roblox_username>` before using this command.",
      ephemeral: true,
    });
  }

  try {
    /* ---------------- /help ---------------- */
    if (commandName === "help") {
      const embed = new EmbedBuilder()
        .setTitle("📖  |    Ranked Bot Command Guide")
        .setColor(0x0b0b0b)
        .setDescription("Welcome to the Ranked Matchmaking Bot! Below is a complete list of commands and how to use them.")
        .addFields(
          {
            name: "👤 Player Commands",
            value: 
              "`/register <username>` — Register your exact Roblox username to play.\n" +
              "`/stats [user]` — View rank, rating, RXP progress, KDA, and W/L statistics.\n" +
              "`/lb` — Display the top 10 ranked leaderboard.\n" +
              "`/rm [user]` — View a list of recent matches played by a user.",
            inline: false
          },
          {
            name: "⚔️ Game & Matchmaking Commands",
            value: 
              "`/startgame <team1> <team2>` — Tag Team 1 and Team 2 members (e.g., `@user1 @user2`) to create an active match session.\n" +
              "`/submit <screenshot>` — *(Host Only)* Upload your **Duel History** screenshot to verify and auto-award match results.\n" +
              "`/claim <username>` — Claim participation RXP if your team lost the recent match.",
            inline: false
          },
          {
            name: "🛠️ Staff / Admin Commands",
            value: 
              "`/setrank <user> <rank>` — Override a player's current rank.\n" +
              "`/setrating <user> <rating>` — Set a player's rating (6.0 - 9.5).\n" +
              "`/giverxp <user> <amount>` — Grant bonus RXP to a player.\n" +
              "`/removerxp <user> <amount>` — Deduct RXP from a player.\n" +
              "`/reset-registry <user>` — Clear a user's registered Roblox account so they can re-register.\n" +
              "`/reset <user>` — Reset all stats, rank, and match history for a user.\n" +
              "`/voidmatch <match_id>` — Void a previously recorded match by ID.",
            inline: false
          }
        )
        .setFooter({ text: "Run /register <username> to start playing!" });

      await interaction.reply({ embeds: [embed] });
    }

    /* ---------------- /register ---------------- */
    else if (commandName === "register") {
      const username = options.getString("username", true).trim();
      const existing = getRegistry(user.id);

      if (existing) {
        return interaction.reply({
          content: `❌ You are already registered as **${existing.roblox_username}**. Contact staff to reset your registry.`,
          ephemeral: true,
        });
      }

      setRegistry(user.id, username);
      ensure(user.id);

      return interaction.reply({
        content: `✅ Successfully registered your Roblox username as **${username}**!`,
        ephemeral: true,
      });
    }

    /* ---------------- /reset-registry ---------------- */
    else if (commandName === "reset-registry") {
      const targetUser = options.getUser("user", true);
      resetRegistry(targetUser.id);

      return interaction.reply({
        content: `✅ Registry cleared for <@${targetUser.id}>. They can now run \`/register\` again.`,
      });
    }

    /* ---------------- /startgame ---------------- */
    else if (commandName === "startgame") {
      await interaction.deferReply();

      const rawT1 = options.getString("team1", true);
      const rawT2 = options.getString("team2", true);

      const extractUserIds = (text) => {
        const matches = [...text.matchAll(/(?:<@!?(\d+)>|(\d{17,20}))/g)];
        return matches.map((m) => m[1] || m[2]).filter(Boolean);
      };

      const t1Ids = extractUserIds(rawT1);
      const t2Ids = extractUserIds(rawT2);

      if (!t1Ids.length || !t2Ids.length) {
        return interaction.editReply("❌ Please tag at least one valid Discord user (@mention) for each team!");
      }

      const allMentionIds = [...t1Ids, ...t2Ids];
      const uniqueIds = [...new Set(allMentionIds)];
      const unregistered = [];
      const gamePlayers = [];

      for (const id of uniqueIds) {
        const reg = getRegistry(id);
        if (!reg) {
          unregistered.push(`<@${id}>`);
        }
      }

      if (unregistered.length > 0) {
        return interaction.editReply(
          `❌ Cannot start game! The following player(s) must run \`/register\` first: ${unregistered.join(", ")}`
        );
      }

      for (const id of t1Ids) {
        const reg = getRegistry(id);
        gamePlayers.push({ userId: id, username: reg.roblox_username, team: 1 });
      }
      for (const id of t2Ids) {
        const reg = getRegistry(id);
        gamePlayers.push({ userId: id, username: reg.roblox_username, team: 2 });
      }

      const game = createGame(user.id, gamePlayers);
      const gameId = game.id.toString();

      const t1Pings = t1Ids.map((id) => `<@${id}>`).join(", ");
      const t2Pings = t2Ids.map((id) => `<@${id}>`).join(", ");

      const embed = new EmbedBuilder()
        .setTitle(`⚔️ Active Ranked Game #${gameId}`)
        .setColor(0x2b2d31)
        .setDescription(
          `----------------------------------------\n\n**Team 1:** ${t1Pings}\n**Team 2:** ${t2Pings}\n\n📌 **Host (@${getRegistry(user.id).roblox_username}):** Play your match, take a screenshot of the **Duel History**, and run \`/submit\` to record the results.`
        );

      await interaction.editReply({ embeds: [embed] });
    }

    /* ---------------- /submit HANDLER ---------------- */
    else if (commandName === "submit") {
      await interaction.deferReply();

      if (!openrouterKey) {
        return interaction.editReply(
          "❌ **Bot Configuration Error:** `OPENROUTER_API_KEY` environment variable is missing!"
        );
      }

      const reg = getRegistry(user.id);
      if (!reg) {
        return interaction.editReply(
          "❌ You must run `/register <roblox_username>` before submitting match results!"
        );
      }

      const activeGame = getActiveGameForHost(user.id);
      if (!activeGame) {
        return interaction.editReply(
          "❌ You do not have an active game lobby waiting for a submission! Start a new game using `/startgame` first."
        );
      }

      const attachment = options.getAttachment("screenshot", true);

      let imageBuffer;
      try {
        const response = await fetch(attachment.url);
        const arrayBuffer = await response.arrayBuffer();
        imageBuffer = Buffer.from(arrayBuffer);
      } catch (err) {
        return interaction.editReply("❌ Failed to download the attached image file.");
      }

      if (isImageHashUsed(imageBuffer)) {
        return interaction.editReply(
          "❌ **Duplicate Submission Detected:** This exact screenshot image has already been submitted to the bot!"
        );
      }

      let analysis;
      try {
        const expectedUsernames = activeGame.players.map((p) => p.username).join(", ");
        const base64Image = imageBuffer.toString("base64");
        const mimeType = attachment.contentType || "image/png";

        const response = await openai.chat.completions.create({
          model: "google/gemini-2.0-flash-lite-preview-02-05:free",
          messages: [
            {
              role: "user",
              content: [
                {
                  type: "text",
                  text: `Analyze this image carefully.
1. Is this a Roblox game scoreboard / 'Duel History' results screen?
2. Is the registered host username '${reg.roblox_username}' clearly visible on the scoreboard?
3. Are all these lobby participants (${expectedUsernames}) present on the scoreboard?
4. Did the host '${reg.roblox_username}' WIN this match?

Respond ONLY with raw valid JSON, no markdown codeblock formatting:
{"isDuelHistory": boolean, "usernameFound": boolean, "allPlayersVerified": boolean, "hostWon": boolean}`,
                },
                {
                  type: "image_url",
                  image_url: { url: `data:${mimeType};base64,${base64Image}` },
                },
              ],
            },
          ],
        });

        let rawText = response.choices[0]?.message?.content?.trim() || "";
        if (rawText.startsWith("```json")) {
          rawText = rawText.replace(/^```json/, "").replace(/```$/, "").trim();
        } else if (rawText.startsWith("```")) {
          rawText = rawText.replace(/^```/, "").replace(/```\$/, "").trim();
        }

        analysis = JSON.parse(rawText);
      } catch (err) {
        console.error("OpenRouter API Error:", err);
        return interaction.editReply(`❌ Failed to analyze screenshot with AI Vision: ${err.message}`);
      }

      if (!analysis.isDuelHistory || !analysis.usernameFound || !analysis.allPlayersVerified) {
        return interaction.editReply(
          "❌ **Verification Failed:** The screenshot could not be verified as a valid Duel History matching your active lobby roster."
        );
      }

      recordImageHash(imageBuffer, user.id, activeGame.id);
      completeGame(activeGame.id, user.id, attachment.url);

      const hostWon = analysis.hostWon;
      const hostTeam = activeGame.players.find((p) => (p.user_id || p.userId) === user.id)?.team || 1;
      const winners = activeGame.players.filter((p) => p.team === (hostWon ? hostTeam : hostTeam === 1 ? 2 : 1));
      const losers = activeGame.players.filter((p) => p.team !== (hostWon ? hostTeam : hostTeam === 1 ? 2 : 1));

      for (const w of winners) {
        const targetId = w.user_id || w.userId;
        const p = ensure(targetId);
        const matchCount = getPlayerMatchCount(targetId);

        if (matchCount < 5) {
          match(targetId, 5, hostWon ? 0 : 2, 5, 2, 2, 25);
          
          const updatedMatchesCount = getPlayerMatchCount(targetId);
          if (updatedMatchesCount === 5) {
            const userMatches = placements(targetId);
            const formattedMatches = userMatches.map(m => ({ scoreFor: m.score_for, scoreAgainst: m.score_against }));
            const placementResult = placementRank(formattedMatches);

            if (placementResult) {
              const [assignedRank, assignedRating] = placementResult;
              const startingRxp = assignedRank === "Contender" ? 400 : 200;
              patch(targetId, { rank: assignedRank, rating: assignedRating, rxp: startingRxp, wins: p.wins + 1 });
            } else {
              patch(targetId, { rank: "Amateur", rating: 6.0, rxp: 200, wins: p.wins + 1 });
            }
          } else {
            patch(targetId, { wins: p.wins + 1 });
          }
        } else {
          const earnedRxp = rxp({ sf: 5, sa: 0, k: 5, d: 2, a: 2, place: 1 });
          const updatedData = checkRankProgression({
            rank: p.rank || "Amateur",
            rxp: (p.rxp || 200) + earnedRxp,
            rating: p.rating || 6.0
          });

          patch(targetId, { 
            rxp: updatedData.rxp, 
            rank: updatedData.rank, 
            rating: updatedData.rating, 
            wins: p.wins + 1 
          });
        }
      }

      if (!hostWon) {
        setPendingClaim(activeGame.id, losers);
        const loserPings = losers.map((l) => `<@${l.user_id || l.userId}>`).join(", ");
        return interaction.editReply(
          ` Match result recorded!\n🏆 **Winning Team verified.**\n📢 ${loserPings}: Your team lost. Run \`/claim "roblox_username"\` to claim participation RXP!`
        );
      }

      return interaction.editReply(
        ` Match result recorded!\n🏆 **VICTORY verified for host @${reg.roblox_username}!** Roster rewards processed successfully.`
      );
    }

    /* ---------------- /claim ---------------- */
    else if (commandName === "claim") {
      const username = options.getString("username", true).trim();
      const reg = getRegistry(user.id);

      if (!reg || reg.roblox_username.toLowerCase() !== username.toLowerCase()) {
        return interaction.reply({
          content: `❌ Username mismatch! Your registered username is **${reg?.roblox_username || "None"}**.`,
          ephemeral: true,
        });
      }

      const p = ensure(user.id);
      patch(user.id, { rxp: p.rxp + 15, losses: p.losses + 1 });

      return interaction.reply({
        content: `✅ Claim successful! Added +15 RXP and recorded match participation for **${username}**.`,
      });
    }

/* ---------------- /stats ---------------- */
    else if (commandName === "stats") {
      // Defer reply immediately so Discord doesn't time out
      await interaction.deferReply();

      try {
        const targetUser = options.getUser("user") || user;
        const targetMember = interaction.guild ? await interaction.guild.members.fetch(targetUser.id).catch(() => null) : null;
        
        const displayName = targetMember?.displayName || targetUser.username;
        const reg = getRegistry(targetUser.id);

        let rankDisplay = "Unranked";
        let ratingDisplay = "N/A";
        let rxpDisplay = "N/A";
        let kdaDisplay = "N/A";
        let wlDisplay = "N/A";
        let robloxTag = "@Unregistered";

        if (reg) {
          robloxTag = `@${reg.roblox_username}`;
          const p = player(targetUser.id);
          rankDisplay = p.rank || "Unranked";
          ratingDisplay = p.rating !== null && p.rating !== undefined ? p.rating : "N/A";
          rxpDisplay = rankDisplay === "Unranked" ? `${p.rxp || 0} / 100` : getRxpDisplay(rankDisplay, p.rxp || 0);
          kdaDisplay = `${p.kills || 0} / ${p.deaths || 0} / ${p.assists || 0}`;
          wlDisplay = `${p.wins || 0} / ${p.losses || 0}`;
        }

        const embed = new EmbedBuilder()
          .setTitle("📊  |    Player Statistics")
          .setColor(0x0b0b0b)
          .setThumbnail(targetUser.displayAvatarURL({ extension: "png", size: 256 }))
          .addFields(
            { name: "Player", value: `**${displayName}**\n${robloxTag}`, inline: false },
            { name: "Rank", value: `${rankDisplay}`, inline: true },
            { name: "Rating", value: `${ratingDisplay}`, inline: true },
            { name: "RXP Progress", value: `${rxpDisplay}`, inline: true },
            { name: "K / D / A", value: `${kdaDisplay}`, inline: true },
            { name: "W / L", value: `${wlDisplay}`, inline: true }
          );

        await interaction.editReply({ embeds: [embed] });
      } catch (err) {
        console.error("Error in /stats command:", err);
        await interaction.editReply({ content: "❌ An error occurred while fetching statistics." });
      }
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

// ---------------- AUTHENTICATION & LOGIN ----------------
const token = process.env.DISCORD_TOKEN;

if (!token) {
  console.error("CRITICAL ERROR: process.env.DISCORD_TOKEN is undefined!");
  process.exit(1);
}

client.login(token).catch((err) => {
  console.error("FAILED TO LOGIN TO DISCORD:", err);
});
