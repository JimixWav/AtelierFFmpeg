import { app, BrowserWindow, clipboard, dialog, ipcMain, Menu, nativeTheme, Notification, protocol, shell, type IpcMainInvokeEvent, type MenuItemConstructorOptions } from 'electron';
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { Readable } from 'node:stream';
import { spawn } from 'node:child_process';
import type { JobSnapshot } from '../shared/types';
import { watch } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { AUDIO_SOURCE_GROUPS, audioExtensions } from '../shared/profiles';
import { BRAND, copyrightLine } from '../shared/brand';
import { Backend, type DialogRequest } from './backend';

const EDIT_EXTENSIONS = audioExtensions(AUDIO_SOURCE_GROUPS.map((g) => g.id));

const isDev = process.env.ATELIER_DEV === '1';
const rendererDir = path.join(__dirname, '..', 'renderer');
const rendererIndex = path.join(rendererDir, 'index.html');

let mainWindow: BrowserWindow | null = null;
let backend: Backend;
let quitting = false;

function createWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1180,
    height: 820,
    minWidth: 940,
    minHeight: 640,
    show: false,
    title: 'Atelier FFmpeg',
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 18, y: 20 },
    vibrancy: 'sidebar',
    visualEffectState: 'followWindow',
    backgroundColor: process.platform === 'darwin' ? '#00000000' : nativeTheme.shouldUseDarkColors ? '#151917' : '#F2F4F1',
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload', 'index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      spellcheck: false,
    },
  });

  // Aucune navigation ni nouvelle fenêtre : l'interface est entièrement locale.
  win.webContents.on('will-navigate', (e, url) => {
    if (url !== win.webContents.getURL()) e.preventDefault();
  });
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.once('ready-to-show', () => win.show());
  void win.loadFile(rendererIndex);

  if (isDev) {
    let t: NodeJS.Timeout | null = null;
    watch(rendererDir, { recursive: true }, () => {
      if (t) clearTimeout(t);
      t = setTimeout(() => win.webContents.reloadIgnoringCache(), 150);
    });
  }
  return win;
}

/** N'accepte que les appels provenant de notre propre page. */
function trusted(e: IpcMainInvokeEvent): boolean {
  const url = (e.senderFrame?.url ?? '').split('#')[0].split('?')[0];
  if (!url.startsWith('file:')) return false;
  try {
    // Comparaison des chemins décodés : insensible à l'encodage des espaces et accents.
    return path.normalize(fileURLToPath(url)).normalize('NFC') === path.normalize(rendererIndex).normalize('NFC');
  } catch {
    return false;
  }
}

function handle(channel: string, fn: (...args: unknown[]) => unknown): void {
  ipcMain.handle(channel, async (e, ...args) => {
    if (!trusted(e)) throw new Error('Appel refusé');
    return fn(...args);
  });
}

async function showDialog(req: DialogRequest): Promise<string[] | null> {
  const parent = mainWindow ?? undefined;
  let res: Electron.OpenDialogReturnValue;
  switch (req.type) {
    case 'files':
      res = await dialog.showOpenDialog(parent as BrowserWindow, {
        title: req.kind === 'audio' ? 'Ajouter des fichiers audio' : 'Ajouter des vidéos',
        buttonLabel: 'Ajouter',
        properties: ['openFile', 'multiSelections'],
        filters: [
          { name: req.kind === 'audio' ? 'Fichiers audio' : 'Vidéos', extensions: [...req.extensions] },
        ],
      });
      break;
    case 'folder':
      res = await dialog.showOpenDialog(parent as BrowserWindow, {
        title: req.kind === 'audio' ? 'Ajouter un dossier de fichiers audio' : 'Ajouter un dossier de vidéos',
        buttonLabel: 'Ajouter ce dossier',
        properties: ['openDirectory'],
      });
      break;
    case 'edit':
      res = await dialog.showOpenDialog(parent as BrowserWindow, {
        title: 'Ouvrir un fichier à éditer',
        buttonLabel: 'Ouvrir',
        properties: ['openFile'],
        filters: [{ name: 'Audio et vidéo', extensions: [...EDIT_EXTENSIONS] }],
      });
      break;
    case 'output':
      res = await dialog.showOpenDialog(parent as BrowserWindow, {
        title: 'Choisir le dossier de sortie',
        buttonLabel: 'Choisir',
        properties: ['openDirectory', 'createDirectory'],
      });
      break;
    case 'binary':
    default:
      res = await dialog.showOpenDialog(parent as BrowserWindow, {
        title: 'Choisir l’exécutable ffmpeg',
        buttonLabel: 'Utiliser',
        defaultPath: '/opt/homebrew/bin',
        properties: ['openFile', 'showHiddenFiles'],
      });
      break;
  }
  return res.canceled ? null : res.filePaths;
}

