import { ObjectId } from 'mongodb';

import { auth } from '../config/better-auth.js';
import { db } from '../config/mongodb.js';

const CLEANUP_INTERVAL_MS = 24 * 60 * 60 * 1000; // 1 dia
const BATCH_SIZE = 100;

async function findAbandonedGuests(now: Date, afterId: ObjectId | null) {
	return db
		.collection('user')
		.aggregate<{ _id: ObjectId }>([
			{ $match: { isAnonymous: true, ...(afterId && { _id: { $gt: afterId } }) } },
			{ $sort: { _id: 1 } },
			{
				$lookup: {
					from: 'session',
					let: { userId: '$_id' },
					pipeline: [
						{
							$match: {
								$expr: { $and: [{ $eq: ['$userId', '$$userId'] }, { $gt: ['$expiresAt', now] }] },
							},
						},
						{ $limit: 1 },
					],
					as: 'activeSessions',
				},
			},
			{ $match: { activeSessions: { $size: 0 } } },
			{ $limit: BATCH_SIZE },
			{ $project: { _id: 1 } },
		])
		.toArray();
}

export async function cleanupAbandonedGuests(now = new Date()) {
	const { internalAdapter } = await auth.$context;

	let deleted = 0;
	let failed = 0;
	let afterId: ObjectId | null = null;

	for (;;) {
		const guests = await findAbandonedGuests(now, afterId);
		if (guests.length === 0) break;

		for (const guest of guests) {
			try {
				await internalAdapter.deleteUser(guest._id.toHexString());
				deleted++;
			} catch (error) {
				failed++;
				console.error(`Failed to delete abandoned guest ${guest._id.toHexString()}:`, error);
			}
		}

		afterId = guests.at(-1)!._id;
	}

	return { deleted, failed };
}

export function scheduleCleanupAbandonedGuests() {
	const run = async () => {
		try {
			const { deleted, failed } = await cleanupAbandonedGuests();
			if (deleted || failed) {
				console.log(`Abandoned guests cleanup: ${deleted} deleted, ${failed} failed`);
			}
		} catch (error) {
			console.error('Abandoned guests cleanup failed:', error);
		}
	};

	void run();
	const interval = setInterval(run, CLEANUP_INTERVAL_MS);
	interval.unref();

	return () => clearInterval(interval);
}
