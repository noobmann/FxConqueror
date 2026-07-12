import { Router, Request, Response, NextFunction } from 'express';
import { client, activityLogs, updateChannelSlowmode, addLog } from '../bot/bot';
import { getDb, saveDb, WarningRecord } from '../utils/db';
import { TextChannel, PermissionsBitField } from 'discord.js';
import { GoogleGenerativeAI } from '@google/generative-ai';

const router = Router();

const sessions = new Set<string>();

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
    return next();
  }
  return res.status(401).json({ error: 'Unauthorized access: Invalid session token' });
}

router.use(authMiddleware);

// Find the target Guild by name search (Fx Conquerors), falling back to first guild in cache
function getGuild() {
  const target = client.guilds.cache.find(g => g.name.toLowerCase().includes('conqueror'));
  if (target) return target;
  return client.guilds.cache.first();
}

// ----------------------------------------------------
// AUTHENTICATION & PUBLIC STATUS ROUTE
// ----------------------------------------------------
router.post('/auth/login', (req: Request, res: Response) => {
  const { username, password } = req.body;
  const envUser = process.env.ADMIN_USERNAME || 'admin';
  const envPass = process.env.ADMIN_PASSWORD || 'conquerors123';

  if (username === envUser && password === envPass) {
    const token = Math.random().toString(36).substr(2) + Math.random().toString(36).substr(2);
    sessions.add(token);
    addLog(`Successful login via Web Dashboard from admin`, 'info');
    return res.json({ token });
  }
  
  addLog(`Failed login attempt for user "${username}" from dashboard`, 'warn');
  return res.status(401).json({ error: 'Invalid username or password' });
});

router.get('/public/status', (req: Request, res: Response) => {
  const guild = getGuild();
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
  const guild = getGuild();

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
  const guild = getGuild();
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
  const guild = getGuild();
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
  const guild = getGuild();
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

  const guild = getGuild();
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

  const guild = getGuild();
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
  const guild = getGuild();
  if (!guild) {
    return res.status(404).json({ error: 'Guild connection not active' });
  }

  const { geminiApiKey } = req.body;

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
        const item = { id: ch.id, name: ch.name, type: ch.type, isNew: false };
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

    const systemPrompt = `You are an expert Discord community layout designer. 
    1. Organize this list of existing text and voice channels into clean, professional categories (e.g. "📢 INFO & LINKS", "💬 GENERAL CHAT", "🔊 VOICE CHATS", "📈 TRADING FLOORS"). 
    2. Additionally, suggest 3-5 high-value NEW channels that are highly beneficial for a premium trading & community server (e.g. "#📈-options-signals", "#🔊-trading-floor", "#💡-gems-chat") that are currently missing from the list.
    
    Format for channels inside the categories array:
    - For existing channels, use their exact ID (e.g. "1203912903") and set "isNew": false. Do NOT change their names.
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
  if (!suggestion || !Array.isArray(suggestion.categories)) {
    return res.status(400).json({ error: 'Invalid sorting layout structure' });
  }

  const guild = getGuild();
  if (!guild) {
    return res.status(404).json({ error: 'Guild connection not available' });
  }

  try {
    if (removeDuplicates) {
      addLog('Scanning for duplicate channel names to remove...', 'info');
      const allChannels = await guild.channels.fetch();
      
      const textAndVoice = allChannels.filter(c => c !== null && (c.type === 0 || c.type === 2 || c.type === 5));
      const seenNames = new Map<string, string>(); 

      for (const ch of textAndVoice.values()) {
        if (!ch) continue;
        const cleanName = ch.name.toLowerCase().trim();
        if (seenNames.has(cleanName)) {
          try {
            await ch.delete();
            addLog(`Deleted duplicate channel: #${ch.name}`, 'info');
          } catch (delChErr: any) {
            addLog(`Could not delete duplicate channel #${ch.name}: ${delChErr.message}`, 'warn');
          }
        } else {
          seenNames.set(cleanName, ch.id);
        }
      }
    }

    addLog('Applying AI channel sorting layout...', 'info');
    const activeCategoryIds = new Set<string>();

    for (const group of suggestion.categories) {
      if (group.channels.length === 0) continue;

      let categoryChannel = guild.channels.cache.find(c => 
        c.name.toLowerCase() === group.category.toLowerCase() && c.type === 4 
      );

      if (!categoryChannel) {
        categoryChannel = await guild.channels.create({
          name: group.category,
          type: 4
        });
        addLog(`Created category: "${group.category}"`, 'info');
      }

      activeCategoryIds.add(categoryChannel.id);

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
                const newChan = await guild.channels.create({
                  name: channelObj.name,
                  type: channelObj.type,
                  parent: categoryChannel.id
                });
                addLog(`Created new AI recommended channel: #${newChan.name} under category "${group.category}"`, 'info');
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
              addLog(`Moved #${(channel as any).name} under category "${group.category}"`, 'info');
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
        if (!cat) continue;
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
  const { channelId, postType, textContent, embedTitle, embedColor, pollQuestion, pollOptions, pollDuration } = req.body;
  if (!channelId || !postType) {
    return res.status(400).json({ error: 'Missing channelId or postType' });
  }

  try {
    const guild = getGuild();
    if (!guild) {
      return res.status(404).json({ error: 'Guild not connected' });
    }

    const channel = await guild.channels.fetch(channelId);
    if (!channel || !channel.isTextBased()) {
      return res.status(404).json({ error: 'Text channel not found or not text-based' });
    }

    if (postType === 'text') {
      if (!textContent) {
        return res.status(400).json({ error: 'Text content is required' });
      }
      await (channel as any).send(textContent);
      addLog(`Broadcaster: Sent text message to #${(channel as any).name}`, 'info');
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

      await (channel as any).send({ embeds: [embed] });
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

export default router;
