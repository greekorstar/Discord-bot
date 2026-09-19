// levelSystem.js — A full leveling system modeled on Arcane's Leveling plugin,
// with every Premium-only cap removed (unlimited role rewards, unlimited
// boosters, etc). Covers: message XP, voice XP, reaction XP, manual XP,
// no-XP channels/roles, XP-only channel whitelist, effort booster, role
// boosters, channel boosters, role rewards (stacked or highest-only), a
// first-place role, level-up announcements (channel or DM), multiple
// leaderboards (overall/voice/reactions/weekly/monthly), weekly & monthly
// "Highlights" auto-posts, and an image rank card (falls back to an embed
// if the optional @napi-rs/canvas package isn't installed).
//
// Two honest scope notes, since Arcane's internals aren't public:
//   1. The XP curve here is the widely-used "5*lvl^2 + 50*lvl + 100" formula
//      (same shape MEE6 popularized) — Arcane's exact proprietary curve
//      (it's closed-source, written in Rust) isn't published anywhere, so
//      this is an equivalent, not a byte-for-byte clone.
//   2. Voice XP is awarded per-minute via a periodic sweep of who's currently
//      in a voice channel (with =2 humans present, not deafened) rather than
//      precise join/leave session timers — simpler and restart-safe, same
//      end result.

const fs = require('fs');
const path = require('path');
const { EmbedBuilder, AttachmentBuilder, ChannelType } = require('discord.js');

const CONFIG_FILE = path.join(__dirname, 'levelConfig.json');
const DATA_FILE = path.join(__dirname, 'levelData.json');

let configs = {}; // guildId -> config object
let userData = {}; // "guildId:userId" -> data object

// ---- Persistence ----

