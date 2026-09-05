// config.js — General bot settings.
// Role pairs are no longer edited here — use activityRoles.json,
// or manage them live with /addactivityrole and /removeactivityrole.

module.exports = {
  inactivityTimeoutMinutes: 10,

  // Scam detection — flags likely fake-Nitro/gift-link spam and bans the sender.
  scamDetection: {
    enabled: true,
    newAccountDays: 7,             // accounts newer than this posting a link get flagged
    rapidMessageWindowSeconds: 5,  // window for the rapid-fire spam check
    rapidMessageThreshold: 3,      // this many links/images within the window = flagged

    // Edit this whenever you're ready — {serverName} is replaced automatically.
    banDmMessage: 'You have been banned from {serverName} for posting content that looked like a scam (e.g. a fake Nitro or gift link).',

    // Leave blank for now. Once you have an appeal server, put its invite link here
    // (e.g. "https://discord.gg/yourinvite") and it'll automatically be added to the DM.
    appealServerInvite: '',
  },

  // Ticket system — panel is posted via /ticket setup; a "ticket" style button
  // added manually through /embed create also opens the same flow.
  ticketSystem: {
    supportRoleId: '', // fallback if not set via /ticket setup — role that can see, and close, tickets
    categoryId: '',    // fallback if not set via /ticket setup — channel category to nest ticket channels under

    // Up to 5 questions (Discord's popup form limit). Keep this short — it's a quick intake form.
    questions: [
      'What do you need help with?',
      'Any additional details?',
    ],
  },

  // Join/leave messages + auto-role. Channels/roles can also be set live with /setup —
  // whichever is set via /setup takes priority over the values here.
  joinLeaveSystem: {
    enabled: true,
    joinChannelId: '',   // fallback if not set via /setup
    leaveChannelId: '',  // fallback if not set via /setup
    autoRoleIds: [],     // fallback if not set via /setup — ALL of these are given immediately when someone joins

    // See joinLeaveSystem.js for the full list of available {placeholders}.
    joinMessage: '👋 Welcome {user} to **{server}**! You are member #{memberCount}.\nInvited by **{inviterTag}** ({inviter}) — they now have **{inviteCount}** total invite(s).',
    leaveMessage: '👋 **{username}** has left {server}. We now have {memberCount} members.',
  },
};
