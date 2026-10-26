import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildAudioArgs, buildVideoArgs, resolveEncoder } from '../src/main/ffmpeg/args';
import { parseEncoderList, parseVersion } from '../src/main/ffmpeg/environment';
import { parseProbe } from '../src/main/ffmpeg/probe';
import { ProgressParser } from '../src/main/ffmpeg/runner';
import { summarizeEstimates } from '../src/shared/estimate';
import { computeTargetSize, DEFAULT_AUDIO, defaultVideoSettings, suggestYoutubeBitrate } from '../src/shared/profiles';
import type { MediaItem } from '../src/shared/types';
import type { Environment, ProbeInfo } from '../src/shared/types';
import { validateJobRequest } from '../src/shared/validate';

const env = (hw: boolean): Environment => ({
  ok: true, ffmpegPath: '/x/ffmpeg', ffprobePath: '/x/ffprobe', ffmpegVersion: '7', versionLine: '', platform: 'darwin', arch: 'arm64',
  customPath: null, error: null, checkedAt: 0,
  encoders: Object.fromEntries(
    [['h264_videotoolbox', hw, true], ['hevc_videotoolbox', hw, true], ['libx264', true, false], ['libx265', true, false], ['aac', true, false], ['libmp3lame', true, false]]
      .map(([n, u, h]) => [n as string, { name: n as string, listed: u as boolean, usable: u as boolean, hardware: h as boolean }]),
  ),
});

const withTracks = (p: ProbeInfo): ProbeInfo => ({ ...p, audioTracks: p.audioTracks.length ? p.audioTracks : p.audioIndexes.map((index) => ({ index, codec: 'aac', channels: 2 })) });
const probe = (o: Partial<ProbeInfo> = {}): ProbeInfo => withTracks({
  durationSec: 10, formatName: 'mov', videoIndex: 0, videoCodec: 'h264', width: 3840, height: 2160, displayWidth: 3840, displayHeight: 2160,
  pixFmt: 'yuv420p', sampleAspect: 1, fps: 30, extraVideoStreams: 0, audioIndexes: [1], audioCodecs: ['pcm_s16le'], subtitles: [], chapters: 0,
  videoBitrate: null, totalBitrate: null, audioSampleRate: 44100, audioChannels: 2, audioBits: 16, audioBitrate: 1411200, coverIndex: null, coverCodec: null,
  dataStreams: 0, attachments: 0, audioTracks: [], ...o,
}) as ProbeInfo;

test('commande audio de référence : libmp3lame -q:a 2, chemins en arguments séparés', () => {
  const src = "/Users/Alex/Music/Mon Groupe/Sessions 2025/L'été (take 1).wav";
  const { args } = buildAudioArgs(src, '/tmp/out.mp3', DEFAULT_AUDIO, undefined, null);
  assert.equal(args[args.indexOf('-i') + 1], `file:${src}`);
  assert.deepEqual(args.slice(args.indexOf('-c:a'), args.indexOf('-c:a') + 4), ['-c:a', 'libmp3lame', '-q:a', '2']);
  assert.ok(args.includes('-n'), 'ne doit jamais écraser');
  assert.ok(args.includes('-nostdin'));
  assert.equal(args.at(-1), 'file:/tmp/out.mp3');
});

test('profil YouTube : h264_videotoolbox, 20M, yuv420p, high, 5.1, AAC 384k 48 kHz, sans redimensionnement', () => {
  const { args, encoder } = buildVideoArgs('/a.mov', '/b.mp4', defaultVideoSettings('youtube'), probe(), env(true));
  assert.equal(encoder, 'h264_videotoolbox');
  const s = args.join(' ');
  for (const frag of ['-c:v h264_videotoolbox', '-b:v 20000k', '-maxrate 20000k', '-bufsize 40000k', '-pix_fmt yuv420p', '-profile:v high', '-level:v 5.1', '-c:a aac', '-b:a 384k', '-ar 48000', '-map_metadata 0']) {
    assert.ok(s.includes(frag), frag);
  }
  assert.ok(!args.includes('-vf'), 'pas de scale');
});

