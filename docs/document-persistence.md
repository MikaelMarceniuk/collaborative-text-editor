# Persistência do conteúdo do documento (Yjs)

Hoje o editor sempre abre o `content.json` de exemplo e nada é salvo. Este plano salva o conteúdo real no Mongo já no formato do Yjs, sincronizando por REST. A ideia é que, quando entrarem o compartilhamento e o Socket.IO, só o transporte mude: o formato no banco, o merge no server e a integração com o editor continuam os mesmos.

## Decisões

- **Yjs desde já, não JSON do Tiptap.** Evita migrar documentos e reescrever o save quando o tempo real chegar.
- **Enviar só os updates novos (incrementais), não o estado inteiro.** É exatamente o que trafega no Socket.IO depois do sync inicial: cada cliente manda os updates que gerou, o server aplica e retransmite. Com isso, a fila do cliente e o `applyDocumentUpdate` do server já nascem no formato do tempo real e não precisam ser reescritos. O estado inteiro só aparece no carregamento, que também é o "sync step" inicial do socket. Mandar o estado inteiro a cada save cresceria com o documento e não teria reaproveitamento nenhum.
- **Updates do Yjs são comutativos e idempotentes.** Aplicar o mesmo update duas vezes não duplica conteúdo, então retry depois de erro de rede é seguro, e várias abas (ou vários usuários, com o Share) não se sobrescrevem, desde que o server faça merge, nunca replace.
- **Corpo binário (`application/octet-stream`), não base64 em JSON.** São 33% a menos de dados, e o Socket.IO trafega binário nativamente.
- **Documento novo começa vazio**, só com o placeholder.

## Server (`apps/server`)

### Dependência

- `yjs`

### Modelo (`models/document.model.ts`)

- Adicionar `contentVersion: number`. É o token de concorrência otimista das gravações do `ydocState`.
- O `POST /api/documents` passa a criar com `contentVersion: 0`.
- Documentos que já existem não têm o campo: a primeira gravação aceita `contentVersion` ausente no filtro.

### Serviço (`services/document-content.service.ts`)

É a peça que o Socket.IO vai reaproveitar sem mudança.

- `loadDocumentState(documentId)`: devolve o `ydocState`, ou um update vazio (`Y.encodeStateAsUpdate(new Y.Doc())`) se ainda não houver conteúdo.
- `applyDocumentUpdate(documentId, update)`:
  1. Valida o update aplicando num `Y.Doc` descartável dentro de try/catch. Update inválido vira erro de validação (400) e não corrompe o estado salvo.
  2. Lê `ydocState` + `contentVersion`.
  3. `Y.mergeUpdates([atual, update])`.
  4. Grava com `{ _id, contentVersion: n }` no filtro (ou `$exists: false` quando o campo não existe), `$set: { ydocState, updatedAt }` e `$inc: { contentVersion: 1 }`.
  5. Se não casou (outra gravação chegou antes), volta ao passo 2. Até 3 tentativas, depois lança erro (500).
  - Sem o passo 4/5, duas gravações que leem o mesmo estado ao mesmo tempo fazem a mais recente apagar a outra.
  - Atualizar o `updatedAt` mantém a lista ordenada pela última edição.

### Rotas (`https/routes/document.route.ts`)

- `GET /api/documents/:id/content`
  - Qualquer membro (`findMemberRole`), 404 se não for membro.
  - Responde `200` com `Content-Type: application/octet-stream` e o estado em bytes.
- `POST /api/documents/:id/updates`
  - `express.raw({ type: 'application/octet-stream', limit: '2mb' })` só nessa rota (o app continua com `express.json()` global).
  - Só `canEdit`: 404 se não for membro, 403 se for `viewer`.
  - Corpo vazio responde 400.
  - Chama `applyDocumentUpdate` e responde `204`.

## Web (`apps/web`)

### Dependências

- `yjs`, `@tiptap/extension-collaboration`, `@tiptap/y-tiptap`
- `resolve.dedupe: ['yjs']` no `vite.config.ts`, senão aparece o erro "Yjs was already imported" quando duas cópias entram no bundle.

### API (`lib/api.lib.ts`)

- `apiFetchBinary(path, init)`: mesma lógica de erro do `apiFetch` (`ApiError` com status), mas envia/recebe `Uint8Array`, sem forçar `Content-Type: application/json`.

### Hook de sync (`hooks/use-document-sync.hook.ts`)

Desenhado como um "provider": na fase do Socket.IO, só o miolo dele troca e o resto do front não muda.

- Cria o `Y.Doc` do documento e o destrói ao desmontar.
- Carregamento: busca `/content`, aplica com `Y.applyUpdate(ydoc, state, LOAD_ORIGIN)` e só então devolve `status: 'ready'`. O editor só monta com o conteúdo já carregado.
- Envio:
  - `ydoc.on('update', (update, origin))`, ignorando `origin === LOAD_ORIGIN`, empilha numa fila.
  - Debounce de 1s sem edição, com espera máxima de 5s.
  - Envia `Y.mergeUpdates(fila)` para `/updates`. Só remove da fila o que foi confirmado; o que chegar durante o envio fica para o próximo.
  - Erro: mantém a fila e tenta de novo com backoff exponencial. 403 para de tentar (sem permissão).
- Saída da página:
  - `visibilitychange` para `hidden` e unmount: envia o pendente com `fetch(..., { keepalive: true })` (limite de 64KB do keepalive; acima disso, o envio normal).
  - `beforeunload` com fila pendente: mostra o aviso padrão do navegador.
- Retorna `{ ydoc, status, saveStatus }`, com `status`: `loading | ready | error` e `saveStatus`: `saved | saving | unsaved | error`.

### Editor (`components/tiptap-templates/simple/simple-editor.tsx`)

- Remover `content` e apagar `data/content.json`.
- `Collaboration.configure({ document: ydoc })`.
- `StarterKit.configure({ undoRedo: false })`: o Collaboration traz o próprio undo. O `UndoRedoButton` continua funcionando porque usa `commands.undo/redo`.
- `Placeholder` (de `@tiptap/extensions`) para o documento vazio.
- `editable: canEditDocument(role)` do usuário atual.

### Página (`pages/document-editor.page.tsx`)

- Loading e erro passam a considerar também o `status` do sync (metadados e conteúdo).

### Header (`components/document-header.tsx`)

- Indicador discreto do `saveStatus`: "Saving…", "Saved", "Couldn't save".

## Transição para Share + Socket.IO

O que é reaproveitado sem mudança:

- Formato no banco (`ydocState` + `contentVersion`).
- `loadDocumentState` e `applyDocumentUpdate`. A sala do socket carrega o `Y.Doc` em memória com o primeiro e persiste os updates acumulados com o segundo (debounce no server).
- Integração do editor com o `Y.Doc` (Collaboration).
- A checagem de permissão (`findMemberRole` + `canEdit`), aplicada no join da sala e em cada update recebido.

O que muda:

- O miolo do `use-document-sync`: o REST dá lugar ao provider do socket (sync inicial + updates incrementais).
- `POST /updates` deixa de ser usado pelo editor. Com a sala em memória, gravar direto no Mongo por fora dela deixaria o `Y.Doc` da sala desatualizado; ou a rota é removida, ou passa a aplicar o update na sala quando ela existir.

## Fora do escopo

- Prévia de texto na lista e busca full-text (campo `plainText` derivado do estado): V2.
- Presença e cursores.
- Snapshots de versão.

## Commits

1. `feat(server)`: modelo, serviço e rotas de conteúdo.
2. `feat(web)`: hook de sync, editor com Collaboration e indicador de save.
