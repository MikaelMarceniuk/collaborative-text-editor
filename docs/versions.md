# Histórico de versões

> **Estado: plano.** Primeira metade da semana 7; a busca (`docs/search.md`, ainda a escrever) é a segunda metade e terá o próprio plano e a própria branch.

Hoje, se alguém apaga metade do texto, ou se um colaborador bagunça o documento, não há como voltar: o `Ctrl+Z` só cobre a sessão aberta e o que a própria pessoa digitou. Este plano adiciona **versões**: fotos do conteúdo em momentos diferentes, que dá para listar, visualizar e restaurar.

## Decisões

- **Uma versão é o estado completo do `Y.Doc` naquele momento** (`Y.encodeStateAsUpdate(ydoc)`), guardado como `Binary`. Funciona com o GC do Yjs ligado, então não precisa de `gc: false` nem de `Y.snapshot`. O custo é que cada versão carrega o documento inteiro; quem limita isso é a retenção (abaixo).
- **Coleção própria, `document_versions`**, em vez de um array dentro do documento. A listagem não carrega os binários e o limite de 16 MB do documento não é afetado.
- **O título fica fora.** Ele é um campo do Mongo, não está no Yjs. Restaurar mexe só no conteúdo.
- **Restaurar é uma edição nova, não uma volta no tempo.** O merge do Yjs é uma união: aplicar o estado antigo por cima do atual não muda nada, porque o antigo já está contido no atual. Trocar o `ydocState` no Mongo também não serve: os clientes reenviam o que o server "não tem" (pelo state vector) e o texto removido volta. O que funciona é, dentro de uma transação na sala, apagar o conteúdo do fragmento e inserir cópias do conteúdo da versão. Isso gera um `update` comum, que segue o caminho de qualquer edição (grava, vai para as outras instâncias, vai para os clientes). Alternativas descartadas:
  - **Trocar o `ydocState` e desconectar todo mundo.** Quebra o histórico do CRDT, e as edições feitas offline por clientes reintroduzem o que foi "desfeito".
  - **`Y.UndoManager`.** Só desfaz o que a própria instância do manager fez, e não sobrevive a recarregar a página.
- **Antes de restaurar, o server cria uma versão `before-restore`.** Restaurar então também se desfaz.
- **O fragmento é o `'default'`**, que é o campo padrão da extensão `Collaboration` do Tiptap (o `simple-editor.tsx` não muda o nome).
- **Trade-off a documentar:** quem está digitando no instante do restore pode ter o trecho perdido, porque a edição se ancora em nós que acabaram de ser apagados. Aceito: é o comportamento do Google Docs também, e o restore é uma ação rara e explícita.

## Quando uma versão é criada

| Tipo (`kind`) | Quando | Quem |
|---|---|---|
| `auto` | Depois de uma gravação (`flush`), se a última versão tem mais de 10 min. Também quando a última pessoa sai da sala, se o documento mudou desde a última versão | o server |
| `manual` | Botão "Salvar versão", com rótulo opcional | owner ou editor |
| `before-restore` | Logo antes de um restore | o server |

- **Não cria versão de documento vazio** (estado sem conteúdo).
- **Retenção:** as 50 `auto` mais recentes por documento; as `manual` e `before-restore` nunca são apagadas pela retenção. Ao inserir uma `auto`, o server apaga as que passaram de 50.
- **Várias instâncias:** duas instâncias podem gravar o mesmo documento quase juntas e as duas julgariam que a versão está atrasada. Quem cria a versão primeiro "reivindica" o horário com um `findOneAndUpdate` atômico em `documents.versionedAt` (só passa se `versionedAt` for mais antigo que o limite, ou se o documento mudou desde ele). Quem não conseguiu a reivindicação não cria nada.
- **A versão é tirada do `Y.Doc` da sala** (o que está em memória), não do Mongo, porque a sala pode ter edições que ainda não foram gravadas.

## Modelagem

```ts
DocumentVersion {
	_id, documentId,
	kind: 'auto' | 'manual' | 'before-restore',
	label?: string,        // só nas manuais, até 100 caracteres
	snapshot: Binary,
	size: number,          // bytes do snapshot, para a listagem
	createdBy?: ObjectId,  // ausente nas automáticas
	createdAt: Date,
}

// Novo campo em Document
Document { ..., versionedAt?: Date }
```

- Índice `{ documentId: 1, createdAt: -1 }` na `document_versions`.
- **Apagar o documento apaga as versões** (`DELETE /api/documents/:id` e o `delete-guest-documents`). Sem isso ficam binários órfãos.

## API

```
GET  /api/documents/:id/versions                       # qualquer membro; sem o snapshot
GET  /api/documents/:id/versions/:versionId            # qualquer membro; { version, snapshot (base64) }
POST /api/documents/:id/versions                       # owner/editor; { label? }
POST /api/documents/:id/versions/:versionId/restore    # owner/editor
```

