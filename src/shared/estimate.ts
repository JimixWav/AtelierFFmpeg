/**
 * Estimation de la taille des fichiers de sortie, à partir de la durée et des
 * caractéristiques de la source (ffprobe) et des réglages choisis.
 * Ce n'est qu'un ordre de grandeur : le résultat réel dépend du contenu.
 */
import { effectiveAudioBits, MP3_VBR_KBPS, uselessAudioReason } from './profiles';
import { containerFamily, remuxAudioPlan } from './remux';
import { resolveAudioTracks, resolveSubtitles } from './tracks';
import type { AudioSettings, AudioTrackInfo, MediaItem, MediaKind, VideoSettings } from './types';

/** Surcoût du conteneur (index, métadonnées). */
const CONTAINER_OVERHEAD = 1.01;
/** Taux de compression typique d'une musique en FLAC / ALAC par rapport au PCM. */
const LOSSLESS_RATIO = { flac: 0.58, alac: 0.62 };

function pcmBytesPerSecond(sampleRate: number, channels: number, bits: number): number {
  return (sampleRate * channels * bits) / 8;
}

export function estimateAudioBytes(item: MediaItem, s: AudioSettings): number | null {
  const p = item.probe;
  const dur = p?.durationSec;
  if (!p || !dur || dur <= 0) return null;
  const rate = p.audioSampleRate ?? 44_100;
  const ch = p.audioChannels ?? 2;
  const bits = Math.min(24, effectiveAudioBits(p.audioCodecs[0], p.audioBits));
  let bps: number;
  switch (s.format) {
    case 'mp3':
      bps = (MP3_VBR_KBPS[s.quality] * 1000) / 8;
      break;
    case 'aac':
    case 'opus':
      bps = (s.bitrateKbps * 1000) / 8;
      break;
    case 'flac':
      bps = pcmBytesPerSecond(rate, ch, bits) * LOSSLESS_RATIO.flac;
      break;
    case 'alac':
      bps = pcmBytesPerSecond(rate, ch, bits) * LOSSLESS_RATIO.alac;
      break;
    case 'wav':
    default:
      if (s.wavPreset === 'cd') bps = pcmBytesPerSecond(44_100, ch, 16);
      else if (s.wavPreset === 'studio') bps = pcmBytesPerSecond(48_000, ch, 24);
      else bps = pcmBytesPerSecond(rate, ch, bits);
      break;
  }
  return Math.round(bps * dur * CONTAINER_OVERHEAD + 4096);
}

/** Débit typique d'une piste audio quand le fichier ne l'indique pas (bit/s). */
export function typicalAudioBitrate(codec: string, channels: number | null): number {
  const multi = (channels ?? 2) > 2;
  switch (codec) {
    case 'ac3':
      return multi ? 448_000 : 192_000;
    case 'eac3':
      return multi ? 640_000 : 224_000;
    case 'dts':
      return 1_509_000;
    case 'truehd':
    case 'mlp':
      return 3_000_000;
    case 'flac':
      return multi ? 2_500_000 : 800_000;
    case 'opus':
    case 'vorbis':
      return multi ? 256_000 : 128_000;
    case 'mp3':
      return 192_000;
    case 'aac':
      return multi ? 384_000 : 160_000;
    default:
      if (codec.startsWith('pcm_')) return (channels ?? 2) * 48_000 * 16;
      return multi ? 448_000 : 192_000;
  }
}

function trackBitrate(t: AudioTrackInfo): number {
  return t.bitrate ?? typicalAudioBitrate(t.codec, t.channels);
}

/** Débit moyen réel du fichier (bit/s). */
export function sourceBitrate(item: MediaItem): number | null {
  const dur = item.probe?.durationSec;
  if (item.probe?.totalBitrate) return item.probe.totalBitrate;
  return dur && dur > 0 ? (item.size * 8) / dur : null;
}

/** Débit vidéo de la source (bit/s) : mesuré, sinon débit global moins l'audio. */
export function sourceVideoBitrate(item: MediaItem): number | null {
  const p = item.probe;
  if (!p) return null;
  if (p.videoBitrate) return p.videoBitrate;
  const total = sourceBitrate(item);
  if (!total) return null;
  const v = total - p.audioTracks.reduce((a, t) => a + trackBitrate(t), 0);
  return v > 0 ? v : null;
}

/** Taille d'une copie sans réencodage : vidéo d'origine + pistes audio gardées. */
function estimateRemuxBytes(item: MediaItem, s: VideoSettings): number | null {
  const p = item.probe;
  const dur = p?.durationSec;
  if (!p || !dur || dur <= 0) return null;
  const video = sourceVideoBitrate(item);
  if (!video) return null;
  const kept = new Set(resolveAudioTracks(p, s.audioSelection ?? { mode: 'all' }).indexes);
  const container = s.container === 'mkv' ? 'mkv' : 'mp4';
  let audio = 0;
  for (const t of p.audioTracks) {
    if (!kept.has(t.index)) continue;
    const plan = remuxAudioPlan(t, container);
    audio += plan.copy ? trackBitrate(t) : plan.aacKbps * 1000;
  }
  return Math.min(item.size * 1.01, Math.round(((video + audio) / 8) * dur * 1.005));
}

