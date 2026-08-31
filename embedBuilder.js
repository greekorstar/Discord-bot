// embedBuilder.js — An in-Discord embed creator, similar to Discohook's embed builder.
// Flow: /embed opens a modal for the basics -> preview message with buttons ->
// buttons open more modals (field, author, thumbnail) or send/cancel.

const {
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
} = require('discord.js');

// Holds in-progress embed data per user. Key: userId. Value: { title, description, color, footer, image, author: {name, iconURL, url}, thumbnail, fields: [] }
const sessions = new Map();

function getSession(userId) {
  if (!sessions.has(userId)) {
    sessions.set(userId, { fields: [] });
  }
  return sessions.get(userId);
}

function clearSession(userId) {
  sessions.delete(userId);
}

// ---- Modal builders ----

function buildInitialModal() {
  return new ModalBuilder()
    .setCustomId('embed_initial_modal')
    .setTitle('Create an Embed — Basics')
    .addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder().setCustomId('title').setLabel('Title').setStyle(TextInputStyle.Short).setRequired(false).setMaxLength(256)
      ),
      new ActionRowBuilder().addComponents(
        new TextInputBuilder().setCustomId('description').setLabel('Description').setStyle(TextInputStyle.Paragraph).setRequired(false).setMaxLength(4000)
      ),
      new ActionRowBuilder().addComponents(
        new TextInputBuilder().setCustomId('color').setLabel('Color (hex, e.g. #5865F2)').setStyle(TextInputStyle.Short).setRequired(false).setMaxLength(7)
      ),
      new ActionRowBuilder().addComponents(
        new TextInputBuilder().setCustomId('footer').setLabel('Footer text').setStyle(TextInputStyle.Short).setRequired(false).setMaxLength(2048)
      ),
      new ActionRowBuilder().addComponents(
        new TextInputBuilder().setCustomId('image').setLabel('Image URL').setStyle(TextInputStyle.Short).setRequired(false)
      ),
    );
}

function buildFieldModal() {
  return new ModalBuilder()
    .setCustomId('embed_addfield_modal')
    .setTitle('Add a Field')
    .addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder().setCustomId('name').setLabel('Field name').setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(256)
      ),
      new ActionRowBuilder().addComponents(
        new TextInputBuilder().setCustomId('value').setLabel('Field value').setStyle(TextInputStyle.Paragraph).setRequired(true).setMaxLength(1024)
      ),
      new ActionRowBuilder().addComponents(
        new TextInputBuilder().setCustomId('inline').setLabel('Inline? (yes/no)').setStyle(TextInputStyle.Short).setRequired(false).setMaxLength(3)
      ),
    );
}

function buildAuthorModal() {
  return new ModalBuilder()
    .setCustomId('embed_author_modal')
    .setTitle('Set Author')
    .addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder().setCustomId('name').setLabel('Author name').setStyle(TextInputStyle.Short).setRequired(false).setMaxLength(256)
      ),
      new ActionRowBuilder().addComponents(
        new TextInputBuilder().setCustomId('iconURL').setLabel('Author icon URL').setStyle(TextInputStyle.Short).setRequired(false)
      ),
      new ActionRowBuilder().addComponents(
        new TextInputBuilder().setCustomId('url').setLabel('Author link URL').setStyle(TextInputStyle.Short).setRequired(false)
      ),
    );
}

function buildThumbnailModal() {
  return new ModalBuilder()
    .setCustomId('embed_thumbnail_modal')
    .setTitle('Set Thumbnail')
    .addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder().setCustomId('thumbnail').setLabel('Thumbnail URL').setStyle(TextInputStyle.Short).setRequired(true)
      ),
    );
}

// ---- Preview building ----

function parseColor(colorStr) {
  if (!colorStr) return null;
  const hex = colorStr.trim().replace('#', '');
  if (!/^[0-9A-Fa-f]{6}$/.test(hex)) return null;
  return parseInt(hex, 16);
}

function buildEmbedFromSession(session) {
  const embed = new EmbedBuilder();

  if (session.title) embed.setTitle(session.title);
  if (session.description) embed.setDescription(session.description);
  if (session.color !== undefined && session.color !== null) embed.setColor(session.color);
  if (session.footer) embed.setFooter({ text: session.footer });
  if (session.image) embed.setImage(session.image);
  if (session.thumbnail) embed.setThumbnail(session.thumbnail);
  if (session.author && session.author.name) {
    embed.setAuthor({
      name: session.author.name,
      iconURL: session.author.iconURL || undefined,
      url: session.author.url || undefined,
    });
  }
  if (session.fields.length > 0) embed.addFields(session.fields);

  // Discord requires an embed to have at least one of these set
  if (!session.title && !session.description && session.fields.length === 0 && !session.image) {
    embed.setDescription('*(Empty embed — add a title, description, field, or image)*');
  }

  return embed;
}

function buildControlRows() {
  const row1 = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('embed_addfield_button').setLabel('Add Field').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('embed_author_button').setLabel('Set Author').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('embed_thumbnail_button').setLabel('Set Thumbnail').setStyle(ButtonStyle.Secondary),
  );
  const row2 = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('embed_send_button').setLabel('Send').setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId('embed_cancel_button').setLabel('Cancel').setStyle(ButtonStyle.Danger),
  );
  return [row1, row2];
}

module.exports = {
  getSession,
  clearSession,
  buildInitialModal,
  buildFieldModal,
  buildAuthorModal,
  buildThumbnailModal,
  buildEmbedFromSession,
  buildControlRows,
  parseColor,
};
