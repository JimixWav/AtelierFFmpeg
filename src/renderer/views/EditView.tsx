import { useEffect, useRef, useState, type DragEvent, type KeyboardEvent, type PointerEvent } from 'react';
import {
  defaultEdit, EDIT_FORMATS, editFormatMeta, editOutputName, editProblem, FRAME_MODES, formatTimecode, GIF_FPS, GIF_WIDTHS, isTrimmed, parseTimecode,
} from '../../shared/edit';
import type { EditFormat, EditSettings, Environment, FrameMode, JobSnapshot, MediaItem } from '../../shared/types';
import { Icon } from '../components/Icon';
import { Button, InfoTip, Meter, Notice, Segmented } from '../components/ui';
import { formatBytes, formatDuration, resolutionLabel } from '../lib/format';
import { FfmpegMissing } from './DiagnosticView';

export interface EditState {
  item: MediaItem | null;
  edit: EditSettings;
  waveform: string | null;
  loading: boolean;
}

export const initialEditState: EditState = { item: null, edit: defaultEdit(0), waveform: null, loading: false };

interface Props {
  state: EditState;
  setState: (patch: Partial<EditState> | ((prev: EditState) => Partial<EditState>)) => void;
  env: Environment | null;
  activeJob: JobSnapshot | null;
  notify: (tone: 'ok' | 'info' | 'warn' | 'danger', text: string) => void;
  goDiagnostic: () => void;
  goTasks: () => void;
}

const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));

/* ------------------------------------------------------------------ */
/* Champ de temps (mm:ss,d)                                            */
/* ------------------------------------------------------------------ */

function TimeField({ label, value, onCommit }: { label: string; value: number; onCommit: (v: number) => void }) {
  const [text, setText] = useState(formatTimecode(value));
  const [focused, setFocused] = useState(false);
  useEffect(() => {
    if (!focused) setText(formatTimecode(value));
  }, [value, focused]);
  const commit = () => {
    const v = parseTimecode(text);
    if (v === null) setText(formatTimecode(value));
    else onCommit(v);
  };
  return (
    <label className="time-field">
      <span>{label}</span>
      <input
        value={text}
        aria-label={`${label} (minutes:secondes)`}
        onFocus={() => setFocused(true)}
        onBlur={() => {
          setFocused(false);
          commit();
        }}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
        }}
      />
    </label>
  );
}

/* ------------------------------------------------------------------ */
/* Frise de découpe                                                    */
/* ------------------------------------------------------------------ */

