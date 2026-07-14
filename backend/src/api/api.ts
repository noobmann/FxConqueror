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

type AIOrganizationSnapshot = {
  id: string;
  name: string;
  parentId: string | null;
};

type AIOrganizationHistory = {
  createdAt: number;
  channels: AIOrganizationSnapshot[];
  createdChannelIds: string[];
  createdCategoryIds: string[];
};

const aiOrganizationHistory = new Map<string, AIOrganizationHistory>();

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
  if (req.path === '/auth/login' || req.path === '/public/status' || req.path === '/' || req.path === '/health') {
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

function protectedRoleError(role: any): string | null {
  const name = role.name.toLowerCase().trim();
  if (role.managed) return 'Bot-managed roles cannot be changed here.';
  if (name === 'owner' || name.includes('core players')) return 'This protected founder role cannot be changed here.';
  if (!role.editable) return 'The bot must be above this role in Discord role hierarchy.';
  return null;
}

function hasValidAIPasscode(req: Request) {
  const required = process.env.AI_ORGANIZER_PASSCODE;
  return !required || req.body?.aiPasscode === required;
}

async function sendModerationNotice(userId: string, action: string, reason?: string) {
  const channelId = getDb().moderationNoticeChannelId;
  if (!channelId) return;
  try {
    const channel = await client.channels.fetch(channelId);
    if (channel && channel.isTextBased()) await (channel as TextChannel).send(`⚠️ <@${userId}> was **${action}**. Reason: ${reason || 'No reason provided'}`);
  } catch (err: any) { addLog(`Could not send moderation notice: ${err.message}`, 'warn'); }
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

router.get('/', (req: Request, res: Response) => {
  res.json({ status: 'online', message: 'Fx Conquerors backend service is awake' });
});

router.get('/health', (req: Request, res: Response) => {
  res.json({ status: 'ok', uptime: process.uptime() });
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
        color: r.hexColor,
        memberCount: r.members.size,
        protected: Boolean(protectedRoleError(r))
      }));
    res.json(sortedRoles);
  } catch (err: any) {
    res.status(500).json({ error: `Failed to fetch roles: ${err.message}` });
  }
});

