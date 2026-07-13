import { Router, Request, Response, NextFunction } from 'express';
import { client, activityLogs, updateChannelSlowmode, addLog } from '../bot/bot';
import { getDb, saveDb, WarningRecord } from '../utils/db';
import { TextChannel, PermissionsBitField, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, AttachmentBuilder } from 'discord.js';
import { GoogleGenerativeAI } from '@google/generative-ai';

const router = Router();

type AIChannelPlan = {
  id: string;
  name: string;
  type: number;
  isNew: boolean;
};

type AICategoryPlan = {
  category: string;
  channels: AIChannelPlan[];
};

function validateOrganizationPlan(
  input: unknown,
  existingChannels: Map<string, { id: string; type: number }>
): { categories: AICategoryPlan[] } | null {
  if (!input || typeof input !== 'object' || !Array.isArray((input as { categories?: unknown }).categories)) {
    return null;
  }

  const categories: AICategoryPlan[] = [];
  const usedExistingIds = new Set<string>();

  for (const rawGroup of (input as { categories: unknown[] }).categories) {
    if (!rawGroup || typeof rawGroup !== 'object') return null;
    const { category, channels } = rawGroup as { category?: unknown; channels?: unknown };
    if (typeof category !== 'string' || !Array.isArray(channels)) return null;

    const categoryName = category.trim();
    if (!categoryName || categoryName.length > 100) return null;

    const validChannels: AIChannelPlan[] = [];
    for (const rawChannel of channels) {
      if (!rawChannel || typeof rawChannel !== 'object') return null;
      const { id, name, type, isNew } = rawChannel as {
        id?: unknown; name?: unknown; type?: unknown; isNew?: unknown;
      };
      if (typeof id !== 'string' || typeof name !== 'string' || typeof type !== 'number' || typeof isNew !== 'boolean') return null;

      const channelName = name.trim();
      if (!channelName || channelName.length > 100) return null;

      if (isNew) {
        if (!id.startsWith('new:') || (type !== 0 && type !== 2)) return null;
      } else {
        const existing = existingChannels.get(id);
        if (!existing || existing.type !== type || usedExistingIds.has(id)) return null;
        usedExistingIds.add(id);
      }

      validChannels.push({ id, name: channelName, type, isNew });
    }

    if (validChannels.length > 0) categories.push({ category: categoryName, channels: validChannels });
  }

  return categories.length > 0 && categories.length <= 25 ? { categories } : null;
}

// Multi-server session store: token -> guildId
const sessions = new Map<string, string>();

// Build admin accounts from environment variables
function getAdminAccounts() {
  const accounts: Array<{ username: string; password: string; guildId: string }> = [];
  const username = process.env.ADMIN_USERNAME || 'admin';

  if (process.env.ADMIN_PASSWORD) {
    accounts.push({ username, password: process.env.ADMIN_PASSWORD, guildId: process.env.GUILD_ID || '' });
  }
  if (process.env.ADMIN_PASSWORD_2) {
    accounts.push({ username, password: process.env.ADMIN_PASSWORD_2, guildId: process.env.GUILD_ID_2 || '' });
  }
  if (process.env.ADMIN_PASSWORD_3) {
    accounts.push({ username, password: process.env.ADMIN_PASSWORD_3, guildId: process.env.GUILD_ID_3 || '' });
  }

  // Fallback default if no env vars set
  if (accounts.length === 0) {
    accounts.push({ username: 'admin', password: 'conquerors123', guildId: '' });
  }

  return accounts;
}

function authMiddleware(req: Request, res: Response, next: NextFunction) {
  if (req.path === '/auth/login' || req.path === '/public/status') {
    return next();
  }

  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Unauthorized access: No token provided' });
  }

  const token = authHeader.split(' ')[1];
  if (sessions.has(token)) {
    (req as any).guildId = sessions.get(token);
    return next();
  }
  return res.status(401).json({ error: 'Unauthorized access: Invalid session token' });
}

router.use(authMiddleware);

// Find the target Guild by ID, name search, or fallback to first guild
function getGuild(guildId?: string) {
  // If a specific guildId is provided (from login session), only return that guild
  if (guildId) {
    return client.guilds.cache.get(guildId) || undefined;
  }
  // Fallback logic only when no specific guildId is set
  if (process.env.GUILD_ID) {
    const target = client.guilds.cache.get(process.env.GUILD_ID);
    if (target) return target;
  }
  const target = client.guilds.cache.find(g => g.name.toLowerCase().includes('conqueror'));
  if (target) return target;
  return client.guilds.cache.first();
}

