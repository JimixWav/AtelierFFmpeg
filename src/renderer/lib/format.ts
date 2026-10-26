import { equivalentLines } from '../../shared/profiles';
const nf1 = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 1 });
const nf0 = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 0 });

export function formatBytes(bytes: number | null | undefined): string {
  if (bytes === null || bytes === undefined || !Number.isFinite(bytes)) return '—';
  if (bytes < 1000) return `${nf0.format(bytes)} o`;
  const units = ['Ko', 'Mo', 'Go', 'To'];
  let v = bytes / 1000;
  let i = 0;
  while (v >= 1000 && i < units.length - 1) {
    v /= 1000;
    i++;
  }
  return `${v >= 100 ? nf0.format(v) : nf1.format(v)} ${units[i]}`;
}

/** 75 → « 1 min 15 s », 3700 → « 1 h 02 min ». */
export function formatDuration(sec: number | null | undefined): string {
  if (sec === null || sec === undefined || !Number.isFinite(sec)) return '—';
  const s = Math.max(0, Math.round(sec));
  if (s < 60) return `${s} s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m} min ${String(s % 60).padStart(2, '0')} s`;
  const h = Math.floor(m / 60);
  return `${h} h ${String(m % 60).padStart(2, '0')} min`;
}

/** Chronomètre : 83000 ms → « 01:23 ». */
export function formatClock(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const r = s % 60;
  const mm = String(m).padStart(2, '0');
  const ss = String(r).padStart(2, '0');
  return h ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

export function formatDateTime(ts: number | null): string {
  if (!ts) return '—';
  return new Intl.DateTimeFormat('fr-FR', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(ts));
}

export function plural(n: number, one: string, many: string): string {
  return `${nf0.format(n)} ${n > 1 ? many : one}`;
}

export function basename(p: string): string {
  const i = p.lastIndexOf('/');
  return i >= 0 ? p.slice(i + 1) : p;
}

export function dirname(p: string): string {
  const i = p.lastIndexOf('/');
  return i > 0 ? p.slice(0, i) : '/';
}

/** Raccourcit un chemin pour l'affichage (« ~/Music/… »). */
export function prettyPath(p: string): string {
  return p.replace(/^\/Users\/[^/]+/, '~');
}

export function resolutionLabel(w: number | null | undefined, h: number | null | undefined): string {
  if (!w || !h) return '';
  const short = equivalentLines(w, h);
  if (short >= 2100) return '4K';
  if (short >= 1400) return '1440p';
  if (short >= 1000) return '1080p';
  if (short >= 700) return '720p';
  return `${w}×${h}`;
}