test('profil Archivage : HEVC 4M, AAC 128k, 4K → 1920x1080', () => {
  const { args } = buildVideoArgs('/a.mov', '/b.mp4', defaultVideoSettings('archive'), probe(), env(true));
  const s = args.join(' ');
  assert.ok(s.includes('-c:v hevc_videotoolbox'));
  assert.ok(s.includes('-b:v 4000k') && s.includes('-bufsize 8000k'));
  assert.ok(s.includes('-b:a 128k'));
  assert.ok(s.includes('scale=1920:1080'));
  assert.ok(s.includes('-tag:v hvc1'));
});

test('repli logiciel quand VideoToolbox est absent, avec message', () => {
  const c = resolveEncoder(env(false), 'hevc', 'auto');
  assert.equal(c.encoder, 'libx265');
  assert.match(c.fallbackNote ?? '', /indisponible/);
  assert.throws(() => resolveEncoder(env(false), 'h264', 'hardware'), /n’est pas disponible/);
});

test('sans piste audio : aucun argument audio', () => {
  const { args, notes } = buildVideoArgs('/a.mov', '/b.mp4', defaultVideoSettings('youtube'), probe({ audioIndexes: [], audioCodecs: [] }), env(true));
  assert.ok(!args.includes('-c:a'));
  assert.ok(notes.some((n) => n.includes('sans piste audio')));
});

test('sous-titres : texte converti en mov_text, PGS omis et signalé', () => {
  const p = probe({ subtitles: [{ index: 2, codec: 'subrip', bitmap: false }, { index: 3, codec: 'hdmv_pgs_subtitle', bitmap: true }] });
  const { args, notes } = buildVideoArgs('/a.mkv', '/b.mp4', defaultVideoSettings('youtube'), p, env(true));
  assert.ok(args.join(' ').includes('-map 0:2'));
  assert.ok(!args.join(' ').includes('-map 0:3'));
  assert.ok(args.join(' ').includes('-c:s mov_text'));
  assert.ok(notes.some((n) => n.includes('hdmv_pgs_subtitle')));
});

test('dimensions cibles : pas d’agrandissement, portrait, valeurs paires', () => {
  assert.deepEqual(computeTargetSize(3840, 2160, '1080p'), { width: 1920, height: 1080, scaled: true, downscaled: true });
  assert.deepEqual(computeTargetSize(1280, 720, '1080p'), { width: 1280, height: 720, scaled: false, downscaled: false });
  assert.deepEqual(computeTargetSize(2160, 3840, '1080p'), { width: 1080, height: 1920, scaled: true, downscaled: true });
  const odd = computeTargetSize(4096, 1716, '1080p');
  assert.ok(odd.width <= 1920 && odd.height <= 1080 && odd.width % 2 === 0 && odd.height % 2 === 0);
  assert.deepEqual(computeTargetSize(721, 405, 'source'), { width: 720, height: 404, scaled: true, downscaled: false });
});

test('bitrate suggéré selon la résolution', () => {
  // Recommandations officielles YouTube (SDR).
  assert.equal(suggestYoutubeBitrate(3840, 2160, 30).mbps, 40);
  assert.equal(suggestYoutubeBitrate(3840, 2160, 60).mbps, 60);
  assert.equal(suggestYoutubeBitrate(1920, 1080, 25).mbps, 8);
  assert.equal(suggestYoutubeBitrate(1080, 1920, 60).mbps, 12);
});

test('analyse du flux -progress', () => {
  const samples: { t: number | null; sp: number | null; end: boolean }[] = [];
  const p = new ProgressParser();
  p.push('frame=10\nout_time_us=1500000\nspeed=2.5x\nprogress=cont', (s) => samples.push({ t: s.outTimeSec, sp: s.speed, end: s.ended }));
  p.push('inue\nout_time_us=N/A\nout_time=00:01:02.500000\nspeed=N/A\nprogress=end\n', (s) => samples.push({ t: s.outTimeSec, sp: s.speed, end: s.ended }));
  assert.deepEqual(samples, [{ t: 1.5, sp: 2.5, end: false }, { t: 62.5, sp: null, end: true }]);
});

