/**
 * Définition des profils d'encodage : métadonnées affichées, valeurs par défaut
 * et calculs purs (dimensions cibles, bitrate suggéré). Partagé main/renderer.
 */
import type {
  MediaKind,
  OutputNaming,
  AudioFormat,
  AudioSettings,
  AudioSourceGroup,
  Mp3Quality,
  WavPreset,
  ResolutionChoice,
  VideoContainer,
  VideoProfileId,
  VideoSettings,
} from './types';

export const VIDEO_EXTENSIONS = [
  'mp4', 'mov', 'm4v', 'mkv', 'avi', 'webm', 'mts', 'm2ts', 'ts',
  'mpg', 'mpeg', 'wmv', 'flv', '3gp', 'mxf', 'dv', 'ogv',
] as const;

/** Familles de sources audio, dans l'ordre d'affichage. */
export const AUDIO_SOURCE_GROUPS: { id: AudioSourceGroup; label: string; extensions: readonly string[] }[] = [
  { id: 'wav', label: 'WAV', extensions: ['wav', 'wave'] },
  { id: 'aiff', label: 'AIFF', extensions: ['aif', 'aiff', 'aifc'] },
  { id: 'flac', label: 'FLAC', extensions: ['flac'] },
  { id: 'm4a', label: 'M4A / AAC / ALAC', extensions: ['m4a', 'aac', 'caf'] },
  { id: 'mp3', label: 'MP3', extensions: ['mp3'] },
  { id: 'ogg', label: 'OGG / Opus', extensions: ['ogg', 'oga', 'opus'] },
  { id: 'video', label: 'Vidéos (extraire le son)', extensions: VIDEO_EXTENSIONS },
];

export function audioExtensions(groups: readonly AudioSourceGroup[]): string[] {
  const set = new Set<string>();
  for (const g of AUDIO_SOURCE_GROUPS) if (groups.includes(g.id)) g.extensions.forEach((e) => set.add(e));
  return [...set];
}

/* ------------------------------------------------------------------ */
/* Audio                                                               */
/* ------------------------------------------------------------------ */

/** Profil par défaut : WAV → MP3 haute qualité (-q:a 2). */
export const DEFAULT_AUDIO: AudioSettings = { format: 'mp3', quality: 2, bitrateKbps: 256, wavPreset: 'source', sources: ['wav'] };

export interface AudioFormatMeta {
  id: AudioFormat;
  title: string;
  ext: string;
  goal: string;
  lossless: boolean;
}

export const AUDIO_FORMATS: AudioFormatMeta[] = [
  { id: 'mp3', title: 'MP3', ext: 'mp3', lossless: false, goal: 'Lisible partout. Le choix par défaut pour partager ou écouter.' },
  { id: 'aac', title: 'AAC', ext: 'm4a', lossless: false, goal: 'Fichier .m4a, meilleur que le MP3 à débit égal. Idéal pour Apple Musique et les mobiles.' },
  { id: 'flac', title: 'FLAC', ext: 'flac', lossless: true, goal: 'Sans perte, environ 40 % plus léger que le WAV. Pour archiver.' },
  { id: 'alac', title: 'ALAC', ext: 'm4a', lossless: true, goal: 'Apple Lossless : sans perte, compatible Apple Musique et iPhone.' },
  { id: 'wav', title: 'WAV', ext: 'wav', lossless: true, goal: 'Non compressé, pour les logiciels audio ou le mastering.' },
  { id: 'opus', title: 'Opus', ext: 'opus', lossless: false, goal: 'Très efficace à bas débit : voix, podcasts, messages.' },
];

export function audioFormatMeta(f: AudioFormat): AudioFormatMeta {
  return AUDIO_FORMATS.find((x) => x.id === f) ?? AUDIO_FORMATS[0];
}

export const AAC_BITRATES = [128, 192, 256, 320];
export const OPUS_BITRATES = [64, 96, 128, 160, 192];

export const WAV_PRESETS: { value: WavPreset; label: string; hint: string }[] = [
  { value: 'source', label: 'Comme la source', hint: 'Même fréquence et même résolution que l’original.' },
  { value: 'cd', label: 'CD (16 bits, 44,1 kHz)', hint: 'Compatible partout. Un tramage est appliqué lors de la réduction en 16 bits.' },
  { value: 'studio', label: 'Studio (24 bits, 48 kHz)', hint: 'Standard de la vidéo et de la plupart des logiciels audio.' },
];

const LOSSLESS_CODECS = ['flac', 'alac', 'wavpack', 'ape', 'tta', 'truehd', 'mlp'];

