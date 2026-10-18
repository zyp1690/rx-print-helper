/* PNG -> ICO 打包（多尺寸）
 * ICO 容器允许直接内嵌 PNG 数据（Vista+ / Win7 均支持）
 * 依赖：make-icon.js 产出的 icon.png，按需缩放
 * 输出：res/icon.ico
 */
const fs = require("fs");
const path = require("path");
const zlib = require("zlib");

const SRC = path.join(__dirname, "res", "icon.png");
const OUT = path.join(__dirname, "res", "icon.ico");
const SIZES = [16, 24, 32, 48, 64, 128, 256];

/* ---------- 解 PNG ---------- */
function decodePNG(buf) {
  if (buf.readUInt32BE(0) !== 0x89504e47) throw new Error("不是 PNG");
  let off = 8, w = 0, h = 0, bitDepth = 8, colorType = 6;
  const idat = [];
  while (off < buf.length) {
    const len = buf.readUInt32BE(off);
    const type = buf.toString("ascii", off + 4, off + 8);
    const data = buf.slice(off + 8, off + 8 + len);
    if (type === "IHDR") {
      w = data.readUInt32BE(0); h = data.readUInt32BE(4);
      bitDepth = data[8]; colorType = data[9];
    } else if (type === "IDAT") idat.push(data);
    else if (type === "IEND") break;
    off += 12 + len;
  }
  if (bitDepth !== 8) throw new Error("仅支持 8bit，当前 " + bitDepth);
  const channels = colorType === 6 ? 4 : colorType === 2 ? 3 : 0;
  if (!channels) throw new Error("不支持的颜色类型 " + colorType);
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const bpp = channels;
  const stride = w * bpp;
  /* 反滤波 */
  const out = Buffer.alloc(w * h * bpp);
  let p = 0;
  for (let y = 0; y < h; y++) {
    const filter = raw[p++];
    const line = raw.slice(p, p + stride); p += stride;
    const cur = out.slice(y * stride, (y + 1) * stride);
    const prev = y > 0 ? out.slice((y - 1) * stride, y * stride) : Buffer.alloc(stride);
    for (let x = 0; x < stride; x++) {
      const a = x >= bpp ? cur[x - bpp] : 0;
      const b = prev[x];
      const c = x >= bpp ? prev[x - bpp] : 0;
      let v = line[x];
      switch (filter) {
        case 1: v += a; break;
        case 2: v += b; break;
        case 3: v += (a + b) >> 1; break;
        case 4: {
          const pp = a + b - c;
          const pa = Math.abs(pp - a), pb = Math.abs(pp - b), pc = Math.abs(pp - c);
          v += (pa <= pb && pa <= pc) ? a : (pb <= pc ? b : c);
          break;
        }
      }
      cur[x] = v & 0xff;
    }
  }
  return { w, h, bpp, data: out };
}

/* ---------- 最近邻缩放 ---------- */
function resize(img, nw, nh) {
  const out = Buffer.alloc(nw * nh * img.bpp);
  for (let y = 0; y < nh; y++) {
    const sy = Math.min(img.h - 1, Math.floor(y * img.h / nh));
    for (let x = 0; x < nw; x++) {
      const sx = Math.min(img.w - 1, Math.floor(x * img.w / nw));
      const si = (sy * img.w + sx) * img.bpp;
      const di = (y * nw + x) * img.bpp;
      for (let c = 0; c < img.bpp; c++) out[di + c] = img.data[si + c];
    }
  }
  return { w: nw, h: nh, bpp: img.bpp, data: out };
}

/* ---------- 编码 PNG ---------- */
function crc32(buf) {
  let table = crc32.t;
  if (!table) {
    table = crc32.t = [];
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      table[n] = c >>> 0;
    }
  }
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) crc = table[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
function encodePNG(img) {
  const { w, h, bpp, data } = img;
  const stride = w * bpp;
  const raw = Buffer.alloc(h * (stride + 1));
  for (let y = 0; y < h; y++) {
    raw[y * (stride + 1)] = 0;
    data.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; ihdr[9] = bpp === 4 ? 6 : 2;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", zlib.deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0))
  ]);
}

/* ---------- 生成 ICO ---------- */
const src = decodePNG(fs.readFileSync(SRC));
const pngs = SIZES.map(s => {
  const r = s === 256 ? src : resize(src, s, s);
  return { size: s, buf: encodePNG(r) };
});

const count = pngs.length;
const header = Buffer.alloc(6);
header.writeUInt16LE(0, 0);            /* reserved */
header.writeUInt16LE(1, 2);            /* type = icon */
header.writeUInt16LE(count, 4);

const dir = Buffer.alloc(16 * count);
let offset = 6 + 16 * count;
pngs.forEach((p, i) => {
  const o = i * 16;
  dir[o] = p.size >= 256 ? 0 : p.size; /* width (0 = 256) */
  dir[o + 1] = p.size >= 256 ? 0 : p.size;
  dir[o + 2] = 0;                      /* colors = 0 */
  dir[o + 3] = 0;                      /* reserved */
  dir.writeUInt16LE(1, o + 4);         /* planes */
  dir.writeUInt16LE(32, o + 6);        /* bpp */
  dir.writeUInt32LE(p.buf.length, o + 8);
  dir.writeUInt32LE(offset, o + 12);
  offset += p.buf.length;
});

fs.writeFileSync(OUT, Buffer.concat([header, dir, ...pngs.map(p => p.buf)]));
console.log("已生成 res/icon.ico，尺寸:", SIZES.join("/"), "共", count, "档");