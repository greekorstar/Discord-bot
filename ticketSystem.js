// ticketSystem.js — Everything ticket-related: posting the "open a ticket" panel,
// the private-channel creation flow, closing with a required reason, and
// generating/posting a transcript of the ticket before it's deleted.
//
// Settings (all via /ticket setup, stored in settingsStore.js):
//   ticketPanelChannelId      - where the "click to open a ticket" panel lives
//   ticketSupportRoleId       - role that can see tickets AND close them
//   ticketCategoryId          - optional: channel category new ticket channels nest under
//   ticketTranscriptChannelId - where a transcript gets posted when a ticket closes

const {
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  ActionRowBuilder,
  ChannelSelectMenuBuilder,
  RoleSelectMenuBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  AttachmentBuilder,
  PermissionFlagsBits,
  ChannelType,
} = require('discord.js');
const config = require('./config.js');
const settingsStore = require('./settingsStore.js');

// ---- /ticket setup ----

function buildSetupRows() {
  return [
    new ActionRowBuilder().addComponents(
      new ChannelSelectMenuBuilder().setCustomId('ticketsetup_panelchannel').setPlaceholder('Channel to post the "Open a Ticket" panel in').addChannelTypes(ChannelType.GuildText)
    ),
    new ActionRowBuilder().addComponents(
      new RoleSelectMenuBuilder().setCustomId('ticketsetup_supportrole').setPlaceholder('Support role — can see tickets and close them')
    ),
    new ActionRowBuilder().addComponents(
      new ChannelSelectMenuBuilder().setCustomId('ticketsetup_category').setPlaceholder('Category for ticket channels (optional)').addChannelTypes(ChannelType.GuildCategory)
    ),
    new ActionRowBuilder().addComponents(
      new ChannelSelectMenuBuilder().setCustomId('ticketsetup_transcriptchannel').setPlaceholder('Channel where closed-ticket transcripts are sent').addChannelTypes(ChannelType.GuildText)
    ),
  ];
}

const SETUP_CUSTOM_ID_TO_SETTING = {
  ticketsetup_panelchannel: 'ticketPanelChannelId',
  ticketsetup_supportrole: 'ticketSupportRoleId',
  ticketsetup_category: 'ticketCategoryId',
  ticketsetup_transcriptchannel: 'ticketTranscriptChannelId',
};

function buildPanelEmbed() {
  return new EmbedBuilder()
    .setTitle('🎫 Need Help?')
    .setDescription('Click the button below to open a private ticket. Only you and the support team will be able to see it.')
    .setColor(0x5865F2);
}

function buildPanelRow() {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('ticket_button').setLabel('Open a Ticket').setStyle(ButtonStyle.Success).setEmoji('🎫')
  );
}

// Handles every ticketsetup_* select menu. Saves the setting, and if it's the
// panel channel, also actually posts the panel there right away.
async function handleSetupSelect(interaction) {
  const settingKey = SETUP_CUSTOM_ID_TO_SETTING[interaction.customId];
  if (!settingKey) return false;

  const selectedId = interaction.values[0];
  settingsStore.set(settingKey, selectedId);

  if (interaction.customId === 'ticketsetup_panelchannel') {
    try {
      const channel = await interaction.guild.channels.fetch(selectedId);
      const panelMessage = await channel.send({ embeds: [buildPanelEmbed()], components: [buildPanelRow()] });
      await interaction.reply({ content: `✅ Saved, and posted the ticket panel in <#${selectedId}> (${panelMessage.url}).`, ephemeral: true });
    } catch (err) {
      console.error('[tickets] Failed to post ticket panel:', err.message);
      await interaction.reply({ content: `✅ Saved the channel, but I couldn't post the panel there — make sure I have View Channel and Send Messages permission in <#${selectedId}>.`, ephemeral: true });
    }
    return true;
  }

  await interaction.reply({ content: '✅ Saved that selection.', ephemeral: true });
  return true;
}

// ---- Opening a ticket ----

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

  // Private: deny @everyone, allow the opener, allow the bot, allow the support role.
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

// ---- Closing a ticket (now requires a reason) ----

function buildCloseReasonModal(openerId) {
  return new ModalBuilder()
    .setCustomId(`ticket_close_reason_modal_${openerId}`)
    .setTitle('Close Ticket')
    .addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder().setCustomId('reason').setLabel('Reason for closing').setStyle(TextInputStyle.Paragraph).setRequired(true).setMaxLength(500)
      ),
    );
}