// ----------------------------------------------------
// AUTHENTICATION & PUBLIC STATUS ROUTE
// ----------------------------------------------------
router.post('/auth/login', (req: Request, res: Response) => {
  const { username, password } = req.body;
  const accounts = getAdminAccounts();

  const matched = accounts.find(a => a.username === username && a.password === password);
  if (matched) {
    const token = Math.random().toString(36).substr(2) + Math.random().toString(36).substr(2);
    sessions.set(token, matched.guildId);
    const guild = getGuild(matched.guildId);
    addLog(`Successful login via Web Dashboard → ${guild?.name || 'Default Server'}`, 'info');
    return res.json({ token, guildName: guild?.name || 'Fx Conquerors' });
  }
  
  addLog(`Failed login attempt for user "${username}" from dashboard`, 'warn');
  return res.status(401).json({ error: 'Invalid username or password' });
});

router.get('/public/status', (req: Request, res: Response) => {
  const guild = getGuild((req as any).guildId);
  res.json({
    online: client.isReady(),
    guildName: guild?.name || 'Fx Conquerors',
    avatar: client.user?.displayAvatarURL() || null
  });
});

// ----------------------------------------------------
// GENERAL & CONFIG SYSTEM ROUTES
// ----------------------------------------------------

router.get('/status', (req: Request, res: Response) => {
  const db = getDb();
  const guild = getGuild((req as any).guildId);

  res.json({
    online: client.isReady(),
    tag: client.user?.tag || 'Offline',
    avatar: client.user?.displayAvatarURL() || null,
    ping: client.ws.ping || 0,
    guildName: guild?.name || 'Fx Conquerors',
    guildId: guild?.id || null,
    settings: db
  });
});

router.get('/guild/channels', async (req: Request, res: Response) => {
  const guild = getGuild((req as any).guildId);
  if (!guild) {
    return res.json([]);
  }

  try {
    const channels = await guild.channels.fetch();
    const sortedChannels = channels
      .filter(ch => ch !== null && (ch.type === 0 || ch.type === 2 || ch.type === 5)) 
      .map(ch => ({
        id: ch!.id,
        name: ch!.name,
        type: ch!.type,
        slowmode: (ch as any).rateLimitPerUser || 0
      }));
    res.json(sortedChannels);
  } catch (err: any) {
    res.status(500).json({ error: `Failed to fetch channels: ${err.message}` });
  }
});

router.get('/guild/roles', async (req: Request, res: Response) => {
  const guild = getGuild((req as any).guildId);
  if (!guild) {
    return res.json([]);
  }

  try {
    const roles = await guild.roles.fetch();
    const sortedRoles = roles
      .filter(r => r.name !== '@everyone' && !r.managed)
      .map(r => ({
        id: r.id,
        name: r.name,
        color: r.hexColor
      }));
    res.json(sortedRoles);
  } catch (err: any) {
    res.status(500).json({ error: `Failed to fetch roles: ${err.message}` });
  }
});

router.post('/settings/moderation', async (req: Request, res: Response) => {
  const { photoOnlyChannels, slowmodeChannels } = req.body;
  if (!Array.isArray(photoOnlyChannels) || typeof slowmodeChannels !== 'object') {
    return res.status(400).json({ error: 'Invalid moderation configuration data' });
  }

  const db = getDb();
  db.photoOnlyChannels = photoOnlyChannels;

  const oldSlowmodes = db.slowmodeChannels || {};
  db.slowmodeChannels = slowmodeChannels;
  saveDb(db);

  for (const [channelId, seconds] of Object.entries(slowmodeChannels)) {
    const currentSecs = oldSlowmodes[channelId];
    if (currentSecs !== seconds) {
      await updateChannelSlowmode(channelId, seconds as number);
    }
  }

  res.json({ message: 'Moderation settings saved successfully', settings: db });
});

router.post('/settings/welcome', (req: Request, res: Response) => {
  const { enabled, channelId, message, autoRoleId } = req.body;
  if (typeof enabled !== 'boolean' || typeof message !== 'string') {
    return res.status(400).json({ error: 'Invalid welcome settings data' });
  }

  const db = getDb();
  db.welcomeSettings = { enabled, channelId, message, autoRoleId };
  saveDb(db);

  res.json({ message: 'Welcome settings saved successfully', settings: db });
});

router.post('/settings/leave', (req: Request, res: Response) => {
  const { enabled, channelId, message } = req.body;
  if (typeof enabled !== 'boolean' || typeof message !== 'string') {
    return res.status(400).json({ error: 'Invalid leave settings data' });
  }

  const db = getDb();
  db.leaveSettings = { enabled, channelId, message };
  saveDb(db);

  res.json({ message: 'Leave/Goodbye settings saved successfully', settings: db });
});

