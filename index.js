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
const applicationSystem = require('./applicationSystem.js');
const ticketSystem = require('./ticketSystem.js');
const settingsStore = require('./settingsStore.js');
const inviteTracker = require('./inviteTracker.js');
const joinLeaveSystem = require('./joinLeaveSystem.js');
const setupWizard = require('./setupWizard.js');
const permissions = require('./permissions.js');
const requestCommands = require('./requestCommands.js');

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
        .setRequired(true)),

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
        .setDescription('Set up join/leave channels, auto-role, and ticket support role/category'))
    .addSubcommand(sub =>
      sub.setName('applications')
        .setDescription('Set up the 4 application channels'))
    .addSubcommand(sub =>
      sub.setName('automod')
        .setDescription('Create recommended AutoMod rules for this server')),

  new SlashCommandBuilder()
    .setName('request')
    .setDescription('Perform a moderation/server-management action')
    .setDefaultMemberPermissions(0) // hidden from everyone by default — grant access per-role in Server Settings > Integrations
    .addSubcommand(sub =>
      sub.setName('kick')
        .setDescription('Kick a member')
        .addUserOption(o => o.setName('target').setDescription('Member to kick').setRequired(true))
        .addStringOption(o => o.setName('reason').setDescription('Reason').setRequired(false)))
    .addSubcommand(sub =>
      sub.setName('ban')
        .setDescription('Ban a member')
        .addUserOption(o => o.setName('target').setDescription('Member to ban').setRequired(true))
        .addStringOption(o => o.setName('reason').setDescription('Reason').setRequired(false)))
    .addSubcommand(sub =>
      sub.setName('unban')
        .setDescription('Unban a user by ID')
        .addStringOption(o => o.setName('user_id').setDescription('The user ID to unban').setRequired(true)))
    .addSubcommand(sub =>
      sub.setName('mute')
        .setDescription('Timeout (mute) a member')
        .addUserOption(o => o.setName('target').setDescription('Member to mute').setRequired(true))
        .addIntegerOption(o => o.setName('duration_minutes').setDescription('How long, in minutes (max 40320)').setRequired(true))
        .addStringOption(o => o.setName('reason').setDescription('Reason').setRequired(false)))
    .addSubcommand(sub =>
      sub.setName('unmute')
        .setDescription('Remove a timeout from a member')
        .addUserOption(o => o.setName('target').setDescription('Member to unmute').setRequired(true)))
    .addSubcommand(sub =>
      sub.setName('createchannel')
        .setDescription('Create a channel')
        .addStringOption(o => o.setName('name').setDescription('Channel name').setRequired(true))
        .addStringOption(o => o.setName('type').setDescription('Channel type').setRequired(true)
          .addChoices({ name: 'Text', value: 'text' }, { name: 'Voice', value: 'voice' }, { name: 'Category', value: 'category' })))
    .addSubcommand(sub =>
      sub.setName('deletechannel')
        .setDescription('Delete a channel')
        .addChannelOption(o => o.setName('channel').setDescription('Channel to delete').setRequired(true)))
    .addSubcommand(sub =>
      sub.setName('editchannel')
        .setDescription('Rename or change the topic of a channel')
        .addChannelOption(o => o.setName('channel').setDescription('Channel to edit').setRequired(true))
        .addStringOption(o => o.setName('new_name').setDescription('New channel name').setRequired(false))
        .addStringOption(o => o.setName('topic').setDescription('New channel topic').setRequired(false)))
    .addSubcommand(sub =>
      sub.setName('createrole')
        .setDescription('Create a role')
        .addStringOption(o => o.setName('name').setDescription('Role name').setRequired(true))
        .addStringOption(o => o.setName('color').setDescription('Hex color, e.g. #5865F2').setRequired(false)))
    .addSubcommand(sub =>
      sub.setName('deleterole')
        .setDescription('Delete a role')
        .addRoleOption(o => o.setName('role').setDescription('Role to delete').setRequired(true))),
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
});

