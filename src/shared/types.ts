/**
 * Types partagés entre le processus principal (Node/Electron) et l'interface.
 * Aucun import Node ici : ce fichier est aussi compilé pour le renderer.
 */

export type MediaKind = 'audio' | 'video';

/* ------------------------------------------------------------------ */
/* Environnement FFmpeg                                                */
/* ------------------------------------------------------------------ */

export interface EncoderStatus {
  /** Nom FFmpeg, ex. `h264_videotoolbox`. */
  name: string;
  /** Présent dans `ffmpeg -encoders`. */
  listed: boolean;
  /** Un encodage d'essai a réussi (uniquement testé pour les encodeurs matériels). */
  usable: boolean;
  /** Encodeur matériel (VideoToolbox). */
  hardware: boolean;
  /** Message lisible si l'encodeur n'est pas utilisable. */
  detail?: string;
}

export interface Environment {
  ok: boolean;
  ffmpegPath: string | null;
  ffprobePath: string | null;
  ffmpegVersion: string | null;
  /** Première ligne complète de `ffmpeg -version`. */
  versionLine: string | null;
  encoders: Record<string, EncoderStatus>;
  platform: string;
  arch: string;
  /** Chemin personnalisé choisi par l'utilisateur, s'il y en a un. */
  customPath: string | null;
  error: string | null;
  checkedAt: number;
}

export interface UpdateCheck {
  status: 'up-to-date' | 'outdated' | 'not-homebrew' | 'error';
  installed: string | null;
  latest: string | null;
  message: string;
  checkedAt: number;
}

/* ------------------------------------------------------------------ */
/* Médias                                                              */
/* ------------------------------------------------------------------ */

export interface SubtitleInfo {
  index: number;
  codec: string;
  /** Sous-titre bitmap (PGS, DVD…) : non convertible en texte MP4. */
  bitmap: boolean;
  language?: string;
  title?: string;
  forced?: boolean;
  isDefault?: boolean;
}

export interface AudioTrackInfo {
  index: number;
  codec: string;
  language?: string;
  title?: string;
  channels: number | null;
  isDefault?: boolean;
  /** Débit mesuré (bit/s), si le fichier l'indique. */
  bitrate?: number | null;
}

/** Sélection d'une piste : toutes, aucune, ou une piste désignée par sa clé (langue ou « #n »). */
export interface TrackSelection {
  mode: 'all' | 'none' | 'one';
  key?: string;
}

export interface ProbeInfo {
  durationSec: number | null;
  formatName: string | null;
  /** Index du flux vidéo principal (hors pochettes). */
  videoIndex: number | null;
  videoCodec: string | null;
  /** Dimensions codées. */
  width: number | null;
  height: number | null;
  /** Dimensions affichées (rotation et SAR appliqués). */
  displayWidth: number | null;
  displayHeight: number | null;
  pixFmt: string | null;
  /** Rapport d'aspect des pixels (1 = pixels carrés). */
  sampleAspect: number;
  fps: number | null;
  extraVideoStreams: number;
  /** Débit de la piste vidéo principale (bit/s), mesuré ou déduit. */
  videoBitrate: number | null;
  /** Débit global du fichier (bit/s). */
  totalBitrate: number | null;
  audioIndexes: number[];
  audioCodecs: string[];
  audioTracks: AudioTrackInfo[];
  /** Première piste audio : fréquence, canaux, résolution (bits), débit. */
  audioSampleRate: number | null;
  audioChannels: number | null;
  audioBits: number | null;
  audioBitrate: number | null;
  /** Pochette intégrée (flux image « attached_pic ») et son codec. */
  coverIndex: number | null;
  coverCodec: string | null;
  subtitles: SubtitleInfo[];
  chapters: number;
  dataStreams: number;
  attachments: number;
}

export type MediaStatus = 'ready' | 'unsupported' | 'error';

