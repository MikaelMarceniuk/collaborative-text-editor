# E2E: dois navegadores no mesmo documento

> **Estado: implementado** na branch `feat/e2e`, um commit por passo da seção "Passos e commits", mais um de estabilidade (ver abaixo). O que mudou na prática em relação ao plano está em "Diferenças do plano", no fim. Segunda metade da semana 6 (a primeira é o Redis, `docs/redis.md`).

Hoje o server tem testes (Vitest + Supertest + clientes de socket) e o web não tem nenhum. Tudo o que depende de um navegador de verdade foi validado à mão, com um script descartável do Playwright fora do repositório: o editor convergindo, o cursor dos outros, os avatares, a reconexão. E foi no navegador que apareceram os bugs que os testes do server não pegariam (o `volatile` descartado no mesmo tick, o loop do `y-tiptap`, o cursor passando na frente do texto; ver `docs/presence.md` e `docs/realtime.md`).

Este plano põe isso no repositório como teste automático, e cobre o que ainda nunca rodou com navegadores: **duas instâncias do server ligadas pelo Redis** (`docs/redis.md`, "Não validado num navegador com duas instâncias").

## O que o E2E prova (e o que não)

Prova que a pilha inteira funciona junta: Vite → proxy → Express/Socket.IO → Mongo (e Redis), com o React, o Tiptap e o Yjs de verdade no navegador. Não repete o que os testes do server já cobrem em detalhe (permissões por rota, o protocolo do `serverSideEmit`, o rate limit); só confere os caminhos que o usuário percorre.

## Decisões

- **Um pacote novo, `apps/e2e`**, em vez de testes dentro do `apps/web`. O teste cruza web e server (e dois servers), então não pertence a nenhum dos dois, e as dependências (`@playwright/test`, `mongodb`) não entram no build do web nem do Fly. O `pnpm-workspace.yaml` já pega `apps/*`. O pacote **não** define `start:dev`, para o `pnpm dev` da raiz (`pnpm --parallel -r start:dev`) não tentar subi-lo.
- **Só Chromium.** O editor e o Socket.IO não têm código específico de navegador, e cada navegador a mais é tempo de CI sem pegar bug nosso.
- **Os serviços sobem pelo `webServer` do Playwright**, sem script próprio: o Playwright espera cada porta ficar de pé, derruba tudo no fim e mostra o log do processo quando falha. São quatro processos:

  | Processo | Porta | Observação |
  |---|---|---|
  | server A | 3333 | `tsx src/server.ts` (sem `watch`), `WEB_URL=http://localhost:5173` |
  | server B | 3334 | idem, `WEB_URL=http://localhost:5174` |
  | web A | 5173 | Vite, proxy de `/api` para 3333 |
  | web B | 5174 | Vite, proxy de `/api` para 3334 |

  Os dois servers usam o mesmo Mongo, o mesmo `BETTER_AUTH_SECRET` e o mesmo `REDIS_URL`: são duas instâncias do mesmo sistema. Cada um precisa do `WEB_URL` do seu Vite, porque o CORS e o `trustedOrigins` do better-auth aceitam uma origem só (`cors.ts`, `better-auth.ts`), e o navegador manda como `Origin` a do Vite onde a página foi aberta.
