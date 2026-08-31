// index.js — Main bot file
require('dotenv').config();
const { Client, GatewayIntentBits, Partials, REST, Routes, SlashCommandBuilder, EmbedBuilder, PermissionFlagsBits } = require('discord.js');
require('./keep_alive.js'); // Starts a tiny web server so UptimeRobot can ping this bot
const { handleActivity } = require('./activityTracker.js');
const roleManager = require('./roleManager.js');

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

  } catch (error) {
    console.error(`Error handling command ${commandName}:`, error);
    if (interaction.replied || interaction.deferred) {
      await interaction.followUp({ content: 'Something went wrong running that command.', ephemeral: true });
    } else {
      await interaction.reply({ content: 'Something went wrong running that command.', ephemeral: true });
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
