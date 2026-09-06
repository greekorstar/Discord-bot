// warnSystem.js — Warning system with configurable escalation (e.g. "2nd warning
// = kick", "3rd warning = ban"). Replaces the old /request moderation command.
//
// Config (per guild, warnConfig.json):
//   { logChannelId: '', escalations: [{ warningCount, action: 'mute'|'kick'|'ban', muteDurationMinutes }] }
// Data (per guild+user, warnData.json):
//   { warnings: [{ reason, moderatorId, timestamp }] }

const fs = require('fs');
const path = require('path');
const {
  EmbedBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  ActionRowBuilder,
  ChannelSelectMenuBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  StringSelectMenuBuilder,
} = require('discord.js');

const CONFIG_FILE = path.join(__dirname, 'warnConfig.json');
const DATA_FILE = path.join(__dirname, 'warnData.json');

let configs = {};
let warnData = {};

function load() {
  try { configs = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8')); } catch { configs = {}; }
  try { warnData = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8')); } catch { warnData = {}; }
}

function saveConfigs() {
  try { fs.writeFileSync(CONFIG_FILE, JSON.stringify(configs, null, 2)); }
  catch (err) { console.error('[warnSystem] Failed to save warnConfig.json:', err.message); }
}

function saveData() {
  try { fs.writeFileSync(DATA_FILE, JSON.stringify(warnData, null, 2)); }
  catch (err) { console.error('[warnSystem] Failed to save warnData.json:', err.message); }
}

function getConfig(guildId) {
  if (!configs[guildId]) {
    configs[guildId] = { logChannelId: '', escalations: [] };
    saveConfigs();
  }
  return configs[guildId];
}

function setConfig(guildId, config) {
  configs[guildId] = config;
  saveConfigs();
}

function dataKey(guildId, userId) {
  return `${guildId}:${userId}`;
}

function getWarnings(guildId, userId) {
  return (warnData[dataKey(guildId, userId)] || { warnings: [] }).warnings;
}

function clearWarnings(guildId, userId) {
  delete warnData[dataKey(guildId, userId)];
  saveData();
}

load();

// ---- Issuing a warning ----

async function addWarning(guild, member, moderator, reason) {
  const key = dataKey(guild.id, member.id);
  if (!warnData[key]) warnData[key] = { warnings: [] };
  warnData[key].warnings.push({ reason, moderatorId: moderator.id, timestamp: Date.now() });
  saveData();

  const count = warnData[key].warnings.length;

  await postLog(guild, `⚠️ <@${member.id}> was warned by <@${moderator.id}> (warning #${count}).\n**Reason:** ${reason}`);

  const escalationResult = await applyEscalation(guild, member, count, moderator);
  return { count, escalationResult };
}

async function postLog(guild, text) {
  const config = getConfig(guild.id);
  if (!config.logChannelId) return;
  const channel = await guild.channels.fetch(config.logChannelId).catch(() => null);
  if (channel) await channel.send(text).catch(() => {});
}

async function applyEscalation(guild, member, count, moderator) {
  const config = getConfig(guild.id);
  const rule = config.escalations.find(r => r.warningCount === count);
  if (!rule) return null;

  const reason = `Automatic escalation: reached ${count} warning(s)`;

  try {
    if (rule.action === 'mute') {
      const ms = rule.muteDurationMinutes * 60 * 1000;
      await member.timeout(ms, reason);
      await postLog(guild, `🔇 <@${member.id}> was automatically muted for ${rule.muteDurationMinutes} minute(s) (reached ${count} warnings).`);
      return `muted for ${rule.muteDurationMinutes} minute(s)`;
    } else if (rule.action === 'kick') {
      await member.kick(reason);
      await postLog(guild, `👢 <@${member.id}> was automatically kicked (reached ${count} warnings).`);
      return 'kicked';
    } else if (rule.action === 'ban') {
      await member.ban({ reason });
      await postLog(guild, `🔨 <@${member.id}> was automatically banned (reached ${count} warnings).`);
      return 'banned';
    }
  } catch (err) {
    console.error('[warnSystem] Failed to apply escalation:', err.message);
    await postLog(guild, `⚠️ Tried to auto-${rule.action} <@${member.id}> at ${count} warnings, but it failed — check my permissions and role position.`);
    return null;
  }
  return null;
}

// ---- Setup ----

function buildSetupRows(config) {
  return [
    new ActionRowBuilder().addComponents(
      new ChannelSelectMenuBuilder().setCustomId('warn_setup_logchannel').setPlaceholder('Channel where every warning gets logged').addChannelTypes(ChannelType.GuildText)
    ),
    new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('warn_setup_addescalation').setLabel('Add Escalation Rule').setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId('warn_setup_listescalation').setLabel('View / Remove Escalation Rules').setStyle(ButtonStyle.Secondary),
    ),
  ];
}

async function handleLogChannelSelect(interaction) {
  const config = getConfig(interaction.guild.id);
  config.logChannelId = interaction.values[0];
  setConfig(interaction.guild.id, config);
  await interaction.reply({ content: `✅ Warnings will now be logged in <#${config.logChannelId}>.`, ephemeral: true });
}

function buildEscalationModal() {
  return new ModalBuilder()
    .setCustomId('warn_escalation_modal')
    .setTitle('Add Escalation Rule')
    .addComponents(
      new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('count').setLabel('At how many warnings?').setStyle(TextInputStyle.Short).setRequired(true)),
      new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('action').setLabel('Action: mute, kick, or ban').setStyle(TextInputStyle.Short).setRequired(true)),
      new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('duration').setLabel('Mute duration in minutes (only for mute)').setStyle(TextInputStyle.Short).setRequired(false)),
    );
}

