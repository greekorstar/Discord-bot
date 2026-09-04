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

  // Application system — triggered by an "application" style button added via /embed create.
  applicationSystem: {
    // Paste in the channel IDs (right-click a channel > Copy Channel ID, needs Developer Mode on).
    submissionChannelId: '',  // new applications land here with Accept/Deny buttons for staff
    pendingChannelId: '',     // log copy of applications still awaiting a decision
    acceptedChannelId: '',    // log of accepted applications
    deniedChannelId: '',      // log of denied applications

    // Up to 5 questions (Discord's popup form limit). Edit these any time.
    questions: [
      'What is your name/IGN?',
      'How old are you?',
      'Why do you want to join?',
      'Relevant experience?',
      'Anything else we should know?',
    ],

    // {serverName} is replaced automatically. Sent as a DM when a decision is made.
    dmOnAccept: 'Congratulations! Your application to {serverName} has been accepted.',
    dmOnDeny: 'Thanks for applying to {serverName}. Unfortunately, your application was not accepted this time.',
  },

  // Ticket system — triggered by a "ticket" style button added via /embed create.
  ticketSystem: {
    supportRoleId: '', // role that can see and respond to tickets — leave blank for staff-only via permissions elsewhere
    categoryId: '',    // optional: channel category ID to nest ticket channels under — leave blank for none

    // Up to 5 questions (Discord's popup form limit). Keep this short — it's a quick intake form.
    questions: [
      'What do you need help with?',
      'Any additional details?',
    ],
  },

  // Join/leave messages + auto-role. Channels/role can also be set live with /setup —
  // whichever is set via /setup takes priority over the values here.
  joinLeaveSystem: {
    enabled: true,
    joinChannelId: '',   // fallback if not set via /setup
    leaveChannelId: '',  // fallback if not set via /setup
    autoRoleId: '',      // fallback if not set via /setup — given immediately when someone joins

    // See joinLeaveSystem.js for the full list of available {placeholders}.
    joinMessage: 'Welcome {user} to {server}! You are member #{memberCount}. Invited by: {inviter}.',
    leaveMessage: '{username} has left {server}. We now have {memberCount} members.',
  },
};
