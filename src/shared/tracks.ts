/**
 * Choix des pistes audio et sous-titres (vidéos multipistes, MKV…).
 * Une piste est désignée par une « clé » : sa langue (ex. « fre »), ou « #n »
 * (position) si la langue n'est pas renseignée. Pour les sous-titres, « :forced »
 * distingue les sous-titres forcés de la version complète.
 */
import type { AudioTrackInfo, MediaItem, ProbeInfo, SubtitleInfo, TrackSelection } from './types';

const LANG_NAMES: Record<string, string> = {
  fre: 'Français', fra: 'Français', fr: 'Français',
  eng: 'Anglais', en: 'Anglais',
  ger: 'Allemand', deu: 'Allemand', de: 'Allemand',
  spa: 'Espagnol', es: 'Espagnol',
  ita: 'Italien', it: 'Italien',
  por: 'Portugais', pt: 'Portugais',
  jpn: 'Japonais', ja: 'Japonais',
  chi: 'Chinois', zho: 'Chinois', zh: 'Chinois',
  kor: 'Coréen', ko: 'Coréen',
  rus: 'Russe', ru: 'Russe',
  ara: 'Arabe', ar: 'Arabe',
  dut: 'Néerlandais', nld: 'Néerlandais', nl: 'Néerlandais',
  swe: 'Suédois', nor: 'Norvégien', dan: 'Danois', fin: 'Finnois',
  pol: 'Polonais', tur: 'Turc', gre: 'Grec', ell: 'Grec', heb: 'Hébreu',
  hin: 'Hindi', tha: 'Thaï', vie: 'Vietnamien', ukr: 'Ukrainien', cze: 'Tchèque', ces: 'Tchèque',
  hun: 'Hongrois', rum: 'Roumain', ron: 'Roumain', cat: 'Catalan',
};

export function langLabel(code: string | undefined): string {
  if (!code) return 'Langue non indiquée';
  return LANG_NAMES[code] ?? code.toUpperCase();
}

export function audioKey(t: AudioTrackInfo, pos: number): string {
  return t.language ?? `#${pos + 1}`;
}

export function subtitleKey(s: SubtitleInfo, pos: number): string {
  return `${s.language ?? `#${pos + 1}`}${s.forced ? ':forced' : ''}`;
}

export function keyLabel(key: string, kind: 'audio' | 'subtitle'): string {
  const [base, flag] = key.split(':');
  const name = base.startsWith('#') ? `${kind === 'audio' ? 'Piste' : 'Sous-titres'} ${base.slice(1)}` : langLabel(base);
  return flag === 'forced' ? `${name} (forcés)` : name;
}

export interface TrackOption {
  key: string;
  label: string;
  /** Nombre de fichiers prêts qui possèdent cette piste. */
  files: number;
  /** Détail facultatif (titre, canaux, format image…). */
  detail?: string;
}

function channelsLabel(n: number | null): string | undefined {
  if (!n) return undefined;
  if (n === 1) return 'mono';
  if (n === 2) return 'stéréo';
  if (n === 6) return '5.1';
  if (n === 8) return '7.1';
  return `${n} canaux`;
}

/** Pistes proposées pour une sélection de fichiers, regroupées par clé. */
export function trackOptions(items: MediaItem[]): { audio: TrackOption[]; subtitles: TrackOption[]; multiAudio: boolean; hasSubtitles: boolean } {
  const audio = new Map<string, TrackOption>();
  const subs = new Map<string, TrackOption>();
  let multiAudio = false;
  let hasSubtitles = false;
  for (const it of items) {
    const p = it.probe;
    if (it.status !== 'ready' || !p) continue;
    if (p.audioTracks.length > 1) multiAudio = true;
    if (p.subtitles.length) hasSubtitles = true;
    const seenA = new Set<string>();
    p.audioTracks.forEach((t, i) => {
      const key = audioKey(t, i);
      if (seenA.has(key)) return;
      seenA.add(key);
      const o = audio.get(key) ?? { key, label: keyLabel(key, 'audio'), files: 0, detail: [t.title, t.title?.includes(channelsLabel(t.channels) ?? '\u0000') ? undefined : channelsLabel(t.channels)].filter(Boolean).join(', ') || undefined };
      o.files++;
      audio.set(key, o);
    });
    const seenS = new Set<string>();
    p.subtitles.forEach((s, i) => {
      const key = subtitleKey(s, i);
      if (seenS.has(key)) return;
      seenS.add(key);
      const o = subs.get(key) ?? { key, label: keyLabel(key, 'subtitle'), files: 0, detail: [s.title, s.bitmap ? 'image' : 'texte'].filter(Boolean).join(', ') };
      o.files++;
      subs.set(key, o);
    });
  }
  return { audio: [...audio.values()], subtitles: [...subs.values()], multiAudio, hasSubtitles };
}

/** Index des pistes audio à garder pour ce fichier. */
export function resolveAudioTracks(p: ProbeInfo, sel: TrackSelection): { indexes: number[]; note?: string } {
  const tracks = p.audioTracks;
  if (!tracks.length) return { indexes: [] };
  if (sel.mode !== 'one' || !sel.key) return { indexes: tracks.map((t) => t.index) };
  const found = tracks.find((t, i) => audioKey(t, i) === sel.key);
  if (found) return { indexes: [found.index], note: `Piste audio conservée : ${keyLabel(sel.key, 'audio')}.` };
  const fallback = tracks.find((t) => t.isDefault) ?? tracks[0];
  return {
    indexes: [fallback.index],
    note: `${keyLabel(sel.key, 'audio')} absent de ce fichier : piste ${tracks.indexOf(fallback) + 1} (${langLabel(fallback.language)}) utilisée.`,
  };
}

/** Sous-titres retenus pour ce fichier (avant filtrage selon le conteneur). */
export function resolveSubtitles(p: ProbeInfo, sel: TrackSelection): { subs: SubtitleInfo[]; note?: string } {
  if (sel.mode === 'none') return { subs: [], note: p.subtitles.length ? 'Sous-titres retirés.' : undefined };
  if (sel.mode === 'all' || !sel.key) return { subs: p.subtitles };
  const found = p.subtitles.find((s, i) => subtitleKey(s, i) === sel.key);
  if (found) return { subs: [found] };
  return { subs: [], note: p.subtitles.length || sel.key ? `Sous-titres ${keyLabel(sel.key, 'subtitle')} absents de ce fichier.` : undefined };
}
