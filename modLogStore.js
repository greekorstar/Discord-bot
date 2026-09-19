// modLogStore.js — Unified moderation case history across kick/ban/softban/
// mute/unmute/unban/warn, so /modlogs <user> shows one combined timeline
// instead of checking each system separately. warnSystem.js stays the
// source of truth for warning ESCALATION counts — this just mirrors every
// action (including warnings) into one sequential, per-guild case list.

const fs = require('fs');
const path = require('path');

const DATA_FILE = path.join(__dirname, 'modLogData.json');
let data = {}; // guildId -> [{ caseId, type, targetId, moderatorId, reason, timestamp, extra }]

function load() {
  try { data = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8')); } catch { data = {}; }
}

function save() {
  try { fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2)); }
  catch (err) { console.error('[modLogStore] Failed to save modLogData.json:', err.message); }
}

load();

function nextCaseId(guildId) {
  const cases = data[guildId] || [];
  return cases.length ? cases[cases.length - 1].caseId + 1 : 1;
}

// type: 'kick' | 'ban' | 'softban' | 'mute' | 'unmute' | 'unban' | 'warn'
function addCase(guildId, { type, targetId, moderatorId, reason, extra = null }) {
  if (!data[guildId]) data[guildId] = [];
  const entry = {
    caseId: nextCaseId(guildId),
    type,
    targetId,
    moderatorId,
    reason: reason || 'No reason provided',
    timestamp: Date.now(),
    extra,
  };
  data[guildId].push(entry);
  save();
  return entry;
}

function getCasesForUser(guildId, userId, limit = 10) {
  return (data[guildId] || []).filter(c => c.targetId === userId).slice(-limit).reverse();
}

function getCase(guildId, caseId) {
  return (data[guildId] || []).find(c => c.caseId === caseId) || null;
}

module.exports = { addCase, getCasesForUser, getCase };
