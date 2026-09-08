// embedBuilder.js — An in-Discord embed creator, aiming for feature parity with
// Discohook's editor (title links, footer icons, timestamps, message content,
// JSON import/export, color presets) PLUS fully-functional interactive buttons
// (role toggle/add/remove, messages) that Discohook itself can't do, since
// Discohook only posts through webhooks and webhooks can't respond to clicks.
//
// Editing flow: one "What do you want to edit?" dropdown replaces a wall of
// same-looking buttons. Adding a button walks through: action → (role, if
// needed) → color → label/details — so a button's color is always an
// independent, explicit choice, never silently implied by its action type.

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
  StringSelectMenuBuilder,
  EmbedBuilder,
  AttachmentBuilder,
} = require('discord.js');

const MAX_BUTTONS = 5; // kept to one row for now
const SESSIONS_FILE = path.join(__dirname, 'embedSessions.json');

// Session shape:
// { content: '', embeds: [{title, description, url, color, timestamp, footer: {text, iconURL},
//     image, thumbnail, author, fields: []}], currentIndex: 0,
//   buttons: [{label, style, url, customId, emoji}],
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

function blankEmbedData() {
  return { fields: [] };
}

function getSession(userId) {
  if (!sessions.has(userId)) {
    sessions.set(userId, { content: '', embeds: [blankEmbedData()], currentIndex: 0, buttons: [], editingMessageId: null, editingChannelId: null });
  }
  const session = sessions.get(userId);
  if (session.content === undefined) session.content = ''; // migrate old sessions
  return session;
}

function clearSession(userId) {
  sessions.delete(userId);
  persist();
}

function currentEmbedData(session) {
  return session.embeds[session.currentIndex];
}

function newEmbed(session) {
  session.embeds.push(blankEmbedData());
  session.currentIndex = session.embeds.length - 1;
}

