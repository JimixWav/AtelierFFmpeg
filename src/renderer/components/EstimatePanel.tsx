import { summarizeEstimates, uselessVideoReason } from '../../shared/estimate';
import { audioFormatMeta, uselessAudioReason } from '../../shared/profiles';
import { formatBytes, plural } from '../lib/format';
import type { WorkspaceState } from '../lib/state';
import { Notice } from './ui';

export function deltaLabel(delta: number | null): string {
  if (delta === null) return '';
  const pct = Math.round(Math.abs(delta) * 100);
  if (pct === 0) return 'taille quasi identique';
  return delta < 0 ? `${pct} % plus léger` : `${pct} % plus lourd`;
}

/** Estimation de la taille après conversion, pour un fichier ou toute la sélection. */
export function EstimatePanel({ ws }: { ws: WorkspaceState }) {
  const ready = ws.items.filter((i) => i.status === 'ready');
  const est = summarizeEstimates(ready, ws.kind, ws.audio, ws.video);

  if (!ready.length) {
    return <p className="estimate-empty">Ajoutez des fichiers pour voir la taille estimée après conversion.</p>;
  }
  const uselessReason = (i: (typeof ready)[number]) => (ws.kind === 'audio' ? uselessAudioReason(i, ws.audio) : uselessVideoReason(i, ws.video));
  const uselessNote = est.useless ? (
    <Notice tone="info" title={`${plural(est.useless, 'fichier ignoré', 'fichiers ignorés')} avec ce réglage`}>
      {est.useless === 1 ? uselessReason(ready.find((i) => uselessReason(i)) ?? ready[0]) : 'La conversion ne les rendrait pas plus légers. Survolez « Inutile » dans le tableau pour le détail.'}
    </Notice>
  ) : null;
  if (!est.count) {
    return est.useless ? (
      <div className="estimate">{uselessNote}</div>
    ) : (
      <p className="estimate-empty">Durée inconnue : la taille après conversion ne peut pas être estimée.</p>
    );
  }

  const ratio = est.sizeIn > 0 ? Math.min(est.sizeOut / est.sizeIn, 1) : 1;
  const grows = est.sizeOut > est.sizeIn;
  const single = est.count === 1 && ready.length === 1 ? ready[0].name : null;
  const lossless = ws.kind === 'audio' && audioFormatMeta(ws.audio.format).lossless && ws.audio.format !== 'wav';

  return (
    <div className="estimate" aria-live="polite">
      <div className="estimate-head">
        <span className="estimate-title">Taille estimée</span>
        <span className="estimate-scope">{single ? `« ${single} »` : plural(est.count, 'fichier', 'fichiers')}</span>
      </div>
      <div className="estimate-bars">
        <div className="estimate-row">
          <span className="estimate-label">Avant</span>
          <span className="estimate-track">
            <span className="estimate-fill is-before" style={{ width: grows ? `${Math.max(4, (est.sizeIn / est.sizeOut) * 100)}%` : '100%' }} />
          </span>
          <span className="estimate-value">{formatBytes(est.sizeIn)}</span>
        </div>
        <div className="estimate-row">
          <span className="estimate-label">Après</span>
          <span className="estimate-track">
            <span className={`estimate-fill is-after${grows ? ' is-larger' : ''}`} style={{ width: grows ? '100%' : `${Math.max(2, ratio * 100)}%` }} />
          </span>
          <span className="estimate-value">≈ {formatBytes(est.sizeOut)}</span>
        </div>
      </div>
      <div className={`estimate-delta${grows ? ' is-larger' : ''}`}>{deltaLabel(est.delta)}</div>
      {est.larger > 0 && ws.kind === 'video' ? (
        <Notice tone="warn" title={`${plural(est.larger, 'fichier risque', 'fichiers risquent')} d’être plus lourd${est.larger > 1 ? 's' : ''} que l’original`}>
          Leur débit actuel est déjà inférieur au réglage choisi. Baissez le débit vidéo dans les réglages avancés, ou gardez ces fichiers tels quels.
        </Notice>
      ) : null}
      {uselessNote}
      <p className="fine-print">
        {ws.kind === 'video' && ws.video.profile === 'remux'
          ? 'Calcul : taille de l’image d’origine + pistes audio gardées. Les pistes retirées font tout le gain.'
          : ws.kind === 'video'
          ? 'Calcul : débit choisi × durée. Le résultat réel est en général un peu inférieur, surtout pour les images simples ou peu animées.'
          : lossless
            ? 'Compression sans perte : selon la musique, le résultat va d’environ 40 à 70 % de la taille d’un WAV.'
            : 'Calcul : débit moyen du format choisi × durée. Le résultat réel varie légèrement selon la musique.'}
        {est.unknown ? ` ${plural(est.unknown, 'fichier sans durée connue n’est', 'fichiers sans durée connue ne sont')} pas compté${est.unknown > 1 ? 's' : ''}.` : ''}
      </p>
    </div>
  );
}
