// joinLeaveSystem.js — Fills in placeholders for join/leave message templates.
//
// Available placeholders (used in config.js under joinLeaveSystem.joinMessage / leaveMessage):
//   {user}        - mentions the member (e.g. @Username)
//   {username}    - their username as plain text (no mention/ping)
//   {server}      - the server's name
//   {memberCount} - the server's current member count
//   {date}        - the date/time they joined (or left), formatted for Discord
//   {inviter}     - @-mentions whoever invited them, or "Unknown" if it couldn't be
//                    determined (vanity URL joins, or the bot lacking permission)
//   {inviterTag}  - the same person's tag as plain text (e.g. SomePerson#0001), no ping
//   {inviteCode}  - the invite code they used, or "Unknown"
//   {inviteUses}  - how many times that ONE invite code has now been used
//   {inviteCount} - the inviter's TOTAL uses across all of their invite links combined,
//                    or "Unknown" if it couldn't be determined

function fillPlaceholders(template, member, inviteInfo) {
  const guild = member.guild;
  const joinTimestamp = member.joinedTimestamp || Date.now();

  return template
    .replaceAll('{user}', `<@${member.id}>`)
    .replaceAll('{username}', member.user.username)
    .replaceAll('{server}', guild.name)
    .replaceAll('{memberCount}', `${guild.memberCount}`)
    .replaceAll('{date}', `<t:${Math.floor(joinTimestamp / 1000)}:F>`)
    .replaceAll('{inviter}', inviteInfo && inviteInfo.inviterId ? `<@${inviteInfo.inviterId}>` : 'Unknown')
    .replaceAll('{inviterTag}', inviteInfo ? inviteInfo.inviterTag : 'Unknown')
    .replaceAll('{inviteCode}', inviteInfo ? inviteInfo.code : 'Unknown')
    .replaceAll('{inviteUses}', inviteInfo ? `${inviteInfo.uses}` : 'Unknown')
    .replaceAll('{inviteCount}', inviteInfo && inviteInfo.totalInviterUses !== null && inviteInfo.totalInviterUses !== undefined ? `${inviteInfo.totalInviterUses}` : 'Unknown');
}

module.exports = { fillPlaceholders };
