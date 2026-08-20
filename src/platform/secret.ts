// Encryption at rest for the token store.
//
// What is protected and what is not: the OS keystore hands the key to any process running as this
// user, exactly as DPAPI does. So this does not defend against code running as you. What it does
// defend against is the file leaving the machine — a copy, a backup, a synced folder, a stray
// archive — because the key never travels with it.
//
// The key lives in the keystore and the DATA lives in the file, rather than the tokens living in
// the keystore directly, because the platforms cap a credential hard: Windows refuses anything
// over 2560 bytes (measured: 1024 characters stored, 2048 refused), while one refresh token is
// already ~1400. A 32-byte key fits everywhere; an account list never would.
import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { createRequire } from 'node:module';
import path from 'node:path';

const SERVICE = 'ppgraph';
const ALGORITHM = 'aes-256-gcm';

/**
 * One key per store location, not one per machine: `PPGRAPH_HOME` can point two installs at two
 * stores, and a `--logout` in one must not make the other unreadable.
 *
 * Normalised first, because the scope is a path and a path has spellings. `C:\x\tokens.json`,
 * `C:/x/tokens.json` and `C:\X\tokens.json` are one file but three strings, and three strings would
 * be three keys — which surfaces as a store that will not open and a sign-in that will not stick.
 */
function accountFor(scope: string): string {
  const resolved = path.resolve(scope);
  const normalised = process.platform === 'win32' ? resolved.toLowerCase() : resolved;
  return `token-store-key.${createHash('sha256').update(normalised).digest('hex').slice(0, 16)}`;
}

/** Set to keep an unencrypted store on a host with no keystore. Opt-in, never a silent fallback. */
export const PLAINTEXT_ENV = 'PPGRAPH_ALLOW_PLAINTEXT_TOKENS';

/** Set to ignore the OS keystore entirely, as if this host had none. */
export const NO_KEYSTORE_ENV = 'PPGRAPH_NO_KEYSTORE';

export interface Sealed {
  iv: string;
  tag: string;
  data: string;
}

interface KeyringEntry {
  getPassword(): string | null;
  setPassword(password: string): void;
  deletePassword(): boolean;
}

type KeyringModule = { Entry: new (service: string, account: string) => KeyringEntry };

const entries = new Map<string, KeyringEntry | null>();
const keys = new Map<string, Buffer | null>();

/**
 * Loaded lazily and optionally: the package ships prebuilt binaries per platform, so an
 * unsupported one has no binary at all rather than a broken install. A miss is not an error here
 * — it decides policy one level up.
 *
 * Deliberately `require` rather than `import()`: the binding is CommonJS, and loading it
 * synchronously keeps the token store synchronous, which is the difference between touching two
 * functions and rewriting every caller of them.
 */
function keyring(account: string): KeyringEntry | null {
  const cached = entries.get(account);
  if (cached !== undefined) return cached;
  let entry: KeyringEntry | null;
  try {
    // The no-keystore path is the one that runs on CI and headless Linux, where it cannot be
    // exercised from a machine that has one. This makes it reachable — and doubles as the opt-out
    // for anyone who would rather not have a credential in their keystore at all.
    if (process.env[NO_KEYSTORE_ENV] === '1') throw new Error('keystore disabled');
    const mod = createRequire(import.meta.url)('@napi-rs/keyring') as KeyringModule;
    entry = new mod.Entry(SERVICE, account);
  } catch {
    entry = null;
  }
  entries.set(account, entry);
  return entry;
}

/**
 * The key for this user on this machine, created on first use.
 *
 * `null` means no keystore is reachable — no desktop session on Linux, an unsupported platform, a
 * locked keychain. Callers decide what that means; this never invents a weaker key, because a key
 * derived from machine identifiers would be re-derivable by anyone holding the file.
 */
export function storeKey(scope: string): Buffer | null {
  const account = accountFor(scope);
  const cached = keys.get(account);
  if (cached !== undefined) return cached;
  const remember = (key: Buffer | null): Buffer | null => (keys.set(account, key), key);

  const entry = keyring(account);
  if (!entry) return remember(null);
  try {
    const existing = entry.getPassword();
    if (existing) {
      const key = Buffer.from(existing, 'base64');
      if (key.length === 32) return remember(key);
    }
    const created = randomBytes(32);
    entry.setPassword(created.toString('base64'));
    return remember(created);
  } catch {
    return remember(null);
  }
}

/** Forget the key, so the next store write starts a fresh one. Part of signing out completely. */
export function dropStoreKey(scope: string): void {
  const account = accountFor(scope);
  keys.delete(account);
  try {
    keyring(account)?.deletePassword();
  } catch { /* nothing stored, or the keystore went away — either way there is no key left to us */ }
}

export function seal(plaintext: string, key: Buffer): Sealed {
  const iv = randomBytes(12);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const data = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  return { iv: iv.toString('base64'), tag: cipher.getAuthTag().toString('base64'), data: data.toString('base64') };
}

/** `null` for anything that does not decrypt — a rotated key, a truncated file, a tampered tag. */
export function unseal(sealed: Sealed, key: Buffer): string | null {
  try {
    const decipher = createDecipheriv(ALGORITHM, key, Buffer.from(sealed.iv, 'base64'));
    decipher.setAuthTag(Buffer.from(sealed.tag, 'base64'));
    return Buffer.concat([decipher.update(Buffer.from(sealed.data, 'base64')), decipher.final()]).toString('utf8');
  } catch {
    return null;
  }
}

export const plaintextAllowed = (): boolean => process.env[PLAINTEXT_ENV] === '1';
