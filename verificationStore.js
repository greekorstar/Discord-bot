// verificationStore.js — Persists how verification is configured, and tracks
// in-memory captcha sessions while someone is mid-verification.

const fs = require('fs');
const path = require('path');

const DATA_FILE = path.join(__dirname, 'verificationConfig.json');

let config = {
  method: 'oneclick',     // 'oneclick' | 'captcha'
  difficulty: 'medium',   // 'easy' | 'medium' | 'hard' — only used when method is 'captcha'
  verifiedRoleId: '',
  maxAttempts: 5,
};

function load() {
  try {
    config = { ...config, ...JSON.parse(fs.readFileSync(DATA_FILE, 'utf8')) };
  } catch (err) {
    // use defaults
  }
}

function save() {
  try {
    fs.writeFileSync(DATA_FILE, JSON.stringify(config, null, 2));
  } catch (err) {
    console.error('[verificationStore] Failed to save verificationConfig.json:', err.message);
  }
}

function getConfig() {
  return config;
}

function setMethod(method) {
  config.method = method;
  save();
}

function setDifficulty(difficulty) {
  config.difficulty = difficulty;
  save();
}

function setVerifiedRole(roleId) {
  config.verifiedRoleId = roleId;
  save();
}

load();

// ---- In-memory captcha sessions (userId -> { code, attempts, caseSensitive }) ----
const sessions = new Map();

function startCaptchaSession(userId, code, caseSensitive) {
  sessions.set(userId, { code, attempts: 0, caseSensitive });
}

function getCaptchaSession(userId) {
  return sessions.get(userId);
}

function clearCaptchaSession(userId) {
  sessions.delete(userId);
}

module.exports = {
  getConfig,
  setMethod,
  setDifficulty,
  setVerifiedRole,
  startCaptchaSession,
  getCaptchaSession,
  clearCaptchaSession,
};