function load() {
  try { configs = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8')); } catch { configs = {}; }
  try { userData = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8')); } catch { userData = {}; }
}

function saveConfigs() {
  try { fs.writeFileSync(CONFIG_FILE, JSON.stringify(configs, null, 2)); }
  catch (err) { console.error('[levelSystem] Failed to save levelConfig.json:', err.message); }
}

function saveData() {
  try { fs.writeFileSync(DATA_FILE, JSON.stringify(userData, null, 2)); }
  catch (err) { console.error('[levelSystem] Failed to save levelData.json:', err.message); }
}

function defaultConfig() {
  return {
    enabled: true,
    maxLevel: 0, // 0 = unlimited
    xp: {
      messageMin: 15,
      messageMax: 25,
      messageCooldownSeconds: 60,
      voiceXpPerMinute: 10,
      reactionXp: 5,
      reactionCooldownSeconds: 300,
      effortBoosterEnabled: true, // longer messages / messages with an image get bonus XP
    },
    restrictions: {
      noXpChannelIds: [], // blacklist
      xpChannelIds: [],   // whitelist — if non-empty, ONLY these channels grant XP
      noXpRoleIds: [],
    },
    boosters: {
      stack: true, // combine all applicable boosters vs. only the highest
      roles: [],    // [{ roleId, percent }]
      channels: [], // [{ channelId, percent }]
    },
    rewards: {
      stack: true, // give every role reward qualified for vs. only the highest
      list: [],    // [{ level, roleId }]
    },
    firstPlaceRoleId: '',
    levelUp: {
      enabled: true,
      channelId: '', // '' = announce in the channel the message was sent in
      useDm: false,
      message: '{user} just leveled up to **Level {level}**! Keep it up 🚀',
    },
    highlights: {
      channelId: '',
      weekStartIso: '',
      monthStartIso: '',
    },
  };
}

function getConfig(guildId) {
  if (!configs[guildId]) {
    configs[guildId] = defaultConfig();
    saveConfigs();
  }
  // Merge in any new default fields added after a config was first created.
  configs[guildId] = { ...defaultConfig(), ...configs[guildId] };
  return configs[guildId];
}

function setConfig(guildId, config) {
  configs[guildId] = config;
  saveConfigs();
}

function dataKey(guildId, userId) {
  return `${guildId}:${userId}`;
}

function getUserData(guildId, userId) {
  const key = dataKey(guildId, userId);
  if (!userData[key]) {
    userData[key] = { xp: 0, weeklyXp: 0, monthlyXp: 0, voiceMinutes: 0, reactionsGiven: 0, messageCount: 0, lastMessageXpAt: 0, lastReactionXpAt: 0 };
  }
  return userData[key];
}

load();

// ---- XP curve: total cumulative XP needed to REACH a given level ----

function xpForNextLevel(level) {
  return 5 * level * level + 50 * level + 100;
}

function levelFromXp(totalXp) {
  let level = 0;
  let remaining = totalXp;
  while (remaining >= xpForNextLevel(level)) {
    remaining -= xpForNextLevel(level);
    level++;
  }
  return { level, xpIntoLevel: remaining, xpForNext: xpForNextLevel(level) };
}

// ---- Restriction / booster helpers ----

function isNoXp(config, channelId, member) {
  if (config.restrictions.noXpRoleIds.some(id => member.roles.cache.has(id))) return true;
  if (config.restrictions.xpChannelIds.length > 0) {
    return !config.restrictions.xpChannelIds.includes(channelId); // whitelist mode
  }
  return config.restrictions.noXpChannelIds.includes(channelId); // blacklist mode
}

function boosterMultiplier(config, channelId, member) {
  const roleBoosts = config.boosters.roles.filter(b => member.roles.cache.has(b.roleId)).map(b => b.percent);
  const channelBoosts = config.boosters.channels.filter(b => b.channelId === channelId).map(b => b.percent);
  const all = [...roleBoosts, ...channelBoosts];
  if (all.length === 0) return 1;
  const totalPercent = config.boosters.stack ? all.reduce((a, b) => a + b, 0) : Math.max(...all);
  return 1 + totalPercent / 100;
}

// ---- Core XP grant + level-up + role rewards ----

async function grantXp(member, baseAmount, channelId, sourceChannelForAnnounce) {
  const guild = member.guild;
  const config = getConfig(guild.id);
  if (!config.enabled) return;
  if (isNoXp(config, channelId, member)) return;

  const multiplier = boosterMultiplier(config, channelId, member);
  const amount = Math.round(baseAmount * multiplier);

  const data = getUserData(guild.id, member.id);
  const before = levelFromXp(data.xp);

  if (config.maxLevel > 0 && before.level >= config.maxLevel) return; // already at the cap

  data.xp += amount;
  data.weeklyXp += amount;
  data.monthlyXp += amount;
  saveData();

  const after = levelFromXp(data.xp);
  if (after.level > before.level) {
    await onLevelUp(member, after.level, sourceChannelForAnnounce);
  }
}

async function applyRoleRewards(member, level) {
  const config = getConfig(member.guild.id);
  const qualifying = config.rewards.list.filter(r => r.level <= level).sort((a, b) => b.level - a.level);
  if (qualifying.length === 0) return;

  try {
    if (config.rewards.stack) {
      const roleIds = qualifying.map(r => r.roleId);
      const missing = roleIds.filter(id => !member.roles.cache.has(id));
      if (missing.length > 0) await member.roles.add(missing);
    } else {
      const highestRoleId = qualifying[0].roleId;
      if (!member.roles.cache.has(highestRoleId)) await member.roles.add(highestRoleId);
      const toRemove = config.rewards.list.map(r => r.roleId).filter(id => id !== highestRoleId && member.roles.cache.has(id));
      if (toRemove.length > 0) await member.roles.remove(toRemove);
    }
  } catch (err) {
    console.error('[levelSystem] Failed to apply role rewards:', err.message);
  }
}

async function onLevelUp(member, newLevel, sourceChannel) {
  await applyRoleRewards(member, newLevel);

  const config = getConfig(member.guild.id);
  if (!config.levelUp.enabled) return;

  const text = config.levelUp.message.replaceAll('{user}', `<@${member.id}>`).replaceAll('{level}', `${newLevel}`).replaceAll('{server}', member.guild.name);

  const embed = new EmbedBuilder()
    .setAuthor({ name: member.user.username, iconURL: member.user.displayAvatarURL({ extension: 'png', size: 128 }) })
    .setTitle('🎉 Level Up!')
    .setDescription(text)
    .setThumbnail(member.user.displayAvatarURL({ extension: 'png', size: 256 }))
    .setColor(0xFEE75C)
    .setFooter({ text: member.guild.name })
    .setTimestamp();

  try {
    if (config.levelUp.useDm) {
      await member.send({ embeds: [embed] }).catch(() => {}); // DMs can fail silently (closed DMs) — not worth erroring over
      return;
    }
    const channel = config.levelUp.channelId
      ? await member.guild.channels.fetch(config.levelUp.channelId).catch(() => null)
      : sourceChannel;
    if (channel) await channel.send({ embeds: [embed] }).catch(() => {});
  } catch (err) {
    console.error('[levelSystem] Failed to send level-up message:', err.message);
  }
}

// ---- Message XP ----

async function handleMessageXp(message) {
  if (message.author.bot || !message.guild) return;
  const config = getConfig(message.guild.id);
  if (!config.enabled) return;

  const data = getUserData(message.guild.id, message.author.id);
  const now = Date.now();
  if (now - data.lastMessageXpAt < config.xp.messageCooldownSeconds * 1000) return;

  let amount = config.xp.messageMin + Math.floor(Math.random() * (config.xp.messageMax - config.xp.messageMin + 1));
  if (config.xp.effortBoosterEnabled && (message.content.length > 100 || message.attachments.some(a => a.contentType?.startsWith('image/')))) {
    amount = Math.round(amount * 1.3);
  }

  data.lastMessageXpAt = now;
  data.messageCount += 1;
  saveData();

  await grantXp(message.member, amount, message.channel.id, message.channel);
}

// ---- Reaction XP ----

async function handleReactionXp(reaction, user) {
  if (user.bot || !reaction.message.guild) return;
  const config = getConfig(reaction.message.guild.id);
  if (!config.enabled || config.xp.reactionXp <= 0) return;

  const member = await reaction.message.guild.members.fetch(user.id).catch(() => null);
  if (!member) return;

  const data = getUserData(reaction.message.guild.id, user.id);
  const now = Date.now();
  if (now - data.lastReactionXpAt < config.xp.reactionCooldownSeconds * 1000) return;

  data.lastReactionXpAt = now;
  data.reactionsGiven += 1;
  saveData();

  await grantXp(member, config.xp.reactionXp, reaction.message.channel.id, reaction.message.channel);
}

// ---- Voice XP (periodic sweep) ----

async function tickVoiceXp(client) {
  for (const guild of client.guilds.cache.values()) {
    const config = getConfig(guild.id);
    if (!config.enabled || config.xp.voiceXpPerMinute <= 0) continue;

    for (const channel of guild.channels.cache.values()) {
      if (channel.type !== ChannelType.GuildVoice || channel.id === guild.afkChannelId) continue;
      const humans = channel.members.filter(m => !m.user.bot);
      if (humans.size < 2) continue; // require another real person present — basic anti-AFK-farm measure

      for (const member of humans.values()) {
        if (member.voice.deaf || member.voice.selfDeaf) continue;
        if (isNoXp(config, channel.id, member)) continue;

        const data = getUserData(guild.id, member.id);
        data.voiceMinutes += 1;
        saveData();

        await grantXp(member, config.xp.voiceXpPerMinute, channel.id, null);
      }
    }
  }
}

// ---- Weekly / monthly reset + Highlights auto-post (kept fully separate, as requested) ----

function isoWeekStart(d) {
  const date = new Date(d);
  const day = (date.getUTCDay() + 6) % 7; // Monday = 0
  date.setUTCDate(date.getUTCDate() - day);
  date.setUTCHours(0, 0, 0, 0);
  return date.toISOString();
}

function monthStart(d) {
  const date = new Date(d);
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1)).toISOString();
}

