// photoCard.js — Builds a themed photo/banner card from a text description,
// an optional featured image (an attached picture, or a member's avatar), and
// a color theme. Uses @napi-rs/canvas (already a dependency for CAPTCHA
// generation, so no new packages needed).

const path = require('path');
const { AttachmentBuilder } = require('discord.js');

// Loaded defensively — same reasoning as captchaGenerator.js: if
// @napi-rs/canvas fails to load on a given host (missing native binary,
// unsupported platform, a broken install), that should disable this ONE
// feature, not crash the entire bot on startup.
let createCanvas = null;
let loadImage = null;
let GlobalFonts = null;
try {
  ({ createCanvas, loadImage, GlobalFonts } = require('@napi-rs/canvas'));
} catch {
  createCanvas = null;
  loadImage = null;
  GlobalFonts = null;
}

// @napi-rs/canvas ships with ZERO system font dependencies — it will NOT
// fall back to whatever fonts happen to be installed on the host (unlike
// node-canvas/Pango). Asking for `sans-serif` on a bare Linux container
// (Railway, Docker, etc.) silently draws nothing: measureText() still
// "works" so layout looks fine, but fillText() renders invisible glyphs.
// That's the exact cause of the card's missing text. The fix is to bundle
// an actual font file and register it under a family name we control, so
// text renders correctly no matter what the host has installed.
//
// Font bundled: Instrument Sans (SIL Open Font License), in ./fonts.
const FONT_FAMILY = 'CardFont';
let fontsReady = false;
if (GlobalFonts) {
  try {
    GlobalFonts.registerFromPath(path.join(__dirname, 'fonts', 'CardFont-Regular.ttf'), FONT_FAMILY);
    GlobalFonts.registerFromPath(path.join(__dirname, 'fonts', 'CardFont-Bold.ttf'), FONT_FAMILY);
    fontsReady = GlobalFonts.has(FONT_FAMILY);
  } catch (err) {
    console.error('[photoCard] Failed to register bundled font, text may not render:', err.message);
  }
}
// Fallback chain: bundled font first, then whatever the host happens to have.
const FONT_STACK = fontsReady ? `"${FONT_FAMILY}", sans-serif` : 'sans-serif';

const THEMES = {
  blurple: { bg1: '#4752C4', bg2: '#5865F2', accent: '#EBEDFF', ring: '#2C3299' },
  green: { bg1: '#2D7D46', bg2: '#57F287', accent: '#EAFBF0', ring: '#1B4E2C' },
  red: { bg1: '#992D2D', bg2: '#ED4245', accent: '#FFECEC', ring: '#5E1A1A' },
  gold: { bg1: '#B8860B', bg2: '#FEE75C', accent: '#2B2D31', ring: '#7A5900' },
  purple: { bg1: '#6C3483', bg2: '#9B59B6', accent: '#F5EBFA', ring: '#432153' },
  teal: { bg1: '#0E6655', bg2: '#1ABC9C', accent: '#E8FBF6', ring: '#0A4A3D' },
};

const WIDTH = 1000;
const HEIGHT = 400;

function wrapText(ctx, text, maxWidth) {
  const words = text.split(/\s+/).filter(Boolean);
  const lines = [];
  let current = '';
  for (const word of words) {
    const test = current ? `${current} ${word}` : word;
    if (ctx.measureText(test).width > maxWidth && current) {
      lines.push(current);
      current = word;
    } else {
      current = test;
    }
  }
  if (current) lines.push(current);
  return lines;
}

function roundedRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

// Fetches with a real User-Agent (some CDNs/hosts throttle or reject
// requests with no UA) and a timeout so a slow/hanging URL can't hang the
// whole command.
async function fetchImageBuffer(url) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10_000);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; DiscordBotCardGenerator/1.0)' },
    });
    if (!res.ok) throw new Error(`Could not fetch the image (status ${res.status})`);
    const arrayBuffer = await res.arrayBuffer();
    return Buffer.from(arrayBuffer);
  } finally {
    clearTimeout(timeout);
  }
}