- **O proxy do Vite passa a ser configurável.** Hoje o alvo é fixo (`http://localhost:3333`, em `vite.config.ts`). Ele passa a ler `API_URL` (padrão `http://localhost:3333`, então o dev não muda). É a única mudança em código de produção que este plano exige.
- **Banco próprio: `collaborative-editor-e2e`.** O `MONGO_URL` do E2E aponta para outro banco do mesmo Mongo do `compose-dev.yml`, então rodar o E2E não suja os documentos de desenvolvimento. O `globalSetup` apaga esse banco antes de tudo, e depois cada teste cria os próprios usuários com e-mail único, sem depender de limpeza entre testes (e podendo rodar em paralelo).
- **Redis obrigatório no E2E.** Um server com `REDIS_URL` e um sem Redis seriam duas configurações a manter; os dois servers do E2E sempre sobem com Redis. Local: o Mongo e o Redis do `compose-dev.yml` (`docker compose -f compose-dev.yml --profile redis up -d --wait`); o Mongo é o mesmo do dev, só o banco muda. Os processos do server e do web **não** são os do `pnpm dev` e usam as mesmas portas (ver "Riscos"). No CI: ver "CI".
- **Contas pelo caminho real, atalho só na verificação de e-mail.** O sign-up exige e-mail verificado (`requireEmailVerification`), e o e-mail em dev só vai para o console do server. Em vez de capturar o stdout, o helper cria o usuário pelo `POST /api/auth/sign-up/email` e marca `emailVerified: true` direto na coleção `user` do Mongo (foi o que funcionou na validação manual). Os testes de colaboração não passam pela tela de cadastro; **um** teste de auth passa (ver cenários), até a tela "Check your email".
- **Login pela API, por contexto.** O helper entra com `context.request.post('/api/auth/sign-in/email')`, que guarda o cookie no mesmo contexto do navegador, e a página já abre logada. Precisa mandar o header `Origin` da origem do Vite do contexto, senão o better-auth recusa por CSRF. Um contexto por pessoa, nunca duas pessoas na mesma `page`.
- **Documento e convite pela API, quando não são o que se testa.** `POST /api/documents` e `POST /api/documents/:id/members` com o contexto do dono. Só o teste de compartilhamento usa o diálogo. Cada teste cria o próprio documento, então não há ordem entre testes.
- **Seletores por papel e rótulo**, como o usuário enxerga, e sem `data-testid`: o editor é `.ProseMirror[contenteditable]`; o status é `role=status` ("Saved", "Saving…", "Offline"); os avatares são `role=group` com `aria-label="People in this document: …"`; o caret dos outros é `.collaboration-carets__caret` com `.collaboration-carets__label`; o cadastro tem labels (`Name`, `Email`, `Password`). Só entra `data-testid` se algum seletor não for estável sem ele, e cada um vai para o commit que o precisa.
- **Sem `sleep`.** Convergência se espera com `expect(...).toHaveText(...)` e `expect.poll`, que repetem até o timeout. O único atraso do sistema é o debounce de gravação (2s, máximo 10s), e ele só importa nos testes que recarregam a página: ali a espera é o "Saved" do indicador.
- **Mesmos testes, duas topologias.** Dois projetos do Playwright rodam os mesmos arquivos de cenário de colaboração e só mudam a origem em que o segundo usuário abre a página:
  - `one-instance`: Alice e Bob em `localhost:5173` (server A).
  - `two-instances`: Alice em `5173` (server A) e Bob em `5174` (server B).

  Se tudo passa nos dois, o Redis não mudou o comportamento visível. Os testes recebem a origem de cada pessoa por uma fixture, não conhecem a topologia. Os cenários que só fazem sentido com duas instâncias ficam em arquivo próprio, só no projeto `two-instances`.
- **Alvo é o dev server do Vite, não o build.** É o que roda no dia a dia, sobe em segundos e o proxy com `ws: true` é o mesmo. O build é validado pelo `web-ci`. A diferença (React em modo dev, StrictMode montando duas vezes) só deixa o teste mais exigente.
- **Falha guarda trace.** `trace: 'on-first-retry'`, `retries: 1` no CI e 0 local, `screenshot: 'only-on-failure'`. Os diretórios (`test-results`, `playwright-report`) já estão no `.gitignore`.

## Estrutura

```
apps/e2e/
  package.json            # @playwright/test, mongodb; scripts: test, test:ui
  playwright.config.ts    # webServer x4, projetos one-instance e two-instances
  global-setup.ts         # apaga o banco collaborative-editor-e2e
  tsconfig.json
  src/
    env.ts                # portas, origens, MONGO_URL do E2E
    mongo.ts              # marcar emailVerified
    fixtures.ts           # alice, bob: contexto + página logada na origem certa
    api.ts                # criar documento, convidar, ler o documento (via request)
    editor.ts             # digitar no editor, ler o texto, esperar "Saved"
  tests/
    auth.spec.ts
    sharing.spec.ts
    collaboration.spec.ts
    presence.spec.ts
    persistence.spec.ts
    multi-instance.spec.ts  # só no projeto two-instances
```

## Cenários

Cada um é um `test` independente, com usuários e documento próprios.

**`auth.spec.ts`**
1. Cadastro pela tela leva a "Check your email" e, depois de verificar o e-mail (helper), o login pela tela abre a lista de documentos.
2. "Continue as guest" cria um guest, que cria um documento e não vê a opção de compartilhar (cai no prompt "Create an account to share documents").

