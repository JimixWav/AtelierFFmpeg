import { useEffect, useState } from 'react';
import type { JobItem, JobSnapshot } from '../../shared/types';
import { Icon } from '../components/Icon';
import { Bar, Button, IconButton, ITEM_STATUS, JOB_STATE, Meter, Notice, Pill, Switch } from '../components/ui';
import { basename, formatBytes, formatClock, formatDateTime, formatDuration, plural, prettyPath } from '../lib/format';

interface Props {
  jobs: JobSnapshot[];
  notifySound: boolean;
  onNotifySound: (v: boolean) => void;
  notify: (tone: 'ok' | 'info' | 'warn' | 'danger', text: string) => void;
  onClear: () => void;
  goAudio: () => void;
}

const isActive = (j: JobSnapshot) => j.state === 'running' || j.state === 'paused' || j.state === 'queued';

/** Re-rend toutes les secondes pour faire avancer les chronomètres. */
function useTick(active: boolean) {
  const [, setT] = useState(0);
  useEffect(() => {
    if (!active) return;
    const id = setInterval(() => setT((t) => t + 1), 1000);
    return () => clearInterval(id);
  }, [active]);
}

function errorReport(job: JobSnapshot, item: JobItem): string {
  return [
    `Atelier FFmpeg — rapport d’erreur`,
    `Profil : ${job.profileLabel}`,
    `Fichier : ${prettyPath(item.source)}`,
    `Message : ${item.message ?? ''}`,
    '',
    item.errorDetails ?? '(pas de détails techniques)',
  ].join('\n');
}

/** Temps écoulé « vivant » : l'instantané plus le temps passé depuis sa réception. */
function live(ms: number, job: JobSnapshot): number {
  return job.state === 'running' ? ms + Math.max(0, Date.now() - job.snapshotAt) : ms;
}

function ItemRow({ job, item, notify }: { job: JobSnapshot; item: JobItem; notify: Props['notify'] }) {
  const [open, setOpen] = useState(false);
  const st = item.status === 'running' && job.state === 'paused' ? { label: 'En pause', tone: 'warn', icon: ITEM_STATUS.running.icon } : ITEM_STATUS[item.status];
  const api = window.atelier;
  const reveal = async (p: string) => {
    if (!(await api.revealInFinder(p))) notify('warn', 'Ce fichier n’existe plus à cet emplacement.');
  };
  const ratio = item.sizeOut && item.sizeIn ? item.sizeOut / item.sizeIn : null;
  return (
    <li className={`task-item status-${item.status}`}>
      <div className="task-item-main">
        <span className={`task-item-icon tone-${st.tone}`} aria-hidden="true">
          {item.status === 'running' ? <span className="pulse" /> : <Icon name={st.icon} size={13} />}
        </span>
        <div className="task-item-text">
          <div className="task-item-name" title={item.source}>
            {item.relDir ? <span className="cell-muted">{item.relDir}/</span> : null}
            {item.name}
          </div>
          <div className="task-item-sub">
            {item.status === 'running' ? (
              <>
                {item.progress !== null ? `${Math.round(item.progress * 100)} %` : 'Progression inconnue'}
                {item.speed ? `, ${item.speed.toFixed(1).replace('.', ',')}× temps réel` : ''}
                {item.etaSec !== null ? `, encore ≈ ${formatDuration(item.etaSec)}` : ''}
                {`, ${formatClock(live(item.elapsedMs, job))} écoulées`}
              </>
            ) : item.status === 'done' ? (
              <>
                {item.output ? basename(item.output) : ''}, {formatBytes(item.sizeOut)}
                {ratio !== null ? ` (${Math.round(ratio * 100)} % de l’original)` : ''}, en {formatDuration(Math.max(1, item.elapsedMs / 1000))}
              </>
            ) : (
              item.message ?? st.label
            )}
          </div>
          {item.status === 'running' ? <Bar value={item.progress} /> : null}
          {item.notes.length && (item.status === 'done' || item.sourceTrashed) ? (
            <ul className="task-notes">
              {item.notes
                .filter((n) => !n.startsWith('Encodeur matériel'))
                .map((n) => (
                  <li key={n} className={n.startsWith('Original placé') ? 'is-trashed' : n.startsWith('Original conservé') ? 'is-kept' : ''}>
                    {n}
                  </li>
                ))}
            </ul>
          ) : null}
          {open && item.errorDetails ? <pre className="error-details">{item.errorDetails}</pre> : null}
        </div>
        <div className="task-item-actions">
          {item.status === 'done' && item.output ? (
            <>
              <IconButton icon="open" label="Ouvrir le fichier" onClick={() => void api.openPath(item.output as string)} />
              <IconButton icon="reveal" label="Afficher dans le Finder" onClick={() => void reveal(item.output as string)} />
            </>
          ) : null}
          {item.status === 'skipped' && item.output ? (
            <IconButton icon="reveal" label="Afficher le fichier existant dans le Finder" onClick={() => void reveal(item.output as string)} />
          ) : null}
          {item.status === 'failed' ? (
            <>
              {item.errorDetails ? (
                <Button size="sm" variant="ghost" onClick={() => setOpen(!open)}>
                  {open ? 'Masquer les détails' : 'Détails'}
                </Button>
              ) : null}
              <IconButton
                icon="copy"
                label="Copier le rapport d’erreur"
                onClick={() => {
                  void api.copyText(errorReport(job, item));
                  notify('ok', 'Rapport d’erreur copié.');
                }}
              />
            </>
          ) : null}
          <Pill tone={st.tone}>{st.label}</Pill>
        </div>
      </div>
    </li>
  );
}

