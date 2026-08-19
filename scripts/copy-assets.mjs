// Finishes the browser half of the build:
//   1. copies the stylesheet next to the compiled viewer
//   2. makes the compiled viewer safe to inline in a classic <script> tag
//
// Kept as a script rather than a shell command so `pnpm build` behaves the same on every OS.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

fs.mkdirSync(path.join(root, 'dist/viewer'), { recursive: true });
fs.copyFileSync(path.join(root, 'src/viewer/viewer.css'), path.join(root, 'dist/viewer/viewer.css'));
process.stdout.write('  src/viewer/viewer.css → dist/viewer/viewer.css\n');

/*
 * The viewer is inlined into the generated HTML as a CLASSIC script, so a single top-level
 * `import`/`export` would be a syntax error in the browser. viewer.ts only ever imports TYPES,
 * which tsc erases — but `isolatedModules` still appends a bare `export {};` to keep the file a
 * module. That marker is stripped here, and then the result is CHECKED: relying on a compiler
 * detail without verifying it is how this breaks silently on the next TypeScript release.
 */
const viewerPath = path.join(root, 'dist/viewer/viewer.js');
const source = fs.readFileSync(viewerPath, 'utf8');
const stripped = source.replace(/^\s*export\s*\{\s*\}\s*;?\s*$/gm, '');

const offenders = stripped
  .split('\n')
  .map((line, index) => ({ line: line.trim(), number: index + 1 }))
  .filter(({ line }) => /^(import|export)\b/.test(line));

if (offenders.length > 0) {
  process.stderr.write('\n  The compiled viewer contains module syntax and cannot be inlined:\n');
  for (const { line, number } of offenders) process.stderr.write(`    line ${number}: ${line}\n`);
  process.stderr.write('  Only `import type` is allowed in src/viewer/viewer.ts.\n\n');
  process.exit(1);
}

fs.writeFileSync(viewerPath, stripped.trimEnd() + '\n', 'utf8');
process.stdout.write('  dist/viewer/viewer.js  — inlinable, no module syntax\n');