**`sharing.spec.ts`**
3. A Alice cria um documento, convida o Bob como editor pelo diálogo "Share" e o Bob vê o documento na lista, com o selo "Shared · Editor". Depois a Alice troca o papel dele para "Viewer" e remove o Bob: o documento some da lista do Bob.

**`collaboration.spec.ts`** (nas duas topologias)
4. **Convergência.** Alice e Bob abrem o mesmo documento; cada um digita um parágrafo (um depois do outro, e depois os dois ao mesmo tempo); os dois editores terminam com o mesmo texto, com os dois trechos presentes. É o cenário que o README promete ("dois usuários editando em paralelo").
5. **Leitor não edita.** O Bob entra como viewer: vê o texto da Alice chegando, o indicador "View only" aparece e o editor dele não aceita digitação.
6. **Mudança de papel com o documento aberto.** A Alice rebaixa o Bob de editor para viewer com o documento aberto nos dois lados; o editor do Bob passa a só leitura sem recarregar, e o texto que ele digitar depois não chega à Alice.
7. **Remoção com o documento aberto.** A Alice remove o Bob; a página dele sai do documento (erro/redirecionamento, conforme o comportamento atual: o teste fixa o que o app faz hoje, não o que deveria fazer).

**`presence.spec.ts`** (nas duas topologias)
8. **Quem está aqui.** O avatar do Bob aparece no header da Alice com o nome certo (`aria-label`); duas abas do Bob continuam sendo um avatar; ao fechar a aba o avatar some em poucos segundos.
9. **Cursor e seleção.** O Bob clica em uma posição e a Alice vê o caret dele com o rótulo "Bob", na cor do avatar; o Bob seleciona um trecho e a Alice vê a seleção destacada. Os dois sentidos.
10. **Cursor não passa na frente do texto.** O Bob digita 40 caracteres seguidos; em nenhum momento o caret dele some do editor da Alice (amostra a cada frame durante a digitação). É a regressão que o teste do server (`relays the presence after the document update`) cobre só do lado do server.

**`persistence.spec.ts`**
11. **Sobrevive ao reload.** A Alice digita, espera o "Saved", recarrega a página, e o texto está lá; o Bob, que entra depois, também vê.
12. **Offline e volta.** O Bob fica offline (`context.setOffline(true)`, o indicador mostra "Offline"), digita, e a Alice digita ao mesmo tempo; ao voltar online os dois textos aparecem nos dois editores. *A conferir no passo 7:* se o Chromium derruba o WebSocket já aberto com `setOffline`. Se não derrubar, o teste fecha o socket de outra forma (`page.routeWebSocket` ou um `window.__socket.disconnect()` exposto só em dev) ou fica de fora; o caso fica registrado em "Diferenças do plano".

**`multi-instance.spec.ts`** (só `two-instances`)
13. **Entrar na outra instância pega o que ainda não foi gravado.** A Alice (server A) digita e **sem esperar o "Saved"** o Bob abre o documento pelo server B: ele vê o texto (vem do `room:state` das salas, não do Mongo, que ainda não recebeu a gravação do debounce).
14. **Papel e remoção atravessam instâncias.** A Alice (A) remove o Bob (B) com o documento aberto: o socket dele é desconectado mesmo estando em outra instância (`io.in(...).disconnectSockets()` pelo adapter).
15. **Documento apagado.** A Alice apaga o documento enquanto o Bob o tem aberto em B; a sala some nas duas instâncias e o Bob sai (`room:drop`).

Não entram: cada formatação do Tiptap (negrito, listas, imagens), a busca e substituição, o tema claro/escuro, o layout de celular (já validados à mão e sem lógica de sincronização). O que cai aqui entra nos passos como adição, não como refatoração.

## CI

Um workflow novo, `.github/workflows/e2e.yml`, separado dos CIs do server e do web (que têm `paths` por app; o E2E depende dos dois, então roda em PR e em `push` para `master` quando mudar `apps/**`, `pnpm-lock.yaml` ou o próprio workflow).

