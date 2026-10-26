import { useCallback, useEffect, useRef, useState } from 'react';
import type { Environment, HistoryEntry, JobSnapshot, MediaKind } from '../shared/types';
import { Icon, type IconName } from './components/Icon';
import { Toasts, type Toast } from './components/ui';
import { playChime } from './lib/chime';
import { BRAND, FEATURES } from '../shared/brand';
import { ffmpegVersionAdvice } from '../shared/profiles';
import { initialWorkspace, type View, type WorkspaceState } from './lib/state';
import { DiagnosticView } from './views/DiagnosticView';
import { EditView, initialEditState, type EditState } from './views/EditView';
import { HistoryView } from './views/HistoryView';
import { TasksView } from './views/TasksView';
import { WorkspaceView } from './views/WorkspaceView';

const NAV: { id: View; label: string; icon: IconName; group: 'convert' | 'follow' }[] = [
  { id: 'audio', label: 'Audio', icon: 'audio', group: 'convert' },
  { id: 'video', label: 'Vidéo', icon: 'video', group: 'convert' },
  ...(FEATURES.edit ? [{ id: 'edit' as const, label: 'Édition', icon: 'scissors' as const, group: 'convert' as const }] : []),
  { id: 'tasks', label: 'Tâches', icon: 'tasks', group: 'follow' },
  { id: 'history', label: 'Historique', icon: 'history', group: 'follow' },
];

type Patch = Partial<WorkspaceState> | ((prev: WorkspaceState) => Partial<WorkspaceState>);

