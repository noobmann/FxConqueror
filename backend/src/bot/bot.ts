import { 
  Client, 
  GatewayIntentBits, 
  Partials, 
  TextChannel, 
  EmbedBuilder, 
  PermissionsBitField,
  GuildMember,
  ButtonInteraction,
  SlashCommandBuilder,
  ChatInputCommandInteraction,
  ChannelType
} from 'discord.js';
import { getDb, saveDb, XpRecord, WarningRecord } from '../utils/db';

export interface LogEntry {
  timestamp: string;
  level: 'info' | 'warn' | 'error';
  message: string;
}

export const activityLogs: LogEntry[] = [];

export function addLog(message: string, level: 'info' | 'warn' | 'error' = 'info') {
  const entry: LogEntry = {
    timestamp: new Date().toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }),
    level,
    message
  };
  activityLogs.push(entry);
  if (activityLogs.length > 50) {
    activityLogs.shift();
  }
  console.log(`[${entry.timestamp}] [${level.toUpperCase()}] ${message}`);
}

export const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessageReactions
  ],
  partials: [
    Partials.Message,
    Partials.Channel,
    Partials.Reaction,
    Partials.User
  ]
});

const slashCommands = [
  new SlashCommandBuilder().setName('help').setDescription('Show available bot commands'),
  new SlashCommandBuilder().setName('rank').setDescription('Show a member rank').addUserOption(option => option.setName('user').setDescription('Member to check')),
  new SlashCommandBuilder().setName('status').setDescription('Show bot status'),
  new SlashCommandBuilder().setName('announce').setDescription('Send an announcement').addStringOption(option => option.setName('message').setDescription('Announcement text').setRequired(true)).addChannelOption(option => option.setName('channel').setDescription('Target text channel').addChannelTypes(ChannelType.GuildText)),
  new SlashCommandBuilder().setName('schedule').setDescription('Schedule a daily IST message').addChannelOption(option => option.setName('channel').setDescription('Target text channel').addChannelTypes(ChannelType.GuildText).setRequired(true)).addStringOption(option => option.setName('time').setDescription('IST time, e.g. 09:30').setRequired(true)).addStringOption(option => option.setName('message').setDescription('Daily message').setRequired(true)),
  new SlashCommandBuilder().setName('warn').setDescription('Warn a member').addUserOption(option => option.setName('user').setDescription('Member to warn').setRequired(true)).addStringOption(option => option.setName('reason').setDescription('Warning reason').setRequired(true)),
  new SlashCommandBuilder().setName('warnings').setDescription('View member warnings').addUserOption(option => option.setName('user').setDescription('Member to check').setRequired(true)),
  new SlashCommandBuilder().setName('purge').setDescription('Delete recent messages').addIntegerOption(option => option.setName('amount').setDescription('1 to 100 messages').setMinValue(1).setMaxValue(100).setRequired(true)),
  new SlashCommandBuilder().setName('kick').setDescription('Kick a member').addUserOption(option => option.setName('user').setDescription('Member to kick').setRequired(true)).addStringOption(option => option.setName('reason').setDescription('Reason')),
  new SlashCommandBuilder().setName('ban').setDescription('Ban a member').addUserOption(option => option.setName('user').setDescription('Member to ban').setRequired(true)).addStringOption(option => option.setName('reason').setDescription('Reason'))
].map(command => command.toJSON());

function hasStaffPermission(interaction: ChatInputCommandInteraction, permission: bigint) {
  return Boolean(interaction.memberPermissions?.has(permission));
}

async function sendScheduledMessages() {
  const now = new Date();
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit', hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(now);
  const part = (type: string) => parts.find(item => item.type === type)?.value || '';
  const timeIST = `${part('hour')}:${part('minute')}`;
  const dateIST = `${part('year')}-${part('month')}-${part('day')}`;
  const db = getDb();
  let changed = false;

  for (const schedule of db.scheduledMessages || []) {
    if (!schedule.enabled || schedule.timeIST !== timeIST || schedule.lastSentDate === dateIST) continue;
    try {
      const channel = await client.channels.fetch(schedule.channelId);
      if (!channel || !channel.isTextBased()) throw new Error('Text channel not found');
      await (channel as TextChannel).send(schedule.message);
      schedule.lastSentDate = dateIST;
      changed = true;
      addLog(`Sent scheduled IST message to #${(channel as any).name}`, 'info');
    } catch (err: any) {
      addLog(`Scheduled message failed: ${err.message}`, 'warn');
    }
  }
  if (changed) saveDb(db);
}