- **Mongo e Redis pelo `compose-dev.yml`** (`docker compose -f compose-dev.yml --profile redis up -d --wait`), e não por `services:`: o sign-up do better-auth abre transação e precisa do Mongo como replica set, e o `compose-dev.yml` já sobe assim, com o healthcheck que faz o `rs.initiate`. O `mongo:8` simples que o `server-ci.yml` usa não serve aqui.
- Instalar com `pnpm install --frozen-lockfile`, depois `pnpm --filter @collaborative-text-editor/e2e exec playwright install --with-deps chromium`. Cachear `~/.cache/ms-playwright` pela versão do Playwright.
- No CI o `BETTER_AUTH_SECRET` do E2E é um valor fixo no próprio config do Playwright (não é segredo: o banco é descartável).
- Em falha, subir `playwright-report` e `test-results` (traces) com `actions/upload-artifact`.
- **Não entra no `cd.yml` por enquanto.** O deploy já depende dos CIs do server e do web; um E2E de 2 a 3 minutos no caminho do release só vale depois de estável (um E2E que falha por flakiness e bloqueia o deploy é pior que não ter). Decidir depois de umas semanas de histórico.

## Passos e commits

1. `docs`: este plano e o estado no `planner.md`.
2. `chore(web)`: o proxy do Vite lê `API_URL` (padrão igual ao de hoje).
3. `chore(e2e)`: o pacote `apps/e2e` com o Playwright, o `globalSetup`, os quatro `webServer` e um teste de fumaça (a página de login abre nas duas origens e `/api/health` responde nas duas). Aqui já se vê se os quatro processos sobem e se a mudança do passo 2 funciona.
4. `test(e2e)`: helpers (`mongo`, `fixtures`, `api`, `editor`) e `auth.spec.ts`.
5. `test(e2e)`: `sharing.spec.ts`.
6. `test(e2e)`: `collaboration.spec.ts` nos dois projetos (cenários 4 a 7).
7. `test(e2e)`: `persistence.spec.ts` (cenários 11 e 12; aqui se resolve a dúvida do offline).
8. `test(e2e)`: `presence.spec.ts` (8 a 10).
9. `test(e2e)`: `multi-instance.spec.ts` (13 a 15).
10. `ci`: o workflow `e2e.yml` e os scripts na raiz (`pnpm e2e`).
11. `docs`: fechar o plano (README, `planner.md`, `todos.md`, `redis.md`, "Diferenças do plano").

Ordem pensada para cada passo deixar o repositório verde e útil sozinho; os passos 4 a 9 só acrescentam arquivos de teste.

## Riscos e pontos a conferir

- **Portas ocupadas.** O E2E usa 3333/3334 e 5173/5174, as mesmas do `pnpm dev`. Com o dev ligado, o `webServer` falharia (ou, pior, `reuseExistingServer` apontaria o E2E para o server de desenvolvimento). Solução: o E2E não reutiliza servidor existente (`reuseExistingServer: false`) e o config falha com mensagem clara se a porta estiver ocupada. Se incomodar, as portas do E2E mudam para uma faixa própria (4333/4334, 6173/6174) nos passos 2 e 3, sem custo; fica como decisão do passo 3.
- **Chromium nesta máquina.** O Fedora Asahi (aarch64) não é um sistema que o Playwright suporte oficialmente. O que funcionou até agora foi o Chromium 1140 em cache (`playwright-core` 1.50). A versão nova do `@playwright/test` vai querer outro build; se o `playwright install` não achar um para este sistema, a saída é fixar a versão do Playwright que casa com o cache ou usar `executablePath`. Aparece já no passo 3. No CI (Ubuntu) não há problema.
- **Flakiness de tempo.** Tudo que depende do debounce de gravação (2 a 10s) e do timeout de presença (30s para uma aba que morre sem avisar) é lento por natureza. Os testes usam o caminho rápido (fechar a aba avisa na hora, `awareness:left`) e esperam o "Saved" em vez de adivinhar tempo. O timeout de cada `expect` sobe para 10s nos cenários de convergência.
- **StrictMode no dev server.** Monta o editor duas vezes; o socket e o Awareness já lidam com isso (foi validado à mão), mas é onde um teste novo pode expor um bug de verdade. Se expor, é achado, não flakiness: vai para a seção "Diferenças do plano".
- **Rate limit do convite.** É por usuário e por hora (`MAX_INVITES_PER_HOUR`), e cada teste cria usuários novos, então não acumula entre testes. Se algum teste convidar muita gente, conferir o limite.
- **Custo no CI.** Cerca de 1 minuto de instalação do Chromium (cacheado), 20 a 40s para subir os quatro processos e o tempo dos testes, que rodam em paralelo por arquivo. Meta: menos de 5 minutos no total.
- **O e-mail verificado pelo Mongo é um atalho.** Se o schema do `user` do better-auth mudar o nome do campo, o helper quebra de forma óbvia (o login falha); está isolado em `mongo.ts`.

