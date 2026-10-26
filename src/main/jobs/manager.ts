import { randomBytes, randomUUID } from 'node:crypto';
import { mkdir, rename, rm, stat } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { Environment, ItemStatus, JobItem, JobRequest, JobSnapshot, JobState } from '../../shared/types';
import { PlanError } from '../ffmpeg/args';
import { explainFfmpegFailure } from '../ffmpeg/errors';
import { probeFile } from '../ffmpeg/probe';
import { runFfmpeg, type RunHandle } from '../ffmpeg/runner';
import { PARTIAL_MARKER } from '../media/scan';
import { buildCommand, findUniquePath, pathKey, type PreparedEntry, type PreparedPlan } from './planner';

export interface ManagerDeps {
  getEnv: () => Environment;
  /** Place un fichier dans la Corbeille (Electron `shell.trashItem`). */
  trash: (file: string) => Promise<void>;
  onChange: (jobs: JobSnapshot[]) => void;
  onFinished: (job: JobSnapshot) => void;
  /** Remplace le dossier personnel par « ~ » dans les détails copiables. */
  redact?: (text: string) => string;
}

interface InternalItem extends JobItem {
  entry: PreparedEntry | null;
  weight: number;
  outTimeSec: number;
  /** Processus FFmpeg de cet élément (plusieurs peuvent tourner en parallèle). */
  handle: RunHandle | null;
  activeSince: number | null;
  accumulatedMs: number;
}

interface Job {
  snapshot: Omit<JobSnapshot, 'items' | 'counts' | 'snapshotAt' | 'concurrency'>;
  items: InternalItem[];
  req: JobRequest;
  cancelRequested: boolean;
  paused: boolean;
  resumeWaiters: (() => void)[];
  activeSince: number | null;
  accumulatedMs: number;
  speedSamples: number[];
  /** Nombre de conversions simultanées pour cette tâche. */
  concurrency: number;
}

/**
 * Audio : plusieurs fichiers à la fois (l'encodeur MP3 n'utilise qu'un cœur).
 * Vidéo : un à la fois (l'encodeur exploite déjà toute la machine).
 */
export function concurrencyFor(kind: JobRequest['kind']): number {
  if (kind !== 'audio') return 1;
  // Réglage avancé (et tests) : ATELIER_AUDIO_CONCURRENCY=1..8
  const forced = Number(process.env.ATELIER_AUDIO_CONCURRENCY);
  if (Number.isInteger(forced) && forced >= 1 && forced <= 8) return forced;
  return Math.max(1, Math.min(4, Math.floor(os.cpus().length / 2)));
}

const emptyCounts = (): Record<ItemStatus, number> => ({ pending: 0, running: 0, done: 0, skipped: 0, failed: 0, cancelled: 0 });

export class JobManager {
  private jobs: Job[] = [];
  /** Files d'exécution occupées : une tâche audio et une tâche vidéo peuvent tourner en même temps. */
  private busyLanes = new Set<JobRequest['kind']>();
  private emitTimer: NodeJS.Timeout | null = null;

  constructor(private readonly deps: ManagerDeps) {}

  /* ---------------------------------------------------------------- */
  /* API publique                                                      */
  /* ---------------------------------------------------------------- */

  enqueue(plan: PreparedPlan, req: JobRequest): string {
    const id = randomUUID();
    const items: InternalItem[] = plan.prepared.map((e) => {
      const base: InternalItem = {
        id: e.itemId,
        source: e.source,
        name: e.name,
        relDir: e.relDir,
        output: e.output,
        status: 'pending',
        progress: null,
        speed: null,
        etaSec: null,
        elapsedMs: 0,
        durationSec: e.outputDurationSec ?? e.item.probe?.durationSec ?? null,
        message: e.message,
        notes: [...e.notes],
        sizeIn: e.item.size,
        sizeOut: null,
        sourceTrashed: false,
        entry: e,
        weight: e.outputDurationSec ?? e.item.probe?.durationSec ?? 0,
        outTimeSec: 0,
        handle: null,
        activeSince: null,
        accumulatedMs: 0,
      };
      if (e.action === 'skip-exists' || e.action === 'skip-useless') base.status = 'skipped';
      else if (e.action === 'collision') base.status = 'skipped';
      else if (e.action === 'error') base.status = 'failed';
      return base;
    });
    // Poids par défaut pour les fichiers sans durée connue.
    const known = items.filter((i) => i.weight > 0);
    const avg = known.length ? known.reduce((a, b) => a + b.weight, 0) / known.length : 1;
    for (const it of items) if (it.weight <= 0) it.weight = avg;

    this.jobs.push({
      snapshot: {
        id,
        kind: req.kind,
        profileLabel: plan.profileLabel,
        state: 'queued',
        createdAt: Date.now(),
        startedAt: null,
        finishedAt: null,
        elapsedMs: 0,
        currentIndex: -1,
        progress: 0,
        etaSec: null,
        deleteSource: req.deleteSource,
        canPause: process.platform !== 'win32',
      },
      items,
      req,
      cancelRequested: false,
      paused: false,
      resumeWaiters: [],
      activeSince: null,
      accumulatedMs: 0,
      speedSamples: [],
      concurrency: concurrencyFor(req.kind),
    });
    this.emit(true);
    this.pump();
    return id;
  }

