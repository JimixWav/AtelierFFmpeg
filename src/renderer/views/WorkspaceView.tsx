import { useState } from 'react';
import type { AddResult, Environment, JobPlan, JobRequest, JobSnapshot } from '../../shared/types';
import { DestinationPanel } from '../components/DestinationPanel';
import { MediaPanel } from '../components/MediaPanel';
import { deltaLabel, EstimatePanel } from '../components/EstimatePanel';
import { AudioProfilePanel, VideoProfilePanel } from '../components/ProfilePanels';
import { summarizeEstimates, uselessVideoReason } from '../../shared/estimate';
import { namingProblem, uselessAudioReason } from '../../shared/profiles';
import { ReviewDialog } from '../components/ReviewDialog';
import { Button, Meter, Notice } from '../components/ui';
import { basename, formatBytes, plural } from '../lib/format';
import { mergeItems, type WorkspaceState } from '../lib/state';
import { FfmpegMissing } from './DiagnosticView';

interface Props {
  ws: WorkspaceState;
  update: (patch: Partial<WorkspaceState> | ((prev: WorkspaceState) => Partial<WorkspaceState>)) => void;
  env: Environment | null;
  activeJob: JobSnapshot | null;
  /** Une tâche du même type (audio ou vidéo) tourne ou attend déjà. */
  kindBusy: boolean;
  notify: (tone: 'ok' | 'info' | 'warn' | 'danger', text: string) => void;
  onStarted: () => void;
  goDiagnostic: () => void;
  goTasks: () => void;
}

const HEAD = {
  audio: { title: 'Audio', lede: 'Convertir de l’audio, un fichier ou des dossiers entiers : WAV vers MP3 par défaut, et aussi AAC, FLAC, ALAC, WAV ou Opus.' },
  video: { title: 'Vidéo', lede: 'Compresser des vidéos pour la mise en ligne ou l’archivage, sans toucher aux originaux.' },
};

