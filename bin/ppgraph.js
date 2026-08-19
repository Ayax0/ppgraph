#!/usr/bin/env node
/*
 * Launcher for running ppgraph straight out of a checkout, where `dist/` is build output and is
 * not committed. It exists for one reason: a missing build should say so in one line instead of
 * throwing ERR_MODULE_NOT_FOUND at somebody who has never seen this package before.
 *
 * The published package does not ship this file — `package.json#bin` points at `dist/cli.js`,
 * which is always present in the tarball.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const entry = path.join(root, 'dist', 'cli.js');

if (!fs.existsSync(entry)) {
  process.stderr.write('\n  ppgraph has not been built yet. Run once:\n\n'
    + `    cd ${path.relative(process.cwd(), root).replace(/\\/g, '/') || '.'}\n`
    + '    pnpm install\n'
    + '    pnpm build\n\n');
  process.exit(1);
}

// Error formatting lives in the package, so a checkout and an installed binary report identically.
const { runCli, reportFatal } = await import(new URL(`file://${entry.replace(/\\/g, '/')}`).href);
await runCli(process.argv.slice(2)).catch((error) => process.exit(reportFatal(error)));
