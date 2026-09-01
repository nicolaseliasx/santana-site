# PLAN — Reconstrução completa do catálogo a partir das planilhas MAR/2026

## Objetivo

Apagar os 363 produtos atuais do catálogo Astro estático da Santana Fitness e
reconstruir o catálogo a partir de 5 planilhas na raiz `/home/admin/santana-site/`
(cruzando dados entre elas), extraindo imagens embutidas em qualidade original,
adicionando exibição pública de preço (R$), deduplicando produtos repetidos entre
arquivos, e preservando SEO via redirects. PDF do catálogo serve apenas como
fonte opcional de imagens para uso posterior pelo usuário.

## Fatos do repositório (verificados em 2026-08-31)

- Repo Git de trabalho: `/home/admin/santana-site/santana-site` (todos os paths
  abaixo são relativos a ele, salvo indicação).
- Site: Astro 5 estático, sem CMS/banco. Rotas: `/`, `/produtos/`,
  `/produtos/pagina/:page/`, `/produtos/:slug/`, `/categorias/`,
  `/categorias/:slug/`, `/sobre/`, `/contato/`, `removed.astro`.
- Fluxo de dados: `src/data/catalog.generated.json` (363 produtos) →
  `src/data/catalog.ts` (normaliza e exporta `products`). Collections em
  `src/content/products/*.md` (363 arquivos, frontmatter JSON) e
  `src/content/categories/*.md` (12) existem como espelho.
- `src/data/catalog.ts:58` tem asserção hard-coded `products.length !== 363`
  (e unicidade de slug + grupo válido) — DEVE virar dinâmica.
- Schema das collections: `src/content.config.ts` — NÃO existe campo preço hoje.
- Domínio: `src/domain/product.ts`, `src/domain/category.ts`,
  `src/domain/catalog-group.ts` (10 grupos de apresentação + função
  `catalogGroupForProduct` heurística por legacy category slug + regex no nome).
- Grupos (slugs): musculacao, cardio, funcional-e-crossfit, acessorios-de-treino,
  bancos-e-suportes, barras-halteres-e-anilhas, academias-ao-ar-livre,
  condominios-e-residencias, pisos-para-academias, climatizacao-e-ventilacao.
- Imagens: originais em `public/products/` (433 arquivos) + variantes
  WebP/AVIF em `public/products/variants/` (hash de conteúdo no nome, nunca
  excedem dimensões originais). Pipeline sharp em `scripts/migrate-images.mjs`.
- Redirects: `public/_redirects` (padrão `/dt_galleries/x/ /produtos/x/ 301`);
  conteúdo removido recebe 410 (ver `src/pages/removed.astro` e
  `scripts/validate-redirects.mjs`).
- WhatsApp: `src/lib/whatsapp/index.ts` (`productWhatsApp` inclui nome + Ref.
  code + URL). Telefone único +55 48 99926-3333.
- Testes: `tests/unit/{catalog,seo,whatsapp}.test.ts` (vitest),
  `tests/e2e/catalog.spec.ts` (Playwright via docker, script `test:e2e`).
- Validadores npm: `validate:catalog` (hoje exige >=363 e sourceCount 363 —
  atualizar), `validate:images`, `validate:redirects`.
- `reports/` já existe (JSONs de migração). `.migration/` é cache legado do
  WordPress — NÃO mexer.
- Ambiente: Node v20 + npm com acesso a registry (`https://registry.npmjs.org/`);
  Python 3.13 SEM pandas/pip; `unzip` em `/home/admin/.local/bin/unzip`; NÃO há
  libreoffice/tesseract/imagemagick/poppler. Sharp 0.34 já é dependência.

## Arquivos-fonte (em `/home/admin/santana-site/`, fora do repo — NÃO apagar)

Estrutura comum: bloco de cabeçalho da empresa (rua/CNPJ/site), linha de título
da linha, cabeçalho `CÓDIGO | EQUIPAMENTO | VALOR`, linhas de produto (código,
nome, imagem embutida ancorada na linha, valor R$), rodapés `OBS:`.

1. `LINHA POWER LINE MAR 26.ods` — zip; dados em `content.xml` (namespaces
   table/text/office/draw); ~42 linhas de produto; códigos numéricos 202xx;
   imagens em `Pictures/` (~30 PNG/JPG; célula referencia via
   `draw:frame/draw:image/@xlink:href`); título interno "LINHA TUBOLAR 4
   POLEGADAS". Preço numérico em `office:value` (formatted "R$ 14.098,60").
