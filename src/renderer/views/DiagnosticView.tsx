import { useState } from 'react';
import { TRACKED_ENCODER_INFO } from '../lib/encoders';
import type { Environment, UpdateCheck } from '../../shared/types';
import { ffmpegVersionAdvice } from '../../shared/profiles';
import { BRAND, copyrightLine } from '../../shared/brand';
import { Icon } from '../components/Icon';
import { Button, Notice, Pill } from '../components/ui';
import { formatDateTime } from '../lib/format';

const BREW_INSTALL = '/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"';

function CopyLine({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="code-line">
      <code>{text}</code>
      <Button
        size="sm"
        variant="ghost"
        icon={copied ? 'check' : 'copy'}
        onClick={() => {
          void window.atelier.copyText(text);
          setCopied(true);
          setTimeout(() => setCopied(false), 1600);
        }}
      >
        {copied ? 'Copié' : 'Copier'}
      </Button>
    </div>
  );
}

export function InstallSteps() {
  return (
    <ol className="install-steps">
      <li>
        <span>Ouvrez le Terminal. Si Homebrew n’est pas installé, installez-le :</span>
        <CopyLine text={BREW_INSTALL} />
      </li>
      <li>
        <span>Installez FFmpeg (ffprobe est inclus) :</span>
        <CopyLine text="brew install ffmpeg" />
      </li>
      <li>
        <span>Revenez ici et cliquez sur « Vérifier à nouveau ». L’application ne lance aucune installation elle-même.</span>
      </li>
    </ol>
  );
}

export function FfmpegMissing({ env, goDiagnostic }: { env: Environment; goDiagnostic: () => void }) {
  return (
    <Notice
      tone="danger"
      title={env.ffmpegPath ? 'FFmpeg ne fonctionne pas correctement' : 'FFmpeg n’est pas installé sur ce Mac'}
      action={
        <Button size="sm" onClick={goDiagnostic} icon="diagnostic">
          Ouvrir Diagnostic
        </Button>
      }
    >
      {env.error} Les conversions sont désactivées tant que FFmpeg n’est pas disponible.
    </Notice>
  );
}

function UpdateSection({ env }: { env: Environment }) {
  const [check, setCheck] = useState<UpdateCheck | null>(null);
  const [busy, setBusy] = useState(false);
  const run = async () => {
    setBusy(true);
    try {
      setCheck(await window.atelier.checkFfmpegUpdate());
    } catch (e) {
      setCheck({ status: 'error', message: (e as Error).message, installed: null, latest: null, checkedAt: Date.now() });
    } finally {
      setBusy(false);
    }
  };
  const advice = ffmpegVersionAdvice(env.ffmpegVersion);
  const tone = !check ? null : check.status === 'up-to-date' ? 'ok' : check.status === 'outdated' ? 'warn' : 'info';
  return (
    <div className="update-box">
      {advice ? <Notice tone="warn" title="Version ancienne">{advice}</Notice> : null}
      <div className="update-row">
        <span className="cell-muted">
          Au démarrage, l’application vérifie que FFmpeg est présent et que ses encodeurs fonctionnent. Les mises à jour se vérifient à la demande, via
          Homebrew.
        </span>
        <Button size="sm" icon="refresh" onClick={() => void run()} busy={busy}>
          Rechercher une mise à jour
        </Button>
      </div>
      {busy ? <p className="fine-print">Homebrew consulte son catalogue, cela peut prendre jusqu’à une minute…</p> : null}
      {check && tone && !busy ? (
        <Notice tone={tone as 'ok' | 'warn' | 'info'} title={check.status === 'up-to-date' ? 'FFmpeg est à jour' : check.status === 'outdated' ? 'Mise à jour disponible' : undefined}>
          {check.message}
          {check.status === 'outdated' ? (
            <>
              <CopyLine text="brew upgrade ffmpeg" />
              <span className="fine-print">Une fois la mise à jour terminée, cliquez sur « Vérifier à nouveau » en haut de la page.</span>
            </>
          ) : null}
        </Notice>
      ) : null}
    </div>
  );
}

