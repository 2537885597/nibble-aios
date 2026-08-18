const { app, BrowserWindow, Tray, Menu, screen, ipcMain, nativeImage, session } = require('electron');
const path = require('path');

const { Store } = require('./src/common/store');
const { chatCompletion } = require('./src/common/llm');
const { transcribeAudio } = require('./src/common/asr');
const edgeTts = require('./src/common/edgeTts');
const { buildSystemPrompt, getAffectionTier, DEFAULT_PET_NAME } = require('./src/common/personality');
const {
  getPetReactionLine,
  getProactiveLine,
  getTimePeriod,
  isWithinQuietHours,
  getFallbackReply,
  WELCOME_LINES,
  pick,
} = require('./src/common/idleLines');

const BASE_WIDTH = 260;
const BASE_HEIGHT = 360;
const WALK_CYCLE_MS = 620; // 需与 pet.css 中 .state-walking 的动画周期保持一致
const WANDER_MIN_DELAY = 35 * 1000;
const WANDER_MAX_DELAY = 95 * 1000;
const IDLE_ANIM_MIN_DELAY = 12 * 1000;
const IDLE_ANIM_MAX_DELAY = 38 * 1000;
const PROACTIVE_CHECK_INTERVAL = 30 * 1000;
const PROACTIVE_IDLE_THRESHOLD = 2 * 60 * 1000; // 静置 2 分钟就允许开口搭话
const PROACTIVE_COOLDOWN = 4 * 60 * 1000; // 两次搭话之间至少间隔 4 分钟

app.setAppUserModelId('com.deskmate.nibble');

/** @type {Store} */
let store = null;
let petWindow = null;
let chatWindow = null;
let settingsWindow = null;
let tray = null;

let wanderTimer = null;
let walkEndTimer = null;
let proactiveTimer = null;
let lastProactiveAt = 0;
let idleAnimTimer = null;
let currentPetState = 'idle';
let currentPetFacing = 'right';
let petBubbleVisible = false;
let isDragging = false;
let cachedIcon = null;
let isQuitting = false;

// ---------------------------------------------------------------------------
// 工具函数
// ---------------------------------------------------------------------------

function getIconImage() {
  if (cachedIcon) return cachedIcon;
  try {
    cachedIcon = nativeImage.createFromPath(path.join(__dirname, 'assets', 'icon.png'));
  } catch (err) {
    cachedIcon = nativeImage.createEmpty();
  }
  return cachedIcon;
}

function getScaledSize(scale) {
  const safeScale = Math.min(2.0, Math.max(0.2, scale || 1));
  return {
    width: Math.round(BASE_WIDTH * safeScale),
    height: Math.round(BASE_HEIGHT * safeScale),
  };
}

function clampToWorkArea(x, y, width, height, display) {
  const wa = display.workArea;
  const maxX = wa.x + Math.max(wa.width - width, 0);
  const maxY = wa.y + Math.max(wa.height - height, 0);
  return {
    x: Math.round(Math.min(Math.max(x, wa.x), maxX)),
    y: Math.round(Math.min(Math.max(y, wa.y), maxY)),
  };
}

function todayKey(date = new Date()) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

/** 开发辅助：把渲染进程的 console.warn/console.error 转发到主进程终端，方便排查问题。 */
function attachRendererLogging(win, label) {
  win.webContents.on('console-message', (event) => {
    const { level, message, line, sourceId } = event;
    if (level < 2) return; // 只打印 warning(2) 和 error(3)
    const fileName = sourceId ? sourceId.split(/[\\/]/).pop() : '';
    console.log(`[renderer:${label}] ${message} (${fileName}:${line})`);
  });
  win.webContents.on('render-process-gone', (event, details) => {
    console.error(`[renderer:${label}] 渲染进程异常退出`, details);
  });
}

// ---------------------------------------------------------------------------
// 窗口创建
// ---------------------------------------------------------------------------

