// punishmentSystem.js — The escalation ladder that runs once someone accumulates
// /request warnings (from either /request member warn OR auditMonitor.js's
// automatic bypass-detection warnings — both call processWarning below).
//
// Ladder:
//   Warning #1 — apply the configured "warned" role (if set). No punishment-
//                channel decision needed yet.
//   Warning #2 — member is immediately put in a 28-day timeout as a holding
//                measure, and a decision message goes to the punishment
//                channel showing both warning reasons. The founder picks
//                Mute / Kick / Ban via buttons. Picking Mute just confirms
//                the 28-day hold; Kick/Ban override it.
//   Warning #3 — (a repeat offense) the member is banned immediately,
//                automatically, no vote needed. The punishment channel gets
//                an Undo Ban / Keep Ban choice for the founder.
//   Warning #4+ — permanent ban, applied immediately, announced in the
//                 punishment channel with no undo option.
//
// Honest limit: if no punishment channel is configured, warnings #2+ still
// apply their default action (mute/ban) so nothing silently fails to happen —
// they just won't have an interactive decision to make, since there's nowhere
// to post it.

const fs = require('fs');
const path = require('path');
const { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder } = require('discord.js');
const settingsStore = require('./settingsStore.js');
const requestWarnings = require('./requestWarnings.js');
const requestLog = require('./requestLog.js');

const DATA_FILE = path.join(__dirname, 'punishments.json');
const TWENTY_EIGHT_DAYS_MS = 28 * 24 * 60 * 60 * 1000;

function loadData() {
  if (!fs.existsSync(DATA_FILE)) return {};
  try {
    const raw = fs.readFileSync(DATA_FILE, 'utf8');
    return raw.trim() ? JSON.parse(raw) : {};
  } catch (err) {
    console.error('[punishmentSystem] Failed to read punishments.json, starting fresh:', err.message);
    return {};
  }
}

function saveData(data) {
  try {
    fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2), 'utf8');
  } catch (err) {
    console.error('[punishmentSystem] Failed to save punishments.json:', err.message);
  }
}

function recordReason(userId, reason) {
  const data = loadData();
  if (!data[userId]) data[userId] = { reasons: [], status: 'none' };
  data[userId].reasons.push(reason || 'No reason given');
  saveData(data);
  return data[userId].reasons;
}

function setStatus(userId, status) {
  const data = loadData();
  if (!data[userId]) data[userId] = { reasons: [], status: 'none' };
  data[userId].status = status;
  saveData(data);
}

function getRecord(userId) {
  const data = loadData();
  return data[userId] || { reasons: [], status: 'none' };
}

async function getPunishmentChannel(guild) {
  const channelId = settingsStore.get('punishmentChannelId', null);
  if (!channelId) return null;
  return guild.channels.fetch(channelId).catch(() => null);
}

function decisionRow(userId) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`punishdecide|mute|${userId}`).setLabel('Mute (28d)').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId(`punishdecide|kick|${userId}`).setLabel('Kick').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId(`punishdecide|ban|${userId}`).setLabel('Ban').setStyle(ButtonStyle.Danger),
  );
}

function undoKeepRow(userId) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`punishundo|${userId}`).setLabel('Undo Ban').setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId(`punishkeep|${userId}`).setLabel('Keep Ban').setStyle(ButtonStyle.Danger),
  );
}

/**
 * Call this any time someone accrues a new warning — from /request member warn
 * OR auditMonitor.js's automatic detection. Handles the whole ladder.
 *
 * @param {string} userId
 * @param {string} reason
 * @param {import('discord.js').Guild} guild
 * @returns {Promise<{count: number, summary: string}>}
 */
