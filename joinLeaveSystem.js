// joinLeaveSystem.js — Fills in placeholders for join/leave message templates.
//
// Available placeholders (used in config.js under joinLeaveSystem.joinMessage / leaveMessage):
//   {user}        - mentions the member (e.g. @Username)
//   {username}    - their username as plain text (no mention/ping)
//   {server}      - the server's name
//   {memberCount} - the server's current member count
//   {date}        - the date/time they joined (or left), formatted for Discord
//   {inviter}     - the tag of whoever invited them (e.g. SomePerson#0001), or "Unknown" if it
//                    couldn't be determined (vanity URL joins, or the bot lacking permission)
//   {inviteCode}  - the invite code they used, or "Unknown"
//   {inviteUses}  - how many total times that invite has now been used

function fillPlaceholders(template, member, inviteInfo) {
  const guild = member.guild;
  const joinTimestamp = member.joinedTimestamp || Date.now();

  return template
    .replaceAll('{user}', `<@${member.id}>`)
    .replaceAll('{username}', member.user.username)
    .replaceAll('{server}', guild.name)
    .replaceAll('{memberCount}', `${guild.memberCount}`)
    .replaceAll('{date}', `<t:${Math.floor(joinTimestamp / 1000)}:F>`)
    .replaceAll('{inviter}', inviteInfo ? inviteInfo.inviterTag : 'Unknown')
    .replaceAll('{inviteCode}', inviteInfo ? inviteInfo.code : 'Unknown')
    .replaceAll('{inviteUses}', inviteInfo ? `${inviteInfo.uses}` : 'Unknown');
}

module.exports = { fillPlaceholders };
