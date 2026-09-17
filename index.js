// index.js — Main bot file
require('dotenv').config();
const { Client, GatewayIntentBits, Partials, REST, Routes, SlashCommandBuilder, EmbedBuilder, PermissionFlagsBits, ButtonStyle } = require('discord.js');
require('./keep_alive.js'); // Starts a tiny web server so UptimeRobot can ping this bot
const { handleActivity } = require('./activityTracker.js');
const roleManager = require('./roleManager.js');
const embedBuilder = require('./embedBuilder.js');
const buttonRegistry = require('./buttonRegistry.js');
const scamDetector = require('./scamDetector.js');
const config = require('./config.js');
const ticketSystem = require('./ticketSystem.js');
const settingsStore = require('./settingsStore.js');
const levelSystem = require('./levelSystem.js');
const warnSystem = require('./warnSystem.js');
const logSystem = require('./logSystem.js');
const inviteTracker = require('./inviteTracker.js');
const joinLeaveSystem = require('./joinLeaveSystem.js');
const setupWizard = require('./setupWizard.js');
const permissions = require('./permissions.js');
const imageScamDetector = require('./imageScamDetector.js');
const videoScamDetector = require('./videoScamDetector.js');
const slurDetector = require('./slurDetector.js');
const moderationLog = require('./moderationLog.js');
const scamManagement = require('./scamManagement.js');
const verificationSystem = require('./verificationSystem.js');

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessageReactions,
    GatewayIntentBits.GuildInvites,
  ],
  partials: [Partials.Message, Partials.Reaction, Partials.User],
});

// ---- Define slash commands ----
const commands = [
  new SlashCommandBuilder()
    .setName('ping')
    .setDescription('Check if the bot is alive and see its latency'),

  new SlashCommandBuilder()
    .setName('addactivityrole')
    .setDescription('Add or update an activity role pair (needs Manage Roles)')
    .addRoleOption(option =>
      option.setName('required')
        .setDescription('The role a member must already have')
        .setRequired(true))
    .addRoleOption(option =>
      option.setName('active')
        .setDescription('The role granted while they are active')
        .setRequired(true))
    .addRoleOption(option =>
      option.setName('old_required')
        .setDescription('Only if changing an existing pair\'s required role: what it currently is')
        .setRequired(false)),

  new SlashCommandBuilder()
    .setName('removeactivityrole')
    .setDescription('Remove an activity role pair (needs Manage Roles)')
    .addRoleOption(option =>
      option.setName('required')
        .setDescription('The required role of the pair to remove')
        .setRequired(true)),

  new SlashCommandBuilder()
    .setName('listactivityroles')
    .setDescription('List all configured activity role pairs (needs Manage Roles)'),

  new SlashCommandBuilder()
    .setName('embed')
    .setDescription('Build, send, or edit a custom embed message (needs Manage Messages)')
    .addSubcommand(sub =>
      sub.setName('create')
        .setDescription('Start building a new embed message'))
    .addSubcommand(sub =>
      sub.setName('edit')
        .setDescription('Edit an existing embed message sent by this bot (must be in this channel)')
        .addStringOption(option =>
          option.setName('message_id')
            .setDescription('The ID of the message to edit')
            .setRequired(true))),

  new SlashCommandBuilder()
    .setName('setup')
    .setDescription('Configure the bot with dropdown pickers (needs Manage Server)')
    .addSubcommand(sub =>
      sub.setName('general')
        .setDescription('Set up join/leave channels and auto-role(s)')),

  new SlashCommandBuilder()
    .setName('ticket')
    .setDescription('Configure and manage the ticket system')
    .addSubcommand(sub =>
      sub.setName('setup')
        .setDescription('Set the panel channel, support role, category, and transcript channel (needs Manage Server)')),

  new SlashCommandBuilder()
    .setName('level')
    .setDescription('Leveling system — rank, leaderboards, and configuration')
    .addSubcommand(sub =>
      sub.setName('rank')
        .setDescription('View your (or someone else\'s) rank card')
        .addUserOption(o => o.setName('user').setDescription('Whose rank to show').setRequired(false)))
    .addSubcommand(sub =>
      sub.setName('leaderboard')
        .setDescription('View a leaderboard')
        .addStringOption(o => o.setName('type').setDescription('Which leaderboard').setRequired(false)
          .addChoices(
            { name: 'Overall XP & Level', value: 'overall' },
            { name: 'Voice Time', value: 'voice' },
            { name: 'Reactions', value: 'reactions' },
            { name: 'Weekly XP', value: 'weekly' },
            { name: 'Monthly XP', value: 'monthly' },
          )))
    .addSubcommand(sub =>
      sub.setName('setup')
        .setDescription('Configure leveling (needs Manage Server)'))
    .addSubcommandGroup(group =>
      group.setName('admin')
        .setDescription('Manually manage member XP (needs Manage Server)')
        .addSubcommand(sub =>
          sub.setName('setxp')
            .setDescription('Set, add, or remove XP for a member')
            .addUserOption(o => o.setName('user').setDescription('Member').setRequired(true))
            .addStringOption(o => o.setName('mode').setDescription('What to do').setRequired(true)
              .addChoices({ name: 'Set to', value: 'set' }, { name: 'Add', value: 'add' }, { name: 'Remove', value: 'remove' }))
            .addIntegerOption(o => o.setName('amount').setDescription('XP amount').setRequired(true)))
        .addSubcommand(sub =>
          sub.setName('reset')
            .setDescription('Reset one member\'s XP/level back to zero')
            .addUserOption(o => o.setName('user').setDescription('Member').setRequired(true)))
        .addSubcommand(sub =>
          sub.setName('resetall')
            .setDescription('Reset EVERYONE\'s XP/level in this server — cannot be undone'))),

  new SlashCommandBuilder()
    .setName('warn')
    .setDescription('Warn members, with configurable escalation (mute/kick/ban at N warnings)')
    .addSubcommand(sub =>
      sub.setName('add')
        .setDescription('Warn a member')
        .addUserOption(o => o.setName('user').setDescription('Member to warn').setRequired(true))
        .addStringOption(o => o.setName('reason').setDescription('Reason for the warning').setRequired(true)))
    .addSubcommand(sub =>
      sub.setName('list')
        .setDescription('View a member\'s warning history')
        .addUserOption(o => o.setName('user').setDescription('Member').setRequired(true)))
    .addSubcommand(sub =>
      sub.setName('clear')
        .setDescription('Clear a member\'s warnings (needs Manage Server)')
        .addUserOption(o => o.setName('user').setDescription('Member').setRequired(true)))
    .addSubcommand(sub =>
      sub.setName('setup')
        .setDescription('Configure the warning log channel and escalation rules (needs Manage Server)')),

  new SlashCommandBuilder()
    .setName('kick')
    .setDescription('Kick a member')
    .addUserOption(o => o.setName('user').setDescription('Member to kick').setRequired(true))
    .addStringOption(o => o.setName('reason').setDescription('Reason').setRequired(false)),

  new SlashCommandBuilder()
    .setName('ban')
    .setDescription('Ban a member')
    .addUserOption(o => o.setName('user').setDescription('Member to ban').setRequired(true))
    .addStringOption(o => o.setName('reason').setDescription('Reason').setRequired(false)),

  new SlashCommandBuilder()
    .setName('log')
    .setDescription('General server log — logs command usage, message edits/deletes, bans, and more')
    .addSubcommand(sub =>
      sub.setName('setup')
        .setDescription('Set the log channel (needs Manage Server)'))
    .addSubcommandGroup(group =>
      group.setName('whitelist')
        .setDescription('Exclude specific people from being logged (needs Manage Server)')
        .addSubcommand(sub =>
          sub.setName('add')
            .setDescription('Stop logging this person')
            .addUserOption(o => o.setName('user').setDescription('User to exclude').setRequired(true)))
        .addSubcommand(sub =>
          sub.setName('remove')
            .setDescription('Resume logging this person')
            .addUserOption(o => o.setName('user').setDescription('User to remove from the whitelist').setRequired(true)))
        .addSubcommand(sub =>
          sub.setName('list')
            .setDescription('View everyone currently excluded from logging'))),

  new SlashCommandBuilder()
    .setName('scamlist')
    .setDescription('Manage custom scam words and whitelisted links (needs Manage Server)')
    .addSubcommandGroup(group =>
      group.setName('word')
        .setDescription('Manage custom scam words')
        .addSubcommand(sub =>
          sub.setName('add')
            .setDescription('Add a custom scam phrase to detect')
            .addStringOption(o => o.setName('phrase').setDescription('The phrase to detect').setRequired(true)))
        .addSubcommand(sub =>
          sub.setName('remove')
            .setDescription('Remove a custom scam phrase')
            .addStringOption(o => o.setName('phrase').setDescription('The phrase to remove').setRequired(true)))
        .addSubcommand(sub =>
          sub.setName('list')
            .setDescription('List all custom scam phrases')))
    .addSubcommandGroup(group =>
      group.setName('whitelist')
        .setDescription('Manage whitelisted links')
        .addSubcommand(sub =>
          sub.setName('add')
            .setDescription('Whitelist a domain, optionally restricted to specific channels')
            .addStringOption(o => o.setName('domain').setDescription('e.g. example.com').setRequired(true))
            .addChannelOption(o => o.setName('channel1').setDescription('Restrict to this channel (optional)').setRequired(false))
            .addChannelOption(o => o.setName('channel2').setDescription('...and this one (optional)').setRequired(false))
            .addChannelOption(o => o.setName('channel3').setDescription('...and this one (optional)').setRequired(false)))
        .addSubcommand(sub =>
          sub.setName('remove')
            .setDescription('Remove a whitelisted domain')
            .addStringOption(o => o.setName('domain').setDescription('The domain to remove').setRequired(true)))
        .addSubcommand(sub =>
          sub.setName('list')
            .setDescription('List all whitelisted links'))),

  new SlashCommandBuilder()
    .setName('verify')
    .setDescription('Verification system (needs Manage Server)')
    .addSubcommand(sub =>
      sub.setName('setup')
        .setDescription('Configure method, difficulty, and the verified role'))
    .addSubcommand(sub =>
      sub.setName('panel')
        .setDescription('Post the verification panel in this channel')),
].map(command => command.toJSON());