test('analyse de ffprobe : rotation, pochette ignorée', () => {
  const json = JSON.stringify({
    format: { duration: '12.5', format_name: 'mov,mp4' },
    streams: [
      { index: 0, codec_type: 'video', codec_name: 'mjpeg', width: 600, height: 600, disposition: { attached_pic: 1 } },
      { index: 1, codec_type: 'video', codec_name: 'hevc', width: 3840, height: 2160, sample_aspect_ratio: '1:1', side_data_list: [{ rotation: -90 }] },
      { index: 2, codec_type: 'audio', codec_name: 'aac' },
    ],
  });
  const p = parseProbe(json);
  assert.equal(p.videoIndex, 1);
  assert.equal(p.displayWidth, 2160);
  assert.equal(p.displayHeight, 3840);
  assert.deepEqual(p.audioIndexes, [2]);
});

test('version et liste d’encodeurs', () => {
  assert.equal(parseVersion('ffmpeg version 7.1.1 Copyright (c) 2000-2025').version, '7.1.1');
  const list = parseEncoderList(' V....D h264_videotoolbox    VideoToolbox H.264 Encoder (codec h264)\n A....D aac   AAC\n');
  assert.ok(list.has('h264_videotoolbox') && list.has('aac'));
});

test('validation des requêtes venant de l’interface', () => {
  assert.throws(() => validateJobRequest({ kind: 'audio', itemIds: [], destination: { mode: 'beside' }, collision: 'skip', deleteSource: false }));
  assert.throws(() => validateJobRequest({ kind: 'audio', itemIds: ['a'], audio: { ...DEFAULT_AUDIO, quality: 3 }, destination: { mode: 'beside' }, collision: 'skip', deleteSource: false }));
  assert.throws(() => validateJobRequest({ kind: 'audio', itemIds: ['a'], audio: { ...DEFAULT_AUDIO, quality: 2 }, destination: { mode: 'folder', folder: 'relatif' }, collision: 'skip', deleteSource: false }));
  const ok = validateJobRequest({ kind: 'audio', itemIds: ['a'], audio: { ...DEFAULT_AUDIO, quality: 2 }, destination: { mode: 'beside' }, collision: 'skip', deleteSource: true });
  assert.equal(ok.deleteSource, true);
});

test('estimation de taille : vidéo au débit cible, MP3 selon la qualité, alerte si plus lourd', () => {
  const item = (size: number, p: Partial<ProbeInfo>): MediaItem => ({
    id: String(size), kind: 'video', path: '/a', name: 'a', ext: 'mov', size, dir: '/', root: '/', relDir: '', status: 'ready', probe: probe(p),
  });
  // 60 s à 4 Mbit/s + 1 piste AAC 128 kbit/s ≈ 30,9 Mo
  const big = item(500_000_000, { durationSec: 60 });
  const est = summarizeEstimates([big], 'video', undefined, defaultVideoSettings('archive'));
  assert.ok(est.sizeOut > 30_000_000 && est.sizeOut < 32_000_000, String(est.sizeOut));
  assert.ok(est.delta !== null && est.delta < -0.9);
  const tiny = item(1_000_000, { durationSec: 60 });
  // H.264 → H.264 plus lourd : conversion inutile, ignorée.
  assert.equal(summarizeEstimates([tiny], 'video', undefined, defaultVideoSettings('youtube')).useless, 1);
  // HEVC → H.264 plus lourd : permis (compatibilité), mais signalé comme plus lourd.
  const tinyHevc = item(1_000_000, { durationSec: 60, videoCodec: 'hevc' });
  assert.equal(summarizeEstimates([tinyHevc], 'video', undefined, defaultVideoSettings('youtube')).larger, 1);
  // WAV 16 bits 44,1 kHz stéréo de 60 s → MP3 -q:a 2 ≈ 190 kbit/s ≈ 1,4 Mo
  const wav = { ...item(10_584_000, { durationSec: 60, videoIndex: null }), kind: 'audio' as const };
  const a = summarizeEstimates([wav], 'audio', DEFAULT_AUDIO);
  assert.ok(a.sizeOut > 1_400_000 && a.sizeOut < 1_500_000, String(a.sizeOut));
});

