import { randomUUID } from 'node:crypto';
import { access, constants, stat } from 'node:fs/promises';
import path from 'node:path';
import { AUDIO_SOURCE_GROUPS, audioExtensions, DEFAULT_AUDIO, VIDEO_EXTENSIONS } from '../../shared/profiles';
import type { AddResult, AudioSourceGroup, MediaItem, MediaKind } from '../../shared/types';
import { probeFile } from '../ffmpeg/probe';
import { extOf, scanFolder } from './scan';

export function extensionsFor(kind: MediaKind, sources?: AudioSourceGroup[]): readonly string[] {
  return kind === 'audio' ? audioExtensions(sources?.length ? sources : DEFAULT_AUDIO.sources) : VIDEO_EXTENSIONS;
}

function sourcesLabel(sources?: AudioSourceGroup[]): string {
  const list = sources?.length ? sources : DEFAULT_AUDIO.sources;
  return AUDIO_SOURCE_GROUPS.filter((g) => list.includes(g.id)).map((g) => g.label).join(', ');
}

async function mapLimit<T, R>(items: T[], limit: number, fn: (t: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i]);
    }
  });
  await Promise.all(workers);
  return out;
}

/**
 * Registre des médias ajoutés par l'utilisateur. Seuls les fichiers passés par
 * une boîte de dialogue ou un glisser-déposer y figurent : l'interface ne peut
 * pas demander la conversion d'un chemin arbitraire.
 */
export class MediaLibrary {
  private items = new Map<string, MediaItem>();

  constructor(private readonly getFfprobe: () => string | null) {}

  get(id: string): MediaItem | undefined {
    return this.items.get(id);
  }

  has(p: string): boolean {
    for (const it of this.items.values()) if (it.path === p) return true;
    return false;
  }

  async addFiles(kind: MediaKind, files: string[], root?: string, sources?: AudioSourceGroup[]): Promise<AddResult> {
    const exts = extensionsFor(kind, sources);
    const rejected: AddResult['rejected'] = [];
    const candidates: { file: string; root: string }[] = [];
    for (const f of files) {
      const ext = extOf(f);
      if (!exts.includes(ext)) {
        rejected.push({
          path: f,
          reason:
            kind === 'audio'
              ? `Format .${ext || '?'} non coché dans « Formats source » (actuellement : ${sourcesLabel(sources)}).`
              : `Format .${ext || '?'} non reconnu comme vidéo.`,
        });
        continue;
      }
      candidates.push({ file: f, root: root ?? path.dirname(f) });
    }
    const items = await mapLimit(candidates, 4, (c) => this.createItem(kind, c.file, c.root));
    for (const it of items) this.items.set(it.id, it);
    return { items, rejected, cancelled: false };
  }

  async addFolder(kind: MediaKind, folder: string, recursive: boolean, sources?: AudioSourceGroup[]): Promise<AddResult> {
    const scan = await scanFolder(folder, extensionsFor(kind, sources), recursive);
    const res = await this.addFiles(kind, scan.files, folder, sources);
    res.rejected.push(...scan.errors);
    if (scan.files.length === 0 && scan.errors.length === 0) {
      res.rejected.push({
        path: folder,
        reason: kind === 'audio'
          ? `Aucun fichier ${sourcesLabel(sources)} trouvé${recursive ? ' (sous-dossiers inclus)' : ' (activez « Inclure les sous-dossiers » si besoin)'}.`
          : `Aucune vidéo trouvée${recursive ? ' (sous-dossiers inclus)' : ' (activez « Inclure les sous-dossiers » si besoin)'}.`,
      });
    }
    return res;
  }

  /** Édition : un fichier audio ou vidéo, dont le type est déduit de l'analyse. */
  async addForEdit(file: string): Promise<AddResult> {
    const ext = extOf(file);
    const known = [...audioExtensions(AUDIO_SOURCE_GROUPS.map((g) => g.id))];
    if (!known.includes(ext)) {
      return { items: [], rejected: [{ path: file, reason: `Format .${ext || '?'} non pris en charge.` }], cancelled: false };
    }
    const item = await this.createItem('video', file, path.dirname(file));
    if (item.probe && item.probe.videoIndex === null && item.probe.audioIndexes.length) {
      item.kind = 'audio';
      item.status = 'ready';
      item.message = undefined;
    }
    this.items.set(item.id, item);
    return { items: [item], rejected: [], cancelled: false };
  }

  private async createItem(kind: MediaKind, file: string, root: string): Promise<MediaItem> {
    const dir = path.dirname(file);
    const rel = path.relative(root, dir);
    const item: MediaItem = {
      id: randomUUID(),
      kind,
      path: file,
      name: path.basename(file),
      ext: extOf(file),
      size: 0,
      dir,
      root,
      relDir: rel.startsWith('..') ? '' : rel,
      status: 'ready',
    };
    try {
      const st = await stat(file);
      if (!st.isFile()) throw Object.assign(new Error('not a file'), { code: 'ENOTFILE' });
      item.size = st.size;
      await access(file, constants.R_OK);
    } catch (e) {
      const code = (e as NodeJS.ErrnoException).code;
      item.status = 'error';
      item.message = code === 'ENOENT' ? 'Fichier introuvable' : code === 'EACCES' || code === 'EPERM' ? 'Fichier inaccessible (permission refusée)' : 'Fichier illisible';
      return item;
    }
    const ffprobe = this.getFfprobe();
    if (!ffprobe) {
      item.status = 'error';
      item.message = 'Analyse impossible : FFprobe est introuvable';
      return item;
    }
    try {
      item.probe = await probeFile(ffprobe, file);
      if (kind === 'audio' && item.probe.audioIndexes.length === 0) {
        item.status = 'unsupported';
        item.message = 'Aucune piste audio';
      } else if (kind === 'video' && item.probe.videoIndex === null) {
        item.status = 'unsupported';
        item.message = item.probe.audioIndexes.length ? 'Fichier audio seul, sans piste vidéo' : 'Aucune piste vidéo';
      }
    } catch {
      item.status = 'error';
      item.message = 'Fichier illisible ou corrompu';
    }
    return item;
  }
}
