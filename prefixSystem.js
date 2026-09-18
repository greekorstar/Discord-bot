// prefixSystem.js — Prefix-based commands (e.g. "!purge 10"), as an alternative
// to slash commands. Includes:
//   - !purge      bulk-delete messages
//   - !snipe      show the last deleted message in this channel
//   - !serverinfo advanced server info embed
//   - !role       add/remove a role on a member
//   - !disable    block prefix commands in a channel
//   - !enable     un-block a channel
//   - !whitelist  restrict prefix commands to ONLY whitelisted channels
//   - !setprefix  change the prefix (this is the "setup" command)
//   - !help       list all of the above
//
// Settings (prefix, channel restrictions) persist via settingsStore.js, same
// as the rest of the bot. Channel-restriction rules only apply to the commands
// above that aren't themselves server-management commands — you can always
// run !enable / !whitelist / !setprefix / !help to dig yourself out, even in a
// channel you've disabled.

const { PermissionFlagsBits, EmbedBuilder, ChannelType } = require('discord.js');
const settingsStore = require('./settingsStore.js');
const logSystem = require('./logSystem.js');

const DEFAULT_PREFIX = '!';

// Commands that manage the prefix system itself — always allowed, even in a
// disabled channel or outside the whitelist, so admins can never lock
// themselves out.
const MANAGEMENT_COMMANDS = new Set(['disable', 'enable', 'whitelist', 'setprefix', 'help']);

// ---- Settings ----

function getPrefix() {
  return settingsStore.get('prefix', DEFAULT_PREFIX);
}

function setPrefix(prefix) {
  settingsStore.set('prefix', prefix);
}

function getDisabledChannelIds() {
  return settingsStore.get('disabledChannelIds', []);
}

function getWhitelistedChannelIds() {
  return settingsStore.get('whitelistedChannelIds', []);
}

function isWhitelistModeEnabled() {
  return settingsStore.get('whitelistModeEnabled', false);
}

// Whether a NON-management command is allowed to run in this channel.
function isChannelAllowed(channelId) {
  if (isWhitelistModeEnabled()) {
    return getWhitelistedChannelIds().includes(channelId);
  }
  return !getDisabledChannelIds().includes(channelId);
}

// ---- Snipe cache (in-memory, most recent deleted message per channel) ----

const snipeCache = new Map(); // channelId -> { content, authorTag, authorId, avatarURL, attachmentUrl, timestamp }

function recordDeletedMessage(message) {
  if (!message.guild || message.author?.bot) return;
  snipeCache.set(message.channelId, {
    content: message.content || '',
    authorTag: message.author?.tag || 'Unknown user',
    authorId: message.author?.id || null,
    avatarURL: message.author?.displayAvatarURL?.() || null,
    attachmentUrl: message.attachments?.first()?.url || null,
    timestamp: Date.now(),
  });
}

function recordDeletedMessages(messages) {
  // Bulk delete (e.g. from !purge) — keep the most recent one as the snipe.
  const sorted = [...messages.values()].sort((a, b) => (b.createdTimestamp || 0) - (a.createdTimestamp || 0));
  if (sorted[0]) recordDeletedMessage(sorted[0]);
}

// ---- Permission helper (message-based, mirrors permissions.js) ----

async function requirePermission(message, bit, label) {
  if (!message.member.permissions.has(bit)) {
    await message.reply(`🚫 You need the **${label}** permission to use this command.`);
    return false;
  }
  return true;
}

function parseChannelArg(message, args) {
  return message.mentions.channels.first() || message.guild.channels.cache.get(args[0]) || message.channel;
}

// ---- Commands ----

