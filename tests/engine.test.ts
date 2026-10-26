/**
 * Tests d'intégration avec le vrai FFmpeg installé sur la machine.
 * Ils créent des médias de test dans un dossier temporaire dont le chemin
 * contient des espaces, une apostrophe, des accents et des parenthèses.
 * Ignorés automatiquement si FFmpeg est absent.
 */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { Backend, type DialogRequest, type Platform } from '../src/main/backend';
import { detectEnvironment } from '../src/main/ffmpeg/environment';
import { DEFAULT_AUDIO, defaultVideoSettings } from '../src/shared/profiles';
import type { JobRequest, JobSnapshot } from '../src/shared/types';

let tmp = '';
let music = '';
let trashDir = '';
let ffmpeg: string | null = null;
let ffprobe = '';
let dialogQueue: (string[] | null)[] = [];
let lastJobs: JobSnapshot[] = [];

const platform = (): Platform => ({
  dataDir: path.join(tmp, 'data'),
  showDialog: async (_r: DialogRequest) => dialogQueue.shift() ?? null,
  trash: async (f) => {
    mkdirSync(trashDir, { recursive: true });
    renameSync(f, path.join(trashDir, path.basename(f)));
  },
  reveal: () => undefined,
  open: async () => '',
  copy: () => undefined,
  notifyFinished: () => undefined,
  emitJobs: (jobs) => {
    lastJobs = jobs;
  },
});

function gen(args: string[]): void {
  const r = spawnSync(ffmpeg as string, ['-hide_banner', '-loglevel', 'error', '-y', ...args]);
  if (r.status !== 0) throw new Error(r.stderr.toString());
}

async function waitJob(b: Backend, id: string, timeoutMs = 120_000): Promise<JobSnapshot> {
  const t0 = Date.now();
  for (;;) {
    const j = b.getJobs().find((x) => x.id === id);
    if (j && ['done', 'done-with-errors', 'cancelled', 'failed'].includes(j.state)) return j;
    if (Date.now() - t0 > timeoutMs) throw new Error('timeout');
    await new Promise((r) => setTimeout(r, 100));
  }
}

