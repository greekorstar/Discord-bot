// setupWizard.js — Powers /setup: dropdown pickers for channels/roles instead of
// copy-pasting IDs into files, plus one-click AutoMod rule creation.

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

// ---- General setup: join/leave channels + autorole + ticket role/category ----
function buildGeneralSetupRows() {
  return [
    new ActionRowBuilder().addComponents(
      new ChannelSelectMenuBuilder().setCustomId('setup_joinchannel').setPlaceholder('Join message channel').addChannelTypes(ChannelType.GuildText)
    ),
    new ActionRowBuilder().addComponents(
      new ChannelSelectMenuBuilder().setCustomId('setup_leavechannel').setPlaceholder('Leave message channel').addChannelTypes(ChannelType.GuildText)
    ),
    new ActionRowBuilder().addComponents(
      new RoleSelectMenuBuilder().setCustomId('setup_autorole').setPlaceholder('Auto-role given on join')
    ),
    new ActionRowBuilder().addComponents(
      new RoleSelectMenuBuilder().setCustomId('setup_ticketrole').setPlaceholder('Ticket support role')
    ),
    new ActionRowBuilder().addComponents(
      new ChannelSelectMenuBuilder().setCustomId('setup_ticketcategory').setPlaceholder('Ticket channel category').addChannelTypes(ChannelType.GuildCategory)
    ),
  ];
}

// ---- Application channels ----
function buildApplicationSetupRows() {
  return [
    new ActionRowBuilder().addComponents(
      new ChannelSelectMenuBuilder().setCustomId('setup_appsubmission').setPlaceholder('Application submission channel').addChannelTypes(ChannelType.GuildText)
    ),
    new ActionRowBuilder().addComponents(
      new ChannelSelectMenuBuilder().setCustomId('setup_apppending').setPlaceholder('Application pending log channel').addChannelTypes(ChannelType.GuildText)
    ),
    new ActionRowBuilder().addComponents(
      new ChannelSelectMenuBuilder().setCustomId('setup_appaccepted').setPlaceholder('Application accepted log channel').addChannelTypes(ChannelType.GuildText)
    ),
    new ActionRowBuilder().addComponents(
      new ChannelSelectMenuBuilder().setCustomId('setup_appdenied').setPlaceholder('Application denied log channel').addChannelTypes(ChannelType.GuildText)
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
  setup_autorole: 'autoRoleId',
  setup_ticketrole: 'ticketSupportRoleId',
  setup_ticketcategory: 'ticketCategoryId',
  setup_appsubmission: 'appSubmissionChannelId',
  setup_apppending: 'appPendingChannelId',
  setup_appaccepted: 'appAcceptedChannelId',
  setup_appdenied: 'appDeniedChannelId',
};

async function handleSelectMenu(interaction) {
  const settingKey = CUSTOM_ID_TO_SETTING[interaction.customId];
  if (!settingKey) return false;

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
  buildApplicationSetupRows,
  buildAutomodSetupRow,
  handleSelectMenu,
  handleAutomodButton,
};
