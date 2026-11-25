# TODOs

## Sessão no front (`apps/web`)

Hoje o `sessionLoader` (rota raiz) só roda no primeiro acesso/F5 e depois de sign-in/sign-out (`revalidate()`). Se a sessão expirar ou for revogada, a UI continua achando que o usuário está logado até ele recarregar a página.

- [ ] **Tratar 401 globalmente**: qualquer resposta 401 (auth client e, depois, API de documentos/WebSocket) revalida a sessão, mostra o toast "Your session expired" e o `AuthGuard` manda para `/sign-in`.
  - Pré-requisito: ainda não existe rota protegida no server, e o `get-session` devolve 200 + `null` sem sessão (não 401). Criar um middleware `requireAuth` + uma rota (ex.: `GET /api/me`) para ter um 401 real.
  - Desacoplar via evento: `src/lib/session-expired.lib.ts` com `notifySessionExpired()` / `onSessionExpired(listener)`, para evitar import circular (router → pages → authClient → router). Quem dispara: `fetchOptions.onError` do `authClient` (better-fetch suporta) e o futuro wrapper da API / `QueryCache.onError` do TanStack Query. O socket do documento também: `connect_error` com `unauthorized` (em `document-socket.lib.ts`) hoje só mostra a tela de erro, e a sessão só é checada no handshake, então um socket aberto sobrevive à expiração da sessão até a próxima reconexão.
  - O listener (registrado em `main.tsx`) usa `router.revalidate()` direto da instância do router; o `toast` é um manager global e funciona fora do React.
  - Ignorar 401 quando não há sessão carregada (`router.state.loaderData.root` nulo). Senão um sign-in com senha errada, que devolve 401, dispararia "session expired".
  - Deduplicar: várias requests com 401 ao mesmo tempo devem gerar um único toast + revalidate.
- [ ] **Revalidar ao voltar o foco da aba**: listener de `visibilitychange` na rota raiz chamando `revalidate()`. Pega a aba esquecida aberta antes de o usuário voltar a mexer.
- [ ] **Revalidação periódica da sessão**: agendar `revalidate()` para `session.expiresAt` (reagendar a cada nova sessão carregada). Lembrar que o better-auth renova a sessão a cada dia de uso (`updateAge`), então o `expiresAt` muda.

## Infra / dev

- [x] **Mongo local como replica set**: o adapter do better-auth abre transação sempre que recebe o `client` (sign-up por email cria `user` + `account` juntos), e transação só funciona em replica set. Com o container `mongo:8` standalone, o `POST /api/auth/sign-up/email` responde 500 (`Transaction numbers are only allowed on a replica set member or mongos`). Hoje o dev usa o Atlas, que já é replica set.
  - Subir o container como replica set de um nó: `mongo:8 --replSet rs0 --bind_ip_all` + `rs.initiate({ _id: 'rs0', members: [{ _id: 0, host: 'localhost:27017' }] })` uma única vez, e usar `?directConnection=true` no `MONGO_URL`.
  - Colocar isso no futuro `docker-compose.yml` (com healthcheck que roda o `rs.initiate` se ainda não tiver sido feito), para o ambiente subir pronto.
  - Não usar `transaction: false` no adapter como atalho: o dev ficaria diferente da produção.

## Guest (`apps/server`)

- [x] **Membro duplicado ao juntar documentos**: não acontece, porque guest não compartilha nem pode ser convidado (a API responde 403/400), então o documento de um guest só tem ele como membro. A invariante está documentada em `transfer-guest-documents.test.ts`. Se essa regra mudar, o `transferGuestDocuments` precisa juntar as participações e ficar com o papel mais alto.
- [ ] **Índice em `session.userId`**: o job de guests abandonados faz `$lookup` em `session` por `userId`. Conferir se o better-auth cria esse índice no Mongo; se não, criar (`{ userId: 1, expiresAt: 1 }`).
- [ ] **Índice em `user.email`**: o convite por e-mail (`POST /members`) e o sign-in buscam usuário por `email`. Num teste local, o Mongo só tinha o índice `_id_` na coleção `user`, ou seja, o adapter do better-auth não criou o índice de e-mail. Conferir (`db.user.getIndexes()`) e, antes de criar um à mão, ver como o better-auth nomeia o dele para não gerar conflito de índice (um nome diferente para a mesma chave faz o `createIndex` falhar). O mesmo vale para o índice de `session.userId` acima.
- [x] **Rate limit compartilhado entre instâncias**: o limite de convites passou a contar no Redis quando há `REDIS_URL` (`switchable-rate-limit-store.ts`); sem Redis, continua em memória (cada instância conta sozinha).

## Tempo real (`apps/server`)

- [x] **Salas entre instâncias (semana 6)**: feito com `serverSideEmit` (`room-peers.ts`), ver `docs/redis.md`. Pendente só a validação com navegadores de verdade, no E2E.
- [ ] **Presença: rate limit e `awareness:left` entre instâncias**: o cursor manda até ~60 mensagens por segundo por pessoa (o cliente limita a 1 por frame, 16ms; o server não confere). Com várias instâncias, o `awareness:left` depende de a instância do socket que caiu emitir; se ela cair sem emitir, o timeout de 30s do `Awareness` limpa o cursor. Entra junto com o rate limit por socket abaixo.
- [ ] **Rate limit por socket**: hoje o único limite é o tamanho da mensagem (`maxHttpBufferSize`, 2 MB). Um cliente pode mandar updates sem parar.
- [ ] **Confirmar WebSocket em produção**: o caminho que roteia `/api` para o Fly precisa aceitar o upgrade em `/api/socket.io`. Só dá para validar no primeiro deploy.
