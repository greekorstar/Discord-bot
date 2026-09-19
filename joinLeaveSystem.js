// joinLeaveSystem.js — Fills in placeholders for join/leave message templates,
// and builds the actual embed sent for each, including a designed banner
// graphic (member's avatar front-and-center) via @napi-rs/canvas — same
// optional dependency used for level rank cards. Falls back to a plain
// thumbnail-based embed automatically if that package isn't installed.
//
// One honest platform limit: Discord's embed layout is fixed — author, then
// title, then description, then fields, then image, then footer, in that
// exact order, always. There's no way to render an image ABOVE the
// description text; "image" always renders last. So the banner below can't
// sit literally above every pixel of text — but it IS the dominant visual
// element (not a small side thumbnail), and the avatar is also referenced
// at the very top via the embed author line.
//
// Available placeholders (used in config.js under joinLeaveSystem.joinMessage / leaveMessage):
//   {user}        - mentions the member (e.g. @Username)
//   {username}    - their username as plain text (no mention/ping)
//   {server}      - the server's name
//   {memberCount} - the server's current member count
//   {date}        - the date/time they joined (or left), formatted for Discord
//   {inviter}     - @-mentions whoever invited them, or "Unknown" if it couldn't be
//                    determined (vanity URL joins, or the bot lacking permission)
//   {inviterTag}  - the same person's tag as plain text (e.g. SomePerson#0001), no ping
//   {inviteCode}  - the invite code they used, or "Unknown"
//   {inviteUses}  - how many times that ONE invite code has now been used
//   {inviteCount} - the inviter's TOTAL uses across all of their invite links combined,
//                    or "Unknown" if it couldn't be determined

const path = require('path');
const { EmbedBuilder, AttachmentBuilder } = require('discord.js');

let canvasLib = null;
try {
  canvasLib = require('@napi-rs/canvas');
} catch {
  canvasLib = null; // fine — buildBanner() below falls back to a plain thumbnail embed
}

// Same bundled-font fix as photoCard.js: @napi-rs/canvas has zero system font
// dependencies, so plain `sans-serif` silently renders no glyphs at all on a
// bare host (Railway, Docker, etc.) — measureText() "works" but fillText()
// draws nothing. Registering our own bundled font under a known family name
// guarantees the caption text actually shows up, everywhere.
const FONT_FAMILY = 'CardFont';
let fontsReady = false;
if (canvasLib?.GlobalFonts) {
  try {
    canvasLib.GlobalFonts.registerFromPath(path.join(__dirname, 'fonts', 'CardFont-Regular.ttf'), FONT_FAMILY);
    canvasLib.GlobalFonts.registerFromPath(path.join(__dirname, 'fonts', 'CardFont-Bold.ttf'), FONT_FAMILY);
    fontsReady = canvasLib.GlobalFonts.has(FONT_FAMILY);
  } catch (err) {
    console.error('[joinLeaveSystem] Failed to register bundled font, caption may not render:', err.message);
  }
}
const FONT_STACK = fontsReady ? `"${FONT_FAMILY}", sans-serif` : 'sans-serif';

// Same defensive fetch as photoCard.js: a real User-Agent (some hosts/CDNs
// are stricter about UA-less requests) plus a timeout so a hanging avatar
// fetch can't hang the whole join/leave event.
async function fetchImageBuffer(url) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10_000);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; DiscordBotCardGenerator/1.0)' },
    });
    if (!res.ok) throw new Error(`Could not fetch the avatar (status ${res.status})`);
    return Buffer.from(await res.arrayBuffer());
  } finally {
    clearTimeout(timeout);
  }
}

function fillPlaceholders(template, member, inviteInfo) {
  const guild = member.guild;
  const joinTimestamp = member.joinedTimestamp || Date.now();

  return template
    .replaceAll('{user}', `<@${member.id}>`)
    .replaceAll('{username}', member.user.username)
    .replaceAll('{server}', guild.name)
    .replaceAll('{memberCount}', `${guild.memberCount}`)
    .replaceAll('{date}', `<t:${Math.floor(joinTimestamp / 1000)}:F>`)
    .replaceAll('{inviter}', inviteInfo && inviteInfo.inviterId ? `<@${inviteInfo.inviterId}>` : 'Unknown')
    .replaceAll('{inviterTag}', inviteInfo ? inviteInfo.inviterTag : 'Unknown')
    .replaceAll('{inviteCode}', inviteInfo ? inviteInfo.code : 'Unknown')
    .replaceAll('{inviteUses}', inviteInfo ? `${inviteInfo.uses}` : 'Unknown')
    .replaceAll('{inviteCount}', inviteInfo && inviteInfo.totalInviterUses !== null && inviteInfo.totalInviterUses !== undefined ? `${inviteInfo.totalInviterUses}` : 'Unknown');
}

