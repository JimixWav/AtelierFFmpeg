/**
 * Construction des arguments FFmpeg. Fonctions pures : aucune exécution ici.
 * Chaque argument est un élément de tableau ; aucun chemin n'est concaténé
 * dans une chaîne shell.
 */
import { computeTargetSize, effectiveAudioBits, formatMbps } from '../../shared/profiles';
import type {
  AudioSettings,
  EncoderPreference,
  Environment,
  ProbeInfo,
  VideoCodecFamily,
  VideoContainer,
  VideoSettings,
} from '../../shared/types';
import { fileUrl } from './probe';
import { MP4_COPY_VIDEO, remuxAudioPlan } from '../../shared/remux';
import { keyLabel, langLabel, resolveAudioTracks, resolveSubtitles, subtitleKey } from '../../shared/tracks';

/** Échappement d'une valeur d'option de filtre (niveau 1 : \\ ' :). */
export function escapeFilterValue(v: string): string {
  return v.replace(/[\\':]/g, '\\$&');
}

/** Échappement au niveau du graphe de filtres (niveau 2 : \\ ' [ ] , ;). */
export function escapeFiltergraph(v: string): string {
  return v.replace(/[\\'[\],;]/g, '\\$&');
}

export interface BuiltCommand {
  args: string[];
  notes: string[];
  encoder?: string;
  summary: string;
}

export class PlanError extends Error {}

const COMMON_HEAD = ['-hide_banner', '-nostdin', '-n'];
const PROGRESS = ['-progress', 'pipe:1', '-nostats'];

/* ------------------------------------------------------------------ */
/* Audio                                                               */
/* ------------------------------------------------------------------ */

const COVER_CODECS = new Set(['mjpeg', 'png']);

/** Encodeur AAC : AudioToolbox d'Apple (meilleure qualité) si disponible, sinon l'encodeur natif. */
export function aacEncoder(env: Environment | null): string {
  return env?.encoders.aac_at?.usable ? 'aac_at' : 'aac';
}

export function buildAudioArgs(input: string, output: string, s: AudioSettings, probe: ProbeInfo | undefined, env: Environment | null): BuiltCommand {
  if (probe && probe.audioIndexes.length === 0) throw new PlanError('Aucune piste audio dans ce fichier.');
  const notes: string[] = [];
  const srcCodec = probe?.audioCodecs[0] ?? null;
  const bits = effectiveAudioBits(srcCodec, probe?.audioBits);
  const args: string[] = [...COMMON_HEAD, '-i', fileUrl(input), '-map', '0:a:0'];

  // Pochette intégrée : conservée pour les formats qui la prennent en charge.
  const keepCover =
    (s.format === 'mp3' || s.format === 'flac' || s.format === 'aac' || s.format === 'alac') &&
    probe?.coverIndex !== null && probe?.coverIndex !== undefined && COVER_CODECS.has(probe.coverCodec ?? '');
  if (keepCover && probe) {
    args.push('-map', `0:${probe.coverIndex}`, '-c:v', 'copy', '-disposition:v:0', 'attached_pic');
    notes.push('Pochette conservée.');
  }
  args.push('-map_metadata', '0');
  if (probe && probe.audioIndexes.length > 1) notes.push(`Seule la première des ${probe.audioIndexes.length} pistes audio est convertie.`);
  if (probe?.videoIndex !== null && probe?.videoIndex !== undefined) notes.push('Son extrait de la vidéo.');

  let encoder: string;
  let summary: string;
  let muxer: string;
  switch (s.format) {
    case 'mp3':
      encoder = 'libmp3lame';
      args.push('-c:a', encoder, '-q:a', String(s.quality), '-id3v2_version', '3');
      muxer = 'mp3';
      summary = `MP3 VBR -q:a ${s.quality}`;
      break;
    case 'aac':
      encoder = aacEncoder(env);
      args.push('-c:a', encoder, '-b:a', `${s.bitrateKbps}k`, '-movflags', '+faststart');
      muxer = 'ipod';
      summary = `AAC ${s.bitrateKbps} kbit/s (${encoder === 'aac_at' ? 'Apple AudioToolbox' : 'encodeur FFmpeg'})`;
      break;
    case 'opus':
      encoder = 'libopus';
      args.push('-c:a', encoder, '-b:a', `${s.bitrateKbps}k`, '-vbr', 'on');
      muxer = 'opus';
      summary = `Opus ${s.bitrateKbps} kbit/s`;
      break;
    case 'flac':
      encoder = 'flac';
      args.push('-c:a', 'flac', '-compression_level', '8');
      if (bits > 16) args.push('-sample_fmt', 's32', '-bits_per_raw_sample', '24');
      else args.push('-sample_fmt', 's16');
      muxer = 'flac';
      summary = `FLAC ${bits > 16 ? 24 : 16} bits, sans perte`;
      break;
    case 'alac':
      encoder = 'alac';
      args.push('-c:a', 'alac');
      if (bits > 16) args.push('-sample_fmt', 's32p', '-bits_per_raw_sample', '24');
      else args.push('-sample_fmt', 's16p');
      args.push('-movflags', '+faststart');
      muxer = 'ipod';
      summary = `ALAC ${bits > 16 ? 24 : 16} bits, sans perte`;
      break;
    case 'wav':
    default: {
      encoder = 'pcm';
      if (s.wavPreset === 'cd') {
        args.push('-af', 'aresample=osr=44100:osf=s16:dither_method=triangular', '-c:a', 'pcm_s16le');
        summary = 'WAV 16 bits, 44,1 kHz';
        if (bits > 16) notes.push('Réduction en 16 bits avec tramage (dither).');
      } else if (s.wavPreset === 'studio') {
        args.push('-af', 'aresample=osr=48000', '-c:a', 'pcm_s24le');
        summary = 'WAV 24 bits, 48 kHz';
      } else {
        const codec = srcCodec && srcCodec.startsWith('pcm_') ? srcCodec : bits >= 32 ? 'pcm_s32le' : bits > 16 ? 'pcm_s24le' : 'pcm_s16le';
        args.push('-c:a', codec);
        summary = `WAV ${codec.replace('pcm_', '').toUpperCase()}`;
      }
      args.push('-rf64', 'auto');
      muxer = 'wav';
      break;
    }
  }
  if (!keepCover) args.push('-vn');
  args.push(...PROGRESS, '-f', muxer, fileUrl(output));
  return { args, notes, encoder, summary };
}

/* ------------------------------------------------------------------ */
/* Vidéo                                                               */
/* ------------------------------------------------------------------ */

const ENCODERS: Record<VideoCodecFamily, { hardware: string; software: string; label: string }> = {
  h264: { hardware: 'h264_videotoolbox', software: 'libx264', label: 'H.264' },
  hevc: { hardware: 'hevc_videotoolbox', software: 'libx265', label: 'HEVC' },
};

export interface EncoderChoice {
  encoder: string;
  hardware: boolean;
  /** Message affiché si un repli a été nécessaire. */
  fallbackNote?: string;
}

export function resolveEncoder(env: Environment, codec: VideoCodecFamily, pref: EncoderPreference): EncoderChoice {
  const e = ENCODERS[codec];
  const hw = env.encoders[e.hardware];
  const sw = env.encoders[e.software];
  const hwOk = !!hw?.usable;
  const swOk = !!sw?.usable;

  if (pref === 'hardware') {
    if (hwOk) return { encoder: e.hardware, hardware: true };
    throw new PlanError(
      `L’encodeur matériel ${e.hardware} n’est pas disponible sur ce Mac. Choisissez « Automatique » ou « Logiciel » dans les réglages avancés.`,
    );
  }
  if (pref === 'software') {
    if (swOk) return { encoder: e.software, hardware: false };
    throw new PlanError(`L’encodeur logiciel ${e.software} n’est pas inclus dans votre FFmpeg.`);
  }
  if (hwOk) return { encoder: e.hardware, hardware: true };
  if (swOk) {
    return {
      encoder: e.software,
      hardware: false,
      fallbackNote: `Encodeur matériel ${e.hardware} indisponible : repli sur ${e.software} (logiciel, plus lent, même résultat attendu).`,
    };
  }
  throw new PlanError(
    `Aucun encodeur ${e.label} disponible (${e.hardware} et ${e.software} absents). Installez une version complète de FFmpeg : brew install ffmpeg`,
  );
}

const TEXT_SUBS_FOR_MP4 = new Set(['subrip', 'srt', 'ass', 'ssa', 'mov_text', 'webvtt', 'text']);
const SAFE_420 = new Set(['yuv420p', 'yuvj420p', 'nv12']);
const SAFE_420_10 = new Set(['yuv420p10le', 'p010le']);

/** « Pistes seulement » : copie sans réencodage, en ne gardant que les pistes choisies. */
function buildRemuxArgs(input: string, output: string, s: VideoSettings, probe: ProbeInfo): BuiltCommand {
  const container: VideoContainer = s.container === 'mkv' ? 'mkv' : 'mp4';
  const vcodec = probe.videoCodec ?? '';
  if (container === 'mp4' && !MP4_COPY_VIDEO.has(vcodec)) {
    throw new PlanError(`La vidéo (${vcodec || 'codec inconnu'}) ne peut pas être copiée en MP4 : choisissez MKV dans les réglages avancés.`);
  }
  const notes: string[] = [];
  const audioSel = resolveAudioTracks(probe, s.audioSelection ?? { mode: 'all' });
  if (audioSel.note) notes.push(audioSel.note);
  const subSel = resolveSubtitles(probe, s.subtitleSelection ?? { mode: 'all' });
  if (subSel.note) notes.push(subSel.note);

  const args: string[] = [...COMMON_HEAD, '-i', fileUrl(input), '-map', `0:${probe.videoIndex}`];
  const kept = probe.audioTracks.filter((t) => audioSel.indexes.includes(t.index));
  for (const t of kept) args.push('-map', `0:${t.index}`);
  const keptSubs = subSel.subs.filter((sub) => container === 'mkv' || (!sub.bitmap && TEXT_SUBS_FOR_MP4.has(sub.codec)));
  const droppedSubs = subSel.subs.filter((sub) => !keptSubs.includes(sub));
  for (const sub of keptSubs) args.push('-map', `0:${sub.index}`);
  args.push('-map_metadata', '0', '-map_chapters', '0', '-c:v', 'copy');
  if (container === 'mp4' && vcodec === 'hevc') args.push('-tag:v', 'hvc1');

  kept.forEach((t, i) => {
    const plan = remuxAudioPlan(t, container);
    if (plan.copy) args.push(`-c:a:${i}`, 'copy');
    else {
      args.push(`-c:a:${i}`, 'aac', `-b:a:${i}`, `${plan.aacKbps}k`);
      notes.push(`Piste ${langLabel(t.language)} (${t.codec.toUpperCase()}) convertie en AAC ${plan.aacKbps} kbit/s : ce format n’est pas lu en MP4 sur les appareils Apple.`);
    }
  });
  if (kept.length === 1 && probe.audioTracks.length > 1) args.push('-disposition:a:0', 'default');
  if (keptSubs.length) {
    args.push('-c:s', container === 'mkv' ? 'copy' : 'mov_text');
    if (s.subtitleSelection?.mode === 'one') args.push('-disposition:s:0', 'default');
  }
  const removedAudio = probe.audioTracks.length - kept.length;
  if (removedAudio > 0) notes.push(`${removedAudio} piste(s) audio retirée(s).`);
  if (probe.subtitles.length - keptSubs.length > 0) notes.push(`${probe.subtitles.length - keptSubs.length} piste(s) de sous-titres retirée(s).`);
  if (droppedSubs.length) notes.push(`Sous-titres image (${[...new Set(droppedSubs.map((d) => d.codec))].join(', ')}) impossibles en MP4 : choisissez MKV pour les garder.`);
  if (probe.extraVideoStreams > 0) notes.push(`${probe.extraVideoStreams} piste(s) vidéo secondaire(s) retirée(s).`);
  if (container === 'mp4') args.push('-movflags', '+faststart');
  args.push(...PROGRESS, '-f', container === 'mkv' ? 'matroska' : 'mp4', fileUrl(output));
  notes.unshift('Image copiée telle quelle : aucune perte de qualité.');
  return { args, notes, encoder: 'copy', summary: `Copie sans réencodage, ${container.toUpperCase()}` };
}

export function buildVideoArgs(
  input: string,
  output: string,
  s: VideoSettings,
  probe: ProbeInfo,
  env: Environment,
): BuiltCommand {
  if (probe.videoIndex === null || !probe.displayWidth || !probe.displayHeight) {
    throw new PlanError('Aucune piste vidéo exploitable dans ce fichier.');
  }
  if (s.profile === 'remux') return buildRemuxArgs(input, output, s, probe);
  const container: VideoContainer = s.profile === 'custom' ? s.container : 'mp4';
  const codec: VideoCodecFamily = s.profile === 'youtube' ? 'h264' : s.profile === 'archive' ? 'hevc' : s.codec;
  const resolution = s.profile === 'youtube' ? 'source' : s.profile === 'archive' ? '1080p' : s.resolution;
  const choice = resolveEncoder(env, codec, s.encoder);
  const notes: string[] = [];
  if (choice.fallbackNote) notes.push(choice.fallbackNote);

  const vb = Math.round(s.videoBitrateMbps * 1000);
  if (!(vb >= 100 && vb <= 400_000)) throw new PlanError('Débit vidéo invalide (entre 0,1 et 400 Mbit/s).');
  const ab = Math.round(s.audioBitrateKbps);
  if (!(ab >= 32 && ab <= 512)) throw new PlanError('Débit audio invalide (entre 32 et 512 kbit/s).');

  const args: string[] = [...COMMON_HEAD, '-i', fileUrl(input)];

  // Pistes retenues selon les choix de l'utilisateur.
  const audioSel = resolveAudioTracks(probe, s.audioSelection ?? { mode: 'all' });
  if (audioSel.note) notes.push(audioSel.note);
  const subSel = resolveSubtitles(probe, s.subtitleSelection ?? { mode: 'all' });
  if (subSel.note) notes.push(subSel.note);
  const burn = s.burnSubtitles && s.subtitleSelection?.mode === 'one' ? (subSel.subs[0] ?? null) : null;

  // Dimensions.
  const target = computeTargetSize(probe.displayWidth, probe.displayHeight, resolution);
  const filters: string[] = [];
  if (target.scaled) filters.push(`scale=${target.width}:${target.height}:flags=lanczos`);
  const sarNotSquare = Math.abs(probe.sampleAspect - 1) > 0.001;
  if (target.scaled || sarNotSquare) filters.push('setsar=1');

  // Vidéo : sous-titre incrusté (graphe de filtres) ou filtres simples.
  if (burn) {
    const post = filters.length ? `,${filters.join(',')}` : '';
    let graph: string;
    if (burn.bitmap) {
      graph = `[0:${probe.videoIndex}][0:${burn.index}]overlay=eof_action=pass${post}[vout]`;
    } else {
      const si = probe.subtitles.indexOf(burn);
      graph = `[0:${probe.videoIndex}]subtitles=filename=${escapeFiltergraph(escapeFilterValue(input))}:si=${si}${post}[vout]`;
    }
    args.push('-filter_complex', graph, '-map', '[vout]');
    notes.push(`Sous-titres ${keyLabel(subtitleKey(burn, probe.subtitles.indexOf(burn)), 'subtitle')} incrustés dans l’image.`);
  } else {
    args.push('-map', `0:${probe.videoIndex}`);
    if (filters.length) args.push('-vf', filters.join(','));
  }
  for (const idx of audioSel.indexes) args.push('-map', `0:${idx}`);

  // Sous-titres « activables » (non incrustés).
  const keptSubs: number[] = [];
  const droppedSubs: string[] = [];
  if (!burn) {
    for (const sub of subSel.subs) {
      if (container === 'mkv') keptSubs.push(sub.index);
      else if (!sub.bitmap && TEXT_SUBS_FOR_MP4.has(sub.codec)) keptSubs.push(sub.index);
      else droppedSubs.push(sub.codec);
    }
  }
  for (const idx of keptSubs) args.push('-map', `0:${idx}`);

  args.push('-map_metadata', '0', '-map_chapters', '0');

  // Vidéo.
  const level51Ok = target.width * target.height <= 4096 * 2304;
  args.push('-c:v', choice.encoder, '-b:v', `${vb}k`, '-maxrate', `${vb}k`, '-bufsize', `${vb * 2}k`);
  if (codec === 'h264') {
    args.push('-pix_fmt', 'yuv420p', '-profile:v', 'high');
    if (level51Ok) args.push('-level:v', '5.1');
    else notes.push('Résolution supérieure à la 4K : niveau H.264 5.1 non imposé.');
  } else {
    const pf = probe.pixFmt ?? '';
    if (!SAFE_420.has(pf) && !SAFE_420_10.has(pf)) args.push('-pix_fmt', 'yuv420p');
    if (container !== 'mkv') args.push('-tag:v', 'hvc1');
  }
  if (choice.encoder === 'libx264' || choice.encoder === 'libx265') args.push('-preset', 'medium');

  // Audio : uniquement si la source en possède.
  if (audioSel.indexes.length > 0) {
    args.push('-c:a', 'aac', '-b:a', `${ab}k`);
    // YouTube recommande un audio à 48 kHz.
    if (s.profile === 'youtube' && probe.audioSampleRate !== 48_000) args.push('-ar', '48000');
    if (audioSel.indexes.length > 1) notes.push(`${audioSel.indexes.length} pistes audio converties en AAC.`);
    else if (probe.audioTracks.length > 1) args.push('-disposition:a:0', 'default');
  } else {
    notes.push('Source sans piste audio : sortie vidéo seule.');
  }

  if (keptSubs.length) {
    args.push('-c:s', container === 'mkv' ? 'copy' : 'mov_text');
    // Un seul sous-titre choisi : affiché par défaut par les lecteurs qui respectent ce réglage.
    if (s.subtitleSelection?.mode === 'one') args.push('-disposition:s:0', 'default');
    notes.push(`${keptSubs.length} piste(s) de sous-titres conservée(s), à activer dans le lecteur.`);
  }
  if (droppedSubs.length) {
    notes.push(
      `Sous-titres omis (${[...new Set(droppedSubs)].join(', ')}) : format image incompatible avec ${container.toUpperCase()}. Choisissez-les et cochez « Incruster », ou sortez en MKV.`,
    );
  }
  if (probe.extraVideoStreams > 0) notes.push(`${probe.extraVideoStreams} piste(s) vidéo secondaire(s) omise(s).`);
  if (probe.dataStreams > 0) notes.push(`${probe.dataStreams} flux de données (timecode, GPS…) non copié(s).`);
  if (probe.attachments > 0) notes.push(`${probe.attachments} pièce(s) jointe(s) (polices…) non copiée(s).`);
  if (probe.chapters > 0) notes.push(`${probe.chapters} chapitre(s) conservé(s).`);

  if (container === 'mp4' || container === 'mov') args.push('-movflags', '+faststart');
  args.push(...PROGRESS, '-f', container === 'mkv' ? 'matroska' : container, fileUrl(output));

  if (target.downscaled) notes.unshift(`Redimensionnée de ${probe.displayWidth} × ${probe.displayHeight} à ${target.width} × ${target.height}.`);
  else if (target.scaled) notes.unshift(`Dimensions arrondies à ${target.width} × ${target.height} (valeurs paires requises).`);
  else if (resolution !== 'source') notes.unshift('Source déjà plus petite que la limite : résolution conservée.');

  return {
    args,
    notes,
    encoder: choice.encoder,
    summary: `${ENCODERS[codec].label} ${choice.hardware ? 'matériel' : 'logiciel'}, ${target.width} × ${target.height}, ${formatMbps(s.videoBitrateMbps)}`,
  };
}
