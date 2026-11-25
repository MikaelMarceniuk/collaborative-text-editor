# Tempo real com Socket.IO + Yjs

> **Estado: plano**, ainda não implementado. A implementação segue a seção "Passos e commits": uma branch (`feat/realtime-sync`), um commit por passo.

Hoje o editor já guarda o conteúdo como Yjs e sincroniza por REST (`GET /content`, `POST /updates`, com debounce no cliente). Este plano troca só o **transporte**: o cliente passa a falar com o server por um socket, o server retransmite os updates para os outros clientes do documento e persiste no Mongo com debounce. O formato no banco (`ydocState` + `contentVersion`), o `applyDocumentUpdate` e a integração Tiptap + `Y.Doc` continuam como estão (ver `document-persistence.md`, "Transição para Share + Socket.IO").

## O que já existe

- `loadDocumentState` e `applyDocumentUpdate` (`services/document-content.service.ts`): leitura do estado e merge atômico com `contentVersion`. A sala do socket usa os dois sem mudança.
- Papéis (`findMemberRole`/`documentAccess`) e rotas de membros (`PATCH`/`DELETE`), que hoje só têm efeito no próximo refetch do front.
- Front: `Collaboration.configure({ document: ydoc })`, `REMOTE_ORIGIN`, `onAccessLost` (invalida o `detail` do documento e mostra o toast), indicador de save no header.
- `y-protocols` já está nas dependências do web (vai servir para a presença, fora deste plano).

## Decisões

- **Eventos próprios do Socket.IO, não o protocolo do `y-websocket`.** O Socket.IO já dá framing, binário, ack, salas e reconexão. O sync do Yjs continua sendo o mesmo de dois passos (trocar *state vectors* e mandar só o que falta), só que como um evento com ack.
- **Um socket por documento aberto.** O `documentId` vai no `auth` do handshake e o middleware do Socket.IO valida sessão e participação antes de a conexão existir. Como a validação roda de novo em cada reconexão, quem foi removido enquanto estava offline não volta a entrar. Alternativa descartada: um socket global com `join` por evento; exigiria reimplementar a revalidação.
- **Sync por *state vector*, sem fila de updates no cliente.** Ao conectar (e a cada reconexão), o cliente manda o state vector dele e recebe o que falta, junto com o state vector do server; em seguida manda `Y.encodeStateAsUpdate(ydoc, serverStateVector)`. Isso cobre a primeira carga, edições feitas offline e um server que caiu antes de gravar, sem a fila com retry e backoff do `document-sync.lib.ts` de hoje. Os updates do Yjs são idempotentes, então mandar algo a mais é seguro.
- **O socket substitui o `GET /content` como carga inicial.** Com um único caminho de carga não há janela entre "li o estado por REST" e "entrei na sala". O editor monta depois do primeiro sync.
- **Ack = o server recebeu, não "está no Mongo".** O server grava com debounce, então um crash perde no máximo a janela do debounce, e mesmo isso volta no próximo sync enquanto a aba estiver aberta (o `ydoc` do cliente é a fonte). Em compensação, fechar a aba logo depois de editar depende do que já foi acked: o aviso do `beforeunload` passa a olhar "updates ainda sem ack".
- **Server mantém um `Y.Doc` em memória por sala ativa.** Serve para responder ao sync sem ir ao Mongo a cada join. A sala nasce no primeiro join (`loadDocumentState`), grava o pendente e é descartada quando o último socket sai. O Mongo continua sendo a fonte da verdade: a gravação sempre faz merge via `applyDocumentUpdate`, nunca replace.
- **Debounce no server: grava após 2s sem updates, no máximo 10s depois do primeiro pendente** (os números do planner). Também grava quando a sala esvazia e no shutdown. Falha de gravação mantém o pendente e tenta de novo com backoff.
- **Papel em cache no socket (`socket.data.role`), atualizado pelas rotas.** Checar o Mongo a cada update seria caro. As rotas de membros avisam o módulo de tempo real, que atualiza o papel dos sockets daquele usuário ou os derruba.
- **Só `websocket`, sem polling.** O polling do Socket.IO exige sticky session quando houver mais de uma instância (semana 6). WebSocket é suportado por todos os navegadores relevantes.
- **`path: '/api/socket.io'`.** Assim o socket passa pelo mesmo prefixo `/api` que o resto, e qualquer proxy já configurado para `/api` (Vite em dev, o que roteia para o Fly em produção) serve o socket também. Em dev só falta `ws: true` no proxy.
- **Leitor conecta e recebe, mas não envia.** O server rejeita `doc:update` de viewer (ack com erro), como no `POST /updates`. O cliente de viewer nem tenta enviar.
- **Sem presença/cursores aqui.** O desenho deixa espaço (outro par de eventos na mesma sala, com `y-protocols/awareness`), mas é a próxima entrega da semana 5.

