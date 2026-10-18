/* 生成应用图标：纯 Node 实现 PNG 编码，无第三方依赖
 * 输出 res/icon.png（256x256）
 * 图案：蓝底圆角方块 + 白色处方笺 + 十字标记
 */
const fs = require("fs");
const path = require("path");
const zlib = require("zlib");

const S = 256;
const px = Buffer.alloc(S * S * 4, 0);

function set(x, y, r, g, b, a) {
  if (x < 0 || y < 0 || x >= S || y >= S) return;
  const i = (y * S + x) * 4;
  const na = a / 255;
  px[i] = Math.round(px[i] * (1 - na) + r * na);
  px[i + 1] = Math.round(px[i + 1] * (1 - na) + g * na);
  px[i + 2] = Math.round(px[i + 2] * (1 - na) + b * na);
  px[i + 3] = Math.max(px[i + 3], a);
}

/* 圆角矩形内部判定 */
function inRoundRect(x, y, x0, y0, w, h, rad) {
  if (x < x0 || y < y0 || x >= x0 + w || y >= y0 + h) return false;
  const cx = Math.min(Math.max(x, x0 + rad), x0 + w - rad);
  const cy = Math.min(Math.max(y, y0 + rad), y0 + h - rad);
  const dx = x - cx, dy = y - cy;
  return dx * dx + dy * dy <= rad * rad;
}

const BLUE = [22, 103, 184];
const BLUE_D = [13, 77, 140];
const WHITE = [255, 255, 255];
const RED = [226, 60, 60];

/* 4x 超采样绘制 */
for (let y = 0; y < S; y++) {
  for (let x = 0; x < S; x++) {
    let r = 0, g = 0, b = 0, a = 0;
    for (let sy = 0; sy < 4; sy++) {
      for (let sx = 0; sx < 4; sx++) {
        const fx = x * 4 + sx + 0.5, fy = y * 4 + sy + 0.5;
        /* 外层圆角蓝底 */
        let cr = 0, cg = 0, cb = 0, ca = 0;
        if (inRoundRect(fx, fy, 8, 8, 240, 240, 52)) {
          /* 垂直渐变 */
          const t = (fy - 8) / 240;
          cr = Math.round(BLUE_D[0] + (BLUE[0] - BLUE_D[0]) * t);
          cg = Math.round(BLUE_D[1] + (BLUE[1] - BLUE_D[1]) * t);
          cb = Math.round(BLUE_D[2] + (BLUE[2] - BLUE_D[2]) * t);
          ca = 255;

          /* 处方笺：白色圆角纸 */
          if (inRoundRect(fx, fy, 52, 40, 152, 176, 12)) {
            cr = WHITE[0]; cg = WHITE[1]; cb = WHITE[2]; ca = 255;
            /* 顶部红色标题条 */
            if (inRoundRect(fx, fy, 66, 56, 124, 16, 5)) {
              cr = RED[0]; cg = RED[1]; cb = RED[2];
            }
            /* 文本线 */
            for (let ln = 0; ln < 4; ln++) {
              const ly = 96 + ln * 26;
              if (ln === 3) {
                if (inRoundRect(fx, fy, 66, ly, 76, 10, 5)) {
                  cr = BLUE_D[0]; cg = BLUE_D[1]; cb = BLUE_D[2];
                }
              } else if (inRoundRect(fx, fy, 66, ly, 124, 10, 5)) {
                cr = 200; cg = 214; cb = 230;
              }
            }
            /* 右下角十字（医疗标识） */
            if (inRoundRect(fx, fy, 148, 140, 46, 12, 4) ||
                inRoundRect(fx, fy, 165, 123, 12, 46, 4)) {
              cr = RED[0]; cg = RED[1]; cb = RED[2];
            }
          }
        }
        r += cr; g += cg; b += cb; a += ca;
      }
    }
    const n = 16;
    const i = (y * S + x) * 4;
    px[i] = Math.round(r / n);
    px[i + 1] = Math.round(g / n);
    px[i + 2] = Math.round(b / n);
    px[i + 3] = Math.round(a / n);
  }
}

/* ---------- PNG 编码 ---------- */
function crc32(buf) {
  let c, table = crc32.t;
  if (!table) {
    table = crc32.t = [];
    for (let n = 0; n < 256; n++) {
      c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      table[n] = c >>> 0;
    }
  }
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) crc = table[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}

/* 逐行加 filter byte 0 */
const raw = Buffer.alloc(S * (S * 4 + 1));
for (let y = 0; y < S; y++) {
  raw[y * (S * 4 + 1)] = 0;
  px.copy(raw, y * (S * 4 + 1) + 1, y * S * 4, (y + 1) * S * 4);
}

const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(S, 0);
ihdr.writeUInt32BE(S, 4);
ihdr[8] = 8;   /* bit depth */
ihdr[9] = 6;   /* RGBA */
ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;

const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  chunk("IHDR", ihdr),
  chunk("IDAT", zlib.deflateSync(raw, { level: 9 })),
  chunk("IEND", Buffer.alloc(0))
]);

const out = path.join(__dirname, "res");
fs.mkdirSync(out, { recursive: true });
fs.writeFileSync(path.join(out, "icon.png"), png);
console.log("已生成 res/icon.png", png.length, "bytes", S + "x" + S);