import { audioFormatMeta, defaultNameSuffix, namingProblem, outputFileName, uselessAudioReason, videoExtension } from '../../shared/profiles';
import { uselessVideoReason } from '../../shared/estimate';
import type { CollisionPolicy } from '../../shared/types';
import { prettyPath } from '../lib/format';
import type { WorkspaceState } from '../lib/state';
import { Icon } from './Icon';
import { Button, Checkbox, Field, Notice, Segmented } from './ui';

interface Props {
  ws: WorkspaceState;
  update: (p: Partial<WorkspaceState>) => void;
  onPickFolder: () => void;
  locked: boolean;
}

export function DestinationPanel({ ws, update, onPickFolder, locked }: Props) {
  const useful = ws.items.filter((i) => i.status === 'ready' && !(ws.kind === 'audio' ? uselessAudioReason(i, ws.audio) : uselessVideoReason(i, ws.video)));
  const sample = useful[0] ?? ws.items.find((i) => i.status === 'ready') ?? ws.items[0];
  const single = useful.length === 1;
  const srcName = sample?.name ?? (ws.kind === 'audio' ? 'piste.wav' : 'clip.mov');
  const base = srcName.replace(/\.[^.]+$/, '');
  const ext = ws.kind === 'audio' ? audioFormatMeta(ws.audio.format).ext : videoExtension(ws.video);
  const n = ws.naming;
  const outName = outputFileName(srcName, ws.kind, ws.audio, ws.video, n.custom ? { name: n.name.trim(), prefix: n.prefix, suffix: n.suffix } : undefined, single);
  const setNaming = (patch: Partial<typeof n>) => update({ naming: { ...n, ...patch } });
  const toggleCustom = (custom: boolean) => {
    if (!custom) return setNaming({ custom });
    // Pré-remplit avec le nom par défaut : il ne reste qu'à le retoucher.
    const suffix = defaultNameSuffix(srcName, ws.kind, ws.audio, ws.video);
    setNaming({ custom, name: n.name || `${base}${suffix}`, suffix: n.suffix || n.prefix ? n.suffix : suffix });
  };
  const nameIssue = n.custom ? (single ? namingProblem(n.name.trim(), true) : namingProblem(n.prefix) ?? namingProblem(n.suffix)) : null;
  const folderMode = ws.destination.mode === 'folder';

  return (
    <div className="destination">
      <div className="dest-options" role="radiogroup" aria-label="Destination">
        <button
          type="button"
          role="radio"
          aria-checked={!folderMode}
          className={`dest-option${!folderMode ? ' is-selected' : ''}`}
          onClick={() => update({ destination: { mode: 'beside' } })}
          disabled={locked}
        >
          <span className="profile-radio" aria-hidden="true" />
          <span>
            <span className="dest-title">Même emplacement</span>
            <span className="dest-desc">Chaque fichier converti est créé dans le même dossier que son original.</span>
          </span>
        </button>
        <button
          type="button"
          role="radio"
          aria-checked={folderMode}
          className={`dest-option${folderMode ? ' is-selected' : ''}`}
          onClick={() => (ws.destination.folder ? update({ destination: { mode: 'folder', folder: ws.destination.folder } }) : onPickFolder())}
          disabled={locked}
        >
          <span className="profile-radio" aria-hidden="true" />
          <span>
            <span className="dest-title">Dossier de sortie différent</span>
            <span className="dest-desc">Tout est rangé dans le dossier choisi, en reproduisant les sous-dossiers.</span>
          </span>
        </button>
      </div>

      {folderMode ? (
        <div className="dest-folder">
          <Icon name="folder" size={15} />
          <span className="dest-path" title={ws.destination.folder}>{ws.destination.folder ? prettyPath(ws.destination.folder) : 'Aucun dossier choisi'}</span>
          <Button size="sm" onClick={onPickFolder} disabled={locked}>
            Changer…
          </Button>
        </div>
      ) : null}

      <div className="naming">
        <span className="naming-src">{srcName}</span>
        <Icon name="chevronRight" size={14} />
        <span className="naming-out">{outName}</span>
      </div>

      <div className="naming-box">
        <Checkbox
          checked={n.custom}
          onChange={toggleCustom}
          label="Choisir le nom de sortie"
          description={
            n.custom
              ? single
                ? 'Nom du fichier converti. L’extension est ajoutée automatiquement.'
                : 'Plusieurs fichiers : chacun garde son nom d’origine, avec le texte choisi avant et après.'
              : 'Par défaut : le nom d’origine, suivi du réglage utilisé.'
          }
        />
        {n.custom && single ? (
          <div className="name-input">
            <input
              type="text"
              value={n.name}
              spellCheck={false}
              aria-label="Nom du fichier de sortie"
              aria-invalid={!!nameIssue}
              onChange={(e) => setNaming({ name: e.target.value })}
            />
            <span className="name-ext">.{ext}</span>
          </div>
        ) : null}
        {n.custom && !single ? (
          <div className="name-affix">
            <label>
              <span>Avant le nom</span>
              <input type="text" value={n.prefix} placeholder="rien" spellCheck={false} onChange={(e) => setNaming({ prefix: e.target.value })} />
            </label>
            <span className="name-affix-base" title="Nom d’origine de chaque fichier">nom d’origine</span>
            <label>
              <span>Après le nom</span>
              <input type="text" value={n.suffix} placeholder="rien" spellCheck={false} onChange={(e) => setNaming({ suffix: e.target.value })} />
            </label>
            <span className="name-ext">.{ext}</span>
          </div>
        ) : null}
        {nameIssue ? <p className="fine-print tone-warn-text">{nameIssue}</p> : null}
      </div>

      <Field label="Si le fichier de sortie existe déjà">
        <Segmented<CollisionPolicy>
          label="Si le fichier de sortie existe déjà"
          value={ws.collision}
          onChange={(v) => update({ collision: v })}
          options={[
            { value: 'skip', label: 'Ignorer', hint: 'Le fichier existant est conservé et la source est ignorée (« Déjà présent »).' },
            { value: 'replace', label: 'Remplacer', hint: 'Le fichier existant est remplacé une fois la nouvelle conversion réussie.' },
            { value: 'unique', label: 'Créer un nom unique', hint: 'Ajoute un numéro : piste (2).mp3' },
          ]}
        />
      </Field>
      {ws.collision === 'replace' ? (
        <p className="fine-print tone-warn-text">Les fichiers de sortie existants seront remplacés. Les sources ne sont jamais concernées.</p>
      ) : null}

      <div className={`keep-box${ws.keepOriginals ? '' : ' is-deleting'}`}>
        <Checkbox
          checked={ws.keepOriginals}
          onChange={(v) => update({ keepOriginals: v })}
          label="Conserver les fichiers originaux"
          description={
            ws.keepOriginals
              ? 'Recommandé. Les sources ne sont ni modifiées, ni déplacées, ni supprimées.'
              : 'Décoché : chaque original est placé dans la Corbeille après une conversion réussie et vérifiée.'
          }
        />
        {!ws.keepOriginals ? (
          <Notice tone="warn" title="Les originaux iront dans la Corbeille">
            Uniquement après une conversion terminée et relue avec succès (sortie lisible, durée identique). Un fichier ignoré, en échec ou annulé
            n’est jamais touché. Vous pouvez les récupérer depuis la Corbeille du Finder tant qu’elle n’est pas vidée.
          </Notice>
        ) : null}
      </div>
    </div>
  );
}
