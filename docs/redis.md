# Redis: várias instâncias do server

> **Estado: planejado.** Ainda sem código. Primeira metade da semana 6; o E2E com dois navegadores é a segunda metade e terá o próprio plano.

Hoje o server roda numa instância só (`min_machines_running = 1` no Fly). O tempo real (`docs/realtime.md`) e a presença (`docs/presence.md`) foram escritos para não depender disso, mas duas coisas ainda dependem. Este plano as resolve com o Redis, para o server poder rodar em várias instâncias:

1. **Os sockets de instâncias diferentes não se enxergam.** Um `socket.to(room).emit(...)` só alcança os sockets do próprio processo. O Redis adapter do Socket.IO resolve isso: o broadcast, o `io.in(room).disconnectSockets()` e a presença passam a atravessar as instâncias.
2. **As salas de conteúdo (`Y.Doc` em memória) não se enxergam.** Cada instância tem a sua sala por documento e só atualiza o `Y.Doc` com o que os próprios sockets mandam. O adapter entrega o `doc:update` aos sockets das outras instâncias, mas não à sala delas. Resultado sem tratamento: um cliente que entra na instância B recebe de `doc:sync` um estado sem as edições recentes da instância A, que ainda nem foram para o Mongo (a gravação tem debounce de 2s, no máximo 10s).

O ponto 2 é a parte difícil e a que o adapter não cobre. O resto é encanamento.

## Decisões

- **O Redis é só barramento. Não guarda estado do documento.** O `planner.md` previa "updates acumulados em memória/Redis". Ficou só memória: o Mongo continua a fonte da verdade, a sala continua na memória do processo, e o Redis só leva mensagens entre instâncias (pub/sub). Assim não há um segundo lugar com o conteúdo para manter coerente, e se o Redis cai o editor degrada (cada instância fica isolada) em vez de parar.
- **Redis opcional (`REDIS_URL`).** Sem a variável, o server usa o adapter em memória e as salas não falam com ninguém, exatamente como hoje. Dev, os testes que já existem e o deploy atual de uma instância só continuam sem Redis. Com a variável, liga o modo de várias instâncias.
- **As salas conversam por `io.serverSideEmit`** (eventos entre instâncias do próprio Socket.IO, que já usam a conexão do adapter), em vez de um canal pub/sub nosso. Sem segunda conexão, sem gerenciar assinaturas por documento, e o `serverSideEmit` com ack já traz o "espere todas as outras instâncias responderem". Alternativas descartadas:
  - **Um canal por documento, com assinante por sala.** Mais controle, mas é mais código e mais assinaturas para abrir e fechar a cada sala criada e descartada.
  - **Rotear cada documento sempre para a mesma instância** (sticky por `documentId`, por exemplo com `fly-replay`). Eliminaria o problema das salas, mas amarra o roteamento à plataforma e não é o que o plano do projeto promete (escalar com o Redis adapter).
  - **Mongo como barramento (change streams).** A gravação tem debounce de segundos, então a latência seria a do debounce.
- **A instância que recebeu o update é a que grava.** Quando a sala de outra instância aplica o update recebido, ela o aplica no `Y.Doc` mas **não** o põe em `pending`. Gravar em todas multiplicaria as escritas e a disputa pelo `contentVersion` do mesmo documento (`applyDocumentUpdate` faz até 3 tentativas). A troca: se a instância de origem morre dentro da janela de 2 a 10s sem gravar, o update só sobrevive nos clientes (que reenviam o que falta quando reconectam, pelo state vector). Aceito; o shutdown normal chama `flushAll`.
- **Uma sala nova pergunta às outras o que elas têm.** Ao criar a sala, o server carrega o Mongo e, **antes de responder o primeiro `doc:sync`**, pede às outras instâncias o estado que elas têm daquele documento e aplica por cima. É o que cobre a janela de gravação: o que a instância A ainda não gravou chega à B pelo pedido, e depois disso pelos updates.
- **Se as outras instâncias não respondem, o join falha** (o socket é desconectado e o cliente tenta de novo com backoff). Entrar com estado velho e depois receber updates cujas dependências faltam deixaria o cliente com um documento incompleto sem erro nenhum; reconectar é melhor que isso.
- **Os updates remotos esperam a sala que está carregando.** O `Map` de salas guarda a promessa da carga. O update que chega durante a carga espera a promessa e é aplicado depois. Aplicar updates do Yjs é idempotente e comutativo, então chegar antes ou depois do estado pedido não muda o resultado. Update para um documento sem sala (e sem carga em andamento) é ignorado: quem entrar depois pega pelo pedido de estado.
- **Descartar a sala (documento apagado) é uma chamada com ack para todas as instâncias**, antes de desconectar os sockets, como já é hoje na instância local. Sem o ack, o `disconnectSockets` (que viaja por outro canal do Redis) poderia chegar primeiro e os sockets que saem gravariam o documento de volta.
- **O rate limit de convites passa para o Redis** (`rate-limit-redis` no `express-rate-limit`), porque já temos a conexão, e o todo pedia isso junto com o adapter. Sem `REDIS_URL`, continua em memória.

