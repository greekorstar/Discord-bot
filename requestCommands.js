// requestCommands.js — The actions behind /request. This command is intentionally
// NOT gated by a Discord permission check in code — access is controlled entirely
// by which roles the server grants the command via Server Settings > Integrations,
// so trusted roles can use it without needing to hold the raw Kick/Ban/etc. permission.

const { ChannelType } = require('discord.js');

async function handleKick(interaction) {
  const target = interaction.options.getUser('target');
  const reason = interaction.options.getString('reason') || 'No reason given';
  const member = await interaction.guild.members.fetch(target.id).catch(() => null);

  if (!member) {
    await interaction.reply({ content: 'Could not find that member in this server.', ephemeral: true });
    return;
  }
  if (!member.kickable) {
    await interaction.reply({ content: `I can't kick ${target.tag} — they may have a higher role than me, or I'm missing the Kick Members permission.`, ephemeral: true });
    return;
  }

  await member.kick(reason);
  await interaction.reply(`👢 Kicked **${target.tag}**. Reason: ${reason}`);
}

async function handleBan(interaction) {
  const target = interaction.options.getUser('target');
  const reason = interaction.options.getString('reason') || 'No reason given';

  try {
    await interaction.guild.members.ban(target.id, { reason });
    await interaction.reply(`🔨 Banned **${target.tag}**. Reason: ${reason}`);
  } catch (err) {
    await interaction.reply({ content: `Couldn't ban ${target.tag} — they may have a higher role than me, or I'm missing the Ban Members permission.`, ephemeral: true });
  }
}

async function handleUnban(interaction) {
  const userId = interaction.options.getString('user_id');

  try {
    await interaction.guild.members.unban(userId);
    await interaction.reply(`✅ Unbanned user ID \`${userId}\`.`);
  } catch (err) {
    await interaction.reply({ content: `Couldn't unban that ID — double check it's correct and that they're actually banned.`, ephemeral: true });
  }
}

async function handleMute(interaction) {
  const target = interaction.options.getUser('target');
  const minutes = interaction.options.getInteger('duration_minutes');
  const reason = interaction.options.getString('reason') || 'No reason given';
  const member = await interaction.guild.members.fetch(target.id).catch(() => null);

  if (!member) {
    await interaction.reply({ content: 'Could not find that member in this server.', ephemeral: true });
    return;
  }
  if (minutes < 1 || minutes > 40320) { // Discord's timeout max is 28 days
    await interaction.reply({ content: 'Duration must be between 1 minute and 40320 minutes (28 days).', ephemeral: true });
    return;
  }

  try {
    await member.timeout(minutes * 60 * 1000, reason);
    await interaction.reply(`🔇 Muted **${target.tag}** for ${minutes} minute(s). Reason: ${reason}`);
  } catch (err) {
    await interaction.reply({ content: `Couldn't mute ${target.tag} — they may have a higher role than me, or I'm missing the Moderate Members permission.`, ephemeral: true });
  }
}

async function handleUnmute(interaction) {
  const target = interaction.options.getUser('target');
  const member = await interaction.guild.members.fetch(target.id).catch(() => null);

  if (!member) {
    await interaction.reply({ content: 'Could not find that member in this server.', ephemeral: true });
    return;
  }

  try {
    await member.timeout(null);
    await interaction.reply(`🔊 Unmuted **${target.tag}**.`);
  } catch (err) {
    await interaction.reply({ content: `Couldn't unmute ${target.tag} — I may be missing the Moderate Members permission.`, ephemeral: true });
  }
}

async function handleCreateChannel(interaction) {
  const name = interaction.options.getString('name');
  const typeInput = interaction.options.getString('type');
  const typeMap = { text: ChannelType.GuildText, voice: ChannelType.GuildVoice, category: ChannelType.GuildCategory };

  try {
    const channel = await interaction.guild.channels.create({ name, type: typeMap[typeInput] });
    await interaction.reply(`✅ Created ${typeInput} channel: ${channel.toString ? channel.toString() : channel.name}`);
  } catch (err) {
    await interaction.reply({ content: `Couldn't create that channel — I may be missing the Manage Channels permission.`, ephemeral: true });
  }
}

async function handleDeleteChannel(interaction) {
  const channel = interaction.options.getChannel('channel');

  try {
    await channel.delete();
    await interaction.reply(`🗑️ Deleted channel **${channel.name}**.`);
  } catch (err) {
    await interaction.reply({ content: `Couldn't delete that channel — I may be missing the Manage Channels permission.`, ephemeral: true });
  }
}

async function handleEditChannel(interaction) {
  const channel = interaction.options.getChannel('channel');
  const newName = interaction.options.getString('new_name');
  const topic = interaction.options.getString('topic');

  if (!newName && !topic) {
    await interaction.reply({ content: 'Provide at least a new name or a new topic to change.', ephemeral: true });
    return;
  }

  try {
    const changes = {};
    if (newName) changes.name = newName;
    if (topic) changes.topic = topic;
    await channel.edit(changes);
    await interaction.reply(`✅ Updated **${channel.name}**.`);
  } catch (err) {
    await interaction.reply({ content: `Couldn't edit that channel — I may be missing the Manage Channels permission.`, ephemeral: true });
  }
}

async function handleCreateRole(interaction) {
  const name = interaction.options.getString('name');
  const colorInput = interaction.options.getString('color');
  let color;
  if (colorInput) {
    const hex = colorInput.trim().replace('#', '');
    if (/^[0-9A-Fa-f]{6}$/.test(hex)) color = parseInt(hex, 16);
  }

  try {
    const role = await interaction.guild.roles.create({ name, color });
    await interaction.reply(`✅ Created role **${role.name}**.`);
  } catch (err) {
    await interaction.reply({ content: `Couldn't create that role — I may be missing the Manage Roles permission.`, ephemeral: true });
  }
}

async function handleDeleteRole(interaction) {
  const role = interaction.options.getRole('role');

  try {
    await role.delete();
    await interaction.reply(`🗑️ Deleted role **${role.name}**.`);
  } catch (err) {
    await interaction.reply({ content: `Couldn't delete that role — it may be higher than my own role, or I'm missing the Manage Roles permission.`, ephemeral: true });
  }
}

module.exports = {
  handleKick,
  handleBan,
  handleUnban,
  handleMute,
  handleUnmute,
  handleCreateChannel,
  handleDeleteChannel,
  handleEditChannel,
  handleCreateRole,
  handleDeleteRole,
};
