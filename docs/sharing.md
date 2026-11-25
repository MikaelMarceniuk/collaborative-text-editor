# Compartilhamento e permissões

Hoje todo documento tem um único membro, o dono. Este plano deixa o dono convidar outros usuários por e-mail, com papel de **editor** ou **leitor**, e fecha as pontas soltas de permissão no server e no front. Vem antes do Socket.IO porque a sala do socket valida o papel do usuário no join e em cada update (ver `document-persistence.md`, "Transição para Share + Socket.IO").

## O que já existe

- `DocumentModel.members: { userId, role }[]` e `ownerId`. O dono entra como membro `owner` na criação.
- `findMemberRole` + `canEdit` em `document.route.ts`. `/content` aceita qualquer membro, `/updates` e `PATCH` exigem `canEdit`, `DELETE` exige `owner`.
- Front: `DocumentRole`, `canEditDocument`, badge "Shared · papel" na lista, item "Share" desabilitado no menu do `DocumentItem`, `editable` do editor já depende do papel.
- Mailer (`sendEmail`) com fallback para log no dev.

## Decisões

- **Convite só para usuário que já tem conta.** Convidar um e-mail sem conta exigiria um convite pendente (coleção, token, expiração, aceite). Fica fora do MVP: o server responde 404 "No user with this email". O custo é que a rota revela se um e-mail está cadastrado. Aceitável aqui porque exige sessão e dá para limitar a taxa; anotar no README como trade-off.
- **Guest não compartilha nem recebe.** Guest não tem e-mail e seus documentos são apagados quando ele é abandonado (`deleteGuestDocuments` apaga por `ownerId`). Se um guest pudesse ter membros, esses perderiam o documento sem aviso. Com a regra, o documento de um guest só tem ele como membro, e o todo do "membro duplicado ao juntar" deixa de ser alcançável. Mesmo assim, o `transferGuestDocuments` ganha uma defesa barata (ver Server).
- **Só o dono gerencia membros.** Editor edita conteúdo e título, mas não convida, não muda papel e não remove. Um único dono por documento; transferência de posse fica fora do escopo.
- **Papéis atribuíveis: `editor` e `viewer`.** `owner` nunca é atribuído nem alterado pela API.
- **Qualquer membro não dono pode sair** (`DELETE` no próprio `userId`). Dono não sai, só exclui o documento.
- **404 para quem não é membro, 403 para membro sem permissão.** Mesmo critério das rotas atuais, para não revelar que o documento existe.
- **Sem tempo real por enquanto.** Mudança de papel ou remoção só aparece para o outro usuário no próximo refetch (foco da aba ou próximo request). Com o Socket.IO dá para derrubar a conexão na hora. Até lá, o 403/404 do server é a barreira de verdade; o front só reflete.

## Server (`apps/server`)

### Refactor pequeno antes das rotas novas

`parseDocumentId` + `findMemberRole` + "404 se não for membro" se repete em todas as rotas. Com mais três rotas, extrair um middleware `documentAccess({ minRole })` que resolve o `documentId`, o papel do usuário, devolve 404/403 e põe `res.locals.documentId` e `res.locals.role`. Rotas existentes migram para ele no mesmo commit, sem mudar comportamento.

### Rotas (`https/routes/document-members.route.ts`, montada em `/api/documents/:id/members`)

Usar `Router({ mergeParams: true })`.

- `GET /`: qualquer membro. Devolve `{ members: [{ userId, role, name, email, image }] }`, juntando com a coleção `user` do Better Auth via `$lookup` (o `members` do documento só guarda `userId`). O dono aparece primeiro.
- `POST /`: só `owner`. Body (Zod): `{ email: z.email().trim().toLowerCase(), role: z.enum(['editor', 'viewer']) }`.
  - Busca o usuário por e-mail. 404 se não existir.
  - 400 se for guest (`isAnonymous`) ou o próprio dono. 409 se já for membro.
  - Quem convida também precisa ser não-guest (400/403 "Create an account to share documents").
  - Inclusão atômica: `updateOne({ _id, 'members.userId': { $ne: invitedId } }, { $push: { members: ... }, $set: { updatedAt } })`. Se `matchedCount` for 0, já era membro (409). Evita duplicata em convites simultâneos.
  - Envia o e-mail de aviso (abaixo) sem bloquear a resposta, como o `sendVerifyEmail`. Falha no envio só vai para o log.
  - Responde `201` com o membro criado.
