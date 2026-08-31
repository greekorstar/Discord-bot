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
    .setName('hello')
    .setDescription('Say hello to the bot'),

  new SlashCommandBuilder()
    .setName('userinfo')
    .setDescription('Get info about a user')
    .addUserOption(option =>
      option.setName('target')
        .setDescription('The user to look up (leave blank for yourself)')
        .setRequired(false)),

  new SlashCommandBuilder()
    .setName('serverinfo')
    .setDescription('Get info about this server'),

  new SlashCommandBuilder()
    .setName('avatar')
    .setDescription('Get a user\'s avatar')
    .addUserOption(option =>
      option.setName('target')
        .setDescription('The user whose avatar to show (leave blank for yourself)')
        .setRequired(false)),

  new SlashCommandBuilder()
    .setName('roll')
    .setDescription('Roll a dice')
    .addIntegerOption(option =>
      option.setName('sides')
        .setDescription('Number of sides on the dice (default 6)')
        .setRequired(false)),

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
      await interaction.reply(`🏓 Pong! Latency: ${latency}ms | API Latency: ${Math.round(client.ws.ping)}ms`);
    }

    else if (commandName === 'hello') {
      await interaction.reply(`👋 Hello, ${interaction.user.username}!`);
    }

    else if (commandName === 'userinfo') {
      const target = interaction.options.getUser('target') || interaction.user;
      const member = interaction.guild ? await interaction.guild.members.fetch(target.id).catch(() => null) : null;

      const embed = new EmbedBuilder()
        .setTitle(`User Info: ${target.username}`)
        .setThumbnail(target.displayAvatarURL())
        .addFields(
          { name: 'Username', value: target.username, inline: true },
          { name: 'ID', value: target.id, inline: true },
          { name: 'Account Created', value: `<t:${Math.floor(target.createdTimestamp / 1000)}:D>`, inline: true },
        )
        .setColor(0x5865F2);

      if (member) {
        embed.addFields({
          name: 'Joined Server',
          value: `<t:${Math.floor(member.joinedTimestamp / 1000)}:D>`,
          inline: true,
        });
      }

      await interaction.reply({ embeds: [embed] });
    }

    else if (commandName === 'serverinfo') {
      if (!interaction.guild) {
        await interaction.reply('This command only works in a server.');
        return;
      }

      const guild = interaction.guild;
      const embed = new EmbedBuilder()
        .setTitle(`Server Info: ${guild.name}`)
        .setThumbnail(guild.iconURL())
        .addFields(
          { name: 'Members', value: `${guild.memberCount}`, inline: true },
          { name: 'Created', value: `<t:${Math.floor(guild.createdTimestamp / 1000)}:D>`, inline: true },
          { name: 'Owner ID', value: guild.ownerId, inline: true },
        )
        .setColor(0x5865F2);

      await interaction.reply({ embeds: [embed] });
    }

    else if (commandName === 'avatar') {
      const target = interaction.options.getUser('target') || interaction.user;
      const embed = new EmbedBuilder()
        .setTitle(`${target.username}'s Avatar`)
        .setImage(target.displayAvatarURL({ size: 512 }))
        .setColor(0x5865F2);

      await interaction.reply({ embeds: [embed] });
    }

    else if (commandName === 'roll') {
      const sides = interaction.options.getInteger('sides') || 6;
      if (sides < 2) {
        await interaction.reply('The dice needs at least 2 sides!');
        return;
      }
      const result = Math.floor(Math.random() * sides) + 1;
      await interaction.reply(`🎲 You rolled a **${result}** (out of ${sides})`);
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
