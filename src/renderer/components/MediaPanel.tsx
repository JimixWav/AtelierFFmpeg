import { useState, type DragEvent } from 'react';
import { estimateBytes, sourceBitrate, uselessVideoReason } from '../../shared/estimate';
import { AUDIO_SOURCE_GROUPS, uselessAudioReason } from '../../shared/profiles';
import type { AudioSourceGroup, MediaItem, MediaKind } from '../../shared/types';
import { formatBytes, formatDuration, resolutionLabel } from '../lib/format';
import type { WorkspaceState } from '../lib/state';
import { Icon } from './Icon';
import { Button, IconButton, Pill, Switch } from './ui';

interface Props {
  ws: WorkspaceState;
  update: (patch: Partial<WorkspaceState>) => void;
  onAddFiles: () => void;
  onAddFolder: () => void;
  onDropPaths: (paths: string[]) => void;
  locked: boolean;
}

const COPY: Record<MediaKind, { empty: string; hint: string; addFiles: string }> = {
  audio: {
    empty: 'Déposez des fichiers audio ou un dossier ici',
    hint: 'Seuls les formats cochés ci-dessus sont ajoutés. Les fichiers restent sur ce Mac.',
    addFiles: 'Ajouter des fichiers',
  },
  video: {
    empty: 'Déposez des vidéos ou un dossier ici',
    hint: 'MP4, MOV, MKV, AVI, WebM, MTS… Les fichiers restent sur ce Mac.',
    addFiles: 'Ajouter des fichiers',
  },
};

function statusOf(it: MediaItem) {
  if (it.status === 'ready') return <Pill tone="ok">Prêt</Pill>;
  if (it.status === 'unsupported') return <Pill tone="warn">{it.message ?? 'Non pris en charge'}</Pill>;
  return <Pill tone="danger">{it.message ?? 'Erreur'}</Pill>;
}

function detailOf(it: MediaItem): string {
  const p = it.probe;
  if (!p) return it.ext.toUpperCase();
  if (it.kind === 'video') {
    const res = resolutionLabel(p.displayWidth, p.displayHeight);
    const tracks = [
      p.audioTracks.length > 1 ? `${p.audioTracks.length} audio` : '',
      p.subtitles.length ? `${p.subtitles.length} s.-titres` : '',
    ];
    const rate = sourceBitrate(it);
    const mbps = rate ? `${(rate / 1_000_000).toFixed(1).replace('.', ',')} Mbit/s` : '';
    // Débit en tête : c'est l'information qui décide si une compression est utile.
    return [mbps, res, p.videoCodec?.toUpperCase(), it.ext.toUpperCase(), ...tracks].filter(Boolean).join(', ');
  }
  const codec = p.audioCodecs[0]?.replace('pcm_', 'PCM ').toUpperCase();
  const ext = it.ext.toUpperCase();
  return codec && codec !== ext ? `${ext}, ${codec}` : ext;
}

