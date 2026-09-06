// logSystem.js — A general-purpose server log: every slash command used, message
// edits/deletes, and moderation actions (ban/kick), all posted to one log
// channel with who did what. A whitelist excludes specific people from being
// logged; the server owner is ALWAYS excluded automatically, regardless of
// the whitelist list (not just anyone with Administrator — the actual owner).

const fs = require('fs');
const path = require('path');
const { EmbedBuilder, ActionRowBuilder, ChannelSelectMenuBuilder, ChannelType, AuditLogEvent } = require('discord.js');

const CONFIG_FILE = path.join(__dirname, 'logConfig.json');
let configs = {};

function load() {
  try { configs = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8')); } catch { configs = {}; }
}

function save() {
  try { fs.writeFileSync(CONFIG_FILE, JSON.stringify(configs, null, 2)); }
  catch (err) { console.error('[logSystem] Failed to save logConfig.json:', err.message); }
}

function getConfig(guildId) {
  if (!configs[guildId]) {
    configs[guildId] = { logChannelId: '', whitelistedUserIds: [] };
    save();
  }
  return configs[guildId];
}

function setConfig(guildId, config) {
  configs[guildId] = config;
  save();
}

load();

// The server owner is ALWAYS exempt, on top of whatever's in the whitelist —
// this is deliberately about ownership, not the Administrator permission,
// since admins should still be logged.
function isExempt(guild, userId) {
  if (userId === guild.ownerId) return true;
  const config = getConfig(guild.id);
  return config.whitelistedUserIds.includes(userId);
}

async function postLog(guild, embed) {
  const config = getConfig(guild.id);
  if (!config.logChannelId) return;
  const channel = await guild.channels.fetch(config.logChannelId).catch(() => null);
  if (channel) await channel.send({ embeds: [embed] }).catch(() => {});
}

// Generic one-liner logger, used by /kick and /ban.
async function logAction(guild, text) {
  const embed = new EmbedBuilder().setDescription(text).setColor(0xED4245).setTimestamp();
  await postLog(guild, embed);
}

// ---- Command usage ----

function summarizeOptions(interaction) {
  const parts = [];
  const sub = interaction.options.getSubcommand(false);
  const group = interaction.options.getSubcommandGroup(false);
  if (group) parts.push(group);
  if (sub) parts.push(sub);

  const opts = interaction.options.data.flatMap(d => d.options ? (d.options.flatMap(o2 => o2.options || [o2])) : [d])
    .filter(o => o.value !== undefined);

  const optionText = opts.map(o => `${o.name}: ${o.value}`).join(', ');
  return { path: parts.join(' '), optionText };
}

async function logCommand(interaction) {
  if (!interaction.guild) return;
  if (isExempt(interaction.guild, interaction.user.id)) return;

  const { path: subPath, optionText } = summarizeOptions(interaction);
  const commandLabel = `/${interaction.commandName}${subPath ? ' ' + subPath : ''}`;

  const embed = new EmbedBuilder()
    .setDescription(`⌨️ <@${interaction.user.id}> used **${commandLabel}**${optionText ? `\n${optionText}` : ''}`)
    .setColor(0x5865F2)
    .setFooter({ text: `#${interaction.channel?.name || 'unknown channel'}` })
    .setTimestamp();

  await postLog(interaction.guild, embed);
}

// ---- Message edits/deletes ----

async function logMessageDelete(message) {
  if (!message.guild || message.author?.bot) return;
  if (isExempt(message.guild, message.author?.id)) return;

  const embed = new EmbedBuilder()
    .setDescription(`🗑️ Message by <@${message.author?.id || 'unknown'}> deleted in <#${message.channel.id}>`)
    .addFields({ name: 'Content', value: message.content?.slice(0, 1000) || '*(no text content — embed/attachment only)*' })
    .setColor(0xED4245)
    .setTimestamp();

  await postLog(message.guild, embed);
}

async function logMessageEdit(oldMessage, newMessage) {
  if (!newMessage.guild || newMessage.author?.bot) return;
  if (oldMessage.content === newMessage.content) return; // embed-only updates, etc. — nothing worth logging
  if (isExempt(newMessage.guild, newMessage.author?.id)) return;

  const embed = new EmbedBuilder()
    .setDescription(`✏️ <@${newMessage.author.id}> edited a message in <#${newMessage.channel.id}> ([jump](${newMessage.url}))`)
    .addFields(
      { name: 'Before', value: oldMessage.content?.slice(0, 500) || '*(empty)*' },
      { name: 'After', value: newMessage.content?.slice(0, 500) || '*(empty)*' },
    )
    .setColor(0xFEE75C)
    .setTimestamp();

  await postLog(newMessage.guild, embed);
}

// ---- Native ban/unban (covers bans done directly in Discord's UI, not just /ban) ----

async function logGuildBanAdd(ban) {
  const auditLogs = await ban.guild.fetchAuditLogs({ type: AuditLogEvent.MemberBanAdd, limit: 5 }).catch(() => null);
  const entry = auditLogs?.entries.find(e => e.target?.id === ban.user.id);
  if (entry && isExempt(ban.guild, entry.executor?.id)) return;

  const embed = new EmbedBuilder()
    .setDescription(`🔨 <@${ban.user.id}> was banned${entry?.executor ? ` by <@${entry.executor.id}>` : ''}.${entry?.reason ? `\n**Reason:** ${entry.reason}` : ''}`)
    .setColor(0xED4245)
    .setTimestamp();

  await postLog(ban.guild, embed);
}

async function logGuildBanRemove(ban) {
  const embed = new EmbedBuilder().setDescription(`🔓 <@${ban.user.id}> was unbanned.`).setColor(0x57F287).setTimestamp();
  await postLog(ban.guild, embed);
}

// ---- Setup ----

function buildSetupRows() {
  return [
    new ActionRowBuilder().addComponents(
      new ChannelSelectMenuBuilder().setCustomId('log_setup_channel').setPlaceholder('Channel where everything gets logged').addChannelTypes(ChannelType.GuildText)
    ),
  ];
}

async function handleSetupChannelSelect(interaction) {
  const config = getConfig(interaction.guild.id);
  config.logChannelId = interaction.values[0];
  setConfig(interaction.guild.id, config);
  await interaction.reply({ content: `✅ Logging to <#${config.logChannelId}> now. The server owner is always exempt from being logged; add anyone else with \`/log whitelist add\`.`, ephemeral: true });
}

function addWhitelist(guildId, userId) {
  const config = getConfig(guildId);
  if (!config.whitelistedUserIds.includes(userId)) config.whitelistedUserIds.push(userId);
  setConfig(guildId, config);
}

function removeWhitelist(guildId, userId) {
  const config = getConfig(guildId);
  config.whitelistedUserIds = config.whitelistedUserIds.filter(id => id !== userId);
  setConfig(guildId, config);
}

function listWhitelist(guildId) {
  return getConfig(guildId).whitelistedUserIds;
}

module.exports = {
  getConfig,
  setConfig,
  isExempt,
  logAction,
  logCommand,
  logMessageDelete,
  logMessageEdit,
  logGuildBanAdd,
  logGuildBanRemove,
  buildSetupRows,
  handleSetupChannelSelect,
  addWhitelist,
  removeWhitelist,
  listWhitelist,
};
