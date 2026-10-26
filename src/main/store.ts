import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { HistoryEntry, JobSnapshot } from '../shared/types';

/** Petit stockage JSON local, écrit de façon atomique. Rien n'est envoyé à l'extérieur. */
class JsonFile<T> {
  constructor(private readonly file: string, private readonly fallback: T) {}

  async read(): Promise<T> {
    try {
      return JSON.parse(await readFile(this.file, 'utf8')) as T;
    } catch {
      return structuredClone(this.fallback);
    }
  }

  async write(value: T): Promise<void> {
    await mkdir(path.dirname(this.file), { recursive: true });
    const tmp = `${this.file}.tmp`;
    await writeFile(tmp, JSON.stringify(value, null, 2), 'utf8');
    await rename(tmp, this.file);
  }
}

export interface Settings {
  ffmpegPath: string | null;
  notifySound?: boolean;
}

export class SettingsStore {
  private file: JsonFile<Settings>;
  constructor(dir: string) {
    this.file = new JsonFile(path.join(dir, 'reglages.json'), { ffmpegPath: null });
  }
  read(): Promise<Settings> {
    return this.file.read();
  }
  async update(patch: Partial<Settings>): Promise<Settings> {
    const next = { ...(await this.read()), ...patch };
    await this.file.write(next);
    return next;
  }
}

const MAX_ENTRIES = 40;
const MAX_ITEMS = 1000;

export class HistoryStore {
  private file: JsonFile<HistoryEntry[]>;
  private queue: Promise<unknown> = Promise.resolve();

  constructor(dir: string) {
    this.file = new JsonFile(path.join(dir, 'historique.json'), []);
  }

  read(): Promise<HistoryEntry[]> {
    return this.file.read();
  }

  add(job: JobSnapshot): Promise<HistoryEntry[]> {
    const entry: HistoryEntry = {
      id: job.id,
      kind: job.kind,
      profileLabel: job.profileLabel,
      state: job.state,
      startedAt: job.startedAt,
      finishedAt: job.finishedAt,
      elapsedMs: job.elapsedMs,
      deleteSource: job.deleteSource,
      counts: job.counts,
      items: job.items.slice(0, MAX_ITEMS).map((i) => ({
        source: i.source,
        output: i.status === 'done' ? i.output : null,
        status: i.status,
        message: i.message,
        sourceTrashed: i.sourceTrashed,
      })),
    };
    const run = this.queue.then(async () => {
      const list = await this.read();
      const next = [entry, ...list.filter((e) => e.id !== entry.id)].slice(0, MAX_ENTRIES);
      await this.file.write(next);
      return next;
    });
    this.queue = run.catch(() => undefined);
    return run;
  }

  async clear(): Promise<HistoryEntry[]> {
    await this.file.write([]);
    return [];
  }
}
