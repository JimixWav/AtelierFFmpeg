# Atelier FFmpeg

Application macOS locale pour convertir et compresser l’audio et la vidéo avec **FFmpeg installé sur votre Mac**.
Aucun média ne quitte la machine : FFmpeg est lancé comme processus local par l’application.

- **Audio** : WAV → MP3 (`libmp3lame`, VBR `-q:a 2`) par défaut, et aussi vers AAC (M4A), FLAC, ALAC, WAV (CD ou studio) et Opus. Sources WAV, AIFF, FLAC, M4A, MP3, OGG/Opus, ou le son d’une vidéo. Fichier par fichier ou dossiers entiers, sous-dossiers compris.
- **Estimation de taille** avant conversion : par fichier, pour toute la sélection (avec le pourcentage gagné), et alerte si une sortie risque d’être plus lourde que l’original.
- **Vidéo** : quatre modes : *YouTube, résolution conservée* (H.264), *Archivage, 1080p compact* (HEVC), *Personnalisé*, et *Pistes seulement, sans réencodage* (copie sans perte en retirant les pistes non voulues). Pour les fichiers multipistes (MKV…), choix d’une langue audio et des sous-titres : aucun, conservés, ou incrustés dans l’image. Les vidéos déjà plus légères que le réglage sont ignorées au lieu de grossir.
- **Tâches** : file d’attente, audio et vidéo en même temps, plusieurs fichiers audio convertis en parallèle, progression en direct, pause, annulation propre, bilan, accès aux fichiers dans le Finder et son de fin de tâche (désactivable).
- **Nom de sortie** au choix, et une fenêtre de **conseils de réglage** vidéo (débit conseillé pour chaque fichier).
- **Historique** local et page **Diagnostic** (version de FFmpeg, encodeurs disponibles, test réel de VideoToolbox, recherche de mise à jour via Homebrew).

---

## 0. Installer l’application (sans Node ni npm)

Pour les Mac **Apple Silicon** (M1, M2, M3, M4…), macOS 12 ou plus récent.

