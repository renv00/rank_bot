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
  MessageFlags,
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

// In-memory state tracking
const activeLobbies = new Map();
const hostCooldowns = new Map(); // Tracks host cooldown timestamps (10 mins)

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
    .setName("stats")
    .setDescription("View stats")
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
      o
        .setName("rank")
        .setDescription("Rank")
        .setRequired(true)
        .addChoices(
          ...ranks
            .filter((x) => typeof x === "string" && x.trim().length > 0)
            .map((x) => ({ name: x, value: x }))
        )
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
  /* ---------------- BUTTON JOIN HANDLER ---------------- */
  if (interaction.isButton()) {
    if (interaction.customId.startsWith("join_game_")) {
      const gameId = interaction.customId.replace("join_game_", "");
      const lobby = activeLobbies.get(gameId);

      if (!lobby) {
        return interaction.reply({ content: "❌ This game lobby no longer exists or has expired.", flags: MessageFlags.Ephemeral });
      }

      if (!lobby.requiredIds.includes(interaction.user.id)) {
        return interaction.reply({
          content: "❌ You are not tagged in this game's roster!",
          flags: MessageFlags.Ephemeral,
        });
      }

      if (lobby.acceptedIds.has(interaction.user.id)) {
        return interaction.reply({ content: " You have already accepted and joined this game lobby!", flags: MessageFlags.Ephemeral });
      }

      lobby.acceptedIds.add(interaction.user.id);

      const allJoined = lobby.requiredIds.every((id) => lobby.acceptedIds.has(id));
      if (allJoined) {
        lobby.isReady = true;
      }

      const playerListDisplay = lobby.requiredIds
        .map((id) => {
          const joined = lobby.acceptedIds.has(id);
          return `${joined ? "✅" : "⏳"} <@${id}> ${joined ? "*Joined*" : "*Waiting...*"}`;
        })
        .join("\n");

      const updatedEmbed = EmbedBuilder.from(interaction.message.embeds[0]).setDescription(
        `----------------------------------------\n\n**Team 1:** ${lobby.t1Pings}\n**Team 2:** ${lobby.t2Pings}\n\n` +
          `**Roster Acceptance Status (${lobby.acceptedIds.size}/${lobby.requiredIds.length}):**\n${playerListDisplay}\n\n` +
          (allJoined
            ? "🎮 **ALL PLAYERS HAVE JOINED!** You may now play the match. The host can submit the screenshot using `/submit` once finished."
            : "⏳ Waiting for remaining players to click **Join Game** below...")
      );

      const updatedRow = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId(`join_game_${gameId}`)
          .setLabel(allJoined ? "All Joined" : "Join Game")
          .setStyle(allJoined ? ButtonStyle.Secondary : ButtonStyle.Success)
          .setDisabled(allJoined)
      );

      await interaction.update({ embeds: [updatedEmbed], components: [updatedRow] });

      if (allJoined) {
        await interaction.followUp({ content: `🎮 **Game #${gameId} is Ready!** All players have joined.` });
      }
    }
    return;
  }

  if (!interaction.isChatInputCommand()) return;

  const { commandName, options, user } = interaction;

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
              "`/stats [user]` — View rank, rating, RXP progress, placement status, KDA, W/L, and Win Rate.\n" +
              "`/lb` — Display the top 10 ranked leaderboard.\n" +
              "`/rm [user]` — View a list of recent matches played by a user.",
            inline: false
          },
          {
            name: "⚔️ Game & Matchmaking Commands",
            value: 
              "`/startgame <team1> <team2>` — Tag Team 1 and Team 2 members to create an active match session (10m cooldown).\n" +
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

      return await interaction.reply({ embeds: [embed] });
    }

    // 🛡️ RESTRICTION CHECK
    const allowedWithoutRegistration = ["register", "stats", "lb", "help"];
    const registryCheck = getRegistry(user.id);

    if (!registryCheck && !allowedWithoutRegistration.includes(commandName)) {
      return interaction.reply({
        content: "❌ You must register your Roblox username first! Please run `/register <roblox_username>` before using this command.",
        flags: MessageFlags.Ephemeral,
      });
    }

    /* ---------------- /register ---------------- */
    if (commandName === "register") {
      const username = options.getString("username", true).trim();
      const existing = getRegistry(user.id);

      if (existing) {
        return interaction.reply({
          content: `❌ You are already registered as **${existing.roblox_username}**. Contact staff to reset your registry.`,
          flags: MessageFlags.Ephemeral,
        });
      }

      setRegistry(user.id, username);
      const p = ensure(user.id);
      
      // Enforce unranked defaults upon initial registration
      patch(user.id, { rank: "Unranked", rating: null });

      return interaction.reply({
        content: `✅ Successfully registered your Roblox username as **${username}**!`,
        flags: MessageFlags.Ephemeral,
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
      const now = Date.now();
      const COOLDOWN_DURATION = 10 * 60 * 1000;
      const lastHostTime = hostCooldowns.get(user.id);

      if (lastHostTime && now - lastHostTime < COOLDOWN_DURATION) {
        const remainingSeconds = Math.ceil((COOLDOWN_DURATION - (now - lastHostTime)) / 1000);
        const unixTimestamp = Math.floor((now + (COOLDOWN_DURATION - (now - lastHostTime))) / 1000);
        return interaction.reply({
          content: `⏳ **Cooldown :** You cannot start another game yet! Please wait <t:${unixTimestamp}:R> (${Math.ceil(remainingSeconds / 60)} mins remaining).`,
          flags: MessageFlags.Ephemeral,
        });
      }

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

      hostCooldowns.set(user.id, now);

      const t1Pings = t1Ids.map((id) => `<@${id}>`).join(", ");
      const t2Pings = t2Ids.map((id) => `<@${id}>`).join(", ");

      const acceptedIds = new Set([user.id]);
      const requiredIds = uniqueIds;
      const isReady = acceptedIds.size >= requiredIds.length;

      activeLobbies.set(gameId, {
        gameId,
        hostId: user.id,
        requiredIds,
        acceptedIds,
        t1Pings,
        t2Pings,
        isReady,
      });

      const playerListDisplay = requiredIds
        .map((id) => {
          const joined = acceptedIds.has(id);
          return `${joined ? "✅" : "⏳"} <@${id}> ${joined ? "*Joined (Host)*" : "*Waiting...*"}`;
        })
        .join("\n");

      const embed = new EmbedBuilder()
        .setTitle(`⚔️ Active Ranked Game #${gameId}`)
        .setColor(0x2b2d31)
        .setDescription(
          `----------------------------------------\n\n**Team 1:** ${t1Pings}\n**Team 2:** ${t2Pings}\n\n` +
            `**Roster Acceptance Status (${acceptedIds.size}/${requiredIds.length}):**\n${playerListDisplay}\n\n` +
            (isReady
              ? "🎮 **ALL PLAYERS HAVE JOINED!** You may now play the match. The host can submit the screenshot using `/submit` once finished."
              : "⏳ All tagged players must click **Join Game** below before starting!")
        );

      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId(`join_game_${gameId}`)
          .setLabel(isReady ? "All Joined" : "Join Game")
          .setStyle(isReady ? ButtonStyle.Secondary : ButtonStyle.Success)
          .setDisabled(isReady)
      );

      await interaction.editReply({ embeds: [embed], components: [row] });
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

      const gameId = activeGame.id.toString();
      const lobby = activeLobbies.get(gameId);

      if (lobby && !lobby.isReady) {
        const remainingPings = lobby.requiredIds
          .filter((id) => !lobby.acceptedIds.has(id))
          .map((id) => `<@${id}>`)
          .join(", ");

        return interaction.editReply(
          `❌ **Cannot Submit Match:** All tagged players must join the game lobby first!\n⏳ Still waiting on: ${remainingPings}`
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

      // 🔄 RETRY LOOP FOR OPENROUTER VISION PARSING
      let analysis = null;
      let attempts = 0;
      const maxAttempts = 3;

      while (attempts < maxAttempts && !analysis) {
        attempts++;
        try {
          const expectedUsernames = activeGame.players.map((p) => p.username).join(", ");
          const base64Image = imageBuffer.toString("base64");
          const mimeType = attachment.contentType || "image/png";

          const response = await openai.chat.completions.create({
            model: "openrouter/free",
            messages: [
              {
                role: "system",
                content: "You are a precise vision parser. You MUST respond strictly in valid JSON format. Do not include extra text, status messages, or markdown wrappers.",
              },
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

Respond ONLY with raw JSON matching this format:
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

          let rawText = response.choices?.[0]?.message?.content?.trim() || "";

          // Strip markdown blocks if present
          if (rawText.startsWith("```json")) {
            rawText = rawText.replace(/^```json/, "").replace(/```$/, "").trim();
          } else if (rawText.startsWith("```")) {
            rawText = rawText.replace(/^```/, "").replace(/```\$/, "").trim();
          }

          // 🛡️ Robust Extraction: Extract the JSON object substring between `{` and `}`
          const firstBrace = rawText.indexOf("{");
          const lastBrace = rawText.lastIndexOf("}");

          if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
            rawText = rawText.substring(firstBrace, lastBrace + 1);
          }

          analysis = JSON.parse(rawText);
        } catch (err) {
          console.warn(`⚠️ OpenRouter Vision attempt ${attempts} failed: ${err.message}. Retrying...`);
          if (attempts >= maxAttempts) {
            return interaction.editReply(
              `❌ **AI Vision Error:** The model repeatedly returned an invalid response format. Please try re-submitting the screenshot.`
            );
          }
        }
      }

      if (!analysis.isDuelHistory || !analysis.usernameFound || !analysis.allPlayersVerified) {
        return interaction.editReply(
          "❌ **Verification Failed:** The screenshot could not be verified as a valid Duel History matching your active lobby roster."
        );
      }

      recordImageHash(imageBuffer, user.id, activeGame.id);
      completeGame(activeGame.id, user.id, attachment.url);
      activeLobbies.delete(gameId);

      const hostWon = analysis.hostWon;
      const hostTeam = activeGame.players.find((p) => (p.user_id || p.userId) === user.id)?.team || 1;
      const winners = activeGame.players.filter((p) => p.team === (hostWon ? hostTeam : hostTeam === 1 ? 2 : 1));
      const losers = activeGame.players.filter((p) => p.team !== (hostWon ? hostTeam : hostTeam === 1 ? 2 : 1));

      // 🏆 Process Winners Stats & Placements
      for (const w of winners) {
        const targetId = w.user_id || w.userId;
        const p = ensure(targetId);
        
        match(targetId, 5, 0, 5, 2, 2, 25);
        const matchCount = getPlayerMatchCount(targetId);

        if (matchCount >= 5) {
          if (p.rank === "Unranked" || !p.rank) {
            const userMatches = placements(targetId);
            const formattedMatches = userMatches.map((m) => ({ scoreFor: m.score_for, scoreAgainst: m.score_against }));
            const placementResult = placementRank(formattedMatches);

            const [assignedRank, assignedRating] = placementResult || ["Amateur", 6.0];
            const startingRxp = assignedRank === "Contender" ? 400 : 200;
            patch(targetId, { rank: assignedRank, rating: assignedRating, rxp: startingRxp, wins: (p.wins || 0) + 1 });
          } else {
            const earnedRxp = rxp({ sf: 5, sa: 0, k: 5, d: 2, a: 2, place: 1 });
            const updatedData = checkRankProgression({
              rank: p.rank,
              rxp: (p.rxp || 200) + earnedRxp,
              rating: p.rating || 6.0,
            });

            patch(targetId, {
              rxp: updatedData.rxp,
              rank: updatedData.rank,
              rating: updatedData.rating,
              wins: (p.wins || 0) + 1,
            });
          }
        } else {
          patch(targetId, { rank: "Unranked", rating: null, wins: (p.wins || 0) + 1 });
        }
      }

      // 💀 Process Losers Stats (-20 RXP & Add Loss)
      for (const l of losers) {
        const targetId = l.user_id || l.userId;
        const p = ensure(targetId);
        
        match(targetId, 0, 5, 2, 5, 2, 0);
        const matchCount = getPlayerMatchCount(targetId);

        if (matchCount >= 5) {
          if (p.rank === "Unranked" || !p.rank) {
            const userMatches = placements(targetId);
            const formattedMatches = userMatches.map((m) => ({ scoreFor: m.score_for, scoreAgainst: m.score_against }));
            const placementResult = placementRank(formattedMatches);

            const [assignedRank, assignedRating] = placementResult || ["Amateur", 6.0];
            const startingRxp = assignedRank === "Contender" ? 400 : 200;
            patch(targetId, { rank: assignedRank, rating: assignedRating, rxp: startingRxp, losses: (p.losses || 0) + 1 });
          } else {
            const newRxp = Math.max(0, (p.rxp || 200) - 20);
            const updatedData = checkRankProgression({
              rank: p.rank,
              rxp: newRxp,
              rating: p.rating || 6.0,
            });

            patch(targetId, {
              rxp: updatedData.rxp,
              rank: updatedData.rank,
              rating: updatedData.rating,
              losses: (p.losses || 0) + 1,
            });
          }
        } else {
          patch(targetId, { rank: "Unranked", rating: null, losses: (p.losses || 0) + 1 });
        }
      }

      const winnerPings = winners.map((w) => `<@${w.user_id || w.userId}>`).join(", ");
      const loserPings = losers.map((l) => `<@${l.user_id || l.userId}>`).join(", ");

      return interaction.editReply(
        `🏆 **Match Results**\n\n` +
          `🥇 **Winners (${winnerPings}):** Win Awarded!\n` +
          `💀 **Losers (${loserPings}):** Loss Recorded.`
      );
    }

    /* ---------------- /claim ---------------- */
    else if (commandName === "claim") {
      const username = options.getString("username", true).trim();
      const reg = getRegistry(user.id);

      if (!reg || reg.roblox_username.toLowerCase() !== username.toLowerCase()) {
        return interaction.reply({
          content: `❌ Username mismatch! Your registered username is **${reg?.roblox_username || "None"}**.`,
          flags: MessageFlags.Ephemeral,
        });
      }

      const p = ensure(user.id);
      patch(user.id, { rxp: p.rxp + 15, losses: (p.losses || 0) + 1 });

      return interaction.reply({
        content: `✅ Claim successful! Added +15 RXP and recorded match participation for **${username}**.`,
        flags: MessageFlags.Ephemeral,
      });
    }

    /* ---------------- /stats ---------------- */
    else if (commandName === "stats") {
      await interaction.deferReply();

      try {
        const targetUser = options.getUser("user") || user;
        const targetMember = interaction.guild ? await interaction.guild.members.fetch(targetUser.id).catch(() => null) : null;

        const displayName = targetMember?.displayName || targetUser.username;
        const reg = getRegistry(targetUser.id);

        let rankDisplay = "Unranked";
        let ratingDisplay = "N/A";
        let rxpHeader = "Placements";
        let rxpDisplay = "Placement Matches 0/5";
        let kdaDisplay = "N/A";
        let wlDisplay = "0 / 0 (Win Rate: 0%)";
        let robloxTag = "@Unregistered";

        if (reg) {
          robloxTag = `@${reg.roblox_username}`;
          const p = player(targetUser.id);
          const matchCount = getPlayerMatchCount(targetUser.id);

          const isPlaced = matchCount >= 5 && p.rank && p.rank !== "Unranked";

          rankDisplay = isPlaced ? p.rank : "Unranked";
          ratingDisplay = isPlaced && p.rating !== null && p.rating !== undefined ? p.rating : "N/A";

          if (isPlaced) {
            rxpHeader = "RXP Progress";
            rxpDisplay = getRxpDisplay(rankDisplay, p.rxp || 0);
          } else {
            rxpHeader = "Placements";
            rxpDisplay = `Placement Matches ${matchCount}/5`;
          }

          kdaDisplay = `${p.kills || 0} / ${p.deaths || 0} / ${p.assists || 0}`;

          const totalWins = p.wins || 0;
          const totalLosses = p.losses || 0;
          const totalGames = totalWins + totalLosses;
          const winRate = totalGames > 0 ? Math.round((totalWins / totalGames) * 100) : 0;

          wlDisplay = `${totalWins} / ${totalLosses} (Win Rate: ${winRate}%)`;
        }

        const embed = new EmbedBuilder()
          .setTitle("📊  |    Player Statistics")
          .setColor(0x0b0b0b)
          .setThumbnail(targetUser.displayAvatarURL({ extension: "png", size: 256 }))
          .addFields(
            { name: "Player", value: `**${displayName}**\n${robloxTag}`, inline: false },
            { name: "Rank", value: `${rankDisplay}`, inline: true },
            { name: "Rating", value: `${ratingDisplay}`, inline: true },
            { name: rxpHeader, value: `${rxpDisplay}`, inline: true },
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
        return interaction.reply({ content: `No recent matches found for ${targetUser.username}.`, flags: MessageFlags.Ephemeral });
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
        return interaction.reply({ content: "The leaderboard is currently empty.", flags: MessageFlags.Ephemeral });
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
        return interaction.reply({ content: `Match ID **#${matchId}** was not found or is already voided.`, flags: MessageFlags.Ephemeral });
      }

      await interaction.reply({ content: `Successfully voided Match **#${matchId}**.` });
    }
  } catch (error) {
    console.error("Error executing command:", error);

    if (interaction.replied || interaction.deferred) {
      await interaction.followUp({ content: "There was an error executing this command!", flags: MessageFlags.Ephemeral });
    } else {
      await interaction.reply({ content: "There was an error executing this command!", flags: MessageFlags.Ephemeral });
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