- `PATCH /:userId`: só `owner`. Body `{ role: 'editor' | 'viewer' }`. `updateOne` com `arrayFilters` e filtro `role: { $ne: 'owner' }`; 404 se o membro não existe, 400 ao tentar mexer no dono.
- `DELETE /:userId`: `owner` remove qualquer não dono; membro não dono só pode remover a si mesmo. `$pull` com `{ userId, role: { $ne: 'owner' } }`. `204`.

Validar `userId` da URL com `ObjectId.isValid` (404 se inválido), como `parseDocumentId`.

### E-mail de convite (`emails/share-document.ts`)

Mesmo molde do `verify-email.ts` (texto + HTML, `escapeHtml`): "{quem convidou} shared "{título}" with you ({papel})" e um botão para `${env.WEB_URL}/${documentId}`. O título e o nome são texto livre do usuário, então passam por `escapeHtml`.

### Índices (`config/mongodb.ts`)

Hoje não há criação de índices. Criar na conexão, `createIndex` é idempotente:

- `documents`: `{ 'members.userId': 1, updatedAt: -1 }` (a listagem filtra por membro e ordena por `updatedAt`).
- Conferir se o Better Auth cria índice em `user.email`; se não, criar, porque o convite busca por ele. Entra junto com o todo do índice em `session.userId`.

### `transferGuestDocuments`

Defesa barata para o todo do membro duplicado: depois do `updateMany`, nenhum documento deveria ter dois membros com o mesmo `userId`. Como guests não compartilham, basta um teste que documenta a invariante; só implementar a junção de papéis se a regra de guests mudar. Marcar o todo como resolvido em `docs/todos.md` com essa nota.

### Rate limit

Limitar `POST /members` (ex.: 20 por hora por usuário) com `express-rate-limit`, para reduzir a enumeração de e-mails e o spam de convites. Se preferir manter a stack enxuta, deixar anotado como pendência no `todos.md`.

## Web (`apps/web`)

### Hooks

Seguem o padrão do `use-rename-document.hook.ts` (TanStack Query, toast de erro).

- `use-document-members.hook.ts`: `useQuery` em `documentsQueryKeys.members(userId, documentId)`; só busca com o diálogo aberto.
- `use-add-member.hook.ts`, `use-update-member-role.hook.ts`, `use-remove-member.hook.ts`: mutations que invalidam a query de membros e atualizam `detail`/`list` (o `members` do `DocumentSummary` alimenta o badge e o `canEditDocument`). Remover a si mesmo (sair) também tira o documento da lista e navega para `/`.
- Mapear os erros do server: 404 → "No account with this email", 409 → "Already has access", 400 guest → mensagem de criar conta.

### Diálogo (`components/share-document-dialog.tsx`)

Usa `ui/dialog`, `field`, `input`, `avatar`, e um select de papel (`dropdown-menu` ou `toggle-group`, já existentes no kit).

- Dono: formulário "email + papel + Invite" em cima; lista de membros embaixo, cada linha com avatar, nome, e-mail, seletor de papel e botão de remover. O dono aparece fixo, sem controles.
- Não dono: só a lista (somente leitura) e o botão "Leave document" com confirmação (`alert-dialog`).
- Estados: carregando (`skeleton`), erro com retry, lista vazia (só o dono).

### Pontos de entrada

- `DocumentItem`: habilitar o item "Share" (hoje `disabled`) e abrir o diálogo. Visível para qualquer membro, já que não donos abrem a lista; o formulário de convite só aparece para o dono.
- `DocumentHeader`: botão "Share" ao lado da busca, na página do editor.
- Guest: botão desabilitado com tooltip "Create an account to share", ou um clique que leva ao fluxo de upgrade que já existe (`guest-upgrade-notice`).

