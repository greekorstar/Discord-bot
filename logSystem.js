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

  const attachment = message.attachments?.first();

  const embed = new EmbedBuilder()
    .setDescription(`🗑️ Message by <@${message.author?.id || 'unknown'}> deleted in <#${message.channel.id}>`)
    .addFields({ name: 'Content', value: message.content?.slice(0, 1000) || '*(no text content — embed/attachment only)*' })
    .setColor(0xED4245)
    .setFooter({ text: message.author?.tag || 'Unknown user', iconURL: message.author?.displayAvatarURL?.() || undefined })
    .setTimestamp();

  if (attachment) embed.addFields({ name: 'Attachment', value: attachment.url });
  if (attachment?.contentType?.startsWith('image/')) embed.setImage(attachment.url);

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

// ---- Prefix command usage (mirrors logCommand, for !prefix-style commands) ----

async function logPrefixCommand(message, commandName, argsText) {
  if (!message.guild) return;
  if (isExempt(message.guild, message.author.id)) return;

  const embed = new EmbedBuilder()
    .setDescription(`⌨️ <@${message.author.id}> used **${commandName}**${argsText ? `\n${argsText}` : ''}`)
    .setColor(0x5865F2)
    .setFooter({ text: `#${message.channel?.name || 'unknown channel'}` })
    .setTimestamp();

  await postLog(message.guild, embed);
}

// ---- Purge ----

async function logPurge(guild, channel, executor, count, targetUser) {
  if (isExempt(guild, executor.id)) return;

  const embed = new EmbedBuilder()
    .setDescription(`🧹 <@${executor.id}> purged **${count}** message(s) in <#${channel.id}>${targetUser ? ` from **${targetUser.tag}**` : ''}`)
    .setColor(0xED4245)
    .setTimestamp();

  await postLog(guild, embed);
}

// ---- Role add/remove (via the !role prefix command) ----

async function logRoleChange(guild, executor, targetMember, role, action) {
  if (isExempt(guild, executor.id)) return;

  const embed = new EmbedBuilder()
    .setDescription(`${action === 'add' ? '➕' : '➖'} <@${executor.id}> ${action === 'add' ? 'added' : 'removed'} **${role.name}** ${action === 'add' ? 'to' : 'from'} <@${targetMember.id}>`)
    .setColor(action === 'add' ? 0x57F287 : 0xED4245)
    .setTimestamp();

  await postLog(guild, embed);
}

// ---- Channel create/delete ----

async function logChannelCreate(channel) {
  if (!channel.guild) return;
  const auditLogs = await channel.guild.fetchAuditLogs({ type: AuditLogEvent.ChannelCreate, limit: 5 }).catch(() => null);
  const entry = auditLogs?.entries.find(e => e.target?.id === channel.id);
  if (entry?.executor && isExempt(channel.guild, entry.executor.id)) return;

  const embed = new EmbedBuilder()
    .setDescription(`📁 Channel **#${channel.name}** was created${entry?.executor ? ` by <@${entry.executor.id}>` : ''}.`)
    .setColor(0x57F287)
    .setTimestamp();

  await postLog(channel.guild, embed);
}

async function logChannelDelete(channel) {
  if (!channel.guild) return;
  const auditLogs = await channel.guild.fetchAuditLogs({ type: AuditLogEvent.ChannelDelete, limit: 5 }).catch(() => null);
  const entry = auditLogs?.entries.find(e => e.target?.id === channel.id);
  if (entry?.executor && isExempt(channel.guild, entry.executor.id)) return;

  const embed = new EmbedBuilder()
    .setDescription(`🗑️ Channel **#${channel.name}** was deleted${entry?.executor ? ` by <@${entry.executor.id}>` : ''}.`)
    .setColor(0xED4245)
    .setTimestamp();

  await postLog(channel.guild, embed);
}

// ---- Role create/delete/update ----

async function logRoleCreate(role) {
  const auditLogs = await role.guild.fetchAuditLogs({ type: AuditLogEvent.RoleCreate, limit: 5 }).catch(() => null);
  const entry = auditLogs?.entries.find(e => e.target?.id === role.id);
  if (entry?.executor && isExempt(role.guild, entry.executor.id)) return;

  const embed = new EmbedBuilder()
    .setDescription(`✨ Role **${role.name}** was created${entry?.executor ? ` by <@${entry.executor.id}>` : ''}.`)
    .setColor(0x57F287)
    .setTimestamp();

  await postLog(role.guild, embed);
}

async function logRoleDelete(role) {
  const auditLogs = await role.guild.fetchAuditLogs({ type: AuditLogEvent.RoleDelete, limit: 5 }).catch(() => null);
  const entry = auditLogs?.entries.find(e => e.target?.id === role.id);
  if (entry?.executor && isExempt(role.guild, entry.executor.id)) return;

  const embed = new EmbedBuilder()
    .setDescription(`🗑️ Role **${role.name}** was deleted${entry?.executor ? ` by <@${entry.executor.id}>` : ''}.`)
    .setColor(0xED4245)
    .setTimestamp();

  await postLog(role.guild, embed);
}

