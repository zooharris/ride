/**
 * Reads breathing back out of a FIT file (Step 3, 30 Oct 2026): the developer
 * fields Tymewear's layout puts on each record (tyme_breath_rate,
 * tyme_tidal_volume, tyme_minute_volume, tyme_inhale_exhale_ratio). Used when
 * Intervals.icu has not turned them into streams: the activity's original file
 * is downloaded and read here. A small, general reader: normal and
 * compressed-timestamp headers, definitions with developer fields, either byte
 * order. Everything else in the file is stepped over.
 */

export interface BreathRecord {
  /** FIT time of the record, seconds. */
  timestamp: number;
  ve?: number;
  br?: number;
  tv?: number;
  ie?: number;
}

export interface FitBreathing {
  records: BreathRecord[];
  /** The developer field names found, in the order their descriptions came. */
  fields: string[];
  /** FIT time of the first record, breathing or not: the activity's second 0. */
  start?: number;
}

interface Def { global: number; little: boolean; fields: Array<{ num: number; size: number; type: number }>; dev: Array<{ num: number; size: number; index: number }> }

const KEY: Record<string, keyof Omit<BreathRecord, 'timestamp'>> = {
  tyme_minute_volume: 've', tyme_breath_rate: 'br', tyme_tidal_volume: 'tv', tyme_inhale_exhale_ratio: 'ie',
};

/** A gzipped file (what Intervals.icu may hand back) is opened first. */
export async function maybeGunzip(bytes: Uint8Array): Promise<Uint8Array> {
  if (bytes[0] !== 0x1f || bytes[1] !== 0x8b || typeof DecompressionStream === 'undefined') return bytes;
  const buf = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
  const stream = new Blob([buf]).stream().pipeThrough(new DecompressionStream('gzip'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

function readNum(v: DataView, at: number, size: number, type: number, little: boolean): number | undefined {
  const base = type & 0x1f;
  if (base === 0x08 && size === 4) { const x = v.getFloat32(at, little); return v.getUint32(at, little) === 0xffffffff || !isFinite(x) ? undefined : x; }
  if (size === 1) { const x = v.getUint8(at); return x === 0xff ? undefined : x; }
  if (size === 2) { const x = v.getUint16(at, little); return x === 0xffff ? undefined : x; }
  if (size === 4) { const x = v.getUint32(at, little); return x === 0xffffffff ? undefined : x; }
  return undefined;
}

function readString(b: Uint8Array, at: number, size: number): string {
  let end = at;
  while (end < at + size && b[end] !== 0) end++;
  return new TextDecoder().decode(b.subarray(at, end));
}

/** The breathing in a FIT file: one entry per record that carries any of it. */
export function readFitBreathing(file: Uint8Array): FitBreathing {
  const v = new DataView(file.buffer, file.byteOffset, file.byteLength);
  if (file.length < 12) return { records: [], fields: [] };
  let start: number | undefined;
  const headerSize = file[0];
  const dataSize = v.getUint32(4, true);
  const end = Math.min(file.length, headerSize + dataSize);
  const defs = new Map<number, Def>();
  // Developer fields by `${index}:${number}`: their names and base types, from field_description messages.
  const devNames = new Map<string, { name: string; type: number }>();
  const fields: string[] = [];
  const records: BreathRecord[] = [];
  let lastTs = 0;
  let p = headerSize;
  while (p < end) {
    const h = file[p++];
    if (h & 0x80) {
      // A compressed-timestamp data message: local type in bits 5-6, an offset in the low 5 bits.
      const local = (h >> 5) & 0x03;
      const offset = h & 0x1f;
      lastTs = (lastTs & ~0x1f) + offset + (offset < (lastTs & 0x1f) ? 0x20 : 0);
      const d = defs.get(local);
      if (!d) break;
      p = readData(d, p, lastTs);
      continue;
    }
    const local = h & 0x0f;
    if (h & 0x40) {
      const little = file[p + 1] === 0;
      const global = little ? v.getUint16(p + 2, true) : v.getUint16(p + 2, false);
      const n = file[p + 4];
      p += 5;
      const fs: Def['fields'] = [];
      for (let i = 0; i < n; i++, p += 3) fs.push({ num: file[p], size: file[p + 1], type: file[p + 2] });
      const dev: Def['dev'] = [];
      if (h & 0x20) { const m = file[p++]; for (let i = 0; i < m; i++, p += 3) dev.push({ num: file[p], size: file[p + 1], index: file[p + 2] }); }
      defs.set(local, { global, little, fields: fs, dev });
      continue;
    }
    const d = defs.get(local);
    if (!d) break;
    p = readData(d, p);
  }
  return { records, fields, start };

  function readData(d: Def, at: number, compressedTs?: number): number {
    const vals = new Map<number, { at: number; size: number; type: number }>();
    for (const f of d.fields) { vals.set(f.num, { at, size: f.size, type: f.type }); at += f.size; }
    const dev: Array<{ key: string; at: number; size: number }> = [];
    for (const f of d.dev) { dev.push({ key: `${f.index}:${f.num}`, at, size: f.size }); at += f.size; }
    const num = (n: number) => { const x = vals.get(n); return x ? readNum(v, x.at, x.size, x.type, d.little) : undefined; };
    if (d.global === 206) {
      // field_description: developer data index, field number, base type, name.
      const idx = num(0), fnum = num(1), type = num(2) ?? 0;
      const nm = vals.get(3);
      if (idx != null && fnum != null && nm) { const name = readString(file, nm.at, nm.size); devNames.set(`${idx}:${fnum}`, { name, type }); fields.push(name); }
    } else if (d.global === 20) {
      const ts = num(253) ?? compressedTs;
      if (ts != null) { lastTs = ts; start ??= ts; }
      const r: BreathRecord = { timestamp: ts ?? lastTs };
      let any = false;
      for (const f of dev) {
        const desc = devNames.get(f.key);
        const key = desc && KEY[desc.name];
        if (!key) continue;
        const x = readNum(v, f.at, f.size, desc.type, d.little);
        if (x != null) { r[key] = x; any = true; }
      }
      if (any) records.push(r);
    } else {
      const ts = num(253);
      if (ts != null) lastTs = ts;
    }
    return at;
  }
}

/**
 * Breathing laid against an activity's time stream (seconds from its start):
 * each second takes the record at that second, if any. Arrays the length of
 * `time`; undefined when the file has no breathing.
 */
export function breathStreams(fb: FitBreathing, time: number[], startTs?: number): { ve: number[]; br: number[]; tv: number[] } | undefined {
  if (!fb.records.length) return undefined;
  const t0 = startTs ?? fb.start ?? fb.records[0].timestamp;
  const at = new Map<number, BreathRecord>();
  for (const r of fb.records) at.set(r.timestamp - t0, r);
  const pick = (k: 've' | 'br' | 'tv') => time.map((t) => { const r = at.get(Math.round(t)); return r?.[k] != null ? Math.round(r[k]! * 100) / 100 : NaN; });
  return { ve: pick('ve'), br: pick('br'), tv: pick('tv') };
}