router.post('/settings/leveling', (req: Request, res: Response) => {
  const { enabled, levelUpMessage, roleRewards } = req.body;
  if (typeof enabled !== 'boolean' || typeof levelUpMessage !== 'string' || !Array.isArray(roleRewards)) {
    return res.status(400).json({ error: 'Invalid leveling settings data' });
  }

  const db = getDb();
  db.levelingSettings = { enabled, levelUpMessage, roleRewards };
  saveDb(db);

  res.json({ message: 'Leveling settings saved successfully', settings: db });
});

router.post('/settings/automod', (req: Request, res: Response) => {
  const { badWordsEnabled, badWordsList, blockLinks, blockCaps } = req.body;
  if (
    typeof badWordsEnabled !== 'boolean' || 
    !Array.isArray(badWordsList) || 
    typeof blockLinks !== 'boolean' || 
    typeof blockCaps !== 'boolean'
  ) {
    return res.status(400).json({ error: 'Invalid AutoMod settings data' });
  }

  const db = getDb();
  db.autoMod = { badWordsEnabled, badWordsList, blockLinks, blockCaps };
  saveDb(db);

  res.json({ message: 'AutoMod configurations updated!', settings: db });
});

router.post('/settings/reaction-roles', (req: Request, res: Response) => {
  const { reactionRoles } = req.body;
  if (!Array.isArray(reactionRoles)) {
    return res.status(400).json({ error: 'Invalid reaction roles data' });
  }

  for (const item of reactionRoles) {
    if (!item.messageId || !item.emoji || !item.roleId) {
      return res.status(400).json({ error: 'Each reaction role must have messageId, emoji, and roleId' });
    }
  }

  const db = getDb();
  db.reactionRoles = reactionRoles;
  saveDb(db);

  res.json({ message: 'Reaction roles saved successfully', settings: db });
});

router.post('/settings/triggers', (req: Request, res: Response) => {
  const { triggers } = req.body;
  if (!Array.isArray(triggers)) {
    return res.status(400).json({ error: 'Invalid triggers data' });
  }

  for (const item of triggers) {
    if (!item.id || !item.trigger || !item.reply) {
      return res.status(400).json({ error: 'Each trigger must have id, trigger, and reply text' });
    }
  }

  const db = getDb();
  db.triggers = triggers;
  saveDb(db);

  res.json({ message: 'Auto-responders saved successfully', settings: db });
});

router.post('/settings/audit-log', (req: Request, res: Response) => {
  const { auditLogChannelId } = req.body;
  if (typeof auditLogChannelId !== 'string') {
    return res.status(400).json({ error: 'Invalid auditLogChannelId' });
  }

  const db = getDb();
  db.auditLogChannelId = auditLogChannelId;
  saveDb(db);

  res.json({ message: 'Audit log channel saved successfully', settings: db });
});

router.get('/logs', (req: Request, res: Response) => {
  res.json(activityLogs);
});

router.get('/guild/members', async (req: Request, res: Response) => {
  const guild = getGuild((req as any).guildId);
  if (!guild) {
    return res.json([]);
  }

  const db = getDb();

  try {
    const fetchedMembers = await guild.members.fetch();
    const membersData = fetchedMembers.map(m => {
      const xpRecord = db.xpData[m.id] || { xp: 0, level: 0, username: m.user.username };
      const userWarnings = db.warnings[m.id] || [];
      return {
        id: m.id,
        username: m.user.username,
        tag: m.user.tag,
        avatar: m.user.displayAvatarURL() || null,
        level: xpRecord.level,
        xp: xpRecord.xp,
        warnings: userWarnings,
        joinedAt: m.joinedAt?.toLocaleDateString() || 'Unknown',
        isAdmin: m.permissions.has(PermissionsBitField.Flags.Administrator)
      };
    });

    membersData.sort((a, b) => {
      if (b.level !== a.level) {
        return b.level - a.level;
      }
      return b.xp - a.xp;
    });

    res.json(membersData);
  } catch (err: any) {
    res.status(500).json({ error: `Failed to fetch members: ${err.message}` });
  }
});

// ----------------------------------------------------
// MODERATION ACTIONS
// ----------------------------------------------------

router.post('/moderation/purge', async (req: Request, res: Response) => {
  const { channelId, amount } = req.body;
  if (!channelId || typeof amount !== 'number' || amount < 1 || amount > 100) {
    return res.status(400).json({ error: 'Invalid channelId or amount (must be 1-100)' });
  }

  try {
    const channel = await client.channels.fetch(channelId);
    if (channel && channel.isTextBased()) {
      const deleted = await (channel as TextChannel).bulkDelete(amount);
      const msg = `Purged ${deleted.size} messages from channel #${(channel as TextChannel).name} via Web Dashboard.`;
      addLog(msg, 'warn');
      res.json({ message: msg });
    } else {
      res.status(404).json({ error: 'Text channel not found' });
    }
  } catch (err: any) {
    addLog(`Failed to purge messages: ${err.message}`, 'error');
    res.status(500).json({ error: `Failed to purge: ${err.message}` });
  }
});

