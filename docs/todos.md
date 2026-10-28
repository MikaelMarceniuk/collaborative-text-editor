# TODOs

## Sessão no front (`apps/web`)

Hoje o `sessionLoader` (rota raiz) só roda no primeiro acesso/F5 e depois de sign-in/sign-out (`revalidate()`). Se a sessão expirar ou for revogada, a UI continua achando que o usuário está logado até ele recarregar a página.

- [ ] **Tratar 401 globalmente**: qualquer resposta 401 (auth client e, depois, API de documentos/WebSocket) revalida a sessão, mostra o toast "Your session expired" e o `AuthGuard` manda para `/sign-in`.
  - Pré-requisito: ainda não existe rota protegida no server, e o `get-session` devolve 200 + `null` sem sessão (não 401). Criar um middleware `requireAuth` + uma rota (ex.: `GET /api/me`) para ter um 401 real.
  - Desacoplar via evento: `src/lib/session-expired.lib.ts` com `notifySessionExpired()` / `onSessionExpired(listener)`, para evitar import circular (router → pages → authClient → router). Quem dispara: `fetchOptions.onError` do `authClient` (better-fetch suporta) e o futuro wrapper da API / `QueryCache.onError` do TanStack Query.
  - O listener (registrado em `main.tsx`) usa `router.revalidate()` direto da instância do router; o `toast` é um manager global e funciona fora do React.
  - Ignorar 401 quando não há sessão carregada (`router.state.loaderData.root` nulo). Senão um sign-in com senha errada, que devolve 401, dispararia "session expired".
  - Deduplicar: várias requests com 401 ao mesmo tempo devem gerar um único toast + revalidate.
- [ ] **Revalidar ao voltar o foco da aba**: listener de `visibilitychange` na rota raiz chamando `revalidate()`. Pega a aba esquecida aberta antes de o usuário voltar a mexer.
- [ ] **Revalidação periódica da sessão**: agendar `revalidate()` para `session.expiresAt` (reagendar a cada nova sessão carregada). Lembrar que o better-auth renova a sessão a cada dia de uso (`updateAge`), então o `expiresAt` muda.