/** Son système + notification (si la fenêtre n'est pas au premier plan) à la fin d'une tâche. */
function notifyFinished(job: JobSnapshot, sound: boolean): void {
  const ok = job.state === 'done';
  const failed = job.state === 'done-with-errors' || job.state === 'failed';
  // Carillon joué par l'interface (Web Audio) : aucune dépendance système, ne peut pas planter.
  const chime = () => mainWindow?.webContents.send('app:chime', failed);
  if (sound && job.state !== 'cancelled') {
    if (process.platform === 'darwin') {
      const file = `/System/Library/Sounds/${failed ? 'Basso' : 'Glass'}.aiff`;
      try {
        const p = spawn('afplay', [file], { stdio: 'ignore', detached: false });
        p.on('error', chime);
      } catch {
        chime();
      }
    } else {
      chime();
    }
  }
  const focused = mainWindow?.isFocused() ?? false;
  if (!focused && job.state !== 'cancelled' && process.platform === 'darwin') {
    if (Notification.isSupported()) {
      const done = job.counts.done;
      new Notification({
        title: ok ? 'Conversion terminée' : failed ? 'Conversion terminée avec des erreurs' : 'Tâche terminée',
        body: `${done} fichier${done > 1 ? 's' : ''} converti${done > 1 ? 's' : ''}${job.counts.failed ? `, ${job.counts.failed} échec${job.counts.failed > 1 ? 's' : ''}` : ''}.`,
        silent: true,
      }).show();
    }
    app.dock?.bounce('informational');
  }
}

function registerIpc(): void {
  handle('env:get', (refresh) => backend.getEnvironment(refresh === true));
  handle('env:choose', () => backend.chooseFfmpegBinary());
  handle('env:reset', () => backend.resetFfmpegBinary());
  handle('media:pickFiles', (kind, sources) => backend.pickFiles(kind, sources));
  handle('media:pickFolder', (kind, recursive, sources) => backend.pickFolder(kind, recursive, sources));
  handle('media:addDropped', (kind, paths, recursive, sources) => backend.addDroppedPaths(kind, paths, recursive, sources));
  handle('media:pickOutput', () => backend.pickOutputFolder());
  handle('job:plan', (req) => backend.planJob(req));
  handle('job:start', (req, confirm) => backend.startJob(req, confirm));
  handle('job:cancel', (id) => backend.cancelJob(id));
  handle('job:pause', (id) => backend.pauseJob(id));
  handle('job:resume', (id) => backend.resumeJob(id));
  handle('job:list', () => backend.getJobs());
  handle('job:clear', () => backend.clearFinishedJobs());
  handle('history:get', () => backend.getHistory());
  handle('history:clear', () => backend.clearHistory());
  handle('shell:reveal', (p) => backend.revealInFinder(p));
  handle('shell:open', (p) => backend.openPath(p));
  handle('clipboard:write', (t) => backend.copyText(t));
  handle('prefs:get', () => backend.getPreferences());
  handle('edit:open', (p) => backend.openForEdit(p));
  handle('edit:waveform', (id) => backend.getWaveform(id));
  handle('edit:frame', (id, t) => backend.getFrame(id, t));
  handle('prefs:set', (p) => backend.setPreferences(p));
  handle('env:checkUpdate', () => backend.checkFfmpegUpdate());
  // Seule adresse Internet que l'application peut ouvrir (dans le navigateur par défaut).
  handle('shell:authorPage', () => shell.openExternal(BRAND.authorUrl));
}