router.post('/moderation/warn', (req: Request, res: Response) => {
  const { userId, reason } = req.body;
  if (!userId || !reason) {
    return res.status(400).json({ error: 'Missing userId or reason' });
  }

  const db = getDb();
  const list = db.warnings[userId] || [];
  
  const record: WarningRecord = {
    id: Math.random().toString(36).substr(2, 9),
    reason,
    timestamp: new Date().toLocaleString()
  };
  list.push(record);
  db.warnings[userId] = list;
  saveDb(db);

  addLog(`Warned user (${userId}) via Web Dashboard. Reason: ${reason}`, 'warn');
  res.json({ message: 'User warned successfully', warnings: list });
});

router.post('/moderation/clearwarns', (req: Request, res: Response) => {
  const { userId } = req.body;
  if (!userId) {
    return res.status(400).json({ error: 'Missing userId' });
  }

  const db = getDb();
  db.warnings[userId] = [];
  saveDb(db);

  addLog(`Cleared all warnings for user (${userId}) via Web Dashboard`, 'info');
  res.json({ message: 'Warnings cleared successfully' });
});

router.post('/moderation/kick', async (req: Request, res: Response) => {
  const { userId, reason } = req.body;
  if (!userId) {
    return res.status(400).json({ error: 'Missing userId' });
  }

  const guild = getGuild((req as any).guildId);
  if (!guild) {
    return res.status(404).json({ error: 'Guild connection not available' });
  }

  try {
    const member = await guild.members.fetch(userId);
    if (!member) {
      return res.status(404).json({ error: 'Member not found in server' });
    }

    await member.kick(reason || 'Kicked via Web Dashboard');
    addLog(`Kicked user ${member.user.tag} via Web Dashboard. Reason: ${reason}`, 'warn');
    res.json({ message: `Successfully kicked ${member.user.username}` });
  } catch (err: any) {
    addLog(`Failed to kick member: ${err.message}`, 'error');
    res.status(500).json({ error: `Failed to kick: ${err.message}` });
  }
});

router.post('/moderation/ban', async (req: Request, res: Response) => {
  const { userId, reason } = req.body;
  if (!userId) {
    return res.status(400).json({ error: 'Missing userId' });
  }

  const guild = getGuild((req as any).guildId);
  if (!guild) {
    return res.status(404).json({ error: 'Guild connection not available' });
  }

  try {
    const member = await guild.members.fetch(userId);
    await guild.members.ban(userId, { reason: reason || 'Banned via Web Dashboard' });
    const tag = member ? member.user.tag : userId;
    addLog(`Banned user ${tag} via Web Dashboard. Reason: ${reason}`, 'warn');
    res.json({ message: `Successfully banned member` });
  } catch (err: any) {
    addLog(`Failed to ban member: ${err.message}`, 'error');
    res.status(500).json({ error: `Failed to ban: ${err.message}` });
  }
});

// ----------------------------------------------------
// AI CHANNEL & SERVER ORGANIZER ROUTES
// ----------------------------------------------------

