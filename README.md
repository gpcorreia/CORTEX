# Ecomm — Workflows

Node.js + TypeScript + Express, frontend TypeScript e Tailwind. Sem React ou login. O Workspace continua a usar os ficheiros locais existentes.

Iniciar com npm run dev e abrir http://127.0.0.1:1000 (ou a porta indicada no terminal). npm run build recompila o frontend e o Tailwind.

## Utilização

1. Em Product Research, escolher Preparar teste. Aceita 1–3 concorrentes (advertorial + sales page), idioma/mercado, moeda e branding. Com branding, marcar «Vou vender o mesmo produto do concorrente» permite guardar sem fotografia (`sameProduct: true`). A referência vem dos downloads; o produto é preservado e apenas a marca visível e o texto a localizar são editados. Um produto sem marca/texto a alterar fica intacto, sem geração de imagem. Se o produto for diferente, a fotografia continua obrigatória. Sem branding, a fotografia é opcional. Os registos antigos mantêm o comportamento anterior.
2. Guardar inputs só guarda. O modal mostra Start workflow e Agora não. Start workflow inicia/reabre a execução e navega para /workflows/<produto>.
3. Workflows é o monitor: lista, pesquisa, estados, filtros e paginação. Cada execução tem uma página com sessões ligadas e estado atualizado.
4. Download recolhe só imagens/GIFs úteis para as pastas copy. Ao terminar todas as páginas, o backend converte localmente as imagens estáticas para WebP e só depois pede revisão. Dimensões e transparência são preservadas, GIFs/animações e WebPs existentes ficam intactos. Os ficheiros originais convertidos ficam arquivados byte a byte em content/originals. Sem IA para download ou conversão. Podem correr até quatro produtos em paralelo, configurável por MAX_CONCURRENT_DOWNLOADS (1–8). O mesmo produto não pode descarregar duas vezes em simultâneo.
5. Ao terminar, fica Pending validation. Com branding, colocar a seleção em advertorial/generator e content/generator e clicar Validar seleção e criar branding. Só estes ficheiros entram no trabalho de media. Sem branding, confirmar os downloads dispensa produto/master/edições e não chama IA.
6. Com branding, a primeira chamada à IA sugere três marcas. Em alternativa, Guardar nome (sem IA) permite escolher uma marca própria. A marca escolhida cria um único logo SVG transparente em `brand/logo.svg` e um master transparente do produto com esse logo aplicado. O servidor compõe localmente as bundles escolhidas a partir desse master.
7. O servidor mostra logo, master e bundles e aguarda validação humana. Só depois da aprovação o servidor inicia a edição das imagens selecionadas no generator, usando o logo e o master aprovados como referências. O backend importa os resultados, conserva backups e monta animações localmente. Falhas ficam pendentes sem repetição automática.

O percurso tem 5 sessões: parâmetros, download, Brand & Media, Translation com versão local e revisão, e Funnelish. A última continua por implementar. Não existe uma sessão separada para revisão local nem é iniciada qualquer transferência.

8. O download também recolhe o HTML renderizado sanitizado, a ordem dos blocos e estilos desktop/mobile na mesma navegação das imagens, sem IA e sem scripts de tracking. Em produtos antigos sem essa recolha, usar Recolher estrutura em falta (sem IA); os projetos antigos não são migrados automaticamente.
9. Depois de aprovar o download, a sessão Translation fica disponível mediante confirmação explícita do utilizador. Brand & Media não bloqueia a tradução: se estiver incompleto ou falhar, o erro continua visível e as imagens pendentes podem ficar vazias na versão local, mas os textos podem ser traduzidos. A IA recebe só blocos únicos de texto e a referência integral de tradução; cache por idioma, moeda, marca, texto e versão da prompt evita repetir o que já está traduzido. Retomas guardam os blocos válidos mesmo se outros falharem. Não são feitas traduções reais durante testes.
10. Na mesma sessão Translation, abrir advertorial e sales page, alternar Desktop/Mobile e clicar Aprovar tradução e versão local. O HTML é montado por código com as imagens locais e a ênfase original. Scripts, integrações e fontes externas não são executados; elementos dinâmicos e diferenças visuais ficam assinalados para revisão. Questões factuais, como taxas de câmbio em falta, bloqueiam os blocos afetados em vez de serem inventadas. A aprovação não publica nem transfere.