  list(): JobSnapshot[] {
    return this.jobs.map((j) => this.toSnapshot(j));
  }

  cancel(id: string): void {
    const job = this.find(id);
    if (!job || this.isFinished(job.snapshot.state)) return;
    job.cancelRequested = true;
    if (job.snapshot.state === 'queued') {
      for (const it of job.items) if (it.status === 'pending') it.status = 'cancelled';
      this.finish(job, 'cancelled');
      return;
    }
    if (job.paused) this.setPaused(job, false);
    for (const it of job.items) it.handle?.stop();
    this.emit(true);
  }

  pause(id: string): void {
    const job = this.find(id);
    if (!job || job.snapshot.state !== 'running' || !job.snapshot.canPause) return;
    this.setPaused(job, true);
  }

  resume(id: string): void {
    const job = this.find(id);
    if (!job || job.snapshot.state !== 'paused') return;
    this.setPaused(job, false);
  }

  clearFinished(): void {
    this.jobs = this.jobs.filter((j) => !this.isFinished(j.snapshot.state));
    this.emit(true);
  }

  isOutputOrSource(p: string): boolean {
    const k = pathKey(p);
    return this.jobs.some((j) => j.items.some((i) => (i.output && pathKey(i.output) === k) || pathKey(i.source) === k));
  }

  hasActiveJobs(): boolean {
    return this.jobs.some((j) => !this.isFinished(j.snapshot.state));
  }

  /** Arrêt de l'application : stoppe FFmpeg et supprime les fichiers partiels. */
  async shutdown(): Promise<void> {
    for (const j of this.jobs) if (!this.isFinished(j.snapshot.state)) this.cancel(j.snapshot.id);
    const pending = this.jobs.flatMap((j) => j.items.map((i) => i.handle?.done)).filter(Boolean);
    await Promise.race([Promise.all(pending), new Promise((r) => setTimeout(r, 5000))]);
  }

  /* ---------------------------------------------------------------- */
  /* Exécution                                                         */
  /* ---------------------------------------------------------------- */

  private find(id: string): Job | undefined {
    return this.jobs.find((j) => j.snapshot.id === id);
  }

  private isFinished(s: JobState): boolean {
    return s === 'done' || s === 'done-with-errors' || s === 'cancelled' || s === 'failed';
  }

  private setPaused(job: Job, paused: boolean): void {
    const now = Date.now();
    if (paused && !job.paused) {
      job.paused = true;
      if (job.activeSince) job.accumulatedMs += now - job.activeSince;
      job.activeSince = null;
      for (const it of job.items) {
        if (!it.handle) continue;
        it.handle.pause();
        if (it.activeSince) it.accumulatedMs += now - it.activeSince;
        it.activeSince = null;
      }
      job.snapshot.state = 'paused';
    } else if (!paused && job.paused) {
      job.paused = false;
      job.activeSince = now;
      for (const it of job.items) {
        if (!it.handle) continue;
        it.handle.resume();
        it.activeSince = now;
      }
      job.snapshot.state = 'running';
      const waiters = job.resumeWaiters.splice(0);
      waiters.forEach((w) => w());
    }
    this.emit(true);
  }

  /**
   * Lance les tâches en attente : une seule à la fois par type (audio / vidéo),
   * dans l'ordre d'arrivée. L'audio (processeur) et la vidéo (encodeur matériel)
   * se partagent donc la machine sans se gêner.
   */
  private pump(): void {
    for (const job of this.jobs) {
      if (job.snapshot.state !== 'queued') continue;
      const lane = job.req.kind;
      if (this.busyLanes.has(lane)) continue;
      this.busyLanes.add(lane);
      void this.runJob(job).finally(() => {
        this.busyLanes.delete(lane);
        this.pump();
      });
    }
  }