- `documentAccess({ minRole: 'editor' })` nas duas rotas de escrita; leitores listam e visualizam, não restauram.
- A versão tem de ser do documento do `:id` (um `versionId` de outro documento dá 404).
- O snapshot vai em base64 no JSON (mesma convenção do `serverSideEmit`, ver `docs/redis.md`).
- O restore responde `204`. O cliente não precisa do resultado: a mudança chega pelo socket, como qualquer edição.

## Server (`apps/server`)

### Serviço (`services/document-versions.service.ts`)

`createVersion`, `listVersions`, `getVersion`, `createAutoVersionIfDue` (a reivindicação atômica e a retenção) e `deleteVersionsOf`. Só fala com o Mongo.

### Salas (`realtime/document-rooms.ts`)

- **Auto no `flush`:** depois de uma gravação com sucesso, chama `createAutoVersionIfDue` com o estado do `room.ydoc`. Uma falha ao criar a versão só é registrada: nunca pode atrasar nem desfazer a gravação do documento.
- **Auto na saída:** em `leave`, quando o último socket sai e antes de descartar a sala.
- **`restore(documentId, snapshotState)`:** carrega a sala (`getRoom`), monta um `Y.Doc` temporário com o snapshot, e dentro de `room.ydoc.transact` apaga os filhos do fragmento `'default'` e insere `.clone()` dos filhos do fragmento do documento temporário. Captura o `update` gerado, põe em `pending`, agenda a gravação e chama `peers.publishUpdate`. Devolve o `update`, para quem chamou difundir aos sockets. Se não havia sala aberta, grava na hora e descarta a sala (mesmo caminho do `leave`).

### Ponte para as rotas (`realtime/content-restorer.ts`)

As rotas REST não enxergam o `io` nem as salas. O `access-notifier.ts` já resolve esse problema para o controle de acesso, com uma instância trocável que o socket server registra ao subir. O restore usa o mesmo desenho: `contentRestorer.restore(documentId, snapshotState)`, que sem socket server (testes de rota) não faz nada. O socket server registra uma implementação que chama `rooms.restore` e difunde o `update` com `io.in(documentRoomName(documentId)).emit('doc:update', update)`. Vai para **todos** os sockets da sala, inclusive o de quem pediu o restore (que não enviou esse update), e o adapter leva até as outras instâncias.

## Web (`apps/web`)

- **Painel lateral "Histórico"** no editor: lista as versões (tipo, rótulo, autor, horário relativo). Botão "Salvar versão" para owner/editor.
- **Pré-visualização:** ao escolher uma versão, o corpo do editor mostra o conteúdo daquela versão num Tiptap só de leitura **sem a extensão Collaboration**, montado a partir de um `Y.Doc` temporário com o snapshot (`yXmlFragmentToProsemirrorJSON`). Não toca no documento ao vivo.
- **Restaurar:** botão com confirmação ("Isso cria uma versão do estado atual antes de voltar"). O conteúdo muda sozinho no editor, porque chega pelo socket.
- TanStack Query para a lista; invalidada quando o restore ou o "Salvar versão" termina.
- Leitores veem o painel e a pré-visualização, sem os botões de escrita.

## Testes

- **Serviço:** criar, listar sem o snapshot, retenção (a 51ª `auto` apaga a mais antiga e não toca nas `manual`), reivindicação (duas chamadas simultâneas criam uma versão só).
- **Salas:** `restore` com sala aberta e sem sala; o conteúdo final é o da versão; o update vai para `peers.publishUpdate`; uma edição concorrente de outro cliente não quebra a sala.
- **Rotas, por papel:** viewer lista e visualiza mas leva 403 ao criar e restaurar; um `versionId` de outro documento dá 404; documento apagado apaga as versões.
- **Entre instâncias** (`multi-instance.test.ts`): o restore pedido na instância A chega ao cliente da instância B.
- **E2E (`apps/e2e`):** Alice escreve, salva uma versão, apaga e escreve outra coisa, restaura; Bob (na outra instância) vê o texto voltar. O leitor não vê os botões.

## Passos e commits

Na branch `feat/versions`, um commit por passo:

1. Este plano
2. Model, índice e serviço de versões (`document_versions`, `versionedAt`) com testes
3. Versão automática e manual na sala
4. `restore` na sala e a ponte `content-restorer`
5. Rotas das versões e a limpeza ao apagar o documento
6. Teste entre instâncias
7. Web: painel, lista e pré-visualização
8. Web: salvar versão e restaurar
9. E2E
10. Docs: o que mudou na prática em relação ao plano

## Fora do escopo

- Comparação lado a lado (diff) entre versões.
- Nomear ou apagar versões `auto` à mão.
- Restaurar o título.
- Versões de documento por usuário (histórico de quem editou o quê, linha a linha): o Yjs não guarda autoria por trecho sem trabalho extra.