## Protocolo entre instâncias

Eventos do `io.serverSideEmit`, só entre processos do server (os clientes nunca os veem). `documentId` é o hex.

| Evento | Argumentos | Ack | Quem responde / o que faz |
|---|---|---|---|
| `room:update` | `documentId`, `update: string` (base64) | não | quem tem a sala (ou a está carregando) aplica no `Y.Doc`, sem pôr em `pending`; as outras ignoram |
| `room:state` | `documentId` | sim, `string \| null` (base64) | quem tem a sala responde com `Y.encodeStateAsUpdate(ydoc)`; as outras respondem `null` |
| `room:drop` | `documentId` | sim | quem tem a sala a descarta sem gravar |

**Tudo vai como string base64, nunca como `Uint8Array`.** O `serverSideEmit` serializa os argumentos como JSON no Redis: um `Uint8Array` chega como objeto `{"0":1,"1":2}`, e um argumento binário junto com ack chega como `{}` (ver "Verificações já feitas"). O `room-peers.ts` é quem codifica e decodifica, então nada fora dele sabe disso. O custo são ~33% a mais de bytes, e o teste de 1,5 MB de ida e volta levou 20ms.

O `doc:update` para os **clientes** continua pelo `socket.to(room).emit`, que agora atravessa as instâncias pelo adapter. Cada update de edição gera, portanto, duas mensagens no Redis: o broadcast do adapter (para os sockets) e o `room:update` (para as salas). Foi mantido assim para o caminho dos clientes ficar como está.

## Server (`apps/server`)

### Dependências e configuração

- `@socket.io/redis-adapter` (8.3.0), `redis` (6.4.0, o cliente do adapter) e `rate-limit-redis`: o par do adapter foi testado com `socket.io` 4.8.4. Conferir ao instalar que o `rate-limit-redis` casa com o `express-rate-limit` 8 que já usamos.
- `config/env.ts`: `REDIS_URL` opcional, validada como URL `redis://` ou `rediss://`. Mesma regra do restante: sem valor, modo de uma instância.
- `config/redis.ts`: cria o cliente (e a cópia para o subscriber que o adapter exige) a partir do `REDIS_URL`, conecta na subida e **registra o handler de `error`** (sem ele, um `error` do cliente derruba o processo). Se `REDIS_URL` está definido e a conexão inicial falha, o server encerra, como já faz com o Mongo.
- `.env.example`, `compose-dev.yml` (serviço `redis`, porta `${REDIS_PORT:-6379}`, `127.0.0.1` como o Mongo) e `docs/local-development.md`.

### Adapter (`realtime/socket-server.ts`, `server.ts`)

- `createSocketServer(httpServer, { redis })`: o cliente vem por parâmetro (a leitura do `env` fica no `server.ts`), para os testes subirem duas instâncias no mesmo processo apontando para o mesmo Redis. Com `redis`, `io.adapter(createAdapter(pub, sub))`.
- `close()` passa a ser: `io.close()` (desconecta e fecha o HTTP), `rooms.flushAll()`, e por último fecha as conexões do Redis. O `server.ts` não precisa saber.
- Nada muda em `access-notifier.ts`: `io.in(room).emit` e `disconnectSockets(true)` já operam no cluster com o adapter (era a razão da decisão do `docs/realtime.md`). Só ganha testes entre instâncias.

### Pares (`realtime/room-peers.ts`)

Uma interface pequena entre as salas e o `serverSideEmit`, para `document-rooms.ts` não importar o Socket.IO:

```ts
interface RoomPeers {
	/** Avisa as outras instâncias de um update aplicado aqui. */
	publishUpdate(documentId: ObjectId, update: Uint8Array): void;
	/** O estado que as outras instâncias têm do documento (só as que têm a sala). */
	requestState(documentId: ObjectId): Promise<Uint8Array[]>;
	/** Pede às outras instâncias para descartarem a sala e espera a confirmação. */
	dropEverywhere(documentId: ObjectId): Promise<void>;
}
```

- `createRoomPeers(io)` implementa com `io.serverSideEmit` (sem ack) e `io.serverSideEmitWithAck` (os dois que respondem, que devolve uma promessa e rejeita no timeout), e registra os três `io.on('room:*')` que chamam de volta as salas. Codifica e decodifica o base64.
- O timeout do pedido é o `requestsTimeout` do `createAdapter` (padrão do adapter: 5s). Vamos passar 2s.
- `noopRoomPeers` (sem Redis): `publishUpdate` não faz nada, `requestState` devolve `[]`, `dropEverywhere` resolve. O adapter em memória só avisa no console ("this adapter does not support the serverSideEmit() functionality") e não entrega nada, então o no-op é obrigatório.

### Salas (`realtime/document-rooms.ts`)

- `createDocumentRooms({ peers })`, `peers` com padrão `noopRoomPeers`.
- `load` aplica o estado do Mongo e depois cada resposta de `peers.requestState`. Timeout ou erro rejeita a carga (a rejeição já limpa o `Map`, como no código de hoje).
- `applyUpdate` chama `peers.publishUpdate` depois de aplicar localmente e pôr em `pending`.
- Métodos novos para a chamada vinda dos pares: `applyRemoteUpdate(documentId, update)` (espera a promessa da sala se existir, aplica, não põe em `pending`, ignora se não houver sala), `stateOf(documentId)` (o `Uint8Array` do estado ou `null`) e o `drop` que já existe, usado também pelo `room:drop`.
- `documentDeleted` no `socket-server.ts` passa a esperar `rooms.drop` e `peers.dropEverywhere` antes de `disconnectSockets`.

### Rate limit (`https/middleware/invite-rate-limit.middleware.ts`)

Recebe o store por parâmetro (ou o cria a partir do cliente do Redis, se existir). O app é montado antes do socket server, então o cliente do Redis precisa existir antes de `app` ser importado, ou o middleware ser criado por uma função chamada no `server.ts`. Decidir no passo 6 olhando como `app.ts` está montado.

## Testes

- **Dois servidores no mesmo processo.** `socket-server.test.ts` ganha um bloco com duas instâncias (dois `createServer`, dois `createSocketServer`, o mesmo Redis). Isso simula duas instâncias bem o bastante: elas só compartilham o Redis e o Mongo, como em produção.
- **Cuidado:** `setAccessNotifier` é um singleton, então a segunda instância criada vira o notificador de ambas. Para os testes de acesso, tudo bem (o notificador alcança os sockets da outra instância pelo adapter, e é isso que se quer provar), mas o `close()` de uma reseta o singleton.
- Casos novos:
  - o `doc:update` de um cliente na instância A chega ao cliente na B, e a presença também (incluindo a ordem: a presença depois do update do mesmo socket);
  - o cliente que entra na B logo depois de editar na A (antes de gravar, com `idleMs` grande) recebe a edição no `doc:sync`;
  - a sala já existente na B recebe o update da A (`room:update`), conferido pelo `doc:sync` de um terceiro cliente na B;
  - `access-notifier`: mudar o papel ou remover um membro derruba os sockets na instância B; apagar o documento descarta a sala nas duas e não grava de volta;
  - sem `REDIS_URL`, os testes atuais passam sem alteração (rodam sem Redis);
  - a carga falha (e o socket é desconectado) quando o pedido de estado dá timeout (usar um `peers` de teste).
- **CI:** serviço `redis` no `server-ci.yml` e `TEST_REDIS_URL`. **Local:** o `compose-dev.yml` sobe o Redis junto do Mongo. Os testes que precisam do Redis exigem `TEST_REDIS_URL`; sem ela, falham com mensagem clara (como acontece com o Mongo de teste hoje), em vez de passar sem testar.