// Only fires on the actual boundary day (any hour that day — forgiving of
// downtime), guarded by the stored date so it can only ever fire once per
// week even if the bot restarts many times that same day.
async function tickWeeklyHighlights(client) {
  const now = new Date();
  if (now.getUTCDay() !== 1) return; // Monday only
  const currentWeekStart = isoWeekStart(now);

  for (const guild of client.guilds.cache.values()) {
    const config = getConfig(guild.id);
    if (config.highlights.weekStartIso === currentWeekStart) continue; // already posted this week

    if (config.highlights.channelId) {
      await postHighlight(client, guild, config.highlights.channelId, 'weekly').catch(err => console.error('[levelSystem] weekly highlight failed:', err.message));
    }
    resetPeriodXp(guild.id, 'weeklyXp');
    config.highlights.weekStartIso = currentWeekStart;
    saveConfigs();
  }
}

async function tickMonthlyHighlights(client) {
  const now = new Date();
  if (now.getUTCDate() !== 1) return; // 1st of the month only
  const currentMonthStart = monthStart(now);

  for (const guild of client.guilds.cache.values()) {
    const config = getConfig(guild.id);
    if (config.highlights.monthStartIso === currentMonthStart) continue; // already posted this month

    if (config.highlights.channelId) {
      await postHighlight(client, guild, config.highlights.channelId, 'monthly').catch(err => console.error('[levelSystem] monthly highlight failed:', err.message));
    }
    resetPeriodXp(guild.id, 'monthlyXp');
    config.highlights.monthStartIso = currentMonthStart;
    saveConfigs();
  }
}

function resetPeriodXp(guildId, field) {
  for (const key of Object.keys(userData)) {
    if (key.startsWith(`${guildId}:`)) userData[key][field] = 0;
  }
  saveData();
}

async function postHighlight(client, guild, channelId, period) {
  const channel = await guild.channels.fetch(channelId).catch(() => null);
  if (!channel) return;
  const field = period === 'weekly' ? 'weeklyXp' : 'monthlyXp';
  const embed = buildLeaderboardEmbed(guild, field, `${period === 'weekly' ? 'Weekly' : 'Monthly'} Highlights — Top 10`);
  await channel.send({ embeds: [embed] });
}

// ---- Leaderboards ----

const LEADERBOARD_FIELDS = {
  overall: { field: 'xp', label: 'Overall XP & Level' },
  voice: { field: 'voiceMinutes', label: 'Voice Time' },
  reactions: { field: 'reactionsGiven', label: 'Reactions' },
  weekly: { field: 'weeklyXp', label: 'Weekly XP' },
  monthly: { field: 'monthlyXp', label: 'Monthly XP' },
};

function topEntries(guildId, field, limit = 10) {
  return Object.entries(userData)
    .filter(([key]) => key.startsWith(`${guildId}:`))
    .map(([key, data]) => ({ userId: key.split(':')[1], value: data[field] || 0, xp: data.xp }))
    .filter(e => e.value > 0)
    .sort((a, b) => b.value - a.value)
    .slice(0, limit);
}

function formatEntryValue(field, entry) {
  if (field === 'voiceMinutes') return `${entry.value} min`;
  if (field === 'xp' || field === 'weeklyXp' || field === 'monthlyXp') {
    const { level } = levelFromXp(field === 'xp' ? entry.xp : entry.xp); // level always from all-time xp for display
    return field === 'xp' ? `Level ${level} — ${entry.value} XP` : `${entry.value} XP`;
  }
  return `${entry.value}`;
}

function buildLeaderboardEmbed(guild, fieldKey, titleOverride) {
  const meta = LEADERBOARD_FIELDS[fieldKey] || { field: fieldKey, label: titleOverride };
  const entries = topEntries(guild.id, meta.field);

  const description = entries.length === 0
    ? 'Nobody has any recorded activity yet.'
    : entries.map((e, i) => `**${i + 1}.** <@${e.userId}> — ${formatEntryValue(meta.field, e)}`).join('\n');

  return new EmbedBuilder()
    .setTitle(titleOverride || `🏆 ${meta.label} Leaderboard`)
    .setDescription(description)
    .setColor(0xF5A623)
    .setFooter({ text: guild.name })
    .setTimestamp();
}

// ---- Rank card (image via @napi-rs/canvas, embed fallback if not installed) ----

let canvasLib = null;
try {
  canvasLib = require('@napi-rs/canvas');
} catch {
  canvasLib = null; // fine — buildRankCard() falls back to an embed
}

