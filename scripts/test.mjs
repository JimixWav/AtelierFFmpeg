// Compile les tests TypeScript avec esbuild puis les exécute avec le lanceur de tests de Node.
import { build } from 'esbuild';
import { spawnSync } from 'node:child_process';
import { readdirSync, rmSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outdir = path.join(root, '.test-build');
rmSync(outdir, { recursive: true, force: true });
const entries = readdirSync(path.join(root, 'tests')).filter((f) => f.endsWith('.test.ts')).map((f) => path.join(root, 'tests', f));
await build({ entryPoints: entries, outdir, bundle: true, platform: 'node', format: 'cjs', target: 'node20', external: ['electron'], logLevel: 'warning' });
const files = readdirSync(outdir).filter((f) => f.endsWith('.js')).map((f) => path.join(outdir, f));
const r = spawnSync(process.execPath, ['--test', '--test-concurrency=1', ...files], { stdio: 'inherit' });
rmSync(outdir, { recursive: true, force: true });
process.exit(r.status ?? 1);