function JobCard({ job, notify }: { job: JobSnapshot; notify: Props['notify'] }) {
  const api = window.atelier;
  const active = isActive(job);
  const [showAll, setShowAll] = useState(false);
  useTick(job.state === 'running');
  const current = job.currentIndex >= 0 ? job.items[job.currentIndex] : null;
  const pending = job.counts.pending + job.counts.running;
  const st = JOB_STATE[job.state];
  const items = showAll || job.items.length <= 60 ? job.items : job.items.slice(0, 60);
  const outputs = job.items.filter((i) => i.status === 'done' && i.output);

  return (
    <article className={`job-card state-${job.state}`}>
      <header className="job-head">
        <div>
          <div className="job-title">
            <Icon name={job.kind === 'audio' ? 'audio' : 'video'} size={16} />
            {job.profileLabel}
          </div>
          <div className="job-meta">
            {job.startedAt ? `Lancée le ${formatDateTime(job.startedAt)}` : 'En attente de la tâche précédente'}
            {job.deleteSource ? <span className="tone-danger-text">, originaux vers la Corbeille</span> : null}
          </div>
        </div>
        <div className="job-actions">
          <Pill tone={st.tone}>{st.label}</Pill>
          {job.state === 'running' && job.canPause ? (
            <Button size="sm" icon="pause" onClick={() => void api.pauseJob(job.id)}>
              Mettre en pause
            </Button>
          ) : null}
          {job.state === 'paused' ? (
            <Button size="sm" icon="play" variant="primary" onClick={() => void api.resumeJob(job.id)}>
              Reprendre
            </Button>
          ) : null}
          {active ? (
            <Button size="sm" icon="stop" variant="danger" onClick={() => void api.cancelJob(job.id)}>
              Annuler
            </Button>
          ) : null}
        </div>
      </header>

      {active ? (
        <div className="job-progress">
          <Meter value={job.state === 'queued' ? 0 : job.progress} label="Progression globale" />
          <div className="job-stats">
            <div>
              <span>{job.counts.running > 1 ? `${job.counts.running} fichiers en cours` : 'Fichier en cours'}</span>
              <strong title={current?.source}>
                {current ? current.name : job.state === 'queued' ? 'En attente' : '—'}
                {job.counts.running > 1 ? ` et ${job.counts.running - 1} autre${job.counts.running > 2 ? 's' : ''}` : ''}
              </strong>
            </div>
            <div>
              <span>Progression</span>
              <strong>{Math.round(job.progress * 100)} %</strong>
            </div>
            <div>
              <span>Écoulé</span>
              <strong>{formatClock(live(job.elapsedMs, job))}</strong>
            </div>
            <div>
              <span>Restant</span>
              <strong>
                {plural(pending, 'fichier', 'fichiers')}
                {job.etaSec !== null ? `, ≈ ${formatDuration(job.etaSec)}` : ''}
              </strong>
            </div>
          </div>
        </div>
      ) : (
        <div className="job-summary">
          <div className="summary-cell tone-ok"><strong>{job.counts.done}</strong><span>{job.counts.done > 1 ? 'convertis' : 'converti'}</span></div>
          <div className="summary-cell"><strong>{job.counts.skipped}</strong><span>{job.counts.skipped > 1 ? 'ignorés' : 'ignoré'}</span></div>
          <div className={`summary-cell${job.counts.failed ? ' tone-danger' : ''}`}><strong>{job.counts.failed}</strong><span>{job.counts.failed > 1 ? 'échecs' : 'échec'}</span></div>
          {job.counts.cancelled ? <div className="summary-cell"><strong>{job.counts.cancelled}</strong><span>{job.counts.cancelled > 1 ? 'annulés' : 'annulé'}</span></div> : null}
          <div className="summary-cell"><strong>{formatDuration(Math.max(1, job.elapsedMs / 1000))}</strong><span>durée totale</span></div>
          {outputs.length ? (
            <Button size="sm" icon="reveal" onClick={() => void api.revealInFinder(outputs[0].output as string)}>
              Afficher les sorties
            </Button>
          ) : null}
        </div>
      )}

      {job.fatalError ? <Notice tone="danger" title="La tâche s’est arrêtée">{job.fatalError}</Notice> : null}

      <ul className="task-items">
        {items.map((it) => (
          <ItemRow key={it.id} job={job} item={it} notify={notify} />
        ))}
      </ul>
      {items.length < job.items.length ? (
        <Button variant="ghost" size="sm" onClick={() => setShowAll(true)}>
          Afficher les {job.items.length - items.length} autres fichiers
        </Button>
      ) : null}
    </article>
  );
}

