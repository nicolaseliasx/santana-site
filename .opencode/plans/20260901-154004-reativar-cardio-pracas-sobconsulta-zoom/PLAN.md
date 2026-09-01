# Plano aprovado: remover categorias, modo "Sob consulta", reativar 28 produtos (Cardio + Pracas), lupa de zoom

Repo: `/home/admin/santana-site/santana-site` (Astro estático, vitest, validadores node). Prefixe comandos shell com `rtk`. Não use `git commit/push`; sem escritas remotas.

## Fase 1 — Remover grupos Climatização e Ventilação + Condomínios e Residências

Arquivo único: `src/domain/catalog-group.ts`.

1. Remover do union `CatalogGroupSlug` (linhas ~21-23): `'condominios-e-residencias'` e `'climatizacao-e-ventilacao'`.
2. Remover de `catalogGroupDefinitions` as duas entradas (id '8' e id '10', linhas ~33 e ~35). Manter os demais ids como estão (strings '1'..'10' são livres; não renumere os restantes além de remover as duas linhas).
3. Em `catalogGroupForProduct`: remover a regra do `if (legacy.has('climatizadores-komeco') || ...)` (linha ~48) e o `if (legacy.has('linha-condominios-e-residenciais'))` (linha ~55). O fallback final `'musculacao'` permanece.
4. Conferência (não pode mudar nada para os 221 atuais): rode antes e depois um node one-liner que importe a lógica equivalente (ou replique em script temp em /tmp) e imprima o histograma de `catalogGroupSlug` dos 221 produtos de `src/data/catalog.generated.json`. O resultado deve ser idêntico antes/depois. Se mudar qualquer produto, pare e reporte bloqueio.

## Fase 2 — Preço opcional ("Sob consulta")

- `src/domain/product.ts`: `price` e `priceFormatted` viram opcionais (`price?: number; priceFormatted?: string;`). Ausente/undefined = sob consulta.
- `src/data/catalog.ts` linha 54: hoje exige `products.length !== 221` e `price <= 0`. Trocar para:
  - total exato `249` (221 + 28 da Fase 3);
  - preço válido: `price == null` (sob consulta) OU (`price > 0` && `priceFormatted` no formato `R$ x.xxx,xx`). Mantenha as demais asserções (slugs únicos, grupos válidos, priceFormatted consistente quando presente).
- `src/components/catalog/ProductCard.astro` (linha ~17): onde renderiza `{product.priceFormatted}` com aria-label `Preço: ...` — quando não houver preço, renderizar o texto `Sob consulta` no mesmo elemento `.price` com `aria-label="Preço: sob consulta"`.
- `src/pages/produtos/[slug].astro` (linha ~7): mesmo tratamento no `<p class="price product-price">` (texto `Sob consulta`, aria-label `Preço: sob consulta`).
- `src/lib/whatsapp.ts`: leia o arquivo; se a mensagem incluir preço/formatte­d, ajuste para omitir preço quando ausente (mensagem segue fazendo sentido sem valor). Não altere a URL base/número.
- `tests/unit/catalog.test.ts`: atualizar: total `249`; `images.length > 0` → `207`; `images.length === 0` → `42`; asserção de preço → todo produto tem (`price > 0 && priceFormatted.startsWith('R$')`) OU (`price == null`). Mantenha os demais testes.
- `scripts/validate-catalog.mjs`:
  - contagens 221 → 249 (linhas 35: `products.length !== 221 || productFiles.length !== 221` → 249/249);
  - preço (linhas ~21-22): erro apenas quando `price != null` e (`!(price > 0)` ou `priceFormatted !== expectedPrice(price)`); `price == null` é válido;
  - linha 23 `!product.code`: `code` passa a ser opcional (produtos reativados não têm código) — remova o requisito de `code` (a renderização já guarda com `product.code && ...`);
  - linha 24 sourceTrace: mantida (a Fase 3 garante trace com padrão `nome:digitos`);
  - dataset: `expectedSlugs`/`expectedCategories` continuam vindos de `reports/import-sheets.dataset.json` (221). Ajuste a checagem de content files: o conjunto de `.md` em `src/content/products` deve ser igual a `expectedSlugs ∪ slugs de catalog.generated.json` (sem stale e sem missing). Categorias `.md` seguem só do dataset.

## Fase 3 — Reativar 28 produtos do catálogo antigo

Novo script `scripts/reactivate-legacy-products.mjs` (node, ESM, sharp disponível em deps):

1. Fonte: `reports/import-sheets.old-catalog.json` (array de 363). Filtrar EXATAMENTE estes 28 slugs:
   - Cardio (10): `rock-air-bike`, `bicicleta-eletrom-embreex-364-sx`, `bicicleta-embreex-367-sx`, `esteira-embreex-820`, `lx-160-g4`, `power-cross-280`, `spinning-bike-315`, `tour-01`, `tours-01`, `esteira-embreex-568bx-3-0`, `eliptico-rt-e` — (11 slugs listados; valide contra os `categorySlugs` `linha-cardio-pro`; se `eliptico-rt-e` não for cardio-pro, inclua-o apenas se estiver em `linha-cardio-pro`; o alvo é: todos os registros old-catalog com categorySlug `linha-cardio-pro` + `linha-academia-de-pracas` que não existam no catálogo atual — total esperado 28).
   - Pracas (18): `alongador-2-alturas`, `alongador-3-alturas`, `caminhada-duplo`, `cavalgada-duplo`, `cavalgada-simples`, `eliptico-duplo`, `eliptico-simples`, `multi-exercitador`, `placa-orientativa-frente`, `placa-orientativa-verso`, `pressao-de-pernas-duplo`, `pressao-de-pernas-quadris`, `quadris-duplo`, `remada`, `rotacao-diagonal-dupla`, `rotacao-vertical-dupla`, `rotacao-vertical-e-diagonal-simples` (+1 que fechar 18).
   - Regra canônica: `old.filter(p => !slugsAtuais.has(p.slug) && p.categorySlugs.some(c => ['linha-cardio-pro','linha-academia-de-pracas'].includes(c)))` → deve dar 28. Se der outro número, pare e reporte.