// ---- Register slash commands with Discord ----
const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);

async function registerCommands() {
  try {
    console.log('Registering slash commands...');
    await rest.put(
      Routes.applicationCommands(process.env.CLIENT_ID),
      { body: commands },
    );
    console.log('Slash commands registered successfully.');
  } catch (error) {
    console.error('Error registering commands:', error);
  }
}

// ---- Bot ready event ----
client.once('ready', () => {
  console.log(`Logged in as ${client.user.tag}`);
  registerCommands();
  client.guilds.cache.forEach(guild => inviteTracker.cacheGuildInvites(guild));
  levelSystem.init(client);
});

// ---- Handle slash command interactions ----
client.on('interactionCreate', async interaction => {
  if (!interaction.isChatInputCommand()) return;

  const { commandName } = interaction;

  logSystem.logCommand(interaction).catch(err => console.error('[logSystem] Failed to log command usage:', err.message));

  try {
    if (commandName === 'ping') {
      const latency = Date.now() - interaction.createdTimestamp;
      await interaction.reply({ content: `🏓 Pong! Latency: ${latency}ms | API Latency: ${Math.round(client.ws.ping)}ms`, ephemeral: true });
    }

    else if (commandName === 'addactivityrole') {
      if (!(await permissions.requirePermission(interaction, PermissionFlagsBits.ManageRoles, 'Manage Roles'))) return;
      const requiredRole = interaction.options.getRole('required');
      const activeRole = interaction.options.getRole('active');
      const oldRequiredRole = interaction.options.getRole('old_required');

      roleManager.addPair(requiredRole.id, activeRole.id, oldRequiredRole ? oldRequiredRole.id : undefined);

      if (oldRequiredRole) {
        await interaction.reply(`✅ Updated that pair: now requires **${requiredRole.name}** to get **${activeRole.name}** while active (was **${oldRequiredRole.name}**).`);
      } else {
        await interaction.reply(`✅ Members with **${requiredRole.name}** will now get **${activeRole.name}** while active (10 min inactivity timeout).`);
      }
    }

    else if (commandName === 'removeactivityrole') {
      if (!(await permissions.requirePermission(interaction, PermissionFlagsBits.ManageRoles, 'Manage Roles'))) return;
      const requiredRole = interaction.options.getRole('required');
      const removed = roleManager.removePair(requiredRole.id);

      if (removed) {
        await interaction.reply(`🗑️ Removed the activity role pair for **${requiredRole.name}**.`);
      } else {
        await interaction.reply({ content: `No activity role pair found for **${requiredRole.name}**.`, ephemeral: true });
      }
    }

    else if (commandName === 'listactivityroles') {
      if (!(await permissions.requirePermission(interaction, PermissionFlagsBits.ManageRoles, 'Manage Roles'))) return;
      const pairs = roleManager.getPairs();

      if (pairs.length === 0) {
        await interaction.reply({ content: 'No activity role pairs are configured yet.', ephemeral: true });
        return;
      }

      const embed = new EmbedBuilder()
        .setTitle('Activity Role Pairs')
        .setColor(0x5865F2)
        .setDescription(
          pairs.map((p, i) => `**${i + 1}.** Required: <@&${p.requiredRoleId}> → Active: <@&${p.activeRoleId}>`).join('\n')
        );

      await interaction.reply({ embeds: [embed], ephemeral: true });
    }

    else if (commandName === 'embed') {
      if (!(await permissions.requirePermission(interaction, PermissionFlagsBits.ManageMessages, 'Manage Messages'))) return;

      const subcommand = interaction.options.getSubcommand();

      if (subcommand === 'create') {
        embedBuilder.clearSession(interaction.user.id);
        const session = embedBuilder.getSession(interaction.user.id);
        embedBuilder.persist();

        await interaction.reply({
          content: embedBuilder.previewContent(session),
          embeds: embedBuilder.buildAllEmbeds(session),
          components: embedBuilder.buildControlRows(session),
          ephemeral: true,
        });
      }

      else if (subcommand === 'edit') {
        const messageId = interaction.options.getString('message_id');
        const message = await interaction.channel.messages.fetch(messageId).catch(() => null);

        if (!message) {
          await interaction.reply({ content: `Couldn't find a message with that ID in this channel.`, ephemeral: true });
          return;
        }
        if (message.author.id !== client.user.id) {
          await interaction.reply({ content: `That message wasn't sent by me, so I can't edit it.`, ephemeral: true });
          return;
        }

        embedBuilder.clearSession(interaction.user.id);
        const session = embedBuilder.getSession(interaction.user.id);
        embedBuilder.loadMessageIntoSession(session, message);
        embedBuilder.persist();

        await interaction.reply({
          content: embedBuilder.previewContent(session),
          embeds: embedBuilder.buildAllEmbeds(session),
          components: embedBuilder.buildControlRows(session),
          ephemeral: true,
        });
      }
    }

    else if (commandName === 'setup') {
      if (!(await permissions.requirePermission(interaction, PermissionFlagsBits.ManageGuild, 'Manage Server'))) return;

      const subcommand = interaction.options.getSubcommand();

      if (subcommand === 'general') {
        await interaction.reply({ content: 'Pick your join channel, leave channel, and auto-role(s) below. Each saves the moment you pick it.', components: setupWizard.buildGeneralSetupRows(), ephemeral: true });
      }
    }

    else if (commandName === 'ticket') {
      if (!(await permissions.requirePermission(interaction, PermissionFlagsBits.ManageGuild, 'Manage Server'))) return;

      const subcommand = interaction.options.getSubcommand();
      if (subcommand === 'setup') {
        await interaction.reply({ content: 'Pick your ticket panel channel, support role, category, and transcript channel below. Picking the panel channel immediately posts the "Open a Ticket" panel there.', components: ticketSystem.buildSetupRows(), ephemeral: true });
      }
    }

    else if (commandName === 'level') {
      const group = interaction.options.getSubcommandGroup(false);
      const subcommand = interaction.options.getSubcommand();

      if (!group && subcommand === 'rank') {
        const targetUser = interaction.options.getUser('user') || interaction.user;
        const member = await interaction.guild.members.fetch(targetUser.id).catch(() => null);
        if (!member) { await interaction.reply({ content: 'Could not find that member.', ephemeral: true }); return; }
        const payload = await levelSystem.buildRankCard(member);
        await interaction.reply(payload);
      }

      else if (!group && subcommand === 'leaderboard') {
        const type = interaction.options.getString('type') || 'overall';
        const embed = levelSystem.buildLeaderboardEmbed(interaction.guild, type);
        await interaction.reply({ embeds: [embed] });
      }

      else if (!group && subcommand === 'setup') {
        if (!(await permissions.requirePermission(interaction, PermissionFlagsBits.ManageGuild, 'Manage Server'))) return;
        await interaction.reply({ content: 'What do you want to configure?', components: [levelSystem.buildSetupMenuRow()], ephemeral: true });
      }

      else if (group === 'admin') {
        if (!(await permissions.requirePermission(interaction, PermissionFlagsBits.ManageGuild, 'Manage Server'))) return;

        if (subcommand === 'setxp') {
          const user = interaction.options.getUser('user');
          const mode = interaction.options.getString('mode');
          const amount = interaction.options.getInteger('amount');
          const { level } = levelSystem.adminSetXp(interaction.guild.id, user.id, mode, amount);
          await interaction.reply({ content: `✅ Updated <@${user.id}>'s XP. They are now level ${level}.`, ephemeral: true });
        } else if (subcommand === 'reset') {
          const user = interaction.options.getUser('user');
          levelSystem.resetUser(interaction.guild.id, user.id);
          await interaction.reply({ content: `✅ Reset <@${user.id}>'s XP and level.`, ephemeral: true });
        } else if (subcommand === 'resetall') {
          levelSystem.resetGuild(interaction.guild.id);
          await interaction.reply({ content: '✅ Reset the entire server\'s XP and levels.', ephemeral: true });
        }
      }
    }

    else if (commandName === 'warn') {
      const subcommand = interaction.options.getSubcommand();

      if (subcommand === 'add') {
        if (!(await permissions.requirePermission(interaction, PermissionFlagsBits.ModerateMembers, 'Timeout Members'))) return;
        const user = interaction.options.getUser('user');
        const reason = interaction.options.getString('reason');
        const member = await interaction.guild.members.fetch(user.id).catch(() => null);
        if (!member) { await interaction.reply({ content: 'Could not find that member in this server.', ephemeral: true }); return; }

        const { count, escalationResult } = await warnSystem.addWarning(interaction.guild, member, interaction.user, reason);
        await interaction.reply(`⚠️ <@${user.id}> has been warned (warning #${count}).${escalationResult ? ` They were automatically **${escalationResult}**.` : ''}`);
      }

      else if (subcommand === 'list') {
        if (!(await permissions.requirePermission(interaction, PermissionFlagsBits.ModerateMembers, 'Timeout Members'))) return;
        const user = interaction.options.getUser('user');
        const embed = warnSystem.buildWarningsEmbed(user, interaction.guild.id);
        await interaction.reply({ embeds: [embed], ephemeral: true });
      }

      else if (subcommand === 'clear') {
        if (!(await permissions.requirePermission(interaction, PermissionFlagsBits.ModerateMembers, 'Timeout Members'))) return;
        const user = interaction.options.getUser('user');
        warnSystem.clearWarnings(interaction.guild.id, user.id);
        await interaction.reply(`✅ Cleared all warnings for <@${user.id}>.`);
      }

      else if (subcommand === 'setup') {
        if (!(await permissions.requirePermission(interaction, PermissionFlagsBits.ModerateMembers, 'Timeout Members'))) return;
        const config = warnSystem.getConfig(interaction.guild.id);
        await interaction.reply({ content: 'Pick your warning log channel below, and use the buttons to manage escalation rules (e.g. "2 warnings → kick").', components: warnSystem.buildSetupRows(config), ephemeral: true });
      }
    }

    else if (commandName === 'kick') {
      if (!(await permissions.requirePermission(interaction, PermissionFlagsBits.KickMembers, 'Kick Members'))) return;
      const user = interaction.options.getUser('user');
      const reason = interaction.options.getString('reason') || 'No reason provided';
      const member = await interaction.guild.members.fetch(user.id).catch(() => null);
      if (!member) { await interaction.reply({ content: 'Could not find that member in this server.', ephemeral: true }); return; }
      if (!member.kickable) { await interaction.reply({ content: 'I can\'t kick that member — check my role position and permissions.', ephemeral: true }); return; }

      await member.kick(reason);
      await interaction.reply(`👢 <@${user.id}> was kicked. Reason: ${reason}`);
      await logSystem.logAction(interaction.guild, `👢 <@${user.id}> was kicked by <@${interaction.user.id}>.\n**Reason:** ${reason}`);
    }

    else if (commandName === 'ban') {
      if (!(await permissions.requirePermission(interaction, PermissionFlagsBits.BanMembers, 'Ban Members'))) return;
      const user = interaction.options.getUser('user');
      const reason = interaction.options.getString('reason') || 'No reason provided';
      const member = await interaction.guild.members.fetch(user.id).catch(() => null);
      if (member && !member.bannable) { await interaction.reply({ content: 'I can\'t ban that member — check my role position and permissions.', ephemeral: true }); return; }

      await interaction.guild.members.ban(user.id, { reason });
      await interaction.reply(`🔨 <@${user.id}> was banned. Reason: ${reason}`);
      await logSystem.logAction(interaction.guild, `🔨 <@${user.id}> was banned by <@${interaction.user.id}>.\n**Reason:** ${reason}`);
    }

    else if (commandName === 'log') {
      const group = interaction.options.getSubcommandGroup(false);
      const subcommand = interaction.options.getSubcommand();

      if (!group && subcommand === 'setup') {
        if (!(await permissions.requirePermission(interaction, PermissionFlagsBits.ManageGuild, 'Manage Server'))) return;
        await interaction.reply({ content: 'Pick the channel everything gets logged to:', components: logSystem.buildSetupRows(), ephemeral: true });
      }

      else if (group === 'whitelist') {
        if (!(await permissions.requirePermission(interaction, PermissionFlagsBits.ManageGuild, 'Manage Server'))) return;

        if (subcommand === 'add') {
          const user = interaction.options.getUser('user');
          logSystem.addWhitelist(interaction.guild.id, user.id);
          await interaction.reply({ content: `✅ <@${user.id}> will no longer be logged.`, ephemeral: true });
        } else if (subcommand === 'remove') {
          const user = interaction.options.getUser('user');
          logSystem.removeWhitelist(interaction.guild.id, user.id);
          await interaction.reply({ content: `✅ <@${user.id}> will be logged again.`, ephemeral: true });
        } else if (subcommand === 'list') {
          const ids = logSystem.listWhitelist(interaction.guild.id);
          const ownerNote = `<@${interaction.guild.ownerId}> (server owner — always excluded)`;
          const list = ids.length > 0 ? ids.map(id => `<@${id}>`).join('\n') : '*(nobody else whitelisted)*';
          await interaction.reply({ content: `**Excluded from logging:**\n${ownerNote}\n${list}`, ephemeral: true });
        }
      }
    }

    else if (commandName === 'scamlist') {
      if (!(await permissions.requirePermission(interaction, PermissionFlagsBits.ManageGuild, 'Manage Server'))) return;

      const group = interaction.options.getSubcommandGroup();
      const subcommand = interaction.options.getSubcommand();

      if (group === 'word') {
        if (subcommand === 'add') await scamManagement.handleAddWord(interaction);
        else if (subcommand === 'remove') await scamManagement.handleRemoveWord(interaction);
        else if (subcommand === 'list') await scamManagement.handleListWords(interaction);
      } else if (group === 'whitelist') {
        if (subcommand === 'add') await scamManagement.handleAddWhitelist(interaction);
        else if (subcommand === 'remove') await scamManagement.handleRemoveWhitelist(interaction);
        else if (subcommand === 'list') await scamManagement.handleListWhitelist(interaction);
      }
    }

    else if (commandName === 'verify') {
      if (!(await permissions.requirePermission(interaction, PermissionFlagsBits.ManageGuild, 'Manage Server'))) return;

      const subcommand = interaction.options.getSubcommand();
      if (subcommand === 'setup') await verificationSystem.handleSetupOverview(interaction);
      else if (subcommand === 'panel') await verificationSystem.handlePostPanel(interaction);
    }

  } catch (error) {
    console.error(`Error handling command ${commandName}:`, error);
    if (interaction.replied || interaction.deferred) {
      await interaction.followUp({ content: 'Something went wrong running that command.', ephemeral: true });
    } else {
      await interaction.reply({ content: 'Something went wrong running that command.', ephemeral: true });
    }
  }
});

