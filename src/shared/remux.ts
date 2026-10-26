/**
 * Mode « Pistes seulement » : la vidéo et le son sont copiés tels quels.
 * Seules les pistes audio incompatibles avec le MP4 sur les appareils Apple
 * (DTS, TrueHD, FLAC, Opus, PCM, Vorbis…) sont converties en AAC.
 */
import type { AudioTrackInfo, VideoContainer } from './types';

/** Codecs audio copiés tels quels en MP4 (lus par QuickTime, iPhone, Apple TV). */
export const MP4_COPY_AUDIO = new Set(['aac', 'ac3', 'eac3', 'mp3', 'alac']);
/** Codecs vidéo copiables en MP4. */
export const MP4_COPY_VIDEO = new Set(['h264', 'hevc', 'av1', 'mpeg4']);

export interface RemuxAudioPlan {
  copy: boolean;
  /** Débit AAC (kbit/s) si la piste doit être convertie. */
  aacKbps: number;
}

export function remuxAudioPlan(t: AudioTrackInfo, container: VideoContainer): RemuxAudioPlan {
  const copy = container === 'mkv' || MP4_COPY_AUDIO.has(t.codec);
  const ch = t.channels ?? 2;
  return { copy, aacKbps: ch > 2 ? 384 : 192 };
}

export function containerFamily(ext: string): 'mp4' | 'mkv' | 'other' {
  if (['mp4', 'm4v', 'mov'].includes(ext)) return 'mp4';
  if (ext === 'mkv' || ext === 'webm') return 'mkv';
  return 'other';
}
