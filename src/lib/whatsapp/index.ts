const phone = '5548999263333';
const productionOrigin = 'https://santanafitness.com.br';
export const whatsappNumber = phone;
export function whatsappUrl(message: string) { return `https://wa.me/${phone}?text=${encodeURIComponent(message)}`; }
export function productWhatsApp(product: { name: string; code?: string; slug: string }, origin = 'https://santanafitness.com.br') {
  const interest = product.code ? `${product.name} - Ref. ${product.code}` : `equipamento ${product.name}`;
  let safeOrigin = productionOrigin;
  try { const candidate = new URL(origin); if (candidate.protocol === 'https:' && candidate.hostname === 'santanafitness.com.br') safeOrigin = candidate.origin; } catch { /* use production origin */ }
  return whatsappUrl(`Olá! Tenho interesse no ${interest}.\nGostaria de mais informações.\n\nProduto:\n${safeOrigin}/produtos/${product.slug}/`);
}
export const generalWhatsApp = () => whatsappUrl('Olá! Gostaria de mais informações sobre os equipamentos da Santana Fitness.');