export interface MediaItem {
  id: string;
  kind: MediaKind;
  path: string;
  name: string;
  /** Extension en minuscules sans le point. */
  ext: string;
  size: number;
  /** Dossier parent absolu. */
  dir: string;
  /** Racine choisie (dossier ajouté) ou dossier parent pour un fichier isolé. */
  root: string;
  /** Sous-dossier relatif à la racine ('' si à la racine). */
  relDir: string;
  status: MediaStatus;
  message?: string;
  probe?: ProbeInfo;
}

export interface AddResult {
  items: MediaItem[];
  /** Fichiers ignorés pendant l'ajout (format non pris en charge, illisibles…). */
  rejected: { path: string; reason: string }[];
  cancelled: boolean;
}

/* ------------------------------------------------------------------ */
/* Profils & demandes de conversion                                    */
/* ------------------------------------------------------------------ */

export type Mp3Quality = 0 | 2 | 4 | 6;

export type AudioFormat = 'mp3' | 'aac' | 'flac' | 'alac' | 'wav' | 'opus';
/** Familles de fichiers acceptées comme sources audio. */
export type AudioSourceGroup = 'wav' | 'aiff' | 'flac' | 'm4a' | 'mp3' | 'ogg' | 'video';
/** WAV : conserver la source, qualité CD (16 bits / 44,1 kHz) ou studio (24 bits / 48 kHz). */
export type WavPreset = 'source' | 'cd' | 'studio';

export interface AudioSettings {
  format: AudioFormat;
  /** MP3 VBR (-q:a). */
  quality: Mp3Quality;
  /** AAC et Opus. */
  bitrateKbps: number;
  wavPreset: WavPreset;
  sources: AudioSourceGroup[];
}

export type VideoProfileId = 'youtube' | 'archive' | 'custom' | 'remux';
export type VideoCodecFamily = 'h264' | 'hevc';
/** `auto` = matériel si disponible, sinon logiciel. */
export type EncoderPreference = 'auto' | 'hardware' | 'software';
export type ResolutionChoice = 'source' | '1080p' | '720p';
export type VideoContainer = 'mp4' | 'mov' | 'mkv';

export interface VideoSettings {
  profile: VideoProfileId;
  codec: VideoCodecFamily;
  encoder: EncoderPreference;
  videoBitrateMbps: number;
  audioBitrateKbps: number;
  resolution: ResolutionChoice;
  container: VideoContainer;
  /** Pistes audio conservées (toutes par défaut). */
  audioSelection: TrackSelection;
  /** Sous-titres : tous ceux compatibles (par défaut), aucun, ou un seul. */
  subtitleSelection: TrackSelection;
  /** Incruster le sous-titre choisi dans l'image (toujours visible). */
  burnSubtitles: boolean;
}

export type CollisionPolicy = 'skip' | 'replace' | 'unique';

/* ------------------------------------------------------------------ */
/* Édition                                                             */
/* ------------------------------------------------------------------ */

/** Format de sortie d'une édition : identique (découpe seule), réseaux sociaux ou GIF. */
export type EditFormat = 'same' | 'vertical' | 'square' | 'landscape' | 'gif';
/** Adaptation au nouveau cadre : recadrer, fond flouté ou bandes noires. */
export type FrameMode = 'crop' | 'blur' | 'bars';

export interface EditSettings {
  /** Début et fin de l'extrait, en secondes. */
  start: number;
  end: number;
  format: EditFormat;
  frame: FrameMode;
  /** Vidéo, format identique : découpe précise (réencodage) ou rapide (copie, sur image clé). */
  precise: boolean;
  gifWidth: number;
  gifFps: number;
}

export interface Destination {
  mode: 'beside' | 'folder';
  folder?: string;
}