function removeCurrentEmbed(session) {
  if (session.embeds.length <= 1) {
    session.embeds[0] = blankEmbedData(); // just reset it instead of leaving zero embeds
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

// ---- Colors ----

const COLOR_PRESETS = [
  { label: 'Blurple', value: '5865F2' },
  { label: 'Green', value: '57F287' },
  { label: 'Red', value: 'ED4245' },
  { label: 'Yellow', value: 'FEE75C' },
  { label: 'Orange', value: 'E67E22' },
  { label: 'Purple', value: '9B59B6' },
  { label: 'White', value: 'FFFFFF' },
  { label: 'Black', value: '23272A' },
  { label: 'Random', value: 'RANDOM' },
];

function parseColor(colorStr) {
  if (!colorStr) return null;
  const hex = colorStr.trim().replace('#', '');
  if (!/^[0-9A-Fa-f]{6}$/.test(hex)) return null;
  return parseInt(hex, 16);
}

function randomColor() {
  return Math.floor(Math.random() * 0xFFFFFF);
}

// ---- Modal builders ----

function buildBasicsModal(embedData) {
  const modal = new ModalBuilder().setCustomId('embed_basics_modal').setTitle('Edit Basics');
  const titleInput = new TextInputBuilder().setCustomId('title').setLabel('Title').setStyle(TextInputStyle.Short).setRequired(false).setMaxLength(256);
  const urlInput = new TextInputBuilder().setCustomId('url').setLabel('Title URL (makes the title clickable)').setStyle(TextInputStyle.Short).setRequired(false);
  const descInput = new TextInputBuilder().setCustomId('description').setLabel('Description').setStyle(TextInputStyle.Paragraph).setRequired(false).setMaxLength(4000);
  const colorInput = new TextInputBuilder().setCustomId('color').setLabel('Color (hex, e.g. #5865F2)').setStyle(TextInputStyle.Short).setRequired(false).setMaxLength(7);

  if (embedData.title) titleInput.setValue(embedData.title);
  if (embedData.url) urlInput.setValue(embedData.url);
  if (embedData.description) descInput.setValue(embedData.description);
  if (embedData.color !== undefined && embedData.color !== null) colorInput.setValue(`#${embedData.color.toString(16).padStart(6, '0')}`);

  modal.addComponents(
    new ActionRowBuilder().addComponents(titleInput),
    new ActionRowBuilder().addComponents(urlInput),
    new ActionRowBuilder().addComponents(descInput),
    new ActionRowBuilder().addComponents(colorInput),
  );
  return modal;
}

function buildFooterModal(embedData) {
  const textInput = new TextInputBuilder().setCustomId('text').setLabel('Footer text').setStyle(TextInputStyle.Short).setRequired(false).setMaxLength(2048);
  const iconInput = new TextInputBuilder().setCustomId('iconURL').setLabel('Footer icon URL').setStyle(TextInputStyle.Short).setRequired(false);

  if (embedData.footer?.text) textInput.setValue(embedData.footer.text);
  if (embedData.footer?.iconURL) iconInput.setValue(embedData.footer.iconURL);

  return new ModalBuilder().setCustomId('embed_footer_modal').setTitle('Set Footer').addComponents(
    new ActionRowBuilder().addComponents(textInput),
    new ActionRowBuilder().addComponents(iconInput),
  );
}

function buildImageModal(embedData) {
  const input = new TextInputBuilder().setCustomId('image').setLabel('Image URL').setStyle(TextInputStyle.Short).setRequired(false);
  if (embedData.image) input.setValue(embedData.image);
  return new ModalBuilder().setCustomId('embed_image_modal').setTitle('Set Image').addComponents(new ActionRowBuilder().addComponents(input));
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

function buildAuthorModal(embedData) {
  const nameInput = new TextInputBuilder().setCustomId('name').setLabel('Author name').setStyle(TextInputStyle.Short).setRequired(false).setMaxLength(256);
  const iconInput = new TextInputBuilder().setCustomId('iconURL').setLabel('Author icon URL').setStyle(TextInputStyle.Short).setRequired(false);
  const urlInput = new TextInputBuilder().setCustomId('url').setLabel('Author link URL').setStyle(TextInputStyle.Short).setRequired(false);

  if (embedData.author?.name) nameInput.setValue(embedData.author.name);
  if (embedData.author?.iconURL) iconInput.setValue(embedData.author.iconURL);
  if (embedData.author?.url) urlInput.setValue(embedData.author.url);

  return new ModalBuilder().setCustomId('embed_author_modal').setTitle('Set Author').addComponents(
    new ActionRowBuilder().addComponents(nameInput),
    new ActionRowBuilder().addComponents(iconInput),
    new ActionRowBuilder().addComponents(urlInput),
  );
}

function buildThumbnailModal(embedData) {
  const input = new TextInputBuilder().setCustomId('thumbnail').setLabel('Thumbnail URL').setStyle(TextInputStyle.Short).setRequired(false);
  if (embedData.thumbnail) input.setValue(embedData.thumbnail);
  return new ModalBuilder().setCustomId('embed_thumbnail_modal').setTitle('Set Thumbnail').addComponents(new ActionRowBuilder().addComponents(input));
}

function buildContentModal(session) {
  const input = new TextInputBuilder().setCustomId('content').setLabel('Message text (shown above the embed)').setStyle(TextInputStyle.Paragraph).setRequired(false).setMaxLength(2000);
  if (session.content) input.setValue(session.content);
  return new ModalBuilder().setCustomId('embed_content_modal').setTitle('Message Content').addComponents(new ActionRowBuilder().addComponents(input));
}

function buildImportJsonModal() {
  return new ModalBuilder().setCustomId('embed_importjson_modal').setTitle('Import Embed JSON').addComponents(
    new ActionRowBuilder().addComponents(
      new TextInputBuilder().setCustomId('json').setLabel('Paste a Discord embed JSON object').setStyle(TextInputStyle.Paragraph).setRequired(true).setMaxLength(4000)
    )
  );
}

function buildRemoveButtonModal() {
  return new ModalBuilder()
    .setCustomId('embed_removebutton_modal')
    .setTitle('Remove a Button')
    .addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder().setCustomId('index').setLabel('Button number to remove (see preview)').setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(1)
      ),
    );
}

// Button "final details" modal — fields shown depend on the action, since a
// link button needs a URL but no message, a role button can have a custom
// confirmation but no URL, etc.
function buildButtonFinalModal(action) {
  const modal = new ModalBuilder().setCustomId(`embed_btn_final_modal_${action}`).setTitle('Button Details');
  const rows = [
    new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('label').setLabel('Button label').setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(80)),
  ];

  if (action === 'link') {
    rows.push(new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('url').setLabel('URL').setStyle(TextInputStyle.Short).setRequired(true)));
  } else if (action === 'message') {
    rows.push(new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('message').setLabel('Message shown on click').setStyle(TextInputStyle.Paragraph).setRequired(true).setMaxLength(1000)));
  } else if (['addrole', 'removerole', 'togglerole'].includes(action)) {
    rows.push(new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('message').setLabel('Custom confirmation message (optional)').setStyle(TextInputStyle.Paragraph).setRequired(false).setMaxLength(1000)));
  }
  // 'ticket' needs nothing beyond the label.

  rows.push(new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('emoji').setLabel('Emoji (optional, e.g. 🎉)').setStyle(TextInputStyle.Short).setRequired(false).setMaxLength(10)));

  modal.addComponents(...rows);
  return modal;
}

