(() => {
  const characterWrap = document.getElementById('character-wrap');
  const bubble = document.getElementById('bubble');
  const bubbleText = document.getElementById('bubble-text');
  const heartsLayer = document.getElementById('hearts-layer');

  const STATES = ['idle', 'walking', 'sleeping', 'reacting', 'talking', 'hopping', 'sitting'];
  let currentState = 'idle';
  let bubbleHideTimer = null;
  let blinkTimer = null;
  let zzzInterval = null;
  let lastClickTime = 0;
  let lastLocalInteraction = Date.now();
  let currentConfig = {
    quietHoursStart: 23,
    quietHoursEnd: 7,
    soundEnabled: true,
    ttsEnabled: true,
    ttsRate: 1,
    ttsVoice: '',
    ttsEngine: 'edge',  // 'edge' | 'webspeech'
  };

  // ============== TTS - Edge TTS (优先) & Web Speech (回退) ==============

  let activeTtsAudio = null;
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

  async function speak(text) {
    if (!text || currentConfig.ttsEnabled === false) return;
    stopActiveTts();
    if (currentConfig.ttsEngine === 'edge') {
      const ok = await speakEdge(text);
      // Edge TTS 失败时（网络/服务异常），优雅回退到系统语音，避免彻底没声音。
      // 默认优先使用 Edge，所以只有真正连不上微软服务时才会走到这里。
      if (!ok && currentConfig.ttsFallback !== false) speakWebSpeech(text);
    } else {
      speakWebSpeech(text);
    }
  }

  async function speakEdge(text) {
    try {
      const res = await window.api.ttsSpeak({
        text,
        voice: currentConfig.ttsEdgeVoice || '',
        rate: currentConfig.ttsRate || 1.0,
        pitch: currentConfig.ttsPitch || 0,
        volume: currentConfig.ttsVolume || 1.0,
      });
      if (!res || !res.ok) return false;
      const audio = new Audio(`data:audio/mpeg;base64,${res.audioBase64}`);
      audio.volume = currentConfig.ttsVolume || 1.0;
      activeTtsAudio = audio;
      audio.play().catch((err) => console.error('Edge TTS 播放失败', err));
      audio.onended = () => { if (activeTtsAudio === audio) activeTtsAudio = null; };
      return true;
    } catch (err) {
      console.error('Edge TTS 失败', err);
      return false;
    }
  }

  let cachedVoices = [];
  function refreshVoices() {
    if ('speechSynthesis' in window) cachedVoices = window.speechSynthesis.getVoices();
  }
  if ('speechSynthesis' in window) {
    refreshVoices();
    window.speechSynthesis.onvoiceschanged = refreshVoices;
  }

  function pickGentleChineseVoice() {
    const zh = cachedVoices.filter((v) => v.lang && v.lang.toLowerCase().startsWith('zh'));
    if (!zh.length) return null;
    // 优先挑温柔的女声，避开“播音腔”的新闻男声（云扬/云杰等）
    const preferred = ['Xiaoxiao', 'Yaoyao', 'Huihui', 'Xiaoyi', 'Xiaomeng', 'Tingting', 'Lili', 'Yue', 'Xiaomin', 'Xiaoxuan'];
    for (const p of preferred) {
      const found = zh.find((v) => v.name && v.name.toLowerCase().includes(p.toLowerCase()));
      if (found) return found;
    }
    const avoid = ['Yunyang', 'Yunjie', 'Yunfeng', 'Yunye'];
    const filtered = zh.filter((v) => !avoid.some((a) => v.name && v.name.includes(a)));
    return filtered[0] || zh[0];
  }

  function speakWebSpeech(text) {
    if (!('speechSynthesis' in window)) return;
    try {
      const utter = new SpeechSynthesisUtterance(text);
      let voice = null;
      if (currentConfig.ttsVoice) {
        voice = cachedVoices.find((v) => v.name === currentConfig.ttsVoice);
      }
      if (!voice) voice = pickGentleChineseVoice();
      if (voice) utter.voice = voice;
      utter.lang = (voice && voice.lang) || 'zh-CN';
      utter.rate = currentConfig.ttsRate || 1;
      window.speechSynthesis.speak(utter);
    } catch (err) {
      console.error('Web Speech 播放失败', err);
    }
  }

  // ============== 音效 ==============

  let audioCtx = null;
  function playTone({ freq = 600, duration = 0.12, type = 'sine', volume = 0.15, delay = 0 }) {
    if (currentConfig.soundEnabled === false) return;
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
    } catch (err) {}
  }
  function playPop() {
    playTone({ freq: 720, duration: 0.09, volume: 0.18 });
    playTone({ freq: 960, duration: 0.09, volume: 0.12, delay: 0.05 });
    playTone({ freq: 1320, duration: 0.12, volume: 0.08, delay: 0.1 });
  }

  // ============== 状态机 ==============

  function setState(next) {
    if (!STATES.includes(next)) return;
    currentState = next;
    STATES.forEach((s) => characterWrap.classList.toggle(`state-${s}`, s === next));
    if (next === 'sleeping') startZzz();
    else stopZzz();
  }

  function setFacing(facing) {
    characterWrap.classList.toggle('facing-left', facing === 'left');
    characterWrap.classList.toggle('facing-right', facing !== 'left');
  }

  function markLocalInteraction() {
    lastLocalInteraction = Date.now();
  }

  function showBubble(text) {
    if (!text) return;
    markLocalInteraction();
    wake();
    bubbleText.textContent = text;
    bubble.classList.remove('hidden');
    bubble.classList.add('visible');
    window.api.notifyBubbleVisible(true);
    speak(text);
    if (bubbleHideTimer) clearTimeout(bubbleHideTimer);

    const stateBeforeTalk = currentState === 'talking' ? 'idle' : currentState;
    if (currentState !== 'sleeping') setState('talking');

    const displayDuration = Math.min(9000, Math.max(2400, text.length * 130));
    bubbleHideTimer = setTimeout(() => {
      bubble.classList.remove('visible');
      bubble.classList.add('hidden');
      window.api.notifyBubbleVisible(false);
      if (currentState === 'talking') setState(stateBeforeTalk);
    }, displayDuration);
  }

  // ============== 漂浮特效 ==============

  function spawnHeart() {
    const heart = document.createElement('div');
    heart.className = 'floating-heart';
    heart.textContent = '♥';
    heart.style.left = `${40 + Math.random() * 20}%`;
    heartsLayer.appendChild(heart);
    heart.addEventListener('animationend', () => heart.remove());
  }

  function spawnStars() {
    const star = document.createElement('div');
    star.className = 'floating-heart';
    star.textContent = '✦';
    star.style.color = '#FFD86E';
    star.style.left = `${40 + Math.random() * 20}%`;
    heartsLayer.appendChild(star);
    star.addEventListener('animationend', () => star.remove());
  }

  function spawnZzz() {
    const z = document.createElement('div');
    z.className = 'floating-zzz';
    z.textContent = 'z';
    z.style.left = `${48 + Math.random() * 10}%`;
    heartsLayer.appendChild(z);
    z.addEventListener('animationend', () => z.remove());
  }

  function startZzz() {
    if (zzzInterval) return;
    spawnZzz();
    zzzInterval = setInterval(spawnZzz, 2000);
  }

  function stopZzz() {
    if (zzzInterval) {
      clearInterval(zzzInterval);
      zzzInterval = null;
    }
  }

  function scheduleBlink() {
    const delay = 2200 + Math.random() * 3600;
    blinkTimer = setTimeout(() => {
      if (currentState !== 'sleeping') {
        characterWrap.classList.add('blinking');
        setTimeout(() => characterWrap.classList.remove('blinking'), 140);
      }
      scheduleBlink();
    }, delay);
  }

  function isNightHour(hour) {
    const start = currentConfig.quietHoursStart;
    const end = currentConfig.quietHoursEnd;
    if (typeof start !== 'number' || typeof end !== 'number' || start === end) return false;
    if (start < end) return hour >= start && hour < end;
    return hour >= start || hour < end;
  }

  function wake() {
    if (currentState === 'sleeping') setState('idle');
  }

  function evaluateAutoSleep() {
    if (currentState === 'walking' || currentState === 'reacting' || currentState === 'talking') return;
    const hour = new Date().getHours();
    const idleForSleep = Date.now() - lastLocalInteraction > 3 * 60 * 1000;
    if (isNightHour(hour) && idleForSleep) {
      if (currentState !== 'sleeping') setState('sleeping');
    } else if (currentState === 'sleeping') {
      setState('idle');
    }
  }

  // ============== 用户交互 ==============

  function handleTap() {
    const now = Date.now();
    if (now - lastClickTime < 260) return;
    lastClickTime = now;
    markLocalInteraction();
    wake();
    window.api
      .petInteract()
    .then((res) => {
      if (res && res.line) {
        // 气泡与朗读已由主进程 announce -> pet:say 统一触发（见 onSay），
        // 这里不要再调一次 showBubble，否则会重复播放语音。
        playPop();
        for (let i = 0; i < 3; i++) {
          setTimeout(() => spawnHeart(), i * 140);
        }
        if (Math.random() < 0.4) setTimeout(() => spawnStars(), 200);
        if (currentState !== 'sleeping') setState('reacting');
        setTimeout(() => {
          if (currentState === 'reacting') setState('talking');
        }, 480);
      }
    })
      .catch((err) => console.error('互动失败', err));
  }

  // 手动拖拽
  let dragActive = false;
  let dragMoved = false;
  let lastPointerX = 0;
  let lastPointerY = 0;
  let dragStartX = 0;
  let dragStartY = 0;

  function onPointerMove(e) {
    if (!dragActive) return;
    const dx = e.screenX - lastPointerX;
    const dy = e.screenY - lastPointerY;
    lastPointerX = e.screenX;
    lastPointerY = e.screenY;
    const totalDist = Math.hypot(e.screenX - dragStartX, e.screenY - dragStartY);
    if (!dragMoved && totalDist > 4) {
      dragMoved = true;
      markLocalInteraction();
      hoverHint.classList.remove('visible');
      window.api.notifyDragStart();
    }
    if (dragMoved) {
      window.api.dragBy(dx, dy);
    }
  }

  function onPointerUp() {
    window.removeEventListener('mousemove', onPointerMove);
    window.removeEventListener('mouseup', onPointerUp);
    dragActive = false;
    if (dragMoved) {
      window.api.notifyDragEnd();
    } else {
      handleTap();
    }
    dragMoved = false;
  }

  characterWrap.addEventListener('mousedown', (e) => {
    if (e.button !== 0) return;
    dragActive = true;
    dragMoved = false;
    lastPointerX = e.screenX;
    lastPointerY = e.screenY;
    dragStartX = e.screenX;
    dragStartY = e.screenY;
    window.addEventListener('mousemove', onPointerMove);
    window.addEventListener('mouseup', onPointerUp);
  });

  characterWrap.addEventListener('dblclick', () => {
    markLocalInteraction();
    window.api.openChat();
  });

  characterWrap.addEventListener('contextmenu', (event) => {
    event.preventDefault();
    window.api.showContextMenu();
  });

  const hoverHint = document.getElementById('hover-hint');
  function onHoverMove(e) {
    hoverHint.style.left = `${e.clientX}px`;
    hoverHint.style.top = `${e.clientY}px`;
  }
  characterWrap.addEventListener('mouseenter', (e) => {
    characterWrap.classList.add('hovering');
    onHoverMove(e);
    if (!dragActive) hoverHint.classList.add('visible');
    characterWrap.addEventListener('mousemove', onHoverMove);
  });
  characterWrap.addEventListener('mouseleave', () => {
    characterWrap.classList.remove('hovering');
    hoverHint.classList.remove('visible');
    characterWrap.removeEventListener('mousemove', onHoverMove);
  });

  // ============== 主进程消息 ==============

  window.api.onStateChange((payload) => {
    if (!payload) return;
    if (payload.facing) setFacing(payload.facing);
    if (payload.state) setState(payload.state);
  });

  window.api.onSay((payload) => {
    if (!payload || !payload.text) return;
    showBubble(payload.text);
  });

  window.api.onAffectionChange(() => {});

  window.api.onConfigUpdate((config) => {
    if (config) currentConfig = { ...currentConfig, ...config };
  });

  // ============== 初始化 ==============

  async function init() {
    setState('idle');
    setFacing('right');
    scheduleBlink();
    try {
      const initData = await window.api.petInit();
      if (initData && initData.config) currentConfig = { ...currentConfig, ...initData.config };
    } catch (err) {
      console.error('桌宠初始化失败', err);
    }
    evaluateAutoSleep();
    setInterval(evaluateAutoSleep, 60 * 1000);
    window.api.notifyPetReady();
  }

  init();
})();