async function postModerationNotice(userId: string, action: string, reason?: string) {
  const channelId = getDb().moderationNoticeChannelId;
  if (!channelId) return;
  try {
    const channel = await client.channels.fetch(channelId);
    if (channel && channel.isTextBased()) await (channel as TextChannel).send(`⚠️ <@${userId}> was **${action}**. Reason: ${reason || 'No reason provided'}`);
  } catch (err: any) { addLog(`Could not post moderation notice: ${err.message}`, 'warn'); }
}

// Event: Bot Ready
client.once('ready', () => {
  addLog(`Bot is logged in as ${client.user?.tag}!`, 'info');
  for (const guild of client.guilds.cache.values()) {
    guild.commands.set(slashCommands).catch((err: any) => addLog(`Failed to register commands: ${err.message}`, 'error'));
  }
  sendScheduledMessages();
  setInterval(sendScheduledMessages, 30_000);
});

client.on('interactionCreate', async (interaction) => {
  if (!interaction.isChatInputCommand()) return;
  const staff = () => hasStaffPermission(interaction, PermissionsBitField.Flags.ManageMessages);
  const admin = () => hasStaffPermission(interaction, PermissionsBitField.Flags.Administrator);
  const deny = async () => interaction.reply({ content: 'You do not have permission to use this command.', ephemeral: true });

  try {
    if (interaction.commandName === 'help') {
      return void interaction.reply({ ephemeral: true, content: '**Everyone:** `/help`, `/rank`, `/status`\n**Staff:** `/warn`, `/warnings`, `/purge`\n**Admin:** `/announce`, `/schedule`, `/kick`, `/ban`' });
    }
    if (interaction.commandName === 'status') return void interaction.reply(`Bot is online. Ping: ${client.ws.ping}ms`);
    if (interaction.commandName === 'rank') {
      const user = interaction.options.getUser('user') || interaction.user;
      const xp = getDb().xpData[user.id]; const level = xp?.level || 0; const points = xp?.xp || 0;
      return void interaction.reply(`**${user.username}** — Level ${level}, ${points} XP`);
    }
    if (interaction.commandName === 'announce') {
      if (!admin()) return void await deny();
      const target = interaction.options.getChannel('channel') || interaction.channel;
      if (!target || !('send' in target)) return void await interaction.reply({ content: 'Choose a text channel.', ephemeral: true });
      await (target as TextChannel).send(interaction.options.getString('message', true));
      return void interaction.reply({ content: 'Announcement sent.', ephemeral: true });
    }
    if (interaction.commandName === 'schedule') {
      if (!admin()) return void await deny();
      const timeIST = interaction.options.getString('time', true); const message = interaction.options.getString('message', true); const channel = interaction.options.getChannel('channel', true);
      if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(timeIST)) return void await interaction.reply({ content: 'Use IST time in HH:MM format, e.g. `09:30`.', ephemeral: true });
      const db = getDb(); db.scheduledMessages = db.scheduledMessages || [];
      db.scheduledMessages.push({ id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`, channelId: channel.id, message, timeIST, enabled: true }); saveDb(db);
      return void interaction.reply({ content: `Daily message scheduled in <#${channel.id}> at ${timeIST} IST.`, ephemeral: true });
    }
    if (interaction.commandName === 'warnings') {
      if (!staff()) return void await deny();
      const user = interaction.options.getUser('user', true); const warnings = getDb().warnings[user.id] || [];
      return void interaction.reply({ ephemeral: true, content: warnings.length ? `**${user.username}** has ${warnings.length} warning(s):\n${warnings.map((w, i) => `${i + 1}. ${w.reason}`).join('\n')}` : `${user.username} has no warnings.` });
    }
    if (interaction.commandName === 'warn') {
      if (!staff()) return void await deny();
      const user = interaction.options.getUser('user', true); const reason = interaction.options.getString('reason', true);
      addWarningToDb(user.id, reason); await postModerationNotice(user.id, 'warned', reason); return void interaction.reply(`${user} has been warned: ${reason}`);
    }
    if (interaction.commandName === 'purge') {
      if (!staff()) return void await deny();
      if (!interaction.channel?.isTextBased() || !('bulkDelete' in interaction.channel)) return void await interaction.reply({ content: 'Use this in a server text channel.', ephemeral: true });
      const amount = interaction.options.getInteger('amount', true); await (interaction.channel as TextChannel).bulkDelete(amount, true);
      return void interaction.reply({ content: `Deleted up to ${amount} recent messages.`, ephemeral: true });
    }
    if (interaction.commandName === 'kick' || interaction.commandName === 'ban') {
      if (!admin()) return void await deny();
      const user = interaction.options.getUser('user', true); const member = await interaction.guild?.members.fetch(user.id); const reason = interaction.options.getString('reason') || 'Moderation action';
      if (!member || !member.moderatable) return void await interaction.reply({ content: 'I cannot moderate that member.', ephemeral: true });
      
      const db = getDb();
      if (!db.moderationLogs) db.moderationLogs = [];
      
      if (interaction.commandName === 'kick') {
        await member.kick(reason);
        db.moderationLogs.push({
          id: Math.random().toString(36).substr(2, 9),
          userId: user.id,
          userTag: user.tag,
          action: 'kick',
          reason,
          timestamp: new Date().toLocaleString()
        });
      } else {
        await member.ban({ reason });
        db.moderationLogs.push({
          id: Math.random().toString(36).substr(2, 9),
          userId: user.id,
          userTag: user.tag,
          action: 'ban',
          reason,
          timestamp: new Date().toLocaleString()
        });
      }
      saveDb(db);
      await postModerationNotice(user.id, interaction.commandName === 'kick' ? 'kicked' : 'banned', reason);
      return void interaction.reply(`${interaction.commandName === 'kick' ? 'Kicked' : 'Banned'} ${user.tag}.`);
    }
  } catch (err: any) {
    addLog(`Command ${interaction.commandName} failed: ${err.message}`, 'error');
    if (interaction.replied || interaction.deferred) await interaction.followUp({ content: 'Command failed. Please try again.', ephemeral: true });
    else await interaction.reply({ content: 'Command failed. Please try again.', ephemeral: true });
  }
});

// Event: Button Interaction (Verification System)
client.on('interactionCreate', async (interaction) => {
  if (!interaction.isButton()) return;
  
  if (interaction.customId === 'verify_button') {
    const db = getDb();
    const verifyRoleId = db.verificationSettings?.roleId;
    
    if (!verifyRoleId) {
      await interaction.reply({ content: '❌ Verification is not configured yet.', ephemeral: true });
      return;
    }
    
    try {
      const member = interaction.member as GuildMember;
      
      if (member.roles.cache.has(verifyRoleId)) {
        await interaction.reply({ content: '✅ You are already verified!', ephemeral: true });
        return;
      }
      
      await member.roles.add(verifyRoleId);
      addLog(`Verified user ${member.user.tag} via button click`, 'info');
      await interaction.reply({ content: '✅ You have been verified! Welcome to the server! 🎉', ephemeral: true });
    } catch (err: any) {
      addLog(`Verification failed for ${interaction.user.tag}: ${err.message}`, 'error');
      await interaction.reply({ content: '❌ Verification failed. Please contact an admin.', ephemeral: true });
    }
  }
});

// Event: Member Joins (Welcome & Auto-role)
client.on('guildMemberAdd', async (member) => {
  const db = getDb();
  addLog(`Member joined: ${member.user.tag}`, 'info');

  // Welcome Message
  if (db.welcomeSettings.enabled && db.welcomeSettings.channelId) {
    try {
      const channel = await client.channels.fetch(db.welcomeSettings.channelId);
      if (channel && channel.isTextBased()) {
        const welcomeText = db.welcomeSettings.message.replace(/{user}/g, `<@${member.id}>`);
        if (db.welcomeSettings.embedStyle !== false) {
          const memberNumber = member.guild.memberCount;
          const embed = new EmbedBuilder()
            .setColor(0x1687ff)
            .setAuthor({ name: `Member #${memberNumber}` })
            .setThumbnail(member.user.displayAvatarURL({ size: 256 }))
            .setDescription(`${welcomeText}\n\n**Welcome ${member.user.username}**\nWelcome to **${member.guild.name}**`)
            .setFooter({ text: `Member #${memberNumber}` });
          await (channel as TextChannel).send({ embeds: [embed] });
        } else {
          await (channel as TextChannel).send(welcomeText);
        }
        addLog(`Sent welcome message for ${member.user.username}`, 'info');
      }
    } catch (err: any) {
      addLog(`Failed to send welcome message: ${err.message}`, 'error');
    }
  }

  // Auto Role
  if (db.welcomeSettings.autoRoleId) {
    try {
      const role = member.guild.roles.cache.get(db.welcomeSettings.autoRoleId);
      if (role) {
        await member.roles.add(role);
        addLog(`Assigned auto-role (${role.name}) to ${member.user.username}`, 'info');
      } else {
        addLog(`Auto-role with ID ${db.welcomeSettings.autoRoleId} not found`, 'warn');
      }
    } catch (err: any) {
      addLog(`Failed to assign auto-role to ${member.user.username}: ${err.message}`, 'error');
    }
  }
});

// Event: Member Leaves (Goodbye Message)
client.on('guildMemberRemove', async (member) => {
  const db = getDb();
  addLog(`Member left: ${member.user.tag}`, 'info');

  if (db.leaveSettings && db.leaveSettings.enabled && db.leaveSettings.channelId) {
    try {
      const channel = await client.channels.fetch(db.leaveSettings.channelId);
      if (channel && channel.isTextBased()) {
        const goodbyeText = db.leaveSettings.message.replace(/{user}/g, `**${member.user.tag}**`);
        await (channel as TextChannel).send(goodbyeText);
        addLog(`Sent goodbye message for ${member.user.username}`, 'info');
      }
    } catch (err: any) {
      addLog(`Failed to send goodbye message: ${err.message}`, 'error');
    }
  }
});

// Event: Message Deleted (Logging)
client.on('messageDelete', async (message) => {
  if (message.partial) return; 
  if (message.author?.bot) return;

  const db = getDb();
  if (!db.auditLogChannelId) return;

  try {
    const logChannel = await client.channels.fetch(db.auditLogChannelId);
    if (logChannel && logChannel.isTextBased()) {
      const embed = new EmbedBuilder()
        .setTitle('🗑️ Message Deleted')
        .setColor(0xE74C3C) // Red
        .addFields(
          { name: 'Author', value: `${message.author} (${message.author.tag})`, inline: true },
          { name: 'Channel', value: `${message.channel}`, inline: true },
          { name: 'Content', value: message.content || '*No text content (likely an attachment)*' }
        )
        .setTimestamp();
      
      await (logChannel as TextChannel).send({ embeds: [embed], flags: ['SuppressNotifications'] });
    }
  } catch (err: any) {
    console.error('Audit log delete error:', err.message);
  }
});

// Event: Message Edited (Logging)
client.on('messageUpdate', async (oldMessage, newMessage) => {
  if (oldMessage.partial || newMessage.partial) return;
  if (oldMessage.author?.bot) return;
  if (oldMessage.content === newMessage.content) return; 

  const db = getDb();
  if (!db.auditLogChannelId) return;

  try {
    const logChannel = await client.channels.fetch(db.auditLogChannelId);
    if (logChannel && logChannel.isTextBased()) {
      const embed = new EmbedBuilder()
        .setTitle('✏️ Message Edited')
        .setColor(0xF39C12) // Orange
        .addFields(
          { name: 'Author', value: `${oldMessage.author} (${oldMessage.author.tag})`, inline: true },
          { name: 'Channel', value: `${oldMessage.channel}`, inline: true },
          { name: 'Before', value: oldMessage.content || '*Empty*' },
          { name: 'After', value: newMessage.content || '*Empty*' }
        )
        .setTimestamp();

      await (logChannel as TextChannel).send({ embeds: [embed], flags: ['SuppressNotifications'] });
    }
  } catch (err: any) {
    console.error('Audit log edit error:', err.message);
  }
});

// Event: Message Create (Photo-only, Auto-Mod, leveling, rank check)
client.on('messageCreate', async (message) => {
  if (message.author.bot) return;

  const db = getDb();
  const channelId = message.channel.id;
  const userId = message.author.id;
  const member = message.member;

  // Check if sender is Administrator
  const isAdmin = member?.permissions.has(PermissionsBitField.Flags.Administrator) || false;

  // 1. Photo-Only Channels Enforcement
  if (db.photoOnlyChannels.includes(channelId)) {
    const hasImage = message.attachments.some(attachment => 
      attachment.contentType?.startsWith('image/')
    );

    if (!hasImage && !isAdmin) {
      try {
        await message.delete();
        addLog(`Deleted non-photo message by ${message.author.tag} in photo-only channel`, 'warn');
        
        const warning = await message.channel.send(
          `⚠️ <@${message.author.id}>, is channel mein sirf screenshots/photos allowed hain!`
        );
        setTimeout(() => warning.delete().catch(() => {}), 5000);
      } catch (err: any) {
        addLog(`Failed to delete non-photo message: ${err.message}`, 'error');
      }
      return; 
    }
  }

  // 2. Auto-Moderation Checks (Ignore Admins)
  if (!isAdmin) {
    // A. Link Blocker
    if (db.autoMod.blockLinks) {
      const containsLink = /(https?:\/\/[^\s]+|discord\.gg\/[^\s]+)/gi.test(message.content);
      if (containsLink) {
        try {
          await message.delete();
          addLog(`Deleted link from ${message.author.tag} (Link Blocker)`, 'warn');
          
          const warning = await message.channel.send(`⚠️ <@${userId}>, links post karna allowed nahi hai!`);
          setTimeout(() => warning.delete().catch(() => {}), 5000);

          // Add warning record
          addWarningToDb(userId, 'Sharing links (Auto-Mod)');
        } catch (err: any) {
          addLog(`Link blocker error: ${err.message}`, 'error');
        }
        return;
      }
    }

    // B. Caps Blocker
    if (db.autoMod.blockCaps && message.content.length >= 10) {
      const letters = message.content.replace(/[^a-zA-Z]/g, '');
      const uppercase = message.content.replace(/[^A-Z]/g, '');
      if (letters.length > 0 && (uppercase.length / letters.length) > 0.7) {
        try {
          await message.delete();
          addLog(`Deleted CAPS spam from ${message.author.tag} (Caps Blocker)`, 'warn');
          
          const warning = await message.channel.send(`⚠️ <@${userId}>, don't spam in ALL CAPS!`);
          setTimeout(() => warning.delete().catch(() => {}), 5000);

          // Add warning record
          addWarningToDb(userId, 'CAPS spam (Auto-Mod)');
        } catch (err: any) {
          addLog(`Caps blocker error: ${err.message}`, 'error');
        }
        return;
      }
    }

    // C. Bad Words Filter
    if (db.autoMod.badWordsEnabled && db.autoMod.badWordsList.length > 0) {
      const contentLower = message.content.toLowerCase();
      const hasBadWord = db.autoMod.badWordsList.some(word => 
        contentLower.includes(word.toLowerCase())
      );

      if (hasBadWord) {
        try {
          await message.delete();
          addLog(`Deleted message with blacklisted word from ${message.author.tag}`, 'warn');
          
          const warning = await message.channel.send(`⚠️ <@${userId}>, bad words use karna allowed nahi hai!`);
          setTimeout(() => warning.delete().catch(() => {}), 5000);

          // Add warning record
          addWarningToDb(userId, 'Used blacklisted word (Auto-Mod)');
        } catch (err: any) {
          addLog(`Bad words blocker error: ${err.message}`, 'error');
        }
        return;
      }
    }
  }

  // 3. Optional: Chat-based Rank command
  if (message.content.trim().toLowerCase() === '!rank') {
    if (db.levelingSettings.enabled) {
      const userXp = db.xpData[userId];
      const level = userXp?.level || 0;
      const xp = userXp?.xp || 0;
      const needed = (level + 1) * 100;
      await message.reply(`⭐ **Rank Card** | Level ${level} | XP: ${xp}/${needed}`);
    }
    return;
  }

  // 4. Custom Triggers (Auto-responders)
  const contentTrim = message.content.trim().toLowerCase();
  const matchedTrigger = db.triggers.find(t => contentTrim === t.trigger.toLowerCase());
  
  if (matchedTrigger) {
    try {
      await message.channel.send(matchedTrigger.reply);
      addLog(`Trigger matched: "${matchedTrigger.trigger}" in #${(message.channel as TextChannel).name}`, 'info');
    } catch (err: any) {
      addLog(`Failed to send trigger reply: ${err.message}`, 'error');
    }
  }

  // 5. Leveling & XP system (No Cooldown for Admins, 1 min cooldown for normal users)
  if (db.levelingSettings.enabled) {
    const now = Date.now();
    const userXp: XpRecord = db.xpData[userId] || {
      xp: 0,
      level: 0,
      lastXpTime: 0,
      username: message.author.username
    };

    // Cooldown verification (60 seconds)
    if (now - userXp.lastXpTime >= 60000 || isAdmin) {
      const xpToGive = Math.floor(Math.random() * 11) + 15; // 15 - 25 XP
      userXp.xp += xpToGive;
      userXp.lastXpTime = now;
      userXp.username = message.author.username;

      // Check level up
      const neededXp = (userXp.level + 1) * 100;
      if (userXp.xp >= neededXp) {
        userXp.level += 1;
        
        // Send level up announcement
        try {
          const channel = message.channel as TextChannel;
          const levelUpMsg = db.levelingSettings.levelUpMessage
            .replace(/{user}/g, `<@${userId}>`)
            .replace(/{level}/g, userXp.level.toString());
          await channel.send(levelUpMsg);
          addLog(`${message.author.username} leveled up to Level ${userXp.level}!`, 'info');
        } catch (err: any) {
          console.error('Level up announce error:', err.message);
        }

        // Award level-roles
        const reward = db.levelingSettings.roleRewards.find(r => r.level === userXp.level);
        if (reward && member) {
          try {
            const role = member.guild.roles.cache.get(reward.roleId);
            if (role) {
              await member.roles.add(role);
              addLog(`Assigned Level Reward Role (${role.name}) to ${message.author.username}`, 'info');
            }
          } catch (err: any) {
            addLog(`Failed to grant reward role: ${err.message}`, 'error');
          }
        }
      }

      db.xpData[userId] = userXp;
      saveDb(db);
    }
  }
});

// Helper: Add warning to Database
function addWarningToDb(userId: string, reason: string) {
  const db = getDb();
  const list = db.warnings[userId] || [];
  
  const record: WarningRecord = {
    id: Math.random().toString(36).substr(2, 9),
    reason,
    timestamp: new Date().toLocaleString()
  };
  list.push(record);
  db.warnings[userId] = list;
  
  if (!db.moderationLogs) db.moderationLogs = [];
  
  let tag = userId;
  const cachedUser = client.users.cache.get(userId);
  if (cachedUser) {
    tag = cachedUser.tag;
  }
  
  db.moderationLogs.push({
    id: record.id,
    userId,
    userTag: tag,
    action: 'warn',
    reason,
    timestamp: new Date().toLocaleString()
  });
  
  saveDb(db);
  addLog(`Moderation warning added to ${userId}: ${reason}`, 'warn');
}

// Event: Reaction Added (Reaction Roles)
client.on('messageReactionAdd', async (reaction, user) => {
  if (user.bot) return;

  if (reaction.partial) {
    try {
      await reaction.fetch();
    } catch (err) {
      addLog(`Failed to fetch reaction: ${err}`, 'error');
      return;
    }
  }

  const db = getDb();
  const messageId = reaction.message.id;
  const emojiName = reaction.emoji.name;

  const rule = db.reactionRoles.find(r => 
    r.messageId === messageId && (r.emoji === emojiName || r.emoji === reaction.emoji.toString())
  );

  if (rule) {
    try {
      const guild = reaction.message.guild;
      if (!guild) return;

      const member = await guild.members.fetch(user.id);
      const role = guild.roles.cache.get(rule.roleId);

      if (role && member) {
        await member.roles.add(role);
        addLog(`Reaction Role: Assigned ${role.name} to ${user.username}`, 'info');
      }
    } catch (err: any) {
      addLog(`Failed to assign reaction role: ${err.message}`, 'error');
    }
  }
});

// Event: Reaction Removed (Reaction Roles)
client.on('messageReactionRemove', async (reaction, user) => {
  if (user.bot) return;

  if (reaction.partial) {
    try {
      await reaction.fetch();
    } catch (err) {
      addLog(`Failed to fetch reaction: ${err}`, 'error');
      return;
    }
  }

  const db = getDb();
  const messageId = reaction.message.id;
  const emojiName = reaction.emoji.name;

  const rule = db.reactionRoles.find(r => 
    r.messageId === messageId && (r.emoji === emojiName || r.emoji === reaction.emoji.toString())
  );

  if (rule) {
    try {
      const guild = reaction.message.guild;
      if (!guild) return;

      const member = await guild.members.fetch(user.id);
      const role = guild.roles.cache.get(rule.roleId);

      if (role && member) {
        await member.roles.remove(role);
        addLog(`Reaction Role: Removed ${role.name} from ${user.username}`, 'info');
      }
    } catch (err: any) {
      addLog(`Failed to remove reaction role: ${err.message}`, 'error');
    }
  }
});

/**
 * Updates the native slowmode for a Discord channel.
 */
export async function updateChannelSlowmode(channelId: string, seconds: number): Promise<boolean> {
  try {
    const channel = await client.channels.fetch(channelId);
    if (channel && channel.isTextBased() && 'setRateLimitPerUser' in channel) {
      await (channel as any).setRateLimitPerUser(seconds);
      addLog(`Updated slowmode for #${(channel as any).name} to ${seconds} seconds`, 'info');
      return true;
    }
    return false;
  } catch (err: any) {
    addLog(`Failed to update slowmode for channel ${channelId}: ${err.message}`, 'error');
    return false;
  }
}

/**
 * Creates Discord Category and Text Channels based on suggested JSON array.
 */
export async function createSuggestedChannels(
  suggestion: { category: string; channels: string[] }[]
): Promise<boolean> {
  const guild = client.guilds.cache.first();
  if (!guild) {
    addLog('Failed to build suggested channels: Guild not connected', 'error');
    return false;
  }

  try {
    for (const group of suggestion) {
      // Create Category
      const categoryChannel = await guild.channels.create({
        name: group.category,
        type: 4 // ChannelType.GuildCategory is 4
      });

      for (const channelName of group.channels) {
        // Create Text Channel under the category
        await guild.channels.create({
          name: channelName.replace(/\s+/g, '-').toLowerCase(),
          type: 0, // ChannelType.GuildText is 0
          parent: categoryChannel.id
        });
      }
    }
    addLog(`Successfully built suggested categories and channels on the server!`, 'info');
    return true;
  } catch (err: any) {
    addLog(`Failed to build suggested channels: ${err.message}`, 'error');
    return false;
  }
}

/**
 * Reconnects the Discord client with a new token dynamically.
 */
export async function reconnectBot(newToken: string): Promise<void> {
  addLog('Reconnecting Discord bot client with new credentials...', 'info');
  try {
    await client.destroy();
    await client.login(newToken);
    addLog(`Discord bot client successfully reconnected!`, 'info');
  } catch (err: any) {
    addLog(`Failed to reconnect Discord bot: ${err.message}`, 'error');
    throw err;
  }
}