function createPetWindow() {
  const config = store.getConfig();
  const { width, height } = getScaledSize(config.scale);
  const primary = screen.getPrimaryDisplay();
  const wa = primary.workArea;

  let x = wa.x + wa.width - width - 40;
  let y = wa.y + wa.height - height - 20;
  const saved = store.getWindowBounds();
  if (saved && typeof saved.x === 'number' && typeof saved.y === 'number') {
    x = saved.x;
    y = saved.y;
  }
  const nearest = screen.getDisplayNearestPoint({ x, y });
  const clamped = clampToWorkArea(x, y, width, height, nearest);

  petWindow = new BrowserWindow({
    width,
    height,
    x: clamped.x,
    y: clamped.y,
    transparent: true,
    frame: false,
    alwaysOnTop: config.alwaysOnTop !== false,
    resizable: false,
    movable: false,
    skipTaskbar: true,
    hasShadow: false,
    icon: getIconImage(),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: false,
      autoplayPolicy: 'no-user-gesture-required',
    },
  });

  try {
    petWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  } catch (err) {
    // 部分平台不支持，忽略即可
  }

  petWindow.loadFile(path.join(__dirname, 'src', 'renderer', 'pet', 'index.html'));

  petWindow.on('moved', () => {
    if (!petWindow) return;
    const bounds = petWindow.getBounds();
    store.saveWindowBounds({ x: bounds.x, y: bounds.y });
  });

  petWindow.on('closed', () => {
    petWindow = null;
  });

  attachRendererLogging(petWindow, 'pet');
}

function createChatWindow() {
  if (chatWindow) {
    chatWindow.show();
    chatWindow.focus();
    return;
  }
  const width = 360;
  const height = 520;
  const petBounds = petWindow ? petWindow.getBounds() : null;
  const display = petBounds
    ? screen.getDisplayNearestPoint({ x: petBounds.x, y: petBounds.y })
    : screen.getPrimaryDisplay();
  const wa = display.workArea;

  let x = petBounds ? petBounds.x - width - 16 : wa.x + wa.width - width - 40;
  let y = petBounds ? Math.max(wa.y + 10, petBounds.y + petBounds.height - height) : wa.y + 60;
  if (x < wa.x) {
    x = petBounds ? petBounds.x + petBounds.width + 16 : wa.x + 40;
  }
  const clamped = clampToWorkArea(x, y, width, height, display);

  chatWindow = new BrowserWindow({
    width,
    height,
    x: clamped.x,
    y: clamped.y,
    minWidth: 300,
    minHeight: 400,
    title: `和 ${store.getConfig().petName || DEFAULT_PET_NAME} 聊天`,
    alwaysOnTop: true,
    icon: getIconImage(),
    backgroundColor: '#fff8ef',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      autoplayPolicy: 'no-user-gesture-required',
    },
  });
  chatWindow.setMenuBarVisibility(false);
  chatWindow.loadFile(path.join(__dirname, 'src', 'renderer', 'chat', 'index.html'));
  chatWindow.on('closed', () => {
    chatWindow = null;
  });
  attachRendererLogging(chatWindow, 'chat');
}

