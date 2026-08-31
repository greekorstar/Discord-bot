// index.js — Main bot file
require('dotenv').config();
const { Client, GatewayIntentBits, Partials, REST, Routes, SlashCommandBuilder, EmbedBuilder, PermissionFlagsBits } = require('discord.js');
require('./keep_alive.js'); // Starts a tiny web server so UptimeRobot can ping this bot
const { handleActivity } = require('./activityTracker.js');
const roleManager = require('./roleManager.js');
const embedBuilder = require('./embedBuilder.js');

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessageReactions,
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
    .setDescription('Add or update an activity role pair (Admin only)')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
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
    .setDescription('Remove an activity role pair (Admin only)')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addRoleOption(option =>
      option.setName('required')
        .setDescription('The required role of the pair to remove')
        .setRequired(true)),

  new SlashCommandBuilder()
    .setName('listactivityroles')
    .setDescription('List all configured activity role pairs (Admin only)')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

  new SlashCommandBuilder()
    .setName('embed')
    .setDescription('Build and send a custom embed message (Admin only)')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
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
      if (!interaction.memberPermissions.has(PermissionFlagsBits.Administrator)) {
        await interaction.reply({ content: 'You need Administrator permission to use this.', ephemeral: true });
        return;
      }
      const requiredRole = interaction.options.getRole('required');
      const activeRole = interaction.options.getRole('active');

      roleManager.addPair(requiredRole.id, activeRole.id);
      await interaction.reply(`✅ Members with **${requiredRole.name}** will now get **${activeRole.name}** while active (10 min inactivity timeout).`);
    }

    else if (commandName === 'removeactivityrole') {
      if (!interaction.memberPermissions.has(PermissionFlagsBits.Administrator)) {
        await interaction.reply({ content: 'You need Administrator permission to use this.', ephemeral: true });
        return;
      }
      const requiredRole = interaction.options.getRole('required');
      const removed = roleManager.removePair(requiredRole.id);

      if (removed) {
        await interaction.reply(`🗑️ Removed the activity role pair for **${requiredRole.name}**.`);
      } else {
        await interaction.reply({ content: `No activity role pair found for **${requiredRole.name}**.`, ephemeral: true });
      }
    }

    else if (commandName === 'listactivityroles') {
      if (!interaction.memberPermissions.has(PermissionFlagsBits.Administrator)) {
        await interaction.reply({ content: 'You need Administrator permission to use this.', ephemeral: true });
        return;
      }
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
      if (!interaction.memberPermissions.has(PermissionFlagsBits.Administrator)) {
        await interaction.reply({ content: 'You need Administrator permission to use this.', ephemeral: true });
        return;
      }
      embedBuilder.clearSession(interaction.user.id); // start fresh each time
      await interaction.showModal(embedBuilder.buildInitialModal());
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

  try {
    const session = embedBuilder.getSession(interaction.user.id);

    if (interaction.customId === 'embed_initial_modal') {
      const title = interaction.fields.getTextInputValue('title');
      const description = interaction.fields.getTextInputValue('description');
      const colorInput = interaction.fields.getTextInputValue('color');
      const footer = interaction.fields.getTextInputValue('footer');
      const image = interaction.fields.getTextInputValue('image');

      if (title) session.title = title;
      if (description) session.description = description;
      if (footer) session.footer = footer;
      if (image) session.image = image;

      if (colorInput) {
        const parsed = embedBuilder.parseColor(colorInput);
        if (parsed === null) {
          await interaction.reply({ content: `⚠️ "${colorInput}" isn't a valid hex color (use something like #5865F2). The rest was saved — you can fix the color from here, or run /embed again to restart.`, ephemeral: true });
        } else {
          session.color = parsed;
        }
      }

      const embedPreview = embedBuilder.buildEmbedFromSession(session);
      await interaction.reply({
        content: '**Embed preview** — use the buttons below to add more, then Send when ready.',
        embeds: [embedPreview],
        components: embedBuilder.buildControlRows(),
        ephemeral: true,
      });
    }

    else if (interaction.customId === 'embed_addfield_modal') {
      const name = interaction.fields.getTextInputValue('name');
      const value = interaction.fields.getTextInputValue('value');
      const inlineInput = (interaction.fields.getTextInputValue('inline') || '').trim().toLowerCase();
      const inline = inlineInput === 'yes' || inlineInput === 'y' || inlineInput === 'true';

      if (session.fields.length >= 25) {
        await interaction.reply({ content: 'An embed can only have up to 25 fields.', ephemeral: true });
        return;
      }
      session.fields.push({ name, value, inline });

      const embedPreview = embedBuilder.buildEmbedFromSession(session);
      await interaction.update({
        content: '**Embed preview** — use the buttons below to add more, then Send when ready.',
        embeds: [embedPreview],
        components: embedBuilder.buildControlRows(),
      });
    }

    else if (interaction.customId === 'embed_author_modal') {
      const name = interaction.fields.getTextInputValue('name');
      const iconURL = interaction.fields.getTextInputValue('iconURL');
      const url = interaction.fields.getTextInputValue('url');

      session.author = { name, iconURL, url };

      const embedPreview = embedBuilder.buildEmbedFromSession(session);
      await interaction.update({
        content: '**Embed preview** — use the buttons below to add more, then Send when ready.',
        embeds: [embedPreview],
        components: embedBuilder.buildControlRows(),
      });
    }

    else if (interaction.customId === 'embed_thumbnail_modal') {
      const thumbnail = interaction.fields.getTextInputValue('thumbnail');
      session.thumbnail = thumbnail;

      const embedPreview = embedBuilder.buildEmbedFromSession(session);
      await interaction.update({
        content: '**Embed preview** — use the buttons below to add more, then Send when ready.',
        embeds: [embedPreview],
        components: embedBuilder.buildControlRows(),
      });
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
    if (interaction.customId === 'embed_addfield_button') {
      await interaction.showModal(embedBuilder.buildFieldModal());
    }

    else if (interaction.customId === 'embed_author_button') {
      await interaction.showModal(embedBuilder.buildAuthorModal());
    }

    else if (interaction.customId === 'embed_thumbnail_button') {
      await interaction.showModal(embedBuilder.buildThumbnailModal());
    }

    else if (interaction.customId === 'embed_send_button') {
      const session = embedBuilder.getSession(interaction.user.id);
      const finalEmbed = embedBuilder.buildEmbedFromSession(session);

      await interaction.channel.send({ embeds: [finalEmbed] });
      embedBuilder.clearSession(interaction.user.id);

      await interaction.update({ content: '✅ Sent!', embeds: [finalEmbed], components: [] });
    }

    else if (interaction.customId === 'embed_cancel_button') {
      embedBuilder.clearSession(interaction.user.id);
      await interaction.update({ content: '❌ Cancelled.', embeds: [], components: [] });
    }

  } catch (error) {
    console.error('Error handling embed button:', error);
    const errMsg = { content: 'Something went wrong. The embed may have an invalid URL somewhere.', ephemeral: true };
    if (interaction.replied || interaction.deferred) {
      await interaction.followUp(errMsg);
    } else {
      await interaction.reply(errMsg);
    }
  }
});

// ---- Activity role tracking ----

// Fires on every new message in the server
client.on('messageCreate', async message => {
  if (message.author.bot || !message.guild) return;

  try {
    const member = message.member || await message.guild.members.fetch(message.author.id).catch(() => null);
    await handleActivity(member);
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