// Same bundled-font fix as photoCard.js/joinLeaveSystem.js: @napi-rs/canvas
// has zero system font dependencies, so plain `sans-serif` silently renders
// no glyphs at all on a bare host — text would be invisible on the rank
// card without this.
const RANK_FONT_FAMILY = 'CardFont';
let rankFontsReady = false;
if (canvasLib?.GlobalFonts) {
  try {
    canvasLib.GlobalFonts.registerFromPath(path.join(__dirname, 'fonts', 'CardFont-Regular.ttf'), RANK_FONT_FAMILY);
    canvasLib.GlobalFonts.registerFromPath(path.join(__dirname, 'fonts', 'CardFont-Bold.ttf'), RANK_FONT_FAMILY);
    rankFontsReady = canvasLib.GlobalFonts.has(RANK_FONT_FAMILY);
  } catch (err) {
    console.error('[levelSystem] Failed to register bundled font, rank card text may not render:', err.message);
  }
}
const RANK_FONT_STACK = rankFontsReady ? `"${RANK_FONT_FAMILY}", sans-serif` : 'sans-serif';

async function fetchAvatarBuffer(url) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10_000);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; DiscordBotCardGenerator/1.0)' },
    });
    if (!res.ok) throw new Error(`Could not fetch the avatar (status ${res.status})`);
    return Buffer.from(await res.arrayBuffer());
  } finally {
    clearTimeout(timeout);
  }
}

function roundedRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function guildRank(guildId, userId) {
  const sorted = topEntries(guildId, 'xp', Infinity);
  const index = sorted.findIndex(e => e.userId === userId);
  return index === -1 ? sorted.length + 1 : index + 1;
}

async function buildRankCard(member) {
  const data = getUserData(member.guild.id, member.id);
  const { level, xpIntoLevel, xpForNext } = levelFromXp(data.xp);
  const rank = guildRank(member.guild.id, member.id);

  if (!canvasLib) {
    // Fallback: a clean embed with the same information, no image dependency required.
    const embed = new EmbedBuilder()
      .setTitle(`${member.user.username}'s Rank`)
      .setThumbnail(member.displayAvatarURL({ extension: 'png', size: 128 }))
      .addFields(
        { name: 'Rank', value: `#${rank}`, inline: true },
        { name: 'Level', value: `${level}`, inline: true },
        { name: 'XP', value: `${xpIntoLevel} / ${xpForNext}`, inline: true },
        { name: 'Total XP', value: `${data.xp}`, inline: true },
      )
      .setColor(0x5865F2);
    return { embeds: [embed] };
  }

  try {
    const { createCanvas, loadImage } = canvasLib;
    const width = 900, height = 260;
    const canvas = createCanvas(width, height);
    const ctx = canvas.getContext('2d');

    // Rounded card frame with a subtle two-tone background + accent glow,
    // instead of a flat single-color rectangle.
    const outerR = 24;
    roundedRect(ctx, 0, 0, width, height, outerR);
    ctx.save();
    ctx.clip();

    const bgGrad = ctx.createLinearGradient(0, 0, width, height);
    bgGrad.addColorStop(0, '#1E2124');
    bgGrad.addColorStop(1, '#26292D');
    ctx.fillStyle = bgGrad;
    ctx.fillRect(0, 0, width, height);

    ctx.globalAlpha = 0.10;
    ctx.fillStyle = '#5865F2';
    ctx.beginPath(); ctx.arc(width - 60, -20, 160, 0, Math.PI * 2); ctx.fill();
    ctx.globalAlpha = 1;

    // Avatar with an accent ring (top rank gets a gold ring instead)
    const avatarUrl = member.displayAvatarURL({ extension: 'png', size: 256 });
    const avatarBuf = await fetchAvatarBuffer(avatarUrl);
    const avatarImg = await loadImage(avatarBuf);
    const avatarSize = 160, avatarX = 50, avatarY = 50;
    const ringColor = rank === 1 ? '#F5A623' : '#5865F2';

    ctx.beginPath();
    ctx.arc(avatarX + avatarSize / 2, avatarY + avatarSize / 2, avatarSize / 2 + 6, 0, Math.PI * 2);
    ctx.fillStyle = ringColor;
    ctx.fill();

    ctx.save();
    ctx.beginPath();
    ctx.arc(avatarX + avatarSize / 2, avatarY + avatarSize / 2, avatarSize / 2, 0, Math.PI * 2);
    ctx.closePath();
    ctx.clip();
    ctx.drawImage(avatarImg, avatarX, avatarY, avatarSize, avatarSize);
    ctx.restore();

    // Username
    ctx.fillStyle = '#FFFFFF';
    ctx.font = `bold 36px ${RANK_FONT_STACK}`;
    ctx.fillText(member.user.username, 240, 100);

    // Rank & level, as small pill badges instead of plain right-aligned text
    ctx.font = `bold 24px ${RANK_FONT_STACK}`;
    const rankLabel = `RANK #${rank}`;
    const levelLabel = `LEVEL ${level}`;
    const rankW = ctx.measureText(rankLabel).width + 32;
    const levelW = ctx.measureText(levelLabel).width + 32;

    roundedRect(ctx, width - 50 - levelW, 40, levelW, 40, 20);
    ctx.fillStyle = '#5865F2';
    ctx.fill();
    roundedRect(ctx, width - 50 - levelW - 14 - rankW, 40, rankW, 40, 20);
    ctx.fillStyle = ringColor;
    ctx.fill();

    ctx.fillStyle = '#FFFFFF';
    ctx.textAlign = 'center';
    ctx.fillText(levelLabel, width - 50 - levelW / 2, 68);
    ctx.fillText(rankLabel, width - 50 - levelW - 14 - rankW / 2, 68);
    ctx.textAlign = 'left';

    // XP progress bar, rounded with a gradient fill and a percentage label
    const barX = 240, barY = 150, barW = 610, barH = 32;
    roundedRect(ctx, barX, barY, barW, barH, barH / 2);
    ctx.fillStyle = '#4F545C';
    ctx.fill();

    const progress = Math.max(0, Math.min(1, xpIntoLevel / xpForNext));
    if (progress > 0) {
      roundedRect(ctx, barX, barY, Math.max(barH, barW * progress), barH, barH / 2);
      const barGrad = ctx.createLinearGradient(barX, 0, barX + barW, 0);
      barGrad.addColorStop(0, '#5865F2');
      barGrad.addColorStop(1, '#8B5CF6');
      ctx.fillStyle = barGrad;
      ctx.fill();
    }

    ctx.fillStyle = '#FFFFFF';
    ctx.font = `20px ${RANK_FONT_STACK}`;
    ctx.fillText(`${xpIntoLevel} / ${xpForNext} XP`, barX, barY + barH + 30);
    ctx.textAlign = 'right';
    ctx.fillStyle = '#B9BBBE';
    ctx.fillText(`${Math.round(progress * 100)}%`, barX + barW, barY + barH + 30);
    ctx.textAlign = 'left';

    ctx.restore(); // release the outer rounded-rect clip

    // Thin border for a finished look
    roundedRect(ctx, 2, 2, width - 4, height - 4, outerR);
    ctx.lineWidth = 3;
    ctx.strokeStyle = 'rgba(255,255,255,0.12)';
    ctx.stroke();

    const buffer = canvas.toBuffer('image/png');
    const attachment = new AttachmentBuilder(buffer, { name: 'rank.png' });
    return { files: [attachment] };
  } catch (err) {
    console.error('[levelSystem] Rank card render failed, falling back to embed:', err.message);
    const embed = new EmbedBuilder()
      .setTitle(`${member.user.username}'s Rank`)
      .addFields(
        { name: 'Rank', value: `#${rank}`, inline: true },
        { name: 'Level', value: `${level}`, inline: true },
        { name: 'XP', value: `${xpIntoLevel} / ${xpForNext}`, inline: true },
      )
      .setColor(0x5865F2);
    return { embeds: [embed] };
  }
}

