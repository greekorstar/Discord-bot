// requestWarnings.js — Tracks warning counts against people who hold the
// /request access role. Used both by auditMonitor.js (bypass detection, calls
// addWarning synchronously with just a userId) and by requestCommands.js's
// handleWarn (the manual /request member warn command).
//
// Deliberately simple: this module ONLY tracks the counter. Applying the
// "warned" role, removing the access role, and any revert attempt are all
// handled by the CALLER (auditMonitor.js or requestCommands.js), since they're
// the ones with the guild/member objects and know the context.

const fs = require('fs');
const path = require('path');

const DATA_FILE = path.join(__dirname, 'requestWarnings.json');

function loadData() {
  if (!fs.existsSync(DATA_FILE)) return {};
  try {
    const raw = fs.readFileSync(DATA_FILE, 'utf8');
    return raw.trim() ? JSON.parse(raw) : {};
  } catch (err) {
    console.error('[requestWarnings] Failed to read requestWarnings.json, starting fresh:', err.message);
    return {};
  }
}

function saveData(data) {
  try {
    fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2), 'utf8');
  } catch (err) {
    console.error('[requestWarnings] Failed to save requestWarnings.json:', err.message);
  }
}

/**
 * Increment a member's warning count and return the new total. Synchronous
 * by design so it can be called without await (matches auditMonitor.js).
 */
function addWarning(userId) {
  const data = loadData();
  if (!data[userId]) {
    data[userId] = { count: 0, history: [] };
  }
  data[userId].count += 1;
  data[userId].history.push({ timestamp: new Date().toISOString() });
  saveData(data);
  return data[userId].count;
}

function getWarningCount(userId) {
  const data = loadData();
  return data[userId] ? data[userId].count : 0;
}

function resetWarnings(userId) {
  const data = loadData();
  if (data[userId]) {
    delete data[userId];
    saveData(data);
    return true;
  }
  return false;
}

module.exports = { addWarning, getWarningCount, resetWarnings };