// ---- Embed builder: modal submissions ----
client.on('interactionCreate', async interaction => {
  if (!interaction.isModalSubmit()) return;
  if (!interaction.customId.startsWith('embed_')) return;

  try {
    const session = embedBuilder.getSession(interaction.user.id);
    const data = embedBuilder.currentEmbedData(session);

    if (interaction.customId === 'embed_basics_modal') {
      const title = interaction.fields.getTextInputValue('title');
      const description = interaction.fields.getTextInputValue('description');
      const colorInput = interaction.fields.getTextInputValue('color');
      const footer = interaction.fields.getTextInputValue('footer');
      const image = interaction.fields.getTextInputValue('image');

      if (image && !embedBuilder.isValidHttpUrl(image)) {
        await interaction.reply({ content: `⚠️ "${image}" isn't a valid image URL (needs to start with http:// or https://) — nothing was saved. Try again.`, ephemeral: true });
        return;
      }

      data.title = title || undefined;
      data.description = description || undefined;
      data.footer = footer || undefined;
      data.image = image || undefined;

      if (colorInput) {
        const parsed = embedBuilder.parseColor(colorInput);
        if (parsed === null) {
          await interaction.reply({ content: `⚠️ "${colorInput}" isn't a valid hex color (e.g. #5865F2) — everything else was saved.`, ephemeral: true });
          return;
        }
        data.color = parsed;
      } else {
        data.color = undefined;
      }
    }

    else if (interaction.customId === 'embed_addfield_modal') {
      const name = interaction.fields.getTextInputValue('name');
      const value = interaction.fields.getTextInputValue('value');
      const inlineInput = (interaction.fields.getTextInputValue('inline') || '').trim().toLowerCase();
      const inline = inlineInput === 'yes' || inlineInput === 'y' || inlineInput === 'true';

      if (data.fields.length >= 25) {
        await interaction.reply({ content: 'This embed already has the maximum of 25 fields.', ephemeral: true });
        return;
      }
      data.fields.push({ name, value, inline });
    }

    else if (interaction.customId === 'embed_removefield_modal') {
      const indexInput = parseInt(interaction.fields.getTextInputValue('index'), 10);
      if (isNaN(indexInput) || indexInput < 1 || indexInput > data.fields.length) {
        await interaction.reply({ content: `That's not a valid field number. This embed currently has ${data.fields.length} field(s).`, ephemeral: true });
        return;
      }
      data.fields.splice(indexInput - 1, 1);
    }

    else if (interaction.customId === 'embed_removebutton_modal') {
      const indexInput = parseInt(interaction.fields.getTextInputValue('index'), 10);
      if (isNaN(indexInput) || indexInput < 1 || indexInput > session.buttons.length) {
        await interaction.reply({ content: `That's not a valid button number. This message currently has ${session.buttons.length} button(s), numbered left to right in the preview.`, ephemeral: true });
        return;
      }
      const [removed] = session.buttons.splice(indexInput - 1, 1);
      // Clean up its stored reply text too, unless it's a link button (no registry entry)
      // or the fixed-purpose ticket_button shared elsewhere.
      if (removed.customId && removed.customId !== 'ticket_button') {
        buttonRegistry.deleteReply(removed.customId);
      }
    }

    else if (interaction.customId === 'embed_author_modal') {
      const name = interaction.fields.getTextInputValue('name');
      const iconURL = interaction.fields.getTextInputValue('iconURL');
      const url = interaction.fields.getTextInputValue('url');

      if (iconURL && !embedBuilder.isValidHttpUrl(iconURL)) {
        await interaction.reply({ content: `⚠️ "${iconURL}" isn't a valid icon URL (needs to start with http:// or https://) — nothing was saved. Try again.`, ephemeral: true });
        return;
      }
      if (url && !embedBuilder.isValidHttpUrl(url)) {
        await interaction.reply({ content: `⚠️ "${url}" isn't a valid link URL (needs to start with http:// or https://) — nothing was saved. Try again.`, ephemeral: true });
        return;
      }

      data.author = name ? { name, iconURL: iconURL || undefined, url: url || undefined } : undefined;
    }

    else if (interaction.customId === 'embed_thumbnail_modal') {
      const thumbnail = interaction.fields.getTextInputValue('thumbnail');
      if (thumbnail && !embedBuilder.isValidHttpUrl(thumbnail)) {
        await interaction.reply({ content: `⚠️ "${thumbnail}" isn't a valid thumbnail URL (needs to start with http:// or https://) — nothing was saved. Try again.`, ephemeral: true });
        return;
      }
      data.thumbnail = thumbnail || undefined;
    }

    else if (interaction.customId === 'embed_addbutton_modal') {
      const label = interaction.fields.getTextInputValue('label');
      const styleInput = interaction.fields.getTextInputValue('style').trim().toLowerCase();
      const target = interaction.fields.getTextInputValue('target');
      const replyText = interaction.fields.getTextInputValue('replyText');
      const emoji = interaction.fields.getTextInputValue('emoji');

      const ROLE_ACTIONS = {
        togglerole: { discordStyle: ButtonStyle.Primary, type: 'togglerole' },
        addrole: { discordStyle: ButtonStyle.Success, type: 'addrole' },
        giverole: { discordStyle: ButtonStyle.Success, type: 'addrole' }, // alias
        removerole: { discordStyle: ButtonStyle.Danger, type: 'removerole' },
      };

      if (styleInput === 'ticket') {
        session.buttons.push({ label, style: ButtonStyle.Success, customId: 'ticket_button', emoji: emoji || undefined });
      }

      else if (ROLE_ACTIONS[styleInput]) {
        const role = embedBuilder.resolveRole(interaction.guild, target);
        if (!role) {
          await interaction.reply({ content: `⚠️ I couldn't find a role called "${target}" in this server. Type its exact name (with or without @), or paste its numeric ID / an actual @mention instead.`, ephemeral: true });
          return;
        }

        const action = ROLE_ACTIONS[styleInput];
        const customId = embedBuilder.genButtonId();
        buttonRegistry.setConfig(customId, { type: action.type, roleId: role.id, text: replyText || undefined });
        session.buttons.push({ label, style: action.discordStyle, customId, emoji: emoji || undefined });
      }

      else {
        const style = embedBuilder.styleFromString(styleInput);
        if (style === null) {
          await interaction.reply({ content: `"${styleInput}" isn't a valid style/action. Use one of: link, primary, secondary, success, danger, ticket, togglerole, addrole, removerole.`, ephemeral: true });
          return;
        }

        if (style === ButtonStyle.Link) {
          if (!target || !embedBuilder.isValidHttpUrl(target)) {
            await interaction.reply({ content: 'Link-style buttons need a valid http(s) URL.', ephemeral: true });
            return;
          }
          session.buttons.push({ label, style, url: target, emoji: emoji || undefined });
        } else {
          const customId = embedBuilder.genButtonId();
          buttonRegistry.setConfig(customId, { type: 'message', text: replyText || 'This button has no reply text set.' });
          session.buttons.push({ label, style, customId, emoji: emoji || undefined });
        }
      }
    }

    const embedPreview = embedBuilder.buildAllEmbeds(session);
    embedBuilder.persist();
    const replyPayload = {
      content: embedBuilder.previewContent(session),
      embeds: embedPreview,
      components: embedBuilder.buildControlRows(session),
    };

    if (interaction.replied || interaction.deferred) {
      await interaction.followUp({ ...replyPayload, ephemeral: true });
    } else {
      await interaction.reply({ ...replyPayload, ephemeral: true });
    }

  } catch (error) {
    console.error('Error handling embed modal:', error);
    const errMsg = { content: 'Something went wrong building that embed. It may contain an invalid URL or a field that\'s too long.', ephemeral: true };
    if (interaction.replied || interaction.deferred) {
      await interaction.followUp(errMsg);
    } else {
      await interaction.reply(errMsg);
    }
  }
});

