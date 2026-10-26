import { estimateVideoBytes, sourceVideoBitrate } from '../../shared/estimate';
import { AUDIO_ADVICE, defaultVideoSettings, formatMbps, VIDEO_ADVICE, videoAdviceFor } from '../../shared/profiles';
import type { MediaItem, VideoSettings } from '../../shared/types';
import { formatBytes, resolutionLabel } from '../lib/format';
import type { WorkspaceState } from '../lib/state';
import { Button, Modal } from './ui';

const mbps = (bps: number) => formatMbps(Math.round(bps / 100_000) / 10);
const half = (v: number) => Math.round(v * 2) / 2;

interface FileAdvice {
  item: MediaItem;
  now: number | null;
  label: string;
  verdict: string;
  target: number | null;
}

function adviceFor(item: MediaItem, s: VideoSettings): FileAdvice | null {
  const p = item.probe;
  if (!p?.displayWidth || !p.displayHeight) return null;
  const now = sourceVideoBitrate(item);
  const { row, factor } = videoAdviceFor(p.displayWidth, p.displayHeight, p.fps);
  const quality = half(row.hevc * factor);
  const compact = half(row.compact * factor);
  const label = [resolutionLabel(p.displayWidth, p.displayHeight), p.videoCodec?.toUpperCase().replace('H264', 'H.264')].filter(Boolean).join(', ');
  const size = (target: number) => {
    const est = estimateVideoBytes(item, { ...defaultVideoSettings('custom'), codec: 'hevc', videoBitrateMbps: target, audioBitrateKbps: 192, audioSelection: s.audioSelection, subtitleSelection: s.subtitleSelection });
    if (est === null) return '';
    const pct = Math.round((1 - est / item.size) * 100);
    return ` ≈ ${formatBytes(est)}${pct > 0 ? ` (−${pct} %)` : ''}`;
  };
  const multi = p.audioTracks.length > 1 ? ' Plusieurs pistes audio : n’en garder qu’une fait gagner davantage.' : '';
  if (now === null) return { item, now, label, verdict: `Débit inconnu. Repère : HEVC ${formatMbps(quality)}.${multi}`, target: quality };
  const nowMbps = now / 1_000_000;
  if (nowMbps <= compact * 1.1) {
    return { item, now, label, verdict: `Déjà très compacte : réencoder ferait perdre de la qualité pour presque rien.${multi}`, target: null };
  }
  if (nowMbps <= quality * 1.15) {
    return { item, now, label, verdict: `Déjà compacte. Pour gagner encore : HEVC ${formatMbps(compact)}${size(compact)}, avec une légère perte.${multi}`, target: compact };
  }
  return { item, now, label, verdict: `HEVC ${formatMbps(quality)}${size(quality)}, sans perte visible.${multi}`, target: quality };
}

export function VideoAdviceDialog({ ws, onApply, onClose }: { ws: WorkspaceState; onApply: (mbps: number) => void; onClose: () => void }) {
  const files = ws.items
    .filter((i) => i.status === 'ready')
    .slice(0, 6)
    .map((i) => adviceFor(i, ws.video))
    .filter((x): x is FileAdvice => !!x);

  return (
    <Modal title="Conseils de réglage vidéo" onClose={onClose} wide footer={<Button onClick={onClose}>Fermer</Button>}>
      <div className="advice">
        {files.length ? (
          <section>
            <h3>Vos fichiers</h3>
            <ul className="advice-files">
              {files.map((f) => (
                <li key={f.item.id}>
                  <div className="advice-file-head">
                    <span className="advice-file-name" title={f.item.name}>
                      {f.item.name}
                    </span>
                    <span className="cell-muted">
                      {f.now ? `${mbps(f.now)}, ` : ''}
                      {f.label}
                    </span>
                  </div>
                  <div className="advice-file-verdict">
                    <span>{f.verdict}</span>
                    {f.target ? (
                      <Button size="sm" variant="ghost" onClick={() => onApply(f.target as number)}>
                        Utiliser HEVC {formatMbps(f.target)}
                      </Button>
                    ) : null}
                  </div>
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        <section>
          <h3>Débit vidéo conseillé</h3>
          <table className="advice-table">
            <thead>
              <tr>
                <th>Résolution</th>
                <th>Envoi YouTube (H.264)</th>
                <th>HEVC qualité</th>
                <th>HEVC compact</th>
              </tr>
            </thead>
            <tbody>
              {VIDEO_ADVICE.map((r) => (
                <tr key={r.res}>
                  <td>{r.res}</td>
                  <td>{formatMbps(r.youtube)}</td>
                  <td>{formatMbps(r.hevc)}</td>
                  <td>{formatMbps(r.compact)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="fine-print">
            Pour 24 à 30 images par seconde ; comptez la moitié en plus à 50 ou 60 i/s. « Qualité » : aucune différence visible. « Compact » : très bien sur
            téléphone ou ordinateur, quelques défauts possibles sur grand écran. Un dessin animé supporte un débit plus bas ; le sport, la pluie ou le grain
            de pellicule en demandent davantage.
          </p>
        </section>

        <section>
          <h3>Qualité audio (AAC)</h3>
          <table className="advice-table">
            <tbody>
              {AUDIO_ADVICE.map((a) => (
                <tr key={a.use}>
                  <td>{a.use}</td>
                  <td>{a.kbps}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>

        <section>
          <h3>Quel mode choisir ?</h3>
          <dl className="advice-modes">
            <dt>Pistes seulement</dt>
            <dd>Retirer des langues ou des sous-titres. Aucune perte, quelques minutes pour un film. À essayer en premier sur un MKV multilingue.</dd>
            <dt>YouTube</dt>
            <dd>Mettre une vidéo en ligne : résolution d’origine, débit généreux.</dd>
            <dt>Archivage</dt>
            <dd>Gagner de la place sur des vidéos de téléphone ou d’appareil photo, souvent très lourdes.</dd>
            <dt>Personnalisé</dt>
            <dd>Choisir soi-même le codec, la résolution et le débit, par exemple d’après ce tableau.</dd>
          </dl>
          <p className="fine-print">
            Repère : 1 Mbit/s représente environ 450 Mo par heure de vidéo. Une vidéo déjà encodée sous le débit choisi grossirait : elle est alors marquée
            « Inutile » et ignorée. La colonne Format du tableau des médias affiche le débit actuel de chaque fichier.
          </p>
        </section>
      </div>
    </Modal>
  );
}
