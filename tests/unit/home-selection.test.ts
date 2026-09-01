import { describe, expect, it } from 'vitest';
import { products } from '../../src/data/catalog';
import { dailySelection } from '../../src/lib/home-selection';

describe('home selection', () => {
  it('never picks Academias ao Ar Livre products for Seleção Santana', () => {
    const pracas = products.filter((product) => product.catalogGroupSlug === 'academias-ao-ar-livre');
    expect(pracas.length).toBeGreaterThan(0);
    for (let day = 1; day <= 90; day += 1) {
      const date = new Date(Date.UTC(2026, 8, day)).toISOString().slice(0, 10);
      const selection = dailySelection(products, date, 12, []);
      expect(selection.some((product) => product.catalogGroupSlug === 'academias-ao-ar-livre')).toBe(false);
    }
  });
  it('still fills the selection with other products', () => {
    const selection = dailySelection(products, '2026-09-01', 12, []);
    expect(selection).toHaveLength(12);
    expect(selection.every((product) => product.images.length > 0)).toBe(true);
  });
});
