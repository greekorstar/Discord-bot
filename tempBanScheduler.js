// tempBanScheduler.js — Discord's native timeout feature auto-expires on its
// own (handled server-side), but a ban does NOT — there's no "temporary ban"
// concept in the Discord API itself. This persists scheduled unban times and
// checks them on an interval, so temp-bans survive a bot restart.

const fs = require('fs');
const path = require('path');

const DATA_FILE = path.join(__dirname, 'tempBans.json');
const CHECK_INTERVAL_MS = 60 * 1000; // check every minute

let entries = []; // { guildId, userId, unbanAt, reason }
let clientRef = null;

function load() {
  try {
    entries = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
  } catch (err) {
    entries = [];
  }
}

function save() {
  try {
    fs.writeFileSync(DATA_FILE, JSON.stringify(entries, null, 2));
  } catch (err) {
    console.error('[tempBanScheduler] Failed to save tempBans.json:', err.message);
  }
}

function schedule(guildId, userId, durationMs, reason) {
  entries.push({ guildId, userId, unbanAt: Date.now() + durationMs, reason });
  save();
}

// Cancels a scheduled unban (e.g. if a moderator manually unbans them early).
function cancel(guildId, userId) {
  entries = entries.filter(e => !(e.guildId === guildId && e.userId === userId));
  save();
}

async function checkExpired() {
  if (!clientRef) return;
  const now = Date.now();
  const due = entries.filter(e => e.unbanAt <= now);
  if (due.length === 0) return;

  entries = entries.filter(e => e.unbanAt > now);
  save();

  for (const entry of due) {
    try {
      const guild = await clientRef.guilds.fetch(entry.guildId).catch(() => null);
      if (!guild) continue;
      await guild.members.unban(entry.userId, 'Temporary ban expired');
      console.log(`[tempBanScheduler] Temp-ban expired, unbanned ${entry.userId} in ${entry.guildId}`);
    } catch (err) {
      console.error(`[tempBanScheduler] Failed to auto-unban ${entry.userId}:`, err.message);
    }
  }
}

function init(client) {
  clientRef = client;
  load();
  checkExpired(); // catch anything that expired while the bot was offline
  setInterval(checkExpired, CHECK_INTERVAL_MS);
}

module.exports = { init, schedule, cancel };
