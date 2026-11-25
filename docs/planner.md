# Editor de Documentos Colaborativo (MERN)

Editor de documentos web estilo Notion/Google Docs simplificado, com edição em tempo real por vários usuários. Produto simples, engenharia caprichada.

## Objetivo no portfólio

Mostrar domínio da stack MERN em um cenário difícil de verdade: tempo real, sincronização de estado entre clientes, permissões e modelagem de documentos em NoSQL.

## Stack

| Camada | Tecnologia |
|---|---|
| Front | React + Vite + TypeScript, Tiptap (ProseMirror), TanStack Query, React Router, Tailwind, shadcn/ui |
| Back | Node.js + Express 5 + TypeScript, Zod |
| Tempo real | Socket.IO + Yjs (CRDT) |
| Banco | MongoDB (driver nativo) |
| Cache / pub-sub | Redis (adapter do Socket.IO para escalar horizontalmente) |
| Auth | Better Auth (e-mail + senha, verificação por e-mail via Resend, guest anônimo), sessão em cookie |
| Testes | Vitest, Supertest (server, feito), Playwright (a fazer) |
| Infra | Docker Compose (dev), CI/CD no GitHub Actions, Fly.io (API) + Vercel (web) + Mongo Atlas |

## Funcionalidades

### MVP
- Cadastro, login e logout (feito) e modo guest (feito, fora do plano original)
- Criar, renomear, listar e excluir documentos
- Editor rico: títulos, negrito/itálico, listas, checklist, código, citação, links
- Autosave
- Compartilhar documento por e-mail com papel: dono, editor ou leitor
- Edição simultânea em tempo real com Yjs
- Presença: cursores e seleção de outros usuários com nome e cor

### V2
- Histórico de versões com snapshots e restauração
- Comentários em trechos do texto
- Slash commands (`/titulo`, `/lista`, `/codigo`)
- Busca full-text nos documentos (índice de texto do Mongo ou Atlas Search)
- Export para Markdown e PDF
- Link público somente leitura
- Modo offline com sincronização ao reconectar (Yjs + IndexedDB)

## Modelagem (MongoDB)

```ts
// User, session e account são coleções do Better Auth (não há model próprio)

Document {
  _id, title, ownerId,
  members: [{ userId, role: 'owner' | 'editor' | 'viewer' }],
  ydocState: Binary,      // estado binário do Yjs
  contentVersion: number, // concorrência otimista na gravação do ydocState
  updatedAt, createdAt
}

DocumentVersion {
  _id, documentId, snapshot: Buffer, createdBy, createdAt
}

Comment {
  _id, documentId, authorId, anchor, body, resolved, createdAt
}
```

## Arquitetura do tempo real

1. Cliente abre o documento e conecta um socket (`/api/socket.io`) com o id do documento. O handshake é autenticado pela sessão do Better Auth (cookie) e valida a participação; entra na sala `doc:<id>`.
2. O cliente e o servidor trocam *state vectors* (`doc:sync`) e cada um manda o que falta ao outro. É o mesmo passo na primeira conexão e em cada reconexão.
3. Cada edição gera um update binário do Yjs, enviado ao servidor e retransmitido para a sala.
4. Updates são acumulados em memória/Redis e persistidos no Mongo com debounce (ex.: a cada 2s ou N updates).
5. Com o Redis adapter, várias instâncias do servidor compartilham as salas.
6. Leitores recebem updates, mas o servidor rejeita updates vindos deles.

## API REST (resumo)

```
/api/auth/*                         # Better Auth (sign-up, sign-in, sign-out, verificação, guest)

GET    /api/documents
POST   /api/documents
GET    /api/documents/:id
PATCH  /api/documents/:id
DELETE /api/documents/:id
# O conteúdo (estado e updates do Yjs) trafega pelo socket em /api/socket.io, ver docs/realtime.md

GET    /api/documents/:id/members            # qualquer membro, com nome e e-mail
POST   /api/documents/:id/members            # dono convida por e-mail (editor | viewer)
PATCH  /api/documents/:id/members/:userId   # dono muda o papel
DELETE /api/documents/:id/members/:userId   # dono remove; membro sai (o próprio userId)

GET    /api/documents/:id/versions            # V2
POST   /api/documents/:id/versions/:versionId/restore   # V2
```

## Roadmap (8 semanas)

| Semana | Entrega | Estado |
|---|---|---|
| 1 | Setup do monorepo, Docker Compose, CI, auth completa | feito (v0.1.0; Compose só para dev) |
| 2 | CRUD de documentos e tela de listagem | feito |
| 3 | Editor com Tiptap e autosave via REST | feito (já com Yjs, ver `document-persistence.md`) |
| 4 | Tempo real com Socket.IO + Yjs, persistência com debounce | feito (`docs/realtime.md`) |
| 5 | Presença (cursores), compartilhamento e permissões | compartilhamento e permissões feitos (`docs/sharing.md`); presença a fazer |
| 6 | Redis adapter, testes de integração e E2E com dois navegadores | a fazer |
| 7 | Histórico de versões e busca | a fazer |
| 8 | Deploy, README caprichado, GIF de demo, polimento | deploy feito; o resto a fazer |

### Próximo passo

O tempo real está pronto (`docs/realtime.md`). Segue a presença (cursores e seleção com nome e cor, via `y-protocols/awareness` na mesma sala do socket) e, na semana 6, o Redis adapter e os testes E2E com dois navegadores. Antes do Redis adapter, ler "Riscos" em `docs/realtime.md`: as salas em memória de cada instância precisarão receber os updates das outras.

## O que destacar no README

- GIF com duas janelas editando o mesmo documento ao mesmo tempo
- Diagrama da arquitetura de sincronização
- Por que CRDT em vez de "último a salvar vence"
- Teste E2E que simula dois usuários editando em paralelo
- Como o sistema escala com várias instâncias (Redis adapter)
- Decisões e trade-offs (Mongo para o documento, debounce de persistência)
