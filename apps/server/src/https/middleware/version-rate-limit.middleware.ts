import { rateLimit } from 'express-rate-limit';

import { SwitchableRateLimitStore } from './switchable-rate-limit-store.js';

export const MAX_VERSION_WRITES_PER_HOUR = 30;

// Every version keeps the whole document, so saving them without stopping fills the database. Counts per user, in
// total for the routes that make one (saving a version and restoring, which keeps the current content first).
// Same store as the invite limit: in memory until the server connects to Redis (server.ts calls useRedis), and in
// Redis after that, so the instances count together. Needs authMiddleware before it.
export const versionRateLimitStore = new SwitchableRateLimitStore('rl:version:');

export const versionRateLimit = rateLimit({
	store: versionRateLimitStore,
	// If the store fails, the request goes through instead of failing with a 500
	passOnStoreError: true,
	windowMs: 60 * 60 * 1000,
	limit: MAX_VERSION_WRITES_PER_HOUR,
	standardHeaders: 'draft-8',
	legacyHeaders: false,
	keyGenerator: (_req, res) => res.locals.user.id,
	message: { error: 'Too many versions. Try again later' },
});