async function logRoleUpdate(oldRole, newRole) {
  const changes = [];
  if (oldRole.name !== newRole.name) changes.push(`name: **${oldRole.name}** → **${newRole.name}**`);
  if (oldRole.hexColor !== newRole.hexColor) changes.push(`color: \`${oldRole.hexColor}\` → \`${newRole.hexColor}\``);
  if (oldRole.permissions.bitfield !== newRole.permissions.bitfield) changes.push('permissions changed');
  if (oldRole.hoist !== newRole.hoist) changes.push(`hoisted: ${oldRole.hoist} → ${newRole.hoist}`);
  if (oldRole.mentionable !== newRole.mentionable) changes.push(`mentionable: ${oldRole.mentionable} → ${newRole.mentionable}`);
  if (changes.length === 0) return; // position-only shuffles etc. — nothing worth logging

  const auditLogs = await newRole.guild.fetchAuditLogs({ type: AuditLogEvent.RoleUpdate, limit: 5 }).catch(() => null);
  const entry = auditLogs?.entries.find(e => e.target?.id === newRole.id);
  if (entry?.executor && isExempt(newRole.guild, entry.executor.id)) return;

  const embed = new EmbedBuilder()
    .setDescription(`🛠️ Role **${newRole.name}** was updated${entry?.executor ? ` by <@${entry.executor.id}>` : ''}.\n${changes.join('\n')}`)
    .setColor(0xFEE75C)
    .setTimestamp();

  await postLog(newRole.guild, embed);
}

// ---- Member update (nickname/timeout/role changes) ----

async function logMemberUpdate(oldMember, newMember) {
  if (isExempt(newMember.guild, newMember.id)) return;

  const changes = [];
  if (oldMember.nickname !== newMember.nickname) {
    changes.push(`nickname: **${oldMember.nickname || oldMember.user.username}** → **${newMember.nickname || newMember.user.username}**`);
  }
  if (oldMember.communicationDisabledUntilTimestamp !== newMember.communicationDisabledUntilTimestamp) {
    if (newMember.communicationDisabledUntilTimestamp) {
      changes.push(`timed out until <t:${Math.floor(newMember.communicationDisabledUntilTimestamp / 1000)}:f>`);
    } else if (oldMember.communicationDisabledUntilTimestamp) {
      changes.push('timeout removed');
    }
  }

  const oldRoles = oldMember.roles.cache;
  const newRoles = newMember.roles.cache;
  const added = newRoles.filter(r => !oldRoles.has(r.id));
  const removed = oldRoles.filter(r => !newRoles.has(r.id));
  if (added.size) changes.push(`roles added: ${added.map(r => r.name).join(', ')}`);
  if (removed.size) changes.push(`roles removed: ${removed.map(r => r.name).join(', ')}`);

  if (changes.length === 0) return; // avatar/presence-only updates etc. — nothing worth logging

  const embed = new EmbedBuilder()
    .setDescription(`👤 <@${newMember.id}> was updated.\n${changes.join('\n')}`)
    .setColor(0x5865F2)
    .setTimestamp();

  await postLog(newMember.guild, embed);
}

// ---- Voice state (join/leave/move channels) ----

async function logVoiceStateUpdate(oldState, newState) {
  const guild = newState.guild;
  const member = newState.member || oldState.member;
  if (!member || isExempt(guild, member.id)) return;

  let text = null;
  if (!oldState.channelId && newState.channelId) {
    text = `🔊 <@${member.id}> joined voice channel <#${newState.channelId}>.`;
  } else if (oldState.channelId && !newState.channelId) {
    text = `🔇 <@${member.id}> left voice channel <#${oldState.channelId}>.`;
  } else if (oldState.channelId !== newState.channelId) {
    text = `🔀 <@${member.id}> moved from <#${oldState.channelId}> to <#${newState.channelId}>.`;
  }
  if (!text) return; // mute/deafen-only changes — nothing worth logging

  const embed = new EmbedBuilder().setDescription(text).setColor(0x5865F2).setTimestamp();
  await postLog(guild, embed);
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
  logPrefixCommand,
  logPurge,
  logRoleChange,
  logMessageDelete,
  logMessageEdit,
  logGuildBanAdd,
  logGuildBanRemove,
  logChannelCreate,
  logChannelDelete,
  logRoleCreate,
  logRoleDelete,
  logRoleUpdate,
  logMemberUpdate,
  logVoiceStateUpdate,
  buildSetupRows,
  handleSetupChannelSelect,
  addWhitelist,
  removeWhitelist,
  listWhitelist,
};