export function estimateVideoBytes(item: MediaItem, s: VideoSettings): number | null {
  if (s.profile === 'remux') return estimateRemuxBytes(item, s);
  const p = item.probe;
  const dur = p?.durationSec;
  if (!p || !dur || dur <= 0) return null;
  const audioBps = resolveAudioTracks(p, s.audioSelection ?? { mode: 'all' }).indexes.length * s.audioBitrateKbps * 1000;
  const bps = (s.videoBitrateMbps * 1_000_000 + audioBps) / 8;
  return Math.round(bps * dur * CONTAINER_OVERHEAD);
}

const mbpsLabel = (bps: number) => `${(bps / 1_000_000).toFixed(1).replace('.', ',')} Mbit/s`;

/**
 * Raison pour laquelle convertir cette vidéo ne servirait à rien (null sinon) :
 * - « Pistes seulement » sans piste à retirer ni changement de conteneur ;
 * - réencodage qui rendrait le fichier plus lourd, sans gain de compatibilité
 *   (le passage d'un autre codec vers H.264 reste permis : il améliore la compatibilité).
 */
export function uselessVideoReason(item: MediaItem, s: VideoSettings): string | null {
  const p = item.probe;
  if (item.status !== 'ready' || !p) return null;
  if (s.profile === 'remux') {
    const keptAudio = resolveAudioTracks(p, s.audioSelection ?? { mode: 'all' }).indexes.length;
    const keptSubs = resolveSubtitles(p, s.subtitleSelection ?? { mode: 'all' }).subs.length;
    const container = s.container === 'mkv' ? 'mkv' : 'mp4';
    const converts = p.audioTracks.some((t) => !remuxAudioPlan(t, container).copy);
    const removes = keptAudio < p.audioTracks.length || keptSubs < p.subtitles.length || p.extraVideoStreams > 0 || p.dataStreams > 0;
    if (!removes && !converts && containerFamily(item.ext) === container) {
      return 'Rien à retirer : toutes les pistes sont gardées et le format ne change pas.';
    }
    return null;
  }
  if (s.burnSubtitles && s.subtitleSelection?.mode === 'one') return null;
  const target = s.profile === 'youtube' ? 'h264' : s.profile === 'archive' ? 'hevc' : s.codec;
  if (target === 'h264' && p.videoCodec !== 'h264') return null;
  const est = estimateVideoBytes(item, s);
  if (est === null || est <= item.size * 0.97) return null;
  const now = sourceBitrate(item);
  return `Déjà compressée${now ? ` à ${mbpsLabel(now)}` : ''}, moins que ce réglage : elle deviendrait plus lourde. Baissez le débit vidéo, ou choisissez « Pistes seulement » pour retirer des pistes sans réencoder.`;
}

export function estimateBytes(item: MediaItem, kind: MediaKind, audio?: AudioSettings, video?: VideoSettings): number | null {
  if (item.status !== 'ready') return null;
  if (kind === 'audio' && audio && uselessAudioReason(item, audio)) return null;
  if (kind === 'video' && video && uselessVideoReason(item, video)) return null;
  if (kind === 'audio') return audio ? estimateAudioBytes(item, audio) : null;
  return video ? estimateVideoBytes(item, video) : null;
}

export interface EstimateSummary {
  count: number;
  /** Fichiers dont la durée est inconnue (non estimés). */
  unknown: number;
  sizeIn: number;
  sizeOut: number;
  /** Variation relative : -0.74 = 74 % plus léger. */
  delta: number | null;
  /** Fichiers qui risquent d'être plus lourds que l'original. */
  larger: number;
  /** Fichiers ignorés car la conversion n'apporterait rien (même format). */
  useless: number;
}

export function summarizeEstimates(items: MediaItem[], kind: MediaKind, audio?: AudioSettings, video?: VideoSettings): EstimateSummary {
  const out: EstimateSummary = { count: 0, unknown: 0, sizeIn: 0, sizeOut: 0, delta: null, larger: 0, useless: 0 };
  for (const it of items) {
    if (it.status !== 'ready') continue;
    if ((kind === 'audio' && audio && uselessAudioReason(it, audio)) || (kind === 'video' && video && uselessVideoReason(it, video))) {
      out.useless++;
      continue;
    }
    const e = estimateBytes(it, kind, audio, video);
    if (e === null) {
      out.unknown++;
      continue;
    }
    out.count++;
    out.sizeIn += it.size;
    out.sizeOut += e;
    if (e > it.size * 1.02) out.larger++;
  }
  if (out.sizeIn > 0) out.delta = out.sizeOut / out.sizeIn - 1;
  return out;
}
