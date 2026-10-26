import { DEFAULT_AUDIO, defaultVideoSettings } from '../../shared/profiles';
import type { AudioSettings, CollisionPolicy, Destination, MediaItem, MediaKind, VideoSettings } from '../../shared/types';

export type View = 'audio' | 'video' | 'edit' | 'tasks' | 'history' | 'diagnostic';

export interface WorkspaceState {
  kind: MediaKind;
  items: MediaItem[];
  recursive: boolean;
  destination: Destination;
  collision: CollisionPolicy;
  /** Coché par défaut : les originaux sont conservés. Jamais mémorisé d'une session à l'autre. */
  keepOriginals: boolean;
  /** Nom de sortie : par défaut (nom d'origine + suffixe du profil) ou personnalisé. */
  naming: NamingState;
  audio: AudioSettings;
  video: VideoSettings;
  adding: boolean;
}

export interface NamingState {
  custom: boolean;
  /** Nom complet, quand un seul fichier est converti. */
  name: string;
  prefix: string;
  suffix: string;
}

export function initialWorkspace(kind: MediaKind): WorkspaceState {
  return {
    kind,
    items: [],
    recursive: true,
    destination: { mode: 'beside' },
    collision: 'skip',
    keepOriginals: true,
    naming: { custom: false, name: '', prefix: '', suffix: '' },
    audio: { ...DEFAULT_AUDIO },
    video: defaultVideoSettings('youtube'),
    adding: false,
  };
}

/** Fusionne de nouveaux médias sans doublons (même chemin). */
export function mergeItems(current: MediaItem[], added: MediaItem[]): { items: MediaItem[]; duplicates: number } {
  const seen = new Set(current.map((i) => i.path));
  let duplicates = 0;
  const next = [...current];
  for (const it of added) {
    if (seen.has(it.path)) {
      duplicates++;
      continue;
    }
    seen.add(it.path);
    next.push(it);
  }
  return { items: next, duplicates };
}
