# Presença: cursores e seleção

> **Estado: implementado** na branch `feat/presence`, um commit por passo da seção "Passos e commits". O que mudou na prática em relação ao plano está em "Diferenças do plano", no fim.

O tempo real já sincroniza o conteúdo (`docs/realtime.md`). Este plano acrescenta a **presença**: o cursor e a seleção de cada pessoa no documento, com nome e cor, e uma lista de quem está no documento.

A presença é **efêmera**: não vai para o Mongo nem para o `Y.Doc`. O Yjs tem uma estrutura própria para isso, o `Awareness` (`y-protocols`). Cada cliente guarda o próprio estado (`{ user: { name, color }, cursor: { anchor, head } }`) e troca só as mudanças com os outros. O `Awareness` renova o estado local a cada ~15s e remove quem fica 30s sem renovar, então uma aba que morreu sem avisar some sozinha.

## Decisões

- **O server só retransmite, sem guardar estado de presença.** Não há `Awareness` por sala no server. Quem entra pergunta (`awareness:query`) e os outros respondem com o próprio estado. Alternativa descartada: um `Awareness` por sala, como o `y-websocket`. Daria mais controle, mas é mais estado em memória para replicar entre instâncias; do jeito escolhido, o Redis adapter da semana 6 já retransmite a presença sem trabalho extra (ao contrário das salas de conteúdo, ver "Riscos" em `docs/realtime.md`).
- **Cada socket reivindica um `clientId`.** O cliente manda `{ clientId, update }`, onde `clientId` é o `ydoc.clientID` (o mesmo do `Awareness`). O server guarda o primeiro `clientId` de cada socket e ignora mensagens com outro. Assim ele sabe o que remover no `disconnect` sem decodificar o update e sem dependência nova.
- **Todo membro envia presença, inclusive o leitor.** Presença não é conteúdo, então não passa pelo `canEditRole`. O leitor aparece e vê os outros.
- **O nome vem da sessão e a cor é derivada do `userId`** (hash sobre uma paleta fixa), então a mesma pessoa tem a mesma cor em todas as abas e em todos os documentos. Quem já é membro poderia forjar o nome nos próprios envios; risco aceito, porque só membros enviam.
- **Sem `volatile`, com no máximo uma mensagem por frame (16ms) no cliente.** A ideia inicial era descartar posições velhas (`socket.volatile.emit`), mas isso deixava o cursor dos outros parado atrás do texto; ver "Diferenças do plano".
- **O server repassa a presença depois dos updates que o mesmo socket mandou antes dela**, para o cursor nunca chegar antes do texto a que ele aponta (ver "Ordem").
- **`@tiptap/extension-collaboration-caret` desenha o caret e a seleção**, recebendo `provider: { awareness }`. Fica sobre o `y-tiptap` que já está no editor.
- **Avatares de "quem está aqui" no header**, vindos do mesmo `Awareness`, sem repetir quem está em mais de uma aba.

## Protocolo

Mesma sala `doc:<documentId>`. Os payloads binários são `Uint8Array`/`Buffer`.

| Direção | Evento | Payload | O que o server faz |
|---|---|---|---|
| C → S | `awareness:update` | `{ clientId: number, update: Uint8Array }` | retransmite aos outros da sala, depois dos `doc:update` que o mesmo socket já mandou |
| C → S | `awareness:query` | nada | retransmite aos outros da sala; cada um responde com o próprio `awareness:update` |
| S → C | `awareness:left` | `clientId: number` | no `disconnect` do socket, para os outros removerem o estado dele na hora |

Nenhum dos eventos tem ack. Payload de tipo errado, `clientId` que não é inteiro, ou `clientId` diferente do que o socket já reivindicou: o server ignora, sem derrubar a conexão. O limite de tamanho é o `maxHttpBufferSize` que já existe.

## Ordem