async function cmdPurge(message, args) {
  if (!(await requirePermission(message, PermissionFlagsBits.ManageMessages, 'Manage Messages'))) return;

  const targetUser = message.mentions.users.first();
  const amountArg = args.find(a => !a.startsWith('<@')); // the numeric arg, skipping a mention
  const amount = parseInt(amountArg, 10);

  if (!amount || amount < 1 || amount > 100) {
    await message.reply('Usage: `!purge <amount 1-100> [@user]`');
    return;
  }

  await message.delete().catch(() => {});

  const fetched = await message.channel.messages.fetch({ limit: 100 }).catch(() => null);
  if (!fetched) {
    await message.channel.send('❌ Could not fetch messages to purge.').then(m => setTimeout(() => m.delete().catch(() => {}), 5000));
    return;
  }

  let toDelete = [...fetched.values()];
  if (targetUser) toDelete = toDelete.filter(m => m.author.id === targetUser.id);
  toDelete = toDelete.slice(0, amount);

  if (toDelete.length === 0) {
    await message.channel.send('Nothing to delete.').then(m => setTimeout(() => m.delete().catch(() => {}), 5000));
    return;
  }

  recordDeletedMessages(new Map(toDelete.map(m => [m.id, m])));

  const deleted = await message.channel.bulkDelete(toDelete, true).catch(() => null);
  const deletedCount = deleted ? deleted.size : 0;

  await logSystem.logPurge(message.guild, message.channel, message.author, deletedCount, targetUser);

  await message.channel.send(`🧹 Deleted **${deletedCount}** message(s)${targetUser ? ` from **${targetUser.tag}**` : ''}.`)
    .then(m => setTimeout(() => m.delete().catch(() => {}), 5000));
}

async function cmdSnipe(message) {
  const sniped = snipeCache.get(message.channelId);
  if (!sniped) {
    await message.reply('There\'s nothing to snipe in this channel.');
    return;
  }

  const embed = new EmbedBuilder()
    .setAuthor({ name: sniped.authorTag, iconURL: sniped.avatarURL || undefined })
    .setDescription(sniped.content || '*(no text content — attachment only)*')
    .setColor(0xED4245)
    .setFooter({ text: 'Deleted' })
    .setTimestamp(sniped.timestamp);

  if (sniped.attachmentUrl) embed.setImage(sniped.attachmentUrl);

  await message.reply({ embeds: [embed] });
}

async function cmdServerInfo(message) {
  const guild = message.guild;
  await guild.members.fetch().catch(() => {}); // best-effort, for an accurate member split

  const members = guild.members.cache;
  const humanCount = members.filter(m => !m.user.bot).size;
  const botCount = members.filter(m => m.user.bot).size;

  const channels = guild.channels.cache;
  const textCount = channels.filter(c => c.type === ChannelType.GuildText).size;
  const voiceCount = channels.filter(c => c.type === ChannelType.GuildVoice).size;
  const categoryCount = channels.filter(c => c.type === ChannelType.GuildCategory).size;

  const owner = await guild.fetchOwner().catch(() => null);

  const verificationLevels = { 0: 'None', 1: 'Low', 2: 'Medium', 3: 'High', 4: 'Very High' };

  const embed = new EmbedBuilder()
    .setTitle(`📊 ${guild.name}`)
    .setThumbnail(guild.iconURL({ size: 256 }) || null)
    .setColor(0x5865F2)
    .addFields(
      { name: 'Owner', value: owner ? `<@${owner.id}>` : 'Unknown', inline: true },
      { name: 'Server ID', value: guild.id, inline: true },
      { name: 'Created', value: `<t:${Math.floor(guild.createdTimestamp / 1000)}:D>`, inline: true },
      { name: 'Members', value: `${guild.memberCount} total\n${humanCount} humans, ${botCount} bots`, inline: true },
      { name: 'Channels', value: `${textCount} text, ${voiceCount} voice\n${categoryCount} categories`, inline: true },
      { name: 'Roles', value: `${guild.roles.cache.size}`, inline: true },
      { name: 'Boosts', value: `Level ${guild.premiumTier} (${guild.premiumSubscriptionCount || 0} boosts)`, inline: true },
      { name: 'Verification', value: verificationLevels[guild.verificationLevel] ?? 'Unknown', inline: true },
      { name: 'Emojis / Stickers', value: `${guild.emojis.cache.size} / ${guild.stickers.cache.size}`, inline: true },
    )
    .setFooter({ text: `Requested by ${message.author.tag}` })
    .setTimestamp();

  await message.reply({ embeds: [embed] });
}

