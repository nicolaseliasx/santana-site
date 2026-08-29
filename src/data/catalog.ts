import type { Category } from '@/domain/category';
import { categories } from '@/domain/category';
import type { Product, ProductImage } from '@/domain/product';
import { imageSource } from '@/domain/product';
import generatedCatalog from './catalog.generated.json';
import { catalogGroupDefinitions, catalogGroupForProduct, type CatalogGroup } from '@/domain/catalog-group';

const fallbackImage = (name: string, src: string): ProductImage => ({
  originalSrc: src,
  localOriginal: src,
  variants: { fallback: [{ src, width: 800, height: 800, mime: 'image/png' }] },
  alt: `Equipamento ${name} — vista principal`,
  width: 800,
  height: 800,
  hash: '0'.repeat(64),
  isPrimary: true,
  src,
});

type LegacyGenerated = Partial<Product> & { image?: string; legacyUrl?: string; sourceImage?: string; images?: Array<Partial<ProductImage> & { src?: string }> };
const generated = generatedCatalog as unknown as LegacyGenerated[];

/** Normalize the migration manifest while keeping the catalogue import-only and deterministic. */
export const products: Product[] = generated.map((raw, index) => {
  const source = raw.images?.map((item, imageIndex) => {
    const local = item.localOriginal || item.src || raw.image || '';
    return {
      ...fallbackImage(raw.name || raw.slug || 'equipamento', local),
      ...item,
      originalSrc: item.originalSrc || raw.sourceImage || local,
      localOriginal: local,
      src: local,
      isPrimary: item.isPrimary ?? imageIndex === 0,
    } as ProductImage;
  }) || [];
  const catalogGroupSlug = catalogGroupForProduct({ slug: raw.slug || `produto-${index + 1}`, name: raw.name || raw.slug || `Produto ${index + 1}`, categorySlugs: raw.categorySlugs || [] });
  return {
    id: raw.id || String(index + 1),
    legacyId: raw.legacyId || Number(raw.id || index + 1),
    slug: raw.slug || `produto-${index + 1}`,
    name: raw.name || raw.slug || `Produto ${index + 1}`,
    code: raw.code,
    categorySlugs: raw.categorySlugs || [],
    catalogGroupSlug,
    summary: raw.summary,
    description: raw.description,
    features: raw.features || [],
    specifications: raw.specifications || [],
    images: source.length ? source : [fallbackImage(raw.name || raw.slug || 'equipamento', raw.image || '')],
    legacyUrls: raw.legacyUrls || (raw.legacyUrl ? [new URL(raw.legacyUrl).pathname] : []),
    seo: raw.seo,
    sourceTrace: raw.sourceTrace || [{ kind: 'public-page', url: raw.legacyUrl || `https://santanafitness.com.br/dt_galleries/${raw.slug}/` }],
    featured: raw.featured,
  };
});

export const catalogGroupMap: Record<string, CatalogGroup['slug']> = Object.fromEntries(products.map((product) => [product.slug, product.catalogGroupSlug]));
if (products.length !== 363 || Object.keys(catalogGroupMap).length !== products.length || products.some((product) => !catalogGroupDefinitions.some((group) => group.slug === product.catalogGroupSlug))) {
  throw new Error('Catalog group map must assign exactly one valid presentation group to every product');
}

export const allCategories: Category[] = categories;
export const categoryBySlug = (slug: string) => allCategories.find((category) => category.slug === slug);
export const productsByCategory = (slug: string) => products.filter((product) => product.categorySlugs.includes(slug));
export const catalogGroups: CatalogGroup[] = catalogGroupDefinitions.map((definition) => {
  const productSlugs = products.filter((product) => product.catalogGroupSlug === definition.slug).map((product) => product.slug);
  return { ...definition, productSlugs, productCount: productSlugs.length };
});
export const catalogGroupBySlug = (slug: string) => catalogGroups.find((group) => group.slug === slug);
export const productsByCatalogGroup = (slug: string) => products.filter((product) => product.catalogGroupSlug === slug);
export const featuredProducts = () => products.filter((product) => product.featured && product.images.some((image) => imageSource(image)));
export const productBySlug = (slug: string) => products.find((product) => product.slug === slug);
export function relatedProducts(product: Product, limit = 4) {
  if (!product.categorySlugs.length) return [];
  return products.filter((item) => item.id !== product.id && item.categorySlugs.some((cat) => product.categorySlugs.includes(cat))).slice(0, limit);
}
