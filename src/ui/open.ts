import { spawn } from 'node:child_process';

/**
 * Hand a file or a URL to whatever the desktop opens it with.
 *
 * The Windows branch needs care that the obvious form does not have: `cmd.exe` re-parses its own
 * command line, and `&` separates commands there — so `start "" <authorize-url>` truncates the URL
 * at its first parameter and the browser lands on a broken request. Quoting the target and passing
 * the line verbatim is what stops that; the empty `""` is `start`'s title argument, which it
 * otherwise takes the URL for.
 */
export function openExternal(target: string): void {
  // For headless hosts, build servers and tests. `getToken` still falls back to the device code.
  if (process.env['PPGRAPH_NO_BROWSER']) return;

  const child = process.platform === 'win32'
    ? spawn('cmd', ['/c', 'start', '""', `"${target}"`],
      { windowsVerbatimArguments: true, detached: true, stdio: 'ignore', windowsHide: true })
    : spawn(process.platform === 'darwin' ? 'open' : 'xdg-open', [target],
      { detached: true, stdio: 'ignore' });

  // Nothing waits for a browser, and a machine with no handler must not take the run down with it.
  child.on('error', () => {});
  child.unref();
}