/** Codec audio sans perte (PCM, FLAC, ALAC…) : sa résolution en bits a un sens. */
export function isLosslessAudioCodec(codec: string | null | undefined): boolean {
  if (!codec) return false;
  return codec.startsWith('pcm_') || LOSSLESS_CODECS.includes(codec);
}

/** Résolution utile de la source : 16 bits pour une source compressée avec perte. */
export function effectiveAudioBits(codec: string | null | undefined, bits: number | null | undefined): number {
  if (!isLosslessAudioCodec(codec) || !bits) return 16;
  return Math.min(32, Math.max(16, bits));
}

/** Débit moyen d'un MP3 VBR LAME, en kbit/s, pour l'estimation de taille. */
export const MP3_VBR_KBPS: Record<Mp3Quality, number> = { 0: 245, 2: 190, 4: 165, 6: 130 };

export const MP3_QUALITIES: { value: Mp3Quality; label: string; hint: string; kbps: string }[] = [
  { value: 0, label: 'Maximale', kbps: '≈ 245 kbit/s', hint: 'La meilleure qualité MP3, fichiers les plus lourds.' },
  { value: 2, label: 'Haute', kbps: '≈ 190 kbit/s', hint: 'Très bonne qualité, taille raisonnable. Recommandé.' },
  { value: 4, label: 'Standard', kbps: '≈ 165 kbit/s', hint: 'Bonne qualité pour l’écoute courante.' },
  { value: 6, label: 'Compacte', kbps: '≈ 130 kbit/s', hint: 'Fichiers légers, qualité suffisante pour la voix.' },
];

function sourcesLabel(s: AudioSettings): string {
  return s.sources.length === 1 && s.sources[0] === 'wav' ? 'WAV' : 'Audio';
}

export function audioProfileLabel(s: AudioSettings): string {
  const src = sourcesLabel(s);
  switch (s.format) {
    case 'mp3': {
      const q = MP3_QUALITIES.find((x) => x.value === s.quality);
      return `${src} → MP3, qualité ${q ? q.label.toLowerCase() : s.quality} (-q:a ${s.quality})`;
    }
    case 'aac':
      return `${src} → AAC (M4A), ${s.bitrateKbps} kbit/s`;
    case 'opus':
      return `${src} → Opus, ${s.bitrateKbps} kbit/s`;
    case 'flac':
      return `${src} → FLAC, sans perte`;
    case 'alac':
      return `${src} → ALAC (Apple Lossless)`;
    case 'wav':
    default: {
      const w = WAV_PRESETS.find((x) => x.value === s.wavPreset);
      return `${src} → WAV, ${w ? w.label.toLowerCase() : ''}`;
    }
  }
}

/* ------------------------------------------------------------------ */
/* Vidéo                                                               */
/* ------------------------------------------------------------------ */

export interface VideoProfileMeta {
  id: VideoProfileId;
  title: string;
  goal: string;
  specs: string[];
  suffix: string;
}

export const VIDEO_PROFILES: VideoProfileMeta[] = [
  {
    id: 'youtube',
    title: 'YouTube, résolution conservée',
    goal: 'Compresse pour la mise en ligne sans jamais réduire la résolution.',
    specs: ['H.264', '20 Mbit/s', 'AAC 384 kbit/s, 48 kHz', 'Résolution d’origine'],
    suffix: '_youtube',
  },
  {
    id: 'archive',
    title: 'Archivage, 1080p compact',
    goal: 'Réduit fortement le poids en HEVC, limité à 1080p, sans agrandir les petites sources.',
    specs: ['HEVC (H.265)', '4 Mbit/s', 'AAC 128 kbit/s', '1080p max'],
    suffix: '_archive_1080p',
  },
  {
    id: 'custom',
    title: 'Personnalisé',
    goal: 'Choisissez le codec, les débits, la résolution maximale et le conteneur.',
    specs: ['Codec au choix', 'Débits libres', 'MP4, MOV ou MKV'],
    suffix: '_custom',
  },
  {
    id: 'remux',
    title: 'Pistes seulement, sans réencodage',
    goal: 'Copie l’image et le son d’origine en retirant les pistes et sous-titres non voulus. Aucune perte, très rapide.',
    specs: ['Copie sans perte', 'Pistes au choix', 'MP4 ou MKV'],
    suffix: '_pistes',
  },
];

/** Par défaut : toutes les pistes audio et tous les sous-titres compatibles, sans incrustation. */
export const DEFAULT_TRACKS = {
  audioSelection: { mode: 'all' },
  subtitleSelection: { mode: 'all' },
  burnSubtitles: false,
} as const satisfies Pick<VideoSettings, 'audioSelection' | 'subtitleSelection' | 'burnSubtitles'>;

