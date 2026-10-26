import { access, constants, realpath } from 'node:fs/promises';
import path from 'node:path';
import type { EncoderStatus, Environment, UpdateCheck } from '../../shared/types';
import { runCapture } from './process';

/**
 * Une application lancée depuis le Finder n'hérite pas du PATH du terminal :
 * on cherche donc aussi dans les emplacements Homebrew/MacPorts habituels.
 */
const COMMON_DIRS = ['/opt/homebrew/bin', '/usr/local/bin', '/opt/local/bin', '/usr/bin'];

export const TRACKED_ENCODERS: { name: string; hardware: boolean }[] = [
  { name: 'h264_videotoolbox', hardware: true },
  { name: 'hevc_videotoolbox', hardware: true },
  { name: 'libx264', hardware: false },
  { name: 'libx265', hardware: false },
  { name: 'aac', hardware: false },
  { name: 'libmp3lame', hardware: false },
  { name: 'aac_at', hardware: false },
  { name: 'libopus', hardware: false },
];

async function isExecutable(p: string): Promise<boolean> {
  try {
    await access(p, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

async function findBinary(name: string, preferredDir?: string): Promise<string | null> {
  const dirs = [
    ...(preferredDir ? [preferredDir] : []),
    ...COMMON_DIRS,
    ...(process.env.PATH ?? '').split(path.delimiter).filter(Boolean),
  ];
  const seen = new Set<string>();
  for (const dir of dirs) {
    if (seen.has(dir)) continue;
    seen.add(dir);
    const candidate = path.join(dir, name);
    if (await isExecutable(candidate)) return candidate;
  }
  return null;
}

export function parseVersion(output: string): { version: string | null; line: string | null } {
  const line = output.split(/\r?\n/).find((l) => l.startsWith('ffmpeg version')) ?? null;
  const m = line?.match(/^ffmpeg version (\S+)/);
  return { version: m ? m[1] : null, line };
}

export function parseEncoderList(output: string): Set<string> {
  const names = new Set<string>();
  for (const raw of output.split(/\r?\n/)) {
    const m = raw.match(/^\s*[VAS][A-Z.]{5}\s+(\S+)/);
    if (m) names.add(m[1]);
  }
  return names;
}

/** Encodage d'essai très court pour vérifier qu'un encodeur matériel fonctionne réellement. */
async function testEncoder(ffmpeg: string, encoder: string): Promise<{ ok: boolean; detail?: string }> {
  const r = await runCapture(
    ffmpeg,
    [
      '-hide_banner', '-nostdin', '-loglevel', 'error',
      '-f', 'lavfi', '-i', 'color=c=black:s=320x240:r=30:d=0.3',
      '-pix_fmt', 'yuv420p', '-c:v', encoder, '-b:v', '1M',
      '-f', 'null', '-',
    ],
    { timeoutMs: 15_000 },
  );
  if (r.code === 0) return { ok: true };
  const last = r.stderr.trim().split(/\r?\n/).slice(-2).join(' ').trim();
  return { ok: false, detail: last || 'L’encodage d’essai a échoué.' };
}

export async function detectEnvironment(customPath: string | null): Promise<Environment> {
  const base: Environment = {
    ok: false,
    ffmpegPath: null,
    ffprobePath: null,
    ffmpegVersion: null,
    versionLine: null,
    encoders: {},
    platform: process.platform,
    arch: process.arch,
    customPath,
    error: null,
    checkedAt: Date.now(),
  };

  let ffmpeg: string | null = null;
  if (customPath) {
    if (await isExecutable(customPath)) ffmpeg = customPath;
    else base.error = `L’exécutable choisi n’est pas accessible : ${customPath}`;
  }
  if (!ffmpeg) ffmpeg = await findBinary('ffmpeg');
  if (!ffmpeg) {
    base.error = base.error ?? 'FFmpeg est introuvable sur ce Mac.';
    return base;
  }
  base.ffmpegPath = ffmpeg;
  base.ffprobePath = await findBinary('ffprobe', path.dirname(ffmpeg));

  const v = await runCapture(ffmpeg, ['-hide_banner', '-version']);
  if (v.code !== 0) {
    base.error = `FFmpeg a été trouvé (${ffmpeg}) mais ne démarre pas${v.error ? ` : ${v.error.message}` : '.'}`;
    return base;
  }
  const parsed = parseVersion(v.stdout);
  base.ffmpegVersion = parsed.version;
  base.versionLine = parsed.line;

  const enc = await runCapture(ffmpeg, ['-hide_banner', '-encoders']);
  const listed = parseEncoderList(enc.stdout);

  const statuses = await Promise.all(
    TRACKED_ENCODERS.map(async ({ name, hardware }): Promise<EncoderStatus> => {
      const isListed = listed.has(name);
      if (!isListed) {
        return {
          name, listed: false, usable: false, hardware,
          detail: hardware
            ? 'Non inclus dans cette version de FFmpeg (VideoToolbox n’existe que sur macOS).'
            : name === 'aac_at'
              ? 'Non inclus (AudioToolbox n’existe que sur macOS) : l’encodeur AAC de FFmpeg est utilisé.'
              : 'Non inclus dans cette version de FFmpeg.',
        };
      }
      if (!hardware) return { name, listed: true, usable: true, hardware };
      const t = await testEncoder(ffmpeg as string, name);
      return {
        name, listed: true, usable: t.ok, hardware,
        detail: t.ok ? undefined : `Listé mais inutilisable sur cette machine : ${t.detail}`,
      };
    }),
  );
  for (const s of statuses) base.encoders[s.name] = s;

  if (!base.ffprobePath) {
    base.error = 'FFprobe est introuvable. Il est fourni avec FFmpeg (Homebrew l’installe automatiquement).';
    return base;
  }
  base.ok = true;
  return base;
}

const BREW_CANDIDATES = ['/opt/homebrew/bin/brew', '/usr/local/bin/brew'];

/** Le binaire ffmpeg vient-il de Homebrew ? (lien vers …/Cellar/ffmpeg/<version>/bin/ffmpeg) */
export function homebrewVersionFromPath(realFfmpeg: string): string | null {
  const m = realFfmpeg.match(/\/Cellar\/ffmpeg(?:@[\d.]+)?\/([^/]+)\/bin\/ffmpeg$/);
  return m ? m[1] : null;
}

/** Interprète `brew outdated --json=v2 ffmpeg`. */
export function parseBrewOutdated(stdout: string): { outdated: boolean; installed: string | null; latest: string | null } | null {
  try {
    const data = JSON.parse(stdout) as { formulae?: { name: string; installed_versions?: string[]; current_version?: string }[] };
    const f = data.formulae?.find((x) => x.name === 'ffmpeg' || x.name.startsWith('ffmpeg@'));
    if (!f) return { outdated: false, installed: null, latest: null };
    return { outdated: true, installed: f.installed_versions?.[f.installed_versions.length - 1] ?? null, latest: f.current_version ?? null };
  } catch {
    return null;
  }
}

/**
 * Vérification des mises à jour, uniquement à la demande de l'utilisateur :
 * Homebrew consulte son propre catalogue (aucune donnée de l'application n'est envoyée).
 */
export async function checkFfmpegUpdate(env: Environment): Promise<UpdateCheck> {
  const now = Date.now();
  const res = (status: UpdateCheck['status'], message: string, installed: string | null = null, latest: string | null = null): UpdateCheck => ({
    status, message, installed, latest, checkedAt: now,
  });
  if (!env.ffmpegPath) return res('error', 'FFmpeg est introuvable : installez-le d’abord.');
  let real = env.ffmpegPath;
  try {
    real = await realpath(env.ffmpegPath);
  } catch {
    /* chemin tel quel */
  }
  const cellarVersion = homebrewVersionFromPath(real);
  // Le brew qui a installé ce FFmpeg : <préfixe>/Cellar/… → <préfixe>/bin/brew.
  const prefix = real.slice(0, real.indexOf('/Cellar/'));
  let brew: string | null = null;
  for (const c of [path.join(prefix, 'bin', 'brew'), ...BREW_CANDIDATES]) {
    if (await isExecutable(c)) {
      brew = c;
      break;
    }
  }
  if (!cellarVersion || !brew) {
    return res(
      'not-homebrew',
      'Ce FFmpeg n’a pas été installé avec Homebrew : l’application ne peut pas savoir s’il est à jour. Comparez sa version avec celle annoncée sur ffmpeg.org.',
      env.ffmpegVersion,
    );
  }
  const r = await runCapture(brew, ['outdated', '--json=v2', 'ffmpeg'], {
    timeoutMs: 120_000,
    env: { ...process.env, HOMEBREW_NO_ENV_HINTS: '1', HOMEBREW_NO_INSTALL_CLEANUP: '1', PATH: `${path.dirname(brew)}:/usr/bin:/bin:/usr/sbin:/sbin` },
  });
  const parsed = parseBrewOutdated(r.stdout);
  if (!parsed) {
    const last = r.stderr.trim().split(/\r?\n/).slice(-1)[0] ?? '';
    return res('error', `Homebrew n’a pas pu répondre${last ? ` : ${last}` : '.'} Vérifiez la connexion Internet.`, cellarVersion);
  }
  if (!parsed.outdated) return res('up-to-date', `FFmpeg ${cellarVersion} est la dernière version proposée par Homebrew.`, cellarVersion, cellarVersion);
  return res(
    'outdated',
    `Une nouvelle version de FFmpeg est disponible (${parsed.latest ?? '?'}). Pour l’installer, copiez la commande ci-dessous dans le Terminal.`,
    parsed.installed ?? cellarVersion,
    parsed.latest,
  );
}
