import { typicalAudioBitrate } from '../../shared/estimate';
import type { ProbeInfo, SubtitleInfo } from '../../shared/types';
import { runCapture } from './process';

const BITMAP_SUBS = new Set(['hdmv_pgs_subtitle', 'dvd_subtitle', 'dvb_subtitle', 'xsub', 'dvb_teletext']);

interface RawStream {
  index: number;
  codec_type?: string;
  codec_name?: string;
  width?: number;
  height?: number;
  pix_fmt?: string;
  sample_aspect_ratio?: string;
  avg_frame_rate?: string;
  r_frame_rate?: string;
  disposition?: Record<string, number>;
  tags?: Record<string, string>;
  side_data_list?: { rotation?: number | string }[];
  duration?: string;
  sample_rate?: string;
  channels?: number;
  bits_per_raw_sample?: string;
  bits_per_sample?: number;
  sample_fmt?: string;
  bit_rate?: string;
}

/** Résolution d'une piste audio : explicite, sinon déduite du format d'échantillon. */
function audioBitsOf(s: RawStream | undefined): number | null {
  if (!s) return null;
  const raw = Number(s.bits_per_raw_sample);
  if (Number.isFinite(raw) && raw > 0) return raw;
  if (s.bits_per_sample && s.bits_per_sample > 0) return s.bits_per_sample;
  const fmt = s.sample_fmt ?? '';
  if (fmt.startsWith('s16')) return 16;
  if (fmt.startsWith('s32') || fmt.startsWith('flt')) return 32;
  if (fmt.startsWith('dbl') || fmt.startsWith('s64')) return 64;
  if (fmt.startsWith('u8')) return 8;
  return null;
}

/** Langue ISO 639-2 en minuscules ; « und » (indéterminée) est ignorée. */
function normLang(v: string | undefined): string | undefined {
  const l = v?.trim().toLowerCase();
  return l && l !== 'und' ? l : undefined;
}

/** Débit d'une piste : champ standard, sinon statistiques MKV (BPS, NUMBER_OF_BYTES). */
function streamBitrate(s: RawStream | undefined, duration: number): number | null {
  if (!s) return null;
  const direct = Number(s.bit_rate);
  if (Number.isFinite(direct) && direct > 0) return direct;
  const tags = s.tags ?? {};
  const get = (k: string) => tags[k] ?? tags[`${k}-eng`] ?? tags[`${k}-ENG`];
  const bps = Number(get('BPS'));
  if (Number.isFinite(bps) && bps > 0) return bps;
  const bytes = Number(get('NUMBER_OF_BYTES'));
  if (Number.isFinite(bytes) && bytes > 0 && duration > 0) return (bytes * 8) / duration;
  return null;
}

const numOrNull = (v: unknown): number | null => {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : null;
};

interface RawProbe {
  streams?: RawStream[];
  format?: { duration?: string; format_name?: string; bit_rate?: string };
  chapters?: unknown[];
}

function ratio(v: string | undefined): number | null {
  if (!v) return null;
  const [a, b] = v.split(/[:/]/).map(Number);
  if (!a || !b || !Number.isFinite(a) || !Number.isFinite(b)) return null;
  return a / b;
}

function rotationOf(s: RawStream): number {
  const side = s.side_data_list?.find((d) => d.rotation !== undefined);
  const raw = side?.rotation ?? s.tags?.rotate;
  const n = Number(raw);
  if (!Number.isFinite(n)) return 0;
  return ((Math.round(n) % 360) + 360) % 360;
}