function createSettingsWindow() {
  if (settingsWindow) {
    settingsWindow.show();
    settingsWindow.focus();
    return;
  }
  settingsWindow = new BrowserWindow({
    width: 540,
    height: 720,
    minWidth: 460,
    minHeight: 560,
    title: `设置 - ${store.getConfig().petName || DEFAULT_PET_NAME}`,
    icon: getIconImage(),
    backgroundColor: '#fbf7f0',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  settingsWindow.setMenuBarVisibility(false);
  settingsWindow.loadFile(path.join(__dirname, 'src', 'renderer', 'settings', 'index.html'));
  settingsWindow.on('closed', () => {
    settingsWindow = null;
  });
  attachRendererLogging(settingsWindow, 'settings');
}

function resetPetPosition() {
  if (!petWindow) return;
  const config = store.getConfig();
  const { width, height } = getScaledSize(config.scale);
  const display = screen.getPrimaryDisplay();
  const wa = display.workArea;
  const x = wa.x + wa.width - width - 40;
  const y = wa.y + wa.height - height - 20;
  petWindow.setBounds({ x, y, width, height });
  store.saveWindowBounds({ x, y });
}

function resizePetWindow(scale) {
  if (!petWindow) return;
  const { width, height } = getScaledSize(scale);
  const bounds = petWindow.getBounds();
  const display = screen.getDisplayNearestPoint({ x: bounds.x, y: bounds.y });
  const newX = Math.round(bounds.x + (bounds.width - width) / 2);
  const newY = Math.round(bounds.y + (bounds.height - height));
  const clamped = clampToWorkArea(newX, newY, width, height, display);
  petWindow.setBounds({ x: clamped.x, y: clamped.y, width, height });
  store.saveWindowBounds({ x: clamped.x, y: clamped.y });
}

// ---------------------------------------------------------------------------
// 托盘 & 右键菜单
// ---------------------------------------------------------------------------

function buildMenuTemplate({ includeToggleVisible }) {
  const config = store.getConfig();
  const name = config.petName || DEFAULT_PET_NAME;
  const template = [];
  if (includeToggleVisible) {
    template.push({ label: `摸摸 ${name} 的头`, click: () => triggerPetInteraction() });
    template.push({ label: '找它聊天', click: () => createChatWindow() });
    template.push({ type: 'separator' });
    template.push({ label: '回到屏幕内', click: () => resetPetPosition() });
  } else {
    template.push({ label: `${name} 在这里`, enabled: false });
    template.push({ type: 'separator' });
    template.push({
      label: '显示/隐藏桌宠',
      click: () => {
        if (!petWindow) return;
        petWindow.isVisible() ? petWindow.hide() : petWindow.show();
      },
    });
    template.push({ label: '打开聊天', click: () => createChatWindow() });
  }
  template.push(
    { label: '设置…', click: () => createSettingsWindow() },
    { type: 'separator' },
    {
      label: '窗口置顶',
      type: 'checkbox',
      checked: config.alwaysOnTop !== false,
      click: (item) => applyConfigPatch({ alwaysOnTop: item.checked }),
    },
    {
      label: '自由走动',
      type: 'checkbox',
      checked: config.wanderEnabled !== false,
      click: (item) => applyConfigPatch({ wanderEnabled: item.checked }),
    },
    { type: 'separator' }
  );
  if (includeToggleVisible) {
    template.push({ label: '暂时隐藏', click: () => petWindow && petWindow.hide() });
  }
  template.push({ label: '退出', click: () => app.quit() });
  return template;
}

function buildTrayMenu() {
  return Menu.buildFromTemplate(buildMenuTemplate({ includeToggleVisible: false }));
}

function buildPetContextMenu() {
  return Menu.buildFromTemplate(buildMenuTemplate({ includeToggleVisible: true }));
}

function createTray() {
  const trayIcon = getIconImage().resize({ width: 32, height: 32 });
  tray = new Tray(trayIcon);
  tray.setToolTip(store.getConfig().petName || DEFAULT_PET_NAME);
  tray.setContextMenu(buildTrayMenu());
  tray.on('click', () => {
    if (!petWindow) return;
    petWindow.isVisible() ? petWindow.hide() : petWindow.show();
  });
}

function refreshMenus() {
  if (tray) tray.setContextMenu(buildTrayMenu());
}

// ---------------------------------------------------------------------------
// 互动 / 消息广播
// ---------------------------------------------------------------------------

function sayOnPet(text, extra = {}) {
  if (!text) return;
  if (petWindow) petWindow.webContents.send('pet:say', { text, ts: Date.now(), ...extra });
}

function pushToChatWindow(text) {
  if (!text) return;
  if (chatWindow) chatWindow.webContents.send('chat:incoming', { role: 'assistant', content: text, ts: Date.now() });
}

/**
 * 桌宠气泡 + 聊天窗口都同步展示（用于摸头反应、主动搭话等“旁白式”内容）。
 * 注意：由聊天窗口主动发起的回复不要用这个方法，避免在聊天记录里重复出现——
 * 那种情况请只调用 sayOnPet，聊天窗口会自己展示 chat:send 的返回值。
 */
function announce(text, extra = {}) {
  sayOnPet(text, extra);
  pushToChatWindow(text);
}

function broadcastAffection(affection) {
  if (petWindow) petWindow.webContents.send('pet:affection', affection);
}

function triggerPetInteraction() {
  const affection = store.addAffection(2);
  const tier = getAffectionTier(affection);
  const line = getPetReactionLine(tier.key);
  store.markInteraction();
  store.addMessage('assistant', line);
  announce(line, { emotion: 'happy' });
  broadcastAffection(affection);
  return { affection, line };
}

function maybeSendWelcome() {
  const memory = store.getMemory();
  if (memory.conversations && memory.conversations.length > 0) return;
  const line = pick(WELCOME_LINES);
  store.addMessage('assistant', line);
  setTimeout(() => announce(line, { emotion: 'happy' }), 900);
}

async function handleChatSend(text) {
  const trimmed = (text || '').trim();
  if (!trimmed) return { reply: '', affection: store.getAffection() };

  store.addMessage('user', trimmed);
  store.markInteraction();

  const config = store.getConfig();
  let reply;
  let usedFallback = false;
  try {
    const memory = store.getMemory();
    const systemPrompt = buildSystemPrompt({ config, memory });
    const history = store.getRecentMessages(16).map((m) => ({ role: m.role, content: m.content }));
    reply = await chatCompletion({
      baseUrl: config.baseUrl,
      apiKey: config.apiKey,
      model: config.model,
      messages: [{ role: 'system', content: systemPrompt }, ...history],
    });
  } catch (err) {
    usedFallback = true;
    reply = getFallbackReply(trimmed);
  }

  store.addMessage('assistant', reply);
  const affection = store.addAffection(1);
  broadcastAffection(affection);
  sayOnPet(reply, { emotion: 'talk' });
  return { reply, affection, usedFallback };
}

async function maybeSummarizeToday() {
  const config = store.getConfig();
  if (!config.apiKey) return;
  const dateKey = todayKey();
  if (store.getLastSummarizedDate() === dateKey) return;

  const today = new Date();
  const recent = store.getRecentMessages(40).filter((m) => {
    const d = new Date(m.ts);
    return (
      d.getFullYear() === today.getFullYear() &&
      d.getMonth() === today.getMonth() &&
      d.getDate() === today.getDate()
    );
  });
  if (recent.length < 4) return;

  const petName = config.petName || DEFAULT_PET_NAME;
  const transcript = recent.map((m) => `${m.role === 'user' ? '主人' : petName}：${m.content}`).join('\n');
  try {
    const summary = await chatCompletion({
      baseUrl: config.baseUrl,
      apiKey: config.apiKey,
      model: config.model,
      messages: [
        {
          role: 'system',
          content:
            '请把下面这段桌宠和主人的对话内容，总结成一句 30 字以内的中文往事记录，用第三人称、突出情绪或重要信息。只回复这一句话，不要加任何前后缀或标点以外的修饰。',
        },
        { role: 'user', content: transcript },
      ],
      maxTokens: 80,
      temperature: 0.5,
    });
    store.addDailySummary(dateKey, summary);
  } catch (err) {
    console.error('[main] 生成每日摘要失败：', err.message);
  }
}

// ---------------------------------------------------------------------------
// 自由走动
// ---------------------------------------------------------------------------

function scheduleNextWander() {
  const delay = WANDER_MIN_DELAY + Math.random() * (WANDER_MAX_DELAY - WANDER_MIN_DELAY);
  wanderTimer = setTimeout(() => {
    doWander();
    scheduleNextWander();
  }, delay);
}

function startWanderLoop() {
  stopWanderLoop();
  scheduleNextWander();
}

function stopWanderLoop() {
  if (wanderTimer) clearTimeout(wanderTimer);
  wanderTimer = null;
}

function animateWindowTo(fromX, fromY, toX, toY, duration) {
  const start = Date.now();
  const step = () => {
    if (!petWindow) return;
    const elapsed = Date.now() - start;
    const t = Math.min(1, elapsed / duration);
    const eased = 1 - Math.pow(1 - t, 3);
    const x = Math.round(fromX + (toX - fromX) * eased);
    const y = Math.round(fromY + (toY - fromY) * eased);
    petWindow.setPosition(x, y);
    if (t < 1) {
      setTimeout(step, 16);
    } else {
      store.saveWindowBounds({ x: toX, y: toY });
    }
  };
  step();
}

function scheduleWalkEnd(duration, facing) {
  if (walkEndTimer) clearTimeout(walkEndTimer);
  walkEndTimer = setTimeout(() => {
    if (petWindow) {
      currentPetState = 'idle';
      currentPetFacing = facing;
      petWindow.webContents.send('pet:state', { state: 'idle', facing });
    }
    walkEndTimer = null;
  }, duration + 80);
}

/**
 * 让桌宠以“侧面走路”的姿态走到 targetX（窗口原地不动，靠 CSS 走路动画表现）。
 * 仅在当前处于 idle 时才能开始，避免和别的动作打架。
 * @returns {boolean} 是否成功发起了一次行走
 */
function startWalk({ distance, duration, facing }) {
  if (!petWindow || !petWindow.isVisible()) return false;
  if (currentPetState !== 'idle') return false;

  const bounds = petWindow.getBounds();
  const display = screen.getDisplayNearestPoint({ x: bounds.x, y: bounds.y });
  const wa = display.workArea;
  let targetX = bounds.x + (facing === 'left' ? -distance : distance);
  targetX = Math.min(Math.max(targetX, wa.x), wa.x + wa.width - bounds.width);
  if (Math.abs(targetX - bounds.x) < 8) return false;

  currentPetState = 'walking';
  currentPetFacing = facing;
  petWindow.webContents.send('pet:state', { state: 'walking', facing });
  animateWindowTo(bounds.x, bounds.y, targetX, bounds.y, duration);
  scheduleWalkEnd(duration, facing);
  return true;
}

function doWander() {
  const config = store.getConfig();
  if (!config.wanderEnabled) return;
  if (!petWindow || !petWindow.isVisible()) return;
  if (petWindow.isFocused() || petBubbleVisible || isDragging) return;
  if (currentPetState !== 'idle') return;

  const distance = 90 + Math.random() * 170;
  const facing = Math.random() < 0.5 ? 'left' : 'right'; // 随机来回方向
  const duration = WALK_CYCLE_MS * Math.max(3, Math.round(distance / 42)); // 让行走距离与动画周期匹配
  startWalk({ distance, duration, facing });
}

// ---------------------------------------------------------------------------
// 随机小动作（跳跃 / 坐下）
// ---------------------------------------------------------------------------

function scheduleIdleAnimation() {
  const delay = IDLE_ANIM_MIN_DELAY + Math.random() * (IDLE_ANIM_MAX_DELAY - IDLE_ANIM_MIN_DELAY);
  idleAnimTimer = setTimeout(() => {
    doIdleAnimation();
    scheduleIdleAnimation();
  }, delay);
}

function startIdleAnimationLoop() {
  stopIdleAnimationLoop();
  scheduleIdleAnimation();
}

function stopIdleAnimationLoop() {
  if (idleAnimTimer) clearTimeout(idleAnimTimer);
  idleAnimTimer = null;
}

function doIdleAnimation() {
  if (!petWindow || !petWindow.isVisible()) return;
  if (petWindow.isFocused() || petBubbleVisible || isDragging) return;
  if (currentPetState !== 'idle' || walkEndTimer) return;

  // 三种待机小动作：侧面来回走 / 原地跳跃 / 坐下休息
  const roll = Math.random();
  let anim = roll < 0.4 ? 'walking' : roll < 0.7 ? 'hopping' : 'sitting';

  if (anim === 'walking') {
    const distance = 50 + Math.random() * 90;
    const facing = Math.random() < 0.5 ? 'left' : 'right';
    const duration = WALK_CYCLE_MS * Math.max(2, Math.round(distance / 42));
    if (startWalk({ distance, duration, facing })) return;
    anim = 'hopping'; // 走到墙边无处可走时，退化为跳跃
  }

  currentPetState = anim;
  petWindow.webContents.send('pet:state', { state: anim, facing: currentPetFacing });
  const duration = anim === 'hopping' ? 1600 : 2600;
  setTimeout(() => {
    if (petWindow && currentPetState === anim) {
      currentPetState = 'idle';
      petWindow.webContents.send('pet:state', { state: 'idle', facing: currentPetFacing });
    }
  }, duration);
}

// ---------------------------------------------------------------------------
// 主动搭话
// ---------------------------------------------------------------------------

function startProactiveLoop() {
  stopProactiveLoop();
  proactiveTimer = setInterval(checkProactive, PROACTIVE_CHECK_INTERVAL);
}

function stopProactiveLoop() {
  if (proactiveTimer) clearInterval(proactiveTimer);
  proactiveTimer = null;
}

async function checkProactive() {
  const config = store.getConfig();
  if (!config.proactiveEnabled) return;
  if (!petWindow || !petWindow.isVisible()) return;

  const now = Date.now();
  const hour = new Date().getHours();
  if (isWithinQuietHours(hour, config.quietHoursStart, config.quietHoursEnd)) return;

  const idleMs = now - store.getLastInteraction();
  const cooldownOk = now - lastProactiveAt > PROACTIVE_COOLDOWN;
  if (idleMs > PROACTIVE_IDLE_THRESHOLD && cooldownOk && Math.random() < 0.7) {
    lastProactiveAt = now;
    let line = '';
    // 只有在显式打开“主动搭话使用 AI”且配置了 Key 时才消耗 token，否则只说内置台词
    if (config.proactiveUseAi && config.apiKey) {
      line = await generateAiProactiveLine(config, hour);
    }
    if (!line) line = getProactiveLine(hour);
    store.addMessage('assistant', line);
    announce(line, { emotion: 'idle-thought' });
  }
}

async function generateAiProactiveLine(config, hour) {
  const petName = config.petName || DEFAULT_PET_NAME;
  const period = getTimePeriod(hour);
  const periodName = {
    lateNight: '深夜',
    morning: '早上',
    noon: '中午',
    afternoon: '下午',
    evening: '晚上',
  }[period];
  try {
    const reply = await chatCompletion({
      baseUrl: config.baseUrl,
      apiKey: config.apiKey,
      model: config.model,
      messages: [
        {
          role: 'system',
          content:
            `你是${petName}，一个住在桌面上的扭扭棒+毛线小人偶。当前是${periodName}，请用一句话、可爱自然、30字以内主动跟主人搭话。不要加动作描述或括号。`,
        },
        { role: 'user', content: '说点什么吧' },
      ],
      maxTokens: 60,
      temperature: 0.8,
    });
    return (reply || '').trim();
  } catch (err) {
    console.error('[main] AI 主动搭话生成失败：', err.message);
    return '';
  }
}

// ---------------------------------------------------------------------------
// 配置应用
// ---------------------------------------------------------------------------

function applyConfigPatch(patch) {
  const updated = store.saveConfig(patch);

  if (petWindow) {
    if (typeof patch.alwaysOnTop === 'boolean') petWindow.setAlwaysOnTop(patch.alwaysOnTop);
    if (typeof patch.scale === 'number') resizePetWindow(updated.scale);
    petWindow.webContents.send('pet:config', updated);
  }
  if (typeof patch.autoLaunch === 'boolean') {
    try {
      app.setLoginItemSettings({ openAtLogin: patch.autoLaunch });
    } catch (err) {
      console.error('[main] 设置开机自启失败：', err.message);
    }
  }
  if (typeof patch.wanderEnabled === 'boolean') {
    if (patch.wanderEnabled) startWanderLoop();
    else stopWanderLoop();
  }
  if (typeof patch.petName === 'string') {
    if (tray) tray.setToolTip(updated.petName || DEFAULT_PET_NAME);
    if (chatWindow) chatWindow.setTitle(`和 ${updated.petName || DEFAULT_PET_NAME} 聊天`);
    if (settingsWindow) settingsWindow.setTitle(`设置 - ${updated.petName || DEFAULT_PET_NAME}`);
  }
  refreshMenus();
  return updated;
}

// ---------------------------------------------------------------------------
// IPC
// ---------------------------------------------------------------------------

function registerIpcHandlers() {
  ipcMain.handle('pet:init', () => ({
    config: store.getConfig(),
    affection: store.getAffection(),
  }));

  ipcMain.handle('pet:interact', () => triggerPetInteraction());
  ipcMain.handle('pet:getAffection', () => store.getAffection());
  ipcMain.handle('pet:affectionInfo', () => {
    const affection = store.getAffection();
    return { affection, tier: getAffectionTier(affection) };
  });
  ipcMain.handle('pet:resetAffection', () => {
    store.resetAffection();
    broadcastAffection(0);
    return 0;
  });

  ipcMain.on('pet:contextmenu', (event) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    buildPetContextMenu().popup({ window: win || undefined });
  });

  ipcMain.on('pet:ready', () => maybeSendWelcome());
  ipcMain.on('pet:bubble-visible', (event, visible) => {
    petBubbleVisible = Boolean(visible);
  });

  ipcMain.on('pet:drag-start', () => {
    isDragging = true;
  });
  ipcMain.on('pet:drag-end', () => {
    isDragging = false;
    if (petWindow) {
      const bounds = petWindow.getBounds();
      store.saveWindowBounds({ x: bounds.x, y: bounds.y });
    }
  });
  ipcMain.on('pet:drag-by', (event, payload) => {
    if (!petWindow || !payload) return;
    const bounds = petWindow.getBounds();
    const display = screen.getDisplayNearestPoint({ x: bounds.x, y: bounds.y });
    const clamped = clampToWorkArea(
      bounds.x + (payload.dx || 0),
      bounds.y + (payload.dy || 0),
      bounds.width,
      bounds.height,
      display
    );
    // 仅移动位置，绝不调整窗口大小：之前在每次移动时调用 setSize 会因为
    // 高 DPI / 缩放屏的像素取整误差被反复放大，导致桌宠“莫名变大”。
    petWindow.setPosition(clamped.x, clamped.y);
  });

  ipcMain.on('window:openChat', () => createChatWindow());
  ipcMain.on('window:openSettings', () => createSettingsWindow());
  ipcMain.on('window:close', (event, name) => {
    if (name === 'chat' && chatWindow) chatWindow.close();
    if (name === 'settings' && settingsWindow) settingsWindow.close();
  });
  ipcMain.on('app:quit', () => app.quit());

  ipcMain.handle('config:get', () => store.getConfig());
  ipcMain.handle('config:save', (event, patch) => applyConfigPatch(patch || {}));
  ipcMain.handle('config:testConnection', async (event, patch) => {
    const cfg = { ...store.getConfig(), ...(patch || {}) };
    try {
      const reply = await chatCompletion({
        baseUrl: cfg.baseUrl,
        apiKey: cfg.apiKey,
        model: cfg.model,
        messages: [
          { role: 'system', content: '你是一个连通性测试助手，请只回复"连接成功"四个字，不要说其他内容。' },
          { role: 'user', content: '测试' },
        ],
        maxTokens: 20,
        temperature: 0,
      });
      return { ok: true, reply };
    } catch (err) {
      return { ok: false, error: err.message || String(err) };
    }
  });

  ipcMain.handle('chat:history', () => store.getRecentMessages(50));
  ipcMain.handle('chat:clear', () => {
    store.clearConversation();
    return true;
  });
  ipcMain.handle('chat:send', (event, text) => handleChatSend(text));

  ipcMain.handle('asr:transcribe', async (event, payload) => {
    const config = store.getConfig();
    const useCustom = config.asrUseCustom && config.asrBaseUrl;
    const baseUrl = useCustom ? config.asrBaseUrl : config.baseUrl;
    const apiKey = useCustom ? config.asrApiKey : config.apiKey;
    try {
      if (!payload || !payload.audioBase64) throw new Error('没有收到录音数据');
      const buffer = Buffer.from(payload.audioBase64, 'base64');
      const text = await transcribeAudio({
        baseUrl,
        apiKey,
        model: config.asrModel,
        buffer,
        contentType: payload.mimeType || 'audio/webm',
        filename: payload.mimeType && payload.mimeType.includes('ogg') ? 'audio.ogg' : 'audio.webm',
      });
      return { ok: true, text };
    } catch (err) {
      return { ok: false, error: (err && err.message) || String(err) };
    }
  });

  // ---------- Edge TTS ----------
  ipcMain.handle('tts:speak', async (event, payload) => {
    try {
      if (!payload || !payload.text) throw new Error('没有要朗读的文本');
      const config = store.getConfig();
      const result = await edgeTts.synthesize({
        text: payload.text,
        voice: payload.voice || config.ttsEdgeVoice || edgeTts.DEFAULT_VOICE,
        rate: typeof payload.rate === 'number' ? payload.rate : (config.ttsRate || 1.0),
        pitch: typeof payload.pitch === 'number' ? payload.pitch : (config.ttsPitch || 0),
        volume: typeof payload.volume === 'number' ? payload.volume : (config.ttsVolume || 1.0),
      });
      return { ok: true, audioBase64: result.audioBase64, mimeType: result.mimeType };
    } catch (err) {
      return { ok: false, error: (err && err.message) || String(err) };
    }
  });

  ipcMain.handle('tts:listVoices', () => {
    return { ok: true, voices: edgeTts.CHINESE_VOICES };
  });

  ipcMain.handle('meta:getVersion', () => app.getVersion());
}

// ---------------------------------------------------------------------------
// 生命周期
// ---------------------------------------------------------------------------

app.whenReady().then(() => {
  store = new Store(path.join(app.getPath('userData'), 'nibble-data.json'));
  registerIpcHandlers();

  // 语音识别需要麦克风权限，本应用没有 UI 可以弹出系统权限弹框，这里直接代用户同意
  // （Windows 上真正的麦克风开关仍由系统隐私设置控制，这里只是放行 Electron 自己的权限门）。
  session.defaultSession.setPermissionRequestHandler((webContents, permission, callback) => {
    if (permission === 'media') {
      callback(true);
      return;
    }
    callback(false);
  });

  createPetWindow();
  createTray();

  if (store.getConfig().wanderEnabled) startWanderLoop();
  startIdleAnimationLoop();
  startProactiveLoop();
});

app.on('window-all-closed', () => {
  // 桌宠依靠托盘常驻后台，不随窗口关闭而退出；只能通过托盘/右键菜单的“退出”结束。
});

app.on('activate', () => {
  if (!petWindow) createPetWindow();
  else petWindow.show();
});

app.on('before-quit', (event) => {
  if (isQuitting) return;
  event.preventDefault();
  isQuitting = true;
  const timeoutPromise = new Promise((resolve) => setTimeout(resolve, 4000));
  Promise.race([maybeSummarizeToday().catch(() => {}), timeoutPromise]).finally(() => {
    app.quit();
  });
});

process.on('uncaughtException', (err) => {
  console.error('[main] 未捕获的异常：', err);
});
