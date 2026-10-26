// Mode développement : compile en continu et (re)lance Electron.
// L'interface se recharge automatiquement ; le processus principal redémarre
// quand ses sources changent.
import { spawn } from 'node:child_process';
import { watch } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const electronBin = require('electron');

const builder = spawn(process.execPath, [path.join(root, 'scripts/build.mjs'), '--watch'], { stdio: 'inherit' });

let app = null;
let restarting = false;
function startApp() {
  app = spawn(electronBin, ['.'], { cwd: root, stdio: 'inherit', env: { ...process.env, ATELIER_DEV: '1' } });
  app.on('exit', () => {
    if (!restarting) {
      builder.kill();
      process.exit(0);
    }
  });
}

let timer = null;
function restart() {
  clearTimeout(timer);
  timer = setTimeout(() => {
    if (!app) return startApp();
    restarting = true;
    app.once('exit', () => {
      restarting = false;
      startApp();
    });
    app.kill();
  }, 300);
}

// Attend le premier build puis lance l'application.
setTimeout(() => {
  startApp();
  for (const dir of ['out/main', 'out/preload']) {
    watch(path.join(root, dir), () => restart());
  }
}, 1500);

process.on('SIGINT', () => {
  builder.kill();
  app?.kill();
  process.exit(0);
});