## Protocolo

Sala: `doc:<documentId>`. Payloads binários são `Uint8Array`/`Buffer`.

| Direção | Evento | Payload | Resposta (ack) |
|---|---|---|---|
| handshake | `auth: { documentId }` | | `connect_error` com `message`: `unauthorized` (sem sessão) ou `not_found` (id inválido ou não é membro) |
| C → S | `doc:sync` | `stateVector` do cliente | `{ ok: true, role, update, stateVector }` com o que falta ao cliente e o state vector do server |
| C → S | `doc:update` | update do Yjs | `{ ok: true }` ou `{ ok: false, error: 'forbidden' \| 'invalid' }` |
| S → C | `doc:update` | update do Yjs (de outro cliente) | |
| S → C | `doc:access-changed` | nada | |

- `doc:sync` é o único passo de carga e também o de reconexão. O cliente chama depois de cada `connect`.
- O server retransmite com `socket.to(room).emit(...)`, então quem enviou não recebe o próprio update de volta. No cliente, o que chega do server é aplicado com `REMOTE_ORIGIN` para não ser reenviado.
- `doc:access-changed` não carrega dados: o cliente invalida o `detail` do documento e o papel novo (ou o 404) sai do mesmo fluxo que já existe hoje.
- Limite de tamanho: `maxHttpBufferSize: 2 MB`, igual ao `limit` do `POST /updates`.

## Server (`apps/server`)

### Dependências

- `socket.io`. Dev: `socket.io-client`, para os testes de integração.

### Servidor HTTP e Socket.IO (`server.ts`, `realtime/socket-server.ts`)

- `app.listen` vira `createServer(app)` + `new Server(httpServer, { path, cors, maxHttpBufferSize, transports: ['websocket'] })`. O `cors` reaproveita `WEB_URL` com `credentials: true`.
- `createSocketServer(httpServer)` fica em `realtime/socket-server.ts` e devolve o `io` e a API que as rotas usam (abaixo). Um módulo, para os testes subirem o socket numa porta efêmera sem o `server.ts`.
- Shutdown: parar de aceitar conexões, gravar todas as salas (`rooms.flushAll()`), `io.close()`, depois fechar o Mongo. Hoje o `server.close` esperaria os sockets abertos para sempre.

### Autenticação e participação (`realtime/socket-auth.ts`)

- Middleware `io.use`: resolve a sessão com `auth.api.getSession({ headers: fromNodeHeaders(socket.request.headers) })` (o cookie vai no handshake). Sem sessão, `unauthorized`.
- Valida `auth.documentId` com `ObjectId.isValid` e a participação, reaproveitando a consulta do `documentAccess` (extrair para uma função `findMemberRole(documentId, userId)` usada pelo middleware HTTP e pelo do socket, sem mudar o comportamento do HTTP). Não é membro: `not_found`, o mesmo critério de 404 das rotas.
- Em caso de sucesso, grava `socket.data = { userId, documentId, role }`.
- Nos testes, o resolvedor de sessão é trocado como o `mock-auth.ts` troca o `authMiddleware` (usuário vindo do header `x-test-user-id`, aqui via `extraHeaders` do client).

