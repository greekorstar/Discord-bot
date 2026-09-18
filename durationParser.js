// durationParser.js — Parses strings like "7d", "24h", "30m", "45s" into
// milliseconds, for commands like /ban and /mute that accept a duration.

const UNIT_MS = {
  s: 1000, sec: 1000, second: 1000, seconds: 1000,
  m: 60 * 1000, min: 60 * 1000, minute: 60 * 1000, minutes: 60 * 1000,
  h: 60 * 60 * 1000, hour: 60 * 60 * 1000, hours: 60 * 60 * 1000,
  d: 24 * 60 * 60 * 1000, day: 24 * 60 * 60 * 1000, days: 24 * 60 * 60 * 1000,
};

// Returns { valid: true, ms, display } or { valid: false }.
function parseDuration(str) {
  if (!str) return { valid: false };
  const match = str.trim().toLowerCase().match(/^(\d+)\s*([a-z]+)$/);
  if (!match) return { valid: false };

  const amount = parseInt(match[1], 10);
  const unit = match[2];
  const unitMs = UNIT_MS[unit];
  if (!unitMs || amount <= 0) return { valid: false };

  return { valid: true, ms: amount * unitMs, display: str.trim() };
}

module.exports = { parseDuration };
