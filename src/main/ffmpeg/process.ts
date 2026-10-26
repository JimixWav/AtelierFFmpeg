import { spawn } from 'node:child_process';

export interface RunResult {
  code: number | null;
  signal: NodeJS.Signals | null;
  stdout: string;
  stderr: string;
  error?: NodeJS.ErrnoException;
}

/**
 * Exécute un binaire avec un tableau d'arguments (jamais via un shell)
 * et renvoie sa sortie. Réservé aux commandes courtes (version, probe…).
 */
export function runCapture(
  bin: string,
  args: string[],
  opts: { timeoutMs?: number; maxBytes?: number; env?: NodeJS.ProcessEnv } = {},
): Promise<RunResult> {
  const { timeoutMs = 20_000, maxBytes = 8 * 1024 * 1024 } = opts;
  return new Promise((resolve) => {
    let stdout = '';
    let stderr = '';
    let settled = false;
    let child;
    try {
      child = spawn(bin, args, { shell: false, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'], ...(opts.env ? { env: opts.env } : {}) });
    } catch (e) {
      resolve({ code: null, signal: null, stdout: '', stderr: '', error: e as NodeJS.ErrnoException });
      return;
    }
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
    }, timeoutMs);
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (d: string) => {
      if (stdout.length < maxBytes) stdout += d;
    });
    child.stderr.on('data', (d: string) => {
      if (stderr.length < maxBytes) stderr += d;
    });
    const finish = (r: RunResult) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(r);
    };
    child.on('error', (error: NodeJS.ErrnoException) => finish({ code: null, signal: null, stdout, stderr, error }));
    child.on('close', (code, signal) => finish({ code, signal, stdout, stderr }));
  });
}

/** Comme runCapture, mais renvoie la sortie standard brute (images). */
export function runBinary(bin: string, args: string[], opts: { timeoutMs?: number; maxBytes?: number } = {}): Promise<Buffer | null> {
  const { timeoutMs = 60_000, maxBytes = 20 * 1024 * 1024 } = opts;
  return new Promise((resolve) => {
    let child;
    try {
      child = spawn(bin, args, { shell: false, windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] });
    } catch {
      resolve(null);
      return;
    }
    const chunks: Buffer[] = [];
    let size = 0;
    const timer = setTimeout(() => child.kill('SIGKILL'), timeoutMs);
    child.stdout.on('data', (d: Buffer) => {
      size += d.length;
      if (size <= maxBytes) chunks.push(d);
    });
    child.on('error', () => {
      clearTimeout(timer);
      resolve(null);
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve(code === 0 && size > 0 && size <= maxBytes ? Buffer.concat(chunks) : null);
    });
  });
}
