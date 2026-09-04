// permissions.js — Checks the specific Discord permission a command needs,
// rather than gating everything behind Administrator. Replies with a hidden
// (ephemeral) message if the member doesn't have it.

async function requirePermission(interaction, permissionBit, permissionLabel) {
  if (!interaction.memberPermissions.has(permissionBit)) {
    await interaction.reply({ content: `You need the **${permissionLabel}** permission to use this command.`, ephemeral: true });
    return false;
  }
  return true;
}

module.exports = { requirePermission };