before(async () => {
  const env = await detectEnvironment(null);
  ffmpeg = env.ok ? env.ffmpegPath : null;
  ffprobe = env.ffprobePath ?? '';
  tmp = mkdtempSync(path.join(os.tmpdir(), 'atelier-test-'));
  music = path.join(tmp, 'Music', 'Mon Groupe', 'Sessions 2025');
  trashDir = path.join(tmp, 'Corbeille');
  if (!ffmpeg) return;
  mkdirSync(path.join(music, 'Sous dossier (B)'), { recursive: true });
  gen(['-f', 'lavfi', '-i', 'sine=frequency=440:duration=3', path.join(music, "L'été (prise 1).wav")]);
  gen(['-f', 'lavfi', '-i', 'sine=frequency=660:duration=2', path.join(music, 'Sous dossier (B)', 'piste.wav')]);
  gen(['-f', 'lavfi', '-i', 'sine=frequency=220:duration=2', path.join(music, 'déjà fait.wav')]);
  writeFileSync(path.join(music, 'déjà fait.mp3'), 'existant');
  writeFileSync(path.join(music, 'corrompu.wav'), 'pas un wav');
  writeFileSync(path.join(music, 'notes.txt'), 'texte');
  gen(['-f', 'lavfi', '-i', 'testsrc2=size=2560x1440:rate=25:duration=2', '-f', 'lavfi', '-i', 'sine=duration=2', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', path.join(music, 'Clip vidéo.mov')]);
  gen(['-f', 'lavfi', '-i', 'testsrc2=size=720x1280:rate=25:duration=2', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', path.join(music, 'portrait muet.mp4')]);
});

after(() => {
  if (tmp) rmSync(tmp, { recursive: true, force: true });
});

test('lot audio : dossier récursif, à côté des originaux, sans écraser, originaux conservés', async (t) => {
  if (!ffmpeg) return t.skip('FFmpeg absent');
  const b = new Backend(platform());
  dialogQueue = [[music]];
  const add = await b.pickFolder('audio', true);
  assert.equal(add.items.length, 4); // 3 WAV valides + 1 corrompu
  const corrupt = add.items.find((i) => i.name === 'corrompu.wav');
  assert.equal(corrupt?.status, 'error');
  const req: JobRequest = {
    kind: 'audio', itemIds: add.items.map((i) => i.id), audio: { ...DEFAULT_AUDIO, quality: 2 },
    destination: { mode: 'beside' }, collision: 'skip', deleteSource: false,
  };
  const plan = await b.planJob(req);
  assert.deepEqual(plan.counts, { convert: 2, skip: 1, collision: 0, error: 1 });
  const start = await b.startJob(req, false);
  assert.ok(start.ok, start.error ?? "");
  const job = await waitJob(b, start.jobId as string);
  assert.equal(job.state, 'done-with-errors');
  assert.equal(job.counts.done, 2);
  assert.equal(job.counts.skipped, 1);
  assert.ok(existsSync(path.join(music, "L'été (prise 1).mp3")));
  assert.ok(existsSync(path.join(music, 'Sous dossier (B)', 'piste.mp3')));
  assert.ok(existsSync(path.join(music, "L'été (prise 1).wav")), 'original conservé');
  assert.equal(statSync(path.join(music, 'déjà fait.mp3')).size, 'existant'.length, 'non écrasé');
  assert.ok(!readdirSync(music).some((f) => f.includes('atelier-partiel')), 'aucun fichier partiel');
  assert.ok(lastJobs.length > 0);
  const hist = await b.getHistory();
  await new Promise((r) => setTimeout(r, 200));
  assert.ok((await b.getHistory()).length >= hist.length);
});

test('dossier de sortie : structure relative préservée, nom unique, création confirmée', async (t) => {
  if (!ffmpeg) return t.skip('FFmpeg absent');
  const b = new Backend(platform());
  const outRoot = path.join(tmp, 'Sorties MP3');
  mkdirSync(outRoot);
  dialogQueue = [[music], [outRoot]];
  const add = await b.pickFolder('audio', true);
  const folder = await b.pickOutputFolder();
  const ids = add.items.filter((i) => i.status === 'ready').map((i) => i.id);
  const req: JobRequest = { kind: 'audio', itemIds: ids, audio: { ...DEFAULT_AUDIO, quality: 6 }, destination: { mode: 'folder', folder: folder as string }, collision: 'unique', deleteSource: false };
  const plan = await b.planJob(req);
  assert.ok(plan.dirsToCreate.some((d) => d.endsWith('Sous dossier (B)')));
  const refused = await b.startJob(req, false);
  assert.equal(refused.ok, false);
  const start = await b.startJob(req, true);
  const job = await waitJob(b, start.jobId as string);
  assert.equal(job.state, 'done');
  assert.ok(existsSync(path.join(outRoot, 'Sous dossier (B)', 'piste.mp3')));
  // Deuxième passage : noms uniques
  const again = await b.startJob(req, true);
  await waitJob(b, again.jobId as string);
  assert.ok(existsSync(path.join(outRoot, 'Sous dossier (B)', 'piste (2).mp3')));
});

test('dossier de sortie non choisi via la boîte de dialogue : refusé', async (t) => {
  if (!ffmpeg) return t.skip('FFmpeg absent');
  const b = new Backend(platform());
  dialogQueue = [[path.join(music, 'déjà fait.wav')]];
  const add = await b.pickFiles('audio');
  await assert.rejects(b.planJob({ kind: 'audio', itemIds: [add.items[0].id], audio: { ...DEFAULT_AUDIO, quality: 2 }, destination: { mode: 'folder', folder: '/etc' }, collision: 'skip', deleteSource: false }), /non autorisé/);
});

test('suppression optionnelle : l’original part à la Corbeille seulement après succès vérifié', async (t) => {
  if (!ffmpeg) return t.skip('FFmpeg absent');
  const b = new Backend(platform());
  const dir = path.join(tmp, 'A supprimer');
  mkdirSync(dir);
  const src = path.join(dir, 'à jeter.wav');
  gen(['-f', 'lavfi', '-i', 'sine=duration=2', src]);
  writeFileSync(path.join(dir, 'cassé.wav'), 'RIFF....pas valide');
  dialogQueue = [[src, path.join(dir, 'cassé.wav')]];
  const add = await b.pickFiles('audio');
  const req: JobRequest = { kind: 'audio', itemIds: add.items.map((i) => i.id), audio: { ...DEFAULT_AUDIO, quality: 2 }, destination: { mode: 'beside' }, collision: 'skip', deleteSource: true };
  const start = await b.startJob(req, false);
  const job = await waitJob(b, start.jobId as string);
  const done = job.items.find((i) => i.name === 'à jeter.wav');
  assert.equal(done?.status, 'done');
  assert.equal(done?.sourceTrashed, true);
  assert.ok(!existsSync(src), 'original déplacé');
  assert.ok(existsSync(path.join(trashDir, 'à jeter.wav')), 'dans la Corbeille');
  assert.ok(existsSync(path.join(dir, 'à jeter.mp3')));
  assert.ok(existsSync(path.join(dir, 'cassé.wav')), 'un fichier en échec n’est jamais supprimé');
});

test('vidéo : profils YouTube et Archivage, noms distincts, source intacte, vidéo sans audio', async (t) => {
  if (!ffmpeg) return t.skip('FFmpeg absent');
  const b = new Backend(platform());
  dialogQueue = [[path.join(music, 'Clip vidéo.mov'), path.join(music, 'portrait muet.mp4')]];
  const add = await b.pickFiles('video');
  assert.equal(add.items.filter((i) => i.status === 'ready').length, 2);
  const ids = add.items.map((i) => i.id);
  for (const profile of ['youtube', 'archive'] as const) {
    const req: JobRequest = { kind: 'video', itemIds: ids, video: { ...defaultVideoSettings(profile), videoBitrateMbps: 2 }, destination: { mode: 'beside' }, collision: 'skip', deleteSource: false };
    const start = await b.startJob(req, false);
    assert.ok(start.ok, start.error ?? "");
    const job = await waitJob(b, start.jobId as string, 300_000);
    assert.equal(job.state, 'done', JSON.stringify(job.items.map((i) => [i.message, i.errorDetails])));
  }
  assert.ok(existsSync(path.join(music, 'Clip vidéo_youtube.mp4')));
  assert.ok(existsSync(path.join(music, 'Clip vidéo_archive_1080p.mp4')));
  assert.ok(existsSync(path.join(music, 'portrait muet_archive_1080p.mp4')));
  assert.ok(existsSync(path.join(music, 'Clip vidéo.mov')));
  const r = spawnSync(ffprobe, ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height,codec_name', '-of', 'csv=p=0', path.join(music, 'Clip vidéo_archive_1080p.mp4')]);
  assert.equal(r.stdout.toString().trim(), 'hevc,1920,1080');
  const p = spawnSync(ffprobe, ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height', '-of', 'csv=p=0', path.join(music, 'portrait muet_archive_1080p.mp4')]);
  assert.equal(p.stdout.toString().trim(), '720,1280', 'source portrait plus petite : pas d’agrandissement');
  const y = spawnSync(ffprobe, ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height', '-of', 'csv=p=0', path.join(music, 'Clip vidéo_youtube.mp4')]);
  assert.equal(y.stdout.toString().trim(), '2560,1440', 'YouTube : résolution conservée');
});

test('annulation : FFmpeg arrêté, fichier partiel supprimé, source intacte', async (t) => {
  if (!ffmpeg) return t.skip('FFmpeg absent');
  const b = new Backend(platform());
  const dir = path.join(tmp, 'Annulation test');
  mkdirSync(dir);
  const src = path.join(dir, 'long.mov');
  gen(['-f', 'lavfi', '-i', 'testsrc2=size=1920x1080:rate=30:duration=40', '-c:v', 'libx264', '-preset', 'ultrafast', src]);
  dialogQueue = [[src]];
  const add = await b.pickFiles('video');
  const req: JobRequest = { kind: 'video', itemIds: [add.items[0].id], video: { ...defaultVideoSettings('archive') }, destination: { mode: 'beside' }, collision: 'skip', deleteSource: true };
  const start = await b.startJob(req, false);
  await new Promise((r) => setTimeout(r, 1500));
  b.pauseJob(start.jobId);
  assert.equal(b.getJobs().find((j) => j.id === start.jobId)?.state, 'paused');
  await new Promise((r) => setTimeout(r, 500));
  b.resumeJob(start.jobId);
  await new Promise((r) => setTimeout(r, 500));
  b.cancelJob(start.jobId);
  const job = await waitJob(b, start.jobId as string);
  assert.equal(job.state, 'cancelled');
  assert.equal(job.items[0].status, 'cancelled');
  assert.deepEqual(readdirSync(dir), ['long.mov'], 'ni sortie ni fichier partiel');
});

test('nouveaux formats audio : sources AIFF/FLAC/vidéo, sorties AAC, FLAC, ALAC, WAV CD, Opus, pochette conservée', async (t) => {
  if (!ffmpeg) return t.skip('FFmpeg absent');
  const b = new Backend(platform());
  const dir = path.join(tmp, 'Formats audio');
  mkdirSync(dir);
  gen(['-f', 'lavfi', '-i', 'sine=frequency=500:duration=3:sample_rate=48000', '-c:a', 'pcm_s24be', path.join(dir, 'Prise 24 bits.aiff')]);
  gen(['-f', 'lavfi', '-i', 'sine=duration=3', path.join(tmp, 'brut.flac')]);
  gen(['-f', 'lavfi', '-i', 'color=c=red:s=300x300', '-frames:v', '1', path.join(tmp, 'pochette.jpg')]);
  gen(['-i', path.join(tmp, 'brut.flac'), '-i', path.join(tmp, 'pochette.jpg'), '-map', '0:a', '-map', '1:v', '-c', 'copy', '-disposition:v', 'attached_pic', path.join(dir, 'Avec pochette.flac')]);
  gen(['-f', 'lavfi', '-i', 'testsrc2=size=640x360:rate=25:duration=3', '-f', 'lavfi', '-i', 'sine=duration=3', '-c:v', 'libx264', '-c:a', 'aac', '-shortest', path.join(dir, 'Concert.mp4')]);

  // Sans la famille « vidéo » cochée, le MP4 est refusé.
  dialogQueue = [[path.join(dir, 'Concert.mp4')]];
  const refused = await b.pickFiles('audio', ['wav']);
  assert.equal(refused.items.length, 0);
  assert.match(refused.rejected[0].reason, /Formats source/);

  dialogQueue = [[dir]];
  const sources = ['aiff', 'flac', 'video'] as const;
  const add = await b.pickFolder('audio', false, [...sources]);
  assert.equal(add.items.filter((i) => i.status === 'ready').length, 3);
  const ids = add.items.map((i) => i.id);
  const cases: { format: 'aac' | 'flac' | 'alac' | 'wav' | 'opus' | 'mp3'; ext: string; codec: string }[] = [
    { format: 'mp3', ext: 'mp3', codec: 'mp3' },
    { format: 'aac', ext: 'm4a', codec: 'aac' },
    { format: 'wav', ext: 'wav', codec: 'pcm_s16le' },
    { format: 'opus', ext: 'opus', codec: 'opus' },
  ];
  for (const c of cases) {
    const req: JobRequest = { kind: 'audio', itemIds: ids, audio: { ...DEFAULT_AUDIO, format: c.format, wavPreset: 'cd', bitrateKbps: 128, sources: [...sources] }, destination: { mode: 'beside' }, collision: 'skip', deleteSource: false };
    const start = await b.startJob(req, false);
    assert.ok(start.ok, start.error ?? '');
    const job = await waitJob(b, start.jobId as string);
    assert.equal(job.state, 'done', `${c.format} : ${JSON.stringify(job.items.map((i) => [i.message, i.errorDetails?.slice(-300)]))}`);
    for (const base of ['Prise 24 bits', 'Avec pochette', 'Concert']) {
      const out = path.join(dir, `${base}.${c.ext}`);
      const r = spawnSync(ffprobe, ['-v', 'error', '-select_streams', 'a:0', '-show_entries', 'stream=codec_name,sample_rate', '-of', 'csv=p=0', out]);
      const [codec, rate] = r.stdout.toString().trim().split(',');
      assert.equal(codec, c.codec, `${out}`);
      if (c.format === 'wav') assert.equal(rate, '44100');
    }
    // nettoyage pour le format suivant qui partage parfois l'extension
    for (const base of ['Prise 24 bits', 'Avec pochette', 'Concert']) rmSync(path.join(dir, `${base}.${c.ext}`), { force: true });
    if (c.format === 'mp3') {
      /* vérifié ci-dessous */
    }
  }
  // FLAC → ALAC et AIFF → FLAC : pochette conservée, 24 bits gardés.
  for (const f of ['alac', 'flac'] as const) {
    const req: JobRequest = { kind: 'audio', itemIds: ids, audio: { ...DEFAULT_AUDIO, format: f, sources: [...sources] }, destination: { mode: 'folder', folder: (dialogQueue = [[path.join(tmp, 'Sorties ' + f)]], mkdirSync(path.join(tmp, 'Sorties ' + f)), await b.pickOutputFolder()) as string }, collision: 'skip', deleteSource: false };
    const start = await b.startJob(req, false);
    const job = await waitJob(b, start.jobId as string);
    assert.equal(job.state, 'done', `${f} : ${JSON.stringify(job.items.map((i) => [i.message, i.errorDetails?.slice(-300)]))}`);
    const ext = f === 'alac' ? 'm4a' : 'flac';
    if (f === 'flac') {
      assert.equal(job.items.find((i) => i.name === 'Avec pochette.flac')?.status, 'skipped', 'FLAC → FLAC inutile');
    }
    const cover = f === 'flac' ? 'video' : spawnSync(ffprobe, ['-v', 'error', '-show_entries', 'stream=codec_type,codec_name', '-of', 'csv=p=0', path.join(tmp, 'Sorties ' + f, `Avec pochette.${ext}`)]).stdout.toString();
    assert.match(cover, /video/, `pochette ${f}`);
    const bits = spawnSync(ffprobe, ['-v', 'error', '-select_streams', 'a:0', '-show_entries', 'stream=bits_per_raw_sample', '-of', 'csv=p=0', path.join(tmp, 'Sorties ' + f, `Prise 24 bits.${ext}`)]).stdout.toString().trim();
    assert.equal(bits, '24', `24 bits ${f}`);
  }
});

test('MKV multipiste : une langue audio, sous-titres au choix, incrustation, chemin piégé', async (t) => {
  if (!ffmpeg) return t.skip('FFmpeg absent');
  const b = new Backend(platform());
  const dir = path.join(tmp, "Films [VO], l'été; 2:1");
  mkdirSync(dir);
  const srt = (txt: string) => `1\n00:00:00,000 --> 00:00:02,500\n${txt}\n`;
  writeFileSync(path.join(tmp, 'fr.srt'), srt('Bonjour'));
  writeFileSync(path.join(tmp, 'en.srt'), srt('Hello'));
  const src = path.join(dir, 'Épisode 1 [multi].mkv');
  gen([
    '-f', 'lavfi', '-i', 'testsrc2=size=640x360:rate=25:duration=3',
    '-f', 'lavfi', '-i', 'sine=frequency=300:duration=3',
    '-f', 'lavfi', '-i', 'sine=frequency=600:duration=3',
    '-i', path.join(tmp, 'fr.srt'), '-i', path.join(tmp, 'en.srt'),
    '-map', '0:v', '-map', '1:a', '-map', '2:a', '-map', '3:s', '-map', '4:s',
    '-c:v', 'libx264', '-preset', 'ultrafast', '-c:a', 'aac', '-c:s', 'srt',
    '-metadata:s:a:0', 'language=fre', '-metadata:s:a:1', 'language=eng',
    '-metadata:s:s:0', 'language=fre', '-metadata:s:s:1', 'language=eng', src,
  ]);
  dialogQueue = [[src]];
  const add = await b.pickFiles('video');
  const item = add.items[0];
  assert.equal(item.probe?.audioTracks.length, 2);
  assert.equal(item.probe?.audioTracks[1].language, 'eng');
  const streams = (f: string) =>
    spawnSync(ffprobe, ['-v', 'error', '-show_entries', 'stream=codec_type:stream_tags=language', '-of', 'csv=p=0', f]).stdout.toString().trim().split('\n');

  // 1) Audio anglais seul + sous-titres français activables, en MP4.
  // Débit bas : la vidéo de test est déjà légère, un débit plus haut la ferait grossir (conversion ignorée).
  const base = { ...defaultVideoSettings('youtube'), videoBitrateMbps: 0.2 };
  let req: JobRequest = { kind: 'video', itemIds: [item.id], video: { ...base, audioSelection: { mode: 'one', key: 'eng' }, subtitleSelection: { mode: 'one', key: 'fre' } }, destination: { mode: 'beside' }, collision: 'replace', deleteSource: false };
  let job = await waitJob(b, (await b.startJob(req, false)).jobId as string, 120_000);
  assert.equal(job.state, 'done', JSON.stringify(job.items.map((i) => [i.message, i.errorDetails?.slice(-400)])));
  const out = path.join(dir, 'Épisode 1 [multi]_youtube.mp4');
  assert.deepEqual(streams(out).sort(), ['audio,eng', 'subtitle,fre', 'video,und'].sort());

  // 2) Sans sous-titres.
  req = { ...req, video: { ...base, audioSelection: { mode: 'one', key: 'fre' }, subtitleSelection: { mode: 'none' } } };
  job = await waitJob(b, (await b.startJob(req, false)).jobId as string, 120_000);
  assert.equal(job.state, 'done');
  assert.deepEqual(streams(out).sort(), ['audio,fre', 'video,und'].sort());

  // 3) Sous-titres anglais incrustés (chemin avec [ ] , ; ' : et accents).
  req = { ...req, video: { ...base, subtitleSelection: { mode: 'one', key: 'eng' }, burnSubtitles: true } };
  job = await waitJob(b, (await b.startJob(req, false)).jobId as string, 120_000);
  assert.equal(job.state, 'done', JSON.stringify(job.items.map((i) => [i.message, i.errorDetails?.slice(-600)])));
  assert.ok(!streams(out).some((l) => l.startsWith('subtitle')), 'aucune piste de sous-titres : ils sont dans l’image');
  assert.ok(job.items[0].notes.some((n) => n.includes('incrustés')));
});

test('conversions audio inutiles ignorées, WAV 24 bits → CD autorisé avec suffixe', async (t) => {
  if (!ffmpeg) return t.skip('FFmpeg absent');
  const b = new Backend(platform());
  const dir = path.join(tmp, 'Inutiles');
  mkdirSync(dir);
  gen(['-f', 'lavfi', '-i', 'sine=duration=2', '-c:a', 'pcm_s16le', path.join(dir, 'cd.wav')]);
  gen(['-f', 'lavfi', '-i', 'sine=duration=2:sample_rate=96000', '-c:a', 'pcm_s24le', path.join(dir, 'hd.wav')]);
  gen(['-f', 'lavfi', '-i', 'sine=duration=2', path.join(dir, 'déjà.mp3')]);
  dialogQueue = [[dir]];
  const add = await b.pickFolder('audio', false, ['wav', 'mp3']);
  const ids = add.items.map((i) => i.id);
  const plan = (audio: Partial<typeof DEFAULT_AUDIO>) =>
    b.planJob({ kind: 'audio', itemIds: ids, audio: { ...DEFAULT_AUDIO, sources: ['wav', 'mp3'], ...audio }, destination: { mode: 'beside' }, collision: 'skip', deleteSource: false });
  const mp3 = await plan({ format: 'mp3' });
  assert.equal(mp3.entries.find((e) => e.name === 'déjà.mp3')?.action, 'skip-useless');
  const studio = await plan({ format: 'wav', wavPreset: 'studio' });
  assert.equal(studio.entries.find((e) => e.name === 'cd.wav')?.action, 'skip-useless', 'pas de suréchantillonnage inutile');
  const cd = await plan({ format: 'wav', wavPreset: 'cd' });
  assert.equal(cd.entries.find((e) => e.name === 'cd.wav')?.action, 'skip-useless');
  const hd = cd.entries.find((e) => e.name === 'hd.wav');
  assert.equal(hd?.action, 'convert');
  assert.ok(hd?.output?.endsWith('hd_CD.wav'));
  const start = await b.startJob({ kind: 'audio', itemIds: ids, audio: { ...DEFAULT_AUDIO, sources: ['wav', 'mp3'], format: 'wav', wavPreset: 'cd' }, destination: { mode: 'beside' }, collision: 'skip', deleteSource: false }, false);
  const job = await waitJob(b, start.jobId as string);
  assert.equal(job.counts.done, 2); // hd.wav et déjà.mp3 → WAV CD
  assert.equal(job.counts.skipped, 1);
  const info = spawnSync(ffprobe, ['-v', 'error', '-show_entries', 'stream=sample_rate,codec_name', '-of', 'csv=p=0', path.join(dir, 'hd_CD.wav')]).stdout.toString().trim();
  assert.equal(info, 'pcm_s16le,44100');
});

test('audio en parallèle : plusieurs fichiers à la fois, pause, reprise et annulation propres', async (t) => {
  if (!ffmpeg) return t.skip('FFmpeg absent');
  process.env.ATELIER_AUDIO_CONCURRENCY = '3';
  try {
    const b = new Backend(platform());
    const dir = path.join(tmp, 'Parallèle');
    mkdirSync(dir);
    for (let i = 1; i <= 6; i++) gen(['-f', 'lavfi', '-i', `sine=frequency=${200 + i * 50}:duration=240`, path.join(dir, `Piste ${i}.wav`)]);
    dialogQueue = [[dir]];
    const add = await b.pickFolder('audio', false);
    const req: JobRequest = { kind: 'audio', itemIds: add.items.map((i) => i.id), audio: { ...DEFAULT_AUDIO, quality: 0 }, destination: { mode: 'beside' }, collision: 'skip', deleteSource: false };
    const start = await b.startJob(req, false);
    let maxRunning = 0;
    for (let i = 0; i < 40; i++) {
      const j = b.getJobs().find((x) => x.id === start.jobId);
      maxRunning = Math.max(maxRunning, j?.counts.running ?? 0);
      if (maxRunning >= 2) break;
      await new Promise((r) => setTimeout(r, 50));
    }
    assert.ok(maxRunning >= 2, `conversions simultanées : ${maxRunning}`);
    b.pauseJob(start.jobId);
    const paused = b.getJobs().find((x) => x.id === start.jobId);
    assert.equal(paused?.state, 'paused');
    await new Promise((r) => setTimeout(r, 300));
    b.resumeJob(start.jobId);
    const job = await waitJob(b, start.jobId as string, 180_000);
    assert.equal(job.state, 'done');
    assert.equal(job.counts.done, 6);
    assert.equal(job.concurrency, 3);
    assert.ok(!readdirSync(dir).some((f) => f.includes('atelier-partiel')));

    // Annulation pendant que plusieurs fichiers tournent.
    const again = await b.startJob({ ...req, collision: 'replace' }, false);
    await new Promise((r) => setTimeout(r, 400));
    b.cancelJob(again.jobId);
    const cancelled = await waitJob(b, again.jobId as string);
    assert.equal(cancelled.state, 'cancelled');
    assert.ok(!readdirSync(dir).some((f) => f.includes('atelier-partiel')), 'aucun fichier partiel');
    assert.equal(readdirSync(dir).filter((f) => f.endsWith('.mp3')).length, 6, 'les MP3 existants ne sont pas perdus');
  } finally {
    delete process.env.ATELIER_AUDIO_CONCURRENCY;
  }
});

test('édition : découpes audio exactes ou sans réencodage, vidéo rapide et précise, formats réseaux, GIF, aperçus', async (t) => {
  if (!ffmpeg) return t.skip('FFmpeg absent');
  const b = new Backend(platform());
  const dir = path.join(tmp, "Édition [test] l'été");
  mkdirSync(dir);
  const wav = path.join(dir, 'Prise 24 bits.wav');
  const mp3 = path.join(dir, 'Démo.mp3');
  const mov = path.join(dir, 'Clip, concert.mov');
  gen(['-f', 'lavfi', '-i', 'sine=frequency=440:duration=20:sample_rate=48000', '-c:a', 'pcm_s24le', wav]);
  gen(['-f', 'lavfi', '-i', 'sine=frequency=440:duration=20', '-c:a', 'libmp3lame', '-b:a', '192k', mp3]);
  gen(['-f', 'lavfi', '-i', 'testsrc2=size=1920x1080:rate=25:duration=12', '-f', 'lavfi', '-i', 'sine=duration=12', '-c:v', 'libx264', '-preset', 'ultrafast', '-g', '25', '-c:a', 'aac', '-shortest', mov]);

  const probeOut = (f: string, entries: string) =>
    spawnSync(ffprobe, ['-v', 'error', '-show_entries', entries, '-of', 'csv=p=0', f]).stdout.toString().trim();
  const run = async (file: string, edit: Partial<import('../src/shared/types').EditSettings>) => {
    const opened = await b.openForEdit(file);
    const item = opened.items[0];
    assert.equal(item.status, 'ready', item.message ?? '');
    const req: JobRequest = {
      kind: item.kind, itemIds: [item.id], destination: { mode: 'beside' }, collision: 'unique', deleteSource: false,
      edit: { start: 2, end: 7.5, format: 'same', frame: 'blur', precise: true, gifWidth: 320, gifFps: 10, ...edit },
    };
    const plan = await b.planJob(req);
    assert.equal(plan.counts.convert, 1, JSON.stringify(plan.entries.map((e) => e.message)));
    const start = await b.startJob(req, false);
    assert.ok(start.ok, start.error ?? '');
    const job = await waitJob(b, start.jobId as string, 180_000);
    assert.equal(job.state, 'done', JSON.stringify(job.items.map((i) => [i.message, i.errorDetails?.slice(-400)])));
    return { item, out: job.items[0].output as string, job };
  };

  // WAV 24 bits : découpe exacte à l'échantillon, résolution conservée.
  const a = await run(wav, {});
  assert.ok(a.out.endsWith('Prise 24 bits_extrait.wav'));
  assert.equal(probeOut(a.out, 'stream=codec_name,sample_rate'), 'pcm_s24le,48000');
  assert.ok(Math.abs(Number(probeOut(a.out, 'format=duration')) - 5.5) < 0.01);
  // Waveform et image : data URL.
  assert.match((await b.getWaveform(a.item.id)) ?? '', /^data:image\/png;base64,/);

  // MP3 : copie sans réencodage.
  const m = await run(mp3, { start: 1, end: 11 });
  assert.equal(probeOut(m.out, 'stream=codec_name'), 'mp3');
  assert.ok(Math.abs(Number(probeOut(m.out, 'format=duration')) - 10) < 0.1);
  assert.ok(m.job.items[0].notes.some((n) => n.includes('pas réencodé')));

  // Vidéo : rapide (copie) puis précise (réencodage).
  const fast = await run(mov, { precise: false });
  assert.ok(fast.out.endsWith('Clip, concert_extrait.mov'));
  assert.equal(probeOut(fast.out, 'stream=codec_name').split('\n')[0], 'h264');
  const precise = await run(mov, { precise: true });
  assert.ok(precise.out.endsWith('_extrait.mp4'));
  assert.ok(Math.abs(Number(probeOut(precise.out, 'format=duration')) - 5.5) < 0.15);
  assert.match((await b.getFrame(precise.item.id, 3)) ?? '', /^data:image\/jpeg;base64,/);

  // Formats réseaux : vertical flouté, carré recadré, paysage avec bandes.
  for (const [format, frame, dims] of [['vertical', 'blur', '1080,1920'], ['square', 'crop', '1080,1080'], ['landscape', 'bars', '1920,1080']] as const) {
    const r = await run(mov, { format, frame, end: 4 });
    assert.equal(probeOut(r.out, 'stream=width,height').split('\n')[0], dims, `${format}`);
  }
  // GIF.
  const g = await run(mov, { format: 'gif', end: 4.5 });
  assert.ok(g.out.endsWith('Clip, concert.gif'));
  assert.equal(probeOut(g.out, 'stream=codec_name,width'), 'gif,320');

  // Une édition sans découpe ni changement de format est refusée.
  const opened = await b.openForEdit(wav);
  const plan = await b.planJob({ kind: 'audio', itemIds: [opened.items[0].id], destination: { mode: 'beside' }, collision: 'unique', deleteSource: false, edit: { start: 0, end: 20, format: 'same', frame: 'blur', precise: true, gifWidth: 320, gifFps: 10 } });
  assert.equal(plan.counts.convert, 0);
});

test('« Pistes seulement » : copie sans réencodage, pistes retirées, DTS converti en MP4, vidéos qui grossiraient ignorées', async (t) => {
  if (!ffmpeg) return t.skip('FFmpeg absent');
  const b = new Backend(platform());
  const dir = path.join(tmp, 'Pistes seulement');
  mkdirSync(dir);
  const film = path.join(dir, 'Film (VF, VO).mkv');
  writeFileSync(path.join(tmp, 'vf.srt'), '1\n00:00:01,000 --> 00:00:03,000\nBonjour\n');
  writeFileSync(path.join(tmp, 'vo.srt'), '1\n00:00:01,000 --> 00:00:03,000\nHello\n');
  gen([
    '-f', 'lavfi', '-i', 'testsrc2=size=1280x720:rate=25:duration=8',
    '-f', 'lavfi', '-i', 'sine=frequency=300:duration=8', '-f', 'lavfi', '-i', 'sine=frequency=500:duration=8',
    '-i', path.join(tmp, 'vf.srt'), '-i', path.join(tmp, 'vo.srt'),
    '-map', '0', '-map', '1', '-map', '2', '-map', '3', '-map', '4',
    '-c:v', 'libx264', '-preset', 'ultrafast', '-b:v', '3M',
    '-c:a:0', 'ac3', '-ac:a:0', '6', '-b:a:0', '448k', '-c:a:1', 'dca', '-strict', '-2', '-c:s', 'srt',
    '-metadata:s:a:0', 'language=fre', '-metadata:s:a:1', 'language=eng', '-metadata:s:s:0', 'language=fre', '-metadata:s:s:1', 'language=eng',
    film,
  ]);
  dialogQueue = [[film]];
  const add = await b.pickFiles('video');
  const item = add.items[0];
  assert.equal(item.status, 'ready');
  assert.equal(item.probe?.audioTracks.length, 2);
  const streams = (f: string) =>
    spawnSync(ffprobe, ['-v', 'error', '-show_entries', 'stream=codec_type,codec_name:stream_tags=language', '-of', 'csv=p=0', f]).stdout.toString().trim().split('\n').map((l) => l.replace(/,+$/, ''));

  // MP4, VF seule, sans sous-titres : vidéo copiée, AC3 copié, rien d'autre.
  const base = { ...defaultVideoSettings('remux') };
  const req = (video: typeof base): JobRequest => ({ kind: 'video', itemIds: [item.id], video, destination: { mode: 'beside' }, collision: 'unique', deleteSource: false });
  let start = await b.startJob(req({ ...base, audioSelection: { mode: 'one', key: 'fre' }, subtitleSelection: { mode: 'none' } }), false);
  assert.ok(start.ok, start.error ?? '');
  let job = await waitJob(b, start.jobId as string);
  assert.equal(job.state, 'done', JSON.stringify(job.items.map((i) => [i.message, i.errorDetails?.slice(-300)])));
  const out1 = job.items[0].output as string;
  assert.ok(out1.endsWith('Film (VF, VO)_pistes.mp4'));
  assert.deepEqual(streams(out1), ['h264,video,und', 'ac3,audio,fre']);
  assert.ok(statSync(out1).size < statSync(film).size, 'plus léger que l’original');

  // MP4, VO (DTS) : convertie en AAC, sous-titre texte anglais gardé en mov_text.
  start = await b.startJob(req({ ...base, audioSelection: { mode: 'one', key: 'eng' }, subtitleSelection: { mode: 'one', key: 'eng' } }), false);
  job = await waitJob(b, start.jobId as string);
  assert.equal(job.state, 'done', JSON.stringify(job.items.map((i) => [i.message, i.errorDetails?.slice(-300)])));
  assert.deepEqual(streams(job.items[0].output as string), ['h264,video,und', 'aac,audio,eng', 'mov_text,subtitle,eng']);
  assert.ok(job.items[0].notes.some((n) => n.includes('DTS')));

  // MKV en gardant tout : rien à retirer → ignoré comme inutile.
  const plan = await b.planJob(req({ ...base, container: 'mkv' }));
  assert.equal(plan.counts.convert, 0);
  assert.equal(plan.entries[0].action, 'skip-useless');

  // Réencodage plus lourd que la source : ignoré, sauf passage vers H.264 (compatibilité).
  const light = path.join(dir, 'Déjà compressée.mp4');
  gen(['-f', 'lavfi', '-i', 'testsrc2=size=1280x720:rate=25:duration=6', '-c:v', 'libx265', '-preset', 'ultrafast', '-b:v', '600k', '-tag:v', 'hvc1', light]);
  dialogQueue = [[light]];
  const lightItem = (await b.pickFiles('video')).items[0];
  const archive = await b.planJob({ kind: 'video', itemIds: [lightItem.id], video: defaultVideoSettings('archive'), destination: { mode: 'beside' }, collision: 'unique', deleteSource: false });
  assert.equal(archive.entries[0].action, 'skip-useless');
  assert.match(archive.entries[0].message ?? '', /Déjà compressée/);
  const youtube = await b.planJob({ kind: 'video', itemIds: [lightItem.id], video: defaultVideoSettings('youtube'), destination: { mode: 'beside' }, collision: 'unique', deleteSource: false });
  assert.equal(youtube.entries[0].action, 'convert', 'HEVC → H.264 reste permis');
});

test('audio et vidéo en parallèle, file par type, nom de sortie personnalisé', async (t) => {
  if (!ffmpeg) return t.skip('FFmpeg absent');
  const b = new Backend(platform());
  const dir = path.join(tmp, 'Parallèle AV');
  mkdirSync(dir);
  const clip = path.join(dir, 'Concert (live).mov');
  gen(['-f', 'lavfi', '-i', 'testsrc2=size=1280x720:rate=25:duration=30', '-f', 'lavfi', '-i', 'sine=duration=30', '-c:v', 'libx264', '-preset', 'ultrafast', '-b:v', '30M', '-c:a', 'aac', '-shortest', clip]);
  for (const n of ['Voix 1', 'Voix 2']) gen(['-f', 'lavfi', '-i', 'sine=frequency=330:duration=120', path.join(dir, `${n}.wav`)]);

  dialogQueue = [[clip]];
  const v = (await b.pickFiles('video')).items[0];
  dialogQueue = [[path.join(dir, 'Voix 1.wav'), path.join(dir, 'Voix 2.wav')]];
  const wavs = (await b.pickFiles('audio')).items;
  const video = { ...defaultVideoSettings('custom'), codec: 'h264' as const, encoder: 'software' as const, videoBitrateMbps: 2 };
  const vReq: JobRequest = { kind: 'video', itemIds: [v.id], video, destination: { mode: 'beside' }, collision: 'unique', deleteSource: false, naming: { name: 'Mon concert' } };
  const aReq: JobRequest = { kind: 'audio', itemIds: wavs.map((w) => w.id), audio: DEFAULT_AUDIO, destination: { mode: 'beside' }, collision: 'unique', deleteSource: false, naming: { prefix: '[Podcast] ', suffix: ' (MP3)' } };

  const v1 = await b.startJob(vReq, false);
  const v2 = await b.startJob({ ...vReq, naming: undefined }, false);
  const a1 = await b.startJob(aReq, false);
  assert.ok(v1.ok && v2.ok && a1.ok);
  let both = false;
  let secondVideoWaited = false;
  for (let i = 0; i < 200 && !both; i++) {
    const jobs = b.getJobs();
    const st = (id?: string) => jobs.find((j) => j.id === id)?.state;
    if (st(v1.jobId) === 'running' && st(a1.jobId) === 'running') both = true;
    if (st(v1.jobId) === 'running' && st(v2.jobId) === 'queued') secondVideoWaited = true;
    await new Promise((r) => setTimeout(r, 25));
  }
  assert.ok(both, 'une tâche audio démarre pendant que la vidéo tourne');
  assert.ok(secondVideoWaited, 'la deuxième tâche vidéo attend la première');
  const [jv1, jv2, ja] = [await waitJob(b, v1.jobId as string), await waitJob(b, v2.jobId as string), await waitJob(b, a1.jobId as string)];
  for (const j of [jv1, jv2, ja]) assert.equal(j.state, 'done', JSON.stringify(j.items.map((i) => i.errorDetails?.slice(-300))));
  assert.equal(path.basename(jv1.items[0].output as string), 'Mon concert.mp4');
  assert.equal(path.basename(jv2.items[0].output as string), 'Concert (live)_h264.mp4');
  assert.deepEqual(ja.items.map((i) => path.basename(i.output as string)).sort(), ['[Podcast] Voix 1 (MP3).mp3', '[Podcast] Voix 2 (MP3).mp3']);

  // Le nom complet ne s'applique pas à un lot ; un nom identique à la source est refusé.
  const same = await b.planJob({ ...vReq, video: { ...video, container: 'mov' }, naming: { name: 'Concert (live)' } });
  assert.equal(same.entries[0].action, 'error');
  assert.match(same.entries[0].message ?? '', /même nom que la source/);
});
