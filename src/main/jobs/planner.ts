import { access, stat, statfs } from 'node:fs/promises';
import path from 'node:path';
import { estimateBytes, uselessVideoReason } from '../../shared/estimate';
import { audioProfileLabel, DEFAULT_AUDIO, defaultVideoSettings, outputFileName, uselessAudioReason, videoProfileLabel } from '../../shared/profiles';
import type { Environment, JobPlan, JobRequest, MediaItem, PlanEntry } from '../../shared/types';
import { editLabel, editOutputName, editProblem } from '../../shared/edit';
import { buildAudioArgs, buildVideoArgs, PlanError, type BuiltCommand } from '../ffmpeg/args';
import { buildEditArgs } from '../ffmpeg/editArgs';

export interface PreparedEntry extends PlanEntry {
  item: MediaItem;
  /** Durée attendue de la sortie si elle diffère de la source (découpe). */
  outputDurationSec?: number;
}

export interface PreparedPlan extends JobPlan {
  prepared: PreparedEntry[];
}

async function exists(p: string): Promise<boolean> {
  try {
    await access(p);
    return true;
  } catch {
    return false;
  }
}

/** macOS (APFS par défaut) ne distingue pas la casse : on compare en minuscules. */
export const pathKey = (p: string): string => path.resolve(p).normalize('NFC').toLowerCase();

/** `single` : un seul fichier est réellement converti (le nom complet choisi s'applique alors). */
export function outputNameFor(item: MediaItem, req: JobRequest, single = false): string {
  if (req.edit) return editOutputName(item, req.edit);
  if (req.kind === 'audio' && !req.audio) throw new PlanError('Réglages audio manquants.');
  if (req.kind === 'video' && !req.video) throw new PlanError('Réglages vidéo manquants.');
  return outputFileName(item.name, req.kind, req.audio ?? DEFAULT_AUDIO, req.video ?? defaultVideoSettings('youtube'), req.naming, single);
}

export function outputDirFor(item: MediaItem, req: JobRequest): string {
  if (req.destination.mode === 'folder' && req.destination.folder) {
    return path.join(req.destination.folder, item.relDir);
  }
  return item.dir;
}

export function uniqueCandidate(file: string, n: number): string {
  const ext = path.extname(file);
  return `${file.slice(0, file.length - ext.length)} (${n})${ext}`;
}

/** Trouve un nom libre, ni présent sur le disque ni déjà réservé dans le lot. */
export async function findUniquePath(file: string, reserved: Set<string>): Promise<string> {
  let candidate = file;
  let n = 1;
  while (reserved.has(pathKey(candidate)) || (await exists(candidate))) {
    n += 1;
    candidate = uniqueCandidate(file, n);
    if (n > 9999) throw new PlanError('Impossible de trouver un nom de fichier libre.');
  }
  return candidate;
}

export function buildCommand(entry: PreparedEntry, req: JobRequest, env: Environment, tempOutput: string): BuiltCommand {
  if (req.edit) return buildEditArgs(entry.item, tempOutput, req.edit, env);
  if (req.kind === 'audio') {
    if (!req.audio) throw new PlanError('Réglages audio manquants.');
    return buildAudioArgs(entry.source, tempOutput, req.audio, entry.item.probe, env);
  }
  if (!req.video) throw new PlanError('Réglages vidéo manquants.');
  if (!entry.item.probe) throw new PlanError('Analyse du fichier indisponible.');
  return buildVideoArgs(entry.source, tempOutput, req.video, entry.item.probe, env);
}

async function nearestExistingDir(dir: string): Promise<string | null> {
  let d = dir;
  for (let i = 0; i < 64; i++) {
    try {
      const st = await stat(d);
      if (st.isDirectory()) return d;
    } catch {
      /* on remonte */
    }
    const parent = path.dirname(d);
    if (parent === d) return null;
    d = parent;
  }
  return null;
}

