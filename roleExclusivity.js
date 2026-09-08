// roleExclusivity.js — "Getting one role removes another." Configure pairs of
// mutually-exclusive roles: the moment a member gains role A, role B is
// automatically stripped (and vice versa) — e.g. team-color roles, he/him vs
// she/her self-roles, or any either/or pair that shouldn't overlap.

const fs = require('fs');
const path = require('path');

const DATA_FILE = path.join(__dirname, 'roleExclusivity.json');

let pairs = []; // [{ roleA, roleB }]

function load() {
  try { pairs = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8')); } catch { pairs = []; }
}

function save() {
  try { fs.writeFileSync(DATA_FILE, JSON.stringify(pairs, null, 2)); }
  catch (err) { console.error('[roleExclusivity] Failed to save roleExclusivity.json:', err.message); }
}

function getPairs() {
  return pairs;
}

function addPair(roleAId, roleBId) {
  const exists = pairs.some(p => (p.roleA === roleAId && p.roleB === roleBId) || (p.roleA === roleBId && p.roleB === roleAId));
  if (exists) return false;
  pairs.push({ roleA: roleAId, roleB: roleBId });
  save();
  return true;
}

function removePair(roleAId, roleBId) {
  const before = pairs.length;
  pairs = pairs.filter(p => !((p.roleA === roleAId && p.roleB === roleBId) || (p.roleA === roleBId && p.roleB === roleAId)));
  save();
  return pairs.length < before;
}

load();

// Called on guildMemberUpdate. Looks at roles the member just GAINED (not
// lost — removing a role should never cascade into removing more roles,
// only gaining one should), and strips the paired role if they have it.
async function handleMemberUpdate(oldMember, newMember) {
  if (pairs.length === 0) return;

  const gainedRoleIds = newMember.roles.cache.filter(r => !oldMember.roles.cache.has(r.id)).map(r => r.id);
  if (gainedRoleIds.length === 0) return;

  for (const gainedId of gainedRoleIds) {
    for (const pair of pairs) {
      let otherId = null;
      if (pair.roleA === gainedId) otherId = pair.roleB;
      else if (pair.roleB === gainedId) otherId = pair.roleA;
      if (!otherId) continue;

      if (newMember.roles.cache.has(otherId)) {
        try {
          await newMember.roles.remove(otherId);
        } catch (err) {
          console.error(`[roleExclusivity] Failed to remove role ${otherId} from ${newMember.user.tag}:`, err.message);
        }
      }
    }
  }
}

module.exports = { getPairs, addPair, removePair, handleMemberUpdate };