test('arguments audio : AAC Apple si disponible, FLAC 24 bits, WAV CD avec tramage, pochette', () => {
  const withAt = env(true);
  withAt.encoders.aac_at = { name: 'aac_at', listed: true, usable: true, hardware: false };
  const p24 = probe({ videoIndex: null, audioCodecs: ['pcm_s24le'], audioBits: 24, coverIndex: 2, coverCodec: 'mjpeg' });
  const aac = buildAudioArgs('/a.wav', '/b.m4a', { ...DEFAULT_AUDIO, format: 'aac', bitrateKbps: 256 }, p24, withAt).args.join(' ');
  assert.ok(aac.includes('-c:a aac_at -b:a 256k') && aac.includes('-f ipod') && aac.includes('-map 0:2 -c:v copy'));
  const flac = buildAudioArgs('/a.wav', '/b.flac', { ...DEFAULT_AUDIO, format: 'flac' }, p24, null).args.join(' ');
  assert.ok(flac.includes('-sample_fmt s32 -bits_per_raw_sample 24'));
  const cd = buildAudioArgs('/a.wav', '/b.wav', { ...DEFAULT_AUDIO, format: 'wav', wavPreset: 'cd' }, p24, null);
  assert.ok(cd.args.join(' ').includes('dither_method=triangular') && cd.notes.some((n) => n.includes('tramage')));
  const opus = buildAudioArgs('/a.mp3', '/b.opus', { ...DEFAULT_AUDIO, format: 'opus', bitrateKbps: 96 }, probe({ videoIndex: null, audioCodecs: ['mp3'], coverIndex: 1, coverCodec: 'mjpeg' }), null).args;
  assert.ok(opus.includes('-vn') && !opus.includes('-c:v'), 'pas de pochette en Opus');
});

test('pistes : une langue audio, un sous-titre, incrustation avec chemin à caractères spéciaux', () => {
  const p = probe({
    audioIndexes: [1, 2], audioCodecs: ['ac3', 'aac'],
    audioTracks: [
      { index: 1, codec: 'ac3', language: 'fre', channels: 6, isDefault: true },
      { index: 2, codec: 'aac', language: 'eng', channels: 2 },
    ],
    subtitles: [
      { index: 3, codec: 'subrip', bitmap: false, language: 'fre' },
      { index: 4, codec: 'hdmv_pgs_subtitle', bitmap: true, language: 'eng' },
    ],
  });
  const base = defaultVideoSettings('archive');
  const one = buildVideoArgs('/a.mkv', '/b.mp4', { ...base, audioSelection: { mode: 'one', key: 'eng' }, subtitleSelection: { mode: 'one', key: 'fre' } }, p, env(true)).args.join(' ');
  assert.ok(one.includes('-map 0:2') && !one.includes('-map 0:1 '), one);
  assert.ok(one.includes('-map 0:3') && one.includes('-c:s mov_text') && one.includes('-disposition:s:0 default'));
  const none = buildVideoArgs('/a.mkv', '/b.mp4', { ...base, subtitleSelection: { mode: 'none' } }, p, env(true)).args.join(' ');
  assert.ok(!none.includes('-c:s') && none.includes('-map 0:1') && none.includes('-map 0:2'));
  const weird = "/Films/L'été [VO], partie 1; fin:2.mkv";
  const burnText = buildVideoArgs(weird, '/b.mp4', { ...base, subtitleSelection: { mode: 'one', key: 'fre' }, burnSubtitles: true }, p, env(true)).args;
  const graph = burnText[burnText.indexOf('-filter_complex') + 1];
  assert.ok(graph.startsWith('[0:0]subtitles=filename=') && graph.includes('si=0') && graph.endsWith('[vout]'), graph);
  assert.ok(graph.includes("L\\\\\\'été \\[VO\\]\\, partie 1\\; fin\\\\:2.mkv"), graph);
  const burnPgs = buildVideoArgs('/a.mkv', '/b.mp4', { ...base, subtitleSelection: { mode: 'one', key: 'eng' }, burnSubtitles: true }, p, env(true)).args.join(' ');
  assert.ok(burnPgs.includes('[0:0][0:4]overlay=eof_action=pass,scale=1920:1080'));
});

