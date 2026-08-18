(() => {
  const el = (id) => document.getElementById(id);

  const petNameInput = el('petName');
  const scaleInput = el('scale');
  const scaleValue = el('scaleValue');
  const alwaysOnTopInput = el('alwaysOnTop');
  const autoLaunchInput = el('autoLaunch');
  const wanderEnabledInput = el('wanderEnabled');
  const proactiveEnabledInput = el('proactiveEnabled');
  const proactiveUseAiInput = el('proactiveUseAi');
  const proactiveAiRow = el('proactiveAiRow');
  const proactiveFrequencyInput = el('proactiveFrequency');
  const proactiveTestBtn = el('proactiveTestBtn');
  const proactiveTestResult = el('proactiveTestResult');
  const soundEnabledInput = el('soundEnabled');
  const quietHoursStartSelect = el('quietHoursStart');
  const quietHoursEndSelect = el('quietHoursEnd');
  const ttsEnabledInput = el('ttsEnabled');
  const ttsEngineInput = el('ttsEngine');
  const ttsEdgeVoiceInput = el('ttsEdgeVoice');
  const ttsPitchInput = el('ttsPitch');
  const ttsPitchValue = el('ttsPitchValue');
  const ttsVolumeInput = el('ttsVolume');
  const ttsVolumeValue = el('ttsVolumeValue');
  const ttsEdgeFields = el('ttsEdgeFields');
  const ttsWebSpeechFields = el('ttsWebSpeechFields');
  const ttsRateInput = el('ttsRate');
  const ttsRateValue = el('ttsRateValue');
  const ttsVoiceSelect = el('ttsVoice');
  const asrUseCustomInput = el('asrUseCustom');
  const asrCustomFields = el('asrCustomFields');
  const asrBaseUrlInput = el('asrBaseUrl');
  const asrApiKeyInput = el('asrApiKey');
  const asrModelInput = el('asrModel');
  const baseUrlInput = el('baseUrl');
  const apiKeyInput = el('apiKey');
  const toggleKeyBtn = el('toggleKeyBtn');
  const modelInput = el('model');
  const personalityInput = el('personality');
  const testBtn = el('testBtn');
  const testResult = el('testResult');
  const affectionInfoEl = el('affectionInfo');
  const resetAffectionBtn = el('resetAffectionBtn');
  const clearHistoryBtn = el('clearHistoryBtn');
  const versionEl = el('version');
  const saveBtn = el('saveBtn');
  const saveStatus = el('saveStatus');

  function fillHourOptions(select) {
    for (let h = 0; h < 24; h++) {
      const opt = document.createElement('option');
      opt.value = String(h);
      opt.textContent = `${String(h).padStart(2, '0')}:00`;
      select.appendChild(opt);
    }
  }
  fillHourOptions(quietHoursStartSelect);
  fillHourOptions(quietHoursEndSelect);

  let savedVoiceName = '';
  function populateVoices() {
    if (!('speechSynthesis' in window)) return;
    const voices = window.speechSynthesis.getVoices();
    if (!voices.length) return;
    const current = ttsVoiceSelect.value || savedVoiceName;
    ttsVoiceSelect.innerHTML = '<option value="">自动选择中文语音</option>';
    voices.forEach((voice) => {
      const opt = document.createElement('option');
      opt.value = voice.name;
      opt.textContent = `${voice.name} (${voice.lang})`;
      ttsVoiceSelect.appendChild(opt);
    });
    if (current) ttsVoiceSelect.value = current;
  }
  if ('speechSynthesis' in window) {
    populateVoices();
    window.speechSynthesis.onvoiceschanged = populateVoices;
  }

  // 填充 Edge TTS 音色列表
  let edgeVoicesLoaded = false;
  async function populateEdgeVoices() {
    if (edgeVoicesLoaded) return;
    try {
      const res = await window.api.ttsListVoices();
      if (res && res.ok && Array.isArray(res.voices)) {
        const current = ttsEdgeVoiceInput.value;
        ttsEdgeVoiceInput.innerHTML = '';
        res.voices.forEach((v) => {
          const opt = document.createElement('option');
          opt.value = v.id;
          opt.textContent = `${v.name} · ${v.desc}`;
          ttsEdgeVoiceInput.appendChild(opt);
        });
        if (current) ttsEdgeVoiceInput.value = current;
        edgeVoicesLoaded = true;
      }
    } catch (err) {
      console.error('加载 Edge TTS 音色失败', err);
    }
  }
  populateEdgeVoices();

  function updateTtsFieldsVisibility() {
    const engine = ttsEngineInput.value;
    ttsEdgeFields.classList.toggle('hidden', engine !== 'edge');
    ttsWebSpeechFields.classList.toggle('hidden', engine !== 'webspeech');
  }
  ttsEngineInput.addEventListener('change', updateTtsFieldsVisibility);

  function updateAsrFieldsVisibility() {
    asrCustomFields.classList.toggle('hidden', !asrUseCustomInput.checked);
  }
  asrUseCustomInput.addEventListener('change', updateAsrFieldsVisibility);

  const ttsPreviewBtn = el('ttsPreviewBtn');
  ttsPreviewBtn.addEventListener('click', async () => {
    const text = '你好呀，我是你的毛线小伙伴，试听一下我的声音吧。';
    if (ttsEngineInput.value === 'edge') {
      try {
        const res = await window.api.ttsSpeak({
          text,
          voice: ttsEdgeVoiceInput.value,
          rate: parseFloat(ttsRateInput.value) || 1,
          pitch: parseFloat(ttsPitchInput.value) || 0,
          volume: parseFloat(ttsVolumeInput.value) || 1,
        });
        if (res && res.ok) {
          const audio = new Audio(`data:audio/mpeg;base64,${res.audioBase64}`);
          audio.volume = parseFloat(ttsVolumeInput.value) || 1;
          audio.play().catch((err) => console.error('试听播放失败', err));
        } else {
          console.error('Edge TTS 试听失败', res && res.error);
        }
      } catch (err) {
        console.error('试听失败', err);
      }
      return;
    }
    if (!('speechSynthesis' in window)) return;
    try {
      window.speechSynthesis.cancel();
      const utter = new SpeechSynthesisUtterance(text);
      const voices = window.speechSynthesis.getVoices();
      const chosen = ttsVoiceSelect.value ? voices.find((v) => v.name === ttsVoiceSelect.value) : null;
      const fallback = voices.find((v) => v.lang && v.lang.toLowerCase().startsWith('zh'));
      const voice = chosen || fallback;
      if (voice) utter.voice = voice;
      utter.lang = (voice && voice.lang) || 'zh-CN';
      utter.rate = parseFloat(ttsRateInput.value) || 1;
      window.speechSynthesis.speak(utter);
    } catch (err) {
      console.error('试听失败', err);
    }
  });

  function applyConfigToForm(config) {
    petNameInput.value = config.petName || '';
    scaleInput.value = config.scale != null ? config.scale : 1;
    scaleValue.textContent = `${Math.round((config.scale != null ? config.scale : 1) * 100)}%`;
    alwaysOnTopInput.checked = config.alwaysOnTop !== false;
    autoLaunchInput.checked = Boolean(config.autoLaunch);
    wanderEnabledInput.checked = config.wanderEnabled !== false;
    proactiveEnabledInput.checked = config.proactiveEnabled !== false;
    proactiveFrequencyInput.value = config.proactiveFrequency || 'medium';
    soundEnabledInput.checked = config.soundEnabled !== false;
    quietHoursStartSelect.value = String(config.quietHoursStart != null ? config.quietHoursStart : 23);
    quietHoursEndSelect.value = String(config.quietHoursEnd != null ? config.quietHoursEnd : 7);
    baseUrlInput.value = config.baseUrl || '';
    apiKeyInput.value = config.apiKey || '';
    modelInput.value = config.model || '';
    personalityInput.value = config.personality || '';

    ttsEnabledInput.checked = config.ttsEnabled !== false;
    ttsEngineInput.value = config.ttsEngine || 'edge';
    ttsRateInput.value = config.ttsRate != null ? config.ttsRate : 1;
    ttsRateValue.textContent = `${(config.ttsRate != null ? config.ttsRate : 1).toFixed(1)}x`;
    ttsPitchInput.value = config.ttsPitch != null ? config.ttsPitch : 0;
    ttsPitchValue.textContent = `${config.ttsPitch > 0 ? '+' : ''}${config.ttsPitch || 0}Hz`;
    ttsVolumeInput.value = config.ttsVolume != null ? config.ttsVolume : 1;
    ttsVolumeValue.textContent = `${Math.round((config.ttsVolume != null ? config.ttsVolume : 1) * 100)}%`;
    savedVoiceName = config.ttsVoice || '';
    ttsVoiceSelect.value = savedVoiceName;
    if (config.ttsEdgeVoice) {
      ttsEdgeVoiceInput.value = config.ttsEdgeVoice;
    }
    updateTtsFieldsVisibility();
    asrUseCustomInput.checked = Boolean(config.asrUseCustom);
    asrBaseUrlInput.value = config.asrBaseUrl || '';
    asrApiKeyInput.value = config.asrApiKey || '';
    asrModelInput.value = config.asrModel || 'whisper-1';
    updateAsrFieldsVisibility();
  }

  function collectFormPatch() {
    return {
      petName: petNameInput.value.trim() || 'Nibble',
      scale: parseFloat(scaleInput.value),
      alwaysOnTop: alwaysOnTopInput.checked,
      autoLaunch: autoLaunchInput.checked,
      wanderEnabled: wanderEnabledInput.checked,
      proactiveEnabled: proactiveEnabledInput.checked,
      proactiveFrequency: proactiveFrequencyInput.value,
      soundEnabled: soundEnabledInput.checked,
      quietHoursStart: parseInt(quietHoursStartSelect.value, 10),
      quietHoursEnd: parseInt(quietHoursEndSelect.value, 10),
      baseUrl: baseUrlInput.value.trim(),
      apiKey: apiKeyInput.value.trim(),
      model: modelInput.value.trim(),
      personality: personalityInput.value,
      ttsEnabled: ttsEnabledInput.checked,
      ttsEngine: ttsEngineInput.value,
      ttsRate: parseFloat(ttsRateInput.value),
      ttsPitch: parseFloat(ttsPitchInput.value),
      ttsVolume: parseFloat(ttsVolumeInput.value),
      ttsVoice: ttsVoiceSelect.value,
      ttsEdgeVoice: ttsEdgeVoiceInput.value,
      asrUseCustom: asrUseCustomInput.checked,
      asrBaseUrl: asrBaseUrlInput.value.trim(),
      asrApiKey: asrApiKeyInput.value.trim(),
      asrModel: asrModelInput.value.trim() || 'whisper-1',
    };
  }

  async function refreshAffectionInfo() {
    try {
      const info = await window.api.getAffectionInfo();
      if (info) {
        affectionInfoEl.textContent = `好感度 ${info.affection} · ${info.tier.name}`;
      }
    } catch (err) {
      console.error('读取好感度失败', err);
    }
  }

  scaleInput.addEventListener('input', () => {
    scaleValue.textContent = `${Math.round(parseFloat(scaleInput.value) * 100)}%`;
  });

  ttsRateInput.addEventListener('input', () => {
    ttsRateValue.textContent = `${parseFloat(ttsRateInput.value).toFixed(1)}x`;
  });

  ttsPitchInput.addEventListener('input', () => {
    const v = parseFloat(ttsPitchInput.value) || 0;
    ttsPitchValue.textContent = `${v > 0 ? '+' : ''}${v}Hz`;
  });

  ttsVolumeInput.addEventListener('input', () => {
    const v = parseFloat(ttsVolumeInput.value) || 0;
    ttsVolumeValue.textContent = `${Math.round(v * 100)}%`;
  });

  toggleKeyBtn.addEventListener('click', () => {
    const isPassword = apiKeyInput.type === 'password';
    apiKeyInput.type = isPassword ? 'text' : 'password';
    toggleKeyBtn.textContent = isPassword ? '隐藏' : '显示';
  });

  testBtn.addEventListener('click', async () => {
    testResult.textContent = '正在测试…';
    testResult.className = 'test-result';
    testBtn.disabled = true;
    try {
      const patch = {
        baseUrl: baseUrlInput.value.trim(),
        apiKey: apiKeyInput.value.trim(),
        model: modelInput.value.trim(),
      };
      const res = await window.api.testConnection(patch);
      if (res.ok) {
        testResult.textContent = `连接成功：${res.reply}`;
        testResult.className = 'test-result ok';
      } else {
        testResult.textContent = `连接失败：${res.error}`;
        testResult.className = 'test-result error';
      }
    } catch (err) {
      testResult.textContent = `连接失败：${err.message || err}`;
      testResult.className = 'test-result error';
    } finally {
      testBtn.disabled = false;
    }
  });

  resetAffectionBtn.addEventListener('click', async () => {
    const confirmed = window.confirm('确定要把好感度重置为 0 吗？');
    if (!confirmed) return;
    await window.api.resetAffection();
    await refreshAffectionInfo();
  });

  clearHistoryBtn.addEventListener('click', async () => {
    const confirmed = window.confirm('确定要清空所有聊天记录吗？此操作无法撤销。');
    if (!confirmed) return;
    await window.api.clearChatHistory();
    testResult.textContent = '';
  });

  proactiveTestBtn.addEventListener('click', async () => {
    proactiveTestResult.textContent = '正在触发…';
    proactiveTestResult.className = 'test-result';
    proactiveTestBtn.disabled = true;
    try {
      const res = await window.api.triggerProactive();
      if (res && res.ok) {
        proactiveTestResult.textContent = `已搭话：${res.line}`;
        proactiveTestResult.className = 'test-result ok';
      } else {
        proactiveTestResult.textContent = '未触发（请先开启“主动搭话”）';
        proactiveTestResult.className = 'test-result error';
      }
    } catch (err) {
      proactiveTestResult.textContent = `失败：${err.message || err}`;
      proactiveTestResult.className = 'test-result error';
    } finally {
      proactiveTestBtn.disabled = false;
    }
  });

  let saveStatusTimer = null;
  saveBtn.addEventListener('click', async () => {
    saveBtn.disabled = true;
    try {
      const patch = collectFormPatch();
      const updated = await window.api.saveConfig(patch);
      applyConfigToForm(updated);
      saveStatus.textContent = '已保存 ✓';
      saveStatus.classList.add('visible');
      if (saveStatusTimer) clearTimeout(saveStatusTimer);
      saveStatusTimer = setTimeout(() => saveStatus.classList.remove('visible'), 2200);
    } catch (err) {
      saveStatus.textContent = `保存失败：${err.message || err}`;
      saveStatus.classList.add('visible');
    } finally {
      saveBtn.disabled = false;
    }
  });

  (async function init() {
    try {
      const config = await window.api.getConfig();
      applyConfigToForm(config);
    } catch (err) {
      console.error('读取配置失败', err);
    }
    try {
      const version = await window.api.getVersion();
      versionEl.textContent = version;
    } catch (err) {
      versionEl.textContent = '未知';
    }
    await refreshAffectionInfo();
  })();
})();
