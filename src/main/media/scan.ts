import { readdir } from 'node:fs/promises';
import path from 'node:path';

export interface ScanResult {
  files: string[];
  errors: { path: string; reason: string }[];
}

export const PARTIAL_MARKER = '.atelier-partiel-';

export function extOf(p: string): string {
  return path.extname(p).slice(1).toLowerCase();
}

/**
 * Parcourt un dossier (récursivement si demandé) et renvoie les fichiers dont
 * l'extension est acceptée. Ignore les fichiers cachés, les fichiers partiels
 * de l'application et ne suit pas les liens symboliques de dossiers (évite les boucles).
 */
export async function scanFolder(root: string, extensions: readonly string[], recursive: boolean, limit = 20_000): Promise<ScanResult> {
  const accepted = new Set(extensions);
  const files: string[] = [];
  const errors: { path: string; reason: string }[] = [];
  const stack: string[] = [root];
  while (stack.length && files.length < limit) {
    const dir = stack.pop() as string;
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch (e) {
      const err = e as NodeJS.ErrnoException;
      errors.push({ path: dir, reason: err.code === 'EACCES' || err.code === 'EPERM' ? 'Dossier inaccessible (permission refusée)' : 'Dossier illisible' });
      continue;
    }
    entries.sort((a, b) => a.name.localeCompare(b.name, 'fr', { numeric: true }));
    const subdirs: string[] = [];
    for (const ent of entries) {
      if (ent.name.startsWith('.')) continue;
      const full = path.join(dir, ent.name);
      if (ent.isDirectory()) {
        if (recursive) subdirs.push(full);
      } else if (ent.isFile() && accepted.has(extOf(ent.name)) && !ent.name.includes(PARTIAL_MARKER)) {
        files.push(full);
      }
    }
    // Ordre naturel : on empile à l'envers pour dépiler dans l'ordre alphabétique.
    for (let i = subdirs.length - 1; i >= 0; i--) stack.push(subdirs[i]);
  }
  return { files, errors };
}
