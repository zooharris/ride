#!/usr/bin/env node
/**
 * Turns the exercise pictures (1024 px PNGs on white) into the small transparent
 * WebPs the app shows. Run by hand; the output is committed.
 *
 *   node scripts/make-art.mjs <folder with exercises/*.png> [id-pose …]
 *
 * With no ids it does every picture. With ids (e.g. `pallof-b frog-a`) it does
 * those exercises only and leaves the rest as they are. Because an exercise's
 * start and finish are trimmed to one shared box (so they stay at the same
 * scale), naming one pose re-makes its partner too when the partner's PNG is in
 * the folder.
 *
 * Writes public/art/exercises/<id>-<pose>.webp and src/art/exercises.json, the
 * list of what is in that folder after the run.
 */
import sharp from 'sharp';
import { readdirSync, existsSync, mkdirSync, writeFileSync, statSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT_DIR = join(ROOT, 'public/art/exercises');
const LIST = join(ROOT, 'src/art/exercises.json');

const NEAR_WHITE = 237;      // a pixel whose lowest channel is at least this is near-white
const ENCLOSED_SHARE = 0.015; // enclosed near-white regions larger than this share of the picture are cleared too
const ALPHA_MIN = 8;         // trim to pixels more opaque than this
const PAD = 0.05;            // padding on every side, as a share of the trimmed box's longer side
const SIZE = 384;
const QUALITY = 82;

const [, , srcArg, ...wanted] = process.argv;
if (!srcArg) {
  console.error('Usage: node scripts/make-art.mjs <folder with exercises/*.png> [id-pose …]');
  process.exit(1);
}
const srcDir = existsSync(join(srcArg, 'exercises')) ? join(srcArg, 'exercises') : srcArg;
const POSE_FILE = /^(.+)-(a|b)\.png$/;

// Pictures the app does not use, whatever the folder holds. The calf raise's finish
// differs from its start by a heel lift that does not read at tile size (24 Oct).
const SKIP = new Set(['calf-raise-b']);

/** id → { a?: path, b?: path } for every PNG in the source folder. */
const sources = new Map();
for (const f of readdirSync(srcDir)) {
  const m = POSE_FILE.exec(f);
  if (!m) continue;
  const [, id, pose] = m;
  if (SKIP.has(`${id}-${pose}`)) continue;
  if (!sources.has(id)) sources.set(id, {});
  sources.get(id)[pose] = join(srcDir, f);
}

let ids;
if (wanted.length) {
  ids = new Set();
  for (const w of wanted) {
    const m = /^(.+)-(a|b)$/.exec(w);
    if (!m) { console.error(`Not an id-pose: ${w} (expected e.g. pallof-b)`); process.exit(1); }
    if (!sources.get(m[1])?.[m[2]]) { console.error(`No ${w}.png in ${srcDir}`); process.exit(1); }
    ids.add(m[1]);
  }
} else {
  ids = new Set(sources.keys());
}

/** RGBA pixels with the white around the figure cleared. */
async function whiteOut(file) {
  const { data, info } = await sharp(file).removeAlpha().ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const { width: w, height: h } = info;
  const n = w * h;
  const white = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    const p = i * 4;
    if (Math.min(data[p], data[p + 1], data[p + 2]) >= NEAR_WHITE) white[i] = 1;
  }
  // Label the near-white regions (4-connected); clear those touching the edge and the large enclosed ones.
  const seen = new Uint8Array(n);
  const stack = new Int32Array(n);
  const region = new Int32Array(n);
  const limit = ENCLOSED_SHARE * n;
  for (let start = 0; start < n; start++) {
    if (!white[start] || seen[start]) continue;
    let top = 0, count = 0, edge = false;
    stack[top++] = start; seen[start] = 1;
    while (top) {
      const i = stack[--top];
      region[count++] = i;
      const x = i % w, y = (i - x) / w;
      if (x === 0 || y === 0 || x === w - 1 || y === h - 1) edge = true;
      if (x > 0 && white[i - 1] && !seen[i - 1]) { seen[i - 1] = 1; stack[top++] = i - 1; }
      if (x < w - 1 && white[i + 1] && !seen[i + 1]) { seen[i + 1] = 1; stack[top++] = i + 1; }
      if (y > 0 && white[i - w] && !seen[i - w]) { seen[i - w] = 1; stack[top++] = i - w; }
      if (y < h - 1 && white[i + w] && !seen[i + w]) { seen[i + w] = 1; stack[top++] = i + w; }
    }
    if (edge || count > limit) for (let k = 0; k < count; k++) data[region[k] * 4 + 3] = 0;
  }
  return { data, w, h };
}

