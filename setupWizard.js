// setupWizard.js — Powers /setup: dropdown pickers for channels/roles instead of
// copy-pasting IDs into files. Ticket configuration lives in its own /ticket
// setup command (ticketSystem.js); leveling config lives in /level setup
// (levelSystem.js); warnings config lives in /warn setup (warnSystem.js) —
// this file only covers join/leave channels and autorole(s).

const { ActionRowBuilder, ChannelSelectMenuBuilder, RoleSelectMenuBuilder, ChannelType } = require('discord.js');
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

module.exports = {
  buildGeneralSetupRows,
  handleSelectMenu,
};
