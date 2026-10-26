/**
 * Cœur applicatif indépendant d'Electron : l'IPC (main/ipc.ts) ne fait que
 * relayer les appels vers cette classe. Cela permet de la tester sans fenêtre.
 */
import { stat } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type {
  AddResult,
  Environment,
  HistoryEntry,
  JobPlan,
  JobRequest,
  JobSnapshot,
  MediaItem,
  MediaKind,
  Preferences,
  StartResult,
  UpdateCheck,
} from '../shared/types';
import { validateJobRequest, validateKind, validatePath, validatePaths, validateSources } from '../shared/validate';
import { checkFfmpegUpdate, detectEnvironment } from './ffmpeg/environment';
import { fileUrl } from './ffmpeg/probe';
import { runBinary } from './ffmpeg/process';
import { JobManager } from './jobs/manager';
import { pathKey, planJob } from './jobs/planner';
import { extensionsFor, MediaLibrary } from './media/library';
import { HistoryStore, SettingsStore } from './store';

export type DialogRequest =
  | { type: 'files'; kind: MediaKind; extensions: readonly string[] }
  | { type: 'folder'; kind: MediaKind }
  | { type: 'output' }
  | { type: 'edit' }
  | { type: 'binary' };

export interface Platform {
  dataDir: string;
  /** Renvoie les chemins choisis, ou null si l'utilisateur annule. */
  showDialog(req: DialogRequest): Promise<string[] | null>;
  trash(file: string): Promise<void>;
  reveal(file: string): void;
  open(file: string): Promise<string>;
  copy(text: string): void;
  emitJobs(jobs: JobSnapshot[]): void;
  /** Fin d'une tâche : son et notification système. */
  notifyFinished(job: JobSnapshot, sound: boolean): void;
}

export class Backend {
  private env: Environment | null = null;
  private envPromise: Promise<Environment> | null = null;
  private readonly library: MediaLibrary;
  private readonly jobs: JobManager;
  private readonly settings: SettingsStore;
  private readonly history: HistoryStore;
  private readonly grantedFolders = new Set<string>();
  private readonly historyPaths = new Set<string>();

  constructor(private readonly platform: Platform) {
    this.settings = new SettingsStore(platform.dataDir);
    this.history = new HistoryStore(platform.dataDir);
    this.library = new MediaLibrary(() => this.env?.ffprobePath ?? null);
    const home = os.homedir();
    this.jobs = new JobManager({
      getEnv: () => this.env as Environment,
      trash: (f) => platform.trash(f),
      onChange: (jobs) => platform.emitJobs(jobs),
      onFinished: (job) => {
        void this.settings.read().then((s) => platform.notifyFinished(job, s.notifySound !== false)).catch(() => undefined);
        void this.history.add(job).then((list) => this.indexHistory(list)).catch(() => undefined);
      },
      redact: (t) => (home && home.length > 1 ? t.split(home).join('~') : t),
    });
    void this.history.read().then((l) => this.indexHistory(l));
  }

  /* -------------------------- Environnement ----------------------- */

  async getEnvironment(refresh = false): Promise<Environment> {
    if (this.env && !refresh) return this.env;
    if (this.envPromise && !refresh) return this.envPromise;
    this.envPromise = (async () => {
      const s = await this.settings.read();
      this.env = await detectEnvironment(s.ffmpegPath);
      return this.env;
    })();
    try {
      return await this.envPromise;
    } finally {
      this.envPromise = null;
    }
  }

  async checkFfmpegUpdate(): Promise<UpdateCheck> {
    return checkFfmpegUpdate(await this.getEnvironment());
  }

  async chooseFfmpegBinary(): Promise<Environment> {
    const res = await this.platform.showDialog({ type: 'binary' });
    if (!res?.length) return this.getEnvironment();
    await this.settings.update({ ffmpegPath: validatePath(res[0]) });
    return this.getEnvironment(true);
  }

  async resetFfmpegBinary(): Promise<Environment> {
    await this.settings.update({ ffmpegPath: null });
    return this.getEnvironment(true);
  }

  /* ------------------------------ Médias -------------------------- */

  async pickFiles(kindRaw: unknown, sourcesRaw?: unknown): Promise<AddResult> {
    const kind = validateKind(kindRaw);
    const sources = validateSources(sourcesRaw);
    await this.getEnvironment();
    const files = await this.platform.showDialog({ type: 'files', kind, extensions: extensionsFor(kind, sources) });
    if (!files?.length) return { items: [], rejected: [], cancelled: true };
    return this.library.addFiles(kind, files, undefined, sources);
  }

