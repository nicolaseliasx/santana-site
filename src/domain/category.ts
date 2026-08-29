export type Category = { id: string; slug: string; name: string; description?: string; legacyUrls: string[]; productCount: number };

/** Commercial taxonomy names and audited counts from the public catalogue. */
const taxonomy = [
  ['funcional-e-crosfit', 'Funcional e Crosfit', 192], ['suportes-e-bancos', 'Suportes e Bancos', 36], ['linha-equipamentos-movement-edge', 'Movement EDGE+', 23], ['linha-academia-de-pracas', 'Academia de Praças', 18], ['barras-e-acessorios', 'Barras e Acessórios', 16], ['linha-tubolar-4pl-power-line', 'Tubolar 4PL Power Line', 14], ['linha-condominios-e-residenciais', 'Condomínios e Residenciais', 11], ['linha-cardio-pro', 'Cárdio Pro', 11], ['linha-articulada-convergente', 'Articulada Convergente', 9], ['climatizadores-komeco', 'Climatizadores Komeco', 6], ['linha-ventiladores-e-exaustores', 'Ventiladores e Exaustores', 3], ['pisos-especiais-para-academias', 'Pisos Especiais para Academias', 2],
] as const;
export const categories: Category[] = taxonomy.map(([slug, name, productCount], index) => ({ id: String(index + 1), slug, name, productCount, legacyUrls: [`/gallery_entries/${slug}/`] }));