export function DiagnosticView({ env, onRefresh, onChoose, onReset, refreshing }: { env: Environment | null; onRefresh: () => void; onChoose: () => void; onReset: () => void; refreshing: boolean }) {
  const report = env
    ? [
        'Atelier FFmpeg — diagnostic',
        `Système : ${env.platform} ${env.arch}`,
        `ffmpeg : ${env.ffmpegPath ?? 'introuvable'}`,
        `ffprobe : ${env.ffprobePath ?? 'introuvable'}`,
        `Version : ${env.versionLine ?? '—'}`,
        ...Object.values(env.encoders).map((e) => `${e.name} : ${e.usable ? 'utilisable' : e.listed ? 'listé, inutilisable' : 'absent'}${e.detail ? ` (${e.detail})` : ''}`),
        env.error ? `Erreur : ${env.error}` : '',
      ]
        .filter(Boolean)
        .join('\n')
    : '';

  return (
    <div className="page">
      <header className="page-head drag">
        <div>
          <h1>Diagnostic</h1>
          <p className="lede">Vérifie que FFmpeg est installé et que les encodeurs attendus fonctionnent sur ce Mac.</p>
        </div>
        <div className="head-actions">
          <Button icon="copy" variant="ghost" onClick={() => void window.atelier.copyText(report)} disabled={!env}>
            Copier le rapport
          </Button>
          <Button icon="refresh" onClick={onRefresh} busy={refreshing}>
            Vérifier à nouveau
          </Button>
        </div>
      </header>

      {!env ? (
        <div className="empty">
          <span className="spinner" />
          <div className="empty-title">Vérification de FFmpeg…</div>
        </div>
      ) : (
        <>
          <section className="diag-card">
            <div className="diag-status">
              <span className={`diag-badge tone-${env.ok ? 'ok' : 'danger'}`}>
                <Icon name={env.ok ? 'check' : 'alert'} size={18} />
              </span>
              <div>
                <div className="diag-title">{env.ok ? `FFmpeg ${env.ffmpegVersion ?? ''} est prêt` : 'FFmpeg indisponible'}</div>
                <div className="cell-muted">Vérifié le {formatDateTime(env.checkedAt)}</div>
              </div>
            </div>
            <dl className="diag-grid">
              <dt>ffmpeg</dt>
              <dd className="mono">{env.ffmpegPath ?? 'introuvable'}</dd>
              <dt>ffprobe</dt>
              <dd className="mono">{env.ffprobePath ?? 'introuvable'}</dd>
              <dt>Version</dt>
              <dd className="mono">{env.versionLine ?? '—'}</dd>
              <dt>Système</dt>
              <dd>
                {env.platform === 'darwin' ? 'macOS' : env.platform}, {env.arch === 'arm64' ? 'Apple Silicon (arm64)' : env.arch}
              </dd>
            </dl>
            {env.ok ? <UpdateSection env={env} /> : null}
            <div className="diag-actions">
              <Button size="sm" icon="terminal" onClick={onChoose}>
                Choisir un exécutable ffmpeg…
              </Button>
              {env.customPath ? (
                <Button size="sm" variant="ghost" onClick={onReset}>
                  Revenir à la détection automatique
                </Button>
              ) : null}
            </div>
          </section>

          {!env.ok ? (
            <section className="diag-card">
              <h2>Installer FFmpeg</h2>
              <Notice tone="danger">{env.error}</Notice>
              <InstallSteps />
            </section>
          ) : null}

          {env.ffmpegPath ? (
            <section className="diag-card">
              <h2>Encodeurs</h2>
              <table className="encoder-table">
                <tbody>
                  {TRACKED_ENCODER_INFO.map(({ name, role }) => {
                    const e = env.encoders[name];
                    const tone = e?.usable ? 'ok' : e?.hardware ? 'warn' : 'danger';
                    return (
                      <tr key={name}>
                        <td className="mono">{name}</td>
                        <td>{role}</td>
                        <td>
                          <Pill tone={tone}>{e?.usable ? (e.hardware ? 'Matériel, testé' : 'Disponible') : e?.listed ? 'Inutilisable' : 'Absent'}</Pill>
                        </td>
                        <td className="cell-muted">{e?.detail ?? ''}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              {env.encoders.h264_videotoolbox && !env.encoders.h264_videotoolbox.usable ? (
                <p className="fine-print">
                  Sans VideoToolbox, les profils vidéo utilisent automatiquement libx264 ou libx265 : le résultat est comparable mais l’encodage est plus lent.
                </p>
              ) : null}
            </section>
          ) : null}

          <section className="diag-card">
            <h2>Confidentialité</h2>
            <p className="diag-privacy">
              <Icon name="shield" size={16} />
              Toutes les conversions sont exécutées par FFmpeg sur ce Mac. Aucun média, nom de fichier ni historique n’est envoyé sur Internet. Seule la recherche de mise à jour, lancée par vous, interroge le catalogue de Homebrew.
            </p>
          </section>

          <section className="diag-card about-card">
            <h2>À propos</h2>
            <p className="about-line">
              <strong>{BRAND.name}</strong> <span className="cell-muted">version {__APP_VERSION__}</span>
            </p>
            <p className="about-line">
              Créé par{' '}
              <button type="button" className="link-button" onClick={() => void window.atelier.openAuthorPage()} title="Ouvrir la page GitHub dans le navigateur">
                {BRAND.author}
              </button>
              , {BRAND.createdYear}.
            </p>
            <p className="about-line cell-muted">{copyrightLine()}. Conversions réalisées par FFmpeg, logiciel libre indépendant de cette application.</p>
          </section>
        </>
      )}
    </div>
  );
}
