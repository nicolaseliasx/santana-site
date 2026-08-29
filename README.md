# Santana Fitness — catálogo estático

Catálogo Astro estático para os 363 equipamentos públicos da Santana Fitness. Não há CMS, banco/runtime, carrinho, checkout, contas ou formulário de contato.

## Desenvolvimento

```bash
npm install
npm run dev
npm run check
npm test -- --run
npm run build
npm run test:e2e
```

O E2E usa a imagem oficial Playwright correspondente à versão instalada. O resultado de `astro build` é publicado como arquivos estáticos em `dist/`.

## Dados e mídia

`src/data/catalog.generated.json` e as Content Collections são gerados a partir do sitemap e das páginas públicas do WordPress. A migração usa cache local ignorado em `.migration/`, preserva nomes/taxonomia/URLs legadas e produz os relatórios em `reports/`. Rode `npm run migrate:catalog` para atualizar conteúdo e `npm run migrate:images` para baixar/validar originais e gerar WebP/AVIF. Nunca adicione dumps, credenciais, cache HTML ou estado Docker ao Git.

Os originais ficam em `public/products/`, sem alteração visual; variantes têm hash de conteúdo e nunca excedem as dimensões originais. Imagens sem fonte recuperável permanecem como estado de ausência na interface.

## Rotas e manutenção

As rotas principais são `/`, `/produtos/`, `/produtos/pagina/:page/`, `/produtos/:slug/`, `/categorias/`, `/categorias/:slug/`, `/sobre/` e `/contato/`. Regras de `/dt_galleries/` e `/gallery_entries/` estão em `public/_redirects`; conteúdo removido recebe 410.

WhatsApp é centralizado em `src/lib/whatsapp/` e usa somente `+55 48 99926-3333`. Mensagens de produto sempre incluem nome, referência quando verificada e URL HTTPS de produção.
