import React, { useState, useEffect, useRef } from 'react';

// Database Schema Interfaces
interface WelcomeSettings {
  enabled: boolean;
  channelId: string;
  message: string;
  autoRoleId: string;
}

interface LeaveSettings {
  enabled: boolean;
  channelId: string;
  message: string;
}

interface ReactionRole {
  messageId: string;
  emoji: string;
  roleId: string;
}

interface Trigger {
  id: string;
  trigger: string;
  reply: string;
}

interface LevelReward {
  level: number;
  roleId: string;
}

interface LevelingSettings {
  enabled: boolean;
  levelUpMessage: string;
  roleRewards: LevelReward[];
}

interface AutoModSettings {
  badWordsEnabled: boolean;
  badWordsList: string[];
  blockLinks: boolean;
  blockCaps: boolean;
}

interface WarningRecord {
  id: string;
  reason: string;
  timestamp: string;
}

interface DatabaseSchema {
  photoOnlyChannels: string[];
  slowmodeChannels: Record<string, number>;
  welcomeSettings: WelcomeSettings;
  leaveSettings: LeaveSettings;
  reactionRoles: ReactionRole[];
  triggers: Trigger[];
  auditLogChannelId: string;
  levelingSettings: LevelingSettings;
  autoMod: AutoModSettings;
}

interface BotStatus {
  online: boolean;
  tag: string;
  avatar: string | null;
  ping: number;
  guildName: string;
  guildId: string | null;
  settings: DatabaseSchema;
}

interface DiscordChannel {
  id: string;
  name: string;
  type: number;
  slowmode: number;
}

interface DiscordRole {
  id: string;
  name: string;
  color: string;
}

interface LogEntry {
  timestamp: string;
  level: 'info' | 'warn' | 'error';
  message: string;
}

interface GuildMember {
  id: string;
  username: string;
  tag: string;
  avatar: string | null;
  level: number;
  xp: number;
  warnings: WarningRecord[];
  joinedAt: string;
  isAdmin: boolean;
}

interface AISortedChannel {
  id: string;
  name: string;
  type: number;
  isNew: boolean;
}

interface AISortedCategory {
  category: string;
  channels: AISortedChannel[];
}

interface AISortingSuggestion {
  categories: AISortedCategory[];
}

interface PollOption {
  text: string;
  emoji: string;
}

