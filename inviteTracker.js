// inviteTracker.js — Caches each guild's invite use-counts so that when someone
// joins, we can diff against the cache and figure out which invite they used
// (and therefore who invited them). Discord has no direct "this invite was used"
// event, so this compare-before-and-after approach is the standard way to do it.

// guildId -> Map(inviteCode -> { uses, inviterId, inviterTag })
const inviteCache = new Map();

async function cacheGuildInvites(guild) {
  try {
    const invites = await guild.invites.fetch();
    const codeMap = new Map();
    invites.forEach(invite => {
      codeMap.set(invite.code, {
        uses: invite.uses || 0,
        inviterId: invite.inviter ? invite.inviter.id : null,
        inviterTag: invite.inviter ? invite.inviter.tag : 'Unknown',
      });
    });
    inviteCache.set(guild.id, codeMap);
  } catch (err) {
    console.log(`[inviteTracker] Could not fetch invites for ${guild.name} (bot likely missing the "Manage Server" permission): ${err.message}`);
  }
}

// Sums uses across every invite in `snapshot` created by the given inviter —
// this is their all-time total, not just the one invite that got used.
function totalUsesForInviter(snapshot, inviterId) {
  if (!inviterId) return null;
  let total = 0;
  for (const data of snapshot.values()) {
    if (data.inviterId === inviterId) total += data.uses;
  }
  return total;
}

// Call this on guildMemberAdd. Returns { inviterId, inviterTag, code, uses, totalInviterUses }
// or null if it couldn't be determined (e.g. a vanity URL join, or the bot lacks permission).
async function resolveUsedInvite(guild) {
  const before = inviteCache.get(guild.id);
  if (!before) return null;

  let after;
  try {
    const invites = await guild.invites.fetch();
    after = new Map();
    invites.forEach(invite => {
      after.set(invite.code, {
        uses: invite.uses || 0,
        inviterId: invite.inviter ? invite.inviter.id : null,
        inviterTag: invite.inviter ? invite.inviter.tag : 'Unknown',
      });
    });
  } catch (err) {
    return null;
  }

  let result = null;
  for (const [code, data] of after.entries()) {
    const previous = before.get(code);
    if (!previous && data.uses > 0) {
      result = { inviterId: data.inviterId, inviterTag: data.inviterTag, code, uses: data.uses };
      break;
    }
    if (previous && data.uses > previous.uses) {
      result = { inviterId: data.inviterId, inviterTag: data.inviterTag, code, uses: data.uses };
      break;
    }
  }

  if (result) {
    result.totalInviterUses = totalUsesForInviter(after, result.inviterId);
  }

  inviteCache.set(guild.id, after);
  return result;
}

function onInviteChange(guild) {
  // Refresh the cache whenever an invite is created or deleted so counts stay accurate.
  cacheGuildInvites(guild);
}

module.exports = { cacheGuildInvites, resolveUsedInvite, onInviteChange };
