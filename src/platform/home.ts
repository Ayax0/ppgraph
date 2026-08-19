// Where this tool keeps things on the machine it runs on. One function so the token store and the
// default report location share a directory, and `PPGRAPH_HOME` moves both at once.
import path from 'node:path';
import os from 'node:os';

export function dataHome(): string {
  if (process.env['PPGRAPH_HOME']) return process.env['PPGRAPH_HOME'];
  if (process.platform === 'win32') {
    return path.join(process.env['LOCALAPPDATA'] ?? path.join(os.homedir(), 'AppData', 'Local'), 'ppgraph');
  }
  return path.join(process.env['XDG_DATA_HOME'] ?? path.join(os.homedir(), '.local', 'share'), 'ppgraph');
}
