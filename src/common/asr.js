/**
 * 语音识别（ASR）：调用 OpenAI 兼容的 /audio/transcriptions 接口。
 * 和 llm.js 一样，只用 Node 内置的 https/http 模块，手写 multipart/form-data 编码，
 * 不引入 form-data / axios 等第三方依赖。
 */
const https = require('https');
const http = require('http');
const { URL } = require('url');

function buildMultipartBody(fields, fileField) {
  const boundary = `----NibbleBoundary${Date.now().toString(16)}${Math.random().toString(16).slice(2)}`;
  const parts = [];
  for (const [key, value] of Object.entries(fields)) {
    if (value === undefined || value === null) continue;
    parts.push(
      Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${key}"\r\n\r\n${value}\r\n`, 'utf8')
    );
  }
  parts.push(
    Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="${fileField.name}"; filename="${fileField.filename}"\r\nContent-Type: ${fileField.contentType}\r\n\r\n`,
      'utf8'
    )
  );
  parts.push(fileField.data);
  parts.push(Buffer.from(`\r\n--${boundary}--\r\n`, 'utf8'));
  return { body: Buffer.concat(parts), boundary };
}

function postMultipart(urlStr, { headers = {}, fields, fileField, timeoutMs = 30000 } = {}) {
  return new Promise((resolve, reject) => {
    let target;
    try {
      target = new URL(urlStr);
    } catch (err) {
      reject(new Error('接口地址不合法，请检查设置中的语音识别地址'));
      return;
    }
    const lib = target.protocol === 'http:' ? http : https;
    const { body, boundary } = buildMultipartBody(fields, fileField);

    const req = lib.request(
      {
        hostname: target.hostname,
        port: target.port || (target.protocol === 'http:' ? 80 : 443),
        path: target.pathname + target.search,
        method: 'POST',
        headers: {
          ...headers,
          'Content-Type': `multipart/form-data; boundary=${boundary}`,
          'Content-Length': body.length,
        },
        timeout: timeoutMs,
      },
      (res) => {
        let data = '';
        res.setEncoding('utf8');
        res.on('data', (chunk) => {
          data += chunk;
        });
        res.on('end', () => {
          let parsed = null;
          try {
            parsed = data ? JSON.parse(data) : {};
          } catch (err) {
            parsed = null;
          }
          if (res.statusCode >= 200 && res.statusCode < 300) {
            resolve(parsed !== null ? parsed : data);
          } else {
            const message =
              (parsed && parsed.error && parsed.error.message) ||
              (parsed && parsed.message) ||
              data ||
              `HTTP ${res.statusCode}`;
            reject(new Error(`(${res.statusCode}) ${message}`));
          }
        });
      }
    );
    req.on('timeout', () => req.destroy(new Error('请求超时，请检查网络或接口地址')));
    req.on('error', (err) => reject(new Error(err.message || '网络请求失败')));
    req.write(body);
    req.end();
  });
}

/**
 * @param {object} options
 * @param {string} options.baseUrl OpenAI 兼容地址，例如 https://api.openai.com/v1
 * @param {string} options.apiKey
 * @param {string} options.model 例如 whisper-1
 * @param {Buffer} options.buffer 录音数据
 * @param {string} [options.filename]
 * @param {string} [options.contentType]
 */
async function transcribeAudio({ baseUrl, apiKey, model, buffer, filename = 'audio.webm', contentType = 'audio/webm' }) {
  if (!apiKey) {
    const err = new Error('还没有配置语音识别使用的 API Key');
    err.code = 'NO_API_KEY';
    throw err;
  }
  if (!baseUrl) {
    const err = new Error('还没有配置语音识别使用的 API 地址');
    err.code = 'NO_BASE_URL';
    throw err;
  }
  if (!buffer || !buffer.length) {
    throw new Error('没有收到录音数据');
  }
  const url = `${baseUrl.replace(/\/+$/, '')}/audio/transcriptions`;
  const json = await postMultipart(url, {
    headers: { Authorization: `Bearer ${apiKey}` },
    fields: { model: model || 'whisper-1' },
    fileField: { name: 'file', filename, contentType, data: buffer },
  });
  const text = json && json.text;
  if (!text) throw new Error('没有识别出文字，请再说一次，或者检查该服务是否支持语音转写');
  return text.trim();
}

module.exports = { transcribeAudio };
