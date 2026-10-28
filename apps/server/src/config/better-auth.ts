import { mongodbAdapter } from '@better-auth/mongo-adapter';
import { betterAuth } from 'better-auth';
import { anonymous } from 'better-auth/plugins';

import { sendVerifyEmail } from '../emails/verify-email.js';
import { deleteGuestDocuments } from '../services/delete-guest-documents.js';
import { transferGuestDocuments } from '../services/transfer-guest-documents.js';
import { env } from './env.js';
import { db, mongoClient } from './mongodb.js';

export const auth = betterAuth({
	plugins: [
		anonymous({
			onLinkAccount: ({ anonymousUser, newUser }) =>
				transferGuestDocuments({
					guestUserId: anonymousUser.user.id,
					userId: newUser.user.id,
				}),
		}),
	],
	databaseHooks: {
		user: {
			delete: {
				before: async (user) => {
					if (!user.isAnonymous) return;
					await deleteGuestDocuments({ guestUserId: user.id });
				},
			},
		},
	},
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
		sendOnSignIn: false,
		autoSignInAfterVerification: true,
		expiresIn: 60 * 60,
		sendVerificationEmail: async ({ user, url }) => {
			void sendVerifyEmail({ to: user.email, name: user.name, url }).catch((error) => {
				// TODO Improve with logs
				console.error('Failed to send verification email:', error);
			});
		},
	},
});
