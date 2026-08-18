/**
 * 极简本地持久化存储。
 * 只依赖 Node 内置的 fs 模块，把所有数据存成一个 JSON 文件，
 * 放在 Electron 的 userData 目录下，避免引入额外依赖。
 */
const fs = require('fs');
const path = require('path');

const { DEFAULT_PERSONALITY, DEFAULT_PET_NAME } = require('./personality');

const DEFAULT_CONFIG = {
  petName: DEFAULT_PET_NAME,
  baseUrl: 'https://api.deepseek.com/v1',
  apiKey: '',
  model: 'deepseek-chat',
  personality: DEFAULT_PERSONALITY,
  autoLaunch: false,
  alwaysOnTop: true,
  scale: 1,
  wanderEnabled: true,
  proactiveEnabled: true,
  proactiveUseAi: false,
  soundEnabled: true,
  quietHoursStart: 23,
  quietHoursEnd: 7,
  // 语音播报 (TTS)
  ttsEnabled: true,
  ttsEngine: 'edge', // 'edge' | 'webspeech'
  ttsRate: 1,
  ttsPitch: 0,
  ttsVolume: 1,
  ttsVoice: '',          // Web Speech 用
  ttsEdgeVoice: 'zh-CN-XiaoxiaoNeural', // Edge TTS 用
  // 语音识别 (ASR)
  asrEngine: 'whisper',  // 'whisper' | 'local'
  asrUseCustom: false,
  asrBaseUrl: '',
  asrApiKey: '',
  asrModel: 'whisper-1',
  asrLocalModel: 'small', // tiny / base / small / medium / large
  asrLocalPath: '',       // faster-whisper 可执行路径（可选）
};

const DEFAULT_DATA = {
  version: 1,
  config: { ...DEFAULT_CONFIG },
  memory: {
    affection: 0,
    lastInteraction: 0,
    lastAffectionGainAt: 0,
    affectionGainedInWindow: 0,
    createdAt: Date.now(),
    conversations: [],
    dailySummaries: [],
    lastSummarizedDate: null,
  },
  windowBounds: null,
};

function deepMerge(base, override) {
  if (Array.isArray(base) || Array.isArray(override)) {
    return override === undefined ? base : override;
  }
  if (typeof base === 'object' && base !== null && typeof override === 'object' && override !== null) {
    const result = { ...base };
    for (const key of Object.keys(base)) {
      result[key] = deepMerge(base[key], override[key]);
    }
    return result;
  }
  return override === undefined ? base : override;
}

class Store {
  constructor(filePath) {
    this.filePath = filePath;
    this.data = this._load();
    this._saveTimer = null;
  }

  _load() {
    try {
      if (fs.existsSync(this.filePath)) {
        const raw = fs.readFileSync(this.filePath, 'utf8');
        const parsed = JSON.parse(raw);
        return deepMerge(DEFAULT_DATA, parsed);
      }
    } catch (err) {
      console.error('[store] 读取本地数据失败，使用默认数据：', err);
    }
    return JSON.parse(JSON.stringify(DEFAULT_DATA));
  }

  /** 立即写入磁盘 */
  saveNow() {
    try {
      const dir = path.dirname(this.filePath);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(this.filePath, JSON.stringify(this.data, null, 2), 'utf8');
    } catch (err) {
      console.error('[store] 保存本地数据失败：', err);
    }
  }

  /** 防抖写入，避免频繁 IO（比如窗口拖动时） */
  saveDebounced(delay = 600) {
    if (this._saveTimer) clearTimeout(this._saveTimer);
    this._saveTimer = setTimeout(() => this.saveNow(), delay);
  }

  getConfig() {
    return { ...this.data.config };
  }

  saveConfig(patch) {
    this.data.config = { ...this.data.config, ...patch };
    this.saveNow();
    return this.getConfig();
  }

  getMemory() {
    return this.data.memory;
  }

  getWindowBounds() {
    return this.data.windowBounds;
  }

  saveWindowBounds(bounds) {
    this.data.windowBounds = bounds;
    this.saveDebounced();
  }

  addMessage(role, content) {
    const entry = { role, content, ts: Date.now() };
    this.data.memory.conversations.push(entry);
    // 只保留最近 200 条，防止文件无限增长
    if (this.data.memory.conversations.length > 200) {
      this.data.memory.conversations = this.data.memory.conversations.slice(-200);
    }
    this.data.memory.lastInteraction = Date.now();
    this.saveDebounced(1200);
    return entry;
  }

  getRecentMessages(limit = 20) {
    return this.data.memory.conversations.slice(-limit);
  }

  clearConversation() {
    this.data.memory.conversations = [];
    this.saveNow();
  }

  /**
   * 增加好感度，带有简单的防刷保护：
   * 5 分钟窗口内最多通过“摸摸头”获得 10 点。
   */
  addAffection(delta) {
    const now = Date.now();
    const mem = this.data.memory;
    const windowMs = 5 * 60 * 1000;
    if (now - mem.lastAffectionGainAt > windowMs) {
      mem.affectionGainedInWindow = 0;
      mem.lastAffectionGainAt = now;
    }
    const remaining = Math.max(0, 10 - mem.affectionGainedInWindow);
    const applied = Math.max(0, Math.min(delta, remaining));
    mem.affection = Math.max(0, mem.affection + applied);
    mem.affectionGainedInWindow += applied;
    mem.lastInteraction = now;
    this.saveDebounced();
    return mem.affection;
  }

  getAffection() {
    return this.data.memory.affection;
  }

  resetAffection() {
    this.data.memory.affection = 0;
    this.saveNow();
  }

  markInteraction() {
    this.data.memory.lastInteraction = Date.now();
    this.saveDebounced();
  }

  getLastInteraction() {
    return this.data.memory.lastInteraction || this.data.memory.createdAt;
  }

  addDailySummary(date, summary) {
    this.data.memory.dailySummaries.push({ date, summary });
    if (this.data.memory.dailySummaries.length > 60) {
      this.data.memory.dailySummaries = this.data.memory.dailySummaries.slice(-60);
    }
    this.data.memory.lastSummarizedDate = date;
    this.saveNow();
  }

  getRecentSummaries(limit = 5) {
    return this.data.memory.dailySummaries.slice(-limit);
  }

  getLastSummarizedDate() {
    return this.data.memory.lastSummarizedDate;
  }
}

module.exports = { Store, DEFAULT_CONFIG };