export function MediaPanel({ ws, update, onAddFiles, onAddFolder, onDropPaths, locked }: Props) {
  const [dragging, setDragging] = useState(false);
  const copy = COPY[ws.kind];
  const total = ws.items.reduce((a, b) => a + b.size, 0);
  const ready = ws.items.filter((i) => i.status === 'ready').length;

  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setDragging(false);
    if (locked) return;
    const paths = [...e.dataTransfer.files].map((f) => window.atelier.getPathForFile(f)).filter(Boolean);
    if (paths.length) onDropPaths(paths);
  };
  const dragProps = {
    onDragOver: (e: DragEvent) => {
      e.preventDefault();
      if (!locked) setDragging(true);
    },
    onDragLeave: (e: DragEvent) => {
      if (e.currentTarget === e.target) setDragging(false);
    },
    onDrop,
  };

  const afterCell = (it: MediaItem) => {
    const useless = ws.kind === 'audio' ? uselessAudioReason(it, ws.audio) : uselessVideoReason(it, ws.video);
    if (useless) {
      return (
        <span className="est-useless" title={useless}>
          Inutile
        </span>
      );
    }
    const e = estimateBytes(it, ws.kind, ws.audio, ws.video);
    if (e === null) return <span className="cell-muted">—</span>;
    return <span className={e > it.size * 1.02 ? 'est-larger' : 'est-smaller'}>≈ {formatBytes(e)}</span>;
  };

  const remove = (id: string) => update({ items: ws.items.filter((i) => i.id !== id) });

  const toggleSource = (g: AudioSourceGroup) => {
    const cur = ws.audio.sources;
    const next = cur.includes(g) ? cur.filter((x) => x !== g) : [...cur, g];
    if (next.length) update({ audio: { ...ws.audio, sources: next } });
  };

  const sourceChips =
    ws.kind === 'audio' ? (
      <div className="source-chips" role="group" aria-label="Formats source acceptés">
        <span className="source-chips-label">Formats source</span>
        {AUDIO_SOURCE_GROUPS.map((g) => {
          const on = ws.audio.sources.includes(g.id);
          return (
            <button
              key={g.id}
              type="button"
              className={`chip${on ? ' is-on' : ''}`}
              aria-pressed={on}
              disabled={locked || (on && ws.audio.sources.length === 1)}
              title={on && ws.audio.sources.length === 1 ? 'Au moins un format doit rester coché' : `.${g.extensions.slice(0, 6).join(', .')}`}
              onClick={() => toggleSource(g.id)}
            >
              {on ? <Icon name="check" size={12} /> : null}
              {g.label}
            </button>
          );
        })}
      </div>
    ) : null;

  const toolbar = (
    <div className="media-toolbar">
      <div className="media-actions">
        <Button icon="filePlus" onClick={onAddFiles} disabled={locked} busy={ws.adding}>
          {copy.addFiles}
        </Button>
        <Button icon="folderPlus" onClick={onAddFolder} disabled={locked || ws.adding}>
          Ajouter un dossier
        </Button>
        <Switch checked={ws.recursive} onChange={(v) => update({ recursive: v })} label="Inclure les sous-dossiers" />
      </div>
    </div>
  );

  if (ws.items.length === 0) {
    return (
      <div className="media-panel">
        {toolbar}
        {sourceChips}
        <div className={`dropzone${dragging ? ' is-dragging' : ''}`} {...dragProps}>
          <div className="dropzone-icon">
            <Icon name={ws.adding ? 'refresh' : 'drop'} size={22} className={ws.adding ? 'spin' : undefined} />
          </div>
          <div className="dropzone-title">{ws.adding ? 'Analyse des fichiers…' : copy.empty}</div>
          <div className="dropzone-hint">{copy.hint}</div>
        </div>
      </div>
    );
  }
  return (
    <div className="media-panel">
      {toolbar}
      {sourceChips}
      <div className={`file-table-wrap${dragging ? ' is-dragging' : ''}`} {...dragProps}>
        <table className="file-table">
          <thead>
            <tr>
              <th>Nom</th>
              <th>Format</th>
              <th className="num">Durée</th>
              <th className="num">Taille</th>
              <th className="num" title="Taille estimée après conversion avec les réglages actuels">Après</th>
              <th>Dossier</th>
              <th>Statut</th>
              <th className="col-action"><span className="sr-only">Retirer</span></th>
            </tr>
          </thead>
          <tbody>
            {ws.items.map((it) => (
              <tr key={it.id}>
                <td className="cell-name" title={it.path}>{it.name}</td>
                <td className="cell-muted cell-format" title={detailOf(it)}>{detailOf(it)}</td>
                <td className="num cell-muted">{formatDuration(it.probe?.durationSec)}</td>
                <td className="num">{formatBytes(it.size)}</td>
                <td className="num">{afterCell(it)}</td>
                <td className="cell-muted cell-dir" title={it.dir}>{it.relDir || it.dir.split('/').pop() || '/'}</td>
                <td>{statusOf(it)}</td>
                <td className="col-action">
                  <IconButton icon="x" label={`Retirer ${it.name} de la liste`} onClick={() => remove(it.id)} disabled={locked} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="media-summary">
        <span>
          <strong>{ws.items.length}</strong> {ws.items.length > 1 ? 'médias' : 'média'}, {formatBytes(total)} au total
          {ready < ws.items.length ? <span className="cell-muted">, dont {ready} {ready > 1 ? 'prêts' : 'prêt'} à convertir</span> : null}
        </span>
        <Button variant="ghost" size="sm" onClick={() => update({ items: [] })} disabled={locked}>
          Tout retirer
        </Button>
      </div>
    </div>
  );
}