  private async runJob(job: Job): Promise<void> {
    const now = Date.now();
    job.snapshot.state = 'running';
    job.snapshot.startedAt = now;
    job.activeSince = now;
    this.emit(true);

    try {
      const queue = job.items.filter((it) => it.status === 'pending');
      let next = 0;
      const worker = async (): Promise<void> => {
        for (;;) {
          if (job.paused) await new Promise<void>((r) => job.resumeWaiters.push(r));
          if (job.cancelRequested) return;
          const item = queue[next++];
          if (!item) return;
          job.snapshot.currentIndex = job.items.indexOf(item);
          await this.runItem(job, item);
        }
      };
      await Promise.all(Array.from({ length: Math.min(job.concurrency, Math.max(1, queue.length)) }, () => worker()));
    } catch (e) {
      job.snapshot.fatalError = `Erreur interne : ${(e as Error).message}`;
      for (const it of job.items) if (it.status === 'pending' || it.status === 'running') it.status = 'failed';
      this.finish(job, 'failed');
      return;
    }

    for (const it of job.items) if (it.status === 'pending') it.status = 'cancelled';
    const failed = job.items.some((i) => i.status === 'failed');
    const state: JobState = job.cancelRequested ? 'cancelled' : failed ? 'done-with-errors' : 'done';
    this.finish(job, state);
  }

  private finish(job: Job, state: JobState): void {
    if (job.activeSince) job.accumulatedMs += Date.now() - job.activeSince;
    job.activeSince = null;
    job.snapshot.state = state;
    job.snapshot.finishedAt = Date.now();
    job.snapshot.elapsedMs = job.accumulatedMs;
    job.snapshot.currentIndex = -1;
    job.snapshot.etaSec = null;
    const snap = this.toSnapshot(job);
    this.emit(true);
    this.deps.onFinished(snap);
  }

