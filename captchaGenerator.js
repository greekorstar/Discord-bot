// captchaGenerator.js — Draws a distorted CAPTCHA image using @napi-rs/canvas.
// Chosen over the more common "canvas" package specifically because it ships
// prebuilt binaries per-platform instead of needing native compilation —
// much more likely to actually install cleanly on a host like Railway.

const crypto = require('crypto');

// Loaded defensively: if @napi-rs/canvas isn't installed (e.g. a host's
// npm install silently skipped it, or its native binary doesn't support
// the platform), we don't want that to crash the ENTIRE bot on startup —
// just this one feature. generateCaptcha() below throws a clear, catchable
// error instead so the caller can show a friendly message.
let createCanvas = null;
try {
  ({ createCanvas } = require('@napi-rs/canvas'));
} catch {
  createCanvas = null;
}

const DIFFICULTY_SETTINGS = {
  easy: { length: 4, chars: 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789', caseSensitive: false, noiseLines: 2, rotation: 0.15, fontSizeVariance: 0 },
  medium: { length: 6, chars: 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789', caseSensitive: false, noiseLines: 5, rotation: 0.3, fontSizeVariance: 6 },
  hard: { length: 8, chars: 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789', caseSensitive: true, noiseLines: 9, rotation: 0.5, fontSizeVariance: 10 },
};

function randomChar(charset) {
  return charset[crypto.randomInt(charset.length)];
}

function randomColor(minBrightness, maxBrightness) {
  const c = () => crypto.randomInt(minBrightness, maxBrightness);
  return `rgb(${c()},${c()},${c()})`;
}

// Returns { code, caseSensitive, buffer } where buffer is a PNG Buffer.
function generateCaptcha(difficulty) {
  if (!createCanvas) {
    throw new Error(
      'CAPTCHA images are unavailable because the @napi-rs/canvas package failed to load. ' +
      'Check that it\'s listed in package.json and that the host\'s build/install logs show it installing successfully.'
    );
  }

  const settings = DIFFICULTY_SETTINGS[difficulty] || DIFFICULTY_SETTINGS.medium;

  let code = '';
  for (let i = 0; i < settings.length; i++) code += randomChar(settings.chars);

  const width = 60 + settings.length * 40;
  const height = 120;
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext('2d');

  // Background
  ctx.fillStyle = '#2b2d31';
  ctx.fillRect(0, 0, width, height);

  // Noise lines (more = harder)
  for (let i = 0; i < settings.noiseLines; i++) {
    ctx.strokeStyle = randomColor(60, 140);
    ctx.lineWidth = 1 + crypto.randomInt(2);
    ctx.beginPath();
    ctx.moveTo(crypto.randomInt(width), crypto.randomInt(height));
    ctx.lineTo(crypto.randomInt(width), crypto.randomInt(height));
    ctx.stroke();
  }

  // Draw each character with random rotation/offset/size
  const charSpacing = width / (settings.length + 1);
  for (let i = 0; i < code.length; i++) {
    const fontSize = 42 + (settings.fontSizeVariance ? crypto.randomInt(-settings.fontSizeVariance, settings.fontSizeVariance) : 0);
    ctx.save();
    const x = charSpacing * (i + 1);
    const y = height / 2 + (crypto.randomInt(-8, 8));
    ctx.translate(x, y);
    const angle = (crypto.randomInt(-100, 100) / 100) * settings.rotation;
    ctx.rotate(angle);
    ctx.font = `bold ${fontSize}px sans-serif`;
    ctx.fillStyle = randomColor(200, 255);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(code[i], 0, 0);
    ctx.restore();
  }

  const buffer = canvas.toBuffer('image/png');
  return { code, caseSensitive: settings.caseSensitive, buffer };
}

module.exports = { generateCaptcha, DIFFICULTY_SETTINGS };
