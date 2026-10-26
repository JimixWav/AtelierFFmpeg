/**
 * Édition : découpe, formats pour les réseaux sociaux et GIF. Fonctions pures
 * partagées entre l'interface et le processus principal.
 */
import type { EditFormat, EditSettings, FrameMode, MediaItem } from './types';

export const EDIT_FORMATS: { id: EditFormat; title: string; short: string; hint: string; size?: { w: number; h: number }; suffix: string }[] = [
  { id: 'same', title: 'Format d’origine', short: 'D’origine', hint: 'Garde le format, la résolution et le codec de la source : seule la découpe est appliquée.', suffix: '_extrait' },
  { id: 'vertical', title: 'Vertical 9:16', short: 'Vertical', hint: 'Reels, TikTok, Shorts, stories. 1080 × 1920.', size: { w: 1080, h: 1920 }, suffix: '_vertical' },
  { id: 'square', title: 'Carré 1:1', short: 'Carré', hint: 'Publications Instagram et Facebook. 1080 × 1080.', size: { w: 1080, h: 1080 }, suffix: '_carre' },
  { id: 'landscape', title: 'Paysage 16:9', short: 'Paysage', hint: 'YouTube, écrans, présentations. 1920 × 1080.', size: { w: 1920, h: 1080 }, suffix: '_paysage' },
  { id: 'gif', title: 'GIF animé', short: 'GIF', hint: 'Boucle sans son, idéale pour un aperçu court (quelques secondes).', suffix: '' },
];

export const FRAME_MODES: { id: FrameMode; title: string; hint: string }[] = [
  { id: 'crop', title: 'Recadrer au centre', hint: 'Remplit tout le cadre ; les bords de l’image sont coupés.' },
  { id: 'blur', title: 'Fond flouté', hint: 'Toute l’image est visible, sur un fond flou tiré de la vidéo.' },
  { id: 'bars', title: 'Bandes noires', hint: 'Toute l’image est visible, avec des bandes noires autour.' },
];

export const GIF_WIDTHS = [320, 480, 640];
export const GIF_FPS = [10, 15, 20];

export function defaultEdit(durationSec: number): EditSettings {
  return { start: 0, end: Math.max(0, durationSec), format: 'same', frame: 'blur', precise: true, gifWidth: 480, gifFps: 15 };
}

export function editFormatMeta(f: EditFormat) {
  return EDIT_FORMATS.find((x) => x.id === f) ?? EDIT_FORMATS[0];
}

export function isTrimmed(e: EditSettings, durationSec: number): boolean {
  return e.start > 0.05 || e.end < durationSec - 0.05;
}

/** Message expliquant pourquoi l'édition ne peut pas être lancée, sinon null. */
export function editProblem(item: MediaItem, e: EditSettings): string | null {
  const dur = item.probe?.durationSec ?? 0;
  const isVideo = item.probe?.videoIndex !== null && item.probe?.videoIndex !== undefined;
  if (item.status !== 'ready') return item.message ?? 'Fichier non pris en charge.';
  if (!(e.end > e.start)) return 'La fin doit être après le début.';
  if (e.end - e.start < 0.1) return 'L’extrait est trop court.';
  if (dur > 0 && e.end > dur + 0.05) return 'La fin dépasse la durée du fichier.';
  if (!isVideo && e.format !== 'same') return 'Ce format ne concerne que les vidéos.';
  if (e.format === 'same' && dur > 0 && !isTrimmed(e, dur)) return 'Déplacez le début ou la fin pour créer un extrait.';
  return null;
}

/** Extension de sortie d'une édition. */
export function editOutputExt(item: MediaItem, e: EditSettings): string {
  if (e.format === 'gif') return 'gif';
  if (e.format !== 'same') return 'mp4';
  const isVideo = item.probe?.videoIndex !== null && item.probe?.videoIndex !== undefined;
  if (isVideo) {
    if (e.precise) return 'mp4';
    return ['mp4', 'mov', 'm4v', 'mkv', 'webm'].includes(item.ext) ? item.ext : 'mkv';
  }
  return AUDIO_TRIM_EXT[item.ext] ?? 'm4a';
}

/** Conteneurs audio que l'on sait réécrire à l'identique (sinon AAC en .m4a). */
const AUDIO_TRIM_EXT: Record<string, string> = {
  wav: 'wav', wave: 'wav', aif: 'aiff', aiff: 'aiff', aifc: 'aiff', flac: 'flac', mp3: 'mp3', m4a: 'm4a', aac: 'm4a', ogg: 'ogg', oga: 'ogg', opus: 'opus',
};

export function editOutputName(item: MediaItem, e: EditSettings): string {
  const base = item.name.replace(/\.[^.]+$/, '');
  const ext = editOutputExt(item, e);
  const suffix = e.format === 'gif' ? '' : editFormatMeta(e.format).suffix;
  return `${base}${suffix}.${ext}`;
}

export function formatTimecode(sec: number): string {
  const s = Math.max(0, sec);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const r = s % 60;
  const rs = r.toFixed(1).padStart(4, '0').replace('.', ',');
  return h ? `${h}:${String(m).padStart(2, '0')}:${rs}` : `${String(m).padStart(2, '0')}:${rs}`;
}

/** Accepte « 75 », « 1:15 », « 1:15,5 », « 0:01:15.5 ». Renvoie null si illisible. */
export function parseTimecode(v: string): number | null {
  const t = v.trim().replace(',', '.');
  if (!t) return null;
  const parts = t.split(':');
  if (parts.length > 3 || parts.some((p) => p === '' || !/^\d+(\.\d+)?$/.test(p))) return null;
  return parts.reduce((acc, p) => acc * 60 + Number(p), 0);
}

export function editLabel(e: EditSettings): string {
  const meta = editFormatMeta(e.format);
  const range = `${formatTimecode(e.start)} → ${formatTimecode(e.end)}`;
  return e.format === 'same' ? `Extrait ${range}` : `${meta.title}, ${range}`;
}
