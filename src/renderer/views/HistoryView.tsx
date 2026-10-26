import { useState } from 'react';
import type { HistoryEntry } from '../../shared/types';
import { Icon } from '../components/Icon';
import { Button, IconButton, ITEM_STATUS, JOB_STATE, Pill } from '../components/ui';
import { basename, formatDateTime, formatDuration, plural } from '../lib/format';

export function HistoryView({ history, onClear, notify }: { history: HistoryEntry[]; onClear: () => void; notify: (t: 'ok' | 'warn', s: string) => void }) {
  const [open, setOpen] = useState<string | null>(null);
  const api = window.atelier;
  const reveal = async (p: string) => {
    if (!(await api.revealInFinder(p))) notify('warn', 'Ce fichier n’existe plus à cet emplacement.');
  };
  return (
    <div className="page">
      <header className="page-head drag">
        <div>
          <h1>Historique</h1>
          <p className="lede">Les dernières conversions, enregistrées uniquement sur ce Mac.</p>
        </div>
        <Button variant="ghost" icon="trash" onClick={onClear} disabled={!history.length}>
          Effacer l’historique
        </Button>
      </header>
      {history.length === 0 ? (
        <div className="empty">
          <Icon name="history" size={22} />
          <div className="empty-title">Historique vide</div>
          <p>Chaque conversion terminée, annulée ou en échec sera listée ici avec ses fichiers de sortie.</p>
        </div>
      ) : (
        <ul className="history-list">
          {history.map((h) => {
            const st = JOB_STATE[h.state];
            const isOpen = open === h.id;
            return (
              <li key={h.id} className={`history-entry${isOpen ? ' is-open' : ''}`}>
                <button type="button" className="history-head" aria-expanded={isOpen} onClick={() => setOpen(isOpen ? null : h.id)}>
                  <Icon name={h.kind === 'audio' ? 'audio' : 'video'} size={16} />
                  <span className="history-title">
                    <span>{h.profileLabel}</span>
                    <span className="cell-muted">
                      {formatDateTime(h.finishedAt ?? h.startedAt)}, {plural(h.counts.done, 'converti', 'convertis')}
                      {h.counts.skipped ? `, ${plural(h.counts.skipped, 'ignoré', 'ignorés')}` : ''}
                      {h.counts.failed ? `, ${plural(h.counts.failed, 'échec', 'échecs')}` : ''}, en {formatDuration(Math.max(1, h.elapsedMs / 1000))}
                    </span>
                  </span>
                  <Pill tone={st.tone}>{st.label}</Pill>
                  <Icon name="chevronDown" size={14} className="history-chevron" />
                </button>
                {isOpen ? (
                  <ul className="history-items">
                    {h.items.map((i, idx) => (
                      <li key={`${i.source}-${idx}`}>
                        <Pill tone={ITEM_STATUS[i.status].tone}>{ITEM_STATUS[i.status].label}</Pill>
                        <span className="history-file" title={i.source}>
                          {basename(i.source)}
                          {i.output ? <span className="cell-muted"> → {basename(i.output)}</span> : null}
                          {i.message && i.status !== 'done' ? <span className="cell-muted">, {i.message}</span> : null}
                          {i.sourceTrashed ? <span className="tone-danger-text">, original dans la Corbeille</span> : null}
                        </span>
                        {i.output ? <IconButton icon="reveal" label="Afficher dans le Finder" onClick={() => void reveal(i.output as string)} /> : null}
                      </li>
                    ))}
                  </ul>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
