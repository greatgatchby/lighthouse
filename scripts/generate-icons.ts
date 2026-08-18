import { deflateSync } from "node:zlib";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

// Dependency-free PWA icon generator: draws a simple lighthouse beacon into a
// raw RGBA buffer and hand-encodes a PNG. Deep harbour navy + amber beacon.

const INK = [11, 18, 32, 255] as const;
const TOWER = [238, 242, 251, 255] as const;
const TOWER_SHADE = [198, 207, 226, 255] as const;
const BEACON = [245, 185, 66, 255] as const;
const BEAM = [245, 185, 66, 70] as const;
const SEA = [79, 209, 197, 255] as const;

function crc32(buf: Buffer): number {
  let table = crc32table;
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) crc = (crc >>> 8) ^ table[(crc ^ buf[i]) & 0xff];
  return (crc ^ 0xffffffff) >>> 0;
}
const crc32table = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function chunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

function encodePng(size: number, rgba: Uint8Array): Buffer {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // color type RGBA
  const raw = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0; // filter none
    rgba.subarray(y * size * 4, (y + 1) * size * 4).forEach((v, i) => {
      raw[y * (size * 4 + 1) + 1 + i] = v;
    });
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

function blend(px: Uint8Array, i: number, color: readonly number[]) {
  const a = color[3] / 255;
  px[i] = Math.round(color[0] * a + px[i] * (1 - a));
  px[i + 1] = Math.round(color[1] * a + px[i + 1] * (1 - a));
  px[i + 2] = Math.round(color[2] * a + px[i + 2] * (1 - a));
  px[i + 3] = 255;
}

function draw(size: number, maskable: boolean): Uint8Array {
  const px = new Uint8Array(size * size * 4);
  const s = (v: number) => v * size; // unit → px
  // maskable icons need ~20% safe zone, so shrink the artwork
  const scale = maskable ? 0.72 : 0.88;
  const cx = 0.5;
  const towerTopY = 0.5 - 0.26 * scale;
  const towerBotY = 0.5 + 0.3 * scale;
  const lampY = towerTopY - 0.05 * scale;
  const seaY = 0.5 + 0.3 * scale;

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4;
      const u = x / size;
      const v = y / size;
      // background
      blend(px, i, INK);
      // light beams: two cones from the lamp, fading with distance.
      // Flat-opacity amber over navy mixes to a muddy olive, so the alpha has
      // to fall off or the beams read as a solid bowtie.
      const dy = v - lampY;
      const dxl = u - cx;
      const spread = Math.abs(dxl);
      if (Math.abs(dy) < 0.045 * scale + spread * 0.3 && spread > 0.09 * scale) {
        const reach = 0.46 * scale;
        const falloff = Math.max(0, 1 - spread / reach);
        if (falloff > 0) {
          blend(px, i, [BEAM[0], BEAM[1], BEAM[2], Math.round(96 * falloff * falloff)]);
        }
      }
      // sea line
      if (v > seaY && v < seaY + 0.02 * scale && Math.abs(dxl) < 0.34 * scale) {
        blend(px, i, SEA);
      }
      // tower: tapered trapezoid
      if (v >= towerTopY && v <= towerBotY) {
        const t = (v - towerTopY) / (towerBotY - towerTopY);
        const halfWidth = (0.055 + 0.075 * t) * scale;
        if (Math.abs(dxl) <= halfWidth) {
          // horizontal stripes
          const stripe = Math.floor(t * 5) % 2 === 0;
          blend(px, i, stripe ? TOWER : TOWER_SHADE);
        }
      }
      // lamp
      const lampR = 0.075 * scale;
      const dist = Math.hypot(dxl, v - lampY);
      if (dist < lampR) blend(px, i, BEACON);
      // gallery roof
      if (
        v > lampY - 0.13 * scale &&
        v < lampY - 0.07 * scale &&
        Math.abs(dxl) < ((lampY - v) / (0.13 * scale)) * -1 * 0.1 * scale + 0.11 * scale
      ) {
        blend(px, i, TOWER_SHADE);
      }
    }
  }
  return px;
}

const outDir = path.join(process.cwd(), "public", "icons");
mkdirSync(outDir, { recursive: true });
for (const [name, size, maskable] of [
  ["icon-192.png", 192, false],
  ["icon-512.png", 512, false],
  ["maskable-192.png", 192, true],
  ["maskable-512.png", 512, true],
  ["apple-touch-icon.png", 180, true],
] as const) {
  writeFileSync(path.join(outDir, name), encodePng(size, draw(size, maskable)));
  console.log(`wrote public/icons/${name}`);
}
