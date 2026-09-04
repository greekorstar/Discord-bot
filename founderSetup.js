// founderSetup.js — Backs /foundersetup, restricted to whoever Discord
// considers the server owner (interaction.guild.ownerId), checked in index.js.
//
// Covers Discord's "Safety Setup" + "Onboarding" community settings:
//   verification level, explicit media filter, safety alerts channel,
//   welcome screen (enabled + description), and toggling Onboarding on/off.
//
// Honest limit: Onboarding's actual PROMPTS (the multi-choice questions with
// role/channel assignments) have a nested structure too complex to expose as
// slash command options. This command can only flip Onboarding on/off while
// preserving whatever prompts already exist — building or editing individual
// prompts still has to be done in Discord's own Server Settings > Onboarding
// UI. Everything else here is fully controllable from the command.

const { GuildVerificationLevel, GuildExplicitContentFilter } = require('discord.js');

async function handleVerification(interaction) {
  const levelInput = interaction.options.getString('level');
  const levelMap = {
    none: GuildVerificationLevel.None,
    low: GuildVerificationLevel.Low,
    medium: GuildVerificationLevel.Medium,
    high: GuildVerificationLevel.High,
    very_high: GuildVerificationLevel.VeryHigh,
  };

  try {
    await interaction.guild.setVerificationLevel(levelMap[levelInput], `Set by founder ${interaction.user.tag} via /foundersetup`);
    await interaction.reply(`✅ Verification level set to **${levelInput}**.`);
  } catch (err) {
    await interaction.reply({ content: `Couldn't set verification level: ${err.message}`, ephemeral: true });
  }
}

async function handleExplicitFilter(interaction) {
  const levelInput = interaction.options.getString('level');
  const levelMap = {
    disabled: GuildExplicitContentFilter.Disabled,
    without_roles: GuildExplicitContentFilter.MembersWithoutRoles,
    all_members: GuildExplicitContentFilter.AllMembers,
  };

  try {
    await interaction.guild.setExplicitContentFilter(levelMap[levelInput], `Set by founder ${interaction.user.tag} via /foundersetup`);
    await interaction.reply(`✅ Explicit content filter set to **${levelInput}**.`);
  } catch (err) {
    await interaction.reply({ content: `Couldn't set the explicit content filter: ${err.message}`, ephemeral: true });
  }
}

async function handleSafetyAlerts(interaction) {
  const channel = interaction.options.getChannel('channel');

  try {
    await interaction.guild.edit({ safetyAlertsChannel: channel.id });
    await interaction.reply(`✅ Safety alerts channel set to ${channel}.`);
  } catch (err) {
    await interaction.reply({
      content: `Couldn't set the safety alerts channel (${err.message}). This feature needs a recent discord.js version — if this keeps failing, set it manually in Server Settings > Safety Setup.`,
      ephemeral: true,
    });
  }
}

async function handleWelcomeScreen(interaction) {
  const enabled = interaction.options.getBoolean('enabled');
  const description = interaction.options.getString('description');

  try {
    await interaction.guild.editWelcomeScreen({
      enabled,
      description: description || undefined,
    });
    await interaction.reply(`✅ Welcome screen is now ${enabled ? '🟢 enabled' : '🔴 disabled'}${description ? ' with an updated description' : ''}.`);
  } catch (err) {
    await interaction.reply({ content: `Couldn't update the welcome screen: ${err.message}`, ephemeral: true });
  }
}

async function handleOnboarding(interaction) {
  const enabled = interaction.options.getBoolean('enabled');

  try {
    const current = await interaction.guild.fetchOnboarding();
    await interaction.guild.editOnboarding({
      prompts: current.prompts,
      defaultChannels: current.defaultChannels.map(c => c.id),
      enabled,
      mode: current.mode,
    });
    await interaction.reply(
      `✅ Onboarding is now ${enabled ? '🟢 enabled' : '🔴 disabled'}. Existing prompts were left untouched — build/edit individual prompts in Server Settings > Onboarding, since that structure is too complex for a slash command.`
    );
  } catch (err) {
    await interaction.reply({
      content: `Couldn't toggle Onboarding (${err.message}). Make sure this server has Community features enabled and at least one Onboarding prompt already exists — toggle it on/off manually in Server Settings if this keeps failing.`,
      ephemeral: true,
    });
  }
}

module.exports = {
  handleVerification,
  handleExplicitFilter,
  handleSafetyAlerts,
  handleWelcomeScreen,
  handleOnboarding,
};