## Fora do escopo

- Teste visual (screenshots comparados), acessibilidade automatizada e teste de performance.
- Firefox e WebKit.
- Derrubar e reiniciar um server no meio do teste. A queda do server e a do Redis já têm testes de integração (`socket-server.test.ts`, `multi-instance.test.ts`); com o Playwright exigiria um controlador de processos próprio, e só valeria a pena se aparecer um bug que o teste de integração não pegou.
- Rodar contra o deploy real (Fly + Vercel). A confirmação de que `/api/socket.io` aceita o upgrade de WebSocket em produção continua sendo manual, no próximo deploy (`docs/todos.md`).
- Incluir o E2E como etapa obrigatória do `cd.yml` (ver "CI").

## Diferenças do plano

**Números.** 17 testes distintos, que rodam 26 vezes: 15 no projeto `one-instance` e 11 no `two-instances` (`smoke`, `auth` e `sharing` não dependem da topologia e rodam só no primeiro; `multi-instance` só no segundo). A suíte inteira leva cerca de 28s numa máquina de 10 núcleos.

**O que foi diferente do que estava escrito**

- **Portas próprias: 4333/4334 (servers) e 6173/6174 (webs).** O plano usava as do `pnpm dev` e deixava a troca como decisão do passo 3. Na hora de começar já havia um server e um Vite do dev nas portas 3333 e 5174; mudar evita o choque e o risco de o E2E falar com o server de desenvolvimento. Está tudo em `src/env.ts`.
- **O banco é apagado por um script, não pelo `globalSetup`.** O Playwright sobe os `webServer` antes do `globalSetup`, então os servers já teriam criado o índice quando o banco fosse apagado. `pnpm test` (do pacote) roda `tsx src/drop-database.ts` e só então o Playwright. Rodar `playwright test` direto pula a limpeza, sem prejuízo: cada teste cria usuários com e-mail único.
- **Um Chromium novo instalou normalmente nesta máquina** (o `playwright install chromium` baixou o headless shell). O risco do plano, de ter que fixar o Playwright na versão do cache, não se concretizou.
- **O health do server é `/health`, não `/api/health`** (a rota não passa pelo prefixo `/api` do proxy). O teste de fumaça confere o `/health` direto nas duas instâncias e o proxy por `/api/auth/get-session`.
- **Os textos da tela eram outros.** O papel aparece como "Can edit" e "View only" (não "Editor" e "Viewer"), o selo da lista é "Shared · Can edit", o botão de entrar é "Login", o de criar é "New" (e existe também "New document", daí o `exact`), e "Document not found" é um texto, não um `heading`.
- **O cenário 14 saiu.** "Papel e remoção atravessam instâncias" já é o que os cenários 6 e 7 fazem no projeto `two-instances`, com o Bob na instância B. Repetir seria o mesmo teste duas vezes.
- **O cenário 12 (offline) não usa `context.setOffline()` sozinho**, como o plano já desconfiava: o Chromium só bloqueia conexões novas e deixa o WebSocket aberto (o status continuava "Saved"). A página guarda os seus sockets do documento (`addInitScript`, em `src/network.ts`), e `goOffline` os **fecha e depois** corta a rede. Duas coisas que não funcionaram, para ninguém tentar de novo: `page.routeWebSocket` aceitando e fechando as tentativas de reconexão (o cliente do Socket.IO fica esperando um handshake que nunca vem e **deixa de reconectar**; o servidor inalcançável de verdade dá erro de conexão, que ele trata) e cortar a rede antes de fechar (o fechamento de um WebSocket depende de uma troca de frames com o server, e o evento `close` atrasa).
- **O cenário 13 refaz o cenário quando a pré-condição não vale.** O teste só prova o `room:state` se o texto ainda não estiver no Mongo (a gravação sai 2s depois da última edição). Numa máquina carregada a digitação passava de 2s; o teste agora usa `insertText` (um evento só) e, se a versão salva já não for 0, recomeça com outro documento (`toPass`). Conferido como mutação: com `E2E_REDIS_URL` vazio (servers sem Redis), os dois cenários de `multi-instance.spec.ts` falham porque o Bob recebe o documento vazio.
- **O cenário 10 é uma guarda parcial.** Medido com o `updatesInFlight` do server desligado de propósito (a presença passando na frente do texto): o teste pegou o cursor sumindo em 2 de 4 execuções. Ele amostra a cada frame e exige zero quadros sem cursor, então um falso verde existe; a cobertura firme dessa regressão continua sendo o teste do server (`relays the presence after the document update`).
- **Entrou um commit que o plano não tinha:** `test(e2e): Made the offline and the two-instance specs steady under load`, depois do passo 9. A instabilidade do cenário 12 e do 13 só apareceu ao rodar a suíte inteira em carga (8 workers), não rodando cada spec sozinho.
- **O workflow de CI não foi executado no GitHub antes do PR.** Foi conferido o YAML, `pnpm install --frozen-lockfile` e `CI=true pnpm e2e` localmente (retries, reporter `github`/`html`); o que só aparece no runner (`playwright install --with-deps`, o cache do navegador, o compose com `--wait`) ficou para a primeira execução real.
- **Cada Vite tem o seu `cacheDir`.** A primeira execução no GitHub falhou em todos os testes que usam o web B (porta 6174): a página ficava em branco, com `504 (Outdated Optimize Dep)` no console do trace. Os dois Vite saem da mesma pasta (`apps/web`) e dividiam `node_modules/.vite`; sem cache (o runner começa limpo), um invalida o pré-bundle do outro. Localmente nunca apareceu porque a pasta já existia e a máquina é mais rápida (apagar o cache e rodar o smoke continuou verde). O `vite.config.ts` lê `VITE_CACHE_DIR` (padrão igual ao de hoje) e o `playwright.config.ts` passa `node_modules/.vite-e2e-<porta>` a cada instância.