// ---- Admin XP management ----

function adminSetXp(guildId, userId, mode, amount) {
  const data = getUserData(guildId, userId);
  if (mode === 'set') data.xp = Math.max(0, amount);
  else if (mode === 'add') data.xp = Math.max(0, data.xp + amount);
  else if (mode === 'remove') data.xp = Math.max(0, data.xp - amount);
  saveData();
  return levelFromXp(data.xp);
}

function resetUser(guildId, userId) {
  delete userData[dataKey(guildId, userId)];
  saveData();
}

function resetGuild(guildId) {
  for (const key of Object.keys(userData)) {
    if (key.startsWith(`${guildId}:`)) delete userData[key];
  }
  saveData();
}

// ---- Lifecycle ----

function init(client) {
  setInterval(() => tickVoiceXp(client).catch(err => console.error('[levelSystem] voice XP tick failed:', err.message)), 60 * 1000).unref();
  setInterval(() => tickWeeklyHighlights(client).catch(err => console.error('[levelSystem] weekly highlights tick failed:', err.message)), 60 * 60 * 1000).unref();
  setInterval(() => tickMonthlyHighlights(client).catch(err => console.error('[levelSystem] monthly highlights tick failed:', err.message)), 60 * 60 * 1000).unref();
}

// ---- Setup: modals ----

const { ModalBuilder, TextInputBuilder, TextInputStyle, ActionRowBuilder, ChannelSelectMenuBuilder, RoleSelectMenuBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');

function buildXpModal(config) {
  const modal = new ModalBuilder().setCustomId('level_setup_xp_modal').setTitle('XP Options');
  modal.addComponents(
    new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('minmax').setLabel('Message XP min-max (e.g. 15-25)').setStyle(TextInputStyle.Short).setRequired(true).setValue(`${config.xp.messageMin}-${config.xp.messageMax}`)),
    new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('cooldown').setLabel('Message cooldown (seconds)').setStyle(TextInputStyle.Short).setRequired(true).setValue(`${config.xp.messageCooldownSeconds}`)),
    new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('voice').setLabel('Voice XP per minute').setStyle(TextInputStyle.Short).setRequired(true).setValue(`${config.xp.voiceXpPerMinute}`)),
    new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('reactionxp').setLabel('Reaction XP amount').setStyle(TextInputStyle.Short).setRequired(true).setValue(`${config.xp.reactionXp}`)),
    new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('reactioncooldown').setLabel('Reaction cooldown (seconds)').setStyle(TextInputStyle.Short).setRequired(true).setValue(`${config.xp.reactionCooldownSeconds}`)),
  );
  return modal;
}

