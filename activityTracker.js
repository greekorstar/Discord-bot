// activityTracker.js — Grants an "active" role while a member is posting messages
// or reacting, and removes it again after a period of inactivity.
//
// Works off the pairs configured via /addactivityrole (stored/managed in roleManager.js):
//   { requiredRoleId, activeRoleId }
// Anyone holding requiredRoleId gets activeRoleId as soon as they do something
// (send a message or add a reaction), and loses activeRoleId again if they go
// config.inactivityTimeoutMinutes minutes without doing anything else.

const roleManager = require('./roleManager.js');
const config = require('./config.js');

// key: `${guildId}:${memberId}:${activeRoleId}` -> Timeout
const inactivityTimers = new Map();

function timerKey(guildId, memberId, activeRoleId) {
  return `${guildId}:${memberId}:${activeRoleId}`;
}

async function removeActiveRole(member, activeRoleId) {
  try {
    if (member.roles.cache.has(activeRoleId)) {
      await member.roles.remove(activeRoleId);
    }
  } catch (err) {
    console.error(`[activityTracker] Failed to remove role ${activeRoleId} from ${member.user?.tag || member.id}:`, err.message);
  }
}

function resetInactivityTimer(member, activeRoleId) {
  const key = timerKey(member.guild.id, member.id, activeRoleId);

  const existing = inactivityTimers.get(key);
  if (existing) clearTimeout(existing);

  const timeoutMs = (config.inactivityTimeoutMinutes || 10) * 60 * 1000;
  const timeout = setTimeout(() => {
    inactivityTimers.delete(key);
    removeActiveRole(member, activeRoleId);
  }, timeoutMs);

  // Don't let this timer keep the process alive on its own.
  if (typeof timeout.unref === 'function') timeout.unref();

  inactivityTimers.set(key, timeout);
}

// Call this whenever a member does something that counts as "activity"
// (sending a message, adding a reaction, etc).
async function handleActivity(member) {
  if (!member || member.user?.bot) return;

  const pairs = roleManager.getPairs();
  if (!pairs || pairs.length === 0) return;

  for (const pair of pairs) {
    if (!member.roles.cache.has(pair.requiredRoleId)) continue;

    if (!member.roles.cache.has(pair.activeRoleId)) {
      try {
        await member.roles.add(pair.activeRoleId);
      } catch (err) {
        console.error(`[activityTracker] Failed to add role ${pair.activeRoleId} to ${member.user?.tag || member.id}:`, err.message);
        continue;
      }
    }

    resetInactivityTimer(member, pair.activeRoleId);
  }
}

module.exports = { handleActivity };