## Passos e commits

1. `docs`: este plano e o estado no `planner.md`.
2. `chore`: Redis no `compose-dev.yml`, no CI, `REDIS_URL` no `env.ts`/`.env.example` e no `local-development.md`.
3. `feat(server)`: Redis adapter opcional (`config/redis.ts`, `createSocketServer` recebendo o cliente, fechamento no `close()`), com testes dos broadcasts e da presença entre duas instâncias.
4. `feat(server)`: salas entre instâncias (`room-peers.ts`, `room:update` e `room:state`, carga esperando os pares), com os testes da janela de gravação.
5. `feat(server)`: descarte de documento e mudança de acesso entre instâncias (`room:drop` com ack), com testes.
6. `feat(server)`: rate limit de convites compartilhado no Redis.
7. `feat(server)`: ressincronizar as salas quando o Redis volta (ver Riscos). Decidido: entra no plano (antes era opcional).
8. `docs`: fechar o plano (README, planner, todos, diferenças do plano).

## Riscos e pontos a conferir

- **Pub/sub entrega no máximo uma vez.** Se o Redis cai ou a conexão pisca, as mensagens do intervalo se perdem: os clientes de uma instância não recebem o `doc:update` da outra, e as salas ficam sem o `room:update`. O passo 7 cura isso: quando o cliente do Redis volta (evento `ready` depois de uma queda), cada sala pede o estado aos pares e, se aprendeu algo que não tinha (o state vector cresceu), desconecta só os sockets locais dela (`io.local.in(room).disconnectSockets(true)`) para eles refazerem o `doc:sync`. A simetria fecha o buraco: a sala que aprendeu desconecta os seus clientes, e a que ensinou foi quem tinha o estado a mais, então os clientes dela já o têm. O `Redis streams adapter` resolveria a perda de mensagens, mas tem outros custos; só olhar se o passo 7 não bastar.
- **O `serverSideEmit` foi verificado** (ver "Verificações já feitas"): binário não funciona, então tudo vai em base64; o ack, o timeout e a instância morta se comportam como o plano precisa.
- **A carga da sala agora tem um round trip ao Redis.** Soma poucos milissegundos ao primeiro `doc:sync` de um documento sem sala naquela instância. Aceito. O timeout do pedido precisa ser curto o bastante para o cliente não esperar demais (começar em 2s).
- **Volume de mensagens.** Cada update de edição vira duas mensagens, e a presença chega a ~60 mensagens por segundo por pessoa (o rate limit por socket continua no `docs/todos.md`). Isso pesa na escolha de onde hospedar o Redis (ver "Onde hospedar o Redis"): um provedor que cobra por comando fica caro com presença.
- **Redis único é ponto único de falha do barramento.** Se ele cai, as instâncias seguem funcionando isoladas e o passo 7 reconcilia quando ele volta. Não há réplica nem Sentinel (fora do escopo).
- **Um `error` do cliente do Redis derruba o processo** se não houver handler. Está no `config/redis.ts`.
- **A janela de 2 a 10s da gravação** continua existindo e já não depende de instância: ver "A instância que recebeu o update é a que grava".
- **`awareness:left` e o timeout de 30s** (`docs/presence.md`): se a instância de um socket cai sem emitir, o cursor some pelo timeout do `Awareness`. Sem mudança.

## Verificações já feitas

Testado com um Redis 7 descartável e dois a três servidores Socket.IO no mesmo processo (`socket.io` 4.8.4, `@socket.io/redis-adapter` 8.3.0, `redis` 6.4.0), antes de escrever código do projeto:

| Pergunta | Resultado |
|---|---|
| `Uint8Array` como argumento do `serverSideEmit` | chega como objeto simples `{"0":1,"1":2,"2":3}`, não como `Uint8Array` |
| `Uint8Array` na resposta do ack | chega como o mesmo objeto simples |
| `Uint8Array` como argumento, com ack | chega como `{}` (vazio): quebra |
| String base64 de 1,5 MB, ida e volta com ack | íntegra, 20ms |
| Ack, três instâncias | devolve a lista das respostas das outras duas, em ~6ms |
| Instância que morreu de repente (conexões destruídas, sem despedida) | sai da contagem na hora: o ack devolveu só as respostas das vivas, em 3ms, sem esperar o timeout |
| Instância viva que não responde (handler que não chama o ack) | a promessa rejeita no timeout, com `Error "timeout reached: only 1 responses received out of 2"` e `error.responses` com o que chegou |
| Evento que nenhuma outra instância escuta | timeout igual: "only 0 responses received out of 2" |
| Sozinha, sem outras instâncias | `serverSideEmitWithAck` resolve `[]` na hora (`1ms`) |
| Fechar uma instância (`io.close()`) | sai da contagem na hora |
| Adapter em memória (sem Redis) | `serverSideEmit` só avisa no console, não entrega nada |

