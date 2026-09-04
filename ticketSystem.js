// ticketSystem.js — Handles the "Open Ticket" button flow: a quick modal,
// then a private channel just for that user and the support role.

const { ModalBuilder, TextInputBuilder, TextInputStyle, ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, PermissionFlagsBits, ChannelType } = require('discord.js');
const config = require('./config.js');
const settingsStore = require('./settingsStore.js');

function buildTicketModal() {
  const questions = config.ticketSystem.questions.slice(0, 5);
  const modal = new ModalBuilder().setCustomId('ticket_modal').setTitle('Open a Ticket');

  questions.forEach((question, i) => {
    modal.addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId(`q${i}`)
          .setLabel(question.slice(0, 45))
          .setStyle(TextInputStyle.Paragraph)
          .setRequired(true)
          .setMaxLength(1000)
      )
    );
  });

  return modal;
}

function sanitizeChannelName(username) {
  return `ticket-${username.toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 20) || 'user'}`;
}

async function handleSubmit(interaction, client) {
  const questions = config.ticketSystem.questions.slice(0, 5);
  const answers = questions.map((_, i) => interaction.fields.getTextInputValue(`q${i}`));

  const channelName = sanitizeChannelName(interaction.user.username);
  const existing = interaction.guild.channels.cache.find(c => c.name === channelName);
  if (existing) {
    await interaction.reply({ content: `You already have an open ticket: <#${existing.id}>`, ephemeral: true });
    return;
  }

  const supportRoleId = settingsStore.get('ticketSupportRoleId', config.ticketSystem.supportRoleId);
  const categoryId = settingsStore.get('ticketCategoryId', config.ticketSystem.categoryId);

  const overwrites = [
    { id: interaction.guild.roles.everyone.id, deny: [PermissionFlagsBits.ViewChannel] },
    { id: interaction.user.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.AttachFiles] },
    { id: client.user.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ManageChannels] },
  ];
  if (supportRoleId) {
    overwrites.push({ id: supportRoleId, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages] });
  }

  let channel;
  try {
    channel = await interaction.guild.channels.create({
      name: channelName,
      type: ChannelType.GuildText,
      parent: categoryId || undefined,
      permissionOverwrites: overwrites,
    });
  } catch (err) {
    console.error('[tickets] Failed to create ticket channel:', err.message);
    await interaction.reply({ content: 'Something went wrong creating your ticket channel. Please tell an admin (the bot may be missing the "Manage Channels" permission).', ephemeral: true });
    return;
  }

  const embed = new EmbedBuilder()
    .setTitle(`Ticket — ${interaction.user.tag}`)
    .setColor(0x5865F2)
    .addFields(questions.map((q, i) => ({ name: q, value: answers[i] || '(no answer)' })));

  const closeRow = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`ticket_close_${interaction.user.id}`).setLabel('Close Ticket').setStyle(ButtonStyle.Danger)
  );

  const pingText = supportRoleId ? `<@&${supportRoleId}> ` : '';
  await channel.send({ content: `${pingText}<@${interaction.user.id}>`, embeds: [embed], components: [closeRow] });

  await interaction.reply({ content: `✅ Ticket created: <#${channel.id}>`, ephemeral: true });
}

async function handleClose(interaction) {
  const openerId = interaction.customId.replace('ticket_close_', '');
  const isOpener = interaction.user.id === openerId;
  const isStaff = interaction.memberPermissions.has(PermissionFlagsBits.Administrator) || interaction.memberPermissions.has(PermissionFlagsBits.ManageMessages);

  if (!isOpener && !isStaff) {
    await interaction.reply({ content: 'Only the person who opened this ticket, or staff, can close it.', ephemeral: true });
    return;
  }

  await interaction.reply('🔒 Closing this ticket in 5 seconds...');
  setTimeout(() => {
    interaction.channel.delete().catch(err => console.error('[tickets] Failed to delete ticket channel:', err.message));
  }, 5000);
}

module.exports = { buildTicketModal, handleSubmit, handleClose };