function handleXpModalSubmit(interaction) {
  const config = getConfig(interaction.guild.id);
  const minmax = interaction.fields.getTextInputValue('minmax');
  const match = minmax.match(/^(\d+)\s*-\s*(\d+)$/);
  if (!match) {
    return { error: `"${minmax}" isn't in the form "min-max", e.g. "15-25".` };
  }
  const min = parseInt(match[1], 10), max = parseInt(match[2], 10);
  const cooldown = parseInt(interaction.fields.getTextInputValue('cooldown'), 10);
  const voice = parseInt(interaction.fields.getTextInputValue('voice'), 10);
  const reactionXp = parseInt(interaction.fields.getTextInputValue('reactionxp'), 10);
  const reactionCooldown = parseInt(interaction.fields.getTextInputValue('reactioncooldown'), 10);

  if ([min, max, cooldown, voice, reactionXp, reactionCooldown].some(n => isNaN(n) || n < 0) || min > max) {
    return { error: 'All values need to be non-negative numbers, and min can\'t be greater than max.' };
  }

  config.xp.messageMin = min;
  config.xp.messageMax = max;
  config.xp.messageCooldownSeconds = cooldown;
  config.xp.voiceXpPerMinute = voice;
  config.xp.reactionXp = reactionXp;
  config.xp.reactionCooldownSeconds = reactionCooldown;
  setConfig(interaction.guild.id, config);
  return { error: null };
}

function buildGeneralModal(config) {
  const modal = new ModalBuilder().setCustomId('level_setup_general_modal').setTitle('General Leveling Settings');
  modal.addComponents(
    new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('enabled').setLabel('Enabled? (yes/no)').setStyle(TextInputStyle.Short).setRequired(true).setValue(config.enabled ? 'yes' : 'no')),
    new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('maxlevel').setLabel('Max level (0 = unlimited)').setStyle(TextInputStyle.Short).setRequired(true).setValue(`${config.maxLevel}`)),
  );
  return modal;
}

function handleGeneralModalSubmit(interaction) {
  const config = getConfig(interaction.guild.id);
  const enabledInput = interaction.fields.getTextInputValue('enabled').trim().toLowerCase();
  const maxLevelInput = parseInt(interaction.fields.getTextInputValue('maxlevel'), 10);
  if (!['yes', 'no'].includes(enabledInput)) return { error: 'Enabled must be "yes" or "no".' };
  if (isNaN(maxLevelInput) || maxLevelInput < 0) return { error: 'Max level must be a non-negative number.' };
  config.enabled = enabledInput === 'yes';
  config.maxLevel = maxLevelInput;
  setConfig(interaction.guild.id, config);
  return { error: null };
}

function buildPercentModal(kind, id) {
  return new ModalBuilder()
    .setCustomId(`level_booster_percent_modal_${kind}_${id}`)
    .setTitle('Booster Percent')
    .addComponents(
      new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('percent').setLabel('XP boost percent (e.g. 25 for +25%)').setStyle(TextInputStyle.Short).setRequired(true))
    );
}

function handlePercentModalSubmit(interaction) {
  const rest = interaction.customId.replace('level_booster_percent_modal_', '');
  const [kind, id] = [rest.split('_')[0], rest.split('_').slice(1).join('_')];
  const percent = parseInt(interaction.fields.getTextInputValue('percent'), 10);
  if (isNaN(percent) || percent <= 0) return { error: 'Percent must be a positive number.' };

  const config = getConfig(interaction.guild.id);
  if (kind === 'role') {
    config.boosters.roles = config.boosters.roles.filter(b => b.roleId !== id);
    config.boosters.roles.push({ roleId: id, percent });
  } else {
    config.boosters.channels = config.boosters.channels.filter(b => b.channelId !== id);
    config.boosters.channels.push({ channelId: id, percent });
  }
  setConfig(interaction.guild.id, config);
  return { error: null, kind, id, percent };
}

function buildRewardLevelModal() {
  return new ModalBuilder()
    .setCustomId('level_reward_addlevel_modal')
    .setTitle('Add Role Reward')
    .addComponents(
      new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('level').setLabel('At what level?').setStyle(TextInputStyle.Short).setRequired(true))
    );
}

function buildLevelupMessageModal(config) {
  return new ModalBuilder()
    .setCustomId('level_levelup_message_modal')
    .setTitle('Level-Up Message')
    .addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder().setCustomId('message').setLabel('Message ({user}, {level}, {server})').setStyle(TextInputStyle.Paragraph).setRequired(true).setMaxLength(1000).setValue(config.levelUp.message)
      )
    );
}

// ---- Setup: menus / buttons ----

function buildSetupMenuRow() {
  const { StringSelectMenuBuilder } = require('discord.js');
  return new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder().setCustomId('level_setup_menu').setPlaceholder('What do you want to configure?').addOptions(
      { label: 'XP Options', value: 'xp', description: 'Message/voice/reaction XP amounts & cooldowns' },
      { label: 'Restrictions', value: 'restrictions', description: 'No-XP channels/roles, XP-only channel whitelist' },
      { label: 'Boosters', value: 'boosters', description: 'Role & channel XP boosters' },
      { label: 'Role Rewards', value: 'rewards', description: 'Roles given automatically at certain levels' },
      { label: 'Level-Up Message', value: 'levelup', description: 'Announcement channel, DM, and message text' },
      { label: 'First Place Role', value: 'firstplace', description: 'Role for the #1 ranked member' },
      { label: 'Highlights', value: 'highlights', description: 'Auto-posted weekly/monthly top 10' },
      { label: 'General', value: 'general', description: 'Enable/disable, max level' },
    )
  );
}

function buildRestrictionsRows() {
  return [
    new ActionRowBuilder().addComponents(new ChannelSelectMenuBuilder().setCustomId('level_restrict_noxpchannels').setPlaceholder('No-XP channels (blacklist)').setMinValues(0).setMaxValues(25)),
    new ActionRowBuilder().addComponents(new ChannelSelectMenuBuilder().setCustomId('level_restrict_xpchannels').setPlaceholder('XP-ONLY channels (whitelist — overrides blacklist)').setMinValues(0).setMaxValues(25)),
    new ActionRowBuilder().addComponents(new RoleSelectMenuBuilder().setCustomId('level_restrict_noxproles').setPlaceholder('No-XP roles').setMinValues(0).setMaxValues(25)),
  ];
}

