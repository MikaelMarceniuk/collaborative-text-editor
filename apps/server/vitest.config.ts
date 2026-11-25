import { defineConfig } from 'vitest/config';

// Reuses the MONGO_PORT from the root .env (see compose-dev.yml), when there is one
try {
	process.loadEnvFile('../../.env');
} catch {}

const testMongoUrl =
	process.env.TEST_MONGO_URL ??
	`mongodb://localhost:${process.env.MONGO_PORT ?? 27017}/collaborative-editor-test?directConnection=true`;

export default defineConfig({
	test: {
		include: ['src/**/*.test.ts'],
		setupFiles: ['src/test/setup.ts'],
		// Test files share one database, so they cannot run in parallel
		fileParallelism: false,
		env: {
			// "development" makes the mailer print emails instead of sending them (see config/env.ts)
			NODE_ENV: 'development',
			MONGO_URL: testMongoUrl,
			BETTER_AUTH_SECRET: 'test-secret-test-secret-test-secret-0123456789',
			BETTER_AUTH_URL: 'http://localhost:3333',
			RESEND_API_KEY: '',
			WEB_URL: 'http://localhost:5173',
		},
	},
});
