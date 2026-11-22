/**
 * Reading a ZIP archive straight from a file on the device, a piece at a time, so a whole-account export of several
 * gigabytes is never held in memory at once (Stage 1, 22 Nov 2026). Stored and deflated entries, and ZIP64 for
 * archives past 4 GB.
 */
export interface ZipEntry { name: string; method: number; csize: number; size: number; offset: number }

async function slice(b: Blob, from: number, to: number): Promise<DataView> {
  return new DataView(await b.slice(from, to).arrayBuffer());
}

/** Every entry in the archive, from its central directory. */
export async function zipEntries(b: Blob): Promise<ZipEntry[]> {
  const tailLen = Math.min(b.size, 65557 + 20);
  const tail = await slice(b, b.size - tailLen, b.size);
  let eocd = -1;
  for (let i = tail.byteLength - 22; i >= 0; i--) if (tail.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  if (eocd < 0) throw new Error('This is not a ZIP archive, or it is damaged.');
  let count = tail.getUint16(eocd + 10, true);
  let cdSize = tail.getUint32(eocd + 12, true);
  let cdOff = tail.getUint32(eocd + 16, true);
  // ZIP64: the real figures are in the ZIP64 end record, found through its locator just before.
  if (cdOff === 0xffffffff || count === 0xffff) {
    const loc = eocd - 20;
    if (loc >= 0 && tail.getUint32(loc, true) === 0x07064b50) {
      const at = Number(tail.getBigUint64(loc + 8, true));
      const z = await slice(b, at, at + 56);
      if (z.getUint32(0, true) === 0x06064b50) { count = Number(z.getBigUint64(32, true)); cdSize = Number(z.getBigUint64(40, true)); cdOff = Number(z.getBigUint64(48, true)); }
    }
  }
  const cd = await slice(b, cdOff, cdOff + cdSize);
  const out: ZipEntry[] = [];
  let p = 0;
  const dec = new TextDecoder();
  for (let n = 0; n < count && p + 46 <= cd.byteLength; n++) {
    if (cd.getUint32(p, true) !== 0x02014b50) break;
    const method = cd.getUint16(p + 10, true);
    let csize = cd.getUint32(p + 20, true), size = cd.getUint32(p + 24, true);
    const nl = cd.getUint16(p + 28, true), xl = cd.getUint16(p + 30, true), cl = cd.getUint16(p + 32, true);
    let offset = cd.getUint32(p + 42, true);
    const name = dec.decode(new Uint8Array(cd.buffer, cd.byteOffset + p + 46, nl));
    // ZIP64 extra field: the large sizes and offset, in that order, for those marked 0xffffffff.
    let x = p + 46 + nl;
    const xEnd = x + xl;
    while (x + 4 <= xEnd) {
      const id = cd.getUint16(x, true), len = cd.getUint16(x + 2, true);
      if (id === 0x0001) {
        let q = x + 4;
        if (size === 0xffffffff) { size = Number(cd.getBigUint64(q, true)); q += 8; }
        if (csize === 0xffffffff) { csize = Number(cd.getBigUint64(q, true)); q += 8; }
        if (offset === 0xffffffff) { offset = Number(cd.getBigUint64(q, true)); q += 8; }
      }
      x += 4 + len;
    }
    out.push({ name, method, csize, size, offset });
    p = xEnd + cl;
  }
  return out;
}

/** One entry's contents. */
export async function zipRead(b: Blob, e: ZipEntry): Promise<Uint8Array> {
  const h = await slice(b, e.offset, e.offset + 30);
  const start = e.offset + 30 + h.getUint16(26, true) + h.getUint16(28, true);
  const data = b.slice(start, start + e.csize);
  if (e.method === 0) return new Uint8Array(await data.arrayBuffer());
  if (e.method !== 8) throw new Error(`compressed in a way this app can't open (${e.method})`);
  const stream = data.stream().pipeThrough(new DecompressionStream('deflate-raw'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

let crcTable: Uint32Array | undefined;
/** CRC-32 of some bytes, carried on from an earlier piece. */
export function crc32(bytes: Uint8Array, crc = 0): number {
  if (!crcTable) { crcTable = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; crcTable[n] = c >>> 0; } }
  let c = ~crc >>> 0;
  for (let i = 0; i < bytes.length; i++) c = crcTable[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return ~c >>> 0;
}

/**
 * A ZIP archive of files stored as they are (22 Nov 2026, for the backup): built as a list of pieces, never as one
 * block of memory or one string, so its size is bounded by the device's storage and not by the browser's limits on
 * either. Up to 65,535 entries and 4 GB, the plain ZIP format's own limits; past them it says so.
 */
export function zipStore(entries: Array<{ name: string; data: Uint8Array }>): Blob {
  if (entries.length > 65535) throw new Error('There are more files here than one backup archive can hold.');
  const enc = new TextEncoder();
  const parts: BlobPart[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;
  for (const e of entries) {
    const name = enc.encode(e.name), crc = crc32(e.data), size = e.data.byteLength;
    const local = new DataView(new ArrayBuffer(30));
    local.setUint32(0, 0x04034b50, true); local.setUint16(4, 20, true); local.setUint16(6, 0x0800, true); local.setUint16(8, 0, true);
    local.setUint32(14, crc, true); local.setUint32(18, size, true); local.setUint32(22, size, true); local.setUint16(26, name.length, true);
    parts.push(local.buffer, name as unknown as BlobPart, e.data as unknown as BlobPart);
    const cd = new DataView(new ArrayBuffer(46));
    cd.setUint32(0, 0x02014b50, true); cd.setUint16(4, 20, true); cd.setUint16(6, 20, true); cd.setUint16(8, 0x0800, true); cd.setUint16(10, 0, true);
    cd.setUint32(16, crc, true); cd.setUint32(20, size, true); cd.setUint32(24, size, true); cd.setUint16(28, name.length, true); cd.setUint32(42, offset, true);
    const c = new Uint8Array(46 + name.length); c.set(new Uint8Array(cd.buffer)); c.set(name, 46);
    central.push(c);
    offset += 30 + name.length + size;
    if (offset > 0xfffffff0) throw new Error('This history is larger than one backup archive can hold (4 GB).');
  }
  const cdSize = central.reduce((n, c) => n + c.length, 0);
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true); end.setUint16(8, entries.length, true); end.setUint16(10, entries.length, true); end.setUint32(12, cdSize, true); end.setUint32(16, offset, true);
  return new Blob([...parts, ...(central as unknown as BlobPart[]), end.buffer], { type: 'application/zip' });
}