  private async runItem(job: Job, item: InternalItem): Promise<void> {
    const env = this.deps.getEnv();
    const entry = item.entry as PreparedEntry;
    const redact = this.deps.redact ?? ((t: string) => t);
    item.status = 'running';
    item.progress = 0;
    item.accumulatedMs = 0;
    item.activeSince = Date.now();
    this.emit(true);

    const fail = (message: string, details?: string) => {
      item.status = 'failed';
      item.message = message;
      if (details) item.errorDetails = redact(details);
    };

    // 1. La source est-elle toujours là ?
    try {
      const st = await stat(item.source);
      if (!st.isFile()) throw new Error('not a file');
    } catch {
      fail('Fichier source introuvable : déplacé, renommé ou disque déconnecté ?');
      this.closeItem(job, item);
      return;
    }

    // 2. Destination finale, revérifiée au moment de l'exécution.
    let finalOut = item.output as string;
    const policy = job.req.collision;
    if (await fileExists(finalOut)) {
      if (policy === 'skip') {
        item.status = 'skipped';
        item.message = 'Déjà présent';
        this.closeItem(job, item);
        return;
      }
      if (policy === 'unique') {
        finalOut = await findUniquePath(finalOut, this.reservedOutputs(job, item));
        item.output = finalOut;
      }
    }

    const outDir = path.dirname(finalOut);
    try {
      await mkdir(outDir, { recursive: true });
    } catch (e) {
      fail(`Impossible de créer le dossier de sortie (${(e as NodeJS.ErrnoException).code ?? 'erreur'}).`, `${outDir}\n${(e as Error).message}`);
      this.closeItem(job, item);
      return;
    }

    const ext = path.extname(finalOut);
    const base = path.basename(finalOut, ext);
    const temp = path.join(outDir, `.${base}${PARTIAL_MARKER}${randomBytes(4).toString('hex')}${ext}`);

    let built;
    try {
      built = buildCommand(entry, job.req, env, temp);
    } catch (e) {
      fail(e instanceof PlanError ? e.message : `Préparation impossible : ${(e as Error).message}`);
      this.closeItem(job, item);
      return;
    }
    if (!env.ffmpegPath) {
      fail('FFmpeg est introuvable. Vérifiez l’installation dans Diagnostic.');
      this.closeItem(job, item);
      return;
    }

    const started = Date.now();
    item.handle = runFfmpeg(env.ffmpegPath, built.args, (s) => {
      if (s.outTimeSec !== null) {
        item.outTimeSec = s.outTimeSec;
        if (item.durationSec) item.progress = Math.min(1, s.outTimeSec / item.durationSec);
      }
      if (s.speed !== null) {
        item.speed = s.speed;
        job.speedSamples.push(s.speed);
        if (job.speedSamples.length > 20) job.speedSamples.shift();
      }
      if (item.durationSec && item.speed && item.outTimeSec >= 0) {
        item.etaSec = Math.max(0, (item.durationSec - item.outTimeSec) / item.speed);
      }
      this.emit();
    });
    // Pause demandée pendant la préparation : on gèle aussitôt ce nouveau processus.
    if (job.paused) {
      item.handle.pause();
      if (item.activeSince) item.accumulatedMs += Date.now() - item.activeSince;
      item.activeSince = null;
    }
    const result = await item.handle.done;
    item.handle = null;

    const commandForDetails = [env.ffmpegPath, ...built.args].map((a) => (/[\s'"()]/.test(a) ? JSON.stringify(a) : a)).join(' ');

    if (job.cancelRequested) {
      const removed = await removeQuietly(temp);
      item.status = 'cancelled';
      item.progress = null;
      item.message = removed ? 'Annulé, fichier partiel supprimé' : `Annulé : fichier partiel à supprimer manuellement (${temp})`;
      this.closeItem(job, item);
      return;
    }

    if (result.code !== 0) {
      await removeQuietly(temp);
      fail(
        explainFfmpegFailure(result.stderrTail, result.spawnError),
        `Commande :\n${commandForDetails}\n\nCode de sortie : ${result.code ?? result.signal}\n\nSortie FFmpeg :\n${result.stderrTail}`,
      );
      this.closeItem(job, item);
      return;
    }

    // 3. Contrôle de la sortie puis renommage atomique vers le nom final.
    let outSize = 0;
    try {
      outSize = (await stat(temp)).size;
    } catch {
      /* géré ci-dessous */
    }
    if (outSize <= 0) {
      await removeQuietly(temp);
      fail('FFmpeg s’est terminé sans produire de fichier exploitable.', `Commande :\n${commandForDetails}\n\n${result.stderrTail}`);
      this.closeItem(job, item);
      return;
    }

    try {
      if (await fileExists(finalOut)) {
        if (policy === 'skip' || policy === 'unique') {
          finalOut = await findUniquePath(finalOut, this.reservedOutputs(job, item));
          item.output = finalOut;
          item.notes.push('Un fichier du même nom est apparu pendant la conversion : nom unique attribué.');
        }
      }
      await rename(temp, finalOut);
    } catch (e) {
      await removeQuietly(temp);
      fail(`Impossible d’enregistrer la sortie : ${(e as Error).message}`);
      this.closeItem(job, item);
      return;
    }

    item.status = 'done';
    item.progress = 1;
    item.etaSec = 0;
    item.sizeOut = outSize;
    item.message = undefined;
    if (!item.durationSec) item.durationSec = (Date.now() - started) / 1000;

    // 4. Suppression optionnelle de l'original (Corbeille), après vérification.
    if (job.req.deleteSource) {
      const verdict = await this.verifyOutput(env, finalOut, entry, job.req.kind);
      if (!verdict.ok) {
        item.notes.push(`Original conservé : ${verdict.reason}`);
      } else if (pathKey(finalOut) === pathKey(item.source)) {
        item.notes.push('Original conservé : la sortie porte le même chemin.');
      } else {
        try {
          await this.deps.trash(item.source);
          item.sourceTrashed = true;
          item.notes.push('Original placé dans la Corbeille.');
        } catch (e) {
          item.notes.push(`Original conservé : impossible de le placer dans la Corbeille (${(e as Error).message}).`);
        }
      }
    }
    this.closeItem(job, item);
  }

  private async verifyOutput(env: Environment, out: string, entry: PreparedEntry, kind: 'audio' | 'video'): Promise<{ ok: boolean; reason?: string }> {
    if (!env.ffprobePath) return { ok: false, reason: 'vérification impossible sans FFprobe.' };
    try {
      const p = await probeFile(env.ffprobePath, out);
      if (kind === 'audio' && p.audioIndexes.length === 0) return { ok: false, reason: 'aucune piste audio détectée dans la sortie.' };
      if (kind === 'video' && p.videoIndex === null) return { ok: false, reason: 'aucune piste vidéo détectée dans la sortie.' };
      const src = entry.outputDurationSec ?? entry.item.probe?.durationSec ?? null;
      const dst = p.durationSec ?? 0;
      if (src && src > 0) {
        if (dst < Math.min(src * 0.97, src - 1)) return { ok: false, reason: `durée de la sortie (${dst.toFixed(1)} s) inférieure à celle de la source (${src.toFixed(1)} s).` };
      } else if (dst <= 0) {
        return { ok: false, reason: 'durée de la sortie impossible à vérifier.' };
      }
      return { ok: true };
    } catch (e) {
      return { ok: false, reason: `la sortie n’a pas pu être relue (${(e as Error).message}).` };
    }
  }

  private reservedOutputs(job: Job, except: InternalItem): Set<string> {
    const s = new Set<string>();
    for (const it of job.items) if (it !== except && it.output && it.status !== 'failed') s.add(pathKey(it.output));
    return s;
  }

  private closeItem(job: Job, item: InternalItem): void {
    const now = Date.now();
    if (item.activeSince) item.accumulatedMs += now - item.activeSince;
    item.activeSince = null;
    item.elapsedMs = item.accumulatedMs;
    if (job.items[job.snapshot.currentIndex]?.status !== 'running') {
      const runningIdx = job.items.findIndex((i) => i.status === 'running');
      if (runningIdx >= 0) job.snapshot.currentIndex = runningIdx;
    }
    item.speed = item.status === 'done' ? item.speed : null;
    item.etaSec = null;
    this.emit(true);
  }

  /* ---------------------------------------------------------------- */
  /* Instantanés                                                       */
  /* ---------------------------------------------------------------- */

  private toSnapshot(job: Job): JobSnapshot {
    const now = Date.now();
    const counts = emptyCounts();
    let totalW = 0;
    let doneW = 0;
    let remainingSec = 0;
    for (const it of job.items) {
      counts[it.status]++;
      const relevant = it.entry?.action === 'convert';
      if (!relevant) continue;
      totalW += it.weight;
      if (it.status === 'done' || it.status === 'failed' || it.status === 'cancelled' || it.status === 'skipped') doneW += it.weight;
      else if (it.status === 'running') {
        doneW += it.weight * (it.progress ?? 0);
        remainingSec += it.weight * (1 - (it.progress ?? 0));
      } else remainingSec += it.weight;
    }
    const elapsed = job.accumulatedMs + (job.activeSince ? now - job.activeSince : 0);
    const avgSpeed = job.speedSamples.length ? job.speedSamples.reduce((a, b) => a + b, 0) / job.speedSamples.length : null;
    const running = job.snapshot.state === 'running' || job.snapshot.state === 'paused';
    const items: JobItem[] = job.items.map(({ entry: _e, weight: _w, outTimeSec: _o, handle: _h, activeSince, accumulatedMs, ...rest }) => {
      if (rest.status === 'running') rest.elapsedMs = accumulatedMs + (activeSince ? now - activeSince : 0);
      return rest;
    });
    // Débit global : vitesse moyenne × nombre de conversions simultanées possibles.
    const lanes = Math.max(1, Math.min(job.concurrency, counts.pending + counts.running));
    return {
      ...job.snapshot,
      elapsedMs: this.isFinished(job.snapshot.state) ? job.snapshot.elapsedMs : elapsed,
      progress: totalW > 0 ? Math.min(1, doneW / totalW) : this.isFinished(job.snapshot.state) ? 1 : 0,
      etaSec: running && avgSpeed ? remainingSec / (avgSpeed * lanes) : null,
      items,
      counts,
      snapshotAt: now,
      concurrency: job.concurrency,
    };
  }

  private emit(immediate = false): void {
    if (immediate) {
      if (this.emitTimer) clearTimeout(this.emitTimer);
      this.emitTimer = null;
      this.deps.onChange(this.list());
      return;
    }
    if (this.emitTimer) return;
    this.emitTimer = setTimeout(() => {
      this.emitTimer = null;
      this.deps.onChange(this.list());
    }, 200);
  }
}

async function fileExists(p: string): Promise<boolean> {
  try {
    await stat(p);
    return true;
  } catch {
    return false;
  }
}

async function removeQuietly(p: string): Promise<boolean> {
  try {
    await rm(p, { force: true });
    return !(await fileExists(p));
  } catch {
    return false;
  }
}
