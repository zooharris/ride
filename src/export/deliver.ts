/**
 * Handing a file to the rider (12 Nov 2026): on a phone or tablet through the device's own share and save sheet,
 * on a computer as a download. Must be called straight from a tap: phones refuse the share sheet otherwise, so a
 * file that takes time to prepare is prepared first and then saved by a second tap.
 */
import type { FileOut } from './formats';

const blobPart = (d: Uint8Array | string): BlobPart => (typeof d === 'string' ? d : (d.buffer.slice(d.byteOffset, d.byteOffset + d.byteLength) as ArrayBuffer));

/** Whether this device saves files through its share sheet (phones and tablets) rather than downloading them. */
export function sharesFiles(): boolean {
  const nav = navigator as Navigator & { canShare?: (d: ShareData) => boolean };
  if (typeof nav.share !== 'function' || typeof nav.canShare !== 'function') return false;
  // A computer's browser may offer sharing too; there a download is what the rider expects.
  return /iPhone|iPad|iPod|Android/i.test(navigator.userAgent) || (navigator.maxTouchPoints > 1 && /Macintosh/.test(navigator.userAgent));
}

/** Save the files. Returns false when the rider closed the share sheet without saving. */
export async function deliver(files: FileOut[]): Promise<boolean> {
  const list = files.map((f) => new File([blobPart(f.data)], f.name, { type: f.mime }));
  if (sharesFiles()) {
    const nav = navigator as Navigator & { canShare: (d: ShareData) => boolean };
    if (nav.canShare({ files: list })) {
      try { await navigator.share({ files: list }); return true; } catch (e) {
        if ((e as Error).name === 'AbortError') return false;
        // Anything else (the tap was too long ago, or the sheet refused): fall through to a download.
      }
    }
  }
  for (const f of list) {
    const url = URL.createObjectURL(f);
    const a = document.createElement('a');
    a.href = url;
    a.download = f.name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 20_000);
  }
  return true;
}
