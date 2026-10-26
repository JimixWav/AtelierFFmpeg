/** Traduit la sortie d'erreur FFmpeg en message compréhensible. */
export function explainFfmpegFailure(stderrTail: string, spawnError?: NodeJS.ErrnoException): string {
  if (spawnError) {
    if (spawnError.code === 'ENOENT') return 'FFmpeg est introuvable. Vérifiez l’installation dans Diagnostic.';
    if (spawnError.code === 'EACCES') return 'FFmpeg ne peut pas être exécuté (permission refusée).';
    return `FFmpeg n’a pas pu démarrer : ${spawnError.message}`;
  }
  const t = stderrTail;
  const has = (re: RegExp) => re.test(t);
  if (has(/No space left on device/i)) return 'Disque plein : libérez de l’espace sur le volume de destination puis relancez.';
  if (has(/Permission denied|Operation not permitted/i)) return 'Permission refusée : FFmpeg ne peut pas lire la source ou écrire dans le dossier de destination.';
  if (has(/Read-only file system/i)) return 'Le volume de destination est en lecture seule.';
  if (has(/No such file or directory/i)) return 'Fichier ou dossier introuvable (déplacé, renommé ou disque déconnecté ?).';
  if (has(/Unknown encoder|Encoder not found/i)) return 'Encodeur indisponible dans cette version de FFmpeg.';
  if (has(/Invalid data found when processing input|moov atom not found|could not find codec parameters|End of file/i)) {
    return 'Fichier source illisible ou corrompu.';
  }
  if (has(/Error while opening encoder|Error initializing output stream|Could not open encoder|cannot open encoder|Error setting option/i)) {
    return 'L’encodeur n’a pas pu démarrer avec ces réglages (paramètres incompatibles avec la source ou encodeur matériel occupé).';
  }
  if (has(/Cannot allocate memory|Out of memory/i)) return 'Mémoire insuffisante pour cette conversion.';
  if (has(/Conversion failed/i)) {
    const meaningful = t.split('\n').filter((l) => l.trim() && !/Conversion failed/i.test(l)).pop();
    return meaningful ? `Échec de FFmpeg : ${meaningful.trim()}` : 'La conversion a échoué.';
  }
  const last = t.trim().split('\n').pop();
  return last ? `Échec de FFmpeg : ${last.trim()}` : 'La conversion a échoué sans message de FFmpeg.';
}
