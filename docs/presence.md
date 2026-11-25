# Presença: cursores e seleção

> **Estado: implementado** na branch `feat/presence`, um commit por passo da seção "Passos e commits". O que mudou na prática em relação ao plano está em "Diferenças do plano", no fim.

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

- **`volatile` só nas posições de cursor.** O plano usava `volatile` em tudo. No navegador, a apresentação inicial e o `awareness:query` sumiam: o Socket.IO descarta uma mensagem `volatile` enviada enquanto a conexão ainda escreve a anterior, e os dois saíam no mesmo tick do `doc:update` do sync. Uma aba nova não via ninguém até a próxima pessoa mexer o cursor. Agora só o envio com throttle é `volatile`; a apresentação, o `query` e a resposta ao `query` são mensagens normais. Só apareceu com dois navegadores reais, e os testes do server não pegariam isso (o cliente de teste não escreve no mesmo tick).
- **O server ignora o `awareness:update` que chega depois do `disconnecting`.** O Socket.IO trata um evento recebido no tick seguinte (`process.nextTick`), mas trata a desconexão na hora. O último cursor de uma aba que fecha logo depois de mexer chegava depois do `awareness:left`, sendo retransmitido sem ninguém para removê-lo. Um flag `gone` descarta essas mensagens (e tem teste).
- **Os testes do server ficaram no `socket-server.test.ts`**, em dois blocos (`document awareness` e `document awareness on disconnect`), porque os helpers de socket são locais a esse arquivo. São 9 testes novos.
- **O avatar mostra só as outras pessoas**, sem a própria (o plano dizia "quem está aqui"): quatro avatares e "+N", escondido em telas pequenas. Quem tem duas abas continua sendo uma pessoa.
- **O `CollaborationCaret` sobrescreve o `user` do estado local** com a opção `user` ao criar o editor, então o editor recebe o mesmo `user` que o socket compartilha (`getPresenceUser`, em `lib/presence.lib.ts`, usado pelos dois). A cor do rótulo do template (`paragraph-node.scss`) passou a ser branca nos dois temas: o texto escuro do template não lia sobre as cores da paleta.
- **O pacote ficou na 3.32.3**, não na 3.35.0 que o pnpm escolheu. O peer dela pede `@tiptap/core` 3.35.0 e o resto do Tiptap está na 3.32.
- **O `Awareness` nasce junto com o socket** (`createDocumentSocket`) e chega ao editor pelo hook, em estado. Isso soma um aviso do lint (`set-state-in-effect`) no `use-document-sync.hook.ts`.
- **O cursor só existe enquanto o editor tem foco**, um comportamento do `y-tiptap`. Por isso o leitor (editor não editável) aparece nos avatares, mas não tem caret para os outros. Quem perde o foco some do texto, e continua nos avatares.
- **Validação no navegador** (Chromium do Playwright, um contexto por usuário, script fora do repositório): caret com nome nos dois sentidos, seleção destacada, tema claro e escuro, aba que fecha some em menos de 3s, aba nova vê quem já estava (depois da correção do `volatile`), duas abas da mesma pessoa viram um avatar, leitor vê o dono, e depois de reiniciar o server (`tsx watch`) os avatares somem e voltam sem ninguém tocar em nada. Sem validar: layout em tela pequena e o upgrade de WebSocket em produção (pendência antiga de `docs/realtime.md`).
