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

// Adds a new pair, or updates an existing one.
//
// oldRequiredRoleId (optional) is the fix for a real bug: without it, there was
// no way to change what a pair's required role WAS — matching only ever
// happened on the (new) required role you just typed, so trying to "change"
// a pair's required role silently created a second, separate pair instead of
// re-keying the existing one, leaving the original untouched. Now, if
// oldRequiredRoleId is given, that specific pair is found and BOTH its
// required and active role are updated (a true edit/re-key). Without it,
// behavior is unchanged: match by the given requiredRoleId, update its
// active role if found, otherwise add a new pair.
function addPair(requiredRoleId, activeRoleId, oldRequiredRoleId) {
  if (oldRequiredRoleId) {
    const existing = roles.find(p => p.requiredRoleId === oldRequiredRoleId);
    if (existing) {
      existing.requiredRoleId = requiredRoleId;
      existing.activeRoleId = activeRoleId;
      save();
      return;
    }
    // Fall through to normal add/update if the old one wasn't actually found —
    // better to still save the pair than to silently do nothing.
  }

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