export function WorkspaceView({ ws, update, env, activeJob, kindBusy, notify, onStarted, goDiagnostic, goTasks }: Props) {
  const [plan, setPlan] = useState<JobPlan | null>(null);
  const [planning, setPlanning] = useState(false);
  const [starting, setStarting] = useState(false);
  const api = window.atelier;
  const head = HEAD[ws.kind];
  // Fichiers réellement convertibles : prêts, et pas « inutiles » (même format sans gain).
  const readyItems = ws.items.filter(
    (i) => i.status === 'ready' && !(ws.kind === 'audio' ? uselessAudioReason(i, ws.audio) : uselessVideoReason(i, ws.video)),
  );
  const fatal = env && !env.ok;

  const handleAdd = async (p: Promise<AddResult>) => {
    update({ adding: true });
    try {
      const res = await p;
      if (res.cancelled) return;
      const { items, duplicates } = mergeItems(ws.items, res.items);
      update((prev) => ({ items: mergeItems(prev.items, res.items).items }));
      const added = items.length - ws.items.length;
      if (res.rejected.length) {
        const first = res.rejected[0];
        notify('warn', `${plural(res.rejected.length, 'élément ignoré', 'éléments ignorés')} : ${basename(first.path)} (${first.reason})${res.rejected.length > 1 ? '…' : ''}`);
      }
      if (duplicates) notify('info', `${plural(duplicates, 'fichier déjà dans la liste', 'fichiers déjà dans la liste')}.`);
      if (!added && !res.rejected.length && !duplicates) notify('info', 'Aucun fichier ajouté.');
    } catch (e) {
      notify('danger', `Ajout impossible : ${(e as Error).message}`);
    } finally {
      update({ adding: false });
    }
  };

  const request = (): JobRequest => ({
    kind: ws.kind,
    itemIds: ws.items.map((i) => i.id),
    audio: ws.kind === 'audio' ? ws.audio : undefined,
    video: ws.kind === 'video' ? ws.video : undefined,
    destination: ws.destination,
    collision: ws.collision,
    deleteSource: !ws.keepOriginals,
    naming: ws.naming.custom
      ? {
          name: readyItems.length === 1 ? ws.naming.name.trim() || undefined : undefined,
          prefix: ws.naming.prefix || undefined,
          suffix: ws.naming.suffix || undefined,
        }
      : undefined,
  });

  const review = async () => {
    setPlanning(true);
    try {
      setPlan(await api.planJob(request()));
    } catch (e) {
      notify('danger', (e as Error).message.replace(/^Error invoking remote method '[^']+': (Error: )?/, ''));
    } finally {
      setPlanning(false);
    }
  };

  const start = async (confirmDirs: boolean) => {
    setStarting(true);
    try {
      const res = await api.startJob(request(), confirmDirs);
      if (!res.ok) {
        notify('danger', res.error ?? 'Impossible de lancer la conversion.');
        return;
      }
      setPlan(null);
      notify(
        'ok',
        kindBusy
          ? 'Conversion ajoutée à la file d’attente : elle démarrera après la précédente.'
          : activeJob
            ? `Conversion lancée en parallèle de la tâche ${activeJob.kind === 'audio' ? 'audio' : 'vidéo'} en cours.`
            : 'Conversion lancée.',
      );
      onStarted();
    } finally {
      setStarting(false);
    }
  };

  const pickOutput = async () => {
    const folder = await api.pickOutputFolder();
    if (folder) update({ destination: { mode: 'folder', folder } });
  };

  const totalReady = readyItems.reduce((a, b) => a + b.size, 0);
  const sources = ws.kind === 'audio' ? ws.audio.sources : undefined;
  const est = summarizeEstimates(readyItems, ws.kind, ws.audio, ws.video);
  const missingFolder = ws.destination.mode === 'folder' && !ws.destination.folder;
  const namingIssue = ws.naming.custom
    ? readyItems.length === 1
      ? namingProblem(ws.naming.name.trim(), true)
      : namingProblem(ws.naming.prefix) ?? namingProblem(ws.naming.suffix) ?? (ws.naming.prefix.startsWith('.') ? 'Un nom qui commence par un point serait un fichier caché.' : null)
    : null;

  return (
    <div className="page">
      <header className="page-head drag">
        <div>
          <h1>{head.title}</h1>
          <p className="lede">{head.lede}</p>
        </div>
      </header>

      {fatal ? <FfmpegMissing env={env} goDiagnostic={goDiagnostic} /> : null}

      {activeJob ? (
        <button type="button" className="running-strip" onClick={goTasks}>
          <span className="running-label">
            {activeJob.state === 'paused' ? 'En pause' : 'Conversion en cours'} : {activeJob.items[activeJob.currentIndex]?.name ?? activeJob.profileLabel}
          </span>
          <Meter value={activeJob.progress} segments={24} size="sm" label="Progression de la tâche en cours" />
          <span className="running-link">Voir les tâches</span>
        </button>
      ) : null}

      <section className="step" aria-labelledby={`${ws.kind}-s1`}>
        <div className="step-num" aria-hidden="true">1</div>
        <div className="step-body">
          <h2 id={`${ws.kind}-s1`}>Médias</h2>
          <MediaPanel
            ws={ws}
            update={update}
            locked={false}
            onAddFiles={() => handleAdd(api.pickFiles(ws.kind, sources))}
            onAddFolder={() => handleAdd(api.pickFolder(ws.kind, ws.recursive, sources))}
            onDropPaths={(paths) => handleAdd(api.addDroppedPaths(ws.kind, paths, ws.recursive, sources))}
          />
        </div>
      </section>

      <section className="step" aria-labelledby={`${ws.kind}-s2`}>
        <div className="step-num" aria-hidden="true">2</div>
        <div className="step-body">
          <h2 id={`${ws.kind}-s2`}>{ws.kind === 'audio' ? 'Profil' : 'Mode de compression'}</h2>
          {ws.kind === 'audio' ? (
            <>
              <AudioProfilePanel ws={ws} update={update} env={env} />
              <EstimatePanel ws={ws} />
            </>
          ) : (
            <VideoProfilePanel ws={ws} update={update} env={env}>
              <EstimatePanel ws={ws} />
            </VideoProfilePanel>
          )}
        </div>
      </section>

      <section className="step" aria-labelledby={`${ws.kind}-s3`}>
        <div className="step-num" aria-hidden="true">3</div>
        <div className="step-body">
          <h2 id={`${ws.kind}-s3`}>Destination</h2>
          <DestinationPanel ws={ws} update={update} onPickFolder={pickOutput} locked={false} />
        </div>
      </section>

      <footer className="action-bar">
        <div className="action-summary">
          {readyItems.length ? (
            <>
              <strong>{plural(readyItems.length, 'fichier prêt', 'fichiers prêts')}</strong>
              <span>
                {formatBytes(totalReady)}
                {est.count ? ` → ≈ ${formatBytes(est.sizeOut)} (${deltaLabel(est.delta)})` : ''}
              </span>
              {!ws.keepOriginals ? <span className="tone-danger-text">Originaux vers la Corbeille</span> : null}
            </>
          ) : (
            <span className="cell-muted">Ajoutez au moins un fichier pour continuer.</span>
          )}
        </div>
        {missingFolder ? <Notice tone="warn">Choisissez un dossier de sortie.</Notice> : namingIssue ? <Notice tone="warn">Nom de sortie à corriger.</Notice> : null}
        <Button variant="primary" size="lg" icon="play" onClick={review} disabled={!readyItems.length || !!fatal || missingFolder || !!namingIssue} busy={planning}>
          Vérifier et lancer
        </Button>
      </footer>

      {plan ? <ReviewDialog plan={plan} onClose={() => setPlan(null)} onStart={start} starting={starting} /> : null}
    </div>
  );
}