Consequências: base64 em tudo; a decisão "falhar o join no timeout" é segura (uma instância morta não faz o join esperar o timeout); e como o ack responde `[]` quando está sozinho, uma instância só com Redis funciona sem tratamento especial.

Não foi testado: queda e volta do próprio Redis (fica para os testes do passo 7).

## Onde hospedar o Redis

O backend está no Fly e o front na Vercel; o Redis só conversa com o backend, então **a Vercel não entra**. Opções, em ordem de recomendação:

1. **Um app Redis seu no Fly (recomendado).** Um app separado (`collaborative-text-editor-redis`) com a imagem oficial do Redis, uma máquina `shared-cpu-1x` de 256 MB e **sem volume**: o Redis aqui é só barramento (ver "Decisões"), então perder os dados num restart não custa nada. O server conecta por `redis://collaborative-text-editor-redis.internal:6379`, pela rede privada da organização (6PN), sem IP público e sem TLS. Não cobra por comando, então a presença não pesa no custo. Um relato de terceiros fala em ~US$ 2/mês para esse porte; conferir no painel. O custo é ser seu: atualizar a imagem e, se quiser, `requirepass` (a rede é privada, mas não custa). A máquina precisa ficar na mesma região do server (`iad`) para a latência ser baixa.
2. **Upstash pelo Fly (`fly redis create`).** Gerenciado, sem manutenção. Mas o preço do plano pay-as-you-go é **por comando** (US$ 0,20 por 100 mil, segundo o Fly e o Upstash), e o plano grátis tem 500 mil comandos por mês. As páginas não dizem se um `PUBLISH` ou uma mensagem entregue a um assinante conta como comando; pela regra geral ("commands executed") um `PUBLISH` contaria, e o cursor de uma pessoa chega a ~60 por segundo. Com presença, o plano grátis acabaria em horas de uso e o pay-as-you-go cresceria com o uso. O plano fixo de US$ 10/mês teria teto de vazão a conferir. As páginas também não dizem se o pub/sub por TCP é suportado nem o limite de conexões; só serviria depois de testar.
3. **Valkey/Redis de outro provedor** (Redis Cloud, Aiven etc.): não pesquisei; só faria sentido se você não quiser operar nada, e o critério é o mesmo (preço por comando e suporte a pub/sub por TCP).

O que muda no código entre as opções é só o `REDIS_URL` (`redis://` ou `rediss://`); o `config/redis.ts` aceita os dois.

## Deploy (por sua conta)

Nada disso entra em código, e o deploy é seu:

- Criar o Redis (ver "Onde hospedar o Redis") e guardar o `REDIS_URL` como secret do Fly e como secret do ambiente `server-env` no GitHub.
- `cd.yml`: acrescentar `REDIS_URL` ao `flyctl secrets set --stage`, lendo do secret do ambiente `server-env`. Esta é a única mudança do pipeline.
- Com o `REDIS_URL` configurado, subir para duas máquinas (`fly scale count 2`) e conferir pelos logs que os dois processos conectam. Antes disso o app roda como hoje, com uma.
- Roteamento: o transporte é só WebSocket, então o Fly pode mandar cada conexão para qualquer máquina sem sticky session.
- Continua pendente a confirmação de que `/api/socket.io` aceita o upgrade de WebSocket em produção.

## Fora do escopo

- Testes E2E com dois navegadores (outra metade da semana 6, com plano próprio).
- Rate limit por socket e o limite da presença (`docs/todos.md`).
- Adapter com Redis Streams, Redis Cluster e réplicas do Redis.
- Guardar o conteúdo do documento no Redis ou usá-lo como cache de leitura.
- Cursor e presença persistidos.

## Diferenças do plano

(Preencher ao implementar.)
