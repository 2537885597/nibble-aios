(() => {
  const messagesEl = document.getElementById('messages');
  const inputEl = document.getElementById('input');
  const sendBtn = document.getElementById('send-btn');
  const clearBtn = document.getElementById('clear-btn');
  const petNameEl = document.getElementById('pet-name');
  const affectionLabelEl = document.getElementById('affection-label');

  const micBtn = document.getElementById('mic-btn');

  let petName = 'Nibble';
  let sending = false;
  let soundEnabled = true;
  let ttsEngine = 'edge';
  let ttsRate = 1;
  let ttsPitch = 0;
  let ttsVolume = 1;
  let ttsVoiceName = '';
  let ttsEdgeVoice = 'zh-CN-XiaoxiaoNeural';
  let activeTtsAudio = null;

  let audioCtx = null;
  function playTone({ freq = 600, duration = 0.12, type = 'sine', volume = 0.15, delay = 0 }) {
    if (!soundEnabled) return;
    try {
      if (!audioCtx) {
        const AudioCtx = window.AudioContext || window.webkitAudioContext;
        audioCtx = new AudioCtx();
      }
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      osc.type = type;
      osc.frequency.value = freq;
      osc.connect(gain);
      gain.connect(audioCtx.destination);
      const startTime = audioCtx.currentTime + delay;
      gain.gain.setValueAtTime(0, startTime);
      gain.gain.linearRampToValueAtTime(volume, startTime + 0.015);
      gain.gain.exponentialRampToValueAtTime(0.0001, startTime + duration);
      osc.start(startTime);
      osc.stop(startTime + duration + 0.02);
    } catch (err) {
      // 静默失败即可
    }
  }
  function playDing() {
    playTone({ freq: 880, duration: 0.14, type: 'triangle', volume: 0.14 });
    playTone({ freq: 1320, duration: 0.16, type: 'triangle', volume: 0.1, delay: 0.06 });
  }

  function stopActiveTts() {
    try {
      if (activeTtsAudio) {
        activeTtsAudio.pause();
        activeTtsAudio.src = '';
        activeTtsAudio = null;
      }
    } catch (_) {}
    if ('speechSynthesis' in window) {
      try { window.speechSynthesis.cancel(); } catch (_) {}
    }
  }

  function pickGentleChineseVoice() {
    if (!('speechSynthesis' in window)) return null;
    const voices = window.speechSynthesis.getVoices();
    const zh = voices.filter((v) => v.lang && v.lang.toLowerCase().startsWith('zh'));
    if (!zh.length) return null;
    const preferred = ['Xiaoxiao', 'Yaoyao', 'Huihui', 'Xiaoyi', 'Xiaomeng', 'Tingting', 'Lili', 'Yue', 'Xiaomin', 'Xiaoxuan'];
    for (const p of preferred) {
      const found = zh.find((v) => v.name && v.name.toLowerCase().includes(p.toLowerCase()));
      if (found) return found;
    }
    const avoid = ['Yunyang', 'Yunjie', 'Yunfeng', 'Yunye'];
    const filtered = zh.filter((v) => !avoid.some((a) => v.name && v.name.includes(a)));
    return filtered[0] || zh[0];
  }

  function speakWebSpeechInChat(text) {
    if (!('speechSynthesis' in window)) return;
    try {
      const utter = new SpeechSynthesisUtterance(text);
      const voices = window.speechSynthesis.getVoices();
      let voice = ttsVoiceName ? voices.find((v) => v.name === ttsVoiceName) : null;
      if (!voice) voice = pickGentleChineseVoice();
      if (voice) utter.voice = voice;
      utter.lang = (voice && voice.lang) || 'zh-CN';
      utter.rate = ttsRate || 1;
      window.speechSynthesis.speak(utter);
    } catch (err) {
      console.error('朗读失败', err);
    }
  }

  async function speakInChat(text) {
    if (!text) return;
    stopActiveTts();
    if (ttsEngine === 'edge') {
      try {
        const res = await window.api.ttsSpeak({
          text,
          voice: ttsEdgeVoice,
          rate: ttsRate,
          pitch: ttsPitch,
          volume: ttsVolume,
        });
        if (res && res.ok) {
          const audio = new Audio(`data:audio/mpeg;base64,${res.audioBase64}`);
          audio.volume = ttsVolume;
          activeTtsAudio = audio;
          audio.play().catch((err) => console.error('Edge TTS 播放失败', err));
          audio.onended = () => { if (activeTtsAudio === audio) activeTtsAudio = null; };
          return;
        }
        // Edge 失败（网络/服务异常）时回退到系统语音，避免彻底没声音
        console.error('Edge TTS 合成失败，回退到系统语音：', res && res.error);
      } catch (err) {
        console.error('Edge TTS 错误', err);
      }
      speakWebSpeechInChat(text);
      return;
    }
    // 仅在显式选择 Web Speech 时使用系统语音
    speakWebSpeechInChat(text);
  }

  function scrollToBottom() {
    messagesEl.scrollTop = messagesEl.scrollHeight;
  }

  function appendMessage(role, content) {
    const div = document.createElement('div');
    div.className = `msg ${role}`;
    const textSpan = document.createElement('span');
    textSpan.className = 'msg-text';
    textSpan.textContent = content;
    div.appendChild(textSpan);
    if (role === 'assistant') {
      const replayBtn = document.createElement('button');
      replayBtn.className = 'replay-btn';
      replayBtn.title = '朗读这句话';
      replayBtn.textContent = '\u{1F50A}';
      replayBtn.addEventListener('click', (event) => {
        event.stopPropagation();
        speakInChat(content);
      });
      div.appendChild(replayBtn);
    }
    messagesEl.appendChild(div);
    scrollToBottom();
    return div;
  }

  function appendSystemHint(text) {
    return appendMessage('system', text);
  }

  function showTyping() {
    const div = document.createElement('div');
    div.className = 'typing';
    div.id = 'typing-indicator';
    div.innerHTML = '<span></span><span></span><span></span>';
    messagesEl.appendChild(div);
    scrollToBottom();
    return div;
  }

  function hideTyping() {
    const el = document.getElementById('typing-indicator');
    if (el) el.remove();
  }

  async function refreshAffectionLabel() {
    try {
      const info = await window.api.getAffectionInfo();
      if (info) {
        affectionLabelEl.textContent = `好感度 ${info.affection} · ${info.tier.name}`;
      }
    } catch (err) {
      console.error('读取好感度失败', err);
    }
  }

  async function refreshHeader() {
    try {
      const config = await window.api.getConfig();
      petName = config.petName || petName;
      soundEnabled = config.soundEnabled !== false;
      ttsEngine = config.ttsEngine || 'edge';
      ttsRate = config.ttsRate || 1;
      ttsPitch = config.ttsPitch || 0;
      ttsVolume = config.ttsVolume || 1;
      ttsVoiceName = config.ttsVoice || '';
      ttsEdgeVoice = config.ttsEdgeVoice || 'zh-CN-XiaoxiaoNeural';
      petNameEl.textContent = petName;
      document.title = `和 ${petName} 聊天`;
    } catch (err) {
      console.error('读取配置失败', err);
    }
    await refreshAffectionLabel();
  }

  async function loadHistory() {
    try {
      const history = await window.api.getChatHistory();
      if (!history || history.length === 0) {
        appendSystemHint(
          `还没有聊过天，跟 ${petName} 打个招呼吧～如果想让它聊得更聪明，记得先去设置里配置 AI 服务哦。`
        );
        return;
      }
      history.forEach((m) => appendMessage(m.role, m.content));
    } catch (err) {
      console.error('读取历史记录失败', err);
    }
  }

  function autoResize() {
    inputEl.style.height = 'auto';
    inputEl.style.height = `${Math.min(inputEl.scrollHeight, 96)}px`;
  }

  async function sendMessage() {
    const text = inputEl.value.trim();
    if (!text || sending) return;
    sending = true;
    sendBtn.disabled = true;
    appendMessage('user', text);
    inputEl.value = '';
    autoResize();
    showTyping();
    try {
      const res = await window.api.sendChatMessage(text);
      hideTyping();
      if (res && res.reply) {
        appendMessage('assistant', res.reply);
        playDing();
      }
      await refreshAffectionLabel();
    } catch (err) {
      hideTyping();
      appendSystemHint('消息发送失败，请稍后再试。');
      console.error(err);
    } finally {
      sending = false;
      sendBtn.disabled = false;
      inputEl.focus();
    }
  }

  function blobToBase64(blob) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => {
        const result = String(reader.result || '');
        resolve(result.split(',')[1] || '');
      };
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
  }

  let mediaRecorder = null;
  let recordingStream = null;
  let recordedChunks = [];
  let isRecording = false;
  let autoStopTimer = null;

  async function startRecording() {
    if (isRecording || !navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      if (!navigator.mediaDevices) appendSystemHint('当前环境不支持语音输入。');
      return;
    }
    try {
      recordingStream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch (err) {
      console.error('麦克风权限失败', err);
      appendSystemHint('无法访问麦克风，请检查系统隐私设置中是否允许该应用使用麦克风。');
      return;
    }
    recordedChunks = [];
    let recorder;
    try {
      const preferred = 'audio/webm;codecs=opus';
      const options = window.MediaRecorder && MediaRecorder.isTypeSupported && MediaRecorder.isTypeSupported(preferred)
        ? { mimeType: preferred }
        : undefined;
      recorder = options ? new MediaRecorder(recordingStream, options) : new MediaRecorder(recordingStream);
    } catch (err) {
      console.error('创建录音器失败', err);
      appendSystemHint('这台设备不支持录音功能。');
      recordingStream.getTracks().forEach((t) => t.stop());
      recordingStream = null;
      return;
    }
    mediaRecorder = recorder;
    mediaRecorder.addEventListener('dataavailable', (event) => {
      if (event.data && event.data.size > 0) recordedChunks.push(event.data);
    });
    mediaRecorder.addEventListener('stop', handleRecordingStop);
    mediaRecorder.start();
    isRecording = true;
    micBtn.classList.add('recording');
    autoStopTimer = setTimeout(() => stopRecording(), 15000);
  }

  function stopRecording() {
    if (!isRecording || !mediaRecorder) return;
    isRecording = false;
    micBtn.classList.remove('recording');
    if (autoStopTimer) {
      clearTimeout(autoStopTimer);
      autoStopTimer = null;
    }
    try {
      mediaRecorder.stop();
    } catch (err) {
      console.error('停止录音失败', err);
    }
  }

  async function handleRecordingStop() {
    if (recordingStream) {
      recordingStream.getTracks().forEach((t) => t.stop());
      recordingStream = null;
    }
    const chunks = recordedChunks;
    recordedChunks = [];
    if (!chunks.length) return;
    const blob = new Blob(chunks, { type: (mediaRecorder && mediaRecorder.mimeType) || 'audio/webm' });
    if (blob.size < 600) {
      appendSystemHint('没有听清楚，要不要再说一次？');
      return;
    }
    micBtn.disabled = true;
    const hintEl = appendSystemHint('正在识别语音…');
    try {
      const base64 = await blobToBase64(blob);
      const res = await window.api.transcribeAudio(base64, blob.type);
      hintEl.remove();
      if (res && res.ok && res.text) {
        inputEl.value = res.text;
        autoResize();
        await sendMessage();
      } else {
        appendSystemHint(`语音识别失败：${(res && res.error) || '未知错误'}`);
      }
    } catch (err) {
      hintEl.remove();
      appendSystemHint('语音识别失败，请稍后再试。');
      console.error(err);
    } finally {
      micBtn.disabled = false;
    }
  }

  micBtn.addEventListener('click', () => {
    if (isRecording) stopRecording();
    else startRecording();
  });

  inputEl.addEventListener('input', autoResize);
  inputEl.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      sendMessage();
    }
  });
  sendBtn.addEventListener('click', sendMessage);

  clearBtn.addEventListener('click', async () => {
    const confirmed = window.confirm('确定要清空所有聊天记录吗？此操作无法撤销。');
    if (!confirmed) return;
    await window.api.clearChatHistory();
    messagesEl.innerHTML = '';
    appendSystemHint('聊天记录已清空。');
  });

  window.api.onIncomingMessage((payload) => {
    if (!payload || !payload.content) return;
    appendMessage('assistant', payload.content);
    playDing();
    refreshAffectionLabel();
  });

  (async function init() {
    await refreshHeader();
    await loadHistory();
    inputEl.focus();
  })();
})();
