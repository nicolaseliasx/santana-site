import { describe, expect, it } from 'vitest';
import { products, relatedProducts } from '../../src/data/catalog';
describe('catalogue', () => { it('has products and unique slugs', () => expect(new Set(products.map((p) => p.slug)).size).toBe(products.length)); it('limits related products to four and excludes current', () => { const related = relatedProducts(products[0]); expect(related.length).toBeLessThanOrEqual(4); expect(related.some((p) => p.id === products[0].id)).toBe(false); }); });
