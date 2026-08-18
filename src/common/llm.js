/**
 * 与 OpenAI 兼容的 /chat/completions 接口通信。
 * 只用 Node 内置的 https/http 模块实现，不引入 axios / node-fetch 等依赖，
 * 这样任何兼容 OpenAI 协议的服务商（DeepSeek、Moonshot、通义、OpenAI 官方等）都可以直接用。
 */
const https = require('https');
const http = require('http');
const { URL } = require('url');

function requestJson(urlStr, { method = 'POST', headers = {}, body, timeoutMs = 20000 } = {}) {
  return new Promise((resolve, reject) => {
    let target;
    try {
      target = new URL(urlStr);
    } catch (err) {
      reject(new Error('接口地址不合法，请检查设置中的 API 地址'));
      return;
    }
    const lib = target.protocol === 'http:' ? http : https;
    const payload = body ? Buffer.from(JSON.stringify(body)) : null;

    const req = lib.request(
      {
        hostname: target.hostname,
        port: target.port || (target.protocol === 'http:' ? 80 : 443),
        path: target.pathname + target.search,
        method,
        headers: {
          'Content-Type': 'application/json',
          ...(payload ? { 'Content-Length': payload.length } : {}),
          ...headers,
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
    if (payload) req.write(payload);
    req.end();
  });
}

/**
 * @param {object} options
 * @param {string} options.baseUrl 形如 https://api.deepseek.com/v1
 * @param {string} options.apiKey
 * @param {string} options.model
 * @param {Array<{role: string, content: string}>} options.messages
 */
async function chatCompletion({ baseUrl, apiKey, model, messages, temperature = 0.85, maxTokens = 350 }) {
  if (!apiKey) {
    const err = new Error('还没有配置 API Key');
    err.code = 'NO_API_KEY';
    throw err;
  }
  if (!baseUrl) {
    const err = new Error('还没有配置 API 地址');
    err.code = 'NO_BASE_URL';
    throw err;
  }
  const url = `${baseUrl.replace(/\/+$/, '')}/chat/completions`;
  const json = await requestJson(url, {
    headers: { Authorization: `Bearer ${apiKey}` },
    body: {
      model,
      messages,
      temperature,
      max_tokens: maxTokens,
    },
  });
  const content = json && json.choices && json.choices[0] && json.choices[0].message && json.choices[0].message.content;
  if (!content) {
    throw new Error('AI 没有返回有效内容，请检查模型名称是否正确');
  }
  return content.trim();
}

module.exports = { chatCompletion };