export function TasksView({ jobs, notify, onClear, goAudio, notifySound, onNotifySound }: Props) {
  const ordered = [...jobs].sort((a, b) => Number(isActive(b)) - Number(isActive(a)) || b.createdAt - a.createdAt);
  const finished = jobs.filter((j) => !isActive(j)).length;
  return (
    <div className="page">
      <header className="page-head drag">
        <div>
          <h1>Tâches</h1>
          <p className="lede">Suivez les conversions en cours. Une tâche audio et une tâche vidéo peuvent tourner en même temps ; les autres attendent leur tour.</p>
        </div>
        <div className="head-actions">
          <Switch checked={notifySound} onChange={onNotifySound} label="Son de fin de tâche" />
          <Button variant="ghost" icon="trash" onClick={onClear} disabled={!finished}>
            Effacer les tâches terminées
          </Button>
        </div>
      </header>
      {ordered.length === 0 ? (
        <div className="empty">
          <Icon name="tasks" size={22} />
          <div className="empty-title">Aucune tâche pour le moment</div>
          <p>Ajoutez des fichiers dans Audio ou Vidéo, puis lancez une conversion : elle apparaîtra ici.</p>
          <Button onClick={goAudio} icon="audio">
            Aller à Audio
          </Button>
        </div>
      ) : (
        <div className="job-list">
          {ordered.map((j) => (
            <JobCard key={j.id} job={j} notify={notify} />
          ))}
        </div>
      )}
    </div>
  );
}