### Salas em memória (`realtime/document-rooms.ts`)

Estado por `documentId`: `{ ydoc, sockets: number, pendingUpdates: Uint8Array[], idleTimer, maxWaitTimer, loading: Promise }`.

- `joinRoom(documentId)`: cria a sala se precisar (carrega com `loadDocumentState` e `Y.applyUpdate`), incrementa a contagem e devolve a sala. Dois joins simultâneos no mesmo documento compartilham a mesma promessa de carga.
- `applyClientUpdate(documentId, update)`: `Y.applyUpdate(room.ydoc, update, ORIGIN)` dentro de try/catch (`invalid` se lançar), empilha em `pendingUpdates` e agenda a gravação.
- `leaveRoom(documentId)`: decrementa; ao chegar a zero, grava o pendente e descarta a sala.
- Gravação: `applyDocumentUpdate({ documentId, update: Y.mergeUpdates(pending) })`. O que chegar durante a gravação fica para a próxima. Erro: devolve o pendente à fila e agenda retry com backoff. Documento apagado: `applyDocumentUpdate` já ignora quando o documento não existe.
- `flushAll()` e `dropRoom(documentId)` (para o `DELETE` do documento, sem gravar).

### Eventos (`realtime/document-socket.ts`)

No `connection`: `socket.join('doc:<id>')`, `joinRoom`, e `disconnect` chama `leaveRoom`.

- `doc:sync`: valida que o payload é binário, responde `Y.encodeStateAsUpdate(room.ydoc, clientStateVector)` e `Y.encodeStateVector(room.ydoc)`.
- `doc:update`: se `socket.data.role` não pode editar, ack `forbidden`. Senão `applyClientUpdate`; `invalid` no erro; ok → `socket.to(room).emit('doc:update', update)` e ack `ok`.
- Payload de tipo errado ou grande demais: ack `invalid`, sem derrubar a conexão.

### Acesso mudando com o socket aberto (`realtime/access.ts`, rotas de membros e de documento)

API exposta pelo `createSocketServer`, chamada pelas rotas depois de gravar no Mongo:

- `PATCH /members/:userId` → `updateMemberRole(documentId, userId, role)`: atualiza `socket.data.role` dos sockets daquele usuário no documento e emite `doc:access-changed` para eles.
- `DELETE /members/:userId` (dono removendo ou membro saindo) → `removeMember(documentId, userId)`: emite `doc:access-changed` e depois `disconnectSockets(true)` dos sockets do usuário no documento.
- `DELETE /documents/:id` → `closeDocument(documentId)`: emite `doc:access-changed` para a sala, descarta a sala sem gravar e desconecta todos.
- Os sockets do usuário ficam numa sala própria `doc:<id>:user:<userId>`, assim `io.in(...)` alcança só eles (e continua funcionando com o Redis adapter, onde `fetchSockets`/`disconnectSockets` operam no cluster).
- As rotas recebem essa API por injeção (parâmetro do `documentRouter`/`documentMembersRouter`) ou por um módulo singleton com `setRealtime(...)`; decidir na implementação pelo que deixar os testes de rota mais simples (sem socket, a chamada é no-op).

### O que sai

Depois que o front migrar (passo 12): `GET /api/documents/:id/content` e `POST /api/documents/:id/updates`, junto com os testes deles. A sala em memória deixaria de ser a fonte da verdade se algo gravasse no Mongo por fora dela (ver `document-persistence.md`). O que esses testes cobriam (viewer não escreve, update inválido, merge concorrente) passa a ser coberto pelos testes do socket e do `applyDocumentUpdate`.

## Web (`apps/web`)

### Dependências e infra de dev

