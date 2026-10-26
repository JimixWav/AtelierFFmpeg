import {
  AAC_BITRATES, AUDIO_FORMATS, defaultVideoSettings, formatMbps, MP3_QUALITIES, OPUS_BITRATES, suggestYoutubeBitrate,
  uselessAudioReason, VIDEO_PROFILES, videoExtension, videoSuffix, WAV_PRESETS,
} from '../../shared/profiles';
import type {
  AudioFormat, AudioSettings, EncoderPreference, Environment, MediaItem, Mp3Quality, VideoProfileId, VideoSettings, WavPreset,
} from '../../shared/types';
import { useState, type ReactNode } from 'react';
import { VideoAdviceDialog } from './VideoAdvice';
import type { WorkspaceState } from '../lib/state';
import { Icon } from './Icon';
import { trackOptions } from '../../shared/tracks';
import { Button, Checkbox, Collapsible, Field, InfoTip, Segmented } from './ui';

/* ------------------------------------------------------------------ */
/* Audio                                                               */
/* ------------------------------------------------------------------ */

function audioEncoderIssue(env: Environment | null, f: AudioFormat): string | null {
  if (!env?.ok) return null;
  if (f === 'mp3' && !env.encoders.libmp3lame?.usable) return 'libmp3lame absent de votre FFmpeg';
  if (f === 'opus' && !env.encoders.libopus?.usable) return 'libopus absent de votre FFmpeg';
  return null;
}