export interface JobRequest {
  kind: MediaKind;
  itemIds: string[];
  audio?: AudioSettings;
  video?: VideoSettings;
  /** Présent pour une tâche d'édition (un seul fichier). */
  edit?: EditSettings;
  destination: Destination;
  collision: CollisionPolicy;
  /**
   * false (par défaut) : les originaux sont conservés.
   * true : après une conversion réussie ET vérifiée, l'original est placé dans la Corbeille.
   */
  deleteSource: boolean;
  /** Nom de sortie personnalisé ; absent = nommage par défaut. */
  naming?: OutputNaming;
}

export interface OutputNaming {
  /** Nom complet (sans extension), utilisé seulement quand un seul fichier est converti. */
  name?: string;
  /** Texte ajouté avant / après le nom d'origine (plusieurs fichiers). */
  prefix?: string;
  suffix?: string;
}

/* ------------------------------------------------------------------ */
/* Planification                                                       */
/* ------------------------------------------------------------------ */

export type PlanAction = 'convert' | 'skip-exists' | 'skip-useless' | 'collision' | 'error';

export interface PlanEntry {
  itemId: string;
  sizeIn: number;
  /** Taille de sortie estimée (octets), null si la durée est inconnue. */
  estimatedBytes: number | null;
  source: string;
  name: string;
  relDir: string;
  output: string | null;
  action: PlanAction;
  /** Message court pour l'utilisateur (« Déjà présent », etc.). */
  message?: string;
  /** Informations sur les flux, l'encodeur, la résolution… */
  notes: string[];
  /** Encodeur vidéo réellement utilisé. */
  encoder?: string;
  /** Résumé lisible des réglages, ex. « 1920 × 1080, 4 Mbit/s ». */
  summary?: string;
  willReplace: boolean;
}

export interface JobPlan {
  entries: PlanEntry[];
  counts: { convert: number; skip: number; collision: number; error: number };
  /** Totaux des fichiers à convertir : taille actuelle et taille estimée. */
  totalIn: number;
  totalEstimated: number | null;
  /** Dossiers de sortie qui n'existent pas encore et seront créés. */
  dirsToCreate: string[];
  /** Avertissements généraux (encodeur de repli, espace disque…). */
  warnings: string[];
  /** Erreurs bloquantes (FFmpeg absent, dossier invalide…). */
  blocking: string[];
  profileLabel: string;
  deleteSource: boolean;
}

/* ------------------------------------------------------------------ */
/* Tâches                                                              */
/* ------------------------------------------------------------------ */

export type ItemStatus = 'pending' | 'running' | 'done' | 'skipped' | 'failed' | 'cancelled';

export type JobState =
  | 'queued'
  | 'running'
  | 'paused'
  | 'done'
  | 'done-with-errors'
  | 'cancelled'
  | 'failed';

export interface JobItem {
  id: string;
  source: string;
  name: string;
  relDir: string;
  output: string | null;
  status: ItemStatus;
  /** 0..1, null si inconnue. */
  progress: number | null;
  speed: number | null;
  etaSec: number | null;
  elapsedMs: number;
  durationSec: number | null;
  message?: string;
  notes: string[];
  sizeIn: number;
  sizeOut: number | null;
  /** L'original a été placé dans la Corbeille. */
  sourceTrashed: boolean;
  /** Détails techniques pour le diagnostic (commande, fin de la sortie FFmpeg). */
  errorDetails?: string;
}

export interface JobSnapshot {
  id: string;
  kind: MediaKind;
  profileLabel: string;
  state: JobState;
  createdAt: number;
  startedAt: number | null;
  finishedAt: number | null;
  elapsedMs: number;
  currentIndex: number;
  /** Progression globale 0..1 pondérée par la durée. */
  progress: number;
  etaSec: number | null;
  deleteSource: boolean;
  items: JobItem[];
  counts: Record<ItemStatus, number>;
  fatalError?: string;
  canPause: boolean;
  /** Conversions simultanées (audio : plusieurs fichiers à la fois). */
  concurrency: number;
  /** Horodatage de l'instantané : l'interface fait avancer les chronomètres entre deux mises à jour. */
  snapshotAt: number;
}

