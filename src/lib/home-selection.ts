import type { Product } from '@/domain/product';
import { imageSource } from '@/domain/product';

const hash = (value: string) => { let result = 2166136261; for (let i = 0; i < value.length; i += 1) { result ^= value.charCodeAt(i); result = Math.imul(result, 16777619); } return result >>> 0; };
export const productsWithImages = (items: Product[]) => items.filter((product) => product.images.some((image) => Boolean(imageSource(image))));
export const heroProducts = (items: Product[], limit = 6) => productsWithImages(items).slice(0, limit);
export function dailySelection(items: Product[], date: Date | string = new Date(), size = 8, excluded: Product[] = []) {
  const usable = productsWithImages(items).filter((product) => product.catalogGroupSlug !== 'academias-ao-ar-livre'); const excludedSlugs = new Set(excluded.map((product) => product.slug));
  const preferred = usable.filter((product) => !excludedSlugs.has(product.slug)); const pool = (preferred.length >= size ? preferred : usable).slice();
  const day = typeof date === 'string' ? date.slice(0, 10) : date.toISOString().slice(0, 10); const selected: Product[] = []; let seed = hash(day);
  while (pool.length && selected.length < size) { seed = Math.imul(seed ^ (seed >>> 16), 2246822519) >>> 0; const index = seed % pool.length; selected.push(pool.splice(index, 1)[0]); }
  return selected;
}
