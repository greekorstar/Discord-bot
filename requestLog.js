// requestLog.js — Logs every /request action (who did what, to whom, and why)
// to the configured log channel, and supports reverting a member's most
// recently logged action (used by /request member warn ... revert:true).
//
// Per the README's "honest limit": not everything can be safely reverted,
// because Discord's API can't restore something that's been deleted with no
// data left to rebuild it from. Revertible action types: 'ban', 'mute',
// 'channel-create', 'role-create', 'channel-perm' (via a stored snapshot).
// Everything else (kick, unban, unmute, channel-delete, channel-edit,
// role-delete, automod-toggle, warn) reports plainly that it can't be undone.

const fs = require('fs');
const path = require('path');
const { PermissionsBitField } = require('discord.js');
const settingsStore = require('./settingsStore.js');

const DATA_FILE = path.join(__dirname, 'requestLog.json');

function loadData() {
  if (!fs.existsSync(DATA_FILE)) return {};
  try {
    const raw = fs.readFileSync(DATA_FILE, 'utf8');
    return raw.trim() ? JSON.parse(raw) : {};
  } catch (err) {
    console.error('[requestLog] Failed to read requestLog.json, starting fresh:', err.message);
    return {};
  }
}

function saveData(data) {
  try {
    fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2), 'utf8');
  } catch (err) {
    console.error('[requestLog] Failed to save requestLog.json:', err.message);
  }
}

/**
 * Post a line to the configured /request log channel, if one is set.
 */
async function postToLogChannel(guild, text, channelKey = 'requestLogChannelId') {
  const logChannelId = settingsStore.get(channelKey, null);
  if (!logChannelId) return;
  const channel = await guild.channels.fetch(logChannelId).catch(() => null);
  if (channel) channel.send(text).catch(() => {});
}

/**
 * Record an action taken via /request. Keeps only the most recent action per
 * executor (that's all revert:true needs), plus stores it for the log post.
 *
 * @param {object} entry
 * @param {string} entry.executorId - who ran the /request command
 * @param {string} entry.executorTag
 * @param {string} entry.action - 'kick' | 'ban' | 'unban' | 'mute' | 'unmute' |
 *   'channel-create' | 'channel-delete' | 'channel-edit' | 'channel-perm' |
 *   'role-create' | 'role-delete' | 'automod-toggle' | 'warn'
 * @param {string} [entry.targetId] - id of whoever/whatever was acted on
 * @param {string} [entry.targetLabel] - human-readable label for the log line
 * @param {string} entry.reason
 * @param {object} [entry.snapshot] - previous-state data needed to revert (e.g. channel-perm)
 */
async function logAction(entry, guild, channelKey = 'requestLogChannelId') {
  const data = loadData();
  data[entry.executorId] = {
    ...entry,
    timestamp: new Date().toISOString(),
  };
  saveData(data);

  if (guild) {
    const targetPart = entry.targetLabel ? ` → ${entry.targetLabel}` : '';
    await postToLogChannel(
      guild,
      `📋 **${entry.executorTag || entry.executorId}** ran \`${entry.action}\`${targetPart}. Reason: ${entry.reason || 'No reason given'}`,
      channelKey
    );
  }
}

function getLastAction(userId) {
  const data = loadData();
  return data[userId] || null;
}

/**
 * Attempt to undo a member's most recently logged /request action.
 * Returns { success: boolean, message: string }.
 */
async function revertLastAction(userId, guild) {
  const last = getLastAction(userId);
  if (!last) {
    return { success: false, message: 'No logged /request action found for this member.' };
  }

  try {
    switch (last.action) {
      case 'ban': {
        await guild.members.unban(last.targetId, 'Auto-reverted via /request member warn revert:true');
        return { success: true, message: `Reverted: unbanned ${last.targetLabel || last.targetId}.` };
      }

      case 'mute': {
        const member = await guild.members.fetch(last.targetId).catch(() => null);
        if (!member) return { success: false, message: 'Could not find that member to remove their timeout.' };
        await member.timeout(null, 'Auto-reverted via /request member warn revert:true');
        return { success: true, message: `Reverted: removed the timeout on ${last.targetLabel || last.targetId}.` };
      }

      case 'channel-create': {
        const channel = await guild.channels.fetch(last.targetId).catch(() => null);
        if (!channel) return { success: true, message: 'Channel no longer exists — nothing to revert.' };
        await channel.delete('Auto-reverted via /request member warn revert:true');
        return { success: true, message: `Reverted: deleted the channel they created (${last.targetLabel || last.targetId}).` };
      }

      case 'role-create': {
        const role = await guild.roles.fetch(last.targetId).catch(() => null);
        if (!role) return { success: true, message: 'Role no longer exists — nothing to revert.' };
        await role.delete('Auto-reverted via /request member warn revert:true');
        return { success: true, message: `Reverted: deleted the role they created (${last.targetLabel || last.targetId}).` };
      }

      case 'channel-perm': {
        if (!last.snapshot) return { success: false, message: 'No permission snapshot was stored for this action.' };
        const { channelId, overwriteTargetId, allow, deny } = last.snapshot;
        const channel = await guild.channels.fetch(channelId).catch(() => null);
        if (!channel) return { success: false, message: 'That channel no longer exists.' };

        const allowNames = new PermissionsBitField(BigInt(allow || 0)).toArray();
        const denyNames = new PermissionsBitField(BigInt(deny || 0)).toArray();
        const restoreObj = {};
        for (const name of allowNames) restoreObj[name] = true;
        for (const name of denyNames) restoreObj[name] = false;

        if (Object.keys(restoreObj).length === 0) {
          await channel.permissionOverwrites.delete(overwriteTargetId, 'Auto-reverted via /request member warn revert:true').catch(() => {});
        } else {
          await channel.permissionOverwrites.edit(overwriteTargetId, restoreObj, { reason: 'Auto-reverted via /request member warn revert:true' });
        }
        return { success: true, message: `Reverted: restored the previous permission setting on ${last.targetLabel || channelId}.` };
      }

      default:
        return {
          success: false,
          message: `Their last logged action ("${last.action}") can't be safely auto-reverted — Discord's API doesn't leave enough behind to rebuild it. You'll need to fix this manually.`,
        };
    }
  } catch (err) {
    return { success: false, message: `Tried to revert but hit an error: ${err.message}` };
  }
}

module.exports = { logAction, getLastAction, revertLastAction, postToLogChannel };
