// setupWizard.js — Powers /setup: dropdown pickers for channels/roles instead of
// copy-pasting IDs into files, plus one-click AutoMod rule creation.
// Ticket configuration lives in its own /ticket setup command (ticketSystem.js) —
// this file only covers join/leave/autorole and AutoMod.

const {
  ActionRowBuilder,
  ChannelSelectMenuBuilder,
  RoleSelectMenuBuilder,
  ChannelType,
  ButtonBuilder,
  ButtonStyle,
  AutoModerationRuleTriggerType,
  AutoModerationActionType,
} = require('discord.js');
const settingsStore = require('./settingsStore.js');

// ---- General setup: join/leave channels + autorole(s) ----
function buildGeneralSetupRows() {
  return [
    new ActionRowBuilder().addComponents(
      new ChannelSelectMenuBuilder().setCustomId('setup_joinchannel').setPlaceholder('Join message channel').addChannelTypes(ChannelType.GuildText)
    ),
    new ActionRowBuilder().addComponents(
      new ChannelSelectMenuBuilder().setCustomId('setup_leavechannel').setPlaceholder('Leave message channel').addChannelTypes(ChannelType.GuildText)
    ),
    new ActionRowBuilder().addComponents(
      new RoleSelectMenuBuilder().setCustomId('setup_autorole').setPlaceholder('Auto-role(s) given on join — pick as many as you like').setMinValues(0).setMaxValues(25)
    ),
  ];
}

// ---- AutoMod ----
function buildAutomodSetupRow() {
  return [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('setup_automod_button').setLabel('Create Recommended AutoMod Rules').setStyle(ButtonStyle.Primary)
    ),
  ];
}

// Maps a select menu's customId to the settingsStore key it saves.
const CUSTOM_ID_TO_SETTING = {
  setup_joinchannel: 'joinChannelId',
  setup_leavechannel: 'leaveChannelId',
  setup_autorole: 'autoRoleIds',
};

// Select menus that store ALL selected values (as an array) rather than just
// the first one — currently just the auto-role picker, since a server may
// want several roles handed out on join with no cap beyond Discord's own
// 25-per-component limit.
const MULTI_VALUE_SETTINGS = new Set(['setup_autorole']);

async function handleSelectMenu(interaction) {
  const settingKey = CUSTOM_ID_TO_SETTING[interaction.customId];
  if (!settingKey) return false;

  if (MULTI_VALUE_SETTINGS.has(interaction.customId)) {
    settingsStore.set(settingKey, interaction.values); // full array, 0-25 role IDs
    const count = interaction.values.length;
    await interaction.reply({ content: count === 0 ? '✅ Cleared the auto-role list — no roles will be given on join.' : `✅ Saved ${count} auto-role${count === 1 ? '' : 's'}.`, ephemeral: true });
    return true;
  }

  const selectedId = interaction.values[0];
  settingsStore.set(settingKey, selectedId);

  await interaction.reply({ content: `✅ Saved that selection.`, ephemeral: true });
  return true;
}

async function handleAutomodButton(interaction) {
  try {
    await interaction.guild.autoModerationRules.create({
      name: 'Scam keyword filter (bot-created)',
      eventType: 1, // MESSAGE_SEND
      triggerType: AutoModerationRuleTriggerType.Keyword,
      triggerMetadata: {
        keywords: ['free nitro', 'discord-nitro', 'steamcommunity-gift', 'free mint', 'claim your airdrop', 'connect your wallet'],
      },
      actions: [{ type: AutoModerationActionType.BlockMessage }],
      enabled: true,
    });

    await interaction.guild.autoModerationRules.create({
      name: 'Mention spam filter (bot-created)',
      eventType: 1,
      triggerType: AutoModerationRuleTriggerType.MentionSpam,
      triggerMetadata: { mentionTotalLimit: 5 },
      actions: [{ type: AutoModerationActionType.BlockMessage }],
      enabled: true,
    });

    await interaction.reply({ content: '✅ Created two AutoMod rules: a scam-keyword filter and a mention-spam filter. You can view/edit them anytime in Server Settings → AutoMod.', ephemeral: true });
  } catch (err) {
    console.error('[setupWizard] Failed to create AutoMod rules:', err.message);
    await interaction.reply({ content: 'Could not create AutoMod rules — make sure the bot has the "Manage Server" permission, and that you don\'t already have 2 rules with these exact names.', ephemeral: true });
  }
}

module.exports = {
  buildGeneralSetupRows,
  buildAutomodSetupRow,
  handleSelectMenu,
  handleAutomodButton,
};