export function defaultVideoSettings(profile: VideoProfileId): VideoSettings {
  switch (profile) {
    case 'youtube':
      // Audio : recommandation YouTube pour l'envoi (AAC-LC stéréo 384 kbit/s, 48 kHz).
      return { profile, codec: 'h264', encoder: 'auto', videoBitrateMbps: 20, audioBitrateKbps: 384, resolution: 'source', container: 'mp4', ...DEFAULT_TRACKS };
    case 'archive':
      return { profile, codec: 'hevc', encoder: 'auto', videoBitrateMbps: 4, audioBitrateKbps: 128, resolution: '1080p', container: 'mp4', ...DEFAULT_TRACKS };
    case 'remux':
      // Débit audio utilisé seulement si une piste doit être convertie (DTS, TrueHD… vers AAC en MP4).
      return { profile, codec: 'h264', encoder: 'auto', videoBitrateMbps: 4, audioBitrateKbps: 384, resolution: 'source', container: 'mp4', ...DEFAULT_TRACKS };
    case 'custom':
    default:
      return { profile: 'custom', codec: 'h264', encoder: 'auto', videoBitrateMbps: 8, audioBitrateKbps: 160, resolution: 'source', container: 'mp4', ...DEFAULT_TRACKS };
  }
}

export function videoProfileMeta(id: VideoProfileId): VideoProfileMeta {
  return VIDEO_PROFILES.find((p) => p.id === id) ?? VIDEO_PROFILES[0];
}

export function videoSuffix(s: VideoSettings): string {
  if (s.profile === 'custom') {
    const res = s.resolution === 'source' ? '' : `_${s.resolution}`;
    return `_${s.codec}${res}`;
  }
  return videoProfileMeta(s.profile).suffix;
}

export function videoExtension(s: VideoSettings): VideoContainer {
  if (s.profile === 'remux') return s.container === 'mkv' ? 'mkv' : 'mp4';
  return s.profile === 'custom' ? s.container : 'mp4';
}

export function videoProfileLabel(s: VideoSettings): string {
  const meta = videoProfileMeta(s.profile);
  if (s.profile === 'custom') {
    const res = s.resolution === 'source' ? 'résolution d’origine' : `${s.resolution} max`;
    return `Personnalisé : ${s.codec === 'h264' ? 'H.264' : 'HEVC'}, ${formatMbps(s.videoBitrateMbps)}, ${res}, ${s.container.toUpperCase()}`;
  }
  if (s.profile === 'remux') return `Pistes seulement, sans réencodage (${videoExtension(s).toUpperCase()})`;
  return `${meta.title} (${formatMbps(s.videoBitrateMbps)})`;
}

export function formatMbps(v: number): string {
  return `${String(v).replace('.', ',')} Mbit/s`;
}

/**
 * Débit H.264 recommandé par YouTube pour l'envoi d'une vidéo SDR, selon le petit
 * côté de l'image et la cadence (support.google.com/youtube/answer/1722171).
 * Simple indication : ni la qualité ni la taille finale ne sont garanties.
 */
export function suggestYoutubeBitrate(displayWidth: number, displayHeight: number, fps?: number | null): { mbps: number; label: string } {
  const short = equivalentLines(displayWidth, displayHeight);
  const high = (fps ?? 30) > 40;
  const rate = high ? ' à 50-60 i/s' : '';
  if (short >= 2000) return { mbps: high ? 60 : 40, label: `4K${rate}` };
  if (short >= 1400) return { mbps: high ? 24 : 16, label: `1440p${rate}` };
  if (short >= 1000) return { mbps: high ? 12 : 8, label: `1080p${rate}` };
  if (short >= 700) return { mbps: high ? 7.5 : 5, label: `720p${rate}` };
  return { mbps: high ? 4 : 2.5, label: `définition standard${rate}` };
}

/** Boîte maximale (grand côté × petit côté) associée à un choix de résolution. */
export function resolutionBox(choice: ResolutionChoice): { long: number; short: number } | null {
  if (choice === '1080p') return { long: 1920, short: 1080 };
  if (choice === '720p') return { long: 1280, short: 720 };
  return null;
}

const even = (v: number): number => Math.max(2, Math.round(v / 2) * 2);

/**
 * Dimensions de sortie : conserve le ratio, n'agrandit jamais, respecte la boîte
 * (orientée selon la source : 1920 × 1080 en paysage, 1080 × 1920 en portrait)
 * et renvoie des dimensions paires, compatibles avec les encodeurs 4:2:0.
 * `scaled` vaut false si la source peut être encodée telle quelle.
 */
