// applicationSystem.js — Handles the "Apply" button flow: submission modal,
// posting to the submission/pending channels, and staff accept/deny actions.

const { ModalBuilder, TextInputBuilder, TextInputStyle, ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder } = require('discord.js');
const config = require('./config.js');
const store = require('./applicationStore.js');
const settingsStore = require('./settingsStore.js');

function buildApplicationModal() {
  const questions = config.applicationSystem.questions.slice(0, 5); // modals max out at 5 inputs
  const modal = new ModalBuilder().setCustomId('application_modal').setTitle('Application');

  questions.forEach((question, i) => {
    modal.addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId(`q${i}`)
          .setLabel(question.slice(0, 45)) // Discord label limit
          .setStyle(TextInputStyle.Paragraph)
          .setRequired(true)
          .setMaxLength(1000)
      )
    );
  });

  return modal;
}

function buildReviewEmbed(applicantTag, answers, questions, status) {
  const embed = new EmbedBuilder()
    .setTitle(`Application from ${applicantTag}`)
    .setColor(status === 'accepted' ? 0x57F287 : status === 'denied' ? 0xED4245 : 0x5865F2)
    .addFields(questions.map((q, i) => ({ name: q, value: answers[i] || '(no answer)' })));

  if (status !== 'pending') {
    embed.setFooter({ text: `Status: ${status === 'accepted' ? 'Accepted' : 'Denied'}` });
  }

  return embed;
}

async function handleSubmit(interaction, client) {
  const questions = config.applicationSystem.questions.slice(0, 5);
  const answers = questions.map((_, i) => interaction.fields.getTextInputValue(`q${i}`));

  const submissionChannel = await client.channels.fetch(settingsStore.get('appSubmissionChannelId', config.applicationSystem.submissionChannelId)).catch(() => null);
  const pendingChannel = await client.channels.fetch(settingsStore.get('appPendingChannelId', config.applicationSystem.pendingChannelId)).catch(() => null);

  if (!submissionChannel || !pendingChannel) {
    await interaction.reply({ content: 'Applications aren\'t fully set up yet (missing channel configuration). Please tell an admin.', ephemeral: true });
    return;
  }

  const id = store.create({
    applicantId: interaction.user.id,
    applicantTag: interaction.user.tag,
    guildId: interaction.guild.id,
    answers,
    questions,
  });

  const reviewEmbed = buildReviewEmbed(interaction.user.tag, answers, questions, 'pending');
  const actionRow = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`app_accept_${id}`).setLabel('Accept').setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId(`app_deny_${id}`).setLabel('Deny').setStyle(ButtonStyle.Danger),
  );

  const submissionMessage = await submissionChannel.send({ embeds: [reviewEmbed], components: [actionRow] });
  const pendingMessage = await pendingChannel.send({ embeds: [reviewEmbed] });

  store.update(id, { submissionMessageId: submissionMessage.id, pendingMessageId: pendingMessage.id });

  await interaction.reply({ content: '✅ Your application has been submitted!', ephemeral: true });
}

async function handleDecision(interaction, client, decision) {
  const id = interaction.customId.replace(decision === 'accepted' ? 'app_accept_' : 'app_deny_', '');
  const record = store.get(id);

  if (!record) {
    await interaction.reply({ content: 'This application record could not be found (it may predate a bot restart or was already resolved).', ephemeral: true });
    return;
  }
  if (record.status !== 'pending') {
    await interaction.reply({ content: `This application was already marked as ${record.status}.`, ephemeral: true });
    return;
  }

  const targetChannelId = decision === 'accepted' ? settingsStore.get('appAcceptedChannelId', config.applicationSystem.acceptedChannelId) : settingsStore.get('appDeniedChannelId', config.applicationSystem.deniedChannelId);
  const targetChannel = await client.channels.fetch(targetChannelId).catch(() => null);
  const resultEmbed = buildReviewEmbed(record.applicantTag, record.answers, record.questions, decision);

  if (targetChannel) {
    await targetChannel.send({ embeds: [resultEmbed] });
  }

  // Update the original submission message: disable buttons, show the decision
  await interaction.update({ embeds: [resultEmbed], components: [] });

  // Remove the pending-log copy since it's now resolved
  const pendingChannel = await client.channels.fetch(settingsStore.get('appPendingChannelId', config.applicationSystem.pendingChannelId)).catch(() => null);
  if (pendingChannel && record.pendingMessageId) {
    const pendingMsg = await pendingChannel.messages.fetch(record.pendingMessageId).catch(() => null);
    if (pendingMsg) await pendingMsg.delete().catch(() => {});
  }

  store.update(id, { status: decision });

  // DM the applicant
  try {
    const applicant = await client.users.fetch(record.applicantId);
    const dmTemplate = decision === 'accepted' ? config.applicationSystem.dmOnAccept : config.applicationSystem.dmOnDeny;
    const dmText = dmTemplate.replace('{serverName}', interaction.guild.name);
    await applicant.send(dmText);
  } catch (err) {
    console.log(`[applications] Could not DM applicant ${record.applicantTag} (DMs likely closed).`);
  }
}

module.exports = { buildApplicationModal, handleSubmit, handleDecision };