  async pickFolder(kindRaw: unknown, recursive: unknown, sourcesRaw?: unknown): Promise<AddResult> {
    const kind = validateKind(kindRaw);
    const sources = validateSources(sourcesRaw);
    await this.getEnvironment();
    const res = await this.platform.showDialog({ type: 'folder', kind });
    if (!res?.length) return { items: [], rejected: [], cancelled: true };
    return this.library.addFolder(kind, res[0], recursive === true, sources);
  }

  /** Fichiers ou dossiers glissés dans la fenêtre : le geste vaut consentement. */
  async addDroppedPaths(kindRaw: unknown, pathsRaw: unknown, recursive: unknown, sourcesRaw?: unknown): Promise<AddResult> {
    const kind = validateKind(kindRaw);
    const paths = validatePaths(pathsRaw);
    const sources = validateSources(sourcesRaw);
    await this.getEnvironment();
    const out: AddResult = { items: [], rejected: [], cancelled: false };
    const files: string[] = [];
    for (const p of paths) {
      try {
        const st = await stat(p);
        if (st.isDirectory()) {
          const r = await this.library.addFolder(kind, p, recursive === true, sources);
          out.items.push(...r.items);
          out.rejected.push(...r.rejected);
        } else files.push(p);
      } catch {
        out.rejected.push({ path: p, reason: 'Élément introuvable ou inaccessible' });
      }
    }
    if (files.length) {
      const r = await this.library.addFiles(kind, files, undefined, sources);
      out.items.push(...r.items);
      out.rejected.push(...r.rejected);
    }
    return out;
  }

  /* ------------------------------ Édition ------------------------- */

  private waveforms = new Map<string, string | null>();

  async openForEdit(pathRaw?: unknown): Promise<AddResult> {
    await this.getEnvironment();
    let file: string;
    if (pathRaw !== undefined && pathRaw !== null) {
      file = validatePath(pathRaw);
    } else {
      const res = await this.platform.showDialog({ type: 'edit' });
      if (!res?.length) return { items: [], rejected: [], cancelled: true };
      file = res[0];
    }
    return this.library.addForEdit(file);
  }

  /** Chemin d'un média ajouté par l'utilisateur (pour la lecture locale), sinon null. */
  mediaPathFor(id: string): string | null {
    return this.library.get(id)?.path ?? null;
  }

  async getWaveform(idRaw: unknown): Promise<string | null> {
    if (typeof idRaw !== 'string') return null;
    if (this.waveforms.has(idRaw)) return this.waveforms.get(idRaw) ?? null;
    const item = this.library.get(idRaw);
    const ffmpeg = this.env?.ffmpegPath;
    if (!item || !ffmpeg || !item.probe?.audioIndexes.length) return null;
    const png = await runBinary(ffmpeg, [
      '-hide_banner', '-nostdin', '-v', 'error', '-i', fileUrl(item.path),
      '-filter_complex', '[0:a:0]aformat=channel_layouts=mono,showwavespic=s=1600x160:colors=0x7d8a83:scale=sqrt[w]',
      '-map', '[w]', '-frames:v', '1', '-f', 'image2pipe', '-c:v', 'png', '-',
    ], { timeoutMs: 120_000 });
    const url = png ? `data:image/png;base64,${png.toString('base64')}` : null;
    this.waveforms.set(idRaw, url);
    return url;
  }

  async getFrame(idRaw: unknown, tRaw: unknown): Promise<string | null> {
    if (typeof idRaw !== 'string' || typeof tRaw !== 'number' || !Number.isFinite(tRaw)) return null;
    const item = this.library.get(idRaw);
    const ffmpeg = this.env?.ffmpegPath;
    if (!item || !ffmpeg || item.probe?.videoIndex === null || item.probe?.videoIndex === undefined) return null;
    const jpg = await runBinary(ffmpeg, [
      '-hide_banner', '-nostdin', '-v', 'error', '-ss', Math.max(0, tRaw).toFixed(3), '-i', fileUrl(item.path),
      '-map', `0:${item.probe.videoIndex}`, '-frames:v', '1', '-vf', 'scale=960:-2', '-f', 'image2pipe', '-c:v', 'mjpeg', '-q:v', '4', '-',
    ], { timeoutMs: 20_000 });
    return jpg ? `data:image/jpeg;base64,${jpg.toString('base64')}` : null;
  }

  async pickOutputFolder(): Promise<string | null> {
    const res = await this.platform.showDialog({ type: 'output' });
    if (!res?.length) return null;
    this.grantedFolders.add(pathKey(res[0]));
    return res[0];
  }