// ---- Handle slash command interactions ----
client.on('interactionCreate', async interaction => {
  if (!interaction.isChatInputCommand()) return;

  const { commandName } = interaction;

  try {
    if (commandName === 'ping') {
      const latency = Date.now() - interaction.createdTimestamp;
      await interaction.reply({ content: `🏓 Pong! Latency: ${latency}ms | API Latency: ${Math.round(client.ws.ping)}ms`, ephemeral: true });
    }

    else if (commandName === 'addactivityrole') {
      if (!(await permissions.requirePermission(interaction, PermissionFlagsBits.ManageRoles, 'Manage Roles'))) return;
      const requiredRole = interaction.options.getRole('required');
      const activeRole = interaction.options.getRole('active');

      roleManager.addPair(requiredRole.id, activeRole.id);
      await interaction.reply(`✅ Members with **${requiredRole.name}** will now get **${activeRole.name}** while active (10 min inactivity timeout).`);
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
        await interaction.reply({ content: 'Pick your join channel, leave channel, auto-role, ticket support role, and ticket category below. Each saves the moment you pick it.', components: setupWizard.buildGeneralSetupRows(), ephemeral: true });
      } else if (subcommand === 'applications') {
        await interaction.reply({ content: 'Pick your 4 application channels below. Each saves the moment you pick it.', components: setupWizard.buildApplicationSetupRows(), ephemeral: true });
      } else if (subcommand === 'automod') {
        await interaction.reply({ content: 'Click below to create a starter set of AutoMod rules.', components: setupWizard.buildAutomodSetupRow(), ephemeral: true });
      }
    }

    else if (commandName === 'request') {
      const subcommand = interaction.options.getSubcommand();

      if (subcommand === 'kick') await requestCommands.handleKick(interaction);
      else if (subcommand === 'ban') await requestCommands.handleBan(interaction);
      else if (subcommand === 'unban') await requestCommands.handleUnban(interaction);
      else if (subcommand === 'mute') await requestCommands.handleMute(interaction);
      else if (subcommand === 'unmute') await requestCommands.handleUnmute(interaction);
      else if (subcommand === 'createchannel') await requestCommands.handleCreateChannel(interaction);
      else if (subcommand === 'deletechannel') await requestCommands.handleDeleteChannel(interaction);
      else if (subcommand === 'editchannel') await requestCommands.handleEditChannel(interaction);
      else if (subcommand === 'createrole') await requestCommands.handleCreateRole(interaction);
      else if (subcommand === 'deleterole') await requestCommands.handleDeleteRole(interaction);
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

    else if (interaction.customId === 'embed_author_modal') {
      const name = interaction.fields.getTextInputValue('name');
      const iconURL = interaction.fields.getTextInputValue('iconURL');
      const url = interaction.fields.getTextInputValue('url');
      data.author = name ? { name, iconURL: iconURL || undefined, url: url || undefined } : undefined;
    }

    else if (interaction.customId === 'embed_thumbnail_modal') {
      data.thumbnail = interaction.fields.getTextInputValue('thumbnail') || undefined;
    }

    else if (interaction.customId === 'embed_addbutton_modal') {
      const label = interaction.fields.getTextInputValue('label');
      const styleInput = interaction.fields.getTextInputValue('style').trim().toLowerCase();
      const url = interaction.fields.getTextInputValue('url');
      const replyText = interaction.fields.getTextInputValue('replyText');
      const emoji = interaction.fields.getTextInputValue('emoji');

      if (styleInput === 'application' || styleInput === 'app') {
        session.buttons.push({ label, style: ButtonStyle.Primary, customId: 'apply_button', emoji: emoji || undefined });
      }

      else if (styleInput === 'ticket') {
        session.buttons.push({ label, style: ButtonStyle.Success, customId: 'ticket_button', emoji: emoji || undefined });
      }

      else {
        const style = embedBuilder.styleFromString(styleInput);
        if (style === null) {
          await interaction.reply({ content: `"${styleInput}" isn't a valid style. Use one of: link, primary, secondary, success, danger, application, ticket.`, ephemeral: true });
          return;
        }

        if (style === ButtonStyle.Link) {
          if (!url || !embedBuilder.isValidHttpUrl(url)) {
            await interaction.reply({ content: 'Link-style buttons need a valid http(s) URL.', ephemeral: true });
            return;
          }
          session.buttons.push({ label, style, url, emoji: emoji || undefined });
        } else {
          const customId = embedBuilder.genButtonId();
          buttonRegistry.setReply(customId, replyText || 'This button has no reply text set.');
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

// ---- Custom "reply" buttons on sent embed messages ----
client.on('interactionCreate', async interaction => {
  if (!interaction.isButton()) return;
  if (!interaction.customId.startsWith('userbtn_')) return;

  try {
    const replyText = buttonRegistry.getReply(interaction.customId);
    await interaction.reply({ content: replyText || 'This button has no reply configured.', ephemeral: true });
  } catch (error) {
    console.error('Error handling custom reply button:', error);
  }
});

// ---- Application system ----
client.on('interactionCreate', async interaction => {
  if (interaction.isButton() && interaction.customId === 'apply_button') {
    try {
      await interaction.showModal(applicationSystem.buildApplicationModal());
    } catch (error) {
      console.error('Error opening application modal:', error);
    }
    return;
  }

  if (interaction.isModalSubmit() && interaction.customId === 'application_modal') {
    try {
      await applicationSystem.handleSubmit(interaction, client);
    } catch (error) {
      console.error('Error handling application submission:', error);
      await interaction.reply({ content: 'Something went wrong submitting your application. Please tell an admin.', ephemeral: true }).catch(() => {});
    }
    return;
  }

  if (interaction.isButton() && (interaction.customId.startsWith('app_accept_') || interaction.customId.startsWith('app_deny_'))) {
    const isStaff = interaction.memberPermissions.has(PermissionFlagsBits.Administrator) || interaction.memberPermissions.has(PermissionFlagsBits.ManageMessages);
    if (!isStaff) {
      await interaction.reply({ content: 'Only staff can accept or deny applications.', ephemeral: true });
      return;
    }
    try {
      const decision = interaction.customId.startsWith('app_accept_') ? 'accepted' : 'denied';
      await applicationSystem.handleDecision(interaction, client, decision);
    } catch (error) {
      console.error('Error handling application decision:', error);
      await interaction.reply({ content: 'Something went wrong processing that decision.', ephemeral: true }).catch(() => {});
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
      await ticketSystem.handleClose(interaction);
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
    if (interaction.isButton() && interaction.customId === 'setup_automod_button') {
      await setupWizard.handleAutomodButton(interaction);
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
    // Auto-role
    const autoRoleId = settingsStore.get('autoRoleId', config.joinLeaveSystem.autoRoleId);
    if (autoRoleId) {
      await member.roles.add(autoRoleId).catch(err => console.error('[joinLeave] Failed to assign auto-role:', err.message));
    }

    if (!config.joinLeaveSystem.enabled) return;

    const inviteInfo = await inviteTracker.resolveUsedInvite(member.guild);

    const joinChannelId = settingsStore.get('joinChannelId', config.joinLeaveSystem.joinChannelId);
    if (joinChannelId) {
      const channel = await member.guild.channels.fetch(joinChannelId).catch(() => null);
      if (channel) {
        const text = joinLeaveSystem.fillPlaceholders(config.joinLeaveSystem.joinMessage, member, inviteInfo);
        await channel.send(text).catch(err => console.error('[joinLeave] Failed to send join message:', err.message));
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
        const text = joinLeaveSystem.fillPlaceholders(config.joinLeaveSystem.leaveMessage, member, null);
        await channel.send(text).catch(err => console.error('[joinLeave] Failed to send leave message:', err.message));
      }
    }
  } catch (error) {
    console.error('Error handling guildMemberRemove:', error);
  }
});

client.on('inviteCreate', invite => inviteTracker.onInviteChange(invite.guild));
client.on('inviteDelete', invite => inviteTracker.onInviteChange(invite.guild));
client.on('guildCreate', guild => inviteTracker.cacheGuildInvites(guild));

// ---- Activity role tracking ----

// Fires on every new message in the server
client.on('messageCreate', async message => {
  if (message.author.bot || !message.guild) return;

  try {
    const member = message.member || await message.guild.members.fetch(message.author.id).catch(() => null);
    await handleActivity(member);

    // Scam detection — skip staff (Administrator or Manage Messages) so mods/admins are never auto-banned
    const isStaff = member && (member.permissions.has(PermissionFlagsBits.Administrator) || member.permissions.has(PermissionFlagsBits.ManageMessages));
    if (member && !isStaff) {
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

        return; // don't run anything else on this message
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
  } catch (err) {
    console.error('[activity] Error handling reaction activity:', err.message);
  }
});

client.login(process.env.DISCORD_TOKEN);