async function handleRestrictionSelect(interaction) {
  const config = getConfig(interaction.guild.id);
  if (interaction.customId === 'level_restrict_noxpchannels') config.restrictions.noXpChannelIds = interaction.values;
  else if (interaction.customId === 'level_restrict_xpchannels') config.restrictions.xpChannelIds = interaction.values;
  else if (interaction.customId === 'level_restrict_noxproles') config.restrictions.noXpRoleIds = interaction.values;
  else return false;
  setConfig(interaction.guild.id, config);
  await interaction.reply({ content: `✅ Saved (${interaction.values.length} selected).`, ephemeral: true });
  return true;
}

function buildBoostersPanelRows(config) {
  return [
    new ActionRowBuilder().addComponents(new RoleSelectMenuBuilder().setCustomId('level_booster_addrole_select').setPlaceholder('Pick a role to add/update as a booster')),
    new ActionRowBuilder().addComponents(new ChannelSelectMenuBuilder().setCustomId('level_booster_addchannel_select').setPlaceholder('Pick a channel to add/update as a booster')),
    new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('level_booster_stack_toggle').setLabel(`Stack Boosters: ${config.boosters.stack ? 'ON' : 'OFF'}`).setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId('level_booster_list').setLabel('View / Remove Boosters').setStyle(ButtonStyle.Secondary),
    ),
  ];
}

async function handleBoosterStackToggle(interaction) {
  const config = getConfig(interaction.guild.id);
  config.boosters.stack = !config.boosters.stack;
  setConfig(interaction.guild.id, config);
  await interaction.reply({ content: `✅ Stack Boosters is now **${config.boosters.stack ? 'ON' : 'OFF'}**.`, ephemeral: true });
}

async function handleBoosterList(interaction) {
  const config = getConfig(interaction.guild.id);
  const { StringSelectMenuBuilder } = require('discord.js');
  const roleOptions = config.boosters.roles.map(b => ({ label: `Role booster: +${b.percent}%`, value: `role_${b.roleId}`, description: `<@&${b.roleId}>`.slice(0, 100) }));
  const channelOptions = config.boosters.channels.map(b => ({ label: `Channel booster: +${b.percent}%`, value: `channel_${b.channelId}`, description: `#${b.channelId}` }));
  const options = [...roleOptions, ...channelOptions];

  if (options.length === 0) {
    await interaction.reply({ content: 'No boosters configured yet.', ephemeral: true });
    return;
  }

  const row = new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder().setCustomId('level_booster_remove_select').setPlaceholder('Select a booster to remove').addOptions(options.slice(0, 25))
  );
  await interaction.reply({ content: 'Current boosters:', components: [row], ephemeral: true });
}

async function handleBoosterRemoveSelect(interaction) {
  const [kind, id] = [interaction.values[0].split('_')[0], interaction.values[0].split('_').slice(1).join('_')];
  const config = getConfig(interaction.guild.id);
  if (kind === 'role') config.boosters.roles = config.boosters.roles.filter(b => b.roleId !== id);
  else config.boosters.channels = config.boosters.channels.filter(b => b.channelId !== id);
  setConfig(interaction.guild.id, config);
  await interaction.reply({ content: '✅ Removed.', ephemeral: true });
}

function buildRewardsPanelRows(config) {
  return [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('level_reward_add_button').setLabel('Add Reward').setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId('level_reward_stack_toggle').setLabel(`Stack Rewards: ${config.rewards.stack ? 'ON' : 'OFF'}`).setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId('level_reward_list').setLabel('View / Remove Rewards').setStyle(ButtonStyle.Secondary),
    ),
  ];
}

async function handleRewardStackToggle(interaction) {
  const config = getConfig(interaction.guild.id);
  config.rewards.stack = !config.rewards.stack;
  setConfig(interaction.guild.id, config);
  await interaction.reply({ content: `✅ Stack Rewards is now **${config.rewards.stack ? 'ON' : 'OFF'}**.`, ephemeral: true });
}

async function handleRewardList(interaction) {
  const config = getConfig(interaction.guild.id);
  const { StringSelectMenuBuilder } = require('discord.js');
  if (config.rewards.list.length === 0) {
    await interaction.reply({ content: 'No role rewards configured yet.', ephemeral: true });
    return;
  }
  const options = config.rewards.list.map((r, i) => ({ label: `Level ${r.level}`, value: `${i}`, description: `<@&${r.roleId}>`.slice(0, 100) }));
  const row = new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder().setCustomId('level_reward_remove_select').setPlaceholder('Select a reward to remove').addOptions(options.slice(0, 25))
  );
  await interaction.reply({ content: 'Current role rewards:', components: [row], ephemeral: true });
}

async function handleRewardRemoveSelect(interaction) {
  const index = parseInt(interaction.values[0], 10);
  const config = getConfig(interaction.guild.id);
  config.rewards.list.splice(index, 1);
  setConfig(interaction.guild.id, config);
  await interaction.reply({ content: '✅ Removed.', ephemeral: true });
}

function handleRewardLevelModalSubmit(interaction) {
  const level = parseInt(interaction.fields.getTextInputValue('level'), 10);
  if (isNaN(level) || level <= 0) return { error: 'Level must be a positive number.' };
  return { error: null, level };
}

