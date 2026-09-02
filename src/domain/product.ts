export type SourceKind = 'database' | 'public-page' | 'public-media' | 'derived' | 'legacy-page';
export type SourceTrace = { kind: SourceKind; url?: string; identifier?: string; field?: string };
export type ImageVariant = { src: string; width: number; height: number; bytes?: number; mime?: string };
export type ProductImage = {
  originalSrc: string;
  localOriginal: string;
  variants: { avif?: ImageVariant[]; webp?: ImageVariant[]; fallback: ImageVariant[] };
  alt: string;
  width: number;
  height: number;
  hash: string;
  isPrimary: boolean;
  /** Backwards-compatible local source used by the Astro templates. */
  src?: string;
  /** Optional transparent derivative; originals always remain the fallback. */
  cutout?: { src: string; variants?: { avif?: ImageVariant[]; webp?: ImageVariant[] }; width: number; height: number; alpha?: boolean };
};
export type Product = {
  id: string;
  legacyId: number;
  slug: string;
  name: string;
  code?: string;
  /** Absent price means "Sob consulta" (price on request). */
  price?: number;
  priceFormatted?: string;
  categorySlugs: string[];
  catalogGroupSlug: import('./catalog-group').CatalogGroupSlug;
  summary?: string;
  description?: string;
  features: string[];
  specifications: { label: string; value: string; unit?: string }[];
  images: ProductImage[];
  legacyUrls: string[];
  seo?: { title?: string; description?: string };
  sourceTrace: SourceTrace[];
  featured?: boolean;
};

export const imageSource = (image?: ProductImage, preferCutout = true) => preferCutout
  ? image?.cutout?.src || image?.localOriginal || image?.src || ''
  : image?.localOriginal || image?.src || '';

/**
 * Card preview fit derived from image dimensions: strongly vertical images
 * crop anchored at the top, strongly horizontal ones crop at the center.
 * Moderately proportioned images keep the default letterboxed contain.
 */
export type ImageCardFit = 'tall' | 'wide' | null;
export const imageCardFit = (image?: Pick<ProductImage, 'width' | 'height'>): ImageCardFit => {
  if (!image?.width || !image?.height) return null;
  if (image.height >= image.width * 1.6) return 'tall';
  if (image.width >= image.height * 1.6) return 'wide';
  return null;
};
