# Editor de Documentos Colaborativo (MERN)

Editor de documentos web estilo Notion/Google Docs simplificado, com edição em tempo real por vários usuários. Produto simples, engenharia caprichada.

## Objetivo no portfólio

Mostrar domínio da stack MERN em um cenário difícil de verdade: tempo real, sincronização de estado entre clientes, permissões e modelagem de documentos em NoSQL.

## Stack

| Camada | Tecnologia |
|---|---|
| Front | React + Vite + TypeScript, Tiptap (ProseMirror), TanStack Query, Tailwind |
| Back | Node.js + Express + TypeScript |
| Tempo real | Socket.IO + Yjs (CRDT) |
| Banco | MongoDB (Mongoose) |
| Cache / pub-sub | Redis (adapter do Socket.IO para escalar horizontalmente) |
| Auth | JWT (access + refresh token em cookie httpOnly) |
| Testes | Vitest/Jest, Supertest, Playwright |
| Infra | Docker Compose, CI no GitHub Actions, deploy (Render/Fly.io + Mongo Atlas + Vercel) |

## Funcionalidades

### MVP
- Cadastro, login e logout
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
User {
  _id, name, email, passwordHash, avatarColor, createdAt
}

Document {
  _id, title, ownerId,
  members: [{ userId, role: 'owner' | 'editor' | 'viewer' }],
  ydocState: Buffer,      // estado binário do Yjs
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

1. Cliente abre o documento e entra numa sala do Socket.IO (`doc:<id>`), autenticada pelo JWT.
2. O servidor valida a permissão e envia o estado atual do Yjs.
3. Cada edição gera um update binário do Yjs, enviado ao servidor e retransmitido para a sala.
4. Updates são acumulados em memória/Redis e persistidos no Mongo com debounce (ex.: a cada 2s ou N updates).
5. Com o Redis adapter, várias instâncias do servidor compartilham as salas.
6. Leitores recebem updates, mas o servidor rejeita updates vindos deles.

## API REST (resumo)

```
POST   /auth/register
POST   /auth/login
POST   /auth/refresh
POST   /auth/logout

GET    /documents
POST   /documents
GET    /documents/:id
PATCH  /documents/:id
DELETE /documents/:id

POST   /documents/:id/members
PATCH  /documents/:id/members/:userId
DELETE /documents/:id/members/:userId

GET    /documents/:id/versions
POST   /documents/:id/versions/:versionId/restore
```

## Roadmap (8 semanas)

| Semana | Entrega |
|---|---|
| 1 | Setup do monorepo, Docker Compose, CI, auth completa |
| 2 | CRUD de documentos e tela de listagem |
| 3 | Editor com Tiptap e autosave via REST |
| 4 | Tempo real com Socket.IO + Yjs, persistência com debounce |
| 5 | Presença (cursores), compartilhamento e permissões |
| 6 | Redis adapter, testes de integração e E2E com dois navegadores |
| 7 | Histórico de versões e busca |
| 8 | Deploy, README caprichado, GIF de demo, polimento |

## O que destacar no README

- GIF com duas janelas editando o mesmo documento ao mesmo tempo
- Diagrama da arquitetura de sincronização
- Por que CRDT em vez de "último a salvar vence"
- Teste E2E que simula dois usuários editando em paralelo
- Como o sistema escala com várias instâncias (Redis adapter)
- Decisões e trade-offs (Mongo para o documento, debounce de persistência)
