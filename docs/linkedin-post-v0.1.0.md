# Post do LinkedIn: v0.1.0

## Antes de publicar

- [x] Release `v0.1.0` publicada no GitHub e o deploy terminou
- [x] App funcionando em produção (testar o "Continue as guest")
- [x] README com o link "See it live" certo
- [x] Headline do LinkedIn com o mesmo cargo do post (Full-Stack / Software Engineer)
- [x] Imagem para o post: print do editor com o documento "World Trip"

## Post

```
I designed, built and shipped a full-stack collaborative text editor, from architecture to production. Today it's live as v0.1.0 🚀

I built this project to show how I build end-to-end applications: maintainable code, documented decisions and automated CI/CD.

What I did:

🎨 Frontend: a rich text editor in React 19 + TypeScript (Tiptap/ProseMirror), with server state in TanStack Query, light/dark themes and an accessible UI

⚙️ Backend: a REST API in Node.js + Express with schema validation (Zod), role-based access control, and email verification with guest accounts (Better Auth)

🧠 Architecture: documents stored as CRDTs (Yjs), so concurrent edits merge without conflicts and the move to real-time won't need a data migration. Binary incremental sync and optimistic concurrency keep simultaneous saves from erasing each other

🛡️ Reliability: autosave with debounce, retries with exponential backoff, and a final save when the tab closes

🚀 DevOps: CI with lint, format and type checks; one GitHub release deploys the API to Fly.io and the web app to Vercel, on my own domain

🤖 My AI copilot

Claude was with me throughout this whole journey, as a copilot, not an autopilot. We discussed architecture trade-offs, planned the order of development, and researched better ways to solve each problem. When I was learning something new, like CRDTs, I asked it to teach me step by step instead of handing me the code.

I make the decisions, and I understand every line that ships. AI makes me faster, and it doesn't do the thinking for me. Every decision is documented with its trade-offs in the README and design docs.

Next: real-time collaboration over WebSocket, live cursors, and E2E tests.

I'm open to remote Full-Stack / Software Engineer roles. If your team is hiring, I'd love to connect 🤝

🔗 See it live + code in the comments 👇

#FullStack #TypeScript #React #NodeJS #RemoteWork #AI
```

## Primeiro comentário

Comentar logo depois de publicar.

```
See it live (no account needed, just "Continue as guest"): https://collaborative-text-editor.mmarceniuk.dev/
Code: https://github.com/MikaelMarceniuk/collaborative-text-editor
```

## Dicas

- O LinkedIn não aceita markdown: os títulos ficam sem negrito, e os emojis já separam os blocos.
- Links no corpo do post diminuem o alcance, por isso eles vão no primeiro comentário.
- Publicar num dia útil, de manhã no horário dos recrutadores que você quer atingir (ex.: terça a quinta, 8h–10h no horário de Nova York ou de Londres).
- Responder os comentários na primeira hora.
