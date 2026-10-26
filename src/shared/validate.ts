/**
 * Validation des requêtes reçues depuis l'interface. Le processus principal ne
 * fait jamais confiance aux données venant du renderer.
 */
import { namingProblem } from './profiles';
import type { OutputNaming, AudioSettings, AudioSourceGroup, EditSettings, JobRequest, MediaKind, TrackSelection, VideoSettings } from './types';

const SOURCE_GROUPS: readonly AudioSourceGroup[] = ['wav', 'aiff', 'flac', 'm4a', 'mp3', 'ogg', 'video'];

export class ValidationError extends Error {}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const oneOf = <T extends string | number>(v: unknown, list: readonly T[], field: string): T => {
  if (!list.includes(v as T)) throw new ValidationError(`Valeur invalide pour ${field}`);
  return v as T;
};
const num = (v: unknown, min: number, max: number, field: string): number => {
  if (typeof v !== 'number' || !Number.isFinite(v) || v < min || v > max) throw new ValidationError(`Valeur invalide pour ${field}`);
  return v;
};

export function validateKind(v: unknown): MediaKind {
  return oneOf(v, ['audio', 'video'] as const, 'type de média');
}

export function validatePath(v: unknown, field = 'chemin'): string {
  if (typeof v !== 'string' || v.length === 0 || v.length > 4096 || v.includes('\0')) throw new ValidationError(`${field} invalide`);
  if (!v.startsWith('/') && !/^[A-Za-z]:[\\/]/.test(v)) throw new ValidationError(`${field} doit être absolu`);
  return v;
}

export function validatePaths(v: unknown): string[] {
  if (!Array.isArray(v) || v.length > 10_000) throw new ValidationError('Liste de chemins invalide');
  return v.map((p) => validatePath(p));
}

export function validateSources(v: unknown): AudioSourceGroup[] | undefined {
  if (v === undefined || v === null) return undefined;
  if (!Array.isArray(v) || v.length === 0 || v.length > SOURCE_GROUPS.length) throw new ValidationError('Formats source invalides');
  return [...new Set(v.map((x) => oneOf(x, SOURCE_GROUPS, 'format source')))];
}

function validateAudio(v: unknown): AudioSettings {
  if (!isObj(v)) throw new ValidationError('Réglages audio manquants');
  return {
    format: oneOf(v.format, ['mp3', 'aac', 'flac', 'alac', 'wav', 'opus'] as const, 'format audio'),
    quality: oneOf(v.quality, [0, 2, 4, 6] as const, 'qualité MP3'),
    bitrateKbps: num(v.bitrateKbps, 32, 512, 'débit audio'),
    wavPreset: oneOf(v.wavPreset, ['source', 'cd', 'studio'] as const, 'réglage WAV'),
    sources: validateSources(v.sources) ?? ['wav'],
  };
}

