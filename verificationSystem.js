// verificationSystem.js — Handles the verify panel, one-click verification,
// the CAPTCHA challenge/answer flow (with 3 difficulty tiers), and the admin
// setup command for configuring all of it.

const {
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  AttachmentBuilder,
  RoleSelectMenuBuilder,
} = require('discord.js');
const verificationStore = require('./verificationStore.js');
const captchaGenerator = require('./captchaGenerator.js');

// ---- The panel members see and click ----

function buildPanelEmbed() {
  return new EmbedBuilder()
    .setTitle('Verify to gain access')
    .setDescription('Click the button below to verify you\'re a real person and unlock the rest of the server.')
    .setColor(0x5865F2);
}

function buildPanelRow() {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('verify_start_button').setLabel('Verify').setStyle(ButtonStyle.Success)
  );
}

// ---- Clicking "Verify" ----

async function handleVerifyStart(interaction) {
  const config = verificationStore.getConfig();

  if (!config.verifiedRoleId) {
    await interaction.reply({ content: 'Verification isn\'t fully set up yet (no role configured). Please tell an admin.', ephemeral: true });
    return;
  }

  if (interaction.member.roles.cache.has(config.verifiedRoleId)) {
    await interaction.reply({ content: '✅ You\'re already verified.', ephemeral: true });
    return;
  }

  if (config.method === 'oneclick') {
    try {
      await interaction.member.roles.add(config.verifiedRoleId);
      await interaction.reply({ content: '✅ You\'re verified! Welcome in.', ephemeral: true });
    } catch (err) {
      await interaction.reply({ content: 'Couldn\'t give you the role — I may be missing the Manage Roles permission, or my role needs to be above the verified role.', ephemeral: true });
    }
    return;
  }

  // CAPTCHA method
  const { code, caseSensitive, buffer } = captchaGenerator.generateCaptcha(config.difficulty);
  verificationStore.startCaptchaSession(interaction.user.id, code, caseSensitive);

  const attachment = new AttachmentBuilder(buffer, { name: 'captcha.png' });
  const embed = new EmbedBuilder()
    .setTitle('Enter the code shown below')
    .setDescription(caseSensitive ? 'This code is **case-sensitive** — type it exactly as shown.' : 'Not case-sensitive — just type the characters you see.')
    .setImage('attachment://captcha.png')
    .setColor(0x5865F2);
  const answerRow = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('verify_captcha_answer_button').setLabel('Enter Code').setStyle(ButtonStyle.Primary)
  );

  await interaction.reply({ embeds: [embed], files: [attachment], components: [answerRow], ephemeral: true });
}

// ---- CAPTCHA answer modal ----

function buildCaptchaModal() {
  return new ModalBuilder()
    .setCustomId('verify_captcha_modal')
    .setTitle('Enter the Code')
    .addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder().setCustomId('code').setLabel('Code from the image').setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(10)
      )
    );
}

async function handleCaptchaAnswerButton(interaction) {
  await interaction.showModal(buildCaptchaModal());
}

async function handleCaptchaModalSubmit(interaction) {
  const config = verificationStore.getConfig();
  const session = verificationStore.getCaptchaSession(interaction.user.id);

  if (!session) {
    await interaction.reply({ content: 'Your verification session expired. Click **Verify** again to get a new code.', ephemeral: true });
    return;
  }

  const submitted = interaction.fields.getTextInputValue('code').trim();
  const correct = session.caseSensitive ? submitted === session.code : submitted.toLowerCase() === session.code.toLowerCase();

  if (correct) {
    verificationStore.clearCaptchaSession(interaction.user.id);
    try {
      await interaction.member.roles.add(config.verifiedRoleId);
      await interaction.reply({ content: '✅ Correct! You\'re verified — welcome in.', ephemeral: true });
    } catch (err) {
      await interaction.reply({ content: 'Correct code, but I couldn\'t give you the role — I may be missing the Manage Roles permission.', ephemeral: true });
    }
    return;
  }

  session.attempts++;
  if (session.attempts >= config.maxAttempts) {
    verificationStore.clearCaptchaSession(interaction.user.id);
    await interaction.reply({ content: `❌ That's incorrect, and you've used all ${config.maxAttempts} attempts. Click **Verify** again to start over with a new code.`, ephemeral: true });
    return;
  }

  await interaction.reply({ content: `❌ That's not correct (attempt ${session.attempts}/${config.maxAttempts}). Click **Enter Code** on the original message to try again with the same code, or click **Verify** again for a fresh one.`, ephemeral: true });
}

// ---- Admin setup ----

function buildMethodRow() {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('verifysetup_method_oneclick').setLabel('One-Click').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('verifysetup_method_captcha').setLabel('CAPTCHA').setStyle(ButtonStyle.Secondary),
  );
}

function buildDifficultyRow() {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('verifysetup_difficulty_easy').setLabel('Easy').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('verifysetup_difficulty_medium').setLabel('Medium').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('verifysetup_difficulty_hard').setLabel('Hard').setStyle(ButtonStyle.Secondary),
  );
}

function buildRoleRow() {
  return new ActionRowBuilder().addComponents(
    new RoleSelectMenuBuilder().setCustomId('verifysetup_role').setPlaceholder('Role given once verified')
  );
}

async function handleSetupOverview(interaction) {
  const config = verificationStore.getConfig();
  const embed = new EmbedBuilder()
    .setTitle('Verification Setup')
    .setColor(0x5865F2)
    .setDescription(
      `**Method:** ${config.method === 'oneclick' ? 'One-Click' : 'CAPTCHA'}\n` +
      `**Difficulty:** ${config.difficulty} (only used if method is CAPTCHA)\n` +
      `**Verified role:** ${config.verifiedRoleId ? `<@&${config.verifiedRoleId}>` : 'Not set'}\n\n` +
      `Use the buttons/dropdown below to change any of these, then run /verify panel in the channel you want the panel posted to.`
    );

  await interaction.reply({ embeds: [embed], components: [buildMethodRow(), buildDifficultyRow(), buildRoleRow()], ephemeral: true });
}

async function handleSetupButton(interaction) {
  if (interaction.customId.startsWith('verifysetup_method_')) {
    const method = interaction.customId.replace('verifysetup_method_', '');
    verificationStore.setMethod(method);
    await interaction.reply({ content: `✅ Verification method set to **${method === 'oneclick' ? 'One-Click' : 'CAPTCHA'}**.`, ephemeral: true });
  } else if (interaction.customId.startsWith('verifysetup_difficulty_')) {
    const difficulty = interaction.customId.replace('verifysetup_difficulty_', '');
    verificationStore.setDifficulty(difficulty);
    await interaction.reply({ content: `✅ CAPTCHA difficulty set to **${difficulty}**.`, ephemeral: true });
  }
}

async function handleSetupRoleSelect(interaction) {
  const roleId = interaction.values[0];
  verificationStore.setVerifiedRole(roleId);
  await interaction.reply({ content: `✅ Verified role set to <@&${roleId}>.`, ephemeral: true });
}

async function handlePostPanel(interaction) {
  await interaction.channel.send({ embeds: [buildPanelEmbed()], components: [buildPanelRow()] });
  await interaction.reply({ content: '✅ Verification panel posted.', ephemeral: true });
}

module.exports = {
  buildPanelEmbed,
  buildPanelRow,
  handleVerifyStart,
  handleCaptchaAnswerButton,
  handleCaptchaModalSubmit,
  handleSetupOverview,
  handleSetupButton,
  handleSetupRoleSelect,
  handlePostPanel,
};
