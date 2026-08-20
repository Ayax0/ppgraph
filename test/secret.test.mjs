// Encryption at rest for the token store.
//
// ⚠ Every test here works in a throwaway `PPGRAPH_HOME`, and the store key is scoped to the store
// path, so nothing in this file can reach the key protecting a real sign-in. Keep it that way: an
// unscoped `forgetTokens()` while `PPGRAPH_HOME` is not set would log the developer out.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomBytes } from 'node:crypto';

const { seal, unseal, storeKey, dropStoreKey, plaintextAllowed, PLAINTEXT_ENV, NO_KEYSTORE_ENV } =
  await import('../dist/platform/secret.js');

const KEY = randomBytes(32);

/** A store path nothing else uses. Nothing is created on disk until a key is asked for. */
const scope = () => path.join(os.tmpdir(), `ppgraph-test-${randomBytes(8).toString('hex')}`, 'tokens.json');

/** Whether this host has a keystore at all — headless Linux and CI do not, and must still pass. */
const probe = scope();
const HAS_KEYSTORE = storeKey(probe) !== null;
dropStoreKey(probe);

test('sealing round-trips, and the ciphertext does not carry the plaintext', () => {
  const secret = JSON.stringify({ accounts: [{ refreshToken: `rt.${'x'.repeat(1400)}` }] });
  const sealed = seal(secret, KEY);
  assert.equal(unseal(sealed, KEY), secret);
  assert.ok(!Buffer.from(sealed.data, 'base64').toString('utf8').includes('rt.'));
});

test('the same plaintext seals differently every time', () => {
  const a = seal('same', KEY);
  const b = seal('same', KEY);
  assert.notEqual(a.iv, b.iv);
  assert.notEqual(a.data, b.data);
});

// The point of the whole exercise: a copied file is useless without the key that stayed behind.
test('a wrong key opens nothing', () => {
  assert.equal(unseal(seal('secret', KEY), randomBytes(32)), null);
});

test('tampering is refused rather than half-decrypted', () => {
  const sealed = seal('secret', KEY);
  assert.equal(unseal({ ...sealed, tag: Buffer.alloc(16).toString('base64') }, KEY), null);
  assert.equal(unseal({ ...sealed, data: Buffer.from('nope').toString('base64') }, KEY), null);
  assert.equal(unseal({ ...sealed, iv: Buffer.alloc(12).toString('base64') }, KEY), null);
});

test('a key is created once, returned unchanged, and gone once dropped', { skip: !HAS_KEYSTORE }, () => {
  const s = scope();
  try {
    const first = storeKey(s);
    assert.equal(first.length, 32);
    assert.equal(Buffer.compare(storeKey(s), first), 0);
    dropStoreKey(s);
    assert.notEqual(Buffer.compare(storeKey(s), first), 0, 'a dropped key must not come back');
  } finally {
    dropStoreKey(s);
  }
});

// The trap this closes: one file spelled three ways would be three keys, and the symptom is a
// sign-in that never sticks — hard to connect back to a path separator.
test('one file spelled differently is still one key', { skip: !HAS_KEYSTORE }, () => {
  const dir = path.join(os.tmpdir(), `ppgraph-test-${randomBytes(8).toString('hex')}`);
  const canonical = path.join(dir, 'tokens.json');
  try {
    const key = storeKey(canonical);
    for (const spelling of [
      canonical.split(path.sep).join('/'),
      path.join(dir, '.', 'tokens.json'),
      path.join(dir, 'sub', '..', 'tokens.json'),
      ...(process.platform === 'win32' ? [canonical.toUpperCase()] : []),
    ]) {
      assert.equal(Buffer.compare(storeKey(spelling), key), 0, spelling);
    }
  } finally {
    dropStoreKey(canonical);
  }
});

test('two store locations get two keys', { skip: !HAS_KEYSTORE }, () => {
  const a = scope();
  const b = scope();
  try {
    assert.notEqual(Buffer.compare(storeKey(a), storeKey(b)), 0);
  } finally {
    dropStoreKey(a);
    dropStoreKey(b);
  }
});

test('plaintext is opt-in, and only the exact value counts', () => {
  const before = process.env[PLAINTEXT_ENV];
  try {
    delete process.env[PLAINTEXT_ENV];
    assert.equal(plaintextAllowed(), false);
    process.env[PLAINTEXT_ENV] = 'true';
    assert.equal(plaintextAllowed(), false, 'a stray value must not weaken the store');
    process.env[PLAINTEXT_ENV] = '1';
    assert.equal(plaintextAllowed(), true);
  } finally {
    if (before === undefined) delete process.env[PLAINTEXT_ENV];
    else process.env[PLAINTEXT_ENV] = before;
  }
});

