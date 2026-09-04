// settingsStore.js — Simple persisted key/value store for settings configured
// live via /setup (channel IDs, role IDs, etc). Values set here take priority
// over the fallback defaults in config.js — see how it's called elsewhere:
//   settingsStore.get('someKey', config.someSection.someKeyFallback)
//
// Falls back to the second argument whenever the key hasn't been set yet
// (or was explicitly saved as an empty string).

const fs = require('fs');
const path = require('path');

const DATA_FILE = path.join(__dirname, 'settings.json');

let settings = {};

function load() {
  try {
    const raw = fs.readFileSync(DATA_FILE, 'utf8');
    settings = JSON.parse(raw);
  } catch (err) {
    settings = {}; // file doesn't exist yet, or is corrupt — start fresh
  }
}

function save() {
  try {
    fs.writeFileSync(DATA_FILE, JSON.stringify(settings, null, 2));
  } catch (err) {
    console.error('[settingsStore] Failed to save settings.json:', err.message);
  }
}

function get(key, fallback) {
  const value = settings[key];
  return (value === undefined || value === null || value === '') ? fallback : value;
}

function set(key, value) {
  settings[key] = value;
  save();
}

load();

module.exports = { get, set };