/** Menu de l'application, en français, sans les liens d'aide d'Electron. */
function buildMenu(): void {
  const mac = process.platform === 'darwin';
  const template: MenuItemConstructorOptions[] = [
    ...(mac
      ? [
          {
            label: BRAND.name,
            submenu: [
              { role: 'about', label: `À propos d’${BRAND.name}` },
              { type: 'separator' as const },
              { role: 'services', label: 'Services' },
              { type: 'separator' as const },
              { role: 'hide', label: `Masquer ${BRAND.name}` },
              { role: 'hideOthers', label: 'Masquer les autres' },
              { role: 'unhide', label: 'Tout afficher' },
              { type: 'separator' as const },
              { role: 'quit', label: `Quitter ${BRAND.name}` },
            ],
          },
        ]
      : []),
    {
      label: 'Édition',
      submenu: [
        { role: 'undo', label: 'Annuler' },
        { role: 'redo', label: 'Rétablir' },
        { type: 'separator' },
        { role: 'cut', label: 'Couper' },
        { role: 'copy', label: 'Copier' },
        { role: 'paste', label: 'Coller' },
        { role: 'selectAll', label: 'Tout sélectionner' },
      ],
    },
    {
      label: 'Présentation',
      submenu: [
        { role: 'resetZoom', label: 'Taille réelle' },
        { role: 'zoomIn', label: 'Agrandir' },
        { role: 'zoomOut', label: 'Réduire' },
        { type: 'separator' },
        { role: 'togglefullscreen', label: 'Plein écran' },
        ...(isDev ? [{ role: 'toggleDevTools', label: 'Outils de développement' }] : []),
      ],
    },
    {
      label: 'Fenêtre',
      role: 'windowMenu',
      submenu: [
        { role: 'minimize', label: 'Placer dans le Dock' },
        { role: 'zoom', label: 'Réduire/agrandir' },
        { type: 'separator' },
        { role: 'close', label: 'Fermer la fenêtre' },
        ...(mac ? [{ role: 'front', label: 'Tout ramener au premier plan' }] : []),
      ],
    },
    {
      label: 'Aide',
      role: 'help',
      submenu: [{ label: `${BRAND.author} sur GitHub`, click: () => void shell.openExternal(BRAND.authorUrl) }],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

app.setName(BRAND.name);
// Le copyright est centré dans la fenêtre « À propos » de macOS (les crédits ne le sont pas).
app.setAboutPanelOptions({
  applicationName: BRAND.name,
  applicationVersion: app.getVersion(),
  version: '',
  copyright: `${copyrightLine()} · ${BRAND.authorUrl.replace(/^https:\/\//, '').replace(/\?.*$/, '')}\nConversions audio et vidéo locales avec FFmpeg.`,
});

/* Lecture locale des médias pour l'aperçu (onglet Édition) : seuls les fichiers
   ouverts par l'utilisateur sont servis, avec prise en charge des plages (Range). */
protocol.registerSchemesAsPrivileged([
  { scheme: 'atelier-media', privileges: { standard: true, secure: true, stream: true, supportFetchAPI: true } },
]);

const MEDIA_TYPES: Record<string, string> = {
  mp4: 'video/mp4', m4v: 'video/mp4', mov: 'video/mp4', webm: 'video/webm', mkv: 'video/x-matroska', ogv: 'video/ogg',
  mp3: 'audio/mpeg', wav: 'audio/wav', wave: 'audio/wav', flac: 'audio/flac', m4a: 'audio/mp4', aac: 'audio/aac', ogg: 'audio/ogg', oga: 'audio/ogg', opus: 'audio/ogg',
};

async function serveMedia(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const id = decodeURIComponent(url.pathname.replace(/^\//, ''));
  const file = backend?.mediaPathFor(id);
  if (!file) return new Response('Introuvable', { status: 404 });
  let size: number;
  try {
    size = (await stat(file)).size;
  } catch {
    return new Response('Introuvable', { status: 404 });
  }
  const type = MEDIA_TYPES[path.extname(file).slice(1).toLowerCase()] ?? 'application/octet-stream';
  const range = /bytes=(\d*)-(\d*)/.exec(req.headers.get('range') ?? '');
  if (range && (range[1] || range[2])) {
    let start = range[1] ? Number(range[1]) : Math.max(0, size - Number(range[2]));
    const end = range[1] && range[2] ? Math.min(Number(range[2]), size - 1) : size - 1;
    if (!range[1]) start = Math.max(0, size - Number(range[2]));
    if (start >= size || start > end) {
      return new Response(null, { status: 416, headers: { 'Content-Range': `bytes */${size}` } });
    }
    const body = Readable.toWeb(createReadStream(file, { start, end })) as unknown as ReadableStream;
    return new Response(body, {
      status: 206,
      headers: { 'Content-Type': type, 'Content-Length': String(end - start + 1), 'Content-Range': `bytes ${start}-${end}/${size}`, 'Accept-Ranges': 'bytes' },
    });
  }
  const body = Readable.toWeb(createReadStream(file)) as unknown as ReadableStream;
  return new Response(body, { status: 200, headers: { 'Content-Type': type, 'Content-Length': String(size), 'Accept-Ranges': 'bytes' } });
}

void app.whenReady().then(() => {
  backend = new Backend({
    dataDir: app.getPath('userData'),
    showDialog,
    trash: (f) => shell.trashItem(f),
    reveal: (f) => shell.showItemInFolder(f),
    open: (f) => shell.openPath(f),
    copy: (t) => clipboard.writeText(t),
    emitJobs: (jobs) => mainWindow?.webContents.send('jobs:changed', jobs),
    notifyFinished,
  });
  registerIpc();
  buildMenu();
  protocol.handle('atelier-media', serveMedia);
  void backend.getEnvironment();
  mainWindow = createWindow();
  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  app.on('activate', () => {
    if (!mainWindow) mainWindow = createWindow();
  });
});

app.on('before-quit', (e) => {
  if (quitting || !backend?.hasActiveJobs()) return;
  e.preventDefault();
  const choice = dialog.showMessageBoxSync(mainWindow ?? (undefined as unknown as BrowserWindow), {
    type: 'warning',
    buttons: ['Annuler les conversions et quitter', 'Continuer les conversions'],
    defaultId: 1,
    cancelId: 1,
    message: 'Des conversions sont en cours.',
    detail: 'Quitter maintenant arrête FFmpeg et supprime les fichiers partiels. Les originaux ne sont pas touchés.',
  });
  if (choice !== 0) return;
  quitting = true;
  void backend.shutdown().finally(() => app.quit());
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