Na tradução, o servidor classifica por código headlines e grupos compactos de cinco benefícios/garantias do checkout. A IA recebe essa função juntamente com o texto: headlines devem procurar caber em até cinco linhas mobile e USPs numa linha a 390 px, sempre sem remover factos, alterar números ou inventar promessas. O preview preserva o CSS computado, cores, caixas, ênfase e nomes de fontes recolhidos. Ficheiros de fontes externas não são executados nem arquivados nesta fase; quando não existem localmente, o browser usa fallback e a limitação permanece visível para revisão.

Ficheiros: funil/copy/competitor-N/{advertorial,content}/{page.json,page.html,styles.css}; funil/traducao/competitor-N/{advertorial,content}.json; funil/preview/competitor-N/{advertorial,content}.html. Estado em data/translations e cache de texto em tmp/product-media-jobs/<id>/translation. A reprodução local é uma base visual sanitizada, não um arquivo executável das integrações do concorrente. A referência de tradução permanece byte a byte intacta.

## Ficheiros do produto

projects/<produto>-<locale>/ mantém ads/copy e generator, advertorial/copy e generator, brand/, content/copy e generator, content/manifest.json e product.md. Não há projeto intermédio para downloads. Os originais selecionados são preservados em copy/selected-<hash> quando necessário. Os resultados ficam em generator e os artefactos de marca em brand/ com revisão no nome. Frames, folhas de contacto e cache de animações ficam em tmp/product-media-jobs/<id>/, fora do produto final.

No fluxo novo, a seleção completa entra num único pedido de edição. Frames únicos de animações são preparados por código e os resultados são montados localmente, preservando dimensões, duração e repetição. Os ficheiros originais ficam nos backups; só as entradas editadas são substituídas no generator. Resultados recebidos ficam também em tmp/product-media-jobs/<id>/brand-batch-r<revisão>/result.json.

Branding usa os artefactos `brand/logo.svg`, `brand/product-master-r<revisão>` e `brand/pack-<quantidade>-r<revisão>.webp`. Os packs são composições locais do master já marcado; não entram na seleção de imagens do generator.

## Estado e custos

`npm run usage:tokens` mostra os contadores locais por execução e etapa, sem chamar IA. O cache já está incluído nos tokens de entrada: não deve ser somado novamente. Estes registos não incluem todo o consumo desta conversa, a faturação própria de ferramentas de imagem ou necessariamente chamadas falhadas; não são uma fatura da conta.

As tarefas automáticas do Codex usam respostas de baixa verbosidade e limitam cada resultado de ferramenta guardado no histórico a 4000 tokens. Isto reduz contexto excessivo quando as ferramentas produzem saídas longas; não limita a referência de tradução, o resultado JSON, o raciocínio ou a qualidade das imagens. O ganho efetivo depende das próximas execuções. Modelo, aprovações, caches e ausência de retries automáticos mantêm-se. Configuração documentada em https://learn.chatgpt.com/docs/config-file/config-reference.

- data/inputs/<id>.json: parâmetros guardados.
- data/workflows/<id>.json: download e revisão.
- data/branding/<id>.json: marca, seleção congelada por hash, aprovação e adaptações.

Downloads em paralelo; tarefas de IA numa fila única para controlar recursos. CLI autenticado com ChatGPT e sem chaves API no processo filho. Sem compras de créditos ou fallback pago. Tokens conhecidos ficam por execução; não são convertidos numa fatura API fictícia. Parâmetros e seleção alterados invalidam a continuação dependente.

