import { defineConfig } from 'vitest/config';

export default defineConfig({
	test: {
		include: ['src/**/*.test.ts'],
		env: {
			// "development" makes the mailer print emails instead of sending them (see config/env.ts)
			NODE_ENV: 'development',
			MONGO_URL:
				process.env.TEST_MONGO_URL ??
				'mongodb://localhost:27017/collaborative-editor-test?directConnection=true',
			BETTER_AUTH_SECRET: 'test-secret-test-secret-test-secret-0123456789',
			BETTER_AUTH_URL: 'http://localhost:3333',
			RESEND_API_KEY: '',
			WEB_URL: 'http://localhost:5173',
		},
	},
});