async function cmdRole(message, args) {
  if (!(await requirePermission(message, PermissionFlagsBits.ManageRoles, 'Manage Roles'))) return;

  const action = args[0]?.toLowerCase();
  const targetMember = message.mentions.members?.first();
  const role = message.mentions.roles?.first();

  if (!['add', 'remove'].includes(action) || !targetMember || !role) {
    await message.reply('Usage: `!role add @user @role` or `!role remove @user @role`');
    return;
  }

  const me = message.guild.members.me;
  if (role.position >= me.roles.highest.position) {
    await message.reply(`❌ I can't manage **${role.name}** — it's above (or equal to) my highest role.`);
    return;
  }
  if (role.position >= message.member.roles.highest.position && message.guild.ownerId !== message.author.id) {
    await message.reply(`❌ You can't manage **${role.name}** — it's above (or equal to) your highest role.`);
    return;
  }

  try {
    if (action === 'add') {
      await targetMember.roles.add(role);
      await message.reply(`✅ Added **${role.name}** to <@${targetMember.id}>.`);
    } else {
      await targetMember.roles.remove(role);
      await message.reply(`✅ Removed **${role.name}** from <@${targetMember.id}>.`);
    }
    await logSystem.logRoleChange(message.guild, message.author, targetMember, role, action);
  } catch (err) {
    await message.reply(`❌ Failed to update roles: ${err.message}`);
  }
}

async function cmdDisable(message, args) {
  if (!(await requirePermission(message, PermissionFlagsBits.ManageGuild, 'Manage Server'))) return;

  const channel = parseChannelArg(message, args);
  const disabled = getDisabledChannelIds();

  let updated;
  let nowDisabled;
  if (disabled.includes(channel.id)) {
    updated = disabled.filter(id => id !== channel.id);
    nowDisabled = false;
  } else {
    updated = [...disabled, channel.id];
    nowDisabled = true;
  }
  settingsStore.set('disabledChannelIds', updated);

  await message.reply(nowDisabled
    ? `🔒 Prefix commands are now **disabled** in <#${channel.id}>.`
    : `🔓 Prefix commands are now **re-enabled** in <#${channel.id}>.`);
}

async function cmdEnable(message, args) {
  if (!(await requirePermission(message, PermissionFlagsBits.ManageGuild, 'Manage Server'))) return;

  const channel = parseChannelArg(message, args);
  const updated = getDisabledChannelIds().filter(id => id !== channel.id);
  settingsStore.set('disabledChannelIds', updated);

  await message.reply(`🔓 Prefix commands are **enabled** in <#${channel.id}> (if whitelist mode is on, it also needs to be whitelisted — see \`!whitelist\`).`);
}

async function cmdWhitelist(message, args) {
  if (!(await requirePermission(message, PermissionFlagsBits.ManageGuild, 'Manage Server'))) return;

  const sub = args[0]?.toLowerCase();

  if (sub === 'on' || sub === 'enable') {
    settingsStore.set('whitelistModeEnabled', true);
    await message.reply('✅ Whitelist mode is **ON** — prefix commands now only work in whitelisted channels.');
    return;
  }
  if (sub === 'off' || sub === 'disable') {
    settingsStore.set('whitelistModeEnabled', false);
    await message.reply('✅ Whitelist mode is **OFF** — prefix commands now work everywhere except disabled channels.');
    return;
  }
  if (sub === 'add') {
    const channel = parseChannelArg(message, args.slice(1));
    const list = getWhitelistedChannelIds();
    if (!list.includes(channel.id)) settingsStore.set('whitelistedChannelIds', [...list, channel.id]);
    await message.reply(`✅ <#${channel.id}> added to the whitelist.`);
    return;
  }
  if (sub === 'remove') {
    const channel = parseChannelArg(message, args.slice(1));
    settingsStore.set('whitelistedChannelIds', getWhitelistedChannelIds().filter(id => id !== channel.id));
    await message.reply(`✅ <#${channel.id}> removed from the whitelist.`);
    return;
  }
  if (sub === 'list') {
    const list = getWhitelistedChannelIds();
    await message.reply(list.length
      ? `Whitelisted channels: ${list.map(id => `<#${id}>`).join(', ')}\nMode is **${isWhitelistModeEnabled() ? 'ON' : 'OFF'}**.`
      : `No channels whitelisted yet. Mode is **${isWhitelistModeEnabled() ? 'ON' : 'OFF'}**.`);
    return;
  }

  await message.reply('Usage: `!whitelist on|off|add [#channel]|remove [#channel]|list`');
}

