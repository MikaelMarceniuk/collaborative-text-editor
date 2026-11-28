# Busca

> **Estado: implementado** na branch `feat/search`, um commit por passo da seção "Passos e commits". O que mudou na prática em relação ao plano está em "Diferenças do plano", no fim. Segunda metade da semana 7 (a primeira foi o histórico de versões, `docs/versions.md`).

Hoje o campo de busca da lista de documentos filtra só pelo **título**, no navegador. Quem tem muitos documentos lembra do que escreveu, não do nome que deu. Este plano faz a busca olhar o **título e o texto** dos documentos a que a pessoa tem acesso, no server, e mostrar um trecho de onde a palavra apareceu.

## Decisões

- **Palavra inteira, sem diferenciar maiúsculas nem acentos** (`coracao` acha `Coração`, `projeto` não acha `projetos`). É o que o índice de texto do Mongo (`$text`) faz. Confirmado em um Mongo 8 antes de escrever este plano.
- **Título e conteúdo juntos, em uma busca só.** Um índice de texto por coleção é um limite do Mongo, então um índice cobre os dois campos. O título pesa 10 e o conteúdo 1, para um documento com a palavra no título vir antes de um que só a cita no meio do texto. Filtrar só pelo título exigiria uma regex sem índice; não entra agora.
- **Várias palavras são um "E"**: `plano projeto` acha os documentos que têm as duas. O `$text` sozinho faria "OU". O server põe cada palavra entre aspas, o que muda o comportamento para "todas as frases", e tira `"` e `-` do começo do que a pessoa digitou, para ninguém usar a sintaxe do Mongo (negação, frase) sem querer.
- **O texto vai para um campo `searchText` no documento**, gravado junto com o `ydocState`. O Mongo não enxerga dentro do binário do Yjs, então alguém precisa extrair o texto. Esse alguém é a gravação (`applyDocumentUpdate`): ela já faz o merge do estado, então já tem o novo estado na mão. Uma consulta nunca decodifica Yjs.
  - **Alternativa descartada: extrair na hora da busca.** Decodificaria todos os documentos da pessoa a cada letra digitada.
  - **Alternativa descartada: extrair no cliente e mandar o texto.** O server teria que confiar no que o navegador manda sobre o conteúdo.
- **`searchText` é cortado em 100 000 caracteres.** O índice de texto guarda uma entrada por palavra, então um documento enorme incharia o índice. Quem passa disso deixa de ser achado pelo que está depois do corte; o título continua valendo.
- **`default_language: 'none'`.** Sem stemming nem lista de palavras ignoradas: o texto é em português e inglês, e o stemmer do Mongo é só de um idioma por índice. Com `none`, "the" e "de" também são buscáveis.
- **Gravar o texto é parte da gravação, não um job à parte.** Se algo falhar no meio, o documento e o `searchText` não ficam um em cada versão: é um `updateOne` só.
- **Documentos que já existem não têm `searchText`.** Um script de backfill preenche (abaixo). Até rodar, esses documentos continuam achados pelo título.
- **A busca vira o filtro da lista**, no lugar do filtro local por título. Os botões Todos / Meus / Compartilhados continuam funcionando em cima dos resultados.

## O texto que entra no índice

`extractText(ydoc)` percorre o `Y.XmlFragment` `'default'` (o mesmo campo do restore) e junta o texto dos `Y.XmlText`. Cada elemento (parágrafo, item de lista, título) termina com um espaço, para a última palavra de um parágrafo não colar na primeira do seguinte. Marcas de formatação (negrito, link) ficam no mesmo `Y.XmlText` como atributos, então "**ne**grito" não é partido no meio. Imagens e outros embeds não têm texto e são pulados.

## Modelagem

```ts
// Novo campo em Document
Document { ..., searchText?: string }
```