// options: { theme, description, imageUrl, footerText }
// Returns a discord.js AttachmentBuilder ready to send in a reply.
async function buildCard({ theme, description, imageUrl, footerText }) {
  if (!createCanvas) {
    throw new Error(
      'Photo cards are unavailable because the @napi-rs/canvas package failed to load. ' +
      'Check that it\'s listed in package.json and that the host\'s build/install logs show it installing successfully.'
    );
  }
  if (!description || !description.trim()) {
    throw new Error('A description is required to build the card.');
  }

  const colors = THEMES[theme] || THEMES.blurple;

  const canvas = createCanvas(WIDTH, HEIGHT);
  const ctx = canvas.getContext('2d');

  // Card background: rounded outer frame so it doesn't look like a plain
  // rectangle dropped into a Discord embed, with a soft outer ring for depth.
  const outerR = 28;
  roundedRect(ctx, 0, 0, WIDTH, HEIGHT, outerR);
  ctx.save();
  ctx.clip();

  const gradient = ctx.createLinearGradient(0, 0, WIDTH, HEIGHT);
  gradient.addColorStop(0, colors.bg1);
  gradient.addColorStop(1, colors.bg2);
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, WIDTH, HEIGHT);

  // Soft decorative circles for a bit of visual flair
  ctx.globalAlpha = 0.12;
  ctx.fillStyle = '#ffffff';
  ctx.beginPath(); ctx.arc(WIDTH - 80, 60, 140, 0, Math.PI * 2); ctx.fill();
  ctx.beginPath(); ctx.arc(WIDTH - 260, HEIGHT - 30, 90, 0, Math.PI * 2); ctx.fill();
  ctx.globalAlpha = 1;

  // Subtle diagonal sheen for extra polish
  const sheen = ctx.createLinearGradient(0, 0, WIDTH, HEIGHT * 0.6);
  sheen.addColorStop(0, 'rgba(255,255,255,0.08)');
  sheen.addColorStop(0.4, 'rgba(255,255,255,0)');
  ctx.fillStyle = sheen;
  ctx.fillRect(0, 0, WIDTH, HEIGHT);

  // Featured image (attachment or avatar), drawn as a ringed circle on the left
  let hasImage = false;
  if (imageUrl) {
    try {
      const buffer = await fetchImageBuffer(imageUrl);
      const img = await loadImage(buffer);
      const size = 240;
      const cx = 180, cy = HEIGHT / 2;

      // Outer accent ring
      ctx.save();
      ctx.beginPath();
      ctx.arc(cx, cy, size / 2 + 14, 0, Math.PI * 2);
      ctx.fillStyle = colors.ring;
      ctx.fill();
      ctx.restore();

      // White separator ring
      ctx.save();
      ctx.beginPath();
      ctx.arc(cx, cy, size / 2 + 6, 0, Math.PI * 2);
      ctx.fillStyle = '#ffffff';
      ctx.fill();
      ctx.restore();

      // Clipped avatar/image itself
      ctx.save();
      ctx.beginPath();
      ctx.arc(cx, cy, size / 2, 0, Math.PI * 2);
      ctx.closePath();
      ctx.clip();
      ctx.drawImage(img, cx - size / 2, cy - size / 2, size, size);
      ctx.restore();

      hasImage = true;
    } catch (err) {
      console.error('[photoCard] Failed to load featured image, continuing without it:', err.message);
    }
  }

  // Description text, word-wrapped, vertically centered, with the bundled
  // font stack so it actually renders on any host.
  const textX = hasImage ? 340 : 60;
  const textMaxWidth = WIDTH - textX - 60;

  ctx.fillStyle = colors.accent;
  ctx.font = `bold 48px ${FONT_STACK}`;
  ctx.textBaseline = 'top';

  const lines = wrapText(ctx, description, textMaxWidth).slice(0, 5); // cap at 5 lines so it never overflows
  const lineHeight = 58;
  const totalTextHeight = lines.length * lineHeight;
  let textY = (HEIGHT - totalTextHeight) / 2;

  // Small accent bar above the text as a styling touch
  ctx.fillRect(textX, textY - 22, 60, 6);

  ctx.fillStyle = colors.accent;
  for (const line of lines) {
    ctx.fillText(line, textX, textY);
    textY += lineHeight;
  }

  // Footer, drawn as a small pill for a more finished look
  if (footerText) {
    ctx.font = `22px ${FONT_STACK}`;
    const metrics = ctx.measureText(footerText);
    const padX = 16, padY = 8;
    const pillW = metrics.width + padX * 2;
    const pillH = 22 + padY * 2;
    const pillX = textX;
    const pillY = HEIGHT - 40 - padY;

    ctx.globalAlpha = 0.18;
    ctx.fillStyle = '#000000';
    roundedRect(ctx, pillX, pillY, pillW, pillH, pillH / 2);
    ctx.fill();
    ctx.globalAlpha = 1;

    ctx.fillStyle = colors.accent;
    ctx.fillText(footerText, pillX + padX, pillY + padY);
  }

  ctx.restore(); // release the outer rounded-rect clip

  // Thin border around the whole card
  roundedRect(ctx, 2, 2, WIDTH - 4, HEIGHT - 4, outerR);
  ctx.lineWidth = 4;
  ctx.strokeStyle = 'rgba(255,255,255,0.25)';
  ctx.stroke();

  const buffer = canvas.toBuffer('image/png');
  return new AttachmentBuilder(buffer, { name: 'card.png' });
}

module.exports = { buildCard, THEMES };