router.post('/roles/create', async (req: Request, res: Response) => {
  const guild = getGuild((req as any).guildId);
  const name = typeof req.body.name === 'string' ? req.body.name.trim() : '';
  if (!guild || !name || name.length > 100) return res.status(400).json({ error: 'Enter a role name up to 100 characters.' });
  try {
    const role = await guild.roles.create({ name, color: /^#[0-9a-f]{6}$/i.test(req.body.color || '') ? req.body.color : undefined });
    addLog(`Created role: ${role.name}`, 'info');
    res.json({ message: `Created ${role.name}` });
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

router.post('/roles/update', async (req: Request, res: Response) => {
  const guild = getGuild((req as any).guildId);
  if (!guild) return res.status(404).json({ error: 'Guild unavailable' });
  try {
    const role = await guild.roles.fetch(req.body.roleId);
    if (!role) return res.status(404).json({ error: 'Role not found' });
    const blocked = protectedRoleError(role); if (blocked) return res.status(403).json({ error: blocked });
    const name = typeof req.body.name === 'string' ? req.body.name.trim() : '';
    if (!name || name.length > 100) return res.status(400).json({ error: 'Enter a role name up to 100 characters.' });
    await role.edit({ name, color: /^#[0-9a-f]{6}$/i.test(req.body.color || '') ? req.body.color : undefined });
    res.json({ message: 'Role updated.' });
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

router.post('/roles/member', async (req: Request, res: Response) => {
  const guild = getGuild((req as any).guildId);
  if (!guild || !['add', 'remove'].includes(req.body.action)) return res.status(400).json({ error: 'Invalid role action.' });
  try {
    const role = await guild.roles.fetch(req.body.roleId);
    const member = await guild.members.fetch(req.body.memberId);
    if (!role || !member) return res.status(404).json({ error: 'Role or member not found.' });
    const blocked = protectedRoleError(role); if (blocked) return res.status(403).json({ error: blocked });
    if (req.body.action === 'add') await member.roles.add(role); else await member.roles.remove(role);
    res.json({ message: `Role ${req.body.action === 'add' ? 'added to' : 'removed from'} ${member.user.username}.` });
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

router.post('/roles/replace', async (req: Request, res: Response) => {
  const guild = getGuild((req as any).guildId);
  if (!guild) return res.status(404).json({ error: 'Guild unavailable' });
  try {
    const from = await guild.roles.fetch(req.body.fromRoleId); const to = await guild.roles.fetch(req.body.toRoleId);
    if (!from || !to || from.id === to.id) return res.status(400).json({ error: 'Select two different valid roles.' });
    const blocked = protectedRoleError(from) || protectedRoleError(to); if (blocked) return res.status(403).json({ error: blocked });
    const members = await guild.members.fetch(); let count = 0;
    for (const member of members.values()) if (member.roles.cache.has(from.id)) { await member.roles.add(to); await member.roles.remove(from); count++; }
    res.json({ message: `Replaced ${from.name} with ${to.name} for ${count} members.` });
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

router.post('/roles/delete', async (req: Request, res: Response) => {
  const guild = getGuild((req as any).guildId);
  if (!guild) return res.status(404).json({ error: 'Guild unavailable' });
  try {
    const role = await guild.roles.fetch(req.body.roleId); if (!role) return res.status(404).json({ error: 'Role not found.' });
    const blocked = protectedRoleError(role); if (blocked) return res.status(403).json({ error: blocked });
    await role.delete('Deleted from dashboard role editor'); res.json({ message: 'Role deleted.' });
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

router.post('/ai/role-advice', async (req: Request, res: Response) => {
  const guild = getGuild((req as any).guildId);
  const apiKey = req.body.geminiApiKey || process.env.GEMINI_API_KEY;
  if (!guild || !apiKey) return res.status(400).json({ error: 'A Gemini API key is required for AI role advice.' });
  try {
    const roles = await guild.roles.fetch();
    const roleList = roles.filter(r => r.name !== '@everyone').map(r => ({ name: r.name, members: r.members.size, managed: r.managed }));
    const model = new GoogleGenerativeAI(apiKey).getGenerativeModel({ model: 'gemini-2.5-flash' });
    const result = await model.generateContent(`Review these Discord roles. Give a concise safe cleanup plan. Never advise deleting owner, founder/core, staff, or managed bot roles without confirmation. Roles: ${JSON.stringify(roleList)}`);
    res.json({ advice: result.response.text().trim() });
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

router.get('/scheduled-messages', (_req: Request, res: Response) => res.json(getDb().scheduledMessages || []));

router.post('/scheduled-messages', (req: Request, res: Response) => {
  const { channelId, message, timeIST } = req.body;
  if (typeof channelId !== 'string' || typeof message !== 'string' || !message.trim() || message.length > 2000 || !/^([01]\d|2[0-3]):[0-5]\d$/.test(timeIST || '')) {
    return res.status(400).json({ error: 'Choose a channel, message, and valid IST time.' });
  }
  const db = getDb();
  db.scheduledMessages = db.scheduledMessages || [];
  db.scheduledMessages.push({ id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`, channelId, message: message.trim(), timeIST, enabled: true });
  saveDb(db); res.json({ message: 'Daily IST message scheduled.', schedules: db.scheduledMessages });
});

router.post('/scheduled-messages/toggle', (req: Request, res: Response) => {
  const db = getDb(); const schedule = (db.scheduledMessages || []).find(item => item.id === req.body.id);
  if (!schedule) return res.status(404).json({ error: 'Schedule not found.' });
  schedule.enabled = !schedule.enabled; saveDb(db); res.json({ message: `Schedule ${schedule.enabled ? 'enabled' : 'paused'}.`, schedules: db.scheduledMessages });
});

router.post('/scheduled-messages/delete', (req: Request, res: Response) => {
  const db = getDb(); const before = (db.scheduledMessages || []).length;
  db.scheduledMessages = (db.scheduledMessages || []).filter(item => item.id !== req.body.id);
  if (db.scheduledMessages.length === before) return res.status(404).json({ error: 'Schedule not found.' });
  saveDb(db); res.json({ message: 'Schedule deleted.', schedules: db.scheduledMessages });
});

router.post('/settings/moderation', async (req: Request, res: Response) => {
  const { photoOnlyChannels, slowmodeChannels, moderationNoticeChannelId } = req.body;
  if (!Array.isArray(photoOnlyChannels) || typeof slowmodeChannels !== 'object') {
    return res.status(400).json({ error: 'Invalid moderation configuration data' });
  }

  const db = getDb();
  db.photoOnlyChannels = photoOnlyChannels;
  if (typeof moderationNoticeChannelId === 'string') db.moderationNoticeChannelId = moderationNoticeChannelId;

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
  const { enabled, channelId, message, autoRoleId, embedStyle } = req.body;
  if (typeof enabled !== 'boolean' || typeof message !== 'string') {
    return res.status(400).json({ error: 'Invalid welcome settings data' });
  }

  const db = getDb();
  db.welcomeSettings = { enabled, channelId, message, autoRoleId, embedStyle: embedStyle !== false };
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

router.post('/moderation/warn', async (req: Request, res: Response) => {
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
  await sendModerationNotice(userId, 'warned', reason);
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
    await sendModerationNotice(userId, 'kicked', reason);
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
    await sendModerationNotice(userId, 'banned', reason);
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
  if (!hasValidAIPasscode(req)) return res.status(403).json({ error: 'AI organizer passcode is incorrect.' });
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
  if (!hasValidAIPasscode(req)) return res.status(403).json({ error: 'AI organizer passcode is incorrect.' });
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

    const history: AIOrganizationHistory | null = removeDuplicates
      ? null
      : {
          createdAt: Date.now(),
          channels: fetchedChannels
            .filter(c => c !== null && (c.type === 0 || c.type === 2 || c.type === 5))
            .map(c => ({ id: c!.id, name: c!.name, parentId: c!.parentId })),
          createdChannelIds: [],
          createdCategoryIds: []
        };
    if (history) aiOrganizationHistory.set(guild.id, history);

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
        history?.createdCategoryIds.push(categoryChannel.id);
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
                history?.createdChannelIds.push((newChan as any).id);
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

    res.json({
      message: 'Server channels successfully organized and sorted by AI!',
      undoAvailable: Boolean(history),
      note: history ? 'You can undo this AI organization from the dashboard.' : 'Undo is unavailable because duplicate deletion was enabled.'
    });
  } catch (err: any) {
    addLog(`Failed to apply channel sorting: ${err.message}`, 'error');
    res.status(500).json({ error: `Failed to organize channels: ${err.message}` });
  }
});

// Undo the most recent non-destructive AI organization for this server.
router.post('/ai/undo-sorting', async (req: Request, res: Response) => {
  const guild = getGuild((req as any).guildId);
  if (!guild) return res.status(404).json({ error: 'Guild connection not available' });

  const history = aiOrganizationHistory.get(guild.id);
  if (!history) return res.status(404).json({ error: 'No reversible AI organization was found for this server.' });

  try {
    for (const state of history.channels) {
      try {
        const channel = await guild.channels.fetch(state.id);
        if (!channel || !(channel.type === 0 || channel.type === 2 || channel.type === 5)) continue;
        await (channel as any).setParent(state.parentId, { lockPermissions: false });
        if (channel.name !== state.name) await (channel as any).setName(state.name);
      } catch (channelErr: any) {
        addLog(`Could not restore channel ${state.id}: ${channelErr.message}`, 'warn');
      }
    }

    for (const channelId of history.createdChannelIds) {
      try {
        const channel = await guild.channels.fetch(channelId);
        if (channel) await channel.delete('Undo AI organization');
      } catch (channelErr: any) {
        addLog(`Could not remove AI-created channel ${channelId}: ${channelErr.message}`, 'warn');
      }
    }

    const allChannels = await guild.channels.fetch();
    for (const categoryId of history.createdCategoryIds) {
      const category = allChannels.get(categoryId);
      if (!category || category.type !== 4) continue;
      const children = allChannels.filter(c => c !== null && c.parentId === categoryId);
      if (children.size === 0) await category.delete('Undo AI organization');
    }

    aiOrganizationHistory.delete(guild.id);
    addLog('Undid the most recent AI channel organization.', 'info');
    res.json({ message: 'AI organization was undone. Existing channels were restored and AI-created channels were removed.' });
  } catch (err: any) {
    addLog(`Failed to undo AI organization: ${err.message}`, 'error');
    res.status(500).json({ error: `Unable to undo AI organization: ${err.message}` });
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

// Draft a broadcaster post; the dashboard always lets the moderator review it before sending.
router.post('/ai/generate-post', async (req: Request, res: Response) => {
  const { prompt, postType, geminiApiKey } = req.body as {
    prompt?: unknown; postType?: unknown; geminiApiKey?: unknown;
  };
  if (typeof prompt !== 'string' || !prompt.trim() || (postType !== 'text' && postType !== 'embed')) {
    return res.status(400).json({ error: 'Provide a post idea and choose text or embed format.' });
  }

  const apiKey = (typeof geminiApiKey === 'string' && geminiApiKey) || process.env.GEMINI_API_KEY;
  if (!apiKey) return res.status(400).json({ error: 'Add a Gemini API key before generating a post.' });

  try {
    const model = new GoogleGenerativeAI(apiKey).getGenerativeModel({ model: 'gemini-2.5-flash' });
    const format = postType === 'text'
      ? '{"content":"Discord-ready post, maximum 1900 characters"}'
      : '{"title":"short title", "description":"Discord embed body, maximum 3900 characters", "color":"#2563eb"}';
    const result = await model.generateContent(
      `Write a concise, friendly Discord ${postType} post for this request: ${prompt.trim()}. ` +
      `Return only valid JSON matching: ${format}. Do not mention that AI wrote it.`
    );
    const raw = result.response.text().trim().replace(/^```(?:json)?\s*/, '').replace(/\s*```$/, '');
    const draft = JSON.parse(raw) as { content?: unknown; title?: unknown; description?: unknown; color?: unknown };

    if (postType === 'text') {
      if (typeof draft.content !== 'string' || !draft.content.trim()) throw new Error('AI returned an invalid text draft');
      return res.json({ draft: { content: draft.content.trim().slice(0, 1900) } });
    }

    if (typeof draft.title !== 'string' || typeof draft.description !== 'string') throw new Error('AI returned an invalid embed draft');
    const color = typeof draft.color === 'string' && /^#[0-9a-f]{6}$/i.test(draft.color) ? draft.color : '#2563eb';
    return res.json({ draft: { title: draft.title.trim().slice(0, 256), description: draft.description.trim().slice(0, 3900), color } });
  } catch (err: any) {
    addLog(`AI post generation failed: ${err.message}`, 'error');
    return res.status(500).json({ error: `AI post generation failed: ${err.message}` });
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