- Índice `documents_text`: `{ title: 'text', searchText: 'text' }`, `weights: { title: 10, searchText: 1 }`, `default_language: 'none'`. Criado no `ensureIndexes`, como os outros.
- `searchText` fica **fora** de todas as leituras de documento da API (a lista, o `GET /:id`, o `PATCH`), junto com o `ydocState`. Seria um texto inteiro a mais em cada resposta.

## API

```
GET /api/documents/search?q=palavra     # { documents: [{ ...DocumentSummary, snippet }] }
```

- Declarada **antes** de `/:id`, senão `search` seria lido como um id.
- Só devolve documentos em que a pessoa é membro (`members.userId`), qualquer papel.
- `q`: `trim`, 1 a 100 caracteres; fora disso, 400.
- Ordem pelo `textScore`; no máximo 20 resultados.
- `snippet`: `null` quando só o título casou; senão `{ text, matches: [[início, fim], ...] }`, cerca de 140 caracteres em volta da primeira palavra achada, com a posição de cada palavra dentro do trecho para o navegador destacar. O trecho é calculado comparando o texto "dobrado" (sem acento, minúsculo) com um mapa de volta para as posições originais, porque tirar acento muda o tamanho do texto.

## Backfill

`pnpm --filter @collaborative-text-editor/server backfill:search-text` preenche o `searchText` dos documentos que têm `ydocState` e ainda não têm o campo. É seguro rodar mais de uma vez e com o server no ar: cada gravação só vale se o `contentVersion` ainda for o que foi lido (a mesma checagem otimista de `applyDocumentUpdate`), então não pisa em uma edição que acabou de chegar. O deploy é seu, então o script é um comando que você roda, não algo que o server faz sozinho.

## Web

- `useSearchDocuments(query)`: TanStack Query, com a consulta atrasada em ~300 ms depois da última tecla e `keepPreviousData` para a lista não piscar a cada letra.
- A lista mostra o trecho em uma segunda linha do item, com as palavras em `<mark>`.
- Sem texto digitado, vale a lista normal (`GET /documents`), como hoje.

## Passos e commits

1. `docs`: este plano.
2. `feat(server)`: `extractText` + `searchText` gravado em `applyDocumentUpdate`, com testes.
3. `feat(server)`: índice de texto, `GET /documents/search` e snippet, com testes.
4. `feat(server)`: script de backfill, com teste.
5. `feat(web)`: a lista usa a busca e mostra o trecho.
6. `test(e2e)`: buscar por uma palavra do conteúdo e abrir o documento.
7. `docs`: fechar o plano com o que mudou, README e `planner`.

## Ficou de fora

- Buscar dentro do documento aberto: já existe (`Search and replace` do editor).
- Buscar nas versões antigas.
- Sugestões, correção de digitação e prefixos (`proj` achando `projeto`). O `$text` não faz; seria outra tecnologia (Atlas Search, por exemplo).

## Diferenças do plano

O que mudou ao construir, e o que apareceu de verdade:

