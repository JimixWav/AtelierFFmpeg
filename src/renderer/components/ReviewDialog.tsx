import { useState } from 'react';
import type { JobPlan, PlanAction } from '../../shared/types';
import { basename, formatBytes, plural, prettyPath } from '../lib/format';
import { deltaLabel } from './EstimatePanel';
import { Button, Checkbox, Modal, Notice, Pill } from './ui';

const ACTION: Record<PlanAction, { label: string; tone: string }> = {
  convert: { label: 'À convertir', tone: 'ok' },
  'skip-exists': { label: 'Déjà présent', tone: 'muted' },
  'skip-useless': { label: 'Inutile, ignoré', tone: 'muted' },
  collision: { label: 'Doublon de nom', tone: 'warn' },
  error: { label: 'Non convertible', tone: 'danger' },
};

const MAX_ROWS = 300;

export function ReviewDialog({ plan, onClose, onStart, starting }: { plan: JobPlan; onClose: () => void; onStart: (confirmDirs: boolean) => void; starting: boolean }) {
  const [confirmDirs, setConfirmDirs] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const needsDirs = plan.dirsToCreate.length > 0;
  const blocked = plan.blocking.length > 0 || plan.counts.convert === 0;
  const canStart = !blocked && (!needsDirs || confirmDirs) && (!plan.deleteSource || confirmDelete);
  const generalWarnings = plan.warnings.filter((w) => !w.startsWith('Les originaux convertis'));

  return (
    <Modal
      title="Vérifier avant de lancer"
      onClose={onClose}
      wide
      footer={
        <>
          <span className="modal-foot-note">{plan.profileLabel}</span>
          <Button variant="ghost" onClick={onClose}>
            Retour
          </Button>
          <Button variant={plan.deleteSource ? 'danger' : 'primary'} icon="play" onClick={() => onStart(confirmDirs)} disabled={!canStart} busy={starting}>
            {plan.counts.convert > 0 ? `Convertir ${plural(plan.counts.convert, 'fichier', 'fichiers')}` : 'Rien à convertir'}
          </Button>
        </>
      }
    >
      <div className="review-counts">
        <div><strong>{plan.counts.convert}</strong><span>à convertir</span></div>
        <div><strong>{plan.counts.skip}</strong><span>ignorés</span></div>
        <div><strong>{plan.counts.collision}</strong><span>doublons de nom</span></div>
        <div><strong>{plan.counts.error}</strong><span>non convertibles</span></div>
      </div>
      {plan.totalEstimated !== null && plan.counts.convert > 0 ? (
        <p className="review-size">
          Taille des fichiers à convertir : <strong>{formatBytes(plan.totalIn)}</strong> → environ <strong>{formatBytes(plan.totalEstimated)}</strong>
          {plan.totalIn > 0 ? ` (${deltaLabel(plan.totalEstimated / plan.totalIn - 1)})` : ''}
        </p>
      ) : null}

      {plan.blocking.map((b) => (
        <Notice key={b} tone="danger" title="Conversion impossible">
          {b}
        </Notice>
      ))}
      {!plan.blocking.length && plan.counts.convert === 0 ? (
        <Notice tone="info" title="Rien à convertir">
          Tous les fichiers sont déjà présents ou ne peuvent pas être convertis. Choisissez « Remplacer » ou « Créer un nom unique » pour les reconvertir.
        </Notice>
      ) : null}
      {generalWarnings.map((w) => (
        <Notice key={w} tone="warn">
          {w}
        </Notice>
      ))}

      {needsDirs ? (
        <div className="review-block">
          <Checkbox
            checked={confirmDirs}
            onChange={setConfirmDirs}
            label={`Créer ${plural(plan.dirsToCreate.length, 'dossier', 'dossiers')} de sortie`}
            description={
              <ul className="path-list">
                {plan.dirsToCreate.slice(0, 8).map((d) => (
                  <li key={d}>{prettyPath(d)}</li>
                ))}
                {plan.dirsToCreate.length > 8 ? <li>et {plan.dirsToCreate.length - 8} autres…</li> : null}
              </ul>
            }
          />
        </div>
      ) : null}

      {plan.deleteSource && plan.counts.convert > 0 ? (
        <div className="review-block is-danger">
          <Checkbox
            checked={confirmDelete}
            onChange={setConfirmDelete}
            label={`Placer les originaux dans la Corbeille après conversion (jusqu’à ${plural(plan.counts.convert, 'fichier', 'fichiers')})`}
            description="Seulement si la sortie est relue avec succès. Les fichiers ignorés ou en échec restent en place."
          />
        </div>
      ) : null}

      <div className="review-list">
        {plan.entries.slice(0, MAX_ROWS).map((e) => (
          <div key={e.itemId} className={`review-row action-${e.action}`}>
            <div className="review-main">
              <div className="review-name" title={e.source}>
                {e.relDir ? <span className="cell-muted">{e.relDir}/</span> : null}
                {e.name}
              </div>
              <div className="review-out">
                {e.output ? <>→ {basename(e.output)}</> : null}
                {e.summary ? <span className="cell-muted"> ({e.summary})</span> : null}
                {e.action === 'convert' && e.estimatedBytes !== null ? (
                  <span className={e.estimatedBytes > e.sizeIn * 1.02 ? 'est-larger' : 'cell-muted'}>
                    {' '}
                    {formatBytes(e.sizeIn)} → ≈ {formatBytes(e.estimatedBytes)}
                  </span>
                ) : null}
              </div>
              {e.message && e.action !== 'skip-exists' ? <div className="review-msg">{e.message}</div> : null}
              {e.notes.some((n) => !n.startsWith('Encodeur matériel')) ? (
                <ul className="review-notes">
                  {e.notes.filter((n) => !n.startsWith('Encodeur matériel')).map((n) => (
                    <li key={n}>{n}</li>
                  ))}
                </ul>
              ) : null}
            </div>
            <Pill tone={e.willReplace ? 'warn' : ACTION[e.action].tone}>{e.willReplace ? 'Sera remplacé' : ACTION[e.action].label}</Pill>
          </div>
        ))}
        {plan.entries.length > MAX_ROWS ? <div className="review-more">et {plan.entries.length - MAX_ROWS} autres fichiers…</div> : null}
      </div>
    </Modal>
  );
}