### Comportamento por papel no editor

Conferir e completar o que o `canEditDocument` já cobre:

- Leitor: editor `editable: false`, toolbar escondida, título somente leitura, e um aviso discreto "View only". O sync não deve enfileirar nada.
- Perda de acesso com a página aberta: um 403 em `/updates` já para o retry. Tratar também 404 (removido) parando a fila e mostrando o estado "Document not found / no access". Hoje só o 403 interrompe.
- Mudança de papel: `refetchOnWindowFocus` do `detail` atualiza o papel quando a pessoa volta à aba, e o editor passa a `editable` conforme o novo papel.

## Testes

O repo ainda não tem Vitest/Supertest configurados. Este é o primeiro lugar em que eles se pagam, porque a regra é uma matriz papel × rota. Se o setup for entrar agora, fazer em commit próprio (`chore(server): Vitest + Supertest + Mongo de teste`) antes das rotas.

Matriz mínima, com usuário dono, editor, leitor e não membro:

| Rota | dono | editor | leitor | não membro |
|---|---|---|---|---|
| `GET /content` | 200 | 200 | 200 | 404 |
| `POST /updates` | 204 | 204 | 403 | 404 |
| `PATCH /:id` (título) | 200 | 200 | 403 | 404 |
| `DELETE /:id` | 204 | 403 | 403 | 404 |
| `GET /members` | 200 | 200 | 200 | 404 |
| `POST /members` | 201 | 403 | 403 | 404 |
| `PATCH /members/:userId` | 200 | 403 | 403 | 404 |
| `DELETE /members/:userId` (outro) | 204 | 403 | 403 | 404 |
| `DELETE /members/:userId` (si mesmo) | 400 | 204 | 204 | 404 |

Casos extras: convidar e-mail inexistente (404), guest (400), duplicado (409), dois convites simultâneos do mesmo usuário (um 201, um 409), mexer no dono (400).

No front, o E2E de dois navegadores entra na semana 6 junto com o realtime; aqui basta um Playwright simples: dono convida, o convidado vê o documento na lista com o badge certo.

## Fora do escopo

- Convite para e-mail sem conta (convite pendente com token).
- Transferência de posse.
- Link público somente leitura (V2).
- Atualização imediata de papel/remoção para quem está com o documento aberto (vem com o Socket.IO).
- Notificações dentro do app.

## Passos e commits

Cada passo é um commit pequeno, termina com algo que dá para conferir e deixa o app funcionando. Ordem: testes como rede de segurança, refactor, server, web, fechamento. O server inteiro vem antes do web para o front já nascer contra rotas prontas.

### A. Rede de segurança (server)

1. `chore(server): add Vitest and Supertest`
   Instalar, configurar o script `test` e um teste de fumaça em `GET /health`. Pronto quando `pnpm test` roda verde.
2. `test(server): cover document routes by role`
   Banco de teste e um jeito de simular usuário logado (ex.: trocar o `authMiddleware` por um que lê o usuário de um header, só no teste). Escrever a matriz das rotas que já existem (`/content`, `/updates`, `PATCH`, `DELETE`). Pronto quando a coluna dono/não membro da matriz passa; editor e leitor passam a ser testáveis no passo 4.

   Se montar o ambiente de teste for pesado demais agora, pular o 2 e voltar nele depois do passo 8, sem bloquear o resto.

### B. Refactor (server)

3. `refactor(server): add documentAccess middleware`
   Criar o middleware (`parseDocumentId` + papel + 404/403, com `minRole`) e usar só em `GET /:id` e `GET /:id/content`. Pronto quando essas duas rotas se comportam igual a antes.
4. `refactor(server): use documentAccess in write routes`
   Migrar `/updates`, `PATCH` e `DELETE`. Remover `findMemberRole`/`canEdit` duplicados. Pronto quando nenhuma rota repete o bloco de 404, e os testes do passo 2 continuam verdes.

### C. Membros (server)

5. `feat(server): index documents by member`
   `createIndex({ 'members.userId': 1, updatedAt: -1 })` na conexão. Pronto quando o índice aparece no Mongo e a listagem continua igual.
