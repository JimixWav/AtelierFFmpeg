import { spawn, type ChildProcess } from 'node:child_process';

export interface ProgressSample {
  outTimeSec: number | null;
  speed: number | null;
  ended: boolean;
}

/** Analyse le flux `-progress pipe:1` (paires clé=valeur, blocs terminés par `progress=`). */
export class ProgressParser {
  private buffer = '';
  private current: Record<string, string> = {};

  push(chunk: string, onSample: (s: ProgressSample) => void): void {
    this.buffer += chunk;
    let nl: number;
    while ((nl = this.buffer.indexOf('\n')) >= 0) {
      const line = this.buffer.slice(0, nl).trim();
      this.buffer = this.buffer.slice(nl + 1);
      const eq = line.indexOf('=');
      if (eq <= 0) continue;
      const key = line.slice(0, eq);
      const value = line.slice(eq + 1).trim();
      this.current[key] = value;
      if (key === 'progress') {
        onSample(ProgressParser.toSample(this.current));
        this.current = {};
      }
    }
  }

  static toSample(block: Record<string, string>): ProgressSample {
    let t: number | null = null;
    // out_time_us et out_time_ms sont tous deux exprimés en microsecondes.
    const us = Number(block.out_time_us ?? block.out_time_ms);
    if (Number.isFinite(us) && us >= 0) t = us / 1_000_000;
    else if (block.out_time) {
      const m = block.out_time.match(/^(-?\d+):(\d+):(\d+(?:\.\d+)?)$/);
      if (m) t = Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]);
    }
    if (t !== null && t < 0) t = 0;
    const sp = block.speed ? Number(block.speed.replace(/x$/, '')) : NaN;
    return { outTimeSec: t, speed: Number.isFinite(sp) && sp > 0 ? sp : null, ended: block.progress === 'end' };
  }
}

export interface RunHandle {
  done: Promise<{ code: number | null; signal: NodeJS.Signals | null; stderrTail: string; spawnError?: NodeJS.ErrnoException }>;
  pause(): boolean;
  resume(): boolean;
  /** Arrêt propre puis forcé après un délai. */
  stop(): void;
  readonly pid: number | undefined;
}

const TAIL_LINES = 40;

export function runFfmpeg(bin: string, args: string[], onProgress: (s: ProgressSample) => void): RunHandle {
  const child: ChildProcess = spawn(bin, args, { shell: false, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  const parser = new ProgressParser();
  const tail: string[] = [];
  let stderrBuf = '';
  let paused = false;
  let killTimer: NodeJS.Timeout | null = null;

  child.stdout?.setEncoding('utf8');
  child.stderr?.setEncoding('utf8');
  child.stdout?.on('data', (d: string) => parser.push(d, onProgress));
  child.stderr?.on('data', (d: string) => {
    stderrBuf += d;
    const lines = stderrBuf.split(/\r?\n|\r/);
    stderrBuf = lines.pop() ?? '';
    for (const l of lines) {
      if (!l.trim()) continue;
      tail.push(l);
      if (tail.length > TAIL_LINES) tail.shift();
    }
  });

  const done = new Promise<{ code: number | null; signal: NodeJS.Signals | null; stderrTail: string; spawnError?: NodeJS.ErrnoException }>((resolve) => {
    let spawnError: NodeJS.ErrnoException | undefined;
    child.on('error', (e: NodeJS.ErrnoException) => {
      spawnError = e;
    });
    child.on('close', (code, signal) => {
      if (killTimer) clearTimeout(killTimer);
      if (stderrBuf.trim()) tail.push(stderrBuf);
      resolve({ code, signal, stderrTail: tail.join('\n'), spawnError });
    });
  });

  return {
    done,
    get pid() {
      return child.pid;
    },
    pause() {
      if (paused || child.exitCode !== null || process.platform === 'win32') return false;
      paused = child.kill('SIGSTOP');
      return paused;
    },
    resume() {
      if (!paused) return false;
      child.kill('SIGCONT');
      paused = false;
      return true;
    },
    stop() {
      if (child.exitCode !== null || child.signalCode !== null) return;
      if (paused) {
        child.kill('SIGCONT');
        paused = false;
      }
      child.kill('SIGTERM');
      killTimer = setTimeout(() => child.kill('SIGKILL'), 4000);
    },
  };
}