function validateSelection(v: unknown, field: string, allowNone: boolean): TrackSelection {
  if (v === undefined) return { mode: 'all' };
  if (!isObj(v)) throw new ValidationError(`Valeur invalide pour ${field}`);
  const mode = oneOf(v.mode, (allowNone ? ['all', 'none', 'one'] : ['all', 'one']) as readonly TrackSelection['mode'][], field);
  if (mode !== 'one') return { mode };
  if (typeof v.key !== 'string' || !/^[#\w:-]{1,40}$/.test(v.key)) throw new ValidationError(`Valeur invalide pour ${field}`);
  return { mode, key: v.key };
}

function validateVideo(v: unknown): VideoSettings {
  if (!isObj(v)) throw new ValidationError('Réglages vidéo manquants');
  return {
    profile: oneOf(v.profile, ['youtube', 'archive', 'custom', 'remux'] as const, 'profil vidéo'),
    codec: oneOf(v.codec, ['h264', 'hevc'] as const, 'codec'),
    encoder: oneOf(v.encoder, ['auto', 'hardware', 'software'] as const, 'encodeur'),
    videoBitrateMbps: num(v.videoBitrateMbps, 0.1, 400, 'débit vidéo'),
    audioBitrateKbps: num(v.audioBitrateKbps, 32, 512, 'débit audio'),
    resolution: oneOf(v.resolution, ['source', '1080p', '720p'] as const, 'résolution'),
    container: oneOf(v.container, ['mp4', 'mov', 'mkv'] as const, 'conteneur'),
    audioSelection: validateSelection(v.audioSelection, 'pistes audio', false),
    subtitleSelection: validateSelection(v.subtitleSelection, 'sous-titres', true),
    burnSubtitles: v.burnSubtitles === true,
  };
}

function validateEdit(v: unknown): EditSettings {
  if (!isObj(v)) throw new ValidationError('Réglages d’édition manquants');
  const start = num(v.start, 0, 7 * 86_400, 'début');
  const end = num(v.end, 0, 7 * 86_400, 'fin');
  if (!(end > start)) throw new ValidationError('La fin doit être après le début');
  return {
    start,
    end,
    format: oneOf(v.format, ['same', 'vertical', 'square', 'landscape', 'gif'] as const, 'format'),
    frame: oneOf(v.frame, ['crop', 'blur', 'bars'] as const, 'cadrage'),
    precise: v.precise !== false,
    gifWidth: oneOf(v.gifWidth, [320, 480, 640] as const, 'largeur du GIF'),
    gifFps: oneOf(v.gifFps, [10, 15, 20] as const, 'images par seconde'),
  };
}

function validateNaming(v: unknown): OutputNaming | undefined {
  if (v === undefined || v === null) return undefined;
  if (!isObj(v)) throw new ValidationError('Nom de sortie invalide');
  const part = (x: unknown, whole: boolean): string | undefined => {
    if (x === undefined || x === null || x === '') return undefined;
    if (typeof x !== 'string') throw new ValidationError('Nom de sortie invalide');
    const problem = namingProblem(x, whole);
    if (problem) throw new ValidationError(problem);
    return x;
  };
  const prefix = part(v.prefix, false);
  if (prefix?.startsWith('.')) throw new ValidationError('Un nom qui commence par un point serait un fichier caché.');
  return { name: part(typeof v.name === 'string' ? v.name.trim() : v.name, true), prefix, suffix: part(v.suffix, false) };
}

export function validateJobRequest(v: unknown): JobRequest {
  if (!isObj(v)) throw new ValidationError('Requête invalide');
  const kind = validateKind(v.kind);
  if (!Array.isArray(v.itemIds) || v.itemIds.length === 0 || v.itemIds.length > 10_000 || v.itemIds.some((x) => typeof x !== 'string')) {
    throw new ValidationError('Aucun média sélectionné');
  }
  const dest = v.destination;
  if (!isObj(dest)) throw new ValidationError('Destination invalide');
  const mode = oneOf(dest.mode, ['beside', 'folder'] as const, 'destination');
  const destination = mode === 'folder' ? { mode, folder: validatePath(dest.folder, 'Dossier de sortie') } : { mode };
  const edit = v.edit === undefined ? undefined : validateEdit(v.edit);
  if (edit && (v.itemIds as unknown[]).length !== 1) throw new ValidationError('L’édition porte sur un seul fichier');
  if (typeof v.deleteSource !== 'boolean') throw new ValidationError('Option de conservation invalide');
  return {
    kind,
    itemIds: v.itemIds as string[],
    edit,
    audio: kind === 'audio' && !edit ? validateAudio(v.audio) : undefined,
    video: kind === 'video' && !edit ? validateVideo(v.video) : undefined,
    destination,
    collision: oneOf(v.collision, ['skip', 'replace', 'unique'] as const, 'gestion des doublons'),
    // Une édition crée toujours un nouveau fichier et ne touche jamais l'original.
    deleteSource: edit ? false : v.deleteSource,
    naming: edit ? undefined : validateNaming(v.naming),
  };
}
