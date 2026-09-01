export type Category = { id: string; slug: string; name: string; description?: string; legacyUrls: string[]; productCount: number };

/** Legacy taxonomy represented by the imported catalogue. Counts are completed from the generated products. */
const taxonomy = [
  ['funcional-e-crosfit', 'Funcional e Crosfit'], ['suportes-e-bancos', 'Suportes e Bancos'], ['barras-e-acessorios', 'Barras e Acessórios'], ['linha-tubolar-4pl-power-line', 'Tubolar 4PL Power Line'], ['linha-articulada-convergente', 'Articulada Convergente'],
] as const;
export const categories: Category[] = taxonomy.map(([slug, name], index) => ({ id: String(index + 1), slug, name, productCount: 0, legacyUrls: [`/gallery_entries/${slug}/`] }));