Um cursor aponta para o texto por posições relativas do Yjs. Se a presença chega a quem olha **antes** do `doc:update` que escreveu aquele texto, a posição ainda não existe no `Y.Doc` dele e o `y-tiptap` não desenha o caret até o texto chegar. O server trata um `doc:update` de forma assíncrona (espera a sala e aplica o update antes de repassar) e a presença de forma síncrona, então sem cuidado a presença ultrapassa o texto, e o caret some e volta a cada tecla.

Por isso o `document-socket.ts` guarda a promessa dos updates que o socket mandou e ainda estão em andamento (`updatesInFlight`), e o `awareness:update` espera por ela antes de ser repassado. Várias presenças esperando a mesma promessa continuam em ordem. A cadeia resolve para `undefined` a cada passo, então nada se acumula.

## Server (`apps/server`)

- `realtime/document-socket.ts` ganha `registerAwareness(socket)`: guarda o `clientId` reivindicado em uma variável local do socket e registra os três eventos acima. Fica num arquivo próprio (`realtime/document-awareness.ts`) para não inflar o `document-socket.ts`.
- O `awareness:left` sai no `disconnect`, só se o socket chegou a reivindicar um `clientId`.
- Sem mudança em `document-rooms.ts`: a presença não passa pela sala em memória.

## Web (`apps/web`)

- `lib/document-socket.lib.ts` cria o `Awareness` do `ydoc` e:
  - a cada `awareness.on('update')` com origem local, manda `awareness:update` com `encodeAwarenessUpdate` dos clientes alterados (no máximo um envio por frame, 16ms, com o último estado sempre enviado);
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
- **Tráfego.** O cursor muda a cada tecla ou clique. O limite de um envio por frame no cliente evita a enxurrada (arrastar o mouse para selecionar gera muitos eventos), mas o server não confere; o rate limit por socket continua no `docs/todos.md`.
- **Várias instâncias (semana 6).** A retransmissão funciona com o Redis adapter. O `awareness:left` depende do socket que caiu estar na instância que emite; se a instância cair sem emitir, o timeout de 30s do `Awareness` limpa.
- **Versão do pacote do caret.** Conferir, ao instalar, que o `@tiptap/extension-collaboration-caret` casa com o `^3.32` do resto do Tiptap.

## Fora do escopo

- Nomes personalizados por documento, avatar com foto e o cursor "seguindo" outra pessoa.
- Redis adapter e E2E (semana 6).

## Diferenças do plano

