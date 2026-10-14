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
import { createWorker } from "tesseract.js";
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
  activeGamesForPlayer,
  activeGame,
  completeGame,
  getRegistry,
  setRegistry,
  resetRegistry,
  setPendingClaim,
  getPendingClaims,
} from "./db.js";

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

// Active game lobbies held in memory for /startgame join buttons
const activeLobbies = new Map();

// ---------------- AUTOMATIC COMMAND REGISTRATION ----------------
const ranks = ["Unranked", "Amateur", "Contender", "Comp", "Elite", "Supreme"];

const commandDefinitions = [
  new SlashCommandBuilder()
    .setName("startgame")
    .setDescription("Start a ranked game")
    .addStringOption((o) =>
      o.setName("team1").setDescription("Team 1 usernames, separated by commas").setRequired(true)
    )
    .addStringOption((o) =>
      o.setName("team2").setDescription("Team 2 usernames, separated by commas").setRequired(true)
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

    // 1. Wipe duplicate guild-level commands from all joined servers
    const guilds = await client.guilds.fetch();
    for (const [guildId] of guilds) {
      await rest.put(Routes.applicationGuildCommands(client.user.id, guildId), { body: [] });
    }
    console.log("🧹 Cleared old guild-specific command duplicates.");

    // 2. Set clean global commands
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
  // 1. HANDLE BUTTON INTERACTION (JOIN GAME)
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
        `----------------------------------------\n\nWaiting for players to join...\n\n**Players (${lobby.players.length}/${lobby.maxPlayers}):**\n` +
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

  // 2. HANDLE SLASH COMMANDS
  if (!interaction.isChatInputCommand()) return;

  const { commandName, options, user } = interaction;

  try {
    /* ---------------- /register ---------------- */
    if (commandName === "register") {
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

      const t1Names = rawT1.split(",").map((s) => s.trim()).filter(Boolean);
      const t2Names = rawT2.split(",").map((s) => s.trim()).filter(Boolean);

      const maxPlayers = t1Names.length + t2Names.length;
      const gameId = Date.now().toString().slice(-6);

      activeLobbies.set(gameId, {
        host: user.id,
        maxPlayers: maxPlayers || 2,
        players: [{ id: user.id, username: user.username }],
      });

      const embed = new EmbedBuilder()
        .setTitle("Pending game")
        .setColor(0x2b2d31)
        .setDescription(
          `----------------------------------------\n\nWaiting for players to join...\n\n**Players (1/${maxPlayers || 2}):**\n1. <@${user.id}>`
        );

      const joinButton = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`join_game_${gameId}`).setLabel("Join").setStyle(ButtonStyle.Success)
      );

      await interaction.editReply({ embeds: [embed], components: [joinButton] });
    }

    /* ---------------- /submit ---------------- */
    else if (commandName === "submit") {
      await interaction.deferReply();

      // 1. Verify User Registration
      const reg = getRegistry(user.id);
      if (!reg) {
        return interaction.editReply(
          "❌ You must run `/register <roblox_username>` before submitting match results!"
        );
      }

      const registeredUsername = reg.roblox_username.toLowerCase();

      // 2. Fetch Active Games Where User Is Host
      const activeGames = activeGamesForPlayer(user.id);

      // Check if user is the host of an active database game
      let hostGame = activeGames.find((g) => g.started_by === user.id);

      // Fallback check inside in-memory active lobbies
      if (!hostGame) {
        for (const [id, lobby] of activeLobbies.entries()) {
          if (lobby.host === user.id) {
            hostGame = { id: id, started_by: user.id };
            break;
          }
        }
      }

      // Block execution if the user is NOT the host
      if (!hostGame) {
        return interaction.editReply(
          "❌ You aren't the host of a recent game you played, only the host can submit."
        );
      }

      const game = getGame(hostGame.id) || { id: hostGame.id, players: [] };
      const attachment = options.getAttachment("screenshot", true);

      // 3. Perform OCR Verification via Tesseract
      const worker = await createWorker("eng");
      const ret = await worker.recognize(attachment.url);
      await worker.terminate();

      const scannedText = ret.data.text.toLowerCase();

      // 4. Verify 'Duel History' Header in Screenshot
      if (!scannedText.includes("duel history")) {
        return interaction.editReply(
          "❌ **Invalid Screenshot:** The uploaded image does not contain the **'Duel History'** header at the top. Please upload a clear screenshot of your recent duel history."
        );
      }

      // 5. Verify Host's Registered Roblox @username
      const usernameWithAt = `@${registeredUsername}`;
      if (!scannedText.includes(usernameWithAt) && !scannedText.includes(registeredUsername)) {
        return interaction.editReply(
          `❌ **Username Mismatch:** Your registered Roblox username (**@${reg.roblox_username}**) was not detected in this Duel History screenshot.`
        );
      }

      // 6. Record Result & Handle RXP Rewards
      const hostWon = scannedText.includes("victory");
      completeGame(game.id, user.id, attachment.url);

      const hostTeam = game.players.filter((p) => p.user_id === user.id)[0]?.team || 1;
      const winners = game.players.filter((p) => p.team === (hostWon ? hostTeam : hostTeam === 1 ? 2 : 1));
      const losers = game.players.filter((p) => p.team !== (hostWon ? hostTeam : hostTeam === 1 ? 2 : 1));

      for (const w of winners) {
        const p = ensure(w.user_id);
        patch(w.user_id, { rxp: p.rxp + 50, wins: p.wins + 1 });
      }

      if (!hostWon) {
        setPendingClaim(game.id, losers);
        const loserPings = losers.map((l) => `<@${l.user_id}>`).join(", ");

        return interaction.editReply(
          ` Match result recorded!\n🏆 **Winning Team awarded automatically.**\n📢 ${loserPings}: Your team lost this game. Run \`/claim "roblox_username"\` to claim your consolation RXP!`
        );
      }

      return interaction.editReply(
        ` Match result recorded!\n🏆 **VICTORY verified for host @${reg.roblox_username}!** RXP automatically distributed to winning team members.`
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

// ---------------- AUTHENTICATION & LOGIN ----------------
const token = process.env.DISCORD_TOKEN;

if (!token) {
  console.error("CRITICAL ERROR: process.env.DISCORD_TOKEN is undefined!");
  process.exit(1);
}

client.login(token).catch((err) => {
  console.error("FAILED TO LOGIN TO DISCORD:", err);
});
