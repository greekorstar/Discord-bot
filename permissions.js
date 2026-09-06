// permissions.js — Checks the specific Discord permission a command needs,
// rather than gating everything behind Administrator. Replies with a hidden
// (ephemeral) embed if the member doesn't have it.

const { EmbedBuilder } = require('discord.js');

async function requirePermission(interaction, permissionBit, permissionLabel) {
  if (!interaction.memberPermissions.has(permissionBit)) {
    const embed = new EmbedBuilder()
      .setTitle('🚫 Missing Permission')
      .setDescription(`You need the **${permissionLabel}** permission to use this command.`)
      .setColor(0xED4245);
    await interaction.reply({ embeds: [embed], ephemeral: true });
    return false;
  }
  return true;
}

module.exports = { requirePermission };