2. Para cada um: baixar a primeira imagem (`images[0].originalSrc`, HTTPS santanafitness.com.br, confirmado vivo) para `public/products/<slug>.png` (usar `fetch` nativo). Validar decodificação e extrair `width/height/bytes` com sharp; `hash` = sha256 do arquivo. Se download/decodificação falhar: pular o produto, registrar no relatório final e continuar (nesse caso o total 249 das validações deve ser ajustado para 221 + reativados_ok — atualize as constantes em catalog.ts/validate-catalog/testes de acordo com o resultado real e reporte).
3. Registro do produto a anexar ao final de `src/data/catalog.generated.json` (mesma forma dos atuais):
   - `id`/`legacyId` do old-catalog (ids de 4 dígitos, sem colisão com 1..221);
   - `slug`, `name`, `categorySlugs` (mantém legacy slug original), sem `code`, sem `price`/`priceFormatted` (omitir as chaves);
   - `summary`: `Equipamento ${name} da linha ${linha}.` com linha = `Cardio Pro` para cardio-pro e `Academia de Praças` para pracas;
   - `features: []`, `specifications: []`, `legacyUrls` do registro antigo;
   - `sourceTrace`: manter o trace antigo E adicionar `{ kind: 'legacy-page', identifier: 'old-catalog.json:<legacyId>', field: 'reactivation' }` (satisfaz o padrão `[^:]+:\d+`);
   - `images: [ { originalSrc: <url>, localOriginal: '/products/<slug>.png', variants: { fallback: [{ src: '/products/<slug>.png', width, height, bytes, mime: 'image/png' }] }, alt: 'Equipamento <NAME> — vista principal', width, height, hash, isPrimary: true, src: '/products/<slug>.png' } ]`;
   - `featured: false`.
4. Escrever espelho `.md` em `src/content/products/<slug>.md` no MESMO formato dos existentes (frontmatter JSON entre `---`; copie a estrutura de um arquivo atual).
5. Idempotência: se rodar de novo, não duplicar (substituir por slug). Não modificar os 221 existentes nem as imagens atuais. Reportar JSON final: `{ reativados: n, imagensBaixadas: n, pulados: [{slug, motivo}] }`.

## Fase 4 — Lupa de zoom na página de produto

`src/components/product/Gallery.astro` apenas:

- `.gallery-main`: adicionar `position:relative; overflow:hidden`.
- Selo com ícone lupa (SVG inline, sem emoji) posicionado no canto inferior direito da imagem principal, indicando zoom; opacidade que some durante o zoom ativo.
- Script inline (padrão já existente no arquivo): com guarda `window.matchMedia('(hover: hover) and (pointer: fine)')` — em `mouseenter` no `.gallery-main img` adicionar classe `zoomed` (CSS: `transform: scale(2)`), em `mousemove` setar `style.transformOrigin = '<x>% <y>%'` conforme posição relativa do cursor, em `mouseleave` remover classe e limpar origin. `cursor: zoom-in` no hover. Touch permanece intacto (script não anexa listeners fora do matchMedia). Thumbs continuam funcionando (troca de `src` já existente; zoom reage ao mouse normalmente).
- Sem libs externas; sem mudanças em outros componentes.

## Exclusões

- Não comitar/pushar; não alterar scripts de importação de planilhas; não inventar preços; INDOOR BIKE 309/310 (Condomínios) ficam inativos; sem parsing de PDF; sem lightbox de clique; sem redirects novos.

## Contratos públicos

- `Product.price`/`priceFormatted` opcionais; rótulo PT-BR exato `Sob consulta`; aria-labels `Preço: sob consulta`.
- Total de produtos: 249 (221 + 28). Imagens novas: PNG único fallback (sem webp/avif) — consistente com os atuais.

## Validação (rodar todas, na ordem)

1. `rtk proxy npm run validate:catalog` → `generatedCount: 249`, `productFileCount: 249`, `errors: []`, exit 0.
2. `rtk proxy npx vitest run` → todos verdes.
3. `rtk proxy npm run build` → sucesso (275 páginas: 247 + 28).
4. Checagens em `dist/`:
   - `dist/produtos/esteira-embreex-820/index.html` existe e contém `Sob consulta`;
   - `dist/sitemap-index.xml` → descomprimir sitemap*.xml e conferir presença de `esteira-embreex-820` e AUSÊNCIA de `climatizacao-e-ventilacao` e `condominios-e-residencias`;
   - `grep -rl "Climatização e Ventilação\|Condomínios e Residências" dist/` → vazio.
5. Histograma de grupos dos 221 originais idêntico ao pré-Fase 1 (comparação salva em /tmp).

## Critérios de aceitação

- 8 grupos de categoria no menu/páginas; 249 produtos validados; 28 páginas novas no build; preço "Sob consulta" renderizado em card e página; zoom hover 2x com lupa funcionando em desktop e inerte em touch; todas as validações verdes.
