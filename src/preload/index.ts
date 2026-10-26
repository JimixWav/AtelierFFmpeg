/**
 * Pont sécurisé entre l'interface et le processus principal.
 * Seules ces fonctions sont exposées ; aucun accès Node n'est donné à la page.
 */
import { contextBridge, ipcRenderer, webUtils } from 'electron';
import type { AtelierApi, JobSnapshot } from '../shared/types';

const invoke = <T>(channel: string, ...args: unknown[]): Promise<T> => ipcRenderer.invoke(channel, ...args) as Promise<T>;

const api: AtelierApi = {
  platform: process.platform,
  getEnvironment: (refresh) => invoke('env:get', refresh === true),
  chooseFfmpegBinary: () => invoke('env:choose'),
  resetFfmpegBinary: () => invoke('env:reset'),
  pickFiles: (kind, sources) => invoke('media:pickFiles', kind, sources),
  pickFolder: (kind, recursive, sources) => invoke('media:pickFolder', kind, recursive, sources),
  addDroppedPaths: (kind, paths, recursive, sources) => invoke('media:addDropped', kind, paths, recursive, sources),
  pickOutputFolder: () => invoke('media:pickOutput'),
  planJob: (req) => invoke('job:plan', req),
  startJob: (req, confirm) => invoke('job:start', req, confirm),
  cancelJob: (id) => invoke('job:cancel', id),
  pauseJob: (id) => invoke('job:pause', id),
  resumeJob: (id) => invoke('job:resume', id),
  getJobs: () => invoke('job:list'),
  clearFinishedJobs: () => invoke('job:clear'),
  getHistory: () => invoke('history:get'),
  clearHistory: () => invoke('history:clear'),
  revealInFinder: (p) => invoke('shell:reveal', p),
  openPath: (p) => invoke('shell:open', p),
  copyText: (t) => invoke('clipboard:write', t),
  openAuthorPage: () => invoke('shell:authorPage'),
  checkFfmpegUpdate: () => invoke('env:checkUpdate'),
  getPreferences: () => invoke('prefs:get'),
  openForEdit: (p) => invoke('edit:open', p),
  getWaveform: (id) => invoke('edit:waveform', id),
  getFrame: (id, t) => invoke('edit:frame', id, t),
  mediaUrl: (id) => `atelier-media://media/${encodeURIComponent(id)}`,
  setPreferences: (p) => invoke('prefs:set', p),
  onChime: (listener) => {
    const wrapped = (_e: unknown, failed: boolean) => listener(failed === true);
    ipcRenderer.on('app:chime', wrapped);
    return () => {
      ipcRenderer.removeListener('app:chime', wrapped);
    };
  },
  onJobsChanged: (listener) => {
    const wrapped = (_e: unknown, jobs: JobSnapshot[]) => listener(jobs);
    ipcRenderer.on('jobs:changed', wrapped);
    return () => {
      ipcRenderer.removeListener('jobs:changed', wrapped);
    };
  },
  getPathForFile: (file) => {
    try {
      return webUtils.getPathForFile(file);
    } catch {
      return '';
    }
  },
};

contextBridge.exposeInMainWorld('atelier', api);
