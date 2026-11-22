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
