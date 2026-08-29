import { describe, expect, it } from 'vitest';
import { generalWhatsApp, productWhatsApp, whatsappNumber } from '../../src/lib/whatsapp';
describe('WhatsApp contracts', () => {
  it('uses the approved phone number', () => expect(whatsappNumber).toBe('5548999263333'));
  it('encodes a product-aware message', () => { const url = productWhatsApp({ name: 'Banco', code: 'SF-1', slug: 'banco' }); expect(url).toContain('wa.me/5548999263333?text='); expect(decodeURIComponent(url)).toContain('Olá! Tenho interesse no Banco - Ref. SF-1.'); expect(decodeURIComponent(url)).toContain('/produtos/banco/'); });
  it('provides a general message', () => expect(decodeURIComponent(generalWhatsApp())).toContain('Santana Fitness'));
});
