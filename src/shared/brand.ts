/** Identité de l'application : un seul endroit à modifier pour la renommer. */
export const BRAND = {
  name: 'Atelier FFmpeg',
  author: 'jimix.wav',
  /** Page GitHub de l'auteur, seule adresse que l'application peut ouvrir. */
  authorUrl: 'https://github.com/JimixWav?tab=repositories',
  createdYear: 2026,
} as const;

/** Fonctions en cours de développement, masquées dans cette version. */
export const FEATURES = {
  /** Onglet Édition (découpe, formats réseaux, GIF) : retiré de la v1.2. */
  edit: false,
} as const;

export function copyrightLine(year = new Date().getFullYear()): string {
  const span = year > BRAND.createdYear ? `${BRAND.createdYear}–${year}` : String(BRAND.createdYear);
  return `© ${span} ${BRAND.author}`;
}
