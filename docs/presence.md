# Presença: cursores e seleção

> **Estado: em andamento** na branch `feat/presence`, um commit por passo da seção "Passos e commits".

O tempo real já sincroniza o conteúdo (`docs/realtime.md`). Este plano acrescenta a **presença**: o cursor e a seleção de cada pessoa no documento, com nome e cor, e uma lista de quem está no documento.

A presença é **efêmera**: não vai para o Mongo nem para o `Y.Doc`. O Yjs tem uma estrutura própria para isso, o `Awareness` (`y-protocols`). Cada cliente guarda o próprio estado (`{ user: { name, color }, cursor: { anchor, head } }`) e troca só as mudanças com os outros. O `Awareness` renova o estado local a cada ~15s e remove quem fica 30s sem renovar, então uma aba que morreu sem avisar some sozinha.

## Decisões

- **O server só retransmite, sem guardar estado de presença.** Não há `Awareness` por sala no server. Quem entra pergunta (`awareness:query`) e os outros respondem com o próprio estado. Alternativa descartada: um `Awareness` por sala, como o `y-websocket`. Daria mais controle, mas é mais estado em memória para replicar entre instâncias; do jeito escolhido, o Redis adapter da semana 6 já retransmite a presença sem trabalho extra (ao contrário das salas de conteúdo, ver "Riscos" em `docs/realtime.md`).
- **Cada socket reivindica um `clientId`.** O cliente manda `{ clientId, update }`, onde `clientId` é o `ydoc.clientID` (o mesmo do `Awareness`). O server guarda o primeiro `clientId` de cada socket e ignora mensagens com outro. Assim ele sabe o que remover no `disconnect` sem decodificar o update e sem dependência nova.
- **Todo membro envia presença, inclusive o leitor.** Presença não é conteúdo, então não passa pelo `canEditRole`. O leitor aparece e vê os outros.
- **O nome vem da sessão e a cor é derivada do `userId`** (hash sobre uma paleta fixa), então a mesma pessoa tem a mesma cor em todas as abas e em todos os documentos. Quem já é membro poderia forjar o nome nos próprios envios; risco aceito, porque só membros enviam.
- **Emit `volatile`.** Uma posição de cursor velha não serve para nada, então se a conexão estiver ocupada ou caída a mensagem pode ser descartada (`socket.volatile.emit`).
- **`@tiptap/extension-collaboration-caret` desenha o caret e a seleção**, recebendo `provider: { awareness }`. Fica sobre o `y-tiptap` que já está no editor.
- **Avatares de "quem está aqui" no header**, vindos do mesmo `Awareness`, sem repetir quem está em mais de uma aba.

## Protocolo

Mesma sala `doc:<documentId>`. Os payloads binários são `Uint8Array`/`Buffer`.

| Direção | Evento | Payload | O que o server faz |
|---|---|---|---|
| C → S | `awareness:update` | `{ clientId: number, update: Uint8Array }` | retransmite aos outros da sala (`volatile`) |
| C → S | `awareness:query` | nada | retransmite aos outros da sala; cada um responde com o próprio `awareness:update` |
| S → C | `awareness:left` | `clientId: number` | no `disconnect` do socket, para os outros removerem o estado dele na hora |

Nenhum dos eventos tem ack. Payload de tipo errado, `clientId` que não é inteiro, ou `clientId` diferente do que o socket já reivindicou: o server ignora, sem derrubar a conexão. O limite de tamanho é o `maxHttpBufferSize` que já existe.

## Server (`apps/server`)

- `realtime/document-socket.ts` ganha `registerAwareness(socket)`: guarda o `clientId` reivindicado em uma variável local do socket e registra os três eventos acima. Fica num arquivo próprio (`realtime/document-awareness.ts`) para não inflar o `document-socket.ts`.
- O `awareness:left` sai no `disconnect`, só se o socket chegou a reivindicar um `clientId`.
- Sem mudança em `document-rooms.ts`: a presença não passa pela sala em memória.

## Web (`apps/web`)

- `lib/document-socket.lib.ts` cria o `Awareness` do `ydoc` e:
  - a cada `awareness.on('update')` com origem local, manda `awareness:update` com `encodeAwarenessUpdate` dos clientes alterados (limitado a ~1 envio por 50ms);
  - aplica o que chega com `applyAwarenessUpdate`;
  - remove o `clientId` que chega em `awareness:left` (`removeAwarenessStates`);
  - ao ficar `ready` (primeira conexão e cada reconexão), reenvia o estado local e faz `awareness:query`;
  - no `disconnect`, marca os estados remotos como saídos (`removeAwarenessStates` de todos menos o local), porque ninguém vai avisar enquanto a conexão está fora.
- O estado local (`user: { name, color }`) é definido no hook, a partir da sessão. A cor vem de `lib/presence-color.lib.ts` (hash do `userId` sobre uma paleta).
- Expõe `awareness` e `people` (lista de `{ userId, name, color }` sem repetição).
- `SimpleEditor` recebe o `awareness` e configura o `CollaborationCaret` (rótulo com nome e cor). O CSS do caret e da seleção usa a cor do usuário e funciona nos temas claro e escuro.
- `document-header.tsx` mostra os avatares de `people` (iniciais sobre a cor; "+N" quando passar de 5).

## Testes

- **Server** (bloco `document awareness` do `socket-server.test.ts`, que já tem os helpers de socket): o update chega aos outros e não volta a quem enviou; o leitor consegue enviar; payload inválido é ignorado e a conexão continua; um segundo `clientId` no mesmo socket é ignorado; `query` chega aos outros; `awareness:left` sai no disconnect com o `clientId` certo e não sai para quem nunca reivindicou.
- **Web:** não há framework de teste ainda. Validação manual no Chromium do Playwright com duas janelas: cursor e seleção nos dois sentidos, fechar a aba, derrubar o server e reconectar, e um leitor olhando um editor. O E2E de dois navegadores é da semana 6.

## Passos e commits

1. `docs`: este plano e o estado no `planner.md`.
2. `feat(server)`: `awareness:update` e `awareness:query`, com a reivindicação do `clientId`.
3. `feat(server)`: `awareness:left` no disconnect.
4. `feat(web)`: `Awareness` no cliente do socket.
5. `feat(web)`: caret e seleção no editor.
6. `feat(web)`: avatares de quem está no documento.
7. `docs`: fechar o plano (README, planner, diferenças do plano).

## Riscos e pontos a conferir

- **Reconexão.** Sem reenviar o estado e perguntar de novo depois de cada `ready`, a pessoa reconecta sem cursor para os outros. Está no passo 4.
- **Tráfego.** O cursor muda a cada tecla ou clique. O limite de ~50ms no cliente evita a enxurrada; o rate limit por socket continua no `docs/todos.md`.
- **Várias instâncias (semana 6).** A retransmissão funciona com o Redis adapter. O `awareness:left` depende do socket que caiu estar na instância que emite; se a instância cair sem emitir, o timeout de 30s do `Awareness` limpa.
- **Versão do pacote do caret.** Conferir, ao instalar, que o `@tiptap/extension-collaboration-caret` casa com o `^3.32` do resto do Tiptap.

## Fora do escopo

- Nomes personalizados por documento, avatar com foto e o cursor "seguindo" outra pessoa.
- Redis adapter e E2E (semana 6).

## Diferenças do plano

(preenchido no fim)