// ---- Embed builder: button clicks ----
client.on('interactionCreate', async interaction => {
  if (!interaction.isButton()) return;
  if (!interaction.customId.startsWith('embed_')) return;

  try {
    const session = embedBuilder.getSession(interaction.user.id);

    if (interaction.customId === 'embed_editbasics_button') {
      await interaction.showModal(embedBuilder.buildBasicsModal(embedBuilder.currentEmbedData(session)));
      return;
    }
    if (interaction.customId === 'embed_addfield_button') {
      await interaction.showModal(embedBuilder.buildFieldModal());
      return;
    }
    if (interaction.customId === 'embed_removefield_button') {
      await interaction.showModal(embedBuilder.buildRemoveFieldModal());
      return;
    }
    if (interaction.customId === 'embed_author_button') {
      await interaction.showModal(embedBuilder.buildAuthorModal());
      return;
    }
    if (interaction.customId === 'embed_thumbnail_button') {
      await interaction.showModal(embedBuilder.buildThumbnailModal());
      return;
    }
    if (interaction.customId === 'embed_addbutton_button') {
      await interaction.showModal(embedBuilder.buildAddButtonModal());
      return;
    }
    if (interaction.customId === 'embed_removebutton_button') {
      await interaction.showModal(embedBuilder.buildRemoveButtonModal());
      return;
    }

    if (interaction.customId === 'embed_newembed_button') {
      if (session.embeds.length >= 10) {
        await interaction.reply({ content: 'A message can have at most 10 embeds.', ephemeral: true });
        return;
      }
      embedBuilder.newEmbed(session);
    }

    else if (interaction.customId === 'embed_prevembed_button') {
      embedBuilder.switchEmbed(session, -1);
    }

    else if (interaction.customId === 'embed_nextembed_button') {
      embedBuilder.switchEmbed(session, 1);
    }

    else if (interaction.customId === 'embed_removeembed_button') {
      embedBuilder.removeCurrentEmbed(session);
    }

    else if (interaction.customId === 'embed_send_button') {
      const allEmbeds = embedBuilder.buildAllEmbeds(session);
      const buttonsRow = embedBuilder.buildButtonsRow(session);
      const componentsToSend = buttonsRow ? [buttonsRow] : [];

      if (session.editingMessageId) {
        const channel = await client.channels.fetch(session.editingChannelId);
        const message = await channel.messages.fetch(session.editingMessageId);
        await message.edit({ embeds: allEmbeds, components: componentsToSend });
        embedBuilder.clearSession(interaction.user.id);
        await interaction.update({ content: '✅ Changes saved!', embeds: allEmbeds, components: [] });
      } else {
        await interaction.channel.send({ embeds: allEmbeds, components: componentsToSend });
        embedBuilder.clearSession(interaction.user.id);
        await interaction.update({ content: '✅ Sent!', embeds: allEmbeds, components: [] });
      }
      return;
    }

    else if (interaction.customId === 'embed_cancel_button') {
      embedBuilder.clearSession(interaction.user.id);
      await interaction.update({ content: '❌ Cancelled.', embeds: [], components: [] });
      return;
    }

    // Default: re-render the preview after a simple state change (new/prev/next/remove embed)
    embedBuilder.persist();
    await interaction.update({
      content: embedBuilder.previewContent(session),
      embeds: embedBuilder.buildAllEmbeds(session),
      components: embedBuilder.buildControlRows(session),
    });

  } catch (error) {
    console.error('Error handling embed button:', error);
    const errMsg = { content: 'Something went wrong. The embed may have an invalid URL somewhere, or the original message may have been deleted.', ephemeral: true };
    if (interaction.replied || interaction.deferred) {
      await interaction.followUp(errMsg);
    } else {
      await interaction.reply(errMsg);
    }
  }
});

