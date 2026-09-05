// buttonRegistry.js — Stores what each custom "action" button does when clicked.
// Link-style buttons don't need this (Discord handles those natively), but
// every other button type does, since Discord only tells us the customId.
//
// Supported action types (config.type):
//   'message'     — just replies with config.text (the original/default behavior)
//   'togglerole'  — adds config.roleId to the clicker if they don't have it,
//                   removes it if they do
//   'addrole'     — always adds config.roleId (no-op if they already have it)
//   'removerole'  — always removes config.roleId (no-op if they don't have it)
// All role-action types may also carry a custom config.text to show instead
// of the default confirmation message.

const fs = require('fs');
const path = require('path');

const DATA_FILE = path.join(__dirname, 'buttonReplies.json');

let entries = {}; // customId -> config object (see header) OR legacy plain string

function load() {
  try {
    const raw = fs.readFileSync(DATA_FILE, 'utf8');
    entries = JSON.parse(raw);
  } catch (err) {
    entries = {};
  }
}

function save() {
  try {
    fs.writeFileSync(DATA_FILE, JSON.stringify(entries, null, 2));
  } catch (err) {
    console.error('[buttonRegistry] Failed to save buttonReplies.json:', err.message);
  }
}

function setConfig(customId, config) {
  entries[customId] = config;
  save();
}

// Back-compat wrapper for the old plain "reply text only" API.
function setReply(customId, text) {
  setConfig(customId, { type: 'message', text });
}

// Always returns a config object ({ type, text, roleId? }), migrating old
// plain-string entries (from before action types existed) on the fly.
function getConfig(customId) {
  const value = entries[customId];
  if (value === undefined) return undefined;
  if (typeof value === 'string') return { type: 'message', text: value };
  return value;
}

// Back-compat wrapper — old code just wanted the reply text.
function getReply(customId) {
  const config = getConfig(customId);
  return config ? config.text : undefined;
}

function deleteReply(customId) {
  delete entries[customId];
  save();
}

load();

module.exports = { setConfig, getConfig, setReply, getReply, deleteReply };
