// Ports of their own, so the E2E never meets the servers of `pnpm dev` (3333 and 5173)
export const ports = { serverA: 4333, serverB: 4334, webA: 6173, webB: 6174 } as const;

/** The two web origins. Each one proxies /api to its own server instance. */
export const origins = {
	a: `http://localhost:${ports.webA}`,
	b: `http://localhost:${ports.webB}`,
} as const;

export type InstanceName = keyof typeof origins;

// Same Mongo as the dev one (compose-dev.yml), but another database, so the dev documents are left alone
export const mongoUrl =
	process.env.E2E_MONGO_URL ??
	'mongodb://localhost:27017/collaborative-editor-e2e?directConnection=true';

export const redisUrl = process.env.E2E_REDIS_URL ?? 'redis://localhost:6379';

// Not a secret: the database is thrown away
export const authSecret = 'e2e-only-secret-that-is-at-least-32-characters-long';

export const password = 'e2e-password-123';
