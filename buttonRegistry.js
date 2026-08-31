// buttonRegistry.js — Stores what each custom "reply" button should say when clicked.
// Link-style buttons don't need this (Discord handles those natively), but
// non-link buttons need the bot to look up and send a reply on click.

const fs = require('fs');
const path = require('path');

const DATA_FILE = path.join(__dirname, 'buttonReplies.json');

let replies = {}; // customId -> reply text

function load() {
  try {
    const raw = fs.readFileSync(DATA_FILE, 'utf8');
    replies = JSON.parse(raw);
  } catch (err) {
    replies = {};
  }
}

function save() {
  try {
    fs.writeFileSync(DATA_FILE, JSON.stringify(replies, null, 2));
  } catch (err) {
    console.error('[buttonRegistry] Failed to save buttonReplies.json:', err.message);
  }
}

function setReply(customId, text) {
  replies[customId] = text;
  save();
}

function getReply(customId) {
  return replies[customId];
}

load();

module.exports = { setReply, getReply };
