import { mongodbAdapter } from '@better-auth/mongo-adapter';
import { betterAuth } from 'better-auth';
import { anonymous } from 'better-auth/plugins';

import { env } from './env.js';
import { db, mongoClient } from './mongodb.js';

export const auth = betterAuth({
	plugins: [anonymous()],
	secret: env.BETTER_AUTH_SECRET,
	baseURL: env.BETTER_AUTH_URL,
	trustedOrigins: [env.WEB_URL],
	database: mongodbAdapter(db, {
		client: mongoClient,
	}),
	advanced: {
		database: {
			joins: true,
		},
	},
	emailAndPassword: {
		enabled: true,
		autoSignIn: true,
		requireEmailVerification: false,
	},
});