// ---- Preview / final building ----

function buildEmbedFromData(data) {
  const embed = new EmbedBuilder();

  if (data.title) embed.setTitle(data.title);
  if (data.url) embed.setURL(data.url);
  if (data.description) embed.setDescription(data.description);
  if (data.color !== undefined && data.color !== null) embed.setColor(data.color);
  if (data.footer?.text) embed.setFooter({ text: data.footer.text, iconURL: data.footer.iconURL || undefined });
  if (data.image) embed.setImage(data.image);
  if (data.thumbnail) embed.setThumbnail(data.thumbnail);
  if (data.author?.name) {
    embed.setAuthor({ name: data.author.name, iconURL: data.author.iconURL || undefined, url: data.author.url || undefined });
  }
  if (data.fields && data.fields.length > 0) embed.addFields(data.fields);
  if (data.timestamp) embed.setTimestamp();

  if (!data.title && !data.description && (!data.fields || data.fields.length === 0) && !data.image) {
    embed.setDescription('*(Empty embed — use the dropdown below to add content)*');
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

function isValidHttpUrl(str) {
  try {
    const u = new URL(str);
    return u.protocol === 'http:' || u.protocol === 'https:';
  } catch {
    return false;
  }
}

// Accepts either a raw role ID or a <@&123456789012345678> mention and
// returns the plain ID, or null if the input doesn't look like either.
function parseRoleId(str) {
  if (!str) return null;
  const trimmed = str.trim();
  const mentionMatch = trimmed.match(/^<@&(\d{15,25})>$/);
  if (mentionMatch) return mentionMatch[1];
  if (/^\d{15,25}$/.test(trimmed)) return trimmed;
  return null;
}

// Resolves a channel from typed input: a real mention (<#ID>), a raw ID, or
// an exact case-insensitive name match (with or without a leading #).
function resolveChannel(guild, str) {
  if (!str || !guild) return null;
  const trimmed = str.trim();

  const mentionMatch = trimmed.match(/^<#(\d{15,25})>$/);
  if (mentionMatch) return guild.channels.cache.get(mentionMatch[1]) || null;

  if (/^\d{15,25}$/.test(trimmed)) return guild.channels.cache.get(trimmed) || null;

  const nameOnly = trimmed.replace(/^#/, '').toLowerCase();
  if (!nameOnly) return null;
  return guild.channels.cache.find(c => c.name && c.name.toLowerCase() === nameOnly) || null;
}

// Resolves a role from whatever the person typed in a modal text box, where
// Discord doesn't offer live @mention autocomplete the way the chat box does.
function resolveRole(guild, str) {
  if (!str || !guild) return null;
  const trimmed = str.trim();

  const id = parseRoleId(trimmed);
  if (id) return guild.roles.cache.get(id) || null;

  const nameOnly = trimmed.replace(/^@/, '').toLowerCase();
  if (!nameOnly) return null;
  return guild.roles.cache.find(r => r.name.toLowerCase() === nameOnly) || null;
}

// ---- Main "what do you want to edit?" menu ----

function buildEditMenuRow() {
  return new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder().setCustomId('embed_edit_menu').setPlaceholder('What do you want to edit?').addOptions(
      { label: 'Basics', value: 'basics', description: 'Title, title URL, description, color', emoji: '📝' },
      { label: 'Quick Color', value: 'quickcolor', description: 'Pick a preset color instead of typing hex', emoji: '🎨' },
      { label: 'Footer', value: 'footer', description: 'Footer text and icon', emoji: '📄' },
      { label: 'Image', value: 'image', description: 'Large image', emoji: '🖼️' },
      { label: 'Thumbnail', value: 'thumbnail', description: 'Small corner image', emoji: '🖼️' },
      { label: 'Author', value: 'author', description: 'Author name, icon, and link', emoji: '👤' },
      { label: 'Add Field', value: 'addfield', description: 'Add a name/value field', emoji: '➕' },
      { label: 'Remove Field', value: 'removefield', description: 'Remove a field by number', emoji: '➖' },
      { label: 'Toggle Timestamp', value: 'timestamp', description: 'Show the current time on the embed', emoji: '🕐' },
      { label: 'Message Content', value: 'content', description: 'Plain text shown above the embed(s)', emoji: '💬' },
      { label: 'Import JSON', value: 'importjson', description: 'Paste a raw embed JSON object', emoji: '📥' },
      { label: 'Export JSON', value: 'exportjson', description: 'Get this embed as JSON', emoji: '📤' },
    )
  );
}

function buildNavRow(session) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('embed_newembed_button').setLabel('New Embed').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('embed_prevembed_button').setLabel('◀ Prev').setStyle(ButtonStyle.Secondary).setDisabled(session.currentIndex === 0),
    new ButtonBuilder().setCustomId('embed_nextembed_button').setLabel('Next ▶').setStyle(ButtonStyle.Secondary).setDisabled(session.currentIndex === session.embeds.length - 1),
    new ButtonBuilder().setCustomId('embed_removeembed_button').setLabel('Remove Embed').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('embed_managebuttons_button').setLabel('Manage Buttons').setStyle(ButtonStyle.Secondary),
  );
}

function buildActionRow(session) {
  const editing = !!session.editingMessageId;
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('embed_send_button').setLabel(editing ? 'Save Changes' : 'Send').setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId('embed_cancel_button').setLabel('Cancel').setStyle(ButtonStyle.Danger),
  );
}

