/**
 * Edge TTS 封装（基于 msedge-tts 包）
 *
 * 参考：https://github.com/Migushthe2nd/MsEdgeTTS
 *
 * 工作原理：
 * 1. 用 msedge-tts 临时连接到微软的语音服务（无需 API Key）
 * 2. 把待合成文本转成 MP3（通过 toStream 实时拿到音频流，在内存里拼成 Buffer）
 * 3. 把 MP3 编码为 base64 字符串返回给渲染端，用 <audio> 播放
 *
 * 失败处理：
 * - 网络异常 / 微软服务变更 / 接口返回空：抛出错误，由调用方决定是否回退
 *   到系统自带的 Web Speech（见 pet.js / chat.js 的 speak 逻辑）。
 */

const { MsEdgeTTS, OUTPUT_FORMAT } = require('msedge-tts');

/**
 * Edge TTS 中文女声音色（按原图 Q 版小兔子精，选一个温柔少女声）
 * 完整列表可查阅 msedge-tts 的 voices.js ，或 https://learn.microsoft.com/zh-cn/azure/ai-services/speech-service/language-support
 *
 * 常用的中文音色：
 *  - zh-CN-XiaoxiaoNeural   晓晓 - 温柔女声（推荐）
 *  - zh-CN-XiaoyiNeural     晓伊 - 活泼女声
 *  - zh-CN-YunxiNeural      云希 - 青年男声
 *  - zh-CN-YunyangNeural    云扬 - 成熟男声
 *  - zh-CN-XiaoxiaoDialectsNeural   晓晓方言
 *  - zh-CN-XiaomengNeural   晓梦 - 儿童女声
 *  - zh-CN-XiaomoNeural     晓墨 - 情感女声
 *  - zh-CN-XiaoruiNeural    晓睿 - 老年女声
 *  - zh-CN-XiaoxiaoMultilingualNeural  晓晓多语言
 *  - zh-CN-XiaoxuanNeural   晓萱 - 客服女声
 *  - zh-CN-YunyeNeural      云野 - 童话男声
 *  - zh-CN-YunzeNeural      云泽 - 商务男声
 */
const DEFAULT_VOICE = 'zh-CN-XiaoxiaoNeural';

// 速率范围 ±50%，pitch 范围 ±50Hz
function clampRate(rate) {
  if (typeof rate !== 'number' || isNaN(rate)) return 0;
  return Math.max(-50, Math.min(50, Math.round((rate - 1) * 100)));
}

function clampPitch(pitch) {
  if (typeof pitch !== 'number' || isNaN(pitch)) return 0;
  return Math.max(-50, Math.min(50, Math.round(pitch)));
}

function clampVolume(volume) {
  if (typeof volume !== 'number' || isNaN(volume)) return 100;
  return Math.max(0, Math.min(100, Math.round(volume * 100)));
}

/**
 * 合成语音
 * @param {object} options
 * @param {string} options.text           文本
 * @param {string} [options.voice]        音色名，默认 zh-CN-XiaoxiaoNeural
 * @param {number} [options.rate]         0.5 ~ 2.0（1.0 为原速）
 * @param {number} [options.pitch]        -50 ~ 50（Hz 偏移）
 * @param {number} [options.volume]       0 ~ 1
 * @returns {Promise<{audioBase64: string, mimeType: string}>}
 */
async function synthesize({ text, voice = DEFAULT_VOICE, rate = 1.0, pitch = 0, volume = 1.0 }) {
  if (!text || !text.trim()) throw new Error('没有要合成的文本');

  const tts = new MsEdgeTTS();
  try {
    // 第一步：设置音色与输出格式（只需跑一次即可建立 WebSocket 连接）
    await tts.setMetadata(voice, OUTPUT_FORMAT.AUDIO_24KHZ_48KBITRATE_MONO_MP3);

    // 第二步：实时流式合成，rate/pitch/volume 通过 ProsodyOptions 传入
    const { audioStream } = await tts.toStream(text, {
      rate: `${clampRate(rate) >= 0 ? '+' : ''}${clampRate(rate)}%`,
      pitch: `${clampPitch(pitch) >= 0 ? '+' : ''}${clampPitch(pitch)}Hz`,
      volume: `${clampVolume(volume)}%`,
    });

    // 在内存里把音频流拼成完整的 Buffer，避免写临时文件
    const chunks = [];
    await new Promise((resolve, reject) => {
      audioStream.on('data', (chunk) => chunks.push(chunk));
      audioStream.on('end', resolve);
      audioStream.on('error', reject);
    });

    const buffer = Buffer.concat(chunks);
    if (!buffer.length) throw new Error('Edge TTS 没有返回音频数据');
    return {
      audioBase64: buffer.toString('base64'),
      mimeType: 'audio/mpeg',
    };
  } finally {
    try { tts.close(); } catch (_) {}
  }
}

/**
 * 列出常用中文音色（给设置页下拉用）
 */
const CHINESE_VOICES = [
  { id: 'zh-CN-XiaoxiaoNeural',         name: '晓晓 · 温柔女声',     desc: '默认 - 柔和自然' },
  { id: 'zh-CN-XiaoyiNeural',           name: '晓伊 · 活泼女声',     desc: '明亮有活力' },
  { id: 'zh-CN-XiaomengNeural',         name: '晓梦 · 儿童女声',     desc: '可爱萌系' },
  { id: 'zh-CN-XiaomoNeural',           name: '晓墨 · 情感女声',     desc: '温暖浓郁' },
  { id: 'zh-CN-XiaoxiaoMultilingualNeural', name: '晓晓多语言',     desc: '中英混读' },
  { id: 'zh-CN-XiaoxuanNeural',         name: '晓萱 · 客服女声',     desc: '亲切清晰' },
  { id: 'zh-CN-YunxiNeural',            name: '云希 · 青年男声',     desc: '磁性干净' },
  { id: 'zh-CN-YunyangNeural',          name: '云扬 · 成熟男声',     desc: '新闻播报' },
  { id: 'zh-CN-YunyeNeural',            name: '云野 · 童话男声',     desc: '温暖童声' },
];

module.exports = {
  synthesize,
  DEFAULT_VOICE,
  CHINESE_VOICES,
};