2. `TABELA TB4PL MAR 2026.ods` — idem; ~75 linhas; códigos `PLxxxxx` (~58
   imagens). ATENÇÃO: código `PL3232` aparece em 2 produtos diferentes
   (AGACHAMENTO SQUAT e AGACHAMENTO Sissy) — código NÃO é único.
3. `tabela acessórios.ods` — idem; ~58 linhas; colunas
   `CÓDIGO | EQUIPAMENTO | QTDE | VALOR UNIT | TOTAL` — usar VALOR UNIT como
   preço. Contém 1 imagem EMF (sem conversor disponível → tratar como ausente).
4. `TABELA SANTANA DE BANCOS SUPORTES.xlsx` — zip OOXML; `xl/sharedStrings.xml`,
   `xl/worksheets/sheet1.xml`, âncoras de imagem em `xl/drawings/drawing1.xml`
   (twoCellAnchor com linha inicial → `r:embed` → `xl/media/imageNN.{png,jpeg}`,
   ~36 imagens). Título "TABELA SANTANA DE SUPORTES".
5. `LINHA ARTICULADA MAR 2026.xls` — BIFF8 legado (Compound Document). Ler
   células com SheetJS (`npm i -D xlsx` — única nova devDependency permitida).
   Imagens: scan de magic bytes no binário encontrou ~6 PNG + ~12 JPEG — extrair
   blobs por extensão de magic bytes até terminador; mapear por âncoras quando
   possível; sem mapeamento confiável → produto sem imagem.
6. `catalago atual com bordas.pdf` — 29 páginas, ZERO fontes (só imagens; 28
   JPEGs DCTDecode + 1). Sem texto extraível. USO: extrair os JPEGs por magic
   bytes para `reports/pdf-images/` (fonte opcional futura). NÃO usá-lo para
   atribuir imagens a produtos agora.

## Decisões aprovadas pelo usuário (obrigatórias)

1. **Preço público**: mostrar valor R$ no card de listagem, na página do produto
   e na mensagem do WhatsApp. Formato pt-BR (`R$ 14.098,60`).
2. **Deduplicação por nome exato normalizado** entre TB4PL e POWER LINE (mesma
   "LINHA TUBOLAR 4 POLEGADAS"): chave = nome sem acentos, lowercase, espaços
   colapsados. Match exato → 1 produto, prevalecendo código e preço do arquivo
   mais recente (TB4PL MAR 2026); imagem = a de maior área/pixels entre os dois,
   em caso de empate a do TB4PL. Nomes diferentes (ex.: "ADUTOR 90KG" vs
   "ADUTOR 80KG") permanecem produtos distintos. Registrar merges no relatório.
3. **URLs antigas**: para cada um dos 363 slugs antigos, se o nome normalizado
   casar com um produto novo → 301 `/dt_galleries/<old>/ /produtos/<new>/` e
   `/produtos/<old>/ /produtos/<new>/`; senão → 410 (regra existente). Manter
   compatibilidade com `scripts/validate-redirects.mjs` (atualizá-lo).
4. **Imagens**: prioridade máxima de qualidade — originais das planilhas em
   resolução nativa (sem upscale). Produto sem imagem extraível ENTRA mesmo
   assim no estado de "ausência" (sem foto), sem forçar matches do PDF. Listar
   todos os sem-imagem em `reports/import-sheets.json`. Extrair JPEGs do PDF
   apenas para `reports/pdf-images/` para uso posterior do usuário.
5. **Taxonomia**: manter os 10 grupos de apresentação. Mapeamento por arquivo:
   TB4PL + POWER LINE (mesclados) → legacy slug `linha-tubolar-4pl-power-line`
   (grupo musculacao); Articulada → `linha-articulada-convergente` (musculacao);
   Bancos/Suportes → `suportes-e-bancos` (bancos-e-suportes); Acessórios →
   dividir pela heurística existente em `catalogGroupForProduct` entre
   `barras-e-acessorios` e `funcional-e-crosfit` (categorySlugs correspondentes;
   o grupo final é derivado pela função existente).
6. Deletar TODOS os 363 produtos/categorias/imagens antigas não referenciadas e
   cadastrar os novos vindos das planilhas (~215–240 esperados).

## Trabalho ordenado

### Fase 1 — Extração e cruzamento (`scripts/import-sheets/` novo)