6. `feat(server): list document members`
   `GET /:id/members` com `$lookup` em `user`, dono primeiro. Qualquer membro. Pronto quando devolve nome e e-mail do dono de um documento novo.
7. `feat(server): add member by email`
   `POST /:id/members`: só dono, Zod, busca por e-mail, 404 se não existe, 409 se já é membro, `$push` atômico. Ainda sem regra de guest e sem e-mail. Pronto quando convidar uma conta existente devolve 201 e o documento aparece na lista dela.
8. `feat(server): block guests from sharing`
   400 para convidado guest e para quem convida sendo guest, 400 ao convidar a si mesmo. Pronto quando os três casos respondem 400.
9. `feat(server): change member role`
   `PATCH /:id/members/:userId`, só dono, nunca o dono. Pronto quando editor ↔ leitor muda e `/updates` passa a responder 403 para o leitor.
10. `feat(server): remove member and leave document`
    `DELETE /:id/members/:userId`: dono remove qualquer não dono, membro remove a si mesmo. Pronto quando o removido recebe 404 em `/content`.
11. `feat(server): email members when a document is shared`
    `emails/share-document.ts`, envio sem bloquear a resposta. Pronto quando o convite aparece no log do mailer em dev.
12. `feat(server): rate limit member invites`
    `express-rate-limit` só em `POST /members`. Pronto quando a 21ª tentativa na hora responde 429. Pode virar item do `todos.md` se preferir adiar.
13. `test(server): cover member routes`
    Completar a matriz da seção Testes, incluindo convite duplicado simultâneo e guests. Pula se o 2 foi adiado.

### D. Compartilhamento (web)

14. `feat(web): fetch document members`
    Chave `members` em `documentsQueryKeys` e `use-document-members.hook.ts`. Pronto quando o hook devolve a lista no React Query Devtools (ou num `console.log` temporário).
15. `feat(web): share dialog with member list`
    `ShareDialog` só com a lista (avatar, nome, e-mail, papel), aberto pelo item "Share" do menu da lista, que deixa de ser `disabled`. Pronto quando abre, mostra o dono e trata carregando/erro.
16. `feat(web): invite members from the share dialog`
    Formulário e-mail + papel e `use-add-member.hook.ts`, com os erros mapeados (404, 409, guest). Só para o dono. Pronto quando convidar uma conta faz ela aparecer na lista do diálogo.
17. `feat(web): change and remove members`
    `use-update-member-role.hook.ts` e `use-remove-member.hook.ts`, seletor de papel e botão de remover por linha. Pronto quando as duas ações refletem na lista sem recarregar.
18. `feat(web): leave a shared document`
    Botão "Leave document" com `alert-dialog` para não donos; sai da lista e navega para `/`. Pronto quando o convidado consegue sair.
19. `feat(web): share button in the editor header`
    Botão no `DocumentHeader`, mesmo diálogo. Pronto quando abre de dentro do documento.
20. `feat(web): disable sharing for guests`
    Botão desabilitado com tooltip, ou clique que leva ao upgrade. Pronto quando um guest não consegue abrir o formulário de convite.

### E. Papéis no editor (web)

21. `feat(web): view-only editor for viewers`
    Toolbar escondida, título somente leitura, aviso "View only", e confirmar que o sync não enfileira nada. Pronto quando um leitor não consegue digitar nem renomear.
22. `fix(web): stop syncing after losing access`
    No `use-document-sync`, 404 também interrompe a fila e mostra o estado de sem acesso. Pronto quando remover o convidado com o documento aberto e ele digitar não gera retry infinito.

### F. Fechamento

23. `docs: close sharing pass`
    Marcar o todo do membro duplicado (com a nota da invariante dos guests), atualizar `planner.md` (rotas de membros e semana 5) e corrigir o que este plano errou na prática.

Os passos de teste (1, 2, 13) são o maior bloco de trabalho novo. Os passos 8, 12 e 20 são os mais fáceis de adiar sem quebrar nada.
