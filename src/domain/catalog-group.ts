import type { Product } from './product';

export interface CatalogGroup {
  id: string;
  slug: string;
  name: string;
  description: string;
  legacyCategorySlugs: string[];
  productSlugs: string[];
  productCount: number;
}

export type CatalogGroupSlug =
  | 'musculacao'
  | 'cardio'
  | 'funcional-e-crossfit'
  | 'acessorios-de-treino'
  | 'bancos-e-suportes'
  | 'barras-halteres-e-anilhas'
  | 'academias-ao-ar-livre'
  | 'pisos-para-academias';

export const catalogGroupDefinitions: Omit<CatalogGroup, 'productSlugs' | 'productCount'>[] = [
  { id: '1', slug: 'musculacao', name: 'Musculação', description: 'Aparelhos guiados, tubulares e articulados', legacyCategorySlugs: ['linha-equipamentos-movement-edge', 'linha-tubolar-4pl-power-line', 'linha-articulada-convergente'] },
  { id: '2', slug: 'cardio', name: 'Cardio', description: 'Esteiras, bicicletas, spinning, air bikes e elípticos', legacyCategorySlugs: ['linha-cardio-pro'] },
  { id: '3', slug: 'funcional-e-crossfit', name: 'Funcional e Crossfit', description: 'Rigs, trenós, wall balls e equipamentos funcionais', legacyCategorySlugs: ['funcional-e-crosfit'] },
  { id: '4', slug: 'acessorios-de-treino', name: 'Acessórios de Treino', description: 'Elásticos, luvas, protetores, colchonetes e acessórios portáteis', legacyCategorySlugs: ['funcional-e-crosfit', 'barras-e-acessorios'] },
  { id: '5', slug: 'bancos-e-suportes', name: 'Bancos e Suportes', description: 'Bancos, racks, torres e suportes para organizar o treino', legacyCategorySlugs: ['suportes-e-bancos'] },
  { id: '6', slug: 'barras-halteres-e-anilhas', name: 'Barras, Halteres e Anilhas', description: 'Barras, halteres, kettlebells e pesos livres', legacyCategorySlugs: ['barras-e-acessorios'] },
  { id: '7', slug: 'academias-ao-ar-livre', name: 'Academias ao Ar Livre', description: 'Equipamentos para praças e espaços abertos', legacyCategorySlugs: ['linha-academia-de-pracas'] },
  { id: '9', slug: 'pisos-para-academias', name: 'Pisos para Academias', description: 'Pisos resistentes para áreas de treinamento', legacyCategorySlugs: ['pisos-especiais-para-academias'] },
];

const normalize = (value: string) => value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();

/**
 * Presentation taxonomy binding. Legacy category slugs remain untouched on
 * Product; this explicit rule set assigns every source product one public group.
 */
export function catalogGroupForProduct(product: Pick<Product, 'name' | 'slug' | 'categorySlugs'>): CatalogGroupSlug {
  const text = normalize(`${product.slug} ${product.name}`);
  const legacy = new Set(product.categorySlugs);
  if (legacy.has('linha-academia-de-pracas')) return 'academias-ao-ar-livre';
  if (legacy.has('pisos-especiais-para-academias') || /(^| )piso(s)?( |$)|bobina resinada/.test(text)) return 'pisos-para-academias';
  if (legacy.has('linha-cardio-pro') || /esteira|bicicleta|bike|eliptico|air bike|spinning|power cross|tour /.test(text)) return 'cardio';
  if (/barra(s)? |barra_|halter|dumbell|kett?ebell|anilha|safety bar|peso livre/.test(text)) return 'barras-halteres-e-anilhas';
  if (legacy.has('suportes-e-bancos') || /(^| )banco|suporte|rack|torre halter|carrinho caneleira/.test(text)) return 'bancos-e-suportes';
  if (/luva|protetor|elastico|extensor|corda|colchonete|tapete|fita |faixa |caneleira|colete|cinturao|cinto |bola|ball|grip|manopla|medicine|bosu|yoga mat|rolo |disco |step |escada |kit |hand grip|abmat|straps|mala gym|bolsa gym|porta celular|reposicao|saco |slackline|bambole|bombole/.test(text)) return 'acessorios-de-treino';
  if (legacy.has('funcional-e-crosfit') || /rig|cross|sled|treno|wall|gaiola|calistenia|argola|agilidade|land mine|monkey bar|puxador|crossover|parallet|functional|power rack/.test(text)) return 'funcional-e-crossfit';
  return 'musculacao';
}