  /* ------------------------------ Tâches -------------------------- */

  private resolveRequest(raw: unknown): { req: JobRequest; items: MediaItem[] } {
    const req = validateJobRequest(raw);
    if (req.destination.mode === 'folder' && req.destination.folder && !this.grantedFolders.has(pathKey(req.destination.folder))) {
      throw new Error('Dossier de sortie non autorisé : choisissez-le avec le bouton « Choisir un dossier ».');
    }
    const items = req.itemIds.map((id) => {
      const it = this.library.get(id);
      if (!it) throw new Error('Un média de la liste n’est plus disponible. Ajoutez-le à nouveau.');
      if (it.kind !== req.kind) throw new Error('Type de média incohérent.');
      return it;
    });
    return { req, items };
  }

  async planJob(raw: unknown): Promise<JobPlan> {
    const env = await this.getEnvironment();
    const { req, items } = this.resolveRequest(raw);
    const { prepared: _p, ...plan } = await planJob(req, items, env);
    return plan;
  }

  async startJob(raw: unknown, confirmCreateDirs: unknown): Promise<StartResult> {
    try {
      const env = await this.getEnvironment();
      const { req, items } = this.resolveRequest(raw);
      const plan = await planJob(req, items, env);
      if (plan.blocking.length) return { ok: false, error: plan.blocking[0] };
      if (plan.counts.convert === 0) return { ok: false, error: 'Aucun fichier à convertir avec ces réglages.' };
      if (plan.dirsToCreate.length && confirmCreateDirs !== true) {
        return { ok: false, error: 'La création des dossiers de sortie doit être confirmée.' };
      }
      return { ok: true, jobId: this.jobs.enqueue(plan, req) };
    } catch (e) {
      return { ok: false, error: (e as Error).message };
    }
  }

  cancelJob(id: unknown): void {
    if (typeof id === 'string') this.jobs.cancel(id);
  }
  pauseJob(id: unknown): void {
    if (typeof id === 'string') this.jobs.pause(id);
  }
  resumeJob(id: unknown): void {
    if (typeof id === 'string') this.jobs.resume(id);
  }
  getJobs(): JobSnapshot[] {
    return this.jobs.list();
  }
  clearFinishedJobs(): JobSnapshot[] {
    this.jobs.clearFinished();
    return this.jobs.list();
  }
  hasActiveJobs(): boolean {
    return this.jobs.hasActiveJobs();
  }
  shutdown(): Promise<void> {
    return this.jobs.shutdown();
  }

  /* ---------------------------- Historique ------------------------ */

  private indexHistory(list: HistoryEntry[]): void {
    for (const e of list) for (const i of e.items) {
      this.historyPaths.add(pathKey(i.source));
      if (i.output) this.historyPaths.add(pathKey(i.output));
    }
  }

  getHistory(): Promise<HistoryEntry[]> {
    return this.history.read();
  }

  async clearHistory(): Promise<HistoryEntry[]> {
    this.historyPaths.clear();
    return this.history.clear();
  }

  /* ----------------------------- Finder --------------------------- */

  private isKnownPath(p: string): boolean {
    const k = pathKey(p);
    return this.library.has(p) || this.jobs.isOutputOrSource(p) || this.historyPaths.has(k) || this.grantedFolders.has(k);
  }

  async revealInFinder(raw: unknown): Promise<boolean> {
    const p = validatePath(raw);
    if (!this.isKnownPath(p)) return false;
    try {
      await stat(p);
    } catch {
      // Fichier disparu : on montre au moins son dossier s'il existe encore.
      try {
        await stat(path.dirname(p));
        this.platform.reveal(path.dirname(p));
        return true;
      } catch {
        return false;
      }
    }
    this.platform.reveal(p);
    return true;
  }

  async openPath(raw: unknown): Promise<boolean> {
    const p = validatePath(raw);
    if (!this.isKnownPath(p)) return false;
    const err = await this.platform.open(p);
    return err === '';
  }

  async getPreferences(): Promise<Preferences> {
    const s = await this.settings.read();
    return { notifySound: s.notifySound !== false };
  }

  async setPreferences(raw: unknown): Promise<Preferences> {
    if (raw && typeof raw === 'object' && typeof (raw as Preferences).notifySound === 'boolean') {
      await this.settings.update({ notifySound: (raw as Preferences).notifySound });
    }
    return this.getPreferences();
  }

  copyText(raw: unknown): void {
    if (typeof raw === 'string' && raw.length < 1_000_000) this.platform.copy(raw);
  }
}