// AI suggest sorting of existing channels & recommend missing ones
router.post('/ai/suggest-sorting', async (req: Request, res: Response) => {
  const guild = getGuild((req as any).guildId);
  if (!guild) {
    return res.status(404).json({ error: 'Guild connection not active' });
  }

  const { geminiApiKey, autoEmoji } = req.body;

  try {
    const channels = await guild.channels.fetch();
    const sortedChannels = channels
      .filter(ch => ch !== null && (ch.type === 0 || ch.type === 2 || ch.type === 5)) 
      .map(ch => ({
        id: ch!.id,
        name: ch!.name,
        type: ch!.type 
      }));

    if (sortedChannels.length === 0) {
      return res.status(400).json({ error: 'No text or voice channels found in server to organize.' });
    }

    const apiKey = geminiApiKey || process.env.GEMINI_API_KEY;

    if (!apiKey) {
      addLog('GEMINI_API_KEY is not configured. Serving mock channel sorting.', 'warn');
      
      const infoIds: any[] = [];
      const chatIds: any[] = [];
      const voiceIds: any[] = [];

      sortedChannels.forEach(ch => {
        let cleanName = ch.name;
        if (autoEmoji && !/^[^\w]/.test(cleanName)) {
          if (ch.type === 2) {
            cleanName = `🔊-${cleanName}`;
          } else {
            const n = ch.name.toLowerCase();
            if (n.includes('rules')) cleanName = `📜-${cleanName}`;
            else if (n.includes('announcement')) cleanName = `📢-${cleanName}`;
            else if (n.includes('alert')) cleanName = `🚨-${cleanName}`;
            else if (n.includes('signal')) cleanName = `📈-${cleanName}`;
            else if (n.includes('log')) cleanName = `📁-${cleanName}`;
            else cleanName = `💬-${cleanName}`;
          }
        }
        const item = { id: ch.id, name: cleanName, type: ch.type, isNew: false };
        if (ch.type === 2) {
          voiceIds.push(item);
        } else {
          const n = ch.name.toLowerCase();
          if (n.includes('rules') || n.includes('announcement') || n.includes('alert') || n.includes('signal') || n.includes('log')) {
            infoIds.push(item);
          } else {
            chatIds.push(item);
          }
        }
      });

      const mockSuggestion = {
        categories: [
          {
            category: '📢 INFORMATION & ALERTS',
            channels: [
              ...infoIds,
              { id: 'new:daily-signals', name: '📈-daily-signals', type: 0, isNew: true }
            ]
          },
          {
            category: '💬 COMMUNITY DISCUSSION',
            channels: [
              ...chatIds,
              { id: 'new:crypto-chat', name: '🪙-crypto-chat', type: 0, isNew: true }
            ]
          },
          {
            category: '🔊 VOICE CHANNELS',
            channels: [
              ...voiceIds,
              { id: 'new:lounge-voice', name: '🔊-lounge-voice', type: 2, isNew: true }
            ]
          }
        ]
      };

      return res.json({
        suggestion: mockSuggestion,
        note: 'Mock grouping served. Add GEMINI_API_KEY in backend/.env or input your personal AI key to use custom AI sorting.'
      });
    }

    const genAI = new GoogleGenerativeAI(apiKey);
    const model = genAI.getGenerativeModel({ model: 'gemini-2.5-flash' });

    const emojiPrompt = autoEmoji 
      ? `If autoEmoji is enabled, please suggest appropriate topic-related emojis to prepend to the names of existing channels as well (e.g. 'general' -> '💬-general'). If a channel already has an emoji, you can optimize it or keep it.`
      : `Do NOT change existing channel names, keep them exactly as they are.`;

    const systemPrompt = `You are an expert Discord community layout designer. 
    1. Organize this list of existing text and voice channels into clean, professional categories (e.g. "📢 INFO & LINKS", "💬 GENERAL CHAT", "🔊 VOICE CHATS", "📈 TRADING FLOORS"). 
    2. Additionally, suggest 3-5 high-value NEW channels that are highly beneficial for a premium trading & community server (e.g. "#📈-options-signals", "#🔊-trading-floor", "#💡-gems-chat") that are currently missing from the list.
    
    ${emojiPrompt}
    
    Format for channels inside the categories array:
    - For existing channels, use their exact ID (e.g. "1203912903") and set "isNew": false. If autoEmoji is true, set the "name" field to the suggested emoji-prefixed name; otherwise set it to their exact current name.
    - For new suggested channels, assign a unique ID starting with 'new:' followed by their name (e.g. 'new:options-signals'), set "isNew": true, and set "name" to a clean emoji-prefixed hyphenated string (e.g. "📈-options-signals").
    - Make sure "type" is correct (0 for text/news channels, 2 for voice channels).
    
    Here is the list of existing channels in JSON format (id, name, and type):
    ${JSON.stringify(sortedChannels)}

    Return ONLY a raw JSON object matching this schema:
    {
      "categories": [
        {
          "category": "Category Name",
          "channels": [
            { "id": "existing-id", "name": "existing-name", "type": 0, "isNew": false },
            { "id": "new:suggested-name", "name": "📈-suggested-name", "type": 0, "isNew": true }
          ]
        }
      ]
    }
    
    Do not wrap the response in markdown blocks like \`\`\`json. Return only the raw parseable JSON string.`;

    const result = await model.generateContent(systemPrompt);
    const responseText = result.response.text().trim();

    let cleanJsonStr = responseText;
    if (cleanJsonStr.startsWith('```')) {
      cleanJsonStr = cleanJsonStr.replace(/^```(json)?/, '').replace(/```$/, '').trim();
    }

    const suggestion = JSON.parse(cleanJsonStr);
    addLog(`AI suggested channel layout with recommendations`, 'info');
    res.json({ suggestion });
  } catch (err: any) {
    addLog(`AI sorting error: ${err.message}`, 'error');
    res.status(500).json({ error: `AI Sorting suggestion failed: ${err.message}` });
  }
});

