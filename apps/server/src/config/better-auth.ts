import { mongodbAdapter } from '@better-auth/mongo-adapter';
import { betterAuth } from 'better-auth';

import { env } from './env.js';
import { db, mongoClient } from './mongodb.js';

export const auth = betterAuth({
	secret: env.BETTER_AUTH_SECRET,
	baseURL: env.BETTER_AUTH_URL,
	database: mongodbAdapter(db, {
		client: mongoClient,
	}),
	advanced: {
		database: {
			joins: true,
		},
	},
});
