/**
 * Arguments FFmpeg pour l'onglet Édition : découpe, formats réseaux sociaux, GIF.
 */
import { editFormatMeta, editOutputExt, formatTimecode } from '../../shared/edit';
import type { EditSettings, Environment, MediaItem } from '../../shared/types';
import { PlanError, resolveEncoder, type BuiltCommand } from './args';
import { fileUrl } from './probe';

const PROGRESS = ['-progress', 'pipe:1', '-nostats'];
const LOSSLESS_AUDIO = (c: string) => c.startsWith('pcm_') || c === 'flac' || c === 'alac';
const COPYABLE_AUDIO = new Set(['mp3', 'aac', 'opus', 'vorbis']);

const MUXERS: Record<string, string> = {
  wav: 'wav', aiff: 'aiff', flac: 'flac', mp3: 'mp3', m4a: 'ipod', ogg: 'ogg', opus: 'opus',
  mp4: 'mp4', m4v: 'mp4', mov: 'mov', mkv: 'matroska', webm: 'webm', gif: 'gif',
};

const sec = (v: number) => v.toFixed(3);

/** Débit vidéo de la source (approx.), pour réencoder une découpe sans perte visible. */
function sourceVideoMbps(item: MediaItem): number {
  const dur = item.probe?.durationSec ?? 0;
  if (dur <= 0) return 12;
  const total = (item.size * 8) / dur / 1_000_000;
  const audio = ((item.probe?.audioTracks.length ?? 0) * 192) / 1000;
  return Math.max(2, Math.min(80, Math.round((total - audio) * 10) / 10));
}

