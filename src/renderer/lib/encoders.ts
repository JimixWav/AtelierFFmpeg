export const TRACKED_ENCODER_INFO: { name: string; role: string }[] = [
  { name: 'h264_videotoolbox', role: 'H.264 matériel (profil YouTube)' },
  { name: 'hevc_videotoolbox', role: 'HEVC matériel (profil Archivage)' },
  { name: 'libx264', role: 'H.264 logiciel (repli)' },
  { name: 'libx265', role: 'HEVC logiciel (repli)' },
  { name: 'aac', role: 'Audio des vidéos' },
  { name: 'libmp3lame', role: 'Sortie MP3' },
  { name: 'aac_at', role: 'Sortie AAC (Apple, meilleure qualité)' },
  { name: 'libopus', role: 'Sortie Opus' },
];