// Renders a deliberately-designed banner: dark two-tone background (not a
// generic purple/pink gradient), a couple of thin angled accent lines for
// texture, a circular avatar with a colored ring, and a short caption below
// it — kind === 'join' | 'leave' picks the accent color and caption verb.
async function buildBanner(member, kind) {
  if (!canvasLib) return null;

  try {
    const { createCanvas, loadImage } = canvasLib;
    const width = 900, height = 300;
    const canvas = createCanvas(width, height);
    const ctx = canvas.getContext('2d');

    const accent = kind === 'join' ? '#57F287' : '#ED4245';
    const bgTop = '#1E2124';
    const bgBottom = '#15171A';

    // Background: vertical two-tone, not a rainbow gradient
    const bgGrad = ctx.createLinearGradient(0, 0, 0, height);
    bgGrad.addColorStop(0, bgTop);
    bgGrad.addColorStop(1, bgBottom);
    ctx.fillStyle = bgGrad;
    ctx.fillRect(0, 0, width, height);

    // A few thin angled accent lines in the corner, low opacity, for texture
    ctx.strokeStyle = accent;
    ctx.globalAlpha = 0.15;
    ctx.lineWidth = 3;
    for (let i = 0; i < 5; i++) {
      ctx.beginPath();
      ctx.moveTo(width - 40 - i * 30, 0);
      ctx.lineTo(width - 200 - i * 30, height);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;

    // Avatar, centered, with a colored ring
    const avatarUrl = member.user.displayAvatarURL({ extension: 'png', size: 256 });
    const avatarBuf = await fetchImageBuffer(avatarUrl);
    const avatarImg = await loadImage(avatarBuf);

    const avatarSize = 110;
    const cx = width / 2, cy = 95;

    ctx.beginPath();
    ctx.arc(cx, cy, avatarSize / 2 + 6, 0, Math.PI * 2);
    ctx.fillStyle = accent;
    ctx.fill();

    ctx.save();
    ctx.beginPath();
    ctx.arc(cx, cy, avatarSize / 2, 0, Math.PI * 2);
    ctx.closePath();
    ctx.clip();
    ctx.drawImage(avatarImg, cx - avatarSize / 2, cy - avatarSize / 2, avatarSize, avatarSize);
    ctx.restore();

    // Caption
    ctx.textAlign = 'center';
    ctx.fillStyle = '#FFFFFF';
    ctx.font = `bold 34px ${FONT_STACK}`;
    ctx.fillText(kind === 'join' ? 'WELCOME' : 'GOODBYE', cx, 210);

    ctx.font = `22px ${FONT_STACK}`;
    ctx.fillStyle = '#B9BBBE';
    ctx.fillText(member.user.username, cx, 245);

    // Thin divider
    ctx.strokeStyle = accent;
    ctx.globalAlpha = 0.6;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(cx - 60, 262);
    ctx.lineTo(cx + 60, 262);
    ctx.stroke();
    ctx.globalAlpha = 1;

    const buffer = canvas.toBuffer('image/png');
    return new AttachmentBuilder(buffer, { name: `${kind}-banner.png` });
  } catch (err) {
    console.error('[joinLeaveSystem] Banner render failed, falling back to thumbnail embed:', err.message);
    return null;
  }
}

// Builds a ready-to-send { embeds, files? } payload. The avatar is referenced
// at the top via the embed author line either way; when the optional canvas
// package is installed, a designed banner (avatar front-and-center) is
// attached as the embed's image too — otherwise it falls back to a plain
// thumbnail so nothing breaks if that dependency isn't set up.
async function buildJoinLeavePayload(template, member, inviteInfo, kind) {
  const text = fillPlaceholders(template, member, inviteInfo);
  const avatarUrl = member.user.displayAvatarURL({ extension: 'png', size: 256 });
  const accentColor = kind === 'join' ? 0x57F287 : 0xED4245;

  const embed = new EmbedBuilder()
    .setAuthor({ name: kind === 'join' ? `Welcome to ${member.guild.name}!` : `Leaving ${member.guild.name}`, iconURL: avatarUrl })
    .setDescription(text)
    .setColor(accentColor)
    .setTimestamp();

  const banner = await buildBanner(member, kind);
  if (banner) {
    embed.setImage(`attachment://${kind}-banner.png`);
    return { embeds: [embed], files: [banner] };
  }

  embed.setThumbnail(avatarUrl);
  return { embeds: [embed] };
}

module.exports = { fillPlaceholders, buildJoinLeavePayload };
