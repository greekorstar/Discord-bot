// embedBuilder.js — An in-Discord embed creator, similar to Discohook's embed builder.
// Supports: multiple embeds per message, editing an already-sent message,
// and adding buttons (link buttons, or buttons that reply with preset text).

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const {
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
} = require('discord.js');

const MAX_BUTTONS = 5; // kept to one row for now
const SESSIONS_FILE = path.join(__dirname, 'embedSessions.json');

// Session shape:
// { embeds: [{title, description, color, footer, image, thumbnail, author, fields: []}],
//   currentIndex: 0, buttons: [{label, style, url, customId, emoji}],
//   editingMessageId: null, editingChannelId: null }
let sessions = new Map();

function loadSessions() {
  try {
    const raw = fs.readFileSync(SESSIONS_FILE, 'utf8');
    sessions = new Map(JSON.parse(raw));
  } catch (err) {
    sessions = new Map(); // file doesn't exist yet, or is corrupt — start fresh
  }
}

function persist() {
  try {
    fs.writeFileSync(SESSIONS_FILE, JSON.stringify(Array.from(sessions.entries()), null, 2));
  } catch (err) {
    console.error('[embedBuilder] Failed to save embedSessions.json:', err.message);
  }
}

loadSessions(); // pick up any in-progress sessions saved before the last restart

function getSession(userId) {
  if (!sessions.has(userId)) {
    sessions.set(userId, { embeds: [{ fields: [] }], currentIndex: 0, buttons: [], editingMessageId: null, editingChannelId: null });
  }
  return sessions.get(userId);
}

function clearSession(userId) {
  sessions.delete(userId);
  persist();
}

function currentEmbedData(session) {
  return session.embeds[session.currentIndex];
}

function newEmbed(session) {
  session.embeds.push({ fields: [] });
  session.currentIndex = session.embeds.length - 1;
}

function removeCurrentEmbed(session) {
  if (session.embeds.length <= 1) {
    session.embeds[0] = { fields: [] }; // just reset it instead of leaving zero embeds
    return;
  }
  session.embeds.splice(session.currentIndex, 1);
  if (session.currentIndex >= session.embeds.length) {
    session.currentIndex = session.embeds.length - 1;
  }
}

function switchEmbed(session, direction) {
  const newIndex = session.currentIndex + direction;
  if (newIndex >= 0 && newIndex < session.embeds.length) {
    session.currentIndex = newIndex;
  }
}

// ---- Modal builders ----