export function App() {
  const api = window.atelier;
  const [view, setView] = useState<View>('audio');
  const [env, setEnv] = useState<Environment | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [jobs, setJobs] = useState<JobSnapshot[]>([]);
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [notifySound, setNotifySound] = useState(true);
  const [editState, setEditStateRaw] = useState<EditState>(initialEditState);
  const setEditState = useCallback(
    (patch: Partial<EditState> | ((prev: EditState) => Partial<EditState>)) =>
      setEditStateRaw((prev) => ({ ...prev, ...(typeof patch === 'function' ? patch(prev) : patch) })),
    [],
  );
  const [spaces, setSpaces] = useState<Record<MediaKind, WorkspaceState>>({ audio: initialWorkspace('audio'), video: initialWorkspace('video') });
  const toastId = useRef(0);
  const prevStates = useRef(new Map<string, string>());

  const notify = useCallback((tone: Toast['tone'], text: string) => {
    const id = ++toastId.current;
    setToasts((t) => [...t.slice(-3), { id, tone, text }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), tone === 'danger' ? 9000 : 5000);
  }, []);

  const updater = (kind: MediaKind) => (patch: Patch) =>
    setSpaces((s) => ({ ...s, [kind]: { ...s[kind], ...(typeof patch === 'function' ? patch(s[kind]) : patch) } }));

  useEffect(() => {
    void api.getEnvironment().then((e) => {
      setEnv(e);
      const advice = e.ok ? ffmpegVersionAdvice(e.ffmpegVersion) : null;
      if (advice) notify('warn', advice);
    });
    void api.getJobs().then(setJobs);
    void api.getHistory().then(setHistory);
    void api.getPreferences().then((p) => setNotifySound(p.notifySound));
    const offJobs = api.onJobsChanged(setJobs);
    const offChime = api.onChime(playChime);
    return () => {
      offJobs();
      offChime();
    };
  }, [api, notify]);

  // Notifications de fin de tâche + rafraîchissement de l'historique.
  useEffect(() => {
    let finished = false;
    for (const j of jobs) {
      const before = prevStates.current.get(j.id);
      if (before && before !== j.state && ['done', 'done-with-errors', 'cancelled', 'failed'].includes(j.state)) {
        finished = true;
        if (j.state === 'done') notify('ok', `Conversion terminée : ${j.counts.done} ${j.counts.done > 1 ? 'fichiers convertis' : 'fichier converti'}.`);
        else if (j.state === 'done-with-errors') notify('warn', `Terminé avec ${j.counts.failed} ${j.counts.failed > 1 ? 'échecs' : 'échec'}. Consultez Tâches pour les détails.`);
        else if (j.state === 'cancelled') notify('info', 'Conversion annulée. Les fichiers partiels ont été supprimés.');
        else notify('danger', j.fatalError ?? 'La tâche s’est arrêtée sur une erreur.');
      }
      prevStates.current.set(j.id, j.state);
    }
    if (finished) setTimeout(() => void api.getHistory().then(setHistory), 400);
  }, [jobs, api, notify]);

  const refreshEnv = async () => {
    setRefreshing(true);
    try {
      setEnv(await api.getEnvironment(true));
    } finally {
      setRefreshing(false);
    }
  };

  const isActive = (j: JobSnapshot) => j.state === 'running' || j.state === 'paused';
  // Audio et vidéo tournent en parallèle : chaque espace montre d'abord sa propre tâche.
  const activeJobFor = (kind: MediaKind) => jobs.find((j) => isActive(j) && j.kind === kind) ?? jobs.find(isActive) ?? null;
  const activeJob = jobs.find(isActive) ?? null;
  const envAdvice = env?.ok ? ffmpegVersionAdvice(env.ffmpegVersion) : null;
  const activeCount = jobs.filter((j) => j.state === 'running' || j.state === 'paused' || j.state === 'queued').length;
  const platformClass = api.platform === 'darwin' ? 'platform-darwin' : 'platform-other';

  const renderView = () => {
    switch (view) {
      case 'audio':
      case 'video':
        return (
          <WorkspaceView
            key={view}
            ws={spaces[view]}
            update={updater(view)}
            env={env}
            activeJob={activeJobFor(view)}
            kindBusy={jobs.some((j) => j.kind === view && (isActive(j) || j.state === 'queued'))}
            notify={notify}
            onStarted={() => setView('tasks')}
            goDiagnostic={() => setView('diagnostic')}
            goTasks={() => setView('tasks')}
          />
        );
      case 'edit':
        return (
          <EditView
            state={editState}
            setState={setEditState}
            env={env}
            activeJob={activeJob}
            notify={notify}
            goDiagnostic={() => setView('diagnostic')}
            goTasks={() => setView('tasks')}
          />
        );
      case 'tasks':
        return (
          <TasksView
            jobs={jobs}
            notify={notify}
            onClear={() => void api.clearFinishedJobs().then(setJobs)}
            goAudio={() => setView('audio')}
            notifySound={notifySound}
            onNotifySound={(v) => {
              setNotifySound(v);
              void api.setPreferences({ notifySound: v });
            }}
          />
        );
      case 'history':
        return <HistoryView history={history} notify={notify} onClear={() => void api.clearHistory().then(setHistory)} />;
      case 'diagnostic':
      default:
        return (
          <DiagnosticView
            env={env}
            refreshing={refreshing}
            onRefresh={() => void refreshEnv()}
            onChoose={() => void api.chooseFfmpegBinary().then(setEnv)}
            onReset={() => void api.resetFfmpegBinary().then(setEnv)}
          />
        );
    }
  };

  return (
    <div className={`app ${platformClass}`}>
      <aside className="sidebar">
        <div className="sidebar-top drag" />
        <div className="brand">
          <span className="brand-mark" aria-hidden="true">
            <span /><span /><span /><span />
          </span>
          <span className="brand-name">{BRAND.name}</span>
        </div>
        <nav aria-label="Navigation principale">
          {(['convert', 'follow'] as const).map((group) => (
            <div key={group} className="nav-group">
              <div className="nav-group-label">{group === 'convert' ? 'Convertir' : 'Suivre'}</div>
              {NAV.filter((n) => n.group === group).map((n) => (
                <button
                  key={n.id}
                  type="button"
                  className={`nav-item${view === n.id ? ' is-active' : ''}`}
                  aria-current={view === n.id ? 'page' : undefined}
                  onClick={() => setView(n.id)}
                >
                  <Icon name={n.icon} size={16} />
                  <span>{n.label}</span>
                  {n.id === 'tasks' && activeCount ? <span className="nav-badge">{activeCount}</span> : null}
                  {(n.id === 'audio' || n.id === 'video') && spaces[n.id].items.length ? (
                    <span className="nav-count">{spaces[n.id].items.length}</span>
                  ) : null}
                </button>
              ))}
            </div>
          ))}
        </nav>
        <button type="button" className={`env-chip${view === 'diagnostic' ? ' is-active' : ''}`} onClick={() => setView('diagnostic')} aria-current={view === 'diagnostic' ? 'page' : undefined}>
          <span className={`env-dot tone-${!env ? 'neutral' : !env.ok ? 'danger' : envAdvice ? 'warn' : 'ok'}`} aria-hidden="true" />
          <span className="env-text">
            <span>Diagnostic</span>
            <span className="env-sub">{!env ? 'Vérification…' : env.ok ? `FFmpeg ${env.ffmpegVersion ?? ''}${envAdvice ? ' (ancien)' : ''}`.trim() : 'FFmpeg introuvable'}</span>
          </span>
        </button>
      </aside>
      <main className="main">{renderView()}</main>
      <Toasts toasts={toasts} dismiss={(id) => setToasts((t) => t.filter((x) => x.id !== id))} />
    </div>
  );
}
