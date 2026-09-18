// photoCard.js — Builds a themed photo/banner card from a text description,
// an optional featured image (an attached picture, or a member's avatar), and
// a color theme. Uses @napi-rs/canvas (already a dependency for CAPTCHA
// generation, so no new packages needed).

const { createCanvas, loadImage } = require('@napi-rs/canvas');
const { AttachmentBuilder } = require('discord.js');

const THEMES = {
  blurple: { bg1: '#4752C4', bg2: '#5865F2', accent: '#EBEDFF' },
  green: { bg1: '#2D7D46', bg2: '#57F287', accent: '#EAFBF0' },
  red: { bg1: '#992D2D', bg2: '#ED4245', accent: '#FFECEC' },
  gold: { bg1: '#B8860B', bg2: '#FEE75C', accent: '#2B2D31' },
  purple: { bg1: '#6C3483', bg2: '#9B59B6', accent: '#F5EBFA' },
  teal: { bg1: '#0E6655', bg2: '#1ABC9C', accent: '#E8FBF6' },
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

async function fetchImageBuffer(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Could not fetch the image (status ${res.status})`);
  const arrayBuffer = await res.arrayBuffer();
  return Buffer.from(arrayBuffer);
}

// options: { theme, description, imageUrl, footerText }
// Returns a discord.js AttachmentBuilder ready to send in a reply.
async function buildCard({ theme, description, imageUrl, footerText }) {
  if (!description || !description.trim()) {
    throw new Error('A description is required to build the card.');
  }

  const colors = THEMES[theme] || THEMES.blurple;

  const canvas = createCanvas(WIDTH, HEIGHT);
  const ctx = canvas.getContext('2d');

  // Gradient background
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

  // Featured image (attachment or avatar), drawn as a circle on the left
  let hasImage = false;
  if (imageUrl) {
    try {
      const buffer = await fetchImageBuffer(imageUrl);
      const img = await loadImage(buffer);
      const size = 240;
      const cx = 180, cy = HEIGHT / 2;

      ctx.save();
      ctx.beginPath();
      ctx.arc(cx, cy, size / 2 + 8, 0, Math.PI * 2);
      ctx.fillStyle = '#ffffff';
      ctx.fill();
      ctx.restore();

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

  // Description text, word-wrapped, vertically centered
  const textX = hasImage ? 340 : 60;
  const textMaxWidth = WIDTH - textX - 60;

  ctx.fillStyle = colors.accent;
  ctx.font = 'bold 48px sans-serif';
  ctx.textBaseline = 'top';

  const lines = wrapText(ctx, description, textMaxWidth).slice(0, 5); // cap at 5 lines so it never overflows
  const lineHeight = 58;
  const totalTextHeight = lines.length * lineHeight;
  let textY = (HEIGHT - totalTextHeight) / 2;

  for (const line of lines) {
    ctx.fillText(line, textX, textY);
    textY += lineHeight;
  }

  // Footer
  if (footerText) {
    ctx.font = '22px sans-serif';
    ctx.globalAlpha = 0.8;
    ctx.fillStyle = colors.accent;
    ctx.fillText(footerText, textX, HEIGHT - 40);
    ctx.globalAlpha = 1;
  }

  const buffer = canvas.toBuffer('image/png');
  return new AttachmentBuilder(buffer, { name: 'card.png' });
}

module.exports = { buildCard, THEMES };