function estimateOutputBytes(item: MediaItem, req: JobRequest): number {
  return estimateBytes(item, req.kind, req.audio, req.video) ?? item.size;
}

export async function planJob(req: JobRequest, items: MediaItem[], env: Environment): Promise<PreparedPlan> {
  const blocking: string[] = [];
  const warnings: string[] = [];
  const profileLabel = req.edit
    ? `Édition : ${editLabel(req.edit)}`
    : req.kind === 'audio' && req.audio
      ? audioProfileLabel(req.audio)
      : req.video
        ? videoProfileLabel(req.video)
        : '';
  if (req.edit && items[0]) {
    const problem = editProblem(items[0], req.edit);
    if (problem) blocking.push(problem);
  }

  if (!env.ok || !env.ffmpegPath) blocking.push(env.error ?? 'FFmpeg est indisponible.');
  if (!req.edit && req.kind === 'audio' && req.audio && env.ok) {
    if (req.audio.format === 'mp3' && !env.encoders.libmp3lame?.usable) {
      blocking.push('L’encodeur MP3 libmp3lame n’est pas inclus dans votre FFmpeg. Installez la version Homebrew : brew install ffmpeg');
    }
    if (req.audio.format === 'opus' && !env.encoders.libopus?.usable) {
      blocking.push('L’encodeur Opus (libopus) n’est pas inclus dans votre FFmpeg. Installez la version Homebrew : brew install ffmpeg');
    }
    if (req.audio.format === 'aac' && !env.encoders.aac?.usable && !env.encoders.aac_at?.usable) {
      blocking.push('Aucun encodeur AAC n’est disponible dans votre FFmpeg.');
    }
  }
  if (!req.edit && req.kind === 'video' && !env.encoders.aac?.usable && env.ok) {
    blocking.push('L’encodeur AAC n’est pas disponible dans votre FFmpeg.');
  }
  if (req.destination.mode === 'folder') {
    const folder = req.destination.folder;
    if (!folder) blocking.push('Choisissez un dossier de sortie.');
    else {
      try {
        const st = await stat(folder);
        if (!st.isDirectory()) blocking.push('Le dossier de sortie choisi n’est pas un dossier.');
      } catch {
        blocking.push('Le dossier de sortie choisi n’existe plus.');
      }
    }
  }

  const prepared: PreparedEntry[] = [];
  const reserved = new Map<string, string>(); // clé de sortie -> nom de la source qui la réserve
  const dirsToCreate = new Set<string>();
  const sourceKeys = new Set(items.map((i) => pathKey(i.path)));
  const fallbackNotes = new Set<string>();

  const uselessReason = (item: MediaItem): string | null =>
    req.edit
      ? null
      : req.kind === 'audio' && req.audio
        ? uselessAudioReason(item, req.audio)
        : req.kind === 'video' && req.video
          ? uselessVideoReason(item, req.video)
          : null;
  const single = items.filter((i) => i.status === 'ready' && !uselessReason(i)).length === 1;

  for (const item of items) {
    const entry: PreparedEntry = {
      item,
      itemId: item.id,
      sizeIn: item.size,
      estimatedBytes: req.edit ? null : estimateBytes(item, req.kind, req.audio, req.video),
      outputDurationSec: req.edit ? req.edit.end - req.edit.start : undefined,
      source: item.path,
      name: item.name,
      relDir: item.relDir,
      output: null,
      action: 'convert',
      notes: [],
      willReplace: false,
    };
    prepared.push(entry);

    if (item.status !== 'ready') {
      entry.action = 'error';
      entry.message = item.message ?? 'Fichier non pris en charge';
      continue;
    }
    const useless = uselessReason(item);
    if (useless) {
      entry.action = 'skip-useless';
      entry.message = useless;
      continue;
    }
    if (blocking.length) {
      entry.action = 'error';
      entry.message = 'Conversion impossible pour le moment';
      continue;
    }

    let output: string;
    try {
      const dir = outputDirFor(item, req);
      output = path.join(dir, outputNameFor(item, req, single));
      // Vérifie aussi que les arguments peuvent être construits (encodeur, flux…).
      const built = buildCommand(entry, req, env, output);
      entry.encoder = built.encoder;
      entry.summary = built.summary;
      entry.notes.push(...built.notes);
      for (const n of built.notes) if (n.startsWith('Encodeur matériel')) fallbackNotes.add(n);
    } catch (e) {
      entry.action = 'error';
      entry.message = e instanceof PlanError ? e.message : `Préparation impossible : ${(e as Error).message}`;
      continue;
    }

    if (sourceKeys.has(pathKey(output))) {
      entry.action = 'error';
      entry.message = 'La sortie porterait le même nom que la source. Choisissez un autre nom, un autre format ou un dossier de sortie.';
      continue;
    }

    const key = pathKey(output);
    const takenBy = reserved.get(key);
    const onDisk = await exists(output);

    if (req.collision === 'unique') {
      if (takenBy || onDisk) {
        output = await findUniquePath(output, new Set(reserved.keys()));
        entry.notes.push(`Nom unique attribué : ${path.basename(output)}`);
      }
    } else if (takenBy) {
      entry.action = 'collision';
      entry.message = `Même nom de sortie que « ${takenBy} ». Choisissez « Créer un nom unique » ou un autre dossier.`;
      entry.output = output;
      continue;
    } else if (onDisk) {
      if (req.collision === 'skip') {
        entry.action = 'skip-exists';
        entry.message = 'Déjà présent';
      } else {
        entry.willReplace = true;
        entry.notes.push('Le fichier existant sera remplacé.');
      }
    }

    entry.output = output;
    reserved.set(pathKey(output), item.name);
    if (entry.action === 'convert') {
      const dir = path.dirname(output);
      if (!(await exists(dir))) dirsToCreate.add(dir);
    }
  }

  for (const n of fallbackNotes) warnings.push(n);

  // Estimation grossière de l'espace disque nécessaire.
  const byVolume = new Map<string, number>();
  for (const e of prepared) {
    if (e.action !== 'convert' || !e.output) continue;
    const base = await nearestExistingDir(path.dirname(e.output));
    if (!base) continue;
    byVolume.set(base, (byVolume.get(base) ?? 0) + estimateOutputBytes(e.item, req));
  }
  let need = 0;
  let free = Infinity;
  for (const [dir, bytes] of byVolume) {
    need += bytes;
    try {
      const fs = await statfs(dir);
      const f = fs.bavail * fs.bsize;
      free = Math.min(free, f);
    } catch {
      /* statfs indisponible : pas d'avertissement */
    }
  }
  if (Number.isFinite(free) && need > free * 0.95) {
    warnings.push('L’espace disque libre semble insuffisant pour toutes les sorties estimées. Des conversions pourraient échouer.');
  }

  if (req.deleteSource) {
    warnings.push('Les originaux convertis avec succès seront placés dans la Corbeille. Les fichiers ignorés ou en échec ne sont jamais touchés.');
  }

  const counts = { convert: 0, skip: 0, collision: 0, error: 0 };
  let totalIn = 0;
  let totalEstimated: number | null = 0;
  for (const e of prepared) {
    if (e.action === 'convert') {
      counts.convert++;
      totalIn += e.sizeIn;
      totalEstimated = e.estimatedBytes === null || totalEstimated === null ? null : totalEstimated + e.estimatedBytes;
    } else if (e.action === 'skip-exists' || e.action === 'skip-useless') counts.skip++;
    else if (e.action === 'collision') counts.collision++;
    else counts.error++;
  }

  return {
    prepared,
    entries: prepared.map(({ item: _item, ...rest }) => rest),
    counts,
    totalIn,
    totalEstimated: counts.convert ? totalEstimated : null,
    dirsToCreate: [...dirsToCreate].sort(),
    warnings,
    blocking,
    profileLabel,
    deleteSource: req.deleteSource,
  };
}