test('nom de sortie : par défaut, nom complet (un seul fichier), texte avant/après (lot), noms refusés', async () => {
  const { outputFileName, namingProblem } = await import('../src/shared/profiles');
  const v = defaultVideoSettings('archive');
  assert.equal(outputFileName('Film.mkv', 'video', DEFAULT_AUDIO, v), 'Film_archive_1080p.mp4');
  assert.equal(outputFileName('Film.mkv', 'video', DEFAULT_AUDIO, v, { name: '  Mon film  ' }, true), 'Mon film.mp4');
  // Plusieurs fichiers : le nom complet est ignoré, le préfixe et le suffixe s'appliquent.
  assert.equal(outputFileName('Film.mkv', 'video', DEFAULT_AUDIO, v, { name: 'X', prefix: '[A] ', suffix: ' v2' }, false), '[A] Film v2.mp4');
  assert.equal(outputFileName('Piste.wav', 'audio', DEFAULT_AUDIO, v, { suffix: '' }, false), 'Piste.mp3');
  assert.equal(outputFileName('Piste.WAV', 'audio', { ...DEFAULT_AUDIO, format: 'wav', wavPreset: 'cd' }, v), 'Piste_CD.wav');
  assert.match(namingProblem('a/b') ?? '', /\//);
  assert.match(namingProblem('a:b') ?? '', /:/);
  assert.ok(namingProblem('', true));
  assert.ok(namingProblem('.cache', true));
  assert.equal(namingProblem('Été 2026 (final)', true), null);
  const base = { kind: 'video', itemIds: ['a'], video: v, destination: { mode: 'beside' }, collision: 'skip', deleteSource: false };
  assert.throws(() => validateJobRequest({ ...base, naming: { name: 'a/b' } }), /\//);
  assert.throws(() => validateJobRequest({ ...base, naming: { prefix: '.x' } }), /caché/);
  assert.deepEqual(validateJobRequest({ ...base, naming: { name: ' Mon film ', suffix: '' } }).naming, { name: 'Mon film', prefix: undefined, suffix: undefined });
});

test('FFmpeg : version ancienne signalée, réponse de Homebrew interprétée', async () => {
  const { ffmpegVersionAdvice } = await import('../src/shared/profiles');
  const { homebrewVersionFromPath, parseBrewOutdated } = await import('../src/main/ffmpeg/environment');
  assert.equal(ffmpegVersionAdvice('7.1.1'), null);
  assert.equal(ffmpegVersionAdvice('8.0'), null);
  assert.match(ffmpegVersionAdvice('5.1.2') ?? '', /ancien/);
  assert.match(ffmpegVersionAdvice('n4.4') ?? '', /ancien/);
  assert.equal(ffmpegVersionAdvice('N-115000-g1234abcd'), null, 'compilation git : pas de jugement');
  assert.equal(homebrewVersionFromPath('/opt/homebrew/Cellar/ffmpeg/7.1.1_3/bin/ffmpeg'), '7.1.1_3');
  assert.equal(homebrewVersionFromPath('/usr/local/bin/ffmpeg'), null);
  assert.deepEqual(parseBrewOutdated('{"formulae":[],"casks":[]}'), { outdated: false, installed: null, latest: null });
  assert.deepEqual(
    parseBrewOutdated('{"formulae":[{"name":"ffmpeg","installed_versions":["7.1.1_3"],"current_version":"8.0_1","pinned":false}],"casks":[]}'),
    { outdated: true, installed: '7.1.1_3', latest: '8.0_1' },
  );
  assert.equal(parseBrewOutdated('Error: not installed'), null);
});

test('conseils vidéo : ligne choisie d’après le petit côté, cadence élevée', async () => {
  const { videoAdviceFor } = await import('../src/shared/profiles');
  assert.equal(videoAdviceFor(1920, 1080).row.res, '1080p');
  assert.equal(videoAdviceFor(1080, 1920).row.res, '1080p', 'vidéo verticale');
  assert.equal(videoAdviceFor(1920, 800).row.res, '1080p', 'film cinémascope 1920×800');
  assert.equal(videoAdviceFor(3840, 1600).row.res, '4K');
  assert.equal(videoAdviceFor(1280, 720).row.res, '720p');
  assert.equal(videoAdviceFor(3840, 2160).row.res, '4K');
  assert.equal(videoAdviceFor(1920, 1080, 60).factor, 1.5);
});