// --- the store itself, through a throwaway PPGRAPH_HOME ----------------------------------------

const auth = await import('../dist/platform/auth.js');

const V1 = {
  version: 1,
  accounts: [{
    tenantId: '00000000-0000-0000-0000-0000000000aa',
    aliases: ['contoso.onmicrosoft.com'],
    clientId: '04b07795-8ddb-461a-bbee-02f9e1bf7b46',
    oid: '00000000-0000-0000-0000-0000000000bb',
    upn: 'someone@contoso.onmicrosoft.com',
    refreshToken: `rt.${'x'.repeat(1400)}`,
    obtainedAt: '2026-01-01T00:00:00.000Z',
  }],
};

/** `dataHome()` reads the variable on every call, so setting it around the body is enough. */
function withHome(run) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'ppgraph-home-'));
  const file = path.join(home, 'tokens.json');
  const before = process.env['PPGRAPH_HOME'];
  process.env['PPGRAPH_HOME'] = home;
  try {
    run(file);
  } finally {
    dropStoreKey(file);
    if (before === undefined) delete process.env['PPGRAPH_HOME'];
    else process.env['PPGRAPH_HOME'] = before;
    fs.rmSync(home, { recursive: true, force: true });
  }
}

/** Removing a tenant that is not stored changes nothing, but it does force one write. */
const touch = () => auth.forgetTokens({ tenantId: '00000000-0000-0000-0000-0000000000ff' });

test('a v1 store still reads — upgrading signs nobody out', () => {
  withHome((file) => {
    fs.writeFileSync(file, JSON.stringify(V1));
    assert.deepEqual(auth.storedTenants().map((t) => t.upn), ['someone@contoso.onmicrosoft.com']);
  });
});

test('the next write seals it, and the refresh token leaves the clear', { skip: !HAS_KEYSTORE }, () => {
  withHome((file) => {
    fs.writeFileSync(file, JSON.stringify(V1));
    touch();

    const onDisk = JSON.parse(fs.readFileSync(file, 'utf8'));
    assert.equal(onDisk.version, 2);
    assert.ok(!JSON.stringify(onDisk).includes('rt.'));
    assert.deepEqual(auth.storedTenants().map((t) => t.upn), ['someone@contoso.onmicrosoft.com']);
  });
});

test('a sealed store is unreadable once its key is gone — the copied-file case', { skip: !HAS_KEYSTORE }, () => {
  withHome((file) => {
    fs.writeFileSync(file, JSON.stringify(V1));
    touch();
    dropStoreKey(file);
    assert.deepEqual(auth.storedTenants(), []);
  });
});

test('signing out of everything takes the key with it', { skip: !HAS_KEYSTORE }, () => {
  withHome((file) => {
    fs.writeFileSync(file, JSON.stringify(V1));
    touch();
    auth.forgetTokens();
    assert.equal(fs.existsSync(file), false);
    assert.equal(storeKey(file) === null, false, 'a fresh key may be minted, but it must be a new one');
  });
});

/** The path CI and headless Linux take. Forced, so it is covered from a host that has a keystore. */
function withoutKeystore(run) {
  const before = process.env[NO_KEYSTORE_ENV];
  process.env[NO_KEYSTORE_ENV] = '1';
  try {
    run();
  } finally {
    if (before === undefined) delete process.env[NO_KEYSTORE_ENV];
    else process.env[NO_KEYSTORE_ENV] = before;
  }
}

test('without a keystore, nothing is persisted — a sign-in is cheaper than a leaked token', () => {
  withoutKeystore(() => withHome((file) => {
    assert.equal(storeKey(file), null);
    fs.writeFileSync(file, JSON.stringify(V1));
    touch();
    assert.equal(fs.existsSync(file), false, 'the store must be removed, not left behind unsealed');
  }));
});

test('without a keystore, plaintext is written only when it was asked for', () => {
  withoutKeystore(() => withHome((file) => {
    const before = process.env[PLAINTEXT_ENV];
    process.env[PLAINTEXT_ENV] = '1';
    try {
      fs.writeFileSync(file, JSON.stringify(V1));
      touch();
      assert.equal(JSON.parse(fs.readFileSync(file, 'utf8')).version, 1);
      assert.deepEqual(auth.storedTenants().map((t) => t.upn), ['someone@contoso.onmicrosoft.com']);
    } finally {
      if (before === undefined) delete process.env[PLAINTEXT_ENV];
      else process.env[PLAINTEXT_ENV] = before;
    }
  }));
});
