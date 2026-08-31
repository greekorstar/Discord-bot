// activityTracker.js — Handles granting/removing "active" roles based on user activity.

const config = require('./config.js');
const roleManager = require('./roleManager.js');

// Tracks pending removal timers so we can reset them on new activity.
// Key format: "guildId:userId:activeRoleId" -> Timeout handle
const timers = new Map();

async function handleActivity(member) {
  if (!member || member.user.bot) return;

  for (const pair of roleManager.getPairs()) {
    if (member.roles.cache.has(pair.requiredRoleId)) {
      await grantActiveRole(member, pair.activeRoleId);
      resetInactivityTimer(member, pair.activeRoleId);
    }
  }
}

async function grantActiveRole(member, activeRoleId) {
  if (member.roles.cache.has(activeRoleId)) return; // already has it, nothing to do

  try {
    await member.roles.add(activeRoleId);
    console.log(`[activity] Granted role ${activeRoleId} to ${member.user.tag}`);
  } catch (err) {
    console.error(`[activity] Failed to add role ${activeRoleId} to ${member.user.tag}: ${err.message}`);
    console.error('  -> Check that the bot role is positioned ABOVE this role in Server Settings > Roles, and that the bot has "Manage Roles" permission.');
  }
}

function resetInactivityTimer(member, activeRoleId) {
  const key = `${member.guild.id}:${member.id}:${activeRoleId}`;

  if (timers.has(key)) {
    clearTimeout(timers.get(key));
  }

  const timeoutMs = config.inactivityTimeoutMinutes * 60 * 1000;

  const timeout = setTimeout(async () => {
    try {
      const freshMember = await member.guild.members.fetch(member.id);
      if (freshMember.roles.cache.has(activeRoleId)) {
        await freshMember.roles.remove(activeRoleId);
        console.log(`[activity] Removed role ${activeRoleId} from ${freshMember.user.tag} after ${config.inactivityTimeoutMinutes} min of inactivity`);
      }
    } catch (err) {
      console.error(`[activity] Failed to remove role ${activeRoleId}: ${err.message}`);
    } finally {
      timers.delete(key);
    }
  }, timeoutMs);

  timers.set(key, timeout);
}

module.exports = { handleActivity };