// ---- Custom "action" buttons on sent embed messages ----
client.on('interactionCreate', async interaction => {
  if (!interaction.isButton()) return;
  if (!interaction.customId.startsWith('userbtn_')) return;

  try {
    const config = buttonRegistry.getConfig(interaction.customId);
    if (!config) {
      await interaction.reply({ content: 'This button has no action configured.', ephemeral: true });
      return;
    }

    if (config.type === 'togglerole' || config.type === 'addrole' || config.type === 'removerole') {
      if (!interaction.guild) {
        await interaction.reply({ content: 'Role buttons only work inside a server.', ephemeral: true });
        return;
      }

      const role = interaction.guild.roles.cache.get(config.roleId);
      if (!role) {
        await interaction.reply({ content: 'The role this button uses no longer exists — ask a staff member to fix it.', ephemeral: true });
        return;
      }

      const member = interaction.member;
      const has = member.roles.cache.has(config.roleId);
      let outcome;

      try {
        if (config.type === 'addrole') {
          outcome = has ? 'already-has' : 'added';
          if (!has) await member.roles.add(config.roleId);
        } else if (config.type === 'removerole') {
          outcome = has ? 'removed' : 'already-lacks';
          if (has) await member.roles.remove(config.roleId);
        } else { // togglerole
          outcome = has ? 'removed' : 'added';
          await member.roles[has ? 'remove' : 'add'](config.roleId);
        }
      } catch (roleErr) {
        console.error('[embed buttons] Failed to change role:', roleErr.message);
        if (roleErr.code === 50013) {
          await interaction.reply({ content: `⚠️ I can't give/remove <@&${config.roleId}> — either I'm missing the **Manage Roles** permission, or my own role needs to be moved **above** <@&${config.roleId}> in Server Settings → Roles. Both have to be true for this to work.`, ephemeral: true });
        } else {
          await interaction.reply({ content: `⚠️ Something went wrong changing that role: ${roleErr.message}`, ephemeral: true });
        }
        return;
      }

      const defaultMessages = {
        added: `✅ You now have the <@&${config.roleId}> role.`,
        removed: `✅ The <@&${config.roleId}> role has been removed.`,
        'already-has': `You already have the <@&${config.roleId}> role.`,
        'already-lacks': `You don't have the <@&${config.roleId}> role.`,
      };

      const confirmEmbed = new EmbedBuilder().setDescription(config.text || defaultMessages[outcome]).setColor(0x5865F2);
      await interaction.reply({ embeds: [confirmEmbed], ephemeral: true });
      return;
    }

    // Default: plain message button — ALWAYS a private (ephemeral), embedded reply.
    const messageContent = config.text || 'This button has no reply configured.';
    const embed = new EmbedBuilder().setDescription(messageContent).setColor(0x5865F2);
    await interaction.reply({ embeds: [embed], ephemeral: true });
  } catch (error) {
    console.error('Error handling custom action button:', error);
    const errMsg = { content: "Something went wrong performing this button's action — I may be missing a needed permission (Manage Roles for role buttons, or View Channel/Send Messages for the target channel), or my role may be positioned below the role it's trying to change.", ephemeral: true };
    if (interaction.replied || interaction.deferred) {
      await interaction.followUp(errMsg);
    } else {
      await interaction.reply(errMsg);
    }
  }
});

