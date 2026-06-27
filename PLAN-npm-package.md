# Plano: transformar o qa_executor em `@krafters/qa-engine` (npm package genérico)

> Status: **rascunho / a pensar depois** (deliverable no backlog da krafters).
> Não começar sem decidir as "Decisões em aberto" abaixo.

## Objetivo

Fechar a dependência do QA. Hoje o QA depende desta pasta colocada à mão
(`~/projects/krafters/qa_executor`) com Playwright pinado, Chromium cacheado e
ffmpeg. Queremos transformar o **engine** num **npm package genérico e
publicável** que o MCP "pluga" via diretrizes (não via binário), com a **menor
fricção possível**: instalou nada à mão, só rodou.

## Princípio de arquitetura

O MCP é um **servidor** — ele não instala software na máquina do usuário nem roda
Playwright lá. Quem roda o QA local é o **agente (Claude Code)** via Bash. Então o
package não é "anexado" ao MCP; o MCP **prescreve a receita** (nome do package +
versão pinada + invocação + env) nas `qa_directives`/esteira, e o agente roda
`npx @krafters/qa-engine@<pin> …` localmente (o npx resolve a instalação on-demand,
com cache).

## Split de pacotes (manter o engine "bem genérico")

- **`@krafters/qa-engine`** (genérico, publicável; nada de Krafters):
  - engine: auth same-origin, frame composto 16:9 (console à esquerda + app em
    iframe à direita), cursor/ripple, espera de hidratação, captura de network,
    transcode H.264 < 50MB (vem de `lib/harness.mjs`).
  - CLI (`krafters-qa` / `qa-engine`): `record`, `serve`, `run` (turnkey).
  - API de biblioteca: `import { record } from "@krafters/qa-engine"` para
    cenários autorais (é o que o `record.mjs` já faz hoje contra `lib/harness.mjs`).
  - opcional: "recipes" genéricas (open page, click, fill, assert) pra QAs simples
    não precisarem de código.
- **App-specific fica fora do package** (no repo krafters-admin, ou um thin
  `@krafters/qa-recipes`): os page helpers tipo `lib/krafters.mjs`
  (`openDeliverable`, `openDrawer`, `openEdit`, `setStatus`, …) e os cenários por
  deliverable (`record.mjs`). Assim o engine serve qualquer projeto e o que é da
  Krafters não polui.

## Zero passo manual de browser (requisito central)

Não exigir `npx playwright install chromium`. O engine controla isso:

1. **Postinstall automático**: depender do pacote **`playwright`** (full, não
   `playwright-core`) — o postinstall dele baixa o browser quando o package é
   instalado (inclusive no primeiro `npx`). Some o passo manual.
2. **Self-heal no startup (cinto e suspensório)**: o CLI checa, antes de gravar,
   se a revisão pinada do Chromium existe; se não, roda `playwright install
   chromium` programaticamente. Resiste a ambientes que pulam o postinstall
   (CI/sandbox com `PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD`).
3. **Pin determinístico**: a versão do `playwright` no package fixa a revisão exata
   do Chromium → acaba o gotcha 1.61 ↔ chromium-1228.
4. **ffmpeg** via `ffmpeg-static` (dep do package). macOS não precisa
   `--with-deps`/sudo (só Linux precisa de libs de SO).
5. Cache controlável via `PLAYWRIGHT_BROWSERS_PATH` (path fixado pelo engine) +
   mensagem de progresso no primeiro download.

**Custo que permanece (inerente):** o download do Chromium (~150MB, por
plataforma) acontece **uma vez por máquina**, automático e cacheado. Depois, zero.

## Integração com o MCP

- `qa_directives` (e a esteira / bloco `pipeline`) passam a retornar:
  - o **comando exato**: `npx @krafters/qa-engine@<versão-pinada> record
    --target <path> --viewport desktop|mobile --deliverable <id> --out <mp4>`;
  - o **env** necessário (origin/credenciais/DB) e os limites (16:9, <50MB);
  - a referência de que cenários app-specific ficam no repo.
- O fluxo de upload continua igual (`get_qa_upload_url` → PUT → `add_qa_video` →
  `complete_qa_run`).

## O que continua custando por rodada (não muda com o package)

- **`next build` do app sob teste** (build de produção — dev/HMR não hidrata
  headless). É o passo lento; amortizado pelo server quente (`serve`: builda 1x,
  regrava N vezes). O package **não** builda o app do usuário.
- **Supabase local de pé** + credenciais/env.
- **Cenário por deliverable** (autoral; recipes genéricas reduzem, não eliminam).

## Passos de migração (deste folder → package)

1. Extrair `lib/harness.mjs` (+ cursor/console/transcode) como núcleo do
   `@krafters/qa-engine`; tornar genérico (sem nada hardcoded de Krafters).
2. Expor CLI (`record`/`serve`/`run`) e API de biblioteca.
3. Mover `playwright` (full) + `ffmpeg-static` pra deps; implementar
   `ensureBrowser()` (self-heal) e pin do Chromium.
4. Mover `lib/krafters.mjs` + cenários pro repo krafters-admin (ou
   `@krafters/qa-recipes`).
5. Publicar (decidir registry: npm público vs privado/GitHub Packages).
6. Atualizar `qa_directives`/esteira no MCP pra apontar `npx <package>@<pin>`.
7. Documentar o turnkey: `npx @krafters/qa-engine run --app-dir <worktree>
   --target <path> --out out/qa-desktop.mp4`.

## Decisões em aberto (pensar depois)

- **Registry**: npm público (engine genérico) vs privado (GitHub Packages)?
  Recomendação: engine público + recipes Krafters separadas/privadas.
- **Recipes genéricas**: quanto investir num DSL de passos (open/click/fill/
  assert) pra QA sem código vs sempre escrever cenário?
- **Versão pinada no MCP**: como o MCP conhece a versão (env/config do workspace?).
- **Sandbox/headless em prod (runner)**: o mesmo engine serve o runner serverless?
- **Gate de QA sem UI**: deliverables backend/MCP → QA por teste de integração,
  não vídeo (já virou regra da esteira).

## Referência do estado atual (o que já existe e migra)

- `lib/harness.mjs` — engine reusável (auth, frame composto, console, cursor,
  hidratação, transcode). Vira o núcleo do package.
- `lib/krafters.mjs` — page helpers Krafters. Sai do package (app-specific).
- `record.mjs` — cenário por deliverable. Sai do package (autoral).
- `serve.sh` / `run.sh` — viram subcomandos do CLI.
- `config.env` — vira flags/env do CLI.
- Gotchas já resolvidos no engine: prod build obrigatório, flags de
  LocalNetworkAccess do Chromium, harness same-origin via `/__qa_harness`,
  pin Playwright↔Chromium.