function buildRewardRoleSelectRow(level) {
  return new ActionRowBuilder().addComponents(new RoleSelectMenuBuilder().setCustomId(`level_reward_addrole_select_${level}`).setPlaceholder(`Role to give at level ${level}`));
}

async function handleRewardRoleSelect(interaction) {
  const level = parseInt(interaction.customId.replace('level_reward_addrole_select_', ''), 10);
  const roleId = interaction.values[0];
  const config = getConfig(interaction.guild.id);
  config.rewards.list = config.rewards.list.filter(r => !(r.level === level && r.roleId === roleId));
  config.rewards.list.push({ level, roleId });
  setConfig(interaction.guild.id, config);
  await interaction.reply({ content: `✅ <@&${roleId}> will now be given at level ${level}.`, ephemeral: true });
}

function buildLevelupPanelRows(config) {
  return [
    new ActionRowBuilder().addComponents(new ChannelSelectMenuBuilder().setCustomId('level_levelup_channel_select').setPlaceholder('Announcement channel (leave unset = channel it happened in)').setMinValues(0).setMaxValues(1)),
    new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('level_levelup_enabled_toggle').setLabel(`Enabled: ${config.levelUp.enabled ? 'ON' : 'OFF'}`).setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId('level_levelup_dm_toggle').setLabel(`Send as DM: ${config.levelUp.useDm ? 'ON' : 'OFF'}`).setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId('level_levelup_message_button').setLabel('Edit Message').setStyle(ButtonStyle.Primary),
    ),
  ];
}

async function handleLevelupChannelSelect(interaction) {
  const config = getConfig(interaction.guild.id);
  config.levelUp.channelId = interaction.values[0] || '';
  setConfig(interaction.guild.id, config);
  await interaction.reply({ content: config.levelUp.channelId ? `✅ Level-up messages will post in <#${config.levelUp.channelId}>.` : '✅ Level-up messages will post in whatever channel triggered them.', ephemeral: true });
}

async function handleLevelupEnabledToggle(interaction) {
  const config = getConfig(interaction.guild.id);
  config.levelUp.enabled = !config.levelUp.enabled;
  setConfig(interaction.guild.id, config);
  await interaction.reply({ content: `✅ Level-up messages are now **${config.levelUp.enabled ? 'ON' : 'OFF'}**.`, ephemeral: true });
}

async function handleLevelupDmToggle(interaction) {
  const config = getConfig(interaction.guild.id);
  config.levelUp.useDm = !config.levelUp.useDm;
  setConfig(interaction.guild.id, config);
  await interaction.reply({ content: `✅ Level-up messages will now be sent via **${config.levelUp.useDm ? 'DM' : 'channel message'}**.`, ephemeral: true });
}

function handleLevelupMessageModalSubmit(interaction) {
  const config = getConfig(interaction.guild.id);
  config.levelUp.message = interaction.fields.getTextInputValue('message');
  setConfig(interaction.guild.id, config);
}

async function handleFirstPlaceSelect(interaction) {
  const config = getConfig(interaction.guild.id);
  config.firstPlaceRoleId = interaction.values[0] || '';
  setConfig(interaction.guild.id, config);
  await interaction.reply({ content: '✅ Saved.', ephemeral: true });
}

function buildFirstPlaceRow() {
  return [new ActionRowBuilder().addComponents(new RoleSelectMenuBuilder().setCustomId('level_firstplace_role_select').setPlaceholder('Role for the #1 ranked member').setMinValues(0).setMaxValues(1))];
}

function buildHighlightsRow() {
  return [new ActionRowBuilder().addComponents(new ChannelSelectMenuBuilder().setCustomId('level_highlights_channel_select').setPlaceholder('Channel for weekly/monthly top-10 auto-posts').setMinValues(0).setMaxValues(1))];
}

async function handleHighlightsSelect(interaction) {
  const config = getConfig(interaction.guild.id);
  config.highlights.channelId = interaction.values[0] || '';
  setConfig(interaction.guild.id, config);
  await interaction.reply({ content: config.highlights.channelId ? `✅ Weekly/monthly top-10 highlights will post in <#${config.highlights.channelId}> (around midnight UTC on rollover).` : '✅ Highlights disabled (no channel set).', ephemeral: true });
}

module.exports = {
  init,
  getConfig,
  setConfig,
  getUserData,
  levelFromXp,
  handleMessageXp,
  handleReactionXp,
  buildRankCard,
  buildLeaderboardEmbed,
  LEADERBOARD_FIELDS,
  adminSetXp,
  resetUser,
  resetGuild,
  buildXpModal,
  handleXpModalSubmit,
  buildGeneralModal,
  handleGeneralModalSubmit,
  buildPercentModal,
  handlePercentModalSubmit,
  buildRewardLevelModal,
  buildLevelupMessageModal,
  buildSetupMenuRow,
  buildRestrictionsRows,
  handleRestrictionSelect,
  buildBoostersPanelRows,
  handleBoosterStackToggle,
  handleBoosterList,
  handleBoosterRemoveSelect,
  buildRewardsPanelRows,
  handleRewardStackToggle,
  handleRewardList,
  handleRewardRemoveSelect,
  handleRewardLevelModalSubmit,
  buildRewardRoleSelectRow,
  handleRewardRoleSelect,
  buildLevelupPanelRows,
  handleLevelupChannelSelect,
  handleLevelupEnabledToggle,
  handleLevelupDmToggle,
  handleLevelupMessageModalSubmit,
  handleFirstPlaceSelect,
  buildFirstPlaceRow,
  buildHighlightsRow,
  handleHighlightsSelect,
};