export function computeTargetSize(
  displayWidth: number,
  displayHeight: number,
  choice: ResolutionChoice,
): { width: number; height: number; scaled: boolean; downscaled: boolean } {
  const w = Math.max(1, Math.round(displayWidth));
  const h = Math.max(1, Math.round(displayHeight));
  const box = resolutionBox(choice);
  let factor = 1;
  if (box) {
    const landscape = w >= h;
    const maxW = landscape ? box.long : box.short;
    const maxH = landscape ? box.short : box.long;
    factor = Math.min(1, maxW / w, maxH / h);
  }
  let width = factor < 1 ? even(w * factor) : w % 2 === 0 ? w : w - 1;
  let height = factor < 1 ? even(h * factor) : h % 2 === 0 ? h : h - 1;
  // Garde-fou : l'arrondi pair ne doit pas dépasser la boîte.
  if (box) {
    const landscape = w >= h;
    const maxW = landscape ? box.long : box.short;
    const maxH = landscape ? box.short : box.long;
    if (width > maxW) width = maxW - (maxW % 2);
    if (height > maxH) height = maxH - (maxH % 2);
  }
  width = Math.max(2, width);
  height = Math.max(2, height);
  return { width, height, scaled: width !== w || height !== h, downscaled: factor < 1 };
}

/* ------------------------------------------------------------------ */
/* Conversions audio inutiles                                          */
/* ------------------------------------------------------------------ */

/** Codec d'une source déjà au format de sortie (hors WAV, traité à part). */
const SAME_CODEC: Partial<Record<AudioFormat, (codec: string) => boolean>> = {
  mp3: (c) => c === 'mp3',
  aac: (c) => c === 'aac',
  opus: (c) => c === 'opus',
  flac: (c) => c === 'flac',
  alac: (c) => c === 'alac',
};

const WAV_TARGET: Record<Exclude<WavPreset, 'source'>, { bits: number; rate: number }> = {
  cd: { bits: 16, rate: 44_100 },
  studio: { bits: 24, rate: 48_000 },
};

/**
 * Raison pour laquelle convertir ce fichier avec ces réglages n'apporterait rien
 * (même format, ou WAV identique ou « gonflé »), ou null si la conversion est utile.
 * Extraire le son d'une vidéo est toujours utile.
 */
export function uselessAudioReason(
  item: { ext: string; status: string; probe?: { videoIndex: number | null; audioCodecs: string[]; audioBits: number | null; audioSampleRate: number | null } },
  s: AudioSettings,
): string | null {
  const p = item.probe;
  if (!p || item.status !== 'ready' || p.videoIndex !== null) return null;
  const codec = p.audioCodecs[0] ?? '';
  if (s.format === 'wav') {
    const isWav = (item.ext === 'wav' || item.ext === 'wave') && codec.startsWith('pcm_');
    if (!isWav) return null;
    if (s.wavPreset === 'source') return 'Déjà en WAV : une copie identique n’apporterait rien.';
    const bits = effectiveAudioBits(codec, p.audioBits);
    const rate = p.audioSampleRate ?? 0;
    const t = WAV_TARGET[s.wavPreset];
    if (bits <= t.bits && rate <= t.rate) {
      return bits === t.bits && rate === t.rate
        ? 'Déjà dans ce format WAV.'
        : 'Augmenter la résolution ou la fréquence n’améliore pas le son et alourdit le fichier.';
    }
    return null;
  }
  const same = SAME_CODEC[s.format];
  if (same && same(codec)) {
    const title = audioFormatMeta(s.format).title;
    return `Déjà en ${title} : le réencoder ne ferait que dégrader ou dupliquer le fichier.`;
  }
  return null;
}

/** Suffixe ajouté quand la sortie a la même extension que la source (ex. WAV 24 bits → WAV CD). */
export function sameExtSuffix(s: AudioSettings): string {
  if (s.format === 'wav') return s.wavPreset === 'cd' ? '_CD' : '_studio';
  return `_${s.format}`;
}

/** Version minimale conseillée de FFmpeg (6.0, 2023). Les compilations « git » ne sont pas jugées. */
export const MIN_FFMPEG_MAJOR = 6;

export function ffmpegVersionAdvice(version: string | null): string | null {
  const m = version?.match(/^n?(\d+)\.(\d+)/);
  if (!m) return null;
  const major = Number(m[1]);
  if (major >= MIN_FFMPEG_MAJOR) return null;
  return `FFmpeg ${version} est ancien. Les conversions fonctionnent, mais une version récente est plus rapide et plus fiable : brew upgrade ffmpeg`;
}