export interface HistoryEntry {
  id: string;
  kind: MediaKind;
  profileLabel: string;
  state: JobState;
  startedAt: number | null;
  finishedAt: number | null;
  elapsedMs: number;
  deleteSource: boolean;
  counts: Record<ItemStatus, number>;
  items: {
    source: string;
    output: string | null;
    status: ItemStatus;
    message?: string;
    sourceTrashed: boolean;
  }[];
}

/* ------------------------------------------------------------------ */
/* API exposée au renderer                                             */
/* ------------------------------------------------------------------ */

export interface Preferences {
  /** Son (et notification si l'app est en arrière-plan) à la fin d'une tâche. */
  notifySound: boolean;
}

export interface StartResult {
  ok: boolean;
  jobId?: string;
  error?: string;
}

export interface AtelierApi {
  /** `darwin`, `linux`, `win32`… */
  platform: string;
  getEnvironment(refresh?: boolean): Promise<Environment>;
  chooseFfmpegBinary(): Promise<Environment>;
  resetFfmpegBinary(): Promise<Environment>;

  /** `sources` : familles audio acceptées (ignoré en vidéo). */
  pickFiles(kind: MediaKind, sources?: AudioSourceGroup[]): Promise<AddResult>;
  pickFolder(kind: MediaKind, recursive: boolean, sources?: AudioSourceGroup[]): Promise<AddResult>;
  addDroppedPaths(kind: MediaKind, paths: string[], recursive: boolean, sources?: AudioSourceGroup[]): Promise<AddResult>;
  pickOutputFolder(): Promise<string | null>;

  planJob(req: JobRequest): Promise<JobPlan>;
  startJob(req: JobRequest, confirmCreateDirs: boolean): Promise<StartResult>;
  cancelJob(jobId: string): Promise<void>;
  pauseJob(jobId: string): Promise<void>;
  resumeJob(jobId: string): Promise<void>;
  getJobs(): Promise<JobSnapshot[]>;
  clearFinishedJobs(): Promise<JobSnapshot[]>;

  getHistory(): Promise<HistoryEntry[]>;
  clearHistory(): Promise<HistoryEntry[]>;

  /** Édition : ouvre un fichier (audio ou vidéo) via la boîte de dialogue, ou un chemin glissé. */
  openForEdit(path?: string): Promise<AddResult>;
  /** Forme d'onde de la piste audio (image PNG en data URL), null si indisponible. */
  getWaveform(itemId: string): Promise<string | null>;
  /** Image de la vidéo à l'instant t (JPEG en data URL), pour les formats non lisibles en aperçu. */
  getFrame(itemId: string, timeSec: number): Promise<string | null>;
  /** Adresse de lecture locale d'un média (protocole interne, aucun accès réseau). */
  mediaUrl(itemId: string): string;

  revealInFinder(path: string): Promise<boolean>;
  openPath(path: string): Promise<boolean>;
  copyText(text: string): Promise<void>;
  /** Ouvre la page GitHub de l'auteur dans le navigateur (adresse fixe). */
  openAuthorPage(): Promise<void>;
  /** Demande à Homebrew si une version plus récente de FFmpeg existe (à la demande). */
  checkFfmpegUpdate(): Promise<UpdateCheck>;

  getPreferences(): Promise<Preferences>;
  setPreferences(patch: Partial<Preferences>): Promise<Preferences>;

  onJobsChanged(listener: (jobs: JobSnapshot[]) => void): () => void;
  /** Le processus principal demande un carillon de fin de tâche (hors macOS ou si le son système échoue). */
  onChime(listener: (failed: boolean) => void): () => void;
  /** Chemin local d'un fichier glissé-déposé (Electron `webUtils`). */
  getPathForFile(file: File): string;
}

declare global {
  interface Window {
    atelier: AtelierApi;
  }
}