- `socket.io-client`.
- `vite.config.ts`: `'/api': { target: 'http://localhost:3333', ws: true }`.

### Cliente do socket (`lib/document-socket.lib.ts`)

Substitui o `createDocumentSync` baseado em REST. Mesma ideia de "provider": recebe o `ydoc` e devolve `{ destroy, hasUnsyncedChanges }` mais callbacks de estado.

- `io(window.location.origin, { path: '/api/socket.io', transports: ['websocket'], withCredentials: true, auth: { documentId } })`.
- A cada `connect`: `emit('doc:sync', Y.encodeStateVector(ydoc))`. Na resposta: `Y.applyUpdate(ydoc, update, REMOTE_ORIGIN)`; se o usuário pode editar, manda `Y.encodeStateAsUpdate(ydoc, serverStateVector)` como `doc:update`. A primeira resposta marca o documento como `ready`.
- `ydoc.on('update', (update, origin))`, ignorando `REMOTE_ORIGIN` e viewers: `emit('doc:update', update, ack)`. Conta quantos updates estão sem ack. Desconectado, o Socket.IO bufferiza o `emit`; mesmo assim a reconexão faz o sync completo, então um update bufferizado repetido é inofensivo.
- `on('doc:update')`: `Y.applyUpdate(ydoc, update, REMOTE_ORIGIN)`.
- `on('doc:access-changed')`: chama o `onAccessChanged` (invalidar o `detail`).
- `connect_error`: `not_found` e `unauthorized` não são retentados (`socket.disconnect()`; `not_found` leva à tela "Document not found", `unauthorized` entra no todo do 401 global). Outros erros o Socket.IO retenta sozinho.
- Estados expostos: `status: 'connecting' | 'ready' | 'not-found' | 'error'` (até o primeiro sync) e `connection: 'online' | 'offline'`.

### Hook (`hooks/use-document-sync.hook.ts`)

- Passa a ser chamado pela página (precisa do papel, que vem do `document`), não mais pelo `SimpleEditor`. Cria o `Y.Doc` e o provider, destrói os dois ao desmontar.
- Retorna `{ ydoc, status, saveStatus }`. `saveStatus`: `saved` (nada sem ack e online), `saving` (updates sem ack e online) e `offline` (desconectado; "your changes will sync when you reconnect").
- `beforeunload` com updates sem ack mostra o aviso padrão do navegador.
- `canEdit` mudando (papel alterado) não recria o socket: o provider lê o valor atual para decidir se envia.

### Página e editor

- `document-editor.page.tsx`: remove `useDocumentContent`. Carregando = `document` pendente **ou** `status === 'connecting'`. `not-found` do sync usa a tela de "Document not found" que já existe; `error`, a de "Couldn't load".
- `SimpleEditor`: recebe `ydoc` (e `saveStatus`) por props em vez de `content`. O resto não muda: `Collaboration.configure({ document: ydoc })`, `editable` pelo papel, `StarterKit.undoRedo: false`.
- `save-status-indicator.tsx`: ganha o estado `offline`.

### O que sai

`useDocumentContent`/`documentContentQueryOptions` e `documentsQueryKeys.content`, `waitForSavesInFlight`, `apiFetchBinary` (se mais nada usar) e o `createDocumentSync` baseado em REST. Verificar com `grep` antes de apagar.

## Testes