function buildControlRows(session) {
  const rows = [buildEditMenuRow(), buildNavRow(session), buildActionRow(session)];

  // Show the actual buttons being built too, so the preview matches what will really be sent/saved.
  const liveButtonsRow = buildButtonsRow(session);
  if (liveButtonsRow) rows.push(liveButtonsRow);

  return rows;
}

function buildManageButtonsRows(session) {
  return [new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('embed_addbutton_button').setLabel('Add Button').setStyle(ButtonStyle.Success).setDisabled(session.buttons.length >= MAX_BUTTONS),
    new ButtonBuilder().setCustomId('embed_removebutton_button').setLabel('Remove Button').setStyle(ButtonStyle.Danger).setDisabled(session.buttons.length === 0),
  )];
}

function buildButtonActionSelectRow() {
  return new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder().setCustomId('embed_btn_action_select').setPlaceholder('What should this button do?').addOptions(
      { label: 'Link to a URL', value: 'link', emoji: '🔗' },
      { label: 'Give a Role', value: 'addrole', emoji: '➕' },
      { label: 'Remove a Role', value: 'removerole', emoji: '➖' },
      { label: 'Toggle a Role', value: 'togglerole', emoji: '🔄' },
      { label: 'Send a Message', value: 'message', emoji: '💬' },
      { label: 'Open a Ticket', value: 'ticket', emoji: '🎫' },
    )
  );
}

function buildButtonColorSelectRow(action, roleId) {
  const suffix = roleId ? `${action}_${roleId}` : action;
  return new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder().setCustomId(`embed_btn_color_select_${suffix}`).setPlaceholder('Pick a button color').addOptions(
      { label: 'Blurple', value: 'Primary', emoji: '🔵' },
      { label: 'Grey', value: 'Secondary', emoji: '⚪' },
      { label: 'Green', value: 'Success', emoji: '🟢' },
      { label: 'Red', value: 'Danger', emoji: '🔴' },
    )
  );
}

function buildColorPresetSelectRow() {
  return new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder().setCustomId('embed_quickcolor_select').setPlaceholder('Pick a color').addOptions(
      COLOR_PRESETS.map(c => ({ label: c.label, value: c.value }))
    )
  );
}

function previewContent(session) {
  const mode = session.editingMessageId ? `Editing message \`${session.editingMessageId}\`` : 'Creating a new message';
  return `**${mode}** — Embed ${session.currentIndex + 1} of ${session.embeds.length}. Buttons on message: ${session.buttons.length}/${MAX_BUTTONS}.`;
}

