// requestCommands.js — The actions behind /request.
//
// Access to the action subcommand groups (member/channel/role/automod) is
// gated by a configured "access role" (set via /request setup accessrole),
// NOT a raw Discord permission — that's the whole point of /request. If no
// access role is configured yet, only Administrators can use these.
// /request setup itself is always gated by the real Administrator permission.

const { ChannelType, PermissionFlagsBits, PermissionsBitField } = require('discord.js');
const settingsStore = require('./settingsStore.js');
const requestWarnings = require('./requestWarnings.js');
const requestLog = require('./requestLog.js');

// ---- Access check for member/channel/role/automod groups ----
async function checkAccess(interaction) {
  if (interaction.memberPermissions.has(PermissionFlagsBits.Administrator)) return true;

  const accessRoleId = settingsStore.get('requestAccessRoleId', null);
  if (accessRoleId && interaction.member.roles.cache.has(accessRoleId)) return true;

  await interaction.reply({
    content: accessRoleId
      ? `You need the configured /request access role to use this.`
      : `No /request access role has been configured yet — only Administrators can use this right now. An admin can run \`/request setup accessrole\`.`,
    ephemeral: true,
  });
  return false;
}

// ---- /request setup (Administrator only, checked in index.js) ----
async function handleSetupLogChannel(interaction) {
  const channel = interaction.options.getChannel('channel');
  settingsStore.set('requestLogChannelId', channel.id);
  await interaction.reply({ content: `✅ /request actions will now be logged in ${channel}.`, ephemeral: true });
}

async function handleSetupAccessRole(interaction) {
  const role = interaction.options.getRole('role');
  settingsStore.set('requestAccessRoleId', role.id);
  await interaction.reply({ content: `✅ **${role.name}** can now use /request's action commands.`, ephemeral: true });
}

async function handleSetupWarnedRole(interaction) {
  const role = interaction.options.getRole('role');
  settingsStore.set('requestWarnedRoleId', role.id);
  await interaction.reply({ content: `✅ **${role.name}** will be given after a member's first /request warning.`, ephemeral: true });
}

// ---- /request member ----
async function handleKick(interaction) {
  const target = interaction.options.getUser('target');
  const reason = interaction.options.getString('reason');
  const member = await interaction.guild.members.fetch(target.id).catch(() => null);

  if (!member) return interaction.reply({ content: 'Could not find that member in this server.', ephemeral: true });
  if (!member.kickable) return interaction.reply({ content: `I can't kick ${target.tag} — they may have a higher role than me, or I'm missing the Kick Members permission.`, ephemeral: true });

  await member.kick(reason);
  await requestLog.logAction({ executorId: interaction.user.id, executorTag: interaction.user.tag, action: 'kick', targetId: target.id, targetLabel: target.tag, reason }, interaction.guild);
  await interaction.reply(`👢 Kicked **${target.tag}**. Reason: ${reason}`);
}

async function handleBan(interaction) {
  const target = interaction.options.getUser('target');
  const reason = interaction.options.getString('reason');

  try {
    await interaction.guild.members.ban(target.id, { reason });
    await requestLog.logAction({ executorId: interaction.user.id, executorTag: interaction.user.tag, action: 'ban', targetId: target.id, targetLabel: target.tag, reason }, interaction.guild);
    await interaction.reply(`🔨 Banned **${target.tag}**. Reason: ${reason}`);
  } catch (err) {
    await interaction.reply({ content: `Couldn't ban ${target.tag} — they may have a higher role than me, or I'm missing the Ban Members permission.`, ephemeral: true });
  }
}

async function handleUnban(interaction) {
  const userId = interaction.options.getString('user_id');
  const reason = interaction.options.getString('reason');

  try {
    await interaction.guild.members.unban(userId, reason);
    await requestLog.logAction({ executorId: interaction.user.id, executorTag: interaction.user.tag, action: 'unban', targetId: userId, targetLabel: userId, reason }, interaction.guild);
    await interaction.reply(`✅ Unbanned user ID \`${userId}\`. Reason: ${reason}`);
  } catch (err) {
    await interaction.reply({ content: `Couldn't unban that ID — double check it's correct and that they're actually banned.`, ephemeral: true });
  }
}

