/**
 * 预加载脚本：在 contextIsolation 打开、nodeIntegration 关闭的前提下，
 * 通过 contextBridge 暴露一个统一的 window.api 给所有渲染进程（桌宠 / 聊天 / 设置窗口）。
 * 具体某个窗口用不到的方法保持未调用即可，不会有副作用。
 */
const { contextBridge, ipcRenderer } = require('electron');

function on(channel, callback) {
  const listener = (_event, payload) => callback(payload);
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.removeListener(channel, listener);
}

contextBridge.exposeInMainWorld('api', {
  // ---------- 桌宠窗口 ----------
  petInit: () => ipcRenderer.invoke('pet:init'),
  petInteract: (type) => ipcRenderer.invoke('pet:interact', type),
  showContextMenu: () => ipcRenderer.send('pet:contextmenu'),
  notifyPetReady: () => ipcRenderer.send('pet:ready'),
  notifyBubbleVisible: (visible) => ipcRenderer.send('pet:bubble-visible', visible),
  dragBy: (dx, dy) => ipcRenderer.send('pet:drag-by', { dx, dy }),
  notifyDragStart: () => ipcRenderer.send('pet:drag-start'),
  notifyDragEnd: () => ipcRenderer.send('pet:drag-end'),
  onStateChange: (cb) => on('pet:state', cb),
  onSay: (cb) => on('pet:say', cb),
  onConfigUpdate: (cb) => on('pet:config', cb),
  onAffectionChange: (cb) => on('pet:affection', cb),

  // ---------- 窗口控制 ----------
  openChat: () => ipcRenderer.send('window:openChat'),
  openSettings: () => ipcRenderer.send('window:openSettings'),
  closeWindow: (name) => ipcRenderer.send('window:close', name),
  quitApp: () => ipcRenderer.send('app:quit'),

  // ---------- 聊天 ----------
  getChatHistory: () => ipcRenderer.invoke('chat:history'),
  sendChatMessage: (text) => ipcRenderer.invoke('chat:send', text),
  clearChatHistory: () => ipcRenderer.invoke('chat:clear'),
  onIncomingMessage: (cb) => on('chat:incoming', cb),

  // ---------- 设置 ----------
  getConfig: () => ipcRenderer.invoke('config:get'),
  saveConfig: (patch) => ipcRenderer.invoke('config:save', patch),
  testConnection: (patch) => ipcRenderer.invoke('config:testConnection', patch),
  resetAffection: () => ipcRenderer.invoke('pet:resetAffection'),
  getAffection: () => ipcRenderer.invoke('pet:getAffection'),
  getAffectionInfo: () => ipcRenderer.invoke('pet:affectionInfo'),
  triggerProactive: () => ipcRenderer.invoke('proactive:trigger'),

  // ---------- 语音识别 ----------
  transcribeAudio: (audioBase64, mimeType) => ipcRenderer.invoke('asr:transcribe', { audioBase64, mimeType }),

  // ---------- 语音合成 (Edge TTS) ----------
  ttsSpeak: (payload) => ipcRenderer.invoke('tts:speak', payload),
  ttsListVoices: () => ipcRenderer.invoke('tts:listVoices'),

  // ---------- 杂项 ----------
  getVersion: () => ipcRenderer.invoke('meta:getVersion'),
});
