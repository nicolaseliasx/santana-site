export const siteUrl = 'https://santanafitness.com.br';
export const siteName = 'santanafitness.com.br';
export const absoluteUrl = (path: string) => new URL(path.endsWith('/') ? path : `${path}/`, siteUrl).toString();
export const pageTitle = (title?: string) => title?.trim() ? `${title.trim()} ${siteName}` : siteName;
export function seoFor(title: string, description: string, path = '/') { return { title: pageTitle(title), description, canonical: absoluteUrl(path) }; }
