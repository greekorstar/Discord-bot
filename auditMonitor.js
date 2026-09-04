// auditMonitor.js — Watches the server's Audit Log for members who hold the
// /request access role making changes WITHOUT going through /request.
//
// Key mechanic: when the bot performs an action via /request, Discord's audit
// log records the BOT as the executor, not the human who ran the command. So
// any monitored audit log entry attributed to a real person is, by definition,
// something done outside /request — no fuzzy matching needed.
//
// Honest limits: Discord's audit log doesn't record every possible server
// activity (e.g. reading messages, most voice behavior) — that's a gap in what
// Discord logs, not something this code can work around. What IS covered below
// lines up with everything /request's action commands already do.

const { AuditLogEvent, PermissionsBitField } = require('discord.js');
const settingsStore = require('./settingsStore.js');
const punishmentSystem = require('./punishmentSystem.js');

const MONITORED_ACTIONS = new Set([
  AuditLogEvent.MemberKick,
  AuditLogEvent.MemberBanAdd,
  AuditLogEvent.MemberUpdate, // covers timeouts (mute/unmute) — filtered further below
  AuditLogEvent.ChannelCreate,
  AuditLogEvent.ChannelDelete,
  AuditLogEvent.ChannelUpdate,
  AuditLogEvent.ChannelOverwriteCreate,
  AuditLogEvent.ChannelOverwriteUpdate,
  AuditLogEvent.ChannelOverwriteDelete,
  AuditLogEvent.RoleCreate,
  AuditLogEvent.RoleDelete,
]);

async function postLog(guild, text) {
  const logChannelId = settingsStore.get('warnLogChannelId', '');
  if (!logChannelId) return;
  const channel = await guild.channels.fetch(logChannelId).catch(() => null);
  if (channel) channel.send(text).catch(() => {});
}

async function handleAuditLogEntry(entry, guild, client) {
  try {
    if (!MONITORED_ACTIONS.has(entry.action)) return;
    if (!entry.executorId || entry.executorId === client.user.id) return; // the bot's own /request actions are fine

    const accessRoleId = settingsStore.get('requestAccessRoleId', '');
    if (!accessRoleId) return; // nothing configured to monitor against yet

    const member = await guild.members.fetch(entry.executorId).catch(() => null);
    if (!member || !member.roles.cache.has(accessRoleId)) return; // not someone this system is monitoring

    // A real person with access-role privileges made this change directly — not through /request.
    const autoReason = `Out-of-band change detected: "${entry.action}" performed outside /request`;
    const { count, summary } = await punishmentSystem.processWarning(entry.executorId, autoReason, guild);
    const revertMsg = await tryRevertAuditEntry(entry, guild);

    try {
      await member.send(`You made a server change directly (outside of /request), which isn't allowed while you hold /request access. This counts as warning #${count}. ${summary}`);
    } catch (err) {
      // DMs closed — proceed anyway
    }

    await postLog(
      guild,
      `⚠️ **Out-of-band change detected**: ${member.user.tag} performed a "${entry.action}" action outside of /request (warning #${count}). ${summary}\n${revertMsg}`
    );
  } catch (err) {
    console.error('[auditMonitor] Error handling audit log entry:', err.message);
  }
}

async function tryRevertAuditEntry(entry, guild) {
  try {
    if (entry.action === AuditLogEvent.MemberBanAdd) {
      await guild.members.unban(entry.targetId, 'Auto-reverted: unauthorized ban detected outside /request');
      return 'Reverted: unbanned the target.';
    }

    if (entry.action === AuditLogEvent.MemberUpdate) {
      const disabledChange = (entry.changes || []).find(c => c.key === 'communication_disabled_until');
      if (disabledChange && disabledChange.new) {
        const target = await guild.members.fetch(entry.targetId).catch(() => null);
        if (target) {
          await target.timeout(null, 'Auto-reverted: unauthorized mute detected outside /request');
          return 'Reverted: removed the timeout.';
        }
      }
      return 'No revertible change found in this member update.';
    }

    if (entry.action === AuditLogEvent.ChannelCreate) {
      const channel = await guild.channels.fetch(entry.targetId).catch(() => null);
      if (channel) {
        await channel.delete('Auto-reverted: unauthorized channel creation detected outside /request');
        return 'Reverted: deleted the channel they created.';
      }
      return 'Channel no longer exists.';
    }

    if (entry.action === AuditLogEvent.RoleCreate) {
      const role = await guild.roles.fetch(entry.targetId).catch(() => null);
      if (role) {
        await role.delete('Auto-reverted: unauthorized role creation detected outside /request');
        return 'Reverted: deleted the role they created.';
      }
      return 'Role no longer exists.';
    }

    if (entry.action === AuditLogEvent.ChannelOverwriteCreate || entry.action === AuditLogEvent.ChannelOverwriteUpdate) {
      const channel = await guild.channels.fetch(entry.targetId).catch(() => null);
      const overwriteTargetId = entry.extra && entry.extra.id ? entry.extra.id : null;
      if (!channel || !overwriteTargetId) return 'Could not identify the channel/overwrite to revert.';

      const allowChange = (entry.changes || []).find(c => c.key === 'allow');
      const denyChange = (entry.changes || []).find(c => c.key === 'deny');
      const oldAllow = allowChange ? BigInt(allowChange.old || 0) : 0n;
      const oldDeny = denyChange ? BigInt(denyChange.old || 0) : 0n;

      // Best-effort restore: recreate the overwrite exactly matching the old allow/deny bitfields.
      const allowNames = new PermissionsBitField(oldAllow).toArray();
      const denyNames = new PermissionsBitField(oldDeny).toArray();
      const restoreObj = {};
      for (const name of allowNames) restoreObj[name] = true;
      for (const name of denyNames) restoreObj[name] = false;

      await channel.permissionOverwrites.create(overwriteTargetId, restoreObj, { reason: 'Auto-reverted: unauthorized permission change detected outside /request' });
      return 'Attempted a best-effort restore of the previous permission overwrite — please double-check it manually, as this reconstruction isn\'t 100% guaranteed to be exact.';
    }

    return `This action type ("${entry.action}") can't be safely auto-reverted (e.g. a kick or deletion can't be restored via the API). Manual review recommended.`;
  } catch (err) {
    return `Tried to revert but hit an error: ${err.message}`;
  }
}

module.exports = { handleAuditLogEntry };
