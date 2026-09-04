// settingsStore.js — Persists settings configured live via /setup (channel/role picks).
// These take priority over the matching config.js values when both are set, so
// /setup and manually editing config.js can be mixed freely.

const fs = require('fs');
const path = require('path');

const DATA_FILE = path.join(__dirname, 'settings.json');

let settings = {};

function load() {
  try {
    settings = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
  } catch (err) {
    settings = {};
  }
}

function save() {
  try {
    fs.writeFileSync(DATA_FILE, JSON.stringify(settings, null, 2));
  } catch (err) {
    console.error('[settingsStore] Failed to save settings.json:', err.message);
  }
}

function set(key, value) {
  settings[key] = value;
  save();
}

// Returns the /setup value if one has been set, otherwise falls back to a config.js default.
function get(key, fallback) {
  return settings[key] || fallback;
}

load();

module.exports = { get, set };