- **`volatile` só nas posições de cursor.** O plano usava `volatile` em tudo. No navegador, a apresentação inicial e o `awareness:query` sumiam: o Socket.IO descarta uma mensagem `volatile` enviada enquanto a conexão ainda escreve a anterior, e os dois saíam no mesmo tick do `doc:update` do sync. Uma aba nova não via ninguém até a próxima pessoa mexer o cursor. Agora só o envio com throttle é `volatile`; a apresentação, o `query` e a resposta ao `query` são mensagens normais. Só apareceu com dois navegadores reais, e os testes do server não pegariam isso (o cliente de teste não escreve no mesmo tick).
- **O server ignora o `awareness:update` que chega depois do `disconnecting`.** O Socket.IO trata um evento recebido no tick seguinte (`process.nextTick`), mas trata a desconexão na hora. O último cursor de uma aba que fecha logo depois de mexer chegava depois do `awareness:left`, sendo retransmitido sem ninguém para removê-lo. Um flag `gone` descarta essas mensagens (e tem teste).
- **Os testes do server ficaram no `socket-server.test.ts`**, em dois blocos (`document awareness` e `document awareness on disconnect`), porque os helpers de socket são locais a esse arquivo. São 10 testes novos.
- **O avatar mostra só as outras pessoas**, sem a própria (o plano dizia "quem está aqui"): quatro avatares e "+N", escondido em telas pequenas. Quem tem duas abas continua sendo uma pessoa.
- **O `CollaborationCaret` sobrescreve o `user` do estado local** com a opção `user` ao criar o editor, então o editor recebe o mesmo `user` que o socket compartilha (`getPresenceUser`, em `lib/presence.lib.ts`, usado pelos dois). A cor do rótulo do template (`paragraph-node.scss`) passou a ser branca nos dois temas: o texto escuro do template não lia sobre as cores da paleta.
- **O cursor dos outros ficava atrás do texto, e aparecia e sumia.** Medido com dois navegadores (o Bob digita, e na tela da Alice se compara a posição do caret dele com o tamanho do texto, a cada 10ms, em 150 caracteres):

  | | atraso máximo | amostras com mais de 1 caractere de atraso | caret sumindo |
  |---|---|---|---|
  | 50ms de throttle + `volatile` (como estava) | 2 a 3 (12 em rajada) | 0,1% (40ms por tecla), 24% (15ms), 30% (rajada) | não |
  | 16ms, sem `volatile` | 1 (4 em rajada) | 0% (40ms e 15ms), 17% (rajada) | sim, 6 a 7 amostras |
  | + presença depois dos updates (final) | 1 (4 em rajada) | 0% (40ms e 15ms), 20% (rajada) | não |

  Três causas: o throttle de 50ms atrasava só a posição, porque o texto vai na hora; o `volatile` descarta a posição quando a conexão está escrevendo (digitar é um `doc:update` e uma posição juntos), e uma posição perdida não é substituída quando a pessoa para de digitar; e, sem o throttle, a posição passava na frente do texto (seção "Ordem"). A rajada sem pausa é digitação que ninguém faz (cerca de 250 caracteres por segundo), e o que sobra ali é o frame do throttle. O teste "relays the presence after the document update that was sent before it" falha sem a espera e passa com ela. O `volatile` que o plano previa não existe mais em lugar nenhum.
- **O rótulo do cursor vazava da tela.** Num celular de 375px, um cursor perto da borda direita empurrava o rótulo até 75px para fora. A extensão `CaretLabelPlacement` (`components/tiptap-extension/`) vira o rótulo para a esquerda quando ele não cabe (a posição é recalculada a cada atualização do editor e no resize, porque o ProseMirror move e reaproveita esses widgets). O pior caso medido passou de +75px para −15px de folga.
- **O grupo de avatares aparece também no celular**, compacto: 2 avatares e "+N" abaixo de 640px, 4 e "+N" acima. Antes ficava escondido e não havia como ver quem estava no documento. O título do documento encolhe para ~110px a 375px (56px a 320px, no modo leitor, que é o header mais cheio).
- **O pacote ficou na 3.32.3**, não na 3.35.0 que o pnpm escolheu. O peer dela pede `@tiptap/core` 3.35.0 e o resto do Tiptap está na 3.32.
- **O `Awareness` nasce junto com o socket** (`createDocumentSocket`) e chega ao editor pelo hook, em estado. Isso soma um aviso do lint (`set-state-in-effect`) no `use-document-sync.hook.ts`.
- **O cursor só existe enquanto o editor tem foco**, um comportamento do `y-tiptap`. Por isso o leitor (editor não editável) aparece nos avatares, mas não tem caret para os outros. Quem perde o foco some do texto, e continua nos avatares.
- **Validação no navegador** (Chromium do Playwright, um contexto por usuário, script fora do repositório): caret com nome nos dois sentidos, seleção destacada, tema claro e escuro, aba que fecha some em menos de 3s, aba nova vê quem já estava, duas abas da mesma pessoa viram um avatar, leitor vê o dono, e depois de reiniciar o server (`tsx watch`) os avatares somem e voltam sem ninguém tocar em nada. Em tela pequena (emulação de celular com toque, 375px e 320px, como editor e como leitor): sem estouro de largura e rótulo dentro da tela. Sem validar: o grupo com "+N" (só havia duas pessoas nos testes), teclado virtual de verdade e o upgrade de WebSocket em produção (pendência antiga de `docs/realtime.md`).