**O que a investigação mostrou sobre o app**

Nenhum bug do app foi confirmado. Os três pontos abaixo apareceram só com a suíte rodando em carga pesada (6 a 8 workers) e valem como observação:

- **Cursor remoto "uma tecla atrás" quando as setas chegam em milissegundos.** Em ~2,5% das execuções do cenário 9 sob 6 workers, o cursor do Bob na tela da Alice ficava uma ou mais posições atrás, para sempre (a espera chegou a 30s). A causa está do lado do Bob, não na entrega: nesses casos o cursor na `Awareness` dele **e** a cópia da Alice eram iguais (`same=true`), as teclas chegavam ao navegador (cinco `keydown` de `ArrowRight`, nenhum cancelado) e, ainda assim, o cursor nativo só se movia uma vez. Em outra variação, o DOM do Bob já estava na posição certa mas o estado do ProseMirror (e, portanto, a presença) um passo atrás, sem nenhum evento novo para republicar. É a corrida conhecida do ProseMirror entre a seleção nativa e a que ele reaplica quando outra transação chega no meio; não foi investigada a fundo (envolve o `@tiptap/y-tiptap` 3.3.1). Uma pessoa não aperta cinco setas em 15ms, então o impacto real é baixo e o próximo movimento corrige. No teste, `placeCursor` espera cada tecla pousar e `moveCursorAndExpectSeen` refaz o movimento até a outra tela mostrá-lo. Se um dia aparecer reclamação de cursor parado, é por aqui.
- **`ECONNRESET` no log do Vite** (`ws proxy error`) quando o server derruba os sockets de propósito (mudança de papel, remoção) ou o contexto fecha. É ruído do proxy de desenvolvimento, não falha.
- **O "Saved" do indicador não quer dizer "gravado no Mongo"**, só que o server recebeu a atualização (`unacked` vazio). A gravação sai depois do debounce. O cenário 11 espera `contentVersion > 0` no Mongo antes de recarregar, para provar a persistência de verdade.

**Estabilidade medida.** Com as correções, 4 execuções seguidas da suíte inteira com `--repeat-each=6 --workers=8` (156 testes cada, 624 no total) passaram sem falha; antes das correções quase todas as execuções tinham 1 ou 2 falhas. Sem carga (workers padrão), as últimas execuções passaram todas.

## Pendente

- Decidir, depois de umas semanas de histórico, se o E2E entra como etapa obrigatória do `cd.yml`.
- Opcional: investigar o cursor remoto atrasado (acima) com o `y-tiptap`, se um dia incomodar.
