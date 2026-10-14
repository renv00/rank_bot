import { Client, GatewayIntentBits, Partials, EmbedBuilder } from "discord.js";
import { createWorker } from "tesseract.js";
import {
  player,
  ensure,
  patch,
  getGame,
  activeGamesForPlayer,
  completeGame,
  getRegistry,
  setRegistry,
  resetRegistry,
  setPendingClaim,
  getPendingClaims,
} from "./db.js";

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.MessageContent,
  ],
  partials: [Partials.Channel, Partials.Message],
});

client.on("interactionCreate", async (interaction) => {
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

    /* ---------------- /submit ---------------- */
    else if (commandName === "submit") {
      await interaction.deferReply();

      // 1. Verify Host Registry
      const reg = getRegistry(user.id);
      if (!reg) {
        return interaction.editReply(
          "❌ You must run `/register <roblox_username>` before submitting match results!"
        );
      }

      // 2. Fetch Host's Active Game
      const activeGames = activeGamesForPlayer(user.id);
      if (!activeGames.length) {
        return interaction.editReply("❌ You do not have an active host game to submit results for.");
      }

      const game = getGame(activeGames[0].id);
      const attachment = options.getAttachment("screenshot", true);

      // 3. Perform OCR using Tesseract.js
      const worker = await createWorker("eng");
      const ret = await worker.recognize(attachment.url);
      await worker.terminate();

      const scannedText = ret.data.text.toLowerCase();

      // 4. Check for 'Duel History' title in screenshot
      if (!scannedText.includes("duel history")) {
        return interaction.editReply(
          "❌ **Invalid Screenshot:** The uploaded image does not contain the **'Duel History'** header at the top[cite: 5]. Please take a clearer screenshot of your recent duel match."
        );
      }

      // 5. Detect Match Outcome (VICTORY / DEFEAT)
      const hostWon = scannedText.includes("victory");
      
      completeGame(game.id, user.id, attachment.url);

      const hostTeam = game.players.filter((p) => p.user_id === user.id)[0]?.team || 1;
      const winners = game.players.filter((p) => p.team === (hostWon ? hostTeam : hostTeam === 1 ? 2 : 1));
      const losers = game.players.filter((p) => p.team !== (hostWon ? hostTeam : hostTeam === 1 ? 2 : 1));

      // 6. Award Winning Team RXP Automatically
      for (const w of winners) {
        const p = ensure(w.user_id);
        patch(w.user_id, { rxp: p.rxp + 50, wins: p.wins + 1 });
      }

      // 7. Prompt Losing Team to /claim if Host Lost
      if (!hostWon) {
        setPendingClaim(game.id, losers);
        const loserPings = losers.map((l) => `<@${l.user_id}>`).join(", ");

        return interaction.editReply(
          ` Match result recorded!\n🏆 **Winning Team awarded automatically.**\n📢 ${loserPings}: Your team lost this game. Run \`/claim "roblox_username"\` to claim your consolation RXP!`
        );
      }

      return interaction.editReply(
        ` Match result recorded!\n🏆 **VICTORY verified!** RXP automatically distributed to winning team members.`
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
  } catch (error) {
    console.error("Command error:", error);
    if (interaction.deferred || interaction.replied) {
      await interaction.followUp({ content: "Error processing command.", ephemeral: true });
    } else {
      await interaction.reply({ content: "Error processing command.", ephemeral: true });
    }
  }
});

client.login(process.env.DISCORD_TOKEN);
