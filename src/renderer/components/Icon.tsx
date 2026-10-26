/** Jeu d'icônes en trait, dessiné pour l'application (grille 24 px). */
const PATHS = {
  audio: 'M9 18V6l11-2v12 M9 18a3 3 0 1 1-3-3 3 3 0 0 1 3 3Z M20 16a3 3 0 1 1-3-3 3 3 0 0 1 3 3Z',
  video: 'M3.5 6.5h12a1.5 1.5 0 0 1 1.5 1.5v8a1.5 1.5 0 0 1-1.5 1.5h-12A1.5 1.5 0 0 1 2 16V8a1.5 1.5 0 0 1 1.5-1.5Z M17 10.5l4.5-2.5v8L17 13.5',
  tasks: 'M8 6h12 M8 12h12 M8 18h12 M3.5 6h.01 M3.5 12h.01 M3.5 18h.01',
  history: 'M3 12a9 9 0 1 0 3-6.7 M3 4v4.5h4.5 M12 7.5V12l3 2',
  diagnostic: 'M3 12h4l2.5-6 4 12 2.5-6H21',
  filePlus: 'M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8Z M14 3v5h5 M12 11v6 M9 14h6',
  folderPlus: 'M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z M12 10.5v5 M9.5 13h5',
  folder: 'M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z',
  x: 'M6 6l12 12 M18 6L6 18',
  check: 'M4.5 12.5l5 5 10-11',
  alert: 'M12 3.5 2.5 20h19Z M12 10v4.5 M12 17.5h.01',
  info: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Z M12 11v5.5 M12 7.5h.01',
  chevronDown: 'M6 9l6 6 6-6',
  chevronRight: 'M9 6l6 6-6 6',
  play: 'M7 4.5v15l12-7.5Z',
  pause: 'M7.5 5v14 M16.5 5v14',
  stop: 'M6.5 6.5h11v11h-11Z',
  reveal: 'M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z M10 14h6 M13.5 11.5 16 14l-2.5 2.5',
  open: 'M14 4h6v6 M20 4l-9 9 M18 14v4a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4',
  copy: 'M9 9h10a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H9a1 1 0 0 1-1-1V10a1 1 0 0 1 1-1Z M5 15H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v1',
  refresh: 'M20 11a8 8 0 0 0-14.5-4.5L3.5 9 M3.5 4v5h5 M4 13a8 8 0 0 0 14.5 4.5l2-2.5 M20.5 20v-5h-5',
  trash: 'M4 7h16 M9.5 7V4.5h5V7 M6 7l1 13h10l1-13 M10 11v5.5 M14 11v5.5',
  skip: 'M5 12h11 M12 7l5 5-5 5 M20 5v14',
  spark: 'M12 3v4 M12 17v4 M3 12h4 M17 12h4 M6 6l2.5 2.5 M15.5 15.5 18 18 M6 18l2.5-2.5 M15.5 8.5 18 6',
  drop: 'M12 4v11 M7.5 10.5 12 15l4.5-4.5 M4 15v3a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-3',
  terminal: 'M4 5h16a1 1 0 0 1 1 1v12a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1Z M7 9.5l3 2.5-3 2.5 M12.5 15H17',
  scissors: 'M6 9a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z M6 21a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z M20 4 8.1 15.9 M14.5 14.5 20 20 M8.1 8.1 12 12',
  shield: 'M12 3 4.5 6v5.5c0 4.5 3.2 8.2 7.5 9.5 4.3-1.3 7.5-5 7.5-9.5V6Z M9 12l2 2 4-4',
} as const;

export type IconName = keyof typeof PATHS;

export function Icon({ name, size = 16, className }: { name: IconName; size?: number; className?: string }) {
  return (
    <svg
      className={className ? `icon ${className}` : 'icon'}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.7}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <path d={PATHS[name]} />
    </svg>
  );
}