const App: React.FC = () => {
  const API_BASE = import.meta.env.VITE_API_URL || '/api';

  // Authentication State
  const [token, setToken] = useState<string | null>(() => {
    return localStorage.getItem('admin_token');
  });
  const [loginUsername, setLoginUsername] = useState<string>('');
  const [loginPassword, setLoginPassword] = useState<string>('');
  const [loginLoading, setLoginLoading] = useState<boolean>(false);
  const [loginError, setLoginError] = useState<string | null>(null);

  // Theme State (Default: light)
  const [theme, setTheme] = useState<'light' | 'dark'>(() => {
    return (localStorage.getItem('theme') as 'light' | 'dark') || 'light';
  });

  // Navigation State
  const [activeTab, setActiveTab] = useState<'overview' | 'moderation' | 'welcome' | 'levels' | 'automod' | 'triggers' | 'aiHub' | 'broadcaster'>('overview');

  // Server Fetch States
  const [botStatus, setBotStatus] = useState<BotStatus | null>(null);
  const [channels, setChannels] = useState<DiscordChannel[]>([]);
  const [roles, setRoles] = useState<DiscordRole[]>([]);
  const [members, setMembers] = useState<GuildMember[]>([]);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  // Tab 1: Audit Log Target State
  const [auditLogChannelId, setAuditLogChannelId] = useState<string>('');

  // Tab 2: Channels Rule States
  const [photoOnlyChannels, setPhotoOnlyChannels] = useState<string[]>([]);
  const [slowmodeChannels, setSlowmodeChannels] = useState<Record<string, number>>({});
  
  // Tab 3: Welcome & Leave States
  const [welcomeSettings, setWelcomeSettings] = useState<WelcomeSettings>({
    enabled: false,
    channelId: '',
    message: '',
    autoRoleId: ''
  });
  const [leaveSettings, setLeaveSettings] = useState<LeaveSettings>({
    enabled: false,
    channelId: '',
    message: ''
  });
  const [reactionRoles, setReactionRoles] = useState<ReactionRole[]>([]);
  const [newReactMsgId, setNewReactMsgId] = useState<string>('');
  const [newReactEmoji, setNewReactEmoji] = useState<string>('');
  const [newReactRoleId, setNewReactRoleId] = useState<string>('');

  // Tab 4: Levels States
  const [levelingEnabled, setLevelingEnabled] = useState<boolean>(false);
  const [levelUpMessage, setLevelUpMessage] = useState<string>('');
  const [roleRewards, setRoleRewards] = useState<LevelReward[]>([]);
  const [rewardLevel, setRewardLevel] = useState<number>(1);
  const [rewardRoleId, setRewardRoleId] = useState<string>('');
  const [selectedUserWarnings, setSelectedUserWarnings] = useState<{ username: string; id: string; list: WarningRecord[] } | null>(null);

  // Tab 5: AutoMod States
  const [badWordsEnabled, setBadWordsEnabled] = useState<boolean>(false);
  const [badWordsList, setBadWordsList] = useState<string[]>([]);
  const [blockLinks, setBlockLinks] = useState<boolean>(false);
  const [blockCaps, setBlockCaps] = useState<boolean>(false);
  const [newBadWord, setNewBadWord] = useState<string>('');

  // Tab 6: Custom Triggers States
  const [triggers, setTriggers] = useState<Trigger[]>([]);
  const [newTriggerText, setNewTriggerText] = useState<string>('');
  const [newTriggerReply, setNewTriggerReply] = useState<string>('');

  // Tab 7: AI Hub States
  const [aiLoading, setAiLoading] = useState<boolean>(false);
  const [aiSortingSuggestions, setAiSortingSuggestions] = useState<AISortingSuggestion | null>(null);
  const [aiNote, setAiNote] = useState<string | null>(null);
  const [aiBuilding, setAiBuilding] = useState<boolean>(false);
  const [cleanLeftovers, setCleanLeftovers] = useState<boolean>(true);
  const [removeDuplicates, setRemoveDuplicates] = useState<boolean>(true);
  const [createMissing, setCreateMissing] = useState<boolean>(false);

  // Local Moderator's personal Gemini API key (saved locally in browser localStorage)
  const [geminiApiKey, setGeminiApiKey] = useState<string>(() => {
    return localStorage.getItem('gemini_api_key') || '';
  });
  const [showGeminiKey, setShowGeminiKey] = useState<boolean>(false);

  // Tab 8: Broadcaster States
  const [broadcasterChannelId, setBroadcasterChannelId] = useState<string>('');
  const [broadcasterPostType, setBroadcasterPostType] = useState<'text' | 'embed' | 'poll'>('text');
  const [broadcasterTextContent, setBroadcasterTextContent] = useState<string>('');
  const [broadcasterEmbedTitle, setBroadcasterEmbedTitle] = useState<string>('');
  const [broadcasterEmbedColor, setBroadcasterEmbedColor] = useState<string>('#3b82f6');
  const [broadcasterPollQuestion, setBroadcasterPollQuestion] = useState<string>('');
  const [broadcasterPollOptions, setBroadcasterPollOptions] = useState<PollOption[]>([
    { text: '', emoji: '' },
    { text: '', emoji: '' }
  ]);
  const [broadcasterPollDuration, setBroadcasterPollDuration] = useState<number>(24);
  const [broadcasterLoading, setBroadcasterLoading] = useState<boolean>(false);

  // Alert Banner Status
  const [saveStatus, setSaveStatus] = useState<{ type: 'success' | 'error' | null; msg: string | null }>({
    type: null,
    msg: null
  });

  const logsEndRef = useRef<HTMLDivElement>(null);

  // Theme synchronization effect
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem('theme', theme);
  }, [theme]);


  // Initial fetch and poll intervals
  useEffect(() => {
    if (token) {
      initFetch();
      const interval = setInterval(() => {
        pollData();
      }, 4000);
      return () => clearInterval(interval);
    }
  }, [token]);

  useEffect(() => {
    logsEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [logs]);

  // Helper fetchWrapper to handle JWT headers and 401 logouts automatically
  const fetchAuth = async (url: string, options: RequestInit = {}) => {
    const headers = {
      ...(options.headers || {}),
      'Authorization': `Bearer ${token}`
    };
    const res = await fetch(url, { ...options, headers });
    
    if (res.status === 401) {
      handleLogout();
      throw new Error('Session expired. Please log in again.');
    }
    return res;
  };

  const handleLogout = () => {
    setToken(null);
    localStorage.removeItem('admin_token');
  };

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoginLoading(true);
    setLoginError(null);

    try {
      const res = await fetch(`${API_BASE}/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: loginUsername, password: loginPassword })
      });
      const data = await res.json();
      
      if (!res.ok) {
        throw new Error(data.error || 'Login failed');
      }

      setToken(data.token);
      localStorage.setItem('admin_token', data.token);
    } catch (err: any) {
      setLoginError(err.message);
    } finally {
      setLoginLoading(false);
    }
  };

  const initFetch = async () => {
    try {
      setLoading(true);
      setError(null);

      const statusRes = await fetchAuth(`${API_BASE}/status`);
      const statusData: BotStatus = await statusRes.json();
      setBotStatus(statusData);

      // Load Settings into states
      setPhotoOnlyChannels(statusData.settings.photoOnlyChannels || []);
      setSlowmodeChannels(statusData.settings.slowmodeChannels || {});
      setWelcomeSettings(statusData.settings.welcomeSettings || { enabled: false, channelId: '', message: '', autoRoleId: '' });
      setLeaveSettings(statusData.settings.leaveSettings || { enabled: false, channelId: '', message: '' });
      setReactionRoles(statusData.settings.reactionRoles || []);
      setTriggers(statusData.settings.triggers || []);
      setAuditLogChannelId(statusData.settings.auditLogChannelId || '');
      
      setLevelingEnabled(statusData.settings.levelingSettings?.enabled || false);
      setLevelUpMessage(statusData.settings.levelingSettings?.levelUpMessage || 'GG {user}, you leveled up to level {level}!');
      setRoleRewards(statusData.settings.levelingSettings?.roleRewards || []);

      setBadWordsEnabled(statusData.settings.autoMod?.badWordsEnabled || false);
      setBadWordsList(statusData.settings.autoMod?.badWordsList || []);
      setBlockLinks(statusData.settings.autoMod?.blockLinks || false);
      setBlockCaps(statusData.settings.autoMod?.blockCaps || false);

      if (statusData.guildId) {
        const [channelsRes, rolesRes, membersRes, logsRes] = await Promise.all([
          fetchAuth(`${API_BASE}/guild/channels`),
          fetchAuth(`${API_BASE}/guild/roles`),
          fetchAuth(`${API_BASE}/guild/members`),
          fetchAuth(`${API_BASE}/logs`)
        ]);

        if (channelsRes.ok) setChannels(await channelsRes.json());
        if (rolesRes.ok) setRoles(await rolesRes.json());
        if (membersRes.ok) setMembers(await membersRes.json());
        if (logsRes.ok) setLogs(await logsRes.json());
      }
      
      setLoading(false);
    } catch (err: any) {
      console.error(err);
      setError(err.message || 'Unable to connect to backend dashboard.');
      setLoading(false);
    }
  };

  const pollData = async () => {
    try {
      const [statusRes, logsRes, membersRes] = await Promise.all([
        fetchAuth(`${API_BASE}/status`),
        fetchAuth(`${API_BASE}/logs`),
        fetchAuth(`${API_BASE}/guild/members`)
      ]);
      
      if (statusRes.ok) {
        const statusData: BotStatus = await statusRes.json();
        setBotStatus(prev => prev ? { ...prev, online: statusData.online, ping: statusData.ping, guildName: statusData.guildName } : statusData);
      }
      if (logsRes.ok) {
        setLogs(await logsRes.json());
      }
      if (membersRes.ok) {
        setMembers(await membersRes.json());
      }
    } catch (err) {
      console.error('Polling error:', err);
    }
  };

  const handleSave = async (url: string, body: any, successMsg: string) => {
    setSaveStatus({ type: null, msg: null });
    try {
      const res = await fetchAuth(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });
      
      if (!res.ok) {
        const errData = await res.json();
        throw new Error(errData.error || 'Failed to save settings');
      }

      setSaveStatus({ type: 'success', msg: successMsg });
      setTimeout(() => setSaveStatus({ type: null, msg: null }), 3000);
      
      const data = await res.json();
      if (data.settings) {
        setBotStatus(prev => prev ? { ...prev, settings: data.settings } : null);
      }
    } catch (err: any) {
      setSaveStatus({ type: 'error', msg: err.message || 'An error occurred while saving.' });
      setTimeout(() => setSaveStatus({ type: null, msg: null }), 5000);
    }
  };

  // Tab 1: Save Logs Channel
  const saveAuditSettings = () => {
    handleSave(`${API_BASE}/settings/audit-log`, { auditLogChannelId }, 'Audit log channel updated!');
  };

  // Tab 2: Channels Rule & Direct Purge
  const saveModerationSettings = () => {
    handleSave(`${API_BASE}/settings/moderation`, { photoOnlyChannels, slowmodeChannels }, 'Moderation settings synced successfully!');
  };

  const handlePhotoOnlyToggle = (channelId: string) => {
    setPhotoOnlyChannels(prev => 
      prev.includes(channelId) ? prev.filter(id => id !== channelId) : [...prev, channelId]
    );
  };

  const handleSlowmodeChange = (channelId: string, seconds: number) => {
    setSlowmodeChannels(prev => ({ ...prev, [channelId]: seconds }));
  };

  const handleWebPurge = async (channelId: string) => {
    const amountStr = window.prompt('Enter amount of messages to delete (1-100):', '10');
    if (!amountStr) return;
    const amount = parseInt(amountStr);
    if (isNaN(amount) || amount < 1 || amount > 100) {
      alert('Error: Please enter a valid number between 1 and 100');
      return;
    }

    try {
      const res = await fetchAuth(`${API_BASE}/moderation/purge`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ channelId, amount })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);

      setSaveStatus({ type: 'success', msg: data.message });
      setTimeout(() => setSaveStatus({ type: null, msg: null }), 3000);
      pollData();
    } catch (err: any) {
      alert(`Purge failed: ${err.message}`);
    }
  };

  // AI Rename channel action
  const handleWebAIRename = async (channelId: string, currentName: string) => {
    const prompt = window.prompt(`Enter a topic or purpose for #${currentName} (e.g. "for sharing trading charts" or "rules guidelines"):`);
    if (!prompt) return;

    try {
      const res = await fetchAuth(`${API_BASE}/ai/rename-channel`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          channelId, 
          prompt,
          geminiApiKey 
        })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);

      setSaveStatus({ type: 'success', msg: data.message });
      setTimeout(() => setSaveStatus({ type: null, msg: null }), 3000);

      // Reload channels immediately
      const channelsRes = await fetchAuth(`${API_BASE}/guild/channels`);
      if (channelsRes.ok) setChannels(await channelsRes.json());
    } catch (err: any) {
      alert(`AI Rename failed: ${err.message}`);
    }
  };

  // Tab 3: Welcome & Leave setup
  const saveWelcomeSettings = () => {
    handleSave(`${API_BASE}/settings/welcome`, welcomeSettings, 'Welcome configurations updated!');
  };

  const saveLeaveSettings = () => {
    handleSave(`${API_BASE}/settings/leave`, leaveSettings, 'Goodbye message configurations updated!');
  };

  const addReactionRole = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newReactMsgId || !newReactEmoji || !newReactRoleId) return;
    const updated = [...reactionRoles, { messageId: newReactMsgId, emoji: newReactEmoji, roleId: newReactRoleId }];
    setReactionRoles(updated);
    setNewReactMsgId('');
    setNewReactEmoji('');
    setNewReactRoleId('');
    handleSave(`${API_BASE}/settings/reaction-roles`, { reactionRoles: updated }, 'New reaction role registered!');
  };

  const deleteReactionRole = (index: number) => {
    const updated = reactionRoles.filter((_, i) => i !== index);
    setReactionRoles(updated);
    handleSave(`${API_BASE}/settings/reaction-roles`, { reactionRoles: updated }, 'Reaction role removed.');
  };

  // Tab 4: Levels & Web Moderation Actions
  const saveLevelingSettings = () => {
    handleSave(`${API_BASE}/settings/leveling`, { enabled: levelingEnabled, levelUpMessage, roleRewards }, 'Leveling settings updated!');
  };

  const addLevelReward = (e: React.FormEvent) => {
    e.preventDefault();
    if (!rewardRoleId) return;
    const updated = [...roleRewards, { level: rewardLevel, roleId: rewardRoleId }];
    setRoleRewards(updated);
    setRewardLevel(1);
    setRewardRoleId('');
    handleSave(`${API_BASE}/settings/leveling`, { enabled: levelingEnabled, levelUpMessage, roleRewards: updated }, 'Level role reward added!');
  };

  const deleteLevelReward = (index: number) => {
    const updated = roleRewards.filter((_, i) => i !== index);
    setRoleRewards(updated);
    handleSave(`${API_BASE}/settings/leveling`, { enabled: levelingEnabled, levelUpMessage, roleRewards: updated }, 'Level role reward deleted.');
  };

  const handleWebWarn = async (userId: string, username: string) => {
    const reason = window.prompt(`Enter warning reason for @${username}:`, 'Rules Violation');
    if (!reason) return;

    try {
      const res = await fetchAuth(`${API_BASE}/moderation/warn`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId, reason })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);

      setSaveStatus({ type: 'success', msg: `Warned @${username}` });
      setTimeout(() => setSaveStatus({ type: null, msg: null }), 3000);
      pollData();
    } catch (err: any) {
      alert(`Warn failed: ${err.message}`);
    }
  };

  const handleWebKick = async (userId: string, username: string) => {
    const confirm = window.confirm('Are you sure you want to KICK @' + username + '?');
    if (!confirm) return;
    const reason = window.prompt('Reason for kick:', 'Kicked via Dashboard');

    try {
      const res = await fetchAuth(`${API_BASE}/moderation/kick`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId, reason })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);

      setSaveStatus({ type: 'success', msg: `Kicked @${username}!` });
      setTimeout(() => setSaveStatus({ type: null, msg: null }), 3000);
      pollData();
    } catch (err: any) {
      alert(`Kick failed: ${err.message}`);
    }
  };

  const handleWebBan = async (userId: string, username: string) => {
    const confirm = window.confirm('🔥 DANGER: Are you sure you want to BAN @' + username + '?');
    if (!confirm) return;
    const reason = window.prompt('Reason for ban:', 'Banned via Dashboard');

    try {
      const res = await fetchAuth(`${API_BASE}/moderation/ban`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId, reason })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);

      setSaveStatus({ type: 'success', msg: `Banned @${username}!` });
      setTimeout(() => setSaveStatus({ type: null, msg: null }), 3000);
      pollData();
    } catch (err: any) {
      alert(`Ban failed: ${err.message}`);
    }
  };

  const handleClearWarnings = async (userId: string) => {
    try {
      const res = await fetchAuth(`${API_BASE}/moderation/clearwarns`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId })
      });
      if (!res.ok) throw new Error('Failed to clear warnings');

      setSelectedUserWarnings(null);
      setSaveStatus({ type: 'success', msg: 'Warnings cleared!' });
      setTimeout(() => setSaveStatus({ type: null, msg: null }), 3000);
      pollData();
    } catch (err: any) {
      alert(err.message);
    }
  };

  // Tab 5: Auto-Moderation
  const handleAddBadWord = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newBadWord.trim()) return;
    const word = newBadWord.trim().toLowerCase();
    if (badWordsList.includes(word)) return;

    const updated = [...badWordsList, word];
    setBadWordsList(updated);
    setNewBadWord('');
    handleSave(`${API_BASE}/settings/automod`, { badWordsEnabled, badWordsList: updated, blockLinks, blockCaps }, 'Bad word added!');
  };

  const handleRemoveBadWord = (word: string) => {
    const updated = badWordsList.filter(w => w !== word);
    setBadWordsList(updated);
    handleSave(`${API_BASE}/settings/automod`, { badWordsEnabled, badWordsList: updated, blockLinks, blockCaps }, 'Bad word removed!');
  };

  const saveAutoModConfigs = () => {
    handleSave(
      `${API_BASE}/settings/automod`,
      { badWordsEnabled, badWordsList, blockLinks, blockCaps },
      'Auto-moderator settings saved successfully!'
    );
  };

  // Tab 6: Custom Triggers
  const addTrigger = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newTriggerText || !newTriggerReply) return;
    const updated = [...triggers, { id: Math.random().toString(36).substr(2, 9), trigger: newTriggerText.trim(), reply: newTriggerReply.trim() }];
    setTriggers(updated);
    setNewTriggerText('');
    setNewTriggerReply('');
    handleSave(`${API_BASE}/settings/triggers`, { triggers: updated }, 'Auto-responder added!');
  };

  const deleteTrigger = (id: string) => {
    const updated = triggers.filter(t => t.id !== id);
    setTriggers(updated);
    handleSave(`${API_BASE}/settings/triggers`, { triggers: updated }, 'Auto-responder removed.');
  };

  // Tab 7: AI Hub Actions (Sorting & Organizing)
  const handleAISuggestSorting = async () => {
    setAiLoading(true);
    setAiNote(null);
    setAiSortingSuggestions(null);

    try {
      const res = await fetchAuth(`${API_BASE}/ai/suggest-sorting`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ geminiApiKey })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to analyze sorting');

      setAiSortingSuggestions(data.suggestion);
      if (data.note) {
        setAiNote(data.note);
      }
    } catch (err: any) {
      alert(`AI Sorting suggestion failed: ${err.message}`);
    } finally {
      setAiLoading(false);
    }
  };

  const handleAIApplySorting = async () => {
    if (!aiSortingSuggestions) return;
    const confirm = window.confirm('Apply AI organization structure? Existing channels will be moved, and recommended new ones will be created if enabled.');
    if (!confirm) return;
    setAiBuilding(true);

    try {
      const res = await fetchAuth(`${API_BASE}/ai/apply-sorting`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          suggestion: aiSortingSuggestions,
          cleanLeftovers,
          removeDuplicates,
          createMissing
        })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);

      setSaveStatus({ type: 'success', msg: data.message });
      setTimeout(() => setSaveStatus({ type: null, msg: null }), 3000);
      setAiSortingSuggestions(null);
      initFetch(); // Reload channels layout
    } catch (err: any) {
      alert(`AI Apply Sorting error: ${err.message}`);
    } finally {
      setAiBuilding(false);
    }
  };

  // Tab 8: Server Broadcaster Submission
  const handleBroadcast = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!broadcasterChannelId) {
      alert('Please select a target channel.');
      return;
    }
    setBroadcasterLoading(true);

    const filteredOptions = broadcasterPollOptions.filter(opt => opt.text.trim() !== '');

    if (broadcasterPostType === 'poll' && filteredOptions.length < 2) {
      alert('Please provide at least 2 non-empty poll options.');
      setBroadcasterLoading(false);
      return;
    }

    try {
      const res = await fetchAuth(`${API_BASE}/broadcaster/post`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          channelId: broadcasterChannelId,
          postType: broadcasterPostType,
          textContent: broadcasterTextContent,
          embedTitle: broadcasterEmbedTitle,
          embedColor: broadcasterEmbedColor,
          pollQuestion: broadcasterPollQuestion,
          pollOptions: filteredOptions,
          pollDuration: broadcasterPollDuration
        })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to post message');

      setSaveStatus({ type: 'success', msg: data.message });
      setTimeout(() => setSaveStatus({ type: null, msg: null }), 3000);
      
      // Reset form states
      setBroadcasterTextContent('');
      setBroadcasterEmbedTitle('');
      setBroadcasterPollQuestion('');
      setBroadcasterPollOptions([
        { text: '', emoji: '' },
        { text: '', emoji: '' }
      ]);
    } catch (err: any) {
      alert(err.message);
    } finally {
      setBroadcasterLoading(false);
    }
  };

  // Local storage save for personal gemini API key
  const handleSaveGeminiKey = (val: string) => {
    setGeminiApiKey(val);
    localStorage.setItem('gemini_api_key', val);
  };

  const slowmodeLabel = (sec: number) => {
    if (sec === 0) return 'Off';
    if (sec < 60) return `${sec}s`;
    const min = Math.floor(sec / 60);
    const rem = sec % 60;
    return rem === 0 ? `${min}m` : `${min}m ${rem}s`;
  };

  // AUTHENTICATION LOGIN PORTAL RENDER
  if (!token) {
    return (
      <div style={{
        display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100vh',
        background: 'var(--bg-color)', transition: 'background-color var(--transition-normal)'
      }}>
        {/* Theme Switcher in Login Screen */}
        <button 
          className="btn btn-secondary" 
          onClick={() => setTheme(theme === 'light' ? 'dark' : 'light')}
          style={{ position: 'absolute', top: '20px', right: '20px', padding: '6px 12px', fontSize: '0.85rem' }}
        >
          {theme === 'light' ? '🌙 Dark Mode' : '☀️ Light Mode'}
        </button>

        <div className="glass-panel" style={{ width: '400px', padding: '2.5rem', textAlign: 'center' }}>
          <div style={{ fontSize: '3.5rem', marginBottom: '10px', filter: 'drop-shadow(0 4px 10px rgba(37,99,235,0.2))' }}>🛡️</div>
          <h2 style={{ fontSize: '1.45rem', fontWeight: 800, whiteSpace: 'nowrap', marginBottom: '5px' }}>Fx Conquerors Security</h2>
          <p style={{ color: 'var(--text-secondary)', fontSize: '0.9rem', marginBottom: '2rem' }}>Only server administrators can log in.</p>

          <form onSubmit={handleLogin} style={{ textAlign: 'left' }}>
            {loginError && (
              <div style={{
                background: 'var(--accent-red-bg)', color: 'var(--accent-red)',
                border: '1px solid rgba(239, 68, 68, 0.2)', padding: '10px',
                borderRadius: '8px', marginBottom: '1.5rem', fontSize: '0.85rem', fontWeight: 600
              }}>
                ❌ {loginError}
              </div>
            )}

            <div className="form-group">
              <label>Admin Username</label>
              <input 
                type="text" 
                className="form-input" 
                required 
                placeholder="Enter username..." 
                value={loginUsername} 
                onChange={(e) => setLoginUsername(e.target.value)} 
              />
            </div>

            <div className="form-group" style={{ marginBottom: '2rem' }}>
              <label>Password</label>
              <input 
                type="password" 
                className="form-input" 
                required 
                placeholder="Enter password..." 
                value={loginPassword} 
                onChange={(e) => setLoginPassword(e.target.value)} 
              />
            </div>

            <button type="submit" className="btn" style={{ width: '100%', justifyContent: 'center', padding: '12px' }} disabled={loginLoading}>
              {loginLoading ? '🔑 Logging in...' : '🔓 Access Settings'}
            </button>
          </form>
        </div>
      </div>
    );
  }

  if (loading) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100vh', flexDirection: 'column', gap: '20px' }}>
        <div style={{ fontSize: '3rem', animation: 'spin 1.5s infinite linear' }}>🔄</div>
        <p style={{ color: 'var(--text-secondary)', fontFamily: 'var(--font-family)', fontWeight: 600 }}>Loading server dashboard...</p>
      </div>
    );
  }

  if (error || !botStatus) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100vh', flexDirection: 'column', gap: '20px', padding: '20px', textAlign: 'center' }}>
        <div style={{ fontSize: '4rem' }}>⚠️</div>
        <h2 style={{ color: 'var(--accent-red)' }}>Backend Connection Failed</h2>
        <p style={{ color: 'var(--text-secondary)', maxWidth: '500px' }}>{error || 'Could not fetch dashboard configuration.'}</p>
        <button className="btn btn-secondary" onClick={initFetch}>Retry Connection</button>
        <button className="btn btn-secondary" onClick={handleLogout} style={{ marginTop: '5px' }}>Log Out</button>
      </div>
    );
  }

  return (
    <div className="dashboard-layout">
      {/* Toast Save Notifications */}
      {saveStatus.msg && (
        <div style={{
          position: 'fixed', top: '20px', right: '20px', zIndex: 1000,
          background: saveStatus.type === 'success' ? 'var(--accent-green-bg)' : 'var(--accent-red-bg)',
          color: saveStatus.type === 'success' ? 'var(--accent-green)' : 'var(--accent-red)',
          border: `1px solid ${saveStatus.type === 'success' ? 'var(--accent-green)' : 'var(--accent-red)'}`,
          padding: '12px 24px', fontWeight: 600, fontSize: '0.9rem', borderRadius: '8px',
          boxShadow: '0 10px 15px -3px rgba(0, 0, 0, 0.1), 0 4px 6px -2px rgba(0, 0, 0, 0.05)',
          display: 'flex', alignItems: 'center', gap: '8px'
        }}>
          {saveStatus.type === 'success' ? '✅' : '❌'} {saveStatus.msg}
        </div>
      )}

      {/* Left Sidebar Navigation */}
      <aside className="sidebar">
        <div>
          <div className="sidebar-logo">
            <span style={{ fontSize: '2rem' }}>🛡️</span>
            <div>
              <h2 style={{ fontSize: '1.15rem', fontWeight: 800, whiteSpace: 'nowrap', margin: 0 }}>Fx Conquerors</h2>
              <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', fontWeight: 600, display: 'block', marginTop: '2px' }}>Server Manager</span>
            </div>
          </div>

          <nav className="sidebar-nav">
            <button className={`sidebar-btn ${activeTab === 'overview' ? 'active' : ''}`} onClick={() => setActiveTab('overview')}>
              🖥️ <span>Overview</span>
            </button>
            <button className={`sidebar-btn ${activeTab === 'moderation' ? 'active' : ''}`} onClick={() => setActiveTab('moderation')}>
              ⚖️ <span>Channels & Rules</span>
            </button>
            <button className={`sidebar-btn ${activeTab === 'welcome' ? 'active' : ''}`} onClick={() => setActiveTab('welcome')}>
              👋 <span>Welcome & Goodbye</span>
            </button>
            <button className={`sidebar-btn ${activeTab === 'levels' ? 'active' : ''}`} onClick={() => setActiveTab('levels')}>
              🏆 <span>Levels & Members</span>
            </button>
            <button className={`sidebar-btn ${activeTab === 'automod' ? 'active' : ''}`} onClick={() => setActiveTab('automod')}>
              🤖 <span>Auto-Moderation</span>
            </button>
            <button className={`sidebar-btn ${activeTab === 'triggers' ? 'active' : ''}`} onClick={() => setActiveTab('triggers')}>
              💬 <span>Custom Triggers</span>
            </button>
            <button className={`sidebar-btn ${activeTab === 'aiHub' ? 'active' : ''}`} onClick={() => setActiveTab('aiHub')}>
              ✨ <span>AI Server Organizer</span>
            </button>
            <button className={`sidebar-btn ${activeTab === 'broadcaster' ? 'active' : ''}`} onClick={() => setActiveTab('broadcaster')}>
              📢 <span>Server Broadcaster</span>
            </button>
          </nav>
        </div>

        {/* Sidebar Footer Controls */}
        <div className="sidebar-footer">
          <div className="status-badge" style={{ width: '100%', marginBottom: '10px', justifyContent: 'center' }}>
            <span className={`status-dot ${botStatus.online ? 'online' : 'offline'}`}></span>
            {botStatus.online ? 'Bot Online' : 'Bot Offline'}
          </div>

          <button 
            className="btn btn-secondary" 
            onClick={() => setTheme(theme === 'light' ? 'dark' : 'light')}
            style={{ width: '100%', justifyContent: 'center', marginBottom: '8px', fontSize: '0.85rem', fontWeight: 600 }}
          >
            {theme === 'light' ? '🌙 Dark Mode' : '☀️ Light Mode'}
          </button>

          <button 
            className="btn btn-secondary btn-danger" 
            onClick={handleLogout}
            style={{ width: '100%', justifyContent: 'center', fontSize: '0.85rem', fontWeight: 600 }}
          >
            🚪 Logout
          </button>
        </div>
      </aside>

      {/* Right Content Area */}
      <main className="main-content">
        {/* Top Header bar */}
        <header className="main-header">
          <div className="guild-info-bar">
            <span style={{ fontSize: '1.6rem' }}>🏠</span>
            <div>
              <h2>{botStatus.guildName}</h2>
              <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', margin: 0 }}>Connected Discord Server</p>
            </div>
          </div>

          <div style={{ display: 'flex', gap: '10px' }}>
            <div className="status-badge">
              📶 Latency: <span style={{ color: 'var(--accent-cyan)', marginLeft: '4px' }}>{botStatus.ping} ms</span>
            </div>
          </div>
        </header>

        {/* Warning Modal for warning lists detail */}
        {selectedUserWarnings && (
          <div style={{
            position: 'fixed', top: 0, left: 0, width: '100vw', height: '100vh',
            background: 'rgba(0,0,0,0.5)', backdropFilter: 'blur(4px)', display: 'flex',
            justifyContent: 'center', alignItems: 'center', zIndex: 1000
          }}>
            <div className="glass-panel" style={{ width: '500px', maxWidth: '90%' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid var(--panel-border)', paddingBottom: '10px', marginBottom: '15px' }}>
                <h3 style={{ margin: 0 }}>⚠️ Warnings History for @{selectedUserWarnings.username}</h3>
                <button className="btn btn-secondary" style={{ padding: '2px 8px' }} onClick={() => setSelectedUserWarnings(null)}>×</button>
              </div>

              <div style={{ maxHeight: '250px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '8px', marginBottom: '20px' }}>
                {selectedUserWarnings.list.length === 0 ? (
                  <p style={{ color: 'var(--text-muted)', textAlign: 'center', padding: '20px' }}>No warnings on record.</p>
                ) : (
                  selectedUserWarnings.list.map(warn => (
                    <div key={warn.id} style={{ background: 'rgba(0,0,0,0.02)', border: '1px solid var(--panel-border)', padding: '10px', borderRadius: '6px' }}>
                      <div style={{ fontWeight: 600, fontSize: '0.9rem' }}>{warn.reason}</div>
                      <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>Date: {warn.timestamp}</div>
                    </div>
                  ))
                )}
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px' }}>
                <button className="btn btn-secondary" onClick={() => setSelectedUserWarnings(null)}>Close</button>
                <button className="btn btn-danger" disabled={selectedUserWarnings.list.length === 0} onClick={() => handleClearWarnings(selectedUserWarnings.id)}>🧹 Clear All Warnings</button>
              </div>
            </div>
          </div>
        )}

        {/* Selected Tab Content */}
        <div>
          {/* TAB CONTENT: Overview */}
          {activeTab === 'overview' && (
            <div>
              <div className="grid-3">
                <div className="glass-panel stat-card">
                  <div className="stat-icon">📈</div>
                  <div className="stat-info">
                    <h3>Connected Server</h3>
                    <p>{botStatus.guildName}</p>
                  </div>
                </div>

                <div className="glass-panel stat-card">
                  <div className="stat-icon">🏷️</div>
                  <div className="stat-info">
                    <h3>Bot Username</h3>
                    <p>{botStatus.tag}</p>
                  </div>
                </div>

                <div className="glass-panel stat-card">
                  <div className="stat-icon">📁</div>
                  <div className="stat-info">
                    <h3>Configured Channels</h3>
                    <p>{photoOnlyChannels.length} Photo / {Object.keys(slowmodeChannels).filter(id => slowmodeChannels[id] > 0).length} Slow</p>
                  </div>
                </div>
              </div>

              <div className="grid-2">
                <div className="glass-panel">
                  <h2 style={{ marginBottom: '1rem', borderBottom: '1px solid var(--panel-border)', paddingBottom: '8px' }}>🤖 Moderation Logs</h2>
                  <p style={{ color: 'var(--text-secondary)', fontSize: '0.9rem', marginBottom: '1.5rem' }}>
                    Set up an audit log channel in your Discord. The bot will automatically output deleted messages, edited messages, and member status shifts inside this channel.
                  </p>

                  <div className="form-group">
                    <label>Audit Log Target Channel</label>
                    <select className="form-select" value={auditLogChannelId} onChange={(e) => setAuditLogChannelId(e.target.value)}>
                      <option value="">-- Deactivated (No Logging) --</option>
                      {channels.filter(ch => ch.type !== 2).map(ch => (
                        <option key={ch.id} value={ch.id}>#{ch.name}</option>
                      ))}
                    </select>
                  </div>

                  <button className="btn" onClick={saveAuditSettings}>Save Logs Config</button>
                </div>

                <div className="glass-panel" style={{ display: 'flex', flexDirection: 'column' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem', borderBottom: '1px solid var(--panel-border)', paddingBottom: '8px' }}>
                    <h2>💻 Live Activity Monitor</h2>
                    <button className="btn btn-secondary" style={{ padding: '4px 10px', fontSize: '0.8rem' }} onClick={() => setLogs([])}>Clear Screen</button>
                  </div>
                  <div className="logs-box">
                    {logs.length === 0 ? (
                      <div className="empty-state">
                        <span className="empty-state-icon">📡</span>
                        Waiting for events... Try writing in Discord server!
                      </div>
                    ) : (
                      logs.map((log, idx) => (
                        <div key={idx} className={`log-line ${log.level}`}>
                          <span className="log-time">[{log.timestamp}]</span>
                          <span className="log-content">{log.message}</span>
                        </div>
                      ))
                    )}
                    <div ref={logsEndRef} />
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* TAB CONTENT: Moderation */}
          {activeTab === 'moderation' && (
            <div className="glass-panel">
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem', borderBottom: '1px solid var(--panel-border)', paddingBottom: '10px' }}>
                <div>
                  <h2>⚖️ Channels Moderation Rules</h2>
                  <p style={{ color: 'var(--text-secondary)', fontSize: '0.9rem' }}>Configure slowmode intervals and block general text messaging inside specific media-only channels.</p>
                </div>
                <button className="btn" onClick={saveModerationSettings}>Save Moderation Settings</button>
              </div>

              <div className="table-container">
                <table className="custom-table">
                  <thead>
                    <tr>
                      <th>Channel Name</th>
                      <th>📸 Photo-Only Mode</th>
                      <th>⏱️ Native Slowmode Duration</th>
                      <th style={{ textAlign: 'right' }}>🧙‍♂️ Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {channels.length === 0 ? (
                      <tr>
                        <td colSpan={4} style={{ textAlign: 'center', padding: '30px', color: 'var(--text-muted)' }}>No channels found.</td>
                      </tr>
                    ) : (
                      channels.map(ch => {
                        const isPhotoOnly = photoOnlyChannels.includes(ch.id);
                        const slowTime = slowmodeChannels[ch.id] !== undefined ? slowmodeChannels[ch.id] : ch.slowmode;
                        
                        return (
                          <tr key={ch.id}>
                            <td style={{ fontWeight: 600, color: 'var(--text-primary)' }}>
                              {ch.type === 2 ? `🔊 ${ch.name}` : `# ${ch.name}`}
                            </td>
                            {ch.type === 2 ? (
                              <td colSpan={2} style={{ color: 'var(--text-muted)', fontSize: '0.85rem', fontStyle: 'italic', paddingLeft: '24px' }}>
                                Voice Channel (Moderation settings not applicable)
                              </td>
                            ) : (
                              <>
                                <td>
                                  <label className="switch">
                                    <input type="checkbox" checked={isPhotoOnly} onChange={() => handlePhotoOnlyToggle(ch.id)} />
                                    <span className="slider"></span>
                                  </label>
                                </td>
                                <td>
                                  <div className="range-container">
                                    <input type="range" className="range-input" min="0" max="600" step="5" value={slowTime} onChange={(e) => handleSlowmodeChange(ch.id, parseInt(e.target.value))} />
                                    <span className="range-value">{slowmodeLabel(slowTime)}</span>
                                  </div>
                                </td>
                              </>
                            )}
                            <td style={{ textAlign: 'right' }}>
                              <div style={{ display: 'inline-flex', gap: '8px' }}>
                                <button className="btn btn-secondary" style={{ padding: '6px 12px', fontSize: '0.8rem', border: '1px solid rgba(6,182,212,0.3)', color: 'var(--accent-cyan)' }} onClick={() => handleWebAIRename(ch.id, ch.name)}>✨ AI Rename</button>
                                {ch.type !== 2 && (
                                  <button className="btn btn-secondary" style={{ padding: '6px 12px', fontSize: '0.8rem' }} onClick={() => handleWebPurge(ch.id)}>🧹 Purge Chat</button>
                                )}
                              </div>
                            </td>
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* TAB CONTENT: Welcome & Goodbye */}
          {activeTab === 'welcome' && (
            <div className="grid-2">
              <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
                <div className="glass-panel">
                  <h2 style={{ marginBottom: '1rem', borderBottom: '1px solid var(--panel-border)', paddingBottom: '8px' }}>👋 Welcome Greetings Settings</h2>
                  
                  <div className="form-group">
                    <div className="toggle-wrapper">
                      <div className="toggle-label-desc">
                        <h4>Enable Welcome Messages</h4>
                        <p>Send a message when a new member joins.</p>
                      </div>
                      <label className="switch">
                        <input type="checkbox" checked={welcomeSettings.enabled} onChange={(e) => setWelcomeSettings({ ...welcomeSettings, enabled: e.target.checked })} />
                        <span className="slider"></span>
                      </label>
                    </div>
                  </div>

                  <div className="form-group">
                    <label>Welcome Channel Target</label>
                    <select className="form-select" disabled={!welcomeSettings.enabled} value={welcomeSettings.channelId} onChange={(e) => setWelcomeSettings({ ...welcomeSettings, channelId: e.target.value })}>
                      <option value="">-- Select Channel --</option>
                      {channels.filter(ch => ch.type !== 2).map(ch => (
                        <option key={ch.id} value={ch.id}>#{ch.name}</option>
                      ))}
                    </select>
                  </div>

                  <div className="form-group">
                    <label>Welcome Message Template</label>
                    <textarea className="form-textarea" disabled={!welcomeSettings.enabled} value={welcomeSettings.message} onChange={(e) => setWelcomeSettings({ ...welcomeSettings, message: e.target.value })} placeholder="Welcome to the server, {user}!" />
                    <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>Use <b>{`{user}`}</b> to mention the member.</span>
                  </div>

                  <div className="form-group">
                    <label>Automatic Role on Join (Auto-role)</label>
                    <select className="form-select" value={welcomeSettings.autoRoleId} onChange={(e) => setWelcomeSettings({ ...welcomeSettings, autoRoleId: e.target.value })}>
                      <option value="">-- No Auto-Role --</option>
                      {roles.map(role => (
                        <option key={role.id} value={role.id}>{role.name}</option>
                      ))}
                    </select>
                  </div>

                  <button className="btn" onClick={saveWelcomeSettings}>Save Welcome settings</button>
                </div>

                <div className="glass-panel">
                  <h2 style={{ marginBottom: '1rem', borderBottom: '1px solid var(--panel-border)', paddingBottom: '8px' }}>🚪 Goodbye/Leave Message Settings</h2>
                  
                  <div className="form-group">
                    <div className="toggle-wrapper">
                      <div className="toggle-label-desc">
                        <h4>Enable Goodbye Messages</h4>
                        <p>Send a message when a member leaves the server.</p>
                      </div>
                      <label className="switch">
                        <input type="checkbox" checked={leaveSettings.enabled} onChange={(e) => setLeaveSettings({ ...leaveSettings, enabled: e.target.checked })} />
                        <span className="slider"></span>
                      </label>
                    </div>
                  </div>

                  <div className="form-group">
                    <label>Goodbye Channel Target</label>
                    <select className="form-select" disabled={!leaveSettings.enabled} value={leaveSettings.channelId} onChange={(e) => setLeaveSettings({ ...leaveSettings, channelId: e.target.value })}>
                      <option value="">-- Select Channel --</option>
                      {channels.filter(ch => ch.type !== 2).map(ch => (
                        <option key={ch.id} value={ch.id}>#{ch.name}</option>
                      ))}
                    </select>
                  </div>

                  <div className="form-group">
                    <label>Goodbye Message Template</label>
                    <textarea className="form-textarea" disabled={!leaveSettings.enabled} value={leaveSettings.message} onChange={(e) => setLeaveSettings({ ...leaveSettings, message: e.target.value })} placeholder="Goodbye {user}, we will miss you!" />
                    <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>Use <b>{`{user}`}</b> to output the username.</span>
                  </div>

                  <button className="btn" onClick={saveLeaveSettings}>Save Goodbye settings</button>
                </div>
              </div>

              <div className="glass-panel" style={{ height: 'fit-content' }}>
                <h2 style={{ marginBottom: '1rem', borderBottom: '1px solid var(--panel-border)', paddingBottom: '8px' }}>🎭 Reaction Roles Registry</h2>
                <p style={{ color: 'var(--text-secondary)', fontSize: '0.85rem', marginBottom: '1.5rem' }}>Assign roles automatically when members react to messages.</p>

                <form onSubmit={addReactionRole} style={{ background: 'rgba(0,0,0,0.02)', padding: '15px', borderRadius: '8px', border: '1px solid var(--panel-border)', marginBottom: '1.5rem' }}>
                  <h4 style={{ marginBottom: '10px', fontSize: '0.9rem' }}>Add New Reaction Role</h4>
                  <div className="form-group" style={{ marginBottom: '10px' }}>
                    <input type="text" className="form-input" required placeholder="Message ID" value={newReactMsgId} onChange={(e) => setNewReactMsgId(e.target.value)} />
                  </div>
                  <div className="grid-2" style={{ gap: '10px', marginBottom: '10px' }}>
                    <input type="text" className="form-input" required placeholder="Emoji (e.g. 👍)" value={newReactEmoji} onChange={(e) => setNewReactEmoji(e.target.value)} />
                    <select className="form-select" required value={newReactRoleId} onChange={(e) => setNewReactRoleId(e.target.value)}>
                      <option value="">-- Choose Role --</option>
                      {roles.map(role => (
                        <option key={role.id} value={role.id}>{role.name}</option>
                      ))}
                    </select>
                  </div>
                  <button type="submit" className="btn" style={{ width: '100%', justifyContent: 'center' }}>+ Add Reaction Role</button>
                </form>

                <div className="table-container">
                  <table className="custom-table" style={{ fontSize: '0.85rem' }}>
                    <thead>
                      <tr>
                        <th>Message ID</th>
                        <th>Emoji</th>
                        <th>Grant Role</th>
                        <th>Action</th>
                      </tr>
                    </thead>
                    <tbody>
                      {reactionRoles.length === 0 ? (
                        <tr>
                          <td colSpan={4} style={{ textAlign: 'center', color: 'var(--text-muted)' }}>No reaction roles configured.</td>
                        </tr>
                      ) : (
                        reactionRoles.map((rr, idx) => {
                          const roleName = roles.find(r => r.id === rr.roleId)?.name || rr.roleId;
                          return (
                            <tr key={idx}>
                              <td style={{ fontFamily: 'var(--font-mono)' }}>{rr.messageId.substring(0, 10)}...</td>
                              <td style={{ fontSize: '1.1rem' }}>{rr.emoji}</td>
                              <td><span className="pill cyan">{roleName}</span></td>
                              <td>
                                <button className="btn btn-danger" style={{ padding: '4px 8px', fontSize: '0.75rem' }} onClick={() => deleteReactionRole(idx)}>🗑️</button>
                              </td>
                            </tr>
                          );
                        })
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}

          {/* TAB CONTENT: Levels & Leaderboard */}
          {activeTab === 'levels' && (
            <div className="grid-2" style={{ gridTemplateColumns: '1fr 2fr' }}>
              <div className="glass-panel" style={{ height: 'fit-content' }}>
                <h2 style={{ marginBottom: '1rem', borderBottom: '1px solid var(--panel-border)', paddingBottom: '8px' }}>🏆 Levels Config</h2>
                
                <div className="form-group">
                  <div className="toggle-wrapper">
                    <div className="toggle-label-desc">
                      <h4>Enable Leveling System</h4>
                      <p>Grant members XP for texting in chat.</p>
                    </div>
                    <label className="switch">
                      <input type="checkbox" checked={levelingEnabled} onChange={(e) => setLevelingEnabled(e.target.checked)} />
                      <span className="slider"></span>
                    </label>
                  </div>
                </div>

                <div className="form-group">
                  <label>Level Up Announcement Template</label>
                  <textarea className="form-textarea" disabled={!levelingEnabled} value={levelUpMessage} onChange={(e) => setLevelUpMessage(e.target.value)} />
                  <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>Use <b>{`{user}`}</b> and <b>{`{level}`}</b>.</span>
                </div>

                <button className="btn" style={{ marginBottom: '20px' }} onClick={saveLevelingSettings}>Save Level Configurations</button>

                <form onSubmit={addLevelReward} style={{ borderTop: '1px solid var(--panel-border)', paddingTop: '15px' }}>
                  <h4 style={{ marginBottom: '10px', fontSize: '0.9rem' }}>🏆 Level Up Role Rewards</h4>
                  <div className="grid-2" style={{ gap: '10px', marginBottom: '10px' }}>
                    <div>
                      <label style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>Target Level</label>
                      <input type="number" className="form-input" min="1" required value={rewardLevel} onChange={(e) => setRewardLevel(parseInt(e.target.value))} />
                    </div>
                    <div>
                      <label style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>Role Reward</label>
                      <select className="form-select" required value={rewardRoleId} onChange={(e) => setRewardRoleId(e.target.value)}>
                        <option value="">-- Choose Role --</option>
                        {roles.map(role => (
                          <option key={role.id} value={role.id}>{role.name}</option>
                        ))}
                      </select>
                    </div>
                  </div>
                  <button type="submit" className="btn" style={{ width: '100%', justifyContent: 'center' }} disabled={!levelingEnabled}>+ Add Level Reward</button>
                </form>

                <div className="table-container">
                  <table className="custom-table" style={{ fontSize: '0.8rem' }}>
                    <thead>
                      <tr>
                        <th>Level</th>
                        <th>Role Granted</th>
                        <th>Action</th>
                      </tr>
                    </thead>
                    <tbody>
                      {roleRewards.length === 0 ? (
                        <tr>
                          <td colSpan={3} style={{ textAlign: 'center', color: 'var(--text-muted)' }}>No role rewards mapped.</td>
                        </tr>
                      ) : (
                        roleRewards.map((rr, idx) => {
                          const roleName = roles.find(r => r.id === rr.roleId)?.name || rr.roleId;
                          return (
                            <tr key={idx}>
                              <td style={{ fontWeight: 'bold' }}>Level {rr.level}</td>
                              <td><span className="pill green">{roleName}</span></td>
                              <td>
                                <button className="btn btn-danger" style={{ padding: '3px 6px', fontSize: '0.75rem' }} onClick={() => deleteLevelReward(idx)}>🗑️</button>
                              </td>
                            </tr>
                          );
                        })
                      )}
                    </tbody>
                  </table>
                </div>
              </div>

              <div className="glass-panel">
                <h2 style={{ marginBottom: '1rem', borderBottom: '1px solid var(--panel-border)', paddingBottom: '8px' }}>👥 Server Members & XP Leaderboard</h2>
                
                <div className="table-container">
                  <table className="custom-table">
                    <thead>
                      <tr>
                        <th style={{ width: '8%' }}>Rank</th>
                        <th>Member Details</th>
                        <th>Level</th>
                        <th>Total XP</th>
                        <th>Warnings</th>
                        <th style={{ textAlign: 'right' }}>Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {members.length === 0 ? (
                        <tr>
                          <td colSpan={6} style={{ textAlign: 'center', padding: '30px', color: 'var(--text-muted)' }}>No members cached.</td>
                        </tr>
                      ) : (
                        members.map((m, idx) => {
                          const medal = idx === 0 ? '🥇' : idx === 1 ? '🥈' : idx === 2 ? '🥉' : '#' + (idx + 1);
                          return (
                            <tr key={m.id}>
                              <td style={{ fontWeight: 700, fontSize: '1rem', color: idx < 3 ? 'inherit' : 'var(--text-muted)' }}>{medal}</td>
                              <td>
                                <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                                  <img src={m.avatar || 'data:image/svg+xml,<svg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 100 100%22><rect width=%22100%22 height=%22100%22 fill=%22%232c3e50%22/><text y=%22.65em%22 x=%2250%22 font-size=%2250%22 text-anchor=%22middle%22 fill=%22white%22>👤</text></svg>'} style={{ width: '32px', height: '32px', borderRadius: '50%', objectFit: 'cover' }} alt="avatar" />
                                  <div>
                                    <div style={{ fontWeight: 600 }}>{m.username}</div>
                                    <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>Joined: {m.joinedAt}</div>
                                  </div>
                                </div>
                              </td>
                              <td style={{ fontFamily: 'var(--font-mono)', fontWeight: 600 }}>{m.level}</td>
                              <td style={{ fontFamily: 'var(--font-mono)', color: 'var(--accent-cyan)' }}>{m.xp}</td>
                              <td>
                                <span 
                                  className={`pill ${m.warnings.length > 0 ? 'red' : 'green'}`}
                                  style={{ cursor: 'pointer' }}
                                  onClick={() => setSelectedUserWarnings({ username: m.username, id: m.id, list: m.warnings })}
                                >
                                  ⚠️ {m.warnings.length} Warns
                                </span>
                              </td>
                              <td style={{ textAlign: 'right' }}>
                                <div style={{ display: 'inline-flex', gap: '5px' }}>
                                  <button className="btn btn-secondary" style={{ padding: '4px 8px', fontSize: '0.75rem', border: '1px solid rgba(255,179,0,0.3)', color: 'var(--accent-yellow)' }} onClick={() => handleWebWarn(m.id, m.username)}>⚠️ Warn</button>
                                  <button className="btn btn-secondary" disabled={m.isAdmin} style={{ padding: '4px 8px', fontSize: '0.75rem', border: '1px solid rgba(255,61,0,0.2)', color: 'var(--accent-red)' }} onClick={() => handleWebKick(m.id, m.username)}>Kick</button>
                                  <button className="btn btn-danger" disabled={m.isAdmin} style={{ padding: '4px 8px', fontSize: '0.75rem' }} onClick={() => handleWebBan(m.id, m.username)}>Ban</button>
                                </div>
                              </td>
                            </tr>
                          );
                        })
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}

          {/* TAB CONTENT: Auto-Moderation */}
          {activeTab === 'automod' && (
            <div className="glass-panel">
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem', borderBottom: '1px solid var(--panel-border)', paddingBottom: '10px' }}>
                <div>
                  <h2>🤖 Auto-Moderation Configuration</h2>
                  <p style={{ color: 'var(--text-secondary)', fontSize: '0.9rem' }}>Enable automated message filters to protect your server from link-spam, keyboard mashes, and bad words.</p>
                </div>
                <button className="btn" onClick={saveAutoModConfigs}>Save Automod Settings</button>
              </div>

              <div className="grid-2">
                <div style={{ display: 'flex', flexDirection: 'column', gap: '15px' }}>
                  <div className="toggle-wrapper">
                    <div className="toggle-label-desc">
                      <h4>🔗 Block Invitation / External Links</h4>
                      <p>Deletes messages containing links (e.g. https://, discord.gg).</p>
                    </div>
                    <label className="switch">
                      <input type="checkbox" checked={blockLinks} onChange={(e) => setBlockLinks(e.target.checked)} />
                      <span className="slider"></span>
                    </label>
                  </div>

                  <div className="toggle-wrapper">
                    <div className="toggle-label-desc">
                      <h4>🔠 Caps Spam Blocker</h4>
                      <p>Deletes messages that have more than 70% capital letters.</p>
                    </div>
                    <label className="switch">
                      <input type="checkbox" checked={blockCaps} onChange={(e) => setBlockCaps(e.target.checked)} />
                      <span className="slider"></span>
                    </label>
                  </div>

                  <div className="toggle-wrapper">
                    <div className="toggle-label-desc">
                      <h4>🤬 Block Blacklisted Bad Words</h4>
                      <p>Enable automated word checking and deleting.</p>
                    </div>
                    <label className="switch">
                      <input type="checkbox" checked={badWordsEnabled} onChange={(e) => setBadWordsEnabled(e.target.checked)} />
                      <span className="slider"></span>
                    </label>
                  </div>
                </div>

                <div style={{ background: 'rgba(0,0,0,0.02)', padding: '20px', borderRadius: '8px', border: '1px solid var(--panel-border)' }}>
                  <h3>🤬 Bad Words Blacklist Manager</h3>
                  <p style={{ color: 'var(--text-secondary)', fontSize: '0.8rem', marginBottom: '15px' }}>Type phrases or words that should trigger auto-deletion. Press Enter or click + Add to insert.</p>

                  <form onSubmit={handleAddBadWord} style={{ display: 'flex', gap: '10px', marginBottom: '1.5rem' }}>
                    <input 
                      type="text" 
                      className="form-input" 
                      disabled={!badWordsEnabled}
                      placeholder="Type badword here..." 
                      value={newBadWord} 
                      onChange={(e) => setNewBadWord(e.target.value)} 
                    />
                    <button type="submit" className="btn" disabled={!badWordsEnabled}>+ Add</button>
                  </form>

                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', maxHeight: '180px', overflowY: 'auto' }}>
                    {badWordsList.length === 0 ? (
                      <span style={{ color: 'var(--text-muted)', fontSize: '0.9rem' }}>No bad words currently filtered.</span>
                    ) : (
                      badWordsList.map(word => (
                        <span 
                          key={word} 
                          className="pill red" 
                          style={{ cursor: 'pointer', padding: '6px 12px', fontSize: '0.85rem' }} 
                          onClick={() => badWordsEnabled && handleRemoveBadWord(word)}
                        >
                          {word} {badWordsEnabled ? ' ×' : ''}
                        </span>
                      ))
                    )}
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* TAB CONTENT: Custom Triggers */}
          {activeTab === 'triggers' && (
            <div className="glass-panel">
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem', borderBottom: '1px solid var(--panel-border)', paddingBottom: '10px' }}>
                <div>
                  <h2>💬 Custom Trigger Auto-Responders</h2>
                  <p style={{ color: 'var(--text-secondary)', fontSize: '0.9rem' }}>Configure words that prompt the bot to automatically reply with specific content.</p>
                </div>
              </div>

              <div className="grid-2" style={{ gridTemplateColumns: '1fr 2fr' }}>
                <form onSubmit={addTrigger} style={{ background: 'rgba(0, 0, 0, 0.02)', padding: '20px', borderRadius: '8px', border: '1px solid var(--panel-border)', height: 'fit-content' }}>
                  <h3 style={{ marginBottom: '15px' }}>Create New Auto-Responder</h3>
                  <div className="form-group">
                    <label>Trigger Command / Keyword</label>
                    <input type="text" className="form-input" required placeholder="e.g. !rules" value={newTriggerText} onChange={(e) => setNewTriggerText(e.target.value)} />
                  </div>
                  <div className="form-group">
                    <label>Auto Reply Message</label>
                    <textarea className="form-textarea" required placeholder="Welcome to our server! Rules: 1. No ads..." value={newTriggerReply} onChange={(e) => setNewTriggerReply(e.target.value)} />
                  </div>
                  <button type="submit" className="btn" style={{ width: '100%', justifyContent: 'center' }}>+ Create Trigger</button>
                </form>

                <div>
                  <div className="table-container" style={{ marginTop: 0 }}>
                    <table className="custom-table">
                      <thead>
                        <tr>
                          <th style={{ width: '30%' }}>Keyword Trigger</th>
                          <th>Bot Auto Reply</th>
                          <th style={{ width: '10%' }}>Action</th>
                        </tr>
                      </thead>
                      <tbody>
                        {triggers.length === 0 ? (
                          <tr>
                            <td colSpan={3} style={{ textAlign: 'center', padding: '30px', color: 'var(--text-muted)' }}>No custom triggers created.</td>
                          </tr>
                        ) : (
                          triggers.map(t => (
                            <tr key={t.id}>
                              <td><span className="pill green">{t.trigger}</span></td>
                              <td style={{ color: 'var(--text-secondary)', whiteSpace: 'pre-wrap', fontSize: '0.9rem' }}>{t.reply}</td>
                              <td>
                                <button className="btn btn-danger" style={{ padding: '6px 10px' }} onClick={() => deleteTrigger(t.id)}>🗑️</button>
                              </td>
                            </tr>
                          ))
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* TAB CONTENT: AI Server Organizer */}
          {activeTab === 'aiHub' && (
            <div className="glass-panel">
              <div style={{ marginBottom: '1.5rem', borderBottom: '1px solid var(--panel-border)', paddingBottom: '12px' }}>
                <h2>🤖 AI Server Organizer & Channel Sorter</h2>
                <p style={{ color: 'var(--text-secondary)', fontSize: '0.95rem', lineHeight: '1.5', marginBottom: '1rem' }}>
                  Is your Discord server messy with text and voice channels scattered everywhere? 
                  AI will look at all your existing channels, design logical category groups, and organize your channel list perfectly.
                </p>

                {/* MODERATOR'S PERSONAL GEMINI KEY CONFIG (Stored only in local browser) */}
                <div style={{
                  background: 'rgba(37, 99, 235, 0.05)', border: '1px solid rgba(37, 99, 235, 0.15)',
                  padding: '16px 20px', borderRadius: '8px', maxWidth: '600px', marginBottom: '1.5rem'
                }}>
                  <h4 style={{ margin: '0 0 5px 0', fontSize: '0.925rem', display: 'flex', alignItems: 'center', gap: '6px' }}>
                    🔑 Gemini API Key Configuration
                  </h4>
                  <p style={{ margin: '0 0 12px 0', fontSize: '0.785rem', color: 'var(--text-secondary)' }}>
                    AI features (jaise automatic channel suggestions aur renames) ko utilize karne ke liye yahan apni personal Gemini API Key paste karein. Yeh key aapke browser me locally save rahegi.
                  </p>
                  
                  <div style={{ display: 'flex', gap: '8px' }}>
                    <input 
                      type={showGeminiKey ? "text" : "password"} 
                      className="form-input" 
                      style={{ padding: '8px 12px', fontSize: '0.875rem' }}
                      placeholder={geminiApiKey ? "●●●●●●●● (Personal Key Saved)" : "Paste your personal Gemini API Key..."} 
                      value={geminiApiKey}
                      onChange={(e) => handleSaveGeminiKey(e.target.value)}
                    />
                    <button 
                      type="button" 
                      className="btn btn-secondary" 
                      style={{ padding: '8px 12px' }}
                      onClick={() => setShowGeminiKey(!showGeminiKey)}
                    >
                      {showGeminiKey ? "👁️" : "🙈"}
                    </button>
                    {geminiApiKey && (
                      <button 
                        type="button" 
                        className="btn btn-danger" 
                        style={{ padding: '8px 12px' }}
                        onClick={() => handleSaveGeminiKey('')}
                      >
                        Clear
                      </button>
                    )}
                  </div>
                </div>
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: '20px', alignItems: 'center', justifyContent: 'center', minHeight: '300px' }}>
                {!aiLoading && !aiSortingSuggestions && (
                  <div style={{ textAlign: 'center', padding: '20px' }}>
                    <div style={{ fontSize: '4.5rem', marginBottom: '20px' }}>📁✨</div>
                    <h3 style={{ marginBottom: '10px' }}>Organize Server Instantly</h3>
                    <p style={{ color: 'var(--text-secondary)', marginBottom: '30px', maxWidth: '500px' }}>
                      Analyze existing channels, re-arrange them neatly, and choose whether to generate missing recommended channels.
                    </p>
                    <button className="btn" style={{ padding: '14px 28px', fontSize: '1.05rem' }} onClick={handleAISuggestSorting}>
                      🔍 Analyze & Suggest Layout
                    </button>
                  </div>
                )}

                {aiLoading && (
                  <div style={{ textAlign: 'center', padding: '50px' }}>
                    <div style={{ fontSize: '3.5rem', animation: 'spin 1.2s infinite linear' }}>✨</div>
                    <h3 style={{ marginTop: '20px' }}>AI is organizing your channel lists...</h3>
                    <p style={{ color: 'var(--text-secondary)', fontSize: '0.9rem' }}>Analyzing channels. This takes a few seconds.</p>
                  </div>
                )}

                {!aiLoading && aiSortingSuggestions && (
                  <div style={{ width: '100%' }}>
                    {aiNote && (
                      <div style={{
                        background: 'var(--accent-yellow-bg)', color: 'var(--accent-yellow)',
                        border: '1px solid rgba(217, 119, 6, 0.2)', padding: '10px 15px',
                        borderRadius: '8px', marginBottom: '1.5rem', fontSize: '0.85rem', fontWeight: 600
                      }}>
                        ⚠️ {aiNote}
                      </div>
                    )}

                    <h3 style={{ marginBottom: '20px', borderBottom: '1px solid var(--panel-border)', paddingBottom: '10px' }}>
                      📋 Proposed Sorted Channel Layout
                    </h3>

                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: '20px', marginBottom: '2rem' }}>
                      {aiSortingSuggestions.categories.map((group, idx) => (
                        <div key={idx} style={{
                          background: 'var(--bg-color)', border: '1px solid var(--panel-border)',
                          padding: '20px', borderRadius: '8px', boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.05)'
                        }}>
                          <h4 style={{ color: 'var(--text-primary)', marginBottom: '12px', display: 'flex', alignItems: 'center', gap: '8px', fontWeight: 700 }}>
                            📁 {group.category}
                          </h4>
                          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                            {group.channels.map(chObj => {
                              const isNew = chObj.isNew;
                              return (
                                <div key={chObj.id} style={{
                                  background: isNew ? 'rgba(16, 185, 129, 0.08)' : 'var(--panel-bg)',
                                  border: isNew ? '1px dashed var(--accent-green)' : '1px solid var(--panel-border)',
                                  padding: '8px 12px', borderRadius: '6px', fontSize: '0.9rem', 
                                  color: isNew ? 'var(--accent-green)' : 'var(--text-secondary)',
                                  fontWeight: 600, display: 'flex', justifyContent: 'space-between', alignItems: 'center'
                                }}>
                                  <span>
                                    {chObj.type === 2 ? `🔊 ${chObj.name}` : `# ${chObj.name}`}
                                  </span>
                                  {isNew && (
                                    <span className="pill green" style={{ fontSize: '0.65rem', padding: '2px 6px', textTransform: 'uppercase' }}>
                                      Recommended New
                                    </span>
                                  )}
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      ))}
                    </div>

                    {/* AI Configuration cleaning controls */}
                    <div style={{
                      display: 'flex', flexDirection: 'column', gap: '10px', background: 'var(--panel-bg)',
                      border: '1px solid var(--panel-border)', padding: '16px 20px', borderRadius: '8px',
                      marginBottom: '20px', width: 'fit-content'
                    }}>
                      <div style={{ display: 'flex', alignItems: 'center' }}>
                        <label className="switch" style={{ width: '40px', height: '22px' }}>
                          <input type="checkbox" checked={cleanLeftovers} onChange={(e) => setCleanLeftovers(e.target.checked)} />
                          <span className="slider"></span>
                        </label>
                        <span style={{ fontSize: '0.875rem', fontWeight: 600, marginLeft: '12px', color: 'var(--text-primary)' }}>
                          🧹 Delete empty leftover categories after sorting (Keep server clean)
                        </span>
                      </div>

                      <div style={{ display: 'flex', alignItems: 'center' }}>
                        <label className="switch" style={{ width: '40px', height: '22px' }}>
                          <input type="checkbox" checked={removeDuplicates} onChange={(e) => setRemoveDuplicates(e.target.checked)} />
                          <span className="slider"></span>
                        </label>
                        <span style={{ fontSize: '0.875rem', fontWeight: 600, marginLeft: '12px', color: 'var(--text-primary)' }}>
                          🗑️ Scan & delete duplicate channels (Keep oldest version)
                        </span>
                      </div>

                      <div style={{ display: 'flex', alignItems: 'center' }}>
                        <label className="switch" style={{ width: '40px', height: '22px' }}>
                          <input type="checkbox" checked={createMissing} onChange={(e) => setCreateMissing(e.target.checked)} />
                          <span className="slider"></span>
                        </label>
                        <span style={{ fontSize: '0.875rem', fontWeight: 600, marginLeft: '12px', color: 'var(--text-primary)' }}>
                          💡 Create recommended new channels suggested by AI (Generator)
                        </span>
                      </div>
                    </div>

                    <div style={{ display: 'flex', gap: '12px' }}>
                      <button className="btn" onClick={handleAIApplySorting} disabled={aiBuilding}>
                        {aiBuilding ? '🔨 Sorting server...' : '🔨 Apply AI Re-organization'}
                      </button>
                      <button className="btn btn-secondary" onClick={() => setAiSortingSuggestions(null)}>
                        Cancel
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* TAB CONTENT: Server Broadcaster */}
          {activeTab === 'broadcaster' && (
            <div className="glass-panel">
              <div style={{ marginBottom: '1.5rem', borderBottom: '1px solid var(--panel-border)', paddingBottom: '10px' }}>
                <h2>📢 Universal Server Broadcaster</h2>
                <p style={{ color: 'var(--text-secondary)', fontSize: '0.9rem' }}>
                  Compose and post messages, announcements, links, rich embeds, or native interactive polls directly to any channel in Fx Conquerors.
                </p>
              </div>

              <form onSubmit={handleBroadcast}>
                <div className="grid-2" style={{ gridTemplateColumns: '1fr 2fr', gap: '30px' }}>
                  
                  {/* Left Column: Target and Type Selection */}
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
                    <div className="form-group">
                      <label style={{ fontWeight: 700 }}>1. Target Destination Channel</label>
                      <select 
                        className="form-select" 
                        required 
                        value={broadcasterChannelId} 
                        onChange={(e) => setBroadcasterChannelId(e.target.value)}
                      >
                        <option value="">-- Select Text Channel --</option>
                        {channels.filter(ch => ch.type !== 2).map(ch => (
                          <option key={ch.id} value={ch.id}>#{ch.name}</option>
                        ))}
                      </select>
                    </div>

                    <div className="form-group">
                      <label style={{ fontWeight: 700, marginBottom: '10px', display: 'block' }}>2. Select Post Format Type</label>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                        <button 
                          type="button" 
                          className={`btn ${broadcasterPostType === 'text' ? '' : 'btn-secondary'}`}
                          style={{ justifyContent: 'flex-start', padding: '12px' }}
                          onClick={() => setBroadcasterPostType('text')}
                        >
                          💬 Text / Links Markdown
                        </button>
                        <button 
                          type="button" 
                          className={`btn ${broadcasterPostType === 'embed' ? '' : 'btn-secondary'}`}
                          style={{ justifyContent: 'flex-start', padding: '12px' }}
                          onClick={() => setBroadcasterPostType('embed')}
                        >
                          🎨 Rich Fancy Embed
                        </button>
                        <button 
                          type="button" 
                          className={`btn ${broadcasterPostType === 'poll' ? '' : 'btn-secondary'}`}
                          style={{ justifyContent: 'flex-start', padding: '12px' }}
                          onClick={() => setBroadcasterPostType('poll')}
                        >
                          📊 Interactive Poll
                        </button>
                      </div>
                    </div>
                  </div>

                  {/* Right Column: Form Inputs based on Selection */}
                  <div style={{ background: 'rgba(0, 0, 0, 0.01)', border: '1px solid var(--panel-border)', padding: '24px', borderRadius: '12px' }}>
                    
                    {/* TEXT TYPE */}
                    {broadcasterPostType === 'text' && (
                      <div>
                        <h3 style={{ marginBottom: '15px' }}>💬 Post Text Message / Links</h3>
                        <div className="form-group">
                          <label>Message Content</label>
                          <textarea 
                            className="form-textarea" 
                            style={{ minHeight: '150px' }} 
                            required 
                            placeholder="Type whatever you want to broadcast (supports emojis, links, markdown e.g. **bold**)..."
                            value={broadcasterTextContent} 
                            onChange={(e) => setBroadcasterTextContent(e.target.value)} 
                          />
                        </div>
                      </div>
                    )}

                    {/* EMBED TYPE */}
                    {broadcasterPostType === 'embed' && (
                      <div>
                        <h3 style={{ marginBottom: '15px' }}>🎨 Build Rich Embed</h3>
                        <div className="form-group">
                          <label>Embed Title (Optional)</label>
                          <input 
                            type="text" 
                            className="form-input" 
                            placeholder="e.g. 📢 Important Update!" 
                            value={broadcasterEmbedTitle} 
                            onChange={(e) => setBroadcasterEmbedTitle(e.target.value)} 
                          />
                        </div>
                        <div className="form-group">
                          <label>Embed Description / Message Content</label>
                          <textarea 
                            className="form-textarea" 
                            style={{ minHeight: '120px' }} 
                            required 
                            placeholder="Type the main embed text body here..."
                            value={broadcasterTextContent} 
                            onChange={(e) => setBroadcasterTextContent(e.target.value)} 
                          />
                        </div>
                        <div className="form-group">
                          <label style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                            Embed Accent Color:
                            <input 
                              type="color" 
                              style={{ border: 'none', background: 'none', cursor: 'pointer', width: '35px', height: '35px' }} 
                              value={broadcasterEmbedColor} 
                              onChange={(e) => setBroadcasterEmbedColor(e.target.value)} 
                            />
                          </label>
                        </div>
                      </div>
                    )}

                    {/* POLL TYPE */}
                    {broadcasterPostType === 'poll' && (
                      <div>
                        <h3 style={{ marginBottom: '15px' }}>📊 Create Native Interactive Poll</h3>
                        <div className="form-group">
                          <label>Poll Question / Topic</label>
                          <input 
                            type="text" 
                            className="form-input" 
                            required 
                            placeholder="e.g. Should we do a live trading stream today?" 
                            value={broadcasterPollQuestion} 
                            onChange={(e) => setBroadcasterPollQuestion(e.target.value)} 
                          />
                        </div>

                        <div className="form-group">
                          <label style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                            <span>Answers / Options</span>
                            <button 
                              type="button" 
                              className="btn btn-secondary" 
                              style={{ padding: '4px 10px', fontSize: '0.8rem' }}
                              disabled={broadcasterPollOptions.length >= 10}
                              onClick={() => setBroadcasterPollOptions([...broadcasterPollOptions, { text: '', emoji: '' }])}
                            >
                              + Add Option
                            </button>
                          </label>

                          <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', marginTop: '10px' }}>
                            {broadcasterPollOptions.map((opt, idx) => (
                              <div key={idx} style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                                <input 
                                  type="text" 
                                  style={{ width: '60px', textAlign: 'center' }} 
                                  className="form-input" 
                                  placeholder="Emoji" 
                                  value={opt.emoji} 
                                  onChange={(e) => {
                                    const updated = [...broadcasterPollOptions];
                                    updated[idx].emoji = e.target.value;
                                    setBroadcasterPollOptions(updated);
                                  }} 
                                />
                                <input 
                                  type="text" 
                                  className="form-input" 
                                  required={idx < 2} 
                                  placeholder={`Option ${idx + 1} text...`} 
                                  value={opt.text} 
                                  onChange={(e) => {
                                    const updated = [...broadcasterPollOptions];
                                    updated[idx].text = e.target.value;
                                    setBroadcasterPollOptions(updated);
                                  }} 
                                />
                                {broadcasterPollOptions.length > 2 && (
                                  <button 
                                    type="button" 
                                    className="btn btn-danger" 
                                    style={{ padding: '8px 12px' }}
                                    onClick={() => setBroadcasterPollOptions(broadcasterPollOptions.filter((_, i) => i !== idx))}
                                  >
                                    🗑️
                                  </button>
                                )}
                              </div>
                            ))}
                          </div>
                        </div>

                        <div className="form-group">
                          <label>Poll Active Duration</label>
                          <select 
                            className="form-select" 
                            value={broadcasterPollDuration} 
                            onChange={(e) => setBroadcasterPollDuration(parseInt(e.target.value))}
                          >
                            <option value={1}>1 Hour</option>
                            <option value={4}>4 Hours</option>
                            <option value={8}>8 Hours</option>
                            <option value={24}>24 Hours (1 Day)</option>
                            <option value={72}>72 Hours (3 Days)</option>
                            <option value={168}>168 Hours (1 Week)</option>
                          </select>
                        </div>
                      </div>
                    )}

                    <button 
                      type="submit" 
                      className="btn" 
                      style={{ width: '100%', justifyContent: 'center', padding: '14px', marginTop: '20px', fontSize: '1rem', fontWeight: 700 }}
                      disabled={broadcasterLoading}
                    >
                      {broadcasterLoading ? '🚀 Posting Message...' : '🚀 Send Broadcast Post'}
                    </button>
                  </div>
                </div>
              </form>
            </div>
          )}
        </div>
      </main>
    </div>
  );
};

export default App;