export function buildEditArgs(item: MediaItem, output: string, e: EditSettings, env: Environment): BuiltCommand {
  const p = item.probe;
  if (!p) throw new PlanError('Analyse du fichier indisponible.');
  const isVideo = p.videoIndex !== null;
  const dur = Math.max(0.1, e.end - e.start);
  const ext = editOutputExt(item, e);
  const muxer = MUXERS[ext];
  if (!muxer) throw new PlanError(`Format de sortie .${ext} non pris en charge.`);
  const notes: string[] = [`Extrait de ${formatTimecode(e.start)} à ${formatTimecode(e.end)}.`];
  // -ss avant -i : recherche rapide ; avec réencodage, la découpe reste précise à l'image près.
  const args = ['-hide_banner', '-nostdin', '-n', '-ss', sec(e.start), '-i', fileUrl(item.path), '-t', sec(dur)];

  /* ---------------- Audio seul ---------------- */
  if (!isVideo) {
    if (!p.audioIndexes.length) throw new PlanError('Aucune piste audio dans ce fichier.');
    const codec = p.audioCodecs[0] ?? '';
    args.push('-map', '0:a:0', '-map_metadata', '0');
    let summary: string;
    const natural: Record<string, string[]> = { mp3: ['mp3'], aac: ['m4a'], opus: ['opus', 'ogg'], vorbis: ['ogg'] };
    if (LOSSLESS_AUDIO(codec)) {
      // Réencodage sans perte dans le même codec : découpe exacte à l'échantillon près.
      args.push('-c:a', ext === 'm4a' ? 'alac' : ext === 'flac' ? 'flac' : codec);
      summary = 'Découpe exacte, sans perte';
    } else if (COPYABLE_AUDIO.has(codec) && natural[codec]?.includes(ext)) {
      args.push('-c:a', 'copy');
      summary = 'Découpe sans réencodage (à quelques millisecondes près)';
      notes.push('Le son n’est pas réencodé : aucune perte de qualité.');
    } else if (ext === 'm4a') {
      args.push('-c:a', 'aac', '-b:a', '256k');
      summary = 'AAC 256 kbit/s';
    } else {
      throw new PlanError(`Découpe non prise en charge pour ce fichier (${codec} dans un conteneur .${item.ext}).`);
    }
    if (ext === 'wav') args.push('-rf64', 'auto');
    if (muxer === 'ipod') args.push('-movflags', '+faststart');
    args.push('-vn', ...PROGRESS, '-f', muxer, fileUrl(output));
    return { args, notes, encoder: 'audio', summary };
  }

  /* ---------------- GIF ---------------- */
  if (e.format === 'gif') {
    const w = Math.max(160, Math.min(1280, Math.round(e.gifWidth)));
    const fps = Math.max(5, Math.min(30, Math.round(e.gifFps)));
    args.push(
      '-filter_complex',
      `[0:${p.videoIndex}]fps=${fps},scale=${w}:-2:flags=lanczos,split[a][b];[a]palettegen=stats_mode=diff[pal];[b][pal]paletteuse=dither=bayer:bayer_scale=4[vout]`,
      '-map', '[vout]', '-loop', '0', '-an', ...PROGRESS, '-f', 'gif', fileUrl(output),
    );
    if (dur > 15) notes.push('GIF de plus de 15 secondes : le fichier peut être lourd.');
    return { args, notes, encoder: 'gif', summary: `GIF ${w} px de large, ${fps} images/s` };
  }

  /* ---------------- Vidéo, format d'origine ---------------- */
  if (e.format === 'same' && !e.precise) {
    args.push('-map', `0:${p.videoIndex}`, '-map', '0:a?');
    if (ext === 'mkv') args.push('-map', '0:s?');
    args.push('-map_metadata', '0', '-c', 'copy', '-avoid_negative_ts', 'make_zero');
    if (muxer === 'mp4' || muxer === 'mov') args.push('-movflags', '+faststart');
    args.push(...PROGRESS, '-f', muxer, fileUrl(output));
    notes.push('Découpe rapide sans réencodage : le début peut être avancé jusqu’à l’image clé précédente (souvent moins de 2 s).');
    return { args, notes, encoder: 'copy', summary: 'Copie sans réencodage' };
  }

  const choice = resolveEncoder(env, 'h264', 'auto');
  if (choice.fallbackNote) notes.push(choice.fallbackNote);
  let mbps: number;
  if (e.format === 'same') {
    mbps = sourceVideoMbps(item);
    if (p.displayWidth && p.displayHeight && p.displayWidth % 2 === 0 && p.displayHeight % 2 === 0) {
      args.push('-map', `0:${p.videoIndex}`);
    } else {
      args.push('-map', `0:${p.videoIndex}`, '-vf', 'scale=trunc(iw/2)*2:trunc(ih/2)*2,setsar=1');
    }
    notes.push(`Découpe précise, réencodée en H.264 à ${String(mbps).replace('.', ',')} Mbit/s (débit de la source).`);
  } else {
    const size = editFormatMeta(e.format).size as { w: number; h: number };
    const { w, h } = size;
    let graph: string;
    if (e.frame === 'crop') {
      graph = `[0:${p.videoIndex}]scale=${w}:${h}:force_original_aspect_ratio=increase:flags=lanczos,crop=${w}:${h},setsar=1[vout]`;
    } else if (e.frame === 'bars') {
      graph = `[0:${p.videoIndex}]scale=${w}:${h}:force_original_aspect_ratio=decrease:flags=lanczos,pad=${w}:${h}:(ow-iw)/2:(oh-ih)/2:color=black,setsar=1[vout]`;
    } else {
      const sw = Math.round(w / 8);
      const sh = Math.round(h / 8);
      graph =
        `[0:${p.videoIndex}]split=2[bg][fg];` +
        `[bg]scale=${sw}:${sh}:force_original_aspect_ratio=increase,crop=${sw}:${sh},boxblur=6:2,scale=${w}:${h}[bgb];` +
        `[fg]scale=${w}:${h}:force_original_aspect_ratio=decrease:flags=lanczos[fgs];` +
        `[bgb][fgs]overlay=(W-w)/2:(H-h)/2,setsar=1[vout]`;
    }
    args.push('-filter_complex', graph, '-map', '[vout]');
    mbps = e.format === 'square' ? 8 : 10;
    notes.push(`${editFormatMeta(e.format).title}, ${w} × ${h}.`);
  }
  args.push('-map', '0:a:0?', '-map_metadata', '0');
  const vb = Math.round(mbps * 1000);
  args.push('-c:v', choice.encoder, '-b:v', `${vb}k`, '-maxrate', `${vb}k`, '-bufsize', `${vb * 2}k`, '-pix_fmt', 'yuv420p', '-profile:v', 'high');
  if (choice.encoder === 'libx264') args.push('-preset', 'medium');
  if (p.audioIndexes.length) args.push('-c:a', 'aac', '-b:a', '256k', '-ar', '48000');
  args.push('-movflags', '+faststart', ...PROGRESS, '-f', muxer, fileUrl(output));
  return { args, notes, encoder: choice.encoder, summary: `H.264 ${String(mbps).replace('.', ',')} Mbit/s` };
}