1. `npm i -D xlsx` no repo.
2. Criar `scripts/import-sheets/parse-ods.mjs`, `parse-xlsx.mjs`,
   `parse-xls.mjs`, `parse-pdf-images.mjs`, `normalize.mjs` (ou um único
   `index.mjs` modular) que produza `reports/import-sheets.json` + dataset
   intermediário (ex.: `reports/import-sheets.dataset.json`).
   - ODS: abrir zip (Node, ex. `fflate`/`adm-zip` se necessário instalar como
     devDep, ou `unzip -p` via child_process — preferir lib JS pura), parsear
     `content.xml` (XML parser nativo ou `fast-xml-parser` como devDep),
     iterar `table:table-row`, capturar texto de células, `office:value` para
     preço, e `draw:image/@xlink:href` dentro das células da linha; registrar
     repeats (`number-rows-repeated`/`number-columns-repeated`). Descartar
     linhas de cabeçalho/empresa/OBS (sem código+valor).
   - XLSX: `sharedStrings` + `sheet1.xml` + `xl/drawings/drawing1.xml`
     (mapear linha → rId → `xl/media/...`).
   - XLS: SheetJS para valores; imagens por scan de magic bytes
     (`\x89PNG\r\n\x1a\n` até IEND, `\xff\xd8\xff` até EOI `\xff\xd9`),
     mapeio best-effort (ordem de âncora); não inferir matches incertos.
   - PDF: extrair JPEGs (scan DCTDecode streams) para `reports/pdf-images/`.
3. Normalização por registro:
   `{ sourceFile, line, rowNumber, code, name, price (number), priceFormatted,
      imageRef | null }` — name: trim + colapsar espaços; código: string; preço:
      número (>0) e formatado pt-BR.
4. Dedupe TB4PL×POWER LINE por chave de nome normalizado (decisão 2). Detectar
   códigos duplicados dentro do mesmo arquivo (caso PL3232): manter ambos como
   produtos distintos, slug com sufixo `-2`, e flag `duplicateCode: true` no
   relatório.
5. Slug: slugify (sem acentos, lowercase, hífen); colisões → sufixo incremental.
   `id`: string sequencial `"1".."N"` na ordem final; `legacyId`: inteiro
   sequencial único (validador exige inteiro único).

### Fase 2 — Imagens (`scripts/import-images.mjs` novo)

1. Extrair binários referenciados dos contêineres para
   `public/products/<slug>.{png,jpg}` (nome final por slug do produto;
   dedupe por SHA-256 de conteúdo quando o mesmo binário serve a N produtos —
   usar hardlink/cópia, tanto faz, mas cada produto referencia seu arquivo).
2. Gerar variantes WebP/AVIF com sharp seguindo o padrão atual
   (`public/products/variants/<slug>-640-<hash10>.webp|.avif`), nunca
   ultrapassando dimensões originais; registrar width/height/bytes/mime.
3. EMF e imagens não extraíveis → produto sem imagem (estado de ausência).
4. ANTES de sobrescrever/apagar: gerar o novo dataset completo; depois REMOVER
   de `public/products/` (e `variants/`) todos os arquivos não referenciados
   pelo novo catálogo (os 433 antigos saem, exceto qualquer um que por acaso
   seja reaproveitado — não deve ocorrer).
5. `originalSrc`: usar o caminho lógico do contêiner de origem (ex.:
   `ods:TABELA TB4PL MAR 2026.ods#Pictures/1000000...png`) para manter
   provenance; `localOriginal`: `/products/<slug>.png`.

### Fase 3 — Catálogo, preço e taxonomia

1. Regenerar `src/data/catalog.generated.json` a partir do dataset final
   (contrato atual de campos + `price: { value: number, formatted: string }`
   ou `price: number` + `priceFormatted: string` — escolher UM formato e usar
   consistentemente em schema/domínio/UI; recomendado: `price` number +
   `priceFormatted` string).
2. Regenerar `src/content/products/*.md` (apagar os 363 antigos, escrever os
   novos com o mesmo shape de frontmatter JSON + preço) e
   `src/content/categories/*.md` (apenas categorias usadas: 4 legacy slugs da
   decisão 5; `productCount` correto).
3. `src/content.config.ts`: adicionar campo preço opcional- obrigatório no
   schema products (todos os novos têm preço; tornar obrigatório simplifica
   validação).
4. `src/domain/product.ts`: tipo com preço. `src/data/catalog.ts`: mapear
   preço; SUBSTITUIR a asserção `products.length !== 363` por: contagem
   dinâmica > 0, slugs únicos, todo produto com grupo válido, todo produto com
   preço > 0.
5. `src/domain/category.ts`: atualizar lista para as categorias usadas.
6. UI: `src/components/catalog/ProductCard.astro` (preço no card),
   página de produto (preço em destaque, ex. ao lado do CTA WhatsApp),
   `src/components/product/*` conforme necessário. Estilo consistente com o
   design atual (Tailwind 4).
