import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
fs.rmSync(path.join(root, 'dist'), { recursive: true, force: true });
process.stdout.write('  dist/ removed\n');
