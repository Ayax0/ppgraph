// How the binary starts, and that importing the package starts nothing.
//
// Package managers start the binary through a link (a symlink in `.bin/`, a junction with `npm link`).
// An earlier check in cli.ts guessed from argv whether it was started or imported: through a link it
// exited silently (an MCP host only saw "connection closed"), and for `node app` it crashed the import.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const dist = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'dist');

test('the binary runs when started through a link', (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ppgraph-bin-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  // A junction needs no symlink rights on Windows; elsewhere the type is ignored.
  fs.symlinkSync(dist, path.join(dir, 'dist'), 'junction');
  const run = spawnSync(process.execPath, [path.join(dir, 'dist', 'bin.js'), '--help'], { encoding: 'utf8' });
  assert.equal(run.status, 0, run.stderr);
  assert.match(run.stdout, /ppgraph/);
});

test('importing the package starts nothing, whatever argv holds', () => {
  // `node -e … app`: argv[1] is "app", a path that does not exist — as with `node app` for app.js
  const code = `await import(${JSON.stringify(pathToFileURL(path.join(dist, 'index.js')).href)})`;
  const run = spawnSync(process.execPath, ['--input-type=module', '-e', code, 'app'], { encoding: 'utf8' });
  assert.equal(run.status, 0, run.stderr);
  assert.equal(run.stdout, '');
});
