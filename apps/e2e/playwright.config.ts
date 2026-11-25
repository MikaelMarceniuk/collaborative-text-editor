import { defineConfig, devices } from '@playwright/test';

import { authSecret, mongoUrl, origins, ports, redisUrl } from './src/env.ts';
import type { TestOptions } from './src/fixtures.ts';

const isCi = Boolean(process.env.CI);

/** One server instance: `tsx` on the real entry point, with the env it needs and no .env file. */
const serverProcess = (port: number, webOrigin: string) => ({
	command: 'pnpm --filter @collaborative-text-editor/server exec tsx src/server.ts',
	url: `http://localhost:${port}/health`,
	reuseExistingServer: false,
	timeout: 60_000,
	env: {
		NODE_ENV: 'development',
		PORT: String(port),
		MONGO_URL: mongoUrl,
		BETTER_AUTH_SECRET: authSecret,
		BETTER_AUTH_URL: `http://localhost:${port}`,
		WEB_URL: webOrigin,
		REDIS_URL: redisUrl,
	},
});

/** One Vite dev server, proxying /api (and the sockets) to one server instance. */
const webProcess = (port: number, apiPort: number) => ({
	command: `pnpm --filter @collaborative-text-editor/web exec vite --port ${port} --strictPort`,
	url: `http://localhost:${port}`,
	reuseExistingServer: false,
	timeout: 60_000,
	env: { API_URL: `http://localhost:${apiPort}` },
});

export default defineConfig<TestOptions>({
	testDir: './tests',
	fullyParallel: true,
	forbidOnly: isCi,
	retries: isCi ? 1 : 0,
	reporter: isCi ? [['github'], ['html', { open: 'never' }]] : [['list']],
	use: {
		baseURL: origins.a,
		trace: 'on-first-retry',
		screenshot: 'only-on-failure',
	},
	projects: [
		// Everyone on the same instance. Runs every spec except the ones about several instances
		{
			name: 'one-instance',
			testIgnore: /multi-instance/,
			use: { ...devices['Desktop Chrome'], bobInstance: 'a' },
		},
		// Bob on the other instance. Only the specs where who is on which instance can matter
		{
			name: 'two-instances',
			testIgnore: /(smoke|auth|sharing)\.spec/,
			use: { ...devices['Desktop Chrome'], bobInstance: 'b' },
		},
	],
	webServer: [
		serverProcess(ports.serverA, origins.a),
		serverProcess(ports.serverB, origins.b),
		webProcess(ports.webA, ports.serverA),
		webProcess(ports.webB, ports.serverB),
	],
});
