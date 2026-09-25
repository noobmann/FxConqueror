import * as fs from 'fs';
import * as path from 'path';
import { MongoClient, Db } from 'mongodb';

export interface WelcomeSettings {
  enabled: boolean;
  channelId: string;
  message: string;
  autoRoleId: string;
  embedStyle?: boolean;
}

export interface LeaveSettings {
  enabled: boolean;
  channelId: string;
  message: string;
}

export interface ReactionRole {
  messageId: string;
  emoji: string;
  roleId: string;
}

export interface Trigger {
  id: string;
  trigger: string;
  reply: string;
}

export interface LevelingSettings {
  enabled: boolean;
  levelUpMessage: string;
  roleRewards: { level: number; roleId: string }[];
}

export interface XpRecord {
  xp: number;
  level: number;
  lastXpTime: number;
  username: string;
}

export interface AutoModSettings {
  badWordsEnabled: boolean;
  badWordsList: string[];
  blockLinks: boolean;
  blockCaps: boolean;
}

export interface WarningRecord {
  id: string;
  reason: string;
  timestamp: string;
}

export interface VerificationSettings {
  enabled: boolean;
  channelId: string;
  roleId: string;
  embedTitle: string;
  embedDescription: string;
  embedColor: string;
}

export interface ButtonRole {
  roleId: string;
  label: string;
  emoji?: string;
  style: string;
}

export interface ButtonRolePanel {
  id: string;
  name: string;
  channelId: string;
  embedTitle: string;
  embedDescription: string;
  embedColor: string;
  buttons: ButtonRole[];
}

export interface AiChatSettings {
  enabled: boolean;
  channelId: string;
  replyOnMention: boolean;
  instructions: string;
  modelName?: string;
  provider?: 'gemini' | 'groq';
  groqApiKey?: string;
}


export interface ScheduledMessage {
  id: string;
  channelId: string;
  message: string;
  timeIST: string;
  enabled: boolean;
  lastSentDate?: string;
}

export interface Credentials {
  discordToken?: string;
  geminiApiKey?: string;
}

export interface ModerationLog {
  id: string;
  userId: string;
  userTag: string;
  action: string;
  reason: string;
  timestamp: string;
}

export interface DatabaseSchema {
  photoOnlyChannels: string[];
  slowmodeChannels: Record<string, number>;
  welcomeSettings: WelcomeSettings;
  leaveSettings: LeaveSettings;
  reactionRoles: ReactionRole[];
  triggers: Trigger[];
  auditLogChannelId: string;
  moderationNoticeChannelId: string;
  levelingSettings: LevelingSettings;
  xpData: Record<string, XpRecord>;
  autoMod: AutoModSettings;
  warnings: Record<string, WarningRecord[]>;
  credentials?: Credentials;
  verificationSettings?: VerificationSettings;
  scheduledMessages: ScheduledMessage[];
  moderationLogs: ModerationLog[];
  buttonRolePanels: ButtonRolePanel[];
  aiChatSettings?: AiChatSettings;
}

const DB_PATH = path.join(__dirname, '../../database.json');
const COLLECTION_NAME = 'settings';

export const DEFAULT_BANTAI_PROMPT = `You are a savage, street-smart Indian guy who speaks strictly in clean, fluent Hinglish (Roman script only). You chill with the boys on Discord and roast people brutally with famous Indian memes.

### 🎯 CORE RULES:
1. Natural Hinglish: Speak strictly in fluent, natural Hinglish that actual Indian friends speak. Never speak broken, gibberish, or nonsense Hindi (NO weird translated phrases like "parda khocha").
2. Short & Savage: Strictly 1 to 2 punchy lines MAX. No long lectures.
3. Roast & Meme Matching: Understand the user's intent and context. If someone insults you or complains, hit back with an instant savage roast using cult Indian meme lines (Hera Pheri, Mirzapur, Wasseypur, TMKOC, Puneet Superstar, Arpit Bala, Bassi, "50 rupya kaat overacting ka", "Kya gunda banega re tu", "Aukaat me reh", "Aayein/Baigan", "Le re lund ke...", "Chhoti bachhi ho kya", etc.).
4. Family Boundary: NEVER abuse or target anyone's mother, sister, or parents directly (zero "teri maa", "teri behen"). Use general slangs (lodu, chutiye, laude, saale, bhenchod, maa ka bhosda as general frustration) strictly as comedic venting or roast punchlines.

### 🎭 EXAMPLE RESPONSES (FOLLOW THIS EXACT VIBE):
- User: "Yeh bot bawasir hai"
  Bot: "Bawasir toh teri baatein hain lodu, dekh ke doctor bhi ilaaj chhod de. Chal aage badh yahan se."

- User: "Yeh banda bohot tej chal raha hai bol raha hai bot bekar hai"
  Bot: "Bohot tej chal raha hai toh gaadi ke aage daal de saale ko! 50 rupya kaat iska overacting ka pehle."

- User: "Yar bot khana khaya kya?"
  Bot: "Le re lund ke teri bread tera doodh, maa ka bhosda nahi khana mujhe. Tu apna dekh le pehle."

- User: "Bhai bot tu ladka hai ya ladki?"
  Bot: "Aadhaar card dikhaun kya apna lodu? Chhoti bachhi hai kya jo gender pooch raha hai, kaam bol."

- User: "Bhai mera break-up ho gaya"
  Bot: "Acha hua chutkara mila saale ko. Chal ab randi rona band kar aur 2 cutting chai laga."

- User: "Bhai thoda motiivate kar de na"
  Bot: "Aukaat me reh ke mehnat karega toh sab hoga lodu. Khol kitaab chupchap, gyan mat pel."`;