async function cmdSetPrefix(message, args) {
  if (!(await requirePermission(message, PermissionFlagsBits.ManageGuild, 'Manage Server'))) return;

  const newPrefix = args[0];
  if (!newPrefix || newPrefix.length > 5 || /\s/.test(newPrefix)) {
    await message.reply('Usage: `!setprefix <new prefix>` (max 5 characters, no spaces)');
    return;
  }

  setPrefix(newPrefix);
  await message.reply(`✅ Prefix changed to \`${newPrefix}\`. Example: \`${newPrefix}help\``);
}

async function cmdHelp(message) {
  const prefix = getPrefix();
  const embed = new EmbedBuilder()
    .setTitle('📖 Prefix Commands')
    .setColor(0x5865F2)
    .setDescription(
      `\`${prefix}purge <amount> [@user]\` — bulk-delete messages\n` +
      `\`${prefix}snipe\` — show the last deleted message here\n` +
      `\`${prefix}serverinfo\` — advanced server info\n` +
      `\`${prefix}role add|remove @user @role\` — manage a member's role\n` +
      `\`${prefix}disable [#channel]\` — toggle commands off in a channel\n` +
      `\`${prefix}enable [#channel]\` — turn commands back on in a channel\n` +
      `\`${prefix}whitelist on|off|add|remove|list\` — restrict commands to specific channels\n` +
      `\`${prefix}setprefix <prefix>\` — change this prefix\n\n` +
      `**Every original slash command also works with this prefix** — e.g. \`${prefix}kick @user spamming\`, \`${prefix}unban 123456789012345678\`, \`${prefix}unmute @user\`, \`${prefix}warn add @user rude\`, \`${prefix}level rank\`, \`${prefix}embed create\`, \`${prefix}setup general\`, \`${prefix}verify panel\`, \`${prefix}card gold Big announcement here!\`, etc. Slash commands (\`/kick\`, \`/warn\`, ...) still work too.`
    );
  await message.reply({ embeds: [embed] });
}

const HANDLERS = {
  purge: cmdPurge,
  snipe: cmdSnipe,
  serverinfo: cmdServerInfo,
  role: cmdRole,
  disable: cmdDisable,
  enable: cmdEnable,
  whitelist: cmdWhitelist,
  setprefix: cmdSetPrefix,
  help: cmdHelp,
};

// ---- Dispatcher ----

async function handleMessage(message) {
  if (message.author.bot || !message.guild) return;

  const prefix = getPrefix();
  if (!message.content.startsWith(prefix)) return;

  const args = message.content.slice(prefix.length).trim().split(/\s+/);
  const commandName = args.shift()?.toLowerCase();
  const handler = HANDLERS[commandName];
  if (!handler) return;

  if (!MANAGEMENT_COMMANDS.has(commandName) && !isChannelAllowed(message.channelId)) return;

  logSystem.logPrefixCommand(message, commandName, args.join(' ')).catch(err => console.error('[logSystem] Failed to log prefix command:', err.message));

  try {
    await handler(message, args);
  } catch (err) {
    console.error(`[prefixSystem] Error running ${commandName}:`, err.message);
    await message.reply('❌ Something went wrong running that command.').catch(() => {});
  }
}

module.exports = {
  handleMessage,
  recordDeletedMessage,
  recordDeletedMessages,
  getPrefix,
  isChannelAllowed,
};