// Apply sorting / move channels on Discord Guild, clean leftovers, duplicates, and create suggested new channels
router.post('/ai/apply-sorting', async (req: Request, res: Response) => {
  const { suggestion, cleanLeftovers, removeDuplicates, createMissing } = req.body;

  const guild = getGuild((req as any).guildId);
  if (!guild) {
    return res.status(404).json({ error: 'Guild connection not available' });
  }

  try {
    const fetchedChannels = await guild.channels.fetch();
    const existingOrganizableChannels = new Map(
      fetchedChannels
        .filter(c => c !== null && (c.type === 0 || c.type === 2 || c.type === 5))
        .map(c => [c!.id, { id: c!.id, type: c!.type }])
    );
    const safeSuggestion = validateOrganizationPlan(suggestion, existingOrganizableChannels);
    if (!safeSuggestion) {
      return res.status(400).json({ error: 'Invalid or unsafe AI organization plan. Generate a new suggestion and review it before applying.' });
    }

    if (removeDuplicates) {
      addLog('Scanning for duplicate channel names within the same category...', 'info');
      const allChannels = fetchedChannels;
      
      const textAndVoice = allChannels.filter(c => c !== null && (c.type === 0 || c.type === 2 || c.type === 5));
      const seenNames = new Map<string, string>(); 

      for (const ch of textAndVoice.values()) {
        if (!ch) continue;
        const cleanName = ch.name.toLowerCase().trim();
        const duplicateKey = `${ch.parentId || 'no-category'}:${cleanName}`;
        if (seenNames.has(duplicateKey)) {
          try {
            await ch.delete();
            addLog(`Deleted duplicate channel: #${ch.name}`, 'info');
          } catch (delChErr: any) {
            addLog(`Could not delete duplicate channel #${ch.name}: ${delChErr.message}`, 'warn');
          }
        } else {
          seenNames.set(duplicateKey, ch.id);
        }
      }
    }

    addLog('Applying AI channel sorting layout...', 'info');
    const createdCategoryIds = new Set<string>();

    for (const group of safeSuggestion.categories) {
      if (group.channels.length === 0) continue;

      let categoryChannel = guild.channels.cache.find(c => 
        c.name.toLowerCase() === group.category.toLowerCase() && c.type === 4 
      );

      if (!categoryChannel) {
        categoryChannel = await guild.channels.create({
          name: group.category,
          type: 4
        });
        createdCategoryIds.add(categoryChannel.id);
        addLog(`Created category: "${group.category}"`, 'info');
      }

      for (const channelObj of group.channels) {
        if (channelObj.isNew) {
          if (createMissing) {
            const cleanTargetName = channelObj.name.replace(/^[^\w]*-?/, '').toLowerCase();
            const exists = guild.channels.cache.find(c => 
              c.parentId === categoryChannel!.id && 
              c.name.toLowerCase().replace(/^[^\w]*-?/, '') === cleanTargetName
            );

            if (!exists) {
              try {
                const cleanChanName = channelObj.type === 0
                  ? channelObj.name.toLowerCase().replace(/\s+/g, '-')
                  : channelObj.name;
                const newChan = await guild.channels.create({
                  name: cleanChanName,
                  type: channelObj.type,
                  parent: categoryChannel.id
                });
                addLog(`Created new AI recommended channel: #${(newChan as any).name} under category "${group.category}"`, 'info');
              } catch (createErr: any) {
                addLog(`Failed to create recommended channel ${channelObj.name}: ${createErr.message}`, 'warn');
              }
            }
          }
        } else {
          try {
            const channel = await guild.channels.fetch(channelObj.id);
            if (channel && (channel.type === 0 || channel.type === 2 || channel.type === 5)) {
              await (channel as any).setParent(categoryChannel.id, { lockPermissions: false });
              
              // If name has changed (e.g. AI appended an emoji), rename it!
              // Only enforce lowercase/hyphenation for text channels (type 0 or 5)
              const cleanTargetName = (channel.type === 0 || channel.type === 5)
                ? channelObj.name.toLowerCase().replace(/\s+/g, '-')
                : channelObj.name;
                
              if (channel.name !== cleanTargetName) {
                const oldName = channel.name;
                await (channel as any).setName(cleanTargetName);
                addLog(`Moved & Renamed #${oldName} to #${cleanTargetName} under category "${group.category}"`, 'info');
              } else {
                addLog(`Moved #${(channel as any).name} under category "${group.category}"`, 'info');
              }
            }
          } catch (chErr: any) {
            addLog(`Skipped shifting channel ${channelObj.id} (might have been deleted as duplicate)`, 'info');
          }
        }
      }
    }

    if (cleanLeftovers) {
      addLog('Cleaning leftover empty categories...', 'info');
      const allChannels = await guild.channels.fetch();
      const categories = allChannels.filter(c => c !== null && c.type === 4);

      for (const cat of categories.values()) {
        if (!cat || !createdCategoryIds.has(cat.id)) continue;
        const children = allChannels.filter(c => c !== null && c.parentId === cat.id);
        
        if (children.size === 0) {
          try {
            await cat.delete();
            addLog(`Deleted empty leftover category: "${cat.name}"`, 'info');
          } catch (delErr: any) {
            addLog(`Could not delete category "${cat.name}": ${delErr.message}`, 'warn');
          }
        }
      }
    }

    res.json({ message: 'Server channels successfully organized and sorted by AI!' });
  } catch (err: any) {
    addLog(`Failed to apply channel sorting: ${err.message}`, 'error');
    res.status(500).json({ error: `Failed to organize channels: ${err.message}` });
  }
});