export function parseProbe(json: string): ProbeInfo {
  const data = JSON.parse(json) as RawProbe;
  const streams = data.streams ?? [];
  const videos = streams.filter((s) => s.codec_type === 'video' && !s.disposition?.attached_pic);
  const main = videos[0];
  const audios = streams.filter((s) => s.codec_type === 'audio');
  const cover = streams.find((s) => s.codec_type === 'video' && s.disposition?.attached_pic);
  const subtitles: SubtitleInfo[] = streams
    .filter((s) => s.codec_type === 'subtitle')
    .map((s) => ({
      index: s.index,
      codec: s.codec_name ?? 'inconnu',
      bitmap: BITMAP_SUBS.has(s.codec_name ?? ''),
      language: normLang(s.tags?.language),
      title: s.tags?.title || undefined,
      forced: !!s.disposition?.forced || /forc/i.test(s.tags?.title ?? ''),
      isDefault: !!s.disposition?.default,
    }));

  let duration = Number(data.format?.duration);
  if (!Number.isFinite(duration) || duration <= 0) {
    const sd = streams.map((s) => Number(s.duration)).filter((n) => Number.isFinite(n) && n > 0);
    duration = sd.length ? Math.max(...sd) : NaN;
  }

  const sampleAspect = main ? ratio(main.sample_aspect_ratio) ?? 1 : 1;
  let displayWidth: number | null = null;
  let displayHeight: number | null = null;
  if (main?.width && main?.height) {
    let w = main.width * (sampleAspect > 0 ? sampleAspect : 1);
    let h = main.height;
    const rot = rotationOf(main);
    if (rot === 90 || rot === 270) [w, h] = [h, w];
    displayWidth = Math.round(w);
    displayHeight = Math.round(h);
  }

  const dur = Number.isFinite(duration) && duration > 0 ? duration : 0;
  const totalBitrate = numOrNull(data.format?.bit_rate);
  const audioRates = audios.map((a) => streamBitrate(a, dur));
  let videoBitrate = streamBitrate(main, dur);
  if (!videoBitrate && main && totalBitrate) {
    // Déduit : débit global moins les pistes audio (valeur typique si inconnue).
    const audioSum = audios.reduce((acc, a, i) => acc + (audioRates[i] ?? typicalAudioBitrate(a.codec_name ?? '', numOrNull(a.channels))), 0);
    const v = totalBitrate - audioSum;
    videoBitrate = v > 0 ? v : null;
  }

  return {
    durationSec: Number.isFinite(duration) && duration > 0 ? duration : null,
    formatName: data.format?.format_name ?? null,
    videoIndex: main ? main.index : null,
    videoCodec: main?.codec_name ?? null,
    width: main?.width ?? null,
    height: main?.height ?? null,
    displayWidth,
    displayHeight,
    pixFmt: main?.pix_fmt ?? null,
    sampleAspect: sampleAspect > 0 ? sampleAspect : 1,
    fps: ratio(main?.avg_frame_rate) ?? ratio(main?.r_frame_rate),
    extraVideoStreams: Math.max(0, videos.length - 1),
    videoBitrate,
    totalBitrate,
    audioIndexes: audios.map((s) => s.index),
    audioCodecs: audios.map((s) => s.codec_name ?? 'inconnu'),
    audioTracks: audios.map((s) => ({
      index: s.index,
      codec: s.codec_name ?? 'inconnu',
      language: normLang(s.tags?.language),
      title: s.tags?.title || undefined,
      channels: numOrNull(s.channels),
      isDefault: !!s.disposition?.default,
      bitrate: audioRates[audios.indexOf(s)] ?? null,
    })),
    audioSampleRate: numOrNull(audios[0]?.sample_rate),
    audioChannels: numOrNull(audios[0]?.channels),
    audioBits: audioBitsOf(audios[0]),
    audioBitrate: numOrNull(audios[0]?.bit_rate),
    coverIndex: cover ? cover.index : null,
    coverCodec: cover?.codec_name ?? null,
    subtitles,
    chapters: data.chapters?.length ?? 0,
    dataStreams: streams.filter((s) => s.codec_type === 'data').length,
    attachments: streams.filter((s) => s.codec_type === 'attachment').length,
  };
}

/**
 * Préfixe `file:` : empêche FFmpeg d'interpréter une partie du chemin comme un
 * protocole (ex. un nom contenant « : ») ou comme une option.
 */
export function fileUrl(p: string): string {
  return `file:${p}`;
}

export async function probeFile(ffprobe: string, file: string): Promise<ProbeInfo> {
  const r = await runCapture(
    ffprobe,
    ['-v', 'error', '-print_format', 'json', '-show_format', '-show_streams', '-show_chapters', fileUrl(file)],
    { timeoutMs: 30_000 },
  );
  if (r.code !== 0) {
    const msg = r.stderr.trim().split(/\r?\n/).pop() ?? '';
    throw new Error(msg || 'Analyse impossible');
  }
  return parseProbe(r.stdout);
}
