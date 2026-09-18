// legacyPrefixBridge.js — lets every ORIGINAL slash command (ping,
// addactivityrole, embed, setup, ticket, level, warn, kick, ban, log,
// verify, etc.) also run as a prefix command, e.g. "!kick @user spamming".
//
// index.js's slash-command logic already lives in one function,
// runCommand(commandName, ctx), where ctx exposes the same handful of
// methods/properties an Interaction does (.reply, .followUp, .options.getX(),
// .user, .guild, .member, .channel, .replied, .deferred). A real Interaction
// already satisfies that shape. This file's job is to build a fake one
// ("ctx") out of a plain Message + its args, so the SAME runCommand logic
// can execute either way with zero duplication.

const LEGACY_COMMAND_NAMES = new Set([
  'ping', 'addactivityrole', 'removeactivityrole', 'listactivityroles',
  'embed', 'setup', 'ticket', 'level', 'warn', 'kick', 'ban', 'mute', 'unban', 'unmute',
  'log', 'verify', 'card',
]);

const USAGE = {
  ping: 'ping',
  addactivityrole: 'addactivityrole @required-role @active-role [@old_required-role]',
  removeactivityrole: 'removeactivityrole @required-role',
  listactivityroles: 'listactivityroles',
  embed: 'embed create  |  embed edit <message_id>',
  setup: 'setup general',
  ticket: 'ticket setup',
  level: 'level rank [@user]  |  level leaderboard [overall|voice|reactions|weekly|monthly]  |  level setup  |  level admin setxp @user <set|add|remove> <amount>  |  level admin reset @user  |  level admin resetall',
  warn: 'warn add @user <reason>  |  warn list @user  |  warn clear @user  |  warn setup',
  kick: 'kick @user <reason>',
  ban: 'ban @user <reason> [duration, e.g. 7d]',
  mute: 'mute @user <duration, e.g. 1h> <reason>',
  unban: 'unban <user_id> [reason]',
  unmute: 'unmute @user [reason]',
  log: 'log setup  |  log whitelist add @user  |  log whitelist remove @user  |  log whitelist list',
  verify: 'verify setup  |  verify panel',
  card: 'card [theme: blurple|green|red|gold|purple|teal] <description> (optionally @mention someone or attach a picture)',
};

function makeOptions({ subcommand = null, subcommandGroup = null, users = {}, roles = {}, strings = {}, integers = {}, booleans = {}, attachments = {} } = {}) {
  return {
    getSubcommand: () => subcommand,
    getSubcommandGroup: () => subcommandGroup,
    getUser: name => users[name] || null,
    getRole: name => roles[name] || null,
    getString: name => (strings[name] !== undefined ? strings[name] : null),
    getInteger: name => (integers[name] !== undefined ? integers[name] : null),
    getBoolean: name => (booleans[name] !== undefined ? booleans[name] : null),
    getAttachment: name => attachments[name] || null,
  };
}

