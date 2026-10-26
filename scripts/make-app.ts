/**
 * Creates "100 Deep.app" (macOS) in the repository root: a clickable app
 * you can keep in the Dock or Applications.  It opens Terminal running
 * "100 Deep.command".  The icon is a Gervais tile (Smaug the Golden,
 * CC BY 3.0) scaled up with nearest-neighbour so its pixels stay crisp.
 *
 *   npm run make-app
 *   node scripts/make-app.ts --icon-only <out.icns>   (icon for the desktop build)
 */
import { execFileSync } from 'node:child_process';
import { chmodSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deflateSync, inflateSync } from 'node:zlib';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const app = join(root, '100 Deep.app');
const ATLAS = join(root, 'engine/lib/tiles/gervais/32x32.png');
// "monster:Smaug the Golden:0x95:0xB2" in graf-dvg.prf -> row 0x15, col 0x32
const ICON_TILE = { row: 0x15, col: 0x32 };

if (process.platform !== 'darwin') {
  console.error('make-app builds a macOS .app; on other systems run scripts/launch.sh');
  process.exit(1);
}

/* ---------------- minimal PNG (8-bit RGBA, non-interlaced) ---------------- */

interface Image { w: number; h: number; px: Uint8Array }

function decodePng(buf: Buffer): Image {
  let pos = 8, w = 0, h = 0;
  const idat: Buffer[] = [];
  while (pos < buf.length) {
    const len = buf.readUInt32BE(pos);
    const type = buf.toString('latin1', pos + 4, pos + 8);
    const data = buf.subarray(pos + 8, pos + 8 + len);
    if (type === 'IHDR') {
      w = data.readUInt32BE(0);
      h = data.readUInt32BE(4);
      if (data[8] !== 8 || data[9] !== 6 || data[12] !== 0) throw new Error('expected 8-bit RGBA non-interlaced PNG');
    } else if (type === 'IDAT') idat.push(data);
    pos += 12 + len;
  }
  const raw = inflateSync(Buffer.concat(idat));
  const px = new Uint8Array(w * h * 4);
  const stride = w * 4;
  for (let y = 0; y < h; y++) {
    const f = raw[y * (stride + 1)];
    const line = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    for (let x = 0; x < stride; x++) {
      const a = x >= 4 ? px[y * stride + x - 4] : 0;
      const b = y > 0 ? px[(y - 1) * stride + x] : 0;
      const c = x >= 4 && y > 0 ? px[(y - 1) * stride + x - 4] : 0;
      let v = line[x];
      if (f === 1) v += a;
      else if (f === 2) v += b;
      else if (f === 3) v += (a + b) >> 1;
      else if (f === 4) {
        const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
        v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      }
      px[y * stride + x] = v & 0xff;
    }
  }
  return { w, h, px };
}

const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function crc32(b: Buffer): number {
  let c = 0xffffffff;
  for (const byte of b) c = crcTable[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, 'latin1'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
function encodePng(img: Image): Buffer {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(img.w, 0);
  ihdr.writeUInt32BE(img.h, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  const raw = Buffer.alloc((img.w * 4 + 1) * img.h);
  for (let y = 0; y < img.h; y++) {
    raw[y * (img.w * 4 + 1)] = 0;
    Buffer.from(img.px.buffer, img.px.byteOffset + y * img.w * 4, img.w * 4).copy(raw, y * (img.w * 4 + 1) + 1);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0)),
  ]);
}

/* ---------------- icon ---------------- */

function iconImage(atlas: Image, size: number): Image {
  const px = new Uint8Array(size * size * 4);
  const radius = size * 0.2;
  const inset = Math.round(size * 0.08);
  const spriteScale = (size - inset * 2) / 32;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4;
      // Rounded dark square background
      const dx = Math.max(0, Math.abs(x + 0.5 - size / 2) - (size / 2 - radius));
      const dy = Math.max(0, Math.abs(y + 0.5 - size / 2) - (size / 2 - radius));
      if (dx * dx + dy * dy > radius * radius) continue;
      px[i] = 26; px[i + 1] = 18; px[i + 2] = 12; px[i + 3] = 255;
      // Nearest-neighbour sprite on top
      const sx = Math.floor((x - inset) / spriteScale), sy = Math.floor((y - inset) / spriteScale);
      if (sx < 0 || sy < 0 || sx >= 32 || sy >= 32) continue;
      const j = ((ICON_TILE.row * 32 + sy) * atlas.w + ICON_TILE.col * 32 + sx) * 4;
      const a = atlas.px[j + 3] / 255;
      if (a <= 0) continue;
      for (let k = 0; k < 3; k++) px[i + k] = Math.round(atlas.px[j + k] * a + px[i + k] * (1 - a));
    }
  }
  return { w: size, h: size, px };
}

/* ---------------- bundle ---------------- */

const iconOnly = process.argv.indexOf('--icon-only');
const iconOut = iconOnly >= 0 ? resolve(process.argv[iconOnly + 1] ?? join(root, 'build/icon.icns')) : join(app, 'Contents/Resources/AppIcon.icns');

if (iconOnly < 0) {
  rmSync(app, { recursive: true, force: true });
  mkdirSync(join(app, 'Contents/MacOS'), { recursive: true });
  mkdirSync(join(app, 'Contents/Resources'), { recursive: true });
}

const atlas = decodePng(readFileSync(ATLAS));
const iconset = join(root, 'build/AppIcon.iconset');
rmSync(iconset, { recursive: true, force: true });
mkdirSync(iconset, { recursive: true });
for (const s of [16, 32, 128, 256, 512]) {
  writeFileSync(join(iconset, `icon_${s}x${s}.png`), encodePng(iconImage(atlas, s)));
  writeFileSync(join(iconset, `icon_${s}x${s}@2x.png`), encodePng(iconImage(atlas, s * 2)));
}
mkdirSync(dirname(iconOut), { recursive: true });
execFileSync('iconutil', ['-c', 'icns', iconset, '-o', iconOut]);
if (iconOnly >= 0) {
  console.log(`Created ${iconOut}`);
  process.exit(0);
}

writeFileSync(join(app, 'Contents/Info.plist'), `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleName</key><string>100 Deep</string>
  <key>CFBundleDisplayName</key><string>100 Deep</string>
  <key>CFBundleIdentifier</key><string>local.hundreddeep.launcher</string>
  <key>CFBundleVersion</key><string>0.1.0</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>CFBundleExecutable</key><string>launcher</string>
  <key>CFBundleIconFile</key><string>AppIcon</string>
  <key>LSMinimumSystemVersion</key><string>11.0</string>
</dict>
</plist>
`);

// The repository path is recorded so the app keeps working when moved to
// Applications or the Dock; if the repo moves, rerun "npm run make-app".
const exec = join(app, 'Contents/MacOS/launcher');
writeFileSync(exec, `#!/bin/sh
REPO=${JSON.stringify(root)}
if [ ! -f "$REPO/100 Deep.command" ]; then
  REPO="$(cd "$(dirname "$0")/../../.." && pwd)"
fi
if [ ! -f "$REPO/100 Deep.command" ]; then
  osascript -e 'display alert "100 Deep" message "Cannot find the game folder. Run npm run make-app again from the repository."'
  exit 1
fi
open -a Terminal "$REPO/100 Deep.command"
`);
chmodSync(exec, 0o755);
console.log(`Created ${app}`);
console.log('Double-click it, or drag it to the Dock or Applications.');
