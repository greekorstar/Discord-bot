// applicationStore.js — Persisted storage for submitted applications, so
// accept/deny decisions still work correctly even across a bot restart.
//
// Record shape: { id, applicantId, applicantTag, guildId, answers, questions,
//                 status ('pending' | 'accepted' | 'denied'), createdAt,
//                 submissionMessageId, pendingMessageId }

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DATA_FILE = path.join(__dirname, 'applications.json');

let records = {}; // id -> record

function load() {
  try {
    const raw = fs.readFileSync(DATA_FILE, 'utf8');
    records = JSON.parse(raw);
  } catch (err) {
    records = {}; // file doesn't exist yet, or is corrupt — start fresh
  }
}

function save() {
  try {
    fs.writeFileSync(DATA_FILE, JSON.stringify(records, null, 2));
  } catch (err) {
    console.error('[applicationStore] Failed to save applications.json:', err.message);
  }
}

// data: { applicantId, applicantTag, guildId, answers, questions }
function create(data) {
  const id = crypto.randomBytes(6).toString('hex');
  records[id] = {
    id,
    status: 'pending',
    createdAt: Date.now(),
    ...data,
  };
  save();
  return id;
}

function get(id) {
  return records[id];
}

function update(id, patch) {
  if (!records[id]) return null;
  records[id] = { ...records[id], ...patch };
  save();
  return records[id];
}

load();

module.exports = { create, get, update };