1. **Installez FFmpeg**, qui fait les conversions. Dans le Terminal, installez d’abord [Homebrew](https://brew.sh) s’il n’est pas déjà là, puis :

   ```bash
   brew install ffmpeg
   ```

   Sans FFmpeg, l’app s’ouvre quand même : la page Diagnostic indique les étapes à suivre.
2. **Téléchargez** `AtelierFFmpeg-<version>-mac-arm64.zip` dans la page [Releases](https://github.com/JimixWav/AtelierFFmpeg/releases) et décompressez-le.
3. **Glissez `Atelier FFmpeg.app`** dans le dossier *Applications*.
4. **Premier lancement** : l’app n’est pas signée avec un certificat Apple Developer, macOS la bloque donc au premier lancement (« impossible de vérifier le développeur » ou « endommagée »). Ouvrez le Terminal et collez :

   ```bash
   xattr -cr "/Applications/Atelier FFmpeg.app" && codesign --force --deep --sign - "/Applications/Atelier FFmpeg.app"
   ```

   La première commande retire la mise en quarantaine du téléchargement, la seconde signe l’app localement (signature « ad hoc », propre à votre Mac). Ensuite, un double-clic suffit. Le script `Si l'app ne s'ouvre pas.command`, fourni dans le zip, fait la même chose si l’app est posée à côté de lui.

L’app embarque Electron 37.2.0 (version officielle, empreinte SHA-256 vérifiée) et le code compilé de `out/`. Elle ne se connecte pas à Internet, sauf si vous lancez vous-même la recherche de mise à jour de FFmpeg (via Homebrew) ou ouvrez la page GitHub de l’auteur.

Pour reconstruire l’app après une modification du code, suivez les sections 2 à 4.

---

## 1. Prérequis

| Outil | Version | Installation |
| --- | --- | --- |
| macOS | 12 ou plus récent (Apple Silicon recommandé) | — |
| Node.js | 20 ou plus récent | `brew install node` |
| FFmpeg + ffprobe | 6 ou plus récent conseillé | `brew install ffmpeg` |

Homebrew s’installe depuis [brew.sh](https://brew.sh). La version Homebrew de FFmpeg inclut `ffprobe`, `libmp3lame`, `libx264`, `libx265` et les encodeurs matériels VideoToolbox.

Vérifier FFmpeg dans le Terminal :

```bash
ffmpeg -version
ffmpeg -hide_banner -encoders | grep -E "videotoolbox|libmp3lame|libx26"
```

L’application ne tente jamais d’installer FFmpeg elle-même. Elle cherche `ffmpeg` dans `/opt/homebrew/bin`, `/usr/local/bin`, `/opt/local/bin`, puis dans le `PATH`. Une application lancée depuis le Finder n’hérite pas du `PATH` du Terminal, d’où cette recherche explicite. Un autre exécutable peut être choisi dans **Diagnostic → Choisir un exécutable ffmpeg…**.

## 2. Installation

```bash
git clone https://github.com/JimixWav/AtelierFFmpeg.git
cd AtelierFFmpeg
npm install
```

## 3. Lancer en développement

```bash
npm run dev
```

Les sources sont recompilées en continu. L’interface se recharge toute seule et le processus principal redémarre quand ses fichiers changent.

Pour lancer une fois, sans surveillance :

```bash
npm start
```

## 4. Construire l’application macOS

```bash
npm run dist:mac         # Apple Silicon (arm64) → release/Atelier FFmpeg-<version>-arm64.dmg
npm run dist:mac-intel   # Mac Intel (x64)
```

Le `.dmg` et le `.zip` sont créés dans `release/`.

L’icône vient de `build/icon.icns` (source vectorielle : `build/icon.svg`). L’application n’est pas signée avec un certificat Apple Developer : au premier lancement, utilisez la commande de la section 0.

`npm run build` compile seulement les sources dans `out/`, sans créer d’application.

## 5. Tests

```bash
npm test          # tests unitaires + conversions réelles avec le FFmpeg installé
npm run typecheck # vérification TypeScript
```

Les tests d’intégration créent des médias de test dans un dossier temporaire dont le chemin imite `/Users/Alex/Music/Mon Groupe/Sessions 2025`. Ce chemin contient des espaces, une apostrophe, des accents et des parenthèses. Ils vérifient :

- la conversion d’un dossier WAV récursif, les MP3 créés à côté des originaux ;
- qu’un MP3 existant n’est **pas écrasé** (« Déjà présent ») ;
- un dossier de sortie qui reproduit la structure des sous-dossiers, la création des dossiers après confirmation, les noms uniques `piste (2).mp3` ;
- le refus d’un dossier de sortie qui n’a pas été choisi par l’utilisateur ;
- la suppression optionnelle des originaux : Corbeille seulement après succès vérifié, jamais en cas d’échec ;
- les profils YouTube (résolution conservée) et Archivage (4K → 1920 × 1080 HEVC, portrait plus petit non agrandi, vidéo sans piste audio) ;
- la pause, la reprise et l’annulation (aucun fichier partiel laissé, source intacte).

Les tests sont ignorés si FFmpeg n’est pas installé.

## 6. Utilisation

1. **Médias** : *Ajouter des fichiers*, *Ajouter un dossier* (option *Inclure les sous-dossiers*) ou glisser-déposer dans la fenêtre. Chaque fichier est analysé avec `ffprobe` (durée, codec, résolution) et un statut s’affiche. Les fichiers illisibles sont signalés et ne seront pas convertis.
2. **Profil** : pour l’audio, le format de sortie et son réglage (*Qualité MP3* 0, 2, 4 ou 6 : plus le chiffre est bas, plus la qualité et la taille sont élevées ; débit AAC ou Opus ; résolution WAV). Les *Formats source* acceptés se cochent à l’étape 1 (WAV seul par défaut). Le détail de chaque format est dans l’infobulle (i). Un bloc *Taille estimée* compare la taille actuelle et la taille attendue ; la colonne *Après* du tableau donne l’estimation de chaque fichier.

   Les conversions **inutiles** sont bloquées et marquées « Inutile » : même format sans gain (WAV → WAV identique, MP3 → MP3, FLAC → FLAC…) ou montée en résolution qui n’améliore rien (WAV 16 bits / 44,1 kHz → 24 bits / 48 kHz). Un WAV → WAV reste possible quand il réduit vraiment le fichier, par exemple un master 24 bits vers la qualité CD (sortie `nom_CD.wav`). Les réglages inutiles pour toute la sélection sont grisés. Pour la vidéo, un mode de compression, un bloc *Pistes* quand les fichiers en ont plusieurs, et des *Réglages avancés* repliables (débit, audio AAC, encodeur, et pour *Personnalisé* : codec, résolution maximale, conteneur).

   **Pistes seulement, sans réencodage** : l’image et le son sont copiés tels quels ; seules les pistes audio et sous-titres non choisis sont retirés. C’est le moyen de gagner du poids sans aucune perte (par exemple en retirant une VO en DTS, souvent plus de 1 Go sur un film), en quelques minutes. En MP4, les pistes DTS, TrueHD, FLAC ou Opus gardées sont converties en AAC (non lues par les appareils Apple), et les sous-titres image ne peuvent pas être gardés : choisissez MKV pour tout conserver tel quel.

   **Vidéos déjà compressées** : la colonne *Format* affiche le débit actuel de chaque vidéo (par exemple « 2,7 Mbit/s »). Si le réglage choisi rendrait une vidéo plus lourde, elle est marquée « Inutile » et ignorée, au lieu de grossir sans gain. Exception : le passage vers H.264 (profil YouTube) reste permis depuis un autre codec, car il améliore la compatibilité ; il est alors simplement signalé comme plus lourd.

   **Conseils de réglage** (bouton en haut à droite de l’étape 2, en vidéo) : une fenêtre avec, pour chaque vidéo ajoutée, son débit actuel et un réglage conseillé (taille estimée, bouton *Utiliser* qui l’applique en *Personnalisé*), puis un tableau des débits vidéo conseillés par résolution (YouTube H.264, HEVC qualité, HEVC compact), les débits AAC selon le contenu et le rôle de chaque mode. Repère : 1 Mbit/s ≈ 450 Mo par heure.

   **Pistes (MKV, etc.)** : *Audio* garde toutes les pistes ou une seule langue. *Sous-titres* : tous ceux compatibles, aucun, ou une seule langue, éventuellement **incrustée dans l’image**. L’incrustation est la seule façon de garder en MP4 des sous-titres image (PGS de Blu-ray) ; elle est toujours visible et ne peut plus être désactivée. En lot, la langue choisie est cherchée dans chaque fichier ; à défaut, la piste principale est utilisée, et la vérification le signale.
3. **Destination** : *Même emplacement* (par défaut) ou *Dossier de sortie différent*. Choisissez aussi le comportement si la sortie existe : **Ignorer** (par défaut), **Remplacer** ou **Créer un nom unique**.

   **Nom de sortie** : par défaut, le nom d’origine suivi du réglage (`film_archive_1080p.mp4`). La case *Choisir le nom de sortie* permet de le changer : pour un seul fichier, le nom complet (l’extension est ajoutée automatiquement) ; pour plusieurs, un texte ajouté avant et/ou après le nom d’origine (`[Podcast] Voix 1 (MP3).mp3`). Les caractères `/` et `:` sont refusés, et un nom identique à la source est bloqué.
4. **Vérifier et lancer** : une fenêtre récapitule ce qui sera converti, ignoré ou impossible, les dossiers à créer (confirmation obligatoire) et les avertissements (encodeur de repli, espace disque). La conversion démarre ensuite dans **Tâches**.

### Son de fin de tâche

À la fin d’une tâche, l’app joue le son système *Glass* (ou *Basso* en cas d’erreur) et affiche une notification si elle est en arrière-plan. L’interrupteur *Son de fin de tâche*, dans Tâches, le désactive ; le choix est mémorisé.

### Option « Conserver les fichiers originaux »

Cochée par défaut, et toujours recochée au lancement de l’application. Tant qu’elle est cochée, les sources ne sont **jamais** modifiées, déplacées ni supprimées.

Si vous la décochez, chaque original est placé dans la **Corbeille de macOS**, et non supprimé définitivement. Cela n’arrive que si toutes ces conditions sont réunies :

- FFmpeg s’est terminé sans erreur et le fichier de sortie existe, non vide ;
- la sortie est relue avec `ffprobe` : elle contient la bonne piste (audio ou vidéo) et une durée équivalente à la source ;
- la sortie n’a pas le même chemin que la source.

Les fichiers ignorés (« Déjà présent »), en échec ou annulés ne sont jamais touchés. La fenêtre de vérification exige une seconde confirmation explicite avant de lancer une conversion avec cette option. Chaque fichier envoyé à la Corbeille est indiqué dans Tâches et dans l’Historique.

## 7. Profils et commandes générées

Les commandes sont construites comme des **tableaux d’arguments** passés à `spawn` (sans shell). Les chemins sont préfixés par `file:` pour que FFmpeg ne les interprète jamais comme un protocole ou une option. FFmpeg écrit d’abord dans un fichier temporaire caché (`.nom.atelier-partiel-xxxx.ext`) avec `-n`, puis l’application le renomme en nom final une fois l’encodage réussi. Une sortie incomplète ne peut donc pas être confondue avec une sortie réussie.

**Audio.** WAV → MP3 (équivalent de la commande de référence) :

```
ffmpeg -nostdin -n -i "piste.wav" -map 0:a:0 -map_metadata 0 -c:a libmp3lame -q:a 2 -id3v2_version 3 -vn -progress pipe:1 -nostats -f mp3 "piste.mp3"
```

Autres sorties audio (même nom, extension changée) :

| Format | Arguments principaux | Remarques |
| --- | --- | --- |
| AAC (`.m4a`) | `-c:a aac_at -b:a 256k -f ipod` | `aac_at` = encodeur AudioToolbox d’Apple, sinon `aac` de FFmpeg |
| FLAC | `-c:a flac -compression_level 8` | 16 ou 24 bits selon la source |
| ALAC (`.m4a`) | `-c:a alac -f ipod` | 16 ou 24 bits selon la source |
| WAV CD | `-af aresample=osr=44100:osf=s16:dither_method=triangular -c:a pcm_s16le` | tramage lors du passage en 16 bits |
| WAV studio | `-af aresample=osr=48000 -c:a pcm_s24le` | |
| Opus | `-c:a libopus -b:a 128k -vbr on` | |

La pochette intégrée (JPEG/PNG) est conservée en MP3, AAC, FLAC et ALAC. Une source au même format que la sortie aurait le même nom : elle est signalée (« Même format ») et ne peut être convertie qu’avec un dossier de sortie.

**Estimation de taille.** Vidéo : (débit vidéo + débit audio × nombre de pistes) × durée. Audio : débit moyen du format (MP3 VBR -q:a 2 ≈ 190 kbit/s…), ou taille PCM × 0,58 (FLAC) / 0,62 (ALAC). Le débit vidéo étant plafonné (`-maxrate`), le résultat réel est en général un peu inférieur à l’estimation.

**YouTube, résolution conservée** → `nom_youtube.mp4`

```
-c:v h264_videotoolbox -b:v 20000k -maxrate 20000k -bufsize 40000k -pix_fmt yuv420p -profile:v high -level:v 5.1 -c:a aac -b:a 384k -ar 48000 -movflags +faststart
```

- La résolution n’est jamais réduite. Une dimension impaire est arrondie au pixel pair inférieur, ce qu’exige le format 4:2:0.
- Audio : AAC 384 kbit/s en 48 kHz, la recommandation de YouTube pour l’envoi. YouTube recompresse toujours le son ; lui fournir un débit élevé limite la perte de cette double compression, pour environ 1,4 Mo de plus par minute qu’à 192 kbit/s.
- Débit vidéo : 20 Mbit/s par défaut. Les réglages avancés proposent la recommandation officielle de YouTube selon la source (SDR) : 8 Mbit/s en 1080p, 16 en 1440p, 35 à 45 en 4K à 24-30 i/s ; 12, 24 et 53 à 68 Mbit/s à 50-60 i/s. C’est une indication, pas une garantie de qualité ou de taille.
- Le niveau 5.1 n’est pas imposé au-delà de la 4K.

**Archivage, 1080p compact** → `nom_archive_1080p.mp4`

```
-vf scale=1920:1080:flags=lanczos,setsar=1 -c:v hevc_videotoolbox -b:v 4000k -maxrate 4000k -bufsize 8000k -tag:v hvc1 -c:a aac -b:a 128k
```

- Les dimensions cibles sont calculées à partir de la taille **affichée** (rotation et pixels non carrés pris en compte). Le grand côté est limité à 1920 px et le petit à 1080 px, soit 1920 × 1080 en paysage et 1080 × 1920 en portrait. Le ratio est conservé, les valeurs sont paires, et **une source plus petite n’est jamais agrandie**.
- `-tag:v hvc1` rend le HEVC lisible par QuickTime et le Finder.

**Personnalisé** → `nom_h264.mp4`, `nom_hevc_1080p.mkv`… avec codec H.264 ou HEVC, débits libres, résolution maximale source, 1080p ou 720p, et conteneur MP4, MOV ou MKV.

**Flux, métadonnées, compatibilité** (tous les profils vidéo) :

- vidéo principale (les pochettes intégrées sont ignorées) et **toutes les pistes audio**, converties en AAC ;
- aucun argument audio si la source n’a pas de piste audio : la conversion n’échoue pas ;
- `-map_metadata 0` et `-map_chapters 0` : métadonnées et chapitres conservés ;
- sous-titres texte (SRT, ASS, WebVTT) convertis en `mov_text` en MP4/MOV ; tous les sous-titres copiés en MKV ;
- sous-titres image (PGS, DVD) en MP4/MOV, pistes vidéo secondaires, flux de données (timecode, GPS) et pièces jointes : **omis et signalés** dans la vérification ;
- encodeurs : *Automatique* utilise VideoToolbox (matériel) s’il fonctionne réellement, sinon `libx264`/`libx265` avec un avertissement. *Matériel* ou *Logiciel* peuvent être imposés dans les réglages avancés.

La progression est lue sur le flux machine `-progress pipe:1`, et non sur le texte destiné à l’humain.

## 8. Diagnostic FFmpeg

La page **Diagnostic** (en bas de la barre latérale) affiche :

- le chemin de `ffmpeg` et `ffprobe`, la version (`ffmpeg -version`) ;
- l’état de `h264_videotoolbox`, `hevc_videotoolbox`, `libx264`, `libx265`, `aac`, `libmp3lame`, `aac_at` et `libopus` ;
- pour VideoToolbox, le résultat d’un **encodage d’essai réel** de 0,3 seconde : un encodeur listé n’est pas forcément utilisable (machine virtuelle, Mac ancien) ;
- les étapes d’installation Homebrew si FFmpeg est absent, avec un bouton pour copier chaque commande ;
- *Copier le rapport* : un résumé texte à joindre à une demande d’aide ;
- un avertissement si la version de FFmpeg est antérieure à 6.0 (aussi signalé au démarrage et par un point orange dans la barre latérale) ;
- *Rechercher une mise à jour* : uniquement sur demande, l’application demande à Homebrew (`brew outdated ffmpeg`) si une version plus récente existe, et affiche la commande `brew upgrade ffmpeg` à copier. Elle n’installe rien elle-même. Si FFmpeg n’a pas été installé avec Homebrew, elle l’indique.

Au démarrage, l’application vérifie que FFmpeg et FFprobe sont présents, lit leur version et teste réellement les encodeurs ; elle ne contacte pas Internet.

En cas d’échec d’un fichier, le bouton *Détails* de Tâches montre la commande exacte et la fin de la sortie FFmpeg, et *Copier le rapport d’erreur* la copie. Le dossier personnel y est remplacé par `~`. Les erreurs courantes sont traduites : disque plein, permission refusée, fichier source illisible, encodeur indisponible ou incompatible, fichier déplacé.

## 9. Architecture

```
src/
  shared/            Types, profils et validation (communs au processus principal et à l’interface)
    types.ts         Modèle de données et API exposée à l’interface
    profiles.ts      Profils, valeurs par défaut, calcul des dimensions, débit suggéré
    validate.ts      Validation de toutes les requêtes venant de l’interface
  main/              Processus principal Electron (Node)
    index.ts         Fenêtre, sécurité, boîtes de dialogue macOS, IPC
    backend.ts       Cœur applicatif indépendant d’Electron (testable sans fenêtre)
    ffmpeg/          Détection, ffprobe, construction des arguments, exécution, erreurs
    media/           Parcours des dossiers et registre des médias ajoutés
    jobs/            Planification (sorties, doublons, dossiers) et file de tâches
    store.ts         Réglages et historique (JSON dans le dossier de l’application)
  preload/index.ts   Pont sécurisé (contextBridge) : seules les fonctions de l’API sont exposées
  renderer/          Interface React
    components/      Composants réutilisables (boutons, vumètre, modale, panneaux…)
    views/           Audio/Vidéo (WorkspaceView), Tâches, Historique, Diagnostic
    styles.css       Système visuel (thèmes clair et sombre automatiques)
scripts/             build.mjs, dev.mjs, test.mjs
tests/               Tests unitaires et d’intégration
```

**Sécurité**

- `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`, et une politique CSP stricte : aucune ressource réseau.
- Les appels IPC ne sont acceptés que depuis la page de l’application, et chaque requête est validée par le processus principal.
- L’interface ne peut convertir que des fichiers ajoutés par l’utilisateur (boîte de dialogue ou glisser-déposer). Elle ne peut écrire que dans un dossier choisi via la boîte de dialogue, ou à côté des sources.
- Navigation et ouverture de nouvelles fenêtres bloquées.
- FFmpeg est lancé sans shell (`shell: false`) et chaque argument est séparé.

**Choix techniques**

- **esbuild plutôt que Vite** : le brief recommandait Electron + React + TypeScript + Vite « ou une alternative équivalente ». Vite repose lui-même sur esbuild. Un script de build de 60 lignes (`scripts/build.mjs`) remplace ici la chaîne electron-vite, avec moins de dépendances et un build identique en développement et en production. Il a aussi pu être vérifié de bout en bout pendant la réalisation.
- **Parallélisme** : une tâche audio et une tâche vidéo tournent en même temps (l’audio occupe le processeur, la vidéo l’encodeur matériel) ; deux tâches du même type s’exécutent l’une après l’autre. Dans une tâche audio, plusieurs fichiers sont encodés en même temps (la moitié des cœurs, 4 au maximum ; variable `ATELIER_AUDIO_CONCURRENCY` pour forcer de 1 à 8). En vidéo, un fichier à la fois : l’encodeur matériel est déjà parallèle.
- **Édition** (découpe, formats réseaux, GIF) : développée mais masquée depuis la v1.2 (`FEATURES.edit` dans `src/shared/brand.ts`). Son moteur reste testé.
- **Pause** : implémentée par `SIGSTOP`/`SIGCONT` sur le processus FFmpeg, une méthode fiable sous macOS. Le chronomètre s’arrête pendant la pause.
- **Annulation** : `SIGTERM`, puis `SIGKILL` après 4 s si besoin. Le fichier partiel est supprimé ; si la suppression échoue, son chemin est indiqué. Quitter l’application pendant une conversion demande une confirmation, puis applique la même procédure.
- Réglages et historique (40 dernières tâches) : `~/Library/Application Support/Atelier FFmpeg/`.

## 10. Limitations connues

- Convertir une source compressée (MP3, AAC) vers un format sans perte ne récupère pas la qualité perdue ; l’interface le rappelle.
- Pour une source audio multipiste ou une vidéo à plusieurs pistes audio, seule la première piste est convertie en mode Audio.
- Les vidéos sont converties une à la fois (une tâche audio peut tourner en parallèle).
- Les vidéos HDR (HLG/PQ) sont réencodées sans adaptation de tonalité. En H.264, la sortie est toujours en 8 bits (`yuv420p`, requis pour la compatibilité YouTube). En HEVC, une source 10 bits est transmise telle quelle à l’encodeur.
- Le pourcentage de progression dépend de la durée annoncée par la source. Si elle est inconnue, une barre indéterminée s’affiche.
- L’estimation d’espace disque est indicative (débit × durée).
- L’application n’est pas signée ni notarisée (voir section 4).

## 11. À propos

Créé par **jimix.wav** en 2026 ([page GitHub](https://github.com/JimixWav?tab=repositories)). Le nom, l’auteur, l’adresse GitHub et l’année sont définis à un seul endroit : `src/shared/brand.ts`. Ils sont repris dans le menu *À propos* de macOS, dans le menu *Aide > jimix.wav sur GitHub* et dans la page Diagnostic, où le pseudo est un lien. C’est la seule adresse Internet que l’application peut ouvrir (dans le navigateur par défaut).

## 12. Commandes utiles

| Commande | Effet |
| --- | --- |
| `npm install` | Installe les dépendances |
| `npm run dev` | Lance l’application en mode développement |
| `npm start` | Compile puis lance l’application |
| `npm run build` | Compile dans `out/` |
| `npm test` | Tests unitaires et conversions réelles |
| `npm run typecheck` | Vérification TypeScript |
| `npm run dist:mac` | Crée le `.dmg` Apple Silicon dans `release/` |
