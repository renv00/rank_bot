import {
  REST,
  Routes,
  SlashCommandBuilder,
  PermissionFlagsBits,
} from "discord.js";

import { config, requireConfig } from "./config.js";

requireConfig();

const ranks = ["Unranked", "Amateur", "Contender", "Comp", "Elite", "Supreme"];

const cmds = [
new SlashCommandBuilder()
  .setName("register")
  .setDescription("Register your Roblox username")
  .addStringOption((o) =>
    o
      .setName("username")
      .setDescription("Your exact Roblox Username")
      .setRequired(true)
  ),

new SlashCommandBuilder()
  .setName("claim")
  .setDescription("Claim RXP if your team lost the recent match")
  .addStringOption((o) =>
    o
      .setName("username")
      .setDescription("Your registered Roblox Username")
      .setRequired(true)
  ),

new SlashCommandBuilder()
  .setName("reset-registry")
  .setDescription("Staff: allow a user to re-register their Roblox account")
  .addUserOption((o) =>
    o.setName("user").setDescription("Target Discord User").setRequired(true)
  )
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),
  new SlashCommandBuilder()
    .setName("startgame")
    .setDescription("Start a ranked game")
    .addStringOption((o) =>
      o
        .setName("team1")
        .setDescription("Team 1 usernames, separated by commas")
        .setRequired(true),
    )
    .addStringOption((o) =>
      o
        .setName("team2")
        .setDescription("Team 2 usernames, separated by commas")
        .setRequired(true),
    ),

  new SlashCommandBuilder()
    .setName("submit")
    .setDescription("Submit a result")
    .addStringOption((o) =>
      o
        .setName("username")
        .setDescription("Your in-game username")
        .setRequired(true),
    )
    .addAttachmentOption((o) =>
      o
        .setName("screenshot")
        .setDescription("Result screenshot")
        .setRequired(true),
    )
    .addStringOption((o) =>
      o
        .setName("teammates")
        .setDescription("Comma-separated teammates; blank for 1v1")
        .setRequired(false),
    ),

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
    .addUserOption((o) =>
      o.setName("user").setDescription("Player").setRequired(true),
    )
    .addStringOption((o) =>
      o
        .setName("rank")
        .setDescription("Rank")
        .setRequired(true)
        .addChoices(...ranks.map((x) => ({ name: x, value: x }))),
    )
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),

  new SlashCommandBuilder()
    .setName("setrating")
    .setDescription("Staff: set rating")
    .addUserOption((o) =>
      o.setName("user").setDescription("Player").setRequired(true),
    )
    .addNumberOption((o) =>
      o
        .setName("rating")
        .setDescription("6-9.5")
        .setMinValue(6)
        .setMaxValue(9.5)
        .setRequired(true),
    )
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),

  new SlashCommandBuilder()
    .setName("giverxp")
    .setDescription("Staff: give RXP")
    .addUserOption((o) =>
      o.setName("user").setDescription("Player").setRequired(true),
    )
    .addIntegerOption((o) =>
      o
        .setName("amount")
        .setDescription("Amount")
        .setMinValue(1)
        .setRequired(true),
    )
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),

  new SlashCommandBuilder()
    .setName("removerxp")
    .setDescription("Staff: remove RXP")
    .addUserOption((o) =>
      o.setName("user").setDescription("Player").setRequired(true),
    )
    .addIntegerOption((o) =>
      o
        .setName("amount")
        .setDescription("Amount")
        .setMinValue(1)
        .setRequired(true),
    )
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),

  new SlashCommandBuilder()
    .setName("reset")
    .setDescription("Staff: reset player")
    .addUserOption((o) =>
      o.setName("user").setDescription("Player").setRequired(true),
    )
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),

  new SlashCommandBuilder()
    .setName("voidmatch")
    .setDescription("Staff: void match")
    .addIntegerOption((o) =>
      o
        .setName("match_id")
        .setDescription("Match ID")
        .setMinValue(1)
        .setRequired(true),
    )
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),
];

const rest = new REST({ version: "10" }).setToken(config.token);

await rest.put(
  Routes.applicationGuildCommands(config.clientId, config.guildId),
  {
    body: cmds.map((x) => x.toJSON()),
  },
);

console.log("Commands registered");