async function processWarning(userId, reason, guild) {
  const count = requestWarnings.addWarning(userId);
  recordReason(userId, reason);
  const member = await guild.members.fetch(userId).catch(() => null);
  const record = getRecord(userId);
  const punishmentChannel = await getPunishmentChannel(guild);

  if (count === 1) {
    const warnedRoleId = settingsStore.get('requestWarnedRoleId', null);
    if (member && warnedRoleId) {
      await member.roles.add(warnedRoleId, `1st warning: ${reason}`).catch(() => {});
    }
    return { count, summary: 'This is warning #1.' };
  }

  if (count === 2) {
    if (member) {
      await member.timeout(TWENTY_EIGHT_DAYS_MS, `2nd warning — held for founder decision: ${reason}`).catch(() => {});
    }
    setStatus(userId, 'awaiting_decision');

    if (punishmentChannel) {
      const embed = new EmbedBuilder()
        .setTitle('⚠️ Member warned twice — decision needed')
        .setColor(0xF1C40F)
        .setDescription(
          `<@${userId}> has been warned twice and is currently muted for 28 days as a holding measure.\n\n` +
          `**Reason 1:** ${record.reasons[0] || 'N/A'}\n**Reason 2:** ${record.reasons[1] || reason}\n\n` +
          `What should the final punishment be?`
        );
      await punishmentChannel.send({ embeds: [embed], components: [decisionRow(userId)] }).catch(() => {});
      return { count, summary: 'Warning #2 — member muted for 28 days, awaiting founder decision in the punishment channel.' };
    }
    return { count, summary: 'Warning #2 — member muted for 28 days. (No punishment channel configured, so no decision prompt was sent.)' };
  }

  if (count === 3) {
    if (member) {
      await guild.members.ban(userId, { reason: `3rd warning — automatic ban: ${reason}` }).catch(() => {});
    } else {
      await guild.members.ban(userId, { reason: `3rd warning — automatic ban: ${reason}` }).catch(() => {});
    }
    setStatus(userId, 'auto_banned_undoable');

    if (punishmentChannel) {
      const embed = new EmbedBuilder()
        .setTitle('🚨 Member warned a 3rd time — automatically banned')
        .setColor(0xE74C3C)
        .setDescription(`<@${userId}> re-offended and has been automatically banned.\n\n**Latest reason:** ${reason}`);
      await punishmentChannel.send({ embeds: [embed], components: [undoKeepRow(userId)] }).catch(() => {});
      return { count, summary: 'Warning #3 — member automatically banned. Founder can undo in the punishment channel.' };
    }
    return { count, summary: 'Warning #3 — member automatically banned. (No punishment channel configured.)' };
  }

  // count >= 4
  await guild.members.ban(userId, { reason: `${count}th warning — permanent ban: ${reason}` }).catch(() => {});
  setStatus(userId, 'permanent_ban');

  if (punishmentChannel) {
    const embed = new EmbedBuilder()
      .setTitle('⛔ Permanent ban')
      .setColor(0x992D22)
      .setDescription(`<@${userId}> has been warned ${count} times and has been **permanently banned**.`);
    await punishmentChannel.send({ embeds: [embed] }).catch(() => {});
  }
  return { count, summary: `Warning #${count} — member permanently banned.` };
}

/**
 * Handles clicks on the decision / undo / keep buttons. Only the server
 * owner ("the founder") may use them.
 */
async function handleButtonInteraction(interaction) {
  if (interaction.guild.ownerId !== interaction.user.id) {
    await interaction.reply({ content: 'Only the founder can make this decision.', ephemeral: true });
    return;
  }

  const [kind, a, b] = interaction.customId.split('|');
  const guild = interaction.guild;

  try {
    if (kind === 'punishdecide') {
      const decision = a; // mute | kick | ban
      const userId = b;
      const member = await guild.members.fetch(userId).catch(() => null);

      if (decision === 'mute') {
        // The 28-day hold is already in place from warning #2 — just confirm it.
        setStatus(userId, 'decided_mute');
        await requestLog.logAction({ executorId: interaction.user.id, executorTag: interaction.user.tag, action: 'punishment-decide', targetId: userId, targetLabel: 'mute (28d, confirmed)', reason: 'Founder decision' }, guild, 'warnLogChannelId');
      } else if (decision === 'kick') {
        if (member) await member.kick('Founder decision after 2nd warning').catch(() => {});
        setStatus(userId, 'decided_kick');
        await requestLog.logAction({ executorId: interaction.user.id, executorTag: interaction.user.tag, action: 'punishment-decide', targetId: userId, targetLabel: 'kick', reason: 'Founder decision' }, guild, 'warnLogChannelId');
      } else if (decision === 'ban') {
        await guild.members.ban(userId, { reason: 'Founder decision after 2nd warning' }).catch(() => {});
        setStatus(userId, 'decided_ban');
        await requestLog.logAction({ executorId: interaction.user.id, executorTag: interaction.user.tag, action: 'punishment-decide', targetId: userId, targetLabel: 'ban', reason: 'Founder decision' }, guild, 'warnLogChannelId');
      }

      await interaction.update({
        content: `✅ Decision recorded: **${decision}** for <@${userId}>, chosen by ${interaction.user.tag}.`,
        embeds: interaction.message.embeds,
        components: [],
      });
    }

    else if (kind === 'punishundo') {
      const userId = a;
      await guild.members.unban(userId, 'Founder undid the automatic 3rd-warning ban').catch(() => {});
      setStatus(userId, 'undone');
      await requestLog.logAction({ executorId: interaction.user.id, executorTag: interaction.user.tag, action: 'punishment-undo', targetId: userId, targetLabel: 'ban undone', reason: 'Founder decision' }, guild, 'warnLogChannelId');
      await interaction.update({
        content: `✅ Ban undone for <@${userId}> by ${interaction.user.tag}.`,
        embeds: interaction.message.embeds,
        components: [],
      });
    }

    else if (kind === 'punishkeep') {
      const userId = a;
      setStatus(userId, 'kept_banned');
      await requestLog.logAction({ executorId: interaction.user.id, executorTag: interaction.user.tag, action: 'punishment-keep', targetId: userId, targetLabel: 'ban kept', reason: 'Founder decision' }, guild, 'warnLogChannelId');
      await interaction.update({
        content: `🔒 Ban kept in place for <@${userId}>, confirmed by ${interaction.user.tag}.`,
        embeds: interaction.message.embeds,
        components: [],
      });
    }
  } catch (err) {
    console.error('[punishmentSystem] Error handling decision button:', err.message);
    if (!interaction.replied && !interaction.deferred) {
      await interaction.reply({ content: `Something went wrong applying that decision: ${err.message}`, ephemeral: true });
    }
  }
}

module.exports = { processWarning, handleButtonInteraction, getRecord };
