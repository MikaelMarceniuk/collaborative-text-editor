import type { RequestHandler } from 'express';

// Replaces authMiddleware in tests: the user comes from the x-test-user-id header
// (and x-test-user-guest, for guests), so a test can act as anyone without going through Better Auth.
export const authMiddleware: RequestHandler = (req, res, next) => {
	const userId = req.header('x-test-user-id');

	if (!userId) {
		res.status(401).json({ error: 'Unauthorized' });
		return;
	}

	const now = new Date();

	res.locals.user = {
		id: userId,
		name: 'Test user',
		email: `${userId}@test.local`,
		emailVerified: true,
		isAnonymous: req.header('x-test-user-guest') === 'true',
		createdAt: now,
		updatedAt: now,
	};
	next();
};