function buildBasicsModal(embedData) {
  const modal = new ModalBuilder().setCustomId('embed_basics_modal').setTitle('Edit Embed Basics');
  const titleInput = new TextInputBuilder().setCustomId('title').setLabel('Title').setStyle(TextInputStyle.Short).setRequired(false).setMaxLength(256);
  const descInput = new TextInputBuilder().setCustomId('description').setLabel('Description').setStyle(TextInputStyle.Paragraph).setRequired(false).setMaxLength(4000);
  const colorInput = new TextInputBuilder().setCustomId('color').setLabel('Color (hex, e.g. #5865F2)').setStyle(TextInputStyle.Short).setRequired(false).setMaxLength(7);
  const footerInput = new TextInputBuilder().setCustomId('footer').setLabel('Footer text').setStyle(TextInputStyle.Short).setRequired(false).setMaxLength(2048);
  const imageInput = new TextInputBuilder().setCustomId('image').setLabel('Image URL').setStyle(TextInputStyle.Short).setRequired(false);

  if (embedData.title) titleInput.setValue(embedData.title);
  if (embedData.description) descInput.setValue(embedData.description);
  if (embedData.color !== undefined && embedData.color !== null) colorInput.setValue(`#${embedData.color.toString(16).padStart(6, '0')}`);
  if (embedData.footer) footerInput.setValue(embedData.footer);
  if (embedData.image) imageInput.setValue(embedData.image);

  modal.addComponents(
    new ActionRowBuilder().addComponents(titleInput),
    new ActionRowBuilder().addComponents(descInput),
    new ActionRowBuilder().addComponents(colorInput),
    new ActionRowBuilder().addComponents(footerInput),
    new ActionRowBuilder().addComponents(imageInput),
  );
  return modal;
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

function buildRemoveFieldModal() {
  return new ModalBuilder()
    .setCustomId('embed_removefield_modal')
    .setTitle('Remove a Field')
    .addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder().setCustomId('index').setLabel('Field number to remove (see preview)').setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(3)
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

function buildAddButtonModal() {
  return new ModalBuilder()
    .setCustomId('embed_addbutton_modal')
    .setTitle('Add a Button')
    .addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder().setCustomId('label').setLabel('Button label').setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(80)
      ),
      new ActionRowBuilder().addComponents(
        new TextInputBuilder().setCustomId('style').setLabel('Style: link / primary / secondary / success / danger').setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(20)
      ),
      new ActionRowBuilder().addComponents(
        new TextInputBuilder().setCustomId('url').setLabel('URL (only needed for "link" style)').setStyle(TextInputStyle.Short).setRequired(false)
      ),
      new ActionRowBuilder().addComponents(
        new TextInputBuilder().setCustomId('replyText').setLabel('Reply text (ignored for "link" style)').setStyle(TextInputStyle.Paragraph).setRequired(false).setMaxLength(1000)
      ),
      new ActionRowBuilder().addComponents(
        new TextInputBuilder().setCustomId('emoji').setLabel('Emoji (optional, e.g. 🎉)').setStyle(TextInputStyle.Short).setRequired(false).setMaxLength(10)
      ),
    );
}

// ---- Preview / final building ----

function parseColor(colorStr) {
  if (!colorStr) return null;
  const hex = colorStr.trim().replace('#', '');
  if (!/^[0-9A-Fa-f]{6}$/.test(hex)) return null;
  return parseInt(hex, 16);
}

function buildEmbedFromData(data) {
  const embed = new EmbedBuilder();

  if (data.title) embed.setTitle(data.title);
  if (data.description) embed.setDescription(data.description);
  if (data.color !== undefined && data.color !== null) embed.setColor(data.color);
  if (data.footer) embed.setFooter({ text: data.footer });
  if (data.image) embed.setImage(data.image);
  if (data.thumbnail) embed.setThumbnail(data.thumbnail);
  if (data.author && data.author.name) {
    embed.setAuthor({ name: data.author.name, iconURL: data.author.iconURL || undefined, url: data.author.url || undefined });
  }
  if (data.fields && data.fields.length > 0) embed.addFields(data.fields);

  if (!data.title && !data.description && (!data.fields || data.fields.length === 0) && !data.image) {
    embed.setDescription('*(Empty embed — use Edit Basics, Add Field, etc.)*');
  }

  return embed;
}

function buildAllEmbeds(session) {
  return session.embeds.map(buildEmbedFromData);
}

function buildButtonsRow(session) {
  if (session.buttons.length === 0) return null;
  const row = new ActionRowBuilder();
  for (const btn of session.buttons) {
    const b = new ButtonBuilder().setLabel(btn.label).setStyle(btn.style);
    if (btn.style === ButtonStyle.Link) {
      b.setURL(btn.url);
    } else {
      b.setCustomId(btn.customId);
    }
    if (btn.emoji) b.setEmoji(btn.emoji);
    row.addComponents(b);
  }
  return row;
}

function styleFromString(str) {
  const s = (str || '').trim().toLowerCase();
  if (s === 'link') return ButtonStyle.Link;
  if (s === 'primary') return ButtonStyle.Primary;
  if (s === 'success') return ButtonStyle.Success;
  if (s === 'danger') return ButtonStyle.Danger;
  if (s === 'secondary') return ButtonStyle.Secondary;
  return null;
}

function isValidHttpUrl(str) {
  try {
    const u = new URL(str);
    return u.protocol === 'http:' || u.protocol === 'https:';
  } catch {
    return false;
  }
}