// Loads an already-sent message (must be sent by the bot) into a session for editing.
function loadMessageIntoSession(session, message) {
  const embeds = message.embeds.map(e => ({
    title: e.title || undefined,
    url: e.url || undefined,
    description: e.description || undefined,
    color: e.color !== null ? e.color : undefined,
    footer: e.footer ? { text: e.footer.text, iconURL: e.footer.iconURL } : undefined,
    image: e.image ? e.image.url : undefined,
    thumbnail: e.thumbnail ? e.thumbnail.url : undefined,
    author: e.author ? { name: e.author.name, iconURL: e.author.iconURL, url: e.author.url } : undefined,
    fields: e.fields ? e.fields.map(f => ({ name: f.name, value: f.value, inline: f.inline })) : [],
    timestamp: !!e.timestamp,
  }));

  session.content = message.content || '';
  session.embeds = embeds.length > 0 ? embeds : [blankEmbedData()];
  session.currentIndex = 0;

  session.buttons = [];
  for (const row of message.components) {
    for (const comp of row.components) {
      if (comp.style === ButtonStyle.Link) {
        session.buttons.push({ label: comp.label, style: ButtonStyle.Link, url: comp.url, emoji: comp.emoji ? comp.emoji.name : undefined });
      } else if (comp.customId) {
        // Preserve ANY non-link button, not just ones this tool generated (userbtn_*).
        // That includes fixed-ID buttons like ticket_button — without this,
        // they'd silently vanish the moment the message is loaded into an edit session.
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

// ---- JSON import/export (Discohook/Discord API-compatible embed JSON) ----

function embedDataToApiJson(data) {
  const obj = {};
  if (data.title) obj.title = data.title;
  if (data.url) obj.url = data.url;
  if (data.description) obj.description = data.description;
  if (data.color !== undefined && data.color !== null) obj.color = data.color;
  if (data.footer?.text) obj.footer = { text: data.footer.text, ...(data.footer.iconURL ? { icon_url: data.footer.iconURL } : {}) };
  if (data.image) obj.image = { url: data.image };
  if (data.thumbnail) obj.thumbnail = { url: data.thumbnail };
  if (data.author?.name) {
    obj.author = { name: data.author.name, ...(data.author.iconURL ? { icon_url: data.author.iconURL } : {}), ...(data.author.url ? { url: data.author.url } : {}) };
  }
  if (data.fields?.length > 0) obj.fields = data.fields.map(f => ({ name: f.name, value: f.value, inline: !!f.inline }));
  if (data.timestamp) obj.timestamp = new Date().toISOString();
  return obj;
}

// Returns { data, error }. On success, data is ready to drop into session.embeds[i].
function apiJsonToEmbedData(jsonStr) {
  let parsed;
  try {
    parsed = JSON.parse(jsonStr);
  } catch (err) {
    return { data: null, error: `That's not valid JSON: ${err.message}` };
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return { data: null, error: 'Expected a single embed JSON object, e.g. { "title": "...", ... }' };
  }

  const data = { fields: [] };
  if (typeof parsed.title === 'string') data.title = parsed.title;
  if (typeof parsed.url === 'string') data.url = parsed.url;
  if (typeof parsed.description === 'string') data.description = parsed.description;
  if (typeof parsed.color === 'number') data.color = parsed.color;
  if (parsed.footer?.text) data.footer = { text: parsed.footer.text, iconURL: parsed.footer.icon_url };
  if (parsed.image?.url) data.image = parsed.image.url;
  if (parsed.thumbnail?.url) data.thumbnail = parsed.thumbnail.url;
  if (parsed.author?.name) data.author = { name: parsed.author.name, iconURL: parsed.author.icon_url, url: parsed.author.url };
  if (Array.isArray(parsed.fields)) {
    data.fields = parsed.fields.slice(0, 25).map(f => ({ name: String(f.name || '').slice(0, 256), value: String(f.value || '').slice(0, 1024), inline: !!f.inline }));
  }
  if (parsed.timestamp) data.timestamp = true;

  return { data, error: null };
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
  buildFooterModal,
  buildImageModal,
  buildFieldModal,
  buildRemoveFieldModal,
  buildRemoveButtonModal,
  buildAuthorModal,
  buildThumbnailModal,
  buildContentModal,
  buildImportJsonModal,
  buildButtonFinalModal,
  buildEmbedFromData,
  buildAllEmbeds,
  buildButtonsRow,
  buildControlRows,
  buildManageButtonsRows,
  buildButtonActionSelectRow,
  buildButtonColorSelectRow,
  buildColorPresetSelectRow,
  previewContent,
  parseColor,
  randomColor,
  COLOR_PRESETS,
  isValidHttpUrl,
  parseRoleId,
  resolveRole,
  resolveChannel,
  loadMessageIntoSession,
  genButtonId,
  embedDataToApiJson,
  apiJsonToEmbedData,
  MAX_BUTTONS,
};
