# Histórico de versões

> **Estado: implementado** na branch `feat/versions`, um commit por passo da seção "Passos e commits". O que mudou na prática em relação ao plano está em "Diferenças do plano", no fim. Primeira metade da semana 7; a busca (`docs/search.md`) é a segunda metade, com plano e branch próprios.

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
- **Retenção:** as 50 `auto` e as 10 `before-restore` mais recentes por documento; as `manual` nunca são apagadas. Ao inserir uma versão desses dois tipos, o server apaga as que passaram do limite. (O plano original só limitava as `auto`; ver "Limites contra abuso" em "Diferenças do plano".)
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

## Diferenças do plano

O que mudou ao construir, e o que apareceu de verdade:

- **Diálogo, não painel lateral.** O histórico abre num `Dialog` grande (lista à esquerda, pré-visualização à direita; empilhados no celular), como o de compartilhar. Não ocupa espaço do editor e reaproveitou o componente que já existia.
- **A pré-visualização usa a extensão `Collaboration`, com um `Y.Doc` só dela.** O plano dizia "sem Collaboration" e converter com `yXmlFragmentToProsemirrorJSON`. Ligar a extensão a uma cópia do documento, sem socket nenhum, dá o mesmo resultado (leitura, sem tocar no documento ao vivo) com menos código, e o editor é montado pelo mesmo caminho do editor de verdade. Para o schema ser o mesmo, as extensões de nós e marcas foram extraídas para `lib/document-extensions.lib.ts`, usado pelos dois. O `ImageUploadNode` entra só na pré-visualização com um upload que sempre falha: o schema precisa conhecer o nó mesmo que nada seja enviado ali.
- **A ponte se chama `live-content.ts` e faz duas coisas**, não uma: `currentState` (para a versão manual e para a `before-restore`) e `restore`. Sem socket server (testes de rota) ela funciona direto no Mongo, como se ninguém tivesse o documento aberto; assim as rotas são testáveis sem subir Socket.IO.
- **`replaceContent` ficou em `services/replace-content.ts`**, uma função pura sobre um `Y.Doc` (a sala e o modo "só Mongo" usam a mesma). `currentState` na sala (`rooms.currentState`) abre a sala se ninguém a tem, que já pergunta às outras instâncias, e a fecha em seguida.
- **O `hasContent` ficou fora do caminho quente.** A sala confere o tamanho do fragmento no `Y.Doc` que já tem em memória, e o serviço recebe o estado por função (`getState`), que só é chamada quando a versão vai mesmo ser criada. Sem isso, cada gravação (a cada 2s de digitação) decodificaria o documento inteiro só para descobrir que ainda não é hora.
- **A listagem devolve o autor com o nome** (`createdBy: { userId, name }`, ou `null` nas automáticas, e `name: null` se a conta não existe mais), com um `$in` na coleção `user`. O plano só citava o autor na interface.
- **`POST /versions` recusa documento vazio** (400 "The document is empty"): uma versão sem nada não ajuda ninguém, e é a mesma regra das automáticas.
- **Apagar o documento também apaga as versões dos documentos de um guest** (`delete-guest-documents`), não só a rota de `DELETE`. O plano só citava a rota.

### Limites contra abuso

Cada versão guarda o documento inteiro, então salvar sem parar enche o Mongo. Três camadas, acrescentadas depois do plano:

- **30 por hora por pessoa** em `POST /versions` e em `restore`, no mesmo contador (o restore também cria um snapshot). Mesmo desenho do limite de convites (`SwitchableRateLimitStore`): memória sem Redis, Redis com ele, e a requisição passa se o contador falha. Responde 429 e a tela mostra "Too many versions saved. Try again later."
- **Não duplicar o que não mudou.** `POST /versions` compara o documento com a versão mais recente e, se for o mesmo, devolve essa (200, em vez de 201) sem criar outra. Se a pessoa deu um nome que ela não tem, é essa versão que passa a ser `manual` com o nome (e deixa de ser removável pela retenção). O `restore` também não guarda o conteúdo atual quando a versão mais recente já o tem.
- **Retenção das `before-restore`: as 10 mais recentes.** São uma rede de segurança, não uma escolha da pessoa.

A comparação passa os dois estados por um `Y.Doc` antes de comparar os bytes: o mesmo documento pode estar codificado de formas diferentes (updates juntados pelo Mongo contra a codificação de um `Y.Doc`). Os `sort` das versões desempatam por `_id`: duas versões feitas no mesmo milissegundo deixavam a "mais recente" indefinida (apareceu como um teste intermitente da listagem).

### Verificações já feitas

- **Aplicar o estado antigo não restaura nada**, e o teste mostra isso antes de mostrar o que funciona (`replace-content.test.ts`). O estado novo, com o conteúdo copiado, converge numa réplica que o recebe e num cliente que ficou offline durante o restore, sem trazer de volta o que foi apagado.
- **Um cliente que não tem o conteúdo antigo não aplica o restore.** O update do restore insere o novo conteúdo ao lado de itens que ele apaga, então depende deles (o Yjs guarda o update como pendente até receber essas dependências). Num cliente de verdade isso não acontece, porque ele tem o conteúdo que o restore substitui. Apareceu num teste meu que escrevia o texto num `Y.Doc` e enviava de outro.
- **O restore no meio de uma janela de gravação de outra instância.** Se o restore é feito pela instância B e o texto atual só está na sala da A (a gravação dela ainda não aconteceu), a B grava um update que depende de itens que o Mongo ainda não tem. O Mongo só fica completo quando a A grava, até 10s depois. O teste entre instâncias espera por isso. Se a A cair nesse intervalo, o texto que só ela tinha se perde no Mongo e sobrevive nos clientes, a mesma troca já aceita em `docs/redis.md` para qualquer edição.
- **Quem digita durante o restore pode perder o trecho** (a edição se ancora em nós apagados). Documentado, como no plano; o teste só confere que as duas réplicas terminam iguais.

### Números

- Server: 215 testes com Redis (196 + 19 que precisam do Redis), contra 153 antes. Sem Redis, 196 passam e 19 são pulados.
- E2E: 19 testes (eram 17), 30 execuções nas duas topologias (eram 26). O spec novo é `tests/versions.spec.ts`.

### Ficou de fora

- Um teto de versões manuais por documento: sem uma rota para apagar versões, o teto deixaria a pessoa sem saída. Se o Mongo pesar, a peça seguinte é um `DELETE /versions/:id` das manuais, com uma tela para isso.
- Testar a retenção e a reivindicação com um Redis fora do ar, ou duas instâncias gravando o mesmo documento no mesmo instante, ponta a ponta. A reivindicação tem teste de concorrência no serviço (cinco chamadas simultâneas, uma versão), mas não entre instâncias reais.
