import { describe, expect, it } from 'vitest';
import { generalWhatsApp, productWhatsApp, whatsappNumber } from '../../src/lib/whatsapp';
describe('WhatsApp contracts', () => {
  it('uses the approved phone number', () => expect(whatsappNumber).toBe('5548999263333'));
  it('encodes a product-aware message with its public price', () => { const url = productWhatsApp({ name: 'Banco', code: 'SF-1', slug: 'banco', priceFormatted: 'R$ 1.234,56' }); expect(url).toContain('wa.me/5548999263333?text='); expect(decodeURIComponent(url)).toContain('Olá! Tenho interesse no Banco - Ref. SF-1.'); expect(decodeURIComponent(url)).toContain('/produtos/banco/'); expect(decodeURIComponent(url)).toContain('Valor: R$ 1.234,56'); });
  it('provides a general message', () => expect(decodeURIComponent(generalWhatsApp())).toContain('Santana Fitness'));
});