// Strips mention tokens (<@id>, <@!id>, <@&id>, <#id>) out of the raw arg
// list so what's left can be safely joined back into free text (e.g. a
// kick/ban/warn reason).
function stripMentionTokens(args) {
  return args.filter(a => !/^<[@#][!&]?\d+>$/.test(a));
}

// Builds the { commandName, options } for a legacy command from its raw args.
// Returns { error: 'usage string' } if the message doesn't have what's needed.
function parseLegacyCommand(message, commandName, args) {
  const mentionUser = () => message.mentions.users.first() || null;
  const mentionRoles = () => [...message.mentions.roles.values()];

  switch (commandName) {
    case 'ping':
      return { options: makeOptions() };

    case 'addactivityrole': {
      const roles = mentionRoles();
      if (roles.length < 2) return { error: USAGE.addactivityrole };
      return { options: makeOptions({ roles: { required: roles[0], active: roles[1], old_required: roles[2] || null } }) };
    }

    case 'removeactivityrole': {
      const roles = mentionRoles();
      if (roles.length < 1) return { error: USAGE.removeactivityrole };
      return { options: makeOptions({ roles: { required: roles[0] } }) };
    }

    case 'listactivityroles':
      return { options: makeOptions() };

    case 'embed': {
      const sub = args[0]?.toLowerCase();
      if (sub === 'create') return { options: makeOptions({ subcommand: 'create' }) };
      if (sub === 'edit') {
        const messageId = args[1];
        if (!messageId) return { error: USAGE.embed };
        return { options: makeOptions({ subcommand: 'edit', strings: { message_id: messageId } }) };
      }
      return { error: USAGE.embed };
    }

    case 'setup': {
      if (args[0]?.toLowerCase() === 'general') return { options: makeOptions({ subcommand: 'general' }) };
      return { error: USAGE.setup };
    }

    case 'ticket': {
      if (args[0]?.toLowerCase() === 'setup') return { options: makeOptions({ subcommand: 'setup' }) };
      return { error: USAGE.ticket };
    }

    case 'level': {
      const first = args[0]?.toLowerCase();

      if (first === 'rank') {
        return { options: makeOptions({ subcommand: 'rank', users: { user: mentionUser() } }) };
      }
      if (first === 'leaderboard') {
        const type = args[1]?.toLowerCase() || null;
        return { options: makeOptions({ subcommand: 'leaderboard', strings: { type } }) };
      }
      if (first === 'setup') {
        return { options: makeOptions({ subcommand: 'setup' }) };
      }
      if (first === 'admin') {
        const sub = args[1]?.toLowerCase();
        if (sub === 'setxp') {
          const user = mentionUser();
          const mode = args.find(a => ['set', 'add', 'remove'].includes(a.toLowerCase()))?.toLowerCase();
          const amountArg = args.find(a => /^\d+$/.test(a));
          if (!user || !mode || !amountArg) return { error: USAGE.level };
          return { options: makeOptions({ subcommand: 'setxp', subcommandGroup: 'admin', users: { user }, strings: { mode }, integers: { amount: parseInt(amountArg, 10) } }) };
        }
        if (sub === 'reset') {
          const user = mentionUser();
          if (!user) return { error: USAGE.level };
          return { options: makeOptions({ subcommand: 'reset', subcommandGroup: 'admin', users: { user } }) };
        }
        if (sub === 'resetall') {
          return { options: makeOptions({ subcommand: 'resetall', subcommandGroup: 'admin' }) };
        }
      }
      return { error: USAGE.level };
    }

    case 'warn': {
      const sub = args[0]?.toLowerCase();
      const user = mentionUser();

      if (sub === 'add') {
        const reason = stripMentionTokens(args.slice(1)).join(' ').trim();
        if (!user || !reason) return { error: USAGE.warn };
        return { options: makeOptions({ subcommand: 'add', users: { user }, strings: { reason } }) };
      }
      if (sub === 'list') {
        if (!user) return { error: USAGE.warn };
        return { options: makeOptions({ subcommand: 'list', users: { user } }) };
      }
      if (sub === 'clear') {
        if (!user) return { error: USAGE.warn };
        return { options: makeOptions({ subcommand: 'clear', users: { user } }) };
      }
      if (sub === 'setup') {
        return { options: makeOptions({ subcommand: 'setup' }) };
      }
      return { error: USAGE.warn };
    }

    case 'kick': {
      const user = mentionUser();
      if (!user) return { error: USAGE.kick };
      const reason = stripMentionTokens(args).join(' ').trim();
      if (!reason) return { error: USAGE.kick };
      return { options: makeOptions({ users: { user }, strings: { reason } }) };
    }

    case 'ban': {
      const user = mentionUser();
      if (!user) return { error: USAGE.ban };
      const rest = stripMentionTokens(args);
      let duration = null;
      if (rest.length > 0 && /^\d+[a-z]+$/i.test(rest[0])) {
        duration = rest.shift();
      }
      const reason = rest.join(' ').trim();
      if (!reason) return { error: USAGE.ban };
      return { options: makeOptions({ users: { user }, strings: { reason, duration } }) };
    }

    case 'mute': {
      const user = mentionUser();
      if (!user) return { error: USAGE.mute };
      const rest = stripMentionTokens(args);
      const duration = rest.shift();
      const reason = rest.join(' ').trim();
      if (!duration || !reason) return { error: USAGE.mute };
      return { options: makeOptions({ users: { user }, strings: { duration, reason } }) };
    }

    case 'unban': {
      const userId = args[0];
      if (!userId || !/^\d+$/.test(userId)) return { error: USAGE.unban };
      const reason = args.slice(1).join(' ').trim() || null;
      return { options: makeOptions({ strings: { user_id: userId, reason } }) };
    }

    case 'unmute': {
      const user = mentionUser();
      if (!user) return { error: USAGE.unmute };
      const reason = stripMentionTokens(args).join(' ').trim() || null;
      return { options: makeOptions({ users: { user }, strings: { reason } }) };
    }

    case 'card': {
      const THEME_KEYS = ['blurple', 'green', 'red', 'gold', 'purple', 'teal'];
      let theme = 'blurple';
      let rest = args;
      if (THEME_KEYS.includes(args[0]?.toLowerCase())) {
        theme = args[0].toLowerCase();
        rest = args.slice(1);
      }

      const user = mentionUser();
      const description = stripMentionTokens(rest).join(' ').trim();
      if (!description) return { error: USAGE.card };

      const attachment = message.attachments?.first() || null;

      return { options: makeOptions({ strings: { theme, description }, users: { user }, attachments: { image: attachment } }) };
    }

    case 'log': {
      const first = args[0]?.toLowerCase();
      if (first === 'setup') return { options: makeOptions({ subcommand: 'setup' }) };
      if (first === 'whitelist') {
        const sub = args[1]?.toLowerCase();
        if (sub === 'add' || sub === 'remove') {
          const user = mentionUser();
          if (!user) return { error: USAGE.log };
          return { options: makeOptions({ subcommand: sub, subcommandGroup: 'whitelist', users: { user } }) };
        }
        if (sub === 'list') return { options: makeOptions({ subcommand: 'list', subcommandGroup: 'whitelist' }) };
      }
      return { error: USAGE.log };
    }

    case 'verify': {
      const sub = args[0]?.toLowerCase();
      if (sub === 'setup' || sub === 'panel') return { options: makeOptions({ subcommand: sub }) };
      return { error: USAGE.verify };
    }

    default:
      return { error: 'Unknown command.' };
  }
}

// Wraps a Message as an interaction-like ctx: .reply/.followUp/.user/.guild/
// .member/.channel/.options/.replied/.deferred — the exact surface runCommand()
// uses.
function buildContext(message, options) {
  const state = { replied: false };
  return {
    get replied() { return state.replied; },
    get deferred() { return false; },
    user: message.author,
    guild: message.guild,
    member: message.member,
    memberPermissions: message.member?.permissions,
    channel: message.channel,
    createdTimestamp: message.createdTimestamp,
    options,
    reply: async payload => {
      state.replied = true;
      return message.reply(payload);
    },
    followUp: async payload => message.channel.send(payload),
  };
}

module.exports = {
  LEGACY_COMMAND_NAMES,
  USAGE,
  parseLegacyCommand,
  buildContext,
};
