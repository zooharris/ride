/**
 * Encryption for the sync note in Intervals.icu.
 *
 * The note is encrypted with a random data key (AES-256-GCM) that never leaves
 * the device in the clear. That key is wrapped twice and the two wrappings
 * travel with the note: once under a key derived from the rider's passphrase,
 * once under a key derived from the answer to a question the rider chose. So a
 * new device unlocks the note with the passphrase, or with the answer if the
 * passphrase is forgotten; either way it then holds the data key locally and
 * needs nothing further. The question itself is stored in the clear, so it can
 * be asked; the answer is normalised (case, spacing, punctuation) before use so
 * "Rosie" and "rosie " match. Nothing here is the rider's own data.
 *
 * All of it is the browser's own WebCrypto; no library.
 */

export interface LockEnvelope {
  v: 1;
  question: string;
  /** PBKDF2 iterations for both derivations. */
  iter: number;
  pass: { salt: string; iv: string; wrapped: string };
  answer: { salt: string; iv: string; wrapped: string };
}

export interface SealedNote {
  enc: 1;
  lock: LockEnvelope;
  iv: string;
  data: string;             // base64 ciphertext of the (already gzip+base64) payload
}

const ITER = 300_000;
const te = new TextEncoder();
const td = new TextDecoder();

export function toB64(bytes: ArrayBuffer | Uint8Array): string {
  const u = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let s = '';
  for (const b of u) s += String.fromCharCode(b);
  return btoa(s);
}
export function fromB64(s: string): Uint8Array {
  return Uint8Array.from(atob(s), (ch) => ch.charCodeAt(0));
}

/** How an answer is compared: lower case, letters and digits only, so spelling of spaces and punctuation cannot lock the rider out. */
export function normaliseAnswer(a: string): string {
  return a.toLowerCase().normalize('NFKD').replace(/[^\p{L}\p{N}]/gu, '');
}

async function deriveWrappingKey(secret: string, salt: Uint8Array, iter: number): Promise<CryptoKey> {
  const base = await crypto.subtle.importKey('raw', te.encode(secret), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey({ name: 'PBKDF2', hash: 'SHA-256', salt: salt as BufferSource, iterations: iter }, base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
}

function rand(n: number): Uint8Array { return crypto.getRandomValues(new Uint8Array(n)); }

async function wrap(dataKey: Uint8Array, secret: string, iter: number): Promise<{ salt: string; iv: string; wrapped: string }> {
  const salt = rand(16), iv = rand(12);
  const k = await deriveWrappingKey(secret, salt, iter);
  const wrapped = await crypto.subtle.encrypt({ name: 'AES-GCM', iv: iv as BufferSource }, k, dataKey as BufferSource);
  return { salt: toB64(salt), iv: toB64(iv), wrapped: toB64(wrapped) };
}

async function unwrap(w: { salt: string; iv: string; wrapped: string }, secret: string, iter: number): Promise<Uint8Array | null> {
  try {
    const k = await deriveWrappingKey(secret, fromB64(w.salt), iter);
    const raw = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: fromB64(w.iv) as BufferSource }, k, fromB64(w.wrapped) as BufferSource);
    return new Uint8Array(raw);
  } catch { return null; }
}

/** A fresh data key, as bytes the device keeps (base64 in a local-only setting). */
export function newDataKey(): string { return toB64(rand(32)); }

/** Build the envelope that lets a passphrase or the answer recover the data key. */
export async function makeLock(dataKeyB64: string, passphrase: string, question: string, answer: string): Promise<LockEnvelope> {
  const key = fromB64(dataKeyB64);
  return { v: 1, question: question.trim(), iter: ITER, pass: await wrap(key, passphrase, ITER), answer: await wrap(key, normaliseAnswer(answer), ITER) };
}

/** Try the passphrase against the envelope; the data key if it fits, else null. */
export async function unlockWithPassphrase(lock: LockEnvelope, passphrase: string): Promise<string | null> {
  const k = await unwrap(lock.pass, passphrase, lock.iter);
  return k ? toB64(k) : null;
}

/** Try the answer to the question; the data key if it fits, else null. */
export async function unlockWithAnswer(lock: LockEnvelope, answer: string): Promise<string | null> {
  const k = await unwrap(lock.answer, normaliseAnswer(answer), lock.iter);
  return k ? toB64(k) : null;
}

async function dataCryptoKey(dataKeyB64: string, use: KeyUsage[]): Promise<CryptoKey> {
  return crypto.subtle.importKey('raw', fromB64(dataKeyB64) as BufferSource, { name: 'AES-GCM' }, false, use);
}

/** Seal a payload (the gzip+base64 note body) with the data key, carrying the lock so other devices can open it. */
export async function seal(payload: string, dataKeyB64: string, lock: LockEnvelope): Promise<SealedNote> {
  const iv = rand(12);
  const k = await dataCryptoKey(dataKeyB64, ['encrypt']);
  const data = await crypto.subtle.encrypt({ name: 'AES-GCM', iv: iv as BufferSource }, k, te.encode(payload));
  return { enc: 1, lock, iv: toB64(iv), data: toB64(data) };
}

/** Open a sealed note with the data key; null if the key does not fit. */
export async function open(note: SealedNote, dataKeyB64: string): Promise<string | null> {
  try {
    const k = await dataCryptoKey(dataKeyB64, ['decrypt']);
    const raw = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: fromB64(note.iv) as BufferSource }, k, fromB64(note.data) as BufferSource);
    return td.decode(raw);
  } catch { return null; }
}

/** The note body as stored in Intervals.icu: a sealed envelope is JSON with a marker prefix. */
export const SEALED_PREFIX = 'enc1:';
export function isSealed(body: string): boolean { return body.startsWith(SEALED_PREFIX); }
export function encodeSealed(n: SealedNote): string { return SEALED_PREFIX + JSON.stringify(n); }
export function decodeSealed(body: string): SealedNote { return JSON.parse(body.slice(SEALED_PREFIX.length)) as SealedNote; }
