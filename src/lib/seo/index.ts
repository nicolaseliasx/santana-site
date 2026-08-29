export const siteUrl = 'https://santanafitness.com.br';
export const absoluteUrl = (path: string) => new URL(path.endsWith('/') ? path : `${path}/`, siteUrl).toString();
export function seoFor(title: string, description: string, path = '/') { return { title: `${title} | Santana Fitness`, description, canonical: absoluteUrl(path) }; }