/** Suffixe ajouté par défaut au nom d'origine (ex. « _archive_1080p »). */
export function defaultNameSuffix(srcName: string, kind: MediaKind, audio: AudioSettings, video: VideoSettings): string {
  const srcExt = srcName.includes('.') ? srcName.split('.').pop()!.toLowerCase() : '';
  if (kind === 'audio') return audioFormatMeta(audio.format).ext === srcExt ? sameExtSuffix(audio) : '';
  return videoSuffix(video);
}

/**
 * Nom du fichier de sortie. Sans `naming` : nom d'origine + suffixe du profil.
 * Avec `naming` : nom complet choisi (un seul fichier) ou texte ajouté avant/après.
 */
export function outputFileName(
  srcName: string,
  kind: MediaKind,
  audio: AudioSettings,
  video: VideoSettings,
  naming?: OutputNaming,
  single = false,
): string {
  const dot = srcName.lastIndexOf('.');
  const base = dot > 0 ? srcName.slice(0, dot) : srcName;
  const ext = kind === 'audio' ? audioFormatMeta(audio.format).ext : videoExtension(video);
  if (naming) {
    const name = naming.name?.trim();
    if (single && name) return `${name}.${ext}`;
    return `${naming.prefix ?? ''}${base}${naming.suffix ?? ''}.${ext}`;
  }
  return `${base}${defaultNameSuffix(srcName, kind, audio, video)}.${ext}`;
}

/** Problème dans un nom ou un morceau de nom saisi (null si correct). */
export function namingProblem(text: string, whole = false): string | null {
  if (!text) return whole ? 'Le nom ne peut pas être vide.' : null;
  if (text.length > 180) return 'Nom trop long (180 caractères au maximum).';
  if (/[/:\\\u0000-\u001f]/.test(text)) return 'Les caractères / et : ne sont pas autorisés dans un nom de fichier.';
  if (whole && text.trim().startsWith('.')) return 'Un nom qui commence par un point serait un fichier caché.';
  return null;
}

/* ------------------------------------------------------------------ */
/* Conseils de réglage vidéo                                           */
/* ------------------------------------------------------------------ */

export interface VideoAdviceRow {
  res: string;
  /** Envoi sur YouTube, H.264 (recommandations YouTube, 24-30 i/s). */
  youtube: number;
  /** HEVC, très bonne qualité (archivage). */
  hevc: number;
  /** HEVC compact, bonne qualité sur écran ou téléphone. */
  compact: number;
}

/** Débits vidéo conseillés en Mbit/s, pour 24 à 30 images par seconde. */
export const VIDEO_ADVICE: VideoAdviceRow[] = [
  { res: '720p', youtube: 5, hevc: 2.5, compact: 1.5 },
  { res: '1080p', youtube: 8, hevc: 4, compact: 2.5 },
  { res: '1440p', youtube: 16, hevc: 8, compact: 5 },
  { res: '4K', youtube: 40, hevc: 16, compact: 10 },
];

/** Débits AAC conseillés selon le contenu. */
export const AUDIO_ADVICE: { use: string; kbps: string }[] = [
  { use: 'Voix : tutoriel, réunion, podcast', kbps: '96 à 128 kbit/s' },
  { use: 'Film ou série en stéréo', kbps: '160 à 192 kbit/s' },
  { use: 'Musique, concert, clip', kbps: '256 à 320 kbit/s' },
  { use: 'Son multicanal 5.1', kbps: '384 kbit/s' },
  { use: 'Envoi sur YouTube', kbps: '384 kbit/s' },
];

/**
 * Nombre de lignes « équivalent 16:9 » d'une image : un film 1920×800 (cinémascope)
 * est un 1080p, une vidéo verticale 1080×1920 aussi.
 */
export function equivalentLines(width: number, height: number): number {
  const short = Math.min(width, height);
  const long = Math.max(width, height);
  return Math.max(short, Math.round((long * 9) / 16));
}

/** Ligne de conseils correspondant à une image. */
export function videoAdviceFor(width: number, height: number, fps?: number | null): { row: VideoAdviceRow; factor: number } {
  const short = equivalentLines(width, height);
  const row = short > 1600 ? VIDEO_ADVICE[3] : short > 1200 ? VIDEO_ADVICE[2] : short > 800 ? VIDEO_ADVICE[1] : VIDEO_ADVICE[0];
  // 50-60 images/s : environ moitié plus de débit pour la même qualité.
  return { row, factor: (fps ?? 30) > 40 ? 1.5 : 1 };
}
