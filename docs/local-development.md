# Rodar localmente

Hoje o dev depende do Mongo Atlas e de subir server e web em dois terminais. Este plano cria um `compose-dev.yml` com o Mongo local e um único comando (`pnpm dev`) que sobe tudo: Mongo, server e web.

Quando estiver pronto, o conteúdo da seção [Primeira execução](#primeira-execução) vira a seção "Running locally" do README (em inglês).

## Decisões

- **Mongo como replica set de um nó.** O adapter do better-auth abre transação no sign-up (`user` + `account`), e transação só funciona em replica set. Com o `mongo:8` standalone, o `POST /api/auth/sign-up/email` responde 500. Ver `docs/todos.md`.
- **O healthcheck faz o `rs.initiate`.** Na primeira vez o replica set ainda não existe: o healthcheck tenta `rs.status()` e, se der erro, inicializa. Nas próximas vezes o estado já está salvo no volume e o `rs.status()` passa direto. Assim ninguém precisa rodar comando manual.
- **Sem usuário/senha no Mongo local.** Replica set com autenticação exige um `keyFile` compartilhado entre os nós, o que complica o setup sem ganho no dev. A porta fica exposta só em `127.0.0.1`.
- **`directConnection=true` na URL.** O driver conecta direto no nó, sem tentar descobrir os outros membros do replica set pelo hostname interno do container.
- **Script no `package.json` da raiz, sem dependência nova.** `docker compose up --wait` espera o healthcheck ficar verde, e o `pnpm --parallel` roda o `start:dev` dos dois apps no mesmo terminal, com prefixo em cada linha. Dá para trocar por `concurrently` depois se quiser saída colorida.
- **Não usar `transaction: false` no adapter** como atalho: o dev ficaria diferente da produção.

## Arquivos

### `compose-dev.yml` (raiz)

```yaml
services:
  mongo:
    image: mongo:8
    command: ['--replSet', 'rs0', '--bind_ip_all']
    ports:
      - '127.0.0.1:${MONGO_PORT:-27017}:27017'
    volumes:
      - ./.docker-data/mongo:/data/db
    healthcheck:
      test: >
        mongosh --quiet --eval "
          try { rs.status().ok }
          catch (e) { rs.initiate({ _id: 'rs0', members: [{ _id: 0, host: 'localhost:27017' }] }).ok }
        "
      interval: 5s
      timeout: 10s
      retries: 10
      start_period: 10s
```

- O `host: 'localhost:27017'` funciona porque o server roda na sua máquina (fora do container) e acessa pela porta publicada.
- Se você já tem um Mongo na `27017`, crie um `.env` na raiz com `MONGO_PORT=27018` (o Compose lê esse arquivo e ele já é ignorado pelo git) e use a mesma porta no `MONGO_URL` do `apps/server/.env`. O `host` do `rs.initiate` continua `localhost:27017` (a porta de dentro do container): com `directConnection=true` o driver conecta direto na porta publicada, sem resolver o host do replica set.
- `.docker-data` já está no `.gitignore`.

### `package.json` (raiz)

```json
"scripts": {
	"dev": "docker compose -f compose-dev.yml up -d --wait && pnpm --parallel -r start:dev",
	"dev:down": "docker compose -f compose-dev.yml down"
}
```

- `Ctrl+C` para o server e o web, mas o container do Mongo continua rodando (é rápido religar). `pnpm dev:down` derruba o container. Os dados ficam no volume.
- Para apagar o banco local: `pnpm dev:down && rm -rf .docker-data/mongo`.

### `apps/server/.env.example`

Trocar o comentário do `MONGO_URL` para o valor local:

```bash
MONGO_URL=mongodb://localhost:27017/collaborative-editor?directConnection=true
```

## Primeira execução

```bash
pnpm install
cp apps/server/.env.example apps/server/.env   # preencher os valores
pnpm dev
```

- Web: http://localhost:5173
- API: http://localhost:3333 (o Vite faz proxy de `/api` para ela)

## Pontos em aberto

- [x] **`RESEND_API_KEY`:** opcional em `development` (o e-mail, com o link de verificação, é logado no console do server) e obrigatória nos outros ambientes. Validado no `env.ts`.
- [x] **Versões do pnpm e do Node:** o `mise.toml` fixa `pnpm 12.15.0` (igual ao `package.json`) e `node 24` (igual ao `Dockerfile`).

## Checklist

- [x] Criar `compose-dev.yml`
- [x] Adicionar `dev` e `dev:down` no `package.json` da raiz
- [x] Atualizar o `MONGO_URL` no `.env.example`
- [x] Testar do zero: apagar `.docker-data`, rodar `pnpm dev`, fazer sign-up por e-mail (testa a transação)
- [x] Descomentar a seção "Running locally" do README

## Testes do server

`pnpm --filter @collaborative-text-editor/server test` roda o Vitest contra o Mongo do `compose-dev.yml`, no banco `collaborative-editor-test` (a porta vem do `MONGO_PORT` do `.env` da raiz; `TEST_MONGO_URL` sobrescreve a URL inteira). O `src/test/setup.ts` recusa rodar em qualquer banco cujo nome não termine em `-test`, porque limpa as coleções a cada teste. No CI, o `server-ci.yml` sobe um `mongo:8` como service.