7. `src/lib/whatsapp/index.ts`: `productWhatsApp` inclui o preço formatado na
   mensagem (ex.: linha `Valor: R$ 14.098,60` antes da URL). Atualizar
   `tests/unit/whatsapp.test.ts`.
8. Featured/related: revisar `src/lib/home-selection.ts` para selecionar entre
   os novos (sem depender de slugs extintos; se houver lista fixa, recompute
   por critério — ex. produtos com imagem, ordem estável).

### Fase 4 — Redirects

1. Regenerar `public/_redirects`: para cada slug antigo com match de nome
   normalizado → 301 para o novo (também `/dt_galleries/<old>/` → novo);
   sem match → regra 410 existente (seguir o padrão atual do arquivo para
   removidos). Ver `scripts/validate-redirects.mjs` e manter compatível.
2. Atualizar `scripts/validate-redirects.mjs` para o novo conjunto.

### Fase 5 — Validadores e testes

1. `scripts/validate-catalog.mjs`: `sourceCount` dinâmico (contagem do dataset
   em `reports/import-sheets.json`), remover limite `>=363`, adicionar checks:
   preço presente e >0, slug/legacyId únicos, sourceTrace `derived` com
   identifier `sheet:<arquivo>:linha`, imagens com provenance quando existirem.
2. `scripts/validate-images.mjs`: garantir compatível com novo conjunto
   (arquivos sem imagem = estado de ausência aceitável).
3. Atualizar `tests/unit/catalog.test.ts` (contagens/contratos novos),
   `tests/unit/seo.test.ts` se depender de dados, `tests/unit/whatsapp.test.ts`
   (preço na mensagem), `tests/e2e/catalog.spec.ts` (seletores/contagens).

### Fase 6 — Validação final (rodar nesta ordem; tudo deve passar)

```
cd /home/admin/santana-site/santana-site
npm run check
npm test -- --run
npm run build
npm run validate:catalog
npm run validate:images
npm run validate:redirects
npm run test:e2e   # docker + playwright; se ambiente não suportar docker, registrar no resultado
```

Spot-check manual obrigatório (feito pelo executor, sem editar dados a dedo):
comparar 10 produtos amostrados (2 por planilha) — código, nome, preço —
contra os valores lidos das planilhas; e audir o pareamento imagem↔linha das
planilhas ODS/XLSX gerando `reports/import-sheets.contact-sheet.html` (grid
slug + imagem) e revisando visualmente via leitura dos pares nome→arquivo.

## Contratos públicos a preservar

- Rotas e shapes de URL listados no README (paginacao inclusive —
  `/produtos/pagina/:page/` deve paginar o novo total).
- Telefone WhatsApp único e origem HTTPS de produção na mensagem.
- Variante de imagem nunca excede dimensão original; hash de conteúdo.
- Estado de "ausência" de imagem continua renderizando (sem foto).
- NÃO fazer: commits, pushes, PRs, ou qualquer escrita remota; não deletar os
  arquivos-fonte em `/home/admin/santana-site/`; não alterar `.migration/`.

## Critérios de aceite

1. Zero produtos antigos restantes (nem em JSON, nem em md, nem imagens órfãs
   em `public/products/`).
2. Novo catálogo gerado 100% a partir das 5 planilhas; contagem conferível com
   `reports/import-sheets.json` (linhas de produto − merges exatos).
3. Todo produto: slug único, legacyId único, nome, código (quando houver),
   preço > 0 formatado pt-BR, categoria legacy atribuída por decisão 5, grupo
   derivado válido, sourceTrace derivado com arquivo+linha.
4. Preço visível no card, na página de produto e no WhatsApp (teste unitário
   cobrindo a mensagem).
5. Dedupe TB4PL×POWER LINE aplicado; merges listados no relatório; caso
   PL3232 resolvido com sufixo e flag.
6. `_redirects` com 301 para matches e 410 para o resto; validador verde.
7. Todos os comandos da Fase 6 passando (exceto `test:e2e` se docker
   indisponível — então reportar explicitamente).
8. `reports/import-sheets.json` (contagens, merges, sem-imagem, anomalias) e
   `reports/pdf-images/` (JPEGs do PDF) gerados.

## Tratamento de falha

Se houver ambiguidade material, input externo necessário ou falha de validação
irrecuperável: parar e retornar relatório curto de bloqueio (o que falta, o que
foi feito, comando que falhou). Não contornar validações editando-as para
passar sem sentido; validadores mudam apenas para refletir o contrato novo
acima.