// AI rename individual existing channel
router.post('/ai/rename-channel', async (req: Request, res: Response) => {
  const { channelId, prompt, geminiApiKey } = req.body;
  if (!channelId || !prompt) {
    return res.status(400).json({ error: 'Missing channelId or prompt' });
  }

  const apiKey = geminiApiKey || process.env.GEMINI_API_KEY;

  if (!apiKey) {
    try {
      const channel = await client.channels.fetch(channelId);
      if (channel && channel.isTextBased()) {
        const mockName = `✨-${prompt.replace(/\s+/g, '-').toLowerCase()}`;
        await (channel as TextChannel).setName(mockName);
        const msg = `Mock AI Renamed channel to #${mockName}`;
        addLog(msg, 'info');
        return res.json({ message: msg, name: mockName });
      }
      return res.status(404).json({ error: 'Text channel not found' });
    } catch (err: any) {
      return res.status(500).json({ error: `Mock rename failed: ${err.message}` });
    }
  }

  try {
    const genAI = new GoogleGenerativeAI(apiKey);
    const model = genAI.getGenerativeModel({ model: 'gemini-2.5-flash' });

    const systemPrompt = `You are a professional Discord server architect. Suggest a cool, short, lowercase, hyphenated channel name based on this prompt/purpose: "${prompt}". 
    Optionally, prepend a single matching emoji at the start followed by a hyphen (for example: "📈-option-trading" or "🤪-memes" or "💬-general"). 
    Return ONLY the suggested name string (no quote marks, no markdown, no description, just the raw text name). Max 30 characters.`;

    const result = await model.generateContent(systemPrompt);
    const suggestedName = result.response.text().trim().replace(/[\"'`]/g, '').replace(/\s+/g, '-').toLowerCase();

    const channel = await client.channels.fetch(channelId);
    if (channel && channel.isTextBased()) {
      const oldName = (channel as TextChannel).name;
      await (channel as TextChannel).setName(suggestedName);
      const msg = `AI Renamed channel #${oldName} to #${suggestedName} based on prompt: "${prompt}"`;
      addLog(msg, 'info');
      res.json({ message: msg, name: suggestedName });
    } else {
      res.status(404).json({ error: 'Text channel not found' });
    }
  } catch (err: any) {
    addLog(`AI Channel Rename failed: ${err.message}`, 'error');
    res.status(500).json({ error: `AI Rename failed: ${err.message}` });
  }
});

// ----------------------------------------------------
// UNIVERSAL BROADCASTER / CHANNEL POSTER
// ----------------------------------------------------
router.post('/broadcaster/post', async (req: Request, res: Response) => {
  const { channelId, postType, textContent, embedTitle, embedColor, pollQuestion, pollOptions, pollDuration, imageUrl, imageBase64 } = req.body;
  if (!channelId || !postType) {
    return res.status(400).json({ error: 'Missing channelId or postType' });
  }

  try {
    const guild = getGuild((req as any).guildId);
    if (!guild) {
      return res.status(404).json({ error: 'Guild not connected' });
    }

    const channel = await guild.channels.fetch(channelId);
    if (!channel || !channel.isTextBased()) {
      return res.status(404).json({ error: 'Text channel not found or not text-based' });
    }

    let files: any[] = [];
    let embedImageUrl = imageUrl;

    if (imageBase64) {
      const matches = imageBase64.match(/^data:([A-Za-z-+\/]+);base64,(.+)$/);
      if (matches && matches.length === 3) {
        const type = matches[1];
        const base64Data = matches[2];
        const buffer = Buffer.from(base64Data, 'base64');
        const extension = type.split('/')[1] || 'png';
        const filename = `upload.${extension}`;
        
        const attachment = new AttachmentBuilder(buffer, { name: filename });
        files.push(attachment);
        embedImageUrl = `attachment://${filename}`;
      }
    }

    if (postType === 'text') {
      if (!textContent && files.length === 0 && !imageUrl) {
        return res.status(400).json({ error: 'Text content or image is required' });
      }
      const msgPayload: any = {};
      if (textContent) msgPayload.content = textContent;
      if (files.length > 0) {
        msgPayload.files = files;
      } else if (imageUrl) {
        msgPayload.embeds = [{ image: { url: imageUrl }, color: 0x2f3136 }];
      }
      await (channel as any).send(msgPayload);
      addLog(`Broadcaster: Sent message to #${(channel as any).name}`, 'info');
      return res.json({ message: 'Message posted successfully!' });
    }

    if (postType === 'embed') {
      if (!textContent) {
        return res.status(400).json({ error: 'Embed description (text content) is required' });
      }
      
      const embed: any = {
        description: textContent,
        color: parseInt(embedColor?.replace('#', '') || '3b82f6', 16),
        timestamp: new Date().toISOString()
      };
      if (embedTitle) {
        embed.title = embedTitle;
      }
      if (embedImageUrl) {
        embed.image = { url: embedImageUrl };
      }

      const msgPayload: any = { embeds: [embed] };
      if (files.length > 0) {
        msgPayload.files = files;
      }

      await (channel as any).send(msgPayload);
      addLog(`Broadcaster: Sent embed message to #${(channel as any).name}`, 'info');
      return res.json({ message: 'Rich Embed posted successfully!' });
    }

    if (postType === 'poll') {
      if (!pollQuestion || !Array.isArray(pollOptions) || pollOptions.length < 2) {
        return res.status(400).json({ error: 'Poll question and at least 2 options are required' });
      }

      const answers = pollOptions.map((opt: any) => ({
        text: typeof opt === 'string' ? opt : opt.text,
        emoji: typeof opt === 'string' ? undefined : opt.emoji || undefined
      }));

      // Send Native Discord Poll
      await (channel as any).send({
        poll: {
          question: { text: pollQuestion },
          answers: answers,
          duration: pollDuration || 24,
          allowMultiselect: false
        }
      });

      addLog(`Broadcaster: Created a poll in #${(channel as any).name}`, 'info');
      return res.json({ message: 'Poll posted successfully!' });
    }

    return res.status(400).json({ error: 'Invalid postType' });
  } catch (err: any) {
    addLog(`Broadcaster failed: ${err.message}`, 'error');
    res.status(500).json({ error: `Failed to broadcast message: ${err.message}` });
  }
});

// ----------------------------------------------------
// VERIFICATION SYSTEM ROUTES
// ----------------------------------------------------
router.post('/settings/verification', (req: Request, res: Response) => {
  const { enabled, channelId, roleId, embedTitle, embedDescription, embedColor } = req.body;
  const db = getDb();
  db.verificationSettings = { enabled, channelId, roleId, embedTitle, embedDescription, embedColor };
  saveDb(db);
  addLog(`Verification settings updated`, 'info');
  res.json({ message: 'Verification settings saved', settings: db });
});

router.post('/verification/send', async (req: Request, res: Response) => {
  const db = getDb();
  const vs = db.verificationSettings;
  if (!vs || !vs.enabled || !vs.channelId || !vs.roleId) {
    return res.status(400).json({ error: 'Verification is not fully configured' });
  }

  try {
    const guild = getGuild((req as any).guildId);
    if (!guild) return res.status(404).json({ error: 'Guild not connected' });

    const channel = await guild.channels.fetch(vs.channelId);
    if (!channel || !channel.isTextBased()) {
      return res.status(404).json({ error: 'Verification channel not found' });
    }

    const embed = new EmbedBuilder()
      .setTitle(vs.embedTitle || '✅ Server Verification')
      .setDescription(vs.embedDescription || 'Click the button below to verify!')
      .setColor(parseInt(vs.embedColor?.replace('#', '') || '00d26a', 16))
      .setTimestamp();

    const button = new ButtonBuilder()
      .setCustomId('verify_button')
      .setLabel('✅ Verify Me')
      .setStyle(ButtonStyle.Success);

    const row = new ActionRowBuilder<ButtonBuilder>().addComponents(button);

    await (channel as any).send({ embeds: [embed], components: [row] });
    addLog(`Verification embed sent to #${(channel as any).name}`, 'info');
    res.json({ message: 'Verification embed posted successfully!' });
  } catch (err: any) {
    addLog(`Failed to send verification embed: ${err.message}`, 'error');
    res.status(500).json({ error: `Failed: ${err.message}` });
  }
});

export default router;