function handleEscalationModalSubmit(interaction) {
  const count = parseInt(interaction.fields.getTextInputValue('count'), 10);
  const action = interaction.fields.getTextInputValue('action').trim().toLowerCase();
  const durationInput = interaction.fields.getTextInputValue('duration');

  if (isNaN(count) || count <= 0) return { error: 'Warning count must be a positive number.' };
  if (!['mute', 'kick', 'ban'].includes(action)) return { error: '"Action" must be exactly "mute", "kick", or "ban".' };

  let muteDurationMinutes;
  if (action === 'mute') {
    muteDurationMinutes = parseInt(durationInput, 10);
    if (isNaN(muteDurationMinutes) || muteDurationMinutes <= 0) return { error: 'Mute needs a positive number of minutes in the duration field.' };
    if (muteDurationMinutes > 40320) return { error: "Discord's timeout max is 40320 minutes (28 days)." };
  }

  const config = getConfig(interaction.guild.id);
  config.escalations = config.escalations.filter(r => r.warningCount !== count);
  config.escalations.push({ warningCount: count, action, muteDurationMinutes });
  config.escalations.sort((a, b) => a.warningCount - b.warningCount);
  setConfig(interaction.guild.id, config);

  return { error: null, count, action, muteDurationMinutes };
}

async function handleListEscalations(interaction) {
  const config = getConfig(interaction.guild.id);
  if (config.escalations.length === 0) {
    await interaction.reply({ content: 'No escalation rules configured yet — warnings will just be logged with no automatic action.', ephemeral: true });
    return;
  }

  const description = config.escalations.map(r =>
    `**${r.warningCount} warning(s)** → ${r.action}${r.action === 'mute' ? ` (${r.muteDurationMinutes} min)` : ''}`
  ).join('\n');

  const options = config.escalations.map(r => ({
    label: `${r.warningCount} warnings → ${r.action}`,
    value: `${r.warningCount}`,
  }));

  const row = new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder().setCustomId('warn_escalation_remove_select').setPlaceholder('Select a rule to remove').addOptions(options.slice(0, 25))
  );

  await interaction.reply({ content: `**Current escalation rules:**\n${description}`, components: [row], ephemeral: true });
}

async function handleEscalationRemoveSelect(interaction) {
  const count = parseInt(interaction.values[0], 10);
  const config = getConfig(interaction.guild.id);
  config.escalations = config.escalations.filter(r => r.warningCount !== count);
  setConfig(interaction.guild.id, config);
  await interaction.reply({ content: '✅ Removed that rule.', ephemeral: true });
}

// ---- Viewing ----

function buildWarningsEmbed(user, guildId) {
  const warnings = getWarnings(guildId, user.id);
  const embed = new EmbedBuilder().setTitle(`Warnings for ${user.tag}`).setColor(0xED4245);

  if (warnings.length === 0) {
    embed.setDescription('No warnings on record.');
  } else {
    embed.setDescription(warnings.map((w, i) =>
      `**#${i + 1}** — <@${w.moderatorId}> — <t:${Math.floor(w.timestamp / 1000)}:R>\n${w.reason}`
    ).join('\n\n'));
  }
  return embed;
}

module.exports = {
  getConfig,
  setConfig,
  getWarnings,
  clearWarnings,
  addWarning,
  buildSetupRows,
  handleLogChannelSelect,
  buildEscalationModal,
  handleEscalationModalSubmit,
  handleListEscalations,
  handleEscalationRemoveSelect,
  buildWarningsEmbed,
};