- **Salas** (`document-rooms.test.ts`, com timers falsos): carrega uma vez para dois joins simultâneos; grava após 2s ocioso e no máximo 10s depois do primeiro pendente; junta updates numa gravação só; grava e descarta quando o último sai; erro de gravação mantém o pendente; documento apagado no meio não lança.
- **Socket** (`document-socket.test.ts`, server em porta efêmera + `socket.io-client`, Mongo de teste): sem sessão → `unauthorized`; não membro e id inválido → `not_found`; dois clientes: update de um chega ao outro e não volta a quem enviou; `doc:sync` devolve só o que falta; viewer recebe mas não escreve (`forbidden`) e o estado não muda; update inválido (`invalid`) não é retransmitido nem corrompe a sala; reconexão com edição offline converge; após o debounce o `ydocState` no Mongo tem o conteúdo.
- **Acesso** (`document-access-realtime.test.ts`): `PATCH` para viewer passa a rejeitar updates e emite `doc:access-changed`; `DELETE` de membro desconecta só aquele usuário; `DELETE` do documento desconecta todos e não ressuscita o documento no Mongo.
- **Front:** não há framework de teste no web ainda (Playwright é da semana 6). Validação manual no fim, com duas janelas (uma como dono, outra como editor/viewer): digitação nos dois sentidos, derrubar o server e voltar, mudar papel e remover membro com o documento aberto.

## Passos e commits

Cada commit deixa o app funcionando (o REST só sai depois que o front migrou).

1. `docs`: este plano.
2. `feat(server)`: Socket.IO sobre o servidor HTTP (`createServer`, `realtime/socket-server.ts`, CORS, `path`, shutdown ordenado).
3. `feat(server)`: autenticação do socket e checagem de participação no handshake (extrair `findMemberRole`).
4. `feat(server)`: salas em memória (`document-rooms.ts`) com carga do estado e contagem de sockets, sem gravação ainda.
5. `feat(server)`: eventos `doc:sync` e `doc:update` com retransmissão e rejeição de viewer e de update inválido.
6. `feat(server)`: gravação com debounce, ao esvaziar a sala e no shutdown, com retry.
7. `feat(server)`: derrubar/atualizar sockets em `PATCH`/`DELETE` de membro e `DELETE` de documento.
8. `feat(web)`: `socket.io-client`, `ws: true` no proxy e `lib/document-socket.lib.ts`.
9. `feat(web)`: trocar o hook, a página e o editor para o socket (sai o carregamento por `/content`).
10. `feat(web)`: estado offline no indicador do header e aviso de saída com updates sem ack.
11. `feat(web)`: reagir a `doc:access-changed` (papel novo, "Document not found").
12. `refactor`: remover `GET /content`, `POST /updates` e o código REST de sync que ficou sem uso, nos dois apps.
13. `docs`: fechar o plano (planner, README, `local-development.md`, todos, diferenças do plano).

## Riscos e pontos a conferir

- **WebSocket em produção.** O front chama `/api` no mesmo domínio e algo (fora deste repositório) roteia para o Fly. Esse caminho precisa aceitar o upgrade de WebSocket em `/api/socket.io`. É a única parte que não dá para validar localmente; testar no primeiro deploy (o deploy é por sua conta).
- **Várias instâncias (semana 6).** Cada instância teria sua sala em memória para o mesmo documento. A gravação por merge continua correta, mas o Redis adapter só retransmite entre sockets: as salas de outras instâncias precisarão receber os updates também (evento entre instâncias com `serverSideEmit` ou um assinante por sala). Este plano não assume instância única na gravação, só na leitura do estado em memória.
- **Sessão expirando com o socket aberto.** A sessão só é checada no handshake, então um socket vivo continua funcionando depois de a sessão expirar até a próxima reconexão. Aceito; entra no todo do 401 global.
- **Crescimento do `Y.Doc` em memória.** Uma sala por documento aberto, descartada ao esvaziar. Para o porte do projeto (512 MB no Fly) é folgado; observar se documentos com muito histórico pesarem.
- **Flood de updates.** Só o limite de tamanho por mensagem. Rate limit por socket fica para depois.

## Fora do escopo

- Presença e cursores (resto da semana 5).
- Redis adapter e salas entre instâncias (semana 6).
- Testes E2E com dois navegadores (semana 6).
- Histórico de versões e snapshots (V2).
- Modo offline persistente com IndexedDB (V2); aqui o offline vale só enquanto a aba está aberta.
