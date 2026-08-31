// roleManager.js — Reads/writes activityRoles.json and keeps an in-memory copy.
// This is what lets /addactivityrole and /removeactivityrole persist changes.

const fs = require('fs');
const path = require('path');

const DATA_FILE = path.join(__dirname, 'activityRoles.json');

let roles = [];

function load() {
  try {
    const raw = fs.readFileSync(DATA_FILE, 'utf8');
    roles = JSON.parse(raw);
  } catch (err) {
    console.error('[roleManager] Could not read activityRoles.json, starting with an empty list:', err.message);
    roles = [];
  }
}

function save() {
  try {
    fs.writeFileSync(DATA_FILE, JSON.stringify(roles, null, 2));
  } catch (err) {
    console.error('[roleManager] Failed to save activityRoles.json:', err.message);
  }
}

function getPairs() {
  return roles;
}

// Adds a new pair, or updates the active role if the required role is already configured.
function addPair(requiredRoleId, activeRoleId) {
  const existing = roles.find(p => p.requiredRoleId === requiredRoleId);
  if (existing) {
    existing.activeRoleId = activeRoleId;
  } else {
    roles.push({ requiredRoleId, activeRoleId });
  }
  save();
}

// Removes the pair matching the given required role ID. Returns true if something was removed.
function removePair(requiredRoleId) {
  const before = roles.length;
  roles = roles.filter(p => p.requiredRoleId !== requiredRoleId);
  save();
  return roles.length < before;
}

load(); // load immediately when this module is first required

module.exports = { getPairs, addPair, removePair, load };
