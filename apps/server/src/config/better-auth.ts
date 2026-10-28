import { mongodbAdapter } from '@better-auth/mongo-adapter';
import { betterAuth } from 'better-auth';
import { anonymous } from 'better-auth/plugins';

import { sendVerifyEmail } from '../emails/verify-email.js';
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
		requireEmailVerification: true,
	},
	emailVerification: {
		sendOnSignUp: true,
		sendOnSignIn: true,
		autoSignInAfterVerification: true,
		expiresIn: 60 * 60,
		sendVerificationEmail: async ({ user, url }) => {
			void sendVerifyEmail({ to: user.email, name: user.name, url }).catch((error) => {
				console.error('Failed to send verification email:', error);
			});
		},
	},
});