function Timeline({
  duration, start, end, current, waveform, onChange, onSeek, tall,
}: {
  duration: number;
  start: number;
  end: number;
  current: number;
  waveform: string | null;
  onChange: (start: number, end: number) => void;
  onSeek: (t: number) => void;
  tall: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const drag = useRef<'start' | 'end' | null>(null);
  const pct = (t: number) => `${(clamp(t / duration, 0, 1) * 100).toFixed(3)}%`;
  const timeAt = (clientX: number) => {
    const r = ref.current?.getBoundingClientRect();
    if (!r || r.width <= 0) return 0;
    return clamp(((clientX - r.left) / r.width) * duration, 0, duration);
  };
  const minLen = Math.min(0.2, duration / 2);

  const onDown = (which: 'start' | 'end') => (e: PointerEvent) => {
    e.stopPropagation();
    drag.current = which;
    (e.currentTarget as Element).setPointerCapture(e.pointerId);
  };
  const onMove = (e: PointerEvent) => {
    if (!drag.current) return;
    const t = timeAt(e.clientX);
    if (drag.current === 'start') onChange(clamp(t, 0, end - minLen), end);
    else onChange(start, clamp(t, start + minLen, duration));
  };
  const onUp = () => {
    drag.current = null;
  };
  const onKey = (which: 'start' | 'end') => (e: KeyboardEvent) => {
    const step = e.shiftKey ? 1 : 0.1;
    const d = e.key === 'ArrowLeft' ? -step : e.key === 'ArrowRight' ? step : 0;
    if (!d) return;
    e.preventDefault();
    if (which === 'start') onChange(clamp(start + d, 0, end - minLen), end);
    else onChange(start, clamp(end + d, start + minLen, duration));
  };

  return (
    <div
      className={`timeline${tall ? ' is-tall' : ''}`}
      ref={ref}
      onPointerMove={onMove}
      onPointerUp={onUp}
      onPointerDown={(e) => onSeek(timeAt(e.clientX))}
    >
      {waveform ? <img className="timeline-wave" src={waveform} alt="" draggable={false} /> : <div className="timeline-empty" />}
      <div className="timeline-dim" style={{ left: 0, width: pct(start) }} />
      <div className="timeline-dim" style={{ left: pct(end), right: 0 }} />
      <div className="timeline-sel" style={{ left: pct(start), width: `calc(${pct(end)} - ${pct(start)})` }} />
      <div className="timeline-head" style={{ left: pct(current) }} aria-hidden="true" />
      {(['start', 'end'] as const).map((w) => (
        <div
          key={w}
          className={`timeline-handle is-${w}`}
          style={{ left: pct(w === 'start' ? start : end) }}
          role="slider"
          tabIndex={0}
          aria-label={w === 'start' ? 'Début de l’extrait' : 'Fin de l’extrait'}
          aria-valuemin={0}
          aria-valuemax={Math.round(duration)}
          aria-valuenow={Math.round(w === 'start' ? start : end)}
          aria-valuetext={formatTimecode(w === 'start' ? start : end)}
          onPointerDown={onDown(w)}
          onKeyDown={onKey(w)}
        >
          <span />
        </div>
      ))}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Aperçu avec cadre (formats réseaux)                                 */
/* ------------------------------------------------------------------ */

function FrameOverlay({ srcW, srcH, format, frame }: { srcW: number; srcH: number; format: EditFormat; frame: FrameMode }) {
  const size = editFormatMeta(format).size;
  if (!size || frame !== 'crop') return null;
  const aSrc = srcW / srcH;
  const aDst = size.w / size.h;
  const style = aDst < aSrc ? { width: `${(aDst / aSrc) * 100}%`, height: '100%' } : { width: '100%', height: `${(aSrc / aDst) * 100}%` };
  return (
    <div className="frame-overlay" aria-hidden="true">
      <div className="frame-box" style={style} />
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Vue                                                                 */
/* ------------------------------------------------------------------ */

export function EditView({ state, setState, env, activeJob, notify, goDiagnostic, goTasks }: Props) {
  const api = window.atelier;
  const { item, edit, waveform } = state;
  const mediaRef = useRef<HTMLVideoElement & HTMLAudioElement>(null);
  const [current, setCurrent] = useState(0);
  const [playable, setPlayable] = useState(true);
  const [frames, setFrames] = useState<{ start: string | null; end: string | null }>({ start: null, end: null });
  const [dragging, setDragging] = useState(false);
  const [starting, setStarting] = useState(false);
  const stopAt = useRef<number | null>(null);

  const p = item?.probe;
  const isVideo = !!p && p.videoIndex !== null;
  const duration = p?.durationSec ?? 0;
  const set = (patch: Partial<EditSettings>) => setState((prev) => ({ edit: { ...prev.edit, ...patch } }));

  const open = async (path?: string) => {
    setState({ loading: true });
    try {
      const res = await api.openForEdit(path);
      if (res.cancelled) return;
      if (res.rejected.length) {
        notify('warn', res.rejected[0].reason);
        return;
      }
      const it = res.items[0];
      if (!it) return;
      if (it.status !== 'ready') notify('warn', it.message ?? 'Fichier non pris en charge.');
      setPlayable(true);
      setFrames({ start: null, end: null });
      setCurrent(0);
      setState({ item: it, edit: defaultEdit(it.probe?.durationSec ?? 0), waveform: null });
      const wf = await api.getWaveform(it.id);
      setState((prev) => (prev.item?.id === it.id ? { waveform: wf } : {}));
    } catch (e) {
      notify('danger', `Ouverture impossible : ${(e as Error).message}`);
    } finally {
      setState({ loading: false });
    }
  };

  // Images fixes de début et de fin quand la vidéo ne peut pas être lue en aperçu.
  useEffect(() => {
    if (!item || !isVideo || playable) return;
    const t = setTimeout(async () => {
      const [s, e] = await Promise.all([api.getFrame(item.id, edit.start), api.getFrame(item.id, Math.max(0, edit.end - 0.1))]);
      setFrames({ start: s, end: e });
    }, 250);
    return () => clearTimeout(t);
  }, [item, isVideo, playable, edit.start, edit.end, api]);

  const seek = (t: number) => {
    const m = mediaRef.current;
    setCurrent(t);
    if (m && playable) m.currentTime = t;
  };
  const playSelection = () => {
    const m = mediaRef.current;
    if (!m || !playable) return;
    m.currentTime = edit.start;
    stopAt.current = edit.end;
    void m.play();
  };

  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setDragging(false);
    const f = e.dataTransfer.files[0];
    const path = f ? api.getPathForFile(f) : '';
    if (path) void open(path);
  };

  const problem = item ? editProblem(item, edit) : null;
  const outName = item ? editOutputName(item, edit) : '';
  const actionLabel = edit.format === 'gif' ? 'Créer le GIF' : edit.format === 'same' ? 'Créer l’extrait' : 'Créer la vidéo';

  const start = async () => {
    if (!item || problem) return;
    setStarting(true);
    try {
      const res = await api.startJob(
        { kind: item.kind, itemIds: [item.id], edit, destination: { mode: 'beside' }, collision: 'unique', deleteSource: false },
        false,
      );
      if (!res.ok) notify('danger', res.error ?? 'Impossible de lancer l’édition.');
      else notify('ok', `${actionLabel.replace('Créer', 'Création de')} lancée : ${outName}`);
    } finally {
      setStarting(false);
    }
  };

  const fatal = env && !env.ok;

  return (
    <div className="page">
      <header className="page-head drag">
        <div>
          <h1>Édition</h1>
          <p className="lede">Découper un extrait, adapter une vidéo aux réseaux sociaux ou créer un GIF. L’original n’est jamais modifié.</p>
        </div>
      </header>

      {fatal ? <FfmpegMissing env={env} goDiagnostic={goDiagnostic} /> : null}

      {activeJob ? (
        <button type="button" className="running-strip" onClick={goTasks}>
          <span className="running-label">
            {activeJob.state === 'paused' ? 'En pause' : 'En cours'} : {activeJob.items[activeJob.currentIndex]?.name ?? activeJob.profileLabel}
          </span>
          <Meter value={activeJob.progress} segments={24} size="sm" label="Progression de la tâche en cours" />
          <span className="running-link">Voir les tâches</span>
        </button>
      ) : null}

      <section className="step" aria-labelledby="edit-s1">
        <div className="step-num" aria-hidden="true">1</div>
        <div className="step-body">
          <h2 id="edit-s1">Fichier</h2>
          {!item ? (
            <div
              className={`dropzone${dragging ? ' is-dragging' : ''}`}
              onDragOver={(e) => {
                e.preventDefault();
                setDragging(true);
              }}
              onDragLeave={(e) => e.currentTarget === e.target && setDragging(false)}
              onDrop={onDrop}
            >
              <div className="dropzone-icon">
                <Icon name={state.loading ? 'refresh' : 'drop'} size={22} className={state.loading ? 'spin' : undefined} />
              </div>
              <div className="dropzone-title">{state.loading ? 'Analyse du fichier…' : 'Déposez un fichier audio ou vidéo ici'}</div>
              <div className="dropzone-hint">Un seul fichier à la fois. Il reste sur ce Mac.</div>
              <Button icon="filePlus" onClick={() => void open()} busy={state.loading}>
                Ouvrir un fichier
              </Button>
            </div>
          ) : (
            <div className="edit-file" onDragOver={(e) => e.preventDefault()} onDrop={onDrop}>
              <Icon name={isVideo ? 'video' : 'audio'} size={18} />
              <div className="edit-file-text">
                <div className="edit-file-name" title={item.path}>{item.name}</div>
                <div className="cell-muted">
                  {[
                    item.ext.toUpperCase(),
                    isVideo ? resolutionLabel(p?.displayWidth, p?.displayHeight) : p?.audioCodecs[0]?.replace('pcm_', 'PCM ').toUpperCase(),
                    formatDuration(duration),
                    formatBytes(item.size),
                  ]
                    .filter(Boolean)
                    .join(', ')}
                </div>
              </div>
              <Button size="sm" onClick={() => void open()} busy={state.loading}>
                Ouvrir un autre fichier
              </Button>
            </div>
          )}
        </div>
      </section>

      {item && item.status === 'ready' && duration > 0 ? (
        <>
          <section className="step" aria-labelledby="edit-s2">
            <div className="step-num" aria-hidden="true">2</div>
            <div className="step-body">
              <h2 id="edit-s2">Extrait</h2>

              {isVideo ? (
                <div className="preview">
                  {playable ? (
                    <div className="preview-box" style={{ aspectRatio: `${p?.displayWidth ?? 16} / ${p?.displayHeight ?? 9}` }}>
                      <video
                        ref={mediaRef}
                        src={api.mediaUrl(item.id)}
                        controls
                        preload="metadata"
                        onError={() => setPlayable(false)}
                        onTimeUpdate={(e) => {
                          const t = e.currentTarget.currentTime;
                          setCurrent(t);
                          if (stopAt.current !== null && t >= stopAt.current) {
                            e.currentTarget.pause();
                            stopAt.current = null;
                          }
                        }}
                      />
                      <FrameOverlay srcW={p?.displayWidth ?? 16} srcH={p?.displayHeight ?? 9} format={edit.format} frame={edit.frame} />
                    </div>
                  ) : (
                    <div className="preview-frames">
                      <figure>
                        {frames.start ? <img src={frames.start} alt="Image au début de l’extrait" /> : <div className="frame-wait"><span className="spinner" /></div>}
                        <figcaption>Début, {formatTimecode(edit.start)}</figcaption>
                      </figure>
                      <figure>
                        {frames.end ? <img src={frames.end} alt="Image à la fin de l’extrait" /> : <div className="frame-wait"><span className="spinner" /></div>}
                        <figcaption>Fin, {formatTimecode(edit.end)}</figcaption>
                      </figure>
                      <p className="fine-print">Ce format ne peut pas être lu dans l’aperçu : les images de début et de fin sont extraites avec FFmpeg.</p>
                    </div>
                  )}
                </div>
              ) : playable ? (
                <audio
                  ref={mediaRef}
                  className="preview-audio"
                  src={api.mediaUrl(item.id)}
                  controls
                  preload="metadata"
                  onError={() => setPlayable(false)}
                  onTimeUpdate={(e) => {
                    const t = e.currentTarget.currentTime;
                    setCurrent(t);
                    if (stopAt.current !== null && t >= stopAt.current) {
                      e.currentTarget.pause();
                      stopAt.current = null;
                    }
                  }}
                />
              ) : (
                <p className="fine-print">Ce format ne peut pas être écouté dans l’aperçu ; la découpe fonctionne quand même.</p>
              )}

              <Timeline
                duration={duration}
                start={edit.start}
                end={edit.end}
                current={current}
                waveform={waveform}
                tall={!isVideo}
                onChange={(s, e) => set({ start: s, end: e })}
                onSeek={seek}
              />

              <div className="trim-controls">
                <TimeField label="Début" value={edit.start} onCommit={(v) => set({ start: clamp(v, 0, Math.max(0, edit.end - 0.1)) })} />
                <TimeField label="Fin" value={edit.end} onCommit={(v) => set({ end: clamp(v, edit.start + 0.1, duration) })} />
                <div className="trim-len">
                  <span>Durée</span>
                  <strong>{formatDuration(edit.end - edit.start)}</strong>
                </div>
                <div className="trim-buttons">
                  <Button size="sm" onClick={() => set({ start: clamp(current, 0, edit.end - 0.1) })} disabled={!playable}>
                    Début ici
                  </Button>
                  <Button size="sm" onClick={() => set({ end: clamp(current, edit.start + 0.1, duration) })} disabled={!playable}>
                    Fin ici
                  </Button>
                  <Button size="sm" icon="play" onClick={playSelection} disabled={!playable}>
                    {isVideo ? 'Lire la sélection' : 'Écouter la sélection'}
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => set({ start: 0, end: duration })} disabled={!isTrimmed(edit, duration)}>
                    Tout le fichier
                  </Button>
                </div>
              </div>
            </div>
          </section>

          <section className="step" aria-labelledby="edit-s3">
            <div className="step-num" aria-hidden="true">3</div>
            <div className="step-body">
              <h2 id="edit-s3">Format</h2>
              {isVideo ? (
                <>
                  <div className="format-grid edit-formats" role="radiogroup" aria-label="Format de sortie">
                    {EDIT_FORMATS.map((f) => (
                      <button
                        key={f.id}
                        type="button"
                        role="radio"
                        aria-checked={edit.format === f.id}
                        className={`format-card${edit.format === f.id ? ' is-selected' : ''}`}
                        onClick={() => set({ format: f.id })}
                      >
                        <span className="profile-radio" aria-hidden="true" />
                        <span className="format-title">{f.short}</span>
                        <InfoTip
                          label={`À propos : ${f.title}`}
                          text={
                            <>
                              <strong>{f.title}. </strong>
                              {f.hint}
                            </>
                          }
                        />
                      </button>
                    ))}
                  </div>
                  {edit.format === 'same' ? (
                    <div className="field">
                      <div className="field-label">Découpe</div>
                      <Segmented<'precise' | 'fast'>
                        label="Découpe"
                        value={edit.precise ? 'precise' : 'fast'}
                        onChange={(v) => set({ precise: v === 'precise' })}
                        options={[
                          { value: 'precise', label: 'Précise (réencodage)' },
                          { value: 'fast', label: 'Rapide (sans réencodage)' },
                        ]}
                      />
                      <div className="field-hint">
                        {edit.precise
                          ? 'Coupe exactement aux temps choisis. La vidéo est réencodée en H.264 au débit de la source.'
                          : 'Quasi instantané et sans perte, mais le début peut être avancé jusqu’à l’image clé précédente.'}
                      </div>
                    </div>
                  ) : null}
                  {edit.format === 'vertical' || edit.format === 'square' || edit.format === 'landscape' ? (
                    <div className="field">
                      <div className="field-label">Adapter l’image</div>
                      <Segmented<FrameMode>
                        label="Adapter l’image"
                        value={edit.frame}
                        onChange={(v) => set({ frame: v })}
                        options={FRAME_MODES.map((m) => ({ value: m.id, label: m.title, hint: m.hint }))}
                      />
                      <div className="field-hint">
                        {FRAME_MODES.find((m) => m.id === edit.frame)?.hint}
                        {edit.frame === 'crop' && playable ? ' Le cadre clair sur l’aperçu montre la zone conservée.' : ''}
                      </div>
                    </div>
                  ) : null}
                  {edit.format === 'gif' ? (
                    <div className="gif-options">
                      <div className="field">
                        <div className="field-label">Largeur</div>
                        <Segmented<number> label="Largeur du GIF" value={edit.gifWidth} onChange={(v) => set({ gifWidth: v })} options={GIF_WIDTHS.map((w) => ({ value: w, label: `${w} px` }))} />
                      </div>
                      <div className="field">
                        <div className="field-label">Fluidité</div>
                        <Segmented<number> label="Images par seconde" value={edit.gifFps} onChange={(v) => set({ gifFps: v })} options={GIF_FPS.map((f) => ({ value: f, label: `${f} i/s` }))} />
                      </div>
                      {edit.end - edit.start > 15 ? (
                        <Notice tone="warn">Un GIF de plus de 15 secondes devient vite très lourd : raccourcissez l’extrait si possible.</Notice>
                      ) : null}
                    </div>
                  ) : null}
                </>
              ) : (
                <p className="fine-print edit-audio-note">
                  Le fichier garde son format. WAV, AIFF et FLAC sont découpés à l’échantillon près, sans perte ; MP3, AAC et Opus sont découpés sans
                  réencodage, donc sans perte de qualité. Pour changer de format, utilisez ensuite l’onglet Audio.
                </p>
              )}
            </div>
          </section>
        </>
      ) : null}

      {item ? (
        <footer className="action-bar">
          <div className="action-summary">
            {problem ? (
              <span className="cell-muted">{problem}</span>
            ) : (
              <>
                <strong>{outName}</strong>
                <span>créé à côté de l’original</span>
              </>
            )}
          </div>
          <Button variant="primary" size="lg" icon="play" onClick={() => void start()} disabled={!!problem || !!fatal} busy={starting}>
            {actionLabel}
          </Button>
        </footer>
      ) : null}
    </div>
  );
}