// ---- Verification system ----
client.on('interactionCreate', async interaction => {
  try {
    if (interaction.isButton() && interaction.customId === 'verify_start_button') {
      await verificationSystem.handleVerifyStart(interaction);
      return;
    }
    if (interaction.isButton() && interaction.customId === 'verify_captcha_answer_button') {
      await verificationSystem.handleCaptchaAnswerButton(interaction);
      return;
    }
    if (interaction.isModalSubmit() && interaction.customId === 'verify_captcha_modal') {
      await verificationSystem.handleCaptchaModalSubmit(interaction);
      return;
    }
    if (interaction.isButton() && interaction.customId.startsWith('verifysetup_method_')) {
      await verificationSystem.handleSetupButton(interaction);
      return;
    }
    if (interaction.isButton() && interaction.customId.startsWith('verifysetup_difficulty_')) {
      await verificationSystem.handleSetupButton(interaction);
      return;
    }
    if (interaction.isRoleSelectMenu() && interaction.customId === 'verifysetup_role') {
      await verificationSystem.handleSetupRoleSelect(interaction);
      return;
    }
  } catch (error) {
    console.error('Error handling verification interaction:', error);
    const errMsg = { content: 'Something went wrong with verification. Please try again or tell an admin.', ephemeral: true };
    if (interaction.replied || interaction.deferred) {
      await interaction.followUp(errMsg);
    } else {
      await interaction.reply(errMsg);
    }
  }
});

// ---- Ticket system ----
client.on('interactionCreate', async interaction => {
  if (interaction.isButton() && interaction.customId === 'ticket_button') {
    try {
      await interaction.showModal(ticketSystem.buildTicketModal());
    } catch (error) {
      console.error('Error opening ticket modal:', error);
    }
    return;
  }

  if (interaction.isModalSubmit() && interaction.customId === 'ticket_modal') {
    try {
      await ticketSystem.handleSubmit(interaction, client);
    } catch (error) {
      console.error('Error handling ticket submission:', error);
      await interaction.reply({ content: 'Something went wrong creating your ticket. Please tell an admin.', ephemeral: true }).catch(() => {});
    }
    return;
  }

  if (interaction.isButton() && interaction.customId.startsWith('ticket_close_')) {
    try {
      await ticketSystem.handleCloseButtonClick(interaction);
    } catch (error) {
      console.error('Error opening ticket close modal:', error);
    }
    return;
  }

  if (interaction.isModalSubmit() && interaction.customId.startsWith('ticket_close_reason_modal_')) {
    try {
      await ticketSystem.handleCloseReasonSubmit(interaction);
    } catch (error) {
      console.error('Error closing ticket:', error);
    }
  }
});

// ---- Setup wizard: select menus and AutoMod button ----
client.on('interactionCreate', async interaction => {
  try {
    if ((interaction.isChannelSelectMenu() || interaction.isRoleSelectMenu()) && interaction.customId.startsWith('setup_')) {
      await setupWizard.handleSelectMenu(interaction);
      return;
    }
    if ((interaction.isChannelSelectMenu() || interaction.isRoleSelectMenu()) && interaction.customId.startsWith('ticketsetup_')) {
      await ticketSystem.handleSetupSelect(interaction);
      return;
    }
    if (interaction.isChannelSelectMenu() && interaction.customId === 'log_setup_channel') {
      await logSystem.handleSetupChannelSelect(interaction);
      return;
    }
  } catch (error) {
    console.error('Error handling setup interaction:', error);
    const errMsg = { content: 'Something went wrong saving that setting.', ephemeral: true };
    if (interaction.replied || interaction.deferred) {
      await interaction.followUp(errMsg);
    } else {
      await interaction.reply(errMsg);
    }
  }
});

// ---- Join/leave messages, auto-role, invite tracking ----
client.on('guildMemberAdd', async member => {
  try {
    // Auto-role(s) — supports any number of roles, not just one.
    // Back-compat: an older single "autoRoleId" saved before this upgrade still applies
    // until the admin re-picks roles in /setup, at which point autoRoleIds takes over.
    let autoRoleIds = settingsStore.get('autoRoleIds', null);
    if (autoRoleIds === null) {
      const legacySingleRoleId = settingsStore.get('autoRoleId', '');
      autoRoleIds = legacySingleRoleId ? [legacySingleRoleId] : (config.joinLeaveSystem.autoRoleIds || []);
    }
    if (autoRoleIds.length > 0) {
      await member.roles.add(autoRoleIds).catch(err => console.error('[joinLeave] Failed to assign auto-role(s):', err.message));
    }

    if (!config.joinLeaveSystem.enabled) return;

    const inviteInfo = await inviteTracker.resolveUsedInvite(member.guild);

    const joinChannelId = settingsStore.get('joinChannelId', config.joinLeaveSystem.joinChannelId);
    if (joinChannelId) {
      const channel = await member.guild.channels.fetch(joinChannelId).catch(() => null);
      if (channel) {
        const payload = await joinLeaveSystem.buildJoinLeavePayload(config.joinLeaveSystem.joinMessage, member, inviteInfo, 'join');
        await channel.send(payload).catch(err => console.error('[joinLeave] Failed to send join message:', err.message));
      }
    }
  } catch (error) {
    console.error('Error handling guildMemberAdd:', error);
  }
});

client.on('guildMemberRemove', async member => {
  try {
    if (!config.joinLeaveSystem.enabled) return;

    const leaveChannelId = settingsStore.get('leaveChannelId', config.joinLeaveSystem.leaveChannelId);
    if (leaveChannelId) {
      const channel = await member.guild.channels.fetch(leaveChannelId).catch(() => null);
      if (channel) {
        const payload = await joinLeaveSystem.buildJoinLeavePayload(config.joinLeaveSystem.leaveMessage, member, null, 'leave');
        await channel.send(payload).catch(err => console.error('[joinLeave] Failed to send leave message:', err.message));
      }
    }
  } catch (error) {
    console.error('Error handling guildMemberRemove:', error);
  }
});

