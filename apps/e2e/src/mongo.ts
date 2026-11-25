import { MongoClient } from 'mongodb';

import { mongoUrl } from './env.ts';

/**
 * The verification e-mail only goes to the server console in development, so the tests mark the
 * address as verified straight in the database. The sign-up screen itself is covered by auth.spec.ts.
 */
export async function markEmailVerified(email: string) {
	const client = new MongoClient(mongoUrl);
	try {
		const result = await client
			.db()
			.collection('user')
			.updateOne({ email }, { $set: { emailVerified: true } });

		if (result.matchedCount !== 1) {
			throw new Error(`No user with the email ${email} to verify`);
		}
	} finally {
		await client.close();
	}
}
