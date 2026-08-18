/**
 * 生成 Nibble 的应用图标（assets/icon.png）。
 *
 * 不依赖任何第三方图像库：手写一个最小可用的 PNG 编码器（IHDR + IDAT + IEND），
 * 再用简单的几何图形（圆角方块 + 圆形/椭圆）拼出兔耳兜帽小女孩的头像，
 * 并做 4x4 超采样抗锯齿，保证在托盘等小尺寸下也足够清晰可爱。
 */
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

// ---------- 最小 PNG 编码器 ----------
const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(buf) {
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    crc = CRC_TABLE[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function pngChunk(type, data) {
  const typeBuf = Buffer.from(type, 'ascii');
  const lenBuf = Buffer.alloc(4);
  lenBuf.writeUInt32BE(data.length, 0);
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([lenBuf, typeBuf, data, crcBuf]);
}

function encodePNG(width, height, rgba) {
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdrData = Buffer.alloc(13);
  ihdrData.writeUInt32BE(width, 0);
  ihdrData.writeUInt32BE(height, 4);
  ihdrData[8] = 8; // bit depth
  ihdrData[9] = 6; // color type: RGBA
  ihdrData[10] = 0;
  ihdrData[11] = 0;
  ihdrData[12] = 0;
  const ihdr = pngChunk('IHDR', ihdrData);

  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    const rowStart = y * (stride + 1);
    raw[rowStart] = 0; // no filter
    rgba.copy(raw, rowStart + 1, y * stride, y * stride + stride);
  }
  const idat = pngChunk('IDAT', zlib.deflateSync(raw, { level: 9 }));
  const iend = pngChunk('IEND', Buffer.alloc(0));
  return Buffer.concat([signature, ihdr, idat, iend]);
}

// ---------- 形状测试 ----------
function circle(cx, cy, r) {
  return (x, y) => {
    const dx = x - cx;
    const dy = y - cy;
    return dx * dx + dy * dy <= r * r;
  };
}

function ellipse(cx, cy, rx, ry) {
  return (x, y) => {
    const dx = (x - cx) / rx;
    const dy = (y - cy) / ry;
    return dx * dx + dy * dy <= 1;
  };
}

function roundedSquare(size, radius) {
  const c = size / 2;
  return (x, y) => {
    const dx = Math.max(Math.abs(x - c) - (c - radius), 0);
    const dy = Math.max(Math.abs(y - c) - (c - radius), 0);
    return dx * dx + dy * dy <= radius * radius;
  };
}

function buildScene(size) {
  const f = (v) => v * size; // 比例 -> 像素
  return [
    { test: roundedSquare(size, f(0.22)), color: [246, 217, 137, 255] }, // 奶油黄背景
    { test: ellipse(f(0.16), f(0.62), f(0.13), f(0.24)), color: [42, 36, 32, 255] }, // 左侧发丝
    { test: ellipse(f(0.84), f(0.62), f(0.13), f(0.24)), color: [42, 36, 32, 255] }, // 右侧发丝
    { test: circle(f(0.5), f(0.46), f(0.42)), color: [222, 212, 196, 255] }, // 兜帽描边
    { test: circle(f(0.5), f(0.46), f(0.395)), color: [255, 255, 255, 255] }, // 兜帽主体
    { test: circle(f(0.26), f(0.14), f(0.135)), color: [222, 212, 196, 255] }, // 左耳描边
    { test: circle(f(0.74), f(0.14), f(0.135)), color: [222, 212, 196, 255] }, // 右耳描边
    { test: circle(f(0.26), f(0.14), f(0.115)), color: [255, 255, 255, 255] }, // 左耳
    { test: circle(f(0.74), f(0.14), f(0.115)), color: [255, 255, 255, 255] }, // 右耳
    { test: circle(f(0.26), f(0.15), f(0.062)), color: [244, 199, 203, 255] }, // 左耳内
    { test: circle(f(0.74), f(0.15), f(0.062)), color: [244, 199, 203, 255] }, // 右耳内
    { test: circle(f(0.5), f(0.565), f(0.245)), color: [248, 217, 184, 255] }, // 脸
    { test: circle(f(0.36), f(0.62), f(0.036)), color: [246, 184, 180, 255] }, // 左腮红
    { test: circle(f(0.64), f(0.62), f(0.036)), color: [246, 184, 180, 255] }, // 右腮红
    { test: circle(f(0.41), f(0.565), f(0.024)), color: [43, 35, 32, 255] }, // 左眼
    { test: circle(f(0.59), f(0.565), f(0.024)), color: [43, 35, 32, 255] }, // 右眼
    { test: ellipse(f(0.5), f(0.645), f(0.02), f(0.01)), color: [201, 123, 114, 255] }, // 嘴
  ];
}

function colorAt(scene, x, y) {
  let result = [0, 0, 0, 0];
  for (const shape of scene) {
    if (shape.test(x, y)) result = shape.color;
  }
  return result;
}

function render(size, supersample = 4) {
  const scene = buildScene(size);
  const rgba = Buffer.alloc(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let rSum = 0;
      let gSum = 0;
      let bSum = 0;
      let aSum = 0;
      for (let sy = 0; sy < supersample; sy++) {
        for (let sx = 0; sx < supersample; sx++) {
          const px = x + (sx + 0.5) / supersample;
          const py = y + (sy + 0.5) / supersample;
          const [r, g, b, a] = colorAt(scene, px, py);
          rSum += r * a;
          gSum += g * a;
          bSum += b * a;
          aSum += a;
        }
      }
      const totalSamples = supersample * supersample;
      const aAvg = Math.round(aSum / totalSamples);
      let rAvg = 0;
      let gAvg = 0;
      let bAvg = 0;
      if (aSum > 0) {
        rAvg = Math.round(rSum / aSum);
        gAvg = Math.round(gSum / aSum);
        bAvg = Math.round(bSum / aSum);
      }
      const offset = (y * size + x) * 4;
      rgba[offset] = rAvg;
      rgba[offset + 1] = gAvg;
      rgba[offset + 2] = bAvg;
      rgba[offset + 3] = aAvg;
    }
  }
  return rgba;
}

function main() {
  const size = 256;
  const rgba = render(size, 4);
  const png = encodePNG(size, size, rgba);
  const outDir = path.join(__dirname, '..', 'assets');
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
  const outPath = path.join(outDir, 'icon.png');
  fs.writeFileSync(outPath, png);
  console.log(`已生成图标: ${outPath}`);
}

main();
