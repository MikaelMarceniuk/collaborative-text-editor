# Busca

> **Estado: em andamento** na branch `feat/search`, um commit por passo da seção "Passos e commits". Segunda metade da semana 7 (a primeira foi o histórico de versões, `docs/versions.md`).

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
