// Build de l'application avec esbuild : processus principal, preload et interface.
// Usage : node scripts/build.mjs [--watch] [--dev]
import { build, context } from 'esbuild';
import { copyFile, mkdir, readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const pkg = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
const out = path.join(root, 'out');
const watch = process.argv.includes('--watch');
const dev = process.argv.includes('--dev') || watch;

const common = {
  bundle: true,
  sourcemap: dev ? 'inline' : false,
  minify: !dev,
  logLevel: 'info',
  legalComments: 'none',
  define: { 'process.env.NODE_ENV': JSON.stringify(dev ? 'development' : 'production') },
};

/** @type {import('esbuild').BuildOptions[]} */
const targets = [
  {
    ...common,
    entryPoints: [path.join(root, 'src/main/index.ts')],
    outfile: path.join(out, 'main/index.js'),
    platform: 'node',
    format: 'cjs',
    target: 'node20',
    external: ['electron'],
    define: {},
  },
  {
    ...common,
    entryPoints: [path.join(root, 'src/preload/index.ts')],
    outfile: path.join(out, 'preload/index.js'),
    platform: 'node',
    format: 'cjs',
    target: 'node20',
    external: ['electron'],
    define: {},
  },
  {
    ...common,
    entryPoints: { app: path.join(root, 'src/renderer/main.tsx') },
    outdir: path.join(out, 'renderer/assets'),
    platform: 'browser',
    format: 'iife',
    target: ['chrome120'],
    jsx: 'automatic',
    define: { ...common.define, __APP_VERSION__: JSON.stringify(pkg.version) },
    loader: { '.svg': 'text' },
  },
];

async function copyStatic() {
  await mkdir(path.join(out, 'renderer'), { recursive: true });
  await copyFile(path.join(root, 'src/renderer/index.html'), path.join(out, 'renderer/index.html'));
}

if (!watch) await rm(out, { recursive: true, force: true });
await copyStatic();

if (watch) {
  const ctxs = await Promise.all(targets.map((t) => context(t)));
  await Promise.all(ctxs.map((c) => c.watch()));
  console.log('Surveillance des sources active.');
} else {
  await Promise.all(targets.map((t) => build(t)));
  console.log('Build terminé dans ./out');
}