export function AudioProfilePanel({ ws, update, env }: { ws: WorkspaceState; update: (p: Partial<WorkspaceState>) => void; env: Environment | null }) {
  const a = ws.audio;
  const ready = ws.items.filter((i) => i.status === 'ready');
  /** Raison commune si ces réglages sont inutiles pour TOUS les fichiers prêts, sinon null. */
  const allUseless = (settings: AudioSettings): string | null => {
    if (!ready.length) return null;
    const reasons = ready.map((i) => uselessAudioReason(i, settings));
    return reasons.every(Boolean) ? (reasons[0] as string) : null;
  };
  /** Premier préréglage WAV utile pour la sélection (évite « Comme la source » pour des WAV). */
  const bestWavPreset = (cur: AudioSettings): WavPreset => {
    const order: WavPreset[] = [cur.wavPreset, 'source', 'cd', 'studio'];
    return order.find((p) => !allUseless({ ...cur, format: 'wav', wavPreset: p })) ?? cur.wavPreset;
  };
  const currentUseless = allUseless(a);
  const set = (patch: Partial<typeof a>) => update({ audio: { ...a, ...patch } });
  const q = MP3_QUALITIES.find((x) => x.value === a.quality) ?? MP3_QUALITIES[1];
  const issue = audioEncoderIssue(env, a.format);
  const aacApple = !!env?.encoders.aac_at?.usable;

  return (
    <div className="profile-stack">
      <div className="format-grid" role="radiogroup" aria-label="Format de sortie">
        {AUDIO_FORMATS.map((f) => {
          const active = f.id === a.format;
          const unavailable = audioEncoderIssue(env, f.id);
          const pointless = allUseless({ ...a, format: f.id, wavPreset: f.id === 'wav' ? bestWavPreset(a) : a.wavPreset });
          return (
            <button
              key={f.id}
              type="button"
              role="radio"
              aria-checked={active}
              disabled={!!pointless && !active}
              title={pointless ?? undefined}
              className={`format-card${active ? ' is-selected' : ''}${pointless ? ' is-pointless' : ''}`}
              onClick={() =>
                set({
                  format: f.id,
                  bitrateKbps: f.id === 'opus' ? 128 : f.id === 'aac' ? 256 : a.bitrateKbps,
                  wavPreset: f.id === 'wav' ? bestWavPreset(a) : a.wavPreset,
                })
              }
            >
              <span className="profile-radio" aria-hidden="true" />
              <span className="format-title">{f.title}</span>
              {unavailable ? <Icon name="alert" size={12} className="format-alert" /> : null}
              <InfoTip
                label={`À propos du format ${f.title}`}
                text={
                  <>
                    <strong>{f.lossless ? 'Sans perte. ' : 'Compressé. '}</strong>
                    {f.goal}
                    {unavailable ? <span className="infotip-warn"> {unavailable}.</span> : null}
                    {pointless ? <span className="infotip-warn"> {pointless}</span> : null}
                  </>
                }
              />
            </button>
          );
        })}
      </div>

      {currentUseless ? (
        <div className="profile-status tone-warn">
          <Icon name="alert" size={13} /> {currentUseless} Choisissez un autre format.
        </div>
      ) : null}

      {issue ? (
        <div className="profile-status tone-danger">
          <Icon name="alert" size={13} /> {issue} : installez la version Homebrew (brew install ffmpeg).
        </div>
      ) : null}

      {a.format === 'mp3' ? (
        <Field label="Qualité MP3" hint={<>{q.hint} Plus le chiffre est bas, plus la qualité est élevée et le fichier lourd.</>}>
          <Segmented<Mp3Quality>
            label="Qualité MP3"
            value={a.quality}
            onChange={(v) => set({ quality: v })}
            options={MP3_QUALITIES.map((x) => ({ value: x.value, label: `${x.label} (${x.value})`, hint: `${x.kbps}. ${x.hint}` }))}
          />
        </Field>
      ) : null}

      {a.format === 'aac' ? (
        <Field
          label="Débit AAC"
          hint={`256 kbit/s est la qualité d’Apple Musique. Encodeur : ${aacApple ? 'AudioToolbox d’Apple (aac_at), le meilleur disponible' : 'AAC de FFmpeg'}.`}
        >
          <Segmented<number>
            label="Débit AAC"
            value={AAC_BITRATES.includes(a.bitrateKbps) ? a.bitrateKbps : 256}
            onChange={(v) => set({ bitrateKbps: v })}
            options={AAC_BITRATES.map((k) => ({ value: k, label: `${k} kbit/s` }))}
          />
        </Field>
      ) : null}

      {a.format === 'opus' ? (
        <Field label="Débit Opus" hint="96 kbit/s suffit pour la voix, 128 à 160 kbit/s pour la musique.">
          <Segmented<number>
            label="Débit Opus"
            value={OPUS_BITRATES.includes(a.bitrateKbps) ? a.bitrateKbps : 128}
            onChange={(v) => set({ bitrateKbps: v })}
            options={OPUS_BITRATES.map((k) => ({ value: k, label: `${k} kbit/s` }))}
          />
        </Field>
      ) : null}

      {a.format === 'wav' ? (
        <Field label="Résolution et fréquence" hint={WAV_PRESETS.find((w) => w.value === a.wavPreset)?.hint}>
          <Segmented<WavPreset>
            label="Résolution et fréquence"
            value={a.wavPreset}
            onChange={(v) => set({ wavPreset: v })}
            options={WAV_PRESETS.map((w) => {
              const why = allUseless({ ...a, format: 'wav', wavPreset: w.value });
              return { value: w.value, label: w.label, disabled: !!why && w.value !== a.wavPreset, hint: why ?? w.hint };
            })}
          />
        </Field>
      ) : null}

      {a.format === 'flac' || a.format === 'alac' ? (
        <p className="fine-print">
          Compression sans perte : le son est identique bit pour bit à la source. Une source 24 bits reste en 24 bits, une source 16 bits reste en 16 bits.
        </p>
      ) : null}
      {a.format === 'wav' || a.format === 'flac' || a.format === 'alac' ? (
        <p className="fine-print">Convertir un MP3 ou un AAC vers un format sans perte ne récupère pas la qualité perdue : utilisez une source WAV, AIFF ou FLAC.</p>
      ) : null}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Vidéo                                                               */
/* ------------------------------------------------------------------ */

function encoderLine(env: Environment | null, s: VideoSettings): { tone: 'ok' | 'warn' | 'danger'; text: string } | null {
  if (!env?.ok) return null;
  const codec = s.profile === 'youtube' ? 'h264' : s.profile === 'archive' ? 'hevc' : s.codec;
  const hw = codec === 'h264' ? 'h264_videotoolbox' : 'hevc_videotoolbox';
  const sw = codec === 'h264' ? 'libx264' : 'libx265';
  const hwOk = env.encoders[hw]?.usable;
  const swOk = env.encoders[sw]?.usable;
  if (s.encoder === 'hardware') return hwOk ? { tone: 'ok', text: `Accélération matérielle VideoToolbox (${hw})` } : { tone: 'danger', text: `${hw} indisponible sur ce Mac : choisissez « Automatique »` };
  if (s.encoder === 'software') return swOk ? { tone: 'ok', text: `Encodeur logiciel ${sw}` } : { tone: 'danger', text: `${sw} absent de votre FFmpeg` };
  if (hwOk) return { tone: 'ok', text: `Accélération matérielle VideoToolbox (${hw})` };
  if (swOk) return { tone: 'warn', text: `VideoToolbox indisponible : repli sur ${sw}, plus lent` };
  return { tone: 'danger', text: `Aucun encodeur ${codec === 'h264' ? 'H.264' : 'HEVC'} disponible` };
}

function maxResolution(items: MediaItem[]): { w: number; h: number; fps: number | null } | null {
  let best: { w: number; h: number; fps: number | null } | null = null;
  for (const it of items) {
    const w = it.probe?.displayWidth;
    const h = it.probe?.displayHeight;
    if (!w || !h) continue;
    const fps = it.probe?.fps ?? null;
    const better = !best || Math.min(w, h) > Math.min(best.w, best.h) || (Math.min(w, h) === Math.min(best.w, best.h) && (fps ?? 0) > (best.fps ?? 0));
    if (better) best = { w, h, fps };
  }
  return best;
}

const AUDIO_KBPS = [96, 128, 160, 192, 256, 320, 384, 512];

export function VideoProfilePanel({ ws, update, env, children }: { ws: WorkspaceState; update: (p: Partial<WorkspaceState>) => void; env: Environment | null; children?: ReactNode }) {
  const s = ws.video;
  const set = (patch: Partial<VideoSettings>) => update({ video: { ...s, ...patch } });
  const choose = (id: VideoProfileId) => {
    if (id === s.profile) return;
    // Le choix des pistes est conservé d'un mode à l'autre (l'incrustation exige un réencodage).
    update({
      video: {
        ...defaultVideoSettings(id),
        encoder: s.encoder,
        audioSelection: s.audioSelection,
        subtitleSelection: s.subtitleSelection,
        burnSubtitles: id === 'remux' ? false : s.burnSubtitles,
      },
    });
  };
  const status = s.profile === 'remux' ? null : encoderLine(env, s);
  const best = maxResolution(ws.items.filter((i) => i.status === 'ready'));
  const suggestion = s.profile === 'youtube' && best ? suggestYoutubeBitrate(best.w, best.h, best.fps) : null;
  const isCustom = s.profile === 'custom';
  const [advice, setAdvice] = useState(false);
  const applyAdvice = (mbps: number) => {
    const base = defaultVideoSettings('custom');
    update({
      video: {
        ...base,
        codec: 'hevc',
        videoBitrateMbps: mbps,
        encoder: s.encoder,
        container: s.profile === 'custom' || s.profile === 'remux' ? s.container : base.container,
        audioSelection: s.audioSelection,
        subtitleSelection: s.subtitleSelection,
        burnSubtitles: s.profile === 'remux' ? false : s.burnSubtitles,
      },
    });
    setAdvice(false);
  };

  return (
    <div className="profile-stack">
      <div className="profile-toolbar">
        <Button size="sm" variant="ghost" icon="info" onClick={() => setAdvice(true)}>
          Conseils de réglage
        </Button>
      </div>
      {advice ? <VideoAdviceDialog ws={ws} onApply={applyAdvice} onClose={() => setAdvice(false)} /> : null}
      <div className="profile-grid" role="radiogroup" aria-label="Mode de compression">
        {VIDEO_PROFILES.map((p) => {
          const active = p.id === s.profile;
          return (
            <button
              key={p.id}
              type="button"
              role="radio"
              aria-checked={active}
              className={`profile-card${active ? ' is-selected' : ''}`}
              onClick={() => choose(p.id)}
            >
              <div className="profile-card-head">
                <span className="profile-radio" aria-hidden="true" />
                <div>
                  <div className="profile-title">{p.title}</div>
                  <div className="profile-goal">{p.goal}</div>
                </div>
              </div>
              <div className="profile-specs">
                {(active && !isCustom
                  ? p.specs.map((x) => (x.endsWith('Mbit/s') ? formatMbps(s.videoBitrateMbps) : x))
                  : p.specs
                ).map((x) => (
                  <span key={x}>{x}</span>
                ))}
              </div>
              <div className="profile-suffix">
                Sortie : nom{videoSuffix(active ? s : defaultVideoSettings(p.id))}.{videoExtension(active ? s : defaultVideoSettings(p.id))}
              </div>
            </button>
          );
        })}
      </div>

      {status ? (
        <div className={`profile-status tone-${status.tone}`}>
          <Icon name={status.tone === 'ok' ? 'check' : 'alert'} size={13} />
          {status.text}
        </div>
      ) : null}

      {s.profile === 'archive' ? (
        <p className="fine-print">
          Le gain de place dépend de la durée, du contenu et de la source : aucun pourcentage n’est garanti. Les sources plus petites que 1080p gardent leur taille.
        </p>
      ) : null}
      {s.profile === 'youtube' ? (
        <p className="fine-print">La résolution d’origine est toujours conservée. Le débit est une valeur cible, pas une garantie de qualité ou de taille.</p>
      ) : null}

      <TracksPanel ws={ws} set={set} />

      {children}

      {s.profile === 'remux' ? (
        <p className="fine-print">
          Ni l’image ni le son ne sont réencodés : la qualité est identique à l’original et la conversion ne prend que quelques minutes, même pour un film. Le gain vient des pistes retirées.
        </p>
      ) : null}

      {s.profile === 'remux' ? (
        <Collapsible title="Réglages avancés" aside={<span className="cell-muted">{s.container === 'mkv' ? 'MKV' : 'MP4'}</span>}>
          <div className="advanced-grid">
            <Field
              label="Conteneur"
              hint={
                s.container === 'mkv'
                  ? 'MKV garde toutes les pistes telles quelles, y compris les sous-titres image et le son DTS ou TrueHD.'
                  : 'MP4 se lit partout (iPhone, Apple TV, QuickTime). Les pistes DTS, TrueHD, FLAC ou Opus sont converties en AAC, et les sous-titres image ne peuvent pas être gardés.'
              }
            >
              <Segmented
                label="Conteneur"
                value={s.container === 'mkv' ? 'mkv' : 'mp4'}
                onChange={(v) => set({ container: v })}
                options={[
                  { value: 'mp4', label: 'MP4' },
                  { value: 'mkv', label: 'MKV' },
                ]}
              />
            </Field>
          </div>
        </Collapsible>
      ) : (
      <Collapsible title="Réglages avancés" defaultOpen={isCustom} aside={<span className="cell-muted">{formatMbps(s.videoBitrateMbps)}, AAC {s.audioBitrateKbps} kbit/s</span>}>
        <div className="advanced-grid">
          {isCustom ? (
            <>
              <Field label="Codec vidéo">
                <Segmented
                  label="Codec vidéo"
                  value={s.codec}
                  onChange={(v) => set({ codec: v })}
                  options={[
                    { value: 'h264', label: 'H.264', hint: 'Compatibilité maximale' },
                    { value: 'hevc', label: 'HEVC (H.265)', hint: 'Plus compact à qualité égale' },
                  ]}
                />
              </Field>
              <Field label="Résolution maximale" hint="Une source plus petite n’est jamais agrandie.">
                <Segmented
                  label="Résolution maximale"
                  value={s.resolution}
                  onChange={(v) => set({ resolution: v })}
                  options={[
                    { value: 'source', label: 'Source' },
                    { value: '1080p', label: '1080p' },
                    { value: '720p', label: '720p' },
                  ]}
                />
              </Field>
              <Field label="Conteneur" hint={s.container === 'mkv' ? 'MKV conserve tous les sous-titres, y compris au format image.' : 'MP4 et MOV ne gardent que les sous-titres texte.'}>
                <Segmented
                  label="Conteneur"
                  value={s.container}
                  onChange={(v) => set({ container: v })}
                  options={[
                    { value: 'mp4', label: 'MP4' },
                    { value: 'mov', label: 'MOV' },
                    { value: 'mkv', label: 'MKV' },
                  ]}
                />
              </Field>
            </>
          ) : null}

          <Field
            label="Débit vidéo"
            hint={
              suggestion ? (
                suggestion.mbps !== s.videoBitrateMbps ? (
                  <span className="suggestion">
                    Recommandation YouTube pour une source {suggestion.label} : {formatMbps(suggestion.mbps)}.
                    <Button size="sm" variant="ghost" onClick={() => set({ videoBitrateMbps: suggestion.mbps })}>
                      Utiliser {formatMbps(suggestion.mbps)}
                    </Button>
                  </span>
                ) : (
                  <>Correspond à la recommandation YouTube pour une source {suggestion.label}.</>
                )
              ) : s.profile === 'youtube' ? (
                <>Recommandations YouTube : 8 Mbit/s en 1080p, 16 en 1440p, 35 à 45 en 4K (davantage à 50-60 i/s).</>
              ) : undefined
            }
          >
            <div className="number-input">
              <input
                type="number"
                min={0.5}
                max={400}
                step={0.5}
                value={s.videoBitrateMbps}
                aria-label="Débit vidéo en mégabits par seconde"
                onChange={(e) => {
                  const v = Number(e.target.value);
                  if (Number.isFinite(v) && v > 0) set({ videoBitrateMbps: Math.min(400, v) });
                }}
              />
              <span>Mbit/s</span>
            </div>
          </Field>

          <Field
            label="Audio AAC"
            hint={
              s.profile === 'youtube'
                ? 'YouTube recompresse toujours le son : lui envoyer 384 kbit/s (sa recommandation) limite la perte due à cette double compression. Coût : environ 1,4 Mo de plus par minute qu’à 192 kbit/s.'
                : 'Ajouté uniquement si la source contient une piste audio.'
            }
          >
            <select value={s.audioBitrateKbps} onChange={(e) => set({ audioBitrateKbps: Number(e.target.value) })} aria-label="Débit audio AAC">
              {[...new Set([...AUDIO_KBPS, s.audioBitrateKbps])].sort((a, b) => a - b).map((k) => (
                <option key={k} value={k}>
                  {k} kbit/s
                </option>
              ))}
            </select>
          </Field>

          <Field label="Encodeur" hint="Automatique : VideoToolbox (matériel) si disponible, sinon encodeur logiciel.">
            <Segmented<EncoderPreference>
              label="Encodeur"
              value={s.encoder}
              onChange={(v) => set({ encoder: v })}
              options={[
                { value: 'auto', label: 'Automatique' },
                { value: 'hardware', label: 'Matériel' },
                { value: 'software', label: 'Logiciel' },
              ]}
            />
          </Field>
        </div>
      </Collapsible>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Pistes audio et sous-titres (vidéos multipistes)                    */
/* ------------------------------------------------------------------ */

function TracksPanel({ ws, set }: { ws: WorkspaceState; set: (patch: Partial<VideoSettings>) => void }) {
  const s = ws.video;
  const opts = trackOptions(ws.items);
  if (!opts.multiAudio && !opts.hasSubtitles) return null;
  const readyCount = ws.items.filter((i) => i.status === 'ready').length;
  const fileHint = (n: number) => (readyCount > 1 && n < readyCount ? ` (${n} fichier${n > 1 ? 's' : ''} sur ${readyCount})` : '');

  const audioValue = s.audioSelection.mode === 'one' && s.audioSelection.key ? `one:${s.audioSelection.key}` : 'all';
  const subValue = s.subtitleSelection.mode === 'one' && s.subtitleSelection.key ? `one:${s.subtitleSelection.key}` : s.subtitleSelection.mode;
  const chosenSub = s.subtitleSelection.mode === 'one' ? opts.subtitles.find((o) => o.key === s.subtitleSelection.key) : undefined;
  const container = s.profile === 'custom' || s.profile === 'remux' ? s.container : 'mp4';
  const imageSubs = chosenSub?.detail?.includes('image');

  return (
    <div className="tracks">
      <div className="tracks-head">
        <span className="tracks-title">Pistes</span>
        <InfoTip text="Fichiers multipistes (MKV…) : gardez une seule langue audio et choisissez les sous-titres. En lot, la langue choisie est cherchée dans chaque fichier ; à défaut, la piste principale est utilisée." />
      </div>
      <div className="tracks-grid">
        {opts.audio.length > 1 || opts.multiAudio ? (
          <label className="tracks-field">
            <span>Audio</span>
            <select
              value={audioValue}
              onChange={(e) => {
                const v = e.target.value;
                set({ audioSelection: v === 'all' ? { mode: 'all' } : { mode: 'one', key: v.slice(4) } });
              }}
            >
              <option value="all">Toutes les pistes</option>
              {opts.audio.map((o) => (
                <option key={o.key} value={`one:${o.key}`}>
                  {o.label}
                  {o.detail ? ` – ${o.detail}` : ''}
                  {fileHint(o.files)}
                </option>
              ))}
            </select>
          </label>
        ) : null}
        {opts.hasSubtitles ? (
          <label className="tracks-field">
            <span>Sous-titres</span>
            <select
              value={subValue}
              onChange={(e) => {
                const v = e.target.value;
                set({
                  subtitleSelection: v === 'all' ? { mode: 'all' } : v === 'none' ? { mode: 'none' } : { mode: 'one', key: v.slice(4) },
                  burnSubtitles: v.startsWith('one:') ? s.burnSubtitles : false,
                });
              }}
            >
              <option value="all">Tous ceux compatibles</option>
              <option value="none">Aucun</option>
              {opts.subtitles.map((o) => (
                <option key={o.key} value={`one:${o.key}`}>
                  {o.label}
                  {o.detail ? ` – ${o.detail}` : ''}
                  {fileHint(o.files)}
                </option>
              ))}
            </select>
          </label>
        ) : null}
      </div>
      {s.profile === 'remux' && imageSubs && container !== 'mkv' ? (
        <p className="fine-print tone-warn-text">Ces sous-titres sont des images : le MP4 ne peut pas les garder. Choisissez MKV dans les réglages avancés.</p>
      ) : null}
      {s.subtitleSelection.mode === 'one' && s.profile !== 'remux' ? (
        <div className="tracks-burn">
          <Checkbox
            checked={s.burnSubtitles}
            onChange={(v) => set({ burnSubtitles: v })}
            label="Incruster dans l’image"
            description={
              s.burnSubtitles
                ? 'Toujours visibles, sur tous les appareils ; ils ne pourront plus être désactivés.'
                : imageSubs && container !== 'mkv'
                  ? 'Ces sous-titres sont des images : le MP4 ne peut pas les contenir. Cochez cette case pour les garder.'
                  : 'Sinon, ils sont ajoutés comme piste à activer dans le lecteur (VLC, QuickTime, IINA…).'
            }
          />
        </div>
      ) : null}
    </div>
  );
}
