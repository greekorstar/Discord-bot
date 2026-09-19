// scamDetector.js — Flags likely scam messages posted in the server.
// Covers: fake Nitro/gift giveaways, crypto/NFT mint & wallet-drainer links,
// Steam/game-account phishing, fake account-threat messages, "exposed"
// blackmail invites, malware disguised as a file, and rapid-fire link/image spam.

const config = require('./config.js');

const BUILT_IN_KEYWORDS = [
  'free nitro', 'nitro free', 'claim your gift', 'claim your nitro', 'you have been gifted',
  'limited time nitro', 'nitro giveaway', 'gift for you',
  'free mint', 'surprise mint', 'exclusive mint', 'mint is live', 'airdrop', 'claim your airdrop',
  'connect your wallet', 'connect wallet', 'whitelist spot', 'double your crypto',
  'guaranteed profit', 'guaranteed returns', 'investment opportunity', 'trading signals',
  'free skin', 'free robux', 'free v-bucks', 'csgo skin', 'inflated trade', 'middleman trade',
  'your account has been reported', 'your account will be banned', 'account suspended',
  'confirm your identity', 'verify your account or', 'unusual activity detected',
  'you have been exposed', "you've been exposed", 'leaked photos of you', 'someone leaked',
  'test this out', 'try this out', 'check this out', 'test my game', 'try my game',
];

const suspiciousDomainPatterns = [
  /discord-?nitro/i, /discordgift/i, /discrod/i, /dlscord/i, /disc0rd/i,
  /steamcommunlty/i, /steam-?gift/i, /steampowered-?gift/i, /free-?nitro/i,
  /free-?mint/i, /opensea-?mint/i, /metamask-?support/i, /wallet-?connect-?claim/i, /nft-?airdrop/i,
];

const suspiciousFileExtensions = /\.(exe|scr|bat|msi|vbs|jar|apk)$/i;

const recentActivity = new Map(); // userId -> array of recent activity timestamps

function isNewAccount(user) {
  const ageMs = Date.now() - user.createdTimestamp;
  return ageMs < config.scamDetection.newAccountDays * 24 * 60 * 60 * 1000;
}

function extractLinks(content) {
  return content.match(/https?:\/\/\S+/gi) || [];
}

function isSuspiciousLink(link) {
  return suspiciousDomainPatterns.some(pattern => pattern.test(link));
}

function containsSuspiciousKeyword(content) {
  const lower = content.toLowerCase();
  return BUILT_IN_KEYWORDS.some(kw => lower.includes(kw));
}

function hasSuspiciousAttachment(message) {
  return message.attachments.some(a => suspiciousFileExtensions.test(a.name || ''));
}

function recordActivity(userId) {
  const now = Date.now();
  const windowMs = config.scamDetection.rapidMessageWindowSeconds * 1000;
  const timestamps = (recentActivity.get(userId) || []).filter(t => now - t < windowMs);
  timestamps.push(now);
  recentActivity.set(userId, timestamps);
  return timestamps.length;
}

function checkMessage(message) {
  if (!config.scamDetection.enabled) return null;

  const content = message.content || '';
  const hasAttachment = message.attachments.size > 0;
  const links = extractLinks(content);
  const hasLink = links.length > 0;

  if (!hasAttachment && !hasLink) return null;

  if (hasAttachment && hasSuspiciousAttachment(message)) {
    return { flagged: true, reason: 'Attached a file with an executable-style extension, commonly used to disguise malware' };
  }

  const count = recordActivity(message.author.id);
  if (count >= config.scamDetection.rapidMessageThreshold) {
    return { flagged: true, reason: `Posted ${count} links/attachments within ${config.scamDetection.rapidMessageWindowSeconds}s (rapid-fire spam pattern)` };
  }

  if (hasLink && containsSuspiciousKeyword(content)) {
    return { flagged: true, reason: 'Link posted alongside common scam wording' };
  }
  if (hasAttachment && containsSuspiciousKeyword(content)) {
    return { flagged: true, reason: 'File attached alongside wording commonly used to spread malware disguised as a game/mod' };
  }
  if (links.some(isSuspiciousLink)) {
    return { flagged: true, reason: 'Link domain resembles known scam/impersonation patterns' };
  }
  if (hasLink && isNewAccount(message.author)) {
    return { flagged: true, reason: `Account is newer than ${config.scamDetection.newAccountDays} days and posted a link` };
  }

  return { flagged: false };
}

module.exports = { checkMessage };
