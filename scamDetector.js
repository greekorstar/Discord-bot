// scamDetector.js — Flags likely scam messages.
//
// Two kinds of checks:
//
//   A) KEYWORD/PATTERN CATEGORIES — matched regardless of account age, because
//      most real-world Discord scams (MrBeast/celebrity giveaways, crypto mint
//      links, "your account will be terminated" phishing, etc.) run from
//      COMPROMISED accounts, not brand-new ones. An account-age check alone
//      never catches those.
//
//   B) GENERIC HEURISTICS — driven by config.js (config.scamDetection), for
//      scam patterns too generic/new to keyword-match:
//        1. A very new account posting any link/image (newAccountDays)
//        2. Rapid-fire links/images from the same user (rapidMessage*)
//
// checkMessage(message) returns { flagged: true, reason } or null.
//
// NOTE on images: this bot can't run OCR, so a scam screenshot with no scam
// text in the message body (a bare image attachment) won't be caught by the
// keyword categories below — only by the generic new-account/rapid-fire
// heuristics. Catching image-only scams reliably needs an OCR/vision step,
// which is outside what this file does.

const config = require('./config.js');

// userId -> array of timestamps (ms) of recent link/image messages
const recentActivity = new Map();

// ---- Category definitions ----
// Each category is a reason + a list of regexes. Any match flags the message.
const SCAM_CATEGORIES = [
  {
    reason: 'Message matches a fake Discord Nitro / gift-link scam.',
    patterns: [
      /free\s*nitro/i,
      /nitro\s*(free|gift|giveaway)/i,
      /discord\s*nitro\s*(free|gift)/i,
      /claim\s*(your\s*)?nitro/i,
      // Typosquatted / fake Nitro domains
      /d[il1]sc[o0]rd\S*\.(gift|com|net|gg)\/?\S*/i,
      /discord-?nitro\S*\.(com|net|gift|xyz|site)/i,
      /discordapp\.gifts?/i,
      /discord\.gg\S*nitro/i,
    ],
  },
  {
    reason: 'Message matches a fake celebrity/streamer giveaway scam (e.g. MrBeast-style).',
    patterns: [
      /mr\.?\s*beast/i,
      /feastables/i,
      /beast\s*games/i,
      /elon\s*musk.{0,20}(giveaway|crypto|btc|eth)/i,
      /kai\s*cenat.{0,20}giveaway/i,
      /(giving\s*away|giveaway).{0,20}(1000|10000|100k|1k|\$)/i,
      /you('| ha)ve\s*(been\s*)?(selected|chosen|picked)\s*(as\s*a\s*)?(winner|to\s*win)/i,
      /congratulations.{0,20}(you\s*(have\s*)?won|winner)/i,
    ],
  },
  {
    reason: 'Message matches a crypto/NFT airdrop or wallet-drain scam.',
    patterns: [
      /(free\s*)?airdrop/i,
      /connect\s*(your\s*)?wallet/i,
      /wallet\s*(verification|verify)/i,
      /surprise\s*mint/i,
      /mint\s*(is\s*)?live/i,
      /seed\s*phrase/i,
      /double\s*your\s*(crypto|btc|bitcoin|eth|ethereum)/i,
      /send\s*[\d.]+\s*(btc|eth|bnb)\s*(get|receive)\s*[\d.]+/i,
      /guaranteed\s*(returns|profit)/i,
    ],
  },
  {
    reason: 'Message matches a fake Steam gift/trade scam.',
    patterns: [
      /steamcommun[il1]ty\S*\.(com|ru|net)/i, // typosquat
      /stearncommunity/i,
      /steam\s*(gift|trade)\s*(link|offer)/i,
      /free\s*steam\s*(key|game)/i,
    ],
  },
  {
    reason: 'Message impersonates Discord staff/support or requests credentials.',
    patterns: [
      /(discord\s*)?(staff|support|admin|mod(erator)?)\s*here/i,
      /your\s*account\s*(will\s*be|has\s*been)\s*(terminated|suspended|banned|disabled)/i,
      /verify\s*your\s*account\s*(now|immediately|here)/i,
      /unusual\s*(account\s*)?activity\s*detected/i,
      /send\s*(me\s*)?your\s*(password|token|backup\s*codes?|2fa\s*code)/i,
      /dm\s*me\s*your\s*(login|password|token)/i,
    ],
  },
  {
    reason: 'Message asks for a screen-share or remote-access tool (common account-takeover tactic).',
    patterns: [
      /screen\s*-?\s*share.{0,20}(verify|proof|confirm)/i,
      /download\s*(anydesk|teamviewer|ultraviewer)/i,
      /give\s*me\s*(remote\s*)?access\s*to\s*your\s*(pc|computer|screen)/i,
    ],
  },
  {
    reason: 'Message matches an IP-grabber / disguised tracking link.',
    patterns: [
      /grabify\.link/i,
      /iplogger\.(org|com|ru)/i,
      /2no\.co/i,
      /yip\.su/i,
      /blasze\.(com|tech)/i,
      /ip-?logger/i,
    ],
  },
  {
    reason: 'Message matches a "make money fast" / work-from-home job scam.',
    patterns: [
      /make\s*\$?\d{2,}\s*(a|per)\s*(day|hour|week)/i,
      /work\s*from\s*home.{0,20}no\s*experience/i,
      /dm\s*me\s*to\s*get\s*paid/i,
      /easy\s*money.{0,20}(dm|click|link)/i,
    ],
  },
  {
    reason: 'Message matches a sextortion / blackmail scam.',
    patterns: [
      /i\s*have\s*(your\s*)?(webcam|screen)\s*(footage|recording)/i,
      /pay\s*(me\s*)?(in\s*)?(bitcoin|crypto).{0,20}(or\s*i|otherwise)/i,
      /send\s*(bitcoin|crypto).{0,20}(leak|expose|send\s*(it|this)\s*to\s*(everyone|your\s*contacts))/i,
    ],
  },
  {
    reason: 'Message contains a QR code phishing ("quishing") prompt.',
    patterns: [
      /scan\s*(this|the)\s*qr\s*code/i,
      /qr\s*code\s*to\s*claim/i,
      /qr\s*code\s*to\s*(verify|login|log\s*in)/i,
    ],
  },
];

const LINK_REGEX = /(https?:\/\/\S+)|(discord(?:\.gg|app\.com\/invite)\/\S+)/i;

function containsLinkOrImage(message) {
  const content = message.content || '';
  const hasLink = LINK_REGEX.test(content);
  const hasImage = message.attachments && message.attachments.size > 0;
  return hasLink || hasImage;
}

function matchKeywordCategories(content) {
  for (const category of SCAM_CATEGORIES) {
    for (const pattern of category.patterns) {
      if (pattern.test(content)) {
        return category.reason;
      }
    }
  }
  return null;
}

function checkMessage(message) {
  const cfg = config.scamDetection;
  if (!cfg || !cfg.enabled) return null;

  const content = message.content || '';

  // ---- Keyword/pattern categories — apply regardless of account age ----
  const categoryMatch = matchKeywordCategories(content);
  if (categoryMatch) {
    return { flagged: true, reason: categoryMatch };
  }

  if (!containsLinkOrImage(message)) return null;

  // ---- Generic heuristic 1: brand-new account posting any link/image ----
  const accountAgeDays = (Date.now() - message.author.createdTimestamp) / (1000 * 60 * 60 * 24);
  if (accountAgeDays < cfg.newAccountDays) {
    return {
      flagged: true,
      reason: `Account is ${accountAgeDays.toFixed(1)} day(s) old and posted a link/image (threshold: ${cfg.newAccountDays} days).`,
    };
  }

  // ---- Generic heuristic 2: rapid-fire links/images ----
  const now = Date.now();
  const windowMs = cfg.rapidMessageWindowSeconds * 1000;
  const userId = message.author.id;

  const timestamps = (recentActivity.get(userId) || []).filter(t => now - t < windowMs);
  timestamps.push(now);
  recentActivity.set(userId, timestamps);

  if (timestamps.length >= cfg.rapidMessageThreshold) {
    recentActivity.delete(userId); // reset so a ban doesn't get re-triggered on stale data
    return {
      flagged: true,
      reason: `Posted ${timestamps.length} links/images within ${cfg.rapidMessageWindowSeconds} seconds (threshold: ${cfg.rapidMessageThreshold}).`,
    };
  }

  return null;
}

// Periodic cleanup so the map doesn't grow forever with inactive users.
setInterval(() => {
  const now = Date.now();
  const windowMs = (config.scamDetection?.rapidMessageWindowSeconds || 5) * 1000;
  for (const [userId, timestamps] of recentActivity.entries()) {
    const fresh = timestamps.filter(t => now - t < windowMs);
    if (fresh.length === 0) recentActivity.delete(userId);
    else recentActivity.set(userId, fresh);
  }
}, 5 * 60 * 1000).unref();

module.exports = { checkMessage };