function buildControlRows(session) {
  const editing = !!session.editingMessageId;

  const row1 = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('embed_editbasics_button').setLabel('Edit Basics').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('embed_addfield_button').setLabel('Add Field').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('embed_removefield_button').setLabel('Remove Field').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('embed_author_button').setLabel('Set Author').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('embed_thumbnail_button').setLabel('Set Thumbnail').setStyle(ButtonStyle.Secondary),
  );

  const row2 = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('embed_newembed_button').setLabel('New Embed').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('embed_prevembed_button').setLabel('◀ Prev Embed').setStyle(ButtonStyle.Secondary).setDisabled(session.currentIndex === 0),
    new ButtonBuilder().setCustomId('embed_nextembed_button').setLabel('Next Embed ▶').setStyle(ButtonStyle.Secondary).setDisabled(session.currentIndex === session.embeds.length - 1),
    new ButtonBuilder().setCustomId('embed_removeembed_button').setLabel('Remove Embed').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('embed_addbutton_button').setLabel('Add Button').setStyle(ButtonStyle.Secondary).setDisabled(session.buttons.length >= MAX_BUTTONS),
  );

  const row3 = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('embed_send_button').setLabel(editing ? 'Save Changes' : 'Send').setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId('embed_cancel_button').setLabel('Cancel').setStyle(ButtonStyle.Danger),
  );

  return [row1, row2, row3];
}

function previewContent(session) {
  const mode = session.editingMessageId ? `Editing message \`${session.editingMessageId}\`` : 'Creating a new message';
  return `**${mode}** — Embed ${session.currentIndex + 1} of ${session.embeds.length}. Buttons on message: ${session.buttons.length}/${MAX_BUTTONS}.`;
}

// Loads an already-sent message (must be sent by the bot) into a session for editing.
function loadMessageIntoSession(session, message) {
  const embeds = message.embeds.map(e => ({
    title: e.title || undefined,
    description: e.description || undefined,
    color: e.color !== null ? e.color : undefined,
    footer: e.footer ? e.footer.text : undefined,
    image: e.image ? e.image.url : undefined,
    thumbnail: e.thumbnail ? e.thumbnail.url : undefined,
    author: e.author ? { name: e.author.name, iconURL: e.author.iconURL, url: e.author.url } : undefined,
    fields: e.fields ? e.fields.map(f => ({ name: f.name, value: f.value, inline: f.inline })) : [],
  }));

  session.embeds = embeds.length > 0 ? embeds : [{ fields: [] }];
  session.currentIndex = 0;

  session.buttons = [];
  for (const row of message.components) {
    for (const comp of row.components) {
      if (comp.style === ButtonStyle.Link) {
        session.buttons.push({ label: comp.label, style: ButtonStyle.Link, url: comp.url, emoji: comp.emoji ? comp.emoji.name : undefined });
      } else if (comp.customId && comp.customId.startsWith('userbtn_')) {
        session.buttons.push({ label: comp.label, style: comp.style, customId: comp.customId, emoji: comp.emoji ? comp.emoji.name : undefined });
      }
    }
  }

  session.editingMessageId = message.id;
  session.editingChannelId = message.channel.id;
}

function genButtonId() {
  return `userbtn_${crypto.randomBytes(4).toString('hex')}`;
}

module.exports = {
  getSession,
  clearSession,
  persist,
  currentEmbedData,
  newEmbed,
  removeCurrentEmbed,
  switchEmbed,
  buildBasicsModal,
  buildFieldModal,
  buildRemoveFieldModal,
  buildAuthorModal,
  buildThumbnailModal,
  buildAddButtonModal,
  buildEmbedFromData,
  buildAllEmbeds,
  buildButtonsRow,
  buildControlRows,
  previewContent,
  parseColor,
  styleFromString,
  isValidHttpUrl,
  loadMessageIntoSession,
  genButtonId,
  MAX_BUTTONS,
};