async function handleMute(interaction) {
  const target = interaction.options.getUser('target');
  const minutes = interaction.options.getInteger('duration_minutes');
  const reason = interaction.options.getString('reason');
  const member = await interaction.guild.members.fetch(target.id).catch(() => null);

  if (!member) return interaction.reply({ content: 'Could not find that member in this server.', ephemeral: true });
  if (minutes < 1 || minutes > 40320) return interaction.reply({ content: 'Duration must be between 1 minute and 40320 minutes (28 days).', ephemeral: true });

  try {
    await member.timeout(minutes * 60 * 1000, reason);
    await requestLog.logAction({ executorId: interaction.user.id, executorTag: interaction.user.tag, action: 'mute', targetId: target.id, targetLabel: target.tag, reason }, interaction.guild);
    await interaction.reply(`🔇 Muted **${target.tag}** for ${minutes} minute(s). Reason: ${reason}`);
  } catch (err) {
    await interaction.reply({ content: `Couldn't mute ${target.tag} — they may have a higher role than me, or I'm missing the Moderate Members permission.`, ephemeral: true });
  }
}

async function handleUnmute(interaction) {
  const target = interaction.options.getUser('target');
  const reason = interaction.options.getString('reason');
  const member = await interaction.guild.members.fetch(target.id).catch(() => null);

  if (!member) return interaction.reply({ content: 'Could not find that member in this server.', ephemeral: true });

  try {
    await member.timeout(null, reason);
    await requestLog.logAction({ executorId: interaction.user.id, executorTag: interaction.user.tag, action: 'unmute', targetId: target.id, targetLabel: target.tag, reason }, interaction.guild);
    await interaction.reply(`🔊 Unmuted **${target.tag}**. Reason: ${reason}`);
  } catch (err) {
    await interaction.reply({ content: `Couldn't unmute ${target.tag} — I may be missing the Moderate Members permission.`, ephemeral: true });
  }
}

async function handleWarn(interaction) {
  const target = interaction.options.getUser('target');
  const reason = interaction.options.getString('reason');
  const revert = interaction.options.getBoolean('revert') || false;

  const newCount = requestWarnings.addWarning(target.id);
  const member = await interaction.guild.members.fetch(target.id).catch(() => null);

  const warnedRoleId = settingsStore.get('requestWarnedRoleId', null);
  const accessRoleId = settingsStore.get('requestAccessRoleId', null);
  let warnedRoleApplied = false;
  let accessRevoked = false;

  if (member) {
    if (newCount === 1 && warnedRoleId) {
      await member.roles.add(warnedRoleId, `1st /request warning by ${interaction.user.tag}: ${reason}`).catch(() => {});
      warnedRoleApplied = true;
    }
    if (newCount >= 2 && accessRoleId && member.roles.cache.has(accessRoleId)) {
      await member.roles.remove(accessRoleId, `2nd /request warning by ${interaction.user.tag}: ${reason}`).catch(() => {});
      accessRevoked = true;
    }
  }

  let revertMessage = '';
  if (revert) {
    const result = await requestLog.revertLastAction(target.id, interaction.guild);
    revertMessage = `\nRevert attempt: ${result.message}`;
  }

  await requestLog.logAction({ executorId: interaction.user.id, executorTag: interaction.user.tag, action: 'warn', targetId: target.id, targetLabel: target.tag, reason }, interaction.guild);

  await interaction.reply(
    `⚠️ Warned **${target.tag}** (warning #${newCount}). Reason: ${reason}` +
    (warnedRoleApplied ? '\nApplied the warned role.' : '') +
    (accessRevoked ? '\n🚫 Access role removed — they can no longer use /request.' : '') +
    revertMessage
  );
}

