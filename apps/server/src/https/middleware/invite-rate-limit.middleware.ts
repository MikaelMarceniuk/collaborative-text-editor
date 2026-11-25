import { rateLimit } from 'express-rate-limit';

import { SwitchableRateLimitStore } from './switchable-rate-limit-store.js';

export const MAX_INVITES_PER_HOUR = 20;

// Limits invites per user, not per IP: it makes email enumeration and invite spam expensive.
// The counter lives in memory until the server connects to Redis (server.ts calls useRedis), so that
// with several server instances they all count together. Needs authMiddleware before it.
export const inviteRateLimitStore = new SwitchableRateLimitStore('rl:invite:');

export const inviteRateLimit = rateLimit({
	store: inviteRateLimitStore,
	// If the store fails, an invite goes through instead of failing with a 500
	passOnStoreError: true,
	windowMs: 60 * 60 * 1000,
	limit: MAX_INVITES_PER_HOUR,
	standardHeaders: 'draft-8',
	legacyHeaders: false,
	keyGenerator: (_req, res) => res.locals.user.id,
	message: { error: 'Too many invites. Try again later' },
});