// Click on "Close Ticket" — just opens the reason modal. Permission is checked
// here so a person with no business closing it never even sees the modal.
async function handleCloseButtonClick(interaction) {
  const openerId = interaction.customId.replace('ticket_close_', '');
  if (!(await canClose(interaction))) {
    await interaction.reply({ content: 'Only the person who opened this ticket, staff, or the support role can close it.', ephemeral: true });
    return;
  }
  await interaction.showModal(buildCloseReasonModal(openerId));
}

async function canClose(interaction) {
  const supportRoleId = settingsStore.get('ticketSupportRoleId', config.ticketSystem.supportRoleId);
  const openerId = interaction.customId.replace(/^ticket_close_(reason_modal_)?/, '');
  const isOpener = interaction.user.id === openerId;
  const isStaff = interaction.memberPermissions.has(PermissionFlagsBits.Administrator) || interaction.memberPermissions.has(PermissionFlagsBits.ManageMessages);
  const isSupport = supportRoleId ? interaction.member.roles.cache.has(supportRoleId) : false;
  return isOpener || isStaff || isSupport;
}

// Pages through the whole channel history (Discord caps a single fetch at 100)
// and returns a plain-text transcript, oldest message first.
async function buildTranscript(channel) {
  const allMessages = [];
  let before;

  while (true) {
    const batch = await channel.messages.fetch({ limit: 100, ...(before ? { before } : {}) });
    if (batch.size === 0) break;
    allMessages.push(...batch.values());
    before = batch.last().id;
    if (batch.size < 100) break;
  }

  allMessages.reverse(); // oldest first

  const lines = allMessages.map(m => {
    const time = new Date(m.createdTimestamp).toISOString().replace('T', ' ').slice(0, 19);
    let line = `[${time}] ${m.author.tag}: ${m.content || ''}`;
    if (m.attachments.size > 0) {
      line += ` ${[...m.attachments.values()].map(a => `[attachment: ${a.url}]`).join(' ')}`;
    }
    if (m.embeds.length > 0) {
      line += ` [${m.embeds.length} embed(s)]`;
    }
    return line;
  });

  return lines.join('\n') || '(no messages)';
}

async function postTranscript(interaction, reason) {
  const transcriptChannelId = settingsStore.get('ticketTranscriptChannelId', '');
  if (!transcriptChannelId) return; // not configured — skip silently, closing still proceeds

  try {
    const transcriptChannel = await interaction.guild.channels.fetch(transcriptChannelId).catch(() => null);
    if (!transcriptChannel) return;

    const text = await buildTranscript(interaction.channel);
    const attachment = new AttachmentBuilder(Buffer.from(text, 'utf-8'), { name: `transcript-${interaction.channel.name}.txt` });

    const embed = new EmbedBuilder()
      .setTitle('🎫 Ticket Closed')
      .setColor(0xED4245)
      .addFields(
        { name: 'Channel', value: `#${interaction.channel.name}` },
        { name: 'Closed by', value: `<@${interaction.user.id}>` },
        { name: 'Reason', value: reason },
      )
      .setTimestamp();

    await transcriptChannel.send({ embeds: [embed], files: [attachment] });
  } catch (err) {
    console.error('[tickets] Failed to post transcript:', err.message);
  }
}

// Modal submit — reason collected, now actually close: post transcript, then delete.
async function handleCloseReasonSubmit(interaction) {
  if (!(await canClose(interaction))) {
    await interaction.reply({ content: 'Only the person who opened this ticket, staff, or the support role can close it.', ephemeral: true });
    return;
  }

  const reason = interaction.fields.getTextInputValue('reason');

  await interaction.reply(`🔒 Closing this ticket in 5 seconds. Reason: ${reason}`);
  await postTranscript(interaction, reason);

  setTimeout(() => {
    interaction.channel.delete().catch(err => console.error('[tickets] Failed to delete ticket channel:', err.message));
  }, 5000);
}

module.exports = {
  buildSetupRows,
  handleSetupSelect,
  buildTicketModal,
  handleSubmit,
  handleCloseButtonClick,
  handleCloseReasonSubmit,
};