// ---- /request channel ----
async function handleCreateChannel(interaction) {
  const name = interaction.options.getString('name');
  const typeInput = interaction.options.getString('type');
  const reason = interaction.options.getString('reason');
  const typeMap = { text: ChannelType.GuildText, voice: ChannelType.GuildVoice, category: ChannelType.GuildCategory };

  try {
    const channel = await interaction.guild.channels.create({ name, type: typeMap[typeInput], reason });
    await requestLog.logAction({ executorId: interaction.user.id, executorTag: interaction.user.tag, action: 'channel-create', targetId: channel.id, targetLabel: `#${channel.name}`, reason }, interaction.guild);
    await interaction.reply(`✅ Created ${typeInput} channel: ${channel.toString ? channel.toString() : channel.name}. Reason: ${reason}`);
  } catch (err) {
    await interaction.reply({ content: `Couldn't create that channel — I may be missing the Manage Channels permission.`, ephemeral: true });
  }
}

async function handleDeleteChannel(interaction) {
  const channel = interaction.options.getChannel('channel');
  const reason = interaction.options.getString('reason');
  const label = `#${channel.name}`;

  try {
    await channel.delete(reason);
    await requestLog.logAction({ executorId: interaction.user.id, executorTag: interaction.user.tag, action: 'channel-delete', targetId: channel.id, targetLabel: label, reason }, interaction.guild);
    await interaction.reply(`🗑️ Deleted channel **${label}**. Reason: ${reason}`);
  } catch (err) {
    await interaction.reply({ content: `Couldn't delete that channel — I may be missing the Manage Channels permission.`, ephemeral: true });
  }
}

async function handleEditChannel(interaction) {
  const channel = interaction.options.getChannel('channel');
  const reason = interaction.options.getString('reason');
  const newName = interaction.options.getString('new_name');
  const topic = interaction.options.getString('topic');

  if (!newName && !topic) return interaction.reply({ content: 'Provide at least a new name or a new topic to change.', ephemeral: true });

  try {
    const changes = { reason };
    if (newName) changes.name = newName;
    if (topic) changes.topic = topic;
    await channel.edit(changes);
    await requestLog.logAction({ executorId: interaction.user.id, executorTag: interaction.user.tag, action: 'channel-edit', targetId: channel.id, targetLabel: `#${channel.name}`, reason }, interaction.guild);
    await interaction.reply(`✅ Updated **${channel.name}**. Reason: ${reason}`);
  } catch (err) {
    await interaction.reply({ content: `Couldn't edit that channel — I may be missing the Manage Channels permission.`, ephemeral: true });
  }
}

async function handleChannelPerm(interaction) {
  const channel = interaction.options.getChannel('channel');
  const permission = interaction.options.getString('permission');
  const setting = interaction.options.getString('setting');
  const reason = interaction.options.getString('reason');
  const targetRole = interaction.options.getRole('target_role');
  const targetUser = interaction.options.getUser('target_user');

  if ((!targetRole && !targetUser) || (targetRole && targetUser)) {
    return interaction.reply({ content: 'Provide exactly one of target_role OR target_user.', ephemeral: true });
  }
  const overwriteTargetId = targetRole ? targetRole.id : targetUser.id;
  const targetLabel = targetRole ? `@${targetRole.name}` : targetUser.tag;

  try {
    // Snapshot the current overwrite before changing it, so revert:true can restore it exactly.
    const existing = channel.permissionOverwrites.cache.get(overwriteTargetId);
    const snapshot = {
      channelId: channel.id,
      overwriteTargetId,
      allow: existing ? existing.allow.bitfield.toString() : '0',
      deny: existing ? existing.deny.bitfield.toString() : '0',
    };

    if (setting === 'allow') {
      await channel.permissionOverwrites.edit(overwriteTargetId, { [permission]: true }, { reason });
    } else if (setting === 'deny') {
      await channel.permissionOverwrites.edit(overwriteTargetId, { [permission]: false }, { reason });
    } else {
      await channel.permissionOverwrites.edit(overwriteTargetId, { [permission]: null }, { reason });
    }

    await requestLog.logAction({
      executorId: interaction.user.id,
      executorTag: interaction.user.tag,
      action: 'channel-perm',
      targetId: overwriteTargetId,
      targetLabel: `${permission} ${setting} for ${targetLabel} in #${channel.name}`,
      reason,
      snapshot,
    }, interaction.guild);

    await interaction.reply(`✅ Set **${permission}** to **${setting}** for ${targetLabel} in ${channel}. Reason: ${reason}`);
  } catch (err) {
    await interaction.reply({ content: `Couldn't change that permission — I may be missing the Manage Roles permission, or my role may be positioned too low.`, ephemeral: true });
  }
}