client.on('inviteCreate', invite => inviteTracker.onInviteChange(invite.guild));
client.on('inviteDelete', invite => inviteTracker.onInviteChange(invite.guild));
client.on('guildCreate', guild => inviteTracker.cacheGuildInvites(guild));

// ---- General server log ----
client.on('messageDelete', message => logSystem.logMessageDelete(message).catch(err => console.error('[logSystem] messageDelete failed:', err.message)));
client.on('messageUpdate', (oldMessage, newMessage) => logSystem.logMessageEdit(oldMessage, newMessage).catch(err => console.error('[logSystem] messageUpdate failed:', err.message)));
client.on('guildBanAdd', ban => logSystem.logGuildBanAdd(ban).catch(err => console.error('[logSystem] guildBanAdd failed:', err.message)));
client.on('guildBanRemove', ban => logSystem.logGuildBanRemove(ban).catch(err => console.error('[logSystem] guildBanRemove failed:', err.message)));

// ---- Leveling system: setup menu, modals, selects, buttons ----
client.on('interactionCreate', async interaction => {
  try {
    // Top-level "what do you want to configure?" menu
    if (interaction.isStringSelectMenu() && interaction.customId === 'level_setup_menu') {
      const config = levelSystem.getConfig(interaction.guild.id);
      const choice = interaction.values[0];
      if (choice === 'xp') { await interaction.showModal(levelSystem.buildXpModal(config)); return; }
      if (choice === 'general') { await interaction.showModal(levelSystem.buildGeneralModal(config)); return; }
      if (choice === 'restrictions') { await interaction.reply({ content: 'Configure XP restrictions below:', components: levelSystem.buildRestrictionsRows(), ephemeral: true }); return; }
      if (choice === 'boosters') { await interaction.reply({ content: 'Configure XP boosters below:', components: levelSystem.buildBoostersPanelRows(config), ephemeral: true }); return; }
      if (choice === 'rewards') { await interaction.reply({ content: 'Configure role rewards below:', components: levelSystem.buildRewardsPanelRows(config), ephemeral: true }); return; }
      if (choice === 'levelup') { await interaction.reply({ content: 'Configure the level-up announcement below:', components: levelSystem.buildLevelupPanelRows(config), ephemeral: true }); return; }
      if (choice === 'firstplace') { await interaction.reply({ content: 'Pick the role for the #1 ranked member:', components: levelSystem.buildFirstPlaceRow(), ephemeral: true }); return; }
      if (choice === 'highlights') { await interaction.reply({ content: 'Pick the channel for weekly/monthly top-10 auto-posts:', components: levelSystem.buildHighlightsRow(), ephemeral: true }); return; }
      return;
    }

    // Modals
    if (interaction.isModalSubmit() && interaction.customId === 'level_setup_xp_modal') {
      const { error } = levelSystem.handleXpModalSubmit(interaction);
      await interaction.reply({ content: error ? `⚠️ ${error}` : '✅ XP options saved.', ephemeral: true });
      return;
    }
    if (interaction.isModalSubmit() && interaction.customId === 'level_setup_general_modal') {
      const { error } = levelSystem.handleGeneralModalSubmit(interaction);
      await interaction.reply({ content: error ? `⚠️ ${error}` : '✅ Saved.', ephemeral: true });
      return;
    }
    if (interaction.isModalSubmit() && interaction.customId.startsWith('level_booster_percent_modal_')) {
      const { error, kind, id, percent } = levelSystem.handlePercentModalSubmit(interaction);
      await interaction.reply({ content: error ? `⚠️ ${error}` : `✅ ${kind === 'role' ? `<@&${id}>` : `<#${id}>`} now boosts XP by +${percent}%.`, ephemeral: true });
      return;
    }
    if (interaction.isModalSubmit() && interaction.customId === 'level_reward_addlevel_modal') {
      const { error, level } = levelSystem.handleRewardLevelModalSubmit(interaction);
      if (error) { await interaction.reply({ content: `⚠️ ${error}`, ephemeral: true }); return; }
      await interaction.reply({ content: `Now pick the role to give at level ${level}:`, components: [levelSystem.buildRewardRoleSelectRow(level)], ephemeral: true });
      return;
    }
    if (interaction.isModalSubmit() && interaction.customId === 'level_levelup_message_modal') {
      levelSystem.handleLevelupMessageModalSubmit(interaction);
      await interaction.reply({ content: '✅ Level-up message updated.', ephemeral: true });
      return;
    }

    // Selects
    if (interaction.isChannelSelectMenu() && ['level_restrict_noxpchannels', 'level_restrict_xpchannels'].includes(interaction.customId)) {
      await levelSystem.handleRestrictionSelect(interaction);
      return;
    }
    if (interaction.isRoleSelectMenu() && interaction.customId === 'level_restrict_noxproles') {
      await levelSystem.handleRestrictionSelect(interaction);
      return;
    }
    if (interaction.isRoleSelectMenu() && interaction.customId === 'level_booster_addrole_select') {
      await interaction.showModal(levelSystem.buildPercentModal('role', interaction.values[0]));
      return;
    }
    if (interaction.isChannelSelectMenu() && interaction.customId === 'level_booster_addchannel_select') {
      await interaction.showModal(levelSystem.buildPercentModal('channel', interaction.values[0]));
      return;
    }
    if (interaction.isStringSelectMenu() && interaction.customId === 'level_booster_remove_select') {
      await levelSystem.handleBoosterRemoveSelect(interaction);
      return;
    }
    if (interaction.isRoleSelectMenu() && interaction.customId.startsWith('level_reward_addrole_select_')) {
      await levelSystem.handleRewardRoleSelect(interaction);
      return;
    }
    if (interaction.isStringSelectMenu() && interaction.customId === 'level_reward_remove_select') {
      await levelSystem.handleRewardRemoveSelect(interaction);
      return;
    }
    if (interaction.isChannelSelectMenu() && interaction.customId === 'level_levelup_channel_select') {
      await levelSystem.handleLevelupChannelSelect(interaction);
      return;
    }
    if (interaction.isRoleSelectMenu() && interaction.customId === 'level_firstplace_role_select') {
      await levelSystem.handleFirstPlaceSelect(interaction);
      return;
    }
    if (interaction.isChannelSelectMenu() && interaction.customId === 'level_highlights_channel_select') {
      await levelSystem.handleHighlightsSelect(interaction);
      return;
    }

    // Buttons
    if (interaction.isButton() && interaction.customId === 'level_booster_stack_toggle') { await levelSystem.handleBoosterStackToggle(interaction); return; }
    if (interaction.isButton() && interaction.customId === 'level_booster_list') { await levelSystem.handleBoosterList(interaction); return; }
    if (interaction.isButton() && interaction.customId === 'level_reward_add_button') { await interaction.showModal(levelSystem.buildRewardLevelModal()); return; }
    if (interaction.isButton() && interaction.customId === 'level_reward_stack_toggle') { await levelSystem.handleRewardStackToggle(interaction); return; }
    if (interaction.isButton() && interaction.customId === 'level_reward_list') { await levelSystem.handleRewardList(interaction); return; }
    if (interaction.isButton() && interaction.customId === 'level_levelup_enabled_toggle') { await levelSystem.handleLevelupEnabledToggle(interaction); return; }
    if (interaction.isButton() && interaction.customId === 'level_levelup_dm_toggle') { await levelSystem.handleLevelupDmToggle(interaction); return; }
    if (interaction.isButton() && interaction.customId === 'level_levelup_message_button') {
      const config = levelSystem.getConfig(interaction.guild.id);
      await interaction.showModal(levelSystem.buildLevelupMessageModal(config));
      return;
    }
  } catch (error) {
    console.error('Error handling leveling interaction:', error);
    const errMsg = { content: 'Something went wrong saving that setting.', ephemeral: true };
    if (interaction.replied || interaction.deferred) await interaction.followUp(errMsg);
    else await interaction.reply(errMsg);
  }
});

// ---- Warning system: setup menu, modals, selects, buttons ----
client.on('interactionCreate', async interaction => {
  try {
    if (interaction.isChannelSelectMenu() && interaction.customId === 'warn_setup_logchannel') {
      await warnSystem.handleLogChannelSelect(interaction);
      return;
    }
    if (interaction.isButton() && interaction.customId === 'warn_setup_addescalation') {
      await interaction.showModal(warnSystem.buildEscalationModal());
      return;
    }
    if (interaction.isButton() && interaction.customId === 'warn_setup_listescalation') {
      await warnSystem.handleListEscalations(interaction);
      return;
    }
    if (interaction.isStringSelectMenu() && interaction.customId === 'warn_escalation_remove_select') {
      await warnSystem.handleEscalationRemoveSelect(interaction);
      return;
    }
    if (interaction.isModalSubmit() && interaction.customId === 'warn_escalation_modal') {
      const { error, count, action, muteDurationMinutes } = warnSystem.handleEscalationModalSubmit(interaction);
      await interaction.reply({ content: error ? `⚠️ ${error}` : `✅ At ${count} warning(s), members will now be **${action}**${action === 'mute' ? ` for ${muteDurationMinutes} minute(s)` : ''}.`, ephemeral: true });
      return;
    }
  } catch (error) {
    console.error('Error handling warn interaction:', error);
    const errMsg = { content: 'Something went wrong saving that setting.', ephemeral: true };
    if (interaction.replied || interaction.deferred) await interaction.followUp(errMsg);
    else await interaction.reply(errMsg);
  }
});

// ---- Activity role tracking ----

// Fires on every new message in the server
client.on('messageCreate', async message => {
  if (message.author.bot || !message.guild) return;

  try {
    const member = message.member || await message.guild.members.fetch(message.author.id).catch(() => null);
    await handleActivity(member);
    await levelSystem.handleMessageXp(message).catch(err => console.error('[levelSystem] message XP failed:', err.message));

    // Scam detection — skip staff (Administrator or Manage Messages) so mods/admins are never auto-banned
    const isStaff = member && (member.permissions.has(PermissionFlagsBits.Administrator) || member.permissions.has(PermissionFlagsBits.ManageMessages));
    if (member && !isStaff) {

      // --- Slur detection (soft/hard, bypass-resistant) ---
      const slurResult = slurDetector.detect(message.content);
      if (slurResult && slurResult.flagged) {
        console.log(`[slur-detection] Flagged ${message.author.tag} (${slurResult.severity}): "${slurResult.matched}"`);
        await message.delete().catch(() => {});

        const action = slurResult.severity === 'hard' ? config.slurDetection.hardAction : config.slurDetection.softAction;
        if (action === 'ban') {
          await message.guild.members.ban(message.author.id, { reason: `Auto-ban: ${slurResult.severity} slur detected` }).catch(err => console.error('[slur-detection] Ban failed:', err.message));
        } else {
          await member.timeout(config.slurDetection.softMuteMinutes * 60 * 1000, `Auto-mute: ${slurResult.severity} slur detected`).catch(err => console.error('[slur-detection] Mute failed:', err.message));
        }

        await moderationLog.postBlockLog(message.guild, {
          user: message.author,
          reason: `${slurResult.severity} slur detected (${action === 'ban' ? 'banned' : 'muted'})`,
          category: 'Slur detection',
          messageContent: message.content,
        });
        return;
      }

      // --- Text-based scam detection (links, keywords, rapid-fire, malware attachments) ---
      const result = scamDetector.checkMessage(message);
      if (result && result.flagged) {
        console.log(`[scam-detection] Flagged ${message.author.tag}: ${result.reason}`);

        let dmText = config.scamDetection.banDmMessage.replace('{serverName}', message.guild.name);
        if (config.scamDetection.appealServerInvite) {
          dmText += `\n\nAppeal here: ${config.scamDetection.appealServerInvite}`;
        }

        try {
          await message.author.send(dmText);
        } catch (dmErr) {
          console.log(`[scam-detection] Could not DM ${message.author.tag} before banning (their DMs are likely closed).`);
        }

        await message.delete().catch(() => {});

        try {
          await message.guild.members.ban(message.author.id, { reason: `Auto-ban: suspected scam — ${result.reason}` });
          console.log(`[scam-detection] Banned ${message.author.tag}: ${result.reason}`);
        } catch (banErr) {
          console.error(`[scam-detection] Failed to ban ${message.author.tag}:`, banErr.message);
        }

        await moderationLog.postBlockLog(message.guild, {
          user: message.author, reason: result.reason, category: 'Scam detection (text)', messageContent: message.content,
        });

        return; // don't run anything else on this message
      }

      // --- Image/video OCR scam detection ---
      for (const attachment of message.attachments.values()) {
        const imageResult = await imageScamDetector.checkImageAttachment(attachment, message.channel.id).catch(err => {
          console.error('[imageScamDetector] Error:', err.message);
          return null;
        });
        if (imageResult && imageResult.flagged) {
          console.log(`[image-scam-detection] Flagged ${message.author.tag}: ${imageResult.reason}`);
          await message.delete().catch(() => {});
          await message.guild.members.ban(message.author.id, { reason: `Auto-ban: ${imageResult.reason}` }).catch(err => console.error('[image-scam-detection] Ban failed:', err.message));
          await moderationLog.postBlockLog(message.guild, {
            user: message.author, reason: imageResult.reason, category: 'Scam/slur detection (image)', imageUrl: attachment.url,
          });
          return;
        }

        const videoResult = await videoScamDetector.checkVideoAttachment(attachment, message.channel.id).catch(err => {
          console.error('[videoScamDetector] Error:', err.message);
          return null;
        });
        if (videoResult && videoResult.flagged) {
          console.log(`[video-scam-detection] Flagged ${message.author.tag}: ${videoResult.reason}`);
          await message.delete().catch(() => {});
          await message.guild.members.ban(message.author.id, { reason: `Auto-ban: ${videoResult.reason}` }).catch(err => console.error('[video-scam-detection] Ban failed:', err.message));
          await moderationLog.postBlockLog(message.guild, {
            user: message.author, reason: videoResult.reason, category: 'Scam/slur detection (video)', imageUrl: attachment.url,
          });
          return;
        }
      }
    }
  } catch (err) {
    console.error('[activity] Error handling message activity:', err.message);
  }
});

// Fires on every reaction added in the server
client.on('messageReactionAdd', async (reaction, user) => {
  if (user.bot) return;

  try {
    if (reaction.partial) await reaction.fetch();
    if (reaction.message.partial) await reaction.message.fetch();

    const guild = reaction.message.guild;
    if (!guild) return;

    const member = await guild.members.fetch(user.id).catch(() => null);
    await handleActivity(member);
    await levelSystem.handleReactionXp(reaction, user).catch(err => console.error('[levelSystem] reaction XP failed:', err.message));
  } catch (err) {
    console.error('[activity] Error handling reaction activity:', err.message);
  }
});

client.login(process.env.DISCORD_TOKEN);