function box({ data, w, h }) {
  let x0 = w, y0 = h, x1 = -1, y1 = -1;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    if (data[(y * w + x) * 4 + 3] > ALPHA_MIN) {
      if (x < x0) x0 = x; if (x > x1) x1 = x;
      if (y < y0) y0 = y; if (y > y1) y1 = y;
    }
  }
  return x1 < 0 ? undefined : { x0, y0, x1, y1 };
}

const union = (a, b) => !a ? b : !b ? a : { x0: Math.min(a.x0, b.x0), y0: Math.min(a.y0, b.y0), x1: Math.max(a.x1, b.x1), y1: Math.max(a.y1, b.y1) };

async function write(img, b, out) {
  const bw = b.x1 - b.x0 + 1, bh = b.y1 - b.y0 + 1;
  const side = Math.round(Math.max(bw, bh) * (1 + 2 * PAD));
  const crop = await sharp(img.data, { raw: { width: img.w, height: img.h, channels: 4 } })
    .extract({ left: b.x0, top: b.y0, width: bw, height: bh }).png().toBuffer();
  await sharp({ create: { width: side, height: side, channels: 4, background: { r: 255, g: 255, b: 255, alpha: 0 } } })
    .composite([{ input: crop, left: Math.floor((side - bw) / 2), top: Math.floor((side - bh) / 2) }])
    .png().toBuffer()
    .then((buf) => sharp(buf).resize(SIZE, SIZE, { kernel: 'lanczos3' }).webp({ quality: QUALITY, alphaQuality: 100 }).toFile(out));
}

mkdirSync(OUT_DIR, { recursive: true });
mkdirSync(dirname(LIST), { recursive: true });

let done = 0;
for (const id of [...ids].sort()) {
  const src = sources.get(id);
  const imgs = {};
  for (const pose of ['a', 'b']) if (src[pose]) imgs[pose] = await whiteOut(src[pose]);
  const shared = union(imgs.a && box(imgs.a), imgs.b && box(imgs.b));
  if (!shared) { console.warn(`${id}: nothing left after removing white; skipped`); continue; }
  for (const pose of Object.keys(imgs)) {
    await write(imgs[pose], shared, join(OUT_DIR, `${id}-${pose}.webp`));
    done++;
  }
  process.stdout.write(`${id} `);
}

// The list is whatever is in the output folder now, so a partial run keeps the full list.
const list = {};
let bytes = 0;
for (const f of readdirSync(OUT_DIR).sort()) {
  const m = /^(.+)-(a|b)\.webp$/.exec(f);
  if (!m) continue;
  (list[m[1]] ??= []).push(m[2]);
  bytes += statSync(join(OUT_DIR, f)).size;
}
for (const id of Object.keys(list)) list[id].sort();
writeFileSync(LIST, JSON.stringify(list, null, 1) + '\n');
const count = Object.values(list).reduce((s, p) => s + p.length, 0);
console.log(`\n${done} made; ${count} pictures in public/art/exercises, ${(bytes / 1024).toFixed(0)} KB in all (${(bytes / 1024 / count).toFixed(1)} KB each).`);