// ---- /request role ----
async function handleCreateRole(interaction) {
  const name = interaction.options.getString('name');
  const reason = interaction.options.getString('reason');
  const colorInput = interaction.options.getString('color');
  let color;
  if (colorInput) {
    const hex = colorInput.trim().replace('#', '');
    if (/^[0-9A-Fa-f]{6}$/.test(hex)) color = parseInt(hex, 16);
  }

  try {
    const role = await interaction.guild.roles.create({ name, color, reason });
    await requestLog.logAction({ executorId: interaction.user.id, executorTag: interaction.user.tag, action: 'role-create', targetId: role.id, targetLabel: role.name, reason }, interaction.guild);
    await interaction.reply(`✅ Created role **${role.name}**. Reason: ${reason}`);
  } catch (err) {
    await interaction.reply({ content: `Couldn't create that role — I may be missing the Manage Roles permission.`, ephemeral: true });
  }
}

async function handleDeleteRole(interaction) {
  const role = interaction.options.getRole('role');
  const reason = interaction.options.getString('reason');
  const label = role.name;

  try {
    await role.delete(reason);
    await requestLog.logAction({ executorId: interaction.user.id, executorTag: interaction.user.tag, action: 'role-delete', targetId: role.id, targetLabel: label, reason }, interaction.guild);
    await interaction.reply(`🗑️ Deleted role **${label}**. Reason: ${reason}`);
  } catch (err) {
    await interaction.reply({ content: `Couldn't delete that role — it may be higher than my own role, or I'm missing the Manage Roles permission.`, ephemeral: true });
  }
}

// ---- /request automod ----
async function handleAutomodList(interaction) {
  try {
    const rules = await interaction.guild.autoModerationRules.fetch();
    if (rules.size === 0) {
      return interaction.reply({ content: 'No AutoMod rules exist yet. Run `/setup automod` to create starter rules.', ephemeral: true });
    }
    const lines = rules.map(r => `**${r.name}** — ${r.enabled ? '🟢 Enabled' : '🔴 Disabled'}`);
    await interaction.reply({ content: lines.join('\n'), ephemeral: true });
  } catch (err) {
    await interaction.reply({ content: `Couldn't fetch AutoMod rules — I may be missing the Manage Server permission.`, ephemeral: true });
  }
}

async function handleAutomodToggle(interaction) {
  const ruleName = interaction.options.getString('rule_name');
  const enabled = interaction.options.getBoolean('enabled');
  const reason = `AutoMod rule toggled by ${interaction.user.tag}`;

  try {
    const rules = await interaction.guild.autoModerationRules.fetch();
    const rule = rules.find(r => r.name === ruleName);
    if (!rule) {
      return interaction.reply({ content: `No AutoMod rule named exactly "${ruleName}" was found. Check \`/request automod list\` for exact names.`, ephemeral: true });
    }

    await rule.setEnabled(enabled, reason);
    await requestLog.logAction({ executorId: interaction.user.id, executorTag: interaction.user.tag, action: 'automod-toggle', targetId: rule.id, targetLabel: rule.name, reason: `Set to ${enabled ? 'enabled' : 'disabled'}` }, interaction.guild);
    await interaction.reply(`✅ **${ruleName}** is now ${enabled ? '🟢 enabled' : '🔴 disabled'}.`);
  } catch (err) {
    await interaction.reply({ content: `Couldn't toggle that rule — I may be missing the Manage Server permission.`, ephemeral: true });
  }
}

module.exports = {
  checkAccess,
  handleSetupLogChannel,
  handleSetupAccessRole,
  handleSetupWarnedRole,
  handleKick,
  handleBan,
  handleUnban,
  handleMute,
  handleUnmute,
  handleWarn,
  handleCreateChannel,
  handleDeleteChannel,
  handleEditChannel,
  handleChannelPerm,
  handleCreateRole,
  handleDeleteRole,
  handleAutomodList,
  handleAutomodToggle,
};