const defaultDb: DatabaseSchema = {
  photoOnlyChannels: [],
  slowmodeChannels: {},
  welcomeSettings: {
    enabled: false,
    channelId: '',
    message: 'Welcome to the server, {user}!',
    autoRoleId: '',
    embedStyle: true
  },
  leaveSettings: {
    enabled: false,
    channelId: '',
    message: 'Goodbye {user}, we will miss you!'
  },
  reactionRoles: [],
  scheduledMessages: [],
  triggers: [],
  auditLogChannelId: '',
  moderationNoticeChannelId: '',
  levelingSettings: {
    enabled: false,
    roleRewards: [],
    levelUpMessage: 'GG {user}, you leveled up to level {level}!'
  },
  xpData: {},
  autoMod: {
    badWordsEnabled: false,
    badWordsList: [],
    blockLinks: false,
    blockCaps: false
  },
  warnings: {},
  credentials: {
    discordToken: '',
    geminiApiKey: ''
  },
  verificationSettings: {
    enabled: false,
    channelId: '',
    roleId: '',
    embedTitle: '✅ Server Verification',
    embedDescription: 'Click the button below to verify yourself and gain access to the server!',
    embedColor: '#00d26a'
  },
  moderationLogs: [],
  buttonRolePanels: [],
  aiChatSettings: {
    enabled: false,
    channelId: '',
    replyOnMention: true,
    instructions: DEFAULT_BANTAI_PROMPT,
    modelName: 'gemini-2.5-flash',
    provider: 'gemini',
    groqApiKey: ''
  }
};

let dbMemory: DatabaseSchema = defaultDb;
let mongoClient: MongoClient | null = null;
let mongoDb: Db | null = null;

// Initialize Database connection (supports MongoDB Atlas and local fallback)
export async function initDbConnection(): Promise<void> {
  const mongoUri = process.env.MONGO_URI;

  if (mongoUri) {
    try {
      console.log('[DB] Connecting to MongoDB Atlas...');
      mongoClient = new MongoClient(mongoUri);
      await mongoClient.connect();
      mongoDb = mongoClient.db();
      console.log('[DB] Connected to MongoDB successfully.');

      const collection = mongoDb.collection(COLLECTION_NAME);
      const document = await collection.findOne({ id: 'bot_settings' });

      if (document) {
        // Hydrate in-memory database with the document from Mongo
        dbMemory = { ...defaultDb, ...document } as any;
        console.log('[DB] Database settings loaded from MongoDB.');
      } else {
        // Insert default database if it is a fresh cluster
        await collection.insertOne({ id: 'bot_settings', ...defaultDb });
        dbMemory = defaultDb;
        console.log('[DB] Default settings document created in MongoDB.');
      }
    } catch (err: any) {
      console.error('[DB] Failed to connect or query MongoDB. Falling back to local database.json:', err.message);
      loadLocalJsonDb();
    }
  } else {
    console.log('[DB] No MONGO_URI specified in env. Using local database.json.');
    loadLocalJsonDb();
  }
}

function loadLocalJsonDb() {
  try {
    if (!fs.existsSync(DB_PATH)) {
      fs.writeFileSync(DB_PATH, JSON.stringify(defaultDb, null, 2), 'utf-8');
      dbMemory = defaultDb;
    } else {
      const data = fs.readFileSync(DB_PATH, 'utf-8');
      dbMemory = JSON.parse(data) as DatabaseSchema;
    }
  } catch (err) {
    console.error('[DB] Error reading local database.json:', err);
    dbMemory = defaultDb;
  }
}

export function getDb(): DatabaseSchema {
  return dbMemory;
}

export function saveDb(data: DatabaseSchema): void {
  dbMemory = data;

  // Persist asynchronously in background
  if (mongoDb) {
    mongoDb.collection(COLLECTION_NAME).updateOne(
      { id: 'bot_settings' },
      { $set: data },
      { upsert: true }
    ).catch(err => {
      console.error('[DB] Failed to update MongoDB:', err.message);
    });
  } else {
    try {
      fs.writeFileSync(DB_PATH, JSON.stringify(data, null, 2), 'utf-8');
    } catch (err) {
      console.error('[DB] Failed to write local database.json:', err);
    }
  }
}

export function getRandomApiKey(rawKey: string): string {
  if (!rawKey) return '';
  const keys = rawKey.split(',').map(k => k.trim()).filter(k => k.length > 0);
  if (keys.length === 0) return '';
  return keys[Math.floor(Math.random() * keys.length)];
}