## Onde alterar

- backend/app.ts: segurança, middleware e montagem das rotas.
- backend/routes/apiRoutes.ts: research, inputs e status.
- backend/routes/workflowRoutes.ts: recolha e compatibilidade com o fluxo anterior.
- backend/routes/monitorRoutes.ts: monitor e ações das sessões.
- backend/services/mediaJobs.ts e mediaCollector.ts: downloads.
- backend/services/workflowMonitor.ts: representação do percurso e transições.
- backend/services/branding.ts: aprovação do master e adaptações.
- backend/services/funnelCapture.ts: estrutura, HTML sanitizado e estilos recolhidos na visita de media.
- backend/services/translationContext.ts: pré-condições e fingerprint textual da tradução, deliberadamente independentes de Brand & Media.
- backend/services/siteTranslation.ts: tradução por blocos, cache, montagem das versões locais e aprovação.
- backend/services/funnelPreview.ts: aplicação de texto com validação de estrutura e referências locais.
- backend/controllers/translationController.ts: endpoints da sessão Translation, previews e ficheiros locais.
- backend/tools/images.ts: conversão local para WebP após download e importação das imagens geradas, sem IA.
- backend/services/animation.ts: frames, zonas estáticas, cache e montagem local de GIF/WebP animado.
- backend/services/bundles.ts: composição local dos packs.
- backend/services/codexTask.ts: execução estruturada do Codex.
- backend/public/src/app.ts: pesquisa e modal de inputs.
- backend/public/src/workflows.ts: monitor e página da execução.
- agents/prompts/02-brand-and-media.md: ?nica prompt de Branding & Media, com quatro linhas; opera??o, dados necess?rios e refer?ncia de tradu??o s?o acrescentados pelo c?digo.
- agents/references/translation-prompt.md: referência integral preservada.

## Verificação

npm run build e npm test. Tests de branding usam adaptadores falsos, sem geração paga. O compositor de bundles é testado com imagens locais reais. APP_URL=http://127.0.0.1:1000 node tests/workflow-browser.mjs verifica separação guardar/iniciar, foto obrigatória, navegação, gates e mobile com IA simulada. A qualidade real da geração e a disponibilidade do imagegen no CLI precisam de ser confirmadas no primeiro produto executado pelo utilizador; não são garantidas pelos testes simulados.

## Cortex — Shopify

`backend/configs/shopify.ts` prepara o cliente GraphQL Admin API. Preencher no `.env` (os campos já existem):

```dotenv
SHOPIFY_SHOP_DOMAIN=nome-da-loja.myshopify.com
SHOPIFY_ADMIN_ACCESS_TOKEN=
SHOPIFY_API_VERSION=2026-10
```

É necessário um token Admin API com `read_orders`, não apenas API key/client secret. Consultas além dos 60 dias exigem acesso `read_all_orders`. Referências oficiais: [tokens](https://shopify.dev/docs/apps/build/authentication-authorization/access-tokens), [orders](https://shopify.dev/docs/api/admin-graphql/latest/queries/orders), [permissões de histórico](https://shopify.dev/docs/api/admin-graphql/latest/objects/Order).

`GET /api/shopify/orders?from=2026-11-01&to=2026-11-05` lê 50 encomendas por página; continuar com `after=pageInfo.endCursor` enquanto `hasNextPage`. A resposta é para revisão e não importa registos. Não inclui nomes, emails ou moradas dos clientes. Linhas de encomenda são limitadas a 100 e indicam `hasNextPage`, sem truncagem silenciosa para importação.

Próxima fase: usar estas encomendas na página de Campanhas, persistência idempotente, mapeamento de loja/produto/campanha e tratamento de moeda/reembolsos. `npm run build` e `npm test` validam compilação, regras e rotas; os testes não usam a Shopify real.