- **`extractText` recebe o fragmento, não o `Y.Doc`**, e `searchTextOf(state)` (decodifica o estado e chama o `extractText`) ficou em `document-content.service.ts`. Assim o serviço importa o `extract-text.ts` e não o contrário, sem importação circular.
- **A leitura anda por uma lista de trabalho, não por recursão.** O conteúdo vem dos clientes, e um update feito à mão pode aninhar elementos em milhares de níveis sem recursão nenhuma (cada item é uma estrutura solta). Recursão estouraria a pilha; a lista só custa tempo. O teste monta 20 000 níveis.
- **O `searchText` saiu das respostas já no passo 2**, não no 3: o `ydocState` e o `searchText` estão numa constante só (`HIDDEN_FIELDS`) nas projeções da lista, do `GET /:id` e do `PATCH`. A busca também tira o `score` do `textScore`, que só serve para ordenar: o teste que confere a resposta pegou esse vazamento.
- **No máximo 10 palavras por busca** (`termsOf`). O plano não limitava; cada palavra vira uma frase para o Mongo conferir.
- **O trecho acha palavras, não pedaços de texto.** Para dizer onde está a palavra, o texto e a busca passam pelo mesmo "dobrar" do índice (sem acento, minúsculo) e são cortados em palavras (`[\p{L}\p{N}]+`), então `projeto` não marca o começo de `projetos`, e `mail` marca o fim de `e-mail`, como o índice. Cada caractere dobrado lembra de onde veio no original, porque dobrar muda o tamanho (um `İ` vira dois caracteres) e o navegador precisa das posições do texto original. As bordas do trecho vão para o espaço mais próximo, e há reticências onde o texto foi cortado.
- **O título não é destacado.** O resultado mostra o título como está; só o trecho do conteúdo tem as palavras marcadas.
- **Os botões Todos / Meus / Compartilhados contam os resultados**, não a lista inteira, quando há algo digitado.
- **A lista fica esmaecida enquanto a próxima resposta não chega** (`aria-busy`), em vez de piscar ou sumir, e o primeiro resultado mostra o esqueleto de carregamento.
- **Dois scripts de backfill**: `backfill:search-text` (dev, com `tsx`) e `backfill:search-text:prd` (o `dist` compilado, com `--env-file=.env`, para rodar fora do Fly). No Fly o ambiente vem dos secrets, sem `.env`; ver "Deploy".

### Deploy

1. Publicar o server. No primeiro start o `ensureIndexes` cria o índice de texto (`documents_text`); numa coleção pequena é imediato. Até o backfill rodar, a busca acha qualquer documento pelo título, e pelo texto só os que foram editados depois do deploy.
2. Rodar o backfill uma vez:

```
fly ssh console -a collaborative-text-editor-server -C "node dist/scripts/backfill-search-text.js"
```

A saída diz quantos documentos foram preenchidos e quantos foram pulados por terem mudado no meio. É seguro rodar de novo.

### Verificações já feitas

- **O comportamento do `$text` foi conferido num Mongo 8 antes do plano**: sem acento e sem maiúscula nos dois sentidos, só palavra inteira (`proj` não acha `projeto`, `projeto` não acha `projetos`), `-` separa palavras (`mail` acha `e-mail`) e frases entre aspas exigem todas.
- **Os testes de rota usam o índice de verdade**, não um mock: ordem por título antes de conteúdo, "E" entre palavras, palavra no título e outra no texto no mesmo documento, só documentos em que a pessoa é membro, limite de 20, e a sintaxe do Mongo (`-palavra`, aspas soltas, só pontuação) não passa.
- **O texto acompanha as edições**: apagar o parágrafo faz a palavra deixar de ser achada (a gravação refaz o `searchText` a partir do estado inteiro, não só do último update).
- **O script compilado (`dist`) rodou num banco descartável** e preencheu o documento antigo.
- **E2E, nas duas topologias**: achar pelo conteúdo ignorando acento e maiúscula, ver a palavra marcada e abrir o documento; "E" entre palavras e palavra inteira; e quem não é membro não acha, até ser convidado (Bob no outro server).

### Números

- Server: 267 testes com Redis (248 + 19 que precisam do Redis; ligam com `TEST_REDIS_URL`), contra 215 antes. Sem Redis, 248 passam e 19 são pulados.
- E2E: 22 testes (eram 19), 36 execuções nas duas topologias (eram 30). O spec novo é `tests/search.spec.ts`.

### Limites que ficaram

- **O texto só muda quando o documento é gravado** (até 2 s depois de parar de digitar, 10 s no máximo, como o resto da gravação). Quem digita uma palavra e busca no mesmo segundo não a acha.
- **Documentos acima de 100 000 caracteres só são achados pelo que vem antes do corte** (e pelo título).
- **Paginação.** Os 20 melhores resultados são tudo que a lista mostra.
- **Destacar o título.**
